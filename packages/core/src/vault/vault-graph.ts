/**
 * @file vault-graph.ts
 * @purpose Holds the graph of which notes link to which (FR-6.15) as plain data; it draws nothing and is read by the dialog that does.
 * @inputs NoteIndexEntry arrays from the vault index, a VaultGraph produced by vaultGraph, and note paths or depths for queries.
 * @outputs GraphNode/GraphEdge/VaultGraph records describing notes, their link weights, neighbour counts, and subgraphs around one note.
 * @functions
 *   - vaultGraph: Builds nodes, aggregated edges in first-appearance order, and per-node degree from indexed notes.
 *   - graphNeighbourhood: Cuts a graph to one note and everything within `depth` rings of it.
 *   - graphNode: Finds one node by its path.
 * @dataflow NoteIndexEntry array -> vaultGraph sweep -> nodes + edgeMap -> edges + neighbourSets -> VaultGraph; VaultGraph + path/depth -> reachability sets -> subgraph VaultGraph; VaultGraph + path -> find -> GraphNode | undefined.
 * @controlflow For each note push a node and resolve links to first matching other note -> aggregate into keyed Map -> derive edges in insertion order -> compute degrees from neighbour sets -> return graph; seed lookup -> BFS rings over undirected edges -> filter nodes/edges by reached set -> return subgraph; linear find on path.
 * @version 1
 * @date 2026-09-18
 */

import type { NoteIndexEntry } from './note-index.js';
import { targetsNote } from './vault-links.js';

/** One note, as the graph holds it. */
export interface GraphNode {
  readonly path: string;
  readonly relative: string;
  readonly title: string;
  /** How many other notes this one is joined to, counting each neighbour once whichever way the link runs. */
  readonly degree: number;
}

/** One note linking to another. Two notes that link to each other appear as two edges. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** How many links run this way; a note naming another three times is one edge of weight three. */
  readonly count: number;
}

export interface VaultGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * Builds the graph of links between the notes of a vault (FR-6.15).
 *
 * @purpose Turns indexed notes into nodes, aggregated directed edges with weights, and per-node neighbour counts so a dialog can render note connections without doing any drawing itself.
 * @inputs notes - Readonly array of every NoteIndexEntry in the vault, in index order.
 * @outputs VaultGraph - Nodes (one per input, first-appearance order), edges (aggregated, first-appearance order), and each node's degree.
 * @dataflow Each note -> its links -> targetsNote against other notes -> resolved pairs -> keyed Map of GraphEdge -> edge array + neighbour Sets -> nodes carrying computed degrees.
 * @controlflow Push a node per input; for every link find the FIRST matching distinct-note candidate then aggregate one weighted edge per (from,to) pair in insertion order; after edges are final, compute each node's degree from its neighbour set so it matches what will be drawn.
 */
export function vaultGraph(notes: readonly NoteIndexEntry[]): VaultGraph {
  // Every note becomes a node, in the order given. They are assembled at the end, once the edges are known,
  // because a node's degree is read off them and a GraphNode is not rewritten after it is made.
  const noted: { readonly path: string; readonly relative: string; readonly title: string }[] = [];

  // Aggregate one edge per (from,to) pair keyed on `${from}\n${to}` - a newline cannot appear in a path - so a repeated pair increments rather than duplicating. A Map keeps first-appearance order, which is how the edges are emitted later.
  const edgeMap = new Map<string, GraphEdge>();

  for (const source of notes) {
    noted.push({ path: source.path, relative: source.relative, title: source.title });

    for (const link of source.links) {
      // Find the FIRST other note this link targets, whose path differs from the source's own path. A note linking to itself is not a relationship between notes and must be excluded here by comparing paths, not object identity.
      let resolved: NoteIndexEntry | undefined;
      for (const candidate of notes) {
        // Skip self-links by path, not object reference: two entries for the same file are one note.
        if (candidate.path === source.path) {
          // Candidate is the source note itself: skip so a self-link never becomes an edge between notes.
          continue;
        } else {
          // Candidate is distinct from the source: test whether this link identifies it.
        }

        // Check whether the current link targets this candidate note via normalised path, file name, or title matching.
        if (targetsNote(link, candidate)) {
          // Link resolves to this candidate: record it and stop at the first match so resolution is deterministic in index order.
          resolved = candidate;
          break;
        } else {
          // Link does not target this candidate: keep searching for an earlier-first matching note.
        }
      }

      // A link that resolves to nothing is left out - a broken link is FR-14.7's business, not the graph's.
      if (resolved === undefined) {
        // No other note resolved from this link: leave it entirely out of the graph.
      } else {
        // Link resolved to another note: aggregate one edge along `${source.path}\n${resolved.path}` so repeated pairs count up instead of duplicating.
        const key = `${source.path}\n${resolved.path}`;
        const existing = edgeMap.get(key);

        if (existing === undefined) {
          // First link seen on this pair: create the edge with a starting weight of one.
          edgeMap.set(key, { from: source.path, to: resolved.path, count: 1 });
        } else {
          // Pair already present: increment its weight rather than adding a duplicate edge.
          edgeMap.set(key, { ...existing, count: existing.count + 1 });
        }
      }
    }
  }

  // Emit the edges in first-appearance order via the Map's insertion order; spread reads values without index access under noUncheckedIndexedAccess.
  const edges = [...edgeMap.values()];

  // Compute each node's degree AFTER the edges are finished so it matches what will be drawn. Degree counts distinct neighbours either way, so both ends of every edge join one another's set. Resolution above is O(notes x links x notes): for every link we scan all notes to find its first match. That is the vault index's own scale - the same sweep backlinksTo performs once per note rather than once per lookup - and it stays acceptable because both bounds are bounded by a single indexed vault, not an unbounded graph.
  const neighbourSets = new Map<string, Set<string>>();

  for (const edge of edges) {
    let fromSet = neighbourSets.get(edge.from);

    if (fromSet === undefined) {
      // No neighbour set yet for the source end: create one and register it so both ends share a live reference.
      fromSet = new Set<string>();
      neighbourSets.set(edge.from, fromSet);
    } else {
      // Neighbour set already exists for the source end: reuse it rather than rebuilding.
    }

    let toSet = neighbourSets.get(edge.to);

    if (toSet === undefined) {
      // No neighbour set yet for the target end: create one and register it so both ends share a live reference.
      toSet = new Set<string>();
      neighbourSets.set(edge.to, toSet);
    } else {
      // Neighbour set already exists for the target end: reuse it rather than rebuilding.
    }

    fromSet.add(edge.to);
    toSet.add(edge.from);
  }

  // Each node takes its distinct-neighbour count from the sets, so a note nothing links to or from reads as
  // zero rather than as a missing entry.
  const nodes: GraphNode[] = noted.map((entry): GraphNode => {
    const set = neighbourSets.get(entry.path);

    // Check whether this note is joined to anything at all.
    if (set === undefined) {
      // Nothing links to or from it: its degree is zero.
      return { ...entry, degree: 0 };
    } else {
      // Joined to at least one other note, counted once whichever way the link runs.
      return { ...entry, degree: set.size };
    }
  });

  return { nodes, edges };
}

/**
 * Cuts a graph down to one note and what is near it, so a large vault can still be read (FR-6.15).
 *
 * @purpose Performs an unbounded breadth-first expansion from a seed note over whole rings of neighbours, returning only the subgraph that fits within `depth` steps so rendering stays legible on big vaults.
 * @inputs graph - The VaultGraph to trim. path - The path of the seed note whose neighbourhood is returned. depth - Whole rings of neighbours to include; fractional or negative values are floored and clamped at zero.
 * @outputs VaultGraph - Nodes within `depth` rings of `path`, plus every edge with both ends inside that set, each in the graph's own order.
 * @dataflow Seed path -> reachability Set seeded with one path -> undirected edge sweep repeated `floor(depth)` times -> reached paths -> filter nodes then edges by membership.
 * @controlflow Look up seed node; if absent return an empty graph (never the whole one); otherwise expand a BFS frontier ring-by-ring treating every edge as joining both ways, commit each whole ring at once so double-joined paths count as one step, then keep only in-range nodes and edges.
 */
export function graphNeighbourhood(
  graph: VaultGraph,
  path: string,
  depth: number,
): VaultGraph {
  // A note the vault has not got needs no guard of its own: it joins no edge, so the walk below reaches
  // nothing and the two filters answer with an empty graph rather than with every note the vault has.
  //
  // Reached paths accumulate here; seeded with just `path` so a depth of zero returns only the seed itself and nothing beyond.
  const reached = new Set<string>([path]);

  // Walk whole rings regardless of fractional or negative input, so depth is always an integer count of steps outward from the seed.
  const rounds = Math.max(0, Math.floor(depth));

  for (let round = 0; round < rounds; round++) {
    // Every path joined to one already reached joins this ring too - edges are treated as joining both ways so neighbours come in either direction. Collect into a scratch list first so the whole ring commits at once and a path joined by two edges still counts as one step out, never two.
    const newlyReached: string[] = [];

    for (const edge of graph.edges) {
      if (reached.has(edge.from) && !reached.has(edge.to)) {
        // The far end is joined to a reached note but not itself reached yet: queue it as part of this ring.
        newlyReached.push(edge.to);
      } else {
        // Either end already reached or neither: nothing new from this edge in the forward direction this round.
      }

      if (reached.has(edge.to) && !reached.has(edge.from)) {
        // The near end is joined to a reached note but not itself reached yet: queue it as part of this ring, covering reverse-direction links.
        newlyReached.push(edge.from);
      } else {
        // Either end already reached or neither: nothing new from this edge in the reverse direction this round.
      }
    }

    // Commit the whole ring at once; Set.add is idempotent so a path discovered by two edges still lands exactly once.
    for (const next of newlyReached) {
      reached.add(next);
    }
  }

  // Return nodes in the graph's own order, keeping only those whose path lies within the reached set.
  const nodes = graph.nodes.filter((node) => reached.has(node.path));

  // Return edges with both ends inside the reached set, also in the graph's own order, so no dangling half-edge is drawn into the neighbourhood.
  const edges = graph.edges.filter(
    (edge) => reached.has(edge.from) && reached.has(edge.to),
  );

  return { nodes, edges };
}

/**
 * Finds one note in the graph by its path.
 *
 * @purpose Locates a single GraphNode within a VaultGraph so callers can read degree or identity without scanning manually.
 * @inputs graph - The VaultGraph to search. path - The exact node path to match against each node's `path`.
 * @outputs GraphNode | undefined - The matching node, or undefined when no node carries that path.
 * @dataflow Path -> linear scan of nodes by equality -> matched node or undefined.
 * @controlflow Return the first node whose path equals `path`; a single find statement with an early stop on match and no fallback branch needed since find already yields undefined.
 */
export function graphNode(graph: VaultGraph, path: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.path === path);
}
