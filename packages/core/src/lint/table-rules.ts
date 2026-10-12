/**
 * @file table-rules.ts
 * @purpose Lints GFM tables whose body rows do not match the header cell count, and detects
 *   header/delimiter row mismatches that stop a construct from being read as a table (FR-12.7).
 * @inputs A KdocDocument: its original source text and parsed mdast root tree.
 * @outputs An array of LintFinding records describing each malformed-table defect, each with an
 *   optional quick-fix edit set expressed in document source offsets.
 * @functions
 *   - DELIMITER_ROW: RegExp matching a GFM delimiter row such as `|---|:--:|` or `--- | ---`.
 *   - countCells: Count the pipe-delimited cells in a raw table line, ignoring surrounding pipes.
 *   - malformedTables: Walk the document tree and emit one finding per malformed-table defect.
 * @dataflow Document text + root tree → walkNodes visits each node → per-node analysis produces
 *   LintFinding records → collected into and returned as an array of findings.
 * @controlflow Traverse pre-order; branch on node type (table vs paragraph); for each candidate,
 *   compare cell counts and push a finding only when they disagree; return all findings at the end.
 * @version 1
 * @date 2026-09-14
 */

import type { KdocDocument } from '../ast/types.js';
import { lineNumberAt, nodeRange, walkNodes, type LintFinding, type LintFix, type LintNode } from './lint-finding.js';

/** Matches a GFM delimiter row such as `|---|:--:|` or `--- | ---`. */
export const DELIMITER_ROW: RegExp = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * @purpose Count the pipe-delimited cells in a raw table source line, ignoring one leading and
 *   one trailing unescaped pipe so they are not mistaken for cell separators.
 * @inputs line - A single physical line of markdown that may be part of a table row.
 * @outputs The number of cells represented by the line (the count of unescaped pipe segments).
 * @dataflow Raw line → trimmed body → surrounding pipes stripped → split on unescaped pipes → segment count.
 * @controlflow Trim; drop leading pipe if present; drop trailing pipe unless escaped; return split length.
 */
export function countCells(line: string): number {
  // Strip surrounding whitespace from the raw source line before counting pipes.
  let body = line.trim();
  // Drop a single leading pipe when present so it is not counted as a cell separator.
  if (body.startsWith('|')) {
    body = body.slice(1);
  } else {
    // No leading pipe: leave the body unchanged and continue to trailing-pipe handling.
  }
  // Drop a single trailing pipe. An escaped trailing pipe needs no exception: dropping it leaves the number of
  // unescaped separators, and so the count, unchanged.
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
  } else {
    // No removable trailing pipe: keep the body as-is.
  }
  // Count unescaped pipes; a split into N segments corresponds to N cells per FR-12.7 examples.
  return body.split(/(?<!\\)\|/).length;
}

/**
 * @purpose Walk the document tree and emit a finding for every table whose rows disagree with the
 *   header, plus every paragraph-shaped header/delimiter pair that GFM refused to parse as a table.
 * @inputs doc - The KdocDocument whose text and AST are linted.
 * @outputs An array of LintFinding records, one per detected malformed-table defect.
 * @dataflow Root tree → walkNodes visits each node → type-specific analysis appends findings → returned array.
 * @controlflow Initialise empty results; traverse pre-order; branch on 'table' vs 'paragraph'; collect and return.
 */
export function malformedTables(doc: KdocDocument): LintFinding[] {
  // Collect every finding produced while traversing the document tree.
  const findings: LintFinding[] = [];
  // Walk the parsed mdast root; it is cast to LintNode because its child element types differ structurally.
  walkNodes(doc.root as unknown as LintNode, (node) => {
    if (node.type === 'table') {
      // Case A: a parsed table whose children are rows with row 0 as the header.
      const rows = node.children ?? [];
      // The first child is the header whose cell count defines the canonical column count.
      const header = rows[0];
      if (header === undefined) {
        // A table without a header row cannot be validated; skip to the next node.
        return;
      } else {
        // Header present: its child count is the expected number of columns for every body row.
        const headerCount = (header.children ?? []).length;
        // Iterate over body rows only, skipping the header at index 0.
        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          if (row === undefined) {
            // Row slot is empty; nothing to validate, so skip this iteration.
            continue;
          } else {
            const range = nodeRange(row);
            if (range === null) {
              // Row lacks position metadata; cannot locate it in source, so skip it.
              continue;
            } else {
              const count = (row.children ?? []).length;
              const line = lineNumberAt(doc.text, range.from);
              if (count < headerCount) {
                // Row has fewer cells than the header: report a missing-cell finding with an optional fix.
                const missing = headerCount - count;
                const rowText = doc.text.slice(range.from, range.to);
                // Offer a fix only when the trimmed row text ends with an unescaped pipe (append after it); otherwise none.
                const fix: LintFix | null = rowText.trimEnd().endsWith('|')
                  ? { label: 'Add empty cells', edits: [{ from: range.to, to: range.to, insert: '  |'.repeat(missing) }] }
                  : null;
                findings.push({
                  rule: 'malformed-table',
                  label: `Table, line ${line}`,
                  message: `Row has ${count} of the header's ${headerCount} cells`,
                  from: range.from,
                  to: range.to,
                  fix,
                });
              } else if (count > headerCount) {
                // Row has more cells than the header: report an over-count finding with no automatic fix.
                findings.push({
                  rule: 'malformed-table',
                  label: `Table, line ${line}`,
                  message: `Row has ${count} cells but the header has ${headerCount}, so ${count - headerCount} are not shown`,
                  from: range.from,
                  to: range.to,
                  fix: null,
                });
              } else {
                // Cell count matches the header exactly: the row is well-formed, so emit no finding.
              }
            }
          }
        }
      }
    } else if (node.type === 'paragraph') {
      // Case B: a paragraph that may actually be a malformed table GFM refused to parse.
      const range = nodeRange(node);
      if (range === null) {
        // Paragraph lacks position metadata; cannot read its source, so skip it.
        return;
      } else {
        // Extract the paragraph's raw text and split it into physical lines on LF or CRLF.
        const source = doc.text.slice(range.from, range.to);
        const lines = source.split(/\r?\n/);
        const first = lines[0];
        const second = lines[1];
        if (first !== undefined && second !== undefined && first.includes('|') && DELIMITER_ROW.test(second)) {
          // Both lines exist, the header contains a pipe, and the second line is a delimiter row: treat as a table candidate.
          const headerCells = countCells(first);
          const delimiterCells = countCells(second);
          // The counts necessarily differ here: had they matched, GFM would have read these lines as a table
          // rather than leaving them a paragraph.
          const line = lineNumberAt(doc.text, range.from);
          // Determine the newline width after the header to size the second-row start offset correctly.
          const newlineLength = doc.text.startsWith('\r\n', range.from + first.length) ? 2 : 1;
          const secondFrom = range.from + first.length + newlineLength;
          const secondTo = secondFrom + second.length;
          findings.push({
            rule: 'malformed-table',
            label: `Table, line ${line}`,
            message: `The header has ${headerCells} columns but the delimiter row has ${delimiterCells}, so this is not read as a table`,
            from: range.from,
            to: range.to,
            fix: {
              label: 'Fix the delimiter row',
              edits: [{ from: secondFrom, to: secondTo, insert: `|${' --- |'.repeat(headerCells)}` }],
            },
          });
        } else {
          // Not a two-line pipe-delimited structure with a delimiter row; not a malformed table.
        }
      }
    } else {
      // Node is neither a table nor a paragraph; nothing to check for this rule.
    }
  });
  return findings;
}
