/**
 * @file theme.ts
 * @purpose Implements the theme application module for the K-Doc app shell, bridging the headless token contract in @k-doc/config with live document DOM elements and system preference listeners.
 * @inputs Document and Window DOM instances, and initial ThemeMode selection ('light' | 'dark' | 'system').
 * @outputs ThemeController instance exposing the active ThemeTokens, a setMode update method, and a destroy cleanup lifecycle method.
 * @functions
 *   - installTheme: Installs the theme controller, manages the theme style element, applies custom properties, and listens for OS color scheme changes.
 * @dataflow ThemeMode, UiThemeId & OS preference -> resolveUiTheme -> ThemeTokens -> toCssVariables -> <style id="kdoc-theme"> & documentElement attributes.
 * @controlflow Create style element -> query system preference -> register media query listener if supported -> apply initial theme -> return ThemeController.
 * @version 3
 * @date 2026-10-06
 */

import { DARK_THEME, DEFAULT_UI_THEME, LIGHT_THEME, resolveUiTheme, toCssVariables, type ThemeMode, type ThemeTokens, type UiThemeId } from '@k-doc/config';

/**
 * Controller interface managing live theme state, mode switching, and teardown.
 */
export interface ThemeController {
  readonly tokens: ThemeTokens;
  setMode(mode: ThemeMode): void;
  /** The built-in UI theme currently painting the app. */
  readonly uiTheme: UiThemeId;
  /** Switches to another built-in UI theme, keeping the current light/dark/system mode. */
  setUiTheme(id: UiThemeId): void;
  destroy(): void;
}

/**
 * Installs the K-Doc theme application controller onto the provided Document and Window.
 *
 * @purpose Creates an owned style element, resolves theme tokens, sets CSS variables and root attributes, and registers system preference listeners.
 * @inputs doc - Document instance to which the theme style element and dataset/colorScheme attributes are applied.
 * @inputs win - Window instance providing matchMedia for OS color scheme detection.
 * @inputs initialMode - Initial ThemeMode ('light' | 'dark' | 'system') requested by settings.
 * @outputs ThemeController - Object with `tokens` getter, `setMode(mode)` method, and `destroy()` cleanup method.
 * @dataflow initialMode & systemPrefersDark -> resolveTheme -> ThemeTokens -> toCssVariables -> styleElement.textContent & documentElement attributes.
 * @controlflow Create style element in doc.head -> evaluate win.matchMedia support -> register change listener if supported -> execute initial apply(initialMode) -> return ThemeController instance.
 */
/**
 * The contract a theme of the reader's is written against, as a stylesheet they can edit (FR-14.10).
 *
 * @purpose Every colour K-Doc paints with is one of these custom properties, so a theme that sets them changes the
 *   whole app and nothing else has to be known. Written into the themes folder as the starter, it is the contract
 *   and an example at once, and it cannot fall out of step with the code because it is generated from the tokens.
 * @inputs void.
 * @outputs string - A stylesheet setting every token to its value in the light theme, and again for dark.
 * @dataflow LIGHT_THEME and DARK_THEME -> toCssVariables -> :root and [data-kdoc-theme="dark"] blocks.
 * @controlflow No branches.
 */
export function appThemeStarter(): string {
  return `/*
 * A K-Doc theme. Copy this file, rename it, and change what you like.
 *
 * Every colour in the app comes from one of the custom properties below, so setting them is all a theme has to do.
 * The values here are K-Doc's own, so an untouched copy looks exactly like K-Doc.
 *
 * The dark block applies when the app is in dark mode; the app sets data-kdoc-theme="light" or "dark" on <html>.
 * Rules of your own can go after them: the app's stylesheet comes first, so yours wins.
 *
 * A theme is reloaded as soon as you save it, so leave K-Doc running while you work on one.
 */

:root {
${toCssVariables(LIGHT_THEME)}}

:root[data-kdoc-theme="dark"] {
${toCssVariables(DARK_THEME)}}
`;
}

export function installTheme(
  doc: Document,
  win: Window,
  initialMode: ThemeMode,
  initialUiTheme: UiThemeId = DEFAULT_UI_THEME,
): ThemeController {
  // Create a single <style> element with id = 'kdoc-theme' and append it to doc.head.
  // One owned element is used rather than inline styles on the root so the whole palette
  // can be swapped in a single write and inspected in devtools as one block.
  const styleElement = doc.createElement('style');
  styleElement.id = 'kdoc-theme';
  doc.head.appendChild(styleElement);

  // Keep state variables inside the closure rather than on a class instance.
  let currentMode: ThemeMode = initialMode;
  let currentUiTheme: UiThemeId = initialUiTheme;
  // Check if initialMode is explicitly dark to seed initial token state.
  let currentTokens: ThemeTokens = initialMode === 'dark' ? DARK_THEME : LIGHT_THEME;

  let mql: MediaQueryList | null = null;
  let systemPrefersDark = false;

  // Check if win.matchMedia is available as a callable function.
  // Guarding matters because the module must not assume a full browser — the same code runs under jsdom and inside a Tauri webview.
  if (typeof win.matchMedia === 'function') {
    // Query the system color scheme preference.
    mql = win.matchMedia('(prefers-color-scheme: dark)');
    systemPrefersDark = mql.matches;
  } else {
    // When win.matchMedia is not a function, treat the system as light and skip the listener entirely.
    systemPrefersDark = false;
  }

  // Define apply helper to resolve tokens and update DOM styles and attributes.
  const apply = (mode: ThemeMode): void => {
    currentMode = mode;
    const tokens = resolveUiTheme(currentUiTheme, mode, systemPrefersDark);
    // Name the built-in theme on <html> so a theme of the reader's own can build on it.
    doc.documentElement.dataset.kdocUiTheme = currentUiTheme;
    currentTokens = tokens;

    // Write CSS custom properties into the owned style element.
    styleElement.textContent = `:root {\n` + toCssVariables(tokens) + `}\n`;

    // Set dataset attribute on documentElement so CSS selectors can branch on the resolved mode.
    doc.documentElement.dataset.kdocTheme = tokens.mode;

    // Set colorScheme on documentElement style so native form controls and scrollbars match.
    // Without this line, the browser paints scrollbars and inputs in the wrong palette
    // and the app looks half-themed.
    doc.documentElement.style.colorScheme = tokens.mode;
  };

  // Define the media query change listener callback.
  const handleMediaChange = (event: MediaQueryListEvent): void => {
    systemPrefersDark = event.matches;

    // Check if the current mode is set to 'system'.
    if (currentMode === 'system') {
      // Re-apply theme only while the current mode is 'system'.
      // Re-applying under an explicit light or dark choice would override the user's decision.
      apply(currentMode);
    } else {
      // Explicit light or dark mode is active: do not override the user's selection.
    }
  };

  // Register a 'change' listener on the media query list defensively.
  // Check if mql is non-null and supports the modern addEventListener method.
  // Older webviews expose only the deprecated addListener, which is deliberately not supported
  // because K-Doc targets WebView2.
  if (mql !== null && typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handleMediaChange);
  } else {
    // addEventListener is not available on mql or mql is null: skip listener registration.
  }

  // Perform initial theme application.
  apply(initialMode);

  // Return the controller object literal with a getter for tokens.
  return {
    get tokens(): ThemeTokens {
      return currentTokens;
    },
    setMode(mode: ThemeMode): void {
      apply(mode);
    },
    get uiTheme(): UiThemeId {
      return currentUiTheme;
    },
    setUiTheme(id: UiThemeId): void {
      currentUiTheme = id;
      apply(currentMode);
    },
    destroy(): void {
      // Clean up the media query listener defensively.
      // Check if mql is non-null and supports removeEventListener.
      // Older webviews expose only the deprecated removeListener, which is deliberately not supported
      // because K-Doc targets WebView2.
      if (mql !== null && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleMediaChange);
      } else {
        // No listener removal needed.
      }

      // Remove the owned style element from the document head.
      // Check if the style element is still attached to a parent node.
      if (styleElement.parentNode !== null) {
        styleElement.remove();
      } else {
        // Style element is already detached.
      }
    },
  };
}
