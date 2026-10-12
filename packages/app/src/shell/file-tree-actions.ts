/**
 * @file file-tree-actions.ts
 * @purpose Implements the vault file tree commands (FR-6.11): ask for names, confirm deletes, call the host, then tell the shell what moved or went away.
 * @inputs Options binding the VaultFiles facade, current root, drawn tree, name/confirm/template prompts, text read, refresh, and shell callbacks for moved/trashed/open/reveal/showMessage.
 * @outputs A FileTreeActions object whose methods perform create, rename, trash, move, and reveal operations against the vault.
 * @functions
 *   - messageOf: Extracts a displayable message from a caught value.
 *   - createFileTreeActions: Factory wiring the file tree commands to the host and shell callbacks.
 *   - requireRoot: Returns the open vault root or shows an error when none is open.
 *   - askName: Prompts for a name, validates it, and returns null on cancel or problem.
 *   - createNoteNamed: Creates a note with contents in a folder, refreshes, and opens it.
 *   - newNote: Asks for a note name and creates an empty note.
 *   - newFolder: Asks for a folder name and creates an empty folder.
 *   - newFromTemplate: Picks a template, asks for a name, and creates a note from its contents.
 *   - rename: Asks for a new name and moves the node to it.
 *   - trash: Confirms and moves nodes to the Recycle Bin, closing their tabs.
 *   - move: Moves nodes to a target folder, reporting failures.
 *   - reveal: Reveals a node's absolute path in the host.
 * @dataflow Options callbacks → name/confirm prompts → VaultFiles IPC → refresh + shell moved/trashed/open/reveal notifications.
 * @controlflow Gate on open root → prompt for names or confirm deletes → call the host → refresh the tree → notify the shell of moves or removals; show messages on any failure.
 * @version 1
 * @date 2026-09-14
 */

import { absolutePath, baseName, childNames, childRelative, isSameOrInside, parentRelative, topLevelOnly, uniqueChildName, validateEntryName, withNoteExtension, type TreeNode } from '@k-doc/core';
import type { VaultFiles, VaultTemplate } from '../files/vault-files.js';

export interface FileTreeActions {
  newNote(folderRelative: string): Promise<void>;
  newFolder(folderRelative: string): Promise<void>;
  newFromTemplate(folderRelative: string): Promise<void>;
  rename(node: TreeNode): Promise<void>;
  trash(nodes: readonly TreeNode[]): Promise<void>;
  move(nodes: readonly TreeNode[], targetFolderRelative: string): Promise<void>;
  reveal(node: TreeNode): void;
}

export interface FileTreeActionsOptions {
  readonly files: VaultFiles;
  readonly root: () => string | null;
  /** The tree as drawn, to suggest a name nothing in the folder already has. */
  readonly tree: () => readonly TreeNode[];
  /** Asks for a name; resolves null when the user cancels. */
  readonly ask: (title: string, label: string, initial: string) => Promise<string | null>;
  /** Asks a yes/no question; resolves true for yes. */
  readonly confirm: (heading: string, message: string, yes: string) => Promise<boolean>;
  readonly pickTemplate: (templates: readonly VaultTemplate[]) => Promise<VaultTemplate | null>;
  readonly readText: (path: string) => Promise<string>;
  /** Rescans the vault and its folders so the tree shows the change. */
  readonly refresh: () => Promise<void>;
  /** A note or folder moved; open tabs under `from` follow it. Absolute paths. */
  readonly moved: (from: string, to: string) => void;
  /** Notes or folders went to the Recycle Bin; open tabs for them close. Absolute paths. */
  readonly trashed: (paths: readonly string[]) => void;
  readonly open: (path: string) => void;
  readonly reveal: (path: string) => void;
  readonly showMessage: (text: string) => void;
}

/**
 * Extracts a displayable message from whatever value was caught by a handler.
 *
 * @purpose Normalises thrown values into a single string for showMessage so failures are always legible.
 * @inputs caught - The unknown value produced by a rejected operation or host rejection.
 * @outputs string - The error's message, or the value coerced to text when it is not an Error.
 * @dataflow caught → instanceof Error check → message property or String() coercion → returned string.
 * @controlflow Accept an Error and return its message; otherwise coerce any other value to text.
 */
function messageOf(caught: unknown): string {
  if (caught instanceof Error) {
    // Branch: A real Error carries a human-readable message; use it verbatim so host path errors stay actionable.
    return caught.message;
  } else {
    // Branch: Non-Error values are coerced to text so the failure is still reported rather than lost.
    return String(caught);
  }
}

/**
 * Factory wiring the vault file tree commands (FR-6.11) to the host facade and shell callbacks.
 *
 * @purpose Builds a FileTreeActions object whose methods prompt, validate, call the host, refresh, and notify the shell.
 * @inputs options - The VaultFiles facade, current root accessor, drawn tree, prompts, refresh, and shell callbacks.
 * @outputs FileTreeActions - The command set exposed to the file tree UI.
 * @dataflow options → closure helpers (requireRoot/askName/createNoteNamed) → per-command host calls + shell notifications.
 * @controlflow Construct bound helpers once; return an object exposing newNote, newFolder, newFromTemplate, rename, trash, move, reveal.
 */
export function createFileTreeActions(options: FileTreeActionsOptions): FileTreeActions {
  /**
   * Returns the currently open vault root or prompts the user to open one.
   *
   * @purpose Guards every command on an open vault by surfacing a message when none is open.
   * @inputs None.
   * @outputs string | null - The open vault root path, or null when no folder is open.
   * @dataflow options.root() → boolean check → showMessage on null → returned path or null.
   * @controlflow Read the current root → return it when present; otherwise show an error and return null.
   */
  function requireRoot(): string | null {
    // The vault root is supplied by the shell as a live accessor so it always reflects the open folder.
    const root = options.root();
    if (root === null) {
      // Branch: No folder is open; there is nothing to operate on, so prompt and bail out.
      options.showMessage('Open a folder first.');
    } else {
      // Branch: A vault is open; the path is usable by every filesystem command below.
    }
    return root;
  }

  /**
   * Prompts for an entry name, validates it, and returns the trimmed answer or null on cancel/problem.
   *
   * @purpose Centralises name collection so every create/rename path rejects invalid names with a message.
   * @inputs title - Dialog title shown to the user.
   * @inputs label - Field label for the name input.
   * @inputs initial - Suggested starting text pre-filled in the input.
   * @outputs Promise<string | null> - The validated, trimmed name; null when cancelled or invalid.
   * @dataflow options.ask → validateEntryName → showMessage on problem → returned answer or null.
   * @controlflow Ask for a name → bail on cancel → validate → show the problem and bail on failure → otherwise return the trimmed name.
   */
  async function askName(title: string, label: string, initial: string): Promise<string | null> {
    const answer = await options.ask(title, label, initial);
    if (answer === null) {
      // Branch: The user cancelled; propagate cancellation without touching the vault.
      return null;
    } else {
      // Branch: An answer was given; validate it before accepting.
      const problem = validateEntryName(answer);
      if (problem !== null) {
        // Branch: The name is invalid; report the reason and treat this as a cancellation.
        options.showMessage(problem);
        return null;
      } else {
        // Branch: The name is valid; accept it trimmed of surrounding whitespace.
        return answer.trim();
      }
    }
  }

  /**
   * Creates a note with the given contents in a folder, refreshes the tree, and opens it.
   *
   * @purpose Builds the absolute path for a new .md note and drives create → refresh → open end to end.
   * @inputs root - Vault root folder path.
   * @inputs folderRelative - Folder inside the vault to place the note in, relative to root.
   * @inputs name - The note's base name without extension.
   * @inputs contents - UTF-8 text written into the new note.
   * @outputs Promise<void> - Resolves after the note is created, the tree refreshed, and it opened.
   * @dataflow (root, folderRelative, name) → withNoteExtension + childRelative + absolutePath → createNote → refresh → open.
   * @controlflow Compute the absolute path → call createNote inside try → on success refresh then open → on failure show the message.
   */
  async function createNoteNamed(root: string, folderRelative: string, name: string, contents: string): Promise<void> {
    // A note is stored as a .md file under the target folder; build its absolute path from those pieces.
    const path = absolutePath(root, childRelative(folderRelative, withNoteExtension(name)));
    try {
      // Create the note on disk and let the host resolve its final path.
      const created = await options.files.createNote(root, path, contents);
      // Reflect the new file in the tree before opening it so the open tab matches a real entry.
      await options.refresh();
      options.open(created);
    } catch (caught: unknown) {
      // Any host failure surfaces through showMessage rather than being swallowed.
      options.showMessage(messageOf(caught));
    }
  }

  /**
   * Asks for a note name and creates an empty note in the given folder.
   *
   * @purpose Drives the "new note" command: suggest, prompt, validate, create, open.
   * @inputs folderRelative - Folder inside the vault to place the new note in, relative to root.
   * @outputs Promise<void> - Resolves after the note is created and opened; no-op on cancel or failure.
   * @dataflow options.tree → uniqueChildName suggestion → askName → createNoteNamed with empty contents.
   * @controlflow Gate on open root → suggest a free name → prompt for the name → create an empty note; abort on cancel.
   */
  async function newNote(folderRelative: string): Promise<void> {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; the command cannot proceed without a target folder.
      return;
    } else {
      // Branch: A vault is open; continue to collect the note name and create it.
      // Suggest a base name that no entry in the folder already uses, dropping the .md suffix for input.
      const suggested = uniqueChildName(childNames(options.tree(), folderRelative), 'Untitled', '.md');
      const name = await askName('New note', 'Note name', suggested.slice(0, -'.md'.length));
      if (name === null) {
        // Branch: The user cancelled or the suggested name was rejected; abort without creating anything.
        return;
      } else {
        // Branch: A valid name was chosen; create an empty note with it.
        await createNoteNamed(root, folderRelative, name, '');
      }
    }
  }

  /**
   * Asks for a folder name and creates an empty folder in the given folder.
   *
   * @purpose Drives the "new folder" command: suggest, prompt, validate, create on disk, refresh.
   * @inputs folderRelative - Folder inside the vault to place the new folder in, relative to root.
   * @outputs Promise<void> - Resolves after the folder is created and the tree refreshed; no-op on cancel or failure.
   * @dataflow options.tree → uniqueChildName suggestion → askName → createFolder at absolute path → refresh.
   * @controlflow Gate on open root → suggest a free name → prompt for the name → create the directory; abort on cancel, show message on failure.
   */
  async function newFolder(folderRelative: string): Promise<void> {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; abort before touching the filesystem.
      return;
    } else {
      // Branch: A vault is open; prompt for a folder name and create it on disk.
      const name = await askName('New folder', 'Folder name', uniqueChildName(childNames(options.tree(), folderRelative), 'New folder', ''));
      if (name === null) {
        // Branch: Cancelled or invalid name; nothing to create.
        return;
      } else {
        // Branch: A valid folder name was chosen; create the empty directory and refresh the tree.
        try {
          await options.files.createFolder(root, absolutePath(root, childRelative(folderRelative, name)));
          await options.refresh();
        } catch (caught: unknown) {
          // Any host failure surfaces through showMessage rather than being swallowed.
          options.showMessage(messageOf(caught));
        }
      }
    }
  }

  /**
   * Picks a template, asks for a note name, and creates a note from its contents.
   *
   * @purpose Drives the "new note from template" command: list templates, pick, prompt, read, create.
   * @inputs folderRelative - Folder inside the vault to place the new note in, relative to root.
   * @outputs Promise<void> - Resolves after the note is created and opened; no-op on cancel or failure.
   * @dataflow listTemplates → pickTemplate → askName → readText template contents → createNoteNamed with those contents.
   * @controlflow Gate on open root → load templates (show message, abort if unreadable or empty) → pick one → prompt for a name → read its text → create the note; show messages on any failure.
   */
  async function newFromTemplate(folderRelative: string): Promise<void> {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; abort before listing templates.
      return;
    } else {
      // Branch: A vault is open; load the available templates first.
      let templates: readonly VaultTemplate[];
      try {
        templates = await options.files.listTemplates(root);
      } catch (caught: unknown) {
        // Any failure to read the template folder stops the command and shows the reason.
        options.showMessage(messageOf(caught));
        return;
      }
      if (templates.length === 0) {
        // Branch: No templates exist yet; guide the user to create one instead of opening an empty picker.
        options.showMessage('No templates yet. Add Markdown files to .k-doc/templates in the vault.');
        return;
      } else {
        // Branch: Templates are available; let the user pick one.
        const template = await options.pickTemplate(templates);
        if (template === null) {
          // Branch: The user cancelled the picker; abort without creating anything.
          return;
        } else {
          // Branch: A template was chosen; read its contents and prompt for a note name.
          const suggested = uniqueChildName(childNames(options.tree(), folderRelative), template.name, '.md');
          const name = await askName('New note from template', 'Note name', suggested.slice(0, -'.md'.length));
          if (name === null) {
            // Branch: Cancelled or invalid name; discard the chosen template.
            return;
          } else {
            // Branch: A valid name was chosen; load the template text and create the note.
            let contents: string;
            try {
              contents = await options.readText(template.path);
            } catch (caught: unknown) {
              // A failure to read the template file stops the command and shows the reason.
              options.showMessage(messageOf(caught));
              return;
            }
            await createNoteNamed(root, folderRelative, name, contents);
          }
        }
      }
    }
  }

  /**
   * Asks for a new name and moves the node to it on disk.
   *
   * @purpose Drives the "rename" command: pre-fill from the current name, validate, move, notify tabs, refresh.
   * @inputs node - The tree node (note or folder) being renamed.
   * @outputs Promise<void> - Resolves after the rename is applied and the tree refreshed; no-op on cancel or failure.
   * @dataflow node.relative → absolutePath from/to → files.move → moved(from, to) + refresh; abort on cancel.
   * @controlflow Gate on open root → pre-fill a .md note without its extension → prompt for a name → skip a no-op rename → move and notify; show message on failure.
   */
  async function rename(node: TreeNode): Promise<void> {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; abort before prompting for a new name.
      return;
    } else {
      // Branch: A vault is open; collect the new name, pre-filled from the current one.
      let initial: string;
      if (node.kind === 'file' && node.name.toLowerCase().endsWith('.md')) {
        // A .md note is offered without its extension so the user edits just the base name; the typed name is kept as-is.
        initial = node.name.slice(0, -3);
      } else {
        // Branch: A folder or non-.md file keeps its full current name unchanged in the input.
        initial = node.name;
      }
      const name = await askName('Rename', 'New name', initial);
      if (name === null) {
        // Branch: Cancelled or invalid name; abort without moving anything.
        return;
      } else {
        // Branch: A valid new name was chosen; decide the kept form and skip a no-op rename.
        let newName: string;
        if (node.kind === 'file') {
          // A note keeps its .md extension after renaming.
          newName = withNoteExtension(name);
        } else {
          // Branch: A folder's name is used verbatim with no added extension.
          newName = name;
        }
        if (newName === node.name) {
          // Branch: The new name matches the current one; there is nothing to move.
          return;
        } else {
          // Branch: The name actually changes; rename on disk, notify following tabs, and refresh the tree.
          const from = absolutePath(root, node.relative);
          const to = absolutePath(root, childRelative(parentRelative(node.relative), newName));
          try {
            const actual = await options.files.move(root, from, to);
            options.moved(from, actual);
            await options.refresh();
          } catch (caught: unknown) {
            // Any host failure surfaces through showMessage rather than being swallowed.
            options.showMessage(messageOf(caught));
          }
        }
      }
    }
  }

  /**
   * Confirms and moves selected nodes to the Recycle Bin, closing their open tabs.
   *
   * @purpose Drives the "trash" command: de-duplicate, confirm with an item count, move, notify, refresh.
   * @inputs nodes - The tree nodes selected for deletion.
   * @outputs Promise<void> - Resolves after the items are trashed and the tree refreshed; no-op on cancel or failure.
   * @dataflow nodes → topLevelOnly relatives → absolute paths → files.trash → trashed(paths) + refresh.
   * @controlflow Gate on open root with at least one node → build a singular/plural confirmation message → confirm → trash and notify; show message on failure.
   */
  async function trash(nodes: readonly TreeNode[]): Promise<void> {
    const root = requireRoot();
    if (root === null || nodes.length === 0) {
      // Branch: No vault open or nothing selected; abort before prompting for confirmation.
      return;
    } else {
      // Branch: A vault is open and at least one node is selected; confirm then trash on disk.
      const relatives = topLevelOnly(nodes.map((node) => node.relative));
      const first = nodes.find((node) => node.relative === relatives[0]);
      let message: string;
      if (relatives.length === 1 && first !== undefined) {
        // Branch: A single item was selected; describe that one item and its closed tab.
        message = `Move "${first.name}" to the Recycle Bin? If it is open, its tab closes.`;
      } else {
        // Branch: Multiple items (or an unresolvable single index); describe them as a group with plural wording.
        message = `Move ${relatives.length} items to the Recycle Bin? Tabs open on them close.`;
      }
      const yes = await options.confirm('Delete', message, 'Move to Recycle Bin');
      if (!yes) {
        // Branch: The user declined the confirmation; abort without trashing anything.
        return;
      } else {
        // Branch: Confirmed; move every selected item to the Recycle Bin and close their tabs.
        const paths = relatives.map((relative) => absolutePath(root, relative));
        try {
          await options.files.trash(root, paths);
          options.trashed(paths);
          await options.refresh();
        } catch (caught: unknown) {
          // Any host failure surfaces through showMessage rather than being swallowed.
          options.showMessage(messageOf(caught));
        }
      }
    }
  }

  /**
   * Moves selected nodes to a target folder, reporting any failures.
   *
   * @purpose Drives the "move" command: skip no-ops and self-moves, move each top-level node, refresh once, report failures.
   * @inputs nodes - The tree nodes being moved.
   * @inputs targetFolderRelative - Destination folder inside the vault, relative to root.
   * @outputs Promise<void> - Resolves after moves apply and the tree refreshes; no-op on cancel or failure.
   * @dataflow nodes → topLevelOnly relatives → per-node absolute from/to → files.move → moved + changed/failures tracking → refresh + showMessage.
   * @controlflow Gate on open root → for each top-level node skip same-folder and self-moves, else move and record; refresh if anything moved; show joined failures.
   */
  async function move(nodes: readonly TreeNode[], targetFolderRelative: string): Promise<void> {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; abort before attempting any moves.
      return;
    } else {
      // Branch: A vault is open; move each top-level selected node to the target folder.
      const failures: string[] = [];
      let changed = false;
      for (const relative of topLevelOnly(nodes.map((node) => node.relative))) {
        // Already in that folder: nothing to move.
        if (parentRelative(relative) === targetFolderRelative) {
          // Branch: The node already lives directly in the target folder; skip it unchanged.
          continue;
        } else {
          // Branch: The node is elsewhere; check for a self-move before moving it.
          // A folder dropped into itself or its own subfolder.
          if (isSameOrInside(targetFolderRelative, relative)) {
            // Branch: The target is the node itself or one of its descendants; reject to avoid nesting errors.
            failures.push(`Cannot move "${baseName(relative)}" into itself.`);
            continue;
          } else {
            // Branch: A valid move into a different folder; execute it and record success.
            const from = absolutePath(root, relative);
            const to = absolutePath(root, childRelative(targetFolderRelative, baseName(relative)));
            try {
              const actual = await options.files.move(root, from, to);
              options.moved(from, actual);
              changed = true;
            } catch (caught: unknown) {
              // Record each per-node failure so all are reported together after the loop.
              failures.push(messageOf(caught));
            }
          }
        }
      }
      if (changed) {
        // Branch: At least one node moved; refresh the tree so the new layout is shown.
        await options.refresh();
      } else {
        // Branch: Nothing moved; skip an unnecessary rescan of the vault.
      }
      if (failures.length > 0) {
        // Branch: One or more moves failed; surface every failure message to the user.
        options.showMessage(failures.join(' '));
      } else {
        // Branch: No failures occurred; nothing further to report.
      }
    }
  }

  /**
   * Reveals a node's absolute path in the host file manager.
   *
   * @purpose Drives the "reveal" command by resolving the node's absolute path and asking the host to show it.
   * @inputs node - The tree node to reveal.
   * @outputs void - No return; performs a side effect on the host.
   * @dataflow options.root() + node.relative → absolutePath → options.reveal(path).
   * @controlflow Gate on open root → resolve the absolute path → ask the host to reveal it.
   */
  function reveal(node: TreeNode): void {
    const root = requireRoot();
    if (root === null) {
      // Branch: No vault open; cannot reveal a path without knowing the vault location.
      return;
    } else {
      // Branch: A vault is open; ask the host to reveal the node's absolute path.
      options.reveal(absolutePath(root, node.relative));
    }
  }

  return { newNote, newFolder, newFromTemplate, rename, trash, move, reveal };
}
