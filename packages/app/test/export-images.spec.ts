/**
 * @file export-images.spec.ts
 * @purpose Verifies that the HTML export path carries image data URIs through to the rendered document, both when rendering directly and when saving through a FileService, so FR-13.1's "embed images" behavior is covered without touching disk or a browser.
 * @inputs Vitest node environment; parseMarkdown-produced KdocDocument containing one image reference; a fixed data URI constant; a fake FileService that records SaveTargets instead of writing to disk.
 * @outputs Boolean pass/fail per assertion across three scenarios: direct render embeds the given URI, direct render keeps the bare address when no sources are supplied, and saveHtmlExport writes embedded content with utf-8 encoding.
 * @functions
 *   - fakeService: Builds a FileService object literal that records saves into a caller-provided array while every other method is a no-op returning neutral values.
 * @dataflow DATA + DOC → exportDocumentHtml/saveHtmlExport → rendered HTML string → asserted for embedded src attribute or written SaveTarget.contents.
 * @controlflow describe runs once → each it invokes the export path with or without imageSources and asserts on the resulting string or recorded save target.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import { exportDocumentHtml, saveHtmlExport } from '../src/files/export.js';
import type { FileService, OpenedFile, SaveTarget } from '../src/files/file-service.js';

// Fixed data URI asserted against rendered output: the exact string an image source map supplies.
const DATA = 'data:image/png;base64,AA';

// A one-image document whose single reference address is img/a.png, matching the key used in the source maps.
const DOC = parseMarkdown('![a](img/a.png)\n');

/**
 * Constructs a FileService stub that records saves for export assertions while every other method is a no-op.
 * @purpose Gives saveHtmlExport a working persistence layer without touching disk, so tests can inspect what was written.
 * @inputs saved - The caller-owned array into which each SaveTarget pushed by saveFile is appended for later assertion.
 * @outputs FileService - An object literal implementing every member with neutral no-op return values except saveFile.
 * @dataflow saveFile(target) → saved.push(target); all other members resolve to null/empty/pass-through without side effects.
 * @controlflow Return a single object literal whose methods are defined inline; only saveFile mutates the shared array.
 */
function fakeService(saved: SaveTarget[]): FileService {
  return {
    available: true,
    async openFile(): Promise<OpenedFile | null> {
      // No files are opened during an export test.
      return null;
    },
    async readPath(_path: string): Promise<string> {
      // Path reads are not exercised by the export path.
      return '';
    },
    async readFile(path: string): Promise<OpenedFile> {
      return { path, contents: '', encoding: 'utf-8' };
    },
    async saveFile(target: SaveTarget): Promise<void> {
      // Record the written target so tests can assert on its embedded contents and encoding.
      saved.push(target);
    },
    async chooseSavePath(_suggestedName: string): Promise<string | null> {
      return 'C:/out/doc.html';
    },
    async chooseFolder(): Promise<string | null> {
      // No folder is chosen when saving a single HTML file.
      return null;
    },
    async renameFile(_from: string, to: string): Promise<string> {
      return to;
    },
    async revealInFileManager(_path: string): Promise<void> {
      /* comment: nothing to reveal in a test */
    },
  };
}

describe('exporting images', () => {
  it('embeds the data URI given for an image', async () => {
    // With a source map supplied, renderHtml must inline the exact data URI as the image src.
    expect(exportDocumentHtml(DOC, 'T', new Map([['img/a.png', DATA]]))).toContain(`src="${DATA}"`);
  });

  it('keeps the written address without embedded images', async () => {
    // With no source map supplied, the bare image address is preserved rather than rewritten.
    expect(exportDocumentHtml(DOC, 'T')).toContain('src="img/a.png"');
  });

  it('writes the embedded images into the saved file', async () => {
    // saveHtmlExport must render with the sources and persist the embedded HTML to the recorded target.
    const saved: SaveTarget[] = [];
    const path = await saveHtmlExport({ fileService: fakeService(saved), document: DOC, title: 'T', suggestedName: 'T.html', imageSources: new Map([['img/a.png', DATA]]) });
    expect(path).toBe('C:/out/doc.html');
    expect(saved[0]?.contents).toContain(`src="${DATA}"`);
    expect(saved[0]?.encoding).toBe('utf-8');
  });
});
