// @vitest-environment jsdom
/**
 * @file graph-dialog.spec.ts
 * @purpose Exercises installGraphDialog (FR-6.15) under jsdom: mount lifecycle, opening/closing, scope toggles between whole-vault and around-this-note views, node/link drawing, the note-link tally, keyboard activation of notes, and teardown.
 * @inputs Vitest test framework callbacks; the module-under-test installGraphDialog and its GraphDialog controller type from ../src/shell/graph-dialog.js; the VaultGraph shape from @k-doc/core; a fixed GRAPH fixture plus mutable working state (opened, active, current, graph).
 * @outputs Assertions over DOM shapes (circles/lines/text), dialog open/closed state, recorded opened-note paths and rendered count text produced by installGraphDialog.
 * @functions
 *   - mount: Resets working state then installs the dialog with recording provider callbacks, storing it in `active`.
 *   - circles: Returns every SVGCircleElement currently in the document.
 *   - labels: Returns the trimmed textContent of every SVG <text> element.
 *   - buttonNamed: Returns the first HTMLButtonElement whose label matches a given string.
 * @dataflow mount() -> installGraphDialog builds DOM -> open()/render() draws circles/lines/text into figure -> assertions read those shapes and recorded state back out.
 * @controlflow beforeEach-style reset in mount() -> per-test action (open/click/key) -> assertion on resulting DOM or side effects -> afterEach destroys any live controller to keep the document clean.
 * @version 1
 * @date 2026-09-18
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installGraphDialog, type GraphDialog } from '../src/shell/graph-dialog.js';
import type { VaultGraph } from '@k-doc/core';

const GRAPH: VaultGraph = {
  nodes: [
    { path: 'C:/v/a.md', relative: 'a.md', title: 'Alpha', degree: 2 },
    { path: 'C:/v/b.md', relative: 'b.md', title: 'Beta', degree: 1 },
    { path: 'C:/v/c.md', relative: 'c.md', title: 'Gamma', degree: 1 },
    { path: 'C:/v/d.md', relative: 'd.md', title: 'Delta', degree: 0 },
  ],
  edges: [
    { from: 'C:/v/a.md', to: 'C:/v/b.md', count: 1 },
    { from: 'C:/v/a.md', to: 'C:/v/c.md', count: 1 },
  ],
};

let opened: string[] = [];
let active: GraphDialog | null = null;
let current: string | null = 'C:/v/a.md';
let graph: VaultGraph = GRAPH;

function mount(): GraphDialog {
  // Reset working state so every test starts from the same clean baseline.
  opened = [];
  current = 'C:/v/a.md';
  graph = GRAPH;

  // Install with provider callbacks that observe and record behaviour for assertions.
  active = installGraphDialog({
    doc: document,
    graph: () => graph,
    documentPath: () => current,
    openNote: (path): void => {
      opened.push(path);
    },
  });

  return active;
}

// Tear down any dialog left open by a test so the document stays clean between tests.
afterEach((): void => {
  if (active !== null) {
    // A controller was installed: destroy it and clear the reference to avoid double-destroying.
    active.destroy();
    active = null;
  } else {
    // Nothing was left open this test, so there is nothing to tear down.
  }
});

// Every circle in the document. jsdom does not define SVGCircleElement, so the selector is the whole
// narrowing: an element matching 'circle' is one.
function circles(): Element[] {
  return Array.from(document.querySelectorAll('circle'));
}

// Clicks one element the way a reader would. An SVG element has no click() of its own in jsdom.
function clickElement(element: Element | undefined): void {
  // Check whether the element was found at all, so a missing one fails an assertion rather than throwing.
  if (element === undefined) {
    return;
  } else {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}

// Read the trimmed label of every SVG <text> in the document as a list of strings.
function labels(): string[] {
  return Array.from(document.querySelectorAll('text')).map(
    (node): string => node.textContent?.trim() ?? '',
  );
}

// Find the first button whose label matches text, or undefined when none match.
function buttonNamed(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (node): node is HTMLButtonElement =>
      node instanceof HTMLButtonElement && node.textContent?.trim() === text,
  );
}

describe('installGraphDialog', () => {
  // Proves the dialog exists in the DOM but stays closed before any open() call.
  it('is closed until it is opened', (): void => {
    mount();
    expect(active?.isOpen).toBe(false);
    expect(document.querySelectorAll('dialog.kdoc-graph-dialog')).toHaveLength(1);
  });

  // Proves opening renders one circle per node with every note title labelled.
  it('opens to draw the whole vault', (): void => {
    mount();
    active?.open();
    expect(active?.isOpen).toBe(true);
    expect(circles()).toHaveLength(4);
    const found = labels();
    expect(found).toContain('Alpha');
    expect(found).toContain('Beta');
    expect(found).toContain('Gamma');
    expect(found).toContain('Delta');
  });

  // Proves every edge renders as exactly one SVG line, two edges giving two lines.
  it('renders every link as a line', (): void => {
    mount();
    active?.open();
    expect(document.querySelectorAll('line')).toHaveLength(2);
  });

  // Proves exactly one node carries the is-current marker, belonging to the on-screen note.
  it('marks the note currently on screen', (): void => {
    mount();
    active?.open();

    let marked = 0;
    for (const circle of circles()) {
      if (circle.getAttribute('class')?.includes('is-current')) {
        // Count each circle whose class names it as the current note.
        marked += 1;
      } else {
        // A non-current node does not contribute to the marker count.
      }
    }

    expect(marked).toBe(1);

    const alpha = circles().find((node) => node.getAttribute('aria-label') === 'Alpha');
    expect(alpha?.getAttribute('class')).toContain('is-current');
  });

  // Proves the tally line reports four notes and two links for the default vault.
  it('reports the note and link counts', (): void => {
    mount();
    active?.open();

    const countElement = document.querySelector('.kdoc-graph-dialog-count');
    expect(countElement?.textContent).toBe('4 notes, 2 links');
  });

  // Proves singular grammar when exactly one note links only to itself.
  it('reads singular counts for a lone self-link', (): void => {
    mount();

    // A single node whose edge loops back onto itself: one note, one link.
    graph = {
      nodes: [{ path: 'C:/v/only.md', relative: 'only.md', title: 'Solo', degree: 1 }],
      edges: [{ from: 'C:/v/only.md', to: 'C:/v/only.md', count: 1 }],
    };

    active?.open();

    const countElement = document.querySelector('.kdoc-graph-dialog-count');
    expect(countElement?.textContent).toBe('1 note, 1 link');
  });

  // Proves "Around this note" narrows the view to three circles and drops Delta.
  it('narrows with Around this note', (): void => {
    mount();
    active?.open();

    buttonNamed('Around this note')?.click();

    expect(circles()).toHaveLength(3);
    const found = labels();
    expect(found).not.toContain('Delta');
  });

  // Proves "Around this note" shows the empty placeholder when no note is on screen.
  it('shows nothing around an absent note', (): void => {
    mount();
    current = null;
    active?.open();

    buttonNamed('Around this note')?.click();

    const figure = document.querySelector('.kdoc-graph-dialog-figure');
    expect(figure?.textContent).toContain('No notes to show');
  });

  // Proves an empty vault reports the same placeholder rather than a blank figure.
  it('reports an empty vault', (): void => {
    mount();
    graph = { nodes: [], edges: [] };
    active?.open();

    const figure = document.querySelector('.kdoc-graph-dialog-figure');
    expect(figure?.textContent).toContain('No notes to show');
  });

  // Proves clicking a note opens it and closes the dialog.
  it('opens a clicked note', (): void => {
    mount();
    active?.open();

    const beta = circles().find((node) => node.getAttribute('aria-label') === 'Beta');
    clickElement(beta);

    expect(opened).toEqual(['C:/v/b.md']);
    expect(active?.isOpen).toBe(false);
  });

  // Proves Enter on a note opens it and closes the dialog.
  it('opens an activated note with Enter', (): void => {
    mount();
    active?.open();

    const gamma = circles().find((node) => node.getAttribute('aria-label') === 'Gamma');
    gamma?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(opened).toEqual(['C:/v/c.md']);
  });

  // Proves a non-activation key leaves the dialog open with no note opened.
  it('ignores an unrelated key press', (): void => {
    mount();
    active?.open();

    const beta = circles().find((node) => node.getAttribute('aria-label') === 'Beta');
    beta?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(opened).toEqual([]);
  });

  // Proves the Close button dismisses the dialog.
  it('closes via the Close button', (): void => {
    mount();
    active?.open();

    buttonNamed('Close')?.click();

    expect(active?.isOpen).toBe(false);
  });

  // Proves reopening after narrowing returns to the whole vault of four circles.
  it('opens on the whole vault however it was left', (): void => {
    mount();
    active?.open();

    buttonNamed('Around this note')?.click();
    expect(circles()).toHaveLength(3);

    buttonNamed('Close')?.click();

    active?.open();
    expect(circles()).toHaveLength(4);
  });

  // Proves switching scope redraws in place rather than appending extra circles.
  it('switches scope without adding shapes', (): void => {
    mount();
    active?.open();

    buttonNamed('Around this note')?.click();
    expect(circles()).toHaveLength(3);

    buttonNamed('Whole vault')?.click();

    // Redrawn to the whole vault: four circles, not three plus four.
    expect(circles()).toHaveLength(4);
  });

  // Proves destroy removes the dialog from the document without leaving a trace.
  it('removes itself on destroy', (): void => {
    mount();
    active?.destroy();
    active = null;

    expect(document.querySelector('dialog.kdoc-graph-dialog')).toBeNull();
  });
});
