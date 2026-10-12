/**
 * @file lint-finding.ts
 * @purpose Shared types and helpers for the K-Doc document linting rules (FR-12.7): finding/edit/fix records plus text-offset, line-number, node-text, tree-walk, and range utilities.
 * @inputs LintEdit/LintFix/LintFinding values produced by lint rules; an mdast-shaped LintNode tree; raw document text and character offsets for offset/line conversions.
 * @outputs Normalized edit-application result strings; 1-based line numbers; concatenated node text; nodes delivered through a traversal callback; node position ranges.
 * @functions
 *   - applyLintEdits: Apply a sorted, validated set of edits to produce the corrected document text.
 *   - lineNumberAt: Convert a clamped character offset into a 1-based line number.
 *   - nodeText: Recursively extract the textual content of an mdast-shaped node.
 *   - walkNodes: Depth-first pre-order traversal calling visit for every node.
 *   - nodeRange: Return a node's {from, to} source offsets or null when unavailable.
 * @dataflow Lint rules emit findings and edits → applyLintEdits rewrites text; offset/line helpers translate positions; node helpers read the mdast tree → callers render diagnostics and quick fixes.
 * @controlflow Module exports immutable types plus pure functions; each function validates inputs, transforms data with explicit branches, and returns without side effects.
 * @version 1
 * @date 2026-09-14
 */

export type LintRuleId = 'heading-skip' | 'duplicate-heading' | 'empty-link' | 'malformed-table' | 'missing-image' | 'broken-anchor';

/** One replacement in the document text, in source offsets of the text the finding was computed from. */
export interface LintEdit { readonly from: number; readonly to: number; readonly insert: string; }

/** A quick fix: what the button says, and the edits it applies together as one change. */
export interface LintFix { readonly label: string; readonly edits: readonly LintEdit[]; }

export interface LintFinding {
  readonly rule: LintRuleId;
  /** The offending thing, briefly: a heading's text, a link's text, an image address, or 'Table, line 12'. */
  readonly label: string;
  /** What is wrong with it, in a sentence fragment. */
  readonly message: string;
  /** Start offset of the offending span in the document text. */
  readonly from: number;
  /** End offset (exclusive). */
  readonly to: number;
  /** The quick fix, or null when there is none. */
  readonly fix: LintFix | null;
}

/** A node of any mdast tree, read structurally. */
export interface LintNode {
  readonly type: string;
  readonly value?: unknown;
  readonly children?: readonly LintNode[];
  readonly position?: { readonly start: { readonly offset?: number }; readonly end: { readonly offset?: number } };
}

/**
 * @purpose Apply a set of non-overlapping text edits to produce corrected document text.
 * @inputs text - The original document text the offsets refer to.
 *   edits - A list of {from, to, insert} replacements in source offsets of `text`.
 * @outputs The reconstructed document string with all edits applied left-to-right.
 * @dataflow Input edits → sorted by offset → range-validated then overlap-validated → spliced into text via cursor advancement → returned string.
 * @controlflow Copy and sort edits; validate each edit's range then its non-overlap; build the result by appending untouched spans and inserts; append trailing text.
 */
export function applyLintEdits(text: string, edits: readonly LintEdit[]): string {
  // Copy then sort edits so they can be applied left-to-right without index drift.
  const sorted = [...edits].sort((a, b) => {
    // Primary ordering key: ascending from offset.
    if (a.from !== b.from) {
      return a.from - b.from;
    } else {
      // Equal from offsets tie-break on ascending to offset.
      return a.to - b.to;
    }
  });

  // Bounds are checked before overlap, so a negative start is reported as out of range rather than as an overlap
  // with the document's start.
  for (const edit of sorted) {
    // Reject edits whose offsets fall outside the document text bounds.
    if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) {
      throw new RangeError('Lint edit out of range');
    } else {
      // Offsets are valid; continue to the next edit without mutation.
    }
  }

  let previousTo = 0;
  for (const edit of sorted) {
    // Reject edits whose start precedes the end of the previously accepted edit.
    if (edit.from < previousTo) {
      throw new RangeError('Lint edits overlap');
    } else {
      // No overlap with prior edit; record this edit's end as the new boundary.
      previousTo = edit.to;
    }
  }

  let cursor = 0;
  let result = '';
  for (const edit of sorted) {
    // Append untouched text before the edit, then the replacement insert.
    result += text.slice(cursor, edit.from);
    result += edit.insert;
    // Advance the cursor past the replaced span to the next edit boundary.
    cursor = edit.to;
  }

  // Append any trailing text after the final edit.
  result += text.slice(cursor);
  return result;
}

/**
 * @purpose Convert a character offset into a 1-based line number within the document.
 * @inputs text - The document text whose newlines delimit lines.
 *   offset - A character offset, clamped to [0, text.length] before counting.
 * @outputs The 1-based line number containing (or preceding) the offset.
 * @dataflow Clamped offset → sliced prefix → newline count → 1 + count returned.
 * @controlflow Clamp offset; iterate the prefix counting '\n'; return 1 plus that count.
 */
export function lineNumberAt(text: string, offset: number): number {
  // Clamp a negative offset to 0: slice would otherwise count it back from the end. An offset past the end
  // needs no clamp, because slice stops at the end on its own.
  const clampedOffset = Math.max(0, offset);
  // Count newline characters in the prefix to derive the 1-based line number.
  let newlines = 0;
  for (const char of text.slice(0, clampedOffset)) {
    // Increment only on a newline character within the sliced prefix.
    if (char === '\n') {
      newlines += 1;
    } else {
      // Non-newline character: leave the counter unchanged.
    }
  }
  return 1 + newlines;
}

/**
 * @purpose Extract the plain-text content of an mdast-shaped node.
 * @inputs node - A LintNode whose value or children hold textual content.
 * @outputs The concatenated text represented by the node and its descendants.
 * @dataflow Node → leaf value or recursive child concatenation → returned string.
 * @controlflow Return `value` for text/inlineCode leaves; else recurse over children; else return empty string.
 */
export function nodeText(node: LintNode): string {
  // Leaf case: text-like nodes carry their content directly in `value`.
  if (typeof node.value === 'string' && (node.type === 'text' || node.type === 'inlineCode')) {
    return node.value;
  } else {
    // Not a text-like leaf; decide whether to descend into child nodes.
    if (node.children) {
      // Composite case: concatenate the rendered text of every child node.
      let combined = '';
      for (const child of node.children) {
        combined += nodeText(child);
      }
      return combined;
    } else {
      // Fallback: no value and no children, so there is no textual content.
      return '';
    }
  }
}

/**
 * @purpose Traverse an mdast-shaped tree in depth-first pre-order.
 * @inputs root - The starting LintNode of the traversal.
 *   visit - A callback invoked once per node during traversal.
 * @outputs void; observable effects occur through the `visit` callback.
 * @dataflow Root → visit(root) → recurse into each child subtree in order.
 * @controlflow Call visit on the current node, then iterate children recursing into each.
 */
export function walkNodes(root: LintNode, visit: (node: LintNode) => void): void {
  // Pre-order: visit the current node before descending into its children.
  visit(root);
  // Guard against nodes that carry no child list.
  if (root.children) {
    for (const child of root.children) {
      walkNodes(child, visit);
    }
  } else {
    // No children present; this is a leaf and recursion stops here.
  }
}

/**
 * @purpose Read a node's source-character range from its position metadata.
 * @inputs node - A LintNode optionally carrying start/end offsets in `position`.
 * @outputs {from, to} offsets when both are present, otherwise null.
 * @dataflow Node.position → start/end offsets → guarded number check → returned range or null.
 * @controlflow Read both offsets via optional chaining; return a range only if both are numbers; else null.
 */
export function nodeRange(node: LintNode): { readonly from: number; readonly to: number } | null {
  // Read the start offset, tolerating an absent position or start field.
  const startOffset = node.position?.start.offset;
  // Read the end offset, tolerating an absent position or end field.
  const endOffset = node.position?.end.offset;
  // Only return a range when both offsets are present as numbers.
  if (typeof startOffset === 'number' && typeof endOffset === 'number') {
    return { from: startOffset, to: endOffset };
  } else {
    // Missing or non-numeric offset(s): no usable range can be reported.
    return null;
  }
}
