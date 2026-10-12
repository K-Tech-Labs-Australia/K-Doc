/**
 * @file document-session.spec.ts
 * @purpose Vitest test suite for DocumentSession, K-Doc's authoritative editor-bridge state machine and edit coordinator.
 * @inputs Source Markdown strings, mutated mdast Root trees, replacement Markdown text, pane IDs, and change subscription callbacks.
 * @outputs Vitest test assertions validating session construction, single-pane edit locking (FR-3.1), byte-preservation on incremental tree edits, undo/redo restoration, edit coalescing, dirty flag tracking, subscriber notifications, and external reset (FR-6.4).
 * @functions
 *   - paragraph: Constructs a synthetic mdast Paragraph AST node wrapping a Text child node.
 *   - fakeClock: Creates an injectable controllable clock starting at timestamp 1000 for deterministic history coalescing tests.
 *   - withLastReplaced: Deep-clones a session document's root AST and replaces its last child block with a new paragraph.
 * @dataflow Source Markdown text -> DocumentSession -> applyTree / applyText / undo / redo / reset -> SessionSnapshot & SessionChange -> state and structural assertions.
 * @controlflow Execute test suites across construction, edit lock enforcement, byte preservation, undo/redo cycles, clock-driven coalescing, dirty tracking, listener notifications, and reset reloading.
 * @version 1
 * @date 2026-09-04
 */

import type { Paragraph, Root, Text } from 'mdast';
import { describe, expect, it } from 'vitest';
import { DocumentSession, type SessionChange } from '../src/index.js';

/**
 * Constructs a synthetic mdast Paragraph AST node without position metadata.
 *
 * @purpose Constructs a synthetic Paragraph AST node wrapping a Text child node.
 * @inputs text - The raw string text content for the paragraph.
 * @outputs Paragraph - A synthetic mdast Paragraph AST node.
 * @dataflow text string -> Text child node -> Paragraph parent node.
 * @controlflow Wrap string value in a Text node -> construct and return a Paragraph node containing the Text node.
 */
function paragraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: text } as Text],
  };
}

/**
 * Creates a controllable monotonic fake clock for deterministic coalescing tests.
 *
 * @purpose Creates an injectable controllable clock starting at timestamp 1000 for deterministic history coalescing tests without relying on flaky wall-clock timers.
 * @inputs void.
 * @outputs { now: () => number; advance: (ms: number) => void } - Clock interface with current time reader and time advancement mutator.
 * @dataflow currentTime state variable -> now() getter returns currentTime; advance(ms) increments currentTime.
 * @controlflow Initialize currentTime to 1000 -> return object exposing now and advance closures.
 */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  // Coalescing is tested with an injected clock rather than real timers, because a test that depends on wall-clock timing is a flaky test.
  let currentTime = 1000;
  return {
    now: (): number => currentTime,
    advance: (ms: number): void => {
      currentTime += ms;
    },
  };
}

/**
 * Deep-clones a session document's root AST and replaces its last child block with a new paragraph.
 *
 * @purpose Deep-clones the session document root AST using structuredClone and replaces its last child with a synthetic paragraph.
 * @inputs session - The active DocumentSession providing the baseline document AST.
 * @inputs text - The raw text content for the replacement paragraph node.
 * @outputs Root - A new independent mdast Root AST tree with the last child replaced.
 * @dataflow session.snapshot.document.root -> structuredClone -> mutated root AST -> return cloned Root.
 * @controlflow Clone session document root -> replace last child in children array with paragraph(text) -> return cloned Root.
 */
function withLastReplaced(session: DocumentSession, text: string): Root {
  const root: Root = structuredClone(session.snapshot.document.root);
  const replacement: Paragraph = paragraph(text);
  // Check if children array has existing elements to replace the last child safely under noUncheckedIndexedAccess.
  if (root.children.length > 0) {
    // Replace the last child element with the new paragraph node.
    root.children.splice(root.children.length - 1, 1, replacement);
  } else {
    // Array is empty: push the new paragraph node as the first child.
    root.children.push(replacement);
  }
  return root;
}

// Use a non-canonical source with 3-space bullet indentation ('*   ') to verify byte-preservation.
// The odd bullet spacing is deliberate: whole-document serializers would normalize this to '* ',
// but incremental serialization and undo must preserve the original untouched bytes byte-for-byte.
const SOURCE = '# Title\n\n*   Weird bullet\n\nLast paragraph.\n';

describe('construction', () => {
  it('initializes with source text, clean state, empty history, and default wysiwyg focus', () => {
    const session = new DocumentSession(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.canUndo).toBe(false);
    expect(session.snapshot.canRedo).toBe(false);
    expect(session.snapshot.focusedPane).toBe('wysiwyg');
  });
});

describe('the edit lock (FR-3.1)', () => {
  it('prevents unfocused pane from applying edits and permits focused pane edits', () => {
    const session = new DocumentSession(SOURCE);

    // On a fresh session, the WYSIWYG pane holds focus. Applying text from the Source pane must throw.
    // This invariant is what stops the two document models diverging silently.
    expect(() => session.applyText('x')).toThrow(/wysiwyg/);

    // Transfer edit focus to the Source pane.
    session.focusPane('source');
    expect(session.snapshot.focusedPane).toBe('source');

    // While Source is focused, applying a WYSIWYG AST tree edit must throw and mention 'source'.
    const updatedTree = withLastReplaced(session, 'Updated.');
    expect(() => session.applyTree(updatedTree)).toThrow(/source/);

    // Applying text from the now-focused Source pane succeeds and updates the snapshot text.
    session.applyText('New text.\n');
    expect(session.snapshot.text).toBe('New text.\n');
  });
});

describe('applyTree preserves untouched bytes', () => {
  it('preserves untouched non-canonical formatting and marks session dirty and undoable', () => {
    const session = new DocumentSession(SOURCE);
    const updatedTree = withLastReplaced(session, 'Replaced paragraph.');

    // Apply the tree edit from the focused WYSIWYG pane.
    const change = session.applyTree(updatedTree);

    // The bridge inherits byte preservation from the incremental serializer,
    // and this test is what stops a future refactor quietly routing edits through the whole-document path.
    expect(session.snapshot.text).toContain('*   Weird bullet');
    expect(session.snapshot.text).toContain('Replaced paragraph.');
    expect(change.snapshot.text).toContain('*   Weird bullet');
    expect(change.snapshot.text).toContain('Replaced paragraph.');

    // Assert that the session state transitions to dirty and undo is now available.
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.canUndo).toBe(true);
  });
});

describe('undo and redo', () => {
  it('restores the exact byte-identical source on undo and reapplies edit on redo', () => {
    const session = new DocumentSession(SOURCE);
    const updatedTree = withLastReplaced(session, 'Replaced paragraph.');
    session.applyTree(updatedTree);

    // Perform undo operation after one edit.
    const undoChange = session.undo();

    // Byte-identical restoration is the point: non-canonical bullet spacing must be restored exactly.
    expect(undoChange?.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.canUndo).toBe(false);
    expect(session.snapshot.canRedo).toBe(true);

    // Perform redo operation to reapply the undone edit.
    const redoChange = session.redo();
    expect(redoChange?.snapshot.text).toContain('Replaced paragraph.');
    expect(session.snapshot.text).toContain('Replaced paragraph.');
    expect(session.snapshot.canUndo).toBe(true);
    expect(session.snapshot.canRedo).toBe(false);
  });

  it('returns null and does not throw when undo or redo is called on a fresh session', () => {
    const session = new DocumentSession(SOURCE);

    // Undo on a fresh session with empty history returns null without throwing.
    expect(session.undo()).toBe(null);

    // Redo on a fresh session with empty history returns null without throwing.
    expect(session.redo()).toBe(null);
  });

  it('clears redo stack when a new edit is applied after an undo', () => {
    const session = new DocumentSession(SOURCE);

    // First edit.
    session.applyTree(withLastReplaced(session, 'First edit.'));
    expect(session.snapshot.canUndo).toBe(true);

    // Undo the first edit: redo is now available.
    session.undo();
    expect(session.snapshot.canRedo).toBe(true);

    // Second edit after undo: must clear the redo history.
    session.applyTree(withLastReplaced(session, 'Second edit.'));
    expect(session.snapshot.canRedo).toBe(false);
  });
});

describe('coalescing through the session', () => {
  it('coalesces two applyTree edits within the time window into a single undo step', () => {
    const clock = fakeClock();
    const session = new DocumentSession(SOURCE, {
      now: clock.now,
      coalesceWindowMs: 500,
    });

    // First edit at t = 1000.
    session.applyTree(withLastReplaced(session, 'Edit one.'));

    // Advance clock by 100ms (within the 500ms coalesce window).
    clock.advance(100);

    // Second edit at t = 1100.
    session.applyTree(withLastReplaced(session, 'Edit two.'));

    // A single undo returns all the way to SOURCE because the two edits coalesced.
    const undoChange = session.undo();
    expect(undoChange?.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.canUndo).toBe(false);
  });

  it('does not coalesce two edits separated by more than the coalesce window', () => {
    const clock = fakeClock();
    const session = new DocumentSession(SOURCE, {
      now: clock.now,
      coalesceWindowMs: 500,
    });

    // First edit at t = 1000.
    session.applyTree(withLastReplaced(session, 'Edit one.'));
    const textAfterFirstEdit = session.snapshot.text;

    // Advance clock by 900ms (exceeds the 500ms coalesce window).
    clock.advance(900);

    // Second edit at t = 1900.
    session.applyTree(withLastReplaced(session, 'Edit two.'));

    // First undo returns to the state after the first edit, not SOURCE.
    const firstUndo = session.undo();
    expect(firstUndo?.snapshot.text).toBe(textAfterFirstEdit);
    expect(session.snapshot.text).toBe(textAfterFirstEdit);
    expect(session.snapshot.canUndo).toBe(true);

    // Second undo returns to SOURCE.
    const secondUndo = session.undo();
    expect(secondUndo?.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.canUndo).toBe(false);
  });

  it('does not coalesce when coalesce option is explicitly false', () => {
    const clock = fakeClock();
    const session = new DocumentSession(SOURCE, {
      now: clock.now,
      coalesceWindowMs: 500,
    });

    // First edit at t = 1000.
    session.applyTree(withLastReplaced(session, 'Edit one.'));
    const textAfterFirstEdit = session.snapshot.text;

    // Advance clock by 1ms (well within the window, but coalesce is disabled on the next edit).
    clock.advance(1);

    // Second edit with coalesce explicitly set to false.
    session.applyTree(withLastReplaced(session, 'Edit two.'), { coalesce: false });

    // First undo returns to text after first edit.
    const firstUndo = session.undo();
    expect(firstUndo?.snapshot.text).toBe(textAfterFirstEdit);
    expect(session.snapshot.text).toBe(textAfterFirstEdit);

    // Second undo returns to SOURCE.
    const secondUndo = session.undo();
    expect(secondUndo?.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
  });

  it('prevents coalescing across a pane switch between two fast edits', () => {
    const clock = fakeClock();
    const session = new DocumentSession(SOURCE, {
      now: clock.now,
      coalesceWindowMs: 500,
    });

    // Edit in WYSIWYG pane at t = 1000.
    session.applyTree(withLastReplaced(session, 'WYSIWYG edit.'));
    const textAfterWysiwygEdit = session.snapshot.text;

    // Advance clock by 10ms (well within window).
    clock.advance(10);

    // Switch focus to Source pane: this ends the open typing run.
    // Merging across a pane switch would produce one undo entry spanning two engines.
    session.focusPane('source');

    // Apply text edit from Source pane at t = 1010.
    session.applyText('Source edit content.\n');

    // Assert two undos are needed to reach SOURCE.
    const firstUndo = session.undo();
    expect(firstUndo?.snapshot.text).toBe(textAfterWysiwygEdit);
    expect(session.snapshot.text).toBe(textAfterWysiwygEdit);

    const secondUndo = session.undo();
    expect(secondUndo?.snapshot.text).toBe(SOURCE);
    expect(session.snapshot.text).toBe(SOURCE);
  });
});

describe('dirty tracking', () => {
  it('tracks dirty flag across edits and markSaved while preserving undo history', () => {
    const session = new DocumentSession(SOURCE);

    // New session starts clean.
    expect(session.snapshot.dirty).toBe(false);

    // Edit makes session dirty.
    session.applyTree(withLastReplaced(session, 'Edit 1.'));
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.canUndo).toBe(true);

    // markSaved clears dirty flag but does not clear undo history.
    session.markSaved();
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.canUndo).toBe(true);

    // Another edit makes session dirty again.
    session.applyTree(withLastReplaced(session, 'Edit 2.'));
    expect(session.snapshot.dirty).toBe(true);
  });
});

describe('subscribers', () => {
  it('notifies subscribers with the expected reason for each operation', () => {
    const session = new DocumentSession(SOURCE);
    const receivedReasons: string[] = [];

    session.subscribe((change: SessionChange): void => {
      receivedReasons.push(change.reason);
    });

    // 1. applyTree -> 'edit'
    session.applyTree(withLastReplaced(session, 'Edit.'));

    // 2. undo -> 'undo'
    session.undo();

    // 3. redo -> 'redo'
    session.redo();

    // 4. focusPane to 'source' -> 'focus'
    session.focusPane('source');

    // 5. reset -> 'reset'
    session.reset('Reset content.\n');

    expect(receivedReasons).toEqual(['edit', 'undo', 'redo', 'focus', 'reset']);
  });

  it('does not notify subscribers when focusing the already-focused pane', () => {
    const session = new DocumentSession(SOURCE);
    let callCount = 0;

    session.subscribe((): void => {
      callCount += 1;
    });

    // Record call count before focusing already-focused 'wysiwyg' pane.
    const beforeCount = callCount;
    session.focusPane('wysiwyg');
    const afterCount = callCount;

    expect(afterCount).toBe(beforeCount);
    expect(afterCount).toBe(0);
  });

  it('stops delivery when the disposer returned by subscribe is invoked', () => {
    const session = new DocumentSession(SOURCE);
    let callCount = 0;

    const unsubscribe = session.subscribe((): void => {
      callCount += 1;
    });

    session.applyTree(withLastReplaced(session, 'First edit.'));
    expect(callCount).toBe(1);

    // Invoke unsubscription disposer.
    unsubscribe();

    // Next edit should not deliver notification to unsubscribed listener.
    session.applyTree(withLastReplaced(session, 'Second edit.'));
    expect(callCount).toBe(1);
  });

  it('delivers notifications safely when a listener unsubscribes itself during dispatch', () => {
    const session = new DocumentSession(SOURCE);
    let firstRan = false;
    let secondRan = false;
    let thirdRan = false;

    // First listener.
    session.subscribe((): void => {
      firstRan = true;
    });

    // Second listener that unregisters itself when invoked.
    let unsubscribeSecond: (() => void) | undefined;
    unsubscribeSecond = session.subscribe((): void => {
      secondRan = true;
      // Check if unsubscribeSecond disposer is defined before calling.
      if (unsubscribeSecond !== undefined) {
        unsubscribeSecond();
      } else {
        // Disposer undefined.
      }
    });

    // Third listener.
    session.subscribe((): void => {
      thirdRan = true;
    });

    // This is why notify iterates a copy: a listener unsubscribing itself during notification
    // must not corrupt iteration or break delivery to subsequent listeners in the list.
    session.applyTree(withLastReplaced(session, 'Notification test.'));

    expect(firstRan).toBe(true);
    expect(secondRan).toBe(true);
    expect(thirdRan).toBe(true);
  });
});

describe('reset (FR-6.4)', () => {
  it('replaces text content, clears dirty flag, and clears undo/redo history', () => {
    const session = new DocumentSession(SOURCE);

    // Apply an edit to make session dirty and populate undo history.
    session.applyTree(withLastReplaced(session, 'Prior edit.'));
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.canUndo).toBe(true);

    // Reset with new content.
    session.reset('New content.\n');

    expect(session.snapshot.text).toBe('New content.\n');
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.canUndo).toBe(false);
    expect(session.snapshot.canRedo).toBe(false);
  });
});

describe('dirty tracks the saved text, not a flag', () => {
  it('reads clean again after undoing back to the saved text', () => {
    const session = new DocumentSession('# Title\n\nBody.\n');
    session.focusPane('source');

    session.applyText('# Title\n\nBody edited.\n');
    expect(session.snapshot.dirty).toBe(true);

    // A boolean flag set on every edit and cleared only on save cannot answer this. Undo restores the
    // saved text exactly, so the document is not different from what is on disk, and a status bar
    // claiming unsaved work here is simply reporting something untrue.
    session.undo();
    expect(session.snapshot.text).toBe('# Title\n\nBody.\n');
    expect(session.snapshot.dirty).toBe(false);
  });

  it('reads dirty again after redoing away from the saved text', () => {
    const session = new DocumentSession('Body.\n');
    session.focusPane('source');
    session.applyText('Body edited.\n');
    session.undo();
    expect(session.snapshot.dirty).toBe(false);

    session.redo();
    expect(session.snapshot.dirty).toBe(true);
  });

  it('reports back the identity the applying view gave (FR-6.9)', () => {
    const session = new DocumentSession('Body.\n');
    const seen: (string | undefined)[] = [];
    session.subscribe((change) => {
      seen.push(change.originId);
    });

    session.focusPane('source');
    // Two views of one pane cannot be told apart by the pane, so the change has to carry whatever the
    // applying view called itself.
    session.applyText('From one.\n', { originId: 'view-1' });
    session.applyText('From two.\n', { originId: 'view-2' });

    expect(seen).toEqual([undefined, 'view-1', 'view-2']);
  });

  it('reports back the identity a WYSIWYG view gave (FR-6.9)', () => {
    const session = new DocumentSession('Body.\n');
    const seen: (string | undefined)[] = [];
    session.subscribe((change) => {
      seen.push(change.originId);
    });

    // applyTree is the WYSIWYG path and applyText the Source one; both carry the identity, or the
    // second WYSIWYG view would be told nothing about edits made in the first.
    session.applyTree(session.snapshot.document.root, { originId: 'tree-view' });

    expect(seen).toEqual(['tree-view']);
  });

  it('leaves the identity off when no view claimed the change', () => {
    const session = new DocumentSession('Body.\n');
    const seen: { reason: string; origin: string | undefined }[] = [];
    session.subscribe((change) => {
      seen.push({ reason: change.reason, origin: change.originId });
    });

    session.focusPane('source');
    session.applyText('Edited.\n');
    session.undo();
    session.reset('Fresh.\n');

    // An edit with no identity, an undo and a reset were applied by nothing that is a view, so a view
    // reading the identity must not mistake any of them for its own work and skip the update.
    expect(seen.every((entry) => entry.origin === undefined)).toBe(true);
    expect(seen.map((entry) => entry.reason)).toEqual(['focus', 'edit', 'undo', 'reset']);
  });

  it('treats the text at the moment of markSaved as the new clean state', () => {
    const session = new DocumentSession('Body.\n');
    session.focusPane('source');
    session.applyText('Body edited.\n');
    session.markSaved();
    expect(session.snapshot.dirty).toBe(false);

    // Undoing now moves AWAY from what is on disk, so it must read dirty -- the mirror image of the
    // first test, and the case a naive `dirty = false on undo` shortcut would get wrong.
    session.undo();
    expect(session.snapshot.text).toBe('Body.\n');
    expect(session.snapshot.dirty).toBe(true);
  });
});
