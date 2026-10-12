// @vitest-environment jsdom
/**
 * @file snippets-dialog.spec.ts
 * @purpose Tests for the Markdown snippets dialog installed by installSnippetsDialog, covering listing order, empty state, adding, in-place editing, validation, Enter navigation, removal/restore, and open/close lifecycle.
 * @inputs A jsdom document environment; SnippetsDialog instances created via mount(); user interactions simulated through field value assignments and button/keyboard events.
 * @outputs Assertions on DOM state, the changes array recorded by onChange, dialog open/closed status, and error throws for missing mounts or fields.
 * @functions
 *   - mount: Installs a snippets dialog in jsdom and returns a harness exposing items, changes, dialog, and root element.
 *   - field: Locates an input or textarea by its aria-label within the dialog root.
 *   - press: Clicks a button identified by its aria-label, ignoring missing buttons.
 *   - status: Reads the text content of the dialog status region.
 * @dataflow mount → installSnippetsDialog renders into document → harness.root captures the dialog DOM → tests mutate fields and dispatch events → onChange records changes → expect validates state.
 * @controlflow afterEach clears mounted dialogs → each it() mounts a fresh harness → interacts via helpers → asserts → returns; teardown destroys all dialogs.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installSnippetsDialog } from '../src/shell/snippets-dialog.js';
import type { SnippetsDialog } from '../src/shell/snippets-dialog.js';

const dialogs: SnippetsDialog[] = [];

afterEach(() => {
  // Drain and destroy every mounted dialog so no state leaks between tests.
  for (const dialog of dialogs.splice(0)) {
    dialog.destroy();
  }
});

interface Harness {
  items: Readonly<Record<string, string>>;
  changes: Readonly<Record<string, string>>[];
  dialog: SnippetsDialog;
  root: HTMLDialogElement;
}

/**
 * @purpose Installs a snippets dialog in jsdom and wraps it with mutable state for assertions.
 * @inputs items - initial snippet map driving the rendered rows.
 * @outputs Harness - object bundling the dialog, its root element, and recorded changes.
 * @dataflow Provided items feed snippets() → installSnippetsDialog renders rows → captured root is stored on the harness.
 * @controlflow Build harness → install dialog → push to cleanup list → query root and throw if absent → open dialog → return.
 */
function mount(items: Readonly<Record<string, string>>): Harness {
  const harness = { items, changes: [] as Readonly<Record<string, string>>[] } as Harness;
  harness.dialog = installSnippetsDialog({
    doc: document,
    snippets: () => harness.items,
    defaults: { sig: 'Regards' },
    onChange: (next) => {
      // Record every change and mirror it into items so subsequent renders reflect it.
      harness.changes.push(next);
      harness.items = next;
    },
  });
  dialogs.push(harness.dialog);
  const root = document.querySelector<HTMLDialogElement>('dialog.kdoc-snippets-dialog:last-of-type');
  if (root === null) {
    throw new Error('dialog not mounted');
  } else {
    // Root mounted successfully; capture it on the harness for later queries.
    harness.root = root;
  }
  harness.dialog.open();
  return harness;
}

/**
 * @purpose Locates a form field (input or textarea) by aria-label inside the given root.
 * @inputs root - element scope for the query; label - aria-label value to match.
 * @outputs HTMLInputElement | HTMLTextAreaElement - the matched field, or throws when missing.
 * @dataflow Query selector → found reference returned or error thrown.
 * @controlflow Query → if null throw with message → else return found element.
 */
function field(root: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`no field ${label}`);
  } else {
    // Field located; hand it back to the caller.
    return found;
  }
}

/**
 * @purpose Simulates a click on a labeled button within the given root.
 * @inputs root - element scope for the query; label - aria-label value of the target button.
 * @outputs void.
 * @dataflow Query selector → optional-click invoked if the button exists.
 * @controlflow Query → optional chaining guards a missing button before clicking.
 */
function press(root: HTMLElement, label: string): void {
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
}

/**
 * @purpose Reads the visible text of the dialog status region.
 * @inputs root - element scope for the query.
 * @outputs string - the status text, or empty string when absent.
 * @dataflow Query selector → textContent fallback to ''.
 * @controlflow Query → nullish coalescing yields '' when no status node exists.
 */
function status(root: HTMLElement): string {
  return root.querySelector('.kdoc-snippets-status')?.textContent ?? '';
}

describe('snippets dialog', () => {
  // Verifies rows render in sorted prefix order and the table row body is editable.
  it('lists the snippets sorted with an editable body each', () => {
    const { root } = mount({ table: '| a |', link: '[$1]($2)' });
    expect([...root.querySelectorAll<HTMLElement>('.kdoc-snippets-row')].map((row) => row.dataset['prefix'])).toEqual(['link', 'table']);
    expect(field(root, 'Body of table').value).toBe('| a |');
  });

  // Verifies the empty-state message appears when no snippets exist.
  it('says when there are no snippets', () => {
    const { root } = mount({});
    expect(root.querySelector('.kdoc-snippets-empty')?.textContent).toBe('No snippets. Add one above.');
  });

  // Adds a new multi-line snippet, records the change, and resets the prefix/body fields.
  it('adds a multi-line snippet and clears the fields', () => {
    const h = mount({});
    field(h.root, 'Prefix').value = ' sig ';
    field(h.root, 'Body').value = 'Regards,\n$1';
    press(h.root, 'Add snippet');
    expect(h.changes).toEqual([{ sig: 'Regards,\n$1' }]);
    expect(field(h.root, 'Prefix').value).toBe('');
    expect(status(h.root)).toBe('Added the snippet sig.');
    expect(h.root.querySelector('.kdoc-snippets-status')?.hasAttribute('data-state')).toBe(false);
  });

  // Records an overwrite of an existing prefix with its changed status message.
  it('says when a prefix was overwritten', () => {
    const h = mount({ sig: 'Old' });
    field(h.root, 'Prefix').value = 'sig';
    field(h.root, 'Body').value = 'New';
    press(h.root, 'Add snippet');
    expect(h.changes).toEqual([{ sig: 'New' }]);
    expect(status(h.root)).toBe('Changed the snippet sig.');
  });

  // Rejects an invalid prefix and an empty body while leaving changes untouched.
  it('refuses a prefix with spaces or an empty body', () => {
    const h = mount({});
    field(h.root, 'Prefix').value = 'two words';
    field(h.root, 'Body').value = 'x';
    press(h.root, 'Add snippet');
    expect(status(h.root)).toContain('no spaces');
    expect(h.root.querySelector('.kdoc-snippets-status')?.getAttribute('data-state')).toBe('warning');
    field(h.root, 'Prefix').value = 'ok';
    field(h.root, 'Body').value = '';
    press(h.root, 'Add snippet');
    expect(status(h.root)).toContain('A snippet body must be');
    expect(h.changes).toEqual([]);
  });

  // Confirms Enter moves focus from the prefix field to the body field without recording changes.
  it('moves from the prefix to the body on Enter', () => {
    const h = mount({});
    const prefix = field(h.root, 'Prefix');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    prefix.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field(h.root, 'Body'));
    expect(h.changes).toEqual([]);
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    prefix.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  // Edits a snippet body in place, then rejects clearing it by restoring the previous value.
  it('changes a body in place and puts back an invalid one', () => {
    const h = mount({ sig: 'Regards' });
    const area = field(h.root, 'Body of sig');
    area.value = 'Thanks';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.changes).toEqual([{ sig: 'Thanks' }]);
    const again = field(h.root, 'Body of sig');
    expect(again).toBe(area);
    again.value = '';
    again.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.changes.length).toBe(1);
    expect(again.value).toBe('Thanks');
  });

  // Removes a snippet reverting to remaining items, then restores all defaults.
  it('removes a snippet and restores the defaults', () => {
    const h = mount({ sig: 'Cheers', zz: 'z' });
    press(h.root, 'Remove the snippet zz');
    expect(h.changes).toEqual([{ sig: 'Cheers' }]);
    expect(status(h.root)).toBe('Removed the snippet zz.');
    press(h.root, 'Restore the default snippets');
    expect(h.changes[1]).toEqual({ sig: 'Regards' });
  });

  // Opens and closes the dialog, then verifies it cannot reopen after being destroyed.
  it('opens, closes and stays closed after destroy', () => {
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
