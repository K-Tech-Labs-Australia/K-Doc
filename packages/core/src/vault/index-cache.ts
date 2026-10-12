/**
 * @file index-cache.ts
 * @purpose Pure on-disk cache serialization, validation, and scan planning for the vault index (FR-6.12).
 * @inputs Vault root path strings, cached note arrays, raw JSON text strings, and file stat descriptors.
 * @outputs Serialized JSON strings, validated VaultIndexFile objects or null, and ScanPlan reuse/read partitions.
 * @functions
 *   - serialiseIndex: Serializes vault root and cached notes into a compact JSON string.
 *   - parseIndex: Parses and validates a JSON string into a trusted VaultIndexFile or returns null.
 *   - planScan: Partitions current disk files into notes to reuse from cache versus files to read afresh.
 * @dataflow Vault root + cached notes -> serialiseIndex -> JSON string; JSON string + root -> parseIndex -> validated VaultIndexFile; file stats + cache -> planScan -> ScanPlan.
 * @controlflow serialiseIndex stringifies payload -> parseIndex parses JSON and validates schema shapes -> planScan indexes cached notes and partitions stats into reuse or read lists.
 * @version 1
 * @date 2026-09-12
 */

import type { NoteIndexEntry } from './note-index.js';

/** What the scan learns about a file before deciding whether to read it. */
export interface VaultFileStat {
  readonly path: string;
  readonly relative: string;
  /** Last modification time, in milliseconds since the Unix epoch. */
  readonly modifiedMs: number;
  readonly size: number;
}

/** One note as the saved index holds it: what it was, and how to tell whether it still is. */
export interface CachedNote {
  readonly path: string;
  readonly relative: string;
  readonly modifiedMs: number;
  readonly size: number;
  readonly entry: NoteIndexEntry;
}

/** A saved index, as it sits on disk. */
export interface VaultIndexFile {
  readonly version: number;
  /** The vault root it was built for. An index from a different folder describes different files. */
  readonly root: string;
  readonly notes: readonly CachedNote[];
}

/** What a scan should do: reuse these, read those. */
export interface ScanPlan {
  /** Notes whose file is unchanged, so their saved entry still describes them. */
  readonly reuse: readonly CachedNote[];
  /** Files that must be read and indexed: new, changed, or never cached. */
  readonly read: readonly VaultFileStat[];
}

export const INDEX_FORMAT_VERSION: number = 1;

/**
 * Tests whether an unknown value is a non-null, non-array object record.
 *
 * @purpose Narrows an unknown value to a string-keyed record if it is a non-null, non-array object.
 * @inputs value - The unknown value to inspect.
 * @outputs boolean - True if the value is a non-null, non-array object; false otherwise.
 * @dataflow value -> typeof check, null check, Array.isArray check -> boolean type predicate.
 * @controlflow Check if type is object and not null and not array -> return true -> else return false.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // Check if the value is an object, non-null, and not an array.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    // Value is a valid non-null, non-array object record.
    return true;
  } else {
    // Value is null, a primitive, or an array.
    return false;
  }
}

/**
 * Validates whether an unknown value conforms to the complete CachedNote shape.
 *
 * A note passes the shape check when it is a non-null non-array object whose
 * path, relative are strings, whose modifiedMs, size are finite numbers, and
 * whose entry is a non-null non-array object with a string path, a string
 * relative, a string title, array headings, array links, array tags, and a
 * non-null non-array object frontMatter. One bad note invalidates the whole
 * file rather than being skipped: a file that is partly corrupt gives no
 * reason to believe the rest of it.
 *
 * @purpose Type predicate verifying whether an unknown value conforms to the CachedNote interface.
 * @inputs value - The unknown value to validate.
 * @outputs boolean - True if the value strictly matches the CachedNote structure; false otherwise.
 * @dataflow value -> record check -> validate top-level fields -> validate entry fields -> boolean.
 * @controlflow Guard record shape -> check path/relative strings -> check modifiedMs/size finite numbers -> guard entry record -> check entry path/relative/title strings -> check entry headings/links/tags arrays -> check frontMatter record -> return true if all pass, else false.
 */
function isCachedNote(value: unknown): value is CachedNote {
  // Check if the value is a non-null, non-array object.
  if (!isRecord(value)) {
    // Value is not an object record: fails CachedNote shape check.
    return false;
  } else {
    // Value is an object record: continue validating properties.
  }

  // Check if path is a string.
  if (typeof value['path'] !== 'string') {
    // Path property is missing or not a string.
    return false;
  } else {
    // Path property is a valid string.
  }

  // Check if relative is a string.
  if (typeof value['relative'] !== 'string') {
    // Relative property is missing or not a string.
    return false;
  } else {
    // Relative property is a valid string.
  }

  const modifiedMs = value['modifiedMs'];
  // Check if modifiedMs is a finite number.
  if (typeof modifiedMs !== 'number' || !Number.isFinite(modifiedMs)) {
    // modifiedMs is not a finite number.
    return false;
  } else {
    // modifiedMs is a valid finite number.
  }

  const size = value['size'];
  // Check if size is a finite number.
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    // Size is not a finite number.
    return false;
  } else {
    // Size is a valid finite number.
  }

  const entry = value['entry'];
  // Check if entry is a non-null, non-array object.
  if (!isRecord(entry)) {
    // Entry is not an object record.
    return false;
  } else {
    // Entry is an object record: continue validating NoteIndexEntry properties.
  }

  // Check if entry path is a string.
  if (typeof entry['path'] !== 'string') {
    // Entry path is missing or not a string.
    return false;
  } else {
    // Entry path is a valid string.
  }

  // Check if entry relative is a string.
  if (typeof entry['relative'] !== 'string') {
    // Entry relative is missing or not a string.
    return false;
  } else {
    // Entry relative is a valid string.
  }

  // Check if entry title is a string.
  if (typeof entry['title'] !== 'string') {
    // Entry title is missing or not a string.
    return false;
  } else {
    // Entry title is a valid string.
  }

  // Check if entry headings is an array.
  if (!Array.isArray(entry['headings'])) {
    // Entry headings is not an array.
    return false;
  } else {
    // Entry headings is a valid array.
  }

  // Check if entry links is an array.
  if (!Array.isArray(entry['links'])) {
    // Entry links is not an array.
    return false;
  } else {
    // Entry links is a valid array.
  }

  // Check if entry tags is an array.
  if (!Array.isArray(entry['tags'])) {
    // Entry tags is not an array.
    return false;
  } else {
    // Entry tags is a valid array.
  }

  // Check if entry frontMatter is a non-null, non-array object.
  if (!isRecord(entry['frontMatter'])) {
    // Entry frontMatter is not an object record.
    return false;
  } else {
    // Entry frontMatter is a valid object record.
  }

  // All property checks passed: value matches CachedNote structure.
  return true;
}

/**
 * Serializes the vault root path and cached note entries into a compact JSON string.
 *
 * Indentation is omitted because index files are read only by machines, and formatting
 * indentation would consume most of the byte footprint across large vaults.
 *
 * @purpose Produces a compact JSON string representation of the vault index for on-disk persistence.
 * @inputs root - Canonical vault root path string the index was generated for.
 * @inputs notes - Readonly array of CachedNote records representing indexed notes.
 * @outputs string - Non-pretty-printed JSON string encoding the index payload.
 * @dataflow root + notes -> format version payload object -> JSON.stringify -> serialized string.
 * @controlflow Wrap root, version, and notes in payload object -> serialize via JSON.stringify -> return string.
 */
export function serialiseIndex(root: string, notes: readonly CachedNote[]): string {
  // Serialize the cache payload containing format version, vault root path, and cached note array.
  return JSON.stringify({
    version: INDEX_FORMAT_VERSION,
    root,
    notes,
  });
}

/**
 * Parses and validates an on-disk vault index cache JSON string.
 *
 * Returns null for ANY index it cannot fully vouch for, and the parsed object otherwise.
 * A cache that cannot be trusted is a cache that is not there, and the cost of being wrong
 * here is a stale entry shown as current - far worse than the cost of re-reading the vault.
 * Specifically, returns null when:
 * - JSON.parse throws (wrapped in try/catch);
 * - the result is not a non-null object, or is an array;
 * - version is not exactly INDEX_FORMAT_VERSION;
 * - root is not a string, or does not equal the root argument;
 * - notes is not an array, or ANY element fails the CachedNote shape check.
 *
 * @purpose Parses a cache JSON string and strictly validates that it matches the expected schema and vault root.
 * @inputs text - The raw JSON string read from the cache file on disk.
 * @inputs root - The expected vault root path that the index must match.
 * @outputs VaultIndexFile | null - The validated index file object, or null if validation fails.
 * @dataflow text -> JSON.parse -> validate root object -> check version & root -> validate notes array -> VaultIndexFile | null.
 * @controlflow Parse JSON with try/catch -> return null on parse error -> guard object record -> verify version === INDEX_FORMAT_VERSION -> verify root string matches argument -> guard notes array -> validate every note with isCachedNote -> return VaultIndexFile on success or null on any defect.
 */
export function parseIndex(text: string, root: string): VaultIndexFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON parse threw an exception: malformed or truncated file content.
    return null;
  }

  // Check if the parsed result is a non-null, non-array object record.
  if (!isRecord(parsed)) {
    // Root JSON structure is not an object record: reject untrusted cache.
    return null;
  } else {
    // Root JSON structure is an object record: continue validation.
  }

  // Check if version is exactly INDEX_FORMAT_VERSION.
  // An older format's fields may mean something else now, and guessing is how a cache starts lying.
  if (parsed['version'] !== INDEX_FORMAT_VERSION) {
    // Format version does not match current version: reject untrusted cache.
    return null;
  } else {
    // Format version matches INDEX_FORMAT_VERSION: continue validation.
  }

  // Check if root is a string and matches the expected vault root argument.
  // An index built for another folder describes other files.
  if (typeof parsed['root'] !== 'string' || parsed['root'] !== root) {
    // Vault root path is not a string or does not match: reject untrusted cache.
    return null;
  } else {
    // Vault root path matches expected root: continue validation.
  }

  const rawNotes = parsed['notes'];
  // Check if notes is an array.
  if (!Array.isArray(rawNotes)) {
    // Notes property is not an array: reject untrusted cache.
    return null;
  } else {
    // Notes property is an array: validate each contained note.
  }

  const notes: CachedNote[] = [];
  // Validate every note element in the array against the shape check.
  for (const item of rawNotes) {
    // Check if the current item conforms to the CachedNote schema.
    if (!isCachedNote(item)) {
      // One bad note invalidates the whole file rather than being skipped:
      // a file that is partly corrupt gives no reason to believe the rest of it.
      return null;
    } else {
      // Item is a valid CachedNote: collect into the verified notes list.
      notes.push(item);
    }
  }

  return {
    version: INDEX_FORMAT_VERSION,
    root,
    notes,
  };
}

/**
 * Plans a vault scan by deciding which files can be reused from cache and which must be read.
 *
 * Walk files in order, keeping that order in both output arrays.
 *
 * A cached note whose file no longer exists is simply never looked at, so it drops out of the plan
 * without needing to be deleted: the plan is built from what is on disk now, not from what the
 * index remembers.
 *
 * Why the check is modifiedMs and size rather than either alone: a modification time can be
 * preserved by a copy or a restore that changes the content, and a size can stay identical across
 * an edit that swaps one word for another of the same length. Together they are wrong far less
 * often, and the remaining case - an edit that keeps both - is repaired by the user's own save,
 * which moves the time.
 *
 * @purpose Determines which files can be reused from cache and which must be read from disk.
 * @inputs files - Readonly array of VaultFileStat descriptors representing files currently on disk.
 * @inputs cached - Validated VaultIndexFile from disk, or null if no cache is available.
 * @outputs ScanPlan - Object with reuse array (cached notes) and read array (files to read).
 * @dataflow files + cached -> build lookup map from cached.notes -> test each file -> partition into reuse and read arrays.
 * @controlflow Build lookup Map from cached notes if present -> iterate files in original order -> check if cached note matches path, modifiedMs, and size -> if matched append to reuse -> else append to read -> return ScanPlan.
 */
export function planScan(
  files: readonly VaultFileStat[],
  cached: VaultIndexFile | null,
): ScanPlan {
  const lookup = new Map<string, CachedNote>();

  // Build a lookup from cached.notes keyed by path, or leave map empty when cached is null.
  if (cached !== null) {
    // Populate lookup map with all notes from the cached index.
    for (const note of cached.notes) {
      lookup.set(note.path, note);
    }
  } else {
    // Cache is absent or untrusted: lookup remains empty.
  }

  const reuse: CachedNote[] = [];
  const read: VaultFileStat[] = [];

  // Walk files in order, keeping that order in both output arrays.
  // A cached note whose file no longer exists is simply never looked at, so it drops out
  // of the plan without needing to be deleted: the plan is built from what is on disk now,
  // not from what the index remembers.
  for (const file of files) {
    const cachedNote = lookup.get(file.path);

    // It goes in reuse when a cached note exists AND its modifiedMs equals the file's AND its size equals the file's.
    // Why the check is modifiedMs and size rather than either alone: a modification time can be preserved by a
    // copy or a restore that changes the content, and a size can stay identical across an edit that swaps one word
    // for another of the same length. Together they are wrong far less often, and the remaining case - an edit
    // that keeps both - is repaired by the user's own save, which moves the time.
    if (
      cachedNote !== undefined &&
      cachedNote.modifiedMs === file.modifiedMs &&
      cachedNote.size === file.size
    ) {
      // Unchanged file: reuse cached note entry without reading or parsing from disk.
      reuse.push(cachedNote);
    } else {
      // New, modified, or uncached file: must be read and indexed from disk.
      read.push(file);
    }
  }

  return {
    reuse,
    read,
  };
}
