// @vitest-environment jsdom

/**
 * @file backlinks-panel.spec.ts
 * @purpose Vitest test suite for BacklinksPanel right-sidebar backlinks navigation panel (FR-14.7).
 *   Validates un-opened vault empty states, unsaved note prompt states, zero-link states, count line formatting
 *   with singular/plural inflections, first-appearance grouping order, header and context line interleaving,
 *   source button attributes and tooltips, click navigation delegation for source headers and context lines,
 *   single-click idempotence preventing double-open regressions, blank context em dash placeholders,
 *   body background click filtering, root element identity stability across refresh, idempotent lifecycle teardown,
 *   and stylesheet exports under jsdom.
 * @inputs BacklinkRow fixture arrays, synthetic DOM click events, and mock host callbacks.
 * @outputs Vitest assertions verifying DOM hierarchy, text content, source and context buttons, count readouts, opened path recordings, and stylesheet exports.
 * @functions
 *   - mount: Instantiates and mounts a BacklinksPanel controller on a mock Document context with mutable state.
 *   - texts: Maps matched elements within a root parent node to their trimmed textContent.
 *   - requireElement: Locates a required DOM element within a root parent node, failing the test if absent.
 * @dataflow Synthetic click events -> BacklinksPanel delegated handler / refresh -> DOM node updates -> Vitest assertions.
 * @controlflow Mount backlinks panel harness -> execute test assertions across 14 test cases -> destroy active panels and remove host elements in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installBacklinksPanel, BACKLINKS_PANEL_STYLES } from '../src/shell/backlinks-panel.js';
import type { BacklinksPanel, BacklinkRow, BacklinksPanelOptions } from '../src/shell/backlinks-panel.js';

const activePanels: BacklinksPanel[] = [];
const activeHosts: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < activeHosts.length; i++) {
    const host = activeHosts[i];
    // Check if the host element is defined under strict indexing.
    if (host !== undefined) {
      // Defined: remove host element from document body.
      host.remove();
    } else {
      // Undefined: skip iteration.
    }
  }
  activeHosts.length = 0;

  for (let i = 0; i < activePanels.length; i++) {
    const panel = activePanels[i];
    // Check if the panel instance is defined to satisfy strict noUncheckedIndexedAccess.
    if (panel !== undefined) {
      // Defined panel instance: execute lifecycle teardown.
      panel.destroy();
    } else {
      // Undefined panel instance at index: skip iteration.
    }
  }
  activePanels.length = 0;
});

interface Harness {
  readonly panel: BacklinksPanel;
  readonly opened: string[];
  rows: BacklinkRow[];
  hasVault: boolean;
  documentPath: string | null;
}

interface MutableHarness {
  panel?: BacklinksPanel;
  readonly opened: string[];
  rows: BacklinkRow[];
  hasVault: boolean;
  documentPath: string | null;
}

/**
 * Instantiates and mounts a BacklinksPanel controller with configurable reactive accessors and invocation recorders.
 *
 * @purpose Allocates a test harness for BacklinksPanel, tracking opened notes and exposing mutable rows, vault status, and document path state.
 * @inputs initial - Optional initial state overrides for backlink rows, vault availability flag, and on-screen note path.
 * @outputs Harness - Test harness containing the mounted BacklinksPanel, opened note paths, and mutable accessors.
 * @dataflow initial parameters -> mutable harness state -> installBacklinksPanel -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize mutable state -> instantiate BacklinksPanel with closures over harness properties -> register panel in activePanels -> attach host to document -> return harness.
 */
function mount(initial?: { rows?: BacklinkRow[]; hasVault?: boolean; documentPath?: string | null }): Harness {
  let initialRows: BacklinkRow[] = [];
  // Check if initial rows array was provided.
  if (initial?.rows !== undefined) {
    // Rows provided: clone the array.
    initialRows = [...initial.rows];
  } else {
    // No rows provided: default to empty array.
    initialRows = [];
  }

  let initialHasVault: boolean = true;
  // Check if initial hasVault flag was provided.
  if (initial?.hasVault !== undefined) {
    // Flag provided: use provided boolean value.
    initialHasVault = initial.hasVault;
  } else {
    // Flag not provided: default to true.
    initialHasVault = true;
  }

  let initialDocumentPath: string | null = 'C:/vault/note.md';
  // Check if initial documentPath was provided.
  if (initial?.documentPath !== undefined) {
    // Path provided: use provided value (which can be null or string).
    initialDocumentPath = initial.documentPath;
  } else {
    // Path not provided: default to 'C:/vault/note.md'.
    initialDocumentPath = 'C:/vault/note.md';
  }

  // Build mutable harness object first so accessor closures can capture harness references directly.
  const harness: MutableHarness = {
    opened: [],
    rows: initialRows,
    hasVault: initialHasVault,
    documentPath: initialDocumentPath,
  };

  const options: BacklinksPanelOptions = {
    doc: document,
    hasVault: (): boolean => harness.hasVault,
    documentPath: (): string | null => harness.documentPath,
    backlinks: (): readonly BacklinkRow[] => harness.rows,
    openNote: (path: string): void => {
      harness.opened.push(path);
    },
  };

  const panel = installBacklinksPanel(options);

  harness.panel = panel;
  activePanels.push(panel);

  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);
  activeHosts.push(host);

  return harness as Harness;
}

/**
 * Maps matched elements within a root parent node to their trimmed textContent.
 *
 * @purpose Queries selector matches beneath root and extracts trimmed text strings.
 * @inputs root - The root ParentNode to query elements within.
 * @inputs selector - The CSS selector string to match.
 * @outputs string[] - Array of trimmed text content strings from matched elements.
 * @dataflow root.querySelectorAll(selector) -> iterate nodes -> extract and trim textContent -> array returned.
 * @controlflow Query elements -> loop with boundary check -> check non-null textContent -> trim and push -> return result array.
 */
function texts(root: ParentNode, selector: string): string[] {
  const elements = root.querySelectorAll(selector);
  const result: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    // Check if element at index is defined under strict indexing.
    if (element !== undefined) {
      const text = element.textContent;
      // Check if textContent is non-null.
      if (text !== null) {
        // Non-null text: push trimmed content.
        result.push(text.trim());
      } else {
        // Null textContent: push empty string.
        result.push('');
      }
    } else {
      // Element undefined: skip iteration.
    }
  }

  return result;
}

/**
 * Locates a required DOM element within a root parent node, failing the test if absent.
 *
 * @purpose Retrieves an element matching selector for inspection and user interaction simulation.
 * @inputs root - The root ParentNode to query elements within.
 * @inputs selector - The CSS selector string to locate the element.
 * @outputs T - The located HTMLElement.
 * @dataflow root.querySelector(selector) -> element returned.
 * @controlflow Query selector -> check if null -> fail test if absent; otherwise return element.
 */
function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  // Check whether the queried element exists in the DOM.
  if (el === null) {
    // Element is absent: fail the test immediately.
    expect.fail(`Expected ${selector} element to exist in DOM`);
  } else {
    // Element is present: return it.
    return el;
  }
}

describe('the Backlinks panel', (): void => {
  it('renders no folder open and disables controls when no vault is open', (): void => {
    // An un-opened vault cannot know what links to a note, and rendering empty links would falsely suggest the vault was scanned.
    const row: BacklinkRow = {
      path: 'C:/vault/source.md',
      relative: 'source.md',
      title: 'Source Note',
      context: 'See [[note]] here.',
    };
    const { panel } = mount({ hasVault: false, rows: [row] });

    expect(texts(panel.element, '.kdoc-backlinks-empty')).toEqual(['No folder open.']);
    expect(panel.element.querySelectorAll('.kdoc-backlinks-count')).toHaveLength(0);
    expect(panel.element.querySelectorAll('button')).toHaveLength(0);
  });

  it('prompts to save an unsaved note before scanning for links', (): void => {
    // A note without a path has not yet been saved to disk, so informing the user to save it prevents mistaking unsaved state for zero links.
    const row: BacklinkRow = {
      path: 'C:/vault/source.md',
      relative: 'source.md',
      title: 'Source Note',
      context: 'See [[note]] here.',
    };
    const { panel } = mount({ hasVault: true, documentPath: null, rows: [row] });

    expect(texts(panel.element, '.kdoc-backlinks-empty')).toEqual(['Save the note to see what links to it.']);
    expect(panel.element.querySelectorAll('.kdoc-backlinks-count')).toHaveLength(0);
    expect(panel.element.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders nothing links here when the note has no incoming links', (): void => {
    // An open saved note that has no incoming links needs an explicit zero-state readout confirming the scan completed.
    const { panel } = mount({ hasVault: true, documentPath: 'C:/vault/note.md', rows: [] });

    expect(texts(panel.element, '.kdoc-backlinks-empty')).toEqual(['Nothing links here.']);
    expect(panel.element.querySelectorAll('.kdoc-backlinks-count')).toHaveLength(0);
    expect(panel.element.querySelectorAll('button')).toHaveLength(0);
  });

  it('formats the reference count line with correct singular and plural inflections across all combinations', (): void => {
    // Grammatical precision in count readouts ensures English singular/plural nouns match both reference counts and distinct note counts.
    const rowA1: BacklinkRow = {
      path: 'C:/vault/a.md',
      relative: 'a.md',
      title: 'Note A',
      context: 'Reference A1',
    };
    const rowA2: BacklinkRow = {
      path: 'C:/vault/a.md',
      relative: 'a.md',
      title: 'Note A',
      context: 'Reference A2',
    };
    const rowB1: BacklinkRow = {
      path: 'C:/vault/b.md',
      relative: 'b.md',
      title: 'Note B',
      context: 'Reference B1',
    };

    const harness = mount({ rows: [rowA1] });
    // One row from one note -> 1 reference from 1 note.
    expect(texts(harness.panel.element, '.kdoc-backlinks-count')).toEqual(['1 reference from 1 note']);

    // Two rows from one note (same path) -> 2 references from 1 note.
    harness.rows = [rowA1, rowA2];
    harness.panel.refresh();
    expect(texts(harness.panel.element, '.kdoc-backlinks-count')).toEqual(['2 references from 1 note']);

    // Two rows from two different notes -> 2 references from 2 notes.
    harness.rows = [rowA1, rowB1];
    harness.panel.refresh();
    expect(texts(harness.panel.element, '.kdoc-backlinks-count')).toEqual(['2 references from 2 notes']);

    // Three rows where two share a note -> 3 references from 2 notes.
    harness.rows = [rowA1, rowA2, rowB1];
    harness.panel.refresh();
    expect(texts(harness.panel.element, '.kdoc-backlinks-count')).toEqual(['3 references from 2 notes']);
  });

  it('groups references by source path in first-appearance order rather than sorting alphabetically', (): void => {
    // Grouping preserves vault traversal order so users see references in the sequential order their files were encountered rather than arbitrary sorting.
    const zetaRow1: BacklinkRow = {
      path: 'C:/vault/zeta.md',
      relative: 'zeta.md',
      title: 'Zeta',
      context: 'zeta line 1',
    };
    const alphaRow1: BacklinkRow = {
      path: 'C:/vault/alpha.md',
      relative: 'alpha.md',
      title: 'Alpha',
      context: 'alpha line 1',
    };
    const zetaRow2: BacklinkRow = {
      path: 'C:/vault/zeta.md',
      relative: 'zeta.md',
      title: 'Zeta',
      context: 'zeta line 2',
    };
    const betaRow1: BacklinkRow = {
      path: 'C:/vault/beta.md',
      relative: 'beta.md',
      title: 'Beta',
      context: 'beta line 1',
    };
    const alphaRow2: BacklinkRow = {
      path: 'C:/vault/alpha.md',
      relative: 'alpha.md',
      title: 'Alpha',
      context: 'alpha line 2',
    };

    const rows: BacklinkRow[] = [zetaRow1, alphaRow1, zetaRow2, betaRow1, alphaRow2];
    const { panel } = mount({ rows });

    expect(texts(panel.element, '.kdoc-backlinks-source .kdoc-backlinks-title')).toEqual([
      'Zeta',
      'Alpha',
      'Beta',
    ]);
  });

  it('interleaves each source note header with exactly its own context lines in given order', (): void => {
    // Each source note header must anchor all references belonging to that file in their encountered order so citations remain grouped with their document.
    const zetaRow1: BacklinkRow = {
      path: 'C:/vault/zeta.md',
      relative: 'zeta.md',
      title: 'Zeta',
      context: 'zeta line 1',
    };
    const alphaRow1: BacklinkRow = {
      path: 'C:/vault/alpha.md',
      relative: 'alpha.md',
      title: 'Alpha',
      context: 'alpha line 1',
    };
    const zetaRow2: BacklinkRow = {
      path: 'C:/vault/zeta.md',
      relative: 'zeta.md',
      title: 'Zeta',
      context: 'zeta line 2',
    };
    const betaRow1: BacklinkRow = {
      path: 'C:/vault/beta.md',
      relative: 'beta.md',
      title: 'Beta',
      context: 'beta line 1',
    };
    const alphaRow2: BacklinkRow = {
      path: 'C:/vault/alpha.md',
      relative: 'alpha.md',
      title: 'Alpha',
      context: 'alpha line 2',
    };

    const rows: BacklinkRow[] = [zetaRow1, alphaRow1, zetaRow2, betaRow1, alphaRow2];
    const { panel } = mount({ rows });

    expect(texts(panel.element, '.kdoc-backlinks-title, .kdoc-backlinks-context')).toEqual([
      'Zeta',
      'zeta line 1',
      'zeta line 2',
      'Alpha',
      'alpha line 1',
      'alpha line 2',
      'Beta',
      'beta line 1',
    ]);
  });

  it('stores the note path in data-path and sets the relative path on button tooltip title', (): void => {
    // Truncated relative paths in the UI require tooltip inspection and data-path attributes for accessible path identification and navigation.
    const row: BacklinkRow = {
      path: 'C:/vault/sub/very-long-directory-structure/target-note.md',
      relative: 'sub/very-long-directory-structure/target-note.md',
      title: 'Target Note',
      context: 'Quoted context line',
    };
    const { panel } = mount({ rows: [row] });

    const sourceBtn = requireElement<HTMLButtonElement>(panel.element, '.kdoc-backlinks-source');
    expect(sourceBtn.getAttribute('data-path')).toBe('C:/vault/sub/very-long-directory-structure/target-note.md');
    expect(sourceBtn.title).toBe('sub/very-long-directory-structure/target-note.md');
  });

  it('navigates to the source note when clicking either the context line or the source header button', (): void => {
    // Users naturally click directly on the quoted text snippet to navigate to a backlink, so context lines must dispatch navigation identically to source headers.
    const notePath: string = 'C:/vault/referenced-source.md';
    const row: BacklinkRow = {
      path: notePath,
      relative: 'referenced-source.md',
      title: 'Referenced Source',
      context: 'Specific link context',
    };
    const harness = mount({ rows: [row] });

    const contextBtn = requireElement<HTMLButtonElement>(harness.panel.element, '.kdoc-backlinks-context');
    contextBtn.click();
    expect(harness.opened).toEqual([notePath]);

    const sourceBtn = requireElement<HTMLButtonElement>(harness.panel.element, '.kdoc-backlinks-source');
    sourceBtn.click();
    expect(harness.opened).toEqual([notePath, notePath]);
  });

  it('triggers note opening exactly once per user click without duplicate listener dispatch', (): void => {
    // Single-click navigation must trigger exactly one open invocation to prevent redundant file loads caused by duplicate event listeners.
    const row: BacklinkRow = {
      path: 'C:/vault/source.md',
      relative: 'source.md',
      title: 'Source',
      context: 'Clickable line',
    };
    const harness = mount({ rows: [row] });

    const contextBtn = requireElement<HTMLButtonElement>(harness.panel.element, '.kdoc-backlinks-context');
    contextBtn.click();
    expect(harness.opened.length).toBe(1);
  });

  it('renders an em dash placeholder and maintains reference counts when context line is empty', (): void => {
    // References whose line content could not be extracted must still be rendered and counted, displaying an em dash as an accessible placeholder.
    const row: BacklinkRow = {
      path: 'C:/vault/empty-context.md',
      relative: 'empty-context.md',
      title: 'Empty Context Note',
      context: '',
    };
    const { panel } = mount({ rows: [row] });

    expect(texts(panel.element, '.kdoc-backlinks-context')).toEqual(['\u2014']);
    expect(texts(panel.element, '.kdoc-backlinks-count')).toEqual(['1 reference from 1 note']);
  });

  it('ignores clicks dispatched directly on the body container outside any button element', (): void => {
    // Delegated event handling must filter out clicks on blank container padding to prevent false navigation calls.
    const row: BacklinkRow = {
      path: 'C:/vault/source.md',
      relative: 'source.md',
      title: 'Source',
      context: 'Context line',
    };
    const harness = mount({ rows: [row] });

    const bodyEl = requireElement<HTMLElement>(harness.panel.element, '.kdoc-backlinks-body');
    bodyEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(harness.opened).toEqual([]);
  });

  it('preserves the same root DOM element identity across refresh calls', (): void => {
    // Preserving root DOM element identity across refresh cycles prevents the panel from being orphaned or unmounted by host containers.
    const initialRow: BacklinkRow = {
      path: 'C:/vault/note-initial.md',
      relative: 'note-initial.md',
      title: 'Initial',
      context: 'Initial ref',
    };
    const updatedRow: BacklinkRow = {
      path: 'C:/vault/note-updated.md',
      relative: 'note-updated.md',
      title: 'Updated',
      context: 'Updated ref',
    };

    const harness = mount({ rows: [initialRow] });
    const initialElement = harness.panel.element;

    harness.rows = [updatedRow];
    harness.panel.refresh();

    expect(harness.panel.element).toBe(initialElement);
  });

  it('tolerates multiple destroy calls idempotently and deactivates button click handling', (): void => {
    // Component lifecycle teardown must safely tolerate duplicate calls and detach delegated listeners to prevent memory leaks and post-destruction events.
    const row: BacklinkRow = {
      path: 'C:/vault/source.md',
      relative: 'source.md',
      title: 'Source',
      context: 'Context line',
    };
    const harness = mount({ rows: [row] });

    const body = requireElement<HTMLElement>(harness.panel.element, '.kdoc-backlinks-body');

    harness.panel.destroy();
    // Check that calling destroy a second time is safe and does not throw.
    expect((): void => {
      harness.panel.destroy();
    }).not.toThrow();

    // A button that destroy already detached would not reach the body's listener even if the
    // listener were still attached, so clicking one of those proves nothing. Put a live button in
    // the body instead: only a genuinely removed listener leaves this click unanswered.
    const revived = document.createElement('button');
    revived.className = 'kdoc-backlinks-source';
    revived.setAttribute('data-path', 'C:/vault/source.md');
    body.appendChild(revived);
    revived.click();

    expect(harness.opened).toEqual([]);
  });

  it('exports valid CSS styles referencing panel container and context classes', (): void => {
    // Authoritative stylesheet definitions must be exported as CSS rules for dynamic document head injection by host shells.
    expect(typeof BACKLINKS_PANEL_STYLES).toBe('string');
    expect(BACKLINKS_PANEL_STYLES.length).toBeGreaterThan(0);
    expect(BACKLINKS_PANEL_STYLES).toContain('.kdoc-backlinks-panel');
    expect(BACKLINKS_PANEL_STYLES).toContain('.kdoc-backlinks-context');
  });
});
