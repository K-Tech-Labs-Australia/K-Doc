// @vitest-environment jsdom
/**
 * @file change-bar-plugin.test.ts
 * @purpose Vitest suite for K-Doc's margin change-bar plugin. Verifies that no bars exist by default, that an absent plugin is answered rather than thrown at, that a position decorates exactly one containing block (with the expected class and span), that two changes on the same line collapse into one bar, that offset 0 clamps up to the first paragraph instead of vanishing, and that ordinary edits map bars across their lines.
 * @inputs EditorState instances built on kdocSchema with a two-paragraph document, ChangeBarMeta fixtures carrying arrays of mapped positions, and ProseMirror transactions (a plan meta transaction and an insert-text edit).
 * @outputs Vitest assertions over the change-bar DecorationSet: decoration counts, per-decoration from/to spans, the PM_CHANGE_BAR_CLASS on each spec, and how a bar's position shifts across an ordinary edit.
 * @functions
 *   - createTestDoc: Helper creating a two-paragraph ProseMirror document holding FIRST and SECOND.
 *   - makeState: Helper creating an EditorState on kdocSchema with the test doc and either the change-bar plugin or no plugins.
 *   - applyPositions: Applies a ChangeBarMeta (positions[]) to a state via setMeta + apply, without any view.
 *   - bars: Reads the plugin's DecorationSet through its key and returns each decoration's [from, to) span, tolerating an absent plugin.
 * @dataflow ChangeBarMeta positions -> setMeta(changeBarPluginKey) / state.apply -> buildBarDecorations or value.map -> bars() reads changeBarPluginKey.getState decorations -> expect assertions.
 * @controlflow Absent-plugin fallbacks -> single-block decoration with class/span check -> same-line dedupe -> offset-0 clamp up to first paragraph -> mapping across an ordinary edit.
 * @notes setChangeBarPositions is intentionally NOT exercised here: it requires a live EditorView to dispatch on, whereas this suite drives the plugin purely at state level via applyPositions — exactly as change-plugin.test.ts does for its mark plugin.
 * @version 1
 * @date 2026-09-10
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { createChangeBarPlugin, changeBarPluginKey, PM_CHANGE_BAR_CLASS } from './change-bar-plugin.js';
import type { ChangeBarMeta } from './change-bar-plugin.js';

// Two top-level paragraphs so a bar can be shown to land on one block and not the other.
const FIRST = 'The quick brown fox'; // 19 characters
const SECOND = 'jumps over the lazy dog'; // 23 characters

// ProseMirror position map for the two-paragraph document:
//   <doc>
//     <paragraph>The quick brown fox</paragraph>   (FIRST, nodeSize = 19 + 2 = 21)
//     <paragraph>jumps over the lazy dog</paragraph> (SECOND, nodeSize = 23 + 2 = 25)
// Position 0 is before <doc>'s content at depth 0.
// Paragraph 1 starts at document position 0 and its text occupies positions 1..(1 + FIRST.length), i.e. 1..20, so the paragraph node spans [0, 21).
// Paragraph 2 starts at 1 + FIRST.length + 1 = 1 + 19 + 1 = 21; its text begins one past that (position 22) and the node spans [21, 46).
// doc.content.size is therefore para1.nodeSize + para2.nodeSize = 21 + 25 = 46.

/** Creates a two-paragraph ProseMirror test document holding FIRST then SECOND. */
function createTestDoc(): ProseMirrorNode {
  // Wrap each paragraph string in a paragraph node, and wrap both paragraphs as the doc's children, all via kdocSchema.
  return kdocSchema.node('doc', null, [
    kdocSchema.node('paragraph', null, [kdocSchema.text(FIRST)]),
    kdocSchema.node('paragraph', null, [kdocSchema.text(SECOND)]),
  ]);
}

/** Creates an EditorState initialized with kdocSchema and the two-paragraph test document, optionally including the change-bar plugin. */
function makeState(withPlugin: boolean): EditorState {
  // Build a fresh document for every state so tests never share or mutate a common node tree.
  const doc = createTestDoc();

  // Check whether the change-bar plugin should be installed on this editor state.
  if (withPlugin) {
    // Plugin requested: install createChangeBarPlugin() alongside the document and schema.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [createChangeBarPlugin()] });
  } else {
    // Plugin not requested: build a bare state with no plugins to exercise absent-plugin fallbacks.
    return EditorState.create({ doc, schema: kdocSchema, plugins: [] });
  }
}

/** Applies a ChangeBarMeta (an array of mapped positions) directly onto an editor state without any view. */
function applyPositions(state: EditorState, positions: readonly number[]): EditorState {
  // Assemble the change-bar metadata carrying the planned document positions for this plan arrival.
  const meta: ChangeBarMeta = { positions };

  // Attach the meta to a fresh transaction via the plugin key and commit it into a new state so apply() rebuilds the bars against the current document.
  return state.apply(state.tr.setMeta(changeBarPluginKey, meta));
}

/** Returns each active change-bar decoration's [from, to) span in an editor state, tolerating an absent plugin. */
function bars(state: EditorState): Array<{ from: number; to: number }> {
  // The plugin's state is the DecorationSet itself rather than an object wrapping one, so this is read directly.
  const decorations = changeBarPluginKey.getState(state);

  // Check whether the change-bar plugin is installed on this editor state.
  if (decorations === undefined) {
    // Plugin absent: report no bars rather than throwing at an uninstalled key.
    return [];
  } else {
    // Plugin present: map every decoration in its set to a plain [from, to) span record.
    return decorations.find().map((deco) => ({ from: deco.from, to: deco.to }));
  }
}

describe('change-bar-plugin', () => {
  it('starts with no bars', () => {
    // A freshly created state that includes the plugin begins its DecorationSet empty.
    const state = makeState(true);

    // No plan has arrived yet, so there must be zero change bars painted.
    expect(bars(state)).toEqual([]);
  });

  it('answers an absent plugin instead of throwing', () => {
    // A bare state with no plugins installed still needs to yield a bar list rather than throw on read.
    const state = makeState(false);

    // bars() must return an empty array for the missing plugin, not raise at changeBarPluginKey.getState().
    expect(bars(state)).toEqual([]);
  });

  it('decorates the block that contains the position', () => {
    // A single planned position inside the second paragraph should paint exactly one bar beside that whole paragraph.
    const state = applyPositions(makeState(true), [25]);

    // Exactly one decoration is produced for the lone plan position in the second paragraph.
    expect(bars(state)).toHaveLength(1);

    // Read the raw node decoration so its span and CSS class can be asserted literally against the fixture's map.
    const found = changeBarPluginKey.getState(state)?.find() ?? [];
    const deco = found[0];
    // The length assertion above has already established there is one, but the compiler has not seen it.
    if (deco === undefined) {
      // No decoration to inspect: fail loudly rather than silently skipping the class assertion.
      throw new Error('expected one change-bar decoration');
    } else {
      // A decoration was found: its span and class are asserted below.
    }

    // The bar must start at the second paragraph's document position (21) and end one past it, i.e. from + node.nodeSize = 21 + 25 = 46.
    expect({ from: deco.from, to: deco.to }).toEqual({ from: 21, to: 46 });

    // The class must reach the block as a DOM attribute so CHANGE_STYLES can draw the margin rule (FR-11.4).
    // Decoration.node's third argument is the attribute set, not the spec, so it is read off the decoration
    // type rather than deco.spec -- which holds the fourth argument and is undefined here.
    const attrs = (deco as unknown as { type: { attrs?: { class?: string } } }).type.attrs;
    expect(attrs?.class).toBe(PM_CHANGE_BAR_CLASS);
  });

  it('draws one bar for two changes on the same line', () => {
    // Two distinct planned positions both inside the first paragraph must collapse into a single bar.
    const state = applyPositions(makeState(true), [3, 15]);

    // Even though two lines were flagged as changed, they share one top-level block, so only one decoration is emitted.
    expect(bars(state)).toHaveLength(1);

    // Simple Markup says *this line changed*: emitting a second bar for the same paragraph would be redundant noise rather than new information.
  });

  it('draws a bar for a position at the very start of the document', () => {
    // A plan anchored at offset 0 must still paint a bar on the first paragraph instead of vanishing into the doc root.
    const state = applyPositions(makeState(true), [0]);

    // Exactly one decoration survives after clamping, and it sits beside the first paragraph.
    expect(bars(state)).toHaveLength(1);

    // The bar must start at document position 0 (the first paragraph's start) and span its full nodeSize: from = 0, to = 21.
    expect(bars(state)).toEqual([{ from: 0, to: 21 }]);

    // Offset 0 resolves into the document root at depth 0 where there is no enclosing block, so buildBarDecorations clamps it up to position 1; without that clamp the first line's bar would silently vanish.
  });

  it('keeps a bar beside its line across an ordinary edit', () => {
    // A bar on the second paragraph must survive and shift forward when text is inserted into the first paragraph before it.
    const withBar = applyPositions(makeState(true), [25]);

    // Insert two characters at position 1 (inside the first paragraph) without any change-bar metadata attached to this transaction, so apply() maps rather than rebuilds.
    const edited = withBar.apply(withBar.tr.insertText('XY', 1));

    // Exactly one decoration survives the keystroke — it is mapped across the edit, not cleared by the absence of plan meta.
    expect(bars(edited)).toHaveLength(1);

    // The bar's start moved forward by exactly two characters (21 -> 23) to stay beside its line; its span length stays at node.nodeSize = 25.
    expect(bars(edited)).toEqual([{ from: 23, to: 48 }]);

    // Mapping rather than clearing is what keeps the bar in place until the debounced re-plan arrives and rebuilds it against the new document.
  });
});
