/**
 * @file language-choices.spec.ts
 * @purpose Covers the per-document language choices persisted in local storage (FR-12.3): normalising paths, remembering and forgetting choices, rejecting untrustworthy stored values, tolerating broken storage, and evicting the oldest choices beyond the remembered limit.
 * @inputs A `memoryStorage()` helper producing an in-memory LanguageStorage, plus fixtures of path/language pairs and deliberately malformed stored JSON.
 * @outputs Assertions over loadLanguageChoice / saveLanguageChoice behaviour against that storage.
 * @functions memoryStorage - builds an in-memory LanguageStorage backed by a plain record.
 *   - loadLanguageChoice - reads the remembered language for a document path.
 *   - saveLanguageChoice - records or clears a language choice for a document path.
 * @dataflow memoryStorage() -> saveLanguageChoice / loadLanguageChoice -> assertions.
 * @controlflow One describe block; each it supplies fixtures and asserts on the persisted behaviour.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY, MAX_REMEMBERED_LANGUAGES, loadLanguageChoice, saveLanguageChoice, type LanguageStorage } from '../src/spell/document-language.js';

function memoryStorage(initial: Record<string, string> = {}): LanguageStorage & { readonly values: Record<string, string> } {
  const values: Record<string, string> = { ...initial };
  return {
    values,
    getItem: (key: string): string | null => values[key] ?? null,
    setItem: (key: string, value: string): void => {
      values[key] = value;
    },
  };
}

describe('language choices', () => {
  // Guards a saved language is returned even when the query differs only in case or slash style.
  it('remembers a choice for a file whatever the path case or slashes', () => {
    const storage = memoryStorage();
    saveLanguageChoice(storage, 'C:/Notes/Paris.md', 'fr');
    expect(loadLanguageChoice(storage, 'c:/notes/paris.md')).toBe('fr');
  });

  // Guards clearing a choice with null empties the entry and leaves an empty object persisted.
  it('forgets a choice set to null', () => {
    const storage = memoryStorage();
    saveLanguageChoice(storage, 'a.md', 'fr');
    saveLanguageChoice(storage, 'a.md', null);
    expect(loadLanguageChoice(storage, 'a.md')).toBeNull();
    expect(storage.values[LANGUAGE_STORAGE_KEY]).toBe('{}');
  });

  // Guards documents with no usable path (null or empty) persist nothing and resolve to null.
  it('remembers nothing for an unsaved document', () => {
    const storage = memoryStorage();
    saveLanguageChoice(storage, null, 'fr');
    saveLanguageChoice(storage, '', 'fr');
    expect(storage.values[LANGUAGE_STORAGE_KEY]).toBeUndefined();
    expect(loadLanguageChoice(storage, null)).toBeNull();
    expect(loadLanguageChoice(storage, '')).toBeNull();
  });

  // Guards stored values that are not valid language maps are ignored, while trustworthy entries survive.
  it('ignores a stored value it cannot trust', () => {
    expect(loadLanguageChoice(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'not json' }), 'a.md')).toBeNull();
    expect(loadLanguageChoice(memoryStorage({ [LANGUAGE_STORAGE_KEY]: '["fr"]' }), 'a.md')).toBeNull();
    const mixed = memoryStorage({ [LANGUAGE_STORAGE_KEY]: '{"a.md":7,"b.md":"de"}' });
    expect(loadLanguageChoice(mixed, 'a.md')).toBeNull();
    expect(loadLanguageChoice(mixed, 'b.md')).toBe('de');
  });

  // Guards a read returns null and a write is swallowed when the backing storage throws.
  it('survives storage that refuses to be read or written', () => {
    const broken: LanguageStorage = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(loadLanguageChoice(broken, 'a.md')).toBeNull();
    expect(() => saveLanguageChoice(broken, 'a.md', 'fr')).not.toThrow();
  });

  // Guards that once the remembered limit is exceeded, the oldest entries are evicted first.
  it('forgets the oldest choices beyond the limit', () => {
    const storage = memoryStorage();
    for (let index = 0; index <= MAX_REMEMBERED_LANGUAGES; index += 1) {
      saveLanguageChoice(storage, `note-${index}.md`, 'fr');
    }
    expect(loadLanguageChoice(storage, 'note-0.md')).toBeNull();
    expect(loadLanguageChoice(storage, 'note-1.md')).toBe('fr');
    expect(loadLanguageChoice(storage, `note-${MAX_REMEMBERED_LANGUAGES}.md`)).toBe('fr');
  });

  // Guards re-saving an existing path promotes it to newest, delaying its eviction.
  it('counts a changed choice as the newest', () => {
    const storage = memoryStorage();
    saveLanguageChoice(storage, 'first.md', 'fr');
    for (let index = 1; index < MAX_REMEMBERED_LANGUAGES; index += 1) {
      saveLanguageChoice(storage, `note-${index}.md`, 'fr');
    }
    saveLanguageChoice(storage, 'first.md', 'de');
    saveLanguageChoice(storage, 'last.md', 'fr');
    expect(loadLanguageChoice(storage, 'first.md')).toBe('de');
    expect(loadLanguageChoice(storage, 'note-1.md')).toBeNull();
  });
});
