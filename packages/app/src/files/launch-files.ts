/**
 * @file launch-files.ts
 * @purpose Opens files handed off by the OS (a double-clicked Markdown file, or the Windows "Default apps" shortcut) inside K-Doc, using Tauri's host commands in desktop builds and no-ops in browser builds.
 * @inputs A Window global that is either the Tauri webview host or a plain browser window, plus any paths the OS has queued for opening.
 * @outputs A LaunchFiles capability (desktop vs browser) and an async routine that opens each waiting path in order.
 * @functions tauriLaunchFiles: Builds a LaunchFiles bound to Tauri's Rust launch commands.
 *   - browserLaunchFiles: Builds a LaunchFiles that never opens files and blocks the settings shortcut.
 *   - defaultLaunchFiles: Selects the desktop or browser capability based on Tauri presence.
 *   - openLaunchFiles: Drains queued paths through an opener, one at a time, returning how many were opened.
 * @dataflow OS/host → invoke('take_launch_paths') or 'kdoc://launch-paths' event → path list → per-path open() dispatch.
 * @controlflow Detect Tauri presence once to pick the capability; take() pulls and clears queued paths; openLaunchFiles iterates them sequentially.
 * @version 1
 * @date 2026-10-13
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Event name the Tauri host broadcasts whenever new paths are queued to open. */
export const LAUNCH_EVENT = 'kdoc://launch-paths';

export interface LaunchFiles {
  /** Takes (and clears) the paths waiting to be opened. */
  take(): Promise<readonly string[]>;
  /** Calls handler whenever more paths are waiting; resolves to an unsubscribe function. */
  onRequest(handler: () => void): Promise<() => void>;
  /** Opens Windows Settings at K-Doc's Default apps page. */
  openDefaultAppsSettings(): Promise<void>;
}

/**
 * tauriLaunchFiles builds a LaunchFiles bound to Tauri's Rust launch commands.
 * @purpose Returns a capability that reads queued paths via invoke and listens for the host launch event inside a webview.
 * @inputs None; relies on the global Tauri internals marker being present (see defaultLaunchFiles).
 * @outputs A LaunchFiles whose methods dispatch to 'take_launch_paths', the kdoc://launch-paths event, and 'open_default_apps_settings'.
 * @dataflow No inputs → closure over invoke/listen → returned capability methods resolve host commands.
 * @controlflow Construct and return the desktop capability object without branching further here.
 */
export function tauriLaunchFiles(): LaunchFiles {
  return {
    /**
     * take pulls the OS-queued paths from the Tauri host and clears them.
     * @purpose Invokes the Rust 'take_launch_paths' command and validates its shape before returning.
     * @inputs None.
     * @outputs Resolves to the list of file paths the host queued; rejects with an Error if the payload is not a flat string array.
     * @dataflow invoke('take_launch_paths') → unknown value → shape validation → narrowed string[] return.
     * @controlflow Await the command; guard against non-array or non-string payloads by throwing, else return the list.
     */
    async take(): Promise<readonly string[]> {
      // Ask the host for any paths queued to open and await its untyped reply.
      const paths = await invoke<unknown>('take_launch_paths');
      // Guard: reject anything that is not a flat array of strings so malformed host responses fail loudly instead of iterating garbage.
      if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === 'string')) {
        // Invalid payload: surface a clear error rather than letting callers consume non-string entries.
        throw new Error('The desktop host returned an unexpected list of files to open.');
      }
      // Valid payload confirmed by the guard above; return the narrowed string list to the caller.
      return paths;
    },
    /**
     * onRequest registers a callback for future launch events and returns its unsubscribe function.
     * @purpose Subscribes to the host 'kdoc://launch-paths' event, invoking handler on each broadcast.
     * @inputs handler - Invoked with no arguments whenever the host queues new paths.
     * @outputs Resolves to the Tauri UnlistenFn that stops future notifications.
     * @dataflow handler → wrapped listener closure → listen() subscription → returned unlisten function.
     * @controlflow Register the listener and return whatever listen() resolves to (the unsubscribe fn).
     */
    async onRequest(handler: () => void): Promise<() => void> {
      // Subscribe to the host event; the wrapper forwards each broadcast to the caller's handler.
      return listen(LAUNCH_EVENT, () => {
        handler();
      });
    },
    /**
     * openDefaultAppsSettings opens Windows Settings at K-Doc's Default apps page.
     * @purpose Delegates to the Rust 'open_default_apps_settings' command so the user can change the Markdown file association.
     * @inputs None.
     * @outputs Resolves once the host has opened the settings page; rejects if the command fails.
     * @dataflow invoke('open_default_apps_settings') → resolved void.
     * @controlflow Await the command and let any rejection propagate to the caller.
     */
    async openDefaultAppsSettings(): Promise<void> {
      // Delegate the settings launch to the Rust command, discarding its (void) return value.
      await invoke('open_default_apps_settings');
    },
  };
}

/**
 * browserLaunchFiles builds a LaunchFiles that never opens files inside a plain browser tab.
 * @purpose Returns a no-op capability so browser builds compile against the same interface without host commands.
 * @inputs None.
 * @outputs A LaunchFiles whose take() yields an empty list, onRequest() is unsubscribable immediately, and openDefaultAppsSettings() rejects.
 * @dataflow No inputs → static no-op implementations → returned capability methods.
 * @controlflow Construct and return the browser capability object without any host interaction.
 */
export function browserLaunchFiles(): LaunchFiles {
  return {
    /**
     * take resolves an empty list because nothing outside a browser tab can queue files to open.
     * @purpose Provides the browser-compatible contract of returning no waiting paths.
     * @inputs None.
     * @outputs Resolves to an empty readonly string array.
     * @dataflow No source → literal empty array returned.
     * @controlflow Resolve immediately with an empty list; no branching required.
     */
    async take(): Promise<readonly string[]> {
      return [];
    },
    /**
     * onRequest resolves to a no-op unsubscribe because the browser cannot receive host launch events.
     * @purpose Satisfies the interface without subscribing to anything.
     * @inputs handler - Ignored; never invoked in a browser build.
     * @outputs Resolves to a function that does nothing when called.
     * @dataflow No source → static no-op closure returned.
     * @controlflow Resolve immediately with a no-op function; listen() is intentionally never called.
     */
    async onRequest(): Promise<() => void> {
      return () => {};
    },
    /**
     * openDefaultAppsSettings rejects because the Markdown default-app setting lives in Windows, not the browser.
     * @purpose Fails fast with a descriptive error guiding users to the desktop app.
     * @inputs None.
     * @outputs Rejects with an Error explaining the action is desktop-only.
     * @dataflow No source → thrown Error propagates to the caller.
     * @controlflow Throw immediately; there is no host command to delegate to in a browser build.
     */
    async openDefaultAppsSettings(): Promise<void> {
      // The default-app chooser is a Windows feature unavailable inside a webview, so refuse with a clear error.
      throw new Error('Choosing the default app for Markdown files is only available in the desktop app.');
    },
  };
}

/**
 * defaultLaunchFiles selects the desktop or browser LaunchFiles capability based on Tauri presence.
 * @purpose Chooses the host-backed implementation when running inside a webview, otherwise the no-op browser one.
 * @inputs None; probes the ambient Window global for the Tauri internals marker (see createExternalOpener precedent).
 * @outputs A LaunchFiles bound to either Tauri commands or browser no-ops.
 * @dataflow window marker check → capability factory selection → returned capability.
 * @controlflow Branch once on '__TAURI_INTERNALS__' presence; construct and return the matching capability.
 */
export function defaultLaunchFiles(): LaunchFiles {
  // Prefer the desktop capability only when running inside a Tauri webview host, else fall back to browser no-ops.
  if ('__TAURI_INTERNALS__' in window) {
    // Desktop build: use the host-backed capability that can read queued paths and open settings.
    return tauriLaunchFiles();
  } else {
    // Browser build: use the no-op capability since no OS handler or default-app setting is reachable.
    return browserLaunchFiles();
  }
}

/**
 * openLaunchFiles drains a LaunchFiles' queued paths through an opener, one at a time.
 * @purpose Opens every waiting path in order so the last file asked for ends up in front, returning how many were opened.
 * @inputs source - The capability whose queued paths should be opened; open - Invoked with each path and awaited before the next.
 * @outputs Resolves to the number of paths that were handed to open().
 * @dataflow source.take() → ordered path list → sequential open(path) dispatch → count return.
 * @controlflow Take all queued paths once, then loop awaiting each open() before proceeding; return the total count.
 */
export async function openLaunchFiles(
  source: LaunchFiles,
  open: (path: string) => Promise<void>,
): Promise<number> {
  // Pull and clear every path the host has queued to open in a single call.
  const paths = await source.take();
  // Open each waiting file sequentially so later files are asked for only after earlier ones resolve.
  for (const path of paths) {
    // Await this file's launch before requesting the next, guaranteeing ordered, non-overlapping opens.
    await open(path);
  }
  // Report how many paths were handed to the opener; zero when nothing was queued.
  return paths.length;
}
