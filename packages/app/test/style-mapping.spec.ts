/**
 * @file style-mapping.spec.ts
 * @purpose Vitest test suite for the Styles gallery's translation to editor commands and queries (FR-8.5).
 * @inputs ProseMirror EditorState instances, document fixtures with headings, quotes, code blocks, callouts, and tables.
 * @outputs Vitest assertions verifying callout kind mapping, style detection at selection, and command execution for gallery styles.
 * @functions
 *   - para: Constructs a paragraph node with the given text, or an empty paragraph if text is empty.
 *   - docOf: Constructs a root document node wrapping the provided block nodes.
 *   - quote: Constructs a blockquote node wrapping the provided block nodes.
 *   - stateAt: Creates an EditorState positioned inside the text node matching the target text, with no plugins installed.
 *   - runOn: Executes a ProseMirror command against an EditorState and applies every dispatched transaction sequentially.
 * @note The custom-callout entry is the one callout id with no kind behind it: its word is the user's and
 *   is asked for at the point of use, so calloutKindOf has nothing to return and canApplyStyle answers for it.
 * @dataflow Document fixtures -> EditorState -> calloutKindOf / styleIdAt / commandForStyle -> Vitest assertions.
 * @controlflow describe('calloutKindOf') -> describe('styleIdAt') -> describe('commandForStyle') -> describe('canApplyStyle').
 * @version 2
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { kdocSchema, calloutAt } from '@k-doc/editor';
import {
  calloutKindOf,
  styleIdAt,
  commandForStyle,
  canApplyStyle,
} from '../src/shell/style-mapping.js';
import { STYLE_ENTRIES, type StyleId } from '../src/shell/styles-gallery.js';

/**
 * Constructs a paragraph node with the given text, or an empty paragraph if text is empty.
 *
 * @purpose Builds a paragraph ProseMirror node for test fixtures.
 * @inputs text: string - The text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The constructed paragraph node.
 * @dataflow text -> length check -> kdocSchema.text (if non-empty) -> kdocSchema.node('paragraph').
 * @controlflow If text is empty, construct paragraph with no children; else wrap text node in paragraph.
 */
function para(text: string): ProseMirrorNode {
  // Check if the text string is empty.
  if (text.length === 0) {
    // Empty text: construct paragraph with no child text nodes.
    return kdocSchema.node('paragraph', null, []);
  } else {
    // Non-empty text: construct paragraph containing a single text leaf node.
    return kdocSchema.node('paragraph', null, [kdocSchema.text(text)]);
  }
}

/**
 * Constructs a root document node containing the provided block nodes.
 *
 * @purpose Wraps block nodes in a ProseMirror doc node for test fixtures.
 * @inputs blocks: readonly ProseMirrorNode[] - The block nodes to populate inside the doc.
 * @outputs ProseMirrorNode - The constructed root doc node.
 * @dataflow blocks -> kdocSchema.node('doc').
 * @controlflow Wraps the provided blocks in a doc node and returns it.
 */
function docOf(...blocks: readonly ProseMirrorNode[]): ProseMirrorNode {
  return kdocSchema.node('doc', null, [...blocks]);
}

/**
 * Constructs a blockquote node containing the provided block nodes.
 *
 * @purpose Builds a blockquote ProseMirror node for test fixtures.
 * @inputs blocks: readonly ProseMirrorNode[] - The block nodes to place inside the blockquote.
 * @outputs ProseMirrorNode - The constructed blockquote node.
 * @dataflow blocks -> kdocSchema.node('blockquote').
 * @controlflow Wraps the provided blocks in a blockquote node and returns it.
 */
function quote(...blocks: readonly ProseMirrorNode[]): ProseMirrorNode {
  return kdocSchema.node('blockquote', null, [...blocks]);
}

/**
 * Creates an EditorState positioned inside the text node matching the target text.
 *
 * @purpose Resolves text position and builds an EditorState with selection inside the matched text node.
 * @inputs
 *   - doc: ProseMirrorNode - The root document node to search within.
 *   - textToFind: string - Target text content to locate.
 * @outputs EditorState - Configured EditorState with caret placed at pos + 1 and no plugins installed.
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
    // Plain EditorState with no plugins: this module is about commands and queries, not decorations.
    return EditorState.create({
      doc,
      selection,
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
 * @outputs EditorState - The resulting EditorState after applying all dispatched transactions, or original state if command returned false.
 * @dataflow state -> command execution with dispatch callback -> current.apply(tr) on each transaction -> final EditorState.
 * @controlflow Initialize current to state -> execute command with dispatch callback -> check command return value -> return updated state if true, original state if false.
 */
function runOn(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
): EditorState {
  let current = state;
  const ok = command(current, (tr: Transaction): void => {
    current = current.apply(tr);
  });

  // Check whether the command returned true or false.
  if (ok) {
    // Command succeeded: return the state with all dispatched transactions applied.
    return current;
  } else {
    // Command returned false: return the original state without modifications.
    return state;
  }
}

/**
 * The one callout entry with no CalloutKind behind it.
 *
 * Its alert word is the user's own and is asked for when the entry is picked, so there is nothing for
 * calloutKindOf to return. Naming it here keeps both halves of the invariant deriving from the gallery's
 * own list while recording the single deliberate exception in one place.
 */
const CUSTOM_CALLOUT_ID: StyleId = 'callout-custom';

describe('calloutKindOf', () => {
  it('maps every callout entry to a kind', () => {
    // The gallery and the mapping have to agree on the set, and the only way to keep
    // them agreeing is to derive the check from the gallery's own list.
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid entry record.
      }

      // Check if the style entry identifier starts with 'callout-' and is not the custom entry.
      if (entry.id.startsWith('callout-') && entry.id !== CUSTOM_CALLOUT_ID) {
        // Callout style entry: verify that calloutKindOf maps it to a non-null CalloutKind.
        expect(calloutKindOf(entry.id)).not.toBeNull();
      } else {
        // Non-callout entry, or the custom one that deliberately has no kind: skip in this test.
      }
    }
  });

  it('maps nothing else to a kind', () => {
    // Entries whose id does not start with 'callout-' must not map to any callout kind.
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid entry record.
      }

      // Check if the style entry identifier does not start with 'callout-', or is the custom entry.
      if (!entry.id.startsWith('callout-') || entry.id === CUSTOM_CALLOUT_ID) {
        // Non-callout style entry, or the custom one: verify that calloutKindOf evaluates to null.
        expect(calloutKindOf(entry.id)).toBeNull();
      } else {
        // Callout entry with a kind behind it: skip in this test.
      }
    }
  });
});

describe('styleIdAt', () => {
  it('identifies a paragraph as Normal', () => {
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    expect(styleIdAt(state)).toBe('normal');
  });

  it('identifies each heading level as its own entry', () => {
    for (let level = 1; level <= 6; level++) {
      const headingText = `h${level}`;
      const headingNode = kdocSchema.node('heading', { level }, [
        kdocSchema.text(headingText),
      ]);
      const doc = docOf(headingNode);
      const state = stateAt(doc, headingText);

      // Build the expected id through a small commented chain rather than a template literal,
      // since StyleId is a union of literals.
      let expectedId: StyleId;
      // Check heading level 1.
      if (level === 1) {
        expectedId = 'heading-1';
      } else if (level === 2) {
        // Check heading level 2.
        expectedId = 'heading-2';
      } else if (level === 3) {
        // Check heading level 3.
        expectedId = 'heading-3';
      } else if (level === 4) {
        // Check heading level 4.
        expectedId = 'heading-4';
      } else if (level === 5) {
        // Check heading level 5.
        expectedId = 'heading-5';
      } else {
        // Heading level 6.
        expectedId = 'heading-6';
      }

      expect(styleIdAt(state)).toBe(expectedId);
    }
  });

  it('identifies a code block as Code Block', () => {
    const codeBlock = kdocSchema.node('codeBlock', null, [
      kdocSchema.text('const x = 1;'),
    ]);
    const doc = docOf(codeBlock);
    const state = stateAt(doc, 'const x = 1;');
    expect(styleIdAt(state)).toBe('code-block');
  });

  it('identifies a plain quote as Quote', () => {
    const doc = docOf(quote(para('quoted')));
    const state = stateAt(doc, 'quoted');
    expect(styleIdAt(state)).toBe('quote');
  });

  it('identifies a callout as its own entry, not Quote', () => {
    // A callout is a blockquote, so the quote check would swallow it if it ran first;
    // the order of the checks is the answer here, not an implementation detail.
    const doc = docOf(quote(para('[!WARNING]'), para('body')));
    const state = stateAt(doc, 'body');
    expect(styleIdAt(state)).toBe('callout-warning');
  });

  it('identifies a heading inside a quote as the heading', () => {
    // A heading inside a quote is the heading: that is the block the caret is actually in.
    const doc = docOf(
      quote(kdocSchema.node('heading', { level: 2 }, [kdocSchema.text('inside')])),
    );
    const state = stateAt(doc, 'inside');
    expect(styleIdAt(state)).toBe('heading-2');
  });

  it('reports null for a table cell because the gallery offers nothing for it', () => {
    // Marking nothing is the truthful answer for a block with no entry.
    const tableNode = kdocSchema.node('table', { align: [] }, [
      kdocSchema.node('tableRow', null, [
        kdocSchema.node('tableCell', null, [kdocSchema.text('cell 1')]),
        kdocSchema.node('tableCell', null, [kdocSchema.text('cell 2')]),
      ]),
      kdocSchema.node('tableRow', null, [
        kdocSchema.node('tableCell', null, [kdocSchema.text('cell 3')]),
        kdocSchema.node('tableCell', null, [kdocSchema.text('cell 4')]),
      ]),
    ]);
    const doc = docOf(tableNode);
    const state = stateAt(doc, 'cell 1');
    expect(styleIdAt(state)).toBeNull();
  });
});

describe('commandForStyle', () => {
  it('turns a heading back into a paragraph with Normal', () => {
    const heading = kdocSchema.node('heading', { level: 1 }, [
      kdocSchema.text('heading text'),
    ]);
    const doc = docOf(heading);
    const state = stateAt(doc, 'heading text');
    const next = runOn(state, commandForStyle('normal'));

    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(0).textContent).toBe('heading text');
  });

  it('turns a paragraph into a level-3 heading with Heading 3', () => {
    const doc = docOf(para('para text'));
    const state = stateAt(doc, 'para text');
    const next = runOn(state, commandForStyle('heading-3'));

    const firstChild = next.doc.child(0);
    expect(firstChild.type.name).toBe('heading');
    const levelAttr = firstChild.attrs['level'];
    // Check if the level attribute is defined on the heading node.
    if (levelAttr !== undefined) {
      expect(levelAttr).toBe(3);
    } else {
      expect.fail('Expected heading level attribute to be defined');
    }
  });

  it('turns a paragraph into a code block with Code Block', () => {
    const doc = docOf(para('code line'));
    const state = stateAt(doc, 'code line');
    const next = runOn(state, commandForStyle('code-block'));

    expect(next.doc.child(0).type.name).toBe('codeBlock');
    expect(next.doc.child(0).textContent).toBe('code line');
  });

  it('makes its own callout for each callout entry', () => {
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid entry record.
      }

      // Check if entry represents a callout style.
      if (entry.id.startsWith('callout-')) {
        const doc = docOf(para('plain'));
        const state = stateAt(doc, 'plain');
        const next = runOn(state, commandForStyle(entry.id));

        // Re-derive stateAt on the resulting doc to inspect the active callout kind.
        const nextState = stateAt(next.doc, 'plain');
        const expectedKind = calloutKindOf(entry.id);
        expect(calloutAt(nextState)).toBe(expectedKind);
      } else {
        // Non-callout entry: skip.
      }
    }
  });

  it('makes a quote when applying Quote to a paragraph', () => {
    const doc = docOf(para('plain text'));
    const state = stateAt(doc, 'plain text');
    const next = runOn(state, commandForStyle('quote'));

    expect(next.doc.child(0).type.name).toBe('blockquote');
  });

  it('strips the marker and leaves a quote when applying Quote to a callout', () => {
    // Quote is the callout minus its marker, so stripping the marker leaves a plain quote.
    const doc = docOf(quote(para('[!NOTE]'), para('body')));
    const state = stateAt(doc, 'body');
    const next = runOn(state, commandForStyle('quote'));

    const bq = next.doc.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.childCount).toBe(1);
    expect(bq.child(0).textContent).toBe('body');

    const nextState = stateAt(next.doc, 'body');
    expect(calloutAt(nextState)).toBeNull();
  });

  it('does nothing and returns false when applying Quote on a plain quote', () => {
    // A toggle and a style are different verbs: toggling would take the quote away,
    // which is the opposite of picking the style you are already in.
    const doc = docOf(quote(para('quoted')));
    const state = stateAt(doc, 'quoted');
    const result = commandForStyle('quote')(state);

    expect(result).toBe(false);
  });

  it('provides a command that is at least askable for every gallery entry', () => {
    // This is what the shell's grey-out relies on: an entry whose command threw or returned
    // undefined would open a gallery that cannot say whether it applies.
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');

    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid entry record.
      }

      const command = commandForStyle(entry.id);
      const askable = command(state);
      expect(typeof askable === 'boolean').toBe(true);
    }
  });

  it('round-trips when applying a style and then reading it back', () => {
    // This is the property that actually matters: the gallery marks what you picked,
    // so writing a style and reading it back must name the same entry — and it is
    // the one test that would catch the two halves drifting apart.
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid entry record.
      }

      const doc = docOf(para('plain'));
      const state = stateAt(doc, 'plain');
      const command = commandForStyle(entry.id);

      // Check whether applying the style command succeeds on the plain paragraph state.
      if (command(state)) {
        // Command succeeded: apply it to get the next state.
        const next = runOn(state, command);
        const nextState = stateAt(next.doc, 'plain');
        expect(styleIdAt(nextState)).toBe(entry.id);
      } else {
        // Command refused to apply on a plain paragraph (e.g. normal on normal): skip round-trip assertion.
      }
    }
  });
});

describe('canApplyStyle', () => {
  it('answers for an ordinary entry by dry running its command', () => {
    const state = stateAt(docOf(para('plain text')), 'plain text');
    expect(canApplyStyle('heading-1', state)).toBe(true);
  });

  it('reports false for an entry whose command cannot apply where the caret is', () => {
    // "Quote" is a style rather than a toggle: picking it while already in a plain quote would take the
    // quote away, so the entry reports that it has nothing to do.
    const state = stateAt(docOf(quote(para('already quoted'))), 'already quoted');
    expect(canApplyStyle('quote', state)).toBe(false);
  });

  it('enables the custom callout wherever a callout could go', () => {
    // The entry has no command of its own, because its word is asked for at the point of use. Before it
    // was given its own answer it fell through to the always-false command and showed up greyed out in
    // the gallery -- an entry the user could see and could not pick.
    const state = stateAt(docOf(para('plain text')), 'plain text');
    expect(canApplyStyle(CUSTOM_CALLOUT_ID, state)).toBe(true);
  });

  it('enables the custom callout on a block that is already a callout', () => {
    // Changing NOTE to NOTICE is the commonest use of the entry, so it has to be reachable from inside a
    // callout rather than only from plain text.
    const state = stateAt(docOf(quote(para('[!NOTE]'), para('body'))), 'body');
    expect(canApplyStyle(CUSTOM_CALLOUT_ID, state)).toBe(true);
  });

  it('leaves the document alone when it answers', () => {
    // The probe is a report, not an edit: the command runs without a dispatch. A probe that wrote its own
    // word would put [!NOTE] into the document every time the gallery was opened.
    const state = stateAt(docOf(para('plain text')), 'plain text');
    canApplyStyle(CUSTOM_CALLOUT_ID, state);
    expect(state.doc.textContent).toBe('plain text');
  });
});
