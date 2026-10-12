// @vitest-environment jsdom

/**
 * @file autosave-recovery.spec.ts
 * @purpose Vitest test suite for K-Doc's autosave controller, crash-recovery journal helpers, and recovery controller (@k-doc/app).
 *   Validates autosave policies (idle, interval, off), dirty tracking, path validation, flush semantics, policy teardown,
 *   isRecoverable qualification logic, pickRecoverable filtering and sorting, describeRecord human-readable formatting,
 *   and crash-recovery buffer journalling with error boundary handling.
 * @inputs DocumentSession instances, fake and jsdom Window contexts, in-memory test JournalStore backends, and sample JournalRecords.
 * @outputs Vitest assertions verifying timer dispatch, disk path guards, journal persistence, error propagation, and recovery candidate ordering.
 * @functions
 *   - fakeWindow: Constructs a deterministic fake Window managing scheduled timers and event listeners without real time passing.
 *   - fakeStore: Constructs an in-memory test JournalStore recording writes, clearances, and candidate journal listings.
 * @dataflow DocumentSession edits -> autosave controller / recovery controller -> fakeWindow timers -> save callbacks / JournalStore writes -> Vitest assertions.
 * @controlflow Initialize DocumentSession and controllers -> execute test mutations -> advance fakeWindow clock or flush operations -> verify save / journal invocations -> destroy active controllers in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { installAutosave, DEFAULT_AUTOSAVE_POLICY, type Autosave } from '../src/files/autosave.js';
import { installRecovery, pickRecoverable, describeRecord, JOURNAL_DEBOUNCE_MS, type Recovery } from '../src/files/recovery.js';
import { isRecoverable, type JournalRecord, type JournalStore } from '../src/files/journal.js';

let activeAutosaves: Autosave[] = [];
let activeRecoveries: Recovery[] = [];

afterEach((): void => {
  for (let i = 0; i < activeAutosaves.length; i++) {
    const autosave = activeAutosaves[i];
    // Check if autosave controller is defined under strict indexing.
    if (autosave !== undefined) {
      // Destroy active autosave controller.
      autosave.destroy();
    } else {
      // Autosave controller is undefined under strict indexing.
    }
  }
  activeAutosaves = [];

  for (let i = 0; i < activeRecoveries.length; i++) {
    const recovery = activeRecoveries[i];
    // Check if recovery controller is defined under strict indexing.
    if (recovery !== undefined) {
      // Destroy active recovery controller.
      recovery.destroy();
    } else {
      // Recovery controller is undefined under strict indexing.
    }
  }
  activeRecoveries = [];

  // Restore real timers in afterEach as specified by test harness contract.
  vi.useRealTimers();
});

interface ScheduledEntry {
  readonly id: number;
  readonly isInterval: boolean;
  readonly delayMs: number;
  dueTime: number;
  readonly callback: () => void;
  cleared: boolean;
}

/**
 * Constructs a minimal deterministic fake Window object controlling timers and event dispatch.
 * Note: While vi.useFakeTimers() patches the global timers that jsdom's window exposes,
 * the controllers were given an injectable win precisely so the timing is testable deterministically
 * without depending on how Vitest patches jsdom or waiting for real time to pass.
 *
 * @purpose Provides deterministic timer advancement and listener management for controller unit testing.
 * @inputs void.
 * @outputs FakeWindowInstance - Contains the fake Window instance cast through unknown, and a run(ms) step function.
 * @dataflow ms advancement -> scheduled timer queue evaluation -> callback invocations.
 * @controlflow Schedule timers -> sort/advance clock by delta ms in run() -> fire due callbacks -> reschedule intervals.
 */
function fakeWindow(): { win: Window; run: (ms: number) => void } {
  let currentTime = 0;
  let nextId = 1;
  const entries: ScheduledEntry[] = [];
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  /**
   * Registers a one-shot timeout callback.
   *
   * @purpose Schedules a one-shot timeout callback to execute after delayMs.
   * @inputs callback - The function to invoke upon timer expiration.
   * @inputs ms - Delay duration in milliseconds.
   * @outputs number - Unique timer handle ID.
   * @dataflow (callback, ms) -> ScheduledEntry -> entries array.
   * @controlflow Allocate ID -> push entry -> return ID.
   */
  function setTimeout(callback: () => void, ms: number = 0): number {
    const id = nextId;
    nextId += 1;
    entries.push({
      id,
      isInterval: false,
      delayMs: ms,
      dueTime: currentTime + ms,
      callback,
      cleared: false,
    });
    return id;
  }

  /**
   * Cancels a scheduled timeout callback.
   *
   * @purpose Marks a timeout handle as cleared to prevent callback execution.
   * @inputs id - The timer handle ID to cancel.
   * @outputs void.
   * @dataflow id -> locate entry -> mark cleared.
   * @controlflow Iterate entries -> find matching ID -> set cleared = true.
   */
  function clearTimeout(id: number): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Check if entry is defined under strict indexing.
      if (entry !== undefined) {
        // Check if entry matches requested timer id.
        if (entry.id === id) {
          // Mark timer as cleared to prevent execution.
          entry.cleared = true;
        } else {
          // Entry id does not match requested timer id.
        }
      } else {
        // Entry is undefined under strict indexing.
      }
    }
  }

  /**
   * Registers a repeating interval callback.
   *
   * @purpose Schedules a repeating interval callback to execute periodically every ms.
   * @inputs callback - The function to invoke on each interval tick.
   * @inputs ms - Interval period in milliseconds.
   * @outputs number - Unique timer handle ID.
   * @dataflow (callback, ms) -> ScheduledEntry -> entries array.
   * @controlflow Allocate ID -> push interval entry -> return ID.
   */
  function setInterval(callback: () => void, ms: number = 0): number {
    const id = nextId;
    nextId += 1;
    entries.push({
      id,
      isInterval: true,
      delayMs: ms,
      dueTime: currentTime + ms,
      callback,
      cleared: false,
    });
    return id;
  }

  /**
   * Cancels a repeating interval callback.
   *
   * @purpose Marks an interval handle as cleared to stop future executions.
   * @inputs id - The interval handle ID to cancel.
   * @outputs void.
   * @dataflow id -> locate entry -> mark cleared.
   * @controlflow Delegate to clearTimeout.
   */
  function clearInterval(id: number): void {
    clearTimeout(id);
  }

  /**
   * Registers an event listener on the fake window.
   *
   * @purpose Registers an event listener for DOM event types such as window blur.
   * @inputs type - Event type string.
   * @inputs listener - Event listener callback or object.
   * @inputs options - Optional listener options including AbortSignal.
   * @outputs void.
   * @dataflow listener registration -> internal Map storage.
   * @controlflow Find or create listener Set -> add listener -> bind AbortSignal if present.
   */
  function addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    let set = listeners.get(type);
    // Check if listener set already exists for this event type.
    if (set === undefined) {
      // Initialize fresh listener Set for this event type.
      set = new Set<EventListenerOrEventListenerObject>();
      listeners.set(type, set);
    } else {
      // Listener set already exists for this event type.
    }
    set.add(listener);

    // Check if an abort signal is passed in options.
    if (
      typeof options === 'object' &&
      options !== null &&
      'signal' in options &&
      options.signal instanceof AbortSignal
    ) {
      // Check if the signal is already aborted.
      if (options.signal.aborted) {
        // Signal already aborted: remove listener immediately.
        set.delete(listener);
      } else {
        // Signal not yet aborted: attach abort event listener to remove this listener.
        options.signal.addEventListener('abort', (): void => {
          // Check if listener set exists before deleting.
          if (set !== undefined) {
            // Delete listener on abort.
            set.delete(listener);
          } else {
            // Listener set already absent.
          }
        });
      }
    } else {
      // No AbortSignal provided in listener options.
    }
  }

  /**
   * Unregisters an event listener on the fake window.
   *
   * @purpose Removes an event listener for DOM event types.
   * @inputs type - Event type string.
   * @inputs listener - Event listener callback or object to remove.
   * @outputs void.
   * @dataflow type and listener -> Map lookup -> Set deletion.
   * @controlflow Lookup listener Set -> delete listener if found.
   */
  function removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const set = listeners.get(type);
    // Check if listener set exists for this event type.
    if (set !== undefined) {
      // Delete listener from the set.
      set.delete(listener);
    } else {
      // No listeners registered for this type.
    }
  }

  /**
   * Advances the fake window clock by the specified duration and fires due callbacks in chronological order.
   *
   * @purpose Advances simulation time deterministically, firing timers whose due timestamp has arrived.
   * @inputs ms - Milliseconds to advance the fake window clock.
   * @outputs void.
   * @dataflow ms -> currentTime advancement -> chronological callback dispatch.
   * @controlflow Repeatedly find earliest due active timer <= targetTime -> advance currentTime -> fire callback -> reschedule interval.
   */
  function run(ms: number): void {
    const targetTime = currentTime + ms;

    while (true) {
      let earliestIndex = -1;
      let earliestDueTime = Infinity;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        // Check if entry is defined under strict indexing.
        if (entry !== undefined) {
          // Check if entry is active and due on or before targetTime.
          if (!entry.cleared && entry.dueTime <= targetTime) {
            // Check if entry is earlier than the currently found earliest due time.
            if (entry.dueTime < earliestDueTime) {
              // Found earlier due timer: record index and timestamp.
              earliestDueTime = entry.dueTime;
              earliestIndex = i;
            } else {
              // Not earlier than current earliest candidate.
            }
          } else {
            // Entry is cleared or due after target time.
          }
        } else {
          // Entry is undefined under strict indexing.
        }
      }

      // Check if any due timer was found.
      if (earliestIndex === -1) {
        // No more due timers: advance clock to target time and finish execution.
        currentTime = targetTime;
        break;
      } else {
        // Due timer found: proceed to execute.
      }

      const currentEntry = entries[earliestIndex];
      // Check if entry is defined under strict indexing.
      if (currentEntry === undefined || currentEntry.cleared) {
        // Entry is undefined or was cleared: skip to next iteration.
        continue;
      } else {
        // Valid entry found: advance time and fire callback.
      }

      currentTime = currentEntry.dueTime;
      // Check whether this entry represents a repeating interval timer.
      if (currentEntry.isInterval) {
        // Repeating interval: calculate next due timestamp and invoke callback.
        currentEntry.dueTime += Math.max(1, currentEntry.delayMs);
        currentEntry.callback();
      } else {
        // One-shot timeout: mark cleared and invoke callback.
        currentEntry.cleared = true;
        currentEntry.callback();
      }
    }
  }

  const win = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener,
    removeEventListener,
  } as unknown as Window;

  return { win, run };
}

/**
 * Constructs an in-memory test JournalStore recording writes and clearances.
 *
 * @purpose Provides an inspectable JournalStore recording write operations and clear IDs.
 * @inputs void.
 * @outputs JournalStore & { writes: JournalRecord[]; cleared: string[] } - The test journal store.
 * @dataflow write/clear calls -> internal writes/cleared arrays; list() -> array copy.
 * @controlflow Record writes with Date.now() timestamp -> record clear IDs -> list returns copies.
 */
function fakeStore(): JournalStore & { writes: JournalRecord[]; cleared: string[] } {
  const writes: JournalRecord[] = [];
  const cleared: string[] = [];

  return {
    available: true,
    writes,
    cleared,

    /**
     * Persists a journal record to the in-memory store.
     *
     * @purpose Records a journal write operation into the writes array.
     * @inputs id - Buffer ID.
     * @inputs path - File path or null.
     * @inputs contents - Unsaved document text.
     * @outputs Promise<void>.
     * @dataflow (id, path, contents) -> JournalRecord -> writes array.
     * @controlflow Create record object -> push to writes array -> resolve Promise.
     */
    async write(id: string, path: string | null, contents: string): Promise<void> {
      const record: JournalRecord = {
        id,
        path,
        contents,
        saved_at_ms: Date.now(),
      };
      writes.push(record);
    },

    /**
     * Lists all recorded journal entries.
     *
     * @purpose Returns a shallow copy of all recorded journal writes.
     * @inputs void.
     * @outputs Promise<readonly JournalRecord[]> - Array of recorded journal entries.
     * @dataflow writes array -> shallow copy -> resolve Promise.
     * @controlflow Return copy of writes array.
     */
    async list(): Promise<readonly JournalRecord[]> {
      return [...writes];
    },

    /**
     * Clears a journal entry by ID.
     *
     * @purpose Records a buffer ID removal into the cleared array.
     * @inputs id - Buffer ID to clear.
     * @outputs Promise<void>.
     * @dataflow id -> cleared array.
     * @controlflow Push id to cleared array -> resolve Promise.
     */
    async clear(id: string): Promise<void> {
      cleared.push(id);
    },
  };
}

describe('the autosave policy', () => {
  it('defines DEFAULT_AUTOSAVE_POLICY as idle 2 seconds', () => {
    expect(DEFAULT_AUTOSAVE_POLICY).toEqual({
      kind: 'idle',
      seconds: 2,
    });
  });

  it('does not save while typing continues under idle policy', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');
    session.applyText('# Initial\nDirty edit\n');

    let saveCount = 0;
    const autosave = installAutosave({
      session,
      win: fake.win,
      save: (): void => {
        saveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'idle', seconds: 2 },
    });
    activeAutosaves.push(autosave);

    // Advance 1 second.
    fake.run(1000);

    // Apply another edit.
    session.applyText('# Initial\nDirty edit\nTyping in progress...\n');

    // Advance 1 second.
    fake.run(1000);

    // Assert the save callback has not run yet.
    // This is the whole point of idle — a user typing continuously should not be interrupted mid-sentence.
    expect(saveCount).toBe(0);

    // Advance 2 seconds with no further edits.
    fake.run(2000);

    // Assert it has run exactly once.
    expect(saveCount).toBe(1);
  });

  it('never saves without an on-disk path', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');
    session.applyText('# Initial\nDirty edit\n');

    let saveCount = 0;
    const autosave = installAutosave({
      session,
      win: fake.win,
      save: (): void => {
        saveCount += 1;
      },
      hasPath: (): boolean => false,
      policy: { kind: 'idle', seconds: 2 },
    });
    activeAutosaves.push(autosave);

    // Apply an edit to trigger the idle timer under fakeWindow.
    session.applyText('# Initial\nDirty edit\nAnother edit\n');

    // Advance well past the idle window.
    fake.run(10_000);

    // Silently creating a file the user never named is worse than not saving.
    expect(saveCount).toBe(0);
  });

  it('never runs on a clean document', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Clean\n');

    let saveCount = 0;
    const autosave = installAutosave({
      session,
      win: fake.win,
      save: (): void => {
        saveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'idle', seconds: 2 },
    });
    activeAutosaves.push(autosave);

    // Advance past idle window without making any edits.
    fake.run(10_000);

    expect(saveCount).toBe(0);
  });

  it('flush returns true and saves when dirty with path, and false when clean', () => {
    const fake = fakeWindow();
    const dirtySession = new DocumentSession('# Initial\n');
    dirtySession.focusPane('source');
    dirtySession.applyText('# Initial\nDirty edit\n');

    let dirtySaveCount = 0;
    const dirtyAutosave = installAutosave({
      session: dirtySession,
      win: fake.win,
      save: (): void => {
        dirtySaveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'idle', seconds: 2 },
    });
    activeAutosaves.push(dirtyAutosave);

    // When dirty with a path, flush initiates save and returns true.
    expect(dirtyAutosave.flush()).toBe(true);
    expect(dirtySaveCount).toBe(1);

    const cleanSession = new DocumentSession('# Clean\n');
    let cleanSaveCount = 0;
    const cleanAutosave = installAutosave({
      session: cleanSession,
      win: fake.win,
      save: (): void => {
        cleanSaveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'idle', seconds: 2 },
    });
    activeAutosaves.push(cleanAutosave);

    // When clean, flush does not initiate save and returns false.
    expect(cleanAutosave.flush()).toBe(false);
    expect(cleanSaveCount).toBe(0);
  });

  it('setPolicy tears the old policy down and prevents orphaned timers', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');
    session.applyText('# Initial\nDirty edit\n');

    let saveCount = 0;
    const autosave = installAutosave({
      session,
      win: fake.win,
      save: (): void => {
        saveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'interval', seconds: 1 },
    });
    activeAutosaves.push(autosave);

    // Advance 3s and expect interval saves.
    fake.run(3000);
    expect(saveCount).toBe(3);

    // Swapping policy without tearing down leaves an orphaned interval saving forever.
    autosave.setPolicy({ kind: 'off' });

    // Reset the recorder and advance 5s.
    saveCount = 0;
    fake.run(5000);

    // Assert zero further saves occur under the off policy.
    expect(saveCount).toBe(0);
  });

  it('destroy is idempotent and stops all timers', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');
    session.applyText('# Initial\nDirty edit\n');

    let saveCount = 0;
    const autosave = installAutosave({
      session,
      win: fake.win,
      save: (): void => {
        saveCount += 1;
      },
      hasPath: (): boolean => true,
      policy: { kind: 'interval', seconds: 1 },
    });
    activeAutosaves.push(autosave);

    // Idempotent destroy: destroy once, then destroy again.
    autosave.destroy();
    autosave.destroy();

    // Advance past previous interval and assert no saves executed.
    fake.run(5000);
    expect(saveCount).toBe(0);
    expect(autosave.flush()).toBe(false);
  });
});

describe('isRecoverable', () => {
  it('returns false when record contents is empty', () => {
    const record: JournalRecord = {
      id: 'rec-empty',
      path: '/docs/empty.md',
      contents: '',
      saved_at_ms: 1000,
    };

    expect(isRecoverable(record, 'disk content')).toBe(false);
    expect(isRecoverable(record, null)).toBe(false);
  });

  it('returns false when record contents equals disk text', () => {
    const record: JournalRecord = {
      id: 'rec-identical',
      path: '/docs/notes.md',
      contents: '# Notes\nIdentical content\n',
      saved_at_ms: 1000,
    };

    // Offering to restore something identical to what is on disk trains the user to dismiss the prompt without reading it.
    expect(isRecoverable(record, '# Notes\nIdentical content\n')).toBe(false);
  });

  it('returns true when record contents differs from disk text or disk text is null', () => {
    const record: JournalRecord = {
      id: 'rec-diff',
      path: '/docs/notes.md',
      contents: '# Notes\nUnsaved modifications\n',
      saved_at_ms: 1000,
    };

    expect(isRecoverable(record, '# Notes\nOriginal content\n')).toBe(true);
    expect(isRecoverable(record, null)).toBe(true);
  });
});

describe('pickRecoverable', () => {
  it('filters out non-recoverable records and returns candidates newest first by saved_at_ms', () => {
    const recEmpty: JournalRecord = {
      id: 'rec-empty',
      path: '/docs/empty.md',
      contents: '',
      saved_at_ms: 5000,
    };
    const recIdentical: JournalRecord = {
      id: 'rec-identical',
      path: '/docs/identical.md',
      contents: 'Content A',
      saved_at_ms: 4000,
    };
    const recOlder: JournalRecord = {
      id: 'rec-older',
      path: '/docs/older.md',
      contents: 'Content B',
      saved_at_ms: 1000,
    };
    const recNewer: JournalRecord = {
      id: 'rec-newer',
      path: null,
      contents: 'Content C',
      saved_at_ms: 3000,
    };
    const recNewest: JournalRecord = {
      id: 'rec-newest',
      path: '/docs/newest.md',
      contents: 'Content D',
      saved_at_ms: 6000,
    };

    const results = pickRecoverable(
      [recEmpty, recOlder, recIdentical, recNewest, recNewer],
      (record): string | null => {
        // Check which document record is being evaluated.
        if (record.id === 'rec-identical') {
          // Disk contents matches record contents.
          return 'Content A';
        } else if (record.id === 'rec-older') {
          // Disk contents differs from record contents.
          return 'Disk X';
        } else if (record.id === 'rec-newest') {
          // Disk contents differs from record contents.
          return 'Disk Y';
        } else {
          // Other records have no on-disk file.
          return null;
        }
      },
    );

    expect(results).toHaveLength(3);

    const firstResult = results[0];
    // Check if first result is defined under strict indexing.
    if (firstResult !== undefined) {
      expect(firstResult.id).toBe('rec-newest');
      expect(firstResult.saved_at_ms).toBe(6000);
    } else {
      expect(firstResult).toBeDefined();
    }

    const secondResult = results[1];
    // Check if second result is defined under strict indexing.
    if (secondResult !== undefined) {
      expect(secondResult.id).toBe('rec-newer');
      expect(secondResult.saved_at_ms).toBe(3000);
    } else {
      expect(secondResult).toBeDefined();
    }

    const thirdResult = results[2];
    // Check if third result is defined under strict indexing.
    if (thirdResult !== undefined) {
      expect(thirdResult.id).toBe('rec-older');
      expect(thirdResult.saved_at_ms).toBe(1000);
    } else {
      expect(thirdResult).toBeDefined();
    }
  });
});

describe('describeRecord', () => {
  it('renders a description containing file name for POSIX paths', () => {
    const record: JournalRecord = {
      id: 'rec-1',
      path: '/home/u/notes.md',
      contents: 'Sample',
      saved_at_ms: 1000,
    };

    const description = describeRecord(record, 1000);
    expect(description).toContain('notes.md');
  });

  it('renders a description containing file name for Windows paths', () => {
    const record: JournalRecord = {
      id: 'rec-2',
      path: 'C:\\docs\\notes.md',
      contents: 'Sample',
      saved_at_ms: 1000,
    };

    // The split handles both forward and backward slash separators.
    const description = describeRecord(record, 1000);
    expect(description).toContain('notes.md');
  });

  it('renders Untitled when path is null', () => {
    const record: JournalRecord = {
      id: 'rec-3',
      path: null,
      contents: 'Sample',
      saved_at_ms: 1000,
    };

    const description = describeRecord(record, 1000);
    expect(description).toContain('Untitled');
  });

  it('formats relative ages with correct singular and plural units', () => {
    const now = 100_000_000;

    // 30 seconds ago renders as 'just now'.
    const rec30s: JournalRecord = {
      id: 'r-30s',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now - 30_000,
    };
    expect(describeRecord(rec30s, now)).toBe('notes.md — just now');

    // 60,000ms renders as '1 minute ago' (singular, not '1 minutes ago').
    const rec1m: JournalRecord = {
      id: 'r-1m',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now - 60_000,
    };
    // The singular forms matter because "1 minutes ago" in a dialog asking someone to trust a recovery is exactly the detail that makes them doubt it.
    expect(describeRecord(rec1m, now)).toBe('notes.md — 1 minute ago');

    // 180,000ms renders as '3 minutes ago'.
    const rec3m: JournalRecord = {
      id: 'r-3m',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now - 180_000,
    };
    expect(describeRecord(rec3m, now)).toBe('notes.md — 3 minutes ago');

    // 1 hour renders as '1 hour ago'.
    const rec1h: JournalRecord = {
      id: 'r-1h',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now - 3_600_000,
    };
    expect(describeRecord(rec1h, now)).toBe('notes.md — 1 hour ago');

    // 25 hours renders as '1 day ago'.
    const rec25h: JournalRecord = {
      id: 'r-25h',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now - 25 * 3_600_000,
    };
    expect(describeRecord(rec25h, now)).toBe('notes.md — 1 day ago');
  });

  it('renders just now when saved_at_ms is in the future', () => {
    const now = 100_000_000;
    const futureRecord: JournalRecord = {
      id: 'r-future',
      path: '/notes.md',
      contents: 'Sample',
      saved_at_ms: now + 50_000,
    };

    // A record with a saved_at_ms in the future renders 'just now' rather than a negative count.
    expect(describeRecord(futureRecord, now)).toBe('notes.md — just now');
  });
});

describe('the recovery controller', () => {
  it('journals after debounce when an edit is applied', () => {
    const fake = fakeWindow();
    const store = fakeStore();
    const session = new DocumentSession('# Original\n');
    session.focusPane('source');

    const recovery = installRecovery({
      session,
      store,
      win: fake.win,
      bufferId: 'buf-101',
      currentPath: (): string | null => '/path/to/file.md',
      onError: (): void => {},
    });
    activeRecoveries.push(recovery);

    session.applyText('# Original\nModified\n');
    expect(store.writes).toHaveLength(0);

    fake.run(JOURNAL_DEBOUNCE_MS);

    expect(store.writes).toHaveLength(1);
    const firstWrite = store.writes[0];
    // Check if firstWrite is defined under strict indexing.
    if (firstWrite !== undefined) {
      expect(firstWrite.id).toBe('buf-101');
      expect(firstWrite.path).toBe('/path/to/file.md');
      expect(firstWrite.contents).toBe(session.snapshot.text);
    } else {
      expect(firstWrite).toBeDefined();
    }
  });

  it('journals even when currentPath returns null', () => {
    const fake = fakeWindow();
    const store = fakeStore();
    const session = new DocumentSession('# Untitled\n');
    session.focusPane('source');

    const recovery = installRecovery({
      session,
      store,
      win: fake.win,
      bufferId: 'buf-102',
      currentPath: (): string | null => null,
      onError: (): void => {},
    });
    activeRecoveries.push(recovery);

    session.applyText('# Untitled\nDraft modifications\n');
    fake.run(JOURNAL_DEBOUNCE_MS);

    // An unsaved, never-named document is precisely the one with nothing else protecting it.
    expect(store.writes).toHaveLength(1);
    const firstWrite = store.writes[0];
    // Check if firstWrite is defined under strict indexing.
    if (firstWrite !== undefined) {
      expect(firstWrite.id).toBe('buf-102');
      expect(firstWrite.path).toBeNull();
      expect(firstWrite.contents).toBe(session.snapshot.text);
    } else {
      expect(firstWrite).toBeDefined();
    }
  });

  it('does not journal a clean session', () => {
    const fake = fakeWindow();
    const store = fakeStore();
    const session = new DocumentSession('# Clean\n');

    const recovery = installRecovery({
      session,
      store,
      win: fake.win,
      bufferId: 'buf-103',
      currentPath: (): string | null => '/path/to/file.md',
      onError: (): void => {},
    });
    activeRecoveries.push(recovery);

    fake.run(JOURNAL_DEBOUNCE_MS * 2);
    expect(store.writes).toHaveLength(0);

    // Even explicit flush on a clean session should not write.
    recovery.flush();
    expect(store.writes).toHaveLength(0);
  });

  it('records buffer id in store cleared list upon clear()', () => {
    const fake = fakeWindow();
    const store = fakeStore();
    const session = new DocumentSession('# Content\n');

    const recovery = installRecovery({
      session,
      store,
      win: fake.win,
      bufferId: 'buf-104',
      currentPath: (): string | null => '/path/to/file.md',
      onError: (): void => {},
    });
    activeRecoveries.push(recovery);

    recovery.clear();
    expect(store.cleared).toContain('buf-104');
  });

  it('is idempotent and stops pending journal timers on destroy()', () => {
    const fake = fakeWindow();
    const store = fakeStore();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');

    const recovery = installRecovery({
      session,
      store,
      win: fake.win,
      bufferId: 'buf-105',
      currentPath: (): string | null => '/path/to/file.md',
      onError: (): void => {},
    });
    activeRecoveries.push(recovery);

    session.applyText('# Initial\nModified\n');
    recovery.destroy();
    recovery.destroy(); // Idempotency check

    fake.run(JOURNAL_DEBOUNCE_MS * 2);
    expect(store.writes).toHaveLength(0);
  });

  it('routes error to onError callback when store write rejects without throwing', async () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Initial\n');
    session.focusPane('source');

    let reportedError: string | null = null;
    const rejectingStore: JournalStore = {
      available: true,
      async write(): Promise<void> {
        return Promise.reject(new Error('disk full'));
      },
      async list(): Promise<readonly JournalRecord[]> {
        return [];
      },
      async clear(): Promise<void> {},
    };

    const recovery = installRecovery({
      session,
      store: rejectingStore,
      win: fake.win,
      bufferId: 'buf-106',
      currentPath: (): string | null => '/path/to/file.md',
      onError: (message: string): void => {
        reportedError = message;
      },
    });
    activeRecoveries.push(recovery);

    session.applyText('# Initial\nFailing edit\n');
    fake.run(JOURNAL_DEBOUNCE_MS);

    // One tick is not enough: the rejected write is chained through .catch() inside the controller, so
    // the handler runs a microtask later than the rejection itself. Yielding to the macrotask queue
    // drains the whole chain rather than guessing how many awaits it takes.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    // Losing the safety net is bad, taking the editor down with it is worse.
    expect(reportedError).toBe('disk full');
  });
});
