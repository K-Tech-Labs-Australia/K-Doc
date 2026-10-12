// @vitest-environment jsdom
/**
 * @file search-marks.test.ts
 * @purpose Vitest suite proving that the CodeMirror 6 search-mark plumbing in ./search-marks.js behaves at state level: an empty field, every match painted (not only the current one), a distinct active mark, authoritative set replacement (not merge), dropping a zero-width match, and non-early-return scanning of transaction effects.
 * @inputs The searchMarks extension, setSearchMatchesEffect, searchMarksField, CM_SEARCH_ACTIVE_CLASS, EditorState/StateEffect from @codemirror/state, and SearchMatch from @k-doc/core — all inspected purely through editor state so no live view or layout is required.
 * @outputs Pass/fail assertions pinning: initial emptiness, one mark per match at exact offsets with the active flag set only on the current match, complete-set replacement leaving no phantom mark, zero-width-match dropping, and effect-order-independent scanning.
 * @functions
 *   - makeState: Builds an EditorState carrying searchMarks so mark ranges can be inspected at state level without a view.
 *   - match: Factory constructing a SearchMatch literal for use as a setSearchMatchesEffect payload.
 *   - apply: Applies a readonly SearchMatch[] and active index via setSearchMatchesEffect and returns the resulting EditorState.
 *   - marks: Returns every range's from/to offsets plus an active flag currently held by searchMarksField across its full document extent.
 * @dataflow Test builds state with searchMarks() -> apply emits setSearchMatchesEffect.of({ matches, activeIndex }) -> searchMarksField.update rebuilds via buildSearchMarks (Decoration.set(ranges, true)) -> marks reads the resulting DecorationSet through StateField and DecorationSet.between to assert painted ranges and their active class.
 * @controlflow A single describe('search-marks') block runs six independent it() cases; each derives its own state from makeState so tests never share mutable decoration sets, mirroring change-bars.test.ts's state-only approach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { SearchMatch } from '@k-doc/core';
import { searchMarks, searchMarksField, setSearchMatchesEffect, CM_SEARCH_ACTIVE_CLASS } from './search-marks.js';

// 'quick' spans 4..9 and 'brown' spans 10..15 within these 19 characters.
const TEXT = 'The quick brown fox';

// A throwaway effect used only to prove the field keeps scanning past an effect it does not recognise.
const noiseEffect = StateEffect.define<string>();

/**
 * @purpose Builds an EditorState carrying searchMarks so mark ranges can be inspected at state level without a view.
 * @inputs none; uses the shared TEXT document.
 * @outputs A fresh EditorState whose searchMarksField holds Decoration.none (an empty set of match marks).
 * @dataflow TEXT -> EditorState.create with [searchMarks()] extension -> field initialised to an empty DecorationSet.
 * @controlflow Single create call, no branching — every helper derives from this so tests never share mutable decoration sets.
 */
function makeState(): EditorState {
  return EditorState.create({ doc: TEXT, extensions: [searchMarks()] });
}

/**
 * @purpose Constructs a SearchMatch literal for use as a setSearchMatchesEffect payload in the tests.
 * @inputs start - source offset where the match begins; end - source offset where the match ends (the value actually painted by buildSearchMarks).
 * @outputs A readonly SearchMatch with the given start, end and empty groups array, returned to caller for wrapping in setSearchMatchesEffect.of({ matches, activeIndex }).
 * @dataflow Test-provided offsets -> plain object literal returned directly; no branching.
 * @controlflow Pure definition — a thin factory so test bodies stay declarative while keeping match start and end explicit.
 */
function match(start: number, end: number): SearchMatch {
  return { start, end, groups: [] };
}

/**
 * @purpose Applies a readonly SearchMatch[] with an active index as the authoritative set via setSearchMatchesEffect and returns the resulting EditorState.
 * @inputs state - the base EditorState; matches - the readonly match array to paint, replacing any previous marks in that transaction; activeIndex - which of those matches is the current one.
 * @outputs A new EditorState whose searchMarksField holds the rebuilt DecorationSet (empty when matches is []).
 * @dataflow matches + activeIndex -> setSearchMatchesEffect.of({ matches, activeIndex }) applied inside an update's effects array -> field.update rebuilds via buildSearchMarks(state, docLength).
 * @controlflow Single update call returning `.state`; a fresh state is produced each time so tests never mutate shared decoration sets.
 */
function apply(
  state: EditorState,
  matches: readonly SearchMatch[],
  activeIndex: number,
): EditorState {
  return state.update({ effects: setSearchMatchesEffect.of({ matches, activeIndex }) }).state;
}

/**
 * @purpose Returns every match range's from/to offsets plus an active flag currently held by searchMarksField across its full document extent.
 * @inputs state - EditorState whose searchMarksField holds a DecorationSet of match marks to inspect between offset 0 and the document length.
 * @outputs Array<{ from, to, active }> — one entry per painted range; empty when no marks have been applied or all were dropped as out of range or zero-width.
 * @dataflow state.field(searchMarksField).between(0, doc.length) -> on each callback read value.spec.class and classify the range by whether it carries CM_SEARCH_ACTIVE_CLASS.
 * @controlflow Iterate with between collecting from/to/active; active is derived per range by testing the decoration's class string for the active-class constant.
 */
function marks(state: EditorState): Array<{ from: number; to: number; active: boolean }> {
  const found: Array<{ from: number; to: number; active: boolean }> = [];
  state.field(searchMarksField).between(0, state.doc.length, (from, to, value) => {
    // Read the decoration's class spec to classify this range as active or inactive.
    const spec = value.spec as { class?: string };
    const cls = spec.class ?? '';

    // A range is active only when its class string carries the active-class constant; every match carries the base tint, so membership of CM_SEARCH_ACTIVE_CLASS alone distinguishes the current one.
    found.push({ from, to, active: cls.includes(CM_SEARCH_ACTIVE_CLASS) });
  });
  return found;
}

describe('search-marks', () => {
  it('starts with no marks', () => {
    // Baseline proof that searchMarksField starts empty before any match set arrives, so later non-empty results are attributable to effects rather than a pre-existing set.
    expect(marks(makeState())).toEqual([]);
  });

  it('marks every match, not only the current one', () => {
    // The whole point of FR-9.2 is that all matches are painted on screen, not just the current one: a count with nothing to point at makes the reader scroll hunting for what the panel says exists. Applying both matches with activeIndex 0 must therefore yield two marks — the first (4..9) active, the second (10..15) inactive.
    const state = apply(makeState(), [match(4, 9), match(10, 15)], 0);

    expect(marks(state)).toEqual([
      { from: 4, to: 9, active: true },
      { from: 10, to: 15, active: false },
    ]);
  });

  it('distinguishes the active match', () => {
    // next and previous are meaningless if you cannot see which one you are on; with activeIndex 1 exactly one mark must be active and it must be the second. This pins that the active class lands on the right range rather than being applied to all or none.
    const state = apply(makeState(), [match(4, 9), match(10, 15)], 1);
    const found = marks(state);

    // Whole-array equality rather than indexed reads: the indices are possibly undefined under
    // noUncheckedIndexedAccess, and asserting the pair together also pins that nothing else was painted.
    expect(found).toEqual([
      { from: 4, to: 9, active: false },
      { from: 10, to: 15, active: true },
    ]);
  });

  it('replaces the previous set rather than merging', () => {
    // A match set is a complete statement of what exists, so applying a new set that omits an earlier match must not leave a phantom mark behind; replacing [match(4, 9), match(10, 15)] with only [match(10, 15)] therefore yields exactly the single surviving range.
    const first = apply(makeState(), [match(4, 9), match(10, 15)], 0);
    const replaced = apply(first, [match(10, 15)], 0);

    // The surviving match is now index 0, which is the active index, so it carries the active class:
    // replacing the set renumbers it rather than preserving what it was in the old list.
    expect(marks(replaced)).toEqual([{ from: 10, to: 15, active: true }]);
  });

  it('drops a zero-width match', () => {
    // A regex like \b produces a zero-width match and a collapsed decoration throws in Decoration.set rather than draws; applying [match(4, 4)] must therefore be dropped entirely, leaving no marks.
    const state = apply(makeState(), [match(4, 4)], 0);

    expect(marks(state)).toEqual([]);
  });

  it('sees an effect that arrives behind another', () => {
    // searchMarksField.update keeps scanning tr.effects rather than returning on the first non-matching one; otherwise a set queued after noiseEffect would be dropped silently and marks stop updating. Queuing noiseEffect ahead of setSearchMatchesEffect must still paint the match at offset 4..9.
    const state = makeState().update({
      effects: [noiseEffect.of('noise'), setSearchMatchesEffect.of({ matches: [match(4, 9)], activeIndex: 0 })],
    }).state;

    expect(marks(state)).toEqual([{ from: 4, to: 9, active: true }]);
  });
});
