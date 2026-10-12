/**
 * @file wiki-embed-nodes.ts
 * @purpose Converts one run of mdast text into ProseMirror nodes, drawing each wiki image embed in it as an image (FR-8.15).
 * @inputs value - the text node's value; schema - the K-Doc schema; marks - the marks in force at this point.
 * @outputs PMNode[] - text nodes for the plain stretches and image nodes for the embeds, in source order.
 * @functions
 *   - wikiEmbedNodes: Converts one run of mdast text into ProseMirror nodes, drawing each wiki image embed as an image (FR-8.15).
 * @dataflow value -> splitWikiEmbeds -> {text, embed} parts -> schema.text / imageType.create -> PMNode[].
 * @controlflow Split the run in source order; for each part either emit a text node or build an image marked as an embed (or fall back to its bracketed text when the schema has no image node); skip empty stretches because ProseMirror forbids them.
 * @version 1
 * @date 2026-09-18
 */

import { splitWikiEmbeds } from '@k-doc/core';
import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';

/**
 * @purpose Converts one run of mdast text into ProseMirror nodes, drawing each wiki image embed in it as an image (FR-8.15).
 * @inputs value - the text node's value; schema - the K-Doc schema; marks - the marks in force at this point.
 * @outputs PMNode[] - text nodes for the plain stretches and image nodes for the embeds, in source order.
 * @dataflow value -> splitWikiEmbeds -> {text, embed} parts -> schema.text / imageType.create -> PMNode[].
 * @controlflow An empty stretch is never made into a text node, because ProseMirror forbids an empty text node and schema.text('') throws; an image made here carries `embed: true`, which is what to-mdast reads to write it back as the exact text it came from rather than as a Markdown image.
 */
export function wikiEmbedNodes(value: string, schema: Schema, marks: readonly Mark[]): PMNode[] {
  const result: PMNode[] = [];
  // Look up the image node type once so every embed in this run shares one reference to it.
  const imageType = schema.nodes['image'];

  for (const part of splitWikiEmbeds(value)) {
    // Check which kind of part this is: a stretch of plain text, or an embed to draw.
    if (part.kind === 'text') {
      // A plain stretch of text becomes a text node. splitWikiEmbeds never hands back an empty one -
      // it pushes a stretch only when it holds something - so there is no guard for it here: a mutant
      // that removed one could not be killed, and schema.text would have thrown if the contract broke.
      result.push(schema.text(part.value, marks));
    } else {
      // Check whether this build of the schema has images at all.
      if (imageType === undefined) {
        // It has not, so the embed can only be the text it already was. This fallback loses the width hint:
        // a schema with no image node cannot hold one, so any `|width` is dropped here and written back bare.
        result.push(schema.text(`![[${part.embed.target}]]`, marks));
      } else {
        // An embed becomes an image marked as one, so to-mdast writes it back as `![[...]]` rather than
        // as a Markdown image. Its alt stays empty: the words in an embed are its file name.
        result.push(imageType.create({
          src: part.embed.target,
          alt: null,
          title: null,
          width: part.embed.width,
          embed: true,
        }, null, marks));
      }
    }
  }

  return result;
}
