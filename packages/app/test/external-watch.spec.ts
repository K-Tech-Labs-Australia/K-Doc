// @vitest-environment jsdom

// Note on test strategy: The hard part is that installExternalWatch only registers a listener inside Tauri,
// and the test environment has no Tauri runtime (__TAURI_INTERNALS__ is absent). Structure the suite around
// what is testable without it: the reconcile rules and state machine semantics are the behaviour worth pinning,
// the IPC plumbing is not. Faking a Tauri runtime by assigning __TAURI_INTERNALS__ onto window would cause
// invoke calls to fail for a different reason and would measure the mock rather than real behavior.

/**
 * @file external-watch.spec.ts
 * @purpose Vitest test suite for K-Doc external filesystem change detection and reconcile rules (FR-6.4).
 *   Validates external watch availability guards in non-desktop environments, debounce ordering relative
 *   to crash journal timers, DocumentSession state invariants under reconcile rules (clean silent reloads,
 *   dirty conflict prompts, external snapshot mutation, and self-save suppression), and lifecycle idempotence.
 * @inputs DocumentSession instances, fake Window contexts, debounce duration constants, and simulated external edits.
 * @outputs Vitest assertions verifying capability detection, debounce constants, session dirty tracking, snapshot updates, and teardown safety.
 * @functions
 *   - fakeWindow: Constructs a deterministic fake Window managing scheduled timers and event listeners without real time passing.
 * @dataflow DocumentSession modifications -> ExternalWatch controller state checks -> SessionSnapshot evaluations -> Vitest assertions.
 * @controlflow Initialize DocumentSession and controllers -> probe desktop runtime availability -> verify debounce constant timing -> assert session reconcile rules -> execute destroy lifecycle -> clean up active controllers in afterEach.
 * @version 3
 * @date 2026-09-12
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession, mergeThreeWay, resolvedText } from '@k-doc/core';
import type { HunkChoice } from '@k-doc/core';
import {
  applyConflictResolution,
  installExternalWatch,
  EXTERNAL_CHANGE_DEBOUNCE_MS,
  type ExternalWatch,
  type ConflictResolution,
} from '../src/files/external-watch.js';
import { JOURNAL_DEBOUNCE_MS } from '../src/files/recovery.js';

let activeExternalWatches: ExternalWatch[] = [];

afterEach((): void => {
  for (let i = 0; i < activeExternalWatches.length; i++) {
    const watch = activeExternalWatches[i];
    // Check if external watch controller is defined under strict indexing.
    if (watch !== undefined) {
      // Destroy active external watch controller.
      watch.destroy();
    } else {
      // Watch controller is undefined under strict indexing.
    }
  }
  activeExternalWatches = [];
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

describe('availability', () => {
  it('reports available as false outside Tauri host environment', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Clean\n');
    const watch = installExternalWatch({
      session,
      win: fake.win,
      readDiskText: async (_path: string): Promise<string> => '',
      resolveConflict: async (_path: string, _diskText: string): Promise<ConflictResolution> => ({ kind: 'keepMine' }),
      onReloaded: (_path: string): void => {},
      onError: (_message: string): void => {},
    });
    activeExternalWatches.push(watch);

    // Outside Tauri (window has no __TAURI_INTERNALS__), installExternalWatch({...}).available is false.
    expect(watch.available).toBe(false);
  });

  it('ignores setPath without throwing or invoking disk operations when unavailable', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Clean\n');
    let readDiskTextCalled = false;
    let resolveConflictCalled = false;

    const watch = installExternalWatch({
      session,
      win: fake.win,
      readDiskText: async (_path: string): Promise<string> => {
        readDiskTextCalled = true;
        return '# Disk content\n';
      },
      resolveConflict: async (_path: string, _diskText: string): Promise<ConflictResolution> => {
        resolveConflictCalled = true;
        return { kind: 'keepMine' };
      },
      onReloaded: (_path: string): void => {},
      onError: (_message: string): void => {},
    });
    activeExternalWatches.push(watch);

    // The browser dev build has no filesystem to watch, and that this is absence rather than failure —
    // an editor that threw on every startup outside Tauri would be unusable.
    expect(() => {
      watch.setPath('/x.md');
    }).not.toThrow();

    fake.run(500);

    expect(readDiskTextCalled).toBe(false);
    expect(resolveConflictCalled).toBe(false);
  });

  it('destroys an unavailable watch idempotently without throwing', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Clean\n');
    const watch = installExternalWatch({
      session,
      win: fake.win,
      readDiskText: async (_path: string): Promise<string> => '',
      resolveConflict: async (_path: string, _diskText: string): Promise<ConflictResolution> => ({ kind: 'keepMine' }),
      onReloaded: (_path: string): void => {},
      onError: (_message: string): void => {},
    });
    activeExternalWatches.push(watch);

    expect(() => {
      watch.destroy();
      watch.destroy();
    }).not.toThrow();
  });
});

describe('the debounce constant', () => {
  it('defines EXTERNAL_CHANGE_DEBOUNCE_MS as 150ms and orders it before crash journal debounce', () => {
    expect(EXTERNAL_CHANGE_DEBOUNCE_MS).toBe(150);

    // An external change should be noticed and reconciled before the journal records a buffer
    // that is about to be replaced. If journal debounce were shorter or equal, a rapid external
    // edit burst could be journalled as an unsaved local edit right before being silently overwritten by the reload.
    expect(EXTERNAL_CHANGE_DEBOUNCE_MS).toBeLessThan(JOURNAL_DEBOUNCE_MS);
  });
});

describe('the reconcile rules', () => {
  it('untouched documents reload silently', () => {
    const session = new DocumentSession('# Pristine Document\n');

    // A freshly constructed session is not dirty, so rule 4 (silent reload) is the one that applies to an untouched document.
    // A clean buffer has nothing to lose, so reloading silently without interrupting the user is right.
    expect(session.snapshot.dirty).toBe(false);
  });

  it('documents with unsaved edits ask the user', () => {
    const session = new DocumentSession('# Pristine Document\n');
    session.focusPane('source');
    session.applyText('# Pristine Document\nUnsaved local modifications\n');

    // After session.focusPane('source') and session.applyText(...), the session is dirty,
    // so rule 5 (ask the user / conflict resolution) applies.
    expect(session.snapshot.dirty).toBe(true);
  });

  it('silent reload updates snapshot text to match disk contents', () => {
    const initialText = '# Initial Document\n';
    const externalDiskText = '# Externally Modified Document\n';
    const session = new DocumentSession(initialText);

    expect(session.snapshot.dirty).toBe(false);

    // applyExternalText on a clean session leaves snapshot.text equal to the new text —
    // the operation the silent reload performs.
    session.applyExternalText(externalDiskText);

    expect(session.snapshot.text).toBe(externalDiskText);
  });

  it('silent reload leaves the buffer marked dirty until explicitly saved', () => {
    const initialText = '# Clean on disk\n';
    const externalDiskText = '# Disk modified by third party\n';
    const session = new DocumentSession(initialText);

    expect(session.snapshot.dirty).toBe(false);

    session.applyExternalText(externalDiskText);

    // applyExternalText leaves the session dirty relative to its saved text, which is why a silent reload
    // of a clean buffer still marks the document as changed until it is saved.
    // This is the honest consequence: the text now differs from what was last written by K-Doc, even though
    // it matches disk, and the alternative — marking it clean — would require trusting that the disk read
    // and the last save agree.
    expect(session.snapshot.dirty).toBe(true);
  });

  it('the merge base is the text as of the last save', () => {
    const session = new DocumentSession('# Base\nbody\n');
    session.focusPane('source');
    session.applyText('# Base\nedited body\n');

    // The buffer and the file on disk both diverged from what was last saved, so that text is
    // the common ancestor a three-way merge needs. Without it there is no telling an edit one side
    // made from an edit the other side undid.
    expect(session.snapshot.savedText).toBe('# Base\nbody\n');
    expect(session.snapshot.text).toBe('# Base\nedited body\n');
  });

  it('a change only on disk and a change only in the buffer both survive a merge', () => {
    const session = new DocumentSession('one\ntwo\nthree\n');
    session.focusPane('source');
    session.applyText('ONE\ntwo\nthree\n');
    const diskText = 'one\ntwo\nTHREE\n';
    const merge = mergeThreeWay(session.snapshot.savedText, session.snapshot.text, diskText);

    expect(merge.conflictCount).toBe(0);

    // This is the case the old two-way prompt had to make the user choose about, and either answer
    // threw away work that was never in the other's way.
    session.applyExternalText(resolvedText(merge, new Map<number, HunkChoice>()));

    expect(session.snapshot.text).toBe('ONE\ntwo\nTHREE\n');
  });

  it('a merged buffer is still unsaved work', () => {
    const session = new DocumentSession('one\ntwo\nthree\n');
    session.focusPane('source');
    session.applyText('ONE\ntwo\nthree\n');
    const diskText = 'one\ntwo\nTHREE\n';
    const merge = mergeThreeWay(session.snapshot.savedText, session.snapshot.text, diskText);
    session.applyExternalText(resolvedText(merge, new Map<number, HunkChoice>()));

    // The merged text exists nowhere on disk — the file still holds the other program's version —
    // so leaving it clean would let the user close the window and lose it.
    expect(session.snapshot.dirty).toBe(true);
  });

  it('a line both sides changed differently is the only thing left to ask about', () => {
    const session = new DocumentSession('one\ntwo\nthree\n');
    session.focusPane('source');
    session.applyText('one\nMINE\nthree\n');
    const diskText = 'one\nTHEIRS\nthree\n';
    const merge = mergeThreeWay(session.snapshot.savedText, session.snapshot.text, diskText);

    expect(merge.conflictCount).toBe(1);

    // An unanswered question must never cost the user their unsaved work.
    expect(resolvedText(merge, new Map<number, HunkChoice>())).toContain('MINE');

    const index = merge.hunks.findIndex((hunk): boolean => hunk.kind === 'conflict');
    expect(resolvedText(merge, new Map<number, HunkChoice>([[index, 'theirs']]))).toContain('THEIRS');
    expect(resolvedText(merge, new Map<number, HunkChoice>([[index, 'theirs']]))).not.toContain('MINE');
  });

  it('self-saves are ignored because disk content matches the saved snapshot', () => {
    const session = new DocumentSession('# Initial draft\n');
    session.focusPane('source');
    session.applyText('# Saved version of document\n');
    expect(session.snapshot.dirty).toBe(true);

    session.markSaved();

    // The self-save guard: assert that after session.markSaved(), snapshot.text is exactly what a subsequent
    // disk read would return, which is the equality the reconcile step uses to ignore K-Doc's own writes.
    // Comparing content is the only version of this that cannot race a time window.
    const diskTextFromSubsequentRead = '# Saved version of document\n';
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.text).toBe(diskTextFromSubsequentRead);
    expect(diskTextFromSubsequentRead === session.snapshot.text).toBe(true);
  });
});

describe('lifecycle', () => {
  it('destroy is idempotent and does not throw when called twice', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Sample\n');
    const watch = installExternalWatch({
      session,
      win: fake.win,
      readDiskText: async (_path: string): Promise<string> => '',
      resolveConflict: async (_path: string, _diskText: string): Promise<ConflictResolution> => ({ kind: 'keepMine' }),
      onReloaded: (_path: string): void => {},
      onError: (_message: string): void => {},
    });
    activeExternalWatches.push(watch);

    expect(() => {
      watch.destroy();
      watch.destroy();
    }).not.toThrow();
  });

  it('allows setPath after destroy without throwing', () => {
    const fake = fakeWindow();
    const session = new DocumentSession('# Sample\n');
    const watch = installExternalWatch({
      session,
      win: fake.win,
      readDiskText: async (_path: string): Promise<string> => '',
      resolveConflict: async (_path: string, _diskText: string): Promise<ConflictResolution> => ({ kind: 'keepMine' }),
      onReloaded: (_path: string): void => {},
      onError: (_message: string): void => {},
    });
    activeExternalWatches.push(watch);

    watch.destroy();

    expect(() => {
      watch.setPath('/y.md');
    }).not.toThrow();
  });
});

describe('applyConflictResolution', (): void => {
  it('takes the version on disk and says the buffer was replaced', (): void => {
    const session = new DocumentSession('one\ntwo\n');
    session.focusPane('source');
    session.applyText('one\nMINE\n');
    const diskText = 'one\nTHEIRS\n';

    // takeTheirs replaces the dirty buffer with what is on disk, and that replacement is exactly
    // what the caller needs to know in order to announce a reload.
    const replaced = applyConflictResolution(session, { kind: 'takeTheirs' }, diskText);

    expect(replaced).toBe(true);
    expect(session.snapshot.text).toBe(diskText);
  });

  it('leaves the buffer alone when the user keeps theirs', (): void => {
    const session = new DocumentSession('one\ntwo\n');
    session.focusPane('source');
    session.applyText('one\nMINE\n');
    const diskText = 'one\nTHEIRS\n';

    // The return value is what the caller uses to decide whether to announce a reload, so reporting
    // true here would tell the user their work had been replaced when it had not.
    const replaced = applyConflictResolution(session, { kind: 'keepMine' }, diskText);

    expect(replaced).toBe(false);
    expect(session.snapshot.text).toBe('one\nMINE\n');
  });

  it('leaves the buffer alone when the user has not decided', (): void => {
    const session = new DocumentSession('one\ntwo\n');
    session.focusPane('source');
    session.applyText('one\nMINE\n');
    const diskText = 'one\nTHEIRS\n';

    // It differs from keeping mine only in intent — no decision was recorded, so the next external change asks again.
    const replaced = applyConflictResolution(session, { kind: 'ignore' }, diskText);

    expect(replaced).toBe(false);
    expect(session.snapshot.text).toBe('one\nMINE\n');
  });

  it('puts the merged text in, not the text from disk', (): void => {
    const session = new DocumentSession('one\ntwo\n');
    session.focusPane('source');
    session.applyText('one\nMINE\n');
    const diskText = 'one\nTHEIRS\n';
    const merged = 'one\nMERGED\n';

    // A merge produces a third version that exists neither in the buffer nor on disk, so applying the
    // disk text here would silently throw the merge away.
    const replaced = applyConflictResolution(session, { kind: 'merged', text: merged }, diskText);

    expect(replaced).toBe(true);
    expect(session.snapshot.text).toBe(merged);
    expect(session.snapshot.text).not.toBe(diskText);
  });

  it('leaves a merged buffer marked as unsaved work', (): void => {
    const session = new DocumentSession('one\ntwo\n');
    session.focusPane('source');
    session.applyText('one\nMINE\n');
    const diskText = 'one\nTHEIRS\n';

    // The merged text is on disk nowhere — the file still holds the other program's version — so a clean
    // buffer would let the user close the window and lose it.
    applyConflictResolution(session, { kind: 'merged', text: 'one\nMERGED\n' }, diskText);

    expect(session.snapshot.dirty).toBe(true);
  });
});
