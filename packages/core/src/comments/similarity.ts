/**
 * @file similarity.ts
 * @purpose A fast fuzzy-match score between two strings used by comment anchoring to decide whether a quoted block was
 *   lightly edited from its current text (FR-10.5). It returns the Dice coefficient over character bigrams on 0..1, where
 *   1 means identical and 0 means no shared bigram. This is deliberately NOT an edit-distance score: anchoring only needs to
 *   answer "was this sentence lightly edited", which both metrics rank candidates almost identically for, but Dice runs in
 *   O(n) over the two strings while edit distance is O(n*m). When the score must run across a whole document hunting for a
 *   comment's anchor, the cheaper metric is the right trade-off even though it ignores exactly where edits happened.
 * @inputs Two candidate strings, `a` and `b`, compared character by character on their UTF-16 code units.
 * @outputs A number on 0..1: 1 for identical strings (or equal sub-two-character strings), 0 when no bigram is shared.
 * @functions
 *   - similarity: Dice coefficient over character bigrams, counting shared bigrams with multiplicity.
 * @dataflow Arguments -> per-string bigram multiset -> multiplicity-counted intersection -> normalized 0..1 score.
 * @controlflow Reject the no-bigram case up front to avoid dividing by zero, then build `a`'s multiset, consume matches from
 *   `b`, and return twice the shared count over the total bigram count.
 * @version 1
 * @date 2026-09-06
 */

/**
 * Dice coefficient over character bigrams of two strings, on 0..1.
 * @purpose Score how similar `a` and `b` are for anchoring: 1 when identical, 0 when no bigram is shared.
 * @inputs a - the first candidate string; b - the second candidate string. Both read as UTF-16 code units.
 * @returns A number on 0..1; exactly 1 for equal strings and 0 when no bigram is shared between them.
 * @dataflow Each string's overlapping two-code-unit windows -> `a`'s multiset -> matches consumed from `b` -> normalized ratio.
 * @controlflow Guard the sub-two-character case to avoid a divide-by-zero, then count shared bigrams with multiplicity and return 2*shared/(nA+nB).
 */
export function similarity(a: string, b: string): number {
  // Sub-two-character strings have no overlapping two-code-unit windows at all, so the Dice denominator is zero.
  if (a.length < 2 || b.length < 2) {
    // Branch: with no bigrams to score, equal strings are identical matches (1) and any difference is unrelated (0).
    return a === b ? 1 : 0;
  }

  // Build `a`'s multiset of overlapping two-code-unit windows, keyed by the window's substring.
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < a.length; i++) {
    const key = a.slice(i, i + 2); // one bigram: the UTF-16 code unit pair starting at index i.
    counts.set(key, (counts.get(key) ?? 0) + 1); // increment this window's remaining-match budget in the multiset.
  }

  // Count shared bigrams with multiplicity by consuming each match from `b` once instead of testing set membership.
  // A Set would let repeated windows inflate the shared count; for example "aaa" and "aaaaaa" would score as identical,
  // which is exactly the false confidence an anchor must never act on, so each match is spent at most once against `a`.
  let shared = 0;
  for (let i = 0; i + 1 < b.length; i++) {
    const key = b.slice(i, i + 2); // one bigram: the UTF-16 code unit pair starting at index i.
    const remaining = counts.get(key) ?? 0; // unconsumed matches of this window still available in `a`.
    if (remaining > 0) {
      // Branch: a matching window is still budgeted in `a`; consume it and count this shared occurrence.
      counts.set(key, remaining - 1);
      shared += 1;
    } else {
      // Branch: no unconsumed match remains for this window; it does not add to the shared count.
    }
  }

  const bigramsA = a.length - 1; // overlapping two-code-unit windows in `a`.
  const bigramsB = b.length - 1; // overlapping two-code-unit windows in `b`.

  // Dice coefficient: twice the shared count over the total window count, normalized to 0..1.
  return (2 * shared) / (bigramsA + bigramsB);
}
