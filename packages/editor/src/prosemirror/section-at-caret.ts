/**
 * @file section-at-caret.ts
 * @purpose Finds which top-level heading section holds the WYSIWYG caret, as an index into the document outline, for commands that act on the section at the caret such as Split Document at Heading (FR-8.31).
 * @inputs state - The EditorState whose doc and selection are inspected to locate the caret's block.
 * @outputs number - Outline index of the top-level heading section containing the caret, or -1 when the caret precedes the first heading.
 * @functions sectionIndexAtCaret - Counts top-level heading children up to and including the caret's block.
 * @dataflow selection -> top-level child index -> count of top-level headings up to it -> outline index.
 * @controlflow Clamp the caret's parent block index, iterate top-level children counting headings up to that block, then return the count minus one.
 * @version 1
 * @date 2026-09-16
 */

import type { EditorState } from 'prosemirror-state';

/**
 * @purpose Returns the outline index of the top-level heading section holding the caret.
 * @inputs state - The editor state.
 * @outputs number - The outline index, or -1 before the first heading.
 * @dataflow selection -> top-level block index -> headings counted up to it -> index.
 * @controlflow Clamp the block index, count headings among the top-level blocks up to it, subtract one.
 */
export function sectionIndexAtCaret(state: EditorState): number {
  const { doc, selection } = state;
  // index(0) is the block containing the caret; at the very end of the document it equals childCount, hence the clamp.
  const caretChild = Math.min(selection.$from.index(0), doc.childCount - 1);
  let headings = 0;
  for (let i = 0; i <= caretChild; i += 1) {
    // Check whether the current top-level child is a heading node.
    if (doc.child(i).type.name === 'heading') {
      // Top-level heading found: increment the running count of headings seen so far.
      headings += 1;
    } else {
      // Non-heading top-level block: leave the heading count unchanged.
    }
  }
  // K-Doc's outline lists only top-level headings, in order, so the n-th top-level heading node is outline entry n-1;
  // a result of -1 means the caret is before the first heading.
  return headings - 1;
}
