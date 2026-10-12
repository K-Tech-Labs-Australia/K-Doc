// @vitest-environment jsdom
/**
 * @file raw-source-navigation.spec.ts
 * @purpose Tests leaving the raw-HTML widget, inline HTML widgets, non-source raw nodes, and undo forwarding (FR-7.9).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { EditorView as CodeView, runScopeHandlers } from '@codemirror/view';
import { CODE_TOKEN_STYLES, ProseMirrorBinding, RAW_SOURCE_STYLES } from '../src/index.js';

let binding: ProseMirrorBinding | undefined;
let mount: HTMLElement | undefined;

// Tear down any binding and mount node left over from a previous test.
afterEach((): void => {
  binding?.destroy();
  binding = undefined;
  mount?.remove();
  mount = undefined;
});

// Create a fresh session + binding mounted into the DOM for a given source.
function setup(source: string): { session: DocumentSession; binding: ProseMirrorBinding } {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  const session = new DocumentSession(source);
  binding = new ProseMirrorBinding({ session, mount });
  return { session, binding };
}

// Locate the CodeMirror view backing a widget identified by its pane selector.
function widgetIn(b: ProseMirrorBinding, selector: string): CodeView {
  const editor = b.view.dom.querySelector(selector + ' .cm-editor');
  if (!(editor instanceof HTMLElement)) { throw new Error('no widget for ' + selector); }
  const view = CodeView.findFromDOM(editor);
  if (view === null) { throw new Error('no CodeMirror view'); }
  return view;
}

// Run an editor-scope keydown through CodeMirror and report whether it was handled.
function press(view: CodeView, key: string, mods: { ctrlKey?: boolean } = {}): boolean {
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: mods.ctrlKey ?? false, bubbles: true, cancelable: true }), 'editor');
}

describe('raw-source-navigation', (): void => {
  it('Escape hands the caret back to the document after the widget', (): void => {
    const { binding: b } = setup('Before\n\n<div>x</div>\n\nAfter\n');
    // Escape must be claimed by our handler and move focus past the widget.
    expect(press(widgetIn(b, '.kdoc-raw-block'), 'Escape')).toBe(true);
    expect(b.view.state.selection.$head.parent.textContent).toBe('After');
  });

  it('ArrowUp on the first line leaves upward', (): void => {
    const { binding: b } = setup('Before\n\n<div>x</div>\n\nAfter\n');
    const w = widgetIn(b, '.kdoc-raw-block');
    // Place the caret at the very start of the raw source.
    w.dispatch({ selection: { anchor: 0 } });
    expect(press(w, 'ArrowUp')).toBe(true);
    expect(b.view.state.selection.$head.parent.textContent).toBe('Before');
  });

  it('ArrowRight in the middle stays inside', (): void => {
    const { binding: b } = setup('Before\n\n<div>x</div>\n\nAfter\n');
    const w = widgetIn(b, '.kdoc-raw-block');
    // Place the caret just after the opening tag so ArrowRight is interior.
    w.dispatch({ selection: { anchor: 1 } });
    // Not at the edge, so CodeMirror's own motion takes it: the caret moves within the widget and does not leave.
    expect(press(w, 'ArrowRight')).toBe(true);
    expect(w.state.selection.main.head).toBe(2);
    expect(b.view.state.selection.$head.parent.textContent).not.toBe('After');
  });

  it('has CodeMirror\'s own editing keys inside the widget', (): void => {
    const { binding: b } = setup('<div class="note">Hello</div>\n');
    const w = widgetIn(b, '.kdoc-raw-block');
    // Select All is in the default keymap and needs no layout, so jsdom can run it; Home and End measure text
    // geometry jsdom does not have, and are checked in the running app instead.
    w.dispatch({ selection: { anchor: 8 } });
    expect(press(w, 'a', { ctrlKey: true })).toBe(true);
    expect(w.state.selection.main.from).toBe(0);
    expect(w.state.selection.main.to).toBe(w.state.doc.length);
  });

  it('does not underline an unmatched tag as invalid inside a widget', (): void => {
    // A widget holds a fragment, so a lone closing tag is not a document error.
    expect(RAW_SOURCE_STYLES).toContain('.kdoc-raw-inline .tok-invalid');
    expect(RAW_SOURCE_STYLES).toContain('.kdoc-raw-block .tok-invalid');
  });

  it('colours highlighted tokens from the theme', (): void => {
    // Code blocks emitted tok- classes long before anything coloured them; this pins the colouring.
    expect(CODE_TOKEN_STYLES).toMatch(/\.tok-keyword[^{]*\{ color: var\(--kdoc-color-accent\)/);
    expect(CODE_TOKEN_STYLES).toMatch(/\.tok-string[^{]*\{ color: var\(--kdoc-color-success\)/);
  });

  it('Inline HTML gets an inline widget per tag', (): void => {
    const { binding: b } = setup('A <span>word</span> here.\n');
    const inlines = Array.from(b.view.dom.querySelectorAll('.kdoc-raw-inline'));
    expect(inlines.length).toBe(2);
    // Each raw tag gets its own editor whose text is exactly that tag.
    const texts = inlines.map((el): string => {
      const editor = el.querySelector('.cm-editor');
      if (!(editor instanceof HTMLElement)) { throw new Error('no inline editor element'); }
      const view = CodeView.findFromDOM(editor);
      if (view === null) { throw new Error('no CodeMirror view for inline'); }
      return view.dom.textContent ?? '';
    });
    expect(texts).toEqual(['<span>', '</span>']);
    // Inline raw widgets must not carry a source label.
    for (const el of inlines) {
      expect(el.querySelector('.kdoc-raw-label')).toBeNull();
    }
  });

  it('A footnote is a real node, not a raw-source widget', (): void => {
    const { binding: b } = setup('Text[^1].\n\n[^1]: A footnote.\n');
    // Footnotes have their own nodes now: neither a placeholder nor a source editor is drawn for them.
    expect(b.view.dom.querySelector('.kdoc-unknown-block')).toBeNull();
    expect(b.view.dom.querySelector('.kdoc-raw-block')).toBeNull();
    expect(b.view.dom.querySelector('sup.kdoc-footnote-reference')?.textContent).toBe('1');
    expect(b.view.dom.querySelector('.kdoc-footnote-definition .kdoc-footnote-body')?.textContent).toBe('A footnote.');
  });

  it('Ctrl+Z in the widget undoes through the document', (): void => {
    const { session, binding: b } = setup('<div>x</div>\n');
    const w = widgetIn(b, '.kdoc-raw-block');
    // Replace the single 'x' character with 'y' inside the raw source.
    const xIndex = w.state.doc.toString().indexOf('x');
    expect(xIndex).toBeGreaterThanOrEqual(0);
    w.dispatch({ changes: { from: xIndex, to: xIndex + 1, insert: 'y' } });
    // The edit must be reflected in the session snapshot.
    expect(session.snapshot.text).toContain('<div>y</div>');
    // Ctrl+Z dispatched on the widget's content DOM should undo through the document.
    w.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(session.snapshot.text).toBe('<div>x</div>\n');
  });
});
