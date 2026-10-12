/**
 * @file fidelity-tracker.ts
 * @purpose Tracks which character regions of a document were edited as raw Markdown text since it was last saved, feeding K-Doc's Fidelity Check (FR-4.5) so that WYSIWYG-only edits are not mistaken for user-authored text changes.
 * @inputs Base (last-saved) document text, the current document text, per-edit OffsetRange records, and a boolean flag distinguishing the user's text edits from edits whose bytes the check must judge.
 * @outputs DiffRegion descriptors of changed spans, shifted and merged OffsetRange arrays marking touched regions, and FidelityFinding results produced by the companion fidelity-check module.
 * @functions
 *   - diffRegion: Computes the minimal differing span between two texts via common prefix/suffix lengths.
 *   - shiftRanges: Re-expresses old-text offset ranges into new-text coordinates after a change.
 *   - mergeRanges: Sorts and coalesces overlapping or adjacent offset ranges.
 *   - FidelityTracker: Maintains the base text and cumulative touched ranges across edits.
 *   - FidelityTracker#baseText: Getter returning the last-saved base text.
 *   - FidelityTracker#touched: Getter returning a copy of the current touched ranges.
 *   - FidelityTracker#record: Incorporates a single edit into the tracked ranges.
 *   - FidelityTracker#rebase: Resets all state to a new saved baseline.
 *   - FidelityTracker#check: Runs the fidelity check against the base text using tracked ranges.
 * @dataflow Input texts -> diffRegion span -> shiftRanges/mergeRanges range bookkeeping -> cumulative touched ranges -> checkFidelity findings.
 * @controlflow Construct with baseline -> on each edit compute diff, shift prior ranges, optionally mark new span, merge -> rebase clears state -> check folds unrecorded edits and runs the fidelity check.
 * @version 1
 * @date 2026-09-14
 */

import type { OffsetRange } from '../position/map.js';
import { checkFidelity, type FidelityFinding } from './fidelity-check.js';

/** Minimal differing span between two texts. */
export interface DiffRegion {
  /** First offset at which the two texts differ. */
  readonly start: number;
  /** End (exclusive) of the differing region in the old text. */
  readonly oldEnd: number;
  /** End (exclusive) of the differing region in the new text. */
  readonly newEnd: number;
}

/**
 * Computes the minimal differing span between two texts via common prefix/suffix lengths.
 *
 * @purpose Locates the smallest contiguous region that differs between oldText and newText by measuring their common prefix and suffix so callers can map edits across a text change.
 * @inputs oldText - The previous version of the document text.
 * @inputs newText - The current version of the document text.
 * @outputs DiffRegion | null - The differing span { start, oldEnd, newEnd }, or null when the texts are identical.
 * @dataflow Compare char codes from both ends -> compute prefix and suffix lengths -> derive region offsets from text lengths minus suffix length.
 * @controlflow Return null on equality -> extend common prefix until a mismatch -> extend common suffix while not overlapping the prefix -> build and return DiffRegion.
 */
export function diffRegion(oldText: string, newText: string): DiffRegion | null {
  // If both texts are byte-for-byte identical there is no differing region to report.
  if (oldText === newText) {
    return null;
  } else {
    const minLength = Math.min(oldText.length, newText.length);

    // Extend the common prefix while char codes match and we stay within the shorter text.
    let prefixLen = 0;
    while (prefixLen < minLength && oldText.charCodeAt(prefixLen) === newText.charCodeAt(prefixLen)) {
      prefixLen += 1;
    }

    // Extend the common suffix from the ends, stopping before it would collide with the prefix.
    let suffixLen = 0;
    while (suffixLen < minLength - prefixLen) {
      const oldChar = oldText.charCodeAt(oldText.length - 1 - suffixLen);
      const newChar = newText.charCodeAt(newText.length - 1 - suffixLen);
      // Check whether the characters at the current suffix positions are equal.
      if (oldChar === newChar) {
        // Suffix character matches: grow the common suffix by one.
        suffixLen += 1;
      } else {
        // First mismatch from the end: the common suffix ends here.
        break;
      }
    }

    return {
      start: prefixLen,
      oldEnd: oldText.length - suffixLen,
      newEnd: newText.length - suffixLen,
    };
  }
}

/**
 * Re-expresses old-text offset ranges into new-text coordinates after a change.
 *
 * @purpose Translates each OffsetRange written against oldText so it lines up with newText, using the span reported by diffRegion as the translation anchor.
 * @inputs ranges - The half-open ranges expressed in the OLD text coordinate space.
 * @inputs region - The differing span between oldText and newText produced by diffRegion.
 * @outputs OffsetRange[] - A new array of ranges re-expressed in the NEW text coordinate space; the input array is never mutated.
 * @dataflow For each range test its position against region -> compute shifted endpoints using delta or clamped edges -> collect into a fresh array.
 * @controlflow Compute delta = newEnd - oldEnd -> iterate ranges in order -> branch on before/after/overlap -> push transformed range -> return the new array.
 */
export function shiftRanges(ranges: readonly OffsetRange[], region: DiffRegion): OffsetRange[] {
  // The edit's width change; positive when newText gained characters, negative when it lost them.
  const delta = region.newEnd - region.oldEnd;
  const shifted: OffsetRange[] = [];

  for (const range of ranges) {
    // Check whether the range ends at or before the edit start (entirely before the change).
    if (range.end <= region.start) {
      // Range precedes the edit unchanged.
      shifted.push({ start: range.start, end: range.end });
    } else if (range.start >= region.oldEnd) {
      // Check whether the range begins at or after the edit end (entirely after the change).
      // Shift both endpoints by delta to follow the text that moved.
      shifted.push({ start: range.start + delta, end: range.end + delta });
    } else {
      // The range straddles the changed region: pin its leading edge into the edit and clamp or extend its trailing edge.
      const newStart = Math.min(range.start, region.start);
      // If the range crossed oldEnd it extends by delta; otherwise its tail is pinned to the new edit end.
      const newEnd = range.end > region.oldEnd ? range.end + delta : region.newEnd;
      shifted.push({ start: newStart, end: newEnd });
    }
  }

  return shifted;
}

/**
 * Sorts and coalesces overlapping or adjacent offset ranges.
 *
 * @purpose Collapses a list of half-open ranges into a minimal set of disjoint ranges by merging any that overlap or touch, so touched regions are represented compactly.
 * @inputs ranges - The half-open ranges to normalize (may be unsorted and overlapping).
 * @outputs OffsetRange[] - A new array of sorted, non-overlapping ranges; the input array is never mutated or reordered in place.
 * @dataflow Copy ranges -> sort by start then end -> fold each range into the previous when adjacent/overlapping -> emit disjoint result.
 * @controlflow Seed result with first range -> for each subsequent range merge when next.start <= prev.end else append -> return merged array.
 */
export function mergeRanges(ranges: readonly OffsetRange[]): OffsetRange[] {
  // Copy before sorting so the caller's array order and identity are preserved.
  // Sort ascending by start offset, breaking ties by end offset.
  const sorted = [...ranges].sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  const merged: OffsetRange[] = [];

  for (const range of sorted) {
    // Check whether any range has been emitted yet.
    if (merged.length === 0) {
      // No prior range: seed the result with this one.
      merged.push({ start: range.start, end: range.end });
    } else {
      const last = merged[merged.length - 1];
      // Guard the indexed read for noUncheckedIndexedAccess; length > 0 guarantees a value here.
      if (last === undefined) {
        merged.push({ start: range.start, end: range.end });
      } else if (range.start <= last.end) {
        // Check whether this range overlaps or is adjacent to the previous one.
        // Overlap/adjacency: extend the previous range's end to cover both.
        const newEnd = Math.max(last.end, range.end);
        merged[merged.length - 1] = { start: last.start, end: newEnd };
      } else {
        // Disjoint range with a gap before it: emit as its own region.
        merged.push({ start: range.start, end: range.end });
      }
    }
  }

  return merged;
}

/**
 * Tracks character regions edited as raw Markdown text since the document was last saved.
 *
 * @purpose Accumulates the set of touched offset ranges across successive edits so the companion fidelity check can distinguish user-authored text changes from WYSIWYG tree edits.
 * @inputs baseText - The last-saved document text that defines the fidelity baseline.
 * @inputs currentText - Optional unsaved working text; defaults to baseText when omitted.
 * @outputs Touched ranges exposed via touched and findings produced by check against the baseline.
 * @dataflow Text edits -> diffRegion span -> shiftRanges/mergeRanges bookkeeping -> cumulative touched ranges -> checkFidelity findings on demand.
 * @controlflow Construct with baseline -> record folds each edit into tracked ranges -> rebase resets to a new baseline -> check runs the fidelity check, folding any unrecorded change in as user text.
 */
export class FidelityTracker {
  private base: string;
  private lastText: string;
  private ranges: OffsetRange[];

  /**
   * Creates a tracker seeded with the baseline and optional working text.
   *
   * @purpose Establishes the saved baseline and, when unsaved work is present, conservatively marks the entire differing span as touched since prior edits are unknown.
   * @inputs baseText - The last-saved document text defining the fidelity baseline.
   * @inputs currentText - Optional current working text; defaults to baseText (no tracked edits) when omitted.
   * @outputs A FidelityTracker instance with initial ranges computed from diffRegion(baseText, currentText).
   * @dataflow baseText + currentText -> diffRegion span -> seed ranges with the whole span or empty -> store baseline and working text.
   * @controlflow Assign base and lastText -> compute region -> set ranges to [] when equal else [{ start: region.start, end: region.newEnd }].
   */
  constructor(baseText: string, currentText?: string) {
    this.base = baseText;
    // When no working text is supplied the document is considered clean (no tracked edits).
    this.lastText = currentText ?? baseText;

    const region = diffRegion(this.base, this.lastText);
    // Check whether the working text differs from the baseline at all.
    if (region === null) {
      // No difference: nothing has been touched since save.
      this.ranges = [];
    } else {
      // Unsaved work exists: treat the whole differing span as touched, which can only hide findings, never invent them.
      this.ranges = [{ start: region.start, end: region.newEnd }];
    }
  }

  /**
   * Returns the last-saved baseline text.
   *
   * @purpose Exposes the immutable base against which fidelity is measured.
   * @inputs None.
   * @outputs string - The baseline document text captured at construction or rebase time.
   * @dataflow Stored base field -> returned directly.
   * @controlflow Read and return this.base with no branching.
   */
  get baseText(): string {
    return this.base;
  }

  /**
   * Returns a copy of the touched offset ranges.
   *
   * @purpose Exposes the accumulated regions edited as text without allowing callers to mutate internal state.
   * @inputs None.
   * @outputs readonly OffsetRange[] - A shallow copy of the current tracked ranges.
   * @dataflow Stored ranges array -> spread into a new array -> returned to caller.
   * @controlflow Return a fresh array copy of this.ranges with no branching.
   */
  get touched(): readonly OffsetRange[] {
    return [...this.ranges];
  }

  /**
   * Incorporates a single edit into the tracked ranges.
   *
   * @purpose Shifts previously tracked ranges to follow the edit, optionally marks the new span as user text, and merges for a compact representation.
   * @inputs newText - The document text after this edit.
   * @inputs textEdit - True when the change was authored in Markdown text (source typing, find/replace, version restore, undo, redo); false for WYSIWYG tree edits.
   * @outputs void.
   * @dataflow Compare with lastText -> diffRegion span -> shiftRanges prior ranges -> optionally append new span -> mergeRanges -> update lastText.
   * @controlflow Early return when unchanged -> compute region (early return if null) -> shift ranges -> push span iff textEdit -> merge -> assign lastText.
   */
  record(newText: string, textEdit: boolean): void {
    // Check whether the text actually changed since the last recorded state.
    if (newText === this.lastText) {
      // No change occurred: leave tracked ranges untouched.
      return;
    }

    const region = diffRegion(this.lastText, newText);
    // A non-empty edit always yields a region; guard anyway in case of an unexpected equal result.
    if (region === null) {
      // No differing span despite inequality: nothing to record.
      return;
    } else {
      // Recompute prior ranges against the new coordinate space before considering this edit.
      this.ranges = shiftRanges(this.ranges, region);

      // Check whether this edit was authored in Markdown text rather than the tree or history.
      if (textEdit) {
        // User-authored text change: mark the full changed span as touched.
        this.ranges.push({ start: region.start, end: region.newEnd });
      } else {
        // A WYSIWYG tree edit: do not attribute these bytes to the user, so the check judges them.
      }

      // Coalesce overlapping or adjacent ranges into a minimal disjoint set.
      this.ranges = mergeRanges(this.ranges);
      this.lastText = newText;
    }
  }

  /**
   * Resets all state to a new saved baseline.
   *
   * @purpose Clears tracked edits after a save so subsequent edits are measured against the fresh baseline.
   * @inputs text - The newly-saved document text that becomes the new baseline and current working text.
   * @outputs void.
   * @dataflow New text -> overwrite base, lastText, and clear ranges.
   * @controlflow Assign base and lastText to text then reset ranges to an empty array.
   */
  rebase(text: string): void {
    this.base = text;
    this.lastText = text;
    this.ranges = [];
  }

  /**
   * Runs the fidelity check against the baseline using tracked ranges.
   *
   * @purpose Produces FidelityFinding results describing blocks or gaps where current text diverges from the baseline in user-authored regions.
   * @inputs currentText - The document text to evaluate against the baseline.
   * @outputs readonly FidelityFinding[] - Findings emitted by checkFidelity for the tracked touched ranges.
   * @dataflow Fold any unrecorded change as user text -> invoke checkFidelity(base, currentText, ranges) -> return findings.
   * @controlflow If currentText differs from lastText record it as a text edit -> call checkFidelity with base and ranges.
   */
  check(currentText: string): readonly FidelityFinding[] {
    // Check whether there is an unrecorded change whose origin is unknown.
    if (currentText !== this.lastText) {
      // Unknown-origin change: attribute it to the user so fidelity cannot miss a real edit.
      this.record(currentText, true);
    } else {
      // Text already recorded or unchanged: proceed with existing tracked ranges.
    }

    return checkFidelity(this.base, currentText, this.ranges);
  }
}