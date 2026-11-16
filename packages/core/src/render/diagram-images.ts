/**
 * @file diagram-images.ts
 * @purpose Lists the Mermaid diagrams in a document and swaps them for pictures in an export copy.
 * @inputs Root mdast tree of a Markdown document; ReadonlyMap mapping Mermaid diagram source code strings to rendered image URLs.
 * @outputs Unique list of Mermaid diagram source strings in document order; cloned mdast Root with Mermaid code nodes replaced by Paragraph image nodes.
 * @functions
 *   - isMermaidCode: Type guard checking if an unknown AST node is a Mermaid code block.
 *   - mermaidSources: Extracts unique Mermaid diagram source strings from an mdast tree in document order.
 *   - applyDiagramImages: Returns a cloned mdast tree with Mermaid code blocks replaced by image paragraphs.
 * @dataflow mdast Root → mermaidSources extracts unique diagram code → external renderer maps sources to URLs → applyDiagramImages replaces code nodes with image paragraphs.
 * @controlflow Recursive depth-first tree traversal for extraction and replacement; immutable input tree preservation via structuredClone.
 * @version 1
 * @date 2026-10-28
 */

import type { Root, Image, Paragraph } from 'mdast';

export const DIAGRAM_ALT_TEXT = 'Mermaid diagram';

/**
 * Determines whether an unknown AST node is a Mermaid code block.
 *
 * @purpose Identifies Markdown code blocks explicitly tagged with language 'mermaid'.
 * @inputs node - Unknown AST node candidate to inspect.
 * @outputs True if the node is a code block with language 'mermaid' and string value, false otherwise.
 * @dataflow Examines candidate object properties → validates type, lang, and value fields.
 * @controlflow Validates object structure → validates 'code' literal type → validates 'mermaid' language → validates string content.
 */
export function isMermaidCode(
  node: unknown
): node is { type: 'code'; lang: string; value: string } {
  // Check if the node is a valid non-null object with code type, mermaid language, and string content.
  if (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'code' &&
    'lang' in node &&
    typeof node.lang === 'string' &&
    node.lang.trim().toLowerCase() === 'mermaid' &&
    'value' in node &&
    typeof node.value === 'string'
  ) {
    // Node matches all criteria for a Mermaid code block.
    return true;
  } else {
    // Node does not match Mermaid code block criteria.
    return false;
  }
}

/**
 * Type guard checking if an unknown node is a parent containing an array of child nodes.
 *
 * @purpose Identifies AST nodes that can have children to enable recursive tree traversal.
 * @inputs node - Unknown AST node candidate to inspect.
 * @outputs True if the candidate is a non-null object containing an array of children, false otherwise.
 * @dataflow Inspects object properties → validates presence and array type of children property.
 * @controlflow Checks object existence → checks children property existence → verifies array type.
 */
function hasChildren(node: unknown): node is { children: unknown[] } {
  // Check if candidate is a non-null object with an array of children.
  if (
    typeof node === 'object' &&
    node !== null &&
    'children' in node &&
    Array.isArray(node.children)
  ) {
    // Candidate node contains a valid children array.
    return true;
  } else {
    // Candidate node does not contain a children array.
    return false;
  }
}

/**
 * Type guard checking if an AST node contains defined position information.
 *
 * @purpose Identifies AST nodes that carry unist position metadata to preserve line/column tracking.
 * @inputs node - AST node candidate to inspect.
 * @outputs True if the node has a defined position property, false otherwise.
 * @dataflow Inspects node candidate → verifies presence and non-undefined state of position field.
 * @controlflow Checks position property existence → verifies position is not undefined.
 */
function hasPosition(node: object): node is { position: NonNullable<Paragraph['position']> } {
  // Check if the position property exists on the node and is not undefined.
  if ('position' in node && node.position !== undefined) {
    // Node has a defined position property.
    return true;
  } else {
    // Node lacks a defined position property.
    return false;
  }
}

/**
 * Extracts unique Mermaid diagram source strings from an mdast tree in document order.
 *
 * @purpose Gathers all distinct Mermaid diagram source bodies so they can be rendered in batch.
 * @inputs root - The root mdast tree of the Markdown document.
 * @outputs An array of distinct Mermaid source strings in document order (first occurrence kept).
 * @dataflow Walks mdast tree depth-first → identifies Mermaid code blocks → deduplicates sources into output list.
 * @controlflow Initializes seen set and output list → recursively walks tree nodes → returns accumulated sources.
 */
export function mermaidSources(root: Root): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  /**
   * Recursively walks an AST node to discover Mermaid code blocks.
   *
   * @purpose Traverses AST nodes in depth-first document order.
   * @inputs node - Unknown AST node to inspect.
   * @outputs Void.
   * @dataflow Traverses node → records Mermaid source strings or recurses into children.
   * @controlflow Checks if node is Mermaid code block → records if unseen → otherwise recurses into child nodes.
   */
  function walk(node: unknown): void {
    // Check if the current node is a Mermaid code block.
    if (isMermaidCode(node)) {
      // Check if this diagram source text has not been encountered yet.
      if (!seen.has(node.value)) {
        // Mark diagram source as seen and record in output list.
        seen.add(node.value);
        out.push(node.value);
      } else {
        // Duplicate diagram source already recorded; skip further processing.
      }
      return;
    } else {
      // Current node is not a Mermaid code block; inspect child nodes if present.
    }

    // Check if the node has child elements to traverse.
    if (hasChildren(node)) {
      // Iterate through child nodes in document order.
      for (const child of node.children) {
        walk(child);
      }
    } else {
      // Node has no children; leaf node traversal complete.
    }
  }

  walk(root);
  return out;
}

/**
 * Recursively replaces Mermaid code nodes with rendered diagram images throughout an AST subtree.
 *
 * @purpose Mutates the children of the given parent node in place, substituting Mermaid code blocks for image paragraphs.
 * @inputs
 *   - parent: Parent AST node containing a children array.
 *   - images: Readonly map of Mermaid source strings to rendered image URLs.
 * @outputs Void (mutates parent.children in place).
 * @dataflow Iterates children → identifies Mermaid code nodes → swaps matching nodes with Paragraph image nodes.
 * @controlflow Loops over children → checks if Mermaid code → checks if image URL exists → replaces or leaves source → recurses on nested parents.
 */
function replaceIn(parent: { children: unknown[] }, images: ReadonlyMap<string, string>): void {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];

    // Check if the current child node is a Mermaid code block.
    if (isMermaidCode(child)) {
      const url = images.get(child.value);

      // Check if a rendered image URL exists in the map for this diagram source.
      if (url !== undefined) {
        const image: Image = {
          type: 'image',
          url,
          alt: DIAGRAM_ALT_TEXT,
          title: null,
        };
        const paragraph: Paragraph = {
          type: 'paragraph',
          children: [image],
        };

        // Check if child has a position property to preserve on the replacement paragraph.
        if ('position' in child && child.position !== undefined && hasPosition(child)) {
          // Assign the code node position to the paragraph node.
          paragraph.position = child.position;
        } else {
          // Position metadata is not available on the code node.
        }

        parent.children[i] = paragraph;
      } else {
        // Diagram that failed to draw or lacks an image mapping retains its source code block.
      }
    } else if (hasChildren(child)) {
      // Child node is not a Mermaid code block but has children; recurse into child subtree.
      replaceIn(child, images);
    } else {
      // Child node is not a Mermaid code block and has no children; leave unchanged.
    }
  }
}

/**
 * Clones an mdast tree and replaces Mermaid code blocks with rendered image paragraphs.
 *
 * @purpose Swaps Mermaid code blocks in an export copy of the AST with rendered image paragraphs.
 * @inputs
 *   - root: The root mdast tree of the Markdown document.
 *   - images: Readonly map pairing Mermaid source code strings with rendered image data URLs.
 * @outputs A deep copy of the mdast tree with recognized Mermaid code blocks replaced by image paragraphs.
 * @dataflow Clones root AST via structuredClone → traverses AST clone → substitutes mapped Mermaid blocks → returns cloned root.
 * @controlflow Creates deep clone of root → invokes replaceIn traversal → returns modified clone without mutating input root.
 */
export function applyDiagramImages(
  root: Root,
  images: ReadonlyMap<string, string>
): Root {
  const copy = structuredClone(root);
  // Perform in-place diagram node replacement throughout the cloned AST.
  replaceIn(copy, images);
  return copy;
}
