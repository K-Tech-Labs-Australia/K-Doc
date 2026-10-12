/**
 * @file rich-inline.test.ts
 * @purpose Exercises K-Doc's Tier-4 inline constructs (== highlight, ~ subscript, ^ superscript)
 *   through the real parser and serializer to pin node types and round-trip fidelity.
 * @inputs Markdown source strings; outputs asserted inline node-type arrays and serialized output.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parser.js';
import { serializeDocument } from '../serialize/serializer.js';

// A backslash is built rather than written as an escape: a literal '\\==' is easy to lose when the
// file is edited, and a test that silently drops its backslash passes while proving nothing.
const BS = String.fromCharCode(92);

// Newline written via char code for the same reason as BS — no risk of an accidental literal.
const NL = String.fromCharCode(10);

// Node shape used to inspect nested inline children without importing mdast types into the test.
type InlineNode = { readonly type: string; readonly children?: InlineNode[] };

function inlineTypes(source: string): string[] {
  const doc = parseMarkdown(source);
  const first = doc.root.children[0] as { children?: { type: string }[] };
  return (first.children ?? []).map((c) => c.type);
}

function roundTrip(source: string): string {
  return serializeDocument(parseMarkdown(source));
}

describe('rich inline constructs', () => {
  it('==...== yields a highlight node', () => {
    expect(inlineTypes('A ==hi== there.')).toContain('highlight');
  });

  it('~...~ yields a subscript node', () => {
    expect(inlineTypes('Water H~2~O.')).toContain('subscript');
  });

  it('^...^ yields a superscript node', () => {
    expect(inlineTypes('E=mc^2^ here.')).toContain('superscript');
  });

  it('round-trips each construct byte-for-byte', () => {
    // Byte-exact round trip for the three primary constructs plus NL appended to the input.
    for (const src of ['A ==hi== there.', 'Water H~2~O.', 'E=mc^2^ here.']) {
      expect(roundTrip(src + NL)).toBe(src + NL);
    }
  });

  it('round-trips nested and cross-sibling inline', () => {
    // Byte-exact round trip for the cross-sibling highlight and a nested pair, each with NL.
    for (const src of ['A ==**bold** in== it.', 'Nested ==a ^b^ c== here.']) {
      expect(roundTrip(src + NL)).toBe(src + NL);
    }
  });

  it('pairs == across remark siblings and wraps the strong', () => {
    // remark parses this as three siblings (text, strong, text), so a single-text-node
    // implementation could never pair the == markers between them.
    const first = parseMarkdown('A ==**bold** in== it.').root.children[0] as InlineNode;
    const highlights = (first.children ?? []).filter((c) => c.type === 'highlight');
    expect(highlights).toHaveLength(1);
    const strongs = (highlights[0]?.children ?? []).filter((c) => c.type === 'strong');
    expect(strongs).toHaveLength(1);
  });

  it('leaves an escaped == pair literal and round-trips it', () => {
    // Fidelity guarantee: the editor must not change the meaning of something the user escaped.
    const src = 'Escaped ' + BS + '==not it' + BS + '== here.';
    expect(inlineTypes(src)).not.toContain('highlight');
    expect(roundTrip(src + NL)).toBe(src + NL);
  });

  it('distinguishes ~~strike~~ from ~sub~', () => {
    // remark-gfm runs with singleTilde: false, so the two cannot collide.
    const src = 'A ~~strike~~ and ~sub~ here.';
    const types = inlineTypes(src);
    expect(types).toContain('delete');
    expect(types).toContain('subscript');
    expect(types.indexOf('delete')).toBeLessThan(types.indexOf('subscript'));
    expect(roundTrip(src + NL)).toBe(src + NL);
  });

  it('treats an empty ==== pair as literal and re-parses to the same types', () => {
    const src = 'Empty ==== pair.';
    expect(inlineTypes(src)).not.toContain('highlight');
    // Not byte equality: the serializer escapes the markers, which is correct.
    expect(inlineTypes(roundTrip(src + NL))).toEqual(inlineTypes(src));
  });

  it('leaves an unpaired == delimiter literal', () => {
    // An unpaired delimiter stays literal rather than being dropped or paired with nothing.
    expect(inlineTypes('One ==only here.')).not.toContain('highlight');
  });

  it('ignores == inside a code span', () => {
    // A backtick code span containing ==x== is inlineCode, not highlight; build the backticks.
    const BT = String.fromCharCode(96);
    const types = inlineTypes('Use ' + BT + '=x==' + BT + ' here.');
    expect(types).toContain('inlineCode');
    expect(types).not.toContain('highlight');
  });
});
