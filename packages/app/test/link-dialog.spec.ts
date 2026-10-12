// @vitest-environment jsdom

/**
 * @file link-dialog.spec.ts
 * @purpose Vitest test suite for LinkDialog component link sources (headings, vault note search, and file picker) (FR-8.12).
 * @inputs Synthetic DOM click, input, and keyboard events, heading outlines, note metadata arrays, and file picker promises.
 * @outputs Vitest assertions validating tab switching, heading outline indentation and slug generation, debounced note searching, file picker interaction, and DOM lifecycle cleanup.
 * @functions
 *   - mount: Installs the LinkDialog into document, recording submissions and searches, and returns a test harness.
 *   - openDialog: Locates and returns the currently open dialog element, failing if none is open.
 *   - tab: Finds a source tab button by its trimmed label text, failing if absent.
 *   - urlField: Finds and returns the dialog's URL input element, failing if absent.
 *   - visibleEmpties: Returns the empty-state messages in the source body currently on screen.
 * @dataflow Synthetic user events -> LinkDialog handlers -> DOM updates & callback invocations -> Vitest assertions.
 * @controlflow Mount dialog harness -> trigger user actions (tab clicks, search input, item selection) -> advance fake timers or await microtasks -> assert DOM element attributes/values -> destroy dialogs and clean up DOM in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { installLinkDialog } from '../src/shell/link-dialog.js';
import type { LinkDialog } from '../src/shell/link-dialog.js';

interface HeadingItem {
  depth: number;
  text: string;
}

interface NoteItem {
  readonly title: string;
  readonly relative: string;
}

interface Harness {
  readonly dialog: LinkDialog;
  readonly submitted: Array<{ readonly href: string; readonly title: string | null }>;
  readonly searches: string[];
  readonly headingsRef: HeadingItem[];
}

let activeDialogs: LinkDialog[] = [];

afterEach((): void => {
  // Destroy all active dialog instances.
  for (const dialog of activeDialogs) {
    dialog.destroy();
  }
  activeDialogs = [];

  // Remove any leftover dialog elements from the document body.
  const leftoverDialogs = document.body.querySelectorAll('dialog');
  for (const dialogEl of leftoverDialogs) {
    dialogEl.remove();
  }

  // Restore real timers in afterEach when fake timers were used.
  vi.useRealTimers();
});

/**
 * Installs the LinkDialog on document, recording submissions and note searches, and returns a test harness.
 *
 * @purpose Sets up a configured LinkDialog instance with tracking arrays and mutable heading references.
 * @inputs options - Optional configuration with headings, notes, and file picker delegates.
 * @outputs Harness - Test harness containing dialog controller, submission log, search log, and mutable headings array.
 * @dataflow options -> installLinkDialog -> register in activeDialogs -> return Harness.
 * @controlflow Initialize tracking collections -> install link dialog with document and callbacks -> register dialog -> return harness.
 */
function mount(options?: {
  readonly headings?: readonly { readonly depth: number; readonly text: string }[];
  readonly notes?: readonly { readonly title: string; readonly relative: string }[];
  readonly pickFile?: () => Promise<string | null>;
}): Harness {
  const submitted: Array<{ readonly href: string; readonly title: string | null }> = [];
  const searches: string[] = [];

  // Check whether initial headings were provided in options.
  const headingsRef: HeadingItem[] = options?.headings !== undefined
    ? options.headings.map((h: { readonly depth: number; readonly text: string }): HeadingItem => ({
        depth: h.depth,
        text: h.text,
      }))
    : [];

  const dialog = installLinkDialog({
    doc: document,
    headings: (): readonly HeadingItem[] => headingsRef,
    searchNotes: (query: string): readonly NoteItem[] => {
      searches.push(query);
      // Check if search query is empty.
      if (query === '') {
        // Return empty array for empty query, since the dialog is expected to handle that itself.
        return [];
      } else {
        // Return configured note items or empty array when none provided.
        return options?.notes ?? [];
      }
    },
    onSubmit: (attrs: { href: string; title: string | null }): void => {
      submitted.push(attrs);
    },
    ...(options?.pickFile !== undefined ? { pickFile: options.pickFile } : {}),
  });

  activeDialogs.push(dialog);

  return {
    dialog,
    submitted,
    searches,
    headingsRef,
  };
}

/**
 * Returns the currently open dialog element, failing when none is open.
 *
 * @purpose Locates the open native dialog element in the document for user assertions.
 * @inputs void.
 * @outputs HTMLElement - The open dialog DOM element.
 * @dataflow document.querySelector('dialog[open]') -> validate found -> return HTMLElement.
 * @controlflow Query document for open dialog -> if null fail test with expect.fail -> return element.
 */
function openDialog(): HTMLElement {
  const el = document.querySelector<HTMLDialogElement>('dialog[open]');
  // Check whether an open dialog element exists in the document.
  if (el === null) {
    // No dialog is open: fail the test immediately.
    expect.fail('Expected a dialog to be open');
  } else {
    // Open dialog found: return element.
    return el;
  }
}

/**
 * Finds the source tab button in the open dialog whose trimmed text matches the label.
 *
 * @purpose Locates a source tab button (URL, Heading, Note, File…) by its visible label.
 * @inputs label - The trimmed text string of the tab to find.
 * @outputs HTMLButtonElement - The matching tab button element.
 * @dataflow openDialog() -> querySelectorAll('button.kdoc-link-source') -> find by trimmed textContent -> return button.
 * @controlflow Query all source tab buttons in open dialog -> find matching button -> if missing fail test -> return button.
 */
function tab(label: string): HTMLButtonElement {
  const dialogEl = openDialog();
  const tabs = Array.from(dialogEl.querySelectorAll<HTMLButtonElement>('button.kdoc-link-source'));
  const target = tabs.find((btn: HTMLButtonElement): boolean => btn.textContent?.trim() === label);
  // Check if a tab button with matching label was found.
  if (target === undefined) {
    // Matching tab button not found: fail test immediately.
    expect.fail(`Source tab labelled "${label}" was not found in the open dialog`);
  } else {
    // Matching tab button found: return button.
    return target;
  }
}

/**
 * Finds and returns the dialog's URL input field.
 *
 * @purpose Locates the link address input element inside the open dialog.
 * @inputs void.
 * @outputs HTMLInputElement - The URL input element.
 * @dataflow openDialog() -> querySelector('input[type="url"]') -> validate found -> return input.
 * @controlflow Query open dialog for input[type="url"] -> if null fail test with expect.fail -> return input.
 */
function urlField(): HTMLInputElement {
  const dialogEl = openDialog();
  const input = dialogEl.querySelector<HTMLInputElement>('input[type="url"]');
  // Check if URL input field exists in open dialog.
  if (input === null) {
    // URL input not found: fail test immediately.
    expect.fail('URL input field input[type="url"] was not found in the open dialog');
  } else {
    // URL input found: return element.
    return input;
  }
}

/**
 * Returns the empty-state messages in the body the user can actually see.
 *
 * @purpose Scopes the empty-state query to the visible source body.
 * @inputs void.
 * @outputs readonly HTMLElement[] - The empty-state elements inside the shown body.
 * @dataflow openDialog() -> .kdoc-link-body:not([hidden]) -> .kdoc-link-empty -> array.
 * @controlflow Query the visible body's empty messages and return them.
 *
 * Every source body stays in the DOM and is hidden rather than removed, so a document with no
 * headings and a search with no results both have an empty message at the same time. Counting them
 * across the whole dialog asserts on something no user can see.
 */
function visibleEmpties(): readonly HTMLElement[] {
  return Array.from(
    openDialog().querySelectorAll<HTMLElement>('.kdoc-link-body:not([hidden]) .kdoc-link-empty'),
  );
}

describe('the source tabs', (): void => {
  it('offers URL, Heading and Note', (): void => {
    const { dialog } = mount();
    dialog.open(null);

    const tabs = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-source'));
    const labels = tabs.map((btn: HTMLButtonElement): string => btn.textContent?.trim() ?? '');
    expect(labels).toEqual(['URL', 'Heading', 'Note']);
  });

  it('offers File only when there is a picker', (): void => {
    // The browser build has no file picker, and a button that never does anything is worse than no button.
    const withPicker = mount({
      pickFile: async (): Promise<string | null> => null,
    });
    withPicker.dialog.open(null);
    const tabsWithPicker = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-source'));
    const labelsWithPicker = tabsWithPicker.map((btn: HTMLButtonElement): string => btn.textContent?.trim() ?? '');
    expect(labelsWithPicker).toEqual(['URL', 'Heading', 'Note', 'File…']);
    withPicker.dialog.close();

    const withoutPicker = mount();
    withoutPicker.dialog.open(null);
    const tabsWithoutPicker = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-source'));
    const labelsWithoutPicker = tabsWithoutPicker.map((btn: HTMLButtonElement): string => btn.textContent?.trim() ?? '');
    expect(labelsWithoutPicker).toEqual(['URL', 'Heading', 'Note']);
  });

  it('starts on URL', (): void => {
    const { dialog } = mount();
    dialog.open(null);

    expect(tab('URL').getAttribute('aria-selected')).toBe('true');
    expect(tab('Heading').getAttribute('aria-selected')).toBe('false');
  });

  it('starts on Heading when editing a link to one', (): void => {
    // Editing a link to a heading should show you the headings, not make you find the tab first.
    const { dialog } = mount();
    dialog.open({ href: '#intro', title: null });

    expect(tab('Heading').getAttribute('aria-selected')).toBe('true');
    expect(tab('URL').getAttribute('aria-selected')).toBe('false');
  });

  it('switches when a tab is clicked', (): void => {
    const { dialog } = mount();
    dialog.open(null);

    tab('Note').click();
    expect(tab('Note').getAttribute('aria-selected')).toBe('true');
    expect(tab('URL').getAttribute('aria-selected')).toBe('false');
  });
});

const HEADINGS: readonly { readonly depth: number; readonly text: string }[] = [
  { depth: 1, text: 'Top Level' },
  { depth: 2, text: 'A Sub Section' },
  { depth: 3, text: 'Deeper Still' },
];

describe('picking a heading', (): void => {
  it('lists every heading', (): void => {
    const { dialog } = mount({ headings: HEADINGS });
    dialog.open(null);

    tab('Heading').click();
    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading'));
    expect(rows.length).toBe(3);
    expect(rows.map((r: HTMLButtonElement): string => r.textContent?.trim() ?? '')).toEqual([
      'Top Level',
      'A Sub Section',
      'Deeper Still',
    ]);
  });

  it('indents by depth', (): void => {
    // The indent is what makes the list readable as an outline rather than a list of sentences.
    const { dialog } = mount({ headings: HEADINGS });
    dialog.open(null);

    tab('Heading').click();
    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading'));
    expect(rows.map((r: HTMLButtonElement): string => r.style.paddingLeft)).toEqual([
      '0px',
      '12px',
      '24px',
    ]);
  });

  it('fills the URL with a slug and comes back to URL', (): void => {
    // The dialog's job is to fill the field, not to bypass it — applying straight away would give no chance to add a title or correct the target.
    const { dialog } = mount({ headings: HEADINGS });
    dialog.open(null);

    tab('Heading').click();
    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading'));
    const secondRow = rows[1];
    // Check if second heading row exists.
    if (secondRow === undefined) {
      expect.fail('Expected second heading row to exist');
    } else {
      secondRow.click();
    }

    expect(urlField().value).toBe('#a-sub-section');
    expect(tab('URL').getAttribute('aria-selected')).toBe('true');
  });

  it('slugs punctuation away', (): void => {
    const { dialog } = mount({
      headings: [{ depth: 1, text: "What's New in 2.0?" }],
    });
    dialog.open(null);

    tab('Heading').click();
    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading'));
    const firstRow = rows[0];
    // Check if first heading row exists.
    if (firstRow === undefined) {
      expect.fail('Expected heading row to exist');
    } else {
      firstRow.click();
    }

    // This is the anchor a Markdown renderer actually emits: punctuation is dropped, not turned into
    // a hyphen. A heading link that did not match the published anchor would be a broken link, which
    // is worse than having no picker at all -- so there is exactly one right answer here.
    expect(urlField().value).toBe('#whats-new-in-20');
  });

  it('trims the hyphens off both ends of a slug', (): void => {
    // Punctuation at either end leaves a hyphen there once it is dropped, and an anchor that began
    // or ended with one would match nothing a renderer emits.
    const { dialog } = mount({ headings: [{ depth: 1, text: '... Ends In Punctuation!' }] });
    dialog.open(null);

    tab('Heading').click();
    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading'));
    rows[0]!.click();

    expect(urlField().value).toBe('#ends-in-punctuation');
  });

  it('says so when there are no headings', (): void => {
    // An empty list with no explanation looks broken.
    const { dialog } = mount({ headings: [] });
    dialog.open(null);

    tab('Heading').click();
    const emptyElements = visibleEmpties();
    expect(emptyElements.length).toBe(1);

    const emptyText = emptyElements[0]!.textContent?.toLowerCase() ?? '';
    expect(emptyText).toContain('headings');

    const rows = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading');
    expect(rows.length).toBe(0);
  });

  it('rebuilds the list on every open', (): void => {
    // A dialog opened twice must never show the first document's headings.
    const harness = mount({ headings: HEADINGS });
    harness.dialog.open(null);

    tab('Heading').click();
    const firstRows = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading');
    expect(firstRows.length).toBe(3);

    harness.dialog.close();

    // Mutate headingsRef so the next headings() call returns the new outline.
    harness.headingsRef.length = 0;
    harness.headingsRef.push(
      { depth: 1, text: 'Single Replacement Heading' },
    );

    harness.dialog.open(null);
    tab('Heading').click();
    const secondRows = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-heading');
    expect(secondRows.length).toBe(1);
    expect(secondRows[0]?.textContent?.trim()).toBe('Single Replacement Heading');
  });
});

const NOTES: readonly { readonly title: string; readonly relative: string }[] = [
  { title: 'Setup Guide', relative: 'guides/setup.md' },
  { title: 'Release Notes', relative: 'release.md' },
];

describe('searching notes', (): void => {
  it('shows nothing before anything is typed', (): void => {
    // An unconstrained listing of a whole vault is not a search result.
    const { dialog } = mount({ notes: NOTES });
    dialog.open(null);

    tab('Note').click();
    const rows = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note');
    expect(rows.length).toBe(0);
  });

  it('shows what the search returned', (): void => {
    // Waiting 120 ms of real time in a test is 120 ms nobody gets back.
    vi.useFakeTimers();
    const { dialog } = mount({ notes: NOTES });
    dialog.open(null);

    tab('Note').click();

    const searchInput = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    // Check whether note search input element is found.
    if (searchInput === null) {
      expect.fail('Expected note search input to exist');
    } else {
      searchInput.value = 'set';
      searchInput.dispatchEvent(new Event('input'));
    }

    vi.advanceTimersByTime(120);

    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note'));
    expect(rows.length).toBe(2);

    const firstRow = rows[0];
    // Check whether first result row exists.
    if (firstRow === undefined) {
      expect.fail('Expected first note row to exist');
    } else {
      expect(firstRow.textContent).toContain('Setup Guide');
      const firstPath = firstRow.querySelector('.kdoc-link-note-path');
      expect(firstPath?.textContent).toBe('guides/setup.md');
    }

    const secondRow = rows[1];
    // Check whether second result row exists.
    if (secondRow === undefined) {
      expect.fail('Expected second note row to exist');
    } else {
      expect(secondRow.textContent).toContain('Release Notes');
      const secondPath = secondRow.querySelector('.kdoc-link-note-path');
      expect(secondPath?.textContent).toBe('release.md');
    }

    vi.useRealTimers();
  });

  it('debounces', (): void => {
    // Waiting 120 ms of real time in a test is 120 ms nobody gets back.
    vi.useFakeTimers();
    const { dialog, searches } = mount({ notes: NOTES });
    dialog.open(null);

    tab('Note').click();

    const searchInput = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    // Check whether note search input element is found.
    if (searchInput === null) {
      expect.fail('Expected note search input to exist');
    } else {
      // A vault search runs over every note, and running it on every keystroke of a long word is work nobody asked for.
      searchInput.value = 's';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.value = 'se';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.value = 'set';
      searchInput.dispatchEvent(new Event('input'));
    }

    expect(searches.length).toBe(0);

    vi.advanceTimersByTime(120);

    expect(searches.length).toBe(1);
    expect(searches[0]).toBe('set');

    vi.useRealTimers();
  });

  it('fills the URL with the note path and comes back to URL', (): void => {
    // Waiting 120 ms of real time in a test is 120 ms nobody gets back.
    vi.useFakeTimers();
    const { dialog } = mount({ notes: NOTES });
    dialog.open(null);

    tab('Note').click();

    const searchInput = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    // Check whether note search input element is found.
    if (searchInput === null) {
      expect.fail('Expected note search input to exist');
    } else {
      searchInput.value = 'set';
      searchInput.dispatchEvent(new Event('input'));
    }

    vi.advanceTimersByTime(120);

    const rows = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note'));
    const firstRow = rows[0];
    // Check whether first result row exists.
    if (firstRow === undefined) {
      expect.fail('Expected first note row to exist');
    } else {
      firstRow.click();
    }

    expect(urlField().value).toBe('guides/setup.md');
    expect(tab('URL').getAttribute('aria-selected')).toBe('true');

    vi.useRealTimers();
  });

  it('says so when nothing matches', (): void => {
    // Waiting 120 ms of real time in a test is 120 ms nobody gets back.
    vi.useFakeTimers();
    const { dialog } = mount({ notes: [] });
    dialog.open(null);

    tab('Note').click();

    const searchInput = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    // Check whether note search input element is found.
    if (searchInput === null) {
      expect.fail('Expected note search input to exist');
    } else {
      searchInput.value = 'nonexistent';
      searchInput.dispatchEvent(new Event('input'));
    }

    vi.advanceTimersByTime(120);

    const emptyElements = visibleEmpties();
    expect(emptyElements.length).toBe(1);
    expect(emptyElements[0]!.textContent).toBe('No notes match.');

    const rows = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note');
    expect(rows.length).toBe(0);

    vi.useRealTimers();
  });

  it('clears the search on every open', (): void => {
    // A search box still holding the last document's query is a result list about a document you are no longer in.
    // Waiting 120 ms of real time in a test is 120 ms nobody gets back.
    vi.useFakeTimers();
    const { dialog } = mount({ notes: NOTES });
    dialog.open(null);

    tab('Note').click();

    const searchInput = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    // Check whether note search input element is found.
    if (searchInput === null) {
      expect.fail('Expected note search input to exist');
    } else {
      searchInput.value = 'set';
      searchInput.dispatchEvent(new Event('input'));
    }

    vi.advanceTimersByTime(120);

    const rowsBefore = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note');
    expect(rowsBefore.length).toBe(2);

    dialog.close();
    dialog.open(null);

    tab('Note').click();

    const searchInputAfter = openDialog().querySelector<HTMLInputElement>('input.kdoc-link-search');
    expect(searchInputAfter?.value).toBe('');

    const rowsAfter = openDialog().querySelectorAll<HTMLButtonElement>('button.kdoc-link-note');
    expect(rowsAfter.length).toBe(0);

    vi.useRealTimers();
  });
});

describe('picking a file', (): void => {
  it('puts the chosen path in the URL field', async (): Promise<void> => {
    const { dialog } = mount({
      pickFile: async (): Promise<string | null> => 'C:/docs/other.md',
    });
    dialog.open(null);

    tab('File…').click();

    const pickButton = openDialog().querySelector<HTMLButtonElement>('button.kdoc-link-pick');
    // Check whether file picker button is found.
    if (pickButton === null) {
      expect.fail('Expected pick file button to exist');
    } else {
      pickButton.click();
    }

    // The click handler is async and the assertion has to be after its microtasks.
    // Awaiting Promise.resolve() twice drains the async IIFE microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(urlField().value).toBe('C:/docs/other.md');
    expect(tab('URL').getAttribute('aria-selected')).toBe('true');
  });

  it('leaves the field alone when the picker is dismissed', async (): Promise<void> => {
    // A cancelled picker is not an error.
    const { dialog } = mount({
      pickFile: async (): Promise<string | null> => null,
    });
    dialog.open({ href: 'kept', title: null });
    expect(urlField().value).toBe('kept');

    tab('File…').click();

    const pickButton = openDialog().querySelector<HTMLButtonElement>('button.kdoc-link-pick');
    // Check whether file picker button is found.
    if (pickButton === null) {
      expect.fail('Expected pick file button to exist');
    } else {
      pickButton.click();
    }

    // Drain microtasks from async picker callback.
    await Promise.resolve();
    await Promise.resolve();

    expect(urlField().value).toBe('kept');
  });

  it('leaves the field alone when the picker fails', async (): Promise<void> => {
    // A picker that failed is a thing to survive, not to crash the dialog over.
    const { dialog } = mount({
      pickFile: async (): Promise<string | null> => {
        throw new Error('nope');
      },
    });
    dialog.open({ href: 'survived', title: null });
    expect(urlField().value).toBe('survived');

    tab('File…').click();

    const pickButton = openDialog().querySelector<HTMLButtonElement>('button.kdoc-link-pick');
    // Check whether file picker button is found.
    if (pickButton === null) {
      expect.fail('Expected pick file button to exist');
    } else {
      expect((): void => {
        pickButton.click();
      }).not.toThrow();
    }

    // Drain microtasks from async picker callback.
    await Promise.resolve();
    await Promise.resolve();

    expect(urlField().value).toBe('survived');
  });
});
