/**
 * @file image-loader.ts
 * @purpose Loads local image files through the Tauri Rust host so the WYSIWYG pane can display them (FR-8.14) and HTML export can embed them as data URIs (FR-13.1).
 * @inputs A Window instance that is either the Tauri webview host or a plain browser window; absolute filesystem paths to image files.
 * @outputs An ImageLoader exposing availability, cached object URLs for display, non-cached base64 data URIs for embedding, and a clear() to revoke them.
 * @functions
 *   - mimeForPath: Maps an absolute path's extension to its MIME type, or null when unrecognized.
 *   - bytesToBase64: Encodes raw image bytes into a base64 string in bounded chunks.
 *   - createImageLoader: Builds an ImageLoader bound to the given window; readBytes and mimeOrThrow are private helpers.
 *   - objectUrl: Returns a cached blob object URL for display, reading through the host on first use.
 *   - dataUri: Returns a fresh base64 data URI for embedding in exported HTML.
 *   - clear: Revokes every issued object URL and empties the read cache.
 *   - readBytes: Private helper that fetches image bytes from the Rust host and normalizes their shape.
 *   - mimeOrThrow: Private helper that resolves an image MIME type or throws for non-images.
 * @dataflow Provided Window → capability detection → invoke('read_image_file') → Uint8Array → Blob/object URL or base64 data URI.
 * @controlflow Detect Tauri once; branch by availability on read, normalize host replies to Error, validate byte shape, and cache pending reads per path.
 * @version 1
 * @date 2026-09-14
 */

import { invoke } from '@tauri-apps/api/core';

export interface ImageLoader {
  /** True inside the desktop app, where the host can read files. */
  readonly available: boolean;
  /** An object URL for the image at an absolute path, cached per path until clear(). */
  objectUrl(path: string): Promise<string>;
  /** A data: URI for the image at an absolute path, for embedding in an exported file. Not cached. */
  dataUri(path: string): Promise<string>;
  /** Revokes every object URL handed out and forgets them, so a changed file is read again. */
  clear(): void;
}

// Extension → MIME map mirrored from the host's list in images.rs; an SVG needs its real type to draw.
const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  ['avif', 'image/avif'],
]);

// Spreading a whole multi-megabyte image into String.fromCharCode would overflow the engine's argument limit, so encode in fixed chunks.
const BASE64_CHUNK = 0x8000; // bytes per chunk, kept well under the call-argument cap

/**
 * mimeForPath maps an absolute image path to its MIME type.
 * @purpose Extracts the file extension from the final path segment and returns its mapped MIME type, or null when unrecognized.
 * @inputs path - The absolute filesystem path whose extension should be resolved; mirrors the host's list in images.rs.
 * @outputs The MIME type string for a recognized image extension (png, jpg, jpeg, gif, webp, svg, bmp, ico, avif), or null otherwise.
 * @dataflow path → final-segment extraction → lower-cased extension → IMAGE_MIME_TYPES lookup → resolved MIME string or null.
 * @controlflow Locate the last separator then dot within the filename; if absent return null; else map the extension and return it or null on miss.
 */
export function mimeForPath(path: string): string | null {
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
  const mime = IMAGE_MIME_TYPES.get(ext);
  if (mime !== undefined) {
    // The lower-cased extension is recognized, so return its mapped MIME type.
    return mime;
  } else {
    // The extension is unknown or absent of a known mapping, so report no image type.
    return null;
  }
}

/**
 * bytesToBase64 encodes raw image bytes as base64.
 * @purpose Assembles a binary string from the byte array in bounded chunks and encodes it for embedding in a data: URI.
 * @inputs bytes - The image bytes to encode; read from the host by readBytes before being passed here.
 * @outputs A base64-encoded string suitable for concatenation into a `data:<mime>;base64,...` URI.
 * @dataflow bytes → chunked String.fromCharCode assembly → btoa() → base64 string.
 * @controlflow Walk the array in BASE64_CHUNK steps, concatenate each chunk's characters, then encode once at the end.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  // Advance by fixed chunks so no single spread exceeds the engine's argument cap.
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    // Concatenate one chunk's characters at a time to stay within the call-argument limit.
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }

  // Encode the assembled binary string as base64 for embedding in an exported file.
  return btoa(binary);
}

/**
 * createImageLoader builds an ImageLoader bound to a specific Window instance.
 * @purpose Detects Tauri presence and returns helpers that read local images through the Rust host for display or embedding.
 * @inputs win - The Window to probe for Tauri internals; drives availability detection for every returned method.
 * @outputs An ImageLoader whose objectUrl() serves cached blob URLs, dataUri() serves fresh base64 URIs, and clear() revokes them.
 * @dataflow Provided Window → '__TAURI_INTERNALS__' check → capability flag → closures over cache/issued → returned ImageLoader.
 * @controlflow Detect Tauri once; define private readBytes/mimeOrThrow helpers; return an object whose methods branch by availability and cache reads per path.
 */
export function createImageLoader(win: Window): ImageLoader {
  // The Tauri runtime announces itself with this global on the webview host window.
  const available = '__TAURI_INTERNALS__' in win;

  // Cache of pending reads keyed by path so repeated lookups share a single fetch through the host.
  const cache = new Map<string, Promise<string>>();
  // Every object URL handed out, tracked so clear() can revoke them all at once.
  const issued: string[] = [];

  /**
   * readBytes fetches raw image bytes from the Rust host and normalizes their shape.
   * @purpose Reads an image file through Tauri and returns its contents as a Uint8Array regardless of how the IPC layer delivered it.
   * @inputs path - The absolute filesystem path to read; forwarded verbatim to the 'read_image_file' command.
   * @outputs Resolves with the image bytes as a Uint8Array; rejects with an Error if Tauri is absent or the host reply shape is unexpected.
   * @dataflow path → branch by availability → invoke('read_image_file') → byte-shape normalization → Uint8Array.
   * @controlflow Reject when unavailable; await the command normalizing throws to Error; return ArrayBuffer/TypedArray/number-array variants, else throw.
   */
  async function readBytes(path: string): Promise<Uint8Array> {
    // Only the desktop app can read files from the Rust host; reject early in a browser.
    if (!available) {
      throw new Error('Showing local images requires the desktop app.');
    } else {
      // Tauri is present; proceed to invoke the backing command below.
    }

    let result: unknown;
    try {
      // Delegate the actual file read to the Rust 'read_image_file' command, passing the absolute path.
      result = await invoke<unknown>('read_image_file', { path });
    } catch (caught) {
      // The host rejects with a plain string message, which String() preserves for unknown throw types.
      throw new Error(caught instanceof Error ? caught.message : String(caught));
    }

    // A raw ArrayBuffer is the common Tauri delivery; wrap it directly in a typed view.
    if (result instanceof ArrayBuffer) {
      return new Uint8Array(result);
    } else if (ArrayBuffer.isView(result)) {
      // A TypedArray or DataView wraps an underlying buffer with its own offset and length.
      return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
    } else if (
      Array.isArray(result) &&
      result.every((b: unknown): boolean => typeof b === 'number')
    ) {
      // An older IPC layer can deliver bytes as a number array rather than a buffer.
      return Uint8Array.from(result as number[]);
    } else {
      // None of the expected byte shapes matched, so treat the reply as a host failure.
      throw new Error(
        'The desktop app gave an unexpected answer when reading an image.',
      );
    }
  }

  /**
   * mimeOrThrow resolves an image MIME type or fails for non-images.
   * @purpose Wraps mimeForPath so callers get a guaranteed MIME string or a descriptive Error for unrecognized paths.
   * @inputs path - The absolute filesystem path whose extension should resolve to an image type.
   * @outputs The resolved MIME type string; rejects with an Error naming the path when it is not a recognized image.
   * @dataflow path → mimeForPath lookup → MIME string or null → throw-or-return decision.
   * @controlflow Look up the extension; if null throw a descriptive Error, else return the resolved MIME type.
   */
  function mimeOrThrow(path: string): string {
    const mime = mimeForPath(path);
    // The path must resolve to a recognized image type before it can be loaded or embedded.
    if (mime === null) {
      throw new Error(`${path} is not an image K-Doc can show.`);
    } else {
      // A known MIME type was resolved; fall through to return it.
    }
    return mime;
  }

  return {
    available,
    async objectUrl(path: string): Promise<string> {
      const cached = cache.get(path);
      // A prior call already started (or finished) a read for this path; reuse its promise.
      if (cached !== undefined) {
        return cached;
      } else {
        // No pending or completed read yet; build and cache a fresh one below.
      }

      const pending = (async (): Promise<string> => {
        const mime = mimeOrThrow(path);
        const bytes = await readBytes(path);
        // slice() copies into a plain ArrayBuffer, which is what a Blob part must be backed by.
        const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
        issued.push(url);
        return url;
      })();

      cache.set(path, pending);
      // A failed read is forgotten so it can be retried later, and this catch only clears the cache — the caller still receives the rejection.
      pending.catch((): void => {
        cache.delete(path);
      });

      return pending;
    },
    async dataUri(path: string): Promise<string> {
      // Resolve the MIME type and read bytes fresh each call, since embedding never needs caching.
      const mime = mimeOrThrow(path);
      const bytes = await readBytes(path);
      return `data:${mime};base64,${bytesToBase64(bytes)}`;
    },
    clear(): void {
      // Revoke every object URL previously handed out so the browser releases the backing blobs.
      for (const url of issued) {
        URL.revokeObjectURL(url);
      }
      // Forget the revoked URLs and drop all cached reads so a changed file is read again.
      issued.length = 0;
      cache.clear();
    },
  };
}
