// @vitest-environment jsdom
/**
 * @file comment-card.test.ts
 * @purpose Vitest suite exercising formatTimestamp and renderCommentCard from ./comment-card.js under jsdom.
 * @inputs CommentThread fixtures built by makeThread, recording callbacks built by makeCallbacks, rendered cards via renderOptions + renderCommentCard.
 * @outputs Pass/fail results for each behavior: timestamp formatting, quoted text, author/body, edited flag, reply posting, delete isolation, selection, resolve label/aria, orphan handling, active class.
 * @functions
 *   - assertNotNull: Narrows a possibly-null DOM node to non-null via an expect-based assertion predicate.
 *   - makeThread: Builds a CommentThread fixture with sensible defaults overridable by partial overrides.
 *   - makeCallbacks: Returns recording arrays plus a wired CommentCardCallbacks object capturing each action.
 *   - renderOptions: Assembles full CommentCardOptions from partial overrides for rendering a card.
 * @dataflow Fixture data → renderCommentCard → detached HTMLElement → querySelector reads + dispatched events → recorded callback args asserted by expect.
 * @controlflow describe block groups tests per helper; each it renders fresh state, performs an action or read, then asserts with real expectations.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import type { CommentThread } from '@k-doc/core';
import { formatTimestamp, renderCommentCard, type CommentCardCallbacks, type CommentCardOptions } from './comment-card.js';

/**
 * Asserts a possibly-null value is non-null and narrows its type for subsequent reads.
 * @purpose Provides an expect-based narrowing guard so tests never use the `!` operator or early-return on null queries.
 * @inputs value - The candidate DOM node (or other value) that may be null at runtime.
 * @outputs void; throws a Vitest assertion failure when value is null, which narrows type via the asserts predicate.
 * @dataflow Runtime value → expect(value).not.toBeNull() → TypeScript control-flow narrowing to non-null for callers.
 * @controlflow Single guard: fails loudly on null (test stops here), otherwise returns and leaves `value` narrowed to T.
 */
function assertNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull();
}

/**
 * Builds a CommentThread fixture with sensible defaults, overridable per test via partial overrides.
 * @purpose Centralizes the default thread shape so individual tests only specify what differs.
 * @inputs overrides - Partial<CommentThread> of fields to replace on top of the defaults (e.g. resolved: true).
 * @outputs A fully-typed CommentThread ready for renderCommentCard or formatTimestamp reference reads.
 * @dataflow Defaults + partial overrides → spread merge → concrete CommentThread instance returned to caller.
 * @controlflow Constant default object constructed once per call; override keys win via the spread operator, no branching.
 */
function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  const thread: CommentThread = {
    id: 't1',
    anchor: { quotedText: 'the quick brown fox', prefixContext: '', suffixContext: '', charOffset: 0, blockHash: 'abc' },
    comments: [
      { id: 'c1', author: 'Ada', body: 'First note', createdAt: '2026-09-07T10:00:00.000Z', editedAt: null },
    ],
    resolved: false,
    createdAt: '2026-09-07T10:00:00.000Z',
  };

  // Partial overrides are spread last so any field the test cares about replaces its default value.
  return { ...thread, ...overrides };
}

/**
 * Builds recording callbacks that capture each action into typed arrays for later assertions.
 * @purpose Lets tests assert on user actions (select/reply/toggle/delete) without a real pane backend.
 * @inputs none - Returns a fresh recorder object per call so state never leaks between test cases.
 * @outputs An object with four recording arrays plus the wired CommentCardCallbacks consumed by renderCommentCard.
 * @dataflow Each callback invocation → pushes its arguments onto the matching array → caller reads recorded values after dispatching events.
 * @controlflow Four arrow functions each append to their respective array; no branching, pure capture semantics throughout.
 */
function makeCallbacks(): {
  selected: string[];
  replied: Array<{ threadId: string; body: string }>;
  toggled: string[];
  deleted: Array<{ threadId: string; entryId: string }>;
  edited: Array<{ threadId: string; entryId: string; body: string }>;
  callbacks: CommentCardCallbacks;
} {
  const selected: string[] = [];
  const replied: Array<{ threadId: string; body: string }> = [];
  const toggled: string[] = [];
  const deleted: Array<{ threadId: string; entryId: string }> = [];
  const edited: Array<{ threadId: string; entryId: string; body: string }> = [];

  // Each callback records its arguments so the test can assert exactly what the card dispatched.
  const callbacks: CommentCardCallbacks = {
    onSelect: (threadId: string): void => {
      selected.push(threadId);
    },
    onReply: (threadId: string, body: string): void => {
      replied.push({ threadId, body });
    },
    onToggleResolved: (threadId: string): void => {
      toggled.push(threadId);
    },
    onDelete: (threadId: string, entryId: string): void => {
      deleted.push({ threadId, entryId });
    },
    onEdit: (threadId: string, entryId: string, body: string): void => {
      edited.push({ threadId, entryId, body });
    },
  };

  return { selected, replied, toggled, deleted, edited, callbacks };
}

/**
 * Assembles full CommentCardOptions from partial overrides for rendering a card.
 * @purpose Reduces repetition of the shared doc/isActive/isOrphaned fields across render calls.
 * @inputs overrides - Must supply thread and callbacks; isActive/isOrphaned are optional.
 * @outputs A complete CommentCardOptions object ready to pass into renderCommentCard.
 * @dataflow Defaults + explicit required fields → concrete options consumed by renderCommentCard.
 * @controlflow Constant defaults constructed once per call; override keys win via the spread operator, no branching.
 */
function renderOptions(
  overrides: { readonly thread: CommentThread; readonly callbacks: CommentCardCallbacks; readonly isActive?: boolean; readonly isOrphaned?: boolean },
): CommentCardOptions {
  const options = {
    doc: document,
    isActive: overrides.isActive ?? false,
    isOrphaned: overrides.isOrphaned ?? false,
    thread: overrides.thread,
    callbacks: overrides.callbacks,
  };

  // Defaults for doc/isActive/isOrphaned are filled in unless the test overrides them explicitly.
  return options;
}

describe('comment-card', () => {
  describe('formatTimestamp', () => {
    it('returns an unparseable string unchanged rather than "Invalid Date"', () => {
      // The raw value is the only clue to what went wrong in a hand-edited store file, so it must survive verbatim.
      expect(formatTimestamp('not a date')).toBe('not a date');
    });

    it("labels an event within one minute as 'just now'", () => {
      // Thirty seconds past the stored timestamp stays under the 60-second immediate threshold.
      const result = formatTimestamp('2026-09-07T10:00:00.000Z', new Date('2026-09-07T10:00:30.000Z'));
      expect(result).toBe('just now');
    });

    it("labels five minutes, three hours, and two days as '5 min ago', '3 h ago', and '2 d ago'", () => {
      // Base event fixed; each `now` advances by one unit bucket to exercise the minute/hour/day branches.
      const base = new Date('2026-09-07T10:00:00.000Z');

      expect(formatTimestamp(base.toISOString(), new Date('2026-09-07T10:05:00.000Z'))).toBe('5 min ago');
      expect(formatTimestamp(base.toISOString(), new Date('2026-09-07T13:00:00.000Z'))).toBe('3 h ago');
      expect(formatTimestamp(base.toISOString(), new Date('2026-09-09T10:00:00.000Z'))).toBe('2 d ago');
    });
  });

  describe('renderCommentCard', () => {
    it('never selects the card when a text box is clicked', () => {
      // Clicking into a box to type must not select the card, because selecting repaints, repainting rebuilds the card, and the rebuild throws away the element the user just clicked into along with anything typed in it.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      // The reply textarea is a guaranteed structural element, so assert non-null before dispatching to it.
      const replyEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-reply');
      assertNotNull(replyEl);
      // Bubbles: true means this click would reach the card's select handler unless the box stops propagation, which is exactly what this test guards against.
      replyEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // A click inside the reply box must not select the card, so no selection is recorded after it.
      expect(recorder.selected).toHaveLength(0);

      // Open the editor with Edit so a second text box exists to guard against selecting on click.
      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // The edit box appears once the editor opens, so assert it non-null before dispatching to it.
      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);
      // A bubbling click inside the edit box must also avoid selecting the card, otherwise the rebuild would destroy this very element mid-typing.
      boxEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // The edit box still did not select the card, so selection remains empty after both clicks.
      expect(recorder.selected).toHaveLength(0);

      // The box is still visible because a click that opened nothing must not have closed the editor; had it selected, the repaint would have hidden it.
      expect(boxEl.hidden).toBe(false);

      // The box staying visible is the part that would have failed before — the click that opened nothing would have closed the editor instead.
    });

    it('reveals the editor and hides the text', () => {
      // The read-only body is shown by default, so the edit box must be hidden before any interaction.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);
      expect(boxEl.hidden).toBe(true);

      // The body element is the primary read-only view, so it must be visible while the editor stays closed.
      const bodyEl = card.querySelector<HTMLElement>('.kdoc-comment-body');
      assertNotNull(bodyEl);
      expect(bodyEl.hidden).toBe(false);

      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Clicking Edit opens the editor, so the box becomes visible and is prefilled with the entry's body.
      expect(boxEl.hidden).toBe(false);
      expect(boxEl.value).toBe('First note');

      // The actions row appears alongside the editor so Save/Cancel are reachable once it is open.
      const actionsEl = card.querySelector<HTMLElement>('.kdoc-comment-edit-actions');
      assertNotNull(actionsEl);
      expect(actionsEl.hidden).toBe(false);

      // Once editing, the read-only body and both action buttons are hidden because they would duplicate or conflict with the editor.
      expect(bodyEl.hidden).toBe(true);
      expect(editBtnEl.hidden).toBe(true);

      const deleteBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-delete');
      assertNotNull(deleteBtnEl);
      // Hiding Delete while editing is deliberate: edit and delete are different intents, and offering both at once invites the wrong one.
      expect(deleteBtnEl.hidden).toBe(true);
    });

    it('reports the edited body once saved', () => {
      // The editor must be opened first so Save is reachable, then a value with surrounding whitespace is supplied.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);
      boxEl.value = '  Second thoughts  ';

      const saveBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit-save');
      assertNotNull(saveBtnEl);
      saveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Exactly one edit is recorded, carrying the thread id, the entry id, and the new body. The body is
      // asserted trimmed: the card trims before dispatching so the controller never has to decide what an
      // empty comment means.
      expect(recorder.edited).toEqual([{ threadId: 't1', entryId: 'c1', body: 'Second thoughts' }]);
    });

    it('refuses to save an empty body', () => {
      // The editor is opened so Save can be clicked, then a whitespace-only value simulates an accidental slip.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);
      boxEl.value = '   ';

      const saveBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit-save');
      assertNotNull(saveBtnEl);
      saveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // An empty comment is not a comment, so nothing is dispatched to the controller.
      expect(recorder.edited).toHaveLength(0);

      // Leaving the editor open (box still visible) says the click was understood and refused rather than lost; silently deleting here would be deletion by stealth — Delete is the control for that.
      expect(boxEl.hidden).toBe(false);
    });

    it('closes without a change when the text is untouched', () => {
      // The editor is opened, then Save is clicked without altering the prefilled value to test an unchanged edit.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);

      const saveBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit-save');
      assertNotNull(saveBtnEl);
      saveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // A comment nobody changed must not get an (edited) marker, so nothing is dispatched.
      expect(recorder.edited).toHaveLength(0);

      // An unchanged save closes the editor rather than dispatching, so the box is hidden again.
      expect(boxEl.hidden).toBe(true);
    });

    it('never changes the selection while editing', () => {
      // Every control must stop propagation so its click never reaches the card's select handler, which is why selection stays empty throughout.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const editBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit');
      assertNotNull(editBtnEl);

      // Opening the editor with Edit must not select the card, so no selection is recorded yet.
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(recorder.selected).toHaveLength(0);

      // Cancel closes the editor without editing, and its click must also avoid selecting the card.
      const cancelBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit-cancel');
      assertNotNull(cancelBtnEl);
      cancelBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(recorder.selected).toHaveLength(0);

      // Reopening the editor with Edit again must still leave selection untouched.
      editBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(recorder.selected).toHaveLength(0);

      // A changed value is set so Save would dispatch an edit, but it must not move the highlight either.
      const boxEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-edit-box');
      assertNotNull(boxEl);
      boxEl.value = 'A real change';

      const saveBtnEl = card.querySelector<HTMLElement>('button.kdoc-comment-edit-save');
      assertNotNull(saveBtnEl);
      saveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Every control stopped propagation first, so the selection array stays empty after all four clicks.
      expect(recorder.selected).toHaveLength(0);
    });

    it('renders the quoted anchor text inside .kdoc-comment-quote', () => {
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: makeCallbacks().callbacks }));

      // The quote block is a guaranteed-present structural element, so assert non-null before reading its text.
      const quoteEl = card.querySelector('.kdoc-comment-quote');
      assertNotNull(quoteEl);
      expect(quoteEl.textContent).toBe('the quick brown fox');
    });

    it("renders the author 'Ada' and body 'First note'", () => {
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: makeCallbacks().callbacks }));

      // Author and body are distinct structural elements, each asserted non-null before its text is read.
      const authorEl = card.querySelector('.kdoc-comment-author');
      assertNotNull(authorEl);
      expect(authorEl.textContent).toBe('Ada');

      const bodyEl = card.querySelector('.kdoc-comment-body');
      assertNotNull(bodyEl);
      expect(bodyEl.textContent).toBe('First note');
    });

    it("omits the '(edited)' marker by default and shows it only when editedAt is set", () => {
      // Default thread has editedAt: null, so no edited span should exist.
      const defaultCard = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: makeCallbacks().callbacks }));
      expect(defaultCard.querySelector('.kdoc-comment-edited')).toBeNull();

      // A non-null editedAt marks the entry as modified, so an edited span must now appear with its label.
      const editedThread = makeThread({ comments: [{ id: 'c1', author: 'Ada', body: 'First note', createdAt: '2026-09-07T10:00:00.000Z', editedAt: '2026-09-07T11:00:00.000Z' }] });
      const editedCard = renderCommentCard(renderOptions({ thread: editedThread, callbacks: makeCallbacks().callbacks }));

      const editedEl = editedCard.querySelector('.kdoc-comment-edited');
      assertNotNull(editedEl);
      expect(editedEl.textContent).toBe('(edited)');
    });

    it('posts nothing when the reply box holds only whitespace', () => {
      // Whitespace-only input is treated as an accidental slip and must not create a comment.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const textareaEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-reply');
      assertNotNull(textareaEl);
      textareaEl.value = '   ';

      const submitEl = card.querySelector('.kdoc-comment-reply-submit');
      assertNotNull(submitEl);
      submitEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(recorder.replied).toHaveLength(0);
    });

    it("posts one trimmed reply and clears the box on a real submission", () => {
      // Leading/trailing whitespace is stripped before posting, mirroring the source's trim() behavior.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const textareaEl = card.querySelector<HTMLTextAreaElement>('.kdoc-comment-reply');
      assertNotNull(textareaEl);
      textareaEl.value = '  Looks good  ';

      const submitEl = card.querySelector('.kdoc-comment-reply-submit');
      assertNotNull(submitEl);
      submitEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(recorder.replied).toHaveLength(1);
      expect(recorder.replied[0]).toEqual({ threadId: 't1', body: 'Looks good' });

      // A successful submission clears the textarea so the user can compose the next reply.
      expect(textareaEl.value).toBe('');
    });

    it("deletes a comment without also selecting the card", () => {
      // stopPropagation on the delete button must prevent its click from bubbling to the card's select handler.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      const deleteEl = card.querySelector('.kdoc-comment-delete');
      assertNotNull(deleteEl);
      // Bubbles: true means the event would reach the card listener unless propagation is stopped.
      deleteEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(recorder.deleted).toHaveLength(1);
      expect(recorder.deleted[0]).toEqual({ threadId: 't1', entryId: 'c1' });
      expect(recorder.selected).toHaveLength(0);
    });

    it("selects the card when the card itself is clicked", () => {
      // A direct click on the article body should route to onSelect for the thread this card represents.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: recorder.callbacks }));

      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(recorder.selected).toEqual(['t1']);
    });

    it("labels the resolve button 'Resolve'/'Reopen' with aria-pressed reflecting state and toggles on click", () => {
      // An open thread resolves (label Resolve, pressed false); a resolved thread reopens (label Reopen, pressed true).
      const openRecorder = makeCallbacks();
      const openCard = renderCommentCard(renderOptions({ thread: makeThread(), callbacks: openRecorder.callbacks }));

      const resolveBtnEl = openCard.querySelector('.kdoc-comment-resolve');
      assertNotNull(resolveBtnEl);
      expect(resolveBtnEl.textContent).toBe('Resolve');
      expect(resolveBtnEl.getAttribute('aria-pressed')).toBe('false');

      // Clicking an open thread's resolve button records the toggle. The card does not restyle itself because it is a pure renderer; the pane re-renders it from the updated thread.
      resolveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(openRecorder.toggled).toEqual(['t1']);

      const resolvedThread = makeThread({ resolved: true });
      const resolvedRecorder = makeCallbacks();
      const resolvedCard = renderCommentCard(renderOptions({ thread: resolvedThread, callbacks: resolvedRecorder.callbacks }));

      const resolvedResolveBtnEl = resolvedCard.querySelector('.kdoc-comment-resolve');
      assertNotNull(resolvedResolveBtnEl);
      expect(resolvedResolveBtnEl.textContent).toBe('Reopen');
      expect(resolvedResolveBtnEl.getAttribute('aria-pressed')).toBe('true');

      // Clicking a resolved thread's reopen button records the toggle for that same thread id.
      resolvedResolveBtnEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(resolvedRecorder.toggled).toEqual(['t1']);
    });

    it("shows an orphan note, marks the card orphaned, and still renders the quote", () => {
      // An orphaned anchor loses its file text but keeps showing the quote as the only remaining record.
      const recorder = makeCallbacks();
      const card = renderCommentCard(renderOptions({ thread: makeThread(), isOrphaned: true, callbacks: recorder.callbacks }));

      expect(card.classList.contains('kdoc-comment-card-orphaned')).toBe(true);

      const orphanNoteEl = card.querySelector('.kdoc-comment-orphan-note');
      assertNotNull(orphanNoteEl);

      const quoteEl = card.querySelector('.kdoc-comment-quote');
      assertNotNull(quoteEl);
      expect(quoteEl.textContent).toBe('the quick brown fox');
    });

    it("adds the active class only when the thread is selected", () => {
      // isActive drives the highlight class so exactly one card carries the active marker at a time.
      const activeCard = renderCommentCard(renderOptions({ thread: makeThread(), isActive: true, callbacks: makeCallbacks().callbacks }));
      expect(activeCard.classList.contains('kdoc-comment-card-active')).toBe(true);

      const inactiveCard = renderCommentCard(renderOptions({ thread: makeThread(), isActive: false, callbacks: makeCallbacks().callbacks }));
      expect(inactiveCard.classList.contains('kdoc-comment-card-active')).toBe(false);
    });
  });
});
