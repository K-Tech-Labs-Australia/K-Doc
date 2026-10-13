/**
 * @file history.spec.ts
 * @purpose Vitest test suite for EditHistory undo/redo stack in @k-doc/core verifying requirement FR-7.3.
 * @inputs Synthetic editor text snapshots, PaneId identifiers ('kdoc' | 'source'), and millisecond timestamps.
 * @outputs Vitest assertions validating stack sizes, undo/redo states, text restoration, coalescing behaviour, and bounds.
 * @functions None.
 * @dataflow Synthetic edit states -> EditHistory methods (push, undo, redo, endRun, clear) -> return values and getters -> Vitest assertions.
 * @controlflow Execute test suites across empty history, push/undo/redo lifecycles, coalescing logic, redo invalidation, memory bounds, clear, and defaults.
 * @version 1
 * @date 2026-09-04
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COALESCE_WINDOW_MS,
  DEFAULT_MAX_HISTORY_ENTRIES,
  EditHistory,
  type HistoryEntry,
  type PaneId,
} from '../src/session/history.js';

describe('empty history', () => {
  it('reports canUndo false, canRedo false, and size 0 on a new instance', () => {
    const history = new EditHistory();

    // Verify initial stack state on a clean instance
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(0);
  });

  it('returns null on undo and redo when empty', () => {
    const history = new EditHistory();

    // Pressing Ctrl+Z or Ctrl+Y with nothing to undo or redo is normal user behaviour, not an error.
    expect(history.undo('current', 'kdoc', 0)).toBeNull();
    expect(history.redo('current', 'kdoc', 0)).toBeNull();
  });
});

describe('push and undo', () => {
  it('updates canUndo and size after push', () => {
    const history = new EditHistory();

    // Push initial snapshot without coalescing
    history.push('a', 'kdoc', 0, false);

    // Assert that undo is available and redo is not
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(1);
  });

  it('undo restores previous text and leaves canRedo true and canUndo false', () => {
    const history = new EditHistory();
    history.push('a', 'kdoc', 0, false);

    // Undo from state 'b' back to state 'a'
    const restored: string | null = history.undo('b', 'kdoc', 10);

    // Verify restored text and updated stack availability
    expect(restored).toBe('a');
    expect(history.canRedo).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.size).toBe(0);
  });

  it('redo restores undone text and updates stack state', () => {
    const history = new EditHistory();
    history.push('a', 'kdoc', 0, false);
    history.undo('b', 'kdoc', 10);

    // Redo restores state 'b' that was recorded during undo
    const redone: string | null = history.redo('a', 'kdoc', 20);

    // Verify redone text and updated stack availability
    expect(redone).toBe('b');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(1);
  });
});

describe('coalescing', () => {
  it('a coalesced run undoes to the state before the run began', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });

    // Push typing sequence within the coalesce window
    history.push('v0', 'kdoc', 0, true);
    history.push('v1', 'kdoc', 100, true);
    history.push('v2', 'kdoc', 200, true);

    // Assert all 3 keystrokes merged into a single history entry
    expect(history.size).toBe(1);

    // The stored text is the state to return to, so a coalesced run must retain
    // the text from before the run began; returning 'v2' would land the user in
    // the middle of their own typing run.
    const restored: string | null = history.undo('v3', 'kdoc', 300);
    expect(restored).toBe('v0');
  });

  it('two pushes separated by more than the coalesce window produce size 2 and walk back through both', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });

    // Push at t=0 and t=900 (gap > 500ms window)
    history.push('v0', 'kdoc', 0, true);
    history.push('v1', 'kdoc', 900, true);

    // Assert that the two edits form distinct history entries
    expect(history.size).toBe(2);

    // First undo walks back to v1
    expect(history.undo('v2', 'kdoc', 1000)).toBe('v1');
    // Second undo walks back to v0
    expect(history.undo('v1', 'kdoc', 1010)).toBe('v0');
    // Third undo returns null since the undo stack is exhausted
    expect(history.undo('v0', 'kdoc', 1020)).toBeNull();
  });

  it('a push with coalesce: false never merges even 1ms after the previous one', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('v0', 'kdoc', 0, true);

    // A structural operation must be individually undoable however fast it follows a keystroke.
    history.push('v1', 'kdoc', 1, false);

    expect(history.size).toBe(2);
  });

  it('a push from a different pane never merges', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    const kdocPane: PaneId = 'kdoc';
    const sourcePane: PaneId = 'source';

    // Consecutive edits from distinct panes within the window must remain separate entries
    history.push('a', kdocPane, 0, true);
    history.push('b', sourcePane, 10, true);

    expect(history.size).toBe(2);
  });

  it('endRun prevents the next push from merging', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });

    // Open a run, explicitly close it via endRun, and push another edit within the window
    history.push('a', 'kdoc', 0, true);
    history.endRun();
    history.push('b', 'kdoc', 10, true);

    expect(history.size).toBe(2);
  });
});

describe('redo invalidation', () => {
  it('push after undo invalidates the redo stack', () => {
    const history = new EditHistory();
    history.push('a', 'kdoc', 0, false);
    history.undo('b', 'kdoc', 10);
    expect(history.canRedo).toBe(true);

    // Editing after undoing abandons the redone future — the standard linear-history rule.
    history.push('c', 'kdoc', 20, false);
    expect(history.canRedo).toBe(false);
  });

  it('undo closes an open run so subsequent coalesced push does not merge', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('a', 'kdoc', 0, true);
    history.undo('b', 'kdoc', 5);

    // Undoing closed the run; this coalescing push starts a fresh entry rather than merging
    history.push('c', 'kdoc', 10, true);

    expect(history.size).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it('redo closes an open run so subsequent coalesced push does not merge', () => {
    const history = new EditHistory({ coalesceWindowMs: 500 });
    history.push('a', 'kdoc', 0, false);
    history.undo('b', 'kdoc', 5);
    history.redo('a', 'kdoc', 8);

    // Redoing closed the run; this coalescing push starts a fresh entry rather than merging
    history.push('c', 'kdoc', 10, true);

    expect(history.size).toBe(2);
  });
});

describe('memory bound', () => {
  it('bounds memory to maxEntries and drops oldest entries', () => {
    const history = new EditHistory({ maxEntries: 3 });

    // Push 5 non-coalescing entries
    history.push('e0', 'kdoc', 0, false);
    history.push('e1', 'kdoc', 10, false);
    history.push('e2', 'kdoc', 20, false);
    history.push('e3', 'kdoc', 30, false);
    history.push('e4', 'kdoc', 40, false);

    // Size is bounded to maxEntries (3)
    expect(history.size).toBe(3);

    // Dropping the oldest entries is the documented cost of bounding memory.
    // The entries e0 and e1 have been dropped from the bottom of the stack.
    expect(history.undo('current', 'kdoc', 50)).toBe('e4');
    expect(history.undo('e4', 'kdoc', 60)).toBe('e3');
    expect(history.undo('e3', 'kdoc', 70)).toBe('e2');

    // Exactly 3 undos succeeded; subsequent undo returns null and earliest entries are unreachable
    expect(history.undo('e2', 'kdoc', 80)).toBeNull();
  });
});

describe('clear', () => {
  it('resets canUndo, canRedo, and size to empty state', () => {
    const history = new EditHistory();
    history.push('a', 'kdoc', 0, false);
    history.push('b', 'kdoc', 10, false);
    history.undo('c', 'kdoc', 20);

    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(true);

    // Discard all history and reset state
    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(0);
  });
});

describe('defaults', () => {
  it('exports expected default constant values', () => {
    // Verify default coalescing window and max history entries constants
    expect(DEFAULT_COALESCE_WINDOW_MS).toBe(500);
    expect(DEFAULT_MAX_HISTORY_ENTRIES).toBe(500);
  });

  it('conforms to HistoryEntry interface structure', () => {
    // Validate that HistoryEntry interface shape is usable as expected
    const entry: HistoryEntry = {
      text: 'snapshot',
      pane: 'kdoc',
      at: 100,
    };
    expect(entry.text).toBe('snapshot');
    expect(entry.pane).toBe('kdoc');
    expect(entry.at).toBe(100);
  });
});
