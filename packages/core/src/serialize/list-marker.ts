/**
 * @file list-marker.ts
 * @purpose Reads the marker a list item was written with -- its bullet character, or its number and delimiter -- so an item re-emitted beside untouched siblings uses the same marker and stays in the same list (FR-4.2).
 * @inputs Document text and the offset where a list item starts.
 * @outputs A ListMarker, or null when no list marker starts at the offset.
 * @functions
 *   - listMarker: Reads the bullet or ordered marker at an offset.
 * @dataflow text + offset -> twelve-character head -> bullet or ordered pattern -> ListMarker or null.
 * @controlflow Try the bullet pattern, then the ordered pattern, else null.
 * @version 1
 * @date 2026-09-14
 */

export type ListMarker =
  | { readonly kind: 'bullet'; readonly marker: '-' | '*' | '+' }
  | { readonly kind: 'ordered'; readonly number: number; readonly delimiter: '.' | ')' };

/** A bullet followed by a space, a tab, a line break or the end of the text. */
const BULLET_MARKER = /^([*+-])(?:[ \t]|\r?\n|$)/;

/** One to nine digits and a '.' or ')' followed by a space, a tab, a line break or the end of the text. */
const ORDERED_MARKER = /^(\d{1,9})([.)])(?:[ \t]|\r?\n|$)/;

/**
 * Reads the list marker (bullet character, or ordered number and delimiter) that begins at an offset.
 * @purpose Extracts a ListMarker from the document text at the given start offset so re-emitted items keep their sibling's marker.
 * @inputs text - The full document text being scanned.
 * @inputs offset - The character offset where the list item starts.
 * @outputs A ListMarker describing the bullet or ordered marker, or null when none begins at the offset.
 * @dataflow Slices a twelve-character head from text at offset -> matches it against BULLET_MARKER then ORDERED_MARKER -> returns the parsed ListMarker or null.
 * @controlflow Slice the head; try the bullet pattern first and return on match; otherwise try the ordered pattern; return null when neither matches.
 */
export function listMarker(text: string, offset: number): ListMarker | null {
  const head = text.slice(offset, offset + 12);
  const bullet = BULLET_MARKER.exec(head);
  // A single bullet character begins a bulleted list item.
  if (bullet !== null) {
    const marker = bullet[1];
    // The pattern only captures '-', '*', or '+', so accept any captured value as a valid bullet.
    if (marker === '-' || marker === '*' || marker === '+') {
      return { kind: 'bullet', marker };
    } else {
      // Cannot happen: the regex never captures anything other than these three characters.
      return null;
    }
  } else {
    // Not a bullet item; fall through and try an ordered marker instead.
  }
  const ordered = ORDERED_MARKER.exec(head);
  if (ordered !== null) {
    const digits = ordered[1];
    const delimiter = ordered[2];
    // The pattern guarantees the delimiter is '.' or ')', so accept any captured value as valid.
    if (digits !== undefined && (delimiter === '.' || delimiter === ')')) {
      return { kind: 'ordered', number: Number.parseInt(digits, 10), delimiter };
    } else {
      // Cannot happen: the regex always captures a digit group and one of the two delimiters.
      return null;
    }
  } else {
    // No ordered marker matched either; there is no list marker at this offset.
    return null;
  }
}
