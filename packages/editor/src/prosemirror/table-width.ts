/**
 * @file table-width.ts
 * @purpose Reads and sets a GFM table column's width hint (FR-8.26). The hint is a minimum width in characters stored as
 *   the `widthHint` attribute of the column's header cell, so column moves, duplicates and sorts carry it along with the column.
 * @inputs ProseMirror EditorState instances describing documents that may contain GFM tables; a requested width value for the setter command.
 * @outputs The caret column's current hint (`columnWidthHintAt`), and a Command that applies or clears the hint (`setColumnWidthHint`).
 * @functions
 *   - MAX_WIDTH_HINT: Upper bound, in characters, accepted by setColumnWidthHint.
 *   - headerCellPos: Resolves the document position and stored hint of the header cell above the caret's column.
 *   - columnWidthHintAt: Returns the caret column's current width hint, or undefined outside a table.
 *   - setColumnWidthHint: Command that sets (or clears with null) the caret column's width hint as a structural edit.
 * @dataflow EditorState -> tableAt query -> header cell position/hint resolution -> read via columnWidthHintAt or write via setColumnWidthHint's command predicate.
 * @controlflow Validate requested width -> locate header cell -> compare against current hint -> apply a node-markup transaction with structural meta, or report success on dry run.
 * @version 1
 * @date 2026-09-15
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { tableAt } from './table-query.js';

/** The widest hint accepted, in characters: wider columns are better left to their content. */
export const MAX_WIDTH_HINT = 200;

/**
 * @purpose Reads what the person typed as a column width: a whole number of characters, empty for automatic, or invalid.
 * @inputs text - The prompt's answer.
 * @outputs number | null | 'invalid' - The width, null to clear the hint, or 'invalid' for anything else.
 * @dataflow text -> trimmed -> empty, or digits within 1..MAX_WIDTH_HINT.
 * @controlflow Empty gives null; only digits within range give a number; the rest is invalid.
 */
export function parseWidthHint(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  // An empty answer means automatic: the column sizes to its content.
  if (trimmed === '') {
    return null;
  } else if (/^\d+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= MAX_WIDTH_HINT) {
    return Number(trimmed);
  } else {
    // Not a whole number in range: letters, decimals, zero, or too wide.
    return 'invalid';
  }
}

/**
 * @purpose Locates the header cell directly above the caret's column and reports its document position and current width hint.
 * @inputs state: EditorState - The current ProseMirror editor state whose schema carries the table nodes.
 * @outputs { pos: number; hint: number | null } | null - The header cell's absolute position and stored `widthHint` (null when automatic), or null when the caret is outside a table or its column is not reached by the header row.
 * @dataflow tableAt(state) -> validate the header row reaches the caret column -> walk header cells to accumulate positions -> read the widthHint attribute -> return the resolved position/hint pair.
 * @controlflow Query tableAt -> if null return null -> fetch header row -> if cellIndex >= childCount return null -> accumulate nodeSize across preceding header cells -> read and validate the hint -> return { pos, hint }.
 */
function headerCellPos(state: EditorState): { readonly pos: number; readonly cell: ProseMirrorNode; readonly hint: number | null } | null {
  // The document position and current hint of the header cell above the caret's column, or null outside a table.
  const ctx = tableAt(state);
  if (ctx === null) {
    // The caret is not inside any table: there is no header cell to resolve.
    return null;
  } else {
    // The caret sits inside a table: the header row lives at child index 0.
  }

  const header = ctx.table.child(0);
  // The header row node, which carries the width hints for every column.

  // A ragged table can have a caret column the header row does not reach.
  if (ctx.cellIndex >= header.childCount) {
    // The header row has fewer cells than the caret's column index: no hint exists for this column.
    return null;
  } else {
    // The header row spans the caret's column: its cell holds the width hint.
  }

  let pos = ctx.tablePos + 2;
  // Start at the first header cell: tablePos + 2 steps over the table's opening token and the header row's opening token to reach it.

  for (let index = 0; index < ctx.cellIndex; index += 1) {
    // Accumulate nodeSize across every header cell preceding the target column.
    pos += header.child(index).nodeSize;
    // Advance past each preceding header cell to land on the target column's cell.
  }

  const cell = header.child(ctx.cellIndex);
  const hint: unknown = cell.attrs['widthHint'];
  // The raw widthHint attribute, typed loosely by ProseMirror and validated below because `any` is forbidden.

  return { pos, cell, hint: typeof hint === 'number' ? hint : null };
  // Return the resolved position with the hint narrowed to a number or null (automatic sizing).
}

/**
 * @purpose Returns the width hint stored on the header cell above the caret's column.
 * @inputs state: EditorState - The current ProseMirror editor state whose schema carries the table nodes.
 * @outputs number | null | undefined - A numeric hint, null for automatic columns, or undefined when the caret is outside a table.
 * @dataflow headerCellPos(state) -> distinguish null (outside table) from a resolved cell -> return its hint field.
 * @controlflow Query headerCellPos -> if null return undefined; else return the resolved hint.
 */
export function columnWidthHintAt(state: EditorState): number | null | undefined {
  // The caret column's hint: a number, null for automatic, or undefined outside a table.
  const found = headerCellPos(state);
  if (found === null) {
    // No header cell was resolved: the caret is outside a table, so there is no hint to report.
    return undefined;
  } else {
    // A header cell was resolved: its stored hint is the answer.
    return found.hint;
  }
}

/**
 * @purpose Returns a ProseMirror command that sets (or clears with null) the width hint of the caret column's header cell.
 * @inputs width: number | null - The desired whole-number character width in [1, MAX_WIDTH_HINT], or null to reset to automatic sizing.
 * @outputs Command - A command predicate that validates the requested width and applies a structural node-markup edit when valid.
 * @dataflow Validate width -> locate header cell via headerCellPos -> compare against current hint -> setNodeMarkup with updated attrs plus structural meta -> dispatch.
 * @controlflow Reject invalid widths early -> if no header cell or value unchanged return false -> on dispatch build a tr and apply it; otherwise confirm the change applies as a dry run.
 */
export function setColumnWidthHint(width: number | null): Command {
  // Sets the caret column's hint, or clears it with null. Refuses a width that is not a whole number from 1 to MAX_WIDTH_HINT, and a change to the value already set.
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (width !== null && (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH_HINT)) {
      // The requested width is non-automatic but fails validation: reject before touching the document.
      return false;
    } else {
      // The width is automatic (null) or a valid whole number within range: proceed to locate the target cell.
    }

    const found = headerCellPos(state);
    if (found === null || found.hint === width) {
      // No header cell exists, or the hint already equals the requested value: there is nothing to change.
      return false;
    } else {
      // A distinct new hint applies to an existing header cell: build and apply the edit.
    }

    if (dispatch !== undefined) {
      // The command was invoked with a dispatch callback: perform the structural write.
      const tr = state.tr.setNodeMarkup(found.pos, undefined, { ...found.cell.attrs, widthHint: width });
      // Replace the header cell's markup in place, preserving all existing attributes and overriding only widthHint.

      // Structural: a width change is its own undo step rather than merging into typing.
      tr.setMeta('kdocStructural', true);
      dispatch(tr);
    } else {
      // Dry run: no dispatch callback was supplied, so the command reports success without writing.
    }

    return true;
  };
}