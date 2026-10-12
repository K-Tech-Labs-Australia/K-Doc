/**
 * @file search.ts
 * @purpose Pure, dependency-free find-and-replace engine over Markdown source text for @k-doc/core.
 *   K-Doc's document of record is its Markdown source, and the incremental serializer preserves every byte
 *   the user did not touch. Searching the source is therefore both the honest thing (a user can search for
 *   `](` or `**` and find it) and the cheap thing: a replacement is a text splice at known offsets, which
 *   feeds straight into `DocumentSession.applyText` and leaves everything else byte-identical. Searching a
 *   rendered projection instead would find text the file does not contain and miss text it does.
 * @inputs Markdown source text strings, search queries, replacement templates, SearchOptions configurations,
 *   SearchMatch records, and character offset positions.
 * @outputs Readonly arrays of SearchMatch records, ReplaceResult objects with updated text and match counts,
 *   replaced string contents, and match indices.
 * @functions
 *   - findMatches: Finds all occurrences of a search query in source text according to search options.
 *   - replaceAll: Replaces all occurrences of a search query with expanded replacement text.
 *   - replaceMatch: Replaces a single specified SearchMatch with expanded replacement text.
 *   - nextMatchIndex: Finds the next or previous match index relative to a caret offset with wraparound.
 *   - InvalidQueryError: Error thrown when a regular expression search query is syntactically invalid.
 * @dataflow Source text + query / options -> RegExp pattern compilation & execution -> SearchMatch array -> reverse splicing / expansion -> replaced text & match indices.
 * @controlflow Compile RegExp pattern (escaping if literal) -> iterate exec collecting matches -> splice replacements backwards or locate target match index with wraparound.
 * @version 1
 * @date 2026-09-05
 */

/**
 * Maximum number of matches to collect to guard against pathological regex growth and memory exhaustion.
 */
const MAX_MATCHES = 100000;

/**
 * Regular expression matching special characters that must be escaped in literal search queries.
 */
const ESCAPE_REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Regular expression matching substitution tokens in regex replacement templates ($$, $&, $1..$9).
 */
const REPLACEMENT_EXPANSION_PATTERN = /\$(\$|&|[1-9])/g;

/**
 * Options configuring search execution.
 */
export interface SearchOptions {
  readonly caseSensitive?: boolean;   // default false
  readonly wholeWord?: boolean;       // default false
  readonly regex?: boolean;           // default false
}

/**
 * Describes a single query match in source text.
 */
export interface SearchMatch {
  readonly start: number;             // inclusive offset into the source text
  readonly end: number;               // exclusive
  readonly groups: readonly string[]; // capture groups, [] in literal mode
}

/**
 * Result returned by replaceAll containing modified text and replacement count.
 */
export interface ReplaceResult {
  readonly text: string;
  readonly count: number;
}

/**
 * Error thrown when a regular expression search query is syntactically invalid.
 *
 * @purpose Signals to callers that a user-supplied regular expression pattern failed compilation.
 * @inputs message - The explanatory error message describing the regex syntax failure.
 * @outputs InvalidQueryError - An instance of InvalidQueryError with name 'InvalidQueryError'.
 * @dataflow Error message string -> Error constructor -> InvalidQueryError instance.
 * @controlflow Call super(message) -> set this.name to 'InvalidQueryError'.
 */
export class InvalidQueryError extends Error {
  /**
   * Constructs an InvalidQueryError.
   *
   * @param message - The error message detailing the invalid regex syntax.
   */
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

/**
 * Escapes all regular expression special characters in a literal string.
 *
 * @purpose Sanitizes a literal search string by prefixing regex meta-characters with a backslash.
 * @inputs pattern - The raw literal search string to escape.
 * @outputs string - The escaped string safe for embedding in a RegExp.
 * @dataflow Raw pattern string -> replace special characters -> escaped pattern string.
 * @controlflow Scan string for meta-characters [.*+?^${}()|[\]\\] -> replace each with \\$& -> return sanitized string.
 */
function escapeRegExp(pattern: string): string {
  // Replace each regular expression special character with a backslash-escaped version.
  return pattern.replace(ESCAPE_REGEX_SPECIAL_CHARS, '\\$&');
}

/**
 * Expands replacement tokens for regular expression replacements or returns verbatim text for literal mode.
 *
 * @purpose Expands $& (full match), $1..$9 (capture groups), and $$ (literal dollar) in regex mode, or returns string unchanged in literal mode.
 * @inputs replacement - The replacement template string.
 * @inputs match - The SearchMatch object containing captured group substrings.
 * @inputs isRegex - Boolean flag indicating whether regex expansion mode is active.
 * @inputs matchedText - The full matched source text substring corresponding to $&.
 * @outputs string - The expanded replacement text.
 * @dataflow Replacement string + capture groups + matched text -> regex token replacement -> expanded string.
 * @controlflow Check isRegex flag -> if false return replacement verbatim -> if true replace $$, $&, $1..$9 tokens -> return expanded string.
 */
function expandReplacement(
  replacement: string,
  match: SearchMatch,
  isRegex: boolean,
  matchedText: string
): string {
  // Check if search was performed in regular expression mode.
  if (!isRegex) {
    // Literal mode: insert replacement verbatim without interpreting $ tokens.
    return replacement;
  } else {
    // Regex mode: expand $$, $&, and $1..$9 substitution tokens.
  }

  // Substitute regex replacement tokens:
  // $$ -> literal $
  // $& -> full matched text
  // $1..$9 -> capture group at index (token - 1), or empty string if out of range
  return replacement.replace(
    REPLACEMENT_EXPANSION_PATTERN,
    (_fullMatch: string, token: string): string => {
      // Check if token represents an escaped dollar sign ($$).
      if (token === '$') {
        // Escaped dollar sign: return literal $.
        return '$';
      } else if (token === '&') {
        // Full match token: return the entire matched text string.
        return matchedText;
      } else {
        // Numeric capture group token ($1..$9): resolve 0-based group index.
        const groupIndex = Number(token) - 1;
        const groupValue = match.groups[groupIndex];

        // Check if the capture group exists and is defined.
        if (groupValue !== undefined) {
          // Capture group value is present: return captured text.
          return groupValue;
        } else {
          // Capture group is out of range or unmatched: expand to empty string.
          return '';
        }
      }
    }
  );
}

/**
 * Finds all occurrences of a search query in source text according to search options.
 *
 * @purpose Scans source text for matches against literal or regular expression queries with optional whole-word and case sensitivity.
 * @inputs text - The Markdown source text to search.
 * @inputs query - The search query string (literal or regular expression).
 * @inputs options - Optional SearchOptions controlling case sensitivity, whole-word matching, and regex mode.
 * @outputs readonly SearchMatch[] - Readonly array of SearchMatch objects containing start/end offsets and capture groups.
 * @dataflow Markdown text + query + options -> build & validate RegExp -> exec in loop -> collect SearchMatch records.
 * @controlflow Check for empty query -> determine flags and pattern -> instantiate RegExp (catching syntax errors to throw InvalidQueryError) -> loop exec advancing zero-length matches -> break on MAX_MATCHES -> return matches.
 */
export function findMatches(
  text: string,
  query: string,
  options?: SearchOptions
): readonly SearchMatch[] {
  // Check if query is empty.
  // An empty query returns [] to represent 'no search yet' and prevent hanging the UI with highlights at every offset.
  if (query.length === 0) {
    // Empty search query: return empty match array immediately.
    return [];
  } else {
    // Non-empty search query: proceed with RegExp compilation and execution.
  }

  const caseSensitive = options?.caseSensitive ?? false;
  const wholeWord = options?.wholeWord ?? false;
  const isRegex = options?.regex ?? false;

  // Build the regular expression pattern string based on search mode.
  let pattern: string;
  if (isRegex) {
    // Regex mode: use query as-is.
    pattern = query;
  } else {
    // Literal mode: escape all regular expression special characters.
    pattern = escapeRegExp(query);
  }

  // Check if whole-word matching is requested.
  if (wholeWord) {
    // Wrap pattern in word boundaries using a non-capturing group so user capture group numbering ($1..$9) remains unchanged.
    pattern = `\\b(?:${pattern})\\b`;
  } else {
    // Standard matching without word boundary wrapping.
  }

  // Construct flags: always global 'g', case-insensitive 'i' unless caseSensitive is true.
  // The unicode flag 'u' is deliberately omitted to avoid rejecting valid user escape sequences.
  let flags = 'g';
  if (caseSensitive) {
    // Case-sensitive search: do not include 'i' flag.
  } else {
    // Case-insensitive search: append 'i' flag.
    flags += 'i';
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error: unknown) {
    // Malformed user-typed regular expression: rethrow as InvalidQueryError without swallowing error message.
    const message = error instanceof Error ? error.message : String(error);
    throw new InvalidQueryError(message);
  }

  const matches: SearchMatch[] = [];
  let execResult: RegExpExecArray | null;

  // Execute regex iteratively over the text.
  while ((execResult = regex.exec(text)) !== null) {
    const start = execResult.index;
    const matchStr = execResult[0];
    const end = start + matchStr.length;

    // Collect capture groups: in regex mode map captured groups (defaulting undefined to ''), in literal mode empty array.
    let groups: readonly string[];
    if (isRegex) {
      // Regex mode: extract capture groups skipping full match at index 0.
      groups = execResult.slice(1).map((group: string | undefined): string => {
        // Check if capture group matched.
        if (group !== undefined) {
          // Group captured text: return string.
          return group;
        } else {
          // Unmatched optional group: default to empty string.
          return '';
        }
      });
    } else {
      // Literal mode: no capture groups.
      groups = [];
    }

    matches.push({
      start,
      end,
      groups,
    });

    // Zero-length matches (e.g. from ^, $, or a*) must advance the regex lastIndex manually.
    // Standard RegExp.exec leaves lastIndex unmoved on zero-length matches, which would cause an infinite loop.
    if (matchStr.length === 0) {
      // Match length is zero: manually advance lastIndex by 1 character to continue scanning.
      regex.lastIndex += 1;
    } else {
      // Non-zero match: lastIndex was automatically advanced by RegExp.exec.
    }

    // Guard against pathological growth and memory exhaustion.
    if (matches.length >= MAX_MATCHES) {
      // Maximum match threshold reached: terminate collection loop early.
      break;
    } else {
      // Match count is within acceptable threshold; continue searching.
    }
  }

  return matches;
}

/**
 * Replaces all occurrences of a search query in source text with the specified replacement.
 *
 * @purpose Finds all query matches in source text and substitutes each match with expanded replacement text in reverse order.
 * @inputs text - The Markdown source text to process.
 * @inputs query - The search query string.
 * @inputs replacement - The replacement template string.
 * @inputs options - Optional SearchOptions controlling search behavior.
 * @outputs ReplaceResult - Record containing updated text string and total replacement count.
 * @dataflow Source text + query + replacement -> findMatches -> iterate matches backwards -> splice replacements -> ReplaceResult.
 * @controlflow Find matches -> check for zero matches -> loop backwards through matches splicing text -> return resulting text and count.
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options?: SearchOptions
): ReplaceResult {
  const matches = findMatches(text, query, options);

  // Check if any matches were found.
  if (matches.length === 0) {
    // No matches found: return original text with count 0.
    return {
      text,
      count: 0,
    };
  } else {
    // Matches found: proceed with reverse splicing.
  }

  const isRegex = options?.regex ?? false;
  let result = text;

  // Splice replacements from the end backwards so earlier match offsets remain valid and unchanged.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    // Guard against undefined elements under strict indexing.
    if (match !== undefined) {
      const matchedText = text.slice(match.start, match.end);
      const expanded = expandReplacement(replacement, match, isRegex, matchedText);
      result = result.slice(0, match.start) + expanded + result.slice(match.end);
    } else {
      // Match at index was undefined.
    }
  }

  return {
    text: result,
    count: matches.length,
  };
}

/**
 * Replaces a single specified SearchMatch in source text with the replacement text.
 *
 * @purpose Replaces one specific match instance in the source text with expanded replacement text.
 * @inputs text - The Markdown source text containing the match.
 * @inputs match - The SearchMatch instance to replace.
 * @inputs replacement - The replacement template string.
 * @inputs options - Optional SearchOptions controlling regex expansion mode.
 * @outputs string - The resulting text with the specified match replaced.
 * @dataflow Source text + match + replacement -> expand replacement -> splice at match offsets -> replaced string.
 * @controlflow Validate match offsets within bounds -> expand replacement template -> splice text at [start, end) -> return string.
 */
export function replaceMatch(
  text: string,
  match: SearchMatch,
  replacement: string,
  options?: SearchOptions
): string {
  // Check if match offsets fall within valid document bounds.
  if (match.start < 0 || match.end < match.start || match.end > text.length) {
    // Match range is out of bounds: return original text unmodified.
    return text;
  } else {
    // Match range is valid within document bounds: proceed with replacement.
  }

  const isRegex = options?.regex ?? false;
  const matchedText = text.slice(match.start, match.end);
  const expanded = expandReplacement(replacement, match, isRegex, matchedText);

  return text.slice(0, match.start) + expanded + text.slice(match.end);
}

/**
 * Finds the index of the next or previous match relative to a caret offset, wrapping around at document boundaries.
 *
 * @purpose Locates the appropriate match index for find-next (forward) or find-previous (backward) navigation from a caret offset.
 * @inputs matches - Readonly array of sorted SearchMatch records.
 * @inputs from - The 0-based character offset of the caret.
 * @inputs forward - True to search forward for the next match at or after `from`; false to search backward before `from`.
 * @outputs number - The 0-based index of the target match in the matches array, or -1 if matches is empty.
 * @dataflow Matches array + caret offset + direction -> scan match start offsets -> wrap around at array boundaries -> match index.
 * @controlflow Check for empty array -> if forward search find first match with start >= from (wrap to 0 if none) -> if backward search find last match with start < from (wrap to last index if none) -> return index.
 */
export function nextMatchIndex(
  matches: readonly SearchMatch[],
  from: number,
  forward: boolean
): number {
  // Check if matches array is empty.
  if (matches.length === 0) {
    // No matches exist: return -1.
    return -1;
  } else {
    // Array contains at least one match: proceed with index search.
  }

  // Check search direction: forward (find next) vs backward (find previous).
  if (forward) {
    // Forward navigation: locate the first match at or after caret offset `from`.
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      // Guard against undefined elements under strict indexing.
      if (match !== undefined && match.start >= from) {
        // Found first match at or after from: return its index.
        return i;
      } else {
        // Match start is before from: continue forward scan.
      }
    }

    // Caret is past all matches: wrap around to the first match in the document.
    return 0;
  } else {
    // Backward navigation: locate the last match strictly before caret offset `from`.
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      // Guard against undefined elements under strict indexing.
      if (match !== undefined && match.start < from) {
        // Found last match before from: return its index.
        return i;
      } else {
        // Match start is at or after from: continue backward scan.
      }
    }

    // Caret is at or before all matches: wrap around to the last match in the document.
    return matches.length - 1;
  }
}
