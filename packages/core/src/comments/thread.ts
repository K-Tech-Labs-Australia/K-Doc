/**
 * @file thread.ts
 * @purpose The comment thread model (FR-10.3): pure functions that build, reply to, edit, delete, and resolve a CommentThread.
 *   Every operation returns a new thread and never mutates its argument, because threads round-trip through the JSONL store and an
 *   in-place edit would make it impossible to tell what changed since the last write.
 * @inputs createThread takes an id, anchor, and first author/body; addReply/editEntry/deleteEntry/setResolved take a CommentThread plus
 *   the fields each mutation needs (entryId, author, body, resolved flag).
 * @outputs A new CommentThread reflecting the change, or null from deleteEntry when the thread becomes empty; no input is mutated.
 * @functions
 *   - createThread: build a one-entry, unresolved thread whose createdAt matches its first entry.
 *   - addReply: append an unedited reply to an existing thread.
 *   - editEntry: replace an entry's body and set editedAt; unchanged when the id is absent (a race, not a fault).
 *   - deleteEntry: remove an entry; null when it was the last comment, since an empty thread is not a thread.
 *   - setResolved: flip resolved; unchanged when the flag already matches so no-ops never reach the store.
 * @dataflow Caller arguments -> immutable CommentThread/CommentEntry objects -> new thread handed to the JSONL writer.
 * @controlflow Each function derives timestamps, selects or transforms entries by id via find/filter/map, and returns a shallow-copied thread; branches handle absent ids and no-op flags without mutating inputs.
 * @version 1
 * @date 2026-09-06
 */

import type { CommentAnchor } from './anchor.js';

// `now` exists only so tests can pin timestamps; it is stored via toISOString(), which sorts lexicographically and survives JSON without a custom reviver.
function toTimestamp(date: Date): string {
  return date.toISOString();
}

export interface CommentEntry {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
}

export interface CommentThread {
  readonly id: string;
  readonly anchor: CommentAnchor;
  readonly comments: readonly CommentEntry[];
  readonly resolved: boolean;
  readonly createdAt: string;
}

/** Build a one-entry, unresolved thread whose createdAt matches its first entry. */
export function createThread(
  id: string,
  anchor: CommentAnchor,
  entryId: string,
  author: string,
  body: string,
  now: Date = new Date(),
): CommentThread {
  const timestamp = toTimestamp(now); // ISO 8601 sorts lexicographically and survives JSON without a reviver.

  const entry: CommentEntry = {
    id: entryId,
    author,
    body,
    createdAt: timestamp,
    editedAt: null, // the opening comment has never been edited.
  };

  return {
    id,
    anchor,
    comments: [entry],
    resolved: false,
    createdAt: timestamp, // matches this entry's creation time so both agree on when the thread began.
  };
}

/** Append an unedited reply to a thread without mutating it. */
export function addReply(
  thread: CommentThread,
  entryId: string,
  author: string,
  body: string,
  now: Date = new Date(),
): CommentThread {
  const timestamp = toTimestamp(now); // ISO 8601 sorts lexicographically and survives JSON without a reviver.

  const reply: CommentEntry = {
    id: entryId,
    author,
    body,
    createdAt: timestamp,
    editedAt: null, // a freshly added reply has never been edited.
  };

  return {
    ...thread,
    comments: [...thread.comments, reply], // spread preserves the original array; the new one is appended immutably.
  };
}

/** Replace an entry's body and stamp editedAt, returning the thread unchanged when the id is absent. */
export function editEntry(
  thread: CommentThread,
  entryId: string,
  body: string,
  now: Date = new Date(),
): CommentThread {
  const timestamp = toTimestamp(now); // ISO 8601 sorts lexicographically and survives JSON without a reviver.

  const existing = thread.comments.find((entry) => entry.id === entryId); // find yields CommentEntry | undefined under noUncheckedIndexedAccess.

  if (existing === undefined) {
    // Branch: the id is not present; this edit targets an already-deleted comment, which is a race rather than a fault, so return unchanged.
    return thread;
  } else {
    // Branch: the entry exists; rebuild it with the new body and editedAt while preserving its other fields.
    const updated: CommentEntry = { ...existing, body, editedAt: timestamp };

    return {
      ...thread,
      comments: thread.comments.map((entry) => (entry.id === existing.id ? updated : entry)),
    };
  }
}

/** Remove an entry, returning null when that removal empties the thread. */
export function deleteEntry(thread: CommentThread, entryId: string): CommentThread | null {
  const remaining = thread.comments.filter((entry) => entry.id !== entryId); // keep every comment except the target.

  if (remaining.length === 0) {
    // Branch: this was the last comment; a thread with no comments is not a thread, so signal deletion with null.
    return null;
  } else {
    // Branch: at least one comment remains; return the thread without the deleted entry.
    return { ...thread, comments: remaining };
  }
}

/** Flip the resolved flag, returning the thread unchanged when it already matches. */
export function setResolved(thread: CommentThread, resolved: boolean): CommentThread {
  if (thread.resolved === resolved) {
    // Branch: the flag already matches; return unchanged so a no-op never reaches the store.
    return thread;
  } else {
    // Branch: the flag differs; return a copy with only `resolved` flipped, preserving every other field.
    return { ...thread, resolved };
  }
}
