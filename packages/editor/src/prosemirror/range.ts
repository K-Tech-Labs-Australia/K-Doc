/**
 * @file range.ts
 * @purpose Pure ProseMirror range trimming utilities for K-Doc editor mark commands. A browser's double-click
 *   selects a word plus its trailing space. Applying a mark to that raw selection produces `[word ](url)` for
 *   a link and a padded span for inline code. Strong and emphasis hide the problem because Markdown cannot
 *   represent a trailing space inside them, so the serializer silently moves it out — which is precisely why
 *   the bug went unnoticed until a link exposed it. Word-processor behaviour, and the behaviour users expect,
 *   is that formatting applies to the word, not to the whitespace that happened to come with it.
 * @inputs ProseMirror EditorState instances and raw document selection ranges [from, to).
 * @outputs Trimmed selection ranges { from: number; to: number } stripped of leading and trailing whitespace.
 * @functions
 *   - trimRange: Returns a range with leading and trailing whitespace removed from [from, to).
 * @dataflow EditorState + raw [from, to) -> textblock parent verification -> text extraction with separators -> whitespace boundary scanning -> trimmed { from, to }.
 * @controlflow Guard empty range -> resolve $from/$to -> verify single textblock parent -> extract textBetween -> scan leading whitespace -> scan trailing whitespace -> guard all-whitespace -> return adjusted range.
 * @version 1
 * @date 2026-09-05
 */

import type { EditorState } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';

/**
 * Regular expression matching any whitespace character.
 */
const WHITESPACE = /\s/;

/**
 * @purpose Returns a range with leading and trailing whitespace removed from `[from, to)`.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state containing the document.
 *   - from: number - The start position of the candidate range.
 *   - to: number - The end position of the candidate range.
 * @outputs { from: number; to: number } - The range stripped of leading and trailing whitespace, or unchanged if invalid or all-whitespace.
 * @dataflow state.doc resolved at from/to -> verify single textblock -> textBetween extraction -> scan whitespace -> calculate adjusted positions.
 * @controlflow Guard empty range (to <= from) -> resolve positions -> verify $from.parent === $to.parent and isTextblock -> extract text -> scan leading whitespace -> scan trailing whitespace -> guard all-whitespace -> return adjusted range.
 */
export function trimRange(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } {
  // Check whether the input range is empty or inverted.
  if (to <= from) {
    // Empty or inverted range has nothing to trim: return unchanged range.
    return { from, to };
  } else {
    // Range contains at least one position: proceed to resolve positions.
  }

  const $from: ResolvedPos = state.doc.resolve(from);
  const $to: ResolvedPos = state.doc.resolve(to);

  // Bail out unless the range lies inside a single textblock. Only within one textblock do document
  // positions advance one per character, so only there can a character index be added to a position.
  // Across blocks, node boundaries contribute to positions and the arithmetic below would be wrong.
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) {
    // Range crosses block boundaries or is not within a textblock: return unchanged range.
    return { from, to };
  } else {
    // Range is strictly contained within a single textblock: character offset arithmetic is valid.
  }

  // Extract text within the range. Passing '\n' as block separator and '￼' (object replacement character)
  // as leaf node separator keeps the string length exactly equal to (to - from), so character index arithmetic
  // stays aligned with document positions.
  const text = state.doc.textBetween(from, to, '\n', '￼');

  let leading = 0;
  // Count leading whitespace characters walking forwards from index 0.
  while (leading < text.length) {
    const ch: string | undefined = text[leading];
    // Guard the indexed access because noUncheckedIndexedAccess types text[i] as string | undefined.
    if (ch !== undefined && WHITESPACE.test(ch)) {
      // Character is whitespace: advance leading whitespace count.
      leading += 1;
    } else {
      // Non-whitespace character encountered or index out of bounds: stop scanning leading whitespace.
      break;
    }
  }

  let trailing = 0;
  // Count trailing whitespace characters walking backwards from text.length - 1, stopping when meeting the leading walk.
  while (trailing < text.length - leading) {
    const index = text.length - 1 - trailing;
    const ch: string | undefined = text[index];
    // Guard the indexed access because noUncheckedIndexedAccess types text[i] as string | undefined.
    if (ch !== undefined && WHITESPACE.test(ch)) {
      // Character is whitespace: advance trailing whitespace count.
      trailing += 1;
    } else {
      // Non-whitespace character encountered or met leading walk: stop scanning trailing whitespace.
      break;
    }
  }

  // If leading + trailing is >= text.length, the range is entirely whitespace.
  if (leading + trailing >= text.length) {
    // Entire range is whitespace: return unchanged range so caller mark command does not silently do nothing.
    return { from, to };
  } else {
    // Range contains non-whitespace content: apply trimmed offsets.
  }

  return { from: from + leading, to: to - trailing };
}
