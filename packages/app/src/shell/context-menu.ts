/**
 * @file context-menu.ts
 * @purpose Implements the context menu for the K-Doc editor pane (FR-14.2), built on popup-menu.ts.
 *   Provides caret-aware contextual actions for clipboard, formatting, hyperlinks, and tables.
 * @inputs ContextMenuOptions containing PopupMenu instance, EditorView, pane element, Document, and link navigation callbacks.
 * @outputs ContextMenu controller interface exposing destroy(), ContextTarget interface, describeTarget(), buildEntries(), and installContextMenu().
 * @functions
 *   - describeTarget: Queries the active EditorState under the caret and returns a ContextTarget descriptor.
 *   - buildEntries: Constructs the list of PopupMenuEntry items and separators conditioned on the ContextTarget.
 *   - installContextMenu: Attaches contextmenu event listener to the editor pane and manages menu display and lifecycle.
 * @dataflow Contextmenu event on pane -> describeTarget(view) -> buildEntries(view, target, options) -> menu.openAt(x, y, entries) -> user selection -> action execution.
 * @controlflow Mount contextmenu listener on pane with AbortController -> prevent browser default -> describe target state -> build filtered entries -> open popup menu -> execute item command and restore focus.
 * @version 5
 * @date 2026-09-18
 */

import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { PopupMenu, PopupMenuEntry, PopupMenuItem } from './popup-menu.js';
import {
  toggleKdocMark,
  clearFormatting,
  activeLink,
  canLink,
  removeLink,
  isInTable,
  addRowAfter,
  deleteRow,
  duplicateRow,
  duplicateColumn,
  addColumnAfter,
  deleteColumn,
  deleteTable,
  sortTableByColumn,
  toggleHeaderRow,
  isBlockActive,
} from '@k-doc/editor';
import { resetImageSize, selectedImage, selectImageAt, stepImageWidth } from '@k-doc/editor';

export interface ContextTarget {
  readonly inTable: boolean;
  readonly onLink: boolean;
  readonly inCodeBlock: boolean;
  readonly hasSelection: boolean;
  /** An image is selected (FR-8.15). */
  readonly onImage: boolean;
}

/**
 * Queries the current editor state under the caret and returns a context descriptor for menu building.
 *
 * @purpose Reads the ProseMirror state once and reports contextual presence (table, link, code block, selection).
 * @inputs view: EditorView - The active ProseMirror editor view.
 * @outputs ContextTarget - Object describing the caret context.
 * @dataflow view.state -> isInTable / activeLink / isBlockActive / selection.empty queries -> ContextTarget.
 * @controlflow Inspect view.state properties -> construct and return ContextTarget.
 */
export function describeTarget(view: EditorView): ContextTarget {
  // The menu is built from the caret, not from the pixel that was right-clicked,
  // because ProseMirror moves the selection to the click position before the contextmenu
  // event is dispatched — so reading the caret is reading where the user clicked,
  // and doing coordinate hit-testing as well would be a second source of truth that could disagree.
  const state = view.state;
  return {
    inTable: isInTable(state),
    onLink: activeLink(state) !== null,
    inCodeBlock: isBlockActive(state, 'codeBlock'),
    hasSelection: !state.selection.empty,
    onImage: selectedImage(state) !== null,
  };
}

export interface ContextMenuOptions {
  readonly menu: PopupMenu;
  readonly view: EditorView;
  readonly pane: HTMLElement;
  readonly doc: Document;
  readonly openLink: () => void;
  readonly followLink: (href: string) => void;
  /** Opens the image dialog for the selected image, to edit its address, alt text and caption (FR-8.15). */
  readonly editImage: () => void;
  /**
   * Supplies the spelling entries that lead the menu when the caret is inside a misspelled word.
   * Async because the suggestions come from the spell engine over IPC.
   *
   * Optional because spell check is a feature the shell may not have installed, and a context menu
   * that required it would make the two features hard to test apart.
   */
  readonly spellEntries?: () => Promise<readonly PopupMenuEntry[]>;
}

export interface ContextMenu {
  destroy(): void;
}

/**
 * Constructs the contextual popup menu entries based on the current caret target and editor view state.
 *
 * @purpose Builds an ordered list of PopupMenuEntry items and separators for clipboard, formatting, link, and table actions.
 * @inputs
 *   - view: EditorView - The active ProseMirror editor view.
 *   - target: ContextTarget - Context descriptor of the current caret position.
 *   - options: ContextMenuOptions - Menu configuration and shell callbacks.
 * @outputs readonly PopupMenuEntry[] - Array of menu items and visual separators.
 * @dataflow target + view.state -> command & action items -> PopupMenuEntry list.
 * @controlflow Build clipboard items -> if selection & !codeBlock, add formatting -> if onLink / canLink, add link actions -> if inTable, add table actions -> return entries.
 */
export function buildEntries(
  view: EditorView,
  target: ContextTarget,
  options: ContextMenuOptions,
): readonly PopupMenuEntry[] {
  /**
   * Helper constructing a popup menu item backed by a ProseMirror Command.
   *
   * @purpose Creates a PopupMenuItem that tests applicability via command dry-run and executes the command on dispatch.
   * @inputs
   *   - id: string - Unique identifier for the menu item.
   *   - label: string - User-visible display text.
   *   - hint: string - Keyboard shortcut hint or empty string.
   *   - command: Command - ProseMirror Command function.
   * @outputs PopupMenuItem - Configured popup menu item.
   * @dataflow command -> PopupMenuItem enabled test & execution -> view.focus().
   * @controlflow Evaluate command dry-run for enabled -> run dispatches command then calls view.focus().
   */
  function editorItem(id: string, label: string, hint: string, command: Command): PopupMenuItem {
    return {
      id,
      label,
      hint,
      enabled: command(view.state, undefined, view),
      run(): void {
        // The view goes in as ProseMirror's own third argument, so a command that must measure what is on
        // screen - stepping a picture's width from the size it is drawn at (FR-8.15) - can reach it.
        command(view.state, view.dispatch, view);
        // Focus must return to the pane because K-Doc keys its edit lock on which pane holds focus.
        view.focus();
      },
    };
  }

  /**
   * Helper constructing a popup menu item backed by an arbitrary callback action.
   *
   * @purpose Creates a PopupMenuItem executing a custom callback.
   * @inputs
   *   - id: string - Unique identifier for the menu item.
   *   - label: string - User-visible display text.
   *   - hint: string - Keyboard shortcut hint or empty string.
   *   - enabled: boolean - Whether the item is interactive.
   *   - run: () => void - Callback executed when the item is chosen.
   * @outputs PopupMenuItem - Configured popup menu item.
   * @dataflow run callback -> PopupMenuItem.
   * @controlflow Constructs and returns PopupMenuItem with the specified enabled status and run callback.
   */
  function actionItem(
    id: string,
    label: string,
    hint: string,
    enabled: boolean,
    run: () => void,
  ): PopupMenuItem {
    return {
      id,
      label,
      hint,
      enabled,
      run,
    };
  }

  const entries: PopupMenuEntry[] = [];

  // Build the list in this order, using { separator: true } between groups and omitting groups that do not apply
  // rather than showing them disabled: an item that is disabled tells the user the action exists but cannot run here;
  // a whole group that does not apply is noise, and a context menu that shows every possible action is just a worse main menu.

  // 1. Clipboard group (Always present)
  // Cut and Copy are enabled only when target.hasSelection.
  // execCommand is deprecated but is still the only way to trigger a clipboard action from a menu
  // without the Async Clipboard API's permission prompt, and Paste in particular is blocked in
  // most browsers from a script — so this entry may do nothing outside the desktop build,
  // which is why it is not the only way to paste.
  entries.push(
    actionItem('context:cut', 'Cut', 'Ctrl+X', target.hasSelection, (): void => {
      view.focus();
      options.doc.execCommand('cut');
    }),
  );
  entries.push(
    actionItem('context:copy', 'Copy', 'Ctrl+C', target.hasSelection, (): void => {
      view.focus();
      options.doc.execCommand('copy');
    }),
  );
  entries.push(
    actionItem('context:paste', 'Paste', 'Ctrl+V', true, (): void => {
      view.focus();
      options.doc.execCommand('paste');
    }),
  );

  // 2. Formatting group
  // Check whether the formatting group applies: requires an active selection and must not be inside a code block.
  // Include this group only when target.hasSelection because formatting with no selection acts on a zero-width range,
  // which looks like nothing happening.
  // Skip the formatting group entirely when target.inCodeBlock because inline marks are not expressible inside a
  // code block, so every one of those commands would be disabled and the group would be four greyed-out lines telling
  // the user nothing.
  // Omitting groups that do not apply avoids visual noise: an item that is disabled tells the user the action exists
  // but cannot run here; a whole group that does not apply is noise, and a context menu that shows every possible
  // action is just a worse main menu.
  if (target.hasSelection && !target.inCodeBlock) {
    // Formatting applies: append group separator and inline formatting commands.
    entries.push({ separator: true });
    entries.push(editorItem('context:bold', 'Bold', 'Ctrl+B', toggleKdocMark('strong')));
    entries.push(editorItem('context:italic', 'Italic', 'Ctrl+I', toggleKdocMark('emphasis')));
    entries.push(editorItem('context:inline-code', 'Inline Code', 'Ctrl+E', toggleKdocMark('inlineCode')));
    entries.push(editorItem('context:clear-formatting', 'Clear Formatting', '', clearFormatting()));
  } else {
    // Formatting does not apply: omitted entirely to prevent noisy disabled entries.
  }

  // 3. Link group
  // Check whether the caret or selection is directly on an active link.
  if (target.onLink) {
    // On an active link: append separator and link manipulation items (Open, Edit, Remove).
    entries.push({ separator: true });
    const currentLink = activeLink(view.state);
    let initialHref = '';
    // Check if an active link was resolved at the current caret.
    if (currentLink !== null) {
      // Link resolved: record its target href for the open action.
      initialHref = currentLink.attrs.href;
    } else {
      // No link found: empty fallback href.
      initialHref = '';
    }

    entries.push(
      actionItem('context:open-link', 'Open Link', '', true, (): void => {
        const liveLink = activeLink(view.state);
        // Check if active link is still present at execution time.
        if (liveLink !== null) {
          // Active link present: follow its live href.
          options.followLink(liveLink.attrs.href);
        } else {
          // Fall back to the href recorded when the context menu opened.
          options.followLink(initialHref);
        }
      }),
    );
    entries.push(
      actionItem('context:edit-link', 'Edit Link…', '', true, (): void => {
        options.openLink();
      }),
    );
    entries.push(editorItem('context:remove-link', 'Remove Link', '', removeLink()));
  } else if (canLink(view.state)) {
    // Check if the current selection can be formatted as a new link.
    // Not on a link, but canLink is true: offer a single Add Link item.
    entries.push({ separator: true });
    entries.push(
      actionItem('context:add-link', 'Add Link…', '', true, (): void => {
        options.openLink();
      }),
    );
  } else {
    // Neither on a link nor able to link: omit link group entirely to avoid noise.
  }

  // 4. Table group
  // Check whether the caret or selection is currently inside a table.
  if (target.inTable) {
    // In a table: append group separator and table structure manipulation commands.
    entries.push({ separator: true });
    entries.push(editorItem('context:insert-row-below', 'Insert Row Below', '', addRowAfter()));
    entries.push(editorItem('context:duplicate-row', 'Duplicate Row', '', duplicateRow()));
    entries.push(editorItem('context:delete-row', 'Delete Row', '', deleteRow()));
    entries.push(editorItem('context:insert-column-right', 'Insert Column Right', '', addColumnAfter()));
    entries.push(editorItem('context:duplicate-column', 'Duplicate Column', '', duplicateColumn()));
    entries.push(editorItem('context:delete-column', 'Delete Column', '', deleteColumn()));
    entries.push(editorItem('context:sort-ascending', 'Sort Column Ascending', '', sortTableByColumn('ascending')));
    entries.push(editorItem('context:sort-descending', 'Sort Column Descending', '', sortTableByColumn('descending')));
    entries.push(editorItem('context:toggle-header-row', 'Toggle Header Row', '', toggleHeaderRow()));
    entries.push(editorItem('context:delete-table', 'Delete Table', '', deleteTable()));
  } else {
    // Not in a table: omit table group entirely to avoid noise.
  }

  // 5. Image group (FR-8.15)
  // Check whether an image is selected.
  if (target.onImage) {
    // On an image: offer editing its text and resetting its size.
    entries.push({ separator: true });
    entries.push(
      actionItem('context:edit-image', 'Edit Image…', '', true, (): void => {
        options.editImage();
      }),
    );
    entries.push(editorItem('context:widen-image', 'Widen Image', 'Alt+Shift+Right', stepImageWidth(true)));
    entries.push(editorItem('context:narrow-image', 'Narrow Image', 'Alt+Shift+Left', stepImageWidth(false)));
    entries.push(editorItem('context:reset-image-size', 'Reset Image Size', '', resetImageSize()));
  } else {
    // Not on an image: omit the image group.
  }

  return entries;
}

/**
 * Installs the right-click context menu on the K-Doc editor pane.
 *
 * @purpose Attaches a contextmenu listener to the editor pane that describes the caret target, builds entries, and opens the popup menu.
 * @inputs options: ContextMenuOptions - Configuration containing the popup menu, view, pane element, doc, and link navigation callbacks.
 * @outputs ContextMenu - Controller providing an idempotent destroy() lifecycle method.
 * @dataflow contextmenu event on pane -> preventDefault -> describeTarget -> buildEntries -> menu.openAt().
 * @controlflow Initialize AbortController -> attach contextmenu listener on pane -> return ContextMenu with idempotent destroy().
 */
export function installContextMenu(options: ContextMenuOptions): ContextMenu {
  const abortController = new AbortController();
  const signal = abortController.signal;
  let destroyed = false;

  options.pane.addEventListener(
    'contextmenu',
    async (event: MouseEvent): Promise<void> => {
      // Check whether the context menu controller has already been destroyed.
      if (destroyed) {
        // Controller is destroyed: do not handle event.
        return;
      } else {
        // Controller is active: proceed to handle contextmenu event.
      }

      // Preventing the default replaces the browser's own menu, which would otherwise
      // offer Back, Reload and View Source — none of which mean anything in a document editor.
      // Preventing the browser's own menu cannot wait on a promise, or the native menu appears first and the K-Doc menu opens underneath it.
      event.preventDefault();
      // A right-click does not select an image the way a left-click does, so select the picture under the pointer first.
      selectImageAt(options.view, event.target);

      let spelling: readonly PopupMenuEntry[] = [];
      // Check if a spelling entries provider was supplied in options.
      if (options.spellEntries !== undefined) {
        // Wrap the provider call in try/catch: a failure produces the ordinary menu rather than no menu.
        // A spell engine problem must not cost the user their copy and paste.
        try {
          spelling = await options.spellEntries();
        } catch {
          // Failure produces the ordinary menu rather than no menu.
          spelling = [];
        }
      } else {
        // No spell entries provider configured.
      }

      // Check whether the controller was destroyed while awaiting spelling entries.
      if (destroyed) {
        // Controller destroyed during async gap: do not open menu.
        return;
      } else {
        // Controller active: proceed to open menu.
      }

      // Re-read describeTarget(view) after the await, not before — the await is a real gap and the menu must describe the state it is about to act on.
      const target = describeTarget(options.view);
      const ordinaryEntries = buildEntries(options.view, target, options);

      // When the provider returns an empty array, no separator is added and the menu is exactly what it was before.
      let entries: readonly PopupMenuEntry[];
      // Check if any spelling entries were returned.
      if (spelling.length > 0) {
        // Open the popup with those entries followed by a separator followed by buildEntries(...).
        entries = [...spelling, { separator: true }, ...ordinaryEntries];
      } else {
        // Empty array or no provider: exactly what it was before without separator.
        entries = ordinaryEntries;
      }

      options.menu.openAt(event.clientX, event.clientY, entries);
    },
    { signal },
  );

  /**
   * Tears down the context menu controller, aborting event listeners on the pane.
   *
   * @purpose Idempotently aborts the event listener controller on the pane without destroying the shell-owned menu.
   * @inputs void.
   * @outputs void.
   * @dataflow destroyed flag -> abortController.abort().
   * @controlflow Check destroyed guard (return if true) -> set destroyed to true -> abort listener controller.
   */
  function destroy(): void {
    // Check whether the controller has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active controller: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    // Abort the event listeners attached to options.pane.
    abortController.abort();
    // It does not destroy options.menu, which the shell owns — whoever created a thing destroys it.
  }

  return {
    destroy,
  };
}
