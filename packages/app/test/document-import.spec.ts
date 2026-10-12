/**
 * @file document-import.spec.ts
 * @purpose Covers importing a document as Markdown (FR-13.5) by dispatching on its format — Word, web page, rich text and plain text — and reporting what was lost along the way.
 * @inputs A filename and its bytes; the target format is chosen from the extension.
 * @outputs Assertions over the returned Markdown and loss report, and over the errors raised for unimportable files.
 * @functions wordFile - builds a minimal Word document as .docx bytes carrying a heading, emphasis, table, footnote and embedded picture.
 * @dataflow filename + bytes -> importDocument -> Markdown + losses -> assertions.
 * @controlflow One describe block per function; each it supplies fixtures and asserts on the result or rejection.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { decodeHtml, decodeText, describeLosses, importDocument, importFormatOf } from '../src/files/document-import.js';

const encoder = new TextEncoder();
// A 1x1 PNG header, enough for Word to hold it as a picture.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);

// wordFile builds a minimal Word document and returns it as .docx bytes with a heading, emphasis runs, a table, a footnote and an embedded picture.
async function wordFile(): Promise<Uint8Array> {
  const document = new Document({
    footnotes: { 1: { children: [new Paragraph('The source.')] } },
    sections: [{ children: [
      new Paragraph({ text: 'Title', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: 'bold', bold: true }), new TextRun(' and '), new TextRun({ text: 'under', underline: {} }), new TextRun(' and '), new TextRun({ text: 'lit', highlight: 'yellow' }), new TextRun('.'), new FootnoteReferenceRun(1)] }),
      new Paragraph({ text: 'Centred', alignment: AlignmentType.CENTER }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('A')] }), new TableCell({ children: [new Paragraph('B')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('1')] }), new TableCell({ children: [new Paragraph('2')] })] }),
      ] }),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: PNG, transformation: { width: 10, height: 10 } })] }),
    ] }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

describe('importFormatOf', () => {
  // Guards the format is chosen from the file extension, ignoring case.
  it('picks the format from the extension, ignoring case', () => {
    expect(importFormatOf('a.DOCX')).toBe('docx');
    expect(importFormatOf('page.htm')).toBe('html');
    expect(importFormatOf('page.html')).toBe('html');
    expect(importFormatOf('notes.rtf')).toBe('rtf');
    expect(importFormatOf('notes.txt')).toBe('text');
    expect(importFormatOf('notes.text')).toBe('text');
  });

  // Guards no format is known for other files or a file with no recognised extension.
  it('knows no format for other files or none', () => {
    expect(importFormatOf('notes.md')).toBeNull();
    expect(importFormatOf('README')).toBeNull();
    expect(importFormatOf('archive.tar.gz')).toBeNull();
  });
});

describe('decodeText', () => {
  // Guards UTF-8 text is read, with or without a byte order mark.
  it('reads UTF-8, with or without a byte order mark', () => {
    expect(decodeText(encoder.encode('café'))).toBe('café');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
  });

  // Guards UTF-16 is read in either byte order when the file declares which.
  it('reads UTF-16 in either byte order when the file says which', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toBe('hi');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0, 0x68, 0, 0x69]))).toBe('hi');
  });

  // Guards bytes that are not UTF-8 are refused rather than guessed at.
  it('refuses bytes that are not UTF-8 rather than guessing', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0x41]))).toThrow('The file is not UTF-8 text, and K-Doc does not guess at encodings.');
  });
});

describe('describeLosses', () => {
  // Guards each loss is named, with a count only when it happened more than once.
  it('names each loss, with a count only when it happened more than once', () => {
    expect(describeLosses([{ label: 'underlining', count: 1 }, { label: 'pictures', count: 3 }])).toBe('underlining; pictures (3)');
  });
});

describe('importDocument', () => {
  // Guards a Word document is imported as Markdown, keeping headings, emphasis, tables and footnotes.
  it('imports a Word document as Markdown', async () => {
    const result = await importDocument('Report.docx', await wordFile());
    expect(result.markdown).toContain('# Title');
    expect(result.markdown).toContain('**bold** and under and lit.[^1]');
    expect(result.markdown).toContain('| A | B |');
    expect(result.markdown).toContain('| 1 | 2 |');
    expect(result.markdown).toContain('[^1]: The source.');
  });

  // Guards what a Word document loses is listed.
  it('lists what a Word document loses', async () => {
    const result = await importDocument('Report.docx', await wordFile());
    expect(result.losses).toEqual([{ label: 'underlining', count: 1 }, { label: 'highlighting', count: 1 }, { label: 'pictures stored inside the file', count: 1 }]);
  });

  // Guards a web page is imported.
  it('imports a web page', async () => {
    const result = await importDocument('page.html', encoder.encode('<html><body><h2>Hi</h2><p><u>x</u></p></body></html>'));
    expect(result).toEqual({ markdown: '## Hi\n\nx\n', losses: [{ label: 'underlining', count: 1 }] });
  });

  // Guards rich text is imported, reading its bytes one for one.
  it('imports rich text, reading its bytes one for one', async () => {
    const result = await importDocument('notes.rtf', new Uint8Array([...encoder.encode('{\\rtf1 caf'), 0x5c, 0x27, 0x65, 0x39, ...encoder.encode('\\par}')]));
    expect(result.markdown).toBe('café\n');
  });

  // Guards rich text bytes outside ASCII being read one for one as the Windows code page, not as UTF-8.
  it('reads a raw accented byte in rich text as the character it stands for', async () => {
    const result = await importDocument('notes.rtf', new Uint8Array([...encoder.encode('{\\rtf1 caf'), 0xe9, ...encoder.encode('\\par}')]));
    expect(result.markdown).toBe('café\n');
  });

  // Guards a page in a legacy character set being read in the set it declares, as Word's filtered HTML is.
  it('reads a web page in the character set it declares', async () => {
    const head = encoder.encode('<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head><body><p>caf');
    const result = await importDocument('page.htm', new Uint8Array([...head, 0xe9, ...encoder.encode('</p></body></html>')]));
    expect(result.markdown).toBe('café\n');
  });

  // Guards a declared character set taking precedence over reading the bytes as UTF-8.
  it('prefers the declared character set to UTF-8', () => {
    expect(decodeHtml(new Uint8Array([...encoder.encode('<meta charset="iso-8859-1">'), 0xc3, 0xa9]))).toBe('<meta charset="iso-8859-1">Ã©');
  });

  // Guards a page without a declaration being read as UTF-8, with the same refusal for bytes that are not.
  it('reads a page without a declaration as UTF-8', () => {
    expect(decodeHtml(encoder.encode('<p>café</p>'))).toBe('<p>café</p>');
    expect(() => decodeHtml(new Uint8Array([0x3c, 0x70, 0x3e, 0xe9]))).toThrow('The file is not UTF-8 text, and K-Doc does not guess at encodings.');
  });

  // Guards a UTF-16 page being read by its byte order mark whatever its declaration says.
  it('reads a UTF-16 page by its byte order mark', () => {
    const text = '<meta charset="windows-1252"><p>hi</p>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    [...text].forEach((character, index) => { bytes[2 + index * 2] = character.charCodeAt(0); });
    expect(decodeHtml(bytes)).toBe(text);
  });

  // Guards a character set the platform cannot read being refused by name.
  it('refuses a character set it cannot read, naming it', () => {
    expect(() => decodeHtml(encoder.encode('<meta charset="klingon"><p>x</p>'))).toThrow('The page says it is written in klingon, which K-Doc cannot read.');
  });

  // Guards plain text is imported with a leading hash escaped.
  it('imports plain text', async () => {
    expect(await importDocument('notes.txt', encoder.encode('# not a heading'))).toEqual({ markdown: '\\# not a heading\n', losses: [] });
  });

  // Guards a file it cannot import is refused, naming the formats it can.
  it('refuses a file it cannot import, naming the formats it can', async () => {
    await expect(importDocument('notes.pdf', new Uint8Array())).rejects.toThrow('K-Doc cannot import notes.pdf: it imports Word (.docx), web page (.html), rich text (.rtf) and plain text (.txt) files.');
  });

  // Guards a Word file that is not one is refused.
  it('refuses a Word file that is not one', async () => {
    await expect(importDocument('broken.docx', encoder.encode('not a zip'))).rejects.toThrow();
  });
});
