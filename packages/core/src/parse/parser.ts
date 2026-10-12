/**
 * @file parser.ts
 * @purpose Parses Markdown source text into a canonical KdocDocument AST representation with round-trip fidelity.
 * @inputs Raw Markdown source text string and optional ParseOptions configuration.
 * @outputs Parsed KdocDocument container containing unmodified text, mdast Root, and extracted FrontMatter.
 * @functions
 *   - parseMarkdown: Parses Markdown source into a KdocDocument; never throws.
 * @dataflow Markdown text → resolved options → unified parser with extensions → mdast Root → front matter extraction → KdocDocument.
 * @controlflow Resolve options → collect remark plugins → parse AST root → inspect first node for YAML/TOML front matter → parse YAML safely → return KdocDocument.
 * @version 3
 * @date 2026-09-18
 */

import type { Root } from 'mdast';
import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { applyRichInline } from './rich-inline.js';
import { annotateTableWidths } from '../table/column-widths.js';
import { foldAlignment } from '../align/block-alignment.js';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import YAML from 'yaml';
import type {
  FrontMatter,
  FrontMatterFormat,
  KdocDocument,
  ParseOptions,
} from '../ast/types.js';
import { DEFAULT_PARSE_OPTIONS } from '../ast/types.js';

/**
 * Parses Markdown source text into a canonical KdocDocument container.
 *
 * @purpose Parses Markdown source text into a KdocDocument AST structure without throwing errors or mutating text.
 * @inputs text - The raw Markdown source text to parse.
 * @inputs options - Optional parsing configuration overrides for GFM, math, and front matter.
 * @outputs KdocDocument - Document container holding verbatim source text, AST root, and extracted front matter.
 * @dataflow Source text + options → merge options → configure unified processor → parse mdast Root → extract front matter → construct KdocDocument.
 * @controlflow Merge options over defaults → populate PluggableList → parse text to Root → check first child for YAML/TOML → parse YAML safely → return KdocDocument.
 */
export function parseMarkdown(text: string, options?: ParseOptions): KdocDocument {
  // The source text must survive byte-for-byte for the round-trip contract (FR-4.1)
  // and untouched regions must pass through unreformatted (FR-4.2), so do NOT strip
  // a BOM, normalise line endings, or trim — this is the single most likely thing
  // a future maintainer will "helpfully" add.

  const resolvedOptions: Required<ParseOptions> = {
    ...DEFAULT_PARSE_OPTIONS,
    ...options,
  };

  const extensions: PluggableList = [];

  // Check whether GitHub Flavored Markdown (GFM) extensions are enabled.
  // When enabled: activates tables, task lists, strikethrough, autolink literals, and footnotes.
  if (resolvedOptions.gfm) {
    // singleTilde is switched off so `~x~` is left alone for the subscript transform below.
    // remark-gfm defaults it to true, which would consume a single tilde pair as strikethrough and
    // make subscript unreachable; `~~x~~` is unaffected and still parses as `delete`.
    extensions.push([remarkGfm, { singleTilde: false }]);
  }

  // Check whether front matter parsing is enabled.
  // When enabled: parses leading '---' YAML and '+++' TOML fenced metadata blocks.
  if (resolvedOptions.frontMatter) {
    extensions.push([remarkFrontmatter, ['yaml', 'toml']]);
  }

  // Check whether math syntax parsing is enabled.
  // When enabled: parses inline '$...$' and display '$$...$$' math blocks.
  if (resolvedOptions.math) {
    extensions.push(remarkMath);
  }

  const processor = unified().use(remarkParse).use(extensions);

  // Parse the source text into an mdast syntax tree using processor.parse instead of
  // processor.process or processor.run, extracting the raw AST without running transformers.
  const root = processor.parse(text) as Root;

  // The three Tier-4 inline constructs (§4.4) have no remark plugin, so they are recognised by a pass
  // over the finished tree. It runs here rather than as a unified transformer because `processor.parse`
  // deliberately skips the transformer phase (see above), and because it needs the raw source: backslash
  // escapes are already resolved in the tree, so only the source can tell `\==x\==` from `==x==`.
  applyRichInline(root, text);

  // Column width hints (FR-8.26) live in delimiter-row dash counts, which the tree drops, so they too are read from the source.
  annotateTableWidths(text, root);

  // Alignment (FR-8.11) arrives as an HTML wrapper around a block. Folding it into node data here is what lets the
  // editor show an aligned paragraph rather than two raw HTML blocks with a plain one between them.
  foldAlignment(root);

  let frontMatter: FrontMatter | null = null;
  const firstChild = root.children[0];

  // Check if the document begins with a YAML or TOML front matter block.
  if (firstChild !== undefined && (firstChild.type === 'yaml' || firstChild.type === 'toml')) {
    const format: FrontMatterFormat = firstChild.type;
    const raw = firstChild.value;
    let data: Readonly<Record<string, unknown>> = {};

    // Check whether the front matter format is YAML to extract structured metadata.
    if (format === 'yaml') {
      // Parse YAML data safely. This is narrow, YAML-syntax-errors-only: malformed
      // metadata must not fail the parse because the editor has to open such a file in order to repair it.
      try {
        const parsed: unknown = YAML.parse(raw);
        // Accept parsed YAML only if it is a non-null, non-array object record.
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        } else {
          // Non-object YAML values (such as scalars or arrays) fall back to an empty record.
          data = {};
        }
      } catch {
        // Fall back to an empty record on malformed YAML syntax so parseMarkdown never throws.
        data = {};
      }
    } else {
      // TOML front matter is preserved verbatim in raw but not interpreted into data in v1.
      data = {};
    }

    // The front matter node is deliberately LEFT IN the tree because the serializer needs it to round-trip.
    frontMatter = {
      format,
      raw,
      data,
    };
  } else {
    // No front matter node present at the start of the document.
    frontMatter = null;
  }

  return {
    text,
    root,
    frontMatter,
  };
}
