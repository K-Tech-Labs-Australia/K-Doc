// @vitest-environment jsdom

/**
 * @file binding.spec.ts
 * @purpose Vitest test suite for ProseMirrorBinding, validating the live bidirectional wiring between a K-Doc DocumentSession and ProseMirror EditorView.
 *   This is the only suite in the repository needing a DOM; it tests the binding logic — loop guards, lock handling, subscription lifecycle — rather than
 *   real typing behaviour. Real input behaviour is what the webview parity harness in packages/app exists for: jsdom cannot tell us how WebView2 handles
 *   a keystroke, but it can tell us the binding does not fight the session.
 * @inputs Source Markdown fixtures, synthetic user typing and selection transactions, DOM focus events, and DocumentSession state mutations.
 * @outputs Vitest assertions verifying construction fidelity, forward edit propagation, byte preservation, selection filtering, loop guard enforcement, edit lock recovery, structural coalescing bypass, and lifecycle teardown.
 * @functions
 *   - mountElement: Creates a container div element, appends it to document.body, and returns it for mounting editor views.
 *   - typeAtEnd: Builds and dispatches a ProseMirror transaction inserting text at the end of the document body.
 * @dataflow Test setup -> DocumentSession & ProseMirrorBinding -> transactions & session events -> state verification across both layers.
 * @controlflow Setup DOM mount and session -> execute test operations across construction, edits, guards, locks, coalescing, and lifecycle suites -> verify assertions -> teardown and destroy bindings in afterEach.
 * @version 1
 * @date 2026-09-04
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding, kdocSchema } from '../src/index.js';
import { TextSelection } from 'prosemirror-state';

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
 * @purpose Builds and dispatches a ProseMirror transaction inserting text at the end of the document body.
 * @inputs binding - The ProseMirrorBinding instance hosting the target view.
 * @inputs text - The string content to insert into the document.
 * @inputs structural - Optional boolean flag tagging the transaction with kdocStructural meta to bypass edit coalescing.
 * @outputs void.
 * @dataflow text & structural flag -> ProseMirror Transaction -> binding.view.dispatch -> binding.handleTransaction.
 * @controlflow Compute end offset -> insertText at target position -> set kdocStructural metadata if requested -> dispatch transaction through view.
 */
function typeAtEnd(binding: ProseMirrorBinding, text: string, structural?: boolean): void {
  const tr = binding.view.state.tr;
  const targetPos = Math.max(0, binding.view.state.doc.content.size - 1);
  tr.insertText(text, targetPos);

  // Check if the transaction is flagged as structural to opt out of history coalescing.
  if (structural === true) {
    // Tag transaction with kdocStructural metadata for individual undoability.
    tr.setMeta('kdocStructural', true);
  } else {
    // Standard edit transaction: retain default coalescing behavior.
  }

  // Dispatching through the view is what routes it into the binding's dispatchTransaction, which is the code under test.
  binding.view.dispatch(tr);
}

describe('ProseMirrorBinding', () => {
  let mount: HTMLElement;
  let binding: ProseMirrorBinding | undefined;

  beforeEach(() => {
    mount = mountElement();
    binding = undefined;
  });

  afterEach(() => {
    // Check if an active binding instance was created during the test.
    if (binding !== undefined) {
      // Destroy the binding to prevent resource leaks across tests.
      binding.destroy();
    } else {
      // No binding instance exists: no action required.
    }

    // Check if the mount element is currently attached to the DOM.
    if (mount.parentNode !== null) {
      // Remove the mount element from document.body.
      mount.parentNode.removeChild(mount);
    } else {
      // Mount element already detached: no action required.
    }
  });

  describe('construction', () => {
    it('mounts a non-empty document containing expected text content', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      expect(binding.view.state.doc.textContent.length > 0).toBe(true);
      expect(binding.view.state.doc.textContent).toContain('Title');
      expect(binding.view.state.doc.textContent).toContain('Last paragraph.');
    });

    it('returns an EditorView configured with kdocSchema', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      expect(binding.view.state.schema).toBe(kdocSchema);
    });
  });

  describe('view edits reach the session', () => {
    it('forwards typed text to the session and updates dirty and undo state', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      typeAtEnd(binding, ' Extra text.');

      expect(session.snapshot.text).toContain(' Extra text.');
      expect(session.snapshot.dirty).toBe(true);
      expect(session.snapshot.canUndo).toBe(true);
    });

    it('preserves untouched byte formatting through incremental serialization', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      typeAtEnd(binding, ' Extra text.');

      // Byte preservation carries through the binding: this is the whole chain working —
      // view to mdast to incremental serializer. A regression here means edits started
      // going through the whole-document path.
      expect(session.snapshot.text).toContain('*   Weird bullet');
    });
  });

  describe('selection-only transactions are not edits', () => {
    it('does not mark the document dirty or record undo history when only selection changes', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      const tr = binding.view.state.tr.setSelection(TextSelection.atStart(binding.view.state.doc));
      binding.view.dispatch(tr);

      // Moving the caret must not create an undo entry or mark the document dirty;
      // forwarding selection transactions is the classic way an editor ends up with a history full of empty steps.
      expect(session.snapshot.dirty).toBe(false);
      expect(session.snapshot.canUndo).toBe(false);
    });
  });

  describe('the loop guard', () => {
    it('synchronizes undo from session without echoing back as a fresh edit', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      typeAtEnd(binding, ' Extra text.');
      session.undo();

      expect(session.snapshot.text).toBe(SOURCE);
      // canRedo remaining true is the observable proof the guard held — had the binding forwarded
      // its own resynchronisation back to the session as a fresh edit, the redo stack would have been cleared.
      expect(session.snapshot.canRedo).toBe(true);
      expect(binding.view.state.doc.textContent).not.toContain(' Extra text.');
    });
  });

  describe('the edit lock (FR-3.1)', () => {
    it('rejects edits when unfocused, notifies onError, and resynchronizes the view', () => {
      const errors: Error[] = [];
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({
        session,
        mount,
        onError: (error: Error): void => {
          errors.push(error);
        },
      });

      session.focusPane('source');
      typeAtEnd(binding, ' Unfocused edit.');

      expect(errors.length).toBe(1);
      const firstError = errors[0];
      expect(firstError?.message).toContain('source');
      expect(session.snapshot.text).toBe(SOURCE);

      // Recovering the view is the important half — reporting the error while leaving the view
      // ahead of the session is how an editor ends up editing a document that no longer exists.
      expect(binding.view.state.doc.textContent).not.toContain(' Unfocused edit.');
    });
  });

  describe('structural transactions opt out of coalescing', () => {
    it('creates separate undo entries for structural edits within the coalescing window', () => {
      let currentTime = 1000;
      const session = new DocumentSession(SOURCE, {
        coalesceWindowMs: 500,
        now: (): number => currentTime,
      });
      binding = new ProseMirrorBinding({ session, mount });

      typeAtEnd(binding, ' Edit 1.');
      currentTime += 1;
      typeAtEnd(binding, ' Edit 2.', true);

      // A structural command must stay individually undoable however fast it follows a keystroke.
      expect(session.snapshot.text).toContain(' Edit 2.');

      session.undo();
      expect(session.snapshot.text).toContain(' Edit 1.');
      expect(session.snapshot.text).not.toContain(' Edit 2.');

      session.undo();
      expect(session.snapshot.text).toBe(SOURCE);
    });
  });

  describe('lifecycle', () => {
    it('claims the edit lock when the editor DOM element receives focus', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      session.focusPane('source');
      expect(session.snapshot.focusedPane).toBe('source');

      // A real focus is always accompanied by a bubbling focusin, which is what the binding listens for.
      binding.view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(session.snapshot.focusedPane).toBe('wysiwyg');
    });

    it('claims the edit lock when focus lands inside an embedded widget', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });
      const inner = document.createElement('span');
      binding.view.dom.appendChild(inner);

      session.focusPane('source');
      // Focus on a descendant -- a raw-HTML editor inside the pane -- must still hand this pane the lock.
      inner.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(session.snapshot.focusedPane).toBe('wysiwyg');
      inner.remove();
    });

    it('handles multiple destroy calls idempotently without throwing', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      expect(() => {
        binding?.destroy();
        binding?.destroy();
      }).not.toThrow();
    });

    it('shows a second view what the first one typed (FR-6.9)', () => {
      const session = new DocumentSession(SOURCE);
      const secondMount = mountElement();
      binding = new ProseMirrorBinding({ session, mount });
      const second = new ProseMirrorBinding({ session, mount: secondMount });

      try {
        // Both views are the WYSIWYG pane, so the pane cannot tell them apart. Before each view had its
        // own identity, both read the edit as their own and neither updated: the second view went stale
        // on the first keystroke, which is the bug that made two views impossible.
        binding.view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        const tr = binding.view.state.tr.insertText('Typed. ', 1);
        binding.view.dispatch(tr);

        expect(session.snapshot.text).toContain('Typed.');
        expect(second.view.state.doc.textBetween(0, second.view.state.doc.content.size, ' ')).toContain('Typed.');
      } finally {
        second.destroy();
        secondMount.remove();
      }
    });

    it('tells the session which view applied the edit (FR-6.9)', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });
      const origins: (string | undefined)[] = [];
      session.subscribe((change) => {
        // Only edits carry an identity; a focus move is not a view's work.
        if (change.reason === 'edit') {
          origins.push(change.originId);
        } else {
          // Not an edit: nothing to record.
        }
      });

      binding.view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      binding.view.dispatch(binding.view.state.tr.insertText('X', 1));

      // A view that does not name itself is indistinguishable from a reload, and every view including
      // this one then re-renders on every keystroke.
      expect(origins).toHaveLength(1);
      expect(origins[0]).toMatch(/^pm-\d+$/);
    });

    it('does not re-render the view that made the edit', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      binding.view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const tr = binding.view.state.tr.insertText('X', 1);
      binding.view.dispatch(tr);
      const after = binding.view.state;

      // Its own edit must not come back as someone else's. A re-render replaces the whole EditorState
      // with one built from the session, so the document the transaction produced would be thrown away
      // and rebuilt -- an equal document, but not the same one. Identity is what distinguishes the two.
      expect(after.doc).toBe(tr.doc);
    });

    it('unsubscribes from session changes on destruction', () => {
      const session = new DocumentSession(SOURCE);
      binding = new ProseMirrorBinding({ session, mount });

      binding.destroy();

      // A binding still subscribed after destruction would try to update a destroyed view.
      expect(() => {
        session.reset('Fresh.\n');
      }).not.toThrow();
    });
  });
});
