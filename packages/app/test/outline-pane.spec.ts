// @vitest-environment jsdom

/**
 * @file outline-pane.spec.ts
 * @purpose Vitest test suite for K-Doc's Word-style outline navigation pane component (@k-doc/app).
 *   Validates top-level heading button rendering, depth-based indentation styling, empty state display,
 *   source range revelation on click, active section tracking by caret offset, DOM rebuild suppression
 *   for unchanged headings, visibility controls with [hidden] CSS override, and lifecycle cleanup under jsdom.
 * @inputs Markdown test fixtures, synthetic DOM click events, caret position mutations, and DocumentSession state changes.
 * @outputs Vitest assertions verifying DOM button rendering, title and aria attributes, padding indentation relationships, revealRange callbacks, aria-current tracking, rebuild object identity, visibility state, and idempotent teardown.
 * @functions
 *   - mountElement: Creates a semantic nav element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *   - mountOutline: Instantiates a DocumentSession and OutlinePane mounted on a dedicated nav container with mutable caret tracking and range revelation recording.
 *   - rows: Queries all button elements inside an outline container, returning them as an array of HTMLButtonElement instances.
 *   - emptyState: Queries the empty-state element with class .kdoc-outline-empty inside a container, throwing a descriptive error if missing.
 * @dataflow Markdown fixture -> DocumentSession & installOutlinePane -> DOM heading buttons & caret updates -> click/refresh actions -> DOM & callback assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across rendering, navigation, active row tracking, rebuild suppression, visibility, and lifecycle -> destroy controllers and detach DOM mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildOutline, DocumentSession } from '@k-doc/core';
import {
  installOutlinePane,
  OUTLINE_PANE_STYLES,
  type OutlinePane,
} from '../src/shell/outline-pane.js';

let activeMounts: HTMLElement[] = [];
let activePanes: OutlinePane[] = [];

/**
 * Creates a container nav element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *
 * @purpose Allocates and attaches a mount DOM container to document.body for outline pane hosting.
 * @inputs void.
 * @outputs HTMLElement - The newly created and attached nav DOM container element.
 * @dataflow document.createElement -> document.body.appendChild -> tracked in activeMounts -> return element.
 * @controlflow Create nav element -> append to document.body -> record in activeMounts array -> return element.
 */
function mountElement(): HTMLElement {
  const element = document.createElement('nav');
  document.body.appendChild(element);
  activeMounts.push(element);
  return element;
}

/**
 * Instantiates a DocumentSession and OutlinePane mounted on a dedicated DOM element with mock callback recorders.
 *
 * @purpose Sets up an integrated test harness with document session, outline pane controller, mutable caret offset, and range revelation recorder.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @inputs caret - Optional initial caret offset in the document source text (defaults to 0).
 * @outputs Object containing container, session, outline pane controller, revealed range recorder, and mutable caret holder.
 * @dataflow markdown -> DocumentSession -> installOutlinePane -> return harness record.
 * @controlflow Create container nav element -> initialize DocumentSession -> call installOutlinePane with recording callbacks and caretOffset reader -> register pane in activePanes -> return harness object.
 */
function mountOutline(
  markdown: string,
  caret?: number,
): {
  container: HTMLElement;
  session: DocumentSession;
  pane: OutlinePane;
  revealed: { calls: Array<{ start: number; end: number }> };
  caret: { offset: number };
  moved: { calls: Array<{ fromIndex: number; toIndex: number }> };
} {
  const container = mountElement();
  const session = new DocumentSession(markdown);
  const revealed: { calls: Array<{ start: number; end: number }> } = { calls: [] };
  const caretState: { offset: number } = { offset: caret ?? 0 };
  const moved: { calls: Array<{ fromIndex: number; toIndex: number }> } = { calls: [] };

  const pane = installOutlinePane({
      // The harness records the reorder and applies nothing, because the pane's contract is to report
      // and the host's is to act -- mixing the two here would test the harness rather than the pane.
      moveSection: (fromIndex: number, toIndex: number): void => {
        moved.calls.push({ fromIndex, toIndex });
      },
    container,
    doc: document,
    session,
    revealRange: (start: number, end: number): void => {
      revealed.calls.push({ start, end });
    },
    caretOffset: (): number => caretState.offset,
  });
  activePanes.push(pane);

  return {
    container,
    session,
    pane,
    revealed,
    caret: caretState,
    moved,
  };
}

/**
 * Queries all button elements inside an outline container, returning them as an array of HTMLButtonElement instances.
 *
 * @purpose Retrieves all heading row buttons currently rendered in the outline pane container.
 * @inputs container: HTMLElement - The parent DOM container hosting the outline pane.
 * @outputs HTMLButtonElement[] - Array of matching button DOM elements.
 * @dataflow container.querySelectorAll('button') -> Array.from -> HTMLButtonElement[].
 * @controlflow Query all button elements inside container -> convert NodeList to Array -> return button array.
 */
function rows(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button.kdoc-outline-button'));
}

/**
 * Queries the empty-state element with class .kdoc-outline-empty inside a container, throwing a descriptive error if missing.
 *
 * @purpose Locates the empty outline message container, failing fast with a descriptive error when not found.
 * @inputs container: HTMLElement - The parent DOM container hosting the outline pane.
 * @outputs HTMLElement - The matching empty-state DOM element.
 * @dataflow container.querySelector with .kdoc-outline-empty selector -> validate found -> return HTMLElement.
 * @controlflow Query element with .kdoc-outline-empty -> check if null -> if null throw descriptive Error -> return element.
 */
function emptyState(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.kdoc-outline-empty');
  // Check if the empty-state element was found in the container.
  if (el === null) {
    // Empty-state element not found: throw descriptive named error.
    throw new Error('No element with class "kdoc-outline-empty" found in outline container');
  } else {
    // Empty-state element found: return element.
  }
  return el;
}

describe('OutlinePane', () => {
  beforeEach(() => {
    activeMounts = [];
    activePanes = [];
  });

  afterEach(() => {
    for (const pane of activePanes) {
      pane.destroy();
    }
    activePanes = [];

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

  describe('rendering', () => {
  function rowFor(container: HTMLElement, label: string): HTMLElement {
    // Purpose: Locate a single outline row by the visible text of its button rather than by DOM position.
    //   Finding a row by its label instead of its index keeps these cases readable when collapsing changes
    //   which indices exist in the rendered list.
    // Inputs: container - The outline pane subtree to search; label - Exact textContent expected on the row's button.
    // Outputs: HTMLElement - The matching li.kdoc-outline-item, or throws a descriptive Error when none matches.
    // Data Flow: Query all rows -> read each row's button textContent -> compare against label -> return match or throw.
    // Control Flow: Iterate candidate rows in document order; guard-return on the first exact match; otherwise fall through to throw.
    const items = Array.from(container.querySelectorAll<HTMLElement>('li.kdoc-outline-item'));
    for (const item of items) {
      // Inspect each rendered outline row in document order.
      const button = item.querySelector<HTMLElement>('button.kdoc-outline-button');
      // If this row's button carries the exact label, return it immediately (guard clause).
      if (button?.textContent === label) {
        return item;
      }
      // Otherwise fall through and continue scanning the remaining rows.
    }
    // Control Flow reached only when no row's button text equaled the requested label.
    throw new Error(`No outline row with button text "${label}" found`);
  }

    it('gives a twisty only to a heading with children', () => {
      // Pins: the twisty disclosure button appears solely on headings that have descendants, and nowhere else.
      const NESTED = '# Alpha\n\nA.\n\n# Beta\n\nB.\n\n## Beta child\n\nC.\n\n### Beta grandchild\n\nD.\n\n# Gamma\n\nG.\n';
      const { container, pane } = mountOutline(NESTED);
      pane.show();

      // Alpha is a top-level heading with no children, so it must render without a twisty button.
      const alphaRow = rowFor(container, 'Alpha');
      expect(alphaRow.querySelector('button.kdoc-outline-twisty')).toBeNull();

      // Beta has descendants and its twisty must actually collapse them — a control that cannot do anything
      // is worse than no control, so this presence implies functional behavior verified in the next cases.
      const betaRow = rowFor(container, 'Beta');
      expect(betaRow.querySelector('button.kdoc-outline-twisty')).not.toBeNull();
    });

    it('hides descendants when a heading is collapsed', () => {
      // Pins: collapsing Beta removes its descendant rows entirely rather than merely hiding them visually.
      const NESTED = '# Alpha\n\nA.\n\n# Beta\n\nB.\n\n## Beta child\n\nC.\n\n### Beta grandchild\n\nD.\n\n# Gamma\n\nG.\n';
      const { container, pane } = mountOutline(NESTED);
      pane.show();

      // Locate Beta and click its twisty to collapse its subtree.
      const betaRow = rowFor(container, 'Beta');
      const twisty = betaRow.querySelector<HTMLButtonElement>('button.kdoc-outline-twisty');
      expect(twisty).not.toBeNull();
      // Click the twisty to collapse Beta; it is guaranteed present by the assertion above.
      twisty?.click();

      // Read the label of every visible row button in document order.
      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button.kdoc-outline-button'),
      );
      const labels = buttons.map((btn) => btn.textContent ?? '');

      // Only top-level headings remain; Beta's descendants are not built at all rather than hidden with CSS,
      // so keyboard navigation can never land on a row that is invisible to the user.
      expect(labels).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('hides a grandchild when the grandparent is collapsed', () => {
      // Pins: collapsing an ancestor removes all descendants at every depth, not just immediate children.
      const NESTED = '# Alpha\n\nA.\n\n# Beta\n\nB.\n\n## Beta child\n\nC.\n\n### Beta grandchild\n\nD.\n\n# Gamma\n\nG.\n';
      const { container, pane } = mountOutline(NESTED);
      pane.show();

      // Collapse Beta so both its child and grandchild should disappear.
      const betaRow = rowFor(container, 'Beta');
      const twisty = betaRow.querySelector<HTMLButtonElement>('button.kdoc-outline-twisty');
      expect(twisty).not.toBeNull();
      // Click the twisty to collapse Beta; it is guaranteed present by the assertion above.
      twisty?.click();

      // A grandchild must be absent even though an intermediate child also disappears between them: the question
      // is whether any ancestor is closed, not the nearest one — rows in between are gone too.
      expect(() => rowFor(container, 'Beta child')).toThrow();
      expect(() => rowFor(container, 'Beta grandchild')).toThrow();
    });

    it('reports a drop as a move', () => {
      // Pins: dragging one row onto another reports a single move with the correct from/to indices.
      const NESTED = '# Alpha\n\nA.\n\n# Beta\n\nB.\n\n## Beta child\n\nC.\n\n### Beta grandchild\n\nD.\n\n# Gamma\n\nG.\n';
      const { container, pane, moved } = mountOutline(NESTED);
      pane.show();

      // jsdom has no DragEvent. A plain Event has no dataTransfer at all, and the pane's guard tests it
      // against null, so the synthetic events carry an explicit null: without it the guard would pass on
      // undefined and the handler would throw setting effectAllowed on nothing.
      const betaRow = rowFor(container, 'Beta');
      const alphaRow = rowFor(container, 'Alpha');

      // Beta sits at index 1 and Alpha at index 0 in the top-level ordering, so the drop reports that move.
      betaRow.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: null }));
      alphaRow.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: null }));

      expect(moved.calls).toEqual([{ fromIndex: 1, toIndex: 0 }]);
    });

    it('does not report a drop on the dragged row itself', () => {
      // Pins: dropping onto the source row is a no-op and must not be reported as a move.
      const NESTED = '# Alpha\n\nA.\n\n# Beta\n\nB.\n\n## Beta child\n\nC.\n\n### Beta grandchild\n\nD.\n\n# Gamma\n\nG.\n';
      const { container, pane, moved } = mountOutline(NESTED);
      pane.show();

      // Drop onto the same row that was dragged so there is no net position change.
      const betaRow = rowFor(container, 'Beta');
      betaRow.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: null }));
      // Dropping a row where it already is not a move, so nothing should be recorded below.
      betaRow.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: null }));

      expect(moved.calls).toEqual([]);
    });

    it('renders one button per top-level heading in document order with the heading text', () => {
      const { container } = mountOutline('# One\n\n## Two\n\n### Three\n');
      const buttons = rows(container);

      expect(buttons.length).toBe(3);
      expect(buttons[0]?.textContent).toBe('One');
      expect(buttons[1]?.textContent).toBe('Two');
      expect(buttons[2]?.textContent).toBe('Three');
    });

    it('assigns type="button" and a title matching its text to every row button', () => {
      const { container } = mountOutline('# One\n\n## Two\n');
      const buttons = rows(container);

      expect(buttons.length).toBe(2);
      for (const btn of buttons) {
        expect(btn.type).toBe('button');
        expect(btn.title).toBe(btn.textContent);
      }
    });

    it('sets aria-level on each row matching the heading depth', () => {
      const { container } = mountOutline('# One\n\n## Two\n\n### Three\n');
      const buttons = rows(container);

      expect(buttons.length).toBe(3);
      expect(buttons[0]?.getAttribute('aria-level')).toBe('1');
      expect(buttons[1]?.getAttribute('aria-level')).toBe('2');
      expect(buttons[2]?.getAttribute('aria-level')).toBe('3');
    });

    it('indents rows proportionally by heading depth', () => {
      const { container } = mountOutline('# Depth One\n\n### Depth Three\n');
      const buttons = rows(container);

      // Assert the depth-indentation relationship rather than an exact pixel constant so styling adjustments do not break the test.
      const pad1 = parseFloat(buttons[0]?.style.paddingInlineStart ?? '0');
      const pad3 = parseFloat(buttons[1]?.style.paddingInlineStart ?? '0');

      expect(pad3).toBeGreaterThan(pad1);
    });

    it('renders no row buttons and displays the empty state message when the document has no headings', () => {
      const { container } = mountOutline('Just body text without any headings.\n');
      const buttons = rows(container);

      // The empty state is where the first render is easiest to get wrong: with no headings the new
      // entries equal the previous ones on install, so a rebuild guarded only by that comparison never
      // runs and the pane comes up blank -- which is exactly what this caught.
      expect(buttons.length).toBe(0);
      const empty = emptyState(container);
      expect(empty.textContent).toBe('No headings yet');
    });
  });

  describe('navigation', () => {
    it('calls revealRange with the heading offsets when a row button is clicked', () => {
      const markdown = '# Introduction\n\nSome body text.\n\n## Section Two\n';
      const { container, session, revealed } = mountOutline(markdown);
      const expectedEntries = buildOutline(session.snapshot.document);
      const targetEntry = expectedEntries[1];
      expect(targetEntry).toBeDefined();

      const buttons = rows(container);
      const secondButton = buttons[1];
      expect(secondButton).toBeDefined();

      secondButton?.click();

      expect(revealed.calls.length).toBe(1);
      expect(revealed.calls[0]).toEqual({
        start: targetEntry?.start,
        end: targetEntry?.end,
      });
    });
  });

  describe('the active row', () => {
    it('marks exactly the active section row with aria-current="true" when the caret is inside that section', () => {
      const markdown = '# First\n\nBody text.\n\n## Second\n\nMore text.\n';
      const { container, pane, session, caret } = mountOutline(markdown);
      const entries = buildOutline(session.snapshot.document);
      const secondEntry = entries[1];
      expect(secondEntry).toBeDefined();

      caret.offset = (secondEntry?.start ?? 0) + 4;
      pane.refresh();

      const buttons = rows(container);
      expect(buttons.length).toBe(2);
      expect(buttons[0]?.hasAttribute('aria-current')).toBe(false);
      expect(buttons[1]?.getAttribute('aria-current')).toBe('true');
    });

    it('marks no row when the caret is positioned above the first heading', () => {
      const markdown = 'Preamble text before any heading.\n\n# First Heading\n\nSection content.\n';
      const { container, pane, caret } = mountOutline(markdown, 0);

      caret.offset = 0;
      pane.refresh();

      const buttons = rows(container);
      expect(buttons.length).toBe(1);

      // Text above the first heading belongs to no section, and marking the first row would highlight a section the user is not in.
      expect(buttons[0]?.hasAttribute('aria-current')).toBe(false);
    });

    it('moves the active mark when the caret offset changes and refresh is called', () => {
      const markdown = '# First\n\nSection one text.\n\n# Second\n\nSection two text.\n';
      const { container, pane, session, caret } = mountOutline(markdown);
      const entries = buildOutline(session.snapshot.document);
      const firstEntry = entries[0];
      const secondEntry = entries[1];
      expect(firstEntry).toBeDefined();
      expect(secondEntry).toBeDefined();

      caret.offset = (firstEntry?.start ?? 0) + 2;
      pane.refresh();

      let buttons = rows(container);
      expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
      expect(buttons[1]?.hasAttribute('aria-current')).toBe(false);

      caret.offset = (secondEntry?.start ?? 0) + 2;
      pane.refresh();

      buttons = rows(container);
      expect(buttons[0]?.hasAttribute('aria-current')).toBe(false);
      expect(buttons[1]?.getAttribute('aria-current')).toBe('true');
    });
  });

  describe('rebuild suppression', () => {
    it('does not rebuild the DOM when an edit leaves all headings unchanged', () => {
      const { container, pane, session } = mountOutline('# Heading\n\nInitial body.\n');
      const initialRow = rows(container)[0];
      expect(initialRow).toBeDefined();

      session.focusPane('source');
      session.applyText('# Heading\n\nUpdated body.\n');
      pane.refresh();

      // Rebuilding on every keystroke destroys the row the user is hovering and makes the pane flicker while typing.
      const postEditRow = rows(container)[0];
      expect(postEditRow).toBe(initialRow);
    });

    it('rebuilds the DOM when document headings change', () => {
      const { container, pane, session } = mountOutline('# Original Heading\n\nBody.\n');
      const initialRow = rows(container)[0];
      expect(initialRow?.textContent).toBe('Original Heading');

      session.focusPane('source');
      session.applyText('# Renamed Heading\n\nBody.\n');
      pane.refresh();

      const updatedButtons = rows(container);
      expect(updatedButtons.length).toBe(1);
      expect(updatedButtons[0]?.textContent).toBe('Renamed Heading');
    });
  });

  describe('visibility', () => {
    it('starts visible with isVisible as true and container.hidden as false', () => {
      const { container, pane } = mountOutline('# Title\n');
      expect(pane.isVisible).toBe(true);
      expect(container.hidden).toBe(false);
    });

    it('controls visibility through hide, show, and toggle methods', () => {
      const { container, pane } = mountOutline('# Title\n');

      pane.hide();
      expect(pane.isVisible).toBe(false);
      expect(container.hidden).toBe(true);

      pane.show();
      expect(pane.isVisible).toBe(true);
      expect(container.hidden).toBe(false);

      pane.toggle();
      expect(pane.isVisible).toBe(false);
      expect(container.hidden).toBe(true);

      pane.toggle();
      expect(pane.isVisible).toBe(true);
      expect(container.hidden).toBe(false);
    });

    it('includes an explicit [hidden] override in OUTLINE_PANE_STYLES', () => {
      // jsdom applies no CSS cascade, so expect(container.hidden).toBe(true) passes while the element is plainly visible in a real browser — this project already shipped exactly that bug, where a class rule's display: flex beat the UA stylesheet's [hidden] { display: none }.
      expect(OUTLINE_PANE_STYLES).toMatch(/\.kdoc-outline\[hidden\]\s*\{\s*display:\s*none/);
    });
  });

  describe('lifecycle', () => {
    it('empties the container on destroy()', () => {
      const { container, pane } = mountOutline('# Heading\n');
      expect(container.children.length).toBeGreaterThan(0);

      pane.destroy();
      expect(container.children.length).toBe(0);
    });

    it('handles multiple destroy() calls idempotently without throwing', () => {
      const { pane } = mountOutline('# Heading\n');
      expect(() => {
        pane.destroy();
        pane.destroy();
      }).not.toThrow();
    });

    it('handles refresh() after destroy() without throwing', () => {
      const { pane } = mountOutline('# Heading\n');
      pane.destroy();
      expect(() => {
        pane.refresh();
      }).not.toThrow();
    });
  });
});
