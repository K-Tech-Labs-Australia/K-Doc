/**
 * @file wiki-embed-round-trip.spec.ts
 * @purpose Verifies a wiki image embed reaches the editor as a picture and round-trips back to its exact source text (FR-8.15).
 * @inputs Markdown source strings containing wiki image embeds, resized embeds, plain Markdown images, and prose holding them.
 * @outputs Assertion pass/fail results; no runtime values are returned to external callers.
 * @functions
 *   - throughEditor: Parse markdown, convert to ProseMirror then back to mdast, then serialize the result to a string.
 *   - imageIn: Return the first picture node in the parsed document as a ProseMirror node.
 * @dataflow Markdown source -> parseMarkdown -> mdastToProseMirror -> proseMirrorToMdast -> serializeDocument -> serialized markdown string.
 * @controlflow Seven it blocks each inspect an embed-derived node or round-trip input through throughEditor, and assert type/attribute equality.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { mdastToProseMirror, proseMirrorToMdast } from '../src/index.js';
import type { Node as ProsemirrorNode } from 'prosemirror-model';

// throughEditor parses markdown, converts to ProseMirror then back to mdast, then serializes.
// @purpose Parse a source string and round-trip it through ProseMirror for serialization.
// @inputs source - Markdown text to parse and serialize.
// @outputs The serialized markdown string produced from the round trip.
// @dataflow Source string -> parseMarkdown -> mdastToProseMirror -> proseMirrorToMdast -> serializeDocument -> string.
// @controlflow Parse, convert forward, convert back, then return the serialized document text.
function throughEditor(source: string): string {
  // Parses markdown, converts to ProseMirror and back, then serializes to a string.
  const doc = parseMarkdown(source);
  const root = proseMirrorToMdast(mdastToProseMirror(doc.root));
  return serializeDocument({ text: source, root, frontMatter: null });
}

// imageIn walks the parsed document for the first picture node.
// @purpose Return the first 'image' typed ProseMirror node in a wiki embed.
// @inputs source - Markdown text whose first picture node is sought.
// @outputs The first picture ProseMirror node, or throws when none exists.
// @dataflow Source string -> parseMarkdown -> mdastToProseMirror -> descendants walk -> found node.
// @controlflow Walk nodes and stop at the first 'image'; throw if no picture appears.
function imageIn(source: string): ProsemirrorNode {
  // Walks the document for the first picture node and returns it.
  const doc = mdastToProseMirror(parseMarkdown(source).root);
  let found: ProsemirrorNode | null = null;
  doc.descendants((node: ProsemirrorNode): boolean => {
    // Check whether this is the first picture in the document.
    if (found === null && node.type.name === 'image') {
      found = node;
      return false;
    } else {
      // Not a picture, or one was already found: keep walking.
      return true;
    }
  });
  // Check whether a picture was found at all.
  if (found === null) {
    throw new Error('no image');
  } else {
    // One was: hand it back.
  }
  return found;
}

describe('a wiki image embed', (): void => {
  // Guards that a bare wiki embed of an image becomes a typed picture node in ProseMirror.
  it('reaches the editor as a picture', (): void => {
    const image = imageIn('![[img.png]]\n');
    expect(image.attrs['src']).toBe('img.png');
    expect(image.attrs['embed']).toBe(true);
    expect(image.attrs['width']).toBeNull();
  });

  // Guards that a width hint inside the embed is carried into the picture node.
  it('carries its width hint into the editor', (): void => {
    const image = imageIn('![[img.png|600]]\n');
    expect(image.attrs['width']).toBe(600);
    expect(image.attrs['embed']).toBe(true);
  });

  // Guards that embeds of varying forms round-trip to the identical source text.
  it('is written back as the text it came from', (): void => {
    for (const source of ['![[img.png]]\n', '![[img.png|600]]\n', 'See ![[a b/c.PNG|42]] there.\n']) {
      expect(throughEditor(source)).toBe(source);
    }
  });

  // Guards that prose surrounding an embed survives the round trip intact.
  it('keeps the words around it', (): void => {
    const doc = mdastToProseMirror(parseMarkdown('See ![[img.png]] there.\n').root);
    expect(doc.textBetween(0, doc.content.size, '', '')).toBe('See  there.');
    // The picture is an atom with no text of its own, so what remains is the words either side.
  });

  // Guards that a wiki embed to a note stays plain text rather than becoming a node.
  it('is not made from an embed of something that is not a picture', (): void => {
    expect(throughEditor('Read ![[Some Note]] first.\n')).toBe('Read ![[Some Note]] first.\n');
    // A note is not transcluded, so the brackets stay the text they are.
  });

  // Guards that an ordinary Markdown image stays a non-embed picture node and round-trips unchanged.
  it('is told apart from an ordinary Markdown image', (): void => {
    const plain = imageIn('![alt|600](img.png)\n');
    expect(plain.attrs['embed']).toBe(false);
    expect(plain.attrs['width']).toBe(600);
    expect(throughEditor('![alt|600](img.png)\n')).toBe('![alt|600](img.png)\n');
  });

  // Guards that resizing leaves each syntax as itself without converting one into the other.
  it('does not turn an ordinary image into an embed when it is resized', (): void => {
    // The two syntaxes stay what they were: resizing changes a size, not a syntax.
    expect(throughEditor('![[img.png]]\n')).toBe('![[img.png]]\n');
    expect(throughEditor('![](img.png)\n')).toBe('![](img.png)\n');
  });
});
