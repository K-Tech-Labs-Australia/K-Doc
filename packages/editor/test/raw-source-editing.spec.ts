// @vitest-environment jsdom
/**
 * @file raw-source-editing.spec.ts
 * @purpose Drives the embedded raw-HTML widget through a real binding and session: edits reach the document, untouched bytes stay, highlighting applies (FR-7.9).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { EditorView as CodeView } from '@codemirror/view';
import { ProseMirrorBinding } from '../src/index.js';

// Non-canonical bullets make byte preservation observable: a whole-document rewrite would normalise them.
const SOURCE = '# Title\n\n*   Weird bullet\n\n<div class="note">Hello <b>world</b></div>\n\nLast paragraph.\n';

let binding: ProseMirrorBinding | undefined;
let mount: HTMLElement | undefined;
afterEach((): void => {
  binding?.destroy();
  binding = undefined;
  mount?.remove();
  mount = undefined;
});

function setup(source: string = SOURCE): { session: DocumentSession; binding: ProseMirrorBinding } {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  const session = new DocumentSession(source);
  binding = new ProseMirrorBinding({ session, mount });
  return { session, binding };
}

function blockWidget(b: ProseMirrorBinding): CodeView {
  const editor = b.view.dom.querySelector('.kdoc-raw-block .cm-editor');
  if (!(editor instanceof HTMLElement)) { throw new Error('no raw block widget'); }
  const view = CodeView.findFromDOM(editor);
  if (view === null) { throw new Error('no CodeMirror view in widget'); }
  return view;
}

describe('raw source editing', (): void => {
  it('renders an HTML block as an editable widget holding its source', (): void => {
    const { binding } = setup();
    const dom = binding.view.dom;
    // Exactly one raw block must be present in the pane.
    expect(dom.querySelectorAll('.kdoc-raw-block').length).toBe(1);
    // The block is flagged as HTML and labelled accordingly.
    expect(dom.querySelector('.kdoc-raw-block')?.getAttribute('data-raw-language')).toBe('html');
    const label = dom.querySelector('.kdoc-raw-label');
    expect(label?.textContent).toBe('HTML');
    // The widget's document holds only the inner HTML source, not the surrounding markdown.
    expect(blockWidget(binding).state.doc.toString()).toBe('<div class="note">Hello <b>world</b></div>');
    // No fallback unknown-block marker should remain once the block is recognised.
    expect(dom.querySelector('.kdoc-unknown-block')).toBeNull();
  });

  it('edits the document when the widget is edited', (): void => {
    const { session, binding } = setup();
    // Replace `world` with `there` inside the raw block's CodeMirror view.
    const w = blockWidget(binding);
    const at = w.state.doc.toString().indexOf('world');
    w.dispatch({ changes: { from: at, to: at + 5, insert: 'there' } });
    // The document now reflects the edited HTML and no longer contains the old word.
    expect(session.snapshot.text).toContain('<div class="note">Hello <b>there</b></div>');
    expect(session.snapshot.text).not.toContain('world');
  });

  it('preserves untouched bytes across the widget edit', (): void => {
    const { session, binding } = setup();
    // Perform the same world→there replacement as in the previous test.
    const w = blockWidget(binding);
    const at = w.state.doc.toString().indexOf('world');
    w.dispatch({ changes: { from: at, to: at + 5, insert: 'there' } });
    // Only the HTML block's bytes changed; the rest of the document is byte-identical.
    expect(session.snapshot.text).toContain('*   Weird bullet');
    expect(session.snapshot.text.endsWith('\n\nLast paragraph.\n')).toBe(true);
    expect(session.snapshot.text).toBe(SOURCE.replace('world', 'there'));
  });

  it('treats the widget edit as a single undoable document edit', (): void => {
    const { session, binding } = setup();
    // Apply one world→there replacement.
    const w = blockWidget(binding);
    const at = w.state.doc.toString().indexOf('world');
    w.dispatch({ changes: { from: at, to: at + 5, insert: 'there' } });
    // The document records exactly one undo step for the whole edit.
    expect(session.snapshot.canUndo).toBe(true);
    session.undo();
    // Undo restores the original source and re-syncs the widget view.
    expect(session.snapshot.text).toBe(SOURCE);
    expect(blockWidget(binding).state.doc.toString()).toBe('<div class="note">Hello <b>world</b></div>');
  });

  it('propagates a Source-side edit into the widget', (): void => {
    const { session, binding } = setup();
    // Switch to the source pane and rewrite the text from that side.
    session.focusPane('source');
    session.applyText(SOURCE.replace('Hello', 'Goodbye'));
    // The raw block widget reflects the Source-side change on re-read.
    expect(blockWidget(binding).state.doc.toString()).toBe('<div class="note">Goodbye <b>world</b></div>');
  });

  it('does not write a Source-side change back as a widget edit', (): void => {
    const errors: Error[] = [];
    mount = document.createElement('div');
    document.body.appendChild(mount);
    const session = new DocumentSession(SOURCE);
    binding = new ProseMirrorBinding({ session, mount, onError: (error: Error): void => { errors.push(error); } });
    session.focusPane('source');
    session.applyText(SOURCE.replace('Hello', 'Goodbye'));
    // Echoing the sync back would be an edit from the unfocused pane, which the lock rejects and reports.
    expect(errors).toEqual([]);
    expect(session.snapshot.text).toBe(SOURCE.replace('Hello', 'Goodbye'));
  });

  it('reaches the session once when the document rewrites the node', (): void => {
    const { session, binding } = setup();
    let changes = 0;
    session.subscribe((): void => { changes += 1; });
    let pos = -1;
    binding.view.state.doc.descendants((n, p): boolean => { if (n.type.name === 'unknownBlock') { pos = p; } return true; });
    const target = binding.view.state.doc.nodeAt(pos);
    if (target === null) { throw new Error('no raw block'); }
    const stored = target.attrs['node'] as Record<string, unknown>;
    // A WYSIWYG-side rewrite pushes the new text into the widget; that push must not echo back as a second edit.
    binding.view.dispatch(binding.view.state.tr.setNodeMarkup(pos, undefined, { ...target.attrs, node: { ...stored, value: '<div>Bye</div>' } }));
    expect(changes).toBe(1);
    expect(blockWidget(binding).state.doc.toString()).toBe('<div>Bye</div>');
  });

  it('applies token highlighting inside the widget', (): void => {
    const { binding } = setup();
    // At least one element in the widget DOM must carry a tokenizer class.
    expect(blockWidget(binding).contentDOM.querySelectorAll('[class*="tok-"]').length).toBeGreaterThan(0);
  });
});
