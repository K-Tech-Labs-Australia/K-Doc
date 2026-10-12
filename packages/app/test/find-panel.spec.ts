// @vitest-environment jsdom

/**
 * @file find-panel.spec.ts
 * @purpose Vitest test suite for K-Doc's find and replace toolbar component (@k-doc/app).
 *   Validates opening/closing transitions, document-level keyboard shortcuts, source-text search queries,
 *   regex and case options, navigation with wraparound, match replacement preserving untouched bytes, and lifecycle teardown under jsdom.
 * @inputs Markdown test fixtures, synthetic DOM keyboard/input/click events, and DocumentSession state mutations.
 * @outputs Vitest assertions verifying DOM element visibility, role attributes, status and error messages, button disabled/pressed states, range revelations, and replaced session text.
 * @functions
 *   - mountElement: Creates a container div element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *   - mountPanel: Instantiates a DocumentSession and FindPanel mounted on a dedicated DOM container with callback recording.
 *   - button: Queries a button element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *   - input: Queries an input element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *   - statusReadout: Queries the status element with role="status" inside a container, throwing a descriptive error if missing.
 *   - errorAlert: Queries the error alert element with role="alert" inside a container, throwing a descriptive error if missing.
 * @dataflow Markdown fixture -> DocumentSession & installFindPanel -> DOM & keyboard events -> search/replace actions -> status/reveal assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across opening/closing, searching, navigation, replacing, and lifecycle -> destroy controllers and detach DOM mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import type { SearchMatch } from '@k-doc/core';
import { installFindPanel, type FindPanel } from '../src/shell/find-panel.js';

let activeMounts: HTMLElement[] = [];
let activePanels: FindPanel[] = [];

/**
 * Creates a container div element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *
 * @purpose Allocates and attaches a mount DOM container to document.body for find panel hosting.
 * @inputs void.
 * @outputs HTMLElement - The newly created and attached DOM container element.
 * @dataflow document.createElement -> document.body.appendChild -> tracked in activeMounts -> return element.
 * @controlflow Create div element -> append to document.body -> record in activeMounts array -> return element.
 */
function mountElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  activeMounts.push(element);
  return element;
}

/**
 * Instantiates a DocumentSession and FindPanel mounted on a dedicated DOM element with mock callback recorders.
 *
 * @purpose Sets up an integrated test harness with document session, find panel controller, and callback invocation recorders.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @outputs Object containing container, session, panel controller, revealed range recorder, applied text recorder, closed counter, and errors array.
 * @dataflow markdown -> DocumentSession -> installFindPanel -> return harness record.
 * @controlflow Create container element -> initialize DocumentSession -> call installFindPanel with recording callbacks -> register panel in activePanels -> return harness object.
 */
function mountPanel(markdown: string, selection?: { readonly start: number; readonly end: number } | null): {
  container: HTMLElement;
  session: DocumentSession;
  panel: FindPanel;
  revealed: { calls: Array<{ start: number; end: number }> };
  applied: { calls: string[] };
  closed: { count: number };
  errors: string[];
  matched: { calls: Array<{ count: number; activeIndex: number }> };
} {
  const container = mountElement();
  const session = new DocumentSession(markdown);
  const revealed: { calls: Array<{ start: number; end: number }> } = { calls: [] };
  const applied: { calls: string[] } = { calls: [] };
  const closed: { count: number } = { count: 0 };
  const errors: string[] = [];
  const matched: { calls: Array<{ count: number; activeIndex: number }> } = { calls: [] };

  const panel = installFindPanel({
    container,
    doc: document,
    session,
    readSelection: (): { readonly start: number; readonly end: number } | null => {
      return selection ?? null;
    },
    // Only the count and the active index are recorded, because the match objects themselves are already covered by the search tests and repeating them here would pin the same thing twice.
    onMatches: (matches: readonly SearchMatch[], activeIndex: number): void => {
      matched.calls.push({ count: matches.length, activeIndex });
    },

    revealRange: (start: number, end: number): void => {
      revealed.calls.push({ start, end });
    },
    applyText: (next: string): void => {
      applied.calls.push(next);
      // Mirrors the shell exactly. Borrowing the Source pane's lock via applyText looks equivalent and
      // is not: the bindings read the lock as the edit's origin, so the Source pane would discard the
      // change as its own echo and the two panes would disagree about the document.
      session.applyExternalText(next);
    },
    onClose: (): void => {
      closed.count += 1;
    },
    onError: (message: string): void => {
      errors.push(message);
    },
  });
  activePanels.push(panel);

  return {
    container,
    session,
    panel,
    revealed,
    applied,
    closed,
    errors,
    matched,
  };
}

/**
 * Queries a button element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *
 * @purpose Locates a button by its accessible name rather than DOM index, failing fast with a descriptive error when not found.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the toolbar buttons.
 *   - label: string - The exact aria-label string to locate.
 * @outputs HTMLButtonElement - The matching button DOM element.
 * @dataflow container.querySelector with aria-label selector -> validate found -> return HTMLButtonElement.
 * @controlflow Query button with aria-label selector -> check if null -> if null throw descriptive Error -> return button element.
 */
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // Check if the button element with the specified aria-label was found in the container.
  if (btn === null) {
    // Button not found: throw descriptive named error to identify missing control.
    throw new Error(`No button labelled "${label}" found in find panel container`);
  } else {
    // Button found: return element.
  }
  return btn;
}

/**
 * Queries an input element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *
 * @purpose Locates an input by its accessible name, failing fast with a descriptive error when not found.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the input fields.
 *   - label: string - The exact aria-label string to locate.
 * @outputs HTMLInputElement - The matching input DOM element.
 * @dataflow container.querySelector with aria-label selector -> validate found -> return HTMLInputElement.
 * @controlflow Query input with aria-label selector -> check if null -> if null throw descriptive Error -> return input element.
 */
function input(container: HTMLElement, label: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  // Check if the input element with the specified aria-label was found in the container.
  if (el === null) {
    // Input not found: throw descriptive named error.
    throw new Error(`No input labelled "${label}" found in find panel container`);
  } else {
    // Input found: return element.
  }
  return el;
}

/**
 * Queries the status element with role="status" inside a container, throwing a descriptive error if missing.
 *
 * @purpose Locates the match readout status container, failing fast with a descriptive error when not found.
 * @inputs container: HTMLElement - The parent DOM container hosting the find panel.
 * @outputs HTMLElement - The matching status readout DOM element.
 * @dataflow container.querySelector with role="status" selector -> validate found -> return HTMLElement.
 * @controlflow Query element with [role="status"] -> check if null -> if null throw descriptive Error -> return element.
 */
function statusReadout(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="status"]');
  // Check if the status element was found in the container.
  if (el === null) {
    // Status element not found: throw descriptive named error.
    throw new Error('No element with role="status" found in find panel container');
  } else {
    // Status element found: return element.
  }
  return el;
}

/**
 * Queries the error alert element with role="alert" inside a container, throwing a descriptive error if missing.
 *
 * @purpose Locates the regex error alert container, failing fast with a descriptive error when not found.
 * @inputs container: HTMLElement - The parent DOM container hosting the find panel.
 * @outputs HTMLElement - The matching error alert DOM element.
 * @dataflow container.querySelector with role="alert" selector -> validate found -> return HTMLElement.
 * @controlflow Query element with [role="alert"] -> check if null -> if null throw descriptive Error -> return element.
 */
function errorAlert(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="alert"]');
  // Check if the error alert element was found in the container.
  if (el === null) {
    // Error alert element not found: throw descriptive named error.
    throw new Error('No element with role="alert" found in find panel container');
  } else {
    // Error alert element found: return element.
  }
  return el;
}

describe('FindPanel', () => {
  beforeEach(() => {
    activeMounts = [];
    activePanels = [];
  });

  afterEach(() => {
    for (const panel of activePanels) {
      panel.destroy();
    }
    activePanels = [];

    for (const mount of activeMounts) {
      // Check if mount element is currently attached to the DOM.
      if (mount.parentNode !== null) {
        mount.parentNode.removeChild(mount);
      } else {
        // Mount element already detached.
      }
    }
    activeMounts = [];
  });

  describe('opening and closing', () => {
    it('searches the whole document until the option is on', () => {
    // Pins that search-in-selection is off by default: a find box that silently searched only part of the document would be the worst kind of wrong.
    const { container, panel } = mountPanel('alpha beta alpha gamma alpha\n', { start: 0, end: 16 });
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    // The option is off, so all three document-wide matches are reported.
    expect(container.textContent).toContain('1 of 3');
  });

  it('narrows to the captured selection', () => {
    // Pins that enabling the button drops the out-of-range match at offset 23, leaving the two matches inside [0, 16).
    const { container, panel } = mountPanel('alpha beta alpha gamma alpha\n', { start: 0, end: 16 });
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    const inSelectionBtn = button(container, 'Search in selection');
    inSelectionBtn.click();

    // Matches at 0 and 11 fall inside [0, 16); the match at 23 does not.
    expect(container.textContent).toContain('1 of 2');
    expect(inSelectionBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('refuses to turn on without a selection', () => {
    // Pins that the toggle refuses to engage with no selection, since a pressed button that changes nothing is worse than one that refuses to press.
    const { container, panel } = mountPanel('alpha beta alpha gamma alpha\n', null);
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    const inSelectionBtn = button(container, 'Search in selection');
    inSelectionBtn.click();

    // No selection means the toggle cannot engage and the search stays document-wide.
    expect(inSelectionBtn.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('1 of 3');
  });

  it('excludes a match that straddles the edge', () => {
    // Pins that "in selection" means the whole match must lie inside the range, since replacing half a word is not what was asked for.
    const { container, panel } = mountPanel('alpha beta alpha gamma alpha\n', { start: 0, end: 14 });
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    const inSelectionBtn = button(container, 'Search in selection');
    inSelectionBtn.click();

    // The range [0, 14) contains the first match whole but cuts through the second (11..16), so only one match survives.
    expect(container.textContent).toContain('1 of 1');
  });

  it('reports the match list to the host', () => {
    // Pins that every search result is pushed up via onMatches, since the host paints those matches and the panel knows nothing about those surfaces — reporting is the whole interface between them.
    const { container, panel, matched } = mountPanel('alpha beta alpha gamma alpha\n');
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    // The last report reflects the final query; guard the read because noUncheckedIndexedAccess makes it unknown.
    const last = matched.calls[matched.calls.length - 1];
    if (last === undefined) {
      // No match reports were recorded, so there is nothing to assert against.
      throw new Error('Expected at least one onMatches report before asserting the match list');
    } else {
      // A report exists: assert it carried all three matches for this query.
      expect(last.count).toBe(3);
    }
  });

  it('reports an empty list when the panel closes', () => {
    // Pins that closing reports an empty match list, so a hidden panel does not leave the document painted with matches nobody is looking for.
    const { container, panel, matched } = mountPanel('alpha beta alpha gamma alpha\n');
    panel.open('find');

    const findInp = input(container, 'Find');
    findInp.value = 'alpha';
    findInp.dispatchEvent(new Event('input', { bubbles: true }));

    panel.close();

    // The final report after close must be the empty list; guard the read because noUncheckedIndexedAccess makes it unknown.
    const last = matched.calls[matched.calls.length - 1];
    if (last === undefined) {
      // No match reports were recorded, so there is nothing to assert against.
      throw new Error('Expected at least one onMatches report before asserting the empty list');
    } else {
      // A report exists: assert it cleared the match list and reset the active index.
      expect(last).toEqual({ count: 0, activeIndex: -1 });
    }
  });

  it('starts with the container hidden and isOpen as false', () => {
      const { container, panel } = mountPanel('Sample text\n');
      expect(container.hidden).toBe(true);
      expect(panel.isOpen).toBe(false);
    });

    it('unhides the container, sets isOpen to true, and leaves the replace row hidden on open("find")', () => {
      const { container, panel } = mountPanel('Sample text\n');
      panel.open('find');
      expect(container.hidden).toBe(false);
      expect(panel.isOpen).toBe(true);
      const replaceRow = input(container, 'Replace').closest<HTMLElement>('.kdoc-find-row');
      expect(replaceRow?.hidden).toBe(true);
    });

    it('shows the replace row on open("replace")', () => {
      const { container, panel } = mountPanel('Sample text\n');
      panel.open('replace');
      expect(container.hidden).toBe(false);
      expect(panel.isOpen).toBe(true);
      const replaceRow = input(container, 'Replace').closest<HTMLElement>('.kdoc-find-row');
      expect(replaceRow?.hidden).toBe(false);
    });

    it('hides the container, sets isOpen to false, and calls onClose exactly once on close()', () => {
      const { container, panel, closed } = mountPanel('Sample text\n');
      panel.open('find');
      panel.close();

      // Escape otherwise strands focus on a hidden input, and K-Doc keys its edit lock on which pane holds focus, so the next keystroke would be lost.
      expect(container.hidden).toBe(true);
      expect(panel.isOpen).toBe(false);
      expect(closed.count).toBe(1);
    });

    it('opens find mode and prevents default on Ctrl+F document keydown', () => {
      const { container, panel } = mountPanel('Sample text\n');
      const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      // Without preventDefault the browser's own find bar takes the keystroke and the app's never appears.
      expect(event.defaultPrevented).toBe(true);
      expect(panel.isOpen).toBe(true);
      expect(container.hidden).toBe(false);
      const replaceRow = input(container, 'Replace').closest<HTMLElement>('.kdoc-find-row');
      expect(replaceRow?.hidden).toBe(true);
    });

    it('leaves Ctrl+F to the host when it does not own its shortcuts', () => {
      // mountPanel always installs with default options (ownShortcuts on), so this test builds its own panel
      // with ownShortcuts: false to pin that a non-owning panel hands Ctrl+F back to the document instead of opening.
      const container = mountElement();
      const session = new DocumentSession('Sample text\n');
      const panel = installFindPanel({
        container,
        doc: document,
        session,
        readSelection: (): { readonly start: number; readonly end: number } | null => null,
        onMatches: (): void => {},
        revealRange: (): void => {},
        applyText: (next: string): void => {
          session.applyExternalText(next);
        },
        onClose: (): void => {},
        onError: (): void => {},
        ownShortcuts: false,
      });

      // A document-level Ctrl+F reaches this panel's handler; with it not owning shortcuts the handler declines.
      const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      // ownShortcuts:false means the panel neither prevents default nor opens, leaving Ctrl+F free for the host/browser.
      expect(event.defaultPrevented).toBe(false);
      expect(panel.isOpen).toBe(false);
      expect(container.hidden).toBe(true);

      panel.destroy();
    });

    it('opens replace mode on Ctrl+H document keydown', () => {
      const { container, panel } = mountPanel('Sample text\n');
      const event = new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(panel.isOpen).toBe(true);
      expect(container.hidden).toBe(false);
      const replaceRow = input(container, 'Replace').closest<HTMLElement>('.kdoc-find-row');
      expect(replaceRow?.hidden).toBe(false);
    });

    it('closes the panel on Escape keydown inside the container', () => {
      const { container, panel, closed } = mountPanel('Sample text\n');
      panel.open('find');
      const findInp = input(container, 'Find');
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      findInp.dispatchEvent(escEvent);

      expect(escEvent.defaultPrevented).toBe(true);
      expect(panel.isOpen).toBe(false);
      expect(container.hidden).toBe(true);
      expect(closed.count).toBe(1);
    });
  });

  describe('searching', () => {
    it('reports "1 of 2" in the status readout when querying "cat" on "cat bat cat\\n"', () => {
      const { container } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(statusReadout(container).textContent).toBe('1 of 2');
    });

    it('reports the empty string rather than "No results" on an empty query', () => {
      const { container } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');

      // An empty query reports the empty string, not "No results" — an empty find box has not searched yet, and "No results" reads as a failure.
      findInp.value = '';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(statusReadout(container).textContent).toBe('');
    });

    it('reports "No results" for a query with no matches', () => {
      const { container } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'dog';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(statusReadout(container).textContent).toBe('No results');
    });

    it('searches Markdown syntax in the source text', () => {
      const { container } = mountPanel('see [docs](https://x)\n');
      const findInp = input(container, 'Find');
      findInp.value = '](';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(statusReadout(container).textContent).toBe('1 of 1');
    });

    it('filters matches when Match case toggle is enabled', () => {
      const { container } = mountPanel('Cat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));
      expect(statusReadout(container).textContent).toBe('1 of 2');

      const caseBtn = button(container, 'Match case');
      caseBtn.click();

      expect(caseBtn.getAttribute('aria-pressed')).toBe('true');
      expect(statusReadout(container).textContent).toBe('1 of 1');
    });

    it('matches regular expressions when Regular expression toggle is enabled', () => {
      const { container } = mountPanel('abc adc\n');
      const regexBtn = button(container, 'Regular expression');
      regexBtn.click();
      expect(regexBtn.getAttribute('aria-pressed')).toBe('true');

      const findInp = input(container, 'Find');
      findInp.value = 'a.c';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(statusReadout(container).textContent).toBe('1 of 2');
    });

    it('displays an error in the role="alert" element and reports "No results" for an invalid regular expression', () => {
      const { container } = mountPanel('abc adc\n');
      const regexBtn = button(container, 'Regular expression');
      regexBtn.click();

      const findInp = input(container, 'Find');
      findInp.value = '[unclosed';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const alertEl = errorAlert(container);
      expect(alertEl.hidden).toBe(false);
      expect(alertEl.textContent?.trim().length).toBeGreaterThan(0);
      expect(statusReadout(container).textContent).toBe('No results');
    });

    it('clears the error alert once a subsequent query parses successfully', () => {
      const { container } = mountPanel('abc adc\n');
      const regexBtn = button(container, 'Regular expression');
      regexBtn.click();

      const findInp = input(container, 'Find');
      findInp.value = '[unclosed';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));
      const alertEl = errorAlert(container);
      expect(alertEl.hidden).toBe(false);

      findInp.value = 'abc';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      expect(alertEl.hidden).toBe(true);
      expect(alertEl.textContent).toBe('');
      expect(statusReadout(container).textContent).toBe('1 of 1');
    });
  });

  describe('navigation', () => {
    it('calls revealRange with the first match offsets on clicking Next', () => {
      const { container, revealed } = mountPanel('cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const nextBtn = button(container, 'Next');
      nextBtn.click();

      expect(revealed.calls.length).toBe(1);
      expect(revealed.calls[0]).toEqual({ start: 0, end: 3 });
    });

    it('moves to the second match with a larger start offset on clicking Next twice', () => {
      const { container, revealed } = mountPanel('cat cat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const nextBtn = button(container, 'Next');
      nextBtn.click();
      nextBtn.click();

      expect(revealed.calls.length).toBe(2);
      const firstCall = revealed.calls[0];
      const secondCall = revealed.calls[1];
      expect(firstCall).toBeDefined();
      expect(secondCall).toBeDefined();
      expect(secondCall?.start).toBeGreaterThan(firstCall?.start ?? 0);
    });

    it('wraps from the last match to the first match on clicking Next', () => {
      const { container, revealed } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const nextBtn = button(container, 'Next');
      nextBtn.click();
      nextBtn.click();

      expect(revealed.calls.length).toBe(2);
      const wrapCall = revealed.calls[1];
      expect(wrapCall).toBeDefined();
      expect(wrapCall).toEqual({ start: 0, end: 3 });
      expect(statusReadout(container).textContent).toBe('1 of 2');
    });

    it('wraps from the first match to the last match on clicking Previous', () => {
      const { container, revealed } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const prevBtn = button(container, 'Previous');
      prevBtn.click();

      expect(revealed.calls.length).toBe(1);
      const wrapPrev = revealed.calls[0];
      expect(wrapPrev).toBeDefined();
      expect(wrapPrev).toEqual({ start: 8, end: 11 });
      expect(statusReadout(container).textContent).toBe('2 of 2');
    });

    it('disables Next and Previous buttons when there are no matches', () => {
      const { container } = mountPanel('cat bat cat\n');
      const findInp = input(container, 'Find');
      findInp.value = 'dog';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const nextBtn = button(container, 'Next');
      const prevBtn = button(container, 'Previous');

      expect(nextBtn.disabled).toBe(true);
      expect(prevBtn.disabled).toBe(true);
    });
  });

  describe('replacing', () => {
    it('substitutes only the current match on Replace', () => {
      const { container, panel, session, applied } = mountPanel('cat bat cat\n');
      panel.open('replace');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceInp = input(container, 'Replace');
      replaceInp.value = 'dog';
      replaceInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceBtn = button(container, 'Replace');
      replaceBtn.click();

      expect(session.snapshot.text).toBe('dog bat cat\n');
      expect(applied.calls.length).toBe(1);
      expect(applied.calls[0]).toBe('dog bat cat\n');
    });

    it('substitutes every match and reports the replacement count on Replace all', () => {
      const { container, panel, session, applied } = mountPanel('cat bat cat\n');
      panel.open('replace');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceInp = input(container, 'Replace');
      replaceInp.value = 'dog';
      replaceInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceAllBtn = button(container, 'Replace all');
      replaceAllBtn.click();

      expect(session.snapshot.text).toBe('dog bat dog\n');
      expect(applied.calls.length).toBe(1);
      expect(applied.calls[0]).toBe('dog bat dog\n');
      expect(statusReadout(container).textContent).toBe('Replaced 2');
    });

    it('does nothing on Replace when there is no current match', () => {
      const { container, panel, applied } = mountPanel('cat bat cat\n');
      panel.open('replace');
      const findInp = input(container, 'Find');
      findInp.value = 'xyz';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceInp = input(container, 'Replace');
      replaceInp.value = 'dog';
      replaceInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceBtn = button(container, 'Replace');
      replaceBtn.click();

      expect(applied.calls.length).toBe(0);
    });

    it('preserves untouched bytes in the document during replacement', () => {
      const initialDoc = '# T\n\n*   Odd bullet\n\ncat\n';
      const { container, panel, session } = mountPanel(initialDoc);
      panel.open('replace');
      const findInp = input(container, 'Find');
      findInp.value = 'cat';
      findInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceInp = input(container, 'Replace');
      replaceInp.value = 'dog';
      replaceInp.dispatchEvent(new Event('input', { bubbles: true }));

      const replaceBtn = button(container, 'Replace');
      replaceBtn.click();

      // This is the incremental serializer's guarantee (FR-4.2): a whole-document reserialization would silently normalise that bullet to "-   Odd bullet".
      expect(session.snapshot.text).toBe('# T\n\n*   Odd bullet\n\ndog\n');
      expect(session.snapshot.text).toContain('*   Odd bullet');
    });
  });

  describe('lifecycle', () => {
    it('empties the container on destroy()', () => {
      const { container, panel } = mountPanel('Sample text\n');
      expect(container.children.length).toBeGreaterThan(0);

      panel.destroy();
      expect(container.children.length).toBe(0);
    });

    it('handles multiple destroy() calls idempotently without throwing', () => {
      const { panel } = mountPanel('Sample text\n');
      expect(() => {
        panel.destroy();
        panel.destroy();
      }).not.toThrow();
    });

    it('handles refresh() after destroy() without throwing', () => {
      const { panel } = mountPanel('Sample text\n');
      panel.destroy();
      expect(() => {
        panel.refresh();
      }).not.toThrow();
    });

    it('does not reopen the panel on Ctrl+F after destroy()', () => {
      const { container, panel } = mountPanel('Sample text\n');
      panel.destroy();

      const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      expect(panel.isOpen).toBe(false);
      expect(container.hidden).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
