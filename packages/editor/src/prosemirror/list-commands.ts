/**
 * @file list-commands.ts
 * @purpose Pure ProseMirror list editing commands and depth queries for K-Doc's WYSIWYG pane (FR-8.6).
 *
 *   Indent and outdent already existed as Tab and Shift-Tab bindings in the keymap, and only there. A
 *   binding is not a command: it cannot be put on a toolbar, offered in the command palette, or asked whether it
 *   applies right now, and a list operation that only a key can reach is one a user who does not know the key
 *   cannot reach at all. These wrap the same prosemirror-schema-list primitives so there is one behaviour with
 *   two ways in, not two behaviours.
 *
 *   `toggleList('bullet')` on a paragraph that follows an existing bullet list produces a **second, adjacent**
 *   bullet list rather than adding an item to the one above. `sinkListItem` then correctly refuses, because the
 *   new item is the first item of its own list and has nothing to nest under — so `applyListScheme(scheme, 2)`
 *   silently produced a level-1 list. Two adjacent lists of one type are also not something GFM can express
 *   distinctly: it renders them as a single list, so the document already disagreed with what the user saw.
 *
 *   The depth query exists because a multi-level list picker has to show the user which level they are on;
 *   without it the picker would be a list picker that cannot tell one level from another.
 *
 * @inputs ProseMirror EditorState instances, ListScheme identifiers ('bullet' | 'ordered' | 'task'), nesting level numbers, and optional dispatch callbacks.
 * @outputs ProseMirror Command functions for list indent/outdent/scheme application, and listDepthAt query returning nesting level or null.
 * @functions
 *   - indentList: Creates a command that indents (sinks) the active list item deeper into a sublist.
 *   - outdentList: Creates a command that outdents (lifts) the active list item to its parent list or root.
 *   - listDepthAt: Reports how many list levels enclose the caret, or null when the caret is not in a list.
 *   - applyListScheme: Turns the block under the caret into a list of the given kind and nests it to the given level.
 *   - joinListWithPrevious: Creates a command that merges the list containing the caret into an identical list immediately above it.
 * @dataflow EditorState -> list structure analysis / transaction generation via prosemirror-schema-list -> dispatch callback.
 * @controlflow Validate list item types in schema -> verify applicability / calculate depth -> apply structural transactions -> dispatch.
 * @version 2
 * @date 2026-09-11
 */

import { canJoin } from 'prosemirror-transform';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { kdocSchema } from './schema.js';
import { toggleList, toggleTask } from './commands.js';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { NodeType } from 'prosemirror-model';

export type ListScheme = 'bullet' | 'ordered' | 'task';

/**
 * Resolves the listItem NodeType from the canonical K-Doc schema.
 * Note: The schema may not carry lists in minimal or specialized configurations, in which case this returns undefined.
 */
function listItemTypeOf(): NodeType | undefined {
  return kdocSchema.nodes['listItem'];
}

/**
 * Creates a command that indents (sinks) the active list item by one level.
 *
 * @purpose Indents the current list item deeper into a sublist under its preceding sibling (FR-8.6).
 * @inputs None.
 * @outputs Command - A ProseMirror command returning boolean applicability and dispatching indentation.
 * @dataflow listItemTypeOf() -> sinkListItem(type)(state, dispatch) -> boolean.
 * @controlflow Resolve listItem type -> guard undefined (return false) -> execute sinkListItem(type).
 */
export function indentList(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = listItemTypeOf();
    // Check if the listItem node type exists in the schema.
    if (type === undefined) {
      // Schema without list items has no indenting to do: return false.
      return false;
    } else {
      // listItem node type is present: delegate to sinkListItem.
      // sinkListItem refuses on the first item of a list, because an item with no sibling above
      // it has nothing to nest under — which is what makes the toolbar button correctly disable itself there.
      return sinkListItem(type)(state, dispatch);
    }
  };
}

/**
 * Creates a command that outdents (lifts) the active list item by one level.
 *
 * @purpose Outdents the current list item to its parent list or lifts it out of the list (FR-8.6).
 * @inputs None.
 * @outputs Command - A ProseMirror command returning boolean applicability and dispatching outdentation.
 * @dataflow listItemTypeOf() -> liftListItem(type)(state, dispatch) -> boolean.
 * @controlflow Resolve listItem type -> guard undefined (return false) -> execute liftListItem(type).
 */
export function outdentList(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = listItemTypeOf();
    // Check if the listItem node type exists in the schema.
    if (type === undefined) {
      // Schema without list items has no outdenting to do: return false.
      return false;
    } else {
      // listItem node type is present: delegate to liftListItem to outdent the item.
      return liftListItem(type)(state, dispatch);
    }
  };
}

/**
 * Reports the nesting depth of the list enclosing the caret, or null if outside any list.
 *
 * @purpose Reports how many list levels enclose the caret, or null when the caret is not in a list.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs number | null - The integer list nesting level (1-based), or null if the caret is not in a list.
 * @dataflow state.selection.$from -> walk ancestor depths -> count bulletList / orderedList nodes -> number | null.
 * @controlflow Traverse ancestor depths from $from.depth down to 1 -> if node is bulletList or orderedList, increment count -> if count === 0 return null else return count.
 */
export function listDepthAt(state: EditorState): number | null {
  const { $from } = state.selection;
  let count = 0;

  // Walk upward through ancestor depths from the caret position towards the root.
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    // Check if the ancestor node at depth d is an enclosing bullet or ordered list container.
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      // Node is a list container: increment the nesting level count.
      count++;
    } else {
      // Node is not a list container: continue checking outer ancestors.
    }
  }

  // Check if any enclosing list containers were encountered.
  if (count === 0) {
    // The caret is not in a list at all, which is a different answer from "level 0" and the picker has to be able to tell them apart: return null.
    return null;
  } else {
    // Caret is enclosed by at least one list container: return the 1-based nesting depth count.
    return count;
  }
}

/**
 * Merges the list containing the caret into an identical list immediately above it.
 *
 * @purpose Merges the list containing the caret into an identical list immediately above it, so a freshly made item has a sibling to nest under.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state.
 *   - dispatch: ((tr: Transaction) => void) | undefined - Optional transaction dispatch callback.
 * @outputs boolean - True if the list can be (or was) joined with a preceding list; false otherwise.
 * @dataflow state.selection.$from -> resolve outermost enclosing list depth -> check boundary canJoin -> dispatch(tr.join(before)) -> boolean.
 * @controlflow Walk outward from $from.depth to 1 to find outermost list -> guard listDepth < 0 (return false) -> resolve before position -> guard !canJoin(state.doc, before) (return false) -> if dispatch === undefined return true; else dispatch tr.join(before) and return true.
 */
function joinWithPrecedingList(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const $from = state.selection.$from;
  let listDepth = -1;

  // Walk outward from the caret to the *innermost* enclosing list, and stop there. The list that
  // has to gain a sibling is the one directly holding the caret's item; joining an outer list
  // would merge two lists somewhere above while leaving that item exactly as unnestable as before.
  for (let d = $from.depth; d > 0; d--) {
    // Check if the ancestor node at depth d is a bullet list or ordered list container.
    if ($from.node(d).type.name === 'bulletList' || $from.node(d).type.name === 'orderedList') {
      // The first list found walking outward is the innermost one: record it and stop.
      listDepth = d;
      break;
    } else {
      // Ancestor is not a list container: continue checking outer ancestors.
    }
  }

  // Check if the caret is enclosed in any list.
  if (listDepth < 0) {
    // The caret is not in a list, so there is nothing to join: return false.
    return false;
  } else {
    // Caret is enclosed in a list: proceed to resolve the boundary position.
  }

  // A join happens at the boundary between two nodes, and before is that boundary.
  const before = $from.before(listDepth);

  // Check whether the preceding node can join with the list at the boundary.
  // canJoin is what decides whether the two neighbours are the same type and may merge;
  // asking it is cheaper and safer than inspecting the sibling ourselves, and it refuses
  // when the list above is of the other kind — a numbered list must not absorb a bullet one.
  if (!canJoin(state.doc, before)) {
    // Neighbouring nodes cannot be joined: return false.
    return false;
  } else {
    // Neighbouring nodes are compatible lists and can be joined: proceed.
  }

  // Check if dispatch callback was provided (execution) or omitted (dry-run query).
  if (dispatch === undefined) {
    // Dry-run query: join is possible, return true without dispatching.
    return true;
  } else {
    // Dispatch callback provided: dispatch join transaction and return true.
    dispatch(state.tr.join(before));
    return true;
  }
}

/**
 * Creates a command that merges the list containing the caret into an identical list immediately above it.
 *
 * @purpose A user who has two adjacent lists the format cannot tell apart needs a way to say so explicitly.
 * @inputs None.
 * @outputs Command - A ProseMirror command returning boolean applicability and dispatching the list join.
 * @dataflow EditorState -> joinWithPrecedingList(state, dispatch) -> boolean.
 * @controlflow Return command function -> check if dispatch is undefined -> if dry-run, invoke joinWithPrecedingList without dispatch -> else invoke joinWithPrecedingList with dispatch.
 */
export function joinListWithPrevious(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check if dispatch callback is undefined (dry-run query).
    if (dispatch === undefined) {
      // Dry-run query: test applicability without dispatching transactions.
      return joinWithPrecedingList(state, undefined);
    } else {
      // Dispatch callback provided: execute list join via joinWithPrecedingList.
      return joinWithPrecedingList(state, dispatch);
    }
  };
}

/**
 * Creates a command that turns the block under the caret into a list of the given scheme and nests it to the given level.
 *
 * @purpose Turns the block under the caret into a list of the given kind and nests it to the given level.
 * @inputs
 *   - scheme: ListScheme - The target list scheme ('bullet' | 'ordered' | 'task').
 *   - level: number - The 1-based target list nesting level.
 * @outputs Command - A ProseMirror command applying the scheme and nesting level.
 * @dataflow EditorState -> base list command -> capture dispatched Transaction -> loop indentList -> dispatch each nesting step.
 * @controlflow Guard level < 1 -> select base command -> guard dry run -> run base with capture -> guard base success -> loop indentList up to level -> return true.
 */
export function applyListScheme(scheme: ListScheme, level: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check if the target nesting level is less than 1.
    // Level 1 is the outermost list, and there is no level 0 list to make.
    if (level < 1) {
      // Target level is invalid: command cannot apply.
      return false;
    } else {
      // Valid target level: proceed to select base command.
    }

    // Select the base command corresponding to the requested list scheme.
    let base: Command;
    // Check if the scheme is bullet list.
    if (scheme === 'bullet') {
      // Scheme is 'bullet': select toggleList for bullet lists.
      base = toggleList('bullet');
    } else if (scheme === 'ordered') {
      // Scheme is 'ordered': select toggleList for ordered lists.
      base = toggleList('ordered');
    } else {
      // Scheme is 'task': select toggleTask for GFM task lists.
      base = toggleTask();
    }

    // Check if dispatch callback is undefined (dry-run query).
    // A dry run asks only whether the scheme can be applied at all, since the nesting that follows
    // depends on a document that does not exist yet.
    if (dispatch === undefined) {
      // Dry-run query: return applicability of base command directly.
      return base(state);
    } else {
      // Dispatch callback is provided: execute base command with transaction capture and nesting.
    }

    let latest: Transaction | null = null;
    const capture = (tr: Transaction): void => {
      latest = tr;
      dispatch(tr);
    };

    // Run the base command using the capturing dispatch wrapper.
    const baseSuccess = base(state, capture);
    // Check if the base command succeeded.
    if (!baseSuccess) {
      // Base command failed: the block cannot become a list, so return false without attempting to nest.
      return false;
    } else {
      // Base command succeeded: proceed to nesting.
    }

    // Check if the base command dispatched any transaction.
    if (latest === null) {
      // The command reported success but dispatched nothing, so there is nothing to nest: return true.
      return true;
    } else {
      // Base transaction was captured: proceed to nesting loop.
    }

    // Each sinkListItem has to see the document the previous one produced, which is why
    // the transactions are captured and re-applied locally rather than read back from a
    // view this module does not have.
    let current: EditorState = state.apply(latest);

    // A freshly made list sits beside the one above rather than inside it, and an item that is the first
    // of its own list has nothing to nest under. Joining them first is what makes the nesting below
    // possible at all -- and it is right on its own terms, since GFM renders two adjacent lists of one
    // kind as a single list, so the document disagreed with what the user saw.
    const joined = joinWithPrecedingList(current, capture);
    // Check whether a join actually happened.
    if (joined) {
      // A join was dispatched: advance the local state onto the document it produced.
      // latest is reassigned by capture, so after a successful join it already holds the join
      // transaction — that is why current.apply(latest) is correct here.
      current = current.apply(latest);
    } else {
      // Nothing above to join to; the list stands on its own.
    }

    for (let i = 1; i < level; i++) {
      const indentSuccess = indentList()(current, capture);
      // Check if indentList succeeded for the current nesting step.
      if (!indentSuccess) {
        // A list that cannot nest any further stops where it is rather than failing the whole command.
        break;
      } else {
        // Indent succeeded: re-apply the latest transaction to advance local current state.
        if (latest !== null) {
          current = current.apply(latest);
        } else {
          // Transaction unexpectedly null: break nesting loop.
          break;
        }
      }
    }

    return true;
  };
}
