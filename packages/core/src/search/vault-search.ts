/**
 * @file vault-search.ts
 * @purpose Vault-wide, pure (no DOM, no filesystem I/O) text search over multiple files' source, feeding K-Doc's find-and-replace. It turns raw per-file text into ranked match rows with readable snippets and applies selective replacements that tolerate files changing between search and edit.
 * @inputs SearchableFile records (path, relative path, text), a query string, SearchOptions, a match limit, replacement templates, and selected match offset pairs.
 * @outputs FileMatch/MatchSnippet/FileResult/VaultSearchResult records describing matches, ReplaceOutcome records describing selective replacements, and the SNIPPET_CONTEXT_CHARS / MAX_VAULT_MATCHES tuning constants.
 * @functions
 *   - snippetAt: Builds a trimmed MatchSnippet of context around a match offset within its line.
 *   - searchFile: Finds matches in one file and annotates each with line/column and a snippet, capped by limit.
 *   - searchFiles: Searches many files, enforcing a global match cap and reporting truncation.
 *   - replaceSelected: Replaces only the selected matches still present in current text, counting stale ones.
 * @dataflow SearchableFile[].text + query + options -> findMatches -> FileMatch rows with snippets -> aggregated VaultSearchResult; selected offsets + current text -> findMatches -> reverse-spliced replacements -> ReplaceOutcome.
 * @controlflow Compile/execute regex per file -> iterate matches in order advancing line counters -> slice snippets -> aggregate across files under a global cap; for replacement, build wanted offset set -> scan current matches right-to-left -> splice selected matches -> compute stale count.
 * @version 1
 * @date 2026-09-14
 */

import { findMatches, replaceMatch, type SearchMatch, type SearchOptions } from './search.js';

/** One file to search. */
export interface SearchableFile {
  readonly path: string;
  readonly relative: string;
  readonly text: string;
}

/** The line around a match, cut down to a readable width. */
export interface MatchSnippet {
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

export interface FileMatch {
  readonly start: number; // offset into the file text, inclusive
  readonly end: number; // exclusive
  readonly line: number; // 1-based line of start
  readonly column: number; // 1-based column of start (UTF-16 units)
  readonly snippet: MatchSnippet;
}

export interface FileResult {
  readonly path: string;
  readonly relative: string;
  readonly matches: readonly FileMatch[];
}

export interface VaultSearchResult {
  readonly files: readonly FileResult[]; // only files with at least one match, in input order
  readonly totalMatches: number; // matches included in files
  readonly truncated: boolean; // true when the limit left out at least one match
}

/** A replacement for one file: the new text and what happened to the matches asked for. */
export interface ReplaceOutcome {
  readonly text: string;
  readonly replaced: number;
  readonly stale: number;
}

/** Characters of context kept either side of a match in a snippet. */
export const SNIPPET_CONTEXT_CHARS: number = 40;
/** Most matches one vault search reports, so a query like 'e' cannot draw tens of thousands of rows. */
export const MAX_VAULT_MATCHES: number = 2000;

/**
 * @purpose Renders a trimmed MatchSnippet showing the line around a match, clipped to a readable width with ellipses at clip boundaries.
 * @inputs text - The full file/source text containing the match.
 * @inputs start - Inclusive 0-based offset of the match start (UTF-16 units).
 * @inputs end - Exclusive 0-based offset of the match end (UTF-16 units).
 * @outputs MatchSnippet - Record with before/match/after substrings trimmed for a result row.
 * @dataflow text + start + end -> locate line bounds -> slice match and context -> trim indentation and strip CRLF artifacts -> MatchSnippet.
 * @controlflow Compute lineStart/lineEnd -> branch on whether the match overruns its line -> gather before/after context with ellipses -> strip trailing CR from after and \r… from match -> return snippet.
 */
export function snippetAt(text: string, start: number, end: number): MatchSnippet {
  // Find the first newline at or before start - 1; adding 1 yields the line's starting offset.
  // When start is 0, lastIndexOf('\n', -1) returns -1 so lineStart becomes 0.
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;

  // Offset of the newline that terminates the match's line, or -1 when it runs to end of text.
  const newlineAfterStart = text.indexOf('\n', start);

  // Use the terminating newline as the line end, or the text length on the final line.
  const lineEnd = newlineAfterStart === -1 ? text.length : newlineAfterStart;

  let match: string;
  let afterText: string;

  // A match that runs past the end of its line is shown up to the line end, with an ellipsis.
  if (end > lineEnd) {
    // Match overruns its line: slice to the line end and append a single ellipsis glyph.
    match = text.slice(start, lineEnd) + '…';
    afterText = '';
  } else {
    // Match fits within its line: slice it directly and gather trailing context up to the line end.
    match = text.slice(start, end);
    const afterFrom = end;
    const afterTo = Math.min(lineEnd, end + SNIPPET_CONTEXT_CHARS);
    // Append an ellipsis when context is clipped before the line ends so omission is visible.
    afterText = text.slice(afterFrom, afterTo) + (afterTo < lineEnd ? '…' : '');
  }

  // Take up to SNIPPET_CONTEXT_CHARS of leading context but never cross the line start.
  const beforeFrom = Math.max(lineStart, start - SNIPPET_CONTEXT_CHARS);
  let before = text.slice(beforeFrom, start);

  // Check whether the leading context was cut short of the line start.
  if (beforeFrom > lineStart) {
    // Leading context was clipped at the line start: prefix an ellipsis to signal omitted text.
    before = '…' + before;
  } else {
    // Context begins at the line start: drop leading indentation so it is not noise in a result row.
    before = before.trimStart();
  }

  // Strip a trailing carriage return from a CRLF line end so it never shows in the row.
  if (afterText.endsWith('\r')) {
    afterText = afterText.slice(0, -1);
  } else {
    // No trailing carriage return to strip; leave afterText unchanged.
  }

  // A match that overran its line may carry a carriage return just before the appended ellipsis (CRLF case).
  if (match.endsWith('\r…')) {
    // Remove the stray carriage return, keeping only the ellipsis.
    match = match.slice(0, -2) + '…';
  } else {
    // Match does not end with a carriage-return-ellipsis; leave it unchanged.
  }

  return { before, match, after: afterText };
}

/**
 * @purpose Finds all matches of a query in one file's text and annotates each with 1-based line/column and a readable snippet, capped by limit.
 * @inputs file - The SearchableFile whose text is searched.
 * @inputs query - The search query string (literal or regex).
 * @inputs options - SearchOptions controlling case sensitivity, whole-word matching, and regex mode.
 * @inputs limit - Maximum number of matches to include from this file.
 * @outputs FileResult - Record with the file's path/relative plus its capped match rows.
 * @dataflow file.text + query + options -> findMatches -> iterate matches in order advancing line counters -> annotate each with column and snippet -> FileResult.matches.
 * @controlflow Find matches -> loop over them breaking at limit -> advance line counter across newlines since last scan -> push {start,end,line,column,snippet} -> return FileResult.
 */
export function searchFile(
  file: SearchableFile,
  query: string,
  options: SearchOptions,
  limit: number
): FileResult {
  // Find every match in the file text according to the query and options.
  const found: readonly SearchMatch[] = findMatches(file.text, query, options);

  // Accumulate the visible FileMatch records, capped by limit.
  const matches: FileMatch[] = [];

  // Line/column bookkeeping while scanning forward through the text.
  let line = 1;
  let lineStart = 0;
  let scanned = 0;

  // Iterate matches in document order using for...of so each element is typed as SearchMatch (never undefined).
  for (const m of found) {
    // Stop once the visible match cap has been reached rather than collecting an unbounded number of rows.
    if (matches.length >= limit) {
      // Limit already reached before this match: stop collecting further matches from this file.
      break;
    } else {
      // Under the limit: advance line bookkeeping and append this match's result row.

      // Advance the line counter across every newline between the previously scanned position and this match start.
      for (let i = scanned; i < m.start; i++) {
        // Check for a line feed (code 10), which starts a new line.
        if (file.text.charCodeAt(i) === 10) {
          // Newline encountered: move to the next line and reset the line-start offset past it.
          line += 1;
          lineStart = i + 1;
        } else {
          // Not a newline character: leave line counters unchanged.
        }
      }

      // Record that scanning has reached this match's start position.
      scanned = m.start;

      matches.push({
        start: m.start,
        end: m.end,
        line,
        column: m.start - lineStart + 1,
        snippet: snippetAt(file.text, m.start, m.end),
      });
    }
  }

  return { path: file.path, relative: file.relative, matches };
}

/**
 * @purpose Searches many files under a global match cap and reports the aggregated results plus whether the search was truncated early.
 * @inputs files - Readonly list of SearchableFile records to search in input order.
 * @inputs query - The search query string (literal or regex).
 * @inputs options - SearchOptions controlling case sensitivity, whole-word matching, and regex mode.
 * @inputs limit - Global cap on total matches reported; defaults to MAX_VAULT_MATCHES.
 * @outputs VaultSearchResult - Only files with matches (input order), the total match count, and a truncation flag.
 * @dataflow Each file.text + query + options -> searchFile/findMatches -> FileResult rows aggregated under a running total -> VaultSearchResult.
 * @controlflow For each file searchFile with the remaining budget (possibly none) -> accumulate non-empty results -> once the limit is met, a second findMatches call finds whether a match was left out, which marks truncation and stops -> return aggregate.
 */
export function searchFiles(
  files: readonly SearchableFile[],
  query: string,
  options: SearchOptions,
  limit: number = MAX_VAULT_MATCHES
): VaultSearchResult {
  // Collected FileResults, in input order, only for files that produced at least one match.
  const results: FileResult[] = [];

  // Total matches across all collected results.
  let total = 0;

  // True when the limit left out at least one match.
  let truncated = false;

  for (const file of files) {
    // Matches still available before hitting the global cap. Once it is spent a file is still searched with
    // none to spare, so that a file left over with no matches does not make the result read as cut short.
    const remaining = limit - total;
    const result = searchFile(file, query, options, remaining);

    // Check whether this file matched at all.
    if (result.matches.length > 0) {
      // File produced matches: record it and advance the global match counter.
      results.push(result);
      total += result.matches.length;
    } else {
      // File produced no matches: skip it without adding to results or advancing the counter.
    }

    // A match left out -- the rest of this file's, or all of a later file's -- is what makes the result truncated.
    if (total >= limit && findMatches(file.text, query, options).length > result.matches.length) {
      // Limit reached with a match not kept: mark truncation and stop scanning further files.
      truncated = true;
      break;
    } else {
      // Under the limit, or this file had nothing more to show: continue to the next file.
    }
  }

  return { files: results, totalMatches: total, truncated };
}

/**
 * @purpose Replaces only the selected matches that still exist in current text, counting any selected offsets that no longer match as stale.
 * @inputs text - The current file/source text (possibly changed since search).
 * @inputs query - The search query string (literal or regex).
 * @inputs options - SearchOptions controlling case sensitivity, whole-word matching, and regex mode.
 * @inputs replacement - The replacement template (supports $1..$9 in regex mode).
 * @inputs selected - Readonly list of {start,end} offset pairs the user asked to replace.
 * @outputs ReplaceOutcome - The resulting text, count of replacements applied, and count of stale selected offsets.
 * @dataflow selected offsets -> wanted set + current findMatches -> right-to-left splice of selected matches via replaceMatch -> ReplaceOutcome with replaced/stale counts.
 * @controlflow Build wanted offset set -> find current matches -> iterate backwards splicing only selected matches -> compute stale as wanted size minus applied count -> return outcome.
 */
export function replaceSelected(
  text: string,
  query: string,
  options: SearchOptions,
  replacement: string,
  selected: readonly { readonly start: number; readonly end: number }[]
): ReplaceOutcome {
  // Offsets the user asked to replace, keyed by "start:end" for O(1) membership tests.
  const wanted = new Set<string>();
  for (const s of selected) {
    wanted.add(`${s.start}:${s.end}`);
  }

  // Matches present in the current text, which may differ from what was originally searched.
  const current = findMatches(text, query, options);

  let result = text;
  let replaced = 0;

  // Iterate right to left so a replacement never moves the offsets of a match still to be replaced.
  for (let i = current.length - 1; i >= 0; i--) {
    const m = current[i];
    // Guard the indexed read for noUncheckedIndexedAccess.
    if (m === undefined) {
      // Unreachable given the loop bounds [0, length): kept only to satisfy noUncheckedIndexedAccess.
      continue;
    } else {
      // Match is defined: proceed to evaluate whether it was selected for replacement.
    }

    // Check whether the user chose this match, by its exact range.
    if (wanted.has(`${m.start}:${m.end}`)) {
      // Selected match still present in current text: replace it and count the replacement.
      result = replaceMatch(result, m, replacement, options);
      replaced += 1;
    } else {
      // Not selected: leave this match untouched.
    }
  }

  // Any selected offset that was never applied corresponds to a match that no longer exists (stale).
  return { text: result, replaced, stale: wanted.size - replaced };
}
