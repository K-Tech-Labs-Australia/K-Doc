/**
 * @file markdown-style.ts
 * @purpose Defines the MarkdownStyle emission policy for @k-doc/core. This module is the single
 *   place where emitted Markdown syntax is decided, so that "the serializer reformatted my file"
 *   bugs have exactly one place to look.
 * @inputs Partial<MarkdownStyle> user configurations, resolved MarkdownStyle objects.
 * @outputs Validated, frozen MarkdownStyle instances, remark-stringify and remark-gfm Options objects.
 * @functions
 *   - resolveMarkdownStyle: Merges partial overrides with DEFAULT_MARKDOWN_STYLE, validates, freezes.
 *   - toRemarkStringifyOptions: Maps a MarkdownStyle policy onto remark-stringify serializer Options.
 *   - toRemarkGfmOptions: Maps a MarkdownStyle policy onto the remark-gfm table Options.
 * @dataflow Configuration input → resolveMarkdownStyle (merge + validate) → MarkdownStyle →
 *   toRemarkStringifyOptions / toRemarkGfmOptions → plugin Options.
 * @controlflow Declare marker and policy types → define DEFAULT_MARKDOWN_STYLE → resolve with
 *   boundary checks → map to serializer options.
 * @version 3
 * @date 2026-09-15
 */

import type { Options } from 'remark-stringify';
import type { Options as RemarkGfmOptions } from 'remark-gfm';

export type BulletMarker = '-' | '*' | '+';
export type EmphasisMarker = '_' | '*';
export type StrongMarker = '_' | '*';
export type FenceMarker = '`' | '~';
export type ThematicBreakMarker = '-' | '_' | '*';
export type OrderedListNumbering = 'increment' | 'one';
export type ListItemIndent = 'one' | 'tab' | 'mixed';

export type LineWrapPolicy =
  | { readonly kind: 'never' }
  | { readonly kind: 'column'; readonly width: number }
  | { readonly kind: 'sentence' };

export interface MarkdownStyle {
  readonly bullet: BulletMarker;
  readonly emphasis: EmphasisMarker;
  readonly strong: StrongMarker;
  readonly fence: FenceMarker;
  readonly thematicBreak: ThematicBreakMarker;
  readonly thematicBreakLength: number;
  readonly atxClosingHashes: boolean;
  readonly setextHeadings: boolean;
  readonly orderedListNumbering: OrderedListNumbering;
  readonly listItemIndent: ListItemIndent;
  /** The delimiter after an ordered item's number, '.' when unset. The incremental serializer pins it to match a list written with ')'. */
  readonly orderedListDelimiter?: '.' | ')';
  readonly padTableCells: boolean;
  readonly lineWrap: LineWrapPolicy;
  readonly trailingNewline: boolean;
}

/**
 * The canonical emission style. The golden corpus is written in exactly this style,
 * which is what makes byte-identity round-tripping a meaningful assertion.
 *
 * The explicit type argument on Object.freeze is required: without it the object literal
 * widens (`bullet` infers as `string`, not `BulletMarker`) and the result is not assignable.
 */
export const DEFAULT_MARKDOWN_STYLE: MarkdownStyle = Object.freeze<MarkdownStyle>({
  bullet: '-',
  emphasis: '_',
  strong: '*',
  fence: '`',
  thematicBreak: '-',
  thematicBreakLength: 3,
  atxClosingHashes: false,
  setextHeadings: false,
  orderedListNumbering: 'increment',
  listItemIndent: 'one',
  padTableCells: true,
  lineWrap: { kind: 'never' },
  trailingNewline: true,
});

/**
 * Resolves a partial MarkdownStyle against the canonical default.
 *
 * @purpose Merges partial style options over the defaults and validates bounds, returning a frozen style.
 * @inputs partial - Optional partial MarkdownStyle overriding individual default fields.
 * @outputs MarkdownStyle - A fully resolved, frozen style object.
 * @dataflow partial + DEFAULT_MARKDOWN_STYLE → shallow merge → validate bounds → Object.freeze → return.
 * @controlflow Shallow-merge over defaults → check thematicBreakLength → check column width → freeze.
 */
export function resolveMarkdownStyle(partial?: Partial<MarkdownStyle>): MarkdownStyle {
  const resolved: MarkdownStyle = {
    ...DEFAULT_MARKDOWN_STYLE,
    ...partial,
  };

  // Check whether the thematic break repetition is below CommonMark's three-character minimum.
  if (resolved.thematicBreakLength < 3) {
    // Below minimum: fail fast rather than silently clamping, so a bad config is visible.
    throw new RangeError(
      `Invalid thematicBreakLength: ${resolved.thematicBreakLength}. Must be at least 3.`,
    );
  }

  // Check whether a column wrap policy specifies a width narrower than is usable.
  if (resolved.lineWrap.kind === 'column' && resolved.lineWrap.width < 20) {
    // Width below minimum: fail fast for the same reason as above.
    throw new RangeError(
      `Invalid column lineWrap width: ${resolved.lineWrap.width}. Must be at least 20.`,
    );
  }

  return Object.freeze(resolved);
}

/**
 * Converts a MarkdownStyle emission policy into remark-stringify options.
 *
 * @purpose Maps K-Doc style fields onto the corresponding remark-stringify serializer options.
 * @inputs style - The resolved MarkdownStyle to translate.
 * @outputs Options - The configuration object handed to remark-stringify.
 * @dataflow MarkdownStyle → field-by-field translation → remark-stringify Options.
 * @controlflow Derive incrementListMarker → map direct fields → return the options object.
 */
export function toRemarkStringifyOptions(style: MarkdownStyle): Options {
  // Check whether ordered lists number sequentially (1. 2. 3.) or repeat the marker (1. 1. 1.).
  // 'increment' maps to true; 'one' maps to false.
  const incrementListMarker = style.orderedListNumbering === 'increment';

  // Line wrapping is deliberately absent here. remark-stringify does not wrap by default, and
  // for the 'column' and 'sentence' policies K-Doc applies wrapping in its own serializer rather
  // than through remark. This comment exists so a future reader does not think it was forgotten.

  return {
    bullet: style.bullet,
    emphasis: style.emphasis,
    strong: style.strong,
    fence: style.fence,
    rule: style.thematicBreak,
    ruleRepetition: style.thematicBreakLength,
    closeAtx: style.atxClosingHashes,
    setext: style.setextHeadings,
    incrementListMarker,
    listItemIndent: style.listItemIndent,
    bulletOrdered: style.orderedListDelimiter ?? '.',
    // Always fence code blocks: an indented code block cannot carry a language annotation,
    // so allowing them would lose information on round trip.
    fences: true,
    resourceLink: false,
    tightDefinitions: true,
  };
}

/**
 * Converts a MarkdownStyle emission policy into remark-gfm (GFM) table options.
 *
 * @purpose Maps K-Doc style fields onto the GFM table-tuning options consumed by the remark-gfm plugin.
 * @inputs style - The resolved MarkdownStyle to translate.
 * @outputs RemarkGfmOptions - The configuration object handed to remark-gfm via `.use(remarkGfm, ...)`.
 * @dataflow MarkdownStyle → padTableCells → GFM table Options.
 * @controlflow Derive padding values from padTableCells → return the options object.
 *
 * NOTE: Table formatting (cell padding and pipe alignment) is configured on the remark-gfm plugin rather than
 * on remark-stringify, because that split is non-obvious: `tableCellPadding` and `tablePipeAlign` are NOT
 * remark-stringify options — they belong to mdast-util-gfm-table, which only runs when remark-gfm is active.
 * Placing them in the remark-stringify Options object (as was done previously) both broke type-checking and had
 * no runtime effect; this function exists so a future reader does not repeat that mistake.
 */
export function toRemarkGfmOptions(style: MarkdownStyle): RemarkGfmOptions {
  return {
    tableCellPadding: style.padTableCells,
    tablePipeAlign: style.padTableCells,
  };
}
