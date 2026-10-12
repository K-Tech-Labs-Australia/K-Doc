/**
 * @file writing-modes.ts
 * @purpose Focus and Typewriter modes in the Source pane (FR-5.8).
 * @inputs modes getter and editor updates.
 * @outputs dim mark decorations and scroll changes.
 * @functions
 *   - sourceFocusDecorations: builds dim marks around the focused range.
 *   - writingModes: registers the view plugin applying focus/typewriter behaviour.
 *   - refreshWritingModes: dispatches the refresh effect to recompute decorations.
 * @dataflow text + caret -> focusRange -> dim marks; update -> measure caret -> centre.
 * @controlflow rebuild on text/selection/refresh, scroll with focus only.
 * @version 1
 * @date 2026-09-16
 */

import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { focusRange, type FocusScope } from '@k-doc/core';
import type { WritingModes } from '../prosemirror/writing-modes.js';
import { FOCUS_DIM_CLASS } from '../prosemirror/writing-modes.js';
import { centreInContainer, scrollContainerOf } from '../writing-scroll.js';

export const refreshWritingModesEffect = StateEffect.define<null>();

const dimMark = Decoration.mark({ class: FOCUS_DIM_CLASS });

/** Returns dim mark decorations around the focused range, or an empty set when focus is off. */
export function sourceFocusDecorations(text: string, head: number, scope: FocusScope): DecorationSet {
  // When focus is disabled there is no active range to highlight, so return no decorations.
  if (scope === 'off') {
    return Decoration.none;
  } else {
    // Focus is active: fall through and build dim marks around the focused range.
  }
  const range = focusRange(text, head, scope);
  const builder = new RangeSetBuilder<Decoration>();
  // There is text before the focused range, so dim everything up to its start.
  if (range.start > 0) {
    builder.add(0, range.start, dimMark);
  } else {
    // The focused range begins at the document start; nothing precedes it to dim.
  }
  // There is text after the focused range, so dim everything from its end onward.
  if (range.end < text.length) {
    builder.add(range.end, text.length, dimMark);
  } else {
    // The focused range ends at the document end; nothing follows it to dim.
  }
  return builder.finish();
}

class WritingModesView {
  decorations: DecorationSet;

  constructor(view: EditorView, private readonly modes: () => WritingModes) {
    this.decorations = sourceFocusDecorations(view.state.doc.toString(), view.state.selection.main.head, modes().focus);
  }

  update(update: ViewUpdate): void {
    const refreshed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshWritingModesEffect)));
    const moved = update.docChanged || update.selectionSet;
    // Text or selection changed (or a refresh was requested), so recompute decorations.
    if (moved || refreshed) {
      this.decorations = sourceFocusDecorations(update.state.doc.toString(), update.state.selection.main.head, this.modes().focus);
    } else {
      // Nothing that affects focus changed; keep the existing decorations.
    }
    // Typewriter mode is on, something relevant moved, and the editor has focus: centre the caret.
    if (this.modes().typewriter && (moved || refreshed) && update.view.hasFocus) {
      const head = update.state.selection.main.head;
      update.view.requestMeasure({
        read: (view: EditorView): void => {
          const container = scrollContainerOf(view.scrollDOM);
          const caret = view.coordsAtPos(head);
          // Both the scroll container and caret coordinates resolved, so centre the caret.
          if (container !== null && caret !== null) {
            centreInContainer(container, caret.top, caret.bottom);
          } else {
            // A coordinate was unavailable; skip centring to avoid a bad scroll.
          }
        },
      });
    } else {
      // Typewriter is off or the editor lost focus: do not scroll.
    }
  }
}

/** Registers a view plugin that applies focus/typewriter decorations based on the modes getter. */
export function writingModes(modes: () => WritingModes): Extension {
  return ViewPlugin.define((view) => new WritingModesView(view, modes), { decorations: (plugin) => plugin.decorations });
}

/** Dispatches the refresh effect to force the view to recompute decorations. */
export function refreshWritingModes(view: EditorView): void {
  view.dispatch({ effects: refreshWritingModesEffect.of(null) });
}
