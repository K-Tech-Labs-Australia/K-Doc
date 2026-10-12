/**
 * @file containers.ts
 * @purpose Plans byte splices inside a blockquote or a list item, so an edit to one block within it leaves the container's other blocks byte-identical (FR-4.2). Returning null tells the incremental serializer to re-serialize the whole container.
 * @inputs The original text, the old and new child arrays of a container, the container's line prefix, the Markdown style, and the incremental serializer's key/matching/serialization helpers plus an onNested callback.
 * @outputs SplicePlan records (a range of the original text and its replacement), or null when an incremental splice is impossible.
 * @functions
 *   - isAlertParagraph: Whether a node is a GitHub alert's opening [!KIND] paragraph.
 *   - listSpliceDeps: Builds ListSpliceDeps that delegate item splicing to planItemChildren.
 *   - planChildren: Plans per-block splices for a container's changed children, recursing into one-for-one nested containers.
 *   - planBlockquote: Plans splices inside a blockquote, guarding alert first-paragraph serialization.
 *   - planItemChildren: Plans splices inside a list item, guarding checkbox and spacing changes.
 * @dataflow old/new container children -> source ranges -> runsOf(child keys) -> per replaced run: recurse into nested container or re-serialize fragment with prefix -> plans.
 * @controlflow Refuse (null) when a child lacks a position, an alert's first block changed, or an item's checkbox/spacing changed; otherwise walk the runs planning replacement, deletion, or insertion and notify onNested on success.
 * @version 1
 * @date 2026-09-15
 */
import type { Blockquote, ListItem, RootContent } from 'mdast';
import type { MarkdownStyle } from '../style/markdown-style.js';
import { nodeRange, type OffsetRange } from '../position/map.js';
import { ALERT_MARKER_PATTERN } from './alert-marker.js';
import { planListItems, type ListSpliceDeps, type SplicePlan } from './list-items.js';
import { continuationPrefix, indentContinuation, itemContentPrefix } from './line-prefix.js';

export interface ContainerSpliceDeps {
  readonly keyOf: ListSpliceDeps['keyOf'];
  readonly runsOf: ListSpliceDeps['runsOf'];
  readonly serializeNodes: ListSpliceDeps['serializeNodes'];
  /** Told each time a container's children were spliced one level down, so the caller knows to check the result parses as intended. */
  readonly onNested: () => void;
}

/**
 * @purpose Determines whether a node is a GitHub alert's opening paragraph (one whose first text begins with [!KIND]).
 * @inputs node - The candidate block, or undefined when there is no block to test.
 * @outputs boolean - True when the node is an alert-opening paragraph that must sit first in a blockquote.
 * @dataflow node -> type check -> leading text value -> ALERT_MARKER_PATTERN.test on that value.
 * @controlflow Return false for a missing or non-paragraph node; otherwise return whether its first child is text matching the alert marker.
 */
function isAlertParagraph(node: RootContent | undefined): boolean {
  // A GitHub alert's first paragraph starts with [!KIND]; its serialization depends on sitting first in a blockquote.
  if (node === undefined || node.type !== 'paragraph') {
    // The node is absent or not a paragraph, so it cannot be an alert's opening text.
    return false;
  } else {
    // A paragraph node: inspect its leading text for an alert marker below.
  }

  const first = node.children[0];
  return (
    first !== undefined &&
    first.type === 'text' &&
    ALERT_MARKER_PATTERN.test(first.value)
  );
}

/**
 * @purpose Builds ListSpliceDeps that delegate item splicing to planItemChildren so nested list items are handled one level down.
 * @inputs text - The full source document; style - The active Markdown style; deps - The container's key, matching, serialization helpers and onNested callback.
 * @outputs A ListSpliceDeps whose shared helpers pass through verbatim and whose planItem delegates to planItemChildren.
 * @dataflow deps helpers + closure over text/style/deps -> a new ListSpliceDeps object.
 * @controlflow Copy the shared key/matching/serialization helpers verbatim and wrap planItemChildren as the item planner.
 */
export function listSpliceDeps(
  text: string,
  style: MarkdownStyle,
  deps: ContainerSpliceDeps,
): ListSpliceDeps {
  return {
    keyOf: deps.keyOf,
    runsOf: deps.runsOf,
    serializeNodes: deps.serializeNodes,
    planItem: (oldItem: ListItem, newItem: ListItem) =>
      planItemChildren(text, oldItem, newItem, style, deps),
  };
}

/**
 * @purpose Plans byte splices for a container's changed children, leaving unchanged blocks' bytes intact and recursing into one-for-one nested containers.
 * @inputs text - The full source document; oldChildren/newChildren - The aligned child arrays; prefix - The line prefix carried by continuation lines; style - The active Markdown style; deps - Key, matching, serialization helpers and onNested callback.
 * @outputs A readonly array of SplicePlan records, or null when an incremental splice is impossible.
 * @dataflow old children -> source ranges -> runsOf(child keys) -> per replaced run: nested container splice or re-serialized fragment with prefix -> plans.
 * @controlflow Refuse (null) when a child lacks a position; otherwise walk the runs planning replacement, deletion, or insertion and adopt inner nested-container splices.
 */
export function planChildren(
  text: string,
  oldChildren: readonly RootContent[],
  newChildren: readonly RootContent[],
  prefix: string,
  style: MarkdownStyle,
  deps: ContainerSpliceDeps,
): readonly SplicePlan[] | null {
  const ranges: OffsetRange[] = [];
  for (const child of oldChildren) {
    const range = nodeRange(child);
    if (range === null) {
      // The child has no source position, so its bytes cannot be preserved.
      return null;
    } else {
      // A valid range was found; record it for later span computation.
      ranges.push(range);
    }
  }

  const firstRange = ranges[0];
  const secondRange = ranges[1];
  // Blocks are spaced like the first two in the container; with only one, by a blank line carrying the prefix.
  const separator =
    firstRange !== undefined && secondRange !== undefined
      ? text.slice(firstRange.end, secondRange.start) // Spacing copied between the first two blocks.
      : `\n${prefix.trimEnd()}\n${prefix}`; // A single block is spaced by a blank line carrying the prefix.

  const runs = deps.runsOf(
    oldChildren.map((child) => deps.keyOf(child)),
    newChildren.map((child) => deps.keyOf(child)),
  );
  const plans: SplicePlan[] = [];
  for (const run of runs) {
    if (run.kind === 'keep') {
      // Unchanged block: keep its original bytes and skip planning.
      continue;
    } else {
      // A replaced stretch requires a splice plan below.
    }

    const oldOnly =
      run.oldEnd - run.oldStart === 1 ? oldChildren[run.oldStart] : undefined; // Exactly one old block: capture it, else nothing.
    const newOnly =
      run.newEnd - run.newStart === 1 ? newChildren[run.newStart] : undefined; // Exactly one new block: capture it, else nothing.

    // One nested container replaced by one of the same kind is spliced inside in turn.
    let inner: readonly SplicePlan[] | null = null;
    if (
      oldOnly !== undefined &&
      newOnly !== undefined &&
      oldOnly.type === 'blockquote' &&
      newOnly.type === 'blockquote'
    ) {
      // A one-for-one blockquote swap is spliced inside its own children.
      inner = planBlockquote(text, oldOnly, newOnly, style, deps);
    } else if (
      oldOnly !== undefined &&
      newOnly !== undefined &&
      oldOnly.type === 'list' &&
      newOnly.type === 'list'
    ) {
      // A one-for-one list swap is spliced item by item.
      inner = planListItems(
        text,
        oldOnly,
        newOnly,
        style,
        listSpliceDeps(text, style, deps),
      );
    } else {
      // Not a one-for-one nested container: the stretch is re-serialized below.
    }

    if (inner !== null) {
      // The inner splice succeeded; adopt its plans and skip whole-stretch work.
      plans.push(...inner);
      continue;
    } else {
      // No inner splice: re-serialize the entire replaced stretch.
    }

    const newSlice = newChildren.slice(run.newStart, run.newEnd);
    // The new blocks, with each line after the first carrying the container's prefix.
    const fragment =
      newSlice.length === 0
        ? '' // Nothing inserted: an empty replacement string.
        : indentContinuation(deps.serializeNodes(newSlice, style), prefix);

    // The first and last old block ranges spanned by this run bound the replacement text.
    const first = ranges[run.oldStart];
    const last = ranges[run.oldEnd - 1];

    if (run.oldEnd > run.oldStart && newSlice.length > 0) {
      // Replacement.
      if (first === undefined || last === undefined) {
        // The spanned bounds are out of range: refuse to plan a splice.
        return null;
      } else {
        // Replace every byte spanned by the old blocks with the new slice.
        plans.push({ range: { start: first.start, end: last.end }, text: fragment });
      }
    } else if (run.oldEnd > run.oldStart) {
      // Deletion takes one separator with it: the one after, or else the one before.
      const following = ranges[run.oldEnd];
      const preceding = ranges[run.oldStart - 1];
      if (first !== undefined && following !== undefined) {
        // A following block exists: delete from the first old block through it, consuming one separator.
        plans.push({ range: { start: first.start, end: following.start }, text: '' });
      } else if (preceding !== undefined && last !== undefined) {
        // Only a preceding block exists: delete from it through the last old block, consuming one separator.
        plans.push({ range: { start: preceding.end, end: last.end }, text: '' });
      } else {
        // No neighbour can absorb the deleted separator: refuse to plan a splice.
        return null;
      }
    } else {
      // Insertion, spaced like its neighbours.
      const before = ranges[run.oldStart];
      const after = ranges[run.oldStart - 1];
      if (before !== undefined) {
        // A block follows the insertion point: emit the new slice then a separator in front of it.
        plans.push({ range: { start: before.start, end: before.start }, text: fragment + separator });
      } else if (after !== undefined) {
        // The insertion is at the end: emit a separator then the new slice after the last block.
        plans.push({ range: { start: after.end, end: after.end }, text: separator + fragment });
      } else {
        // No neighbour exists to anchor the insertion: refuse to plan a splice.
        return null;
      }
    }
  }
  return plans;
}

/**
 * @purpose Plans byte splices inside a blockquote, guarding alert first-paragraph serialization so an alert is never partially spliced.
 * @inputs text - The full source document; oldQuote/newQuote - The aligned blockquote nodes; style - The active Markdown style; deps - Key, matching, serialization helpers and onNested callback.
 * @outputs A readonly array of SplicePlan records, or null when the quote must be re-serialized whole.
 * @dataflow first blocks -> alert check -> planChildren with continuation prefix -> plans + onNested notification.
 * @controlflow Refuse (null) for an empty quote, a missing position, or a changed alert first block; otherwise splice children and call onNested on success.
 */
export function planBlockquote(
  text: string,
  oldQuote: Blockquote,
  newQuote: Blockquote,
  style: MarkdownStyle,
  deps: ContainerSpliceDeps,
): readonly SplicePlan[] | null {
  const firstOld = oldQuote.children[0];
  const firstRange = firstOld === undefined ? null : nodeRange(firstOld);

  // An empty quote (no first block, so no range), or one without positions, has nothing to keep.
  if (firstRange === null) {
    // The quote is empty or its first block lacks a position: refuse to plan a splice.
    return null;
  } else {
    // A first block with a valid range exists; proceed.
  }

  const firstNew = newQuote.children[0];

  // An alert marker is only written unescaped as the quote's first paragraph, so a changed first block of an alert is re-serialized with the quote.
  if (
    (isAlertParagraph(firstOld) || isAlertParagraph(firstNew)) &&
    (firstNew === undefined || deps.keyOf(firstOld) !== deps.keyOf(firstNew))
  ) {
    // The quote is an alert and its first block changed: re-serialize the whole quote.
    return null;
  } else {
    // No alert, or the alert's first block is unchanged: splice its children below.
  }

  const plans = planChildren(
    text,
    oldQuote.children,
    newQuote.children,
    continuationPrefix(text, firstRange.start),
    style,
    deps,
  );
  if (plans !== null) {
    // The children were spliced one level down; notify the caller.
    deps.onNested();
  } else {
    // The children could not be spliced: the caller re-serializes the whole quote.
  }
  return plans;
}

/**
 * @purpose Plans byte splices inside a list item's blocks, leaving the checkbox and item spacing written on the item's own lines untouched.
 * @inputs text - The full source document; oldItem/newItem - The aligned list-item nodes; style - The active Markdown style; deps - Key, matching, serialization helpers and onNested callback.
 * @outputs A readonly array of SplicePlan records, or null when the item must be re-serialized whole.
 * @dataflow checkbox/spacing checks -> source range -> planChildren with item content prefix -> plans + onNested notification.
 * @controlflow Refuse (null) when the checkbox changed or the item lacks a position; otherwise splice children and call onNested on success.
 */
export function planItemChildren(
  text: string,
  oldItem: ListItem,
  newItem: ListItem,
  style: MarkdownStyle,
  deps: ContainerSpliceDeps,
): readonly SplicePlan[] | null {
  // The checkbox and the item's own spacing are written on the item's lines, not in its blocks.
  if ((oldItem.checked ?? null) !== (newItem.checked ?? null)) {
    // The checked state changed: re-serialize the whole item so its marker line is rewritten.
    return null;
  } else {
    // Both items share the same checkbox state; proceed.
  }

  // A change of the item's spacing needs no check here: it changes the list's spacing too, which planListItems refuses first.

  const itemRange = nodeRange(oldItem);

  // An item without a position has nothing to keep. An item with no blocks needs no check: planChildren refuses it.
  if (itemRange === null) {
    // The item lacks a position or has no blocks: refuse to plan a splice.
    return null;
  } else {
    // A positioned item with blocks exists; proceed.
  }

  const plans = planChildren(
    text,
    oldItem.children,
    newItem.children,
    itemContentPrefix(text, itemRange.start),
    style,
    deps,
  );
  if (plans !== null) {
    // The children were spliced one level down; notify the caller.
    deps.onNested();
  } else {
    // The children could not be spliced: the caller re-serializes the whole item.
  }
  return plans;
}
