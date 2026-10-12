/**
 * @file attachment-references.spec.ts
 * @purpose Verifies the reference scanner that finds which files a Markdown document refers to and which folder files nothing refers to, covering FR-6.14.
 * @inputs Markdown documents exercising inline links/images, wikilink embeds, reference definitions, HTML images, absolute URLs, fragments, queries, percent escapes, and titles; file-name lists and reference sets for unused-file computation.
 * @outputs Assertion results from vitest describing which references are discovered and which attachments are unreferenced.
 * @functions
 *   - attachmentReferences: Sweeps a document and returns the set of referenced base file names.
 *   - referencedFileName: Reduces one link target to its local file name, or '' when it is not a local file.
 *   - unusedAttachments: Returns folder files that no reference resolves to, case-insensitively.
 * @dataflow Test markdown strings → attachmentReferences()/referencedFileName() → resolved sets/names compared against expected values; name lists + reference sets → unusedAttachments() → unreferenced arrays compared against expected values.
 * @controlflow Each it() runs one scenario, invokes the scanner or helper, and asserts equality with the expected result via sorted array comparison.
 * @version 2
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { attachmentReferences, referencedFileName, unusedAttachments } from '../src/attachments/attachment-references.js';

describe('the files a document refers to', () => {
  // Guards: an inline image, a reference link, and a wikilink embed are all discovered.
  it('finds an image, a link, and an embed in one document', () => {
    const markdown = '![shot](attachments/shot.png)\n\n[notes](../docs/notes.pdf)\n\n![[diagram.svg]]\n';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['diagram.svg', 'notes.pdf', 'shot.png']);
  });

  // Guards: a reference-definition target and an HTML <img> src are both discovered.
  it('finds a reference definition and an HTML image', () => {
    const markdown = '[id]: attachments/defined.png\n\n<img src="inline.gif" alt="x">\n';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['defined.png', 'inline.gif']);
  });

  // Guards: absolute URLs, data URIs, protocol-relative URLs, and mailto links resolve to no local file.
  it('leaves out targets that are not files on disk', () => {
    const markdown = '[site](https://example.com/page.png)\n\n![d](data:image/png;base64,AAAA)\n\n[rel](//cdn.example.com/a.png)\n\n[mail](mailto:someone@example.com)\n';
    const result = attachmentReferences(markdown);
    expect(result.size).toBe(0);
  });

  // Guards: a wikilink embed with a caption pipe still resolves to its file name.
  it('reads an embed target while ignoring its caption', () => {
    const markdown = '![[shot.png|A caption]]';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['shot.png']);
  });

  // Guards: a URL fragment and a query string are stripped before the file name is extracted.
  it('drops a fragment and a query from a target', () => {
    const markdown = '[a](file.png#top)\n\n[b](other.png?v=2)\n';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['file.png', 'other.png']);
  });

  // Guards: percent-encoded characters in a target are decoded to the literal file name.
  it('decodes an escaped file name', () => {
    const markdown = '![a](attachments/my%20shot.png)';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['my shot.png']);
  });

  // Guards: a title after the target does not change which file the image refers to.
  it('names the file a title-carrying image refers to', () => {
    const markdown = '![a](shot.png "A title")';
    const result = attachmentReferences(markdown);
    expect([...result].sort()).toEqual(['shot.png']);
  });

  // Guards: module-level global regexes are reset between sweeps so a second pass finds the same files.
  it('can be swept twice with the same answer', () => {
    const markdown = '![shot](attachments/shot.png)\n\n![[diagram.svg]]\n';
    const first = attachmentReferences(markdown);
    const second = attachmentReferences(markdown);
    expect(first.size).toBe(second.size);
  });

  // Guards: a Windows backslash path resolves to the final segment.
  it('reads a windows-style target', () => {
    expect(referencedFileName('attachments\\shot.png')).toBe('shot.png');
  });

  // Guards: blank and anchor-only targets resolve to no file name.
  it('refuses a target that names nothing', () => {
    expect(referencedFileName('   ')).toBe('');
    expect(referencedFileName('#anchor')).toBe('');
  });
});

describe('the attachments nothing refers to', () => {
  // Guards: files the document does not refer to are reported while referenced ones are dropped.
  it('leaves out the ones a document refers to', () => {
    const result = unusedAttachments(['a.png', 'b.png', 'c.png'], new Set(['b.png']));
    expect(result).toEqual(['a.png', 'c.png']);
  });

  // Guards: comparison ignores case so differently-cased references still exclude a file.
  it('ignores the case a file name is spelled in', () => {
    const result = unusedAttachments(['Shot.PNG'], new Set(['shot.png']));
    expect(result).toEqual([]);
  });

  // Guards: the case is ignored on the reference's side too, not only on the folder's.
  it('ignores the case the reference is spelled in', () => {
    const result = unusedAttachments(['shot.png'], new Set(['Shot.PNG']));
    expect(result).toEqual([]);
  });

  // Guards: when nothing refers to any file, every file is reported as unused.
  it('reports every file when nothing refers to any', () => {
    const result = unusedAttachments(['a.png'], new Set());
    expect(result).toEqual(['a.png']);
  });

  // Guards: the original folder order of unreferenced files is preserved.
  it('keeps the order the folder gave', () => {
    const result = unusedAttachments(['z.png', 'a.png'], new Set());
    expect(result).toEqual(['z.png', 'a.png']);
  });
});
