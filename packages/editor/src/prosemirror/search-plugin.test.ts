// @vitest-environment jsdom
/**
 * @file search-plugin.test.ts
 * @purpose Vitest suite for K-Doc's find-match highlight plugin (FR-9.2). Verifies that no highlights exist by default, that an absent plugin is answered rather than thrown at, that every supplied range is highlighted, that only the active range carries the active class, that a range collapsing under document clamping is dropped, and that a highlight maps across an ordinary edit to stay on its word.
 * @inputs EditorState instances built on kdocSchema with a single-paragraph document holding TEXT, SearchMeta fixtures carrying arrays of mapped ranges plus an active index, and a ProseMirror insert-text transaction used to exercise mapping.
 * @outputs Vitest assertions over the search DecorationSet: decoration counts, per-decoration [from, to) spans, PM_SEARCH_MATCH_CLASS / PM_SEARCH_ACTIVE_CLASS on each spec, and how a highlight's position shifts across an edit.
 * @functions
 *   - createTestDoc: Helper creating a single-paragraph ProseMirror document holding TEXT.
 *   - makeState: Helper creating an EditorState on kdocSchema with the test doc and either the search plugin or no plugins.
 *   - applyMeta: Applies a SearchMeta (ranges[] + activeIndex) to a state via setMeta + apply, without any view.
 *   - decos: Reads the plugin's DecorationSet through its key and returns each decoration's [from, to) span plus class string, tolerating an absent plugin.
 * @dataflow SearchMeta ranges -> setMeta(searchPluginKey) / state.apply -> buildSearchDecorations or value.map -> decos() reads searchPluginKey.getState decorations -> expect assertions.
 * @controlflow Absent-plugin fallbacks -> per-range highlight with exact spans -> active-class tagging -> clamping collapse -> mapping across an ordinary edit.
 * @notes setSearchRanges is intentionally NOT exercised here: it requires a live EditorView to dispatch on, whereas this suite drives the plugin purely at state level via applyMeta — exactly as change-bar-plugin.test.ts does for its plugin.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { createSearchPlugin, searchPluginKey, PM_SEARCH_ACTIVE_CLASS, PM_SEARCH_MATCH_CLASS } from './search-plugin.js';
import type { SearchMeta } from './search-plugin.js';

// One top-level paragraph holding TEXT so a match can be shown to sit on an exact word span.
const TEXT = 'The quick brown fox'; // 19 characters

// ProseMirror position map for the single-paragraph document:
//   <doc>
//     <paragraph>The quick brown fox</paragraph>   (TEXT, nodeSize = 19 + 2 = 21)
// Position 0 is before <doc>'s content at depth 0.
// The paragraph starts at document position 0 and its text occupies positions 1..(1 + TEXT.length), i.e. 1..20, so the paragraph node spans [0, 21).
// doc.content.size is therefore para.nodeSize = 21.
// 'quick' begins at string index 4, so it occupies document positions 5..10; 'brown' begins at string index 10, occupying positions 11..16.

/** Creates a single-paragraph ProseMirror test document holding TEXT as its only text node. */
function createTestDoc(): ProseMirrorNode {
  // Wrap the paragraph string in a paragraph node, then wrap that paragraph as the doc's sole child, all through kdocSchema.
  return kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text(TEXT)])]);
}

/** Creates an EditorState initialized on kdocSchema with a fresh test document, optionally installing the search plugin. */
function makeState(withPlugin: boolean): EditorState {
  // Build a fresh document for every state so tests never share or mutate a common node tree.
  const doc = createTestDoc();

  // Check whether the search plugin should be installed on this editor state.
  if (withPlugin) {
    // Plugin requested: install createSearchPlugin() alongside the document and schema.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [createSearchPlugin()] });
  } else {
    // Plugin not requested: build a bare state with no plugins to exercise absent-plugin fallbacks.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [] });
  }
}

/** Applies a SearchMeta (ranges[] + activeIndex) directly onto an editor state via setMeta + apply, without any view. */
function applyMeta(state: EditorState, meta: SearchMeta): EditorState {
  // Attach the search metadata to a fresh transaction via the plugin key and commit it into a new state so apply() rebuilds the highlights against the current document.
  return state.apply(state.tr.setMeta(searchPluginKey, meta));
}

/** Returns each active search-match decoration's [from, to) span together with its CSS class in an editor state, tolerating an absent plugin. */
function decos(state: EditorState): Array<{ from: number; to: number; cls: string }> {
  // The plugin's state is the DecorationSet itself rather than an object wrapping one, so this is read directly.
  const decorations = searchPluginKey.getState(state);

  // Check whether the search plugin is installed on this editor state.
  if (decorations === undefined) {
    // Plugin absent: report no highlights rather than throwing at an uninstalled key.
    return [];
  } else {
    // Plugin present: map every decoration in its set to a plain span record carrying its class string.
    // Decoration.inline's third argument is the attribute set, so the class lives on the decoration's type (d.type.attrs) rather than on d.spec.
    return decorations.find().map((d) => ({ from: d.from, to: d.to, cls: (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class ?? '' }));
  }
}

describe('search-plugin', () => {
  it('starts with no highlights', () => {
    // A freshly created state that includes the plugin begins its DecorationSet empty, before any search has arrived.
    const state = makeState(true);

    // No SearchMeta has been applied yet, so there must be zero match highlights painted.
    expect(decos(state)).toEqual([]);
  });

  it('answers an absent plugin instead of throwing', () => {
    // A bare state with no plugins installed still needs to yield a highlight list rather than throw on read.
    const state = makeState(false);

    // decos() must return an empty array for the missing plugin, not raise at searchPluginKey.getState().
    expect(decos(state)).toEqual([]);
  });

  it('highlights every range it is given', () => {
    // Two mapped ranges over 'quick' (5..10) and 'brown' (11..16) must each produce one highlight.
    const state = applyMeta(makeState(true), { ranges: [{ from: 5, to: 10 }, { from: 11, to: 16 }], activeIndex: 0 });

    // Exactly two decorations are produced for the two supplied ranges.
    expect(decos(state)).toHaveLength(2);

    // The first highlight must sit over 'quick' (positions 5..10) and the second over 'brown' (11..16).
    expect(decos(state)).toEqual([
      { from: 5, to: 10, cls: PM_SEARCH_ACTIVE_CLASS },
      { from: 11, to: 16, cls: PM_SEARCH_MATCH_CLASS },
    ]);
  });

  it('marks only the active range', () => {
    // The same two ranges with activeIndex 1 must tag the second match ('brown') as active and leave the first ('quick') base-styled.
    const state = applyMeta(makeState(true), { ranges: [{ from: 5, to: 10 }, { from: 11, to: 16 }], activeIndex: 1 });

    // Two decorations are still produced; only their classes differ from the previous test.
    expect(decos(state)).toHaveLength(2);

    // decos() is what carries the class; a raw Decoration keeps its attributes on its type instead, so the
    // whole record list is asserted at once -- which also pins that the spans did not move with the classes.
    expect(decos(state)).toEqual([
      { from: 5, to: 10, cls: PM_SEARCH_MATCH_CLASS },
      { from: 11, to: 16, cls: PM_SEARCH_ACTIVE_CLASS },
    ]);
  });

  it('drops a range that collapses when clamped', () => {
    // A range far past the end of the document (40..60) must be dropped entirely rather than painting at meaningless coordinates.
    const state = applyMeta(makeState(true), { ranges: [{ from: 40, to: 60 }], activeIndex: 0 });

    // doc.content.size is only 21, so both ends clamp down to 21 and the range collapses; no highlight survives.
    expect(decos(state)).toEqual([]);

    // Clamping both from and to into [0, doc.content.size] pins them to 21, giving a collapsed range (to <= from) that buildSearchDecorations skips, so an inline decoration marks nothing.
  });

  it('keeps a highlight on its word across an edit', () => {
    // A single range over 'quick' (5..10) must survive and shift forward when text is inserted before it.
    const withHighlight = applyMeta(makeState(true), { ranges: [{ from: 5, to: 10 }], activeIndex: 0 });

    // Insert two characters at position 1 (inside 'The') without any search metadata attached to this transaction, so apply() maps rather than rebuilds.
    const edited = withHighlight.apply(withHighlight.tr.insertText('XY', 1));

    // Exactly one decoration survives the keystroke — it is mapped across the edit, not cleared by the absence of SearchMeta.
    expect(decos(edited)).toHaveLength(1);

    // The highlight's start moved forward by exactly two characters (5 -> 7) to stay over 'quick'; the
    // inserted text pushed it down without losing the word.
    expect(decos(edited)).toEqual([{ from: 7, to: 12, cls: PM_SEARCH_ACTIVE_CLASS }]);

    // Mapping rather than clearing is what keeps the highlight on the right words while the user types, since a re-search only arrives on the next keystroke's debounce.
  });
});
