// @vitest-environment jsdom
/**
 * @file status-bar-preference.spec.ts
 * @purpose Verifies reading, writing, and discovery of the persisted status bar visibility preference.
 * @inputs StatusBarStore doubles (plain objects / throwing accessors) and Window shims; jsdom DOM environment.
 * @outputs Vitest assertions validating STATUS_BAR_KEY, readStatusBarVisibility, writeStatusBarVisibility, and statusBarStore.
 * @functions
 *   - memoryStore: Builds an in-memory StatusBarStore double seeded from an optional record.
 * @dataflow initial values -> store.data object -> getItem/setItem accessors -> module functions -> assertions.
 * @controlflow Tests grouped into key constant, persistence round-trips, null-store handling, storage-error isolation, and window-localStorage discovery suites.
 * @version 1
 * @date 2026-10-04
 */

import { describe, expect, it } from 'vitest';
import {
  STATUS_BAR_KEY,
  readStatusBarVisibility,
  statusBarStore,
  writeStatusBarVisibility,
} from '../src/shell/status-bar-preference.js';
import type { StatusBarStore } from '../src/shell/status-bar-preference.js';

/**
 * Creates an in-memory StatusBarStore backed by a plain object.
 * @purpose Supplies a controllable storage double whose reads and writes mutate `data`.
 * @inputs initial - Record<string, string>: Optional key/value pairs pre-seeding the store (default empty).
 * @outputs StatusBarStore & { data: Record<string, string> }: A store exposing its backing object via `data`.
 * @dataflow initial -> shallow-copied record stored in `data` -> getItem/setItem operate on that same record.
 * @controlflow Direct property access with no branching; setItem overwrites any existing entry for a key.
 */
function memoryStore(
  initial: Record<string, string> = {},
): StatusBarStore & { data: Record<string, string> } {
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

describe('STATUS_BAR_KEY', (): void => {
  it('exposes the status bar storage key constant', (): void => {
    expect(STATUS_BAR_KEY).toBe('kdoc.statusbar.v1');
  });
});

describe('readStatusBarVisibility / writeStatusBarVisibility persistence', (): void => {
  it('round-trips the "hidden" state through storage', (): void => {
    const store = memoryStore();
    // Persist then read back to confirm a full cycle preserves the value.
    writeStatusBarVisibility(store, 'hidden');
    expect(readStatusBarVisibility(store)).toBe('hidden');
  });

  it('round-trips the "shown" state through storage', (): void => {
    const store = memoryStore();
    // Persist then read back to confirm a full cycle preserves the value.
    writeStatusBarVisibility(store, 'shown');
    expect(readStatusBarVisibility(store)).toBe('shown');
  });

  it('returns null when no state has been written', (): void => {
    const store = memoryStore();
    // No prior write: read must report an absent preference as null.
    expect(readStatusBarVisibility(store)).toBeNull();
  });

  it('returns null for an unrecognised persisted value', (): void => {
    const store = memoryStore({ [STATUS_BAR_KEY]: 'expanded' });
    // Unknown values are rejected and reported as absent rather than surfaced.
    expect(readStatusBarVisibility(store)).toBeNull();
  });
});

describe('readStatusBarVisibility / writeStatusBarVisibility with a null store', (): void => {
  it('reads null when the store is null', (): void => {
    // Absent storage: read must degrade gracefully to null.
    expect(readStatusBarVisibility(null)).toBeNull();
  });

  it('does nothing and does not throw when writing to a null store', (): void => {
    // Absent storage: write is a no-op that swallows the missing target silently.
    expect(() => writeStatusBarVisibility(null, 'hidden')).not.toThrow();
  });
});

describe('readStatusBarVisibility error isolation', (): void => {
  it('reads null when getItem raises a SecurityError (blocked storage)', (): void => {
    const blocked: StatusBarStore = {
      // Simulate a sandboxed iframe whose localStorage access is denied.
      getItem(): string | null {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem(): void {},
    } as unknown as StatusBarStore;

    // Security errors are treated like an absent preference and swallowed on read.
    expect(readStatusBarVisibility(blocked)).toBeNull();
  });

  it('propagates a non-security error from getItem on read', (): void => {
    const broken: StatusBarStore = {
      // A genuine defect must surface rather than be masked as "no preference".
      getItem(): string | null {
        throw new TypeError('bug');
      },
      setItem(): void {},
    } as unknown as StatusBarStore;

    expect(() => readStatusBarVisibility(broken)).toThrow(TypeError);
  });
});

describe('writeStatusBarVisibility error isolation', (): void => {
  it('does not throw when setItem raises a QuotaExceededError (full storage)', (): void => {
    const full: StatusBarStore = {
      getItem(): string | null {
        return null;
      },
      // Simulate an exceeded local-storage quota on write.
      setItem(_key: string, _value: string): void {
        throw new DOMException('full', 'QuotaExceededError');
      },
    } as unknown as StatusBarStore;

    // Quota errors are swallowed silently so a failed persist never crashes the app.
    expect(() => writeStatusBarVisibility(full, 'hidden')).not.toThrow();
  });

  it('propagates a non-security error from setItem on write', (): void => {
    const broken: StatusBarStore = {
      getItem(): string | null {
        return null;
      },
      // A genuine defect must surface rather than be masked as success.
      setItem(_key: string, _value: string): void {
        throw new TypeError('bug');
      },
    } as unknown as StatusBarStore;

    expect(() => writeStatusBarVisibility(broken, 'hidden')).toThrow(TypeError);
  });
});

describe('statusBarStore discovery', (): void => {
  it('returns the window localStorage object when it is accessible', (): void => {
    const store = memoryStore();
    // A readable localStorage should be returned as-is without wrapping.
    const win = { localStorage: store } as unknown as Window;

    expect(statusBarStore(win)).toBe(store);
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
    expect(statusBarStore(win as unknown as Window)).toBeNull();
  });
});
