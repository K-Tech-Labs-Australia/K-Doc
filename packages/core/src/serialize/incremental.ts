/**
 * @file incremental.ts
 * @purpose Implements the incremental Markdown serializer for @k-doc/core. This module satisfies
 *   requirement FR-4.2 of PRELIM-SPEC.MD ("the editor MUST NOT reformat regions the user has not
 *   touched; unedited byte ranges pass through untouched"). While the whole-document serializer
 *   re-emits every node (which turns a single-word edit into a whole-file diff on non-canonical files),
 *   this module treats the ORIGINAL SOURCE TEXT as the base and rewrites only the byte ranges whose
 *   nodes actually changed, enabled because KdocDocument retains source text alongside the AST.
 * @inputs Original KdocDocument containing source text and AST root, updated mdast Root AST, and optional MarkdownStyle configuration.
 * @outputs IncrementalResult containing the spliced Markdown text, replaced offset ranges, reused byte count, and total original byte count.
 * @functions
 *   - structuralKey: Generates a deterministic string identity for an AST node ignoring position metadata.
 *   - matchRuns: Computes sequence of keep and replace runs between child key sequences via LCS or prefix/suffix heuristic.
 *   - serializeFragment: Serializes a slice of RootContent nodes into a formatted Markdown fragment without trailing newlines.
 *   - splicesParseAlike: Checks that splices nested inside a top-level container parse the same as re-emitting it whole.
 *   - serializeIncremental: Serializes an updated Root against an original KdocDocument by rewriting only modified byte ranges; a top-level list or blockquote replaced by one of the same kind has only its changed parts rewritten, down through nested quotes and items (list-items.ts, containers.ts); equal-length replaced stretches of matching types are taken pair by pair.
 * @dataflow Original KdocDocument + updated Root -> structuralKey comparison -> matchRuns (LCS / heuristic) -> serializeFragment for replacements -> splice replacements into original text -> IncrementalResult.
 * @controlflow Resolve MarkdownStyle -> check fast path (element-wise structural key equality) -> match child sequences -> build replacement plan (bail out to serializeDocument if node positions missing) -> apply replacements in descending offset order -> compute byte statistics -> return IncrementalResult.
 * @version 3
 * @date 2026-09-15
 */

import type { Root, RootContent } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import {
  resolveMarkdownStyle,
  type MarkdownStyle,
} from '../style/markdown-style.js';
import { serializeDocument } from './serializer.js';
import { nodeRange, type OffsetRange } from '../position/map.js';
import { planListItems } from './list-items.js';
import { listSpliceDeps, planBlockquote, type ContainerSpliceDeps } from './containers.js';
import { parseMarkdown } from '../parse/parser.js';

/**
 * Result of an incremental serialization operation.
 */
export interface IncrementalResult {
  /**
   * Spliced Markdown source text after applying incremental node replacements.
   */
  readonly text: string;

  /**
   * Byte offset ranges in the ORIGINAL source text that were replaced during serialization.
   */
  readonly replacedRanges: readonly OffsetRange[];

  /**
   * Total count of bytes preserved untouched from the original source text.
   */
  readonly reusedBytes: number;

  /**
   * Total byte length of the original source text before modification.
   */
  readonly totalBytes: number;
}

/**
 * Represents an index range in the old and new child arrays classified as either 'keep' or 'replace'.
 */
interface MatchRun {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
  readonly kind: 'keep' | 'replace';
}

/**
 * Maximum cell count (oldKeys.length * newKeys.length) allowed for the dynamic programming LCS algorithm.
 * Bounding the DP table prevents a pathological document with thousands of top-level nodes from hanging the editor.
 */
const LCS_CELL_BUDGET = 4_000_000;

/**
 * Generates a deterministic string identity for an AST node that ignores position metadata at all depths.
 *
 * @purpose Recursively serializes an unknown AST node or value into a deterministic JSON-like string, omitting position attributes and sorting object keys.
 * @inputs node - The AST node or sub-value of unknown type to compute a structural identity for.
 * @outputs string - The deterministic string representation of the node's structure and content.
 * @dataflow node -> type narrowing (primitive / array / object) -> recursive serialization -> sorted key-value pairs -> deterministic string.
 * @controlflow Check for null or primitive types -> check for Array -> check for plain object -> strip 'position' property -> sort remaining keys with localeCompare -> recursively map values -> return string.
 */
function structuralKey(node: unknown): string {
  // Check whether the value is null or a primitive (non-object) type.
  if (node === null || typeof node !== 'object') {
    // Primitive value or null: JSON.stringify produces the canonical representation.
    // Fallback to literal 'undefined' if JSON.stringify returns undefined.
    return JSON.stringify(node) ?? 'undefined';
  } else if (Array.isArray(node)) {
    // Value is an Array: recursively serialize all elements in index order.
    const items: string[] = [];
    for (const item of node) {
      items.push(structuralKey(item));
    }
    return `[${items.join(',')}]`;
  } else {
    // Value is a plain object: collect own enumerable property keys.
    const record = node as Readonly<Record<string, unknown>>;
    const allKeys = Object.keys(record);
    const filteredKeys: string[] = [];

    // Filter out the 'position' property at every depth so AST position offsets do not influence structural identity.
    for (const key of allKeys) {
      // Check if the current key is the position metadata key.
      if (key !== 'position') {
        // Retain non-position property key.
        filteredKeys.push(key);
      } else {
        // Drop 'position' key.
      }
    }

    // Sort the remaining keys with localeCompare so key insertion order cannot change the identity.
    // Sorting is what makes the key stable, since two structurally identical nodes built by different code paths
    // may enumerate their properties in different orders.
    filteredKeys.sort((a, b) => a.localeCompare(b));

    const pairs: string[] = [];
    for (const key of filteredKeys) {
      const val = record[key];
      pairs.push(`${JSON.stringify(key)}:${structuralKey(val)}`);
    }

    return `{${pairs.join(',')}}`;
  }
}

/**
 * Matches two sequences of structural keys to produce alternating keep and replace runs.
 *
 * @purpose Computes the minimal sequence of keep and replace runs between old and new child sequences using LCS or a prefix/suffix heuristic.
 * @inputs oldKeys - Readonly array of structural key strings from the original document's AST children.
 * @inputs newKeys - Readonly array of structural key strings from the updated document's AST children.
 * @outputs readonly MatchRun[] - Array of alternating keep and replace index runs spanning both sequences completely.
 * @dataflow oldKeys + newKeys -> check cell budget -> DP table computation or prefix/suffix heuristic -> backtrace -> merge runs -> MatchRun array.
 * @controlflow Check if cell budget exceeded -> run heuristic fallback if true -> build (M+1)x(N+1) DP table -> backtrace matching pairs -> coalesce keep runs -> weave replace runs -> return runs.
 */
function matchRuns(
  oldKeys: readonly string[],
  newKeys: readonly string[]
): readonly MatchRun[] {
  const M = oldKeys.length;
  const N = newKeys.length;

  // Guard: when oldKeys.length * newKeys.length exceeds LCS_CELL_BUDGET, skip dynamic programming
  // and fall back to a simple common-prefix / common-suffix match.
  // The fallback is coarser — it merges separate edits into one replaced span — but is correct,
  // and correctness is never traded away, only minimality.
  if (M * N > LCS_CELL_BUDGET) {
    // Common-prefix scan: advance prefixLen as long as keys match from the start.
    let prefixLen = 0;
    while (prefixLen < M && prefixLen < N) {
      const oldK = oldKeys[prefixLen];
      const newK = newKeys[prefixLen];
      // Check if keys match at the current prefix index.
      if (oldK !== undefined && newK !== undefined && oldK === newK) {
        prefixLen += 1;
      } else {
        break;
      }
    }

    // Common-suffix scan: advance suffixLen as long as keys match from the end without overlapping the prefix.
    let suffixLen = 0;
    while (suffixLen < (M - prefixLen) && suffixLen < (N - prefixLen)) {
      const oldK = oldKeys[M - 1 - suffixLen];
      const newK = newKeys[N - 1 - suffixLen];
      // Check if keys match at the current suffix index.
      if (oldK !== undefined && newK !== undefined && oldK === newK) {
        suffixLen += 1;
      } else {
        break;
      }
    }

    const fallbackRuns: MatchRun[] = [];

    // Check if there is a non-empty common prefix to preserve.
    if (prefixLen > 0) {
      // Non-empty prefix: emit keep run for the prefix span.
      fallbackRuns.push({
        oldStart: 0,
        oldEnd: prefixLen,
        newStart: 0,
        newEnd: prefixLen,
        kind: 'keep',
      });
    } else {
      // No common prefix: continue to middle check.
    }

    // Calculate middle bounds between prefix and suffix.
    const oldMiddleEnd = M - suffixLen;
    const newMiddleEnd = N - suffixLen;

    // Check if the middle region is non-empty in either the old or new sequence.
    if (prefixLen < oldMiddleEnd || prefixLen < newMiddleEnd) {
      // Non-empty middle region: emit single replace run spanning the unaligned span.
      fallbackRuns.push({
        oldStart: prefixLen,
        oldEnd: oldMiddleEnd,
        newStart: prefixLen,
        newEnd: newMiddleEnd,
        kind: 'replace',
      });
    } else {
      // Both sequences are completely covered by prefix and suffix; no middle replacement needed.
    }

    // Check if there is a non-empty common suffix to preserve.
    if (suffixLen > 0) {
      // Non-empty suffix: emit keep run for the suffix span.
      fallbackRuns.push({
        oldStart: oldMiddleEnd,
        oldEnd: M,
        newStart: newMiddleEnd,
        newEnd: N,
        kind: 'keep',
      });
    } else {
      // No common suffix.
    }

    return fallbackRuns;
  } else {
    // Within cell budget: proceed with standard dynamic programming LCS.
  }

  // Build (M + 1) x (N + 1) dynamic programming table.
  const dp: number[][] = [];
  for (let i = 0; i <= M; i++) {
    dp.push(new Array<number>(N + 1).fill(0));
  }

  for (let i = 1; i <= M; i++) {
    const oldKey = oldKeys[i - 1];
    const currentRow = dp[i];
    const prevRow = dp[i - 1];

    // Check if current and previous rows exist in DP table.
    if (currentRow !== undefined && prevRow !== undefined) {
      for (let j = 1; j <= N; j++) {
        const newKey = newKeys[j - 1];

        // Check if the current pair of structural keys are identical.
        if (oldKey !== undefined && newKey !== undefined && oldKey === newKey) {
          // Keys match: increment diagonal length from previous prefix.
          currentRow[j] = (prevRow[j - 1] ?? 0) + 1;
        } else {
          // Keys differ: take maximum of top (deletion) and left (insertion) cells.
          const top = prevRow[j] ?? 0;
          const left = currentRow[j - 1] ?? 0;
          // Check whether top cell is greater than or equal to left cell.
          if (top >= left) {
            currentRow[j] = top;
          } else {
            currentRow[j] = left;
          }
        }
      }
    } else {
      // Unreachable row boundary under valid iteration.
    }
  }

  // Backtrace from (M, N) to (0, 0) to extract matched element index pairs in the LCS.
  interface MatchedPair {
    readonly oldIndex: number;
    readonly newIndex: number;
  }
  const matchedPairs: MatchedPair[] = [];
  let traceI = M;
  let traceJ = N;

  while (traceI > 0 && traceJ > 0) {
    const oldKey = oldKeys[traceI - 1];
    const newKey = newKeys[traceJ - 1];
    const currentRow = dp[traceI];
    const prevRow = dp[traceI - 1];

    // Check if the current elements match.
    if (oldKey !== undefined && newKey !== undefined && oldKey === newKey) {
      // Keys are identical: record matched pair and move diagonally up-left.
      matchedPairs.push({ oldIndex: traceI - 1, newIndex: traceJ - 1 });
      traceI -= 1;
      traceJ -= 1;
    } else {
      // Keys differ: determine direction of maximum path in DP table.
      const top = prevRow !== undefined ? (prevRow[traceJ] ?? 0) : 0;
      const left = currentRow !== undefined ? (currentRow[traceJ - 1] ?? 0) : 0;

      // Check whether the top cell value is greater than or equal to the left cell value.
      if (top >= left) {
        // Move up along old sequence.
        traceI -= 1;
      } else {
        // Move left along new sequence.
        traceJ -= 1;
      }
    }
  }

  // Reverse matched pairs so they appear in ascending document index order.
  matchedPairs.reverse();

  // Coalesce contiguous matched index pairs into maximal keep runs.
  interface MutableKeepRun {
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
  }
  const keepRuns: MutableKeepRun[] = [];

  for (const pair of matchedPairs) {
    const lastKeep = keepRuns[keepRuns.length - 1];

    // Check if current matched pair immediately extends the preceding keep run.
    if (
      lastKeep !== undefined &&
      lastKeep.oldEnd === pair.oldIndex &&
      lastKeep.newEnd === pair.newIndex
    ) {
      // Contiguous match: extend the existing keep run.
      lastKeep.oldEnd = pair.oldIndex + 1;
      lastKeep.newEnd = pair.newIndex + 1;
    } else {
      // Discontiguous match: start a new keep run.
      keepRuns.push({
        oldStart: pair.oldIndex,
        oldEnd: pair.oldIndex + 1,
        newStart: pair.newIndex,
        newEnd: pair.newIndex + 1,
      });
    }
  }

  // Interleave keep runs and replace runs to cover both sequences completely and in order.
  const runs: MatchRun[] = [];
  let currOld = 0;
  let currNew = 0;

  for (const keep of keepRuns) {
    // Check if there is an unkept gap before the current keep run in either sequence.
    if (currOld < keep.oldStart || currNew < keep.newStart) {
      // Emit replace run covering the gap.
      runs.push({
        oldStart: currOld,
        oldEnd: keep.oldStart,
        newStart: currNew,
        newEnd: keep.newStart,
        kind: 'replace',
      });
    } else {
      // No gap preceding this keep run.
    }

    // Emit the keep run.
    runs.push({
      oldStart: keep.oldStart,
      oldEnd: keep.oldEnd,
      newStart: keep.newStart,
      newEnd: keep.newEnd,
      kind: 'keep',
    });

    currOld = keep.oldEnd;
    currNew = keep.newEnd;
  }

  // Check if there is a trailing unkept gap after the final keep run.
  if (currOld < M || currNew < N) {
    // Emit trailing replace run covering the remaining elements.
    runs.push({
      oldStart: currOld,
      oldEnd: M,
      newStart: currNew,
      newEnd: N,
      kind: 'replace',
    });
  } else {
    // No trailing gap; both sequences fully processed.
  }

  return runs;
}

/**
 * Serializes a list of AST content nodes into a Markdown fragment string.
 *
 * @purpose Serializes a slice of RootContent nodes into a formatted Markdown fragment, stripping exactly one trailing newline.
 * @inputs nodes - Readonly array of RootContent mdast nodes to serialize.
 * @inputs style - The resolved MarkdownStyle emission policy.
 * @outputs string - Formatted Markdown fragment text without its document-level trailing newline.
 * @dataflow nodes -> synthetic Root -> serializeDocument({ text: '', root, frontMatter: null }) -> strip single trailing newline -> fragment string.
 * @controlflow Check if nodes array is empty -> return empty string if empty -> wrap in synthetic root -> invoke serializeDocument -> strip trailing \r\n or \n -> return string.
 */
function serializeFragment(
  nodes: readonly RootContent[],
  style: MarkdownStyle
): string {
  // Check if the nodes array is empty.
  if (nodes.length === 0) {
    // When nodes is empty, return the empty string without invoking the serializer at all.
    return '';
  } else {
    // Nodes array is non-empty; proceed with fragment serialization.
  }

  // Build a synthetic Root node containing the fragment children.
  const syntheticRoot: Root = {
    type: 'root',
    children: [...nodes],
  };

  // Serialize the synthetic document using the standard whole-document serializer.
  const serialized = serializeDocument(
    {
      text: '',
      root: syntheticRoot,
      frontMatter: null,
    },
    style
  );

  // Strip exactly ONE trailing newline if present.
  // The trailing newline is stripped because the fragment is being spliced INTO existing text
  // whose own line structure must be preserved — the document-level trailing-newline policy applies
  // to the document, not to a fragment.
  if (serialized.endsWith('\r\n')) {
    // Trailing CRLF: remove the 2-byte newline sequence.
    return serialized.slice(0, -2);
  } else if (serialized.endsWith('\n')) {
    // Trailing LF: remove the 1-byte newline character.
    return serialized.slice(0, -1);
  } else {
    // No trailing newline present: return serialized output as-is.
    return serialized;
  }
}

/**
 * @purpose Checks that splices planned inside one top-level container read back as the same Markdown as re-emitting it whole.
 * @inputs text - The original document; oldNode - The container as parsed; newNode - Its replacement; plans - Splices inside oldNode's range; style - The resolved style.
 * @outputs boolean - True when the spliced block and the re-emitted block parse to the same structure.
 * @dataflow oldNode's source slice + plans (descending) -> spliced block -> parse; newNode -> serializeFragment -> parse; compare structural keys.
 * @controlflow Refuse a node without a range; otherwise splice, parse both, and compare keys in order.
 */
function splicesParseAlike(text: string, oldNode: RootContent, newNode: RootContent, plans: readonly { readonly range: OffsetRange; readonly text: string }[], style: MarkdownStyle): boolean {
  const range = nodeRange(oldNode);
  // A container without a position cannot be sliced out to check.
  if (range === null) {
    return false;
  } else {
    // Positioned: splice its slice below.
  }
  let block = text.slice(range.start, range.end);
  for (const plan of [...plans].sort((a, b) => b.range.start - a.range.start)) {
    // Every plan lies inside the container it was planned for, so its offsets shift by the container's start.
    block = block.slice(0, plan.range.start - range.start) + plan.text + block.slice(plan.range.end - range.start);
  }
  const spliced = parseMarkdown(block).root.children.map((child) => structuralKey(child));
  const rewritten = parseMarkdown(serializeFragment([newNode], style)).root.children.map((child) => structuralKey(child));
  return JSON.stringify(spliced) === JSON.stringify(rewritten);
}

/**
 * Serializes an updated AST tree by rewriting only the modified byte ranges in the original document text.
 *
 * @purpose Implements incremental Markdown serialization, fulfilling FR-4.2 by preserving untouched source text byte ranges.
 * @inputs original - The source KdocDocument containing original text, AST root, and front matter.
 * @inputs updated - The modified Root AST to be serialized against the original text.
 * @inputs style - Optional partial or complete MarkdownStyle emission policy.
 * @outputs IncrementalResult - Contains spliced text, replaced offset ranges, reused byte count, and total byte count.
 * @dataflow original + updated -> structural keys -> fast path check -> match runs -> compute replacement byte ranges -> format insertions/replacements -> splice in descending offset order -> IncrementalResult.
 * @controlflow Resolve MarkdownStyle -> check fast path (element-wise structural key equality) -> match child sequences -> build replacement plan (bail out to serializeDocument if node positions missing) -> apply replacements in descending offset order -> compute byte statistics -> return IncrementalResult.
 */
export function serializeIncremental(
  original: KdocDocument,
  updated: Root,
  style?: MarkdownStyle
): IncrementalResult {
  const resolvedStyle = resolveMarkdownStyle(style);

  const oldChildren = original.root.children;
  const newChildren = updated.children;

  const oldKeys: string[] = [];
  for (const child of oldChildren) {
    oldKeys.push(structuralKey(child));
  }

  const newKeys: string[] = [];
  for (const child of newChildren) {
    newKeys.push(structuralKey(child));
  }

  // Check whether oldKeys and newKeys have identical length.
  let keysEqual = oldKeys.length === newKeys.length;
  if (keysEqual) {
    // Check element-wise equality between all keys.
    for (let i = 0; i < oldKeys.length; i++) {
      const oldK = oldKeys[i];
      const newK = newKeys[i];
      // Check if both keys exist and are identical.
      if (oldK === undefined || newK === undefined || oldK !== newK) {
        keysEqual = false;
        break;
      } else {
        // Keys match at current index; continue comparison.
      }
    }
  } else {
    // Lengths differ; keys cannot be equal.
  }

  // FAST PATH: When the two key arrays are element-wise equal, return original.text UNCHANGED
  // with replacedRanges: [] and reusedBytes === totalBytes, without serializing anything at all.
  // This is the case that matters most in practice — opening a file and saving it untouched —
  // and it must be exactly free.
  if (keysEqual) {
    // Fast path matches: return original text unchanged with zero replacements.
    return {
      text: original.text,
      replacedRanges: [],
      reusedBytes: original.text.length,
      totalBytes: original.text.length,
    };
  } else {
    // Changes detected: proceed with run matching and incremental replacement planning.
  }

  // A replaced stretch of as many new blocks as old, each of the same type as the block it replaces, is taken pair by pair:
  // one changed block then keeps its own untouched parts even when its neighbour changed too, and every separator between
  // them stays as written. Pairs of different types stay one stretch, since a separator valid between the old blocks (a
  // single newline before a list) may not be between the new ones.
  const runs = matchRuns(oldKeys, newKeys).flatMap((run: MatchRun): MatchRun[] => {
    const count = run.oldEnd - run.oldStart;
    const sameTypes = oldChildren.slice(run.oldStart, run.oldEnd).every((child, index) => child.type === newChildren[run.newStart + index]?.type);
    // Split a replaced stretch matched one-for-one by count and type; a single block simply stays one run.
    if (run.kind === 'replace' && count === run.newEnd - run.newStart && sameTypes) {
      return Array.from({ length: count }, (_unused: unknown, index: number): MatchRun => ({ kind: 'replace', oldStart: run.oldStart + index, oldEnd: run.oldStart + index + 1, newStart: run.newStart + index, newEnd: run.newStart + index + 1 }));
    } else {
      return [run];
    }
  });

  interface ReplacementPlan {
    readonly range: OffsetRange;
    readonly text: string;
  }

  const plans: ReplacementPlan[] = [];

  // Walk all match runs to compute replacement plans for every 'replace' run.
  for (const run of runs) {
    // Check if the current run is a replace run.
    if (run.kind === 'replace') {
      // A single list replaced by a single list keeps the bytes of every item that did not change: only the
      // changed items are re-emitted. Without this an edit to one item rewrote its siblings in the configured style.
      // The one old child when this run replaces exactly one, else undefined.
      const oldOnly = run.oldEnd - run.oldStart === 1 ? oldChildren[run.oldStart] : undefined;
      // The one new child when this run replaces it with exactly one, else undefined.
      const newOnly = run.newEnd - run.newStart === 1 ? newChildren[run.newStart] : undefined;
      // A blockquote replaced by a blockquote likewise keeps its untouched blocks, and an edited item keeps its own (FR-4.2).
      const nesting = { used: false };
      const deps: ContainerSpliceDeps = {
        keyOf: structuralKey,
        runsOf: matchRuns,
        serializeNodes: serializeFragment,
        onNested: (): void => {
          nesting.used = true;
        },
      };
      let containerPlans: readonly ReplacementPlan[] | null;
      if (oldOnly !== undefined && newOnly !== undefined && oldOnly.type === 'list' && newOnly.type === 'list') {
        // Both sides are one list: plan item-level splices, or learn that the list must be rewritten whole.
        containerPlans = planListItems(original.text, oldOnly, newOnly, resolvedStyle, listSpliceDeps(original.text, resolvedStyle, deps));
      } else if (oldOnly !== undefined && newOnly !== undefined && oldOnly.type === 'blockquote' && newOnly.type === 'blockquote') {
        // Both sides are one blockquote: plan splices among its blocks.
        containerPlans = planBlockquote(original.text, oldOnly, newOnly, resolvedStyle, deps);
      } else {
        // Not a one-for-one container replacement: handled as a block below.
        containerPlans = null;
      }
      // Splices nested inside a container are checked against the whole block re-emitted: prefixes and spacing copied from
      // the source can, in rare shapes, change what the Markdown means, and a correct rewrite beats a wrong splice.
      if (containerPlans !== null && oldOnly !== undefined && newOnly !== undefined && (!nesting.used || splicesParseAlike(original.text, oldOnly, newOnly, containerPlans, resolvedStyle))) {
        // Splices inside the container are safe: use them instead of replacing the whole block.
        plans.push(...containerPlans);
        continue;
      } else {
        // The container's shape changed, its parts cannot be located, or the splice would read differently: replace it whole.
      }

      const oldSlice = oldChildren.slice(run.oldStart, run.oldEnd);
      let range: OffsetRange;

      // Check whether oldSlice is non-empty (replacing/deleting existing nodes) or empty (pure insertion).
      if (oldSlice.length > 0) {
        const firstNode = oldSlice[0];
        const lastNode = oldSlice[oldSlice.length - 1];

        const firstRange = firstNode !== undefined ? nodeRange(firstNode) : null;
        const lastRange = lastNode !== undefined ? nodeRange(lastNode) : null;

        // BAIL-OUT RULE: If ANY old child that needs a byte range has no position (nodeRange returns null),
        // the incremental path cannot know what to preserve. Do NOT guess and do NOT silently produce wrong output.
        // Fall back to a whole-document serialization. A caller can detect this by reusedBytes === 0,
        // and a correct-but-unminimal answer is always preferable to a minimal-but-wrong one.
        if (firstRange === null || lastRange === null) {
          return {
            text: serializeDocument(
              {
                text: original.text,
                root: updated,
                frontMatter: original.frontMatter,
              },
              resolvedStyle
            ),
            replacedRanges: [{ start: 0, end: original.text.length }],
            reusedBytes: 0,
            totalBytes: original.text.length,
          };
        } else {
          range = {
            start: firstRange.start,
            end: lastRange.end,
          };
        }
      } else {
        // Pure insertion: oldSlice is empty. Anchor it at a byte offset.
        let anchor: number;

        // Check whether insertion is at the beginning of the document (index 0) or after an existing node.
        if (run.oldStart === 0) {
          // Anchored at offset 0.
          anchor = 0;
        } else {
          // Anchored at the end offset of the preceding old child.
          const precedingNode = oldChildren[run.oldStart - 1];
          const precedingRange = precedingNode !== undefined ? nodeRange(precedingNode) : null;

          // Bail out if the preceding node lacks position metadata.
          if (precedingRange === null) {
            return {
              text: serializeDocument(
                {
                  text: original.text,
                  root: updated,
                  frontMatter: original.frontMatter,
                },
                resolvedStyle
              ),
              replacedRanges: [{ start: 0, end: original.text.length }],
              reusedBytes: 0,
              totalBytes: original.text.length,
            };
          } else {
            anchor = precedingRange.end;
          }
        }

        range = {
          start: anchor,
          end: anchor,
        };
      }

      // Serialize the replacement fragment for the new nodes slice.
      const newSlice = newChildren.slice(run.newStart, run.newEnd);
      const fragment = serializeFragment(newSlice, resolvedStyle);

      let splicedText: string;
      const isZeroWidth = range.start === range.end;

      // Check whether a non-empty fragment is being inserted at a zero-width anchor.
      if (fragment.length > 0 && isZeroWidth) {
        // Pure insertion produces text that must not be glued onto its neighbour.
        // Block-level Markdown requires a blank line between blocks; omitting it would silently
        // merge two paragraphs — a correctness bug, not a formatting one.
        if (range.start === 0) {
          // Anchored at offset 0: follow with blank line.
          splicedText = `${fragment}\n\n`;
        } else {
          // Anchored after preceding node: precede with blank line.
          splicedText = `\n\n${fragment}`;
        }
      } else {
        // Standard replacement or deletion: use fragment directly.
        splicedText = fragment;
      }

      plans.push({
        range,
        text: splicedText,
      });
    } else {
      // Keep run: nodes are preserved unchanged in source text.
    }
  }

  // Preserve replaced ranges in document sequence for the result interface.
  const replacedRanges: OffsetRange[] = [];
  let totalReplacedBytes = 0;

  for (const plan of plans) {
    replacedRanges.push(plan.range);
    totalReplacedBytes += (plan.range.end - plan.range.start);
  }

  // Sort replacement plans in DESCENDING order of range start.
  // Applying replacements from highest offset to lowest offset ensures earlier byte offsets
  // remain valid in the original string while later regions are rewritten.
  const sortedPlans = [...plans];
  sortedPlans.sort((a, b) => b.range.start - a.range.start);

  let resultText = original.text;
  for (const plan of sortedPlans) {
    const before = resultText.slice(0, plan.range.start);
    const after = resultText.slice(plan.range.end);
    resultText = `${before}${plan.text}${after}`;
  }

  const totalBytes = original.text.length;
  const reusedBytes = Math.max(0, totalBytes - totalReplacedBytes);

  return {
    text: resultText,
    replacedRanges,
    reusedBytes,
    totalBytes,
  };
}
