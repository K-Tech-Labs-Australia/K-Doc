/**
 * @file theme-files.ts
 * @purpose Supplies both the stylesheet an export or printout is written with and the stylesheet the app itself wears — one K-Doc ships, or one the reader wrote (FR-13.8, FR-14.10). This module resolves which stylesheet applies for any chosen theme name across either kind, lists every selectable theme (shipped first, then the reader's), opens the reader's themes folder seeding it with a starter when empty, and watches that folder for changes.
 *   Why this exists:
 *   Exports, printouts, and the live app all render through a CSS stylesheet, but that stylesheet can come from two places: the themes K-Doc ships with, or a theme the reader authored in their own themes folder. This module resolves which stylesheet applies for any chosen theme name, lists every selectable theme (shipped first, then the reader's), opens the reader's themes folder — seeding it with a starter theme when empty — and reports changes to that folder as they happen.
 *   Known limitation:
 *   Outside the desktop app there is no reader's folder to read, so only the shipped themes are offered; editing requires the desktop app and throws otherwise.
 * @inputs A Window object used to detect whether the Tauri desktop backend is present, a ThemeKind selecting export or app stylesheets, the shipped stylesheet by name, and the fallback stylesheet for an unknown name.
 * @outputs ThemeFiles: a list of selectable theme names, the stylesheet for a chosen name, the path to the reader's themes folder, and a watch/unsubscribe pair.
 * @functions
 *   - createThemeFiles: Builds the ThemeFiles facade from a Window, detecting the desktop app once.
 *   - userNames: Returns the reader's own theme names for this kind, or an empty list when there is no readable folder.
 *   - names: Combines shipped and reader theme names, with the reader's replacing any shipped name of the same spelling.
 *   - css: Resolves a stylesheet for a name, preferring the reader's own over a shipped theme, then falling back to the default.
 *   - openFolder: Opens (and seeds) the reader's themes folder via the desktop backend, throwing outside the app.
 *   - watch: Subscribes to theme-file changes and returns an unsubscribe function.
 * @dataflow Window -> availability flag -> userNames()/invoke('theme_*') for reader themes and builtIn*() for shipped; names returns a merged list, css returns a stylesheet string, openFolder returns a folder path, watch returns an unsubscribe function.
 * @controlflow Detect Tauri once -> define userNames helper -> return methods that merge shipped + reader names, prefer the reader's stylesheet with default fallback, seed/open the folder only when the app is present, and subscribe to theme changes.
 * @version 1
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Which set of stylesheets: the ones an export is written with, or the ones the app wears. */
export type ThemeKind = 'export' | 'app';

/** The event Rust sends when a theme file in the watched folder changes. */
export const THEME_CHANGED_EVENT = 'kdoc://theme-changed';

export interface ThemeFiles {
  /** Every theme that can be chosen: the ones K-Doc ships, then the reader's own. */
  names(): Promise<readonly string[]>;
  /** The stylesheet a theme is. The reader's own wins over one of the same name K-Doc ships; a name for neither gives the fallback. */
  css(name: string): Promise<string>;
  /** The folder the reader's themes live in, with a starter written into it when it holds none. Returns the folder. */
  openFolder(starter: string): Promise<string>;
  /** Calls back whenever a theme file changes, until the returned function is called (FR-14.10). */
  watch(onChanged: () => void): Promise<() => void>;
}

/**
 * Builds the ThemeFiles facade from a Window, detecting whether the Tauri desktop backend is present so that only shipped themes are offered outside the app.
 *
 * @purpose Implements FR-13.8 and FR-14.10: resolves stylesheets for both export and app kinds from the themes K-Doc ships and any the reader wrote, lists selectable names, opens (and seeds) the reader's themes folder, and watches it for changes.
 * @inputs win - The window object; inspected for Tauri internals to decide whether a reader's themes folder exists. kind - Which set of stylesheets ('export' or 'app'). builtIn - The shipped stylesheet by name. fallback - The stylesheet for an unknown name.
 * @outputs ThemeFiles - names(), css(name), openFolder(starter), and watch(onChanged) backed by Tauri invoke calls or the built-in/fallback stylesheets.
 * @dataflow win -> available flag -> userNames()/invoke('theme_*') for reader themes, builtIn*() for shipped; returns a merged name list, a stylesheet string, a folder path, or an unsubscribe function.
 * @controlflow Compute availability once, define the userNames helper, then return an object whose methods combine shipped and reader names, prefer the reader's stylesheet with fallback, seed/open the folder only when the app is present, and subscribe to theme changes.
 */
export function createThemeFiles(
  win: Window,
  kind: ThemeKind,
  builtIn: Readonly<Record<string, string>>,
  fallback: string,
): ThemeFiles {
  // Outside the desktop app there is no folder to read, so only what K-Doc ships is offered.
  const available = '__TAURI_INTERNALS__' in (win as unknown as Record<string, unknown>);

  /**
   * Returns the reader's own theme names for this kind, or an empty list when there is no readable folder.
   *
   * @purpose Reads the personal themes from the desktop backend, treating any failure as "no themes" rather than a caller-facing error.
   * @inputs none - Relies on the `available` flag and `kind` captured by createThemeFiles.
   * @outputs Promise<readonly string[]> - The reader's theme names for this kind, or an empty list when unavailable or unreadable.
   * @dataflow available + kind -> invoke('theme_names', { kind }) -> name list; failure -> empty list.
   * @controlflow Skip the call entirely when there is no desktop app, else attempt it and swallow any error into an empty list.
   */
  async function userNames(): Promise<readonly string[]> {
    // Check whether the desktop app is present to hold a reader's themes folder.
    if (!available) {
      // Branch: No Tauri environment; there is no reader's folder, so offer no personal themes.
      return [];
    } else {
      // Branch: The desktop app is present; proceed to read the reader's theme names below.
    }

    try {
      // Read the reader's own theme names for this kind from the desktop backend.
      return await invoke<string[]>('theme_names', { kind });
    } catch {
      // A folder that cannot be read is no themes, not an error the reader can act on.
      return [];
    }
  }

  return {
    /**
     * Combines shipped and reader theme names, with the reader's replacing any shipped name of the same spelling.
     *
     * @purpose Lists every selectable theme for this kind: K-Doc's first, then the reader's own, without duplicating a shared name.
     * @inputs none - Reads both the reader's names (userNames) and the shipped names (builtIn keys).
     * @outputs Promise<readonly string[]> - Shipped names followed by any reader names not already present.
     * @dataflow userNames() + builtIn keys -> filter out duplicates -> merged list.
     * @controlflow Fetch both name lists, then keep only reader names absent from the shipped set and append them.
     */
    async names(): Promise<readonly string[]> {
      const own = await userNames();
      const shipped = Object.keys(builtIn);
      // A theme of the reader's replaces one of the same name rather than being listed twice.
      return [...shipped, ...own.filter((name) => !shipped.includes(name))];
    },
    /**
     * Resolves the stylesheet for a theme name, preferring the reader's own over a shipped theme and falling back to the default.
     *
     * @purpose Implements css(): returns the CSS this kind uses for a chosen theme, honouring the reader's authorship first.
     * @inputs name - The requested theme name; resolved against the reader's themes before the shipped ones.
     * @outputs Promise<string> - The stylesheet text for that name, or the fallback stylesheet when unknown.
     * @dataflow userNames() -> invoke('theme_css', { kind, name }) for the reader's, else builtIn[name] -> fallback on miss.
     * @controlflow Prefer the reader's stylesheet by name; if absent or unreadable use a shipped theme of that name, else the fallback.
     */
    async css(name: string): Promise<string> {
      // Check whether the reader wrote a theme by this name, which is the one they mean.
      if ((await userNames()).includes(name)) {
        try {
          // The reader's own stylesheet wins over any shipped theme of the same name.
          return await invoke<string>('theme_css', { kind, name });
        } catch {
          // No usable reader stylesheet: fall through to a theme K-Doc ships.
        }
      } else {
        // Branch: The reader did not write a theme by this name; use the shipped or default path below.
      }

      return builtIn[name] ?? fallback;
    },
    /**
     * Opens (and seeds) the reader's themes folder via the desktop backend, throwing outside the app.
     *
     * @purpose Implements openFolder(): returns the path to the reader's themes directory for this kind, writing a starter theme when it is empty.
     * @inputs starter - The starter stylesheet written into an empty folder.
     * @outputs Promise<string> - The reader's themes folder path once opened and seeded.
     * @dataflow available + kind + starter -> invoke('theme_folder', { kind, starter }) -> folder path string.
     * @controlflow Refuse when there is no desktop app, else ask the backend to open and seed the folder with the given starter.
     */
    async openFolder(starter: string): Promise<string> {
      // Check the desktop app is there to hold a folder.
      if (!available) {
        // Branch: No Tauri environment; editing requires the desktop app, so refuse.
        throw new Error('Editing themes requires the desktop app.');
      } else {
        // Branch: The desktop app is present; proceed to open (and seed) the reader's folder below.
      }

      return invoke<string>('theme_folder', { kind, starter });
    },
    /**
     * Subscribes to theme-file changes for this kind and returns an unsubscribe function.
     *
     * @purpose Implements watch(): calls back whenever a theme file in the reader's folder changes (FR-14.10), until the returned stopper is called.
     * @inputs onChanged - Callback invoked on every change event for this kind of theme.
     * @outputs Promise<() => void> - A function that stops watching by tearing down the listener and the backend watch.
     * @dataflow available -> listen(THEME_CHANGED_EVENT) + invoke('theme_watch', { kind }) -> onChanged on matching events; stopper unlistens and invokes 'theme_unwatch'.
     * @controlflow Return a no-op stopper when there is no desktop app, else register the listener, start the backend watch, and return a stopper that undoes both.
     */
    async watch(onChanged: () => void): Promise<() => void> {
      // Check whether the desktop app is present to hold a reader's themes folder.
      if (!available) {
        // Branch: No Tauri environment; there is nothing to watch, so return a no-op stopper.
        return (): void => {};
      } else {
        // Branch: The desktop app is present; proceed to subscribe to theme changes below.
      }

      const unlisten = await listen<string>(THEME_CHANGED_EVENT, (event): void => {
        // Check whether the change concerns this caller's kind of theme.
        if (event.payload === kind) {
          // Branch: This event is for our kind; notify the caller of the change.
          onChanged();
        } else {
          // Branch: The event is for the other kind of theme; ignore it, not our business.
        }
      });

      await invoke('theme_watch', { kind });

      return (): void => {
        unlisten();
        void invoke('theme_unwatch').catch((): void => {
          // A watch that cannot be stopped costs nothing but a file handle for the session.
        });
      };
    },
  };
}
