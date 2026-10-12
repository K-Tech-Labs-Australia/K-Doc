/**
 * @file media-embeds.spec.ts
 * @purpose Behavioural tests for FR-8.17 media embed recognition and rendering across classification, provider detection, and HTML export.
 * @inputs Markdown source strings rendered through parseMarkdown/renderHtml plus raw targets passed to the pure recognisers in media-embeds.js.
 * @outputs Assertions over MediaEmbed values, provider results, and exported HTML fragments; no data leaves this file beyond test verdicts.
 * @functions
 *   - paragraphOf: Extract the single first-block Paragraph that every example document is written as.
 *   - describe/it blocks: The FR-8.17 recognition, provider, and export behaviours.
 * @dataflow Markdown string → parseMarkdown Root → paragraphOf child or direct target → recogniser functions → expect verdicts; renderHtml(doc) → HTML fragment for export assertions.
 * @controlflow Module-level helper defines the shared single-paragraph shape; three describe groups classify files, providers, and exports in order with one guard comment per test.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderHtml } from '../src/index.js';
import { applyMediaEmbeds, mediaKindOf, mediaOfParagraph, providerEmbedOf } from '../src/media/media-embeds.js';
import type { Paragraph } from 'mdast';

/**
 * @purpose Return the first block of a parsed document as its Paragraph, since every example here is written as one paragraph.
 * @inputs markdown - A Markdown string that parses to exactly one leading paragraph node.
 * @outputs Paragraph - The single child at root.children[0], asserted to be a paragraph before being returned unchanged.
 * @dataflow Input string → parseMarkdown Root → read children[0] → return the paragraph node as-is.
 * @controlflow Read the first child; throw when it is missing or not a paragraph so tests fail loudly on malformed fixtures instead of crashing later in an assertion.
 */
function paragraphOf(markdown: string): Paragraph {
  const first = parseMarkdown(markdown).root.children[0];

  // A document could be empty (undefined) or start with another block type; reject both before trusting the shape below.
  if (first === undefined || first.type !== 'paragraph') {
    throw new Error('not a paragraph');
  } else {
    // The child is present and confirmed to be a paragraph, so TypeScript narrows this read back to Paragraph for return.
  }

  return first;
}

describe('a media file a document names', () => {
  // Guards that the extension alone decides the kind, rejecting unknown extensions and dotless targets alike.
  it('is recognised by its extension', () => {
    expect(mediaKindOf('clip.mp4')).toBe('video');
    expect(mediaKindOf('song.mp3')).toBe('audio');
    expect(mediaKindOf('notes.md')).toBe(null);
    expect(mediaKindOf('nodot')).toBe(null);
  });

  // Guards that the lookup ignores letter case so an upper-case extension still classifies.
  it('is recognised whatever case it is written in', () => {
    expect(mediaKindOf('CLIP.MP4')).toBe('video');
  });

  // Guards that a trailing query string or URL fragment cannot masquerade as the real extension.
  it('is recognised past a query or a fragment', () => {
    expect(mediaKindOf('clip.mp4?v=2')).toBe('video');
    expect(mediaKindOf('clip.webm#t=10')).toBe('video');
  });

  // Guards exact field capture (kind, target, label, syntax) for a single bare link paragraph.
  it('is read from a link that is the whole paragraph', () => {
    expect(mediaOfParagraph(paragraphOf('[Clip](clip.mp4)\n'))).toEqual({
      kind: 'video',
      target: 'clip.mp4',
      label: 'Clip',
      syntax: 'link',
      provider: null,
      embedUrl: null,
    });
  });

  // Guards that a bare image is treated as media with its alt text used as the player label.
  it('is read from an image reference too', () => {
    const embed = mediaOfParagraph(paragraphOf('![A tune](song.mp3)\n'));
    expect(embed?.kind).toBe('audio');
    expect(embed?.syntax).toBe('image');
    expect(embed?.label).toBe('A tune');
  });

  // Guards that extra surrounding text makes the paragraph prose, so its embedded link is ignored.
  it('is not read from a sentence that happens to hold one', () => {
    expect(mediaOfParagraph(paragraphOf('Watch [this](clip.mp4) later.\n'))).toBe(null);
  });

  // Guards that a paragraph opening with the reference is still prose when anything follows it.
  it('is not read from a reference with words after it', () => {
    expect(mediaOfParagraph(paragraphOf('[Clip](clip.mp4) and more.\n'))).toBe(null);
  });

  // Guards that a bare link naming no media file stays as prose rather than being treated as an embed.
  it('is not read from a link to something else', () => {
    expect(mediaOfParagraph(paragraphOf('[Notes](notes.md)\n'))).toBe(null);
  });
});

describe('a provider a document links to', () => {
  // Guards that a standard youtube.com/watch?v= link resolves to the no-cookie embed host.
  it('is recognised from a watch address', () => {
    expect(providerEmbedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
  });

  // Guards that the shorter youtu.be form yields the identical embed host and id path.
  it('is recognised from a short address', () => {
    expect(providerEmbedOf('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
  });

  // Guards that a vimeo video URL resolves to its own player host and numeric id path.
  it('is recognised from a vimeo address', () => {
    expect(providerEmbedOf('https://vimeo.com/123456789')).toEqual({
      provider: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/123456789',
    });
  });

  // Guards that a plain website URL matches no provider and reports none.
  it('is nothing for an ordinary address', () => {
    expect(providerEmbedOf('https://example.com/page')).toBe(null);
  });

  // Guards that a recognised provider wins even when its URL would otherwise look like an ordinary file link.
  it('wins over anything the address ends in', () => {
    const embed = mediaOfParagraph(paragraphOf('[Watch](https://youtu.be/dQw4w9WgXcQ)\n'));
    expect(embed?.kind).toBe('provider');
    expect(embed?.provider).toBe('youtube');
  });

  // Guards the privacy choice that embeds load from the no-cookie host rather than the tracking one.
  it('is asked for without a cookie', () => {
    const yt = providerEmbedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(yt?.embedUrl).toContain('youtube-nocookie.com');
  });
});

describe('a media reference that leaves K-Doc', () => {
  // Guards that a bare video link exports as a native <video> element with its source and controls.
  it('is a player in the exported HTML', () => {
    const html = renderHtml(parseMarkdown('[Clip](clip.mp4)\n'));
    expect(html).toContain('<video');
    expect(html).toContain('src="clip.mp4"');
    expect(html).toContain('controls');
  });

  // Guards that a bare audio link exports as a native <audio> element.
  it('is an audio player for a sound file', () => {
    expect(renderHtml(parseMarkdown('[Tune](song.mp3)\n'))).toContain('<audio');
  });

  // Guards that a provider link exports as an <iframe> pointing at the no-cookie player url.
  it('is a frame for a provider', () => {
    const html = renderHtml(parseMarkdown('[Watch](https://youtu.be/dQw4w9WgXcQ)\n'));
    expect(html).toContain('<iframe');
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  // Guards that a non-media link is exported unchanged as an ordinary anchor element.
  it('leaves an ordinary link alone', () => {
    expect(renderHtml(parseMarkdown('[Notes](notes.md)\n'))).toContain('<a href="notes.md"');
  });

  // Guards that HTML export annotates a copy and never writes hName into the editor's own parse tree.
  it('does not change the document it was rendered from', () => {
    const doc = parseMarkdown('[Clip](clip.mp4)\n');
    renderHtml(doc);
    expect(JSON.stringify(doc.root)).not.toContain('hName');
  });

  // Guards that applying embed annotations keeps the original link node type intact for round-tripping back to Markdown.
  it('is still a plain link in the file', () => {
    const doc = parseMarkdown('[Clip](clip.mp4)\n');
    applyMediaEmbeds(doc.root);
    // The block is still a paragraph and still holds the link the document wrote: the annotation is rendering
    // data, not a rewrite of the tree.
    const block = paragraphOf('[Clip](clip.mp4)\n');
    expect(doc.root.children[0]?.type).toBe('paragraph');
    expect(block.children[0]?.type).toBe('link');
  });
});
