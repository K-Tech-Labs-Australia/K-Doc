/**
 * @file recent-files-controller.ts
 * @purpose Single owner of the recent-files list sitting between the settings store and the dialog (FR-6.1).
 *
 * The list has one owner, and this is it. The dialog shows what it is given and reports what the user did;
 * the settings store persists whatever it is handed; the pure functions in @k-doc/config do the arithmetic.
 * Every one of those would work perfectly while disagreeing with the others if any two of them also held a
 * copy of the list.
 *
 * Persisting is fire-and-forget by design. A recent-files entry is a convenience, and a user who opens a
 * file should not wait on a settings write to see it open, nor see an error because a list of filenames could
 * not be saved. A failed write is reported through onError and the in-memory list is kept, because the list
 * being right for this session is better than the list being empty.
 *
 * @inputs RecentFilesControllerOptions containing readSettings, writeSettings, onError, and optional now clock.
 * @outputs RecentFilesController interface and createRecentFilesController factory function.
 * @functions
 *   - createRecentFilesController: Constructs a RecentFilesController instance managing recent files state between the settings store and UI dialogs.
 *   - withRecentFiles: Returns a new settings object with general.recentFiles replaced by the provided list.
 *   - sameList: Compares two recent file lists for exact equality across all fields (path, pinned, openedAt).
 * @dataflow Settings store → readSettings() → pure transformations (@k-doc/config) → writeSettings() / dialog.
 * @controlflow Factory initializes clock and helpers → methods read settings, apply pure transformations, compare changes, and persist fire-and-forget.
 * @version 1
 * @date 2026-09-11
 */

import {
  recordRecentFile,
  togglePinnedFile,
  forgetRecentFile,
  orderRecentFiles,
  type RecentFile,
  type KdocSettings,
} from '@k-doc/config';

export interface RecentFilesControllerOptions {
  /** The settings as they currently stand. The controller reads only `general.recentFiles` from them. */
  readonly readSettings: () => KdocSettings;
  /** Hands back settings with a new recent-files list for the shell to apply and persist. */
  readonly writeSettings: (next: KdocSettings) => void;
  /** Called when persisting fails. */
  readonly onError: (message: string) => void;
  /** Supplies the current time, so a test does not have to wait for the clock. */
  readonly now?: () => number;
}

export interface RecentFilesController {
  /** The list as it stands, in menu order. */
  readonly files: readonly RecentFile[];
  /** Records that a path was just opened or saved under. */
  record(path: string): void;
  /** Pins or unpins a path, returning the list as it now stands. */
  togglePin(path: string): readonly RecentFile[];
  /** Removes a path, returning the list as it now stands. */
  forget(path: string): readonly RecentFile[];
}

/**
 * @purpose Returns a new settings object with general.recentFiles replaced by the provided list.
 * @inputs settings: KdocSettings - The current immutable KdocSettings object.
 * @inputs list: readonly RecentFile[] - The updated list of recent file entries.
 * @outputs KdocSettings - A new KdocSettings object with updated recentFiles while preserving all other settings.
 * @dataflow settings + list → spread settings and general section → new KdocSettings object.
 * @controlflow Spread settings root and general section -> replace recentFiles with list -> return new KdocSettings.
 */
function withRecentFiles(settings: KdocSettings, list: readonly RecentFile[]): KdocSettings {
  // The whole settings object is rewritten rather than mutated because settings are frozen and the store compares them.
  return {
    ...settings,
    general: {
      ...settings.general,
      recentFiles: list,
    },
  };
}

/**
 * @purpose Compares two recent file lists for exact equality across all fields (path, pinned, openedAt).
 * @inputs a: readonly RecentFile[] - The first list of recent file entries.
 * @inputs b: readonly RecentFile[] - The second list of recent file entries.
 * @outputs boolean - True if both lists have identical length and identical elements in the same order, false otherwise.
 * @dataflow a + b → length comparison → element-wise comparison of path, pinned, and openedAt → boolean equality.
 * @controlflow Compare lengths returning false on mismatch -> iterate indices comparing each element's path, pinned, and openedAt -> return false on first difference -> return true if all match.
 */
function sameList(a: readonly RecentFile[], b: readonly RecentFile[]): boolean {
  // Check if list lengths differ.
  if (a.length !== b.length) {
    // Lengths differ: the lists cannot be identical.
    return false;
  } else {
    // Lengths match: proceed to compare elements entry by entry.
  }

  // Iterate over each index comparing corresponding entries.
  for (let i = 0; i < a.length; i += 1) {
    const itemA = a[i];
    const itemB = b[i];

    // Guard against undefined elements to satisfy strict noUncheckedIndexedAccess.
    if (itemA === undefined || itemB === undefined) {
      // One or both elements are undefined due to index bounds.
      return false;
    } else {
      // Both elements are defined: proceed to compare fields.
    }

    // Compare path, pinned flag, and openedAt timestamp.
    // openedAt is included because re-opening a file changes nothing but its timestamp and that timestamp is the whole ordering.
    if (
      itemA.path !== itemB.path ||
      itemA.pinned !== itemB.pinned ||
      itemA.openedAt !== itemB.openedAt
    ) {
      // Found a difference in at least one field: lists are not identical.
      return false;
    } else {
      // Current entries are identical across all three fields: continue loop.
    }
  }

  // All entries matched across length, path, pinned, and openedAt.
  return true;
}

/**
 * @purpose Constructs a RecentFilesController instance managing recent files state between the settings store and UI dialogs.
 * @inputs options: RecentFilesControllerOptions - Callbacks for reading and writing settings, error handling, and optional clock.
 * @outputs RecentFilesController - The controller exposing files getter, record, togglePin, and forget operations.
 * @dataflow options → controller factory → RecentFilesController instance dispatching pure operations to settings.
 * @controlflow Initialize clock provider and internal helpers -> return RecentFilesController object with files getter and mutator methods.
 */
export function createRecentFilesController(
  options: RecentFilesControllerOptions,
): RecentFilesController {
  // The default is the real clock and the override exists for tests.
  const clock = options.now ?? ((): number => Date.now());

  /**
   * @purpose Reads the current recent files list from settings.
   * @inputs None.
   * @outputs readonly RecentFile[] - The current array of recent files from settings.
   * @dataflow options.readSettings() → general.recentFiles.
   * @controlflow Invoke options.readSettings() -> extract and return general.recentFiles.
   */
  function current(): readonly RecentFile[] {
    // The list is read back from the settings every time rather than cached,
    // so the controller cannot hold a stale copy of the one thing it is supposed to own.
    return options.readSettings().general.recentFiles;
  }

  /**
   * @purpose Persists an updated list of recent files to settings in a fire-and-forget manner.
   * @inputs next: readonly RecentFile[] - The updated array of RecentFile records to persist.
   * @outputs void
   * @dataflow next + options.readSettings() → withRecentFiles → options.writeSettings(); catches and reports errors via options.onError.
   * @controlflow Wrap writeSettings in try/catch -> read latest settings -> update withRecentFiles -> call writeSettings -> invoke onError on failure.
   */
  function persist(next: readonly RecentFile[]): void {
    try {
      options.writeSettings(withRecentFiles(options.readSettings(), next));
    } catch (error: unknown) {
      // Check whether the caught error is an instance of Error to extract the error message.
      if (error instanceof Error) {
        // Error is an Error instance: forward its message to onError.
        options.onError(error.message);
      } else {
        // Error is not an Error instance: convert error to string and forward to onError.
        options.onError(String(error));
      }
    }
  }

  return {
    /**
     * @purpose Returns the list of recent files in menu display order.
     * @inputs None.
     * @outputs readonly RecentFile[] - The list of recent files as it stands, in canonical menu order.
     * @dataflow current() → orderRecentFiles → ordered readonly RecentFile[].
     * @controlflow Read current recent files from settings -> pass to orderRecentFiles -> return ordered array.
     */
    get files(): readonly RecentFile[] {
      // Ordering on read costs nothing at this size and means a list edited by hand in settings.json still shows pinned entries first.
      return orderRecentFiles(current());
    },

    /**
     * @purpose Records that a path was just opened or saved under.
     * @inputs path: string - The file path that was accessed.
     * @outputs void
     * @dataflow path + clock() + current() → recordRecentFile → sameList check → persist.
     * @controlflow Compute updated list via recordRecentFile -> compare against current list via sameList -> return early if unchanged -> persist updated settings.
     */
    record(path: string): void {
      const existing = current();
      const next = recordRecentFile(existing, path, clock());

      // Compare next against the current list by length and every path, pinned, and openedAt flag.
      // If nothing changed, return without writing.
      // An unchanged list written back would mark the settings dirty and cost a disk write for nothing.
      if (sameList(existing, next)) {
        // List is unchanged: return without writing.
        return;
      } else {
        // List has changed: persist the updated recent files list to settings.
        persist(next);
      }
    },

    /**
     * @purpose Pins or unpins a path, returning the list as it now stands.
     * @inputs path: string - The file path to pin or unpin.
     * @outputs readonly RecentFile[] - The updated list of recent files as it now stands.
     * @dataflow path + current() → togglePinnedFile → persist → return next list.
     * @controlflow Compute updated list via togglePinnedFile -> persist updated settings -> return next list for dialog rebuild.
     */
    togglePin(path: string): readonly RecentFile[] {
      const next = togglePinnedFile(current(), path);
      persist(next);
      return next;
    },

    /**
     * @purpose Removes a path outright, returning the list as it now stands.
     * @inputs path: string - The file path to remove.
     * @outputs readonly RecentFile[] - The updated list of recent files as it now stands.
     * @dataflow path + current() → forgetRecentFile → persist → return next list.
     * @controlflow Compute updated list via forgetRecentFile -> persist updated settings -> return next list for dialog rebuild.
     */
    forget(path: string): readonly RecentFile[] {
      const next = forgetRecentFile(current(), path);
      persist(next);
      return next;
    },
  };
}
