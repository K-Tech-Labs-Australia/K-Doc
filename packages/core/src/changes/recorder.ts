/**
 * @file recorder.ts
 * @purpose Watches a DocumentSession and turns each author edit into tracked changes (FR-11.1). It subscribes to session notifications, diffs the incoming text against a maintained baseline with diffEdit, converts every resulting RecordedEdit into an insert or delete TrackedChange anchored over post-edit text, and hands them to a caller-supplied callback — while honouring on/off tracking state and suppressing its own writes so recording never recurses.
 * @inputs options.session — the document being watched; options.author — attribution stamped on every change; options.newId — caller-owned id generator keeping the core free of a ULID dependency; options.now — optional clock defaulting to new Date(); options.onRecord — invoked with one edit's changes, never empty. Session notifications carry `.snapshot.text` and a `.reason`.
 * @outputs A ChangeRecorder exposing live tracking state via a getter, setTracking/withoutRecording controls, and destroy() which detaches the subscription. No input is mutated; only onRecord observes produced changes.
 * @functions
 *   - createChangeRecorder: build the recorder closure, subscribe once, and return the control surface.
 * @dataflow Session notification → listener reads next text → diffEdit(baseline, next) yields RecordedEdits → each becomes an insert/delete TrackedChange anchored against `next` → onRecord receives them; baseline is advanced to `next` before every branch so subsequent edits always compare against current text.
 * @controlflow Subscribe at construction; per notification compute record = tracking && !suppressed && reason === 'edit'; when false, re-baseline and return, otherwise diff→build changes→rebase→onRecord only if non-empty; setTracking adopts live text as the starting point on enable; withoutRecording wraps an edit in suppression via try/finally; destroy unsubscribes.
 * @version 2
 * @date 2026-09-11
 */

import type { DocumentSession, SessionChange } from '../session/document-session.js';
import { diffEdit } from './diff-edit.js';
import { createInsertion, createDeletion, type TrackedChange } from './change.js';

export interface ChangeRecorderOptions {
  readonly session: DocumentSession;
  /** The current author attribution for every produced change, read as a function rather than captured once at construction. The name comes from settings that can change while the document is open — capturing it when the recorder was built would make a rename in Settings silently do nothing until the next launch, a change that appears to work and does not. */
  readonly author: () => string;
  /** Supplies an id per change. The caller owns id generation, so the core stays free of a ULID dependency. */
  readonly newId: () => string;
  readonly now?: () => Date;
  /** Called with the changes produced by one edit, never with an empty array. */
  readonly onRecord: (changes: readonly TrackedChange[]) => void;
}

export interface ChangeRecorder {
  /** Whether edits are currently being turned into tracked changes. */
  readonly tracking: boolean;
  setTracking(on: boolean): void;
  /** Runs an edit that must not itself be recorded. */
  withoutRecording(edit: () => void): void;
  destroy(): void;
}

/**
 * @purpose Build a ChangeRecorder that converts each author edit in the session into tracked changes, tracking its baseline against live text and suppressing its own writes so recording never describes the removal of another change.
 * @inputs options.session — document to watch via subscribe; options.author — attribution for every produced change; options.newId — id generator called once per RecordedEdit; options.now — optional clock read lazily when building each change; options.onRecord — sink for one edit's changes, never empty.
 * @outputs ChangeRecorder whose tracking getter reflects the live closure flag and whose controls manage recording state without mutating any caller object.
 * @dataflow Closure flags (tracking/suppressed) + baseline text feed a single subscription listener; each notification diffs baseline against next text to produce TrackedChanges that flow to onRecord, while every branch keeps baseline current for the following edit.
 * @controlflow Initialise tracking=false, suppressed=false, and baseline from the initial snapshot; subscribe once; in the listener decide whether this event records (see operand comments), re-baseline-and-return when it does not, otherwise diff→build changes→rebase→onRecord only if non-empty; setTracking flips tracking and re-baselines on enable; withoutRecording suppresses around an edit with a finally that always clears suppression; destroy unsubscribes.
 */
export function createChangeRecorder(options: ChangeRecorderOptions): ChangeRecorder {
  let tracking = false; // Whether edits are currently being turned into tracked changes by this recorder.
  let suppressed = false; // True while an edit runs that belongs to the recorder itself (e.g. a rejection writing text back) so it is not recorded as its own change, which would otherwise recurse forever describing the removal of another change.
  let baseline = options.session.snapshot.text; // The text the next incoming edit is diffed against; refreshed on every notification regardless of reason because a baseline left behind by an undo or reload would make the following edit compare against text the document no longer holds.

  const unsubscribe = options.session.subscribe((change: SessionChange) => {
    const next = change.snapshot.text; // The full document text as it stands after this session event fired, used both to diff and to anchor every produced change.

    // Record only when tracking is on AND the recorder is not suppressing its own writes AND the event is a genuine author edit — each operand excludes a distinct non-recording case below.
    const record = tracking && !suppressed && change.reason === 'edit';

    if (!record) {
      // Not an editable recording: still advance the baseline to `next` so the next real edit diffs against current text, then return without producing any change — this branch also covers undo/redo (the user retracting or restoring their own work), external/reset/focus events (not the author's edit), and suppressed writes.
      baseline = next;
      return;
    } else {
      // Branch: a genuine author edit to record — diff it against the previous baseline below.

      const clock = options.now?.(); // Optional caller-supplied clock for stamped timestamps; undefined falls through so each constructor defaults createdAt to new Date().

      const edits = diffEdit(baseline, next); // The delete-then-insert operations describing exactly how `baseline` became `next`, empty when the text is unchanged.
      const changes: TrackedChange[] = []; // Assembled here and handed to onRecord only after the baseline has been advanced past this edit.

      for (const edit of edits) {
        if (edit.kind === 'insert') {
          // Branch: an insertion — record it as a createInsertion anchored over its own characters in post-edit text, so resolving later works against what will actually be present at resolution time.
          changes.push(createInsertion(options.newId(), edit.text, next, edit.at, options.author(), clock));
        } else {
          // Branch: kind is 'delete', so record it as a createDeletion whose anchor seam marks where the removed characters used to sit in post-edit text rather than over live characters.
          changes.push(createDeletion(options.newId(), edit.text, next, edit.at, options.author(), clock));
        }
      }

      baseline = next; // Advance before notifying: onRecord may itself edit the document (e.g. an accept writing resolved text), so the baseline must already reflect `next` or that callback's edit would be diffed against pre-callback text and produce a spurious change.

      if (changes.length > 0) {
        // Non-empty means a real change was produced and is handed to the caller; an empty array can only occur when the session fired for an editable reason yet left the text unchanged, in which case there is nothing to report and onRecord must be skipped rather than called with [].
        options.onRecord(changes);
      } else {
        // Branch: no edit operations were emitted (identical before/after), so there is genuinely nothing to record; skipping keeps onRecord's "never empty" contract intact for its consumers.
      }
    }
  });

  return {
    get tracking() {
      // Reflect the live closure flag, not a copy taken at construction time, so callers always observe current state after setTracking runs.
      return tracking;
    },

    setTracking(on: boolean) {
      // No baseline refresh belongs here. The listener above advances `baseline` on every notification
      // whatever the reason -- including the ones it declines to record -- so by the time tracking is
      // switched on the baseline already is the live text. That invariant is what makes work done while
      // tracking was off impossible to attribute retroactively; a refresh here would be dead code
      // dressed up as the thing doing the work, and mutation testing confirms removing it breaks nothing.
      tracking = on;
    },

    withoutRecording(edit: () => void) {
      suppressed = true; // Mark that the following edit originates from the recorder itself so it is not recorded as a change describing the removal of another change (which would never terminate).

      try {
        // Run the caller's edit while suppression holds.
        edit();
      } finally {
        // Always clear the flag, even if `edit` throws: an unguarded throw would leave suppressed set and silently stop recording every subsequent real edit for the rest of the session — far worse than the original failure bubbling up to its caller.
        suppressed = false;
      }
    },

    destroy() {
      // Detach from the session so no further notifications reach this recorder after it is torn down, releasing all closure references held by the listener.
      unsubscribe();
    },
  };
}
