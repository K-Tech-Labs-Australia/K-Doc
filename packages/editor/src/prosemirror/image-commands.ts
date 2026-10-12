/**
 * @file image-commands.ts
 * @purpose Commands for a selected image (FR-8.15): set or reset its width hint, and select an image from a DOM target such as a right-clicked picture.
 * @inputs editor state, selection, DOM event targets.
 * @outputs Commands and a selection helper.
 * @functions
 *   - selectedImage: Returns the node-selected image in the state, or null when none is directly selected.
 *   - setImageWidth: Command that sets (or clears with null) the width hint attribute of the selected image.
 *   - resetImageSize: Command that removes the selected image's width hint so it shows at natural size.
 *   - selectImageAt: Selects the image beneath a DOM target such as a right-clicked picture via ProseMirror selection.
 * @dataflow NodeSelection image -> setNodeMarkup width -> structural transaction.
 * @controlflow guard clauses then dispatch.
 * @version 2
 * @date 2026-09-18
 */

import { NodeSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { MAX_IMAGE_WIDTH } from '@k-doc/core';
import { MIN_IMAGE_WIDTH } from './image-view.js';

export interface SelectedImage {
  readonly pos: number;
  readonly node: PMNode;
}

/**
 * @purpose Returns the node-selected image in the state, or null when no image is directly selected.
 * @inputs state - The current ProseMirror editor state whose selection is inspected.
 * @outputs SelectedImage | null - The selected image with its position and node, or null if none.
 * @dataflow EditorState.selection → NodeSelection check → { pos, node } record or null.
 * @controlflow Inspect selection; return the image when it is a NodeSelection on an 'image' node, else null.
 */
export function selectedImage(state: EditorState): SelectedImage | null {
  const { selection } = state;
  // Only act when the selection is a node selection whose node is an image; a caret near an image does not count.
  if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
    return { pos: selection.from, node: selection.node };
  } else {
    // Selection is not a node-selected image: no image command may act on it.
    return null;
  }
}

/**
 * @purpose Returns a Command that sets (or clears with null) the width hint attribute of the selected image.
 * @inputs width - The target width in pixels, or null to remove the width hint entirely.
 * @outputs Command - A ProseMirror command returning true when it applies a change.
 * @dataflow Selected image attrs → setNodeMarkup with new width → structural transaction with meta flag.
 * @controlflow Guard: bail if no image selected, invalid width, or unchanged value; else dispatch and return true.
 */
export function setImageWidth(width: number | null): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const image = selectedImage(state);
    // No node-selected image present: the command cannot target anything.
    if (image === null) {
      return false;
    } else {
      // A node-selected image exists; continue validating the requested width.
    }
    // Reject non-integer or out-of-range widths so an invalid value never mutates the document.
    if (width !== null && (!Number.isInteger(width) || width < 1 || width > MAX_IMAGE_WIDTH)) {
      return false;
    } else {
      // Width is null (clear) or within [1, MAX_IMAGE_WIDTH]; proceed to compare against current value.
    }
    const current: unknown = image.node.attrs['width'];
    // Value already matches the request: skip to avoid adding an empty undo step.
    if ((current ?? null) === width) {
      return false;
    } else {
      // Width differs from the current attribute: build a structural transaction below.
    }
    // When no dispatch callback is supplied (dry run), report success without mutating state.
    if (dispatch !== undefined) {
      const tr = state.tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, width });
      tr.setSelection(NodeSelection.create(tr.doc, image.pos));
      dispatch(tr.setMeta('kdocStructural', true));
    } else {
      // Dry run: nothing to dispatch, but the change is valid so report success.
    }
    return true;
  };
}

// Each keyboard step changes the width by a tenth, which is enough to see and small enough to aim with.
const WIDTH_STEP = 1.1;

/**
 * @purpose Reads the width a picture is actually drawn at, so a keyboard step has somewhere to start from.
 * @inputs view - The editor view, or undefined when the command was run without one; pos - The image's position.
 * @outputs number | null - The rendered width in whole pixels, or null when it cannot be read.
 * @dataflow view.nodeDOM(pos) -> the element's own <img> -> getBoundingClientRect().width -> rounded pixels.
 * @controlflow An image with no width hint has no width in the document at all, so the only honest starting point is what the reader can see; without a view, or before the picture has loaded, there is none and the caller must say so rather than guess.
 */
function renderedWidth(view: EditorView | undefined, pos: number): number | null {
  // Check whether there is a view to measure through. A command run from a test or a dry run has none.
  if (view === undefined) {
    return null;
  } else {
    // There is: find the element standing for this image below.
  }

  const dom = view.nodeDOM(pos);
  // Check whether the position really maps to an element. A text node or nothing cannot be measured.
  if (!(dom instanceof HTMLElement)) {
    return null;
  } else {
    // It does: the picture is either this element or an <img> inside the frame around it.
  }

  const picture = dom instanceof HTMLImageElement ? dom : dom.querySelector('img');
  // Check whether a picture was found at all.
  if (picture === null) {
    return null;
  } else {
    // One was: measure what it is drawn at.
  }

  const width = Math.round(picture.getBoundingClientRect().width);
  // Check whether the measurement is usable. A picture that has not loaded yet measures zero.
  if (width < 1) {
    return null;
  } else {
    // It is: this is where the step counts from.
  }

  return width;
}

/**
 * @purpose Returns a Command that makes the selected image a step wider or narrower from the keyboard (FR-8.15).
 * @inputs wider - True to widen by one step, false to narrow by one.
 * @outputs Command - A ProseMirror command returning true when it changed the width.
 * @dataflow Selected image -> its width hint, or the width it is drawn at -> scaled by WIDTH_STEP -> clamped -> setImageWidth.
 * @controlflow The width hint is preferred over the rendered width, because stepping from the hint is exact and stepping from the screen is not; a picture with no hint yet is measured instead, so the first press has something to work from. The result is clamped to the same floor the drag handle uses and to the ceiling a hint can express, and a step that would change nothing reports that it did nothing rather than making an empty undo step.
 */
export function stepImageWidth(wider: boolean): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView): boolean => {
    const image = selectedImage(state);
    // Check whether an image is selected. Without one there is nothing to resize, and image.pos could
    // not be read at all. A mutant that put a stand-in here survived, because setImageWidth asks the
    // selection the same question and refuses too; the guard stays so nothing is measured for a picture
    // that was never going to be resized.
    if (image === null) {
      return false;
    } else {
      // One is: find the width to step from below.
    }

    const hint: unknown = image.node.attrs['width'];
    // Check whether the picture already carries a width hint, which is the exact thing to step from.
    const from = typeof hint === 'number' ? hint : renderedWidth(view, image.pos);
    // Check whether any starting width was found.
    if (from === null) {
      return false;
    } else {
      // One was: scale it by a step in the direction asked for.
    }

    // Check which way the step goes. A tenth is always at least two pixels here, because the result is
    // clamped to MIN_IMAGE_WIDTH below and a tenth of that is 1.6: a "move by at least one pixel" floor
    // was written first and then deleted, because a mutant removing it could not be killed - every width
    // small enough for it to matter is clamped up to MIN_IMAGE_WIDTH either way.
    const scaled = wider ? Math.round(from * WIDTH_STEP) : Math.round(from / WIDTH_STEP);
    const next = Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, scaled));

    return setImageWidth(next)(state, dispatch);
  };
}

/**
 * @purpose Returns a Command that removes the selected image's width hint so it shows at natural size and its alt text is written without `|N`.
 * @inputs None.
 * @outputs Command - A ProseMirror command that resets the width attribute to null.
 * @dataflow Delegates directly to setImageWidth(null) with no transformation of its own.
 * @controlflow No branching; forwards to setImageWidth(null) and returns its result.
 */
export function resetImageSize(): Command {
  return setImageWidth(null);
}

/**
 * @purpose Selects the image beneath a DOM target such as a right-clicked picture by updating ProseMirror selection.
 * @inputs view - The active EditorView used to resolve DOM positions and dispatch the new selection.
 *   target - The event target, expected to be an Element within the editor's DOM.
 * @outputs boolean - True when an image was selected, false otherwise.
 * @dataflow DOM target → .kdoc-image frame lookup → posAtDOM → nodeAt probe → NodeSelection dispatch.
 * @controlflow Guard target type and containment; scan candidate positions for an 'image' node and select it.
 */
export function selectImageAt(view: EditorView, target: EventTarget | null): boolean {
  // A non-Element target (e.g. text node or null) cannot host a .kdoc-image frame.
  if (!(target instanceof Element)) {
    return false;
  } else {
    // Target is an Element; attempt to locate the enclosing image frame below.
  }
  const frame = target.closest('.kdoc-image');
  // No enclosing .kdoc-image frame, or it lies outside the editor: nothing to select.
  if (frame === null || !view.dom.contains(frame)) {
    return false;
  } else {
    // A valid in-editor image frame was found; resolve its document position below.
  }
  // A frame is only ever the dom of an image's node view, and offset 0 inside a leaf node view resolves to the
  // position before that node, which is the image itself.
  const pos = view.posAtDOM(frame, 0);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  return true;
}
