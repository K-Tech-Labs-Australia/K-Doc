// @vitest-environment jsdom
/**
 * @file keymap-service.spec.ts
 * @purpose Exercises focusContextOf and scopeAllows plus the capture-phase keymap service through jsdom, asserting scoping decisions, command claims, explanations, suspension, and teardown.
 * @inputs KeyboardEventInit descriptors for simulated keydowns; DOM fixtures (wysiwyg paragraph, source div, input field, tree row, button); a ResolvedKeymap factory whose bindings can be swapped mid-test.
 * @outputs void test side effects: assertions on ran/explained arrays, event.defaultPrevented, and focusContextOf/scopeAllows return values.
 * @functions
 *   - mount: Builds the DOM fixtures and installs a keymap service wired to them.
 *   - press: Dispatches a synthetic KeyboardEvent on capture-bubbling from a target element.
 * @dataflow test body → mount() harness → press() event → document capture listener → scopeAllows/command.run/explain → assertions.
 * @controlflow Each it mounts a fresh service, presses keys against fixtures, and asserts outcomes; afterEach destroys services and clears the DOM.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveKeymap, scopeOf, UNBOUND_SHORTCUT_EXPLANATIONS, type KeyBindings } from '@k-doc/config';
import { focusContextOf, scopeAllows } from '../src/shell/keymap-scope.js';
import { installKeymapService, type KeymapService } from '../src/shell/keymap-service.js';

const services: KeymapService[] = [];
afterEach((): void => { for (const s of services) { s.destroy(); } services.length = 0; document.body.replaceChildren(); });

interface Harness { service: KeymapService; ran: string[]; explained: string[]; wysiwyg: HTMLElement; source: HTMLElement; field: HTMLInputElement; tree: HTMLElement; other: HTMLButtonElement; setBindings(bindings: KeyBindings): void; }

/**
 * @purpose Builds the DOM fixtures for the keymap service and installs it against a word keymap with an empty binding set.
 * @inputs none - The harness reuses document.body; bindings start empty and can be changed via the returned setBindings.
 * @outputs Harness - A handle exposing the service, the ran/explained log arrays, the fixture elements, and setBindings.
 * @dataflow resolveKeymap('word', {}) → installKeymapService options → service wired to fixtures; fixture elements collected into the harness.
 * @controlflow Create and append fixtures → build command list → install service with scopeOf/contextOf/explanations → return handle.
 */
function mount(): Harness {
  const wysiwyg = document.createElement('div');
  wysiwyg.className = 'wysiwyg';
  const paragraph = document.createElement('p');
  paragraph.tabIndex = 0;
  wysiwyg.append(paragraph);

  const source = document.createElement('div');
  source.tabIndex = 0;

  const field = document.createElement('input');

  const tree = document.createElement('div');
  tree.setAttribute('role', 'tree');
  const treeRow = document.createElement('div');
  treeRow.tabIndex = 0;
  tree.append(treeRow);

  const other = document.createElement('button');

  document.body.append(wysiwyg, source, field, tree, other);

  let keymap = resolveKeymap('word', {});
  const ran: string[] = [];
  const explained: string[] = [];
  const commandIds = ['format:bold', 'file:save', 'file:rename', 'edit:undo'];
  const service = installKeymapService({
    doc: document,
    keymap: () => keymap,
    commands: () => commandIds.map((id) => ({ id, run: (): boolean => { ran.push(id); return true; } })),
    scopeOf: (id) => scopeOf(id),
    contextOf: (target) => focusContextOf(target, wysiwyg, source),
    explanations: UNBOUND_SHORTCUT_EXPLANATIONS,
    explain: (message) => { explained.push(message); },
  });
  services.push(service);

  return { service, ran, explained, wysiwyg: paragraph, source, field, tree: treeRow, other, setBindings: (bindings) => { keymap = resolveKeymap('word', bindings); } };
}

/**
 * @purpose Dispatches a synthetic keydown so the capture-phase listener processes it exactly as a real keypress would.
 * @inputs target - The element to dispatch the event on; init - KeyboardEventInit fields merged into the synthetic event.
 * @outputs KeyboardEvent - The dispatched event, whose defaultPrevented reflects any claim made by the service.
 * @dataflow init → KeyboardEvent constructor with bubbles/cancelable → target.dispatchEvent → returned event.
 * @controlflow Construct event with defaults overridden by init; dispatch synchronously; return the same instance for assertion.
 */
function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('where a key was pressed', (): void => {
  it('tells the editors, fields, widgets and the rest apart', (): void => {
    const h = mount();
    expect(focusContextOf(h.wysiwyg, h.wysiwyg.parentElement ?? h.wysiwyg, h.source)).toBe('wysiwyg');
    expect(focusContextOf(h.source, h.wysiwyg, h.source)).toBe('source');
    expect(focusContextOf(h.field, h.wysiwyg, h.source)).toBe('field');
    expect(focusContextOf(h.tree, h.wysiwyg, h.source)).toBe('widget');
    expect(focusContextOf(h.other, h.wysiwyg, h.source)).toBe('other');
    expect(focusContextOf(null, h.wysiwyg, h.source)).toBe('other');
    expect(focusContextOf(document, h.wysiwyg, h.source)).toBe('other');
  });

  it('treats an editable element outside the editors as a field', (): void => {
    const h = mount();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.append(inner);
    document.body.append(editable);
    expect(focusContextOf(inner, h.wysiwyg, h.source)).toBe('field');
  });

  it('lets each scope run only where it means something', (): void => {
    expect([scopeAllows('editor', 'wysiwyg', 'Ctrl+B'), scopeAllows('editor', 'source', 'Ctrl+B'), scopeAllows('editor', 'other', 'Ctrl+B')]).toEqual([true, false, false]);
    expect([scopeAllows('document', 'field', 'Ctrl+Z'), scopeAllows('document', 'source', 'Ctrl+Z'), scopeAllows('document', 'widget', 'Ctrl+Z')]).toEqual([false, true, true]);
    expect([scopeAllows('global', 'field', 'Ctrl+S'), scopeAllows('global', 'widget', 'F2'), scopeAllows('global', 'widget', 'Ctrl+S'), scopeAllows('global', 'widget', 'Alt+Up'), scopeAllows('global', 'other', 'F7')]).toEqual([true, false, true, true, true]);
  });
});

describe('the keymap service', (): void => {
  it('runs a bound command and claims the key', (): void => {
    const h = mount();
    const event = press(h.other, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(h.ran).toEqual(['file:save']);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops the key before an editor's own listener sees it", (): void => {
    const h = mount();
    const seen: string[] = [];
    h.wysiwyg.addEventListener('keydown', () => { seen.push('editor'); });
    press(h.wysiwyg, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(h.ran).toEqual(['format:bold']);
    expect(seen).toEqual([]);
  });

  it('leaves an editor command to the Source pane', (): void => {
    const h = mount();
    const event = press(h.source, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(h.ran).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves undo to a text field', (): void => {
    const h = mount();
    press(h.field, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(h.ran).toEqual([]);
    press(h.other, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(h.ran).toEqual(['edit:undo']);
  });

  it('leaves a widget its own unmodified keys', (): void => {
    const h = mount();
    press(h.tree, { key: 'F2', code: 'F2' });
    expect(h.ran).toEqual([]);
    press(h.other, { key: 'F2', code: 'F2' });
    expect(h.ran).toEqual(['file:rename']);
  });

  it('follows a changed binding on the next key', (): void => {
    const h = mount();
    h.setBindings({ 'format:bold': ['Ctrl+Alt+B'] });
    press(h.wysiwyg, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(h.ran).toEqual([]);
    press(h.wysiwyg, { key: 'b', code: 'KeyB', ctrlKey: true, altKey: true });
    expect(h.ran).toEqual(['format:bold']);
  });

  it('does nothing for a binding whose command is not offered', (): void => {
    const h = mount();
    const event = press(h.other, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(h.ran).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('explains a Word shortcut K-Doc leaves unbound, except in a field', (): void => {
    const h = mount();
    const event = press(h.wysiwyg, { key: 'u', code: 'KeyU', ctrlKey: true });
    expect(h.explained).toEqual([UNBOUND_SHORTCUT_EXPLANATIONS['Ctrl+U']]);
    expect(event.defaultPrevented).toBe(true);
    press(h.field, { key: 'u', code: 'KeyU', ctrlKey: true });
    expect(h.explained.length).toBe(1);
  });

  it('stops explaining a shortcut once it is bound', (): void => {
    const h = mount();
    h.setBindings({ 'file:save': ['Ctrl+U'] });
    press(h.other, { key: 'u', code: 'KeyU', ctrlKey: true });
    expect(h.explained).toEqual([]);
    expect(h.ran).toEqual(['file:save']);
  });

  it('ignores typing and keys already claimed', (): void => {
    const h = mount();
    press(h.wysiwyg, { key: 'b', code: 'KeyB' });
    const claimed = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true });
    claimed.preventDefault();
    h.other.dispatchEvent(claimed);
    expect(h.ran).toEqual([]);
  });

  it('handles nothing while suspended, and again once resumed', (): void => {
    const h = mount();
    h.service.setSuspended(true);
    press(h.other, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(h.ran).toEqual([]);
    h.service.setSuspended(false);
    press(h.other, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(h.ran).toEqual(['file:save']);
  });

  it('stops listening when destroyed, and can be destroyed twice', (): void => {
    const h = mount();
    h.service.destroy();
    h.service.destroy();
    press(h.other, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(h.ran).toEqual([]);
  });
});
