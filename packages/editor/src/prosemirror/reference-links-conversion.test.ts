// @vitest-environment jsdom
/**
 * @file reference-links-conversion.test.ts
 * @purpose Verifies that reference-style markdown links (full, collapsed, shortcut) round-trip through ProseMirror conversion and serialization.
 * @inputs Markdown source strings; the kdoc schema; prosemirror-model/markers helpers.
 * @outputs Serialized markdown strings; link mark attributes; DOM text content assertions.
 * @functions
 *   - docOf: Parses a markdown string into a ProseMirror document via mdast.
 *   - markdownOf: Serializes a ProseMirror document back to its markdown representation.
 *   - linkMarks: Collects the ordered, unique link marks in a document.
 *   - rangeOf: Locates the [from, to) character range of a substring within a document.
 * @dataflow Markdown → parseMarkdown → mdast → mdastToProseMirror → ProseMirror node → proseMirrorToMdast → serializeDocument → markdown.
 * @controlflow describe suite runs each it() case; helpers build and inspect docs before assertions.
 * @version 1
 * @date 2026-09-16
 */
import { describe, expect, it } from 'vitest';
import { DOMSerializer } from 'prosemirror-model';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { referenceAttrsOf } from './reference-links.js';

const SAMPLE = 'See [the site][home], [Example][] and [Docs].\n\n[home]: https://example.com "Home"\n[example]: https://example.org\n[docs]: https://docs.example\n';

// Parses a markdown string into a ProseMirror document using the kdoc schema.
function docOf(markdown: string): ProseMirrorNode {
  return mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
}

// Serializes a ProseMirror document back to its markdown representation.
function markdownOf(doc: ProseMirrorNode): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(doc), frontMatter: null });
}

// Collects the ordered, unique link marks encountered while walking the document.
function linkMarks(doc: ProseMirrorNode): Mark[] {
  const marks: Mark[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) {
      const last = marks[marks.length - 1];
      if (mark.type.name === 'link' && (last === undefined || !last.eq(mark))) {
        marks.push(mark);
      } else {
        // Not the node being looked for: keep walking.
      }
    }
    return true;
  });
  return marks;
}

// Finds the [from, to) character range of the first occurrence of a substring in the document.
function rangeOf(doc: ProseMirrorNode, needle: string): { from: number; to: number } {
  const holder: { range: { from: number; to: number } | null } = { range: null };
  doc.descendants((node, pos) => {
    if (holder.range === null && node.isText && node.text !== undefined && node.text.includes(needle)) {
      const from = pos + node.text.indexOf(needle);
      holder.range = { from, to: from + needle.length };
    } else {
    }
    return holder.range === null;
  });
  if (holder.range === null) {
    throw new Error(`missing ${needle}`);
  } else {
    return holder.range;
  }
}

describe('reference links in the K-Doc conversion', () => {
  // A full, collapsed, and shortcut reference should each resolve to its definition's href/title/type.
  it('turns each kind of reference into a link to its definition', () => {
    const marks = linkMarks(docOf(SAMPLE));
    expect(marks.map((mark) => mark.attrs['href'])).toEqual(['https://example.com', 'https://example.org', 'https://docs.example']);
    expect(marks[0]?.attrs['title']).toBe('Home');
    expect(marks.map((mark) => referenceAttrsOf(mark.attrs['reference'])?.referenceType)).toEqual(['full', 'collapsed', 'shortcut']);
  });

  // Round-tripping the sample document must reproduce the original markdown exactly.
  it('writes references and definitions back unchanged', () => {
    expect(markdownOf(docOf(SAMPLE))).toBe(serializeDocument(parseMarkdown(SAMPLE)));
  });

  // Inline emphasis inside a shortcut reference text must survive the round trip.
  it('keeps formatting inside a shortcut reference', () => {
    const markdown = 'A [**Bold** name] here.\n\n[**bold** name]: https://b.example\n';
    expect(markdownOf(docOf(markdown))).toBe(serializeDocument(parseMarkdown(markdown)));
  });

  // Editing text in a shortcut reference should promote it to a full reference so the link target stays resolvable.
  it('writes an edited shortcut reference as a full reference', () => {
    const doc = docOf('Read [Docs] now.\n\n[docs]: https://docs.example\n');
    const { from } = rangeOf(doc, 'Docs');
    const state = EditorState.create({ doc });
    const next = state.apply(state.tr.insertText('X', from + 2)).doc;
    const markdown = markdownOf(next);
    expect(markdown).toContain('[DoXcs][Docs]');
    expect(markdown).toContain('[docs]: https://docs.example');
  });

  // Replacing the reference target with a new href should serialize as an inline link.
  it('makes an inline link when the target is replaced', () => {
    const doc = docOf('Read [Docs] now.\n\n[docs]: https://docs.example\n');
    const { from, to } = rangeOf(doc, 'Docs');
    const linkType = kdocSchema.marks['link'];
    if (linkType === undefined) {
      throw new Error('no link mark');
    } else {
      const state = EditorState.create({ doc });
      const tr = state.tr.removeMark(from, to, linkType).addMark(from, to, linkType.create({ href: 'https://new.example', title: null }));
      expect(markdownOf(state.apply(tr).doc)).toContain('[Docs](https://new.example)');
    }
  });

  // A stored definition block must render back to its original source line text.
  it('shows a definition as its source line', () => {
    const holder: { node: ProseMirrorNode | null } = { node: null };
    docOf(SAMPLE).descendants((node) => {
      if (holder.node === null && node.type.name === 'unknownBlock') {
        holder.node = node;
      } else {
        // Not the node being looked for: keep walking.
      }
      return holder.node === null;
    });
    if (holder.node === null) {
      throw new Error('no definition block');
    } else {
      const dom = DOMSerializer.fromSchema(kdocSchema).serializeNode(holder.node);
      expect(dom.textContent).toBe('[home]: https://example.com "Home"');
    }
  });
});
