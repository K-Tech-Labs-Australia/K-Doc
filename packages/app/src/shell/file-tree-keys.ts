/**
 * @file file-tree-keys.ts
 * @purpose Maps a key press in the vault file tree (FR-6.11) to a single command value so the panel's key handling is one table rather than a tangle of listeners.
 * @inputs A TreeKey describing the pressed key and modifier state from an incoming keyboard event.
 * @outputs A TreeKeyCommand describing the intended action, or null when the press maps to no tree command.
 * @functions
 *   - treeKeyCommand: Resolves a TreeKey into a TreeKeyCommand or null.
 * @dataflow Keyboard event fields (key + modifiers) → treeKeyCommand branch checks → resolved TreeKeyCommand | null.
 * @controlflow Reject Alt combinations first; then test each key against its modifier constraints in order; return the first match, else null.
 * @version 1
 * @date 2026-09-14
 */

export interface TreeKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export type TreeKeyCommand =
  | { readonly type: 'move'; readonly delta: number; readonly extend: boolean }
  | { readonly type: 'first' }
  | { readonly type: 'last' }
  | { readonly type: 'expand' }
  | { readonly type: 'collapse' }
  | { readonly type: 'open' }
  | { readonly type: 'rename' }
  | { readonly type: 'trash' }
  | { readonly type: 'selectAll' };

/**
 * Resolves a file-tree key press into the command it should trigger.
 * @purpose Translates raw keyboard modifier state into a single declarative TreeKeyCommand for the panel to dispatch.
 * @inputs event - The pressed key and its modifier flags as captured from the keyboard event.
 * @outputs A TreeKeyCommand describing the action, or null when the press belongs to window/menu handling instead of the tree.
 * @dataflow event.key and event modifiers → ordered if/else branch evaluation → matched command shape or null.
 * @controlflow Early-return on Alt (reserved for menus); compute primary modifier; test each key with its guard conditions in order; fall through to null when nothing matches.
 */
export function treeKeyCommand(event: TreeKey): TreeKeyCommand | null {
  // Alt combinations are owned by the window chrome and menus, never the tree.
  if (event.altKey) {
    return null;
  } else {
    const primary = event.ctrlKey || event.metaKey;

    // Move selection down one row, optionally extending the current selection with Shift.
    if (event.key === 'ArrowDown') {
      return { type: 'move', delta: 1, extend: event.shiftKey };
    } else if (event.key === 'ArrowUp') {
      return { type: 'move', delta: -1, extend: event.shiftKey };
    } else if (event.key === 'Home' && !primary) {
      // Jump to the first row; Ctrl/Meta Home is reserved for other actions.
      return { type: 'first' };
    } else if (event.key === 'End' && !primary) {
      // Jump to the last row; Ctrl/Meta End is reserved for other actions.
      return { type: 'last' };
    } else if (event.key === 'ArrowRight' && !event.shiftKey && !primary) {
      // Expand the current node; Shift-ArrowRight moves selection instead, and primary is reserved.
      return { type: 'expand' };
    } else if (event.key === 'ArrowLeft' && !event.shiftKey && !primary) {
      // Collapse the current node; Shift-ArrowLeft moves selection instead, and primary is reserved.
      return { type: 'collapse' };
    } else if (event.key === 'Enter' && !event.shiftKey && !primary) {
      // Open the selected item; Shift/Enter combos are reserved for other actions.
      return { type: 'open' };
    } else if (event.key === 'F2' && !event.shiftKey && !primary) {
      // Begin renaming the selected item; primary modifiers are reserved.
      return { type: 'rename' };
    } else if (event.key === 'Delete' && !event.shiftKey && !primary) {
      // Move the selected item to trash; primary modifiers are reserved.
      return { type: 'trash' };
    } else if ((event.key === 'a' || event.key === 'A') && primary && !event.shiftKey) {
      // Select all with Ctrl/Meta-A and no Shift; Shift is excluded to avoid conflicting shortcuts.
      return { type: 'selectAll' };
    } else {
      // No tree command applies to this press; leave it for default handling.
      return null;
    }
  }
}
