/**
 * @file html-footnotes.ts
 * @purpose Finds footnotes in imported HTML (the shape mammoth writes for Word footnotes, and most web pages: a link `<a href="#footnote-1">` often wrapped in `<sup>`, pointing at `<li id="footnote-1">` in a list, whose text has a back-link `<a href="#footnote-ref-1">`). Replaces each reference with a placeholder element and removes the list items, returning their contents so the importer can write Markdown footnotes.
 * @inputs A Hast root tree produced by the HTML importer (mammoth), containing footnote anchors, their wrapping superscripts, and the referenced `<li>` list items.
 * @outputs Array of HtmlFootnote objects (a sequential label plus extracted children); references are replaced in-tree with `<kdoc-footnote-reference>` placeholders and footnote list items are removed from the tree.
 * @functions
 *   - collect: Depth-first traversal recording each element's parent and its visitation order (module-private).
 *   - hrefTarget: Extracts the fragment id from an anchor's href when it targets the same document (module-private).
 *   - replaceChild: Replaces or removes a direct child node within its container (module-private).
 *   - removeLinks: Recursively strips anchors whose targets are in the given id set (module-private).
 *   - extractFootnotes: Finds footnotes, replaces each reference with a placeholder, and returns their contents.
 * @dataflow Hast tree -> collect builds parent map + document order -> anchors pointing at <li> ids become references -> each reference replaced by a placeholder -> footnote <li> children extracted into HtmlFootnote objects -> orphaned lists pruned.
 * @controlflow Traverse once to build structure -> gather items and references -> if none, return early -> assign sequential labels -> replace references with placeholders -> extract and remove footnote items -> prune empty lists -> return footnotes.
 * @version 1
 * @date 2026-09-17
 */

import type { Root as HastRoot, RootContent, Element, ElementContent } from 'hast';

/** Tag name of the placeholder element written in place of each footnote reference. */
export const FOOTNOTE_REFERENCE_TAG = 'kdoc-footnote-reference';

/**
 * A single extracted footnote: its sequential label and the HTML content that was inside its list item.
 */
export interface HtmlFootnote {
  /** Sequential, human-facing label (1-based) assigned in reading order. */
  readonly label: string;
  /** The extracted children of the footnote's `<li>`, with back-links stripped. */
  readonly children: ElementContent[];
}

/** A container whose children are traversed and mutated: either the tree root or a nested element. */
type Container = HastRoot | Element;

/**
 * Depth-first traversal that records every element's parent and visitation order.
 *
 * @purpose Walks the tree so later passes can look up a node's container and process nodes in document order.
 * @inputs container - The HastRoot or Element whose children are traversed.
 * @inputs parents - Map populated with each visited element mapped to its immediate container.
 * @inputs order - Array appended with every visited element in pre-order.
 * @outputs void - State is mutated in place (parents and order).
 * @dataflow container.children -> for each element child: recorded in parents, pushed to order, then recursed into.
 * @controlflow Visit children in order; recurse only through element nodes so text/comment nodes are skipped but not descended.
 */
function collect(container: Container, parents: Map<Element, Container>, order: Element[]): void {
  for (const child of container.children) {
    if (child.type === 'element') {
      // Branch: Child is an element; record its parent, add it to traversal order, and recurse into it.
      parents.set(child, container);
      order.push(child);
      collect(child, parents, order);
    } else {
      // Branch: Child is not an element (text, comment, etc.); skip it without recursing.
    }
  }
}

/**
 * Extracts the fragment id from an anchor's href when it targets the same document.
 *
 * @purpose Returns the target id (without the leading '#') for in-page anchors so references can be matched to list items.
 * @inputs element - The element whose href is inspected; only meaningful for `<a>` nodes.
 * @outputs string | null - The fragment id when href is a same-document anchor with a non-empty target, otherwise null.
 * @dataflow element.properties.href -> validated as a '#'-prefixed string -> leading '#' stripped to yield the id.
 * @controlflow Return the sliced id only when href is a string starting with '#' and longer than one character; otherwise return null.
 */
function hrefTarget(element: Element): string | null {
  const href = element.properties.href;

  if (typeof href === 'string' && href.startsWith('#') && href.length > 1) {
    // Branch: href is a same-document anchor with a non-empty target id; strip the leading '#'.
    return href.slice(1);
  } else {
    // Branch: href is not an in-page anchor (missing, non-string, no '#', or empty); report no target.
    return null;
  }
}

/**
 * Replaces or removes a direct child node within its container.
 *
 * @purpose Mutates a container's children array by swapping a node for a replacement or deleting it entirely.
 * @inputs container - The container whose children array is mutated.
 * @inputs node - The existing child element to replace or remove.
 * @inputs replacement - The new element to insert, or null to delete the node.
 * @outputs void - State is mutated in place (container.children).
 * @dataflow container.children -> locate node by identity -> splice out or overwrite at its index.
 * @controlflow Return early when the node is not a direct child; otherwise splice it out when replacement is null, else overwrite its slot.
 */
function replaceChild(container: Container, node: Element, replacement: Element | null): void {
  const children = container.children as RootContent[];
  const index = children.indexOf(node);

  if (index === -1) {
    // Branch: Node is not a direct child of this container; nothing to replace.
    return;
  } else {
    // Branch: Node found at index; proceed to swap or remove it below.
  }

  if (replacement === null) {
    // Branch: Replacement is null; remove the node in place.
    children.splice(index, 1);
  } else {
    // Branch: Replacement provided; overwrite the node's slot with it.
    children[index] = replacement;
  }
}

/**
 * Recursively strips anchors whose targets are in the given id set.
 *
 * @purpose Removes `<a>` links inside a footnote (or elsewhere) that point at ids being deleted, so dangling back-links do not survive extraction.
 * @inputs container - The container whose children are scanned for removable links.
 * @inputs ids - Set of target fragment ids whose anchors should be removed.
 * @outputs void - State is mutated in place (container.children and descendants).
 * @dataflow container.children -> each element's hrefTarget checked against ids -> matching <a> spliced out, others recursed into.
 * @controlflow Scan children backwards so splicing preserves unvisited indices; skip non-elements; remove matching anchors or recurse otherwise.
 */
function removeLinks(container: Container, ids: ReadonlySet<string>): void {
  const children = container.children as RootContent[];
  // Iterate backwards so that splicing a node does not shift the indices of not-yet-visited siblings.
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];

    if (child === undefined || child.type !== 'element') {
      // Branch: Child is missing or not an element; skip it and continue scanning.
      continue;
    } else {
      // Branch: Child is a concrete element; evaluate its link below.
    }

    const target = hrefTarget(child);

    if (child.tagName === 'a' && target !== null && ids.has(target)) {
      // Branch: Anchor points at an id being removed; splice the <a> out of the tree.
      children.splice(index, 1);
    } else {
      // Branch: Not a removable anchor; recurse to strip nested links whose targets are also removed.
      removeLinks(child, ids);
    }
  }
}

/**
 * Finds footnotes in an imported HTML tree, replaces their references with placeholders, and returns their contents.
 *
 * @purpose Detects the Word/web footnote shape (anchor -> `<li id>`), assigns sequential labels, swaps each reference for a placeholder element, extracts the list item's children as Markdown-footnote material, and prunes lists left empty by the removal.
 * @inputs tree - The Hast root produced by the HTML importer, containing footnote anchors, superscripts, and referenced list items.
 * @outputs HtmlFootnote[] - One entry per distinct footnote target, in reading order, each carrying its label and extracted children; the tree is mutated so references become placeholders and footnote items are removed.
 * @dataflow Hast tree -> collect builds parent map + order -> anchors pointing at <li> ids become references -> each reference replaced by a placeholder -> footnote <li> children extracted into HtmlFootnote objects -> orphaned lists pruned.
 * @controlflow Traverse once to build structure -> gather items and references -> if none, return early without mutating -> assign sequential labels -> replace references with placeholders -> extract and remove footnote items -> prune empty lists -> return footnotes.
 */
export function extractFootnotes(tree: HastRoot): HtmlFootnote[] {
  const parents = new Map<Element, Container>();
  const order: Element[] = [];
  collect(tree, parents, order);

  // Collect every `<li>` that carries a string id; its id is the footnote target.
  const items = new Map<string, Element>();
  for (const element of order) {
    const id = element.properties.id;

    if (element.tagName === 'li' && typeof id === 'string') {
      // Branch: List item with a string id; register it as a footnote target.
      items.set(id, element);
    } else {
      // Branch: Not an `<li>` or its id is not a string; skip it.
    }
  }

  // Collect every anchor whose href points at a known footnote list item.
  const references: Array<{ anchor: Element; target: string }> = [];
  for (const element of order) {
    const target = hrefTarget(element);

    if (element.tagName === 'a' && target !== null && items.has(target)) {
      // Branch: Anchor points at a footnote item; record the reference.
      references.push({ anchor: element, target });
    } else {
      // Branch: Not an in-footnote anchor; skip it.
    }
  }

  if (references.length === 0) {
    // Branch: No footnotes found; return an empty list without mutating the tree.
    return [];
  } else {
    // Branch: Footnotes present; continue processing below.
  }

  // Assign each distinct footnote target a sequential label in reading order, and remember anchor ids for link stripping.
  const labels = new Map<string, string>();
  const anchorIds = new Set<string>();
  for (const reference of references) {
    if (!labels.has(reference.target)) {
      // Branch: Target not yet labelled; assign the next sequential number.
      labels.set(reference.target, String(labels.size + 1));
    } else {
      // Branch: Target already labelled; reuse its existing label.
    }

    const id = reference.anchor.properties.id;

    if (typeof id === 'string') {
      // Branch: Anchor carries a string id; remember it so nested links can be stripped later.
      anchorIds.add(id);
    } else {
      // Branch: Anchor has no usable id; skip recording it.
    }
  }

  // Replace each reference (or its wrapping `<sup>`) with a placeholder element carrying the assigned label.
  for (const reference of references) {
    const placeholder: Element = {
      type: 'element',
      tagName: FOOTNOTE_REFERENCE_TAG,
      properties: { dataLabel: labels.get(reference.target) ?? '' },
      children: [],
    };

    const parent = parents.get(reference.anchor);

    if (parent === undefined) {
      // Branch: Anchor has no recorded parent; cannot replace it.
      continue;
    } else {
      // Branch: Parent found; decide whether to replace the wrapping `<sup>` or the anchor itself.
    }

    // A `<sup>` holding nothing but the link is the reference's own superscript, not formatting the text used.
    if (parent.type === 'element' && parent.tagName === 'sup' && parent.children.filter((c) => !(c.type === 'text' && c.value.trim() === '')).length === 1) {
      // Branch: Parent is a `<sup>` containing only the link; replace the whole superscript with the placeholder.
      const grandparent = parents.get(parent);

      if (grandparent !== undefined) {
        // Branch: Grandparent exists; swap the `<sup>` for the placeholder in it.
        replaceChild(grandparent, parent, placeholder);
      } else {
        // Branch: No grandparent recorded; leave the tree unchanged for this reference.
      }
    } else {
      // Branch: Parent is not a bare-superscript link; replace the anchor element itself with the placeholder.
      replaceChild(parent, reference.anchor, placeholder);
    }
  }

  // Extract each footnote item's contents and remove it from the tree, tracking lists for later pruning.
  const footnotes: HtmlFootnote[] = [];
  const lists = new Set<Container>();
  for (const [target, label] of labels) {
    const item = items.get(target);

    if (item === undefined) {
      // Branch: Footnote item was not found; skip it.
      continue;
    } else {
      // Branch: Footnote item found; extract its contents below.
    }

    const parent = parents.get(item);

    if (parent !== undefined) {
      // Branch: Item has a recorded parent; remove the `<li>` and remember its list for cleanup.
      replaceChild(parent, item, null);
      lists.add(parent);
    } else {
      // Branch: Item has no recorded parent; leave it in place but still extract its contents.
    }

    // Strip links inside the footnote whose targets are anchor ids being removed elsewhere.
    removeLinks(item, anchorIds);

    footnotes.push({ label, children: item.children });
  }

  // A list that held only footnotes is removed with them.
  for (const list of lists) {
    if (list.type === 'element' && (list.tagName === 'ol' || list.tagName === 'ul') && !list.children.some((c) => c.type === 'element' && c.tagName === 'li')) {
      // Branch: List is an `<ol>`/`<ul>` with no remaining `<li>`; remove it entirely.
      const parent = parents.get(list);

      if (parent !== undefined) {
        // Branch: List has a recorded parent; replace the list with nothing.
        replaceChild(parent, list, null);
      } else {
        // Branch: List has no recorded parent; leave it in place.
      }
    } else {
      // Branch: List still holds content or is not a list element; keep it in the tree.
    }
  }

  return footnotes;
}
