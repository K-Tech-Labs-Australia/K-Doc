/**
 * @file review-pane.ts
 * @purpose Lists every pending tracked change with its author, timestamp and type, and lets each be accepted or rejected (FR-11.2, FR-11.3). Each row shows what the change did to the text: an insertion's recorded string is what was added, a deletion's is what was removed — the same shape of data carrying opposite meaning — which is why the type badge is not decoration but the primary signal of intent.
 * @inputs A detached Document for element creation; one TrackedChange with its id, kind, author, createdAt and recorded text; whether this change is currently active; callbacks driving selection and accept/reject decisions.
 * @outputs One fully-wireable HTMLElement (<article>) representing a single reviewable-change row (this file supplies the first half of the module; createReviewPane lives in the companion half).
 * @functions renderChangeRow: Builds the DOM node for one tracked-change row with selection, keyboard activation and accept/reject controls.
 * @dataflow TrackedChange fields → element tree via createElement/textContent (never innerHTML) → event listeners bound to callbacks → returned article.
 * @controlflow Create article root → set change-id dataset + author-hue inline style → apply active outline class when selected → attach click and Enter-keydown select handlers → build meta header (kind badge, author, time) → append recorded text applying strikethrough for deletions → append accept/reject buttons each guarded by stopPropagation → return row.
 * @version 3
 * @date 2026-10-04
 */

import type { TrackedChange, ChangeDecision, MarkupMode } from '@k-doc/core';
import { authorHue } from '@k-doc/core';
// formatTimestamp is shared with the comment card rather than duplicated here, because two relative-time formats drifting apart would be a visible inconsistency in one window.
import { formatTimestamp } from './comment-card.js';

/**
 * @purpose Names which set of tracked changes a bulk accept/reject decision covers — the whole document, the current
 * selection, or every change by one author. The host resolves 'selection' back to a concrete text range because only it
 * knows where the caret sits; this module never computes ranges itself.
 */
export type DecisionScope =
  | { readonly kind: 'document' }
  | { readonly kind: 'selection' }
  | { readonly kind: 'author'; readonly author: string };

export interface ReviewPaneCallbacks {
  readonly onSelect: (changeId: string) => void;
  readonly onDecide: (changeId: string, decision: ChangeDecision) => void;
  readonly onDecideAll: (decision: ChangeDecision, scope: DecisionScope) => void;
  readonly onModeChange: (mode: MarkupMode) => void;
  readonly onTrackingChange: (on: boolean) => void;
}

export interface ReviewPaneOptions {
  readonly doc: Document;
  readonly callbacks: ReviewPaneCallbacks;
}

export interface ReviewPane {
  readonly element: HTMLElement;
  render(
    changes: readonly TrackedChange[],
    activeChangeId: string | null,
    tracking: boolean,
    mode: MarkupMode,
  ): void;
  destroy(): void;
}

/**
 * Styles for the review pane and its rows. Only the existing theme custom properties are used, each with a
 * light-theme token as fallback (plus the per-row --kdoc-author-hue set inline), so every row reads correctly in
 * both themes without a second stylesheet.
 */
export const REVIEW_PANE_STYLES: string = `
.kdoc-review-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-review-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 14px;
  margin: 8px 8px 12px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-review-mode,
.kdoc-review-scope {
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-shadow-dark);
  border-radius: var(--kdoc-radius-md);
  color: var(--kdoc-chrome-text);
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
}

.kdoc-review-mode:focus-visible,
.kdoc-review-scope:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-review-accept-all,
.kdoc-review-reject-all {
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  border: 1px solid transparent;
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-review-accept-all {
  color: var(--kdoc-emissive-green);
}

.kdoc-review-accept-all:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-review-accept-all:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-review-reject-all {
  color: var(--kdoc-emissive-red);
}

.kdoc-review-reject-all:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-review-reject-all:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-review-accept-all:focus-visible,
.kdoc-review-reject-all:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-review-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-review-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-review-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-review-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-review-row {
  display: block;
  padding: 8px 12px;
  border-radius: var(--kdoc-radius-md);
  margin-bottom: 6px;
  cursor: pointer;
  border-left: 3px solid hsl(var(--kdoc-author-hue) 65% 45%);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
  box-sizing: border-box;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.kdoc-review-row:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-review-row-active {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -1px;
  box-shadow: none;
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-review-meta {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-review-meta time {
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-review-kind {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--kdoc-chrome-accent);
}

.kdoc-review-author {
  color: var(--kdoc-chrome-text);
  font-weight: 600;
}

.kdoc-review-text {
  margin: 4px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--kdoc-chrome-text);
}

.kdoc-review-text-delete {
  text-decoration: line-through;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-review-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.kdoc-review-accept,
.kdoc-review-reject {
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-review-accept {
  color: var(--kdoc-emissive-green);
}

.kdoc-review-accept:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-review-accept:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-review-reject {
  color: var(--kdoc-emissive-red);
}

.kdoc-review-reject:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-review-reject:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-review-accept:focus-visible,
.kdoc-review-reject:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-review-empty {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  padding: 12px;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-review-pane * {
    transition: none !important;
  }
}
`;

/**
 * @purpose Builds one reviewable-change row, showing what the change did to the text and wiring select + accept/reject actions with keyboard accessibility.
 * @inputs doc the Document used to create every element (keeps the node detached from any live document); change the TrackedChange data model for this row; isActive whether this change is currently selected so it can be highlighted; callbacks user-action handlers for selection and decisions.
 * @outputs An HTMLElement (<article>) fully populated with metadata, recorded text, and accept/reject controls.
 * @dataflow TrackedChange fields → element tree construction via createElement/textContent (never innerHTML) → wired event listeners bound to callbacks → returned row.
 * @controlflow Create article root → set change-id dataset + author-hue inline style → apply active outline class when selected → attach click and Enter-keydown select handlers → build meta header with kind badge, author and time → append recorded text applying strikethrough for deletions → append accept/reject buttons each guarded by stopPropagation → return row.
 */
export function renderChangeRow(doc: Document, change: TrackedChange, isActive: boolean, callbacks: ReviewPaneCallbacks): HTMLElement {
  // Step 1: create the article root and set identity + accessibility attributes.
  const row = doc.createElement('article');
  row.className = 'kdoc-review-row';
  row.dataset['changeId'] = change.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'listitem');

  // Per-row author hue drives the left border colour so a reader can group changes by author at a glance.
  row.setAttribute('style', `--kdoc-author-hue: ${authorHue(change.author)}`);

  // Mark the currently selected change with an outline for visual distinction from unselected rows.
  if (isActive) {
    row.classList.add('kdoc-review-row-active');
  } else {
    // Not active: leave the class off so only one row carries the highlight at a time.
  }

  // Step 2: make the whole row focusable and activatable, since assistive-tech users navigate by keyboard.
  row.addEventListener('click', () => {
    callbacks.onSelect(change.id);
  });

  // The row is focusable (tabIndex = 0) so it must be operable from the keyboard, not only the mouse.
  row.addEventListener('keydown', (event: KeyboardEvent) => {
    // Enter activates the change to mirror a click for keyboard users; every other key falls through untouched.
    if (event.key === 'Enter') {
      // Activation key pressed: select this change exactly as clicking would.
      callbacks.onSelect(change.id);
    } else {
      // Non-activation key: ignore it so arrow/escape navigation are not hijacked by the row.
    }
  });

  // Step 3: header metadata — kind badge, author and timestamp.
  const meta = doc.createElement('header');
  meta.className = 'kdoc-review-meta';

  const kind = doc.createElement('span');
  kind.className = 'kdoc-review-kind';
  // The kind badge names whether text was added or removed; insertions read "Inserted" and everything else reads "Deleted".
  if (change.kind === 'insert') {
    // An insertion's recorded string is what was added to the document.
    kind.textContent = 'Inserted';
  } else {
    // A deletion: the same field holds what was removed, so it reads "Deleted" — opposite meaning of an identical shape of data.
    kind.textContent = 'Deleted';
  }
  meta.appendChild(kind);

  const author = doc.createElement('span');
  author.className = 'kdoc-review-author';
  author.textContent = change.author;
  meta.appendChild(author);

  // dateTime carries the machine-readable ISO value for accessibility tooling.
  const timeEl = doc.createElement('time');
  timeEl.setAttribute('dateTime', change.createdAt);
  timeEl.textContent = formatTimestamp(change.createdAt);
  meta.appendChild(timeEl);

  row.appendChild(meta);

  // Step 4: the recorded text, inserted as plain text so arbitrary document content can never be parsed as markup (no innerHTML).
  const text = doc.createElement('p');
  text.className = 'kdoc-review-text';
  text.textContent = change.text;

  // A deletion's text is struck through here for the same reason it is in the document: it shows what is no longer there.
  if (change.kind === 'delete') {
    text.classList.add('kdoc-review-text-delete');
  } else {
    // An insertion keeps plain styling, since its recorded string represents content that now exists.
  }

  row.appendChild(text);

  // Step 5: accept / reject controls shared by the change.
  const actions = doc.createElement('div');
  actions.className = 'kdoc-review-actions';

  const acceptBtn = doc.createElement('button');
  acceptBtn.className = 'kdoc-review-accept';
  acceptBtn.setAttribute('type', 'button');
  acceptBtn.textContent = 'Accept';
  // Without stopPropagation, accepting would also fire the row's select handler and move the caret out from under the user mid-click.
  acceptBtn.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    callbacks.onDecide(change.id, 'accept');
  });
  actions.appendChild(acceptBtn);

  const rejectBtn = doc.createElement('button');
  rejectBtn.className = 'kdoc-review-reject';
  rejectBtn.setAttribute('type', 'button');
  rejectBtn.textContent = 'Reject';
  // The same stopPropagation guards the reject handler so rejecting does not also select the change.
  rejectBtn.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    callbacks.onDecide(change.id, 'reject');
  });
  actions.appendChild(rejectBtn);

  row.appendChild(actions);

  return row;
}

/**
 * @purpose Maps a scope <select>'s string value to a DecisionScope at the moment of a bulk decision. The select's option
 * values are written only by render(), so every normal value decodes cleanly; anything else is treated as "whole document".
 * @inputs value the raw select.value being acted on for a bulk accept/reject.
 * @outputs A DecisionScope naming which changes the decision covers.
 * @dataflow The string → one of three literal shapes via identity and prefix checks.
 * @controlflow Branch on identity then prefix; an unrecognised value falls back to 'document' rather than throwing, because
 * the only way to receive such a value is a hand-edited DOM and refusing to act would be worse than acting broadly over every
 * change in the document.
 */
function readScope(value: string): DecisionScope {
  // A bare selection option asks for whatever range currently contains the caret; only the host knows where that is.
  if (value === 'selection') {
    return { kind: 'selection' };
  } else if (value.startsWith('author:')) {
    // An author-scoped value encodes its name after a fixed prefix; slice past "author:" to recover it.
    return { kind: 'author', author: value.slice(7) };
  } else {
    // Anything else — including an unknown option left in by hand — is treated as the whole document rather than failing,
    // because acting broadly over every change is safer than a bulk decision that quietly does nothing.
    return { kind: 'document' };
  }
}

/**
 * @purpose Builds a review pane that lists tracked document changes and exposes controls for tracking mode, markup display, and bulk accept/reject actions scoped by the selector above.
 * @inputs options - The pane configuration containing the doc renderer (options.doc) and callback handlers used to communicate user intent back to the host.
 * @outputs A ReviewPane object exposing element, render, and destroy members that own the pane's lifecycle.
 * @dataflow Options → DOM constructed once in factory; render() receives changes/state arguments → repopulates list and syncs controls; control events fire callbacks into the host.
 * @controlflow Construct static shell (controls row + list + empty state) on creation; run render() on every update to sync controls, clear and rebuild rows, toggle the empty message, and resync the scope selector; destroy() detaches element when done.
 */

export function createReviewPane(options: ReviewPaneOptions): ReviewPane {
  // Controls row: holds tracking checkbox, markup mode select, decision-scope select, and accept/reject buttons in order.
  const controls = options.doc.createElement('div');
  controls.className = 'kdoc-review-controls';

  // Tracking label wrapping a checkbox that reports its state to the host on every toggle.
  const trackingLabel = options.doc.createElement('label');
  trackingLabel.textContent = 'Track changes';

  const trackingInput = options.doc.createElement('input');
  trackingInput.type = 'checkbox';
  trackingInput.className = 'kdoc-review-tracking';
  // Report the new checked state to the host so it, not this pane, owns whether tracking is on.
  trackingInput.addEventListener('change', () => {
    options.callbacks.onTrackingChange(trackingInput.checked);
  });

  trackingLabel.appendChild(trackingInput);
  controls.appendChild(trackingLabel);

  // Markup mode select; its four option values are the only source of truth for a MarkupMode, so casting value is safe.
  const modeSelect = options.doc.createElement('select');
  modeSelect.className = 'kdoc-review-mode';
  modeSelect.setAttribute('aria-label', 'Markup display');
  // The cast to MarkupMode is safe because these option values are written here and nowhere else can set select.value.
  modeSelect.addEventListener('change', () => {
    options.callbacks.onModeChange(modeSelect.value as MarkupMode);
  });

  const allOption = options.doc.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Markup';
  modeSelect.appendChild(allOption);

  const simpleOption = options.doc.createElement('option');
  simpleOption.value = 'simple';
  simpleOption.textContent = 'Simple Markup';
  modeSelect.appendChild(simpleOption);

  const noneOption = options.doc.createElement('option');
  noneOption.value = 'none';
  noneOption.textContent = 'No Markup';
  modeSelect.appendChild(noneOption);

  const originalOption = options.doc.createElement('option');
  originalOption.value = 'original';
  originalOption.textContent = 'Original';
  modeSelect.appendChild(originalOption);

  controls.appendChild(modeSelect);

  // Decision-scope selector read when a bulk button is pressed; it carries no change handler of its own because there must be exactly one copy of the chosen scope, and reading it at decision time avoids a second state that could fall out of step.
  const scopeSelect = options.doc.createElement('select');
  scopeSelect.className = 'kdoc-review-scope';
  scopeSelect.setAttribute('aria-label', 'Decision scope');

  controls.appendChild(scopeSelect);

  // Accept all button: bulk-accept every tracked change via the host callback, scoped by the selector read at click time.
  const acceptAllButton = options.doc.createElement('button');
  acceptAllButton.type = 'button';
  acceptAllButton.className = 'kdoc-review-accept-all';
  acceptAllButton.textContent = 'Accept all';
  // The decision and its scope are read together at click time; onDecideAll carries both back to the host for a bulk action.
  acceptAllButton.addEventListener('click', () => {
    options.callbacks.onDecideAll('accept', readScope(scopeSelect.value));
  });

  controls.appendChild(acceptAllButton);

  // Reject all button: bulk-reject every tracked change via the host callback, scoped by the selector read at click time.
  const rejectAllButton = options.doc.createElement('button');
  rejectAllButton.type = 'button';
  rejectAllButton.className = 'kdoc-review-reject-all';
  rejectAllButton.textContent = 'Reject all';
  // The decision and its scope are read together at click time; onDecideAll carries both back to the host for a bulk action.
  rejectAllButton.addEventListener('click', () => {
    options.callbacks.onDecideAll('reject', readScope(scopeSelect.value));
  });

  controls.appendChild(rejectAllButton);

  // List container that holds one row per tracked change.
  const list = options.doc.createElement('div');
  list.className = 'kdoc-review-list';
  list.setAttribute('role', 'list');

  // Empty-state paragraph shown only when there are no rows; its text answers a different question depending on tracking state.
  const emptyParagraph = options.doc.createElement('p');
  emptyParagraph.className = 'kdoc-review-empty';

  const element = options.doc.createElement('div');
  element.className = 'kdoc-review-pane';
  element.appendChild(controls);
  element.appendChild(list);
  element.appendChild(emptyParagraph);

  /**
   * @purpose Repopulates the change list and syncs the tracking/mode/scope controls from fresh arguments.
   * @inputs changes - The tracked changes to display; activeChangeId - id of the currently focused change, or null when none is selected; tracking - whether tracking is on; mode - the markup display mode.
   * @outputs void.
   * @dataflow Arguments → control sync + sorted copy of changes → a row appended per change into list, empty message toggled accordingly; scope selector rebuilt from current authors.
   * @controlflow Sync controls from args → clear list by removing children one at a time → rebuild the scope options and preserve-or-fallback its value → append a row per change → compute and apply the empty-state text/visibility.
   */
  function render(changes: readonly TrackedChange[], activeChangeId: string | null, tracking: boolean, mode: MarkupMode): void {
    // The pane is told what the truth is on every render instead of keeping its own copy; two places believing different things about whether tracking is on is exactly the bug this avoids.
    trackingInput.checked = tracking;
    modeSelect.value = mode;

    // Remove children one at a time rather than setting innerHTML because the pane never assigns markup and must not introduce it.
    while (list.firstChild !== null) {
      list.removeChild(list.firstChild);
    }

    // Sync the decision-scope selector's truth from the current changes: rebuild every option so authors who no longer have a change drop out, keeping document and selection always present. A scope left pointing at an author with no remaining changes would make a bulk decision quietly do nothing, so preserve only if that option still exists, else fall back.
    while (scopeSelect.firstChild !== null) {
      scopeSelect.removeChild(scopeSelect.firstChild);
    }

    const documentOption = options.doc.createElement('option');
    documentOption.value = 'document';
    documentOption.textContent = 'in document';
    scopeSelect.appendChild(documentOption);

    const selectionOption = options.doc.createElement('option');
    selectionOption.value = 'selection';
    selectionOption.textContent = 'in selection';
    scopeSelect.appendChild(selectionOption);

    // Distinct authors across the current changes, sorted so option order is stable regardless of store read order.
    const distinctAuthors = [...new Set(changes.map((change) => change.author))].sort();
    for (const name of distinctAuthors) {
      const authorOption = options.doc.createElement('option');
      authorOption.value = `author:${name}`;
      authorOption.textContent = `by ${name}`;
      scopeSelect.appendChild(authorOption);
    }

    // Preserve the user's current choice when its option still exists; otherwise fall back to 'document'. A scope left pointing at an author who no longer has any changes would make a bulk decision quietly do nothing, so never keep such a stale value.
    const remainingValues = new Set(
      Array.from(scopeSelect.options).map((option) => option.value),
    );
    if (remainingValues.has(scopeSelect.value)) {
      // The previously chosen scope still has an option; leave it as-is rather than resetting to the document default.
    } else {
      // No matching option remains: reset so a bulk decision acts on something instead of silently doing nothing.
      scopeSelect.value = 'document';
    }

    // Sort a copy of changes ascending by createdAt, breaking ties by id so same-millisecond insertion/deletion order is deterministic rather than dependent on the store's read order.
    const sortedChanges = [...changes].sort((a, b) => {
      if (a.createdAt < b.createdAt) {
        return -1;
      } else if (a.createdAt > b.createdAt) {
        return 1;
      } else {
        // createdAt equal: break the tie by id ascending.
        if (a.id < b.id) {
          return -1;
        } else if (a.id > b.id) {
          return 1;
        } else {
          return 0;
        }
      }
    });

    for (const change of sortedChanges) {
      list.appendChild(renderChangeRow(options.doc, change, change.id === activeChangeId, options.callbacks));
    }

    // The empty message only applies when there are no rows; with changes present the paragraph stays hidden so it never shows over real content.
    if (changes.length > 0) {
      emptyParagraph.hidden = true;
    } else {
      emptyParagraph.hidden = false;
      // Two different questions: "nothing has happened yet" versus "nothing will happen until tracking turns on"; showing the wrong one sends the user hunting for a bug that isn't there.
      emptyParagraph.textContent = tracking ? 'No tracked changes yet' : 'Tracking is off';
    }
  }

  /**
   * @purpose Detaches the pane element from its parent so it can be garbage collected.
   * @inputs void.
   * @outputs void.
   * @dataflow Nothing; simply removes a reference to the DOM node from the tree when present.
   * @controlflow If the element has a parent, remove it and return; otherwise do nothing.
   */
  function destroy(): void {
    // Only detach if the pane is currently attached somewhere in the document tree.
    if (element.parentNode !== null) {
      element.parentNode.removeChild(element);
    }
  }

  return { element, render, destroy };
}

export const ORIGINAL_OVERLAY_STYLES: string = `
.kdoc-original-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  padding: 16px 24px;
  background: var(--kdoc-color-background, #ffffff);
  color: var(--kdoc-color-text, #1f2328);
}

.kdoc-original-banner {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--kdoc-color-text-muted, #57606a);
  border-bottom: 1px solid var(--kdoc-color-border, #d0d7de);
  padding-bottom: 6px;
  margin-bottom: 12px;
}

.kdoc-original-body {
  max-width: 46rem;
}
`;

/* The overlay is deliberately opaque and covers the panes rather than sitting beside them — Original is a view of the whole document, and showing it next to the live one would invite editing the wrong copy. */
