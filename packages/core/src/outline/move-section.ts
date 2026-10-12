/**
 * @file move-section.ts
 * @purpose Moves a heading and everything beneath it to a new position within the document source text, implementing FR-9.1 (drag-to-reorder a section) for @k-doc/core. A move relocates the whole subtree — the heading line plus every deeper node that belongs to it — because dragging only the title line would detach the body from its heading and leave the rendered document structurally broken; operating on source text rather than the tree keeps the outline's document of record authoritative and makes a move an exact splice.
 * @inputs Source text of the document, a readonly array of OutlineEntry records describing each top-level section's offsets and depth, an integer index naming the source section to move, and an integer index naming where the section should be dropped before (entries.length meaning "after everything").
 * @outputs The same string with the selected section spliced to its new location, or the original string unchanged when the move is a no-op or impossible.
 * @functions
 *   - outlineSectionRange: Derives the half-open source-character range [start, end) covering one outline entry's heading line and whole subtree.
 *   - moveSection: Splices the section at fromIndex to just before toIndex within the document text, adjusting offsets for the removed span.
 * @dataflow OutlineEntry array + source text → outlineSectionRange bounds the moved subtree → moveSection validates indices and rejects self/near moves → slices out the section, normalises its trailing newline, recomputes the insertion offset against the shortened text, and splices it back in.
 * @controlflow Resolve src range (return text on null) → clamp toIndex (return text if invalid) → compute dstStart and refuse self-insertion or no-op positions → slice & newline-normalise section → build without → adjust offset for the removed span → concatenate reordered result.
 * @version 1
 * @date 2026-09-11
 */

import type { OutlineEntry } from './outline.js';

/**
 * A half-open range of source characters covering one outline entry's heading line and its whole subtree.
 */
export interface SectionRange {
  /** Offset of the heading line's first character. */
  readonly start: number;
  /** Offset one past the last character of the section, which is where the next sibling or the document ends. */
  readonly end: number;
}

/**
 * Expands a single outline entry into the source range that covers its heading line and every node nested beneath it.
 *
 * @purpose Returns the [start, end) character range of one section's whole subtree so a move can splice the entire section rather than just its title line.
 * @inputs entries - The readonly array of OutlineEntry records describing each top-level section.
 * @inputs index - The position in `entries` naming which entry to expand.
 * @inputs textLength - The length of the document source, used as the end bound when no later sibling bounds the section.
 * @outputs SectionRange | null - The subtree range, or null when index is out of range and there is nothing to describe.
 * @dataflow entries[index] → its start offset becomes the range start; a forward scan of later entries finds the first at-or-shallower depth whose start bounds the section, else textLength.
 * @controlflow Bounds-check index (return null on < 0, >= length, or undefined read) → take entry.start as start → linear forward scan → return first depth <= entry.depth's start → fall back to textLength.
 */
export function outlineSectionRange(
  entries: readonly OutlineEntry[],
  index: number,
  textLength: number
): SectionRange | null {
  // Reject an index below the start of the array; there is no entry at a negative position to describe.
  if (index < 0) {
    return null;
  }

  // Reject an index at or past the end of the array; it names a slot beyond the last section.
  if (index >= entries.length) {
    return null;
  }

  // Read the entry, guarding for noUncheckedIndexedAccess so an undefined slot is explicit rather than coerced.
  const entry = entries[index];

  // Reject when the indexed slot is undefined; a missing entry has no offsets and cannot be ranged.
  if (entry === undefined) {
    return null;
  }

  // The section always begins at its heading line's start offset in source text.
  const start = entry.start;

  // Walk every entry after this one to find where the subtree ends: it runs until a sibling at the same level or
  // shallower begins, because everything deeper than the entry belongs to it and nothing at-or-shallower does not.
  for (let i = index + 1; i < entries.length; i++) {
    const later = entries[i];

    // Check if a later sibling is at the same depth or shallower (a smaller depth number).
    if (later !== undefined && later.depth <= entry.depth) {
      // A closer-or-equal sibling bounds the section: its start offset is where this subtree ends.
      return { start, end: later.start };
    } else {
      // Deeper descendant: still part of this subtree, so keep scanning for a bounding sibling.
    }
  }

  // No later sibling bounded the section, so it runs to the very end of the document source.
  return { start, end: textLength };
}

/**
 * Moves one outline section to a new position within the document source text.
 *
 * @purpose Implements FR-9.1 drag-to-reorder by splicing the whole subtree of the entry at fromIndex so it appears just before the entry at toIndex, leaving every byte outside the two edits identical so the result round-trips cleanly against the outline.
 * @inputs text - The document source of record that will be returned with the section relocated.
 * @inputs entries - The readonly array of OutlineEntry records describing each top-level section's offsets and depth.
 * @inputs fromIndex - The position in `entries` naming the section to move.
 * @inputs toIndex - The position in `entries` naming where the section is dropped before; entries.length means "after everything".
 * @outputs string - The reordered source, or the original text unchanged when the move is a no-op or impossible.
 * @dataflow fromIndex → outlineSectionRange bounds the moved span → validate target and reject self/near moves → slice out the section, normalise its trailing newline, recompute the insertion offset against the shortened text, and splice it back in.
 * @controlflow Compute src range (return text on null) → clamp toIndex (return text if invalid) → compute dstStart (return text when inside self or already placed) → slice & newline-normalise section → build without → adjust offset for removed span → concatenate.
 */
export function moveSection(
  text: string,
  entries: readonly OutlineEntry[],
  fromIndex: number,
  toIndex: number
): string {
  // Resolve the moved section's subtree range; when it is null there is nothing valid to relocate.
  const src = outlineSectionRange(entries, fromIndex, text.length);

  // Check if there is no valid source range (an out-of-range fromIndex); there is nothing to move.
  if (src === null) {
    // Nothing to move: return the document untouched rather than fabricate a splice.
    return text;
  }

  // Reject a drop target that names no real position in the outline: before the start, or past "after everything".
  if (toIndex < 0 || toIndex > entries.length) {
    return text;
  }

  // Locate where the section would land: at the dropped-before entry's start offset, or the document end when appended after all sections.
  const dstStart = toIndex >= entries.length ? text.length : (entries[toIndex]?.start ?? text.length);

  // A section cannot be moved inside its own subtree; a drag onto one of its children lands here and must be refused.
  if (dstStart > src.start && dstStart < src.end) {
    return text;
  }

  // The section already sits at its destination: rewriting the whole document to produce an identical string would add a pointless entry to the undo history.
  if (dstStart === src.start) {
    return text;
  }

  // Extract exactly the moved subtree, from its heading line through its last descendant character.
  const slice = text.slice(src.start, src.end);

  // A section taken from the end of the file has no trailing newline; pasting it directly in front of another heading
  // would weld two headings onto one line and corrupt both, so ensure exactly one terminating newline here.
  let normalised: string;
  if (slice.endsWith('\n')) {
    // Already ends with a newline: keep the slice unchanged so an existing blank line after the section is preserved.
    normalised = slice;
  } else {
    // Missing trailing newline: append one so the moved section begins its own line in the new location.
    normalised = `${slice}\n`;
  }

  // Remove the moved section from the source, joining the text before and after it into one contiguous string.
  const without = text.slice(0, src.start) + text.slice(src.end);

  // Compute the reinsertion offset within `without`, not the original `text`: removing the section shifts every byte
  // after it left by its length, so an unadjusted offset would land that many characters too far along.
  let at: number;
  if (dstStart < src.start) {
    // The destination is before the removed span, so nothing shifted and the original offset still applies.
    at = dstStart;
  } else {
    // The destination was at or after the removed span, so subtract the section's length to account for the bytes taken out.
    at = dstStart - (src.end - src.start);
  }

  // Reinsert the normalised section at the adjusted offset and return the reordered document.
  return without.slice(0, at) + normalised + without.slice(at);
}
