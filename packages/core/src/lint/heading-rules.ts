/**
 * @file heading-rules.ts
 * @purpose Two document-linting rules for FR-12.7: detect outline heading-level skips (H1→H3) with an in-place quick fix, and detect duplicate top-level headings ignoring case and whitespace.
 * @inputs A KdocDocument whose `text` is the original source and whose `root.children` are top-level mdast nodes; each heading node exposes a numeric `depth` and a source `position`.
 * @outputs An array of LintFinding records, one per detected skip or duplicate, each carrying rule id, label, message, source range, and an optional quick fix.
 * @functions
 *   - headingSkips: Detect top-level headings that jump more than one outline level below the previous heading, with a quick fix to insert the missing level.
 *   - duplicateHeadings: Detect top-level headings whose normalised text matches an earlier heading, reporting the line of the first occurrence.
 * @dataflow KdocDocument → iterate root.children → per-heading structural checks and nodeText/offset helpers → LintFinding[] returned to callers.
 * @controlflow For each top-level child, filter to headings with numeric depth and a source range; accumulate findings while tracking previous level / seen offsets; return collected findings.
 * @version 1
 * @date 2026-09-14
 */

import type { KdocDocument } from '../ast/types.js';
import { lineNumberAt, nodeRange, nodeText, type LintFinding, type LintFix, type LintNode } from './lint-finding.js';

/**
 * @purpose Detect top-level headings that skip an outline level relative to the preceding heading (e.g. H1 directly followed by H3).
 * @inputs doc - The KdocDocument whose `root.children` are scanned for top-level headings and whose `text` supplies source offsets for the quick fix.
 * @outputs An array of LintFinding records, each with rule 'heading-skip', a label/message describing the jump, the heading's source range, and an optional quick fix that inserts the missing level.
 * @dataflow doc.root.children → per-node depth/range checks → nodeText for label and regex over doc.text.slice(range) for the fix → findings array returned.
 * @controlflow Track `previous` level; for each heading with a numeric depth and range, if it jumps more than one step below previous push a finding; always update previous to this heading's depth.
 */
export function headingSkips(doc: KdocDocument): LintFinding[] {
  const findings: LintFinding[] = [];
  let previous: number | null = null;

  for (const child of doc.root.children) {
    // Read the child structurally so type, depth, and position are inspected without relying on mdast's declared node types.
    const node = child as unknown as LintNode & { readonly depth?: number };

    // Skip anything that is not a top-level heading or lacks a numeric depth value.
    if (node.type !== 'heading' || typeof node.depth !== 'number') {
      continue;
    }

    // Read the source range up front so it can be reused for both the finding and the fix.
    const range = nodeRange(node);

    // Skip headings whose source range is unavailable so offsets cannot be computed.
    if (range === null) {
      continue;
    }

    // `depth` is narrowed to number by the guard above.
    const depth = node.depth;

    // A skip occurs only once a prior level exists and this heading drops more than one step down the outline.
    if (previous !== null && depth > previous + 1) {
      // Outline skipped a level (e.g. H1 then H3): build the finding's label, message, and target level.
      const text = nodeText(node).trim();
      const label = text.length > 0 ? text : '(empty heading)';
      const message = `Heading level jumps from H${previous} to H${depth}`;
      const target = previous + 1;

      // Capture the hash run so the fix rewrites only the hashes. A heading's position starts at its first
      // hash, after any indentation, so the run is at the very start of the slice; {1,6} bounds ATX depths.
      const match = /^(#{1,6})/.exec(doc.text.slice(range.from, range.to));

      // Offer a quick fix only when a hash run matched (a setext heading has no hashes to change), otherwise report null.
      const fix: LintFix | null =
        match !== null && match[1] !== undefined
          ? {
              label: `Make it H${target}`,
              edits: [
                {
                  from: range.from,
                  to: range.from + match[1].length,
                  insert: '#'.repeat(target),
                },
              ],
            }
          : null;

      findings.push({ rule: 'heading-skip', label, message, from: range.from, to: range.to, fix });
    } else {
      // Not a level skip (or no previous heading yet): nothing to report for this node.
    }

    // Record this heading's level as the baseline for the next iteration regardless of whether it was a skip.
    previous = depth;
  }

  return findings;
}

/**
 * @purpose Detect top-level headings whose normalised text matches an earlier heading in the document.
 * @inputs doc - The KdocDocument whose `root.children` are scanned for top-level headings and whose `text` supplies offsets for line-number lookups.
 * @outputs An array of LintFinding records, each with rule 'duplicate-heading', the heading's text as label, a message naming the first occurrence's line, its source range, and no fix.
 * @dataflow doc.root.children → nodeText normalised to a key → Map lookup by key → lineNumberAt(doc.text, first) for the message → findings array returned.
 * @controlflow Maintain `seen` mapping normalised text to first start offset; for each heading with a range and non-empty key, report a duplicate when the key was seen else record its offset.
 */
export function duplicateHeadings(doc: KdocDocument): LintFinding[] {
  const findings: LintFinding[] = [];
  // Maps a normalised heading text to the start offset of the first heading that produced it.
  const seen = new Map<string, number>();

  for (const child of doc.root.children) {
    // Read the child structurally so type and position are inspected without relying on mdast's declared node types.
    const node = child as unknown as LintNode & { readonly depth?: number };

    // Skip non-heading nodes so only headings are considered for duplication.
    if (node.type !== 'heading') {
      continue;
    }

    // Read the source range up front so it can be reused for both the finding and the message lookup.
    const range = nodeRange(node);

    // Skip headings whose source range is unavailable so offsets cannot be reported.
    if (range === null) {
      continue;
    }

    // Normalise to a case- and whitespace-insensitive key that groups equivalent heading texts together.
    const key = nodeText(node).trim().replace(/\s+/g, ' ').toLowerCase();

    // Skip empty headings so blank titles are not tracked as duplicates.
    if (key === '') {
      continue;
    }

    // Look up whether this normalised text was already recorded earlier in the document.
    const first = seen.get(key);

    if (first !== undefined) {
      // A previous heading shares this text: report the duplicate against its line number with no fix.
      findings.push({
        rule: 'duplicate-heading',
        label: nodeText(node).trim(),
        message: `Same heading as line ${lineNumberAt(doc.text, first)}`,
        from: range.from,
        to: range.to,
        fix: null,
      });
    } else {
      // First occurrence of this text: remember its start offset for future comparisons.
      seen.set(key, range.from);
    }
  }

  return findings;
}
