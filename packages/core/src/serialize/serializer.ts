/**
 * @file serializer.ts
 * @purpose Serializes a KdocDocument AST back into canonical Markdown source text.
 * @inputs KdocDocument representing the parsed AST, optional MarkdownStyle emission policy.
 * @outputs Serialized Markdown string conforming to the specified style.
 * @functions
 *   - serializeDocument: Serializes a KdocDocument AST into a formatted Markdown string.
 * @dataflow KdocDocument.root → resolveMarkdownStyle → unified processor (remarkStringify + plugins + custom kdocRaw handler) → stringify → trailing newline adjustment → output string.
 * @controlflow Validate style options → construct unified processor with remark plugins and kdocRaw handler → stringify AST root → format trailing newline → return string.
 * @version 4
 * @date 2026-09-18
 */

import { unified } from 'unified';
import remarkStringify, { type Options } from 'remark-stringify';
import { defaultHandlers } from 'mdast-util-to-markdown';
import type { Info, State } from 'mdast-util-to-markdown';
import type { Parents, Table } from 'mdast';
import { gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { applyColumnWidths, hintsOf } from '../table/column-widths.js';
import { alertMarkerParagraphHandler } from './alert-marker.js';
import { alignedBlockHandler } from '../align/block-alignment.js';
import { wikiLinkTextHandler } from './wikilink-text.js';
import { intrawordEmphasis } from './intraword-emphasis.js';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';

import type { KdocDocument, KdocRaw } from '../ast/types.js';
import {
  resolveMarkdownStyle,
  toRemarkGfmOptions,
  toRemarkStringifyOptions,
  type MarkdownStyle,
} from '../style/markdown-style.js';

/**
 * Builds a remark-stringify handler for one of the Tier-4 inline constructs.
 *
 * @purpose Wraps a node's serialized children in the construct's marker.
 * @inputs marker - The literal delimiter, one of `==`, `~` or `^`.
 * @outputs A handler of the shape mdast-util-to-markdown expects.
 * @dataflow node.children -> state.containerPhrasing -> marker + text + marker.
 * @controlflow Narrow the node, delegate to containerPhrasing, concatenate.
 *
 * `containerPhrasing` rather than reading the children as text: it is what recurses through nested
 * marks, so `==**bold**==` emits the strong emphasis inside the highlight instead of flattening it.
 */
function richInlineHandler(
  marker: string,
): (node: unknown, _parent: unknown, state: State, info: Info) => string {
  return (node: unknown, _parent: unknown, state: State, info: Info): string => {
    // The handler signature is untyped at the node position, so narrow to the shape actually needed
    // rather than casting to a specific node type this helper is deliberately generic over.
    const parentNode = node as Parents;
    const tracker = state.createTracker(info);
    tracker.move(marker);
    const value = state.containerPhrasing(parentNode, {
      ...tracker.current(),
      before: marker,
      after: marker,
    });
    return marker + value + marker;
  };
}

/**
 * Serializes a KdocDocument AST into Markdown source text according to the given style.
 *
 * @purpose Converts a KdocDocument AST tree into a serialized Markdown source text string.
 * @inputs doc - The KdocDocument containing the AST root to serialize.
 * @inputs style - Optional partial or complete MarkdownStyle emission policy.
 * @outputs string - The formatted Markdown source text.
 * @dataflow doc.root → resolveMarkdownStyle(style) → unified().use(...) → processor.stringify → trailing newline normalization → serialized Markdown string.
 * @controlflow Resolve MarkdownStyle → verify lineWrap policy → build unified processor with remark-stringify, remark-gfm, remark-frontmatter, remark-math, and custom kdocRaw handler → invoke processor.stringify on doc.root → apply trailing newline policy → return result.
 */
export function serializeDocument(
  doc: KdocDocument,
  style?: MarkdownStyle
): string {
  // Phase 0 serializes the whole AST tree from doc.root.
  // We MUST NOT consult doc.text here; reading the original text would mask AST and serialization bugs that the round-trip test harness exists to detect.
  const resolved = resolveMarkdownStyle(style);

  // Check whether an unsupported line wrapping policy was requested.
  // Line wrapping is not implemented in Phase 0; failing loudly prevents silently emitting unwrapped text.
  if (resolved.lineWrap.kind !== 'never') {
    // Branch: Unsupported line wrapping kind ('column' or 'sentence') -> throw Error scheduled for Phase 0b.
    throw new Error(
      `Line wrapping policy '${resolved.lineWrap.kind}' is not supported in Phase 0; line wrapping is scheduled for Phase 0b.`
    );
  } else {
    // Branch: 'never' line wrapping policy -> proceed with standard serialization without line wrapping.
  }

  // Obtain baseline remark-stringify options from the resolved MarkdownStyle.
  const baseOptions = toRemarkStringifyOptions(resolved);

  // The GFM table handler, built with the same options remark-gfm is given below, so a table with width hints is laid out
  // exactly as any other table before its hinted columns are widened.
  const gfmTable = gfmTableToMarkdown(toRemarkGfmOptions(resolved)).handlers?.table;
  // mdast-util-gfm-table always provides a table handler; its absence would mean an incompatible version.
  if (gfmTable === undefined) {
    throw new Error('mdast-util-gfm-table provides no table handler.');
  } else {
    // The handler is available: tables are wrapped below.
  }

  // Extend remark-stringify options with custom node handlers.
  const stringifyOptions: Options = {
    ...baseOptions,
    handlers: {
      ...baseOptions.handlers,
      // Custom serialization handler for the kdocRaw node type that returns node.value verbatim,
      // with no escaping, no wrapping, and no trailing newline management.
      // This is what makes requirement FR-4.4 (never silently drop an unmodellable construct) hold.
      kdocRaw: (node: unknown): string => {
        // Narrow unknown parameter to KdocRaw to access verbatim value safely without using 'any'.
        const rawNode = node as KdocRaw;
        return rawNode.value;
      },
      // The three Tier-4 inline constructs (§4.4). Each wraps its serialized children in its marker.
      // `state.containerPhrasing` is what recurses correctly, so `==**bold**==` emits the strong
      // inside the highlight rather than a flattened string.
      // A blockquote's opening `[!NOTE]` line is emitted verbatim. Escaping its leading '[' is right
      // for prose and fatal here: `> \[!NOTE]` renders as literal text on GitHub and in Obsidian, so
      // the callout would look right in K-Doc and be broken in every other reader of the same file.
      // An aligned block is written back as the `<div align="...">` wrapper it came from (FR-8.11); an unaligned
      // one is written exactly as it was before this existed.
      paragraph: alignedBlockHandler(alertMarkerParagraphHandler(defaultHandlers.paragraph)),
      heading: alignedBlockHandler(defaultHandlers.heading),
      // Wikilinks and embeds are plain text in the tree; written with the default escape they stop being links.
      text: wikiLinkTextHandler(defaultHandlers.text),
      // Column width hints (FR-8.26): a hinted column is padded to at least its hint, which the delimiter row's dashes record.
      // Only a padded, aligned table has columns to widen; an unpadded one is left as the GFM handler writes it.
      table: (node: Table, parent: Parents | undefined, state: State, info: Info): string => {
        const text = gfmTable(node, parent, state, info);
        const hints = hintsOf(node);
        // Check whether this table has hints and the style pads cells.
        if (hints === null || !resolved.padTableCells) {
          return text;
        } else {
          return applyColumnWidths(text, hints, node.align ?? []);
        }
      },
      // Emphasis inside a word (`2*3*4`) cannot use `_`, which only works at word boundaries; the default handler would
      // fall back to character references, so such emphasis is written with `*` instead.
      emphasis: intrawordEmphasis,
      highlight: richInlineHandler('=='),
      subscript: richInlineHandler('~'),
      superscript: richInlineHandler('^'),
    },
    // Literal marker characters in ordinary prose must be escaped on the way out, or the next parse
    // would read them as constructs and the round trip would not be stable (FR-4.1). These patterns are
    // what make `serialize` and `parse` agree about which `=`, `~` and `^` are syntax.
    unsafe: [
      ...(baseOptions.unsafe ?? []),
      { character: '=', inConstruct: 'phrasing', after: '=' },
      { character: '~', inConstruct: 'phrasing' },
      { character: '^', inConstruct: 'phrasing' },
    ],
  };

  // Build unified processor configured with remarkStringify and required syntax plugins.
  // The GFM, frontmatter, and math plugins are required on the stringify side too,
  // otherwise tables, front matter blocks, and math nodes will be emitted wrongly or throw.
  const processor = unified()
    .use(remarkStringify, stringifyOptions)
    .use(remarkGfm, toRemarkGfmOptions(resolved))
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkMath);

  // Stringify the AST root without swallowing any serialization errors.
  let out = processor.stringify(doc.root);

  // Apply the trailing newline policy specified in the resolved Markdown style.
  if (resolved.trailingNewline) {
    // Branch: trailingNewline is true -> ensure the serialized string ends with exactly one newline ('\n').
    out = `${out.replace(/[\r\n]+$/, '')}\n`;
  } else {
    // Branch: trailingNewline is false -> strip all trailing newlines from the end of the serialized string.
    out = out.replace(/[\r\n]+$/, '');
  }

  return out;
}
