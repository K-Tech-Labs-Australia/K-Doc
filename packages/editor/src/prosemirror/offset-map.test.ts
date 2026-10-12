// @vitest-environment jsdom
/**
 * @file offset-map.test.ts
 * @purpose Vitest suite covering the source-offset ↔ ProseMirror-position correspondence built by ./offset-map.js, verifying that a range expressed in raw Markdown resolves to exactly the same characters rendered in the document tree.
 * @inputs Source strings and target words supplied inline per test case; parsed via parseMarkdown + mdastToProseMirror into a shared PositionIndex under test.
 * @outputs expect(...) assertions comparing mapped ranges back against source text, round-tripped offsets, divergence markers, and boundary refusals.
 * @functions
 *   - build: Parses one source string, converts it to a ProseMirror doc, builds its PositionIndex, returns all three together.
 *   - rendered: Reads the substring of a document node between two positions using '\n' as the paragraph separator.
 *   - mapsTo: Locates a word in the source, maps that source range onto document positions, and reads back the rendered text to prove coordinate alignment.
 * @dataflow Source string → parseMarkdown + mdastToProseMirror → buildPositionIndex → offset-range lookup → doc.textBetween read-back → expect comparison.
 * @controlflow Each test builds a fresh index from its source, then either maps a word range and compares the rendered result or exercises one of the single-offset / boundary behaviours; every failure is asserted rather than silently skipped.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import { mdastToProseMirror } from './from-mdast.js';
import {
  buildPositionIndex,
  offsetToPosition,
  positionToOffset,
  offsetRangeToPositions,
  type PositionIndex,
} from './offset-map.js';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * @purpose Parses one source string into a ProseMirror document and its matching PositionIndex.
 * @inputs source - The raw Markdown text to parse, convert, and index.
 * @outputs A triple of the built PositionIndex, the rendered PMNode doc, and the original source string.
 * @dataflow source → parseMarkdown (Root + .text) → mdastToProseMirror(root) (PMNode) → buildPositionIndex(Root, doc).
 * @controlflow Parse once, convert once, index once; return all three so each test works from a single consistent coordinate system.
 */
function build(source: string): { readonly index: PositionIndex; readonly doc: PMNode; readonly source: string } {
  const parsed = parseMarkdown(source);
  const doc = mdastToProseMirror(parsed.root);
  const index = buildPositionIndex(parsed.root, doc);

  return { index, doc, source };
}

/**
 * @purpose Reads the rendered text occupying a document range using '\n' as the paragraph separator.
 * @inputs doc - The ProseMirror node whose span is read; from and to - inclusive/exclusive document positions.
 * @outputs The substring of `doc` between `from` (inclusive) and `to` (exclusive).
 * @dataflow (doc, from, to) → doc.textBetween(from, to, '\n') → returned string.
 * @controlflow Single straight-line call with no branching; the separator is fixed so multi-paragraph spans stay readable in assertions.
 */
function rendered(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, '\n');
}

/**
 * @purpose The assertion that matters: it takes a range of source offsets, maps it onto document positions, and reads back the rendered text — so a passing result proves the two coordinate systems actually line up rather than merely that some number came out.
 * @inputs source - The raw Markdown containing `word`; word - A substring known to appear in `source`.
 * @outputs The rendered text found at the mapped range, or null when the source range could not be mapped (in which case the test should treat this as a failure).
 * @dataflow indexOf(source, word) → build(source) → offsetRangeToPositions(index, at, at + word.length) → doc.textBetween(from, to, '\n').
 * @controlflow Locate `word` and assert it exists; map its [at, at+length) source span; when the mapping is null return null so a test can assert that too, otherwise read back the rendered characters.
 */
function mapsTo(source: string, word: string): string | null {
  const at = source.indexOf(word);

  // `word` must actually be present in the source before it can be mapped; an absent target is a broken test, not a valid case.
  expect(at).not.toBe(-1);

  const { index, doc } = build(source);
  const result = offsetRangeToPositions(index, at, at + word.length);

  // A null mapping means the coordinate systems failed to agree on this range; surface it as an explicit failure rather than a silent miss.
  if (result === null) {
    return null;
  }

  return rendered(doc, result.from, result.to);
}

describe('offset-map', () => {
  // Group 1 — each source range maps to the same text in the document.

  it('maps a plain paragraph word back to itself', () => {
    expect(mapsTo('The quick brown fox', 'quick')).toBe('quick');
  });

  // The `# ` exists in the source and not in the document, so a naive one-to-one mapping would be two characters out.
  it('maps past a heading markup offset to the following word', () => {
    expect(mapsTo('# Title\n\nThe quick brown fox', 'quick')).toBe('quick');
  });

  // The emphasis delimiters are source-only, so an interior match must skip them rather than land on the wrong character.
  it('maps inside an emphasis span to its own text', () => {
    expect(mapsTo('A **bold** word here', 'bold')).toBe('bold');
  });

  // The `**` pairs are four source characters the document does not have, so this is the case that catches an off-by-four.
  it('maps a word after emphasis without drifting by the delimiter count', () => {
    expect(mapsTo('A **bold** word here', 'word')).toBe('word');
  });

  // List markers are source-only markup; the item body must still resolve to its own characters.
  it('maps inside a list item to that item text', () => {
    expect(mapsTo('- alpha\n- beta\n- gamma', 'beta')).toBe('beta');
  });

  // The blockquote marker is source-only, so the quoted body must map without counting the leading `> `.
  it('maps inside a blockquote to its own text', () => {
    expect(mapsTo('> quoted text here', 'quoted')).toBe('quoted');
  });

  // A nested mark adds extra delimiters; a word after them must still land on itself.
  it('maps across a nested mark to the trailing word', () => {
    expect(mapsTo('Some *italic **and bold** text* here', 'here')).toBe('here');
  });

  // The second paragraph starts at an offset that includes both newlines; its first word must still resolve correctly.
  it('maps a word in a later paragraph to itself', () => {
    expect(mapsTo('First para.\n\nSecond para.', 'Second')).toBe('Second');
  });

  // Group 2 — the remaining behaviour.

  it('round-trips offsets on plain text', () => {
    const { index } = build('The quick brown fox');

    for (const offset of [4, 5, 10, 18]) {
      const pos = offsetToPosition(index, offset);

      // A mapped position is required before it can be resolved back; a null here means the forward map failed.
      expect(pos).not.toBeNull();

      if (pos === null) {
        continue;
      }

      // The round trip must return to exactly where it started on this linear run of text.
      expect(positionToOffset(index, pos)).toBe(offset);
    }
  });

  // An empty document is a legitimate state, not a fault: there are simply no segments to map against.
  it('maps nothing for an empty index', () => {
    const { index } = build('');

    expect(offsetToPosition(index, 0)).toBeNull();
    expect(positionToOffset(index, 0)).toBeNull();
  });

  // A collapsed range has no characters and an inverted range is nonsensical; both must be refused rather than mapped.
  it('refuses an empty or inverted range', () => {
    const { index } = build('The quick brown fox');

    expect(offsetRangeToPositions(index, 5, 5)).toBeNull();
    expect(offsetRangeToPositions(index, 9, 4)).toBeNull();
  });

  // A non-linear segment is taken whole, so the mapped range may cover a little more than asked — over-covering marks the right words, while under-covering could cut one in half.
  it('covers an inline code span at least fully', () => {
    const source = 'Call `render()` now';
    const backtick = source.indexOf('`');

    // The whole backticked span includes both delimiters; extend the end past the closing backtick so the range encloses it.
    const to = backtick + '`render()`'.length;

    const { index, doc } = build(source);
    const result = offsetRangeToPositions(index, backtick, to);

    expect(result).not.toBeNull();

    if (result === null) {
      return;
    }

    // The rendered text must contain the code contents even though markup delimiters were part of the requested source range.
    expect(rendered(doc, result.from, result.to)).toContain('render()');
  });

  // Markup has no position of its own, so an offset inside it lands on the next real text rather than a phantom character.
  it('snaps an offset inside markup forward to real text', () => {
    const source = '# Title\n\nBody text';
    const { index, doc } = build(source);

    // The `#` sits in heading markup with no position of its own; mapping it must still resolve somewhere honest.
    const pos = offsetToPosition(index, 0);

    expect(pos).not.toBeNull();

    if (pos === null) {
      return;
    }

    // Snapping forward into the heading body reads back exactly the visible title text for this span.
    expect(rendered(doc, pos, pos + 5)).toBe('Title');
  });

  // Ordinary Markdown with emphasis and inline code should not trip the divergence detector that flags out-of-step walks.
  it('reports no divergence for ordinary markdown', () => {
    const { index } = build('# Title\n\nA **bold** word and `code` too.');

    expect(index.divergedAt).toBeNull();
    expect(index.segments.length).toBeGreaterThan(2);
  });
});