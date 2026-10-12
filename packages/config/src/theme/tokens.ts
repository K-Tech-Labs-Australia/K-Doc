/**
 * @file tokens.ts
 * @purpose Defines the headless theme token contract, baseline light/dark themes, the Material 3 Expressive
 *   chrome token layer (tonal surfaces generated from one vibrant seed, per-theme chrome palettes, status colours,
 *   shape scale, and elevation shadows), WCAG 2.2 AA contrast validation utilities, and CSS custom property
 *   formatting for K-Doc (FR-14.9, FR-14.10, NFR-4).
 *
 *   This file is the documented token contract that user themes (FR-14.10) are written against.
 *   Adding, renaming, or removing a token is a breaking change for every user theme, so the token
 *   set is deliberately small and every token has a stated purpose.
 *
 *   Existing `ThemeColors` describes the document/page surface and varies between light and dark themes.
 *   The chrome tokens describe the application chrome (menu bar, ribbon, panels, toolbars, dialogs, and controls)
 *   and now follow the theme too: LIGHT_CHROME and DARK_CHROME are Material 3 tonal palettes built from a
 *   full-chroma blue primary (#0b57d0 light, #a8c7ff dark) with an orange tertiary. Token NAMES are unchanged
 *   from the Avimorphism layer so every component stylesheet keeps resolving; the glass tokens now carry opaque
 *   tonal surfaces and a 0px blur, which turns every former glass overlay into a Material container. `edge` is
 *   the 3:1 control outline (WCAG 2.2 SC 1.4.11) and `selected` / `onSelected` the tonal selection pair; selection
 *   must never be shown by colour alone, so components pair these with a shape change, a weight change, or a tick.
 *
 *   Contrast is not left to taste: `contrastRatio` plus the accompanying test suite make WCAG 2.2 AA
 *   (NFR-4) a CI gate rather than an aspiration.
 *
 *   The `border` and `borderStrong` tokens were split because one colour cannot carry two different
 *   accessibility obligations; this distinction was found by the contrast test suite rather than
 *   reasoned about up front.
 *
 *   This module is completely headless: it defines tokens and emits CSS custom properties as a string;
 *   it never touches the DOM.
 *
 * @inputs Theme mode selections ('light' | 'dark' | 'system'), system dark preference booleans, hex color strings, ThemeTokens objects.
 * @outputs Frozen ThemeTokens structures (LIGHT_THEME, DARK_THEME), frozen chrome token structures (LIGHT_CHROME, DARK_CHROME, LIGHT_STATUS, DARK_STATUS, RADIUS_SCALE), relative luminance floats [0, 1], contrast ratio floats [1, 21], CSS variable declaration strings.
 * @functions
 *   - relativeLuminance: Computes WCAG 2.2 relative luminance for a 3- or 6-digit hex color string.
 *   - contrastRatio: Computes WCAG 2.2 contrast ratio between two hex colors in an order-independent manner.
 *   - toCssVariables: Emits a newline-separated CSS custom property declaration list for document color, chrome, emissive, radius, and elevation tokens.
 *   - resolveTheme: Resolves the active ThemeTokens based on user mode preference and system dark mode state.
 * @dataflow Color hex values / theme specifications → luminance & contrast calculations → resolved theme tokens → CSS variable strings.
 * @controlflow Validate hex formats (throw RangeError on malformed input) → calculate channel luminance & contrast → freeze theme constants → resolve theme by preference → generate CSS variable declarations.
 * @version 5
 * @date 2026-10-03
 */

export type ThemeModeName = 'light' | 'dark';

export interface ThemeColors {
  readonly background: string;
  readonly backgroundElevated: string;
  readonly backgroundSubtle: string;
  readonly text: string;
  readonly textMuted: string;
  /**
   * Decorative divider only — pane separators, table rules, card edges. Carries NO contrast
   * obligation, because WCAG 2.2 SC 1.4.11 scopes non-text contrast to user interface components and
   * to graphical objects required to understand content, and a subtle rule is neither.
   */
  readonly border: string;
  /**
   * Visible boundary of an interactive control and the focus indicator — text input outlines,
   * checkbox edges, focus rings. MUST meet 3:1 against the background it sits on, and the theme test
   * suite enforces that.
   */
  readonly borderStrong: string;
  readonly accent: string;
  readonly accentText: string;
  readonly selection: string;
  readonly danger: string;
  readonly warning: string;
  readonly success: string;
  readonly codeBackground: string;
  readonly codeText: string;
}

/**
 * Tactile surface and lighting tokens for the application chrome (menu bar, ribbon, panels,
 * toolbars, dialogs, controls).
 *
 * Chrome tokens now differ per theme (Material tonal palettes); names kept from the Avimorphism layer.
 */
export interface ChromeColors {
  readonly base: string;          // window surface (M3 surface)
  /**
   * Highest container tier, fill of fields and ribbon buttons (M3 surface-container-highest).
   */
  readonly recessed: string;
  readonly raised: string;        // toolbar, rails and grouped controls (M3 surface-container)
  readonly highlight: string;     // top inner edge light, transparent in Material (rgba)
  readonly shadowDark: string;    // key shadow of an elevated surface (rgba)
  readonly shadowDeeper: string;  // ambient shadow of an elevated surface (rgba)
  readonly text: string;          // chrome label text (M3 on-surface)
  readonly textMuted: string;     // secondary label text (M3 on-surface-variant)
  /**
   * Primary colour: filled toggles, switches, active tab indicator, focus rings.
   */
  readonly accent: string;
  readonly glassTint: string;     // menus, dialogs and popovers (M3 surface-container-high), opaque
  readonly glassEdge: string;     // decorative divider and panel rim, no contrast obligation (M3 outline-variant)
  readonly glassBlur: string;     // backdrop-filter blur length; '0px' because Material surfaces are opaque
  readonly containerLow: string;        // ribbon, side panel bodies, settings sections (M3 surface-container-low)
  readonly edge: string;                // control outline; MUST meet 3:1 against every chrome surface (M3 outline)
  readonly onAccent: string;            // text and icons on an accent fill (M3 on-primary)
  readonly selected: string;            // selected segment, menu highlight, current list item (M3 secondary-container)
  readonly onSelected: string;          // text on the selected fill (M3 on-secondary-container)
  readonly tertiary: string;            // section headings, expressive accent text (M3 tertiary)
  readonly tertiaryContainer: string;   // active rail item, current breadcrumb (M3 tertiary-container)
  readonly onTertiaryContainer: string; // text on the tertiary container (M3 on-tertiary-container)
}

/**
 * Status colours for genuine state the user must notice (saved, unsaved, error, target, advisory).
 * Kept under the historic `emissive` name so component CSS keeps resolving; values now differ per
 * theme so each meets 3:1 on the chrome.
 */
export interface EmissiveColors {
  readonly green: string;    // normal / active / healthy
  readonly amber: string;    // caution / attention
  readonly red: string;      // warning / critical
  readonly magenta: string;  // commanded / target
  readonly cyan: string;     // advisory / informational
}

/**
 * Material 3 shape scale for chrome controls, containers, and floating panels.
 */
export interface RadiusScale {
  readonly sm: string;   // chips, menu items
  readonly md: string;   // buttons, fields, selected toggles
  readonly lg: string;   // cards, panes, sections
  readonly xl: string;   // toolbars, rails, dialogs
  readonly pill: string; // fully rounded
}

export interface ThemeTokens {
  readonly name: string;
  readonly mode: ThemeModeName;
  readonly color: ThemeColors;
  readonly chrome: ChromeColors;
  readonly emissive: EmissiveColors;
  readonly radius: RadiusScale;
}

/**
 * Material 3 Expressive light chrome: vibrant blue primary, orange tertiary, blue-tinted surfaces.
 */
export const LIGHT_CHROME: ChromeColors = Object.freeze<ChromeColors>({
  base: '#f9f9ff',
  recessed: '#d3ddf4',
  raised: '#e5ebfa',
  highlight: 'rgba(255, 255, 255, 0)',
  shadowDark: 'rgba(0, 0, 0, 0.16)',
  shadowDeeper: 'rgba(0, 0, 0, 0.26)',
  text: '#141a26',
  textMuted: '#394358',
  accent: '#0b57d0',
  glassTint: '#dce4f7',
  glassEdge: '#bcc6dc',
  glassBlur: '0px',
  containerLow: '#eff2fd',
  edge: '#5f6a80',
  onAccent: '#ffffff',
  selected: '#d3e3ff',
  onSelected: '#001b47',
  tertiary: '#9a3f00',
  tertiaryContainer: '#ffd9c7',
  onTertiaryContainer: '#351000',
});

/**
 * Material 3 Expressive dark chrome: vibrant blue primary, orange tertiary, blue-tinted surfaces.
 */
export const DARK_CHROME: ChromeColors = Object.freeze<ChromeColors>({
  base: '#0e121b',
  recessed: '#2f3747',
  raised: '#1a202d',
  highlight: 'rgba(255, 255, 255, 0)',
  shadowDark: 'rgba(0, 0, 0, 0.45)',
  shadowDeeper: 'rgba(0, 0, 0, 0.6)',
  text: '#e2e6f4',
  textMuted: '#c2c9dc',
  accent: '#a8c7ff',
  glassTint: '#242b3a',
  glassEdge: '#3d4558',
  glassBlur: '0px',
  containerLow: '#161b27',
  edge: '#8b95ab',
  onAccent: '#002d6b',
  selected: '#1d4c9f',
  onSelected: '#dbe5ff',
  tertiary: '#ffb68e',
  tertiaryContainer: '#7d3200',
  onTertiaryContainer: '#ffdccb',
});

export const LIGHT_STATUS: EmissiveColors = Object.freeze<EmissiveColors>({
  green: '#1a7f37',
  amber: '#8a5d00',
  red: '#ba1a1a',
  magenta: '#8e24aa',
  cyan: '#00639b',
});

export const DARK_STATUS: EmissiveColors = Object.freeze<EmissiveColors>({
  green: '#3fb950',
  amber: '#d29922',
  red: '#ffb4ab',
  magenta: '#e5a1ff',
  cyan: '#7fcfff',
});

export const RADIUS_SCALE: RadiusScale = Object.freeze<RadiusScale>({
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '28px',
  pill: '999px',
});

const LIGHT_COLORS: ThemeColors = Object.freeze<ThemeColors>({
  background: '#ffffff',
  backgroundElevated: '#f6f8fa',
  backgroundSubtle: '#eaeef2',
  text: '#1f2328',
  textMuted: '#57606a',
  border: '#d0d7de',
  borderStrong: '#6e7781',
  accent: '#0969da',
  accentText: '#ffffff',
  selection: '#ddf4ff',
  danger: '#cf222e',
  warning: '#9a6700',
  success: '#1a7f37',
  codeBackground: '#f6f8fa',
  codeText: '#1f2328',
});

export const LIGHT_THEME: ThemeTokens = Object.freeze<ThemeTokens>({
  name: 'K-Doc Light',
  mode: 'light',
  color: LIGHT_COLORS,
  chrome: LIGHT_CHROME,
  emissive: LIGHT_STATUS,
  radius: RADIUS_SCALE,
});

const DARK_COLORS: ThemeColors = Object.freeze<ThemeColors>({
  background: '#0d1117',
  backgroundElevated: '#161b22',
  backgroundSubtle: '#21262d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  border: '#30363d',
  borderStrong: '#6e7681',
  accent: '#58a6ff',
  accentText: '#0d1117',
  selection: '#1f6feb',
  danger: '#ff7b72',
  warning: '#d29922',
  success: '#3fb950',
  codeBackground: '#161b22',
  codeText: '#e6edf3',
});

export const DARK_THEME: ThemeTokens = Object.freeze<ThemeTokens>({
  name: 'K-Doc Dark',
  mode: 'dark',
  color: DARK_COLORS,
  chrome: DARK_CHROME,
  emissive: DARK_STATUS,
  radius: RADIUS_SCALE,
});

/**
 * WCAG 2.2 AA minimum contrast ratio requirement for normal text (under 18pt / 24px, or under 14pt / 18.66px bold).
 * Success Criterion 1.4.3: Contrast (Minimum).
 */
export const CONTRAST_AA_NORMAL: number = 4.5;

/**
 * WCAG 2.2 AA minimum contrast ratio requirement for large text (at least 18pt / 24px, or 14pt / 18.66px bold)
 * and user interface components / graphical objects (Success Criterion 1.4.11: Non-text Contrast).
 */
export const CONTRAST_AA_LARGE: number = 3;

/**
 * Computes the WCAG 2.2 relative luminance of an sRGB color.
 *
 * @purpose Calculates relative luminance normalized to the range 0.0 (darkest black) to 1.0 (lightest white) per WCAG 2.2 specs.
 * @inputs hex - Hex color string in 3- or 6-digit notation (e.g. '#fff', 'fff', '#ffffff', 'ffffff'), case-insensitive.
 * @outputs number - Relative luminance value in the range [0.0, 1.0].
 * @dataflow Hex string → strip '#' prefix → parse RGB integers → normalize to [0, 1] → sRGB gamma decompression → linear luminance sum.
 * @controlflow Validate hex format → branch on 3 vs 6 digit format or throw RangeError → linearize sRGB channels → return weighted sum.
 */
export function relativeLuminance(hex: string): number {
  // Strip optional leading '#' prefix if present.
  const raw = hex.startsWith('#') ? hex.slice(1) : hex;

  let rInt: number;
  let gInt: number;
  let bInt: number;

  // Check whether the input matches 3-digit shorthand hex (#rgb / rgb).
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const rHex = raw.slice(0, 1);
    const gHex = raw.slice(1, 2);
    const bHex = raw.slice(2, 3);
    rInt = parseInt(rHex + rHex, 16);
    gInt = parseInt(gHex + gHex, 16);
    bInt = parseInt(bHex + bHex, 16);
  } else if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    // Check whether the input matches 6-digit full hex (#rrggbb / rrggbb).
    rInt = parseInt(raw.slice(0, 2), 16);
    gInt = parseInt(raw.slice(2, 4), 16);
    bInt = parseInt(raw.slice(4, 6), 16);
  } else {
    // A malformed colour in a theme is a developer error that must surface immediately,
    // unlike user settings which degrade gracefully.
    throw new RangeError(`Invalid hex color string "${hex}": expected 3- or 6-digit hex format (e.g. "#fff", "#ffffff")`);
  }

  // Normalize each 8-bit color channel to the range [0.0, 1.0].
  const rNorm = rInt / 255;
  const gNorm = gInt / 255;
  const bNorm = bInt / 255;

  // Convert sRGB channel value to linear luminance per WCAG 2.2 formula:
  // sRGB gamma decompression piecewise function:
  // c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const rLinear = rNorm <= 0.03928 ? rNorm / 12.92 : Math.pow((rNorm + 0.055) / 1.055, 2.4);
  const gLinear = gNorm <= 0.03928 ? gNorm / 12.92 : Math.pow((gNorm + 0.055) / 1.055, 2.4);
  const bLinear = bNorm <= 0.03928 ? bNorm / 12.92 : Math.pow((bNorm + 0.055) / 1.055, 2.4);

  // Compute relative luminance using ITU-R BT.709 spectral weighting coefficients:
  // 0.2126 * R + 0.7152 * G + 0.0722 * B
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculates the WCAG 2.2 contrast ratio between two colors.
 *
 * @purpose Calculates contrast ratio between two hex colors, returning a ratio in [1.0, 21.0].
 * @inputs foreground - First hex color string (e.g. text or icon color).
 * @inputs background - Second hex color string (e.g. surface or backdrop color).
 * @outputs number - Contrast ratio value >= 1.0.
 * @dataflow Hex colors → relativeLuminance calculations → determine lighter and darker → ratio calculation.
 * @controlflow Calculate relative luminance of both colors → determine max (lighter) and min (darker) → compute (lighter + 0.05) / (darker + 0.05).
 */
export function contrastRatio(foreground: string, background: string): number {
  const lum1 = relativeLuminance(foreground);
  const lum2 = relativeLuminance(background);

  // Determine lighter and darker luminance. Order-independence is deliberate so callers
  // cannot get it backwards regardless of whether foreground or background is passed first.
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  // Standard WCAG 2.2 contrast ratio formula: (L1 + 0.05) / (L2 + 0.05)
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Converts a camelCase identifier string to kebab-case.
 *
 * @purpose Transforms a camelCase property name into a hyphen-delimited kebab-case CSS property fragment.
 * @inputs str - The camelCase string to convert.
 * @outputs string - The resulting kebab-case string.
 * @dataflow camelCase string → regex character boundary matching → hyphenated lowercase string.
 * @controlflow Perform regex replacement on lowercase/uppercase boundary → convert string to lowercase.
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Emits a CSS custom property declaration list for the specified theme tokens.
 *
 * @purpose Generates CSS variable declarations for document color, chrome, emissive, radius, and elevation tokens without wrapping in a selector.
 * @inputs tokens - The ThemeTokens container containing document color, chrome, emissive, and radius definitions.
 * @inputs prefix - Optional CSS variable prefix; defaults to '--kdoc'.
 * @outputs string - Newline-separated CSS declarations with a trailing newline.
 * @dataflow ThemeTokens token groups → camelToKebab key transformations → format declaration lines → append derived elevations → joined string with trailing newline.
 * @controlflow Iterate over color tokens → iterate over chrome tokens → iterate over emissive tokens → iterate over radius tokens → push derived elevation shadows → return joined declarations string.
 */
export function toCssVariables(tokens: ThemeTokens, prefix: string = '--kdoc'): string {
  // Do NOT wrap the declarations in a CSS selector (e.g. :root or [data-theme="dark"]).
  // The caller decides whether these declarations go on ':root', on '[data-theme="..."]',
  // or into an inline '<style>' element.
  const declarations: string[] = [];

  // Emit document color tokens (--kdoc-color-<kebab>).
  for (const [key, value] of Object.entries(tokens.color)) {
    const kebabName = camelToKebab(key);
    declarations.push(`  ${prefix}-color-${kebabName}: ${value};`);
  }

  // Emit chrome tokens (--kdoc-chrome-<kebab>).
  for (const [key, value] of Object.entries(tokens.chrome)) {
    const kebabName = camelToKebab(key);
    declarations.push(`  ${prefix}-chrome-${kebabName}: ${value};`);
  }

  // Emit status colour tokens (historic emissive name) (--kdoc-emissive-<kebab>).
  for (const [key, value] of Object.entries(tokens.emissive)) {
    const kebabName = camelToKebab(key);
    declarations.push(`  ${prefix}-emissive-${kebabName}: ${value};`);
  }

  // Emit corner radius scale tokens (--kdoc-radius-<kebab>).
  for (const [key, value] of Object.entries(tokens.radius)) {
    const kebabName = camelToKebab(key);
    declarations.push(`  ${prefix}-radius-${kebabName}: ${value};`);
  }

  // Derived Material elevation shadows composed from the chrome shadow tokens so component CSS never hand-rolls them.
  declarations.push(
    `  ${prefix}-elevation-raised: 0 1px 2px var(${prefix}-chrome-shadow-dark), 0 1px 3px 1px var(${prefix}-chrome-shadow-dark);`,
  );
  declarations.push(
    `  ${prefix}-elevation-sunken: inset 0 1px 3px var(${prefix}-chrome-shadow-dark);`,
  );

  return declarations.join('\n') + '\n';
}

/**
 * Resolves the active theme tokens based on user preference and system dark-mode setting.
 *
 * @purpose Selects between LIGHT_THEME and DARK_THEME according to explicit mode or OS preference.
 * @inputs mode - Theme mode selection ('light', 'dark', or 'system').
 * @inputs systemPrefersDark - Boolean indicating whether OS/browser prefers dark mode (e.g. via prefers-color-scheme).
 * @outputs ThemeTokens - The resolved frozen ThemeTokens object.
 * @dataflow Theme mode string + system boolean preference → conditional evaluation → resolved ThemeTokens.
 * @controlflow Check for 'dark' mode → check for 'light' mode → evaluate system preference boolean when mode is 'system'.
 */
export function resolveTheme(
  mode: 'light' | 'dark' | 'system',
  systemPrefersDark: boolean,
): ThemeTokens {
  // Check if explicit dark mode is requested.
  if (mode === 'dark') {
    return DARK_THEME;
  }

  // Check if explicit light mode is requested.
  if (mode === 'light') {
    return LIGHT_THEME;
  }

  // Check system preference when mode is set to 'system'.
  if (systemPrefersDark) {
    // OS preference indicates dark color scheme: return DARK_THEME.
    return DARK_THEME;
  } else {
    // OS preference indicates light color scheme (or no preference): return LIGHT_THEME.
    return LIGHT_THEME;
  }
}
