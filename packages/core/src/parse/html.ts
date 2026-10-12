/**
 * @file html.ts
 * @purpose Converts pasted or imported HTML markup into K-Doc mdast syntax trees and canonical Markdown text.
 *   Why this exists:
 *   K-Doc's ProseMirror schema deliberately has no parseDOM. Rather than teaching the schema to parse HTML — which
 *   would mean a second, parallel definition of every node and mark, kept in sync by hand — pasted HTML is routed
 *   through the same mdast pipeline the rest of the editor already speaks. The conversion is HTML -> hast -> mdast,
 *   and from there mdastToProseMirror is the path every other document already takes.
 *   The consequence is worth stating: anything the HTML expresses that Markdown cannot is dropped at this boundary,
 *   deliberately. That is the correct behaviour for a Markdown editor — content that cannot be written as Markdown
 *   has no business entering the document, because the very next save would lose it anyway.
 *   Known limitation:
 *   rehype-remark handles standard CommonMark and GFM constructs such as tables and strikethrough. However, K-Doc's
 *   own Tier-4 inline constructs (highlight ==text==, subscript ~text~, and superscript ^text^) have no HTML mapping
 *   here, so pasted <mark>, <sub>, or <sup> tags arrive as plain text. This is a known limitation rather than an
 *   unexpected omission.
 * @inputs Raw HTML source text string and optional HtmlImportOptions configuration.
 * @outputs Converted mdast Root syntax tree or canonical Markdown string.
 * @functions
 *   - htmlToMdast: Parses an HTML string into an mdast Root tree via rehype-parse and rehype-remark.
 *   - htmlToMarkdown: Converts an HTML string into formatted Markdown text via htmlToMdast and serializeDocument.
 * @dataflow HTML string -> whitespace guard -> unified processor (rehypeParse + rehypeRemark) -> hast tree -> mdast Root -> KdocDocument -> serializeDocument -> Markdown string.
 * @controlflow Guard empty/whitespace input -> resolve fragment option (default true) -> configure unified processor -> parse HTML to hast -> runSync to mdast -> return Root (or wrap in KdocDocument and serialize).
 * @version 1
 * @date 2026-09-06
 */

import type { Root } from 'mdast';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import type { KdocDocument } from '../ast/types.js';
import { serializeDocument } from '../serialize/serializer.js';

/**
 * Options controlling the parsing and conversion of HTML into mdast.
 */
export interface HtmlImportOptions {
  /** Treat the HTML as a document fragment rather than a whole page. Default true. */
  readonly fragment?: boolean;
}

/**
 * Converts an HTML string into an mdast Root syntax tree.
 *
 * @purpose Converts pasted or imported HTML markup into an mdast Root tree for consumption by K-Doc.
 * @inputs html - Raw HTML source string to convert.
 * @inputs options - Optional HtmlImportOptions controlling fragment mode.
 * @outputs Root - The converted mdast Root syntax tree.
 * @dataflow HTML string -> whitespace guard -> unified processor (rehypeParse + rehypeRemark) -> hast tree -> mdast Root.
 * @controlflow Check for empty or whitespace-only input -> resolve fragment option (defaulting to true) -> construct unified processor -> parse HTML to hast -> runSync transformers to produce mdast Root -> return Root.
 */
export function htmlToMdast(html: string, options?: HtmlImportOptions): Root {
  // Guard empty or whitespace-only HTML input: return an empty mdast Root without running the unified pipeline.
  if (html.trim().length === 0) {
    // Branch: Input is empty or whitespace-only; return empty root directly.
    return {
      type: 'root',
      children: [],
    };
  } else {
    // Branch: Input contains non-whitespace HTML markup; proceed with unified conversion.
  }

  // Default fragment to true: clipboard HTML is nearly always a fragment;
  // parsing it as a whole document wraps it in html/body elements that then have to be unwrapped again.
  let isFragment = true;
  if (options?.fragment !== undefined) {
    // Branch: Explicit fragment setting supplied; use specified value.
    isFragment = options.fragment;
  } else {
    // Branch: No fragment setting supplied; default to true.
    isFragment = true;
  }

  // Build unified processor with rehypeParse and rehypeRemark.
  // Do not swallow errors: if the pipeline throws, let it propagate, matching how parser.ts treats a parse failure.
  const processor = unified()
    .use(rehypeParse, { fragment: isFragment })
    .use(rehypeRemark);

  // Parse HTML into hast and run transformers synchronously to produce an mdast tree.
  // We use runSync on a parsed tree rather than processSync because the caller wants the tree, not a stringified document.
  // The returned tree carries no useful position data, since it did not come from Markdown source.
  // This is expected and the incremental serializer treats a position-less node conservatively by re-serialising it in full.
  const mdastRoot = processor.runSync(processor.parse(html)) as Root;

  return mdastRoot;
}

/**
 * Converts an HTML string into a canonical Markdown source string.
 *
 * @purpose Composes htmlToMdast with serializeDocument to convert HTML directly into formatted Markdown.
 * @inputs html - Raw HTML source string to convert.
 * @inputs options - Optional HtmlImportOptions controlling fragment mode.
 * @outputs string - The formatted Markdown text corresponding to the converted HTML.
 * @dataflow HTML string -> htmlToMdast -> mdast Root -> KdocDocument container -> serializeDocument -> Markdown string.
 * @controlflow Convert HTML to mdast Root -> wrap in canonical KdocDocument -> invoke serializeDocument -> return Markdown string.
 */
export function htmlToMarkdown(html: string, options?: HtmlImportOptions): string {
  // Convert HTML input into an mdast Root syntax tree.
  const root = htmlToMdast(html, options);

  // Construct a canonical KdocDocument container wrapping the parsed mdast root.
  // serializeDocument expects a complete KdocDocument:
  // - text: Empty string because the content originates from HTML, not existing Markdown source text.
  // - root: The mdast Root syntax tree produced by htmlToMdast.
  // - frontMatter: null because imported HTML fragments do not contain YAML/TOML front matter blocks.
  const document: KdocDocument = {
    text: '',
    root,
    frontMatter: null,
  };

  // Serialize the document into Markdown using default styling.
  return serializeDocument(document);
}
