/**
 * @file writing-modes.ts
 * @purpose Focus and Typewriter modes in WYSIWYG (FR-5.8): dims every block but the one holding the caret (or, in sentence scope, all but the caret's sentence) and keeps the caret vertically centred while typing.
 * @inputs a getter for the current modes, editor state and view.
 * @outputs decorations, scroll changes, WRITING_MODE_STYLES.
 * @functions
 *   - focusDecorations: Builds node decorations dimming every block except the one holding the caret, plus inline decorations outside the active sentence in sentence scope.
 *   - createWritingModesPlugin: Wires the decorations to a modes getter and centres the caret on relevant view updates.
 *   - refreshWritingModesIn: Forces the view to re-read its decorations after a mode changed without a transaction.
 * @dataflow selection -> innermost textblock -> node decorations on the others (+ inline decorations outside the sentence); view update -> centreInContainer.
 * @controlflow nothing is decorated when focus is off; typewriter scrolls only after the caret or text changed in a focused editor.
 * @version 1
 * @date 2026-09-16
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { focusRange, type FocusScope } from '@k-doc/core';
import { centreInContainer, scrollContainerOf } from '../writing-scroll.js';

/**
 * @purpose Focus and Typewriter mode configuration consumed by the writing-modes plugin.
 * @inputs focus - which stretch stays undimmed ('off' dims nothing); typewriter - keep the caret vertically centred while typing.
 */
export interface WritingModes {
  readonly focus: FocusScope;
  readonly typewriter: boolean;
}

/** The class a dimmed block or run carries. */
export const FOCUS_DIM_CLASS: string = 'kdoc-focus-dim';

/** Set on an ancestor of both panes while Typewriter mode is on. */
export const TYPEWRITER_CLASS: string = 'kdoc-typewriter';

/** Plugin key shared with the scroll plugin so both modes stay in sync. */
export const writingModesKey: PluginKey = new PluginKey('kdocWritingModes');

/** Dimmed text keeps its layout and only fades; the bottom padding of half a screen lets the last lines reach the middle. */
export const WRITING_MODE_STYLES: string = `
.${FOCUS_DIM_CLASS} { opacity: 0.3; transition: opacity 120ms ease; }
.${TYPEWRITER_CLASS} .ProseMirror, .${TYPEWRITER_CLASS} .cm-content { padding-bottom: 50vh; }
`;

/**
 * @purpose Builds node decorations that dim every block except the one holding the caret, plus inline decorations for the parts outside the active sentence in sentence scope.
 * @inputs state - editor state whose selection and doc are inspected; scope - which stretch stays undimmed ('off' dims nothing).
 * @outputs DecorationSet empty when focus is off, otherwise dim decorations on inactive blocks or non-sentence text.
 * @dataflow selection -> innermost textblock -> node decorations on the others (+ inline decorations outside the sentence).
 * @controlflow returns empty immediately when scope is 'off'; walks up from the caret to the innermost textblock; descends the doc decorating every textblock and leaf block except the active one; in sentence scope dims the text before and after the caret's sentence.
 */
export function focusDecorations(state: EditorState, scope: FocusScope): DecorationSet {
  // Nothing is decorated when focus mode is off.
  if (scope === 'off') {
    return DecorationSet.empty;
  } else {
    // Focus is on: fall through and decorate the inactive blocks below.
  }
  const { $head } = state.selection;
  // A text caret always sits directly in its textblock (a list item's paragraph, a table cell's paragraph); a selected
  // node's head sits in the container around it, which has no textblock to focus.
  const depth = $head.parent.isTextblock ? $head.depth : 0;
  // Position of the active block's opening bracket, or -1 when there is no textblock around the caret.
  const activePos = depth > 0 ? $head.before(depth) : -1;
  const decorations: Decoration[] = [];
  // Descend the document, decorating every textblock and leaf block except the active one.
  state.doc.descendants((node, pos) => {
    // Textblocks and leaf blocks (a rule, a block image) are decorated as whole nodes.
    if (node.isTextblock || (node.isBlock && node.isAtom)) {
      // Dim every inactive block as a single node decoration — cheap to update and never fades a container around the active block (opacity would compound onto its children).
      if (pos !== activePos) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: FOCUS_DIM_CLASS }));
      } else {
        // Active block is left undimmed.
      }
      // Do not descend into this block's children; its content is inline and handled separately in sentence scope.
      return false;
    } else {
      // Non-block node: keep descending into its children.
      return true;
    }
  });
  // In sentence scope, dim only the text before and after the caret's sentence within the active block.
  if (scope === 'sentence' && depth > 0) {
    const blockStart = $head.start(depth);
    const blockEnd = $head.end(depth);
    // Read the block with one character per inline leaf ('\ufffc') so offsets map straight to positions.
    const text = state.doc.textBetween(blockStart, blockEnd, '\n', '\ufffc');
    const sentence = focusRange(text, $head.pos - blockStart, 'sentence');
    // Dim the run before the active sentence if any exists.
    if (sentence.start > 0) {
      decorations.push(Decoration.inline(blockStart, blockStart + sentence.start, { class: FOCUS_DIM_CLASS }));
    } else {
      // No text precedes the sentence: nothing to dim here.
    }
    // Dim the run after the active sentence if any remains.
    if (blockStart + sentence.end < blockEnd) {
      decorations.push(Decoration.inline(blockStart + sentence.end, blockEnd, { class: FOCUS_DIM_CLASS }));
    } else {
      // No text follows the sentence: nothing to dim here.
    }
  } else {
    // Focus is not in sentence scope (or there is no active textblock): leave the whole block undimmed.
  }
  return DecorationSet.create(state.doc, decorations);
}

/**
 * @purpose Wires focus/typewriter decorations to the modes getter and centres the caret on relevant updates.
 * @inputs modes - getter returning the current WritingModes so a toggle takes effect without a transaction.
 * @outputs Plugin with decoration and view-update props implementing the writing modes.
 * @dataflow modes() -> focusDecorations for decorations; view update -> centreInContainer for scroll changes.
 * @controlflow decorations read modes on each redraw; the view update centres only when text or caret moved in a focused editor, else no-ops.
 */
export function createWritingModesPlugin(modes: () => WritingModes): Plugin {
  return new Plugin({
    key: writingModesKey,
    props: {
      // Decorations read the modes through the getter so a toggle takes effect on the next redraw.
      decorations: (state: EditorState): DecorationSet => focusDecorations(state, modes().focus),
    },
    view: () => ({
      update: (view: EditorView, previous: EditorState): void => {
        // Detect whether the doc or the selection changed since the last update.
        const moved = previous.doc !== view.state.doc || !previous.selection.eq(view.state.selection);
        // Typewriter centres only when text or caret moved (not on unrelated redraws) and only while this editor has focus (the other pane is being typed in otherwise).
        if (modes().typewriter && moved && view.hasFocus()) {
          const container = scrollContainerOf(view.dom);
          if (container !== null) {
            const caret = view.coordsAtPos(view.state.selection.head);
            centreInContainer(container, caret.top, caret.bottom);
          } else {
            // No scrollable ancestor: nothing to centre.
          }
        } else {
          // Typewriter off, no movement, or this editor is unfocused: do not scroll.
        }
      },
    }),
  });
}

/**
 * @purpose Forces the view to re-read its decorations after a mode changed without a transaction.
 * @inputs view - editor view whose props are reset to trigger a redraw.
 * @outputs void; the side effect is the decoration set being recomputed via focusDecorations.
 * @dataflow empty setProps -> ProseMirror redraws -> createWritingModesPlugin decorations prop re-reads modes().
 * @controlflow no branching; setProps with an empty object always causes a single redraw pass.
 */
export function refreshWritingModesIn(view: EditorView): void {
  // setProps with no changes redraws the view, re-reading decorations after a mode changed without a transaction.
  view.setProps({});
}
