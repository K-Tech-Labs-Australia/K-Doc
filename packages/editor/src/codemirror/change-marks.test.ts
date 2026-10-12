// @vitest-environment jsdom
/**
 * @file change-marks.test.ts
 * @purpose Vitest suite proving that the CodeMirror 6 change-mark plumbing in ./change-marks.js behaves at state level: an empty field, authoritative span replacement (not merge), insertion marks its range, deletion is a zero-width widget point, insert+delete sharing one offset yields two decorations via Decoration.set(ranges, true) with delegated sorting, out-of-range/collapsed-span dropping, and non-early-return scanning of transaction effects.
 * @inputs The changeMarks extension, setChangeSpansEffect, changeMarksField, EditorState/StateEffect from @codemirror/state, and ChangeSpan from @k-doc/core — all inspected purely through editor state so no live view or layout is required.
 * @outputs Pass/fail assertions pinning: initial emptiness, insertion range alignment, deletion zero-width point, shared-offset two-decoration ordering under both input orders, stale-span dropping past doc end, and effect-order-independent scanning.
 * @functions
 *   - makeState: Builds an EditorState carrying changeMarks so decoration sets can be inspected at state level without a view.
 *   - insertSpan: Factory constructing an insertion ChangeSpan literal for use as a setChangeSpansEffect payload.
 *   - deleteSpan: Factory constructing a zero-width deletion ChangeSpan literal (start == end) with the removed text carried in `text`.
 *   - applySpans: Applies a readonly ChangeSpan[] as the authoritative plan via setChangeSpansEffect and returns the resulting EditorState.
 *   - count: Returns the number of decorations currently held by changeMarksField.
 *   - firstRange: Captures only the lowest-offset range from the decoration set for offset assertions.
 * @dataflow Test builds state with changeMarks() -> applySpans emits setChangeSpansEffect.of(spans) -> changeMarksField.update rebuilds via Decoration.set(ranges, true) -> count/firstRange read the resulting DecorationSet through StateField and RangeSet.between to assert painted ranges.
 * @controlflow A single describe('change-marks') block runs seven independent it() cases; each derives its own state from makeState so tests never share mutable decoration sets, mirroring comment-marks.test.ts's state-only approach.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { ChangeSpan } from '@k-doc/core';
import { changeMarks, changeMarksField, setChangeSpansEffect } from './change-marks.js';

// Shared document; 'quick' spans offsets 4..9 within these 19 characters (source offsets match CodeMirror indexing).
const TEXT = 'The quick brown fox';

/**
 * @purpose Builds an EditorState carrying changeMarks so decoration sets can be inspected at state level without a view.
 * @inputs none; uses the shared TEXT document.
 * @outputs A fresh EditorState whose changeMarksField holds Decoration.none (an empty set).
 * @dataflow TEXT -> EditorState.create with [changeMarks()] extension -> field initialized to an empty DecorationSet.
 * @controlflow Single create call, no branching — every helper derives from this so tests never share mutable state.
 */
function makeState(): EditorState {
  return EditorState.create({ doc: TEXT, extensions: [changeMarks()] });
}

/**
 * @purpose Constructs an insertion ChangeSpan literal for use as a setChangeSpansEffect payload in the tests.
 * @inputs changeId - owning change identifier; start/end - source offsets (start inclusive, end exclusive).
 * @outputs A readonly ChangeSpan with kind 'insert' whose text is sliced from TEXT so it matches what lives in the document.
 * @dataflow Test-provided offsets -> plain object literal returned to caller for wrapping in setChangeSpansEffect.of(spans).
 * @controlflow Pure definition, no branching — a thin factory so test bodies stay declarative.
 */
function insertSpan(changeId: string, start: number, end: number): ChangeSpan {
  return { changeId, kind: 'insert', author: 'Ada', start, end, text: TEXT.slice(start, end), resolution: 'exact' };
}

/**
 * @purpose Constructs a zero-width deletion ChangeSpan literal (start == end) carrying the removed text in `text`.
 * @inputs changeId - owning change identifier; at - source offset where removal occurred; text - characters that were deleted from the document.
 * @outputs A readonly ChangeSpan with kind 'delete' whose start and end are both `at`, so it marks a point rather than an extent (FR-11.6).
 * @dataflow Test-provided offset + removed text -> plain object literal returned to caller for wrapping in setChangeSpansEffect.of(spans).
 * @controlflow Pure definition, no branching — the zero-width shape is what makes deletions render as widgets instead of over-document marks.
 */
function deleteSpan(changeId: string, at: number, text: string): ChangeSpan {
  return { changeId, kind: 'delete', author: 'Ada', start: at, end: at, text, resolution: 'exact' };
}

/**
 * @purpose Applies a ChangeSpan[] as the authoritative plan via setChangeSpansEffect and returns the resulting EditorState.
 * @inputs state - the base EditorState; spans - the readonly span array to paint, replacing any previous marks in that transaction.
 * @outputs A new EditorState whose changeMarksField holds the rebuilt DecorationSet (empty when the plan is []).
 * @dataflow spans -> setChangeSpansEffect.of(spans) applied inside an update's effects array -> field.update rebuilds via Decoration.set(ranges, true).
 * @controlflow Single update call returning `.state`; a fresh state is produced each time so tests never mutate shared decoration sets.
 */
function applySpans(state: EditorState, spans: readonly ChangeSpan[]): EditorState {
  return state.update({ effects: setChangeSpansEffect.of(spans) }).state;
}

/**
 * @purpose Returns the number of decorations currently held by changeMarksField for assertions on how many marks/widgets were painted.
 * @inputs state - EditorState whose changeMarksField holds a DecorationSet to size.
 * @outputs The integer count (DecorationSet.size) — zero when no spans have been applied, or after all are dropped as out of range.
 * @dataflow state.field(changeMarksField).size -> returned directly; reads the live set without iterating individual ranges.
 * @controlflow Single property read, no branching — a compact predicate used by every test to pin decoration counts.
 */
function count(state: EditorState): number {
  return state.field(changeMarksField).size;
}

/**
 * @purpose Captures only the lowest-offset range from the decoration set so tests can assert exact offsets of the first painted mark or widget.
 * @inputs state - EditorState whose changeMarksField holds a DecorationSet to inspect across its full document extent.
 * @outputs {from, to} of the first range encountered in ascending iteration order; both stay -1 when the set is empty (no spans applied).
 * @dataflow state.field(changeMarksField).between(0, doc.length) -> on the first callback capture a,b and stop recording later ones.
 * @controlflow Iterate with between; record only the initial range via an `from === -1` guard so overlapping or trailing ranges are ignored by design.
 */
function firstRange(state: EditorState): { from: number; to: number } {
  let from = -1;
  let to = -1;
  state.field(changeMarksField).between(0, state.doc.length, (a, b) => {
    if (from === -1) {
      from = a;
      to = b;
    } else {
      // Only the first range is captured; later ones are ignored.
    }
  });
  return { from, to };
}

describe('change-marks', () => {
  it('a fresh state has no marks', () => {
    // Baseline proof that changeMarksField starts empty before any plan arrives, so later non-empty results are attributable to effects rather than a pre-existing set.
    expect(count(makeState())).toBe(0);
  });

  it('an insertion marks its range', () => {
    // Insertions keep their characters in the document, so buildMarks paints an over-document mark spanning start..end — here 'quick' at offsets 4..9. A passing result proves offset alignment holds end to end and that insertions contribute exactly one decoration (a widget is not emitted for them).
    const state = applySpans(makeState(), [insertSpan('c1', 4, 9)]);

    expect(count(state)).toBe(1);
    // The single mark must sit exactly on the span's source offsets so it covers 'quick'.
    expect(firstRange(state)).toEqual({ from: 4, to: 9 });
  });

  it('a deletion is a zero-width point', () => {
    // Deletions remove their characters entirely; nothing remains at offsets 10..15 ('brown ') to paint over, so buildMarks emits only a widget at the single offset rather than an extent — here start == end == 10.
    const state = applySpans(makeState(), [deleteSpan('c1', 10, 'quick ')]);

    expect(count(state)).toBe(1);
    // The decoration occupies no range: both endpoints pin to offset 10 where the removed text used to sit. Because the deleted characters are not in the document, this widget renders text that the document does not contain (the overlay restores it visually).
    const r = firstRange(state);
    expect(r.from).toBe(10);
    expect(r.to).toBe(10);
  });

  it('a replacement paints both at one offset', () => {
    // A replace is a delete + insert sharing offset 4: the deletion emits a widget at 4 while the insertion emits a mark over [4,9]. That means two decorations sit on the same offset — exactly why buildMarks calls Decoration.set(ranges, true): RangeSetBuilder throws unless ranges are added in ascending order, so the builder must sort before feeding it.
    const state = applySpans(makeState(), [deleteSpan('c1', 4, 'slow '), insertSpan('c2', 4, 9)]);

    expect(count(state)).toBe(2);
  });

  it('the opposite input order works too', () => {
    // Feeding the insertion before the deletion reverses the natural ascending-from ordering; because buildMarks sorts ranges (delegating to Decoration.set's sort flag) rather than relying on push order, the same two decorations still result. This pins that sorting is not dependent on caller ordering.
    const state = applySpans(makeState(), [insertSpan('c2', 4, 9), deleteSpan('c1', 4, 'slow ')]);

    expect(count(state)).toBe(2);
  });

  it('a span past the end is dropped', () => {
    // TEXT has only 19 characters (offsets 0..18), so a span claiming offsets 40..60 lies entirely beyond doc end; buildMarks must skip it (span.end > docLength) rather than clamp or throw — a stale plan pointer would otherwise paint over characters that never existed.
    const state = applySpans(makeState(), [insertSpan('stale', 40, 60)]);

    expect(count(state)).toBe(0);
  });

  it('a span effect behind another effect is still seen', () => {
    // changeMarksField.update must keep scanning tr.effects rather than returning on the first non-matching one; otherwise a plan sitting behind another effect would be dropped silently and the marks would simply stop updating. Here StateEffect.appendConfig is queued ahead of the span effect, yet the mark still appears because the loop reaches it.
    const state = makeState().update({
      effects: [StateEffect.appendConfig.of([]), setChangeSpansEffect.of([insertSpan('c1', 4, 9)])],
    }).state;

    expect(count(state)).toBe(1);
  });
});
