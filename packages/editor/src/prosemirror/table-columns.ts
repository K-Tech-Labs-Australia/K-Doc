/**
 * @file table-columns.ts
 * @purpose ProseMirror commands for GFM table column operations (insert/delete/align)
 *   and single-cell navigation used to bind Tab / Shift-Tab and the column toolbar.
 * @inputs EditorState whose selection sits inside a table; each command closure receives
 *   an optional Transaction-dispatching function from the ProseMirror keymap.
 * @outputs A Command: `(state, dispatch?) => boolean` that is false when it cannot apply.
 * @functions
 *   - addColumnBefore: insert an empty column immediately left of the caret's cell.
 *   - addColumnAfter: insert an empty column immediately right of the caret's cell.
 *   - deleteColumn: remove the column under the caret (refused when it is the last).
 *   - setColumnAlign: set the GFM alignment of the column under the caret.
 *   - goToNextCell: move the caret one cell in `direction`, wrapping rows and adding a row at the end.
 * @dataflow EditorState → tableAt lookup → rowsOf cells + padAlign alignment mutated in place → applyTableRewrite rebuilds the table; goToNextCell computes a flat index and builds a selection Transaction instead.
 * @controlflow Each command guards for "no table" (return false), mutates in-memory row/align structures, then rewrites via applyTableRewrite or sets a selection; dry-run returns true when dispatch is absent.
 * @version 1
 * @date 2026-09-05
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { tableAt, tableAlign, type ColumnAlign } from './table-query.js';
import { rowsOf, emptyCell, cellStartPos, padAlign } from './table-build.js';
import { applyTableRewrite, addRowAfter } from './table.js';

/**
 * @purpose Insert an empty column immediately left of the cell under the caret.
 * @inputs state - EditorState whose selection sits inside a table; dispatch (optional) for the rewrite Transaction.
 * @outputs boolean - true when a column was inserted or in dry-run, false when there is no table.
 * @dataflow tableAt lookup → rowsOf cells + padAlign alignment → per-row splice of emptyCell and null alignment → applyTableRewrite rebuilds the table.
 * @controlflow Guard "no table" (return false) → compute insertAt = cellIndex → splice a cell and an alignment slot into every row → return applyTableRewrite result.
 */
export function addColumnBefore(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // No table under the caret: nothing to modify, so refuse.
    if (ctx === null) {
      return false;
    }
    // Insert immediately before the cell the caret currently occupies.
    const insertAt = ctx.cellIndex;
    const rows = rowsOf(ctx.table);
    // Splice a fresh empty cell into every row so the table stays rectangular.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // noUncheckedIndexedAccess makes rows[i] possibly undefined.
      if (row === undefined) {
        continue;
      }
      // Math.min guards ragged rows: a shorter row has no slot at insertAt, so
      // appending at its end keeps it rectangular instead of one cell short.
      row.splice(Math.min(insertAt, row.length), 0, emptyCell(state.schema));
    }
    // The alignment vector must move in lockstep with the cells; otherwise every
    // column to the right silently inherits its neighbour's alignment.
    const align = padAlign(tableAlign(ctx.table), ctx.columnCount);
    align.splice(insertAt, 0, null);
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      rows,
      align,
      ctx.rowIndex,
      insertAt
    );
  };
}

/**
 * @purpose Insert an empty column immediately right of the cell under the caret.
 * @inputs state - EditorState whose selection sits inside a table; dispatch (optional) for the rewrite Transaction.
 * @outputs boolean - true when a column was inserted or in dry-run, false when there is no table.
 * @dataflow tableAt lookup → rowsOf cells + padAlign alignment → per-row splice of emptyCell and null alignment → applyTableRewrite rebuilds the table.
 * @controlflow Guard "no table" (return false) → compute insertAt = cellIndex + 1 → splice a cell and an alignment slot into every row → return applyTableRewrite result.
 */
export function addColumnAfter(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // No table under the caret: nothing to modify, so refuse.
    if (ctx === null) {
      return false;
    }
    // Insert immediately after the cell the caret currently occupies.
    const insertAt = ctx.cellIndex + 1;
    const rows = rowsOf(ctx.table);
    // Splice a fresh empty cell into every row so the table stays rectangular.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // noUncheckedIndexedAccess makes rows[i] possibly undefined.
      if (row === undefined) {
        continue;
      }
      // Math.min guards ragged rows: a shorter row has no slot at insertAt, so
      // appending at its end keeps it rectangular instead of one cell short.
      row.splice(Math.min(insertAt, row.length), 0, emptyCell(state.schema));
    }
    // The alignment vector must move in lockstep with the cells; otherwise every
    // column to the right silently inherits its neighbour's alignment.
    const align = padAlign(tableAlign(ctx.table), ctx.columnCount);
    align.splice(insertAt, 0, null);
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      rows,
      align,
      ctx.rowIndex,
      insertAt
    );
  };
}

/**
 * @purpose Remove the column under the caret from every row.
 * @inputs state - EditorState whose selection sits inside a table; dispatch (optional) for the rewrite Transaction.
 * @outputs boolean - true when a column was removed or in dry-run, false when there is no table or only one column remains.
 * @dataflow tableAt lookup → rowsOf cells + padAlign alignment → per-row splice removes one cell and one alignment → applyTableRewrite rebuilds the table.
 * @controlflow Guard "no table" then "columnCount <= 1" (both return false) → splice a cell out of each row → splice an alignment out → clamp caret column → return applyTableRewrite result.
 */
export function deleteColumn(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // No table under the caret: nothing to modify, so refuse.
    if (ctx === null) {
      return false;
    }
    // tableCell+ forbids an empty row, so removing the last column would leave a
    // row with zero cells; refuse and let the user deleteTable instead.
    if (ctx.columnCount <= 1) {
      return false;
    }
    const rows = rowsOf(ctx.table);
    // Drop one cell from every row so the table stays rectangular.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // noUncheckedIndexedAccess makes rows[i] possibly undefined.
      if (row === undefined) {
        continue;
      }
      // Only remove a cell where one actually exists: ragged rows shorter than the
      // target column have nothing to delete, so leave them untouched.
      if (ctx.cellIndex < row.length) {
        row.splice(ctx.cellIndex, 1);
      }
    }
    const align = padAlign(tableAlign(ctx.table), ctx.columnCount);
    align.splice(ctx.cellIndex, 1);
    // columnCount - 2 is the last valid index after one column is removed; clamp
    // the caret so it never points past the new right edge.
    const caretCell = Math.max(0, Math.min(ctx.cellIndex, ctx.columnCount - 2));
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      rows,
      align,
      ctx.rowIndex,
      caretCell
    );
  };
}

/**
 * @purpose Set the GFM alignment of the column under the caret (alignment is stored per column on the table, not per cell).
 * @inputs align - ColumnAlign value to apply; state and dispatch as above.
 * @outputs boolean - true when the column's alignment was set or in dry-run, false when there is no table or no column at the caret.
 * @dataflow tableAt lookup → padAlign current alignment → assign next[cellIndex] = align → applyTableRewrite rebuilds the table.
 * @controlflow Guard "no table" then "cellIndex >= next.length" (both return false) → set the alignment slot → return applyTableRewrite result.
 */
export function setColumnAlign(align: ColumnAlign): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // No table under the caret: nothing to align, so refuse.
    if (ctx === null) {
      return false;
    }
    const next = padAlign(tableAlign(ctx.table), ctx.columnCount);
    // The caret's column must exist in the padded vector; otherwise there is no
    // column to align, so refuse rather than writing past the array end.
    if (ctx.cellIndex >= next.length) {
      return false;
    }
    next[ctx.cellIndex] = align;
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      rowsOf(ctx.table),
      next,
      ctx.rowIndex,
      ctx.cellIndex
    );
  };
}

/**
 * @purpose Move the caret one cell in `direction` (1 forward, -1 backward), wrapping across rows and appending a row at the end. Bound to Tab / Shift-Tab.
 * @inputs direction - 1 for forward (Tab) or -1 for backward (Shift-Tab); state and dispatch as above.
 * @outputs boolean - true when navigation applied or in dry-run, false outside a table or before the first cell going backward.
 * @dataflow tableAt lookup → flat index arithmetic → cellStartPos target position → selection Transaction via TextSelection.near.
 * @controlflow Guard "no table" (return false) → compute flat index → if past end delegate to addRowAfter; if below zero return false; dry-run return true; else set selection and return true.
 */
export function goToNextCell(direction: 1 | -1): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Outside a table there is no cell to reach; returning false lets Tab keep its
    // ordinary meaning on every other node type.
    if (ctx === null) {
      return false;
    }
    // Flatten the 2D grid to a single index so wrap-around navigation is one
    // arithmetic step instead of nested row/cell bookkeeping.
    const flat = ctx.rowIndex * ctx.columnCount + ctx.cellIndex + direction;
    // Tab past the final cell appends a new row rather than escaping the table:
    // every table editor behaves this way, and addRowAfter lands the caret in that
    // new row's first cell.
    if (flat >= ctx.table.childCount * ctx.columnCount) {
      return addRowAfter()(state, dispatch);
    }
    // Shift-Tab before the very first cell has nowhere to go; do nothing so Tab and
    // Shift-Tab don't fight the editor's normal backward navigation.
    if (flat < 0) {
      return false;
    }
    const targetRow = Math.floor(flat / ctx.columnCount);
    const targetCell = flat % ctx.columnCount;
    // Dry-run: without a dispatch fn we only need to report applicability.
    if (dispatch === undefined) {
      return true;
    }
    const pos = cellStartPos(ctx.table, ctx.tablePos, targetRow, targetCell);
    const tr = state.tr.setSelection(
      TextSelection.near(state.doc.resolve(pos))
    );
    // Moving the caret changes no content, so this transaction must NOT be tagged
    // kdocStructural — tagging it would push a meaningless entry into the undo history.
    dispatch(tr);
    return true;
  };
}