/**
 * @file ui-themes.ts
 * @purpose Catalogue of K-Doc's built-in UI themes (K-Doc, Nord, Solarized, Paper, Graphite, High Contrast), each a light and a dark token set over the tokens.ts contract; the light/dark/system mode picks the variant. Every colour pair the contrast suite checks was verified against WCAG 2.2 AA when chosen.
 * @inputs None (static data).
 * @outputs UiThemeId, UI_THEME_IDS, DEFAULT_UI_THEME, UiTheme, UI_THEMES, isUiThemeId, uiThemeTokens, resolveUiTheme, uiThemeSwatch.
 * @functions
 *   - variant (private): Builds one frozen ThemeTokens variant by copying the four shadow/highlight/blur tokens from K-Doc's chrome of the same mode.
 *   - isUiThemeId: Type guard that narrows an unknown value to UiThemeId against UI_THEME_IDS.
 *   - uiThemeTokens: Returns the light or dark ThemeTokens for a theme id and mode.
 *   - resolveUiTheme: Resolves the active ThemeTokens across explicit light/dark/system modes with system preference fallback.
 *   - uiThemeSwatch: Freezes a three-element [base, accent, tertiary] chrome swatch tuple for a theme id and mode.
 * @dataflow Static palettes -> variant() -> frozen ThemeTokens -> UI_THEMES -> resolveUiTheme / uiThemeTokens / uiThemeSwatch.
 * @controlflow Module-load construction only; resolveUiTheme branches on mode.
 * @version 1
 * @date 2026-10-06
 */

import { DARK_STATUS, DARK_THEME, LIGHT_STATUS, LIGHT_THEME, RADIUS_SCALE, type ChromeColors, type EmissiveColors, type ThemeColors, type ThemeModeName, type ThemeTokens } from './tokens.js';

export type UiThemeId = 'kdoc' | 'nord' | 'solarized' | 'paper' | 'graphite' | 'high-contrast';

/**
 * The theme selected when no explicit choice has been made by the user.
 */
export const DEFAULT_UI_THEME: UiThemeId = 'kdoc';

/**
 * Frozen, ordered list of every built-in theme id; used for validation and catalogue iteration.
 */
export const UI_THEME_IDS: readonly UiThemeId[] = Object.freeze<readonly UiThemeId[]>(['kdoc', 'nord', 'solarized', 'paper', 'graphite', 'high-contrast']);

/**
 * A built-in theme pairing a light token set with a dark token set, plus human-readable metadata.
 */
export interface UiTheme {
  readonly id: UiThemeId;
  readonly label: string;
  readonly description: string;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

/**
 * Chrome subset used by variant(): the four tokens inherited from K-Doc's chrome are excluded here so they can be re-supplied per mode.
 */
type OwnChrome = Omit<ChromeColors, 'highlight' | 'shadowDark' | 'shadowDeeper' | 'glassBlur'>;

/**
 * Builds one frozen ThemeTokens variant for a theme.
 *
 * @purpose Assembles a complete ThemeTokens by combining the theme's own color/chrome/emissive/radius palettes with K-Doc's shadow, highlight, and blur tokens from the matching mode so elevation styling stays consistent across themes.
 * @inputs label - Human-readable base name of the theme (e.g. 'Nord'), used to build the variant display name.
 * @inputs mode - The ThemeModeName ('light' | 'dark') selecting which K-Doc chrome shadow set to inherit.
 * @inputs color - The theme's own document/page colour palette for this mode.
 * @inputs chrome - The theme's own chrome palette, excluding the four tokens inherited from K-Doc below.
 * @inputs emissive - The theme's status (emissive) colours for this mode.
 * @outputs ThemeTokens - A frozen ThemeTokens whose shadow/highlight/blur tokens come from K-Doc and everything else comes from the supplied palettes.
 * @dataflow Supplied color + chrome + emissive + RADIUS_SCALE -> shallow-copied into a new object, overlaid with inherited K-Doc chrome shadows -> frozen ThemeTokens.
 * @controlflow Select K-Doc chrome by mode -> construct object literal copying each palette and overlaying the four inherited tokens -> freeze and return; no branching beyond the chrome selection ternary.
 */
function variant(label: string, mode: ThemeModeName, color: ThemeColors, chrome: OwnChrome, emissive: EmissiveColors): ThemeTokens {
  // Light variants inherit K-Doc's light shadows; dark variants its dark ones.
  const inherited: ChromeColors = mode === 'light' ? LIGHT_THEME.chrome : DARK_THEME.chrome;
  return Object.freeze<ThemeTokens>({
    // The ternary appends 'Light' or 'Dark' to the base label so each variant carries a distinct display name.
    name: `${label} ${mode === 'light' ? 'Light' : 'Dark'}`,
    mode,
    color: Object.freeze<ThemeColors>({ ...color }),
    chrome: Object.freeze<ChromeColors>({ ...chrome, highlight: inherited.highlight, shadowDark: inherited.shadowDark, shadowDeeper: inherited.shadowDeeper, glassBlur: inherited.glassBlur }),
    emissive,
    radius: RADIUS_SCALE,
  });
}

// Status colours pushed further from the surface than K-Doc's for the high-contrast theme.
const HIGH_CONTRAST_LIGHT_STATUS: EmissiveColors = Object.freeze<EmissiveColors>({ green: '#0a5c1f', amber: '#6b4500', red: '#9c0000', magenta: '#6a1b80', cyan: '#004b75' });

// Status colours pushed further from the surface than K-Doc's for the high-contrast theme.
const HIGH_CONTRAST_DARK_STATUS: EmissiveColors = Object.freeze<EmissiveColors>({ green: '#5ff27a', amber: '#ffd24d', red: '#ff8f85', magenta: '#f0b6ff', cyan: '#8fe3ff' });

/**
 * Nord light theme variant.
 */
const NORD_LIGHT = variant('Nord', 'light', {
  background: '#eceff4',
  backgroundElevated: '#e5e9f0',
  backgroundSubtle: '#d8dee9',
  text: '#2e3440',
  textMuted: '#4c566a',
  border: '#c5ccd8',
  borderStrong: '#6d7a92',
  accent: '#4c6a92',
  accentText: '#ffffff',
  selection: '#d0dcec',
  danger: '#a3343e',
  warning: '#835500',
  success: '#3b6e2a',
  codeBackground: '#e5e9f0',
  codeText: '#2e3440',
}, {
  base: '#e5e9f0',
  recessed: '#cfd6e2',
  raised: '#dde2ea',
  text: '#2e3440',
  textMuted: '#434c5e',
  accent: '#4c6a92',
  glassTint: '#d8dee9',
  glassEdge: '#bcc4d2',
  containerLow: '#e9ecf1',
  edge: '#6d7a92',
  onAccent: '#ffffff',
  selected: '#c9d6ea',
  onSelected: '#1e2a3d',
  tertiary: '#9a4a1c',
  tertiaryContainer: '#f2d6c4',
  onTertiaryContainer: '#3d1a06',
}, LIGHT_STATUS);

/**
 * Nord dark theme variant.
 */
const NORD_DARK = variant('Nord', 'dark', {
  background: '#2e3440',
  backgroundElevated: '#3b4252',
  backgroundSubtle: '#434c5e',
  text: '#eceff4',
  textMuted: '#c2cad8',
  border: '#4c566a',
  borderStrong: '#8a95aa',
  accent: '#88c0d0',
  accentText: '#1d232d',
  selection: '#4c5f80',
  danger: '#ff9a9f',
  warning: '#ebcb8b',
  success: '#a3be8c',
  codeBackground: '#3b4252',
  codeText: '#e5e9f0',
}, {
  base: '#242933',
  recessed: '#3b4252',
  raised: '#2e3440',
  text: '#eceff4',
  textMuted: '#c9d0dc',
  accent: '#88c0d0',
  glassTint: '#3b4252',
  glassEdge: '#4c566a',
  containerLow: '#292e39',
  edge: '#8a95aa',
  onAccent: '#14262d',
  selected: '#4c5f80',
  onSelected: '#eceff4',
  tertiary: '#e7a387',
  tertiaryContainer: '#6b3a22',
  onTertiaryContainer: '#ffe0d2',
}, DARK_STATUS);

/**
 * Solarized light theme variant.
 */
const SOLARIZED_LIGHT = variant('Solarized', 'light', {
  background: '#fdf6e3',
  backgroundElevated: '#eee8d5',
  backgroundSubtle: '#e6dfc8',
  text: '#073642',
  textMuted: '#4d5f66',
  border: '#d6cfb9',
  borderStrong: '#7b8a8b',
  accent: '#1a6aa8',
  accentText: '#ffffff',
  selection: '#e4ddc6',
  danger: '#b0281f',
  warning: '#7a5b00',
  success: '#4f6400',
  codeBackground: '#eee8d5',
  codeText: '#073642',
}, {
  base: '#eee8d5',
  recessed: '#ddd6bf',
  raised: '#f5efdc',
  text: '#073642',
  textMuted: '#3f5158',
  accent: '#1a6aa8',
  glassTint: '#e6dfc8',
  glassEdge: '#c9c2ab',
  containerLow: '#f6f0de',
  edge: '#6f7f80',
  onAccent: '#ffffff',
  selected: '#d5e3ef',
  onSelected: '#002b36',
  tertiary: '#9e3f15',
  tertiaryContainer: '#f6d5c3',
  onTertiaryContainer: '#3d1404',
}, LIGHT_STATUS);

/**
 * Solarized dark theme variant.
 */
const SOLARIZED_DARK = variant('Solarized', 'dark', {
  background: '#002b36',
  backgroundElevated: '#073642',
  backgroundSubtle: '#0c3f4d',
  text: '#eee8d5',
  textMuted: '#a3b0b0',
  border: '#1f4d59',
  borderStrong: '#6c8689',
  accent: '#4fa3e0',
  accentText: '#002b36',
  selection: '#11506b',
  danger: '#ff8a7f',
  warning: '#d4a72c',
  success: '#a2b83a',
  codeBackground: '#073642',
  codeText: '#eee8d5',
}, {
  base: '#00212b',
  recessed: '#0d4250',
  raised: '#073642',
  text: '#eee8d5',
  textMuted: '#b5c0bf',
  accent: '#4fa3e0',
  glassTint: '#073642',
  glassEdge: '#1f4d59',
  containerLow: '#052f3b',
  edge: '#6c8689',
  onAccent: '#00212b',
  selected: '#13597a',
  onSelected: '#eee8d5',
  tertiary: '#e0743a',
  tertiaryContainer: '#5c2a0e',
  onTertiaryContainer: '#ffdccb',
}, DARK_STATUS);

/**
 * Paper light theme variant.
 */
const PAPER_LIGHT = variant('Paper', 'light', {
  background: '#fbf7ee',
  backgroundElevated: '#f4eddd',
  backgroundSubtle: '#ebe2cc',
  text: '#2b2118',
  textMuted: '#5c4d3c',
  border: '#e0d5bd',
  borderStrong: '#8c7b63',
  accent: '#8a4b14',
  accentText: '#ffffff',
  selection: '#f2dfc2',
  danger: '#a82a1f',
  warning: '#7a5200',
  success: '#2f6b2f',
  codeBackground: '#f4eddd',
  codeText: '#2b2118',
}, {
  base: '#f4eddd',
  recessed: '#e3d8bf',
  raised: '#faf4e6',
  text: '#2b2118',
  textMuted: '#54463a',
  accent: '#8a4b14',
  glassTint: '#ebe2cc',
  glassEdge: '#d3c6a8',
  containerLow: '#f8f2e4',
  edge: '#87765e',
  onAccent: '#ffffff',
  selected: '#ead3b0',
  onSelected: '#2b1906',
  tertiary: '#2f6b4f',
  tertiaryContainer: '#cfe6d8',
  onTertiaryContainer: '#0c2a1c',
}, LIGHT_STATUS);

/**
 * Paper dark theme variant.
 */
const PAPER_DARK = variant('Paper', 'dark', {
  background: '#1e1a15',
  backgroundElevated: '#27221b',
  backgroundSubtle: '#322b22',
  text: '#ede4d3',
  textMuted: '#c4b8a3',
  border: '#3d352a',
  borderStrong: '#8a7d68',
  accent: '#e0a96d',
  accentText: '#1e1a15',
  selection: '#5a4226',
  danger: '#ff958a',
  warning: '#e3b65a',
  success: '#93c98a',
  codeBackground: '#27221b',
  codeText: '#ede4d3',
}, {
  base: '#18150f',
  recessed: '#3a3227',
  raised: '#27221b',
  text: '#ede4d3',
  textMuted: '#cbbfab',
  accent: '#e0a96d',
  glassTint: '#27221b',
  glassEdge: '#3d352a',
  containerLow: '#211d17',
  edge: '#8a7d68',
  onAccent: '#24170a',
  selected: '#6a4b25',
  onSelected: '#f6e7d2',
  tertiary: '#8cc7a6',
  tertiaryContainer: '#1f4a35',
  onTertiaryContainer: '#d4f0e0',
}, DARK_STATUS);

/**
 * Graphite light theme variant.
 */
const GRAPHITE_LIGHT = variant('Graphite', 'light', {
  background: '#ffffff',
  backgroundElevated: '#f4f4f5',
  backgroundSubtle: '#e4e4e7',
  text: '#18181b',
  textMuted: '#52525b',
  border: '#d4d4d8',
  borderStrong: '#71717a',
  accent: '#475569',
  accentText: '#ffffff',
  selection: '#dbe1ea',
  danger: '#b91c1c',
  warning: '#8a5300',
  success: '#15803d',
  codeBackground: '#f4f4f5',
  codeText: '#18181b',
}, {
  base: '#f4f4f5',
  recessed: '#e0e0e4',
  raised: '#fafafa',
  text: '#18181b',
  textMuted: '#3f3f46',
  accent: '#475569',
  glassTint: '#e4e4e7',
  glassEdge: '#c8c8ce',
  containerLow: '#f7f7f8',
  edge: '#71717a',
  onAccent: '#ffffff',
  selected: '#dfe3ea',
  onSelected: '#18202c',
  tertiary: '#6d28d9',
  tertiaryContainer: '#ede4ff',
  onTertiaryContainer: '#2e1065',
}, LIGHT_STATUS);

/**
 * Graphite dark theme variant.
 */
const GRAPHITE_DARK = variant('Graphite', 'dark', {
  background: '#18181b',
  backgroundElevated: '#212124',
  backgroundSubtle: '#2a2a2e',
  text: '#e4e4e7',
  textMuted: '#a1a1aa',
  border: '#3f3f46',
  borderStrong: '#7a7a84',
  accent: '#a5b4c8',
  accentText: '#18181b',
  selection: '#3a4352',
  danger: '#fca5a5',
  warning: '#fbbf24',
  success: '#86efac',
  codeBackground: '#212124',
  codeText: '#e4e4e7',
}, {
  base: '#121214',
  recessed: '#2c2c31',
  raised: '#1c1c1f',
  text: '#e4e4e7',
  textMuted: '#b4b4bc',
  accent: '#a5b4c8',
  glassTint: '#212124',
  glassEdge: '#3a3a40',
  containerLow: '#161618',
  edge: '#7a7a84',
  onAccent: '#141820',
  selected: '#3a4352',
  onSelected: '#e8edf5',
  tertiary: '#c4a7ff',
  tertiaryContainer: '#43307a',
  onTertiaryContainer: '#ece3ff',
}, DARK_STATUS);

/**
 * High Contrast light theme variant.
 */
const HIGH_CONTRAST_LIGHT = variant('High Contrast', 'light', {
  background: '#ffffff',
  backgroundElevated: '#f2f2f2',
  backgroundSubtle: '#e6e6e6',
  text: '#000000',
  textMuted: '#262626',
  border: '#000000',
  borderStrong: '#000000',
  accent: '#0033cc',
  accentText: '#ffffff',
  selection: '#cce0ff',
  danger: '#9c0000',
  warning: '#6b4500',
  success: '#0a5c1f',
  codeBackground: '#f2f2f2',
  codeText: '#000000',
}, {
  base: '#ffffff',
  recessed: '#e6e6e6',
  raised: '#f2f2f2',
  text: '#000000',
  textMuted: '#1a1a1a',
  accent: '#0033cc',
  glassTint: '#f2f2f2',
  glassEdge: '#000000',
  containerLow: '#fafafa',
  edge: '#000000',
  onAccent: '#ffffff',
  selected: '#cce0ff',
  onSelected: '#000000',
  tertiary: '#8a2a00',
  tertiaryContainer: '#ffe0cc',
  onTertiaryContainer: '#000000',
}, HIGH_CONTRAST_LIGHT_STATUS);

/**
 * High Contrast dark theme variant.
 */
const HIGH_CONTRAST_DARK = variant('High Contrast', 'dark', {
  background: '#000000',
  backgroundElevated: '#0d0d0d',
  backgroundSubtle: '#1a1a1a',
  text: '#ffffff',
  textMuted: '#e0e0e0',
  border: '#ffffff',
  borderStrong: '#ffffff',
  accent: '#ffd400',
  accentText: '#000000',
  selection: '#3d3300',
  danger: '#ff8f85',
  warning: '#ffd24d',
  success: '#5ff27a',
  codeBackground: '#0d0d0d',
  codeText: '#ffffff',
}, {
  base: '#000000',
  recessed: '#262626',
  raised: '#121212',
  text: '#ffffff',
  textMuted: '#e6e6e6',
  accent: '#ffd400',
  glassTint: '#121212',
  glassEdge: '#ffffff',
  containerLow: '#0a0a0a',
  edge: '#ffffff',
  onAccent: '#000000',
  selected: '#3d3300',
  onSelected: '#ffffff',
  tertiary: '#7fdfff',
  tertiaryContainer: '#00384d',
  onTertiaryContainer: '#ffffff',
}, HIGH_CONTRAST_DARK_STATUS);

/**
 * The complete catalogue of built-in themes keyed by theme id, frozen at module load.
 */
export const UI_THEMES: Readonly<Record<UiThemeId, UiTheme>> = Object.freeze<Record<UiThemeId, UiTheme>>({
  kdoc: Object.freeze<UiTheme>({ id: 'kdoc', label: 'K-Doc', description: 'Vibrant blue with an orange accent.', light: LIGHT_THEME, dark: DARK_THEME }),
  nord: Object.freeze<UiTheme>({ id: 'nord', label: 'Nord', description: 'Cool arctic blues and frosty greys.', light: NORD_LIGHT, dark: NORD_DARK }),
  solarized: Object.freeze<UiTheme>({ id: 'solarized', label: 'Solarized', description: "Ethan Schoonover's low-glare palette.", light: SOLARIZED_LIGHT, dark: SOLARIZED_DARK }),
  paper: Object.freeze<UiTheme>({ id: 'paper', label: 'Paper', description: 'Warm cream and ink, easy on the eyes.', light: PAPER_LIGHT, dark: PAPER_DARK }),
  graphite: Object.freeze<UiTheme>({ id: 'graphite', label: 'Graphite', description: 'Neutral greys with a quiet slate accent.', light: GRAPHITE_LIGHT, dark: GRAPHITE_DARK }),
  'high-contrast': Object.freeze<UiTheme>({ id: 'high-contrast', label: 'High Contrast', description: 'Maximum legibility: black, white and bold accents.', light: HIGH_CONTRAST_LIGHT, dark: HIGH_CONTRAST_DARK }),
});

/**
 * Type guard narrowing an unknown value to UiThemeId.
 *
 * @purpose Validates that a runtime value is one of the known built-in theme ids before it is used as a key into UI_THEMES.
 * @inputs value - The untyped candidate value (typically from parsed settings or user input).
 * @outputs boolean type predicate - True when `value` is a string present in UI_THEME_IDS, narrowing `value` to UiThemeId at the call site.
 * @dataflow Unknown runtime value -> typeof check -> membership test against UI_THEME_IDS -> narrowed boolean result.
 * @controlflow Reject non-strings first (guard clause) then test array membership; returns false on either failure.
 */
export function isUiThemeId(value: unknown): value is UiThemeId {
  // Reject anything that isn't a string before attempting membership, avoiding prototype-pollution surprises from Array.prototype.includes.
  return typeof value === 'string' && (UI_THEME_IDS as readonly string[]).includes(value);
}

/**
 * Returns the light or dark token set for a theme id and mode.
 *
 * @purpose Direct lookup of a frozen ThemeTokens variant without resolving system preference, useful when the caller already knows the concrete mode.
 * @inputs id - The built-in theme id (must be present in UI_THEMES).
 * @inputs mode - The concrete ThemeModeName ('light' | 'dark') selecting which variant to return.
 * @outputs ThemeTokens - The frozen token set for that theme and mode.
 * @dataflow UI_THEMES[id] -> [mode] accessor -> returned ThemeTokens; no transformation applied.
 * @controlflow Single indexed lookup with no branching; an unknown id throws a TypeError from the undefined access.
 */
export function uiThemeTokens(id: UiThemeId, mode: ThemeModeName): ThemeTokens {
  return UI_THEMES[id][mode];
}

/**
 * Resolves the active theme tokens across explicit and system modes.
 *
 * @purpose Selects a frozen ThemeTokens variant from an id given either an explicit light/dark preference or a 'system' mode that defers to the OS dark-mode state.
 * @inputs id - The built-in theme id (must be present in UI_THEMES).
 * @inputs mode - The user's mode selection: 'light', 'dark', or 'system'.
 * @inputs systemPrefersDark - Boolean from prefers-color-scheme indicating whether the OS currently prefers dark.
 * @outputs ThemeTokens - The resolved frozen token set for the theme and effective mode.
 * @dataflow UI_THEMES[id] -> light/dark variants -> conditional selection by mode + system boolean -> returned ThemeTokens.
 * @controlflow Branch on 'dark' first, then 'light', then fall through to the system preference ternary when mode is 'system'; each branch returns immediately.
 */
export function resolveUiTheme(id: UiThemeId, mode: 'light' | 'dark' | 'system', systemPrefersDark: boolean): ThemeTokens {
  // Explicit dark request short-circuits before any other consideration.
  if (mode === 'dark') {
    return UI_THEMES[id].dark;
  }

  // Explicit light request short-circuits as well.
  if (mode === 'light') {
    return UI_THEMES[id].light;
  }

  // Mode is 'system': defer to the OS preference, choosing dark or light via a ternary fallback.
  return systemPrefersDark ? UI_THEMES[id].dark : UI_THEMES[id].light;
}

/**
 * Returns a frozen three-colour chrome swatch for a theme id and mode.
 *
 * @purpose Extracts the base, accent, and tertiary chrome colours as an immutable tuple for previews and palette displays without exposing the full chrome object.
 * @inputs id - The built-in theme id (must be present in UI_THEMES).
 * @inputs mode - The concrete ThemeModeName ('light' | 'dark') selecting which variant's chrome to read.
 * @outputs readonly [string, string, string] - A frozen tuple of [base, accent, tertiary] hex colours from the theme's chrome palette.
 * @dataflow UI_THEMES[id][mode].chrome -> destructure base/accent/tertiary -> Object.freeze immutable tuple.
 * @controlflow Single property read path with no branching; an unknown id throws a TypeError from the undefined access.
 */
export function uiThemeSwatch(id: UiThemeId, mode: ThemeModeName): readonly [string, string, string] {
  const chrome = UI_THEMES[id][mode].chrome;
  return Object.freeze([chrome.base, chrome.accent, chrome.tertiary] as const);
}