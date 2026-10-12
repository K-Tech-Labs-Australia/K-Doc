// @vitest-environment jsdom
/**
 * @file format-painter.test.ts
 * @purpose Verifies the ProseMirror format painter plugin's pick-up, paint, lock, and lifecycle behavior.
 * @inputs Markdown strings, ProseMirror documents, EditorState instances, DOM events, and command handlers.
 * @outputs Boolean/structural assertions via vitest; no values are exported from this file.
 * @functions
 *   - docOf: Builds a ProseMirror document from markdown using the kdoc schema.
 *   - markdownOf: Serializes a ProseMirror document back to markdown text.
 *   - rangeOf: Locates the character range of a needle within a document, throwing if absent.
 *   - stateWith: Builds an EditorState seeded with markdown and a selection over given text.
 *   - run: Executes a command against a state, capturing the resulting state from dispatched transactions.
 *   - viewOf: Instantiates an EditorView attached to the DOM for the given state.
 * @dataflow Markdown → docOf → ProseMirror node → rangeOf/stateWith → commands → assertions; DOM events → view handlers → state mutations → assertions.
 * @controlflow Module setup stubs document.elementFromPoint (absent in jsdom) and registers afterEach cleanup; describe groups each behavior into a single it() that seeds state, runs an action, and asserts the outcome.
 * @version 2
 * @date 2026-10-06
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import {
  createFormatPainterPlugin,
  formatPainterState,
  marksToPaint,
  paintFormat,
  pickUpFormat,
  stopFormatPainter,
  wordRangeAt,
  FORMAT_PAINTER_ACTIVE_CLASS,
} from './format-painter.js';

const views: EditorView[] = [];

// jsdom has no layout, so it leaves out document.elementFromPoint. ProseMirror's own mousedown handler calls it
// through posAtCoords, and the throw escapes the event listener as an unhandled error. Null is what a real
// browser returns for a point over nothing, and ProseMirror falls back to the editor's box.
beforeAll(() => {
  document.elementFromPoint = (): Element | null => null;
});

afterAll(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
});

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

// Builds a ProseMirror document from markdown using the kdoc schema.
// @purpose Produces the parse tree that every test mutates or inspects.
// @inputs markdown - Source markdown string to parse.
// @outputs ProseMirrorNode - Root node of the parsed document.
// @dataflow Markdown → parseMarkdown root → mdastToProseMirror → kdocSchema → document node.
// @controlflow Sequential, no branching.
function docOf(markdown: string): ProseMirrorNode {
  return mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
}

// Serializes a ProseMirror document back to markdown text.
// @purpose Inverts docOf so painted mutations can be asserted as source strings.
// @inputs doc - ProseMirror node tree to serialize.
// @outputs string - Markdown representation of the document.
// @dataflow Document node → proseMirrorToMdast → serializeDocument → markdown string.
// @controlflow Sequential, no branching.
function markdownOf(doc: ProseMirrorNode): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(doc), frontMatter: null });
}

// Locates the character range of a needle within a document, throwing if absent.
// @purpose Supplies deterministic from/to offsets for selection and painting targets.
// @inputs doc - Document to search; needle - Substring whose first occurrence is located.
// @outputs { from, to } - Half-open character range enclosing the needle.
// @dataflow Document descendants → text node scan → indexOf offset arithmetic → range.
// @controlflow Walks nodes until the needle is found (early stop) or exhausted; throws when missing.
function rangeOf(doc: ProseMirrorNode, needle: string): { from: number; to: number } {
  const holder: { range: { from: number; to: number } | null } = { range: null };
  doc.descendants((node, pos) => {
    if (holder.range === null && node.isText && node.text !== undefined && node.text.includes(needle)) {
      const from = pos + node.text.indexOf(needle);
      holder.range = { from, to: from + needle.length };
    } else {
      // Node did not contain the needle (or a range was already captured): leave holder.range unchanged.
    }
    return holder.range === null;
  });
  if (holder.range === null) {
    throw new Error(`missing ${needle}`);
  } else {
    return holder.range;
  }
}

// Builds an EditorState seeded with markdown and a selection over given text.
// @purpose Combines docOf with rangeOf to produce a ready-to-act state whose selection targets `selected`.
// @inputs markdown - Source document; selected - Text defining the initial selection range.
// @outputs EditorState - State carrying the parsed doc, painter plugin, and a TextSelection.
// @dataflow Markdown → docOf → rangeOf offsets → TextSelection → EditorState.create with plugin.
// @controlflow Sequential, no branching.
function stateWith(markdown: string, selected: string): EditorState {
  const doc = docOf(markdown);
  const { from, to } = rangeOf(doc, selected);
  return EditorState.create({ doc, plugins: [createFormatPainterPlugin()], selection: TextSelection.create(doc, from, to) });
}

// Executes a command against a state, capturing the resulting state from dispatched transactions.
// @purpose Runs side-effecting commands (which mutate via dispatch) and returns the applied state.
// @inputs state - Base EditorState; command - Painter command returning success boolean.
// @outputs EditorState - State after any transaction the command dispatched.
// @dataflow Command → dispatch(tr) → state.apply(tr) → captured next state.
// @controlflow Initializes next to input, reassigns on each dispatch, returns final state.
function run(state: EditorState, command: (state: EditorState, dispatch: (tr: import('prosemirror-state').Transaction) => void) => boolean): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

// Instantiates an EditorView attached to the DOM for the given state.
// @purpose Provides a live view so key/mouse handlers and class-list effects can be exercised.
// @inputs state - EditorState to render.
// @outputs EditorView - Mounted view tracked for afterEach cleanup.
// @dataflow State → EditorView constructor → appended <div> body child.
// @controlflow Sequential; registers the view so afterEach destroys it.
function viewOf(state: EditorState): EditorView {
  const view = new EditorView(document.body.appendChild(document.createElement('div')), { state });
  views.push(view);
  return view;
}

describe('format painter', () => {
  // Asserts that character marks at the selection start are collected as painter input.
  it('picks up the character formatting at the start of the selection', () => {
    const state = stateWith('Some ***styled*** text and [a link](https://x.example).\n', 'styled');
    expect(marksToPaint(state).map((mark) => mark.type.name).sort()).toEqual(['emphasis', 'strong']);
  });

  // Asserts that link marks are excluded from the picked-up format.
  it('does not pick up links', () => {
    const state = stateWith('Some ***styled*** text and [a link](https://x.example).\n', 'a link');
    expect(marksToPaint(state)).toEqual([]);
  });

  // Asserts that typing-format marks at a caret are captured without a selection.
  it('picks up the marks typing would get at a caret', () => {
    const doc = docOf('A **bold** word.\n');
    const { from } = rangeOf(doc, 'bold');
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, from + 2) });
    expect(marksToPaint(state).map((mark) => mark.type.name)).toEqual(['strong']);
  });

  // Asserts painting replaces target formatting and disables the painter afterward.
  it('replaces the formatting of the painted range and turns off', () => {
    let state = stateWith('Copy **this** onto ~~that~~ word.\n', 'this');
    state = run(state, pickUpFormat(false));
    expect(formatPainterState(state).marks?.map((mark) => mark.type.name)).toEqual(['strong']);
    const { from, to } = rangeOf(state.doc, 'that');
    state = run(state, paintFormat(from, to));
    expect(markdownOf(state.doc)).toBe('Copy **this** onto **that** word.\n');
    expect(formatPainterState(state).marks).toBeNull();
  });

  // Asserts plain-text pickup clears existing formatting on paint.
  it('clears formatting when plain text was picked up', () => {
    let state = stateWith('Plain and **bold** here.\n', 'Plain');
    state = run(state, pickUpFormat(false));
    const { from, to } = rangeOf(state.doc, 'bold');
    state = run(state, paintFormat(from, to));
    expect(markdownOf(state.doc)).toBe('Plain and bold here.\n');
  });

  // Asserts locked mode persists across multiple paints.
  it('stays on when locked', () => {
    let state = stateWith('Copy **this** onto that and those.\n', 'this');
    state = run(state, pickUpFormat(true));
    const that = rangeOf(state.doc, 'that');
    state = run(state, paintFormat(that.from, that.to));
    const those = rangeOf(state.doc, 'those');
    state = run(state, paintFormat(those.from, those.to));
    expect(markdownOf(state.doc)).toBe('Copy **this** onto **that** and **those**.\n');
    expect(formatPainterState(state).locked).toBe(true);
  });

  // Asserts painting is rejected when off or over an empty range, and that stopping clears marks.
  it('refuses to paint while off or over an empty range', () => {
    const state = stateWith('Copy **this** onto that.\n', 'this');
    expect(paintFormat(1, 4)(state)).toBe(false);
    const active = run(state, pickUpFormat(false));
    expect(paintFormat(4, 4)(active)).toBe(false);
    expect(paintFormat(1, 4)(active)).toBe(true);
    expect(formatPainterState(run(active, stopFormatPainter())).marks).toBeNull();
    expect(stopFormatPainter()(state)).toBe(false);
  });

  // Asserts word-range detection around a caret boundary.
  it('finds the word under a caret', () => {
    const doc = docOf('hello world, again\n');
    const { from } = rangeOf(doc, 'world');
    expect(wordRangeAt(doc, from + 2)).toEqual({ from, to: from + 5 });
    expect(wordRangeAt(doc, from + 5)).toEqual({ from, to: from + 5 });
    expect(wordRangeAt(doc, from)).toEqual({ from, to: from + 5 });
    const comma = rangeOf(doc, ', ');
    expect(wordRangeAt(doc, comma.from + 1)).toBeNull();
    expect(wordRangeAt(doc, 0)).toBeNull();
  });

  // Asserts the active class toggles with painter state.
  it('marks the editor while the painter is on', () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'this'));
    expect(view.dom.classList.contains(FORMAT_PAINTER_ACTIVE_CLASS)).toBe(false);
    pickUpFormat(false)(view.state, view.dispatch);
    expect(view.dom.classList.contains(FORMAT_PAINTER_ACTIVE_CLASS)).toBe(true);
  });

  // Asserts Escape stops the painter.
  it('turns off on Escape', () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'this'));
    pickUpFormat(true)(view.state, view.dispatch);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(formatPainterState(view.state).marks).toBeNull();
  });

  // Asserts mouse-up paints the current selection.
  it('paints the selection when the mouse is released', async () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'this'));
    pickUpFormat(false)(view.state, view.dispatch);
    const { from, to } = rangeOf(view.state.doc, 'that');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markdownOf(view.state.doc)).toBe('Copy **this** onto **that**.\n');
  });

  // Asserts a drag that is released outside the editor still paints.
  it('paints when the mouse is released outside the editor', async () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'this'));
    pickUpFormat(false)(view.state, view.dispatch);
    const { from, to } = rangeOf(view.state.doc, 'that');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markdownOf(view.state.doc)).toBe('Copy **this** onto **that**.\n');
  });

  // Asserts mouse-up paints the word under the caret.
  it('paints the word under a click', async () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'this'));
    pickUpFormat(false)(view.state, view.dispatch);
    const { from } = rangeOf(view.state.doc, 'onto');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1)));
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markdownOf(view.state.doc)).toBe('Copy **this** **onto** that.\n');
  });

  // Asserts mouse-up does nothing while the painter is off.
  it('ignores mouse releases while off', async () => {
    const view = viewOf(stateWith('Copy **this** onto that.\n', 'that'));
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markdownOf(view.state.doc)).toBe('Copy **this** onto that.\n');
  });
});
