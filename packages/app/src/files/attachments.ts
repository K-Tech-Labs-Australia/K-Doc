/**
 * @file attachments.ts
 * @purpose The webview's side of attachment management (FR-6.14): where an attachment is written, what the document refers to it by, and the three host commands that write and list attachments.
 *   Why this exists:
 *   A note can carry files — images, PDFs, anything dropped into it — but a document is only text; the bytes live on disk in a folder the note points at. This module decides that folder (resolved against the note so moving both together keeps the reference valid), names attachments relative to the note so they travel with it, and talks to the desktop backend's three commands: attachment_write, attachment_copy, and attachment_names.
 *   Known limitation:
 *   Outside the desktop app there is no disk to write to, so writing throws and listing returns an empty list rather than a failure — a report with nothing in it is truer than one that errors.
 * @inputs A Window object used to detect whether the Tauri desktop backend is present, a document path, an attachment folder setting, file names, bytes, and source paths.
 * @outputs Attachments: whether attachments are available plus write(), copy(), and names(); three pure path helpers — attachmentsFolderPath(), attachmentReference(), and isInsideFolder().
 * @functions
 *   - createAttachments: Builds the Attachments facade from a Window, detecting the desktop app once.
 *   - attachmentsFolderPath: Resolves the absolute folder an attachment is written into against the document's own folder.
 *   - attachmentReference: Names an attachment relative to the note so it travels with the document.
 *   - isInsideFolder: Reports whether a path already sits inside the attachments folder.
 * @dataflow Window -> availability flag -> invoke('attachment_*') for write/copy/names; documentPath + folderSetting -> attachmentsFolderPath -> joinPath; folderSetting + fileName -> attachmentReference; filePath + folderPath -> isInsideFolder.
 * @controlflow Detect Tauri once -> return methods that guard on availability and invoke the backend, or resolve paths with pure helpers.
 * @version 1
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';
import { dirname, joinPath } from '../shell/link-target.js';

export interface Attachments {
  /** True in the desktop app, where there is a disk to write to. */
  readonly available: boolean;
  /** Writes bytes into the folder under a free name derived from `name`; resolves to the name actually used. */
  write(folder: string, name: string, bytes: Uint8Array): Promise<string>;
  /** Copies an existing file into the folder under a free name derived from `name`; resolves to the name actually used. */
  copy(folder: string, name: string, source: string): Promise<string>;
  /** The file names the folder holds, empty when there is no such folder. */
  names(folder: string): Promise<readonly string[]>;
}

/** The folder attachments go in when the reader has not named one. */
export const DEFAULT_ATTACHMENTS_FOLDER: string = 'attachments';
/** The extension each image type is written with; a type not listed here is not an image K-Doc writes. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/**
 * Returns the extension an image of this MIME type is written with.
 *
 * @purpose Maps a clipboard MIME type to the file extension K-Doc writes for it, so pasted images get a real name on disk.
 * @inputs mimeType - The image's MIME type as reported by the clipboard, possibly carrying parameters after a ';'.
 * @outputs string - The extension without a leading dot, or '' when K-Doc does not write that type.
 * @dataflow mimeType -> trim and lower-case -> cut at ';' -> look up IMAGE_EXTENSIONS -> extension or ''.
 * @controlflow Clean the type to strip parameters, then return the mapped extension or an empty string for unknown types.
 */
export function attachmentExtensionFor(mimeType: string): string {
  // A clipboard MIME type can carry parameters after a ';', so trim the ends, lower-case, and cut from there onwards.
  // `split` always yields at least one part, but strict indexing does not know that, so the whole type
  // stands in for a missing first part.
  const cleaned = mimeType.trim().toLowerCase().split(';')[0] ?? mimeType.trim().toLowerCase();
  // Return the mapped extension when K-Doc writes this type; '' means it does not and the paste is left to text handling.
  return IMAGE_EXTENSIONS[cleaned] ?? '';
}

/**
 * Builds the Attachments facade from a Window, detecting whether the Tauri desktop backend is present so that writing throws and listing returns empty outside the app.
 *
 * @purpose Implements FR-6.14's host side: exposes write(), copy(), and names() backed by the desktop backend's attachment commands, or refusing to write when there is no disk.
 * @inputs win - The window object; inspected for Tauri internals to decide whether a disk exists to write attachments into.
 * @outputs Attachments - available plus write(folder, name, bytes), copy(folder, name, source), and names(folder).
 * @dataflow win -> available flag -> guard each method -> invoke('attachment_write' | 'attachment_copy' | 'attachment_names').
 * @controlflow Compute availability once, then return an object whose methods refuse to write or list empty when there is no desktop app, else forward the call to the backend.
 */
export function createAttachments(win: Window): Attachments {
  // Detect the desktop backend exactly as theme-files.ts does, so attachments behave identically outside the app.
  const available = '__TAURI_INTERNALS__' in (win as unknown as Record<string, unknown>);

  return {
    /** True in the desktop app, where there is a disk to write to. */
    available,
    /**
     * Writes bytes into the folder under a free name derived from `name`, resolving to the name actually used.
     *
     * @purpose Implements write(): hands raw bytes to the desktop backend, which stores them and returns the final file name.
     * @inputs folder - The attachments folder to write into. name - A suggested base name; the backend derives a free one. bytes - The file's raw bytes.
     * @outputs Promise<string> - The name actually used for the stored file.
     * @dataflow folder + name + Array.from(bytes) -> invoke('attachment_write') -> stored file name string.
     * @controlflow Refuse when there is no desktop app, else forward the bytes as a JSON number array and return the backend's chosen name.
     */
    async write(folder: string, name: string, bytes: Uint8Array): Promise<string> {
      // Check whether the desktop app is present to hold a disk to write into.
      if (!available) {
        // Branch: No Tauri environment; there is no disk, so refuse rather than silently drop the attachment.
        throw new Error('Adding attachments requires the desktop app.');
      } else {
        // Branch: The desktop app is present; proceed to write the bytes below.
      }

      // The IPC boundary carries a JSON number array, since a Uint8Array does not survive a JSON round-trip intact.
      return await invoke<string>('attachment_write', { folder, name, data: Array.from(bytes) });
    },
    /**
     * Copies an existing file into the folder under a free name derived from `name`, resolving to the name actually used.
     *
     * @purpose Implements copy(): duplicates a file that already exists on disk into the attachments folder, returning the new name.
     * @inputs folder - The attachments folder to copy into. name - A suggested base name; the backend derives a free one. source - The path of the existing file to copy.
     * @outputs Promise<string> - The name actually used for the copied file.
     * @dataflow folder + name + source -> invoke('attachment_copy') -> copied file name string.
     * @controlflow Refuse when there is no desktop app, else forward the source path and return the backend's chosen name.
     */
    async copy(folder: string, name: string, source: string): Promise<string> {
      // Check whether the desktop app is present to hold a disk to write into.
      if (!available) {
        // Branch: No Tauri environment; there is no disk, so refuse rather than silently drop the attachment.
        throw new Error('Adding attachments requires the desktop app.');
      } else {
        // Branch: The desktop app is present; proceed to copy the file below.
      }

      return await invoke<string>('attachment_copy', { folder, name, source });
    },
    /**
     * Returns the file names the folder holds, empty when there is no such folder.
     *
     * @purpose Implements names(): lists what the desktop backend has stored in an attachments folder.
     * @inputs folder - The attachments folder to list.
     * @outputs Promise<readonly string[]> - The stored file names, or an empty list when unavailable or absent.
     * @dataflow folder -> invoke('attachment_names') -> name list; unavailable -> empty list.
     * @controlflow Return an empty list when there is no desktop app (a report with nothing in it is truer than a failure), else forward the call and return the names.
     */
    async names(folder: string): Promise<readonly string[]> {
      // Check whether the desktop app is present to hold a folder to list.
      if (!available) {
        // Branch: No Tauri environment; report an empty folder rather than failing, since a note with no attachments should read as empty.
        return [];
      } else {
        // Branch: The desktop app is present; proceed to list the folder below.
      }

      return await invoke<string[]>('attachment_names', { folder });
    },
  };
}

/**
 * Resolves the absolute folder an attachment is written into, so that moving a note and its attachments together keeps the reference working.
 *
 * @purpose Implements attachmentsFolderPath(): turns the reader's folder setting into an absolute path anchored to the document's own folder.
 * @inputs documentPath - The saved note's path; anchors a relative setting to its directory. folderSetting - The reader's configured attachment folder, empty for the default.
 * @outputs string - The absolute folder attachments are written into, or '' when the note has not been saved.
 * @dataflow documentPath -> dirname -> base; folderSetting -> trimmed setting (or default) -> joined to base unless already absolute.
 * @controlflow Refuse an unsaved document with '', else use a relative setting resolved against the document's folder and an absolute setting as written.
 */
export function attachmentsFolderPath(documentPath: string, folderSetting: string): string {
  // Check whether the note has been saved at all; an unsaved document has no folder to hang attachments off.
  if (documentPath.trim() === '') {
    // Branch: No saved path; there is nothing to resolve against, so report no folder.
    return '';
  } else {
    // Branch: The note has a path; continue resolving the attachment folder below.
  }

  // An empty setting falls back to the default folder; anything else is used trimmed.
  const folder = folderSetting.trim() === '' ? DEFAULT_ATTACHMENTS_FOLDER : folderSetting.trim();

  const base = dirname(documentPath);

  // Check whether the reader named an absolute attachments folder (a POSIX root or a Windows drive).
  if (folder.startsWith('/') || /^[A-Za-z]:[\\/]/.test(folder)) {
    // Branch: An absolute folder is used as written, so one shared folder works for every note regardless of where it lives.
    return folder;
  } else {
    // Branch: A relative setting resolves against the document's own folder, keeping them together when both are moved.
    return joinPath(base, folder.split('\\').join('/'));
  }
}

/**
 * Names an attachment relative to the note, so the file travels with it wherever the document is moved.
 *
 * @purpose Implements attachmentReference(): produces the path a document stores for an attachment, relative to the note unless the folder is absolute.
 * @inputs folderSetting - The reader's configured attachment folder, empty for the default. fileName - The stored file name to reference.
 * @outputs string - The document-side reference: a relative path from the note, or an absolute path when the folder is absolute.
 * @dataflow folderSetting -> trimmed setting (or default) -> cleaned relative prefix joined to fileName, or the absolute folder joined to fileName.
 * @controlflow Use an absolute setting as the root of an absolute reference; otherwise strip a leading './' and trailing slashes and join the cleaned folder to the file name, naming it directly when the folder is the note's own.
 */
export function attachmentReference(folderSetting: string, fileName: string): string {
  // An empty setting falls back to the default folder; anything else is used trimmed.
  const folder = folderSetting.trim() === '' ? DEFAULT_ATTACHMENTS_FOLDER : folderSetting.trim();

  // Check whether the reader named an absolute attachments folder (a POSIX root or a Windows drive).
  if (folder.startsWith('/') || /^[A-Za-z]:[\\/]/.test(folder)) {
    // Branch: An absolute folder cannot be named relatively, so join it to the file name with a forward slash as an absolute reference.
    return `${folder}/${fileName}`;
  } else {
    // Branch: A relative setting is written against the note so the file travels with it.
    const cleaned = folder.split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '');

    // Check whether the cleaned folder collapses to nothing (the current directory), leaving just the file name.
    if (cleaned === '' || cleaned === '.') {
      // Branch: The note's own folder; name the file directly with no prefix.
      return fileName;
    } else {
      // Branch: A named relative folder precedes the file name in the reference.
      return `${cleaned}/${fileName}`;
    }
  }
}

/**
 * Reports whether a path already sits inside the attachments folder, in which case a drop has nothing to copy.
 *
 * @purpose Implements isInsideFolder(): decides if a file is already within the configured attachments directory so a re-drop need not duplicate it.
 * @inputs filePath - The candidate file path. folderPath - The attachments folder to test against.
 * @outputs boolean - True when filePath lies inside folderPath, false otherwise or when no folder is named.
 * @dataflow filePath + folderPath -> normalise both (backslashes to slashes, lowercased) -> compare filePath against the folder prefix.
 * @controlflow Refuse an unnamed folder as false, else build a trailing-slash-stripped folder prefix and test whether the file path begins with it.
 */
export function isInsideFolder(filePath: string, folderPath: string): boolean {
  // Check whether a folder was named at all; with none there is nothing for a path to sit inside.
  if (folderPath.trim() === '') {
    // Branch: No attachments folder configured; no path can be inside it.
    return false;
  } else {
    // Branch: A folder exists; compare the two normalised paths below.
  }

  const file = filePath.replace(/\\/g, '/').toLowerCase();
  const folder = folderPath.replace(/\\/g, '/').toLowerCase();

  // Check whether the folder already ends with a separator that would otherwise create a double slash in the prefix.
  const trimmedFolder = folder.endsWith('/') ? folder.slice(0, -1) : folder;
  const prefix = trimmedFolder + '/';

  // Check whether the normalised file path begins with the folder prefix.
  return file.startsWith(prefix);
}
