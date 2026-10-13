/**
 * @file block-alignment.ts
 * @purpose Block alignment for FR-8.11: store and restore the horizontal alignment of a paragraph or heading that a file carries in an HTML wrapper (`<div align="...">`) and that K-Doc records as node data on the inner block.
 * @inputs Markdown source text; an mdast Root tree containing raw `<div align="left|center|right">` / `</div>` wrappers around a single paragraph or heading; remark serialization State and Info context for the handler.
 * @outputs BlockAlignment values read from or written to node.data.kdocAlign (and data.hProperties); HTML wrapper strings emitted by alignedBlockHandler when serialising an aligned block back out.
 * @functions
 *   - alignmentOf: Read and validate the alignment stored on a paragraph or heading node, returning null when absent or malformed.
 *   - applyAlignment: Write or clear an alignment on a paragraph or heading node, storing it twice so the editor and exports agree.
 *   - foldAlignment: Fold a source `<div align="...">` wrapper into node data so the editor sees an aligned block rather than raw HTML around one.
 *   - openAlignment: Recognise a single opening `<div align="left|center|right">` html node in a tree, or null when it is not such a node.
 *   - isCloseNode: Recognise a closing `</div>` html node in a tree.
 *   - alignedBlockHandler: Wrap remark-stringify's block handler to emit an aligned block back as its source wrapper with surrounding blank lines.
 * @dataflow Source text → foldAlignment walks the Root, openAlignment/isCloseNode detect wrappers, applyAlignment records alignment on the inner block; serializer reads data via alignmentOf and emits `<div align="...">` through alignedBlockHandler.
 * @controlflow Fold happens once at parse time by scanning children in triples (open/inner/close); read/write helpers are pure mutations guarded against missing node.data; the handler wraps a default serializer and only adds markup when an alignment is present, always delegating to it first so inner inline formatting survives.
 * @version 1
 * @date 2026-09-18
 */

import type { Heading, Paragraph, Parents, Root, RootContent } from 'mdast';
import type { Info, State } from 'mdast-util-to-markdown';

/** The three horizontal alignments a block may carry. */
export type BlockAlignment = 'left' | 'center' | 'right';

/** The key alignment is stored under on a paragraph or heading node's data. */
export const ALIGNMENT_KEY: string = 'kdocAlign';

/** The wrapper a file carries alignment in: `<div align="center">` with the block between it and its close. */
export const ALIGN_OPEN_PATTERN: RegExp = /^<div align="(left|center|right)">$/;

/** The closing tag that ends the wrapper ALIGN_OPEN_PATTERN opens. */
export const ALIGN_CLOSE: string = '</div>';

/**
 * @purpose Reads and validates the horizontal alignment stored on a paragraph or heading node.
 * @inputs node - A paragraph or heading node whose data may hold a previously recorded alignment under kdocAlign.
 * @outputs BlockAlignment | null - The stored 'left', 'center' or 'right', or null when absent, malformed, or otherwise invalid.
 * @dataflow Node data → extract the kdocAlign value → validate it is one of the three known alignments → return that alignment only on an exact match, else reject with null.
 * @controlflow Read the stored value guarding missing node.data (as hintsOf does) → require an exact literal match against 'left'/'center'/'right'; return the narrowed alignment when matched and fall through to null otherwise.
 */
export function alignmentOf(node: Paragraph | Heading): BlockAlignment | null {
  // Read the stored alignment from the node's data; treat missing data as no value, mirroring hintsOf.
  const value: unknown = node.data === undefined ? undefined : (node.data as Record<string, unknown>)[ALIGNMENT_KEY];

  // The stored value must be exactly one of the three known alignments to count as an alignment.
  if (value === 'left' || value === 'center' || value === 'right') {
    // A recognised alignment is present; control flow narrows `value` to BlockAlignment, so it returns directly.
    return value;
  } else {
    // Absent, malformed, or an unrecognised string: report no alignment for this node.
    return null;
  }
}

/**
 * @purpose Writes or clears the horizontal alignment on a paragraph or heading node, storing it twice so both K-Doc and mdast-util-to-hast centre the block with no renderer changes.
 * @inputs node - The paragraph or heading node to annotate in place. align - The alignment to store, or null to clear any existing alignment.
 * @outputs void - Mutates node.data in place: sets or deletes kdocAlign and data.hProperties.
 * @dataflow align → (node.data as Record<string, unknown>) writes ALIGNMENT_KEY = align and hProperties = { style } for the set case; both keys deleted for the clear case.
 * @controlflow When align is null delete both keys only if node.data exists and leave the node untouched otherwise; when align is present create an empty data object if needed then write both keys, using a single Record cast for every write as hintsOf reads it.
 */
export function applyAlignment(node: Paragraph | Heading, align: BlockAlignment | null): void {
  // The alignment lives twice on purpose: kdocAlign is what K-Doc reads and hProperties is what mdast-util-to-hast renders from, so both must stay in lockstep for the editor and exported HTML to agree.
  if (align === null) {
    // Clearing an alignment: only touch node.data when it exists; a node without data has nothing to clear.
    if (node.data !== undefined) {
      // Guarded write path: cast once so both keys are removed from the same record object.
      const data = node.data as Record<string, unknown>;

      // Remove the K-Doc alignment key that applyAlignment and foldAlignment wrote here.
      delete data[ALIGNMENT_KEY];

      // Remove the hast hProperties entry (style) that mdast-util-to-hast reads when rendering this block.
      delete data['hProperties'];
    } else {
      // No node.data to clear: leave the node exactly as it is, matching hintsOf's missing-data guard.
    }
  } else {
    // Storing an alignment: ensure a data object exists before writing into it below.
    if (node.data === undefined) {
      // Create empty data so both keys can be written; the target accepts any record via its index signature.
      node.data = {} as Paragraph['data'];
    }

    // Single Record cast for every write, exactly how hintsOf reads kdocAlign back out of node.data.
    const data = node.data as Record<string, unknown>;

    // Store the alignment under K-Doc's own key so foldAlignment and alignmentOf can read it later.
    data[ALIGNMENT_KEY] = align;

    // Mirror the alignment into hast hProperties so mdast-util-to-hast emits text-align with no renderer changes.
    data['hProperties'] = { style: `text-align: ${align}` };
  }
}

/**
 * @purpose Recognises a single opening `<div align="left|center|right">` html node in a tree, returning its alignment or null when the node is not such an opener.
 * @inputs node - A root content node to inspect; only an `html` node can open this wrapper.
 * @outputs BlockAlignment | null - The captured 'left', 'center' or 'right', or null for any other html value, non-html node, or malformed tag.
 * @dataflow Node → type check → trimmed value → ALIGN_OPEN_PATTERN.exec → capture group 1 (guarded) → alignment; else null.
 * @controlflow Reject non-html nodes and values that do not match the opener pattern with an explicit empty else; guard the regex capture before returning it under noUncheckedIndexedAccess.
 */
function openAlignment(node: RootContent): BlockAlignment | null {
  // Only a raw html node can carry the opening `<div align="...">` tag of the wrapper.
  if (node.type !== 'html') {
    // Not an html node; it cannot be an opener, so no alignment is recognised here.
    return null;
  } else {
    // An html node: match its trimmed value against the opening-div pattern below.
  }

  // Match once and reuse the result for both the presence check and the captured alignment group.
  const match = ALIGN_OPEN_PATTERN.exec(node.value.trim());

  // The opener must fully match; a partial or non-match leaves no wrapper open at this position.
  if (match === null) {
    // Value did not match the opening pattern: report no alignment for this node.
    return null;
  } else {
    // A capture group exists because ALIGN_OPEN_PATTERN always captures when it matches; guard under noUncheckedIndexedAccess before returning.
    const align = match[1];

    // The pattern can only capture one of the three alignments, but the capture is typed as a plain string,
    // so it is checked against them here rather than asserted.
    if (align === 'left' || align === 'center' || align === 'right') {
      // A captured alignment the pattern limited to the three K-Doc writes.
      return align;
    } else {
      // Missing under strict indexing, or something the pattern could not have produced: no alignment.
      return null;
    }
  }
}

/**
 * @purpose Recognises a closing `</div>` html node in a tree.
 * @inputs node - A root content node to inspect; only an `html` node can be this close tag.
 * @outputs boolean - True when the node is an html node whose trimmed value is exactly ALIGN_CLOSE, false otherwise.
 * @dataflow Node → type check → compare trimmed value against ALIGN_CLOSE → true or false.
 * @controlflow Reject non-html nodes and values that are not exactly the close tag with explicit empty elses so only a precise match returns true.
 */
function isCloseNode(node: RootContent): boolean {
  // Only a raw html node can be the closing `</div>` of the wrapper.
  if (node.type !== 'html') {
    // Not an html node; it cannot close the wrapper, so this position does not match.
    return false;
  } else {
    // An html node: compare its trimmed value against the exact close tag below.
  }

  // The close must be exactly `</div>` with no surrounding markup to count as a matching pair.
  if (node.value.trim() !== ALIGN_CLOSE) {
    // Value is not the closing tag: this position does not match an open/close wrapper.
    return false;
  } else {
    // The value matches exactly: this node closes a wrapper opened by openAlignment.
    return true;
  }
}

/**
 * @purpose Gives the folded block the whole wrapper's source range, so anything that rewrites the block by its
 *   range rewrites the wrapper with it (FR-4.2).
 * @inputs inner - The block the wrapper held. open - The opening html node. close - The closing html node.
 * @outputs void - Sets inner.position when all three nodes carry one.
 * @dataflow open.position.start + close.position.end -> inner.position.
 * @controlflow Does nothing unless all three positions are present: a tree built in memory has none, and a made-up
 *   range would be worse than no range at all.
 */
function spanTheWrapper(inner: Paragraph | Heading, open: RootContent, close: RootContent): void {
  const from = open.position;
  const to = close.position;
  // Check whether both wrapper nodes know where they came from; a tree built in code carries no positions.
  if (from === undefined || to === undefined) {
    return;
  } else {
    // Both are placed: the folded block takes the range from the open's start to the close's end.
  }
  inner.position = { start: from.start, end: to.end };
}

/**
 * @purpose Folds a source `<div align="...">` wrapper into node data so the editor sees an aligned block rather than two raw HTML blocks around one plain block, leaving anything wider untouched for lossless round-tripping.
 * @inputs root - The parsed mdast Root tree to fold in place; only single-block wrappers are consumed, everything else is preserved verbatim.
 * @outputs void - Mutates the inner paragraph or heading's data via applyAlignment and splices the wrapper html nodes out of root.children.
 * @dataflow Source text → parse drops tags into raw html children → walk triples (open/inner/close) → openAlignment/isCloseNode validate a single-block wrapper → applyAlignment records alignment on the inner block → splice both wrappers away.
 * @controlflow Scan children left to right in an index loop; at each position test for open+close around exactly one paragraph or heading and, when matched, record then splice close-then-open (so the open's index is preserved) and advance past the folded block, otherwise step forward by one without mutating.
 */
export function foldAlignment(root: Root): void {
  // Walk every position; a wrapper needs an opener at `index`, so scanning to length keeps the triple read valid.
  let index = 0;

  while (index < root.children.length) {
    // Read the three consecutive nodes that would form an open/inner/close wrapper, with strict indexing giving undefined past the end.
    const open = root.children[index];
    const inner = root.children[index + 1];
    const close = root.children[index + 2];

    // Every one of the triple must be present; a short tail cannot hold a full wrapper.
    if (open === undefined || inner === undefined || close === undefined) {
      // Ran out of children before completing a triple: no further wrappers are possible, so stop scanning.
      break;
    } else {
      // All three nodes exist at this position; continue to validate them as an open/inner/close wrapper below.
    }

    // Determine the alignment the opener advertises, or null when it is not a recognised opening div.
    const align = openAlignment(open);

    // Confirm the trailing node actually closes the wrapper with `</div>`.
    const closes = isCloseNode(close);

    // The block inside must be an aligned-capable paragraph or heading; other inner nodes cannot carry alignment.
    const alignable = inner.type === 'paragraph' || inner.type === 'heading';

    if (align !== null && closes && alignable) {
      // A complete single-block wrapper: record the alignment on the inner block before mutating the tree.
      applyAlignment(inner as Paragraph | Heading, align);

      // The wrapper's own source range would otherwise belong to nothing once its nodes are gone, and an
      // incremental rewrite of this block would leave the `<div>` lines behind it in the file.
      spanTheWrapper(inner as Paragraph | Heading, open, close);

      // Drop the close node first so the open's index still holds its opener after removal.
      root.children.splice(index + 2, 1);

      // Now drop the open node; everything shifts down by one and the folded block lands at `index`.
      root.children.splice(index, 1);

      // The folded aligned block is now at `index`; advance past it to keep scanning from its successor.
      index += 1;
    } else {
      // Not an open/inner/close wrapper here (bad opener, missing close, or non-alignable inner): leave these nodes exactly as written and step forward by one.
      index += 1;
    }
  }
}

/**
 * @purpose Wraps remark-stringify's block handler to emit a paragraph or heading back out as the `<div align="...">` wrapper it came from, keeping its content Markdown via surrounding blank lines.
 * @inputs defaultHandler - The block serializer (paragraph or heading) remark-stringify would have used for this node.
 * @outputs A handler with the same signature that delegates to defaultHandler and only augments output when an alignment is present on the node.
 * @dataflow Node → defaultHandler produces inner `text` → alignmentOf reads kdocAlign → null returns text unchanged; else wrap as `<div align="...">\n\n${text}\n\n</div>`.
 * @controlflow Call defaultHandler first to obtain base serialization, then branch on alignmentOf: return the plain text when there is no alignment and otherwise surround it with blank lines so an HTML block does not swallow following inline formatting.
 */
export function alignedBlockHandler<Block extends Paragraph | Heading>(
  defaultHandler: (node: Block, parent: Parents | undefined, state: State, info: Info) => string,
): (node: Block, parent: Parents | undefined, state: State, info: Info) => string {
  return (node: Block, parent: Parents | undefined, state: State, info: Info): string => {
    // Serialise the block through remark-stringify's own handler first so inner inline formatting is produced exactly as usual.
    const text = defaultHandler(node, parent, state, info);

    // Read any alignment recorded on this node during folding; null means it was never aligned and should serialize plainly.
    const align = alignmentOf(node);

    if (align === null) {
      // No alignment present: return the base serialization unchanged so unaligned blocks are untouched.
      return text;
    } else {
      // An alignment is present: wrap the serialised block in its source `<div align="...">` wrapper below.
    }

    // Surround with blank lines on each side so this HTML block does not swallow following inline formatting (e.g. `**bold**`) into itself, which would stop it rendering as bold everywhere but K-Doc.
    return `<div align="${align}">\n\n${text}\n\n</div>`;
  };
}
