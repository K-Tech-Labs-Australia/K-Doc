/**
 * @file graph-layout.ts
 * @purpose Lays out which notes to draw where (FR-6.15), using a deterministic force simulation so the same graph always lands in the same places and never shuffles under the reader's cursor on redraw.
 * @inputs A VaultGraph of nodes and edges, consumed read-only by the layout pass.
 * @outputs One GraphPosition per node - its path plus an x/y inside the unit box [0, 1] - in the graph's own node order.
 * @functions
 *   - layoutGraph: Runs a force-directed relaxation over the nodes and returns one position each.
 *   - axis: Scales one coordinate from its raw spread onto the usable band for that axis.
 * @dataflow VaultGraph -> seeded circle positions -> ITERATIONS of repulsion/spring/centring displacements -> min/max normalisation onto [MARGIN, 1-MARGIN] per axis -> ordered GraphPosition array.
 * @controlflow Empty graph short-circuits to []; single node returns centre; otherwise seed on a fixed circle, iterate displacement accumulation with all writes applied at round end, then rescale each axis by its own spread and emit in original order.
 * @version 1
 * @date 2026-09-18
 */

import type { VaultGraph } from './vault-graph.js';

// Rounds of relaxation run before the positions are kept.
const ITERATIONS = 240;
// How hard two notes push apart, as a fraction of the box.
const REPULSION = 0.06;
// How hard a link pulls its two notes together.
const SPRING = 0.02;
// The length a link settles at, as a fraction of the box.
const IDEAL_LINK = 0.18;
// How hard everything drifts back towards the middle.
const CENTRING = 0.008;
// The closest two notes may be before the push between them is capped.
const MIN_SEPARATION = 0.0001;
// The empty band kept around the edge, as a fraction of the box.
const MARGIN = 0.06;
// The circle the notes start on, as a fraction of the box.
const SEED_RADIUS = 0.4;
// The centre of the box, which runs 0 to 1 on both axes.
const MIDDLE = 0.5;
// One turn around the seeding circle.
const FULL_TURN = 2 * Math.PI;
// The band left to draw in once a margin is kept at each edge of the box.
const USABLE = 1 - MARGIN - MARGIN;

/** Where one note sits, in the unit box: x and y each run 0 to 1. */
export interface GraphPosition {
  readonly path: string;
  readonly x: number;
  readonly y: number;
}

// One note while it is being placed: where it is, and where this round is pushing it.
interface Point {
  readonly path: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Works out where to draw each note (FR-6.15).
 *
 * @purpose Runs a deterministic force-directed relaxation - repulsion between every pair of notes, springs along links, and a gentle centring pull - then rescales the result into the usable box so the same graph always lays out identically and never shuffles under the reader's cursor on redraw.
 * @inputs graph - The VaultGraph whose nodes are positioned; its node order is preserved in the output.
 * @outputs readonly GraphPosition[] - One position per node, carrying each path plus an x/y inside [0, 1], emitted in the graph's own node order.
 * @dataflow Each node -> seeded circle coordinate -> ITERATIONS of accumulated displacements (repulsion + springs + centring) applied together at round end -> min/max rescale onto [MARGIN, 1-MARGIN] per axis -> ordered GraphPosition array.
 * @controlflow Empty graph returns []; single node returns the centre; otherwise seed on a fixed circle without randomness, run the relaxation with all writes deferred to after each full round for order-independence, then normalise and emit in original order.
 */
export function layoutGraph(graph: VaultGraph): readonly GraphPosition[] {
  // The number of notes there is to place.
  const count = graph.nodes.length;

  // An empty graph needs no guard of its own: it seeds no points and maps no nodes, so the answer is
  // already no positions at all.
  //
  // A lone note has no links or neighbours to arrange against, so it simply sits at the middle of the box rather than running any relaxation.
  if (count === 1) {
    const only = graph.nodes[0];

    // The length read as one implies a node exists, but the type admits undefined under index access, so guard before use.
    if (only === undefined) {
      return [];
    } else {
      // A single note is present: place it at the centre of the box and stop.
      return [{ path: only.path, x: MIDDLE, y: MIDDLE }];
    }
  } else {
    // Two or more notes exist: run the full relaxation below.
  }

  // Seed every note evenly on a circle so no two start in the same place - which a random seed cannot promise, and which is why there is no random seed here at all.
  const points: Point[] = [];
  const byPath = new Map<string, Point>();

  graph.nodes.forEach((node, index): void => {
    // The loop visits each node once in order, so index runs from 0 to count-1 and is safe as the seeding fraction's multiplier.
    const angle = (FULL_TURN * index) / count;

    // Place this note on the circle at its evenly spaced angle, starting with zero displacement for the first round.
    const point: Point = { path: node.path, x: MIDDLE + SEED_RADIUS * Math.cos(angle), y: MIDDLE + SEED_RADIUS * Math.sin(angle), dx: 0, dy: 0 };

    // Record both in visit order and by path so edges can resolve to the exact objects they join.
    points.push(point);
    byPath.set(node.path, point);
  });

  // Resolve every edge once to the two Points it joins, so the relaxation loop never looks a note up twice or touches an undefined end.
  const links: { readonly a: Point; readonly b: Point }[] = [];

  for (const edge of graph.edges) {
    const a = byPath.get(edge.from);
    const b = byPath.get(edge.to);

    // An edge naming a note the graph has not got pulls nothing, so skip it rather than feeding an undefined into the spring pass.
    if (a === undefined || b === undefined) {
      continue;
    } else {
      // Both ends are real notes: keep this resolved pair for the spring pass below.
      links.push({ a, b });
    }
  }

  // Run ITERATIONS rounds of relaxation over every pair of points and links.
  for (let round = 0; round < ITERATIONS; round++) {
    // Reset each note's displacement before recomputing it from the current positions this round.
    for (const point of points) {
      point.dx = 0;
      point.dy = 0;
    }

    // Repulsion: every note pushes against every other, worked out for the whole round before any is applied so visit order cannot change the answer.
    for (const point of points) {
      for (const other of points) {
        // A note does not push itself, so skip when comparing a point to itself.
        if (point === other) {
          continue;
        } else {
          // Distinct partner: accumulate its repulsive push on this point below.
        }

        const dx = point.x - other.x;
        const dy = point.y - other.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        // Two notes in the same place would divide by zero, so floor the distance at MIN_SEPARATION to keep a finite push between them.
        if (distance < MIN_SEPARATION) {
          distance = MIN_SEPARATION;
        } else {
          // The notes are apart enough: use the true distance for the inverse-distance push.
        }

        // Push this point away from its partner along the normalised direction, scaled by squared repulsion over distance.
        const push = (REPULSION * REPULSION) / distance;
        point.dx += push * (dx / distance);
        point.dy += push * (dy / distance);
      }
    }

    // Springs: each link pulls its two notes together by how far it is stretched past or compressed below IDEAL_LINK.
    for (const link of links) {
      const dx = link.b.x - link.a.x;
      const dy = link.b.y - link.a.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // A zero-length link has no line to pull along, so skip it rather than dividing by zero.
      if (distance === 0) {
        continue;
      } else {
        // The link has a definite direction: its stretch or compression relative to IDEAL_LINK drives the pull below.
      }

      const pull = SPRING * (distance - IDEAL_LINK);
      link.a.dx += pull * (dx / distance);
      link.a.dy += pull * (dy / distance);
      link.b.dx -= pull * (dx / distance);
      link.b.dy -= pull * (dy / distance);
    }

    // Centring: every note drifts gently back toward the middle so the whole cluster stays centred in the box instead of drifting to a corner.
    for (const point of points) {
      point.dx += CENTRING * (MIDDLE - point.x);
      point.dy += CENTRING * (MIDDLE - point.y);
    }

    // Apply the fully accumulated displacements only after every contribution is in, so note visit order cannot change the outcome.
    for (const point of points) {
      point.x += point.dx;
      point.y += point.dy;
    }
  }

  // Walk once to find the smallest and largest x and y actually used, so each axis can be rescaled by its own spread rather than assuming a square bounding box.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (point.x < minX) {
      minX = point.x;
    } else {
      // This x is not below the running minimum, so it cannot update minX.
    }

    if (point.x > maxX) {
      maxX = point.x;
    } else {
      // This x is not above the running maximum, so it cannot update maxX.
    }

    if (point.y < minY) {
      minY = point.y;
    } else {
      // This y is not below the running minimum, so it cannot update minY.
    }

    if (point.y > maxY) {
      maxY = point.y;
    } else {
      // This y is not above the running maximum, so it cannot update maxY.
    }
  }

  // One scale for both axes, taken from whichever spread is larger. Scaling each axis to fill the box on
  // its own would stretch the picture until the distances the relaxation worked out no longer meant
  // anything: a graph two notes apart would look the same as one they were joined across.
  const span = Math.max(maxX - minX, maxY - minY);

  // Emit in the graph's own order, so callers can pair positions back to nodes without re-sorting.
  return points.map((point): GraphPosition => ({
    path: point.path,
    x: axis(point.x, minX + (maxX - minX) * MIDDLE, span),
    y: axis(point.y, minY + (maxY - minY) * MIDDLE, span),
  }));
}

/**
 * Scales one coordinate from its raw spread onto the usable band for that axis.
 *
 * @purpose Maps one coordinate into [MARGIN, 1-MARGIN] about the middle of the box, using the same span for both axes so the shape the relaxation worked out survives being drawn.
 * @inputs value - The note's coordinate on this axis before scaling; centre - the middle of what this axis spans; span - the larger of the two axes' spreads, shared by both.
 * @outputs number - The scaled coordinate inside [MARGIN, 1-MARGIN].
 * @dataflow Raw value -> offset from the axis's centre -> divided by the shared span -> placed about the middle of the usable band.
 * @controlflow Zero span returns the centre via early return; otherwise map about the middle and return the scaled coordinate.
 */
function axis(value: number, centre: number, span: number): number {
  // Nothing is spread at all - every note in one place - so pin to the middle rather than dividing by zero.
  // No graph this is given can reach it: a lone note returns before the relaxation, and two or more are
  // seeded on a circle, so some spread always survives. A mutant that removed it therefore lived. It stays
  // because it is the one thing standing between a future change and a screen full of NaN.
  if (span === 0) {
    return MIDDLE;
  } else {
    // Placed about the middle of the band rather than stretched across it, because the span is shared:
    // the axis with the smaller spread is centred in what is left rather than blown up to fill it.
    return MARGIN + USABLE * (MIDDLE + (value - centre) / span);
  }
}
