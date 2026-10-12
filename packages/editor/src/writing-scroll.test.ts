// @vitest-environment jsdom
/**
 * @file writing-scroll.test.ts
 * @purpose Tests Typewriter-mode scrolling with layout stubbed (jsdom has none): the scroll container lookup, centring, and both panes' typewriter updates.
 * @inputs stubbed element sizes and caret coordinates.
 * @outputs assertions on scrollTop after each interaction.
 * @functions
 *   - stubBox: attaches fake clientHeight/scrollHeight and a getBoundingClientRect to an element.
 *   - scroller: appends a scrolling container with stubbed geometry for tests to target.
 * @dataflow stubs -> functions/plugins -> scrollTop.
 * @controlflow one case per rule.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState as PMState, TextSelection } from 'prosemirror-state';
import { EditorView as PMView } from 'prosemirror-view';
import { EditorView as CMView } from '@codemirror/view';
import { parseMarkdown } from '@k-doc/core';
import { centreInContainer, scrollContainerOf } from './writing-scroll.js';
import { createWritingModesPlugin, type WritingModes } from './prosemirror/writing-modes.js';
import { refreshWritingModes, writingModes } from './codemirror/writing-modes.js';
import { kdocSchema } from './prosemirror/schema.js';
import { mdastToProseMirror } from './prosemirror/from-mdast.js';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

// stubBox gives an element a size and client rectangle, since jsdom lays nothing out.
function stubBox(element: HTMLElement, top: number, height: number, scrollHeight: number): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  element.getBoundingClientRect = (): DOMRect => ({ top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) });
}

// scroller makes a 400px-tall scrolling box at top 100 with 2000px of content.
function scroller(): HTMLElement {
  const outer = document.body.appendChild(document.createElement('div'));
  outer.style.overflowY = 'auto';
  stubBox(outer, 100, 400, 2000);
  cleanups.push(() => outer.remove());
  return outer;
}

describe('scrollContainerOf', () => {
  // the walk starts at the element and returns the first scrolling ancestor.
  it('finds the nearest ancestor that scrolls, starting at the element', () => {
    const outer = scroller();
    const inner = outer.appendChild(document.createElement('div'));
    const leaf = inner.appendChild(document.createElement('span'));
    expect(scrollContainerOf(leaf)).toBe(outer);
    expect(scrollContainerOf(outer)).toBe(outer);
    inner.style.overflowY = 'scroll';
    stubBox(inner, 100, 50, 60);
    expect(scrollContainerOf(leaf)).toBe(inner);
  });

  // overflow auto with content that fits does not count, nor does hidden overflow.
  it('skips elements that could scroll but have nothing to scroll, and hidden overflow', () => {
    const outer = scroller();
    const inner = outer.appendChild(document.createElement('div'));
    inner.style.overflowY = 'auto';
    stubBox(inner, 100, 50, 50);
    expect(scrollContainerOf(inner)).toBe(outer);
    outer.style.overflowY = 'hidden';
    expect(scrollContainerOf(inner)).toBeNull();
  });
});

describe('centreInContainer', () => {
  // a caret centred at 500 in a box centred at 300 scrolls 200, and a sub-pixel difference (second call: centre 300.4 vs 300 -> 0.4) is left alone.
  it('scrolls by the distance between the caret middle and the container middle', () => {
    const outer = scroller();
    outer.scrollTop = 0;
    centreInContainer(outer, 490, 510);
    expect(outer.scrollTop).toBe(200);
    centreInContainer(outer, 300.4, 300.4);
    expect(outer.scrollTop).toBe(200);
  });
});

describe('typewriter updates', () => {
  // no scroll without focus or on a transaction that moved nothing; scrolls on selection and text changes; not when the mode is off.
  it('centres the WYSIWYG caret after it moves, only with focus and the mode on', () => {
    const outer = scroller();
    let modes: WritingModes = { focus: 'off', typewriter: true };
    const doc = mdastToProseMirror(parseMarkdown('One\n\nTwo\n').root, kdocSchema);
    const view = new PMView(outer.appendChild(document.createElement('div')), { state: PMState.create({ doc, plugins: [createWritingModesPlugin(() => modes)] }) });
    cleanups.push(() => view.destroy());
    let focused = false;
    view.hasFocus = (): boolean => focused;
    view.coordsAtPos = (): { top: number; bottom: number; left: number; right: number } => ({ top: 390, bottom: 410, left: 0, right: 0 });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(outer.scrollTop).toBe(0);
    focused = true;
    view.dispatch(view.state.tr.setMeta('unrelated', true));
    expect(outer.scrollTop).toBe(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(outer.scrollTop).toBe(100);
    outer.scrollTop = 0;
    view.dispatch(view.state.tr.insertText('x', 3));
    expect(outer.scrollTop).toBe(100);
    outer.scrollTop = 0;
    const caretBefore = view.state.selection.head;
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
    expect(view.state.selection.head).toBe(caretBefore);
    expect(outer.scrollTop).toBe(100);
    outer.scrollTop = 0;
    modes = { focus: 'off', typewriter: false };
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(outer.scrollTop).toBe(0);
  });

  // the Source pane centres in CodeMirror's measure pass, and not with the mode off.
  it('redraws Source focus marks when the caret moves or the modes change', () => {
    // The plugin rebuilds its marks on a refresh and on caret moves, reading the modes through the getter.
    let modes: WritingModes = { focus: 'off', typewriter: false };
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new CMView({ doc: 'One.\n\nTwo.\n\nThree.', parent, extensions: [writingModes(() => modes)] });
    cleanups.push(() => {
      view.destroy();
      parent.remove();
    });
    const dimmed = (): string[] => [...view.contentDOM.querySelectorAll('.kdoc-focus-dim')].map((span) => span.textContent ?? '');
    expect(dimmed()).toEqual([]);
    modes = { focus: 'paragraph', typewriter: false };
    refreshWritingModes(view);
    expect(dimmed().join('|')).not.toContain('One.');
    view.dispatch({ selection: { anchor: 7 } });
    expect(dimmed().join('|')).toContain('One.');
    expect(dimmed().join('|')).not.toContain('Two.');
  });

  it('does not scroll when the Source caret has no coordinates', async () => {
    // A caret outside the rendered viewport has no coordinates; the measure pass must leave the scroll alone without failing.
    const outer = scroller();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      errors.push(args);
    };
    cleanups.push(() => {
      console.error = original;
    });
    const view = new CMView({ doc: 'One\n\nTwo\n', parent: outer, extensions: [writingModes(() => ({ focus: 'off', typewriter: true }))] });
    cleanups.push(() => view.destroy());
    Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
    view.coordsAtPos = (): null => null;
    view.dispatch({ selection: { anchor: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outer.scrollTop).toBe(0);
    expect(errors).toEqual([]);
  });

  it('centres the Source caret in a measure pass after it moves', async () => {
    const outer = scroller();
    let modes: WritingModes = { focus: 'off', typewriter: true };
    const view = new CMView({ doc: 'One\n\nTwo\n', parent: outer, extensions: [writingModes(() => modes)] });
    cleanups.push(() => view.destroy());
    Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true });
    view.coordsAtPos = (): { top: number; bottom: number; left: number; right: number } => ({ top: 590, bottom: 610, left: 0, right: 0 });
    view.dispatch({ selection: { anchor: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outer.scrollTop).toBe(300);
    outer.scrollTop = 0;
    modes = { focus: 'off', typewriter: false };
    view.dispatch({ selection: { anchor: 6 } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outer.scrollTop).toBe(0);
  });
});
