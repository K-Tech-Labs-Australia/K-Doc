/**
 * @file note-index.ts
 * @purpose Pure extraction turning Markdown note text into an index entry for search, backlinks, and tag panels (FR-6.12, FR-8.12, FR-14.6, FR-14.7).
 * @inputs Source file path, relative file path, and raw Markdown note text string.
 * @outputs NoteIndexEntry containing resolved title, outline headings, inline and wiki links, distinct lower-cased tags, and front-matter record.
 * @functions
 *   - extractTags: Scans Markdown text for hashtags, skipping code spans and returning distinct tags in first-appearance order.
 *   - extractWikiLinks: Scans Markdown text for wikilinks ([[target]] and [[target|alias]]), skipping code spans.
 *   - extractInlineLinks: Recursively traverses mdast syntax tree to collect inline link and image targets.
 *   - noteTitle: Resolves the note title using front-matter title, first level-1 heading, or file name fallback.
 *   - indexNote: Coordinates Markdown parsing, outline derivation, link extraction, tag scanning, and title resolution into a NoteIndexEntry.
 * @dataflow Markdown text → parseMarkdown (KdocDocument) → buildOutline & frontMatter → extractInlineLinks (mdast) + extractWikiLinks (text) → extractTags (text) → noteTitle resolution → NoteIndexEntry.
 * @controlflow Parse document → derive outline headings → extract front-matter data → extract links (inline + wiki) → extract tags → resolve title → assemble NoteIndexEntry.
 * @version 1
 * @date 2026-09-12
 */

import { parseMarkdown } from '../parse/parser.js';
import { buildOutline } from '../outline/outline.js';
import type { OutlineEntry } from '../outline/outline.js';
import type { Root, RootContent } from 'mdast';

/** How a note referred to another. */
export type NoteLinkKind = 'inline' | 'wiki';

/** One reference from a note to somewhere else. */
export interface NoteLink {
  readonly kind: NoteLinkKind;
  /** The target exactly as written: a URL, a relative path, or a wikilink target. */
  readonly target: string;
  /** The line the reference sits on, trimmed. Backlinks quote this (FR-6.13). */
  readonly context: string;
  /** Offset of the reference in the note's text. */
  readonly offset: number;
}

/** Everything the index knows about one note. */
export interface NoteIndexEntry {
  readonly path: string;
  readonly relative: string;
  /** Front-matter `title`, else the first level-1 heading, else the file name without its extension. */
  readonly title: string;
  readonly headings: readonly OutlineEntry[];
  readonly links: readonly NoteLink[];
  /** Tag words without the `#`, lower-cased, distinct, in first-appearance order. */
  readonly tags: readonly string[];
  readonly frontMatter: Readonly<Record<string, unknown>>;
}

/**
 * Matches hashtag tokens in Markdown source text.
 * - `(^|[\\s(\\[])`: A tag starts at the beginning of a line or after whitespace or an opening bracket,
 *   so `a#b` and a URL's `#fragment` are not tags.
 * - `#`: Literal hash marker introducing the tag word.
 * - `([\\p{L}\\p{N}][\\p{L}\\p{N}_\\/-]*)`: The tag body. The first character after `#` must be a letter
 *   or a digit, so `# heading` and `#!shebang` are not tags. Forward slash `/` is allowed inside so
 *   `#work/urgent` is one nested tag, which is how every Markdown app that has tags writes them.
 *
 * Skip heading note: CommonMark headings require a space after `#` (or multiple `#` followed by space).
 * The pattern's requirement of a letter/digit immediately after `#` already covers the space case,
 * avoiding the need for a redundant heading test.
 *
 * Read with String.prototype.matchAll, never exec. matchAll iterates a clone, so this shared instance
 * never carries a lastIndex between calls and there is nothing to reset.
 */
const TAG_RE = /(^|[\s(\[])#([\p{L}\p{N}][\p{L}\p{N}_\/-]*)/gu;

/**
 * Matches wikilink references in Markdown source text: `[[target]]` and `[[target|alias]]`.
 * - `\\[\\[`: Opening double bracket delimiter.
 * - `([^\\]|\\n]+)`: Capture group 1 matching the link target up to a pipe, closing bracket, or newline.
 * - `(?:\\|[^\\]\\n]*)?`: Optional pipe followed by display alias text up to closing bracket or newline.
 * - `\\]\\]`: Closing double bracket delimiter.
 */
const WIKI_LINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;

/**
 * Matches fenced code blocks delimited by three or more backticks (```) or tildes (~~~) at line starts.
 * Used by `codeSpans` to exclude code blocks from tag and link scanning.
 * - `(?<=^|\\n)`: Preceded by line start or newline (zero-width assertion to retain exact offsets).
 * - `[ \\t]{0,3}`: Up to three indentation spaces per CommonMark specification.
 * - `(`{3,}|~{3,})`: Opening fence of 3+ backticks or tildes.
 * - `[^\\r\\n]*`: Optional info string / language tag on opening fence line.
 * - `(?:\\r?\\n[\\s\\S]*?(?:\\r?\\n[ \\t]{0,3}\\1+[ \\t]*(?:\\r?\\n|$)|$)|$)`: Fenced block body
 *   terminated by matching closing fence on its own line, or end of file if unclosed.
 */
const FENCED_CODE_RE = /(?<=^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n[\s\S]*?(?:\r?\n[ \t]{0,3}\1+[ \t]*(?:\r?\n|$)|$)|$)/g;

/**
 * Matches inline code spans delimited by matching runs of backticks.
 * Used by `codeSpans` to exclude inline code from tag and link scanning.
 * - `(`+)`: Opening run of one or more backticks.
 * - `([\\s\\S]*?)`: Lazy code span body.
 * - `\\1(?!`)`: Matching closing run of backticks not followed by another backtick.
 */
const INLINE_CODE_RE = /(`+)([\s\S]*?)\1(?!`)/g;

/**
 * Source offset span identifying character range boundaries [from, to).
 */
interface CodeSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * Returns the whole line containing character offset in source text, trimmed of leading and trailing whitespace.
 *
 * @purpose Extracts the trimmed line containing a character offset to serve as the quote context for backlinks (FR-6.13).
 * @inputs text - The full Markdown source text string.
 * @inputs offset - The 0-based character offset into the source text.
 * @outputs string - The trimmed line of text containing the offset.
 * @dataflow Source text + offset → clamp offset → locate previous and next newlines → slice line substring → trim whitespace → context string.
 * @controlflow Check text length → clamp offset to [0, text.length] → find previous newline before offset → find next newline at/after offset → slice text between boundaries → trim and return.
 */
function lineAt(text: string, offset: number): string {
  // Check if source text is empty.
  if (text.length === 0) {
    // Empty text contains no line content: return empty string.
    return '';
  } else {
    // Non-empty text: proceed with line boundary resolution.
  }

  // Clamp offset to [0, text.length] to ensure safe index operations.
  const safeOffset = Math.max(0, Math.min(offset, text.length));

  // Find the previous newline before safeOffset to determine the start of the line.
  const prevNewline = safeOffset > 0 ? text.lastIndexOf('\n', safeOffset - 1) : -1;
  const start = prevNewline === -1 ? 0 : prevNewline + 1;

  // Find the next newline at or after safeOffset to determine the end of the line.
  const nextNewline = text.indexOf('\n', safeOffset);
  const end = nextNewline === -1 ? text.length : nextNewline;

  // Slice the containing line between previous and next newlines, then trim whitespace.
  // A backlink is only useful if it shows the sentence it was found in (FR-6.13).
  return text.slice(start, end).trim();
}

/**
 * Returns the character offset ranges covered by fenced code blocks and inline code spans in Markdown text.
 *
 * @purpose Identifies source ranges covered by code blocks and inline code so tag and link scanners can skip them.
 * @inputs text - The Markdown source text string to scan for code spans.
 * @outputs readonly CodeSpan[] - Readonly array of CodeSpan objects with [from, to) offset ranges.
 * @dataflow Source text → FENCED_CODE_RE scan → fenced spans → mask fenced spans with spaces → INLINE_CODE_RE scan → inline spans → sort spans by start offset → return CodeSpan array.
 * @controlflow Check text length → scan fenced code blocks → build masked string replacing fenced blocks with spaces → scan inline code backticks in masked string → combine spans → sort by start offset → return spans.
 */
function codeSpans(text: string): readonly CodeSpan[] {
  // Check if source text is empty.
  if (text.length === 0) {
    // Empty text contains no code spans: return empty array.
    return [];
  } else {
    // Non-empty text: scan for fenced blocks and inline code.
  }

  const spans: CodeSpan[] = [];

  // Scan text for fenced code blocks (``` or ~~~ fences at a line start).
  // #include in a C snippet is not a tag, and a URL fragment in a code sample is not a link.
  // matchAll iterates a clone, so these shared patterns carry no state between calls.
  for (const match of text.matchAll(FENCED_CODE_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    spans.push({ from, to });
  }

  // Build a masked copy of the text replacing fenced code regions with space characters.
  // This prevents the inline code regex from matching backticks inside code blocks or across fences,
  // while preserving exact character count and offset coordinates for inline spans.
  let maskedText = '';
  let lastIndex = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    // Check if span is defined under strict index access.
    if (span !== undefined) {
      maskedText += text.slice(lastIndex, span.from) + ' '.repeat(span.to - span.from);
      lastIndex = span.to;
    } else {
      // Undefined span entry: continue loop.
    }
  }
  maskedText += text.slice(lastIndex);

  // Scan masked text for inline code spans delimited by runs of backticks.
  for (const match of maskedText.matchAll(INLINE_CODE_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    spans.push({ from, to });
  }

  // Sort collected code spans in ascending order of their start offset.
  spans.sort((a: CodeSpan, b: CodeSpan): number => a.from - b.from);

  return spans;
}

/**
 * Tests whether a given character offset falls within any of the provided code spans.
 *
 * @purpose Checks if a character offset is contained inside any code span range [from, to).
 * @inputs spans - Readonly array of CodeSpan objects with [from, to) boundaries.
 * @inputs offset - The 0-based character offset to test.
 * @outputs boolean - True if the offset is inside at least one span; false otherwise.
 * @dataflow spans + offset → linear iteration → range containment check (offset >= from && offset < to) → boolean result.
 * @controlflow Loop through spans → check span containment → return true on first hit → return false if no span contains offset.
 */
function inAnySpan(spans: readonly CodeSpan[], offset: number): boolean {
  // Iterate through all code spans to check if the offset falls within [from, to).
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    // Check if the span is defined and contains the offset in half-open interval [from, to).
    if (span !== undefined && offset >= span.from && offset < span.to) {
      // Offset falls within this code span: return true.
      return true;
    } else {
      // Offset falls outside this span; continue checking remaining spans.
    }
  }

  // Offset does not fall within any code span: return false.
  return false;
}

/**
 * Scans Markdown source text for hashtags, skipping code spans and returning distinct tags in first-appearance order.
 *
 * @purpose Extracts distinct, lower-cased hashtag words from Markdown source text without the leading '#' marker.
 * @inputs text - The raw Markdown source text string.
 * @outputs readonly string[] - Readonly array of distinct, lower-cased tag words in order of first appearance.
 * @dataflow Markdown text → codeSpans extraction → TAG_RE regex scan → filter code spans → normalize to lower-case → deduplicate with Set → tag array.
 * @controlflow Check text length → compute codeSpans → reset TAG_RE.lastIndex → iterate regex matches → skip if inAnySpan → lower-case tag → add if unseen → return tags array.
 */
export function extractTags(text: string): readonly string[] {
  // Check if source text is empty.
  if (text.length === 0) {
    // Empty text contains no tags: return empty array immediately.
    return [];
  } else {
    // Non-empty text: proceed with code span analysis and tag scanning.
  }

  const spans = codeSpans(text);
  const seen = new Set<string>();
  const tags: string[] = [];

  // matchAll iterates over a clone of the pattern, so this shared instance carries no lastIndex
  // between calls and needs no reset. exec would have, and a reset that the loop's own exhaustion
  // already performs is a defence that can never fire.
  for (const match of text.matchAll(TAG_RE)) {
    const prefix = match[1] ?? '';
    const hashOffset = (match.index ?? 0) + prefix.length;

    // Check if the hash character offset falls within a fenced block or inline code span.
    if (inAnySpan(spans, hashOffset)) {
      // Skip tags inside code spans (#include in C or code sample is not a tag).
      continue;
    } else {
      // Tag is in prose: proceed with extraction.
    }

    const rawTag = match[2];
    // Check if capture group 2 (the tag text without the hash) is defined.
    if (rawTag !== undefined) {
      // Lower-case the tag word for case-insensitive normalization.
      const lowerTag = rawTag.toLowerCase();

      // Check if this tag has already been recorded to maintain distinct tags in first-appearance order.
      if (!seen.has(lowerTag)) {
        // First occurrence: record in seen set and append to result list.
        seen.add(lowerTag);
        tags.push(lowerTag);
      } else {
        // Duplicate tag: skip to maintain first-appearance uniqueness.
      }
    } else {
      // Group 2 is undefined under strict index access: skip.
    }
  }

  return tags;
}

/**
 * Scans Markdown source text for wikilinks ([[target]] and [[target|alias]]), skipping code spans.
 *
 * @purpose Extracts wikilink references from Markdown text, recording kind, trimmed target, context line, and offset.
 * @inputs text - The raw Markdown source text string.
 * @outputs readonly NoteLink[] - Readonly array of NoteLink records representing all valid wikilinks in the text.
 * @dataflow Markdown text → codeSpans extraction → WIKI_LINK_RE scan → filter code spans → extract and trim target → lineAt context lookup → NoteLink array.
 * @controlflow Check text length → compute codeSpans → reset WIKI_LINK_RE.lastIndex → iterate regex matches → skip if inAnySpan → trim target (skip if empty) → create NoteLink with lineAt context → return links.
 */
export function extractWikiLinks(text: string): readonly NoteLink[] {
  // Check if source text is empty.
  if (text.length === 0) {
    // Empty text contains no wikilinks: return empty array immediately.
    return [];
  } else {
    // Non-empty text: proceed with code span analysis and wikilink scanning.
  }

  const spans = codeSpans(text);
  const links: NoteLink[] = [];

  // matchAll for the same reason as extractTags: a clone is iterated, so nothing is carried between calls.
  for (const match of text.matchAll(WIKI_LINK_RE)) {
    const start = match.index ?? 0;
    // Check if the wikilink match starts within a fenced code block or inline code span.
    if (inAnySpan(spans, start)) {
      // Wikilink syntax inside code: skip.
      continue;
    } else {
      // Wikilink is in prose: proceed with extraction.
    }

    const rawTarget = match[1];
    // Check if capture group 1 (target) is defined.
    if (rawTarget !== undefined) {
      const target = rawTarget.trim();

      // Skip a match whose trimmed target is empty (e.g. [[]] or [[ |alias]]).
      if (target.length === 0) {
        // Target is empty after trimming: skip this invalid link.
        continue;
      } else {
        // Target is non-empty: record the wikilink reference.
        links.push({
          kind: 'wiki',
          target,
          context: lineAt(text, start),
          offset: start,
        });
      }
    } else {
      // Group 1 is undefined under strict index access: skip.
    }
  }

  return links;
}

/**
 * Recursively walks an mdast syntax tree to collect inline Markdown link and image references.
 *
 * @purpose Extracts all standard Markdown links and images from an mdast Root, skipping empty URLs.
 * @inputs root - The parsed mdast Root syntax tree to traverse.
 * @inputs text - The raw Markdown source text string used for line context extraction.
 * @outputs readonly NoteLink[] - Readonly array of NoteLink records representing all inline links and images.
 * @dataflow mdast Root + source text → recursive walk traversing node hierarchy → match 'link' | 'image' → extract url, position offset & lineAt context → NoteLink array.
 * @controlflow Initialize links array → define recursive walk helper → traverse tree nodes starting from root → inspect node.type → append NoteLink if url non-empty → guard and recurse into children → return links array.
 */
export function extractInlineLinks(root: Root, text: string): readonly NoteLink[] {
  const links: NoteLink[] = [];

  /**
   * Recursively walks mdast nodes collecting link and image references.
   *
   * @purpose Recursively traverses mdast syntax tree to extract inline links and images.
   * @inputs node - Current mdast Root or RootContent node to inspect.
   * @outputs void.
   * @dataflow mdast Node → inspect node.type for 'link' | 'image' → extract url & position → append to links → recurse into children.
   * @controlflow Check node.type → if link/image with non-empty url, extract position and push NoteLink → guard 'children' in node → loop over children calling walk.
   */
  function walk(node: RootContent | Root): void {
    // Check if the node is an inline link or image.
    if (node.type === 'link' || node.type === 'image') {
      const resource = node as { readonly url?: string };

      // Check if node has a non-empty destination URL string.
      if (typeof resource.url === 'string' && resource.url.length > 0) {
        // Offset comes from node position start offset, falling back to 0 if position is missing.
        const offset = node.position?.start?.offset ?? 0;
        const context = lineAt(text, offset);

        links.push({
          kind: 'inline',
          target: resource.url,
          context,
          offset,
        });
      } else {
        // Skip node whose url is empty or undefined.
      }
    } else {
      // Non-link, non-image node: continue traversal.
    }

    // Guard children access with 'children' in node.
    // Not every mdast node has children (e.g. leaf nodes like Text, InlineCode, Break)
    // and reading children on one that does not is how an AST walk crashes on a real document.
    if ('children' in node && Array.isArray((node as { readonly children?: unknown }).children)) {
      const parent = node as { readonly children: readonly (RootContent | Root)[] };
      // Iterate over child nodes recursively.
      for (const child of parent.children) {
        walk(child as RootContent);
      }
    } else {
      // Leaf node without children: end of current branch traversal.
    }
  }

  walk(root);
  return links;
}

/**
 * Resolves the display title of a note according to a three-tier fallback hierarchy.
 *
 * Priority order:
 * 1. Front-matter `title` property when it is a non-empty string after trimming.
 * 2. The first level-1 heading (depth === 1), when its plain text is non-empty after trimming.
 * 3. The file name from `relative` (the part after the last `/`) with trailing Markdown extensions
 *    (`.md`, `.markdown`, `.mdown`) removed, case-insensitively.
 *
 * @purpose Determines a human-readable title for a note with deterministic fallbacks.
 * @inputs relative - The relative file path of the note within its vault.
 * @inputs frontMatter - The front-matter data dictionary extracted from the note.
 * @inputs headings - Readonly array of OutlineEntry items representing top-level headings.
 * @outputs string - The resolved display title for the note.
 * @dataflow relative path + frontMatter data + outline headings → test frontMatter title → test level-1 headings → parse file name from relative path → return resolved title string.
 * @controlflow Inspect frontMatter.title → return trimmed string if non-empty → iterate headings for first depth === 1 → return trimmed heading text if non-empty → normalize relative path → extract file name after last slash → strip .md/.markdown/.mdown → return file name title.
 */
export function noteTitle(
  relative: string,
  frontMatter: Readonly<Record<string, unknown>>,
  headings: readonly OutlineEntry[],
): string {
  // 1. Fallback 1: front-matter 'title' property when it is a non-empty string after trimming.
  const fmTitle = frontMatter['title'];
  // Check if frontMatter has a string 'title' property.
  if (typeof fmTitle === 'string') {
    const trimmedTitle = fmTitle.trim();
    // Check if the trimmed front-matter title is non-empty.
    if (trimmedTitle.length > 0) {
      // Non-empty front-matter title: use as note title.
      return trimmedTitle;
    } else {
      // Front-matter title is empty after trimming; proceed to next fallback.
    }
  } else {
    // No front-matter string title present; proceed to next fallback.
  }

  // 2. Fallback 2: The first heading with depth === 1, when its text is non-empty after trimming.
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    // Check if heading is defined under strict index access and is a top-level heading (depth === 1).
    if (heading !== undefined && heading.depth === 1) {
      const trimmedHeading = heading.text.trim();
      // Check if the heading text is non-empty after trimming.
      if (trimmedHeading.length > 0) {
        // Non-empty depth-1 heading text: use as note title.
        return trimmedHeading;
      } else {
        // Level-1 heading is empty whitespace; ignore and continue checking.
      }
    } else {
      // Heading is undefined or depth is not 1; continue search.
    }
  }

  // 3. Fallback 3: The file name from `relative` — the part after the last `/` — with
  // a trailing `.md`, `.markdown` or `.mdown` removed, case-insensitively.
  // A note with neither front-matter title nor a level-1 heading is still a note,
  // and showing its file name is better than showing "Untitled" in a list of twenty.
  const normalizedPath = relative.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const rawFileName = lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);

  // Remove trailing .md, .markdown, or .mdown extension case-insensitively.
  const titleFromFileName = rawFileName.replace(/\.(?:md|markdown|mdown)$/i, '');

  return titleFromFileName;
}

/**
 * Turns one note's text into an index entry for search, backlinks, and tag panels.
 *
 * @purpose Assembles a complete NoteIndexEntry containing title, headings, links, tags, and front matter.
 * @inputs path - Absolute or vault-relative canonical path of the note.
 * @inputs relative - Relative file path of the note inside the vault (e.g. "subfolder/note.md").
 * @inputs text - The raw Markdown source text string of the note.
 * @outputs NoteIndexEntry - Complete note index record for search, backlinks, and tag panels.
 * @dataflow Markdown text → parseMarkdown (doc) → buildOutline (headings) → frontMatter extraction → extractInlineLinks + extractWikiLinks → noteTitle resolution → extractTags → NoteIndexEntry assembly.
 * @controlflow Parse markdown to KdocDocument → extract outline headings → extract front-matter data dictionary → extract and merge inline and wiki links → resolve note title → extract distinct tags → return NoteIndexEntry object.
 */
export function indexNote(path: string, relative: string, text: string): NoteIndexEntry {
  // Parse source text into canonical KdocDocument AST container.
  const doc = parseMarkdown(text);

  // Extract top-level heading outline entries from the parsed document.
  const headings = buildOutline(doc);

  // Extract front matter dictionary data or default to empty record.
  const frontMatter = doc.frontMatter?.data ?? {};

  // Extract all links: inline markdown links and images from AST, plus wikilinks from source text.
  const links = [...extractInlineLinks(doc.root, text), ...extractWikiLinks(text)];

  // Resolve note title following the priority chain (frontMatter title -> level-1 heading -> file name).
  const title = noteTitle(relative, frontMatter, headings);

  // Extract all distinct hashtags in first-appearance order, excluding code blocks.
  const tags = extractTags(text);

  return {
    path,
    relative,
    title,
    headings,
    links,
    tags,
    frontMatter,
  };
}
