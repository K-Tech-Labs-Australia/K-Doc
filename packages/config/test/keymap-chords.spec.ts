/**
 * @file keymap-chords.spec.ts
 * @purpose Verifies parsing, building, and rendering of canonical keyboard chords implemented in src/keymap/chords.ts.
 * @inputs User-written chord strings; synthetic KeyboardEvent-like objects built by press(); canonical chords awaiting display formatting.
 * @outputs Boolean pass/fail per assertion via Vitest expect(); normalized, event-derived, and formatted chord strings compared to exact literals.
 * @functions
 *   - press: Builds a KeyEventLike with default false modifier flags overridden by the supplied partial.
 *   - normalizeChord suite: Asserts fixed modifier ordering, Cmd/Mod/Meta-as-Ctrl spelling, shifted-char mapping, plain punctuation retention, key naming, and rejection of typing/editing keys and malformed input.
 *   - chordFromEvent suite: Asserts event-to-chord derivation including non-Latin layout fallback, position-based punctuation, named keys, Cmd-as-Ctrl, and rejection of bare modifiers and unknown codes.
 *   - formatChord suite: Asserts display rewriting of Shift+dot/comma into >/< while leaving other chords unchanged.
 * @dataflow press() → KeyEventLike → chordFromEvent → canonical chord; string input → normalizeChord/chordFromEvent → optional formatChord → expected literal.
 * @controlflow Each it() builds inputs, invokes one chords function, and asserts equality or null against the exact expected value.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { chordFromEvent, formatChord, normalizeChord, type KeyEventLike } from '../src/keymap/chords.js';

/**
 * @purpose Builds a KeyEventLike with default false modifier flags overridden by the supplied partial.
 * @inputs partial - A partial event supplying at least key and code; any omitted modifiers default to false.
 * @outputs KeyEventLike - A complete event object ready for chordFromEvent.
 * @dataflow Partial event fields → spread over a fully-defaulted base → complete KeyEventLike.
 * @controlflow Construct the base object with all four modifier flags false, then overlay partial values on top.
 */
function press(partial: Partial<KeyEventLike> & { key: string; code: string }): KeyEventLike {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial };
}

describe('normalizeChord', (): void => {
  it('puts modifiers in a fixed order and letters in capitals', (): void => {
    expect(normalizeChord('ctrl+shift+s')).toBe('Ctrl+Shift+S');
    expect(normalizeChord('Shift+Ctrl+S')).toBe('Ctrl+Shift+S');
    expect(normalizeChord('alt+ctrl+shift+x')).toBe('Ctrl+Alt+Shift+X');
  });

  it('reads Cmd, Mod and Meta as Ctrl and Option as Alt', (): void => {
    expect(normalizeChord('Cmd+Z')).toBe('Ctrl+Z');
    expect(normalizeChord('Mod+Z')).toBe('Ctrl+Z');
    expect(normalizeChord('Meta+Z')).toBe('Ctrl+Z');
    expect(normalizeChord('Option+Up')).toBe('Alt+Up');
  });

  it('writes a shifted character as Shift and the key it is on', (): void => {
    expect(normalizeChord('Ctrl+Shift+>')).toBe('Ctrl+Shift+.');
    expect(normalizeChord('Ctrl+>')).toBe('Ctrl+Shift+.');
    expect(normalizeChord('Ctrl++')).toBe('Ctrl+Shift+=');
    expect(normalizeChord('Ctrl+?')).toBe('Ctrl+Shift+/');
  });

  it('keeps plain punctuation and digits', (): void => {
    expect(normalizeChord('Ctrl+=')).toBe('Ctrl+=');
    expect(normalizeChord('Ctrl+-')).toBe('Ctrl+-');
    expect(normalizeChord('Ctrl+Alt+1')).toBe('Ctrl+Alt+1');
    expect(normalizeChord('Ctrl+[')).toBe('Ctrl+[');
  });

  it('names keys one way', (): void => {
    expect(normalizeChord('Alt+ArrowUp')).toBe('Alt+Up');
    expect(normalizeChord('ctrl+esc')).toBe('Ctrl+Escape');
    expect(normalizeChord('Ctrl+space')).toBe('Ctrl+Space');
    expect(normalizeChord('f7')).toBe('F7');
    expect(normalizeChord('Ctrl+F12')).toBe('Ctrl+F12');
  });

  it('refuses keys that would take over typing or editing', (): void => {
    for (const text of ['A', 'Shift+A', '5', 'Tab', 'Shift+Tab', 'Enter', 'Up', 'Shift+Delete']) {
      expect(normalizeChord(text), text).toBeNull();
    }
  });

  it('refuses what is not one chord', (): void => {
    for (const text of ['', 'Ctrl', 'Ctrl+Shift', 'Ctrl+A+B', 'Ctrl+Hyper', 'Mod-z', 'Ctrl++A', 'Ctrl+é']) {
      expect(normalizeChord(text), text).toBeNull();
    }
  });
});

describe('chordFromEvent', (): void => {
  it('reads a letter from the character typed', (): void => {
    expect(chordFromEvent(press({ key: 's', code: 'KeyS', ctrlKey: true }))).toBe('Ctrl+S');
    expect(chordFromEvent(press({ key: 'z', code: 'KeyW', ctrlKey: true }))).toBe('Ctrl+Z');
  });

  it("falls back to the key's position for a non-Latin letter", (): void => {
    expect(chordFromEvent(press({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toBe('Ctrl+Z');
  });

  it('reads punctuation from its position, whatever Shift types', (): void => {
    expect(chordFromEvent(press({ key: '>', code: 'Period', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+.');
    expect(chordFromEvent(press({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+=');
    expect(chordFromEvent(press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+1');
  });

  it('reads named keys and treats Cmd as Ctrl', (): void => {
    expect(chordFromEvent(press({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }))).toBe('Alt+Up');
    expect(chordFromEvent(press({ key: 'F7', code: 'F7' }))).toBe('F7');
    expect(chordFromEvent(press({ key: 'z', code: 'KeyZ', metaKey: true }))).toBe('Ctrl+Z');
  });

  it('ignores typing, lone modifiers and unknown keys', (): void => {
    expect(chordFromEvent(press({ key: 'a', code: 'KeyA' }))).toBeNull();
    expect(chordFromEvent(press({ key: 'A', code: 'KeyA', shiftKey: true }))).toBeNull();
    expect(chordFromEvent(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(press({ key: 'Dead', code: 'IntlBackslash', ctrlKey: true }))).toBeNull();
  });

  it('agrees with normalizeChord on what a pressed chord is called', (): void => {
    expect(chordFromEvent(press({ key: '<', code: 'Comma', ctrlKey: true, shiftKey: true }))).toBe(normalizeChord('Ctrl+Shift+<'));
  });
});

describe('formatChord', (): void => {
  it('shows Shift with . and , as > and <', (): void => {
    expect(formatChord('Ctrl+Shift+.')).toBe('Ctrl+Shift+>');
    expect(formatChord('Ctrl+Shift+,')).toBe('Ctrl+Shift+<');
    expect(formatChord('Ctrl+S')).toBe('Ctrl+S');
    expect(formatChord('Ctrl+.')).toBe('Ctrl+.');
  });
});
