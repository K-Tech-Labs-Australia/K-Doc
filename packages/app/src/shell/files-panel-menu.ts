/**
 * @file files-panel-menu.ts
 * @purpose Implements the vault file tree's right-click context menu entries and drop-validation rules, plus the Files panel stylesheet (FR-6.11), kept separate from the panel's DOM code so the view layer never constructs menus or owns styling strings directly.
 * @inputs TreeMenuInput describing the target folder, selected nodes, whether the menu opened on a row, and the FileTreeActions to invoke; dragged node arrays plus a destination folder for drop validation.
 * @outputs PopupMenuEntry[] context-menu lists, boolean drop-eligibility results, extracted base folder names, and the concatenated FILES_PANEL_STYLES stylesheet string.
 * @functions
 *   - treeMenuEntries: Builds the ordered context-menu entries (always-present creation group plus optional row-scoped actions) from a TreeMenuInput.
 *   - canDropInto: Returns whether dragged nodes may be dropped into a destination folder without violating containment or no-op rules.
 *   - folderBaseName: Extracts the final path segment of a possibly-slash- or backslash-terminated root string.
 * @dataflow TreeMenuInput -> treeMenuEntries -> PopupMenuEntry[]; dragged + folderRelative -> canDropInto -> boolean; root string -> folderBaseName -> base name; FILE_TREE_STYLES + panel CSS -> FILES_PANEL_STYLES.
 * @controlflow Derive single selection -> build three creation entries -> branch on onRow to append row actions or nothing -> return entries; guard empty drag source -> reject self-containment -> require a real move -> return eligibility.
 * @version 1
 * @date 2026-09-14
 */

import { isSameOrInside, parentRelative, type TreeNode } from '@k-doc/core';
import type { PopupMenuEntry } from './popup-menu.js';
import type { FileTreeActions } from './file-tree-actions.js';
import { FILE_TREE_STYLES } from './file-tree-view.js';

/**
 * Parameters consumed by treeMenuEntries to construct the file tree context menu.
 *
 * @purpose Carries the destination folder, current selection, open location, and action bindings needed to build menu entries.
 * @inputs folder - Target folder for new note/folder creation ('' is the vault root).
 * @inputs chosen - Selected nodes in display order.
 * @inputs onRow - True when the menu opened on a row rather than the empty area below rows.
 * @inputs actions - FileTreeActions invoked by each menu entry's run callback.
 */
export interface TreeMenuInput {
  /** The folder a new note or folder goes into ('' is the vault root). */
  readonly folder: string;
  /** The selected nodes, in display order. */
  readonly chosen: readonly TreeNode[];
  /** True when the menu was opened on a row rather than the empty area. */
  readonly onRow: boolean;
  readonly actions: FileTreeActions;
}

/**
 * Builds the ordered list of context-menu entries for the vault file tree.
 *
 * @purpose Assembles the always-present creation group (New Note, New Folder, New Note from Template) and, when the menu opened on a row, appends rename/delete/reveal actions gated by the current selection.
 * @inputs input - TreeMenuInput describing target folder, selected nodes, open location, and action bindings.
 * @outputs PopupMenuEntry[] - The ordered entries: creation group followed by optional separators and row actions.
 * @dataflow input.folder -> new* callbacks; input.chosen -> single derivation and delete label/count; input.onRow -> branch to append row actions; input.actions -> every entry's run callback.
 * @controlflow Derive single selection -> build three creation entries -> if opened on a row, push separator then rename/delete/reveal entries gated by selection -> else append nothing -> return entries.
 */
export function treeMenuEntries(input: TreeMenuInput): PopupMenuEntry[] {
  const { folder, chosen, actions } = input;

  // A single selection is tracked separately so row-only actions (rename, reveal) can gate their enabled state and execution on its presence.
  // When exactly one node is selected it holds that node; otherwise it is undefined.
  const single = chosen.length === 1 ? chosen[0] : undefined;

  const entries: PopupMenuEntry[] = [
    {
      id: 'kdoc-files-tree-new-note',
      label: 'New Note',
      hint: '',
      enabled: true,
      run: (): void => { void actions.newNote(folder); },
    },
    {
      id: 'kdoc-files-tree-new-folder',
      label: 'New Folder',
      hint: '',
      enabled: true,
      run: (): void => { void actions.newFolder(folder); },
    },
    {
      id: 'kdoc-files-tree-new-template',
      label: 'New Note from Template…',
      hint: '',
      enabled: true,
      run: (): void => { void actions.newFromTemplate(folder); },
    },
  ];

  // The menu opened on a row: expose selection-scoped actions after the always-present creation group.
  if (input.onRow) {
    entries.push({ separator: true });

    // Rename applies only to exactly one selected node; disabled when zero or many are selected.
    entries.push({
      id: 'kdoc-files-tree-rename',
      label: 'Rename…',
      hint: 'F2',
      enabled: single !== undefined,
      run: (): void => {
        // Rename applies only when exactly one node is selected.
        if (single !== undefined) {
          // Single selection present: invoke the rename action on it.
          void actions.rename(single);
        } else {
          // No single selection: this entry is disabled, so run() is never invoked; branch kept for completeness.
        }
      },
    });

    // Delete applies to one or more selected nodes; the label pluralizes when more than one is selected.
    entries.push({
      id: 'kdoc-files-tree-delete',
      label: chosen.length > 1 ? `Delete ${chosen.length} Items` : 'Delete',
      hint: 'Del',
      enabled: chosen.length > 0,
      run: (): void => { void actions.trash(chosen); },
    });

    entries.push({ separator: true });

    // Reveal applies only to exactly one selected node; disabled when zero or many are selected.
    entries.push({
      id: 'kdoc-files-tree-reveal',
      label: 'Reveal in File Explorer',
      hint: '',
      enabled: single !== undefined,
      run: (): void => {
        // Reveal applies only when exactly one node is selected.
        if (single !== undefined) {
          // Single selection present: invoke the reveal action on it.
          actions.reveal(single);
        } else {
          // No single selection: this entry is disabled, so run() is never invoked; branch kept for completeness.
        }
      },
    });
  } else {
    // The menu opened on the empty area below the rows: only creation is offered, so nothing extra is appended.
  }

  return entries;
}

/**
 * Determines whether dragged nodes may be dropped into a destination folder.
 *
 * @purpose Rejects empty drag sources and drops that would place a folder inside itself or one of its own subfolders, and rejects no-op drops where nothing actually changes folder; otherwise accepts the drop.
 * @inputs dragged - The nodes being dragged.
 * @inputs folderRelative - The destination folder relative path (empty string is the vault root).
 * @outputs boolean - True when the drop is permitted; false for empty sources, self-containment violations, or no-op moves.
 * @dataflow each dragged node.relative -> parentRelative and isSameOrInside comparisons against folderRelative -> boolean result.
 * @controlflow Reject empty drag source -> reject any folder landing inside itself/subfolder via isSameOrInside -> accept only if some node's parent differs from the destination -> return eligibility.
 */
export function canDropInto(dragged: readonly TreeNode[], folderRelative: string): boolean {
  // An empty drag needs no check of its own: with nothing dragged, nothing changes folder, so the last test refuses it.

  // A folder may not be dropped inside itself or any descendant subfolder, which would corrupt the tree hierarchy.
  if (dragged.some((node) => node.kind === 'folder' && isSameOrInside(folderRelative, node.relative))) {
    // A dragged folder's own path contains the destination: reject to avoid nesting a folder within itself.
    return false;
  } else {
    // No dragged folder contains the destination: continue checking for a real move.
  }

  // The drop is only meaningful if at least one node actually changes its parent folder away from the destination.
  return dragged.some((node) => parentRelative(node.relative) !== folderRelative);
}

/**
 * Extracts the final path segment of a root string as its base folder name.
 *
 * @purpose Trailing slashes or backslashes are stripped, then the text after the last remaining separator (slash or backslash) is returned; when no separator remains the whole trimmed string is the base name.
 * @inputs root - A possibly-slash- or backslash-terminated path string (e.g. 'C:\\notes\\vault\\' or '/v').
 * @outputs string - The final segment, e.g. 'vault' for 'C:\\notes\\vault\\' and 'v' for '/v'.
 * @dataflow root -> trimmed (trailing separators removed) -> lastIndexOf both separators -> slice after the later one -> base name.
 * @controlflow Trim trailing separators -> compute the max of the last slash and backslash indices -> if no separator found return the trimmed string; otherwise return the substring after the later separator.
 */
export function folderBaseName(root: string): string {
  // Strip any trailing slashes or backslashes so a path terminator does not become part of the base name.
  const trimmed = root.replace(/[\\/]+$/, '');

  // Take the later of the last slash and backslash positions; -1 when neither separator is present.
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));

  // No separator remains after trimming (at < 0): return the whole trimmed string as the base name; otherwise return the segment following the last separator.
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}

/**
 * Concatenated stylesheet for the Files panel, extending the shared file-tree styles with panel-specific rules for the container, header, tool buttons, body, empty state, and open button using exclusively K-Doc design tokens.
 *
 * @purpose Provides the Files panel's CSS as a single string so the view layer can inject it without duplicating styling logic or reaching into the file-tree stylesheet directly.
 * @inputs void.
 * @outputs string - FILE_TREE_STYLES followed immediately by the panel-specific rule set below.
 * @dataflow FILE_TREE_STYLES (imported) + literal panel CSS -> FILES_PANEL_STYLES.
 * @controlflow Compose template literal: interpolate imported file-tree styles then append each panel rule verbatim.
 */
export const FILES_PANEL_STYLES: string = `${FILE_TREE_STYLES}
.kdoc-files-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; box-sizing: border-box; background: var(--kdoc-color-background-elevated); color: var(--kdoc-color-text); }
.kdoc-files-panel[hidden] { display: none; }
.kdoc-files-header { display: flex; align-items: center; gap: 2px; padding: 6px 8px 4px 12px; }
.kdoc-files-root { flex: 1; min-width: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--kdoc-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdoc-files-tool { border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--kdoc-color-text-muted); font: inherit; font-size: 13px; padding: 1px 5px; cursor: pointer; }
.kdoc-files-tool:hover { background: var(--kdoc-color-background-subtle); color: var(--kdoc-color-text); }
.kdoc-files-tool:focus-visible { outline: 2px solid var(--kdoc-color-accent); outline-offset: -1px; }
.kdoc-files-tool:disabled { opacity: 0.4; cursor: default; }
.kdoc-files-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; }
.kdoc-files-empty { font-size: 13px; color: var(--kdoc-color-text-muted); padding: 8px 12px; font-style: italic; }
.kdoc-files-open { margin: 4px 12px; border: 1px solid var(--kdoc-color-border); border-radius: 4px; background: transparent; color: var(--kdoc-color-text); font: inherit; font-size: 13px; padding: 4px 10px; cursor: pointer; }
.kdoc-files-open:hover { background: var(--kdoc-color-background-subtle); }
.kdoc-files-open:focus-visible { outline: 2px solid var(--kdoc-color-accent); outline-offset: -1px; }
`;
