/**
 * @file split-merge.ts
 * @purpose Splits a heading section out of a document and merges another document onto the end of one, for FR-8.31, working on source text so every byte outside the edit is kept.
 * @inputs source text, outline entries, a caret offset, a parsed source document.
 * @outputs a SplitResult, the merged text, a section index.
 * @functions
 *   - sectionIndexAtOffset: returns the section index at a caret offset.
 *   - splitSection: removes one heading section from the text.
 *   - withoutFrontMatter: strips leading front matter from a parsed document.
 *   - mergeDocumentText: joins a source body onto target text.
 * @dataflow outline entries + offset -> section index -> outlineSectionRange -> section text and remaining text; target text + parsed document -> body without front matter -> joined text.
 * @controlflow each function validates its input and returns null, -1 or the unchanged target when there is nothing to do.
 * @version 1
 * @date 2026-09-16
 */

import type { KdocDocument } from '../ast/types.js';
import type { OutlineEntry } from './outline.js';
import { outlineSectionRange } from './move-section.js';

/**
 * Result of splitting a heading section out of a document.
 * @field remaining - the document with the section taken out.
 * @field section - the heading line and its subtree, ending in one newline.
 * @field title - the heading's plain text.
 */
export interface SplitResult {
  readonly remaining: string;
  readonly section: string;
  readonly title: string;
}

/**
 * @purpose Returns the index of the last heading that starts at or before the given offset, i.e. the section the caret sits in, or -1 when the offset precedes the first heading.
 * @inputs entries - outline entries in document order; offset - caret character offset into source text.
 * @outputs number - index of the matching entry, or -1 when no heading starts at or before the offset.
 * @dataflow entries + offset -> sequential scan comparing entry.start to offset -> last qualifying index.
 * @controlflow Iterate entries in order; update found for each entry starting at or before the offset.
 */
export function sectionIndexAtOffset(entries: readonly OutlineEntry[], offset: number): number {
  let found = -1;
  for (const entry of entries) {
    // Heading starts at or before the caret: record its index and keep scanning forward.
    if (entry.start <= offset) {
      found = entry.index;
    } else {
      // Heading starts after the caret: not the caret's section, and neither is any later one.
    }
  }
  return found;
}

/**
 * @purpose Removes a single heading section from the source text and returns it together with the remaining document.
 * @inputs text - full source document; entries - outline entries covering the document; index - section index to remove.
 * @outputs SplitResult | null - { remaining, section, title }, or null when the index is out of range.
 * @dataflow entries + index -> outlineSectionRange -> slice section and surrounding text -> trimmed remainder.
 * @controlflow Resolve range and entry; return null when either is missing; otherwise build section/remaining/title.
 */
export function splitSection(text: string, entries: readonly OutlineEntry[], index: number): SplitResult | null {
  const range = outlineSectionRange(entries, index, text.length);
  const entry = entries[index];
  // Range or entry is unavailable (index out of bounds): nothing to split.
  if (range === null || entry === undefined) {
    return null;
  } else {
    // Both are present: proceed to extract the section and remaining text.
  }
  const section = `${text.slice(range.start, range.end).replace(/\s+$/, '')}\n`;
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  let remaining: string;
  // A later heading follows the removed section: join the surrounding text directly.
  if (after.length > 0) {
    remaining = before + after;
  } else {
    // Section ran to the end of the document: trim the blank lines left behind to a single newline. A document that
    // was only this section keeps that one newline, so the editor still has content for its caret.
    remaining = `${before.replace(/\s+$/, '')}\n`;
  }
  return { remaining, section, title: entry.text };
}

/**
 * @purpose Returns the document text with any leading front matter node removed.
 * @inputs document - parsed source document whose tree still contains the front matter node.
 * @outputs string - document text starting after the front matter, or the full text when there is none.
 * @dataflow document -> first child position end offset -> slice of document.text past that offset.
 * @controlflow Locate the first child's end offset; return sliced text only when it is a front matter node with a valid offset.
 */
export function withoutFrontMatter(document: KdocDocument): string {
  const first = document.root.children[0];
  const end = first?.position?.end.offset;
  // The first child is the yaml/toml front matter node (the parser reports front matter only there) and its end is known: drop it.
  if (first !== undefined && (first.type === 'yaml' || first.type === 'toml') && end !== undefined) {
    return document.text.slice(end);
  } else {
    // No front matter, or missing position data: return the text unchanged.
    return document.text;
  }
}

/**
 * @purpose Appends a source document's body onto the end of a target document as one merged string.
 * @inputs target - existing document text; source - parsed source document whose front matter is discarded.
 * @outputs string - target with the source body joined, or the unchanged target when the body is empty.
 * @dataflow source -> withoutFrontMatter -> trimmed body -> combined with target per emptiness rules.
 * @controlflow Build trimmed body; return target unchanged when empty, body alone when target is empty, else join with a blank line.
 */
export function mergeDocumentText(target: string, source: KdocDocument): string {
  const body = withoutFrontMatter(source).replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  // Source has no body: leave the target untouched.
  if (body.length === 0) {
    return target;
  } else if (target.trim().length === 0) {
    // Target is empty: the source body becomes the whole document.
    return `${body}\n`;
  } else {
    // Both are non-empty: separate them with exactly one blank line.
    return `${target.replace(/\s+$/, '')}\n\n${body}\n`;
  }
}
