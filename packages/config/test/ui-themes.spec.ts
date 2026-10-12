/**
 * @file ui-themes.spec.ts
 * @purpose Exercises the UI theme catalogue module (ui-themes.ts): picker order, per-id keying, K-Doc identity with
 *   the baseline themes, deep freezing of the catalogue, id validation, explicit-mode token retrieval, system-mode
 *   resolution, swatch extraction, and WCAG 2.2 AA contrast compliance across every theme variant's colour and chrome pairs.
 * @inputs Frozen UI_THEMES catalogue, DEFAULT_UI_THEME, UI_THEME_IDS, isUiThemeId/uiThemeTokens/resolveUiTheme/uiThemeSwatch;
 *   baseline LIGHT_THEME/DARK_THEME, CONTRAST_AA_NORMAL/LARGE, and contrastRatio from tokens.js.
 * @outputs Vitest assertions covering catalogue shape, immutability, ordering, id validation, mode resolution, swatches, and AA ratios.
 * @functions
 *   - (describe) ui-themes: top-level suite grouping all UI theme contract checks.
 *   - lists the six themes in picker order: asserts canonical order and default selection.
 *   - keys every theme by its own id: asserts identity keying plus non-empty label/description.
 *   - keeps K-Doc's own palette as the default theme: asserts kdoc variants are the baseline themes (identity).
 *   - freezes the catalogue: asserts Object.isFrozen on the record, an entry, a variant, and its chrome layer.
 *   - exposes exactly the token names K-Doc does: per-variant key-set parity with LIGHT_THEME across all four layers.
 *   - names its mode: asserts each variant name ends in ' Light' / ' Dark'.
 *   - meets WCAG AA for every checked pairing: contrast ratio >= minimum for colour and chrome pairs.
 *   - recognises only exact theme ids: isUiThemeId true for canonical ids, false for invalid/near-miss inputs.
 *   - returns the variant for an explicit mode: uiThemeTokens maps id+mode to the frozen variant.
 *   - resolves light, dark and system: resolveUiTheme honours explicit modes and OS preference.
 *   - paints a swatch from the variant chrome: uiThemeSwatch returns [base, accent, tertiary].
 * @dataflow Frozen catalogue + baseline themes & contrast utilities → per-variant assertions → pass/fail results.
 * @controlflow Define constants (VARIANTS, COLOR_PAIRS, CHROME_PAIRS) → run ordered describe blocks → assert each contract in turn.
 * @version 1
 * @date 2026-10-06
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_THEME, UI_THEME_IDS, UI_THEMES, isUiThemeId, resolveUiTheme, uiThemeSwatch, uiThemeTokens } from '../src/theme/ui-themes.js';
import { CONTRAST_AA_LARGE, CONTRAST_AA_NORMAL, DARK_THEME, LIGHT_THEME, contrastRatio, type ThemeTokens } from '../src/theme/tokens.js';

// Every theme variant paired with its resolved tokens for describe.each iteration.
const VARIANTS: Array<readonly [string, ThemeTokens]> = UI_THEME_IDS.flatMap((id) => [[`${id} light`, UI_THEMES[id].light] as const, [`${id} dark`, UI_THEMES[id].dark] as const]);

// Document colour foreground/background pairs with their required WCAG AA minimum (N = normal text, L = large/text-contrast).
const COLOR_PAIRS: ReadonlyArray<readonly [keyof ThemeTokens['color'], keyof ThemeTokens['color'], number]> = [
  ['text', 'background', CONTRAST_AA_NORMAL],
  ['text', 'backgroundElevated', CONTRAST_AA_NORMAL],
  ['text', 'backgroundSubtle', CONTRAST_AA_NORMAL],
  ['textMuted', 'background', CONTRAST_AA_NORMAL],
  ['textMuted', 'backgroundElevated', CONTRAST_AA_NORMAL],
  ['accent', 'background', CONTRAST_AA_NORMAL],
  ['accentText', 'accent', CONTRAST_AA_NORMAL],
  ['danger', 'background', CONTRAST_AA_NORMAL],
  ['warning', 'background', CONTRAST_AA_NORMAL],
  ['success', 'background', CONTRAST_AA_NORMAL],
  ['codeText', 'codeBackground', CONTRAST_AA_NORMAL],
  ['borderStrong', 'background', CONTRAST_AA_LARGE],
];

// Chrome foreground/background pairs with their required WCAG AA minimum (N = normal, L = large/text-contrast).
const CHROME_PAIRS: ReadonlyArray<readonly [keyof ThemeTokens['chrome'], keyof ThemeTokens['chrome'], number]> = [
  ['text', 'base', CONTRAST_AA_NORMAL],
  ['text', 'raised', CONTRAST_AA_NORMAL],
  ['text', 'containerLow', CONTRAST_AA_NORMAL],
  ['textMuted', 'base', CONTRAST_AA_NORMAL],
  ['textMuted', 'containerLow', CONTRAST_AA_NORMAL],
  ['onAccent', 'accent', CONTRAST_AA_NORMAL],
  ['onSelected', 'selected', CONTRAST_AA_NORMAL],
  ['onTertiaryContainer', 'tertiaryContainer', CONTRAST_AA_NORMAL],
  ['tertiary', 'base', CONTRAST_AA_NORMAL],
  ['accent', 'base', CONTRAST_AA_LARGE],
  ['edge', 'base', CONTRAST_AA_LARGE],
  ['edge', 'raised', CONTRAST_AA_LARGE],
  ['edge', 'containerLow', CONTRAST_AA_LARGE],
];

describe('ui-themes', () => {
  it('lists the six themes in picker order', () => {
    expect([...UI_THEME_IDS]).toEqual(['kdoc', 'nord', 'solarized', 'paper', 'graphite', 'high-contrast']);
    expect(DEFAULT_UI_THEME).toBe('kdoc');
  });

  it('keys every theme by its own id', () => {
    for (const id of UI_THEME_IDS) {
      // Each catalogue entry must be keyed under and carry its own canonical id.
      expect(UI_THEMES[id].id, `${id}.id`).toBe(id);
      // Labels and descriptions are user-facing strings that must never be empty.
      expect(UI_THEMES[id].label.length).toBeGreaterThan(0);
      expect(UI_THEMES[id].description.length).toBeGreaterThan(0);
    }
  });

  it("keeps K-Doc's own palette as the default theme", () => {
    // The kdoc variant is identity-equal to the baseline themes, not a copy.
    expect(UI_THEMES.kdoc.light).toBe(LIGHT_THEME);
    expect(UI_THEMES.kdoc.dark).toBe(DARK_THEME);
  });

  it('freezes the catalogue', () => {
    // The record and every nested layer must be deeply frozen to prevent mutation at runtime.
    expect(Object.isFrozen(UI_THEMES)).toBe(true);
    expect(Object.isFrozen(UI_THEMES.nord)).toBe(true);
    expect(Object.isFrozen(UI_THEMES.nord.light)).toBe(true);
    expect(Object.isFrozen(UI_THEMES.nord.light.chrome)).toBe(true);
  });

  describe.each(VARIANTS)('%s', (_name, theme) => {
    it('exposes exactly the token names K-Doc does', () => {
      // Document colour key set must match K-Doc's light theme exactly.
      expect(Object.keys(theme.color).sort()).toEqual(Object.keys(LIGHT_THEME.color).sort());
      // Chrome, emissive, and radius key sets must also match exactly across all four layers.
      expect(Object.keys(theme.chrome).sort()).toEqual(Object.keys(LIGHT_THEME.chrome).sort());
      expect(Object.keys(theme.emissive).sort()).toEqual(Object.keys(LIGHT_THEME.emissive).sort());
      expect(Object.keys(theme.radius).sort()).toEqual(Object.keys(LIGHT_THEME.radius).sort());
    });

    it('names its mode', () => {
      // The variant name must end with the human-readable mode suffix for light or dark.
      expect(theme.name.endsWith(theme.mode === 'light' ? ' Light' : ' Dark')).toBe(true);
    });

    it('meets WCAG AA for every checked pairing', () => {
      // Document colour pairs against their required normal/large minimums.
      for (const [fgKey, bgKey, min] of COLOR_PAIRS) {
        const fg = theme.color[fgKey];
        const bg = theme.color[bgKey];
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${theme.name}: ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}, needs ${min}`).toBeGreaterThanOrEqual(min);
      }

      // Chrome pairs against their required minimums; values are strings indexed with the typed keys.
      for (const [fgKey, bgKey, min] of CHROME_PAIRS) {
        const fg = theme.chrome[fgKey];
        const bg = theme.chrome[bgKey];
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${theme.name}: ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}, needs ${min}`).toBeGreaterThanOrEqual(min);
      }
    });
  });

  it('recognises only exact theme ids', () => {
    // Every canonical id must be recognised.
    for (const id of UI_THEME_IDS) {
      expect(isUiThemeId(id)).toBe(true);
    }

    // Invalid inputs are rejected, including near-misses like wrong case, trailing whitespace, and non-string types.
    const invalid: unknown[] = ['Nord', '', 'kdoc ', 42, null, undefined, {}];
    for (const value of invalid) {
      expect(isUiThemeId(value), `expected ${String(value)} to be rejected`).toBe(false);
    }
  });

  it('returns the variant for an explicit mode', () => {
    // uiThemeTokens maps id+mode directly onto the frozen variant (identity, not a copy).
    expect(uiThemeTokens('paper', 'dark')).toBe(UI_THEMES.paper.dark);
  });

  it('resolves light, dark and system', () => {
    for (const id of UI_THEME_IDS) {
      const light = UI_THEMES[id].light;
      const dark = UI_THEMES[id].dark;
      // Explicit modes always win over the OS preference.
      expect(resolveUiTheme(id, 'light', true), `${id} explicit light`).toBe(light);
      expect(resolveUiTheme(id, 'dark', false), `${id} explicit dark`).toBe(dark);
      // System mode follows the OS preference: dark when preferred, light otherwise.
      expect(resolveUiTheme(id, 'system', true), `${id} system prefers dark`).toBe(dark);
      expect(resolveUiTheme(id, 'system', false), `${id} system prefers light`).toBe(light);
    }
  });

  it('paints a swatch from the variant chrome', () => {
    // uiThemeSwatch returns [base, accent, tertiary] taken directly from the dark nord chrome.
    expect(uiThemeSwatch('nord', 'dark')).toEqual([UI_THEMES.nord.dark.chrome.base, UI_THEMES.nord.dark.chrome.accent, UI_THEMES.nord.dark.chrome.tertiary]);
  });
});