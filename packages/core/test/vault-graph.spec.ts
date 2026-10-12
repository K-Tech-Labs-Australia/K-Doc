/**
 * @file vault-graph.spec.ts
 * @purpose Covers the graph of which notes link to which (FR-6.15): building it from the vault index, cutting it down to one note's neighbourhood, and turning it into the shapes that draw it.
 * @inputs Synthetic NoteIndexEntry fixtures built here, plus the layout the real layoutGraph produces for them.
 * @outputs Assertions over nodes, edges, degrees, neighbourhoods, drawn circles and lines, and cut labels.
 * @functions
 *   - link: Builds one NoteLink with a unique offset.
 *   - note: Builds one NoteIndexEntry from a relative path, a title and the targets it names.
 * @dataflow NoteIndexEntry[] -> vaultGraph -> graphNeighbourhood / graphNode / layoutGraph -> graphDrawing -> assertions.
 * @controlflow Every test is pure and in memory; nothing touches a DOM or a disk.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { graphNeighbourhood, graphNode, vaultGraph } from '../src/vault/vault-graph.js';
import { graphDrawing, shortLabel, GRAPH_VIEW_SIZE } from '../src/vault/graph-drawing.js';
import { layoutGraph } from '../src/vault/graph-layout.js';
import type { NoteIndexEntry, NoteLink } from '../src/vault/note-index.js';

/** Module-level offset counter so every link built here carries a unique `offset`, keeping two links distinct. */
let linkOffset = 0;

/** Builds one NoteLink with an incrementing offset so no two links are identical. @purpose Factory for test NoteLink records. @inputs target - The raw link target string to record. @outputs NoteLink - A wiki-kind link carrying the target, empty context line, and a unique offset. @dataflow Target + live counter → incremented offset → NoteLink record. @controlflow Snapshot then bump the shared counter so each call yields a distinct offset. */
function link(target: string): NoteLink {
  const offset = linkOffset++;

  // A wiki link with no surrounding source line in these synthetic notes, carrying an incrementing offset for uniqueness.
  return { kind: 'wiki', target, context: '', offset };
}

/** Builds one NoteIndexEntry fixture row from a relative path, title and list of targets. @purpose Factory for test NoteIndexEntry records mirroring the real index shape. @inputs relative - The vault-relative file name used to build the absolute path. @inputs title - The note display title. @inputs targets - The link target strings this note points at. @outputs NoteIndexEntry - A fully-shaped entry with empty headings, links from `targets`, empty tags and an empty front-matter record. @dataflow Targets → mapped links; relative → C:/vault/<relative> path; assembled into the full entry shape. @controlflow Map each target to a link then return the complete NoteIndexEntry object literal. */
function note(relative: string, title: string, targets: readonly string[]): NoteIndexEntry {
  return {
    path: `C:/vault/${relative}`,
    relative,
    title,
    headings: [],
    links: targets.map(link),
    tags: [],
    frontMatter: {},
  };
}

/** A chain with a fork shared by most tests: Alpha→Beta,Gamma; Beta→Gamma; Gamma and Delta are leaves. */
const NOTES: readonly NoteIndexEntry[] = [
  note('a.md', 'Alpha', ['b', 'c']),
  note('b.md', 'Beta', ['c']),
  note('c.md', 'Gamma', []),
  note('d.md', 'Delta', []),
];

describe('vaultGraph', () => {
  it('every note becomes a node, in the order given', () => {
    const graph = vaultGraph(NOTES);

    // Four input notes yield four nodes carrying their paths in index order.
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes[0]?.path.endsWith('a.md')).toBe(true);
    expect(graph.nodes[1]?.path.endsWith('b.md')).toBe(true);
    expect(graph.nodes[2]?.path.endsWith('c.md')).toBe(true);
    expect(graph.nodes[3]?.path.endsWith('d.md')).toBe(true);
  });

  it('a link becomes an edge', () => {
    const graph = vaultGraph(NOTES);

    // Three links resolve to three edges; the first is Alpha→Beta.
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]?.from.endsWith('a.md')).toBe(true);
    expect(graph.edges[0]?.to.endsWith('b.md')).toBe(true);
  });

  it('a note nothing links to is still in the graph, with degree 0', () => {
    const graph = vaultGraph(NOTES);

    // Delta appears as a node even though no link touches it.
    expect(graphNode(graph, 'C:/vault/d.md')?.degree).toBe(0);
  });

  it('degree counts neighbours both ways: Alpha 2, Beta 2, Gamma 2', () => {
    const graph = vaultGraph(NOTES);

    // Each node's degree is the count of distinct neighbours either direction.
    expect(graphNode(graph, 'C:/vault/a.md')?.degree).toBe(2);
    expect(graphNode(graph, 'C:/vault/b.md')?.degree).toBe(2);
    expect(graphNode(graph, 'C:/vault/c.md')?.degree).toBe(2);
  });

  it('a link naming nothing is left out while its own node stays', () => {
    const graph = vaultGraph([note('a.md', 'Alpha', ['nowhere'])]);

    // The broken link adds no edge, but the source note remains as a degree-0 node.
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graphNode(graph, 'C:/vault/a.md')?.degree).toBe(0);
  });

  it('a note linking to itself adds no edge', () => {
    const graph = vaultGraph([note('a.md', 'Alpha', ['a'])]);

    // A self-link is not a relationship between notes, so there are zero edges.
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graphNode(graph, 'C:/vault/a.md')?.degree).toBe(0);
  });

  it('the same link twice is one edge of weight two', () => {
    const graph = vaultGraph([note('a.md', 'A', ['b', 'b']), note('b.md', 'B', [])]);

    // Two identical links aggregate into a single weighted edge rather than duplicating.
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.count).toBe(2);
  });

  it('two notes linking to each other are two edges, each of degree 1', () => {
    const graph = vaultGraph([note('a.md', 'A', ['b']), note('b.md', 'B', ['a'])]);

    // Mutual links give two directed edges but one neighbour per node.
    expect(graph.edges).toHaveLength(2);
    expect(graphNode(graph, 'C:/vault/a.md')?.degree).toBe(1);
    expect(graphNode(graph, 'C:/vault/b.md')?.degree).toBe(1);
  });

  // Proves a bare link resolves to the first index match, not the last note of that name.
  it('a link takes the first note it could name, not the last', () => {
    const graph = vaultGraph([note('a.md', 'A', ['b']), note('one/b.md', 'First', []), note('two/b.md', 'Second', [])]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.to.endsWith('one/b.md')).toBe(true);
  });

  it('an empty vault gives an empty graph', () => {
    const graph = vaultGraph([]);

    // No input notes produce no nodes and no edges.
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

describe('graphNeighbourhood', () => {
  it('depth 1 around Beta holds Alpha, Beta and Gamma but not Delta, with every edge inside', () => {
    const graph = vaultGraph(NOTES);
    const nb = graphNeighbourhood(graph, 'C:/vault/b.md', 1);

    // The neighbourhood keeps the three connected notes in their original order.
    expect(nb.nodes).toHaveLength(3);
    for (const node of nb.nodes) {
      expect(['a.md', 'b.md', 'c.md'].some((suffix) => node.path.endsWith(suffix))).toBe(true);
    }

    // Every returned edge has both ends among the kept notes, so no half-edge escapes.
    const paths = new Set(nb.nodes.map((node) => node.path));
    for (const edge of nb.edges) {
      expect(paths.has(edge.from)).toBe(true);
      expect(paths.has(edge.to)).toBe(true);
    }
  });

  it('depth 0 is the note alone', () => {
    const graph = vaultGraph(NOTES);
    const nb = graphNeighbourhood(graph, 'C:/vault/b.md', 0);

    // A zero-depth query returns only the seed node and no edges.
    expect(nb.nodes).toHaveLength(1);
    expect(nb.edges).toHaveLength(0);
  });

  it('depth 2 around Beta reaches no further because Delta is joined to nothing', () => {
    const graph = vaultGraph(NOTES);
    const nb = graphNeighbourhood(graph, 'C:/vault/b.md', 2);

    // The isolated Delta never joins the walk, so three nodes remain even at depth two.
    expect(nb.nodes).toHaveLength(3);
  });

  it('a path the graph has not got gives an empty graph, not the whole one', () => {
    const graph = vaultGraph(NOTES);
    const nb = graphNeighbourhood(graph, 'C:/vault/nope.md', 2);

    // A missing seed answers with emptiness rather than flooding every note.
    expect(nb.nodes).toHaveLength(0);
    expect(nb.edges).toHaveLength(0);
  });

  it('the order is the graph\'s own: nodes come back as a, b, c', () => {
    const graph = vaultGraph(NOTES);
    const nb = graphNeighbourhood(graph, 'C:/vault/b.md', 1);

    // The subgraph preserves vaultGraph's node ordering rather than BFS discovery order.
    expect(nb.nodes.map((node) => node.path)).toEqual([
      'C:/vault/a.md',
      'C:/vault/b.md',
      'C:/vault/c.md',
    ]);
  });
});

describe('graphNode', () => {
  it('finds a note by its path and gives undefined for one the graph has not got', () => {
    const graph = vaultGraph(NOTES);

    // A known path resolves to that node's title.
    expect(graphNode(graph, 'C:/vault/a.md')?.title).toBe('Alpha');
    // An unknown path yields no node at all.
    expect(graphNode(graph, 'C:/vault/zzz.md')).toBeUndefined();
  });
});

describe('graphDrawing', () => {
  it('every note becomes a circle and every link a line', () => {
    const graph = vaultGraph(NOTES);
    const positions = layoutGraph(graph);
    const drawing = graphDrawing(graph, positions, null);

    // Four nodes draw four circles; three edges draw three lines.
    expect(drawing.nodes).toHaveLength(4);
    expect(drawing.edges).toHaveLength(3);
  });

  it('the coordinates are scaled into the view box', () => {
    const graph = vaultGraph(NOTES);
    const positions = layoutGraph(graph);
    const drawing = graphDrawing(graph, positions, null);

    // Scaled centres stay within [0, GRAPH_VIEW_SIZE] on both axes.
    for (const node of drawing.nodes) {
      expect(node.x >= 0 && node.x <= GRAPH_VIEW_SIZE).toBe(true);
      expect(node.y >= 0 && node.y <= GRAPH_VIEW_SIZE).toBe(true);
    }
  });

  it('a note joined to more notes is drawn bigger', () => {
    const graph = vaultGraph(NOTES);
    const positions = layoutGraph(graph);
    const drawing = graphDrawing(graph, positions, null);

    // Alpha (degree 2) grows past Delta (degree 0).
    const alpha = drawing.nodes.find((node) => node.path === 'C:/vault/a.md');
    const delta = drawing.nodes.find((node) => node.path === 'C:/vault/d.md');
    expect(alpha?.radius ?? 0).toBeGreaterThan(delta?.radius ?? 0);
  });

  it('the note on screen is marked', () => {
    const graph = vaultGraph(NOTES);
    const positions = layoutGraph(graph);

    // Highlighting Alpha flags exactly one node; null flags none.
    const withCurrent = graphDrawing(graph, positions, 'C:/vault/a.md');
    expect(withCurrent.nodes.filter((node) => node.current)).toHaveLength(1);

    const none = graphDrawing(graph, positions, null);
    expect(none.nodes.filter((node) => node.current)).toHaveLength(0);
  });

  it('a link named twice is drawn thicker', () => {
    // Both graphs share one edge; only its weight differs.
    const double = vaultGraph([note('a.md', 'A', ['b', 'b']), note('b.md', 'B', [])]);
    const single = vaultGraph([note('a.md', 'A', ['b']), note('b.md', 'B', [])]);

    const doubleDrawing = graphDrawing(double, layoutGraph(double), null);
    const singleDrawing = graphDrawing(single, layoutGraph(single), null);

    // Each drawing has exactly one edge; compare its width.
    expect(doubleDrawing.edges[0]?.width).toBeGreaterThan(singleDrawing.edges[0]?.width ?? 0);
  });

  it('the label sits below the circle', () => {
    const graph = vaultGraph(NOTES);
    const positions = layoutGraph(graph);
    const drawing = graphDrawing(graph, positions, null);

    // Every baseline lies strictly beneath its note's centre.
    for (const node of drawing.nodes) {
      expect(node.labelY).toBeGreaterThan(node.y);
    }
  });

  // Proves a node joined to many others is capped, not drawn as a window-swallowing disc.
  it('a note joined to many notes stops growing', () => {
    const many = { nodes: [{ path: 'a', relative: 'a', title: 'A', degree: 40 }, { path: 'b', relative: 'b', title: 'B', degree: 1 }], edges: [{ from: 'a', to: 'b', count: 1 }] };
    const drawing = graphDrawing(many, layoutGraph(many), null);
    const bigNode = drawing.nodes.find((node) => node.path === 'a');
    expect(bigNode?.radius).toBeLessThanOrEqual(46);
  });

  // Proves an edge is drawn in the view box where its notes sit, not the unit layout box.
  it('a line is drawn between the two notes it joins', () => {
    const graph = vaultGraph(NOTES);
    const drawing = graphDrawing(graph, layoutGraph(graph), null);
    const firstEdge = drawing.edges[0];
    const fromNode = drawing.nodes.find((node) => node.path === 'C:/vault/a.md');
    const toNode = drawing.nodes.find((node) => node.path === 'C:/vault/b.md');
    expect(typeof fromNode?.x).toBe('number');
    expect(typeof toNode?.x).toBe('number');
    expect(firstEdge?.x1).toBe(fromNode?.x);
    expect(firstEdge?.y1).toBe(fromNode?.y);
    expect(firstEdge?.x2).toBe(toNode?.x);
    expect(firstEdge?.y2).toBe(toNode?.y);
  });

  it('a note with no position is left out', () => {
    const graph = vaultGraph(NOTES);

    // With an empty positions array nothing resolves, so both lists are empty.
    const drawing = graphDrawing(graph, [], null);
    expect(drawing.nodes).toHaveLength(0);
    expect(drawing.edges).toHaveLength(0);
  });
});

describe('shortLabel', () => {
  it('a short name is left alone', () => {
    // A title within the limit returns unchanged.
    expect(shortLabel('Alpha')).toBe('Alpha');
  });

  it('a long name is cut and marked with an ellipsis', () => {
    const long = 'x'.repeat(40);

    // Over-limit names are trimmed to exactly LABEL_LIMIT plus one ellipsis glyph.
    const result = shortLabel(long);
    expect(result.length).toBe(25);
    expect(result[result.length - 1]).toBe(String.fromCharCode(8230));
  });

  it('a name of exactly 24 characters is not cut, one of 25 is', () => {
    // The boundary: at the limit nothing changes; past it a truncation marker appears.
    expect(shortLabel('x'.repeat(24))).toBe('x'.repeat(24));
    expect(shortLabel('x'.repeat(25))).not.toBe('x'.repeat(25));
    expect(shortLabel('x'.repeat(25)).endsWith(String.fromCharCode(8230))).toBe(true);
  });
});
