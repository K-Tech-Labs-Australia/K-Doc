/**
 * @file vault-search-controller.ts
 * @purpose The application-side half of vault-wide find and replace (FR-9.5): it gathers each note's text
 *   (an open tab's text wins over the file on disk), runs the pure search engine from @k-doc/core, and writes
 *   replacements back to wherever each note lives — an open tab or the file itself. It also keeps an undo log of
 *   the last replace so it can be reverted. The controller is a closure over injected I/O dependencies so it stays
 *   free of any filesystem, Tauri, or DOM coupling and remains unit-testable in isolation.
 * @inputs VaultSearchControllerOptions: a notes() list, openText for tab text, writeOpen to edit tabs, readFile and
 *   saveFile for disk access, and onWritten to notify the vault index after a closed note is rewritten.
 * @outputs A VaultSearchController exposing search(), replace(), undoLastReplace(), forget(), and canUndo.
 * @functions
 *   - createVaultSearchController: Factory that wires the injected I/O into the controller closure and returns it.
 *   - search: Gathers each note's text (tab wins over disk) and runs the pure vault search, reporting unreadable notes.
 *   - replace: Applies chosen matches to open tabs or disk files, logging an undo trail for the last run only.
 *   - undoLastReplace: Restores what the last replace changed, skipping any note edited since the replace ran.
 *   - forget: Drops remembered disk text for one note's path, or every note's when no path is given.
 *   - messageOf (internal): Extracts a human-readable reason string from any thrown value.
 *   - throwIfAborted (internal): Throws the abort signal's reason when the signal has already aborted.
 * @dataflow Injected I/O -> gather per-note text (tab ?? cached disk) -> pure search/replace engine -> write back to tab or file -> report counts and failures; replace records an undo log that undoLastReplace consumes.
 * @controlflow Compile query once (fail fast on bad regex) -> read missing notes concurrently -> build searchable files -> run pure engine; replace branches per note between open-tab and disk paths, logging only real changes; undo restores matching text or skips edited notes.
 * @version 1
 * @date 2026-09-14
 */

import {
  findMatches,
  replaceSelected,
  searchFiles,
  type SearchOptions,
  type SearchableFile,
  type VaultSearchResult,
} from '@k-doc/core';

/**
 * A note in the vault and how it should be identified to the UI.
 */
export interface VaultNoteRef {
  /** Absolute path of the note on disk. */
  readonly path: string;
  /** Path relative to the vault root, for display and result listing. */
  readonly relative: string;
}

/**
 * Injected I/O dependencies that let the controller read notes, edit open tabs, and persist files without coupling
 * to any filesystem, Tauri, or DOM implementation.
 */
export interface VaultSearchControllerOptions {
  /** The notes in the vault, in the order results should be listed. */
  readonly notes: () => readonly VaultNoteRef[];
  /** The text of the note as open in a tab, or null when it is not open. */
  readonly openText: (path: string) => string | null;
  /** Puts new text into the open tab holding the note. Only called when openText returned a string. */
  readonly writeOpen: (path: string, text: string) => void;
  /** Reads a note from disk, returning its contents and the encoding it was found in. */
  readonly readFile: (path: string) => Promise<{ readonly contents: string; readonly encoding: string }>;
  /** Persists new contents to a file at the given path and encoding. */
  readonly saveFile: (target: { readonly path: string; readonly contents: string; readonly encoding: string }) => Promise<void>;
  /** Told after a closed note was rewritten on disk, so the vault index can follow. */
  readonly onWritten: (path: string, text: string) => void;
}

/**
 * The result of a vault-wide search, augmented with notes that could not be read and were therefore excluded.
 */
export interface VaultSearchOutcome extends VaultSearchResult {
  /** Notes that could not be read, with the reason; they were not searched. */
  readonly unreadable: readonly { readonly path: string; readonly message: string }[];
}

/**
 * A request to replace chosen matches across notes previously returned by a search.
 */
export interface ReplaceRequest {
  /** The original search query, matched against each note's text. */
  readonly query: string;
  /** Search options (case sensitivity, whole word, regex) shared with the search engine. */
  readonly options: SearchOptions;
  /** The replacement template applied to every chosen match. */
  readonly replacement: string;
  /** The chosen matches per note path. A path with an empty list is skipped. */
  readonly selections: ReadonlyMap<string, readonly { readonly start: number; readonly end: number }[]>;
}

/**
 * A single file that failed to be read or written during a replace or undo.
 */
export interface FileFailure {
  /** The path of the note that could not be processed. */
  readonly path: string;
  /** The human-readable reason it was skipped. */
  readonly message: string;
}

/**
 * A summary of what a replace run changed across the vault.
 */
export interface ReplaceReport {
  /** Total number of matches replaced across all files. */
  readonly replaced: number;
  /** Number of files whose text actually changed. */
  readonly files: number;
  /** Chosen matches that were no longer present and were therefore left alone. */
  readonly stale: number;
  /** Files that could not be read or written, reported by path with their reason. */
  readonly failures: readonly FileFailure[];
}

/**
 * A summary of what an undo run restored across the vault.
 */
export interface UndoReport {
  /** Files put back to their pre-replace text. */
  readonly restored: number;
  /** Files changed again since the replace, left alone because the newer change wins. */
  readonly skipped: number;
  /** Notes that could not be read or written during undo, reported by path with their reason. */
  readonly failures: readonly FileFailure[];
}

/**
 * The vault-wide find-and-replace controller returned by createVaultSearchController.
 */
export interface VaultSearchController {
  /**
   * Runs a search across every note in the vault.
   *
   * @param query - The search query (literal or regular expression).
   * @param options - Search options controlling case sensitivity, whole-word matching, and regex mode.
   * @param signal - Abort signal; cancellation is honored between reading notes.
   * @returns The pure search result plus a list of unreadable notes that were excluded from searching.
   * @throws InvalidQueryError when the query is a syntactically invalid regular expression, before any file is read.
   * @throws The abort signal's reason when the operation is aborted via the provided signal.
   */
  search(query: string, options: SearchOptions, signal: AbortSignal): Promise<VaultSearchOutcome>;

  /**
   * Applies chosen matches to open tabs or disk files across the vault.
   *
   * @param request - The query, options, replacement template, and per-note match selections to apply.
   * @returns A report of how many matches and files changed, how many were stale, and any file failures.
   * @throws InvalidQueryError when the query is a syntactically invalid regular expression, before any file is touched.
   */
  replace(request: ReplaceRequest): Promise<ReplaceReport>;

  /**
   * Restores what the last replace changed across the vault.
   *
   * @returns A report of restored and skipped notes and any failures, or null when there is nothing to undo.
   */
  undoLastReplace(): Promise<UndoReport | null>;

  /** True while a replace can be undone (an undo log is currently remembered). */
  readonly canUndo: boolean;

  /**
   * Drops remembered disk text from the search cache.
   *
   * @param path - Optional note path; when omitted, every note's remembered disk text is cleared.
   */
  forget(path?: string): void;
}

/**
 * A single recorded change made by a replace run, used to restore it on undo.
 *
 * Where the note lives is not recorded: it is asked again at undo time, because a note closed since the replace is
 * put back on disk and a note opened since is put back in its tab. The encoding is read back from the file then too.
 */
interface UndoEntry {
  /** Absolute path of the changed note. */
  readonly path: string;
  /** The note's text before the replace ran. */
  readonly before: string;
  /** The note's text after the replace ran; undo restores only while the note still holds exactly this. */
  readonly after: string;
}

/**
 * Extracts a human-readable reason from any thrown value.
 *
 * @purpose Normalizes an unknown caught value into a message string suitable for reporting in a failure record.
 * @inputs caught - The value thrown by a failed read, write, or replace operation.
 * @outputs string - The error's message when it is an Error, otherwise the value coerced to a string.
 * @dataflow Thrown value -> instanceof Error check -> message property or String() coercion.
 * @controlflow Check whether caught is an Error instance -> return its message or stringify the fallback value.
 */
function messageOf(caught: unknown): string {
  // Prefer a real Error's descriptive message; fall back to stringifying anything else so no reason is lost.
  if (caught instanceof Error) {
    // caught is an Error instance: use its built-in, human-readable message verbatim.
    return caught.message;
  } else {
    // caught is not an Error (e.g. a thrown string or object): stringify so the reason is still reported.
    return String(caught);
  }
}

/**
 * Throws the abort signal's reason when the caller has requested cancellation.
 *
 * @purpose Enforces cooperative cancellation by surfacing the AbortSignal's reason instead of continuing work.
 * @inputs signal - The AbortSignal to inspect before proceeding with an operation.
 * @outputs void - Returns normally when not aborted; throws the abort reason when it has aborted.
 * @dataflow Signal.aborted flag -> signal.reason -> thrown value propagated to the caller.
 * @controlflow Check signal.aborted -> throw the captured reason or fall through unchanged.
 */
function throwIfAborted(signal: AbortSignal): void {
  // If the caller aborted, surface the abort reason instead of continuing the operation.
  if (signal.aborted) {
    // signal.reason is typed `any` in lib.dom; capture it as unknown before throwing to preserve type safety.
    const reason: unknown = signal.reason;
    throw reason;
  } else {
    // Signal not aborted: proceed with the operation unchanged.
  }
}

/**
 * Wires the injected I/O dependencies into the vault-wide find-and-replace controller closure.
 *
 * @purpose Constructs a controller that gathers per-note text, runs the pure search engine, and writes replacements
 *   back to tabs or disk while remembering an undo trail for the most recent replace run.
 * @inputs deps - The injected I/O dependencies (notes list, tab read/write, disk read/save, index notification).
 * @outputs VaultSearchController - A controller implementing search, replace, undoLastReplace, forget, and canUndo.
 * @dataflow Injected deps -> closure-bound methods -> pure engine calls -> tab/disk writes -> reports and undo log.
 * @controlflow Declare this controller's own state (disk cache, undo log) -> define each method against the deps -> return them.
 */
export function createVaultSearchController(deps: VaultSearchControllerOptions): VaultSearchController {
  // Text read from disk, reused by later searches so notes are not re-read on every keystroke.
  const diskText = new Map<string, string>();
  // The replace run remembered for undo; replaced wholesale whenever a new run changes something.
  let undoLog: readonly UndoEntry[] = [];

  /**
   * @purpose Searches every note in the vault, taking an open tab's text over the file on disk.
   * @inputs query - The search query; options - case, whole word and regex; signal - aborts a superseded search.
   * @outputs Promise<VaultSearchOutcome> - The grouped matches plus the notes that could not be read. Rejects with
   *   InvalidQueryError for a malformed regex before any file is read, and with the signal's reason when aborted.
   * @dataflow notes -> tab text, remembered disk text, or a fresh read -> searchFiles -> outcome.
   * @controlflow Compile the query -> read the notes not open and not remembered, all at once -> remember reads, list
   *   failures -> stop if aborted -> search the notes that have text.
   */
  const search = async (query: string, options: SearchOptions, signal: AbortSignal): Promise<VaultSearchOutcome> => {
    // Compile once up front so a malformed regex fails before any file is read or any result is returned.
    // findMatches compiles the RegExp for a non-empty query and throws InvalidQueryError on a bad pattern; an empty
    // query returns [] which simply means "no search yet" and is harmless here.
    findMatches('', query, options);

    const notes = deps.notes();
    const unreadable: { path: string; message: string }[] = [];

    // Gather every note that must be read from disk: not open in a tab and not already remembered from an earlier search.
    const missing = notes.filter((note) => deps.openText(note.path) === null && !diskText.has(note.path));
    // Read all missing notes at once rather than one after another, so total latency is that of the slowest read.
    const settled = await Promise.allSettled(missing.map((note) => deps.readFile(note.path)));

    for (let i = 0; i < missing.length; i++) {
      const note = missing[i];
      const outcome = settled[i];

      // Parallel arrays of equal length: both indices are always defined, so this guard is defensive only.
      if (note === undefined || outcome === undefined) {
        // Unreachable: missing and settled share the same length and are indexed identically.
        continue;
      } else {
        // Both entries present: process this note's read result below.
      }

      // Cache successful reads for reuse by later searches; report failures as unreadable so they are excluded from searching.
      if (outcome.status === 'fulfilled') {
        // Read succeeded: cache the contents so subsequent searches can reuse it without re-reading disk.
        diskText.set(note.path, outcome.value.contents);
      } else {
        // Read failed: record the note and its reason as unreadable; it is excluded from the search set below.
        unreadable.push({ path: note.path, message: messageOf(outcome.reason) });
      }
    }

    // Cancellation is honoured only after the reads are remembered: a search superseded mid-read (by the next keystroke,
    // or by the vault notifying while it scans) has still paid for those reads, and the search replacing it should not
    // pay again.
    throwIfAborted(signal);

    const files: SearchableFile[] = [];
    for (const note of notes) {
      // Prefer the in-tab text when present, else the cached disk read; null means the note is unreadable.
      const text = deps.openText(note.path) ?? diskText.get(note.path) ?? null;

      // A note with no available text was already reported as unreadable and must not be searched.
      if (text === null) {
        // No text available for this note: skip it; its failure is already recorded in the unreadable list.
        continue;
      } else {
        // Text available from a tab or disk: include it in the searchable file set, preserving vault order.
        files.push({ path: note.path, relative: note.relative, text });
      }
    }

    const result = searchFiles(files, query, options);
    return { ...result, unreadable };
  };

  /**
   * @purpose Replaces the chosen matches in each note, in its tab when open and in its file otherwise.
   * @inputs request - The query and options of the results on screen, the replacement, and the chosen matches per path.
   * @outputs Promise<ReplaceReport> - Matches replaced, files changed, stale matches, and per-file failures. Rejects
   *   with InvalidQueryError before touching any note when the query is malformed.
   * @dataflow note text -> replaceSelected -> writeOpen, or saveFile in the file's own encoding -> undo log.
   * @controlflow Compile the query -> for each path with matches: open tab or fresh disk read -> replace -> write when
   *   anything changed; a failure is recorded and the next note continues -> keep the log when it changed anything.
   */
  const replace = async (request: ReplaceRequest): Promise<ReplaceReport> => {
    // Compile once up front so a malformed regex fails before any file is written or state is mutated.
    findMatches('', request.query, request.options);

    let replaced = 0;
    let changedFiles = 0;
    let stale = 0;
    const failures: FileFailure[] = [];
    const log: UndoEntry[] = [];

    for (const [path, chosen] of request.selections) {
      // A path with an empty selection list means "leave this note alone".
      if (chosen.length === 0) {
        // No matches selected for this note: skip it entirely.
        continue;
      } else {
        // Matches were selected for this note: proceed to replace them below.
      }

      try {
        const open = deps.openText(path);

        // An open note is edited in its tab, where the user can see and independently undo the change.
        if (open !== null) {
          const outcome = replaceSelected(open, request.query, request.options, request.replacement, chosen);
          stale += outcome.stale;

          // Only record an undo entry and count a changed file when text actually changed.
          if (outcome.replaced > 0) {
            deps.writeOpen(path, outcome.text);
            log.push({ path, before: open, after: outcome.text });
            replaced += outcome.replaced;
            changedFiles++;
          } else {
            // Nothing was replaced in this note: leave it untouched and do not log an undo entry.
          }
        } else {
          // A closed note is read fresh from disk rather than from the search's copy, so a change made since the
          // search is caught by the stale check instead of being silently overwritten on save.
          const file = await deps.readFile(path);
          const outcome = replaceSelected(file.contents, request.query, request.options, request.replacement, chosen);
          stale += outcome.stale;

          // Persist only when text actually changed; cache and notify so the vault index follows along.
          if (outcome.replaced > 0) {
            await deps.saveFile({ path, contents: outcome.text, encoding: file.encoding });
            diskText.set(path, outcome.text);
            deps.onWritten(path, outcome.text);
            log.push({ path, before: file.contents, after: outcome.text });
            replaced += outcome.replaced;
            changedFiles++;
          } else {
            // Nothing was replaced in this note: leave the disk copy untouched and do not log an undo entry.
          }
        }
      } catch (caught: unknown) {
        // A single unwritable or unreadable file must not abort the whole replace; report it by path with its reason.
        failures.push({ path, message: messageOf(caught) });
      }
    }

    // Only a replace that changed something becomes the one undo restores; an empty run leaves history intact.
    if (log.length > 0) {
      // This run made changes: it replaces any previous run as the target of the next undo.
      undoLog = log;
    } else {
      // No changes were made this run: keep the prior undo log untouched so a later real replace still undoes correctly.
    }

    return { replaced, files: changedFiles, stale, failures };
  };

  /**
   * @purpose Puts back what the last replace changed, leaving alone any note changed again since.
   * @inputs none - reads the undo log.
   * @outputs Promise<UndoReport | null> - Notes restored, skipped and failed; null when there is nothing to undo.
   * @dataflow undo log -> current text (tab or disk) compared with what the replace wrote -> the text before it.
   * @controlflow Return null on an empty log -> take and clear the log -> per entry restore, skip or record a failure.
   */
  const undoLastReplace = async (): Promise<UndoReport | null> => {
    // Nothing to restore when there is no recorded replace; resolve with null rather than reporting zero changes.
    if (undoLog.length === 0) {
      // No previous replace exists: resolve with null so callers can distinguish "nothing to undo" from "restored none".
      return null;
    } else {
      // A previous replace exists: drain the log and restore each entry below.
    }

    const entries = undoLog;
    // Clear before restoring so a nested or re-entrant call cannot replay the same entries twice.
    undoLog = [];

    let restored = 0;
    let skipped = 0;
    const failures: FileFailure[] = [];

    for (const entry of entries) {
      try {
        const open = deps.openText(entry.path);

        // An open note is reverted in its tab, but only if it still holds exactly what the replace wrote there.
        if (open !== null) {
          // Check whether the tab still holds exactly what the replace wrote.
          if (open === entry.after) {
            // Tab text is unchanged since the replace: restore the pre-replace text into the tab.
            deps.writeOpen(entry.path, entry.before);
            restored++;
          } else {
            // User edited the tab after the replace: their newer edits win, so skip this note.
            skipped++;
          }
        } else {
          // Closed: the file is read fresh, since it is the file that has to still hold what the replace wrote.
          const file = await deps.readFile(entry.path);

          // A closed note is reverted from disk only if it still matches what the replace wrote there.
          if (file.contents === entry.after) {
            await deps.saveFile({ path: entry.path, contents: entry.before, encoding: file.encoding });
            diskText.set(entry.path, entry.before);
            deps.onWritten(entry.path, entry.before);
            restored++;
          } else {
            // Disk changed after the replace: the newer change wins, so skip this note.
            skipped++;
          }
        }
      } catch (caught: unknown) {
        // A single failure here must not abort the rest of the undo; report it by path with its reason.
        failures.push({ path: entry.path, message: messageOf(caught) });
      }
    }

    return { restored, skipped, failures };
  };

  /**
   * @purpose Drops remembered disk text, so the next search reads the note again.
   * @inputs path - One note's path, or undefined for every note.
   * @outputs void.
   * @dataflow path -> diskText entry removed, or the whole map cleared.
   * @controlflow Clear everything when no path is given, else delete the one entry.
   */
  const forget = (path?: string): void => {
    // With no argument, drop every remembered disk read; otherwise drop just one note's cached text.
    if (path === undefined) {
      // No path given: clear the entire remembered-disk cache so the next search re-reads from disk.
      diskText.clear();
    } else {
      // A specific path given: forget only that note's remembered disk text, leaving others cached.
      diskText.delete(path);
    }
  };

  return {
    search,
    replace,
    undoLastReplace,
    forget,
    get canUndo(): boolean {
      // Undo is possible exactly while a recorded replace remains in the log.
      return undoLog.length > 0;
    },
  };
}
