// @vitest-environment jsdom
/**
 * @file comments-controller.test.ts
 * @purpose Vitest suite exercising createCommentsController end-to-end against a fake AnnotationStore and the real DOM, covering draft creation, reply promotion, deletion, resolution, load/installation of persisted records, and error surfacing.
 * @inputs Document text; per-test selection overrides; recorder fields (records/problems/failLoad) mutated before controller.load(); card button clicks dispatched on the pane's rendered elements.
 * @outputs Controller surface assertions: threadCount(), saved[], spans[], revealed[], errors[]; DOM element queries for .kdoc-comment-card / reply textarea / submit / delete / resolve buttons.
 * @functions
 *   - assertNotNull: Asserts a value is neither null nor undefined, narrowing its type via an assertion signature.
 *   - makeStore: Builds a fake AnnotationStore plus mutable recorder fields (saved/records/problems/failLoad) so tests can drive load() and observe save().
 *   - makeController: Wires createCommentsController to jsdom globals while recording spans/revealed/errors, exposing selection state and helpers.
 *   - withRealThread: Builds a controller, opens a real thread via addComment + reply submit, returns the shared setup plus the resolved thread id.
 * @dataflow Test recorder fields → store.load/save closures mutate them; readSelection closure feeds addComment; onSpans/revealRange/onError sinks feed recorded arrays; card clicks fire handler callbacks that mutate threads then persist().
 * @controlflow Describe suite → each test builds or reuses a controller, drives DOM actions, awaits persisted writes via Promise.resolve(), and asserts on the recorded surfaces.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import type { CommentSpan, CommentThread } from '@k-doc/core';
import type { InlineNote } from './comments-controller.js';
import { createCommentsController, type CommentsController } from './comments-controller.js';
import type { AnnotationStore } from '../files/annotation-store.js';

/**
 * @purpose Asserts that a value is neither null nor undefined and narrows its declared type for downstream use.
 * @inputs value — the possibly-nullish candidate to validate, typed as T | null | undefined.
 * @outputs void; throws when the assertion fails so callers can safely treat `value` as T afterward.
 * @dataflow value ?? null → expect(...).not.toBeNull() predicate result.
 * @controlflow Single negated null check with no branching; failure propagates out of this helper to Vitest's runner.
 */
function assertNotNull<T>(value: T | null | undefined): asserts value is T {
  // Coerce to a concrete object so the matcher always has something to compare against, even for undefined inputs.
  expect(value ?? null).not.toBeNull();
}

/**
 * @purpose Constructs a fake AnnotationStore together with mutable recorder fields that tests set before invoking load() or inspect after save().
 * @inputs None — all state lives on the returned recorder object so it is fully controllable from each test.
 * @outputs An object exposing saved/records/problems/failLoad plus the store:AnnotationStore implementation itself.
 * @dataflow Recorder fields → captured by the load/save closures at call time (read lazily, not at construction) → observed through saved[].
 * @controlflow Declare recorder state once; build a typed AnnotationStore whose methods read those mutable fields so late assignment is honored.
 */
function makeStore() {
  // These four fields are deliberately plain properties on the recorder so tests can assign them before load()/save() runs and observe their effect.
  const recorder = {
    saved: [] as CommentThread[][],
    records: [] as CommentThread[],
    problems: [] as Array<{ line: number; message: string; raw: string }>,
    failLoad: false,
  };

  // Declaring the object literal with an explicit AnnotationStore annotation forces every member to satisfy the real interface without any `any` casts.
  const store: AnnotationStore = {
    available: true,
    resolve: async () => null,
    peekId: () => null,
    // Read recorder.records/problems lazily so a test can populate them after makeStore() but before controller.load(); the generic T is satisfied via `unknown` bridging rather than `any`.
    load: async <T>() => {
      // A test sets failLoad to exercise the controller's error path.
      if (recorder.failLoad) {
        // Reject the read the way a real store failure would.
        throw new Error('boom');
      } else {
        // Normal read: hand back whatever the test staged.
      }
      return { records: recorder.records as unknown as T[], problems: recorder.problems };
    },
    // Persisted output is captured verbatim per save call so tests can assert on exactly what was written to disk.
    save: async (_kind, recs) => {
      recorder.saved.push([...recs] as unknown as CommentThread[]);
    },
    destroy: () => {},
  };

  return { recorder, store };
}

/**
 * @purpose Builds a controller wired to jsdom globals while recording every span sink, reveal call, and error report for later assertions.
 * @inputs text — the document body backing new DocumentSession; overrides.author — optional author name overriding the default 'Ada'.
 * @outputs An object exposing controller/store/recorder/spans/revealed/errors/selection plus setSelection(start,end) to drive addComment().
 * @dataflow readSelection closure → selection field (mutated by setSelection); onSpans/onError sinks push into recorded arrays; revealRange pushes {start,end}.
 * @controlflow Construct recorder + controller once, then expose the mutable pieces so each test can configure state before invoking an action.
 */
function makeController(text: string = 'The quick brown fox jumps over the lazy dog', overrides?: { author?: string }) {
  const { recorder, store } = makeStore();

  // selection is a closure variable read by addComment; exposed via get/set so direct assignment and setSelection() both drive it.
  let selectionValue: { start: number; end: number } | null = null;

  // Each onSpans call records a snapshot copy of the emitted spans for per-step inspection after refresh().
  const spans: CommentSpan[][] = [];

  // Every onNotes emission recorded as a snapshot copy, the same way spans are, so a test can ask what the
  // document was told to draw rather than inferring it from what the pane shows.
  const notes: InlineNote[][] = [];

  // revealRange calls are recorded so tests can assert scroll targets when selecting threads.
  const revealed: Array<{ start: number; end: number }> = [];

  // onError reports accumulate here so load() failures and save() failures remain observable after the fact.
  const errors: Error[] = [];

  const controller: CommentsController = createCommentsController({
    doc: document,
    session: new DocumentSession(text),
    store,
    author: (): string => overrides?.author ?? 'Ada',
    readSelection: () => selectionValue,
    revealRange: (start: number, end: number) => {
      revealed.push({ start, end });
    },
    onNotes: (emitted: readonly InlineNote[]) => {
      notes.push([...emitted]);
    },
    onSpans: (emittedSpans: readonly CommentSpan[]) => {
      spans.push([...emittedSpans] as CommentSpan[]);
    },
    onError: (error: Error) => {
      errors.push(error);
    },
  });

  // setSelection(start,end) is the ergonomic entry point tests use to configure a range before addComment().
  const setSelection = (start: number, end: number): void => {
    selectionValue = { start, end };
  };

  return { controller, store, recorder, spans, notes, revealed, errors, setSelection };
}

/**
 * @purpose Encapsulates the shared setup for tests that need one real (non-draft) thread already promoted via a reply.
 * @inputs text — document body; defaults to the standard quick-brown-fox sentence so all suite tests agree on offsets.
 * @outputs The controller, recorder, recorded surfaces, and `id` of the single promoted thread for cross-test assertions.
 * @dataflow setSelection(4,9) → addComment() draft → locate card textarea → fill reply → click submit → persist writes one real thread; id captured from that thread.
 * @controlflow Build controller, open a selection, create the draft, simulate the first reply synchronously, then return once setup is complete so each test awaits its own write.
 */
async function withRealThread(text: string = 'The quick brown fox jumps over the lazy dog') {
  const result = makeController(text);

  // Select the word "quick" (offsets 4..9) so addComment() has a real spanned range to anchor on rather than a collapsed caret.
  result.setSelection(4, 9);

  // Creating the draft registers it and repaints; awaiting settles any fire-and-forget write from refresh/persist wiring before we query the DOM.
  const created = result.controller.addComment();
  await Promise.resolve();
  expect(created).toBe(true);

  // The freshly painted card carries data-thread-id on its root element, which every subsequent button lookup anchors to.
  const card = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-card');
  assertNotNull(card);
  const threadId = card.getAttribute('data-thread-id');
  assertNotNull(threadId);

  // Locate the reply textarea inside this specific card and give it real body text so onReply() promotes the draft into a live comment.
  const box = result.controller.element.querySelector<HTMLTextAreaElement>(`.kdoc-comment-reply`);
  assertNotNull(box);
  box.value = 'Needs a citation';

  // Clicking the submit button fires the reply handler; awaiting lets persist() flush before assertions read saved[].
  const submit = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-reply-submit');
  assertNotNull(submit);
  submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();

  return { ...result, id: threadId };
}

/**
 * @purpose Top-level suite grouping every comments-controller behavior under a single describe block for readable Vitest output.
 * @inputs None — all state is constructed inside individual tests or via withRealThread().
 * @outputs Void; each it() registers its own assertions against the recorded controller surfaces.
 * @dataflow Suite → per-test controller construction → DOM/action drive → assertion on spans/revealed/errors/saved/threadCount.
 * @controlflow describe wraps twelve focused it() cases that run sequentially, each starting from a clean controller unless reusing withRealThread().
 */
describe('comments-controller', () => {
  // The standard document body reused across tests so anchor offsets (e.g., "quick" at 4..9) stay constant.
  const text = 'The quick brown fox jumps over the lazy dog';

  it('declines addComment() when there is no selection and reports zero threads', async () => {
    // With selectionValue left null, readSelection() returns null so addComment() must decline without creating anything.
    const result = makeController(text);

    // No selection means nothing to anchor a note on; the controller returns false rather than throwing or fabricating an empty thread.
    const created = result.controller.addComment();
    await Promise.resolve();

    expect(created).toBe(false);
    expect(result.controller.threadCount()).toBe(0);
  });

  it('declines addComment() for a collapsed caret and reports zero threads', async () => {
    // A caret with start == end spans no text, so even though selection is non-null the controller must treat it as "nothing to do".
    const result = makeController(text);
    result.setSelection(4, 4);

    // Collapsed ranges carry no anchorable span; addComment() returns false and leaves threads untouched.
    const created = result.controller.addComment();
    await Promise.resolve();

    expect(created).toBe(false);
    expect(result.controller.threadCount()).toBe(0);
  });

  it('promotes a real selection into a draft card', async () => {
    // Selecting "quick" (4..9) gives addComment() a genuine spanned range, so the controller should create and register one thread.
    const result = makeController(text);
    result.setSelection(4, 9);

    // A valid selection creates the draft; threadCount reflects exactly one registered thread immediately after creation.
    const created = result.controller.addComment();
    await Promise.resolve();

    expect(created).toBe(true);
    expect(result.controller.threadCount()).toBe(1);

    // The rendered pane must contain a card element carrying the draft's data-thread-id attribute for later lookups.
    const card = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-card');
    assertNotNull(card);
  });

  it('paints no decoration span while a draft has no comment text', async () => {
    // A draft with empty comments carries nothing to say about the document, so planDecorations must emit an empty span list for it.
    const result = makeController(text);
    result.setSelection(4, 9);

    const created = result.controller.addComment();
    await Promise.resolve();
    expect(created).toBe(true);

    // The most recent refresh() produced the spans recorded last; a draft must leave that entry empty so nothing is highlighted.
    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBe(0);
  });

  it('never persists a draft with no comment text', async () => {
    // Persist() filters out drafts, so an unwritten comment must never reach the store's saved[] list.
    const result = makeController(text);
    result.setSelection(4, 9);

    const created = result.controller.addComment();
    await Promise.resolve();
    expect(created).toBe(true);

    // This proves creating a draft triggers no write at all. It does not prove persist() would filter a
    // draft out of one -- addComment() only refreshes and never saves, so nothing is on disk either way.
    // The test below is the one that pins the filter.
    expect(result.recorder.saved.length).toBe(0);
  });

  it('excludes a draft from a save triggered by another thread', async () => {
    // Selecting "quick" (4..9) gives addComment() a genuine spanned range to anchor on, so the first card is created as a draft.
    const result = makeController(text);
    result.setSelection(4, 9);

    // The valid selection creates the first thread; it must return true and its data-thread-id becomes the handle for later lookups.
    const createdFirst = result.controller.addComment();
    await Promise.resolve();
    expect(createdFirst).toBe(true);

    // The freshly painted card carries data-thread-id on its root element, which every subsequent button lookup anchors to.
    const card = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-card');
    assertNotNull(card);
    const firstId = card.getAttribute('data-thread-id');
    assertNotNull(firstId);

    // Filling the reply box and clicking submit promotes this draft into a real comment, which fires the first save.
    const firstBox = result.controller.element.querySelector<HTMLTextAreaElement>('.kdoc-comment-reply');
    assertNotNull(firstBox);
    firstBox.value = 'A real note';

    const firstSubmit = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-reply-submit');
    assertNotNull(firstSubmit);
    firstSubmit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Selecting "jumps" (20..25) creates a second thread while the promoted one is already real; both are open so both cards render.
    result.setSelection(20, 25);
    const createdSecond = result.controller.addComment();
    await Promise.resolve();
    expect(createdSecond).toBe(true);

    // One real (promoted) thread plus one draft means exactly two threads are registered in memory.
    expect(result.controller.threadCount()).toBe(2);

    // Filling the REAL thread's reply box again and submitting fires a second save while the draft is still present in memory.
    const realBox = result.controller.element.querySelector<HTMLTextAreaElement>(`[data-thread-id="${firstId}"] .kdoc-comment-reply`);
    assertNotNull(realBox);
    const realSubmit = result.controller.element.querySelector<HTMLElement>(`[data-thread-id="${firstId}"] .kdoc-comment-reply-submit`);
    assertNotNull(realSubmit);
    realBox.value = 'A second note';
    realSubmit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // The newest saved snapshot must contain only the single real thread — its id is firstId.
    const latestSaved = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(latestSaved);
    expect(latestSaved.length).toBe(1);
    // This draft sits in memory and would be written if persist() did not filter it; pinning length === 1 with the real id is what actually proves the rule. An unwritten comment is not a comment, and writing one would drop an empty record into a file committed to git.
    const savedThread = latestSaved[0];
    assertNotNull(savedThread);
    expect(savedThread.id).toBe(firstId);
  });

  it('stamps the author each comment was written under', async () => {
    // Attribution is read when a comment is written, not when the controller was built: a reply posted after an author
    // rename carries the new name while every earlier comment keeps the name it was written under — exactly what a reader of a
    // thread expects. This pins that behavior by writing one comment as 'Ada', renaming to 'Grace', then writing a second, and
    // asserting each persisted comment records the author in force at its own moment of creation.
    const overrides: { author?: string } = { author: 'Ada' };
    const result = makeController('The quick brown fox jumps over the lazy dog', overrides);

    // Select "quick" (offsets 4..9) so addComment() has a real spanned range to anchor on rather than a collapsed caret.
    result.setSelection(4, 9);

    // Creating the draft registers it and repaints; awaiting settles any fire-and-forget write from refresh/persist wiring before we query the DOM.
    const created = result.controller.addComment();
    await Promise.resolve();
    expect(created).toBe(true);

    // Locate this card's reply textarea and give it real body text so onReply() promotes the draft into a live comment.
    // The pane re-renders after each reply, so both elements are re-queried here rather than reused — a held reference would be stale.
    const firstBox = result.controller.element.querySelector<HTMLTextAreaElement>(`.kdoc-comment-reply`);
    assertNotNull(firstBox);
    firstBox.value = 'First';

    // Clicking the submit button fires the reply handler; awaiting lets persist() flush before assertions read saved[].
    const firstSubmit = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-reply-submit');
    assertNotNull(firstSubmit);
    firstSubmit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Rename the author mid-thread; the next write must pick up 'Grace' while the comment above keeps 'Ada'.
    overrides.author = 'Grace';

    // Re-query both elements after the re-render, then post a second reply under the new name.
    const secondBox = result.controller.element.querySelector<HTMLTextAreaElement>(`.kdoc-comment-reply`);
    assertNotNull(secondBox);
    secondBox.value = 'Second';

    const secondSubmit = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-reply-submit');
    assertNotNull(secondSubmit);
    secondSubmit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // The newest persisted snapshot must contain the single thread with both comments in write order.
    const savedThreads = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(savedThreads);
    const firstThread = savedThreads[0];
    assertNotNull(firstThread);
    assertNotNull(firstThread.comments);
    expect(firstThread.comments.length).toBe(2);

    // Each comment records the author in force when it was written: 'Ada' for the first, 'Grace' for the second.
    const firstComment = firstThread.comments[0];
    assertNotNull(firstComment);
    expect(firstComment.author).toBe('Ada');
    const secondComment = firstThread.comments[1];
    assertNotNull(secondComment);
    expect(secondComment.author).toBe('Grace');

    // Capturing the name at construction would have stamped 'Ada' on both; this case is the only one that would notice.
  });

  it('rewrites a comment body and stamps it edited', async () => {
    // Editing an existing comment replaces its text in place: the entry keeps its id and its createdAt, and only the
    // body and the edit stamp move — which is exactly what lets a reader tell a revised comment from a new one.
    const result = await withRealThread();

    // Capture the original createdAt now, before any edit, so the assertion below compares two real values rather than
    // pinning a literal that could drift if the helper's text or timing changes.
    const latestSavedBefore = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(latestSavedBefore);
    const savedThreadBefore = latestSavedBefore[0];
    assertNotNull(savedThreadBefore);
    assertNotNull(savedThreadBefore.comments);
    const firstCommentBefore = savedThreadBefore.comments[0];
    assertNotNull(firstCommentBefore);
    const createdAtBefore = firstCommentBefore.createdAt;

    // Open the inline editor for this comment entry so its body can be rewritten.
    const editBtn = result.controller.element.querySelector<HTMLElement>('button.kdoc-comment-edit');
    assertNotNull(editBtn);
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Fill the editor box with the replacement text, then commit it by clicking save.
    const box = result.controller.element.querySelector<HTMLTextAreaElement>('textarea.kdoc-comment-edit-box');
    assertNotNull(box);
    box.value = 'Needs two citations';

    // Clicking save persists the in-place rewrite; awaiting lets flush() write before assertions read saved[].
    const saveBtn = result.controller.element.querySelector<HTMLElement>('button.kdoc-comment-edit-save');
    assertNotNull(saveBtn);
    saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // The newest persisted snapshot must reflect the rewrite of the same single comment, not a new thread.
    const latestSaved = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(latestSaved);
    const savedThread = latestSaved[0];
    assertNotNull(savedThread);
    assertNotNull(savedThread.comments);
    const firstComment = savedThread.comments[0];
    assertNotNull(firstComment);

    // The body must be the replacement text and editedAt must now carry a real timestamp rather than null.
    expect(firstComment.body).toBe('Needs two citations');
    expect(firstComment.editedAt).not.toBeNull();

    // createdAt is preserved from before the edit, proving this is a revision of the original comment rather than a new entry.
    expect(firstComment.createdAt).toBe(createdAtBefore);
  });

  it('writes nothing when the editor is cancelled', async () => {
    // An abandoned edit must leave no trace at all — not a new version in the store and not a changed body on screen —
    // because a cancel that half-applied would be worse than one that did nothing.
    const result = await withRealThread();

    // Record how many save batches exist before any interaction so the assertion can prove no write happened at all.
    const before = result.recorder.saved.length;

    // Open the inline editor, change its text, then cancel instead of committing.
    const editBtn = result.controller.element.querySelector<HTMLElement>('button.kdoc-comment-edit');
    assertNotNull(editBtn);
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    const box = result.controller.element.querySelector<HTMLTextAreaElement>('textarea.kdoc-comment-edit-box');
    assertNotNull(box);
    box.value = 'Abandoned';

    // Clicking cancel discards the in-progress change; awaiting lets any flush settle before assertions read saved[].
    const cancelBtn = result.controller.element.querySelector<HTMLElement>('button.kdoc-comment-edit-cancel');
    assertNotNull(cancelBtn);
    cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // No save batch may have been produced by the cancelled edit; the count is exactly what it was before.
    expect(result.recorder.saved.length).toBe(before);

    // The on-screen body must still read the original reply text, proving the cancel reverted any in-memory change too.
    const card = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-body');
    assertNotNull(card);
    expect(card.textContent).toBe('Needs a citation');
  });

  it('writes nothing when the edited comment is gone by the time Save is pressed', async () => {
    // A thread holding only one comment cannot lose that comment without dropping the whole thread, so this test seeds a second
    // comment first; deleting index 1 leaves index 0 intact and forces the onEdit→editEntry race branch rather than the
    // delete-thread branch. This pins that an edit whose entry has vanished by Save time writes nothing to the store at all.
    const result = await withRealThread();

    // Add a second comment to the same thread so two entries exist; deleting only one keeps the thread alive for this test,
    // because removing the sole comment would drop the whole thread and take a different branch.
    const replyBox = result.controller.element.querySelector<HTMLTextAreaElement>('textarea.kdoc-comment-reply');
    assertNotNull(replyBox);
    replyBox.value = 'And a date';

    const replySubmit = result.controller.element.querySelector<HTMLElement>('button.kdoc-comment-reply-submit');
    assertNotNull(replySubmit);
    replySubmit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Two comments now exist, so two edit buttons render; index 1 is the second entry this test rewrites and then deletes.
    const editButtons = result.controller.element.querySelectorAll<HTMLElement>('button.kdoc-comment-edit');
    assertNotNull(editButtons[1]);
    editButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Two editor boxes render alongside the two entries; index 1 belongs to the second entry being edited.
    const editBoxes = result.controller.element.querySelectorAll<HTMLTextAreaElement>('textarea.kdoc-comment-edit-box');
    assertNotNull(editBoxes[1]);
    editBoxes[1].value = 'And a date, ideally';

    // Hold this Save button reference deliberately so it survives the re-render that deletion triggers; it is about to go stale on purpose.
    const saveButtons = result.controller.element.querySelectorAll<HTMLElement>('button.kdoc-comment-edit-save');
    assertNotNull(saveButtons[1]);
    const staleSave = saveButtons[1];

    // Delete the second comment (index 1); the pane re-renders after every mutation, so every element captured above is now stale.
    const deleteButtons = result.controller.element.querySelectorAll<HTMLElement>('button.kdoc-comment-delete');
    assertNotNull(deleteButtons[1]);
    deleteButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // Count save batches before the stale click so the assertion proves no write happened at all.
    const before = result.recorder.saved.length;

    // Clicking the held Save still fires the deleted entry's handler, which closes over its id — precisely the stale callback the guard exists for.
    staleSave.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // No save batch may have been produced by editing a comment that no longer exists; the count is exactly what it was before.
    // A no-op edit must not append a version to the store — the file is committed to git, and a spurious revision is a change someone has to explain.
    expect(result.recorder.saved.length).toBe(before);
  });

  it('draws the highlight and no note in margin mode', async () => {
    // Margin is the default display, so this exercises exactly the behaviour that existed before the toggle was added; proving the highlight still paints and no margin note appears guards against a regression for anyone who never touches the setting.
    const result = await withRealThread();

    // The decoration span must still be emitted in margin mode: "quick" (4..9) is highlighted exactly as before the toggle.
    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBeGreaterThan(0);

    // No margin note is drawn in the default mode, so the recorded notes snapshot for this paint must be empty.
    const latestNotes = result.notes[result.notes.length - 1];
    assertNotNull(latestNotes);
    expect(latestNotes.length).toBe(0);
  });

  it('draws the comment inline when asked', async () => {
    // Switching to inline display surfaces the note in the document at the end of the anchored range, because a comment is about the text before it and so sits flush against that range's trailing edge rather than floating off to a margin.
    const result = await withRealThread();
    result.controller.setDisplay('inline');

    // The recorded notes snapshot for this paint must carry exactly one note whose body matches the promoted reply...
    const latestNotes = result.notes[result.notes.length - 1];
    assertNotNull(latestNotes);
    expect(latestNotes.length).toBe(1);
    const firstNote = latestNotes[0];
    assertNotNull(firstNote);
    expect(firstNote.body).toBe('Needs a citation');

    // ...and whose offset equals the end of the highlighted span, pinning the note to the range's trailing edge.
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBeGreaterThan(0);
    const firstSpan = latestSpans[0];
    assertNotNull(firstSpan);
    expect(firstNote.offset).toBe(firstSpan.end);
  });

  it('keeps the highlight in inline mode', async () => {
    // Inline display must not drop the decoration: the note says what the comment is and the highlight says what it is about, so one without the other is half an answer.
    const result = await withRealThread();
    result.controller.setDisplay('inline');

    // The span emitted after switching to inline must still be non-empty, proving the highlight survives alongside the note.
    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBeGreaterThan(0);
  });

  it('draws nothing in the document when hidden', async () => {
    // Hiding removes all document markup but must not drop the thread itself: hidden hides the markup rather than the comments, because the pane is the panel the user deliberately opened and still lists them.
    const result = await withRealThread();
    result.controller.setDisplay('hidden');

    // With markup hidden, both the recorded spans and notes snapshots for this paint must be empty.
    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBe(0);

    const latestNotes = result.notes[result.notes.length - 1];
    assertNotNull(latestNotes);
    expect(latestNotes.length).toBe(0);

    // Hiding the markup does not remove the thread, so it is still counted — the comment lives on even though nothing is drawn.
    expect(result.controller.threadCount()).toBe(1);
  });

  it('promotes a draft into a real thread on first reply while reusing the id', async () => {
    // Submitting a reply turns the draft into a live comment; the controller must keep the same data-thread-id so the card does not jump.
    const result = await withRealThread(text);

    // Promotion keeps exactly one thread — no duplicate is created, only the existing draft gains its first comment.
    expect(result.controller.threadCount()).toBe(1);

    // The reply was persisted as a single real (non-draft) thread containing that one comment authored by 'Ada' with the submitted body.
    expect(result.recorder.saved.length).toBe(1);
    const savedThreads = result.recorder.saved[0];
    assertNotNull(savedThreads);
    expect(savedThreads.length).toBe(1);

    // The persisted thread's single comment must carry the author and exact reply text supplied by the test.
    const firstThread = savedThreads[0];
    assertNotNull(firstThread);
    assertNotNull(firstThread.comments);
    expect(firstThread.comments.length).toBe(1);
    const firstComment = firstThread.comments[0];
    assertNotNull(firstComment);
    expect(firstComment.author).toBe('Ada');
    expect(firstComment.body).toBe('Needs a citation');

    // The persisted id must equal the draft's data-thread-id, proving reuse rather than replacement of the card currently on screen.
    expect(firstThread.id).toBe(result.id);
  });

  it('paints exactly one span for a promoted thread', async () => {
    // Once real text exists, planDecorations emits a single decoration covering the anchored range so the editor highlights it.
    const result = await withRealThread(text);

    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBe(1);

    // The single emitted span must reference the promoted thread's id so decoration maps back to its owning comment.
    const firstSpan = latestSpans[0];
    assertNotNull(firstSpan);
    expect(firstSpan.threadId).toBe(result.id);
  });

  it('installs persisted records on load and paints them', async () => {
    // A single real thread with a resolvable anchor should install into threads and produce one decoration span after load().
    const result = makeController(text);

    // Build an anchored record whose range ("brown" at offset 10) resolves within the standard document so planDecorations can emit a span.
    const installedThread: CommentThread = {
      id: 't1',
      anchor: { quotedText: 'brown', prefixContext: '', suffixContext: '', charOffset: 10, blockHash: 'h' },
      comments: [{ id: 'c1', author: 'Grace', body: 'Nice line', createdAt: '2026-09-07T10:00:00.000Z', editedAt: null }],
      resolved: false,
      createdAt: '2026-09-07T10:00:00.000Z',
    };

    // Assign records before load() so the fake store returns this thread from its async read.
    result.recorder.records = [installedThread];

    await result.controller.load();
    await Promise.resolve();

    // The installed record becomes a live thread visible to threadCount().
    expect(result.controller.threadCount()).toBe(1);

    // Loading repaints, so the last recorded spans entry must contain exactly one span for the anchored comment.
    expect(result.spans.length).toBeGreaterThan(0);
    const latestSpans = result.spans[result.spans.length - 1];
    assertNotNull(latestSpans);
    expect(latestSpans.length).toBe(1);
  });

  it('reports unreadable records without swallowing them', async () => {
    // Two skipped parse problems must surface as a single error whose message encodes the count, so silent data loss is impossible.
    const result = makeController(text);

    // Populate two problem rows before load() to simulate corrupted persisted records that could not be parsed.
    result.recorder.problems = [
      { line: 1, message: 'bad hash', raw: '{"id":"x"}' },
      { line: 2, message: 'missing anchor', raw: '{"id":"y"}' },
    ];

    await result.controller.load();
    await Promise.resolve();

    // Exactly one error is reported for the batch of unreadable records.
    expect(result.errors.length).toBe(1);
    const firstError = result.errors[0];
    assertNotNull(firstError);

    // The message must mention the count '2' so a reviewer can see how many records were lost at a glance.
    expect(firstError.message).toContain('2');
  });

  it('still paints a working pane when load fails', async () => {
    // A thrown load error must be reported but never block repaint, so the previous document's comments do not linger on screen.
    const result = makeController(text);

    // Force the fake store to reject its read path before invoking load().
    result.recorder.failLoad = true;

    await result.controller.load();
    await Promise.resolve();

    // The failure is surfaced exactly once through onError rather than swallowed or duplicated.
    expect(result.errors.length).toBe(1);

    // No records installed means zero threads remain after the failed load.
    expect(result.controller.threadCount()).toBe(0);

    // refresh() still ran, so at least one spans entry exists — the pane is painted and usable despite the error.
    expect(result.spans.length).toBeGreaterThan(0);
  });

  it('removes the thread when its only comment is deleted', async () => {
    // Deleting the sole comment empties the thread, which must drop it entirely and persist an empty record set.
    const result = await withRealThread(text);

    const delBtn = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-delete');
    assertNotNull(delBtn);
    delBtn.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await Promise.resolve();

    // An emptied thread is not a thread, so threadCount drops to zero after deletion.
    expect(result.controller.threadCount()).toBe(0);

    // The newest persisted snapshot reflects the removal as an empty array of threads (a real write happened).
    const latestSaved = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(latestSaved);
    expect(latestSaved.length).toBe(0);
  });

  it('persists resolution while keeping the thread', async () => {
    // Resolving flips the resolved flag immutably and persists, but leaves the thread in place rather than removing it.
    const result = await withRealThread(text);

    const resolveBtn = result.controller.element.querySelector<HTMLElement>('.kdoc-comment-resolve');
    assertNotNull(resolveBtn);
    resolveBtn.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await Promise.resolve();

    // Resolving does not delete the thread, so it remains counted after the toggle.
    expect(result.controller.threadCount()).toBe(1);

    // The newest persisted snapshot carries exactly one thread whose resolved flag is now true.
    const latestSaved = result.recorder.saved[result.recorder.saved.length - 1];
    assertNotNull(latestSaved);
    expect(latestSaved.length).toBe(1);
    const savedThread = latestSaved[0];
    assertNotNull(savedThread);
    expect(savedThread.resolved).toBe(true);
  });
});