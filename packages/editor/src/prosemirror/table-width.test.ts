// @vitest-environment jsdom
/**
 * @file table-width.test.ts
 * @purpose Verifies the column width hint command, its round trip through mdast, and that column moves carry it (FR-8.26).
 * @inputs Markdown fixtures and editor states.
 * @outputs vitest assertions.
 * @functions
 *   - stateIn: Builds an EditorState from markdown with the caret positioned on a target text node.
 *   - headerHints: Reads each header cell's widthHint attribute as number | null.
 * @dataflow Markdown -> ProseMirror -> command -> mdast -> Markdown.
 * @controlflow describe per unit; each it asserts one behavior of the column width hint feature.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { columnWidthHintAt, MAX_WIDTH_HINT, parseWidthHint, setColumnWidthHint } from './table-width.js';
import { moveColumnTo } from './table-reorder.js';

/**
 * @purpose Builds an EditorState whose document comes from markdown, placing the caret on a text node matching `text`.
 * @inputs markdown - source Markdown parsed into a ProseMirror document; text - target text to locate for the selection.
 * @outputs EditorState - state with doc and a TextSelection anchored at the located position.
 * @dataflow Markdown -> parseMarkdown -> mdastToProseMirror -> doc -> TextSelection.create -> EditorState.create.
 * @controlflow Locate first matching text node via descendants; throw if absent, else build and return the state.
 */
function stateIn(markdown: string, text: string): EditorState {
  const doc = mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
  let pos = -1;
  doc.descendants((node, nodePos) => {
    // Record the position of the first text node whose content equals `text`.
    if (pos === -1 && node.isText && node.text === text) { pos = nodePos; } else { /* Not a match: keep searching. */ }
    return pos === -1;
  });
  // No matching text node exists: fail loudly rather than build an invalid selection.
  if (pos === -1) { throw new Error(`no text ${text}`); } else { /* Position found: build the state with the caret anchored here. */ return EditorState.create({ doc, selection: TextSelection.create(doc, pos), schema: kdocSchema }); }
}

/**
 * @purpose Reads the widthHint attribute from each header cell, normalizing non-numbers to null.
 * @inputs state - editor state whose first child is a table with a header row of cells.
 * @outputs (number | null)[] - one entry per header cell: its numeric hint or null when unset.
 * @dataflow state.doc -> firstChild (table) -> firstChild (header row) -> each cell.attrs.widthHint -> number | null.
 * @controlflow Walk the header cells in order, pushing a parsed hint for each; no branching beyond the ternary below.
 */
function headerHints(state: EditorState): (number | null)[] {
  const hints: (number | null)[] = [];
  state.doc.firstChild?.firstChild?.forEach((cell) => {
    // widthHint is stored as a number when set, otherwise the attribute is absent.
    const hint: unknown = cell.attrs['widthHint'];
    // Numeric value means an explicit column width; anything else falls back to automatic (null).
    hints.push(typeof hint === 'number' ? hint /* numeric hint: report it */ : null /* no numeric hint: automatic (null) */);
  });
  return hints;
}

const HINTED = '| a | b |\n| --------- | - |\n| x | y |\n';

describe('width hints through the editor', () => {
  it('puts parsed hints on the header cells and reads them back unchanged', () => {
    const state = stateIn(HINTED, 'x');
    expect(headerHints(state)).toEqual([9, null]);
    const root = proseMirrorToMdast(state.doc);
    expect(serializeDocument({ text: '', root, frontMatter: null })).toBe('| a         | b |\n| --------- | - |\n| x         | y |\n');
  });
  it('writes no data for a table without hints', () => {
    const state = stateIn('| a | b |\n| - | - |\n| x | y |\n', 'x');
    const table = proseMirrorToMdast(state.doc).children[0];
    // A table node carries its raw markdown in `data`; non-table nodes are excluded from this assertion.
    expect(table?.type === 'table' ? table.data /* table node: inspect its data */ : 'not a table' /* not a table: value irrelevant to assertion */).toBeUndefined();
  });
  it('renders a hinted header cell with a minimum width', () => {
    const state = stateIn(HINTED, 'x');
    const dom = DOMSerializer.fromSchema(kdocSchema).serializeFragment(state.doc.content);
    const cells = [...dom.querySelectorAll('td')].map((cell) => cell.getAttribute('style'));
    expect(cells).toEqual(['min-width: 9ch;', null, null, null]);
  });
});

describe('setColumnWidthHint', () => {
  function run(state: EditorState, width: number | null): { applied: boolean; next: EditorState } {
    let next = state;
    const applied = setColumnWidthHint(width)(state, (tr: Transaction): void => { next = state.apply(tr); });
    return { applied, next };
  }

  it('sets the hint of the caret column from any row, and clears it', () => {
    const set = run(stateIn('| a | b |\n| - | - |\n| x | y |\n', 'y'), 12);
    expect(set.applied).toBe(true);
    expect(headerHints(set.next)).toEqual([null, 12]);
    expect(columnWidthHintAt(set.next)).toBe(12);
    expect(set.next.selection.$from.parent.textContent).toBe('y');
    const cleared = run(set.next, null);
    expect(cleared.applied).toBe(true);
    expect(headerHints(cleared.next)).toEqual([null, null]);
  });

  it('saves a set hint as dashes', () => {
    const { next } = run(stateIn('| a | b |\n| - | - |\n| x | y |\n', 'x'), 4);
    expect(serializeDocument({ text: '', root: proseMirrorToMdast(next.doc), frontMatter: null })).toBe('| a    | b |\n| ---- | - |\n| x    | y |\n');
  });

  it('refuses an unchanged width, an out-of-range width, and a caret outside a table', () => {
    const state = stateIn(HINTED, 'x');
    expect(run(state, 9).applied).toBe(false);
    expect(setColumnWidthHint(0)(state)).toBe(false);
    expect(setColumnWidthHint(MAX_WIDTH_HINT + 1)(state)).toBe(false);
    expect(setColumnWidthHint(MAX_WIDTH_HINT)(state)).toBe(true);
    expect(setColumnWidthHint(2.5)(state)).toBe(false);
    const paragraph = stateIn('Just text.\n', 'Just text.');
    expect(setColumnWidthHint(5)(paragraph)).toBe(false);
    expect(columnWidthHintAt(paragraph)).toBeUndefined();
  });

  it('has no hint to read or set in a column the header row does not reach', () => {
    const cell = (text: string) => kdocSchema.node('tableCell', null, [kdocSchema.text(text)]);
    const table = kdocSchema.node('table', { align: [null] }, [kdocSchema.node('tableRow', null, [cell('h')]), kdocSchema.node('tableRow', null, [cell('a'), cell('extra')])]);
    const doc = kdocSchema.node('doc', null, [table]);
    let pos = -1;
    doc.descendants((node, nodePos) => {
      // Find the text of the cell beyond the header's reach.
      if (pos === -1 && node.isText && node.text === 'extra') {
        pos = nodePos;
      } else {
        // Not it: keep looking.
      }
      return pos === -1;
    });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos), schema: kdocSchema });
    expect(columnWidthHintAt(state)).toBeUndefined();
    expect(setColumnWidthHint(5)(state)).toBe(false);
  });

  it('moves with its column', () => {
    let state = stateIn(HINTED, 'x');
    const moved = moveColumnTo(0, 1)(state, (tr: Transaction): void => { state = state.apply(tr); });
    expect(moved).toBe(true);
    expect(headerHints(state)).toEqual([null, 9]);
  });
});

describe('parseWidthHint', () => {
  it('reads whole numbers in range, empty as automatic, and refuses the rest', () => {
    expect(parseWidthHint(' 12 ')).toBe(12);
    expect(parseWidthHint('')).toBeNull();
    expect(parseWidthHint('   ')).toBeNull();
    expect(parseWidthHint('1')).toBe(1);
    expect(parseWidthHint(String(MAX_WIDTH_HINT))).toBe(MAX_WIDTH_HINT);
    expect(parseWidthHint('0')).toBe('invalid');
    expect(parseWidthHint(String(MAX_WIDTH_HINT + 1))).toBe('invalid');
    expect(parseWidthHint('2.5')).toBe('invalid');
    expect(parseWidthHint('wide')).toBe('invalid');
    expect(parseWidthHint('-3')).toBe('invalid');
  });
});