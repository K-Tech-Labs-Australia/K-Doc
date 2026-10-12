/**
 * @file fidelity-align.spec.ts
 * @purpose Verifies the block alignment helpers of the Fidelity Check (FR-4.5): contentKey, rangeTouched, and alignBlocks.
 * @inputs Vitest test cases; parsed markdown RootContent nodes from parseMarkdown; base/current key arrays for alignBlocks.
 * @outputs Test assertions that pass or fail the suite; no runtime values returned to production code.
 * @functions
 *   - describe('contentKey'): asserts content identity is stable across offsets and free of position metadata.
 *   - describe('rangeTouched'): asserts inclusive overlap semantics against touched ranges.
 *   - describe('alignBlocks'): asserts LCS-based block pairing, empty-side handling, determinism, and the cell budget limit.
 * @dataflow Test literals → parseMarkdown/inline arrays → align helpers → expect assertions.
 * @controlflow Mount suite → run each describe's it blocks sequentially → report pass/fail per assertion.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { alignBlocks, contentKey, rangeTouched, MAX_ALIGNMENT_CELLS } from '../src/fidelity/fidelity-align.js';
import { parseMarkdown } from '../src/parse/parser.js';

describe('contentKey', () => {
  // Proves that identical block content yields the same key regardless of source offset.
  it('is equal for the same block parsed at different offsets', () => {
    const a = parseMarkdown('One.\n').root.children[0];
    const b = parseMarkdown('# H\n\nOne.\n').root.children[1];
    if (a === undefined || b === undefined) throw new Error('parse failed');
    expect(contentKey(a)).toBe(contentKey(b));
  });

  // Proves that position metadata never appears in the serialized key at any nesting depth.
  it('contains no position at any depth', () => {
    const node = parseMarkdown('- *a*\n').root.children[0];
    if (node === undefined) throw new Error('parse failed');
    expect(contentKey(node)).not.toContain('"position"');
  });

  // Proves that differing block content produces distinct keys.
  it('differs when content differs', () => {
    const one = parseMarkdown('One.\n').root.children[0];
    const two = parseMarkdown('Two.\n').root.children[0];
    if (one === undefined || two === undefined) throw new Error('parse failed');
    expect(contentKey(one)).not.toBe(contentKey(two));
  });
});

describe('rangeTouched', () => {
  // Proves that a query range overlaps a touched range only when inclusive bounds intersect at both ends.
  it('reports inclusive overlap against each touched range', () => {
    expect(rangeTouched(5, 10, [])).toBe(false);
    expect(rangeTouched(5, 10, [{ start: 10, end: 12 }])).toBe(true);
    expect(rangeTouched(5, 10, [{ start: 11, end: 12 }])).toBe(false);
    expect(rangeTouched(5, 10, [{ start: 0, end: 5 }])).toBe(true);
    expect(rangeTouched(5, 10, [{ start: 0, end: 4 }])).toBe(false);
    expect(rangeTouched(5, 5, [{ start: 5, end: 5 }])).toBe(true);
    expect(rangeTouched(5, 10, [{ start: 20, end: 30 }, { start: 7, end: 7 }])).toBe(true);
  });
});

describe('alignBlocks', () => {
  // Proves that equal keys flanking a changed block are paired while the changed block is skipped.
  it('pairs equal keys around a changed block', () => {
    expect(alignBlocks(['A', 'B', 'C'], ['A', 'X', 'C'])).toEqual([
      { base: 0, current: 0 },
      { base: 2, current: 2 },
    ]);
  });

  // Proves that a leading insertion shifts later blocks forward for alignment.
  it('aligns an insertion at the start', () => {
    expect(alignBlocks(['A', 'B'], ['B', 'A', 'B'])).toEqual([
      { base: 0, current: 1 },
      { base: 1, current: 2 },
    ]);
  });

  // Proves that an empty side yields no pairs regardless of which document is empty.
  it('returns nothing when one side is empty', () => {
    expect(alignBlocks(['A'], [])).toEqual([]);
    expect(alignBlocks([], ['A'])).toEqual([]);
  });

  // Proves that a reversed sequence yields exactly one deterministic pair (the longest common subsequence).
  it('finds one pair in a reversed sequence, deterministically', () => {
    expect(alignBlocks(['A', 'B', 'C'], ['C', 'B', 'A'])).toEqual([{ base: 2, current: 0 }]);
  });

  // Proves that identical sequences are fully aligned one-to-one.
  it('aligns identical sequences fully', () => {
    expect(alignBlocks(['A', 'B', 'A'], ['A', 'B', 'A'])).toEqual([
      { base: 0, current: 0 },
      { base: 1, current: 1 },
      { base: 2, current: 2 },
    ]);
  });

  // Proves that a single changed block exactly at the cell limit still aligns to one pair.
  it('aligns a middle exactly at the cell limit', () => {
    const size = Math.sqrt(MAX_ALIGNMENT_CELLS); // 2000 for MAX_ALIGNMENT_CELLS = 4_000_000.
    const base: string[] = Array.from({ length: size }, (_: unknown, i: number): string => `b${i}`);
    const current: string[] = Array.from({ length: size }, (_: unknown, i: number): string => `c${i}`);
    base[1000] = 'X';
    current[1000] = 'X';
    expect(alignBlocks(base, current)).toEqual([{ base: 1000, current: 1000 }]);
  });

  // Proves that a middle exceeding the cell limit is left unaligned.
  it('leaves a middle past the cell limit unaligned', () => {
    const size = Math.sqrt(MAX_ALIGNMENT_CELLS) + 1; // 2001, so (size)^2 exceeds MAX_ALIGNMENT_CELLS.
    const base: string[] = Array.from({ length: size }, (_: unknown, i: number): string => `b${i}`);
    const current: string[] = Array.from({ length: size }, (_: unknown, i: number): string => `c${i}`);
    base[1000] = 'X';
    current[1000] = 'X';
    expect(alignBlocks(base, current)).toEqual([]);
  });
});
