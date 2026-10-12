/**
 * @file table-query.ts
 * @purpose Pure ProseMirror read-only queries for GFM tables, locating the enclosing table around the caret
 *   (`tableAt`, `isInTable`) and inspecting its shape (`columnCountOf`, `tableAlign`). Every result is derived solely
 *   from EditorState and Node data with no DOM access, which enables direct headless Node testing (a package-wide test
 *   asserts that no `document.`/`window.` identifier appears here). The schema modelled follows mdast, where there is no
 *   separate header node: row 0 IS the header row.
 * @inputs ProseMirror EditorState instances and table Node values describing GFM table structure.
 * @outputs TableContext query results, boolean membership flags, column counts, and per-column alignment arrays.
 * @functions
 *   - tableAt: Returns a TableContext locating the caret inside its enclosing table, or null when none is present.
 *   - isInTable: Reports whether the current selection sits inside any GFM table.
 *   - columnCountOf: Returns the widest row's cell count for a table node (0 when it has no rows).
 *   - tableAlign: Reads the defensive `align` attribute into a validated ColumnAlign array.
 *   (also exports ColumnAlign and TableContext, value-less types describing alignment tokens and resolved positions.)
 * @dataflow EditorState / Node -> ancestor walk / child scan -> TableContext, boolean, number, or ColumnAlign[] result.
 * @controlflow Extract $from -> iterate depth from $from.depth down to 1: fetch ancestor node -> if it is `table`, assemble & return context; else climb -> fall through to null after the loop.
 * @version 1
 * @date 2026-09-05
 */

import type { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * The resolved horizontal alignment for a single table column, or null when the source value is not one of the known tokens.
 */
export type ColumnAlign = 'left' | 'center' | 'right' | null;

/**
 * A resolved view of where the caret sits inside an enclosing GFM table, including absolute positions useful for structural edits.
 */
export interface TableContext {
  readonly table: ProseMirrorNode;
  readonly tablePos: number;
  readonly rowIndex: number;
  readonly cellIndex: number;
  readonly columnCount: number;
}

/**
 * @purpose Locates the GFM table enclosing the current selection and records where the caret sits inside it.
 * @inputs state: EditorState - The current ProseMirror editor state whose schema carries the table nodes.
 * @outputs TableContext | null - A context locating the caret within its table, or null when the caret is not in a table.
 * @dataflow Resolves $from from selection -> climbs ancestor nodes by depth -> matches the `table` node -> indexes row and cell -> assembles context.
 * @controlflow Extract $from -> for each depth fetch ancestor node -> if it is `table`, assemble & return context; else climb -> fall through to null after the loop.
 */
export function tableAt(state: EditorState): TableContext | null {
  const { $from } = state.selection;
  // The resolved position at the start of the selection drives the ancestor walk upward from the caret.

  for (let depth = $from.depth; depth > 0; depth--) {
    // Walk ancestors from the outermost enclosing node down toward the immediate parent, testing each in turn.
    const node = $from.node(depth);
    // The ancestor node at the current depth in the walk upward.
    if (node.type.name === 'table') {
      // This ancestor is the GFM table: capture its position and the caret's row/cell coordinates within it.
      const table = node;
      // The enclosing table node itself.
      const tablePos = $from.before(depth);
      // Position immediately BEFORE the table node at this depth — exactly what a later `tr.replaceWith(tablePos, tablePos + table.nodeSize, ...)` needs; using `$from.start(depth)` instead would be off by one and corrupt the document.
      const rowIndex = $from.index(depth);
      // Index of the row child within the table (the table's direct child that contains the caret).
      const cellIndex = depth + 1 <= $from.depth ? $from.index(depth + 1) : 0;
      // Index of the cell child within that row; guarded because a selection can sit directly on the table node with no deeper child.
      return { table, tablePos, rowIndex, cellIndex, columnCount: columnCountOf(table) };
      // Return the fully resolved context now that the enclosing table has been located.
    } else {
      // This ancestor is not the table: keep climbing toward the document root.
    }
  }

  return null;
  // No `table` ancestor was encountered: the caret does not live inside a GFM table.
}

/**
 * @purpose Reports whether the current selection sits inside any GFM table.
 * @inputs state: EditorState - The current ProseMirror editor state to test.
 * @outputs boolean - True when `tableAt` locates an enclosing table; false otherwise.
 * @dataflow Delegates to tableAt(state) -> compares its result against null -> returns the boolean membership flag.
 * @controlflow Query tableAt -> return whether the resulting context is non-null.
 */
export function isInTable(state: EditorState): boolean {
  return tableAt(state) !== null;
  // Membership holds exactly when an enclosing table context can be resolved.
}

/**
 * @purpose Returns the widest row's cell count for a table node, guarding against ragged rows.
 * @inputs table: ProseMirrorNode - A GFM `table` node whose rows should be measured.
 * @outputs number - The maximum child (cell) count across all rows, or 0 when the table has no rows.
 * @dataflow Iterates each row child -> reads its cell count -> keeps the running maximum -> returns it as the column count.
 * @controlflow Initialise widest to 0 -> for each row: take the larger of widest and that row's cell count -> return widest.
 */
export function columnCountOf(table: ProseMirrorNode): number {
  let widest = 0;
  // The largest cell count seen so far across all rows, starting from an empty table.

  for (let i = 0; i < table.childCount; i++) {
    // Iterate every row child of the table node.
    const row = table.child(i);
    // The row at index `i`.
    if (row.childCount > widest) {
      // This row is wider than any seen so far: adopt its cell count as the new maximum.
      widest = row.childCount;
    } else {
      // This row is no wider than the current maximum: leave `widest` unchanged.
    }
  }

  return widest;
  // Return the widest row's cell count, which sizes a rebuilt table without truncating ragged data.
}

/**
 * @purpose Reads the defensive `align` attribute into a validated per-column alignment array.
 * @inputs table: ProseMirrorNode - A GFM `table` node carrying an optional `align` array attribute.
 * @outputs readonly ColumnAlign[] - One aligned token per entry, mapping unknown values to null; [] when the attr is absent or not an array.
 * @dataflow Reads table.attrs['align'] -> validates it is an array -> maps each entry to a known token or null -> returns the mapped list.
 * @controlflow Extract raw align value -> if not an array return [] -> map entries (known token vs null) -> return mapped readonly array.
 */
export function tableAlign(table: ProseMirrorNode): readonly ColumnAlign[] {
  const raw = table.attrs['align'];
  // The `align` attribute, typed loosely by ProseMirror; validated below because the project forbids `any`.

  if (!Array.isArray(raw)) {
    // The attribute is missing or not an array: there are no column alignments to report.
    return [];
  } else {
    // The attribute is a valid array: map each entry through alignment validation.
  }

  // Map each entry to itself when it is exactly a known alignment token; otherwise null.
  const aligned = raw.map((entry: unknown) =>
    entry === 'left' || entry === 'center' || entry === 'right' ? entry : null
  );
  // Each entry narrows to its literal token under the equality checks, yielding ColumnAlign values with no `any` leaking through.

  return aligned;
  // Return the validated readonly array of per-column alignments.
}
