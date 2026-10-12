/**
 * @file table-tsv.ts
 * @purpose Produces the plain-text (TSV) clipboard representation of copied ProseMirror table content so a spreadsheet pastes tables as cells; non-table content falls back to ProseMirror's default text serialization.
 * @inputs A ProseMirror Slice or Fragment describing copied content, containing table/tableRow/tableCell nodes or ordinary block nodes.
 * @outputs Tab-separated value string for table selections (tableRowsAsTsv) and the plain-text clipboard string for all other content (clipboardText).
 * @functions
 *   - cellText: Flattens a single table cell to text, collapsing tabs and line breaks into spaces.
 *   - rowLine: Joins a table row's cells with tab characters.
 *   - tableRowsAsTsv: Classifies a fragment as one table, whole rows, or cells of one row and returns its TSV, or null when unrecognized.
 *   - clipboardText: Returns the TSV for table content, otherwise ProseMirror-style paragraph text.
 * @dataflow Slice/Fragment → node traversal → cellText/rowLine transforms → joined TSV string (table) or newline-joined block text (fallback).
 * @controlflow Entry classifies fragment shape via a guarded if/else-if chain; returns TSV on match, null to trigger paragraph fallback in clipboardText.
 * @version 1
 * @date 2026-09-15
 */

import type { Fragment, Node as ProseMirrorNode, Slice } from 'prosemirror-model';

/**
 * @purpose Serializes a single table cell to plain text for TSV output.
 * @inputs cell - The ProseMirror node representing one table cell.
 * @returns Cell text with any embedded tab or line break replaced by a single space, keeping the cell intact when pasted into a spreadsheet.
 * @dataflow cell.textContent → regex replace of [tab/CR/LF]+ with space → returned string.
 * @controlflow No branching; applies a global substitution and returns.
 */
function cellText(cell: ProseMirrorNode): string {
  // A tab or line break inside a cell would split it in a spreadsheet; both become a space.
  return cell.textContent.replace(/[\t\r\n]+/g, ' ');
}

/**
 * @purpose Serializes one table row as a single tab-separated line.
 * @inputs row - The ProseMirror node representing one tableRow, whose children are cells.
 * @returns Row text with each cell's text joined by tab characters.
 * @dataflow row.children → per-cell cellText transform → array joined by '\t'.
 * @controlflow No branching; iterates cells building an array then joins once.
 */
function rowLine(row: ProseMirrorNode): string {
  const cells: string[] = [];
  row.forEach((cell) => {
    cells.push(cellText(cell));
  });
  return cells.join('\t');
}

/**
 * @purpose Classifies a fragment as one table, whole rows, or cells of one row and returns its tab-separated representation.
 * @inputs content - The ProseMirror Fragment being copied.
 * @returns TSV string when the fragment is recognized table content, otherwise null to signal that default text handling should apply.
 * @dataflow Fragment → top-level node array → shape classification → joined TSV lines (table/rows) or single line (cells).
 * @controlflow Guard on missing first node; if/else-if chain matches whole-table, all-rows, or all-cells shapes and returns the corresponding TSV, else returns null.
 */
export function tableRowsAsTsv(content: Fragment): string | null {
  // Collect the top-level nodes of the fragment into an array for indexing.
  const children: ProseMirrorNode[] = [];
  content.forEach((child) => {
    children.push(child);
  });

  // Indexing is guarded by noUncheckedIndexedAccess, so read the first element defensively.
  const first = children[0];

  // Guard: an empty fragment has no nodes and cannot be serialized as TSV.
  if (first === undefined) {
    return null;
  } else {
    // At least one node: classify the fragment below.
  }

  // Classify the fragment by its top-level node shape.
  if (children.length === 1 && first.type.name === 'table') {
    // A single whole table: emit every row on its own line.
    const lines: string[] = [];
    first.forEach((row) => {
      lines.push(rowLine(row));
    });
    return lines.join('\n');
  } else if (children.every((child) => child.type.name === 'tableRow')) {
    // A selection of whole rows: emit each row on its own line.
    return children.map(rowLine).join('\n');
  } else if (children.every((child) => child.type.name === 'tableCell')) {
    // Cells from a single row: join them as one tab-separated line.
    return children.map(cellText).join('\t');
  } else {
    // Not table content the clipboard format recognizes; signal default handling.
    return null;
  }
}

/**
 * @purpose Produces the plain-text clipboard payload for copied content.
 * @inputs slice - The ProseMirror Slice placed on the clipboard by a copy operation.
 * @returns Tab-separated values for table selections; otherwise each block node's text separated by blank lines, matching ProseMirror's default serialization.
 * @dataflow slice.content → tableRowsAsTsv → TSV (table) or slice.content.textBetween with '\n\n' separator (fallback).
 * @controlflow Attempt TSV first; on non-null return it, else fall back to paragraph text.
 */
export function clipboardText(slice: Slice): string {
  const tsv = tableRowsAsTsv(slice.content);

  // Prefer the tab-separated representation for recognized table content.
  if (tsv !== null) {
    return tsv;
  } else {
    // Non-table content: fall back to ProseMirror's default paragraph text.
    return slice.content.textBetween(0, slice.content.size, '\n\n');
  }
}