/**
 * @file html.ts
 * @purpose Renders mdast syntax trees and KdocDocument instances into HTML fragments or standalone documents for export and print (FR-13.1).
 * @inputs mdast Root syntax trees, KdocDocument instances, and optional HtmlRenderOptions configuration.
 * @outputs HTML string fragments or complete standalone HTML documents containing inlined styles and escaped metadata.
 * @functions
 *   - renderFragment: Synchronously compiles an mdast Root tree into an HTML fragment string, with raw HTML passed through K-Doc's sanitiser.
 *   - escapeHtml: Escapes special HTML characters (&, <, >, ", ') into safe entity representations.
 *   - renderHtml: Renders a KdocDocument into an HTML fragment or a full standalone HTML document with inlined stylesheet.
 * @dataflow mdast Root / KdocDocument → unified processor (remarkRehype + rehypeRaw + rehypeSanitize + rehypeKdocHardening + rehypeStringify) → HTML fragment → (optional standalone document wrapping with inlined, style-escaped stylesheet and escaped title) → HTML output string.
 * @controlflow Parse/process AST synchronously with unified processor → check standalone flag → return sanitised fragment or interpolate into standalone HTML document template.
 * @version 7
 * @date 2026-10-07
 */

import { unified } from 'unified';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Root } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import { replaceImageSources } from './image-sources.js';
import { applyMediaEmbeds } from '../media/media-embeds.js';
import { withCommentNotes, type CommentNoteOptions } from './comment-notes.js';
import { applyImageWidths } from '../images/image-hints.js';
import { expandWikiEmbeds } from '../images/wiki-embeds.js';
import { applyPluginSyntax, type PluginSyntax } from '../plugins/plugin-syntax.js';
import { KDOC_SANITIZE_SCHEMA, escapeStyleContent, rehypeKdocHardening } from './sanitize.js';

/**
 * Options controlling the emission of HTML from a KdocDocument.
 */
export interface HtmlRenderOptions {
  /** Document title for the <title> element and any heading the template adds. */
  readonly title?: string;
  /** When true, wrap the fragment in a complete standalone HTML document with styles inlined. */
  readonly standalone?: boolean;
  /** CSS injected into the standalone document's <style>. Ignored for fragments. */
  readonly css?: string;
  /**
   * Replacement addresses for images, keyed by the address as written -- data URIs for a local file, so a
   * standalone export carries its pictures (FR-13.1). The document itself is never changed.
   */
  readonly imageSources?: ReadonlyMap<string, string>;
  /**
   * Comment threads to write into the exported document, and how (FR-10.7).
   *
   * Left out, nothing about comments reaches the export, which is the default and what a reader
   * publishing a document almost always wants: comments are working notes.
   */
  readonly comments?: CommentNoteOptions;
  /**
   * Syntax a plugin added, drawn into the copy that is exported or printed (FR-14.18).
   *
   * Left out, nothing a plugin registered reaches the export. The document itself is never changed either
   * way: a plugin's syntax is drawn, never written.
   */
  readonly pluginSyntax?: readonly PluginSyntax[];
}

/**
 * Default standalone export and print stylesheet (FR-13.1).
 *
 * Design constraints:
 * - Do NOT use CSS custom properties (variables) here: the exported file has to stand alone,
 *   and tokens defined in the app's stylesheet would resolve to nothing outside it.
 * - Measure uses `max-width: 42rem; margin: 0 auto;` on the body content: about 70 characters a line,
 *   which reads more easily than text set to the full window width.
 * - System font stacks provide readable default typography without web font requests.
 * - In print media (@media print), page margins are provided by the physical page box,
 *   so max-width centering is removed, links inherit color, and URLs are printed after link text.
 */
export const EXPORT_STYLESHEET: string = `
*, *::before, *::after {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #24292f;
  background-color: #ffffff;
  /* About 70 characters a line, easier to read than the full window width: */
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  word-wrap: break-word;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.25;
  color: #1f2328;
}

h1 {
  font-size: 2rem;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d0d7de;
}

h2 {
  font-size: 1.5rem;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d0d7de;
}

h3 {
  font-size: 1.25rem;
}

h4 {
  font-size: 1rem;
}

h5 {
  font-size: 0.875rem;
}

h6 {
  font-size: 0.85rem;
  color: #656d76;
}

p, blockquote, ul, ol, dl, table, pre, details {
  margin-top: 0;
  margin-bottom: 1rem;
}

ul, ol {
  padding-left: 2rem;
}

li + li {
  margin-top: 0.25rem;
}

blockquote {
  margin-left: 0;
  margin-right: 0;
  padding: 0 1rem;
  color: #656d76;
  border-left: 0.25rem solid #d0d7de;
}

hr {
  height: 0.25em;
  padding: 0;
  margin: 1.5rem 0;
  background-color: #d0d7de;
  border: 0;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 0;
  margin-bottom: 1rem;
  display: block;
  overflow-x: auto;
}

table th, table td {
  padding: 6px 13px;
  border: 1px solid #d0d7de;
}

table th {
  font-weight: 600;
  background-color: #f6f8fa;
}

table tr:nth-child(2n) {
  background-color: #f6f8fa;
}

code, pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 85%;
}

code {
  padding: 0.2em 0.4em;
  margin: 0;
  background-color: #afb8c133;
  border-radius: 6px;
}

pre {
  padding: 1rem;
  overflow: auto;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
}

pre code {
  padding: 0;
  margin: 0;
  background-color: transparent;
  border-radius: 0;
  font-size: 100%;
  word-break: normal;
  white-space: pre;
}

img {
  max-width: 100%;
  height: auto;
  box-sizing: content-box;
}

a {
  color: #0969da;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

@media print {
  /* In print media, remove max-width centring as the physical page box provides margins: */
  body {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  a {
    color: inherit;
    text-decoration: underline;
  }

  /* Print external link destinations after link text: a printed page has no clickable links,
     so a reader holding the paper has no way to reach a URL that is not written down. */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
  }

  /* A margin note is beside the text it is about rather than after it, so it must not be allowed to
     break across a page: half a comment at the foot of one page says less than none. */
  .kdoc-margin-note {
    break-inside: avoid;
  }
}

/* Comments written into the export as notes in the margin (FR-10.7). They float into the space beside
   the text column, which is why the body keeps a right margin wide enough to hold them. */
.kdoc-margin-note {
  /* Written as a span so it can sit inside a paragraph without ending it; the block behaviour a floated
     note needs comes from here rather than from the element. */
  display: block;
  float: right;
  clear: right;
  width: 12rem;
  margin: 0 -14rem 0.5rem 1rem;
  padding: 0.4rem 0.6rem;
  border-left: 2px solid #d0d7de;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #57606a;
}

/* Below the width that leaves room for a margin, the note sits in the text column instead of being
   pushed off the side of the page where it could not be read at all. */
@media (max-width: 70rem) {
  .kdoc-margin-note {
    float: none;
    width: auto;
    margin: 0.5rem 0;
  }
}
`;

/**
 * Compiles an mdast Root syntax tree into an HTML fragment string.
 *
 * @purpose Renders an mdast AST into an HTML fragment, passing raw HTML constructs through K-Doc's sanitiser.
 * @inputs root - The mdast Root syntax tree to compile.
 * @outputs string - The rendered HTML fragment.
 * @dataflow mdast Root → processor.runSync (remarkRehype + rehypeRaw + rehypeSanitize + rehypeKdocHardening) → hast syntax tree → processor.stringify (rehypeStringify) → HTML fragment string.
 * @controlflow Initialize unified processor with remarkRehype, rehypeRaw, rehypeSanitize, rehypeKdocHardening, and rehypeStringify → execute runSync on mdast root → stringify resulting hast tree → return HTML fragment string.
 */
export function renderFragment(root: Root): string {
  // Build unified processor converting Markdown AST (mdast) to HTML AST (hast) and stringifying to HTML.
  // The allowDangerousHtml + rehypeRaw pair is load-bearing:
  // K-Doc preserves raw HTML in the document verbatim (FR-4.4), so an export that stripped it
  // would silently produce a different document than the one the user wrote. `rehypeRaw` is
  // what re-parses those raw nodes into real elements.
  // The raw HTML is then sanitised (see sanitize.ts), so neither the app nor an exported file ever carries a
  // document's scripts or event handlers.
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // The output reaches live DOM in the app (Presentation, the Original view, Print) and exported files, so the raw
    // HTML is passed through K-Doc's allow-list: formatting survives, while scripts, event handlers, foreign frames
    // and javascript: links are removed before anything is stringified.
    .use(rehypeSanitize, KDOC_SANITIZE_SCHEMA)
    .use(rehypeKdocHardening)
    .use(rehypeStringify, { allowDangerousHtml: true });

  // A wiki image embed is plain text in the file, so it is expanded into an image here rather than in the
  // document the reader holds (FR-8.15). HTML is the one place a picture has to be a picture: the width
  // hint lands in the alt slot, where applyImageWidths below turns it into a width attribute.
  const drawn = expandWikiEmbeds(root);

  // Run the processor synchronously over the mdast root.
  // We use runSync because process expects text input and we already have a parsed AST,
  // and all registered transformers execute synchronously.
  // The width hint in an image's alt (`![alt|600](x)`, FR-8.15) becomes a width attribute, so it never shows as alt text.
  const hastNode = processor.runSync(applyImageWidths(drawn));

  // Stringify the transformed hast syntax tree to an HTML fragment string.
  return processor.stringify(hastNode);
}

/**
 * Escapes special HTML characters in a string for safe insertion into HTML markup.
 *
 * @purpose Escapes &, <, >, ", and ' in that exact order to generate safe HTML text content.
 * @inputs value - The raw text string to escape.
 * @outputs string - The HTML-escaped string.
 * @dataflow Raw string → sequential replace (& → &amp;, < → &lt;, > → &gt;, " → &quot;, ' → &#39;) → escaped string.
 * @controlflow Perform sequential character replacements in strict order; & must precede all others to prevent double-escaping entity ampersands.
 */
export function escapeHtml(value: string): string {
  // Ampersand '&' must be replaced first: replacing it after any other characters
  // would cause the ampersands in their generated entities (such as &lt; or &quot;)
  // to get double-escaped into &amp;lt; or &amp;quot;.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a KdocDocument into an HTML fragment or a complete standalone HTML document.
 *
 * @purpose Converts a KdocDocument AST into an HTML fragment or a full styled standalone HTML document.
 * @inputs document - The KdocDocument containing the mdast Root syntax tree to render.
 * @inputs options - Optional HtmlRenderOptions controlling standalone document wrapping, title, and CSS.
 * @outputs string - The rendered HTML fragment or full HTML document string.
 * @dataflow document.root → renderFragment → fragment string → (if standalone: title escaping + CSS resolution + template assembly) → output HTML string.
 * @controlflow Render AST fragment → check options.standalone: if not true return fragment; else resolve title with 'Untitled' fallback, escape title, resolve stylesheet (options.css ?? EXPORT_STYLESHEET), assemble HTML document template, and return result.
 */
export function renderHtml(
  document: KdocDocument,
  options?: HtmlRenderOptions
): string {
  // A wiki image embed becomes an image before addresses are replaced, so a standalone export can embed
  // the picture it names the same way it embeds any other (FR-8.15). renderFragment expands them too, for
  // a caller that never passes imageSources; doing it twice costs a clone and changes nothing.
  const expanded = expandWikiEmbeds(document.root);
  // Rewrite image addresses in a copy of the tree when replacements were given; with none, the tree is used as is.
  const withImages = options?.imageSources === undefined ? expanded : replaceImageSources(expanded, options.imageSources);
  // Comments live beside the file, so they only ever reach an export because the caller asked for them
  // here; the tree they are written into is a copy, and the document on disk gains nothing.
  const root = options?.comments === undefined ? withImages : withCommentNotes(withImages, options.comments);

  // A video or audio reference becomes a player in what leaves K-Doc (FR-8.17). The annotation is written into a
  // copy: the tree the reader is editing must not gain rendering data because something was exported from it.
  const withMedia = structuredClone(root);
  applyMediaEmbeds(withMedia);
  // A plugin's own syntax is drawn into the same copy, for the same reason: what a plugin recognises in a
  // document is a way of showing it, not a change to it (FR-14.18).
  applyPluginSyntax(withMedia, options?.pluginSyntax ?? []);

  const fragment = renderFragment(withMedia);

  // Check whether the caller requested a standalone HTML document.
  if (!options?.standalone) {
    // When standalone is not true, return the fragment unchanged.
    // A fragment is what you paste into an existing page or feed to a print window that already has styles.
    return fragment;
  } else {
    // When standalone is true, return a complete document with styles inlined.
    const trimmedTitle = options.title?.trim();
    let titleText: string;

    // Check if a non-empty document title was supplied after trimming whitespace.
    if (trimmedTitle !== undefined && trimmedTitle.length > 0) {
      // Use the trimmed title supplied in options.
      titleText = trimmedTitle;
    } else {
      // Default the title to 'Untitled' when not supplied or empty after trimming.
      titleText = 'Untitled';
    }

    const escapedTitle = escapeHtml(titleText);

    let stylesheet: string;
    // Check if custom CSS was provided in options.
    if (options.css !== undefined) {
      // Use caller-supplied custom CSS in the <style> block.
      stylesheet = options.css;
    } else {
      // Fall back to the default standalone print and export stylesheet.
      stylesheet = EXPORT_STYLESHEET;
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<style>
${escapeStyleContent(stylesheet)}
</style>
</head>
<body>
${fragment}
</body>
</html>
`;
  }
}
