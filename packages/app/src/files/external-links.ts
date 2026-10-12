/**
 * @file external-links.ts
 * @purpose Opens web or mailto URLs in the OS default handler inside a Tauri desktop app, falling back to window.open in browser builds.
 * @inputs A Window instance that is either the Tauri webview host or a plain browser window.
 * @outputs An ExternalOpener exposing availability and an async open() method.
 * @functions createExternalOpener: Builds an ExternalOpener bound to the given window.
 * @dataflow Provided Window → capability detection → invoke/win.open dispatch → resolved Promise<void>.
 * @controlflow Detect Tauri presence once at construction; on open(), branch by availability and resolve or reject accordingly.
 * @version 1
 * @date 2026-09-13
 */

import { invoke } from '@tauri-apps/api/core';

export interface ExternalOpener {
  /** True inside the desktop app, where links go to the OS handler rather than a new webview window. */
  readonly available: boolean;
  /** Opens the URL; rejects with an Error carrying the host's message when the host refuses or fails. */
  open(url: string): Promise<void>;
}

/**
 * createExternalOpener builds an ExternalOpener bound to a specific Window instance.
 * @purpose Detects whether the window is a Tauri webview host and returns an opener that dispatches accordingly.
 * @inputs win - The Window to probe for Tauri internals; drives capability detection and browser fallback.
 * @outputs An ExternalOpener whose open() resolves when the URL launch succeeds or rejects on failure.
 * @dataflow Provided Window → '__TAURI_INTERNALS__' check → stored availability flag → returned opener closure.
 * @controlflow Evaluate Tauri presence once; construct and return the opener object without branching further here.
 */
export function createExternalOpener(win: Window): ExternalOpener {
  // Detect a Tauri webview host by the presence of its internal marker on the window global.
  const available = '__TAURI_INTERNALS__' in win;

  return {
    available,
    /**
     * open launches the URL using whichever handler the host supports.
     * @purpose Opens url via Tauri's Rust command when available, otherwise via window.open in browsers.
     * @inputs url - The web or mailto: URL to launch; forwarded verbatim to the chosen handler.
     * @outputs Resolves once the OS/browser has been asked to open the URL; rejects with a descriptive Error on failure.
     * @dataflow url → branch on availability → invoke/win.open call → resolve or rethrow as Error.
     * @controlflow If Tauri is available, await the command and map any throw to an Error; else window.open and resolve.
     */
    async open(url: string): Promise<void> {
      // Use the desktop path only when running inside a Tauri webview host.
      if (available) {
        try {
          // Delegate the actual launch to the Rust 'open_external_url' command, discarding its return value.
          await invoke<unknown>('open_external_url', { url });
        } catch (caught) {
          // Tauri rejects commands with a plain string message; normalize any throw into an Error carrying that message.
          const message =
            typeof caught === 'string'
              ? caught
              : caught instanceof Error
                ? caught.message
                : String(caught);
          // Re-throw as an Error so callers receive a consistent, inspectable failure object rather than an unknown value.
          throw new Error(message);
        }
      } else {
        // Browser build: open in a new tab; 'noopener' forces the return value to null even on success, so it is intentionally not checked.
        win.open(url, '_blank', 'noopener,noreferrer');
      }
    },
  };
}
