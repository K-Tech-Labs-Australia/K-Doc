/**
 * @file compare.ts
 * @purpose Compare Documents (FR-11.7): expresses the difference between an older and a newer text as tracked changes over the newer text, so the Review pane can accept or reject each one; rejecting all of them gives back the older text.
 * @inputs the older and newer texts, an author, an id source, a clock
 * @outputs TrackedChange records
 * @functions compareAsChanges - converts two texts into tracked changes over the newer text.
 * @dataflow diffWords(older, newer) -> runs -> deletions anchored at their seam and insertions over their characters in the newer text
 * @controlflow one pass over the runs keeping the offset in the newer text
 * @version 1
 * @date 2026-09-16
 */

import { diffWords } from '../history/word-diff.js';
import { createDeletion, createInsertion, type TrackedChange } from './change.js';

/**
 * @purpose Compare Documents (FR-11.7): expresses the difference between an older and a newer text as tracked changes over the newer text.
 * @inputs older - the original text; newer - the revised text that all changes are anchored in; author - name recorded on each change; newId - id source producing a unique id per change; now - timestamp shared by every change (defaults to the current time).
 * @outputs readonly TrackedChange[] - deletions and insertions describing how older becomes newer, ordered as diffWords emits them.
 * @dataflow diffWords(older, newer) produces equal/delete/insert runs; each run is converted into a deletion anchored at its seam or an insertion spanning the newer text's characters while advancing a running offset in the newer text.
 * @controlflow Iterate once over the runs: advance the offset on equal and insert runs, record deletions without moving it, then return all collected changes.
 */
export function compareAsChanges(older: string, newer: string, author: string, newId: () => string, now: Date = new Date()): readonly TrackedChange[] {
  const changes: TrackedChange[] = [];
  let position = 0; // Offset in the newer text, which is the text the changes are anchored in.
  for (const part of diffWords(older, newer)) {
    // Equal run: the text exists in both older and newer texts, so it is not a change; only advance the offset that anchors subsequent changes in the newer text.
    if (part.kind === 'equal') {
      position += part.text.length;
    } else if (part.kind === 'delete') {
      // Delete run: the text exists only in the older text, so it has no characters in the newer text. Record a deletion anchored at the current seam; because it occupies no newer-text characters, the offset does not move. diffWords emits the deletion before the insertion that replaces it, matching the order the recorder uses.
      changes.push(createDeletion(newId(), part.text, newer, position, author, now));
    } else {
      // Insert run: the text exists only in the newer text at the current offset, so record an insertion spanning those characters and advance the offset past them. This is the final branch because diffWords emits only equal, delete, or insert runs; every change shares one timestamp because they come from one comparison.
      changes.push(createInsertion(newId(), part.text, newer, position, author, now));
      position += part.text.length;
    }
  }
  return changes;
}
