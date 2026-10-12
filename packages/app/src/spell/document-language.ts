/**
 * @file document-language.ts
 * @purpose FR-12.3: determines which language a document is written in, renders a readable name for a language tag, and remembers the reader's per-document language choices in local storage.
 * @inputs parsed front matter, the reader's chosen language, a detect flag, the Markdown source, a default language, and a LanguageStorage implementation; a document path for load/save operations.
 * @outputs a resolved DocumentLanguage carrying its source, a human-readable language name, and the stored per-document choice.
 * @functions
 *   - resolveDocumentLanguage: Picks the active language from front matter, reader choice, detection, or default.
 *   - languageName: Renders a readable name for a language tag, falling back to the raw tag when the platform cannot name it.
 *   - pathKey: Normalizes a document path into a single storage key.
 *   - readAll: Reads the whole language map, tolerating a throwing or corrupt store and keeping only string-valued entries.
 *   - loadLanguageChoice: Returns the remembered language for a path (or null when none).
 *   - saveLanguageChoice: Persists a language choice, dropping forgotten ones and trimming the oldest entries.
 * @dataflow front matter / chosen / detect / default → resolveDocumentLanguage → language tag; tag → languageName → readable name; path → pathKey → stored map → choice; choice + path → update map → storage write.
 * @controlflow Precedence is front-matter > chosen > detected > default for resolution; unreadable or unusable storage is treated as no remembered choice, and the oldest documents are forgotten when the map grows past the cap.
 * @version 1
 * @date 2026-09-18
 */

import { detectLanguage, documentProse, normaliseLanguageTag, primaryLanguage } from '@k-doc/core';

/**
 * @purpose Where a resolved language came from, in order of precedence.
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Recorded as DocumentLanguage.source by resolveDocumentLanguage and consumed by callers deciding whether to persist a choice.
 * @controlflow No logic; a literal union describing the origin of a language tag.
 */
export type LanguageSource = 'front-matter' | 'chosen' | 'detected' | 'default';

/**
 * @purpose A resolved language together with how it was determined.
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Produced by resolveDocumentLanguage and consumed by callers rendering the active language.
 * @controlflow No logic; a shape describing one language tag and its source.
 */
export interface DocumentLanguage {
  readonly language: string;
  readonly source: LanguageSource;
}

/**
 * @purpose Everything resolveDocumentLanguage needs to decide a document's language.
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Assembled by the caller and consumed entirely by resolveDocumentLanguage.
 * @controlflow No logic; a shape describing optional front matter, a reader choice, a detect flag, source text, and a default language.
 */
export interface LanguageInputs {
  /** The document's parsed front matter, or null when it has none. */
  readonly frontMatter: Readonly<Record<string, unknown>> | null;
  /** The language the reader picked for this document, or null. */
  readonly chosen: string | null;
  /** Whether to guess the language from the text when nothing else names it. */
  readonly detect: boolean;
  /** The document's Markdown source. */
  readonly text: string;
  /** The language from Settings → Proofing. */
  readonly defaultLanguage: string;
}

/**
 * @purpose The two methods of localStorage this module needs, so tests can pass their own implementation.
 * @inputs None (declaration only).
 * @outputs None (declaration only).
 * @dataflow Implemented by the caller and read/written by readAll and saveLanguageChoice.
 * @controlflow No logic; a structural contract for storage access.
 */
export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * @purpose The localStorage key holding the language map. The version in the name lets a later shape be told apart.
 * @inputs None.
 * @outputs None.
 * @dataflow Used as the storage key by readAll and saveLanguageChoice.
 * @controlflow No logic; a constant.
 */
export const LANGUAGE_STORAGE_KEY: string = 'kdoc.language.v1';

/** Languages offered in the status bar: those github.com/wooorm/dictionaries publishes a dictionary for (FR-12.3). */
export const LANGUAGE_CHOICES: readonly string[] = [
  'bg', 'br', 'ca', 'cs', 'cy', 'da', 'de', 'de-AT', 'de-CH', 'el', 'en', 'en-AU', 'en-CA', 'en-GB', 'en-ZA', 'eo',
  'es', 'es-AR', 'es-MX', 'et', 'eu', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'he', 'hr', 'hu', 'hy', 'is', 'it', 'ka',
  'ko', 'la', 'lb', 'lt', 'lv', 'mk', 'mn', 'nb', 'nds', 'ne', 'nl', 'nn', 'oc', 'pl', 'pt', 'pt-PT', 'ro', 'ru', 'rw',
  'sk', 'sl', 'sr', 'sr-Latn', 'sv', 'sv-FI', 'tr', 'uk', 'vi',
];

/** How the status bar says where a document's language came from. */
export const LANGUAGE_SOURCE_TEXT: Readonly<Record<LanguageSource, string>> = {
  'front-matter': 'set by lang: in the front matter',
  chosen: 'chosen for this document',
  detected: 'detected from the text',
  default: 'the default from Settings',
};

/**
 * @purpose Upper bound on how many documents' language choices are kept. Beyond this the documents written longest ago are forgotten, so the entry cannot grow without bound.
 * @inputs None.
 * @outputs None.
 * @dataflow Used by saveLanguageChoice to trim oldest keys.
 * @controlflow No logic; a constant.
 */
export const MAX_REMEMBERED_LANGUAGES: number = 500;

/**
 * @purpose Resolves the language a document is written in, preferring what travels with the file, then the reader's choice, then a guess, then the default.
 * @inputs inputs - Everything needed to decide (front matter, chosen language, detect flag, source text, default language).
 * @outputs The resolved language and the source it came from.
 * @dataflow Front-matter tag → normalise; else chosen tag → normalise; else prose → detectLanguage; else default → a DocumentLanguage.
 * @controlflow Each stage returns as soon as it yields a language: front matter wins, then the reader's choice, then detection when enabled and successful, otherwise the default language is returned.
 */
export function resolveDocumentLanguage(inputs: LanguageInputs): DocumentLanguage {
  const declared = normaliseLanguageTag(inputs.frontMatter?.['lang'] ?? inputs.frontMatter?.['language']);
  if (declared !== null) {
    // Front matter names the language explicitly; it travels with the file so it wins outright.
    return { language: declared, source: 'front-matter' };
  } else {
    // No front-matter language; fall through to the reader's choice and detection below.
  }
  const chosen = normaliseLanguageTag(inputs.chosen);
  if (chosen !== null) {
    // The reader picked a language for this document; honor it over an automatic guess.
    return { language: chosen, source: 'chosen' };
  } else {
    // No stored choice; fall through to detection or the default below.
  }
  if (inputs.detect) {
    const detected = detectLanguage(documentProse(inputs.text));
    if (detected !== null) {
      // A guess only names a language, not a region, so keep the default's region when the guess agrees with it.
      const language = detected === primaryLanguage(inputs.defaultLanguage) ? inputs.defaultLanguage : detected;
      return { language, source: 'detected' };
    } else {
      // Detection found nothing to name; fall through to the default below.
    }
  } else {
    // Guessing is disabled; skip detection and use the default below.
  }
  return { language: inputs.defaultLanguage, source: 'default' };
}

/**
 * @purpose Renders a readable language name for a tag such as "French" or "English (United Kingdom)", falling back to the raw tag.
 * @inputs tag - The language tag to name.
 * @outputs A human-readable name, or the raw tag when the platform cannot name it.
 * @dataflow Tag → Intl.DisplayNames.of → readable name; empty/undefined/unthrowing → raw tag.
 * @controlflow If the platform returns an empty or undefined name return the raw tag; otherwise return the name; if naming throws for an unusual tag, catch and return the raw tag.
 */
export function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    if (name === undefined || name === '') {
      // The platform cannot name this tag; show the raw tag as written.
      return tag;
    } else {
      // A readable language name is available; use it.
      return name;
    }
  } catch {
    // An unusual tag the platform refuses to name: show it as written.
    return tag;
  }
}

/**
 * @purpose Normalizes a document path into a single, case-insensitive storage key.
 * @inputs path - The raw document path as produced by the host.
 * @outputs The normalized key string.
 * @dataflow Raw path → backslashes replaced with forward slashes and lowercased → key.
 * @controlflow No branching; a pure transform. Windows paths differ only in separator and case, so one document maps to one key.
 */
function pathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * @purpose Reads the entire language map from storage, tolerating a throwing or corrupt store and keeping only string-valued entries.
 * @inputs storage - The LanguageStorage implementation to read from.
 * @outputs A record keyed by normalized path holding only string languages; empty when nothing is stored or it cannot be trusted.
 * @dataflow Storage value → JSON.parse → validated object → filtered to string values → return; any failure yields {}.
 * @controlflow If getItem throws (private window, storage off) return {}; if the value is null return {}; if it does not parse to a plain object return {}; otherwise return only the entries whose value is a string.
 */
function readAll(storage: LanguageStorage): Record<string, string> {
  let raw: string | null;
  try {
    raw = storage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage threw (private window or disabled): treat as no languages rather than erroring.
    return {};
  }
  if (raw === null) {
    // Nothing has ever been written: no languages.
    return {};
  } else {
    // A value exists; fall through to parse it below.
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // Well-formed map of languages; keep only entries whose value is a string.
      const record = parsed as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string') {
          // A genuine language tag; carry it over.
          result[key] = value;
        } else {
          // Not a string (number, object, null...): drop it as untrustworthy.
        }
      }
      return result;
    } else {
      // Corrupt or unexpected shape (array, string, number): ignore it.
      return {};
    }
  } catch {
    // Not valid JSON: treat as no languages rather than erroring.
    return {};
  }
}

/**
 * @purpose Returns the reader's remembered language for a document, or null when there is none.
 * @inputs storage - The LanguageStorage implementation to read from. path - The document path; null means unsaved.
 * @outputs The stored language for the path, or null when nothing is stored.
 * @dataflow Path → pathKey → lookup in the map read by readAll → language or null.
 * @controlflow If the path is null or empty return null (an unsaved document has no key to look up); otherwise return the stored entry or null.
 */
export function loadLanguageChoice(storage: LanguageStorage, path: string | null): string | null {
  if (path === null || path === '') {
    // No path means an unsaved document with nothing to key on.
    return null;
  } else {
    // A real path exists; look up its language below.
  }
  return readAll(storage)[pathKey(path)] ?? null;
}

/**
 * @purpose Persists a reader's language choice, removing it when forgotten and trimming the oldest entries to stay bounded.
 * @inputs storage - The LanguageStorage implementation to write to. path - The document path; null means unsaved. language - The new language; null forgets the choice.
 * @outputs None.
 * @dataflow Path → pathKey → update the map read by readAll → trim oldest → JSON.stringify back into storage.
 * @controlflow If the path is null or empty return without writing (nothing to key on); otherwise delete any existing entry first, store a non-null language, drop the oldest keys when over the cap, then write; a refused write loses only this preference.
 */
export function saveLanguageChoice(storage: LanguageStorage, path: string | null, language: string | null): void {
  if (path === null || path === '') {
    // No path means an unsaved document with nothing to key on.
    return;
  } else {
    // A real path exists; persist its choice below.
  }
  const all = readAll(storage);
  const key = pathKey(path);
  delete all[key];
  if (language !== null) {
    // Remember the chosen language; deleting first means this counts as most recently written.
    all[key] = language;
  } else {
    // Nothing to remember: leave the entry dropped rather than storing an empty one.
  }
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_LANGUAGES))) {
    // Drop the oldest entries while the map exceeds the cap so it cannot grow without bound.
    delete all[old];
  }
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A refused write (full or disabled storage) loses only this preference; never error out.
  }
}
