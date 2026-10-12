/**
 * @file keyboard-shortcuts-model.spec.ts
 * @purpose Exercises the pure Keyboard Shortcuts data model (keyboard-shortcuts-model.ts) with Vitest, covering row enumeration, query filtering, chord recording/transferring/removal, preset switching, and conflict reporting without any DOM or config mutation.
 * @inputs The vitest runner; the exported model functions shortcutRows, recordChord, takeChord, removeChord, resetCommand, resetAll, choosePreset, and conflictSummary; the KeyboardSettings and CommandLabel types from @k-doc/config.
 * @outputs A Vitest suite that asserts on ShortcutRow listings, RecordOutcome values, resulting KeyboardSettings, and conflict summary strings; fails the build when any assertion is wrong.
 * @functions
 *   - rowFor: Locates a single ShortcutRow by id within a keyboard listing, throwing when absent.
 *   - shortcutRows describe block: Asserts enumeration, query matching, change state, and conflict chords.
 *   - recordChord describe block: Asserts added, already, and taken outcomes.
 *   - takeChord describe block: Asserts chord transfer and conflict clearing.
 *   - removeChord, resetCommand, resetAll, choosePreset describe block: Asserts per-command edits and preset switches.
 *   - conflictSummary describe block: Asserts empty, singular, and plural warning phrasing.
 * @dataflow Test constants WORD and LABELS → model functions → assertions; each test builds a KeyboardSettings, calls one or more model functions, and compares the result to an expected value.
 * @controlflow Vitest mounts the file, runs each describe block in order, executes every it body synchronously, and reports pass or fail per assertion.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import type { KeyboardSettings } from '@k-doc/config';
import { choosePreset, conflictSummary, recordChord, removeChord, resetAll, resetCommand, shortcutRows, takeChord, type CommandLabel } from '../src/shell/keyboard-shortcuts-model.js';

const WORD: KeyboardSettings = { preset: 'word', bindings: {} };
const LABELS: readonly CommandLabel[] = [
  { id: 'format:bold', label: 'Bold', category: 'Format' },
  { id: 'format:italic', label: 'Italic', category: 'Format' },
];

/**
 * @purpose Locates a single ShortcutRow by id within a keyboard settings listing.
 * @inputs keyboard - The settings whose rows are enumerated. id - The command id to find.
 * @outputs ShortcutRow - The matching row, or throws when no row carries that id.
 * @dataflow shortcutRows(keyboard) → filter by id → return the match or raise an error.
 * @controlflow Build the full listing, search for the id, and either return the row or throw a descriptive error.
 */
function rowFor(keyboard: KeyboardSettings, id: string): ReturnType<typeof shortcutRows>[number] {
  const row = shortcutRows(keyboard, LABELS, '').find((r) => r.id === id);
  if (row === undefined) {
    // No row matched the requested id: surface a clear error rather than returning undefined.
    throw new Error(`no row for ${id}`);
  } else {
    // A matching row exists: return it to the caller.
    return row;
  }
}

describe('shortcutRows', (): void => {
  it('lists every remappable command when the query is empty', (): void => {
    const rows = shortcutRows(WORD, LABELS, '');
    expect(rows.length).toBeGreaterThan(20);
    expect(rowFor(WORD, 'format:bold')).toEqual({ id: 'format:bold', label: 'Bold', category: 'Format', chords: ['Ctrl+B'], changed: false, conflicts: [] });
  });

  it('falls back to the command id and its prefix when no label is known', (): void => {
    const row = rowFor(WORD, 'view:zoom-in');
    expect(row.label).toBe('view:zoom-in');
    expect(row.category).toBe('view');
  });

  it('matches the query against label, category, id and displayed chord, ignoring case and spaces', (): void => {
    expect(shortcutRows(WORD, LABELS, '  BOLD ').map((r) => r.id)).toEqual(['format:bold']);
    expect(shortcutRows(WORD, LABELS, 'ctrl+shift+>').map((r) => r.id)).toEqual(['view:zoom-in']);
    expect(shortcutRows(WORD, LABELS, 'format:ital').map((r) => r.id)).toEqual(['format:italic']);
    expect(shortcutRows(WORD, LABELS, 'no such command')).toEqual([]);
    expect(shortcutRows(WORD, LABELS, 'Format').map((r) => r.id)).toContain('format:italic');
  });

  it('marks a command the user rebound as changed, including one they unbound', (): void => {
    const kb: KeyboardSettings = { preset: 'word', bindings: { 'format:bold': ['Ctrl+Alt+B'], 'format:italic': [] } };
    expect(rowFor(kb, 'format:bold')).toMatchObject({ chords: ['Ctrl+Alt+B'], changed: true });
    expect(rowFor(kb, 'format:italic')).toMatchObject({ chords: [], changed: true });
  });

  it('flags the chords two commands both claim', (): void => {
    const kb: KeyboardSettings = { preset: 'word', bindings: { 'format:bold': ['Ctrl+B', 'Ctrl+I'] } };
    expect(rowFor(kb, 'format:bold').conflicts).toEqual(['Ctrl+I']);
  });
});

describe('recordChord', (): void => {
  it('adds a free chord to the command', (): void => {
    const outcome = recordChord(WORD, LABELS, 'format:bold', 'Ctrl+Alt+B');
    expect(outcome.kind).toBe('added');
    if (outcome.kind === 'added') {
      expect(rowFor(outcome.next, 'format:bold').chords).toEqual(['Ctrl+B', 'Ctrl+Alt+B']);
      expect(outcome.next.preset).toBe('word');
    } else {
      throw new Error('expected added');
    }
  });

  it('reports a chord the command already has', (): void => {
    expect(recordChord(WORD, LABELS, 'format:bold', 'Ctrl+B')).toEqual({ kind: 'already' });
  });

  it('names the command that already holds the chord', (): void => {
    expect(recordChord(WORD, LABELS, 'format:bold', 'Ctrl+I')).toEqual({ kind: 'taken', by: 'format:italic', byLabel: 'Italic' });
  });
});

describe('takeChord', (): void => {
  it('moves a chord from the command that held it', (): void => {
    const next = takeChord(WORD, 'format:bold', 'Ctrl+I');
    expect(rowFor(next, 'format:bold').chords).toEqual(['Ctrl+B', 'Ctrl+I']);
    expect(rowFor(next, 'format:italic').chords).toEqual([]);
    expect(conflictSummary(next)).toBe('');
  });

  it('clears a conflict when the command already holds the chord', (): void => {
    const kb: KeyboardSettings = { preset: 'word', bindings: { 'format:bold': ['Ctrl+B', 'Ctrl+I'] } };
    const next = takeChord(kb, 'format:bold', 'Ctrl+I');
    expect(rowFor(next, 'format:bold').chords).toEqual(['Ctrl+B', 'Ctrl+I']);
    expect(rowFor(next, 'format:italic').chords).toEqual([]);
    expect(next.bindings['format:bold']).toEqual(['Ctrl+B', 'Ctrl+I']);
  });
});

describe('removeChord, resetCommand, resetAll and choosePreset', (): void => {
  it('removes one chord and unbinds a command left with none', (): void => {
    const next = removeChord(WORD, 'format:bold', 'Ctrl+B');
    expect(rowFor(next, 'format:bold')).toMatchObject({ chords: [], changed: true });
  });

  it('drops the override when removal leaves the preset chords', (): void => {
    const kb: KeyboardSettings = { preset: 'word', bindings: { 'format:bold': ['Ctrl+B', 'Ctrl+Alt+B'] } };
    const next = removeChord(kb, 'format:bold', 'Ctrl+Alt+B');
    expect(next.bindings['format:bold']).toBeUndefined();
    expect(rowFor(next, 'format:bold').changed).toBe(false);
  });

  it('resets one command and leaves the others', (): void => {
    const kb: KeyboardSettings = { preset: 'word', bindings: { 'format:bold': [], 'format:italic': [] } };
    const next = resetCommand(kb, 'format:bold');
    expect(next.bindings).toEqual({ 'format:italic': [] });
    expect(kb.bindings).toEqual({ 'format:bold': [], 'format:italic': [] });
  });

  it('resets every command but keeps the preset', (): void => {
    expect(resetAll({ preset: 'vscode', bindings: { 'format:bold': [] } })).toEqual({ preset: 'vscode', bindings: {} });
  });

  it('switches preset and keeps the user bindings', (): void => {
    const bindings = { 'format:bold': ['Ctrl+Alt+B'] };
    expect(choosePreset({ preset: 'word', bindings }, 'obsidian')).toEqual({ preset: 'obsidian', bindings });
  });
});

describe('conflictSummary', (): void => {
  it('is empty without conflicts', (): void => {
    expect(conflictSummary(WORD)).toBe('');
  });

  it('uses the singular for one conflict', (): void => {
    expect(conflictSummary({ preset: 'word', bindings: { 'format:bold': ['Ctrl+I'] } })).toBe('1 shortcut is claimed by two commands; the one you set yourself wins.');
  });

  it('counts several conflicts', (): void => {
    expect(conflictSummary({ preset: 'word', bindings: { 'format:bold': ['Ctrl+I', 'Ctrl+S'] } })).toBe('2 shortcuts are claimed by two commands; the ones you set yourself win.');
  });
});