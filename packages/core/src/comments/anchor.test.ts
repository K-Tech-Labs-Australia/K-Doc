import { describe, expect, it } from 'vitest';
import { createAnchor, resolveAnchor } from './anchor.js';

// Newlines are built rather than escaped so a mangled fixture cannot pass while proving nothing.
const NL = String.fromCharCode(10);
const BASE = '# Notes' + NL + NL + 'The quick brown fox jumps over the lazy dog.' + NL + NL + 'Second paragraph here.' + NL;
const QUOTE = 'quick brown fox';

function anchorForQuote(): ReturnType<typeof createAnchor> {
  const start = BASE.indexOf(QUOTE);
  return createAnchor(BASE, start, start + QUOTE.length);
}

// @file anchor.test.ts — Vitest suite for createAnchor and resolveAnchor resolution behaviour.
// @purpose Assert quoted-text capture, offset clamping/reversal, and edit-surviving resolution (exact/context/quote/orphan).
// @inputs BASE fixture text; QUOTE substring; CommentAnchor values produced by createAnchor.
// @outputs ResolvedAnchor | null outcomes checked for kind, offsets, confidence, and slice equality.
// @version 1
// @date 2026-09-06

describe('createAnchor', () => {
  // Captures the quoted text, surrounding context windows, offset, and block hash.
  it('captures quote, context, offset, and block hash', () => {
    const anchor = anchorForQuote();
    expect(anchor.quotedText).toBe(QUOTE);
    expect(anchor.prefixContext.length).toBeGreaterThan(0);
    expect(anchor.suffixContext.length).toBeGreaterThan(0);
    expect(anchor.charOffset).toBe(BASE.indexOf(QUOTE));
    expect(anchor.blockHash.length).toBeGreaterThan(0);
  });

  // Reversed offsets must yield the same quoted text as ordered ones.
  it('treats reversed offsets identically to ordered ones', () => {
    const start = BASE.indexOf(QUOTE);
    const ordered = createAnchor(BASE, start, start + QUOTE.length);
    const reversed = createAnchor(BASE, start + QUOTE.length, start);
    expect(reversed.quotedText).toBe(ordered.quotedText);
  });

  // Offsets beyond the document length are clamped rather than throwing.
  it('clamps out-of-range offsets instead of throwing', () => {
    const anchor = createAnchor(BASE, -100, BASE.length + 500);
    expect(anchor.charOffset).toBe(0);
    expect(anchor.quotedText).toBe(BASE);
  });
});

describe('resolveAnchor', () => {
  // An unedited document resolves exactly with full confidence.
  it('resolves an unedited anchor as exact with full confidence', () => {
    const anchor = anchorForQuote();
    const result = resolveAnchor(BASE, anchor);
    if (result === null) {
      throw new Error('unedited anchor should resolve');
    }
    expect(result.kind).toBe('exact');
    expect(result.confidence).toBe(1);
    expect(BASE.slice(result.start, result.end)).toBe(QUOTE);
  });

  // A paragraph inserted above shifts offsets but keeps the block intact.
  it('resolves when a paragraph is inserted above the quote', () => {
    const anchor = anchorForQuote();
    const edited = 'Inserted line.\n' + BASE;
    const result = resolveAnchor(edited, anchor);
    // Which rung rescues this depends on whether the surrounding context survived; the guarantee is that it resolves, not how.
    if (result === null) {
      throw new Error('anchor should still resolve after an above-paragraph insert');
    }
    expect(edited.slice(result.start, result.end)).toBe(QUOTE);
  });

  // A duplicate far below must not pull resolution away from the original offset.
  it('lands on the original offset even when the quote repeats below', () => {
    const anchor = anchorForQuote();
    const edited = BASE + '\n\nA second quick brown fox appears far below.\n';
    const result = resolveAnchor(edited, anchor);
    if (result === null) {
      throw new Error('anchor should still resolve');
    }
    expect(result.start).toBe(BASE.indexOf(QUOTE));
  });

  // Deleting the quoted sentence removes every occurrence of the quote.
  it('returns null when the quoted sentence is deleted entirely', () => {
    const anchor = anchorForQuote();
    const edited = BASE.replace('The quick brown fox jumps over the lazy dog.', '');
    expect(resolveAnchor(edited, anchor)).toBeNull();
  });

  // A document with no shared text cannot relocate the anchor.
  it('returns null against a wholly unrelated document', () => {
    const anchor = anchorForQuote();
    const unrelated = 'Completely different content with no shared words at all.\n';
    expect(resolveAnchor(unrelated, anchor)).toBeNull();
  });

  // A zero-width quote is rejected rather than matching everywhere.
  it('returns null for an anchor built with zero-width offsets', () => {
    const anchor = createAnchor(BASE, 5, 5);
    expect(resolveAnchor(BASE, anchor)).toBeNull();
  });
});
