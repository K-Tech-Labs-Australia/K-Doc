/**
 * @file indent-commands.ts
 * @purpose Indenting and outdenting whatever is under the caret in the K-Doc pane (FR-20.2, FR-8.6): a list item within its list via indentList/outdentList, anything else into or out of a blockquote. These give the indentation keys the spec names for outside a list something to bind, since Markdown has no paragraph-level indent and leading spaces make a code block instead.
 * @inputs ProseMirror EditorState instances and optional transaction dispatch callbacks; consumed by the two commands bound to those keys.
 * @outputs Two ProseMirror Command factories: indentBlock nests under-indenting into a list item or, outside a list, wraps the block in a blockquote; outdentBlock reverses it (lifting via lift directly rather than checking for a blockquote by name).
 * @functions
 *   - indentBlock: Indents whatever is under the caret: nests a list item, else wraps the block in a blockquote (FR-20.2).
 *   - outdentBlock: Outdents whatever is under the caret: lifts a list item, else lifts it out of a blockquote via lift directly (FR-20.2).
 * @dataflow EditorState -> indentList/outdentList on the active list (final) -> outside a list wrapIn/lift on the enclosing blockquote -> dispatch callback or boolean applicability.
 * @controlflow Ask whether the caret is in a list first and treat that as final for both commands: inside a list, delegate to indentList/outdentList and return; outside a list, indentBlock resolves the blockquote node type present in this schema build (guarding undefined) then wraps the caret's block in one more blockquote, while outdentBlock calls lift directly. Markdown has no paragraph-level indent: leading spaces make a code block, so there is nothing else to write and a blockquote stands in for it outside a list; lift refuses of its own accord when there is nothing to come out of.
 * @version 2
 * @date 2026-09-18
 */

import { lift, wrapIn } from 'prosemirror-commands';
import { indentList, outdentList, listDepthAt } from './list-commands.js';
import { kdocSchema } from './schema.js';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

/**
 * Creates a command that indents whatever is under the caret (FR-20.2).
 *
 * @purpose Indents whatever is under the caret: a list item within its list, anything else into a blockquote (FR-20.2).
 * @inputs None.
 * @outputs Command - A ProseMirror command returning boolean applicability and dispatching indentation.
 * @dataflow EditorState -> listDepthAt(state) -> indentList()(state, dispatch); outside a list resolve kdocSchema.nodes['blockquote'] -> guard undefined (return false) -> wrapIn(type)(state, dispatch).
 * @controlflow Ask whether the caret is in a list first and treat that as final: inside a list, indenting means nesting the item and nothing else, so an item that cannot nest (the first of its list, which sinkListItem refuses) does nothing rather than quietly becoming a blockquote. Outside a list, resolve the blockquote node type present in this schema build, returning false when absent, then wrap the caret's block in one more blockquote. A blockquote is what Markdown has instead of a paragraph indent: leading spaces make a code block, so there is nothing else to write outside a list.
 */
export function indentBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check whether the caret is in a list at all, before any of it is acted on.
    if (listDepthAt(state) !== null) {
      // It is: a list item nests under the one above it, and that is the whole of what indenting
      // means here. An item that cannot nest does nothing, rather than becoming a blockquote inside
      // a list item, which is not what the key was pressed for.
      return indentList()(state, dispatch);
    } else {
      // Not in a list: indent the block itself below.
    }

    const type = kdocSchema.nodes['blockquote'];

    // Check whether this build of the schema has blockquotes at all. noUncheckedIndexedAccess types
    // the lookup as possibly undefined, so the guard is the type system's price for reading it by name.
    // A mutant that removed it survived, because K-Doc's schema always carries blockquotes; it stays
    // because the alternative is a non-null assertion, which would be a worse way to say the same thing.
    if (type === undefined) {
      return false;
    } else {
      // It has: wrap what is under the caret in one more of them.
    }

    return wrapIn(type)(state, dispatch);
  };
}

/**
 * Creates a command that outdents whatever is under the caret (FR-20.2).
 *
 * @purpose Outdents whatever is under the caret: a list item out of its list, anything else out of a blockquote (FR-20.2).
 * @inputs None.
 * @outputs Command - A ProseMirror command returning boolean applicability and dispatching outdentation.
 * @dataflow EditorState -> listDepthAt(state) -> outdentList()(state, dispatch); outside a list lift(state, dispatch), which refuses when there is nothing to lift out of rather than asking by name first.
 * @controlflow Ask whether the caret is in a list first and treat that as final, for the same reason as indentBlock. Outside a list, call lift directly without checking what encloses the caret: because the list has already been answered for and returned above, the trap toggleBlockquote documents - a bare lift taking the caret out of an enclosing LIST before it reaches a blockquote - cannot be sprung here. A blockquote is then the only wrapper a paragraph can be lifted out of in this schema, and lift refuses of its own accord when there is none, so asking after it by name would be redundant.
 */
export function outdentBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check whether the caret is in a list at all, before any of it is acted on.
    if (listDepthAt(state) !== null) {
      // It is: a list item lifts to its parent list, and that is the whole of what outdenting means here.
      return outdentList()(state, dispatch);
    } else {
      // Not in a list: outdent the block itself below.
    }

    // The list has already returned above, so the trap toggleBlockquote documents - a bare lift going
    // out of an enclosing list before it reaches a blockquote - cannot be sprung here. A blockquote is
    // the only other wrapper a paragraph can be lifted out of, and lift refuses when there is none, so
    // asking after it by name would only be a second way of saying what lift already answers.
    return lift(state, dispatch);
  };
}
