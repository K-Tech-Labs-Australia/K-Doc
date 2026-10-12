/**
 * @file outline.ts
 * @purpose Derives a document outline (a navigable sequence of heading entries) from a parsed Markdown document for @k-doc/core.
 *   The outline walks only top-level headings because a heading nested inside a blockquote or a list item is not a document
 *   section, and treating it as one produces an outline that does not match the document's own structure. A reader scanning
 *   the outline expects the same headings the rendered document shows as section breaks.
 * @inputs KdocDocument instances containing parsed mdast Root nodes and source text, readonly arrays of OutlineEntry objects,
 *   character offset positions, and mdast Node structures.
 * @outputs Readonly arrays of OutlineEntry records and active outline entry index numbers.
 * @functions
 *   - buildOutline: Extracts a flat sequence of top-level document heading entries from a parsed KdocDocument.
 *   - activeOutlineIndex: Locates the index of the active heading section containing a given character offset in source text.
 *   - flattenText: Recursively extracts and normalizes plain text from an mdast node hierarchy, stripping inline markup.
 * @dataflow KdocDocument AST root → iterate top-level children → filter headings with valid offset ranges → flattenText recursive extraction & whitespace normalization → OutlineEntry array → activeOutlineIndex reverse scan → active entry index.
 * @controlflow Iterate document.root.children → check node.type === 'heading' → lookup nodeRange (skip null) → extract plain text → clamp depth 1..6 → build OutlineEntry array; linear backward scan for active section by offset.
 * @version 3
 * @date 2026-09-16
 */

import type { Heading, Image, InlineCode, Node, Parent, Text } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import { nodeRange } from '../position/map.js';
import { splitImageAlt } from '../images/image-hints.js';

/**
 * Represents a single heading entry in the navigable document outline.
 */
export interface OutlineEntry {
  /** Heading level, 1 to 6. */
  readonly depth: number;
  /** The heading's plain text, with inline markup flattened away. */
  readonly text: string;
  /** Start offset of the heading in the source text. */
  readonly start: number;
  /** End offset of the heading in the source text. */
  readonly end: number;
  /** Position in the flat outline list, so a caller can address an entry without carrying the object. */
  readonly index: number;
}

/**
 * Recursively flattens an mdast AST node and its descendants into normalized plain text.
 *
 * @purpose Recursively extracts plain text from an mdast node and its descendants, stripping inline markup and normalizing whitespace.
 * @inputs node - The mdast Node to extract plain text from.
 * @outputs string - The normalized plain text with whitespace runs collapsed to single spaces and trimmed boundaries.
 * @dataflow mdast Node → recursive traversal collecting text/inlineCode/image alt/break/children → raw string → whitespace collapse & trim → normalized text.
 * @controlflow Traverse node hierarchy → branch on node.type (text → value, inlineCode → value, image → alt, break → space, parent → join children, other → empty) → collapse whitespace runs to single spaces → trim → return string.
 */
export function flattenText(node: Node): string {
  /**
   * Recursively extracts raw text pieces from an AST node without whitespace normalization.
   *
   * @param n - The AST node to inspect.
   * @returns Raw unnormalized text extracted from the node and its subtree.
   */
  function collectRawText(n: Node): string {
    // Check if node is a plain text leaf node.
    if (n.type === 'text') {
      // Text node: contribute its literal text value.
      const textNode = n as Text;
      return textNode.value;
    }
    // Check if node is an inline code leaf node.
    else if (n.type === 'inlineCode') {
      // Inline code node: contribute its code text value so words inside backticks are preserved in the outline.
      const codeNode = n as InlineCode;
      return codeNode.value;
    }
    // Check if node is an image node with optional alt text.
    else if (n.type === 'image') {
      const imageNode = n as Image;
      // The width hint is layout, not words, so it is left out of the heading's text.
      const alt = splitImageAlt(imageNode.alt).alt;
      // Check if image node has a non-empty alt text string.
      if (typeof alt === 'string' && alt.length > 0) {
        // Non-empty alt text: contribute alt text.
        return alt;
      } else {
        // Missing or empty alt text: contribute nothing.
        return '';
      }
    }
    // Check if node is a hard break.
    else if (n.type === 'break') {
      // Hard break: contribute a single space separator.
      return ' ';
    }
    // Check if node has a children array (e.g. strong, emphasis, link, delete).
    else if ('children' in n && Array.isArray((n as Parent).children)) {
      // Parent node with children: recursively extract and concatenate text from all children.
      const parentNode = n as Parent;
      let accumulated = '';
      for (const child of parentNode.children) {
        accumulated += collectRawText(child);
      }
      return accumulated;
    }
    // Any other node type (e.g. html, thematicBreak) that cannot contribute text.
    else {
      // Unrecognized or non-textual node: contribute empty string.
      return '';
    }
  }

  const raw = collectRawText(node);
  // Collapse runs of whitespace to single spaces and trim leading/trailing whitespace.
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a flat list of OutlineEntry objects from top-level headings in a parsed Markdown document.
 *
 * @purpose Extracts a flat sequence of top-level document heading entries from a parsed KdocDocument.
 * @inputs document - The parsed KdocDocument containing markdown AST root and source text.
 * @outputs readonly OutlineEntry[] - Readonly array of OutlineEntry items representing top-level headings.
 * @dataflow KdocDocument AST root → iterate top-level children → filter headings with valid offset ranges → flatten text & clamp depth → array of OutlineEntry items.
 * @controlflow Iterate over document.root.children → check node.type === 'heading' → read nodeRange (skip if null) → flatten text → clamp depth 1..6 → assign index → return entries array.
 */
export function buildOutline(document: KdocDocument): readonly OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  // Walks only the top level of document.root.children.
  // A heading nested inside a blockquote or a list item is not a document section,
  // and treating it as one produces an outline that does not match the document's own structure.
  // A reader scanning the outline expects the same headings the rendered document shows as section breaks.
  for (const child of document.root.children) {
    // Check if the top-level child node is a heading.
    if (child.type === 'heading') {
      const heading = child as Heading;
      const range = nodeRange(heading);

      // Skip the heading entirely when the range is null.
      // An entry without an offset cannot be navigated to, and a list item that does nothing
      // when clicked is worse than an absent one.
      if (range === null) {
        // Position range is null: skip this heading entry.
        continue;
      } else {
        // Position range is defined: proceed with entry creation.
      }

      // Flatten the heading's AST subtree into plain text, collapsing whitespace.
      const text = flattenText(heading);

      // Clamp depth into 1..6 with Math.min(6, Math.max(1, heading.depth)).
      // A malformed depth would otherwise index an indentation table out of range in the UI.
      const depth = Math.min(6, Math.max(1, heading.depth));

      // Assign index from the entry's position in the result array, not from its position among root.children.
      const index = entries.length;

      entries.push({
        depth,
        text,
        start: range.start,
        end: range.end,
        index,
      });
    } else {
      // Non-heading top-level node: ignored because only top-level headings define outline sections.
    }
  }

  // Return a frozen-by-convention readonly array of outline entries.
  return entries;
}

/**
 * Locates the index of the heading whose section contains a given character offset in source text.
 *
 * @purpose Finds the active outline entry corresponding to a caret position via backward linear scan.
 * @inputs entries - The readonly array of OutlineEntry items to query.
 * @inputs offset - The 0-based character offset into the source text.
 * @outputs number - The index of the active OutlineEntry, or -1 if offset precedes all headings or entries is empty.
 * @dataflow OutlineEntry array + character offset → reverse linear scan → matching entry index or -1.
 * @controlflow Scan entries backwards from last to first → check entry.start <= offset → return matching index on first hit → return -1 if no entry matches.
 */
export function activeOutlineIndex(
  entries: readonly OutlineEntry[],
  offset: number
): number {
  // Scan backwards from the end of the entries list to find the last heading starting at or before offset.
  // The list of headings is small and a backward scan is simpler and clearer than binary search for no measurable gain.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    // Check if entry is defined (guarded for noUncheckedIndexedAccess) and starts at or before the given offset.
    if (entry !== undefined && entry.start <= offset) {
      // Found the last heading whose section starts at or before the offset: return its index.
      return entry.index;
    } else {
      // Heading starts after the offset: continue scanning preceding headings.
    }
  }

  // Returns -1 when the array is empty or when the offset falls before the first heading, since
  // text above the first heading genuinely belongs to no section, and pretending it belongs to the first one
  // would make the outline highlight the wrong row while the user edits a preamble.
  return -1;
}
