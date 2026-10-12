/**
 * @file graph-drawing.ts
 * @purpose Turns a vault graph and its layout into the shapes that draw it (FR-6.15) - circles for notes, lines for links - so the dialog holds no drawing arithmetic and this module can be tested without a DOM.
 * @inputs A VaultGraph of nodes and edges, one GraphPosition per node from the layout pass, and the path of the note currently on screen (or null).
 * @outputs GraphDrawing - The edge lines and note circles with labels to render, computed purely from data so nothing here touches the DOM.
 * @functions
 *   - graphDrawing: Turns a graph and its layout into the shapes that draw it.
 *   - shortLabel: Cuts a long note name down to what fits under a circle.
 * @dataflow VaultGraph + positions array -> path-keyed Map lookup; edge sweep reads both ends for scaled line endpoints and weighted stroke width, node sweep reads position to scale centre, derive radius from degree, cut label, set baseline and current flag -> GraphDrawing (edges then nodes); title -> character cut with ellipsis -> label string.
 * @controlflow Build the lookup once; skip any edge or node whose end is missing so no half-line or orphan circle is produced; otherwise compute shapes using clamps between named bounds and return edges first, notes second.
 * @version 1
 * @date 2026-09-18
 */

import type { GraphPosition } from './graph-layout.js';
import type { VaultGraph } from './vault-graph.js';

// The coordinate box the shapes are placed in, which scales to any width.
export const GRAPH_VIEW_SIZE = 1000;
// The size of a note nothing links to.
const MIN_RADIUS = 14;
// How much bigger a note gets for each note it is joined to.
const RADIUS_PER_LINK = 6;
// The size a note stops growing at.
const MAX_RADIUS = 46;
// How far below a note its name sits.
const LABEL_GAP = 26;
// How many characters of a name are drawn before it is cut.
const LABEL_LIMIT = 24;
// The thinnest a link is drawn.
const MIN_STROKE = 3;
// How much thicker a link gets for each extra time it is named.
const STROKE_PER_LINK = 2;
// The thickest a link is drawn.
const MAX_STROKE = 11;

/** One link, as a line. */
export interface DrawnEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
}

/** One note, as a circle with its name under it. */
export interface DrawnNode {
  readonly path: string;
  readonly title: string;
  /** What the label reads: the title, cut short when it is long. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Where the label's baseline sits. */
  readonly labelY: number;
  /** True for the note on screen, which is drawn differently. */
  readonly current: boolean;
}

export interface GraphDrawing {
  readonly edges: readonly DrawnEdge[];
  readonly nodes: readonly DrawnNode[];
}

/**
 * Turns a graph and its layout into the shapes that draw it (FR-6.15).
 *
 * @purpose Converts a VaultGraph plus one position per node into the edge lines and note circles used to render the graph, so the dialog holds no drawing arithmetic.
 * @inputs graph - The VaultGraph of nodes and edges to draw. positions - One GraphPosition per node from the layout pass, in any order. currentPath - The path of the note on screen, or null when none is highlighted.
 * @outputs GraphDrawing - Edges drawn first (so notes cover them) then nodes, each carrying scaled coordinates inside the view box and clamped sizes.
 * @dataflow positions array -> Map keyed on path -> edge sweep reads both ends for scaled line endpoints and weighted stroke width; node sweep reads position to scale centre, derive radius from degree, cut label, set baseline and current flag -> GraphDrawing (edges then nodes).
 * @controlflow Build the lookup once; skip any edge or node whose end is missing so no half-line or orphan circle is produced; otherwise compute shapes with clamps between named bounds and return edges first, notes second.
 */
export function graphDrawing(
  graph: VaultGraph,
  positions: readonly GraphPosition[],
  currentPath: string | null,
): GraphDrawing {
  // Build a path-keyed lookup so each edge can find both ends without scanning the whole array twice per link.
  const placed = new Map<string, GraphPosition>();

  for (const position of positions) {
    // Visit each layout entry once and register it under its own path for O(1) lookups below.
    placed.set(position.path, position);
  }

  // Edges are drawn first so the notes sit on top of them; collect into a mutable array before returning as readonly.
  const edges: DrawnEdge[] = [];

  for (const edge of graph.edges) {
    // Resolve both ends through the lookup; under noUncheckedIndexedAccess each read may be undefined when that note has no position.
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);

    if (from === undefined || to === undefined) {
      // Either end is missing: a line needs both endpoints, so skip this edge rather than drawing a half-line into empty space.
      continue;
    } else {
      // Both ends are present: build the scaled line below.
    }

    // Scale each unit-box coordinate up to the view box and weight the stroke by how many links run along it, clamped between MIN_STROKE and MAX_STROKE.
    edges.push({
      x1: from.x * GRAPH_VIEW_SIZE,
      y1: from.y * GRAPH_VIEW_SIZE,
      x2: to.x * GRAPH_VIEW_SIZE,
      y2: to.y * GRAPH_VIEW_SIZE,
      width: Math.min(MAX_STROKE, MIN_STROKE + STROKE_PER_LINK * (edge.count - 1)),
    });
  }

  // Notes are drawn after edges so they cover the lines; collect here before returning as readonly.
  const nodes: DrawnNode[] = [];

  for (const node of graph.nodes) {
    // Look up this note's position; a node with no layout entry is skipped rather than placed at the origin.
    const position = placed.get(node.path);

    if (position === undefined) {
      // No position exists for this note: skip it so an orphan circle never appears on screen.
      continue;
    } else {
      // Position present: build the note below.
    }

    // Radius grows with degree but is pinned between MIN_RADIUS and MAX_RADIUS, matching how vault-graph computes degree above.
    const radius = Math.min(MAX_RADIUS, MIN_RADIUS + RADIUS_PER_LINK * node.degree);
    // Scale the unit-box centre up to the view box on each axis.
    const x = position.x * GRAPH_VIEW_SIZE;
    const y = position.y * GRAPH_VIEW_SIZE;

    nodes.push({
      path: node.path,
      title: node.title,
      label: shortLabel(node.title),
      x,
      y,
      radius,
      // The baseline sits one gap below the note's lower edge.
      labelY: y + radius + LABEL_GAP,
      current: node.path === currentPath,
    });
  }

  return { edges, nodes };
}

/**
 * Cuts a long note name down to what fits under a circle (FR-6.15).
 *
 * @purpose Trims a note title so it never overflows the space drawn beneath its circle.
 * @inputs title - The full note name as stored on the node.
 * @outputs string - The title unchanged when short, otherwise the first LABEL_LIMIT characters followed by an ellipsis escape.
 * @dataflow Title length compared to LABEL_LIMIT -> returned whole or sliced with a trailing ellipsis character appended.
 * @controlflow Return early when within the limit; otherwise slice off exactly LABEL_LIMIT characters and append one ellipsis so the result never exceeds that many glyphs.
 */
export function shortLabel(title: string): string {
  // A name at or under the limit needs no trimming, so return it untouched to preserve exact wording for short notes.
  if (title.length <= LABEL_LIMIT) {
    return title;
  } else {
    // The name is too long: cut by characters and mark the truncation with an ellipsis below.
  }

  // Cut by character count, not words - a note name is often one long word, so a word-wise cut would leave nothing to read under the circle.
  return title.slice(0, LABEL_LIMIT) + '\u2026';
}
