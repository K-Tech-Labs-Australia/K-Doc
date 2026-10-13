/**
 * @file keymap.ts
 * @purpose Creates the CodeMirror keymap for K-Doc's Source pane, binding undo and redo to the shared DocumentSession rather than to CodeMirror's own history.
 *
 *   K-Doc's undo history is owned by the DocumentSession and shared by both panes (FR-3.5), so that
 *   Ctrl+Z means the same thing wherever the caret happens to be and an undo survives a pane switch. The
 *   K-Doc side already honours that: prosemirror-history is deliberately never imported, and
 *   prosemirror/keymap.ts binds Mod-z straight to session.undo().
 *
 *   The Source pane previously installed history() and historyKeymap from @codemirror/commands,
 *   which is a second, pane-local undo stack. Ctrl+Z in the Source pane rewound CodeMirror's own edit
 *   log, that rewind reached the session as a fresh edit rather than as an undo, and so the shared
 *   history grew instead of shrinking. Undo therefore meant one thing in one pane and something else in the
 *   other — exactly the divergence the session-owned history exists to prevent. This file replaces that
 *   stack.
 *
 * @inputs CodeMirrorKeymapOptions containing the authoritative DocumentSession.
 * @outputs CodeMirror Extension configuring session-aware key bindings and default editing keymaps.
 * @functions
 *   - createSourceKeymap: Constructs the CodeMirror keymap extension for K-Doc's Source editor pane.
 * @dataflow User keyboard event -> CodeMirror keymap dispatch -> DocumentSession action / default command fallback.
 * @controlflow Session-owned undo/redo bindings at high precedence (Prec.high) -> defaultKeymap fallback.
 * @version 1
 * @date 2026-09-05
 */

import { Prec, type Extension } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { keymap, type Command, type EditorView, type KeyBinding } from '@codemirror/view';
import type { DocumentSession } from '@k-doc/core';

/**
 * Options for configuring K-Doc's CodeMirror keymaps.
 */
export interface CodeMirrorKeymapOptions {
  /**
   * The authoritative DocumentSession instance owning the document undo/redo history.
   */
  readonly session: DocumentSession;
}

/**
 * @purpose Creates a CodeMirror command executing a DocumentSession action and unconditionally returning true.
 * @inputs action: () => void - The session action callback to execute (e.g. undo or redo).
 * @outputs Command - A CodeMirror command callback `(view: EditorView) => boolean`.
 * @dataflow action() execution -> returns true.
 * @controlflow Invokes action() callback -> unconditionally returns true.
 */
function sessionCommand(action: () => void): Command {
  // It returns true unconditionally even when the session had nothing to undo or redo.
  // Returning false when there is nothing to undo lets the keystroke fall through to the
  // browser's own undo, which would edit the DOM behind CodeMirror's back and desync
  // the view from the document. A no-op that reports success is the correct behaviour here.
  // The helper ignores its view argument: the session, not the view, is the authority.
  return (_view: EditorView): boolean => {
    action();
    return true;
  };
}

/**
 * @purpose Constructs the CodeMirror keymap extension for K-Doc's Source editor pane.
 * @inputs options: CodeMirrorKeymapOptions - Configuration options containing the authoritative DocumentSession.
 * @outputs Extension - A CodeMirror extension containing session undo/redo bindings and default keymap at high precedence.
 * @dataflow options.session -> sessionCommand callbacks -> keymap KeyBinding array -> Prec.high -> Extension.
 * @controlflow Define session keybindings (Mod-z, Mod-y, Mod-Shift-z) -> combine with defaultKeymap -> wrap in Prec.high -> return extension.
 */
export function createSourceKeymap(options: CodeMirrorKeymapOptions): Extension {
  // The session bindings array binds undo and redo shortcuts to the shared DocumentSession.
  const sessionBindings: readonly KeyBinding[] = [
    {
      key: 'Mod-z',
      run: sessionCommand((): void => {
        options.session.undo();
      }),
      preventDefault: true,
    },
    {
      key: 'Mod-y',
      run: sessionCommand((): void => {
        options.session.redo();
      }),
      preventDefault: true,
    },
    {
      key: 'Mod-Shift-z',
      run: sessionCommand((): void => {
        options.session.redo();
      }),
      preventDefault: true,
    },
  ];

  // Wrap in Prec.high so that the session bindings take precedence over anything else
  // that would otherwise handle Mod-z (such as default keybindings registered elsewhere).
  // Without Prec.high, CodeMirror's default bindings could win for the same key.
  return Prec.high(keymap.of([...sessionBindings, ...defaultKeymap]));
}
