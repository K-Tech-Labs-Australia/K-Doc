/**
 * @file edit-history-entries.spec.ts
 * @purpose Vitest test suite for EditHistory.entries getter in @k-doc/core verifying requirement FR-14.7.
 * @inputs Synthetic editor text snapshots, PaneId identifiers ('wysiwyg' | 'source'), and millisecond timestamps.
 * @outputs Vitest assertions validating entries length, chronological ordering, pane/timestamp attribution, snapshot isolation, undo/redo reflection, coalescing, and clear.
 * @functions None.
 * @dataflow Synthetic edit states -> EditHistory methods (push, undo, redo, clear) -> history.entries getter -> Vitest assertions.
 * @controlflow Execute eight tests across empty entries, multi-edit chronological order, pane/timestamp attribution, snapshot isolation, undo/redo reflection, typing-run coalescing, and clear.
 * @version 1
 * @date 2026-09-12
 */

import { describe, expect, it } from 'vitest';
import { EditHistory } from '../src/session/history.js';

describe('EditHistory.entries', (): void => {
  // A fresh history instance has recorded no past edits, so entries starts empty.
  it('starts with entries of length 0 on a fresh instance', (): void => {
    const history = new EditHistory();

    expect(history.entries).toHaveLength(0);
  });

  // Retains every non-coalesced edit snapshot in chronological order, oldest first.
  it('retains multiple edits in chronological order with oldest first', (): void => {
    const history = new EditHistory();
    history.push('a', 'wysiwyg', 0, false);
    history.push('b', 'wysiwyg', 1000, false);
    history.push('c', 'wysiwyg', 2000, false);

    expect(history.entries.map((entry): string => entry.text)).toEqual(['a', 'b', 'c']);
  });

  // Records the editor pane and monotonic timestamp for each edit entry.
  it('records the active pane and timestamp of an edit', (): void => {
    const history = new EditHistory();
    history.push('a', 'source', 4242, false);
    const entries = history.entries;

    expect(entries.map((entry): string => entry.pane)).toEqual(['source']);
    expect(entries.map((entry): number => entry.at)).toEqual([4242]);
  });

  // Returns a defensive copy of the undo stack so subsequent pushes do not alter it.
  it('returns a copy of the stack rather than a live reference', (): void => {
    const history = new EditHistory();
    history.push('a', 'wysiwyg', 0, false);
    const taken = history.entries;
    history.push('b', 'wysiwyg', 1000, false);

    expect(taken.length).toBe(1);
    expect(history.size).toBe(2);
  });

  // Removes the popped entry from the entries list when an edit is undone.
  it('removes the popped entry after an undo operation', (): void => {
    const history = new EditHistory();
    history.push('a', 'source', 0, false);
    history.push('b', 'source', 1000, false);
    history.undo('current', 'source', 3000);

    expect(history.entries.map((entry): string => entry.text)).toEqual(['a']);
  });

  // Restores the redone entry onto the undo stack so entries length increases.
  it('restores the redone entry onto entries after redo', (): void => {
    const history = new EditHistory();
    history.push('a', 'source', 0, false);
    history.push('b', 'source', 1000, false);
    history.undo('current', 'source', 3000);
    history.redo('restored', 'source', 4000);
    const entries = history.entries;

    expect(entries).toHaveLength(2);
  });

  // A coalescing push merges into a run that is already open; it does not open one retroactively.
  it('collapses a coalesced typing run into the entry that opened it', (): void => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    // A non-coalescing push closes the run, so it cannot be merged into afterwards.
    history.push('a', 'wysiwyg', 0, false);
    // This one opens a fresh run rather than joining the closed one above.
    history.push('b', 'wysiwyg', 100, true);
    // Within the window and in the same pane, so it merges into 'b' rather than adding a third entry.
    history.push('c', 'wysiwyg', 200, true);
    const entries = history.entries;

    // Two entries, not three: 'c' merged. And the run's entry still reads 'b', the state as it was
    // before the run began, which is what makes one undo land at the start of a typing run rather
    // than in its middle.
    expect(entries).toHaveLength(2);
    expect(entries.map((entry): string => entry.text)).toEqual(['a', 'b']);
  });

  // A run opens only on a coalescing push, so three of them in a window collapse to one entry.
  it('collapses a run that was coalescing from its first push', (): void => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('a', 'wysiwyg', 0, true);
    history.push('b', 'wysiwyg', 100, true);
    history.push('c', 'wysiwyg', 200, true);

    // The first push opened the run, so both later ones merged into it and 'a' is what undo returns to.
    expect(history.entries.map((entry): string => entry.text)).toEqual(['a']);
  });

  // A pane switch mid-run ends it, because one undo entry must not span two editors.
  it('starts a new entry when a coalescing push arrives from the other pane', (): void => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('a', 'wysiwyg', 0, true);
    history.push('b', 'source', 100, true);

    expect(history.entries.map((entry): string => entry.text)).toEqual(['a', 'b']);
  });

  // A gap longer than the window means the user stopped typing, so the next edit is its own entry.
  it('starts a new entry when a coalescing push falls outside the window', (): void => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('a', 'wysiwyg', 0, true);
    history.push('b', 'wysiwyg', 501, true);

    expect(history.entries.map((entry): string => entry.text)).toEqual(['a', 'b']);
  });

  // Empties the undo stack so entries length drops to 0 after clear().
  it('clears all entries when clear() is called', (): void => {
    const history = new EditHistory();
    history.push('a', 'wysiwyg', 0, false);
    history.clear();
    const entries = history.entries;

    expect(entries).toHaveLength(0);
  });
});
