/**
 * @file docx-export.spec.ts
 * @purpose Covers writing a document as Word (FR-13.4) by opening the .docx it produces and reading the XML Word would read: headings as heading styles, real lists, tables, footnotes, embedded pictures, and an honest account of whatever was left out.
 * @inputs Markdown parsed with @k-doc/core; optional image map keyed by filename to base64 data URIs.
 * @outputs Assertions over word/document.xml, word/footnotes.xml and the word/media folder contents.
 * @functions docxParts - exports markdown to a docx and returns its unzipped XML parts; png - builds a minimal valid PNG data URI for image fixtures.
 * @dataflow markdown -> parseMarkdown -> exportDocx -> unzip -> XML -> assertions.
 * @controlflow One describe block with one it per construct; each awaits docxParts then asserts on the extracted parts.
 * @version 1
 * @date 2026-09-17
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown } from '@k-doc/core';
import { exportDocx } from '../src/files/docx-export.js';

interface Parts {
  readonly rels: string;
  readonly document: string;
  readonly footnotes: string;
  readonly media: readonly string[];
  readonly skipped: readonly string[];
  readonly bytes: Uint8Array;
}

// docxParts exports the markdown to a docx, unzips it, and returns the Word XML plus the list of embedded media files and anything the exporter left out.
async function docxParts(markdown: string, images: ReadonlyMap<string, string> = new Map()): Promise<Parts> {
  const result = await exportDocx(parseMarkdown(markdown).root, { title: 'Test', images });
  const zip = await JSZip.loadAsync(result.bytes);
  const document = (await zip.file('word/document.xml')?.async('string')) ?? '';
  const footnotes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
  // A hyperlink's address is kept in the relationships part, not in the document text.
  const rels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';
  // The folder itself is listed as an entry of its own; only the files in it are pictures.
  const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
  return { rels, document, footnotes, media, skipped: result.skipped, bytes: result.bytes };
}

// png builds a minimal but structurally valid PNG data URI so image fixtures can be supplied to the exporter.
function png(width: number, height: number): string {
  const bytes = new Array<number>(33).fill(0);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((value, index) => (bytes[index] = value));
  bytes[19] = width & 0xff;
  bytes[18] = (width >> 8) & 0xff;
  bytes[23] = height & 0xff;
  bytes[22] = (height >> 8) & 0xff;
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

describe('exportDocx', () => {
  // Guards the export is a real zip/docx archive and carries the text without dropping anything.
  it('produces a Word file', async () => {
    const parts = await docxParts('Hello.\n');
    expect(parts.bytes[0]).toBe(0x50);
    expect(parts.bytes[1]).toBe(0x4b);
    expect(parts.document).toContain('Hello.');
    expect(parts.skipped).toEqual([]);
  });

  // Guards headings map to Word Heading styles by level.
  it('uses Word heading styles for headings', async () => {
    const parts = await docxParts('# One\n\n### Three\n\n###### Six\n');
    expect(parts.document).toContain('w:val="Heading1"');
    expect(parts.document).toContain('w:val="Heading3"');
    expect(parts.document).toContain('w:val="Heading6"');
  });

  // Guards inline bold, italic, strikethrough and code survive as their Word runs and monospace font.
  it('keeps bold, italic, strikethrough and code', async () => {
    const parts = await docxParts('**bold** *italic* ~~gone~~ `code`\n');
    expect(parts.document).toContain('<w:b/>');
    expect(parts.document).toContain('<w:i/>');
    expect(parts.document).toContain('<w:strike/>');
    expect(parts.document).toContain('Consolas');
  });

  // Guards links become hyperlinks that keep their anchor text.
  it('makes a link a hyperlink to its address', async () => {
    const parts = await docxParts('See [the site](https://example.com/page).\n');
    expect(parts.document).toContain('w:hyperlink');
    expect(parts.document).toContain('the site');
    expect(parts.rels).toContain('https://example.com/page');
  });

  // Guards bulleted and numbered list items are emitted as Word list paragraphs.
  it('writes bulleted and numbered lists as Word lists', async () => {
    const parts = await docxParts('- apple\n- pear\n\n1. first\n2. second\n');
    expect(parts.document).toContain('w:numPr');
    expect(parts.document).toContain('apple');
    expect(parts.document).toContain('second');
  });

  // Guards each separate numbered list restarts at one by using distinct numId values.
  it('starts each numbered list again at one', async () => {
    const parts = await docxParts('1. a\n2. b\n\nBetween.\n\n1. c\n2. d\n');
    const numIds = [...parts.document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1]);
    expect(new Set(numIds).size).toBe(2);
  });

  // Guards a nested list is one level deeper via increasing indentation levels.
  it('nests a list inside a list one level deeper', async () => {
    const parts = await docxParts('- outer\n  - inner\n');
    expect(parts.document).toContain('<w:ilvl w:val="0"/>');
    expect(parts.document).toContain('<w:ilvl w:val="1"/>');
  });

  // Guards task list items render as checked and unchecked checkboxes.
  it('shows a task item as a checkbox', async () => {
    const parts = await docxParts('- [x] done\n- [ ] todo\n');
    expect(parts.document).toContain('☑');
    expect(parts.document).toContain('☐');
  });

  // Guards tables are emitted with table markup, a header-row flag and cell alignment.
  it('writes a table as a Word table with a header row', async () => {
    const parts = await docxParts('| A | B |\n| :- | -: |\n| 1 | 2 |\n');
    expect(parts.document).toContain('<w:tbl>');
    // docx marks every row, so the header is the one row whose flag is set rather than false.
    expect(parts.document.match(/<w:tblHeader\/>/g)).toHaveLength(1);
    expect(parts.document).toContain('w:val="right"');
  });

  // Guards fenced code block lines are preserved verbatim in a monospace font.
  it('writes a code block line by line in a monospace font', async () => {
    const parts = await docxParts('```\nline one\n\nline three\n```\n');
    expect(parts.document).toContain('line one');
    expect(parts.document).toContain('line three');
    expect(parts.document).toContain('Consolas');
  });

  // Guards blockquotes are indented and marked with a paragraph border.
  it('indents a quotation and marks it with a border', async () => {
    const parts = await docxParts('> Quoted words.\n');
    expect(parts.document).toContain('Quoted words.');
    expect(parts.document).toContain('<w:ind w:left="720"/>');
    expect(parts.document).toContain('w:pBdr');
  });

  // Guards a thematic break renders as a paragraph border rule.
  it('draws a thematic break as a rule', async () => {
    const parts = await docxParts('Above.\n\n---\n\nBelow.\n');
    expect(parts.document).toContain('w:pBdr');
  });

  // Guards footnotes produce both a reference in the document and the definition text.
  it('writes a footnote as a Word footnote', async () => {
    const parts = await docxParts('Claim.[^1]\n\n[^1]: The source.\n');
    expect(parts.document).toContain('w:footnoteReference');
    expect(parts.footnotes).toContain('The source.');
  });

  // Guards an undefined footnote reference is left verbatim rather than dropped.
  it('finds a footnote defined inside a quotation', async () => {
    const parts = await docxParts('Claim.[^q]\n\n> Quoted.\n>\n> [^q]: Defined in a quote.\n');
    expect(parts.document).toContain('w:footnoteReference');
    expect(parts.footnotes).toContain('Defined in a quote.');
  });

  it('keeps a footnote reference that has no definition as written', async () => {
    // The parser only makes a reference when a definition exists, so this tree is built by hand: it stands
    // for a document edited into that state by something other than the parser.
    const root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'footnoteReference', identifier: 'gone', label: 'gone' }] }],
    } as unknown as Parameters<typeof exportDocx>[0];
    const result = await exportDocx(root, { title: 'Test', images: new Map() });
    const zip = await JSZip.loadAsync(result.bytes);
    const document = (await zip.file('word/document.xml')?.async('string')) ?? '';
    expect(document).toContain('[^gone]');
    expect(document).not.toContain('w:footnoteReference');
  });

  it('numbers footnotes in the order a reader meets them', async () => {
    const parts = await docxParts('First.[^b] Second.[^a]\n\n[^a]: Note A.\n\n[^b]: Note B.\n');
    expect(parts.footnotes.indexOf('Note B.')).toBeLessThan(parts.footnotes.indexOf('Note A.'));
  });

  it('writes a footnote referred to twice only once', async () => {
    const parts = await docxParts('One.[^n] Two.[^n]\n\n[^n]: Shared note.\n');
    expect(parts.footnotes.match(/Shared note\./g)).toHaveLength(1);
    expect(parts.document.match(/w:footnoteReference/g)).toHaveLength(2);
  });

  it('puts the number or bullet on the first paragraph of a list item only', async () => {
    const parts = await docxParts('- first paragraph\n\n  second paragraph\n');
    expect(parts.document.match(/<w:numPr>/g)).toHaveLength(1);
    expect(parts.document).toContain('second paragraph');
  });

  // Guards a readable local image is embedded to the media folder and nothing is skipped.
  it('embeds a local picture it could read', async () => {
    const parts = await docxParts('![a cat](cat.png)\n', new Map([['cat.png', png(40, 30)]]));
    expect(parts.media).toHaveLength(1);
    expect(parts.skipped).toEqual([]);
  });

  // Guards an unreadable image falls back to its alt text and is reported as skipped.
  it('writes a picture it could not read as its description, and says so', async () => {
    const parts = await docxParts('![a cat](cat.png)\n');
    expect(parts.media).toHaveLength(0);
    expect(parts.document).toContain('[a cat]');
    expect(parts.skipped).toContain('picture that could not be read');
  });

  // Guards a picture in a format Word cannot embed is reported rather than silently dropped.
  it('says so when a picture is in a format Word cannot embed', async () => {
    const svg = `data:image/svg+xml;base64,${btoa('<svg/>')}`;
    const parts = await docxParts('![logo](logo.svg)\n', new Map([['logo.svg', svg]]));
    expect(parts.document).toContain('[logo]');
    expect(parts.skipped).toContain('picture in a format Word cannot embed');
  });

  // Guards raw HTML is named as left out rather than dropped quietly.
  it('names raw HTML as left out rather than dropping it quietly', async () => {
    const parts = await docxParts('Text.\n\n<div>markup</div>\n');
    expect(parts.skipped).toContain('raw HTML');
  });

  // Guards YAML front matter is stripped from the document and not reported as skipped.
  it('leaves front matter out of the document without complaint', async () => {
    const parts = await docxParts('---\ntitle: Secret\n---\n\nBody.\n');
    expect(parts.document).not.toContain('Secret');
    expect(parts.document).toContain('Body.');
    expect(parts.skipped).toEqual([]);
  });

  // Guards each skipped item appears once and in the order it was encountered.
  it('lists each thing left out once, in order', async () => {
    const parts = await docxParts('<b>one</b>\n\n<i>two</i>\n\n![x](a.png)\n');
    expect(parts.skipped).toEqual(['picture that could not be read', 'raw HTML']);
  });
});
