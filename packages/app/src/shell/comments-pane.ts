/**
 * @file comments-pane.ts
 * @purpose Renders the margin pane that lists comment threads, their authors, and resolved state.
 * @inputs CommentThread data supplied by the shell; user interactions with the two filter controls.
 * @outputs DOM elements appended to `.kdoc-comments-list`; re-renders in response to filter changes.
 * @functions
 *   - createCommentsPane: Builds and returns the pane instance bound to a Document.
 *   - paint: Applies current filter/author state to the thread list and empty-state label.
 *   - render: Stores incoming data then repaints using stored filter state.
 *   - destroy: Detaches the pane from its parent node.
 * @dataflow Shell threads → closure `last*` variables → paint() filters them → rendered cards in `.kdoc-comments-list`.
 * @controlflow createCommentsPane builds DOM once; user changes set closure state and call paint(); render() refreshes data then calls paint().
 * @version 4
 * @date 2026-10-04
 */

import type { CommentThread } from '@k-doc/core';
import { renderCommentCard, type CommentCardCallbacks } from './comment-card.js';

export type CommentFilter = 'open' | 'resolved' | 'all';

/** How comments are shown in the document, independent of which ones the pane lists (FR-10.4).
 * The three modes answer different questions: 'margin' is for reviewing — a reviewer scanning what needs attention;
 * 'inline' is for reading a document that has been commented on, seeing each note beside the text it annotates;
 * and 'hidden' is for reading it as if it had not been commented at all. The pane's own list is unaffected by this choice —
 * it is the panel the user deliberately opened. */
export type CommentDisplay = 'margin' | 'inline' | 'hidden';

export interface CommentsPaneOptions {
  readonly doc: Document;
  readonly callbacks: CommentCardCallbacks;
  readonly onDisplayChange?: (display: CommentDisplay) => void;
}

export interface CommentsPane {
  readonly element: HTMLElement;
  render(
    threads: readonly CommentThread[],
    orphanedIds: ReadonlySet<string>,
    activeThreadId: string | null,
  ): void;
  destroy(): void;
}

/**
 * @purpose Creates the comments pane and wires its filter controls to internal state.
 * @inputs options.doc — owner Document used for all element creation; options.callbacks — forwarded verbatim to each rendered card.
 * @returns A CommentsPane whose render() applies stored filter/author state to new thread data.
 * @dataflow Options → closure state + built DOM structure → returned pane instance exposing render()/destroy().
 * @controlflow Declare mutable closure state, construct the static filter/list/empty structure once, attach change listeners, return the object.
 */
export function createCommentsPane(options: CommentsPaneOptions): CommentsPane {
  // The pane owns its filter and author selection so a user toggling one does not need to round-trip through the shell for data again.
  let filter: CommentFilter = 'open';
  let author: string = ''; // Empty string means "every author".

  // Snapshot of the most recent render inputs, reused by paint() when only filters change.
  let lastThreads: readonly CommentThread[] = [];
  let lastOrphaned: ReadonlySet<string> = new Set();
  let lastActive: string | null = null;

  const element = options.doc.createElement('div');
  element.className = 'kdoc-comments-pane';

  // Static filter row built once and reused across every paint().
  const filtersRow = options.doc.createElement('div');
  filtersRow.className = 'kdoc-comments-filters';

  // Open is the default because a resolved comment is finished business; showing it by default would keep drawing attention to something already dealt with.
  const stateSelect = options.doc.createElement('select');
  stateSelect.className = 'kdoc-comments-filter-state';
  stateSelect.setAttribute('aria-label', 'Filter comments');
  for (const option of ['open', 'resolved', 'all'] as CommentFilter[]) {
    const opt = options.doc.createElement('option');
    opt.value = option;
    // Map the value to its human-readable label.
    if (option === 'open') {
      opt.textContent = 'Open';
    } else if (option === 'resolved') {
      opt.textContent = 'Resolved';
    } else {
      opt.textContent = 'All';
    }
    stateSelect.appendChild(opt);
  }
  stateSelect.value = filter; // Starts at 'open'.

  const authorSelect = options.doc.createElement('select');
  authorSelect.className = 'kdoc-comments-filter-author';
  authorSelect.setAttribute('aria-label', 'Filter by author');

  const displaySelect = options.doc.createElement('select');
  displaySelect.className = 'kdoc-comments-filter-display';
  displaySelect.setAttribute('aria-label', 'Comment display');
  for (const option of ['margin', 'inline', 'hidden'] as CommentDisplay[]) {
    const opt = options.doc.createElement('option');
    opt.value = option;
    // Map the value to its human-readable label.
    if (option === 'margin') {
      opt.textContent = 'Margin';
    } else if (option === 'inline') {
      opt.textContent = 'Inline';
    } else {
      opt.textContent = 'Hidden';
    }
    displaySelect.appendChild(opt);
  }
  // Margin is the default because it is what a reviewer wants and it is the behaviour that existed before the toggle.
  displaySelect.value = 'margin';

  // Both change handlers set the owning closure variable and repaint, so filtering never leaves the pane.
  stateSelect.addEventListener('change', () => {
    filter = stateSelect.value as CommentFilter;
    paint();
  });
  authorSelect.addEventListener('change', () => {
    author = authorSelect.value;
    paint();
  });

  // so it does not call paint() — it tells the host, which owns what the document shows.
  displaySelect.addEventListener('change', () => {
    options.onDisplayChange?.(displaySelect.value as CommentDisplay);
  });

  const list = options.doc.createElement('div');
  list.className = 'kdoc-comments-list';
  list.setAttribute('role', 'list');

  const emptyState = options.doc.createElement('p');
  emptyState.className = 'kdoc-comments-empty';
  emptyState.hidden = true;

  filtersRow.appendChild(stateSelect);
  filtersRow.appendChild(authorSelect);
  filtersRow.appendChild(displaySelect);
  element.appendChild(filtersRow);
  element.appendChild(list);
  element.appendChild(emptyState);

  /**
   * @purpose Applies the current filter/author state to the thread list and updates the empty-state label.
   * @inputs None — reads closure `lastThreads`, `lastOrphaned`, `lastActive`, `filter`, and `author`.
   * @outputs Mutates `.kdoc-comments-list` contents and toggles the empty-state paragraph's visibility/label.
   * @dataflow Stored threads → author-set rebuild + filter/sort → rendered cards appended to list; reason text set on emptyState.
   * @controlflow Rebuild authors → keep surviving threads → clear list → sort orphans last by createdAt → append cards → hide/show empty state.
   */
  function paint(): void {
    // Rebuild the author options from every entry across stored threads, always leading with "All authors".
    authorSelect.textContent = ''; // Remove existing option nodes; textContent clears children.
    const allAuthorsOption = options.doc.createElement('option');
    allAuthorsOption.value = '';
    allAuthorsOption.textContent = 'All authors';
    authorSelect.appendChild(allAuthorsOption);

    // Collect every entry.author across lastThreads into a Set, then sort for stable ordering.
    const presentAuthors = new Set<string>();
    for (const thread of lastThreads) {
      for (const entry of thread.comments) {
        presentAuthors.add(entry.author);
      }
    }

    // Preserve the current selection when that author is still present, and reset to '' when they are not.
    const keptSelection = author !== '' && presentAuthors.has(author);
    let sortedAuthors: string[] = [];
    if (presentAuthors.size > 0) {
      sortedAuthors = [...presentAuthors].sort();
    }
    for (const name of sortedAuthors) {
      const opt = options.doc.createElement('option');
      opt.value = name;
      opt.textContent = name;
      authorSelect.appendChild(opt);
    }
    if (keptSelection) {
      // Re-select the previously chosen author now that their option node has been rebuilt.
      authorSelect.value = author;
    } else {
      // Reset to "All authors" so a filter silently pointing at an author who no longer has comments does not show an empty pane with no explanation.
      // The closure variable is reset alongside the control: resetting only the control would leave the
      // select reading "All authors" while the filter below still narrowed to the author who has gone,
      // which is worse than the empty pane, because the pane would then be lying about what it shows.
      author = '';
      authorSelect.value = '';
    }

    // Keep a thread when the state filter is 'all', or matches its resolved flag, then narrow by author if one is selected.
    const survivors: CommentThread[] = [];
    for (const thread of lastThreads) {
      let passesStateFilter: boolean;
      if (filter === 'all') {
        passesStateFilter = true;
      } else if (filter === 'open') {
        // Only open threads when filtering to the open state.
        passesStateFilter = thread.resolved === false;
      } else {
        // Resolved filter: only resolved threads.
        passesStateFilter = thread.resolved === true;
      }

      if (!passesStateFilter) {
        continue;
      }

      if (author !== '') {
        // Narrow to threads that contain at least one entry by the selected author.
        let hasAuthor = false;
        for (const entry of thread.comments) {
          if (entry.author === author) {
            hasAuthor = true;
            break;
          }
        }
        if (!hasAuthor) {
          continue;
        }
      }

      survivors.push(thread);
    }

    // Clear the list by removing nodes one at a time rather than setting innerHTML, because this pane never assigns markup.
    while (list.firstChild !== null) {
      list.removeChild(list.firstChild);
    }

    // Sort so orphaned threads come last; within each group order by createdAt ascending.
    const ordered = survivors.sort((a, b) => {
      const orphanA = lastOrphaned.has(a.id);
      const orphanB = lastOrphaned.has(b.id);
      if (orphanA !== orphanB) {
        // Orphan goes last: true must sort after false.
        return orphanA ? 1 : -1;
      }
      // Same group: earlier createdAt first, ties stay in place.
      if (a.createdAt < b.createdAt) {
        return -1;
      } else if (a.createdAt > b.createdAt) {
        return 1;
      } else {
        return 0;
      }
    });

    // An orphaned thread has no position in the document to sit beside, so it is grouped at the end rather than interleaved where its stale offset would put it.

    let renderedCount = 0;
    for (const thread of ordered) {
      const card = renderCommentCard({
        doc: options.doc,
        thread,
        isActive: thread.id === lastActive,
        isOrphaned: lastOrphaned.has(thread.id),
        callbacks: options.callbacks,
      });
      list.appendChild(card);
      renderedCount += 1;
    }

    // Distinguish the two empty causes because a filter-caused pane looks identical to one with no comments, and the user cannot tell which without being told.
    if (lastThreads.length === 0) {
      emptyState.textContent = 'No comments yet';
    } else {
      emptyState.textContent = 'No comments match the current filter';
    }

    // Show the empty-state paragraph only when no card was rendered.
    emptyState.hidden = renderedCount > 0;
  }

  /**
   * @purpose Stores incoming thread data and repaints using the pane's own filter/author state.
   * @inputs threads — all comment threads from the shell; orphanedIds — ids with no document position; activeThreadId — id to highlight, or null.
   * @outputs None directly; triggers paint() which updates the DOM.
   * @dataflow Render arguments → closure `last*` variables → paint().
   * @controlflow Assign stored data then call paint(); filter state is preserved so no round trip through the shell is needed.
   */
  function render(
    threads: readonly CommentThread[],
    orphanedIds: ReadonlySet<string>,
    activeThreadId: string | null,
  ): void {
    lastThreads = threads;
    lastOrphaned = orphanedIds;
    lastActive = activeThreadId;
    paint();
  }

  /**
   * @purpose Detaches the pane from its parent node.
   * @inputs None.
   * @outputs None directly; removes `element` when it has a parent.
   * @dataflow None — pure DOM teardown.
   * @controlflow Check for a parentNode and remove if present; no state to reset since closure variables are discarded with the instance.
   */
  function destroy(): void {
    const parent = element.parentNode;
    if (parent !== null) {
      parent.removeChild(element);
    }
  }

  return {
    get element() {
      return element;
    },
    render,
    destroy,
  };
}

export const COMMENTS_PANE_STYLES: string = `
.kdoc-comments-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-comments-filters {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 14px;
  margin: 8px 8px 12px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  flex-wrap: wrap;
}

.kdoc-comments-filter-state,
.kdoc-comments-filter-author,
.kdoc-comments-filter-display {
  background: transparent;
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  color: var(--kdoc-chrome-text);
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
}

.kdoc-comments-filter-state:focus-visible,
.kdoc-comments-filter-author:focus-visible,
.kdoc-comments-filter-display:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-comments-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-comments-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-comments-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-comments-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-comments-empty {
  margin: 0;
  text-align: center;
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
  padding: 12px;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-comments-pane * {
    transition: none !important;
  }
}
`;
