/**
 * @file column-widths.ts
 * @purpose Column width hints for GFM tables: derive, store, and apply minimum-character-width hints that padded serializers preserve.
 * @inputs Markdown source text; an mdast Root tree containing table nodes; aligned source lines and delimiter cells.
 * @outputs ColumnWidthHints arrays stored on table node data; widened serialized table strings; split cell arrays.
 * @functions
 *   - splitTableRow: Split one raw table line into its unescaped pipe-delimited cells.
 *   - delimiterMinimum: Return the shortest delimiter cell length an alignment requires.
 *   - columnWidthHints: Derive per-column width hints from source lines and alignments.
 *   - hintsOf: Read and validate hints stored on a table node.
 *   - annotateTableWidths: Walk a parsed tree and record each table's hints from its source delimiter row.
 *   - applyColumnWidths: Widen a padded serialized table so hinted columns meet their minimum widths.
 * @dataflow Source text → splitTableRow/columnWidthHints → ColumnWidthHints → stored on node.data (annotateTableWidths) or applied to serialized output (applyColumnWidths).
 * @controlflow Pure derivation and read helpers feed annotateTableWidths's tree walk; applyColumnWidths transforms already-serialized tables.
 * @version 1
 * @date 2026-09-15
 */

import type { AlignType, Root, RootContent, Table } from 'mdast';

export type ColumnWidthHints = readonly (number | null)[];

/** The key under a table node's `data` holding its hints. */
export const COLUMN_WIDTHS_KEY = 'kdocColumnWidths';

/**
 * @purpose Splits one raw table line into its cell strings.
 * @inputs line - A single source line of a GFM table (header, delimiter, or body row).
 * @outputs string[] - The cells: the text between unescaped pipes, with any outer pipe removed.
 * @dataflow Raw line → trimmed and de-piped string → character scan → array of cell strings.
 * @controlflow Trim → drop one leading pipe if present → drop one trailing pipe unless escaped → scan characters splitting on unescaped pipes while preserving backslash escapes → append final cell → return.
 */
// Examples:
//   splitTableRow('| a | b |') -> [' a ', ' b ']
//   splitTableRow('a|b') -> ['a', 'b']
//   splitTableRow('| x \| y | z |') -> [' x \| y ', ' z '] (the escaped pipe stays in the cell)
export function splitTableRow(line: string): string[] {
  // Work on a trimmed copy so surrounding whitespace does not affect parsing.
  let row = line.trim();

  // Strip a single leading outer pipe if present.
  if (row.startsWith('|')) {
    // Remove the leading pipe character.
    row = row.slice(1);
  } else {
    // No leading pipe to remove; leave the row unchanged.
  }

  // Strip a single trailing outer pipe, unless it is an escaped pipe ('\' + '|').
  if (row.endsWith('|') && !row.endsWith('\\|')) {
    // Remove the trailing pipe character.
    row = row.slice(0, -1);
  } else {
    // No unescaped trailing pipe to remove; leave the row unchanged.
  }

  // Accumulate cells as we scan characters.
  const cells: string[] = [];
  let current = '';

  // Scan every character of the de-piped row.
  for (let index = 0; index < row.length; index += 1) {
    // noUncheckedIndexedAccess: guard the indexed access with a default empty string.
    const ch = row[index] ?? '';

    // Classify each character as an escape, a separator, or content.
    if (ch === '\\') {
      // An escaped character: copy the backslash and its following character verbatim. A backslash ending the row has no
      // following character, which `?? ''` covers.
      current += ch + (row[index + 1] ?? '');
      // Advance past both the backslash and the escaped character.
      index += 1;
    } else if (ch === '|') {
      // A cell separator: close the current cell and start a new one.
      cells.push(current);
      current = '';
    } else {
      // Regular content: append to the current cell.
      current += ch;
    }
  }

  // Push the final cell, which has no trailing pipe after it.
  cells.push(current);

  return cells;
}

/**
 * @purpose Returns the shortest delimiter cell the serializer writes for an alignment.
 * @inputs align - The column's alignment, or undefined for default (left) alignment.
 * @outputs number - 1 for '-', 2 for ':-'/'-:', or 3 for ':-:'.
 * @dataflow Alignment value → matched against known alignments → delimiter length in characters.
 * @controlflow Check center first, then left/right, falling back to the default; return each branch's length.
 */
export function delimiterMinimum(align: AlignType | undefined): number {
  // The shortest delimiter cell the serializer writes for an alignment: '-' alone, ':-' or '-:', or ':-:'.
  if (align === 'center') {
    // Centered tables use ':-:' which has three characters.
    return 3;
  } else if (align === 'left' || align === 'right') {
    // Left- and right-aligned tables use ':-' or '-:' which have two characters.
    return 2;
  } else {
    // Default (unspecified) alignment uses '-' which has one character.
    return 1;
  }
}

/**
 * @purpose Derives per-column width hints from a table's source lines, or null when none exist.
 * @inputs lines - The source lines in order [header, delimiter, ...body]; align - Per-column alignment aligned with the header columns.
 * @outputs ColumnWidthHints | null - A hint (minimum character width) per column, or null when no column qualifies.
 * @dataflow Source lines → split into cells → compare each delimiter cell width against its widest content and minimum delimiter → emit hints.
 * @controlflow Require a delimiter row → split it and every other row → map columns to hints → return the array only if at least one hint exists.
 */
// Examples:
//   columnWidthHints(['| a | b |', '| --------- | - |', '| x | y |'], [null, null]) -> [9, null]
//   columnWidthHints(['| a | b |', '| - | - |'], []) -> null
//   columnWidthHints(['| Name |', '| :--: |'], ['center']) -> null (4 dashes-with-colons vs content 4)
//   columnWidthHints(['| a |', '| :---------: |'], ['center']) -> [11]
//   columnWidthHints(['| a |'], []) -> null
export function columnWidthHints(lines: readonly string[], align: readonly (AlignType | undefined)[]): ColumnWidthHints | null {
  // The delimiter row is always the second line of a table source block.
  const delimiter = lines[1];

  // A table requires a delimiter row; without it, no hints can be derived.
  if (delimiter === undefined) {
    // No delimiter row present; cannot derive hints.
    return null;
  } else {
    // A delimiter row exists; continue to hint derivation below.
  }

  // Split the delimiter row into its individual cells.
  const delimiterCells = splitTableRow(delimiter);

  // Split every line except the delimiter row (index 1) into cells for content measurement.
  const rows = lines.filter((_line, index) => index !== 1).map(splitTableRow);

  // Compute a hint per column from the delimiter cell and its content width.
  const hints = delimiterCells.map((cell, column) => {
    // The visible width of the delimiter cell's dashes/colons.
    const width = cell.trim().length;
    // The widest trimmed content across all non-delimiter rows for this column (0 when no rows).
    const content = Math.max(0, ...rows.map((row) => (row[column] ?? '').trim().length));

    // A column has a hint when its delimiter cell is wider than both its widest content and the minimum delimiter for its alignment.
    return width > Math.max(content, delimiterMinimum(align[column] ?? undefined)) ? width : null;
  });

  // Return the full hint array only when at least one column has a hint; otherwise report no hints.
  return hints.some((hint) => hint !== null) ? hints : null;
}

/**
 * @purpose Reads the width hints stored on a table node, validating their shape.
 * @inputs table - An mdast table node whose data may hold previously recorded hints.
 * @outputs ColumnWidthHints | null - The validated hints, or null when absent or malformed.
 * @dataflow Node data → extract kdocColumnWidths value → validate entries → return or reject.
 * @controlflow Read the stored value → require an array → verify every entry is a positive integer or null with at least one column → return or null.
 */
export function hintsOf(table: Table): ColumnWidthHints | null {
  // Read the stored hints from the node's data; treat missing data as no value.
  const value: unknown = table.data === undefined ? undefined : (table.data as Record<string, unknown>)[COLUMN_WIDTHS_KEY];

  // The stored value must be an array to hold per-column hints.
  if (!Array.isArray(value)) {
    // Not an array; no valid hints present.
    return null;
  } else {
    // An array of entries; validate each entry below.
  }

  // Every entry must be either null or a strictly positive integer.
  const valid = value.every((entry: unknown) => entry === null || (typeof entry === 'number' && Number.isInteger(entry) && entry > 0));

  // Return the validated hints only when every entry is valid and at least one column exists; otherwise report no hints.
  return valid && value.length > 0 ? (value as ColumnWidthHints) : null;
}

/**
 * @purpose Records each table's width hints under data.kdocColumnWidths by reading the source delimiter row.
 * @inputs text - The original Markdown source, needed because the parsed tree drops dash counts; root - The parsed mdast tree to annotate in place.
 * @outputs void - Mutates table nodes' data in place with their derived hints.
 * @dataflow Source text → line array → tree walk → per-table source slice → columnWidthHints → stored on node.data.
 * @controlflow Split source into lines → recursively visit nodes → for each table, read its positioned source lines, derive hints, and store them; recurse through containers.
 */
export function annotateTableWidths(text: string, root: Root): void {
  // Split the source into physical lines using any common newline convention.
  const lines = text.split(/\r\n|\r|\n/);

  // Recursively walk the tree, annotating each table node with width hints.
  const visit = (node: Root | RootContent): void => {
    if (node.type === 'table') {
      // This node is a table; its source lines must be read from the original text.
      const start = node.position?.start;
      const end = node.position?.end;

      if (start !== undefined && end !== undefined) {
        // Both endpoints are present, so the table spans readable source lines.
        // A table inside a blockquote or list starts at a column after its container's prefix; each of its lines carries that prefix.
        const prefix = start.column - 1;
        const tableLines = lines.slice(start.line - 1, end.line).map((line) => line.slice(prefix));
        const hints = columnWidthHints(tableLines, node.align ?? []);

        if (hints !== null) {
          // Hints were derived; store them on the node's data.
          node.data = { ...node.data, [COLUMN_WIDTHS_KEY]: hints } as Table['data'];
        } else {
          // No hints could be derived; leave the node unchanged.
        }
      } else {
        // Missing position information: there are no source lines to read.
      }
    } else if ('children' in node) {
      // A container node with children: recurse into each child.
      for (const child of node.children as readonly RootContent[]) {
        visit(child);
      }
    } else {
      // A leaf node: it cannot contain any tables below it.
    }
  };

  // Annotate the whole tree starting from its root.
  visit(root);
}

/**
 * @purpose Widens a padded, pipe-aligned serialized table so each hinted column meets its minimum width.
 * @inputs tableText - A padded, pipe-aligned serialized GFM table; hints - Per-column minimum widths (null = no constraint); align - Per-column alignment for spacing the extra characters.
 * @outputs string - The widened serialized table with delimiter dashes and body-cell padding expanded per hint.
 * @dataflow Serialized lines → split into cells → compare each inner width to its hint → pad delimiter dashes or body content by alignment → rejoin into pipes.
 * @controlflow Map each physical line → widen qualifying columns (delimiter row adds dashes inside any leading colon; body rows add spaces by alignment) → reassemble with outer pipes.
 */
// Examples:
//   applyColumnWidths('| a | b |\n| - | - |\n| x | y |', [5, null], [null, null]) -> '| a     | b |\n| ----- | - |\n| x     | y |'
//   applyColumnWidths('| a |\n| -:\n| x |', [4], ['right']) -> '|    a |\n| ---: |\n|    x |'
export function applyColumnWidths(tableText: string, hints: ColumnWidthHints, align: readonly (AlignType | undefined)[]): string {
  return tableText.split('\n').map((line, lineIndex) => {
    const cells = splitTableRow(line);
    const widened = cells.map((cell, column) => {
      // The hint for this column, or null when the column is unconstrained.
      const hint = hints[column] ?? null;

      // A padded cell is one space, its content, one space.
      const inner = cell.slice(1, -1);

      // Leave the cell unchanged when there is no hint or it already meets the minimum width.
      if (hint === null || hint <= inner.length) {
        return cell;
      } else {
        // The column must be widened by `extra` characters below.
        const extra = hint - inner.length;
        let next: string;

        if (lineIndex === 1) {
          // Delimiter row: dashes go inside any leading colon, so ':--' stays left-aligned.
          next = inner.startsWith(':') ? `:${'-'.repeat(extra)}${inner.slice(1)}` : `${'-'.repeat(extra)}${inner}`;
        } else if (align[column] === 'right') {
          // Right alignment: add the extra spaces before the content.
          next = `${' '.repeat(extra)}${inner}`;
        } else if (align[column] === 'center') {
          // Center alignment: split the extra spaces, placing the smaller half first when odd.
          const before = Math.floor(extra / 2);
          next = `${' '.repeat(before)}${inner}${' '.repeat(extra - before)}`;
        } else {
          // Default (left) alignment: add the extra spaces after the content.
          next = `${inner}${' '.repeat(extra)}`;
        }

        return ` ${next} `;
      }
    });

    return `|${widened.join('|')}|`;
  }).join('\n');
}