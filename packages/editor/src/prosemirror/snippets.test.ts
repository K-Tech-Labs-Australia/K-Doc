// @vitest-environment jsdom
/**
 * @file snippets.test.ts
 * @purpose Tests snippet expansion and tab-stop navigation in WYSIWYG (FR-7.10).
 * @inputs markdown fixtures and simulated Tab/Escape key events.
 * @outputs vitest assertions.
 * @functions
 *   - viewWith: Builds an EditorView seeded from a markdown string with the snippet plugin.
 *   - tab: Dispatches a simulated Tab (or Shift+Tab) keydown on the editor DOM.
 *   - type: Inserts text at the current selection via a transaction.
 *   - selected: Returns the currently selected document text.
 *   - markdownOf: Serializes a ProseMirror node back to markdown for assertions.
 * @dataflow markdown -> editor view -> key events -> document and selection assertions.
 * @controlflow each case builds a fresh view, afterEach destroys it.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, parseSnippetBody, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { createSnippetPlugin, markStops, snippetPluginKey, snippetPrefixAt, SNIPPET_STOP_CLASS } from './snippets.js';
import type { SnippetOptions } from './snippets.js';

const ITEMS: Readonly<Record<string, string>> = {
  hello: 'Hello ${1:name}, see **${2:this}** and ${1:again}$0',
  link: '[${1:text}](${2:https://})$0',
  table: '| ${1:A} | ${2:B} |\n| --- | --- |\n| $3 | $4 |\n$0',
  today: 'On $DATE$0',
};

const NOW = new Date(2026, 8, 16, 9, 5);

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

function viewWith(markdown: string, options: () => SnippetOptions = () => ({ enabled: true, items: ITEMS })): EditorView {
  const doc = mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
  const state = EditorState.create({ doc, plugins: [createSnippetPlugin(options, () => NOW)] });
  const view = new EditorView(document.body.appendChild(document.createElement('div')), { state });
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  views.push(view);
  return view;
}

function tab(view: EditorView, shift = false): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.insertText(text, from, to));
}

function selected(view: EditorView): string {
  const { from, to } = view.state.selection;
  return view.state.doc.textBetween(from, to);
}

function markdownOf(doc: ProseMirrorNode): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(doc), frontMatter: null });
}

describe('snippets', () => {
  // Expanding a prefix inline should replace it and walk through each tab stop in order.
  it('expands a prefix inline and walks its stops', () => {
    const view = viewWith('Say hello\n');
    expect(tab(view)).toBe(true);
    expect(view.state.doc.textContent).toBe('Say Hello name, see this and again');
    expect(selected(view)).toBe('name');
    type(view, 'Ann');
    expect(tab(view)).toBe(true);
    expect(selected(view)).toBe('this');
    expect(markdownOf(view.state.doc)).toBe('Say Hello Ann, see **this** and again\n');
    expect(tab(view)).toBe(true);
    expect(view.state.selection.empty).toBe(true);
    expect(snippetPluginKey.getState(view.state)).toBeNull();
  });

  // Shift+Tab moves backward; at the first stop it should not advance further back.
  it('goes back with Shift+Tab and stays on the first stop', () => {
    const view = viewWith('hello\n');
    tab(view);
    tab(view);
    expect(selected(view)).toBe('this');
    expect(tab(view, true)).toBe(true);
    expect(selected(view)).toBe('name');
    expect(tab(view, true)).toBe(true);
    expect(selected(view)).toBe('name');
  });

  // A block snippet inserts a table-like body with stops positioned in its cells.
  it('inserts a block body with stops in its cells', () => {
    const view = viewWith('table\n');
    tab(view);
    expect(selected(view)).toBe('A');
    tab(view);
    expect(selected(view)).toBe('B');
  });

  // Stops inside a link destination must be skipped during navigation.
  it('skips a stop inside a link destination', () => {
    const view = viewWith('link\n');
    tab(view);
    expect(selected(view)).toBe('text');
    expect(markdownOf(view.state.doc)).toBe('[text](https://)\n');
    type(view, 'D');
    type(view, 'ocs');
    expect(markdownOf(view.state.doc)).toBe('[Docs](https://)\n');
    tab(view);
    expect(view.state.selection.empty).toBe(true);
    type(view, ' more');
    expect(markdownOf(view.state.doc)).toBe('[Docs](https://) more\n');
  });

  // Date placeholders are filled with the injected current date.
  it('fills in the date', () => {
    const view = viewWith('today\n');
    tab(view);
    expect(view.state.doc.textContent).toBe('On 2026-09-16');
    expect(snippetPluginKey.getState(view.state)).toBeNull();
  });

  // A body whose only stop lands outside the text still expands and leaves the caret after it.
  it('expands a body whose stops all fall away', () => {
    const view = viewWith('pic\n', () => ({ enabled: true, items: { pic: '![a](${0:p.png})' } }));
    expect(tab(view)).toBe(true);
    expect(markdownOf(view.state.doc)).toBe('![a](p.png)\n');
    expect(view.state.selection.empty).toBe(true);
  });

  // A body over several lines is inserted as blocks, not merged into the paragraph.
  it('inserts a multi-line body as blocks', () => {
    const view = viewWith('x two\n', () => ({ enabled: true, items: { two: 'a\nb$0' } }));
    tab(view);
    expect(view.state.doc.childCount).toBe(2);
  });

  // DOM nodes for still-ahead stops carry the highlight class.
  it('highlights the stops still ahead', () => {
    const view = viewWith('hello\n');
    tab(view);
    const texts = [...view.dom.querySelectorAll(`.${SNIPPET_STOP_CLASS}`)].map((span) => span.textContent);
    expect(texts).toEqual(['name', 'this']);
  });

  // The session ends on Escape or when the caret moves outside the expanded region.
  it('ends the session on Escape or when the caret leaves', () => {
    const escaped = viewWith('hello\n');
    tab(escaped);
    escaped.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(snippetPluginKey.getState(escaped.state)).toBeNull();
    const left = viewWith('Before\n\nhello\n');
    tab(left);
    left.dispatch(left.state.tr.setSelection(TextSelection.create(left.state.doc, 2)));
    expect(snippetPluginKey.getState(left.state)).toBeNull();
  });

  // The expansion is one transaction marked structural, which K-Doc's session keeps as its own undo step.
  it('expands in one structural transaction', () => {
    const view = viewWith('Say hello\n');
    const metas: unknown[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (tr): void => {
      metas.push(tr.getMeta('kdocStructural'));
      dispatch(tr);
    };
    tab(view);
    expect(metas).toEqual([true]);
  });

  // Tab is ignored without a prefix, when disabled, or inside inline code.
  it('leaves Tab alone without a prefix, when off, or in code', () => {
    expect(tab(viewWith('nothing\n'))).toBe(false);
    expect(tab(viewWith('hello\n', () => ({ enabled: false, items: ITEMS })))).toBe(false);
    const code = viewWith('`hello`\n');
    code.dispatch(code.state.tr.setSelection(TextSelection.create(code.state.doc, 6)));
    expect(tab(code)).toBe(false);
  });

  // A snippet prefix must begin at a word boundary to match.
  it('needs the prefix to start a word', () => {
    expect(snippetPrefixAt(viewWith('xhello\n').state, ITEMS)).toBeNull();
    expect(snippetPrefixAt(viewWith('a (hello\n').state, ITEMS)?.prefix).toBe('hello');
    expect(snippetPrefixAt(viewWith('a ((x\n').state, { '(x': 'short', '((x': 'long' })?.prefix).toBe('((x');
    const ranged = viewWith('hello world\n');
    ranged.dispatch(ranged.state.tr.setSelection(TextSelection.create(ranged.state.doc, 6, 8)));
    expect(snippetPrefixAt(ranged.state, ITEMS)).toBeNull();
  });

  // markStops wraps each stop with start and end marker characters.
  it('marks the start and end of every stop', () => {
    const parsed = parseSnippetBody('${1:ab}$2c$0', NOW);
    const m = (code: number): string => String.fromCharCode(0xe000 + code);
    expect(markStops(parsed.text, parsed.stops)).toBe(m(0) + 'ab' + m(1) + m(2) + m(3) + 'c' + m(4) + m(5));
  });
});
