/**
 * @file session-mark-saved.spec.ts
 * @purpose Tests DocumentSession.markSaved() — both the no-argument form (records current text as saved) and the new optional `written` argument (records a specific version as saved, enabling three-way merge dirty detection). Covers recording, keeping dirty against an older written text, undoing back to the written text reading clean, and not notifying subscribers.
 * @inputs DocumentSession instance from '../src/session/document-session.js'; vitest test runner APIs; injectable clock for deterministic history semantics.
 * @outputs Test cases asserting snapshot.dirty, snapshot.savedText, spy call counts, and null returns across markSaved scenarios.
 * @functions
 *   - records current text as saved when called with no argument: verifies dirty false and savedText equals the applied text.
 *   - keeps session dirty against an older written text: verifies a stale `written` leaves dirty true and savedText equal to that version.
 *   - undoing back to the written text reads clean: verifies one undo lands on the written text with dirty false (requires DocumentSession.undo()).
 *   - does not notify subscribers when called: verifies the subscribe listener spy is never invoked by markSaved.
 * @dataflow Test setup → new DocumentSession(text, options) → applyExternalText / markSaved calls → snapshot assertions and subscriber-spy call counts.
 * @controlflow Arrange session with injectable clock → mutate text via applyExternalText → invoke markSaved in its variant form → assert on snapshot fields or spy behavior; skip undo case only if undo() is absent.
 * @version 1
 * @date 2026-10-07
 */

import { describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '../src/session/document-session.js';

describe('DocumentSession.markSaved', () => {
  // Inject a monotonic clock so each edit is stamped well outside any coalescing window. This keeps the undo history deterministic: two edits never merge into one entry, so exactly one undo returns to the previous state (case 3).
  const makeClock = (): (() => number) => {
    let ticks = 0;
    // Each tick advances by a full second — larger than any realistic coalescing window in milliseconds.
    return () => ++ticks * 1000;
  };

  it('records the current text as saved when called with no argument', () => {
    const session = new DocumentSession('a', { now: makeClock() });

    // Focus the Source pane so applyExternalText is accepted (it does not require focus, but this mirrors real usage).
    session.focusPane('source');

    // Apply an external edit to move away from the initial saved text 'a'.
    session.applyExternalText('b');

    // markSaved() with no argument records whatever text is currently on disk as the saved baseline.
    session.markSaved();

    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.savedText).toBe('b');
  });

  it('keeps the session dirty when marked saved against an older written text', () => {
    const session = new DocumentSession('a', { now: makeClock() });
    session.focusPane('source');

    // First external edit moves the buffer to 'a1'.
    session.applyExternalText('a1');

    // Capture what another program actually wrote to disk at this point.
    const written = 'a1';

    // A second, later edit advances the buffer further without touching saved state.
    session.applyExternalText('a12');

    // Marking saved against the older `written` records that version as the on-disk baseline rather than the current text.
    session.markSaved(written);

    // Because the current text ('a12') differs from the recorded written text ('a1'), the session stays dirty, which is exactly what makes a three-way merge possible when the two disagree (FR-6.4).
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.savedText).toBe('a1');
  });

  it('reads clean once undone back to the written text', () => {
    // The undo() method exists on DocumentSession, so this case is exercised rather than skipped.
    const session = new DocumentSession('a', { now: makeClock() });
    session.focusPane('source');

    // Advance the buffer through two distinct states captured by an injectable clock (no coalescing).
    session.applyExternalText('a1');

    // The on-disk version to mark saved against is the intermediate state.
    const written = 'a1';

    // Move forward again so the current text diverges from `written`.
    session.applyExternalText('a2');

    // Record the older written version as the saved baseline while the buffer holds a newer value.
    session.markSaved(written);

    // Undoing once restores the state immediately before the last edit, which is exactly `written`.
    const undoChange = session.undo();

    expect(undoChange).not.toBeNull();
    if (undoChange !== null) {
      // The restored text equals the written version.
      expect(undoChange.snapshot.text).toBe(written);
      // With current text now equal to savedText, dirty resolves false — no unsaved work remains.
      expect(undoChange.snapshot.dirty).toBe(false);
    }
  });

  it('does not notify subscribers when called', () => {
    const session = new DocumentSession('a', { now: makeClock() });
    session.focusPane('source');

    // Move the buffer away from its initial saved state so a hypothetical dirty notification would be observable.
    session.applyExternalText('b');

    // Subscribe a spy listener to observe any change notifications emitted by the session (per the subscribe API in document-session.ts).
    const spy = vi.fn();
    session.subscribe(spy);

    // markSaved records saved state without broadcasting, so the subscriber must not be invoked.
    session.markSaved();

    expect(spy).not.toHaveBeenCalled();
  });
});
