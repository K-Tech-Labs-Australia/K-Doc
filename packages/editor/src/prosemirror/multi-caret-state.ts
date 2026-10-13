/**
 * @file multi-caret-state.ts
 * @purpose Pure state representations and transaction builders for multi-caret editing in the K-Doc pane (FR-7.2).
 *   Extra carets live in plugin state as document positions, while the primary caret remains state.selection;
 *   edits apply across all carets in single atomic transactions.
 *
 *   Invariant: extras are always ascending and distinct, and never include the primary position,
 *   because a caret that is also the selection would apply every edit twice.
 *
 * @inputs ProseMirror EditorState instances, MultiCaretState descriptors, document positions, mapping objects, and text/direction edit payloads.
 * @outputs MultiCaretState objects, normalized position arrays, and ProseMirror Transaction instances.
 * @functions
 *   - normaliseCarets: Sorts caret positions ascending and removes duplicates without mutating inputs.
 *   - mapCarets: Maps extra caret positions through a document mapping and re-normalises them.
 *   - toggleCaret: Adds or removes a caret position from extra carets, maintaining sorted distinct order.
 *   - allCaretPositions: Combines the primary selection caret with extra carets into a single sorted, deduplicated array.
 *   - insertAtCarets: Builds an atomic transaction inserting text at primary selection and all extra caret positions.
 *   - deleteAtCarets: Builds an atomic transaction deleting text back-to-front across carets, or null if no extras or no valid ranges.
 * @dataflow Document positions / edits -> MultiCaretState transforms -> EditorState transaction builders -> Transaction.
 * @controlflow State query / caret toggling / position mapping -> transaction construction with descending edits -> return transaction.
 * @version 1
 * @date 2026-09-12
 */

import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';

/** The extra caret positions, beyond the one in `state.selection`. */
export interface MultiCaretState {
  /** Document positions, ascending and distinct. */
  readonly extras: readonly number[];
}

/** The empty state: one caret, the ordinary one. */
export const EMPTY_MULTI_CARET: MultiCaretState = { extras: [] };

/**
 * Sorts caret positions in ascending order and removes duplicate positions.
 *
 * @purpose Produces a deduplicated, ascending list of caret positions without mutating input.
 * @inputs positions: readonly number[] - The input document positions to normalise.
 * @outputs readonly number[] - A new array of distinct positions in ascending order.
 * @dataflow positions -> copy -> sort ascending -> deduplicate adjacent -> readonly number[].
 * @controlflow Guard 0 or 1 element -> sort array copy ascending -> loop and deduplicate -> return new array.
 */
export function normaliseCarets(positions: readonly number[]): readonly number[] {
  // Check if the input positions array has at most one element.
  if (positions.length <= 1) {
    // Zero or one position: return a fresh shallow copy to avoid mutating or aliasing the input.
    return [...positions];
  } else {
    // Two or more positions: proceed with sorting and deduplicating.
  }

  // Sort ascending without mutating input: two carets at the same position are one caret,
  // and the ascending order is what lets every edit be applied back-to-front.
  const sorted: number[] = [...positions].sort(
    (a: number, b: number): number => a - b,
  );
  const result: number[] = [];

  // Iterate through sorted positions to deduplicate adjacent matching elements.
  for (let i = 0; i < sorted.length; i++) {
    const pos: number = sorted[i]!;
    // Check if result is empty or if current position is distinct from the last added position.
    // Two carets at the same position are one caret, and the order is what lets every edit be applied back-to-front.
    if (result.length === 0 || pos !== result[result.length - 1]!) {
      // Position is distinct: append to normalized result array.
      result.push(pos);
    } else {
      // Duplicate position found: skip to enforce distinct positions.
    }
  }

  return result;
}

/**
 * Maps each extra caret position through a position mapping and re-normalises the result.
 *
 * Note on typing: The mapping parameter is typed structurally as `{ map(pos: number): number }`
 * rather than as ProseMirror's `Mapping`, so this function can be tested in isolation
 * without constructing a ProseMirror transaction or document.
 *
 * @purpose Transforms all extra caret positions across document changes using a position mapping.
 * @inputs
 *   - state: MultiCaretState - The current multi-caret state containing extra positions.
 *   - mapping: { map(pos: number): number } - Structural mapping interface with a map method.
 * @outputs MultiCaretState - A new MultiCaretState with mapped and normalised extra positions.
 * @dataflow state.extras -> mapping.map(pos) -> normaliseCarets -> MultiCaretState.
 * @controlflow Check if extras array is empty -> map each position through mapping -> normalise -> return new MultiCaretState.
 */
export function mapCarets(
  state: MultiCaretState,
  mapping: { map(pos: number): number },
): MultiCaretState {
  // Check if there are any extra carets to map.
  if (state.extras.length === 0) {
    // No extra carets present: return EMPTY_MULTI_CARET to avoid unnecessary allocations.
    return EMPTY_MULTI_CARET;
  } else {
    // Extra carets present: map each position and re-normalise.
  }

  const mapped: number[] = state.extras.map(
    (pos: number): number => mapping.map(pos),
  );
  return { extras: normaliseCarets(mapped) };
}

/**
 * Toggles an extra caret position: removes it if already present, or adds and normalises it if absent.
 *
 * @purpose Adds or removes a caret position from extra carets, maintaining sorted distinct order.
 * @inputs
 *   - state: MultiCaretState - The current multi-caret state.
 *   - pos: number - The document position to toggle.
 * @outputs MultiCaretState - A new MultiCaretState reflecting the addition or removal.
 * @dataflow state.extras + pos -> presence check -> filter or append -> normaliseCarets -> MultiCaretState.
 * @controlflow Check if pos is in state.extras -> if present, remove; if absent, add and normalise -> return new state.
 */
export function toggleCaret(state: MultiCaretState, pos: number): MultiCaretState {
  // Check whether pos is already present in state.extras.
  // Ctrl+clicking a caret you already placed is how you take it back.
  if (state.extras.includes(pos)) {
    // Position already exists: Ctrl+clicking takes it back; remove pos from extras.
    return {
      extras: state.extras.filter((p: number): boolean => p !== pos),
    };
  } else {
    // Position not present: Ctrl+clicking adds a new caret; append pos and normalise.
    return {
      extras: normaliseCarets([...state.extras, pos]),
    };
  }
}

/**
 * Combines the primary caret position with extra caret positions into a single sorted, deduplicated array.
 *
 * @purpose Merges the primary selection position with plugin extras for unified multi-caret operations.
 * @inputs
 *   - primary: number - The primary caret document position (from state.selection).
 *   - extras: readonly number[] - Extra caret document positions stored in plugin state.
 * @outputs readonly number[] - Sorted and deduplicated array of all caret positions.
 * @dataflow primary + extras -> array merge -> normaliseCarets -> readonly number[].
 * @controlflow Concatenate primary with extras -> pass to normaliseCarets -> return sorted array.
 */
export function allCaretPositions(
  primary: number,
  extras: readonly number[],
): readonly number[] {
  // The primary caret is not stored in the plugin state, so every operation has to put it back
  // before acting — an edit that skipped it would type everywhere except where the user is looking.
  return normaliseCarets([primary, ...extras]);
}

/**
 * Builds a single atomic transaction inserting text at the primary selection and all extra caret positions.
 *
 * @purpose Inserts text across primary and extra carets in back-to-front order in a single undoable transaction.
 * @inputs
 *   - state: EditorState - The current editor state containing document and selection.
 *   - extras: readonly number[] - Extra caret positions from multi-caret state.
 *   - text: string - The text string to insert at each caret.
 * @outputs Transaction - The constructed ProseMirror transaction ready for dispatch.
 * @dataflow state + extras + text -> range assembly & deduplication -> descending sort -> tr.insertText -> selection reset -> Transaction.
 * @controlflow Collect primary and extra ranges -> drop extras within primary range -> sort descending -> insert text back-to-front -> reposition primary selection -> return tr.
 */
export function insertAtCarets(
  state: EditorState,
  extras: readonly number[],
  text: string,
): Transaction {
  const tr: Transaction = state.tr;
  const primaryFrom: number = state.selection.from;
  const primaryTo: number = state.selection.to;

  const ranges: { from: number; to: number }[] = [
    { from: primaryFrom, to: primaryTo },
  ];

  // Iterate through extra caret positions to assemble insertion ranges.
  for (let i = 0; i < extras.length; i++) {
    const pos: number = extras[i]!;
    // Check if the extra caret position falls inside the primary selection range.
    // Any extra whose from falls inside the primary range (>= primary.from && <= primary.to)
    // is dropped because it would be deleted by the primary replacement anyway,
    // and applying twice would double the text.
    if (pos >= primaryFrom && pos <= primaryTo) {
      // Extra falls inside primary range: drop to prevent duplicate insertion.
      continue;
    } else {
      // Extra falls outside primary range: keep as a collapsed insertion range { from: pos, to: pos }.
      ranges.push({ from: pos, to: pos });
    }
  }

  // Sort the insertion ranges descending by from position.
  // Applying back-to-front means each edit's position is still valid when its turn comes,
  // because an edit at a higher position cannot move a lower one.
  ranges.sort(
    (
      a: { from: number; to: number },
      b: { from: number; to: number },
    ): number => b.from - a.from,
  );

  // Iterate through insertion ranges in descending order and insert text at each range.
  for (let i = 0; i < ranges.length; i++) {
    const range: { from: number; to: number } = ranges[i]!;
    tr.insertText(text, range.from, range.to);
  }

  // Put the primary selection back where the user would expect it: at the end of the text inserted at
  // the primary position.
  //
  // Mapping the original start position is the whole answer. tr.mapping.map defaults to an association
  // of +1, which carries a position at the start of an edit to the far side of it -- so it already
  // lands after the text just inserted there, and after any insertion at an earlier caret that pushed
  // the primary along. Adding text.length on top counted the same characters twice and left the caret
  // one word-length too far right on every keystroke.
  //
  // The clamp is still needed: tr.doc is the document after every step, and a position past its end
  // throws inside TextSelection.create.
  const clampedTargetPos: number = Math.min(tr.mapping.map(primaryFrom), tr.doc.content.size);
  tr.setSelection(TextSelection.create(tr.doc, clampedTargetPos));

  return tr;
}

/**
 * Builds a single atomic transaction deleting characters across all carets in the specified direction.
 *
 * @purpose Deletes characters back-to-front across primary and extra carets for Backspace or Delete.
 * @inputs
 *   - state: EditorState - The current editor state containing document and selection.
 *   - extras: readonly number[] - Extra caret positions from multi-caret state.
 *   - direction: -1 | 1 - Direction of deletion: -1 for Backspace (backward), 1 for Delete (forward).
 * @outputs Transaction | null - The constructed transaction, or null if no extras or no ranges survive.
 * @dataflow state + extras + direction -> range construction -> document bounds filtering -> descending sort -> tr.delete -> Transaction | null.
 * @controlflow Return null if extras empty -> build primary & extra delete ranges -> drop out-of-bounds ranges -> return null if empty -> delete back-to-front -> return tr.
 */
export function deleteAtCarets(
  state: EditorState,
  extras: readonly number[],
  direction: -1 | 1,
): Transaction | null {
  // Check whether any extra carets are active.
  // When extras.length === 0, return null: there is nothing multi-caret about this,
  // so the ordinary single-caret command should handle it. Returning null is how the caller says "not mine".
  if (extras.length === 0) {
    // No extra carets present: decline handling and yield to standard single-caret deletion commands.
    return null;
  } else {
    // Extra carets present: proceed with multi-caret deletion calculation.
  }

  const sel = state.selection;
  let primaryRange: { from: number; to: number };

  // Check whether the primary selection is collapsed (empty).
  if (sel.empty) {
    // Primary selection is collapsed: determine single-character delete range based on direction.
    // Direction -1 (Backspace) deletes [sel.from - 1, sel.from]; direction 1 (Delete) deletes [sel.from, sel.from + 1].
    primaryRange =
      direction === -1
        ? { from: sel.from - 1, to: sel.from }
        : { from: sel.from, to: sel.from + 1 };
  } else {
    // Primary selection is non-empty: delete the selected range directly.
    primaryRange = { from: sel.from, to: sel.to };
  }

  const rawRanges: { from: number; to: number }[] = [primaryRange];

  // Iterate through extra carets and compute single-character delete ranges according to direction.
  for (let i = 0; i < extras.length; i++) {
    const pos: number = extras[i]!;
    rawRanges.push(
      direction === -1
        ? { from: pos - 1, to: pos }
        : { from: pos, to: pos + 1 },
    );
  }

  const docSize: number = state.doc.content.size;
  const validRanges: { from: number; to: number }[] = [];

  // Iterate through raw deletion ranges and filter against document content boundaries.
  for (let i = 0; i < rawRanges.length; i++) {
    const r: { from: number; to: number } = rawRanges[i]!;
    // Check whether the range falls outside valid document boundaries (from < 0 or to > state.doc.content.size).
    // A Backspace at the very start of the document has nothing to delete,
    // and a range outside the document throws inside ProseMirror.
    if (r.from < 0 || r.to > docSize) {
      // Range falls outside document bounds: drop it.
      continue;
    } else {
      // Range is within valid document bounds: retain for deletion.
      validRanges.push(r);
    }
  }

  // Check whether any deletion ranges survived boundary filtering.
  if (validRanges.length === 0) {
    // No ranges survive: nothing to delete, return null.
    return null;
  } else {
    // At least one valid range survived: sort descending and execute deletions.
  }

  // Sort ranges descending by from position.
  // Applying deletions back-to-front ensures that earlier positions remain valid across transactions,
  // as deletions at higher offsets do not shift lower offsets.
  validRanges.sort(
    (
      a: { from: number; to: number },
      b: { from: number; to: number },
    ): number => b.from - a.from,
  );

  const tr: Transaction = state.tr;

  // Iterate through valid ranges in descending order and delete each slice.
  for (let i = 0; i < validRanges.length; i++) {
    const range: { from: number; to: number } = validRanges[i]!;
    tr.delete(range.from, range.to);
  }

  // Deliberately do NOT set the selection: deleting leaves the primary caret where
  // ProseMirror's own mapping puts it, which is the position the deleted character occupied.
  return tr;
}
