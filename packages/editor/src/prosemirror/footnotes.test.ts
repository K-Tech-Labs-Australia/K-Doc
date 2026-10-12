// @vitest-environment jsdom
/**
 * @file footnotes.test.ts
 * @purpose Unit tests for footnote numbering and the Insert Footnote command.
 * @inputs kdocSchema documents built in each case.
 * @outputs Vitest assertions.
 * @functions
 *   - makeState / runInsertFootnote / docWithReferences / refNode: test builders.
 * @dataflow Built doc -> EditorState -> insertFootnote -> applied state -> assertions.
 * @controlflow Each case builds its own state; no shared fixtures.
 * @version 1
 * @date 2026-10-08
 */
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { kdocSchema } from './schema.js';
import { insertFootnote, nextFootnoteLabel } from './footnotes.js';

/**
 * Builds a ProseMirror EditorState over the K-Doc schema for the given document and optional selection position.
 * @purpose Centralizes state construction so each test starts from an identical, plugin-free baseline.
 * @inputs doc: PMNode - The root document node to place in the state. pos?: number - Optional absolute caret position; omitted means no explicit selection is set (ProseMirror derives a default).
 * @outputs EditorState - A fresh editor state ready for command execution or predicate inspection.
 * @dataflow doc + optional pos -> EditorState.create with schema, doc, and selection.
 * @controlflow Always create the base state; only attach an explicit TextSelection when a position is supplied.
 */
function makeState(doc: PMNode, pos?: number): EditorState {
  const options: { schema: typeof kdocSchema; doc: PMNode; selection?: TextSelection } = {
    schema: kdocSchema,
    doc,
  };
  if (pos !== undefined) {
    // An explicit position is supplied: build a caret selection there.
    options.selection = TextSelection.create(doc, pos);
  } else {
    // No position given: let ProseMirror derive the default selection from the document.
  }

  return EditorState.create(options);
}

/**
 * Runs an insertFootnote command against a state with dispatch applied and returns the resulting editor state.
 * @purpose Applies the dispatched transaction through `state.apply` so tests observe the post-insert doc, selection, and structural meta exactly as the real view would.
 * @inputs state: EditorState - The pre-command state to run insertFootnote on.
 * @outputs { newState: EditorState | null; applied: boolean } - The resulting editor state (null when the command returned false), plus whether a transaction was dispatched.
 * @dataflow Command(state, dispatch) -> captured Transaction -> state.apply(tr) -> new EditorState.
 * @controlflow Capture the dispatched tr in a closure; if none arrived the command rejected and newState stays null.
 */
function runInsertFootnote(state: EditorState): { newState: EditorState | null; applied: boolean } {
  const captured: Transaction[] = [];
  const applied = insertFootnote()(state, (tr) => {
    // The command supplied a transaction to apply.
    captured.push(tr);
  });
  const appliedTr = captured[0];
  if (!applied || appliedTr === undefined) {
    // Command rejected or dispatched nothing: there is no resulting state to return.
    return { newState: null, applied };
  } else {
    // A transaction was produced: apply it through the editor so selection and marks are included in the new state.
    return { newState: state.apply(appliedTr), applied };
  }
}

/**
 * Builds a document node containing footnote reference atoms inside paragraphs, for label-computation tests.
 * @purpose Constructs valid inline content (references live in the inline group) so nextFootnoteLabel can scan real descendants.
 * @inputs references: PMNode[] - FootnoteReference nodes to place together in one paragraph within the doc root.
 * @outputs PMNode - A `doc` node wrapping a single paragraph of those references.
 * @dataflow kdocSchema.node('paragraph', null, references) wrapped by kdocSchema.node('doc', null, [paragraph]).
 * @controlflow Assemble reference nodes with explicit identifier/label attrs (required because the schema supplies no defaults).
 */
function docWithReferences(...references: PMNode[]): PMNode {
  const paragraph = kdocSchema.node('paragraph', null, references);
  return kdocSchema.node('doc', null, [paragraph]);
}

/**
 * Builds a footnoteReference node with explicit identifier and label attributes.
 * @purpose Wraps the schema call so tests read declaratively (e.g. refNode('1'), refNode('intro')).
 * @inputs id: string - The numeric or named identifier to store on both `identifier` and `label`.
 * @outputs PMNode - A footnoteReference node ready for placement inside a paragraph.
 * @dataflow id -> { identifier: id, label: id } attrs passed to kdocSchema.node('footnoteReference', ...).
 * @controlflow Always supply both required attributes so the schema's create() does not throw on missing defaults.
 */
function refNode(id: string): PMNode {
  return kdocSchema.node('footnoteReference', { identifier: id, label: id });
}

describe('nextFootnoteLabel', () => {
  it('returns "1" for a document with no footnotes', () => {
    // A doc containing only an empty paragraph has no footnote nodes at all.
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph')]);
    expect(nextFootnoteLabel(doc)).toBe('1');
  });

  it('returns "4" when references carry identifiers 1, 3 and a named intro', () => {
    // The highest numeric identifier is 3; the non-numeric `intro` never advances the counter.
    const doc = docWithReferences(refNode('1'), refNode('3'), refNode('intro'));
    expect(nextFootnoteLabel(doc)).toBe('4');
  });
});

describe('insertFootnote', () => {
  it('appends a reference and definition to "Hello" with the caret after the text', () => {
    // Text 'Hello' occupies positions 1..6 inside the paragraph, so the caret-after position is 6.
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('Hello')])]);
    const state = makeState(doc, 6);

    const { newState } = runInsertFootnote(state);
    expect(newState).not.toBeNull();
    // Guard against a null result short-circuiting the assertions below.
    if (newState === null) return;

    const newDoc = newState.doc;
    // The paragraph now ends with an inline footnoteReference carrying identifier and label '1'.
    const lastChildOfPara = newDoc.firstChild!.lastChild!;
    expect(lastChildOfPara.type.name).toBe('footnoteReference');
    expect(lastChildOfPara.attrs.identifier).toBe('1');
    expect(lastChildOfPara.attrs.label).toBe('1');

    // The document's final block is the appended footnoteDefinition, also carrying identifier '1'.
    const lastBlock = newDoc.lastChild!;
    expect(lastBlock.type.name).toBe('footnoteDefinition');
    expect(lastBlock.attrs.identifier).toBe('1');

    // Its single child is one empty paragraph.
    expect(lastBlock.childCount).toBe(1);
    expect(lastBlock.firstChild!.type.name).toBe('paragraph');

    // The caret sits inside that definition's paragraph ($from.parent) whose parent node (-1 up) is the definition.
    expect(newState.selection.$from.parent.type.name).toBe('paragraph');
    expect(newState.selection.$from.node(-1).type.name).toBe('footnoteDefinition');
  });

  it('uses label "2" on a second insertion', () => {
    // After one note exists (identifier '1'), the next computed label must be '2'.
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('Hello')])]);
    const firstState = makeState(doc, 6);

    const { newState } = runInsertFootnote(firstState);
    expect(newState).not.toBeNull();
    if (newState === null) return;

    // Rebuild a state from the post-first-insertion document with the caret after the first reference.
    const secondDoc = newState.doc;
    const secondCaretPos = 7; // After 'Hello' and the first reference atom.
    const secondState = makeState(secondDoc, secondCaretPos);

    const { newState: afterSecond } = runInsertFootnote(secondState);
    expect(afterSecond).not.toBeNull();
    if (afterSecond === null) return;

    // The newly inserted reference from the second insertion carries label '2'.
    const refAfterSecond = afterSecond.doc.firstChild!.lastChild!;
    expect(refAfterSecond.type.name).toBe('footnoteReference');
    expect(refAfterSecond.attrs.identifier).toBe('2');
  });

  it('returns false inside a code block', () => {
    // A code block's content model is 'text*' with marks '', so an inline reference atom cannot be inserted there.
    const doc = kdocSchema.node('doc', null, [kdocSchema.node('codeBlock', null, [kdocSchema.text('some code')])]);
    const state = makeState(doc);

    let dispatched = false;
    const result = insertFootnote()(state, () => {
      // This callback must never run because the command rejects inside a code block.
      dispatched = true;
    });

    expect(result).toBe(false);
    expect(dispatched).toBe(false);
  });
});
