/**
 * @file portable.ts
 * @purpose Carries comment threads inside the document itself as HTML comments (FR-6.22, FR-10.6), so one .md file can be sent to someone who does not share the folder the comments normally live in. Markdown renderers ignore HTML comments, so a bundled file still reads as the document it was.
 * @inputs the document text and the threads to carry
 * @outputs text with a bundle in it, or the threads read back out of one
 * @functions
 *   - bundleComments: Appends a comment bundle carrying the given threads to a document.
 *   - extractComments: Reads comment threads out of a document and returns the cleaned text.
 *   - hasCommentBundle: Reports whether a document carries a comment bundle.
 * @dataflow threads -> JSON -> one HTML comment per thread inside a marked block appended to the text; and back
 * @controlflow a line that cannot be read is skipped and reported rather than failing the whole file, because one corrupt comment must not cost the reader the rest
 * @version 1
 * @date 2026-09-16
 */

import type { CommentThread } from './thread.js';

/**
 * Marks the opening of the comment bundle block inside a document.
 * @purpose Opening delimiter that brackets bundled HTML comments so bundling replaces the previous block and extraction knows what to remove.
 * @inputs None; a literal marker string consumed by bundleRange, bundleComments, and extractComments.
 * @outputs None; used as part of the marked block written into or read from document text.
 * @dataflow Marker → embedded in document text between body content and bundled comment lines.
 * @controlflow Appended first when bundling, located first when extracting a bundle's range.
 */
export const BUNDLE_START: string = '<!-- kdoc:comments -->';

/**
 * Marks the closing of the comment bundle block inside a document.
 * @purpose Closing delimiter that brackets bundled HTML comments so bundling replaces the previous block and extraction knows what to remove.
 * @inputs None; a literal marker string consumed by bundleRange, bundleComments, and extractComments.
 * @outputs None; used as part of the marked block written into or read from document text.
 * @dataflow Marker → appended after bundled comment lines when bundling, located last when extracting a bundle's range.
 * @controlflow Appended last when bundling, matched by searching from the start marker when extracting.
 */
export const BUNDLE_END: string = '<!-- /kdoc:comments -->';

/**
 * Prefix of each bundled thread line, turning a JSON thread into an HTML comment.
 * @purpose Opens one HTML comment per thread so each carries its JSON payload and Markdown renderers ignore it.
 * @inputs None; a literal marker string consumed by bundleComments (to open) and extractComments (to detect).
 * @outputs None; prepended to each thread's JSON when bundling, matched at the start of each line when extracting.
 * @dataflow Prefix → placed before a thread's JSON inside the marked block.
 * @controlflow Written first on each comment line when bundling, used with slice offsets when extracting.
 */
export const COMMENT_PREFIX: string = '<!-- kdoc:comment ';

/**
 * Suffix of each bundled thread line, closing the HTML comment that holds a thread's JSON.
 * @purpose Closes one HTML comment per thread so its JSON is valid markup and Markdown renderers ignore it.
 * @inputs None; a literal marker string consumed by bundleComments (to close) and extractComments (to detect).
 * @outputs None; appended after each thread's JSON when bundling, matched at the end of each line when extracting.
 * @dataflow Suffix → placed after a thread's JSON inside the marked block.
 * @controlflow Written last on each comment line when bundling, used with slice offsets when extracting.
 */
export const COMMENT_SUFFIX: string = ' -->';

/**
 * Result of reading comments out of a document.
 * @purpose Carries the document text with its bundle removed alongside the threads that were read and any lines that could not be read.
 * @inputs None; produced by extractComments from a bundled document.
 * @outputs The cleaned text, the valid threads parsed from it, and human-readable problem notes for skipped lines.
 * @dataflow Document text → bundle stripped to `text`, comment lines parsed into `threads`, unreadable lines recorded in `problems`.
 * @controlflow Returned after scanning every line of a found bundle; empty arrays when no bundle is present.
 */
export interface ExtractedComments {
  readonly text: string;
  readonly threads: readonly CommentThread[];
  readonly problems: readonly string[];
}

function bundleRange(text: string): { readonly start: number; readonly end: number } | null {
  const start = text.indexOf(BUNDLE_START);
  // No start marker means the document has no bundle to extract.
  if (start === -1) {
    return null;
  } else {
    // The block begins here, so continue searching for its end from this position.
  }
  const endMarker = text.indexOf(BUNDLE_END, start);
  // Searching from `start` means an end marker before the start is not treated as this block's end.
  if (endMarker === -1) {
    // A block with no end is ignored rather than guessed at, because guessing where it ends risks deleting the document.
    return null;
  } else {
    // Both markers are present, so the range can be returned.
  }
  return { start, end: endMarker + BUNDLE_END.length };
}

/**
 * Reports whether a document carries a comment bundle.
 * @purpose Lets a caller decide before offering to import or re-bundle, without mutating the text.
 * @inputs text - The full document whose bundle presence is being tested.
 * @outputs boolean - True when both bundle markers are present in order, false otherwise.
 * @dataflow Document text → bundleRange lookup → presence flag.
 * @controlflow Returns true only when a start marker and a later end marker both exist; false on any missing marker.
 */
export function hasCommentBundle(text: string): boolean {
  return bundleRange(text) !== null;
}

function withoutBundle(text: string): string {
  const range = bundleRange(text);
  // Without a bundle, the text is returned unchanged.
  if (range === null) {
    return text;
  } else {
    // A bundle exists, so remove it and tidy the surrounding blank lines that travel with it.
  }
  const before = text.slice(0, range.start).replace(/\n+$/, '');
  const after = text.slice(range.end).replace(/^\n+/, '');
  if (after.length === 0) {
    // Nothing follows the bundle: keep only a single trailing newline when there is preceding text.
    return before.length === 0 ? '' : `${before}\n`;
  } else {
    // Text follows the bundle: separate it from the preceding text with a blank line.
    return `${before}\n\n${after}`;
  }
}

function isThread(value: unknown): value is CommentThread {
  if (typeof value !== 'object' || value === null) {
    // A thread must be a non-null object, so reject primitives and null.
    return false;
  } else {
    // It is an object, so inspect its fields below.
  }
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    // The id must be a non-empty string to identify the thread.
    return false;
  } else {
    // The id is valid, so continue checking the remaining fields.
  }
  if (typeof record['anchor'] !== 'object' || record['anchor'] === null) {
    // The anchor must be an object to locate the commented region.
    return false;
  } else {
    // The anchor is present, so continue checking the remaining fields.
  }
  if (!Array.isArray(record['comments'])) {
    // Comments must be an array of replies.
    return false;
  } else {
    // The comments array is present, so continue checking the remaining fields.
  }
  if (typeof record['resolved'] !== 'boolean') {
    // The resolved flag must be a boolean to reflect whether the thread is closed.
    return false;
  } else {
    // All required fields are valid, so this is a well-formed thread.
  }
  return true;
}

/**
 * Appends a comment bundle carrying the given threads to a document.
 * @purpose Embeds each thread as an HTML comment so a single .md file can travel with its own comments (FR-6.22, FR-10.6).
 * @inputs text - The full document to attach the bundle to. threads - The threads to carry inside the bundle.
 * @outputs string - The document with any previous bundle removed and a fresh block of bundled comments appended.
 * @dataflow Threads → JSON per thread → one HTML comment per line inside a marked block appended after the body.
 * @controlflow Strip any existing bundle first; skip building a block when there are no threads; append the block with blank lines around it.
 */
export function bundleComments(text: string, threads: readonly CommentThread[]): string {
  const body = withoutBundle(text);
  if (threads.length === 0) {
    // No threads means no block at all rather than an empty one.
    return body;
  } else {
    // Threads are present, so build the bundle block to append below.
  }

  const lines = threads.map((thread) => `${COMMENT_PREFIX}${JSON.stringify(thread)}${COMMENT_SUFFIX}`);
  const block = [BUNDLE_START, ...lines, BUNDLE_END].join('\n');
  if (body.length === 0) {
    // The document is empty: the bundle stands alone with a trailing newline.
    return `${block}\n`;
  } else {
    // Append the bundle to the existing text with blank lines around it.
    return `${body.replace(/\n+$/, '')}\n\n${block}\n`;
  }
}

/**
 * Reads comment threads out of a document and returns the cleaned text.
 * @purpose Pulls bundled HTML comments back into structured threads so they can be re-saved in their normal store (FR-6.22, FR-10.6).
 * @inputs text - The full document whose bundle is being read.
 * @outputs ExtractedComments - The text with the bundle removed, the valid threads parsed out, and notes on any lines that could not be read.
 * @dataflow One HTML comment per thread inside a marked block → JSON parse per line → structured threads (or problem notes).
 * @controlflow Locate the bundle; skip non-comment lines silently; report unreadable or malformed lines rather than failing the whole file.
 */
export function extractComments(text: string): ExtractedComments {
  const range = bundleRange(text);
  // Without a bundle, there are no threads to read.
  if (range === null) {
    return { text, threads: [], problems: [] };
  } else {
    // A bundle exists, so parse the comments it carries below.
  }

  const threads: CommentThread[] = [];
  const problems: string[] = [];
  const block = text.slice(range.start, range.end);
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(COMMENT_PREFIX) || !trimmed.endsWith(COMMENT_SUFFIX)) {
      // A line that is not a bundled comment (a blank line, the markers themselves) is skipped silently.
      continue;
    } else {
      // The line is a bundled comment, so parse its payload below.
    }
    const payload = trimmed.slice(COMMENT_PREFIX.length, trimmed.length - COMMENT_SUFFIX.length);
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isThread(parsed)) {
        threads.push(parsed);
      } else {
        // A comment missing fields is reported so the reader knows a thread was lost.
        problems.push('A bundled comment was missing fields and was skipped.');
      }
    } catch {
      // A comment that cannot be read is reported rather than failing the whole file.
      problems.push('A bundled comment could not be read and was skipped.');
    }
  }

  return { text: withoutBundle(text), threads, problems };
}
