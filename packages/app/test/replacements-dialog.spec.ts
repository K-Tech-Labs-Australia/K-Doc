// @vitest-environment jsdom
/**
 * @file replacements-dialog.spec.ts
 * @purpose Exercises the markdown-replacements dialog UI: listing, adding, editing, removing, restoring defaults, and lifecycle open/close/destroy.
 * @inputs The `installReplacementsDialog` API from `../src/shell/replacements-dialog.js`; jsdom DOM provided by the vitest environment.
 * @outputs Test pass/fail via vitest assertions; drives `onChange` callbacks that record replacement-table mutations.
 * @functions
 *   - mount: Installs a dialog in jsdom and returns a harness exposing its root, table, and recorded changes.
 *   - field: Locates an input by aria-label or throws.
 *   - press: Clicks a button by aria-label if present.
 *   - status: Reads the current status text of the dialog.
 * @dataflow mount() builds a dialog → user actions mutate harness.table via onChange → assertions read harness.changes and DOM state.
 * @controlflow afterEach tears down every mounted dialog; each it() mounts fresh, performs an action, then asserts on recorded changes and rendered output.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installReplacementsDialog } from '../src/shell/replacements-dialog.js';
import type { ReplacementsDialog } from '../src/shell/replacements-dialog.js';

const dialogs: ReplacementsDialog[] = [];

afterEach(() => {
  for (const dialog of dialogs.splice(0)) {
    dialog.destroy();
  }
});

interface Harness {
  table: Readonly<Record<string, string>>;
  changes: Readonly<Record<string, string>>[];
  dialog: ReplacementsDialog;
  root: HTMLDialogElement;
}

// mount installs a replacements dialog into the jsdom document and returns a harness.
function mount(table: Readonly<Record<string, string>>): Harness {
  const harness = { table, changes: [] as Readonly<Record<string, string>>[] } as Harness;
  harness.dialog = installReplacementsDialog({
    doc: document,
    replacements: () => harness.table,
    defaults: { teh: 'the' },
    onChange: (next) => {
      harness.changes.push(next);
      harness.table = next;
    },
  });
  dialogs.push(harness.dialog);
  const root = document.querySelector<HTMLDialogElement>('dialog.kdoc-replacements-dialog:last-of-type');
  if (root === null) {
    throw new Error('dialog not mounted');
  } else {
    // Dialog was found in the DOM: attach it to the harness for later assertions.
    harness.root = root;
  }
  harness.dialog.open();
  return harness;
}

// field returns the input whose aria-label matches label, or throws if none exists.
function field(root: HTMLElement, label: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`no field ${label}`);
  } else {
    // Input present: hand it back to the caller.
    return found;
  }
}

// press clicks the button whose aria-label matches label, ignoring missing buttons.
function press(root: HTMLElement, label: string): void {
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
}

// status returns the current status text of the dialog, or an empty string if absent.
function status(root: HTMLElement): string {
  return root.querySelector('.kdoc-replacements-status')?.textContent ?? '';
}

describe('replacements dialog', () => {
  // The table renders sorted by key with one field per replacement and a default value populated.
  it('lists the table sorted with a field per replacement', () => {
    const { root } = mount({ teh: 'the', adn: 'and' });
    expect([...root.querySelectorAll<HTMLElement>('.kdoc-replacements-row')].map((row) => row.dataset['key'])).toEqual(['adn', 'teh']);
    expect(field(root, 'Replacement for teh').value).toBe('the');
  });

  // An empty table shows the no-replacements message.
  it('says when the table is empty', () => {
    const { root } = mount({});
    expect(root.querySelector('.kdoc-replacements-empty')?.textContent).toBe('No replacements. Add one above.');
  });

  // Adding via button populates changes, clears fields, sets success status, and adds a row.
  it('adds an entry and clears the fields', () => {
    const h = mount({});
    field(h.root, 'Replace').value = ' hte ';
    field(h.root, 'With').value = 'the';
    press(h.root, 'Add replacement');
    expect(h.changes).toEqual([{ hte: 'the' }]);
    expect(field(h.root, 'Replace').value).toBe('');
    expect(status(h.root)).toBe('Added a replacement for hte.');
    expect(h.root.querySelectorAll('.kdoc-replacements-row').length).toBe(1);
  });

  // Enter submits an edit and reports whether the entry was changed.
  it('adds with Enter and says when an entry was overwritten', () => {
    const h = mount({ teh: 'the' });
    field(h.root, 'Replace').value = 'teh';
    const to = field(h.root, 'With');
    to.value = 'THE';
    to.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(h.changes).toEqual([{ teh: 'THE' }]);
    expect(status(h.root)).toBe('Changed the replacement for teh.');
  });

  // Invalid keys (spaces) and empty replacements are rejected with a warning state.
  it('refuses a key with spaces or an empty replacement', () => {
    const h = mount({});
    field(h.root, 'Replace').value = 'two words';
    field(h.root, 'With').value = 'x';
    press(h.root, 'Add replacement');
    expect(h.changes).toEqual([]);
    expect(status(h.root)).toContain('no spaces');
    expect(h.root.querySelector('.kdoc-replacements-status')?.getAttribute('data-state')).toBe('warning');
    field(h.root, 'Replace').value = 'ok';
    field(h.root, 'With').value = '';
    press(h.root, 'Add replacement');
    expect(h.changes).toEqual([]);
    expect(status(h.root)).toContain('A replacement must be');
    field(h.root, 'With').value = 'fine';
    press(h.root, 'Add replacement');
    expect(h.root.querySelector('.kdoc-replacements-status')?.hasAttribute('data-state')).toBe(false);
  });

  // Editing in place records the change; an empty edit is rejected and reverts to the prior value.
  it('changes a replacement in place and puts back an invalid one', () => {
    const h = mount({ teh: 'the' });
    const to = field(h.root, 'Replacement for teh');
    to.value = 'thee';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.changes).toEqual([{ teh: 'thee' }]);
    const again = field(h.root, 'Replacement for teh');
    again.value = '';
    again.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.changes.length).toBe(1);
    expect(again.value).toBe('thee');
  });

  // Removing an entry records the remaining table and reports the removed key.
  it('removes an entry', () => {
    const h = mount({ teh: 'the', adn: 'and' });
    press(h.root, 'Remove the replacement for teh');
    expect(h.changes).toEqual([{ adn: 'and' }]);
    expect(status(h.root)).toBe('Removed the replacement for teh.');
  });

  // Restoring defaults replaces the table with the configured default set.
  it('restores the defaults', () => {
    const h = mount({ zz: 'z' });
    press(h.root, 'Restore the default replacements');
    expect(h.changes).toEqual([{ teh: 'the' }]);
  });

  // The dialog opens, closes via button, and stops responding after destroy.
  it('opens, closes and stops after destroy', () => {
    const h = mount({});
    expect(h.dialog.isOpen).toBe(true);
    press(h.root, 'Close');
    expect(h.dialog.isOpen).toBe(false);
    h.dialog.destroy();
    h.dialog.open();
    expect(h.dialog.isOpen).toBe(false);
    expect(document.body.contains(h.root)).toBe(false);
  });
});
