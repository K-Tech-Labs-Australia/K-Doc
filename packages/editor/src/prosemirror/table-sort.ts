/**
 * @file table-sort.ts
 * @purpose Sort a GFM table's body rows by the column under the caret (FR-8.23), detecting whether that column holds numbers,
 *   dates, or text and ordering accordingly while keeping the header row fixed and moving the caret with its own row.
 * @inputs ProseMirror EditorState carrying a table node around the caret; a SortDirection token selecting ascending or descending.
 * @outputs A Command that rewrites the table body in sorted order (or does nothing when there is nothing to reorder).
 * @functions
 *   - numberValue: Parse spreadsheet-style numeric text into a finite number, or null.
 *   - dateValue: Parse ISO-style and named-date text into epoch milliseconds, or null.
 *   - validDate: Validate extracted components form a real instant and return its epoch value, or null.
 *   - detectColumnKind: Classify a column of texts as 'number', 'date', or 'text'.
 *   - sortOrder: Return the sorted index permutation for a column's values in a given direction.
 *   - sortTableByColumn: Command that reorders body rows by the caret's column via applyTableRewrite.
 * @dataflow EditorState → tableAt/rowsOf read → per-column strings → numberValue/dateValue/detectColumnKind/sortOrder classify & order → applyTableRewrite rebuild.
 * @controlflow Command resolves its table context, guards on body row count and already-sorted state, computes a kind-aware sort order, then rewrites the table with the header pinned first.
 * @version 1
 * @date 2026-09-15
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { tableAt, tableAlign } from './table-query.js';
import { rowsOf } from './table-build.js';
import { applyTableRewrite } from './table.js';

/**
 * The two possible sort directions for a column.
 */
export type SortDirection = 'ascending' | 'descending';

/**
 * The detected content kind of a column, which selects the comparator used when sorting.
 */
export type ColumnKind = 'number' | 'date' | 'text';

/** A number as a spreadsheet shows one: optional sign, currency symbol, thousands separators, decimals, percent. */
const NUMBER_PATTERN = /^[+-]?[$€£¥]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?$/;

/** ISO dates, with - or / and an optional time: 2026-09-15, 2026/09/15, 2026-09-15T10:30, 2026-09-15 10:30:00. */
const ISO_DATE_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** A day and month name, either order, then a year: 15 Sep 2026, 15 September 2026, Sep 15, 2026, September 15 2026. */
const NAMED_DATE_PATTERN = /^(?:(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})|([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}))$/;

/** The twelve month abbreviations accepted by the named-date parser, in calendar order. */
const MONTHS: readonly string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * @purpose Parse a cell's text into a floating-point number using spreadsheet conventions (sign, currency symbol, thousands
 *   separators, decimals, percent), returning null when the text is not such a number.
 * @inputs text - The raw cell string to interpret as a value.
 * @outputs number | null - The parsed numeric value, or null when `text` does not match the number pattern or yields a non-finite result.
 * @dataflow text → trimmed → regex test → currency/percent stripping → Number() → finiteness check → returned value.
 * @controlflow Trim → if it fails the number pattern return null; else parse and, on a finite result, return it, else null.
 */
export function numberValue(text: string): number | null {
  const trimmed = text.trim();
  // Strip surrounding whitespace first so leading/trailing spaces never defeat the pattern match.

  if (!NUMBER_PATTERN.test(trimmed)) {
    // The cell is not a recognisable spreadsheet number: reject it before any parsing.
    return null;
  } else {
    // The cell matches the number pattern; parse its stripped form below.
  }

  const value = Number(trimmed.replace(/[$€£¥,%\s]/g, ''));
  // Remove currency symbols, percent signs, spaces and thousands separators so `Number` sees a bare numeric literal.

  if (Number.isFinite(value)) {
    // The parsed result is a real finite number: return it as the column's value.
    return value;
  } else {
    // `Number` produced NaN or Infinity for an odd input that slipped past the pattern: reject it.
    return null;
  }
}

/**
 * @purpose Interpret a cell's text as an instant in time (milliseconds since the epoch, UTC), supporting ISO-style dates and
 *   day/month-name formats; returns null when neither parses or the date parts are invalid.
 * @inputs text - The raw cell string to interpret as a date.
 * @outputs number | null - Epoch milliseconds for the parsed instant in UTC, or null when `text` is not a recognised date.
 * @dataflow text → trimmed → ISO regex → named-date regex → group extraction → Date.UTC construction → returned value.
 * @controlflow Try ISO pattern first (return on match); else try named pattern; validate parts and month name before returning.
 */
export function dateValue(text: string): number | null {
  // The result is expressed in milliseconds since the epoch, measured in UTC throughout.

  const trimmed = text.trim();
  // Strip surrounding whitespace so a padded cell still matches either date pattern.

  const iso = ISO_DATE_PATTERN.exec(trimmed);
  // Attempt to match an ISO-style date first; `exec` returns null when there is no match.

  if (iso !== null) {
    // The cell matches an ISO-style date: destructure its captured groups and build the instant directly.
    const [, y, mo, d, h, mi, s] = iso;
    return validDate(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
    // Month is zero-based for Date.UTC, hence `mo - 1`; missing time groups default to zero.
  } else {
    // The cell is not an ISO-style date: fall through to the named-date parser below.
  }

  const named = NAMED_DATE_PATTERN.exec(trimmed);
  // Attempt the day/month-name format only when the ISO attempt failed.

  if (named === null) {
    // Neither pattern matched: this is not a recognised date at all.
    return null;
  } else {
    // A named-date pattern matched; read its captured groups below.
  }

  // Each ordering of the pattern fills one set of groups, so one of each pair is always present; the empty-string
  // defaults only satisfy the type checker.
  const day = named[1] ?? named[5] ?? '';
  // Day-of-month from either the "15 Sep 2026" or "September 15, 2026" ordering.

  const monthName = named[2] ?? named[4] ?? '';
  // Month name from either ordering; a trailing period (e.g. "Sep.") is already absorbed by the pattern.

  const year = named[3] ?? named[6] ?? '';
  // Four-digit year from either ordering.

  // An unknown month name gives -1, which validDate rejects: month -1 rolls over into December of the year before.
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  // Normalise to a three-letter lowercase abbreviation and look it up in the fixed month table.

  return validDate(Number(year), month, Number(day), 0, 0, 0);
  // Named dates carry no time component, so the time fields default to midnight UTC.
}

/**
 * @purpose Validate that extracted date/time components form a real instant and return its epoch-millisecond value.
 * @inputs year - Four-digit calendar year.
 *   month - Zero-based month (0 = January).
 *   day - Day of the month.
 *   hours, minutes, seconds - Time-of-day components, each expected within its normal range.
 * @outputs number | null - Epoch milliseconds for the validated instant, or null when the parts do not round-trip or a component is out of range.
 * @dataflow Components → Date.UTC(...) → new Date → round-trip comparison against original components → returned value.
 * @controlflow Build the UTC instant; if every component survives the round trip and time fields are in range return it, else null.
 */
function validDate(year: number, month: number, day: number, hours: number, minutes: number, seconds: number): number | null {
  // Date.UTC rolls 30 February over into March; a date whose parts do not survive the round trip does not exist. An hour of
  // 24 or more rolls the day over too, so it needs no check of its own; minutes and seconds only roll the hour and minute.

  const value = Date.UTC(year, month, day, hours, minutes, seconds);
  // Construct the candidate instant in UTC from the individual components.

  const date = new Date(value);
  // Re-open the instant so its accessor methods report the normalised calendar fields.

  if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && minutes < 60 && seconds < 60) {
    // The parts survived the round trip and every time component is in range: this is a real instant.
    return value;
  } else {
    // The parts rolled over (e.g. 30 February) or a time field was out of range: no such date exists.
    return null;
  }
}

/**
 * @purpose Classify a column of cell texts as numeric, date, or text based on what every non-empty cell parses as.
 * @inputs values - The raw strings for one column across all body rows.
 * @outputs ColumnKind - 'number' when every filled cell is a number, 'date' when every filled cell is a date, else 'text'.
 * @dataflow values → trimmed non-empty filter → kind tests in priority order → returned ColumnKind token.
 * @controlflow Drop empties; if none remain return text; else if all are numbers return number; else if all are dates return date; else text.
 */
export function detectColumnKind(values: readonly string[]): ColumnKind {
  // Empty cells say nothing about the column; a column of only empty cells sorts as text.

  const filled = values.map((value) => value.trim()).filter((value) => value !== '');
  // Trim each cell and keep only those that hold actual content for classification.

  if (filled.length === 0) {
    // No non-empty cells: there is no signal about the column, so treat it as plain text.
    return 'text';
  } else {
    // At least one cell holds data; classify the column by its content below.
  }

  if (filled.every((value) => numberValue(value) !== null)) {
    // Every filled cell parses as a number: this is a numeric column.
    return 'number';
  } else {
    // Not every cell is a number; try the date test below before defaulting to text.
  }

  if (filled.every((value) => dateValue(value) !== null)) {
    // Every filled cell parses as a date: this is a date column.
    return 'date';
  } else {
    // Not every cell is a date either; fall through to the text default below.
  }

  return 'text';
  // Mixed or unrecognised content degrades the column to plain-text sorting.
}

/** Locale-aware collator with numeric sensitivity for stable, human-friendly text ordering. */
const TEXT_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * @purpose Return the indices of a column's values in sorted order, detecting the column kind and keeping empty cells last.
 * @inputs values - The raw strings for one column across all body rows.
 *   direction - Whether to sort ascending or descending.
 * @outputs number[] - A permutation of the input indices yielding the sorted order; stable on ties with empties pinned last.
 * @dataflow values → detectColumnKind + mapped index array → comparator keyed by kind → sorted index list.
 * @controlflow Determine kind and sign; sort a copy of the indices with a comparator that special-cases empty cells, numbers, dates, text.
 */
export function sortOrder(values: readonly string[], direction: SortDirection): number[] {
  // The indices of `values` in sorted order. Stable, and empty cells go last whichever the direction, as a spreadsheet does.

  const kind = detectColumnKind(values);
  // Classify the column once so every comparison uses a consistent strategy.

  const indices = values.map((_value, index) => index);
  // Seed the permutation with identity; sorting reorders these into the final order.

  let sign: number;
  if (direction === 'ascending') {
    // Ascending order uses a positive multiplier so the comparator keeps its natural direction.
    sign = 1;
  } else {
    // Descending order inverts the comparator with a negative multiplier.
    sign = -1;
  }

  indices.sort((a, b) => {
    // Comparator over two original indices `a` and `b`; its sign decides ascending vs descending.
    const left = (values[a] ?? '').trim();
    // Guard the indexed read against noUncheckedIndexedAccess, then trim for comparison.
    const right = (values[b] ?? '').trim();
    // Same guarding and trimming for the right operand.

    if (left === '' || right === '') {
      // One or both cells are empty: empties sort last whichever the direction, so the sign is not applied. Two empty
      // cells give 0 and, the sort being stable, keep their order.
      return Number(left === '') - Number(right === '');
    } else {
      // Both cells hold data: classify and compare them by detected kind below.
    }

    let compared: number;
    if (kind === 'number') {
      // Numeric column: subtract parsed values so larger numbers sort later in ascending order.
      compared = (numberValue(left) ?? 0) - (numberValue(right) ?? 0);
    } else if (kind === 'date') {
      // Date column: subtract epoch milliseconds so earlier instants sort first in ascending order.
      compared = (dateValue(left) ?? 0) - (dateValue(right) ?? 0);
    } else {
      // Text column: use a locale-aware collator with numeric sensitivity so "item 2" precedes "item 10".
      compared = TEXT_ORDER.compare(left, right);
    }

    // Array.prototype.sort is stable, so cells that compare equal keep their input order without a tie-break here.
    return sign * compared;
  });

  return indices;
  // Return the permutation of original indices in their new sorted position.
}

/**
 * @purpose ProseMirror command that reorders a table's body rows by the caret's column, leaving the header row in place.
 * @inputs direction - Whether to sort ascending or descending.
 * @outputs Command - A command returning false (doing nothing) when there is no table, too few body rows, or no reorder needed;
 *   otherwise it rewrites the table via applyTableRewrite and moves the caret with its row.
 * @dataflow EditorState → tableAt context → rowsOf → per-column values → sortOrder → rebuilt row order → applyTableRewrite.
 * @controlflow Command resolves its table context, guards on body row count and already-sorted state, computes a kind-aware sort order, then rewrites the table with the header pinned first.
 */
export function sortTableByColumn(direction: SortDirection): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const ctx = tableAt(state);
    // Locate the enclosing table and the caret's row/cell coordinates within it.

    if (ctx === null) {
      // The caret is not inside a table: there is nothing to sort, so do nothing.
      return false;
    } else {
      // An enclosing table exists; read its rows below.
    }

    const rows = rowsOf(ctx.table);
    // Materialise the table into a plain 2-D array of row nodes for reordering.

    // The header row stays first: GFM has no table without it. Fewer than two body rows leaves nothing to reorder.
    const body = rows.slice(1);
    // Drop the header (row 0) and keep only the reorderable body rows.

    // Zero or one body row needs no check of its own: its order is the identity, which the already-sorted check refuses.

    const values = body.map((row) => row[ctx.cellIndex]?.textContent ?? '');
    // Collect this column's text from each body row, tolerating short/ragged rows with a default empty string.

    const order = sortOrder(values, direction);
    // Compute the new body-row order for the detected column kind and requested direction.

    // Already in order: rewriting would add an undo step that changes nothing.
    if (order.every((original, position) => original === position)) {
      // The rows are already sorted by this column and direction; skip the rewrite to avoid a no-op undo entry.
      return false;
    } else {
      // At least one row is out of place: proceed to rebuild the table below.
    }

    const header = rows[0];
    if (header === undefined) {
      // No header row exists, which contradicts GFM's invariant but guard anyway before indexing it.
      return false;
    } else {
      // The header row is present and will be re-attached first in the rebuilt table.
    }

    const sorted: ProseMirrorNode[][] = [header];
    // Start the rebuilt table with the unchanged header row pinned at the top.

    for (const original of order) {
      // Walk the computed order, appending each body row by its original index.
      const row = body[original];
      if (row !== undefined) {
        // Every index in order is a body index, so the row exists.
        sorted.push(row);
      } else {
        // Not reached: order only holds body indices.
      }
    }

    // The caret follows its own row to where it sorted.
    // Where the caret's body row landed, one below the pinned header. From the header itself the lookup is for -1, which
    // is found nowhere, and -1 + 1 keeps the caret in the header.
    const caretRow = order.indexOf(ctx.rowIndex - 1) + 1;

    return applyTableRewrite(state, dispatch, ctx.tablePos, ctx.table, sorted, tableAlign(ctx.table), caretRow, ctx.cellIndex);
    // Rewrite the whole table with the new row order, preserving alignment and placing the caret on its moved row.
  };
}