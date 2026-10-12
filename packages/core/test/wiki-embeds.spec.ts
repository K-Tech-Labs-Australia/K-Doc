/**
 * @file wiki-embeds.spec.ts
 * @purpose Exercises the wiki image embed reader (src/images/wiki-embeds.ts) across targets, bracket contents, text runs, and whole documents.
 * @inputs Parsed Markdown Roots via parseMarkdown; public functions from src/images/wiki-embeds.js.
 * @outputs Vitest assertions covering parsing, splitting, expansion, and target listing.
 * @functions
 *   - paragraphOf: Returns the Root's leading paragraph so tests can index its children by position.
 *   - describe blocks 'a target', 'what is inside the brackets', 'a run of text', 'a document': Grouped assertions for each reader concern.
 * @dataflow Markdown source -> parseMarkdown -> Root -> public embed functions -> assertion results.
 * @controlflow Each it runs its expectations in order; paragraphOf guards tree shape before indexing children.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderFragment, renderHtml } from '../src/index.js';
import {
  expandWikiEmbeds,
  isWikiImageTarget,
  parseWikiEmbed,
  splitWikiEmbeds,
  wikiEmbedTargets,
  wikiEmbedText,
} from '../src/images/wiki-embeds.js';
import type { Image, Paragraph, Root, Text } from 'mdast';

/**
 * @purpose Returns the first child of a Root when it is a paragraph, so tests can reach into the tree's text and image nodes by index.
 * @inputs root - The mdast Root whose leading node is inspected; assumed to be produced by parseMarkdown for these tests.
 * @returns Paragraph - The first child when its type is 'paragraph'.
 * @dataflow root.children[0] -> type check -> returned paragraph or thrown error.
 * @controlflow Reads the first child and compares it against undefined and the 'paragraph' type; returns it on match, throws new Error('no paragraph') otherwise via an explicit else branch.
 */
function paragraphOf(root: Root): Paragraph {
  const first = root.children[0];

  // Check whether there is a leading node at all and whether it is a paragraph rather than some other top-level block.
  if (first === undefined || first.type !== 'paragraph') {
    throw new Error('no paragraph');
  } else {
    // It is the expected paragraph: hand it back so callers can index its children directly.
  }

  return first;
}

describe('a target', (): void => {
  it('is a picture when its extension says so', (): void => {
    expect(isWikiImageTarget('img.png')).toBe(true);
    expect(isWikiImageTarget('Photo.JPEG')).toBe(true);
    expect(isWikiImageTarget('a/b/c.webp')).toBe(true);
  });

  it('reads the extension from the last dot, not the first', (): void => {
    expect(isWikiImageTarget('photo.v2.png')).toBe(true);
    expect(isWikiImageTarget('photo.png.bak')).toBe(false);
  });

    it('is not a picture when the dot is the whole of the name', (): void => {
    // A file called `.png` is a dotfile with no name, not a picture, which is why the dot has to be
    // somewhere after the first character rather than merely present.
    expect(isWikiImageTarget('.png')).toBe(false);
  });

  it('is not a picture without an extension K-Doc draws', (): void => {
    expect(isWikiImageTarget('Some Note')).toBe(false);
    expect(isWikiImageTarget('notes.md')).toBe(false);
    expect(isWikiImageTarget('.hidden')).toBe(false);
    expect(isWikiImageTarget('clip.mp4')).toBe(false);
  });
});

describe('what is inside the brackets', (): void => {
  it('reads a bare target', (): void => {
    expect(parseWikiEmbed('img.png')).toEqual({ target: 'img.png', width: null });
  });

  it('reads a width after the last pipe', (): void => {
    expect(parseWikiEmbed('img.png|600')).toEqual({ target: 'img.png', width: 600 });
  });

  it('keeps a pipe that is not carrying a width', (): void => {
    // A caption is not a size, and losing it would be worse than ignoring it.
    expect(parseWikiEmbed('a|b.png')).toEqual({ target: 'a|b.png', width: null });
  });

    it('reads the width from the last pipe when there are several', (): void => {
    expect(parseWikiEmbed('a|b.png|300')).toEqual({ target: 'a|b.png', width: 300 });
  });

  it('leaves a bracket alone when its width is not a width', (): void => {
    // A leading zero and six digits are both outside the rule image-hints.ts uses. What is left is a
    // target ending `png|0`, which names no picture, so the brackets stay the text the reader wrote
    // rather than being drawn at a size K-Doc had to guess.
    expect(parseWikiEmbed('img.png|0')).toBeNull();
    expect(parseWikiEmbed('img.png|123456')).toBeNull();
  });

  it('leaves alone what is not a picture', (): void => {
    expect(parseWikiEmbed('Some Note')).toBeNull();
    expect(parseWikiEmbed('Some Note|300')).toBeNull();
  });

  it('writes back exactly what it read', (): void => {
    for (const source of ['![[img.png]]', '![[img.png|600]]', '![[a b/c.PNG|42]]']) {
      const inside = source.slice(3, -2);
      const embed = parseWikiEmbed(inside);
      expect(embed).not.toBeNull();
      if (embed !== null) {
        // The read-back text must match the original exactly.
        expect(wikiEmbedText(embed)).toBe(source);
      } else {
        // Unreachable: every source above names a picture, so embed is never null here.
      }
    }
  });
});

describe('a run of text', (): void => {
  it('comes back whole when it holds no embed', (): void => {
    const parts = splitWikiEmbeds('Just words.');
    expect(parts).toEqual([{ kind: 'text', value: 'Just words.' }]);
  });

  it('is cut around an embed', (): void => {
    const parts = splitWikiEmbeds('See ![[img.png|600]] there.');
    expect(parts.length).toBe(3);
    expect(parts[0]).toEqual({ kind: 'text', value: 'See ' });
    expect(parts[1]).toEqual({ kind: 'embed', embed: { target: 'img.png', width: 600 } });
    expect(parts[2]).toEqual({ kind: 'text', value: ' there.' });
  });

  it('makes no empty stretch around an embed that stands alone', (): void => {
    const parts = splitWikiEmbeds('![[img.png]]');
    expect(parts).toEqual([{ kind: 'embed', embed: { target: 'img.png', width: null } }]);
  });

    it('does not let an embed run past the end of its line', (): void => {
    // Brackets that never close on their line are not an embed. Letting the scan cross a newline would
    // make one out of two unrelated lines and swallow the words between them.
    expect(splitWikiEmbeds('![[a\nb.png]]')).toEqual([{ kind: 'text', value: '![[a\nb.png]]' }]);
  });

  it('carries an embed of something else out with the text', (): void => {
    const parts = splitWikiEmbeds('Read ![[Some Note]] first.');
    expect(parts).toEqual([{ kind: 'text', value: 'Read ![[Some Note]] first.' }]);
  });

  it('finds every embed in one run', (): void => {
    const parts = splitWikiEmbeds('![[a.png]] and ![[b.png|80]]');
    expect(parts.filter((part): boolean => part.kind === 'embed').length).toBe(2);
  });
});

describe('a document', (): void => {
  it('draws its embeds as pictures without changing itself', (): void => {
    const root = parseMarkdown('See ![[img.png|600]] there.\n').root;
    const drawn = expandWikiEmbeds(root);
    const image = paragraphOf(drawn).children[1];
    expect(image?.type).toBe('image');
    // The width goes into the alt slot, which is the shape image-hints.ts reads to make it a width attribute.
    expect((image as Image).url).toBe('img.png');
    expect((image as Image).alt).toBe('|600');
    // The tree the reader holds still says what it said.
    const original = paragraphOf(root).children[0];
    expect(original?.type).toBe('text');
    expect((original as Text).value).toBe('See ![[img.png|600]] there.');
  });

  it('leaves a document with no embed exactly as it was', (): void => {
    const root = parseMarkdown('Just words.\n').root;
    expect(expandWikiEmbeds(root)).toEqual(root);
  });

  it('names each picture it embeds once, in order', (): void => {
    const root = parseMarkdown('![[b.png]] then ![[a.png]] then ![[b.png|20]]\n').root;
    expect(wikiEmbedTargets(root)).toEqual(['b.png', 'a.png']);
  });

  it('names nothing when it embeds nothing', (): void => {
    expect(wikiEmbedTargets(parseMarkdown('Just words.\n').root)).toEqual([]);
  });
});

describe('what leaves K-Doc', (): void => {
  it('draws an embedded picture rather than its brackets', (): void => {
    const html = renderFragment(parseMarkdown('See ![[img.png]] there.\n').root);
    expect(html).toContain('<img src="img.png"');
    expect(html).not.toContain('![[');
  });

  it('turns an embed width hint into a width attribute', (): void => {
    const html = renderFragment(parseMarkdown('![[img.png|600]]\n').root);
    expect(html).toContain('width="600"');
    // The hint travels through the alt slot, so it must not be left showing as alt text.
    expect(html).not.toContain('alt="|600"');
  });

  it('leaves an embed of something that is not a picture as words', (): void => {
    const html = renderFragment(parseMarkdown('Read ![[Some Note]] first.\n').root);
    expect(html).toContain('![[Some Note]]');
  });

  it('embeds the picture an export was given an address for', (): void => {
    const document = parseMarkdown('![[img.png|600]]\n');
    const html = renderHtml(document, { imageSources: new Map([['img.png', 'data:image/png;base64,AAAA']]) });
    expect(html).toContain('data:image/png;base64,AAAA');
    // The document the reader holds still says what it said.
    expect(document.text).toBe('![[img.png|600]]\n');
  });
});
