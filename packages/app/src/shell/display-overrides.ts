/**
 * @file display-overrides.ts
 * @purpose Per-document reading width and display density (FR-5.10, FR-14.13): remembers a document's own choices beside the global appearance settings, keyed by its path in local storage, the way folds are remembered.
 * @inputs a storage, a document path, an override.
 * @outputs the stored override, an effective appearance.
 * @functions
 *   - displayPathKey: Normalizes a document path into a single storage key.
 *   - readAll: Reads the whole override map, tolerating a throwing or corrupt store.
 *   - loadDisplayOverride: Returns the stored override for a path (or {}).
 *   - saveDisplayOverride: Persists an override, dropping empty ones and trimming oldest entries.
 *   - effectiveAppearance: Layers a document's override over the global settings.
 * @dataflow path -> key -> stored map -> override; override + settings -> effective appearance.
 * @controlflow unreadable or unusable storage is treated as no override; the oldest documents are forgotten when the map grows too large.
 * @version 1
 * @date 2026-09-16
 */

import type { AppearanceSettings, Density, ReadingWidth } from '@k-doc/config';

/**
 * @purpose Per-document reading width and display density choices that sit beside the global appearance settings. A field left out means "use the setting".
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Consumed by loadDisplayOverride, saveDisplayOverride, and effectiveAppearance.
 * @controlflow No logic; a shape describing optional overrides.
 */
export interface DisplayOverride {
  readonly readingWidth?: ReadingWidth;
  readonly density?: Density;
}

/**
 * @purpose The two methods of localStorage this module needs, so tests can pass their own implementation.
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Implemented by the caller and read/written by readAll and saveDisplayOverride.
 * @controlflow No logic; a structural contract for storage access.
 */
export interface DisplayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * @purpose The localStorage key holding the display-override map. The version in the name lets a later shape be told apart.
 * @inputs None.
 * @outputs None.
 * @dataflow Used as the storage key by readAll and saveDisplayOverride.
 * @controlflow No logic; a constant.
 */
export const DISPLAY_STORAGE_KEY: string = 'kdoc.display.v1';

/**
 * @purpose Upper bound on how many documents' overrides are kept. Beyond this the documents written longest ago are forgotten, so the entry cannot grow without bound.
 * @inputs None.
 * @outputs None.
 * @dataflow Used by saveDisplayOverride to trim oldest keys.
 * @controlflow No logic; a constant.
 */
export const MAX_REMEMBERED_DISPLAYS: number = 500;

/**
 * @purpose Normalizes a document path into a single, case-insensitive storage key.
 * @inputs path - The raw document path as produced by the host.
 * @outputs The normalized key string.
 * @dataflow Raw path → backslashes replaced with forward slashes and lowercased → key.
 * @controlflow No branching; a pure transform. Windows paths differ only in separator and case, so one document is one key.
 */
/**
 * @purpose The reading widths a document cycles through, in the order the command steps them.
 * @inputs None.
 * @outputs None.
 * @dataflow Read by nextReadingWidth to find the value after the current one.
 * @controlflow No logic; a constant. The order runs narrowest to widest and wraps, so repeating the command returns to where it started.
 */
export const READING_WIDTH_CYCLE: readonly ReadingWidth[] = Object.freeze<readonly ReadingWidth[]>([
  'narrow',
  'medium',
  'wide',
  'full',
]);

/**
 * @purpose The densities a document cycles through, in the order the command steps them.
 * @inputs None.
 * @outputs None.
 * @dataflow Read by nextDensity to find the value after the current one.
 * @controlflow No logic; a constant. The order runs tightest to loosest and wraps.
 */
export const DENSITY_CYCLE: readonly Density[] = Object.freeze<readonly Density[]>([
  'compact',
  'comfortable',
  'spacious',
]);

/**
 * @purpose Returns the reading width one step after the given one, wrapping at the end.
 * @inputs current - The width in effect for the document now.
 * @outputs The next width in READING_WIDTH_CYCLE.
 * @dataflow current → index in READING_WIDTH_CYCLE → the following entry, modulo the length.
 * @controlflow An unknown value has index -1, which steps to the first entry; a guarded lookup falls back to the current value.
 */
export function nextReadingWidth(current: ReadingWidth): ReadingWidth {
  const at = READING_WIDTH_CYCLE.indexOf(current);
  const next = READING_WIDTH_CYCLE[(at + 1) % READING_WIDTH_CYCLE.length];
  return next ?? current;
}

/**
 * @purpose Returns the density one step after the given one, wrapping at the end.
 * @inputs current - The density in effect for the document now.
 * @outputs The next density in DENSITY_CYCLE.
 * @dataflow current → index in DENSITY_CYCLE → the following entry, modulo the length.
 * @controlflow An unknown value has index -1, which steps to the first entry; a guarded lookup falls back to the current value.
 */
export function nextDensity(current: Density): Density {
  const at = DENSITY_CYCLE.indexOf(current);
  const next = DENSITY_CYCLE[(at + 1) % DENSITY_CYCLE.length];
  return next ?? current;
}

export function displayPathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * @purpose Reads the entire override map from storage, tolerating a throwing or corrupt store.
 * @inputs storage - The DisplayStorage implementation to read from.
 * @outputs A record keyed by normalized path; empty when nothing is stored or it cannot be trusted.
 * @dataflow Storage value → JSON.parse → validated object → return; any failure yields {}.
 * @controlflow If getItem throws (private window, storage off) return {}; if the value is null return {}; if it does not parse to a plain object return {}; otherwise return the parsed map.
 */
function readAll(storage: DisplayStorage): Record<string, DisplayOverride> {
  let raw: string | null;
  try {
    raw = storage.getItem(DISPLAY_STORAGE_KEY);
  } catch {
    // Storage threw (private window or disabled): treat as no overrides rather than erroring.
    return {};
  }
  if (raw === null) {
    // Nothing has ever been written: no overrides.
    return {};
  } else {
    // A value exists; fall through to parse it below.
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // Well-formed map of overrides.
      return parsed as Record<string, DisplayOverride>;
    } else {
      // Corrupt or unexpected shape (array, string, number): ignore it.
      return {};
    }
  } catch {
    // Not valid JSON: treat as no overrides rather than erroring.
    return {};
  }
}

/**
 * @purpose Returns the stored override for a document, or an empty object when there is none.
 * @inputs storage - The DisplayStorage implementation to read from. path - The document path; null means unsaved.
 * @outputs The stored override for the path, or {} when nothing is stored.
 * @dataflow Path → displayPathKey → lookup in the map read by readAll → override or {}.
 * @controlflow If the path is null or empty return {} (an unsaved document has no key to look up); otherwise return the stored entry or {}.
 */
export function loadDisplayOverride(storage: DisplayStorage, path: string | null): DisplayOverride {
  if (path === null || path === '') {
    // No path means an unsaved document with nothing to key on.
    return {};
  } else {
    // A real path exists; look up its override below.
  }
  const stored = readAll(storage)[displayPathKey(path)];
  return stored ?? {};
}

/**
 * @purpose Persists a document's override, removing it when empty and trimming the oldest entries to stay bounded.
 * @inputs storage - The DisplayStorage implementation to write to. path - The document path; null means unsaved. override - The new per-document choices.
 * @outputs None.
 * @dataflow Path → displayPathKey → update the map read by readAll → trim oldest → JSON.stringify back into storage.
 * @controlflow If the path is null or empty return without writing (nothing to key on); otherwise delete any existing entry first, store a non-empty override, drop the oldest keys when over the cap, then write; a refused write loses only the preference.
 */
export function saveDisplayOverride(storage: DisplayStorage, path: string | null, override: DisplayOverride): void {
  if (path === null || path === '') {
    // No path means an unsaved document with nothing to key on.
    return;
  } else {
    // A real path exists; persist its override below.
  }
  const all = readAll(storage);
  const key = displayPathKey(path);
  delete all[key];
  if (override.readingWidth === undefined && override.density === undefined) {
    // Nothing to remember: drop any existing entry rather than storing an empty one.
  } else {
    // Store the new choices; deleting first means this counts as most recently written.
    all[key] = override;
  }
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_DISPLAYS))) {
    // Drop the oldest entries while the map exceeds the cap so it cannot grow without bound.
    delete all[old];
  }
  try {
    storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A refused write (full or disabled storage) loses only this preference; never error out.
  }
}

/**
 * @purpose Merges a document's override over the global appearance settings, field by field.
 * @inputs appearance - The global appearance settings. override - The per-document choices to layer on top.
 * @outputs A new AppearanceSettings where each overridden field wins and unset fields fall back to the setting.
 * @dataflow Override + settings → spread settings then apply override.readingWidth/density when present → merged settings.
 * @controlflow No branching; a pure merge where the document's choices win over the settings, field by field.
 */
export function effectiveAppearance(appearance: AppearanceSettings, override: DisplayOverride): AppearanceSettings {
  return {
    ...appearance,
    readingWidth: override.readingWidth ?? appearance.readingWidth,
    density: override.density ?? appearance.density,
  };
}
