/**
 * @file keymap.ts
 * @purpose Creates the keymap plugins for the K-Doc pane, binding formatting commands, session-owned history, and base editing behaviour.
 *
 *   IMPORTANT ARCHITECTURAL NOTE: Undo and redo are bound to the DocumentSession, not to ProseMirror.
 *   prosemirror-history is deliberately not imported. Installing it would create a second undo stack that
 *   knows only about this pane, so Ctrl+Z would mean different things depending on which pane had focus
 *   and would not survive a pane switch — exactly the confusion the session-owned history exists to prevent (FR-3.5).
 *
 * @inputs KdocKeymapOptions containing the authoritative DocumentSession and optional Schema.
 * @outputs An array of three ProseMirror keymap plugins in priority order: K-Doc formatting shortcuts, list editing, and base editing fallback.
 * @functions
 *   - createKdocKeymap: Constructs the complete keymap plugin array for the K-Doc editor pane.
 * @dataflow User keyboard event -> ProseMirror keymap dispatch -> K-Doc Command / DocumentSession action / base editing fallback.
 * @controlflow K-Doc keymap plugin (first priority) -> List keymap plugin (second priority) -> Base keymap plugin (fallback).
 * @version 2
 * @date 2026-09-18
 */

import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { Plugin, Command, EditorState, Transaction } from 'prosemirror-state';
import type { NodeType, Schema } from 'prosemirror-model';
import type { DocumentSession } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { activeLink, canLink, type LinkRange } from './link.js';
import { insertTable } from './table.js';
import { moveBlockUp, moveBlockDown, promoteHeading, demoteHeading } from './structure.js';
import { addNextOccurrence } from './multi-caret-occurrence.js';
import { clearCarets } from './multi-caret-plugin.js';
import { goToNextCell } from './table-columns.js';
import { stepImageWidth } from './image-commands.js';
import { undoInputRule } from 'prosemirror-inputrules';
import { createKdocInputRules } from './input-rules.js';
import {
  clearFormatting,
  insertThematicBreak,
  setCodeBlock,
  setHeading,
  setParagraph,
  toggleBlockquote,
  toggleKdocMark,
  toggleList,
  toggleTask,
} from './commands.js';

/**
 * Options for configuring K-Doc's ProseMirror keymaps.
 */
export interface KdocKeymapOptions {
  /**
   * The authoritative DocumentSession instance owning the document undo/redo history.
   */
  readonly session: DocumentSession;

  /**
   * Optional ProseMirror schema to resolve node and mark types against.
   * Defaults to `kdocSchema` when omitted.
   */
  readonly schema?: Schema;

  /**
   * When true, the shortcuts the host binds itself through its remappable keymap are left out, so a key the user
   * moved stops doing its old job here. Undo and redo stay: letting the browser's own undo run on the editor would
   * edit the DOM behind ProseMirror's back. Defaults to false.
   */
  readonly hostOwnsShortcuts?: boolean;

  /**
   * Invoked when the user presses the link shortcut, carrying the link under the caret when there is one.
   *
   * The dialog itself lives in the app package: this package stays DOM-free, so it can only ask for
   * a link, never draw the box that collects one.
   */
  readonly onRequestLink?: (current: LinkRange | null) => void;
}

/**
 * @purpose ProseMirror command that replaces the current selection with a hardBreak node when present in the schema.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state containing document schema and transaction.
 *   - dispatch: ((tr: Transaction) => void) | undefined - Optional transaction dispatch callback.
 * @outputs boolean - True if hardBreak node type exists in schema and command applies; false otherwise.
 * @dataflow state.schema.nodes['hardBreak'] lookup -> state.tr.replaceSelectionWith(hardBreakType.create()) -> dispatch(tr).
 * @controlflow Resolve hardBreak node type -> if missing, return false -> if dispatch provided, replace selection with hardBreak node -> return true.
 */
function insertHardBreak(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const hardBreakType = state.schema.nodes['hardBreak'];
  // Check if hardBreak node type exists in the document schema.
  // Shift+Enter is the hard-break gesture users expect, and exitCode first lets it escape
  // a code block rather than inserting a break inside one.
  if (hardBreakType === undefined) {
    // hardBreak node type is missing from schema: command cannot apply.
    return false;
  } else {
    // hardBreak node type resolved: proceed with replacement on dispatch.
  }

  // Check if dispatch callback was provided.
  if (dispatch !== undefined) {
    // Dispatch callback provided: replace selection with a new hardBreak node and dispatch transaction.
    dispatch(state.tr.replaceSelectionWith(hardBreakType.create()));
  } else {
    // Dry-run query: return true indicating hard break insertion is supported.
  }

  return true;
}

/**
 * @purpose Creates a ProseMirror command that invokes a DocumentSession action and unconditionally returns true.
 * @inputs run: () => unknown - The session action callback to execute (e.g. undo or redo).
 * @outputs Command - A ProseMirror command executing the callback and returning true.
 * @dataflow run() execution -> returns true.
 * @controlflow Invokes run() callback -> unconditionally returns true.
 */
function sessionCommand(run: () => unknown): Command {
  // It returns true even when the session had nothing to undo, because returning false would
  // let the keystroke fall through to the browser's own undo, which would edit the DOM behind
  // ProseMirror's back — a far worse outcome than a no-op.
  return (): boolean => {
    run();
    return true;
  };
}

/**
 * Bindings a host that dispatches K-Doc's remappable shortcuts itself takes over (FR-14.16). Structural keys --
 * Enter, Backspace, Tab in tables and lists, Shift-Enter, Escape -- and Mod-d are not in the §20 table and stay.
 */
export const HOST_OWNED_KEYS: readonly string[] = [
  'Mod-b', 'Mod-i', 'Mod-Shift-x', 'Mod-e', 'Mod-Alt-h', 'Mod-=', 'Mod-Shift-=', 'Mod-Space', 'Mod-Alt-0', 'Mod-Alt-c',
  'Mod-Shift-q', 'Mod-Shift-8', 'Mod-Shift-7', 'Mod-Shift-9', 'Mod-k', 'Mod-Shift-Minus', 'Mod-Alt-t',
  'Alt-ArrowUp', 'Alt-ArrowDown', 'Mod-Alt-ArrowLeft', 'Mod-Alt-ArrowRight',
  'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4', 'Mod-Alt-5', 'Mod-Alt-6',
];

/**
 * @purpose Constructs the complete keymap plugin array for the K-Doc editor pane.
 * @inputs options: KdocKeymapOptions - Configuration options containing the authoritative DocumentSession and optional Schema.
 * @outputs readonly Plugin[] - An array of three ProseMirror keymap plugins in priority order (K-Doc formatting, list editing, base keymap).
 * @dataflow options -> resolve schema -> build K-Doc bindings -> build list keymap -> combine with baseKeymap -> readonly Plugin[].
 * @controlflow Resolve schema (defaulting to kdocSchema) -> construct K-Doc keymap -> construct list keymap -> return [kdocPlugin, listPlugin, basePlugin].
 */
export function createKdocKeymap(options: KdocKeymapOptions): readonly Plugin[] {
  // The schema defaults to kdocSchema when options.schema is absent.
  const schema = options.schema ?? kdocSchema;

  // Plugin 1: The K-Doc formatting, structure, line break, and session history bindings.
  const kdocBindings: Record<string, Command> = {
    // Inline formatting mark shortcuts.
    'Mod-b': toggleKdocMark('strong'),
    'Mod-i': toggleKdocMark('emphasis'),
    'Mod-Shift-x': toggleKdocMark('strikethrough'),
    'Mod-e': toggleKdocMark('inlineCode'),
    // Subscript and superscript follow Word's chords; highlight has no Word equivalent, so it takes
    // the shortcut the specification names for it.
    'Mod-Alt-h': toggleKdocMark('highlight'),
    'Mod-=': toggleKdocMark('subscript'),
    'Mod-Shift-=': toggleKdocMark('superscript'),

    // Formatting removal shortcut.
    'Mod-Space': clearFormatting(),

    // Block type transformation shortcuts.
    'Mod-Alt-0': setParagraph(),
    'Mod-Alt-c': setCodeBlock(),

    // Block quote and list formatting shortcuts.
    'Mod-Shift-q': toggleBlockquote(),
    'Mod-Shift-8': toggleList('bullet'),
    'Mod-Shift-7': toggleList('ordered'),
    'Mod-Shift-9': toggleTask(),

    // Link shortcut: asks the host to collect a URL for the selection or the link under the caret.
    'Mod-k': (state): boolean => {
      const requestLink = options.onRequestLink;
      // Check whether a host is listening for link requests and a link is possible here.
      // Returning false when nothing is listening lets the keystroke fall through rather than
      // swallowing it into a shortcut that visibly does nothing.
      if (requestLink === undefined || !canLink(state)) {
        // No host handler, or a bare caret in plain text with nothing to link: decline the binding.
        return false;
      } else {
        // A link can be created or edited here: ask the host to collect the target.
        requestLink(activeLink(state));
        return true;
      }
    },

    // Add a caret at the next occurrence of the word under the caret (FR-7.2). The first press
    // selects the word, the second starts adding -- which is what every other editor does, and it
    // gives the user something to look at before anything is duplicated. Returning false when there
    // is nothing to match lets the keystroke fall through rather than silently doing nothing.
    'Mod-d': addNextOccurrence(),

    // Escape puts the editor back to one caret. It is bound here as well as in the plugin's own
    // handleKeyDown so the shortcut is discoverable in the keymap; the command declines when there
    // are no extra carets, so Escape keeps whatever else it does.
    Escape: clearCarets(),

    // Thematic break (horizontal rule) shortcut.
    'Mod-Shift-Minus': insertThematicBreak(),

    // Table insertion, and Tab/Shift-Tab for cell navigation. These are bound in plugin 1 rather
    // than plugin 2 so that they win over list indentation, and goToNextCell returns false outside
    // a table, which lets Tab fall straight through to sinkListItem exactly as before.
    'Mod-Alt-t': insertTable(3, 3),

    // Block movement and heading level (FR-8.27, FR-8.28). Right demotes and Left promotes, matching
    // the direction the outline indents: deeper on the right, shallower on the left.
    'Alt-ArrowUp': moveBlockUp(),
    'Alt-ArrowDown': moveBlockDown(),
    'Mod-Alt-ArrowLeft': promoteHeading(),
    'Mod-Alt-ArrowRight': demoteHeading(),

    // Resizing a selected picture from the keyboard (FR-8.15), so a reader who cannot aim a drag handle
    // can still size one. These live in the editor's own keymap rather than in the remappable table
    // because stepImageWidth returns false when no picture is selected, and a key bound there would be
    // claimed before anything could say so: Alt+Shift+Right would stop working everywhere else.
    'Alt-Shift-ArrowRight': stepImageWidth(true),
    'Alt-Shift-ArrowLeft': stepImageWidth(false),
    // Backspace immediately after an input rule fired undoes the rule rather than deleting a
    // character, so typing `# ` and changing your mind gets the literal `# ` back. It returns false
    // when no rule just fired, which lets Backspace fall through to its ordinary meaning.
    Backspace: undoInputRule,
    Tab: goToNextCell(1),
    'Shift-Tab': goToNextCell(-1),

    // Hard line break shortcut: exit code block if inside one, otherwise insert hard break.
    'Shift-Enter': chainCommands(exitCode, insertHardBreak),

    // Session-owned undo and redo shortcuts.
    'Mod-z': sessionCommand((): void => {
      options.session.undo();
    }),
    'Mod-y': sessionCommand((): void => {
      options.session.redo();
    }),
    'Mod-Shift-z': sessionCommand((): void => {
      options.session.redo();
    }),
  };

  // Generate heading shortcuts Mod-Alt-1 through Mod-Alt-6 in a loop rather than written out six times.
  for (let level = 1; level <= 6; level++) {
    kdocBindings[`Mod-Alt-${level}`] = setHeading(level);
  }

  // The keys a host keymap owns (spec §20), removed when the host dispatches them itself.
  if (options.hostOwnsShortcuts === true) {
    for (const key of HOST_OWNED_KEYS) {
      delete kdocBindings[key];
    }
  } else {
    // The editor on its own keeps every binding.
  }

  const kdocKeymapPlugin = keymap(kdocBindings);

  // Plugin 2: List editing keymap.
  // Resolve listItem from the schema. When it is absent, return an empty keymap rather than crashing.
  // A schema without list items simply gets no list bindings rather than a crash.
  const listItemType: NodeType | undefined = schema.nodes['listItem'];
  let listKeymapPlugin: Plugin;
  if (listItemType !== undefined) {
    // listItem node type exists: bind list item split, sink, and lift commands.
    // Enter is bound here rather than in plugin 1 so that it falls through to the base keymap's
    // paragraph split when the caret is not in a list, which is what keymap does when a command returns false.
    listKeymapPlugin = keymap({
      Enter: splitListItem(listItemType),
      Tab: sinkListItem(listItemType),
      'Shift-Tab': liftListItem(listItemType),
    });
  } else {
    // listItem node type is absent: return empty keymap so editor functions without crashing.
    listKeymapPlugin = keymap({});
  }

  // Plugin 3: Base editing keymap.
  // This supplies Enter, Backspace, Delete, and the arrow-key selection behaviour.
  // Without it the pane cannot even create a new paragraph — the binding previously created its state
  // with no plugins at all, so Enter did nothing.
  const baseKeymapPlugin = keymap(baseKeymap);

  // Return plugins in strict priority order:
  // 1. K-Doc keymap first so its formatting and session shortcuts win.
  // 2. List keymap second so list splitting/indentation intercepts Enter/Tab inside list items.
  // 3. Base keymap last as the fallback for Enter (paragraph split), Backspace, Delete, and arrow keys.
  // The input-rules plugin sits ahead of every keymap because it reacts to text insertion rather
  // than to keys; ordering it here keeps a single place assembling the pane's plugin array.
  const inputRulesPlugin = createKdocInputRules({ schema });

  return [inputRulesPlugin, kdocKeymapPlugin, listKeymapPlugin, baseKeymapPlugin];
}
