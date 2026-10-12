/**
 * @file replacements.ts
 * @purpose Reduces line diffs to replacement ranges over base text for three-way merging (FR-6.4). Groups contiguous insertions and deletions into maximal Replacement intervals, compares line arrays for structural equality, and applies slice-level replacement changes to reconstruct conflicting line regions.
 * @inputs Readonly arrays of baseline and side line strings, group boundary indices, and readonly arrays of Replacement ranges.
 * @outputs Readonly arrays of Replacement ranges ordered ascending by start index, boolean line equality indicators, and reconstructed line arrays with applied replacements.
 * @functions
 *   - replacementsOf: Reduces line diff operations into maximal contiguous Replacement ranges over base lines, ordered by start index ascending.
 *   - linesEqual: Compares two line arrays for length equality and strict element-wise identity.
 *   - applyWithin: Reconstructs one side's version of base lines within [groupStart, groupEnd) by applying ordered, non-overlapping replacement changes from a single side.
 * @dataflow Base and side lines -> diffLines -> LineOp array -> replacementsOf run grouping -> Replacement array; base lines + Replacement array -> applyWithin -> reconstructed line slice.
 * @controlflow Walk Myers diff operations collecting non-keep runs into Replacement records -> test line arrays for early length mismatch then compare line elements -> iterate over group changes copying untouched base lines and inserting replacement lines.
 * @version 1
 * @date 2026-09-12
 */

import { diffLines } from './line-diff.js';
import type { LineOp } from './line-diff.js';

/** A run of base lines that one side replaced with lines of its own. */
export interface Replacement {
  /** First base line index the run replaces. */
  readonly start: number;
  /** One past the last base line index replaced; equal to `start` for a pure insertion. */
  readonly end: number;
  /** The lines that take their place; empty for a pure deletion. */
  readonly lines: readonly string[];
}

/**
 * @purpose Computes the maximal runs of consecutive line changes (insertions and deletions) between baseLines and sideLines as Replacement ranges over the base text. The result is ordered by `start` ascending because the walk through diff operations proceeds in sequential order; the sweep algorithm in `three-way.ts` relies on this ascending order.
 * @inputs
 *   - baseLines: readonly string[] - The array of lines in the common baseline document.
 *   - sideLines: readonly string[] - The array of lines in the modified side document.
 * @outputs readonly Replacement[] - Array of maximal replacement ranges over baseLines, ordered by start index ascending.
 * @dataflow baseLines + sideLines -> diffLines -> LineOp walk -> contiguous edit run grouping -> readonly Replacement[].
 * @controlflow Compute diff operations via diffLines -> walk ops tracking baseCursor and active run state -> close open run on keep -> open/extend run on delete advancing baseCursor -> open/extend run on insert appending side line -> close trailing open run after loop -> return replacements array.
 */
export function replacementsOf(
  baseLines: readonly string[],
  sideLines: readonly string[],
): readonly Replacement[] {
  const ops: readonly LineOp[] = diffLines(baseLines, sideLines);
  const replacements: Replacement[] = [];
  let baseCursor = 0;
  let runStart = 0;
  let runEnd = 0;
  let runLines: string[] = [];
  let open = false;

  // Walk through each diff operation in sequential order to group contiguous non-keep edits.
  for (const op of ops) {
    // Check whether the operation is a keep, delete, or insert.
    if (op.kind === 'keep') {
      // Check whether a replacement run is currently open.
      if (open) {
        // Close the open replacement run and record it in the replacements list.
        replacements.push({ start: runStart, end: runEnd, lines: runLines });
        open = false;
      } else {
        // No replacement run is open: nothing to record.
      }
      // Advance the base cursor past the matching kept base line.
      baseCursor++;
    } else if (op.kind === 'delete') {
      // Check whether a replacement run is already open.
      if (!open) {
        // Open a new replacement run anchored at the current base cursor.
        runStart = baseCursor;
        runEnd = baseCursor;
        runLines = [];
        open = true;
      } else {
        // Replacement run already open: continue accumulating into the active run.
      }
      // Advance the base cursor and update runEnd to consume the deleted base line.
      baseCursor++;
      runEnd = baseCursor;
    } else {
      // Insert operation: check whether a replacement run is already open.
      if (!open) {
        // Open a new replacement run anchored at the current base cursor.
        runStart = baseCursor;
        runEnd = baseCursor;
        runLines = [];
        open = true;
      } else {
        // Replacement run already open: continue accumulating into the active run.
      }
      // Append the inserted side line without advancing baseCursor.
      runLines.push(sideLines[op.afterIndex]!);
    }
  }

  // Check whether a replacement run remains open after processing all diff operations.
  if (open) {
    // Close and record the final replacement run.
    replacements.push({ start: runStart, end: runEnd, lines: runLines });
  } else {
    // No replacement run remains open at the end of the diff stream.
  }

  return replacements;
}

/**
 * @purpose Tests whether two arrays of line strings are strictly equal in length and content.
 * @inputs
 *   - a: readonly string[] - The first array of line strings.
 *   - b: readonly string[] - The second array of line strings.
 * @outputs boolean - True if both arrays have identical lengths and identical strings at every index; false otherwise.
 * @dataflow a + b -> length comparison -> element comparison loop -> boolean result.
 * @controlflow Compare array lengths returning false early on mismatch -> loop through line indices checking strict equality -> return false on first mismatch -> return true if all lines match.
 */
export function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  // Check whether the two line arrays differ in length.
  if (a.length !== b.length) {
    // Length mismatch: the arrays cannot be equal, return false early.
    return false;
  } else {
    // Array lengths match: proceed to line-by-line equality check.
  }

  // Iterate through all line indices to compare corresponding elements.
  for (let i = 0; i < a.length; i++) {
    // Check whether the lines at index i are strictly unequal.
    if (a[i]! !== b[i]!) {
      // Mismatched line detected: return false immediately.
      return false;
    } else {
      // Lines match at index i: continue checking remaining lines.
    }
  }

  // All lines at every index are strictly equal: return true.
  return true;
}

/**
 * @purpose Rebuilds one side's version of base lines within [groupStart, groupEnd) with the given replacement changes applied.
 * @inputs
 *   - baseLines: readonly string[] - The array of lines in the common baseline document.
 *   - groupStart: number - The starting base line index of the range (inclusive).
 *   - groupEnd: number - The ending base line index of the range (exclusive).
 *   - changes: readonly Replacement[] - The replacements from ONE side falling inside this group, in
 *     start order and non-overlapping, as replacementsOf produces them. Ranges that ran backwards
 *     or overlapped would emit lines twice.
 * @outputs readonly string[] - The reconstructed line sequence for this side over [groupStart, groupEnd).
 * @dataflow baseLines + group boundaries + changes -> copy untouched base segments and splice replacement lines -> reconstructed readonly string[].
 * @controlflow Initialize cursor at groupStart -> walk changes in start order -> copy untouched base lines before change -> push change lines -> update cursor with Math.max guarding pure insertions -> copy remaining trailing base lines -> return reconstructed lines.
 */
export function applyWithin(
  baseLines: readonly string[],
  groupStart: number,
  groupEnd: number,
  changes: readonly Replacement[],
): readonly string[] {
  const out: string[] = [];
  let cursor = groupStart;

  // Walk through each replacement change falling inside this group in start order.
  for (const change of changes) {
    // Carry across the untouched base lines between the cursor and this change.
    for (let i = cursor; i < change.start; i++) {
      out.push(baseLines[i]!);
    }

    // The change's own lines take the place of base[change.start, change.end).
    for (const line of change.lines) {
      out.push(line);
    }

    // Advance the cursor past the base lines this change replaced.
    //
    // No clamp is needed. replacementsOf closes a run only on a kept line, so the next run starts at
    // least one base line past where the last one ended: within one side's changes, start is strictly
    // greater than the previous end, and the cursor only ever moves forward. A Math.max here guarded a
    // case the input cannot produce, and an unreachable guard is a claim about the code that is not true.
    cursor = change.end;
  }

  // Carry across whatever untouched base lines remain after the last change up to groupEnd.
  for (let i = cursor; i < groupEnd; i++) {
    out.push(baseLines[i]!);
  }

  return out;
}
