// @vitest-environment jsdom
/**
 * @file breadcrumb-bar.spec.ts
 * @purpose Exercises installBreadcrumbBar() end-to-end against a jsdom Document: empty state, outermost-first path rendering with current marking, crumb click reveal, placeholder text for empty headings, idempotent vs. forced rebuilds, teardown semantics, and token-only stylesheet colours.
 * @inputs Vitest callbacks (describe/it/expect/afterEach); the implementation under ../src/shell/breadcrumb-bar.js; OutlineEntry fixtures built by entry().
 * @outputs Assertion results covering DOM structure, aria attributes, delegated click routing, rebuild identity, and BREADCRUMB_BAR_STYLES contents.
 * @functions
 *   - entry: Builds an OutlineEntry fixture with a synthetic derived end offset.
 *   - install: Installs the breadcrumb bar (wired to revealed[]) and mounts it into document.body.
 *   - crumbs: Collects the rendered button.kdoc-breadcrumb nodes in DOM order.
 * @dataflow entry() fixtures → update()/click events → DOM mutations + revealed[] array → expect() assertions.
 * @controlflow describe groups twelve sequential it() cases; afterEach idempotently tears down and clears state between each case.
 * @version 1
 * @date 2026-09-13
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { OutlineEntry } from '@k-doc/core';
import { installBreadcrumbBar, BREADCRUMB_BAR_STYLES, type BreadcrumbBar } from '../src/shell/breadcrumb-bar.js';

/**
 * @purpose Builds an OutlineEntry fixture whose end is derived from its other fields.
 * @inputs text - heading label (may be empty or contain markup characters).
 *   depth - nesting level of the heading.
 *   start - zero-based character offset where the heading begins.
 *   index - 0-based position in the path (outermost first).
 * @returns an OutlineEntry with end = start + text.length + depth + 1.
 * @dataflow Four scalars → one OutlineEntry record.
 * @controlflow No branching; constructs and returns the object directly.
 */
function entry(text: string, depth: number, start: number, index: number): OutlineEntry {
  // end is a synthetic derived offset; no test asserts on it.
  return { text, depth, start, end: start + text.length + depth + 1, index };
}

let bar: BreadcrumbBar | undefined;
const revealed: OutlineEntry[] = [];

/**
 * @purpose Resets shared fixture state after each test.
 * @inputs void.
 * @outputs void.
 * @dataflow None; mutates module-level `bar` and `revealed`.
 * @controlflow Idempotent destroy via optional chaining, null the reference, clear the array.
 */
afterEach(() => {
  bar?.destroy();
  bar = undefined;
  revealed.length = 0;
});

/**
 * @purpose Installs a breadcrumb bar wired to the shared revealed[] sink and mounts it.
 * @inputs void; relies on module-level `bar` and `revealed`.
 * @returns the installed BreadcrumbBar instance.
 * @dataflow installBreadcrumbBar() → mounted <nav> + onReveal push into revealed[].
 * @controlflow Construct the bar, store it in `bar`, append to body, return it.
 */
function install(): BreadcrumbBar {
  bar = installBreadcrumbBar({ doc: document, onReveal: (e) => {
    revealed.push(e);
  }});
  document.body.appendChild(bar.element);
  return bar;
}

/**
 * @purpose Collects the rendered crumb buttons in DOM order.
 * @inputs void; relies on module-level `bar`.
 * @returns an array of HTMLButtonElement nodes matching button.kdoc-breadcrumb.
 * @dataflow bar.element.querySelectorAll → Array.from → ordered list.
 * @controlflow No branching; selects and converts to a plain array.
 */
function crumbs(): HTMLButtonElement[] {
  return Array.from(bar!.element.querySelectorAll('button.kdoc-breadcrumb'));
}

describe('breadcrumb-bar', () => {
  // The bar begins mounted in the empty (above-every-heading) state.
  it('starts in the empty state', () => {
    install();
    expect(bar!.element.tagName).toBe('NAV');
    expect(bar!.element.getAttribute('aria-label')).toBe('Heading path');
    expect(bar!.element.querySelector('.kdoc-breadcrumb-empty')?.textContent).toBe('Top of document');
    expect(crumbs()).toEqual([]);
  });

  // Headings render outermost first; only the innermost is marked current.
  it('renders the path outermost first and marks the last as current', () => {
    install();
    bar!.update([entry('Guide',1,0,0), entry('Install',2,10,1), entry('Windows',3,30,2)]);
    const cs = crumbs();
    expect(cs.map((c) => c.textContent)).toEqual(['Guide','Install','Windows']);
    expect(cs[0]?.getAttribute('aria-current')).toBeNull();
    expect(cs[1]?.getAttribute('aria-current')).toBeNull();
    expect(cs[2]?.getAttribute('aria-current')).toBe('location');
    expect(cs[1]?.title).toBe('Heading 2: Install');
  });

  // Clicking a crumb reveals the heading it names.
  it('clicking a crumb reveals that heading', () => {
    install();
    bar!.update([entry('Guide',1,0,0), entry('Install',2,10,1), entry('Windows',3,30,2)]);
    crumbs()[1]?.click();
    expect(revealed).toHaveLength(1);
    expect(revealed[0]?.text).toBe('Install');
  });

  // A click that lands on a non-crumb element reveals nothing.
  it('clicking outside a crumb reveals nothing', () => {
    install();
    bar!.update([entry('Guide',1,0,0)]);
    const ol = bar!.element.querySelector('ol');
    expect(ol).not.toBeNull();
    // Dispatch a bubbling click directly on the <ol>; its target is not a crumb.
    ol!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(revealed).toHaveLength(0);
  });

  // An empty heading label falls back to a placeholder string.
  it('an empty heading text gets a placeholder', () => {
    install();
    bar!.update([entry('',2,0,0)]);
    expect(crumbs()[0]?.textContent).toBe('Untitled heading');
  });

  // Re-rendering an equal-valued path leaves the DOM nodes untouched.
  it('an unchanged path does not rebuild the DOM', () => {
    install();
    const pathA = [entry('Guide',1,0,0), entry('Install',2,10,1)];
    bar!.update(pathA);
    const first = crumbs()[0];
    expect(first).toBeInstanceOf(HTMLButtonElement);
    // A fresh array of equal-valued entries must not trigger a rebuild.
    bar!.update([entry('Guide',1,0,0), entry('Install',2,10,1)]);
    expect(crumbs()[0]).toBe(first);
  });

  // A changed label forces the list to be rebuilt.
  it('a changed path does rebuild', () => {
    install();
    bar!.update([entry('Guide',1,0,0), entry('Install',2,10,1)]);
    const first = crumbs()[0];
    expect(first).toBeInstanceOf(HTMLButtonElement);
    bar!.update([entry('Guide',1,0,0), entry('Setup',2,10,1)]);
    expect(crumbs()[1]?.textContent).toBe('Setup');
    expect(crumbs()[0]).not.toBe(first);
  });

  // A change to a non-text field (start) at equal length also rebuilds.
  it('a path change at the same length but different start rebuilds', () => {
    install();
    bar!.update([entry('A',1,0,0)]);
    const first = crumbs()[0];
    expect(first).toBeInstanceOf(HTMLButtonElement);
    bar!.update([entry('A',1,5,0)]);
    expect(crumbs()[0]).not.toBe(first);
  });

  // Returning to an empty path restores the empty placeholder.
  it('going back to empty shows the empty state again', () => {
    install();
    bar!.update([entry('Guide',1,0,0)]);
    bar!.update([]);
    expect(bar!.element.querySelector('.kdoc-breadcrumb-empty')).not.toBeNull();
    expect(crumbs()).toEqual([]);
  });

  // Heading text is inserted as text, never parsed as markup.
  it('text is text, never markup', () => {
    install();
    bar!.update([entry('<b>x</b>',1,0,0)]);
    expect(bar!.element.querySelector('b')).toBeNull();
    expect(crumbs()[0]?.textContent).toBe('<b>x</b>');
  });

  // After destroy the element is detached and later updates are ignored.
  it('destroy removes the element and ignores later updates', () => {
    const b = install();
    b.destroy();
    bar = undefined;
    expect(b.element.isConnected).toBe(false);
    // A post-destroy update must be a no-op that neither throws nor re-renders.
    expect(() => b.update([entry('A',1,0,0)])).not.toThrow();
    expect(b.element.querySelector('button')).toBeNull();
  });

  // The stylesheet references only theme tokens for colour (no literal hex values).
  it('the stylesheet only uses theme tokens for colour', () => {
    expect(BREADCRUMB_BAR_STYLES).toContain('.kdoc-breadcrumbs');
    expect(BREADCRUMB_BAR_STYLES).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});