/**
 * @file multi-caret.ts
 * @purpose Composes the CodeMirror extensions that enable multiple carets and column (rectangular) selection for K-Doc's Source pane, satisfying the Source half of FR-7.2.
 *   This is a composition of existing CodeMirror pieces rather than a new implementation: it wires together the multi-selection facet,
 *   the rectangular-selection plugin, the crosshair cursor, and the add-next-occurrence keybinding.
 * @inputs void — the extensions are self-contained and require no session or view state to be constructed.
 * @outputs an ordered array of CodeMirror Extensions that a host passes into EditorState.create alongside markdown() and createSourceKeymap().
 * @functions
 *   - createMultiCaretExtensions: Returns the ordered list of extensions enabling multi-caret editing in the Source pane.
 * @dataflow (none) — this file produces configuration objects only; no data flows through it, extension descriptors are simply returned.
 * @controlflow Build a four-element array in dependency order and return it; there is no branching or state to transition.
 * @note Ctrl+Click needs no extension here: once allowMultipleSelections is on, CodeMirror adds a caret on any modified click by itself,
 *   so only the Alt-drag column selection and the Mod-d keyboard shortcut require code in this module.
 * @note This is the Source half of FR-7.2 only. ProseMirror has no multi-selection model, so the K-Doc half is not implemented;
 *   a caret drawn there that could not take an edit would be worse than no caret.
 * @version 1
 * @date 2026-09-06
 */

import { EditorState, type Extension } from '@codemirror/state';
import { keymap, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { selectNextOccurrence } from '@codemirror/search';

/**
 * @purpose Composes the CodeMirror extensions enabling multiple carets and column selection for K-Doc's Source pane (FR-7.2).
 * @inputs void.
 * @outputs readonly Extension[] — a four-element array of extensions in dependency order.
 * @dataflow No data flows through this function; it assembles extension descriptors and returns them.
 * @controlflow Returns an ordered array literal: the multi-selection facet first, then rectangular selection, crosshair cursor, and the Mod-d keymap.
 */
export function createMultiCaretExtensions(): readonly Extension[] {
  return [
    // allowMultipleSelections is the enabling facet: CodeMirror collapses a multi-range selection to a single range unless it is on,
    // so every other piece in this file — the extra carets from Ctrl+Click, rectangular selection, and add-next-occurrence — would be inert without it. It goes first because the rest depend on it.
    EditorState.allowMultipleSelections.of(true),

    // rectangularSelection() enables Alt+Drag column (rectangular) selection. This is one of only two behaviours that need code here;
    // the other is the Mod-d keybinding below. Ctrl+Click needs nothing, because CodeMirror adds a caret on a modified click once allowMultipleSelections is enabled.
    rectangularSelection(),

    // crosshairCursor() swaps in a crosshair pointer while Alt is held, making the modifier discoverable instead of requiring the user to already know it.
    crosshairCursor(),

    // keymap binds add-next-occurrence (Mod-d). It is bound here rather than in keymap.ts because it belongs with the facet that makes it work:
    // without allowMultipleSelections, Mod-d would silently do nothing, so binding it where the other shortcuts live would leave a dead shortcut if this module were ever removed.
    // preventDefault: true matters because Ctrl+D is the browser's bookmark shortcut; without it the browser dialog opens over the editor instead of selecting the next occurrence.
    keymap.of([{ key: 'Mod-d', run: selectNextOccurrence, preventDefault: true }]),
  ];
}
