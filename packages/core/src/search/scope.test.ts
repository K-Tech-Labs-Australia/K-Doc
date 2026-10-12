/**
 * @file scope.test.ts
 * @purpose Vitest test suite for semantic search scoping in @k-doc/core (FR-9.4).
 *   Verifies code block exclusion, link URL exclusion while preserving link text searchability,
 *   depth-aware section restrictions including subsections, null scope handling before headings,
 *   and scopeMatches filtering across all configuration combinations.
 * @inputs Real Markdown source strings parsed via parseMarkdown, SearchMatch records from findMatches, and SearchScope options.
 * @outputs Vitest test assertions verifying SourceRange intervals and filtered SearchMatch subsets.
 * @functions None.
 * @dataflow Markdown string → parseMarkdown → mdast Root + source text → findMatches → scopeMatches → Vitest assertions.
 * @controlflow Execute test cases covering codeRanges, linkUrlRanges, sectionRange, and scopeMatches with all option permutations.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parse/parser.js';
import { findMatches } from './search.js';
import {
  codeRanges,
  linkUrlRanges,
  sectionRange,
  scopeMatches,
} from './scope.js';

describe('codeRanges', () => {
  // Pins extraction of source ranges from fenced code blocks.
  it('extracts source range from fenced code block', () => {
    const md = 'Paragraph before.\n\n```ts\nconst x = 42;\n```\n\nParagraph after.';
    const doc = parseMarkdown(md);
    const ranges = codeRanges(doc.root);

    expect(ranges).toHaveLength(1);
    const fenceStart = md.indexOf('```ts');
    const fenceEnd = md.indexOf('```\n\nParagraph after.') + 3;
    expect(ranges[0]?.start).toBe(fenceStart);
    expect(ranges[0]?.end).toBe(fenceEnd);
  });

  // Pins extraction of source ranges from inline code spans.
  it('extracts source range from inline code spans', () => {
    const md = 'Use `console.log` for debugging statements.';
    const doc = parseMarkdown(md);
    const ranges = codeRanges(doc.root);

    expect(ranges).toHaveLength(1);
    const codeStart = md.indexOf('`console.log`');
    const codeEnd = md.indexOf(' for debugging');
    expect(ranges[0]?.start).toBe(codeStart);
    expect(ranges[0]?.end).toBe(codeEnd);
  });

  // Pins extraction of multiple code ranges across blocks and inline code.
  it('extracts multiple code ranges preserving document order', () => {
    const md = 'Text `c1` middle.\n\n```\nblock\n```\n\nTail `c2`.';
    const doc = parseMarkdown(md);
    const ranges = codeRanges(doc.root);

    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.start).toBe(md.indexOf('`c1`'));
    expect(ranges[1]?.start).toBe(md.indexOf('```\nblock'));
    expect(ranges[2]?.start).toBe(md.indexOf('`c2`'));
  });
});

describe('linkUrlRanges', () => {
  // Pins exclusion of inline link URLs while keeping link text searchable.
  it('derives destination URL range from inline link leaving text searchable', () => {
    const md = 'Visit [searchable label](https://k-doc.org/docs "documentation") here.';
    const doc = parseMarkdown(md);
    const ranges = linkUrlRanges(doc.root, md);

    expect(ranges).toHaveLength(1);
    const urlStart = md.indexOf('https://k-doc.org/docs');
    const urlEnd = md.indexOf(') here.');
    expect(ranges[0]?.start).toBe(urlStart);
    expect(ranges[0]?.end).toBe(urlEnd);
    expect(md.slice(ranges[0]?.start ?? 0, ranges[0]?.end ?? 0)).toBe('https://k-doc.org/docs "documentation"');
  });

  // Pins reference links contributing no excluded URL ranges.
  it('contributes no range for reference links', () => {
    const md = 'Visit [searchable text][doc-ref] for info.\n\n[doc-ref]: https://k-doc.org';
    const doc = parseMarkdown(md);
    const ranges = linkUrlRanges(doc.root, md);

    expect(ranges).toEqual([]);
  });
});

describe('sectionRange', () => {
  // Pins section range expanding to include subsections while terminating at the next same-level heading.
  it('includes subsections within parent section and terminates at next same-level heading', () => {
    const md = '# Section 1\n\nIntro.\n\n## Sub 1.1\n\nSub prose.\n\n### Sub 1.1.1\n\nDeep.\n\n# Section 2\n\nOutro.';
    const doc = parseMarkdown(md);

    // Offset in Section 1 intro prose.
    const introOffset = md.indexOf('Intro.');
    const range1 = sectionRange(doc.root, introOffset, md.length);
    expect(range1).toEqual({
      start: md.indexOf('# Section 1'),
      end: md.indexOf('# Section 2'),
    });

    // Offset in Sub 1.1: terminates at # Section 2 because depth 1 <= depth 2.
    const subOffset = md.indexOf('Sub prose.');
    const rangeSub = sectionRange(doc.root, subOffset, md.length);
    expect(rangeSub).toEqual({
      start: md.indexOf('## Sub 1.1'),
      end: md.indexOf('# Section 2'),
    });
  });

  // Pins section range extending to sourceLength for the trailing section.
  it('extends to sourceLength when no subsequent same-or-shallower heading exists', () => {
    const md = '# Section 1\n\nIntro.\n\n# Section 2\n\nTrailing content.';
    const doc = parseMarkdown(md);
    const offset = md.indexOf('Trailing content.');
    const range = sectionRange(doc.root, offset, md.length);

    expect(range).toEqual({
      start: md.indexOf('# Section 2'),
      end: md.length,
    });
  });

  // Pins null section range when caret offset precedes the first heading.
  it('returns null when offset sits before the first heading', () => {
    const md = 'Preamble text before any header.\n\n# Heading 1\n\nBody content.';
    const doc = parseMarkdown(md);
    const offset = md.indexOf('Preamble');
    const range = sectionRange(doc.root, offset, md.length);

    expect(range).toBeNull();
  });

  // Pins null section range when document contains no headings.
  it('returns null when document contains no headings', () => {
    const md = 'Just ordinary paragraphs without headings.\n\nSecond paragraph.';
    const doc = parseMarkdown(md);
    const range = sectionRange(doc.root, 10, md.length);

    expect(range).toBeNull();
  });
});

describe('scopeMatches', () => {
  // Pins scopeMatches dropping matches inside code blocks when excludeCodeBlocks is true.
  it('drops matches inside fenced and inline code blocks when excludeCodeBlocks is true', () => {
    const md = 'Target in prose.\n\n```ts\nTarget in fence\n```\n\nTarget in `Target in code` span.';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'Target');
    expect(matches).toHaveLength(4);

    const scoped = scopeMatches(matches, doc.root, md, { excludeCodeBlocks: true });
    expect(scoped).toHaveLength(2);
    expect(scoped[0]?.start).toBe(md.indexOf('Target in prose.'));
    expect(scoped[1]?.start).toBe(md.indexOf('Target in `Target'));
  });

  // Pins scopeMatches retaining matches inside code blocks when excludeCodeBlocks is false.
  it('retains matches inside code blocks when excludeCodeBlocks is false', () => {
    const md = 'Target in prose.\n\n```ts\nTarget in fence\n```\n';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'Target');
    expect(matches).toHaveLength(2);

    const scoped = scopeMatches(matches, doc.root, md, { excludeCodeBlocks: false });
    expect(scoped).toHaveLength(2);
  });

  // Pins scopeMatches dropping matches in link URLs while retaining link text when excludeLinkUrls is true.
  it('drops matches in link destination URLs while preserving matches in link text when excludeLinkUrls is true', () => {
    const md = 'See [sample text](https://sample.org/sample) link.';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'sample');
    expect(matches).toHaveLength(3);

    const scoped = scopeMatches(matches, doc.root, md, { excludeLinkUrls: true });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.start).toBe(md.indexOf('sample text'));
  });

  // Pins scopeMatches retaining matches in link URLs when excludeLinkUrls is false.
  it('retains matches in link destination URLs when excludeLinkUrls is false', () => {
    const md = 'See [sample text](https://sample.org/sample) link.';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'sample');
    expect(matches).toHaveLength(3);

    const scoped = scopeMatches(matches, doc.root, md, { excludeLinkUrls: false });
    expect(scoped).toHaveLength(3);
  });

  // Pins scopeMatches restricting matches to the active heading section when sectionAt is specified.
  it('restricts matches to the active heading section when sectionAt is provided', () => {
    const md = '# Section A\n\nmatch one\n\n# Section B\n\nmatch two\n';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'match');
    expect(matches).toHaveLength(2);

    const caretA = md.indexOf('Section A');
    const scopedA = scopeMatches(matches, doc.root, md, { sectionAt: caretA });
    expect(scopedA).toHaveLength(1);
    expect(scopedA[0]?.start).toBe(md.indexOf('match one'));

    const caretB = md.indexOf('Section B');
    const scopedB = scopeMatches(matches, doc.root, md, { sectionAt: caretB });
    expect(scopedB).toHaveLength(1);
    expect(scopedB[0]?.start).toBe(md.indexOf('match two'));
  });

  // Pins scopeMatches retaining all matches when sectionAt is null.
  it('retains all matches across the document when sectionAt is null', () => {
    const md = '# Section A\n\nmatch one\n\n# Section B\n\nmatch two\n';
    const doc = parseMarkdown(md);
    const matches = findMatches(md, 'match');
    expect(matches).toHaveLength(2);

    const scoped = scopeMatches(matches, doc.root, md, { sectionAt: null });
    expect(scoped).toHaveLength(2);
  });

  // Pins scopeMatches dropping partial matches overlapping an excluded boundary.
  it('drops a match that overlaps the boundary of a code span', () => {
    const md = 'prefix `code`';
    const doc = parseMarkdown(md);
    // 'ix `' matches ending of prefix and backtick of inline code
    const matches = findMatches(md, 'ix `');
    expect(matches).toHaveLength(1);

    const scoped = scopeMatches(matches, doc.root, md, { excludeCodeBlocks: true });
    expect(scoped).toHaveLength(0);
  });

  // Pins scopeMatches handling empty matches and empty document gracefully.
  it('handles empty matches array and empty document without errors', () => {
    const doc = parseMarkdown('');
    const scoped = scopeMatches([], doc.root, '', {
      excludeCodeBlocks: true,
      excludeLinkUrls: true,
      sectionAt: 0,
    });
    expect(scoped).toEqual([]);
  });
});
