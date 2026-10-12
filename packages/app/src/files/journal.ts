/**
 * @file journal.ts
 * @purpose TypeScript implementation of crash-recovery journalling for K-Doc (FR-6.3), providing Tauri IPC persistence, localStorage browser fallback, and recovery evaluation.
 *
 *   HEADER NOTE: Crash recovery protects unsaved user work across abnormal terminations (FR-6.3).
 *   In the desktop application, records are persisted to the user's application data directory via
 *   Tauri IPC commands (journal_write, journal_list, journal_clear). In the Vite browser dev build,
 *   a localStorage fallback ensures recovery workflows remain testable without native host binaries.
 *   If storage is completely blocked (e.g. private-browsing modes throwing on access), the store
 *   gracefully reports available: false rather than failing or interrupting the user.
 *
 * @inputs Browser Window object for runtime capability detection; buffer IDs, file paths, and document contents for journal I/O; on-disk document text for recovery qualification.
 * @outputs JournalRecord data structures, JournalStore persistence interface, and isRecoverable predicate helper.
 * @functions
 *   - isJournalRecord: Type guard validating that an unknown value conforms to the JournalRecord interface.
 *   - isTauri: Capability probe determining if the runtime is a Tauri host via the __TAURI_INTERNALS__ global.
 *   - getUsableLocalStorage: Probes window localStorage with try/catch to detect private browsing or security blocks.
 *   - createTauriJournalStore: Constructs a JournalStore backed by Tauri native IPC commands (journal_write, journal_list, journal_clear).
 *   - createLocalStorageJournalStore: Constructs a fallback JournalStore persisting records in browser localStorage for Vite dev parity.
 *   - createUnavailableJournalStore: Constructs a graceful no-op JournalStore when neither native nor browser storage is usable.
 *   - createJournalStore: Factory constructing the appropriate JournalStore based on runtime environment capabilities.
 *   - isRecoverable: Pure helper determining whether a journal record warrants offering recovery against current disk contents.
 * @dataflow Document buffer state -> JournalStore.write() -> Tauri IPC / localStorage -> JournalStore.list() -> isRecoverable() filter -> UI recovery prompt.
 * @controlflow createJournalStore probes runtime via isTauri / getUsableLocalStorage -> returns active backend -> callers invoke write / list / clear -> list filters and catches errors -> isRecoverable compares buffer to disk state.
 * @version 1
 * @date 2026-09-05
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Unsaved editor buffer state persisted in the crash-recovery journal.
 *
 * Tauri serialises Rust struct fields verbatim, so the entry's timestamp field
 * arrives as saved_at_ms, not savedAtMs.
 */
export interface JournalRecord {
  readonly id: string;
  readonly path: string | null;
  readonly contents: string;
  readonly saved_at_ms: number;
}

/**
 * Storage interface for managing crash-recovery journal records across sessions.
 */
export interface JournalStore {
  /** False when neither Tauri nor localStorage is usable; every method then no-ops. */
  readonly available: boolean;
  write(id: string, path: string | null, contents: string): Promise<void>;
  list(): Promise<readonly JournalRecord[]>;
  clear(id: string): Promise<void>;
}

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Key prefix used to namespace crash-recovery journal entries in browser localStorage.
 */
const JOURNAL_STORAGE_PREFIX = 'kdoc.journal.';

/**
 * Type guard validating that an unknown value conforms to the JournalRecord interface.
 *
 * @purpose Narrow untrusted IPC payloads and deserialized JSON to JournalRecord safely without any.
 * @inputs value - Unknown candidate value to validate.
 * @outputs boolean - True if value matches JournalRecord structure, false otherwise.
 * @dataflow value -> property inspection and type validation -> boolean assertion result.
 * @controlflow Verify value is non-null object -> check id is string -> check path is string or null -> check contents is string -> check saved_at_ms is finite number -> return boolean.
 */
function isJournalRecord(value: unknown): value is JournalRecord {
  // Check if value is a non-null object.
  if (typeof value !== 'object' || value === null) {
    // Branch: Value is null or a primitive; not a journal record.
    return false;
  } else {
    // Branch: Value is an object; proceed to validate property types.
  }

  const candidate = value as Record<string, unknown>;

  // Check if 'id' exists and is a string.
  const id = candidate['id'];
  if (typeof id !== 'string') {
    // Branch: Missing or non-string id property.
    return false;
  } else {
    // Branch: Valid string id property present.
  }

  // Check if 'path' exists and is either a string or null.
  const path = candidate['path'];
  if (typeof path !== 'string' && path !== null) {
    // Branch: Path property is neither a string nor null.
    return false;
  } else {
    // Branch: Valid path property (string or null) present.
  }

  // Check if 'contents' exists and is a string.
  const contents = candidate['contents'];
  if (typeof contents !== 'string') {
    // Branch: Missing or non-string contents property.
    return false;
  } else {
    // Branch: Valid string contents property present.
  }

  // Check if 'saved_at_ms' exists and is a finite number.
  // Tauri serialises Rust struct fields verbatim, so the entry's timestamp field arrives as saved_at_ms, not savedAtMs.
  const savedAtMs = candidate['saved_at_ms'];
  if (typeof savedAtMs !== 'number' || !Number.isFinite(savedAtMs)) {
    // Branch: Missing, non-number, or non-finite saved_at_ms timestamp property.
    return false;
  } else {
    // Branch: Valid finite timestamp number present.
  }

  return true;
}

/**
 * Checks whether the application is running inside a Tauri desktop host environment.
 *
 * @purpose Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 * @inputs win - The browser Window object to inspect.
 * @outputs boolean - True if running inside Tauri host, false otherwise.
 * @dataflow Window object -> '__TAURI_INTERNALS__' property presence check -> boolean capability status.
 * @controlflow Inspect '__TAURI_INTERNALS__' in window -> return true if present, false if absent.
 */
function isTauri(win: Window): boolean {
  // Checking for the __TAURI_INTERNALS__ global is how the Tauri runtime announces itself.
  // Checking this property is preferable to a try/catch around a failing invoke,
  // because a capability check should not be implemented as an exception.
  const candidate = win as unknown as TauriWindow;

  // Check if '__TAURI_INTERNALS__' exists on the window object.
  if ('__TAURI_INTERNALS__' in candidate) {
    // Branch: Running inside Tauri desktop runtime host.
    return true;
  } else {
    // Branch: Running inside standard browser environment.
    return false;
  }
}

/**
 * Safely probes and retrieves the window localStorage instance, catching any permission or security errors.
 *
 * @purpose Validates whether localStorage is accessible without crashing the application in private browsing or restricted environments.
 * @inputs win - The browser Window object to inspect.
 * @outputs Storage | null - The Storage object if usable, or null if inaccessible or throwing.
 * @dataflow win.localStorage -> probe read/write -> Storage reference or null.
 * @controlflow Access win.localStorage -> test probe setItem and removeItem -> return Storage if successful -> return null on throw or missing.
 */
function getUsableLocalStorage(win: Window): Storage | null {
  try {
    // Wrap every localStorage access in try/catch and treat a throw as "unavailable".
    // Private-browsing modes and storage-blocking settings make localStorage throw on access
    // rather than merely returning null, so an unguarded read takes the whole editor down.
    const storage = win.localStorage;

    // Check if the localStorage property is defined and non-null.
    if (!storage) {
      // Branch: localStorage is absent on the window context.
      return null;
    } else {
      // Branch: localStorage exists; verify read and write access.
    }

    // Probe storage with a write and remove to ensure access is not blocked by privacy settings.
    const probeKey = '__kdoc_journal_probe__';
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);

    return storage;
  } catch {
    // Branch: Accessing or probing localStorage threw an exception; treat as unavailable.
    return null;
  }
}

/**
 * Constructs a JournalStore backed by native Tauri IPC commands.
 *
 * @purpose Implements crash-recovery journal persistence via Tauri Rust commands writing to the application data directory.
 * @inputs None.
 * @outputs JournalStore - An active JournalStore delegating to journal_write, journal_list, and journal_clear.
 * @dataflow JournalStore calls -> Tauri IPC invoke commands -> native filesystem atomic I/O.
 * @controlflow Wrap Tauri invoke commands -> list() catches IPC errors and returns empty array -> write() and clear() let errors propagate.
 */
function createTauriJournalStore(): JournalStore {
  return {
    available: true,

    async write(id: string, path: string | null, contents: string): Promise<void> {
      // Invoke the Rust journal_write command.
      // Tauri converts camelCase JavaScript argument keys to the Rust snake_case parameter names automatically.
      // Errors propagate to the caller, which can decide whether to surface them.
      await invoke('journal_write', { id, path, contents });
    },

    async list(): Promise<readonly JournalRecord[]> {
      try {
        const payload = await invoke<unknown>('journal_list');

        // Check if the payload returned over IPC is an array.
        if (!Array.isArray(payload)) {
          // Branch: IPC response is not an array; return empty list.
          return [];
        } else {
          // Branch: IPC response is an array; proceed to validate entries.
        }

        const records: JournalRecord[] = [];
        for (let i = 0; i < payload.length; i++) {
          const item = payload[i];
          // Check if item is defined to satisfy strict noUncheckedIndexedAccess.
          if (item === undefined) {
            // Branch: Undefined array element; skip.
            continue;
          } else {
            // Branch: Item is defined; proceed to validate schema.
          }

          // Check if the item matches JournalRecord structure.
          if (isJournalRecord(item)) {
            // Branch: Valid journal record; retain.
            records.push(item);
          } else {
            // Branch: Malformed or unparseable record payload; skip corrupt entry.
          }
        }

        return records;
      } catch {
        // Branch: Tauri IPC invocation failed; list() must never reject.
        // Recovery is a best-effort convenience offered at startup, and an exception there
        // would block the editor from opening at all — which is strictly worse than losing the offer to recover.
        return [];
      }
    },

    async clear(id: string): Promise<void> {
      // Invoke the Rust journal_clear command.
      // Errors propagate to the caller, which can decide whether to surface them.
      await invoke('journal_clear', { id });
    },
  };
}

/**
 * Constructs a fallback JournalStore persisting records in browser localStorage for development parity.
 *
 * @purpose Implements crash-recovery journal persistence in localStorage so the Vite dev build exercises the recovery path.
 * @inputs storage - The verified usable browser Storage instance.
 * @outputs JournalStore - An active JournalStore storing serialized records under kdoc.journal.${id} keys.
 * @dataflow JournalStore calls -> localStorage getItem/setItem/removeItem -> serialized JournalRecord JSON.
 * @controlflow Wrap localStorage operations in try/catch -> list() iterates prefixed keys and skips corrupt JSON -> write() and clear() rethrow errors.
 */
function createLocalStorageJournalStore(storage: Storage): JournalStore {
  return {
    available: true,

    async write(id: string, path: string | null, contents: string): Promise<void> {
      const record: JournalRecord = {
        id,
        path,
        contents,
        saved_at_ms: Date.now(),
      };

      // Wrap every localStorage access in try/catch.
      // Private-browsing modes and storage-blocking settings make localStorage throw on access
      // rather than merely returning null, so an unguarded read takes the whole editor down.
      // write() lets its errors propagate to the caller, which can decide whether to surface them.
      try {
        storage.setItem(`${JOURNAL_STORAGE_PREFIX}${id}`, JSON.stringify(record));
      } catch (err: unknown) {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Caught error is an Error instance; rethrow directly.
          throw err;
        } else {
          // Branch: Caught error is a non-Error value; wrap and rethrow.
          throw new Error(String(err));
        }
      }
    },

    async list(): Promise<readonly JournalRecord[]> {
      // Wrap every localStorage access in try/catch.
      // Private-browsing modes and storage-blocking settings make localStorage throw on access
      // rather than merely returning null, so an unguarded read takes the whole editor down.
      // list() must never reject: a failure returns an empty array.
      // Recovery is a best-effort convenience offered at startup, and an exception there
      // would block the editor from opening at all — which is strictly worse than losing the offer to recover.
      try {
        const records: JournalRecord[] = [];
        const length = storage.length;

        for (let i = 0; i < length; i++) {
          const key = storage.key(i);
          // Check if key is non-null and starts with the journal storage prefix.
          if (key !== null && key.startsWith(JOURNAL_STORAGE_PREFIX)) {
            // Branch: Key matches journal prefix; read raw value from storage.
            const raw = storage.getItem(key);
            // Check if raw value was found in storage.
            if (raw !== null) {
              // Branch: Raw value present; attempt JSON parse and validation.
              try {
                const parsed: unknown = JSON.parse(raw);
                // Check if parsed payload conforms to JournalRecord.
                if (isJournalRecord(parsed)) {
                  // Branch: Valid journal record; retain.
                  records.push(parsed);
                } else {
                  // Branch: Corrupted or invalid journal structure; skip entry.
                }
              } catch {
                // Branch: JSON parse threw syntax error; skip corrupt entry.
              }
            } else {
              // Branch: Storage item was null; skip key.
            }
          } else {
            // Branch: Key is null or does not match journal prefix; skip.
          }
        }

        return records;
      } catch {
        // Branch: localStorage access threw an exception; return empty list without rejecting.
        return [];
      }
    },

    async clear(id: string): Promise<void> {
      // Wrap every localStorage access in try/catch.
      // Private-browsing modes and storage-blocking settings make localStorage throw on access
      // rather than merely returning null, so an unguarded read takes the whole editor down.
      // clear() lets its errors propagate to the caller, which can decide whether to surface them.
      try {
        storage.removeItem(`${JOURNAL_STORAGE_PREFIX}${id}`);
      } catch (err: unknown) {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Caught error is an Error instance; rethrow directly.
          throw err;
        } else {
          // Branch: Caught error is a non-Error value; wrap and rethrow.
          throw new Error(String(err));
        }
      }
    },
  };
}

/**
 * Constructs a fallback JournalStore for environments where neither Tauri nor localStorage is usable.
 *
 * @purpose Provides a non-throwing no-op journal store when storage capabilities are completely absent.
 * @inputs None.
 * @outputs JournalStore - An unavailable store whose methods resolve safely to no-ops or an empty list.
 * @dataflow No-ops and empty list returned for all operations.
 * @controlflow Return JournalStore object with available: false and non-throwing async methods.
 */
function createUnavailableJournalStore(): JournalStore {
  // A journal that cannot write is a feature that is absent, not an error to interrupt the user with —
  // the caller decides whether to tell them.
  return {
    available: false,
    async write(_id: string, _path: string | null, _contents: string): Promise<void> {
      // Branch: Journal storage is unavailable; write is a safe no-op.
    },
    async list(): Promise<readonly JournalRecord[]> {
      // Branch: Journal storage is unavailable; list resolves to an empty array.
      return [];
    },
    async clear(_id: string): Promise<void> {
      // Branch: Journal storage is unavailable; clear is a safe no-op.
    },
  };
}

/**
 * Creates a crash-recovery journal store instance bound to the provided window context.
 *
 * @purpose Picks the appropriate persistence backend (Tauri, localStorage fallback, or unavailable no-op) at construction.
 * @inputs win - The host browser Window object to inspect for Tauri desktop host capabilities.
 * @outputs JournalStore - An object implementing write, list, and clear operations for crash-recovery buffers.
 * @dataflow Window capability checks -> selected JournalStore backend implementation.
 * @controlflow Probe Tauri runtime availability via isTauri(win) -> if present return Tauri store -> else probe getUsableLocalStorage(win) -> if present return localStorage fallback -> else return unavailable no-op store.
 */
export function createJournalStore(win: Window): JournalStore {
  // Check whether running inside the Tauri desktop runtime host.
  if (isTauri(win)) {
    // Branch: Running inside Tauri desktop runtime host.
    // This is the real backend, because the app-data directory survives a crash and browser storage may not.
    return createTauriJournalStore();
  } else {
    // Branch: Running outside Tauri desktop host; probe for browser localStorage fallback.
  }

  const storage = getUsableLocalStorage(win);

  // Check whether browser localStorage is usable without throwing.
  if (storage !== null) {
    // Branch: Browser localStorage is usable; return fallback store so Vite dev build exercises recovery path.
    return createLocalStorageJournalStore(storage);
  } else {
    // Branch: Neither Tauri nor localStorage is usable; return disabled store.
    // A journal that cannot write is a feature that is absent, not an error to interrupt the user with —
    // the caller decides whether to tell them.
    return createUnavailableJournalStore();
  }
}

/**
 * Determines whether a recovered journal record contains actionable differences worthy of user prompt.
 *
 * @purpose Evaluates if a journal record has non-empty content differing from the on-disk file state.
 * @inputs
 *   - record - The candidate JournalRecord retrieved from storage.
 *   - currentDiskText - The text contents of the file currently on disk, or null if unsaved / missing.
 * @outputs boolean - True if recovery should be offered to the user; false if redundant or empty.
 * @dataflow record.contents + currentDiskText -> emptiness and equality checks -> boolean recovery viability.
 * @controlflow Check empty contents -> return false -> check equality with disk text -> return false -> return true.
 */
export function isRecoverable(record: JournalRecord, currentDiskText: string | null): boolean {
  // Offering to restore a journal identical to what is already on disk trains the user to dismiss
  // the prompt without reading it, which is how a real recovery gets thrown away.

  // Check if the record contents is empty.
  if (record.contents.length === 0) {
    // Branch: Empty buffer has no unsaved content to recover; return false.
    return false;
  } else {
    // Branch: Record has non-empty contents; compare with current disk state.
  }

  // Check if the record contents matches the current on-disk text exactly.
  if (record.contents === currentDiskText) {
    // Branch: Journal contents is identical to what is already on disk; return false.
    return false;
  } else {
    // Branch: Journal contents differs from disk (or document has no on-disk file); return true.
    return true;
  }
}
