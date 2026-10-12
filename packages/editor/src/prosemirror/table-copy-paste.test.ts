// @vitest-environment jsdom
/**
 * @file table-copy-paste.test.ts
 * @purpose Verifies copied tables become TSV and that table paste mode reads TSV, CSV and HTML tables (FR-8.24).
 * @inputs ProseMirror documents and clipboard strings.
 * @outputs vitest assertions.
 * @functions
 *   - tableDoc: Builds a table document node from a 2D grid of string rows.
 *   - editorWith: Creates an EditorView mounted on the DOM for the given document.
 *   - tableGrid: Extracts the first table in the doc as a 2D grid of cell text.
 * @dataflow slice -> clipboardText; clipboard strings -> pasteContent -> doc.
 * @controlflow afterEach destroys views; each test asserts copied and pasted content.
 * @version 1
 * @date 2026-09-15
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { clipboardText, tableRowsAsTsv } from './table-tsv.js';
import { canPasteAsTable, pasteContent } from './clipboard.js';

const views: EditorView[] = [];

afterEach((): void => {
  for (const view of views) { view.destroy(); }
  views.length = 0;
  document.body.replaceChildren();
});

/**
 * Builds a table document node from a grid of string rows.
 * @purpose Constructs a ProseMirror `table` node with one `tableRow` per row and a `tableCell` per cell, leaving empty cells empty.
 * @inputs rows - A 2D array of strings; each inner array is one row's cell contents.
 * @outputs ProseMirrorNode - The constructed table document node.
 * @dataflow rows -> mapped row nodes -> table node with alignment attribute.
 * @controlflow Map each row to a tableRow, then wrap in a table; defaults alignment to null per column.
 * @version 1
 * @date 2026-09-15
 */
function tableDoc(rows: readonly (readonly string[])[]): ProseMirrorNode {
  const rowNodes = rows.map((row) => kdocSchema.node('tableRow', null, row.map((text) => (text === '' ? kdocSchema.node('tableCell', null, []) : kdocSchema.node('tableCell', null, [kdocSchema.text(text)])))));
  return kdocSchema.node('table', { align: rows[0]?.map(() => null) ?? [] }, rowNodes);
}

/**
 * Creates an EditorView mounted on the DOM for the given document.
 * @purpose Instantiates a ProseMirror view bound to a fresh mount element and tracks it for teardown.
 * @inputs doc - The document node the editor should render.
 * @outputs EditorView - A mounted, interactive editor view registered in `views`.
 * @dataflow doc -> EditorState.create -> EditorView state.
 * @controlflow Create mount element, append to body, construct view; returns it after registration.
 * @version 1
 * @date 2026-09-15
 */
function editorWith(doc: ProseMirrorNode): EditorView {
  const mount = document.createElement('div');
  document.body.append(mount);
  const view = new EditorView(mount, { state: EditorState.create({ doc, schema: kdocSchema }) });
  views.push(view);
  return view;
}

/**
 * Extracts the first table in the doc as a 2D grid of cell text.
 * @purpose Walks the document and captures the first `table` node's rows and cells into a string grid.
 * @inputs view - The editor view whose document is inspected.
 * @outputs string[][] | null - The grid, or null if no table exists in the document.
 * @dataflow doc descendants -> first table node -> nested row/cell text -> grid.
 * @controlflow Descend until a table is found; set grid and stop (return false); otherwise continue returning true.
 * @version 1
 * @date 2026-09-15
 */
function tableGrid(view: EditorView): string[][] | null {
  let grid: string[][] | null = null;
  view.state.doc.descendants((node) => {
    // Stop at the first table node and capture its rows/cells.
    if (grid === null && node.type.name === 'table') {
      const rows: string[][] = [];
      node.forEach((row) => { const cells: string[] = []; row.forEach((cell) => { cells.push(cell.textContent); }); rows.push(cells); });
      grid = rows;
      return false;
    } else {
      // Not the target table yet: keep descending.
      return true;
    }
  });
  return grid;
}

describe('copying a table as tab-separated values', () => {
  const table = tableDoc([['Name', 'Note'], ['Ada', 'tab\there'], ['Bo', '']]);

  it('writes a whole table as one line per row', () => {
    expect(clipboardText(new Slice(Fragment.from(table), 0, 0))).toBe('Name\tNote\nAda\ttab here\nBo\t');
  });
  it('writes copied rows and copied cells', () => {
    const rows: ProseMirrorNode[] = [];
    table.forEach((row) => { rows.push(row); });
    expect(tableRowsAsTsv(Fragment.fromArray(rows.slice(1)))).toBe('Ada\ttab here\nBo\t');
    const header = rows[0];
    // Guard against an empty row list; throw when no header exists, otherwise proceed.
    if (header === undefined) { throw new Error('no header'); } else { }
    const cells: ProseMirrorNode[] = [];
    header.forEach((cell) => { cells.push(cell); });
    expect(tableRowsAsTsv(Fragment.fromArray(cells))).toBe('Name\tNote');
  });
  it('leaves other content as paragraph text', () => {
    const paragraphs = Fragment.fromArray([kdocSchema.node('paragraph', null, [kdocSchema.text('one')]), kdocSchema.node('paragraph', null, [kdocSchema.text('two')])]);
    expect(tableRowsAsTsv(paragraphs)).toBeNull();
    expect(clipboardText(new Slice(paragraphs, 0, 0))).toBe('one\n\ntwo');
    expect(tableRowsAsTsv(Fragment.empty)).toBeNull();
    expect(tableRowsAsTsv(Fragment.fromArray([table, kdocSchema.node('paragraph', null, [kdocSchema.text('after')])]))).toBeNull();
  });
});

describe('table paste mode', () => {
  const empty = (): ProseMirrorNode => kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [])]);

  it('reads tab-separated text', () => {
    const view = editorWith(empty());
    expect(pasteContent(view, '', 'a\tb\nc\td', 'table')).toBe(true);
    expect(tableGrid(view)).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('reads comma-separated text', () => {
    const view = editorWith(empty());
    expect(pasteContent(view, '', 'name,age\n"Lovelace, Ada",36\n', 'table')).toBe(true);
    expect(tableGrid(view)).toEqual([['name', 'age'], ['Lovelace, Ada', '36']]);
  });
  it('prefers the text grid over the HTML', () => {
    const view = editorWith(empty());
    expect(pasteContent(view, '<table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>2</td></tr></table>', 'a\tb\nc\td', 'table')).toBe(true);
    expect(tableGrid(view)).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('reads the first HTML table when the text is not a grid, keeping formatting', () => {
    const view = editorWith(empty());
    const html = '<p>intro</p><table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td><strong>A</strong></td><td>B</td></tr></tbody></table>';
    expect(pasteContent(view, html, 'H1 H2 A B', 'table')).toBe(true);
    expect(tableGrid(view)).toEqual([['H1', 'H2'], ['A', 'B']]);
    let strong = false;
    view.state.doc.descendants((node) => { // Flag when a `strong` mark is present anywhere in the doc.
      if (node.marks.some((mark) => mark.type.name === 'strong')) { strong = true; } else { }
    });
    expect(strong).toBe(true);
  });
  it('offers table mode exactly when a table would be pasted', () => {
    expect(canPasteAsTable('', 'a\tb')).toBe(true);
    expect(canPasteAsTable('', 'a,b\nc,d')).toBe(true);
    expect(canPasteAsTable('<table><tr><td>1</td><td>2</td></tr></table>', 'one two')).toBe(true);
    expect(canPasteAsTable('<p>just words</p>', 'just words')).toBe(false);
    expect(canPasteAsTable('', '')).toBe(false);
  });
  it('refuses prose with no grid and no HTML table', () => {
    const view = editorWith(empty());
    expect(pasteContent(view, '<p>just words</p>', 'just words', 'table')).toBe(false);
    expect(tableGrid(view)).toBeNull();
  });
});