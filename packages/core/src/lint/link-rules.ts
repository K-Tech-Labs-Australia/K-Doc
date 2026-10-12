/**
 * @file link-rules.ts
 * @purpose Empty links with quick fixes, local image references, and missing images, FR-12.7.
 * @inputs A KdocDocument (source text plus mdast tree) for link/image scanning; a set of missing URLs for the missing-image check.
 * @outputs Array of empty-link LintFinding records; array of ImageRef records for local images; array of missing-image LintFinding records.
 * @functions
 *   - emptyLinks: Find links missing an address or text and propose quick fixes.
 *   - localImages: Collect image references that point at local files rather than external URLs or anchors.
 *   - missingImages: Turn local image references into findings for addresses absent from disk.
 * @dataflow KdocDocument → walk AST → read node url/children/text/range → classify and build findings or refs → return arrays to callers.
 * @controlflow For each rule, traverse the tree once, branch on node type and content, collect results, and return without side effects.
 * @version 1
 * @date 2026-09-14
 */

import type { KdocDocument } from '../ast/types.js';
import { nodeRange, nodeText, walkNodes, type LintFinding, type LintFix, type LintNode } from './lint-finding.js';

/** A local image reference: the address exactly as written plus its source range. */
export interface ImageRef {
  /** The address exactly as written. */
  readonly url: string;
  readonly from: number;
  readonly to: number;
}

/**
 * @purpose Find links that are missing either their address or their visible text and propose quick fixes.
 * @inputs doc - The parsed KdocDocument whose link nodes are inspected against `doc.text` for offset ranges.
 * @outputs An array of empty-link findings, one per offending link, in document order.
 * @dataflow Walk the AST → read each link's url/children/text/range → classify empty-address vs empty-text → build finding with optional fix → collect into result.
 * @controlflow Visit every node; for links, branch on whether the address is blank (address case) or the text is blank (text case); otherwise skip; return collected findings.
 */
export function emptyLinks(doc: KdocDocument): LintFinding[] {
  const findings: LintFinding[] = [];
  // Start the traversal at the document root, typed structurally as a lint node.
  walkNodes(doc.root as unknown as LintNode, (rawNode) => {
    // Read the node with an optional url field so link/image addresses are accessible.
    const node = rawNode as LintNode & { readonly url?: unknown };
    // Only links carry a URL and are relevant to this rule.
    if (node.type !== 'link') {
      return;
    } else {
      // Not a link; skip without side effects.
    }
    // Require the URL to be an actual string before inspecting it.
    if (typeof node.url !== 'string') {
      return;
    } else {
      // URL is not a string; nothing to lint here.
    }
    const url = node.url;
    // A usable source range is required to build edits and report offsets.
    const range = nodeRange(node);
    if (range === null) {
      return;
    } else {
      // No position metadata; skip the link.
    }
    // Children default to empty when absent.
    const children = node.children ?? [];
    // Trimmed visible text of the whole link span.
    const text = nodeText(node).trim();
    if (url.trim() === '') {
      // Case A: the link has no address; decide a fix from its children.
      const first = children[0];
      const last = children[children.length - 1];
      // Range of the first child, or null when it is absent.
      const firstRange = first !== undefined ? nodeRange(first) : null;
      // Range of the last child, or null when it is absent.
      const lastRange = last !== undefined ? nodeRange(last) : null;
      let fix: LintFix | null;
      if (firstRange !== null && lastRange !== null) {
        // Both endpoints expose ranges: unwrap the link and keep its inner text.
        fix = {
          label: 'Remove the link, keep the text',
          edits: [
            {
              from: range.from,
              to: range.to,
              insert: doc.text.slice(firstRange.from, lastRange.to),
            },
          ],
        };
      } else if (children.length === 0) {
        // No children at all: drop the entire link span.
        fix = {
          label: 'Remove the empty link',
          edits: [{ from: range.from, to: range.to, insert: '' }],
        };
      } else {
        // Children exist but lack usable ranges: no safe edit can be produced.
        fix = null;
      }
      findings.push({
        rule: 'empty-link',
        label: text.length > 0 ? text : '(no text)',
        message: 'Link has no address',
        from: range.from,
        to: range.to,
        fix,
      });
    } else if (text === '' && !children.some((child) => child.type === 'image')) {
      // Case B: the link has an address but no visible text and no image child.
      // When the source literally reads "[]", inject the address as link text; otherwise no fix.
      const fix = doc.text.slice(range.from, range.from + 2) === '[]'
        ? {
            label: 'Use the address as text',
            edits: [{ from: range.from + 1, to: range.from + 1, insert: url }],
          }
        : null;
      findings.push({
        rule: 'empty-link',
        label: url,
        message: 'Link has no text',
        from: range.from,
        to: range.to,
        fix,
      });
    } else {
      // Normal link with both text and address; nothing to report.
    }
  });
  return findings;
}

/**
 * @purpose Collect local image references that point at files rather than external URLs or anchors.
 * @inputs doc - The parsed KdocDocument whose image nodes are inspected for their address strings and ranges.
 * @outputs An array of ImageRef records for each local image, in document order.
 * @dataflow Walk the AST → read each image's url/range → classify drive/scheme/anchor vs relative path → push matching refs.
 * @controlflow Visit every node; for images, skip empty addresses, external schemes, and anchors; record the remaining local references.
 */
export function localImages(doc: KdocDocument): ImageRef[] {
  const images: ImageRef[] = [];
  // Start the traversal at the document root, typed structurally as a lint node.
  walkNodes(doc.root as unknown as LintNode, (rawNode) => {
    // Read the node with an optional url field so image addresses are accessible.
    const node = rawNode as LintNode & { readonly url?: unknown };
    // Only images carry a URL relevant to local-reference detection.
    if (node.type !== 'image') {
      return;
    } else {
      // Not an image; skip without side effects.
    }
    // Require the URL to be an actual string before inspecting it.
    if (typeof node.url !== 'string') {
      return;
    } else {
      // URL is not a string; nothing to report here.
    }
    const url = node.url;
    // A usable source range is required to record offsets.
    const range = nodeRange(node);
    if (range === null) {
      return;
    } else {
      // No position metadata; cannot record offsets, so skip.
    }
    // Whitespace-trimmed form drives all classification decisions.
    const trimmed = url.trim();
    if (trimmed === '') {
      // Empty address: not a usable local reference, skip it.
      return;
    } else {
      // Non-empty address; continue classifying below.
    }
    // A drive-letter prefix like C:\ or C:/ marks a Windows local file path.
    const isDrive = /^[a-z]:[\\/]/i.test(trimmed);
    // Excludes drive paths: scheme URLs (http:, data:, file:) and protocol-relative links are not checked.
    const isExternal = !isDrive && (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//'));
    if (isExternal || trimmed.startsWith('#')) {
      // External, scheme-based, or in-document anchor: out of scope for local-image checks.
      return;
    } else {
      // Local file reference: record it below.
    }
    images.push({ url, from: range.from, to: range.to });
  });
  return images;
}

/**
 * @purpose Turn a set of local image references into findings for those whose files are absent.
 * @inputs images - The candidate ImageRef records to check.
 *   missingUrls - The set of addresses known to be missing from disk.
 * @outputs An array of missing-image findings, one per matching reference, in input order.
 * @dataflow Iterate images → test membership in missingUrls → emit finding for matches only.
 * @controlflow Loop over images; push a finding when the address is present in the set, otherwise continue.
 */
export function missingImages(images: readonly ImageRef[], missingUrls: ReadonlySet<string>): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const image of images) {
    // Only report addresses the caller has flagged as absent on disk.
    if (missingUrls.has(image.url)) {
      findings.push({
        rule: 'missing-image',
        label: image.url,
        message: 'Image file not found',
        from: image.from,
        to: image.to,
        fix: null,
      });
    } else {
      // Address is present (or unflagged); no finding emitted.
    }
  }
  return findings;
}
