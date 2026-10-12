/**
 * @file section-at-caret.test.ts
 * @purpose Verifies that sectionIndexAtCaret maps a ProseMirror caret position to the correct outline entry index, including edge cases around quoted headings and document end.
 * @inputs DOC sample markdown fixture; caretAfter helper producing EditorState instances with the caret positioned after a given needle string.
 * @outputs Assertion results via vitest expect() against buildOutline output and sectionIndexAtCaret return values.
 * @functions
 *   - caretAfter: Builds an EditorState whose TextSelection sits immediately after the first occurrence of needle in the parsed document.
 *   - describe/it: Vitest test runner scaffolding for the sectionIndexAtCaret suite.
 * @dataflow Markdown string → parseMarkdown → buildOutline/mdastToProseMirror → EditorState with selection → sectionIndexAtCaret → outline index number.
 * @controlflow For each it() block, construct a document fixture, position the caret via caretAfter, then assert the resolved section index matches expectations; assertions fail fast on mismatch.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { buildOutline, parseMarkdown } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { sectionIndexAtCaret } from './section-at-caret.js';

const DOC = 'Lead.\n\n# Title\n\n> ## Quoted\n\n## One\n\n- item\n\n## Two\n';

// Build an EditorState whose caret is placed immediately after the first occurrence of needle.
// Parses the markdown into a ProseMirror doc, walks descendants to locate needle within a text node,
// and constructs a TextSelection at that offset; returns early once the needle is found (guard returns pos < 0).
function caretAfter(markdown: string, needle: string): EditorState {
  const doc = mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text !== undefined && node.text.includes(needle)) {
      pos = at + node.text.indexOf(needle) + needle.length;
    }
    return pos < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

describe('sectionIndexAtCaret', () => {
  // Headings inside a quote are not outline entries, so a caret there stays in the section above.
  it('names the outline entry of the section holding the caret', () => {
    const outline = buildOutline(parseMarkdown(DOC));
    expect(outline.map((entry) => entry.text)).toEqual(['Title', 'One', 'Two']);
    expect(sectionIndexAtCaret(caretAfter(DOC, 'Lead'))).toBe(-1);
    expect(sectionIndexAtCaret(caretAfter(DOC, 'Title'))).toBe(0);
    expect(sectionIndexAtCaret(caretAfter(DOC, 'Quoted'))).toBe(0);
    expect(sectionIndexAtCaret(caretAfter(DOC, 'item'))).toBe(1);
    expect(sectionIndexAtCaret(caretAfter(DOC, 'Two'))).toBe(2);
  });

  // The end of the document is past the last block.
  it('handles a caret at the very end of the document', () => {
    const state = caretAfter(DOC, 'Two');
    const end = EditorState.create({ doc: state.doc, selection: TextSelection.atEnd(state.doc) });
    expect(sectionIndexAtCaret(end)).toBe(2);
    // A position after the last block, as a gap cursor after a final table would have.
    const after = EditorState.create({ doc: state.doc, selection: new TextSelection(state.doc.resolve(state.doc.content.size)) });
    expect(sectionIndexAtCaret(after)).toBe(2);
  });
});
