/**
 * @file packages/core/test/image-hints.spec.ts
 * @purpose Unit tests covering image width hint parsing, serialization, and rendering behavior.
 * @inputs Test strings and AST roots produced by parseMarkdown; MAX_IMAGE_WIDTH constant from ../src/index.js.
 * @outputs Assertion results via vitest expect; no runtime values returned beyond pass/fail.
 * @functions
 *   - describe: Groups the six image width hint test cases under a single suite.
 * @dataflow Import helpers → feed inputs to splitImageAlt/joinImageAlt/renderFragment/parseMarkdown/buildOutline → assert outputs against expected values.
 * @controlflow Mount describe block → run each it() sequentially → fail fast on first assertion mismatch.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { applyImageWidths, buildOutline, joinImageAlt, parseMarkdown, renderFragment, splitImageAlt, MAX_IMAGE_WIDTH } from '../src/index.js';

describe('image width hints', () => {
  // Verifies splitImageAlt extracts a trailing numeric width and preserves embedded bars in the alt text.
  it('reads a width after the last bar', () => {
    expect(splitImageAlt('A logo|600')).toEqual({ alt: 'A logo', width: 600 });
    expect(splitImageAlt('a|b|40')).toEqual({ alt: 'a|b', width: 40 });
    expect(splitImageAlt('|600')).toEqual({ alt: null, width: 600 });
  });

  // Verifies non-width hints (leading zeros, overflow values) and empty/null inputs are left untouched.
  it('leaves alt text that is not a width hint alone', () => {
    expect(splitImageAlt('A logo')).toEqual({ alt: 'A logo', width: null });
    expect(splitImageAlt('Chart|0600')).toEqual({ alt: 'Chart|0600', width: null });
    expect(splitImageAlt('Chart|0')).toEqual({ alt: 'Chart|0', width: null });
    expect(splitImageAlt(`Chart|${MAX_IMAGE_WIDTH + 1}`)).toEqual({ alt: `Chart|${MAX_IMAGE_WIDTH + 1}`, width: null });
    expect(splitImageAlt(`Chart|${MAX_IMAGE_WIDTH}`)).toEqual({ alt: 'Chart', width: MAX_IMAGE_WIDTH });
    expect(splitImageAlt('')).toEqual({ alt: '', width: null });
    expect(splitImageAlt(null)).toEqual({ alt: null, width: null });
    expect(splitImageAlt(undefined)).toEqual({ alt: null, width: null });
  });

  // Verifies joinImageAlt serializes the width and returns null only when both parts are absent.
  it('writes the hint back only when there is a width', () => {
    expect(joinImageAlt('A logo', 600)).toBe('A logo|600');
    expect(joinImageAlt(null, 600)).toBe('|600');
    expect(joinImageAlt('A logo', null)).toBe('A logo');
    expect(joinImageAlt(null, null)).toBeNull();
  });

  // Verifies end-to-end markdown parsing renders the width attribute and strips the hint from alt.
  it('exports the width as an attribute and a clean alt', () => {
    const html = renderFragment(parseMarkdown('![A logo|120](logo.png "Caption")\n').root);
    expect(html).toContain('alt="A logo"');
    expect(html).toContain('width="120"');
    expect(html).not.toContain('|120');
  });

  // Verifies applyImageWidths mutates a copy rather than the original AST.
  it('does not change the tree it was given', () => {
    const root = parseMarkdown('![A logo|120](logo.png)\n').root;
    applyImageWidths(root);
    const paragraph = root.children[0];
    const image = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
    expect(image?.type === 'image' ? image.alt : null).toBe('A logo|120');
  });

  // Verifies buildOutline strips image width hints from rendered heading text.
  // An image without a hint is copied as it was, with no HTML properties added.
  it('adds nothing to an image without a hint', () => {
    const copy = applyImageWidths(parseMarkdown('![Plain](p.png)\n').root);
    const paragraph = copy.children[0];
    const image = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
    expect(image?.type === 'image' ? image.data : 'not an image').toBeUndefined();
  });

  // HTML properties an image already carries are kept alongside the width.
  it('keeps existing HTML properties next to the width', () => {
    const root = parseMarkdown('![Logo|50](l.png)\n').root;
    const paragraph = root.children[0];
    const image = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
    if (image?.type !== 'image') {
      throw new Error('expected an image');
    } else {
      image.data = { hProperties: { className: 'logo' } } as unknown as typeof image.data;
      const html = renderFragment(root);
      expect(html).toContain('class="logo"');
      expect(html).toContain('width="50"');
    }
  });

  it('keeps the hint out of heading text in the outline', () => {
    expect(buildOutline(parseMarkdown('# See ![logo|40](l.png) here\n'))[0]?.text).toBe('See logo here');
  });
});
