/**
 * @file comment-card.ts
 * @purpose Renders one comment thread as a card for the margin pane (FR-10.2): its quoted text, its
 *   comments, and the reply, resolve and delete controls.
 * @inputs A CommentThread, whether it is the selected thread, whether its anchor was orphaned, and the
 *   callbacks the pane uses to act on it.
 * @outputs A detached HTMLElement, fully wired, plus the stylesheet for it.
 * @functions
 *   - formatTimestamp: A short relative time, or the raw string when it cannot be parsed.
 *   - renderCommentCard: Builds the card element for one thread.
 * @dataflow CommentThread -> element tree via createElement/textContent -> event listeners -> the card.
 * @controlflow Root and state classes -> select handlers -> orphan note -> quote -> one block per
 *   comment -> the reply and resolve controls.
 * @version 4
 * @date 2026-10-04
 */

import type { CommentThread } from '@k-doc/core';

/**
 * Styles for one comment card. Only the existing theme custom properties are used, each with the
 * light-theme token as its fallback, so a card reads correctly in both themes without a second
 * stylesheet.
 */
export const COMMENT_CARD_STYLES: string = `
.kdoc-comment-card {
  padding: 10px 12px;
  border-radius: var(--kdoc-radius-lg);
  margin-bottom: 8px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  box-shadow: var(--kdoc-elevation-raised);
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.kdoc-comment-card:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-comment-card-active {
  border-left: 3px solid var(--kdoc-chrome-accent);
  box-shadow: none;
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -1px;
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-comment-card-resolved {
  opacity: 0.6;
}

.kdoc-comment-card-orphaned {
  border-style: dashed;
}

.kdoc-comment-orphan-note {
  color: var(--kdoc-emissive-red);
  font-size: 11px;
  margin: 0 0 4px;
}

.kdoc-comment-quote {
  font-size: 12px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  border-left: 2px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-sm);
  padding-left: 8px;
  margin: 0 0 8px;
}

.kdoc-comment-entry {
  margin-bottom: 8px;
}

.kdoc-comment-meta {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-comment-meta time {
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-comment-author {
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-comment-body {
  margin: 2px 0 0;
  font-size: 13px;
  white-space: pre-wrap;
  color: var(--kdoc-chrome-text);
}

.kdoc-comment-reply {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-shadow-dark);
  border-radius: var(--kdoc-radius-md);
  color: var(--kdoc-chrome-text);
  padding: 6px 8px;
}

.kdoc-comment-reply:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-comment-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.kdoc-comment-actions button,
.kdoc-comment-delete,
.kdoc-comment-edit,
.kdoc-comment-edit-save,
.kdoc-comment-edit-cancel {
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  border: 1px solid transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-comment-actions button:hover,
.kdoc-comment-delete:hover,
.kdoc-comment-edit:hover,
.kdoc-comment-edit-save:hover,
.kdoc-comment-edit-cancel:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-comment-actions button:active,
.kdoc-comment-delete:active,
.kdoc-comment-edit:active,
.kdoc-comment-edit-save:active,
.kdoc-comment-edit-cancel:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-comment-actions button:focus-visible,
.kdoc-comment-delete:focus-visible,
.kdoc-comment-edit:focus-visible,
.kdoc-comment-edit-save:focus-visible,
.kdoc-comment-edit-cancel:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-comment-edited {
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
}

.kdoc-comment-edit-box {
  width: 100%;
  box-sizing: border-box;
  min-height: 3.5em;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-shadow-dark);
  border-radius: var(--kdoc-radius-md);
  color: var(--kdoc-chrome-text);
  padding: 6px 8px;
}

.kdoc-comment-edit-box:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-comment-edit-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-comment-card * {
    transition: none !important;
  }
}
`;

/**
 * @purpose Renders a human-friendly relative time label for a stored comment timestamp.
 * @inputs iso - ISO-8601 string of the event to describe; now - reference clock defaulting to Date.now().
 * @outputs A compact past-relative phrase ('just now', '5 min ago') or an absolute locale date, never "Invalid Date".
 * @dataflow Parsed epoch ms → elapsed seconds since `now` → unit bucket selection → formatted string.
 * @controlflow Parse then guard NaN; otherwise walk descending second/minute/hour/day thresholds with early returns before falling back to the raw date.
 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const parsed = Date.parse(iso);

  // A timestamp read back from a hand-edited store file should be shown exactly as written rather than replaced by "Invalid Date", because the raw value is the only clue to what went wrong.
  if (Number.isNaN(parsed)) {
    return iso;
  }

  // Positive elapsed means the event sits in the past relative to `now`.
  const totalSeconds = Math.floor((now.getTime() - parsed) / 1000);

  // Under one minute: label as immediate so trivial recency reads naturally.
  if (totalSeconds < 60) {
    return 'just now';
  }

  // Under an hour, report whole minutes elapsed since the event.
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  // Under a day, report whole hours elapsed to avoid coarse "days" wording for same-day activity.
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }

  // Within the past week, report whole days; beyond that an absolute date is more useful than a large day count.
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} d ago`;
  }

  return new Date(parsed).toLocaleDateString();
}

/**
 * Callbacks invoked by a rendered comment card in response to user actions such as selecting, replying to, resolving, or deleting a thread.
 */
export interface CommentCardCallbacks {
  readonly onSelect: (threadId: string) => void;
  readonly onReply: (threadId: string, body: string) => void;
  readonly onToggleResolved: (threadId: string) => void;
  readonly onDelete: (threadId: string, entryId: string) => void;
  /**
   * Called when a comment is edited inline. The new body arrives already trimmed and non-empty, because an empty comment is not a comment — the card refuses to submit one rather than making the controller decide.
   */
  readonly onEdit: (threadId: string, entryId: string, body: string) => void;
}

/**
 * Immutable configuration describing a single comment card to render.
 */
export interface CommentCardOptions {
  readonly doc: Document;
  readonly thread: CommentThread;
  readonly isActive: boolean;
  readonly isOrphaned: boolean;
  readonly callbacks: CommentCardCallbacks;
}

/**
 * @purpose Builds a DOM node representing one comment thread, wiring up keyboard accessibility, inline deletion, replying, and resolve/reopen actions.
 * @inputs options.doc the Document used to create every element (keeps the card detached from any live document); options.thread the CommentThread data model to render; options.isActive whether the thread is currently selected; options.isOrphaned whether the anchor text no longer exists in the file; options.callbacks user-action handlers.
 * @outputs An HTMLElement (<article>) fully populated with quote, entries, and action controls.
 * @dataflow CommentThread data → element tree construction via createElement/textContent → wired event listeners → returned card.
 * @controlflow Create article root → apply state classes → attach select/keyboard activation → render orphan note if needed → render quote → loop over comments to build entries → append reply/actions controls → return card.
 */
export function renderCommentCard(options: CommentCardOptions): HTMLElement {
  const { doc, thread, isActive, isOrphaned, callbacks } = options;

  // Step 1: create the article root and apply state classes.
  const card = doc.createElement('article');
  card.className = 'kdoc-comment-card';
  card.dataset['threadId'] = thread.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'listitem');

  // Mark the currently selected thread so it can be styled distinctly.
  if (isActive) {
    card.classList.add('kdoc-comment-card-active');
  } else {
    // Not active: leave the class off so only one card carries the highlight at a time.
  }

  // Highlight resolved threads to distinguish them from open ones.
  if (thread.resolved) {
    card.classList.add('kdoc-comment-card-resolved');
  } else {
    // Not resolved: no extra marker class is needed for the default state.
  }

  // Flag orphaned threads whose anchor text has been removed from the file.
  if (isOrphaned) {
    card.classList.add('kdoc-comment-card-orphaned');
  } else {
    // Not orphaned: no marker class needed for a thread still attached to live text.
  }

  // Step 2: make the whole card focusable and activatable, since assistive tech users navigate by keyboard.
  card.addEventListener('click', () => {
    callbacks.onSelect(thread.id);
  });

  // The card is focusable (tabIndex = 0) so it must be operable from the keyboard, not only the mouse.
  card.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      // Enter activates the selected thread, mirroring a click for keyboard users.
      callbacks.onSelect(thread.id);
    } else {
      // Any other key is ignored so navigation keys are not hijacked by the card.
    }
  });

  // Step 3: an orphaned thread still shows its quote because that quote is the only remaining record of what the comment was about.
  if (isOrphaned) {
    const note = doc.createElement('p');
    note.className = 'kdoc-comment-orphan-note';
    note.textContent = 'Original text not found';
    card.appendChild(note);
  } else {
    // Not orphaned: no orphan note is shown for a thread still attached to live file content.
  }

  // Step 4: the quoted anchor, rendered as plain text so it can never be interpreted as markup.
  const quote = doc.createElement('blockquote');
  quote.className = 'kdoc-comment-quote';
  quote.textContent = thread.anchor.quotedText;
  quote.setAttribute('title', thread.anchor.quotedText);
  card.appendChild(quote);

  // Step 5: one entry per comment in the thread, built in iteration order.
  for (const entry of thread.comments) {
    const entryEl = doc.createElement('div');
    entryEl.className = 'kdoc-comment-entry';

    // Entry header holding author name and timestamp metadata.
    const meta = doc.createElement('header');
    meta.className = 'kdoc-comment-meta';

    const author = doc.createElement('span');
    author.className = 'kdoc-comment-author';
    author.textContent = entry.author;
    meta.appendChild(author);

    // Timestamp element: dateTime carries the machine-readable ISO value for accessibility tooling.
    const timeEl = doc.createElement('time');
    timeEl.className = 'kdoc-comment-time';
    timeEl.setAttribute('dateTime', entry.createdAt);
    timeEl.textContent = formatTimestamp(entry.createdAt);
    meta.appendChild(timeEl);

    // An edited flag is only shown when the comment was actually modified after creation.
    if (entry.editedAt !== null) {
      const edited = doc.createElement('span');
      edited.className = 'kdoc-comment-edited';
      edited.textContent = '(edited)';
      meta.appendChild(edited);
    } else {
      // Not edited: omit the "(edited)" marker so readers are not misled about provenance.
    }

    entryEl.appendChild(meta);

    // The comment body is arbitrary text from a file that may have come from someone else's commit, so it is inserted as text and never parsed as markup (no innerHTML).
    const body = doc.createElement('p');
    body.className = 'kdoc-comment-body';
    body.textContent = entry.body;
    entryEl.appendChild(body);

    // Edit button toggles the inline editor for this specific comment. Like every other control on the card it stops propagation first so the click does not bubble to the card's select listener and silently change the selection under the user.
    const editBtn = doc.createElement('button');
    editBtn.className = 'kdoc-comment-edit';
    editBtn.setAttribute('type', 'button');
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('title', 'Edit this comment');
    editBtn.setAttribute('aria-label', 'Edit this comment');
    // Edit opens the inline editor; stopPropagation first so the click does not bubble to the card's select listener.
    editBtn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      // Reopening an editor that was cancelled should start from what is on screen, not the abandoned draft.
      editBox.value = entry.body;
      showEditor(true);
      editBox.focus();
    });

    // Inline editor revealed by the Edit button, pre-filled with the current comment text and hidden until editing begins.
    const editBox = doc.createElement('textarea');
    editBox.className = 'kdoc-comment-edit-box';
    editBox.value = entry.body;
    editBox.hidden = true;
    editBox.setAttribute('aria-label', 'Edit comment text');

    editBox.addEventListener('click', (event: MouseEvent) => {
      // Without this, clicking into the box to type would bubble up to the card's select listener, which rebuilds the whole card and closes the editor it just opened while discarding the draft.
      event.stopPropagation();
    });

    // Editor footer holding the Save and Cancel controls, hidden alongside the box until editing begins.
    const editActions = doc.createElement('div');
    editActions.className = 'kdoc-comment-edit-actions';
    editActions.hidden = true;

    // Save commits the edited text as a new comment body.
    const saveBtn = doc.createElement('button');
    saveBtn.className = 'kdoc-comment-edit-save';
    saveBtn.setAttribute('type', 'button');
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('title', 'Save this edit');
    saveBtn.setAttribute('aria-label', 'Save this edit');
    // Save commits the edited text; stopPropagation first so it does not bubble to the card's select listener.
    saveBtn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      const next = editBox.value.trim();

      // An empty comment is not a comment, so Save does nothing rather than deleting by stealth — deletion is what the Delete button is for.
      if (next.length === 0) {
        return;
      } else if (next === entry.body) {
        // Nothing changed: close the editor without stamping an "(edited)" marker on a comment nobody actually edited.
        showEditor(false);
        return;
      } else {
        // A genuine change was made, so hand the trimmed new body to the controller for persistence.
        callbacks.onEdit(thread.id, entry.id, next);
      }
    });
    editActions.appendChild(saveBtn);

    // Cancel discards any in-progress edits and returns the comment to its read-only view.
    const cancelBtn = doc.createElement('button');
    cancelBtn.className = 'kdoc-comment-edit-cancel';
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('title', 'Cancel this edit');
    cancelBtn.setAttribute('aria-label', 'Cancel this edit');
    // Cancel discards the in-progress edit; stopPropagation first so it does not bubble to the card's select listener.
    cancelBtn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      showEditor(false);
    });
    editActions.appendChild(cancelBtn);

    // showEditor flips the entry between its read-only view and its inline editor by toggling the hidden property on each piece, using one mechanism rather than mixing in style.display.
    const showEditor = (on: boolean): void => {
      if (on) {
        // Editing begins: hide the body text and row controls, reveal the textarea and its action buttons.
        body.hidden = true;
        editBtn.hidden = true;
        deleteBtn.hidden = true;
        editBox.hidden = false;
        editActions.hidden = false;
      } else {
        // Editing ends: restore the body text and row controls, hide the textarea and its action buttons.
        body.hidden = false;
        editBtn.hidden = false;
        deleteBtn.hidden = false;
        editBox.hidden = true;
        editActions.hidden = true;
      }
    };

    // Delete button for this specific comment. Every handler calls stopPropagation first so the click does not bubble to the card's select listener, which would otherwise silently change the selection under the user.
    const deleteBtn = doc.createElement('button');
    deleteBtn.className = 'kdoc-comment-delete';
    deleteBtn.setAttribute('type', 'button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('title', 'Delete this comment');
    deleteBtn.setAttribute('aria-label', 'Delete this comment');
    deleteBtn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      callbacks.onDelete(thread.id, entry.id);
    });

    entryEl.appendChild(editBtn);
    entryEl.appendChild(deleteBtn);
    entryEl.appendChild(editBox);
    entryEl.appendChild(editActions);

    card.appendChild(entryEl);
  }

  // Step 6: reply and resolve controls shared by the whole thread.
  const actions = doc.createElement('div');
  actions.className = 'kdoc-comment-actions';

  const reply = doc.createElement('textarea');
  reply.className = 'kdoc-comment-reply';

  reply.addEventListener('click', (event: MouseEvent) => {
    // Without this, clicking into the box to type a reply bubbles up to the card's select listener, which rebuilds the whole card from scratch and destroys the very element the click was meant to focus.
    event.stopPropagation();
  });
  reply.setAttribute('placeholder', 'Reply');
  reply.rows = 2;
  reply.setAttribute('aria-label', 'Reply to this comment');
  actions.appendChild(reply);

  // submitReply posts the current textarea contents only when non-empty.
  const submitReply = (): void => {
    const bodyText = reply.value.trim();

    // An empty reply is a slip rather than an instruction, and posting one would put a blank comment into a file that gets committed to git.
    if (bodyText === '') {
      return;
    } else {
      callbacks.onReply(thread.id, bodyText);
      reply.value = '';
    }
  };

  // Plain Enter must still insert a newline, because a comment is prose and often runs to more than one line.
  reply.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      // Ctrl+Enter submits the reply instead of inserting a newline.
      event.preventDefault();
      submitReply();
    } else {
      // Any other key combination is left to default behavior so newlines and editing still work.
    }
  });

  const replySubmit = doc.createElement('button');
  replySubmit.className = 'kdoc-comment-reply-submit';
  replySubmit.setAttribute('type', 'button');
  replySubmit.textContent = 'Reply';
  replySubmit.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    submitReply();
  });
  actions.appendChild(replySubmit);

  const resolveBtn = doc.createElement('button');
  resolveBtn.className = 'kdoc-comment-resolve';
  resolveBtn.setAttribute('type', 'button');

  // The button label flips based on current state: a resolved thread needs to be reopened, an open one is resolved.
  if (thread.resolved) {
    resolveBtn.textContent = 'Reopen';
  } else {
    resolveBtn.textContent = 'Resolve';
  }

  // aria-pressed reflects the thread's current resolution state for assistive technology.
  resolveBtn.setAttribute('aria-pressed', String(thread.resolved));
  resolveBtn.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    callbacks.onToggleResolved(thread.id);
  });
  actions.appendChild(resolveBtn);

  card.appendChild(actions);

  return card;
}
