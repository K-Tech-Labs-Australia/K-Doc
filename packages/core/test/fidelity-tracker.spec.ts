/**
 * @file fidelity-tracker.spec.ts
 * @purpose Verifies the touched-range bookkeeping behind the Fidelity Check (FR-4.5): diffRegion span computation, shiftRanges coordinate translation, mergeRanges coalescing, and the FidelityTracker record/rebase/check lifecycle that separates user-authored text edits from WYSIWYG tree edits.
 * @inputs Source texts for diff assertions; OffsetRange arrays fed to shiftRanges and mergeRanges; FidelityTracker baseline and working texts exercised through constructor, record, rebase, and check.
 * @outputs Expectation results asserting DiffRegion descriptors, shifted/merged OffsetRange arrays, touched range snapshots, and fidelity finding counts.
 * @functions
 *   - diffRegion: Asserts minimal differing-span computation across prefix/suffix edge cases.
 *   - shiftRanges: Asserts coordinate translation of ranges relative to a region without mutating input.
 *   - mergeRanges: Asserts sorting and coalescing of overlapping or adjacent ranges.
 *   - FidelityTracker: Asserts the record/rebase/check lifecycle that tracks user-authored text edits.
 * @dataflow Test inputs -> diffRegion/shiftRanges/mergeRanges/FidelityTracker functions -> expected values compared by expect().
 * @controlflow Import module -> run describe blocks in order -> each it computes an expectation and asserts -> Vitest reports pass/fail.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { FidelityTracker, diffRegion, mergeRanges, shiftRanges } from '../src/fidelity/fidelity-tracker.js';

describe('diffRegion', () => {
  it('returns null when the texts are identical', () => {
    // Identical inputs have no differing span to report.
    expect(diffRegion('abc', 'abc')).toBeNull();
  });

  it('reports an inserted character as a prefix-anchored new-end span', () => {
    // The common suffix 'c' shrinks the new text's end offset relative to its length.
    expect(diffRegion('abc', 'abXc')).toEqual({ start: 2, oldEnd: 2, newEnd: 3 });
  });

  it('reports a truncated character as an old-end span with unchanged new end', () => {
    // Removing the trailing 'a' leaves the prefix intact and drops one old-text offset.
    expect(diffRegion('aaa', 'aa')).toEqual({ start: 2, oldEnd: 3, newEnd: 2 });
  });

  it('reports a full replacement spanning both texts from zero', () => {
    // No common prefix or suffix anchors the region at the very start of each text.
    expect(diffRegion('abc', 'xyz')).toEqual({ start: 0, oldEnd: 3, newEnd: 3 });
  });

  it('reports an insertion into empty text from offset zero', () => {
    // An empty source yields a zero-length old end while the new end grows by one.
    expect(diffRegion('', 'a')).toEqual({ start: 0, oldEnd: 0, newEnd: 1 });
  });

  it('keeps prefix and suffix regions from overlapping on repeated content', () => {
    // The shared 'ab' prefix ends where the dropped 'ab' suffix begins.
    expect(diffRegion('abab', 'ab')).toEqual({ start: 2, oldEnd: 4, newEnd: 2 });
  });
});

describe('shiftRanges', () => {
  // Region anchors translation: edit starts at offset 5 in the old text and ends at 8, growing to end at 10 (delta +2).
  const region = { start: 5, oldEnd: 8, newEnd: 10 };

  it('leaves a range ending exactly at the edit start unchanged', () => {
    // A range whose end equals region.start precedes the change and is copied verbatim.
    expect(shiftRanges([{ start: 0, end: 5 }], region)).toEqual([{ start: 0, end: 5 }]);
  });

  it('shifts a range entirely after the edit by the delta', () => {
    // Both endpoints move forward by delta to follow text displaced past the change.
    expect(shiftRanges([{ start: 8, end: 12 }], region)).toEqual([{ start: 10, end: 14 }]);
  });

  it('pins a fully inside range into the edit span', () => {
    // A range before oldEnd is collapsed to the full new edit extent.
    expect(shiftRanges([{ start: 6, end: 7 }], region)).toEqual([{ start: 5, end: 10 }]);
  });

  it('extends a straddling range by delta past the old end', () => {
    // The leading edge pins at region.start while the trailing edge grows with the change.
    expect(shiftRanges([{ start: 3, end: 9 }], region)).toEqual([{ start: 3, end: 11 }]);
  });

  it('leaves a range far before the edit untouched', () => {
    // A range well before region.start is copied verbatim without adjustment.
    expect(shiftRanges([{ start: 2, end: 4 }], region)).toEqual([{ start: 2, end: 4 }]);
  });

  it('does not mutate the input array', () => {
    // shiftRanges must return a fresh array and leave the caller's ranges intact.
    const input = [{ start: 8, end: 12 }];
    shiftRanges(input, region);
    expect(input).toEqual([{ start: 8, end: 12 }]);
  });
});

describe('mergeRanges', () => {
  it('coalesces overlapping and adjacent ranges into disjoint spans', () => {
    // The sorted fold merges {0,2}+{2,3} and {5,7}+{6,9} while leaving the gap intact.
    expect(
      mergeRanges([{ start: 5, end: 7 }, { start: 0, end: 2 }, { start: 2, end: 3 }, { start: 6, end: 9 }]),
    ).toEqual([{ start: 0, end: 3 }, { start: 5, end: 9 }]);
  });

  it('returns an empty array for empty input', () => {
    // No ranges to merge yields no result.
    expect(mergeRanges([])).toEqual([]);
  });

  it('keeps a one-offset gap as two distinct ranges', () => {
    // A single-unit gap keeps the ranges disjoint so they are not merged.
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 3, end: 4 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

describe('FidelityTracker', () => {
  it('starts with nothing touched when the texts match', () => {
    // Identical baseline and working text leaves zero tracked ranges.
    const tracker = new FidelityTracker('abc');
    expect(tracker.touched).toEqual([]);
    expect(tracker.baseText).toBe('abc');
  });

  it('treats unsaved work it was mounted with as touched', () => {
    // Constructor seeds the whole differing span of unsaved edits as touched.
    const tracker = new FidelityTracker('abc', 'abXc');
    expect(tracker.touched).toEqual([{ start: 2, end: 3 }]);
  });

  it('marks text edits and shifts them past later tree edits', () => {
    // A text edit marks its span; a subsequent tree edit shifts that span forward without re-marking.
    const tracker = new FidelityTracker('# A\n\nOne.\n');
    tracker.record('# A\n\nOne!\n', true);
    expect(tracker.touched).toEqual([{ start: 8, end: 9 }]);
    tracker.record('# AB\n\nOne!\n', false);
    expect(tracker.touched).toEqual([{ start: 9, end: 10 }]);
  });

  it('ignores a record with unchanged text', () => {
    // Recording the current text again is a no-op that leaves ranges empty.
    const tracker = new FidelityTracker('abc');
    tracker.record('abc', true);
    expect(tracker.touched).toEqual([]);
  });

  it('rebase clears touched ranges and moves the baseline', () => {
    // After rebase the baseline advances to the saved text and tracked edits are cleared.
    const tracker = new FidelityTracker('abc', 'abXc');
    tracker.rebase('abXc');
    expect(tracker.touched).toEqual([]);
    expect(tracker.baseText).toBe('abXc');
  });

  it('reports a tree edit that reformats an unedited block', () => {
    // A WYSIWYG reformat of untouched text is flagged as a fidelity finding.
    const tracker = new FidelityTracker('* a\n* b\n\nText\n');
    tracker.record('- a\n- b\n\nText\n', false);
    expect(tracker.check('- a\n- b\n\nText\n')).toHaveLength(1);
  });

  it('does not report the same change made as text', () => {
    // When the identical reformat is recorded as user text, no finding is emitted.
    const tracker = new FidelityTracker('* a\n* b\n\nText\n');
    tracker.record('- a\n- b\n\nText\n', true);
    expect(tracker.check('- a\n- b\n\nText\n')).toEqual([]);
  });

  it('treats an unrecorded change as the user\'s', () => {
    // check folds an unknown-origin edit in as text, attributing it to the user.
    const tracker = new FidelityTracker('* a\n* b\n\nText\n');
    expect(tracker.check('- a\n- b\n\nText\n')).toEqual([]);
    expect(tracker.touched.length).toBeGreaterThan(0);
  });
});
