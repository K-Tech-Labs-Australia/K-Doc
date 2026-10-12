/**
 * @file alert-marker.ts
 * @purpose Serializer handler keeping GitHub alert markers unescaped within blockquotes (FR-8.5).
 *
 * A GitHub alert is a blockquote whose first line is exactly `> [!NOTE]`. The serializer escapes a leading
 * `[` in prose, and it is right to: a bare `[` could start a link, so `\[` is what keeps a round trip stable.
 * But inside an alert marker that escape is fatal — `> \[!NOTE]` renders as the literal text `[!NOTE]` on
 * GitHub and in Obsidian, so the callout looked right in K-Doc and was broken everywhere else. An editor whose
 * promise is that the file on disk is ordinary Markdown cannot ship that.
 *
 * The exception is deliberately narrow. It applies only to the **first child of a blockquote**, only when that
 * paragraph begins with a text node, and only when that text opens with the alert shape followed by a line
 * break or the end of the paragraph. A paragraph elsewhere that happens to read `[!NOTE]` is prose and keeps
 * its escape, and `[!NOTE] and more` is prose too -- the lookahead is what tells those apart.
 *
 * Version 1 only recognised a marker that is a paragraph all by itself. That is what K-Doc's own editor produces,
 * but it is not how the marker usually arrives: `> [!NOTE]\n> body` is a single paragraph whose text is
 * `[!NOTE]\nbody`, because a quote's continuation line is part of the same paragraph. So a GitHub file read
 * into K-Doc and written straight back came out with the escape still in it — the exact defect this file
 * exists to prevent, surviving in the commonest shape of the thing.
 * @inputs AST Paragraph nodes, optional Parents container nodes, remark serialization State and Info context.
 * @outputs Unescaped GitHub alert marker string or default serialized Markdown paragraph string.
 * @functions
 *   - alertMarkerOf: Returns the alert marker token this paragraph opens with, or null when it does not open one.
 *   - alertMarkerParagraphHandler: Wraps remark-stringify's paragraph handler to emit alert markers verbatim while preserving escaping for the remainder.
 * @dataflow mdast Paragraph & parent -> alertMarkerOf -> extract marker text -> unescaped marker + defaultHandler on remainder, or full defaultHandler fallback.
 * @controlflow Intercept paragraph serialization -> extract alert marker if present -> if none, delegate to defaultHandler; else emit marker verbatim and delegate remainder paragraph to defaultHandler.
 * @version 2
 * @date 2026-09-11
 */

import type { Info, State } from 'mdast-util-to-markdown';
import type { Paragraph, Parents, PhrasingContent, Text } from 'mdast';

/**
 * Regular expression matching a GitHub alert marker token (e.g. `[!NOTE]`, `[!WARNING]`).
 *
 * Anchored at the start, and the lookahead is what makes `[!NOTE] and more` not a marker while
 * `[!NOTE]\nbody` is. The regular expression carries no global flag because a global one keeps
 * `lastIndex` between calls and would make every other test fail.
 */
export const ALERT_MARKER_PATTERN: RegExp = /^\[![A-Za-z]+\](?=\n|$)/;

/**
 * Identifies the GitHub alert marker token opening a blockquote paragraph.
 *
 * @purpose Returns the alert marker this paragraph opens with, or null when it does not open one.
 * @inputs
 *   - node: Paragraph - The paragraph AST node to inspect.
 *   - parent: Parents | undefined - The parent AST container node, if any.
 * @outputs string | null - The alert marker token string, or null if the paragraph is not an alert marker.
 * @dataflow (node, parent) -> parent blockquote validation -> first child identity check -> first child text node validation -> regex pattern execution -> matched marker string or null.
 * @controlflow
 *   1. Guard parent: if parent is undefined or parent.type !== 'blockquote', return null.
 *   2. Guard parent.children[0] and check parent.children[0] !== node: if not the first block, return null.
 *   3. Guard node.children[0] and check child.type !== 'text': if missing or not text, return null.
 *   4. Execute ALERT_MARKER_PATTERN: if match === null, return null; else guard match[0] and return marker.
 */
export function alertMarkerOf(
  node: Paragraph,
  parent: Parents | undefined,
): string | null {
  // Step 1: Check whether parent exists and is a blockquote node.
  // An alert marker only means anything as the opening line of a quote.
  if (parent === undefined || parent.type !== 'blockquote') {
    // Parent is missing or is not a blockquote: return null.
    return null;
  } else {
    // Parent is a blockquote: proceed to verify child position.
  }

  const firstBlock = parent.children[0];
  // Step 2: Guard the indexed read of parent.children[0] and check whether it is the current node.
  // Only the first block of the quote can be an alert marker.
  if (firstBlock === undefined || firstBlock !== node) {
    // Node is missing or is not the first child block of the blockquote: return null.
    return null;
  } else {
    // Node is confirmed to be the first block of the blockquote: proceed to check its first child.
  }

  const child = node.children[0];
  // Step 3: Guard the indexed read of node.children[0] and check that its type is 'text'.
  // A marker is literal text, and a paragraph opening with a link or an emphasis is prose.
  if (child === undefined || child.type !== 'text') {
    // First inline child is missing or is not a text node: return null.
    return null;
  } else {
    // First child is narrowed to Text: child.value is accessible without a cast.
  }

  // Step 4: Execute the alert marker pattern against the text node value.
  const match = ALERT_MARKER_PATTERN.exec(child.value);
  // Check whether the pattern matched.
  if (match === null) {
    // Pattern did not match: return null.
    return null;
  } else {
    // Pattern matched: guard the indexed read of match[0] under noUncheckedIndexedAccess.
    const marker = match[0];
    // Check whether match[0] is defined.
    if (marker === undefined) {
      // Indexed read was unexpectedly undefined: return null.
      return null;
    } else {
      // Return the extracted alert marker token string.
      return marker;
    }
  }
}

/**
 * Wraps remark-stringify's default paragraph handler to emit GitHub alert markers verbatim without escaping.
 *
 * @purpose Wraps remark-stringify's own paragraph handler so an alert marker is emitted verbatim and everything else is untouched.
 * @inputs defaultHandler - The paragraph serializer remark-stringify would have used.
 * @outputs A handler with the same signature, which remark-stringify can use in its place.
 * @dataflow (paragraph, parents, state, info) -> alertMarkerOf -> if null, defaultHandler; else unescaped marker + defaultHandler on remainder paragraph.
 * @controlflow
 *   1. const marker = alertMarkerOf(paragraph, parents);
 *   2. If marker === null, return defaultHandler(paragraph, parents, state, info).
 *   3. Guard first child text node and slice off the marker.
 *   4. Reconstruct remainder children; if empty return marker; else return marker + defaultHandler(remainder).
 */
export function alertMarkerParagraphHandler(
  defaultHandler: (node: Paragraph, parent: Parents | undefined, state: State, info: Info) => string,
): (node: Paragraph, parent: Parents | undefined, state: State, info: Info) => string {
  return (paragraph: Paragraph, parents: Parents | undefined, state: State, info: Info): string => {
    const marker = alertMarkerOf(paragraph, parents);
    // Check whether the paragraph opens with an alert marker.
    if (marker === null) {
      // Paragraph does not open with an alert marker: delegate serialization to defaultHandler unchanged.
      return defaultHandler(paragraph, parents, state, info);
    } else {
      // Paragraph opens with an alert marker: proceed to strip the marker and serialize the remainder.
    }

    const first = paragraph.children[0];
    // Check that the first child is still the text node alertMarkerOf matched, which it is -- this
    // narrows it for the slice below rather than trusting the earlier call.
    if (first === undefined || first.type !== 'text') {
      // Cannot happen once alertMarkerOf has answered; fall back rather than lose the paragraph.
      return defaultHandler(paragraph, parents, state, info);
    } else {
      // The marker's own text is emitted verbatim; everything after it keeps the escaping it needs.
    }

    const remainderValue = first.value.slice(marker.length);
    const rest: PhrasingContent[] = [];
    // Check whether anything is left of the first text node once the marker is removed.
    if (remainderValue.length > 0) {
      // Keep the remainder as a text node so the line break after the marker survives.
      const remainderText: Text = { type: 'text', value: remainderValue };
      rest.push(remainderText);
    } else {
      // The marker was the whole of the first text node.
    }
    for (let i = 1; i < paragraph.children.length; i++) {
      const child = paragraph.children[i];
      // Guard the indexed read under noUncheckedIndexedAccess.
      if (child === undefined) {
        // A gap the array cannot have but the types allow.
        continue;
      } else {
        // Carry the remaining inline children across untouched.
      }
      rest.push(child);
    }

    // Check whether anything followed the marker at all.
    if (rest.length === 0) {
      // A marker on its own: nothing else to serialise.
      return marker;
    } else {
      // Serialise the remainder through the default handler, on a paragraph that is the original minus
      // its marker, so links, emphasis and every escape inside it are produced exactly as they would be
      // anywhere else. Only the marker itself skips state.safe, which is what inserts the backslash.
      // The remainder still begins with the newline that followed the marker, so the two join without anything being inserted between them.
      const remainder: Paragraph = { type: 'paragraph', children: rest };
      return marker + defaultHandler(remainder, parents, state, info);
    }
  };
}
