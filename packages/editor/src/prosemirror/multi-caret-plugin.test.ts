// @vitest-environment jsdom
/**
 * @file multi-caret-plugin.test.ts
 * @purpose Vitest test suite covering the multi-caret ProseMirror plugin, widget decorations, selection management, and the Ctrl+D next-occurrence command (FR-7.2).
 * @inputs Plain text fixtures, ProseMirror EditorView and EditorState instances, keyboard and transaction events.
 * @outputs Vitest assertions verifying caret count, widget DOM rendering, transaction mapping, Escape handling, and next occurrence resolution.
 * @functions
 *   - docOf: Builds a ProseMirror doc node containing paragraph children corresponding to the provided text strings.
 *   - mount: Instantiates an EditorView with the multi-caret plugin and tracks the view and its container for cleanup.
 *   - carets: Queries the active extra caret document positions from the given editor view.
 *   - run: Executes a ProseMirror command against an editor view, dispatching any resulting transaction.
 *   - stateOf: Initializes a standalone EditorState with the multi-caret plugin without mounting a DOM view.
 * @dataflow Text strings -> docOf -> mount / stateOf -> multi-caret commands and transactions -> DOM widgets and plugin state -> Vitest assertions.
 * @controlflow Mount EditorView -> execute multi-caret commands -> assert caret positions and widget DOM -> test occurrence search and selection -> clean up via afterEach.
 * @version 2
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  createMultiCaretPlugin,
  extraCarets,
  addCaret,
  clearCarets,
  MULTI_CARET_CLASS,
  MULTI_CARET_STYLES,
} from './multi-caret-plugin.js';
import { wordAround, findOccurrence, addNextOccurrence } from './multi-caret-occurrence.js';

const views: EditorView[] = [];
const roots: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    // Check if view at current index is defined.
    if (view !== undefined) {
      view.destroy();
    } else {
      // Branch: Undefined view.
    }
  }
  views.length = 0;

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    // Check if root at current index is defined.
    if (root !== undefined) {
      root.remove();
    } else {
      // Branch: Undefined root element.
    }
  }
  roots.length = 0;
});

/**
 * Constructs a ProseMirror document containing paragraph nodes corresponding to the provided text strings.
 *
 * Note that a doc of one paragraph puts its text at positions 1..(1 + length): the paragraph's own opening token occupies position 0.
 *
 * @purpose Builds a ProseMirror doc node with paragraph children for multi-caret plugin testing.
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
 * Mounts an EditorView with the multi-caret plugin enabled inside a container attached to document.body.
 *
 * @purpose Creates an EditorView tracking instance with the multi-caret plugin and initial caret position.
 * @inputs
 *   - doc: ProseMirrorNode - The document node to initialize the editor with.
 *   - caretAt: number - The initial document position for the primary text selection.
 * @outputs EditorView - The instantiated and tracked ProseMirror EditorView.
 * @dataflow doc + caretAt -> EditorState with createMultiCaretPlugin -> new EditorView in container -> push to tracking arrays -> return view.
 * @controlflow Create div root element -> append to document.body -> build EditorState -> construct EditorView -> record root and view -> return view.
 */
function mount(doc: ProseMirrorNode, caretAt: number): EditorView {
  const root: HTMLElement = document.createElement('div');
  document.body.appendChild(root);
  roots.push(root);

  const state: EditorState = EditorState.create({
    schema: kdocSchema,
    doc,
    selection: TextSelection.create(doc, caretAt),
    plugins: [createMultiCaretPlugin()],
  });

  const view: EditorView = new EditorView(root, { state });
  views.push(view);
  return view;
}

/**
 * Retrieves the extra caret positions from the view's current editor state.
 *
 * @purpose Queries the multi-caret plugin state from the view to inspect active extra carets.
 * @inputs view: EditorView - The editor view to read state from.
 * @outputs readonly number[] - Array of extra caret document positions.
 * @dataflow view.state -> extraCarets -> readonly number[].
 * @controlflow Read state from view -> delegate to extraCarets -> return positions.
 */
function carets(view: EditorView): readonly number[] {
  return extraCarets(view.state);
}

/**
 * Executes a ProseMirror command against an editor view, dispatching any resulting transaction.
 *
 * @purpose Runs a command function with the view state and dispatch callback.
 * @inputs
 *   - view: EditorView - The editor view against which the command executes.
 *   - command: Command - The ProseMirror command to execute.
 * @outputs boolean - True if the command handled the transaction, false otherwise.
 * @dataflow view.state + view.dispatch -> command -> boolean.
 * @controlflow Invoke command passing view.state and view.dispatch.bind(view) -> return boolean result.
 */
function run(view: EditorView, command: Command): boolean {
  return command(view.state, view.dispatch.bind(view));
}

/**
 * Creates a standalone EditorState with the multi-caret plugin without mounting an EditorView in the DOM.
 *
 * @purpose Initializes an EditorState for pure occurrence and state testing.
 * @inputs
 *   - doc: ProseMirrorNode - The document node for the editor state.
 *   - caretAt: number - The initial document position for the primary text selection.
 * @outputs EditorState - The constructed ProseMirror EditorState.
 * @dataflow doc + caretAt -> TextSelection.create -> EditorState.create with createMultiCaretPlugin -> EditorState.
 * @controlflow Create TextSelection at caretAt -> instantiate EditorState with kdocSchema and multi-caret plugin -> return state.
 */
function stateOf(doc: ProseMirrorNode, caretAt: number): EditorState {
  return EditorState.create({
    schema: kdocSchema,
    doc,
    selection: TextSelection.create(doc, caretAt),
    plugins: [createMultiCaretPlugin()],
  });
}

describe('the plugin', (): void => {
  it('starts with one caret', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    expect(carets(view)).toHaveLength(0);
  });

  it('adds and clears carets through its commands', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    expect(run(view, addCaret(5))).toBe(true);
    expect(carets(view)).toEqual([5]);
    expect(run(view, clearCarets())).toBe(true);
    expect(carets(view)).toHaveLength(0);
  });

  it('clearCarets declines when there is nothing to clear', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    // Returning false lets Escape keep whatever else it does.
    expect(run(view, clearCarets())).toBe(false);
  });

  it('toggles a caret back off', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(5));
    run(view, addCaret(5));
    expect(carets(view)).toHaveLength(0);
  });

  it('paints a caret widget at each extra', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(3));
    run(view, addCaret(6));
    expect(view.dom.querySelectorAll('.' + MULTI_CARET_CLASS).length).toBe(2);
  });

  it('the caret widget carries no text', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(5));
    const widget = view.dom.querySelector<HTMLElement>('.' + MULTI_CARET_CLASS);
    // Check if the caret widget DOM element was rendered.
    if (widget === null) {
      expect.fail('Expected multi-caret widget element to be rendered');
    } else {
      // A caret is a painted line, not a character, and a widget with text in it would be text the document does not contain.
      expect(widget.textContent).toBe('');
      expect(widget.getAttribute('contenteditable')).toBe('false');
    }
  });

  it('drops a caret that lands on the primary selection', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(3));
    // A caret that is also the selection would apply every edit twice.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(carets(view)).toHaveLength(0);
  });

  it('maps its carets through an edit', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(10));
    view.dispatch(view.state.tr.insertText('xx', 1));
    expect(carets(view)).toEqual([12]);
  });

  it('Escape clears the carets', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    run(view, addCaret(5));
    const handled = view.someProp('handleKeyDown', (f): boolean | void =>
      f(view, new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(handled).toBe(true);
    expect(carets(view)).toHaveLength(0);
  });

  it('Escape is left alone when there is one caret', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    const handled = view.someProp('handleKeyDown', (f): boolean | void =>
      f(view, new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(handled ?? false).toBe(false);
  });

  it('exports styles that name its own class', (): void => {
    expect(MULTI_CARET_STYLES).toContain(MULTI_CARET_CLASS);
    expect(MULTI_CARET_STYLES).toContain('kdoc-caret-blink');
  });

  it('paints nothing for a caret outside the document', (): void => {
    const view = mount(docOf('alpha bravo charlie'), 1);
    const beyond: number = view.state.doc.content.size + 50;

    // This pins ProseMirror's own behaviour, which the plugin relies on: a widget decoration past the
    // end of the document is accepted and simply not painted. It does not throw -- that was checked by
    // running it -- which is why the plugin carries no bounds check of its own. Should a future version
    // start throwing, this test is what says so.
    expect((): void => {
      run(view, addCaret(beyond));
    }).not.toThrow();

    expect(view.dom.querySelectorAll('.' + MULTI_CARET_CLASS).length).toBe(0);
  });
});

describe('the next occurrence', (): void => {
  it('finds the word around a position', (): void => {
    expect(wordAround(stateOf(docOf('the cat sat on the mat'), 1), 6)).toEqual({
      word: 'cat',
      from: 5,
      to: 8,
    });
  });

  it('has no word in an empty paragraph', (): void => {
    expect(wordAround(stateOf(docOf(''), 1), 1)).toBeNull();
  });

  it('matches whole words only', (): void => {
    const state = stateOf(docOf('in inside pin in'), 1);
    // Without a whole-word test, adding the next in would land inside point, into and binding.
    const expected = 1 + 'in inside pin '.length;
    expect(findOccurrence(state, 'in', 1)).toBe(expected);
  });

  it('wraps to the top', (): void => {
    const state = stateOf(docOf('cat dog cat'), 1);
    expect(findOccurrence(state, 'cat', 1 + 'cat dog cat'.length)).toBe(1);
  });

  it('reports none when there is only the one', (): void => {
    const state = stateOf(docOf('unique'), 1);
    expect(findOccurrence(state, 'unique', 1)).toBeNull();
  });

  it('the first press selects the word', (): void => {
    const view = mount(docOf('the cat sat on the mat'), 6);
    // The first press selects what you are on, the second starts adding, which is what every other editor does and gives the user something to see before anything is duplicated.
    expect(run(view, addNextOccurrence())).toBe(true);
    expect(carets(view)).toHaveLength(0);
    expect(view.state.selection.from).toBe(5);
    expect(view.state.selection.to).toBe(8);
  });

  it('the second press adds a caret at the next occurrence', (): void => {
    const view = mount(docOf('the cat sat on the mat'), 6);
    run(view, addNextOccurrence());
    run(view, addNextOccurrence());
    expect(carets(view)).toHaveLength(1);
  });

  it('declines where there is no word', (): void => {
    const view = mount(docOf(''), 1);
    // Nothing to match, so the keystroke falls through rather than appearing to work.
    expect(run(view, addNextOccurrence())).toBe(false);
  });
});
