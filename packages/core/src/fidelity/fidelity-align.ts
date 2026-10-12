/**
 * @file fidelity-align.ts
 * @purpose Aligns the top-level blocks of two parsed documents by content for the Fidelity Check (FR-4.5).
 * @inputs Two arrays of per-block content keys (base and current); RootContent nodes for contentKey; offset ranges for rangeTouched.
 * @outputs BlockPair index mappings between base and current blocks; a boolean indicating whether an offset range was touched.
 * @functions
 *   - withoutPosition: JSON.stringify replacer that drops position metadata from a node.
 *   - cell: Reads a Uint32Array LCS table cell, defaulting out-of-range reads to 0.
 *   - contentKey: Serializes a RootContent node into a stable key with position stripped.
 *   - rangeTouched: Tests whether an offset range overlaps any touched range.
 *   - alignBlocks: Computes block pairs via longest-common-subsequence alignment of base and current keys.
 * @dataflow RootContent nodes -> contentKey strings -> LCS table build + backtrack -> BlockPair mappings.
 * @controlflow Serialize each node -> compute common prefix/suffix -> build LCS table for the middle if within budget -> backtrack to emit pairs in ascending order.
 * @version 1
 * @date 2026-09-14
 */

import type { RootContent } from 'mdast';
import type { OffsetRange } from '../position/map.js';

export interface BlockPair {
  readonly base: number;
  readonly current: number;
}

/** Largest LCS table (rows x columns) the aligner builds for the unmatched middle; larger middles stay unaligned. */
export const MAX_ALIGNMENT_CELLS = 4_000_000;

/**
 * @purpose JSON.stringify replacer that removes position metadata from a node.
 * @inputs key - The property name currently being serialized.
 * @inputs value - The current property value.
 * @outputs unknown - undefined for `position`, otherwise the original value.
 * @dataflow Property key/value -> identity check on 'position' -> dropped or passthrough value.
 * @controlflow Branch on whether the key is 'position'; drop it, else pass through unchanged.
 */
function withoutPosition(key: string, value: unknown): unknown {
  // Check if this is the position property being visited.
  if (key === 'position') {
    // Position metadata carries source offsets that must not influence block identity; drop it.
    return undefined;
  } else {
    // Any other property: keep its value unchanged so content comparison ignores location only.
    return value;
  }
}

/**
 * @purpose Reads a single LCS table cell, defaulting out-of-range reads to 0.
 * @inputs table - The flat Uint32Array backing the DP table.
 * @inputs index - The flattened row-major index into the table.
 * @outputs number - The stored cell value, or 0 when the index is outside written cells.
 * @dataflow Flattened index -> Uint32Array read with ?? 0 fallback -> numeric cell value.
 * @controlflow Single indexed read; no branching beyond the nullish coalescing fallback.
 */
function cell(table: Uint32Array, index: number): number {
  // Indices are always in range for every read performed by alignBlocks; the ?? 0 only satisfies noUncheckedIndexedAccess.
  return table[index] ?? 0;
}

/**
 * @purpose Serializes a node into a stable content key with position metadata stripped.
 * @inputs node - The RootContent node to fingerprint.
 * @outputs string - JSON representation of the node excluding any `position` property.
 * @dataflow Node -> JSON.stringify with withoutPosition replacer -> position-stripped JSON string.
 * @controlflow Single serialization pass; no branching.
 */
export function contentKey(node: RootContent): string {
  // Serialize the node into a stable JSON string, stripping position metadata via withoutPosition.
  return JSON.stringify(node, withoutPosition);
}

/**
 * @purpose Reports whether an offset range overlaps any touched range.
 * @inputs from - Inclusive start of the query range (0-based).
 * @inputs to - Inclusive end of the query range (0-based).
 * @inputs touched - The set of ranges to test against.
 * @outputs boolean - True if the query range intersects at least one touched range.
 * @dataflow Query bounds + touched array -> pairwise inclusive overlap test -> boolean result.
 * @controlflow Single pass over touched; returns on first match via Array.some.
 */
export function rangeTouched(from: number, to: number, touched: readonly OffsetRange[]): boolean {
  // Test overlap of [from, to] against each touched range with inclusive bounds at both ends.
  return touched.some((r: OffsetRange): boolean => from <= r.end && r.start <= to);
}

/**
 * @purpose Aligns base and current block keys via longest-common-subsequence matching.
 * @inputs baseKeys - Content keys of the base document's top-level blocks.
 * @inputs currentKeys - Content keys of the current document's top-level blocks.
 * @outputs readonly BlockPair[] - Mapped {base, current} index pairs in ascending order.
 * @dataflow Key arrays -> prefix/suffix strip -> LCS table + backtrack for the middle -> ordered pairs.
 * @controlflow Match common ends -> optionally build and backtrack an LCS table for the middle -> emit prefix, middle, suffix pairs.
 */
export function alignBlocks(baseKeys: readonly string[], currentKeys: readonly string[]): readonly BlockPair[] {
  const n = baseKeys.length; // Number of blocks in the base document.
  const m = currentKeys.length; // Number of blocks in the current document.
  const limit = Math.min(n, m); // Upper bound on how many leading/trailing blocks can match.

  // Advance p over the common prefix while within budget and keys are equal.
  let p = 0;
  while (p < limit && baseKeys[p] === currentKeys[p]) {
    // Keys matched at position p: extend the common prefix by one block.
    p += 1;
  }

  // Extend s over the common suffix without overlapping the already-matched prefix region.
  let s = 0;
  while (s < limit - p && baseKeys[n - 1 - s] === currentKeys[m - 1 - s]) {
    // Keys matched at the mirrored position: extend the common suffix by one block.
    s += 1;
  }

  const pairs: BlockPair[] = [];

  // Emit prefix pairs in ascending order.
  for (let i = 0; i < p; i++) {
    pairs.push({ base: i, current: i });
  }

  const a = n - p - s; // Unmatched blocks remaining in the base middle.
  const b = m - p - s; // Unmatched blocks remaining in the current middle.

  // Build an LCS table only when both middles are non-empty and the cell budget is affordable.
  if (a > 0 && b > 0 && a * b <= MAX_ALIGNMENT_CELLS) {
    const width = b + 1; // Row stride so that cell(i, j) maps to index i * width + j.
    const table = new Uint32Array((a + 1) * (b + 1)); // Rows a and columns b stay at their 0 default.

    // Fill the LCS table bottom-up from the last middle block toward the first.
    for (let i = a - 1; i >= 0; i--) {
      for (let j = b - 1; j >= 0; j--) {
        // Check if the two middle keys match at this position.
        if (baseKeys[p + i] === currentKeys[p + j]) {
          // Keys match: extend the LCS diagonal by one cell.
          table[i * width + j] = 1 + cell(table, (i + 1) * width + (j + 1));
        } else {
          // Keys differ: take the better of dropping the base or the current block.
          table[i * width + j] = Math.max(cell(table, (i + 1) * width + j), cell(table, i * width + (j + 1)));
        }
      }
    }

    // Backtrack from the top-left to reconstruct one longest common subsequence.
    let i = 0;
    let j = 0;
    while (i < a && j < b) {
      // Check if the current middle keys match: emit a pair and move diagonally.
      if (baseKeys[p + i] === currentKeys[p + j]) {
        pairs.push({ base: p + i, current: p + j });
        i += 1;
        j += 1;
      } else if (cell(table, (i + 1) * width + j) >= cell(table, i * width + (j + 1))) {
        // Base block is not part of the LCS: drop it by advancing only i.
        i += 1;
      } else {
        // Current block is not part of the LCS: drop it by advancing only j.
        j += 1;
      }
    }
  } else {
    // Middles too small or over budget: leave the middle region unaligned.
  }

  // Emit suffix pairs in ascending order (iterating from the end backward).
  for (let k = s - 1; k >= 0; k--) {
    pairs.push({ base: n - 1 - k, current: m - 1 - k });
  }

  return pairs;
}