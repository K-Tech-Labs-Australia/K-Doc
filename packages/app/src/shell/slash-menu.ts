/**
 * @file slash-menu.ts
 * @purpose Implements the slash (/) insert menu for the K-Doc editor pane (FR-14.4), reusing PopupMenu.
 *   Enables quick insertion and conversion of blocks via typed slash queries on empty paragraphs.
 * @inputs SlashMenuOptions containing PopupMenu instance and EditorView, editor state change notifications.
 * @outputs SlashContext descriptor, slashContextAt trigger detector, buildSlashEntries menu items factory, and installSlashMenu controller.
 * @functions
 *   - slashContextAt: Detects whether the editor caret sits in a valid slash trigger context on an empty paragraph.
 *   - buildSlashEntries: Constructs the list of PopupMenuEntry items and separators for block insertion commands.
 *   - installSlashMenu: Installs the slash menu controller monitoring editor state changes to open, filter, and close the popup menu.
 * @dataflow Caret at slash in empty paragraph -> slashContextAt -> openAt under caret -> user types query -> setFilter -> user selects entry -> tr.delete(/query) -> run block command -> view.focus().
 * @controlflow refresh() checks slashContextAt -> if null, close if opened by this controller -> if non-null and not open, openAt under caret -> if non-null and open, setFilter(query). Chosen item deletes slash text, applies command, and refocuses view.
 * @version 1
 * @date 2026-09-05
 */

import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { PopupMenu, PopupMenuEntry, PopupMenuItem } from './popup-menu.js';
import {
  setHeading,
  toggleList,
  toggleTask,
  setCodeBlock,
  toggleBlockquote,
  insertThematicBreak,
  insertTable,
} from '@k-doc/editor';

export interface SlashContext {
  /** Text typed after the slash, possibly empty. */
  readonly query: string;
  /** Document position of the slash character itself. */
  readonly from: number;
  /** Document position just after the query. */
  readonly to: number;
}

/**
 * Detects whether the editor caret sits in a valid slash menu trigger context.
 *
 * @purpose Determines if the caret is in an otherwise empty paragraph starting with a slash followed by optional word characters.
 * @inputs view: EditorView - The active ProseMirror editor view.
 * @outputs SlashContext | null - The active slash context (query, from, to) or null if the trigger condition is not met.
 * @dataflow view.state.selection -> parent node query -> textContent regex match -> SlashContext { query, from, to }.
 * @controlflow Guard empty selection -> guard paragraph parent -> match /^\/(\w*)$/ -> guard captured query -> return SlashContext or null.
 */
export function slashContextAt(view: EditorView): SlashContext | null {
  // Check whether the editor selection is non-empty.
  // A selection means the user is doing something else.
  if (!view.state.selection.empty) {
    // Selection is not empty: user is highlighting text rather than invoking a slash command.
    return null;
  } else {
    // Selection is empty: caret sits at a single cursor position.
  }

  const { $from } = view.state.selection;
  const parent = $from.parent;

  // Check whether the caret's enclosing block is a paragraph.
  // Restricting to paragraphs is deliberate: a / typed inside a heading, a table cell or a code block
  // is almost always a literal slash — a path, a date, a fraction — and an insert menu appearing over it
  // would be an interruption, not a feature.
  if (parent.type.name !== 'paragraph') {
    // Caret is inside a non-paragraph block: do not trigger the slash menu.
    return null;
  } else {
    // Enclosing block is a paragraph: inspect its text content.
  }

  const text = parent.textContent;
  const match = /^\/(\w*)$/.exec(text);

  // Check whether the paragraph text matches the slash trigger pattern of a slash followed by optional word characters.
  // Anchoring both ends is what enforces "the block was empty": as soon as any other text exists in the block,
  // the trigger stops matching and the menu closes on its own without needing a separate dismissal rule.
  if (match === null) {
    // Text contains leading/trailing non-word characters or extra text: not a slash trigger.
    return null;
  } else {
    // Text matches pattern: the paragraph was empty when the slash was typed.
  }

  const query = match[1];
  // Check whether capture group 1 was extracted under strict index access rules.
  if (query === undefined) {
    // Group 1 undefined: cannot construct valid slash context.
    return null;
  } else {
    // Group 1 defined: proceed to calculate document boundary positions.
  }

  const from = $from.start();
  const to = from + parent.textContent.length;

  return { query, from, to };
}

export interface SlashMenuOptions {
  readonly menu: PopupMenu;
  readonly view: EditorView;
}

export interface SlashMenu {
  /** Call after every editor state change; opens, filters or closes the menu as needed. */
  refresh(): void;
  destroy(): void;
}

/**
 * Constructs the popup menu entries for all block insertion actions available through the slash menu.
 *
 * @purpose Builds the ordered list of PopupMenuEntry items and separators for converting or replacing the current empty paragraph.
 * @inputs
 *   - view: EditorView - The active ProseMirror editor view.
 *   - context: SlashContext - The triggering slash context at menu invocation.
 * @outputs readonly PopupMenuEntry[] - Ordered list of menu items and visual separators.
 * @dataflow view -> insertItem helper -> fresh slashContextAt on run -> tr.delete -> command -> view.focus.
 * @controlflow Define insertItem helper -> assemble Heading 1..3, separator, Bullet/Numbered/Task lists, separator, Code Block, Quote, Table, and Divider items -> return entries array.
 */
export function buildSlashEntries(
  view: EditorView,
  context: SlashContext,
): readonly PopupMenuEntry[] {
  // The context parameter is accepted for API consistency; insertItem re-reads fresh context on execution to prevent stale mutations.
  void context;

  /**
   * Constructs a PopupMenuItem configured for slash insert commands.
   *
   * @purpose Creates a PopupMenuItem that deletes the slash trigger text before executing the associated block command.
   * @inputs
   *   - id: string - Unique menu item identifier.
   *   - label: string - User-facing display text.
   *   - hint: string - Markdown shorthand hint string.
   *   - command: Command - ProseMirror Command to execute on the cleaned paragraph.
   * @outputs PopupMenuItem - Interactive popup menu item.
   * @dataflow fresh slashContextAt(view) -> view.state.tr.delete -> command(view.state, view.dispatch) -> view.focus().
   * @controlflow Evaluate fresh slashContextAt (bail if null) -> dispatch deletion transaction -> execute command -> refocus editor view.
   */
  function insertItem(id: string, label: string, hint: string, command: Command): PopupMenuItem {
    return {
      id,
      label,
      hint,
      // enabled is always true: these are insert commands on an empty paragraph, which is the one place
      // they all apply, so a dry-run would only ever return true and checking it would be theatre.
      enabled: true,
      run(): void {
        const fresh = slashContextAt(view);

        // Re-read a fresh slashContextAt(view) rather than trusting the captured one, and bail when it is null.
        // The document may have moved on between opening the menu and choosing an item, and deleting a stale range would remove the wrong characters.
        if (fresh === null) {
          // Document moved on or selection shifted away from slash trigger: abort execution.
          return;
        } else {
          // Fresh slash context confirmed at current caret: proceed with execution.
        }

        // Each entry, when run, must first delete the /query text and then apply the block command,
        // in a single transaction so one undo reverses the whole thing. Leaving the slash text behind
        // is the classic bug in this feature — the user picks "Heading 1" and gets a heading that reads "/head".
        view.dispatch(view.state.tr.delete(fresh.from, fresh.to));

        // Run command(view.state, view.dispatch) after that dispatch, so the command sees the cleaned block.
        command(view.state, view.dispatch);

        // Call view.focus() to return focus to the editor and preserve K-Doc's edit lock invariant.
        view.focus();
      },
    };
  }

  // Entries, in this order: Heading 1, Heading 2, Heading 3 (setHeading(n)), a separator,
  // Bullet List, Numbered List, Task List, a separator, Code Block, Quote, Table (insertTable(3, 3)), Divider (insertThematicBreak()).
  // Give each a hint naming its Markdown shorthand where one exists (#, ##, ###, -, 1., - [ ], ```, >, , ---) —
  // showing the shorthand teaches the input rule, so the menu makes itself unnecessary over time.
  return [
    insertItem('slash:heading-1', 'Heading 1', '#', setHeading(1)),
    insertItem('slash:heading-2', 'Heading 2', '##', setHeading(2)),
    insertItem('slash:heading-3', 'Heading 3', '###', setHeading(3)),
    { separator: true },
    insertItem('slash:bullet-list', 'Bullet List', '-', toggleList('bullet')),
    insertItem('slash:numbered-list', 'Numbered List', '1.', toggleList('ordered')),
    insertItem('slash:task-list', 'Task List', '- [ ]', toggleTask()),
    { separator: true },
    insertItem('slash:code-block', 'Code Block', '```', setCodeBlock()),
    insertItem('slash:quote', 'Quote', '>', toggleBlockquote()),
    insertItem('slash:table', 'Table', '', insertTable(3, 3)),
    insertItem('slash:divider', 'Divider', '---', insertThematicBreak()),
  ];
}

/**
 * Installs the slash insert menu controller, monitoring editor caret state to manage popup menu lifecycle.
 *
 * @purpose Wires editor state transitions to the slash popup menu, opening, filtering, and dismissing it based on SlashContext.
 * @inputs options: SlashMenuOptions - Options containing the PopupMenu instance and the target EditorView.
 * @outputs SlashMenu - Controller object exposing refresh() and destroy() methods.
 * @dataflow Editor state change -> refresh() -> slashContextAt -> menu.openAt / menu.setFilter / menu.close.
 * @controlflow Tracks openedByThis state -> refresh opens or filters menu when in slash context, closes if caret left -> destroy cleans up on unmount.
 */
export function installSlashMenu(options: SlashMenuOptions): SlashMenu {
  let openedByThis: boolean = false;
  let destroyed: boolean = false;

  /**
   * Refreshes the slash menu against the current editor state under the caret.
   *
   * @purpose Opens, filters, or closes the popup menu depending on whether a valid slash context exists at the caret.
   * @inputs void.
   * @outputs void.
   * @dataflow options.view -> slashContextAt -> menu.openAt / menu.setFilter / menu.close.
   * @controlflow Check destroyed guard -> query slashContextAt -> if null, close menu only if opened by this controller -> if non-null and already open, setFilter -> if non-null and not open, compute coords and openAt.
   */
  function refresh(): void {
    // Check whether the slash menu controller has already been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore refresh request.
      return;
    } else {
      // Controller is active: evaluate current caret slash context.
    }

    const context = slashContextAt(options.view);

    // Check whether a valid slash trigger context is present under the caret.
    if (context === null) {
      // When null: close the menu only if it is open, and return.
      // Closing unconditionally would fight the context menu, which shares this popup —
      // the slash menu must not close a menu it did not open.
      if (openedByThis && options.menu.isOpen) {
        // Menu was opened by this controller and is currently open: close it.
        openedByThis = false;
        options.menu.close();
      } else {
        // Menu is not open or was opened by another controller (e.g. context menu): leave it untouched.
        openedByThis = false;
      }
      return;
    } else {
      // Valid slash context detected: proceed to open or filter the menu.
    }

    // Check whether the popup menu was already opened by this controller.
    if (openedByThis && options.menu.isOpen) {
      // When non-null and the menu is already open: call options.menu.setFilter(context.query).
      options.menu.setFilter(context.query);
    } else {
      // When non-null and the menu is not open: compute caret coordinates with options.view.coordsAtPos(context.from)
      // and call options.menu.openAt(coords.left, coords.bottom, buildSlashEntries(...)).
      // Using bottom rather than top puts the menu under the caret instead of over the text being typed.
      const coords = options.view.coordsAtPos(context.from);
      openedByThis = true;
      options.menu.openAt(
        coords.left,
        coords.bottom,
        buildSlashEntries(options.view, context),
      );
    }
  }

  /**
   * Tears down the slash menu controller.
   *
   * @purpose Idempotently closes the popup menu if this controller opened it without destroying the shell-owned menu.
   * @inputs void.
   * @outputs void.
   * @dataflow destroyed = true -> close menu if openedByThis.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> close popup menu if opened by this controller.
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

    // Check whether the popup menu was opened by this controller and is currently open.
    // destroy() is idempotent, closes the menu if this controller opened it, and does not destroy the menu itself — the shell owns it.
    if (openedByThis && options.menu.isOpen) {
      // Close the menu if this controller opened it.
      openedByThis = false;
      options.menu.close();
    } else {
      // Menu was not opened by this controller or already closed.
      openedByThis = false;
    }
  }

  return {
    refresh,
    destroy,
  };
}
