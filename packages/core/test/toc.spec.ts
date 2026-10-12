/**
 * @file toc.spec.ts
 * @purpose Verifies heading anchors, table-of-contents markers and the nested entry list (FR-8.30).
 * @inputs heading fixtures; marker strings; serialized document shapes.
 * @outputs vitest assertions covering slug generation, anchor numbering, marker parsing, item nesting and list rendering.
 * @functions none
 * @dataflow headings -> anchors, items, list
 * @controlflow describe per function; each it() asserts one behavior against the fixtures.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { headingAnchors, headingSlug, isTocEnd, parseTocStart, tocItems, tocList, tocStartMarker, DEFAULT_TOC_DEPTH, TOC_END_MARKER } from '../src/index.js';
import { serializeDocument } from '../src/index.js';

describe('headingSlug and headingAnchors', () => {
  it('slugs as GitHub does', () => {
    expect(headingSlug("What's New in 2.0?")).toBe('whats-new-in-20');
    expect(headingSlug('  -Leading and trailing-  ')).toBe('leading-and-trailing');
    expect(headingSlug('Ünïcödé Title')).toBe('ünïcödé-title');
  });
  it('numbers repeated anchors in document order', () => {
    expect(headingAnchors(['Notes', 'Other', 'Notes', 'notes!'])).toEqual(['notes', 'other', 'notes-1', 'notes-2']);
    expect(headingAnchors([])).toEqual([]);
  });
});

describe('markers', () => {
  it('reads the depth a start marker asks for', () => {
    expect(parseTocStart('<!-- toc -->')).toBe(DEFAULT_TOC_DEPTH);
    expect(parseTocStart('<!-- TOC depth=2 -->')).toBe(2);
    expect(parseTocStart(tocStartMarker(4))).toBe(4);
    expect(parseTocStart('<!--toc depth=6-->\n')).toBe(6);
    expect(parseTocStart('<!-- toc depth=9 -->')).toBeNull();
    expect(parseTocStart('<!-- comment -->')).toBeNull();
    expect(parseTocStart('text <!-- toc -->')).toBeNull();
  });
  it('recognises the end marker only', () => {
    expect(isTocEnd(TOC_END_MARKER)).toBe(true);
    expect(isTocEnd('<!--/TOC-->')).toBe(true);
    expect(isTocEnd('<!-- toc -->')).toBe(false);
    expect(isTocEnd('<!-- /toc --> trailing')).toBe(false);
  });
});

describe('tocItems', () => {
  const headings = [
    { depth: 1, text: 'A' }, { depth: 2, text: 'B' }, { depth: 3, text: 'C' }, { depth: 2, text: 'D' }, { depth: 1, text: 'E' },
  ];
  it('nests under the nearest shallower heading and leaves out deeper ones', () => {
    expect(tocItems(headings, 2)).toEqual([
      { text: 'A', anchor: 'a', children: [{ text: 'B', anchor: 'b', children: [] }, { text: 'D', anchor: 'd', children: [] }] },
      { text: 'E', anchor: 'e', children: [] },
    ]);
  });
  it('nests a skipped level one step down and starts at whatever level comes first', () => {
    expect(tocItems([{ depth: 2, text: 'Intro' }, { depth: 4, text: 'Deep' }, { depth: 3, text: 'Mid' }], 6)).toEqual([
      { text: 'Intro', anchor: 'intro', children: [{ text: 'Deep', anchor: 'deep', children: [] }, { text: 'Mid', anchor: 'mid', children: [] }] },
    ]);
  });
  it('counts anchors over headings it does not list', () => {
    expect(tocItems([{ depth: 3, text: 'Notes' }, { depth: 1, text: 'Notes' }], 1)).toEqual([{ text: 'Notes', anchor: 'notes-1', children: [] }]);
  });
  it('lists nothing when every heading is too deep', () => {
    expect(tocItems([{ depth: 4, text: 'x' }], 3)).toEqual([]);
  });
});

describe('tocList', () => {
  it('writes a tight nested list of links', () => {
    const list = tocList(tocItems([{ depth: 1, text: 'Intro' }, { depth: 2, text: "What's new?" }, { depth: 1, text: 'End' }], 3));
    const text = serializeDocument({ text: '', root: { type: 'root', children: [list] }, frontMatter: null });
    expect(text).toBe('- [Intro](#intro)\n  - [What\'s new?](#whats-new)\n- [End](#end)\n');
  });
});