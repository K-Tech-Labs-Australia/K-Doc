/**
 * @file theme.spec.ts
 * @purpose Vitest test suite for K-Doc theme tokens, relative luminance, WCAG 2.2 AA contrast compliance, CSS variable generation, and theme resolution.
 * @inputs ThemeTokens configurations (LIGHT_THEME, DARK_THEME), hex color strings, contrast thresholds, and theme resolution modes.
 * @outputs Vitest assertions verifying luminance calculations, contrast ratios, WCAG AA compliance gates, CSS variable generation, and token contract parity.
 * @functions
 *   - assertPairs: Evaluates and asserts contrast ratio compliance for an array of color token pairs against a minimum threshold with detailed diagnostic failure messages.
 * @dataflow Theme definitions / hex strings -> relativeLuminance / contrastRatio / toCssVariables / resolveTheme -> computed ratios, CSS declarations, and resolved themes -> equality and threshold assertions.
 * @controlflow Execute test suites across relativeLuminance, contrastRatio, WCAG AA compliance (parameterized by theme), toCssVariables, resolveTheme, and token contract drift prevention.
 * @version 1
 * @date 2026-09-04
 */

import { describe, expect, it } from 'vitest';
import {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_NORMAL,
  DARK_THEME,
  LIGHT_THEME,
  contrastRatio,
  relativeLuminance,
  resolveTheme,
  toCssVariables,
  type ThemeColors,
  type ThemeTokens,
} from '../src/index.js';

/**
 * Asserts that a list of foreground and background token pairs in a theme meets or exceeds the required minimum contrast ratio.
 *
 * @purpose Evaluates contrast ratios for color pairings in a ThemeTokens object and verifies compliance against WCAG thresholds with descriptive failure messages.
 * @inputs theme - The ThemeTokens instance whose color palette is being tested.
 * @inputs pairs - A readonly array of tuples specifying [foregroundKey, backgroundKey, minimumRatio].
 * @outputs void - Asserts contrast ratio >= minimum for every pair, throwing on failure with detailed diagnostic text.
 * @dataflow Theme token keys -> index theme.color palette -> compute contrastRatio -> compare against minimum -> vitest assertion.
 * @controlflow Loop over each pair tuple -> retrieve foreground and background colors -> check for defined color strings -> calculate contrast ratio -> format diagnostic message -> assert ratio >= minimum threshold.
 */
function assertPairs(
  theme: ThemeTokens,
  pairs: ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors, number]>
): void {
  // When this test fails, whoever changed a colour must be able to see immediately which pairing
  // broke and by how much, without reading the source.
  for (const [foregroundKey, backgroundKey, minimum] of pairs) {
    const fgColor = theme.color[foregroundKey];
    const bgColor = theme.color[backgroundKey];

    // Check if both foreground and background color strings are defined.
    if (typeof fgColor === 'string' && typeof bgColor === 'string') {
      const actualRatio = contrastRatio(fgColor, bgColor);
      const roundedRatio = actualRatio.toFixed(2);
      const message = `Theme "${theme.name}" pairing failed: ${String(foregroundKey)} on ${String(backgroundKey)} has contrast ratio ${roundedRatio}, required minimum is ${minimum}`;

      // Check that computed contrast ratio meets or exceeds the required minimum.
      expect(actualRatio, message).toBeGreaterThanOrEqual(minimum);
    } else {
      // Unreachable for valid themes, but handles possibly undefined index access under noUncheckedIndexedAccess.
      expect.fail(
        `Theme "${theme.name}" missing token: foregroundKey=${String(foregroundKey)} (${String(fgColor)}), backgroundKey=${String(backgroundKey)} (${String(bgColor)})`
      );
    }
  }
}

const AA_NORMAL_PAIRS: ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors, number]> = [
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
];

// Non-text boundary pairing where the lower threshold (CONTRAST_AA_LARGE = 3.0) is the applicable standard.
const AA_LARGE_PAIRS: ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors, number]> = [
  ['borderStrong', 'background', CONTRAST_AA_LARGE],
];

describe('relativeLuminance', () => {
  it('computes 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepts three-digit shorthand hex (#fff equals #ffffff)', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 5);
  });

  it('accepts a missing leading hash and mixed case', () => {
    expect(relativeLuminance('FFF')).toBeCloseTo(relativeLuminance('#ffffff'), 5);
  });

  it('throws RangeError for malformed hex strings', () => {
    // A malformed colour in a theme is a developer error that must surface immediately,
    // unlike a malformed user setting which degrades gracefully to defaults.
    expect(() => relativeLuminance('#12345')).toThrow(RangeError);
    expect(() => relativeLuminance('not-a-colour')).toThrow(RangeError);
    expect(() => relativeLuminance('')).toThrow(RangeError);
  });
});

describe('contrastRatio', () => {
  it('computes 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('returns exactly 1 for identical colours', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#0969da', '#0969da')).toBe(1);
  });

  it('is order-independent for color arguments', () => {
    const colorA = '#0969da';
    const colorB = '#ffffff';
    expect(contrastRatio(colorA, colorB)).toBe(contrastRatio(colorB, colorA));
  });
});

describe('WCAG AA compliance', () => {
  describe.each([
    ['light', LIGHT_THEME],
    ['dark', DARK_THEME],
  ])('%s theme', (_themeName: string, theme: ThemeTokens) => {
    it('satisfies CONTRAST_AA_NORMAL (4.5:1) for text, status, and accent pairings', () => {
      assertPairs(theme, AA_NORMAL_PAIRS);
    });

    it('satisfies CONTRAST_AA_LARGE (3.0:1) for UI boundary pairings', () => {
      // `borderStrong` is the token used for interactive control boundaries and focus indicators,
      // which is exactly what SC 1.4.11 covers; `border` is a decorative divider and is deliberately
      // exempt from this assertion.
      assertPairs(theme, AA_LARGE_PAIRS);
    });
  });
});

describe('toCssVariables', () => {
  it('converts camelCase token names to kebab-case custom properties', () => {
    const css = toCssVariables(LIGHT_THEME);
    expect(css).toContain('--kdoc-color-background:');
    expect(css).toContain('--kdoc-color-background-elevated:');
  });

  it('produces exactly one declaration line per token across every token group', () => {
    const css = toCssVariables(LIGHT_THEME);
    // Every token group the emitter walks, plus the two derived elevation shadows it composes
    // from the chrome tokens. Counting the groups rather than a hard-coded total means adding a
    // token to any group keeps this test honest instead of needing the number edited by hand.
    const DERIVED_ELEVATION_DECLARATIONS = 2;
    const totalColorKeys =
      Object.keys(LIGHT_THEME.color).length +
      Object.keys(LIGHT_THEME.chrome).length +
      Object.keys(LIGHT_THEME.emissive).length +
      Object.keys(LIGHT_THEME.radius).length +
      DERIVED_ELEVATION_DECLARATIONS;
    const declarationLines = css
      .trim()
      .split('\n')
      .filter((line: string): boolean => {
        // Check if the trimmed line contains content.
        if (line.trim().length > 0) {
          return true;
        } else {
          return false;
        }
      });
    expect(declarationLines.length).toBe(totalColorKeys);
  });

  it('honours a custom prefix when provided', () => {
    const css = toCssVariables(LIGHT_THEME, '--x');
    expect(css).toContain('--x-color-text:');
  });

  it('contains no selector or braces so the caller controls placement', () => {
    const css = toCssVariables(LIGHT_THEME);
    // The output contains no selector or brace because the caller decides where the
    // declarations go (e.g. :root, [data-theme="dark"], or a style element).
    expect(css).not.toContain('{');
    expect(css).not.toContain('}');
  });
});

describe('resolveTheme', () => {
  it('returns LIGHT_THEME for "light" mode regardless of system preference flag', () => {
    expect(resolveTheme('light', false)).toBe(LIGHT_THEME);
    expect(resolveTheme('light', true)).toBe(LIGHT_THEME);
  });

  it('returns DARK_THEME for "dark" mode regardless of system preference flag', () => {
    expect(resolveTheme('dark', false)).toBe(DARK_THEME);
    expect(resolveTheme('dark', true)).toBe(DARK_THEME);
  });

  it('returns theme following system preference flag when mode is "system"', () => {
    // When mode is 'system' and systemPrefersDark is true, returns DARK_THEME.
    expect(resolveTheme('system', true)).toBe(DARK_THEME);
    // When mode is 'system' and systemPrefersDark is false, returns LIGHT_THEME.
    expect(resolveTheme('system', false)).toBe(LIGHT_THEME);
  });
});

describe('token contract', () => {
  it('ensures both themes expose exactly the same set of colour token names', () => {
    // A token present in one theme and missing from the other would leave a user theme half-styled,
    // and this test is the guard against that drift.
    const lightKeys = Object.keys(LIGHT_THEME.color).sort();
    const darkKeys = Object.keys(DARK_THEME.color).sort();

    expect(lightKeys).toEqual(darkKeys);
  });
});
