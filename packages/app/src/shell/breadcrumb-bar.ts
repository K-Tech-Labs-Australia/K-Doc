/**
 * @file breadcrumb-bar.ts
 * @purpose Renders a compact breadcrumb bar that shows the heading path leading to the caret.
 * @inputs BreadcrumbBarOptions containing the host Document and an onReveal callback; heading OutlineEntry paths via update().
 * @outputs A DOM <nav> element exposing update() and destroy(); CSS string for styling.
 * @functions
 *   - samePath: Compares two entry paths for equality ignoring object identity.
 *   - installBreadcrumbBar: Builds, mounts, and returns the breadcrumb bar instance.
 * @dataflow OutlineEntry path → update() → DOM list rebuild → click events → onReveal(entry).
 * @controlflow Install creates element + listener → update([]) seeds empty state → clicks dispatch onReveal → destroy tears down.
 * @version 4
 * @date 2026-10-04
 */

import type { OutlineEntry } from '@k-doc/core';
// OutlineEntry = { depth: number; text: string; start: number; end: number; index: number }

export interface BreadcrumbBarOptions {
  readonly doc: Document;
  /** Called when a crumb is clicked, with the heading it names. */
  readonly onReveal: (entry: OutlineEntry) => void;
}

export interface BreadcrumbBar {
  readonly element: HTMLElement;
  /** Shows this heading path, outermost first. An empty path means the caret is above every heading. */
  update(path: readonly OutlineEntry[]): void;
  destroy(): void;
}

/**
 * Static stylesheet for the heading breadcrumb bar, styling the transparent strip,
 * outlined breadcrumb chips, separator chevrons, the current location crumb in the tertiary container,
 * and rounded corners using exclusively authoritative K-Doc chrome design tokens.
 */
export const BREADCRUMB_BAR_STYLES: string = `
.kdoc-breadcrumbs {
  display: flex;
  align-items: center;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  background: transparent;
  border: 0;
  min-height: 0;
  padding: 0 8px 0 0;
  flex: 0 1 auto;
  min-width: 0;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-breadcrumbs ol {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
  gap: 2px;
}

.kdoc-breadcrumbs li {
  display: flex;
  align-items: center;
  min-width: 0;
}

.kdoc-breadcrumbs li + li::before {
  content: '›';
  padding: 0 6px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-breadcrumb {
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-sm);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font-size: 12.5px;
  font-weight: 550;
}

.kdoc-breadcrumb:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-breadcrumb:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-breadcrumb[aria-current="location"] {
  background: var(--kdoc-chrome-tertiary-container);
  color: var(--kdoc-chrome-on-tertiary-container);
  border-color: var(--kdoc-chrome-tertiary);
  font-weight: 700;
}

.kdoc-breadcrumb-empty {
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  padding: 2px 4px;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-breadcrumbs * {
    transition: none !important;
  }
}
`;

/**
 * @purpose Reports whether two entry paths name the identical heading sequence.
 * @inputs a - first path of outline entries (may be empty).
 *   b - second path of outline entries (may be empty).
 * @returns true when both paths share length and equal start, depth, and text at every index.
 * @dataflow Two entry arrays → per-index field comparison → boolean result.
 * @controlflow Reject differing lengths up front; otherwise compare each index's fields with undefined guards.
 */
function samePath(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
  // Guard against length mismatch so later indexed reads never hit undefined entries.
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const entryA = a[i];
    const entryB = b[i];
    // Compare the three identity-defining fields, tolerating undefined entries.
    if (entryA?.start !== entryB?.start || entryA?.depth !== entryB?.depth || entryA?.text !== entryB?.text) {
      return false;
    }
  }
  return true;
}

/**
 * @purpose Creates and mounts a breadcrumb bar that reflects the caret's heading path.
 * @inputs options.doc - host Document used to build all nodes.
 *   options.onReveal - callback invoked with the OutlineEntry of a clicked crumb.
 * @returns A BreadcrumbBar exposing element, update(), and destroy().
 * @dataflow Options → DOM tree + click listener → update() drives rebuilds → clicks route to onReveal.
 * @controlflow Wire controller/flags → build nav/list → attach delegated click handler → seed empty path → return instance.
 */
export function installBreadcrumbBar(options: BreadcrumbBarOptions): BreadcrumbBar {
  const controller = new AbortController();
  let entries: readonly OutlineEntry[] = [];
  let rendered = false;
  let destroyed = false;

  const element = options.doc.createElement('nav');
  element.className = 'kdoc-breadcrumbs';
  element.setAttribute('aria-label', 'Heading path');
  const list = options.doc.createElement('ol');
  element.appendChild(list);

  /**
   * @purpose Resolves a clicked crumb and reveals its heading via onReveal.
   * @inputs event - MouseEvent dispatched from within the breadcrumb bar.
   * @outputs void; calls options.onReveal when a crumb is targeted.
   * @dataflow Click target → closest button.kdoc-breadcrumb → data-index → entries[i] → onReveal.
   * @controlflow Bail unless an element and crumb; parse index and reveal the matching entry.
   */
  function handler(event: MouseEvent): void {
    // Ignore clicks that did not originate on a DOM element.
    if (!(event.target instanceof Element)) {
      return;
    }
    // Locate the nearest breadcrumb button within the clicked subtree.
    const button = event.target.closest('button.kdoc-breadcrumb');
    // Not a crumb click: bail without revealing anything.
    if (!(button instanceof HTMLElement)) {
      return;
    }
    // Read the 0-based index stored on the crumb and resolve its entry.
    const i = Number.parseInt(button.dataset['index'] ?? '', 10);
    const entry = entries[i];
    // Only reveal when a valid entry exists for this index.
    if (entry !== undefined) {
      options.onReveal(entry);
    }
  }

  element.addEventListener('click', handler, { signal: controller.signal });

  /**
   * @purpose Rebuilds the crumb list to reflect a new heading path.
   * @inputs path - ordered outline entries from outermost to innermost heading.
   * @outputs void; mutates the internal <ol> and cached entries.
   * @dataflow Path → equality check → replaceChildren() → rebuild list items or placeholder.
   * @controlflow Skip when destroyed or unchanged; otherwise clear and re-render.
   */
  function update(path: readonly OutlineEntry[]): void {
    // Do nothing once the bar has been torn down.
    if (destroyed) {
      return;
    }
    // Skip rebuild when the path is unchanged from what is already rendered.
    if (rendered && samePath(entries, path)) {
      return;
    }
    entries = path;
    rendered = true;
    list.replaceChildren();

    // Empty path means the caret sits above every heading: show a placeholder crumb.
    if (path.length === 0) {
      const li = options.doc.createElement('li');
      const span = options.doc.createElement('span');
      span.className = 'kdoc-breadcrumb-empty';
      span.textContent = 'Top of document';
      li.appendChild(span);
      list.appendChild(li);
      return;
    }

    // Otherwise render one crumb per heading, outermost first.
    for (let i = 0; i < path.length; i++) {
      const entry = path[i];
      // Guard the indexed read; the loop bound means it is always defined.
      if (entry === undefined) {
        continue;
      }
      const li = options.doc.createElement('li');
      const button = options.doc.createElement('button');
      button.type = 'button';
      button.className = 'kdoc-breadcrumb';
      // Store the 0-based position so the click handler can resolve this crumb.
      button.dataset['index'] = String(i);
      // Prefer the real heading text, falling back to a placeholder when empty.
      const text = entry.text.length > 0 ? entry.text : 'Untitled heading';
      button.textContent = text;
      button.title = `Heading ${entry.depth}: ${text}`;
      li.appendChild(button);

      // Mark the innermost crumb as the current location for assistive tech.
      if (i === path.length - 1) {
        button.setAttribute('aria-current', 'location');
      }

      list.appendChild(li);
    }
  }

  /**
   * @purpose Tears down the breadcrumb bar, detaching it and cancelling its listener.
   * @inputs void.
   * @outputs void; performs cleanup of DOM node and AbortController.
   * @dataflow None; releases resources only.
   * @controlflow Idempotent guard, then abort controller and remove element.
   */
  function destroy(): void {
    // Idempotent: ignore a second call after teardown.
    if (destroyed) {
      return;
    }
    destroyed = true;
    // Cancel the delegated listener and detach the element from the DOM.
    controller.abort();
    element.remove();
  }

  update([]);

  return { element, update, destroy };
}