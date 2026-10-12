/**
 * @file lint-document.ts
 * @purpose Runs every document-linting rule (FR-12.7) over a parsed K-Doc document and merges their findings into one list.
 * @inputs A parsed KdocDocument to lint; optional LintOptions carrying the set of image URLs already reported missing by the host.
 * @outputs A single stable-sorted list of LintFinding values covering headings, links, tables, and images.
 * @functions
 *   - lintDocument: Run every rule in a fixed order, merge their findings, and return them sorted by source offset; in-document anchors are checked only when a hasAnchor lookup is given.
 * @dataflow Options.missingImageUrls → default-empty set; doc → each rule produces findings → concatenated in fixed rule order → stable-sorted by from → returned diagnostics list.
 * @controlflow Resolve the missing-image set with a `??` default; build the ordered concatenation of all five rule outputs; return a copy sorted ascending by from, ties preserving rule order.
 * @version 1
 * @date 2026-09-14
 */

import type { KdocDocument } from '../ast/types.js';
import { duplicateHeadings, headingSkips } from './heading-rules.js';
import { emptyLinks, localImages, missingImages } from './link-rules.js';
import { malformedTables } from './table-rules.js';
import { brokenAnchors } from './anchor-rules.js';
import type { LintFinding } from './lint-finding.js';


export interface LintOptions {
  /** Image addresses, as written, whose files the host found missing. Absent means none are known missing. */
  readonly missingImageUrls?: ReadonlySet<string>;
  /** Whether a heading in the document has this anchor. Absent, in-document anchors are not checked. */
  readonly hasAnchor?: (slug: string) => boolean;
}

/**
 * @purpose Run every document-linting rule over `doc` and merge their findings into one stable-sorted list.
 * @inputs doc - The parsed K-Doc document to lint.
 *   options - Optional settings; when omitted, no image URLs are treated as missing.
 * @outputs A readonly list of LintFinding values ordered by ascending source offset, ties preserving rule order.
 * @dataflow Options.missingImageUrls → default-empty set; doc → headingSkips/duplicateHeadings/emptyLinks/malformedTables and missingImages(localImages(doc), missing) → concatenated in fixed order → sorted by from → returned list.
 * @controlflow Resolve the missing set with `??`; build the ordered concatenation of all five rule outputs; return a copy sorted ascending by from so equal offsets keep their original (rule) order.
 */
export function lintDocument(doc: KdocDocument, options?: LintOptions): readonly LintFinding[] {
  // Resolve the set of image URLs already reported missing; default to empty when no options are supplied.
  const missing = options?.missingImageUrls ?? new Set<string>();

  // Concatenate every rule's findings in a fixed order so ties during sorting stay deterministic.
  const findings: LintFinding[] = [
    ...headingSkips(doc),
    ...duplicateHeadings(doc),
    ...emptyLinks(doc),
    ...malformedTables(doc),
    ...missingImages(localImages(doc), missing),
    // The anchor rule needs the renderer's slug rule, which only the caller has.
    ...(options?.hasAnchor === undefined ? [] : brokenAnchors(doc, options.hasAnchor)),
  ];

  // Array.prototype.sort is stable (ES2019+), so comparing only `from` keeps the concatenation order for equal offsets.
  return [...findings].sort((a, b) => a.from - b.from);
}
