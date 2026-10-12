/**
 * @file pane-anchors.ts
 * @purpose Provides pane-specific BlockAnchor providers for ProseMirror (WYSIWYG) and CodeMirror (Source) editor views and resolves the active scrolling element for CodeMirror, powering block-boundary scroll synchronization (FR-5.5).
 * @inputs ProseMirrorView and scroller HTMLElement for WYSIWYG pane; CodeMirrorView and AST block character offset array for Source pane.
 * @outputs Readonly arrays of BlockAnchor objects for WYSIWYG and Source panes, and the active scrolling HTMLElement for CodeMirror.
 * @functions
 *   - wysiwygAnchors: Computes block anchors for top-level children of the ProseMirror document DOM relative to the scroller's scrollable content frame.
 *   - sourceAnchors: Computes block anchors for CodeMirror lines based on AST block start offsets relative to the scrollable content frame.
 *   - sourceScroller: Resolves the active scrollable container element for a CodeMirror view (.cm-scroller or fallback).
 * @dataflow DOM hierarchy / AST block offsets -> position mapping -> BlockAnchor records ({ index, top }).
 * @controlflow Iterate top-level DOM children or AST block offsets -> compute scroll-relative top positions -> return readonly BlockAnchor array; locate .cm-scroller element with fallback.
 * @version 1
 * @date 2026-09-05
 */

import type { EditorView as ProseMirrorView } from 'prosemirror-view';
import type { EditorView as CodeMirrorView } from '@codemirror/view';
import type { BlockAnchor } from './scroll-sync.js';

/**
 * Computes block anchors for the ProseMirror WYSIWYG editor pane.
 *
 * One anchor per top-level child of the ProseMirror content DOM — those children
 * are exactly the document's top-level blocks, so their index is the block index
 * the two panes agree on.
 *
 * @purpose Extracts block anchors for top-level children of the ProseMirror document DOM relative to the scroller's scrollable content frame.
 * @inputs view - ProseMirrorView (EditorView) providing access to the content DOM hierarchy (view.dom).
 * @inputs scroller - HTMLElement representing the scrollable container enclosing the WYSIWYG editor.
 * @outputs readonly BlockAnchor[] - Array of block anchor records containing block index and scroll-relative top offset.
 * @dataflow view.dom.children -> HTMLElement filtering -> child and scroller getBoundingClientRect() + scroller.scrollTop -> BlockAnchor array.
 * @controlflow Access view.dom -> iterate child elements with strict undefined guard -> filter non-HTMLElements -> calculate top offset relative to scrollable content -> append anchor -> return array.
 */
export function wysiwygAnchors(
  view: ProseMirrorView,
  scroller: HTMLElement,
): readonly BlockAnchor[] {
  const content = view.dom;
  const anchors: BlockAnchor[] = [];

  for (let i = 0; i < content.children.length; i++) {
    const child = content.children[i];

    // Guard each read: children[i] is Element | undefined under strict indexing, and verify child is an HTMLElement.
    if (child === undefined || !(child instanceof HTMLElement)) {
      // Child is undefined or not an HTMLElement (e.g. comment node or SVG element): skip this child.
      continue;
    } else {
      // Child is a valid HTMLElement representing a top-level document block.
    }

    // Compute the top as child.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop.
    // Rects are viewport-relative, so subtracting the scroller's own rect gives a position relative to
    // the scroller's visible box, and adding scrollTop converts that into a position relative to the
    // scrollable content — which is what scrollTop is measured in, and therefore the only frame in
    // which the two panes can be compared.
    const top =
      child.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;

    anchors.push({ index: i, top });
  }

  return anchors;
}

/**
 * Computes block anchors for the CodeMirror Source editor pane based on AST block start offsets.
 *
 * blockOffsets are the character offsets in the Markdown source where each top-level block starts,
 * in document order — the caller derives them from the AST so both panes index the same blocks.
 *
 * @purpose Resolves vertical pixel offsets for Markdown source block start positions within CodeMirror's scrollable content frame.
 * @inputs view - CodeMirrorView (EditorView) providing document state and line block layout queries.
 * @inputs blockOffsets - readonly number[] containing 0-based character offsets where each top-level block begins in document order.
 * @outputs readonly BlockAnchor[] - Array of block anchor records containing block index and scroll-relative top offset.
 * @dataflow blockOffsets -> clamp to [0, doc.length] -> view.lineBlockAt(clamped).top -> BlockAnchor array.
 * @controlflow Iterate blockOffsets in try/catch -> guard undefined under strict indexing -> clamp offset to valid document range -> query lineBlockAt -> push anchor -> catch error and skip failing offset -> return anchors array.
 */
export function sourceAnchors(
  view: CodeMirrorView,
  blockOffsets: readonly number[],
): readonly BlockAnchor[] {
  const anchors: BlockAnchor[] = [];

  for (let i = 0; i < blockOffsets.length; i++) {
    try {
      const offset = blockOffsets[i];

      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (offset === undefined) {
        // Offset is undefined at this index: skip this entry.
        continue;
      } else {
        // Offset is a defined number: proceed to clamp and locate line block.
      }

      // Clamp the offset into [0, view.state.doc.length] before use.
      // An offset past the end is expected transiently: the AST the caller read from can be a
      // beat ahead of the text CodeMirror currently holds, and lineBlockAt throws on an
      // out-of-range position rather than clamping.
      const docLength = view.state.doc.length;
      const clamped = Math.max(0, Math.min(offset, docLength));

      // Query CodeMirror for the line block at the clamped character offset.
      // CodeMirror already reports this relative to the top of the scrollable content, so unlike
      // the WYSIWYG side it needs no rect arithmetic — the two functions return values in the same
      // frame despite computing them completely differently, and that equivalence is the whole
      // contract between them.
      const block = view.lineBlockAt(clamped);

      anchors.push({ index: i, top: block.top });
    } catch {
      // Skip a failing offset rather than aborting the whole list:
      // one unmappable block should not disable scroll sync for the entire document.
      continue;
    }
  }

  return anchors;
}

/**
 * Resolves the active scrollable container element for a CodeMirror editor view.
 *
 * Returns the element that actually scrolls for the Source pane. CodeMirror scrolls its own
 * .cm-scroller, not the pane div, so syncing against the pane would read a scrollTop that never changes.
 *
 * @purpose Locates and returns the scrolling HTMLElement (.cm-scroller) for a CodeMirror EditorView, falling back to view.dom.
 * @inputs view - CodeMirrorView (EditorView) whose DOM tree contains the internal scroller element.
 * @outputs HTMLElement - The active scrolling element (.cm-scroller if found, otherwise view.dom).
 * @dataflow view.dom -> querySelector('.cm-scroller') -> HTMLElement verification -> active scroller element.
 * @controlflow Query view.dom for .cm-scroller selector -> check if result is an instance of HTMLElement -> return found element if true -> fallback to returning view.dom if false.
 */
export function sourceScroller(view: CodeMirrorView): HTMLElement {
  const found = view.dom.querySelector('.cm-scroller');

  // Check if the queried .cm-scroller element exists and is an HTMLElement.
  if (found instanceof HTMLElement) {
    // Found CodeMirror's internal .cm-scroller element: return it as the active scroller.
    return found;
  } else {
    // Falling back to view.dom keeps sync approximately working if CodeMirror ever restructures,
    // rather than throwing at startup.
    return view.dom;
  }
}
