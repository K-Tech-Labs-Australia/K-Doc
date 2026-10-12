/**
 * @file types.ts
 * @purpose Defines the AST and document data types for @k-doc/core.
 * @inputs Source markdown text, mdast Root nodes, front matter payloads, and parser configuration options.
 * @outputs AST node types, KdocDocument document interface, and default parse options constant.
 * @augments Declares the `toml` and `kdocRaw` mdast node types via module augmentation so the parser can narrow on them.
 * @functions None (type declaration and constant definition module).
 * @dataflow Source markdown text → AST parsing → KdocDocument container with Root and FrontMatter.
 * @controlflow Static type definitions, mdast module augmentation, and DEFAULT_PARSE_OPTIONS constant initialization.
 * @version 2
 * @date 2026-09-04
 */

import type { Root, Literal, Parent, PhrasingContent } from 'mdast';

/**
 * Supported front matter serialization formats in Markdown documents.
 */
export type FrontMatterFormat = 'yaml' | 'toml';

/**
 * Represents front matter metadata extracted from the document header.
 *
 * `data` is `{}` when the front matter is TOML or fails to parse; `raw` is always
 * the verbatim text between the fences, excluding the fences themselves.
 */
export interface FrontMatter {
  readonly format: FrontMatterFormat;
  readonly raw: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Diagnostic reason why a construct could not be modelled in the AST and had to be
 * preserved as raw source bytes.
 */
export type KdocRawReason = 'unknown-html' | 'unsupported-directive' | 'parse-failure';

/**
 * Carries source bytes verbatim for constructs the engine cannot model.
 * It exists so nothing is ever silently dropped (FR-4.4 of PRELIM-SPEC.MD).
 */
export interface KdocRaw extends Literal {
  type: 'kdocRaw';
  value: string;
  reason: KdocRawReason;
}

/**
 * Canonical container representing a parsed Markdown document in @k-doc/core.
 *
 * `text` is the ORIGINAL source text, retained alongside the tree so untouched byte
 * ranges can later be spliced through unchanged (FR-4.2 of PRELIM-SPEC.MD).
 */
export interface KdocDocument {
  readonly text: string;
  readonly root: Root;
  readonly frontMatter: FrontMatter | null;
}

/**
 * Configuration options for parsing Markdown source text into a KdocDocument.
 */
export interface ParseOptions {
  readonly gfm?: boolean;
  readonly math?: boolean;
  readonly frontMatter?: boolean;
}

/**
 * Default parsing options applied when options are omitted in `parseMarkdown`.
 */
export const DEFAULT_PARSE_OPTIONS: Required<ParseOptions> = {
  gfm: true,
  math: true,
  frontMatter: true,
};

/**
 * The TOML front matter node produced by `remark-frontmatter`.
 *
 * `@types/mdast` ships a `yaml` entry in its `RootContentMap` but deliberately leaves
 * `toml` to the consumer, mentioning it only inside a documentation example that instructs
 * consumers to declare it themselves. Declaring this interface here is what lets the parser
 * narrow on `node.type === 'toml'` and read the node's `value`.
 */
export interface Toml extends Literal {
  type: 'toml';
}

/**
 * The three Tier-4 inline constructs from the specification (§4.4): highlight `==x==`,
 * subscript `~x~` and superscript `^x^`.
 *
 * remark has no plugin for any of them, so they are produced by a transform that runs over the tree
 * after parsing (`parse/rich-inline.ts`) and emitted by handlers registered on the serializer. They
 * are declared here, alongside `kdocRaw`, because module augmentation is the only way to teach
 * `@types/mdast` about a node it does not ship.
 */
export interface Highlight extends Parent {
  type: 'highlight';
  children: PhrasingContent[];
}

export interface Subscript extends Parent {
  type: 'subscript';
  children: PhrasingContent[];
}

export interface Superscript extends Parent {
  type: 'superscript';
  children: PhrasingContent[];
}

declare module 'mdast' {
  interface RootContentMap {
    toml: Toml;
    kdocRaw: KdocRaw;
    highlight: Highlight;
    subscript: Subscript;
    superscript: Superscript;
  }
  interface PhrasingContentMap {
    kdocRaw: KdocRaw;
    highlight: Highlight;
    subscript: Subscript;
    superscript: Superscript;
  }
}
