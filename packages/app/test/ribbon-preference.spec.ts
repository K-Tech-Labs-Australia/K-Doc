// @vitest-environment jsdom
/**
 * @file ribbon-preference.spec.ts
 * @purpose Verifies reading, writing, and discovery of the persisted ribbon collapse preference.
 * @inputs RibbonStateStore doubles (plain objects / throwing accessors) and Window shims; jsdom DOM environment.
 * @outputs Vitest assertions validating RIBBON_STATE_KEY, readRibbonState, writeRibbonState, and ribbonStateStore.
 * @functions
 *   - memoryStore: Builds an in-memory RibbonStateStore double seeded from an optional record.
 * @dataflow initial values -> store.data object -> getItem/setItem accessors -> module functions -> assertions.
 * @controlflow Tests grouped into key constant, persistence round-trips, null-store handling, storage-error isolation, and window-localStorage discovery suites.
 * @version 1
 * @date 2026-10-04
 */

import { describe, expect, it } from 'vitest';
import {
  RIBBON_STATE_KEY,
  readRibbonState,
  ribbonStateStore,
  writeRibbonState,
} from '../src/shell/ribbon-preference.js';
import type { RibbonStateStore } from '../src/shell/ribbon-preference.js';

/**
 * Creates an in-memory RibbonStateStore backed by a plain object.
 * @purpose Supplies a controllable storage double whose reads and writes mutate `data`.
 * @inputs initial - Record<string, string>: Optional key/value pairs pre-seeding the store (default empty).
 * @outputs RibbonStateStore & { data: Record<string, string> }: A store exposing its backing object via `data`.
 * @dataflow initial -> shallow-copied record stored in `data` -> getItem/setItem operate on that same record.
 * @controlflow Direct property access with no branching; setItem overwrites any existing entry for a key.
 */
function memoryStore(
  initial: Record<string, string> = {},
): RibbonStateStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string): string | null {
      // Return the stored value when present; otherwise report absence as null.
      return data[key] ?? null;
    },
    setItem(key: string, value: string): void {
      // Persist `value` under `key`, replacing any previously stored entry.
      data[key] = value;
    },
  };
}

describe('RIBBON_STATE_KEY', (): void => {
  it('exposes the ribbon state storage key constant', (): void => {
    expect(RIBBON_STATE_KEY).toBe('kdoc.ribbon.v1');
  });
});

describe('readRibbonState / writeRibbonState persistence', (): void => {
  it('round-trips the "hidden" state through storage', (): void => {
    const store = memoryStore();
    // Persist then read back to confirm a full cycle preserves the value.
    writeRibbonState(store, 'hidden');
    expect(readRibbonState(store)).toBe('hidden');
  });

  it('round-trips the "collapsed" state through storage', (): void => {
    const store = memoryStore();
    // Persist then read back to confirm a full cycle preserves the value.
    writeRibbonState(store, 'collapsed');
    expect(readRibbonState(store)).toBe('collapsed');
  });

  it('round-trips the "expanded" state through storage', (): void => {
    const store = memoryStore();
    // Persist then read back to confirm a full cycle preserves the value.
    writeRibbonState(store, 'expanded');
    expect(readRibbonState(store)).toBe('expanded');
  });

  it('returns null when no state has been written', (): void => {
    const store = memoryStore();
    // No prior write: read must report an absent preference as null.
    expect(readRibbonState(store)).toBeNull();
  });

  it('returns null for an unrecognised persisted value', (): void => {
    const store = memoryStore({ [RIBBON_STATE_KEY]: 'sideways' });
    // Unknown values are rejected and reported as absent rather than surfaced.
    expect(readRibbonState(store)).toBeNull();
  });
});

describe('readRibbonState / writeRibbonState with a null store', (): void => {
  it('reads null when the store is null', (): void => {
    // Absent storage: read must degrade gracefully to null.
    expect(readRibbonState(null)).toBeNull();
  });

  it('does nothing and does not throw when writing to a null store', (): void => {
    // Absent storage: write is a no-op that swallows the missing target silently.
    expect(() => writeRibbonState(null, 'expanded')).not.toThrow();
  });
});

describe('readRibbonState error isolation', (): void => {
  it('reads null when getItem raises a SecurityError (blocked storage)', (): void => {
    const blocked: RibbonStateStore = {
      // Simulate a sandboxed iframe whose localStorage access is denied.
      getItem(): string | null {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem(): void {},
    } as unknown as RibbonStateStore;

    // Security errors are treated like an absent preference and swallowed on read.
    expect(readRibbonState(blocked)).toBeNull();
  });

  it('propagates a non-security error from getItem on read', (): void => {
    const broken: RibbonStateStore = {
      // A genuine defect must surface rather than be masked as "no preference".
      getItem(): string | null {
        throw new TypeError('bug');
      },
      setItem(): void {},
    } as unknown as RibbonStateStore;

    expect(() => readRibbonState(broken)).toThrow(TypeError);
  });
});

describe('writeRibbonState error isolation', (): void => {
  it('does not throw when setItem raises a QuotaExceededError (full storage)', (): void => {
    const full: RibbonStateStore = {
      getItem(): string | null {
        return null;
      },
      // Simulate an exceeded local-storage quota on write.
      setItem(_key: string, _value: string): void {
        throw new DOMException('full', 'QuotaExceededError');
      },
    } as unknown as RibbonStateStore;

    // Quota errors are swallowed silently so a failed persist never crashes the app.
    expect(() => writeRibbonState(full, 'expanded')).not.toThrow();
  });

  it('propagates a non-security error from setItem on write', (): void => {
    const broken: RibbonStateStore = {
      getItem(): string | null {
        return null;
      },
      // A genuine defect must surface rather than be masked as success.
      setItem(_key: string, _value: string): void {
        throw new TypeError('bug');
      },
    } as unknown as RibbonStateStore;

    expect(() => writeRibbonState(broken, 'expanded')).toThrow(TypeError);
  });
});

describe('ribbonStateStore discovery', (): void => {
  it('returns the window localStorage object when it is accessible', (): void => {
    const store = memoryStore();
    // A readable localStorage should be returned as-is without wrapping.
    const win = { localStorage: store } as unknown as Window;

    expect(ribbonStateStore(win)).toBe(store);
  });

  it('returns null when reading localStorage raises a SecurityError', (): void => {
    const win: Record<string, unknown> = {};
    // Expose `localStorage` via an accessor getter that throws on access.
    Object.defineProperty(win, 'localStorage', {
      get(): void {
        throw new DOMException('denied', 'SecurityError');
      },
      configurable: true,
    });

    // Access failure is treated as unavailable storage and reported as null.
    expect(ribbonStateStore(win as unknown as Window)).toBeNull();
  });
});
