// @vitest-environment jsdom
/**
 * @file match-scrollbar.test.ts
 * @purpose Vitest suite for ./match-scrollbar.js, covering the pure offset arithmetic of tickFraction (normalisation, empty-document guard, and clamping) and the DOM construction/rendering behaviour of createMatchScrollbar (one tick per match, percentage positioning, hiding on empty, and wholesale rebuild).
 * @inputs The document from jsdom used to build the overlay div; a match() helper that synthesises SearchMatch values whose start is what placement reads.
 * @outputs Assertions over tickFraction's normalised fractions and its boundary cases, and over the ticks createMatchScrollbar renders, positions, hides, and rebuilds.
 * @functions
 *   - describe: Groups every assertion under one suite named after the module.
 *   - match: Returns a SearchMatch whose start is set and whose end/groups are filler, because only the start drives tick placement.
 *   - it: Each named assertion pinning exactly one behaviour of tickFraction or createMatchScrollbar.
 * @dataflow jsdom document → createMatchScrollbar → overlay div; match() values + activeIndex + docLength → render rebuild → positioned ticks → class, style.top, hidden, and child-count assertions.
 * @controlflow Import module + helper → describe block runs each it in order, asserting the pure arithmetic first then overlay construction and rendering.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { tickFraction, createMatchScrollbar } from './match-scrollbar.js';
import type { SearchMatch } from '@k-doc/core';

/**
 * @purpose Returns a SearchMatch whose start is the given character offset and whose end and groups are filler, because render() only reads match.start to place a tick.
 * @inputs start - Character index of the match's beginning within the document; this is the only field placement consumes.
 * @outputs SearchMatch - A match with end set to start + 5 (arbitrary length) and an empty groups array, so each call reads as "a match beginning at start".
 * @dataflow start → object literal { start, end: start + 5, groups: [] } → returned SearchMatch.
 * @controlflow No branching — a static object literal built from the single argument.
 */
function match(start: number): SearchMatch {
  // Only start matters here: a tick marks where a match begins, not how long it is, because at overview scale its length is under a pixel and render() never reads end or groups.
  return { start, end: start + 5, groups: [] };
}

describe('match-scrollbar', () => {
  it('places a tick at its share of the document', () => {
    // Pins the fraction as exact literals so a wrong denominator or missing clamp fails here instead of agreeing with itself.
    expect(tickFraction(50, 200)).toBe(0.25);
    expect(tickFraction(0, 200)).toBe(0);
    expect(tickFraction(200, 200)).toBe(1);
  });

  it('answers zero for an empty document', () => {
    // The alternative is NaN: dividing by zero reaches the DOM as an unparseable top and silently places nothing, so the guard returning 0 keeps placement defined.
    expect(tickFraction(0, 0)).toBe(0);
  });

  it('clamps a match that outran the document', () => {
    // A stale match can point past the end of a document that has since shrunk; clamping pins such a tick to a boundary rather than drawing it outside the strip, where it would be drawn nowhere at all and read as a match that vanished.
    expect(tickFraction(500, 200)).toBe(1);
    expect(tickFraction(-10, 200)).toBe(0);
  });

  it('draws one tick per match', () => {
    // One div per match and exactly one active: the count proves no tick is dropped or duplicated, and the single active class proves the highlight lands on the requested index.
    const scrollbar = createMatchScrollbar(document);
    scrollbar.render([match(0), match(100), match(150)], 1, 200);

    const ticks = scrollbar.element.querySelectorAll('div');
    if (ticks.length !== 3) {
      // Fewer or more than three means a tick was dropped or duplicated; fail loudly rather than asserting against the wrong count.
      throw new Error(`expected three tick divs, found ${ticks.length}`);
    }

    let activeCount = 0;
    for (let i = 0; i < ticks.length; i += 1) {
      const tick = ticks[i];
      if (tick === undefined) {
        // noUncheckedIndexedAccess types the read as possibly-undefined even though length is three; a hole here means the list is malformed.
        throw new Error('expected every tick index to resolve');
      } else {
        // A real tick: count it only when it carries the active class, so exactly one active survives.
        if (tick.className.includes('kdoc-match-tick-active')) {
          activeCount += 1;
        }
      }
    }

    expect(activeCount).toBe(1);
  });

  it('positions each tick by percentage', () => {
    // The start offset as a share of the document, scaled to percent and fixed to three places, is what render() writes to style.top; pinning the exact string catches both wrong arithmetic and missing formatting.
    const scrollbar = createMatchScrollbar(document);
    scrollbar.render([match(50)], 0, 200);

    const tick = scrollbar.element.querySelector('div');
    if (tick === null) {
      // No matching div means render() produced nothing; surface it instead of reading a missing element.
      throw new Error('expected a single tick div inside the match-scrollbar');
    } else {
      // The CSSOM normalises the value on the way back out, so '25.000%' reads as '25%'. The number is
      // what this pins; the trailing zeros are a formatting detail of the string that was written in.
      expect(tick.style.top.endsWith('%')).toBe(true);
      expect(Number.parseFloat(tick.style.top)).toBeCloseTo(25, 3);
    }
  });

  it('hides itself when there is nothing to show', () => {
    // An empty strip left on screen still occupies width and reads as a scrollbar that has stopped working, so render([]) must both clear the ticks and hide the gutter.
    const scrollbar = createMatchScrollbar(document);
    scrollbar.render([match(0), match(100), match(150)], 0, 200);
    scrollbar.render([], 0, 200);

    expect(scrollbar.element.children.length).toBe(0);
    expect(scrollbar.element.hidden).toBe(true);
  });

  it('rebuilds rather than accumulating', () => {
    // The match list changes wholesale on every keystroke, so render() must replace children entirely; leaving stale ticks from a previous render would be cheaper to get wrong than right.
    const scrollbar = createMatchScrollbar(document);
    scrollbar.render([match(0), match(100), match(150)], 0, 200);
    scrollbar.render([match(75)], 0, 200);

    expect(scrollbar.element.children.length).toBe(1);
  });
});
