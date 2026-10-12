// @vitest-environment jsdom

/**
 * @file paste-special.spec.ts
 * @purpose Vitest test suite for K-Doc's Paste Special dialog and post-paste options popup (FR-7.4).
 *   Validates dialog option rendering, label and hint text, disabled/unavailable states, current reading markers,
 *   mouse picking and disabled guards, Cancel and Escape dismissal, arrow key traversal over enabled options,
 *   initial highlight positioning, sequential ask resolution, popup button rendering and absence of unavailable modes,
 *   pressed status, more button delegation, auto-dismissal on keypress and outside mousedown, and static stylesheets.
 * @inputs Synthetic DOM click, mousedown, and keydown events; viewport coordinates; PasteMode values and available mode lists.
 * @outputs Vitest assertions verifying DOM attributes (aria-disabled, aria-current, aria-pressed, hidden, class, style),
 *   resolved Promise values, callback records, and CSS stylesheet rules under jsdom.
 * @functions
 *   - mountDialog: Installs a fresh PasteSpecialDialog attached to document.body and returns a test harness.
 *   - mountPopup: Installs a fresh PasteOptionsPopup attached to document.body and returns a test harness.
 *   - optionFor: Locates a specific paste mode button element within the dialog or popup container by data-paste-mode.
 *   - press: Dispatches a synthetic bubbling keydown KeyboardEvent to document simulating keyboard navigation.
 *   - settleTimers: Flushes pending macrotasks allowing zero-delay registration timeouts to execute.
 * @dataflow Synthetic user interactions -> dialog and popup event listeners -> DOM updates and callback invocations -> test assertions.
 * @controlflow Mount dialog or popup -> execute interaction sequences across dialog choices, popup switches, and styles -> assert DOM attributes, Promise settlements, and callback records -> tear down dialogs and popups in afterEach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it, afterEach } from 'vitest';
import type { PasteMode } from '@k-doc/editor';
import {
  installPasteSpecialDialog,
  PASTE_SPECIAL_STYLES,
  type PasteSpecialDialog,
} from '../src/shell/paste-special-dialog.js';
import {
  installPasteOptionsPopup,
  PASTE_OPTIONS_STYLES,
  type PasteOptionsPopup,
} from '../src/shell/paste-options-popup.js';

let dialogs: PasteSpecialDialog[] = [];
let popups: PasteOptionsPopup[] = [];

afterEach(() => {
  // The dialog and popup mount onto doc.body and would otherwise leak between tests.
  for (const dialog of dialogs) {
    dialog.destroy();
  }
  dialogs = [];
  for (const popup of popups) {
    popup.destroy();
  }
  popups = [];
});

interface DialogHarness {
  readonly dialog: PasteSpecialDialog;
  readonly root: HTMLDialogElement;
}

interface MoreCounter {
  count: number;
}

interface PopupHarness {
  readonly popup: PasteOptionsPopup;
  readonly root: HTMLElement;
  readonly chosen: PasteMode[];
  readonly more: MoreCounter;
}

/**
 * Installs a fresh PasteSpecialDialog instance attached to document.body and returns a test harness.
 *
 * @purpose Creates and mounts a PasteSpecialDialog controller and registers it for test teardown.
 * @inputs void.
 * @outputs DialogHarness - The test harness containing dialog controller and root HTMLDialogElement.
 * @dataflow installPasteSpecialDialog -> query root element on document.body -> register in dialogs -> return harness.
 * @controlflow Instantiate dialog with doc -> push to dialogs array -> query .kdoc-paste-special -> check null and throw if missing -> return harness.
 */
function mountDialog(): DialogHarness {
  const dialog = installPasteSpecialDialog({
    doc: document,
  });
  dialogs.push(dialog);

  const root = document.querySelector<HTMLDialogElement>('.kdoc-paste-special');
  // Check if root dialog element was mounted to document.body.
  if (root === null) {
    // Missing root element: fail fast.
    throw new Error('Paste special dialog root element not found on document.body');
  } else {
    // Root dialog element found.
  }

  return { dialog, root };
}

/**
 * Installs a fresh PasteOptionsPopup instance attached to document.body and returns a test harness.
 *
 * @purpose Creates and mounts a PasteOptionsPopup controller tracking chosen modes and more requests, and registers it for test teardown.
 * @inputs void.
 * @outputs PopupHarness - The test harness containing popup controller, root DOM element, chosen modes array, and more counter.
 * @dataflow installPasteOptionsPopup -> query root element on document.body -> register in popups -> return harness.
 * @controlflow Initialize chosen array and more counter -> instantiate popup with doc, win, and callbacks -> push to popups array -> query .kdoc-paste-popup -> check null and throw if missing -> return harness.
 */
function mountPopup(): PopupHarness {
  const chosen: PasteMode[] = [];
  const more: MoreCounter = { count: 0 };

  const popup = installPasteOptionsPopup({
    doc: document,
    win: window,
    onChoose: (mode: PasteMode): void => {
      chosen.push(mode);
    },
    onMore: (): void => {
      more.count += 1;
    },
  });
  popups.push(popup);

  const root = document.querySelector<HTMLElement>('.kdoc-paste-popup');
  // Check if root popup element was mounted to document.body.
  if (root === null) {
    // Missing root element: fail fast.
    throw new Error('Paste options popup root element not found on document.body');
  } else {
    // Root popup element found.
  }

  return { popup, root, chosen, more };
}

/**
 * Locates a specific paste mode button element within the dialog or popup container by data-paste-mode attribute.
 *
 * @purpose Finds the button element matching the specified paste mode attribute or throws a descriptive Error.
 * @inputs
 *   - root: HTMLElement - The root container element.
 *   - mode: PasteMode - The paste mode attribute value to find.
 * @outputs HTMLButtonElement - The matching button DOM element.
 * @dataflow root.querySelector with data-paste-mode selector -> validate found -> return button.
 * @controlflow Query selector for data-paste-mode -> check if null -> throw descriptive Error if null -> return element.
 */
function optionFor(root: HTMLElement, mode: PasteMode): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`[data-paste-mode="${mode}"]`);
  // Check if button with the specified data-paste-mode exists in root.
  if (button === null) {
    // Button not found: throw descriptive error.
    throw new Error(`Option button with data-paste-mode "${mode}" not found`);
  } else {
    // Button found.
  }
  return button;
}

/**
 * Dispatches a synthetic keydown KeyboardEvent to document simulating keyboard navigation.
 *
 * @purpose Creates and dispatches a bubbling cancelable keyboard event simulating user key presses on document.
 * @inputs key: string - The KeyboardEvent key value (e.g. 'ArrowDown', 'ArrowUp', 'Enter', 'Escape').
 * @outputs KeyboardEvent - The dispatched event instance.
 * @dataflow key -> KeyboardEvent -> document.dispatchEvent -> return event.
 * @controlflow Construct KeyboardEvent with bubbles and cancelable -> dispatch to document -> return event.
 */
function press(key: string): KeyboardEvent {
  // The listener is on the document as well as the element because focus stays in the
  // editor behind it — a panel that only heard keys when focused would never hear one.
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

/**
 * Flushes pending macrotasks allowing zero-delay registration timeouts to execute.
 *
 * @purpose Awaits a zero-delay setTimeout to allow popup event listeners to attach before dispatching interaction events.
 * @inputs void.
 * @outputs Promise<void> - Resolves when macrotasks have settled.
 * @dataflow setTimeout -> Promise resolution.
 * @controlflow Create Promise with setTimeout 0 -> await resolution.
 */
async function settleTimers(): Promise<void> {
  // The listeners are attached in a zero-delay timeout so the click that opened
  // the popup does not immediately close it.
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, 0);
  });
}

describe('the Paste Special dialog', () => {
  it('all four readings are offered, in order', () => {
    const { root } = mountDialog();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-paste-mode]'));
    const modes = buttons.map((btn) => btn.getAttribute('data-paste-mode'));
    expect(modes).toEqual(['plain', 'markdown', 'html', 'table']);
  });

  it('each carries a label and a hint', () => {
    const { root } = mountDialog();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-paste-mode]'));
    expect(buttons.length).toBe(4);

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button element is defined under strict indexing.
      if (btn === undefined) {
        // Skip undefined button.
        continue;
      } else {
        // Valid button element.
      }

      const label = btn.querySelector<HTMLElement>('.kdoc-paste-option-label');
      const hint = btn.querySelector<HTMLElement>('.kdoc-paste-option-hint');

      // Check if label and hint elements exist within the button.
      if (label === null || hint === null) {
        // Missing label or hint element: fail test.
        throw new Error('Option button missing label or hint element');
      } else {
        // Both label and hint elements found.
      }

      // The hint is what makes the dialog a choice rather than four words.
      const labelText = label.textContent;
      const hintText = hint.textContent;
      // Check if label text is present.
      if (labelText === null) {
        // Missing label text: fail test.
        throw new Error('Label textContent is null');
      } else {
        // Label text present: assert non-empty.
        expect(labelText.trim().length).toBeGreaterThan(0);
      }
      // Check if hint text is present.
      if (hintText === null) {
        // Missing hint text: fail test.
        throw new Error('Hint textContent is null');
      } else {
        // Hint text present: assert non-empty.
        expect(hintText.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('an unavailable reading is greyed, not hidden', () => {
    const { dialog, root } = mountDialog();
    void dialog.ask(['plain', 'markdown'], null);

    // A dialog whose contents change shape between invocations is one the user has to re-read every time.
    const unavailableModes: readonly PasteMode[] = ['html', 'table'];
    for (let i = 0; i < unavailableModes.length; i++) {
      const mode = unavailableModes[i];
      // Check if mode is defined under strict indexing.
      if (mode === undefined) {
        // Skip undefined mode.
        continue;
      } else {
        // Valid mode.
      }

      const btn = optionFor(root, mode);
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.classList.contains('kdoc-paste-option-disabled')).toBe(true);
    }
  });

  it('the current reading is marked', () => {
    const { dialog, root } = mountDialog();
    void dialog.ask(['plain', 'markdown'], 'markdown');

    // Marking what was already done is what makes this a change-your-mind dialog rather than a second paste.
    const markdownBtn = optionFor(root, 'markdown');
    expect(markdownBtn.getAttribute('aria-current')).toBe('true');

    const hint = markdownBtn.querySelector<HTMLElement>('.kdoc-paste-option-hint');
    // Check if hint element exists within the option button.
    if (hint === null) {
      // Missing hint element: fail test.
      throw new Error('Hint element not found for markdown option');
    } else {
      // Hint element found.
    }

    const hintText = hint.textContent;
    // Check if hint text is present.
    if (hintText === null) {
      // Null hint text: fail test.
      throw new Error('Hint textContent is null');
    } else {
      // Hint text present: assert it contains (used).
      expect(hintText).toContain('(used)');
    }
  });

  it('clicking an available option resolves it', async () => {
    const { dialog, root } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown'], null);

    optionFor(root, 'plain').click();

    const result = await promise;
    expect(result).toBe('plain');
  });

  it('clicking a disabled option resolves nothing', async () => {
    const { dialog, root } = mountDialog();
    const promise = dialog.ask(['plain'], null);

    // The first click must not have settled the promise, and the second resolving proves it did not.
    optionFor(root, 'table').click();
    optionFor(root, 'plain').click();

    const result = await promise;
    expect(result).toBe('plain');
  });

  it('Cancel resolves null', async () => {
    const { dialog, root } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown'], null);

    const cancelBtn = root.querySelector<HTMLButtonElement>('.kdoc-paste-cancel');
    // Check if cancel button exists in dialog root.
    if (cancelBtn === null) {
      // Missing cancel button: fail test.
      throw new Error('Cancel button not found in dialog');
    } else {
      // Cancel button found.
    }
    cancelBtn.click();

    const result = await promise;
    expect(result).toBeNull();
  });

  it('Escape resolves null', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown'], null);

    press('Escape');

    const result = await promise;
    expect(result).toBeNull();
  });

  it('arrows walk the enabled options only', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['plain', 'html'], null);

    // Skipping the disabled markdown option is what makes the keys agree with the mouse, which also cannot land on it.
    press('ArrowDown');
    press('Enter');

    const result = await promise;
    expect(result).toBe('html');
  });

  it('the down arrow stops at the last enabled option', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown', 'html'], null);

    // Four presses over three options. The count and the list length are both deliberate: with two
    // options and three presses a wrapping walk lands on the last one anyway, so the test would pass
    // whether or not the clamp existed. Wrapping is the failure this rules out -- it would put the
    // first option one keypress past the last, which in a list read top to bottom is a surprise.
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');

    const result = await promise;
    expect(result).toBe('html');
  });

  it('arrows stop at the ends', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown'], null);

    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');

    const result = await promise;
    expect(result).toBe('plain');
  });

  it('the highlight starts on the current reading', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['plain', 'markdown', 'html'], 'html');

    press('Enter');

    const result = await promise;
    expect(result).toBe('html');
  });

  it('it starts on the first enabled option when the current one is unavailable', async () => {
    const { dialog } = mountDialog();
    const promise = dialog.ask(['markdown'], 'html');

    // Opening on an option that cannot be picked would put Enter on a dead key.
    press('Enter');

    const result = await promise;
    expect(result).toBe('markdown');
  });

  it('a second ask resolves the first with null', async () => {
    const { dialog } = mountDialog();
    const firstPromise = dialog.ask(['plain'], null);
    void dialog.ask(['markdown'], null);

    const firstResult = await firstPromise;
    expect(firstResult).toBeNull();
  });
});

describe('the paste options popup', () => {
  it('it offers a button per available reading plus the more button', () => {
    const { popup, root } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-paste-mode]'));
    const modes = buttons.map((btn) => btn.getAttribute('data-paste-mode'));
    expect(modes).toEqual(['plain', 'html']);

    const moreButtons = root.querySelectorAll('.kdoc-paste-popup-more');
    expect(moreButtons.length).toBe(1);
  });

  it('an unavailable reading is absent', () => {
    const { popup, root } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    // The popup hides what the dialog greys, because it sits over the document and every millimetre it occupies covers text.
    const tableButton = root.querySelector('[data-paste-mode="table"]');
    expect(tableButton).toBeNull();
  });

  it('the current reading is pressed', () => {
    const { popup, root } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    const htmlButton = optionFor(root, 'html');
    const plainButton = optionFor(root, 'plain');

    expect(htmlButton.getAttribute('aria-pressed')).toBe('true');
    expect(plainButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a reading reports it and hides', () => {
    const { popup, root, chosen } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    optionFor(root, 'plain').click();

    expect(chosen).toEqual(['plain']);
    expect(popup.isOpen).toBe(false);
  });

  it('the more button asks for the dialog and hides', () => {
    const { popup, root, more } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    const moreButton = root.querySelector<HTMLButtonElement>('.kdoc-paste-popup-more');
    // Check if more button exists in popup root.
    if (moreButton === null) {
      // Missing more button: fail test.
      throw new Error('More button not found in popup');
    } else {
      // More button found.
    }
    moreButton.click();

    expect(more.count).toBe(1);
    expect(popup.isOpen).toBe(false);
  });

  it('it starts hidden', () => {
    const { popup, root } = mountPopup();
    expect(root.hidden).toBe(true);
    expect(popup.isOpen).toBe(false);
  });

  it('a keypress anywhere dismisses it', async () => {
    const { popup } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    await settleTimers();

    // A paste-options control that lingers ends up over the next paragraph the user types.
    press('a');
    expect(popup.isOpen).toBe(false);
  });

  it('a mousedown outside dismisses it', async () => {
    const { popup } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    await settleTimers();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(popup.isOpen).toBe(false);
  });

  it('a mousedown inside does not', async () => {
    const { popup, root } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    await settleTimers();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    root.dispatchEvent(event);

    expect(popup.isOpen).toBe(true);
  });

  it('showAt positions it', () => {
    const { popup, root } = mountPopup();
    popup.showAt(10, 10, ['plain', 'html'], 'html');

    // jsdom reports every measured size as 0, so coordinates cannot be asserted for clamping.
    // We assert only that left and top styles were set at all.
    expect(root.style.left.length).toBeGreaterThan(0);
    expect(root.style.top.length).toBeGreaterThan(0);
  });
});

describe('the styles', () => {
  it('both panels hide when hidden', () => {
    expect(PASTE_SPECIAL_STYLES).toContain('.kdoc-paste-special[hidden]');
    expect(PASTE_OPTIONS_STYLES).toContain('.kdoc-paste-popup[hidden]');
  });

  it('the popup keeps the caret', () => {
    expect(PASTE_OPTIONS_STYLES).toContain('user-select: none');
  });
});
