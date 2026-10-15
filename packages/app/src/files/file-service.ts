/**
 * @file file-service.ts
 * @purpose Webview-side half of the filesystem adapter wrapping Tauri native dialog and Rust filesystem commands with graceful browser degradation. Rename and reveal are the host's to do because both are about the filesystem and the shell, and the webview can reach neither.
 *
 *   HEADER NOTE: JavaScript never touches the disk. Every operation here is either a file picker
 *   supplied by the Tauri dialog plugin or an invoke of one of K-Doc's own validated Rust commands,
 *   which is what keeps the webview's capability surface narrow (NFR-5, DESIGN.md §4). Running
 *   npm run dev in a browser is a legitimate development mode, so the service reports available: false
 *   there and every operation rejects with a message saying so, rather than throwing something
 *   cryptic from deep inside Tauri.
 *
 * @inputs Browser Window object for runtime environment detection; file paths, document contents, and BOM flags for file I/O operations.
 * @outputs OpenedFile data structures containing read text and BOM metadata, save path choices, or file write confirmations via FileService.
 * @functions
 *   - createFileService: Constructs a FileService adapter instance wrapping Tauri dialog and Rust IPC commands.
 *   - renameFile: Renames the file at `from` to `to`, refusing to overwrite an existing file, resolving with the new path.
 *   - revealInFileManager: Opens the system file manager with the given file selected.
 *   - readFile: Reads a known path without a picker, keeping the encoding it was found in.
 * @dataflow User/UI file action -> FileService method -> Tauri dialog picker / Rust IPC invoke (read_text_file / write_text_file) -> disk I/O -> OpenedFile / void result.
 * @controlflow Runtime capability probe via isTauri(win) -> construct FileService object literal -> validate desktop availability on each method invocation (throw user-facing Error if in browser) -> delegate to Tauri dialog / Rust command -> return mapped result or null on cancellation.
 * @version 7
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';
/** Prefix of the host's error for a path the user never gave K-Doc access to (src-tauri/src/grants.rs). */
const ACCESS_DENIED_PREFIX = 'ACCESS_DENIED: ';
import { fromDisk, toDisk, type LineEnding } from './line-endings.js';

/**
 * Encapsulates the contents and metadata of a file successfully opened from disk.
 */
export interface OpenedFile {
  readonly path: string;
  readonly contents: string;
  /**
   * The encoding the file was found in, as the wire name the host reported.
   *
   * A name rather than a boolean: a flag could only ever answer *UTF-8 with or without a BOM*, and the
   * question a save has to answer is *what was this file*. One of 'utf-8', 'utf-8-bom', 'utf-16le' or
   * 'utf-16be'; anything else the host sends is treated as 'utf-8' on the way back.
   */
  readonly encoding: string;
  /**
   * Whether the file is read-only on disk (FR-6.7), so the editor can open it locked.
   *
   * Reported with the read rather than asked for afterwards, because a file checked later may already
   * be a different file. Absent when the host did not say, which is read as writable.
   */
  readonly readOnly?: boolean;
}

/**
 * Encapsulates the target path, contents, and encoding flags for saving a file to disk.
 */
export interface SaveTarget {
  readonly path: string;
  readonly contents: string;
  /**
   * The encoding the file was found in, as the wire name the host reported.
   *
   * A name rather than a boolean: a flag could only ever answer *UTF-8 with or without a BOM*, and the
   * question a save has to answer is *what was this file*. One of 'utf-8', 'utf-8-bom', 'utf-16le' or
   * 'utf-16be'; anything else the host sends is treated as 'utf-8' on the way back.
   */
  readonly encoding: string;
  /**
   * How the file's lines should end on disk. When absent, the service uses what it saw when it last read or wrote this
   * path, then what the file on disk uses, then LF for a file that does not exist yet.
   */
  readonly lineEnding?: LineEnding;
}

/**
 * Public service interface for opening, saving, and choosing paths for Markdown files.
 */
export interface FileService {
  readonly available: boolean;
  openFile(): Promise<OpenedFile | null>;
  /** Reads a known path with no dialog. Used by the external-change watcher, which already knows the path. */
  readPath(path: string): Promise<string>;
  /** Reads a known path with no dialog, keeping the encoding it was found in, for opening it into a tab. */
  readFile(path: string): Promise<OpenedFile>;
  saveFile(target: SaveTarget): Promise<void>;
  /**
   * How the lines of a file this service read or wrote end on disk, or undefined for a path it has not seen. Text it
   * returns always has LF line breaks when the file's were all CRLF; the file gets CRLF back when saved.
   */
  lineEndingOf?(path: string): LineEnding | undefined;
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /**
   * Asks for a document to import (FR-13.5) and reads its bytes. Resolves null when the picker is dismissed.
   * Optional: only the desktop app can read a file the reader picks.
   */
  openImportFile?(): Promise<ImportedFile | null>;
  /**
   * Asks for a folder, for opening one as a vault. Resolves null when the picker is dismissed.
   *
   * Separate from chooseSavePath rather than a flag on it: one asks where to write a file and the
   * other asks which folder to read, and a single function answering both would take an argument
   * whose only job is to say which of two unrelated things it is doing.
   */
  chooseFolder(): Promise<string | null>;
  /**
   * Renames the file at `from` to `to`, refusing to overwrite an existing file.
   * Resolves with the new path.
   */
  renameFile(from: string, to: string): Promise<string>;
  /**
   * Sets or clears a file's read-only attribute on disk (FR-6.7).
   *
   * Changing a file's attributes is deliberate, so the caller asks before calling this.
   *
   * Optional, as `lineEndingOf` is: a host that cannot change file attributes simply does not offer it,
   * and the caller reports that rather than pretending the lock was cleared.
   */
  setReadOnly?(path: string, readOnly: boolean): Promise<void>;
  /**
   * Writes bytes to a file atomically, for an export that is not text (FR-13.4).
   *
   * Optional, as setReadOnly is: a host that cannot write binary files does not offer it, and the
   * shell says so rather than writing a corrupt file through the text path.
   */
  saveBinaryFile?(path: string, bytes: Uint8Array): Promise<void>;
  /** Opens the system file manager with this file selected. */
  revealInFileManager(path: string): Promise<void>;
}

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Raw response payload structure returned by the Tauri `read_text_file` command.
 */
interface RustFileContents {
  readonly path: string;
  readonly contents: string;
  readonly encoding: string;
  readonly readOnly?: boolean;
}

/**
 * File dialog filter configuration for Markdown files.
 * Note on mdx: mdx is offered because K-Doc can open and preserve one even though it cannot
 * richly edit it — the unknown-node atoms carry it through unchanged.
 */


/** File dialog filter for the formats K-Doc can import (FR-13.5); kept in step with importFormatOf in document-import.ts. */


/** A document picked for import: where it was, and its bytes, untouched. */
export interface ImportedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
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
 * Creates a file service instance bound to the provided window context.
 *
 * @purpose Constructs a FileService adapter wrapping Tauri native dialog and filesystem commands with honest browser fallback.
 * @inputs win - The host browser Window object to check for Tauri desktop host capabilities.
 * @outputs FileService - An object implementing openFile, saveFile, chooseSavePath and chooseFolder operations.
 * @dataflow Window capability check -> FileService instance wrapping Tauri dialog & IPC invoke calls.
 * @controlflow Probe Tauri runtime availability via isTauri(win) -> construct and return FileService implementation with guarded async methods.
 */
export function createFileService(win: Window): FileService {
  const available = isTauri(win);
  // How each file's lines ended when last read or written, by normalised path. The editor works on LF text so that
  // offsets agree everywhere; this is what lets a CRLF file be written back as CRLF.
  const lineEndings = new Map<string, LineEnding>();

  /**
   * @purpose The key a path is remembered under: separators and case do not distinguish files on Windows.
   * @inputs path - A file path.
   * @outputs string - The path with forward slashes, lower-cased.
   * @dataflow path -> slash normalisation -> lower case.
   * @controlflow One expression.
   */
  function pathKey(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  /**
   * @purpose Converts text read from a file to the editor's LF text, remembering how the file's lines ended.
   * @inputs path - The file read; contents - Its text as decoded by the host.
   * @outputs string - The text with CRLF line breaks as LF when every break was CRLF, else unchanged.
   * @dataflow contents -> fromDisk -> lineEndings[path] and returned text.
   * @controlflow Convert, record, return.
   */
  function readText(path: string, contents: string): string {
    const internal = fromDisk(contents);
    lineEndings.set(pathKey(path), internal.lineEnding);
    return internal.text;
  }

  /**
   * @purpose Finds how a file already on disk ends its lines, for a save to a path this service has not read.
   * @inputs path - The file about to be written.
   * @outputs Promise<LineEnding> - The file's line ending, or LF when it cannot be read.
   * @dataflow path -> read_text_file -> fromDisk -> line ending.
   * @controlflow Read the file; a failed read (the usual cause is that the file does not exist yet) means LF, and a
   *   real problem with the path surfaces from the write that follows.
   */
  /**
   * Maps what the host returned for a read into the OpenedFile the editor works with.
   *
   * Both openFile and readFile go through here, so the two cannot drift: when they each mapped the
   * payload by hand, a field added to one was quietly missing from the other.
   *
   * @purpose Turns a RustFileContents payload into an OpenedFile.
   * @inputs payload - What the host's read_text_file command returned.
   * @outputs OpenedFile - The path the host resolved, the text with its line endings normalised, the
   *   encoding it was found in, and whether it is read-only.
   * @dataflow payload -> readText for the contents -> OpenedFile.
   * @controlflow No branching beyond reading the lock strictly: anything but true means writable, because
   *   locking a file the reader can in fact edit is worse than missing one that is genuinely read-only.
   */
  function toOpenedFile(payload: RustFileContents): OpenedFile {
    return {
      path: payload.path,
      contents: readText(payload.path, payload.contents),
      encoding: payload.encoding,
      readOnly: payload.readOnly === true,
    };
  }

  async function lineEndingOnDisk(path: string): Promise<LineEnding> {
    try {
      const existing = await invoke<RustFileContents>('read_text_file', { path });
      return fromDisk(existing.contents).lineEnding;
    } catch {
      // Not readable: normally a new file, which starts with LF. Not swallowed in effect: the write below reports
      // any error that stops the file being saved.
      return 'lf';
    }
  }

  /**
   * Reads a text file through the host, asking the user once when K-Doc has not been given access to it.
   *
   * @purpose Lets a link or a remembered path open a file the user never picked, but only with their say-so.
   * @inputs path - Absolute path of the file to read.
   * @outputs Promise<RustFileContents> - The host's read result.
   * @dataflow path -> read_text_file -> (access denied) -> request_file_access prompt -> read_text_file again.
   * @controlflow Any failure other than a refused access is rethrown unchanged; a refused prompt throws a plain message.
   */
  async function readGranted(path: string): Promise<RustFileContents> {
    try {
      return await invoke<RustFileContents>('read_text_file', { path });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Check whether the host refused because the user never chose this file, rather than a real read failure.
      if (!message.startsWith(ACCESS_DENIED_PREFIX)) {
        throw error;
      } else {
        // Not granted yet: ask the user once.
      }
      const allowed = await invoke<boolean>('request_file_access', { path });
      // Check what the user answered.
      if (!allowed) {
        throw new Error(`K-Doc was not given access to ${path}.`);
      } else {
        // Granted: read it now.
      }
      return invoke<RustFileContents>('read_text_file', { path });
    }
  }

  return {
    available,

    async openFile(): Promise<OpenedFile | null> {
      // Guard against running outside desktop environment.
      // Clear, user-facing sentence rather than a stack trace, because it will be shown in the UI.
      if (!available) {
        // Branch: Desktop capabilities absent; reject with user-facing message.
        throw new Error('File access is only available in the K-Doc desktop app.');
      } else {
        // Branch: Desktop host present; proceed with native open dialog.
      }

      // The host shows the picker and records what the user chose, which is what lets K-Doc read it at all.
      const chosenPath = await invoke<string | null>('pick_open_file', { kind: 'markdown' });

      // Check if user cancelled the open dialog.
      // Cancellation is a normal outcome and must not be an error — this is the same reasoning as undo() returning null on an empty history.
      if (chosenPath === null) {
        // Branch: User cancelled file picker dialog; return null.
        return null;
      } else {
        // Branch: User selected a file; read it below.
      }

      // Invoke the Rust read_text_file command to load the file from disk.
      // Tauri converts camelCase JavaScript argument keys to the Rust snake_case parameter names automatically,
      // but does NOT convert the fields of a returned struct, which is why the result is mapped by hand.
      const payload = await invoke<RustFileContents>('read_text_file', { path: chosenPath });

      return toOpenedFile(payload);
    },

    /**
     * Reads a known path directly, without a file picker.
     *
     * @purpose Reads the text of a path the caller already knows, for the external-change watcher.
     * @inputs path - Absolute path of the file to read.
     * @outputs Promise<string> - The file's text contents.
     * @dataflow path -> invoke('read_text_file') -> RustFileContents -> contents.
     * @controlflow Guard desktop availability -> invoke the Rust command -> return its contents.
     */
    async readPath(path: string): Promise<string> {
      // Check whether the Tauri runtime is present to serve the read.
      if (!available) {
        // Branch: Browser build has no filesystem; fail loudly rather than returning empty text,
        // which a caller would mistake for a file that had been emptied on disk.
        throw new Error('Reading files requires the desktop app.');
      } else {
        // Branch: Desktop runtime present; delegate to the validated Rust command.
      }

      const result = await readGranted(path);
      return readText(path, result.contents);
    },

    /**
     * @purpose Reads a known path without a picker, keeping the encoding, for opening a file into a tab.
     * @inputs path - Absolute path of the file to read.
     * @outputs Promise<OpenedFile> - The file's path, text and the encoding it was found in.
     * @dataflow path -> invoke('read_text_file') -> RustFileContents -> OpenedFile.
     * @controlflow Guard desktop availability -> invoke the Rust command -> map the result by hand.
     */
    async readFile(path: string): Promise<OpenedFile> {
      // Check whether the Tauri runtime is present to serve the read.
      if (!available) {
        // Browser build: no filesystem, so fail loudly rather than opening an empty tab named after the file.
        throw new Error('Reading files requires the desktop app.');
      } else {
        // Desktop runtime present: delegate to the validated Rust command.
      }

      const result = await readGranted(path);
      // Mapped by hand for the same reason as openFile: Tauri does not rename a returned struct's fields.
      return toOpenedFile(result);
    },

    async saveFile(target: SaveTarget): Promise<void> {
      // Guard against running outside desktop environment.
      // Clear, user-facing sentence rather than a stack trace, because it will be shown in the UI.
      if (!available) {
        // Branch: Desktop capabilities absent; reject with user-facing message.
        throw new Error('File access is only available in the K-Doc desktop app.');
      } else {
        // Branch: Desktop host present; proceed with native save invoke.
      }

      // Invoke the Rust write_text_file command to atomically persist contents to disk.
      // encoding maps to the Rust command's encoding parameter and writes the file back as it was found,
      // so K-Doc neither adds a byte order mark nor removes one, and never converts a UTF-16 file to UTF-8.
      // The line ending the caller named, else the one this path was read or last written with, else the file's own.
      const lineEnding = target.lineEnding ?? lineEndings.get(pathKey(target.path)) ?? (await lineEndingOnDisk(target.path));
      await invoke('write_text_file', {
        path: target.path,
        contents: toDisk(target.contents, lineEnding),
        encoding: target.encoding,
      });
      lineEndings.set(pathKey(target.path), lineEnding);
    },

    /**
     * Sets or clears a file's read-only attribute on disk (FR-6.7).
     *
     * @purpose Makes a read-only file writable, so a locked document can be unlocked and saved.
     * @inputs path - Absolute path of the file. readOnly - True to set the attribute, false to clear it.
     * @outputs Promise<void> - Resolves once the host has changed it; rejects with the host's reason.
     * @dataflow path + readOnly -> set_file_read_only -> the file's permissions.
     * @controlflow Refuse outside the desktop app, where there is no filesystem to change; otherwise delegate.
     */
    async setReadOnly(path: string, readOnly: boolean): Promise<void> {
      // Check whether the desktop host is present to make the change.
      if (!available) {
        // Browser build: there is no file on disk to unlock, so say so rather than resolving silently.
        throw new Error('Changing a file lock requires the desktop app.');
      } else {
        // Desktop runtime present: delegate to the host command.
      }

      await invoke('set_file_read_only', { path, readOnly });
    },

    /**
     * Asks for a document to import and reads it (FR-13.5).
     *
     * @purpose Lets the reader pick a Word, HTML, RTF or text file and hands back its bytes for conversion.
     * @inputs void.
     * @outputs Promise<ImportedFile | null> - The path and bytes, or null when the dialog is dismissed.
     * @dataflow import filter dialog -> chosen path -> read_binary_file -> ArrayBuffer -> Uint8Array.
     * @controlflow Refuse outside the desktop app; a dismissed dialog resolves null; otherwise read the file.
     */
    async openImportFile(): Promise<ImportedFile | null> {
      // Check whether the desktop host is present to show a dialog and read the file.
      if (!available) {
        throw new Error('File access is only available in the K-Doc desktop app.');
      } else {
        // Desktop runtime present: ask for the file.
      }
      // The host shows the picker and records the choice, so only the picked file can be read.
      const path = await invoke<string | null>('pick_open_file', { kind: 'import' });
      // Check whether a file was chosen at all.
      if (path === null) {
        return null;
      } else {
        // A file was chosen: read its bytes, which arrive as an ArrayBuffer.
      }
      const data = await invoke<ArrayBuffer>('read_binary_file', { path });
      return { path, bytes: new Uint8Array(data) };
    },

    /**
     * Writes bytes to a file atomically (FR-13.4).
     *
     * @purpose Saves an export that is not text, such as a Word document.
     * @inputs path - Absolute path to write. bytes - The file's contents.
     * @outputs Promise<void> - Resolves once the file is on disk; rejects with the host's reason.
     * @dataflow bytes -> a number array -> write_binary_file -> the file.
     * @controlflow Refuse outside the desktop app, where there is no filesystem; otherwise delegate.
     */
    async saveBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
      // Check whether the desktop host is present to write the file.
      if (!available) {
        throw new Error('File access is only available in the K-Doc desktop app.');
      } else {
        // Desktop runtime present: hand the bytes over. Tauri carries them as a JSON number array.
      }
      await invoke('write_binary_file', { path, data: Array.from(bytes) });
    },

    lineEndingOf(path: string): LineEnding | undefined {
      return lineEndings.get(pathKey(path));
    },

    async chooseSavePath(suggestedName: string): Promise<string | null> {
      // Guard against running outside desktop environment.
      // Clear, user-facing sentence rather than a stack trace, because it will be shown in the UI.
      if (!available) {
        // Branch: Desktop capabilities absent; reject with user-facing message.
        throw new Error('File access is only available in the K-Doc desktop app.');
      } else {
        // Branch: Desktop host present; proceed with native save dialog.
      }

      // The host shows the picker (its filter follows the suggested name's extension) and records the choice,
      // which is what allows the save that follows.
      const chosen = await invoke<string | null>('pick_save_path', { suggested: suggestedName });

      // Check if user selected a destination path or cancelled the dialog.
      if (chosen === null) {
        // Branch: User cancelled save destination picker dialog; return null.
        return null;
      } else {
        // Branch: User selected a target save path string; return path.
        return chosen;
      }
    },

    async chooseFolder(): Promise<string | null> {
      // Guard against running outside desktop environment.
      // Clear, user-facing sentence rather than a stack trace, because it will be shown in the UI.
      if (!available) {
        // Branch: Desktop capabilities absent; reject with user-facing message.
        throw new Error('Opening a folder is only available in the K-Doc desktop app.');
      } else {
        // Branch: Desktop host present; proceed with native folder dialog.
      }

      // The host shows the folder picker and records the folder, which is what lets K-Doc work inside it.
      const chosen = await invoke<string | null>('pick_folder');

      // Check whether the user picked a folder or dismissed the dialog.
      if (chosen === null) {
        // Branch: Dismissed. Cancellation is a normal outcome, not an error.
        return null;
      } else {
        // Branch: One folder chosen; hand back its path.
        return chosen;
      }
    },

    async renameFile(from: string, to: string): Promise<string> {
      // Check whether the host is present at all.
      if (!available) {
        // No host: there is no filesystem to rename on.
        throw new Error('Renaming a file needs the desktop host.');
      } else {
        // Host present: ask it to rename.
      }
      return await invoke<string>('rename_file', { from, to });
    },

    async revealInFileManager(path: string): Promise<void> {
      // Check whether the host is present at all.
      if (!available) {
        // No host: there is no file manager to open.
        throw new Error('Revealing a file needs the desktop host.');
      } else {
        // Host present: ask it to reveal.
      }
      await invoke('reveal_in_file_manager', { path });
    },
  };
}
