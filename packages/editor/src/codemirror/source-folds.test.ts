// @vitest-environment jsdom
/**
 * @file source-folds.test.ts
 * @purpose Vitest suite proving the CodeMirror 6 Source-pane fold sync in ./source-folds.js satisfies FR-8.29: reporting which foldable targets are collapsed, applying store folds exactly once, unfolding targets the store drops, leaving non-target folds untouched, observing user-made folds, and ignoring document edits.
 * @inputs EditorState/EditorView from @codemirror/state/@codemirror/view, codeFolding/foldedRanges/foldEffect from @codemirror/language, markdown from @codemirror/lang-markdown, and sourceFoldStates/applySourceFolds/sourceFoldListener/SourceFoldTarget from ./source-folds.js — all exercised against a fixed SAMPLE document.
 * @outputs Pass/fail assertions pinning: initial unfolded state of foldable targets, single dispatch + [15] fold for heading:b, empty folds after unfolding, untouched [3] non-target fold, user-fold reporting item:one as folded, and zero listener callbacks on doc edits.
 * @functions
 *   - viewWith: Builds a mounted EditorView over SAMPLE with markdown, codeFolding, and a sourceFoldListener that records observed states into a caller array.
 *   - foldStarts: Returns the ascending list of live fold start offsets for assertions about collapsed ranges.
 * @dataflow SAMPLE -> EditorState.create([markdown(), codeFolding(), sourceFoldListener(...)]) -> EditorView -> applySourceFolds/user dispatches foldedRanges -> viewWith/foldStarts read results -> assertions.
 * @controlflow A single describe('source-folds') block runs six independent it() cases; each builds its own view with a fresh calls array so live fold state never leaks between tests, and every case destroys its view at the end to release the jsdom parent.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { codeFolding, foldedRanges, foldEffect } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { applySourceFolds, sourceFoldListener, sourceFoldStates } from './source-folds.js';
import type { SourceFoldTarget } from './source-folds.js';

// Nested Markdown document used as the shared editor content; offsets below index into this exact string.
const SAMPLE = '# A\n\ntext\n\n## B\n\n- one\n  - two\n- three\n\n# C\n';

// Document offsets into SAMPLE (CodeMirror 0-based, each newline counts as one character):
//   heading:a -> '# A' at 0; heading:b -> '## B' at 11 (line ends at 15);
//   item:one -> '- one' at 17 (its body extends to 30); item:two -> '- two' at 25 (nested under one);
//   item:three -> '- three' at 31. Each `start` is the fold origin for its target.
const TARGETS: readonly SourceFoldTarget[] = [
  { key: 'heading:a', start: 0 },
  { key: 'heading:b', start: 11 },
  { key: 'item:one', start: 17 },
  { key: 'item:two', start: 25 },
  { key: 'item:three', start: 31 },
];

/**
 * @purpose Constructs a live CodeMirror EditorView over the shared SAMPLE document, wiring markdown parsing, code folding, and a source-fold listener that appends every observed state to a caller-supplied array.
 * @inputs calls - mutable array into which the listener pushes each EditorState it observes, letting tests count how many fold-only updates occurred.
 * @outputs A mounted EditorView whose parent is document.body so CodeMirror layout runs under the jsdom test environment.
 * @dataflow SAMPLE -> EditorState.create with [markdown(), codeFolding(), sourceFoldListener(...)] -> EditorView constructor -> listener closure captures `calls` and records subsequent states.
 * @controlflow Single construction, no branching — every test derives its view from this so fold state never leaks between cases.
 */
function viewWith(calls: EditorState[]): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [markdown(), codeFolding(), sourceFoldListener((state) => {
        calls.push(state);
      })],
    }),
    parent: document.body,
  });
}

/**
 * @purpose Collects the start offset of every live CodeMirror fold in ascending order for assertions about which ranges are currently collapsed.
 * @inputs view - EditorView whose foldedRanges must be inspected across its full document extent.
 * @outputs The number[] of fold `from` offsets — empty when no folds are live, one entry per active fold.
 * @dataflow foldedRanges(view.state).between(0, doc.length) -> callback pushes each `from` into starts in ascending iteration order.
 * @controlflow Single between() scan with an unconditional push (no branch) so every range in the document is counted exactly once.
 */
function foldStarts(view: EditorView): number[] {
  const starts: number[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
    starts.push(from);
  });
  return starts;
}

describe('source-folds', () => {
  it('reports the foldable targets as unfolded', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // Baseline with no folds applied: every foldable target reads as not folded.
    const states = sourceFoldStates(view.state, TARGETS);
    expect(states.get('heading:a')).toBe(false);
    expect(states.get('heading:b')).toBe(false);
    expect(states.get('item:one')).toBe(false);
    // item:two and item:three are not foldable in Source at these offsets, so they are absent rather than false.
    expect(states.has('item:two')).toBe(false);
    expect(states.has('item:three')).toBe(false);
    view.destroy();
  });

  it('folds the targets the store has folded, once', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // Folding only heading:b dispatches exactly one fold effect and yields a single live fold; foldedRanges reports its start at offset 15 (the end of the '## B' line).
    expect(applySourceFolds(view, TARGETS, (key) => key === 'heading:b')).toBe(true);
    expect(foldStarts(view)).toEqual([15]);
    // sourceFoldListener must not fire for transactions this module dispatched, so the store's own write stays invisible to it.
    expect(calls.length).toBe(0);
    // Folding an already-folded target dispatches nothing and reports that no change was needed.
    expect(applySourceFolds(view, TARGETS, (key) => key === 'heading:b')).toBe(false);
    view.destroy();
  });

  it('unfolds targets the store no longer has', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // First fold heading:b so a live fold exists to be removed.
    applySourceFolds(view, TARGETS, (key) => key === 'heading:b');
    // With no target folded in the store, the previously-folded heading:b must unfold, clearing every fold.
    expect(applySourceFolds(view, TARGETS, () => false)).toBe(true);
    expect(foldStarts(view)).toEqual([]);
    view.destroy();
  });

  it('leaves folds that are not targets alone', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // A fold starting at offset 7 (inside the paragraph under # A) lies outside every target's start, so applySourceFolds must leave it untouched.
    view.dispatch({ effects: foldEffect.of({ from: 7, to: 9 }) });
    calls.length = 0;
    // No target is folded in the store and none should be, so there is nothing to change among targets; the non-target fold survives.
    expect(applySourceFolds(view, TARGETS, () => false)).toBe(false);
    expect(foldStarts(view)).toEqual([7]);
    view.destroy();
  });

  it('reports a fold the user makes', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // The user folds [22,30] (the nested '- two' line) directly instead of through applySourceFolds.
    view.dispatch({ effects: foldEffect.of({ from: 22, to: 30 }) });
    // sourceFoldListener observes the user's transaction and re-derives that item:one is now folded.
    expect(calls.length).toBe(1);
    expect(sourceFoldStates(view.state, TARGETS).get('item:one')).toBe(true);
    view.destroy();
  });

  it('ignores a target whose start lies outside the document', () => {
    const view = viewWith([]);
    expect(sourceFoldStates(view.state, [{ key: 'far', start: 999 }]).has('far')).toBe(false);
    view.destroy();
  });
  it('does not report a nested target as folded when only its parent is', () => {
    const view = viewWith([]);
    applySourceFolds(view, TARGETS, (key) => key === 'heading:a');
    expect(sourceFoldStates(view.state, TARGETS).get('heading:b')).toBe(false);
    view.destroy();
  });
  it('ignores edits while something is folded', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    view.dispatch({ effects: foldEffect.of({ from: 22, to: 30 }) });
    calls.length = 0;
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(calls.length).toBe(0);
    view.destroy();
  });
  it('ignores selection changes', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    view.dispatch({ selection: { anchor: 5 } });
    expect(calls.length).toBe(0);
    view.destroy();
  });
  it('ignores edits', () => {
    const calls: EditorState[] = [];
    const view = viewWith(calls);
    // A plain text insertion changes the document, which sourceFoldListener must ignore because it only tracks fold-only updates.
    view.dispatch({ changes: { from: SAMPLE.length, insert: 'x' } });
    expect(calls.length).toBe(0);
    view.destroy();
  });
});
