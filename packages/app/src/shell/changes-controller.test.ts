// @vitest-environment jsdom
/**
 * @file changes-controller.test.ts
 * @purpose Vitest suite exercising createChangesController end-to-end against a fake AnnotationStore and the real DocumentSession, covering tracking gating, accept/reject semantics, decideAll author filtering, persistence wiring, and mode-driven replanning.
 * @inputs Document text; per-test setTracking/setMode calls; edit() driving session.applyText; card decisions via controller.decide/decideAll.
 * @outputs Controller surface assertions: changes(), tracking, mode, snapshot.text, saved[], spans[], errors[].
 * @functions
 *   - assertDefined: Asserts a value is not undefined, narrowing its type for downstream reads.
 *   - settle: Drains the microtask queue so fire-and-forget persistence completes before assertions read saved[].
 *   - harness: Builds a DocumentSession (claiming focus), fake store, and controller wired to recorded sinks; exposes edit().
 * @dataflow Test edits → session.applyText → recorder.onRecord → records + refresh/persist; decide/decideAll mutate records immutably then refresh() + void persist(); writeRejection routes through withoutRecording so rejections are never themselves recorded.
 * @controlflow describe wraps eight focused it() cases that each build a fresh harness and assert on the recorded controller surfaces.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import type { ChangeBar, ChangeSpan, TrackedChange } from '@k-doc/core';
import { createChangesController, type ChangesController } from './changes-controller.js';
import type { AnnotationStore } from '../files/annotation-store.js';

/**
 * @purpose Asserts a value is not undefined and narrows its declared type so downstream property reads are safe under strict null checks.
 * @inputs value — the possibly-undefined candidate to validate, typed T | undefined.
 * @outputs void; throws via Vitest's expect when value is undefined, propagating failure to the runner.
 * @dataflow value → expect(value).not.toBeUndefined() predicate result.
 * @controlflow Single negated undefined check with no branching; a failed assertion raises and aborts the test at this point.
 */
function assertDefined<T>(value: T | undefined): asserts value is T {
  // A missing element means the array was shorter than expected — surfacing that loudly rather than letting an undefined read crash later with a confusing TypeError.
  expect(value).not.toBeUndefined();
}

/**
 * @purpose Drains two microtask turns so fire-and-forget persistence completes before assertions inspect saved[].
 * @inputs None — relies on the already-scheduled microtasks from void persist() calls.
 * @outputs void; leaves pending store writes resolved by call return.
 * @dataflow Current microtask queue → drained via awaited Promise.resolve() twice.
 * @controlflow Await two sequential microtasks: one to let onRecord's refresh run, a second to let the async save resolve so saved[] reflects it.
 */
async function settle(): Promise<void> {
  // Persistence is fire-and-forget (void persist()), so without draining the queue an assertion could read saved[] before the write lands.
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * @purpose Builds a self-contained controller harness: a focused DocumentSession, a fake AnnotationStore that records every save(), and sinks for spans/errors; exposes edit() to drive real text changes.
 * @inputs text — the document body backing new DocumentSession so anchor offsets are predictable across tests.
 * @outputs An object exposing session/controller/saved/spans/errors plus edit(next) to apply edits through the host's applyText sink.
 * @dataflow Test calls → session.applyText (via edit/applyText) → recorder.onRecord → records + refresh/persist; sinks capture onSpans/onError for later assertions.
 * @controlflow Claim focus once, construct a typed fake store whose save() appends snapshot copies of each write, then wire createChangesController to the recorded arrays and return the surface.
 */
function harness(text: string): {
  readonly session: DocumentSession;
  readonly controller: ChangesController;
  readonly saved: TrackedChange[][];
  readonly spans: ChangeSpan[][];
  readonly bars: ChangeBar[][];
  readonly errors: Error[];
  readonly edit: (next: string) => void;
} {
  // FR-3.1's edit lock makes session.applyText throw unless a pane currently holds focus, so the harness claims 'source' once up front to keep every later edit valid rather than throwing on each call.
  const session = new DocumentSession(text);
  session.focusPane('source');

  // persisted TrackedChange snapshots captured per save() call; each entry is one full write of the record set at that moment, so tests can assert persistence happened and what it contained.
  const saved: TrackedChange[][] = [];

  // every onSpans emission recorded as a snapshot copy so tests can inspect exactly what was painted after each refresh().
  const spans: ChangeSpan[][] = [];

  // Every onBars emission recorded the same way, so a test can inspect what Simple Markup would draw.
  const bars: ChangeBar[][] = [];

  // onError reports accumulate here for later assertions about failed loads/saves or unplaceable changes.
  const errors: Error[] = [];

  // The fake AnnotationStore mirrors the real contract but keeps all state in-process; load() returns an empty record set and save() records what was written so tests can assert persistence without touching disk.
  const store: AnnotationStore = {
    available: true,
    resolve: async () => null,
    peekId: () => null,
    // An empty read is the neutral baseline every test starts from; no persisted changes are staged unless a test overrides load().
    load: async <T>() => ({ records: [] as unknown as T[], problems: [] }),
    save: async (_kind, recs) => { saved.push([...recs] as unknown as TrackedChange[]); },
    createVault: async () => null,
    migrateToVault: async () => 0,
    destroy: () => {},
  };

  // id factory hands out c1, c2, ... in order; the counter is shared with the controller so recorded ids are predictable and stable across a test.
  let n = 0;
  const newId = () => `c${n++}`;

  const controller: ChangesController = createChangesController({
    session,
    store,
    author: (): string => 'Ada',
    newId,
    // The host owns the edit lock, so this sink simply forwards to the already-focused pane's applyText.
    applyText: (next) => {
      session.applyText(next);
    },
    onSpans: (s) => {
      spans.push([...s]);
    },
    onBars: (b) => {
      bars.push([...b]);
    },
    onChanged: () => {},
    onError: (e) => {
      errors.push(e);
    },
  });

  // edit() is the ergonomic entry point tests use to apply a full replacement text through the real session, exercising recording exactly as production would.
  const edit = (next: string): void => {
    session.applyText(next);
  };

  return { session, controller, saved, spans, bars, errors, edit };
}

describe('changes-controller', () => {
  it('offers bars instead of marks in simple markup', async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    h.edit('The quick fox');

    // All Markup paints the change itself, so the spans are non-empty and there is nothing for a bar to add.
    expect(h.spans[h.spans.length - 1]?.length ?? 0).toBeGreaterThan(0);

    h.controller.setMode('simple');

    // Simple Markup is the mode that shows a clean document with a margin bar beside every changed line, so
    // the marks must go and the bars must arrive. Before the bars were painted this mode drew nothing at all
    // and was indistinguishable from No Markup.
    expect(h.spans[h.spans.length - 1]).toEqual([]);
    expect(h.bars[h.bars.length - 1]?.length ?? 0).toBeGreaterThan(0);
  });

  it('records nothing while tracking is off', async () => {
    const h = harness('The fox');
    // Tracking defaults to false, so an applied edit must not register a TrackedChange even though the text still changes on disk.
    h.edit('The quick fox');

    expect(h.controller.changes().length).toBe(0);
    expect(h.controller.tracking).toBe(false);
  });

  it('an edit becomes a tracked change and is persisted', async () => {
    const h = harness('The fox');
    // Turning tracking on arms the recorder so the next applied edit registers as a pending TrackedChange.
    h.controller.setTracking(true);
    h.edit('The quick fox');
    await settle();

    expect(h.controller.changes().length).toBe(1);
    const change = h.controller.changes()[0];
    assertDefined(change);
    // The insertion of "quick " between "The " and "fox" is recorded as an insert carrying exactly the inserted text.
    expect(change.kind).toBe('insert');
    expect(change.text).toBe('quick ');

    // The recorded change reached the store, proving persistence is wired through onRecord's fire-and-forget persist().
    expect(h.saved.length).toBeGreaterThan(0);
  });

  it('accepting does not change the text', async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    h.edit('The quick fox');
    await settle();

    // Capture before deciding so we can prove accept leaves on-disk text untouched.
    const before = h.session.snapshot.text;

    expect(h.controller.changes().length).toBe(1);
    const change = h.controller.changes()[0];
    assertDefined(change);

    h.controller.decide(change.id, 'accept');
    await settle();

    // The document already held the accepted result ("The quick fox"), so accept only drops the op — text is unchanged. This property is what the whole design turns on: accepting never writes back to the pane.
    expect(h.session.snapshot.text).toBe(before);
    expect(h.controller.changes().length).toBe(0);
  });

  it('rejecting an insertion removes its text', async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    h.edit('The quick fox');
    await settle();

    expect(h.controller.changes().length).toBe(1);
    const change = h.controller.changes()[0];
    assertDefined(change);

    h.controller.decide(change.id, 'reject');
    await settle();

    // Rejecting rewrites the document back to its pre-edit content ("The fox"), undoing the insertion via writeRejection.
    expect(h.session.snapshot.text).toBe('The fox');
    expect(h.controller.changes().length).toBe(0);
  });

  it('a rejection is not itself recorded', async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    h.edit('The quick fox');
    await settle();

    expect(h.controller.changes().length).toBe(1);
    const change = h.controller.changes()[0];
    assertDefined(change);

    // Rejecting writes text back through recorder.withoutRecording, so the rejection edit must not register as a new TrackedChange. Without that guard the rejection would appear as a new change describing the rejection, and rejecting that would record another — without end.
    h.controller.decide(change.id, 'reject');
    await settle();

    // Exactly zero changes remain: the original insertion was dropped by decide() and its rejection write produced nothing new to track.
    expect(h.controller.changes().length).toBe(0);
  });

  it("decideAll('reject') undoes everything in one go", async () => {
    const h = harness('a');
    h.controller.setTracking(true);
    // Two separate edits build up two pending changes; each settles independently before the next so offsets stay well-defined.
    h.edit('ab');
    await settle();
    h.edit('abc');
    await settle();

    expect(h.controller.changes().length).toBe(2);

    h.controller.decideAll('reject');
    await settle();

    // A single decideAll rewrites the document back to its very first tracked state ("a"), undoing both edits as one transaction rather than two.
    expect(h.session.snapshot.text).toBe('a');
    expect(h.controller.changes().length).toBe(0);
  });

  it("decideAll by author only touches that author's changes", async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    // The controller is authored as 'Ada', so this edit records a change owned by Ada.
    h.edit('The quick fox');
    await settle();

    expect(h.controller.changes().length).toBe(1);

    // Deciding on behalf of Grace matches no recorded change (the only one belongs to Ada), so nothing is accepted and the list must be untouched.
    h.controller.decideAll('accept', { author: 'Grace' });

    // Nobody else's work is touched: Ada's single pending change survives an accept directed at a different author.
    expect(h.controller.changes().length).toBe(1);
  });

  it('decideAll with an empty filter decides everything', async () => {
    const h = harness('a');
    h.controller.setTracking(true);
    // Two separate edits build up two pending changes; each settles independently before the next so offsets stay well-defined.
    h.edit('ab');
    await settle();
    h.edit('abc');
    await settle();

    expect(h.controller.changes().length).toBe(2);

    // An empty filter is not "match nothing" — it is the absence of any constraint, which is exactly "all changes in the document". Passing {} therefore accepts every pending change rather than none.
    h.controller.decideAll('accept', {});
    await settle();

    // With no author or range constraints each pending change matches, so accepting clears them all.
    expect(h.controller.changes().length).toBe(0);
  });

  it('a range filter only decides changes inside it', async () => {
    const h = harness('aaaa bbbb');
    h.controller.setTracking(true);
    // First insertion of "X" lands near offset 4/5, well within the [0,6] window.
    h.edit('aaaaX bbbb');
    await settle();
    // Second insertion of "Y" is appended at the end (offset 10), outside that window.
    h.edit('aaaaX bbbbY');
    await settle();

    expect(h.controller.changes().length).toBe(2);

    // Restricting to [0,6] accepts only the change whose range overlaps it; the trailing "Y" insertion is left untouched because its range does not overlap.
    h.controller.decideAll('accept', { range: { start: 0, end: 6 } });
    await settle();

    expect(h.controller.changes().length).toBe(1);
    const remaining = h.controller.changes()[0];
    assertDefined(remaining);
    // The change outside the window survives with its original inserted text.
    expect(remaining.text).toBe('Y');
  });

  it('a range filter includes a zero-width deletion inside it', async () => {
    const h = harness('one two three');
    h.controller.setTracking(true);
    // The removed run is "wo t", leaving a zero-width seam at offset 5.
    h.edit('one three');
    await settle();

    expect(h.controller.changes().length).toBe(1);
    const change = h.controller.changes()[0];
    assertDefined(change);
    // The removal is recorded as a delete carrying no text — only its seam offset identifies where it happened.
    expect(change.kind).toBe('delete');

    // The seam sits exactly on the range's start (offset 5), which is where the ordinary overlap test
    // fails: `at.end > range.start` is `5 > 5`. Only the endpoint allowance includes it, so this is the
    // case that pins that branch rather than one any overlap test would have caught anyway.
    h.controller.decideAll('accept', { range: { start: 5, end: 9 } });
    await settle();

    // With endpoints counted as inside, the boundary seam is accepted and nothing remains.
    expect(h.controller.changes().length).toBe(0);
  });


  it('a range filter excludes a deletion just before it', async () => {
    const h = harness('one two three');
    h.controller.setTracking(true);
    // The removed run is "wo t", leaving its seam at offset 5 -- one character before the window below.
    h.edit('one three');
    await settle();

    expect(h.controller.changes().length).toBe(1);

    // One character short of the window, so even with endpoints counted as inside this deletion does not
    // qualify. That is what keeps the allowance a containment test rather than a blanket pass.
    h.controller.decideAll('accept', { range: { start: 6, end: 10 } });
    await settle();

    expect(h.controller.changes().length).toBe(1);
  });

  it('a range filter excludes a deletion outside it', async () => {
    const h = harness('one two three');
    h.controller.setTracking(true);
    // The same zero-width seam at offset 5 as in the inclusion test.
    h.edit('one three');
    await settle();

    expect(h.controller.changes().length).toBe(1);

    // A window past the end of the document (20..30) does not contain the seam at offset 4, so the zero-width allowance is a containment test rather than a blanket pass.
    h.controller.decideAll('accept', { range: { start: 20, end: 30 } });
    await settle();

    // The deletion sits outside the window and therefore survives an accept directed at it.
    expect(h.controller.changes().length).toBe(1);
  });

  it('replace sets and stores the list, and an outside text change re-plans it', async () => {
    // Compare Documents hands over a whole list; a later external change (like kdoc_id front matter) must repaint it, typing need not.
    const h = harness('One two\n');
    await h.controller.load();
    h.controller.setTracking(true);
    h.edit('One two three\n');
    await settle();
    const recorded = h.controller.changes();
    h.controller.replace([]);
    await settle();
    expect(h.controller.changes()).toEqual([]);
    expect(h.saved[h.saved.length - 1]).toEqual([]);
    h.controller.replace(recorded);
    const before = h.spans.length;
    h.session.applyExternalText('---\nkdoc_id: 01HZY3G6Q2K8V4M5N6P7R8S9TA\n---\n\nOne two three\n');
    expect(h.spans.length).toBe(before);
    await settle();
    expect(h.spans.length).toBe(before + 1);
    expect(h.spans[h.spans.length - 1]?.map((span) => span.text)).toEqual([' three']);
    h.controller.setTracking(false);
    const typed = h.spans.length;
    h.edit('---\nkdoc_id: 01HZY3G6Q2K8V4M5N6P7R8S9TA\n---\n\nOne two three!\n');
    await settle();
    expect(h.spans.length).toBe(typed);
    h.controller.destroy();
    h.session.applyExternalText('Gone\n');
    await settle();
    expect(h.spans.length).toBe(typed);
  });

  it('setMode re-plans', async () => {
    const h = harness('The fox');
    h.controller.setTracking(true);
    h.edit('The quick fox');
    await settle();

    // Record how many span emissions have happened after the edit and its refresh, as a baseline for the replanning assertion.
    const beforeSpans = h.spans.length;

    h.controller.setMode('none');

    // setMode triggers a fresh refresh(), so at least one more spans entry is appended...
    expect(h.spans.length).toBeGreaterThan(beforeSpans);
    // ...and in 'none' mode nothing is decorated, so the newest emission carries no spans. The view shows only what the document already holds — it already is the accepted result — hence an empty span set for this refresh.
    const latest = h.spans[h.spans.length - 1];
    assertDefined(latest);
    expect(latest.length).toBe(0);
  });
});
