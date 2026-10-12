/**
 * @file position.spec.ts
 * @purpose Vitest test suite for the offset and point position-mapping functions and AST range queries in @k-doc/core.
 * @inputs Source Markdown strings, character offsets, unist Point objects, KdocDocument instances, and OffsetRange intervals.
 * @outputs Vitest assertions validating offsetToPoint, pointToOffset, nodeRange, nodeAtOffset, and nodesInRange.
 * @functions None (test suite file executing describe and it blocks).
 * @dataflow Markdown text and offset / point values -> position conversion and AST query functions -> unist Points, offsets, and NodePath arrays -> equality and error assertions.
 * @controlflow Execute test suites across offsetToPoint, pointToOffset, nodeRange, nodeAtOffset, and nodesInRange covering clamping, round-tripping, hierarchy ordering, and bounds.
 * @version 1
 * @date 2026-09-04
 */

import type { Node, Parent, Point } from 'unist';
import { describe, expect, it } from 'vitest';
import {
  nodeAtOffset,
  nodeRange,
  nodesInRange,
  offsetToPoint,
  parseMarkdown,
  pointToOffset,
  type KdocDocument,
  type NodePath,
  type OffsetRange,
} from '../src/index.js';

describe('offsetToPoint', () => {
  it('converts offset 0 to line 1, column 1, offset 0', () => {
    // Offset 0 of 'abc' must be { line: 1, column: 1, offset: 0 }.
    expect(offsetToPoint('abc', 0)).toEqual({ line: 1, column: 1, offset: 0 });
  });

  it('computes line and column for offsets on subsequent lines', () => {
    const text = 'ab\ncd';
    // Offset 3 (character 'c') is on line 2, column 1.
    expect(offsetToPoint(text, 3)).toEqual({ line: 2, column: 1, offset: 3 });
    // Offset 4 (character 'd') is on line 2, column 2.
    expect(offsetToPoint(text, 4)).toEqual({ line: 2, column: 2, offset: 4 });
  });

  it('treats newline offset as belonging to the line it terminates', () => {
    const text = 'ab\ncd';
    // Offset 2 (the newline itself) belongs to line 1, column 3.
    expect(offsetToPoint(text, 2)).toEqual({ line: 1, column: 3, offset: 2 });
  });

  it('clamps a negative offset to line 1, column 1, offset 0', () => {
    // A negative offset clamps to { line: 1, column: 1, offset: 0 }.
    expect(offsetToPoint('abc', -5)).toEqual({ line: 1, column: 1, offset: 0 });
  });

  it('clamps an offset past the end of the document to the document end', () => {
    // For 'ab', offset 99 clamps to the end of the document at offset 2 (line 1, column 3).
    expect(offsetToPoint('ab', 99)).toEqual({ line: 1, column: 3, offset: 2 });
  });

  it('handles CRLF line endings with carriage return counted on line 1', () => {
    const text = 'ab\r\ncd';
    // Offset 4 (character 'c') is on line 2, column 1, proving '\r' was counted on line 1.
    expect(offsetToPoint(text, 4)).toEqual({ line: 2, column: 1, offset: 4 });
  });
});

describe('pointToOffset', () => {
  it('round-trips against offsetToPoint for every offset in the document', () => {
    const text = '# Title\n\nBody text\n- item\n';
    // Iterate across all valid character offsets including text.length.
    for (let i = 0; i <= text.length; i += 1) {
      const point: Point = offsetToPoint(text, i);
      expect(pointToOffset(text, point)).toBe(i);
    }
  });

  it('round-trips against offsetToPoint for every offset in a CRLF document', () => {
    // K-Doc preserves CRLF (FR-6.6), so the round-trip property must hold there too. This is the
    // case where a line's addressable range must extend to the terminating \n rather than stopping
    // before the \r, or the \n's own offset would collapse onto the \r's.
    const text = '# Title\r\n\r\nBody text\r\n- item\r\n';
    for (let i = 0; i <= text.length; i += 1) {
      const point: Point = offsetToPoint(text, i);
      expect(pointToOffset(text, point)).toBe(i);
    }
  });

  it('throws RangeError for invalid line numbers (0 or past end of document)', () => {
    const text = 'ab\ncd';
    // Line 0 is invalid (lines are 1-indexed); expect RangeError.
    expect(() => pointToOffset(text, { line: 0, column: 1 })).toThrow(RangeError);
    // Line 10 is past the end of the 2-line document; expect RangeError.
    expect(() => pointToOffset(text, { line: 10, column: 1 })).toThrow(RangeError);
  });

  it('clamps a column past the end of its line to the line end offset', () => {
    const text = 'ab\ncd';
    // For line 1, column 99 clamps to offset 2 (the end of line 1 before newline).
    expect(pointToOffset(text, { line: 1, column: 99 })).toBe(2);
  });
});

describe('nodeRange', () => {
  it('computes offset range covering source text for a parsed heading node', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n');
    const heading = doc.root.children[0];
    expect(heading).toBeDefined();

    // Check if heading node is defined.
    if (heading !== undefined) {
      // Heading node is defined: its range covers '# Title' from offset 0 to 7.
      expect(nodeRange(heading)).toEqual({ start: 0, end: 7 });
    } else {
      // Heading node is undefined.
    }
  });

  it('returns null for a node without position metadata', () => {
    // Synthetic unist node lacking position metadata.
    const syntheticNode: Node = { type: 'text' };
    expect(nodeRange(syntheticNode)).toBeNull();
  });
});

describe('nodeAtOffset', () => {
  it('resolves deepest node and root-first ancestors for an offset inside heading text', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    // Offset 3 is inside the word 'Title'.
    const result = nodeAtOffset(doc, 3);
    expect(result).not.toBeNull();

    // The returned node is the DEEPEST match: assert type is 'text', not 'heading'.
    expect(result?.node.type).toBe('text');

    // Ancestors are ordered root-first: assert root is at index 0.
    expect(result?.ancestors[0]?.type).toBe('root');

    // Ancestors array includes both 'heading' and 'root'.
    const ancestorTypes: readonly string[] =
      result?.ancestors.map((ancestor: Parent): string => ancestor.type) ?? [];
    expect(ancestorTypes).toContain('heading');
    expect(ancestorTypes).toContain('root');
  });

  it('returns null for an offset far past the end of the document', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    expect(nodeAtOffset(doc, 9999)).toBeNull();
  });

  it('does not throw when offset lands on a blank line between paragraphs', () => {
    const doc: KdocDocument = parseMarkdown('Paragraph 1.\n\nParagraph 2.\n');
    // Offset 13 lands on the blank line between the two paragraphs.
    // Blank-line containment is deliberately unspecified (may return null or an enclosing node);
    // assert only that the invocation does not throw.
    expect(() => nodeAtOffset(doc, 13)).not.toThrow();
  });
});

describe('nodesInRange', () => {
  it('returns intersecting nodes in pre-order for a range spanning the whole document', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    const fullRange: OffsetRange = { start: 0, end: doc.text.length };
    const results: readonly NodePath[] = nodesInRange(doc, fullRange);
    const types: string[] = results.map((path: NodePath): string => path.node.type);

    // Range spanning the whole document returns nodes including 'root', 'heading', and 'paragraph'.
    expect(types).toContain('root');
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');

    // Results are ordered in pre-order traversal: 'root' is at index 0.
    expect(types.indexOf('root')).toBe(0);
  });

  it('returns intersecting nodes containing heading for an empty range (caret)', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    // An empty range (caret) positioned at offset 3 inside 'Title'.
    const emptyRange: OffsetRange = { start: 3, end: 3 };
    const results: readonly NodePath[] = nodesInRange(doc, emptyRange);

    expect(results.length).toBeGreaterThan(0);
    const types: string[] = results.map((path: NodePath): string => path.node.type);
    expect(types).toContain('heading');
  });

  it('normalizes reversed ranges to return identical node types', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    const forwardRange: OffsetRange = { start: 2, end: 10 };
    const reversedRange: OffsetRange = { start: 10, end: 2 };

    const forwardResults: readonly NodePath[] = nodesInRange(doc, forwardRange);
    const reversedResults: readonly NodePath[] = nodesInRange(doc, reversedRange);

    const forwardTypes: string[] = forwardResults.map((path: NodePath): string => path.node.type);
    const reversedTypes: string[] = reversedResults.map((path: NodePath): string => path.node.type);

    expect(reversedTypes).toEqual(forwardTypes);
  });

  it('returns an empty array for a range entirely past the end of the document', () => {
    const doc: KdocDocument = parseMarkdown('# Title\n\nBody text.\n');
    const pastEndRange: OffsetRange = { start: 500, end: 600 };
    const results: readonly NodePath[] = nodesInRange(doc, pastEndRange);

    expect(results).toEqual([]);
  });
});
