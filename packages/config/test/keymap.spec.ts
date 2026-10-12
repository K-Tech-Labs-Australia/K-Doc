/**
 * @file keymap.spec.ts
 * @purpose Tests the keymap presets, resolver, and binding-change helpers for K-Doc.
 * @inputs KEYMAP_COMMANDS, KEYMAP_PRESET_IDS, WORD_BINDINGS, UNBOUND_SHORTCUT_EXPLANATIONS from presets.js; normalizeChord from chords.js; resolveKeymap, scopeOf, withBinding, withoutChord from keymap.js.
 * @outputs Vitest describe/it blocks asserting preset completeness, canonical chords, conflict freedom, per-preset keys, and override semantics.
 * @functions
 *   - the presets: Asserts Word covers every remappable command, chords are canonical, presets have no self-conflicts, follow the spec table, give each editor their own keys, leave explanatory shortcuts unbound, and scope commands correctly.
 *   - resolveKeymap: Asserts ordering, chord moves, unbinding, conflict precedence/reporting, loose parsing, and unknown-command filtering.
 *   - changing bindings: Asserts withBinding records/drops changes against preset defaults and withoutChord strips a chord from every other command while keeping others.
 * @dataflow Source modules under test → assertions in three describe blocks executed by Vitest.
 * @controlflow Load source modules; run the presets suite, then resolveKeymap, then changing bindings; each it asserts one behavior and throws on mismatch.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { normalizeChord } from '../src/keymap/chords.js';
import { KEYMAP_COMMANDS, KEYMAP_PRESET_IDS, UNBOUND_SHORTCUT_EXPLANATIONS, WORD_BINDINGS, presetBindings } from '../src/keymap/presets.js';
import { resolveKeymap, scopeOf, withBinding, withoutChord } from '../src/keymap/keymap.js';

describe('the presets', (): void => {
  // Every remappable command has a Word binding and nothing else does.
  it('gives every remappable command a Word binding and bind nothing else', (): void => {
    expect(Object.keys(WORD_BINDINGS).sort()).toEqual(KEYMAP_COMMANDS.map((c) => c.id).sort());
  });

  // Every chord in every preset is already written canonically.
  it('writes every chord canonically', (): void => {
    for (const preset of KEYMAP_PRESET_IDS) {
      for (const [id, chords] of Object.entries(presetBindings(preset))) {
        for (const chord of chords) {
          expect(normalizeChord(chord), `${preset} ${id} ${chord}`).toBe(chord);
        }
      }
    }
  });

  // No preset binds the same chord to two of its own commands.
  it('have no conflicts of their own', (): void => {
    for (const preset of KEYMAP_PRESET_IDS) {
      expect(resolveKeymap(preset, {}).conflicts, preset).toEqual([]);
    }
  });

  // Word follows the spec's table where Word and K-Doc disagree.
  it('follows the spec\'s Word table where Word and K-Doc disagree', (): void => {
    const word = resolveKeymap('word', {}).commandForChord;
    expect(word.get('Ctrl+P')).toBe('file:print');
    expect(word.get('Ctrl+Shift+O')).toBe('file:quick-open');
    expect(word.get('Ctrl+B')).toBe('format:bold');
    expect(word.get('Ctrl+Shift+B')).toBe('view:toggle-sidebar');
    expect(word.get('Ctrl+E')).toBe('format:inline-code');
    expect(word.get('Ctrl+Shift+L')).toBe('format:bullet-list');
    expect(word.get('Ctrl+Shift+Z')).toBe('edit:redo');
  });

  // Indentation outside a list answers to Word's keys and to the bracket aliases the spec names too.
  it('binds indentation to Word\'s keys and to the bracket aliases', (): void => {
    const word = resolveKeymap('word', {}).commandForChord;
    expect(word.get('Ctrl+M')).toBe('format:indent');
    expect(word.get('Ctrl+]')).toBe('format:indent');
    expect(word.get('Ctrl+Shift+M')).toBe('format:outdent');
    expect(word.get('Ctrl+[')).toBe('format:outdent');
  });

  // VS Code, Typora and Obsidian give their users their own keys.
  it('gives VS Code, Typora and Obsidian users their own keys', (): void => {
    expect(resolveKeymap('vscode', {}).commandForChord.get('Ctrl+P')).toBe('file:quick-open');
    expect(resolveKeymap('vscode', {}).commandForChord.get('Ctrl+B')).toBe('view:toggle-sidebar');
    expect(resolveKeymap('typora', {}).commandForChord.get('Ctrl+1')).toBe('format:heading-1');
    expect(resolveKeymap('typora', {}).commandForChord.get('Ctrl+Shift+L')).toBe('view:toggle-sidebar');
    expect(resolveKeymap('obsidian', {}).commandForChord.get('Ctrl+P')).toBe('view:command-palette');
    expect(resolveKeymap('obsidian', {}).bindings.get('format:inline-code')).toEqual([]);
  });

  // Word shortcuts that explain themselves stay unbound in the Word preset.
  it('leaves the Word shortcuts that explain themselves unbound in Word', (): void => {
    const word = resolveKeymap('word', {}).commandForChord;
    for (const chord of Object.keys(UNBOUND_SHORTCUT_EXPLANATIONS)) {
      expect(normalizeChord(chord), chord).toBe(chord);
      expect(word.get(chord), chord).toBeUndefined();
    }
  });

  // Each command resolves to the scope declared in its spec.
  it('scopes commands', (): void => {
    expect(scopeOf('format:bold')).toBe('editor');
    expect(scopeOf('edit:undo')).toBe('document');
    expect(scopeOf('file:save')).toBe('global');
    expect(scopeOf('nope')).toBeNull();
  });
});

describe('resolveKeymap', (): void => {
  // The resolved map lists every remappable command in KEYMAP_COMMANDS order.
  it('lists every remappable command in order', (): void => {
    expect([...resolveKeymap('word', {}).bindings.keys()]).toEqual(KEYMAP_COMMANDS.map((c) => c.id));
  });

  // Moving a command to the user's chord frees its old one.
  it('moves a command to the user\'s chord and frees the old one', (): void => {
    const map = resolveKeymap('word', { 'format:bold': ['Ctrl+Alt+B'] });
    expect(map.commandForChord.get('Ctrl+Alt+B')).toBe('format:bold');
    expect(map.commandForChord.get('Ctrl+B')).toBeUndefined();
    expect(map.bindings.get('format:bold')).toEqual(['Ctrl+Alt+B']);
  });

  // Giving a command no chords unbinds it.
  it('unbinds a command given no chords', (): void => {
    const map = resolveKeymap('word', { 'format:bold': [] });
    expect(map.bindings.get('format:bold')).toEqual([]);
    expect(map.commandForChord.get('Ctrl+B')).toBeUndefined();
  });

  // The user's binding wins a conflict with a preset one and the conflict is reported.
  it('lets the user\'s binding win a conflict with a preset one, and reports it', (): void => {
    const map = resolveKeymap('word', { 'format:italic': ['Ctrl+B'] });
    expect(map.commandForChord.get('Ctrl+B')).toBe('format:italic');
    expect(map.conflicts).toEqual([{ chord: 'Ctrl+B', commands: ['format:italic', 'format:bold'] }]);
  });

  // Loose chords are normalized, unreadable ones dropped, and repeats kept once.
  it('reads chords written loosely, dropping unreadable ones and repeats', (): void => {
    const map = resolveKeymap('word', { 'format:bold': ['ctrl+alt+b', 'Ctrl+Alt+B', 'B'] });
    expect(map.bindings.get('format:bold')).toEqual(['Ctrl+Alt+B']);
  });

  // Bindings for commands the resolver does not know are ignored.
  it('ignores bindings for commands it does not know', (): void => {
    const map = resolveKeymap('word', { 'future:command': ['Ctrl+Alt+Q'] });
    expect(map.commandForChord.get('Ctrl+Alt+Q')).toBeUndefined();
    expect(map.bindings.has('future:command')).toBe(false);
  });
});

describe('changing bindings', (): void => {
  // A change is recorded and dropped when set back to the preset default.
  it('records a change and drops it when set back to the preset', (): void => {
    const changed = withBinding('word', {}, 'format:bold', ['Ctrl+Alt+B']);
    expect(changed).toEqual({ 'format:bold': ['Ctrl+Alt+B'] });
    expect(withBinding('word', changed, 'format:bold', ['Ctrl+B'])).toEqual({});
  });

  // The preset's own chords, not Word's, are treated as the default.
  it('treats the preset\'s own chords, not Word\'s, as the default', (): void => {
    expect(withBinding('vscode', {}, 'file:quick-open', ['Ctrl+P'])).toEqual({});
    expect(withBinding('vscode', {}, 'file:quick-open', ['Ctrl+Shift+O'])).toEqual({ 'file:quick-open': ['Ctrl+Shift+O'] });
  });

  // Taking a chord away strips it from every other command.
  it('takes a chord away from every other command', (): void => {
    const overrides = { 'format:italic': ['Ctrl+B'] };
    const next = withoutChord('word', overrides, 'Ctrl+B', 'format:italic');
    expect(next).toEqual({ 'format:italic': ['Ctrl+B'], 'format:bold': [] });
    expect(resolveKeymap('word', next).conflicts).toEqual([]);
  });

  // Taking one chord away keeps a command's other chords.
  it('keeps a command\'s other chords when taking one away', (): void => {
    const next = withoutChord('word', { 'view:zoom-reset': ['Ctrl+-'] }, 'Ctrl+-', 'view:zoom-reset');
    expect(next['view:zoom-out']).toEqual(['Ctrl+Shift+,']);
  });
});
