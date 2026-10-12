/**
 * @file table.ts
 * @purpose Pure ProseMirror commands for inserting and deleting GFM tables and their rows, plus a shared
 *   rewrite engine (`applyTableRewrite`) that every structural command reduces to. Each command is
 *   `(state, dispatch?) => boolean`, returns `false` without dispatching when it cannot apply, honours the
 *   dry-run protocol (`dispatch === undefined` reports applicability and builds nothing), and tags its
 *   transaction with the kdocStructural meta so ProseMirrorBinding opts it out of undo coalescing. These
 *   functions operate solely on EditorState and Transaction, requiring no DOM, which enables direct headless
 *   Node testing (a package-wide test asserts that no `document.`/`window.` identifier appears here).
 * @inputs ProseMirror EditorState instances, transactions, table document positions and nodes, row grids of
 *   cell nodes, column alignment vectors, and caret coordinates.
 * @outputs boolean applicability/execution flags and Command factories for the six exported operations.
 * @functions
 *   - applyTableRewrite: Shared engine rebuilding a table from a new row grid and dispatching a structural transaction with the caret placed in a target cell.
 *   - insertTable: Command factory inserting a fresh empty GFM table at the current selection.
 *   - deleteTable: Command factory removing the enclosing table entirely.
 *   - addRowBefore: Command factory inserting an empty row immediately above the current row.
 *   - addRowAfter: Command factory inserting an empty row immediately below the current row.
 *   - deleteRow: Command factory removing the current row, promoting the next row to header when needed.
 * @dataflow EditorState -> tableAt query / grid construction -> buildTable -> tagged Transaction via dispatch.
 * @controlflow Resolve enclosing table (or clamp/floor counts) -> guard applicability -> dry-run or rebuild+dispatch with kdocStructural meta and a caret selection.
 * @version 1
 * @date 2026-09-05
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { tableAt, tableAlign, type ColumnAlign } from './table-query.js';
import { rowsOf, emptyRow, buildTable, cellStartPos, padAlign, emptyCell } from './table-build.js';

/**
 * @purpose Shared engine that rebuilds a table from a new row grid and alignment vector, places the caret in
 *   a target cell of the rebuilt table, and dispatches a single structural transaction replacing the old node.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state whose schema builds table nodes.
 *   - dispatch: ((tr: Transaction) => void) | undefined - Dispatch callback; undefined signals a dry-run.
 *   - tablePos: number - Document position of the enclosing table to be replaced.
 *   - oldTable: ProseMirrorNode - The current table node whose extent is replaced by `replaceWith`.
 *   - rows: readonly (readonly ProseMirrorNode[])[] - The new row grid: an array of row-arrays of cell nodes.
 *   - align: readonly ColumnAlign[] - The column alignment vector applied to the rebuilt table.
 *   - caretRow: number - Row index of the target caret cell within the rebuilt table.
 *   - caretCell: number - Cell index of the target caret cell within the rebuilt table.
 * @outputs boolean - True when the edit was applied or is applicable, false only if a guard rejects it (never here).
 * @dataflow buildTable(schema, rows, align) -> replaceWith(old extent) -> cellStartPos(caret) -> TextSelection.near -> setMeta(kdocStructural) -> dispatch.
 * @controlflow Dry-run short-circuit when dispatch is undefined; otherwise rebuild the table, replace the old node, place the caret, tag structural, dispatch, return true.
 */
export function applyTableRewrite(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  tablePos: number,
  oldTable: ProseMirrorNode,
  rows: readonly (readonly ProseMirrorNode[])[],
  align: readonly ColumnAlign[],
  caretRow: number,
  caretCell: number,
): boolean {
  if (dispatch === undefined) {
    // Dry-run requested by a caller that already verified applicability: report success without building.
    return true;
  } else {
    // Real edit requested: build the replacement table and dispatch it below.
  }

  const next = buildTable(state.schema, rows, align);
  // Rebuild the full table node from the new row grid and alignment vector.

  const tr = state.tr.replaceWith(tablePos, tablePos + oldTable.nodeSize, next);
  // Replace the entire old table (from its position through its node size) with the rebuilt one.

  const pos = cellStartPos(next, tablePos, caretRow, caretCell);
  // Compute the document position of the target caret cell in the freshly built table.

  tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
  // TextSelection.near is used rather than TextSelection.create because the computed position is a *content*
  // position that may be immediately followed by a node boundary in an empty cell, and near snaps to the
  // closest valid text position instead of throwing.

  tr.setMeta('kdocStructural', true);
  // Tag the transaction structural so it opts out of undo coalescing in ProseMirrorBinding.

  dispatch(tr);
  return true;
}

/**
 * @purpose Command factory that inserts a fresh empty GFM table at the current selection, refusing to nest a
 *   table inside an existing one and flooring the row count so the result always satisfies the GFM minimum.
 * @inputs rows: number - Requested row count (floored to at least 2). columns: number - Requested column count (floored to at least 1).
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else inserting an empty table.
 * @dataflow Clamp counts -> guard nesting -> build grid of empty cells -> padAlign defaults -> buildTable -> replaceSelectionWith -> position caret in first cell -> tag structural -> dispatch.
 * @controlflow Floor rows>=2/columns>=1 -> refuse if a table already encloses (false) -> dry-run true -> build empty grid -> insert -> set caret via +3 offset -> dispatch -> return true.
 */
export function insertTable(rows: number, columns: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // GFM requires a header row plus at least one delimiter row, so a one-row table is not a table.
    const safeRows = Math.max(2, rows);
    // Floor the requested row count at 2 to satisfy the GFM two-row minimum (header + delimiter).

    const safeColumns = Math.max(1, columns);
    // Floor the requested column count at 1 because a table must have at least one column.

    if (tableAt(state) !== null) {
      // A table already surrounds the selection: nesting a table inside another is not expressible in GFM.
      return false;
    } else {
      // No enclosing table: an independent table may be inserted here and will round-trip cleanly.
    }

    if (dispatch === undefined) {
      // Dry-run: report applicability without building a transaction, per ProseMirror convention.
      return true;
    } else {
      // Real edit requested: build the empty table and dispatch it below.
    }

    const grid = Array.from({ length: safeRows }, () =>
      // Build one row-array per requested (floored) row count.
      Array.from({ length: safeColumns }, () => emptyCell(state.schema))
      // Each cell is a fresh empty table cell built from the schema; no alignment recorded yet.
    );

    const table = buildTable(state.schema, grid, padAlign([], safeColumns));
    // Assemble the table node; padAlign fills the empty alignment vector with default alignments so that every
    // one of the (floored) columns has an explicit alignment instead of leaving trailing columns undefined.

    const insertPos = state.selection.from;
    // Capture the insertion anchor before mutating the document so the new first cell can be located afterwards.

    const tr = state.tr.replaceSelectionWith(table);
    // Insert the freshly built table at the current selection, replacing any selected content in place.

    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 3)));
    // insertPos is the inserted table's own position; +1 steps into the table node, +2 into the first row, and
    // +3 into the first cell; TextSelection.near snaps if the arithmetic lands a hair off a boundary.

    tr.setMeta('kdocStructural', true);
    // Tag the transaction structural so it opts out of undo coalescing in ProseMirrorBinding.

    dispatch(tr);
    return true;
  };
}

/**
 * @purpose Command factory that removes the enclosing table entirely, deleting its full node extent.
 * @inputs void — factory returns a ProseMirror Command receiving (state, dispatch?).
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else deleting the table.
 * @dataflow tableAt -> delete(tablePos, tablePos + nodeSize) -> setMeta(kdocStructural) -> dispatch.
 * @controlflow Resolve ctx (false if null) -> dry-run true -> delete full node extent -> tag structural -> dispatch -> return true.
 */
export function deleteTable(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Locate the enclosing table for the current selection.

    if (ctx === null) {
      // No enclosing table: there is nothing to delete.
      return false;
    } else {
      // Enclosing table found: proceed to remove its full extent.
    }

    if (dispatch === undefined) {
      // Dry-run: report applicability without building a transaction, per ProseMirror convention.
      return true;
    } else {
      // Real edit requested: delete the table node below.
    }

    const tr = state.tr.delete(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize);
    // Delete the full extent of the enclosing table by its position and node size.

    tr.setMeta('kdocStructural', true);
    // Tag the transaction structural so it opts out of undo coalescing in ProseMirrorBinding.

    dispatch(tr);
    return true;
  };
}

/**
 * @purpose Command factory that inserts an empty row immediately above the current row, protecting the header.
 * @inputs void — factory returns a ProseMirror Command receiving (state, dispatch?).
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else inserting a row above.
 * @dataflow tableAt -> read rows/columnCount -> build one empty row -> splice at max(1, rowIndex) -> applyTableRewrite with caret in new row's first cell.
 * @controlflow Resolve ctx (false if null) -> floor insert index at 1 to protect the header -> dry-run true -> splice -> rebuild+dispatch -> return true.
 */
export function addRowBefore(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Locate the enclosing table for the current selection.

    if (ctx === null) {
      // No enclosing table: a row cannot be added.
      return false;
    } else {
      // Enclosing table found: proceed to insert a new row above the current one.
    }

    const rows = rowsOf(ctx.table);
    // Read the current row grid out of the enclosing table for rebuilding.

    const width = ctx.columnCount;
    // The column count defines how many cells each new row must contain.

    const newCells = rowsOf(emptyRow(state.schema, width))[0] ?? [];
    // Build a single empty row and extract its first (only) row-array as the new row's cell list.

    const insertAt = Math.max(1, ctx.rowIndex);
    // Floor at 1: row 0 is the header, and inserting above it would make the new row the header and silently
    // demote the user's headings to body text; inserting below the header is what the user meant.

    rows.splice(insertAt, 0, newCells);
    // Insert the new row at the computed index without disturbing any existing rows.

    return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, rows, tableAlign(ctx.table), insertAt, 0);
    // Rebuild the table with the new row spliced in and place the caret at its first cell.
  };
}

/**
 * @purpose Command factory that inserts an empty row immediately below the current row.
 * @inputs void — factory returns a ProseMirror Command receiving (state, dispatch?).
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else inserting a row below.
 * @dataflow tableAt -> read rows/columnCount -> build one empty row -> splice at rowIndex + 1 -> applyTableRewrite with caret in new row's first cell.
 * @controlflow Resolve ctx (false if null) -> insert index = rowIndex + 1 -> dry-run true -> splice -> rebuild+dispatch -> return true.
 */
export function addRowAfter(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Locate the enclosing table for the current selection.

    if (ctx === null) {
      // No enclosing table: a row cannot be added.
      return false;
    } else {
      // Enclosing table found: proceed to insert a new row below the current one.
    }

    const rows = rowsOf(ctx.table);
    // Read the current row grid out of the enclosing table for rebuilding.

    const width = ctx.columnCount;
    // The column count defines how many cells each new row must contain.

    const newCells = rowsOf(emptyRow(state.schema, width))[0] ?? [];
    // Build a single empty row and extract its first (only) row-array as the new row's cell list.

    const insertAt = ctx.rowIndex + 1;
    // Insert immediately after the current row for addRowAfter semantics.

    rows.splice(insertAt, 0, newCells);
    // Insert the new row at the computed index without disturbing any existing rows.

    return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, rows, tableAlign(ctx.table), insertAt, 0);
    // Rebuild the table with the new row spliced in and place the caret at its first cell.
  };
}

/**
 * @purpose Command factory that removes the current row, promoting the next row to header when the deleted row
 *   was the header — the honest consequence of mdast having no separate header node for GFM tables.
 * @inputs void — factory returns a ProseMirror Command receiving (state, dispatch?).
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else deleting the current row.
 * @dataflow tableAt -> guard last-row case -> read rows -> splice(rowIndex, 1) -> compute bounded caretRow -> applyTableRewrite with caret in same column.
 * @controlflow Resolve ctx (false if null) -> refuse when childCount<=1 (false) -> dry-run true -> delete row -> rebuild+dispatch -> return true.
 */
export function deleteRow(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Locate the enclosing table for the current selection.

    if (ctx === null) {
      // No enclosing table: a row cannot be deleted.
      return false;
    } else {
      // Enclosing table found: proceed to remove the current row.
    }

    if (ctx.table.childCount <= 1) {
      // A tableRow+ node forbids an empty table, so the last remaining row cannot be removed; the user wants
      // deleteTable instead of deleteRow in this case.
      return false;
    } else {
      // More than one row remains: deletion is permitted and the table stays non-empty.
    }

    const rows = rowsOf(ctx.table);
    // Read the current row grid out of the enclosing table for rebuilding.

    rows.splice(ctx.rowIndex, 1);
    // Remove the current row from the grid by its index.

    const caretRow = Math.min(ctx.rowIndex, rows.length - 1);
    // Keep the caret within bounds: after deletion it cannot remain on a removed row, so clamp to the last one.

    return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, rows, tableAlign(ctx.table), caretRow, ctx.cellIndex);
    // Rebuild the table without the deleted row and place the caret in the same column of the surviving row.
  };
}
