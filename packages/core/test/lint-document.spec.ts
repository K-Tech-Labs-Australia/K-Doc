/**
 * @file lint-document.spec.ts
 * @purpose Tests the shared document-lint helpers (applyLintEdits, lineNumberAt, nodeText, nodeRange, walkNodes) and the rule runner lintDocument behind FR-12.7.
 * @inputs Parsed mdast/KdocDocument trees produced by parseMarkdown; raw strings and offset pairs for helper unit tests; LintOptions maps driving lintDocument.
 * @outputs Passing assertions when each helper and lintDocument honor the FR-12.7 contract, or thrown errors on mismatch.
 * @functions
 *   - describe: Register a suite grouping assertions by the helper under test.
 *   - it: Assert one behavior of a single helper or one lintDocument invocation.
 * @dataflow parseMarkdown → KdocDocument → lintDocument rules → sorted findings; raw text/offsets → helpers → expected values.
 * @controlflow Module imports helpers and parser → describe blocks register suites → each it runs its assertion and throws on mismatch.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { lintDocument } from '../src/lint/lint-document.js';
import { applyLintEdits, lineNumberAt, nodeRange, nodeText, walkNodes, type LintNode } from '../src/lint/lint-finding.js';
import { parseMarkdown } from '../src/parse/parser.js';

describe('applyLintEdits', () => {
  it('applies edits in offset order whatever order they arrive in', () => {
    // Edits arrive out of order but must be applied left-to-right by source offset.
    expect(applyLintEdits('abcdef', [{ from: 4, to: 5, insert: 'X' }, { from: 1, to: 1, insert: '-' }])).toBe('a-bcdXf');
  });

  it('returns the text unchanged with no edits', () => {
    // An empty edit list leaves the original string intact.
    expect(applyLintEdits('abc', [])).toBe('abc');
  });

  it('inserts at the very end', () => {
    // A zero-width edit at offset === text.length appends after the last character.
    expect(applyLintEdits('abc', [{ from: 3, to: 3, insert: '!' }])).toBe('abc!');
  });

  it('refuses overlapping edits', () => {
    // A later edit starting before an earlier one ends must be rejected as out of range.
    expect(() => applyLintEdits('abcdef', [{ from: 0, to: 3, insert: '' }, { from: 2, to: 4, insert: '' }])).toThrow(RangeError);
  });

  it('allows edits that only touch', () => {
    // Adjacent edits sharing a boundary do not overlap and are both applied.
    expect(applyLintEdits('abcd', [{ from: 0, to: 2, insert: 'X' }, { from: 2, to: 4, insert: 'Y' }])).toBe('XY');
  });

  it('refuses an edit past the end, before the start, or backwards', () => {
    // Each invalid edit must independently throw a RangeError on out-of-range offsets.
    expect(() => applyLintEdits('abc', [{ from: 2, to: 4, insert: '' }])).toThrow('Lint edit out of range');
    expect(() => applyLintEdits('abc', [{ from: -1, to: 1, insert: '' }])).toThrow('Lint edit out of range');
    expect(() => applyLintEdits('abc', [{ from: 2, to: 1, insert: '' }])).toThrow('Lint edit out of range');
  });
});

describe('lineNumberAt', () => {
  it('maps offsets to 1-based line numbers', () => {
    // Offset 4 lands on the third line 'c'.
    expect(lineNumberAt('a\nb\nc', 4)).toBe(3);
    // Offset 0 is the first character of the first line.
    expect(lineNumberAt('a\nb\nc', 0)).toBe(1);
    // Offset 2 sits on the 'b' of the second line.
    expect(lineNumberAt('a\nb\nc', 2)).toBe(2);
    // Offsets past the end clamp to the last line.
    expect(lineNumberAt('a\nb\nc', 99)).toBe(3);
    // Negative offsets clamp to the first line, rather than counting back from the end as slice would.
    expect(lineNumberAt('a\nb\nc', -5)).toBe(1);
    expect(lineNumberAt('a\nb\nc', -1)).toBe(1);
  });
});

describe('nodeText, nodeRange and walkNodes', () => {
  it('joins text and inline code and skips other values', () => {
    // Only text/inlineCode leaves contribute; html is skipped and emphasis recurses into its child.
    const node: LintNode = { type: 'paragraph', children: [{ type: 'text', value: 'a ' }, { type: 'inlineCode', value: 'b' }, { type: 'html', value: '<i>' }, { type: 'emphasis', children: [{ type: 'text', value: ' c' }] }] };
    expect(nodeText(node)).toBe('a b c');
  });

  it('reads a range only when both offsets are numbers', () => {
    // A full position yields a range; a missing start offset or absent position yields null.
    expect(nodeRange({ type: 'x', position: { start: { offset: 1 }, end: { offset: 4 } } })).toEqual({ from: 1, to: 4 });
    expect(nodeRange({ type: 'x', position: { start: {}, end: { offset: 4 } } })).toBeNull();
    expect(nodeRange({ type: 'x' })).toBeNull();
  });

  it('visits every node parent first', () => {
    // Pre-order traversal records each parent before its descendants in document order.
    const seen: string[] = [];
    walkNodes({ type: 'a', children: [{ type: 'b', children: [{ type: 'c' }] }, { type: 'd' }] }, (n: LintNode): void => {
      seen.push(n.type);
    });
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('lintDocument', () => {
  const TEXT = '# A\n\n### C\n\n[x]()\n\n![i](gone.png)\n\n[y](#nope)\n';

  it('runs every rule and orders findings by position', () => {
    // With a missing-image set and anchor lookup, all four firing rules appear in source order.
    expect(lintDocument(parseMarkdown(TEXT), { missingImageUrls: new Set(['gone.png']), hasAnchor: (): boolean => false }).map((f) => f.rule)).toEqual(['heading-skip', 'empty-link', 'missing-image', 'broken-anchor']);
  });

  it('orders findings by position, not by rule', () => {
    // An empty link before a heading skip is listed first, although the heading rules run first.
    expect(lintDocument(parseMarkdown('[x]()\n\n# A\n\n### C\n')).map((f) => f.rule)).toEqual(['empty-link', 'heading-skip']);
  });

  it('skips anchors without a heading lookup', () => {
    // Without hasAnchor the broken-anchor rule is omitted but the others still run.
    expect(lintDocument(parseMarkdown(TEXT), { missingImageUrls: new Set(['gone.png']) }).map((f) => f.rule)).toEqual(['heading-skip', 'empty-link', 'missing-image']);
  });

  it('reports no missing images without being told which are missing', () => {
    // Without a missing set the image rule fires nothing, leaving only heading and link findings.
    expect(lintDocument(parseMarkdown(TEXT)).map((f) => f.rule)).toEqual(['heading-skip', 'empty-link']);
  });

  it('reports nothing for a clean document', () => {
    // A well-formed document with a valid anchor produces no findings at all.
    expect(lintDocument(parseMarkdown('# A\n\n## B\n\nText [link](b.md).\n'), { hasAnchor: (): boolean => true })).toEqual([]);
  });
});
