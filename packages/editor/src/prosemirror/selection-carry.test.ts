// @vitest-environment jsdom
/**
 * @file selection-carry.test.ts
 * @purpose Vitest test suite covering selection translation between raw Markdown character offsets and ProseMirror document positions via selection-carry.ts (FR-5.6).
 * @inputs Markdown source strings and selection ranges in source and ProseMirror coordinate systems.
 * @outputs Vitest assertions verifying mapped positions, caret retention, direction preservation, and boundary clamping.
 * @functions
 *   - build: Parses one source string into an mdast tree and ProseMirror document, builds its PositionIndex, and returns all three.
 *   - rendered: Reads the substring of a document node between two positions using '\n' as the paragraph separator.
 *   - sourceRangeOf: Finds the character offset range of a target word within a source Markdown string.
 * @dataflow Markdown source string → parseMarkdown & mdastToProseMirror → buildPositionIndex → selection-carry mapping → ProseMirror / source selection assertions.
 * @controlflow Tests grouped into sourceSelectionToProseMirror and proseMirrorSelectionToSource describe blocks verifying forward/backward mapping, caret collapsing, direction retention, clamping, and null safety.
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import { mdastToProseMirror } from './from-mdast.js';
import {
  buildPositionIndex,
  type PositionIndex,
} from './offset-map.js';
import type { Node as PMNode } from 'prosemirror-model';
import {
  sourceSelectionToProseMirror,
  proseMirrorSelectionToSource,
} from './selection-carry.js';

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
 * @inputs doc - The ProseMirror node whose span is read; from and to - document positions ordered via Math.min and Math.max.
 * @outputs The substring of `doc` between the smaller and larger of `from` and `to`.
 * @dataflow (doc, from, to) → doc.textBetween(min, max, '\n') → returned string.
 * @controlflow Calculate normalized bounds via Math.min and Math.max; read back text span from doc.
 */
function rendered(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(Math.min(from, to), Math.max(from, to), '\n');
}

/**
 * @purpose Finds the character range of a word in a source string.
 * @inputs source - The raw Markdown source string; word - Substring to locate in source.
 * @outputs An object with start and end character offsets of word in source.
 * @dataflow source.indexOf(word) → validate match → calculate end offset → return { start, end }.
 * @controlflow Search for word via indexOf; if absent fail test immediately naming the word; return { start, end }.
 */
function sourceRangeOf(source: string, word: string): { start: number; end: number } {
  const start = source.indexOf(word);

  // Check if the target word was found in the source string.
  if (start === -1) {
    // Word was not found: fail the test immediately naming the missing word.
    expect.fail(`Word "${word}" not found in source text: "${source}"`);
  } else {
    // Word found: calculate end offset and return range.
  }

  return { start, end: start + word.length };
}

describe('sourceSelectionToProseMirror', () => {
  // Verifies that a forward word selection in a plain paragraph maps to the identical rendered characters.
  it('maps a word in a plain paragraph to the same rendered word', (): void => {
    const { index, doc, source } = build('The quick brown fox');
    const range = sourceRangeOf(source, 'quick');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: range.start,
      head: range.end,
    });

    expect(result).not.toBeNull();
    // Check if the forward mapping produced a non-null TextSelection.
    if (result !== null) {
      expect(rendered(doc, result.from, result.to)).toBe('quick');
    } else {
      // Forward mapping returned null unexpectedly: fail the test.
      expect.fail('Expected non-null TextSelection');
    }
  });

  // Verifies that heading markup and inter-block blank lines are skipped when mapping source selections.
  it('skips heading markup and inter-block spacing when mapping selections', (): void => {
    const { index, doc, source } = build('# Title\n\nBody text here');

    const titleRange = sourceRangeOf(source, 'Title');
    const titleResult = sourceSelectionToProseMirror(index, doc, {
      anchor: titleRange.start,
      head: titleRange.end,
    });

    expect(titleResult).not.toBeNull();
    // Check if mapping the heading title produced a non-null TextSelection.
    if (titleResult !== null) {
      expect(rendered(doc, titleResult.from, titleResult.to)).toBe('Title');
    } else {
      // Heading title mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for Title');
    }

    const bodyRange = sourceRangeOf(source, 'Body');
    const bodyResult = sourceSelectionToProseMirror(index, doc, {
      anchor: bodyRange.start,
      head: bodyRange.end,
    });

    expect(bodyResult).not.toBeNull();
    // Check if mapping the body paragraph text produced a non-null TextSelection.
    if (bodyResult !== null) {
      expect(rendered(doc, bodyResult.from, bodyResult.to)).toBe('Body');
    } else {
      // Body paragraph mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for Body');
    }
  });

  // Verifies that markdown emphasis delimiters do not cause offset drift when selecting formatted words.
  it('maps a word inside emphasis formatting without delimiter offset', (): void => {
    const { index, doc, source } = build('Some **bold words** here');
    const range = sourceRangeOf(source, 'bold');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: range.start,
      head: range.end,
    });

    expect(result).not.toBeNull();
    // Check if mapping inside emphasis produced a non-null TextSelection.
    if (result !== null) {
      expect(rendered(doc, result.from, result.to)).toBe('bold');
    } else {
      // Emphasis mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for bold');
    }
  });

  // Verifies that list item bullets and blockquote prefixes are excluded from mapped text ranges.
  it('maps words inside list items and blockquotes skipping container markers', (): void => {
    const listBuild = build('- alpha\n- beta');
    const listRange = sourceRangeOf(listBuild.source, 'beta');
    const listResult = sourceSelectionToProseMirror(listBuild.index, listBuild.doc, {
      anchor: listRange.start,
      head: listRange.end,
    });

    expect(listResult).not.toBeNull();
    // Check if mapping inside the list item produced a non-null TextSelection.
    if (listResult !== null) {
      expect(rendered(listBuild.doc, listResult.from, listResult.to)).toBe('beta');
    } else {
      // List item mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for list item');
    }

    const quoteBuild = build('> quoted line');
    const quoteRange = sourceRangeOf(quoteBuild.source, 'quoted');
    const quoteResult = sourceSelectionToProseMirror(quoteBuild.index, quoteBuild.doc, {
      anchor: quoteRange.start,
      head: quoteRange.end,
    });

    expect(quoteResult).not.toBeNull();
    // Check if mapping inside the blockquote produced a non-null TextSelection.
    if (quoteResult !== null) {
      expect(rendered(quoteBuild.doc, quoteResult.from, quoteResult.to)).toBe('quoted');
    } else {
      // Blockquote mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for blockquote');
    }
  });

  // Verifies that a collapsed caret remains collapsed and positions immediately before the specified character.
  it('keeps a collapsed caret collapsed and positioned before the same character', (): void => {
    const { index, doc, source } = build('The quick brown fox');
    const range = sourceRangeOf(source, 'brown');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: range.start,
      head: range.start,
    });

    expect(result).not.toBeNull();
    // Check if mapping the collapsed caret produced a non-null TextSelection.
    if (result !== null) {
      expect(result.anchor).toBe(result.head);
      expect(doc.textBetween(result.head, result.head + 5)).toBe('brown');
    } else {
      // Collapsed caret mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for collapsed caret');
    }
  });

  // Verifies that backwards selections preserve their orientation (anchor > head) without inverting.
  it('preserves selection direction for backwards selections', (): void => {
    const { index, doc, source } = build('The quick brown fox');
    const range = sourceRangeOf(source, 'quick');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: range.end,
      head: range.start,
    });

    expect(result).not.toBeNull();
    // Check if mapping the backwards selection produced a non-null TextSelection.
    if (result !== null) {
      expect(result.anchor).toBeGreaterThan(result.head);
      expect(rendered(doc, result.from, result.to)).toBe('quick');
    } else {
      // Backwards selection mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for backwards selection');
    }
  });

  // Verifies that a caret positioned within prefix markup snaps forward to the text introduced by that markup.
  it('snaps a caret positioned on markup forward to the introduced text', (): void => {
    const { index, doc } = build('# Title');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: 0,
      head: 0,
    });

    expect(result).not.toBeNull();
    // Check if mapping the markup caret produced a non-null TextSelection.
    if (result !== null) {
      expect(result.anchor).toBe(result.head);
      expect(doc.textBetween(result.head, result.head + 5)).toBe('Title');
    } else {
      // Markup caret mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection for caret on markup');
    }
  });

  // Verifies that mapping a selection against an empty document returns null instead of guessing.
  it('returns null for an empty document rather than guessing a position', (): void => {
    const { index, doc } = build('');
    const result = sourceSelectionToProseMirror(index, doc, {
      anchor: 0,
      head: 0,
    });

    expect(result).toBeNull();
  });
});

describe('proseMirrorSelectionToSource', () => {
  // Verifies that a ProseMirror range maps back to the exact original source characters across markup.
  it('maps a ProseMirror selection back to the identical source characters', (): void => {
    const { index, doc, source } = build('# Title\n\nSome **bold words** here');
    const boldRange = sourceRangeOf(source, 'bold');
    const pmSelection = sourceSelectionToProseMirror(index, doc, {
      anchor: boldRange.start,
      head: boldRange.end,
    });

    expect(pmSelection).not.toBeNull();
    // Check if the forward mapping for bold produced a non-null TextSelection.
    if (pmSelection !== null) {
      const sourceSelection = proseMirrorSelectionToSource(
        index,
        { anchor: pmSelection.anchor, head: pmSelection.head },
        source.length,
      );

      expect(sourceSelection).not.toBeNull();
      // Check if the reverse mapping produced a non-null CarriedSelection.
      if (sourceSelection !== null) {
        const start = Math.min(sourceSelection.anchor, sourceSelection.head);
        const end = Math.max(sourceSelection.anchor, sourceSelection.head);
        expect(source.slice(start, end)).toBe('bold');
      } else {
        // Reverse mapping failed: fail the test.
        expect.fail('Expected non-null CarriedSelection from proseMirrorSelectionToSource');
      }
    } else {
      // Forward mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection from sourceSelectionToProseMirror');
    }
  });

  // Verifies that carrying a collapsed caret forward and back across all positions preserves exact offsets.
  it('round-trips collapsed carets across every character offset on linear text', (): void => {
    const { index, doc, source } = build('The quick brown fox');

    for (let i = 0; i <= source.length; i++) {
      const pmSelection = sourceSelectionToProseMirror(index, doc, {
        anchor: i,
        head: i,
      });

      expect(pmSelection).not.toBeNull();
      // Check if the forward mapping produced a non-null TextSelection.
      if (pmSelection !== null) {
        const sourceSelection = proseMirrorSelectionToSource(
          index,
          { anchor: pmSelection.anchor, head: pmSelection.head },
          source.length,
        );

        expect(sourceSelection).not.toBeNull();
        // Check if the reverse mapping produced a non-null CarriedSelection.
        if (sourceSelection !== null) {
          expect(sourceSelection).toEqual({ anchor: i, head: i });
        } else {
          // Reverse mapping failed: fail the test.
          expect.fail(`Failed to map back to source at offset ${i}`);
        }
      } else {
        // Forward mapping failed: fail the test.
        expect.fail(`Failed to map forward to ProseMirror at offset ${i}`);
      }
    }
  });

  // Verifies that reverse mapping preserves direction for backwards ProseMirror selections.
  it('preserves selection direction when mapping backwards selections back to source', (): void => {
    const { index, doc, source } = build('The quick brown fox');
    const range = sourceRangeOf(source, 'quick');
    const pmSelection = sourceSelectionToProseMirror(index, doc, {
      anchor: range.end,
      head: range.start,
    });

    expect(pmSelection).not.toBeNull();
    // Check if the forward mapping produced a backwards TextSelection.
    if (pmSelection !== null) {
      expect(pmSelection.anchor).toBeGreaterThan(pmSelection.head);

      const sourceSelection = proseMirrorSelectionToSource(
        index,
        { anchor: pmSelection.anchor, head: pmSelection.head },
        source.length,
      );

      expect(sourceSelection).not.toBeNull();
      // Check if the reverse mapping produced a non-null CarriedSelection.
      if (sourceSelection !== null) {
        expect(sourceSelection.anchor).toBeGreaterThan(sourceSelection.head);
        expect(sourceSelection).toEqual({ anchor: range.end, head: range.start });
        expect(source.slice(sourceSelection.head, sourceSelection.anchor)).toBe('quick');
      } else {
        // Reverse mapping failed: fail the test.
        expect.fail('Expected non-null CarriedSelection from proseMirrorSelectionToSource');
      }
    } else {
      // Forward mapping failed: fail the test.
      expect.fail('Expected non-null TextSelection from sourceSelectionToProseMirror');
    }
  });

  // Verifies that mapped source offsets are clamped to textLength when positions map beyond the limit.
  it('clamps mapped source offsets to textLength when positions map beyond the limit', (): void => {
    const { index, doc } = build('The quick brown fox');
    const result = proseMirrorSelectionToSource(
      index,
      { anchor: doc.content.size, head: doc.content.size },
      3,
    );

    expect(result).not.toBeNull();
    // Check if reverse mapping with a constrained textLength produced a non-null CarriedSelection.
    if (result !== null) {
      expect(result.anchor).toBeLessThanOrEqual(3);
      expect(result.head).toBeLessThanOrEqual(3);
    } else {
      // Clamping mapping failed: fail the test.
      expect.fail('Expected non-null CarriedSelection when clamping');
    }
  });
});
