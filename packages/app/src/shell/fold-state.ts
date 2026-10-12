/**
 * @file fold-state.ts
 * @purpose Stores and persists the per-document set of folded section keys shared by both editor panes in the shell.
 * @inputs FoldStore contract from '@k-doc/editor'; a FoldStorage (browser localStorage) for persistence; document paths.
 * @outputs A FoldController factory, plus load/save/clear helpers keyed by normalized document path.
 * @functions
 *   - createFoldController: Builds an in-memory fold store with change notification and subscription support.
 *   - foldPathKey: Normalizes a document path for case-insensitive, separator-agnostic comparison.
 *   - readAll: Parses the persisted fold map from storage, validating its shape before use.
 *   - loadFolds: Returns the remembered folded keys for a single document path.
 *   - saveFolds: Writes a document's folded keys back to storage, evicting oldest documents past the cap.
 *   - clearFolds: Removes all persisted fold state.
 * @dataflow Document path → foldPathKey → FoldStorage map ↔ in-memory Set via createFoldController and emit.
 * @controlflow Load reads validated JSON into a Map; controller mutates an in-memory Set and emits on change; save writes the Map back with recency ordering and bounded eviction.
 * @version 1
 * @date 2026-09-16
 */

import type { FoldStore } from '@k-doc/editor';

/**
 * In-memory fold store for the shell, extended with batch and replacement operations.
 * Extends FoldStore so both editor panes render the same folded set and stay in sync via subscribe.
 */
export interface FoldController extends FoldStore {
  /** Snapshot of all currently-folded keys, in insertion (recency) order. */
  keys(): readonly string[];
  /** Applies many fold states at once, emitting only if something changed. */
  setMany(states: ReadonlyMap<string, boolean>): void;
  /** Replaces the entire folded set with the given keys. */
  replaceAll(keys: readonly string[]): void;
}

/**
 * @purpose Creates an in-memory FoldController backed by a Set, notifying an external observer and subscribers on change.
 * @inputs initial - the keys that start folded; onChange - invoked with the new key snapshot whenever the set changes.
 * @outputs A FoldController implementing FoldStore plus batch/replacement helpers.
 * @dataflow initial seeds the folded Set; mutations update it; emit() fans out to onChange and subscribers.
 * @controlflow Seed sets → define emit/setFolded helpers → return object wiring each method to the shared state.
 */
export function createFoldController(
  initial: readonly string[],
  onChange: (keys: readonly string[]) => void,
): FoldController {
  const folded = new Set<string>(initial);
  const listeners = new Set<() => void>();

  /**
   * @purpose Publishes the current fold set to the external observer and all subscribers.
   * @inputs none; reads the shared `folded` set and `listeners` set.
   * @outputs void; side-effecting: invokes onChange then each subscriber with a fresh snapshot array.
   * @dataflow folded Set → snapshot array → onChange + listener callbacks.
   * @controlflow Copy keys to an array (insertion order) → call onChange → iterate a copy of listeners calling each.
   */
  function emit(): void {
    const snapshot = [...folded];
    onChange(snapshot);
    for (const listener of [...listeners]) {
      listener();
    }
  }

  /**
   * @purpose Adds or removes a single key, skipping notification when the state is already as requested.
   * @inputs key - the section key to mutate; value - true to fold, false to unfold.
   * @outputs void; mutates `folded` and emits only on an actual change.
   * @dataflow (key, value) → compare with current membership → add/delete → emit.
   * @controlflow Early return when unchanged; otherwise branch on value to add or delete, then emit.
   */
  function setFolded(key: string, value: boolean): void {
    if (value === folded.has(key)) {
      // State already matches the request: skip mutation and notification.
      return;
    } else {
      // State differs from current: apply the requested fold state, then notify.
      if (value) {
        folded.add(key);
      } else {
        folded.delete(key);
      }
      emit();
    }
  }

  return {
    isFolded: (key: string): boolean => folded.has(key),
    setFolded,
    // Toggles a key by reusing setFolded with the inverted current state; no `this` binding required.
    toggle: (key: string): void => setFolded(key, !folded.has(key)),
    setMany(states: ReadonlyMap<string, boolean>): void {
      let changed = false;
      for (const [key, value] of states) {
        if (value !== folded.has(key)) {
          // Requested state differs from current: record the mutation.
          if (value) {
            folded.add(key);
          } else {
            folded.delete(key);
          }
          changed = true;
        } else {
          // State already matches: nothing to do for this key.
        }
      }
      if (changed) {
        emit();
      } else {
        // No key changed state: skip the notification entirely.
      }
    },
    replaceAll(keys: readonly string[]): void {
      const next = new Set(keys);
      if (next.size === folded.size && [...next].every((key) => folded.has(key))) {
        // Identical set (same size and every key present): no-op, skip notification.
        return;
      } else {
        // Sets differ: replace the active set contents, then notify.
        folded.clear();
        for (const key of next) {
          folded.add(key);
        }
        emit();
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    keys: (): readonly string[] => [...folded],
  };
}

/** Storage key under which the persisted fold map is stored in FoldStorage (localStorage). */
export const FOLD_STORAGE_KEY = 'kdoc.folds.v1';

/** Maximum number of documents whose folds are retained; oldest entries are evicted first. */
export const MAX_REMEMBERED_DOCUMENTS = 500; // oldest documents are forgotten first so the stored map cannot grow without bound

/** Minimal browser-storage surface used for persistence (e.g. localStorage). */
export interface FoldStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * @purpose Normalizes a document path so Windows and POSIX separators and casing compare equal.
 * @inputs path - the raw document path as produced by the host.
 * @outputs The normalized path with backslashes replaced by forward slashes and lowercased.
 * @dataflow Raw path → separator normalization → case folding → comparison key.
 * @controlflow Single transformation pipeline: replace '\\' then toLowerCase; no branching.
 */
export function foldPathKey(path: string): string {
  // Windows paths compare case-insensitively with either separator; unify both before lowercasing.
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * @purpose Reads and validates the entire persisted fold map from storage.
 * @inputs storage - the FoldStorage backend to read FOLD_STORAGE_KEY from.
 * @outputs A Map of normalized path key → folded keys; empty when nothing is stored.
 * @dataflow Raw JSON string → parsed array of [pathKey, keys] pairs → validated Map.
 * @controlflow Null raw returns empty map; otherwise parse (throwing on bad JSON), assert array shape, validate each pair, then build the map.
 */
function readAll(storage: FoldStorage): Map<string, string[]> {
  const raw = storage.getItem(FOLD_STORAGE_KEY);
  if (raw === null) {
    // Nothing stored yet: represent it as an empty map rather than failing.
    return new Map<string, string[]>();
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`The saved fold state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed)) {
      // Parsed value is not the expected array of pairs.
      throw new Error('The saved fold state has an unexpected shape.');
    } else {
      const result = new Map<string, string[]>();
      for (const entry of parsed) {
        // Validate each record is exactly a [pathKey, keys] pair of strings before trusting it.
        const [path, keys]: unknown[] = Array.isArray(entry) ? entry : [];
        if (
          !(Array.isArray(entry) && entry.length === 2 && typeof path === 'string' && Array.isArray(keys) && keys.every((key: unknown) => typeof key === 'string'))
        ) {
          // A record that is not a two-element string array pair is rejected.
          throw new Error('The saved fold state has an unexpected shape.');
        } else {
          // The guard above guarantees these types; assert them for the map write.
          result.set(path as string, keys as string[]);
        }
      }
      return result;
    }
  }
}

/**
 * @purpose Loads the folded keys remembered for a single document path.
 * @inputs storage - the FoldStorage backend to read from; path - the document path to look up.
 * @outputs The stored folded keys for that path, or an empty array when none are remembered.
 * @dataflow path → foldPathKey → readAll map lookup → keys (or []).
 * @controlflow Normalize path, fetch from the validated map, default to empty on miss; no branching beyond the nullish coalesce.
 */
export function loadFolds(storage: FoldStorage, path: string): string[] {
  return readAll(storage).get(foldPathKey(path)) ?? [];
}

/**
 * @purpose Persists a document's folded keys, keeping recency order and bounding stored documents.
 * @inputs storage - the FoldStorage backend to write to; path - the document path; keys - current folded keys.
 * @outputs void; mutates FOLD_STORAGE_KEY in place.
 * @dataflow path → foldPathKey → update map entry → evict oldest past cap → serialize back to storage.
 * @controlflow Delete then re-insert last (most recent); if empty, drop the entry; trim oldest while over cap; write JSON array of entries.
 */
export function saveFolds(storage: FoldStorage, path: string, keys: readonly string[]): void {
  const all = readAll(storage);
  const key = foldPathKey(path);
  all.delete(key);
  if (keys.length > 0) {
    // Re-insert last so this document is treated as the most recent.
    all.set(key, [...keys]);
  } else {
    // Nothing folded: leave no entry rather than remembering an empty list.
  }
  while (all.size > MAX_REMEMBERED_DOCUMENTS) {
    const oldest = all.keys().next();
    if (oldest.done) {
      // Map emptied unexpectedly before reaching the cap; stop evicting.
      break;
    } else {
      all.delete(oldest.value);
    }
  }
  storage.setItem(FOLD_STORAGE_KEY, JSON.stringify([...all.entries()]));
}

/**
 * @purpose Clears every persisted fold record by resetting the stored map to empty.
 * @inputs storage - the FoldStorage backend to clear.
 * @outputs void; overwrites FOLD_STORAGE_KEY with an empty array literal.
 * @dataflow '[]' string → storage.setItem(FOLD_STORAGE_KEY, ...).
 * @controlflow Single unconditional write; no branching.
 */
export function clearFolds(storage: FoldStorage): void {
  storage.setItem(FOLD_STORAGE_KEY, '[]');
}
