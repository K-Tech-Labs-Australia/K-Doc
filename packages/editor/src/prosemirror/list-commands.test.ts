/**
 * @file list-commands.test.ts
 * @purpose Vitest test suite for FR-8.6's list editing commands and depth queries (list-commands.ts).
 * @inputs ProseMirror EditorState instances initialized with kdocSchema, text strings, and target nesting levels.
 * @outputs Vitest assertions verifying indent/outdent operations, listDepthAt queries, and applyListScheme transformations.
 * @functions
 *   - paragraphDoc: Constructs a document containing one paragraph block per provided string argument.
 *   - bulletDoc: Constructs a document containing a bulletList with one listItem per provided string argument.
 *   - stateAt: Constructs an EditorState with caret positioned inside the text node matching the target string.
 *   - runOn: Executes a command against an EditorState and applies every dispatched transaction sequentially.
 * @dataflow Fixture documents -> stateAt -> indentList / outdentList / listDepthAt / applyListScheme -> runOn -> Vitest expect assertions.
 * @controlflow Test list indent and outdent -> test listDepthAt depth queries -> test applyListScheme scheme application and nesting.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { kdocSchema } from './schema.js';
import {
  indentList,
  outdentList,
  listDepthAt,
  applyListScheme,
  joinListWithPrevious,
} from './list-commands.js';

/**
 * Constructs a ProseMirror document containing one paragraph block per provided text string.
 *
 * @purpose Builds a doc node containing paragraph children for test fixtures.
 * @inputs texts: readonly string[] - List of text strings to populate inside paragraphs.
 * @outputs ProseMirrorNode - The constructed root doc node.
 * @dataflow texts -> kdocSchema.text / kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Iterate over texts -> construct paragraph for each -> wrap all in root doc node -> return doc.
 */
function paragraphDoc(...texts: readonly string[]): ProseMirrorNode {
  const paragraphs: ProseMirrorNode[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    // Check if text entry is defined under strict indexing.
    if (text !== undefined) {
      // Check if the text string is empty.
      if (text.length === 0) {
        // Empty string: construct empty paragraph block.
        paragraphs.push(kdocSchema.node('paragraph', null, []));
      } else {
        // Non-empty string: construct paragraph containing text leaf node.
        paragraphs.push(kdocSchema.node('paragraph', null, [kdocSchema.text(text)]));
      }
    } else {
      // Undefined text element: skip.
    }
  }

  // Check if any paragraphs were constructed.
  if (paragraphs.length === 0) {
    // Empty arguments: construct default document with a single empty paragraph.
    paragraphs.push(kdocSchema.node('paragraph', null, []));
  } else {
    // Paragraphs populated from arguments.
  }

  return kdocSchema.node('doc', null, paragraphs);
}

/**
 * Constructs a ProseMirror document containing a bullet list with one item per provided string.
 *
 * @purpose Builds a doc node containing a bulletList and listItems for test fixtures.
 * @inputs items: readonly string[] - List of text strings for each list item.
 * @outputs ProseMirrorNode - The constructed root doc node.
 * @dataflow items -> kdocSchema.text -> paragraph -> listItem -> bulletList -> doc.
 * @controlflow Iterate over items -> build paragraph and listItem for each -> wrap in bulletList -> wrap in doc.
 */
function bulletDoc(...items: readonly string[]): ProseMirrorNode {
  const listItems: ProseMirrorNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Check if item entry is defined under strict indexing.
    if (item !== undefined) {
      const pChildren: ProseMirrorNode[] = [];
      // Check if the item string is empty.
      if (item.length === 0) {
        // Empty string: construct empty paragraph children.
      } else {
        // Non-empty string: construct text leaf node.
        pChildren.push(kdocSchema.text(item));
      }
      const para = kdocSchema.node('paragraph', null, pChildren);
      listItems.push(kdocSchema.node('listItem', null, [para]));
    } else {
      // Undefined item element: skip.
    }
  }

  // Check if any list items were constructed.
  if (listItems.length === 0) {
    // Empty arguments: construct default bullet list with a single empty item.
    listItems.push(
      kdocSchema.node('listItem', null, [
        kdocSchema.node('paragraph', null, []),
      ]),
    );
  } else {
    // Items populated from arguments.
  }

  const bulletList = kdocSchema.node('bulletList', null, listItems);
  return kdocSchema.node('doc', null, [bulletList]);
}

/**
 * Creates an EditorState positioned inside the text node matching the target text.
 *
 * @purpose Resolves text position and builds an EditorState with selection inside the matched text node.
 * @inputs
 *   - doc: ProseMirrorNode - The root document node to search within.
 *   - textToFind: string - Target text content to locate.
 * @outputs EditorState - Configured EditorState with caret placed at pos + 1.
 * @dataflow doc.descendants -> locate matching text pos -> TextSelection.create -> EditorState.create.
 * @controlflow Walk descendants -> match node.isText and node.text === textToFind -> record pos -> if found, return EditorState; else throw Error.
 */
function stateAt(doc: ProseMirrorNode, textToFind: string): EditorState {
  let foundPos: number | null = null;
  doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // Check if the current node is a text node matching the requested text string.
    if (node.isText && node.text === textToFind) {
      // Matching text node found: record its start position and stop descendant traversal.
      foundPos = pos;
      return false;
    } else {
      // Node is not the target text node: continue traversing descendants.
      return true;
    }
  });

  // Check if the target text was found within the document descendants.
  if (foundPos === null) {
    // Target text was not found in the document: fail fast with an error.
    throw new Error(`Text "${textToFind}" not found in document`);
  } else {
    // Target text located: pos is the text node's own position and + 1 puts the
    // caret one character in, inside the node rather than at its boundary.
    const selection = TextSelection.create(doc, foundPos + 1);
    return EditorState.create({
      doc,
      selection,
      schema: kdocSchema,
    });
  }
}

/**
 * Executes a ProseMirror command against an EditorState, accumulating all dispatched transactions.
 *
 * @purpose Runs a command and applies every dispatched transaction sequentially to produce the next state.
 * @inputs
 *   - state: EditorState - The initial EditorState before command execution.
 *   - command: (s: EditorState, d?: (tr: Transaction) => void) => boolean - The ProseMirror command to execute.
 * @outputs EditorState - The resulting EditorState after applying all dispatched transactions.
 * @dataflow state -> command execution with dispatch callback -> current.apply(tr) on each transaction -> final EditorState.
 * @controlflow Initialize current to state -> execute command with dispatch callback -> apply each dispatched tr to current -> return current.
 */
function runOn(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
): EditorState {
  // Keep current state and apply every dispatched transaction sequentially, not just
  // the last one, because applyListScheme dispatches one transaction per nesting level.
  let current = state;
  command(current, (tr: Transaction): void => {
    current = current.apply(tr);
  });
  return current;
}

describe('list indent and outdent', () => {
  it('refuses to indent the first item of a list', () => {
    // An item with no sibling above it has nothing to nest under, which is what makes
    // the toolbar button disable itself there.
    const doc = bulletDoc('one', 'two');
    const state = stateAt(doc, 'one');
    const canIndent = indentList()(state);
    expect(canIndent).toBe(false);
  });

  it('nests the second item under the first item when indented', () => {
    const doc = bulletDoc('one', 'two');
    const state = stateAt(doc, 'two');
    const next = runOn(state, indentList());
    expect(listDepthAt(next)).toBe(2);
    expect(next.doc.childCount).toBe(1);
  });

  it('undoes nesting when outdenting an indented item', () => {
    const doc = bulletDoc('one', 'two');
    const state = stateAt(doc, 'two');
    const indented = runOn(state, indentList());
    const next = runOn(indented, outdentList());
    expect(listDepthAt(next)).toBe(1);
  });

  it('lifts a level-1 item out of the list entirely when outdented', () => {
    const doc = bulletDoc('one');
    const state = stateAt(doc, 'one');
    const next = runOn(state, outdentList());
    expect(listDepthAt(next)).toBeNull();
  });

  it('refuses to indent outside a list', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    const canIndent = indentList()(state);
    expect(canIndent).toBe(false);
  });

  it('refuses to outdent outside a list', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    const canOutdent = outdentList()(state);
    expect(canOutdent).toBe(false);
  });
});

describe('listDepthAt', () => {
  it('returns null in a paragraph', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    expect(listDepthAt(state)).toBeNull();
  });

  it('returns 1 at the top level of a list', () => {
    const doc = bulletDoc('item');
    const state = stateAt(doc, 'item');
    expect(listDepthAt(state)).toBe(1);
  });

  it('distinguishes between not in a list and level 1 depth', () => {
    // A picker has to tell "not in a list" from "level 1", so the two must not collapse to one value.
    const paragraphState = stateAt(paragraphDoc('plain'), 'plain');
    const listState = stateAt(bulletDoc('item'), 'item');
    expect(listDepthAt(paragraphState)).toBeNull();
    expect(listDepthAt(listState)).toBe(1);
  });
});

describe('applyListScheme', () => {
  it('turns a paragraph into a bullet list at level 1', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    const next = runOn(state, applyListScheme('bullet', 1));
    expect(listDepthAt(next)).toBe(1);
    expect(next.doc.child(0).type.name).toBe('bulletList');
  });

  it('turns a paragraph into an ordered list', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    const next = runOn(state, applyListScheme('ordered', 1));
    expect(next.doc.child(0).type.name).toBe('orderedList');
    // An ordered list is as much a list as a bullet one: the depth query has to count both, or a
    // numbered list would look to the gallery like no list at all.
    expect(listDepthAt(next)).toBe(1);
  });

  it('makes a task item', () => {
    // A task item carries a checkbox state; a plain item's is null.
    const doc = paragraphDoc('alpha');
    const state = stateAt(doc, 'alpha');
    const next = runOn(state, applyListScheme('task', 1));

    let firstChild: ProseMirrorNode | null = null;
    // Check if the document contains at least one child node.
    if (next.doc.childCount > 0) {
      // Document has children: resolve the first child node.
      firstChild = next.doc.child(0);
    } else {
      // Document has no child nodes: keep firstChild as null.
    }

    // Guard that the document child and item node exist before inspecting attributes.
    if (firstChild !== null && firstChild.childCount > 0) {
      const listItem = firstChild.child(0);
      expect(listItem.attrs['checked']).not.toBeNull();
    } else {
      // Structure missing expected list item node.
      expect.fail('Expected document to contain a list with at least one item');
    }
  });

  it('nests to the level asked for across sequential applications', () => {
    // Each nesting step has to see the document the previous one produced, which is what the
    // command's transaction capture is for, and this case is what fails if it re-used the original state.
    const doc = paragraphDoc('one', 'two');
    const stateOne = stateAt(doc, 'one');
    const nextOne = runOn(stateOne, applyListScheme('bullet', 1));
    const stateTwo = stateAt(nextOne.doc, 'two');
    const nextTwo = runOn(stateTwo, applyListScheme('bullet', 2));
    expect(listDepthAt(nextTwo)).toBe(2);
  });

  it('refuses level 0', () => {
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    const canApply = applyListScheme('bullet', 0)(state);
    expect(canApply).toBe(false);
  });

  it('stops where it can when asked to nest deeper than possible', () => {
    // Stopping short is right: refusing the whole command would leave the user with no list at all.
    // A lone first item has nothing to nest under, so it stops at depth 1.
    const doc = paragraphDoc('solo');
    const state = stateAt(doc, 'solo');
    const command = applyListScheme('bullet', 5);
    let next = state;
    const success = command(state, (tr: Transaction): void => {
      next = next.apply(tr);
    });
    expect(success).toBe(true);
    expect(listDepthAt(next)).toBe(1);
  });

  it('refuses a block that cannot become a list', () => {
    // A dry run has to answer truthfully, not just cheaply. A table cell holds inline content and
    // nothing else, so there is no list to put in one -- and the gallery's button has to grey out
    // there rather than offer a change it cannot make.
    const cell = (text: string): ProseMirrorNode =>
      kdocSchema.node('tableRow', null, [
        kdocSchema.node('tableCell', null, [kdocSchema.text(text)]),
      ]);
    const doc = kdocSchema.node('doc', null, [
      kdocSchema.node('table', { align: [] }, [cell('head'), cell('body')]),
    ]);
    const state = stateAt(doc, 'body');
    expect(applyListScheme('bullet', 1)(state)).toBe(false);
  });

  it('joins the list holding the caret, not one further out', () => {
    // The list that has to gain a sibling is the one directly holding the caret's item. Joining an
    // outer list would merge two lists above while leaving that item exactly as unnestable.
    // Here the two top-level lists could be joined, but doing so is the wrong edit.
    const sub = (text: string): ProseMirrorNode =>
      kdocSchema.node('bulletList', null, [
        kdocSchema.node('listItem', null, [
          kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
        ]),
      ]);
    const outer = (lead: string, nested: string): ProseMirrorNode =>
      kdocSchema.node('bulletList', null, [
        kdocSchema.node('listItem', null, [
          kdocSchema.node('paragraph', null, [kdocSchema.text(lead)]),
          sub(nested),
        ]),
      ]);
    const doc = kdocSchema.node('doc', null, [outer('a', 'x'), outer('b', 'y')]);
    const state = stateAt(doc, 'y');

    // The caret's own list is the sublist under 'b', whose only neighbour is a paragraph, so there
    // is nothing to join. A join here would be the outer one, and the document would silently gain
    // a merge the user never asked for.
    const next = runOn(state, joinListWithPrevious());
    expect(joinListWithPrevious()(state)).toBe(false);
    expect(next.doc.childCount).toBe(2);
  });

  it('answers dry runs without dispatching transactions', () => {
    // A dry run asks only whether the scheme can be applied, since the nesting
    // depends on a document that does not exist yet.
    const doc = paragraphDoc('plain');
    const state = stateAt(doc, 'plain');
    let dispatches = 0;
    const dryRunResult = applyListScheme('bullet', 3)(state);
    expect(dryRunResult).toBe(true);
    expect(dispatches).toBe(0);

    const dispatchResult = applyListScheme('bullet', 3)(state, (_tr: Transaction): void => {
      dispatches++;
    });
    expect(dispatchResult).toBe(true);
    expect(dispatches).toBeGreaterThan(0);
  });
});
