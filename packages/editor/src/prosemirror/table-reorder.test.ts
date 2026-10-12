// @vitest-environment jsdom
/**
 * @file table-reorder.test.ts
 * @purpose Vitest test suite covering table duplicate/reorder commands and the grips plugin for GFM tables (FR-8.20).
 *   Verifies pure ProseMirror table row and column reordering, duplication, alignment preservation, and DOM drag-and-drop grips.
 * @inputs ProseMirror EditorState instances initialized with kdocSchema, table document nodes, and synthetic DOM drag events.
 * @outputs Vitest assertions verifying command execution, grid transformations, column alignments, and decoration lifecycle.
 * @functions
 *   - tableDoc: Builds a ProseMirror doc node enclosing a table with specified cell contents and column alignments.
 *   - stateFor: Creates an EditorState with a TextSelection placed inside a designated table cell.
 *   - gridOf: Extracts a 2D string grid of cell text contents from the table at document root.
 *   - alignOf: Returns the table node's align attribute from the document root.
 *   - runOn: Executes a command against an EditorState and returns the updated state or original state on failure.
 *   - mountWithGrips: Mounts an EditorView with the table grips plugin into a container element in document.body.
 * @dataflow String cell grids -> tableDoc -> EditorState -> table-reorder commands & table-grips plugin -> Vitest assertions.
 * @controlflow Test table reorder commands (duplicate, move, move-to, guards) -> test table grips plugin (render, drag-drop, rebuild, styles).
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  duplicateRow,
  duplicateColumn,
  moveRow,
  moveColumn,
  moveRowTo,
  moveColumnTo,
} from './table-reorder.js';
import {
  createTableGripsPlugin,
  TABLE_GRIP_ROW_CLASS,
  TABLE_GRIP_COLUMN_CLASS,
  TABLE_GRIP_STYLES,
} from './table-grips-plugin.js';

/**
 * Builds a ProseMirror document node containing a single table with the given cell contents and alignment.
 *
 * @purpose Constructs a valid ProseMirror document containing a table node with populated or empty cells.
 * @inputs
 *   - rows: readonly (readonly string[])[] - 2D grid of cell string contents.
 *   - align: readonly (string | null)[] - Optional column alignment vector.
 * @outputs ProseMirrorNode - The root doc node enclosing the built table.
 * @dataflow rows & align -> map to tableCell, tableRow, and table nodes -> wrap in doc node.
 * @controlflow Iterate rows -> iterate cells -> omit text node if text is empty -> create tableRow -> create table with align attrs -> create doc.
 */
function tableDoc(
  rows: readonly (readonly string[])[],
  align: readonly (string | null)[] = [],
): ProseMirrorNode {
  const rowNodes: ProseMirrorNode[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    // Guard against undefined row under noUncheckedIndexedAccess.
    if (row === undefined) {
      // Undefined row encountered: skip row index.
      continue;
    } else {
      // Row is defined: proceed to build cell nodes.
    }

    const cellNodes: ProseMirrorNode[] = [];
    for (let c = 0; c < row.length; c++) {
      const cellText = row[c];
      // Check whether cell text is undefined or empty.
      if (cellText === undefined || cellText.length === 0) {
        // Empty text string: cell has no child text node because ProseMirror rejects empty text nodes.
        cellNodes.push(kdocSchema.node('tableCell', null, []));
      } else {
        // Non-empty text string: create cell containing a text leaf node.
        cellNodes.push(kdocSchema.node('tableCell', null, [kdocSchema.text(cellText)]));
      }
    }
    rowNodes.push(kdocSchema.node('tableRow', null, cellNodes));
  }

  const tableNode = kdocSchema.node('table', { align: [...align] }, rowNodes);
  return kdocSchema.node('doc', null, [tableNode]);
}

/**
 * Creates an EditorState with doc and a TextSelection inside the cell at (row, column).
 *
 * @purpose Initializes an EditorState with a TextSelection positioned inside a designated table cell.
 * @inputs
 *   - doc: ProseMirrorNode - The root document node containing the table.
 *   - row: number - The 0-based target row index.
 *   - column: number - The 0-based target column index.
 * @outputs EditorState - Configured EditorState with caret selection placed inside the target cell.
 * @dataflow doc -> locate table -> accumulate row and cell node sizes -> compute caret position -> TextSelection.create -> EditorState.create.
 * @controlflow Locate firstChild table -> step 1 into table -> sum prior rows nodeSize -> step 1 into target row -> sum prior cells nodeSize -> step 1 into target cell -> build TextSelection -> return EditorState.
 */
function stateFor(doc: ProseMirrorNode, row: number, column: number): EditorState {
  const table = doc.firstChild;
  // Guard the null firstChild with a check that throws when there is no table.
  if (table === null) {
    // Document has no firstChild table node: throw error.
    throw new Error('Document has no table');
  } else {
    // Table node found: proceed to compute cell position.
  }

  // Start at 1 to step past the opening token into the table.
  let pos = 1;
  for (let r = 0; r < row; r++) {
    const priorRow = table.child(r);
    // Add each earlier row's nodeSize to advance past preceding rows.
    pos += priorRow.nodeSize;
  }

  // Add 1 to step past the target row's opening token into the row.
  pos += 1;
  const targetRow = table.child(row);
  for (let c = 0; c < column; c++) {
    const priorCell = targetRow.child(c);
    // Add each earlier cell's nodeSize to advance past preceding cells in the row.
    pos += priorCell.nodeSize;
  }

  // Add 1 to step past the target cell's opening token into the cell content.
  pos += 1;

  const selection = TextSelection.create(doc, pos);
  return EditorState.create({
    doc,
    selection,
    schema: kdocSchema,
  });
}

/**
 * Reads the table back out of state.doc.firstChild into a plain array of arrays of textContent.
 *
 * @purpose Extracts a 2D string grid of cell text contents from the table at the document root.
 * @inputs state: EditorState - The editor state containing the document to read.
 * @outputs string[][] - 2D grid representing table cell text contents.
 * @dataflow state.doc.firstChild -> iterate rows -> iterate cells -> collect textContent -> string[][].
 * @controlflow Guard null firstChild (throw if missing) -> loop table rows -> loop row cells -> extract textContent -> return 2D array.
 */
function gridOf(state: EditorState): string[][] {
  const table = state.doc.firstChild;
  // Guard the null firstChild with a check that throws when there is no table.
  if (table === null) {
    // Document has no firstChild table node: throw error.
    throw new Error('Document has no table');
  } else {
    // Table node found: proceed to extract cell text contents.
  }

  const grid: string[][] = [];
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r);
    const rowCells: string[] = [];
    for (let c = 0; c < row.childCount; c++) {
      rowCells.push(row.child(c).textContent);
    }
    grid.push(rowCells);
  }
  return grid;
}

/**
 * Returns the table node's align attribute from the document root.
 *
 * @purpose Extracts the column alignment vector from the table node in the current editor state.
 * @inputs state: EditorState - The editor state containing the document to read.
 * @outputs unknown - The value of the table node's align attribute.
 * @dataflow state.doc.firstChild -> read attrs.align -> return align attribute value.
 * @controlflow Guard null firstChild (throw if missing) -> access attrs.align -> return value.
 */
function alignOf(state: EditorState): unknown {
  const table = state.doc.firstChild;
  // Guard against null firstChild when reading table align attribute.
  if (table === null) {
    // Document has no firstChild table node: throw error.
    throw new Error('Document has no table');
  } else {
    // Table node present; return its align attribute.
    return table.attrs['align'];
  }
}

/**
 * Applies a command to an EditorState with a dispatch that captures the transaction, returning the resulting state.
 *
 * @purpose Executes a ProseMirror command against a given EditorState and returns the updated state or original state on failure.
 * @inputs
 *   - state: EditorState - The initial editor state.
 *   - command: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean - Command to execute.
 * @outputs EditorState - The updated state if the command succeeded, or the original state if the command returned false.
 * @dataflow state + command -> command execution with tr capture -> state.apply(tr) -> return updated state.
 * @controlflow Execute command with dispatch callback -> check command return value -> return nextState on true or state on false.
 */
function runOn(
  state: EditorState,
  command: (
    s: EditorState,
    d?: (tr: import('prosemirror-state').Transaction) => void,
  ) => boolean,
): EditorState {
  let nextState = state;
  const executed = command(state, (tr: import('prosemirror-state').Transaction): void => {
    nextState = state.apply(tr);
  });
  // Check whether the command returned true and executed successfully.
  if (executed) {
    // Command succeeded: return the transformed state.
    return nextState;
  } else {
    // Command returned false: return original unmodified state.
    return state;
  }
}

/**
 * Mounts an EditorView with the table grips plugin into a fresh DOM container appended to document.body.
 *
 * @purpose Helper to instantiate and mount an EditorView with table grips plugin in the jsdom environment.
 * @inputs state: EditorState - Source editor state providing doc and selection.
 * @outputs { view: EditorView; root: HTMLElement } - The created EditorView instance and its container DOM element.
 * @dataflow state -> create new EditorState with createTableGripsPlugin() -> new EditorView(root) -> return { view, root }.
 * @controlflow Create div element -> append to document.body -> rebuild EditorState with grips plugin -> instantiate EditorView -> return view and root.
 */
function mountWithGrips(state: EditorState): { view: EditorView; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const gripState = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    plugins: [createTableGripsPlugin()],
  });
  const view = new EditorView(root, {
    state: gripState,
  });
  return { view, root };
}

const GRID: readonly (readonly string[])[] = [
  ['H1', 'H2'],
  ['a1', 'a2'],
  ['b1', 'b2'],
];

describe('table reorder commands', () => {
  it('duplicateRow copies the carets row directly below it', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const nextState = runOn(state, duplicateRow());
    const grid = gridOf(nextState);

    expect(grid.length).toBe(4);
    expect(grid).toEqual([
      ['H1', 'H2'],
      ['a1', 'a2'],
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
  });

  it('duplicateRow refuses on the header row', () => {
    const state = stateFor(tableDoc(GRID), 0, 0);
    // GFM has no table without a header, and a second header is not a row.
    const result = duplicateRow()(state);
    expect(result).toBe(false);
  });

  it('duplicateColumn copies the carets column to its right and copies its alignment', () => {
    const state = stateFor(tableDoc(GRID, ['left', 'right']), 1, 1);
    const nextState = runOn(state, duplicateColumn());
    const grid = gridOf(nextState);

    expect(grid).toEqual([
      ['H1', 'H2', 'H2'],
      ['a1', 'a2', 'a2'],
      ['b1', 'b2', 'b2'],
    ]);
    // A column's alignment belongs to the column, so it has to travel with it.
    expect(alignOf(nextState)).toEqual(['left', 'right', 'right']);
  });

  it('moveRow(1) swaps the carets row with the one below', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const nextState = runOn(state, moveRow(1));
    const grid = gridOf(nextState);

    expect(grid).toEqual([
      ['H1', 'H2'],
      ['b1', 'b2'],
      ['a1', 'a2'],
    ]);
  });

  it('moveRow(-1) refuses when the caret is in the first body row', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    // Row 0 is the header and cannot be displaced.
    const result = moveRow(-1)(state);
    expect(result).toBe(false);
  });

  it('moveRow(1) refuses on the last row', () => {
    const state = stateFor(tableDoc(GRID), 2, 0);
    const result = moveRow(1)(state);
    expect(result).toBe(false);
  });

  it('moveColumn(1) swaps the carets column with the one to its right, alignment included', () => {
    const state = stateFor(tableDoc(GRID, ['left', 'right']), 1, 0);
    const nextState = runOn(state, moveColumn(1));
    const grid = gridOf(nextState);

    expect(grid).toEqual([
      ['H2', 'H1'],
      ['a2', 'a1'],
      ['b2', 'b1'],
    ]);
    expect(alignOf(nextState)).toEqual(['right', 'left']);
  });

  it('moveColumn(-1) refuses in column 0', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const result = moveColumn(-1)(state);
    expect(result).toBe(false);
  });

  it('moveRowTo moves a row across two positions', () => {
    const grid4: readonly (readonly string[])[] = [
      ['H'],
      ['a'],
      ['b'],
      ['c'],
    ];
    const state = stateFor(tableDoc(grid4), 1, 0);
    const nextState = runOn(state, moveRowTo(1, 3));
    const grid = gridOf(nextState);

    expect(grid).toEqual([
      ['H'],
      ['b'],
      ['c'],
      ['a'],
    ]);
  });

  it('moveRowTo refuses to touch row 0', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    expect(moveRowTo(0, 2)(state)).toBe(false);
    expect(moveRowTo(2, 0)(state)).toBe(false);
  });

  it('moveRowTo(n, n) is false', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    // A rewrite producing an identical table would be a pointless undo entry.
    expect(moveRowTo(1, 1)(state)).toBe(false);
  });

  it('moveColumnTo moves a column across two positions', () => {
    const grid3Col: readonly (readonly string[])[] = [
      ['c1', 'c2', 'c3'],
      ['r1', 'r2', 'r3'],
    ];
    const state = stateFor(tableDoc(grid3Col), 1, 0);
    const nextState = runOn(state, moveColumnTo(0, 2));
    const grid = gridOf(nextState);

    expect(grid).toEqual([
      ['c2', 'c3', 'c1'],
      ['r2', 'r3', 'r1'],
    ]);
  });

  it('moveColumnTo(n, n) is false', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    expect(moveColumnTo(1, 1)(state)).toBe(false);
  });

  it('a duplicated row carries the same content as the row it came from', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const nextState = runOn(state, duplicateRow());
    const table = nextState.doc.child(0);
    const originalRow = table.child(1);
    const duplicatedRow = table.child(2);

    // ProseMirror nodes are immutable values, so the two rows may legitimately share cell nodes;
    // what has to hold is that the copy says the same thing as the original.
    expect(duplicatedRow.eq(originalRow)).toBe(true);
    expect(table.childCount).toBe(4);
  });
});

describe('table grips plugin', () => {
  it('a grip is rendered for every body row and none for the header', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll('.' + TABLE_GRIP_ROW_CLASS);
    expect(rowGrips.length).toBe(2);

    const firstRowGrip = rowGrips[0];
    const allTrs = root.querySelectorAll('tr');
    const secondTr = allTrs[1];

    // Check if both the first row grip and the second tr are defined under strict indexing.
    if (firstRowGrip !== undefined && secondTr !== undefined) {
      // Assert the first row grip's closest tr is the table's second tr, proving the header has no grip.
      expect(firstRowGrip.closest('tr')).toBe(secondTr);
    } else {
      expect.fail('Expected firstRowGrip and secondTr to be defined');
    }

    view.destroy();
    root.remove();
  });

  it('a column grip is rendered for every column, on the header row', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const colGrips = root.querySelectorAll('.' + TABLE_GRIP_COLUMN_CLASS);
    expect(colGrips.length).toBe(2);

    const allTrs = root.querySelectorAll('tr');
    const headerTr = allTrs[0];

    // Check if the header tr is defined under strict indexing.
    if (headerTr !== undefined) {
      for (let i = 0; i < colGrips.length; i++) {
        const grip = colGrips[i];
        // Check if column grip element is defined under strict indexing.
        if (grip !== undefined) {
          expect(grip.closest('tr')).toBe(headerTr);
        } else {
          expect.fail(`Expected column grip at index ${i}`);
        }
      }
    } else {
      expect.fail('Expected header tr to be defined');
    }

    view.destroy();
    root.remove();
  });

  it('grips sit inside cells, not directly under the row', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const allGrips = root.querySelectorAll(
      `.${TABLE_GRIP_ROW_CLASS}, .${TABLE_GRIP_COLUMN_CLASS}`,
    );
    expect(allGrips.length).toBeGreaterThan(0);

    for (let i = 0; i < allGrips.length; i++) {
      const grip = allGrips[i];
      // Check if grip element is defined under strict indexing.
      if (grip !== undefined) {
        // Check whether parentElement exists on the grip element.
        if (grip.parentElement !== null) {
          // A <span> directly under a <tr> is invalid HTML that a browser would hoist out of the table.
          expect(grip.parentElement.tagName).toBe('TD');
        } else {
          expect.fail('Expected grip element to have a parentElement');
        }
      } else {
        expect.fail(`Expected grip at index ${i}`);
      }
    }

    view.destroy();
    root.remove();
  });

  it('a grip is draggable and not editable', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_ROW_CLASS);
    const firstGrip = rowGrips[0];

    // Check if the first row grip is defined under strict indexing.
    if (firstGrip !== undefined) {
      expect(firstGrip.draggable).toBe(true);
      expect(firstGrip.getAttribute('contenteditable')).toBe('false');
      expect(firstGrip.getAttribute('aria-label')).toBe('Drag to reorder row 2');
    } else {
      expect.fail('Expected first row grip to be defined');
    }

    view.destroy();
    root.remove();
  });

  it('dropping a row grip on another row reorders the table', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_ROW_CLASS);
    const firstRowGrip = rowGrips[0];
    const secondRowGrip = rowGrips[1];

    // Check if both row grips are defined under strict indexing.
    if (firstRowGrip !== undefined && secondRowGrip !== undefined) {
      // jsdom has no DragEvent, and the plugin only reads dataTransfer, which is null on a plain Event, so the null branch is exercised.
      const dragStart = new Event('dragstart', { bubbles: true });
      secondRowGrip.dispatchEvent(dragStart);

      const dropEvent = new Event('drop', { bubbles: true });
      firstRowGrip.dispatchEvent(dropEvent);

      expect(gridOf(view.state)).toEqual([
        ['H1', 'H2'],
        ['b1', 'b2'],
        ['a1', 'a2'],
      ]);
    } else {
      expect.fail('Expected two row grips to be present');
    }

    view.destroy();
    root.remove();
  });

  it('dropping a grip on itself changes nothing', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_ROW_CLASS);
    const firstRowGrip = rowGrips[0];

    // Check if the first row grip is defined under strict indexing.
    if (firstRowGrip !== undefined) {
      const dragStart = new Event('dragstart', { bubbles: true });
      firstRowGrip.dispatchEvent(dragStart);

      const dropEvent = new Event('drop', { bubbles: true });
      firstRowGrip.dispatchEvent(dropEvent);

      expect(gridOf(view.state)).toEqual([
        ['H1', 'H2'],
        ['a1', 'a2'],
        ['b1', 'b2'],
      ]);
    } else {
      expect.fail('Expected first row grip to be defined');
    }

    view.destroy();
    root.remove();
  });

  it('dropping a column grip on another column reorders the columns', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const colGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_COLUMN_CLASS);
    const firstColGrip = colGrips[0];
    const secondColGrip = colGrips[1];

    // Check if both column grips are defined under strict indexing.
    if (firstColGrip !== undefined && secondColGrip !== undefined) {
      const dragStart = new Event('dragstart', { bubbles: true });
      secondColGrip.dispatchEvent(dragStart);

      const dropEvent = new Event('drop', { bubbles: true });
      firstColGrip.dispatchEvent(dropEvent);

      expect(gridOf(view.state)).toEqual([
        ['H2', 'H1'],
        ['a2', 'a1'],
        ['b2', 'b1'],
      ]);
    } else {
      expect.fail('Expected two column grips to be present');
    }

    view.destroy();
    root.remove();
  });

  it('the grip set is rebuilt when a row is added', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    expect(root.querySelectorAll('.' + TABLE_GRIP_ROW_CLASS).length).toBe(2);

    duplicateRow()(view.state, view.dispatch);

    expect(root.querySelectorAll('.' + TABLE_GRIP_ROW_CLASS).length).toBe(3);

    view.destroy();
    root.remove();
  });

  it('a drag that carries a DataTransfer is marked as a move and given a payload', () => {
    const state = stateFor(tableDoc(GRID), 1, 0);
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_ROW_CLASS);
    const firstRowGrip = rowGrips[0];

    // Check if the first row grip is defined under strict indexing.
    if (firstRowGrip !== undefined) {
      // jsdom has no DragEvent and no DataTransfer, so a stub stands in for one: the plugin only
      // writes effectAllowed and calls setData, and both are recorded here.
      const written: Array<[string, string]> = [];
      const transfer = {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: (format: string, value: string): void => {
          written.push([format, value]);
        },
      };

      const dragStart = new Event('dragstart', { bubbles: true });
      Object.defineProperty(dragStart, 'dataTransfer', { value: transfer });
      firstRowGrip.dispatchEvent(dragStart);

      // Some browsers refuse to start a drag that sets no data at all.
      expect(transfer.effectAllowed).toBe('move');
      expect(written).toEqual([['text/plain', '']]);

      const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(dragOver, 'dataTransfer', { value: transfer });
      firstRowGrip.dispatchEvent(dragOver);

      // Nothing is duplicated by a reorder, so the cursor must say move rather than copy.
      expect(transfer.dropEffect).toBe('move');
      // Preventing the default is what makes an element a drop target at all.
      expect(dragOver.defaultPrevented).toBe(true);
    } else {
      expect.fail('Expected first row grip to be defined');
    }

    view.destroy();
    root.remove();
  });

  it('a grip reorders the table even when the caret is outside it', () => {
    const doc = kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text('before')]),
      tableDoc(GRID).child(0),
    ]);
    // The caret sits in the paragraph, not in the table: a drag never moves it, so the grip has to
    // put it in its own cell before asking for a move that resolves its table from the selection.
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    const { view, root } = mountWithGrips(state);

    const rowGrips = root.querySelectorAll<HTMLElement>('.' + TABLE_GRIP_ROW_CLASS);
    const firstRowGrip = rowGrips[0];
    const secondRowGrip = rowGrips[1];

    // Check if both row grips are defined under strict indexing.
    if (firstRowGrip !== undefined && secondRowGrip !== undefined) {
      secondRowGrip.dispatchEvent(new Event('dragstart', { bubbles: true }));
      firstRowGrip.dispatchEvent(new Event('drop', { bubbles: true }));

      const table = view.state.doc.child(1);
      expect(table.child(1).textContent).toBe('b1b2');
      expect(table.child(2).textContent).toBe('a1a2');
    } else {
      expect.fail('Expected two row grips to be present');
    }

    view.destroy();
    root.remove();
  });

  it('two tables get their own grips rather than sharing one set', () => {
    const doc = kdocSchema.node('doc', null, [
      tableDoc(GRID).child(0),
      kdocSchema.node('paragraph', null, [kdocSchema.text('between')]),
      tableDoc(GRID).child(0),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    const { view, root } = mountWithGrips(state);

    const tables = root.querySelectorAll('table');
    expect(tables.length).toBe(2);

    const firstTable = tables[0];
    const secondTable = tables[1];

    // Check if both table elements are defined under strict indexing.
    if (firstTable !== undefined && secondTable !== undefined) {
      // A widget key must be unique across the whole document: two tables keyed only by their own
      // row and column indices would collide, and the second table would render no grips at all.
      expect(firstTable.querySelectorAll('.' + TABLE_GRIP_COLUMN_CLASS).length).toBe(2);
      expect(secondTable.querySelectorAll('.' + TABLE_GRIP_COLUMN_CLASS).length).toBe(2);
      expect(firstTable.querySelectorAll('.' + TABLE_GRIP_ROW_CLASS).length).toBe(2);
      expect(secondTable.querySelectorAll('.' + TABLE_GRIP_ROW_CLASS).length).toBe(2);

      const keys: string[] = [];
      const allGrips = root.querySelectorAll<HTMLElement>('[data-kdoc-grip]');
      for (let i = 0; i < allGrips.length; i++) {
        const grip = allGrips[i];
        // Check if the grip element is defined under strict indexing.
        if (grip !== undefined) {
          const key = grip.dataset['kdocGrip'];
          // Check whether the element carries a key at all.
          if (key === undefined) {
            expect.fail('Expected every grip to carry a key');
          } else {
            keys.push(key);
          }
        } else {
          expect.fail(`Expected grip at index ${i}`);
        }
      }

      // Eight grips, eight distinct keys: a key repeated across two tables is one ProseMirror may
      // treat as the same widget, and it would then reuse one table's element for the other's.
      expect(keys.length).toBe(8);
      expect(new Set(keys).size).toBe(8);
    } else {
      expect.fail('Expected two rendered tables');
    }

    view.destroy();
    root.remove();
  });

  it('TABLE_GRIP_STYLES keeps the grip out of a native selection', () => {
    expect(TABLE_GRIP_STYLES).toContain('\n  user-select: none;');
    expect(TABLE_GRIP_STYLES).toContain('\n  -webkit-user-select: none;');
    // A control that only appears under a pointer cannot be reached without one.
    expect(TABLE_GRIP_STYLES).toContain(':focus-visible');
  });
});
