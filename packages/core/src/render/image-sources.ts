/**
 * @file image-sources.ts
 * @purpose Rewrites image URLs in a copy of an mdast Root tree so local images can be embedded as data URIs during HTML export (FR-13.1) without mutating the original document AST.
 * @inputs root - The mdast Root syntax tree to transform; sources - A map from original image URL strings to their replacement URLs (e.g. data URIs).
 * @outputs Root - A deep copy of the input tree with matching image URLs rewritten, or the original tree unchanged when no replacements are configured.
 * @functions
 *   - replaceImageSources: Produces a copy of the mdast tree with local image URLs replaced by their mapped values.
 *   - visit: Recursively walks a node and rewrites any image URL found in the sources map.
 * @dataflow root + sources → structuredClone(root) → recursive visit() rewriting image nodes → transformed Root copy (original left untouched).
 * @controlflow Check sources.size: if 0 return root unchanged; else deep-clone, run visit over the clone starting at the root node, and return the modified copy.
 * @version 1
 * @date 2026-09-14
 */

import type { Root } from 'mdast';

/** Structural shape shared by every node visited during the rewrite: a node kind, an optional URL (present on image nodes), and optional children for container nodes. */
type VisitNode = { type: string; url?: unknown; children?: unknown };

/**
 * Rewrites image URLs in a copy of the mdast tree so local images can be embedded as data URIs during HTML export (FR-13.1).
 *
 * @purpose Returns a deep copy of the input tree with any image URL present in `sources` replaced by its mapped value; the original tree is never mutated.
 * @inputs root - The mdast Root syntax tree to transform.
 * @inputs sources - A map from original image URL strings to their replacement URLs (e.g. data URIs).
 * @outputs Root - A deep copy of `root` with matching image URLs rewritten, or the same `root` object when `sources` is empty.
 * @dataflow root → (when sources non-empty) structuredClone(root) → visit() rewrites image nodes in the clone → transformed Root copy returned; original tree untouched throughout.
 * @controlflow If sources.size === 0 return root unchanged without copying; otherwise deep-clone with structuredClone, run visit over the clone starting at the root node, and return the modified copy.
 */
export function replaceImageSources(
  root: Root,
  sources: ReadonlyMap<string, string>
): Root {
  // Nothing to replace when no replacements are configured: return the original tree object as-is, so no copy is made.
  if (sources.size === 0) {
    return root;
  } else {
    // Deep-clone the tree so image URLs can be rewritten in place without mutating the caller's document AST.
    const copy = structuredClone(root);

    // Walk the cloned tree, rewriting any image node whose URL is present in `sources`.
    visit(copy as unknown as VisitNode, sources);

    return copy;
  }
}

/**
 * Recursively walks a single node and rewrites its image URL when it maps to a replacement.
 *
 * @purpose Rewrites the URL of an image node found in `sources` and recurses into container nodes so every descendant is visited.
 * @inputs node - The current mdast node (structural shape) being inspected for an image URL or children.
 * @inputs sources - The map from original image URL to its replacement.
 * @outputs void - Mutates `node.url` in place when a replacement exists; no value is returned.
 * @dataflow node → (if image and url is string) lookup sources.get(url) → assign replacement to node.url → recurse into each child node of the same structural shape.
 * @controlflow Check if node is an image with a string URL: if so, look up and apply a replacement when defined; then check for children: if present visit each child, otherwise stop descending this branch.
 */
function visit(node: VisitNode, sources: ReadonlyMap<string, string>): void {
  // Rewrite the URL only for image nodes whose URL is a string and has a configured replacement.
  if (node.type === 'image' && typeof node.url === 'string') {
    const replacement = sources.get(node.url);

    // Apply the replacement when one exists in the map; skip otherwise to leave external URLs untouched.
    if (replacement !== undefined) {
      (node as { url: string }).url = replacement;
    } else {
      // No mapping for this URL: leave the original image URL unchanged.
    }
  }

  // Descend into child nodes when this node is a container that has children.
  if (Array.isArray(node.children)) {
    for (const child of node.children as VisitNode[]) {
      visit(child, sources);
    }
  } else {
    // This node has no children: stop descending here.
  }
}
