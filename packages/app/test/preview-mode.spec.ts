// @vitest-environment jsdom

/**
 * @file preview-mode.spec.ts
 * @purpose Vitest test suite for K-Doc's Preview mode and view-mode cycle transitions (FR-5.4, FR-5.7).
 *   Validates view mode cycle ordering, circular wraparound, unknown mode fallback, preview positioning,
 *   ProseMirrorBinding read-only toggle, DOM contenteditable reflection, and document text preservation.
 * @inputs Markdown test fixtures, ViewMode cycle enumerations, and ProseMirrorBinding editable state toggles.
 * @outputs Vitest test assertions verifying view mode cycle behavior, DOM contenteditable attributes, isEditable state, and document content stability across read-only mode transitions.
 * @functions
 *   - mountBinding: Creates a DOM container on document.body, initializes a DocumentSession and ProseMirrorBinding, claims WYSIWYG focus, records them for afterEach teardown, and returns the binding instance.
 * @dataflow Markdown fixture -> DocumentSession -> ProseMirrorBinding -> setEditable DOM mutations -> attribute & document assertions.
 * @controlflow Mount DOM elements & bindings -> execute test assertions across cycle behavior and read-only switches -> assert DOM attributes and session text -> tear down bindings and mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '@k-doc/editor';
import { nextViewMode, VIEW_MODE_CYCLE, type ViewMode } from '../src/shell/editor-shell.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];

afterEach(() => {
  for (const binding of activeBindings) {
    binding.destroy();
  }
  activeBindings = [];

  for (const mount of activeMounts) {
    // Check if mount element is currently attached to the DOM.
    if (mount.parentNode !== null) {
      // Mount element is attached: remove it from document.body.
      mount.parentNode.removeChild(mount);
    } else {
      // Mount element already detached: no action required.
    }
  }
  activeMounts = [];
});

/**
 * Creates a container div on document.body, builds a DocumentSession,
 * claims WYSIWYG focus, constructs a ProseMirrorBinding, records both
 * for teardown, and returns the binding.
 *
 * @purpose Sets up an isolated ProseMirrorBinding instance mounted in the DOM for testing read-only toggle behaviors.
 * @inputs markdown - Raw Markdown source string used to initialize the DocumentSession.
 * @outputs ProseMirrorBinding - The initialized and mounted editor binding instance.
 * @dataflow markdown -> DocumentSession -> focusPane('wysiwyg') -> ProseMirrorBinding -> recorded in active tracking arrays -> return binding.
 * @controlflow Create container div -> append to document.body -> record in activeMounts -> instantiate DocumentSession -> set focusedPane to 'wysiwyg' -> instantiate ProseMirrorBinding -> record in activeBindings -> return binding.
 */
function mountBinding(markdown: string): ProseMirrorBinding {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const session = new DocumentSession(markdown);
  session.focusPane('wysiwyg');

  const binding = new ProseMirrorBinding({ session, mount });
  activeBindings.push(binding);

  return binding;
}

// This suite tests the two pieces that can be tested without instantiating the whole EditorShell —
// the cycle function and the binding's read-only switch. EditorShell mounts CodeMirror, a watcher,
// autosave and a command palette, and standing all of that up in jsdom to assert a CSS class would test
// the harness more than the feature.

describe('the view mode cycle', () => {
  it('contains exactly wysiwyg, split, source, preview in that order', () => {
    expect(VIEW_MODE_CYCLE).toEqual(['wysiwyg', 'split', 'source', 'preview']);
  });

  it('steps through each mode in order and wraps from the last back to the first', () => {
    // Assert every step explicitly rather than looping, so a reordering names which pair broke.
    expect(nextViewMode('wysiwyg')).toBe('split');
    expect(nextViewMode('split')).toBe('source');
    expect(nextViewMode('source')).toBe('preview');
    expect(nextViewMode('preview')).toBe('wysiwyg');
  });

  it('returns to the starting mode after cycling four times from any starting mode', () => {
    // A cycle which does not close would strand the user in a subset of the modes.
    for (const mode of VIEW_MODE_CYCLE) {
      let current: ViewMode = mode;
      for (let step = 0; step < 4; step++) {
        current = nextViewMode(current);
      }
      expect(current).toBe(mode);
    }
  });

  it('returns the first entry rather than staying put when given an unrecognised mode', () => {
    // A shortcut which silently does nothing is the worst possible response to an unexpected state,
    // because the user presses it again harder.
    const result = nextViewMode('nonsense' as unknown as ViewMode);
    const firstMode = VIEW_MODE_CYCLE[0];

    // Check that the first mode is defined under noUncheckedIndexedAccess.
    if (firstMode !== undefined) {
      // First mode exists: assert result matches the first entry in the cycle.
      expect(result).toBe(firstMode);
    } else {
      // First mode missing: fail fast on invalid cycle constant configuration.
      throw new Error('VIEW_MODE_CYCLE must contain at least one entry');
    }
    expect(result).toBe('wysiwyg');
  });

  it('positions preview last in the cycle', () => {
    // It sits last deliberately: it is the only mode you cannot type in,
    // so someone cycling to find a writing layout passes every editable one first.
    const lastIndex = VIEW_MODE_CYCLE.length - 1;
    const lastMode = VIEW_MODE_CYCLE[lastIndex];

    // Check that the last element is defined under noUncheckedIndexedAccess before asserting.
    if (lastMode !== undefined) {
      // Last mode exists: assert it is 'preview'.
      expect(lastMode).toBe('preview');
    } else {
      // Last mode undefined: fail fast on empty cycle array.
      throw new Error('VIEW_MODE_CYCLE must not be empty');
    }
  });
});

describe('the read-only switch', () => {
  it('reports isEditable === true on a freshly mounted binding', () => {
    const binding = mountBinding('Freshly mounted content.\n');
    expect(binding.isEditable).toBe(true);
  });

  it('makes isEditable false and sets contenteditable="false" on the ProseMirror DOM', () => {
    const binding = mountBinding('Editable text.\n');
    binding.setEditable(false);

    expect(binding.isEditable).toBe(false);
    // This is the property that actually stops typing, and that asserting it
    // rather than the flag is what proves the flag reached ProseMirror.
    expect(binding.view.dom.getAttribute('contenteditable')).toBe('false');
  });

  it('restores contenteditable="true" on the ProseMirror DOM when setEditable(true) is called', () => {
    const binding = mountBinding('Editable text.\n');
    binding.setEditable(false);
    expect(binding.isEditable).toBe(false);
    expect(binding.view.dom.getAttribute('contenteditable')).toBe('false');

    binding.setEditable(true);
    expect(binding.isEditable).toBe(true);
    expect(binding.view.dom.getAttribute('contenteditable')).toBe('true');
  });

  it('treats redundant setEditable calls as no-ops without throwing and leaves isEditable unchanged', () => {
    const binding = mountBinding('Idempotency check.\n');
    expect(binding.isEditable).toBe(true);

    // Redundant call with the value it already has (true).
    expect(() => {
      binding.setEditable(true);
    }).not.toThrow();
    expect(binding.isEditable).toBe(true);
    expect(binding.view.dom.getAttribute('contenteditable')).toBe('true');

    // Switch to false and invoke redundant call with false.
    binding.setEditable(false);
    expect(binding.isEditable).toBe(false);
    expect(() => {
      binding.setEditable(false);
    }).not.toThrow();
    expect(binding.isEditable).toBe(false);
    expect(binding.view.dom.getAttribute('contenteditable')).toBe('false');
  });

  it('preserves document text content across the read-only round trip', () => {
    const initialText = '# Heading\n\nBody text content surviving round trip.\n';
    const binding = mountBinding(initialText);

    const textBefore = binding.view.state.doc.textContent;

    // This is why the pane is switched rather than rebuilt — a rebuild would
    // discard the caret and the session's undo history for the sake of one boolean.
    binding.setEditable(false);
    binding.setEditable(true);

    const textAfter = binding.view.state.doc.textContent;
    expect(textAfter).toBe(textBefore);
  });
});
