/**
 * @file table-header.ts
 * @purpose Toggle the GFM (GitHub Flavored Markdown) header row of the table around the caret, implementing FR-8.25.
 *   GFM has no concept of a table without a header, so "no header" is modelled as an empty header row: turning the header
 *   off pushes the current first row down beneath a new empty header, and turning it on removes that empty header, promoting
 *   the first body row. Every edit rebuilds the whole table via `applyTableRewrite` so position arithmetic stays exact.
 * @inputs ProseMirror EditorState (for the caret location and schema) and GFM table Node values describing the enclosing table.
 * @outputs Boolean flags reporting header presence (`hasHeaderRow`) and emptiness (`headerRowIsEmpty`), and a ProseMirror Command
 *   (`toggleHeaderRow`) that rewrites the table when invoked.
 * @functions
 *   - headerRowIsEmpty: Reports whether a table's first row holds no content at all (an empty header).
 *   - hasHeaderRow: Reports whether the table around the caret shows a header, or null outside a table.
 *   - toggleHeaderRow: Returns a Command that toggles the header row on and off by adding or removing an empty header row.
 * @dataflow EditorState -> tableAt context -> rowsOf/emptyRow arrays -> applyTableRewrite rebuilds the table; header checks read nodeSize.
 * @controlflow Query the enclosing table -> branch on emptiness to add/remove a header row -> recompute caret row -> rewrite.
 * @version 1
 * @date 2026-09-15
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { tableAt, tableAlign } from './table-query.js';
import { emptyRow, rowsOf } from './table-build.js';
import { applyTableRewrite } from './table.js';

/**
 * @purpose Reports whether a table's first row holds no content at all, i.e. it is an empty header row.
 * @inputs table - The GFM `table` node whose header (first child) should be inspected.
 * @outputs boolean - True when the first row has only empty cells; false when it carries any inline content or the table is empty.
 * @dataflow Reads table.child(0) -> compares its content.size against twice its cell count -> returns the emptiness flag.
 * @controlflow Fetch the header row -> return true only when every cell is empty (nodeSize 2 each).
 */
export function headerRowIsEmpty(table: ProseMirrorNode): boolean {
  const header = table.child(0);
  // The first child of a GFM table is its header row; the schema requires at least one row, so it always exists.

  return header.content.size === header.childCount * 2;
  // The first row holds no text and no inline content at all (an image counts as content). A content-less
  // tableCell has nodeSize 2, so a row whose total content size equals twice its cell count contains only empty cells.
}

/**
 * @purpose Reports whether the table around the caret shows a header row, or null when the caret is outside any table.
 * @inputs state - The current ProseMirror editor state whose selection locates the enclosing table.
 * @outputs boolean | null - True/False for header presence inside a table; null when there is no enclosing table.
 * @dataflow Delegates to tableAt(state) -> negates headerRowIsEmpty on the located table -> returns the flag or null.
 * @controlflow Query the context -> return null outside a table, else whether its first row is non-empty.
 */
export function hasHeaderRow(state: EditorState): boolean | null {
  const ctx = tableAt(state);
  // The resolved context locating the caret inside its enclosing table, or null when none exists.

  if (ctx === null) {
    // Not inside a table: there is no header to report.
    return null;
  } else {
    // Inside a table: it shows a header exactly when that first row is not empty.
    return !headerRowIsEmpty(ctx.table);
  }
}

/**
 * @purpose Returns a Command that toggles the GFM header row of the table around the caret, implementing FR-8.25.
 * @inputs None; the returned command receives EditorState and an optional dispatch from ProseMirror on invocation.
 * @outputs A ProseMirror Command (state, dispatch) => boolean that rewrites the table or reports it did not apply.
 * @dataflow Invoked with state -> tableAt context -> rowsOf/emptyRow arrays -> applyTableRewrite rebuilds the table.
 * @controlflow Reject outside a table -> branch on header emptiness to add/remove an empty header row -> rewrite, keeping the caret's cell.
 */
export function toggleHeaderRow(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // The resolved context locating the caret inside its enclosing table, or null when none exists.

    if (ctx === null) {
      // Not inside a table: the toggle does not apply and reports failure.
      return false;
    } else {
      // Inside a table: proceed to inspect and rewrite its header row.
    }

    const rows = rowsOf(ctx.table);
    // The table's cells as a plain 2-D array, decoupled from the node tree for safe rebuilding.

    if (headerRowIsEmpty(ctx.table)) {
      // The header row is empty (the table shows no header): turn the header on by dropping that row, so the first body row becomes the header.
      if (rows.length < 2) {
        // A table with only its empty header row has nothing to promote; refuse to toggle rather than delete every row.
        return false;
      } else {
        // At least one body row exists and will be promoted into the header slot.
      }

      // The caret keeps its cell: its row moves up by one. A caret in the removed header asks for row -1, which cellStartPos
      // clamps to the new header.
      const caretRow = ctx.rowIndex - 1;
      return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, rows.slice(1), tableAlign(ctx.table), caretRow, ctx.cellIndex);
      // Drop the empty header (rows.slice(1)) and place the caret on the promoted row.
    } else {
      // The table has a header: turn it off by putting an empty header row above, so the current header becomes the first body row.
      const blank = emptyRow(state.schema, ctx.columnCount);
      // A fresh row of empty cells sized to the table's column count.

      const cells: ProseMirrorNode[] = [];
      // The rebuilt empty header row's cell list, assembled from `blank`.

      blank.forEach((cell) => {
        cells.push(cell);
      });
      // Copy each empty cell so the new array can be spliced ahead of the existing rows.

      return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, [cells, ...rows], tableAlign(ctx.table), ctx.rowIndex + 1, ctx.cellIndex);
      // Prepend the blank header (cells) before every existing row and move the caret down one row.
    }
  };
}