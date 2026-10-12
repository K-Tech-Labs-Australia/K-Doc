/**
 * @file media-loader.ts
 * @purpose Loads local audio/video files through the Tauri Rust host so the webview can play them via object URLs (FR-8.17).
 * @inputs A Window instance that is either the Tauri webview host or a plain browser window; absolute filesystem paths to media files.
 * @outputs A MediaLoader exposing availability and an object URL for playback, served only as blob URLs never data URIs because a 64 MiB clip encoded base64 would be pointless.
 * @functions
 *   - mediaMimeForPath: Maps an absolute path's extension to its MIME type, or null when unrecognized.
 *   - createMediaLoader: Builds a MediaLoader bound to the given window; objectUrl reads through the host and serves a blob URL.
 *   - objectUrl: Returns a fresh blob object URL for playback, reading bytes through the Rust host on each call.
 * @dataflow Provided Window → capability detection → invoke('read_media_file') → Uint8Array → Blob/object URL.
 * @controlflow Detect Tauri once; branch by availability and MIME validity, normalize host replies to Error, validate byte shape, and serve a new object URL per path without caching.
 * @version 1
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';

export interface MediaLoader {
  /** True in the desktop app, where the host can read a file. */
  readonly available: boolean;
  /** An object URL the webview can play, for an absolute path on disk. */
  objectUrl(path: string): Promise<string>;
}

// Extension → MIME map mirrored from the host's list in media.rs; the type decides whether the webview will play a Blob.
const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/**
 * mediaMimeForPath maps an absolute path to its MIME type.
 * @purpose Extracts the file extension from the final path segment and returns its mapped MIME type, or null when unrecognized.
 * @inputs path - The absolute filesystem path whose extension should be resolved; mirrors the host's list in media.rs.
 * @outputs The MIME type string for a recognized media extension (mp4, m4v, webm, ogv, mov, mp3, m4a, wav, ogg, oga, flac, aac), or null otherwise.
 * @dataflow path → final-segment extraction → lower-cased extension → MEDIA_MIME_TYPES guarded lookup → resolved MIME string or null.
 * @controlflow Locate the last separator then dot within the filename; if absent return null; else guard-lookup the extension and return it or null on miss.
 */
export function mediaMimeForPath(path: string): string | null {
  // The extension lives only in the final path segment, so ignore any directory portion before the last separator.
  const lastSep = Math.max(
    path.lastIndexOf('/'),
    path.lastIndexOf('\\'),
  );

  // Restrict dot search to the filename after the separator; a dot earlier belongs to a directory name.
  const filename = lastSep >= 0 ? path.slice(lastSep + 1) : path;

  // No dot in the final segment means there is no extension to resolve.
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) {
    // The filename has no extension, so there is no MIME type to map.
    return null;
  } else {
    // An extension was found; normalize and look it up below.
  }

  const ext = filename.slice(lastDot + 1).toLowerCase();

  // Guarded lookup: strict indexing types a record read as possibly undefined, so the result is checked rather than asserted.
  const mime = MEDIA_MIME_TYPES[ext];
  if (mime === undefined) {
    // No mapping exists for this extension, so report no media type.
    return null;
  } else {
    // The lower-cased extension is a recognised media type; return its mapped MIME string.
    return mime;
  }
}

/**
 * createMediaLoader builds a MediaLoader bound to a specific Window instance.
 * @purpose Detects Tauri presence and returns helpers that read local media through the Rust host as playable blob URLs only.
 * @inputs win - The Window to probe for Tauri internals; drives availability detection for every returned method.
 * @outputs A MediaLoader whose objectUrl() serves a fresh blob URL per path, reading bytes through the host on each call.
 * @dataflow Provided Window → '__TAURI_INTERNALS__' check → capability flag → closure over invoke → returned MediaLoader.
 * @controlflow Detect Tauri once; return an object whose single method branches by availability and MIME validity before serving a blob URL.
 */
export function createMediaLoader(win: Window): MediaLoader {
  // The Tauri runtime announces itself with this global on the webview host window; cast to probe it without widening win's type.
  const available = '__TAURI_INTERNALS__' in (win as unknown as Record<string, unknown>);

  return {
    available,
    /**
     * objectUrl serves a blob URL for playback of the media at an absolute path.
     * @purpose Reads the file through Tauri and returns a fresh object URL with the resolved MIME type; never caches because each call re-reads from disk.
     * @inputs path - The absolute filesystem path to play; forwarded verbatim to the 'read_media_file' command after validation.
     * @outputs Resolves with an `blob:` URL the webview can assign to a media element; rejects with an Error if Tauri is absent, the type is unknown, or the host reply shape is unexpected.
     * @dataflow path → branch by availability and MIME validity → invoke('read_media_file') → byte-shape normalization → Blob/object URL.
     * @controlflow Reject when unavailable; throw for unrecognized extensions; await the command normalizing throws to Error; return ArrayBuffer/TypedArray/number-array variants, else throw before building the blob.
     */
    async objectUrl(path: string): Promise<string> {
      // Only the desktop app can read files from the Rust host; reject early in a browser so no invoke is attempted.
      if (!available) {
        throw new Error('Playing a local file requires the desktop app.');
      } else {
        // Tauri is present; proceed to validate and read below.
      }

      const mime = mediaMimeForPath(path);
      // The path must resolve to a recognized media type before it can be played, so fail fast on unknown extensions.
      if (mime === null) {
        throw new Error(`K-Doc does not play ${path}`);
      } else {
        // A known MIME type was resolved; fall through to read the bytes below.
      }

      const payload: unknown = await invoke('read_media_file', { path });

      // Normalize whatever shape the IPC layer delivered into a Uint8Array, mirroring image-loader's byte handling exactly.
      let bytes: Uint8Array;
      if (payload instanceof ArrayBuffer) {
        // A raw ArrayBuffer is the common Tauri delivery; wrap it directly in a typed view.
        bytes = new Uint8Array(payload);
      } else if (ArrayBuffer.isView(payload)) {
        // A TypedArray or DataView wraps an underlying buffer with its own offset and length, so preserve both.
        bytes = new Uint8Array(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        );
      } else if (
        Array.isArray(payload) &&
        payload.every((b: unknown): boolean => typeof b === 'number')
      ) {
        // An older IPC layer can deliver bytes as a number array rather than a buffer.
        bytes = Uint8Array.from(payload as number[]);
      } else {
        // None of the expected byte shapes matched, so treat the reply as a host failure.
        throw new Error(
          'The desktop app gave an unexpected answer when reading media.',
        );
      }

      // slice() copies into a plain ArrayBuffer, which is what a Blob part must be backed by.
      return URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
    },
  };
}
