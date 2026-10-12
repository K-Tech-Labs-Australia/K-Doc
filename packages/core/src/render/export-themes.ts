/**
 * @file export-themes.ts
 * @purpose Provides the built-in stylesheets (themes) that an HTML or PDF export can be written with, exposing each theme's combined CSS plus lookups by name.
 * @inputs None beyond the module contract; EXPORT_STYLESHEET is imported from './html.js' as the base stylesheet every non-plain theme builds on.
 * @outputs DEFAULT_EXPORT_THEME - The theme name used when none is chosen (module constant). EXPORT_THEMES - Map of each built-in theme name to its full CSS (module contract). builtInThemeNames() - Ordered list of available theme names. builtInThemeCss(name) - The CSS for a named theme, or null when the name is unknown.
 * @functions
 *   - DEFAULT_EXPORT_THEME: Name of the fallback theme used when none is chosen (module contract).
 *   - SERIF_OVERRIDES: Extra CSS giving serif body text on a wider measure (private module constant).
 *   - COMPACT_OVERRIDES: Extra CSS with tighter spacing and a smaller measure for handouts (private module constant).
 *   - EXPORT_THEMES: Map of each built-in theme name to its full stylesheet, keyed by name (module contract).
 *   - builtInThemeNames: Returns the names of all built-in themes in offer order.
 *   - builtInThemeCss: Returns the CSS for a named built-in theme, or null when no theme matches.
 * @dataflow EXPORT_STYLESHEET from './html.js' -> combined with per-theme override blocks into EXPORT_THEMES -> looked up by name via builtInThemeCss / enumerated via builtInThemeNames.
 * @controlflow Define DEFAULT_EXPORT_THEME and the two override CSS strings; build EXPORT_THEMES as a Record combining the base stylesheet with each theme's overrides (plain gets none); enumerate keys for names and index by name for CSS, returning null on an unknown key.
 * @version 1
 * @date 2026-09-18
 */

import { EXPORT_STYLESHEET } from './html.js';

/** The theme used when none is chosen. */
export const DEFAULT_EXPORT_THEME: string = 'default';

/** Serif body text on a wider measure, for something that reads like a printed page. */
const SERIF_OVERRIDES = `
body {
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif;
  max-width: 46rem;
  font-size: 1.05rem;
}

h1, h2, h3, h4, h5, h6 {
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif;
  font-weight: 600;
}

blockquote {
  font-style: italic;
}
`;

/** Tighter spacing and a smaller measure, for a handout or a printout that should not run long. */
const COMPACT_OVERRIDES = `
html {
  font-size: 14px;
  line-height: 1.45;
}

body {
  max-width: 38rem;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 1em;
  margin-bottom: 0.35em;
}

p, ul, ol, blockquote, pre, table {
  margin-top: 0.6em;
  margin-bottom: 0.6em;
}
`;

/**
 * The themes K-Doc ships. A theme is the default stylesheet plus its own rules, except "plain", which is no
 * stylesheet at all: a document to be styled by whatever will hold it.
 */
export const EXPORT_THEMES: Readonly<Record<string, string>> = {
  default: EXPORT_STYLESHEET,
  serif: `${EXPORT_STYLESHEET}${SERIF_OVERRIDES}`,
  compact: `${EXPORT_STYLESHEET}${COMPACT_OVERRIDES}`,
  plain: '',
};

/** Their names, in the order they are offered. */
export function builtInThemeNames(): string[] {
  return Object.keys(EXPORT_THEMES);
}

/** The stylesheet a built-in theme is, or null when no theme goes by that name. */
export function builtInThemeCss(name: string): string | null {
  const css = EXPORT_THEMES[name];
  // Check whether a theme exists under the requested name.
  if (css === undefined) {
    // No theme goes by this name: return null to signal an unknown theme.
    return null;
  } else {
    // A matching theme was found: hand back its combined stylesheet verbatim.
    return css;
  }
}
