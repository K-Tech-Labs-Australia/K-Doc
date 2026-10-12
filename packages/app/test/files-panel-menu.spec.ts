// @vitest-environment jsdom
/**
 * @file packages/app/test/files-panel-menu.spec.ts
 * @purpose Tests the vault file tree's context menu entries, drop-validation rules, detached-row rendering, and the two-answer confirm dialog (FR-6.11) without mounting any panel.
 * @inputs Vitest harness plus shared core builders and shell modules for menus, rows, popups, actions, and the confirm dialog.
 * @outputs No runtime output; failing assertions abort the run via expect().
 * @functions
 *   - node: Resolves a visible row's TreeNode by relative path from the flattened tree.
 *   - recorder: Returns FileTreeActions stubs plus a log of invoked action names.
 *   - items: Narrows PopupMenuEntry[] down to only actionable PopupMenuItem[].
 *   - viewOptions: Builds default FileTreeViewOptions with no-op callbacks and fixed state queries.
 * @dataflow buildFileTree + flattenVisible → ROWS → node()/dropFolderFor() per test; viewOptions → renderTreeRows → DOM assertions; treeMenuEntries(items) → label/enabled/hint/log assertions; installConfirmDialog().ask() → discard-button hidden-state assertions.
 * @controlflow Module load builds TREE and ROWS once; each test reads rows via node(), drives menu/drop/render functions, and asserts exact expected values; afterEach clears the DOM between tests.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildFileTree, flattenVisible, type TreeNode, type VisibleRow } from '@k-doc/core';
import type { FileTreeActions } from '../src/shell/file-tree-actions.js';
import { canDropInto, folderBaseName, treeMenuEntries } from '../src/shell/files-panel-menu.js';
import { dropFolderFor, renderTreeRows, type FileTreeViewOptions } from '../src/shell/file-tree-view.js';
import type { PopupMenuEntry, PopupMenuItem } from '../src/shell/popup-menu.js';
import { installConfirmDialog } from '../src/shell/confirm-dialog.js';

const TREE = buildFileTree(
  [
    { path: '/v/a.md', relative: 'a.md', title: 'A' },
    { path: '/v/docs/guide.md', relative: 'docs/guide.md', title: '' },
  ],
  ['docs', 'docs/sub', 'empty'],
);
const ROWS: readonly VisibleRow[] = flattenVisible(TREE, new Set(['docs'])); // docs, docs/sub, docs/guide.md, empty, a.md
afterEach((): void => { document.body.replaceChildren(); });

/** @purpose Resolves a visible row's TreeNode by relative path, throwing when absent so a stale selector fails loudly rather than silently. @inputs relative - The node's relative path to look up in ROWS. @outputs TreeNode - The matching flattened-tree node. */
function node(relative: string): TreeNode {
  // Locate the visible row whose relative path matches the requested selector.
  const found = ROWS.find((r) => r.node.relative === relative);
  // A missing match indicates a stale test selector; fail loudly rather than return undefined downstream.
  if (found === undefined) {
    throw new Error(relative);
  } else {
    return found.node;
  }
}

/** @purpose Captures FileTreeActions invocations into an ordered string log for exact-sequence assertions without real side effects. @inputs void. @outputs { actions: FileTreeActions; log: string[] } - Stub action bindings plus the appended invocation strings. */
function recorder(): { actions: FileTreeActions; log: string[] } {
  const log: string[] = [];
  const names = (list: readonly TreeNode[]): string => list.map((n) => n.relative).join(',');
  const rec = (s: string): Promise<void> => { log.push(s); return Promise.resolve(); };
  return {
    log,
    actions: {
      newNote: (f) => rec(`newNote ${f}`),
      newFolder: (f) => rec(`newFolder ${f}`),
      newFromTemplate: (f) => rec(`newFromTemplate ${f}`),
      rename: (n) => rec(`rename ${n.relative}`),
      trash: (l) => rec(`trash ${names(l)}`),
      move: (l, f) => rec(`move ${names(l)} -> ${f}`),
      reveal: (n) => { log.push(`reveal ${n.relative}`); },
    },
  };
}

/** @purpose Narrows a mixed PopupMenuEntry[] list down to only actionable items by excluding separator markers. @inputs entries - The raw menu entry list which may contain separators. @outputs PopupMenuItem[] - Only runnable item entries, in original order. */
function items(entries: readonly PopupMenuEntry[]): PopupMenuItem[] {
  return entries.filter((e): e is PopupMenuItem => !('separator' in e));
}

/** @purpose Supplies default FileTreeViewOptions with no-op callbacks and fixed state queries, overridable per test via a partial override object. @inputs overrides - Partial<FileTreeViewOptions> merged on top of the defaults. @outputs FileTreeViewOptions - A complete options object for renderTreeRows. */
function viewOptions(overrides: Partial<FileTreeViewOptions>): FileTreeViewOptions {
  return {
    doc: document,
    signal: new AbortController().signal,
    isExpanded: (r) => r === 'docs',
    isSelected: (r) => r === 'a.md',
    focusRelative: null,
    onRowClick: () => undefined,
    onToggle: () => undefined,
    onContextMenu: () => undefined,
    onDragStart: () => undefined,
    onDragEnd: () => undefined,
    canDropOn: () => false,
    onDrop: () => undefined,
    ...overrides,
  };
}

describe('the tree menu', (): void => {
  it('offers creation and the row\'s actions for one selected note', (): void => {
    const { actions, log } = recorder();
    const entries = treeMenuEntries({ folder: 'docs', chosen: [node('docs/guide.md')], onRow: true, actions });
    expect(items(entries).map((e) => [e.label, e.hint, e.enabled])).toEqual([['New Note', '', true], ['New Folder', '', true], ['New Note from Template…', '', true], ['Rename…', 'F2', true], ['Delete', 'Del', true], ['Reveal in File Explorer', '', true]]);
    expect(entries.filter((e) => 'separator' in e).length).toBe(2);
    for (const item of items(entries)) { item.run(); }
    expect(log).toEqual(['newNote docs', 'newFolder docs', 'newFromTemplate docs', 'rename docs/guide.md', 'trash docs/guide.md', 'reveal docs/guide.md']);
  });

  it('disables rename and reveal for several items and counts the delete', (): void => {
    const { actions, log } = recorder();
    const entries = items(treeMenuEntries({ folder: '', chosen: [node('a.md'), node('empty')], onRow: true, actions }));
    expect(entries.map((e) => [e.label, e.enabled])).toEqual([['New Note', true], ['New Folder', true], ['New Note from Template…', true], ['Rename…', false], ['Delete 2 Items', true], ['Reveal in File Explorer', false]]);
    entries[3]?.run();
    entries[5]?.run();
    expect(log).toEqual([]);
  });

  it('offers only creation on the empty area', (): void => {
    const { actions } = recorder();
    expect(items(treeMenuEntries({ folder: '', chosen: [], onRow: false, actions })).map((e) => e.label)).toEqual(['New Note', 'New Folder', 'New Note from Template…']);
  });
});

describe('drop rules', (): void => {
  it('decides what may be dropped where', (): void => {
    expect(canDropInto([node('docs/guide.md')], 'docs')).toBe(false);
    expect(canDropInto([node('docs/guide.md')], '')).toBe(true);
    expect(canDropInto([node('docs')], 'docs/sub')).toBe(false);
    expect(canDropInto([node('docs')], 'empty')).toBe(true);
    expect(canDropInto([], '')).toBe(false);
  });

  it('drops onto a folder row itself, or the folder a note is in', (): void => {
    expect(ROWS.map(dropFolderFor)).toEqual(['docs', 'docs/sub', 'docs', 'empty', '']);
  });

  it('names a vault by its folder', (): void => {
    expect(folderBaseName('C:\\notes\\vault\\')).toBe('vault');
    expect(folderBaseName('/v')).toBe('v');
  });
});

describe('tree rows', (): void => {
  it('describes rows for assistive technology', (): void => {
    const rows = renderTreeRows(ROWS, viewOptions({}));
    expect(rows.map((r) => [r.getAttribute('role'), r.getAttribute('aria-level'), r.getAttribute('aria-selected'), r.getAttribute('aria-expanded'), r.tabIndex, r.style.getPropertyValue('--kdoc-tree-depth')])).toEqual([['treeitem', '1', 'false', 'true', 0, '0'], ['treeitem', '2', 'false', 'false', -1, '1'], ['treeitem', '2', 'false', null, -1, '1'], ['treeitem', '1', 'false', 'false', -1, '0'], ['treeitem', '1', 'true', null, -1, '0']]);
  });

  it('mark folders open or closed and name notes by title and path', (): void => {
    const rows = renderTreeRows(ROWS, viewOptions({}));
    expect(rows.map((r) => r.querySelector('.kdoc-tree-twisty')?.textContent)).toEqual(['▾', '▸', '', '▸', '']);
    expect(rows[2]?.title).toBe('docs/guide.md');
    expect(rows[4]?.title).toBe('A — a.md');
  });

  it('give Tab focus to the focused row', (): void => {
    const rows = renderTreeRows(ROWS, viewOptions({ focusRelative: 'empty' }));
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it('toggle a folder from its twisty without clicking the row', (): void => {
    const toggled: string[] = [];
    const clicked: string[] = [];
    const rows = renderTreeRows(ROWS, viewOptions({ onToggle: (r) => { toggled.push(r); }, onRowClick: (r) => { clicked.push(r.node.relative); } }));
    rows[0]?.querySelector<HTMLElement>('.kdoc-tree-twisty')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggled).toEqual(['docs']);
    expect(clicked).toEqual([]);
  });

  it('accept a drop only where allowed and highlight the target', (): void => {
    const dropped: string[] = [];
    const rows = renderTreeRows(ROWS, viewOptions({ canDropOn: (f) => f === 'empty', onDrop: (f) => { dropped.push(f); } }));
    // A missing row reference is a test bug; fail loudly rather than dispatch on undefined.
    const over = (el: HTMLElement | undefined, type: string): boolean => {
      if (el === undefined) {
        throw new Error('row');
      } else {
        const e = new MouseEvent(type, { bubbles: true, cancelable: true });
        return el.dispatchEvent(e);
      }
    };
    expect(over(rows[3], 'dragover')).toBe(false);
    expect(rows[3]?.classList.contains('kdoc-tree-drop')).toBe(true);
    over(rows[3], 'dragleave');
    expect(rows[3]?.classList.contains('kdoc-tree-drop')).toBe(false);
    expect(over(rows[4], 'dragover')).toBe(true);
    over(rows[4], 'drop');
    over(rows[3], 'drop');
    expect(dropped).toEqual(['empty']);
  });

  it('stop listening once their signal aborts', (): void => {
    const controller = new AbortController();
    const clicked: string[] = [];
    const rows = renderTreeRows(ROWS, viewOptions({ signal: controller.signal, onRowClick: (r) => { clicked.push(r.node.relative); } }));
    controller.abort();
    rows[4]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toEqual([]);
  });
});

describe('the two-answer confirm dialog', (): void => {
  it('hides the middle button only for the question that asked', (): void => {
    const dialog = installConfirmDialog({ doc: document });
    // Locate the discard (middle) button whose hidden state encodes whether the question offered it.
    const discard = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.kdoc-dialog-button-discard');
    void dialog.ask('Move it?', { heading: 'Delete', confirm: 'Move', discard: null, cancel: 'Cancel' });
    expect(discard()?.hidden).toBe(true);
    void dialog.ask('Save?');
    expect(discard()?.hidden).toBe(false);
    dialog.destroy();
  });
});
