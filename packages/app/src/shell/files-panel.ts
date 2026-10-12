/**
 * @file files-panel.ts
 * @purpose Implements FilesPanel, the vault file tree (FR-6.11) rendered in the sidebar's Files panel, showing notes and folders as an expandable/collapsible tree with selection, drag-move, keyboard commands, and context menus.
 * @inputs FilesPanelOptions containing Document context, note/folder accessors, vault root accessor, scanning state, open handlers, FileTreeActions, and a showMenu callback for row and empty-area context menus.
 * @outputs FilesPanel controller exposing mounted element, refresh, focus, and destroy lifecycle methods, alongside FILES_PANEL_STYLES CSS stylesheet re-exported from the menu module.
 * @functions
 *   - installFilesPanel: Instantiates and mounts the files panel hierarchy, wires listeners with AbortController, performs initial refresh, and returns the FilesPanel controller.
 *   - makeTool: Builds a toolbar button with label, text, title, and aria-label attributes.
 *   - emptyLine: Builds an empty-state readout div.
 *   - nodeList: Maps relative paths to their indexed TreeNode entries.
 *   - selectedNodes: Returns the selection in order as resolved TreeNodes.
 *   - focusedNode: Resolves the currently focused node by relative path.
 *   - targetFolder: Derives the destination folder for a new item from the focused node.
 *   - draw: Flattens visible rows and re-renders the tree with fresh row elements.
 *   - focusRowElement: Moves DOM focus to the row matching the selection focus.
 *   - redraw: Draws the tree then restores focus onto the focused row.
 *   - toggle: Expands or collapses a folder by relative path and redraws.
 *   - onRowClick: Applies click mode, opens or toggles the clicked node, and redraws.
 *   - openMenu: Shows the row or empty-area context menu with computed entries.
 *   - rowMenu: Replaces selection for an unselected row then shows its context menu.
 *   - onDragStart: Selects the dragged rows and seeds the drag payload.
 *   - dropInto: Applies the pending move into a target folder.
 *   - runKey: Dispatches a tree key command to the matching state transition.
 *   - indexNodes: Recursively indexes every node by relative path.
 *   - refresh: Rebuilds panel state from current accessors, resetting on vault change.
 *   - isEmptyArea: Reports whether an event target is empty body or tree space.
 *   - focus: Moves DOM focus to the first row or toolbar button.
 *   - destroy: Idempotently tears down listeners and clears DOM children.
 * @dataflow FilesPanelOptions accessors -> buildFileTree -> flattenVisible(tree, expanded) -> renderTreeRows -> replaceChildren on kdoc-tree; selection/expanded state drives which rows render and respond to interaction.
 * @controlflow Initialize container and stable tree DOM -> attach listener signals -> perform initial refresh -> return FilesPanel controller.
 * @version 2
 * @date 2026-09-14
 */

import { buildFileTree, flattenVisible, parentRelative, topLevelOnly, type TreeNode, type TreeNote, type VisibleRow } from '@k-doc/core';
import type { PopupMenuEntry } from './popup-menu.js';
import { clickRow, EMPTY_SELECTION, focusRow, moveFocus, pruneSelection, selectionInOrder, type ClickMode, type SelectionState } from './file-tree-selection.js';
import { treeKeyCommand } from './file-tree-keys.js';
import { renderTreeRows } from './file-tree-view.js';
import type { FileTreeActions } from './file-tree-actions.js';
import { canDropInto, folderBaseName, treeMenuEntries } from './files-panel-menu.js';
export { FILES_PANEL_STYLES } from './files-panel-menu.js';

export interface FilesPanelOptions {
  readonly doc: Document;
  readonly notes: () => readonly TreeNote[];
  readonly folders: () => readonly string[];
  readonly root: () => string | null;
  readonly scanning: () => boolean;
  readonly canOpen: () => boolean;
  readonly openVault: () => void;
  readonly openNote: (path: string) => void;
  readonly actions: FileTreeActions;
  readonly showMenu: (x: number, y: number, entries: readonly PopupMenuEntry[]) => void;
}

export interface FilesPanel { readonly element: HTMLElement; refresh(): void; focus(): void; destroy(): void; }

/**
 * Installs the vault file tree panel into an owned DOM hierarchy.
 * @purpose Creates the panel element and stable tree DOM, wires listeners with AbortController, performs initial refresh, and returns the FilesPanel controller.
 * @inputs options - FilesPanelOptions providing Document context, accessors for notes/folders/root/scanning, actions, and showMenu handler.
 * @outputs FilesPanel - Controller interface exposing mounted element, refresh, focus, and destroy methods.
 * @dataflow options accessors -> buildFileTree -> flattenVisible -> renderTreeRows -> replaceChildren on kdoc-tree.
 * @controlflow Create root and stable tree elements -> bind listener signals -> perform initial refresh -> return FilesPanel controller interface.
 */
export function installFilesPanel(options: FilesPanelOptions): FilesPanel {
  const doc = options.doc;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let destroyed = false;
  let rowsAbort: AbortController | null = null;
  let tree: readonly TreeNode[] = [];
  let relatives: readonly string[] = [];
  const nodes = new Map<string, TreeNode>();
  let expanded = new Set<string>();
  let selection: SelectionState = EMPTY_SELECTION;
  let lastRoot: string | null = null;
  let dragged: readonly TreeNode[] = [];

  /**
   * Builds a toolbar button with label, text, title, and aria-label attributes.
   * @purpose Creates a reusable action button for the panel header.
   * @inputs label - Accessible name used for title and aria-label.
   * @inputs text - Visible button text glyph.
   * @outputs HTMLButtonElement - Configured toolbar button.
   * @dataflow label, text -> button attributes -> returned element.
   * @controlflow Create button -> set type, class, textContent, title, aria-label -> return.
   */
  function makeTool(label: string, text: string): HTMLButtonElement { const b = doc.createElement('button'); b.type = 'button'; b.className = 'kdoc-files-tool'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); return b; }

  /**
   * Builds an empty-state readout div.
   * @purpose Creates a styled placeholder for the panel body.
   * @inputs text - Readout string shown in place of tree content.
   * @outputs HTMLElement - Empty-state div.
   * @dataflow text -> div textContent -> returned element.
   * @controlflow Create div -> set class and textContent -> return.
   */
  function emptyLine(text: string): HTMLElement { const e = doc.createElement('div'); e.className = 'kdoc-files-empty'; e.textContent = text; return e; }

  const root = doc.createElement('div'); root.className = 'kdoc-files-panel';
  const header = doc.createElement('div'); header.className = 'kdoc-files-header';
  const rootLabel = doc.createElement('span'); rootLabel.className = 'kdoc-files-root';
  const newNoteButton = makeTool('New note', '+');
  const newFolderButton = makeTool('New folder', '▣+');
  const templateButton = makeTool('New note from template', '≡+');
  header.append(rootLabel, newNoteButton, newFolderButton, templateButton);
  const body = doc.createElement('div'); body.className = 'kdoc-files-body';
  const treeElement = doc.createElement('div'); treeElement.className = 'kdoc-tree'; treeElement.setAttribute('role', 'tree'); treeElement.setAttribute('aria-label', 'Vault files'); treeElement.setAttribute('aria-multiselectable', 'true');
  root.append(header, body);

  /**
   * Maps relative paths to their indexed TreeNode entries.
   * @purpose Resolves a list of node relative paths to the corresponding stored nodes.
   * @inputs list - Relative path strings to resolve.
   * @outputs TreeNode[] - The resolved nodes in input order, skipping missing entries.
   * @dataflow list -> Map lookup per entry -> filtered TreeNodes.
   * @controlflow Map each entry through nodes.get -> filter out undefined results.
   */
  function nodeList(list: readonly string[]): TreeNode[] { return list.map((r) => nodes.get(r)).filter((n): n is TreeNode => n !== undefined); }

  /**
   * Returns the selection in order as resolved TreeNodes.
   * @purpose Resolves the ordered selection relative paths to stored nodes.
   * @outputs TreeNode[] - The selected nodes in selection order.
   * @dataflow selection -> selectionInOrder -> nodeList resolution.
   * @controlflow Order selection relatives via selectionInOrder -> map through nodeList.
   */
  function selectedNodes(): TreeNode[] { return nodeList(selectionInOrder(selection, relatives)); }

  /**
   * Resolves the currently focused node by relative path.
   * @purpose Returns the node at the selection focus, or undefined when none is focused.
   * @outputs TreeNode | undefined - The focused node or undefined.
   * @dataflow selection.focus -> Map lookup -> resolved node.
   * @controlflow If focus is null return undefined; else resolve nodes.get(focus).
   */
  function focusedNode(): TreeNode | undefined { return selection.focus === null ? undefined : nodes.get(selection.focus); }

  /**
   * Derives the destination folder for a new item from the focused node.
   * @purpose Computes the target folder relative path under which a new note/folder lands.
   * @outputs string - The target folder relative path, or '' when nothing is focused.
   * @dataflow focusedNode -> relative (folder) or parentRelative (file) -> target folder.
   * @controlflow If no focus return ''; if focus is a folder use its relative; else use its parent's relative.
   */
  function targetFolder(): string { const focused = focusedNode(); if (focused === undefined) { return ''; } else if (focused.kind === 'folder') { return focused.relative; } else { return parentRelative(focused.relative); } }

  /**
   * Expands the destination folder before an action runs so the new item is visible once the tree redraws.
   * @purpose Adds the target folder to the expanded set prior to invoking the caller's action.
   * @inputs folder - The destination relative path, or '' for vault root.
   * @outputs void
   * @dataflow folder -> expanded.add when non-empty; nothing at root.
   * @controlflow If folder is non-empty add it; else do nothing since the root has no row to expand.
   */
  function expandThen(folder: string): void { if (folder !== '') { expanded.add(folder); } else { /* root: nothing to expand */ } }

  // Actions that expand the destination folder before running so new items are visible after redraw; rename, trash, move and reveal pass straight through.
  const panelActions: FileTreeActions = {
    newNote: (folder: string): Promise<void> => { expandThen(folder); return options.actions.newNote(folder); },
    newFolder: (folder: string): Promise<void> => { expandThen(folder); return options.actions.newFolder(folder); },
    newFromTemplate: (folder: string): Promise<void> => { expandThen(folder); return options.actions.newFromTemplate(folder); },
    rename: (node: TreeNode): Promise<void> => options.actions.rename(node),
    trash: (list: readonly TreeNode[]): Promise<void> => options.actions.trash(list),
    move: (list: readonly TreeNode[], folder: string): Promise<void> => options.actions.move(list, folder),
    reveal: (node: TreeNode): void => { options.actions.reveal(node); },
  };

  /**
   * Flattens visible rows and re-renders the tree with fresh row elements.
   * @purpose Recomputes visible rows, prunes stale selection, and replaces tree children with rendered rows.
   * @outputs void
   * @dataflow tree, expanded -> flattenVisible -> relatives -> pruneSelection -> renderTreeRows -> replaceChildren on kdoc-tree.
   * @controlflow Abort prior row render if any -> build fresh controller -> flatten/prune -> replace children; early return when destroyed.
   */
  function draw(): void {
    // Guard against rendering after teardown.
    if (destroyed) { return; } else { /* Panel already torn down: skip redraw. */ }
    const rows = flattenVisible(tree, expanded);
    relatives = rows.map((row) => row.node.relative);
    selection = pruneSelection(selection, relatives);
    // Cancel any in-flight render so stale rows cannot replace fresh ones.
    if (rowsAbort !== null) { rowsAbort.abort(); } else { /* No prior render to cancel. */ }
    const controller = new AbortController();
    rowsAbort = controller;
    treeElement.replaceChildren(...renderTreeRows(rows, {
      doc, signal: controller.signal,
      isExpanded: (r: string): boolean => expanded.has(r),
      isSelected: (r: string): boolean => selection.selected.has(r),
      focusRelative: selection.focus,
      onRowClick, onToggle: toggle, onContextMenu: rowMenu, onDragStart,
      onDragEnd: (): void => { dragged = []; },
      canDropOn: (folder: string): boolean => canDropInto(dragged, folder),
      onDrop: dropInto,
    }));
  }

  /**
   * Moves DOM focus to the row matching the selection focus.
   * @purpose Focuses the rendered row whose data-relative equals the selection focus.
   * @outputs void
   * @dataflow selection.focus -> match against child dataset.relative -> call focus().
   * @controlflow If focus is null return; else iterate children and focus the first matching element.
   */
  function focusRowElement(): void {
    const target = selection.focus;
    // Nothing focused: leave DOM focus untouched.
    if (target === null) { return; } else { /* A row is focused: locate and focus it below. */ }
    for (const child of treeElement.children) {
      // Match the rendered row whose data-relative equals the selection focus.
      if (child instanceof HTMLElement && child.dataset['relative'] === target) { child.focus(); return; } else { /* Not the focused row: keep scanning siblings. */ }
    }
  }

  /**
   * Draws the tree then restores focus onto the focused row.
   * @purpose Combines a full redraw with DOM focus restoration for the active selection.
   * @outputs void
   * @dataflow draw -> focusRowElement.
   * @controlflow Draw rows then move focus to the focused element.
   */
  function redraw(): void { draw(); focusRowElement(); }

  /**
   * Expands or collapses a folder by relative path and redraws.
   * @purpose Toggles the expanded state of a folder node.
   * @inputs relative - The folder's relative path to toggle.
   * @outputs void
   * @dataflow relative -> Set membership flip -> redraw.
   * @controlflow If already expanded remove it; else add it; then redraw.
   */
  function toggle(relative: string): void { if (expanded.has(relative)) { expanded.delete(relative); } else { expanded.add(relative); } redraw(); }

  /**
   * Applies click mode, opens or toggles the clicked node, and redraws.
   * @purpose Handles a row click by updating selection and either opening a note or toggling a folder.
   * @inputs row - The clicked visible row.
   * @inputs event - The originating mouse event driving click mode.
   * @outputs void
   * @dataflow event modifiers -> ClickMode -> clickRow -> openNote/toggle -> redraw.
   * @controlflow Select mode from keys -> update selection; if replace and folder toggle, else if replace and file open, else no-op; then redraw.
   */
  function onRowClick(row: VisibleRow, event: MouseEvent): void {
    let mode: ClickMode;
    // Shift selects a range; Ctrl/Meta toggles membership; plain click replaces.
    if (event.shiftKey) { mode = 'range'; } else if (event.ctrlKey || event.metaKey) { mode = 'toggle'; } else { mode = 'replace'; }
    selection = clickRow(selection, relatives, row.node.relative, mode);
    const node = row.node;
    // Non-replace clicks only extend the selection and open nothing.
    if (mode !== 'replace') { /* extending the selection opens nothing */ }
    else if (node.kind === 'folder') { toggle(node.relative); return; }
    else { options.openNote(node.path); }
    redraw();
  }

  /**
   * Shows the row or empty-area context menu with computed entries.
   * @purpose Invokes showMenu with tree menu entries for the current target folder and selection.
   * @inputs x - Client X coordinate for the menu anchor.
   * @inputs y - Client Y coordinate for the menu anchor.
   * @inputs onRow - Whether the menu originates from a row context action.
   * @outputs void
   * @dataflow targetFolder, selectedNodes, actions -> treeMenuEntries -> showMenu.
   * @controlflow Build entries then call options.showMenu with coordinates and entries.
   */
  function openMenu(x: number, y: number, onRow: boolean): void { options.showMenu(x, y, treeMenuEntries({ folder: targetFolder(), chosen: selectedNodes(), onRow, actions: panelActions })); }

  /**
   * Replaces selection for an unselected row then shows its context menu.
   * @purpose Ensures the right-clicked row is selected before opening its row menu.
   * @inputs row - The row under the context cursor.
   * @inputs event - The originating mouse event carrying coordinates.
   * @outputs void
   * @dataflow row.node.relative -> clickRow replace (if needed) -> draw -> openMenu at client coords.
   * @controlflow If not selected, replace selection and redraw; always open the menu.
   */
  function rowMenu(row: VisibleRow, event: MouseEvent): void {
    // Select the right-clicked row first so its menu acts on a clear target.
    if (!selection.selected.has(row.node.relative)) { selection = clickRow(selection, relatives, row.node.relative, 'replace'); draw(); } else { /* Row already selected: skip re-selection. */ }
    openMenu(event.clientX, event.clientY, true);
  }

  /**
   * Selects the dragged rows and seeds the drag payload.
   * @purpose On drag start, selects the target rows and writes a private transfer payload.
   * @inputs row - The row initiating the drag.
   * @inputs event - The originating drag event carrying dataTransfer.
   * @outputs void
   * @dataflow selection -> clickRow replace -> topLevelOnly -> dragged -> dataTransfer payload.
   * @controlflow If not selected, replace selection and redraw; set dragged to top-level selected nodes; write transfer data when available.
   */
  function onDragStart(row: VisibleRow, event: DragEvent): void {
    // Select the dragged rows first so the transfer carries a clear target set.
    if (!selection.selected.has(row.node.relative)) { selection = clickRow(selection, relatives, row.node.relative, 'replace'); draw(); } else { /* Row already selected: skip re-selection. */ }
    dragged = nodeList(topLevelOnly(selectionInOrder(selection, relatives)));
    // A private type, so dropping the drag onto the editor inserts nothing.
    if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-kdoc-tree', dragged.map((n) => n.relative).join('\n')); } else { /* No dataTransfer available: skip writing the payload. */ }
  }

  /**
   * Applies the pending move into a target folder.
   * @purpose Moves the previously dragged rows into the given folder, expanding it if non-empty.
   * @inputs folder - The destination folder relative path, or '' for vault root.
   * @outputs void
   * @dataflow dragged -> expanded.add(folder) when set -> actions.move -> clear dragged.
   * @controlflow Capture and clear dragged; expand target folder when set; invoke move action.
   */
  function dropInto(folder: string): void {
    const moving = dragged; dragged = [];
    // Expand the destination so the moved rows become visible after the move.
    if (folder !== '') { expanded.add(folder); } else { /* Dropping at vault root: nothing to expand. */ }
    void panelActions.move(moving, folder);
  }

  /**
   * Dispatches a tree key command to the matching state transition.
   * @purpose Maps a resolved tree key command onto selection/folder/selection-state changes.
   * @inputs event - The originating keyboard event.
   * @outputs void
   * @dataflow treeKeyCommand -> command type -> selection/folder mutation -> redraw.
   * @controlflow Resolve command; if null return; else preventDefault then branch on command.type to mutate state; always redraw.
   */
  function runKey(event: KeyboardEvent): void {
    const command = treeKeyCommand(event);
    // No recognized command: let the event propagate without side effects.
    if (command === null) { return; } else { event.preventDefault(); }
    const focused = focusedNode();
    // Move focus within the visible rows.
    if (command.type === 'move') { selection = moveFocus(selection, relatives, command.delta, command.extend); }
    // Jump to the first or last visible row.
    else if (command.type === 'first' || command.type === 'last') { const edge = command.type === 'first' ? relatives[0] : relatives[relatives.length - 1]; if (edge !== undefined) { selection = focusRow(selection, relatives, edge); } else { /* No rows visible: nothing to jump to. */ } }
    // Expand the focused folder; when already expanded, step into its first child.
    else if (command.type === 'expand') { if (focused?.kind !== 'folder') { /* Not a folder: nothing to expand. */ } else if (expanded.has(focused.relative)) { selection = moveFocus(selection, relatives, 1, false); } else { expanded.add(focused.relative); } }
    // Collapse the focused folder; otherwise focus its parent.
    else if (command.type === 'collapse') { if (focused === undefined) { /* Nothing focused: nothing to collapse. */ } else if (focused.kind === 'folder' && expanded.has(focused.relative)) { expanded.delete(focused.relative); } else if (parentRelative(focused.relative) !== '') { selection = focusRow(selection, relatives, parentRelative(focused.relative)); } else { /* Already at vault root: nothing to collapse up to. */ } }
    // Open a file or toggle folder expansion; files open the note.
    else if (command.type === 'open') { if (focused === undefined) { /* Nothing focused: nothing to open. */ } else if (focused.kind === 'file') { options.openNote(focused.path); } else if (expanded.has(focused.relative)) { expanded.delete(focused.relative); } else { expanded.add(focused.relative); } }
    // Rename the focused node.
    else if (command.type === 'rename') { if (focused !== undefined) { void panelActions.rename(focused); } else { /* Nothing focused: nothing to rename. */ } }
    // Trash every selected node.
    else if (command.type === 'trash') { const chosen = selectedNodes(); if (chosen.length > 0) { void panelActions.trash(chosen); } else { /* Nothing selected: nothing to trash. */ } }
    // Fallback: select the entire visible set.
    else { selection = { selected: new Set(relatives), anchor: relatives[0] ?? null, focus: selection.focus ?? relatives[0] ?? null }; }
    redraw();
  }

  /**
   * Recursively indexes every node by relative path.
   * @purpose Populates the nodes Map with all tree entries for O(1) lookup during render and interaction.
   * @inputs list - The current level of tree nodes to index.
   * @outputs void
   * @dataflow list -> nodes.set per entry -> recurse into folder children.
   * @controlflow For each node set its relative key; if a folder, recurse into its children.
   */
  function indexNodes(list: readonly TreeNode[]): void {
    for (const node of list) {
      nodes.set(node.relative, node);
      // Recurse into subfolders so nested entries are indexed too.
      if (node.kind === 'folder') { indexNodes(node.children); } else { /* Leaf node: no children to index. */ }
    }
  }

  /**
   * Rebuilds panel state from current accessors, resetting on vault change.
   * @purpose Recomputes the tree from notes/folders, resets selection/expanded when the vault root changes, and renders empty/scanning states.
   * @outputs void
   * @dataflow options.root() -> reset check -> buildFileTree -> indexNodes -> draw; or empty/scanning branches.
   * @controlflow Guard destroyed -> reset on new root -> if null render open state; else set header, guard scanning/empty, build tree and draw.
   */
  function refresh(): void {
    // Guard against refreshing after teardown.
    if (destroyed) { return; } else { /* Already torn down: skip. */ }
    const rootPath = options.root();
    // A different vault starts collapsed with nothing selected.
    if (rootPath !== lastRoot) { expanded = new Set(); selection = EMPTY_SELECTION; lastRoot = rootPath; tree = []; } else { /* Same vault: preserve expansion and selection. */ }
    newNoteButton.disabled = rootPath === null; newFolderButton.disabled = rootPath === null; templateButton.disabled = rootPath === null;
    if (rootPath === null) {
      rootLabel.textContent = 'Files'; rootLabel.title = ''; tree = []; nodes.clear(); relatives = [];
      // Show the open action only when a folder picker is actually available.
      if (options.canOpen()) { const open = doc.createElement('button'); open.type = 'button'; open.className = 'kdoc-files-open'; open.textContent = 'Open Folder'; open.addEventListener('click', (): void => { options.openVault(); }, { signal }); body.replaceChildren(emptyLine('No folder open.'), open); }
      else { /* No picker available: show the empty state without an action button. */ body.replaceChildren(emptyLine('No folder open.')); }
      return;
    } else { /* A vault is open: render its tree below. */ }
    rootLabel.textContent = folderBaseName(rootPath); rootLabel.title = rootPath;
    const notes = options.notes(); const folders = options.folders();
    // Scanning with nothing indexed yet: show a progress readout instead of an empty list.
    // A rescan of the vault already shown empties the note list while it runs; keep drawing the last tree until it
    // finishes, so rows do not vanish and the selection is not lost after every rename, move or delete.
    if (options.scanning() && tree.length > 0) {
      // Rescanning a vault already on screen: leave the rows as they are.
      return;
    } else if (notes.length === 0 && folders.length === 0 && options.scanning()) {
      // First scan with nothing found yet: say so rather than show an empty panel.
      body.replaceChildren(emptyLine('Scanning…'));
      return;
    } else {
      // Scan finished, or notes are already arriving on a first open: build the tree below.
    }
    tree = buildFileTree(notes, folders);
    nodes.clear(); indexNodes(tree);
    // Ensure the stable tree element lives inside the body before rendering into it.
    if (treeElement.parentElement !== body) { body.replaceChildren(treeElement); } else { /* Tree already mounted in body: reuse it. */ }
    draw();
  }

  /**
   * Reports whether an event target is empty body or tree space.
   * @purpose Determines if a drag/context event landed on an area with no row to act on.
   * @inputs target - The event target, possibly null.
   * @outputs boolean - True when the target is the body or the tree element.
   * @dataflow target -> membership test against body and treeElement.
   * @controlflow Return true if target equals body or treeElement; else false.
   */
  function isEmptyArea(target: EventTarget | null): boolean { return target === body || target === treeElement; }

  newNoteButton.addEventListener('click', (): void => { void panelActions.newNote(targetFolder()); }, { signal });
  newFolderButton.addEventListener('click', (): void => { void panelActions.newFolder(targetFolder()); }, { signal });
  templateButton.addEventListener('click', (): void => { void panelActions.newFromTemplate(targetFolder()); }, { signal });
  treeElement.addEventListener('keydown', runKey, { signal });
  body.addEventListener('contextmenu', (event: MouseEvent): void => {
    // Show the empty-area menu only on empty space while a vault is open.
    if (isEmptyArea(event.target) && options.root() !== null) { event.preventDefault(); selection = EMPTY_SELECTION; draw(); openMenu(event.clientX, event.clientY, false); } else { /* Row or no vault: ignore to avoid clobbering row menus. */ } }, { signal });
  body.addEventListener('dragover', (event: DragEvent): void => { if (isEmptyArea(event.target) && canDropInto(dragged, '')) { event.preventDefault(); } else { /* Not an empty drop target: let the browser keep its default. */ } }, { signal });
  body.addEventListener('drop', (event: DragEvent): void => { if (isEmptyArea(event.target) && canDropInto(dragged, '')) { event.preventDefault(); dropInto(''); } else { /* Not an empty drop target: ignore. */ } }, { signal });

  /**
   * Moves DOM focus to the first row or toolbar button.
   * @purpose Brings focus into the panel by focusing the first row when present, else the new-note button.
   * @outputs void
   * @dataflow destroyed guard -> activeElement check -> querySelector first row -> focus; fallback to newNoteButton.
   * @controlflow Guard destroyed -> if focused element already in tree return; else focus first row or new-note button.
   */
  function focus(): void {
    // Guard against focusing after teardown.
    if (destroyed) { return; } else { /* Active panel: proceed to move focus below. */ }
    focusRowElement();
    // Focus already inside the tree: leave it where it is.
    if (treeElement.contains(doc.activeElement)) { return; } else { /* Focus is elsewhere: move it into the panel. */ }
    const first = treeElement.querySelector<HTMLElement>('.kdoc-tree-row');
    if (first !== null) { first.focus(); } else { /* No rows yet: focus the primary action button. */ newNoteButton.focus(); }
  }

  /**
   * Idempotently tears down listeners and clears DOM children.
   * @purpose Aborts the row-render controller and lifetime signal, then empties the panel element.
   * @outputs void
   * @dataflow destroyed guard -> rowsAbort.abort() -> lifetime.abort() -> replaceChildren().
   * @controlflow Guard destroyed -> mark destroyed -> abort pending render -> abort listeners -> clear root children.
   */
  function destroy(): void {
    if (destroyed) { return; } else { destroyed = true; }
    // Cancel any pending render so it cannot touch detached DOM.
    if (rowsAbort !== null) { rowsAbort.abort(); rowsAbort = null; } else { /* No pending render to cancel. */ }
    lifetime.abort(); root.replaceChildren();
  }

  refresh();
  return { element: root, refresh, focus, destroy };
}
