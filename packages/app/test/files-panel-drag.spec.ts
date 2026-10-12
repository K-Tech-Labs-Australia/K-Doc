// @vitest-environment jsdom
/**
 * @file files-panel-drag.spec.ts
 * @purpose Tests the files panel's right-click menus and drag-and-drop move behavior (FR-6.11).
 * @inputs Mounted FilesPanel harness with mocked actions, note/folder accessors, and a captured showMenu callback.
 * @outputs Assertions over the action log and captured menus covering selection-on-contextmenu, menu entries, drop moves, and folder expansion.
 * @functions
 *   - mount: Installs a panel with logging actions and menu capture into document.body.
 *   - row: Finds the rendered tree row by relative path.
 *   - body: Finds the kdoc-files-body element.
 *   - fire: Dispatches a cancelable mouse/drag event without dataTransfer.
 *   - click: Dispatches a click on a row.
 *   - labels: Extracts non-separator entry labels from a menu.
 * @dataflow mount → panel events (contextmenu, dragstart, drop) → actions.log / menus capture → expect assertions.
 * @controlflow For each test: mount harness → dispatch event(s) → assert log or menu state.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { TreeNode, TreeNote } from '@k-doc/core';
import { installFilesPanel, type FilesPanel } from '../src/shell/files-panel.js';
import type { FileTreeActions } from '../src/shell/file-tree-actions.js';
import type { PopupMenuEntry, PopupMenuItem } from '../src/shell/popup-menu.js';

const NOTES: readonly TreeNote[] = [ { path: '/v/a.md', relative: 'a.md', title: 'A' }, { path: '/v/docs/guide.md', relative: 'docs/guide.md', title: '' } ];
const FOLDERS: readonly string[] = ['docs', 'docs/sub', 'empty'];
const panels: FilesPanel[] = [];
afterEach((): void => { for (const p of panels) { p.destroy(); } panels.length = 0; document.body.replaceChildren(); });

interface Harness { panel: FilesPanel; log: string[]; menus: { x: number; y: number; entries: readonly PopupMenuEntry[] }[]; }

/**
 * @purpose Installs a files panel with logging actions and menu capture into document.body.
 * @inputs none - Builds a mock FileTreeActions that records calls, and a showMenu handler that captures menus.
 * @outputs Harness - The mounted panel plus its log array and captured menus.
 * @dataflow options accessors → installFilesPanel → mounted element appended to body; actions push to log; showMenu pushes to menus.
 * @controlflow Create log/menus arrays → build mock actions → install panel → append element → return harness.
 */
function mount(): Harness {
  const log: string[] = [];
  const menus: Harness['menus'] = [];
  const names = (list: readonly TreeNode[]): string => list.map((n) => n.relative).join(',');
  const rec = (s: string): Promise<void> => { log.push(s); return Promise.resolve(); };
  const actions: FileTreeActions = { newNote: (f) => rec(`newNote ${f}`), newFolder: (f) => rec(`newFolder ${f}`), newFromTemplate: (f) => rec(`newFromTemplate ${f}`), rename: (n) => rec(`rename ${n.relative}`), trash: (l) => rec(`trash ${names(l)}`), move: (l, f) => rec(`move ${names(l)} -> ${f}`), reveal: (n) => { log.push(`reveal ${n.relative}`); } };
  const panel = installFilesPanel({ doc: document, notes: () => NOTES, folders: () => FOLDERS, root: () => '/v', scanning: () => false, canOpen: () => true, openVault: () => undefined, openNote: () => undefined, actions, showMenu: (x, y, entries) => { menus.push({ x, y, entries }); } });
  document.body.append(panel.element); panels.push(panel);
  return { panel, log, menus };
}

/**
 * @purpose Locates the rendered tree row whose data-relative matches the given relative path.
 * @inputs h - The test harness providing the mounted panel.
 * @inputs relative - The relative path identifying the target row.
 * @outputs HTMLElement - The matching row element.
 * @dataflow panel.element → querySelectorAll('.kdoc-tree-row') → filter by dataset.relative.
 * @controlflow Find matching row; throw when absent.
 */
function row(h: Harness, relative: string): HTMLElement { const found = [...h.panel.element.querySelectorAll<HTMLElement>('.kdoc-tree-row')].find((r) => r.dataset['relative'] === relative); if (found === undefined) { throw new Error(`no row ${relative}`); } else { return found; } }

/**
 * @purpose Locates the panel body container used for empty-area interactions.
 * @inputs h - The test harness providing the mounted panel.
 * @outputs HTMLElement - The .kdoc-files-body element.
 * @dataflow panel.element → querySelector('.kdoc-files-body').
 * @controlflow Find body; throw when absent.
 */
function body(h: Harness): HTMLElement { const found = h.panel.element.querySelector<HTMLElement>('.kdoc-files-body'); if (found === null) { throw new Error('no body'); } else { return found; } }

/**
 * @purpose Dispatches a cancelable mouse/drag event with no dataTransfer (jsdom lacks DragEvent).
 * @inputs target - The element to dispatch the event on.
 * @inputs type - The event name (e.g. 'contextmenu', 'dragover', 'drop').
 * @inputs init - Optional MouseEventInit such as clientX/clientY or modifier keys.
 * @outputs boolean - False when a handler called preventDefault, else true.
 * @dataflow new MouseEvent(type, init) → attach null dataTransfer → dispatchEvent on target.
 * @controlflow Build event with bubbles and cancelable; return dispatch result.
 */
function fire(target: Element, type: string, init: MouseEventInit = {}): boolean { const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }); Object.defineProperty(event, 'dataTransfer', { value: null }); return target.dispatchEvent(event); }

/**
 * @purpose Dispatches a bubbling click on the given row.
 * @inputs h - The test harness providing the mounted panel.
 * @inputs relative - The relative path of the row to click.
 * @inputs init - Optional MouseEventInit such as ctrlKey.
 * @outputs void
 * @dataflow row(h, relative) → dispatch new MouseEvent('click', init).
 * @controlflow Resolve row then dispatch the click event.
 */
function click(h: Harness, relative: string, init: MouseEventInit = {}): void { row(h, relative).dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })); }

/**
 * @purpose Extracts the visible labels of non-separator menu entries.
 * @inputs entries - The popup menu entries captured for a menu.
 * @outputs string[] - The label of each actionable (non-separator) entry, in order.
 * @dataflow entries → filter out separators → map to label.
 * @controlflow Drop separator entries then collect labels.
 */
function labels(entries: readonly PopupMenuEntry[]): string[] { return entries.filter((e): e is PopupMenuItem => !('separator' in e)).map((e) => e.label); }

describe('the tree panel menus', (): void => {
  // Right-clicking an unselected row selects it and opens the menu at the cursor.
  it('selects an unselected row and anchors its menu', (): void => {
    const h = mount();
    fire(row(h, 'a.md'), 'contextmenu', { clientX: 10, clientY: 20 });
    expect(row(h, 'a.md').getAttribute('aria-selected')).toBe('true');
    expect(h.menus.map((m) => [m.x, m.y, labels(m.entries).length])).toEqual([[10, 20, 6]]);
  });

  // Right-clicking inside an existing selection keeps the whole selection.
  it('keeps the selection when right-clicking within it', (): void => {
    const h = mount();
    click(h, 'a.md');
    click(h, 'empty', { ctrlKey: true });
    fire(row(h, 'a.md'), 'contextmenu');
    expect(labels(h.menus[0]?.entries ?? [])).toContain('Delete 2 Items');
  });

  // Right-clicking the empty area offers root-level creation actions.
  it('offers root creation on empty-area right-click', (): void => {
    const h = mount();
    fire(body(h), 'contextmenu');
    const entries = h.menus[0]?.entries ?? [];
    expect(labels(entries)).toEqual(['New Note', 'New Folder', 'New Note from Template…']);
    const first = entries[0];
    if (first !== undefined && !('separator' in first)) { first.run(); } else { throw new Error('no entry'); }
    expect(h.log).toEqual(['newNote ']);
  });
});

describe('dragging in the tree', (): void => {
  // Dropping a dragged note onto a folder moves it there.
  it('moves a dragged note onto a folder', (): void => {
    const h = mount();
    fire(row(h, 'a.md'), 'dragstart');
    expect(fire(row(h, 'docs'), 'dragover')).toBe(false);
    expect(fire(row(h, 'a.md'), 'dragover')).toBe(true);
    fire(row(h, 'docs'), 'drop');
    expect(h.log).toEqual(['move a.md -> docs']);
  });

  // A folder cannot be dropped into its own subfolder.
  it('refuses to drop a folder into its own subfolder', (): void => {
    const h = mount();
    click(h, 'docs');
    fire(row(h, 'docs'), 'dragstart');
    expect(fire(row(h, 'docs/sub'), 'dragover')).toBe(true);
    fire(row(h, 'docs/sub'), 'drop');
    expect(h.log).toEqual([]);
  });

  // Dragging any selected row moves the whole selection.
  it('drags the whole selection from any selected row', (): void => {
    const h = mount();
    click(h, 'a.md');
    click(h, 'empty', { ctrlKey: true });
    fire(row(h, 'a.md'), 'dragstart');
    fire(row(h, 'docs'), 'drop');
    expect(h.log).toEqual(['move empty,a.md -> docs']);
  });

  // Dragging an unselected row moves only that row.
  it('drags only an unselected row that is dragged', (): void => {
    const h = mount();
    click(h, 'empty');
    fire(row(h, 'a.md'), 'dragstart');
    fire(row(h, 'docs'), 'drop');
    expect(h.log).toEqual(['move a.md -> docs']);
  });

  // Dropping onto the empty area moves to the vault root.
  it('moves to the vault root when dropped on empty area', (): void => {
    const h = mount();
    click(h, 'docs');
    fire(row(h, 'docs/guide.md'), 'dragstart');
    expect(fire(body(h), 'dragover')).toBe(false);
    fire(body(h), 'drop');
    expect(h.log).toEqual(['move docs/guide.md -> ']);
  });

  // A note already at the vault root cannot be dropped on the empty area.
  it('refuses a drop on the empty area that would change nothing', (): void => {
    const h = mount();
    fire(row(h, 'a.md'), 'dragstart');
    expect(fire(body(h), 'dragover')).toBe(true);
  });

  // Ending a drag without a drop forgets the dragged rows.
  it('forgets the drag when it ends without a drop', (): void => {
    const h = mount();
    fire(row(h, 'a.md'), 'dragstart');
    fire(row(h, 'a.md'), 'dragend');
    expect(fire(row(h, 'docs'), 'dragover')).toBe(true);
  });

  // Dropping onto a folder opens that folder after the move.
  it('opens the folder a drag was dropped into', (): void => {
    const h = mount();
    fire(row(h, 'a.md'), 'dragstart');
    fire(row(h, 'empty'), 'drop');
    h.panel.refresh();
    expect(row(h, 'empty').getAttribute('aria-expanded')).toBe('true');
  });
});
