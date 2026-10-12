/**
 * @file fidelity-check.ts
 * @purpose Compares the text as last saved with the text being saved and reports every top-level block, or blank space between blocks, whose content did not change but whose bytes did (FR-4.5). It recurses into list, listItem and blockquote containers replaced one for one so an unedited item rewritten beside a neighbour is reported; formatting inside a block whose content changed is not judged, and tables are never entered (FR-8.22).
 * @inputs Base text, current text, and the ranges of the current text the user edited as text.
 * @outputs FidelityFinding records in document order.
 * @functions
 *   - checkFidelity: Parses both texts, aligns their blocks recursively and reports untouched spans whose bytes changed.
 *   - locateBlocks: Pairs each top-level node with its source offsets, or null when one has none.
 *   - childrenOf: Returns the RootContent children of a container node, or null for non-containers such as tables.
 *   - addIfChanged: Records an unchanged-content-but-changed-byte span unless it was user-edited.
 *   - compareSequences: Aligns two block sequences, judges each aligned pair and recurses into one-for-one replaced containers.
 * @dataflow base + current text -> parseMarkdown -> locateBlocks -> contentKey -> alignBlocks -> slice comparison -> recursive container entry -> findings.
 * @controlflow Equal texts return early -> unlocatable trees return empty -> compareSequences judges each aligned block and its surrounding gaps, then walks the unaligned stretches to recurse into containers replaced one for one.
 * @version 2
 * @date 2026-09-14
 */

import type { RootContent } from 'mdast';
import { parseMarkdown } from '../parse/parser.js';
import type { OffsetRange } from '../position/map.js';
import { alignBlocks, contentKey, rangeTouched } from './fidelity-align.js';

export type { BlockPair } from './fidelity-align.js';

/** Discriminator for a judged span: an entire block or the blank gap between two blocks. */
export type FidelityFindingKind = 'block' | 'gap';

/** A single Fidelity Check (FR-4.5) finding describing one unchanged-content but changed-byte span. */
export interface FidelityFinding {
  /** The kind of span judged: an entire block or the blank gap between two blocks. */
  readonly kind: FidelityFindingKind;
  /** The mdast node type for a block, or the literal string 'gap' for inter-block spans. */
  readonly nodeType: string;
  /** Start index in the current text (inclusive) of this span. */
  readonly from: number;
  /** End index in the current text (exclusive) of this span. */
  readonly to: number;
  /** Start index in the base text (inclusive) of this span. */
  readonly baseFrom: number;
  /** End index in the base text (exclusive) of this span. */
  readonly baseTo: number;
  /** The slice of the base text over [baseFrom, baseTo). */
  readonly before: string;
  /** The slice of the current text over [from, to). */
  readonly after: string;
}

/** Node types whose children are compared when the node itself changed. Tables are absent on purpose (FR-8.22). */
const CONTAINER_TYPES: ReadonlySet<string> = new Set<string>(['list', 'listItem', 'blockquote']);

/** A top-level node paired with its source offsets in the document it was located from. */
interface LocatedBlock {
  readonly node: RootContent;
  readonly start: number;
  readonly end: number;
}

/** Accumulates comparison state shared across recursive calls into compareSequences. */
interface CompareContext {
  readonly baseText: string;
  readonly currentText: string;
  readonly touched: readonly OffsetRange[];
  readonly findings: FidelityFinding[];
}

/**
 * @purpose Pairs each top-level node with its source offsets, or null when one has none.
 * @inputs children - The ordered top-level nodes of a parsed document.
 * @outputs LocatedBlock[] | null - One block per child with valid offsets, or null if any child lacks them.
 * @dataflow Each child's position metadata -> offset pair -> recorded LocatedBlock (or null on missing offset).
 * @controlflow Iterate children; return null immediately when an offset is non-numeric, else accumulate blocks.
 */
function locateBlocks(children: readonly RootContent[]): LocatedBlock[] | null {
  const blocks: LocatedBlock[] = [];

  for (const child of children) {
    // Read the start offset from the node's position metadata.
    const start = child.position?.start.offset;
    // Read the end offset from the node's position metadata.
    const end = child.position?.end.offset;
    // If either offset is missing or non-numeric, this tree cannot be located byte-exactly.
    if (typeof start !== 'number' || typeof end !== 'number') {
      return null;
    } else {
      // Both offsets are valid numbers: record the node with its source span.
      blocks.push({ node: child, start, end });
    }
  }

  // Every child had valid offsets: return the located blocks in document order.
  return blocks;
}

/**
 * @purpose Returns the RootContent children of a container node, or null when the node has no comparable children.
 * @inputs node - The mdast node whose children are requested.
 * @outputs readonly RootContent[] | null - The node's children if it is an entered container, else null.
 * @dataflow Node type + shape -> membership test on CONTAINER_TYPES -> cast children or null signal.
 * @controlflow Branch on whether the node is a list, listItem or blockquote that carries children.
 */
function childrenOf(node: RootContent): readonly RootContent[] | null {
  // List, listItem and blockquote children are all RootContent members.
  if (CONTAINER_TYPES.has(node.type) && 'children' in node) {
    return node.children as readonly RootContent[];
  } else {
    // Non-container nodes have no comparable children: signal that to the caller.
    return null;
  }
}

/**
 * @purpose Records one unchanged-content-but-changed-byte span unless it was user-edited.
 * @inputs ctx - Shared comparison state carrying both texts, touched ranges and accumulating findings.
 * @inputs kind - Whether the span is an entire block or a blank gap between blocks.
 * @inputs nodeType - The mdast node type for a block, or 'gap' for inter-block spans.
 * @inputs baseFrom - Inclusive start of the span in the base text.
 * @inputs baseTo - Exclusive end of the span in the base text.
 * @inputs from - Inclusive start of the span in the current text.
 * @inputs to - Exclusive end of the span in the current text.
 * @outputs void - Appends a FidelityFinding to ctx.findings when the span qualifies.
 * @dataflow Base + current slices -> byte-difference and touched overlap test -> finding push or skip.
 * @controlflow Slice both texts; branch on difference-and-not-touched to record or discard.
 */
function addIfChanged(
  ctx: CompareContext,
  kind: FidelityFindingKind,
  nodeType: string,
  baseFrom: number,
  baseTo: number,
  from: number,
  to: number,
): void {
  // Slice the candidate span from each document using half-open [from, to) semantics.
  const before = ctx.baseText.slice(baseFrom, baseTo);
  const after = ctx.currentText.slice(from, to);
  // Report only when the bytes actually differ and no touched range overlaps this span.
  if (before !== after && !rangeTouched(from, to, ctx.touched)) {
    ctx.findings.push({ kind, nodeType, from, to, baseFrom, baseTo, before, after });
  } else {
    // Bytes are identical or the span was user-edited: skip this candidate.
  }
}

/**
 * @purpose Aligns two block sequences and judges every untouched span whose bytes changed (FR-4.5), recursing into containers replaced one for one.
 * @inputs ctx - Shared comparison state carrying both texts, touched ranges and accumulating findings.
 * @inputs baseBlocks - Located blocks of the base document within the current bounds.
 * @inputs currentBlocks - Located blocks of the current document within the current bounds.
 * @inputs baseBounds - The [start, end) byte span in the base text that these blocks occupy.
 * @inputs currentBounds - The [start, end) byte span in the current text that these blocks occupy.
 * @outputs void - Appends findings to ctx.findings for every qualifying span at this level and below.
 * @dataflow contentKey -> alignBlocks -> per-pair block/gap slice comparison -> recursive container entry -> findings.
 * @controlflow Judge each aligned pair's block, leading gap, adjacent gap and trailing gap; then walk unaligned stretches to recurse into one-for-one replaced containers.
 */
function compareSequences(
  ctx: CompareContext,
  baseBlocks: readonly LocatedBlock[],
  currentBlocks: readonly LocatedBlock[],
  baseBounds: OffsetRange,
  currentBounds: OffsetRange,
): void {
  // Align the two block sequences by content key.
  const pairs = alignBlocks(
    baseBlocks.map((b) => contentKey(b.node)),
    currentBlocks.map((c) => contentKey(c.node)),
  );

  // Judge each aligned pair's block and the surrounding gaps.
  for (let k = 0; k < pairs.length; k++) {
    const pair = pairs[k];
    // Resolve the base and current nodes, guarding against an out-of-range index.
    const b = pair === undefined ? undefined : baseBlocks[pair.base];
    const c = pair === undefined ? undefined : currentBlocks[pair.current];
    // Skip any pair whose resolved nodes are missing.
    if (pair === undefined || b === undefined || c === undefined) {
      continue;
    } else {
      // Judge this aligned block for unchanged-content-but-changed-byte edits.
      addIfChanged(ctx, 'block', c.node.type, b.start, b.end, c.start, c.end);

      // If this is the first pair and it maps from the very start of both bounds, judge the leading gap.
      if (k === 0 && pair.base === 0 && pair.current === 0) {
        addIfChanged(ctx, 'gap', 'gap', baseBounds.start, b.start, currentBounds.start, c.start);
      } else {
        // Not a start-aligned first pair: there is no leading gap to judge.
      }

      const next = pairs[k + 1];
      // If the next pair is directly adjacent in both documents, judge the gap between them.
      if (next !== undefined && next.base === pair.base + 1 && next.current === pair.current + 1) {
        const nb = baseBlocks[next.base];
        const nc = currentBlocks[next.current];
        // Only judge when both adjacent nodes resolved to valid blocks.
        if (nb !== undefined && nc !== undefined) {
          addIfChanged(ctx, 'gap', 'gap', b.end, nb.start, c.end, nc.start);
        } else {
          // An adjacent node is missing: skip the inter-block gap judgment.
        }
      } else {
        // The next pair is not adjacent (or absent): no inter-block gap to judge.
      }

      // If this is the last pair and it maps to the very end of both bounds, judge the trailing gap.
      if (k === pairs.length - 1 && pair.base === baseBlocks.length - 1 && pair.current === currentBlocks.length - 1) {
        addIfChanged(ctx, 'gap', 'gap', b.end, baseBounds.end, c.end, currentBounds.end);
      } else {
        // Not an end-aligned last pair: there is no trailing gap to judge.
      }
    }
  }

  // Enter containers replaced one for one: walk the unaligned stretches between pairs, with a sentinel after the last.
  let prevBase = -1;
  let prevCurrent = -1;
  for (let k = 0; k <= pairs.length; k++) {
    const next = pairs[k] ?? { base: baseBlocks.length, current: currentBlocks.length };
    // A stretch of exactly one unaligned block in each document sits between the previous pair and this one.
    if (next.base - prevBase === 2 && next.current - prevCurrent === 2) {
      const b = baseBlocks[prevBase + 1];
      const c = currentBlocks[prevCurrent + 1];
      // Judge only when both unaligned blocks resolved and share the same node type.
      if (b !== undefined && c !== undefined && b.node.type === c.node.type) {
        const baseChildren = childrenOf(b.node);
        const currentChildren = childrenOf(c.node);
        // Only containers expose comparable RootContent children; non-containers are skipped.
        if (baseChildren !== null && currentChildren !== null) {
          const baseInner = locateBlocks(baseChildren);
          const currentInner = locateBlocks(currentChildren);
          // Recurse only when both inner sequences can be located byte-exactly.
          if (baseInner !== null && currentInner !== null) {
            compareSequences(ctx, baseInner, currentInner, { start: b.start, end: b.end }, { start: c.start, end: c.end });
          } else {
            // An inner sequence lacks position metadata: cannot recurse into this container.
          }
        } else {
          // One side is not a container with children: nothing to recurse into.
        }
      } else {
        // The unaligned blocks are missing or of differing types: no shared container to enter.
      }
    } else {
      // No single-block gap here, or the stretch spans more than one block: skip container entry.
    }
    prevBase = next.base;
    prevCurrent = next.current;
  }
}

/**
 * @purpose Compares the last-saved text with the current text and reports every untouched span whose bytes changed (FR-4.5).
 * @inputs baseText - The previously saved document text.
 * @inputs currentText - The document text being saved now.
 * @inputs touched - Offset ranges the user edited, which must be excluded from findings.
 * @outputs readonly FidelityFinding[] - Untouched changed spans in ascending current-text order.
 * @dataflow base + current text -> parseMarkdown -> locateBlocks -> contentKey -> alignBlocks -> slice comparison -> recursive container entry -> findings.
 * @controlflow Equal texts return early -> unlocatable trees return empty -> compareSequences judges each aligned block, leading gap, adjacent gap and trailing gap, then recurses into one-for-one replaced containers.
 */
export function checkFidelity(baseText: string, currentText: string, touched: readonly OffsetRange[]): readonly FidelityFinding[] {
  // Nothing changed at all: there is nothing to report.
  if (baseText === currentText) {
    return [];
  } else {
    const baseBlocks = locateBlocks(parseMarkdown(baseText).root.children);
    const currentBlocks = locateBlocks(parseMarkdown(currentText).root.children);
    // If either document lacks position metadata, block alignment is impossible.
    if (baseBlocks === null || currentBlocks === null) {
      return [];
    } else {
      const ctx: CompareContext = { baseText, currentText, touched, findings: [] };
      compareSequences(ctx, baseBlocks, currentBlocks, { start: 0, end: baseText.length }, { start: 0, end: currentText.length });
      // Return findings ordered by their position in the current text.
      return ctx.findings.sort((x, y) => x.from - y.from);
    }
  }
}