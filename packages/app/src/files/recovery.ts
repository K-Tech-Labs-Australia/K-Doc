/**
 * @file recovery.ts
 * @purpose Implements crash-recovery buffer journalling and startup recovery candidate selection for K-Doc (FR-6.3).
 *   Journals dirty document buffers to the crash journal on a short debounce regardless of whether the document has an on-disk path,
 *   enables immediate flushing and clearing on successful save, and evaluates recoverable journal records sorted newest first.
 * @inputs RecoveryOptions containing DocumentSession, JournalStore, Window context, buffer ID, currentPath accessor, and onError callback.
 * @outputs Recovery controller interface exposing flush, clear, and destroy lifecycle methods, alongside pickRecoverable, describeRecord, and JOURNAL_DEBOUNCE_MS.
 * @functions
 *   - isTextChangingReason: Helper determining whether a session change reason represents a text modification requiring debounce timer restart.
 *   - installRecovery: Instantiates and activates the crash-recovery controller, binds document session change listeners, and returns the Recovery controller.
 *   - pickRecoverable: Filters journal records that warrant offering recovery against current disk contents and sorts them newest first.
 *   - extractRecordName: Helper extracting the display file name from a journal record path, falling back to 'Untitled' when null or empty.
 *   - formatRecordAge: Helper formatting elapsed milliseconds into human-readable relative age strings ('just now', 'N minutes ago', 'N hours ago', 'N days ago').
 *   - describeRecord: Formats a one-line human-readable summary of a journal record for user prompts.
 * @dataflow DocumentSession changes -> debounce timer -> store.write(bufferId, path, text); Startup journal records -> isRecoverable() filter -> sort by saved_at_ms -> describeRecord() formatting.
 * @controlflow Subscribe to DocumentSession -> restart debounce timer on text changes -> write buffer to JournalStore when timer fires or on flush() -> clear journal on save -> pick and describe recoverable records on startup.
 * @version 1
 * @date 2026-09-05
 */

import type { DocumentSession } from '@k-doc/core';
import type { JournalStore, JournalRecord } from './journal.js';
import { isRecoverable } from './journal.js';

/**
 * Debounce duration in milliseconds before persisting uncommitted buffer changes to journal storage (800ms).
 *
 * The journal exists to bound how much work a crash can destroy, so it wants to be shorter than the
 * autosave idle window, not equal to it — autosave writes the user's real file and can afford to wait
 * for a pause in typing; the journal writes a scratch file and should not.
 */
export const JOURNAL_DEBOUNCE_MS: number = 800;

export interface RecoveryOptions {
  readonly session: DocumentSession;
  readonly store: JournalStore;
  readonly win: Window;
  /** Stable id for this document buffer. Must match [A-Za-z0-9_-] — the Rust side rejects anything else. */
  readonly bufferId: string;
  readonly currentPath: () => string | null;
  readonly onError: (message: string) => void;
}

export interface Recovery {
  /** Journals now rather than waiting for the debounce. */
  flush(): void;
  /** Drops this buffer's journal. Call after a successful save to the real file. */
  clear(): void;
  destroy(): void;
}

/** Milliseconds per second. */
const MS_PER_SECOND: number = 1000;
/** Milliseconds per minute (60 seconds). */
const MS_PER_MINUTE: number = 60 * MS_PER_SECOND;
/** Milliseconds per hour (60 minutes). */
const MS_PER_HOUR: number = 60 * MS_PER_MINUTE;
/** Milliseconds per day (24 hours). */
const MS_PER_DAY: number = 24 * MS_PER_HOUR;

/**
 * Helper determining whether a session change reason corresponds to a document text mutation.
 *
 * @purpose Evaluates whether a session change reason represents a text modification requiring journal debounce timer restart.
 * @inputs reason - The session change reason string ('edit' | 'external' | 'undo' | 'redo' | 'focus' | 'reset').
 * @outputs boolean - True if the reason modifies document text; false otherwise.
 * @dataflow reason -> equality checks -> boolean result.
 * @controlflow Check if reason is 'edit', 'external', 'undo', or 'redo' -> return true -> else return false.
 */
function isTextChangingReason(reason: string): boolean {
  // Check if reason is one of the text-modifying change reasons.
  if (
    reason === 'edit' ||
    reason === 'external' ||
    reason === 'undo' ||
    reason === 'redo'
  ) {
    // Branch: Reason indicates text was modified; journal debounce timer should restart.
    return true;
  } else {
    // Branch: Reason is 'focus' or 'reset'; focus does not modify text, and reset reloads saved content.
    return false;
  }
}

/**
 * Instantiates and activates the crash-recovery controller for a document buffer session.
 *
 * @purpose Subscribes to document session edits, debounces scratch journal persistence, and provides flush/clear lifecycle operations.
 * @inputs options - RecoveryOptions containing session, journal store, window context, buffer ID, currentPath probe, and onError callback.
 * @outputs Recovery - Controller interface exposing flush, clear, and destroy lifecycle methods.
 * @dataflow options.session change events -> debounce timer -> options.store.write(bufferId, path, text).
 * @controlflow Subscribe to DocumentSession changes -> on text changes restart debounce timer -> when timer fires or on flush() invoke store.write -> catch errors to onError -> clear store on clear() -> unsubscribe on destroy().
 */
export function installRecovery(options: RecoveryOptions): Recovery {
  let destroyed: boolean = false;
  let timerHandle: number | null = null;
  let unsubscribeSession: (() => void) | null = null;

  /**
   * Cancels any currently pending journal debounce timer and resets the handle state.
   *
   * @purpose Clears scheduled debounce timeout on options.win to prevent orphaned timer callbacks and duplicate writes.
   * @inputs void.
   * @outputs void.
   * @dataflow timerHandle -> options.win.clearTimeout -> null.
   * @controlflow Check if timerHandle is non-null -> call options.win.clearTimeout -> reset timerHandle to null.
   */
  function clearTimer(): void {
    // Check if an active journal debounce timer handle exists.
    if (timerHandle !== null) {
      // Active timer exists: cancel it using window.clearTimeout.
      options.win.clearTimeout(timerHandle);
      timerHandle = null;
    } else {
      // No active timer handle to cancel.
    }
  }

  /**
   * Writes the live buffer snapshot to journal storage if the document is currently dirty.
   *
   * @purpose Persists live document text to JournalStore regardless of path, catching errors and notifying options.onError.
   * @inputs void.
   * @outputs void.
   * @dataflow options.session.snapshot -> options.store.write() -> error catch -> options.onError().
   * @controlflow Check destroyed guard -> check dirty flag (skip if clean) -> invoke store.write -> attach catch routing message to onError.
   */
  function writeJournal(): void {
    // Check if the recovery controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: abort journal write.
      return;
    } else {
      // Controller is active: verify dirty state.
    }

    // Check if the document session contains unsaved modifications.
    // Skip journalling when the session is not dirty — re-writing a journal identical
    // to the saved file just burns disk on every keystroke pause.
    if (!options.session.snapshot.dirty) {
      // Document is clean: no unsaved modifications exist to journal.
      return;
    } else {
      // Document is dirty: proceed with persisting live buffer.
    }

    // Journal regardless of whether the document has a path, unlike autosave:
    // an unsaved, never-named document is precisely the one with nothing else protecting it.
    const path = options.currentPath();
    const text = options.session.snapshot.text;

    // A journal failure must be reported but must not throw into the editing path —
    // losing the safety net is bad, taking the editor down with it is worse.
    options.store.write(options.bufferId, path, text).catch((err: unknown): void => {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error message to caller onError handler.
        options.onError(err.message);
      } else {
        // Branch: Convert non-Error value to string and forward to error handler.
        options.onError(String(err));
      }
    });
  }

  /**
   * Flushes the live buffer to journal storage immediately, clearing any pending debounce timer.
   *
   * @purpose Forces immediate persistence of unsaved buffer content without waiting for debounce expiration.
   * @inputs void.
   * @outputs void.
   * @dataflow clearTimer() -> writeJournal().
   * @controlflow Check destroyed guard -> clear pending timer -> write live buffer to store if dirty.
   */
  function flush(): void {
    // Check if the recovery controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore flush request.
      return;
    } else {
      // Controller is active: clear pending timer and write journal immediately.
    }

    clearTimer();
    writeJournal();
  }

  /**
   * Drops this buffer's journal record from storage and cancels any pending debounce timer.
   *
   * @purpose Cleans up persisted journal data after a successful save to the real on-disk file.
   * @inputs void.
   * @outputs void.
   * @dataflow clearTimer() -> options.store.clear() -> error catch -> options.onError().
   * @controlflow Check destroyed guard -> clear pending timer -> invoke store.clear -> catch error and route to onError.
   */
  function clear(): void {
    // Check if the recovery controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore clear request.
      return;
    } else {
      // Controller is active: cancel pending timer and delete persisted journal record.
    }

    clearTimer();

    // A journal failure must be reported but must not throw into the editing path —
    // losing the safety net is bad, taking the editor down with it is worse.
    options.store.clear(options.bufferId).catch((err: unknown): void => {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error message to caller onError handler.
        options.onError(err.message);
      } else {
        // Branch: Convert non-Error value to string and forward to error handler.
        options.onError(String(err));
      }
    });
  }

  /**
   * Cleans up all resources held by the recovery controller, cancelling timers and unsubscribing from session changes.
   *
   * @purpose Idempotently tears down the recovery controller lifecycle.
   * @inputs void.
   * @outputs void.
   * @dataflow clearTimer() -> unsubscribeSession().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> clear timer -> unsubscribe session listener.
   */
  function destroy(): void {
    // Check if the controller has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active controller: mark destroyed and proceed with resource cleanup.
      destroyed = true;
    }

    clearTimer();

    // Check if session change listener is subscribed.
    if (unsubscribeSession !== null) {
      // Unsubscribe from session change notifications.
      unsubscribeSession();
      unsubscribeSession = null;
    } else {
      // Session listener already unsubscribed or absent.
    }
  }

  // Subscribe to document session changes to react to editing events.
  unsubscribeSession = options.session.subscribe((change): void => {
    // Check if the recovery controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore session change notifications.
      return;
    } else {
      // Active controller: inspect change reason.
    }

    // Check if the session change reason represents a text modification.
    if (isTextChangingReason(change.reason)) {
      // Clear any pending debounce timer before restarting.
      clearTimer();

      // Restart the debounce timer with JOURNAL_DEBOUNCE_MS.
      timerHandle = options.win.setTimeout((): void => {
        timerHandle = null;
        writeJournal();
      }, JOURNAL_DEBOUNCE_MS);
    } else {
      // Non-text-changing reason (e.g. focus or reset): do not restart journal timer.
    }
  });

  return {
    flush,
    clear,
    destroy,
  };
}

/**
 * Filters journal records that warrant offering recovery against current disk contents and sorts them newest first.
 *
 * @purpose Evaluates retrieved journal records against on-disk file state via isRecoverable and orders candidates newest first.
 * @inputs
 *   - records - Array of candidate JournalRecords retrieved from JournalStore.list().
 *   - diskTextFor - Function returning the on-disk file contents for a record, or null if unsaved or absent.
 * @outputs readonly JournalRecord[] - Filtered and descending-sorted array of recoverable journal records.
 * @dataflow records -> isRecoverable() filtering -> descending timestamp sort by saved_at_ms -> sorted records array.
 * @controlflow Iterate records -> filter using isRecoverable(record, diskTextFor(record)) -> sort newest first -> return result array.
 */
export function pickRecoverable(
  records: readonly JournalRecord[],
  diskTextFor: (record: JournalRecord) => string | null,
): readonly JournalRecord[] {
  const recoverable: JournalRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    // Check if record is defined to satisfy strict noUncheckedIndexedAccess.
    if (record === undefined) {
      // Branch: Undefined array element; skip.
      continue;
    } else {
      // Branch: Record is defined; test if recoverable.
    }

    // Check if record contents differs from disk state and is non-empty.
    if (isRecoverable(record, diskTextFor(record))) {
      // Branch: Record warrants offering recovery to user; retain.
      recoverable.push(record);
    } else {
      // Branch: Record is empty or matches on-disk content; omit.
    }
  }

  // Sort newest first by saved_at_ms.
  // Newest-first matters because the user is being asked a question about their own recent work
  // and the most recent buffer is the one they remember.
  recoverable.sort((a, b): number => {
    // Compare timestamps in descending order so newest records appear first.
    if (b.saved_at_ms > a.saved_at_ms) {
      // Record b is newer than record a; b sorts before a.
      return 1;
    } else if (b.saved_at_ms < a.saved_at_ms) {
      // Record a is newer than record b; a sorts before b.
      return -1;
    } else {
      // Timestamps are equal; maintain stable relative order.
      return 0;
    }
  });

  return recoverable;
}

/**
 * Extracts the display file name from a journal record path, falling back to 'Untitled' when null or empty.
 *
 * @purpose Splits path on POSIX and Windows delimiters and returns the final non-empty path segment.
 * @inputs path - File path string or null from the journal record.
 * @outputs string - The extracted file name or 'Untitled'.
 * @dataflow path -> delimiter split -> reverse scan for non-empty segment -> file name.
 * @controlflow Check if path is null -> return 'Untitled' -> split on / and \ -> iterate backwards -> return first non-empty segment -> fallback to 'Untitled'.
 */
function extractRecordName(path: string | null): string {
  // Check if path is null.
  if (path === null) {
    // Record has no associated file path on disk: use 'Untitled'.
    return 'Untitled';
  } else {
    // Path is present: parse file name from last path segment.
  }

  // Split path on both forward and backward slashes to handle POSIX and Windows separators.
  const segments = path.split(/[/\\]/);
  // Iterate backwards to find the last non-empty segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    // Check if segment is defined and non-empty to satisfy strict noUncheckedIndexedAccess.
    if (segment !== undefined && segment.length > 0) {
      // Found the last non-empty segment representing the file name.
      return segment;
    } else {
      // Segment is empty (e.g. from trailing slashes); continue backwards search.
    }
  }

  // Path contained only slash separators with no non-empty segment: fall back to 'Untitled'.
  return 'Untitled';
}

/**
 * Formats elapsed time in milliseconds into a human-readable relative age string.
 *
 * @purpose Computes human-friendly relative time descriptions ('just now', 'N minutes ago', 'N hours ago', 'N days ago') with singularization.
 * @inputs diffMs - Difference in milliseconds between reference timestamp and record save timestamp (now - record.saved_at_ms).
 * @outputs string - Relative age string suitable for display in recovery prompt dialogs.
 * @dataflow diffMs -> threshold comparisons and division -> formatted relative age string.
 * @controlflow Check negative/non-finite diffMs -> return 'just now' -> check < 60s -> return 'just now' -> check < 60min -> format minutes -> check < 24h -> format hours -> format days.
 */
function formatRecordAge(diffMs: number): string {
  // Check if the elapsed time is negative or non-finite (e.g. system clock was adjusted backwards).
  // A negative age (a clock that moved backwards) renders as 'just now' rather than a negative count.
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    // Clock moved backwards or timestamp is invalid: render as 'just now'.
    return 'just now';
  } else if (diffMs < MS_PER_MINUTE) {
    // Elapsed time is under 60 seconds: render as 'just now'.
    return 'just now';
  } else if (diffMs < MS_PER_HOUR) {
    // Elapsed time is under 60 minutes: calculate elapsed whole minutes.
    const minutes = Math.floor(diffMs / MS_PER_MINUTE);
    // Check if elapsed minutes is 1 for singularization.
    // "1 minutes ago" in a dialog asking someone to trust a recovery is exactly the detail that makes them doubt it.
    if (minutes === 1) {
      // Singular minute form.
      return '1 minute ago';
    } else {
      // Plural minutes form.
      return `${minutes} minutes ago`;
    }
  } else if (diffMs < MS_PER_DAY) {
    // Elapsed time is under 24 hours: calculate elapsed whole hours.
    const hours = Math.floor(diffMs / MS_PER_HOUR);
    // Check if elapsed hours is 1 for singularization.
    // "1 hours ago" in a dialog asking someone to trust a recovery is exactly the detail that makes them doubt it.
    if (hours === 1) {
      // Singular hour form.
      return '1 hour ago';
    } else {
      // Plural hours form.
      return `${hours} hours ago`;
    }
  } else {
    // Elapsed time is 24 hours or greater: calculate elapsed whole days.
    const days = Math.floor(diffMs / MS_PER_DAY);
    // Check if elapsed days is 1 for singularization.
    // "1 days ago" in a dialog asking someone to trust a recovery is exactly the detail that makes them doubt it.
    if (days === 1) {
      // Singular day form.
      return '1 day ago';
    } else {
      // Plural days form.
      return `${days} days ago`;
    }
  }
}

/**
 * Generates a human-readable one-line description of a journal record for recovery prompts.
 *
 * @purpose Combines the extracted document name and formatted relative age into a prompt string (e.g. "notes.md — 3 minutes ago").
 * @inputs
 *   - record - The candidate JournalRecord retrieved from storage.
 *   - now - Current reference timestamp in milliseconds since Unix epoch.
 * @outputs string - Formatted single-line record description.
 * @dataflow record and now -> name extraction + age calculation -> `${name} — ${age}`.
 * @controlflow Extract file name via extractRecordName -> calculate diffMs -> format age via formatRecordAge -> return combined template string.
 */
export function describeRecord(record: JournalRecord, now: number): string {
  const name = extractRecordName(record.path);
  const diffMs = now - record.saved_at_ms;
  const age = formatRecordAge(diffMs);

  return `${name} — ${age}`;
}
