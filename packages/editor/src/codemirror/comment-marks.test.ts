// @vitest-environment jsdom
/**
 * @file comment-marks.test.ts
 * @purpose Vitest suite proving that the CodeMirror 6 comment-mark plumbing in ./comment-marks.js behaves at state level: an empty field, authoritative plan replacement (not merge), class layering for resolved threads, confidence-driven opacity, out-of-range/collapsed-span dropping, ascending-from ordering required by RangeSetBuilder, change mapping across edits, and non-early-return scanning of transaction effects.
 * @inputs The commentMarks extension, setCommentSpansEffect, commentMarksField, the two CSS class constants, EditorState/StateEffect from @codemirror/state, and CommentSpan from @k-doc/core — all inspected purely through editor state so no live view or layout is required.
 * @outputs Pass/fail assertions pinning: initial emptiness, single-mark offset alignment, resolved-class layering, opacity-vs-confidence mapping, plan-replacement semantics, empty-plan clearing, stale/collapsed span dropping, ascending overlap ordering under both input orders, edit remapping to 6..11, and effect-order-independent scanning.
 * @functions
 *   - makeState: Builds an EditorState carrying commentMarks so decoration sets can be inspected at state level without a view.
 *   - span: Factory constructing a CommentSpan literal for use as a setCommentSpansEffect payload.
 *   - applySpans: Applies a readonly CommentSpan[] as the authoritative plan via setCommentSpansEffect and returns the resulting EditorState.
 *   - marksOf: Flattens the live DecorationSet into an array of {from,to,cls,style} descriptors for assertions.
 * @dataflow Test builds state with commentMarks() -> applySpans emits setCommentSpansEffect.of(spans) -> commentMarksField.update rebuilds via buildMarks (or maps on plain edits) -> marksOf reads the resulting DecorationSet through StateField and RangeSetIterator to assert painted ranges.
 * @controlflow A single describe('comment-marks') block runs eleven independent it() cases; each derives its own state from makeState so tests never share mutable decoration sets, mirroring multi-caret.test.ts's state-only approach.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { CommentSpan } from '@k-doc/core';
import {
  commentMarksField,
  setCommentSpansEffect,
  commentMarks,
  CM_COMMENT_CLASS,
  CM_COMMENT_RESOLVED_CLASS,
} from './comment-marks.js';

// Shared document for every test — 'quick' spans offsets 4..9 and 'brown' spans 10..15 within these 43 characters (source offsets match CodeMirror indexing).
const TEXT = 'The quick brown fox jumps over the lazy dog';

/**
 * @purpose Builds an EditorState carrying commentMarks so decoration sets can be inspected at state level without a live view.
 * @inputs doc - the document text to index; every test passes the shared 43-character fox sentence.
 * @outputs A fresh EditorState whose commentMarksField holds Decoration.none (an empty set).
 * @dataflow doc -> EditorState.create with [commentMarks()] extension -> field initialized to an empty DecorationSet.
 * @controlflow Single create call, no branching — every helper derives from this so tests never share mutable state.
 */
function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [commentMarks()] });
}

/**
 * @purpose Constructs a CommentSpan literal for use as an authoritative-plan effect payload in the tests.
 * @inputs threadId - owning thread identifier; start/end - source offsets (start inclusive, end exclusive); state - 'open' or 'resolved'; confidence - 0..1 opacity driver below 1.
 * @outputs A readonly CommentSpan object matching the shape consumed by setCommentSpansEffect and buildMarks.
 * @dataflow Test-provided fields -> plain object literal returned to caller for wrapping in setCommentSpansEffect.of(spans).
 * @controlflow Pure definition, no branching — a thin factory so test bodies stay declarative.
 */
function span(threadId: string, start: number, end: number, state: 'open' | 'resolved', confidence: number): CommentSpan {
  return { threadId, start, end, state, confidence };
}

/**
 * @purpose Applies a CommentSpan[] as the authoritative plan via setCommentSpansEffect and returns the resulting EditorState.
 * @inputs state - the base EditorState; spans - the readonly span array to paint, replacing any previous marks in that transaction.
 * @outputs A new EditorState whose commentMarksField holds the rebuilt DecorationSet (empty when the plan is []).
 * @dataflow spans -> setCommentSpansEffect.of(spans) applied inside an update's effects array -> field.update rebuilds via buildMarks for a document of tr.state.doc.length.
 * @controlflow Single update call returning `.state`; a fresh state is produced each time so tests never mutate shared decoration sets.
 */
function applySpans(state: EditorState, spans: readonly CommentSpan[]): EditorState {
  return state.update({ effects: setCommentSpansEffect.of(spans) }).state;
}

/**
 * @purpose Reads the live DecorationSet from editor state and flattens it into an array of observable mark descriptors.
 * @inputs state - EditorState whose commentMarksField holds a DecorationSet to inspect across its full document extent.
 * @outputs Array of {from, to, cls, style} objects describing each painted range in ascending order (document iteration order).
 * @dataflow state.field(commentMarksField) -> RangeSetIterator via set.between(0, doc.length) -> for each (from,to,value), read value.spec.class as a string and spec.attributes?.style ?? null.
 * @controlflow Iterate with set.between; narrow the untyped Decoration.value's spec through `unknown` before reading fields so no `any` leaks into assertions or return values.
 */
function marksOf(state: EditorState): Array<{ from: number; to: number; cls: string; style: string | null }> {
  const set = state.field(commentMarksField);
  const result: Array<{ from: number; to: number; cls: string; style: string | null }> = [];

  // Iterate across the full document extent so every painted range is captured regardless of where it sits.
  set.between(0, state.doc.length, (from, to, value) => {
    // `value` is an untyped Decoration from RangeSetIterator; narrow its spec through `unknown` rather than using `any`, then read only the fields this suite asserts on.
    const spec = value.spec as unknown as { class?: string; attributes?: Record<string, string> };

    result.push({
      from,
      to,
      cls: String(spec.class ?? ''),
      style: spec.attributes?.style ?? null,
    });
  });

  return result;
}

describe('comment-marks', () => {
  it('a fresh state has no marks', () => {
    // Baseline proof that commentMarksField starts empty before any plan arrives, so later non-empty results are attributable to effects rather than a pre-existing set.
    expect(marksOf(makeState(TEXT))).toHaveLength(0);
  });

  it('an effect paints one mark at the span offsets', () => {
    // Source offsets are what CodeMirror indexes by, which is why this Source pane can paint the plan directly — a passing result proves offset alignment holds end to end.
    const state = applySpans(makeState(TEXT), [span('t1', 4, 9, 'open', 1)]);

    const marks = marksOf(state);

    expect(marks).toHaveLength(1);
    // The lone mark must sit exactly on the span's source offsets so it covers the word 'quick'.
    const first = marks.at(0);
    expect(first?.from).toBe(4);
    expect(first?.to).toBe(9);
    // cls is a space-joined class string, so containment proves the base comment mark was applied to this range.
    expect((first?.cls ?? '')).toContain(CM_COMMENT_CLASS);
  });

  it('a resolved span carries both the resolved and base classes', () => {
    // Resolved threads must stay visible, so their mark layers CM_COMMENT_RESOLVED_CLASS on top of the base rather than replacing it — a missing layer would hide that the thread is finished.
    const state = applySpans(makeState(TEXT), [span('t1', 4, 9, 'resolved', 1)]);

    const marks = marksOf(state);

    expect(marks).toHaveLength(1);
    // Both classes must be present on the single surviving mark so a reader can tell it is an open comment that has since been resolved.
    const first = marks.at(0);
    expect((first?.cls ?? '')).toContain(CM_COMMENT_CLASS);
    expect((first?.cls ?? '')).toContain(CM_COMMENT_RESOLVED_CLASS);
  });

  it('full confidence adds no opacity while reduced confidence drives it', () => {
    // Confidence is an inference signal, not a presence flag: a fully confident anchor stays opaque, but a rescued (0.8) anchor dims to opacity so the reader knows its position was inferred — yet remains visible as a real comment that must not be lost to the resolver.
    const state = applySpans(makeState(TEXT), [
      span('t1', 4, 9, 'open', 1), // confident anchor on 'quick' (offsets 4..9).
      span('t2', 10, 15, 'open', 0.8), // rescued anchor on 'brown' (offsets 10..15).
    ]);

    const marks = marksOf(state);

    expect(marks).toHaveLength(2);
    // The confident anchor must carry no inline style at all — opacity is driven purely by confidence below 1.
    const opaque = marks.at(0)?.style ?? '';
    expect(opaque).toBe('');
    // The rescued anchor must dim via an inline opacity rule so its inferred position reads as tentative without vanishing.
    const dimmed = marks.at(1)?.style ?? '';
    expect(dimmed.toLowerCase()).toContain('opacity');
  });

  it('a later plan replaces the earlier one instead of merging', () => {
    // The effect carries a complete statement of what exists, so applying a second plan must discard marks from the first — any leftover mark would be a phantom comment lingering past its thread's lifetime.
    const step1 = applySpans(makeState(TEXT), [span('t1', 4, 9, 'open', 1)]);
    const step2 = applySpans(step1, [span('t2', 10, 15, 'open', 1)]);

    const marks = marksOf(step2);

    expect(marks).toHaveLength(1);
    // The surviving mark must be the second plan's range (offsets 10..15), proving the first was dropped rather than merged.
    const only = marks.at(0);
    expect((only?.from ?? -1)).toBe(10);
    expect((only?.to ?? -1)).toBe(15);
  });

  it('an empty plan clears every existing mark', () => {
    // A zero-length plan is still an authoritative statement — it says nothing exists, so all prior marks must vanish rather than persist as orphans.
    const step1 = applySpans(makeState(TEXT), [span('t1', 4, 9, 'open', 1)]);
    const cleared = applySpans(step1, []);

    const marks = marksOf(cleared);

    expect(marks).toHaveLength(0);
  });

  it('drops a span that runs past the document end without throwing', () => {
    // planDecorations can return anchors from an earlier snapshot; one pointing at offsets 40..500 exceeds this 43-character doc, so buildMarks must skip it (span.end > docLength) rather than clamp or throw — a stale anchor would otherwise paint over characters that never belonged to it.
    const state = applySpans(makeState(TEXT), [
      span('t1', 4, 9, 'open', 1), // in-range survivor on 'quick'.
      span('stale', 40, 500, 'open', 1), // out-of-bounds anchor past doc end.
    ]);

    // The call itself must not throw; assert the surviving set has exactly one mark.
    const marks = marksOf(state);
    expect(marks).toHaveLength(1);
    // The only survivor is the in-range anchor at offsets 4..9, so the out-of-bounds span was dropped rather than clamped.
    const only = marks.at(0);
    expect((only?.from ?? -1)).toBe(4);
    expect((only?.to ?? -1)).toBe(9);
  });

  it('drops a collapsed (zero-width) span', () => {
    // A span whose start equals its end has no valid extent; buildMarks guards against it (span.start >= span.end) so a corrupt or empty anchor can never produce a zero-width mark that would confuse click handling.
    const state = applySpans(makeState(TEXT), [span('t1', 7, 7, 'open', 1)]);

    const marks = marksOf(state);

    expect(marks).toHaveLength(0);
  });

  it('paints overlapping spans in ascending from-order regardless of input order', () => {
    // RangeSetBuilder throws unless ranges are added in ascending `from` order, but planDecorations sorts by end descending for overlaps — so buildMarks re-sorts to ascending start/end before feeding the builder. This pins that both an outer-then-inner and an inner-then-outer input yield two marks ordered [2, 5] rather than throwing or losing one.
    const outerFirst = applySpans(makeState(TEXT), [
      span('outer', 2, 20, 'open', 1), // spans across both words (offsets 2..20).
      span('inner', 5, 8, 'open', 1), // nested inside the outer (offsets 5..8).
    ]);
    const innerFirst = applySpans(makeState(TEXT), [
      span('inner', 5, 8, 'open', 1),
      span('outer', 2, 20, 'open', 1),
    ]);

    for (const state of [outerFirst, innerFirst]) {
      // Both input orders must produce exactly two distinct overlapping marks.
      const marks = marksOf(state);
      expect(marks).toHaveLength(2);
      // Ascending `from` proves the builder was fed ranges in RangeSetBuilder's required order for both cases.
      expect(marks.map((m) => m.from)).toEqual([2, 5]);
    }
  });

  it('maps a surviving mark across an unrelated edit rather than clearing it', () => {
    // No span effect is attached to this plain insert, so commentMarksField.update takes the map branch and shifts the existing range by the inserted length — keeping a commented range steady while the user types until the debounced re-plan arrives. Inserting 'XX' at offset 0 pushes offsets 4..9 forward by two characters to 6..11.
    const step1 = applySpans(makeState(TEXT), [span('t1', 4, 9, 'open', 1)]);
    const edited = step1.update({ changes: { from: 0, to: 0, insert: 'XX' } }).state;

    const marks = marksOf(edited);

    expect(marks).toHaveLength(1);
    // The mark must have been mapped two characters forward (the inserted length), not dropped by the edit.
    const only = marks.at(0);
    expect((only?.from ?? -1)).toBe(6);
    expect((only?.to ?? -1)).toBe(11);
  });

  it('still paints a plan even when a non-span effect precedes it in the same transaction', () => {
    // commentMarksField.update must keep scanning tr.effects rather than returning on the first non-matching one; otherwise a plan sitting behind another effect would be dropped silently and marks would stop updating. Here StateEffect.appendConfig is queued before the span effect, yet the mark still appears because the loop reaches it.
    const state = EditorState.create({ doc: TEXT, extensions: [commentMarks()] });
    const applied = state.update({
      effects: [
        StateEffect.appendConfig.of([]), // a non-span effect placed ahead of the plan on purpose.
        setCommentSpansEffect.of([span('t1', 4, 9, 'open', 1)]),
      ],
    }).state;

    const marks = marksOf(applied);

    expect(marks).toHaveLength(1);
    const first = marks.at(0);
    // The mark must still be painted despite the preceding appendConfig effect, proving scanning did not stop early.
    expect((first?.cls ?? '')).toContain(CM_COMMENT_CLASS);
  });
});

// NOTE: commentSpanTheme() (the CSS tinting rules) is intentionally NOT covered by this suite — applying EditorView.theme requires a rendered DOM and layout to observe computed styles, which jsdom provides only partially. It was verified by hand in a browser; the state-level decoration plumbing exercised here is what keeps Source-pane marks identical to the K-Doc plugin's painted ranges.
