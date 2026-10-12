// @vitest-environment jsdom
/**
 * @file link-follow-plugin.test.ts
 * @purpose Tests Ctrl+Click link following and its ordering ahead of multi-caret (FR-8.13).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { kdocSchema } from './schema.js';
import { createLinkFollowPlugin, linkHrefAt } from './link-follow-plugin.js';
import { createMultiCaretPlugin, extraCarets } from './multi-caret-plugin.js';

const views: EditorView[] = [];
afterEach((): void => {
  for (const view of views) {
    const host = view.dom.parentElement;
    view.destroy();
    host?.remove();
  }
  views.length = 0;
});

function mount(followed: string[]): EditorView {
  const link = kdocSchema.marks['link'];
  const para = kdocSchema.nodes['paragraph'];
  if (link === undefined || para === undefined) {
    throw new Error('schema is missing link or paragraph');
  }
  const doc = kdocSchema.node('doc', null, [
    para.create(null, [
      kdocSchema.text('See '),
      kdocSchema.text('the guide', [link.create({ href: 'guides/setup.md', title: null })]),
      kdocSchema.text(' now.'),
    ]),
  ]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, {
    state: EditorState.create({
      doc,
      plugins: [createLinkFollowPlugin({ onFollow: (href: string): void => { followed.push(href); } }), createMultiCaretPlugin()],
    }),
  });
  views.push(view);
  return view;
}

function anchor(view: EditorView): HTMLAnchorElement {
  const a = view.dom.querySelector('a[href]');
  if (!(a instanceof HTMLAnchorElement)) {
    throw new Error('no rendered link');
  }
  return a;
}

function clickOn(view: EditorView, target: Element, init: MouseEventInit): { handled: boolean; event: MouseEvent } {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  const handled = view.someProp('handleClick', (f) => f(view, 5, event)) === true;
  return { handled, event };
}

describe('linkHrefAt', (): void => {
  it('returns the href for the rendered anchor and its first child text node', (): void => {
    const view = mount([]);
    const a = anchor(view);
    expect(linkHrefAt(view.dom, a)).toBe('guides/setup.md');
    expect(linkHrefAt(view.dom, a.firstChild as Text)).toBe('guides/setup.md');
  });

  it('returns null for the paragraph element', (): void => {
    const view = mount([]);
    const para = anchor(view).parentElement;
    // Guard against a missing parent so `para` is narrowed to non-null below.
    if (para === null) {
      throw new Error('expected a parent paragraph element');
    }
    expect(linkHrefAt(view.dom, para)).toBeNull();
  });

  it('returns null for an anchor outside the editor', (): void => {
    const view = mount([]);
    const outside = document.createElement('a');
    outside.setAttribute('href', 'elsewhere');
    document.body.appendChild(outside);
    expect(linkHrefAt(view.dom, outside)).toBeNull();
    outside.remove();
  });

  it('returns null for a null target', (): void => {
    const view = mount([]);
    expect(linkHrefAt(view.dom, null)).toBeNull();
  });
});

describe('createLinkFollowPlugin', (): void => {
  it('follows on Ctrl+click of the anchor', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const a = anchor(view);
    const { handled, event } = clickOn(view, a, { ctrlKey: true });
    expect(followed).toEqual(['guides/setup.md']);
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('follows on Meta+click of the anchor', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const a = anchor(view);
    const { handled, event } = clickOn(view, a, { metaKey: true });
    expect(followed).toEqual(['guides/setup.md']);
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not follow on a plain click of the anchor', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const a = anchor(view);
    const { handled, event } = clickOn(view, a, {});
    expect(followed).toEqual([]);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets multi-caret handle a Ctrl+click that is not on a link', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const para = anchor(view).parentElement;
    // Guard against a missing parent so `para` is narrowed to non-null below.
    if (para === null) {
      throw new Error('expected a parent paragraph element');
    }
    const { handled } = clickOn(view, para, { ctrlKey: true });
    expect(followed).toEqual([]);
    expect(handled).toBe(true);
    expect(extraCarets(view.state)).toHaveLength(1);
  });

  it('does not add a caret on Ctrl+click of the anchor', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const a = anchor(view);
    clickOn(view, a, { ctrlKey: true });
    expect(extraCarets(view.state)).toHaveLength(0);
  });

  it('prevents default through the DOM click handler on Ctrl+click', (): void => {
    const followed: string[] = [];
    const view = mount(followed);
    const a = anchor(view);
    const e1 = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    a.dispatchEvent(e1);
    view.someProp('handleDOMEvents', (h) => { h.click?.(view, e1 as PointerEvent); return undefined; });
    expect(e1.defaultPrevented).toBe(true);
    const e2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(e2);
    view.someProp('handleDOMEvents', (h) => { h.click?.(view, e2 as PointerEvent); return undefined; });
    expect(e2.defaultPrevented).toBe(false);
  });
});
