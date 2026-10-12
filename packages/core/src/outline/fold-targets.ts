/**
 * @file fold-targets.ts
 * @purpose Assigns every foldable region in a Markdown document — top-level heading sections and list items at any depth — a stable string key plus its source offset range, so the WYSIWYG ProseMirror pane and the Source CodeMirror pane agree on which regions are folded. Fold keys derive purely from document content (heading anchors and normalized list-item text), never from pane state, so a fold made in one pane is visible and savable per document in the other.
 * @inputs KdocDocument instances containing parsed mdast Root nodes and source text; readonly arrays of FoldEntry records carrying a kind and display text.
 * @outputs Arrays of FoldTarget records (key, kind, start, end) describing every foldable region, plus pure key-derivation and offset-lookup helpers.
 * @functions
 *   - foldKeys: Derives one stable string key per fold entry from heading anchors and normalized list-item text, disambiguating repeats.
 *   - foldTargets: Collects heading-section and list-item regions across the document AST and returns them with aligned keys and source offsets.
 *   - innermostFoldTarget: Finds the deepest fold target whose source range contains a given offset.
 * @dataflow KdocDocument → buildOutline for headings + recursive preorder walk for list items → collected regions sorted by start offset → foldKeys produces aligned keys → FoldTarget[] with key/kind/start/end; innermostFoldTarget scans targets by containment and deepest start.
 * @controlflow Build the outline then walk the AST collecting heading and item ranges in document order → sort by start offset → compute keys over the ordered collection → map to FoldTargets; innermostFoldTarget iterates all targets keeping the one with the largest start among those containing the offset.
 * @version 1
 * @date 2026-09-16
 */

import type { ListItem, Node, Parent } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import { nodeRange } from '../position/map.js';
import { buildOutline, flattenText } from './outline.js';
import { outlineSectionRange } from './move-section.js';
import { headingAnchors } from './toc.js';

/** A foldable region's kind: a top-level heading section or a list item. */
export type FoldKind = 'heading' | 'listItem';

/** A fold entry carries only the identity needed to derive a key: its kind and display text. */
export interface FoldEntry {
  /** Whether this entry is a heading section or a list item. */
  readonly kind: FoldKind;
  /** The display text used to build a stable, deduplicated key for list items. */
  readonly text: string;
}

/** A fold target pairs a derived key with the source offset range it covers. */
export interface FoldTarget {
  /** The stable per-document key shared by both editor panes. */
  readonly key: string;
  /** Whether this region is a heading section or a list item. */
  readonly kind: FoldKind;
  /** Start offset of the region in the source text, inclusive. */
  readonly start: number;
  /** End offset of the region in the source text, exclusive. */
  readonly end: number;
}

/**
 * @purpose Derives a stable string key for each fold entry so both editor panes agree on region identity; heading entries use GitHub anchors and repeated list items receive a numeric suffix.
 * @inputs entries - The ordered FoldEntry records whose keys are computed in document order.
 * @outputs string[] - One key per input entry: `heading:<anchor>` for headings, `item:<text>` or `item:<text>#<n>` for list items.
 * @dataflow Entries → filter to headings → headingAnchors over the heading texts → per-entry branch producing the ordered key strings.
 * @controlflow Iterate entries; consume the next anchor for a heading (empty fallback when exhausted) and normalize + suffix a list item's text.
 */
export function foldKeys(entries: readonly FoldEntry[]): string[] {
  // Heading anchors are computed together so repeated headings get -1, -2 disambiguation in document order.
  const headingTexts = entries.filter((entry) => entry.kind === 'heading').map((entry) => entry.text);
  const anchors = headingAnchors(headingTexts);

  let headingIndex = 0;
  const itemSeen = new Map<string, number>();
  const keys: string[] = [];

  for (const entry of entries) {
    if (entry.kind === 'heading') {
      // Heading entry: consume the next computed anchor. headingAnchors returns one anchor per heading text, so this index is always in range; the empty fallback is defensive under noUncheckedIndexedAccess.
      keys.push(`heading:${anchors[headingIndex] ?? ''}`);
      headingIndex += 1;
    } else {
      // List item entry: normalize whitespace and disambiguate repeats with a zero-based suffix.
      const text = entry.text.replace(/\s+/g, ' ').trim();
      const seen = itemSeen.get(text) ?? 0;
      itemSeen.set(text, seen + 1);
      if (seen === 0) {
        // First time this normalized text appears: emit the plain item key with no suffix.
        keys.push(`item:${text}`);
      } else {
        // A prior list item already used this text: append its zero-based repeat index to keep the key unique.
        keys.push(`item:${text}#${seen}`);
      }
    }
  }

  return keys;
}

/**
 * @purpose Collects every foldable region in the document — top-level heading sections and list items at any depth — as FoldTarget records with aligned keys and source offsets.
 * @inputs document - The parsed KdocDocument whose AST root and source text define the regions.
 * @outputs FoldTarget[] - Every fold target ordered by source offset, each carrying a key, kind, and exclusive-end range.
 * @dataflow KdocDocument → buildOutline for heading ranges + recursive preorder walk for list-item ranges → sort collected by start offset → foldKeys over the ordered collection → map to FoldTargets.
 * @controlflow Collect headings from the outline with section-bounded ends; walk the AST collecting list items at every depth; sort by start offset; compute keys; map each region to a FoldTarget.
 */
export function foldTargets(document: KdocDocument): FoldTarget[] {
  /** A fold region gathered from the document, carrying its kind, display text, and source range. */
  interface CollectedFold {
    readonly kind: FoldKind;
    readonly text: string;
    readonly start: number;
    readonly end: number;
  }

  const collected: CollectedFold[] = [];

  // The top-level outline supplies every heading fold target, since headings nested in blockquotes or list items are not document sections.
  const outline = buildOutline(document);

  // One heading target per outline entry, its section bounded by the next same-or-shallower heading (or the document's end).
  for (let i = 0; i < outline.length; i += 1) {
    const entry = outline[i];

    // Guarded for noUncheckedIndexedAccess: a valid index is always defined, so this branch never executes.
    if (entry === undefined) {
      continue;
    } else {
      // The next same-or-shallower heading bounds this section's end, or the range is null when none remains.
      const range = outlineSectionRange(outline, i, document.text.length);

      // Section end is the bounding heading's start when one bounds it; otherwise the heading's own end offset (document end).
      const sectionEnd = range === null ? entry.end : range.end;

      collected.push({
        kind: 'heading',
        text: entry.text,
        start: entry.start,
        end: sectionEnd,
      });
    }
  }

  // Walk the whole AST in preorder so list items at every depth — including those inside blockquotes — become fold targets.
  const walk = (node: Node): void => {
    if (node.type === 'listItem') {
      const listItem = node as ListItem;
      const range = nodeRange(listItem);

      // Only collect items with a resolvable source range so both panes can map the key back to real offsets.
      if (range !== null) {
        // The label is the flattened text of the item's first child, which may be absent for an empty list item.
        const first = listItem.children[0];

        // Item text is the first child's plain text; an empty item has no first child and contributes nothing.
        const itemText = first === undefined ? '' : flattenText(first);

        collected.push({
          kind: 'listItem',
          text: itemText,
          start: range.start,
          end: range.end,
        });
      } else {
        // No source range for this list item: skip it rather than emit an unusable target with bogus offsets.
      }
    } else {
      // Non-list-item node: not a fold region itself, but may contain nested list items below.
    }

    // Descend into children so nested list items are reached regardless of nesting depth.
    if ('children' in node) {
      const parent = node as Parent;
      for (const child of parent.children) {
        walk(child);
      }
    } else {
      // Leaf node without a children array: nothing to descend into.
    }
  };

  walk(document.root);

  // Order targets by source offset so keys align with document order; Array.prototype.sort is stable and a heading never shares a start with an item.
  collected.sort((a, b) => a.start - b.start);

  // Keys are computed over the ordered collection so each FoldTarget's key lines up with its position in the result array.
  const keys = foldKeys(collected);

  return collected.map((c, i) => ({
    key: keys[i] ?? '',
    kind: c.kind,
    start: c.start,
    end: c.end,
  }));
}

/**
 * @purpose Selects the deepest fold target that contains a given source offset so nested folds collapse inward rather than selecting an ancestor region.
 * @inputs targets - The readonly FoldTarget[] to search.
 * @inputs offset - The 0-based character offset into the source text to locate within a target range.
 * @outputs FoldTarget | null - The contained target with the largest start offset, or null when none contains the offset.
 * @dataflow Targets + offset → containment check per target → keep the deepest-starting match as best.
 * @controlflow Iterate targets; adopt each contained target whose start is at or after the current best's start; return best or null.
 */
export function innermostFoldTarget(targets: readonly FoldTarget[], offset: number): FoldTarget | null {
  let best: FoldTarget | null = null;

  for (const t of targets) {
    // The target is a candidate only when it contains the offset; among candidates the deepest-starting one wins.
    if (t.start <= offset && offset < t.end && (best === null || t.start >= best.start)) {
      // Contains the offset and starts at or after the current best: adopt this as the innermost fold target.
      best = t;
    } else {
      // Either does not contain the offset or is shallower than the current best: leave best unchanged.
    }
  }

  return best;
}
