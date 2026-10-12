// @vitest-environment jsdom
/**
 * @file leader-line.test.ts
 * @purpose Vitest suite for ./leader-line.js, covering the pure geometry of leaderPath (every rule about when no line should be drawn) and the SVG construction/rendering behaviour of createLeaderLayer.
 * @inputs The Rect fixture (CONTAINER, ANCHOR, CARD) plus a rect() helper that overlays partial overrides onto it; document from jsdom for layer tests.
 * @outputs Assertions over leaderPath's three-point output and its null cases, and over the SVG element created by createLeaderLayer.
 * @functions
 *   - describe: Groups every assertion under one suite named after the module.
 *   - rect: Returns a Rect built from base with partial overrides applied so each case reads as a single difference from the fixture.
 *   - it: Each named assertion pinning exactly one behaviour of leaderPath or createLeaderLayer.
 * @dataflow Fixture rectangles → leaderPath arithmetic → expected literals; document → createLeaderLayer → SVG element → attribute and style assertions.
 * @controlflow Import module + fixtures → describe block runs each it in order, asserting the geometry rules first then layer construction and rendering.
 * @version 1
 * @date 2026-09-10
 */

import { describe, expect, it } from 'vitest';
import { leaderPath, createLeaderLayer, type Rect } from './leader-line.js';

// The container is the pane area; the anchor is a highlighted range inside it; the card is in the panel
// to its right. Coordinates are viewport pixels, as getBoundingClientRect() reports them.
const CONTAINER: Rect = { left: 100, top: 50, right: 900, bottom: 650 };
const ANCHOR: Rect = { left: 200, top: 250, right: 320, bottom: 270 };
const CARD: Rect = { left: 700, top: 400, right: 880, bottom: 480 };

/**
 * @purpose Returns a copy of base with the fields named in over applied on top.
 * @inputs over - Partial<Rect> naming only the edges to change; base - A full Rect to override.
 * @outputs Rect - The same rectangle as base except for every edge named in over, so each test case reads as one difference from the fixture rather than a wall of numbers.
 * @dataflow over + base → object spread applies base first then over's keys win → resulting Rect.
 * @controlflow No branching — later keys in an object literal overwrite earlier ones on spread.
 */
function rect(over: Partial<Rect>, base: Rect): Rect {
  return { ...base, ...over };
}

describe('leader-line', () => {
  it('joins the text to the card in three points', () => {
    // Pins the exact geometry as literals rather than recomputing from constants, so a wrong formula would fail this test instead of agreeing with itself. The anchor's midY is 260 and the card's is 440; subtract CONTAINER (left 100, top 50) to make them container-relative, and the elbow stops 12px short of the card.
    const path = leaderPath(ANCHOR, CARD, CONTAINER);

    if (path === null) {
      throw new Error('leaderPath returned null where three points were expected');
    }

    expect(path.length).toBe(3);
    // 1. anchor's right edge at its midY: x = 320 - 100, y = 260 - 50.
    expect(path[0]).toEqual({ x: 220, y: 210 });
    // 2. horizontal run short of the card by ELBOW (12): x = 700 - 12 - 100, same y as point 1.
    expect(path[1]).toEqual({ x: 588, y: 210 });
    // 3. diagonal into the card's own midY: x = 700 - 100, y = 440 - 50.
    expect(path[2]).toEqual({ x: 600, y: 390 });
  });

  it('runs horizontally before it turns', () => {
    // The first two points share a y so the reader can see which row of text the line left; a single diagonal straight from text to card would leave that ambiguous.
    const path = leaderPath(ANCHOR, CARD, CONTAINER);

    if (path === null) {
      throw new Error('leaderPath returned null where three points were expected');
    }

    // Indexed reads are possibly-undefined under noUncheckedIndexedAccess, and the length assertion in the
    // case above is not something the compiler has seen, so each point is destructured through a guard.
    const [start, elbow, end] = path;
    if (start === undefined || elbow === undefined || end === undefined) {
      // Fewer than three points means the shape changed, which this case exists to notice.
      throw new Error('leaderPath returned fewer than three points');
    }

    expect(start.y).toBe(elbow.y); // Horizontal run: equal height at both ends.
    expect(end.y).not.toBe(start.y); // The diagonal then drops to the card's midY, so the line turns only after running level with the text.
  });

  it('draws nothing when either end is missing', () => {
    // With no anchor there is no text to join; with no card there is nowhere for the line to go — each returns null rather than a phantom connector.
    expect(leaderPath(null, CARD, CONTAINER)).toBeNull();
    expect(leaderPath(ANCHOR, null, CONTAINER)).toBeNull();
  });

  it('draws nothing when the highlight has scrolled out of view', () => {
    // An anchor entirely above or below the container is off-screen; a line running to text nobody can see points at a claim it cannot support, so both return null.
    expect(leaderPath(rect({ top: -60, bottom: -40 }, ANCHOR), CARD, CONTAINER)).toBeNull();
    expect(leaderPath(rect({ top: 900, bottom: 920 }, ANCHOR), CARD, CONTAINER)).toBeNull();
  });

  it('draws nothing when the card is not to the right of the text', () => {
    // This is the collapsed-panel case: moving the card's left edge (700) in past the anchor's right edge (320) makes the line double back on itself, which would be worse than none.
    expect(leaderPath(ANCHOR, rect({ left: 300 }, CARD), CONTAINER)).toBeNull();
  });

  it('creates a real SVG element rather than an unknown tag', () => {
    // An element built with doc.createElement would be an unknown HTML element that renders nothing; the namespaced URI is the only thing distinguishing a true svg, so assert on it directly.
    const layer = createLeaderLayer(document);

    expect(layer.element.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(layer.element.getAttribute('class')).toBe('kdoc-leader-layer');
    expect(layer.element.getAttribute('aria-hidden')).toBe('true');
  });

  it('writes rounded points and clears them again', () => {
    // Rounding to whole pixels is what stops the line shimmering as the pane scrolls past sub-pixel positions; clearing hides the layer entirely (display none) rather than leaving a blank-but-visible polyline.
    const layer = createLeaderLayer(document);

    layer.render([{ x: 1.4, y: 2.6 }, { x: 10.5, y: 20.4 }]);

    const polyline = layer.element.querySelector('polyline');
    if (polyline === null) {
      throw new Error('expected a polyline child inside the leader-layer svg');
    }
    // round(1.4)=1, round(2.6)=3, round(10.5)=11, round(20.4)=20 → "1,3 11,20".
    expect(polyline.getAttribute('points')).toBe('1,3 11,20');

    layer.render(null);
    expect(polyline.getAttribute('points')).toBe('');
    expect(layer.element.style.display).toBe('none');
  });

  it('clears rather than drawing a single point', () => {
    // One point is not a line, and even if written a single-point polyline renders nothing anyway — the guard exists to hide the whole layer (display none) instead of leaving an empty-but-visible element.
    const layer = createLeaderLayer(document);

    layer.render([{ x: 5, y: 5 }]);

    expect(layer.element.querySelector('polyline')?.getAttribute('points')).toBe('');
    expect(layer.element.style.display).toBe('none');
  });
});
