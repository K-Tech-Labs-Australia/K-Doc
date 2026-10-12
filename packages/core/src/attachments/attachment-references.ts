/**
 * @file attachment-references.ts
 * @purpose Finds which files a Markdown document refers to, and (via the exported helper) which of a folder's files nothing refers to, implementing FR-6.14.
 * @inputs A Markdown document string for reference discovery; file-name lists and reference sets for unused-file computation.
 * @outputs A ReadonlySet of referenced base file names; an array of unreferenced file names.
 * @functions
 *   - referencedFileName: Reduces one link target to the local file name it ends in, or '' when it is not a local file.
 *   - attachmentReferences: Sweeps a document with four regexes and returns the set of referenced file names.
 *   - unusedAttachments: Returns folder files that no reference resolves to, case-insensitively.
 * @dataflow Document text → regex sweeps → referencedFileName() → resolved base names into a shared set; name lists + reference set → lower-cased membership test → unreferenced names.
 * @controlflow Constants define the four target patterns and the scheme guard; attachmentReferences runs each sweep in turn; referencedFileName strips schemes, fragments, queries, decodes, and splits on the last separator; unusedAttachments filters by case-insensitive absence.
 * @version 1
 * @date 2026-09-18
 */

// An inline link or image target: the text inside the parentheses of [text](target) or ![alt](target).
const INLINE_TARGET_RE = /!?\[[^\]]*\]\(\s*<?([^)<>\s]+)>?[^)]*\)/g;

// A wikilink embed target: the file name in ![[file]] or ![[file|alt]].
const EMBED_TARGET_RE = /!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

// A reference-definition target: the URL following an [id]: label at the start of a line.
const DEFINITION_TARGET_RE = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*<?([^\s>]+)>?/gm;

// An HTML <img> element's src attribute value.
const HTML_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

// A URL scheme prefix such as http: or data:, which names no file on disk.
const SCHEME_RE = /^[a-z][a-z0-9+.\-]*:/i;

/**
 * @purpose Reduces one link target to the local file name it ends in, or '' when it does not name a local file.
 * @inputs target - A raw Markdown link/image/reference-definition target as written in the document.
 * @outputs The base file name (last path segment) of the target, or '' if it is an absolute URL, protocol-relative URL, or otherwise not a local file.
 * @dataflow Raw target string → scheme/fragment/query stripping → percent-decoding → last-segment extraction → trimmed file name.
 * @controlflow Trim then reject absolute URLs and protocol-relative URLs early; otherwise strip fragment and query, decode percent escapes, split on the final path separator, and return the remaining segment.
 */
export function referencedFileName(target: string): string {
  let text = target.trim();
  if (text === '') {
    // The target carried no characters after trimming: it names nothing on disk.
    return '';
  } else {
    // A non-empty target remains; continue reducing it to a file name.
  }

  if (SCHEME_RE.test(text)) {
    // An absolute URL or data URI such as http://… or data:image/png: names no local file.
    return '';
  } else {
    // Not an absolute scheme: treat the target as a relative path and keep reducing it.
  }

  if (text.startsWith('//')) {
    // A protocol-relative URL such as //example.com/file names nothing on disk.
    return '';
  } else {
    // Not protocol-relative: continue to fragment and query stripping.
  }

  // Strip a trailing fragment so it never reaches the file-name extraction below.
  const hashIndex = text.indexOf('#');
  if (hashIndex >= 0) {
    // A fragment is present: cut everything from the first '#' onward.
    text = text.slice(0, hashIndex);
  } else {
    // No fragment: leave the text unchanged.
  }

  // Strip a trailing query so it never reaches the file-name extraction below.
  const questionIndex = text.indexOf('?');
  if (questionIndex >= 0) {
    // A query is present: cut everything from the first '?' onward.
    text = text.slice(0, questionIndex);
  } else {
    // No query: leave the text unchanged.
  }

  try {
    // Decode percent escapes so that %2F and friends resolve to their literal characters before splitting on separators.
    text = decodeURIComponent(text);
  } catch {
    // A malformed escape sequence cannot be decoded: fall back to using the text as written (unchanged).
  }

  const lastSeparator = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  if (lastSeparator >= 0) {
    // A path separator exists: slice past it to isolate the final segment, then trim it.
    return text.slice(lastSeparator + 1).trim();
  } else {
    // No separator present: the whole decoded text is itself the file name; return it trimmed.
    return text.trim();
  }
}

/**
 * @purpose Adds every referenced base file name found by a single pattern to `into`, skipping matches that do not resolve to a local file.
 * @inputs pattern - A global RegExp whose first capture group holds the raw link target; text - the document to scan; into - the accumulator set receiving resolved file names.
 * @outputs void; mutates `into` in place by adding each non-empty resolved file name discovered in `text`.
 * @dataflow Raw regex match → capture group 1 → referencedFileName() → non-empty result added into the shared set.
 * @controlflow Reset lastIndex, then repeatedly exec until null; for each match read group 1, skip when undefined, otherwise resolve and add.
 */
function collect(pattern: RegExp, text: string, into: Set<string>): void {
  // These patterns are module-level and global (the 'g' flag), but each sweep below runs to a null match,
  // which resets lastIndex itself -- so a sweep always starts at the beginning of the text it is given.
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const raw: string | undefined = match[1];
    if (raw !== undefined) {
      // A capture group was produced for this match, so there is a target to resolve.
      const fileName = referencedFileName(raw);
      if (fileName !== '') {
        // The target resolved to a real local file name: record it in the shared set.
        into.add(fileName);
      } else {
        // The target did not name a local file (absolute URL, empty, etc.): leave the set unchanged for this match.
      }
    } else {
      // This pattern matched without producing capture group 1: nothing to resolve or record.
    }
    match = pattern.exec(text);
  }
}

/**
 * @purpose Finds every file a Markdown document refers to, across inline links/images, wikilink embeds, reference definitions, and HTML image sources.
 * @inputs markdown - The full text of the document whose references should be discovered.
 * @outputs A set of unique base file names that the document refers to; empty when nothing resolves to a local file.
 * @dataflow Document text → four regex sweeps via collect() → resolved file names accumulated in one shared set → returned as a ReadonlySet.
 * @controlflow Build an empty accumulator, sweep each pattern in turn into it, then return the accumulated set.
 */
export function attachmentReferences(markdown: string): ReadonlySet<string> {
  const found = new Set<string>();

  // Sweep inline links and images first (e.g. [x](file.md) or ![y](file.png)); collect() resets each pattern's lastIndex before scanning.
  collect(INLINE_TARGET_RE, markdown, found);

  // Then wikilink embeds such as ![[note.md]] or ![[note.md|alt]].
  collect(EMBED_TARGET_RE, markdown, found);

  // Then reference-style link definitions like [id]: ./file.md.
  collect(DEFINITION_TARGET_RE, markdown, found);

  // Finally HTML <img> src attributes.
  collect(HTML_SRC_RE, markdown, found);

  return found;
}

/**
 * @purpose Returns the files in a folder that nothing refers to, using case-insensitive comparison because the filesystems K-Doc runs on are case-insensitive.
 * @inputs names - The folder's file names as reported by the filesystem; references - the set of referenced file names produced by attachmentReferences().
 * @outputs A new array containing each input name that is not present (case-insensitively) in `references`, preserving original casing and order.
 * @dataflow Input names → per-name lower-casing → membership test against a lower-cased copy of references → kept names returned in original form.
 * @controlflow Build a lower-cased set of references, then filter names keeping only those whose lower-case form is absent from that set.
 */
export function unusedAttachments(names: readonly string[], references: ReadonlySet<string>): readonly string[] {
  const referencedLower = new Set<string>();
  for (const reference of references) {
    // Lower-case every referenced name so the membership test below ignores case.
    referencedLower.add(reference.toLowerCase());
  }

  return names.filter((name: string): boolean => {
    const lowerName = name.toLowerCase();
    if (referencedLower.has(lowerName)) {
      // This file is referenced somewhere in the document: exclude it from the unused list.
      return false;
    } else {
      // No reference points at this file: keep it as an unused attachment.
      return true;
    }
  });
}
