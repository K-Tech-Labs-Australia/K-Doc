// @vitest-environment jsdom
/**
 * @file change-bars.test.ts
 * @purpose Vitest suite proving that the CodeMirror 6 change-bar plumbing in ./change-bars.js behaves at state level: an empty field, authoritative plan replacement (not merge), one bar per changed line aligned to its offset, out-of-order sorting via RangeSet.of(ranges, true), dropping a stale bar past document end, and non-early-return scanning of transaction effects.
 * @inputs The changeBars extension, setChangeBarsEffect, changeBarsField, EditorState/StateEffect from @codemirror/state, and ChangeBar from @k-doc/core — all inspected purely through editor state so no live view or layout is required.
 * @outputs Pass/fail assertions pinning: initial emptiness, one bar per changed line at exact offsets, complete-plan replacement leaving no phantom marker, delegated ascending sort regardless of input order, stale-bar dropping past doc end, and effect-order-independent scanning.
 * @functions
 *   - makeState: Builds an EditorState carrying changeBars so bar ranges can be inspected at state level without a view.
 *   - bar: Factory constructing a ChangeBar literal for use as a setChangeBarsEffect payload.
 *   - applyBars: Applies a readonly ChangeBar[] as the authoritative plan via setChangeBarsEffect and returns the resulting EditorState.
 *   - offsets: Returns every range's from offset currently held by changeBarsField in ascending iteration order.
 * @dataflow Test builds state with changeBars() -> applyBars emits setChangeBarsEffect.of(bars) -> changeBarsField.update rebuilds via buildBars (RangeSet.of(ranges, true)) -> offsets reads the resulting RangeSet through StateField and RangeSet.between to assert painted bar offsets.
 * @controlflow A single describe('change-bars') block runs six independent it() cases; each derives its own state from makeState so tests never share mutable range sets, mirroring change-marks.test.ts's state-only approach.
 * @version 1
 * @date 2026-09-10
 */

import { describe, expect, it } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { ChangeBar } from '@k-doc/core';
import { changeBars, changeBarsField, setChangeBarsEffect } from './change-bars.js';

// Three content lines; the line starts are 0, 12 and 25 within these 35 characters. 'first line' occupies offsets 0..9 (10 chars), then two newlines at 10 and 11 push 'second line' to offset 12 (occupying 12..22, 11 chars), then two newlines at 23 and 24 push 'third line' to offset 25 (occupying 25..34).
const TEXT = 'first line\n\nsecond line\n\nthird line';

// A throwaway effect used only to prove the field keeps scanning past an effect it does not recognise.
const noiseEffect = StateEffect.define<string>();

/**
 * @purpose Builds an EditorState carrying changeBars so bar ranges can be inspected at state level without a view.
 * @inputs none; uses the shared TEXT document.
 * @outputs A fresh EditorState whose changeBarsField holds RangeSet.empty (an empty set of gutter markers).
 * @dataflow TEXT -> EditorState.create with [changeBars()] extension -> field initialized to an empty RangeSet.
 * @controlflow Single create call, no branching — every helper derives from this so tests never share mutable state.
 */
function makeState(): EditorState {
  return EditorState.create({ doc: TEXT, extensions: [changeBars()] });
}

/**
 * @purpose Constructs a ChangeBar literal for use as a setChangeBarsEffect payload in the tests.
 * @inputs lineIndex - zero-based content-line number from the plan; lineStart - source offset where that line begins (the value actually painted by buildBars).
 * @outputs A readonly ChangeBar with the given lineIndex and lineStart, returned to caller for wrapping in setChangeBarsEffect.of(bars).
 * @dataflow Test-provided indices/offsets -> plain object literal returned directly; no branching.
 * @controlflow Pure definition — a thin factory so test bodies stay declarative while keeping line index and offset explicit.
 */
function bar(lineIndex: number, lineStart: number): ChangeBar {
  return { lineIndex, lineStart };
}

/**
 * @purpose Applies a ChangeBar[] as the authoritative plan via setChangeBarsEffect and returns the resulting EditorState.
 * @inputs state - the base EditorState; bars - the readonly bar array to paint, replacing any previous markers in that transaction.
 * @outputs A new EditorState whose changeBarsField holds the rebuilt RangeSet (empty when the plan is []).
 * @dataflow bars -> setChangeBarsEffect.of(bars) applied inside an update's effects array -> field.update rebuilds via buildBars(bars, docLength).
 * @controlflow Single update call returning `.state`; a fresh state is produced each time so tests never mutate shared range sets.
 */
function applyBars(state: EditorState, bars: readonly ChangeBar[]): EditorState {
  return state.update({ effects: setChangeBarsEffect.of(bars) }).state;
}

/**
 * @purpose Returns every bar's from offset currently held by changeBarsField in ascending iteration order for exact-offset assertions.
 * @inputs state - EditorState whose changeBarsField holds a RangeSet of gutter markers to inspect across its full document extent.
 * @outputs number[] — the sorted list of range start offsets; empty when no bars have been applied or all were dropped as out of range.
 * @dataflow state.field(changeBarsField).between(0, doc.length) -> on each callback push from into found (RangeSet iterates ascending by construction).
 * @controlflow Iterate with between and collect every `from`; the returned array is already ordered because RangeSet.of(ranges, true) sorts before storage.
 */
function offsets(state: EditorState): number[] {
  const found: number[] = [];
  state.field(changeBarsField).between(0, state.doc.length, (from) => {
    // Collect each range start; between() visits ranges in ascending offset order so `found` stays sorted.
    found.push(from);
  });
  return found;
}

describe('change-bars', () => {
  it('starts with no bars', () => {
    // Baseline proof that changeBarsField starts empty before any plan arrives, so later non-empty results are attributable to effects rather than a pre-existing set.
    expect(offsets(makeState())).toEqual([]);
  });

  it('marks one bar per changed line', () => {
    // Each content-line bar paints exactly one marker at its own offset; applying bars on the first (lineIndex 0, offset 0) and third (lineIndex 2, offset 25) lines must yield those two offsets ascending — proving alignment holds end to end and that each plan line contributes precisely one bar.
    const state = applyBars(makeState(), [bar(0, 0), bar(2, 25)]);

    expect(offsets(state)).toEqual([0, 25]);
  });

  it('replaces the previous plan rather than merging with it', () => {
    // A plan is a complete statement of which lines changed, so applying a new plan that omits an earlier line must not leave a phantom bar behind; replacing [bar(0, 0)] with [bar(2, 25)] therefore yields exactly the single surviving offset.
    const first = applyBars(makeState(), [bar(0, 0)]);
    const replaced = applyBars(first, [bar(2, 25)]);

    expect(offsets(replaced)).toEqual([25]);
  });

  it('sorts bars the plan hands over out of order', () => {
    // RangeSet.of(ranges, true) sorts by offset rather than trusting caller push order and would throw on unsorted input without that flag; feeding bar(2, 25) before bar(0, 0) must still come back ascending as [0, 25].
    const state = applyBars(makeState(), [bar(2, 25), bar(0, 0)]);

    expect(offsets(state)).toEqual([0, 25]);
  });

  it('drops a bar that has run past the end of the document', () => {
    // The plan is computed from an earlier snapshot and can outrun the current document as edits land; TEXT.length is 35 so a bar with lineStart = TEXT.length + 50 (85) exceeds doc length and must be dropped rather than clamped, leaving only the valid offset 0.
    const state = applyBars(makeState(), [bar(0, 0), bar(9, TEXT.length + 50)]);

    expect(offsets(state)).toEqual([0]);
  });

  it('sees a bar effect that arrives behind another effect', () => {
    // changeBarsField.update keeps scanning tr.effects rather than returning on the first non-matching one; otherwise a plan queued after noiseEffect would be dropped silently and bars stop updating. Queuing noiseEffect ahead of setChangeBarsEffect must still paint the bar at offset 0.
    const state = makeState().update({
      effects: [noiseEffect.of('noise'), setChangeBarsEffect.of([bar(0, 0)])],
    }).state;

    expect(offsets(state)).toEqual([0]);
  });
});
