/**
 * @file graph-layout.spec.ts
 * @purpose Verifies layoutGraph (FR-6.15): determinism, full coverage of nodes, in-box placement, separation of linked notes, and graceful handling of dangling edges.
 * @inputs A VaultGraph built by the two module-scope helpers; consumed read-only by layoutGraph under test.
 * @outputs GraphPosition[] assertions on path set, x/y bounds, determinism, pairwise distances, and output length.
 * @functions
 *   - node: Builds a single GraphNode-shaped record for building graphs in tests.
 *   - graph: Builds a VaultGraph from note paths and edge pairs for feeding layoutGraph.
 *   - distanceBetween: Local helper returning the Euclidean distance between two positioned notes, or POSITIVE_INFINITY when either is missing so an assertion fails loudly instead of throwing.
 * @dataflow Test intent → builder helpers produce a VaultGraph → layoutGraph produces positions → assertions read position.path/x/y and compare distances.
 * @controlflow For each scenario build the graph, run layoutGraph once, then assert on length/paths/bounds/determinism/distances; dangling-edge case asserts no throw plus correct node count.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src/vault/graph-layout.js';
import type { VaultGraph } from '../src/vault/vault-graph.js';

// Builds one note-shaped record: relative and title mirror the path so a bare string fully describes a node.
function node(path: string, degree: number): { path: string; relative: string; title: string; degree: number } {
  return { path, relative: path, title: path, degree };
}

// Builds a VaultGraph from note paths (each with zero degree) and directed edge pairs each of weight one.
function graph(paths: readonly string[], edges: readonly (readonly [string, string])[]): VaultGraph {
  return { nodes: paths.map((path) => node(path, 0)), edges: edges.map(([from, to]) => ({ from, to, count: 1 })) };
}

describe('layoutGraph', () => {
  // An empty graph must yield no positions at all rather than a degenerate single point.
  it('lays out an empty graph as nothing', () => {
    expect(layoutGraph(graph([], []))).toHaveLength(0);
  });

  // A lone note has no links to arrange against, so it sits dead centre of the box.
  it('sits one note in the middle of the box', () => {
    const positions = layoutGraph(graph(['note'], []));
    expect(positions?.[0]?.x).toBe(0.5);
    expect(positions?.[0]?.y).toBe(0.5);
  });

  // Every note receives exactly one position, and the paths come back in the graph's own node order.
  it('gives every note a position in the graph\'s own order', () => {
    const positions = layoutGraph(graph(['a', 'b', 'c'], []));
    expect(positions?.map((position) => position.path)).toEqual(['a', 'b', 'c']);
  });

  // A connected ring keeps every coordinate inside the unit box on both axes.
  it('keeps every position of a five-note ring inside the box', () => {
    const positions = layoutGraph(graph(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'a']]));
    for (const position of positions) {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(1);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(1);
    }
  });

  // The simulation is deterministic, so redrawing the same graph must not move any note.
  it('lays out the same graph the same way every time', () => {
    const g = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]);
    expect(layoutGraph(g)).toEqual(layoutGraph(g));
  });

  // Two joined notes must never land on top of each other, so their full positions differ.
  it('does not put two joined notes in the same place', () => {
    const positions = layoutGraph(graph(['a', 'b'], [['a', 'b']]));
    expect(positions?.[0]).not.toEqual(positions?.[1]);
  });

  // A link pulls its pair closer than an unlinked pair, so linked notes end up nearer.
  it('keeps linked notes nearer than unlinked ones', () => {
    const positions = layoutGraph(graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]));

    // Distance between two positioned notes, or POSITIVE_INFINITY when either path is missing so the assertion fails loudly instead of throwing.
    const distanceBetween = (from: string, to: string): number => {
      const a = positions.find((position) => position.path === from);
      const b = positions.find((position) => position.path === to);

      // Either note is absent from the layout: return positive infinity so the less-than assertion fails loudly rather than throwing.
      if (a === undefined || b === undefined) {
        return Number.POSITIVE_INFINITY;
      } else {
        // Both notes are present: compute their Euclidean distance across x and y.
        const dx = a.x - b.x;
        const dy = a.y - b.y;

        return Math.sqrt(dx * dx + dy * dy);
      }
    };

    expect(distanceBetween('a', 'b')).toBeLessThan(distanceBetween('a', 'c'));
  });

  // An edge naming a note the graph lacks is ignored, so only real notes are laid out and nothing throws.
  it('ignores an edge that names a note the graph has not got', () => {
    const positions = layoutGraph(graph(['a', 'b'], [['a', 'ghost']]));
    expect(positions?.length).toBe(2);
  });

  // Proves the repulsion force separates two notes even when nothing links them.
  it('pushes two notes apart even when nothing joins them', () => {
    const positions = layoutGraph(graph(['a', 'b'], []));
    expect(typeof positions[0]?.x).toBe('number');
    expect(typeof positions[1]?.x).toBe('number');
    expect(positions[0]?.x).not.toBe(positions[1]?.x);
  });

  // Proves a link pulls its two notes together even when the seeding put them at opposite sides, which a
  // layout that never applied its own forces could not manage.
  it('pulls the notes a link joins together, wherever they started', () => {
    // Seeded a fifth of a turn apart each: a, c and d are joined in a triangle whose sides span the
    // circle, while b sits next door to a and is joined to nothing.
    const positions = layoutGraph(graph(['a', 'b', 'c', 'd', 'e'], [['a', 'c'], ['a', 'd'], ['c', 'd']]));

    const distanceBetween = (fromPath: string, toPath: string): number => {
      const fromPosition = positions.find((position) => position.path === fromPath);
      const toPosition = positions.find((position) => position.path === toPath);

      // Either note is missing: answer with infinity so the assertion fails rather than throwing.
      if (fromPosition === undefined || toPosition === undefined) {
        return Number.POSITIVE_INFINITY;
      } else {
        const deltaX = fromPosition.x - toPosition.x;
        const deltaY = fromPosition.y - toPosition.y;

        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      }
    };

    expect(distanceBetween('a', 'c')).toBeLessThan(distanceBetween('a', 'b'));
  });

  // Proves the axis with the smaller spread is centred rather than stretched to fill the box: two notes
  // on one horizontal line stay on it, at the middle, instead of being blown apart vertically.
  it('centres the axis the notes do not spread along', () => {
    const positions = layoutGraph(graph(['a', 'b'], [['a', 'b']]));

    expect(positions[0]?.y ?? 0).toBeCloseTo(0.5, 10);
    expect(positions[1]?.y ?? 0).toBeCloseTo(0.5, 10);
  });

  // Proves the notes occupy both axes rather than piling against one edge of the box.
  it('spreads the notes across the box on both axes', () => {
    const positions = layoutGraph(graph(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'a']]));
    const xs = positions.map((position) => position.x);
    const ys = positions.map((position) => position.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });

  // Even on a single chain of notes, repulsion spreads them apart so all three land in distinct spots.
  it('spreads every note on one line into distinct positions', () => {
    const positions = layoutGraph(graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]));
    const spotSet = new Set<string>(positions.map((position) => `${position.x},${position.y}`));

    // Each note must occupy a unique x,y pair, so the set of distinct spots has one entry per node.
    expect(spotSet.size).toBe(3);
  });
});
