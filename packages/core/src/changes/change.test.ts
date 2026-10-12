import { describe, expect, it } from 'vitest';
import {
  createInsertion,
  createDeletion,
  resolveChange,
  applyDecision,
  applyDecisions,
} from './change.js';

/**
 * @file change.test.ts
 * @purpose Vitect suite for the tracked-change model in ./change.js: it exercises insertion/deletion construction, accept/reject round trips (reject restores prior state while accept never edits), re-resolution against untouched and edited documents, descending-order batch rejection, and the recorded shape of each change. Every assertion is a real expect; no early-return guards are used so that a resolution failure fails the test rather than silently passing.
 * @inputs The ./change.js exports (createInsertion, createDeletion, resolveChange, applyDecision, applyDecisions) plus a fixed clock Date and hand-built Markdown strings.
 * @outputs No persisted values; only expect(...) assertions whose failures surface as failing Vitest cases.
 * @functions at: locate a phrase in source by indexOf after asserting it exists.
 * @dataflow Fixed clock + literal documents -> change constructors -> resolve/apply functions -> expect comparisons against expected text or offsets.
 * @controlflow describe('change') groups all cases; each it() builds its own document and change, applies the operation under test, and asserts the outcome before moving on.
 * @version 1
 * @date 2026-09-07
 */

const clock = new Date('2026-09-07T10:00:00.000Z'); // Fixed wall-clock so every recorded createdAt is deterministic across runs.

/** at locates a phrase within source, failing loudly if it is absent rather than returning -1 to downstream assertions. */
function at(source: string, phrase: string): number {
  const index = source.indexOf(phrase); // Scan for the first occurrence of the phrase in the document text.
  expect(index).not.toBe(-1); // Guard: a missing phrase means the test's own premise is wrong and must surface immediately.

  return index; // Return the confirmed offset so callers can anchor changes against it.
}

/** assertNotNull narrows a nullable resolution result to non-null, letting tests read kind/start/end without an unsafe cast or a lost field. */
function assertNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull(); // A null here means the change failed to resolve and must surface as a failing test rather than being coerced past.
}

describe('change', () => {
  // Rejecting an insertion returns the document to what it was before the text was added.
  it('rejects an insertion back to its prior state', () => {
    const before = 'The quick fox'; // Document as it stood before anyone typed anything.
    const after = 'The quick brown fox'; // Same prose with "brown " inserted between "quick " and "fox".

    const change = createInsertion(
      'c1',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // Record the insertion anchored over its own characters in post-edit text.

    expect(applyDecision(after, change, 'reject')).toBe(before); // Cutting "brown " out restores exactly what was there before.
  });

  // Rejecting a deletion returns the document to what it was before the text was removed.
  it('rejects a deletion back to its prior state', () => {
    const before = 'The quick brown fox'; // Document as it stood with "brown " still present.
    const after = 'The quick fox'; // Same prose with "brown " deleted between "quick " and "fox".

    const change = createDeletion(
      'c1',
      'brown ',
      after,
      at(after, 'fox'),
      'Ada',
      clock,
    ); // Record the deletion whose seam sits where "brown " used to begin (right before "fox").

    expect(applyDecision(after, change, 'reject')).toBe(before); // Restoring the deleted run brings back exactly what was removed.
  });

  // Accepting an insertion never edits anything because its characters already live in the document.
  it('accepts an insertion without editing', () => {
    const after = 'The quick brown fox'; // Post-edit text that already contains "brown ".

    const change = createInsertion(
      'c1',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // Record the insertion over its present characters.

    expect(applyDecision(after, change, 'accept')).toBe(after); // Accept returns the identical string object — no edit is performed.
  });

  // Accepting a deletion never edits anything because nothing was removed from on-disk text.
  it('accepts a deletion without editing', () => {
    const after = 'The quick fox'; // Post-edit text that already lacks "brown ".

    const change = createDeletion(
      'c1',
      'brown ',
      after,
      at(after, 'fox'),
      'Ada',
      clock,
    ); // Record the deletion whose seam marks where "brown " used to be.

    expect(applyDecision(after, change, 'accept')).toBe(after); // Accept returns the identical string object — no edit is performed.
  });

  // A batch of accepts edits nothing regardless of how many changes are folded together.
  it('applies a batch of accepts without editing', () => {
    const after = 'The quick brown fox'; // Post-edit text holding both pending characters and the deletion seam.

    const insertion = createInsertion(
      'c1',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // First change: an insertion over present text.
    const deletion = createDeletion(
      'c2',
      'quick ',
      after,
      at(after, 'fox'),
      'Ada',
      clock,
    ); // Second change: a deletion seam somewhere in the document.
    const secondInsertion = createInsertion(
      'c3',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // Third change: another insertion sharing the same anchor context for this short string.

    expect(applyDecisions(after, [insertion, deletion, secondInsertion], 'accept')).toBe(after); // Accepts fold to a no-op and return the source unchanged.
  });

  // An untouched document resolves its insertion exactly at the inserted span.
  it('resolves an insertion exactly in an untouched document', () => {
    const after = 'The quick brown fox'; // Untouched post-edit text still holding "brown ".

    const change = createInsertion(
      'c1',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // Record the insertion over its present characters.

    const resolved = resolveChange(after, change); // Re-locate the recorded anchor against live text.
    assertNotNull(resolved); // The untouched document must hold this change; a null here means resolution regressed.

    expect(resolved.kind).toBe('exact'); // An unedited document matches the recorded context verbatim, so it resolves on the exact rung.
    expect(after.slice(resolved.start, resolved.end)).toBe('brown '); // The located span must be exactly the inserted characters.
  });

  // A deletion resolves to an empty point sitting where its text used to begin.
  it('resolves a deletion as an empty seam', () => {
    const after = 'The quick fox'; // Post-edit text that already lacks "brown ".

    const change = createDeletion(
      'c1',
      'brown ',
      after,
      at(after, 'fox'),
      'Ada',
      clock,
    ); // Record the deletion whose seam sits right before where "fox" begins.

    const resolved = resolveChange(after, change); // Re-locate the recorded anchor against live text.
    assertNotNull(resolved); // The document must still carry this change; a null here means resolution regressed.

    expect(resolved.start).toBe(resolved.end); // A deletion occupies no characters, so its range collapses to a single point.
    expect(after.slice(0, resolved.start)).toContain('quick '); // The seam sits exactly where "brown " used to begin — immediately after "quick ".
  });

  // An edit far from the change does not disturb its resolution.
  it('resolves an insertion despite a distant unrelated edit', () => {
    // Record the insertion against the document as it stood when the edit was made.
    const after = 'The quick really brown fox jumps over the lazy dog';
    const change = createInsertion('c1', 'really ', after, at(after, 'really '), 'Ada', clock);

    // Now someone edits a distant part of the document, well away from the change.
    const edited = after.replace('lazy', 'sleepy');

    // The anchor's context is untouched by that edit, so the change must still be found.
    const resolved = resolveChange(edited, change);
    assertNotNull(resolved);
    expect(edited.slice(resolved.start, resolved.end)).toBe('really ');
  });

  // Rejecting two insertions removes both from a shared source in one transaction.
  it('rejects two insertions and removes both', () => {
    const source = 'One A two B three'; // Source with two pending single-word insertions ("A " and "B ").

    const first = createInsertion(
      'c1',
      'A ',
      source,
      at(source, 'A '),
      'Ada',
      clock,
    ); // First insertion anchored over its present characters.
    const second = createInsertion(
      'c2',
      'B ',
      source,
      at(source, 'B '),
      'Ada',
      clock,
    ); // Second insertion anchored over its present characters.

    expect(applyDecisions(source, [first, second], 'reject')).toBe('One two three'); // Removing both runs yields the pre-edit document exactly.
  });

  // A replacement is a deletion seam and an insertion at one offset; rejecting both restores the old word in place.
  it('rejects a replacement whose deletion and insertion share an offset', () => {
    const source = 'The slow fox';
    const deletion = createDeletion('c1', 'quick', source, 4, 'Ada', clock);
    const insertion = createInsertion('c2', 'slow', source, 4, 'Ada', clock);
    expect(applyDecisions(source, [deletion, insertion], 'reject')).toBe('The quick fox');
    expect(applyDecisions(source, [insertion, deletion], 'reject')).toBe('The quick fox');
  });

  // The descending-order rule is order-independent: reversing the input array still removes both insertions.
  it('rejects two insertions regardless of input order', () => {
    const source = 'One A two B three'; // Source with two pending single-word insertions ("A " and "B ").

    const first = createInsertion(
      'c1',
      'A ',
      source,
      at(source, 'A '),
      'Ada',
      clock,
    ); // First insertion anchored over its present characters.
    const second = createInsertion(
      'c2',
      'B ',
      source,
      at(source, 'B '),
      'Ada',
      clock,
    ); // Second insertion anchored over its present characters.

    expect(applyDecisions(source, [second, first], 'reject')).toBe('One two three'); // Reversed input folds to the same document -- order-independent because applyDecision re-resolves
    // each change against the running text. The descending sort is an optimisation, not what makes this work.
  });


  // Two insertions of the *same* text is the sharpest case for the fold: after one is cut out, the
  // other's recorded offset points at the wrong characters. It passes because the implementation both
  // works backwards and re-resolves; breaking either one alone still passes, and breaking both fails.
  it('rejects two identical insertions by re-resolving, not by stale offsets', () => {
    const source = 'One A two A three';

    const first = createInsertion('c1', 'A ', source, at(source, 'A '), 'Ada', clock);
    const second = createInsertion('c2', 'A ', source, source.lastIndexOf('A '), 'Ada', clock);

    expect(applyDecisions(source, [first, second], 'reject')).toBe('One two three');
  });

  // An unplaceable change on an empty document is skipped rather than guessed at and corrupting it.
  it('skips a change that cannot be placed', () => {
    const change = createInsertion(
      'c1',
      'brown ',
      'The quick brown fox',
      at('The quick brown fox', 'brown '),
      'Ada',
      clock,
    ); // A validly recorded insertion against a non-empty document.

    expect(applyDecisions('', [change], 'reject')).toBe(''); // Against an empty document the change cannot be located and is left untouched rather than corrupting it.
  });

  // Recorded changes carry their declared shape: kind, identity, author, text, and deterministic timestamp.
  it('records insertion and deletion shapes', () => {
    const after = 'The quick brown fox'; // Post-edit document holding the inserted characters.

    const change = createInsertion(
      'c1',
      'brown ',
      after,
      at(after, 'brown '),
      'Ada',
      clock,
    ); // Record an insertion with a known id, text, and author.

    expect(change.kind).toBe('insert'); // An inserted run is recorded as an insert change.
    expect(change.id).toBe('c1'); // The stable identity supplied at construction is preserved verbatim.
    expect(change.author).toBe('Ada'); // The recording author is carried through unchanged.
    expect(change.text).toBe('brown '); // The exact characters added are retained for later restoration on reject.
    expect(change.createdAt).toBe('2026-09-07T10:00:00.000Z'); // The fixed clock stamps a deterministic ISO 8601 timestamp.

    const deletion = createDeletion(
      'c2',
      'brown ',
      after,
      at(after, 'fox'),
      'Ada',
      clock,
    ); // Record a deletion against the same document for shape comparison.

    expect(deletion.kind).toBe('delete'); // A removed run is recorded as a delete change.
  });
});