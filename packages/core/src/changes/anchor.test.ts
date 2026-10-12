/**
 * @file anchor.test.ts
 * @purpose Tests the partial-context rung of resolveChangeAnchor: a change whose context was partly rewritten by a neighbouring decision is still placed by the context that survives, and too little context is not trusted.
 * @inputs hand-built anchors and texts passed to resolveChangeAnchor.
 * @outputs vitest assertions on the resolved range (start/end) and rung (kind).
 * @functions none.
 * @dataflow anchor + text -> resolveChangeAnchor -> range and rung.
 * @controlflow one case per rule: surviving suffix, surviving prefix, and under-threshold context rejection.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { resolveChangeAnchor } from './anchor.js';

describe('resolveChangeAnchor partial context', () => {
  // A neighbouring decision rewrote the middle of the prefix; only the surviving tail of the prefix plus the full suffix should place the change.
  it('keeps the suffix and a surviving tail of the prefix', () => {
    const text = '---\nid: 1\n---\n\nAlpha Second Third pass.';
    const anchor = { prefix: 'Alpha Third ', suffix: 'pass.', offset: 12 };
    expect(resolveChangeAnchor(text, anchor, 'insert', '')).toEqual({ start: text.indexOf('pass.'), end: text.indexOf('pass.'), kind: 'text' });
    expect(resolveChangeAnchor(text, anchor, 'delete', 'old ')).toEqual({ start: text.indexOf('pass.'), end: text.indexOf('pass.'), kind: 'text' });
  });

  // A neighbouring decision rewrote the middle of the suffix; only the full prefix plus a surviving head of the suffix should place the change.
  it('keeps the prefix and a surviving head of the suffix', () => {
    const text = '---\nid: 1\n---\n\nKeep this pre tail new';
    const anchor = { prefix: 'Keep this pre', suffix: ' tail CHANGED', offset: 13 };
    const seam = text.indexOf(' tail');
    expect(resolveChangeAnchor(text, anchor, 'delete', 'X')).toEqual({ start: seam, end: seam, kind: 'text' });
    expect(resolveChangeAnchor(`${text.slice(0, seam)}new${text.slice(seam)}`, anchor, 'insert', 'new')).toEqual({ start: seam, end: seam + 3, kind: 'text' });
  });

  // Fewer than eight characters of surviving context are too ambiguous to trust, so the change falls back to an offset rung.
  it('does not trust less than eight characters of surviving context', () => {
    const tail = { prefix: 'xxxxxxxxab', suffix: 'cd', offset: 10 };
    expect(resolveChangeAnchor('cd hello ab cd', tail, 'delete', 'Z')?.kind).toBe('offset');
    const head = { prefix: 'ab', suffix: 'cdxxxxxxxx', offset: 2 };
    expect(resolveChangeAnchor('ab zz ab', head, 'delete', 'Z')?.kind).toBe('offset');
  });
});
