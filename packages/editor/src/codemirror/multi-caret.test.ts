// @vitest-environment jsdom
/**
 * @file multi-caret.test.ts
 * @purpose Vitest suite proving that createMultiCaretExtensions() enables state-level multi-range selections in CodeMirror, without needing an EditorView.
 * @inputs The createMultiCaretExtensions factory plus CodeMirror's EditorState and EditorSelection primitives from @codemirror/state.
 * @outputs Pass/fail assertions pinning: the extension count, multi-range retention with vs. without the facet, bulk replaceSelection across ranges, and main-range validity.
 * @functions
 *   - keepsMultipleRangesWhenExtensionsPresent: Asserts a state built with the extensions retains two selection ranges.
 *   - collapsesToSingleRangeWithoutExtensions: Control asserting the same update yields one range when the extensions are absent.
 *   - typingReplacesEveryRangeAtOnce: Asserts replaceSelection writes 'BETA' into every range simultaneously.
 *   - mainRangeRemainsValidIndex: Asserts selection.mainIndex indexes a real range rather than going out of bounds.
 * @dataflow EditorState.create(doc, extensions) → update with a multi-range selection → assertion on selection.ranges.length and doc text.
 * @controlflow A describe block runs four independent it() cases; each builds its own state from scratch so tests never share mutable state.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { createMultiCaretExtensions } from './multi-caret.js';

describe('createMultiCaretExtensions', () => {
  it('returns exactly four extensions', () => {
    // Pins that the composition is a fixed four-element set; adding or dropping one would silently break FR-7.2 without failing here.
    expect(createMultiCaretExtensions()).toHaveLength(4);
  });

  it('keeps two selection ranges when built with the extensions', () => {
    // This is the assertion that matters: without allowMultipleSelections CodeMirror silently collapses a multi-range selection to one,
    // so a passing two-range result is proof the facet is actually on in the state.
    const doc = 'alpha one\nalpha two\nalpha three';
    const base = EditorState.create({ doc, extensions: [...createMultiCaretExtensions()] });
    // `.state` rather than the transaction itself: update() returns a Transaction, and the question here
    // is what the resulting *state* holds after CodeMirror has applied its own selection rules.
    const updated = base.update({ selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(10, 15)]) }).state;
    expect(updated.selection.ranges.length).toBe(2);
  });

  it('collapses to a single range when built without the extensions', () => {
    // Control for the previous test: same document and update but with extensions: [], so this proves the earlier two-range result was caused by the facet rather than merely describing CodeMirror's default collapsing behaviour.
    const doc = 'alpha one\nalpha two\nalpha three';
    const base = EditorState.create({ doc, extensions: [] });
    // `.state` rather than the transaction itself: update() returns a Transaction, and the question here
    // is what the resulting *state* holds after CodeMirror has applied its own selection rules.
    const updated = base.update({ selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(10, 15)]) }).state;
    expect(updated.selection.ranges.length).toBe(1);
  });

  it('replaces text in every range at once when typing', () => {
    // The behaviour a user actually wants from multiple carets: replaceSelection writes into all ranges, so the carets are not merely decorative.
    const doc = 'alpha one\nalpha two\nalpha three';
    const base = EditorState.create({ doc, extensions: [...createMultiCaretExtensions()] });
    const withRanges = base.update({
      selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(10, 15)]),
    }).state;
    // replaceSelection returns a transaction *spec*, so it has to be applied to get a state back.
    const replaced = withRanges.update(withRanges.replaceSelection('BETA')).state;
    expect(replaced.doc.toString()).toBe('BETA one\nBETA two\nalpha three');
  });

  it('keeps selection.mainIndex a valid index into ranges', () => {
    // Pins that the primary caret stays in-bounds after the multi-range update, so downstream code can trust ranges[mainIndex] exists.
    const doc = 'alpha one\nalpha two\nalpha three';
    const base = EditorState.create({ doc, extensions: [...createMultiCaretExtensions()] });
    // `.state` rather than the transaction itself: update() returns a Transaction, and the question here
    // is what the resulting *state* holds after CodeMirror has applied its own selection rules.
    const updated = base.update({ selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(10, 15)]) }).state;
    const ranges = updated.selection.ranges;
    expect(updated.selection.mainIndex).toBeGreaterThanOrEqual(0);
    expect(updated.selection.mainIndex).toBeLessThan(ranges.length);
  });
});

// NOTE: rectangularSelection(), crosshairCursor(), and the Mod-d keybinding are intentionally NOT covered by this suite.
// Each requires a real EditorView with pixel layout, pointer events, and keyboard dispatch — jsdom provides none of these, so any test pretending to exercise them would assert against stubs rather than reality. They were verified by hand in a browser instead.
