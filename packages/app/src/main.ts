/**
 * @file main.ts
 * @purpose Entry point for the K-Doc application. Locates the DOM mount container, claims any pending window handoff document, constructs the EditorShell instance, and exposes the shell instance on the window object for development automation and debugging.
 *
 *   A tab dragged out of another window's tab strip parks its document for the window it opens.
 *   This is where that document is claimed. Claiming is destructive and happens once: the document
 *   is being moved, not copied, and a window that claimed again on reload would put a second copy
 *   of the user's unsaved work on screen.
 *
 * @inputs Browser DOM containing the #root mount container element, and optional window handoff payload.
 * @outputs None (top-level application bootstrap executing via void boot(); attaches window.__kdocShell).
 * @functions
 *   - boot: Asynchronously bootstraps the application by locating the mount, claiming handoff, constructing EditorShell, and attaching debug handle.
 * @dataflow document.getElementById('root') & claimed handoff document / SAMPLE_DOCUMENT -> EditorShell constructor -> (window as unknown as WindowWithKdocShell).__kdocShell.
 * @controlflow Execute boot() -> locate #root element -> verify mount element presence (throw Error if null) -> claim window handoff document -> resolve initialText and initialPath -> instantiate EditorShell in split view with system theme -> attach shell to window.__kdocShell.
 * @version 5
 * @date 2026-10-07
 */

// Bundled chrome typeface (Material 3 Expressive): Roboto Flex with weight and optical-size axes, so it works offline.
import '@fontsource-variable/roboto-flex/opsz.css';
// K-Tech brand typeface for the K-Doc wordmark and the About dialog, bundled so it works offline.
import '@fontsource/sansation/400.css';
import '@fontsource/sansation/700.css';
import { EditorShell } from './shell/editor-shell.js';
import { SAMPLE_DOCUMENT } from './sample.js';
import { createWindowHandoff } from './files/window-handoff.js';

/**
 * Local interface extending the browser Window to expose the shell instance for development debugging.
 * This handle exists solely so the shell can be driven from the browser console or automated test
 * harnesses during development and is not part of any supported public API.
 */
interface WindowWithKdocShell {
  __kdocShell?: EditorShell;
}

/**
 * Asynchronously bootstraps the K-Doc editor application into the host environment.
 *
 * @purpose Locates the DOM mount container, claims any pending handoff document, constructs the EditorShell instance, and exposes the shell instance for debugging.
 * @inputs None (reads DOM #root, window context, and window handoff state).
 * @outputs Promise<void> - Resolves when the application shell has been constructed and mounted.
 * @dataflow DOM #root element & window handoff document / SAMPLE_DOCUMENT -> EditorShell constructor -> window.__kdocShell.
 * @controlflow Locate #root element -> verify presence (throw Error if null) -> claim window handoff document -> resolve initialText and initialPath -> instantiate EditorShell -> expose shell on window.__kdocShell.
 */
async function boot(): Promise<void> {
  // Step 1: Locate the root mount element in the DOM.
  const root = document.getElementById('root');

  // Verify that the root mount container element exists in the DOM.
  // A missing mount is a build misconfiguration and must fail loudly rather than leaving a blank page with no explanation.
  if (root === null) {
    throw new Error("Missing required mount element with id 'root'");
  } else {
    // The mount is there so the boot can work out what to put in it.
  }

  // claim() never throws and never blocks on anything but its own lookup, so an ordinary launch pays
  // one resolved promise for the privilege of not having two boot paths.
  const handed = await createWindowHandoff(window).claim();

  let initialText: string = SAMPLE_DOCUMENT;
  let initialPath: string | null = null;
  let initialSavedText: string | null = null;
  let initialEncoding: string | null = null;

  // Check whether a document was handed to this window.
  if (handed === null) {
    // An ordinary launch: open on the starter document, with no path, so the first save asks where.
  } else {
    // A tab dragged out of another window: open on exactly what it was showing, path included, so the
    // next save writes the file it came from rather than asking again.
    initialText = handed.text;
    initialPath = handed.path;
    // Its unsaved work and encoding come too, so it is still modified there and is saved back as it was found.
    initialSavedText = handed.savedText ?? null;
    initialEncoding = handed.encoding ?? null;
  }

  // Step 2: Construct the EditorShell instance mounted into #root with the resolved text and path.
  const shell = new EditorShell({
    mount: root,
    initialText,
    initialPath,
    initialSavedText,
    initialEncoding,
    // A handed-over document is the whole point of this window: no session restore, no recovery offer.
    handedOff: handed !== null,
    initialViewMode: 'split',
    initialThemeMode: 'system',
  });

  // Step 3: Expose the shell instance on the window as __kdocShell for development and automation.
  // This exists so the shell can be driven from a console or by automation during development,
  // and is not part of any supported API.
  // Check for a development build: a release build never hands its internals to page scripts.
  if (import.meta.env.DEV) {
    (window as unknown as WindowWithKdocShell).__kdocShell = shell;
  } else {
    // Release build: nothing is exposed.
  }
}

void boot();
