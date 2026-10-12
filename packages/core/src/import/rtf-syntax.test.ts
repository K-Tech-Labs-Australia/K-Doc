/**
 * @file rtf-syntax.test.ts
 * @purpose Vitest test suite for K-Doc's RTF import helpers, covering the tokenizer and HTML writer.
 *   Verifies rtfToHtml syntax handling (ignorable destinations, formatting switches, groups, symbols, escapes, line/page/section breaks), tokenizeRtf tokenization and RtfHtmlWriter output including run merging, table/list closing, escaping and headings.
 * @inputs Raw RTF strings covering destinations, formatting switches, symbols, escapes, line breaks, page/section breaks, stray braces, non-RTF text, plus formatted runs for the writer.
 * @outputs Vitest assertions on serialized HTML strings and token arrays produced by the import helpers.
 * @functions None.
 * @dataflow Raw RTF string -> rtfToHtml / tokenizeRtf -> { html } / tokens; formatted runs -> RtfHtmlWriter -> finish() HTML -> Vitest assertions.
 * @controlflow Run describe blocks for rtfToHtml syntax, tokenizeRtf and RtfHtmlWriter; each it asserts exact HTML output or token array.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { rtfToHtml } from './rtf-import.js';
import { tokenizeRtf } from './rtf-tokens.js';
import { RtfHtmlWriter, type RunFormat } from './rtf-html-writer.js';

const plain: RunFormat = { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, link: null };

describe('rtfToHtml syntax', () => {
  // Guards an ignorable unknown destination is skipped while surrounding text survives.
  it('skips a destination it does not know when marked ignorable', () => {
    expect(rtfToHtml(String.raw`{\rtf1{\*\unknowndest hidden}shown\par}`).html).toBe('<p>shown</p>');
  });

  // Guards formatting switches turn off again and \plain resets them.
  it('turns formatting off again, and plain resets it', () => {
    expect(rtfToHtml(String.raw`{\rtf1 \i it\i0 \strike st\strike0 \plain\b B\plain  p\par}`).html).toBe('<p><em>it</em><s>st</s><strong>B</strong> p</p>');
  });

  // Guards formatting started inside a group ends with that group.
  it('ends formatting with its group', () => {
    expect(rtfToHtml(String.raw`{\rtf1 a {\b bold} c\par}`).html).toBe('<p>a <strong>bold</strong> c</p>');
  });

  // Guards RTF symbol words render as their Unicode characters.
  it('turns symbols into their characters', () => {
    expect(rtfToHtml(String.raw`{\rtf1 a\emdash b\endash c\lquote d\rquote \ldblquote e\rdblquote\bullet\par}`).html).toBe('<p>a—b–c‘d’“e”•</p>');
  });

  // Guards escaped braces, backslashes and the non-breaking space/hyphen are decoded.
  it('reads escaped braces, backslashes, non-breaking space and hyphen', () => {
    expect(rtfToHtml(String.raw`{\rtf1 \{braces\} and \\ back\~nb\_h\-x\par}`).html).toBe('<p>{braces} and \\ back\u00A0nb\u2011hx</p>');
  });

  // Guards a \line switch writes an inline break inside the paragraph.
  it('writes a line break inside a paragraph', () => {
    expect(rtfToHtml(String.raw`{\rtf1 one\line two\par}`).html).toBe('<p>one<br>two</p>');
  });

  // Guards \page and \sect each end the current paragraph.
  it('ends a paragraph at a page or section break', () => {
    expect(rtfToHtml(String.raw`{\rtf1 a\page b\sect c\par}`).html).toBe('<p>a</p><p>b</p><p>c</p>');
  });

  // Guards the final run is emitted as a paragraph even without \par.
  it('keeps the last paragraph when the file does not end one', () => {
    expect(rtfToHtml(String.raw`{\rtf1 last words}`).html).toBe('<p>last words</p>');
  });

  // Guards stray closing braces do not break parsing of the following text.
  it('survives stray closing braces', () => {
    expect(rtfToHtml(String.raw`{\rtf1 a}}} b\par}`).html).toBe('<p>a b</p>');
  });

  // Guards a backslash immediately before a line break ends the paragraph.
  it('treats a backslash before a line break as a paragraph end', () => {
    expect(rtfToHtml('{\\rtf1 a\\\r\nb}').html).toBe('<p>a</p><p>b</p>');
  });

  // Guards input that is not an RTF document raises a clear error.
  it('refuses text that is not RTF', () => {
    expect(() => rtfToHtml('hello')).toThrow('This is not an RTF document.');
  });

  // Guards a negative Unicode escape, which RTF uses for code points above 32767.
  it('reads a negative Unicode escape as the code point above 32767', () => {
    expect(rtfToHtml(String.raw`{\rtf1 \u-4064?\par}`).html).toBe('<p>\uf020</p>');
  });

  // Guards a list item with no number text after a numbered one being bulleted, not numbered.
  it('does not carry numbering on to the next list item', () => {
    expect(rtfToHtml(String.raw`{\rtf1{\listtext 1.\tab}\pard\ls1 One\par\pard\ls2 Plain\par}`).html).toBe('<ol><li>One</li></ol><ul><li>Plain</li></ul>');
  });

  // Guards the automatic colour, index 0, not being reported as a lost colour.
  it('does not report the automatic colour', () => {
    expect(rtfToHtml(String.raw`{\rtf1\cf0 text\par}`).losses).toEqual([]);
  });

  // Guards a table straight after a list standing after it, not inside its last item.
  it('closes a list before a table that follows it', () => {
    expect(rtfToHtml(String.raw`{\rtf1{\listtext \'b7\tab}\pard\ls1 item\par\trowd\pard\intbl A\cell\row\pard after\par}`).html).toBe('<ul><li>item</li></ul><table><tr><th>A</th></tr></table><p>after</p>');
  });

  // Guards alignment inside a table cell, which is its column's alignment, not being reported as lost.
  it('does not report the alignment of a table cell, or of a paragraph after an aligned one', () => {
    expect(rtfToHtml(String.raw`{\rtf1\trowd\pard\qr\intbl 120\par\cell\row\pard\qc centred\par\pard left again\par}`).losses).toEqual([{ label: 'paragraph alignment', count: 1 }]);
  });

  // Guards a row that ends without closing its last cell keeping that cell, unaligned.
  it('keeps a cell the row ended without closing', () => {
    expect(rtfToHtml(String.raw`{\rtf1\trowd\pard\intbl A\par\row}`).html).toBe('<table><tr><th>A</th></tr></table>');
  });

  // Guards an empty paragraph inside a cell adding no line break.
  it('leaves an empty paragraph out of a table cell', () => {
    expect(rtfToHtml(String.raw`{\rtf1\trowd\pard\intbl\par one\cell\row}`).html).toBe('<table><tr><th>one</th></tr></table>');
  });
});

describe('tokenizeRtf', () => {
  // Guards groups, parametered words, text and ignorable tokens are split, dropping a bad hex escape.
  it('splits groups, words with parameters, text and escapes, and drops a bad hex escape', () => {
    expect(tokenizeRtf(String.raw`{\rtf1 A\b0  b\'e9\*\u-3913?\'zz}`)).toEqual([
      { kind: 'open' }, { kind: 'word', name: 'rtf', param: 1 }, { kind: 'text', text: 'A' }, { kind: 'word', name: 'b', param: 0 },
      { kind: 'text', text: ' b' }, { kind: 'text', text: 'é' }, { kind: 'ignorable' }, { kind: 'word', name: 'u', param: -3913 },
      { kind: 'text', text: '?' }, { kind: 'close' },
    ]);
  });
});

describe('RtfHtmlWriter', () => {
  // Guards runs with identical format merge and tables/lists close when the text moves on.
  it('merges runs with the same format and closes tables and lists when the text moves on', () => {
    const w = new RtfHtmlWriter();
    w.text('Hello ', plain); w.text('bold', { ...plain, bold: true }); w.text(' world', plain);
    w.endParagraph({ heading: null, list: null, inTable: false });
    w.text('A', plain); w.endCell(); w.text('B', plain); w.endCell(); w.endRow();
    w.text('One', plain); w.endParagraph({ heading: null, list: 'ol', inTable: false });
    expect(w.finish()).toBe('<p>Hello <strong>bold</strong> world</p><table><tr><th>A</th><th>B</th></tr></table><ol><li>One</li></ol>');
  });

  // Guards text and link addresses are HTML-escaped.
  it('escapes text and link addresses', () => {
    const w = new RtfHtmlWriter();
    w.text('a<b>&"', { ...plain, sub: true, link: 'x"y' });
    expect(w.finish()).toBe('<p><a href="x&quot;y"><sub>a&lt;b&gt;&amp;&quot;</sub></a></p>');
  });

  // Guards a heading is written at its numeric level.
  it('writes a heading at its level', () => {
    const w = new RtfHtmlWriter();
    w.text('Title', plain); w.endParagraph({ heading: 3, list: null, inTable: false });
    expect(w.finish()).toBe('<h3>Title</h3>');
  });
});
