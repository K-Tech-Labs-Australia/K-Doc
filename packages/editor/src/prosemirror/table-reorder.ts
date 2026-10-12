/**
 * @file table-reorder.ts
 * @purpose Pure ProseMirror commands for duplicating and reordering GFM table rows and columns (FR-8.20).
 *   Every operation here is a grid rewrite: read the rows out, rearrange the array, hand it back.
 *   applyTableRewrite already knows how to turn a grid into a table and put the caret somewhere sensible,
 *   so none of these commands touches a document position directly.
 *
 *   Row 0 is the header and does not move. GFM has no table without a header row, so a move that could take
 *   it out of first place would produce something that is not a table. Duplicating it is refused for the same
 *   reason: two header rows is not a thing the format can express.
 * @inputs ProseMirror EditorState instances and optional dispatch callbacks; directional offsets (1 | -1)
 *   or explicit 0-based source and destination row/column indices.
 * @outputs ProseMirror Command functions returning boolean applicability/execution flags.
 * @functions
 *   - duplicateRow: Command factory duplicating the table row under the caret immediately below it.
 *   - duplicateColumn: Command factory duplicating the table column under the caret immediately right of it.
 *   - moveRow: Command factory moving the table row under the caret up or down by one position.
 *   - moveColumn: Command factory moving the table column under the caret left or right by one position.
 *   - moveRowTo: Command factory moving a table row from a source index to a destination index.
 *   - moveColumnTo: Command factory moving a table column from a source index to a destination index.
 * @dataflow EditorState -> tableAt lookup -> rowsOf grid extraction / padAlign alignment vector -> array splice operations -> applyTableRewrite rebuild -> Transaction dispatch.
 * @controlflow Resolve enclosing table -> guard header (row 0) and boundary limits -> splice array copies or moved elements -> invoke applyTableRewrite with updated caret position.
 * @version 1
 * @date 2026-09-11
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { applyTableRewrite } from './table.js';
import { tableAt, tableAlign, columnCountOf, type ColumnAlign } from './table-query.js';
import { rowsOf, padAlign } from './table-build.js';

/**
 * @purpose Duplicates the table row under the caret immediately below it, refusing to duplicate row 0 (the header row).
 * @inputs None (invoked as a command factory).
 * @outputs Command - A ProseMirror command returning false when inapplicable, or rewriting the table with the duplicated row.
 * @dataflow EditorState -> tableAt lookup -> rowsOf row grid -> copy row with cell.copy(content) -> splice into grid at rowIndex + 1 -> applyTableRewrite.
 * @controlflow Guard no table (return false) -> guard rowIndex === 0 (return false) -> read rowsOf -> guard rows[rowIndex] -> splice duplicate row at rowIndex + 1 -> applyTableRewrite with caret at rowIndex + 1.
 */
export function duplicateRow(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: proceed with row duplication.
    }

    // Row 0 is the header and does not move. GFM has no table without a header row,
    // and duplicating it is refused because two header rows is not expressible in the format.
    if (ctx.rowIndex === 0) {
      // Duplicating the header row is refused because GFM cannot express two header rows.
      return false;
    } else {
      // Target row is a body row: safe to duplicate.
    }

    const rows = rowsOf(ctx.table);
    const rowToDuplicate = rows[ctx.rowIndex];
    // Guard the indexed read of rows[ctx.rowIndex] against undefined under noUncheckedIndexedAccess.
    if (rowToDuplicate === undefined) {
      // Row at rowIndex does not exist in the extracted grid: refuse duplication.
      return false;
    } else {
      // Target row exists: create fresh copies of its cells.
    }

    // Build next by splicing the row's own cells in again at rowIndex + 1. ProseMirror nodes are
    // immutable values, so one node may appear in two places; copying them would allocate a second
    // tree to hold content that can never diverge from the first.
    const copiedRow: ProseMirrorNode[] = [...rowToDuplicate];
    const next: ProseMirrorNode[][] = [...rows];
    next.splice(ctx.rowIndex + 1, 0, copiedRow);

    // The caret follows the copy, because the copy is what the user just asked for and is the thing they are about to edit.
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      next,
      tableAlign(ctx.table),
      ctx.rowIndex + 1,
      ctx.cellIndex
    );
  };
}

/**
 * @purpose Duplicates the table column under the caret immediately right of it, duplicating both cells and alignment.
 * @inputs None (invoked as a command factory).
 * @outputs Command - A ProseMirror command returning false when inapplicable, or rewriting the table with the duplicated column.
 * @dataflow EditorState -> tableAt lookup -> rowsOf row grid + padAlign alignment vector -> copy cell in each row at cellIndex + 1 -> splice alignment at cellIndex + 1 -> applyTableRewrite.
 * @controlflow Guard no table (return false) -> map rows with cell copy at cellIndex + 1 (skipping short rows) -> pad alignment vector -> splice alignment entry at cellIndex + 1 -> applyTableRewrite with caret at cellIndex + 1.
 */
export function duplicateColumn(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: proceed with column duplication.
    }

    const rows = rowsOf(ctx.table);
    const next: ProseMirrorNode[][] = rows.map((row: ProseMirrorNode[]): ProseMirrorNode[] => {
      const cellToCopy = row[ctx.cellIndex];
      // Guard each row's indexed cell read against ragged or short rows.
      if (cellToCopy === undefined) {
        // A malformed grid should not take the command down; skip this short row by leaving it unchanged.
        return [...row];
      } else {
        // Cell exists: splice it in again at cellIndex + 1. ProseMirror nodes are immutable values,
        // so the same node may stand in both columns.
        const nextRow = [...row];
        nextRow.splice(ctx.cellIndex + 1, 0, cellToCopy);
        return nextRow;
      }
    });

    // A table's alignment vector can be shorter than its column count, and splicing into a short array would
    // silently shift every alignment after the insertion point.
    const align: ColumnAlign[] = padAlign(tableAlign(ctx.table), columnCountOf(ctx.table));
    const alignEntry: ColumnAlign = align[ctx.cellIndex] ?? null;
    align.splice(ctx.cellIndex + 1, 0, alignEntry);

    // The caret follows the copy, because the copy is what the user just asked for and is the thing they are about to edit.
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      next,
      align,
      ctx.rowIndex,
      ctx.cellIndex + 1
    );
  };
}

/**
 * @purpose Moves the table row under the caret up or down by one position, delegating to moveRowTo.
 * @inputs direction: 1 | -1 - Direction to move the row: 1 for down, -1 for up.
 * @outputs Command - A ProseMirror command returning false when inapplicable, or delegating execution to moveRowTo.
 * @dataflow EditorState -> tableAt lookup -> compute destination index (rowIndex + direction) -> delegate to moveRowTo.
 * @controlflow Guard no table (return false) -> compute to = rowIndex + direction -> invoke moveRowTo(rowIndex, to)(state, dispatch).
 */
export function moveRow(direction: 1 | -1): Command {
  // Thin wrapper for a keyboard or menu caller who means up or down rather than to index three.
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: delegate to moveRowTo.
    }

    const to = ctx.rowIndex + direction;
    return moveRowTo(ctx.rowIndex, to)(state, dispatch);
  };
}

/**
 * @purpose Moves the table column under the caret left or right by one position, delegating to moveColumnTo.
 * @inputs direction: 1 | -1 - Direction to move the column: 1 for right, -1 for left.
 * @outputs Command - A ProseMirror command returning false when inapplicable, or delegating execution to moveColumnTo.
 * @dataflow EditorState -> tableAt lookup -> compute destination index (cellIndex + direction) -> delegate to moveColumnTo.
 * @controlflow Guard no table (return false) -> compute to = cellIndex + direction -> invoke moveColumnTo(cellIndex, to)(state, dispatch).
 */
export function moveColumn(direction: 1 | -1): Command {
  // Thin wrapper for a keyboard or menu caller who means left or right rather than to index three.
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: delegate to moveColumnTo.
    }

    const to = ctx.cellIndex + direction;
    return moveColumnTo(ctx.cellIndex, to)(state, dispatch);
  };
}

/**
 * @purpose Moves a table row from a source index to a destination index, refusing to move or displace row 0 (the header row).
 * @inputs
 *   - from: number - 0-based source index of the row to move.
 *   - to: number - 0-based destination index of the row.
 * @outputs Command - A ProseMirror command returning false when inapplicable, or rewriting the table with the row moved.
 * @dataflow EditorState -> tableAt lookup -> rowsOf row grid -> splice row out of 'from' and in at 'to' -> applyTableRewrite with caret at 'to'.
 * @controlflow Guard no table (return false) -> guard header index 0 (return false) -> guard body range [1, rows.length - 1] (return false) -> guard from === to (return false) -> splice row out and in at to -> applyTableRewrite with caret at row 'to'.
 */
export function moveRowTo(from: number, to: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: proceed with row move.
    }

    const rows = rowsOf(ctx.table);

    // Check if either index is out of the valid body row range [1, rows.length - 1]. The range starts
    // at 1 rather than 0 because row 0 is the header: GFM has no table without one, so a move that
    // could take it out of first place would produce something that is not a table.
    if (from < 1 || from >= rows.length || to < 1 || to >= rows.length) {
      // Target or destination row index is out of bounds for the table body rows.
      return false;
    } else {
      // Both indices fall within the valid row bounds.
    }

    // Check if source and destination row indices are identical.
    if (from === to) {
      // Rewriting the table to produce an identical one would put a pointless entry in the undo history.
      return false;
    } else {
      // Source and destination differ; proceed with row move.
    }

    const nextRows: ProseMirrorNode[][] = [...rows];
    const removed: ProseMirrorNode[][] = nextRows.splice(from, 1);
    const movedRow: ProseMirrorNode[] | undefined = removed[0];

    // Guard the removed row against undefined under noUncheckedIndexedAccess.
    if (movedRow === undefined) {
      // The row element at index 'from' could not be retrieved from splice: abort move.
      return false;
    } else {
      // Splice the removed row back in at destination index 'to'.
      nextRows.splice(to, 0, movedRow);
    }

    // Puts the caret on the moved item.
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      nextRows,
      tableAlign(ctx.table),
      to,
      ctx.cellIndex
    );
  };
}

/**
 * @purpose Moves a table column from a source index to a destination index, moving both cell nodes and alignment entries.
 * @inputs
 *   - from: number - 0-based source index of the column to move.
 *   - to: number - 0-based destination index of the column.
 * @outputs Command - A ProseMirror command returning false when inapplicable, or rewriting the table with the column moved.
 * @dataflow EditorState -> tableAt lookup -> rowsOf row grid + padAlign alignment vector -> splice cell in each row from 'from' to 'to' -> splice alignment entry from 'from' to 'to' -> applyTableRewrite with caret at column 'to'.
 * @controlflow Guard no table (return false) -> guard column range [0, columnCount - 1] (return false) -> guard from === to (return false) -> splice cell in each row (skipping ragged rows) -> splice alignment entry -> applyTableRewrite with caret at column 'to'.
 */
export function moveColumnTo(from: number, to: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Check whether the caret currently resides inside a GFM table.
    if (ctx === null) {
      // Caret is not inside a table: command cannot apply.
      return false;
    } else {
      // Table context located: proceed with column move.
    }

    const columnCount = columnCountOf(ctx.table);

    // Check if either index is out of the valid column range [0, columnCount - 1].
    if (from < 0 || from >= columnCount || to < 0 || to >= columnCount) {
      // Column index is out of bounds for the table.
      return false;
    } else {
      // Both indices fall within the valid column range.
    }

    // Check if source and destination column indices are identical.
    if (from === to) {
      // Rewriting the table to produce an identical one would put a pointless entry in the undo history.
      return false;
    } else {
      // Source and destination differ; proceed with column move.
    }

    const rows = rowsOf(ctx.table);
    const nextRows: ProseMirrorNode[][] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Guard against undefined row under noUncheckedIndexedAccess.
      if (row === undefined) {
        // Row is missing: skip index.
        continue;
      } else {
        // Row is present: splice column cell.
      }

      const nextRow = [...row];
      // Check whether the row has a cell at index 'from'.
      if (from >= nextRow.length) {
        // Row is ragged and shorter than 'from'; leave it unchanged so malformed grids do not take the command down.
        nextRows.push(nextRow);
      } else {
        const removedCells: ProseMirrorNode[] = nextRow.splice(from, 1);
        const movedCell: ProseMirrorNode | undefined = removedCells[0];
        // Guard the removed cell against undefined under noUncheckedIndexedAccess.
        if (movedCell === undefined) {
          // Cell could not be retrieved from splice; keep the row unchanged.
          nextRows.push(nextRow);
        } else {
          // Splice the removed cell back in at destination index 'to'.
          nextRow.splice(Math.min(to, nextRow.length), 0, movedCell);
          nextRows.push(nextRow);
        }
      }
    }

    // A table's alignment vector can be shorter than its column count, so pad it to full width first.
    const align: ColumnAlign[] = padAlign(tableAlign(ctx.table), columnCount);
    const removedAlign: ColumnAlign[] = align.splice(from, 1);
    const movedAlign: ColumnAlign | undefined = removedAlign[0];

    // Guard the removed alignment entry against undefined under noUncheckedIndexedAccess.
    if (movedAlign === undefined) {
      // An alignment belongs to its column, and a column that moved without it would arrive right-aligned in a left-aligned slot.
      align.splice(to, 0, null);
    } else {
      // An alignment belongs to its column, and a column that moved without it would arrive right-aligned in a left-aligned slot.
      align.splice(to, 0, movedAlign);
    }

    // Puts the caret on the moved item.
    return applyTableRewrite(
      state,
      dispatch,
      ctx.tablePos,
      ctx.table,
      nextRows,
      align,
      ctx.rowIndex,
      to
    );
  };
}
