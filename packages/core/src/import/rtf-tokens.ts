/**
 * @file rtf-tokens.ts
 * @purpose Splits an RTF (Rich Text Format) source string into a flat list of lexical tokens.
 * @inputs Raw RTF markup as a string, including braces, control words, escapes, and literal text.
 * @outputs An ordered array of RtfToken values representing the tokenized structure.
 * @functions
 *   - decodeByte: Maps a single byte to its CP1252 character or falls back to Latin-1 decoding.
 *   - tokenizeRtf: Walks the RTF source and produces the token stream.
 * @dataflow Raw RTF string → character-by-character scan → RtfToken[] token array.
 * @controlflow Scan left to right → dispatch on brace, backslash, or text categories → advance index; loop until end of input.
 * @version 1
 * @date 2026-09-17
 */

/** Union type describing every lexical category produced by the RTF tokenizer. */
export type RtfToken =
  | { readonly kind: 'open' }
  | { readonly kind: 'close' }
  | { readonly kind: 'ignorable' }
  | { readonly kind: 'word'; readonly name: string; readonly param: number | null }
  | { readonly kind: 'text'; readonly text: string };

/** CP1252 code-point to character map for the low-byte range used by RTF hex escapes. */
export const CP1252: Readonly<Record<number, string>> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** One-character backslash, the escape prefix used throughout RTF control syntax. */
const BACKSLASH = '\\';

/** One-character apostrophe, the marker that begins a hexadecimal byte escape. */
const APOSTROPHE = "'";

/** Matches an alphabetic control word with an optional signed decimal parameter and trailing space. */
const WORD_PATTERN = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/;

/** Character class used to detect the start of an alphabetic control word. */
const LETTER = /[a-zA-Z]/;

/** Characters that terminate a run of literal text: backslash, braces, and line breaks. */
const TEXT_STOPS = BACKSLASH + '{}\r\n';

/**
 * @purpose Maps a single byte to its CP1252 character, falling back to Latin-1 decoding.
 * @inputs byte - A numeric byte value in [0, 255].
 * @outputs string - The decoded character for the given byte.
 * @dataflow Byte value → CP1252 lookup table → matched glyph or String.fromCharCode fallback.
 * @controlflow Look up byte in CP1252; use ?? to fall back to fromCharCode when absent.
 */
export function decodeByte(byte: number): string {
  return CP1252[byte] ?? String.fromCharCode(byte);
}

/**
 * @purpose Splits an RTF source string into a flat, ordered list of lexical tokens.
 * @inputs rtf - The raw RTF markup string to tokenize.
 * @outputs RtfToken[] - Ordered array of open/close/ignorable/word/text tokens.
 * @dataflow RTF string → sequential character scan → token objects pushed into result array.
 * @controlflow Loop over input; dispatch on brace, backslash, or text categories; advance index per branch until the end is reached.
 */
export function tokenizeRtf(rtf: string): RtfToken[] {
  const tokens: RtfToken[] = [];
  let i = 0;

  // Advance through the entire source one character at a time.
  while (i < rtf.length) {
    const ch = rtf[i];

    // Check whether the current character opens a group.
    if (ch === '{') {
      tokens.push({ kind: 'open' });
      i += 1;
      continue;
    } else {
      // Branch: not an opening brace, fall through to subsequent checks.
    }

    // Check whether the current character closes a group.
    if (ch === '}') {
      tokens.push({ kind: 'close' });
      i += 1;
      continue;
    } else {
      // Branch: not a closing brace, fall through to subsequent checks.
    }

    // Check whether the current character is a line break that should be skipped.
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    } else {
      // Branch: not a line break, fall through to subsequent checks.
    }

    // Check whether the current character begins an escape / control sequence.
    if (ch === BACKSLASH) {
      const next = rtf[i + 1] ?? '';

      // Check whether the following character starts an alphabetic control word.
      if (LETTER.test(next)) {
        const m = WORD_PATTERN.exec(rtf.slice(i + 1, i + 45));

        // Check whether the control word failed to match the expected pattern.
        if (m === null) {
          i += 2;
          continue;
        } else {
          // Branch: regex matched a valid control word with name and optional parameter.
        }

        tokens.push({
          kind: 'word',
          name: m[1] ?? '',
          param: m[2] === undefined ? null : Number(m[2]),
        });
        i += 1 + m[0].length;
        continue;
      } else {
        // Branch: next character is not alphabetic, so this is not a control word.
      }

      // Check whether the following character begins a hexadecimal byte escape.
      if (next === APOSTROPHE) {
        const byte = parseInt(rtf.slice(i + 2, i + 4), 16);

        // Check whether two valid hex digits were parsed for the escaped byte.
        if (!Number.isNaN(byte)) {
          tokens.push({ kind: 'text', text: decodeByte(byte) });
        } else {
          // Branch: invalid hexadecimal escape, emit nothing for this sequence.
        }
        i += 4;
        continue;
      } else {
        // Branch: not a hex byte escape, fall through to other escapes.
      }

      // Check whether the following character begins an ignorable group marker.
      if (next === '*') {
        tokens.push({ kind: 'ignorable' });
        i += 2;
        continue;
      } else {
        // Branch: not an ignorable marker, fall through to other escapes.
      }

      // Check whether the following character is a literal control that maps directly to text.
      if (next === BACKSLASH || next === '{' || next === '}') {
        tokens.push({ kind: 'text', text: next });
      } else if (next === '~') {
        // Branch: non-breaking space escape, emit U+00A0.
        tokens.push({ kind: 'text', text: '\u00a0' });
      } else if (next === '_') {
        // Branch: non-breaking hyphen escape, emit U+2011.
        tokens.push({ kind: 'text', text: '\u2011' });
      } else if (next === '\n' || next === '\r') {
        // Branch: line break treated as a paragraph marker control word.
        tokens.push({ kind: 'word', name: 'par', param: null });
      } else {
        // Branch: control symbol with no meaning here, e.g. optional hyphen: nothing.
      }
      i += 2;
      continue;
    } else {
      // Branch: not a backslash, fall through to literal text collection.
    }

    // Collect a run of literal text until a stop character (brace, backslash, or line break) is reached.
    let j = i;
    while (j < rtf.length && TEXT_STOPS.indexOf(rtf[j] ?? '') === -1) {
      j += 1;
    }
    tokens.push({ kind: 'text', text: rtf.slice(i, j) });
    i = j;
  }

  return tokens;
}
