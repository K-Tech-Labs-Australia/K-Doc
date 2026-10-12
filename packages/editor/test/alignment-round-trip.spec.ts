/**
 * @file packages/editor/test/alignment-round-trip.spec.ts
 * @purpose Verifies that block alignment (FR-8.11) survives a round trip through ProseMirror and can be applied from within the editor.
 * @inputs Markdown source strings with optional <div align> wrappers; an empty document for editor-originated edits.
 * @outputs Serialized markdown after each round trip or edit, asserted against expected strings via vitest matchers.
 * @functions
 *   - throughEditor: Parses markdown, converts to ProseMirror and back, then serializes the result.
 *   - blockOf: Returns the first parsed block as a ProseMirror node for alignment assertions.
 * @dataflow Markdown source → parseMarkdown root → mdastToProseMirror → (optional setBlockAlignment) → proseMirrorToMdast → serializeDocument.
 * @controlflow Two describe blocks run sequentially; each test builds state, applies the command or round trip, and asserts equality.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema, mdastToProseMirror, proseMirrorToMdast, setBlockAlignment } from '../src/index.js';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProsemirrorNode } from 'prosemirror-model';

/**
 * @purpose Parses markdown, converts to ProseMirror and back, then serializes — the path every WYSIWYG edit takes.
 * @inputs source - Raw markdown string that should round-trip unchanged when untouched by an edit.
 * @outputs string - The serialized document after a full parse → ProseMirror → mdast → serialize cycle.
 * @dataflow Source text → parseMarkdown root → mdastToProseMirror → proseMirrorToMdast → serializeDocument output.
 * @controlflow Runs the four conversion steps in sequence with no branching and returns the final string.
 */
function throughEditor(source: string): string {
  const doc = parseMarkdown(source);
  const pmDoc = mdastToProseMirror(doc.root);
  const root = proseMirrorToMdast(pmDoc);
  return serializeDocument({ text: source, root, frontMatter: null });
}

/**
 * @purpose Returns the first block of a parsed document as ProseMirror sees it.
 * @inputs source - Markdown whose leading block is inspected for alignment attributes.
 * @outputs Node (ProseMirror) - The first child node of the converted document tree.
 * @dataflow Source text → parseMarkdown root → mdastToProseMirror → firstChild extraction.
 * @controlflow Converts then returns the first child; throws when the document has no children.
 */
function blockOf(source: string): ProsemirrorNode {
  const pmDoc = mdastToProseMirror(parseMarkdown(source).root);
  const first = pmDoc.firstChild;
  // Guard against an empty document with no leading block to inspect for alignment.
  if (first === null) { throw new Error('no first block'); }
  return first;
}

describe('a block aligned in the file', () => {
  it('reaches the editor as an aligned paragraph', () => {
    // Guards that a centred div wrapper survives into ProseMirror as an aligned paragraph.
    const block = blockOf('<div align="center">\n\nCentred.\n\n</div>\n');
    expect(block.type.name).toBe('paragraph');
    expect(block.attrs.align).toBe('center');
  });

  it('reaches the editor as an aligned heading', () => {
    // Guards that a right-aligned div wrapper survives into ProseMirror as an aligned heading.
    const block = blockOf('<div align="right">\n\n# Title\n\n</div>\n');
    expect(block.type.name).toBe('heading');
    expect(block.attrs.align).toBe('right');
  });

  it('is written back unchanged by an edit that does not touch it', () => {
    // Guards that a centred block round-trips to its exact original markdown when untouched.
    const expected = '<div align="center">\n\nCentred.\n\n</div>\n';
    expect(throughEditor(expected)).toBe(expected);
  });

  it('is an ordinary block when the file has no wrapper', () => {
    // Guards that a plain paragraph carries no alignment attribute.
    const block = blockOf('Plain.\n');
    expect(block.attrs.align).toBeNull();
  });

  it('keeps its inline formatting', () => {
    // Guards that an aligned block still exposes multiple inline children (text plus bold run).
    const block = blockOf('<div align="center">\n\nSome **bold**.\n\n</div>\n');
    expect(block.childCount).toBeGreaterThan(1);
  });
});

describe('aligning a block in the editor', () => {
  it('writes the wrapper into the file', () => {
    // Guards that aligning a plain block writes an aligned div back to the source.
    const state = EditorState.create({ schema: kdocSchema, doc: mdastToProseMirror(parseMarkdown('Plain.\n').root) });
    let next = state;
    const applied = setBlockAlignment('center')(state, (tr): void => { next = state.apply(tr); });
    expect(applied).toBe(true);
    const root = proseMirrorToMdast(next.doc);
    const serialized = serializeDocument({ text: '', root, frontMatter: null });
    expect(serialized).toBe('<div align="center">\n\nPlain.\n\n</div>\n');
  });

  it('clears it again', () => {
    // Guards that clearing alignment removes the wrapper and restores plain markdown.
    const state = EditorState.create({ schema: kdocSchema, doc: mdastToProseMirror(parseMarkdown('<div align="center">\n\nCentred.\n\n</div>\n').root) });
    let next = state;
    setBlockAlignment(null)(state, (tr): void => { next = state.apply(tr); });
    const root = proseMirrorToMdast(next.doc);
    const serialized = serializeDocument({ text: '', root, frontMatter: null });
    expect(serialized).toBe('Centred.\n');
  });

  it('reports nothing to do when the block is already aligned that way', () => {
    // Guards that aligning an already-aligned block returns false without a dispatch.
    const state = EditorState.create({ schema: kdocSchema, doc: mdastToProseMirror(parseMarkdown('<div align="center">\n\nCentred.\n\n</div>\n').root) });
    const applied = setBlockAlignment('center')(state);
    expect(applied).toBe(false);
  });

  it('refuses a block that cannot be aligned', () => {
    // Guards that alignment is rejected for non-paragraph/heading blocks such as code fences.
    const state = EditorState.create({ schema: kdocSchema, doc: mdastToProseMirror(parseMarkdown('```\ncode\n```\n').root) });
    const applied = setBlockAlignment('center')(state);
    expect(applied).toBe(false);
  });

  // Guards that an aligned heading written from the editor keeps both its level and its wrapper.
  it('keeps a heading a heading', () => {
    const state = EditorState.create({ schema: kdocSchema, doc: mdastToProseMirror(parseMarkdown('## Heading\n').root) });
    let next = state;
    setBlockAlignment('center')(state, (tr): void => { next = state.apply(tr); });
    const root = proseMirrorToMdast(next.doc);
    expect(serializeDocument({ text: '', root, frontMatter: null })).toBe('<div align="center">\n\n## Heading\n\n</div>\n');
  });

  // Guards that an aligned heading read from a file is written back unchanged through the editor.
  it('writes an aligned heading back unchanged', () => {
    const expected = '<div align="left">\n\n## Heading\n\n</div>\n';
    expect(throughEditor(expected)).toBe(expected);
  });

  // Guards that an aligned block is rendered with the style that makes the alignment visible.
  it('is rendered with the alignment it carries', () => {
    const block = blockOf('<div align="center">\n\nCentred.\n\n</div>\n');
    const toDOM = kdocSchema.nodes['paragraph']?.spec.toDOM;
    // The paragraph spec always defines toDOM; without it there is nothing to assert.
    if (toDOM === undefined) {
      throw new Error('the paragraph node has no toDOM');
    } else {
      // Present: render the aligned block and read the attributes it asks the browser for.
    }
    expect(JSON.stringify(toDOM(block))).toContain('text-align: center');
  });

  it('aligns every block the selection covers', () => {
    // Guards that alignment applies to all blocks within a multi-block selection.
    const doc = mdastToProseMirror(parseMarkdown('One.\n\nTwo.\n').root);
    const all = EditorState.create({ schema: kdocSchema, doc });
    const wide = all.apply(all.tr.setSelection(TextSelection.create(all.doc, 1, all.doc.content.size - 1)));
    let next = wide;
    setBlockAlignment('right')(wide, (tr): void => { next = wide.apply(tr); });
    const root = proseMirrorToMdast(next.doc);
    const serialized = serializeDocument({ text: '', root, frontMatter: null });
    expect(serialized).toBe('<div align="right">\n\nOne.\n\n</div>\n\n<div align="right">\n\nTwo.\n\n</div>\n');
  });
});
