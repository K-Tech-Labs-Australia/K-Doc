/**
 * @file rich-inline.ts
 * @purpose Rewrites inline markdown children by matching highlight-delimiter pairs
 *   (for example ==...==) and rebuilding them as nested mdast nodes. Implements a
 *   flatten -> pair -> rebuild pipeline driven over the original source text.
 * @inputs PhrasingContent children plus the original document string used to locate
 *   delimiter markers by character offset.
 * @outputs Transformed PhrasingContent[] from transformChildren, or an in-place mutation
 *   of a Root tree from applyRichInline.
 * @functions
 *   - flatten: Split inline children into a flat token stream, breaking text nodes at every
 *     detected delimiter marker and passing non-text nodes through untouched.
 *   - pair: Match opening/closing delimiter tokens into nested highlight nodes, leaving
 *     unmatched markers and empty spans as literal text.
 *   - rebuild: Collapse the paired token stream back into mdast phrasing content.
 *   - transformChildren: Compose flatten -> pair -> rebuild over one node's children.
 *   - applyRichInline: Depth-first rewrite of every children-bearing node in a Root tree.
 *   - hasChildren: Type-guard returning true for nodes carrying a PhrasingContent[] array.
 * @dataflow Source string + children -> flatten (sourceOffsets + scanDelimiters) -> token
 *   stream -> pair (match + recurse) -> rebuild -> mdast phrasing content.
 * @controlflow transformChildren drives the pipeline; applyRichInline walks the tree
 *   depth-first, transforming each node's children before recursing into them.
 * @version 1
 * @date 2026-09-06
 */

import type { Root, PhrasingContent } from 'mdast';
import type { RichInlineType } from './rich-inline-scan.js';
import { RICH_INLINE_MARKERS, scanDelimiters, sourceOffsets } from './rich-inline-scan.js';

/**
 * A single unit produced by flatten() and consumed by pair()/rebuild().
 * - text: a run of literal inline content.
 * - delim: an opening or closing highlight delimiter marker.
 * - node: an original inline mdast node passed through unchanged.
 */
type Token =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'delim'; readonly type: RichInlineType }
  | { readonly kind: 'node'; readonly node: PhrasingContent };

/**
 * @purpose Split inline children into a flat token stream, breaking text nodes at every
 *   detected delimiter marker while passing non-text nodes through untouched.
 * @inputs children - Inline mdast nodes to flatten. source - Original document text used
 *   to resolve each value's character offsets for delimiter matching.
 * @outputs Token[] - Ordered tokens: literal text runs, delimiter markers, and passthrough
 *   inline nodes.
 * @dataflow Each child -> (text) sourceOffsets + scanDelimiters over the value -> slices of
 *   literal text interleaved with delim tokens; (non-text) a single node token.
 * @controlflow Iterate children; branch on text vs non-text; for text, walk delimiter hits
 *   emitting pre-marker text then each delim, then emit any trailing text.
 */
function flatten(children: PhrasingContent[], source: string): Token[] {
  const tokens: Token[] = [];

  // Flattening across sibling boundaries is what lets a single highlight pair span multiple
  // nodes. For example `==**bold** x==` becomes text('=='), strong, text(' x=='); a pass
  // confined to one text node could never match that pair.
  for (const child of children) {
    if (child.type !== 'text') {
      // Non-text inline node (strong, em, code, link, ...): keep it as one token.
      tokens.push({ kind: 'node', node: child });
      continue;
    }

    // Recover the source offsets for this text value so delimiter matches can be located
    // relative to the original document rather than the isolated string.
    const offsets = sourceOffsets(source, child.value, child.position?.start?.offset ?? -1);

    if (offsets.length === 0) {
      // Offsets could not be recovered: emit the raw value untouched so a node whose
      // position is unknown is left exactly as the user wrote it.
      tokens.push({ kind: 'text', value: child.value });
      continue;
    }

    const hits = scanDelimiters(child.value, offsets, source, 0);
    let cut = 0; // Next character index in child.value not yet emitted.

    for (const hit of hits) {
      // Emit the literal text between the previous cut and this delimiter marker.
      if (hit.valueIndex > cut) {
        tokens.push({ kind: 'text', value: child.value.slice(cut, hit.valueIndex) });
      }
      // Emit the delimiter marker itself.
      tokens.push({ kind: 'delim', type: hit.type });
      // Advance the cut past this marker so the next slice starts after it.
      cut = hit.valueIndex + hit.length;
    }

    // Emit any trailing literal text after the last matched delimiter.
    if (cut < child.value.length) {
      tokens.push({ kind: 'text', value: child.value.slice(cut) });
    }
  }

  return tokens;
}

/**
 * @purpose Match delimiter tokens into nested highlight nodes, leaving unmatched markers
 *   and empty spans as literal text.
 * @inputs tokens - Flat token stream from flatten().
 * @outputs Token[] - Tokens with matched pairs collapsed into node tokens; literals kept.
 * @dataflow Scan left to right; on a delim, find its matching close of the same type and
 *   replace the span [open..close] with one node whose children are pair() over the interior.
 * @controlflow Advance i for literals; search forward for a same-type delim; branch on
 *   not-found (literal), adjacent-empty (double literal), or real-pair (recurse + wrap).
 */
function pair(tokens: Token[]): Token[] {
  const result: Token[] = [];
  let i = 0; // Index of the next unconsumed token.

  while (i < tokens.length) {
    // Bounded by the loop condition; assert defined for strict element access.
    const token = tokens[i]!;

    if (token.kind === 'text' || token.kind === 'node') {
      // Literal content: pass it through unchanged and advance one token.
      result.push(token);
      i += 1;
    } else if (token.kind === 'delim') {
      const type = token.type;

      // Search forward for the next delimiter of the same highlight type.
      let j = -1;
      for (let k = i + 1; k < tokens.length; k += 1) {
        const candidate = tokens[k];
        if (candidate?.kind === 'delim' && candidate.type === type) {
          // Found the matching close delimiter at index k.
          j = k;
          break;
        }
      }

      if (j === -1) {
        // No matching close: this opening marker is literal text, not a pair.
        result.push({ kind: 'text', value: RICH_INLINE_MARKERS[type] });
        i += 1;
      } else if (j === i + 1) {
        // Adjacent markers wrap nothing; an empty highlight is far likelier to be a typo
        // than an intention, so both markers are emitted as literal text.
        result.push({ kind: 'text', value: RICH_INLINE_MARKERS[type] });
        result.push({ kind: 'text', value: RICH_INLINE_MARKERS[type] });
        i = j + 1;
      } else {
        // A real pair: recurse over the interior so nested pairs (for example `==a ^b^ c==`)
        // still resolve, then wrap the rebuilt children in a highlight node. This node is
        // synthesised here and deliberately carries no position (see rebuild).
        const inner = pair(tokens.slice(i + 1, j));
        result.push({ kind: 'node', node: { type, children: rebuild(inner) } });
        i = j + 1;
      }
    }
  }

  return result;
}

/**
 * @purpose Collapse a paired token stream back into mdast phrasing content, coalescing
 *   consecutive text tokens and treating stray delimiters as literal markers.
 * @inputs tokens - Paired token stream from pair().
 * @outputs PhrasingContent[] - Rebuilt inline nodes with no position metadata.
 * @dataflow Accumulate text runs into a buffer; flush on each non-text token or at end;
 *   pass node tokens through; convert any leftover delim to its marker text.
 * @controlflow Single left-to-right walk maintaining a pending text buffer and flushing it
 *   whenever a non-text token arrives or the stream ends.
 */
function rebuild(tokens: Token[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let buffer = ''; // Coalesced literal text from consecutive text tokens.

  // Every node materialised here deliberately omits `position`: it was not produced by the
  // mdast parser. The incremental serializer is position-based, so a node with no position
  // is re-serialised in full from its children rather than sliced from the source - the
  // correct conservative behaviour for synthesised content.
  for (const token of tokens) {
    if (token.kind === 'text') {
      // Accumulate consecutive literal runs so they collapse into one text node.
      buffer += token.value;
    } else if (token.kind === 'node') {
      // Flush pending literal text before the node, then pass the node through as-is.
      if (buffer !== '') {
        out.push({ type: 'text', value: buffer });
        buffer = '';
      }
      out.push(token.node);
    } else {
      // A stray delimiter reached rebuild: emit its literal marker text rather than throwing,
      // since a parser must not crash on input it did not anticipate.
      if (buffer !== '') {
        out.push({ type: 'text', value: buffer });
        buffer = '';
      }
      out.push({ type: 'text', value: RICH_INLINE_MARKERS[token.type] });
    }
  }

  // Flush any literal text still buffered at the end of the stream.
  if (buffer !== '') {
    out.push({ type: 'text', value: buffer });
  }

  return out;
}

/**
 * @purpose Rewrite one node's inline children through the flatten -> pair -> rebuild pipeline.
 * @inputs children - Inline mdast nodes to transform. source - Original document text.
 * @outputs PhrasingContent[] - Transformed inline content.
 * @dataflow children + source -> flatten -> pair -> rebuild -> returned phrasing content.
 * @controlflow Straightforward composition of the three pipeline stages; no branching.
 */
export function transformChildren(children: PhrasingContent[], source: string): PhrasingContent[] {
  const tokens = flatten(children, source);

  // Check whether this parent contains any Tier-4 delimiter at all.
  const hasDelimiter = tokens.some((token: Token): boolean => token.kind === 'delim');

  if (!hasDelimiter) {
    // None: return the original children untouched. This is not merely an optimisation — rebuild()
    // synthesises fresh text nodes with no `position`, and positions are what nodeAtOffset uses to map
    // a caret offset to a node and what the incremental serializer uses to slice unedited regions from
    // the source. Rewriting every paragraph in the document would throw both away to no purpose.
    return children;
  }

  // At least one delimiter is present, so this parent's inline content genuinely changes shape and the
  // rebuilt nodes carry no positions. That cost is confined to parents that actually use the syntax.
  return rebuild(pair(tokens));
}

/**
 * @purpose Type-guard identifying nodes that carry a PhrasingContent[] children array.
 * @inputs node - Arbitrary value inspected for a children property.
 * @outputs true when node is an object with an array-valued children property.
 * @dataflow Inspects the runtime shape of node; no transformation occurs.
 * @controlflow Single boolean expression over typeof, null check, and Array.isArray.
 */
function hasChildren(node: unknown): node is { children: PhrasingContent[] } {
  return typeof node === 'object' && node !== null && Array.isArray((node as { children?: unknown }).children);
}

/**
 * @purpose Rewrite every node with children in a Root tree, depth first and in place.
 * @inputs root - The mdast Root to mutate. source - Original document text.
 * @outputs void - Mutates root.children (and descendants) in place.
 * @dataflow For each node: transformChildren on its children, then recurse into results.
 * @controlflow Guard with hasChildren; if present, rewrite children then descend into them.
 */
export function applyRichInline(root: Root, source: string): void {
  // Depth-first rewrite in place: transform this node's children before descending so that
  // nested inline structures are handled bottom-up.
  if (hasChildren(root)) {
    root.children = transformChildren(root.children, source);
    // Recurse into the freshly transformed children. applyRichInline is typed on Root for
    // its public entry point; each child is a phrasing node sharing the same children-bearing
    // shape, hence the structural cast here.
    for (const child of root.children) {
      applyRichInline(child as unknown as Root, source);
    }
  }
}
