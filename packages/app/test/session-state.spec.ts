/**
 * @file session-state.spec.ts
 * @purpose Covers the store behind session restore (FR-6.10): what round-trips, and the many ways a stored session is refused so a launch starts clean rather than half-restored.
 * @inputs a fake SessionStorage and hand-written stored values.
 * @outputs assertions over loadSession, saveSession and clearSession.
 * @functions
 *   - loadSession: describe block asserting restore semantics.
 *   - saveSession: describe block asserting persistence semantics.
 *   - clearSession: describe block asserting reset semantics.
 * @dataflow fake storage -> load/save -> assertions.
 * @controlflow one describe per exported function; each it guards one path or refusal.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_RESTORED_TABS,
  SESSION_STORAGE_KEY,
  clearSession,
  loadSession,
  saveSession,
  type PersistedSession,
  type SessionStorage,
} from '../src/shell/session-state.js';

const SESSION: PersistedSession = {
  version: 1,
  paths: ['C:/notes/a.md', 'C:/notes/b.md'],
  activePath: 'C:/notes/b.md',
  viewMode: 'source',
  splitRatio: 0.3,
  sidebar: { collapsed: false, panelId: 'files' },
  rightSidebar: { collapsed: true, panelId: null },
  scrollWysiwyg: 120,
  scrollSource: 340,
};

function fakeStorage(initial?: string): SessionStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(): string | null {
      return this.value;
    },
    setItem(_key: string, next: string): void {
      this.value = next;
    },
    removeItem(): void {
      this.value = null;
    },
  };
}

function stored(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...SESSION, ...overrides });
}

describe('loadSession', () => {
  // Guards that an empty storage yields nothing to restore.
  it('has nothing to restore on a first launch', () => {
    expect(loadSession(fakeStorage())).toBe(null);
  });

  // Guards full round-trip fidelity of every field.
  it('returns every field it was given', () => {
    const storage = fakeStorage();
    saveSession(storage, SESSION);
    expect(loadSession(storage)).toEqual(SESSION);
  });

  // Guards rejection when the stored version does not match.
  it('refuses a session written by a different version', () => {
    expect(loadSession(fakeStorage(stored({ version: 2 })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ version: undefined })))).toBe(null);
  });

  // Guards rejection of values that are not sessions at all.
  it('refuses a value that is not a session at all', () => {
    expect(loadSession(fakeStorage('not json'))).toBe(null);
    expect(loadSession(fakeStorage('[]'))).toBe(null);
    expect(loadSession(fakeStorage('null'))).toBe(null);
    expect(loadSession(fakeStorage('7'))).toBe(null);
  });

  // Guards rejection of a path list containing anything malformed.
  it('refuses a path list with anything wrong in it', () => {
    expect(loadSession(fakeStorage(stored({ paths: 'C:/a.md' })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ paths: ['C:/a.md', 3] })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ paths: ['C:/a.md', ''] })))).toBe(null);
  });

  // Guards acceptance of a valid session with no files and no active path.
  it('accepts a session with no files and nothing in front', () => {
    const empty = loadSession(fakeStorage(stored({ paths: [], activePath: null })));
    expect(empty?.paths).toEqual([]);
    expect(empty?.activePath).toBe(null);
  });

  // Guards rejection of an active path that is not a string.
  it('refuses an active path that is not a path', () => {
    expect(loadSession(fakeStorage(stored({ activePath: 5 })))).toBe(null);
  });

  // Guards rejection of a view mode the store does not recognize.
  it('refuses a view mode it does not know', () => {
    expect(loadSession(fakeStorage(stored({ viewMode: 'presentation' })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ viewMode: null })))).toBe(null);
  });

  // Guards rejection of measurements that are not real numbers.
  it('refuses a measurement that is not a real number', () => {
    expect(loadSession(fakeStorage(stored({ splitRatio: 'half' })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ scrollWysiwyg: null })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ scrollSource: 'top' })))).toBe(null);
  });

  // Guards rejection of sidebar panels that are not well-formed.
  it('refuses a sidebar that is not a panel', () => {
    expect(loadSession(fakeStorage(stored({ sidebar: null })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ sidebar: { collapsed: 'yes', panelId: null } })))).toBe(null);
    expect(loadSession(fakeStorage(stored({ rightSidebar: { collapsed: false, panelId: 4 } })))).toBe(null);
  });

  // Guards clamping of negative scroll offsets back to the top.
  it('brings a negative scroll back to the top', () => {
    const restored = loadSession(fakeStorage(stored({ scrollWysiwyg: -40, scrollSource: -1 })));
    expect(restored?.scrollWysiwyg).toBe(0);
    expect(restored?.scrollSource).toBe(0);
  });

  // Guards that no more than the cap of tabs are restored.
  it('opens no more files than the cap allows', () => {
    const many = Array.from({ length: MAX_RESTORED_TABS + 5 }, (_unused, index) => `C:/notes/${index}.md`);
    const restored = loadSession(fakeStorage(stored({ paths: many })));
    expect(restored?.paths).toHaveLength(MAX_RESTORED_TABS);
    expect(restored?.paths[0]).toBe('C:/notes/0.md');
  });

  // A literal too large for a double parses as Infinity. JSON.stringify cannot write one -- it emits
  // null -- so the text is built by hand here; an infinite split ratio or scroll offset is not a
  // measurement and must not be restored.
  it('refuses a measurement that parses as infinite', () => {
    const infiniteRatio = stored({}).replace('"splitRatio":0.3', '"splitRatio":1e999');
    expect(JSON.parse(infiniteRatio).splitRatio).toBe(Infinity);
    expect(loadSession(fakeStorage(infiniteRatio))).toBe(null);

    const infiniteScroll = stored({}).replace('"scrollWysiwyg":120', '"scrollWysiwyg":-1e999');
    expect(loadSession(fakeStorage(infiniteScroll))).toBe(null);
  });

  // Guards that a read failure yields nothing to restore.
  it('has nothing to restore when the storage refuses to be read', () => {
    const storage: SessionStorage = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {},
      removeItem(): void {},
    };
    expect(loadSession(storage)).toBe(null);
  });
});

describe('saveSession', () => {
  // Guards that writes are persisted under the versioned key.
  it('writes under the versioned key', () => {
    const storage = fakeStorage();
    let seen: string | null = null;
    storage.setItem = (key: string, next: string): void => {
      seen = key;
      storage.value = next;
    };
    saveSession(storage, SESSION);
    expect(seen).toBe(SESSION_STORAGE_KEY);
  });

  // The cap is applied on the way out as well as the way in, so a long-running window does not grow an
  // entry it would only ever read back trimmed. Read from the stored text, not through loadSession,
  // which would trim it again and hide a missing cap here.
  it('never writes more files than it would read back', () => {
    const storage = fakeStorage();
    const many = Array.from({ length: MAX_RESTORED_TABS + 5 }, (_unused, index) => `C:/notes/${index}.md`);
    saveSession(storage, { ...SESSION, paths: many, activePath: null });

    const written: unknown = JSON.parse(storage.value ?? '{}');
    expect((written as { paths: readonly string[] }).paths).toHaveLength(MAX_RESTORED_TABS);
    expect(loadSession(storage)?.paths).toHaveLength(MAX_RESTORED_TABS);
  });

  // Guards that a refused write does not throw.
  it('does not throw when the storage refuses the write', () => {
    const storage: SessionStorage = {
      getItem(): string | null {
        return null;
      },
      setItem(): void {
        throw new Error('full');
      },
      removeItem(): void {},
    };
    expect(() => {
      saveSession(storage, SESSION);
    }).not.toThrow();
  });
});

describe('clearSession', () => {
  // Guards that clearing removes the stored arrangement.
  it('forgets the stored arrangement', () => {
    const storage = fakeStorage();
    saveSession(storage, SESSION);
    clearSession(storage);
    expect(loadSession(storage)).toBe(null);
  });

  // Guards that a refused remove does not throw.
  it('does not throw when the storage refuses', () => {
    const storage: SessionStorage = {
      getItem(): string | null {
        return null;
      },
      setItem(): void {},
      removeItem(): void {
        throw new Error('blocked');
      },
    };
    expect(() => {
      clearSession(storage);
    }).not.toThrow();
  });
});
