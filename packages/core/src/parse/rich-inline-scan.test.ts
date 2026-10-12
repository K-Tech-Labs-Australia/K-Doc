/**
 * @file rich-inline-scan.test.ts
 * @purpose Assert the two pure scanning primitives in rich-inline-scan.ts: byte-offset alignment across
 *   escapes, and unescaped delimiter enumeration including its overlapping-`====` regression.
 * @inputs sourceOffsets, scanDelimiters, RICH_INLINE_MARKERS exported from './rich-inline-scan.js'.
 * @outputs Vitest describe/it blocks asserting offset arrays, hit records, childIndex passthrough, markers.
 * @dataflow Test inputs → scanned functions → expect assertions on offsets and hits.
 * @controlflow Two describe blocks run sequentially; each it pins one alignment or scan rule.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';

import { RICH_INLINE_MARKERS, scanDelimiters, sourceOffsets } from './rich-inline-scan.js';

// A backslash is built rather than written as a literal escape, because a test that silently loses its
// backslash passes while proving nothing.
const BS = String.fromCharCode(92);

describe('sourceOffsets', () => {
  it('identity: each value char maps to its own byte offset', () => {
    const src = 'hello world';
    const offsets = sourceOffsets(src, src, 0);
    expect(offsets).toHaveLength(src.length);
    expect(offsets[0]).toBe(0);
    expect(offsets[4]).toBe(4);
    for (let i = 0; i < offsets.length; i += 1) {
      expect(offsets[i]).toBe(i);
    }
  });

  it('non-zero start: offsets begin at the node offset', () => {
    const src = 'xx' + 'abc';
    expect(sourceOffsets(src, 'abc', 2)).toEqual([2, 3, 4]);
  });

  // The '=' lands past the backslash — recovering that byte is the whole point of this alignment.
  it('one escape: the escaped char maps to its source offset after the backslash', () => {
    expect(sourceOffsets('a' + BS + '=b', 'a=b', 0)).toEqual([0, 2, 3]);
  });

  it('two escapes shift cumulatively', () => {
    expect(sourceOffsets('a' + BS + '=' + BS + '=b', 'a==b', 0)).toEqual([0, 2, 4, 5]);
  });

  it('unalignable characters yield no offsets', () => {
    expect(sourceOffsets('abc', 'xyz', 0)).toEqual([]);
  });

  it('negative start refuses with empty offsets', () => {
    expect(sourceOffsets('abc', 'abc', -1)).toEqual([]);
  });

  it('source shorter than value bails out', () => {
    expect(sourceOffsets('ab', 'abcd', 0)).toEqual([]);
  });
});

describe('scanDelimiters', () => {
  // With value === source the offsets are the identity, so hits sit at their literal value indices.
  const id = (src: string): readonly number[] => sourceOffsets(src, src, 0);

  it('two unescaped highlights of length 2 at value indices 2 and 5', () => {
    const src = 'a ==b== c';
    const hits = scanDelimiters(src, id(src), src, 0);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.valueIndex).toBe(2);
    expect(hits[1]?.valueIndex).toBe(5);
    expect(hits.every((h) => h.type === 'highlight' && h.length === 2)).toBe(true);
  });

  // Regression: the scanner used to match == again starting at its second character, so an empty pair
  // produced three overlapping hits and came back out of the serializer as six characters.
  it('==== yields exactly two hits, not three', () => {
    const src = '====';
    expect(scanDelimiters(src, id(src), src, 0)).toHaveLength(2);
  });

  it('single tildes produce two subscript hits of length 1', () => {
    const src = 'a ~b~ c';
    const hits = scanDelimiters(src, id(src), src, 0);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.type === 'subscript' && h.length === 1)).toBe(true);
  });

  it('single carets produce two superscript hits of length 1', () => {
    const src = 'a ^b^ c';
    const hits = scanDelimiters(src, id(src), src, 0);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.type === 'superscript' && h.length === 1)).toBe(true);
  });

  // remark-gfm already turns a real ~~x~~ into a delete node, so this guard is about a stray unbalanced pair in prose.
  it('~~ flanking a tilde suppresses subscript hits', () => {
    const src = 'a ~~b~~ c';
    const hits = scanDelimiters(src, id(src), src, 0);
    expect(hits.filter((h) => h.type === 'subscript')).toHaveLength(0);
  });

  it('escaped delimiter is skipped', () => {
    const src = 'a ' + BS + '==b';
    const hits = scanDelimiters('a ==b', sourceOffsets(src, 'a ==b', 0), src, 0);
    expect(hits).toHaveLength(0);
  });

  it('mismatched offset length bails out', () => {
    expect(scanDelimiters('abc', [0, 1], 'abc', 0)).toEqual([]);
  });

  it('passes childIndex through to every hit', () => {
    const src = 'a ==b== c';
    const hits = scanDelimiters(src, id(src), src, 7);
    expect(hits.every((h) => h.childIndex === 7)).toBe(true);
  });

  it('maps each type to its literal marker', () => {
    expect(RICH_INLINE_MARKERS.highlight).toBe('==');
    expect(RICH_INLINE_MARKERS.subscript).toBe('~');
    expect(RICH_INLINE_MARKERS.superscript).toBe('^');
  });
});
