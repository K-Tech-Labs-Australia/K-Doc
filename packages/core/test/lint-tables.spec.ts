/**
 * @file lint-tables.spec.ts
 * @purpose Tests table rows that do not match the header cell count, and header/delimiter row mismatches that stop a construct being read as a table (FR-12.7).
 * @inputs Markdown source strings parsed into a KdocDocument; the document text and mdast root used by countCells and malformedTables.
 * @outputs No module-level exports; each assertion resolves to pass/fail through Vitest's expect against lint findings and applied fixes.
 * @functions
 *   - countCells: Counts pipe-delimited cells in a raw table line, ignoring surrounding pipes.
 *   - malformedTables: Walks the document tree and emits one LintFinding per malformed-table defect.
 *   - applyLintEdits: Applies a set of fix edits to source text and returns the resulting string.
 *   - parseMarkdown: Parses markdown source into a KdocDocument with an mdast root tree.
 * @dataflow Markdown string → parseMarkdown → KdocDocument → countCells/malformedTables/applyLintEdits → Vitest assertions.
 * @controlflow describe groups register it cases; each it runs sequentially, asserting on cell counts or lint findings and fix application.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { countCells, malformedTables } from '../src/lint/table-rules.js';
import { applyLintEdits } from '../src/lint/lint-finding.js';
import { parseMarkdown } from '../src/parse/parser.js';

describe('countCells', () => {
  it('counts cells across bordered, borderless, delimiter and escaped-pipe rows', () => {
    // Verify cell counts for a header, a borderless body row, a single-cell delimiter, an escaped pipe, a three-cell row and a padded row.
    expect(countCells('| a | b |')).toBe(2);
    expect(countCells('a | b')).toBe(2);
    expect(countCells('|---|')).toBe(1);
    expect(countCells('| x \\| y |')).toBe(1);
    expect(countCells('| a | b | c |')).toBe(3);
    expect(countCells('  | a |  ')).toBe(1);
  });
});

describe('malformedTables', () => {
  const RAGGED = '| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n';
  const text = '| a | b |\n|---|\n| 1 | 2 |\n';
  const found = malformedTables(parseMarkdown(text));

  it('reports short and long rows', () => {
    // The short row gains an add-cells fix while the long row reports no automatic fix.
    expect(malformedTables(parseMarkdown(RAGGED))).toEqual([{ rule: 'malformed-table', label: 'Table, line 3', message: "Row has 1 of the header's 2 cells", from: 20, to: 25, fix: { label: 'Add empty cells', edits: [{ from: 25, to: 25, insert: '  |' }] } }, { rule: 'malformed-table', label: 'Table, line 4', message: 'Row has 3 cells but the header has 2, so 1 are not shown', from: 26, to: 39, fix: null }]);
  });

  it('fills a short row so only the long one remains', () => {
    // Apply the short-row fix and assert that only the long row is still reported afterwards.
    const [short] = malformedTables(parseMarkdown(RAGGED));
    if (short === undefined || short.fix === null) throw new Error('expected a fixable finding');
    const fixed = applyLintEdits(RAGGED, short.fix.edits);
    expect(fixed).toBe('| a | b |\n|---|---|\n| 1 |  |\n| 1 | 2 | 3 |\n');
    expect(malformedTables(parseMarkdown(fixed)).map((f) => f.label)).toEqual(['Table, line 4']);
  });

  it('offers no fix for a short row without a closing pipe', () => {
    // A short row lacking a trailing pipe yields a finding with no quick-fix edits.
    const [finding] = malformedTables(parseMarkdown('| a | b |\n|---|---|\n| 1\n'));
    expect(finding?.fix).toBeNull();
  });

  it('reports a delimiter row that stops a table being a table', () => {
    // The header/delimiter column mismatch is reported on the first line with a delimiter-row fix.
    expect(found).toEqual([{ rule: 'malformed-table', label: 'Table, line 1', message: 'The header has 2 columns but the delimiter row has 1, so this is not read as a table', from: 0, to: 25, fix: { label: 'Fix the delimiter row', edits: [{ from: 10, to: 15, insert: '| --- | --- |' }] } }]);
  });

  it('turns it into a table once fixed', () => {
    // Apply case 4's delimiter-row fix and assert the source parses as a real table with no findings.
    const [delimiter] = found;
    if (delimiter === undefined || delimiter.fix === null) throw new Error('expected a fixable finding');
    const fixed = applyLintEdits(text, delimiter.fix.edits);
    expect(fixed).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(parseMarkdown(fixed).root.children[0]?.type).toBe('table');
    expect(malformedTables(parseMarkdown(fixed))).toEqual([]);
  });

  it('finds the delimiter row after a CRLF', () => {
    // The delimiter-row fix offsets account for the two-character CRLF separator.
    const [finding] = malformedTables(parseMarkdown('| a | b |\r\n|---|\r\n| 1 | 2 |\r\n'));
    expect(finding?.fix?.edits).toEqual([{ from: 11, to: 16, insert: '| --- | --- |' }]);
  });

  it('leaves a well-formed table alone', () => {
    // A header/delimiter/body with matching cell counts produces no findings.
    expect(malformedTables(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n'))).toEqual([]);
  });

  it('leaves prose followed by a dashed line alone', () => {
    // A header row needs a pipe, so a pipeless first line is prose even when the next line looks like a delimiter.
    expect(malformedTables(parseMarkdown('a b\n--- | ---\n'))).toEqual([]);
  });

  it('leaves prose with a pipe alone', () => {
    // Non-table text containing a single pipe is not treated as a malformed table.
    expect(malformedTables(parseMarkdown('a | b\nnot a delimiter\n'))).toEqual([]);
  });
});
