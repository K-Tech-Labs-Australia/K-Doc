/**
 * @file wikilink-text.ts
 * @purpose K-Doc reads wikilinks ([[Note]], [[Note#Heading]], [[Note|Alias]]) and embeds (![[Picture.png]]) from the source text; they are plain text in the tree. The default text handler escapes a `[` that could start a link, so a paragraph holding a wikilink was written back as `\[\[Note]]` whenever it was serialized — after an edit in the rich-text view, or on export — which is no longer a wikilink in K-Doc, Obsidian or any other reader. This handler writes each wikilink exactly as it was read and escapes only the text around it.
 * @inputs AST Text nodes, optional Parents container nodes, remark serialization State and Info context, plus the default text Handle to delegate non-wikilink gaps to.
 * @outputs A string with every wikilink or embed emitted verbatim and all surrounding prose escaped normally.
 * @functions
 *   - wikiLinkTextHandler: Wraps the default text handler so wikilinks are written unescaped while the rest of the node is escaped as usual.
 * @dataflow mdast Text node value -> WIKILINK_TEXT_PATTERN matchAll -> split around matches -> state.safe on each gap + verbatim link -> concatenated string.
 * @controlflow Intercept text serialization -> if no wikilink, delegate to defaultText; else walk matches left to right escaping the gaps and appending each link verbatim.
 * @version 1
 * @date 2026-09-18
 */

import type { Handle, Info, State } from 'mdast-util-to-markdown';
import type { Parents, Text } from 'mdast';

/**
 * Regular expression matching a wikilink or embed exactly as K-Doc's vault index reads it.
 *
 * A wikilink is `[[...]]` with no closing bracket or line break inside, optionally preceded by `!`
 * for an embed. The pattern carries the global flag so matchAll can walk every occurrence; a non-global
 * one would only ever report the first and leave the rest escaped as ordinary text.
 */
export const WIKILINK_TEXT_PATTERN: RegExp = /!?\[\[[^\]\n]+\]\]/g;

/**
 * Wraps remark-stringify's default text handler so K-Doc wikilinks are emitted verbatim without escaping.
 *
 * @purpose Wraps the default text serializer so each wikilink or embed is written exactly as it was read while only the surrounding prose is escaped.
 * @inputs defaultText - The text serializer remark-stringify would have used, applied to non-wikilink gaps.
 * @outputs A handler with the same signature, which remark-stringify can use in its place.
 * @dataflow (text, parent, state, info) -> matchAll against WIKILINK_TEXT_PATTERN -> if none, defaultText; else escape each gap and append links verbatim.
 * @controlflow
 *   1. const value = node.value.
 *   2. const matches = [...value.matchAll(WIKILINK_TEXT_PATTERN)].
 *   3. If matches.length === 0, return defaultText(node, parent, state, info).
 *   4. Walk matches left to right: if text precedes a link, escape it with state.safe; append the link verbatim.
 *   5. If trailing text remains after the last link, escape it too; return the assembled string.
 */
export function wikiLinkTextHandler(defaultText: Handle): Handle {
  const handler = (node: Text, parent: Parents | undefined, state: State, info: Info): string => {
    // The raw text of the node as K-Doc's vault index read it; wikilinks live inside this string.
    const value = node.value;

    // Find every wikilink or embed in document order so each can be written back verbatim.
    const matches = [...value.matchAll(WIKILINK_TEXT_PATTERN)];

    // Check whether the value contains no wikilink or embed at all.
    if (matches.length === 0) {
      // No wikilinks present: let the default handler escape and serialize the whole text normally.
      return defaultText(node, parent, state, info);
    } else {
      // Wikilinks are present: proceed to rebuild the value around them.
    }

    // The string being assembled; grows left to right from an empty start.
    let out = '';
    // Index of the next unprocessed character in `value`.
    let last = 0;

    for (const match of matches) {
      // match.index is always set by matchAll, but guard it under noUncheckedIndexedAccess-safe access.
      const start = match.index ?? 0;

      // Extract the full match once and confirm it is defined before reusing it below.
      const link = match[0];
      // Check whether the indexed read was unexpectedly undefined.
      if (link === undefined) {
        // A gap the array cannot have but the types allow: skip this iteration rather than crash.
        continue;
      } else {
        // The full match string is available for both length and character access below.
      }

      // Check whether ordinary text sits between the previous link and this one.
      if (start > last) {
        // Text precedes the link: escape it with state.safe so surrounding escapes are preserved,
        // while reporting the link's first character as the following context for that escaping.
        out += state.safe(value.slice(last, start), {
          ...info,
          before: out === '' ? info.before : out.slice(-1),
          after: link.charAt(0),
        });
      } else {
        // No text precedes this link: nothing to escape, and the loop continues to append the link itself.
      }

      // Append the wikilink or embed exactly as it was read; state.safe is skipped so no backslash is inserted.
      out += link;
      last = start + link.length;
    }

    // Check whether ordinary text remains after the final link.
    if (last < value.length) {
      // Trailing text: escape it, reporting ']' as the preceding context since every wikilink ends in one.
      out += state.safe(value.slice(last), { ...info, before: ']', after: info.after });
    } else {
      // Nothing follows the last link: no trailing escaping is needed.
    }

    return out;
  };
  return handler as Handle;
}
