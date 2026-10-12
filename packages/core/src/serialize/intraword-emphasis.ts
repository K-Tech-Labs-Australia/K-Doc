/**
 * @file intraword-emphasis.ts
 * @purpose K-Doc's style writes emphasis with '_', but '_' only delimits emphasis at word boundaries; inside a word (`2*3*4`, `un*believ*able`) the default handler falls back to character references (`&#x32;_&#x33;_&#x34;`). This handler writes '*' for emphasis that touches a letter or digit on either side, and otherwise behaves exactly like the default.
 * @inputs mdast Emphasis nodes, optional Parents container nodes, remark serialization State (holding the configured `emphasis` marker) and Info context (reporting surrounding text via `before`/`after`), plus the default emphasis Handle to delegate non-intraword cases to.
 * @outputs A string with intraword emphasis written using '*' and all other emphasis serialized exactly as the default handler would, carrying a matching peek function for remark-stringify's marker prediction.
 * @functions
 *   - touchesWord: Returns true when an Emphasis node's immediate left or right context contains a letter or digit, marking it as intraword emphasis that must use '*' instead of '_'.
 *   - intrawordEmphasis: remark-stringify handle (with peek) that writes '*' for intraword underscore-emphasis and delegates to the default handler otherwise.
 * @dataflow mdast Emphasis node + State.options.emphasis + Info.before/after -> touchesWord(info) decides marker -> toggles state.options.emphasis to '*', delegates to defaultHandlers.emphasis, restores prior marker; peek mirrors this decision for remark-stringify's prediction pass.
 * @controlflow Intercept emphasis serialization -> if not underscore-configured or not intraword, delegate unchanged; else save current marker, set '*', serialize in a try/finally that always restores the original marker.
 * @version 1
 * @date 2026-10-08
 */

import { defaultHandlers, type Info, type State } from 'mdast-util-to-markdown';
import type { Emphasis, Parents } from 'mdast';

/** A letter or digit in any script. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Reports whether an Emphasis node sits inside a word.
 *
 * Underscore (`_`) only delimits emphasis at word boundaries in CommonMark; when the surrounding text on either
 * side contains no letter or digit, writing '_' would be ambiguous and remark-stringify falls back to character
 * references such as `&#x32;`. This predicate inspects the characters immediately before and after the node (reported
 * by remark-stringify in `info`) and returns true when at least one is a letter or digit in any script, marking the
 * emphasis as intraword. An empty boundary string matches nothing, so leading/trailing emphasis correctly reports false.
 *
 * @purpose Returns true when an Emphasis node's immediate left or right context contains a word character (letter or digit), flagging it as intraword emphasis that must use '*' instead of '_'.
 * @inputs info - remark-stringify Info reporting the text before and after the current node on its line.
 * @outputs A boolean: true if either adjacent boundary character is a letter or digit, false otherwise (including when both boundaries are empty).
 * @dataflow info.before -> slice to last character; info.after -> slice to first character -> WORD_CHARACTER.test on each -> logical OR of the two results.
 * @controlflow Read one trailing and one leading boundary character, test each against WORD_CHARACTER, return their combined result in a single expression with no branching.
 */
export function touchesWord(info: Info): boolean {
  // Last character of the preceding text on this line (empty string when nothing precedes it).
  const before = info.before.slice(-1);
  // First character of the following text on this line (empty string when nothing follows it).
  const after = info.after.slice(0, 1);

  // Check whether a letter or digit touches either side of the emphasis.
  return WORD_CHARACTER.test(before) || WORD_CHARACTER.test(after);
}

/**
 * remark-stringify handle for Emphasis nodes in K-Doc style.
 *
 * When the configured emphasis marker is '_' and the node touches a word on either side, writing '_' would be
 * ambiguous (underscore only delimits at word boundaries), so this handler temporarily switches the state's emphasis
 * option to '*' while delegating to remark-stringify's default emphasis serializer, then restores the original marker.
 * Every other case — non-intraword emphasis or a configured marker of '*' — is delegated unchanged. The try/finally
 * guarantees the restored marker even if serialization throws.
 *
 * @purpose Writes '*' for intraword underscore-emphasis by temporarily overriding state.options.emphasis during delegation; otherwise delegates to the default handler without modification.
 * @inputs node - The mdast Emphasis node being serialized. parent - Its optional Parents container, passed through unchanged. state - Serialization State whose emphasis option is toggled and restored. info - Context reporting surrounding text for intraword detection via touchesWord.
 * @outputs A string: '*'-delimited markup when the emphasis touches a word under '_' configuration, otherwise exactly what defaultHandlers.emphasis produces.
 * @dataflow (state.options.emphasis === '_') && touchesWord(info) -> decide marker -> snapshot prior marker, set '*', delegate to defaultHandlers.emphasis -> restore prior marker from snapshot.
 * @controlflow
 *   1. If options.emphasis is not '_' or the node does not touch a word, return defaultHandlers.emphasis(node, parent, state, info).
 *   2. const prior = state.options.emphasis (snapshot before mutation).
 *   3. Set state.options.emphasis to '*'.
 *   4. try { return defaultHandlers.emphasis(...) } finally { restore state.options.emphasis from prior }.
 */
function intrawordEmphasisHandler(
  node: Emphasis,
  parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  // Check whether the configured marker is underscore AND this emphasis touches a word on either side.
  if (state.options.emphasis !== '_' || !touchesWord(info)) {
    // Not intraword under '_' configuration (either another marker was chosen or both boundaries are non-word):
    // delegate to the default handler, which writes the configured marker unchanged.
    return defaultHandlers.emphasis(node, parent, state, info);
  } else {
    // Intraword underscore-emphasis: fall through and rewrite this node with '*' below.
  }

  // Snapshot the active emphasis marker so it can be restored after serialization completes or throws.
  const prior = state.options.emphasis;
  // Override to '*' for this single delegation so remark-stringify emits star-delimited markup instead of '_'.
  state.options.emphasis = '*';
  try {
    // Serialize with the overridden marker, then let finally restore it before returning to the caller.
    return defaultHandlers.emphasis(node, parent, state, info);
  } finally {
    // Restore the original marker regardless of success or failure so subsequent nodes serialize correctly.
    state.options.emphasis = prior;
  }
}

/**
 * remark-stringify peek for Emphasis markers in K-Doc style.
 *
 * remark-stringify calls a handler's `peek` before serialization to predict which emphasis character it will emit,
 * so the prediction must agree exactly with what intrawordEmphasisHandler writes: '*' when the marker is '_' and the
 * node touches a word on either side, otherwise whatever the state currently specifies (defaulting to '*'). Keeping
 * these in lockstep prevents remark-stringify from inserting an unnecessary escape before the emphasis.
 *
 * @purpose Predicts the exact emphasis character intrawordEmphasisHandler will emit so remark-stringify's marker prediction matches serialization and avoids spurious escapes.
 * @inputs _node - The mdast Emphasis node being peeked at, unused because only state and info drive the decision. _parent - Its optional Parents container, unused for the same reason. state - Serialization State whose emphasis option is consulted. info - Context reporting surrounding text for intraword detection via touchesWord.
 * @outputs A string: '*' when configured marker is '_' and this node touches a word, otherwise state.options.emphasis or '*' as a fallback default.
 * @dataflow (state.options.emphasis === '_') && touchesWord(info) -> choose '*', else fall back to the configured marker with '*' as final default.
 * @controlflow Evaluate the same intraword condition as the handler in one ternary, returning '*' on match and the current or default marker otherwise; no mutation of state occurs here.
 */
function intrawordEmphasisPeek(
  _node: Emphasis,
  _parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  // Check whether the configured marker is underscore AND this emphasis touches a word on either side.
  return state.options.emphasis === '_' && touchesWord(info) ? '*' : (state.options.emphasis ?? '*');
}

/**
 * remark-stringify Emphasis handler for K-Doc style, pairing intrawordEmphasisHandler with its matching peek function.
 *
 * The exported object carries both the handle and its `peek` so remark-stringify can use them together: the handler
 * rewrites intraword underscore-emphasis to '*' while every other case passes through unchanged, and the peek mirrors
 * that decision for marker prediction. This is registered as the emphasis entry in a serializer's handlers map.
 *
 * @purpose Exports the Emphasis handle paired with its peek function so it can be dropped into remark-stringify's handler table.
 * @inputs intrawordEmphasisHandler - The serialization handle implementing intraword '*' rewriting under '_' configuration. intrawordEmphasisPeek - The matching marker prediction used before serialization.
 * @outputs An Emphasis Handle object with a `peek` property, assignable to remark-stringify's handlers.emphasis field.
 * @dataflow Two functions composed via Object.assign into one handle+peek pair consumed by the serializer registration site.
 * @controlflow Assign the peek function as a static property on the handler in a single expression; no runtime branching occurs at export time.
 */
export const intrawordEmphasis = Object.assign(intrawordEmphasisHandler, {
  peek: intrawordEmphasisPeek,
});
