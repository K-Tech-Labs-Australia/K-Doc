/**
 * @file similarity.test.ts
 * @purpose Calibrates the fuzzy-match threshold used by comment anchoring and exercises hashBlock/blockAround helpers.
 * @inputs The similarity function, anchor-text helpers (hashBlock, blockAround, MIN_SIMILARITY), and the NL constant.
 * @outputs Vitest assertions pinning Dice-coefficient scores to measured values that keep MIN_SIMILARITY stable.
 * @functions
 *   - describe/it blocks: threshold calibration cases and hashBlock/blockAround behaviour cases.
 * @dataflow Candidate strings -> similarity score -> assertion against a pinned value; document text -> blockAround -> paragraph.
 * @controlflow Each test asserts one side of the threshold or one helper behaviour, failing loudly on drift.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { similarity } from './similarity.js';
import { hashBlock, blockAround, MIN_SIMILARITY } from './anchor-text.js';

const NL = String.fromCharCode(10);

describe('fuzzy threshold calibration', () => {
  // Orphaning is safe; mis-anchoring is not. An orphaned comment is listed with its quoted text and the user re-anchors it in a moment. A comment resolved to the *wrong* text points at something nobody commented on, and does it with confidence. MIN_SIMILARITY therefore sits where a lightly edited *sentence* survives and a short quote with a word replaced does not — these numbers were measured against the implementation rather than chosen, and are asserted so the constant cannot drift away from them unnoticed.

  // Above: one word changed in a long sentence must keep its comment.
  it('keeps a comment when a single word changes in a long sentence', () => {
    expect(similarity('a much longer sentence that someone commented on', 'a much longer sentence that somebody commented on')).toBeCloseTo(0.905, 2);
  });

  // Above: an inserted word must keep its comment.
  it('keeps a comment when a word is inserted into a long sentence', () => {
    expect(similarity('a much longer sentence that someone commented on', 'a much longer sentence that someone has commented on')).toBeCloseTo(0.959, 2);
  });

  // Above: a transposed typo must not orphan a comment.
  it('keeps a comment when two characters are transposed', () => {
    expect(similarity('quick brown fox', 'quick brown fxo')).toBeCloseTo(0.857, 2);
  });

  // Below: a third of a short quote replaced is too little to be sure, and a wrong anchor is worse than an orphan.
  it('orphans a comment when a third of a short quote is replaced', () => {
    expect(similarity('quick brown fox', 'quick red fox ')).toBeCloseTo(0.593, 2);
  });

  // Below: replacing one word of a very short quote is not enough to be sure.
  it('orphans a comment when one word of a two-word quote changes', () => {
    expect(similarity('the lazy dog', 'the sleepy dog')).toBeCloseTo(0.583, 2);
  });

  // Exactly zero: no shared bigram means the texts are unrelated and must never be anchored together.
  it('scores exactly zero for completely unrelated text', () => {
    expect(similarity('quick brown fox', 'totally unrelated')).toBe(0);
  });

  // Exactly one: identical strings always match at full confidence.
  it('scores exactly one for identical strings', () => {
    expect(similarity('short', 'short')).toBe(1);
  });

  // Sub-two-character case has no bigrams, so equality is the only signal available.
  it('treats sub-two-character strings by exact equality', () => {
    expect(similarity('a', 'a')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });

  // Less than one: multiplicity is counted, so a repeated run is not mistaken for an identical longer string.
  it('scores below one when bigrams repeat with different multiplicity', () => {
    expect(similarity('aaa', 'aaaaaa')).toBeLessThan(1);
  });

  // The threshold itself sits where the sentence survives and the short quote does not.
  it('pins MIN_SIMILARITY at 0.75', () => {
    expect(MIN_SIMILARITY).toBe(0.75);
  });
});

describe('hashBlock and blockAround', () => {
  // Deterministic: the same input always hashes to the same value.
  it('returns the same hash for identical input', () => {
    expect(hashBlock('same')).toBe(hashBlock('same'));
  });

  // Distinct inputs must not collide, so different blocks anchor differently.
  it('returns a different hash for different input', () => {
    expect(hashBlock('one')).not.toBe(hashBlock('two'));
  });

  // Even empty text produces a usable, non-empty block identifier.
  it('produces a non-empty hash for empty input', () => {
    expect(hashBlock('').length).toBeGreaterThan(0);
  });

  // The offset lands inside the target paragraph and not its neighbours.
  it('returns only the paragraph containing the offset', () => {
    const doc = 'One.' + NL + NL + 'Two.' + NL + NL + 'Three.';
    const start = doc.indexOf('Two.');
    expect(blockAround(doc, start)).toContain('Two.');
    expect(blockAround(doc, start)).not.toContain('One.');
    expect(blockAround(doc, start)).not.toContain('Three.');
  });

  // An offset past the end is clamped rather than throwing.
  it('clamps an out-of-range offset instead of throwing', () => {
    const doc = 'One.' + NL + NL + 'Two.' + NL + NL + 'Three.';
    expect(() => blockAround(doc, doc.length * 10)).not.toThrow();
  });
});
