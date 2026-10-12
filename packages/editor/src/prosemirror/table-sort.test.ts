// @vitest-environment jsdom
/**
 * @file table-sort.test.ts
 * @purpose Verifies column kind detection, sort order and the sort command (FR-8.23).
 * @inputs tables built from string grids
 * @outputs vitest assertions
 * @functions
 *   - tableDoc: builds a ProseMirror doc from a string grid.
 *   - stateFor: creates an EditorState with a caret at a given row/column.
 *   - gridOf: reads the current table back into a string grid.
 *   - run: applies a sort command to a grid and returns whether it applied.
 * @dataflow grid -> doc -> command -> grid
 * @controlflow describe per unit
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { dateValue, detectColumnKind, numberValue, sortOrder, sortTableByColumn, type SortDirection } from './table-sort.js';

/**
 * Builds a ProseMirror document containing a single table.
 * @purpose Wraps a 2D string grid into the kdoc schema as doc > table > tableRow > tableCell.
 * @inputs rows - nested arrays of cell text; empty strings become empty cells.
 * @outputs ProseMirrorNode - the constructed document node.
 * @dataflow string grid -> schema nodes -> document node.
 * @controlflow Map each row to a tableRow, each cell to a tableCell, then wrap in a doc.
 */
function tableDoc(rows: readonly (readonly string[])[]): ProseMirrorNode {
  const rowNodes = rows.map((row) => kdocSchema.node('tableRow', null, row.map((text) => (text === '' ? kdocSchema.node('tableCell', null, []) : kdocSchema.node('tableCell', null, [kdocSchema.text(text)])))));
  return kdocSchema.node('doc', null, [kdocSchema.node('table', { align: rows[0]?.map(() => null) ?? [] }, rowNodes)]);
}

/**
 * Creates an EditorState with the caret positioned at a specific cell.
 * @purpose Computes the absolute position of the cell at (row, column) and builds a selection there.
 * @inputs doc - document to build the state from; row - zero-based row index; column - zero-based column index.
 * @outputs EditorState - state whose selection points at the target cell.
 * @dataflow doc + indices -> absolute position -> TextSelection -> EditorState.
 * @controlflow Walk rows and cells summing node sizes to reach the target, then create the selection.
 */
function stateFor(doc: ProseMirrorNode, row: number, column: number): EditorState {
  const table = doc.firstChild;
  // If the document has no table child, there is nothing to position in.
  if (table === null) { throw new Error('no table'); } else { }
  let pos = 1;
  for (let r = 0; r < row; r += 1) { pos += table.child(r).nodeSize; }
  pos += 1;
  const target = table.child(row);
  for (let c = 0; c < column; c += 1) { pos += target.child(c).nodeSize; }
  pos += 1;
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos), schema: kdocSchema });
}

/**
 * Reads the table in a state back into a plain string grid.
 * @purpose Extracts each cell's text content for assertion against expected grids.
 * @inputs state - editor state whose document contains a single table.
 * @outputs string[][] - rows of cell text contents.
 * @dataflow state.doc -> table -> rows -> cells -> text strings.
 * @controlflow Iterate rows then cells, pushing each cell's textContent into the grid.
 */
function gridOf(state: EditorState): string[][] {
  const table = state.doc.firstChild;
  // If the document has no table child, there is nothing to read back.
  if (table === null) { throw new Error('no table'); } else { }
  const grid: string[][] = [];
  table.forEach((row) => { const cells: string[] = []; row.forEach((cell) => { cells.push(cell.textContent); }); grid.push(cells); });
  return grid;
}

/**
 * Applies a sort command to a freshly built grid.
 * @purpose Drives the full round-trip: build doc, place caret, dispatch the command, capture result.
 * @inputs rows - string grid; row/column - caret position; direction - ascending or descending.
 * @outputs { applied, state } - whether the sort ran and the resulting editor state.
 * @dataflow grid -> doc -> state -> transaction -> updated state.
 * @controlflow Build state, run the command with a dispatch that stores each applied transaction.
 */
function run(rows: readonly (readonly string[])[], row: number, column: number, direction: SortDirection): { applied: boolean; state: EditorState } {
  let state = stateFor(tableDoc(rows), row, column);
  const applied = sortTableByColumn(direction)(state, (tr: Transaction): void => { state = state.apply(tr); });
  return { applied, state };
}

describe('numberValue', () => {
  it('reads spreadsheet numbers and refuses anything else', () => {
    expect(numberValue('1,234.5')).toBe(1234.5);
    expect(numberValue(' -$3 ')).toBe(-3);
    expect(numberValue('12%')).toBe(12);
    expect(numberValue('+7')).toBe(7);
    expect(numberValue('€ 40')).toBe(40);
    expect(numberValue('1.2.3')).toBeNull();
    expect(numberValue('12a')).toBeNull();
    expect(numberValue('1,23')).toBeNull();
    expect(numberValue('')).toBeNull();
    // Too many digits for a double: Number gives Infinity, which is no value to sort by.
    expect(numberValue('9'.repeat(400))).toBeNull();
  });
});

describe('dateValue', () => {
  it('reads ISO and named dates and refuses impossible or ambiguous ones', () => {
    expect(dateValue('2026-09-15')).toBe(Date.UTC(2026, 8, 15));
    expect(dateValue('2026/9/5')).toBe(Date.UTC(2026, 8, 5));
    expect(dateValue('2026-09-15T10:30')).toBe(Date.UTC(2026, 8, 15, 10, 30));
    expect(dateValue('2026-09-15 10:30:45')).toBe(Date.UTC(2026, 8, 15, 10, 30, 45));
    expect(dateValue('15 Sep 2026')).toBe(Date.UTC(2026, 8, 15));
    expect(dateValue('September 15, 2026')).toBe(Date.UTC(2026, 8, 15));
    expect(dateValue('Sep. 15 2026')).toBe(Date.UTC(2026, 8, 15));
    expect(dateValue('2026-02-30')).toBeNull();
    expect(dateValue('2026-09-15T24:00')).toBeNull();
    expect(dateValue('2026-09-15T10:60')).toBeNull();
    expect(dateValue('2026-09-15T10:30:60')).toBeNull();
    expect(dateValue('Smarch 3 2026')).toBeNull();
    expect(dateValue('15/09/2026')).toBeNull();
  });
});

describe('detectColumnKind', () => {
  it('ignores empty cells and needs every filled cell to agree', () => {
    expect(detectColumnKind(['3', '', '10'])).toBe('number');
    expect(detectColumnKind(['2026-01-02', '5 Mar 2025'])).toBe('date');
    expect(detectColumnKind(['3', 'three'])).toBe('text');
    expect(detectColumnKind(['2026-01-02', 'soon'])).toBe('text');
    expect(detectColumnKind(['', ' '])).toBe('text');
  });
});

describe('sortOrder', () => {
  it('sorts numbers by value with empty cells last in both directions', () => {
    expect(sortOrder(['10', '9', '', '100'], 'ascending')).toEqual([1, 0, 3, 2]);
    expect(sortOrder(['10', '9', '', '100'], 'descending')).toEqual([3, 0, 1, 2]);
    expect(sortOrder(['', 'b', '', 'a'], 'ascending')).toEqual([3, 1, 0, 2]);
  });
  it('sorts decimals, negatives and currency by value, not as text', () => {
    expect(sortOrder(['1.5', '1.25', '-3', '$2'], 'ascending')).toEqual([2, 1, 0, 3]);
  });
  it('keeps several empty cells in their order after the filled ones', () => {
    expect(sortOrder(['', '', 'a', '', ''], 'ascending')).toEqual([2, 0, 1, 3, 4]);
    expect(sortOrder(['', '', 'a', '', ''], 'descending')).toEqual([2, 0, 1, 3, 4]);
  });
  it('sorts dates by time', () => {
    expect(sortOrder(['2026-03-01', '1 Jan 2026', '2025-12-31'], 'ascending')).toEqual([2, 1, 0]);
  });
  it('sorts text naturally, ignoring case, and keeps equal values in their order', () => {
    expect(sortOrder(['item 10', 'item 9'], 'ascending')).toEqual([1, 0]);
    expect(sortOrder(['b', 'A', 'a'], 'ascending')).toEqual([1, 2, 0]);
    expect(sortOrder(['b', 'A', 'a'], 'descending')).toEqual([0, 1, 2]);
  });
});

describe('sortTableByColumn', () => {
  const rows = [['Name', 'Score'], ['Cy', '9'], ['Ada', '100'], ['Bo', '']];

  it('keeps the header first and sorts the body by the caret column', () => {
    const { applied, state } = run(rows, 1, 1, 'descending');
    expect(applied).toBe(true);
    expect(gridOf(state)).toEqual([['Name', 'Score'], ['Ada', '100'], ['Cy', '9'], ['Bo', '']]);
  });

  it('moves the caret with its row', () => {
    const { state } = run(rows, 1, 0, 'ascending');
    expect(gridOf(state).map((row) => row[0])).toEqual(['Name', 'Ada', 'Bo', 'Cy']);
    const cell = state.selection.$from.node(state.selection.$from.depth);
    expect(cell.textContent).toBe('Cy');
  });

  it('keeps the caret in the header when sorting from it', () => {
    const { state } = run(rows, 0, 0, 'ascending');
    expect(state.selection.$from.node(state.selection.$from.depth).textContent).toBe('Name');
  });

  it('refuses when already sorted, with fewer than two body rows, or outside a table', () => {
    expect(run([['H'], ['a'], ['b']], 1, 0, 'ascending').applied).toBe(false);
    expect(run([['H'], ['a']], 1, 0, 'ascending').applied).toBe(false);
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('x')])]);
    expect(sortTableByColumn('ascending')(EditorState.create({ doc, schema: kdocSchema }))).toBe(false);
  });

  it('reports applicability without a dispatch', () => {
    const state = stateFor(tableDoc(rows), 1, 0);
    expect(sortTableByColumn('ascending')(state)).toBe(true);
    expect(gridOf(state)).toEqual(rows);
  });
});