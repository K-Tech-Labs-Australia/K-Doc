/**
 * @file lint-links.spec.ts
 * @purpose Verifies empty-link reporting with quick fixes, local image classification, missing-image findings, and broken in-document anchor detection (FR-12.7).
 * @inputs Parsed KdocDocument via parseMarkdown; a hasAnchor predicate returning whether a decoded slug matches a heading; pre-computed ImageRef records plus a set of missing URLs.
 * @outputs LintFinding[] returned by emptyLinks, localImages, missingImages and brokenAnchors; edited source text from applyLintEdits.
 * @functions
 *   - emptyLinks: report links missing an address or text and propose quick fixes.
 *   - localImages: collect image references that point at local files.
 *   - missingImages: flag local images whose addresses are absent from disk.
 *   - brokenAnchors: flag in-document anchors no heading defines.
 *   - applyLintEdits: apply a fix's edits to source text and return the result.
 * @dataflow parseMarkdown → rule function under test → finding array → expect assertions; where a fix exists, fix.edits → applyLintEdits → edited string assertion.
 * @controlflow For each describe block, run parseMarkdown on a fixture, call the rule, assert findings equality, and (where present) apply the proposed fix to confirm it edits source as expected.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { brokenAnchors } from '../src/lint/anchor-rules.js';
import { emptyLinks, localImages, missingImages } from '../src/lint/link-rules.js';
import { applyLintEdits } from '../src/lint/lint-finding.js';
import { parseMarkdown } from '../src/parse/parser.js';

describe('emptyLinks', () => {
  it('reports a link with no address and unwraps it', () => {
    // An empty-address link should be reported and its inner text preserved by the fix.
    const text = 'See [docs]().\n';
    const found = emptyLinks(parseMarkdown(text));
    expect(found).toEqual([
      {
        rule: 'empty-link',
        label: 'docs',
        message: 'Link has no address',
        from: 4,
        to: 12,
        fix: {
          label: 'Remove the link, keep the text',
          edits: [{ from: 4, to: 12, insert: 'docs' }],
        },
      },
    ]);
    const fix = found[0]?.fix;
    if (fix === undefined || fix === null) {
      throw new Error('expected a fix');
    }
    expect(applyLintEdits(text, fix.edits)).toBe('See docs.\n');
  });

  it('reports a link with no text and fills in the address', () => {
    // A textless "[]" link should be reported and filled with its address by the fix.
    const text = 'Go [](https://a.b) now\n';
    const found = emptyLinks(parseMarkdown(text));
    expect(found).toEqual([
      {
        rule: 'empty-link',
        label: 'https://a.b',
        message: 'Link has no text',
        from: 3,
        to: 18,
        fix: {
          label: 'Use the address as text',
          edits: [{ from: 4, to: 4, insert: 'https://a.b' }],
        },
      },
    ]);
    const fix = found[0]?.fix;
    if (fix === undefined || fix === null) {
      throw new Error('expected a fix');
    }
    expect(applyLintEdits(text, fix.edits)).toBe('Go [https://a.b](https://a.b) now\n');
  });

  it('removes a link with neither', () => {
    // A completely empty link should be reported and removed wholesale by the fix.
    expect(emptyLinks(parseMarkdown('[]()\n'))).toEqual([
      {
        rule: 'empty-link',
        label: '(no text)',
        message: 'Link has no address',
        from: 0,
        to: 4,
        fix: {
          label: 'Remove the empty link',
          edits: [{ from: 0, to: 4, insert: '' }],
        },
      },
    ]);
  });

  it('offers no fix for a link whose text is only spaces', () => {
    // The fill-in fix inserts between "[" and "]", so it is only offered when the brackets are empty.
    const found = emptyLinks(parseMarkdown('Go [ ](https://a.b)\n'));
    expect(found.map((f) => f.message)).toEqual(['Link has no text']);
    expect(found[0]?.fix).toBeNull();
  });

  it('leaves a complete link alone', () => {
    // A link with both text and address produces no findings.
    expect(emptyLinks(parseMarkdown('[ok](x.md)\n'))).toEqual([]);
  });

  it('does not call an image link textless', () => {
    // A link whose only child is an image carries visible content, so it is not reported.
    expect(emptyLinks(parseMarkdown('[![a](i.png)](x.md)\n'))).toEqual([]);
  });
});

describe('localImages', () => {
  it('keeps local files and skips web, data, anchor and protocol-relative addresses', () => {
    // Only the relative image address is classified as a local reference.
    expect(
      localImages(
        parseMarkdown('![a](img/a.png) ![b](https://x/y.png) ![c](data:image/png;base64,AA) ![d](#frag) ![e](//cdn/x.png)\n'),
      ),
    ).toEqual([{ url: 'img/a.png', from: 0, to: 15 }]);
  });

  it('treats a drive path as local', () => {
    // A Windows drive-letter path counts as a local image reference.
    expect(localImages(parseMarkdown('![d](C:/p/d.png)\n')).map((i) => i.url)).toEqual(['C:/p/d.png']);
  });
});

describe('missingImages', () => {
  it('reports only the images named missing, in order', () => {
    // Only references whose address is present in the missing set become findings.
    expect(
      missingImages(
        [
          { url: 'a.png', from: 0, to: 5 },
          { url: 'b.png', from: 6, to: 9 },
        ],
        new Set(['b.png']),
      ),
    ).toEqual([
      {
        rule: 'missing-image',
        label: 'b.png',
        message: 'Image file not found',
        from: 6,
        to: 9,
        fix: null,
      },
    ]);
  });

  it('reports nothing when nothing is missing', () => {
    // With an empty missing set no reference is flagged.
    expect(missingImages([{ url: 'a.png', from: 0, to: 5 }], new Set())).toEqual([]);
  });
});

describe('brokenAnchors', () => {
  it('reports an anchor no heading has', () => {
    // Only the link whose decoded slug matches no heading is reported.
    expect(
      brokenAnchors(
        parseMarkdown('# Intro\n\nSee [x](#intro) and [y](#missing).\n'),
        (slug: string): boolean => slug === 'intro',
      ),
    ).toEqual([
      {
        rule: 'broken-anchor',
        label: '#missing',
        message: 'No heading in this document has this anchor',
        from: 29,
        to: 42,
        fix: null,
      },
    ]);
  });

  it('decodes the anchor before asking', () => {
    // A percent-encoded slug is decoded before being matched against the predicate.
    expect(
      brokenAnchors(
        parseMarkdown('[z](#caf%C3%A9)\n'),
        (slug: string): boolean => slug === 'caf\u00e9',
      ),
    ).toEqual([]);
  });

  it('keeps an anchor that does not decode', () => {
    // A malformed percent sequence is passed through untouched to the predicate.
    const asked: string[] = [];
    brokenAnchors(parseMarkdown('[z](#100%)\n'), (slug: string): boolean => {
      asked.push(slug);
      return true;
    });
    expect(asked).toEqual(['100%']);
  });

  it('ignores a bare hash and other addresses', () => {
    // Only in-document anchors are checked; placeholders, external URLs and file links are skipped.
    expect(
      brokenAnchors(
        parseMarkdown('[a](#) [b](https://x.y/#z) [c](note.md#z)\n'),
        (): boolean => false,
      ),
    ).toEqual([]);
  });
});
