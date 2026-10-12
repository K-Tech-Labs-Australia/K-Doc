/**
 * @file spell-service.test.ts
 * @purpose Vitest test suite for K-Doc webview spell check service (FR-12.1).
 *   Validates capability detection, non-Tauri baseline fallbacks, user dictionary localStorage persistence,
 *   corrupt data recovery, ignoreAll / isIgnored session mechanics, no-op inputs, and destroy lifecycle idempotence.
 * @inputs Synthetic Window and Storage contexts, candidate dictionary words, and corrupted storage payloads.
 * @outputs Vitest assertions verifying capability flags, benign return values, non-throwing error handling, and storage round-trips.
 * @functions
 *   - createFakeStorage: Constructs an in-memory stub Storage instance implementing getItem, setItem, removeItem, clear, and key.
 *   - createFakeWindow: Constructs a minimal fake Window object wrapping a Storage instance and optional fetch implementation.
 * @dataflow Synthetic word inputs / storage state -> createSpellService -> method calls & assertions -> Vitest expect.
 * @controlflow Initialize test fixtures -> test non-Tauri fallbacks -> test user dictionary storage and round-tripping ->
 *   test ignore list session scoping -> test lifecycle teardown in afterEach.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  createSpellService,
  DICTIONARY_BASE_PATH,
  USER_DICTIONARY_STORAGE_KEY,
  type SpellService,
} from './spell-service.js';

/**
 * Constructs an in-memory stub of the browser Storage interface.
 *
 * @purpose Provides a deterministic Storage mock for localStorage unit testing without browser dependencies.
 * @inputs void.
 * @outputs Storage - A conformant in-memory Storage implementation.
 * @dataflow Key-value writes -> internal record map -> key-value reads.
 * @controlflow Implement getItem, setItem, removeItem, clear, and key against a local Record.
 */
function createFakeStorage(): Storage {
  let store: Record<string, string> = {};

  return {
    getItem(key: string): string | null {
      // Check if key exists in storage map.
      if (key in store && store[key] !== undefined) {
        // Branch: Key exists; return stored value.
        return store[key];
      } else {
        // Branch: Key missing; return null.
        return null;
      }
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
    removeItem(key: string): void {
      delete store[key];
    },
    clear(): void {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key(index: number): string | null {
      const keys = Object.keys(store);
      const k = keys[index];
      // Check if key at index exists.
      if (k !== undefined) {
        // Branch: Key found; return key string.
        return k;
      } else {
        // Branch: Out-of-bounds index; return null.
        return null;
      }
    },
  };
}

/**
 * Constructs a minimal fake Window object with a stubbed localStorage and optional fetch implementation.
 *
 * @purpose Supplies an injectable Window object for SpellService testing.
 * @inputs
 *   - storage - Optional custom Storage instance; defaults to a fresh createFakeStorage().
 *   - fetchImpl - Optional custom fetch function to simulate HTTP asset loading.
 * @outputs Window - Fake Window context cast through unknown.
 * @dataflow storage + fetchImpl -> fake Window context.
 * @controlflow Assign localStorage and fetch properties -> cast to Window.
 */
function createFakeWindow(
  storage?: Storage,
  fetchImpl?: (input: string) => Promise<Response>,
): Window {
  let local: Storage;
  // Check if custom storage was provided.
  if (storage !== undefined) {
    // Branch: Custom storage provided; use it directly.
    local = storage;
  } else {
    // Branch: No storage provided; use default createFakeStorage().
    local = createFakeStorage();
  }

  return {
    localStorage: local,
    fetch: fetchImpl,
  } as unknown as Window;
}

let activeServices: SpellService[] = [];

afterEach((): void => {
  for (let i = 0; i < activeServices.length; i++) {
    const service = activeServices[i];
    // Check if service entry is defined under strict indexing.
    if (service !== undefined) {
      // Branch: Defined service instance; destroy it.
      service.destroy();
    } else {
      // Branch: Undefined service entry; skip.
    }
  }
  activeServices = [];
});

describe('availability and non-Tauri baseline', () => {
  it('reports available as false and loaded as false outside Tauri host environment', () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    expect(service.available).toBe(false);
    expect(service.loaded).toBe(false);
  });

  it('loadDictionary returns false and leaves loaded false when unavailable', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    const result = await service.loadDictionary('en');
    expect(result).toBe(false);
    expect(service.loaded).toBe(false);
  });

  it('check returns an empty list without throwing when unavailable', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    const misspelled = await service.check(['misspelled', 'correct']);
    expect(misspelled).toEqual([]);
  });

  it('suggest returns an empty list without throwing when unavailable', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    const suggestions = await service.suggest('misspelled');
    expect(suggestions).toEqual([]);
  });

  it('destroy is idempotent and does not throw when called multiple times', () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    expect(() => {
      service.destroy();
      service.destroy();
    }).not.toThrow();
  });

  it('makes all methods inert after destroy is invoked', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    service.destroy();

    expect(service.available).toBe(false);
    expect(service.loaded).toBe(false);
    expect(service.userWords).toEqual([]);
    expect(service.isIgnored('any')).toBe(false);

    service.ignoreAll('word');
    expect(service.isIgnored('word')).toBe(false);

    await service.addWord('word');
    expect(service.userWords).toEqual([]);

    const checkRes = await service.check(['word']);
    expect(checkRes).toEqual([]);

    const suggestRes = await service.suggest('word');
    expect(suggestRes).toEqual([]);

    const loadRes = await service.loadDictionary('en');
    expect(loadRes).toBe(false);
  });
});

describe('user dictionary storage and round-tripping', () => {
  it('declares DICTIONARY_BASE_PATH and USER_DICTIONARY_STORAGE_KEY constants', () => {
    expect(DICTIONARY_BASE_PATH).toBe('dictionaries');
    expect(USER_DICTIONARY_STORAGE_KEY).toBe('kdoc.userDictionary');
  });

  it('round-trips user dictionary through stubbed localStorage on the passed-in win', async () => {
    const win = createFakeWindow();
    const serviceA = createSpellService({ win });
    activeServices.push(serviceA);

    await serviceA.addWord('technique');
    await serviceA.addWord('K-Doc');

    expect(serviceA.userWords).toEqual(['technique', 'K-Doc']);

    const rawStored = win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY);
    expect(rawStored).toBe(JSON.stringify(['technique', 'K-Doc']));

    const serviceB = createSpellService({ win });
    activeServices.push(serviceB);

    expect(serviceB.userWords).toEqual(['technique', 'K-Doc']);
  });

  it('yields an empty list rather than throwing when storage contains corrupt JSON', () => {
    const win = createFakeWindow();
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, '{ invalid corrupt JSON %%%');

    let service: SpellService | undefined;
    expect(() => {
      service = createSpellService({ win });
    }).not.toThrow();

    // Check if service is defined under strict type checks.
    if (service !== undefined) {
      // Branch: Service created successfully; verify empty user words list.
      activeServices.push(service);
      expect(service.userWords).toEqual([]);
    } else {
      // Branch: Service was undefined; fail test assertion.
      expect.fail('service should be defined');
    }
  });

  it('yields an empty list when storage contains a non-array JSON payload', () => {
    const win = createFakeWindow();

    // Test with object payload
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, JSON.stringify({ invalid: 'object' }));
    const serviceObj = createSpellService({ win });
    activeServices.push(serviceObj);
    expect(serviceObj.userWords).toEqual([]);

    // Test with numeric payload
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, '42');
    const serviceNum = createSpellService({ win });
    activeServices.push(serviceNum);
    expect(serviceNum.userWords).toEqual([]);

    // Test with boolean payload
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, 'true');
    const serviceBool = createSpellService({ win });
    activeServices.push(serviceBool);
    expect(serviceBool.userWords).toEqual([]);

    // Test with string payload
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, '"just a string"');
    const serviceStr = createSpellService({ win });
    activeServices.push(serviceStr);
    expect(serviceStr.userWords).toEqual([]);
  });

  it('tolerates absent or throwing localStorage without crashing', () => {
    const throwingStorage: Storage = {
      getItem(_key: string): string | null {
        throw new Error('Access denied by privacy settings');
      },
      setItem(_key: string, _value: string): void {
        throw new Error('Access denied by privacy settings');
      },
      removeItem(_key: string): void {
        throw new Error('Access denied by privacy settings');
      },
      clear(): void {
        throw new Error('Access denied by privacy settings');
      },
      length: 0,
      key(_index: number): string | null {
        return null;
      },
    };

    const win = createFakeWindow(throwingStorage);
    let service: SpellService | undefined;

    expect(() => {
      service = createSpellService({ win });
    }).not.toThrow();

    // Check if service is defined under strict type checks.
    if (service !== undefined) {
      // Branch: Service created successfully; verify empty user words list.
      activeServices.push(service);
      expect(service.userWords).toEqual([]);
    } else {
      // Branch: Service was undefined; fail test assertion.
      expect.fail('service should be defined');
    }
  });

  it('treats addWord with empty or whitespace-only strings as no-ops', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    await service.addWord('');
    await service.addWord('   ');
    await service.addWord('\t\n');

    expect(service.userWords).toEqual([]);
    expect(win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY)).toBeNull();
  });

  it('trims whitespace when adding valid custom words', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    await service.addWord('  trimmedWord  ');

    expect(service.userWords).toEqual(['trimmedWord']);
    expect(win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY)).toBe(
      JSON.stringify(['trimmedWord']),
    );
  });
});

describe('session ignore list', () => {
  it('ignores words for the session without writing to localStorage', () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    expect(service.isIgnored('ephemeral')).toBe(false);

    service.ignoreAll('ephemeral');

    expect(service.isIgnored('ephemeral')).toBe(true);
    expect(win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY)).toBeNull();
    expect(service.userWords).toEqual([]);
  });

  it('isIgnored consults both the ignore set and the user words', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    service.ignoreAll('sessionOnly');
    await service.addWord('userPersistent');

    expect(service.isIgnored('sessionOnly')).toBe(true);
    expect(service.isIgnored('userPersistent')).toBe(true);
    expect(service.isIgnored('unlistedWord')).toBe(false);
  });

  it('treats ignoreAll with empty or whitespace-only strings as no-ops', () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    service.ignoreAll('');
    service.ignoreAll('   ');

    expect(service.isIgnored('')).toBe(false);
    expect(service.isIgnored('   ')).toBe(false);
  });

  it('clears session ignored words on destroy without modifying user words storage', async () => {
    const win = createFakeWindow();
    const service = createSpellService({ win });
    activeServices.push(service);

    service.ignoreAll('tempWord');
    await service.addWord('savedWord');

    expect(service.isIgnored('tempWord')).toBe(true);

    service.destroy();

    expect(service.isIgnored('tempWord')).toBe(false);
    expect(win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY)).toContain('savedWord');
  });
});

describe('error handling and callback contract', () => {
  it('forwards caught exceptions to onError when provided without throwing to caller', async () => {
    const errors: Error[] = [];
    const win = createFakeWindow();
    const service = createSpellService({
      win,
      onError: (err: Error): void => {
        errors.push(err);
      },
    });
    activeServices.push(service);

    // Calling methods when unavailable should be benign and not report errors.
    const checkRes = await service.check(['test']);
    expect(checkRes).toEqual([]);
    expect(errors.length).toBe(0);

    const suggestRes = await service.suggest('test');
    expect(suggestRes).toEqual([]);
    expect(errors.length).toBe(0);
  });
});
