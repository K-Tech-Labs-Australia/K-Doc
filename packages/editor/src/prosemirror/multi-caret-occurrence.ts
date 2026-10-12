/**
 * @file multi-caret-occurrence.ts
 * @purpose Implements the Ctrl+D "add a caret at the next occurrence" command for the WYSIWYG pane (FR-7.2).
 *   Locates words around carets, identifies whole-word occurrences across textblocks, and manages multi-caret transactions.
 * @inputs ProseMirror EditorState instances, document positions, word strings, and user keystroke commands.
 * @outputs WordAt descriptors, document occurrence positions, and ProseMirror Command implementations.
 * @functions
 *   - wordAround: Finds the word the given position sits inside or beside within a textblock.
 *   - findOccurrence: Locates the document start position of the next whole-word occurrence of a word after an anchor.
 *   - addNextOccurrence: Command adding a caret at the next occurrence or selecting the word under the caret.
 * @dataflow EditorState + position -> word resolution / AST textblock scan -> occurrence document position -> multi-caret transaction dispatch.
 * @controlflow Resolve word under primary selection -> if collapsed select word; if selected find next whole-word hit -> dispatch multiCaretPluginKey toggle.
 * @version 1
 * @date 2026-09-12
 */

import { TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { multiCaretPluginKey, extraCarets } from './multi-caret-plugin.js';

/** The word under a caret, and where it sits. */
export interface WordAt {
  readonly word: string;
  readonly from: number;
  readonly to: number;
}

/**
 * What counts as part of a word. Letters, digits, underscore and hyphen -- the last because
 * hyphenated words read as one word to a person, and Ctrl+D is a person's tool.
 *
 * Because the regex has no 'g' flag it holds no lastIndex state, so reusing the module-level instance is safe.
 */
const WORD_CHAR: RegExp = /[\p{L}\p{N}_-]/u;

/**
 * Finds the word that the given position sits inside or beside within a textblock.
 *
 * @purpose Resolves a document position to surrounding whole-word boundaries and text content.
 * @inputs
 *   - state: EditorState - The ProseMirror editor state containing document structure.
 *   - pos: number - The document position to resolve.
 * @outputs WordAt | null - WordAt descriptor with text and document bounds, or null if not in a word.
 * @dataflow pos -> state.doc.resolve -> parent textblock -> scan left and right with WORD_CHAR -> WordAt | null.
 * @controlflow Resolve position -> check if parent is textblock -> scan left and right -> verify non-empty span -> return WordAt or null.
 */
export function wordAround(state: EditorState, pos: number): WordAt | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;

  // Check whether the parent node containing the position is a textblock.
  if (!parent.isTextblock) {
    // A position inside a table or a list container is not inside any text, so there is no word there.
    return null;
  } else {
    // The position resides within a textblock: proceed to inspect its text content.
  }

  const start: number = $pos.start();
  const text: string = parent.textContent;
  const offset: number = pos - start;

  let left: number = offset;
  let right: number = offset;

  // Walk left from the offset while the preceding character is a word character.
  // Reusing the module-level WORD_CHAR regex is safe because it lacks the 'g' flag and holds no lastIndex state.
  while (left > 0 && WORD_CHAR.test(text.charAt(left - 1))) {
    left--;
  }

  // Walk right from the offset while the character at the cursor is a word character.
  // Reusing the module-level WORD_CHAR regex is safe because it lacks the 'g' flag and holds no lastIndex state.
  while (right < text.length && WORD_CHAR.test(text.charAt(right))) {
    right++;
  }

  // Check whether the resulting span is empty (no word characters were found).
  if (left >= right) {
    // Resulting span is empty: no word exists at or adjacent to the position.
    return null;
  } else {
    // Non-empty span found: return the word string and its absolute document bounds.
    return {
      word: text.slice(left, right),
      from: start + left,
      to: start + right,
    };
  }
}

/**
 * Picks the next occurrence position from a sorted list of hit positions.
 *
 * @purpose Selects the next occurrence greater than the anchor position, wrapping to the start if needed.
 * @inputs
 *   - hits: readonly number[] - Sorted array of document positions where the word occurs.
 *   - after: number - The reference document position to search forward from.
 * @outputs number | null - The next position, or null if no valid occurrence exists.
 * @dataflow hits + after -> linear search for hit > after -> fallback wrap to hits[0] -> number | null.
 * @controlflow Guard empty hits -> find first hit > after -> if found return hit -> else check wrap against hits[0] -> return null if only hit is at after.
 */
function pickNext(hits: readonly number[], after: number): number | null {
  // Check whether the hits array is empty.
  if (hits.length === 0) {
    // No occurrences found: return null.
    return null;
  } else {
    // Occurrences exist: search for the first occurrence strictly greater than after.
  }

  // Iterate through occurrences to find the first position strictly greater than after.
  for (let i = 0; i < hits.length; i++) {
    const hit: number = hits[i]!;
    // Check whether the current hit is strictly greater than after.
    if (hit > after) {
      // First forward occurrence found: return its position.
      return hit;
    } else {
      // Current hit is at or before after: continue searching forward.
    }
  }

  // No occurrence exists after the reference position: wrap around to the first occurrence overall.
  const firstHit: number = hits[0]!;
  // Check whether the only hit is at after itself.
  if (firstHit === after) {
    // The only hit is at after itself: return null.
    return null;
  } else {
    // Wrapped around to the first occurrence at the top of the document.
    return firstHit;
  }
}

/**
 * Finds the document position where the start of the next whole-word occurrence of word sits.
 *
 * @purpose Searches forward from after and wraps to the top of the document for whole-word hits.
 * @inputs
 *   - state: EditorState - The ProseMirror editor state to search.
 *   - word: string - The whole-word string to locate.
 *   - after: number - The document position to search forward from.
 * @outputs number | null - Start document position of next whole-word occurrence, or null if none.
 * @dataflow state.doc -> descendants textblock search -> indexOf whole-word matching -> pickNext -> number | null.
 * @controlflow Guard empty word -> walk textblocks via doc.descendants -> collect whole-word hits -> delegate to pickNext.
 */
export function findOccurrence(
  state: EditorState,
  word: string,
  after: number,
): number | null {
  // Check whether the search word is empty.
  if (word.length === 0) {
    // An empty word has no valid occurrences: return null.
    return null;
  } else {
    // Search word is non-empty: proceed to scan document textblocks.
  }

  const hits: number[] = [];

  state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // Check whether the current node is a textblock.
    if (!node.isTextblock) {
      // Skip nodes that are not textblocks; return true to descend into child nodes.
      return true;
    } else {
      // Node is a textblock: search node.textContent for word occurrences.
    }

    const text: string = node.textContent;
    let index: number = text.indexOf(word);

    // Search node.textContent for word with indexOf in a loop.
    while (index !== -1) {
      const prevChar: string = index > 0 ? text.charAt(index - 1) : '';
      const hasWordCharBefore: boolean =
        prevChar.length > 0 && WORD_CHAR.test(prevChar);

      const nextOffset: number = index + word.length;
      const nextChar: string =
        nextOffset < text.length ? text.charAt(nextOffset) : '';
      const hasWordCharAfter: boolean =
        nextChar.length > 0 && WORD_CHAR.test(nextChar);

      // A hit counts only when it is a whole word: the character before and the character after
      // must fail WORD_CHAR.test(...), or be absent.
      // Without that, adding the next 'in' would land inside 'point', 'into' and 'binding'.
      if (!hasWordCharBefore && !hasWordCharAfter) {
        // Whole-word match confirmed: convert text offset to document position.
        // The + 1 steps over the textblock's own opening token.
        hits.push(pos + 1 + index);
      } else {
        // Substring match only (preceded or followed by word characters): skip this occurrence.
      }

      index = text.indexOf(word, index + 1);
    }

    // Finished inspecting textblock text content: return false to avoid descending into inline children.
    return false;
  });

  return pickNext(hits, after);
}

/**
 * Command implementing the Ctrl+D "add a caret at the next occurrence" feature (FR-7.2).
 *
 * @purpose Selects the word under the caret or adds an extra caret at the next whole-word occurrence.
 * @inputs None.
 * @outputs Command - A ProseMirror command returning true if handled, false otherwise.
 * @dataflow state.selection -> wordAround or textBetween -> findOccurrence -> state.tr.setMeta -> dispatch.
 * @controlflow Check selection empty: if so, select wordAround -> else extract selected text term -> find occurrence after last caret -> dispatch toggle transaction.
 */
export function addNextOccurrence(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const sel = state.selection;

    // Check whether the primary selection is collapsed (empty caret).
    if (sel.empty) {
      const found: WordAt | null = wordAround(state, sel.from);
      // Check whether a word was found around the current caret position.
      if (found === null) {
        // Nothing to match, so the keystroke falls through.
        return false;
      } else {
        // Word found around caret: check whether extra carets already exist.
      }

      const extras: readonly number[] = extraCarets(state);
      // Check whether there are no extra carets yet.
      if (extras.length === 0) {
        // When it is found and there are no extras yet, select the word rather than adding a caret.
        // The first Ctrl+D selects what you are on, and the second starts adding -- matching what every other editor does,
        // and giving the user something to see before anything is duplicated.
        if (dispatch !== undefined) {
          dispatch(
            state.tr.setSelection(
              TextSelection.create(state.doc, found.from, found.to),
            ),
          );
        } else {
          // Dry run without dispatch: return true indicating command is enabled.
        }
        return true;
      } else {
        // Extra carets already exist with collapsed primary selection: cannot determine search term from collapsed selection.
        return false;
      }
    } else {
      // Primary selection is non-empty: extract search term from selected text.
    }

    const term: string = state.doc.textBetween(sel.from, sel.to);
    // Check whether the search term is empty or contains a newline character.
    if (term.length === 0 || term.includes('\n')) {
      // A search term spanning a block boundary is not a word, so return false.
      return false;
    } else {
      // Valid search term identified: proceed to locate anchor and search for next occurrence.
    }

    const extras: readonly number[] = extraCarets(state);
    let anchor: number;

    // Check whether there are active extra carets to search from.
    if (extras.length === 0) {
      // No extra carets present: search forward from the end of the primary selection.
      anchor = sel.to;
    } else {
      // Extra carets present: search from the last caret so repeated presses walk forward.
      // Math.max is computed with explicit guard rather than relying on an empty spread returning -Infinity.
      anchor = Math.max(sel.to, ...extras);
    }

    const at: number | null = findOccurrence(state, term, anchor);

    // Check whether a next occurrence was found in the document.
    if (at === null) {
      // Every occurrence already has a caret, so there is nothing to add and the keystroke should not appear to work.
      return false;
    } else {
      // Next occurrence found at document position 'at': dispatch multi-caret addition if dispatch is provided.
    }

    // Check whether a dispatch callback was provided for this command execution.
    if (dispatch !== undefined) {
      // Dispatch provided: attach position metadata to transaction and dispatch.
      dispatch(state.tr.setMeta(multiCaretPluginKey, at));
    } else {
      // Dry run without dispatch: return true indicating command is enabled.
    }

    return true;
  };
}
