/**
 * @file leader-line.ts
 * @purpose Word joins the selected text to its comment balloon with a thin line, because a margin pane breaks the one thing an inline annotation had for free — you could see what it was about. With cards in a column at the edge, a highlighted range and the card describing it are separated by the width of a pane, so this module draws the connector that tells which goes with which. The geometry is exported separately from the drawing: leaderPath is a pure function of three rectangles (testable without a layout engine), while createLeaderLayer only turns points into an SVG polyline.
 * @inputs anchor - Rect | null for the selected text's viewport rectangle; card - Rect | null for the comment balloon's viewport rectangle; container - Rect in which the layer sits, used to convert geometry to relative coordinates.
 * @outputs LeaderLayer factory and pure leaderPath returning three container-relative points or null when no line applies; LEADER_LINE_STYLES CSS string for the rendered elements.
 * @functions
 *   - midY: Returns a rectangle's vertical midpoint in viewport coordinates.
 *   - leaderPath: Pure function computing the three-point connector between anchor and card, or null on an edge case.
 *   - createLeaderLayer: Builds a detached SVG + polyline layer exposing render() and destroy().
 * @dataflow Rectangles (viewport) -> leaderPath arithmetic -> container-relative Point[] -> LeaderLayer.render converts points to "x,y" pairs -> SVG polyline attribute.
 * @controlflow Validate both rects present, anchor visible within container, card right of anchor; on success emit three points via midY and subtraction; createLeaderLayer constructs namespaced SVG nodes then closes over them in render/destroy closures.
 * @version 2
 * @date 2026-10-04
 */

/** How far short of the card the horizontal run stops before the line turns into it. The elbow is where the
 *  line stops describing the text and starts describing the card, and it is short because the diagonal is the
 *  part that carries the meaning. Pixels. */
const ELBOW = 12;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in viewport coordinates, the shape `getBoundingClientRect()` returns. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface LeaderLayer {
  readonly element: SVGSVGElement;
  /** Draws the line, or clears it when `points` is null. */
  render(points: readonly Point[] | null): void;
  destroy(): void;
}

/**
 * @purpose Returns a rectangle's vertical midpoint in viewport coordinates.
 * @inputs rect - A Rect whose top and bottom define its vertical extent.
 * @outputs number - The arithmetic mean of rect.top and rect.bottom, i.e. (rect.top + rect.bottom) / 2.
 * @dataflow rect.top, rect.bottom -> sum divided by two -> midpoint value.
 * @controlflow Sum the two edges and divide by two; no branching required for a vertical centerline.
 */
function midY(rect: Rect): number {
  // Average the top and bottom edges to locate the vertical centre of the rectangle.
  return (rect.top + rect.bottom) / 2;
}

/**
 * @purpose Computes the three-point connector joining an anchor's right edge to a card, or null when no line should be drawn.
 * @inputs anchor - Rect | null for the selected text in viewport coordinates; card - Rect | null for the comment balloon in viewport coordinates; container - Rect of the layer's own box, used as the origin for returned points.
 * @outputs readonly Point[] | null - Three container-relative points (container.left/container.top subtracted) forming an L-shaped connector, or null when either rect is missing, the anchor scrolled out of view, or the card does not sit to the right of the text. Returned coordinates are relative to `container` because the layer sits inside it.
 * @dataflow Rectangles -> branch checks on visibility and horizontal order -> midY values subtracted by container origin -> Point[] array (or null).
 * @controlflow Guard both rects present; guard anchor midpoint within container top/bottom; guard card.left past anchor.right; otherwise return three points: anchor right edge, elbow run at the same height, diagonal into the card.
 */
export function leaderPath(
  anchor: Rect | null,
  card: Rect | null,
  container: Rect,
): readonly Point[] | null {
  // Either rectangle is missing — there is nothing to join, so no line exists.
  if (anchor === null || card === null) {
    return null;
  }

  // The anchor's vertical midpoint lies outside the container's top/bottom: the highlight has scrolled out of view, and a line running to text nobody can see points at a claim it cannot support.
  if (midY(anchor) < container.top || midY(anchor) > container.bottom) {
    return null;
  }

  // The card is not to the right of the text — the panel is collapsed, or they overlap — so a line doubling back on itself would be worse than none.
  if (card.left <= anchor.right) {
    return null;
  }

  // All checks passed: emit exactly three points in container-relative coordinates by subtracting container's origin from each viewport value.
  //   1. the anchor's right edge at its vertical midpoint,
  //   2. a horizontal run out to the margin (card.left - ELBOW) still at that same height,
  //   3. one diagonal into the card at the card's own vertical midpoint.
  return [
    { x: anchor.right - container.left, y: midY(anchor) - container.top },
    { x: card.left - ELBOW - container.left, y: midY(anchor) - container.top },
    { x: card.left - container.left, y: midY(card) - container.top },
  ];
}

/**
 * @purpose Builds a detached SVG layer that renders the leader-line polyline and exposes render/destroy over it.
 * @inputs doc - Document in which to create the namespaced SVG elements.
 * @outputs LeaderLayer - Object whose element is the svg, whose render writes or clears the polyline points, and whose destroy detaches the svg from its parent.
 * @dataflow doc -> createElementNS(svg) + createElementNS(polyline) -> set class/aria-hidden attributes -> closed over in render() and destroy().
 * @controlflow Create namespaced SVG nodes (never via createElement); assign classes and aria-hidden; return object with a render branch on null/short points versus populated points, and a destroy branch on whether the svg has a parent.
 */
export function createLeaderLayer(doc: Document): LeaderLayer {
  // Use createElementNS so these are real SVG elements: an element made with doc.createElement('polyline') would be an unknown HTML element that renders nothing, which is exactly the failure this layer exists to avoid.
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const polyline = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');

  // className on an SVG element is an SVGAnimatedString: assigning a string to it silently does nothing, so the class must be set via setAttribute instead.
  svg.setAttribute('class', 'kdoc-leader-layer');
  polyline.setAttribute('class', 'kdoc-leader-line');

  // The line only repeats a relationship the card already states in text; announcing it to assistive technology would add noise, so mark the layer hidden from screen readers.
  svg.setAttribute('aria-hidden', 'true');

  // The polyline has to be a child of the svg to render at all. It was built above and never attached,
  // which is a failure with no symptom other than a line that is simply never there.
  svg.appendChild(polyline);

  return {
    element: svg,
    render(points: readonly Point[] | null): void {
      if (points === null || points.length < 2) {
        // No usable geometry — clear the polyline and hide the whole layer so nothing is drawn on screen.
        polyline.setAttribute('points', '');
        svg.style.display = 'none';
      } else {
        // Show the layer and write each point as a rounded "x,y" pair joined by spaces; rounding avoids sub-pixel coordinates that would make the line shimmer as the pane scrolls.
        polyline.setAttribute(
          'points',
          points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '),
        );
        svg.style.display = '';
      }
    },
    destroy(): void {
      if (svg.parentNode !== null) {
        // The layer is attached to the DOM: detach it so nothing remains.
        svg.parentNode.removeChild(svg);
      } else {
        // The layer was never inserted into a parent, so there is nothing to remove.
      }
    },
  };
}

/**
 * @purpose CSS string for the leader-line layer and line elements, with rationale embedded as comments alongside each rule.
 * @inputs none - Pure constant consumed by whoever injects it into a <style> element or stylesheet.
 * @outputs string - Two rules: .kdoc-leader-layer positions an absolute, non-interactive overlay above the sidebars; .kdoc-leader-line styles the dashed connector line itself.
 * @dataflow none -> literal template string -> exported constant for injection elsewhere.
 * @controlflow No branching — a static stylesheet fragment returned as-is.
 */
export const LEADER_LINE_STYLES: string = `
/* z-index 11 sits above the sidebars' 10 because the line has to reach a card inside one of them.
   Sitting on top is harmless only because the layer is non-interactive: pointer-events: none means
   every click meant for the card underneath still lands on the card. */

.kdoc-leader-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 11;
  overflow: visible;
}

/* Dashed and semi-transparent because this is a pointer, not content. A solid line drawn across the
   page would read as a rule -- a thing the document contains rather than a thing describing it. */

.kdoc-leader-line {
  fill: none;
  stroke: var(--kdoc-color-accent, #0969da);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
  opacity: 0.75;
}
`;
