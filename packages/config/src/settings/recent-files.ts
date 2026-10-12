/**
 * @file recent-files.ts
 * @purpose Recent-files list and its pure operations with separate pinned and unpinned caps (FR-6.1).
 *
 * A recent-files list is the one piece of state that is useless unless it survives a restart, which is why it
 * lives with the settings rather than in the session.
 *
 * Pinning is what makes the list a list rather than a log. An unpinned entry is a record of what you last
 * touched and is evicted by newer work; a pinned one is a statement that this file matters, and eviction would
 * be the program overruling that. The two are therefore capped separately: the unpinned tail has a limit, and
 * the pinned head has none.
 *
 * Every function here returns a new array. The list is written into frozen settings, and an operation that
 * mutated its input would change a value another part of the program still believes it holds.
 *
 * @inputs Readonly arrays of RecentFile records, file paths, and epoch millisecond timestamps.
 * @outputs Ordered, filtered, or updated frozen arrays of RecentFile records.
 * @functions
 *   - orderRecentFiles: Returns the list in the order a menu should show it: pinned entries first, then unpinned, each group most-recent first.
 *   - recordRecentFile: Records that path was just opened, and evicts the oldest unpinned entries past the limit.
 *   - togglePinnedFile: Pins an unpinned entry or unpins a pinned one.
 *   - forgetRecentFile: Removes an entry outright, pinned or not.
 * @dataflow RecentFile arrays + path / timestamp -> immutable transformations (partition, sort, filter, map) -> new frozen RecentFile array in menu display order.
 * @controlflow Functions validate inputs -> construct updated entries -> apply pinning and eviction policies -> return ordered and frozen array via orderRecentFiles.
 * @version 1
 * @date 2026-09-11
 */

export interface RecentFile {
  readonly path: string;
  readonly pinned: boolean;
  /** Epoch milliseconds when this file was last opened. */
  readonly openedAt: number;
}

/**
 * Maximum number of unpinned entries retained in the recent files list (FR-6.1).
 * Pinned entries are exempt from this limit.
 */
export const RECENT_FILES_LIMIT: number = 10;

/**
 * Returns the list in the order a menu should show it: pinned entries first, then unpinned, each group most-recent first.
 *
 * @purpose Returns the list in the order a menu should show it: pinned entries first, then unpinned, each group most-recent first.
 * @inputs list: readonly RecentFile[] - The list of recent file entries to order.
 * @outputs readonly RecentFile[] - A new frozen array ordered with pinned entries first, followed by unpinned entries, each sorted descending by openedAt.
 * @dataflow list -> shallow copy -> comparator sort (pinned status then openedAt descending) -> Object.freeze -> frozen ordered array.
 * @controlflow Clone list -> sort with comparator checking pinned precedence then timestamp delta -> freeze result with Object.freeze -> return.
 */
export function orderRecentFiles(list: readonly RecentFile[]): readonly RecentFile[] {
  // Sort a copy with a comparator ordering pinned entries before unpinned entries, then newest first.
  const sorted = [...list].sort((a, b) => {
    // Check whether one entry is pinned and the other is not.
    // A pinned entry outranks a newer unpinned one because that is what pinning means.
    if (a.pinned !== b.pinned) {
      // Pinned entries rank before unpinned entries.
      return a.pinned ? -1 : 1;
    } else {
      // Both entries have the same pinned status: sort by openedAt descending (most recent first).
      return b.openedAt - a.openedAt;
    }
  });

  return Object.freeze(sorted);
}

/**
 * Records that path was just opened, and evicts the oldest unpinned entries past the limit.
 *
 * @purpose Records that path was just opened, and evicts the oldest unpinned entries past the limit.
 * @inputs list: readonly RecentFile[] - The existing list of recent file entries.
 * @inputs path: string - The file path that was opened.
 * @inputs openedAt: number - Epoch milliseconds timestamp when the file was opened.
 * @outputs readonly RecentFile[] - A new frozen array containing the updated recent file entry with eviction applied, in canonical menu order.
 * @dataflow list + path + openedAt -> empty check guard -> find/update entry -> partition into pinned and unpinned arrays -> sort and slice unpinned by limit -> orderRecentFiles -> new frozen array.
 * @controlflow Guard on empty path -> find existing entry -> create/update entry -> partition list into pinned and unpinned arrays -> sort unpinned descending by openedAt -> slice unpinned to RECENT_FILES_LIMIT -> concatenate -> return orderRecentFiles result.
 */
export function recordRecentFile(
  list: readonly RecentFile[],
  path: string,
  openedAt: number,
): readonly RecentFile[] {
  // Check if the path is empty or consists solely of whitespace.
  // An empty path is not a file and recording one would put a dead entry in the menu.
  if (path.trim().length === 0) {
    // Empty path: return the input list unchanged.
    return list;
  } else {
    // Valid non-empty path: proceed to record the file access.
  }

  // Find any existing entry for path.
  const existing = list.find((entry) => entry.path === path);
  let updatedEntry: RecentFile;

  // Check whether an entry for this path already exists in the list.
  if (existing !== undefined) {
    // Entry exists: keep its pinned status and take the new openedAt timestamp.
    updatedEntry = Object.freeze({
      path: existing.path,
      pinned: existing.pinned,
      openedAt,
    });
  } else {
    // Entry does not exist: add a new entry with pinned set to false.
    updatedEntry = Object.freeze({
      path,
      pinned: false,
      openedAt,
    });
  }

  // Build the next list as every other entry plus this one.
  const otherEntries = list.filter((entry) => entry.path !== path);
  const nextList: readonly RecentFile[] = [...otherEntries, updatedEntry];

  // Evict: keep all pinned entries, and only the newest RECENT_FILES_LIMIT unpinned ones.
  const pinnedEntries: RecentFile[] = [];
  const unpinnedEntries: RecentFile[] = [];

  for (const entry of nextList) {
    // Check whether the entry is pinned or unpinned.
    // Pinned entries are exempt from the limit because a pin is the user saying keep this,
    // and a limit that overrode it would make pinning a suggestion.
    if (entry.pinned) {
      // Pinned entry: retain unconditionally without eviction.
      pinnedEntries.push(entry);
    } else {
      // Unpinned entry: partition into candidate list for limit eviction.
      unpinnedEntries.push(entry);
    }
  }

  // Sort the unpinned entries by openedAt descending to identify the newest entries.
  unpinnedEntries.sort((a, b) => b.openedAt - a.openedAt);

  // Keep only the newest RECENT_FILES_LIMIT unpinned entries.
  const retainedUnpinned = unpinnedEntries.slice(0, RECENT_FILES_LIMIT);

  // Concatenate all pinned entries with the retained newest unpinned entries.
  const combinedList: readonly RecentFile[] = [...pinnedEntries, ...retainedUnpinned];

  // Return orderRecentFiles of the result so the caller never has to remember to order it.
  return orderRecentFiles(combinedList);
}

/**
 * Pins an unpinned entry or unpins a pinned one.
 *
 * @purpose Pins an unpinned entry or unpins a pinned one.
 * @inputs list: readonly RecentFile[] - The existing list of recent file entries.
 * @inputs path: string - The file path whose pinned status to toggle.
 * @outputs readonly RecentFile[] - A new frozen array with the matching entry's pinned status inverted, in canonical menu order, or the unchanged list if path is absent.
 * @dataflow list + path -> existence check -> map entries flipping pinned boolean on match -> orderRecentFiles -> new frozen array.
 * @controlflow Check path presence -> return unchanged list if absent -> map entries flipping pinned boolean on target path -> return orderRecentFiles result.
 */
export function togglePinnedFile(
  list: readonly RecentFile[],
  path: string,
): readonly RecentFile[] {
  const exists = list.some((entry) => entry.path === path);

  // Check whether the path is present in the recent files list.
  // There is nothing to pin if not present, and inventing an entry would be recording a file the user never opened.
  if (!exists) {
    // Path is not present: return the list unchanged.
    return list;
  } else {
    // Path is present: proceed to map the list and toggle the pinned status.
  }

  // Map the list, flipping pinned on the matching entry.
  // Unpinning can push an entry past the limit on the next record rather than immediately,
  // because removing a file from the menu at the moment the user unpins it would look like the unpin deleted it.
  const updatedList = list.map((entry) => {
    // Check if this entry matches the target file path.
    if (entry.path === path) {
      // Matching entry: return a new entry with inverted pinned state.
      return Object.freeze({
        path: entry.path,
        pinned: !entry.pinned,
        openedAt: entry.openedAt,
      });
    } else {
      // Non-matching entry: retain existing entry unchanged.
      return entry;
    }
  });

  return orderRecentFiles(updatedList);
}

/**
 * Removes an entry outright, pinned or not.
 *
 * @purpose Removes an entry outright, pinned or not.
 * @inputs list: readonly RecentFile[] - The existing list of recent file entries.
 * @inputs path: string - The file path to remove from the list.
 * @outputs readonly RecentFile[] - A new frozen array omitting the specified path, in canonical menu order.
 * @dataflow list + path -> filter out matching path -> orderRecentFiles -> new frozen array.
 * @controlflow Filter list excluding matching path -> return orderRecentFiles result.
 */
export function forgetRecentFile(
  list: readonly RecentFile[],
  path: string,
): readonly RecentFile[] {
  // Filter out the entry matching the given path, pinned or not.
  // This is the only way an entry leaves the list against the clock, and it exists because
  // a moved or deleted file in the menu is a link to nothing.
  const filtered = list.filter((entry) => {
    // Check whether this entry matches the target file path to remove.
    if (entry.path === path) {
      // Matching path: exclude entry from the resulting list.
      return false;
    } else {
      // Non-matching path: retain entry in the resulting list.
      return true;
    }
  });

  return orderRecentFiles(filtered);
}
