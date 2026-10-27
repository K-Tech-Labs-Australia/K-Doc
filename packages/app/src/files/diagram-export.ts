/**
 * @file diagram-export.ts
 * @purpose Draws each Mermaid diagram in a document as a picture in a copy used for HTML export and printing.
 * @inputs KdocDocument containing parsed Markdown AST; DiagramRenderer rendering function.
 * @outputs DrawnDiagrams containing the exported KdocDocument copy and a failure count.
 * @functions
 *   - drawDiagrams: Renders Mermaid diagrams in a document and replaces diagram code nodes with image data URIs.
 * @dataflow KdocDocument.root -> mermaidSources -> DiagramRenderer renders SVG -> svgToDataUri -> applyDiagramImages -> exported KdocDocument.
 * @controlflow Extract diagram sources -> return original document if none found -> render diagrams sequentially in light theme -> build image data URI map -> clone AST with replaced diagram images -> return new document copy and failure count.
 * @version 1
 * @date 2026-10-28
 */

import { applyDiagramImages, mermaidSources, type KdocDocument } from '@k-doc/core';
import { svgToDataUri, type DiagramRenderer } from '@k-doc/editor';

export interface DrawnDiagrams {
  /** The document to export: the original when it has no diagrams, otherwise a copy with each drawn diagram as a picture. */
  readonly document: KdocDocument;
  /** How many diagrams could not be drawn; those keep their source as a code block. */
  readonly failed: number;
}

/**
 * Draws each Mermaid diagram in a document as an image for export and printing.
 *
 * @purpose Renders Mermaid diagrams in a document to SVG pictures in a copied AST for export.
 * @inputs
 *   - document: KdocDocument - The parsed Markdown document AST to extract and replace diagrams in.
 *   - render: DiagramRenderer - Asynchronous function rendering Mermaid source text to SVG.
 * @outputs Promise<DrawnDiagrams> - Resolves to an object holding the exported document and failed diagram count.
 * @dataflow document.root -> mermaidSources -> render(source, 'light') -> svgToDataUri -> applyDiagramImages -> output DrawnDiagrams.
 * @controlflow Extract Mermaid sources -> check if sources is empty (return original document if true) -> iterate over sources -> await render in light theme -> if ok add to images map else increment failed -> return copy of document with updated root AST.
 */
export async function drawDiagrams(
  document: KdocDocument,
  render: DiagramRenderer,
): Promise<DrawnDiagrams> {
  const sources = mermaidSources(document.root);

  // Check if the document contains any Mermaid diagrams to draw.
  if (sources.length === 0) {
    // Return early with the original document object untouched when no diagrams exist.
    return { document, failed: 0 };
  } else {
    // Document contains one or more diagrams; proceed to render each diagram into an image.
  }

  const images = new Map<string, string>();
  let failed = 0;

  // Exports are always drawn in the light theme, because a page is printed or read on white whatever the app's theme is.
  // Diagrams are drawn one after another; the renderer queues them anyway.
  for (const source of sources) {
    const result = await render(source, 'light');

    // Check if the diagram was rendered successfully into an SVG string.
    if (result.ok) {
      // Convert the rendered SVG string into a data URI and record it in the images map.
      images.set(source, svgToDataUri(result.svg));
    } else {
      // Increment failure count for diagrams that failed to render; they retain their source code blocks.
      failed += 1;
    }
  }

  // The text and front matter are carried over untouched; only the tree used for rendering changes.
  return {
    document: {
      ...document,
      root: applyDiagramImages(document.root, images),
    },
    failed,
  };
}
