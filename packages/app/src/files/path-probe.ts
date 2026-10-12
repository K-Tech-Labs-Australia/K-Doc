/**
 * @file path-probe.ts
 * @purpose Asks the Rust host whether a list of absolute paths are existing files, for the document linter's missing-image rule (FR-12.7).
 * @inputs A Window instance that is either the Tauri webview host or a plain browser window.
 * @outputs A PathProbe exposing availability and an async exist() method resolving one boolean per path.
 * @functions createPathProbe: Builds a PathProbe bound to the given window; exist: Queries the host for file existence across many paths at once.
 * @dataflow Provided Window → capability detection → invoke('paths_exist') dispatch → resolved Promise<boolean[]>.
 * @controlflow Detect Tauri presence once at construction; on exist(), branch by availability, validate the host's reply shape, and resolve or reject accordingly.
 * @version 1
 * @date 2026-09-14
 */

import { invoke } from '@tauri-apps/api/core';

export interface PathProbe {
  /** True inside the desktop app, where the host can answer. */
  readonly available: boolean;
  /** Resolves one boolean per path, in order: whether that absolute path is an existing file. */
  exist(paths: readonly string[]): Promise<readonly boolean[]>;
}

/**
 * createPathProbe builds a PathProbe bound to a specific Window instance.
 * @purpose Detects whether the window is a Tauri webview host and returns a probe that dispatches accordingly.
 * @inputs win - The Window to probe for Tauri internals; drives capability detection for the returned probe.
 * @outputs A PathProbe whose exist() resolves with per-path booleans when running in the desktop app, or rejects otherwise.
 * @dataflow Provided Window → '__TAURI_INTERNALS__' check → stored availability flag → returned probe closure.
 * @controlflow Evaluate Tauri presence once; construct and return the probe object without branching further here.
 */
export function createPathProbe(win: Window): PathProbe {
  // The Tauri runtime announces itself with this global on the webview host window.
  const available = '__TAURI_INTERNALS__' in win;

  return {
    available,
    /**
     * exist queries the Rust host for file existence across many paths at once.
     * @purpose Resolves one boolean per input path, in order, reporting whether each absolute path is an existing file.
     * @inputs paths - The list of absolute filesystem paths to probe; forwarded verbatim to the 'paths_exist' command.
     * @outputs Resolves with a same-length array of booleans when the host answers; rejects with a descriptive Error on failure.
     * @dataflow paths → branch by availability → invoke('paths_exist') → shape validation → resolved boolean[] (as readonly).
     * @controlflow If empty, resolve immediately; if Tauri is unavailable, reject; else await the command, normalize throws to Error, validate the reply shape, and return.
     */
    async exist(paths: readonly string[]): Promise<readonly boolean[]> {
      // Nothing to ask when there are no paths, so short-circuit with an empty result.
      if (paths.length === 0) {
        return [];
      } else {
        // At least one path remains; continue to the host-backed query below.
      }

      // Only the desktop app can answer file-existence questions from the Rust host.
      if (!available) {
        throw new Error('Checking files requires the desktop app.');
      } else {
        // Tauri is present; proceed to invoke the backing command.
      }

      let result: unknown;
      try {
        // Delegate the actual existence check to the Rust 'paths_exist' command, spreading paths so the host receives a fresh array.
        result = await invoke<unknown>('paths_exist', { paths: [...paths] });
      } catch (caught) {
        // Tauri rejects commands with a plain string message; normalize any throw into an Error carrying that message.
        let message: string;
        // Tauri usually rejects with a bare string, which String() returns unchanged, so only an Error needs unwrapping.
        if (caught instanceof Error) {
          // A thrown Error exposes its human-readable text on the .message property.
          message = caught.message;
        } else {
          // Any other throw type is coerced to a string so callers still get a readable message.
          message = String(caught);
        }
        // Re-throw as an Error so callers receive a consistent, inspectable failure object rather than an unknown value.
        throw new Error(message);
      }

      // Guard against a malformed host reply: it must be a boolean array of exactly the same length as the request.
      if (
        !Array.isArray(result) ||
        result.length !== paths.length ||
        !result.every((v: unknown): boolean => typeof v === 'boolean')
      ) {
        throw new Error(
          'The desktop app gave an unexpected answer about which files exist.',
        );
      } else {
        // The reply is a well-formed boolean array; hand it back to the caller.
      }

      // The shape has been validated as boolean[], so the cast is safe for the declared return type.
      return result as readonly boolean[];
    },
  };
}
