// @vitest-environment jsdom

/**
 * @file codemirror-binding.spec.ts
 * @purpose Vitest test suite for CodeMirrorBinding and two-pane co-editing behaviour across CodeMirror and ProseMirror over a shared DocumentSession.
 *   This suite covers the Source pane and, more importantly, the first tests in the project where TWO panes share one session. That pairing is
 *   where the edit lock and the change-origin rules stop being theory.
 * @inputs Source Markdown fixtures, synthetic CodeMirror and ProseMirror transactions, DOM focus events, and DocumentSession state mutations.
 * @outputs Vitest assertions verifying construction fidelity, forward edit propagation, edit lock enforcement, session change synchronization, cross-pane editing, infinite loop avoidance, byte preservation, cross-pane undo, and lifecycle management.
 * @functions
 *   - mountElement: Creates a container div element, appends it to document.body, and returns it for mounting editor views.
 *   - typeInSource: Dispatches a CodeMirror transaction inserting text at the end of the CodeMirror document.
 * @dataflow Test setup -> DocumentSession, CodeMirrorBinding & ProseMirrorBinding -> transactions & session events -> state verification across both layers.
 * @controlflow Setup DOM mounts and session -> execute test operations across construction, edits, locks, session changes, two-pane co-editing, and lifecycle suites -> verify assertions -> teardown and destroy bindings in afterEach.
 * @version 1
 * @date 2026-09-04
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { EditorView } from '@codemirror/view';
import { CodeMirrorBinding, ProseMirrorBinding } from '../src/index.js';

// Module-level test source, deliberately non-canonical so byte preservation stays observable.
const SOURCE = '# Title\n\n*   Weird bullet\n\nLast paragraph.\n';

/**
 * @purpose Creates a container div element, appends it to document.body, and returns it for mounting editor views.
 * @inputs void.
 * @outputs HTMLElement - The newly created and attached DOM element.
 * @dataflow Creates DOM div -> attaches to document.body -> returns HTMLElement.
 * @controlflow Call document.createElement -> document.body.appendChild -> return created element.
 */
function mountElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

/**
 * @purpose Dispatches a CodeMirror transaction inserting text at the end of the CodeMirror document.
 * @inputs binding - The CodeMirrorBinding instance hosting the target view.
 * @inputs text - The string content to append to the document.
 * @outputs void.
 * @dataflow text -> CodeMirror transaction -> binding.view.dispatch.
 * @controlflow Compute document length -> dispatch transaction with text inserted at end offset.
 */
function typeInSource(binding: CodeMirrorBinding, text: string): void {
  binding.view.dispatch({
    changes: {
      from: binding.view.state.doc.length,
      insert: text,
    },
  });
}

describe('CodeMirrorBinding', () => {
  let cmMount: HTMLElement;
  let pmMount: HTMLElement;
  let cmBinding: CodeMirrorBinding | undefined;
  let pmBinding: ProseMirrorBinding | undefined;

  beforeEach(() => {
    cmMount = mountElement();
    pmMount = mountElement();
    cmBinding = undefined;
    pmBinding = undefined;
  });

  afterEach(() => {
    // Check if an active CodeMirror binding was created during the test.
    if (cmBinding !== undefined) {
      // Destroy CodeMirror binding to release event listeners and timers.
      cmBinding.destroy();
    } else {
      // No CodeMirror binding to destroy.
    }

    // Check if an active ProseMirror binding was created during the test.
    if (pmBinding !== undefined) {
      // Destroy ProseMirror binding to release event listeners and timers.
      pmBinding.destroy();
    } else {
      // No ProseMirror binding to destroy.
    }

    // Check if the CodeMirror mount element is attached to the DOM.
    if (cmMount.parentNode !== null) {
      // Remove CodeMirror mount element from document.body.
      cmMount.parentNode.removeChild(cmMount);
    } else {
      // CodeMirror mount element already detached.
    }

    // Check if the ProseMirror mount element is attached to the DOM.
    if (pmMount.parentNode !== null) {
      // Remove ProseMirror mount element from document.body.
      pmMount.parentNode.removeChild(pmMount);
    } else {
      // ProseMirror mount element already detached.
    }
  });

  describe('construction', () => {
    it('initializes the view with the exact raw Markdown source text', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      // The Source pane shows raw Markdown, so this is a byte-for-byte assertion rather than a rendered approximation.
      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
    });
  });

  describe('edits reach the session', () => {
    it('forwards typed text in source pane to session and updates dirty and undo flags', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Extra text.');

      expect(session.snapshot.text.endsWith(' Extra text.')).toBe(true);
      expect(session.snapshot.dirty).toBe(true);
      expect(session.snapshot.canUndo).toBe(true);
    });
  });

  describe('the edit lock (FR-3.1)', () => {
    it('rejects edits when unfocused, reports error with kdoc mention, and restores view and session to SOURCE', () => {
      const errors: Error[] = [];
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({
        session,
        mount: cmMount,
        onError: (error: Error): void => {
          errors.push(error);
        },
      });

      // Attempt to type while session remains focused on 'kdoc'.
      typeInSource(cmBinding, ' Invalid edit.');

      expect(errors.length).toBe(1);
      const firstError = errors[0];
      expect(firstError?.message).toContain('kdoc');
      expect(session.snapshot.text).toBe(SOURCE);

      // Proving the pane resynchronised rather than continuing to show text the document does not contain.
      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
    });
  });

  describe('session-originated changes reach the pane', () => {
    it('synchronizes view text back to SOURCE upon session undo', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Additional text.');
      session.undo();

      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
    });

    it('updates view text when session is reset with fresh content', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      session.reset('Fresh content.\n');

      expect(cmBinding.view.state.doc.toString()).toBe('Fresh content.\n');
    });
  });

  describe('two panes over one session', () => {
    it('reflects an edit in Source in the K-Doc pane', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Added in source.');

      // This is the assertion that fails if a binding ignores every 'edit' reason,
      // which is exactly the bug this pairing exposed.
      expect(pmBinding.view.state.doc.textContent).toContain('Added in source.');
    });

    it('reflects an edit in K-Doc in the Source pane', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('kdoc');
      pmBinding.view.dispatch(
        pmBinding.view.state.tr.insertText(
          ' Added in kdoc.',
          Math.max(0, pmBinding.view.state.doc.content.size - 1),
        ),
      );

      expect(cmBinding.view.state.doc.toString()).toContain('Added in kdoc.');
    });

    it('executes bidirectional edits without entering an infinite loop', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Added in source.');

      session.focusPane('kdoc');
      pmBinding.view.dispatch(
        pmBinding.view.state.tr.insertText(
          ' Added in kdoc.',
          Math.max(0, pmBinding.view.state.doc.content.size - 1),
        ),
      );

      // A missing loop guard would not fail an assertion here — it would hang or blow the stack —
      // so reaching this assertion is itself the result.
      // The Source insertion lands after the document's trailing newline, so it begins a new block;
      // a space at the start of a block is insignificant in CommonMark and is normalised away on
      // serialization. That is the serializer behaving correctly, not content being lost — hence no leading space.
      expect(session.snapshot.text).toContain('Added in source.');
      expect(session.snapshot.text).toContain('Added in kdoc.');
    });

    it('preserves untouched bytes across bidirectional edits in both panes', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Added in source.');

      session.focusPane('kdoc');
      pmBinding.view.dispatch(
        pmBinding.view.state.tr.insertText(
          ' Added in kdoc.',
          Math.max(0, pmBinding.view.state.doc.content.size - 1),
        ),
      );

      expect(session.snapshot.text).toContain('*   Weird bullet');
    });

    it('shows an external edit in BOTH panes', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      // An edit from something that is not a pane -- find-and-replace is the real case. Borrowing a
      // pane's lock to get such an edit accepted makes that pane discard it as its own echo, which is
      // exactly the bug this reason exists to prevent: one pane updated and the other did not.
      session.applyExternalText('# Replaced\n\n*   Weird bullet\n\nLast paragraph.\n');

      expect(cmBinding.view.state.doc.toString()).toContain('# Replaced');
      expect(pmBinding.view.state.doc.textContent).toContain('Replaced');
    });

    it('leaves an external edit undoable from the shared history', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      session.applyExternalText('Replaced entirely.\n');
      expect(session.snapshot.canUndo).toBe(true);

      session.undo();
      expect(session.snapshot.text).toBe(SOURCE);
    });

    it('coordinates shared undo history across both panes', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Added in source.');

      session.focusPane('kdoc');
      pmBinding.view.dispatch(
        pmBinding.view.state.tr.insertText(
          ' Added in kdoc.',
          Math.max(0, pmBinding.view.state.doc.content.size - 1),
        ),
      );

      // A single undo history shared by both panes is the whole reason the session owns it rather than either editor.
      session.undo();
      session.undo();

      expect(pmBinding.view.state.doc.textContent).not.toContain('Added in source.');
      expect(pmBinding.view.state.doc.textContent).not.toContain('Added in kdoc.');
      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
    });
  });

  describe('undo belongs to the session, not to CodeMirror (FR-3.5)', () => {
    /**
     * @purpose Dispatches a synthetic Ctrl+Z keydown into the CodeMirror content DOM.
     * @inputs binding - The CodeMirrorBinding whose content DOM receives the keystroke.
     * @outputs void.
     * @dataflow KeyboardEvent -> binding.view.contentDOM -> CodeMirror keymap dispatch.
     * @controlflow Construct a bubbling, cancellable keydown carrying key, code and keyCode -> dispatch it.
     */
    function pressCtrlZ(binding: CodeMirrorBinding): void {
      // CodeMirror resolves a binding through w3c-keyname, which reads `key` first and falls back to
      // `keyCode`. Both are supplied so the event resolves the same way under jsdom as in a browser.
      binding.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          keyCode: 90,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    it('rewinds the session rather than a pane-local history', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      session.focusPane('source');
      typeInSource(cmBinding, ' Added in source.');
      expect(session.snapshot.canUndo).toBe(true);

      pressCtrlZ(cmBinding);

      // CodeMirror's own history() would have rewound its edit log and reported that rewind to the
      // session as a FRESH edit, so the shared history would have grown rather than shrunk and the
      // text would still contain the addition. Asserting on the session is what tells the two apart.
      expect(session.snapshot.text).toBe(SOURCE);
      expect(session.snapshot.canUndo).toBe(false);
      expect(session.snapshot.canRedo).toBe(true);
      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
    });

    it('undoes an edit made in the OTHER pane', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      pmBinding = new ProseMirrorBinding({ session, mount: pmMount });

      session.focusPane('kdoc');
      pmBinding.view.dispatch(
        pmBinding.view.state.tr.insertText(
          ' Added in kdoc.',
          Math.max(0, pmBinding.view.state.doc.content.size - 1),
        ),
      );
      expect(session.snapshot.text).toContain('Added in kdoc.');

      // The point of a session-owned history: an edit made in one pane is undoable from the other.
      // A pane-local CodeMirror history knows nothing about it and this would do nothing at all.
      session.focusPane('source');
      pressCtrlZ(cmBinding);

      expect(session.snapshot.text).not.toContain('Added in kdoc.');
    });
  });

  describe('lifecycle', () => {
    it('claims the edit lock when the CodeMirror content DOM receives focus', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      // Session starts focused on 'kdoc'.
      expect(session.snapshot.focusedPane).toBe('kdoc');

      cmBinding.view.contentDOM.dispatchEvent(new Event('focus'));
      expect(session.snapshot.focusedPane).toBe('source');
    });

    it('shows a second Source view what the first one typed (FR-6.9)', () => {
      const session = new DocumentSession(SOURCE);
      const secondMount = mountElement();
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      const second = new CodeMirrorBinding({ session, mount: secondMount });

      try {
        // Both views are the Source pane, so the pane cannot tell them apart; each view's own identity
        // can. Give them the same one and the second view reads the first's edit as its own and never
        // updates.
        cmBinding.view.contentDOM.dispatchEvent(new FocusEvent('focus'));
        cmBinding.view.dispatch({ changes: { from: 0, insert: 'Typed. ' } });

        expect(session.snapshot.text).toContain('Typed.');
        expect(second.view.state.doc.toString()).toContain('Typed.');
      } finally {
        second.destroy();
        secondMount.remove();
      }
    });

    it('tells the session which Source view applied the edit (FR-6.9)', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      const origins: (string | undefined)[] = [];
      session.subscribe((change) => {
        // Only edits carry an identity; a focus move is not a view's work.
        if (change.reason === 'edit') {
          origins.push(change.originId);
        } else {
          // Not an edit: nothing to record.
        }
      });

      cmBinding.view.contentDOM.dispatchEvent(new FocusEvent('focus'));
      cmBinding.view.dispatch({ changes: { from: 0, insert: 'Y' } });

      // A view that does not name itself is indistinguishable from a reload, and every view including
      // this one then re-reads the whole document on every keystroke.
      expect(origins).toHaveLength(1);
      expect(origins[0]).toMatch(/^cm-\d+$/);
    });

    it('starts editable and refuses typing once locked (FR-6.7)', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      // A document opens editable; the lock is something the shell applies, not the default.
      expect(cmBinding.isEditable).toBe(true);
      expect(cmBinding.view.state.facet(EditorView.editable)).toBe(true);

      cmBinding.setEditable(false);
      expect(cmBinding.isEditable).toBe(false);
      // The facet is what actually stops the keystroke, so it is what the test reads.
      expect(cmBinding.view.state.facet(EditorView.editable)).toBe(false);
    });

    it('keeps the document and the caret across a lock', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      cmBinding.view.dispatch({ selection: { anchor: 3 } });

      cmBinding.setEditable(false);

      // Reconfiguring rather than rebuilding is the point: locking must not lose where the reader was.
      expect(cmBinding.view.state.doc.toString()).toBe(SOURCE);
      expect(cmBinding.view.state.selection.main.anchor).toBe(3);
    });

    it('unlocks again and leaves an unchanged call alone', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      cmBinding.setEditable(false);
      cmBinding.setEditable(true);
      expect(cmBinding.view.state.facet(EditorView.editable)).toBe(true);

      // Setting the state it already has must dispatch nothing at all. A transaction that changes no
      // text still reaches every update listener and every plugin, so a redundant one is not free.
      const before = cmBinding.view.state;
      expect(() => {
        cmBinding?.setEditable(true);
      }).not.toThrow();
      expect(cmBinding.view.state).toBe(before);
      expect(cmBinding.isEditable).toBe(true);
    });

    it('still takes session text while locked', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });
      cmBinding.setEditable(false);

      // The lock refuses the reader's typing, not the shell's own sync: a locked pane must still show
      // what the document says, or switching tabs would leave the previous file's text on screen.
      session.reset('Replaced.\n');
      expect(cmBinding.view.state.doc.toString()).toBe('Replaced.\n');
    });

    it('handles multiple destroy calls idempotently without throwing', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      expect(() => {
        cmBinding?.destroy();
        cmBinding?.destroy();
      }).not.toThrow();
    });

    it('unsubscribes from session changes on destruction so later resets do not throw', () => {
      const session = new DocumentSession(SOURCE);
      cmBinding = new CodeMirrorBinding({ session, mount: cmMount });

      cmBinding.destroy();

      // A binding still subscribed after destruction would try to update a destroyed view.
      expect(() => {
        session.reset('Fresh content.\n');
      }).not.toThrow();
    });
  });
});
