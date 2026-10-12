/**
 * @file paste-table.ts
 * @purpose Converts tab-separated clipboard text into a GFM table ProseMirror node structure (FR-7.4).
 *
 *   Copying a range out of Excel, Google Sheets or a Word table puts tab-separated text on the clipboard.
 *   Pasted as Markdown that is one long line with tabs in it — technically correct and useless, because the
 *   thing the user copied was a table and what they get is not one.
 *
 *   The split is on tabs, not commas. A comma is ordinary punctuation in prose and a spreadsheet only emits
 *   commas when the user asks for CSV; a tab in pasted text almost always came from a grid. Guessing at commas
 *   would turn `Hello, world` into a two-column table, and being wrong there is worse than not offering the
 *   option at all.
 *
 *   The first row becomes the header, because GFM has no table without one. That is a decision made for
 *   the user rather than by them, so it is worth saying: the alternative is inventing an empty header row,
 *   which is a row of nothing at the top of their data.
 *
 * @inputs Tab-delimited plain text string from the clipboard; parsed DelimitedTable grid structures.
 * @outputs Parsed DelimitedTable grid or null; constructed ProseMirror table Node or null.
 * @functions
 *   - parseDelimitedText: Reads tab-separated clipboard text into a rectangular grid, or reports that it is not tabular.
 *   - buildTableNode: Builds the ProseMirror table node for a parsed grid, or null when the schema has no table.
 * @dataflow Tab-delimited text → line splitting & validation → rectangular padded grid (DelimitedTable) →
 *   ProseMirror tableCell / tableRow / table nodes with neutral alignments.
 * @controlflow parseDelimitedText validates text and constructs a rectangular matrix of strings; buildTableNode
 *   resolves schema node types and maps cell matrices into a ProseMirror table node hierarchy.
 * @version 1
 * @date 2026-09-11
 */

import { kdocSchema } from './schema.js';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export interface DelimitedTable {
  readonly rows: readonly (readonly string[])[];
  readonly columns: number;
}

/**
 * Reads tab-separated clipboard text into a rectangular grid, or reports that it is not tabular.
 *
 * @purpose Reads tab-separated clipboard text into a rectangular grid, or reports that it is not tabular.
 * @inputs text - Raw clipboard string to evaluate and parse as a tab-delimited table.
 * @outputs DelimitedTable | null - Rectangular table representation with frozen string arrays, or null if text is not tabular.
 * @dataflow text -> split lines -> drop trailing newline -> validate tabs -> split cells & trim -> pad short rows to maximum width -> frozen DelimitedTable.
 * @controlflow Guard empty text -> drop trailing empty line -> guard empty lines -> guard missing tabs on any line -> split cells -> compute max width -> pad rows -> guard width < 2 -> return frozen table.
 */
export function parseDelimitedText(text: string): DelimitedTable | null {
  // Check if input text is empty or whitespace-only; nothing to read.
  if (text.trim().length === 0) {
    return null;
  }

  const lines = text.split(/\r\n|\r|\n/);

  // A copied range usually ends with a newline and an empty final row would be a row of blank cells; drop a single trailing empty line if present.
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  // Check if lines array is empty after dropping any trailing empty line; return null if there is no content.
  if (lines.length === 0) {
    return null;
  }

  // Every line must contain at least one tab; a single line with no tab is prose, and this is the whole test that keeps ordinary text from becoming a one-column table.
  if (!lines.every((line) => line.includes('\t'))) {
    return null;
  }

  const rawRows: string[][] = lines.map((line) =>
    line.split('\t').map((cell) => cell.trim()),
  );

  let width = 0;
  for (const row of rawRows) {
    // Check if the current row length exceeds the maximum width tracked so far.
    if (row.length > width) {
      width = row.length;
    } else {
      // Row length is within current maximum width; maintain existing width.
    }
  }

  // A ragged paste is normal — a spreadsheet range with a merged cell produces one — and padding is the only way to get a table out of it at all, since GFM tables are rectangular.
  const paddedRows: string[][] = [];
  for (const row of rawRows) {
    const padded = [...row];
    while (padded.length < width) {
      padded.push('');
    }
    paddedRows.push(padded);
  }

  // There is deliberately no minimum-width check here. Every line was already required to contain a
  // tab, and splitting a string that contains one always yields at least two parts, so a width below
  // two is unreachable. The tab gate above is the single place that decides whether this text is a
  // grid at all, and a second guard saying the same thing would only hide that.

  const rows: readonly (readonly string[])[] = Object.freeze(
    paddedRows.map((row) => Object.freeze([...row])),
  );

  return {
    rows,
    columns: width,
  };
}

/**
 * Builds the ProseMirror table node for a parsed grid, or null when the schema has no table.
 *
 * @purpose Builds the ProseMirror table node for a parsed grid, or null when the schema has no table.
 * @inputs table - DelimitedTable structure containing rectangular rows of strings and a column count.
 * @outputs ProseMirrorNode | null - The constructed ProseMirror table node, or null if schema lacks table node types or table has no rows.
 * @dataflow table.rows & table.columns -> map cells to tableCell (or empty cell) -> map rows to tableRow -> construct table node with neutral alignments.
 * @controlflow Resolve table, tableRow, tableCell types (guard null) -> map each cell to cellType.create (empty vs non-empty) -> guard empty rows -> create align array -> return table node.
 */
export function buildTableNode(table: DelimitedTable): ProseMirrorNode | null {
  const tableType = kdocSchema.nodes['table'];
  // Check if the table node type exists in the schema.
  if (tableType === undefined) {
    return null;
  }

  const rowType = kdocSchema.nodes['tableRow'];
  // Check if the tableRow node type exists in the schema.
  if (rowType === undefined) {
    return null;
  }

  const cellType = kdocSchema.nodes['tableCell'];
  // Check if the tableCell node type exists in the schema.
  if (cellType === undefined) {
    return null;
  }

  const rowNodes: ProseMirrorNode[] = table.rows.map((row) => {
    const cellNodes: ProseMirrorNode[] = row.map((cell) => {
      // Check whether the cell text is empty; ProseMirror refuses an empty text node so an empty cell has to be an empty cell rather than a cell holding nothing.
      if (cell.length === 0) {
        // Empty cell: ProseMirror refuses an empty text node, so pass undefined to create an empty cell.
        return cellType.create(null, undefined);
      } else {
        // Non-empty cell: populate the cell with a ProseMirror text node.
        return cellType.create(null, kdocSchema.text(cell));
      }
    });
    return rowType.create(null, cellNodes);
  });

  // Check if the table contains any rows; an empty table is invalid in the schema (tableRow+).
  if (table.rows.length === 0) {
    return null;
  }

  // Pasted data carries no alignment and inventing one would be asserting something about the user's data that they did not say.
  const align = new Array(table.columns).fill(null);

  return tableType.create({ align }, rowNodes);
}
