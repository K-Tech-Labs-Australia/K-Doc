/**
 * @file multi-caret-plugin.ts
 * @purpose ProseMirror plugin enabling multi-caret editing in K-Doc's WYSIWYG pane (FR-7.2).
 *   Manages extra caret positions, zero-width widget decorations, mouse click toggles, text insertions, and deletions.
 *   Note: This plugin must be installed before the keymap plugins, because handleKeyDown is consulted in plugin
 *   order and a Backspace reaching the base keymap first would delete at the primary caret only.
 * @inputs ProseMirror EditorState instances, Transactions, mouse clicks, text input, and keyboard events.
 * @outputs ProseMirror Plugin instance, CSS stylesheets for caret rendering, and multi-caret command factories.
 * @functions
 *   - extraCarets: Retrieves the list of active extra caret positions from the editor state.
 *   - addCaret: Command factory that adds or toggles an extra caret at the given document position.
 *   - clearCarets: Command factory that clears all active extra carets, collapsing back to a single primary caret.
 *   - createMultiCaretPlugin: Creates the ProseMirror plugin managing multi-caret editing, decorations, and input handling.
 * @dataflow Clicks / typing / key events -> Plugin handlers -> multi-caret transactions -> Plugin state updates -> DecorationSet.
 * @controlflow Initialize EMPTY_MULTI_CARET -> on transaction apply: handle clear, toggle, or mapping/deduplication -> decorations renders caret DOM widgets -> handleClick/handleTextInput/handleKeyDown handle interactions.
 * @version 1
 * @date 2026-09-12
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  EMPTY_MULTI_CARET,
  mapCarets,
  toggleCaret,
  insertAtCarets,
  deleteAtCarets,
  type MultiCaretState,
} from './multi-caret-state.js';

/**
 * CSS class name applied to extra caret DOM widget elements (FR-7.2).
 */
export const MULTI_CARET_CLASS: string = 'kdoc-multi-caret';

/**
 * CSS stylesheet defining the multi-caret visual appearance and blinking animation (FR-7.2).
 *
 * Design decisions:
 * - Paints the caret as a 1px-wide, 1.2em-tall inline-block with background: currentColor.
 * - vertical-align: text-bottom aligns the caret line with the surrounding text baseline.
 * - user-select: none prevents the caret line widget from participating in text selections.
 * - pointer-events: none is what stops the painted caret swallowing the click that would place a caret next to it.
 * - animation: kdoc-caret-blink at 1s step-end infinite alternates between opacity 1 and 0.
 */
export const MULTI_CARET_STYLES: string = `
@keyframes kdoc-caret-blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.${MULTI_CARET_CLASS} {
  display: inline-block;
  width: 1px;
  height: 1.2em;
  background: currentColor;
  vertical-align: text-bottom;
  user-select: none;
  /* pointer-events: none is what stops the painted caret swallowing the click that would place a caret next to it. */
  pointer-events: none;
  animation: kdoc-caret-blink 1s step-end infinite;
}
`;

/**
 * Plugin key uniquely identifying the multi-caret plugin and its state in an EditorState.
 */
export const multiCaretPluginKey: PluginKey<MultiCaretState> = new PluginKey<MultiCaretState>('multiCaretPlugin');

/**
 * Constructs the DOM span element for rendering an extra caret widget (FR-7.2).
 *
 * @purpose Creates a detached, non-editable, zero-width span element styled as a blinking caret line.
 * @inputs None.
 * @outputs HTMLElement - The configured span element representing the caret line.
 * @dataflow None.
 * @controlflow Create span -> assign className -> set contenteditable false -> set aria-hidden true -> return span.
 */
function caretDom(): HTMLElement {
  const span: HTMLElement = document.createElement('span');
  span.className = MULTI_CARET_CLASS;
  // contenteditable is set via setAttribute (never the property) because jsdom does not reflect it as an IDL attribute.
  span.setAttribute('contenteditable', 'false');
  // aria-hidden ensures the painted caret line is invisible to assistive technologies.
  span.setAttribute('aria-hidden', 'true');
  // Deliberately no text content: a caret is a painted line, not a character, and a widget with text in it would be text the document does not contain.
  return span;
}

/**
 * Executes a backward or forward deletion across all carets if extra carets exist.
 *
 * @purpose Deletes characters at primary and extra carets for Backspace or Delete key events.
 * @inputs
 *   - view: EditorView - The active ProseMirror editor view.
 *   - direction: -1 | 1 - The deletion direction (-1 for Backspace, 1 for Delete).
 * @outputs boolean - True if a multi-caret deletion transaction was dispatched, false to fall back to default handler.
 * @dataflow view.state + direction -> extraCarets -> deleteAtCarets -> view.dispatch(tr) -> boolean.
 * @controlflow Query extra carets -> call deleteAtCarets -> check if result is null -> if null return false; else dispatch transaction and return true.
 */
function applyDelete(view: EditorView, direction: -1 | 1): boolean {
  const extras: readonly number[] = extraCarets(view.state);
  const tr: Transaction | null = deleteAtCarets(view.state, extras, direction);
  // Check whether deleteAtCarets returned a valid deletion transaction.
  if (tr === null) {
    // When the result is null, return false so the ordinary single-caret command handles the deletion.
    return false;
  } else {
    // Transaction built: dispatch across all carets and return true to consume the key event.
    view.dispatch(tr);
    return true;
  }
}

/**
 * Retrieves the list of active extra caret positions from the editor state.
 *
 * @purpose Queries the multi-caret plugin state and returns extra positions, or an empty array if inactive.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state to query.
 * @outputs readonly number[] - Array of extra caret document positions, or empty array if uninitialized.
 * @dataflow state -> multiCaretPluginKey.getState -> extras ?? [].
 * @controlflow Read plugin state from editor state -> return extras array if present, or empty array fallback.
 */
export function extraCarets(state: EditorState): readonly number[] {
  return multiCaretPluginKey.getState(state)?.extras ?? [];
}

/**
 * Command factory that adds or toggles an extra caret at the given document position.
 *
 * @purpose Dispatches a transaction attaching multi-caret toggle metadata for the specified position.
 * @inputs
 *   - pos: number - The document position at which to toggle an extra caret.
 * @outputs Command - A ProseMirror command returning true, and dispatching transaction if dispatch is provided.
 * @dataflow pos -> tr.setMeta(multiCaretPluginKey, pos) -> dispatch(tr).
 * @controlflow Check if dispatch is provided -> if present, attach meta and dispatch -> return true.
 */
export function addCaret(pos: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Check whether a dispatch callback was provided for this command execution.
    if (dispatch !== undefined) {
      // Dispatch provided: attach position metadata to transaction and dispatch.
      dispatch(state.tr.setMeta(multiCaretPluginKey, pos));
    } else {
      // Dry run without dispatch: return true indicating command is applicable.
    }
    return true;
  };
}

/**
 * Command factory that clears all active extra carets, collapsing back to a single primary caret.
 *
 * @purpose Dispatches a transaction with 'clear' metadata if extra carets exist, or returns false to allow fallthrough.
 * @inputs None.
 * @outputs Command - A ProseMirror command returning true if carets were cleared, or false if no extras exist.
 * @dataflow state -> extraCarets -> check emptiness -> tr.setMeta(multiCaretPluginKey, 'clear') -> dispatch(tr).
 * @controlflow Query extras -> if empty, return false -> if dispatch provided, dispatch clear transaction -> return true.
 */
export function clearCarets(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const extras: readonly number[] = extraCarets(state);
    // Check whether any extra carets are active.
    if (extras.length === 0) {
      // Nothing to do: return false so a keymap can fall through.
      return false;
    } else {
      // Extra carets exist: check whether dispatch is provided.
      if (dispatch !== undefined) {
        // Dispatch clear metadata to collapse back to one caret.
        dispatch(state.tr.setMeta(multiCaretPluginKey, 'clear'));
      } else {
        // Dry run without dispatch: return true indicating carets can be cleared.
      }
      return true;
    }
  };
}

/**
 * Creates the ProseMirror plugin that manages multi-caret editing in the WYSIWYG pane (FR-7.2).
 *
 * @purpose Instantiates the plugin handling extra caret state, decoration rendering, mouse clicks, and multi-caret typing/deletion.
 * @inputs None.
 * @outputs Plugin<MultiCaretState> - Configured ProseMirror Plugin instance.
 * @dataflow User clicks / typing / key events -> Plugin handlers -> multi-caret transactions -> Plugin state updates -> DecorationSet.
 * @controlflow Initialize EMPTY_MULTI_CARET -> on transaction apply: handle clear, toggle, or mapping/deduplication -> decorations renders caret DOM widgets -> handleClick/handleTextInput/handleKeyDown handle interactions.
 */
export function createMultiCaretPlugin(): Plugin<MultiCaretState> {
  return new Plugin<MultiCaretState>({
    key: multiCaretPluginKey,
    state: {
      init(): MultiCaretState {
        // Initialize multi-caret state with empty extra carets.
        return EMPTY_MULTI_CARET;
      },
      apply(tr: Transaction, value: MultiCaretState, _old: EditorState, newState: EditorState): MultiCaretState {
        const meta: unknown = tr.getMeta(multiCaretPluginKey);

        // Check whether transaction metadata signals an explicit clear request.
        if (meta === 'clear') {
          // Escape and any ordinary click put the editor back to one caret, and a stale extra caret would type somewhere the user is no longer looking.
          return EMPTY_MULTI_CARET;
        } else {
          // Check whether transaction metadata is a numeric document position to toggle.
          if (typeof meta === 'number') {
            // Map existing carets first through transaction mapping, then toggle the clicked position.
            // The position came from a click against the document as it is now, so mapping before toggling ensures correct coordinates.
            return toggleCaret(mapCarets(value, tr.mapping), meta);
          } else {
            // Otherwise, map carets through tr.mapping and drop any extra that has landed on the primary selection head.
            // A caret that is also the selection would apply every edit twice, which is the invariant the state module documents.
            const mapped: MultiCaretState = mapCarets(value, tr.mapping);
            const primaryHead: number = newState.selection.from;
            const remaining: readonly number[] = mapped.extras.filter(
              (pos: number): boolean => pos !== primaryHead,
            );
            return { extras: remaining };
          }
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        const extras: readonly number[] = extraCarets(state);
        // Check whether any extra carets are currently active.
        if (extras.length === 0) {
          // No extra carets active: return empty decoration set.
          return DecorationSet.empty;
        } else {
          // Extra carets active: construct zero-width widget decorations for each extra position.
        }

        const decorations: Decoration[] = [];

        // Iterate through extra caret positions to create widget decorations.
        for (let i = 0; i < extras.length; i++) {
          const pos: number | undefined = extras[i];
          // Check if the position at index i is defined to satisfy strict noUncheckedIndexedAccess.
          if (pos === undefined) {
            // Undefined position: skip iteration.
            continue;
          } else {
            // Defined position: verify document boundaries.
          }

          // No bounds check. A widget decoration past the end of the document was guarded against here
          // on the belief that ProseMirror throws on one; it does not -- DecorationSet.create accepts it,
          // the set reports holding it, and the view mounts without complaint. It simply paints nothing.
          // The guard could not change any outcome, and a guard whose stated reason is untrue is worse
          // than no guard: it claims something about the code that is not so. The behaviour it relied on
          // is pinned by a test instead.
          decorations.push(
            Decoration.widget(
              pos,
              (): HTMLElement => caretDom(),
              { side: -1, key: `kdoc-caret-${pos}` },
            ),
          );
        }

        return DecorationSet.create(state.doc, decorations);
      },
      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        // Check whether the click is an ordinary click without Ctrl or Meta modifier keys.
        if (!event.ctrlKey && !event.metaKey) {
          // Ordinary click without modifier keys: check if extra carets exist to clear.
          if (extraCarets(view.state).length > 0) {
            // Clearing first is what stops the old carets surviving a click elsewhere.
            view.dispatch(view.state.tr.setMeta(multiCaretPluginKey, 'clear'));
          } else {
            // No extra carets active: nothing to clear.
          }
          // Returning false lets ProseMirror move the selection as usual.
          return false;
        } else {
          // Ctrl+click or Meta+click adds a caret rather than moving the one you have.
          // Dispatch the clicked position to toggle a caret and return true so ProseMirror does not move the primary selection.
          view.dispatch(view.state.tr.setMeta(multiCaretPluginKey, pos));
          return true;
        }
      },
      handleTextInput(view: EditorView, _from: number, _to: number, text: string): boolean {
        // Ignore the _from and _to parameters ProseMirror passes: insertAtCarets reads the selection itself, and the two agree.
        const extras: readonly number[] = extraCarets(view.state);
        // Check whether any extra carets are active.
        if (extras.length === 0) {
          // When extras is empty, return false: nothing multi-caret about it, so standard handling applies.
          return false;
        } else {
          // Extra carets are active: dispatch multi-caret text insertion and return true.
          view.dispatch(insertAtCarets(view.state, extras, text));
          return true;
        }
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        // Check whether the Escape key was pressed.
        if (event.key === 'Escape') {
          // Check if there are active extra carets to clear.
          if (extraCarets(view.state).length > 0) {
            // Extra carets present: dispatch clear metadata and consume Escape.
            view.dispatch(view.state.tr.setMeta(multiCaretPluginKey, 'clear'));
            return true;
          } else {
            // No extra carets active: return false so Escape keeps whatever else it does.
            return false;
          }
        } else {
          // Check whether the Backspace key was pressed.
          if (event.key === 'Backspace') {
            // Backspace pressed: perform multi-caret backward deletion.
            return applyDelete(view, -1);
          } else {
            // Check whether the Delete key was pressed.
            if (event.key === 'Delete') {
              // Delete pressed: perform multi-caret forward deletion.
              return applyDelete(view, 1);
            } else {
              // Any other key: return false without intercepting.
              // Do NOT intercept Enter or the arrow keys. A split at several places at once is a
              // different feature with its own questions about what happens to the carets afterwards,
              // and arrow keys would need every caret to carry its own goal column. Leaving them to
              // the ordinary commands means they act on the primary caret and the extras simply map
              // along, which is predictable rather than surprising.
              return false;
            }
          }
        }
      },
    },
  });
}
