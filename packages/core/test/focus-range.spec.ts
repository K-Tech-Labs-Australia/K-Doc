/**
 * @file focus-range.spec.ts
 * @purpose Tests paragraphRange, sentenceRange, and focusRange from focus-range.js against a fixed sample document.
 * @inputs The exported range helpers plus a module-level TEXT constant used as test input.
 * @outputs Assertion results via vitest expect; no values are returned beyond pass/fail.
 * @functions
 *   - slice: Extracts the substring of TEXT bounded by a start/end offset pair.
 *   - paragraphRange tests: Cover blank-line handling, edge clamping, and run-to-edges behavior.
 *   - sentenceRange tests: Cover caret-in-sentence detection, quote pairing, and paragraph fallback.
 *   - focusRange tests: Cover paragraph vs sentence narrowing modes.
 * @dataflow TEXT constant → range helper functions → slice() → expect assertions.
 * @controlflow describe blocks group each helper; it() cases assert expected ranges for representative caret offsets.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { focusRange, paragraphRange, sentenceRange } from '../src/focus/focus-range.js';

const TEXT = '# Title\n\nOne line.\nSecond line of it. Third!\n\n\nLast "quoted." Done\n';

// Extract the substring of TEXT bounded by the given start and end offsets.
// @purpose Return the slice of the sample document that a computed range covers.
// @inputs range - Object with numeric start and end character offsets into TEXT.
// @outputs string - The characters between start (inclusive) and end (exclusive).
// @dataflow range.start/end → TEXT.slice → returned substring.
// @controlflow Single slice call; no branching.
function slice(range: { start: number; end: number }): string {
  return TEXT.slice(range.start, range.end);
}

describe('paragraphRange', () => {
  // Asserts the paragraph run around a caret spans all non-blank lines and clamps offsets within it.
  it('covers the run of non-blank lines around the caret', () => {
    expect(slice(paragraphRange(TEXT, TEXT.indexOf('line of')))).toBe('One line.\nSecond line of it. Third!');
    expect(slice(paragraphRange(TEXT, TEXT.indexOf('One')))).toBe('One line.\nSecond line of it. Third!');
    expect(slice(paragraphRange(TEXT, TEXT.indexOf('Third!') + 6))).toBe('One line.\nSecond line of it. Third!');
    expect(slice(paragraphRange(TEXT, 2))).toBe('# Title');
  });

  // Asserts a lone blank line yields an empty range and that out-of-bounds offsets are clamped safely.
  it('focuses only a blank line when the caret is on one, and clamps the offset', () => {
    const blank = TEXT.indexOf('\n\n\n') + 1;
    expect(paragraphRange(TEXT, blank)).toEqual({ start: blank, end: blank });
    expect(slice(paragraphRange(TEXT, 10_000))).toBe('');
    expect(slice(paragraphRange(TEXT, -5))).toBe('# Title');
    expect(paragraphRange('', 0)).toEqual({ start: 0, end: 0 });
  });

  // Asserts a paragraph with no internal blank lines spans the whole text.
  it('runs to the text edges without blank lines', () => {
    expect(paragraphRange('a\nb\nc', 3)).toEqual({ start: 0, end: 5 });
  });
});

describe('sentenceRange', () => {
  // Asserts the sentence containing a caret is located within its enclosing paragraph.
  it('finds the sentence holding the caret within the paragraph', () => {
    const paragraph = paragraphRange(TEXT, TEXT.indexOf('Second'));
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('line of')))).toBe('Second line of it.');
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('One')))).toBe('One line.');
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('Third')))).toBe('Third!');
  });

  // Asserts closing quotes stay attached to their sentence and carets after a full stop move to the next sentence.
  it('keeps closing quotes with their sentence and puts a caret after a full stop in the next sentence', () => {
    const paragraph = paragraphRange(TEXT, TEXT.indexOf('Last'));
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('quoted')))).toBe('Last "quoted."');
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('."') + 2))).toBe('Done');
    expect(slice(sentenceRange(TEXT, paragraph, TEXT.indexOf('Done') + 4))).toBe('Done');
  });

  // Asserts the whole paragraph is used when no sentence end exists and ends outside the paragraph are ignored.
  it('uses the paragraph when there is no sentence end, and ignores ends outside it', () => {
    const text = 'Before. no stop here\n\nAfter.';
    const paragraph = { start: 8, end: 20 };
    expect(sentenceRange(text, paragraph, 12)).toEqual({ start: 8, end: 20 });
    expect(sentenceRange('a.b c', { start: 0, end: 5 }, 1)).toEqual({ start: 0, end: 5 });
  });
});

describe('focusRange', () => {
  // Asserts focusRange returns the paragraph by default and narrows to a sentence when requested.
  it('narrows to the sentence only when asked', () => {
    const at = TEXT.indexOf('line of');
    expect(slice(focusRange(TEXT, at, 'paragraph'))).toBe('One line.\nSecond line of it. Third!');
    expect(slice(focusRange(TEXT, at, 'sentence'))).toBe('Second line of it.');
  });
});
