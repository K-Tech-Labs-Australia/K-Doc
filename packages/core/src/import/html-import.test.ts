/**
 * @file html-import.test.ts
 * @purpose Vitest test suite for K-Doc's HTML import helpers (packages/core/src/import/html-import.ts).
 *   Verifies importHtml, importPlainText and mergeLosses: converting HTML fragments to Markdown, reporting losses, separating plain text into paragraphs and merging loss counts.
 * @inputs Raw HTML fragments and plain-text strings covering headings, inline marks, tables, images, footnotes, media, form fields and blank input.
 * @outputs Vitest assertions on serialized Markdown strings and reported loss arrays produced by the import helpers.
 * @functions None.
 * @dataflow Raw HTML/plain-text string -> importHtml / importPlainText / mergeLosses -> { markdown, losses } -> Vitest assertions.
 * @controlflow Run describe blocks for importHtml, importPlainText and mergeLosses; each it asserts exact Markdown output and loss counts.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { importHtml, importPlainText, mergeLosses } from './html-import.js';

describe('importHtml', () => {
  // Guards full-page import strips head elements and renders only body content.
  it('reads a whole page, leaving the head out', () => {
    const r = importHtml('<!doctype html><html><head><title>T</title></head><body><h2>Hi</h2><p>A <strong>b</strong></p></body></html>');
    expect(r.markdown).toBe('## Hi\n\nA **b**\n');
    expect(r.losses).toEqual([]);
  });

  // Guards underline tags render as plain text while reporting a underlining loss.
  it('keeps underlined words as plain text and reports the underlining', () => {
    const r = importHtml('<p>an <u>underlined</u> word</p>');
    expect(r.markdown).toBe('an underlined word\n');
    expect(r.losses).toEqual([{ label: 'underlining', count: 1 }]);
  });

  // Guards mark tags render as plain text without inventing emphasis.
  it('reports highlighting without inventing emphasis', () => {
    const r = importHtml('<p><mark>lit</mark></p>');
    expect(r.markdown).toBe('lit\n');
    expect(r.losses).toEqual([{ label: 'highlighting', count: 1 }]);
  });

  // Guards each font colour, family and size counts as one loss.
  it('counts each colour, font or size', () => {
    const r = importHtml('<p><font color="red">x</font><span style="font-size: 20px">y</span></p>');
    expect(r.markdown).toBe('xy\n');
    expect(r.losses).toEqual([{ label: 'text colours, fonts and sizes', count: 2 }]);
  });

  // Guards non-left paragraph alignment is reported but left alignment is not.
  it('reports alignment other than left', () => {
    const r = importHtml('<p align="center">c</p><p style="text-align: left">l</p><p style="text-align:right">r</p>');
    expect(r.markdown).toBe('c\n\nl\n\nr\n');
    expect(r.losses).toEqual([{ label: 'paragraph alignment', count: 2 }]);
  });

  // Guards table column alignment is kept by Markdown and not reported as a loss.
  it('does not report table column alignment, which Markdown keeps', () => {
    const r = importHtml('<table><tr><th align="right">h</th></tr><tr><td>1</td></tr></table>');
    expect(r.markdown).toBe('|  h |\n| -: |\n|  1 |\n');
    expect(r.losses).toEqual([]);
  });

  // Guards the first row becoming the header only when the page marks none.
  it('makes the first row the header of a table without one, and leaves a marked header alone', () => {
    expect(importHtml('<table><tr><td>a</td></tr><tr><td>1</td></tr></table>').markdown).toBe('| a |\n| - |\n| 1 |\n');
    expect(importHtml('<table><thead><tr><td>h</td></tr></thead><tbody><tr><td>a</td></tr></tbody></table>').markdown).toBe('| h |\n| - |\n| a |\n');
  });

  // Guards a table nested inside another table is reported as a loss.
  it('reports a table inside a table', () => {
    const r = importHtml('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    expect(r.markdown).toBe('| x |\n| - |\n');
    expect(r.losses).toEqual([{ label: 'tables inside tables', count: 1 }]);
  });

  // Guards rowspan/colspan merged cells are reported as a loss.
  it('reports merged cells', () => {
    const r = importHtml('<table><tr><td rowspan="2">x</td></tr></table>');
    expect(r.markdown).toBe('| x |\n| - |\n');
    expect(r.losses).toEqual([{ label: 'merged table cells', count: 1 }]);
  });

  // Guards form fields and media are dropped with reports while styles are dropped silently.
  it('drops form fields and media and says so, and drops style sheets silently', () => {
    const r = importHtml('<p>a<input type="text"><button>go</button></p><video src="v.mp4"></video><style>p{}</style>');
    expect(r.markdown).toBe('a\n');
    expect(r.losses).toEqual([{ label: 'form fields', count: 2 }, { label: 'embedded media', count: 1 }]);
  });

  // Guards an image hosted on the web is kept as a markdown image reference.
  it('keeps a picture on the web', () => {
    const r = importHtml('<p><img src="https://x.y/a.png" alt="a"></p>');
    expect(r.markdown).toBe('![a](https://x.y/a.png)\n');
    expect(r.losses).toEqual([]);
  });

  // Guards an inline data-URI image is dropped and reported as a loss.
  it('drops a picture stored in the page and says so', () => {
    const r = importHtml('<p>x<img src="data:image/png;base64,AAAA" alt="a"></p>');
    expect(r.markdown).toBe('x\n');
    expect(r.losses).toEqual([{ label: 'pictures stored inside the file', count: 1 }]);
  });

  // Guards script elements are dropped and reported as a loss.
  it('drops scripts and says so', () => {
    const r = importHtml('<p>x</p><script>alert(1)</script>');
    expect(r.markdown).toBe('x\n');
    expect(r.losses).toEqual([{ label: 'scripts', count: 1 }]);
  });

  // Guards repeated footnote references collapse to one note without emitting back-links.
  it('turns linked notes into footnotes, once, without their back-links', () => {
    const r = importHtml('<p>Claim<sup><a href="#fn1" id="ref1">[1]</a></sup> and again<sup><a href="#fn1">[1]</a></sup>.</p><ol><li id="fn1"><p>Source. <a href="#ref1">↑</a></p></li></ol>');
    expect(r.markdown).toBe('Claim[^1] and again[^1].\n\n[^1]: Source.\n');
    expect(r.losses).toEqual([]);
  });

  // Guards a list item that was a footnote becomes a note while siblings stay list items.
  it('keeps a list that held a footnote and other items', () => {
    const r = importHtml('<p>C<a href="#n">1</a></p><ol><li>real item</li><li id="n">note</li></ol>');
    expect(r.markdown).toBe('C[^1]\n\n1. real item\n\n[^1]: note\n');
    expect(r.losses).toEqual([]);
  });

  // Guards an anchor pointing at a heading stays an inline link rather than a footnote.
  it('leaves a link to a heading as a link', () => {
    const r = importHtml('<p><a href="#top">top</a></p><h1 id="top">T</h1>');
    expect(r.markdown).toBe('[top](#top)\n\n# T\n');
    expect(r.losses).toEqual([]);
  });

  // Guards blank or whitespace-only input yields an empty document with no losses.
  it('returns nothing for blank input', () => {
    const r = importHtml('   ');
    expect(r.markdown).toBe('');
    expect(r.losses).toEqual([]);
  });

  // Guards a footnote body that loses formatting reports the loss too.
  it('reports what a footnote body loses too', () => {
    const r = importHtml('<p>C<a href="#n">1</a></p><ol><li id="n"><u>note</u></li></ol>');
    expect(r.markdown).toBe('C[^1]\n\n[^1]: note\n');
    expect(r.losses).toEqual([{ label: 'underlining', count: 1 }]);
  });
});

describe('importPlainText', () => {
  // Guards plain text becomes blank-line separated paragraphs with Markdown escaped.
  it('makes blank-line separated blocks paragraphs and escapes Markdown', () => {
    const r = importPlainText('Line one\r\nline two\r\n\r\n\r\n   # hash  \n\n');
    expect(r.markdown).toBe('Line one\nline two\n\n\\# hash\n');
    expect(r.losses).toEqual([]);
  });

  // Guards text with no words yields an empty document containing only a newline.
  it('gives an empty document for text with no words', () => {
    const r = importPlainText('\n\n');
    expect(r.markdown).toBe('\n');
  });
});

describe('mergeLosses', () => {
  // Guards identical labels accumulate counts while preserving first-seen order.
  it('adds counts for the same label and keeps first-seen order', () => {
    const r = mergeLosses([{ label: 'a', count: 1 }, { label: 'b', count: 2 }], [{ label: 'b', count: 3 }, { label: 'c', count: 1 }]);
    expect(r).toEqual([{ label: 'a', count: 1 }, { label: 'b', count: 5 }, { label: 'c', count: 1 }]);
  });
});
