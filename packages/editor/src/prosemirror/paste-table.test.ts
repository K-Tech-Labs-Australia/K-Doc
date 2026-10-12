/**
 * @file paste-table.test.ts
 * @purpose Vitest test suite for tabular paste in ProseMirror (FR-7.4), verifying plain-text table parsing and table node construction.
 * @inputs Tab-delimited text fixtures, whitespace and ragged table strings, parsed DelimitedTable data structures, and kdocSchema.
 * @outputs Vitest assertions validating delimited text parsing, cell trimming, ragged row padding, ProseMirror table node hierarchy, unset alignments, and Markdown serialization.
 * @functions
 *   - gridOf: Reads a built table node back into rows of cell textContent strings.
 * @dataflow Tab-delimited text string -> parseDelimitedText -> DelimitedTable -> buildTableNode -> ProseMirror table Node -> gridOf / serializeDocument -> assertions.
 * @controlflow Execute describe('parseDelimitedText') test cases -> execute describe('buildTableNode') test cases.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { parseDelimitedText, buildTableNode } from './paste-table.js';
import { kdocSchema } from './schema.js';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { proseMirrorToMdast } from './to-mdast.js';
import { serializeDocument } from '@k-doc/core';

/**
 * Reads a built table node back into rows of cell textContent strings.
 *
 * @purpose Extracts a 2D string grid of cell text contents from a ProseMirror table node.
 * @inputs node - The ProseMirror table Node (or parent container) to extract cell text from.
 * @outputs string[][] - 2D array of string cell text contents.
 * @dataflow node -> locate table -> iterate rows -> iterate cells -> extract textContent -> string[][].
 * @controlflow Check node type -> resolve table node -> loop through row children -> loop through cell children -> collect textContent -> return grid.
 */
function gridOf(node: ProseMirrorNode): string[][] {
  // Check whether the input node is directly a table or encloses a table as its first child.
  let tableNode: ProseMirrorNode | null = null;
  if (node.type.name === 'table') {
    // Branch: Input node is directly a table node.
    tableNode = node;
  } else if (node.firstChild !== null && node.firstChild.type.name === 'table') {
    // Branch: Input node contains a table node as its first child.
    tableNode = node.firstChild;
  } else {
    // Branch: Input node is neither a table nor encloses a table child.
  }

  // Check whether a valid table node was resolved.
  if (tableNode === null) {
    // Branch: No table node found; return empty grid.
    return [];
  } else {
    // Branch: Valid table node found; proceed to extract row and cell text contents.
  }

  const grid: string[][] = [];
  tableNode.forEach((rowNode: ProseMirrorNode): void => {
    const rowCells: string[] = [];
    rowNode.forEach((cellNode: ProseMirrorNode): void => {
      rowCells.push(cellNode.textContent);
    });
    grid.push(rowCells);
  });

  return grid;
}

describe('parseDelimitedText', (): void => {
  it('parses a simple two-column grid', (): void => {
    const result = parseDelimitedText('a\tb\nc\td\n');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; verify parsed rows and column count.
      expect(result.rows).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
      expect(result.columns).toBe(2);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('trims whitespace from cells', (): void => {
    // A spreadsheet pads cells to a column width and the padding is not data.
    const result = parseDelimitedText('  a \t b  \n c \t d \n');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; verify padded whitespace is trimmed.
      expect(result.rows).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
      expect(result.columns).toBe(2);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('does not create an empty row from a trailing newline', (): void => {
    // A copied range usually ends with one, which should not produce an empty trailing row.
    const result = parseDelimitedText('a\tb\n');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; verify only one row is emitted.
      expect(result.rows).toEqual([['a', 'b']]);
      expect(result.columns).toBe(2);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('reads CRLF line endings the same as LF', (): void => {
    const result = parseDelimitedText('a\tb\r\nc\td');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; verify rows separated by CRLF parse correctly.
      expect(result.rows).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
      expect(result.columns).toBe(2);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('does not treat prose containing commas as a table', (): void => {
    // The comma is deliberately not a delimiter: a spreadsheet only emits commas when
    // asked for CSV, and guessing at them would turn ordinary punctuation into columns.
    const result = parseDelimitedText('Hello, world');
    expect(result).toBeNull();
  });

  it('treats the whole text as prose if any line lacks a tab delimiter', (): void => {
    // One line without a delimiter means the text was not a grid, and reading the rest
    // as one would be inventing structure.
    const result = parseDelimitedText('a\tb\nplain line');
    expect(result).toBeNull();
  });

  it('returns null for empty text', (): void => {
    const result = parseDelimitedText('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only text', (): void => {
    const result = parseDelimitedText('   \n\t\n   ');
    expect(result).toBeNull();
  });

  it('pads a ragged grid to the widest row', (): void => {
    // A spreadsheet range with a merged cell produces exactly this, and GFM tables
    // are rectangular so padding is the only way to get one at all.
    const result = parseDelimitedText('a\tb\tc\nd\te');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; verify widest column count and row padding.
      expect(result.columns).toBe(3);
      expect(result.rows).toEqual([
        ['a', 'b', 'c'],
        ['d', 'e', ''],
      ]);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('takes the width from the widest row wherever it sits', (): void => {
    // The obvious fixture puts the widest row first, where taking the width from the first row and
    // taking it from the widest look identical. This one puts it last, which is the only arrangement
    // that tells them apart -- and a spreadsheet range does not promise its widest row comes first.
    const result = parseDelimitedText('a\tb\nc\td\te');
    expect(result).not.toBeNull();
    // Check if the parse result is non-null before accessing table properties.
    if (result !== null) {
      // Branch: Result is non-null; the width is the widest row's, and the short row is padded.
      expect(result.columns).toBe(3);
      expect(result.rows).toEqual([
        ['a', 'b', ''],
        ['c', 'd', 'e'],
      ]);
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('does not alias rows array instances across repeated parses', (): void => {
    const text = 'a\tb\nc\td';
    const a = parseDelimitedText(text);
    const b = parseDelimitedText(text);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Check if both parse results are non-null before comparing array references.
    if (a !== null && b !== null) {
      // Branch: Both results non-null; verify rows array references are distinct.
      expect(a.rows).not.toBe(b.rows);
    } else {
      // Branch: One or both parse results were unexpectedly null.
    }
  });
});

describe('buildTableNode', (): void => {
  it('builds a table node of the right shape', (): void => {
    const parsed = parseDelimitedText('h1\th2\nv1\tv2');
    expect(parsed).not.toBeNull();
    // Check if parse result is non-null before building table node.
    if (parsed !== null) {
      const node = buildTableNode(parsed);
      expect(node).not.toBeNull();
      // Check if built node is non-null before inspecting its properties.
      if (node !== null) {
        // Branch: Node is non-null; verify node type, childCount, and extracted grid.
        expect(node.type.name).toBe('table');
        expect(node.childCount).toBe(2);
        expect(gridOf(node)).toEqual([
          ['h1', 'h2'],
          ['v1', 'v2'],
        ]);
      } else {
        // Branch: Built table node was unexpectedly null.
      }
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('treats the first row as the header', (): void => {
    // GFM has no table without a header, so the alternative would be inventing an empty row at the top of the user's data.
    const parsed = parseDelimitedText('h1\th2\nv1\tv2');
    expect(parsed).not.toBeNull();
    // Check if parse result is non-null before building table node.
    if (parsed !== null) {
      const node = buildTableNode(parsed);
      expect(node).not.toBeNull();
      // Check if built node is non-null before inspecting its first child row.
      if (node !== null) {
        // Branch: Node is non-null; assert first child is the header row holding h1 and h2.
        const firstRow = node.child(0);
        expect(firstRow.type.name).toBe('tableRow');
        expect(firstRow.childCount).toBe(2);
        expect(firstRow.child(0).textContent).toBe('h1');
        expect(firstRow.child(1).textContent).toBe('h2');
      } else {
        // Branch: Built table node was unexpectedly null.
      }
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('creates an empty cell with childCount 0 rather than an empty text node', (): void => {
    // ProseMirror refuses an empty text node, so an empty cell has to hold nothing rather than hold an empty string.
    const parsed = parseDelimitedText('a\t\nb\tc');
    expect(parsed).not.toBeNull();
    // Check if parse result is non-null before building table node.
    if (parsed !== null) {
      const node = buildTableNode(parsed);
      expect(node).not.toBeNull();
      // Check if built node is non-null before inspecting target cell.
      if (node !== null) {
        // Branch: Node is non-null; verify row 0 column 1 cell is empty.
        const firstRow = node.child(0);
        const cell = firstRow.child(1);
        expect(cell.textContent).toBe('');
        expect(cell.childCount).toBe(0);
      } else {
        // Branch: Built table node was unexpectedly null.
      }
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('leaves column alignment unset as an array of nulls', (): void => {
    // Pasted data carries no alignment and inventing one would assert something about the user's data that they did not say.
    const parsed = parseDelimitedText('h1\th2\nv1\tv2');
    expect(parsed).not.toBeNull();
    // Check if parse result is non-null before building table node.
    if (parsed !== null) {
      const node = buildTableNode(parsed);
      expect(node).not.toBeNull();
      // Check if built node is non-null before inspecting align attribute.
      if (node !== null) {
        // Branch: Node is non-null; verify align attribute has null entries matching column count.
        expect(node.attrs.align).toEqual([null, null]);
        expect(node.attrs.align).toHaveLength(parsed.columns);
      } else {
        // Branch: Built table node was unexpectedly null.
      }
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });

  it('round-trips through the Markdown serializer', (): void => {
    // The shape only matters if it reaches the file as a table, and this is the one assertion that checks it does.
    const parsed = parseDelimitedText('h1\th2\nv1\tv2');
    expect(parsed).not.toBeNull();
    // Check if parse result is non-null before building table node.
    if (parsed !== null) {
      const tableNode = buildTableNode(parsed);
      expect(tableNode).not.toBeNull();
      // Check if built node is non-null before wrapping and serializing.
      if (tableNode !== null) {
        // Branch: Table node is non-null; wrap in doc node, convert to mdast, and serialize to Markdown.
        const docNode = kdocSchema.node('doc', null, [tableNode]);
        const root = proseMirrorToMdast(docNode);
        const serialized = serializeDocument({ text: '', root, frontMatter: null });
        expect(serialized).toContain('| h1 | h2 |');
      } else {
        // Branch: Built table node was unexpectedly null.
      }
    } else {
      // Branch: Parse result was unexpectedly null.
    }
  });
});
