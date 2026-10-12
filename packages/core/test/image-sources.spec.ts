/**
 * @file image-sources.spec.ts
 * @purpose Vitest unit tests for replaceImageSources and the imageSources option of renderHtml (FR-13.1), verifying that local image URLs are rewritten to data URIs in an exported copy without mutating the original AST.
 * @inputs Parsed mdast Root trees produced by parseMarkdown; a sources map from local image path strings to replacement data URIs.
 * @outputs Asserted HTML export strings and arrays of collected image URLs extracted via the imageUrls helper.
 * @functions
 *   - imageUrls: Recursively walks any node tree in document order, collecting the url of every image node whose url is a string.
 *   - replaceImageSources tests: Verify copy semantics, nested traversal, no-op on empty map, and unmapped-image passthrough.
 *   - renderHtml imageSources tests: Verify data-URI embedding in standalone export and preservation of the original address when unconfigured.
 * @dataflow parseMarkdown → Root AST → replaceImageSources/renderHtml with sources map → transformed copy / HTML string; imageUrls walks the resulting tree to assert rewritten URLs in document order.
 * @controlflow describe groups tests by unit → each it parses markdown, applies a transformation, and asserts outcomes through expect matchers.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { replaceImageSources } from '../src/render/image-sources.js';
import { renderHtml } from '../src/render/html.js';
import { parseMarkdown } from '../src/parse/parser.js';

/** Data URI used as the replacement target for local image URLs across all tests. */
const DATA = 'data:image/png;base64,AA';

/**
 * Recursively collects image URLs from any object tree in document order.
 *
 * @purpose Walks an arbitrary node structure (the mdast AST) and returns every image url encountered, left-to-right as they appear in the tree.
 * @inputs root - The root of the object tree to scan; may be any value but is expected to be an mdast Root or descendant node.
 * @outputs string[] - An array of image url strings in document order.
 * @dataflow root → walk() descends into objects, pushes string urls of image nodes, and recurses into children arrays → accumulated urls returned.
 * @controlflow Guard each node with an object/null check; if it is an image with a string url push that url; then recurse into its children array when present.
 */
function imageUrls(root: unknown): string[] {
  const urls: string[] = [];

  /** Recursively visits every descendant of the tree, accumulating image urls in document order. */
  function walk(node: unknown): void {
    // Only descend into actual objects; exclude null and all primitive values from traversal.
    if (typeof node === 'object' && node !== null) {
      const obj = node as Record<string, unknown>;

      // Collect the url when this node is an image whose url is a string.
      if (obj.type === 'image' && typeof obj.url === 'string') {
        urls.push(obj.url);
      } else {
        // Not an image with a string url: skip collection for this node.
      }

      // Recurse into child nodes when the node exposes a children array.
      const children = obj.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          walk(child);
        }
      } else {
        // No children container present: stop descending this branch.
      }
    }
  }

  walk(root);
  return urls;
}

describe('replaceImageSources', () => {
  it('replaces mapped images in a copy and leaves the original alone', () => {
    // Transform a document with one local and one external image, asserting only the local URL is rewritten in the copy.
    const doc = parseMarkdown('![a](img/a.png) ![b](https://x/y.png)\n');
    const copy = replaceImageSources(doc.root, new Map([['img/a.png', DATA]]));
    expect(imageUrls(copy)).toEqual([DATA, 'https://x/y.png']);
    expect(imageUrls(doc.root)).toEqual(['img/a.png', 'https://x/y.png']);
    expect(copy).not.toBe(doc.root);
  });

  it('reaches images nested in links, emphasis, lists and quotes', () => {
    // A single local image nested inside a quoted list item with emphasis and a link should still be rewritten.
    const doc = parseMarkdown('> - [*![a](img/a.png)*](x.md)\n');
    expect(imageUrls(replaceImageSources(doc.root, new Map([['img/a.png', DATA]])))).toEqual([DATA]);
  });

  it('returns the same tree when there is nothing to replace', () => {
    // With an empty sources map the original Root object must be returned unchanged without making a copy.
    const doc = parseMarkdown('![a](img/a.png)\n');
    expect(replaceImageSources(doc.root, new Map())).toBe(doc.root);
  });

  it('leaves unmapped images unchanged', () => {
    // An image whose URL is not present in the sources map keeps its original address.
    const doc = parseMarkdown('![a](img/a.png)\n');
    expect(imageUrls(replaceImageSources(doc.root, new Map([['other.png', DATA]])))).toEqual(['img/a.png']);
  });
});

describe('renderHtml imageSources', () => {
  it('embeds the replacement in a standalone export', () => {
    // renderHtml with an imageSources option rewrites the local image to its data URI in the exported HTML.
    const doc = parseMarkdown('![a](img/a.png)\n');
    const html = renderHtml(doc, { standalone: true, title: 'T', imageSources: new Map([['img/a.png', DATA]]) });
    expect(html).toContain(`src="${DATA}"`);
    expect(html).not.toContain('src="img/a.png"');
    expect(imageUrls(doc.root)).toEqual(['img/a.png']);
  });

  it('keeps the written address without replacements', () => {
    // Without an imageSources option the original local URL is preserved in the export.
    expect(renderHtml(parseMarkdown('![a](img/a.png)\n'), { standalone: true, title: 'T' })).toContain('src="img/a.png"');
  });
});
