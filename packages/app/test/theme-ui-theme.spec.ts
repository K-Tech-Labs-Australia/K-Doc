// @vitest-environment jsdom
/**
 * @file theme-ui-theme.spec.ts
 * @purpose Verifies installTheme's reader UI theme support: defaulting to K-Doc's own palette, applying a chosen UI theme, switching themes and modes independently, following the OS color scheme within a UI theme, and restoring the built-in palette when returning to 'kdoc'.
 * @inputs Document/Window instances (via fakeWindow), ThemeMode strings ('light' | 'dark' | 'system'), and UiThemeId values passed to installTheme/setUiTheme/setMode.
 * @outputs Assertions on controller.tokens, controller.uiTheme, document.documentElement dataset attributes, and the #kdoc-theme <style> text content.
 * @functions
 *   - fakeWindow: Builds a minimal Window whose matchMedia reports prefersDark for any query string.
 *   - describe/it blocks: Exercise each UI theme behavior contract from the installTheme blueprint.
 * @dataflow installTheme call → resolveUiTheme(uiTheme, mode, systemPrefersDark) → controller.tokens & dataset.kdocUiTheme/kdocTheme assertions.
 * @controlflow afterEach teardown (destroy + reset state) → per-case install then assertion sequence with setMode/setUiTheme mutations interleaved between reads.
 * @version 1
 * @date 2026-10-06
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, UI_THEMES } from '@k-doc/config';
import { installTheme, type ThemeController } from '../src/shell/theme.js';

/** Builds a Window stub whose matchMedia reports prefersDark for any query. */
function fakeWindow(prefersDark: boolean): Window {
  return {
    matchMedia: (query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: (): undefined => undefined,
      removeEventListener: (): undefined => undefined,
    }),
  } as unknown as Window;
}

describe('installTheme UI theme support', () => {
  let controller: ThemeController | undefined;

  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    delete document.documentElement.dataset.kdocUiTheme;
  });

  it("uses K-Doc's own palette when no UI theme is given", () => {
    controller = installTheme(document, fakeWindow(false), 'light');
    expect(controller.tokens).toBe(LIGHT_THEME);
    expect(controller.uiTheme).toBe('kdoc');
    expect(document.documentElement.dataset.kdocUiTheme).toBe('kdoc');
  });

  it('starts with the UI theme it is given', () => {
    controller = installTheme(document, fakeWindow(false), 'dark', 'nord');
    expect(controller.tokens).toBe(UI_THEMES.nord.dark);
    expect(document.documentElement.dataset.kdocTheme).toBe('dark');
  });

  it('switches UI theme and keeps the mode', () => {
    controller = installTheme(document, fakeWindow(false), 'light', 'kdoc');
    controller.setUiTheme('paper');
    expect(controller.tokens).toBe(UI_THEMES.paper.light);
    expect(controller.uiTheme).toBe('paper');
    expect(document.documentElement.dataset.kdocUiTheme).toBe('paper');
    const style = document.getElementById('kdoc-theme') as HTMLStyleElement;
    expect(style.textContent).toContain(UI_THEMES.paper.light.color.background);
  });

  it('keeps the UI theme when the mode changes', () => {
    controller = installTheme(document, fakeWindow(false), 'light', 'solarized');
    controller.setMode('dark');
    expect(controller.tokens).toBe(UI_THEMES.solarized.dark);
  });

  it('follows the system preference within the UI theme', () => {
    controller = installTheme(document, fakeWindow(true), 'system', 'graphite');
    expect(controller.tokens).toBe(UI_THEMES.graphite.dark);
  });

  it('switching back to kdoc restores the built-in palette', () => {
    controller = installTheme(document, fakeWindow(false), 'dark', 'high-contrast');
    controller.setUiTheme('kdoc');
    expect(controller.tokens).toBe(DARK_THEME);
  });
});