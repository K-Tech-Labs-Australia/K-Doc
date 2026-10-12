/**
 * @file csv-table.ts
 * @purpose Reads comma- or semicolon-separated clipboard text (RFC 4180 quoting) into a rectangular grid,
 *   mirroring the tab-separated reader in paste-table.ts so that pasted CSV becomes a table rather than prose (FR-8.24).
 *
 *   A tab is what Excel and Google Sheets emit by default; a comma or semicolon only appears when the user has
 *   actually saved CSV, which is why this reader sits alongside parseDelimitedText instead of replacing it. Quoting
 *   follows RFC 4180: a field may be wrapped in double quotes to hold the delimiter, an embedded line break, or a
 *   doubled quote ("") that represents one literal quote character.
 *
 * @inputs Comma- or semicolon-delimited plain text string from the clipboard; the chosen field delimiter.
 * @outputs A parsed record matrix (parseCsvRecords) and a rectangular DelimitedTable grid or null (parseCsvText).
 * @functions
 *   - parseCsvRecords: Splits delimited text into records of fields, honoring RFC 4180 quoting, or null when a quote is left open.
 *   - parseCsvText: Chooses the delimiter that yields a valid rectangular table, or null when the text is not tabular.
 * @dataflow Delimited text → per-character state machine with a quoted flag (parseCsvRecords) → record matrix →
 *   delimiter selection and shape validation (parseCsvText) → frozen DelimitedTable grid with newline-normalized cells.
 * @controlflow parseCsvRecords scans each character and toggles a quoted flag to track field boundaries; parseCsvText
 *   tries comma then semicolon, validates every record has the same width of at least two fields, and normalizes newlines.
 * @version 1
 * @date 2026-09-15
 */

import type { DelimitedTable } from './paste-table.js';

/**
 * Splits delimited text into records of fields, honoring RFC 4180 quoting, or null when a quote is left open.
 *
 * @purpose Parses comma- or semicolon-separated text into a matrix of field arrays, respecting quoted fields that may
 *   contain the delimiter, an embedded line break, or a doubled quote ("") for one literal quote; reports failure on an unclosed quote.
 * @inputs text - Raw delimited clipboard string to scan character by character.
 *   delimiter - The field separator honored outside of quotes: a comma or a semicolon.
 * @outputs string[][] | null - Matrix of parsed records and fields, or null when a quote is left open (malformed CSV).
 * @dataflow text → per-character state machine driven by the quoted flag → accumulated record/field buffers → record matrix.
 * @controlflow Scan each character → branch on quoted vs unquoted state → accumulate fields, split on delimiter, end records on line breaks →
 *   report null if a quote remained open; flush any trailing unterminated record before returning.
 */
export function parseCsvRecords(
  text: string,
  delimiter: ',' | ';',
): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  // Advance through the whole string one character at a time, tracking whether we are inside a quoted field.
  while (index < text.length) {
    // noUncheckedIndexedAccess types this as string | undefined even though the loop bound guarantees an element exists.
    const ch = text[index];

    if (quoted) {
      // Inside a quoted field: a quote followed by another quote is an escaped literal quote, consume both characters.
      if (ch === '"' && text[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      } else if (ch === '"') {
        // A lone closing quote ends the quoted field; keep scanning for the delimiter that follows.
        quoted = false;
        index += 1;
        continue;
      } else {
        // Any other character is literal field content, including a delimiter or line break that would otherwise split.
        field += ch ?? '';
        index += 1;
        continue;
      }
    } else if (ch === '"' && field.trim() === '') {
      // A quote at the start of an empty field opens a quoted field; discard any incidental whitespace before it.
      quoted = true;
      field = '';
      index += 1;
      continue;
    } else if (ch === delimiter) {
      // An unquoted delimiter separates fields: close the current field and begin the next one.
      record.push(field);
      field = '';
      index += 1;
      continue;
    } else if (ch === '\r' || ch === '\n') {
      // A line break ends the current record regardless of quoting state: flush the pending field and record.
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      // A CRLF pair counts as one logical line break: when this character is '\r' followed by '\n', advance two positions,
      // otherwise a lone CR or LF advances only one.
      index += ch === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    } else {
      // Ordinary unquoted content: append it to the current field and move on.
      field += ch ?? '';
      index += 1;
    }
  }

  // If a quote was never closed, the text is malformed CSV and cannot form a table.
  if (quoted) {
    return null;
  } else {
    // Every quote was closed: flush the last record below.
  }

  // The last line has no break after it unless the text ended with one; flush any remaining field and record.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  } else {
    // The text ended on a line break, so there is nothing left to push: the trailing empty record was already flushed above.
  }

  return records;
}

/**
 * Chooses the delimiter that yields a valid rectangular table, or null when the text is not tabular.
 *
 * @purpose Attempts to parse the clipboard text as comma-delimited first and semicolon-delimited second, accepting only
 *   the result that forms a rectangular grid of at least two columns; prose with a stray comma is rejected rather than misread as a table.
 * @inputs text - Raw delimited clipboard string to evaluate.
 * @outputs DelimitedTable | null - Rectangular table representation with frozen rows and a column count, or null when not tabular.
 * @dataflow text → parseCsvRecords per delimiter → record matrix → width validation → newline-normalized frozen DelimitedTable.
 * @controlflow Guard empty text → try comma then semicolon → skip malformed or ragged results → normalize newlines in cells → return first valid grid.
 */
export function parseCsvText(text: string): DelimitedTable | null {
  // Empty or whitespace-only input carries no table; reject it before attempting to parse.
  // Empty or blank text needs no check of its own: it parses to no record or one blank field, which the width check refuses.

  // Try comma first, then semicolon: a European spreadsheet writes semicolons because the comma is its decimal separator.
  for (const delimiter of [',', ';'] as const) {
    const records = parseCsvRecords(text, delimiter);

    // A null or empty result means this delimiter does not describe the text; skip to the next candidate.
    if (records === null) {
      continue;
    } else {
      // This delimiter produced at least one record; its rectangular shape is validated by the check below.
    }

    const width = records[0]?.length ?? 0;

    // A valid table needs at least two columns and every record the same width; ragged or single-column input is rejected.
    if (width < 2 || !records.every((record) => record.length === width)) {
      continue;
    } else {
      // The records form a rectangular grid of at least two columns; build and return it below.
    }

    // A GFM cell is one line: a line break inside a quoted field becomes a space so the table stays flat.
    const rows: readonly (readonly string[])[] = records.map((record) =>
      Object.freeze(
        record.map((cell) => cell.replace(/\r\n|\r|\n/g, ' ').trim()),
      ),
    );

    return {
      rows: Object.freeze(rows),
      columns: width,
    };
  }

  // Neither delimiter produced a valid grid; the text is not tabular.
  return null;
}