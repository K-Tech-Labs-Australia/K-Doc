/**
 * @file indent-commands.test.ts
 * @purpose Exercises the two indentation commands from indent-commands.ts, asserting applicability and resulting document structure for nesting list items, wrapping paragraphs in blockquotes, and reversing both.
 * @inputs ProseMirror EditorState instances built by stateAt from documents produced by para/item/bulletDoc/paragraphDoc/quoteDoc; Command factories from indentBlock/outdentBlock.
 * @outputs Boolean applicability assertions and node-count tallies via counts over the resulting document after each command runs through runOn, plus dry-run checks that dispatch is optional.
 * @functions
 *   - para: Build a paragraph node from text (empty string yields an empty paragraph).
 *   - item: Wrap text in a listItem containing one paragraph.
 *   - bulletDoc: Build a doc of a single bulletList over the given texts.
 *   - paragraphDoc: Build a doc of consecutive paragraphs, one per input text.
 *   - quoteDoc: Build a doc with one blockquote wrapping a single paragraph.
 *   - stateAt: Locate a text node's position and wrap its document in an EditorState whose caret sits just past it.
 *   - runOn: Apply a command to a state, capturing applicability and the resulting state via a dispatch callback.
 *   - counts: Tally nodes of one type across a whole document.
 * @dataflow Helper builders -> doc node -> stateAt finds position -> EditorState -> runOn runs Command with a dispatch that folds each transaction into next -> assertions read applied and counts(next.doc).
 * @controlflow File header groups helpers first, then two describe blocks (indentBlock then outdentBlock); each it builds input, invokes the command through runOn or directly for dry runs, and asserts applicability plus node tallies.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Command, Transaction } from 'prosemirror-state';
import { kdocSchema } from './schema.js';
import { indentBlock, outdentBlock } from './indent-commands.js';

/**
 * Build a paragraph node holding the given text.
 *
 * @purpose Construct a schema paragraph whose single child is either one text node or none for empty input.
 * @inputs text - The string to place inside the paragraph; an empty string yields no text child.
 * @outputs ProseMirrorNode - A paragraph node ready to nest under list items, blockquotes, or as doc children.
 * @dataflow Input string -> length check -> one [text] array or [] -> kdocSchema.node('paragraph', null, ...).
 * @controlflow Evaluate text.length once; the ternary selects a single branch so no else is needed.
 */
function para(text: string): ProseMirrorNode {
  // Empty input yields an empty paragraph (no child); non-empty wraps exactly one text node.
  return kdocSchema.node('paragraph', null, text.length === 0 ? [] : [kdocSchema.text(text)]);
}

/**
 * Build a listItem node holding the given text in one paragraph.
 *
 * @purpose Construct a schema listItem whose single child is a paragraph over the input string.
 * @inputs text - The string placed inside the item's paragraph, itself built by para.
 * @outputs ProseMirrorNode - A listItem node ready to be collected into a bulletList or nested deeper.
 * @dataflow Input string -> para(text) -> [paragraph] array -> kdocSchema.node('listItem', null, ...).
 * @controlflow Single delegation step with no branching; the item is always one paragraph deep at creation.
 */
function item(text: string): ProseMirrorNode {
  return kdocSchema.node('listItem', null, [para(text)]);
}

/**
 * Build a doc containing a single bulletList over the given texts.
 *
 * @purpose Construct a top-level document whose only child is one unordered list of items.
 * @inputs texts - Ordered strings; each becomes one listItem inside the shared bulletList.
 * @outputs ProseMirrorNode - A doc node wrapping [bulletList] for indent/outdent tests on lists.
 * @dataflow Texts array -> map to item nodes -> single bulletList -> doc wraps that list in a one-element child array.
 * @controlflow One mapping pass with no branching; every input text lands as a sibling item at the same depth.
 */
function bulletDoc(...texts: readonly string[]): ProseMirrorNode {
  return kdocSchema.node('doc', null, [
    kdocSchema.node('bulletList', null, texts.map((t: string): ProseMirrorNode => item(t))),
  ]);
}

/**
 * Build a doc containing one paragraph per given text.
 *
 * @purpose Construct a top-level document of consecutive sibling paragraphs for blockquote tests outside lists.
 * @inputs texts - Ordered strings; each becomes its own top-level paragraph child.
 * @outputs ProseMirrorNode - A doc node whose children are the mapped paragraphs, in order.
 * @dataflow Texts array -> map to para nodes -> those become the doc's direct children (no wrapping list).
 * @controlflow One mapping pass with no branching; each text is independent and at document depth.
 */
function paragraphDoc(...texts: readonly string[]): ProseMirrorNode {
  return kdocSchema.node('doc', null, texts.map((t: string): ProseMirrorNode => para(t)));
}

/**
 * Build a doc with one blockquote wrapping a single paragraph.
 *
 * @purpose Construct the outdent source state where a caret sits inside exactly one nested block.
 * @inputs text - The string placed in the sole paragraph, which is itself the blockquote's only child.
 * @outputs ProseMirrorNode - A doc node containing [blockquote] whose child is [paragraph].
 * @dataflow Input string -> para(text) -> quoted as the blockquote's single child -> doc wraps that blockquote.
 * @controlflow Single nesting step with no branching; one level of blockquote encloses exactly one paragraph.
 */
function quoteDoc(text: string): ProseMirrorNode {
  return kdocSchema.node('doc', null, [kdocSchema.node('blockquote', null, [para(text)])]);
}

/**
 * Locate a text node and wrap its document in an EditorState whose caret sits just past it.
 *
 * @purpose Turn a plain doc into a state positioned at the first occurrence of a given string for command tests.
 * @inputs doc - The document to search; textToFind - The exact text content whose position becomes the caret anchor.
 * @outputs EditorState - A state over doc with TextSelection placed one past the matched node's start, or throws if absent.
 * @dataflow Doc -> descendants walk records matching pos -> found + 1 passed to TextSelection.create(doc, ...) -> EditorState.
 * @controlflow Descend until a match sets found and returns false (stop); otherwise keep walking; after the walk branch on found === null to throw or build.
 */
function stateAt(doc: ProseMirrorNode, textToFind: string): EditorState {
  let found: number | null = null;

  doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // First exact match anchors the caret and halts the walk by returning false.
    if (node.isText && node.text === textToFind) {
      found = pos;
      return false;
    } else {
      // No match here: continue descending to reach deeper nodes.
      return true;
    }
  });

  // Unmatched text leaves no anchor, so there is nothing valid to build a state around.
  if (found === null) {
    throw new Error(`Text "${textToFind}" not found`);
  } else {
    // Position the caret just past the matched node's start and wrap doc + selection in an EditorState.
    return EditorState.create({ doc, selection: TextSelection.create(doc, found + 1), schema: kdocSchema });
  }
}

/**
 * Apply a command to a state, capturing applicability and the resulting state.
 *
 * @purpose Run one Command against an initial state while folding each dispatched transaction into next for inspection.
 * @inputs state - The starting EditorState; command - A factory result taking (state, dispatch) and returning boolean.
 * @outputs { applied: boolean; next: EditorState } - Whether the command took effect and the document after it ran.
 * @dataflow Command(state, dispatch) -> each tr folded via next = next.apply(tr) -> returned object carries both results.
 * @controlflow Seed next with state, invoke the command once with a dispatch that advances next, then return both outcomes; no branching inside.
 */
function runOn(state: EditorState, command: Command): { applied: boolean; next: EditorState } {
  let next: EditorState = state;

  const applied: boolean = command(
    state,
    (tr: Transaction): void => {
      // Fold each dispatched transaction into the working state so `next` reflects everything that ran.
      next = next.apply(tr);
    },
  );

  return { applied, next };
}

/**
 * Tally nodes of one type across a whole document.
 *
 * @purpose Count every node whose schema name equals typeName for structural assertions after a command runs.
 * @inputs doc - The document to traverse; typeName - The exact node.type.name value being tallied.
 * @outputs number - Total occurrences of that node type anywhere in the tree, including nested levels.
 * @dataflow Doc -> descendants visit every node -> increment n on name match -> return accumulated count.
 * @controlflow Visit all nodes (always return true); branch only to decide whether to bump n or leave it unchanged.
 */
function counts(doc: ProseMirrorNode, typeName: string): number {
  let n: number = 0;

  doc.descendants((node: ProseMirrorNode): boolean => {
    // A name match increments the tally for this node type.
    if (node.type.name === typeName) {
      n++;
    } else {
      // Different type: leave the counter untouched and keep walking.
    }

    return true;
  });

  return n;
}

describe('indentBlock', (): void => {
  it('nests a list item under the one above it', (): void => {
    const { applied, next } = runOn(stateAt(bulletDoc('one', 'two'), 'two'), indentBlock());
    expect(applied).toBe(true);
    expect(counts(next.doc, 'bulletList')).toBe(2);
  });

  it('leaves the first item of a list alone rather than quoting it', (): void => {
    // The first item has nothing above to nest under, and inside a list indenting can only mean nesting.
    const { applied, next } = runOn(stateAt(bulletDoc('one', 'two'), 'one'), indentBlock());
    expect(applied).toBe(false);
    expect(counts(next.doc, 'blockquote')).toBe(0);
    expect(counts(next.doc, 'bulletList')).toBe(1);
  });

  it('quotes a paragraph, which is the only indent Markdown has', (): void => {
    const { applied, next } = runOn(stateAt(paragraphDoc('alone'), 'alone'), indentBlock());
    expect(applied).toBe(true);
    expect(counts(next.doc, 'blockquote')).toBe(1);
  });

  it('quotes a paragraph again for a second level', (): void => {
    // Run indentBlock twice, feeding the second run the state the first produced.
    const first = runOn(stateAt(paragraphDoc('alone'), 'alone'), indentBlock());
    const second = runOn(stateAt(first.next.doc, 'alone'), indentBlock());

    expect(second.applied).toBe(true);
    expect(counts(second.next.doc, 'blockquote')).toBe(2);
  });

  it('reports whether it applies without changing anything', (): void => {
    // A dry run passes no dispatch, which is how a toolbar button asks whether it is enabled.
    const inList = stateAt(bulletDoc('one', 'two'), 'two');
    expect(indentBlock()(inList)).toBe(true);
    expect(inList.doc.eq(bulletDoc('one', 'two'))).toBe(true);

    const bare = stateAt(paragraphDoc('alone'), 'alone');
    expect(indentBlock()(bare)).toBe(true);
    expect(bare.doc.eq(paragraphDoc('alone'))).toBe(true);
  });
});

describe('outdentBlock', (): void => {
  it('lifts a nested list item back to its parent list', (): void => {
    // Build the nested document by running indentBlock first.
    const nested = runOn(stateAt(bulletDoc('one', 'two'), 'two'), indentBlock());
    const { applied, next } = runOn(stateAt(nested.next.doc, 'two'), outdentBlock());

    expect(applied).toBe(true);
    // The whole document is compared, not just a tally of lists: a bare lift also leaves one list
    // behind, but it pulls the paragraph out of its item rather than lifting the item.
    expect(next.doc.eq(bulletDoc('one', 'two'))).toBe(true);
  });

  it('lifts a list item out of the list altogether', (): void => {
    const { applied, next } = runOn(stateAt(bulletDoc('one'), 'one'), outdentBlock());

    expect(applied).toBe(true);
    expect(next.doc.eq(paragraphDoc('one'))).toBe(true);
  });

  it('comes out of a blockquote', (): void => {
    const { applied, next } = runOn(stateAt(quoteDoc('quoted'), 'quoted'), outdentBlock());

    expect(applied).toBe(true);
    expect(counts(next.doc, 'blockquote')).toBe(0);
  });

  it('does nothing to a bare paragraph', (): void => {
    // There is nothing to come out of, and lifting anyway would move the caret out of whatever else encloses it.
    const { applied, next } = runOn(stateAt(paragraphDoc('alone'), 'alone'), outdentBlock());

    expect(applied).toBe(false);
    expect(next.doc.eq(paragraphDoc('alone'))).toBe(true);
  });

  it('undoes what indentBlock did to a paragraph', (): void => {
    const inward = runOn(stateAt(paragraphDoc('alone'), 'alone'), indentBlock());
    const outward = runOn(stateAt(inward.next.doc, 'alone'), outdentBlock());

    expect(outward.applied).toBe(true);
    expect(outward.next.doc.eq(paragraphDoc('alone'))).toBe(true);
  });

  it('reports whether it applies without changing anything', (): void => {
    const quoted = stateAt(quoteDoc('quoted'), 'quoted');
    expect(outdentBlock()(quoted)).toBe(true);
    expect(quoted.doc.eq(quoteDoc('quoted'))).toBe(true);

    const bare = stateAt(paragraphDoc('alone'), 'alone');
    expect(outdentBlock()(bare)).toBe(false);
    expect(bare.doc.eq(paragraphDoc('alone'))).toBe(true);
  });
});
