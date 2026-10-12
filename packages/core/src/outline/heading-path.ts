/**
 * @file heading-path.ts
 * @purpose Reconstructs the ancestor breadcrumb trail (a nested path of headings) for a character offset in a Markdown document's outline, powering FR-9.9 navigation breadcrumbs that show which sections lead to the active one.
 * @inputs entries - A readonly array of OutlineEntry records in document order; offset - A 0-based character offset into the source text identifying the active heading section.
 * @outputs readonly OutlineEntry[] - A frozen array of OutlineEntry items forming the breadcrumb path, outermost (shallowest) heading first; an empty frozen array when no heading precedes the offset.
 * @functions
 *   - headingPath: Finds the last heading at or before the offset and walks backwards to collect its strictly shallower ancestor headings into an ordered breadcrumb trail.
 * @dataflow OutlineEntry array + character offset → reverse scan selects deepest matching entry → backward walk collects strictly shallower ancestors until h1 → reversed list ordered shallow-to-deep → Object.freeze prevents mutation.
 * @controlflow Backward linear scan finds last entry with start <= offset (returns frozen [] if none) → seed path and depth from that entry → iterate earlier entries pushing any strictly shallower heading → reverse in place → return frozen array.
 * @version 1
 * @date 2026-09-13
 */

import type { OutlineEntry } from './outline.js';

/**
 * Reconstructs the breadcrumb path of ancestor headings for a character offset in a document outline.
 *
 * @purpose Finds the last heading whose section contains the offset and walks backwards through earlier headings, collecting only strictly shallower ones to form the nested breadcrumb trail from the top level down to the active heading.
 * @inputs entries - The readonly array of OutlineEntry records in document order; each entry's index equals its array position.
 * @inputs offset - The 0-based character offset into the source text whose containing section should be breadcrumbs.
 * @outputs readonly OutlineEntry[] - A frozen array running outermost (shallowest) heading first, ending at the active heading; an empty frozen array when no heading starts at or before the offset.
 * @dataflow entries + offset → reverse scan selects deepest matching entry → backward iteration pushes strictly shallower ancestors until h1 → reversed list ordered shallow-to-deep → Object.freeze prevents mutation.
 * @controlflow Backward loop locates last entry with start <= offset (returns frozen [] if none) → seed path and depth from that entry → forward-from-p-1 loop pushes entries whose depth is strictly less than the running depth, → reverse in place → return frozen array.
 */
export function headingPath(entries: readonly OutlineEntry[], offset: number): readonly OutlineEntry[] {
  // Step 1: Find the last entry whose section contains the offset by scanning backwards from the end.
  let startEntry: OutlineEntry | undefined = undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = entries[i];

    // Check if the candidate is defined and starts at or before the offset.
    if (candidate !== undefined && candidate.start <= offset) {
      // First match scanning backwards is the last entry whose section contains the offset: stop here.
      startEntry = candidate;
      break;
    } else {
      // Candidate starts after the offset: continue scanning toward earlier headings.
    }
  }

  // If no heading starts at or before the offset (empty array, or offset sits in a preamble), there is no breadcrumb trail.
  if (startEntry === undefined) {
    return Object.freeze([]);
  }

  // Step 2: Build the breadcrumb path backwards, from the deepest matching heading up to its ancestors.
  // The entry's index equals its array position per the outline contract, so it doubles as the scan origin.
  const start = startEntry.index;
  const path: OutlineEntry[] = [startEntry];
  let depth = startEntry.depth;

  for (let i = start - 1; i >= 0; i--) {
    const ancestor = entries[i];

    // Check if the ancestor is defined and strictly shallower than the current entry.
    if (ancestor !== undefined && ancestor.depth < depth) {
      // A shallower heading is an ancestor in the breadcrumb trail: include it and lower the reference depth.
      path.push(ancestor);
      depth = ancestor.depth;
    } else {
      // Ancestor is undefined or at/above the current depth (a sibling or descendant): skip it so two siblings never both appear.
    }
  }

  // Step 3: Reverse so the path runs outermost first, then freeze to prevent later mutation by callers.
  path.reverse();
  return Object.freeze(path);
}