/**
 * @file snippets.ts
 * @purpose Snippet expansion in the WYSIWYG pane (FR-7.10): a prefix followed by Tab expands into its Markdown body, and Tab / Shift+Tab then move between the body's tab stops until the final cursor;
 * @inputs the snippet options getter, the clock, key events, editor state;
 * @outputs a plugin holding the tab-stop session, pure helpers and SNIPPET_STYLES;
 * @functions
 *   - createSnippetPlugin: builds the ProseMirror plugin that owns the snippet tab-stop session.
 *   - snippetPrefixAt: detects an unprefixed snippet trigger immediately before the cursor.
 *   - markStops: wraps each stop with private-use open/close markers so they survive Markdown parsing.
 *   - stripMarkersOutsideText: removes stop markers from metadata nodes where they would be invisible.
 *   - snippetContent: parses marked text into ProseMirror content, choosing inline vs block insertion.
 *   - expandSnippet: replaces the prefix with parsed body and computes the resulting tab-stop ranges.
 *   - selectStop: positions the selection at a single stop.
 *   - expandSnippetAt: public entry that expands the trigger found under the cursor.
 *   - moveToStop: advances or reverts the active session to an adjacent stop.
 *   - openMark / closeMark: encode per-stop private-use markers.
 * @dataflow prefix + Tab -> body -> stops marked with private-use characters -> Markdown -> ProseMirror content -> markers located and removed -> first stop selected;
 * @controlflow a capture-phase Tab listener runs before the list and table keymaps; it moves between stops while a session is open, otherwise expands a prefix, otherwise leaves Tab alone;
 * @version 1
 * @date 2026-09-16
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import type { Fragment, Schema } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Nodes } from 'mdast';
import { parseMarkdown, parseSnippetBody } from '@k-doc/core';
import type { SnippetStop } from '@k-doc/core';
import { mdastToProseMirror } from './from-mdast.js';
import { isInCode } from './autocorrect.js';

export interface SnippetOptions {
  readonly enabled: boolean;
  readonly items: Readonly<Record<string, string>>;
}

export interface StopRange {
  readonly from: number;
  readonly to: number;
}

export interface SnippetSession {
  readonly stops: readonly StopRange[];
  readonly index: number;
}

export const snippetPluginKey: PluginKey<SnippetSession | null> = new PluginKey<SnippetSession | null>('kdocSnippets');
export const SNIPPET_STOP_CLASS = 'kdoc-snippet-stop';
export const SNIPPET_STYLES: string = `
.kdoc-snippet-stop { background: color-mix(in srgb, var(--kdoc-color-accent) 18%, transparent); border-radius: 2px; }
`;

const MARK_BASE = 0xe000;
const MARK_LAST = 0xe1ff;
// Private-use range delimiting each stop's open/close markers so they survive Markdown parsing.
const MARKERS = /[\uE000-\uE1FF]/g;

function openMark(k: number): string {
  return String.fromCharCode(MARK_BASE + 2 * k);
}

function closeMark(k: number): string {
  return String.fromCharCode(MARK_BASE + 2 * k + 1);
}

export function snippetPrefixAt(state: EditorState, items: Readonly<Record<string, string>>): { readonly prefix: string; readonly from: number; readonly to: number } | null {
  const { selection } = state;
  // Reject when the caret is not alone, sits inside inline code, or is outside a text block — no prefix can start here.
  if (!selection.empty || isInCode(state, selection.from) || !selection.$from.parent.isTextblock) {
    return null; // No trigger possible in this position.
  } else {
    // Caret is isolated and inside a textblock: continue to prefix matching.
  }
  const $from = selection.$from;
  // Pull preceding text with a null separator so adjacent node boundaries are detectable.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  // Compare longest prefixes first so the most specific trigger wins.
  const prefixes = Object.keys(items).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const charBefore = before[before.length - prefix.length - 1];
    // Accept the prefix only when it ends at the caret and is preceded by whitespace or an opening bracket/quote (or nothing).
    if (before.endsWith(prefix) && (charBefore === undefined || /[\s([{"'\u201C\u2018]/.test(charBefore))) {
      return { prefix, from: selection.from - prefix.length, to: selection.from }; // Report the trigger span.
    } else {
      // Prefix does not match this boundary: keep scanning shorter prefixes.
    }
  }
  return null;
}

export function markStops(text: string, stops: readonly SnippetStop[]): string {
  let marked = '';
  for (let pos = 0; pos <= text.length; pos += 1) {
    // Close any stop ending here before opening one that starts here, keeping nested stops correctly delimited.
    stops.forEach((stop, k) => {
      // Close a non-empty stop whose range ends exactly at this position.
      if (stop.to === pos && stop.from < pos) {
        marked += closeMark(k); // Emit the closer so nested stops open afterward.
      } else {
        // Stop does not end here (or is empty): emit nothing for the closing pass.
      }
    });
    stops.forEach((stop, k) => {
      // Open any stop whose range begins exactly at this position.
      if (stop.from === pos) {
        marked += openMark(k);
        if (stop.to === pos) {
          marked += closeMark(k); // Empty stop: immediately close so it still delimits a zero-width region.
        } else {
          // Non-empty stop: closer is emitted later when this position is reached by the closing pass.
        }
      } else {
        // Stop does not start here: emit nothing for the opening pass.
      }
    });
    marked += text.charAt(pos);
  }
  return marked;
}

function stripMarkersOutsideText(node: Nodes): void {
  const record = node as unknown as Record<string, unknown>;
  // A text-like node holds visible content that must keep its markers for stop location.
  const holdsText = node.type === 'text' || node.type === 'inlineCode' || node.type === 'code';
  for (const key of Object.keys(record)) {
    const value = record[key];
    // Strip markers from any string field, but never touch the visible value of a text-like node.
    if (typeof value === 'string' && !(holdsText && key === 'value')) {
      record[key] = value.replace(MARKERS, ''); // Remove markers from this metadata field.
    } else {
      // Field is not a string, or it is the live text value: leave it intact so stop markers stay locatable.
    }
  }
  if ('children' in node) {
    for (const child of node.children) {
      stripMarkersOutsideText(child); // Recurse to clean markers deeper in the tree.
    }
  } else {
    // Leaf node with no children: nothing further to strip below this point.
  }
}

export function snippetContent(schema: Schema, marked: string): { readonly content: Fragment; readonly inline: boolean } {
  const root = parseMarkdown(marked).root;
  stripMarkersOutsideText(root);
  const doc = mdastToProseMirror(root, schema);
  const first = doc.firstChild;
  // Insert inline only when the body is a single line that parses to one paragraph; otherwise insert as blocks.
  if (doc.childCount === 1 && first !== null && first.type.name === 'paragraph' && !marked.includes('\n')) {
    return { content: first.content, inline: true }; // Merge into the surrounding paragraph.
  } else {
    return { content: doc.content, inline: false }; // Replace as standalone block(s).
  }
}

export function expandSnippet(state: EditorState, prefix: StopRange, body: string, now: Date): { readonly tr: Transaction; readonly stops: readonly StopRange[] } {
  const parsed = parseSnippetBody(body, now);
  const { content, inline } = snippetContent(state.schema, markStops(parsed.text, parsed.stops));
  const tr = state.tr;
  // Inline bodies merge into the current paragraph; block bodies replace with a zero-depth slice.
  if (inline) {
    tr.replaceWith(prefix.from, prefix.to, content); // Replace in place for inline insertion.
  } else {
    tr.replaceRange(prefix.from, prefix.to, new Slice(content, 0, 0)); // Replace as standalone blocks.
  }
  const start = tr.mapping.map(prefix.from, -1);
  const end = tr.mapping.map(prefix.to, 1);
  const found: { readonly pos: number; readonly code: number }[] = [];
  tr.doc.nodesBetween(start, end, (node, pos) => {
    // Examine text nodes only; skip structural nodes that cannot contain marker characters.
    if (node.isText && node.text !== undefined) {
      for (let i = 0; i < node.text.length; i += 1) {
        const code = node.text.charCodeAt(i);
        // Record markers in the private use range; ignore ordinary characters.
        if (code >= MARK_BASE && code <= MARK_LAST) {
          found.push({ pos: pos + i, code }); // Store this marker's position and code point.
        } else {
          // Ordinary text character: not a marker, skip it.
        }
      }
    } else {
      // Non-text node: markers never live here; nodesBetween still descends into children.
    }
    return true;
  });
  // Delete markers from last to first so earlier recorded positions stay valid as the doc shrinks.
  for (let j = found.length - 1; j >= 0; j -= 1) {
    const marker = found[j];
    if (marker !== undefined) {
      tr.delete(marker.pos, marker.pos + 1); // Remove this single marker character.
    } else {
      // Defensive: index out of range; nothing to delete.
    }
  }
  // positionOf maps a marker code point to its final document position, correcting for markers deleted before it.
  // @purpose Returns the post-deletion position of a given marker code point, or null when absent.
  // @inputs code - The private-use marker code point whose resolved position is sought.
  // @outputs The zero-based document position of that marker, or null if no such marker exists.
  // @dataflow found[] -> findIndex by code -> positional correction (minus preceding deletions) -> result.
  // @controlflow Locate the marker; return null when missing, else its original pos offset by earlier deletions.
  const positionOf = (code: number): number | null => {
    const at = found.findIndex((marker) => marker.code === code);
    const marker = found[at];
    // Return null when the code point has no marker; otherwise correct for markers deleted before it.
    return marker === undefined ? null : marker.pos - at; // Position minus the number of markers deleted before it.
  };
  const stops: StopRange[] = [];
  parsed.stops.forEach((_stop, k) => {
    const from = positionOf(MARK_BASE + 2 * k);
    const to = positionOf(MARK_BASE + 2 * k + 1);
    // Keep the stop only when both its opening and closing markers resolved to concrete positions.
    if (from !== null && to !== null) {
      stops.push({ from, to }); // Record a complete stop range.
    } else {
      // A marker fell away (e.g., stripped outside text): drop this stop so it cannot be navigated to.
    }
  });
  // When every stop vanished, leave the caret just after the inserted content instead of ending abruptly.
  if (stops.length === 0) {
    const caret = tr.mapping.map(prefix.to, 1);
    stops.push({ from: caret, to: caret }); // Single degenerate stop at the trailing position.
  } else {
    // At least one valid stop exists; keep them and let the caller select the first.
  }
  tr.setMeta('kdocStructural', true);
  return { tr, stops };
}

function selectStop(tr: Transaction, stop: StopRange): Transaction {
  // selectStop moves a transaction's selection onto a single tab-stop range.
  // @purpose Wraps the given stop as an inclusive text selection on the current document.
  // @inputs tr - Transaction whose document receives the new selection; stop - {from, to} range to select.
  // @outputs The same transaction with its selection set across the stop.
  // @dataflow Stop range -> TextSelection.create over tr.doc -> applied as the transaction selection.
  // @controlflow No branching; constructs and applies the selection in one step.
  return tr.setSelection(TextSelection.create(tr.doc, stop.from, stop.to));
}

export function expandSnippetAt(view: EditorView, options: SnippetOptions, now: Date): boolean {
  // Bail out entirely when snippet expansion is turned off.
  if (!options.enabled) {
    return false; // Feature disabled: nothing to do.
  } else {
    // Expansion enabled: proceed to locate a trigger under the cursor.
  }
  const found = snippetPrefixAt(view.state, options.items);
  // Resolve the body: undefined when no prefix matched, otherwise the registered Markdown for that prefix.
  const body = found === null ? undefined : options.items[found.prefix]; // Guarded lookup of the trigger's body.
  // No usable trigger or body was resolved: abort expansion.
  if (found === null || body === undefined) {
    return false; // Nothing to expand at this cursor.
  } else {
    // Valid prefix and body found: proceed to expansion.
  }
  const { tr, stops } = expandSnippet(view.state, found, body, now);
  const first = stops[0];
  // Defensive guard: if no stop was produced, there is nowhere to place the caret.
  if (first === undefined) {
    return false; // No stop available; do not dispatch an empty session.
  } else {
    // First stop exists: select it and continue.
  }
  selectStop(tr, first);
  // Store the multi-stop session only when navigation is possible; a single stop ends immediately.
  tr.setMeta(snippetPluginKey, stops.length > 1 ? { stops, index: 0 } : null); // Session for Tab/Shift+Tab, or null to finish.
  view.dispatch(tr);
  return true;
}

export function moveToStop(view: EditorView, step: 1 | -1): boolean {
  const session = snippetPluginKey.getState(view.state) ?? null;
  // No active session means Tab/Shift+Tab should behave normally.
  if (session === null) {
    return false; // Not in a snippet: let the key fall through to default handling.
  } else {
    // Session present: compute the next stop.
  }
  const index = Math.max(0, session.index + step);
  const stop = session.stops[index];
  // Stepped past the final stop (or clamped off the front): end the session and return.
  if (stop === undefined) {
    view.dispatch(view.state.tr.setMeta(snippetPluginKey, null)); // Terminate the snippet session.
    return true; // Consumed the key for session teardown.
  } else {
    // Target stop exists: select it below.
  }
  const last = index === session.stops.length - 1;
  // Retain the session for further navigation unless this was the last stop, which closes it.
  const tr = selectStop(view.state.tr, stop).setMeta(snippetPluginKey, last ? null : { stops: session.stops, index }); // Clear on last stop, keep otherwise.
  view.dispatch(tr);
  return true;
}

export function createSnippetPlugin(options: () => SnippetOptions, now: () => Date = () => new Date()): Plugin<SnippetSession | null> {
  // createSnippetPlugin assembles the ProseMirror plugin that owns snippet expansion and tab-stop navigation.
  // @purpose Wires up session state (following edits and ending when the caret leaves), stop decorations, Escape handling, and a capture-phase Tab listener that runs before built-in keymaps.
  // @inputs options - Getter returning live SnippetOptions; now - Clock returning the current Date for interpolation.
  // @outputs A ProseMirror Plugin holding the session in plugin state and exposing decoration + key props.
  // @dataflow Options/clock -> capture Tab listener -> expand/move -> transaction meta -> apply() updates session -> decorations render pending stops.
  // @controlflow init yields null; apply re-reads explicit meta, else follows edits until the caret exits the stop span; Tab is intercepted in capture phase before ProseMirror keymaps.
  return new Plugin<SnippetSession | null>({
    key: snippetPluginKey,
    state: {
      init: (): SnippetSession | null => null,
      apply: (tr, value, _oldState, newState): SnippetSession | null => {
        const meta: unknown = tr.getMeta(snippetPluginKey);
        // An explicit meta write (from expand/move/teardown) wins over derived tracking.
        if (meta !== undefined) {
          return meta as SnippetSession | null; // Adopt the session the transaction carried.
        } else if (value === null) {
          return null; // No prior session to track: stay closed.
        } else {
          // Prior session exists and no explicit meta: derive the new session from edits below.
        }
        // A stop with text grows with typing at either edge; an empty stop (such as the final cursor) stays empty and
        // moves after text typed where it sits, so a later Tab does not select what was typed.
        const stops = tr.docChanged
          ? value.stops.map((stop) => (stop.from === stop.to
            ? { from: tr.mapping.map(stop.from, 1), to: tr.mapping.map(stop.to, 1) }
            : { from: tr.mapping.map(stop.from, -1), to: tr.mapping.map(stop.to, 1) }))
          : value.stops;
        const firstStop = stops[0];
        const lastStop = stops[stops.length - 1];
        const head = newState.selection.head;
        // No stops remain after mapping: end the session.
        if (firstStop === undefined || lastStop === undefined) {
          return null; // Empty stop list cannot be navigated.
        } else if (head < Math.min(...stops.map((stop) => stop.from)) || head > Math.max(...stops.map((stop) => stop.to))) {
          return null; // Caret escaped the outermost stop: close the session.
        } else {
          // Caret stays within bounds: keep the session with its original index.
          return { stops, index: value.index };
        }
      },
    },
    // Typing over a whole stop that is a link (or other mark that does not extend to text typed at its edge) would drop
    // that mark, so the marks the stop's text had are put back on whatever replaced it.
    appendTransaction: (transactions, oldState, newState): Transaction | null => {
      const before = snippetPluginKey.getState(oldState) ?? null;
      const after = snippetPluginKey.getState(newState) ?? null;
      const stop = before === null ? undefined : before.stops[before.index];
      const current = after === null ? undefined : after.stops[after.index];
      // Only an edit to a session whose current stop had text before and still has text after is repaired.
      if (stop === undefined || current === undefined || stop.to <= stop.from || current.to <= current.from || !transactions.some((tr) => tr.docChanged)) {
        return null;
      } else {
        // The current stop was edited: make sure all of it keeps the marks its text had before the edit.
      }
      const replaced = oldState.doc.nodeAt(stop.from);
      const tr = newState.tr;
      for (const mark of replaced === null ? [] : replaced.marks) {
        const holder = { covered: true };
        newState.doc.nodesBetween(current.from, current.to, (node) => {
          // Any text in the stop without the mark means the edit dropped it there.
          if (node.isText && !mark.isInSet(node.marks)) {
            holder.covered = false;
          } else {
            // Not text, or text that already has the mark.
          }
        });
        // A mark missing from part of the stop is added back across the whole stop.
        if (!holder.covered) {
          tr.addMark(current.from, current.to, mark);
        } else {
          // The whole stop already has this mark.
        }
      }
      // Return a transaction only when a mark was actually restored.
      return tr.docChanged ? tr : null;
    },
    props: {
      decorations: (state: EditorState): DecorationSet => {
        const session = snippetPluginKey.getState(state) ?? null;
        // No active session: no highlights to draw.
        if (session === null) {
          return DecorationSet.empty; // Nothing to decorate.
        } else {
          // Session present: build decorations for pending stops below.
          const pending = session.stops.slice(session.index).filter((stop) => stop.to > stop.from);
          return DecorationSet.create(state.doc, pending.map((stop) => Decoration.inline(stop.from, stop.to, { class: SNIPPET_STOP_CLASS })));
        }
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        // End the session on Escape, but only while one is open so Escape still works otherwise.
        if (event.key === 'Escape' && (snippetPluginKey.getState(view.state) ?? null) !== null) {
          view.dispatch(view.state.tr.setMeta(snippetPluginKey, null)); // Tear down the active session.
          return false; // Let Escape continue to its other handlers.
        } else {
          // Not an in-session Escape: do nothing and let it propagate.
          return false;
        }
      },
    },
    view: (view: EditorView) => {
      // view installs and tears down the capture-phase Tab listener on the editor element.
      // @purpose Registers onKeyDown in capture phase so it precedes ProseMirror keymaps, and removes it on unmount.
      // @inputs view - The EditorView whose DOM hosts the listener.
      // @outputs An object with a destroy method that detaches the listener.
      // @dataflow View -> addEventListener(capture) -> onKeyDown runs per keydown -> destroy removes it.
      // @controlflow Attach on plugin construction; detach on unmount; no branching within.
      const onKeyDown = (event: KeyboardEvent): void => {
        // Ignore anything that is not a bare Tab so other shortcuts and keys are untouched.
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
          return; // Not an actionable Tab: leave it for ProseMirror's keymaps.
        } else {
          // Bare Tab reached: decide between moving and expanding below.
        }
        // Shift+Tab always moves backward; plain Tab moves forward and only expands when no stop is active.
        const handled = event.shiftKey ? moveToStop(view, -1) : moveToStop(view, 1) || expandSnippetAt(view, options(), now()); // Backward move, or forward-or-expand.
        // When the Tab was consumed, suppress default navigation and stop other handlers from acting.
        if (handled) {
          event.preventDefault();
          event.stopImmediatePropagation(); // Keep ProseMirror's list/table Tab bindings from also firing.
        } else {
          // Not handled: let Tab fall through to ProseMirror's built-in keymaps unchanged.
        }
      };
      view.dom.addEventListener('keydown', onKeyDown, true);
      return {
        destroy: (): void => {
          view.dom.removeEventListener('keydown', onKeyDown, true);
        },
      };
    },
  });
}
