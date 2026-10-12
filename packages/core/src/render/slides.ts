/**
 * @file slides.ts
 * @purpose Splits a document into presentation slides (FR-5.9): top-level thematic breaks (---) separate slides, front matter is not shown, and empty slides are dropped.
 * @inputs A parsed KdocDocument whose root children are traversed.
 * @outputs One mdast Root per slide; front matter excluded and empty slides removed.
 * @functions
 *   - splitSlides: Walks top-level nodes, breaking on thematic breaks into per-slide roots.
 * @dataflow root children -> groups between thematic breaks -> roots.
 * @controlflow one pass over the top-level nodes.
 * @version 1
 * @date 2026-09-16
 */

import type { Root, RootContent } from 'mdast';
import type { KdocDocument } from '../ast/types.js';

/**
 * Split a parsed document into one mdast root per slide.
 * @purpose Groups top-level nodes between thematic breaks; drops front matter and empty slides.
 * @inputs document - Parsed KdocDocument whose `root.children` are the top-level nodes to partition.
 * @outputs readonly Root[] - One mdast Root per non-empty slide, in document order.
 * @dataflow root children -> groups between thematic breaks -> roots.
 * @controlflow one pass over the top-level nodes; a thematicBreak ends the current group and starts a new empty one.
 */
export function splitSlides(document: KdocDocument): readonly Root[] {
  const slides: Root[] = [];
  let current: RootContent[] = [];
  const finishSlide = (): void => {
    // A slide with content is emitted as a root; an empty slide (two breaks in a row, or a break at the very start/end) is dropped rather than shown blank.
    if (current.length > 0) {
      slides.push({ type: 'root', children: current });
    } else {
      // Empty slide: nothing to emit, leave `slides` untouched.
    }
    // Reset so the next slide starts empty.
    current = [];
  };
  // Only top-level breaks split slides; a break nested inside a quote or list stays part of its slide.
  for (const node of document.root.children) {
    // A top-level thematic break ends the current slide and begins a new one.
    if (node.type === 'thematicBreak') {
      finishSlide();
    } else if (node.type === 'yaml' || node.type === 'toml') {
      // Front matter is metadata, not content: skip it so it never appears on a slide.
    } else {
      // Every other top-level node belongs to the slide currently being built.
      current.push(node);
    }
  }
  // After the loop, finish the final slide (handles trailing content and a trailing break).
  finishSlide();
  return slides;
}
