/**
 * @file keyboard-settings.spec.ts
 * @purpose Verifies parsing, validation, serialization of the "keyboard" section (FR-14.15/FR-14.16) and its integration into the whole settings.json schema.
 * @inputs Raw JSON values for the keyboard section; a whole-file settings.json string; an array of layered settings objects.
 * @outputs Assertions on parsed KeyboardSettings, collected KeyboardProblem diagnostics, preserved unknown keys, and serialized output.
 * @functions
 *   - parse: Helper wrapping parseKeyboardSection with fresh problem/unknown-key collectors.
 *   - describe('the keyboard settings section'): Unit tests for the standalone keyboard section logic.
 *   - describe('the keyboard section in settings.json'): Integration tests through the whole-file schema and layer merging.
 * @dataflow Test input → parseKeyboardSection / serializeKeyboardSection / parseSettings / serializeSettings → expect() assertions against exact expected values.
 * @controlflow For each scenario, build a parse result, then assert settings, problems, and unknown keys match exactly; return on completion.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYBOARD_SETTINGS, parseKeyboardSection, serializeKeyboardSection, type KeyboardProblem } from '../src/keymap/keyboard-settings.js';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from '../src/index.js';

/**
 * Helper that runs parseKeyboardSection with fresh collectors so each test starts clean.
 *
 * @purpose Wraps parseKeyboardSection behind a single-argument API for concise test setup.
 * @inputs value - The raw JSON value of the "keyboard" section to validate.
 * @outputs { settings, problems, unknown } - Validated KeyboardSettings, collected diagnostics, and preserved unknown keys.
 * @dataflow value → parseKeyboardSection(value, problems, unknown) → three-part result object.
 * @controlflow Allocate fresh lists → call parseKeyboardSection once → return the three-part result.
 */
function parse(value: unknown): { settings: ReturnType<typeof parseKeyboardSection>; problems: KeyboardProblem[]; unknown: Record<string, unknown> } {
  const problems: KeyboardProblem[] = [];
  const unknown: Record<string, unknown> = {};
  // Return the validated settings alongside the diagnostics and preserved keys produced during parsing.
  return { settings: parseKeyboardSection(value, problems, unknown), problems, unknown };
}

describe('the keyboard settings section', (): void => {
  it('defaults to the Word preset with no changes', (): void => {
    const r = parse(undefined);
    expect(r.settings).toEqual({ preset: 'word', bindings: {} });
    expect(r.problems).toEqual([]);
    expect(DEFAULT_SETTINGS.keyboard).toBe(DEFAULT_KEYBOARD_SETTINGS);
  });

  it('reads a preset and bindings, writing chords canonically once', (): void => {
    const r = parse({ preset: 'typora', bindings: { 'format:bold': ['ctrl+alt+b', 'Ctrl+Alt+B'], 'format:italic': [] } });
    expect(r.settings).toEqual({ preset: 'typora', bindings: { 'format:bold': ['Ctrl+Alt+B'], 'format:italic': [] } });
    expect(r.problems).toEqual([]);
  });

  it('keeps fields and command ids it does not know', (): void => {
    const r = parse({ extra: 1, bindings: { 'future:command': ['Ctrl+Alt+Q'] } });
    expect(r.unknown).toEqual({ 'keyboard.extra': 1 });
    expect(r.settings.bindings).toEqual({ 'future:command': ['Ctrl+Alt+Q'] });
    expect(r.problems).toEqual([]);
  });

  it('warns about an unknown preset and keeps Word', (): void => {
    const r = parse({ preset: 'emacs' });
    expect(r.settings.preset).toBe('word');
    expect(r.problems.map((p) => [p.path, p.severity])).toEqual([['keyboard.preset', 'warning']]);
  });

  it('warns about each shortcut it cannot use and drops it', (): void => {
    const r = parse({ bindings: { 'format:bold': ['B', 7, 'Ctrl+B'] } });
    expect(r.settings.bindings).toEqual({ 'format:bold': ['Ctrl+B'] });
    expect(r.problems.map((p) => p.path)).toEqual(['keyboard.bindings.format:bold', 'keyboard.bindings.format:bold']);
  });

  it('warns about bindings that are not lists, or not an object', (): void => {
    expect(parse({ bindings: { 'format:bold': 'Ctrl+B' } }).problems.map((p) => p.path)).toEqual(['keyboard.bindings.format:bold']);
    expect(parse({ bindings: [] }).problems.map((p) => p.path)).toEqual(['keyboard.bindings']);
  });

  it('rejects a section that is not an object', (): void => {
    const r = parse([]);
    expect(r.settings).toBe(DEFAULT_KEYBOARD_SETTINGS);
    expect(r.problems.map((p) => [p.path, p.severity])).toEqual([['keyboard', 'error']]);
  });

  it('writes bindings sorted by command', (): void => {
    expect(JSON.stringify(serializeKeyboardSection({ preset: 'word', bindings: { 'z:cmd': ['F2'], 'a:cmd': [] } }))).toBe('{"preset":"word","bindings":{"a:cmd":[],"z:cmd":["F2"]}}');
  });
});

describe('the keyboard section in settings.json', (): void => {
  it('parses from and serializes into the whole file', (): void => {
    const loaded = parseSettings(JSON.stringify({ keyboard: { preset: 'vscode', bindings: { 'format:bold': ['Ctrl+Alt+B'] }, later: true } }));
    expect(loaded.settings.keyboard).toEqual({ preset: 'vscode', bindings: { 'format:bold': ['Ctrl+Alt+B'] } });
    const written = JSON.parse(serializeSettings(loaded.settings, loaded.unknownKeys)) as { keyboard: unknown };
    expect(written.keyboard).toEqual({ preset: 'vscode', bindings: { 'format:bold': ['Ctrl+Alt+B'] }, later: true });
  });

  it('reports the section\'s problems with the rest', (): void => {
    const loaded = parseSettings(JSON.stringify({ keyboard: { preset: 'emacs' } }));
    expect(loaded.problems.map((p) => p.path)).toContain('keyboard.preset');
  });
});
