/**
 * @file rich-inline-scan.ts
 * @purpose Scan K-Doc Tier-4 inline constructs (highlight, subscript, superscript): map resolved
 *   value characters to source byte offsets and enumerate unescaped delimiter occurrences.
 * @inputs Escape-resolved `value`, raw `source`, per-character source offsets, and an owning child index.
 * @outputs Source offset arrays from `sourceOffsets`; delimiter hits from `scanDelimiters`; the
 *   `RichInline` AST shape and marker table shared with the transform layer.
 * @functions
 *   - sourceOffsets: Align each value character to its raw-source byte offset, skipping escapes.
 *   - scanDelimiters: Enumerate every unescaped highlight/subscript/superscript delimiter occurrence.
 * @dataflow Source bytes → resolved value + offsets → hits tagged with childIndex.
 * @controlflow Guard bad inputs; linearly scan once, branching on marker type and escape/neighbour rules.
 * @version 1
 * @date 2026-09-06
 */

import type { Parent, PhrasingContent } from 'mdast';

/** The three Tier-4 inline constructs recognised by this module. */
export type RichInlineType = 'highlight' | 'subscript' | 'superscript';

/** AST node for a recognised construct; extends mdast Parent to nest phrasing children uniformly. */
export interface RichInline extends Parent {
  type: RichInlineType;
  children: PhrasingContent[];
}

/** Literal marker text per construct: two-character `==` for highlight, single characters otherwise. */
export const RICH_INLINE_MARKERS: Readonly<Record<RichInlineType, string>> = {
  highlight: '==',
  subscript: '~',
  superscript: '^',
};

/** A single unescaped delimiter occurrence; valueIndex + length delimit the marker within value. */
export interface DelimiterHit {
  readonly childIndex: number;
  readonly valueIndex: number;
  readonly type: RichInlineType;
  readonly length: number;
}

/**
 * @purpose Reconstruct each resolved value character's byte offset by walking the raw source in
 *   lockstep, compensating for remark's backslash-escape resolution.
 * @inputs source - raw markdown with any backslash escapes; value - resolved text with escapes
 *   collapsed; startOffset - source byte offset at which `value` begins.
 * @returns Readonly array of length equal to `value`, each entry the source byte offset of the
 *   matching value character, or `[]` when alignment is impossible.
 * @dataflow Two pointers advance together: escape pairs consume two source bytes per value char,
 *   plain matches consume one of each, producing aligned offsets.
 * @controlflow Return [] on a negative startOffset; then loop while v < value.length branching
 *   escape-match → plain-match → bail-out; return collected offsets when fully aligned.
 */
export function sourceOffsets(
  source: string,
  value: string,
  startOffset: number,
): readonly number[] {
  // A negative start offset means the node sits before the document's first byte, which is impossible;
  // there are no valid offsets to recover, so refuse rather than fabricate a misaligned mapping.
  if (startOffset < 0) {
    return [];
  }

  const result: number[] = [];
  let s = startOffset; // pointer into raw source bytes
  let v = 0;           // pointer into the resolved value characters

  while (v < value.length) {
    const srcChar = source[s];       // current source byte, possibly undefined past the end
    const nextSrcChar = source[s + 1]; // byte following the current one
    const valChar = value[v];        // expected resolved character for this position

    // Escape compensation: remark collapsed a `\X` pair in the source into a single `X` in the value,
    // so when the source shows a backslash followed by the exact char we expect, skip the backslash and
    // line up with the resolved character at s + 1. Without this, a deliberately escaped `\==not a
    // highlight\==` would desync the two sequences and be misread as a real highlight — the FR-4.4
    // fidelity failure (the editor rewriting what the user wrote) that this alignment exists to prevent.
    if (srcChar === '\\' && nextSrcChar === valChar) {
      result.push(s + 1);
      s += 2;
      v += 1;
      continue;
    }

    // Plain match: the two sequences are still in step, so this value character maps directly to source byte s.
    if (srcChar === valChar) {
      result.push(s);
      s += 1;
      v += 1;
      continue;
    }

    // Out of alignment: the source can no longer produce the expected value character. Bailing with `[]`
    // lets the caller decline to transform, leaving the text exactly as written — declining is the safe
    // failure that preserves user intent instead of silently rewriting it.
    return [];
  }

  return result;
}

/**
 * @purpose Enumerate every unescaped Tier-4 delimiter occurrence so the transform layer can wrap each
 *   range without rewriting an escaped or gfm-owned construct.
 * @inputs value - resolved text to scan; offsets - per-character source offsets from `sourceOffsets`;
 *   source - raw markdown used to test for preceding backslashes; childIndex - owning phrasing node's
 *   index, passed through onto every hit.
 * @returns Readonly array of `DelimiterHit` records in ascending valueIndex order, or `[]` when the
 *   offsets cannot be trusted.
 * @dataflow For each position resolve which marker starts there, verify it is unescaped and not a gfm
 *   delete tilde, then emit a hit carrying childIndex plus resolved type and length.
 * @controlflow Reject mismatched offset/value lengths up front; scan left-to-right, branching on
 *   longest-marker detection, escape skip, and tilde-neighbour skip before recording qualifying hits.
 */
export function scanDelimiters(
  value: string,
  offsets: readonly number[],
  source: string,
  childIndex: number,
): readonly DelimiterHit[] {
  // The offsets must map one-to-one onto the value characters; if they do not we have no trustworthy
  // position mapping and must refuse rather than emit hits that would slice the wrong byte ranges.
  if (offsets.length !== value.length) {
    return [];
  }

  const hits: DelimiterHit[] = [];

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    const char = value[valueIndex]; // resolved character at this position, guarded by the loop bound

    // Resolve which marker starts here. The two-character highlight is tested before either single-char
    // marker so that `==` is never misread as two subscripts or superscripts (longest-match-first).
    let type: RichInlineType | undefined;
    let length = 0;

    if (char === '=' && value[valueIndex + 1] === '=') {
      type = 'highlight';
      length = 2;
    } else if (char === '~') {
      type = 'subscript';
      length = 1;
    } else if (char === '^') {
      type = 'superscript';
      length = 1;
    }

    // No Tier-4 marker begins at this position, so there is nothing to record here.
    if (type === undefined) {
      continue;
    }

    // An occurrence is escaped when a backslash immediately precedes it in the source; escaped delimiters
    // are skipped verbatim so the engine never rewrites a deliberately-escaped construct into real syntax.
    const offset = offsets[valueIndex]; // number | undefined, but the length guard guarantees presence
    if (offset === undefined || source[offset - 1] === '\\') {
      continue;
    }

    // A tilde flanked on either side by another tilde is skipped. remark-gfm runs with `singleTilde:
    // false`, so a genuine `~~x~~` is already parsed as a `delete` node and its tildes never reach this
    // text node; but a stray, unbalanced `~~` in ordinary prose must still never be read as two subscripts.
    if (char === '~') {
      const leftTilde = value[valueIndex - 1] === '~';
      const rightTilde = value[valueIndex + 1] === '~';
      if (leftTilde || rightTilde) {
        continue;
      }
    }

    // The occurrence qualifies: record it with the passed-through child index and its marker length so
    // the caller can slice `value` directly without re-deriving the extent.
    hits.push({ childIndex, valueIndex, type, length });

    // Advance past the whole marker. Without this a two-character `==` is also matched starting at its
    // second `=`, so `====` yields three overlapping hits instead of two and the caller's slices double
    // back over each other -- which turned an empty `====` into six characters on the way out.
    valueIndex += length - 1;
  }

  return hits;
}
