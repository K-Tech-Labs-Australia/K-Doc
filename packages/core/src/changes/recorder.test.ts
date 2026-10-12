/**
 * @file recorder.test.ts
 * @purpose A Vitest suite exercising createChangeRecorder end-to-end against a real DocumentSession, covering every recording decision: off-state suppression, insert/delete/replacement diffs, undo/redo and external-change exclusion, withoutRecording suppression (including after a throw), baseline adoption on enable, destroy teardown, and live tracking state.
 * @inputs harness() — initial document text; each test drives the recorder through edits and asserts on captured TrackedChange values.
 * @outputs Zero recorded changes or specific TrackedChange shapes depending on the scenario under test.
 * @functions
 *   - harness: build a focused session, a recorder capturing into an array, and an edit helper bound to applyText.
 *   - assertDefined: type-narrowing assertion replacing inline undefined guards inside tests.
 * @dataflow Session notifications → recorder listener → onRecord sink pushes TrackedChange into recorded; test edits route through harness.edit → session.applyText → same notification path.
 * @controlflow For each test: construct fixture → optionally enable tracking → perform an edit or control call → assert against recorded and tracker state.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../session/document-session.js';
import { createChangeRecorder, type ChangeRecorder } from './recorder.js';
import type { TrackedChange } from './change.js';

/**
 * @purpose Builds a test fixture wiring a recorder to a focused session and capturing every recorded change in an array.
 * @inputs text — initial document content the DocumentSession parses on construction.
 * @outputs A record exposing the live session, the recorder, the captured TrackedChange list, and an edit helper bound to applyText.
 * @dataflow Session notifications flow through the recorder listener into recorded; harness.edit routes each next-text value through applyText so it notifies that same listener.
 * @controlflow Construct session → claim source focus once → build recorder with fixed author/id/clock/onRecord → return fixture object.
 */
function harness(text: string): {
  readonly session: DocumentSession;
  readonly recorder: ChangeRecorder;
  readonly recorded: TrackedChange[];
  readonly edit: (next: string) => void;
} {
  const session = new DocumentSession(text);
  // The edit lock (FR-3.1) makes applyText throw for any pane that does not hold focus, so the harness claims 'source' once up front and every subsequent edit is accepted without re-focusing.
  session.focusPane('source');

  const recorded: TrackedChange[] = [];
  let n = 0; // Monotonic counter feeding newId so each change receives a stable, unique id such as c0 or c1.
  const recorder = createChangeRecorder({
    session,
    author: (): string => 'Ada',
    newId: () => `c${n++}`,
    now: () => new Date('2026-09-07T10:00:00.000Z'),
    onRecord: (changes) => { recorded.push(...changes); },
  });

  const edit = (next: string): void => { session.applyText(next); };

  return { session, recorder, recorded, edit };
}

/**
 * @purpose Narrows a possibly-undefined value to defined via an assertion so tests can read it without inline undefined guards.
 * @inputs value — the expression under test, typed as T | undefined (typically an array element that may be absent).
 * @outputs void; on mismatch expect throws and narrows subsequent reads of value to T within this scope.
 * @dataflow The passed reference is compared against undefined and forwarded unchanged when it holds a value.
 * @controlflow Assert non-undefined → throw via expect on failure, otherwise pass through so the caller can read the narrowed local directly.
 */
function assertDefined<T>(value: T | undefined): asserts value is T {
  expect(value).not.toBeUndefined();
}

describe('recorder', () => {
  it('records nothing while tracking is off', () => {
    const h = harness('The fox');
    h.edit('The quick fox'); // An edit made before tracking starts must not be captured.
    expect(h.recorded).toHaveLength(0);
    expect(h.recorder.tracking).toBe(false);
  });

  it('records an insertion', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.edit('The quick fox'); // Inserts 'quick ' between 'The ' and 'fox'.
    expect(h.recorded).toHaveLength(1);
    assertDefined(h.recorded[0]);
    expect(h.recorded[0].kind).toBe('insert');
    expect(h.recorded[0].text).toBe('quick ');
    expect(h.recorded[0].author).toBe('Ada');
    expect(h.recorded[0].createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('records a deletion', () => {
    const h = harness('The quick fox');
    h.recorder.setTracking(true);
    h.edit('The fox'); // Removes 'quick '.
    expect(h.recorded).toHaveLength(1);
    assertDefined(h.recorded[0]);
    expect(h.recorded[0].kind).toBe('delete');
    expect(h.recorded[0].text).toBe('quick ');
  });

  it('records a replacement as delete then insert', () => {
    const h = harness('The quick fox');
    h.recorder.setTracking(true);
    h.edit('The slow fox'); // 'quick ' becomes 'slow ': one deletion followed by one insertion.
    expect(h.recorded).toHaveLength(2);
    assertDefined(h.recorded[0]);
    assertDefined(h.recorded[1]);
    expect(h.recorded[0].kind).toBe('delete');
    expect(h.recorded[1].kind).toBe('insert');
  });

  it('does not record an undo', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.edit('The quick fox'); // One change recorded here.
    expect(h.recorded).toHaveLength(1);
    h.session.undo(); // The user retracting their own work is not new authorship, so it must not manufacture a change.
    expect(h.recorded).toHaveLength(1);
  });

  it('does not record a redo', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.edit('The quick fox'); // One change recorded here.
    expect(h.recorded).toHaveLength(1);
    h.session.undo();
    h.session.redo(); // Restoring the same work is likewise not new authorship and records nothing.
    expect(h.recorded).toHaveLength(1);
  });

  it('does not record an external change', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.session.applyExternalText('Something else entirely'); // A file reloaded from disk is not the author's edit, so it must be ignored.
    expect(h.recorded).toHaveLength(0);
  });

  it('suppresses an edit made within withoutRecording', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.recorder.withoutRecording(() => { // This is what stops a change from recording a change about the rejection, which would never terminate.
      h.edit('The quick fox');
    });
    expect(h.recorded).toHaveLength(0);
  });

  it('clears suppression after an editing throw', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    expect(() => h.recorder.withoutRecording(() => { // A suppressed edit that fails must still release its flag on the way out.
      throw new Error('boom');
    })).toThrow('boom');
    h.edit('The quick fox'); // The next real edit is recorded, proving suppression was cleared rather than left stuck.
    expect(h.recorded).toHaveLength(1);
  });

  it('adopts live text when tracking turns on', () => {
    const h = harness('a');
    h.edit('ab'); // Work done while off is not attributed retroactively once tracking resumes.
    expect(h.recorded).toHaveLength(0);
    h.recorder.setTracking(true); // Baseline adopts 'ab' as the starting point for subsequent diffs.
    h.edit('abc'); // Only 'c' is new relative to that adopted baseline.
    expect(h.recorded).toHaveLength(1);
    assertDefined(h.recorded[0]);
    expect(h.recorded[0].text).toBe('c');
  });

  it('stops recording after destroy', () => {
    const h = harness('The fox');
    h.recorder.setTracking(true);
    h.recorder.destroy(); // Detaches the listener, so later edits reach no recorder.
    h.edit('The quick fox');
    expect(h.recorded).toHaveLength(0);
  });

  it('reflects live tracking state through the getter', () => {
    const h = harness('The fox'); // Off by default at construction time.
    expect(h.recorder.tracking).toBe(false);
    h.recorder.setTracking(true);
    expect(h.recorder.tracking).toBe(true);
    h.recorder.setTracking(false);
    expect(h.recorder.tracking).toBe(false);
  });
});
