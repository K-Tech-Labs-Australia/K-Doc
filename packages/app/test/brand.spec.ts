// @vitest-environment jsdom
/**
 * @file brand.spec.ts
 * @purpose Verifies the K-Tech brand mark and product wordmark factory functions plus branding constants.
 * @inputs DOM document (jsdom environment); exported brand geometry, styles, slogan from ../src/shell/brand.js.
 * @outputs Assertions on SVG structure, attributes, sizing behaviour, and immutable brand strings.
 * @functions
 *   - keeps the brand geometry exactly: polygon points, viewBox, and frozen immutability.
 *   - draws the mark in current text colour with round joins: namespace, g attrs, per-polygon points.
 *   - is decorative unless labelled: aria-hidden default vs role/img labelling contract.
 *   - sizes itself only when asked: height/width absent by default and rounded aspect when requested.
 *   - replaces the K of the product name with the mark: wordmark structure, text node, absence of 'K'.
 *   - styles the wordmark in Sansation: brand stylesheet tokens and slogan string.
 * @dataflow Exported constants → factory functions → jsdom DOM nodes → expect assertions.
 * @controlflow Each test constructs a node via jsdom then asserts attributes/children; no shared mutable state.
 * @version 1
 * @date 2026-10-06
 */

import { describe, expect, it } from 'vitest';
import { BRAND_SLOGAN, BRAND_STYLES, KTECH_MARK_POLYGONS, KTECH_MARK_VIEWBOX, createBrandMark, createProductWordmark } from '../src/shell/brand.js';

describe('brand', () => {
  // Test 1: brand geometry must be preserved byte-for-byte and stay immutable.
  it('keeps the brand geometry exactly', () => {
    expect(KTECH_MARK_POLYGONS).toEqual(['0,0 13,0 13,39 0,26', '24,50 74,0 92,0 42,50 92,100 74,100', '0,50 13,63 13,76 0,63']);
    expect(KTECH_MARK_VIEWBOX).toBe('-4 -4 106 108');
    expect(Object.isFrozen(KTECH_MARK_POLYGONS)).toBe(true);
  });

  // Test 2: the mark renders in current text colour with round joins and one polygon per point list.
  it('draws the mark in the current text colour with round joins', () => {
    const svg = createBrandMark(document);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('-4 -4 106 108');
    const g = svg.querySelector('g') as SVGGElement;
    expect(g.getAttribute('fill')).toBe('currentColor');
    expect(g.getAttribute('stroke')).toBe('currentColor');
    expect(g.getAttribute('stroke-width')).toBe('7');
    expect(g.getAttribute('stroke-linejoin')).toBe('round');
    const points = Array.from(svg.querySelectorAll('polygon')).map(p => p.getAttribute('points'));
    expect(points).toEqual([...KTECH_MARK_POLYGONS]);
  });

  // Test 3: the mark is decorative (aria-hidden) unless an explicit accessible label is supplied.
  it('is decorative unless labelled', () => {
    const deco = createBrandMark(document);
    expect(deco.getAttribute('aria-hidden')).toBe('true');
    expect(deco.hasAttribute('role')).toBe(false);
    const labelled = createBrandMark(document, { label: 'K-Tech' });
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('K-Tech');
    expect(labelled.hasAttribute('aria-hidden')).toBe(false);
  });

  // Test 4: sizing is opt-in; when requested width follows the rounded aspect ratio.
  it('sizes itself only when asked', () => {
    const unsized = createBrandMark(document);
    expect(unsized.hasAttribute('height')).toBe(false);
    const sized = createBrandMark(document, { heightPx: 40 });
    expect(sized.getAttribute('height')).toBe('40');
    expect(sized.getAttribute('width')).toBe('39');
  });

  // Test 5: the wordmark embeds the mark and text node without leaking a literal 'K'.
  it('replaces the K of the product name with the mark', () => {
    const w = createProductWordmark(document, '-Doc', 'K-Doc');
    expect(w.className).toBe('kdoc-wordmark');
    expect(w.getAttribute('role')).toBe('img');
    expect(w.getAttribute('aria-label')).toBe('K-Doc');
    expect(w.querySelector('svg.kdoc-wordmark-mark')).not.toBeNull();
    expect(w.querySelector('.kdoc-wordmark-text')?.textContent).toBe('-Doc');
    expect(w.textContent).not.toContain('K');
  });

  // Test 6: brand stylesheet carries the Sansation font and wordmark selector; slogan is exact.
  it('styles the wordmark in Sansation', () => {
    expect(BRAND_STYLES).toContain("'Sansation'");
    expect(BRAND_STYLES).toContain('.kdoc-wordmark-mark');
    expect(BRAND_SLOGAN).toBe('Real Innovation. Fast.');
  });
});
