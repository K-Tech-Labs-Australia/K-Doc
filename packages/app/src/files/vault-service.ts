/**
 * @file vault-service.ts
 * @purpose App-side service that opens a folder as a vault, reads every note in it, and maintains the index for search, tags, and backlinks (FR-6.12, FR-8.12, FR-14.6, FR-14.7).
 *
 *   HEADER NOTE: JavaScript never touches the disk directly. Every filesystem operation is mediated by Tauri
 *   IPC commands (vault_list_notes, read_text_file) with runtime payload validation. In standard browser dev
 *   environments outside Tauri, available reports false and open completes immediately without throwing.
 *   Scans maintain a cancellation token so fast folder switching never allows obsolete results to supersede
 *   fresh state, and methods never throw out of the service.
 *
 * @inputs Filesystem folder paths, file paths, raw Markdown text, and query parameters via VaultService API; Tauri IPC events and command responses.
 * @outputs VaultStatus notifications via onChange callback; indexed NoteIndexEntry collections; search matches, tag aggregations, and backlinks.
 * @functions
 *   - createVaultService: Factory constructing the VaultService coordinator for folder indexing and vault queries.
 * @dataflow Vault folder path -> Tauri vault_list_notes IPC -> Note file paths -> Tauri read_text_file IPC -> indexNote -> NoteIndexEntry index -> searchNotes / tagCounts / notesTagged / backlinksTo.
 * @controlflow Probe Tauri runtime via isTauri(win) -> initialize VaultService state -> open(folder) validates IPC payload and reads notes with cancellation check and periodic progress updates -> query methods delegate to core pure functions.
 * @version 3
 * @date 2026-09-15
 */

import { invoke } from '@tauri-apps/api/core';
import { fromDisk } from './line-endings.js';
import { indexNote, searchNotes, tagCounts, notesTagged, backlinksTo, parseIndex, serialiseIndex, planScan } from '@k-doc/core';
import type { NoteIndexEntry, NoteMatch, TagCount, Backlink, CachedNote, VaultFileStat, VaultIndexFile, ScanPlan } from '@k-doc/core';

/** What a vault scan found and how it went. */
export interface VaultStatus {
  /** The folder that was opened, or null when no vault is open. */
  readonly root: string | null;
  /** How many notes are indexed. */
  readonly noteCount: number;
  /** Notes the scan found but could not read. Reported rather than hidden. */
  readonly unreadable: readonly string[];
  /** True while a scan is running. */
  readonly scanning: boolean;
  /**
   * How many of this scan's notes came from the saved index rather than from disk.
   *
   * Exposed because it is the only outward sign that the incremental path worked at all: a scan that
   * silently re-read everything and one that skipped nine notes in ten look identical from outside.
   */
  readonly reused: number;
}

export interface VaultServiceOptions {
  readonly win: Window;
  /** Called whenever the index or the scan state changes, so a panel can redraw. */
  readonly onChange: (status: VaultStatus) => void;
}

export interface VaultService {
  readonly available: boolean;
  readonly status: VaultStatus;
  /** Every indexed note, ordered by relative path. */
  readonly notes: readonly NoteIndexEntry[];
  /** Opens a folder as the vault and indexes it. Resolves when the scan finishes. */
  open(folder: string): Promise<void>;
  /** Forgets the vault. */
  close(): void;
  /** Re-reads the folder from scratch. */
  refresh(): Promise<void>;
  /** Re-indexes one note from text the caller already has, without touching the disk. */
  update(path: string, text: string): void;
  find(query: string, limit?: number): readonly NoteMatch[];
  tags(): readonly TagCount[];
  tagged(tag: string): readonly NoteIndexEntry[];
  backlinks(path: string): readonly Backlink[];
  destroy(): void;
}

/**
 * How many notes to process before notifying listeners during a vault scan.
 * A panel that only updated at the end would look frozen on a large vault,
 * and one that updated on every note would spend its time redrawing.
 */
const SCAN_NOTIFY_EVERY: number = 25;

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Shape of a single note row crossing the IPC boundary from `vault_list_notes`.
 */
interface VaultNoteRow {
  readonly path: string;
  readonly relative: string;
  readonly size: number;
  readonly modifiedMs: number;
}

/**
 * Shape of the payload returned across IPC by the `read_text_file` command.
 */
interface ReadTextFilePayload {
  readonly contents: string;
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
 * Type guard validating that an unknown value conforms to the VaultNoteRow interface.
 *
 * @purpose Narrows an untrusted candidate object from `vault_list_notes` IPC to VaultNoteRow safely without any.
 * @inputs value - Unknown candidate value to validate.
 * @outputs boolean - True if value matches VaultNoteRow structure, false otherwise.
 * @dataflow value -> property inspection and type validation -> boolean assertion result.
 * @controlflow Verify value is non-null object -> check path and relative are strings -> check size and modifiedMs are numbers -> return boolean.
 */
function isVaultNoteRow(value: unknown): value is VaultNoteRow {
  // Check if candidate value is an object and non-null.
  if (typeof value !== 'object' || value === null) {
    // Branch: Candidate is null or not an object; invalid row.
    return false;
  } else {
    // Branch: Candidate is a non-null object; proceed to validate fields.
  }

  const candidate = value as Record<string, unknown>;

  // Check if 'path' field is a string.
  const path = candidate['path'];
  if (typeof path !== 'string') {
    // Branch: Field 'path' is missing or not a string.
    return false;
  } else {
    // Branch: Field 'path' is a valid string.
  }

  // Check if 'relative' field is a string.
  const relative = candidate['relative'];
  if (typeof relative !== 'string') {
    // Branch: Field 'relative' is missing or not a string.
    return false;
  } else {
    // Branch: Field 'relative' is a valid string.
  }

  // Check if 'size' field is a number.
  const size = candidate['size'];
  if (typeof size !== 'number') {
    // Branch: Field 'size' is missing or not a number.
    return false;
  } else {
    // Branch: Field 'size' is a valid number.
  }

  // Check if 'modifiedMs' field is a number.
  const modifiedMs = candidate['modifiedMs'];
  if (typeof modifiedMs !== 'number') {
    // Branch: Field 'modifiedMs' is missing or not a number.
    return false;
  } else {
    // Branch: Field 'modifiedMs' is a valid number.
  }

  return true;
}

/**
 * Type guard validating that an unknown value is an array of VaultNoteRow records.
 *
 * @purpose Validates the full list payload returned by the `vault_list_notes` IPC command.
 * @inputs value - Unknown candidate value from IPC.
 * @outputs boolean - True if value is an array of valid VaultNoteRow items, false otherwise.
 * @dataflow value -> Array.isArray check -> validate each element via isVaultNoteRow -> boolean result.
 * @controlflow Verify value is an array -> iterate elements -> validate with isVaultNoteRow -> return false if any element fails -> return true if all pass.
 */
function isVaultNoteList(value: unknown): value is readonly VaultNoteRow[] {
  // Check if candidate value is an array.
  if (!Array.isArray(value)) {
    // Branch: Value is not an array; reject list.
    return false;
  } else {
    // Branch: Value is an array; proceed to inspect individual items.
  }

  // Iterate over each item in the array to validate its structure.
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    // Check if the current item conforms to VaultNoteRow.
    if (!isVaultNoteRow(item)) {
      // Branch: Item fails VaultNoteRow validation; reject entire list.
      return false;
    } else {
      // Branch: Item is a valid VaultNoteRow; continue checking remaining items.
    }
  }

  return true;
}

/**
 * Type guard validating that an unknown value conforms to ReadTextFilePayload.
 *
 * @purpose Narrows an untrusted candidate object from `read_text_file` IPC to ReadTextFilePayload safely without any.
 * @inputs value - Unknown candidate value from IPC.
 * @outputs boolean - True if value matches ReadTextFilePayload structure, false otherwise.
 * @dataflow value -> property inspection and type validation -> boolean assertion result.
 * @controlflow Verify value is non-null object -> check contents is string -> return boolean.
 */
function isReadTextFilePayload(value: unknown): value is ReadTextFilePayload {
  // Check if value is a non-null object.
  if (typeof value !== 'object' || value === null) {
    // Branch: Value is null or not an object; invalid payload.
    return false;
  } else {
    // Branch: Value is a non-null object; proceed to validate fields.
  }

  const candidate = value as Record<string, unknown>;

  // Check if 'contents' field is a string.
  const contents = candidate['contents'];
  if (typeof contents !== 'string') {
    // Branch: Field 'contents' is missing or not a string.
    return false;
  } else {
    // Branch: Field 'contents' is a valid string.
  }

  return true;
}

/**
 * Factory constructing a VaultService instance bound to a window and change listener.
 *
 * @purpose Creates and initializes the app-side vault service for managing vault folders and note indexing.
 * @inputs options - VaultServiceOptions containing the host window and change listener callback.
 * @outputs VaultService - The active or fallback VaultService instance.
 * @dataflow options.win -> capability detection -> state machine -> VaultService public API.
 * @controlflow Detect Tauri runtime -> initialize service state -> return VaultService interface implementation.
 */
export function createVaultService(options: VaultServiceOptions): VaultService {
  const available = isTauri(options.win);
  let currentRoot: string | null = null;
  let scanning: boolean = false;
  let notes: readonly NoteIndexEntry[] = [];
  let unreadable: readonly string[] = [];
  let reused: number = 0;
  let scanToken: number = 0;
  let destroyed: boolean = false;

  /**
   * Helper constructing the current immutable VaultStatus snapshot.
   *
   * @purpose Assembles current root, note count, unreadable list, and scanning status into VaultStatus.
   * @inputs None.
   * @outputs VaultStatus - Snapshot representing current vault state.
   * @dataflow Current state variables -> VaultStatus object.
   * @controlflow Read state variables -> construct and return VaultStatus.
   */
  function getStatus(): VaultStatus {
    return {
      root: currentRoot,
      noteCount: notes.length,
      unreadable,
      scanning,
      reused,
    };
  }

  /**
   * Dispatches the current vault status to the configured onChange listener.
   *
   * @purpose Safely broadcasts vault state updates without throwing exceptions.
   * @inputs None.
   * @outputs void.
   * @dataflow Current status -> getStatus() -> options.onChange callback.
   * @controlflow Check destroyed flag -> call onChange inside try/catch -> swallow callback exceptions.
   */
  function notify(): void {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; suppress notifications.
      return;
    } else {
      // Branch: Service is active; dispatch status update.
    }

    // Wrap listener call in try/catch to ensure service methods never throw if a subscriber errors.
    try {
      options.onChange(getStatus());
    } catch {
      // Branch: Subscriber callback threw an error; swallow safely.
    }
  }

  /**
   * Scans a directory for Markdown notes, reads their contents, and builds the vault index.
   *
   * @purpose Scans a directory for Markdown notes, reads their contents, and builds the vault index.
   * @inputs folder - Filesystem path to the vault folder.
   * @inputs useCache - Whether to trust the saved index.
   * @outputs Promise<void> - Resolves when directory scan and note indexing complete.
   * @dataflow folder -> vault_index_read IPC -> vault_list_notes IPC -> planScan -> read_text_file IPC -> indexNote -> sorted notes -> vault_index_write IPC.
   * @controlflow Increment scanToken -> reset state -> check available -> invoke vault_list_notes -> validate list -> read index if useCache -> plan scan -> iterate rows reading and indexing notes -> check superseded at each await -> notify periodically -> sort notes by relative -> write index if available -> finalize and notify.
   */
  async function runScan(folder: string, useCache: boolean): Promise<void> {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service has been destroyed; all methods are no-ops after destroy.
      return;
    } else {
      // Branch: Service is active; proceed with opening vault folder.
    }

    // Keep a scanToken counter, increment it at the start of every open/refresh, capture it in a local.
    // A user who opens one folder and immediately opens another must not get the first folder's notes arriving after the second's.
    scanToken++;
    const currentToken = scanToken;

    // 1. Set scanning to true, root to folder, clear the notes and the unreadable list, and call onChange.
    // A scan of a large folder takes time, and a panel that showed nothing until it finished would look broken.
    currentRoot = folder;
    scanning = true;
    notes = [];
    unreadable = [];
    reused = 0;
    notify();

    // 2. When not available, set scanning back to false, call onChange and return.
    // The browser dev build has no filesystem, and this is absence rather than failure.
    if (!available) {
      // Branch: Host filesystem unavailable; reset scanning flag, notify listener, and return early.
      scanning = false;
      notify();
      return;
    } else {
      // Branch: Host filesystem available; proceed to list folder contents via Tauri IPC.
    }

    // 3. const listed = await invoke<unknown>('vault_list_notes', { folder });
    let listed: unknown;
    // Attempt to invoke the vault_list_notes Rust command across the IPC boundary.
    try {
      listed = await invoke<unknown>('vault_list_notes', { folder });
    } catch {
      // Check whether this scan was superseded or service was destroyed during invoke.
      if (currentToken !== scanToken || destroyed) {
        // Branch: Scan was superseded by a newer open/refresh or service destroyed; return without touching state.
        return;
      } else {
        // Branch: Scan remains current; process invoke rejection.
      }

      // On a rejection or a bad shape, stop the scan, leave the notes empty, call onChange and return; never throw.
      scanning = false;
      notes = [];
      notify();
      return;
    }

    // Check whether this scan was superseded or service was destroyed while awaiting invoke.
    if (currentToken !== scanToken || destroyed) {
      // Branch: Scan was superseded by a newer open/refresh or service destroyed; return without touching state.
      return;
    } else {
      // Branch: Scan remains current; proceed to validate listed shape.
    }

    // Validate the shape at runtime with an isVaultNoteList helper written the way window-handoff.ts writes its validator.
    if (!isVaultNoteList(listed)) {
      // Branch: Listed payload did not match expected shape; stop scan, leave notes empty, call onChange and return.
      scanning = false;
      notes = [];
      notify();
      return;
    } else {
      // Branch: Listed payload is valid; proceed to read each note file.
    }

    const rows = listed;

    // The saved index, when this scan is allowed to trust one. A refresh passes useCache false, which
    // is what makes FR-6.12's "rebuildable on demand" a real thing rather than a hope.
    let cached: VaultIndexFile | null = null;

    // Check whether this scan may reuse a saved index.
    if (useCache) {
      // Allowed: read it. Every failure below lands on `cached` staying null, which simply means a
      // full scan -- a cache is an optimisation, and an optimisation that fails is not an error.
      try {
        const savedText = await invoke<unknown>('vault_index_read', { folder });

        // Check whether this scan was superseded or the service destroyed while reading the index.
        if (currentToken !== scanToken || destroyed) {
          // Superseded: return without touching state, exactly as every other await here does.
          return;
        } else {
          // Still current: parse what came back.
        }

        // Check whether the host returned an index at all. A vault that has never been indexed
        // returns null, which is the ordinary first case rather than a failure.
        if (typeof savedText === 'string') {
          // Present: parseIndex vouches for it or returns null, and null means a full scan.
          cached = parseIndex(savedText, folder);
        } else {
          // Absent: nothing to reuse.
        }
      } catch {
        // Check whether this scan was superseded or the service destroyed during the rejection.
        if (currentToken !== scanToken || destroyed) {
          // Superseded: return without touching state.
          return;
        } else {
          // Still current: a cache that cannot be read is simply a cache that is not there.
        }
      }
    } else {
      // A rebuild was asked for: ignore whatever is saved and read every note again.
    }

    // What the scan can skip, and what it must read. A cached note whose file is gone is never
    // looked at, so it drops out here without needing to be deleted.
    const plan: ScanPlan = planScan(
      rows.map((row: VaultNoteRow): VaultFileStat => ({
        path: row.path,
        relative: row.relative,
        modifiedMs: row.modifiedMs,
        size: row.size,
      })),
      cached,
    );

    const accumulatedNotes: NoteIndexEntry[] = plan.reuse.map((note: CachedNote): NoteIndexEntry => note.entry);
    const cachedNotes: CachedNote[] = [...plan.reuse];
    reused = plan.reuse.length;

    // The reused notes are already the answer for most of the vault, and showing them at once is the entire visible benefit of having saved the index.
    notes = [...accumulatedNotes];
    notify();

    const unreadableList: string[] = [];

    // 4. For each row, read it with read_text_file and index it with indexNote(row.path, row.relative, contents).
    // A row that cannot be read is pushed onto unreadable and skipped, not fatal.
    for (let i = 0; i < plan.read.length; i++) {
      const row: VaultFileStat | undefined = plan.read[i];
      // Check if row is defined under strict index access.
      if (row === undefined) {
        // Branch: Row is undefined; skip iteration.
        continue;
      } else {
        // Branch: Row is defined; proceed with file read.
      }

      // Read note text contents from disk via read_text_file IPC command.
      try {
        const fileResult = await invoke<unknown>('read_text_file', { path: row.path });

        // Check whether scan was superseded or service destroyed while reading file.
        if (currentToken !== scanToken || destroyed) {
          // Branch: Scan superseded or service destroyed; return without touching state.
          return;
        } else {
          // Branch: Scan remains current; process read result.
        }

        // Validate that fileResult conforms to ReadTextFilePayload shape.
        if (isReadTextFilePayload(fileResult)) {
          // Branch: File read succeeded; index note and append to accumulated results.
          // Indexed as the editor holds the note (LF), so an index entry matches the text a tab or a save reports.
          const entry = indexNote(row.path, row.relative, fromDisk(fileResult.contents).text);
          accumulatedNotes.push(entry);
          cachedNotes.push({
            path: row.path,
            relative: row.relative,
            modifiedMs: row.modifiedMs,
            size: row.size,
            entry,
          });
          notes = accumulatedNotes;
        } else {
          // Branch: Malformed file payload received; push onto unreadable and skip.
          unreadableList.push(row.path);
          unreadable = [...unreadableList];
        }
      } catch {
        // Check whether scan was superseded or service destroyed during read rejection.
        if (currentToken !== scanToken || destroyed) {
          // Branch: Scan superseded or service destroyed; return without touching state.
          return;
        } else {
          // Branch: Scan remains current; record unreadable note.
        }

        // Branch: read_text_file rejected; push onto unreadable and skip, not fatal.
        unreadableList.push(row.path);
        unreadable = [...unreadableList];
      }

      // 7. Call onChange periodically during the read loop, every SCAN_NOTIFY_EVERY = 25 notes.
      // A panel that only updated at the end would look frozen on a large vault, and one that updated on every note would spend its time redrawing.
      if ((i + 1) % SCAN_NOTIFY_EVERY === 0) {
        // Branch: Milestone reached; notify listener with current progress.
        notify();
      } else {
        // Branch: Milestone not reached; skip notification.
      }
    }

    // No supersession check here. Every await above -- the listing, and each file read, on both the
    // resolved and the rejected path -- is immediately followed by its own check, and there is no
    // await between the last of those and this point. A check here could never fire, and a guard
    // that cannot fire is a claim about the code that is not true.

    // 6. Sort the finished notes by relative ascending. Set scanning false and call onChange.
    accumulatedNotes.sort((a: NoteIndexEntry, b: NoteIndexEntry): number => {
      // Compare relative paths in ascending lexicographical order.
      return a.relative.localeCompare(b.relative);
    });
    notes = accumulatedNotes;
    unreadable = [...unreadableList];

    // A vault on read-only media, or one the user has no write permission for, still indexes perfectly well in memory; refusing to show them their notes because the cache could not be saved would trade a working feature for a broken one.
    if (available) {
      try {
        await invoke<unknown>('vault_index_write', {
          folder,
          contents: serialiseIndex(folder, cachedNotes),
        });

        // Check whether scan was superseded or service destroyed after write.
        if (currentToken !== scanToken || destroyed) {
          // Branch: Scan superseded or service destroyed; return without touching state.
          return;
        } else {
          // Branch: Scan remains current; proceed.
        }
      } catch {
        // Check whether scan was superseded or service destroyed during write rejection.
        if (currentToken !== scanToken || destroyed) {
          // Branch: Scan superseded or service destroyed; return without touching state.
          return;
        } else {
          // Branch: Scan remains current; proceed.
        }
      }
    }

    scanning = false;
    notify();
  }

  /**
   * Opens a folder as the vault and indexes all Markdown notes within it.
   *
   * @purpose Scans a directory for Markdown notes, reads their contents, and builds the vault index.
   * @inputs folder - Filesystem path to the vault folder.
   * @outputs Promise<void> - Resolves when directory scan and note indexing complete.
   * @dataflow folder -> runScan(folder, true) -> populated index.
   * @controlflow Delegate to runScan with useCache=true.
   */
  async function open(folder: string): Promise<void> {
    await runScan(folder, true);
  }

  /**
   * Forgets the current vault and clears all indexed notes.
   *
   * @purpose Resets vault state and clears in-flight scans.
   * @inputs None.
   * @outputs void.
   * @dataflow Reset state -> notify listener.
   * @controlflow Check destroyed -> increment scanToken -> clear root, notes, unreadable, scanning -> notify listener.
   */
  function close(): void {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return;
    } else {
      // Branch: Service is active; proceed with close.
    }

    // Invalidate any active in-flight scan so it does not touch state.
    scanToken++;

    // Clears everything, sets root to null, and calls onChange.
    currentRoot = null;
    scanning = false;
    notes = [];
    unreadable = [];
    reused = 0;
    notify();
  }

  /**
   * Re-reads the current vault folder from scratch, rebuilding from disk and ignoring the saved index.
   *
   * @purpose Refreshes the vault index by re-scanning the active vault root from disk.
   * @inputs None.
   * @outputs Promise<void> - Resolves when re-scan completes.
   * @dataflow Current root -> runScan(currentRoot, false) -> refreshed index.
   * @controlflow Check destroyed -> check currentRoot null -> if null resolve early -> else await runScan(currentRoot, false).
   */
  async function refresh(): Promise<void> {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return;
    } else {
      // Branch: Service is active; proceed with refresh.
    }

    // Re-runs open on the current root; when there is none it resolves without doing anything.
    if (currentRoot === null) {
      // Branch: No vault root open; resolve without doing anything.
      return;
    } else {
      // Branch: Vault root exists; re-run open on current root.
      await runScan(currentRoot, false);
    }
  }

  /**
   * Re-indexes one note from provided text without reading from disk.
   *
   * @purpose Updates an in-memory note index entry from caller-supplied text.
   * @inputs path - Absolute or canonical path of the note to re-index.
   * @inputs text - Fresh Markdown content for the note.
   * @outputs void.
   * @dataflow (path, text) -> find existing entry -> indexNote -> replace in notes array -> notify listener.
   * @controlflow Check destroyed -> search notes for matching path -> return early if not found -> re-index with indexNote -> update array -> notify listener.
   */
  function update(path: string, text: string): void {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return;
    } else {
      // Branch: Service is active; proceed with update.
    }

    // Find the note itself rather than its index. Looking up an index and then guarding both the
    // index and the lookup was two guards where the second alone decided everything, so the first
    // could be removed without changing any outcome. One guard that matters is better than two that
    // agree.
    const existing = notes.find((entry: NoteIndexEntry): boolean => entry.path === path);

    // Check whether this path is a note the vault holds.
    if (existing === undefined) {
      // Not held: a document outside the vault is not an error, just not indexed.
      return;
    } else {
      // Held: re-index it from the text the caller already has.
    }

    // The relative path is kept: it is a fact about where the file sits, which editing its text
    // cannot change, and re-deriving it here would mean knowing the vault root all over again.
    const updatedEntry = indexNote(path, existing.relative, text);
    notes = notes.map((entry: NoteIndexEntry): NoteIndexEntry =>
      entry.path === path ? updatedEntry : entry,
    );
    notify();
  }

  /**
   * Searches the vault index for notes matching a query string.
   *
   * @purpose Delegates full-text and metadata search to core searchNotes query engine.
   * @inputs query - Plain text search query.
   * @inputs limit - Optional maximum number of matching results to return.
   * @outputs readonly NoteMatch[] - Scored and ranked matching note results.
   * @dataflow (notes, query, limit) -> searchNotes -> ranked matches.
   * @controlflow Check destroyed -> return empty array if destroyed -> else return searchNotes(notes, query, limit).
   */
  function find(query: string, limit?: number): readonly NoteMatch[] {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return [];
    } else {
      // Branch: Service is active; delegate search query to searchNotes.
      return searchNotes(notes, query, limit);
    }
  }

  /**
   * Aggregates tag frequencies across all indexed notes in the vault.
   *
   * @purpose Counts how many notes carry each tag across the current vault.
   * @inputs None.
   * @outputs readonly TagCount[] - Tag frequency counts sorted by frequency descending.
   * @dataflow notes -> tagCounts -> TagCount array.
   * @controlflow Check destroyed -> return empty array if destroyed -> else return tagCounts(notes).
   */
  function tags(): readonly TagCount[] {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return [];
    } else {
      // Branch: Service is active; delegate tag frequency aggregation to tagCounts.
      return tagCounts(notes);
    }
  }

  /**
   * Retrieves notes matching a tag or its hierarchical sub-tags.
   *
   * @purpose Filters indexed notes by tag query string.
   * @inputs tag - Tag string to match (with or without leading '#').
   * @outputs readonly NoteIndexEntry[] - Matching notes sorted by relative path.
   * @dataflow (notes, tag) -> notesTagged -> filtered notes array.
   * @controlflow Check destroyed -> return empty array if destroyed -> else return notesTagged(notes, tag).
   */
  function tagged(tag: string): readonly NoteIndexEntry[] {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return [];
    } else {
      // Branch: Service is active; delegate tag filtering to notesTagged.
      return notesTagged(notes, tag);
    }
  }

  /**
   * Discovers all incoming backlinks pointing to a target note.
   *
   * @purpose Locates references to a note from other notes in the vault.
   * @inputs path - Path of the destination note.
   * @outputs readonly Backlink[] - Backlink references pointing to the note.
   * @dataflow (notes, path) -> find target note -> backlinksTo -> Backlink array.
   * @controlflow Check destroyed -> locate note by path -> return empty array if not in vault -> else return backlinksTo(notes, targetNote).
   */
  function backlinks(path: string): readonly Backlink[] {
    // Check if the service has been destroyed.
    if (destroyed) {
      // Branch: Service is destroyed; every method is a no-op after destroy.
      return [];
    } else {
      // Branch: Service is active; locate note entry by path.
    }

    // Search for the note entry with the given path.
    let targetNote: NoteIndexEntry | undefined = undefined;
    for (let i = 0; i < notes.length; i++) {
      const entry = notes[i];
      // Check if entry is defined and matches the requested path.
      if (entry !== undefined && entry.path === path) {
        // Branch: Note matching path found.
        targetNote = entry;
        break;
      } else {
        // Branch: Path does not match; continue search.
      }
    }

    // Check whether the target note was found in the vault.
    if (targetNote === undefined) {
      // Branch: Note not found. A document that is not in the vault has no backlinks rather than an error.
      return [];
    } else {
      // Branch: Note found; compute incoming backlinks using core backlinksTo.
      return backlinksTo(notes, targetNote);
    }
  }

  /**
   * Permanently marks the service as destroyed, terminating in-flight scans and clearing notes.
   *
   * @purpose Cleans up vault service resources and ensures all subsequent method calls no-op.
   * @inputs None.
   * @outputs void.
   * @dataflow Mark destroyed flag -> invalidate scanToken -> clear state collections.
   * @controlflow Check destroyed -> set destroyed = true -> increment scanToken -> clear notes, root, unreadable, scanning.
   */
  function destroy(): void {
    // Check if the service has already been destroyed.
    if (destroyed) {
      // Branch: Service already destroyed; every method is a no-op after destroy.
      return;
    } else {
      // Branch: Service active; mark destroyed and clean up state.
    }

    // Marks the service destroyed so a scan still in flight stops touching state, and clears the notes.
    // Every method must be a no-op after destroy.
    destroyed = true;
    scanToken++;
    notes = [];
    unreadable = [];
    currentRoot = null;
    scanning = false;
  }

  return {
    /**
     * Indicates whether filesystem vault scanning is supported in this runtime environment.
     *
     * @purpose Reports desktop Tauri host availability for vault operations.
     * @inputs None.
     * @outputs boolean - True if running in Tauri desktop host, false in browser dev mode.
     * @dataflow available flag -> return boolean.
     * @controlflow Return current available boolean flag.
     */
    get available(): boolean {
      return available;
    },

    /**
     * Current status of the vault scan and index.
     *
     * @purpose Provides an immutable snapshot of current vault state.
     * @inputs None.
     * @outputs VaultStatus - Snapshot containing root, noteCount, unreadable list, and scanning status.
     * @dataflow getStatus() -> VaultStatus.
     * @controlflow Delegate to getStatus() helper and return snapshot.
     */
    get status(): VaultStatus {
      return getStatus();
    },

    /**
     * Every indexed note in the vault, ordered by relative path ascending.
     *
     * @purpose Exposes all indexed note entries in deterministic order.
     * @inputs None.
     * @outputs readonly NoteIndexEntry[] - Readonly array of indexed note records.
     * @dataflow notes array -> return readonly array reference.
     * @controlflow Return current notes array.
     */
    get notes(): readonly NoteIndexEntry[] {
      return notes;
    },

    open,
    close,
    refresh,
    update,
    find,
    tags,
    tagged,
    backlinks,
    destroy,
  };
}
