/**
 * @file toc.ts
 * @purpose Builds GitHub-compatible heading anchors and a nested table of contents from Markdown headings.
 * @inputs Heading text strings and depths; HTML comment markers that delimit an injected table of contents.
 * @outputs Anchor slugs per heading; a nested list structure describing the table of contents; marker helpers.
 * @functions
 *   - headingSlug: Reduces a single heading's text to its GitHub-style anchor slug.
 *   - headingAnchors: Produces one disambiguated anchor per heading in document order.
 *   - tocStartMarker: Serializes a table-of-contents start marker carrying a depth clause.
 *   - parseTocStart: Reads the requested depth out of a start-marker comment, or null when absent.
 *   - isTocEnd: Recognizes the comment that closes an injected table of contents.
 *   - tocItems: Assembles the nested entry tree for headings no deeper than maxDepth.
 *   - tocList: Renders that entry tree as a Markdown list node.
 * @dataflow Heading texts → headingSlug → headingAnchors → tocItems tree → tocList Markdown List node.
 * @controlflow Pure transformations run in sequence; each function is stateless and deterministic over its inputs.
 * @version 1
 * @date 2026-09-15
 */

import type { List, ListItem } from 'mdast';

/** Headings listed when a table of contents does not say otherwise. */
export const DEFAULT_TOC_DEPTH = 3;
/** The comment closing a table of contents. */
export const TOC_END_MARKER = '<!-- /toc -->';

const TOC_START_PATTERN = /^<!--\s*toc(?:\s+depth=([1-6]))?\s*-->\s*$/i;
const TOC_END_PATTERN = /^<!--\s*\/toc\s*-->\s*$/i;

export interface TocHeading { readonly depth: number; readonly text: string; }
export interface TocItem { readonly text: string; readonly anchor: string; readonly children: readonly TocItem[]; }

/**
 * @purpose Reduces a single heading's text to its GitHub-style anchor slug.
 * @inputs text - The raw heading text whose punctuation is stripped and spaces hyphenated.
 * @outputs string - The lowercase, punctuation-free slug suitable as an HTML fragment identifier.
 * @dataflow Input text → lowercased and trimmed → punctuation removed → spaces hyphenated → trimmed of edge hyphens.
 * @controlflow Apply three sequential regular-expression replacements with no branching.
 */
export function headingSlug(text: string): string {
  const lower = text.toLowerCase().trim();
  // Punctuation is DROPPED, not hyphenated -- "What's New in 2.0?" becomes whats-new-in-20 -- because that is what GitHub and the renderers that follow it emit, and an anchor that does not match the renderer's is a broken link.
  const withoutPunctuation = lower.replace(/[^\p{L}\p{N} _-]+/gu, '');
  const hyphenated = withoutPunctuation.replace(/\s+/g, '-');
  return hyphenated.replace(/^-+|-+$/g, '');
}

/**
 * @purpose Produces one disambiguated anchor per heading in document order.
 * @inputs texts - The ordered heading texts whose anchors are computed together so repeats are numbered.
 * @outputs string[] - One anchor per input, the base slug for first occurrences and `<slug>-<n>` for later ones.
 * @dataflow Each text → headingSlug → a running count map → the disambiguated anchor string.
 * @controlflow Map over inputs; track how many times each base slug has been seen and append its zero-based index after the first.
 */
export function headingAnchors(texts: readonly string[]): string[] {
  // Each heading's anchor in document order: the slug, then -1, -2 for later headings with the same slug.
  // Example: headingAnchors(['Notes', 'Other', 'Notes', 'notes!']) -> ['notes', 'other', 'notes-1', 'notes-2'].
  const counts = new Map<string, number>();
  return texts.map((text) => {
    const base = headingSlug(text);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    // First occurrence of this slug: the anchor is just the base slug with no suffix.
    if (seen === 0) {
      return base;
    } else {
      // A later heading repeats this slug: append its zero-based document-order index to disambiguate.
      return `${base}-${seen}`;
    }
  });
}

/**
 * @purpose Serializes a table-of-contents start marker carrying a depth clause.
 * @inputs depth - The maximum heading level the injected contents should include.
 * @outputs string - An HTML comment of the form `<!-- toc depth=<depth> -->`.
 * @dataflow Depth integer → interpolated into the marker template literal.
 * @controlflow Single interpolation with no branching.
 */
export function tocStartMarker(depth: number): string {
  return `<!-- toc depth=${depth} -->`;
}

/**
 * @purpose Reads the requested depth out of a start-marker comment, or null when absent.
 * @inputs html - A single line of HTML to test for a table-of-contents start marker.
 * @outputs number | null - The requested depth, the default when none is named, or null when not a start marker.
 * @dataflow HTML string → regex match → capture group 1 (optional depth) → parsed number or fallback.
 * @controlflow Match against the pattern; branch on no-match, missing capture, and present capture.
 */
export function parseTocStart(html: string): number | null {
  // The depth a start marker asks for, the default when it names none, or null when the HTML is not a start marker.
  // Example: parseTocStart('<!-- toc -->') === 3; parseTocStart('<!-- TOC depth=2 -->') === 2; parseTocStart('<!-- toc depth=9 -->') === null; parseTocStart('<!-- comment -->') === null.
  const match = TOC_START_PATTERN.exec(html);
  // Not a start marker at all: report that no depth was requested.
  if (match === null) {
    return null;
  } else if (match[1] === undefined) {
    // A start marker with no explicit depth clause falls back to the default depth.
    return DEFAULT_TOC_DEPTH;
  } else {
    // A start marker naming a depth returns that parsed value.
    return Number(match[1]);
  }
}

/**
 * @purpose Recognizes the comment that closes an injected table of contents.
 * @inputs html - A single line of HTML to test for the closing marker.
 * @outputs boolean - True when the line is exactly the closing `<!-- /toc -->` comment.
 * @dataflow HTML string → regex test → boolean result.
 * @controlflow Single regex test with no branching.
 */
export function isTocEnd(html: string): boolean {
  return TOC_END_PATTERN.test(html);
}

interface MutableItem { readonly text: string; readonly anchor: string; readonly children: MutableItem[]; }

/**
 * @purpose Assembles the nested entry tree for headings no deeper than maxDepth.
 * @inputs headings - The ordered heading list with depths; maxDepth caps how deep listed entries may go.
 * @outputs TocItem[] - Root entries, each linking to its anchor and holding nested children up to maxDepth.
 * @dataflow Headings → headingAnchors for every entry → a depth-stack walk that nests each entry under the nearest shallower ancestor.
 * @controlflow Iterate headings; skip those past maxDepth; pop the stack to deeper-or-equal entries; attach under the new top or as a root.
 */
export function tocItems(headings: readonly TocHeading[], maxDepth: number): TocItem[] {
  // The nested entries for headings no deeper than maxDepth. Anchors are counted over every heading, listed or not, so a link matches the anchor a renderer gives. A heading nests under the nearest shallower one before it; a jump of several levels nests one level.
  const anchors = headingAnchors(headings.map((heading) => heading.text));
  const roots: MutableItem[] = [];
  const stack: { readonly depth: number; readonly item: MutableItem }[] = [];
  headings.forEach((heading, index) => {
    // Skip headings deeper than the requested maximum depth; they are not listed in this table of contents.
    if (heading.depth > maxDepth) {
      return;
    } else {
      // The heading is within range and will be inserted into the tree below.
      const item: MutableItem = { text: heading.text, anchor: anchors[index] ?? '', children: [] };
      // Close every open entry at this depth or deeper: the new heading is their sibling or an ancestor's child.
      while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= heading.depth) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      // No shallower entry remains on the stack: this heading is a top-level root.
      if (parent === undefined) {
        roots.push(item);
      } else {
        // A shallower entry is open: nest this heading beneath it as its newest child.
        parent.item.children.push(item);
      }
      stack.push({ depth: heading.depth, item });
    }
  });
  return roots;
}

/**
 * @purpose Renders the entry tree as a Markdown list node.
 * @inputs items - The root entries whose links and nested sub-lists form the table of contents.
 * @outputs List - A Markdown AST unordered list, one item per entry with nested lists for sub-headings.
 * @dataflow Each TocItem → a listItem holding a link paragraph, optionally followed by a recursively built nested list.
 * @controlflow Map entries; branch on whether an entry has children to decide the trailing nested list.
 */
export function tocList(items: readonly TocItem[]): List {
  // The Markdown list for the entries: one item per heading holding a link to its anchor, with nested lists for sub-headings.
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: items.map((item): ListItem => {
      // Each list item holds a link to its heading anchor; sub-headings form a nested list beneath it.
      if (item.children.length === 0) {
        // No sub-headings: the item contains only the link paragraph.
        return {
          type: 'listItem',
          spread: false,
          checked: null,
          children: [
            { type: 'paragraph', children: [{ type: 'link', url: `#${item.anchor}`, title: null, children: [{ type: 'text', value: item.text }] }] },
          ],
        };
      } else {
        // Sub-headings exist: append their nested list after the link paragraph.
        return {
          type: 'listItem',
          spread: false,
          checked: null,
          children: [
            { type: 'paragraph', children: [{ type: 'link', url: `#${item.anchor}`, title: null, children: [{ type: 'text', value: item.text }] }] },
            tocList(item.children),
          ],
        };
      }
    }),
  };
}