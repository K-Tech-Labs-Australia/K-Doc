/**
 * @file comments-controller.ts
 * @purpose Wires the comment thread model to its JSONL store and the margin pane (FR-10): it loads persisted threads, paints decoration spans for every open range into the document, and translates card interactions (select/reply/resolve/delete) back into immutable thread mutations that are re-persisted.
 * @inputs CommentsControllerOptions — the owning Document, live session snapshot, annotation store, current author, selection/reveal accessors, span sink, and optional error reporter; persisted CommentThread records from the store.
 * @outputs A CommentsController exposing element/load/addComment/refresh/threadCount/destroy to the shell.
 * @functions
 *   - createCommentsController: Factory that builds the pane, wires handlers, and returns the controller surface.
 *   - isDraft: Reports whether a thread has no comments yet (a not-yet-written draft).
 *   - persist: Writes non-draft threads to the store, reporting any failure through onError.
 *   - refresh: Replans decorations from live text, sinks spans, and repaints the pane with orphan/active state.
 *   - onSelect / onReply / onToggleResolved / onDelete: Card callbacks that mutate `threads` immutably then re-render/re-persist.
 *   - addComment: Creates a draft anchored at the current selection and focuses its reply box.
 *   - load: Loads persisted records, surfaces skipped problems as an error, and repaints.
 * @dataflow Store records → threads state → planDecorations(text, threads) → onSpans sink + pane.render; card events → immutable thread builders → threads array → refresh() + persist().
 * @controlflow Build handlers → build callbacks → build pane once → expose controller; every mutation path calls refresh() to repaint and voids persist() so the write never blocks a synchronous handler.
 * @version 4
 * @date 2026-09-16
 */

import type { DocumentSession } from '@k-doc/core';
import type { CommentThread, CommentSpan } from '@k-doc/core';
import { createAnchor, createThread, addReply, deleteEntry, editEntry, setResolved, planDecorations, generateUlid } from '@k-doc/core';
import type { AnnotationStore } from '../files/annotation-store.js';
import { createCommentsPane, type CommentsPane, type CommentDisplay } from './comments-pane.js';
import type { CommentCardCallbacks } from './comment-card.js';

/** One comment drawn inline in the document, after the range it annotates (FR-10.4). */
export interface InlineNote {
  readonly threadId: string;
  readonly offset: number;
  readonly author: string;
  readonly body: string;
}

export interface CommentsControllerOptions {
  readonly doc: Document;
  readonly session: DocumentSession;
  readonly store: AnnotationStore;
  /** The current author attribution for every comment, read as a function rather than captured once at construction. The name comes from settings that can change while the document is open — capturing it when the controller was built would make a rename in Settings silently do nothing until the next launch, a change that appears to work and does not. */
  readonly author: () => string;
  readonly readSelection: () => { readonly start: number; readonly end: number } | null;
  readonly revealRange: (start: number, end: number) => void;
  readonly onSpans: (spans: readonly CommentSpan[]) => void;
  /**
   * Sinks the notes drawn inline in the document when the display mode asks for them (FR-10.4).
   *
   * The host paints them in both panes and the controller knows about neither, so it reports and lets the
   * host decide -- the same split `onSpans` already uses.
   */
  readonly onNotes: (notes: readonly InlineNote[]) => void;
  readonly onError?: (error: Error) => void;
}

export interface CommentsController {
  readonly element: HTMLElement;
  load(): Promise<void>;
  addComment(): boolean;
  refresh(): void;
  threadCount(): number;
  /**
   * The threads as they stand, for a caller that has to render them somewhere other than the pane.
   *
   * Exposed read-only: the pane owns them, and a caller that could change them would be a second
   * author of the same file with no way to tell the store about it.
   */
  readonly threads: readonly CommentThread[];
  readonly display: CommentDisplay;
  setDisplay(next: CommentDisplay): void;
  destroy(): void;
}

/**
 * @purpose Factory that constructs the comments controller, building its pane once and wiring every card callback to an immutable thread mutation.
 * @inputs options — owning Document, live session snapshot, annotation store, current author, selection/reveal accessors, span sink, optional error reporter.
 * @outputs CommentsController exposing element/load/addComment/refresh/threadCount/destroy.
 * @dataflow Options → closure state + handlers + pane → returned controller object bound to those closures.
 * @controlflow Declare threads/state and helpers, define the four card callbacks, assemble them into `callbacks`, build the pane once from options.doc + callbacks, then return the controller whose element is the pane's root node.
 */
export function createCommentsController(options: CommentsControllerOptions): CommentsController {
  // Threads are held in a closure array; drafts (threads with no comments) live here too because planDecorations already skips an empty thread from painting and only the pane lists it, so nothing is written to disk until real text arrives.
  let threads: CommentThread[] = [];

  // Margin is the default because it is the behaviour that existed before the toggle, and a mode change
  // that altered what a user already saw would be a surprise rather than a setting.
  let display: CommentDisplay = 'margin';

  // The id of the card currently highlighted in the pane, or null when none is active.
  let activeThreadId: string | null = null;

  /**
   * @purpose Reports whether a thread carries no comments yet (a draft awaiting its first reply).
   * @inputs thread — the CommentThread to inspect.
   * @outputs boolean — true when `thread.comments` is empty, false otherwise.
   * @dataflow thread.comments.length → comparison result.
   * @controlflow Single length check against zero; no branching beyond the returned predicate.
   */
  function isDraft(thread: CommentThread): boolean {
    // A draft has an anchor but no comments yet; planDecorations skips it from painting and deleteEntry never yields one, so this is the only way a thread can be empty.
    return thread.comments.length === 0;
  }

  /**
   * @purpose Persists every non-draft thread to the store, reporting failures through onError without throwing.
   * @inputs None — reads closure `threads`.
   * @outputs void (fire-and-forget via callers).
   * @dataflow threads → filter out drafts → store.save('comments', records) → resolve/reject handled here.
   * @controlflow try: save filtered records; catch: wrap unknown errors and forward to options.onError so an unwritten comment never fails silently but also never blocks the handler that triggered it.
   */
  async function persist(): Promise<void> {
    // Drafts are excluded because an unwritten comment is not yet a comment, and writing one would put an empty record into a file that gets committed to git — only threads with real text belong on disk.
    try {
      await options.store.save<CommentThread>('comments', threads.filter((t) => !isDraft(t)));
    } catch (error: unknown) {
      // Forward the failure through onError, coercing any non-Error value into an Error so callers always receive a proper stack-bearing object.
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @purpose Replans decorations from live document text, sinks the spans to the editor, and repaints the pane with current orphan/active state.
   * @inputs None — reads closure `threads`, `activeThreadId`, and `options.session.snapshot.text`.
   * @outputs void; mutates external span sink via options.onSpans and repaints the pane.
   * @dataflow snapshot text + threads → planDecorations → { spans, orphaned } → onSpans(spans) + pane.render(threads, orphanedIds, activeThreadId).
   * @controlflow Plan with resolved included (the stylesheet paints a muted resolved range), sink spans, derive the orphan id set, then render; runs after every mutation so paint state never drifts from threads.
   */
  /**
   * @purpose Derives one inline note per decoration span from the first comment of its thread, for the host to paint beside the text.
   * @inputs spans — the decoration spans produced by planDecorations; reads closure `threads` to resolve each span's thread and first comment.
   * @outputs InlineNote[] — one note per span that resolves to a thread with at least one comment, in the order the spans were given.
   * @dataflow For each span → find thread by threadId in threads → take its first comment → push { threadId, offset: span.end, author, body }.
   * @controlflow Iterate spans; for each, guard the thread lookup and the first-comment read with if/else branches that skip when missing.
   */
  function inlineNotes(spans: readonly CommentSpan[]): InlineNote[] {
    const notes: InlineNote[] = [];

    for (const span of spans) {
      // Resolve the thread this span annotates; a span whose thread is gone must not fabricate a note.
      const thread = threads.find((t) => t.id === span.threadId);

      if (thread === undefined) {
        // Branch: no thread for this span — skip it rather than emitting a dangling note with no body or author.
        continue;
      } else {
        // A thread exists; take its first comment only, because a thread of six replies rendered inline would bury the document it annotates —
        // the pane is where a conversation belongs and this view should show what each comment is without drowning the text in every reply.
        const first = thread.comments[0];

        if (first === undefined) {
          // Branch: the thread has no comments yet (a draft); skip it so an empty anchor never produces an inline note.
          continue;
        } else {
          // Draw the note at span.end because a comment is about the text before it, not after it — placing it at the end of the annotated range keeps it beside what it refers to.
          notes.push({ threadId: thread.id, offset: span.end, author: first.author, body: first.body });
        }
      }
    }

    return notes;
  }

  /**
   * @purpose Switches how comments are shown in the document and repaints immediately.
   * @inputs next — the chosen display mode.
   * @outputs void; re-plans through refresh().
   * @dataflow next -> display -> refresh() -> onSpans/onNotes.
   * @controlflow Assign then re-plan, because a toggle whose effect waits for the next edit reads as a
   *   toggle that did not work.
   */
  function setDisplay(next: CommentDisplay): void {
    display = next;
    refresh();
  }

  function refresh(): void {
    // Resolved threads are explicitly included here even though planDecorations defaults to excluding them, because the plugin paints a resolved range in its own muted style — dropping it at plan time would lose exactly the distinction the stylesheet was written to draw; the pane's own filter is what hides them from the list.
    const plan = planDecorations(options.session.snapshot.text, threads, true);

    // Sink every decoration span so the editor paints highlight ranges for all open and resolved comments alike.
    if (display === 'hidden') {
      // Hidden means the document itself shows nothing at all — but the pane still lists the threads, because it is the panel the user deliberately opened and its list is unaffected by this choice.
      options.onSpans([]);
      options.onNotes([]);
    } else if (display === 'inline') {
      // Inline keeps the highlight: the note says what the comment is, the highlight says what it is about, and one without the other is half an answer.
      options.onSpans(plan.spans);
      options.onNotes(inlineNotes(plan.spans));
    } else {
      // Margin shows only the highlight with no inline note — the pre-toggle behaviour, where the range is painted but no note sits beside it.
      options.onSpans(plan.spans);
      options.onNotes([]);
    }

    // Collect orphaned thread ids into a set so pane.render can group stale threads last without an O(n²) membership scan per card.
    const orphanedIds = new Set<string>(plan.orphaned.map((o) => o.threadId));

    // Repaint the list with current data, orphan markers, and active highlight; filter state is owned by the pane so no round trip through the shell is needed.
    pane.render(threads, orphanedIds, activeThreadId);
  }

  /**
   * @purpose Handles a card selection: highlights it, scrolls its anchor into view, then repaints to reflect the new active highlight.
   * @inputs threadId — id of the comment the user selected in the pane.
   * @outputs void; mutates `activeThreadId`, reveals the range, and refreshes the display.
   * @dataflow threadId → locate thread → planDecorations([thread]) → first span start/end → revealRange(span.start, span.end); activeThreadId set before render so highlight precedes scroll.
   * @controlflow Set active id; find the thread (skip when absent or a draft with no range to reveal); on success call revealRange then refresh(); selecting scrolls the document to it, which is the only way the pane and the text stay connected once the list is longer than the screen.
   */
  function onSelect(threadId: string): void {
    // Mark this card active so its highlight updates before we scroll; a null id clears selection but nothing selects on an empty id in practice.
    activeThreadId = threadId;

    // Locate the selected thread by id to resolve its document position for scrolling.
    const target = threads.find((t) => t.id === threadId);

    if (target === undefined) {
      // Branch: no such thread exists anymore (e.g. deleted between render and click); still repaint so any stale highlight clears, then stop — there is nothing to reveal.
      refresh();
      return;
    } else {
      // Branch: the thread exists; only a non-draft has an anchor range worth scrolling to, since drafts carry no comments for planDecorations to span.
      if (isDraft(target)) {
        // A draft has no real text yet, so there is no document position to reveal — repaint for the highlight and stop without calling revealRange.
        refresh();
        return;
      } else {
        // Branch: a live thread with comments; plan its decorations against current text to recover the exact anchor offsets.
        const targetPlan = planDecorations(options.session.snapshot.text, [target], true);

        if (targetPlan.spans.length === 0) {
          // Branch: no span was produced despite having comments — an edge case where the range could not be resolved; repaint for highlight and skip reveal to avoid scrolling nowhere.
          refresh();
          return;
        } else {
          // Branch: a first span exists; use its offsets to scroll the document so the selected comment's anchor becomes visible alongside the pane.
          const span = targetPlan.spans[0];

          // Required by noUncheckedIndexedAccess: the length check above already guarantees a span,
          // but the compiler narrows on the value rather than on the length.
          if (span === undefined) {
            // Cannot happen after the length check: repaint and stop rather than assert.
            refresh();
            return;
          } else {
            // A resolved span: scroll the document to the commented range.
            options.revealRange(span.start, span.end);
          }
        }
      }
    }

    // Repaint after revealing so the active highlight and scrolled view are consistent in one pass.
    refresh();
  }

  /**
   * @purpose Handles a reply on an existing card, turning drafts into real threads while reusing their id to avoid list jumps.
   * @inputs threadId — id of the card being replied to; body — the entered comment text.
   * @outputs void; mutates `threads` immutably then repaints and persists.
   * @dataflow threadId → locate index → draft or live branch → createThread/addReply with a fresh entry id → replace element → refresh() + persist().
   * @controlflow Return early when the thread is gone; otherwise rebuild that array slot via an immutable builder, then repaint synchronously and fire-and-forget the write.
   */
  function onReply(threadId: string, body: string): void {
    // Find the reply target's index so we can replace exactly that element in place without disturbing sibling order or ids.
    const index = threads.findIndex((t) => t.id === threadId);

    // Bind the element once: noUncheckedIndexedAccess types every indexed read as possibly
    // undefined, and a single narrowed local is clearer than repeating the guard at each use.
    const current = index === -1 ? undefined : threads[index];

    if (current === undefined) {
      // Branch: no such thread to reply to — a stale callback; nothing to mutate, and skipping avoids fabricating an orphaned record.
      return;
    } else {
      // Branch: the target exists; decide whether it is still a draft awaiting its first comment or already carries entries.
      if (isDraft(current)) {
        // The thread has no comments yet, so promote it to a real one by replacing the slot with createThread — reusing this id keeps the user's card from jumping when it becomes real.
        // The author name is read here when the comment is written, so a reply posted after a rename
        // carries the new name while the comments before it keep their original attribution --
        // which is what a reader of a thread expects.
        threads[index] = createThread(threadId, current.anchor, generateUlid(), options.author(), body);
      } else {
        // Branch: an existing live thread; append a new reply via addReply rather than rebuilding, preserving its anchor and original createdAt.
        threads[index] = addReply(current, generateUlid(), options.author(), body);
      }
    }

    // Repaint so the new entry appears immediately, then persist without awaiting — replies must feel instant while writes happen in the background.
    refresh();
    void persist();
  }

  /**
   * @purpose Handles a resolve toggle on an existing card by flipping its resolved flag immutably.
   * @inputs threadId — id of the card whose state changed.
   * @outputs void; mutates `threads` then repaints and persists.
   * @dataflow threadId → locate index → setResolved(thread, !resolved) replaces element → refresh() + persist().
   * @controlflow Return early when absent; otherwise replace that slot with the resolved-flipped copy so no-ops never reach the store (setResolved returns unchanged when already matching).
   */
  function onToggleResolved(threadId: string): void {
    // Locate the toggled card's index to rebuild only that element.
    const index = threads.findIndex((t) => t.id === threadId);

    // Bind the element once: noUncheckedIndexedAccess types every indexed read as possibly
    // undefined, and a single narrowed local is clearer than repeating the guard at each use.
    const current = index === -1 ? undefined : threads[index];

    if (current === undefined) {
      // Branch: no such thread — a stale toggle callback; skip mutation and persist so nothing is written for an absent record.
      return;
    } else {
      // Branch: the card exists; flip its resolved flag via setResolved, which returns the same reference when already matching to avoid needless writes.
      threads[index] = setResolved(current, !current.resolved);
    }

    // Repaint so the resolved visual updates at once, then persist in the background without blocking the toggle feedback.
    refresh();
    void persist();
  }

  /**
   * @purpose Handles deletion of a single entry from an existing card, removing the thread entirely when it becomes empty.
   * @inputs threadId — id of the card containing the deleted entry; entryId — id of the comment being removed.
   * @outputs void; mutates `threads` then repaints and persists.
   * @dataflow threadId → locate index → deleteEntry(thread, entryId) → null means empty (drop + clear active) else replace element → refresh() + persist().
   * @controlflow Return early when absent; call deleteEntry which reports null for the last comment — a thread with no comments left is not a thread, so drop it and clear any active highlight pointing at it.
   */
  function onDelete(threadId: string, entryId: string): void {
    // Locate the card holding the deleted entry to rebuild only that slot.
    const index = threads.findIndex((t) => t.id === threadId);

    // Bind the element once: noUncheckedIndexedAccess types every indexed read as possibly
    // undefined, and a single narrowed local is clearer than repeating the guard at each use.
    const current = index === -1 ? undefined : threads[index];

    if (current === undefined) {
      // Branch: no such thread — a stale delete callback; skip mutation and persist so nothing is written for an absent record.
      return;
    } else {
      // Remove the entry via deleteEntry, which returns null when this was its last comment because an empty thread is not a thread rather than returning one to be discarded later.
      const updated = deleteEntry(current, entryId);

      if (updated === null) {
        // Branch: deletion emptied the thread; drop it entirely and clear the active highlight only when it pointed at this now-removed card, so no dangling selection remains in the pane.
        threads.splice(index, 1);

        if (activeThreadId === threadId) {
          // The cleared id was the currently highlighted card; reset to null so nothing stays selected after its removal.
          activeThreadId = null;
        } else {
          // Another card holds the highlight; leave it untouched since this deletion did not affect it.
        }
      } else {
        // Branch: comments remain; replace the slot with the rebuilt thread that no longer contains the deleted entry, preserving every other field immutably.
        threads[index] = updated;
      }
    }

    // Repaint to reflect the removed comment or gone thread, then persist in the background without blocking the delete feedback.
    refresh();
    void persist();
  }

  /**
   * @purpose Handles an inline edit of a single entry on an existing card by replacing that entry's body in place and stamping `editedAt`.
   * @inputs threadId — id of the card containing the edited entry; entryId — id of the comment being edited; body — the new comment text.
   * @outputs void; mutates `threads` immutably then repaints and persists.
   * @dataflow threadId → locate index → editEntry(thread, entryId, body) → unchanged reference (race when entry id absent) returns early else replace element → refresh() + persist().
   * @controlflow Return early when the thread is gone; otherwise call editEntry which returns the same reference it was given when the entry id is absent — a race rather than a fault — so an unchanged thread is never rewritten with a spurious version. Editing differs from onReply in that the body is replaced in place and `editedAt` is stamped, leaving the thread's shape untouched: only one entry's text and its `(edited)` marker change.
   */
  function onEdit(threadId: string, entryId: string, body: string): void {
    // Locate the card holding the edited entry to rebuild only that slot.
    const index = threads.findIndex((t) => t.id === threadId);

    // Bind the element once: noUncheckedIndexedAccess types every indexed read as possibly
    // undefined, and a single narrowed local is clearer than repeating the guard at each use.
    const current = index === -1 ? undefined : threads[index];

    if (current === undefined) {
      // Branch: no such thread — a stale edit callback for a card that is gone; skip mutation and persist so nothing is written for an absent record.
      return;
    } else {
      // Replace the entry's body in place via editEntry, which stamps `editedAt` on that one comment while leaving every other field untouched.
      const updated = editEntry(current, entryId, body);

      if (updated === current) {
        // Branch: editEntry returned the same reference it was given because the entry id is absent — a race rather than a fault; repainting and rewriting an unchanged thread would put a spurious version into the store, so return without doing either.
        return;
      } else {
        // Branch: the entry exists and its body changed; replace the slot with the rebuilt thread that carries the new text and `editedAt` stamp.
        threads[index] = updated;
      }
    }

    // Repaint to reflect the edited comment, then persist in the background without blocking the edit feedback.
    refresh();
    void persist();
  }

  /**
   * @purpose Assembles the five card callbacks into a single CommentCardCallbacks object consumed by createCommentsPane.
   * @inputs None — binds each handler to its closure-defined implementation.
   * @outputs CommentCardCallbacks — an object whose methods forward to onSelect/onReply/onToggleResolved/onDelete/onEdit.
   * @dataflow Handler functions → callback interface expected by every rendered card.
   * @controlflow Object literal construction; handlers are hoisted function declarations so referencing them here is safe at call time and after pane build.
   */
  const callbacks: CommentCardCallbacks = {
    onSelect,
    onReply,
    onToggleResolved,
    onDelete,
    onEdit,
  };

  /**
   * @purpose Builds the margin pane once from the owning Document and the assembled callbacks; every handler is bound to this closure's state.
   * @inputs options.doc — owner Document for all element creation; callbacks — forwarded verbatim to each rendered card.
   * @outputs CommentsPane exposing element/render/destroy, whose render reads closure threads/orphaned/active on demand.
   * @dataflow Options + callbacks → pane instance with its own filter state and DOM structure.
   * @controlflow Construct the pane after handlers/callbacks exist so it can be handed a stable callback object; built exactly once for the controller's lifetime.
   */
  // The pane owns the control and the controller owns what it means, so the choice never leaves this
  // file: routing it out to the shell and back would add a hop that decides nothing.
  const pane: CommentsPane = createCommentsPane({
    doc: options.doc,
    callbacks,
    onDisplayChange: (next: CommentDisplay): void => {
      setDisplay(next);
    },
  });

  /**
   * @purpose Creates a new empty comment thread anchored to the current editor selection and focuses its reply field.
   * @inputs options.readSelection() - the active text range in the document, or null when nothing is selected.
   * @outputs boolean - true when a new thread was created and focused; false when there was no usable selection.
   * @dataflow Editor selection → createAnchor → new CommentThread object → threads array + activeThreadId → pane repaint via refresh() → reply textarea focus.
   * @controlflow Read selection → early return false on null or collapsed range → build anchor/id/thread → register thread and mark it active → repaint before querying the DOM → focus the reply box if present; returns true at the end.
   */
  function addComment(): boolean {
    // Capture the current editor selection once so we never read a stale range mid-operation.
    const selection = options.readSelection();

    // No selection means there is nothing for the comment to attach to. Decline quietly rather than
    // erroring: pressing the shortcut with no selection is a slip, not a fault worth a message.
    if (selection === null) {
      return false;
    }

    // A collapsed caret (start == end) has no spanned text to anchor a note on; treat it as "nothing to do" rather than reporting an error.
    if (selection.start >= selection.end) {
      // Comment: a comment needs something to be about, so a collapsed caret is not an error to report, just nothing to do.
      return false;
    }

    const anchor = createAnchor(options.session.snapshot.text, selection.start, selection.end);
    const id = generateUlid();
    threads.push({ id, anchor, comments: [], resolved: false, createdAt: new Date().toISOString() });
    activeThreadId = id;

    // refresh() must run before the query below because the thread card does not exist in the DOM until the pane has painted it.
    refresh();

    const box = pane.element.querySelector<HTMLTextAreaElement>(`[data-thread-id="${id}"] .kdoc-comment-reply`);
    if (box !== null) {
      // The freshly created card is visible, so hand focus to its reply field for immediate typing.
      box.focus();
    } else {
      // Comment: the card is filtered out of the current view, so there is nothing to focus; the draft still exists and appears when the filter allows it.
    }

    return true;
  }

  /**
   * @purpose Loads persisted comment threads from the store and installs them as the current set.
   * @inputs options.store.load<CommentThread>('comments') - async persistence read returning records plus any parse problems; options.onError? - optional sink for recoverable or fatal errors.
   * @outputs Promise<void> - resolves once threads are installed and the pane has been repainted to match.
   * @dataflow Store records → spread into threads array → problem count reported via onError when non-empty → store failure surfaced as an Error → repaint through refresh().
   * @controlflow Attempt load → on success install records and report skipped rows only if any exist → on failure surface a normalized error → always repaint at the end, even after a failed load.
   */
  async function load(): Promise<void> {
    try {
      const result = await options.store.load<CommentThread>('comments');
      threads = [...result.records];

      // A skipped record is reported rather than swallowed: losing a comment silently is how a reviewer's note disappears without anyone noticing.
      if (result.problems.length > 0) {
        options.onError?.(new Error(`${result.problems.length} unreadable comment record(s) skipped`));
      } else {
        // Comment: every record parsed, nothing to report.
      }
    } catch (error: unknown) {
      // Normalize non-Error throws so callers always receive a real Error instance with a stack trace.
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    // refresh() runs outside the try so that even a failed load still paints an empty, working pane rather than leaving the previous document's comments on screen.
    refresh();
  }

  /**
   * @purpose Exposes the number of comment threads currently held in memory.
   * @inputs None; reads the module-scoped `threads` array.
   * @outputs number - the current count of threads, including drafts and resolved threads alike.
   * @dataflow threads.length → return value handed to callers (e.g., badges or empty-state toggles).
   * @controlflow Single read-and-return with no branching.
   */
  function threadCount(): number {
    // Return the live length so counts always reflect the most recent add/remove/load cycle.
    return threads.length;
  }

  /**
   * @purpose Tears down all pane-owned resources and detaches DOM listeners on controller disposal.
   * @inputs None; consumes only `pane`, which owns the underlying view lifecycle.
   * @outputs void - no value returned; side effect is resource cleanup.
   * @dataflow destroy() call → pane.destroy() releases its element, subscriptions, and event handlers.
   * @controlflow Single delegation with no branching or error handling of its own.
   */
  function destroy(): void {
    // Delegate teardown to the pane so view lifecycle stays owned in one place.
    pane.destroy();
  }

  return {
    element: pane.element,
    load,
    addComment,
    refresh,
    // A getter rather than a copy taken now: the array is replaced as threads are added, resolved and
    // deleted, and a caller reading a snapshot from construction time would export the wrong comments.
    get threads(): readonly CommentThread[] {
      return threads;
    },
    get display(): CommentDisplay {
      return display;
    },
    setDisplay,
    threadCount,
    destroy,
  };
}
