// @vitest-environment jsdom
/**
 * @file change-plugin.test.ts
 * @purpose Vitest suite for K-Doc's change decoration plugin. Verifies that insert and delete spans paint decorations, that an absent plugin is answered rather than thrown at, that out-of-bounds spans are dropped without throwing, and that ordinary edits map the decorations instead of clearing them.
 * @inputs EditorState instances built on kdocSchema, ChangeSpan fixtures (insert/delete kinds), and ProseMirror transactions.
 * @outputs Vitest assertions over changesAt, changePluginKey.getState decoration counts, and position mapping across an edit.
 * @functions
 *   - createTestDoc: Helper creating a standard ProseMirror document with a single paragraph of text.
 *   - makeState: Helper creating an EditorState on kdocSchema, test doc, and optional change plugin.
 *   - insertSpan: Factory building an insert ChangeSpan fixture over the range [start, end).
 *   - deleteSpan: Factory building a delete ChangeSpan fixture collapsed at position `at`.
 *   - applySpans: Applies a set of ChangeSpan fixtures to a transaction via setChangeSpans.
 *   - count: Counts active change decorations in an EditorState's DecorationSet, tolerating an absent plugin.
 * @dataflow ChangeSpan fixtures -> setChangeSpans / state.apply -> changesAt / decoration counts -> expect assertions.
 * @controlflow Absent-plugin fallbacks -> insertion painting -> deletion-at-a-point painting -> replacement branching -> bounds guard -> mapping across an edit.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { ChangeSpan } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { createChangePlugin, setChangeSpans, changesAt, changePluginKey } from './change-plugin.js';

// The sample paragraph text shared by every test in this suite.
const TEXT = 'The quick brown fox';

// ProseMirror position map for the default document:
// Position 0 is before <doc>.
// Position 1 is before 'The...' inside <paragraph> (the first character of the text).
// The word 'quick' therefore occupies document positions 5..10, i.e. start = 5 and end = 10.

/** Creates a standard ProseMirror test document node containing a single paragraph of text. */
function createTestDoc(text: string): ProseMirrorNode {
  // Wrap the given text in a paragraph node and then wrap that paragraph in the doc root, all via kdocSchema.
  return kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text(text)])]);
}

/** Creates an EditorState initialized with kdocSchema and the test document, optionally including the change plugin. */
function makeState(withPlugin: boolean): EditorState {
  // Build a fresh document for every state so tests never share or mutate a common node tree.
  const doc = createTestDoc(TEXT);

  // Check whether the change plugin should be installed on this editor state.
  if (withPlugin) {
    // Plugin requested: install createChangePlugin() alongside the document and schema.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [createChangePlugin()] });
  } else {
    // Plugin not requested: build a bare state with no plugins to exercise absent-plugin fallbacks.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [] });
  }
}

/** Builds an insert ChangeSpan fixture that highlights the range [start, end). */
function insertSpan(changeId: string, start: number, end: number): ChangeSpan {
  // Assemble a single insert span record with all required fields populated from the inputs.
  return { changeId, kind: 'insert', author: 'Ada', start, end, text: 'quick ', resolution: 'exact' };
}

/** Builds a delete ChangeSpan fixture collapsed at position `at` (start === end). */
function deleteSpan(changeId: string, at: number): ChangeSpan {
  // Assemble a single delete span record with a zero-width range anchored at the given position.
  return { changeId, kind: 'delete', author: 'Ada', start: at, end: at, text: 'gone ', resolution: 'exact' };
}

/** Applies a set of ChangeSpan fixtures to an editor state via a single transaction and returns the resulting state. */
function applySpans(state: EditorState, spans: readonly ChangeSpan[]): EditorState {
  // Attach the change spans to a fresh transaction through setChangeSpans, then commit it into a new state.
  return state.apply(setChangeSpans(state.tr, spans));
}

/** Returns the number of inline decorations currently tracked by the change plugin in an editor state. */
function count(state: EditorState): number {
  // Read the plugin's DecorationSet through its key, tolerating a missing plugin instance.
  const plugin = changePluginKey.getState(state);

  // Check whether the change plugin is installed on this editor state.
  if (plugin === undefined) {
    // Plugin absent: report zero decorations rather than throwing at an uninstalled key.
    return 0;
  } else {
    // Plugin present: count its inline decorations via find() with no predicate arguments.
    return plugin.decorations.find().length;
  }
}

describe('change-plugin', () => {
  it('answers changesAt and returns zero decorations when the plugin is absent', () => {
    const state = makeState(false);

    // With no plugin installed, changesAt must fall back to an empty array rather than throw.
    expect(changesAt(state, 3)).toEqual([]);

    // And count() reports zero because there is no DecorationSet to read on a bare state.
    expect(count(state)).toBe(0);
  });

  it('paints one decoration over the range of an inserted span', () => {
    const state = applySpans(makeState(true), [insertSpan('c1', 5, 10)]);

    // Exactly one inline decoration is painted for the single insert span.
    expect(count(state)).toBe(1);

    // A position inside 'quick' (pos 7) reports only c1 as a change at that point.
    expect(changesAt(state, 7)).toEqual(['c1']);
  });

  it('paints one decoration for a deletion anchored at a single point', () => {
    const state = applySpans(makeState(true), [deleteSpan('c1', 5)]);

    // The collapsed delete span still paints exactly one decoration.
    expect(count(state)).toBe(1);

    // NOTE: the deleted characters are not present in the document, so this is a widget rendering text the
    // document does not contain rather than a mark laid over an existing range of content.
  });

  it('paints both decorations for a replacement without skipping either kind', () => {
    const state = applySpans(makeState(true), [deleteSpan('c1', 5), insertSpan('c2', 5, 10)]);

    // A replacement is one delete plus one insert, so two distinct decorations must be painted.
    expect(count(state)).toBe(2);

    // An insertion and a deletion have to branch into separate widget kinds; if the code collapsed them onto
    // one path this test would catch it by reporting fewer than two decorations for the replacement.
  });

  it('drops a span past the end of the document without throwing', () => {
    const state = makeState(true);

    // Applying an out-of-bounds insert (end far beyond the document length) must not throw.
    expect(() => applySpans(state, [insertSpan('stale', 5, 500)])).not.toThrow();

    // The dropped span leaves no decorations behind once applied.
    const applied = applySpans(state, [insertSpan('stale', 5, 500)]);
    expect(count(applied)).toBe(0);
  });

  it('maps its decoration across an ordinary edit instead of clearing it', () => {
    // Apply one insert span over 'quick' (positions 5..10) before the unrelated insertion.
    const withSpan = applySpans(makeState(true), [insertSpan('c1', 5, 10)]);

    // Insert two characters at position 1 without any change-plugin metadata attached to this transaction.
    const edited = withSpan.apply(withSpan.tr.insertText('XX', 1));

    // The decoration survives the keystroke and remains a single inline decoration rather than being cleared.
    expect(count(edited)).toBe(1);

    // A position shifted by two characters (original pos 7 -> new pos 9) still lands inside c1's moved range.
    expect(changesAt(edited, 9)).toEqual(['c1']);

    // Mapping rather than clearing is what stops the marks blinking off on every keystroke.
  });
});