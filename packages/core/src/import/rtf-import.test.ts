/**
 * @file rtf-import.test.ts
 * @purpose Vitest test suite for K-Doc's RTF import helpers (packages/core/src/import/rtf-import.ts).
 *   Verifies importRtf and rtfToHtml: converting RTF fragments to HTML and Markdown, and reporting conversion losses.
 * @inputs Raw RTF fragments covering paragraphs, bold runs, heading styles, code-page and Unicode escapes, hyperlinks, pictures, tables, lists, alignment, colour, headers, footnotes, highlighting, comments and embedded objects.
 * @outputs Vitest assertions on serialized HTML/Markdown strings and reported loss arrays produced by the import helpers.
 * @functions None.
 * @dataflow Raw RTF string -> rtfToHtml / importRtf -> { html | markdown, losses } -> Vitest assertions.
 * @controlflow Run describe blocks for rtfToHtml and importRtf; each it asserts exact HTML/Markdown output and loss counts.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { importRtf, rtfToHtml } from './rtf-import.js';

describe('rtfToHtml', () => {
  // Guards bold switches are rendered as strong runs and surrounding text stays plain.
  it('writes paragraphs with bold runs', () => {
    const r = rtfToHtml(String.raw`{\rtf1\ansi Hello \b bold\b0  world\par}`);
    expect(r.html).toBe('<p>Hello <strong>bold</strong> world</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards stylesheet style names map to heading tags by their numeric level.
  it('uses heading styles named in the stylesheet', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\stylesheet{\s0 Normal;}{\s1 heading 1;}{\*\cs10 Default Paragraph Font;}}\pard\s1 Title\par\pard Body\par}`);
    expect(r.html).toBe('<h1>Title</h1><p>Body</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards code-page and Unicode escapes decode while the glyph fallback is skipped.
  it('decodes code page and Unicode escapes, skipping the fallback', () => {
    const r = rtfToHtml(String.raw`{\rtf1 caf\'e9 \u8364?\par}`);
    expect(r.html).toBe('<p>café €</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards the uc value controls how many bytes of a code-page escape are consumed.
  it('honours the fallback count set by uc', () => {
    const r = rtfToHtml(String.raw`{\rtf1\uc2 \u8364\'80\'80 x\par}`);
    expect(r.html).toBe('<p>€ x</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards uc 0 consumes no fallback bytes, so the next character decodes as Unicode.
  it('skips no fallback when uc is 0', () => {
    const r = rtfToHtml(String.raw`{\rtf1\uc0 \u8364 x\par}`);
    expect(r.html).toBe('<p>€x</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards curly quotes and the euro read from the Windows code page via \' escapes.
  it('reads curly quotes from the Windows code page', () => {
    const r = rtfToHtml(String.raw`{\rtf1 \'93quoted\'94 \'80\par}`);
    expect(r.html).toBe('<p>“quoted” €</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards a HYPERLINK field becomes an anchor with its URL and result text.
  it('makes a HYPERLINK field a link', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\field{\*\fldinst HYPERLINK "https://example.com"}{\fldrslt site}}\par}`);
    expect(r.html).toBe('<p><a href="https://example.com">site</a></p>');
    expect(r.losses).toEqual([]);
  });

  // Guards a picture renders nothing but is reported once.
  it('reports a picture', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\pict\pngblip 89504e}\par}`);
    expect(r.html).toBe('');
    expect(r.losses).toEqual([{ label: 'pictures', count: 1 }]);
  });

  // Guards a wrapped picture reports one loss, not also its fallback copy.
  it('reports a picture Word wraps for newer readers once, not its fallback copy', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\*\shppict{\pict\pngblip 00}}{\nonshppict{\pict\wmetafile8 00}}\par}`);
    expect(r.html).toBe('');
    expect(r.losses).toEqual([{ label: 'pictures', count: 1 }]);
  });

  // Guards the first table row renders as header cells.
  it('writes a table with its first row as the header', () => {
    const r = rtfToHtml(String.raw`{\rtf1\trowd\cellx1000\cellx2000\pard\intbl A\cell B\cell\row\pard After\par}`);
    expect(r.html).toBe('<table><tr><th>A</th><th>B</th></tr></table><p>After</p>');
    expect(r.losses).toEqual([]);
  });

  // Guards paragraphs inside a single cell join with line breaks.
  it('joins paragraphs inside one cell with a line break', () => {
    const r = rtfToHtml(String.raw`{\rtf1\trowd\pard\intbl one\par two\cell\row\trowd\pard\intbl three\cell\row\pard\par}`);
    expect(r.html).toBe('<table><tr><th>one<br>two</th></tr><tr><td>three</td></tr></table>');
    expect(r.losses).toEqual([]);
  });

  // Guards numbered list text yields an ordered list and bullet text a bulleted one.
  it('makes numbered list text an ordered list and a bullet a bulleted one', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\listtext 1.\tab}\pard\ls1 One\par{\listtext 2.\tab}\pard\ls1 Two\par\pard{\listtext \'b7\tab}\ls2 Bullet\par}`);
    expect(r.html).toBe('<ol><li>One</li><li>Two</li></ol><ul><li>Bullet</li></ul>');
    expect(r.losses).toEqual([]);
  });

  // Guards a non-zero ilvl is reported as a nested list level loss.
  it('reports a nested list level', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\listtext \'b7\tab}\pard\ls1\ilvl1 deep\par}`);
    expect(r.html).toBe('<ul><li>deep</li></ul>');
    expect(r.losses).toEqual([{ label: 'nested list levels', count: 1 }]);
  });

  // Guards alignment, colour, headers and footnotes are each reported once.
  it('reports alignment, colour, headers and footnotes', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\fonttbl{\f0 Arial;}}{\colortbl;\red255\green0\blue0;}{\*\generator Riched20;}\pard\qc\cf1 Red centred\ul under\ulnone\par{\header head}{\footnote note}}`);
    expect(r.html).toBe('<p>Red centred<u>under</u></p>');
    expect(r.losses).toEqual([{ label: 'text colours, fonts and sizes', count: 1 }, { label: 'paragraph alignment', count: 1 }, { label: 'headers and footers', count: 1 }, { label: 'footnotes', count: 1 }]);
  });

  // Guards highlighting is only reported where the highlight switch is active.
  it('reports highlighting only where it is switched on', () => {
    const r = rtfToHtml(String.raw`{\rtf1\highlight3 hi\highlight0  no\par}`);
    expect(r.html).toBe('<p>hi no</p>');
    expect(r.losses).toEqual([{ label: 'highlighting', count: 1 }]);
  });

  // Guards comments are dropped with their bookkeeping but still counted.
  it('reports comments and drops their bookkeeping', () => {
    const r = rtfToHtml(String.raw`{\rtf1 text{\*\atnid KC}{\*\annotation note}\par}`);
    expect(r.html).toBe('<p>text</p>');
    expect(r.losses).toEqual([{ label: 'comments', count: 1 }]);
  });

  // Guards an embedded object reports one loss without recursing into its picture.
  it('reports an embedded object once, not the picture inside it', () => {
    const r = rtfToHtml(String.raw`{\rtf1{\object{\*\objdata 0102}{\result{\pict 00}}}\par}`);
    expect(r.html).toBe('');
    expect(r.losses).toEqual([{ label: 'embedded objects', count: 1 }]);
  });
});

describe('importRtf', () => {
  // Guards a table cell's alignment becoming its column's, and a justified cell reading as left.
  it('keeps right-aligned table columns', () => {
    expect(importRtf(String.raw`{\rtf1\trowd\pard\intbl Region\cell\pard\qr\intbl Sales\cell\pard\qj\intbl Note\cell\row\trowd\pard\intbl North\cell\pard\qr\intbl 120\cell\pard\qj\intbl ok\cell\row}`)).toEqual({ markdown: '| Region | Sales | Note |\n| ------ | ----: | ---- |\n| North  |   120 | ok   |\n', losses: [] });
  });

  // Guards importRtf renders headings and lists to Markdown with no losses.
  it('converts to Markdown', () => {
    expect(importRtf(String.raw`{\rtf1{\stylesheet{\s2 Heading 2;}}\pard\s2 H\par{\listtext 1.\tab}\pard\ls1 i\par\pard p\par}`)).toEqual({ markdown: '## H\n\n1. i\n\np\n', losses: [] });
  });

  // Guards importRtf sums HTML-step and reader-reported losses together.
  it('adds what the HTML step reports to what the reader reports', () => {
    expect(importRtf(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\pard\ul under\ulnone  \super 2\nosupersub\par}`)).toEqual({ markdown: 'under 2\n', losses: [{ label: 'underlining', count: 1 }, { label: 'subscript and superscript', count: 1 }] });
  });
});
