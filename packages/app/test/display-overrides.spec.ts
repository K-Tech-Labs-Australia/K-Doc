/**
 * @file display-overrides.spec.ts
 * @purpose Covers the per-document reading width and density store (FR-5.10, FR-14.13): what is remembered, what is forgotten, what a hostile or broken storage does, and how an override layers over the settings.
 * @inputs A fake DisplayStorage plus DEFAULT_SETTINGS.appearance.
 * @outputs Assertions over loadDisplayOverride, saveDisplayOverride, effectiveAppearance and the two cycles.
 * @functions displayPathKey, loadDisplayOverride, saveDisplayOverride, effectiveAppearance, nextReadingWidth, nextDensity describe blocks.
 * @dataflow fake storage -> load/save -> assertions.
 * @controlflow one describe per exported function.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@k-doc/config';
import {
  DENSITY_CYCLE,
  DISPLAY_STORAGE_KEY,
  MAX_REMEMBERED_DISPLAYS,
  READING_WIDTH_CYCLE,
  displayPathKey,
  effectiveAppearance,
  loadDisplayOverride,
  nextDensity,
  nextReadingWidth,
  saveDisplayOverride,
  type DisplayStorage,
} from '../src/shell/display-overrides.js';

function fakeStorage(initial?: string): DisplayStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(): string | null {
      return this.value;
    },
    setItem(_key: string, next: string): void {
      this.value = next;
    },
  };
}

describe('displayPathKey', () => {
  // Guards that Windows and POSIX spellings of the same document normalize to a single key.
  it('reads one document written two ways as one key', () => {
    expect(displayPathKey('C:\\Notes\\A.md')).toBe(displayPathKey('c:/notes/a.md'));
  });
});

describe('loadDisplayOverride', () => {
  // Guards that unsaved documents (null or empty path) yield no override.
  it('has nothing for an unsaved document', () => {
    expect(loadDisplayOverride(fakeStorage(), null)).toEqual({});
    expect(loadDisplayOverride(fakeStorage(), '')).toEqual({});
  });

  // Guards that a missing entry returns an empty override rather than throwing.
  it('has nothing when nothing was stored', () => {
    expect(loadDisplayOverride(fakeStorage(), 'C:/a.md')).toEqual({});
  });

  // Guards a full round-trip through a differently spelled path.
  it('returns what was stored', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, 'C:/a.md', { readingWidth: 'wide' });
    expect(loadDisplayOverride(storage, 'c:\\A.MD')).toEqual({ readingWidth: 'wide' });
  });

  // Guards that malformed JSON yields an empty override instead of propagating a parse error.
  it('has nothing when the stored value is not JSON', () => {
    expect(loadDisplayOverride(fakeStorage('{not json'), 'C:/a.md')).toEqual({});
  });

  // Guards that non-map payloads (array, null) yield an empty override.
  it('has nothing when the stored value is not a map', () => {
    expect(loadDisplayOverride(fakeStorage('[1,2]'), 'C:/a.md')).toEqual({});
    expect(loadDisplayOverride(fakeStorage('null'), 'C:/a.md')).toEqual({});
  });

  // An entry stored under the empty path belongs to no document and must not be handed to one.
  it('ignores an entry stored under an empty path', () => {
    expect(loadDisplayOverride(fakeStorage('{"":{"density":"compact"}}'), '')).toEqual({});
  });

  // Guards that a throwing getItem degrades to an empty override.
  it('has nothing when the storage refuses to be read', () => {
    const storage: DisplayStorage = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {},
    };
    expect(loadDisplayOverride(storage, 'C:/a.md')).toEqual({});
  });
});

describe('saveDisplayOverride', () => {
  // Guards that an unsaved document is never persisted.
  it('writes nothing for an unsaved document', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, null, { density: 'compact' });
    expect(storage.value).toBe(null);
  });

  // Guards that distinct documents store independent entries without clobbering each other.
  it('keeps one document without disturbing another', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, 'C:/a.md', { readingWidth: 'narrow' });
    saveDisplayOverride(storage, 'C:/b.md', { density: 'spacious' });
    expect(loadDisplayOverride(storage, 'C:/a.md')).toEqual({ readingWidth: 'narrow' });
    expect(loadDisplayOverride(storage, 'C:/b.md')).toEqual({ density: 'spacious' });
  });

  // Guards that a second save replaces the prior override wholesale rather than merging.
  it('replaces rather than merges an existing entry', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, 'C:/a.md', { readingWidth: 'narrow', density: 'compact' });
    saveDisplayOverride(storage, 'C:/a.md', { density: 'spacious' });
    expect(loadDisplayOverride(storage, 'C:/a.md')).toEqual({ density: 'spacious' });
  });

  // Guards that an empty override clears the entry by writing an empty object.
  it('forgets a document given an empty override', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, 'C:/a.md', { readingWidth: 'wide' });
    saveDisplayOverride(storage, 'C:/a.md', {});
    expect(storage.value).toBe('{}');
  });

  // Guards LRU eviction once writes exceed the remembered cap.
  it('forgets the documents written longest ago once past the cap', () => {
    const storage = fakeStorage();
    for (let i = 0; i < MAX_REMEMBERED_DISPLAYS + 2; i++) {
      saveDisplayOverride(storage, `C:/note-${i}.md`, { density: 'compact' });
    }
    expect(loadDisplayOverride(storage, 'C:/note-0.md')).toEqual({});
    expect(loadDisplayOverride(storage, 'C:/note-1.md')).toEqual({});
    expect(loadDisplayOverride(storage, 'C:/note-2.md')).toEqual({ density: 'compact' });
    const stored: unknown = JSON.parse(storage.value ?? '{}');
    expect(Object.keys(stored as Record<string, unknown>)).toHaveLength(MAX_REMEMBERED_DISPLAYS);
  });

  // Guards that rewriting a document moves it to the end of the recency queue.
  it('moves a rewritten document to the end of the queue', () => {
    const storage = fakeStorage();
    saveDisplayOverride(storage, 'C:/old.md', { density: 'compact' });
    for (let i = 0; i < MAX_REMEMBERED_DISPLAYS - 1; i++) {
      saveDisplayOverride(storage, `C:/note-${i}.md`, { density: 'compact' });
    }
    saveDisplayOverride(storage, 'C:/old.md', { density: 'spacious' });
    saveDisplayOverride(storage, 'C:/newest.md', { density: 'compact' });
    expect(loadDisplayOverride(storage, 'C:/old.md')).toEqual({ density: 'spacious' });
    expect(loadDisplayOverride(storage, 'C:/note-0.md')).toEqual({});
  });

  // Guards that writes target the versioned storage key.
  it('writes under the versioned key', () => {
    const storage = fakeStorage();
    let seen: string | null = null;
    storage.setItem = (key: string, next: string): void => {
      seen = key;
      storage.value = next;
    };
    saveDisplayOverride(storage, 'C:/a.md', { density: 'compact' });
    expect(seen).toBe(DISPLAY_STORAGE_KEY);
  });

  // An array in storage is not a map of overrides; writing into one would be lost on the next read,
  // so a stored array has to be discarded rather than written into.
  it('starts again when the stored value is an array', () => {
    const storage = fakeStorage('[1,2]');
    saveDisplayOverride(storage, 'C:/a.md', { density: 'spacious' });
    expect(loadDisplayOverride(storage, 'C:/a.md')).toEqual({ density: 'spacious' });
  });

  // Guards that a throwing setItem does not propagate to the caller.
  it('does not throw when the storage refuses the write', () => {
    const storage: DisplayStorage = {
      getItem(): string | null {
        return null;
      },
      setItem(): void {
        throw new Error('full');
      },
    };
    expect(() => {
      saveDisplayOverride(storage, 'C:/a.md', { density: 'compact' });
    }).not.toThrow();
  });
});

describe('effectiveAppearance', () => {
  // Guards that an empty override returns the settings object unchanged.
  it('leaves the settings alone without an override', () => {
    expect(effectiveAppearance(DEFAULT_SETTINGS.appearance, {})).toEqual(DEFAULT_SETTINGS.appearance);
  });

  // Guards per-field precedence: each overridden field wins while untouched fields stay put.
  it('lets each overridden field win on its own', () => {
    const width = effectiveAppearance(DEFAULT_SETTINGS.appearance, { readingWidth: 'full' });
    expect(width.readingWidth).toBe('full');
    expect(width.density).toBe(DEFAULT_SETTINGS.appearance.density);
    const density = effectiveAppearance(DEFAULT_SETTINGS.appearance, { density: 'compact' });
    expect(density.density).toBe('compact');
    expect(density.readingWidth).toBe(DEFAULT_SETTINGS.appearance.readingWidth);
  });

  // Guards that non-overridden appearance fields survive the merge intact.
  it('keeps the rest of the appearance settings', () => {
    const merged = effectiveAppearance(DEFAULT_SETTINGS.appearance, { density: 'spacious' });
    expect(merged.editorFontSizePx).toBe(DEFAULT_SETTINGS.appearance.editorFontSizePx);
    expect(merged.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
  });
});

describe('the cycles', () => {
  // Guards that nextReadingWidth walks every width exactly once and wraps around.
  it('walks every width and comes back', () => {
    let width = READING_WIDTH_CYCLE[0] ?? 'narrow';
    const seen = [width];
    for (let i = 0; i < READING_WIDTH_CYCLE.length - 1; i++) {
      width = nextReadingWidth(width);
      seen.push(width);
    }
    expect(seen).toEqual([...READING_WIDTH_CYCLE]);
    expect(nextReadingWidth(width)).toBe(READING_WIDTH_CYCLE[0]);
  });

  // Guards that nextDensity walks every density exactly once and wraps around.
  it('walks every density and comes back', () => {
    let density = DENSITY_CYCLE[0] ?? 'compact';
    const seen = [density];
    for (let i = 0; i < DENSITY_CYCLE.length - 1; i++) {
      density = nextDensity(density);
      seen.push(density);
    }
    expect(seen).toEqual([...DENSITY_CYCLE]);
    expect(nextDensity(density)).toBe(DENSITY_CYCLE[0]);
  });

  // The step has to run narrowest to widest: a cycle in another order would jump about as it is pressed.
  it('steps the widths from narrowest to widest', () => {
    expect(nextReadingWidth('narrow')).toBe('medium');
    expect(nextReadingWidth('medium')).toBe('wide');
    expect(nextReadingWidth('wide')).toBe('full');
    expect(nextReadingWidth('full')).toBe('narrow');
  });

  // The same for density: tightest to loosest, then back to the start.
  it('steps the densities from tightest to loosest', () => {
    expect(nextDensity('compact')).toBe('comfortable');
    expect(nextDensity('comfortable')).toBe('spacious');
    expect(nextDensity('spacious')).toBe('compact');
  });

  // Guards that the configured defaults are members of both cycles.
  it('offers every width and density the settings allow', () => {
    expect(READING_WIDTH_CYCLE).toContain(DEFAULT_SETTINGS.appearance.readingWidth);
    expect(DENSITY_CYCLE).toContain(DEFAULT_SETTINGS.appearance.density);
  });
});
