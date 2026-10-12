// @vitest-environment jsdom
/**
 * @file files-panel.spec.ts
 * @purpose Exercises FilesPanel (FR-6.11): empty/scanning states, folder expansion, note selection, keyboard navigation and commands, toolbar actions, refresh persistence, vault switching, focus, and stylesheet export; menus and drag-drop live in files-panel-drag.spec.ts.
 * @inputs Vitest globals; jsdom document; harness accessors mirroring FilesPanelOptions for notes/folders/root/scanning/canOpen/open handlers/actions/showMenu.
 * @outputs Assertions over rendered rows, selection, focus, toolbar state, and recorded action strings produced by installFilesPanel.
 * @functions
 *   - describeNodes: Joins node relative paths into a comma-separated record string.
 *   - mount: Installs a FilesPanel wired to mutable harness state and returns the harness plus spies.
 *   - rows: Returns visible row relative paths in DOM order.
 *   - selected: Returns currently selected row relative paths.
 *   - row: Finds a rendered row by relative path or throws when absent.
 *   - click: Dispatches a bubbling MouseEvent on a row.
 *   - press: Dispatches a bubbling KeyboardEvent on the tree element.
 *   - tool: Finds a toolbar button by aria-label or throws when absent.
 * @dataflow harness state -> FilesPanelOptions accessors -> installFilesPanel -> rendered DOM rows -> assertions in each test.
 * @controlflow afterEach tears down panels; each test mounts fresh, drives interaction via helpers, then asserts on DOM and recorded actions.
 * @version 2
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { TreeNode, TreeNote } from '@k-doc/core';
import { installFilesPanel, FILES_PANEL_STYLES, type FilesPanel } from '../src/shell/files-panel.js';
import type { FileTreeActions } from '../src/shell/file-tree-actions.js';

const NOTES: readonly TreeNote[] = [
  { path: '/v/a.md', relative: 'a.md', title: 'A' },
  { path: '/v/docs/guide.md', relative: 'docs/guide.md', title: 'Guide' },
  { path: '/v/docs/sub/x.md', relative: 'docs/sub/x.md', title: '' },
];
const FOLDERS: readonly string[] = ['docs', 'docs/sub', 'empty'];
const panels: FilesPanel[] = [];
afterEach((): void => { for (const p of panels) { p.destroy(); } panels.length = 0; document.body.replaceChildren(); });

interface Harness { panel: FilesPanel; state: { root: string | null; notes: readonly TreeNote[]; folders: readonly string[]; scanning: boolean; canOpen: boolean }; opened: string[]; openVaultCalls: number; actions: string[]; }

/**
 * @purpose Joins node relative paths into a comma-separated record string.
 * @inputs list - TreeNodes to describe.
 * @outputs string - Relative paths joined by commas.
 * @dataflow list -> map relative -> join with ','.
 * @controlflow Map each node then join; empty when list is empty.
 */
function describeNodes(list: readonly TreeNode[]): string { return list.map((n) => n.relative).join(','); }

/**
 * @purpose Installs a FilesPanel wired to mutable harness state and returns the harness plus spies.
 * @inputs overrides - Partial state overriding root/notes/folders/scanning/canOpen defaults.
 * @outputs Harness - Panel, live state snapshot, opened paths, openVault call count, recorded actions.
 * @dataflow harness.state -> accessor closures -> installFilesPanel -> mounted element appended to body.
 * @controlflow Build default state then overrides; wire action spies; install panel; push to teardown list.
 */
function mount(overrides: Partial<Harness['state']> = {}): Harness {
  const harness: Harness = { panel: undefined as unknown as FilesPanel, state: { root: '/v', notes: NOTES, folders: FOLDERS, scanning: false, canOpen: true, ...overrides }, opened: [], openVaultCalls: 0, actions: [] };
  const record = (entry: string): Promise<void> => { harness.actions.push(entry); return Promise.resolve(); };
  const actions: FileTreeActions = {
    newNote: (folder) => record(`newNote ${folder}`), newFolder: (folder) => record(`newFolder ${folder}`), newFromTemplate: (folder) => record(`newFromTemplate ${folder}`),
    rename: (n) => record(`rename ${n.relative}`), trash: (list) => record(`trash ${describeNodes(list)}`), move: (list, folder) => record(`move ${describeNodes(list)} -> ${folder}`),
    reveal: (n) => { harness.actions.push(`reveal ${n.relative}`); },
  };
  const panel = installFilesPanel({ doc: document, notes: () => harness.state.notes, folders: () => harness.state.folders, root: () => harness.state.root, scanning: () => harness.state.scanning, canOpen: () => harness.state.canOpen, openVault: () => { harness.openVaultCalls += 1; }, openNote: (path) => { harness.opened.push(path); }, actions, showMenu: () => undefined });
  harness.panel = panel; document.body.append(panel.element); panels.push(panel); return harness;
}

/**
 * @purpose Returns visible row relative paths in DOM order.
 * @inputs h - Harness whose rendered tree is inspected.
 * @outputs string[] - data-relative of each .kdoc-tree-row.
 * @dataflow querySelectorAll -> map dataset.relative with ?? fallback.
 * @controlflow Select all rows then project to relative; empty when no rows.
 */
function rows(h: Harness): string[] { return [...h.panel.element.querySelectorAll<HTMLElement>('.kdoc-tree-row')].map((r) => r.dataset['relative'] ?? ''); }

/**
 * @purpose Returns currently selected row relative paths.
 * @inputs h - Harness whose tree selection is inspected.
 * @outputs string[] - data-relative of rows with aria-selected="true".
 * @dataflow querySelectorAll filtered by aria-selected -> map dataset.relative.
 * @controlflow Select selected rows then project to relative; empty when none.
 */
function selected(h: Harness): string[] { return [...h.panel.element.querySelectorAll<HTMLElement>('.kdoc-tree-row[aria-selected="true"]')].map((r) => r.dataset['relative'] ?? ''); }

/**
 * @purpose Finds a rendered row by relative path or throws when absent.
 * @inputs h - Harness; relative - target data-relative.
 * @outputs HTMLElement - The matching row element.
 * @dataflow querySelectorAll -> find matching dataset.relative.
 * @controlflow Locate first match; throw `no row <relative>` when missing.
 */
function row(h: Harness, relative: string): HTMLElement { const found = [...h.panel.element.querySelectorAll<HTMLElement>('.kdoc-tree-row')].find((r) => r.dataset['relative'] === relative); if (found === undefined) throw new Error(`no row ${relative}`); else return found; }

/**
 * @purpose Dispatches a bubbling click on a row.
 * @inputs h - Harness; relative - target row; init - MouseEventInit overrides.
 * @outputs void
 * @dataflow resolve row -> dispatch MouseEvent('click').
 * @controlflow Find row then fire click with bubbles and provided modifiers.
 */
function click(h: Harness, relative: string, init: MouseEventInit = {}): void { row(h, relative).dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })); }

/**
 * @purpose Dispatches a bubbling keydown on the tree element.
 * @inputs h - Harness; key - KeyboardEvent key; init - overrides.
 * @outputs void
 * @dataflow resolve .kdoc-tree -> dispatch KeyboardEvent('keydown').
 * @controlflow Find tree or throw; fire keydown with bubbles and cancelable.
 */
function press(h: Harness, key: string, init: KeyboardEventInit = {}): void { const tree = h.panel.element.querySelector('.kdoc-tree'); if (tree === null) throw new Error('no tree'); else tree.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); }

/**
 * @purpose Finds a toolbar button by aria-label or throws when absent.
 * @inputs h - Harness; label - target aria-label.
 * @outputs HTMLButtonElement - The matching button.
 * @dataflow querySelector button[aria-label] -> match.
 * @controlflow Locate button or throw with its label.
 */
function tool(h: Harness, label: string): HTMLButtonElement { const found = h.panel.element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); if (found === null) throw new Error(label); else return found; }

describe('the vault file tree', (): void => {
  it('says no folder is open and offers to open one', (): void => {
    const h = mount({ root: null });
    expect(h.panel.element.querySelector('.kdoc-files-empty')?.textContent).toBe('No folder open.');
    h.panel.element.querySelector<HTMLButtonElement>('.kdoc-files-open')?.click();
    expect(h.openVaultCalls).toBe(1);
    expect(tool(h, 'New note').disabled).toBe(true);
  });

  it('offers no open button without a folder picker', (): void => {
    const h = mount({ root: null, canOpen: false });
    expect(h.panel.element.querySelector('.kdoc-files-open')).toBeNull();
  });

  it('says it is scanning before anything is found', (): void => {
    const h = mount({ notes: [], folders: [], scanning: true });
    expect(h.panel.element.querySelector('.kdoc-files-empty')?.textContent).toBe('Scanning\u2026');
  });

  it('names the vault folder, not its whole path', (): void => {
    const h = mount({ root: 'C:\\notes\\vault' });
    const label = h.panel.element.querySelector<HTMLElement>('.kdoc-files-root');
    expect(label?.textContent).toBe('vault');
    expect(label?.title).toBe('C:\\notes\\vault');
  });

  it('lists folders first, collapsed, then notes', (): void => {
    const h = mount();
    expect(rows(h)).toEqual(['docs', 'empty', 'a.md']);
    expect(row(h, 'docs').getAttribute('aria-expanded')).toBe('false');
    const tree = h.panel.element.querySelector('.kdoc-tree');
    expect(tree?.getAttribute('role')).toBe('tree');
    expect(tree?.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('expands and collapses a folder on a click', (): void => {
    const h = mount();
    click(h, 'docs');
    expect(rows(h)).toEqual(['docs', 'docs/sub', 'docs/guide.md', 'empty', 'a.md']);
    click(h, 'docs');
    expect(rows(h)).toEqual(['docs', 'empty', 'a.md']);
  });

  it('opens and selects a clicked note', (): void => {
    const h = mount();
    click(h, 'a.md');
    expect(h.opened).toEqual(['/v/a.md']);
    expect(selected(h)).toEqual(['a.md']);
  });

  it('adds with Ctrl and extends with Shift without opening', (): void => {
    const h = mount();
    click(h, 'empty');
    click(h, 'a.md', { ctrlKey: true });
    expect(selected(h)).toEqual(['empty', 'a.md']);
    expect(h.opened).toEqual([]);
    click(h, 'docs', { shiftKey: true });
    expect(selected(h)).toEqual(['docs', 'empty', 'a.md']);
  });

  it('moves, expands and collapses from the keyboard', (): void => {
    const h = mount();
    click(h, 'a.md');
    press(h, 'ArrowUp');
    expect(selected(h)).toEqual(['empty']);
    expect(document.activeElement).toBe(row(h, 'empty'));
    press(h, 'ArrowUp');
    press(h, 'ArrowRight');
    expect(row(h, 'docs').getAttribute('aria-expanded')).toBe('true');
    press(h, 'ArrowRight');
    expect(selected(h)).toEqual(['docs/sub']);
    press(h, 'ArrowLeft');
    expect(selected(h)).toEqual(['docs']);
    press(h, 'ArrowLeft');
    expect(row(h, 'docs').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens with Enter, renames with F2 and deletes the selection with Delete', (): void => {
    const h = mount();
    click(h, 'a.md');
    press(h, 'Enter');
    expect(h.opened).toEqual(['/v/a.md', '/v/a.md']);
    press(h, 'F2');
    click(h, 'empty', { ctrlKey: true });
    press(h, 'Delete');
    expect(h.actions).toEqual(['rename a.md', 'trash empty,a.md']);
  });

  it('selects every row with Ctrl+A', (): void => {
    const h = mount();
    click(h, 'docs');
    press(h, 'a', { ctrlKey: true });
    expect(selected(h)).toEqual(rows(h));
  });

  it("creates into the focused note's folder and shows that folder open afterwards", (): void => {
    const h = mount();
    click(h, 'docs');
    click(h, 'docs/sub');
    click(h, 'docs/sub');
    expect(rows(h)).not.toContain('docs/sub/x.md');
    tool(h, 'New folder').click();
    expect(h.actions).toEqual(['newFolder docs/sub']);
    h.panel.refresh();
    expect(rows(h)).toContain('docs/sub/x.md');
  });

  it('creates at the vault root with nothing focused', (): void => {
    const h = mount();
    tool(h, 'New note').click();
    tool(h, 'New note from template').click();
    expect(h.actions).toEqual(['newNote ', 'newFromTemplate ']);
  });

  it('keeps the rows while the same vault is rescanned, then keeps expansion and selection', (): void => {
    const h = mount();
    click(h, 'docs');
    click(h, 'a.md');
    h.state.scanning = true;
    h.state.notes = [];
    h.panel.refresh();
    expect(rows(h)).toContain('docs/guide.md');
    h.state.scanning = false;
    h.state.notes = NOTES;
    h.panel.refresh();
    expect(rows(h)).toContain('docs/guide.md');
    expect(selected(h)).toEqual(['a.md']);
  });

  it('starts a different vault collapsed with nothing selected', (): void => {
    const h = mount();
    click(h, 'docs');
    click(h, 'a.md');
    h.state.root = '/w';
    h.panel.refresh();
    expect(rows(h)).toEqual(['docs', 'empty', 'a.md']);
    expect(selected(h)).toEqual([]);
  });

  it('keeps its element across a refresh and empties it on destroy', (): void => {
    const h = mount();
    const element = h.panel.element;
    h.panel.refresh();
    expect(h.panel.element).toBe(element);
    h.panel.destroy();
    expect(element.children.length).toBe(0);
  });

  it('focuses the first row when asked', (): void => {
    const h = mount();
    h.panel.focus();
    expect(document.activeElement).toBe(row(h, 'docs'));
  });

  it('exports a stylesheet for its own classes in theme tokens', (): void => {
    expect(FILES_PANEL_STYLES).toContain('.kdoc-tree-row');
    expect(FILES_PANEL_STYLES).toContain('.kdoc-files-tool');
    expect(FILES_PANEL_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
