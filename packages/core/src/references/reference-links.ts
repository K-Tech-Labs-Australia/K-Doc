/**
 * @file reference-links.ts
 * @purpose Implements FR-8.16 reference-style link management: enumerating a document's link definitions with usage counts and duplicate flags, and rewriting inline `[text](url)` links into reference-style `[text][label]` links with appended definition lines.
 * @inputs A KdocDocument whose `text` is the source Markdown and whose `root` is its mdast tree.
 * @outputs LinkDefinitionEntry records describing each definition (linkDefinitions) and a converted document plus conversion count (convertToReferenceLinks).
 * @functions
 *   - walk: Depth-first traversal that visits every node and recurses into children when present.
 *   - linkDefinitions: Collects definition nodes with source ranges, usage counts, and duplicate markers.
 *   - destination: Wraps a URL in angle brackets when it is empty or contains whitespace so it parses as one destination.
 *   - definitionLine: Serialises a label/URL/title triple into a Markdown reference-definition line.
 *   - convertToReferenceLinks: Rewrites inline links to reference links, reusing existing definitions and appending new ones.
 * @dataflow KdocDocument.text and KdocDocument.root → walk traversal → node inspection → entry records or rewritten text.
 * @controlflow Exported helpers traverse the root once (linkDefinitions) or twice (convertToReferenceLinks); conversion replaces offsets from the end to preserve validity, then appends definitions after a separator chosen by the trailing block type.
 * @version 1
 * @date 2026-09-16
 */

import type { Definition, Link, Nodes } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import { nodeRange } from '../position/map.js';

/**
 * A single link-definition record within a document.
 * @field identifier Normalised reference label.
 * @field label Label as written (definition.label ?? identifier).
 * @field url Destination of the definition.
 * @field title Optional title, or null when absent.
 * @field start Source offset where the definition begins.
 * @field end Source offset just past the definition.
 * @field uses Count of linkReference + imageReference nodes naming this identifier.
 * @field duplicate True when an earlier definition already declared this identifier (so this one is never used).
 */
export interface LinkDefinitionEntry {
  readonly identifier: string; // normalised label
  readonly label: string; // label as written (definition.label ?? identifier)
  readonly url: string;
  readonly title: string | null;
  readonly start: number; // source offset of the definition
  readonly end: number; // source offset just past the definition
  readonly uses: number; // linkReference + imageReference nodes naming this identifier
  readonly duplicate: boolean; // an earlier definition has the same identifier, so this one is never used
}

/**
 * Result of converting inline links to reference links.
 * @field text The rewritten document text.
 * @field converted Number of inline links that were rewritten.
 */
export interface ReferenceConversion {
  readonly text: string; // rewritten document text
  readonly converted: number; // number of inline links that were rewritten
}

/**
 * Depth-first traversal of an mdast tree.
 * @purpose Visit every node in document order, recursing into children when present.
 * @inputs node - The current node to visit and descend into.
 *         visit - Callback invoked with each node as it is visited.
 * @outputs void (side-effecting through the visit callback).
 * @dataflow node → visit callback; node.children → recursive walk calls per child.
 * @controlflow Visit the node, then branch on whether it has children: recurse for each child in order, otherwise stop descending.
 */
function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  // Branch: descend only when this node carries a children array.
  if ('children' in node) {
    // Node has children: recurse into each child in source order.
    for (const child of (node as { children: Nodes[] }).children) {
      walk(child, visit);
    }
  } else {
    // Leaf node without a children property: nothing to descend into.
  }
}

/**
 * Enumerate a document's link definitions with usage counts and duplicate flags.
 * @purpose Build one LinkDefinitionEntry per definition node, counting how many references name it and flagging duplicates.
 * @inputs document - KdocDocument whose root is traversed for reference and definition nodes.
 * @outputs Array of LinkDefinitionEntry ordered by first appearance in the tree.
 * @dataflow Root tree → walk → reference counts and definition ranges → mapped entry objects.
 * @controlflow Walk once to tally uses and gather definitions with ranges, then map each definition to an entry while tracking seen identifiers for duplicate detection.
 */
export function linkDefinitions(document: KdocDocument): LinkDefinitionEntry[] {
  const uses = new Map<string, number>();
  const definitions: { node: Definition; start: number; end: number }[] = [];
  walk(document.root, (node) => {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      // Reference node: increment the use count for the identifier it names.
      uses.set(node.identifier, (uses.get(node.identifier) ?? 0) + 1);
    } else if (node.type === 'definition') {
      const range = nodeRange(node);
      if (range !== null) {
        // Definition has a source position: record it for entry construction.
        definitions.push({ node, start: range.start, end: range.end });
      } else {
        // Definition lacks a position: cannot reveal offsets, so skip it.
      }
    } else {
      // Unrelated node type: ignore.
    }
  });
  const seen = new Set<string>();
  return definitions.map(({ node, start, end }) => {
    // Duplicate when an earlier definition already claimed this identifier.
    const duplicate = seen.has(node.identifier);
    seen.add(node.identifier);
    return {
      identifier: node.identifier,
      // Fall back to the normalised identifier when no explicit label was written.
      label: node.label ?? node.identifier,
      url: node.url,
      // Definitions may omit a title; represent that as null.
      title: node.title ?? null,
      start,
      end,
      uses: uses.get(node.identifier) ?? 0,
      duplicate,
    };
  });
}

/**
 * Normalise a destination URL for inclusion in a definition line.
 * @purpose Ensure the destination parses as a single token by angle-bracketing empty or whitespace-containing URLs.
 * @inputs url - The raw destination string from a definition node.
 * @outputs The possibly angle-wrapped destination string.
 * @dataflow url → whitespace/empty check → bare or `<url>` output.
 * @controlflow Branch on empty-or-whitespace: wrap in angle brackets when true, otherwise return the URL unchanged.
 */
function destination(url: string): string {
  // Empty or whitespace-containing destinations require angle brackets to parse as one token;
  // otherwise the URL is returned unchanged so it stays compact in the definition line.
  return url === '' || /\s/.test(url) ? `<${url}>` : url;
}

/**
 * Serialise a reference-definition line from its parts.
 * @purpose Render `[label]: <destination> "title"` with an optional quoted title and escaped inner quotes.
 * @inputs label - The definition label to emit.
 *         url - The destination, already normalised via destination().
 *         title - Optional title; null omits the quoted portion.
 * @outputs The definition line (without a trailing newline; the caller appends it).
 * @dataflow label/url/title → template interpolation with escaping → definition-line string.
 * @controlflow Branch on null title: emit bare destination when null, otherwise append the escaped, double-quoted title.
 */
function definitionLine(label: string, url: string, title: string | null): string {
  // With no title emit just label and destination; with a title append it quoted, escaping any embedded quotes.
  return title === null
    ? `[${label}]: ${destination(url)}`
    : `[${label}]: ${destination(url)} "${title.replace(/"/g, '\\"')}"`;
}

/**
 * Rewrite inline links into reference-style links and append missing definitions.
 * @purpose Convert `[text](url "title")` occurrences to `[text][label]`, reusing existing definitions for matching destination/title pairs and appending new definition lines.
 * @inputs document - KdocDocument providing both source text (for offset slicing) and root tree (for node inspection).
 * @outputs ReferenceConversion with the rewritten `text` and the number of inline links converted.
 * @dataflow Root tree → two walks (existing definitions, then convertible links) → label assignment → end-to-start offset replacement → appended definitions.
 * @controlflow Seed byTarget/taken from existing definitions; collect convertible links with ranges; assign labels (reused or freshly numbered); splice reference syntax from the end to keep offsets valid; append new definitions after a separator chosen by the trailing block type.
 */
export function convertToReferenceLinks(document: KdocDocument): ReferenceConversion {
  const text = document.text;
  // Existing definitions are reused for the same destination and title, and their labels are never taken again.
  const byTarget = new Map<string, string>();
  const taken = new Set<string>();
  walk(document.root, (node) => {
    if (node.type === 'definition') {
      // Record every existing definition label as consumed so generated labels never collide with it.
      taken.add(node.identifier);
      // NUL cannot occur in a destination or title, so it separates the two without ambiguity.
      const key = `${node.url}\u0000${node.title ?? ''}`;
      if (!byTarget.has(key)) {
        // First definition seen for this destination/title owns the shared label slot.
        byTarget.set(key, node.label ?? node.identifier);
      } else {
        // A prior definition already owns this key: leave its label untouched.
      }
    } else {
      // Non-definition node: contributes no existing definition to reuse.
    }
  });
  const links: { from: number; to: number; inner: string; key: string; url: string; title: string | null }[] = [];
  walk(document.root, (node) => {
    // Guard: only inline link nodes are convertible; a reference link or other node returns here, otherwise processing continues below.
    if (node.type !== 'link') {
      return;
    } else {
      // An inline link: see whether it can be converted.
    }
    const link = node as Link;
    const range = nodeRange(link);
    const first = link.children[0];
    const last = link.children[link.children.length - 1];
    // Guard: missing position or empty link text `[](url)` leaves the link untouched, otherwise continue.
    if (range === null || first === undefined || last === undefined) {
      return;
    } else {
      // Positioned, with text: read the text's range.
    }
    const firstRange = nodeRange(first);
    const lastRange = nodeRange(last);
    // Guard: unresolvable child positions prevent inner-text extraction, otherwise continue.
    if (firstRange === null || lastRange === null) {
      return;
    } else {
      // The text's source range is known.
    }
    // Guard: an autolink `<https://…>` or bare URL has no bracketed text to keep, otherwise record the link.
    if (text[range.start] !== '[') {
      return;
    } else {
      // A bracketed link: record it.
    }
    links.push({
      from: range.start,
      to: range.end,
      inner: text.slice(firstRange.start, lastRange.end),
      key: `${link.url}\u0000${link.title ?? ''}`,
      url: link.url,
      title: link.title ?? null,
    });
  });
  // With no links there is nothing to label, splice or append, so the text comes back unchanged with a count of 0.
  let next = 1;
  const added: string[] = [];
  const labels = links.map((link) => {
    const existing = byTarget.get(link.key);
    // A definition already exists for this destination/title: reuse its label and skip generation.
    if (existing !== undefined) {
      return existing;
    } else {
      // No definition yet: number a new one.
    }
    // Advance past any labels already consumed until an available number is found.
    while (taken.has(String(next))) next += 1;
    const label = String(next);
    taken.add(label);
    byTarget.set(link.key, label);
    added.push(definitionLine(label, link.url, link.title));
    return label;
  });
  // Replace from the end so earlier offsets stay valid.
  let result = text;
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const link = links[i];
    const label = labels[i];
    // Guard: defensive check for indices that cannot occur given equal-length arrays.
    if (link === undefined || label === undefined) {
      continue;
    } else {
      // Both present: splice the reference in.
    }
    result = result.slice(0, link.from) + `[${link.inner}][${label}]` + result.slice(link.to);
  }
  if (added.length > 0) {
    // New definitions were generated: append them after the document body.
    const base = result.replace(/\n+$/, '');
    const lastBlock = document.root.children[document.root.children.length - 1];
    // Joined to a definition block the new lines extend it; after anything else they start a new block.
    const separator = lastBlock !== undefined && lastBlock.type === 'definition' ? '\n' : '\n\n';
    result = `${base}${separator}${added.join('\n')}\n`;
  } else {
    // No new definitions: the replaced text is already the final result.
  }
  return { text: result, converted: links.length };
}
