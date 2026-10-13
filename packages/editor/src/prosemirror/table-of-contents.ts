/**
 * @file table-of-contents.ts
 * @purpose Inserts and refreshes a table of contents (FR-8.30) inside a K-Doc document, operating on raw HTML marker blocks that delimit an auto-generated outline list.
 * @inputs ProseMirror document state; heading nodes and raw HTML unknownBlock nodes already present in the document.
 * @outputs Boolean guards and ProseMirror Commands that mutate the document via dispatched transactions.
 * @functions
 *   - htmlValue: Returns the mdast html string held by an unknownBlock node, or null for any other node.
 *   - documentHeadings: Collects the document's top-level headings in order as outline entries.
 *   - findTableOfContents: Locates the first start/end marker pair and returns its range and depth.
 *   - contentsFragment: Builds the list (optionally wrapped in markers) for the current headings at a depth.
 *   - hasTableOfContents: Reports whether the document already contains a table of contents.
 *   - insertTableOfContents: Returns a Command that inserts a fresh table of contents at the caret.
 *   - refreshTableOfContents: Returns a Command that rewrites an existing list from the current headings.
 * @dataflow Document nodes → htmlValue/documentHeadings → tocItems/tocList → mdastToProseMirror → ProseMirror Fragment → Transaction dispatch.
 * @controlflow Commands validate state (depth, presence, non-empty) with early returns, then build a fragment and dispatch a structural transaction; dry runs skip dispatch.
 * @version 1
 * @date 2026-09-15
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from 'prosemirror-model';
import type { RootContent } from 'mdast';
import { isTocEnd, parseTocStart, tocItems, tocList, tocStartMarker, TOC_END_MARKER, type TocHeading } from '@k-doc/core';
import { mdastToProseMirror } from './from-mdast.js';

/**
 * The span of a table of contents within the document.
 */
export interface TocRange {
  /** Position just after the start marker block, where the list begins. */
  readonly from: number;
  /** Position of the end marker block, where the list ends. */
  readonly to: number;
  readonly depth: number;
}

/**
 * @purpose Extracts the mdast html string stored in an unknownBlock node's `node` attribute, or returns null for any other node type.
 * @inputs node - The ProseMirror node to inspect.
 * @outputs string | null - The raw HTML value when the node holds an mdast html node; otherwise null.
 * @dataflow Node attributes → held mdast object → validated html value string.
 * @controlflow Rejects non-unknownBlock nodes, then validates that the held object is an mdast html node with a string value before returning it.
 */
function htmlValue(node: ProseMirrorNode): string | null {
  // Only a raw HTML block holds an mdast html node in its `node` attribute; any other node has no such attribute, so the
  // shape check alone tells them apart.
  const held: unknown = node.attrs['node'];
  if (typeof held === 'object' && held !== null && 'type' in held && 'value' in held && held.type === 'html' && typeof held.value === 'string') {
    // The block holds an mdast html node with a string value.
    return held.value;
  } else {
    // Not a raw HTML block, or one holding something other than HTML.
    return null;
  }
}

/**
 * @purpose Collects the document's top-level headings in document order as outline entries.
 * @inputs doc - The root ProseMirror document whose headings are enumerated.
 * @outputs TocHeading[] - Ordered heading entries with their depth and text content.
 * @dataflow Document children → heading nodes → TocHeading records.
 * @controlflow Iterates top-level children, pushing a TocHeading for each heading node and skipping everything else.
 */
export function documentHeadings(doc: ProseMirrorNode): TocHeading[] {
  // Accumulate the outline entries as they are discovered.
  const headings: TocHeading[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'heading') {
      // A heading node; resolve its level (defaulting to 1 when unset).
      const level: unknown = node.attrs['level'];
      let depthLevel: number;
      if (typeof level === 'number') {
        // The heading carries a numeric level attribute.
        depthLevel = level;
      } else {
        // No usable level attribute; fall back to the top heading level.
        depthLevel = 1;
      }
      headings.push({ depth: depthLevel, text: node.textContent });
    } else {
      // Not a heading node; skip it.
    }
  });
  return headings;
}

/**
 * @purpose Locates the first table of contents in the document, delimited by a start marker followed later by an end marker at the top level.
 * @inputs doc - The root ProseMirror document to search.
 * @outputs TocRange | null - The range and depth of the first table of contents, or null when no markers are found.
 * @dataflow Document children → htmlValue/parseTocStart/isTocEnd → start/end positions combined into a TocRange.
 * @controlflow Walks top-level nodes with a running offset, records the position after the start marker, and closes the range at the end marker before breaking.
 */
export function findTableOfContents(doc: ProseMirrorNode): TocRange | null {
  // The start marker's trailing position and depth, seen so far.
  let start: { readonly from: number; readonly depth: number } | null = null;
  // The located range, or null while still searching.
  let found: TocRange | null = null;
  // Running offset of the current top-level node within the document.
  let offset = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    // A node that is not a raw HTML block reads as empty HTML, which is neither marker.
    const html = htmlValue(node) ?? '';
    const depth = parseTocStart(html);
    if (start === null && depth !== null) {
      // Record the position just after the start marker and its depth.
      start = { from: offset + node.nodeSize, depth };
    } else if (start !== null && isTocEnd(html)) {
      // Found the end marker; close out the range and stop searching.
      found = { from: start.from, to: offset, depth: start.depth };
      break;
    } else {
      // Another block, a start marker after the first, or an end marker with no start before it.
    }
    offset += node.nodeSize;
  }
  return found;
}

/**
 * @purpose Builds the ProseMirror block fragment for the document's outline list at a given depth, optionally wrapped in fresh markers.
 * @inputs schema - The document schema used to build blocks. doc - The source document whose headings are listed. depth - Maximum heading level to include. withMarkers - Whether to wrap the list in start/end marker blocks.
 * @outputs Fragment - The assembled block fragment (empty when there are no listed headings).
 * @dataflow Headings → tocItems/tocList → mdast root content → mdastToProseMirror → ProseMirror Fragment.
 * @controlflow Optionally pushes a start marker, always pushes the list when items exist, then optionally pushes an end marker before conversion.
 */
function contentsFragment(schema: Schema, doc: ProseMirrorNode, depth: number, withMarkers: boolean): Fragment {
  // The outline entries at the requested depth.
  const items = tocItems(documentHeadings(doc), depth);
  // The mdast root children that will be converted into blocks.
  const blocks: RootContent[] = [];
  if (withMarkers) {
    // Wrap the list in a fresh start marker.
    blocks.push({ type: 'html', value: tocStartMarker(depth) });
  } else {
    // The document already holds its own markers; emit none here.
  }
  if (items.length > 0) {
    // There are headings to list; append the list block.
    blocks.push(tocList(items));
  } else {
    // Nothing to list; leave the array without a list node.
  }
  if (withMarkers) {
    // Append the end marker after the list.
    blocks.push({ type: 'html', value: TOC_END_MARKER });
  } else {
    // The document already holds its own markers; emit none here.
  }
  // Nothing to write (a refresh with no listed headings): converting an empty tree would give an empty paragraph, since a
  // document must hold a block, and that paragraph would appear between the markers.
  if (blocks.length === 0) {
    return Fragment.empty;
  } else {
    return mdastToProseMirror({ type: 'root', children: blocks }, schema).content;
  }
}

/**
 * @purpose Reports whether the document already contains a table of contents.
 * @inputs state - The current editor state whose document is inspected.
 * @outputs boolean - true when a start/end marker pair exists; otherwise false.
 * @dataflow state.doc → findTableOfContents → null check result.
 * @controlflow Returns true when findTableOfContents yields a range, and false when it returns null.
 */
export function hasTableOfContents(state: EditorState): boolean {
  const range = findTableOfContents(state.doc);
  if (range !== null) {
    // A table of contents exists in the document.
    return true;
  } else {
    // No table of contents markers were found.
    return false;
  }
}

/**
 * @purpose Factory that produces a Command inserting a fresh table of contents at the caret.
 * @inputs depth - The maximum heading level (1..6) to include in the inserted list.
 * @outputs Command - A ProseMirror command enforcing depth, presence, and non-empty guards before dispatching an insert transaction.
 * @dataflow depth + state.doc → guard checks → contentsFragment → Slice → Transaction.
 * @controlflow Validates inputs with early returns, then builds a marker-wrapped fragment and dispatches it when a dispatcher is present.
 */
export function insertTableOfContents(depth: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    /**
     * @purpose Executes the insert command, validating state and dispatching a transaction that places a marker-wrapped list at the selection.
     * @inputs state - The current editor state. dispatch - Optional callback receiving the composed transaction.
     * @outputs boolean - true when the insert is valid (and dispatched); false when any guard fails.
     * @dataflow state.doc → contentsFragment(depth, withMarkers=true) → Slice → tr.replaceSelection → dispatch(tr).
     * @controlflow Guards depth/presence/non-empty with early returns, then builds and dispatches a structural transaction or no-ops on dry run.
     */
    // Below 1 needs no check of its own: no heading is that shallow, so the empty-list check below refuses it.
    if (!Number.isInteger(depth) || depth > 6) {
      // The requested depth is not an integer heading level up to 6.
      return false;
    } else {
      // A valid integer heading level between 1 and 6 was supplied.
    }
    if (findTableOfContents(state.doc) !== null) {
      // The document already contains a table of contents to refresh instead.
      return false;
    } else {
      // No table of contents is present yet.
    }
    if (tocItems(documentHeadings(state.doc), depth).length === 0) {
      // There are no headings at the requested depth to list.
      return false;
    } else {
      // At least one heading qualifies for the list.
    }
    if (dispatch !== undefined) {
      // Apply the change by inserting a marker-wrapped fragment at the selection.
      const tr = state.tr.replaceSelection(new Slice(contentsFragment(state.schema, state.doc, depth, true), 0, 0));
      tr.setMeta('kdocStructural', true);
      dispatch(tr);
    } else {
      // Dry run: no transaction is dispatched.
    }
    return true;
  };
}

/**
 * @purpose Factory that produces a Command rewriting an existing table of contents from the current headings.
 * @inputs Nothing beyond editor state; the depth is taken from the document's start marker.
 * @outputs Command - A ProseMirror command enforcing presence and staleness guards before dispatching a rewrite transaction.
 * @dataflow state.doc → findTableOfContents → contentsFragment(range.depth, withMarkers=false) → tr.replaceWith → dispatch(tr).
 * @controlflow Guards presence and "already up to date" with early returns, then rewrites the in-between list when a dispatcher is present.
 */
export function refreshTableOfContents(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    /**
     * @purpose Executes the refresh command, validating state and dispatching a transaction that replaces the list between the markers.
     * @inputs state - The current editor state. dispatch - Optional callback receiving the composed transaction.
     * @outputs boolean - true when a rewrite is warranted (and dispatched); false when any guard fails.
     * @dataflow state.doc → findTableOfContents → contentsFragment(range.depth, withMarkers=false) → tr.replaceWith → dispatch(tr).
     * @controlflow Guards presence and staleness with early returns, then rewrites the in-between list or no-ops on dry run.
     */
    const range = findTableOfContents(state.doc);
    if (range === null) {
      // The document has no table of contents to refresh.
      return false;
    } else {
      // A table of contents was located for refreshing.
    }
    const next = contentsFragment(state.schema, state.doc, range.depth, false);
    if (state.doc.slice(range.from, range.to).content.eq(next)) {
      // The existing list already matches the current headings.
      return false;
    } else {
      // The existing list is out of date and needs rewriting.
    }
    if (dispatch !== undefined) {
      // Rewrite the in-between list in place, preserving the surrounding markers.
      const tr = state.tr.replaceWith(range.from, range.to, next);
      tr.setMeta('kdocStructural', true);
      dispatch(tr);
    } else {
      // Dry run: no transaction is dispatched.
    }
    return true;
  };
}