/**
 * @file packages/app/src/shell/file-tree-view.ts
 * @purpose Renders the vault file tree's rows (FR-6.11) as detached DOM elements with no internal state.
 * @inputs rows - ordered VisibleRow list; options - panel-supplied callbacks and state queries (isExpanded, isSelected, focusRelative, drop handlers).
 * @outputs HTMLElement[] - one rendered row element per input row; FILE_TREE_STYLES CSS string consumed by the panel to inject a <style> element.
 * @functions
 *   - dropFolderFor: Maps a visible row to the folder-relative path its node drops into.
 *   - renderTreeRows: Builds every row element, marking one for Tab focus.
 *   - renderRow: Builds a single interactive tree-row element (not exported).
 * @dataflow options + rows → per-node attributes, twisty, name span, and event listeners → detached elements; FILE_TREE_STYLES string flows to the panel's stylesheet injection.
 * @controlflow renderTreeRows computes the focus target then maps each row via renderRow; renderRow branches on node.kind for the twisty (folder expands/collapses, file shows a tooltip) before wiring events with the shared AbortSignal.
 * @version 3
 * @date 2026-10-04
 */

import { parentRelative, type VisibleRow } from '@k-doc/core';

export interface FileTreeViewOptions {
  readonly doc: Document;
  readonly signal: AbortSignal;
  readonly isExpanded: (relative: string) => boolean;
  readonly isSelected: (relative: string) => boolean;
  /** The row that takes Tab focus, or null for the first row. */
  readonly focusRelative: string | null;
  readonly onRowClick: (row: VisibleRow, event: MouseEvent) => void;
  readonly onToggle: (folderRelative: string) => void;
  readonly onContextMenu: (row: VisibleRow, event: MouseEvent) => void;
  readonly onDragStart: (row: VisibleRow, event: DragEvent) => void;
  readonly onDragEnd: () => void;
  /** Whether what is being dragged may be dropped into this folder ('' is the vault root). */
  readonly canDropOn: (folderRelative: string) => boolean;
  readonly onDrop: (folderRelative: string) => void;
}

export const DROP_TARGET_CLASS: string = 'kdoc-tree-drop';

/**
 * Maps a visible row to the folder-relative path its node drops into.
 * @purpose Determines the drop target folder for a given tree row.
 * @inputs row - The visible row whose node determines the drop target.
 * @outputs string - For a folder row, its own relative path; for a file row, its parent's relative path ('' is the vault root).
 * @dataflow row.node.kind and row.node.relative → parentRelative() (files only) → returned folder-relative string.
 * @controlflow Branches on node.kind: folders return themselves; files delegate to parentRelative(); no early returns beyond the two branches.
 */
export function dropFolderFor(row: VisibleRow): string {
  // A folder row drops into itself; a file row drops into the folder that holds it.
  if (row.node.kind === 'folder') {
    return row.node.relative;
  } else {
    return parentRelative(row.node.relative);
  }
}

/**
 * Renders every visible tree row into detached DOM elements, marking one for Tab focus.
 * @purpose Builds the full set of row elements from the panel's visible rows.
 * @inputs rows - The ordered list of visible rows to render. options - Callbacks and state queries supplied by the panel.
 * @outputs HTMLElement[] - One detached element per input row, in order.
 * @dataflow rows → map over each row → renderRow() per row → array of elements returned to the caller.
 * @controlflow Compute the focus target (focusRelative, else the first row's relative path, else null); map each row to a rendered row with focusable = (row matches focus).
 */
export function renderTreeRows(rows: readonly VisibleRow[], options: FileTreeViewOptions): HTMLElement[] {
  // Focus the requested row when present; otherwise fall back to the first visible row; otherwise no focus.
  const focus = options.focusRelative ?? rows[0]?.node.relative ?? null;
  return rows.map((row) => renderRow(row, row.node.relative === focus, options));
}

/**
 * Builds a single interactive tree-row element for one visible node.
 * @purpose Constructs and wires up one <div role="treeitem"> for a node.
 * @inputs row - The visible row (node + depth) to render. focusable - Whether this row receives Tab focus. options - Callbacks and state queries supplied by the panel.
 * @outputs HTMLElement - A detached element wired to all row events, ready for insertion into the tree container.
 * @dataflow row.node + options callbacks → element attributes, twisty span, name span, and event listeners → returned element.
 * @controlflow Create element and set identity/role/selection; branch on node.kind for the twisty (folder expands/collapses with a click handler, file shows a tooltip); attach click/contextmenu/drag listeners bound to the shared signal.
 */
function renderRow(row: VisibleRow, focusable: boolean, options: FileTreeViewOptions): HTMLElement {
  const { doc, signal } = options;
  const node = row.node;

  const element = doc.createElement('div');
  element.className = 'kdoc-tree-row';
  element.setAttribute('role', 'treeitem');
  element.setAttribute('aria-level', String(row.depth + 1));

  // A row is selected when the panel reports its relative path as currently selected.
  if (options.isSelected(node.relative)) {
    element.setAttribute('aria-selected', 'true');
  } else {
    element.setAttribute('aria-selected', 'false');
  }

  element.dataset.relative = node.relative;
  element.dataset.kind = node.kind;

  // Focusable rows enter the Tab order (index 0); non-focusable rows are skipped (-1).
  if (focusable) {
    element.tabIndex = 0;
  } else {
    element.tabIndex = -1;
  }

  element.draggable = true;

  // Indentation is a length, not a colour, so it is exposed as a custom property the stylesheet multiplies.
  element.style.setProperty('--kdoc-tree-depth', String(row.depth));

  const twisty = doc.createElement('span');
  twisty.className = 'kdoc-tree-twisty';
  twisty.setAttribute('aria-hidden', 'true');

  if (node.kind === 'folder') {
    // An expanded folder exposes its children; a collapsed one hides them.
    const expanded = options.isExpanded(node.relative);
    if (expanded) {
      element.setAttribute('aria-expanded', 'true');
      twisty.textContent = '▾';
    } else {
      element.setAttribute('aria-expanded', 'false');
      twisty.textContent = '▸';
    }

    // Clicking the twisty toggles this folder without activating the row.
    twisty.addEventListener('click', (event: MouseEvent): void => {
      event.stopPropagation();
      options.onToggle(node.relative);
    }, { signal });
  } else {
    // A file has no children; the empty twisty keeps file names aligned with folder names.

    // A file with no display name shows only its relative path; otherwise show "title — relative".
    if (node.title === '') {
      element.title = node.relative;
    } else {
      element.title = `${node.title} — ${node.relative}`;
    }
  }

  const name = doc.createElement('span');
  name.className = 'kdoc-tree-name';
  name.textContent = node.name;

  element.append(twisty, name);

  // Selecting the row (any part of it) reports back to the panel.
  element.addEventListener('click', (event: MouseEvent): void => {
    options.onRowClick(row, event);
  }, { signal });

  // A context menu request is prevented from default browser behaviour and forwarded to the panel.
  element.addEventListener('contextmenu', (event: MouseEvent): void => {
    event.preventDefault();
    options.onContextMenu(row, event);
  }, { signal });

  element.addEventListener('dragstart', (event: DragEvent): void => {
    options.onDragStart(row, event);
  }, { signal });

  element.addEventListener('dragend', (): void => {
    options.onDragEnd();
  }, { signal });

  element.addEventListener('dragover', (event: DragEvent): void => {
    const target = dropFolderFor(row);
    // A row is only a valid drop target when the panel permits dropping into its folder.
    if (options.canDropOn(target)) {
      event.preventDefault();
      event.stopPropagation();
      element.classList.add(DROP_TARGET_CLASS);
    } else {
      // Not a valid target: leave the browser's default no-drop cursor in place.
    }
  }, { signal });

  element.addEventListener('dragleave', (): void => {
    element.classList.remove(DROP_TARGET_CLASS);
  }, { signal });

  element.addEventListener('drop', (event: DragEvent): void => {
    element.classList.remove(DROP_TARGET_CLASS);
    const target = dropFolderFor(row);
    // Only forward the drop when the panel permits dropping into this folder.
    if (options.canDropOn(target)) {
      event.preventDefault();
      event.stopPropagation();
      options.onDrop(target);
    } else {
      // Not a valid target: ignore the drop entirely.
    }
  }, { signal });

  return element;
}

export const FILE_TREE_STYLES: string = `
.kdoc-tree {
  display: flex;
  flex-direction: column;
  padding: 4px;
  outline: none;
}

.kdoc-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px calc(8px + var(--kdoc-tree-depth, 0) * 14px);
  margin: 1px 0;
  border-radius: var(--kdoc-radius-md);
  font-size: 13px;
  line-height: 1.4;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background 120ms ease, box-shadow 120ms ease, color 120ms ease;
}

.kdoc-tree-row:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-tree-row[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-tree-row:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-tree-row.kdoc-tree-drop {
  outline: 2px dashed var(--kdoc-chrome-accent);
  outline-offset: -2px;
  background: var(--kdoc-chrome-raised);
}

.kdoc-tree-twisty {
  flex: none;
  width: 12px;
  text-align: center;
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  user-select: none;
}

.kdoc-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.kdoc-tree-row[data-kind="folder"] .kdoc-tree-name {
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-tree-row {
    transition: none;
  }
}
`;
