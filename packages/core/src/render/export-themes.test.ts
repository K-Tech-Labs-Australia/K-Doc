/**
 * @file export-themes.test.ts
 * @purpose Vitest test suite for K-Doc's export themes (packages/core/src/render/export-themes.ts).
 *   Verifies builtInThemeCss and builtInThemeNames against DEFAULT_EXPORT_THEME, the shipped EXPORT_STYLESHEET, and the EXPORT_THEMES registry.
 * @inputs Theme names 'default', 'serif', 'compact', 'plain'; unknown/empty theme names; the shipped export stylesheet EXPORT_STYLESHEET; the EXPORT_THEMES registry.
 * @outputs Vitest assertions on theme CSS strings, ordered built-in theme names, null resolution for unknown themes, and name/key correspondence with EXPORT_THEMES.
 * @functions None.
 * @dataflow builtInThemeCss / builtInThemeNames -> Vitest assertions on CSS output, ordering, and registry keys.
 * @controlflow Run a single describe block per theme property; each it asserts one invariant — default-first ordering, default stylesheet parity, theme extension over the base sheet, an empty plain theme, null for unknown names, and name/key correspondence.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_STYLESHEET } from './html.js';
import { builtInThemeCss, builtInThemeNames, DEFAULT_EXPORT_THEME, EXPORT_THEMES } from './export-themes.js';

describe('export themes', () => {
  // Guards the default theme is offered first and the full ordered set of built-in theme names matches the expected list.
  it('offers the default first', () => {
    expect(builtInThemeNames()[0]).toBe(DEFAULT_EXPORT_THEME);
    expect(builtInThemeNames()).toEqual(['default', 'serif', 'compact', 'plain']);
  });

  // Guards the default theme renders to exactly the stylesheet K-Doc ships, verbatim.
  it('is the stylesheet K-Doc ships, by default', () => {
    expect(builtInThemeCss('default')).toBe(EXPORT_STYLESHEET);
  });

  // Guards serif and compact themes extend the shipped stylesheet verbatim as a prefix and layer their own overrides on top.
  it('builds a theme on the default stylesheet, so nothing it does not mention is unstyled', () => {
    const serif = builtInThemeCss('serif') ?? '';
    expect(serif.startsWith(EXPORT_STYLESHEET)).toBe(true);
    expect(serif).toContain('Georgia');
    const compact = builtInThemeCss('compact') ?? '';
    expect(compact.startsWith(EXPORT_STYLESHEET)).toBe(true);
    expect(compact).toContain('font-size: 14px');
  });

  // Guards the plain theme ships with no stylesheet at all.
  it('has a theme with no stylesheet at all', () => {
    expect(builtInThemeCss('plain')).toBe('');
  });

  // Guards unknown and empty theme names resolve to null rather than throwing or returning a fallback.
  it('knows no theme by another name', () => {
    expect(builtInThemeCss('house style')).toBeNull();
    expect(builtInThemeCss('')).toBeNull();
  });

  // Guards the ordered built-in theme names match exactly the keys of the EXPORT_THEMES registry.
  it('names every theme it has', () => {
    expect(builtInThemeNames()).toEqual(Object.keys(EXPORT_THEMES));
  });
});
