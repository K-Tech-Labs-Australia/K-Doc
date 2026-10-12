/**
 * @file status-bar-preference.ts
 * @purpose Remembers whether the reader hid the status bar, so it stays hidden on the next launch; persists StatusBarVisibility in localStorage under a single key.
 * @inputs A Storage-backed store (or null) for read/write operations, a Window whose localStorage is wrapped into a store, and the target StatusBarVisibility value being written.
 * @outputs STATUS_BAR_KEY constant, StatusBarStore interface, StatusBarVisibility type, plus readStatusBarVisibility, writeStatusBarVisibility, and statusBarStore helpers.
 * @functions
 *   - readStatusBarVisibility: Reads the persisted StatusBarVisibility from a store, returning null when absent, unrecognised, or storage is blocked.
 *   - writeStatusBarVisibility: Persists a StatusBarVisibility to a store, swallowing DOMException failures so persistence never breaks the status bar.
 *   - statusBarStore: Wraps Window.localStorage into a StatusBarStore, returning null when access is denied.
 * @dataflow Window.localStorage -> statusBarStore produces a StatusBarStore | null; readStatusBarVisibility and writeStatusBarVisibility translate between StatusBarVisibility values and stored strings under STATUS_BAR_KEY.
 * @controlflow Guard against a null store -> attempt storage access guarded by try/catch for DOMException -> return or propagate based on the outcome of each branch.
 * @version 1
 * @date 2026-10-04
 */

/** Allowed status bar visibility preferences. */
export type StatusBarVisibility = 'shown' | 'hidden';

/** localStorage key holding the last status bar visibility state. */
export const STATUS_BAR_KEY: string = 'kdoc.statusbar.v1';

/** The storage operations used; a Storage satisfies it, tests pass a fake. */
export interface StatusBarStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Reads the persisted status bar visibility from a store into a typed StatusBarVisibility.
 * @purpose Restores the reader's last status bar visibility preference ('shown' or 'hidden') so it survives relaunches.
 * @inputs store - StatusBarStore to read from, or null when no storage is available.
 * @outputs StatusBarVisibility | null - The persisted visibility, or null when absent, unrecognised, or storage access failed.
 * @dataflow store.getItem(STATUS_BAR_KEY) -> raw string -> validation against the two known states -> typed StatusBarVisibility or null.
 * @controlflow Guard null store -> read guarded by try/catch for DOMException -> validate raw value -> return visibility or null.
 */
export function readStatusBarVisibility(store: StatusBarStore | null): StatusBarVisibility | null {
  // Check whether a store was provided; absence means there is nowhere to read from.
  if (store === null) {
    // No store available: treat as nothing saved so the status bar falls back to its default state.
    return null;
  } else {
    // Store present: proceed to read the persisted value below.
  }

  let raw: string | null = null;
  try {
    raw = store.getItem(STATUS_BAR_KEY);
  } catch (error) {
    // Storage can be blocked by browser policy, which throws a DOMException; that reads as "nothing saved", anything else is a defect and propagates.
    if (error instanceof DOMException) {
      // Access denied: read back nothing so the status bar falls back to its default state.
      return null;
    } else {
      // Unexpected failure: propagate rather than mask a real defect.
      throw error;
    }
  }

  // Check whether raw holds one of the two recognised StatusBarVisibility values.
  if (raw === 'shown' || raw === 'hidden') {
    // Recognised persisted state: return it directly as a valid, typed StatusBarVisibility.
    return raw;
  } else {
    // Absent or unrecognised value: read back nothing saved so the status bar falls back to its default state.
    return null;
  }
}

/**
 * Persists the reader's last status bar visibility preference into a store.
 * @purpose Writes StatusBarVisibility ('shown' or 'hidden') under STATUS_BAR_KEY so it survives relaunches without ever breaking the status bar.
 * @inputs store - StatusBarStore to write to, or null when no storage is available (write becomes a no-op).
 *         visibility - The target StatusBarVisibility value to persist.
 * @outputs void - No return value; persistence is best-effort and failures are swallowed for DOMException.
 * @dataflow visibility -> store.setItem(STATUS_BAR_KEY, visibility) -> persisted string under the status bar key.
 * @controlflow Guard null store -> write guarded by try/catch for DOMException -> swallow access errors or propagate others.
 */
export function writeStatusBarVisibility(store: StatusBarStore | null, visibility: StatusBarVisibility): void {
  // Check whether a store was provided; absence means there is nowhere to persist the preference.
  if (store === null) {
    // No store available: silently drop — persistence is best-effort and must not break the status bar.
    return;
  } else {
    // Store present: proceed to write the value below.
  }

  try {
    store.setItem(STATUS_BAR_KEY, visibility);
  } catch (error) {
    // A full or blocked store loses the preference but must not break the status bar; anything else propagates.
    if (error instanceof DOMException) {
      // Access denied or quota exceeded: drop silently so the status bar keeps working.
      return;
    } else {
      // Unexpected failure: propagate rather than mask a real defect.
      throw error;
    }
  }
}

/**
 * Wraps Window.localStorage into a StatusBarStore for use by read/write helpers.
 * @purpose Obtains the storage backend from a Window, returning null when localStorage access is denied or unavailable.
 * @inputs win - The target Window whose localStorage property supplies the store.
 * @outputs StatusBarStore | null - A Storage-backed store, or null when reading localStorage itself throws.
 * @dataflow win.localStorage -> StatusBarStore (or null on DOMException).
 * @controlflow Attempt to read localStorage guarded by try/catch for DOMException -> return store or null.
 */
export function statusBarStore(win: Window): StatusBarStore | null {
  try {
    return win.localStorage;
  } catch (error) {
    // Reading localStorage itself throws when storage is disabled, so report no store rather than crash the shell.
    if (error instanceof DOMException) {
      // Access denied or storage unavailable: report no store so callers fall back to in-memory behaviour.
      return null;
    } else {
      // Unexpected failure: propagate rather than mask a real defect.
      throw error;
    }
  }
}
