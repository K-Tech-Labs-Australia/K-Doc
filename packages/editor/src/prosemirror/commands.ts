/**
 * @file commands.ts
 * @purpose Pure ProseMirror editing commands for K-Doc's WYSIWYG pane, implementing Word-parity formatting operations (FR-8.1 to FR-8.9).
 *   Every structural command tags its transaction with the kdocStructural meta to opt the edit out of undo coalescing in ProseMirrorBinding.
 *   These commands are pure functions over EditorState and Transaction, requiring no DOM, enabling direct headless Node testing.
 * @inputs ProseMirror EditorState instances, target mark/block identifiers, heading levels, list kinds, and optional dispatch callbacks.
 * @outputs ProseMirror Command functions returning booleans and dispatching tagged Transactions, along with mark/block activity predicates.
 * @functions
 *   - isMarkActive: Checks whether a given inline mark is active at the current selection or stored marks.
 *   - isBlockActive: Checks whether a given block node type (and optional attributes) is active in selection ancestors.
 *   - toggleKdocMark: Creates a command toggling a specific inline mark on the selection.
 *   - clearFormatting: Creates a command removing all schema marks from the selection range and tagging transaction structural.
 *   - setParagraph: Creates a command converting the active block into a standard paragraph.
 *   - setHeading: Creates a command converting the active block into a heading with clamped level 1..6.
 *   - setCodeBlock: Creates a command converting the active block into a code block.
 *   - toggleBlockquote: Creates a command toggling blockquote container wrapping around the selection.
 *   - toggleList: Creates a command toggling bullet or ordered list wrapping around the selection.
 *   - toggleTask: Creates a command toggling task item checkbox state on the nearest enclosing list item.
 *   - insertThematicBreak: Creates a command replacing selection with a horizontal rule separator.
 * @dataflow EditorState -> Command execution -> Transaction modification with kdocStructural meta -> dispatch callback.
 * @controlflow Resolve schema node/mark types -> verify applicability -> apply structural transform or mark toggle -> dispatch transaction.
 * @version 2
 * @date 2026-09-18
 */

import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { MarkType, NodeType, Schema, Attrs } from 'prosemirror-model';

// The last three are the Tier-4 constructs (`==x==`, `~x~`, `^x^`) rather than CommonMark or GFM,
// but they are ordinary ProseMirror marks here and toggle exactly like the others.
export type KdocMark =
  | 'strong'
  | 'emphasis'
  | 'strikethrough'
  | 'inlineCode'
  | 'highlight'
  | 'subscript'
  | 'superscript';
export type ListKind = 'bullet' | 'ordered';

/**
 * @purpose Resolves a MarkType by name from the given schema, returning null if the mark is absent.
 * @inputs
 *   - schema: Schema - The ProseMirror schema to look up within.
 *   - name: string - The mark type name to resolve.
 * @outputs MarkType | null - The resolved MarkType instance, or null if not found.
 * @dataflow schema.marks[name] lookup -> MarkType | null.
 * @controlflow Inspects schema.marks[name] -> returns MarkType if defined, null otherwise.
 */
function markType(schema: Schema, name: string): MarkType | null {
  const type = schema.marks[name];
  // Check if the mark type exists in the schema.
  // A command over a schema missing its type must simply not apply, because ProseMirror commands communicate
  // "cannot apply here" by returning false, and throwing from a keystroke handler would break the editor.
  if (type !== undefined) {
    // Mark type is present in schema: return resolved MarkType.
    return type;
  } else {
    // Mark type missing from schema: return null to indicate unavailability.
    return null;
  }
}

/**
 * @purpose Resolves a NodeType by name from the given schema, returning null if the node is absent.
 * @inputs
 *   - schema: Schema - The ProseMirror schema to look up within.
 *   - name: string - The node type name to resolve.
 * @outputs NodeType | null - The resolved NodeType instance, or null if not found.
 * @dataflow schema.nodes[name] lookup -> NodeType | null.
 * @controlflow Inspects schema.nodes[name] -> returns NodeType if defined, null otherwise.
 */
function nodeType(schema: Schema, name: string): NodeType | null {
  const type = schema.nodes[name];
  // Check if the node type exists in the schema.
  // A command over a schema missing its type must simply not apply, because ProseMirror commands communicate
  // "cannot apply here" by returning false, and throwing from a keystroke handler would break the editor.
  if (type !== undefined) {
    // Node type is present in schema: return resolved NodeType.
    return type;
  } else {
    // Node type missing from schema: return null to indicate unavailability.
    return null;
  }
}

/**
 * @purpose Tags a ProseMirror Transaction with the kdocStructural metadata flag so the session opts it out of undo coalescing.
 * @inputs tr: Transaction - The transaction to tag.
 * @outputs Transaction - The modified transaction with kdocStructural set to true.
 * @dataflow tr.setMeta('kdocStructural', true) -> returns tagged tr.
 * @controlflow Sets metadata key 'kdocStructural' to true on the transaction and returns it.
 */
function structural(tr: Transaction): Transaction {
  return tr.setMeta('kdocStructural', true);
}

/**
 * @purpose Wraps a ProseMirror command function so that any transaction dispatched by it is tagged with kdocStructural metadata.
 * @inputs command: Command - The base Command to wrap.
 * @outputs Command - A wrapped Command function that intercepts dispatch to tag transactions.
 * @dataflow Invokes command passing wrapped dispatch callback -> structural(tr) -> outer dispatch(tr).
 * @controlflow Checks if dispatch is provided -> if present, wraps dispatch to tag tr before forwarding; if absent, delegates dry run.
 */
function withStructuralMeta(command: Command): Command {
  // Wrapping the dispatch callback is how a tag is added to a command someone else wrote without modifying its internal logic.
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check if dispatch callback was provided by caller.
    if (dispatch !== undefined) {
      // Dispatch provided: intercept transaction, tag with structural meta, and forward to outer dispatch.
      return command(state, (tr: Transaction): void => {
        dispatch(structural(tr));
      });
    } else {
      // No dispatch provided (dry-run query): delegate directly without dispatch callback.
      return command(state, undefined);
    }
  };
}

/**
 * @purpose Checks whether a given K-Doc mark is active at the current editor selection.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state.
 *   - mark: KdocMark - The mark name to check ('strong', 'emphasis', 'strikethrough', 'inlineCode').
 * @outputs boolean - True if the mark is active at the selection; false otherwise.
 * @dataflow Resolves MarkType from schema -> checks storedMarks / $from.marks for empty selection or rangeHasMark for non-empty selection -> returns boolean.
 * @controlflow Resolve mark type (return false if null) -> check if selection is empty -> if empty, inspect storedMarks or $from.marks(); if non-empty, test doc.rangeHasMark(from, to, type).
 */
export function isMarkActive(state: EditorState, mark: KdocMark): boolean {
  const type = markType(state.schema, mark);
  // Check if the requested mark type exists in the schema.
  if (type === null) {
    // Mark type not found in schema: report inactive.
    return false;
  } else {
    // Mark type resolved: proceed to test selection.
  }

  const { selection } = state;
  // Check whether the editor selection is an empty cursor or a non-empty range.
  // The empty-selection case must consult storedMarks, because that is where a mark toggled with no
  // selection lives until the user types — without it the toolbar button would flicker off the instant it was pressed.
  if (selection.empty) {
    // Selection is empty: consult storedMarks if set, falling back to marks present at the cursor position ($from).
    const activeMarks = state.storedMarks ?? selection.$from.marks();
    return type.isInSet(activeMarks) !== undefined;
  } else {
    // Selection is a non-empty range: check if the mark spans across the selection range in the document.
    return state.doc.rangeHasMark(selection.from, selection.to, type);
  }
}

/**
 * @purpose Checks whether a given block node type and optional attribute filter is active in the selection ancestors.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state.
 *   - nodeName: string - The block node type name to check for.
 *   - attrs: Attrs | undefined - Optional dictionary of attribute key-value pairs that must all match.
 * @outputs boolean - True if a matching block node is active in the ancestor chain; false otherwise.
 * @dataflow Resolves NodeType from schema -> walks selection $from depth down to 0 -> compares node type and attrs -> returns boolean.
 * @controlflow Resolve node type (return false if null) -> iterate ancestor depth from $from.depth down to 0 -> test type and attrs match -> return true if matched, false after exhausted.
 */
export function isBlockActive(state: EditorState, nodeName: string, attrs?: Attrs): boolean {
  const type = nodeType(state.schema, nodeName);
  // Check if the target node type exists in the schema.
  if (type === null) {
    // Node type not found in schema: report inactive.
    return false;
  } else {
    // Node type resolved: proceed to walk selection ancestors.
  }

  const { $from } = state.selection;
  // Ancestors are walked rather than just checking the parent, because a paragraph inside a blockquote
  // inside a list item must still report the blockquote as active.
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    // Check if the ancestor node type matches the target node type.
    if (node.type === type) {
      // Check if attribute matching is required.
      if (attrs !== undefined) {
        // Attribute filter provided: check that every key in attrs matches node.attrs.
        let matches = true;
        for (const key of Object.keys(attrs)) {
          // Check if the node attribute matches the specified attribute value.
          if (node.attrs[key] !== attrs[key]) {
            // Attribute mismatch found: mark false and break attribute check loop.
            matches = false;
            break;
          } else {
            // Attribute value matches: continue checking remaining attributes.
          }
        }
        // Check if all specified attributes matched.
        if (matches) {
          // All attributes matched: report block active.
          return true;
        } else {
          // Attribute mismatch: continue walking outer ancestors.
        }
      } else {
        // No attributes specified: node type match alone is sufficient.
        return true;
      }
    } else {
      // Node type does not match: continue walking up the ancestor tree.
    }
  }

  return false;
}

/**
 * @purpose Creates a command that toggles a specific K-Doc inline mark on the current selection.
 * @inputs mark: KdocMark - The mark name to toggle ('strong', 'emphasis', 'strikethrough', 'inlineCode').
 * @outputs Command - A ProseMirror command returning false if mark is missing or not applicable, or toggling mark on dispatch.
 * @dataflow Evaluates state.schema for markType -> if found, delegates to toggleMark(type)(state, dispatch).
 * @controlflow Resolve mark type from state.schema -> if null, return false; otherwise invoke toggleMark(type).
 */
export function toggleKdocMark(mark: KdocMark): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = markType(state.schema, mark);
    // Check if the mark type exists in the schema.
    if (type === null) {
      // Mark type missing from schema: command cannot apply.
      return false;
    } else {
      // Mark type resolved: delegate execution to ProseMirror's standard toggleMark command.
      return toggleMark(type)(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that clears all inline marks across the active selection range.
 * @inputs void.
 * @outputs Command - A ProseMirror command that removes all marks from the selection and tags transaction structural.
 * @dataflow Inspects state.selection -> iterates state.schema.marks -> tr.removeMark() -> structural(tr) -> dispatch(tr).
 * @controlflow Check if selection is empty (return false if empty) -> if dispatch provided, remove all schema marks across [from, to], tag structural, and dispatch -> return true.
 */
export function clearFormatting(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { selection } = state;
    // Check if the selection is empty.
    // An empty selection has no range of text to clear formatting from, so the command cannot apply.
    if (selection.empty) {
      // Selection is empty: return false because there is nothing to clear.
      return false;
    } else {
      // Selection is a non-empty range: proceed with clearing formatting.
    }

    // Check if dispatch callback was provided.
    if (dispatch !== undefined) {
      const tr = state.tr;
      const { from, to } = selection;
      // Iterate over all marks configured in the document schema.
      for (const markName of Object.keys(state.schema.marks)) {
        const type = state.schema.marks[markName];
        // Check if mark type is defined on schema.
        if (type !== undefined) {
          // Remove mark type across the entire selection range.
          tr.removeMark(from, to, type);
        } else {
          // Undefined mark type entry: skip.
        }
      }
      // Tag transaction with kdocStructural metadata and dispatch.
      dispatch(structural(tr));
    } else {
      // Dry-run query: return true indicating clearFormatting can apply to non-empty selection.
    }

    return true;
  };
}

/**
 * @purpose Creates a command that converts the selected textblocks into standard paragraph blocks.
 * @inputs void.
 * @outputs Command - A ProseMirror command that sets block type to paragraph and tags transaction structural.
 * @dataflow Resolves paragraph NodeType -> delegates to withStructuralMeta(setBlockType(type)).
 * @controlflow Resolve paragraph node type (return false if null) -> execute withStructuralMeta(setBlockType).
 */
export function setParagraph(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'paragraph');
    // Check if paragraph node type exists in schema.
    if (type === null) {
      // Paragraph node type missing: cannot apply.
      return false;
    } else {
      // Delegate to setBlockType wrapped with structural metadata tagging.
      return withStructuralMeta(setBlockType(type))(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that sets, or clears, the alignment of every selected paragraph and heading (FR-8.11).
 * @inputs align - The alignment to apply, or null to clear it.
 * @outputs Command - A ProseMirror command reporting whether any block changed.
 * @dataflow selection range -> each paragraph/heading node -> tr.setNodeMarkup with the new align attribute.
 * @controlflow Walk the blocks the selection touches; skip anything that is not a paragraph or heading and anything
 *   already carrying this alignment; dispatch only when at least one block changed, and report false otherwise.
 */
export function setBlockAlignment(align: 'left' | 'center' | 'right' | null): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const tr = state.tr;
    let changed = false;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos): void => {
      // Check whether this node is a block K-Doc can align.
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        // Check whether it already carries this alignment, in which case there is nothing to write.
        if (node.attrs.align === align) {
          // Already aligned this way: leave it alone.
        } else {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
          changed = true;
        }
      } else {
        // Not a paragraph or heading: alignment does not apply to it.
      }
    });
    // Check whether anything changed; a command that changed nothing must report false so the caller can say so.
    if (!changed) {
      return false;
    } else {
      // Something changed: dispatch when a dispatcher was given, and report the change either way.
    }
    if (dispatch !== undefined) {
      dispatch(tr);
    } else {
      // No dispatcher: this was a can-it-run check.
    }
    return true;
  };
}

/**
 * @purpose Creates a command that converts the selected textblocks into a heading with the specified level.
 * @inputs level: number - The heading level (clamped to range 1..6).
 * @outputs Command - A ProseMirror command that sets block type to heading and tags transaction structural.
 * @dataflow Clamps level to 1..6 -> resolves heading NodeType -> delegates to withStructuralMeta(setBlockType(type, { level })).
 * @controlflow Resolve heading node type (return false if null) -> clamp level to 1..6 -> execute withStructuralMeta(setBlockType).
 */
export function setHeading(level: number): Command {
  const clampedLevel = Math.max(1, Math.min(6, Math.floor(level)));
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'heading');
    // Check if heading node type exists in schema.
    if (type === null) {
      // Heading node type missing: cannot apply.
      return false;
    } else {
      // Delegate to setBlockType with clamped heading level, wrapped with structural metadata tagging.
      return withStructuralMeta(setBlockType(type, { level: clampedLevel }))(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that converts the selected textblocks into a codeBlock.
 * @inputs void.
 * @outputs Command - A ProseMirror command that sets block type to codeBlock and tags transaction structural.
 * @dataflow Resolves codeBlock NodeType -> delegates to withStructuralMeta(setBlockType(type)).
 * @controlflow Resolve codeBlock node type (return false if null) -> execute withStructuralMeta(setBlockType).
 */
export function setCodeBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'codeBlock');
    // Check if codeBlock node type exists in schema.
    if (type === null) {
      // Code block node type missing: cannot apply.
      return false;
    } else {
      // Delegate to setBlockType wrapped with structural metadata tagging.
      return withStructuralMeta(setBlockType(type))(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that toggles blockquote wrapping around the current selection.
 * @inputs void.
 * @outputs Command - A ProseMirror command that lifts out of blockquote if active, or wraps in blockquote if not.
 * @dataflow Checks isBlockActive for 'blockquote' -> delegates to lift or wrapIn wrapped with structural metadata tagging.
 * @controlflow Resolve blockquote node type (return false if null) -> check if blockquote is active -> if active, execute lift; if inactive, execute wrapIn.
 */
export function toggleBlockquote(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'blockquote');
    // Check if blockquote node type exists in schema.
    if (type === null) {
      // Blockquote node type missing: cannot apply.
      return false;
    } else {
      // Blockquote node type resolved: proceed to toggle.
    }

    // Checking isBlockActive rather than chaining lift and wrapIn is required:
    // a plain chain would lift out of an enclosing list before it ever reached the blockquote,
    // which is a subtly wrong behaviour rather than an obviously broken one.
    if (isBlockActive(state, 'blockquote')) {
      // Blockquote is active: lift selection out of the enclosing blockquote container.
      return withStructuralMeta(lift)(state, dispatch);
    } else {
      // Blockquote is not active: wrap selection in a new blockquote node.
      return withStructuralMeta(wrapIn(type))(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that toggles bulletList or orderedList wrapping on the selection.
 * @inputs kind: ListKind - The list type to toggle ('bullet' | 'ordered').
 * @outputs Command - A ProseMirror command lifting list item if active or wrapping in list if inactive.
 * @dataflow Resolves listType and listItem NodeType -> checks isBlockActive -> delegates to withStructuralMeta(liftListItem / wrapInList).
 * @controlflow Resolve list and listItem node types (return false if either null) -> check isBlockActive(state, listName) -> if active, liftListItem; if inactive, wrapInList.
 */
export function toggleList(kind: ListKind): Command {
  // Determine schema node name corresponding to ListKind.
  const listName = kind === 'bullet' ? 'bulletList' : 'orderedList';
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const listType = nodeType(state.schema, listName);
    const itemType = nodeType(state.schema, 'listItem');

    // Check if both the list container and list item node types exist in the schema.
    if (listType === null || itemType === null) {
      // Either listType or itemType missing from schema: cannot apply.
      return false;
    } else {
      // Node types resolved: proceed to toggle list structure.
    }

    // Check whether the target list type is currently active in the selection ancestors.
    if (isBlockActive(state, listName)) {
      // Target list is active: lift the enclosing list item out of the list.
      return withStructuralMeta(liftListItem(itemType))(state, dispatch);
    } else {
      // Target list is not active: wrap the selection in the target list type.
      return withStructuralMeta(wrapInList(listType))(state, dispatch);
    }
  };
}

/**
 * @purpose Creates a command that toggles a task item checkbox on the nearest enclosing list item.
 * @inputs void.
 * @outputs Command - A ProseMirror command that flips listItem checked attribute and tags transaction structural.
 * @dataflow Finds enclosing listItem ancestor depth -> flips checked attr (null <-> false) -> tr.setNodeMarkup -> structural(tr) -> dispatch(tr).
 * @controlflow Walk $from ancestors for listItem depth (return false if not found) -> compute next checked state -> if dispatch provided, apply setNodeMarkup and tag structural -> return true.
 */
export function toggleTask(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const itemType = nodeType(state.schema, 'listItem');
    // Check if listItem node type exists in schema.
    if (itemType === null) {
      // ListItem node type missing: cannot apply.
      return false;
    } else {
      // ListItem node type resolved: proceed to inspect selection ancestors.
    }

    const { $from } = state.selection;
    let listItemDepth: number | null = null;
    // Walk from $from.depth upward to find the nearest enclosing listItem node.
    for (let depth = $from.depth; depth > 0; depth--) {
      // Check if ancestor at depth matches listItem node type.
      if ($from.node(depth).type === itemType) {
        // Nearest enclosing listItem found: record depth and stop searching.
        listItemDepth = depth;
        break;
      } else {
        // Not a listItem: continue search upward.
      }
    }

    // Check if an enclosing listItem was found.
    if (listItemDepth === null) {
      // Not inside a list item: command cannot apply.
      return false;
    } else {
      // Enclosing list item found: proceed to toggle task checked attribute.
    }

    const targetNode = $from.node(listItemDepth);
    // Check if the listItem currently has a boolean checked attribute (task item) or null (ordinary bullet).
    // The three states — null, false, true — are exactly what the mdast round-trip preserves, so
    // toggling between null and false is what turns a bullet into a task and back.
    let nextChecked: boolean | null;
    if (typeof targetNode.attrs.checked === 'boolean') {
      // Currently a task item (checked: true or false): revert to plain bullet (checked: null).
      nextChecked = null;
    } else {
      // Currently a plain bullet (checked: null): convert to unchecked task item (checked: false).
      nextChecked = false;
    }

    // Check if dispatch callback was provided.
    if (dispatch !== undefined) {
      const pos = $from.before(listItemDepth);
      const tr = state.tr;
      tr.setNodeMarkup(pos, undefined, { ...targetNode.attrs, checked: nextChecked });
      dispatch(structural(tr));
    } else {
      // Dry-run query: return true indicating toggleTask can apply to this list item.
    }

    return true;
  };
}

/**
 * @purpose Creates a command that replaces the current selection with a thematicBreak (horizontal rule) node.
 * @inputs void.
 * @outputs Command - A ProseMirror command inserting a thematicBreak node and tagging the transaction structural.
 * @dataflow Resolves thematicBreak NodeType -> tr.replaceSelectionWith(type.create()) -> structural(tr) -> dispatch(tr).
 * @controlflow Resolve thematicBreak node type (return false if null) -> if dispatch provided, replace selection with thematicBreak node, tag structural, and dispatch -> return true.
 */
export function insertThematicBreak(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'thematicBreak');
    // Check if thematicBreak node type exists in schema.
    if (type === null) {
      // ThematicBreak node type missing: command cannot apply.
      return false;
    } else {
      // ThematicBreak node type resolved: proceed to insert.
    }

    // Check if dispatch callback was provided.
    if (dispatch !== undefined) {
      const tr = state.tr;
      tr.replaceSelectionWith(type.create());
      dispatch(structural(tr));
    } else {
      // Dry-run query: return true indicating thematicBreak can be inserted.
    }

    return true;
  };
}
