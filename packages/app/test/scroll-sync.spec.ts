// @vitest-environment jsdom

/**
 * @file scroll-sync.spec.ts
 * @purpose Vitest suite verifying the block-boundary alignment algorithm (alignedScrollTop) for dual-pane scroll synchronization (FR-5.5).
 * @inputs Readonly arrays of BlockAnchor measurements for source and target editor panes; source scrollTop offsets in pixels.
 * @outputs Vitest assertions validating target scrollTop positions across degenerate inputs, block boundaries, boundary edge cases, and asymmetric pane block counts.
 * @functions
 *   - anchors: Maps an array of vertical pixel offsets to a readonly array of BlockAnchor objects with sequential indices.
 * @dataflow Test pixel offsets -> anchors() helper -> alignedScrollTop() -> Vitest expect() assertions.
 * @controlflow Run Vitest test suites: degenerate input checks -> block-boundary interpolation -> boundary edge cases -> asymmetric pane block counts.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { alignedScrollTop, type BlockAnchor } from '../src/shell/scroll-sync.js';

// This suite deliberately targets the pure function `alignedScrollTop` rather than `installScrollSync`:
// the algorithm is the part with behaviour worth pinning, and driving the DOM listener path in jsdom
// would mostly be measuring jsdom's layout, which reports every element as zero-sized.

/**
 * @purpose Maps an array of vertical pixel offsets to a readonly array of BlockAnchor objects with sequential block indices.
 * @inputs tops - Readonly array of block vertical top positions in pixels.
 * @outputs readonly BlockAnchor[] - Readonly array of BlockAnchor objects with sequential indices and corresponding pixel offsets.
 * @dataflow tops array -> Array.prototype.map -> readonly BlockAnchor[] array.
 * @controlflow Iterate over tops array -> construct BlockAnchor object for each position -> return anchor array.
 */
function anchors(tops: readonly number[]): readonly BlockAnchor[] {
  return tops.map((top: number, index: number): BlockAnchor => ({ index, top }));
}

describe('degenerate input', (): void => {
  it('returns null when source anchors are empty', (): void => {
    expect(alignedScrollTop([], anchors([0, 100]), 0)).toBeNull();
  });

  it('returns null when target anchors are empty', (): void => {
    expect(alignedScrollTop(anchors([0, 100]), [], 0)).toBeNull();
  });

  it('returns null when both source and target anchors are empty', (): void => {
    expect(alignedScrollTop([], [], 0)).toBeNull();
  });
});

describe('aligning on block boundaries', (): void => {
  // Differing heights are the whole point of this test: a line-ratio sync would be wrong for
  // every one of these cases, and a Markdown editor renders mismatched heights constantly
  // (a code block, a table, an image).
  const source = anchors([0, 100, 200, 300]);
  const target = anchors([0, 40, 300, 320]);

  it('puts the target at exactly block 2 (300) when scrolled to block 2 in the source (scrollTop 200)', (): void => {
    expect(alignedScrollTop(source, target, 200)).toBe(300);
  });

  it('puts the target at 0 when scrolled to 0', (): void => {
    expect(alignedScrollTop(source, target, 0)).toBe(0);
  });

  it('interpolates halfway through block 1 (scrollTop 150) to halfway between target block 1 and block 2 (170)', (): void => {
    // Target calculation: 40 + 0.5 * (300 - 40) = 170
    expect(alignedScrollTop(source, target, 150)).toBe(170);
  });

  it('interpolates a quarter into block 0 (scrollTop 25) to a quarter into target first gap (10)', (): void => {
    // Target calculation: 0 + 0.25 * 40 = 10
    expect(alignedScrollTop(source, target, 25)).toBe(10);
  });
});

describe('edges', (): void => {
  it('uses the first block rather than returning null when scrollTop is above the first anchor', (): void => {
    const source = anchors([50, 150, 250]);
    const target = anchors([80, 180, 280]);
    expect(alignedScrollTop(source, target, 10)).toBe(80);
  });

  it('returns the target last top when scrollTop is past the last block', (): void => {
    // There is no next block to interpolate towards, so progress is 0 and the answer is the last anchor exactly.
    const source = anchors([0, 100, 200]);
    const target = anchors([0, 50, 120]);
    expect(alignedScrollTop(source, target, 500)).toBe(120);
  });

  it('never returns a negative scrollTop when interpolating downwards', (): void => {
    // A negative scrollTop is silently clamped by the browser anyway, so returning one
    // would just hide the arithmetic error rather than surface it.
    const source = anchors([0, 100]);
    const target = anchors([100, 0]);
    const result = alignedScrollTop(source, target, 50);
    expect(result).not.toBeNull();
    // Check if result is non-null to satisfy strict typing without non-null assertions.
    if (result !== null) {
      // Result is a valid number: assert it is greater than or equal to zero.
      expect(result).toBeGreaterThanOrEqual(0);
    } else {
      // Guard branch: result was unexpectedly null.
    }
  });
});

describe('panes that disagree on block count', (): void => {
  it('falls back to the target last anchor when source has more blocks than target', (): void => {
    // The two panes can disagree for a moment after an edit, and refusing to scroll leaves them
    // visibly out of step — being approximately right is better than being stuck.
    const source = anchors([0, 100, 200, 300]);
    const target = anchors([0, 150]);
    expect(alignedScrollTop(source, target, 300)).toBe(150);
  });

  it('still finds the target block 1 when source has fewer blocks than target', (): void => {
    const source = anchors([0, 100]);
    const target = anchors([0, 60, 180, 240]);
    expect(alignedScrollTop(source, target, 100)).toBe(60);
  });
});
