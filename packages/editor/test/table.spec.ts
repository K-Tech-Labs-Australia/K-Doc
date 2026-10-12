/**
 * @file table.spec.ts
 * @purpose Vitest test suite for K-Doc's pure ProseMirror GFM table row commands, state queries, and structural transaction tagging (@k-doc/editor).
 *   Assertions verify resulting Markdown rather than ProseMirror internals to test commands, schema, AST converters, and serializer together.
 *   All operations execute directly over ProseMirror EditorState and Transaction without requiring a DOM or jsdom environment.
 * @inputs Markdown fixtures (TABLE), EditorState instances, ProseMirror commands (insertTable, deleteTable, addRowBefore, addRowAfter, deleteRow), and table queries (tableAt, isInTable).
 * @outputs Vitest assertions verifying resulting Markdown table structures, row positions, command applicability flags, table coordinates, and kdocStructural transaction metadata.
 * @functions
 *   - tableLines: Extracts lines starting with '|' from a Markdown string to isolate table rows for positional assertions.
 * @dataflow Markdown fixture -> stateFor / caretAt -> EditorState -> command execution -> runToMarkdown / captureTr -> tableLines / Markdown string -> Vitest assertions.
 * @controlflow Define tableLines helper -> test insertTable commands -> test addRowAfter commands -> test addRowBefore commands -> test deleteRow commands -> test deleteTable commands -> test tableAt and isInTable queries -> test undo coalescing metadata.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { tableAt, isInTable, insertTable, deleteTable, addRowBefore, addRowAfter, deleteRow } from '../src/index.js';
import { TABLE, stateFor, caretAt, runToMarkdown, captureTr } from './table-helpers.js';

/**
 * Extracts lines starting with '|' from a Markdown string, isolating table rows for positional assertions.
 *
 * @purpose Splits Markdown text into lines and filters for table rows starting with '|'.
 * @inputs markdown: string - The serialised Markdown document text to extract table lines from.
 * @outputs string[] - Array of lines that begin with '|'.
 * @dataflow markdown string -> split on '\n' -> filter lines starting with '|' -> string array.
 * @controlflow Split markdown by newline delimiter -> filter rows beginning with '|' -> return matching lines array.
 */
function tableLines(markdown: string): string[] {
  return markdown.split('\n').filter((line) => line.startsWith('|'));
}

describe('insertTable', () => {
  it('yields 4 table lines with delimiter row containing --- when inserting a 3x2 table', () => {
    const lines = tableLines(runToMarkdown(stateFor('\n'), insertTable(3, 2)));
    expect(lines.length).toBe(4);
    // remark-stringify sizes the delimiter to its column's widest cell, so an all-empty
    // table gets the minimal `| - | - |` rather than `| --- | --- |`. Match the shape, not a width.
    expect(lines[1] ?? '').toMatch(/^\|[\s:|-]+\|$/);
  });

  it('floors row count at 2 yielding at least 2 table lines because GFM has no one-row table', () => {
    // The row count is floored at 2 because GFM has no one-row table.
    const lines = tableLines(runToMarkdown(stateFor('\n'), insertTable(1, 2)));
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('returns false when caret is already inside a table because GFM cannot nest tables', () => {
    // GFM cannot nest tables, so refusing beats producing something that will not round-trip.
    const state = caretAt(stateFor(TABLE), 'b1');
    expect(insertTable(2, 2)(state)).toBe(false);
  });
});

describe('addRowAfter', () => {
  it('inserts an empty row after the current row between a1 and a2', () => {
    const state = caretAt(stateFor(TABLE), 'a1');
    const lines = tableLines(runToMarkdown(state, addRowAfter()));
    expect(lines.length).toBe(5);
    expect(lines[2] ?? '').toContain('a1');
    expect(lines[4] ?? '').toContain('a2');
    // The new empty row sits between lines[2] and lines[4], containing neither a1 nor a2.
    expect(lines[3] ?? '').not.toContain('a1');
    expect(lines[3] ?? '').not.toContain('a2');
  });
});

describe('addRowBefore', () => {
  it('inserts an empty row before the current row when caret is in a2', () => {
    const state = caretAt(stateFor(TABLE), 'a2');
    const lines = tableLines(runToMarkdown(state, addRowBefore()));
    expect(lines.length).toBe(5);
    expect(lines[2] ?? '').toContain('a1');
    expect(lines[4] ?? '').toContain('a2');
    // The new row lands at index 3, between a1 and a2.
    expect(lines[3] ?? '').not.toContain('a1');
    expect(lines[3] ?? '').not.toContain('a2');
  });

  it('floors insertion index at 1 when caret is in the header to preserve header semantics', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const lines = tableLines(runToMarkdown(state, addRowBefore()));
    // Inserting above row 0 would silently demote the user's headings to body text, which is why the command floors the insertion index at 1.
    expect(lines.length).toBe(5);
    expect(lines[0] ?? '').toContain('Head A');
  });
});

describe('deleteRow', () => {
  it('deletes the row containing the caret', () => {
    const state = caretAt(stateFor(TABLE), 'a1');
    const result = runToMarkdown(state, deleteRow());
    expect(result).toContain('Head A');
    expect(result).toContain('a2');
    expect(result).not.toContain('a1');
  });

  it('refuses to delete the last remaining row in a table', () => {
    const state = caretAt(stateFor('| Only |\n| ---- |\n'), 'Only');
    // tableRow+ forbids an empty table, so the user wants deleteTable here.
    expect(deleteRow()(state)).toBe(false);
  });

  it('promotes the next row to header when deleting the header row', () => {
    const state = caretAt(stateFor(TABLE), 'Head A');
    const lines = tableLines(runToMarkdown(state, deleteRow()));
    // Deleting the header promotes the next row to header — the honest consequence of mdast having no separate header node.
    expect(lines[0] ?? '').toContain('a1');
  });
});

describe('deleteTable', () => {
  it('removes the entire table when caret is inside it', () => {
    const state = caretAt(stateFor(TABLE), 'b1');
    const result = runToMarkdown(state, deleteTable());
    expect(result).not.toContain('|');
  });

  it('returns false when invoked outside any table', () => {
    const state = stateFor('Just a paragraph.\n');
    expect(deleteTable()(state)).toBe(false);
  });
});

describe('tableAt and isInTable', () => {
  it('correctly reports table membership', () => {
    expect(isInTable(caretAt(stateFor(TABLE), 'b1'))).toBe(true);
    expect(isInTable(stateFor('Just a paragraph.\n'))).toBe(false);
  });

  it('locates caret coordinates and shape within the enclosing table', () => {
    const state = caretAt(stateFor(TABLE), 'b1');
    const ctx = tableAt(state);

    // Guard against null to narrow the table context safely without non-null assertions.
    if (ctx === null) {
      // The caret is inside TABLE, so ctx must be non-null; throw if query failed.
      throw new Error('expected a table context');
    } else {
      // Enclosing table found: assert context coordinates below.
    }

    // The delimiter line is table syntax, not content: mdast's table children are the header
    // and the two body rows, so `b1` sits in row 1 even though it is the third line on screen.
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.cellIndex).toBe(1);
    expect(ctx.columnCount).toBe(2);
  });
});

describe('undo coalescing', () => {
  it('tags table structural transactions with kdocStructural metadata', () => {
    const state = caretAt(stateFor(TABLE), 'a1');
    const tr = captureTr(state, addRowAfter());
    // Without the tag the row insertion would merge into the user's last typing run under undo.
    expect(tr.getMeta('kdocStructural')).toBe(true);
  });
});
