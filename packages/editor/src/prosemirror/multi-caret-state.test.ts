/**
 * @file multi-caret-state.test.ts
 * @purpose Vitest test suite covering the pure state representations and transaction builders for multi-caret editing in the K-Doc pane (FR-7.2).
 *   Verifies caret set normalization, position mapping through document changes, caret toggling, primary selection integration, and back-to-front insertion and deletion transactions without mounting a DOM view.
 * @inputs ProseMirror EditorState instances, MultiCaretState descriptors, document positions, mapping objects, and test edit payloads.
 * @outputs Vitest assertions verifying caret set normalization, mapping, toggling, and multi-caret insert and delete transactions.
 * @functions
 *   - docOf: Builds a ProseMirror document containing paragraph nodes corresponding to the provided text strings.
 *   - stateAt: Initializes an EditorState with kdocSchema, the given document node, and a TextSelection at the specified range.
 * @dataflow Document strings -> docOf -> ProseMirror doc -> stateAt -> EditorState -> multi-caret state transforms & transaction builders -> Vitest assertions.
 * @controlflow Test caret set operations (normaliseCarets, mapCarets, toggleCaret, allCaretPositions) -> test multi-caret insertions (insertAtCarets) -> test multi-caret deletions (deleteAtCarets).
 * @version 2
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  normaliseCarets,
  mapCarets,
  toggleCaret,
  allCaretPositions,
  insertAtCarets,
  deleteAtCarets,
  EMPTY_MULTI_CARET,
} from './multi-caret-state.js';

/**
 * Constructs a ProseMirror document containing paragraph nodes corresponding to the provided text strings.
 *
 * Note that a doc of one paragraph puts its text at positions 1..(1 + length): the paragraph's own opening token occupies position 0.
 *
 * @purpose Builds a ProseMirror doc node with paragraph children for multi-caret state testing.
 * @inputs paragraphs: readonly string[] - Variadic list of paragraph content strings.
 * @outputs ProseMirrorNode - The constructed ProseMirror root doc node.
 * @dataflow paragraphs -> map strings to paragraph nodes -> wrap in doc node -> ProseMirrorNode.
 * @controlflow Iterate over paragraphs -> check if string is empty or populated -> append empty or text paragraph -> wrap all in doc node.
 */
function docOf(...paragraphs: readonly string[]): ProseMirrorNode {
  const nodes: ProseMirrorNode[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const s = paragraphs[i];
    // Check whether the paragraph string at index i is defined under strict indexing.
    if (s === undefined) {
      // Undefined element: skip iteration.
      continue;
    } else {
      // Defined element: proceed with node construction.
    }

    // Check whether the paragraph string is empty or contains text.
    if (s.length === 0) {
      // Empty string: construct empty paragraph node.
      nodes.push(kdocSchema.node('paragraph', null, []));
    } else {
      // Non-empty string: construct paragraph node wrapping text node.
      nodes.push(kdocSchema.node('paragraph', null, [kdocSchema.text(s)]));
    }
  }
  return kdocSchema.node('doc', null, nodes);
}

/**
 * Creates an EditorState initialized with kdocSchema, the given document, and a text selection.
 *
 * @purpose Initializes an EditorState with a specified selection range for testing multi-caret transactions.
 * @inputs
 *   - doc: ProseMirrorNode - The document node for the editor state.
 *   - from: number - The selection starting position.
 *   - to: number | undefined - Optional selection ending position; defaults to `from`.
 * @outputs EditorState - A new ProseMirror EditorState configured with kdocSchema and TextSelection.
 * @dataflow doc + from + to -> TextSelection.create -> EditorState.create -> EditorState.
 * @controlflow Resolve selection end position -> build TextSelection -> create and return EditorState.
 */
function stateAt(doc: ProseMirrorNode, from: number, to?: number): EditorState {
  let resolvedTo: number;
  // Check whether an explicit selection end position was provided.
  if (to !== undefined) {
    // Explicit end position provided: use to.
    resolvedTo = to;
  } else {
    // No explicit end position provided: collapse selection to from.
    resolvedTo = from;
  }

  return EditorState.create({
    schema: kdocSchema,
    doc,
    selection: TextSelection.create(doc, from, resolvedTo),
  });
}

describe('the caret set', (): void => {
  it('sorts and de-duplicates', (): void => {
    // Two carets at one position are one caret, and the ascending order is what lets every edit be applied back-to-front.
    expect(normaliseCarets([5, 1, 5, 3])).toEqual([1, 3, 5]);
  });

  it('does not mutate its input', (): void => {
    const input: number[] = [3, 1];
    normaliseCarets(input);
    expect(input).toEqual([3, 1]);
  });

  it('maps every caret through a mapping', (): void => {
    expect(
      mapCarets({ extras: [2, 6] }, { map: (p: number): number => p + 10 }),
    ).toEqual({ extras: [12, 16] });
  });

  it('collapses carets a mapping brought together', (): void => {
    // An edit that deletes the text between two carets leaves them in the same place, and they are then one caret.
    expect(
      mapCarets({ extras: [2, 6] }, { map: (): number => 4 }),
    ).toEqual({ extras: [4] });
  });

  it('toggles a caret off as well as on', (): void => {
    // Ctrl+clicking a caret you already placed is how you take it back.
    const withCaret = toggleCaret(EMPTY_MULTI_CARET, 5);
    expect(withCaret).toEqual({ extras: [5] });
    const withoutCaret = toggleCaret(withCaret, 5);
    expect(withoutCaret).toEqual({ extras: [] });
  });

  it('puts the primary caret back', (): void => {
    // The primary is not in the plugin state, so an operation that forgot it would type everywhere except where the user is looking.
    expect(allCaretPositions(3, [7, 1])).toEqual([1, 3, 7]);
  });
});

describe('typing at several carets', (): void => {
  const doc: ProseMirrorNode = docOf('alpha bravo charlie');

  it('inserts the same text at every caret', (): void => {
    const state: EditorState = stateAt(doc, 1);
    // Applying back-to-front is what keeps the lower position valid when its turn comes.
    const tr: Transaction = insertAtCarets(state, [7], 'X');
    expect(tr.doc.textContent).toBe('Xalpha Xbravo charlie');
  });

  it('leaves the primary caret after what it typed', (): void => {
    const state: EditorState = stateAt(doc, 1);
    const tr: Transaction = insertAtCarets(state, [7], 'X');
    expect(tr.selection.from).toBe(2);
  });

  it('replaces a selected range at the primary caret', (): void => {
    const state: EditorState = stateAt(doc, 1, 6);
    const tr: Transaction = insertAtCarets(state, [7], 'Z');
    expect(tr.doc.textContent).toBe('Z Zbravo charlie');
  });

  it('drops an extra that sits inside the primary selection', (): void => {
    const state: EditorState = stateAt(doc, 1, 12);
    // The extra would be deleted by the primary replacement anyway, and applying it as well would
    // double the text. Counting the Qs could not tell the two apart: the extra's own insertion falls
    // inside the range the primary replacement then wipes, so one Q survives either way. What differs
    // is everything else -- keeping the extra shifts the document under the primary range, and the
    // replacement then stops a character short.
    const tr: Transaction = insertAtCarets(state, [7], 'Q');
    expect(tr.doc.textContent).toBe('Q charlie');
  });

  it('is one transaction, so one undo', (): void => {
    // Typing at three carets that took three undos to take back would be worse than not having the feature.
    const tr: Transaction = insertAtCarets(stateAt(doc, 1), [7, 13], 'X');
    expect(tr.steps.length).toBe(3);
  });
});

describe('deleting at several carets', (): void => {
  const doc: ProseMirrorNode = docOf('ab cd');

  it('declines when there is only one caret', (): void => {
    // Returning null is how it says "not mine", so the ordinary Backspace still works.
    const tr: Transaction | null = deleteAtCarets(stateAt(doc, 3), [], -1);
    expect(tr).toBeNull();
  });

  it('backspaces at every caret', (): void => {
    const state: EditorState = stateAt(doc, 3);
    const tr: Transaction | null = deleteAtCarets(state, [6], -1);
    expect(tr).not.toBeNull();
    // Check whether transaction is non-null to satisfy strict typing.
    if (tr !== null) {
      expect(tr.doc.textContent).toBe('a c');
    } else {
      // Branch: Unexpected null transaction.
    }
  });

  it('deletes forward at every caret', (): void => {
    const state: EditorState = stateAt(doc, 1);
    const tr: Transaction | null = deleteAtCarets(state, [4], 1);
    expect(tr).not.toBeNull();
    // Check whether transaction is non-null to satisfy strict typing.
    if (tr !== null) {
      expect(tr.doc.textContent).toBe('b d');
    } else {
      // Branch: Unexpected null transaction.
    }
  });

  it('refuses a backspace that would run off the front', (): void => {
    // An extra caret at 0 sits before the paragraph's own opening token, so a backspace there asks to
    // delete from -1. A range outside the document throws inside ProseMirror, so it is dropped rather
    // than clamped into deleting something else -- and dropping it must not stop the other caret.
    const tr: Transaction | null = deleteAtCarets(stateAt(doc, 3), [0], -1);
    expect(tr).not.toBeNull();
    // Check whether a transaction came back, so the assertion below is against a real document.
    if (tr === null) {
      // No transaction: the out-of-range caret took the whole edit with it, which is the bug.
      expect.fail('Expected the in-range caret to still delete');
    } else {
      // Only the primary's own backspace landed: the 'b' before position 3 is gone.
      expect(tr.doc.textContent).toBe('a cd');
    }
  });

  it('refuses a forward delete at the very end', (): void => {
    // The document's content size is one past the last text position, so a forward delete from there
    // asks for a range that ends outside the document.
    const end: number = stateAt(doc, 1).doc.content.size;
    const tr: Transaction | null = deleteAtCarets(stateAt(doc, 1), [end], 1);
    expect(tr).not.toBeNull();
    // Check whether a transaction came back.
    if (tr === null) {
      // No transaction: the out-of-range caret took the whole edit with it, which is the bug.
      expect.fail('Expected the in-range caret to still delete');
    } else {
      // Only the primary's own forward delete landed: the 'a' at position 1 is gone.
      expect(tr.doc.textContent).toBe('b cd');
    }
  });

  it('deletes a selected range at the primary caret', (): void => {
    const state: EditorState = stateAt(doc, 1, 3);
    const tr: Transaction | null = deleteAtCarets(state, [6], -1);
    expect(tr).not.toBeNull();
    // Check whether transaction is non-null to satisfy strict typing.
    if (tr !== null) {
      expect(tr.doc.textContent).toBe(' c');
    } else {
      // Branch: Unexpected null transaction.
    }
  });
});
