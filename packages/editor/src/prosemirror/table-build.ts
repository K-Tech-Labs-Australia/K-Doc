/**
 * @file table-build.ts
 * @purpose Pure builders that construct GFM (GitHub Flavored Markdown) table nodes and compute document positions inside them,
 *   without touching the DOM or any ProseMirror state/transaction object.
 * @inputs A ProseMirror Schema for node-type resolution; existing table nodes to read from; plain arrays of cell and row nodes;
 *   column-alignment values; and positional arguments for caret placement after a rebuild.
 * @outputs Replacement `table`, `tableRow`, and `tableCell` nodes; a 2-D array of cells; an integer document position.
 * @functions
 *   - rowsOf: Read a table's cells into a plain 2-D array of row arrays.
 *   - emptyCell: Build a single empty `tableCell` node from the schema.
 *   - emptyRow: Build a row of N (floored at one) empty cells from the schema.
 *   - buildTable: Rebuild a whole rectangular table from rows and column alignments.
 *   - cellStartPos: Compute the first content position inside a given cell.
 *   - padAlign: Expand or truncate an alignment list to exactly `columns` entries.
 * @dataflow Existing table nodes → plain arrays (rowsOf) → transformed/padded arrays → new table node (buildTable);
 *   positional args → accumulated node sizes → integer document position (cellStartPos).
 * @controlflow Every function is a pure read/transform/build step with no shared mutable state; buildTable orchestrates width
 *   computation, per-row padding, and node construction before attaching the alignment attribute.
 * @version 1
 * @date 2026-09-05
 *
 * Why this file rebuilds whole tables: every structural table edit here works by reading the table's cells into plain arrays,
 * transforming those arrays, and building a replacement table node, rather than by splicing ProseMirror positions in place.
 * Tables are small, so the cost is irrelevant, and position arithmetic across nested `table > row > cell` is where this kind of
 * code goes wrong: an off-by-one silently corrupts the document rather than failing. Rebuilding makes every operation a plain
 * array operation that can be read and checked by eye. Note that mdast has no header node — row 0 IS the header — so headers are
 * ordinary rows here and require no special handling.
 */

import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import type { ColumnAlign } from './table-query.js';

/**
 * @purpose Read a table's cells into a plain 2-D array of row arrays, decoupling callers from the ProseMirror node tree so that
 *   structural edits can operate on ordinary arrays.
 * @inputs table - The parent `table` node whose rows and cells are enumerated.
 * @outputs A new array of row arrays; each inner array holds the row's cell nodes in document order.
 * @dataflow table.child(i) → row.node(j), collected per row, pushed into the result 2-D array.
 * @controlflow Outer loop over `table.childCount`; inner loop over each row's `childCount`, pushing a fresh array per row.
 */
export function rowsOf(table: ProseMirrorNode): ProseMirrorNode[][] {
  const rows: ProseMirrorNode[][] = [];
  // Enumerate every row child of the table node.
  for (let i = 0; i < table.childCount; i++) {
    const row = table.child(i);
    const cells: ProseMirrorNode[] = [];
    // Enumerate every cell child of this row, preserving document order.
    for (let j = 0; j < row.childCount; j++) {
      cells.push(row.child(j));
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * @purpose Build a single empty `tableCell` node from the schema, for use in row construction and padding.
 * @inputs schema - The ProseMirror schema used to resolve the `tableCell` node type.
 * @outputs A new `tableCell` node with no content, which is legal because its content expression is `inline*`.
 * @dataflow schema.nodes['tableCell'] → resolved NodeType → NodeType.create() empty cell node.
 * @controlflow Resolve the node type; throw when it is missing (a wiring error); otherwise return an empty create().
 */
export function emptyCell(schema: Schema): ProseMirrorNode {
  const type = schema.nodes['tableCell']; // NodeType | undefined under noUncheckedIndexedAccess.
  if (type === undefined) {
    // A schema without table nodes is a programming error at wiring time, not a runtime condition to handle.
    throw new Error('Schema has no tableCell node');
  }
  // The node type exists; build an empty cell whose `inline*` content allows zero children.
  return type.create();
}

/**
 * @purpose Build a row of N empty cells from the schema, for use as a fresh or placeholder table row.
 * @inputs schema - The ProseMirror schema used to resolve the `tableRow` node type.
 *   columns - Requested number of cells; floored at one because an empty row is illegal.
 * @outputs A new `tableRow` node containing `Math.max(1, columns)` empty cell nodes.
 * @dataflow schema.nodes['tableRow'] → resolved NodeType + N empty cells → create(null, cells) row node.
 * @controlflow Resolve the node type; throw when missing (a wiring error); otherwise build and return the row.
 */
export function emptyRow(schema: Schema, columns: number): ProseMirrorNode {
  const type = schema.nodes['tableRow']; // NodeType | undefined under noUncheckedIndexedAccess.
  if (type === undefined) {
    // A schema without table nodes is a programming error at wiring time, not a runtime condition to handle.
    throw new Error('Schema has no tableRow node');
  }
  // `tableCell+` forbids an empty row, so floor the column count at one; otherwise create() would throw deep inside ProseMirror.
  const cells: ProseMirrorNode[] = [];
  for (let i = 0; i < Math.max(1, columns); i++) {
    cells.push(emptyCell(schema));
  }
  return type.create(null, cells);
}

/**
 * @purpose Rebuild a whole rectangular table from plain row arrays and column alignments, so that structural edits land as a
 *   single validated node instead of fragile in-place position surgery.
 * @inputs schema - The ProseMirror schema used to resolve `table`/`tableRow` node types.
 *   rows - Input rows; each is an array of cell nodes and may be ragged (shorter than the widest row).
 *   align - Column alignments, one per source column; padded/truncated to the rebuilt table width.
 * @outputs A new `table` node whose rows are rectangular and whose `align` attribute has exactly one entry per column.
 * @dataflow rows → padded rectangular cell arrays → tableRow nodes → table.create({ align }, rowNodes).
 * @controlflow Resolve types (throw on missing); compute target width; pad each input row or synthesize one empty row; attach alignment.
 */
export function buildTable(
  schema: Schema,
  rows: readonly (readonly ProseMirrorNode[])[],
  align: readonly ColumnAlign[],
): ProseMirrorNode {
  const tableType = schema.nodes['table']; // NodeType | undefined under noUncheckedIndexedAccess.
  if (tableType === undefined) {
    // A schema without a table node is a wiring error; fail loudly rather than building an invalid tree.
    throw new Error('Schema has no table node');
  }
  const rowType = schema.nodes['tableRow']; // NodeType | undefined under noUncheckedIndexedAccess.
  if (rowType === undefined) {
    // A schema without a tableRow node is a wiring error; fail loudly rather than building an invalid tree.
    throw new Error('Schema has no tableRow node');
  }

  // Compute the target width as the largest input row length; when there are no rows at all, default to one column.
  let columns = rows.length === 0 ? 1 : 0;
  if (rows.length > 0) {
    for (const inputRow of rows) {
      // `inputRow` is a concrete element from the array, so its length is safe to read directly.
      if (inputRow.length > columns) {
        columns = inputRow.length;
      }
    }
  }

  const rowNodes: ProseMirrorNode[] = [];
  if (rows.length === 0) {
    // `tableRow+` forbids an empty table; synthesize a single empty row when no rows were supplied.
    rowNodes.push(emptyRow(schema, columns));
  } else {
    for (const inputRow of rows) {
      // Copy the existing cells, then append empty cells until the row reaches the target width.
      const paddedCells: ProseMirrorNode[] = [...inputRow];
      while (paddedCells.length < columns) {
        // Append an empty cell to widen this row so the rebuilt table is rectangular.
        paddedCells.push(emptyCell(schema));
      }
      // A ragged table serialises to Markdown that re-parses with a different shape, so padding keeps every edit consistent.
      rowNodes.push(rowType.create(null, paddedCells));
    }
  }

  return tableType.create({ align: padAlign(align, columns) }, rowNodes);
}

/**
 * @purpose Normalise a column-alignment list to exactly `columns` entries so every rebuilt table has one alignment per column.
 * @inputs align - The caller-supplied alignments; may be shorter or longer than the target width.
 *   columns - The exact number of entries the returned array must contain.
 * @outputs A new array of length `columns`; existing alignments copied in order (missing slots default to null), any shortfall
 *   filled by null, and any surplus beyond `columns` dropped.
 * @dataflow align[j] (guarded) → aligned output slot, padded or truncated to exactly `columns`.
 * @controlflow Single loop over the target width; guard each indexed read against noUncheckedIndexedAccess, defaulting to null.
 */
export function padAlign(align: readonly ColumnAlign[], columns: number): ColumnAlign[] {
  const result: ColumnAlign[] = [];
  for (let j = 0; j < columns; j++) {
    // Guard the indexed read against noUncheckedIndexedAccess so a short alignment list never throws.
    if (j < align.length) {
      // Copy the existing alignment, coercing an undefined slot to null via the nullish coalescer.
      result.push(align[j] ?? null);
    } else {
      // The alignment list is shorter than the target width; fill the shortfall with null.
      result.push(null);
    }
  }
  return result;
}

/**
 * @purpose Compute the first content document position inside a given cell, for placing a caret after a rebuild.
 * @inputs table - The rebuilt `table` node whose positions are being computed.
 *   tablePos - The opening document position of the table node itself.
 *   rowIndex - Zero-based index of the target row within the table.
 *   cellIndex - Zero-based index of the target cell within that row.
 * @outputs The document position just inside the target cell's opening token (its first content position).
 * @dataflow tablePos → +1 for table open → sum of preceding rows' nodeSizes → +1 for row open → sum of preceding cells' nodeSizes
 *   → +1 for cell open → returned position.
 * @controlflow Clamp rowIndex and cellIndex into range, then accumulate node sizes along the table > row > cell path.
 */
export function cellStartPos(
  table: ProseMirrorNode,
  tablePos: number,
  rowIndex: number,
  cellIndex: number,
): number {
  // Clamp rowIndex into [0, table.childCount - 1]; a caller asking for a row deleted by a prior edit is expected.
  const safeRowIndex = Math.min(Math.max(rowIndex, 0), table.childCount - 1);
  let pos = tablePos + 1; // Step over the table's own opening token.
  for (let i = 0; i < safeRowIndex; i++) {
    // Accumulate each preceding row's node size to reach the target row's opening position.
    pos += table.child(i).nodeSize;
  }
  const row = table.child(safeRowIndex);
  pos += 1; // Step over the row's own opening token.
  // Clamp cellIndex into [0, row.childCount - 1]; a caller asking for a cell deleted by a prior edit is expected.
  const safeCellIndex = Math.min(Math.max(cellIndex, 0), row.childCount - 1);
  for (let j = 0; j < safeCellIndex; j++) {
    // Accumulate each preceding cell's node size to reach the target cell's opening position.
    pos += row.child(j).nodeSize;
  }
  pos += 1; // Step over the cell's own opening token.
  return pos;
}
