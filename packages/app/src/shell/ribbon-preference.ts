/**
 * @file ribbon-preference.ts
 * @purpose Remembers whether the reader left the ribbon expanded, collapsed or hidden so a ribbon hidden to save space stays hidden across launches; persists RibbonState in localStorage under a single key.
 * @inputs A Storage-backed store (or null) for read/write operations, a Window whose localStorage is wrapped into a store, and the target RibbonState value being written.
 * @outputs RIBBON_STATE_KEY constant, RibbonStateStore interface, plus readRibbonState, writeRibbonState, and ribbonStateStore helpers.
 * @functions
 *   - readRibbonState: Reads the persisted RibbonState from a store, returning null when absent, unrecognised, or storage is blocked.
 *   - writeRibbonState: Persists a RibbonState to a store, swallowing DOMException failures so persistence never breaks the ribbon.
 *   - ribbonStateStore: Wraps Window.localStorage into a RibbonStateStore, returning null when access is denied.
 * @dataflow Window.localStorage -> ribbonStateStore produces a RibbonStateStore | null; readRibbonState and writeRibbonState translate between RibbonState values and stored strings under RIBBON_STATE_KEY.
 * @controlflow Guard against a null store -> attempt storage access guarded by try/catch for DOMException -> return or propagate based on the outcome of each branch.
 * @version 1
 * @date 2026-10-04
 */

import type { RibbonState } from './ribbon.js';

/** localStorage key holding the last ribbon state. */
export const RIBBON_STATE_KEY: string = 'kdoc.ribbon.v1';

/** The storage operations used; a Storage satisfies it, tests pass a fake. */
export interface RibbonStateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Reads the persisted ribbon state from a store into a typed RibbonState.
 * @purpose Restores the reader's last ribbon visibility preference ('expanded', 'collapsed', or 'hidden') so it survives relaunches.
 * @inputs store - RibbonStateStore to read from, or null when no storage is available.
 * @outputs RibbonState | null - The persisted state, or null when absent, unrecognised, or storage access failed.
 * @dataflow store.getItem(RIBBON_STATE_KEY) -> raw string -> validation against the three known states -> typed RibbonState or null.
 * @controlflow Guard null store -> read guarded by try/catch for DOMException -> validate raw value -> return state or null.
 */
export function readRibbonState(store: RibbonStateStore | null): RibbonState | null {
  // Check whether a store was provided; absence means there is nowhere to read from.
  if (store === null) {
    // No store available: treat as nothing saved so the ribbon falls back to its default state.
    return null;
  } else {
    // Store present: proceed to read the persisted value below.
  }

  let raw: string | null = null;
  try {
    raw = store.getItem(RIBBON_STATE_KEY);
  } catch (error) {
    // Storage can be blocked by browser policy, which throws a DOMException; that reads as "nothing saved", anything else is a defect and propagates.
    if (error instanceof DOMException) {
      // Access denied: read back nothing so the ribbon falls back to its default state.
      return null;
    } else {
      // Unexpected failure: propagate rather than mask a real defect.
      throw error;
    }
  }

  // Check whether raw holds one of the three recognised RibbonState values.
  if (raw === 'expanded' || raw === 'collapsed' || raw === 'hidden') {
    // Recognised persisted state: return it directly as a valid, typed RibbonState.
    return raw;
  } else {
    // Absent or unrecognised value: read back nothing saved so the ribbon falls back to its default state.
    return null;
  }
}

/**
 * Persists the reader's last ribbon visibility preference into a store.
 * @purpose Writes RibbonState ('expanded', 'collapsed', or 'hidden') under RIBBON_STATE_KEY so it survives relaunches without ever breaking the ribbon.
 * @inputs store - RibbonStateStore to write to, or null when no storage is available (write becomes a no-op).
 *         state - The target RibbonState value to persist.
 * @outputs void - No return value; persistence is best-effort and failures are swallowed for DOMException.
 * @dataflow state -> store.setItem(RIBBON_STATE_KEY, state) -> persisted string under the ribbon key.
 * @controlflow Guard null store -> write guarded by try/catch for DOMException -> swallow access errors or propagate others.
 */
export function writeRibbonState(store: RibbonStateStore | null, state: RibbonState): void {
  // Check whether a store was provided; absence means there is nowhere to persist the preference.
  if (store === null) {
    // No store available: silently drop — persistence is best-effort and must not break the ribbon.
    return;
  } else {
    // Store present: proceed to write the value below.
  }

  try {
    store.setItem(RIBBON_STATE_KEY, state);
  } catch (error) {
    // A full or blocked store loses the preference but must not break the ribbon; anything else propagates.
    if (error instanceof DOMException) {
      // Access denied or quota exceeded: drop silently so the ribbon keeps working.
      return;
    } else {
      // Unexpected failure: propagate rather than mask a real defect.
      throw error;
    }
  }
}

/**
 * Wraps Window.localStorage into a RibbonStateStore for use by read/write helpers.
 * @purpose Obtains the storage backend from a Window, returning null when localStorage access is denied or unavailable.
 * @inputs win - The target Window whose localStorage property supplies the store.
 * @outputs RibbonStateStore | null - A Storage-backed store, or null when reading localStorage itself throws.
 * @dataflow win.localStorage -> RibbonStateStore (or null on DOMException).
 * @controlflow Attempt to read localStorage guarded by try/catch for DOMException -> return store or null.
 */
export function ribbonStateStore(win: Window): RibbonStateStore | null {
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
