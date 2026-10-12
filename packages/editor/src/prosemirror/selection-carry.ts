/**
 * @file selection-carry.ts
 * @purpose Pure functions that carry a selection between the Source pane (raw Markdown character offsets) and the WYSIWYG pane (ProseMirror document positions) through a PositionIndex.
 *
 *   Carrying selection across the two panes allows switching view modes or synchronizing active selections
 *   without stranding or resetting the user's cursor. Because Markdown source contains syntax characters
 *   (such as hashes, asterisks, and backticks) absent in the rendered ProseMirror document tree, coordinates
 *   cannot be transferred directly. Translations map anchor and head offsets through PositionIndex while
 *   preserving selection direction (including backwards selections) and clamping boundaries to valid document extents.
 *
 * @inputs index - PositionIndex providing offset-to-position and position-to-offset mappings between source and ProseMirror coordinates.
 * @inputs doc - ProseMirror document node providing resolve and content size bounds.
 * @inputs selection - CarriedSelection representing anchor and head endpoints in the originating coordinate space.
 * @inputs textLength - Non-negative integer representing the source Markdown string length for clamping.
 * @outputs TextSelection | null - ProseMirror TextSelection positioned between mapped coordinates, or null if unmappable.
 * @outputs CarriedSelection | null - Source offset selection { anchor, head } clamped to text length, or null if unmappable.
 * @functions
 *   - sourceSelectionToProseMirror: Maps a raw Markdown source selection into a ProseMirror TextSelection.
 *   - proseMirrorSelectionToSource: Maps a ProseMirror position selection into a source Markdown CarriedSelection.
 * @dataflow Source CarriedSelection -> caretPositionFromSource lookups -> clamped bounds -> doc.resolve -> TextSelection.between.
 * @dataflow ProseMirror CarriedSelection -> caretOffsetFromProseMirror lookups -> clamped bounds -> CarriedSelection { anchor, head }.
 * @controlflow Resolve anchor; if collapsed reuse mapped anchor for head else resolve head; return null if either unmapped; clamp to bounds; construct and return target selection.
 * @version 2
 * @date 2026-09-13
 */

import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { offsetToPosition, positionToOffset, type PositionIndex } from './offset-map.js';

/** A selection as two offsets. `anchor` is where it started and `head` is where the caret is, so `anchor > head` is a backwards selection. */
export interface CarriedSelection {
  readonly anchor: number;
  readonly head: number;
}

/**
 * @purpose Maps a source Markdown character offset to a ProseMirror position for caret placement, preserving segment-end boundaries.
 *
 *   Segments in PositionIndex are half-open spans [srcStart, srcEnd). Containment keeps the exact mapping
 *   for offsets strictly inside text. The ending rule covers the one boundary half-open segments leave
 *   unowned: when a caret sits at srcEnd, mapping to pmEnd places it right after the segment's last
 *   character rather than snapping forward past intervening markup or whitespace into the next block.
 *
 * @inputs index - PositionIndex mapping source offsets to ProseMirror document positions.
 * @inputs offset - Source character offset to map.
 * @outputs number | null - Mapped ProseMirror position, or null if beyond divergence or unmappable.
 * @dataflow offset -> segment scan for containment or end -> offsetToPosition fallback -> resolved position.
 * @controlflow Iterate segments to find containment (delegating to offsetToPosition) or a segment ending at offset; return ending pmEnd if found; otherwise fall back to offsetToPosition.
 */
function caretPositionFromSource(index: PositionIndex, offset: number): number | null {
  // No divergence check of its own. Every segment ends at or before index.divergedAt, so past it no
  // segment contains or ends at the offset and the offsetToPosition fallback refuses it; a separate
  // guard was removed after a mutation showed deleting it changed no answer.
  let endingPmEnd: number | null = null;

  // Iterate segments with for...of to check for containment or an ending boundary.
  for (const seg of index.segments) {
    // Check if the source offset falls within this segment's half-open span [srcStart, srcEnd).
    // Containment keeps the exact mapping for characters inside text.
    if (seg.srcStart <= offset && offset < seg.srcEnd) {
      // Inside text the existing mapping is already exact; return offsetToPosition unchanged.
      return offsetToPosition(index, offset);
    } else if (seg.srcEnd === offset) {
      // The ending rule covers the one boundary half-open segments leave unowned. No segment is
      // zero-width -- one exists only where texts match, and ProseMirror has no empty text nodes.
      endingPmEnd = seg.pmEnd;
    } else {
      // Segment neither contains nor ends at the offset: continue scanning.
    }
  }

  // Check if some segment ended at the offset.
  if (endingPmEnd !== null) {
    // The caret was after that segment's last character, and after that character is where it belongs.
    return endingPmEnd;
  } else {
    // Otherwise a caret genuinely in markup or between blocks still snaps forward to the text that follows.
    return offsetToPosition(index, offset);
  }
}

/**
 * @purpose Maps a ProseMirror document position to a source Markdown character offset for caret placement, preserving segment-end boundaries.
 *
 *   Segments in PositionIndex are half-open spans [pmStart, pmEnd). Containment keeps the exact mapping
 *   for positions strictly inside rendered text. The ending rule covers the one boundary half-open segments
 *   leave unowned: when a caret sits at pmEnd, mapping to srcEnd places it right after the segment's last
 *   character rather than snapping forward across markup into the next block.
 *
 * @inputs index - PositionIndex mapping ProseMirror document positions to source Markdown offsets.
 * @inputs pos - ProseMirror document position to map.
 * @outputs number | null - Mapped source character offset, or null if unmappable.
 * @dataflow pos -> segment scan for containment or end -> positionToOffset fallback -> resolved offset.
 * @controlflow Iterate segments to find containment (delegating to positionToOffset) or a segment ending at pos; return ending srcEnd if found; otherwise fall back to positionToOffset.
 */
function caretOffsetFromProseMirror(index: PositionIndex, pos: number): number | null {
  let endingSrcEnd: number | null = null;

  // Iterate segments with for...of to check for containment or an ending boundary on the ProseMirror axis.
  for (const seg of index.segments) {
    // Check if the position falls within this segment's half-open span [pmStart, pmEnd).
    // Containment keeps the exact mapping for characters inside text.
    if (seg.pmStart <= pos && pos < seg.pmEnd) {
      // Inside rendered text the existing mapping is already exact; return positionToOffset unchanged.
      return positionToOffset(index, pos);
    } else if (seg.pmEnd === pos) {
      // The ending rule covers the one boundary half-open segments leave unowned; no segment is zero-width.
      endingSrcEnd = seg.srcEnd;
    } else {
      // Segment neither contains nor ends at the position: continue scanning.
    }
  }

  // Check if some segment ended at the position.
  if (endingSrcEnd !== null) {
    // The caret was after that segment's last character, and after that character is where it belongs in source.
    return endingSrcEnd;
  } else {
    // Otherwise a position in markup or between blocks still snaps forward to the text that follows via positionToOffset.
    return positionToOffset(index, pos);
  }
}

/**
 * @purpose Maps a raw Markdown source selection into a ProseMirror TextSelection.
 *
 *   Selection direction is preserved: a forward selection (anchor <= head) remains forward,
 *   and a backwards selection (anchor > head) remains backwards. The mapping remains monotonic
 *   non-decreasing -- a segment's end is never after the start of the segment that follows it --
 *   so the ends of a selection can meet (collapsing the selection) but never cross or invert direction.
 *
 * @inputs index - PositionIndex mapping source offsets to ProseMirror document positions.
 * @inputs doc - ProseMirror document node providing resolve and content size bounds.
 * @inputs selection - CarriedSelection holding raw source anchor and head offsets.
 * @outputs TextSelection | null - Resolved TextSelection in ProseMirror coordinates, or null if unmappable.
 * @dataflow selection.anchor/head -> caretPositionFromSource -> raw positions -> clamped into [0, doc.content.size] -> doc.resolve -> TextSelection.between.
 * @controlflow Map anchor; if selection is collapsed reuse mapped anchor for head else map head; if either is null return null; clamp positions into [0, doc.content.size]; return TextSelection.between.
 */
export function sourceSelectionToProseMirror(
  index: PositionIndex,
  doc: PMNode,
  selection: CarriedSelection,
): TextSelection | null {
  const mappedAnchor = caretPositionFromSource(index, selection.anchor);
  let mappedHead: number | null;

  // Check if the selection is collapsed at a single caret position.
  if (selection.anchor === selection.head) {
    // When the selection is collapsed, reuse the anchor mapping result for the head rather than mapping twice; a caret is a single point and must land on one point.
    mappedHead = mappedAnchor;
  } else {
    // Selection is extended: map the head offset independently.
    mappedHead = caretPositionFromSource(index, selection.head);
  }

  // Check if either the anchor or head offset could not be mapped to a valid position.
  if (mappedAnchor === null || mappedHead === null) {
    // Return null when either offset cannot be mapped so the caller leaves the target pane selection untouched; guessing a position would put the caret somewhere the user was not.
    return null;
  } else {
    // Both endpoints mapped successfully: proceed to clamping and selection construction.
  }

  // Clamp each mapped position into [0, doc.content.size] to guarantee valid document bounds.
  const docSize = doc.content.size;
  const clampedAnchor = Math.max(0, Math.min(mappedAnchor, docSize));
  const clampedHead = Math.max(0, Math.min(mappedHead, docSize));

  // TextSelection.between moves block-boundary positions to the nearest valid cursor position,
  // preserving selection direction by treating its first argument as the anchor.
  const resolvedSelection = TextSelection.between(
    doc.resolve(clampedAnchor),
    doc.resolve(clampedHead),
  );

  // Check if ProseMirror resolved the endpoints to a concrete TextSelection.
  if (resolvedSelection instanceof TextSelection) {
    // Return the mapped text selection with preserved direction.
    return resolvedSelection;
  } else {
    // Fall back to null if ProseMirror fell back to a non-text selection (e.g. AllSelection or NodeSelection).
    return null;
  }
}

/**
 * @purpose Maps a ProseMirror position selection into a source Markdown CarriedSelection.
 *
 *   Selection direction is preserved: a forward selection (anchor <= head) remains forward,
 *   and a backwards selection (anchor > head) remains backwards. The mapping remains monotonic
 *   non-decreasing -- a segment's end is never after the start of the segment that follows it --
 *   so the ends of a selection can meet but never cross.
 *
 * @inputs index - PositionIndex mapping ProseMirror document positions to source Markdown offsets.
 * @inputs selection - CarriedSelection holding ProseMirror anchor and head positions.
 * @inputs textLength - Length of the raw Markdown source text used to clamp mapped offsets.
 * @outputs CarriedSelection | null - Source offset selection { anchor, head }, or null if unmappable.
 * @dataflow selection.anchor/head -> caretOffsetFromProseMirror -> raw offsets -> clamped into [0, textLength] -> CarriedSelection { anchor, head }.
 * @controlflow Map anchor; if selection is collapsed reuse mapped anchor for head else map head; if either is null return null; clamp offsets into [0, textLength]; return CarriedSelection.
 */
export function proseMirrorSelectionToSource(
  index: PositionIndex,
  selection: CarriedSelection,
  textLength: number,
): CarriedSelection | null {
  const mappedAnchor = caretOffsetFromProseMirror(index, selection.anchor);
  let mappedHead: number | null;

  // Check if the selection is collapsed at a single position.
  if (selection.anchor === selection.head) {
    // When collapsed, reuse the single anchor mapping for the head rather than mapping twice; a caret is one point and must land on one point.
    mappedHead = mappedAnchor;
  } else {
    // Extended selection: map head position independently.
    mappedHead = caretOffsetFromProseMirror(index, selection.head);
  }

  // Check if either endpoint could not be mapped to a source offset.
  if (mappedAnchor === null || mappedHead === null) {
    // Return null when either endpoint cannot be mapped so the caller preserves the existing selection.
    return null;
  } else {
    // Both endpoints mapped successfully: clamp to text length and return.
  }

  // Clamp mapped offsets into [0, textLength] to guarantee valid source string boundaries.
  const clampedAnchor = Math.max(0, Math.min(mappedAnchor, textLength));
  const clampedHead = Math.max(0, Math.min(mappedHead, textLength));

  // Return the carried selection with mapped offsets, direction unchanged.
  return {
    anchor: clampedAnchor,
    head: clampedHead,
  };
}
