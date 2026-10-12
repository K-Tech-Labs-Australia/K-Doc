/**
 * @file intraword-emphasis.test.ts
 * @purpose Verifies the K-Doc intraword emphasis serializer end-to-end through the real remark parser and serializer, plus a direct unit check of the `touchesWord` boundary helper. The default mdast-util-to-markdown handler writes character references (`&#x…`) for emphasis that sits inside a word; this suite asserts that such cases are instead written with `*`, while ordinary (word-boundary) emphasis keeps the configured underscore marker.
 * @inputs Markdown source strings, an AST Info context object for the boundary helper.
 * @outputs Serialized markdown strings and boolean results from `touchesWord`.
 * @functions
 *   - touchesWord: Asserts that a letter/digit on either side of the delimiter counts as touching a word.
 *   - intrawordEmphasis (via serializeDocument): Asserts that intraword emphasis is written with `*` and never falls back to character references, while boundary emphasis keeps `_`.
 * @dataflow Markdown string -> parseMarkdown mdast tree -> serializeDocument custom emphasis handler -> serialized markdown string.
 * @controlflow Each case parses the source, serializes it through the configured serializer, and asserts exact equality with the expected round-trip output; `touchesWord` is called directly for its pure boundary logic.
 * @version 1
 * @date 2026-10-08
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '../index.js';
import { touchesWord } from './intraword-emphasis.js';

describe('intraword emphasis', () => {
  // Case 1: digits on both sides of the asterisks are word characters, so the default character-reference
  // fallback (`&#x…`) must not be used; the inline code is written back verbatim with `*`.
  it('writes intraword numeric emphasis without character references', () => {
    expect(serializeDocument(parseMarkdown('price 2*3*4\n'))).toBe('price 2*3*4\n');
  });

  // Case 2: letters on both sides of each asterisk are word characters, so the emphasis is written with `*`
  // and round-trips exactly instead of being escaped into character references.
  it('round-trips intraword alphabetic emphasis', () => {
    expect(serializeDocument(parseMarkdown('un*believ*able\n'))).toBe('un*believ*able\n');
  });

  // Case 3: ordinary word-boundary emphasis (space on both sides) is not intraword, so the configured underscore
  // marker is preserved rather than being rewritten to `*`.
  it('keeps the configured underscore for ordinary emphasis', () => {
    expect(serializeDocument(parseMarkdown('*word* here\n'))).toBe('_word_ here\n');
  });

  // Case 4: word-boundary emphasis immediately followed by punctuation is not intraword (the space before `*`
  // and the period after both delimit a boundary), so it keeps the underscore marker.
  it('keeps the underscore for emphasis followed by punctuation', () => {
    expect(serializeDocument(parseMarkdown('a *b*.\n'))).toBe('a _b_.\n');
  });
});

describe('touchesWord', () => {
  // Case 5: a letter immediately before and whitespace after the delimiter both count as touching a word.
  it('returns true when a character touches either side of the delimiter', () => {
    expect(
      touchesWord({
        before: 'x',
        after: ' ',
        lineShift: 0,
        now: { line: 1, column: 1 },
      }),
    ).toBe(true);
  });

  // Case 5: whitespace before and punctuation after are both non-word characters, so the delimiter does not touch a word.
  it('returns false when neither side touches a word', () => {
    expect(
      touchesWord({
        before: ' ',
        after: '.',
        lineShift: 0,
        now: { line: 1, column: 1 },
      }),
    ).toBe(false);
  });
});
