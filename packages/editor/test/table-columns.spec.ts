/**
 * @file table-columns.spec.ts
 * @purpose Vitest test suite for GFM table column commands (addColumnBefore, addColumnAfter, deleteColumn, setColumnAlign)
 *   and cell navigation (goToNextCell) in @k-doc/editor, asserting on serialized Markdown output and editor state transitions.
 * @inputs Canonical TABLE fixture and test Markdown strings, ProseMirror EditorState instances, table column commands,
 *   and cell navigation steps.
 * @outputs Vitest test assertions verifying column structural modifications in serialized Markdown, column alignment
 *   preservation, and caret navigation behavior.
 * @functions
 *   - cellsIn: Splits one Markdown table row into an array of trimmed cell texts.
 *   - tableLines: Filters a Markdown document down to an array of lines starting with the table pipe delimiter.
 * @dataflow Test Markdown string -> stateFor -> caretAt -> column/navigation Command -> runToMarkdown / captureTr -> tableLines / cellsIn -> Vitest expectations.
 * @controlflow Test addColumnAfter cell count and positioning -> test addColumnBefore empty column insertion -> test deleteColumn reduction and single-column rejection -> test setColumnAlign alignment tokens -> test alignment lockstep across column insertion -> test goToNextCell forward navigation, backward boundary, row expansion, outside-table rejection, and lack of structural meta tagging.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import {
  tableAt,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  setColumnAlign,
  goToNextCell,
} from '../src/index.js';
import { TABLE, stateFor, caretAt, runToMarkdown, captureTr } from './table-helpers.js';

/**
 * Splits one Markdown table row into its trimmed cell texts.
 *
 * @purpose Splits one Markdown table row into its trimmed cell texts by removing outer delimiters and splitting on pipes.
 * @inputs line: string - A single line of Markdown representing a table row or delimiter line.
 * @outputs string[] - Array of trimmed text content for each cell in the row.
 * @dataflow line -> trim whitespace -> strip leading and trailing pipe delimiters -> split on pipe -> trim each cell -> cell string array.
 * @controlflow Trim surrounding whitespace -> strip leading '|' and trailing '|' -> split remaining string on '|' -> map each cell to trimmed string -> return cell array.
 */
function cellsIn(line: string): string[] {
  const trimmed = line.trim();
  const stripped = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return stripped.split('|').map((cell: string): string => cell.trim());
}

/**
 * Filters a Markdown document down to its table rows.
 *
 * @purpose Splits Markdown text into lines and filters for rows starting with a table pipe character.
 * @inputs markdown: string - Raw Markdown document or snippet containing table content.
 * @outputs string[] - Array of lines starting with the '|' table pipe delimiter.
 * @dataflow markdown -> split by newline -> filter lines starting with '|' -> matching line array.
 * @controlflow Split markdown on '\n' -> filter lines using startsWith('|') -> return array of table lines.
 */
function tableLines(markdown: string): string[] {
  return markdown.split('\n').filter((line: string): boolean => {
    // Check if the line begins with the table delimiter pipe character.
    if (line.startsWith('|')) {
      // Retain table line.
      return true;
    } else {
      // Discard non-table line.
      return false;
    }
  });
}

describe('addColumnAfter', () => {
  it('grows every table row to 3 cells when inserting after column 0', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const md = runToMarkdown(state, addColumnAfter());
    const lines = tableLines(md);
    const rowCells = lines.map(cellsIn);

    // A table where only some rows grew would serialise to Markdown that re-parses with a different shape.
    for (const cells of rowCells) {
      expect(cells).toHaveLength(3);
    }
  });

  it('places the new column to the right of Head A', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const md = runToMarkdown(state, addColumnAfter());
    const lines = tableLines(md);
    const headerCells = cellsIn(lines[0] ?? '');

    expect(headerCells[0] ?? '').toBe('Head A');
    expect(headerCells[2] ?? '').toBe('Head B');
  });
});

describe('addColumnBefore', () => {
  it('inserts an empty column before Head B', () => {
    const state = caretAt(stateFor(TABLE), 'Head B');
    const md = runToMarkdown(state, addColumnBefore());
    const lines = tableLines(md);
    const headerCells = cellsIn(lines[0] ?? '');

    // The empty column is inserted before Head B.
    expect(headerCells).toEqual(['Head A', '', 'Head B']);
  });
});

describe('deleteColumn', () => {
  it('deletes column 1 across all rows', () => {
    const state = caretAt(stateFor(TABLE), 'b1');
    const md = runToMarkdown(state, deleteColumn());
    const lines = tableLines(md);
    const rowCells = lines.map(cellsIn);

    for (const cells of rowCells) {
      expect(cells).toHaveLength(1);
    }
    expect(md).toContain('a1');
    expect(md).not.toContain('b1');
  });

  it('returns false on a single-column table', () => {
    const state = caretAt(stateFor('| Only |\n| ---- |\n| x |\n'), 'Only');
    // tableCell+ forbids an empty row, so the user wants deleteTable.
    const applied = deleteColumn()(state);
    expect(applied).toBe(false);
  });
});

describe('setColumnAlign', () => {
  it('centers the column under the caret in Head A', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const md = runToMarkdown(state, setColumnAlign('center'));
    const lines = tableLines(md);
    const delimiterCells = cellsIn(lines[1] ?? '');
    const firstCell = delimiterCells[0] ?? '';

    expect(firstCell.startsWith(':')).toBe(true);
    expect(firstCell.endsWith(':')).toBe(true);
  });

  it('aligns the column under Head B to the right without affecting Head A', () => {
    const state = caretAt(stateFor(TABLE), 'Head B');
    const md = runToMarkdown(state, setColumnAlign('right'));
    const lines = tableLines(md);
    const delimiterCells = cellsIn(lines[1] ?? '');
    const firstCell = delimiterCells[0] ?? '';
    const secondCell = delimiterCells[1] ?? '';

    // Alignment moves per column, not per table; GFM stores alignment on the table, one entry per column.
    expect(secondCell.endsWith(':')).toBe(true);
    expect(firstCell.startsWith(':')).toBe(false);
  });

  it('returns false when invoked outside a table', () => {
    const state = stateFor('Just a paragraph.\n');
    const applied = setColumnAlign('left')(state);
    expect(applied).toBe(false);
  });
});

describe('alignment stays in lockstep with cells', () => {
  it('shifts column alignment to index 2 when inserting a column before Head A', () => {
    const base = stateFor(TABLE);
    const first = captureTr(caretAt(base, 'Head B'), setColumnAlign('right'));
    const aligned = caretAt(base, 'Head B').apply(first);
    const md = runToMarkdown(caretAt(aligned, 'Head A'), addColumnBefore());
    const lines = tableLines(md);
    const delimiterCells = cellsIn(lines[1] ?? '');

    // Without the lockstep splice every column to the right silently inherits its neighbour's alignment.
    expect((delimiterCells[2] ?? '').endsWith(':')).toBe(true);
    expect((delimiterCells[1] ?? '').endsWith(':')).toBe(false);
  });
});

describe('goToNextCell', () => {
  it('moves the caret forward from Head A to column 1 of row 0', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const tr = captureTr(state, goToNextCell(1));
    const next = state.apply(tr);
    const ctx = tableAt(next);

    // Check if table context was located at the new caret position.
    if (ctx === null) {
      // Table context missing: fail test explicitly without non-null assertions.
      throw new Error('expected a table context');
    } else {
      // Table context resolved: proceed to assert cell coordinates.
    }

    expect(ctx.rowIndex).toBe(0);
    expect(ctx.cellIndex).toBe(1);
  });

  it('returns false when moving backward from the first cell', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    // There is nowhere to go before the first cell.
    const applied = goToNextCell(-1)(state);
    expect(applied).toBe(false);
  });

  it('appends a new row when moving forward from the last cell', () => {
    const state = caretAt(stateFor(TABLE), 'b2');
    // Tab at the end of the last row continues the table rather than escaping it, which is what every table editor does.
    const lines = tableLines(runToMarkdown(state, goToNextCell(1)));
    expect(lines).toHaveLength(5);
  });

  it('returns false when invoked outside a table', () => {
    const state = stateFor('Just a paragraph.\n');
    // This is what lets Tab keep its ordinary meaning everywhere else.
    const applied = goToNextCell(1)(state);
    expect(applied).toBe(false);
  });

  it('does not tag navigation transactions as structural', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const tr = captureTr(state, goToNextCell(1));
    // Moving the caret changes no content, so tagging it would push a meaningless entry into the undo history.
    expect(tr.getMeta('kdocStructural')).toBeUndefined();
  });
});
