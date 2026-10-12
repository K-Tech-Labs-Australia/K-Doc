/**
 * @file thread.test.ts
 * @purpose Vitest suite covering the comment thread model's immutable mutations.
 * @inputs CommentThread operations from ./thread.js and a fixed anchor from ./anchor.js.
 * @outputs Test assertions verifying each mutation returns new references correctly.
 * @functions base: build a canonical one-entry thread for shared setup.
 * @dataflow Fixture constants -> thread functions -> expect() assertions.
 * @controlflow Each it() exercises one operation and asserts the resulting reference/timestamps.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { createThread, addReply, editEntry, deleteEntry, setResolved } from './thread.js';
import { createAnchor } from './anchor.js';

const ANCHOR = createAnchor('The quick brown fox.', 4, 19);
const T0 = new Date('2026-09-06T10:00:00.000Z');
const T1 = new Date('2026-09-06T11:00:00.000Z');

function base() {
  return createThread('t1', ANCHOR, 'e1', 'Kristian', 'First comment', T0);
}

describe('comment thread model', () => {
  it('createThread builds a one-entry unresolved thread', () => {
    const t = base();
    expect(t.comments).toHaveLength(1); // exactly one entry exists
    expect(t.resolved).toBe(false); // the thread starts unresolved
    const first = t.comments.find((e) => e.id === 'e1'); // locate the opening comment
    if (first === undefined) throw new Error('expected opening entry'); // narrow CommentEntry | undefined under noUncheckedIndexedAccess
    expect(t.createdAt).toBe(first.createdAt); // createdAt matches the first entry
    expect(first.editedAt).toBeNull(); // opening comment has no edit stamp
  });

  it('addReply appends a reply without mutating the original', () => {
    const before = base(); // capture the original thread reference
    const after = addReply(before, 'e2', 'Ada', 'Replied here', T1);
    expect(after.comments).toHaveLength(2); // second entry appended
    expect(before.comments).toHaveLength(1); // original untouched — immutability lets the store diff against its last write.
  });

  it('editEntry replaces the body and stamps editedAt', () => {
    const t = base();
    const next = editEntry(t, 'e1', 'Edited text', T1);
    const entry = next.comments.find((e) => e.id === 'e1'); // locate the edited comment
    if (entry === undefined) throw new Error('expected entry'); // narrow CommentEntry | undefined under noUncheckedIndexedAccess
    expect(entry.body).toBe('Edited text'); // body replaced with new content
    expect(entry.editedAt).toBe(T1.toISOString()); // editedAt set to the injected time
    expect(entry.createdAt).toBe(t.createdAt); // createdAt is left untouched by an edit
  });

  it('editEntry on an unknown id returns the same object', () => {
    const t = base();
    const next = editEntry(t, 'ghost', 'nope', T1); // editing a deleted comment is a race, not a fault
    expect(next).toBe(t); // unchanged reference so nothing reaches the store
  });

  it('deleteEntry removes one of two entries and keeps the thread', () => {
    const t = addReply(base(), 'e2', 'Ada', 'Replied here', T1); // two-entry thread
    const next = deleteEntry(t, 'e1'); // remove the opening comment
    // Asserted rather than returned early: a null here is the failure this test exists to catch,
    // and an early return would let that failure pass silently.
    expect(next).not.toBeNull();
    if (next === null) throw new Error('deleting one of two entries must keep the thread');
    expect(next.comments).toHaveLength(1); // exactly one entry remains
  });

  it('deleteEntry on the last entry returns null', () => {
    const t = base(); // single-entry thread
    const next = deleteEntry(t, 'e1'); // removing the only comment empties the thread
    expect(next).toBeNull(); // a thread with no comments is not a thread
  });

  it('setResolved flips resolved and returns the same object on a no-op', () => {
    const t = base();
    const on = setResolved(t, true); // resolve the thread
    expect(on.resolved).toBe(true); // flag flipped to resolved
    const again = setResolved(on, true); // already resolved — a no-op must not reach the store
    expect(again).toBe(on); // unchanged reference for the redundant call
  });

  it('setResolved flips back to unresolved', () => {
    // Resolved first: base() is already unresolved, so flipping it to false from the start would
    // assert nothing at all.
    const on = setResolved(base(), true);
    const off = setResolved(on, false);
    expect(off.resolved).toBe(false); // flag flipped back to unresolved
    expect(off).not.toBe(on); // and it is a new object, not the same one handed back
  });
});
