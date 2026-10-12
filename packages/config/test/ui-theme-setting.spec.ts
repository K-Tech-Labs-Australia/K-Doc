/**
 * @file ui-theme-setting.spec.ts
 * @purpose Verifies that appearance.uiTheme parses and validates input, round-trips through serializeSettings, falls back to kdoc on invalid values, and does not disturb sibling settings or surface as an unknown key.
 * @inputs JSON strings fed into parseSettings; the UI_THEME_IDS constant for parameterised valid-id cases.
 * @outputs Parsed {settings, problems, unknownKeys} objects whose fields are asserted against expected values via Vitest matchers.
 * @functions none — pure Vitest describe/it callbacks only; no exported functions.
 * @dataflow Raw JSON string → parseSettings → {settings, problems, unknownKeys} → expect assertions; serializeSettings(settings) → JSON string → re-parsed by parseSettings for the round-trip case.
 * @controlflow describe('appearance.uiTheme') groups six cases in order: default value resolution, acceptance of every registered id, invalid-value fallback with warning, sibling theme preservation, save/reload round-trip, and unknown-key exclusion.
 * @version 1
 * @date 2026-10-06
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, UI_THEME_IDS } from '../src/index.js';

describe('appearance.uiTheme', () => {
  // Case 1: default value — both the exported constant and an empty config resolve to kdoc.
  it("defaults to K-Doc's own colours", () => {
    expect(DEFAULT_SETTINGS.appearance.uiTheme).toBe('kdoc');
    expect(parseSettings('{}').settings.appearance.uiTheme).toBe('kdoc');
  });

  // Case 2: every registered theme id is accepted and yields no problem for this path.
  it.each(UI_THEME_IDS)('reads %s', (id) => {
    const result = parseSettings(JSON.stringify({ appearance: { uiTheme: id } }));
    expect(result.settings.appearance.uiTheme).toBe(id);
    // A recognised theme must not generate a validation problem on the uiTheme path.
    expect(result.problems.some(p => p.path === 'appearance.uiTheme')).toBe(false);
  });

  // Case 3: invalid values fall back to kdoc and emit a warning recorded against this path.
  it.each([['an unknown name', 'solarised'], ['the wrong case', 'Nord'], ['a number', 3], ['null', null]])(
    'falls back to kdoc and warns for %s',
    (_l, value) => {
      const result = parseSettings(JSON.stringify({ appearance: { uiTheme: value } }));
      expect(result.settings.appearance.uiTheme).toBe('kdoc');
      // A warning must be present specifically on the appearance.uiTheme path.
      const problem = result.problems.find(p => p.path === 'appearance.uiTheme');
      expect(problem?.severity).toBe('warning');
    },
  );

  // Case 4: validating uiTheme must leave an unrelated light/dark theme value untouched.
  it('leaves the light/dark mode alone', () => {
    const result = parseSettings(JSON.stringify({ appearance: { theme: 'dark', uiTheme: 'paper' } }));
    expect(result.settings.appearance.theme).toBe('dark');
    expect(result.settings.appearance.uiTheme).toBe('paper');
  });

  // Case 5: a parsed value survives serialization and re-parsing unchanged.
  it('survives a save and reload', () => {
    const first = parseSettings(JSON.stringify({ appearance: { uiTheme: 'graphite' } })).settings;
    const again = parseSettings(serializeSettings(first)).settings;
    expect(again.appearance.uiTheme).toBe('graphite');
    // The serialized form itself must carry the value before it is re-parsed.
    expect(JSON.parse(serializeSettings(first)).appearance.uiTheme).toBe('graphite');
  });

  // Case 6: a recognised uiTheme id is not surfaced as an unknown key.
  it('is not reported as an unknown key', () => {
    const result = parseSettings(JSON.stringify({ appearance: { uiTheme: 'nord' } }));
    expect(Object.keys(result.unknownKeys)).not.toContain('appearance.uiTheme');
  });
});