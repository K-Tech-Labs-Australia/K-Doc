/**
 * @file search.spec.ts
 * @purpose Vitest test suite for the find-and-replace search engine in @k-doc/core.
 * @inputs Source Markdown text strings, search queries, replacement templates, SearchOptions,
 *   SearchMatch records, and character offsets.
 * @outputs Vitest assertions validating findMatches, replaceAll, replaceMatch, and nextMatchIndex
 *   across literal, word boundary, and regex modes.
 * @functions No helpers (test suite file executing describe and it blocks).
 * @dataflow Test inputs -> findMatches / replaceAll / replaceMatch / nextMatchIndex -> match arrays,
 *   replacement results, modified strings, and target indices -> Vitest expect assertions.
 * @controlflow Execute test suites across literal matching, whole-word matching, regex matching,
 *   replaceAll expansion and reverse splicing, single match replacement, and bidirectional wraparound navigation.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import {
  InvalidQueryError,
  findMatches,
  nextMatchIndex,
  replaceAll,
  replaceMatch,
  type SearchMatch,
} from '../src/index.js';

describe('findMatches — literal mode', () => {
  it('finds every occurrence of a query string with correct start and end offsets', () => {
    const matches = findMatches('cat bat cat', 'cat');
    expect(matches).toEqual([
      { start: 0, end: 3, groups: [] },
      { start: 8, end: 11, groups: [] },
    ]);
  });

  it('is case-insensitive by default', () => {
    const matches = findMatches('Cat cat', 'cat');
    expect(matches).toHaveLength(2);
  });

  it('returns only exact-case matches when caseSensitive is true', () => {
    const matches = findMatches('Cat cat', 'cat', { caseSensitive: true });
    expect(matches).toEqual([{ start: 4, end: 7, groups: [] }]);
  });

  it('treats regex meta-characters literally in default mode', () => {
    // In literal mode, '.' must match only a literal dot character rather than any character.
    // Without regex escaping, 'a.c' would match both 'a.c' and 'abc'.
    const matches = findMatches('a.c abc', 'a.c');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.start).toBe(0);
    expect(matches[0]?.end).toBe(3);
  });

  it('finds Markdown syntax sequences in source text', () => {
    const matches = findMatches('see [docs](https://x)', '](');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.start).toBe(9);
    expect(matches[0]?.end).toBe(11);
  });

  it('returns an empty array when given an empty query string', () => {
    const matches = findMatches('hello world', '');
    expect(matches).toEqual([]);
  });

  it('populates groups as an empty array in literal mode', () => {
    const matches = findMatches('hello world', 'hello');
    expect(matches[0]?.groups).toEqual([]);
  });
});

describe('findMatches — whole word', () => {
  it('matches only standalone whole words when wholeWord is true', () => {
    const matches = findMatches('cat cats concat', 'cat', { wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.start).toBe(0);
    expect(matches[0]?.end).toBe(3);
  });

  it('preserves capture group indexing when wholeWord and regex are both enabled', () => {
    // The implementation wraps the pattern in a non-capturing group \b(?:...)\b so that
    // caller capture groups are not shifted by the outer word boundary wrapper.
    const matches = findMatches('cat', '(c)(a)t', { regex: true, wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.groups).toEqual(['c', 'a']);
  });
});

describe('findMatches — regex mode', () => {
  it('evaluates regular expression patterns when regex is true', () => {
    const matches = findMatches('abc adc', 'a.c', { regex: true });
    expect(matches).toHaveLength(2);
    expect(matches[0]?.start).toBe(0);
    expect(matches[0]?.end).toBe(3);
    expect(matches[1]?.start).toBe(4);
    expect(matches[1]?.end).toBe(7);
  });

  it('reports captured subpattern groups in regex mode', () => {
    const matches = findMatches('me@here', '(\\w+)@(\\w+)', { regex: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.groups).toEqual(['me', 'here']);
  });

  it('terminates and does not hang on zero-length regex matches', () => {
    // A naive RegExp.exec loop does not advance lastIndex on a zero-length match (e.g. 'x*' matching empty string)
    // and would spin forever. Advancing lastIndex manually on empty matches ensures termination.
    const text = 'abc';
    const matches = findMatches(text, 'x*', { regex: true });
    expect(matches.length).toBeLessThanOrEqual(text.length + 1);
  });

  it('throws InvalidQueryError for syntactically invalid regular expressions', () => {
    expect(() => findMatches('abc', '(', { regex: true })).toThrow(InvalidQueryError);
  });

  it('allows unbalanced regex syntax in literal mode by escaping meta-characters', () => {
    const matches = findMatches('a(b', '(');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.start).toBe(1);
    expect(matches[0]?.end).toBe(2);
  });
});

describe('replaceAll', () => {
  it('replaces every occurrence of a query and reports the total count', () => {
    const result = replaceAll('cat bat cat', 'cat', 'dog');
    expect(result).toEqual({ text: 'dog bat dog', count: 2 });
  });

  it('handles replacements longer than the match by splicing in reverse order', () => {
    // Splicing forwards would invalidate the start and end offsets of subsequent matches whenever
    // the replacement length differs from the match length. Splicing backwards preserves offset validity.
    const result = replaceAll('a a a', 'a', 'bbbb');
    expect(result).toEqual({ text: 'bbbb bbbb bbbb', count: 3 });
  });

  it('returns the original text with count 0 when no matches are found', () => {
    const result = replaceAll('hello world', 'xyz', 'abc');
    expect(result).toEqual({ text: 'hello world', count: 0 });
  });

  it('treats dollar replacement tokens literally in default mode', () => {
    const result = replaceAll('x', 'x', '$1');
    expect(result).toEqual({ text: '$1', count: 1 });
  });

  it('expands numbered capture groups in regex replacement templates', () => {
    const result = replaceAll('me@here', '(\\w+)@(\\w+)', '$2 at $1', { regex: true });
    expect(result).toEqual({ text: 'here at me', count: 1 });
  });

  it('expands $& to the full matched string in regex replacement templates', () => {
    const result = replaceAll('cat', 'cat', '[$&]', { regex: true });
    expect(result).toEqual({ text: '[cat]', count: 1 });
  });

  it('expands $$ to a single literal dollar character in regex replacement templates', () => {
    const result = replaceAll('price', 'price', '$$100', { regex: true });
    expect(result).toEqual({ text: '$100', count: 1 });
  });

  it('expands out-of-range capture groups to an empty string in regex replacement', () => {
    const result = replaceAll('cat', '(cat)', 'before-$9-after', { regex: true });
    expect(result).toEqual({ text: 'before--after', count: 1 });
  });
});

describe('replaceMatch', () => {
  it('replaces only the specified match leaving all other text byte-identical', () => {
    const text = 'alpha beta gamma';
    const match: SearchMatch = { start: 6, end: 10, groups: [] };
    const result = replaceMatch(text, match, 'delta');
    expect(result).toBe('alpha delta gamma');
  });

  it('returns the text unchanged when the match offsets are out of bounds', () => {
    const text = 'hello';
    const matchNegative: SearchMatch = { start: -2, end: 3, groups: [] };
    const matchPastEnd: SearchMatch = { start: 2, end: 10, groups: [] };
    const matchInverted: SearchMatch = { start: 4, end: 2, groups: [] };

    expect(replaceMatch(text, matchNegative, 'x')).toBe('hello');
    expect(replaceMatch(text, matchPastEnd, 'x')).toBe('hello');
    expect(replaceMatch(text, matchInverted, 'x')).toBe('hello');
  });
});

describe('nextMatchIndex', () => {
  it('returns -1 when given an empty matches array', () => {
    expect(nextMatchIndex([], 0, true)).toBe(-1);
    expect(nextMatchIndex([], 0, false)).toBe(-1);
  });

  it('returns 0 when navigating forward from before all matches', () => {
    const matches: readonly SearchMatch[] = [
      { start: 10, end: 15, groups: [] },
      { start: 20, end: 25, groups: [] },
      { start: 30, end: 35, groups: [] },
    ];
    expect(nextMatchIndex(matches, 5, true)).toBe(0);
  });

  it('wraps around to index 0 when navigating forward from past the last match', () => {
    const matches: readonly SearchMatch[] = [
      { start: 10, end: 15, groups: [] },
      { start: 20, end: 25, groups: [] },
      { start: 30, end: 35, groups: [] },
    ];
    expect(nextMatchIndex(matches, 40, true)).toBe(0);
  });

  it('returns the last index when navigating backward from after all matches', () => {
    const matches: readonly SearchMatch[] = [
      { start: 10, end: 15, groups: [] },
      { start: 20, end: 25, groups: [] },
      { start: 30, end: 35, groups: [] },
    ];
    expect(nextMatchIndex(matches, 40, false)).toBe(2);
  });

  it('wraps around to the last index when navigating backward from before all matches', () => {
    const matches: readonly SearchMatch[] = [
      { start: 10, end: 15, groups: [] },
      { start: 20, end: 25, groups: [] },
      { start: 30, end: 35, groups: [] },
    ];
    expect(nextMatchIndex(matches, 5, false)).toBe(2);
  });

  it('returns the match at the caret offset when navigating forward from an exact match start', () => {
    const matches: readonly SearchMatch[] = [
      { start: 10, end: 15, groups: [] },
      { start: 20, end: 25, groups: [] },
      { start: 30, end: 35, groups: [] },
    ];
    expect(nextMatchIndex(matches, 20, true)).toBe(1);
  });
});

