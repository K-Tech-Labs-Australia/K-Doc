/**
 * @file keymap/chords.ts
 * @purpose Parses, builds, and renders canonical keyboard chords for K-Doc's remappable shortcuts (FR-14.16).
 * @inputs User-written chord strings; raw KeyboardEvent-like objects; existing canonical chords for display.
 * @outputs Normalized chord strings ('Ctrl+Shift+S'); null for invalid input; display-formatted chords.
 * @functions
 *   - joinChord: Assembles the '+'-joined chord string from modifier flags and a resolved key.
 *   - isUsable: Rejects keys that would hijack typing or editing unless held with Ctrl or Alt.
 *   - normalizeChord: Parses an arbitrary chord spelling into its canonical form, or null if invalid.
 *   - chordFromEvent: Derives a canonical chord from a single keyboard event.
 *   - formatChord: Rewrites shifted dot/comma for on-screen display as '>' and '<'.
 * @dataflow Text or event → tokenized modifiers/keys → canonical chord string → optional display formatting.
 * @controlflow Parse inputs into modifier flags plus one key, validate usability, then join; formatChord post-processes only for display.
 * @version 1
 * @date 2026-09-15
 */

/**
 * A minimal keyboard event shape so this module stays pure and free of DOM types.
 * `ctrlKey` semantics mirror the chord model: Ctrl on Windows/Linux, Cmd on macOS.
 */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/** Named keys, by every spelling a chord may use, to their canonical name. Compared lower-case. */
const NAMED_KEYS: Readonly<Record<string, string>> = { up: 'Up', arrowup: 'Up', down: 'Down', arrowdown: 'Down', left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right', tab: 'Tab', enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape', space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6', f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12' };

/** Characters typed with Shift on a US layout, to the key they are on. A chord written 'Ctrl+>' means Ctrl+Shift+. */
const SHIFTED: Readonly<Record<string, string>> = { '>': '.', '<': ',', '+': '=', '_': '-', '?': '/', ':': ';', '"': "'", '~': '`', '|': '\\', '{': '[', '}': ']', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };

/** Unshifted punctuation and digit keys a chord may use. */
const PLAIN_CHARACTERS: string = "0123456789.,=-/;'`\\[]";

/** KeyboardEvent.code to the key name for every non-letter key a chord can use. */
const CODE_TO_KEY: Readonly<Record<string, string>> = { Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Equal: '=', Minus: '-', Period: '.', Comma: ',', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12' };

/**
 * @purpose Builds the canonical '+'-joined chord string from its modifier flags and resolved key.
 * @inputs ctrl - Whether the primary (Ctrl/Cmd) modifier is held.
 *   alt - Whether the Alt/Option modifier is held.
 *   shift - Whether the Shift modifier is held.
 *   key - The canonical key name to append last.
 * @outputs string - Modifiers in fixed order (Ctrl, Alt, Shift) followed by the key, joined by '+'.
 * @dataflow Three boolean flags plus a key string → ordered parts array → single chord string.
 * @controlflow Push each held modifier in order, always push the key last, then join; no branching on output shape.
 */
function joinChord(ctrl: boolean, alt: boolean, shift: boolean, key: string): string {
  const parts: string[] = [];
  if (ctrl) {
    // Primary modifier present: emit 'Ctrl' first.
    parts.push('Ctrl');
  } else {
    // No primary modifier in this chord.
  }
  if (alt) {
    // Alt/Option modifier present.
    parts.push('Alt');
  } else {
    // No Alt modifier in this chord.
  }
  if (shift) {
    // Shift modifier present.
    parts.push('Shift');
  } else {
    // No Shift modifier in this chord.
  }
  // The key is always the final component of a chord.
  parts.push(key);
  return parts.join('+');
}

/**
 * @purpose Decides whether a resolved key may legitimately appear as a chord on its modifier set.
 * @inputs ctrl - Whether the primary (Ctrl/Cmd) modifier is held.
 *   alt - Whether the Alt/Option modifier is held.
 *   key - The canonical key name to evaluate.
 * @outputs boolean - True if the key forms a valid chord, false if it would hijack typing or editing.
 * @dataflow Modifier flags and a key name → predicate result.
 * @controlflow Function keys pass unconditionally; every other key requires Ctrl or Alt to avoid clobbering text input.
 */
function isUsable(ctrl: boolean, alt: boolean, key: string): boolean {
  // Function keys (F1–F12) are reserved and never type characters, so they need no modifier.
  if (/^F([1-9]|1[0-2])$/.test(key)) {
    return true;
  } else {
    // Any other key needs Ctrl or Alt, otherwise it would take over typing (a letter/digit) or editing (Tab, arrows).
    return ctrl || alt;
  }
}

/**
 * @purpose Parses a user-written chord string into its canonical '+'-joined form.
 * @inputs text - A chord such as 'Ctrl+Shift+S', using any accepted spelling of modifiers and keys.
 * @outputs string | null - The normalized chord, or null if the input is not a valid usable chord.
 * @dataflow Raw text → split parts → modifier/key tokens → canonical chord string (or null).
 * @controlflow Split on '+', restore a trailing '+' key, classify each part as modifier or key, then validate usability.
 */
export function normalizeChord(text: string): string | null {
  const parts = text.split('+').map((p) => p.trim());
  // A trailing '+' used as the key ('Ctrl++') splits into two empty parts; restore a single '+' key between them.
  if (parts.length >= 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, '+');
  } else {
    // Not a trailing-plus-as-key case; leave the split parts untouched.
  }
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    // A primary modifier key; 'cmd'/'command'/'mod'/'meta' all map to Ctrl as the platform-primary modifier.
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'command' || lower === 'mod' || lower === 'meta') {
      ctrl = true;
    } else if (lower === 'alt' || lower === 'option') {
      // An Alt/Option modifier.
      alt = true;
    } else if (lower === 'shift') {
      // A Shift modifier.
      shift = true;
    } else if (key !== null || part === '') {
      // Either a second key was already captured, or this part is empty from a stray '+'; both are invalid.
      return null;
    } else if (NAMED_KEYS[lower] !== undefined) {
      // A named key such as 'Up', 'Enter' or 'F7'.
      key = NAMED_KEYS[lower] ?? null;
    } else if (part.length === 1 && /[a-z]/i.test(part)) {
      // A single letter maps to its uppercase key name.
      key = part.toUpperCase();
    } else if (part.length === 1 && SHIFTED[part] !== undefined) {
      // A shifted character such as '>' means the base key with Shift held.
      key = SHIFTED[part] ?? null;
      shift = true;
    } else if (part.length === 1 && PLAIN_CHARACTERS.includes(part)) {
      // An unshifted punctuation or digit key, typed without Shift.
      key = part;
    } else {
      // Not a recognized modifier, named key, or single character: reject the chord.
      return null;
    }
  }
  // A chord must resolve to exactly one key; reject anything that did not.
  if (key === null) {
    return null;
  } else {
    // The parsed key is usable only as part of a modifier chord, or on its own when it is a function key.
    if (!isUsable(ctrl, alt, key)) {
      return null;
    } else {
      return joinChord(ctrl, alt, shift, key);
    }
  }
}

/**
 * @purpose Builds a canonical chord string from a single keyboard event.
 * @inputs event - A KeyboardEvent-like object carrying the typed key, physical code, and modifier flags.
 * @outputs string | null - The normalized chord, or null if the event is a bare modifier or an unkeyed press.
 * @dataflow Event fields → canonical key name + modifier flags → chord string (or null).
 * @controlflow Map the typed or physical key to its canonical name (a lone modifier maps to none), then validate and join.
 */
export function chordFromEvent(event: KeyEventLike): string | null {
  // A modifier pressed on its own needs no check of its own: its code (ControlLeft, ShiftRight...) names no key below.
  let key: string | null;
  if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
    // A letter comes from the character typed, so Ctrl+Z is the key labelled Z on any layout.
    key = event.key.toUpperCase();
  } else if (/^Key[A-Z]$/.test(event.code)) {
    // A letter key typing something else (a non-Latin layout) falls back to its physical position.
    key = event.code.slice(3);
  } else {
    // Digits, punctuation and named keys come from their physical position, which Shift does not change.
    key = CODE_TO_KEY[event.code] ?? null;
  }
  if (key === null) {
    // The physical code did not map to any known key (e.g. a dead-key or composition placeholder).
    return null;
  } else {
    // Ctrl and Cmd are treated as the same primary modifier when judging usability and rendering.
    const ctrl = event.ctrlKey || event.metaKey;
    if (!isUsable(ctrl, event.altKey, key)) {
      return null;
    } else {
      return joinChord(ctrl, event.altKey, event.shiftKey, key);
    }
  }
}

/**
 * @purpose Renders a chord for display, showing shifted punctuation the way keyboards print it.
 * @inputs chord - A canonical chord string produced by normalizeChord or chordFromEvent.
 * @outputs string - The same chord, with 'Shift+.' and 'Shift+,' shown as 'Shift+>' and 'Shift+<'.
 * @dataflow Canonical chord string → display-oriented chord string (unchanged when no special punctuation).
 * @controlflow Check for shifted dot/comma suffixes and rewrite them; otherwise return the chord verbatim.
 */
export function formatChord(chord: string): string {
  if (chord.endsWith('Shift+.')) {
    // Shift with '.' reads as '>' on a US layout, so display it that way.
    return `${chord.slice(0, -'Shift+.'.length)}Shift+>`;
  } else if (chord.endsWith('Shift+,')) {
    // Shift with ',' reads as '<' on a US layout, so display it that way.
    return `${chord.slice(0, -'Shift+,'.length)}Shift+<`;
  } else {
    // No special punctuation to reformat; return the chord unchanged.
    return chord;
  }
}
