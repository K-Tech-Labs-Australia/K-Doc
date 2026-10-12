/**
 * @file fold-state.spec.ts
 * @purpose Verifies FR-8.29's shell fold store: the fold controller's change-notification semantics and the per-document fold persistence helpers (load/save/clear, path normalisation, eviction, error handling).
 * @inputs createFoldController, loadFolds, saveFolds, clearFolds, foldPathKey, FOLD_STORAGE_KEY, MAX_REMEMBERED_DOCUMENTS from ../src/shell/fold-state.js; a Map-backed FoldStorage helper; the vitest harness.
 * @outputs vitest assertions validating controller change semantics and storage round-trips / eviction / error handling.
 * @functions memoryStorage — returns a Map-backed FoldStorage whose stored strings are inspectable through the exposed values Map.
 * @dataflow test inputs → fold-state functions → captured changes array/listener counters or persisted JSON strings → expect() assertions.
 * @controlflow Define helper; describe('fold controller') runs five change-notification cases; describe('fold storage') runs eight persistence cases.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { clearFolds, createFoldController, foldPathKey, loadFolds, saveFolds, FOLD_STORAGE_KEY, MAX_REMEMBERED_DOCUMENTS } from '../src/shell/fold-state.js';
import type { FoldStorage } from '../src/shell/fold-state.js';

// Build an in-memory FoldStorage whose raw stored strings are inspectable via the values Map.
function memoryStorage(): FoldStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string): string | null {
      // Return the stored value or null when the key is absent.
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

describe('fold controller', (): void => {
  it('starts with the initial keys', (): void => {
    const c = createFoldController(['a'], () => {});
    expect(c.isFolded('a')).toBe(true);
    expect(c.isFolded('b')).toBe(false);
  });

  it('notifies once per real change', (): void => {
    const changes: (readonly string[])[] = [];
    let heard = 0;
    const c = createFoldController(['a'], (keys) => changes.push(keys));
    c.subscribe(() => {
      heard += 1;
    });
    // 'b' was unfolded, so folding it is a real change to the set.
    c.toggle('b');
    expect(changes).toEqual([['a', 'b']]);
    expect(heard).toBe(1);
    // 'a' is already folded, so this is not a change and must stay silent.
    c.setFolded('a', true);
    expect(changes).toHaveLength(1);
    expect(heard).toBe(1);
  });

  it('applies several states as one change', (): void => {
    const changes: (readonly string[])[] = [];
    const c = createFoldController(['a', 'b'], (keys) => changes.push(keys));
    // Unfold 'a' and fold new key 'c'; the surviving set is ['b','c'] in insertion order.
    c.setMany(new Map<string, boolean>([['a', false], ['c', true]]));
    expect(changes).toEqual([['b', 'c']]);
    // 'b' is already folded, so this produces no new change.
    c.setMany(new Map<string, boolean>([['b', true]]));
    expect(changes).toHaveLength(1);
  });

  it('replaces the whole set', (): void => {
    const changes: (readonly string[])[] = [];
    const c = createFoldController(['b', 'c'], (keys) => changes.push(keys));
    // Same folded set, different order — content is unchanged so nothing fires.
    c.replaceAll(['c', 'b']);
    expect(changes).toHaveLength(0);
    // Emptying the set is a real change recorded as an empty array.
    c.replaceAll([]);
    expect(changes).toEqual([[]]);
    expect(c.keys()).toEqual([]);
  });

  it('treats a different set of the same size as a change', (): void => {
    const changes: (readonly string[])[] = [];
    const c = createFoldController(['b', 'c'], (keys) => changes.push(keys));
    c.replaceAll(['b', 'd']);
    expect(changes).toEqual([['b', 'd']]);
  });
  it('stops notifying after unsubscribe', (): void => {
    let count = 0;
    const c = createFoldController(['a'], () => {});
    const unsubscribe = c.subscribe(() => {
      count += 1;
    });
    unsubscribe();
    // The listener was removed, so toggling must not reach it.
    c.toggle('x');
    expect(count).toBe(0);
  });
});

describe('fold storage', (): void => {
  it('normalises a path to one key', (): void => {
    expect(foldPathKey('C:\\Notes\\A.md')).toBe('c:/notes/a.md');
  });

  it('remembers folds per document', (): void => {
    const s = memoryStorage();
    saveFolds(s, 'C:\\Notes\\A.md', ['heading:a']);
    expect(loadFolds(s, 'c:/notes/a.md')).toEqual(['heading:a']);
    // A different document has no stored folds.
    expect(loadFolds(s, 'c:/notes/b.md')).toEqual([]);
  });

  it('forgets a document with nothing folded', (): void => {
    const s = memoryStorage();
    saveFolds(s, 'p0', ['x']);
    // Saving an empty set forgets the document entirely.
    saveFolds(s, 'p0', []);
    expect(loadFolds(s, 'p0')).toEqual([]);
    expect(JSON.parse(s.values.get(FOLD_STORAGE_KEY) ?? '')).toEqual([]);
  });

  it('forgets the oldest documents first', (): void => {
    const s = memoryStorage();
    // Save one more document than capacity so exactly one eviction happens.
    for (let i = 0; i <= MAX_REMEMBERED_DOCUMENTS; i += 1) {
      saveFolds(s, `p${i}`, ['k']);
    }
    expect(loadFolds(s, 'p0')).toEqual([]);
    expect(loadFolds(s, 'p1')).toEqual(['k']);
    expect(loadFolds(s, `p${MAX_REMEMBERED_DOCUMENTS}`)).toEqual(['k']);
  });

  it('counts a re-saved document as recent', (): void => {
    const s = memoryStorage();
    // Fill capacity with p0..p499.
    for (let i = 0; i < MAX_REMEMBERED_DOCUMENTS; i += 1) {
      saveFolds(s, `p${i}`, ['k']);
    }
    saveFolds(s, 'p0', ['k2']); // Re-saving p0 makes it the most recent document.
    saveFolds(s, 'extra', ['k']); // Eviction drops the oldest remaining document (p1).
    expect(loadFolds(s, 'p0')).toEqual(['k2']);
    expect(loadFolds(s, 'p1')).toEqual([]);
  });

  it('rejects stored text that is not JSON', (): void => {
    const s = memoryStorage();
    s.values.set(FOLD_STORAGE_KEY, 'nope');
    expect(() => loadFolds(s, 'a')).toThrow(/not valid JSON/);
  });

  it('rejects JSON of the wrong shape', (): void => {
    const s = memoryStorage();
    s.values.set(FOLD_STORAGE_KEY, '{"a":1}');
    expect(() => loadFolds(s, 'a')).toThrow(/unexpected shape/);
    s.values.set(FOLD_STORAGE_KEY, '[["a",[1]]]');
    expect(() => loadFolds(s, 'a')).toThrow(/unexpected shape/);
  });

  it('rejects entries that are not path and keys pairs', (): void => {
    const s = memoryStorage();
    s.values.set(FOLD_STORAGE_KEY, '[["a",["k"],3]]');
    expect(() => loadFolds(s, 'a')).toThrow(/unexpected shape/);
    s.values.set(FOLD_STORAGE_KEY, '[[1,["k"]]]');
    expect(() => loadFolds(s, 'a')).toThrow(/unexpected shape/);
  });
  it('clears a damaged store', (): void => {
    const s = memoryStorage();
    s.values.set(FOLD_STORAGE_KEY, 'nope');
    clearFolds(s);
    expect(loadFolds(s, 'a')).toEqual([]);
  });
});
