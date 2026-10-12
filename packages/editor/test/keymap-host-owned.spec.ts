// @vitest-environment jsdom

/**
 * @file keymap-host-owned.spec.ts
 * @purpose Verifies, per FR-14.16, that the ProseMirror keymap leaves out host-owned shortcuts only when the host owns them and keeps undo plus unnamed editing keys regardless.
 * @inputs A DocumentSession instance; a boolean | undefined flag controlling whether the host owns shortcuts; KeyboardEventInit descriptors for simulated keystrokes.
 * @outputs Boolean results of simulated keydown dispatches and the resulting document marks after each keystroke.
 * @functions
 *   - viewWith: Builds a mounted EditorView over a one-paragraph K-Doc document with the requested hostOwnsShortcuts setting.
 *   - pressIn: Dispatches a simulated KeyboardEvent through the view's handleKeyDown props and reports whether any handler consumed it.
 * @dataflow DocumentSession + kdocSchema -> createKdocKeymap plugins -> EditorState with selection [1,6) -> mounted EditorView -> pressIn keystroke -> handleKeyDown dispatch -> document mutation or pass-through.
 * @controlflow Build view with flag -> simulate each scenario's keystroke -> assert consumption and resulting marks -> destroy view; repeat per it block.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DocumentSession } from '@k-doc/core';
import { createKdocKeymap, HOST_OWNED_KEYS } from '../src/prosemirror/keymap.js';
import { kdocSchema } from '../src/prosemirror/schema.js';

/**
 * @purpose Builds a mounted ProseMirror EditorView over a one-paragraph K-Doc document, wiring in the keymap plugins for the requested hostOwnsShortcuts setting.
 * @inputs hostOwnsShortcuts - boolean | undefined: When true, host-owned shortcuts are removed from the keymap; when omitted, every binding is kept.
 * @outputs { view: EditorView, session: DocumentSession }: The mounted editor view positioned over the word "hello" and the owning session handle.
 * @dataflow new DocumentSession -> kdocSchema doc node -> createKdocKeymap plugins -> EditorState with selection [1,6) -> EditorView appended to document.body.
 * @controlflow Construct session and doc -> build plugins (spreading hostOwnsShortcuts only when defined) -> create state -> apply a text selection -> mount view -> return both handles.
 */
function viewWith(hostOwnsShortcuts: boolean | undefined): { view: EditorView; session: DocumentSession } {
  // A trailing newline keeps the document non-empty and gives the schema room to place the caret.
  const session = new DocumentSession('hello\n');

  // doc > paragraph > text("hello"): positions 1..6 span exactly the five-character word under test.
  const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('hello')])]);

  // Spread hostOwnsShortcuts only when it is defined so an omitted flag leaves every binding in place.
  const plugins = createKdocKeymap({ session, schema: kdocSchema, ...(hostOwnsShortcuts === undefined ? {} : { hostOwnsShortcuts }) });

  let state = EditorState.create({ doc, plugins: [...plugins] });

  // Select the full word "hello" so a formatting keystroke has a concrete range to act on.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

  const mount = document.createElement('div');
  document.body.append(mount);
  const view = new EditorView(mount, { state });
  return { view, session };
}

/**
 * @purpose Dispatches a simulated KeyboardEvent through the view's handleKeyDown props exactly as ProseMirror would for a real key.
 * @inputs view - EditorView: The mounted editor whose keymap handlers should run.
 *   - init - KeyboardEventInit: Event descriptor (key plus modifier flags) describing the keystroke to simulate.
 * @outputs boolean: True when at least one handleKeyDown handler consumed the event; false when none did.
 * @dataflow KeyboardEventInit -> real KeyboardEvent -> view.someProp('handleKeyDown') -> each handler(view, event) -> first truthy result.
 * @controlflow Build a cancelable, bubbling keydown event -> iterate handlers from last plugin to first -> return true on the first handler that returns true; false if none do.
 */
function pressIn(view: EditorView, init: KeyboardEventInit): boolean {
  // Run the view's keydown handlers the way ProseMirror does for a real key.
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  return view.someProp(
    'handleKeyDown',
    (handler) => handler(view, event) === true,
  ) === true;
}

describe('host-owned shortcuts in the ProseMirror keymap', (): void => {
  it('bolds with Mod-b when the editor stands alone', (): void => {
    const { view } = viewWith(undefined);
    // With no host owning shortcuts, Mod-b (Ctrl+b) must toggle the strong mark.
    expect(pressIn(view, { key: 'b', ctrlKey: true })).toBe(true);
    // The selected word "hello" should now carry exactly one strong mark.
    expect(view.state.doc.firstChild?.firstChild?.marks.map((m) => m.type.name)).toEqual(['strong']);
    view.destroy();
  });

  it('leaves Mod-b unhandled when the host owns shortcuts', (): void => {
    const { view } = viewWith(true);
    // When the host owns the shortcut, the keymap must not consume Mod-b.
    expect(pressIn(view, { key: 'b', ctrlKey: true })).toBe(false);
    // And because nothing ran, no mark should have been applied to the word.
    expect(view.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    view.destroy();
  });

  it('keeps undo when the host owns shortcuts, so the browser\'s undo never runs on the editor', (): void => {
    const { view } = viewWith(true);
    // Undo stays bound here even under host ownership: letting the browser undo edit the DOM behind ProseMirror's back is worse than a no-op.
    expect(pressIn(view, { key: 'z', ctrlKey: true })).toBe(true);
    view.destroy();
  });

  it('keeps editing keys the §20 table does not name', (): void => {
    const { view } = viewWith(true);
    // Shift+Enter is a base-editing gesture, not in the §20 owned-shortcut table, so it must still be handled.
    expect(pressIn(view, { key: 'Enter', shiftKey: true })).toBe(true);
    view.destroy();
  });

  it('names every §20 editor binding once', (): void => {
    // A set collapses duplicates; a size equal to the array length proves no key is listed twice.
    expect(new Set(HOST_OWNED_KEYS).size).toBe(HOST_OWNED_KEYS.length);
    // Mod-k (create/edit link) is a host-owned shortcut per §20.
    expect(HOST_OWNED_KEYS).toContain('Mod-k');
    // Undo and the add-caret command are editor/session owned, never handed to the host.
    expect(HOST_OWNED_KEYS).not.toContain('Mod-z');
    expect(HOST_OWNED_KEYS).not.toContain('Mod-d');
  });
});
