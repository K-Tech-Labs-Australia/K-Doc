/**
 * @file image-hints.ts
 * @purpose Reads and writes the image width hint K-Doc keeps in the alt slot, `![alt|600](img.png)` (FR-8.15, OQ-5), and applies it to HTML export so the hint never shows as alt text.
 * @inputs alt strings, widths, mdast trees.
 * @outputs split alt parts, joined alt strings, a cloned tree with widths as HTML attributes.
 * @functions
 *   - splitImageAlt: Splits an alt string into its visible text and optional width hint.
 *   - joinImageAlt: Reattaches a width hint to an alt string.
 *   - withWidths: Recursively applies width hints from alt slots onto mdast node data.hProperties.
 *   - applyImageWidths: Clones a Root tree and applies all image width hints to it.
 * @dataflow alt -> splitImageAlt -> {alt, width}; {alt, width} -> joinImageAlt -> alt; Root -> applyImageWidths -> cloned Root with data.hProperties.width.
 * @controlflow pure functions.
 * @version 1
 * @date 2026-09-16
 */

import type { Image, Nodes, Root } from 'mdast';

// Maximum image width in pixels allowed for a width hint; larger values are ignored and left as alt text.
export const MAX_IMAGE_WIDTH = 10000;

export interface ImageAltParts {
  readonly alt: string | null;
  readonly width: number | null;
}

// WIDTH_HINT — a width is 1 to 5 digits with no leading zero after the `|`, so a hint always writes back exactly as it was read.
const WIDTH_HINT = /^([\s\S]*)\|([1-9]\d{0,4})$/;

/**
 * @purpose Splits an alt string into its visible text and optional width hint, using a trailing `|<digits>` marker.
 * @inputs alt - The raw alt string from an mdast image node, which may be null or undefined.
 * @returns ImageAltParts with the cleaned alt text (null when empty) and parsed width in pixels (null when absent).
 * @dataflow Raw alt string → regex match → {alt, width} parts.
 * @controlflow Returns early on null/undefined; returns raw alt when no hint matches; drops hint when width exceeds MAX_IMAGE_WIDTH; otherwise extracts text and numeric width.
 */
export function splitImageAlt(alt: string | null | undefined): ImageAltParts {
  // When alt is missing entirely there is no hint to parse, so return empty parts.
  if (alt === null || alt === undefined) {
    return { alt: null, width: null };
  } else {
    // An alt string is present; fall through to parse the trailing width hint below.
  }

  const match = WIDTH_HINT.exec(alt);
  // When there is no trailing `|<digits>` marker keep the whole string as alt with no width.
  if (match === null) {
    return { alt, width: null };
  } else {
    // A hint matched; fall through to validate and extract it below.
  }

  const width = Number(match[2]);
  // When the parsed width exceeds MAX_IMAGE_WIDTH treat the whole string as alt with no valid hint.
  if (width > MAX_IMAGE_WIDTH) {
    return { alt, width: null };
  } else {
    // The width is within range; fall through to extract the text and numeric width below.
  }

  const text = match[1] ?? '';
  // When the text before the hint is empty treat it as no alt; otherwise use the extracted text.
  return { alt: text === '' ? null : text, width };
}

/**
 * @purpose Reattaches a width hint to an alt string so it round-trips through the alt slot unchanged.
 * @inputs alt - The visible alt text, possibly null; width - The parsed width in pixels, or null when no hint exists.
 * @returns The joined alt string, or the original alt when width is null.
 * @dataflow {alt, width} → template literal `${alt}|${width}` → joined string.
 * @controlflow Returns alt untouched when width is null; otherwise appends `|<width>`.
 */
export function joinImageAlt(alt: string | null, width: number | null): string | null {
  // When there is no width hint leave the alt untouched so an image that was never resized keeps its original alt.
  if (width === null) {
    return alt;
  } else {
    // A width exists; append the `|<width>` marker so the hint round-trips exactly as it was read.
    return `${alt ?? ''}|${width}`;
  }
}

/**
 * @purpose Walks an mdast node tree and transfers each image's width hint from its alt slot onto data.hProperties.
 * @inputs node - The current mdast node being visited.
 * @returns void; mutates the node in place by writing data.hProperties.width and cleaning image.alt.
 * @dataflow node.alt → splitImageAlt → {alt, width} → cleaned image.alt and image.data.hProperties.width.
 * @controlflow Handles image nodes by rewriting alt and hProperties; recurses into any node that has children.
 */
function withWidths(node: Nodes): void {
  // When the node is an image rewrite its alt and attach the width to data.hProperties so mdast-util-to-hast copies it onto the element as an HTML attribute, leaving the alt clean.
  if (node.type === 'image') {
    const image = node as Image;
    const parts = splitImageAlt(image.alt);
    // Only rewrite when a valid width hint was parsed.
    if (parts.width !== null) {
      image.alt = parts.alt ?? '';
      const data: Record<string, unknown> = { ...(image.data ?? {}) };
      const existing = data['hProperties'];
      // When existing hProperties is a non-null object spread its fields; otherwise start from an empty object so width merges cleanly.
      data['hProperties'] = { ...(typeof existing === 'object' && existing !== null ? existing : {}), width: parts.width };
      image.data = data as Image['data'];
    } else {
      // No valid hint; leave the image node's alt and data untouched.
    }
  } else {
    // Not an image; skip image-specific handling since only images carry a width hint.
  }

  // When the node has children recurse into each child to apply hints deeper in the tree.
  if ('children' in node) {
    for (const child of node.children) {
      withWidths(child);
    }
  } else {
    // This is a leaf node with no subtree; stop recursing here.
  }
}

/**
 * @purpose Produces a copy of an mdast Root tree with all image width hints applied to data.hProperties for HTML export.
 * @inputs root - The original mdast Root tree owned by the editor.
 * @returns A deep-cloned Root with widths attached, leaving the caller's tree unchanged.
 * @dataflow Root → structuredClone → withWidths traversal → cloned Root.
 * @controlflow Clones the tree once, then applies hints to the clone only so the editor's held tree is not mutated.
 */
export function applyImageWidths(root: Root): Root {
  const copy = structuredClone(root);
  withWidths(copy);
  return copy;
}
