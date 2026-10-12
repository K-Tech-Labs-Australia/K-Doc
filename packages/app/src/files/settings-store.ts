/**
 * @file settings-store.ts
 * @purpose Persistence store for K-Doc user configuration settings (FR-14.15), providing Tauri IPC persistence in the app data directory, localStorage browser fallback, and non-throwing recovery defaults.
 *
 *   HEADER NOTE: User settings persistence allows preferences to survive application restarts (FR-14.15).
 *   In the desktop application, settings are persisted to the user's application data directory via
 *   dedicated Tauri IPC commands (read_settings_file, write_settings_file) rather than generic text file I/O,
 *   so the webview does not need to know or construct the app data path. In the Vite browser dev build,
 *   a localStorage fallback under the 'kdoc.settings' key ensures preferences workflows remain testable
 *   without native host binaries. Settings are a convenience, and an editor that refuses to open because
 *   a preferences file is malformed has turned a cosmetic problem into a total one; therefore, load()
 *   must never reject, falling back gracefully to defaults.
 *
 * @inputs Browser Window object for runtime capability detection; KdocSettings objects for serialization and persistence.
 * @outputs SETTINGS_FILE_NAME constant, SettingsStore persistence interface, and createSettingsStore factory function.
 * @functions
 *   - isTauri: Capability probe determining if the runtime is a Tauri host via the __TAURI_INTERNALS__ global.
 *   - getUsableLocalStorage: Probes window localStorage with try/catch to detect private browsing or security blocks.
 *   - createTauriSettingsStore: Constructs a SettingsStore backed by dedicated Tauri IPC commands (read_settings_file, write_settings_file).
 *   - createLocalStorageSettingsStore: Constructs a fallback SettingsStore persisting serialized settings in browser localStorage under 'kdoc.settings'.
 *   - createUnavailableSettingsStore: Constructs a graceful fallback SettingsStore returning defaults and no-oping when storage is blocked.
 *   - createSettingsStore: Factory constructing the appropriate SettingsStore based on runtime environment capabilities.
 * @dataflow Settings text on disk / localStorage -> SettingsStore.load() -> parseSettings() -> LoadedSettings -> UI; updated KdocSettings -> serializeSettings() -> SettingsStore.save() -> atomic write to disk / localStorage.
 * @controlflow createSettingsStore probes runtime via isTauri / getUsableLocalStorage -> returns active backend -> load() catches all errors and returns defaults without throwing -> save() writes serialized JSON and propagates write failures.
 * @version 1
 * @date 2026-09-05
 */

import { invoke } from '@tauri-apps/api/core';
import {
  parseSettings,
  serializeSettings,
  DEFAULT_SETTINGS,
  type KdocSettings,
  type LoadedSettings,
} from '@k-doc/config';

/**
 * Canonical filename for the user configuration file in the application data directory.
 */
export const SETTINGS_FILE_NAME: string = 'settings.json';

/**
 * Storage interface for managing user configuration settings persistence across sessions.
 */
export interface SettingsStore {
  readonly available: boolean;
  /** Never rejects. Returns the defaults, plus any problems worth telling the user about. */
  load(): Promise<LoadedSettings>;
  save(settings: KdocSettings): Promise<void>;
}

/**
 * Key used to store user settings in browser localStorage for development parity.
 */
const SETTINGS_STORAGE_KEY = 'kdoc.settings';

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
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
    const probeKey = '__kdoc_settings_probe__';
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);

    return storage;
  } catch {
    // Branch: Accessing or probing localStorage threw an exception; treat as unavailable.
    return null;
  }
}

/**
 * Constructs a SettingsStore backed by native Tauri IPC commands.
 *
 * @purpose Implements settings persistence via Tauri Rust commands in the application data directory.
 * @inputs None.
 * @outputs SettingsStore - An active SettingsStore delegating to read_settings_file and write_settings_file.
 * @dataflow SettingsStore calls -> Tauri IPC invoke commands -> native filesystem atomic I/O.
 * @controlflow Wrap Tauri invoke commands -> load() catches IPC errors and returns defaults without throwing -> save() writes serialized JSON and propagates errors.
 */
function createTauriSettingsStore(): SettingsStore {
  return {
    available: true,

    async load(): Promise<LoadedSettings> {
      // Settings are a convenience, and an editor that refuses to open because a preferences file
      // is malformed has turned a cosmetic problem into a total one. Therefore, load() must never reject.
      // Every read operation is wrapped in a try/catch block. On any failure — IPC error, unreadable file,
      // permission error — we return parseSettings('{}') so the caller receives DEFAULT_SETTINGS and can carry on.
      //
      // A missing file is the normal first-run case and must not even be reported as a problem.
      // The Rust read_settings_file command returns Ok(String::new()) when the file does not exist.
      // An empty string signifies this missing first-run file, which parseSettings('{}') handles without generating any diagnostics.
      //
      // When the file exists and contains content, parseSettings already never throws and reports problems
      // rather than failing. We pass the file's text straight to parseSettings and return its result unchanged —
      // we do not re-validate here because duplicating the validation would let the two copies disagree.
      try {
        // Invoke the Rust read_settings_file command.
        // We invoke read_settings_file rather than the generic read_text_file because the settings file
        // lives in the app data directory whose path the webview must not have to know or construct.
        const raw = await invoke<unknown>('read_settings_file');

        // Check if the payload returned over IPC is a string.
        if (typeof raw !== 'string') {
          // Branch: IPC response is not a string; return defaults without error.
          return parseSettings('{}');
        } else {
          // Branch: IPC response is a valid string; proceed to check content.
        }

        // Check if the returned string is empty, representing a missing file on first run.
        if (raw.trim().length === 0) {
          // Branch: First-run case where settings file does not yet exist on disk; return defaults with no problems.
          return parseSettings('{}');
        } else {
          // Branch: Settings file exists and contains text; pass straight to parseSettings without re-validation.
          return parseSettings(raw);
        }
      } catch {
        // Branch: Tauri IPC invocation failed or threw an exception; load() must never reject.
        return parseSettings('{}');
      }
    },

    async save(settings: KdocSettings): Promise<void> {
      // Serialise settings with serializeSettings and invoke the Rust write_settings_file command.
      // We invoke write_settings_file with { contents } rather than the generic write_text_file,
      // because the settings file lives in the app data directory whose path the webview must not have to know or construct.
      // Unlike loading, a failed save is worth telling the user about, because they just asked
      // for something and it did not happen. Therefore, errors are allowed to propagate to the caller.
      const contents = serializeSettings(settings);
      await invoke('write_settings_file', { contents });
    },
  };
}

/**
 * Constructs a fallback SettingsStore persisting settings in browser localStorage for development parity.
 *
 * @purpose Implements settings persistence in localStorage so the Vite dev build exercises the preferences path.
 * @inputs storage - The verified usable browser Storage instance.
 * @outputs SettingsStore - An active SettingsStore persisting serialized settings under the 'kdoc.settings' key.
 * @dataflow SettingsStore calls -> localStorage getItem / setItem -> serialized settings JSON string.
 * @controlflow Wrap localStorage operations in try/catch -> load() catches errors and returns defaults -> save() propagates errors to the caller.
 */
function createLocalStorageSettingsStore(storage: Storage): SettingsStore {
  return {
    available: true,

    async load(): Promise<LoadedSettings> {
      // Wrap every localStorage access in try/catch and treat a throw as "unavailable".
      // Private-browsing modes and storage-blocking settings make localStorage throw on access
      // rather than merely returning null, so an unguarded read takes the whole editor down.
      //
      // Settings are a convenience, and an editor that refuses to open because a preferences file
      // is malformed has turned a cosmetic problem into a total one. Therefore, load() must never reject.
      // On any failure — missing key, storage threw an error, or unreadable storage — return parseSettings('{}')
      // so the caller receives DEFAULT_SETTINGS and can carry on.
      //
      // A missing key in localStorage is the normal first-run case in browser development and must not even
      // be reported as a problem. When getItem returns null or an empty string, parseSettings('{}') returns defaults
      // without diagnostic problems.
      //
      // For existing content, parseSettings already never throws and reports problems rather than failing,
      // so pass the stored text straight to it and return its result unchanged — do not re-validate here,
      // because duplicating the validation would let the two copies disagree.
      try {
        const raw = storage.getItem(SETTINGS_STORAGE_KEY);

        // Check if the settings key was found in localStorage.
        if (raw === null) {
          // Branch: First-run case where no settings exist yet in localStorage; return defaults without problems.
          return parseSettings('{}');
        } else {
          // Branch: Stored settings string found; proceed to check content.
        }

        // Check if the stored string is empty or whitespace-only.
        if (raw.trim().length === 0) {
          // Branch: Stored string is empty; return defaults without problems.
          return parseSettings('{}');
        } else {
          // Branch: Non-empty settings text; delegate directly to parseSettings without re-validation.
          return parseSettings(raw);
        }
      } catch {
        // Branch: localStorage access threw an exception; return defaults safely without rejecting.
        return parseSettings('{}');
      }
    },

    async save(settings: KdocSettings): Promise<void> {
      const contents = serializeSettings(settings);

      // Wrap every localStorage access in try/catch.
      // Private-browsing modes and storage-blocking settings make localStorage throw on access
      // rather than merely returning null, so an unguarded read takes the whole editor down.
      // Unlike loading, a failed save is worth telling the user about, because they just asked
      // for something and it did not happen. Therefore, errors are allowed to propagate to the caller.
      try {
        storage.setItem(SETTINGS_STORAGE_KEY, contents);
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
 * Constructs a fallback SettingsStore for environments where neither Tauri nor localStorage is usable.
 *
 * @purpose Provides a non-throwing fallback settings store when storage capabilities are completely absent.
 * @inputs None.
 * @outputs SettingsStore - An unavailable store whose load returns default settings and whose save is a safe no-op.
 * @dataflow Defaults returned on load; save calls safely discarded.
 * @controlflow Return SettingsStore object with available: false, load resolving to defaults, and save no-oping.
 */
function createUnavailableSettingsStore(): SettingsStore {
  // Settings storage that cannot write is a feature that is absent (e.g. in restricted sandboxes),
  // not an error to interrupt the user or startup with.
  return {
    available: false,

    async load(): Promise<LoadedSettings> {
      // Branch: Settings storage is unavailable; return defaults safely without problems.
      return {
        settings: DEFAULT_SETTINGS,
        problems: [],
        unknownKeys: {},
      };
    },

    async save(_settings: KdocSettings): Promise<void> {
      // Branch: Settings storage is unavailable; save is a safe no-op.
    },
  };
}

/**
 * Creates a settings store instance bound to the provided window context.
 *
 * @purpose Picks the appropriate persistence backend (Tauri IPC, localStorage fallback, or unavailable store) at construction.
 * @inputs win - The host browser Window object to inspect for Tauri desktop host capabilities.
 * @outputs SettingsStore - An object implementing load and save operations for user configuration settings.
 * @dataflow Window capability checks -> selected SettingsStore backend implementation.
 * @controlflow Probe Tauri runtime availability via isTauri(win) -> if present return Tauri store -> else probe getUsableLocalStorage(win) -> if present return localStorage fallback -> else return unavailable store.
 */
export function createSettingsStore(win: Window): SettingsStore {
  // Check whether running inside the Tauri desktop runtime host.
  if (isTauri(win)) {
    // Branch: Running inside Tauri desktop runtime host.
    // This is the primary backend: settings are stored in the app data directory.
    return createTauriSettingsStore();
  } else {
    // Branch: Running outside Tauri desktop host; probe for browser localStorage fallback.
  }

  const storage = getUsableLocalStorage(win);

  // Check whether browser localStorage is usable without throwing.
  if (storage !== null) {
    // Branch: Browser localStorage is usable; return fallback store so Vite dev build exercises settings persistence.
    return createLocalStorageSettingsStore(storage);
  } else {
    // Branch: Neither Tauri nor localStorage is usable; return disabled store.
    // An unavailable store returns defaults on load and silently no-ops on save.
    return createUnavailableSettingsStore();
  }
}
