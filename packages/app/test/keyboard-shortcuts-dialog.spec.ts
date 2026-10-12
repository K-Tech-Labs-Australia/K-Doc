// @vitest-environment jsdom
/**
 * @file keyboard-shortcuts-dialog.spec.ts
 * @purpose Verifies the Keyboard Shortcuts dialog (installKeyboardShortcutsDialog) behaviour: listing, search filtering, chord recording, conflict takeover, removal and reset, preset switching, lifecycle and token-only styling.
 * @inputs The mounted <dialog> DOM produced by installKeyboardShortcutsDialog; synthetic click and keyboard events dispatched through small test harness helpers.
 * @outputs Assertions on dialog state, settings changes, recording flags, rendered rows and CSS usage; no runtime output beyond Vitest results.
 * @functions
 *   - mount: Installs the dialog with in-memory settings and records change/recording callbacks into arrays.
 *   - row: Returns a command row element by its data-command id, throwing when absent.
 *   - buttonIn: Returns a labelled <button> inside an element by exact text content, throwing when absent.
 *   - chips: Reads the chord labels of a command row in document order.
 *   - press: Dispatches a synthetic keydown at the recording target row or the dialog root.
 *   - statusText: Reads the live-region status text.
 *   - conflictLine: Returns the conflicts region element, throwing when absent.
 *   - search: Returns the search input, throwing when absent.
 *   - presetSelect: Returns the preset select, throwing when absent.
 * @dataflow mount() builds DOM from settings → user events dispatched via harness helpers → dialog mutates model → onChange/onRecording push into recorded arrays → assertions read state back.
 * @controlflow afterEach clears body; each test opens the dialog and drives it through clicks and key presses, asserting after each step.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { KeyboardSettings } from '@k-doc/config';
import { installKeyboardShortcutsDialog, KEYBOARD_SHORTCUTS_STYLES, type KeyboardShortcutsDialog } from '../src/shell/keyboard-shortcuts-dialog.js';

afterEach((): void => { document.body.replaceChildren(); });

interface Harness { dialog: KeyboardShortcutsDialog; root: HTMLDialogElement; changes: KeyboardSettings[]; recording: boolean[]; current(): KeyboardSettings; }

/**
 * @purpose Installs the keyboard shortcuts dialog with in-memory settings and returns a test harness that records changes and recording flags.
 * @inputs initial - The starting KeyboardSettings (preset and bindings) for this mount.
 * @outputs Harness - Exposes the dialog handle, root element, recorded changes and recording flags, plus current() to read live settings.
 * @dataflow initial settings feed keyboard(); every onChange pushes into changes and every onRecording pushes into recording; current() returns the latest settings.
 * @controlflow Build options with closures over mutable state → install the dialog → locate the mounted <dialog> → return the harness.
 */
function mount(initial: KeyboardSettings = { preset: 'word', bindings: {} }): Harness {
  let settings = initial; const changes: KeyboardSettings[] = []; const recording: boolean[] = [];
  const dialog = installKeyboardShortcutsDialog({ doc: document, keyboard: () => settings, labels: () => [{ id: 'format:bold', label: 'Bold', category: 'Format' }, { id: 'format:italic', label: 'Italic', category: 'Format' }], onChange: (next) => { settings = next; changes.push(next); }, onRecording: (on) => { recording.push(on); } });
  const root = document.querySelector('dialog.kdoc-shortcuts-dialog');
  if (!(root instanceof HTMLDialogElement)) {
    // The dialog was not appended to the document body.
    throw new Error('dialog not mounted');
  } else {
    // A native <dialog> element is present in the document.
  }
  return { dialog, root, changes, recording, current: () => settings };
}

/**
 * @purpose Returns the command row element matching a given command id from the dialog.
 * @inputs h - The test harness whose root contains the rendered rows.
 *   id - The data-command value to look up (for example 'format:bold').
 * @outputs HTMLElement - The matching row element.
 * @dataflow The command id is interpolated into a CSS attribute selector and matched against the dialog DOM.
 * @controlflow Query for the row; throw when null, otherwise return it.
 */
function row(h: Harness, id: string): HTMLElement {
  const el = h.root.querySelector<HTMLElement>(`[data-command="${id}"]`);
  if (el === null) {
    // No such command row exists in the dialog.
    throw new Error(`no row ${id}`);
  } else {
    // Found the requested command row.
  }
  return el;
}

/**
 * @purpose Returns a labelled button inside an element by its exact text content.
 * @inputs el - The container to search within.
 *   text - The exact label text the target button must have.
 * @outputs HTMLButtonElement - The matching button.
 * @dataflow All buttons in el are collected and filtered by textContent equality against text.
 * @controlflow Filter the button list; throw when none match, otherwise return the found button.
 */
function buttonIn(el: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text);
  if (found === undefined) {
    // No button with this exact label exists inside the element.
    throw new Error(`no button ${text}`);
  } else {
    // Found the labelled button.
  }
  return found;
}

/**
 * @purpose Reads the chord labels of a command row in document order.
 * @inputs h - The test harness providing the dialog root.
 *   id - The data-command value of the row to inspect.
 * @outputs string[] - Each chip's data-chord attribute, empty string when absent.
 * @dataflow The row is queried for chord chips and each data-chord value is mapped into an array.
 * @controlflow Query all chord elements and map their dataset values in order.
 */
function chips(h: Harness, id: string): string[] {
  return Array.from(row(h, id).querySelectorAll<HTMLElement>('.kdoc-shortcuts-chord')).map((c) => c.dataset['chord'] ?? '');
}

/**
 * @purpose Dispatches a synthetic keydown event at the recording target row or the dialog root.
 * @inputs h - The test harness providing the dialog root.
 *   init - KeyboardEventInit fields merged into the synthetic event (key, code, modifier flags).
 * @outputs KeyboardEvent - The dispatched event, for asserting defaultPrevented.
 * @dataflow The provided init is spread into a keydown event which is then fired at the recording button or root.
 * @controlflow Build the event with bubbles and cancelable → dispatch at the recording target if present else the root → return it.
 */
function press(h: Harness, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  (h.root.querySelector<HTMLElement>('[data-recording="true"] button') ?? h.root).dispatchEvent(event);
  return event;
}

/**
 * @purpose Reads the current live-region status text from the dialog.
 * @inputs h - The test harness providing the dialog root.
 * @outputs string - The status element text content, or empty string when absent.
 * @dataflow The [role="status"] element is queried and its textContent read.
 * @controlflow Query the status element; return its text or an empty string.
 */
function statusText(h: Harness): string {
  return h.root.querySelector('[role="status"]')?.textContent ?? '';
}

/**
 * @purpose Returns the conflicts region element from the dialog.
 * @inputs h - The test harness providing the dialog root.
 * @outputs HTMLElement - The [data-role="conflicts"] element.
 * @dataflow The conflicts region is queried by its data-role attribute.
 * @controlflow Query for the region; throw when null, otherwise return it.
 */
function conflictLine(h: Harness): HTMLElement {
  const el = h.root.querySelector<HTMLElement>('[data-role="conflicts"]');
  if (el === null) {
    // The conflicts region is missing from the dialog.
    throw new Error('no conflict line');
  } else {
    // Found the conflicts region.
  }
  return el;
}

/**
 * @purpose Returns the search input element from the dialog.
 * @inputs h - The test harness providing the dialog root.
 * @outputs HTMLInputElement - The [type="search"] input.
 * @dataflow The search input is queried by its type attribute.
 * @controlflow Query for the input; throw when null, otherwise return it.
 */
function search(h: Harness): HTMLInputElement {
  const el = h.root.querySelector<HTMLInputElement>('input[type="search"]');
  if (el === null) {
    // The search input is missing from the dialog.
    throw new Error('no search input');
  } else {
    // Found the search input.
  }
  return el;
}

/**
 * @purpose Returns the preset select element from the dialog.
 * @inputs h - The test harness providing the dialog root.
 * @outputs HTMLSelectElement - The <select> used to choose a preset.
 * @dataflow The select is queried by tag name.
 * @controlflow Query for the select; throw when null, otherwise return it.
 */
function presetSelect(h: Harness): HTMLSelectElement {
  const el = h.root.querySelector<HTMLSelectElement>('select');
  if (el === null) {
    // The preset select is missing from the dialog.
    throw new Error('no preset select');
  } else {
    // Found the preset select.
  }
  return el;
}

describe('the keyboard shortcuts dialog', (): void => {
  it('opens with every command listed and the search focused', (): void => {
    const h = mount();
    h.dialog.open();
    expect(h.dialog.isOpen).toBe(true);
    expect(document.activeElement).toBe(search(h));
    expect(chips(h, 'format:bold')).toEqual(['Ctrl+B']);
    expect(row(h, 'format:bold').textContent).toContain('Bold');
    expect(presetSelect(h).value).toBe('word');
    expect(Array.from(presetSelect(h).options).map((o) => o.textContent)).toEqual(['Word', 'VS Code', 'Typora', 'Obsidian']);
  });
  it('filters rows as the search changes', (): void => {
    const h = mount();
    h.dialog.open();
    search(h).value = 'italic';
    search(h).dispatchEvent(new Event('input'));
    expect(Array.from(h.root.querySelectorAll<HTMLElement>('[data-command]')).map((r) => r.dataset['command'])).toEqual(['format:italic']);
  });
  it('records a free chord and suspends shortcuts while recording', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    expect(h.recording).toEqual([true]);
    expect(row(h, 'format:bold').getAttribute('data-recording')).toBe('true');
    expect(statusText(h)).toBe('Press the shortcut for Bold, or Escape to cancel.');
    const ev = press(h, { key: 'b', code: 'KeyB', ctrlKey: true, altKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(h.recording).toEqual([true, false]);
    expect(chips(h, 'format:bold')).toEqual(['Ctrl+B', 'Ctrl+Alt+B']);
    expect(h.changes).toHaveLength(1);
    expect(statusText(h)).toBe('Bold: Ctrl+Alt+B added.');
  });
  it('waits through a lone modifier and warns about a key without one', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(statusText(h)).toBe('Press the shortcut for Bold, or Escape to cancel.');
    press(h, { key: 'b', code: 'KeyB' });
    expect(statusText(h)).toBe('Use Ctrl or Alt with a key, or a function key on its own.');
    expect(h.changes).toEqual([]);
    expect(h.recording).toEqual([true]);
  });
  it('cancels recording on Escape without changing anything', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'Escape', code: 'Escape' });
    expect(h.recording).toEqual([true, false]);
    expect(h.changes).toEqual([]);
    expect(row(h, 'format:bold').hasAttribute('data-recording')).toBe(false);
    expect(statusText(h)).toBe('');
  });
  it('clicking Add again cancels recording', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    buttonIn(row(h, 'format:bold'), 'Press keys…').click();
    expect(h.recording).toEqual([true, false]);
    expect(buttonIn(row(h, 'format:bold'), 'Add')).toBeDefined();
  });
  it('says when the command already has the chord', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(statusText(h)).toBe('Bold already uses Ctrl+B.');
    expect(h.changes).toEqual([]);
    expect(h.recording).toEqual([true, false]);
  });
  it('asks before taking a chord from another command and moves it on Enter', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'i', code: 'KeyI', ctrlKey: true });
    expect(statusText(h)).toBe('Ctrl+I is used by Italic. Press Enter to use it for Bold instead, or Escape to keep it there.');
    expect(h.changes).toEqual([]);
    press(h, { key: 'x', code: 'KeyX', ctrlKey: true });
    expect(h.changes).toEqual([]);
    press(h, { key: 'Enter', code: 'Enter' });
    expect(chips(h, 'format:bold')).toEqual(['Ctrl+B', 'Ctrl+I']);
    expect(chips(h, 'format:italic')).toEqual([]);
    expect(statusText(h)).toBe('Ctrl+I now runs Bold.');
    expect(h.recording).toEqual([true, false]);
  });
  it('keeps the chord where it was when the takeover is declined', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'i', code: 'KeyI', ctrlKey: true });
    press(h, { key: 'Escape', code: 'Escape' });
    expect(h.changes).toEqual([]);
    expect(chips(h, 'format:italic')).toEqual(['Ctrl+I']);
    expect(h.recording).toEqual([true, false]);
    expect(statusText(h)).toBe('');
  });
  it('ignores keys when not recording', (): void => {
    const h = mount();
    h.dialog.open();
    const ev = press(h, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(h.changes).toEqual([]);
  });
  it('removes a chord and resets the command', (): void => {
    const h = mount();
    h.dialog.open();
    const reset = buttonIn(row(h, 'format:bold'), 'Reset');
    expect(reset.disabled).toBe(true);
    const remove = row(h, 'format:bold').querySelector<HTMLButtonElement>('.kdoc-shortcuts-chord-remove');
    if (remove === null) {
      // The chord remove button is missing from the row.
      throw new Error('no remove button');
    } else {
      // Found the chord remove button.
    }
    expect(remove.getAttribute('aria-label')).toBe('Remove Ctrl+B from Bold');
    remove.click();
    expect(chips(h, 'format:bold')).toEqual([]);
    expect(row(h, 'format:bold').querySelector('.kdoc-shortcuts-none')?.textContent).toBe('None');
    expect(buttonIn(row(h, 'format:bold'), 'Reset').disabled).toBe(false);
    buttonIn(row(h, 'format:bold'), 'Reset').click();
    expect(chips(h, 'format:bold')).toEqual(['Ctrl+B']);
    expect(h.current().bindings).toEqual({});
  });
  it('shows conflicts on their own line and clears it once resolved', (): void => {
    const h = mount({ preset: 'word', bindings: { 'format:bold': ['Ctrl+B', 'Ctrl+I'] } });
    h.dialog.open();
    expect(conflictLine(h).hidden).toBe(false);
    expect(conflictLine(h).textContent).toBe('1 shortcut is claimed by two commands; the one you set yourself wins.');
    expect(row(h, 'format:bold').querySelector('[data-chord="Ctrl+I"]')?.getAttribute('data-conflict')).toBe('true');
    expect(row(h, 'format:bold').querySelector('[data-chord="Ctrl+B"]')?.hasAttribute('data-conflict')).toBe(false);
    buttonIn(h.root, 'Reset All').click();
    expect(conflictLine(h).hidden).toBe(true);
    expect(h.current()).toEqual({ preset: 'word', bindings: {} });
    expect(buttonIn(h.root, 'Reset All').disabled).toBe(true);
  });
  it('switches preset and keeps the user bindings', (): void => {
    const h = mount({ preset: 'word', bindings: { 'format:bold': ['Ctrl+Alt+B'] } });
    h.dialog.open();
    presetSelect(h).value = 'vscode';
    presetSelect(h).dispatchEvent(new Event('change'));
    expect(h.current()).toEqual({ preset: 'vscode', bindings: { 'format:bold': ['Ctrl+Alt+B'] } });
    presetSelect(h).value = 'nonsense';
    presetSelect(h).dispatchEvent(new Event('change'));
    expect(h.changes).toHaveLength(1);
  });
  it('stops recording when closed and removes itself on destroy', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    buttonIn(h.root, 'Close').click();
    expect(h.dialog.isOpen).toBe(false);
    expect(h.recording).toEqual([true, false]);
    h.dialog.destroy();
    expect(document.querySelector('dialog.kdoc-shortcuts-dialog')).toBeNull();
    h.dialog.destroy();
    h.dialog.open();
    expect(h.dialog.isOpen).toBe(false);
  });
  it('marks only warnings in the warning colour', (): void => {
    const h = mount();
    h.dialog.open();
    const status = h.root.querySelector<HTMLElement>('[role="status"]');
    buttonIn(row(h, 'format:bold'), 'Add').click();
    expect(status?.hasAttribute('data-state')).toBe(false);
    press(h, { key: 'b', code: 'KeyB' });
    expect(status?.getAttribute('data-state')).toBe('warning');
    press(h, { key: 'b', code: 'KeyB', ctrlKey: true, altKey: true });
    expect(status?.hasAttribute('data-state')).toBe(false);
  });
  it('keeps focus on the row being recorded', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:italic'), 'Add').click();
    expect(document.activeElement).toBe(buttonIn(row(h, 'format:italic'), 'Press keys…'));
  });
  it('treats Escape with a modifier as a shortcut attempt, not a cancel', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    press(h, { key: 'Escape', code: 'Escape', ctrlKey: true });
    expect(chips(h, 'format:bold')).toEqual(['Ctrl+B', 'Ctrl+Escape']);
  });
  it('opens as a modal and closes through the dialog API when the browser has them', (): void => {
    const h = mount();
    const calls: string[] = [];
    h.root.showModal = (): void => { calls.push('showModal'); h.root.setAttribute('open', ''); };
    h.root.close = (): void => { calls.push('close'); h.root.removeAttribute('open'); };
    h.dialog.open();
    h.dialog.close();
    expect(calls).toEqual(['showModal', 'close']);
  });
  it('refuses the Escape close only while recording', (): void => {
    const h = mount();
    h.dialog.open();
    buttonIn(row(h, 'format:bold'), 'Add').click();
    const whileRecording = new Event('cancel', { cancelable: true });
    h.root.dispatchEvent(whileRecording);
    expect(whileRecording.defaultPrevented).toBe(true);
    expect(h.recording).toEqual([true]);
    press(h, { key: 'Escape', code: 'Escape' });
    const idle = new Event('cancel', { cancelable: true });
    h.root.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
  });
  it('detaches the controls of rows it has redrawn', (): void => {
    const h = mount();
    h.dialog.open();
    const stale = buttonIn(row(h, 'format:bold'), 'Reset');
    search(h).dispatchEvent(new Event('input'));
    stale.disabled = false;
    stale.click();
    expect(h.changes).toEqual([]);
  });
  it('styles only with theme tokens', (): void => {
    const colours = KEYBOARD_SHORTCUTS_STYLES.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
    expect(colours).toBeNull();
    // A conflicting chord is a failure state, and under the Avimorphism chrome that is the
    // emissive red rather than the page's danger colour. The assertion moved with the token,
    // not with the styling: it still pins that a conflict is marked by the semantic red.
    expect(KEYBOARD_SHORTCUTS_STYLES).toContain('var(--kdoc-emissive-red)');
  });
});