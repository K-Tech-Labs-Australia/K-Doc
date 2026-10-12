/**
 * @file block-alignment.spec.ts
 * @purpose Tests FR-8.11 block alignment: folding `<div align="...">` wrappers into node data on parse, reading/writing the recorded alignment via applyAlignment/alignmentOf, and re-emitting aligned blocks through serializeDocument.
 * @inputs Markdown source strings; mdast Root trees produced by parseMarkdown; paragraph/heading literals for direct mutation tests.
 * @outputs Assertions over tree shape (children length / types), alignmentOf results, JSON.stringify of node.data, and round-trip equality after serializeDocument.
 * @functions
 *   - blockAt: Read a child block expecting a paragraph or heading, throwing instead of returning undefined so the test fails loudly on wrong shapes.
 * @dataflow Source text → parseMarkdown folds wrappers via foldAlignment into data.kdocAlign/hProperties; tests read alignmentOf and mutate with applyAlignment then serializeDocument to verify emission.
 * @controlflow Each it parses (or builds) a tree, asserts its folded shape or node.data, and for write cases re-serializes to confirm the wrapper is emitted or dropped as expected.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument, serializeIncremental } from '../src/index.js';
import { alignmentOf, applyAlignment, foldAlignment } from '../src/align/block-alignment.js';
import type { Heading, Paragraph, Root } from 'mdast';

// Read child `index` of root expecting a paragraph or heading; throw rather than return undefined so wrong shapes fail the test loudly.
function blockAt(root: Root, index: number): Paragraph | Heading {
  // Fetch the raw child which may be undefined past the end under strict indexing.
  const node = root.children[index];

  // A missing child means the expected block is absent; surface it as a hard failure instead of propagating undefined.
  if (node === undefined) { throw new Error(`no block at ${index}`); }

  // Only paragraph and heading blocks are alignment-capable; reject any other node type with its actual kind.
  if (node.type !== 'paragraph' && node.type !== 'heading') { throw new Error(`block ${index} is a ${node.type}`); }

  // The child passed both guards: it exists and is an aligned-capable block, so return the narrowed value.
  return node;
}

describe('an aligned block read from a file', () => {
  // Guards that a single-block wrapper folds into one paragraph carrying its alignment.
  it('carries the alignment its wrapper named', () => {
    const doc = parseMarkdown('<div align="center">\n\nCentred.\n\n</div>\n');

    // The open and close html nodes are folded away, leaving exactly one block in the tree.
    expect(doc.root.children.length).toBe(1);

    // The surviving node is the inner paragraph that the wrapper surrounded.
    const block = blockAt(doc.root, 0);
    expect(block.type).toBe('paragraph');

    // Its recorded alignment must match the value named in the div's align attribute.
    expect(alignmentOf(block)).toBe('center');
  });

  // Guards that a heading inside an alignment wrapper folds and keeps its node type with its alignment.
  it('can be a heading', () => {
    const doc = parseMarkdown('<div align="right">\n\n# Title\n\n</div>\n');

    // Only the folded heading survives; both wrapper nodes are consumed by folding.
    expect(doc.root.children.length).toBe(1);

    // The block is a heading, not collapsed into a paragraph or raw html.
    const block = blockAt(doc.root, 0);
    expect(block.type).toBe('heading');

    // Its alignment matches the wrapper's align attribute of 'right'.
    expect(alignmentOf(block)).toBe('right');
  });

  // Guards that inline markdown inside an aligned block is preserved rather than flattened to a single text node.
  it('is still ordinary markdown inside', () => {
    const doc = parseMarkdown('<div align="center">\n\nSome **bold**.\n\n</div>\n');

    // The bold survives as its own strong child, so the paragraph has more than one inline child node.
    expect(blockAt(doc.root, 0).children.length).toBeGreaterThan(1);
  });

  // Guards that a wrapper holding two blocks is left untouched and records no alignment on any inner paragraph.
  it('is left alone when the wrapper holds more than one block', () => {
    const doc = parseMarkdown('<div align="center">\n\nOne.\n\nTwo.\n\n</div>\n');

    // The four nodes (open, two paragraphs, close) all survive because folding requires exactly one inner block.
    expect(doc.root.children.length).toBe(4);

    // Locate the first paragraph so we can assert it carries no folded alignment.
    const firstParagraph = doc.root.children.find((child): child is Paragraph => child.type === 'paragraph');

    // A matching paragraph must exist to make the null-alignment assertion meaningful.
    expect(firstParagraph).toBeDefined();

    // No inner block of an un-folded multi-block wrapper may carry a recorded alignment.
    if (firstParagraph !== undefined) {
      expect(alignmentOf(firstParagraph)).toBe(null);
    }
  });

  // Guards that an unrecognised alignment value leaves the wrapper as raw html with nothing folded in.
  it('is left alone when the wrapper names something else', () => {
    const doc = parseMarkdown('<div align="justify">\n\nText.\n\n</div>\n');

    // The opener, paragraph and close survive verbatim because 'justify' is not a foldable alignment.
    expect(doc.root.children.length).toBe(3);

    // The middle node is the plain paragraph sitting between the two html wrapper nodes.
    const middle = blockAt(doc.root, 1);
    expect(middle.type).toBe('paragraph');

    // It must carry no recorded alignment since folding never occurred for an unknown value.
    expect(alignmentOf(middle)).toBe(null);
  });

  // Guards that a wrapper without its closing tag is never folded and both nodes survive as raw html plus block.
  it('is left alone when nothing closes the wrapper', () => {
    const doc = parseMarkdown('<div align="center">\n\nText.\n');

    // With no close node there is no complete open/inner/close triple, so neither node is folded away.
    expect(doc.root.children.length).toBe(2);
  });

  // Guards that only a paragraph or heading is folded; a code block inside a wrapper is left as written.
  it('is left alone when the block inside cannot be aligned', () => {
    const doc = parseMarkdown('<div align="center">\n\n```\ncode\n```\n\n</div>\n');

    // The opener, the code block and the close all survive, because alignment does not apply to code.
    expect(doc.root.children.length).toBe(3);
  });

  // Guards that the close must be `</div>` and not merely any HTML that happens to follow.
  it('is left alone when the html after it is not a close', () => {
    // A block of HTML that is not `</div>`: inline HTML sits inside the paragraph and never reaches the check.
    const doc = parseMarkdown('<div align="center">\n\nText.\n\n<hr />\n');

    // Three nodes: the opener, the paragraph, and the html that is not the wrapper's close.
    expect(doc.root.children.length).toBe(3);
  });
});

describe('an aligned block written back', () => {
  // Guards that an aligned block round-trips through parse and serialize back to its exact source wrapper string.
  it('comes out as the wrapper it came from', () => {
    const text = '<div align="center">\n\nCentred.\n\n</div>\n';

    // Parse then re-serialize must reproduce the original markup byte for byte with no drift.
    expect(serializeDocument(parseMarkdown(text))).toBe(text);
  });

  // Guards that a heading's alignment survives a parse/serialize round-trip unchanged.
  it('keeps a heading aligned', () => {
    const text = '<div align="left">\n\n## Heading\n\n</div>\n';

    // Round-tripping the heading wrapper must reproduce it exactly, including its 'left' alignment.
    expect(serializeDocument(parseMarkdown(text))).toBe(text);
  });

  // Guards that an alignment applied programmatically in the editor is emitted as a source wrapper on serialize.
  it('is written for a block aligned in the editor', () => {
    const doc = parseMarkdown('Plain.\n');

    // Record 'right' directly on the paragraph, simulating an editor-driven alignment change with no source wrapper.
    applyAlignment(blockAt(doc.root, 0), 'right');

    // Serialization must wrap the plain block back into its `<div align="right">` source form with blank-line padding.
    expect(serializeDocument(doc)).toBe('<div align="right">\n\nPlain.\n\n</div>\n');
  });

  // Guards that clearing an alignment returns a block to plain markdown with no wrapper emitted on serialize.
  it('goes back to plain markdown when the alignment is cleared', () => {
    const doc = parseMarkdown('<div align="center">\n\nCentred.\n\n</div>\n');

    // Clearing the recorded alignment must remove all intent to wrap this block during serialization.
    applyAlignment(blockAt(doc.root, 0), null);

    // Serialization drops the wrapper and emits just the plain paragraph text with its trailing newline.
    expect(serializeDocument(doc)).toBe('Centred.\n');
  });

  // Guards that serializing unaligned blocks leaves them byte-for-byte unchanged so the handler never touches them.
  it('leaves every other block exactly as it was', () => {
    const text = 'One.\n\nTwo.\n';

    // Two plain paragraphs must serialize back to the identical source string with no wrappers injected.
    expect(serializeDocument(parseMarkdown(text))).toBe(text);
  });
});

describe('the alignment on a node', () => {
  // Guards that applyAlignment records exactly the alignment passed in, readable back via alignmentOf.
  it('is the one that was applied', () => {
    const node = { type: 'paragraph', children: [] } as Paragraph;

    // Store 'center' directly on a bare paragraph literal with no source wrapper present.
    applyAlignment(node, 'center');

    // The recorded alignment must be exactly what was applied, not null or some other value.
    expect(alignmentOf(node)).toBe('center');
  });

  // Guards that the alignment is also written into hProperties where the hast renderer reads it for styling.
  it('is also written where the renderer reads it', () => {
    const node = { type: 'paragraph', children: [] } as Paragraph;

    // Apply 'center' so both kdocAlign and the rendering-facing hProperties get populated on the node data.
    applyAlignment(node, 'center');

    // The serialized node.data must expose the text-align style that mdast-util-to-hast consumes to centre the block.
    expect(JSON.stringify(node.data)).toContain('text-align: center');
  });

  // Guards that a bare paragraph literal with no alignment applied reports null from alignmentOf.
  it('is nothing when it was never applied', () => {
    const node = { type: 'paragraph', children: [] } as Paragraph;

    // No applyAlignment call has touched this node, so its data carries no kdocAlign key at all.
    expect(alignmentOf(node)).toBe(null);
  });

  // Guards that clearing an alignment removes both the stored value and any text-align style from node.data.
  it('is nothing after it is cleared', () => {
    const node = { type: 'paragraph', children: [] } as Paragraph;

    // First store 'left' so there is a real alignment to clear on subsequent steps of this test.
    applyAlignment(node, 'left');

    // Then remove the alignment entirely via the null-clearing path of applyAlignment.
    applyAlignment(node, null);

    // After clearing, no alignment should be readable from the node any longer.
    expect(alignmentOf(node)).toBe(null);

    // The hProperties text-align style must also have been removed so nothing lingers in the serialized data.
    expect(JSON.stringify(node.data ?? {})).not.toContain('text-align');
  });

  // Guards that an unrecognised kdocAlign value is rejected by alignmentOf and treated as no alignment at all.
  it('ignores a value that is not an alignment', () => {
    const node = { type: 'paragraph', children: [], data: { kdocAlign: 'justify' } } as Paragraph;

    // Inject a malformed 'justify' value directly into the alignment slot to simulate corrupt or foreign data.
    expect(alignmentOf(node)).toBe(null);
  });

  // Guards that folding a tree with no wrappers leaves its single child untouched and does not mutate the shape.
  it('is unchanged by folding a tree with no wrappers', () => {
    const root = { type: 'root', children: [{ type: 'paragraph', children: [] }] } as Root;

    // Run foldAlignment over a tree that contains only one paragraph and no div wrapper nodes to consume.
    foldAlignment(root);

    // With nothing to fold the single child must remain, so the tree keeps exactly one block.
    expect(root.children.length).toBe(1);
  });
});

describe('an aligned block rewritten in place', () => {
  // Guards the bug this test was written for: clearing an alignment must take the wrapper out of the file, not leave the `<div>` lines behind the block it used to hold.
  it('loses its wrapper when the alignment is cleared', () => {
    const original = parseMarkdown('Before.\n\n<div align="center">\n\nCentred.\n\n</div>\n\nAfter.\n');
    const updated = structuredClone(original.root);
    const block = blockAt(updated, 1);
    applyAlignment(block, null);

    // Only the block that changed is rewritten, and what it is rewritten over includes the wrapper it carried.
    expect(serializeIncremental(original, updated).text).toBe('Before.\n\nCentred.\n\nAfter.\n');
  });

  // Guards that an untouched aligned block costs nothing: the fast path returns the file as it was.
  it('is left byte for byte alone when nothing changed', () => {
    const text = 'Before.\n\n<div align="center">\n\nCentred.\n\n</div>\n\nAfter.\n';
    const original = parseMarkdown(text);
    const result = serializeIncremental(original, structuredClone(original.root));
    expect(result.text).toBe(text);
    expect(result.replacedRanges).toEqual([]);
  });

  // Guards that changing the alignment rewrites the wrapper rather than nesting a second one.
  it('swaps one wrapper for another when the alignment changes', () => {
    const original = parseMarkdown('<div align="center">\n\nCentred.\n\n</div>\n');
    const updated = structuredClone(original.root);
    applyAlignment(blockAt(updated, 0), 'right');

    expect(serializeIncremental(original, updated).text).toBe('<div align="right">\n\nCentred.\n\n</div>\n');
  });
});
