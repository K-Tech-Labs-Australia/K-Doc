/**
 * @file changes-controller.ts
 * @purpose Wires the change overlay model to its JSONL store and the markup pane (FR-11.1, FR-11.3, FR-11.4, FR-11.5): loads persisted TrackedChange records, replans decoration spans from live text for every accepted-or-pending range, and translates card decisions (accept/reject) back into immutable edits that are re-persisted. Accepting never edits the document — the on-disk text already holds the accepted-plus-pending result, so accepting only drops the op from the overlay; rejecting is the one path that writes text, and it must write through recorder.withoutRecording, otherwise the rejection would be recorded as a new change describing the rejection, which itself would then be rejectable and never terminate.
 * @inputs ChangesControllerOptions — the owning DocumentSession, live snapshot, annotation store, current author, id factory, applyText sink (the host owns the edit lock), span sink, changes sink, optional error reporter; persisted TrackedChange records from the store.
 * @outputs A ChangesController exposing tracking/mode/changes/decide/decideAll/load/refresh/destroy to the shell.
 * @functions
 *   - createChangesController: Factory that builds closure state and helpers, wires handlers, and returns the controller surface (continuation supplies decide/decideAll/load and the returned object).
 *   - refresh: Replans spans from live text, sinks spans, and repaints the changes list with current records.
 *   - persist: Writes every recorded change to the store, reporting any failure through onError without throwing.
 *   - writeRejection: Applies rejected text via recorder.withoutRecording so the rejection is never itself recorded as a change.
 * @dataflow Store records → records state → planChanges(text, records, mode) → onSpans sink + onChanged; decide() mutates records immutably then refresh() + void persist(); writeRejection() routes applyText through withoutRecording to avoid an infinite recording loop.
 * @controlflow Declare closure `records`/`mode` and helpers, build the recorder once from options so every recorded change feeds refresh() and persist(), leaving decide/decideAll/load and the returned object for the continuation; every mutation path calls refresh() synchronously and voids persist() so writes never block a synchronous handler.
 * @version 3
 * @date 2026-09-16
 */

import type { ChangeBar, ChangeDecision, ChangeSpan, DocumentSession, MarkupMode, TrackedChange } from '@k-doc/core';
import { createChangeRecorder, planChanges, applyDecision, applyDecisions, resolveChange } from '@k-doc/core';
import type { AnnotationStore } from '../files/annotation-store.js';

/**
 * Which changes a bulk decision applies to. An omitted field is not a filter: `{}` and `undefined` both
 * mean every change, so "all changes in the document" needs no special case of its own.
 */
export interface ChangeFilter {
  /** Only changes recorded by this author. */
  readonly author?: string;
  /** Only changes whose resolved range overlaps this source-offset range. */
  readonly range?: { readonly start: number; readonly end: number };
}

export interface ChangesControllerOptions {
  readonly session: DocumentSession;
  readonly store: AnnotationStore;
  /** The current author attribution for every tracked change, read as a function rather than captured once at construction. The name comes from settings that can change while the document is open — capturing it when the controller was built would make a rename in Settings silently do nothing until the next launch, a change that appears to work and does not. */
  readonly author: () => string;
  readonly newId: () => string;
  /** Writes text back to the document. The host owns the edit lock, so this controller never applies text itself. */
  readonly applyText: (text: string) => void;
  readonly onSpans: (spans: readonly ChangeSpan[]) => void;
  /** Sinks the plan's margin bars, which Simple Markup shows in place of the marks (FR-11.4). */
  readonly onBars: (bars: readonly ChangeBar[]) => void;
  readonly onChanged: (changes: readonly TrackedChange[]) => void;
  readonly onError?: (error: Error) => void;
}

export interface ChangesController {
  readonly tracking: boolean;
  setTracking(on: boolean): void;
  readonly mode: MarkupMode;
  setMode(mode: MarkupMode): void;
  changes(): readonly TrackedChange[];
  decide(changeId: string, decision: ChangeDecision): void;
  decideAll(decision: ChangeDecision, filter?: ChangeFilter): void;
  load(): Promise<void>;
  refresh(): void;
  /** Replaces the whole change list, as Compare Documents does (FR-11.7), and stores it. */
  replace(changes: readonly TrackedChange[]): void;
  destroy(): void;
}

/**
 * @purpose Decides whether one tracked change falls under a bulk-decision filter.
 * @inputs source - live document text to resolve against; change - the candidate; filter - author and/or range.
 * @outputs boolean - true when nothing in the filter excludes the change.
 * @dataflow source + change + filter -> author compare -> resolveChange -> overlap test.
 * @controlflow Reject a mismatched author, pass when no range is given, otherwise resolve and test overlap.
 */
function matchesFilter(source: string, change: TrackedChange, filter: ChangeFilter): boolean {
  // A given author narrows strictly, and is checked before resolving anything because it is far cheaper.
  if (filter.author !== undefined && change.author !== filter.author) {
    return false;
  } else {
    // No author filter, or this change is by that author.
  }

  // Without a range every remaining change passes, which is what makes "all in the document" need no case.
  if (filter.range === undefined) {
    return true;
  } else {
    // A range was given: the change has to be located before it can be tested against one.
  }

  const at = resolveChange(source, change);

  // A change that cannot be placed has no range to test, and must not pass silently: a reviewer would be
  // deciding something they could not see.
  if (at === null) {
    return false;
  } else {
    // Located: test it against the filter range.
  }

  // A zero-width deletion strictly inside the range already satisfies the overlap test below, so this
  // branch is not what includes deletions in general -- it is what includes one whose seam sits exactly
  // on a boundary. `at.end > range.start` is false when the seam is at the very start of the selection,
  // and a reviewer who selects a paragraph starting where something was deleted means to include it.
  // Endpoints count as inside.
  if (at.start === at.end) {
    return at.start >= filter.range.start && at.start <= filter.range.end;
  } else {
    // A range with width: it overlaps when each side starts before the other ends.
  }

  return at.start < filter.range.end && at.end > filter.range.start;
}

/**
 * @purpose Factory that constructs the changes controller, wiring every decision callback to an immutable change mutation so accepted ops drop from the overlay and rejected text is written back without being re-recorded.
 * @inputs options — owning DocumentSession, live snapshot, annotation store, current author, id factory, applyText sink (the host owns the edit lock), span sink, changes sink, optional error reporter.
 * @outputs ChangesController exposing tracking/mode/changes/decide/decideAll/load/refresh/destroy (continuation supplies decide/decideAll/load and the returned object).
 * @dataflow Options → closure state + recorder → controller methods bound to those closures; the returned surface is assembled in the continuation.
 * @controlflow Declare `records`/`mode` and helpers, build the recorder once from options so every recorded change feeds refresh() and persist(), leaving decide/decideAll/load and the return object for the continuation.
 */
export function createChangesController(options: ChangesControllerOptions): ChangesController {
  // Named `records` rather than `changes`: the controller surface already exposes a changes() method, so calling this backing array `changes` would shadow and collide it at call sites; `records` keeps the live change list distinct from the accessor that reports it.
  let records: TrackedChange[] = [];

  // Markup mode drives which accepted-and-pending ranges planChanges paints; 'all' shows every range so accept and reject states are visible together until a decision settles them.
  let mode: MarkupMode = 'all';

  /**
   * @purpose Replans decoration spans from live document text, sinks the spans to the editor, and repaints the changes list with current records.
   * @inputs None — reads closure `records`, `mode`, and `options.session.snapshot.text`.
   * @outputs void; mutates external span sink via options.onSpans and notifies callers of new state via options.onChanged.
   * @dataflow snapshot text + records → planChanges(text, records, mode) → { spans } → onSpans(spans); then onChanged(records).
   * @controlflow Build the plan from live text, sink its spans, then report current records; runs after every mutation so paint state never drifts from records.
   */
  function refresh(): void {
    // The plan is rebuilt against current text on every call because accepted ranges can vanish (on reject) and pending offsets shift as the document edits around them.
    const plan = planChanges(options.session.snapshot.text, records, mode);

    // Sink decoration spans so the editor paints highlight ranges for all accepted-and-pending changes alike; this fires even when `plan.spans` is empty because an empty span set is exactly how the panes are told to clear their highlights.
    options.onSpans(plan.spans);

    // Bars are sunk on the same unconditional call for the same reason: an empty set is how a pane is told to
    // clear them, and planChanges already decides per mode whether a bar belongs on a line at all.
    options.onBars(plan.bars);

    // Notify listeners of the current record set with the same unconditional call: an empty records array is how the list pane knows it has nothing left to show, so onChanged must fire even when there is nothing to report.
    options.onChanged(records);
  }

  /**
   * @purpose Persists every recorded change to the store, reporting failures through onError without throwing.
   * @inputs None — reads closure `records`.
   * @outputs void (fire-and-forget via callers).
   * @dataflow records → store.save('changes', records) → resolve/reject handled here; any non-Error throw is coerced before forwarding to options.onError.
   * @controlflow try: save the full record set; catch: normalize unknown errors and forward them so a failed write never fails silently but also never blocks the handler that triggered it.
   */
  async function persist(): Promise<void> {
    // Nothing is filtered out here — unlike drafts in comments, every recorded change is real the moment it exists because it describes an edit the user has already made, so all of them belong on disk together.
    try {
      await options.store.save<TrackedChange>('changes', records);
    } catch (error: unknown) {
      // Forward the failure through onError, coercing any non-Error value into a proper Error so callers always receive a stack-bearing object rather than an opaque throw.
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // A text change that no pane typed (a restore, undo, redo, or the annotation store adding kdoc_id front matter) rebuilds the
  // editors' state, which drops the painted marks; typing keeps them because the panes map them through the edit. Re-plan after
  // those, in a microtask so the bindings have applied the new text first. Without this, changes set by Compare Documents
  // lost their marks the moment the store added the document's kdoc_id.
  const unsubscribeReplan = options.session.subscribe((change): void => {
    // Check whether this change came from outside the panes.
    if (change.reason === 'external' || change.reason === 'undo' || change.reason === 'redo' || change.reason === 'reset') {
      // Rebuilt text: paint the plan again once the panes hold it.
      queueMicrotask(refresh);
    } else {
      // Typing or a focus change: the panes kept their marks.
    }
  });

  // The recorder is the single writer of incoming edits: onRecord appends every recorded change to `records`, repaints immediately so highlights track live text, and fire-and-forgets persist() so writes never block a synchronous edit callback.
  const recorder = createChangeRecorder({
    session: options.session,
    author: options.author,
    newId: options.newId,
    onRecord: (recorded) => {
      // Append the newly recorded changes to the live list and re-plan so both the editor highlights and the pane reflect them at once.
      records = [...records, ...recorded];
      refresh();

      // Persist without awaiting — recording must feel instant while the JSONL write happens in the background; a failed save is surfaced through onError rather than blocking input.
      void persist();
    },
  });

  /**
   * @purpose Writes rejected text back to the document via recorder.withoutRecording so the rejection edit is never itself recorded as a new change, breaking what would otherwise be an infinite accept/reject recording loop.
   * @inputs nextText — the full replacement text that represents applying the user's reject decision to the current on-disk content.
   * @outputs void; mutates document text through options.applyText while suppressing recording inside withoutRecording.
   * @dataflow nextText → recorder.withoutRecording(() => applyText(nextText)) → host applies edit lock; no TrackedChange is emitted because recording is suppressed for this write only.
   * @controlflow Delegate to recorder.withoutRecording so the single text-writing path in this controller cannot feed back into onRecord — without it, the rejection would be recorded as a change describing the rejection, which itself would then be rejectable and never terminate; this guard is the sole reason withoutRecording exists here.
   */
  function writeRejection(nextText: string): void {
    // Route the edit through withoutRecording so applying rejected text does not create a new TrackedChange; recording stays disabled for this callback only, letting every genuine user edit still be captured by onRecord.
    recorder.withoutRecording(() => {
      options.applyText(nextText);
    });
  }

  /**
   * @purpose Applies an accept or reject decision to a single tracked change.
   * @inputs changeId - Identifier of the entry in `records` to resolve; decision - 'accept' or 'reject'.
   * @outputs void - Mutates `records`, refreshes the view, and persists when needed.
   * @dataflow records → selected change + decision → text edit (reject only) → filtered list → persisted store.
   * @controlflow Locate the change; return early if stale; reject edits text then drops it, accept just drops it; filter, refresh, persist.
   */
  function decide(changeId: string, decision: ChangeDecision): void {
    const change = records.find((r) => r.id === changeId);

    // A click that arrives after the list has already moved on is a race condition, not a fault: there is nothing to resolve.
    if (change === undefined) {
      return;
    }

    if (decision === 'reject') {
      const next = applyDecision(options.session.snapshot.text, change, 'reject');

      // A change that cannot be placed must remain in the list rather than vanish: dropping it would erase the record of an edit the user actually made.
      if (next === null) {
        options.onError?.(new Error(`Could not place change ${changeId}; it was left in the list.`));
        return;
      }

      // The rejection text is written back to the document, restoring the original region where the accepted edit had been applied.
      writeRejection(next);
    } else {
      // Accepting does not touch the text at all: this property is what the whole design turns on and is not an omission — the document already holds the accepted result, so accepting is purely dropping the op.
    }

    records = records.filter((r) => r.id !== changeId);
    refresh();
    void persist();
  }

  /**
   * @purpose Applies an accept or reject decision to a set of tracked changes at once.
   * @inputs decision - 'accept' or 'reject'; filter - optional author and/or source range; omitting it decides every change in the document.
   * @outputs void - Mutates `records`, refreshes the view, and persists when needed.
   * @dataflow records → filtered targets + decision → single text edit (reject only) → filtered list → persisted store.
   * @controlflow Select targets; return early if none match; reject edits all in one transaction, accept drops them all; filter, refresh, persist.
   */
  function decideAll(decision: ChangeDecision, filter?: ChangeFilter): void {
    // An absent filter and an empty one both mean every change, so "all in the document" needs no case of its own.
    const active = filter ?? {};
    const source = options.session.snapshot.text;
    const targets = records.filter((r) => matchesFilter(source, r, active));

    // Deciding nothing is not an error: a no-op with no visible effect is the correct outcome for an empty selection.
    if (targets.length === 0) {
      return;
    }

    if (decision === 'reject') {
      // One call rather than a loop, so the whole set lands as a single undoable transaction — which is exactly what FR-11.3 asks for.
      writeRejection(applyDecisions(options.session.snapshot.text, targets, 'reject'));
    } else {
      // Accepting does not touch the text at all: same property as `decide` — the document already holds every accepted result, so accepting is purely dropping each op.
    }

    const decided = new Set(targets.map((t) => t.id));

    records = records.filter((r) => !decided.has(r.id));
    refresh();
    void persist();
  }

  /**
   * @purpose Restores the tracked-change list from durable storage.
   * @inputs void - Reads through `options.store` and repopulates `records`.
   * @outputs void - Populates `records`; surfaces any read failures via `onError`.
   * @dataflow store → parsed TrackedChange[] + problems → records (+ error report) → refreshed view.
   * @controlflow Load from store; record problems or confirm a clean parse; on failure normalize and report; always refresh the pane last.
   */
  async function load(): Promise<void> {
    try {
      const result = await options.store.load<TrackedChange>('changes');

      records = [...result.records];

      if (result.problems.length > 0) {
        // Some records could not be read: surface how many were skipped so a corruption problem is visible rather than silently lost.
        options.onError?.(new Error(`${result.problems.length} unreadable change record(s) skipped`));
      } else {
        // Every record parsed cleanly and there is nothing to report — the list now reflects exactly what was stored.
      }
    } catch (error: unknown) {
      // Normalize non-Error throws into an Error so callers always receive a consistent shape on `onError`.
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    // refresh() sits outside the try: a failed load must still paint an empty, working pane rather than leaving the previous document's changes on screen.
    refresh();
  }

  return {
    get tracking() {
      // Reflects the recorder's live flag rather than a value copied at construction.
      return recorder.tracking;
    },
    setTracking(on: boolean) {
      recorder.setTracking(on);
    },
    get mode() {
      // Reflects the live closure variable, not a copy.
      return mode;
    },
    setMode(next: MarkupMode) {
      mode = next;
      refresh();
    },
    changes() {
      return records;
    },
    decide,
    decideAll,
    load,
    refresh,
    replace(next: readonly TrackedChange[]) {
      // Copied so the caller's array cannot change the list behind the controller's back.
      records = [...next];
      refresh();
      void persist();
    },
    destroy() {
      recorder.destroy();
      unsubscribeReplan();
    },
  };
}
