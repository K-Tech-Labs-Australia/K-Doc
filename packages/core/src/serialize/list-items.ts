/**
 * @file list-items.ts
 * @purpose Plans byte splices for the items of a list (top-level or nested) whose content changed, so an edit to one item leaves every other item's bytes untouched (FR-4.2). Returning null tells the incremental serializer to rewrite the whole list, as it did before.
 * @inputs The original text, the old and new list nodes, the Markdown style, and the incremental serializer's own key, matching and fragment helpers.
 * @outputs SplicePlan records (a range of the original text and its replacement), or null.
 * @functions
 *   - planListItems: Aligns the two lists' items and plans a splice for each changed stretch.
 *   - numberAt: The number an ordered item re-emitted for a stretch should carry.
 *   - serializeItems: Serializes items as a list with the original list's marker.
 * @dataflow old/new list -> shape check -> item ranges and marker from the source -> runsOf(item keys) -> per replaced run: fragment + range -> plans.
 * @controlflow Refuse (null) when the list's shape changed, an item has no position, or the marker cannot be reproduced; otherwise walk the runs, planning a replacement, a deletion that takes one separator, or an insertion spaced like its neighbours.
 * @version 2
 * @date 2026-09-15
 */
import type { List, ListItem, RootContent } from 'mdast';
import type { MarkdownStyle } from '../style/markdown-style.js';
import { nodeRange, type OffsetRange } from '../position/map.js';
import { listMarker } from './list-marker.js';
import { continuationPrefix, indentContinuation } from './line-prefix.js';

/** A contiguous run of aligned items between the old and new lists. */
export interface ItemRun { readonly oldStart: number; readonly oldEnd: number; readonly newStart: number; readonly newEnd: number; readonly kind: 'keep' | 'replace'; }
/** A range of the original text to replace with a replacement string. */
export interface SplicePlan { readonly range: OffsetRange; readonly text: string; }
/** The incremental serializer's helpers needed to align items and serialize fragments. */
export interface ListSpliceDeps {
  readonly keyOf: (node: unknown) => string;
  readonly runsOf: (oldKeys: readonly string[], newKeys: readonly string[]) => readonly ItemRun[];
  readonly serializeNodes: (nodes: readonly RootContent[], style: MarkdownStyle) => string;
  /** Plans splices inside one item replaced by one, keeping its untouched blocks; null (or absent) re-emits the item whole. */
  readonly planItem?: (oldItem: ListItem, newItem: ListItem) => readonly SplicePlan[] | null;
}

/**
 * @purpose Plans byte splices that transform the old list's items into the new list's, leaving untouched items' bytes intact.
 * @inputs text - The full source document; oldList/newList - The aligned list nodes; style - The active Markdown style; deps - Key, matching, and serialization helpers.
 * @outputs A readonly array of SplicePlan records, or null when an incremental splice is impossible.
 * @dataflow old/new list -> shape checks -> item ranges and marker from the source -> runsOf(item keys) -> per replaced run: fragment + range -> plans.
 * @controlflow Refuse (null) when the list's shape changed, an item has no position, or the marker cannot be reproduced; otherwise walk the runs, planning a replacement, a deletion that takes one separator, or an insertion spaced like its neighbours.
 */
export function planListItems(text: string, oldList: List, newList: List, style: MarkdownStyle, deps: ListSpliceDeps): readonly SplicePlan[] | null {
  // A change between bullet and ordered needs no check of its own: a bullet list has no start and an ordered list
  // always has one, so the start comparison below refuses it.

  // The tight/loose spacing changed between the two lists.
  if ((oldList.spread ?? false) !== (newList.spread ?? false)) {
    // Tight/loose state changed: refuse to plan a splice.
    return null;
  } else {
    // Both lists share the same spread state; proceed.
  }

  // The starting number of an ordered list changed.
  if ((oldList.start ?? null) !== (newList.start ?? null)) {
    // Numbering start changed: refuse to plan a splice.
    return null;
  } else {
    // Both lists share the same start value; proceed.
  }

  const oldItems: readonly ListItem[] = oldList.children;
  const newItems: readonly ListItem[] = newList.children;

  // An empty list needs no check here: a parsed list always has an item, and a new list emptied of every item
  // plans a deletion with no neighbour to take the separator, which returns null below.

  const ranges: OffsetRange[] = [];
  for (const item of oldItems) {
    const range = nodeRange(item);
    // The item has no position in the source text, so its bytes cannot be preserved.
    if (range === null) {
      // An item lacks a source position: refuse to plan a splice.
      return null;
    } else {
      // The item has a valid range; record it for later marker extraction.
      ranges.push(range);
    }
  }

  const firstRange = ranges[0];
  // The first range is always defined because oldItems is non-empty (checked above).
  if (firstRange === undefined) {
    // No usable item range: refuse to plan a splice.
    return null;
  } else {
    // The first item's range anchors the list marker extraction.
  }

  const marker = listMarker(text, firstRange.start);
  // The source text does not contain a recognizable list marker at the item's start.
  if (marker === null) {
    // No reproducible marker: refuse to plan a splice.
    return null;
  } else {
    // A bullet or ordered marker was found and will be reused for serialization.
  }

  // A different bullet or delimiter would start a new list, so pin the style to the found marker.
  const itemStyle: MarkdownStyle = marker.kind === 'bullet' ? { ...style, bullet: marker.marker } : { ...style, orderedListDelimiter: marker.delimiter };
  // What each re-emitted line after the first carries: '> ' for a list in a blockquote, spaces for a nested list, nothing at the top level.
  const outerPrefix = continuationPrefix(text, firstRange.start);
  // Read once here: the helpers below are closures, where the null check on `marker` above does not carry.
  const isBullet = marker.kind === 'bullet';
  // The number on the list's first item, from which positions are counted when an item's own number is unreadable.
  const firstNumber = marker.kind === 'ordered' ? marker.number : 1;

  const secondRange = ranges[1];
  // Prefer the exact whitespace between the first two items. A one-item list has none to copy, and is never loose
  // (looseness is a blank line between items), so its next item follows on the next line.
  const separator = secondRange !== undefined ? text.slice(firstRange.end, secondRange.start) : `\n${outerPrefix}`;

  /**
   * @purpose Determines the number an ordered item re-emitted for a stretch should carry.
   * @inputs index - The position of the old item whose marker is being read.
   * @outputs The number written on that item, or a number counted on from the list's first marker.
   * @dataflow index -> source range at that index -> parsed ordered marker's number, or a computed fallback.
   * @controlflow Read the marker at the given old position; if it is an ordered item use its own number, else derive from the new list's start.
   */
  function writtenNumber(index: number): number {
    const range = ranges[index];
    // Read the marker at this position, or null when the index is out of range.
    const found = range === undefined ? null : listMarker(text, range.start);
    // Prefer the marker already present in the source; fall back to a computed sequence number.
    if (found !== null && found.kind === 'ordered') {
      // The old item is an ordered item: reuse its own starting number.
      return found.number;
    } else {
      // No usable ordered marker at this position: derive the number from the list start or default to one.
      return firstNumber + index;
    }
  }

  /**
   * @purpose Computes the ordered number for a run, or undefined when the list is bulleted.
   * @inputs run - The aligned item run being serialized.
   * @outputs The number to emit for an ordered list, or undefined for a bullet list.
   * @dataflow run bounds -> old position(s) -> writtenNumber or the marker's own start number.
   * @controlflow Return undefined for bullets; otherwise pick the number of the first surviving item, the item after a deletion, or the list's start for a leading insertion.
   */
  function numberAt(run: ItemRun): number | undefined {
    // Bulleted lists carry no numbers, so serialization omits them entirely.
    if (isBullet) {
      return undefined;
    } else if (run.oldEnd > run.oldStart) {
      // A replacement keeps at least one old item: reuse its own number.
      return writtenNumber(run.oldStart);
    } else if (run.oldStart > 0) {
      // An insertion after an existing item: continue the sequence after that item.
      return writtenNumber(run.oldStart - 1) + 1;
    } else {
      // An insertion at the very start takes the first item's number.
      return firstNumber;
    }
  }

  /**
   * @purpose Renders a list of items using the original list's recovered marker and spacing.
   * @inputs items - The items to serialize; start - The ordered number for the first item, if any.
   * @outputs The serialized Markdown text for the synthetic list node.
   * @dataflow items + start -> synthetic List node -> serializeNodes with the pinned item style.
   * @controlflow Build a temporary list node carrying the new list's shape and optional start, then delegate serialization to the injected helper.
   */
  function serializeItems(items: readonly ListItem[], start: number | undefined): string {
    // A synthetic list reuses the new list's ordered/spread flags so nested structure is preserved; omit start for bullet lists.
    const synthetic: List = { type: 'list', ordered: newList.ordered, spread: newList.spread, children: [...items], ...(start === undefined ? {} : { start }) };
    return indentContinuation(deps.serializeNodes([synthetic], itemStyle), outerPrefix);
  }

  const runs = deps.runsOf(oldItems.map((item) => deps.keyOf(item)), newItems.map((item) => deps.keyOf(item)));
  const plans: SplicePlan[] = [];
  for (const run of runs) {
    // Unchanged items keep their original bytes and need no splice.
    if (run.kind === 'keep') {
      // Untouched item: skip planning so its bytes remain valid.
      continue;
    } else {
      // A replaced stretch requires a splice plan below.
    }

    const newSlice = newItems.slice(run.newStart, run.newEnd);
    // One item replaced by one keeps the bytes of its untouched blocks (a nested list, a second paragraph) when it can.
    const oldOne = run.oldEnd - run.oldStart === 1 ? oldItems[run.oldStart] : undefined;
    const newOne = newSlice.length === 1 ? newSlice[0] : undefined;
    const inner = oldOne !== undefined && newOne !== undefined && deps.planItem !== undefined ? deps.planItem(oldOne, newOne) : null;
    if (inner !== null) {
      // The item's blocks were spliced: its marker line and untouched blocks stay as written.
      plans.push(...inner);
      continue;
    } else {
      // Not one-for-one, or the item itself changed: it is re-emitted below.
    }
    // Serialize the new items as a list fragment, or an empty string when the whole stretch was deleted.
    const fragment = newSlice.length === 0 ? '' : serializeItems(newSlice, numberAt(run));
    // The first and last old item ranges spanned by this run bound the replacement text.
    const first = ranges[run.oldStart];
    const last = ranges[run.oldEnd - 1];

    // A replacement keeps at least one old item and produces new content for it.
    if (run.oldEnd > run.oldStart && newSlice.length > 0) {
      // Replacement: both source items exist because the run bounds are in range.
      if (first === undefined || last === undefined) {
        // Item bounds are out of range despite the length check: refuse to plan a splice.
        return null;
      } else {
        // Replace every byte spanned by the old items with the new slice's serialization.
        plans.push({ range: { start: first.start, end: last.end }, text: fragment });
      }
    } else if (run.oldEnd > run.oldStart) {
      // Deletion: old items are removed and nothing replaces them.
      const following = ranges[run.oldEnd];
      const preceding = ranges[run.oldStart - 1];
      if (first !== undefined && following !== undefined) {
        // A following item exists: delete from the first old item through it, consuming one separator.
        plans.push({ range: { start: first.start, end: following.start }, text: '' });
      } else if (preceding !== undefined && last !== undefined) {
        // Only a preceding item exists: delete from it through the last old item, consuming one separator.
        plans.push({ range: { start: preceding.end, end: last.end }, text: '' });
      } else {
        // Neither neighbour is available to absorb the separator: refuse to plan a splice.
        return null;
      }
    } else {
      // Insertion: no old items are removed, so spacing like the neighbours keeps the list tidy.
      // The old item the insertion goes directly in front of (its start is the splice point).
      const before = ranges[run.oldStart];
      // The old item the insertion follows (its end is the splice point).
      const after = ranges[run.oldStart - 1];
      if (before !== undefined) {
        // An old item follows the insertion point: emit the new slice, then a separator, in front of it.
        plans.push({ range: { start: before.start, end: before.start }, text: fragment + separator });
      } else if (after !== undefined) {
        // The insertion is at the end: emit a separator, then the new slice, after the last item.
        plans.push({ range: { start: after.end, end: after.end }, text: separator + fragment });
      } else {
        // The list is empty on both sides: refuse to plan a splice.
        return null;
      }
    }
  }
  return plans;
}
