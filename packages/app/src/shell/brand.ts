/**
 * @file brand.ts
 * @purpose Builds the K-Tech sliced-K mark and the K-Doc product wordmark (the mark replaces the letter K, then '-Doc' in Sansation Bold) as DOM, plus their stylesheet. The mark's geometry is the brand's fixed polygons copied verbatim from the K-Tech Branding repo (Brand/assets/ktech-mark-*.svg) and must never be redrawn.
 * @inputs A Document and optional size/label.
 * @outputs SVG and span elements; BRAND_STYLES CSS; brand constants.
 * @functions
 *   - createBrandMark: Builds a self-contained SVG of the K-Tech sliced-K mark from its fixed brand polygons.
 *   - createProductWordmark: Assembles the K-Doc wordmark by prefixing the decorative mark to a text suffix.
 * @dataflow KTECH_MARK_POLYGONS -> SVG polygons filled and stroked with currentColor -> caller's DOM; createBrandMark output prepended to a labelled text span in createProductWordmark.
 * @controlflow No state; each call builds fresh elements from the frozen brand constants.
 * @version 1
 * @date 2026-10-06
 */

/** XML/SVG namespace URI used for every SVG element created below. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** The brand's fixed mark geometry on a 100-unit grid (Brand/assets/ktech-mark-*.svg). Never edit. */
export const KTECH_MARK_POLYGONS: readonly string[] = Object.freeze([
  '0,0 13,0 13,39 0,26',
  '24,50 74,0 92,0 42,50 92,100 74,100',
  '0,50 13,63 13,76 0,63'
]);

/** viewBox that leaves room for the 7-unit round-join stroke. */
export const KTECH_MARK_VIEWBOX = '-4 -4 106 108';

/** Stroke width in grid units; with round joins it softens the corners exactly as the brand files do. */
export const KTECH_MARK_STROKE_WIDTH = 7;

/** Mark width as a fraction of its height (98 x 100 in the brand files). */
export const KTECH_MARK_ASPECT = 0.98;

export const BRAND_SLOGAN = 'Real Innovation. Fast.';

export const BRAND_FONT_STACK = "'Sansation', 'Roboto Flex Variable', 'Segoe UI', Helvetica, Arial, sans-serif";

/** Optional sizing and accessibility controls for {@link createBrandMark}. */
export interface BrandMarkOptions {
  /** Target mark height in pixels; when omitted the size is left to CSS. */
  readonly heightPx?: number;
  /** Accessible name applied as aria-label; when omitted the mark is hidden from assistive tech. */
  readonly label?: string;
}

/**
 * Builds a self-contained SVG of the K-Tech sliced-K mark from its fixed brand polygons.
 * @purpose Renders the frozen {@link KTECH_MARK_POLYGONS} as stroked/filled <polygon> children inside an <svg>, sized and labelled per options.
 * @inputs doc - Document used to create all elements; options - optional heightPx (target height in px) and label (accessible name).
 * @outputs SVGSVGElement - The rendered mark with a <g> of three polygons filled and stroked with currentColor.
 * @dataflow KTECH_MARK_POLYGONS -> SVG polygon points filled/stroked with currentColor -> caller's DOM.
 * @controlflow Build svg root + viewBox; conditionally size from heightPx (else leave to CSS); conditionally set accessible name or hide; build <g> with fill/stroke attributes; append one polygon per brand path; return svg.
 */
export function createBrandMark(doc: Document, options: BrandMarkOptions = {}): SVGSVGElement {
  // Root SVG element carrying the fixed viewBox and base mark class.
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', KTECH_MARK_VIEWBOX);
  svg.classList.add('kdoc-brand-mark');

  // When a pixel height is supplied, derive the width from the brand aspect ratio (98 x 100).
  if (options.heightPx !== undefined) {
    // Height pins the mark; width follows KTECH_MARK_ASPECT so proportions match the brand files.
    svg.setAttribute('height', String(options.heightPx));
    svg.setAttribute('width', String(Math.round(options.heightPx * KTECH_MARK_ASPECT)));
  } else {
    // No size requested: leave dimensions to CSS (e.g. .kdoc-wordmark-mark) so the caller controls scale.
  }

  // Expose an accessible name when provided; otherwise hide the purely decorative mark from assistive tech.
  if (options.label !== undefined) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', options.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }

  // Group that applies the brand's currentColor fill/stroke and round joins to every polygon.
  const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('fill', 'currentColor');
  g.setAttribute('stroke', 'currentColor');
  g.setAttribute('stroke-width', String(KTECH_MARK_STROKE_WIDTH));
  g.setAttribute('stroke-linejoin', 'round');

  // Emit one <polygon> per frozen brand path, in order.
  for (const points of KTECH_MARK_POLYGONS) {
    const polygon = doc.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement;
    polygon.setAttribute('points', points);
    g.appendChild(polygon);
  }

  svg.appendChild(g);
  return svg;
}

/**
 * Assembles the K-Doc product wordmark by prefixing the decorative sliced-K mark to a text suffix.
 * @purpose Combines {@link createBrandMark} with a labelled text span so the mark replaces the letter 'K' and it never appears twice (brand rule).
 * @inputs doc - Document used to create all elements; suffix - The product name with the leading 'K' omitted (e.g. '-Doc'); label - Accessible full name (e.g. 'K-Doc').
 * @outputs HTMLSpanElement - Inline span containing the mark and text spans, classed kdoc-wordmark.
 * @dataflow createBrandMark SVG -> appended before a labelled text span whose textContent is suffix; both wrapped in a role=img span.
 * @controlflow Create span.kdoc-wordmark with role/aria-label; build decorative brand mark (no size) and add kdoc-wordmark-mark class; append to span; create text span, hide from AT, set textContent = suffix; append; return span.
 */
export function createProductWordmark(doc: Document, suffix: string, label: string): HTMLSpanElement {
  // Outer labelled container for the whole wordlock (e.g. 'K-Doc').
  const span = doc.createElement('span');
  span.className = 'kdoc-wordmark';
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', label);

  // Decorative mark, no explicit size; .kdoc-wordmark-mark sizes it to cap height via CSS.
  const mark = createBrandMark(doc);
  mark.classList.add('kdoc-wordmark-mark');
  span.appendChild(mark);

  // Text portion holds the suffix (e.g. '-Doc'), hidden from assistive tech since the outer aria-label covers it.
  const textSpan = doc.createElement('span');
  textSpan.className = 'kdoc-wordmark-text';
  textSpan.setAttribute('aria-hidden', 'true');
  textSpan.textContent = suffix;
  span.appendChild(textSpan);

  return span;
}

/**
 * Stylesheet for the K-Tech mark and K-Doc wordlock. Inject once (e.g. into document.head).
 */
export const BRAND_STYLES: string = `
.kdoc-brand-mark { display: inline-block; flex-shrink: 0; overflow: visible; }
.kdoc-wordmark { display: inline-flex; align-items: baseline; font-family: ${BRAND_FONT_STACK}; font-weight: 700; letter-spacing: 0.01em; line-height: 1; white-space: nowrap; color: inherit; }
/* The mark sits at cap height (0.72em of Sansation Bold) on the baseline, as in Brand/components/brand/LogoLockup.jsx. */
.kdoc-wordmark-mark { height: 0.72em; width: calc(0.72em * ${KTECH_MARK_ASPECT}); align-self: baseline; }
.kdoc-brand-slogan { font-family: ${BRAND_FONT_STACK}; font-weight: 400; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; white-space: nowrap; color: var(--kdoc-chrome-text-muted); }
`;
