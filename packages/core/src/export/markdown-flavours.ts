/**
 * @file markdown-flavours.ts
 * @purpose Renders a K-Doc document as strict CommonMark, GitHub Flavored Markdown, or vault-portable Markdown by cloning the open document's tree, applying a flavour-specific downgrade/rewrite pass that records what changed, and serializing the result back to text; the source document is never mutated.
 * @inputs A KdocDocument (its root node tree), a MarkdownFlavour selecting which rewrite pass runs, and optional options carrying a ResolveWikiLink callback used by the portable flavour.
 * @outputs FlavourExport - The serialized markdown string plus an ordered list of { label, count } change records describing every transformation applied during the selected pass.
 * @functions
 *   - MarkdownFlavour: Union type naming the three supported output flavours (module contract).
 *   - FlavourChange: Record shape carrying a human-readable label and its occurrence count (module contract).
 *   - FlavourExport: Result shape pairing serialized markdown with the ordered change records (module contract).
 *   - FlavourOptions: Optional configuration object holding an optional resolveWikiLink callback (module contract).
 *   - FLAVOUR_NAMES: Map of each MarkdownFlavour to its display name (module constant).
 *   - exportMarkdownFlavour: Clones the document root, runs the flavour pass, and serializes the result (public entry point).
 * @dataflow KdocDocument.root -> structuredClone() into a Root -> note() tallies each rewrite in a Map<string, number> -> flavour switch downgrades/rewrites the clone in place -> serializeDocument() renders text -> change records mapped from the tally map.
 * @controlflow Clone root; define note() to increment a shared Map; dispatch on flavour with one case per MarkdownFlavour (commonmark/gfm/portable) each preceded by an explanatory comment and followed by break; serialize the mutated clone and return markdown plus the ordered change records.
 * @version 1
 * @date 2026-09-18
 */

import type { Root } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import { serializeDocument } from '../serialize/serializer.js';
import { downgradeForCommonMark, downgradeForGfm } from './flavour-downgrades.js';
import { linkWikiLinks, type ResolveWikiLink } from './wikilink-links.js';

export type MarkdownFlavour = 'commonmark' | 'gfm' | 'portable';

export interface FlavourChange { readonly label: string; readonly count: number }

export interface FlavourExport { readonly markdown: string; readonly changes: readonly FlavourChange[] }

export interface FlavourOptions { readonly resolveWikiLink?: ResolveWikiLink }

/** Display names for each supported output flavour, keyed by MarkdownFlavour. */
export const FLAVOUR_NAMES: Readonly<Record<MarkdownFlavour, string>> = { commonmark: 'CommonMark', gfm: 'GitHub Flavored Markdown', portable: 'Vault-portable Markdown' };

/**
 * Renders a K-Doc document in one of three flavours by cloning its tree, running the matching rewrite pass, and serializing the result.
 *
 * @purpose Deep-clones the open document's root so the source is never mutated, runs exactly one flavour-specific pass that rewrites the clone in place while tallying each transformation via note(), then serializes the rewritten clone to a markdown string; returns both the text and the ordered change records.
 * @inputs document - The KdocDocument whose root node tree is cloned (never mutated) as the starting point for rendering.
 * @inputs flavour - MarkdownFlavour selecting which rewrite pass runs: 'commonmark' or 'gfm' downgrades, 'portable' rewrites wikilinks.
 * @inputs options - Optional FlavourOptions; when omitted defaults to {} and the portable flavour falls back to a resolve function that resolves nothing.
 * @outputs FlavourExport - The serialized markdown string plus an ordered array of { label, count } change records describing every transformation applied during the selected pass.
 * @dataflow document.root -> structuredClone() into a Root -> note() tallies each rewrite in a Map<string, number> -> flavour switch downgrades/rewrites the clone in place -> serializeDocument() renders text -> [...counts] mapped to { label, count } pairs.
 * @controlflow Clone root; define note() to increment a shared Map; dispatch on flavour with one case per MarkdownFlavour (commonmark/gfm/portable) each preceded by an explanatory comment and followed by break; serialize the mutated clone and return markdown plus the ordered change records.
 */
export function exportMarkdownFlavour(document: KdocDocument, flavour: MarkdownFlavour, options: FlavourOptions = {}): FlavourExport {
  const root = structuredClone(document.root) as Root; // the open document is never changed

  const counts = new Map<string, number>();
  const note = (label: string): void => {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  };

  switch (flavour) {
    // commonmark: strip GitHub-flavored extensions so the output is strict CommonMark.
    case 'commonmark':
      downgradeForCommonMark(root, note);
      break;
    // gfm: keep GitHub Flavored Markdown syntax but normalize it via the gfm downgrade pass.
    case 'gfm':
      downgradeForGfm(root, note);
      break;
    // portable: rewrite K-Doc wikilinks into relative links so the file is portable to any vault.
    case 'portable':
      linkWikiLinks(root, options.resolveWikiLink ?? ((): null => null), note);
      break;
  }

  const markdown = serializeDocument({ text: '', root, frontMatter: null });
  return { markdown, changes: [...counts].map(([label, count]) => ({ label, count })) };
}
