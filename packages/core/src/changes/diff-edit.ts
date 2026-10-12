/**
 * @file diff-edit.ts
 * @purpose Turns a text transition ("the text went from A to B") into the insert and delete operations that describe it, per requirement FR-11.1. It computes the common prefix and suffix of two strings, then emits a single delete (for the characters between them) followed by a single insert (for the new characters).
 * @inputs before - The document text prior to an edit; after - The document text following the edit. Both are plain UTF-16 strings indexed by character offset.
 * @outputs A readonly array of RecordedEdit operations, each carrying its kind ('delete' or 'insert'), the affected text, and its offset in the new text.
 * @functions
 *   - commonPrefixLength: Counts leading characters shared by two strings up to the shorter length.
 *   - commonSuffixLength: Counts trailing characters shared by two strings without overlapping an already-matched prefix.
 *   - diffEdit: Reduces a before/after pair into delete-then-insert RecordedEdits.
 * @dataflow before and after → commonPrefixLength/commonSuffixLength produce p and s → slice extracts removed and added → RecordedEdits assembled in offset order.
 * @controlflow Compare for equality (early return) → compute prefix length → compute suffix bounded by that prefix → slice out the changed region → emit delete then insert only when each side is non-empty.
 * @note Known limitation: this is a single-range diff, so one transaction that touches several disjoint ranges — a multi-caret edit, say — is recorded as one change spanning from the first difference to the last, including the untouched text between. That is correct in the sense that rejecting it restores the original, but coarser than the user's actual edit; a multi-range diff would sharpen it later.
 * @version 1
 * @date 2026-09-07
 */

import type { ChangeKind } from './anchor.js';

export interface RecordedEdit {
  readonly kind: ChangeKind;
  /** The characters inserted, or the characters removed. */
  readonly text: string;
  /**
   * Offset in the **new** text. For an insertion, where its characters begin. For a deletion, the seam
   * they left behind. Both are expressed against the text as it stands after the edit, because that is
   * the document a change anchor is later resolved against.
   */
  readonly at: number;
}

/**
 * @purpose Counts the leading characters that two strings share, stopping at whichever string is shorter.
 * @inputs a - The first string to compare; b - The second string to compare.
 * @outputs number - The count of matching leading characters (0 when the first characters differ).
 * @dataflow Walks both strings in lockstep from index 0 while their characters match, returning how far that run extends.
 * @controlflow Advances an index while it stays within both lengths and the characters are equal; returns once a mismatch or end is reached.
 */
export function commonPrefixLength(a: string, b: string): number {
  let i = 0; // Shared offset into both strings as they are compared from the front.
  const limit = Math.min(a.length, b.length); // Cannot match beyond the shorter string's length.
  while (i < limit && a[i] === b[i]) {
    // Characters agree at this position: extend the matched prefix by one and advance.
    i++;
  }
  // Either strings diverged or the shorter one was exhausted; `i` is the shared leading run length.
  return i;
}

/**
 * @purpose Counts the trailing characters that two strings share, walking backwards from each end without overlapping an already-matched prefix.
 * @inputs a - The first string to compare; b - The second string to compare; skip - The length of the common prefix already matched elsewhere (see diffEdit).
 * @outputs number - The count of matching trailing characters that do not fall within the shared prefix region.
 * @dataflow Walks both strings from their ends toward index `skip`, counting how far the match extends before hitting the prefix boundary or a mismatch.
 * @controlflow Advances while each string still has more than `skip` characters remaining and its last unmatched character matches; returns once that guard fails.
 */
export function commonSuffixLength(a: string, b: string, skip: number): number {
  // `skip` is the length of the common prefix already matched by diffEdit; it bounds how far back this suffix walk may go. Without this bound the prefix and suffix would overlap on an input like `'aa'` → `'aaa'`, double-counting the same characters and producing a nonsensical range.
  let count = 0; // Number of trailing characters matched so far, walking from each end toward index `skip`.
  while (a.length - count > skip && b.length - count > skip && a[a.length - count - 1] === b[b.length - count - 1]) {
    // Both strings still have unmatched room past the prefix and their current trailing characters agree: extend the suffix match by one.
    count++;
  }
  return count;
}

/**
 * @purpose Reduces a text transition into the delete-then-insert RecordedEdits that describe exactly what changed between two versions of a document.
 * @inputs before - The document text prior to an edit; after - The document text following the edit. Offsets in every emitted RecordedEdit are expressed against `after` (the new text).
 * @outputs A readonly array of RecordedEdits: at most one 'delete' followed by at most one 'insert', each carrying its offset and affected characters. Empty when no change occurred.
 * @dataflow before/after → commonPrefixLength/commonSuffixLength yield the shared boundaries p and s → slice isolates removed and added text → two RecordedEdits are assembled against the new-text coordinate system.
 * @controlflow Early-return on equality → compute prefix length → compute suffix bounded by that prefix → slice out the changed region → emit delete then insert only when each side is non-empty.
 */
export function diffEdit(before: string, after: string): readonly RecordedEdit[] {
  if (before === after) {
    // Identical text means nothing was edited; a session can fire for reasons other than a text change, so this pair is normal rather than a caller error.
    return [];
  }

  const p = commonPrefixLength(before, after); // Shared leading characters that precede any edit.
  const s = commonSuffixLength(before, after, p); // Trailing characters shared after the edit, bounded by `p` so prefix and suffix cannot overlap.
  const removed = before.slice(p, before.length - s); // Characters present in `before` but absent from `after`.
  const added = after.slice(p, after.length - s); // Characters present in `after` but not in `before`.

  const edits: RecordedEdit[] = []; // Assembled against the new-text coordinate system; every offset is a position within `after`.

  // Both operations share offset p because the deletion has no width in the new text: the inserted characters occupy [p, p + added.length) and the deleted region leaves its seam at the point immediately before them.
  if (removed.length > 0) {
    // A non-empty removed range means `before` held text that `after` dropped; record it as a deletion at offset p.
    edits.push({ kind: 'delete', text: removed, at: p });
  }

  // The insert is emitted after the delete so a replacement — text selected and typed over that yields both operations — shows removed text before what replaced it, which is the order Word displays a revision in.
  if (added.length > 0) {
    edits.push({ kind: 'insert', text: added, at: p });
  }

  return edits;
}
