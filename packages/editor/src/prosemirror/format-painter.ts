/**
 * @file format-painter.ts
 * @purpose ProseMirror plugin and commands for the Format Painter (FR-8.3): pick up the inline marks at the selection, then a click or drag over other text applies them; a locked painter stays on until Esc.
 * @inputs editor state, selection, mouseup and Escape key events.
 * @outputs formatPainterKey state, commands, FORMAT_PAINTER_STYLES.
 * @functions
 *   - formatPainterState: Returns the current painter state, defaulting to inactive when absent.
 *   - marksToPaint: Extracts paintable inline marks from the selection or stored marks.
 *   - pickUpFormat: Command recording the selection's marks into plugin meta.
 *   - stopFormatPainter: Command clearing the painter state.
 *   - wordRangeAt: Computes word boundaries around a position within a textblock.
 *   - paintFormat: Command applying stored marks to a range, replacing existing formatting.
 *   - paintAtSelection: Applies the painter at the current selection (whole word when collapsed).
 *   - createFormatPainterPlugin: Builds the ProseMirror plugin with state and handlers.
 * @dataflow selection marks -> pick meta -> plugin state -> mousedown in the editor, mouseup anywhere -> range -> paint transaction.
 * @controlflow inactive -> pick -> (click/drag paints -> inactive unless locked) or Esc -> inactive.
 * @version 1
 * @date 2026-09-16
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

export const PAINTABLE_MARKS: readonly string[] = ['strong', 'emphasis', 'strikethrough', 'inlineCode', 'highlight', 'subscript', 'superscript'];

export interface FormatPainterState {
  readonly marks: readonly Mark[] | null;
  readonly locked: boolean;
}

type FormatPainterMeta = { readonly kind: 'pick'; readonly marks: readonly Mark[]; readonly locked: boolean } | { readonly kind: 'stop' };

const INACTIVE: FormatPainterState = { marks: null, locked: false };

export const formatPainterKey: PluginKey<FormatPainterState> = new PluginKey<FormatPainterState>('kdocFormatPainter');

export const FORMAT_PAINTER_ACTIVE_CLASS = 'kdoc-format-painter-active';

export const FORMAT_PAINTER_STYLES: string = `
.${FORMAT_PAINTER_ACTIVE_CLASS}, .${FORMAT_PAINTER_ACTIVE_CLASS} * {
  cursor: copy;
}
`;

/**
 * @purpose Returns the current Format Painter state, falling back to inactive when the plugin is absent.
 * @inputs state - Editor state whose plugin state is read.
 * @outputs FormatPainterState - The stored painter state, or INACTIVE when none exists.
 * @dataflow EditorState → formatPainterKey.getState → state object (or default).
 * @controlflow Read plugin state; return the default when it is undefined.
 */
export function formatPainterState(state: EditorState): FormatPainterState {
  return formatPainterKey.getState(state) ?? INACTIVE;
}

/**
 * @purpose Extracts the paintable inline marks from the current selection or stored marks, mirroring Word's behaviour.
 * @inputs state - Editor state providing the active selection and document.
 * @outputs Mark[] - The subset of selection/stored marks that are in PAINTABLE_MARKS.
 * @dataflow Selection offsets → node traversal → first text node's marks → filtered list.
 * @controlflow Branch on empty vs non-empty selection; stored marks for caret, first text node for range.
 */
export function marksToPaint(state: EditorState): Mark[] {
  const { from, to, empty, $from } = state.selection;
  let marks: readonly Mark[] = $from.marks();
  // Empty selection (caret): inherit the marks that new typing would receive.
  if (empty) {
    marks = state.storedMarks ?? $from.marks();
  } else {
    // Range selection: gather formatting from the first text node in the range.
    const holder: { marks: readonly Mark[] | null } = { marks: null };
    state.doc.nodesBetween(from, to, (node) => {
      if (holder.marks === null && node.isText) {
        // First text node found: capture its marks and stop traversing.
        holder.marks = node.marks;
      } else {
        // Already captured or non-text node: keep searching only if nothing stored yet.
      }
      return holder.marks === null;
    });
    if (holder.marks !== null) {
      // A text node carrying marks was found within the range.
      marks = holder.marks;
    } else {
      // No text node in range: keep the caret marks captured above.
    }
  }
  return marks.filter((mark) => PAINTABLE_MARKS.includes(mark.type.name));
}

/**
 * @purpose Command that records the current selection's paintable marks into plugin meta for later application.
 * @inputs locked - When true, keeps the painter active after a single use until Esc.
 * @outputs Command - Predicate returning true; dispatches a pick meta when a dispatcher is present.
 * @dataflow Selection → marksToPaint → FormatPainterMeta (pick) → transaction meta.
 * @controlflow Branch on whether a dispatcher exists to receive the pick command.
 */
export function pickUpFormat(locked: boolean): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // A dispatcher is present: commit the picked marks into plugin meta.
    if (dispatch !== undefined) {
      const meta: FormatPainterMeta = { kind: 'pick', marks: marksToPaint(state), locked };
      dispatch(state.tr.setMeta(formatPainterKey, meta));
    } else {
      // No dispatcher (dry run): do not mutate state.
    }
    return true;
  };
}

/**
 * @purpose Command that turns off the Format Painter, clearing any stored marks.
 * @inputs state - Editor state inspected for an active painter.
 * @outputs Command - Returns false when already inactive; otherwise dispatches a stop meta.
 * @dataflow Painter state → null check → stop meta transaction (when active).
 * @controlflow Early-return when inactive, then branch on dispatcher presence.
 */
export function stopFormatPainter(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    // Already inactive: nothing to stop, preserve the command's false result.
    if (formatPainterState(state).marks === null) {
      return false;
    } else {
      // Active painter: proceed to clear it below.
    }
    // A dispatcher is present: commit the stop meta to reset the painter.
    if (dispatch !== undefined) {
      const meta: FormatPainterMeta = { kind: 'stop' };
      dispatch(state.tr.setMeta(formatPainterKey, meta));
    } else {
      // No dispatcher (dry run): do not mutate state.
    }
    return true;
  };
}

/**
 * @purpose Computes the word boundaries surrounding a document position within a textblock.
 * @inputs doc - The document to resolve positions against.
 * @inputs pos - The cursor position whose enclosing word is measured.
 * @outputs { from, to } | null - The [from, to) range of the word, or null when not in a textblock or on an empty word.
 * @dataflow Position → resolved $pos → parentOffset expansion via word-character scan.
 * @controlflow Reject non-textblocks; expand outward while characters are word characters.
 */
export function wordRangeAt(doc: ProseMirrorNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  // Outside a textblock (e.g. inside an atom): no measurable word.
  if (!$pos.parent.isTextblock) {
    return null;
  } else {
    // In a textblock: continue to the word scan below.
  }
  // Delimiter is the Unicode object replacement character so inline atoms occupy one non-word slot, keeping offsets aligned with positions.
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '\ufffc');
  const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}_]/u.test(char);
  let start = $pos.parentOffset;
  let end = $pos.parentOffset;
  while (isWordChar(text[start - 1])) {
    start -= 1;
  }
  while (isWordChar(text[end])) {
    end += 1;
  }
  // Degenerate zero-length word: nothing to paint.
  if (start === end) {
    return null;
  } else {
    // Map local text offsets back to absolute document positions.
    return { from: $pos.start() + start, to: $pos.start() + end };
  }
}

/**
 * @purpose Command that paints stored marks onto a [from, to) range, replacing any existing paintable formatting.
 * @inputs from - Start offset of the target range.
 * @inputs to - End offset of the target range.
 * @outputs Command - Returns false when inactive or empty; otherwise applies marks in one transaction.
 * @dataflow Painter state → clear existing marks → add stored marks → optional stop meta → dispatch.
 * @controlflow Guard on active painter and non-empty range, then branch on dispatcher presence.
 */
export function paintFormat(from: number, to: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const painter = formatPainterState(state);
    // Inactive painter or empty range: refuse to paint.
    if (painter.marks === null || from >= to) {
      return false;
    } else {
      // Active painter with a valid range: proceed below.
    }
    // A dispatcher is present: build and apply the paint transaction.
    if (dispatch !== undefined) {
      const tr = state.tr;
      // Remove all existing paintable marks so formatting is replaced, not merged.
      for (const name of PAINTABLE_MARKS) {
        const type = state.schema.marks[name];
        if (type !== undefined) {
          // Paintable mark exists in the schema: strip it from the range.
          tr.removeMark(from, to, type);
        } else {
          // Schema lacks this mark definition: skip removal.
        }
      }
      // Re-apply each stored mark on top of the cleared range.
      for (const mark of painter.marks) {
        tr.addMark(from, to, mark);
      }
      // Unlocked painter fires once and then turns off automatically.
      if (!painter.locked) {
        const meta: FormatPainterMeta = { kind: 'stop' };
        tr.setMeta(formatPainterKey, meta);
      } else {
        // Locked painter: remain active until Esc is pressed.
      }
      // Single undo step for the whole paint operation.
      dispatch(tr.setMeta('kdocStructural', true));
    } else {
      // No dispatcher (dry run): do not mutate state.
    }
    return true;
  };
}

/**
 * @purpose Applies the Format Painter at the current selection, painting the whole word when the caret is collapsed.
 * @inputs view - The editor view whose state and dispatcher drive the paint command.
 * @outputs boolean - True when a paint transaction was dispatched, false otherwise.
 * @dataflow Selection → word/range computation → paintFormat command → dispatch.
 * @controlflow Guard on active painter, compute target range, then paint; false on any guard failure.
 */
export function paintAtSelection(view: EditorView): boolean {
  const { state } = view;
  // Painter inactive: nothing to apply.
  if (formatPainterState(state).marks === null) {
    return false;
  } else {
    // Active painter: continue to range computation.
  }
  const { selection } = state;
  // Collapsed selection paints the whole word under the caret; a range paints that exact span.
  const range = selection.empty ? wordRangeAt(state.doc, selection.from) : { from: selection.from, to: selection.to };
  if (range === null) {
    // No measurable word or invalid range: refuse to paint.
    return false;
  } else {
    // Valid range: dispatch the paint command through the view's dispatcher.
    return paintFormat(range.from, range.to)(state, view.dispatch);
  }
}

/**
 * @purpose Builds the Format Painter ProseMirror plugin, tracking painter state and wiring mouse-up and Escape handlers.
 * @inputs view - The editor view used to attach listeners and dispatch transactions.
 * @outputs Plugin<FormatPainterState> - Plugin exposing state, a copy-cursor attribute, key and mouse handling.
 * @dataflow Mouseup/keydown events → command predicates → transaction meta → plugin state updates.
 * @controlflow Apply picks/stops from meta; on mouse-up paint the target range unless inactive; Esc stops the painter.
 */
export function createFormatPainterPlugin(): Plugin<FormatPainterState> {
  return new Plugin<FormatPainterState>({
    key: formatPainterKey,
    state: {
      init: (): FormatPainterState => INACTIVE,
      apply: (tr: Transaction, value: FormatPainterState): FormatPainterState => {
        const meta: unknown = tr.getMeta(formatPainterKey);
        // Meta is missing or malformed: keep the previous painter state unchanged.
        if (typeof meta !== 'object' || meta === null) {
          return value;
        } else if ((meta as FormatPainterMeta).kind === 'pick') {
          // Pick command: adopt the freshly captured marks and lock flag.
          const pick = meta as { readonly marks: readonly Mark[]; readonly locked: boolean };
          return { marks: pick.marks, locked: pick.locked };
        } else {
          // Stop or unknown kind: reset to inactive.
          return INACTIVE;
        }
      },
    },
    props: {
      // Add the copy cursor class only while a painter is active.
      attributes: (state: EditorState): Record<string, string> => (formatPainterState(state).marks === null ? {} : { class: FORMAT_PAINTER_ACTIVE_CLASS }),
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        // Escape clears the painter; returning false otherwise preserves Esc's default actions.
        if (event.key === 'Escape') {
          return stopFormatPainter()(view.state, view.dispatch);
        } else {
          // Not Escape: let ProseMirror handle the key normally.
          return false;
        }
      },
    },
    view: (view: EditorView) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onMouseUp = (): void => {
        // Painter inactive: ignore the mouse-up entirely.
        if (formatPainterState(view.state).marks === null) {
          return;
        } else {
          // Active painter: schedule the paint below.
        }
        // Deferred so ProseMirror can finish updating the selection after this event fires.
        timer = setTimeout(() => {
          timer = null;
          paintAtSelection(view);
        }, 0);
      };
      // A drag that starts in the editor often ends past it (beyond the end of a line), so the release is listened for
      // on the whole document from the moment the button goes down in the editor.
      const onMouseDown = (): void => {
        view.dom.ownerDocument.addEventListener('mouseup', onMouseUp, { once: true });
      };
      view.dom.addEventListener('mousedown', onMouseDown);
      return {
        destroy: (): void => {
          view.dom.removeEventListener('mousedown', onMouseDown);
          view.dom.ownerDocument.removeEventListener('mouseup', onMouseUp);
          if (timer !== null) {
            // Pending paint still scheduled: cancel it on teardown.
            clearTimeout(timer);
          } else {
            // No pending timer: nothing to clear.
          }
        },
      };
    },
  });
}
