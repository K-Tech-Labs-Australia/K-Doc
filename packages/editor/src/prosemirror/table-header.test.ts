// @vitest-environment jsdom
/**
 * @file table-header.test.ts
 * @purpose Verifies the header-row toggle and the warnings for pipes and line breaks entered into table cells (FR-8.25).
 * @inputs tables built from string grids; transactions applied to editor states.
 * @outputs vitest assertions verifying grid contents, header presence, and escape-warning kinds.
 * @functions
 *   - cell: Builds a tableCell node containing the given text or empty when text is blank.
 *   - tableDoc: Wraps a string grid into a doc node with a table followed by a paragraph.
 *   - positionIn: Computes a resolved position for a given row and column in a table fixture.
 *   - stateAt: Creates an EditorState positioned at a specific cell of the grid.
 *   - gridOf: Reads text content out of a table as a 2D string array.
 *   - toggle: Applies the header-row toggle command once, returning whether it applied and the next state.
 *   - edit: Runs a transaction under the escape-warning plugin and reports detected kinds.
 * @dataflow grid -> state -> command or transaction -> grid, kinds.
 * @controlflow describe per feature; each it() builds a fixture, runs a command or transaction, then asserts.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { hasHeaderRow, headerRowIsEmpty, toggleHeaderRow } from './table-header.js';
import { createTableEscapeWarningPlugin, escapeKindsIn, TABLE_ESCAPE_MESSAGES, type TableEscapeKind } from './table-escape-warnings.js';

// Builds a tableCell node containing the given text.
// @purpose Creates a tableCell node whose text content matches the input string.
// @inputs text - The string to place inside the cell; an empty string yields an empty cell.
// @outputs ProseMirrorNode - A tableCell node, or one with no children when text is blank.
// @dataflow text string -> tableCell node (with a text child) or empty tableCell node.
// @controlflow Returns an empty cell for '' to satisfy ProseMirror's no-empty-text rule; otherwise wraps the text in a cell.
function cell(text: string): ProseMirrorNode {
  // An empty string gives an empty cell: ProseMirror refuses empty text nodes.
  if (text === '') {
    return kdocSchema.node('tableCell', null, []);
  } else {
    return kdocSchema.node('tableCell', null, [kdocSchema.text(text)]);
  }
}

// Wraps a string grid into a doc fixture containing a table and a trailing paragraph.
// @purpose Assembles a complete document node from rows of cells plus an "after" paragraph.
// @inputs rows - A readonly array of rows, each a readonly array of cell strings.
// @outputs ProseMirrorNode - A doc node whose first child is the table and second is a paragraph.
// @dataflow string grid -> row nodes -> table node -> doc node.
// @controlflow Maps each row to a tableRow; aligns columns from the first row; appends a trailing paragraph.
function tableDoc(rows: readonly (readonly string[])[]): ProseMirrorNode {
  const rowNodes = rows.map((row) => kdocSchema.node('tableRow', null, row.map(cell)));
  return kdocSchema.node('doc', null, [kdocSchema.node('table', { align: rows[0]?.map(() => null) ?? [] }, rowNodes), kdocSchema.node('paragraph', null, [kdocSchema.text('after')])]);
}

// Computes a resolved position for a given row and column inside a table fixture.
// @purpose Derives the absolute document offset of a cell caret using node sizes.
// @inputs doc - The document whose first child is the table; row and column - Zero-based indices into the table grid.
// @outputs number - The resolved position offset for the requested cell.
// @dataflow doc, row, column -> cumulative node sizes -> absolute position.
// @controlflow Throws when no table exists; sums row node sizes, steps past the open brace, then sums column node sizes before returning.
function positionIn(doc: ProseMirrorNode, row: number, column: number): number {
  const table = doc.firstChild;
  // The fixture always starts with a table.
  if (table === null) {
    throw new Error('no table');
  } else {
    let pos = 1;
    for (let r = 0; r < row; r += 1) { pos += table.child(r).nodeSize; }
    pos += 1;
    const target = table.child(row);
    for (let c = 0; c < column; c += 1) { pos += target.child(c).nodeSize; }
    return pos + 1;
  }
}

// Creates an EditorState positioned at a specific cell of the grid.
// @purpose Builds an editor state whose selection sits in the requested cell.
// @inputs rows - The string grid; row and column - Zero-based indices into that grid; plugins - Optional editor plugins.
// @outputs EditorState - An editor state with the doc, schema, selection, and plugins wired together.
// @dataflow grid -> doc -> position -> TextSelection -> EditorState.
// @controlflow Builds the fixture doc, resolves the cell position, then constructs the state in one expression.
function stateAt(rows: readonly (readonly string[])[], row: number, column: number, plugins: EditorState['plugins'] = []): EditorState {
  const doc = tableDoc(rows);
  return EditorState.create({ doc, selection: TextSelection.create(doc, positionIn(doc, row, column)), schema: kdocSchema, plugins: [...plugins] });
}

// Reads text content out of a table as a 2D string array.
// @purpose Flattens each row's cells into their textContent for assertion comparison.
// @inputs state - The editor state whose doc begins with the table to read.
// @outputs string[][] - A grid mirroring the table layout, one entry per cell.
// @dataflow table node -> rows -> cells -> textContent strings.
// @controlflow Iterates rows then cells, pushing each cell's text into a row array; tolerates a missing table with an optional chain.
function gridOf(state: EditorState): string[][] {
  const table = state.doc.firstChild;
  const grid: string[][] = [];
  table?.forEach((row) => { const cells: string[] = []; row.forEach((c) => { cells.push(c.textContent); }); grid.push(cells); });
  return grid;
}

// Applies the header-row toggle command once and returns its result.
// @purpose Invokes toggleHeaderRow against a state and captures whether it applied plus the next state.
// @inputs state - The editor state to run the command on.
// @outputs { applied, next } - Whether the command modified the state and the resulting EditorState.
// @dataflow state -> transaction -> next state; boolean flag from the command.
// @controlflow Applies the command through a closure that assigns next, then returns both values.
function toggle(state: EditorState): { applied: boolean; next: EditorState } {
  let next = state;
  const applied = toggleHeaderRow()(state, (tr: Transaction): void => { next = state.apply(tr); });
  return { applied, next };
}

describe('the header row toggle', () => {
  it('turns a header off by adding an empty header row above it', () => {
    const { applied, next } = toggle(stateAt([['Name', 'Age'], ['Ada', '36']], 1, 1));
    expect(applied).toBe(true);
    expect(gridOf(next)).toEqual([['', ''], ['Name', 'Age'], ['Ada', '36']]);
    expect(hasHeaderRow(next)).toBe(false);
    expect(next.selection.$from.parent.textContent).toBe('36');
  });

  it('turns it back on by removing the empty header row', () => {
    const off = toggle(stateAt([['Name', 'Age'], ['Ada', '36']], 0, 0)).next;
    expect(off.selection.$from.parent.textContent).toBe('Name');
    const { applied, next } = toggle(off);
    expect(applied).toBe(true);
    expect(gridOf(next)).toEqual([['Name', 'Age'], ['Ada', '36']]);
    expect(hasHeaderRow(next)).toBe(true);
    expect(next.selection.$from.parent.textContent).toBe('Name');
  });

  it('keeps a caret that was in the empty header in the new header', () => {
    const { next } = toggle(stateAt([['', ''], ['Name', 'Age']], 0, 1));
    expect(gridOf(next)).toEqual([['Name', 'Age']]);
    expect(next.selection.$from.parent.textContent).toBe('Age');
  });

  it('refuses a table that is only an empty header row, and outside a table', () => {
    expect(toggleHeaderRow()(stateAt([['', '']], 0, 0))).toBe(false);
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('x')])]);
    const plain = EditorState.create({ doc, schema: kdocSchema });
    expect(toggleHeaderRow()(plain)).toBe(false);
    expect(hasHeaderRow(plain)).toBeNull();
  });

  it('counts a header with any content as a header', () => {
    const table = tableDoc([['', 'x'], ['a', 'b']]).firstChild;
    const empty = tableDoc([['', ''], ['a', 'b']]).firstChild;
    expect(table === null ? null : headerRowIsEmpty(table)).toBe(false);
    expect(empty === null ? null : headerRowIsEmpty(empty)).toBe(true);
  });
});

describe('warnings for content a table cell cannot hold as written', () => {
  // Runs a transaction under the escape-warning plugin and reports detected kinds.
  // @purpose Executes a build function on a fresh state wired to the warning plugin, collecting reported kinds.
  // @inputs state - The base editor state; build - A function that transforms a transaction.
  // @outputs { kinds, warned } - Kinds detected in the resulting transaction and kinds delivered to the callback.
  // @dataflow state -> new state with plugin -> built transaction -> kinds extracted + callback collected.
  // @controlflow Creates a plugin-backed state, applies the build, extracts escapeKindsIn, then returns both arrays.
  function edit(state: EditorState, build: (tr: Transaction) => Transaction): { kinds: TableEscapeKind[]; warned: TableEscapeKind[] } {
    const warned: TableEscapeKind[] = [];
    const withPlugin = EditorState.create({ doc: state.doc, selection: state.selection, schema: kdocSchema, plugins: [createTableEscapeWarningPlugin((kind) => { warned.push(kind); })] });
    const tr = build(withPlugin.tr);
    const kinds = escapeKindsIn(tr);
    withPlugin.applyTransaction(tr);
    return { kinds, warned };
  }

  it('reports a pipe typed into a cell', () => {
    const state = stateAt([['a', 'b'], ['c', 'd']], 1, 0);
    expect(edit(state, (tr) => tr.insertText('x|y'))).toEqual({ kinds: ['pipe'], warned: ['pipe'] });
  });

  it('reports a hard break and a pasted line feed in a cell', () => {
    const state = stateAt([['a', 'b'], ['c', 'd']], 1, 0);
    const hardBreak = kdocSchema.nodes['hardBreak'];
    if (hardBreak === undefined) {
      throw new Error('schema has no hardBreak');
    } else {
      expect(edit(state, (tr) => tr.replaceSelectionWith(hardBreak.create())).kinds).toEqual(['line-break']);
    }
    expect(edit(state, (tr) => tr.insertText('one\ntwo|')).kinds).toEqual(['pipe', 'line-break']);
  });

  it('says nothing about pipes outside a table, deletions, or selection changes', () => {
    const state = stateAt([['a', 'b'], ['c', 'd']], 1, 0);
    const end = state.doc.content.size - 1;
    expect(edit(state, (tr) => tr.insertText('x|y', end)).warned).toEqual([]);
    expect(edit(state, (tr) => tr.delete(positionIn(state.doc, 1, 0), positionIn(state.doc, 1, 0) + 1)).warned).toEqual([]);
    expect(edit(state, (tr) => tr.setSelection(TextSelection.create(tr.doc, end))).warned).toEqual([]);
  });

  it('ignores formatting applied in a cell, which enters no content', () => {
    const state = stateAt([['a|b', 'c'], ['d', 'e']], 0, 0);
    const strong = kdocSchema.marks['strong'];
    if (strong === undefined) {
      throw new Error('schema has no strong mark');
    } else {
      const from = positionIn(state.doc, 0, 0);
      expect(edit(state, (tr) => tr.addMark(from, from + 3, strong.create())).warned).toEqual([]);
    }
  });

  it('reports each kind once for a transaction that enters it twice', () => {
    const state = stateAt([['a', 'b'], ['c', 'd']], 1, 0);
    expect(edit(state, (tr) => tr.insertText('|').insertText('|')).warned).toEqual(['pipe']);
  });

  it('words the messages for the person typing', () => {
    expect(TABLE_ESCAPE_MESSAGES.pipe).toBe('A | in a table cell is saved as \\| so the table stays intact.');
    expect(TABLE_ESCAPE_MESSAGES['line-break']).toContain('saved as a space');
  });
});