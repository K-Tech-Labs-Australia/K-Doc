/**
 * @file user-guide.ts
 * @purpose Locates the K-Doc user guide bundled with the desktop install, exposing a path accessor for host builds alongside a browser fallback URL and a Tauri-presence probe shared by other modules.
 * @inputs A Window global that is either the Tauri webview host or a plain browser window; the Rust 'user_guide_path' command issued on the desktop host.
 * @outputs The installed guide's absolute path (desktop builds), an ONLINE_GUIDE_URL constant for browsers, and a boolean flag reporting whether K-Doc runs inside a Tauri webview.
 * @functions installedGuidePath: Invokes the Rust user_guide_path command and validates its reply before returning it.
 *   - hasInstalledGuide: Reports whether the ambient window carries the Tauri internals marker.
 * @dataflow Host 'user_guide_path' command → unknown value → string validation → guide path; window marker check → boolean capability flag.
 * @controlflow installedGuidePath awaits the host command and guards its shape before returning; hasInstalledProbe branches on '__TAURI_INTERNALS__' presence to select desktop vs browser behavior.
 * @version 1
 * @date 2026-10-15
 */

import { invoke } from '@tauri-apps/api/core';

/** Where the guide is published, for the browser build, which has no installed copy. */
export const ONLINE_GUIDE_URL = 'https://github.com/K-Tech-Labs-Australia/K-Doc/blob/master/docs/guide/index.md';

/**
 * installedGuidePath returns the on-disk location of the bundled user guide in desktop builds.
 * @purpose Invokes the Rust 'user_guide_path' command and validates its reply so callers receive a usable absolute path or a clear failure.
 * @inputs None; relies on the Tauri host exposing the 'user_guide_path' command inside a webview.
 * @outputs Resolves to the guide's absolute file path; rejects with an Error if the host payload is not a non-empty string, and propagates any host-side rejection unchanged.
 * @dataflow invoke('user_guide_path') → unknown value → shape validation → narrowed string return (or thrown error).
 * @controlflow Await the command; guard against missing or wrongly-typed payloads by throwing, else return the confirmed path.
 */
export async function installedGuidePath(): Promise<string> {
  // Ask the host for the on-disk location of the bundled guide and await its untyped reply.
  const path = await invoke<unknown>('user_guide_path');
  // Guard: reject anything that is not a non-empty string so malformed or absent host responses fail loudly instead of returning an unusable path.
  if (typeof path !== 'string' || path.length === 0) {
    // Invalid payload: surface a clear error rather than letting callers consume a missing or wrongly-typed location.
    throw new Error('The desktop host returned an unexpected location for the user guide.');
  } else {
    // Valid non-empty string confirmed by the guard above; hand the path back to the caller.
    return path;
  }
}

/**
 * hasInstalledGuide reports whether K-Doc runs inside a Tauri webview where the guide is installed.
 * @purpose Probes the ambient Window global for the Tauri internals marker so callers can choose between the installed copy and the online fallback.
 * @inputs None; reads the ambient window's '__TAURI_INTERNALS__' marker (see launch-files defaultLaunchFiles precedent).
 * @outputs Resolves to true inside a webview build, false in plain browser builds where no guide is installed.
 * @dataflow window marker check → boolean capability flag returned directly.
 * @controlflow Branch once on '__TAURI_INTERNALS__' presence; return true for desktop and false for the browser fallback.
 */
export function hasInstalledGuide(): boolean {
  // Prefer the installed copy only when running inside a Tauri webview host, else report absence for plain browser builds.
  if ('__TAURI_INTERNALS__' in window) {
    // Desktop build: the guide ships with the install and its folder is reachable from these functions.
    return true;
  } else {
    // Browser build: no copy is installed, so callers should fall back to ONLINE_GUIDE_URL instead.
    return false;
  }
}
