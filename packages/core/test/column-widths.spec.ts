/**
 * @file column-widths.spec.ts
 * @purpose Verifies column width hints are read from delimiter rows, stored on table nodes, and written back by the serializer (FR-8.26).
 * @inputs Markdown fixtures.
 * @outputs vitest assertions.
 * @functions
 *   - tableOf: Extracts the first table node from a Markdown source string.
 * @dataflow source -> parse -> hints -> serialize.
 * @controlflow describe per unit.
 * @version 1
 * @date 2026-09-15
 */

import type { Table } from 'mdast';
import { describe, expect, it } from 'vitest';
import { applyColumnWidths, columnWidthHints, delimiterMinimum, hintsOf, splitTableRow } from '../src/table/column-widths.js';
import { DEFAULT_MARKDOWN_STYLE, parseMarkdown, serializeDocument, serializeIncremental } from '../src/index.js';

// tableOf extracts the first table node from a Markdown source string.
// @purpose Locates and returns the first 'table' AST node in a parsed document.
// @inputs source - A Markdown string containing at least one table.
// @outputs Table - The first table node found in the document root.
// @dataflow source -> parseMarkdown -> tree traversal -> table node.
// @controlflow Parse document, depth-first visit nodes, return on first table match; throw if none found.
function tableOf(source: string): Table {
  const doc = parseMarkdown(source);
  let found: Table | null = null;
  const visit = (node: { type: string; children?: unknown[] }): void => {
    // If this node is an unvisited table, record it as the found table.
    if (found === null && node.type === 'table') { found = node as Table; }
    // Otherwise, if the node has children, recurse into each child.
    else if (Array.isArray(node.children)) { for (const child of node.children) { visit(child as { type: string; children?: unknown[] }); } }
    // Otherwise, the node is a leaf with no table and no children to traverse.
    else { }
  };
  visit(doc.root);
  // If no table was found during traversal, throw an error.
  if (found === null) { throw new Error('no table'); }
  // Otherwise, return the found table node.
  else { return found; }
}

describe('splitTableRow', () => {
  it('splits on unescaped pipes with or without outer pipes', () => {
    expect(splitTableRow('| a | b |')).toEqual([' a ', ' b ']);
    expect(splitTableRow('a|b')).toEqual(['a', 'b']);
    expect(splitTableRow('| x \\| y | z |')).toEqual([' x \\| y ', ' z ']);
    expect(splitTableRow('| ends with \\|')).toEqual([' ends with \\|']);
    expect(splitTableRow('  | padded |  ')).toEqual([' padded ']);
  });
});

describe('delimiterMinimum', () => {
  it('is the shortest delimiter each alignment is written with', () => {
    expect(delimiterMinimum(null)).toBe(1);
    expect(delimiterMinimum(undefined)).toBe(1);
    expect(delimiterMinimum('left')).toBe(2);
    expect(delimiterMinimum('right')).toBe(2);
    expect(delimiterMinimum('center')).toBe(3);
  });
});

describe('columnWidthHints', () => {
  it('hints a column whose delimiter is longer than its content', () => {
    expect(columnWidthHints(['| a | b |', '| --------- | - |', '| x | y |'], [null, null])).toEqual([9, null]);
  });
  it('measures the widest content across header and body', () => {
    expect(columnWidthHints(['| a |', '| ---- |', '| wider |'], [null])).toBeNull();
    expect(columnWidthHints(['| a |', '| ------ |', '| wider |'], [null])).toEqual([6]);
  });
  it('does not count the alignment colons a short column needs', () => {
    expect(columnWidthHints(['| a |', '| :-: |'], ['center'])).toBeNull();
    expect(columnWidthHints(['| a |', '| :---------: |'], ['center'])).toEqual([11]);
    expect(columnWidthHints(['| a |', '| --: |'], ['right'])).toEqual([3]);
  });
  it('gives nothing for a canonical table or a table with no delimiter row', () => {
    expect(columnWidthHints(['| a | b |', '| - | - |'], [])).toBeNull();
    expect(columnWidthHints(['| a |'], [])).toBeNull();
  });
});

describe('hints on parsed tables', () => {
  it('records hints under data when the source has them, and nothing otherwise', () => {
    expect(hintsOf(tableOf('| a | b |\n| --------- | - |\n| x | y |\n'))).toEqual([9, null]);
    expect(tableOf('| a | b |\n| - | - |\n| x | y |\n').data).toBeUndefined();
  });
  it('reads a table inside a blockquote past the quote prefix', () => {
    expect(hintsOf(tableOf('> | a | b |\n> | ------ | - |\n> | x | y |\n'))).toEqual([6, null]);
  });
  it('refuses stored hints of the wrong shape', () => {
    const table: Table = { type: 'table', children: [], data: { kdocColumnWidths: [3, 'wide'] } as Table['data'] };
    expect(hintsOf(table)).toBeNull();
    expect(hintsOf({ type: 'table', children: [], data: { kdocColumnWidths: [] } as Table['data'] })).toBeNull();
    expect(hintsOf({ type: 'table', children: [], data: { kdocColumnWidths: [0] } as Table['data'] })).toBeNull();
    expect(hintsOf({ type: 'table', children: [], data: { kdocColumnWidths: [1.5] } as Table['data'] })).toBeNull();
    expect(hintsOf({ type: 'table', children: [], data: { kdocColumnWidths: 'x' } as Table['data'] })).toBeNull();
    expect(hintsOf({ type: 'table', children: [] })).toBeNull();
    expect(hintsOf({ type: 'table', children: [], data: { kdocColumnWidths: [null, 4] } as Table['data'] })).toEqual([null, 4]);
  });
});

describe('applyColumnWidths', () => {
  it('pads a hinted column with dashes and spaces', () => {
    expect(applyColumnWidths('| a | b |\n| - | - |\n| x | y |', [5, null], [null, null])).toBe('| a     | b |\n| ----- | - |\n| x     | y |');
  });
  it('places the extra space by alignment and keeps colons outside the dashes', () => {
    expect(applyColumnWidths('| ab |\n| -: |\n| cd |', [4], ['right'])).toBe('|   ab |\n| ---: |\n|   cd |');
    expect(applyColumnWidths('| ab |\n| :- |\n| cd |', [4], ['left'])).toBe('| ab   |\n| :--- |\n| cd   |');
    expect(applyColumnWidths('| abc |\n| :-: |\n| def |', [6], ['center'])).toBe('|  abc   |\n| :----: |\n|  def   |');
  });
  it('leaves columns already as wide as their hint', () => {
    expect(applyColumnWidths('| wide |\n| ---- |', [3], [null])).toBe('| wide |\n| ---- |');
  });
});

describe('saving a table with hints', () => {
  it('writes the hint back as delimiter dashes and padding', () => {
    const source = '| a | b |\n| --------- | - |\n| x | y |\n';
    const text = serializeDocument(parseMarkdown(source));
    expect(text).toBe('| a         | b |\n| --------- | - |\n| x         | y |\n');
    expect(serializeDocument(parseMarkdown(text))).toBe(text);
  });
  it('leaves an unpadded table as the GFM handler writes it', () => {
    const style = { ...DEFAULT_MARKDOWN_STYLE, padTableCells: false };
    const hinted = serializeDocument(parseMarkdown('| a | b |\n| --------- | - |\n| x | y |\n'), style);
    const plain = serializeDocument(parseMarkdown('| a | b |\n| - | - |\n| x | y |\n'), style);
    expect(hinted).toBe(plain);
  });

  it('keeps the hint when a cell of the table is edited', () => {
    const source = '| a | b |\n| --------- | - |\n| x | y |\n';
    const original = parseMarkdown(source);
    const updated = structuredClone(original.root);
    const table = updated.children[0];
    // If there is no table child or it is not a table node, throw an error.
    if (table === undefined || table.type !== 'table') { throw new Error('no table'); }
    // Otherwise, proceed to edit the cell.
    else { }
    const cell = table.children[1]?.children[1];
    // If there is no cell at the expected position, throw an error.
    if (cell === undefined) { throw new Error('no cell'); }
    // Otherwise, replace the cell's children with a text node.
    else { cell.children = [{ type: 'text', value: 'yes' }]; }
    expect(serializeIncremental(original, updated).text).toBe('| a         | b   |\n| --------- | --- |\n| x         | yes |\n');
  });
});