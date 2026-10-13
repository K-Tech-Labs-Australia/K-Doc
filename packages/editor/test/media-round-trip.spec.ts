/**
 * @file media-round-trip.spec.ts
 * @purpose Verifies a media reference survives round-tripping through ProseMirror without mutation (FR-8.17).
 * @inputs Markdown source strings describing links, image references, and provider URLs.
 * @outputs Assertion pass/fail results; no runtime values are returned to external callers.
 * @functions
 *   - throughEditor: Parse markdown, convert to ProseMirror then back to mdast, then serialize the result to a string.
 *   - blockOf: Return the first parsed document block as a ProseMirror node.
 * @dataflow Markdown source → parseMarkdown → mdastToProseMirror → proseMirrorToMdast → serializeDocument → serialized markdown string.
 * @controlflow Seven it blocks each parse input, inspect the resulting node or round-trip it through throughEditor, and assert type/attribute equality.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { mdastToProseMirror, proseMirrorToMdast } from '../src/index.js';
import type { Node as ProsemirrorNode } from 'prosemirror-model';

function throughEditor(source: string): string {
  // Parses, converts to ProseMirror and back, then serializes — the path every K-Doc edit takes.
  const doc = parseMarkdown(source);
  const root = proseMirrorToMdast(mdastToProseMirror(doc.root));
  return serializeDocument({ text: source, root, frontMatter: null });
}

function blockOf(source: string): ProsemirrorNode {
  // The first block of a parsed document, as ProseMirror sees it.
  const first = mdastToProseMirror(parseMarkdown(source).root).firstChild;
  if (first === null) { throw new Error('no first block'); }
  return first;
}

describe('a video a document links to', () => {
  // Guards that a bare link to a media file becomes a typed media player node in ProseMirror.
  it('reaches the editor as a player', () => {
    const block = blockOf('[Clip](clip.mp4)\n');
    expect(block.type.name).toBe('media');
    expect(block.attrs?.kind).toBe('video');
    expect(block.attrs?.target).toBe('clip.mp4');
    expect(block.attrs?.label).toBe('Clip');
    expect(block.attrs?.syntax).toBe('link');
  });

  // Guards that a media link round-trips to the identical markdown source.
  it('is written back as the link it was', () => {
    expect(throughEditor('[Clip](clip.mp4)\n')).toBe('[Clip](clip.mp4)\n');
  });

  // Guards that an image reference stays audio-typed and round-trips unchanged.
  it('keeps an image reference an image', () => {
    const block = blockOf('![A tune](song.mp3)\n');
    expect(block.attrs?.kind).toBe('audio');
    expect(block.attrs?.syntax).toBe('image');
    expect(throughEditor('![A tune](song.mp3)\n')).toBe('![A tune](song.mp3)\n');
  });

  // Guards that a YouTube URL is recognized as a provider with an embeddable URL.
  it('carries a provider link as a provider', () => {
    const block = blockOf('[Watch](https://youtu.be/dQw4w9WgXcQ)\n');
    expect(block.attrs?.kind).toBe('provider');
    expect(block.attrs?.provider).toBe('youtube');
    expect(block.attrs?.embedUrl).toContain('youtube-nocookie.com');
    expect(throughEditor('[Watch](https://youtu.be/dQw4w9WgXcQ)\n')).toBe('[Watch](https://youtu.be/dQw4w9WgXcQ)\n');
  });

  // Guards that a link to an ordinary .md file is left as a plain paragraph.
  it('leaves an ordinary link a paragraph', () => {
    const block = blockOf('[Notes](notes.md)\n');
    expect(block.type.name).toBe('paragraph');
  });

  // Guards that inline links inside prose are untouched and round-trip unchanged.
  it('leaves a sentence holding a link alone', () => {
    const block = blockOf('Watch [this](clip.mp4) later.\n');
    expect(block.type.name).toBe('paragraph');
    expect(throughEditor('Watch [this](clip.mp4) later.\n')).toBe('Watch [this](clip.mp4) later.\n');
  });

  // Guards that an empty-label media link serializes back as an empty markdown link.
  it('writes a player with no label as an empty link', () => {
    expect(throughEditor('[](clip.mp4)\n')).toBe('[](clip.mp4)\n');
  });
});
