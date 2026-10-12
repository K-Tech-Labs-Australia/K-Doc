/**
 * @file anchor-rules.ts
 * @purpose Broken-anchor detection for FR-12.7: links that point at an in-document heading slug which no heading defines.
 * @inputs A KdocDocument (source text plus mdast tree) whose link nodes are scanned; a predicate reporting whether a decoded slug matches an existing heading anchor.
 * @outputs Array of broken-anchor LintFinding records, one per link whose target heading is absent.
 * @functions
 *   - brokenAnchors: Find links whose in-document anchor resolves to no heading and report them.
 *   - decode: Percent-decode an anchor slug, tolerating a stray literal '%'.
 * @dataflow KdocDocument → walk AST → read each link's url/range → strip the leading '#', percent-decode the remainder → test against hasAnchor → push findings for unmatched anchors.
 * @controlflow Visit every node; for links with a string url and a usable range, branch on anchor vs placeholder vs matched-slug and collect only broken references.
 * @version 1
 * @date 2026-09-14
 */

import type { KdocDocument } from '../ast/types.js';
import { nodeRange, walkNodes, type LintFinding, type LintNode } from './lint-finding.js';

/**
 * @purpose Find links that point at an in-document anchor which no heading defines.
 * @inputs doc - The parsed KdocDocument whose link nodes are inspected against `doc.text` for offset ranges.
 *   hasAnchor - A predicate returning true when a decoded slug matches a heading anchor present in the document.
 * @outputs An array of broken-anchor findings, one per offending link, in document order.
 * @dataflow Walk the AST → read each link's url/range → strip '#', percent-decode the remainder → test hasAnchor → push finding for unmatched anchors only.
 * @controlflow Visit every node; for links with a string url and a usable range, branch on anchor vs placeholder vs matched-slug; collect broken references and return.
 */
export function brokenAnchors(doc: KdocDocument, hasAnchor: (slug: string) => boolean): LintFinding[] {
  const findings: LintFinding[] = [];
  // Start the traversal at the document root, typed structurally as a lint node.
  walkNodes(doc.root as unknown as LintNode, (rawNode) => {
    // Read the node with an optional url field so link addresses are accessible.
    const node = rawNode as LintNode & { readonly url?: unknown };
    // Only links carry in-document anchors relevant to this rule.
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
    // A usable source range is required to report offsets and build the finding.
    const range = nodeRange(node);
    if (range === null) {
      return;
    } else {
      // No position metadata; skip the link.
    }
    // Whitespace-trimmed form drives all anchor decisions below.
    const trimmed = url.trim();
    // A leading '#' marks an in-document anchor reference rather than a file or external URL.
    if (!trimmed.startsWith('#')) {
      return;
    } else {
      // Anchor-style link; continue classifying the target below.
    }
    // Strip the leading '#'; the remainder is the raw anchor slug as written.
    const raw = trimmed.slice(1);
    if (raw === '') {
      // A bare '#' is a placeholder, not an anchor reference, so skip it.
      return;
    } else {
      // Non-empty anchor target; decode and test it below.
    }
    // Percent-decode the slug so it can be compared against heading anchors.
    const slug = decode(raw);
    if (hasAnchor(slug)) {
      // The target resolves to an existing heading; not broken, skip.
      return;
    } else {
      // No matching heading: this is a broken anchor, report it below.
    }
    findings.push({
      rule: 'broken-anchor',
      label: trimmed,
      message: 'No heading in this document has this anchor',
      from: range.from,
      to: range.to,
      fix: null,
    });
  });
  return findings;
}

/**
 * @purpose Percent-decode an anchor slug for comparison against heading anchors.
 * @inputs value - The raw anchor text as extracted from a link URL.
 * @outputs The decoded string when valid, or the original value on a malformed sequence.
 * @dataflow Input → decodeURIComponent → returned string, or fallback to input on URIError.
 * @controlflow Attempt decoding; on URIError return the untouched input, otherwise rethrow unexpected errors.
 */
function decode(value: string): string {
  try {
    // Standard percent-decoding of a well-formed anchor slug.
    return decodeURIComponent(value);
  } catch (caught) {
    // A literal '%' that is not part of a valid escape sequence is not an error for anchors; keep the original text.
    if (caught instanceof URIError) {
      return value;
    } else {
      // Not a decoding failure: propagate the unexpected error to the caller.
      throw caught;
    }
  }
}
