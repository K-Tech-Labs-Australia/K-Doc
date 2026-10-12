// @vitest-environment jsdom
/**
 * @file comments-pane.test.ts
 * @purpose Vitest suite exercising the margin comment pane: default filters, state/author filtering, empty states, orphan ordering, active highlight, and teardown.
 * @inputs CommentThread fixtures built by makeThread(); a jsdom Document; noop callbacks forwarded to rendered cards.
 * @outputs DOM assertions over `.kdoc-comment-card` elements via cardIds() plus select values and empty-state text.
 * @functions
 *   - assertNotNull: Asserts a value is non-null so callers can treat it as its asserted type.
 *   - makeThread: Builds a CommentThread fixture with one comment entry anchored to an id.
 *   - noopCallbacks: No-op callback object satisfying the card's required interface.
 *   - makePane: Creates a CommentsPane bound to the jsdom document and no-op callbacks.
 *   - cardIds: Collects the data-thread-id of every rendered comment card, in order.
 * @dataflow Fixture threads → pane.render() → paint() filters/sorts → cards appended to list → cardIds reads them back.
 * @controlflow Each test builds fixtures, renders into a fresh pane or mutates filter state via dispatched change events, then asserts DOM results with expect().
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import type { CommentThread } from '@k-doc/core';
import { createCommentsPane, type CommentsPane } from './comments-pane.js';
import type { CommentCardCallbacks } from './comment-card.js';

/**
 * @purpose Asserts that a value is non-null so the caller can use it as its asserted generic type.
 * @inputs value - Candidate value of any type T which may currently be null.
 * @outputs None; narrows `value` to T for subsequent statements via an assertion signature.
 * @dataflow The passed reference → expect() matcher (`.not.toBeNull()`).
 * @controlflow Delegates entirely to the Vitest matcher; no branching or early return so a failure is always reported as an assertion error.
 */
function assertNotNull<T>(value: T | null): asserts value is T {
  expect(value).not.toBeNull();
}

/**
 * @purpose Builds a CommentThread fixture with a single comment entry anchored to the given id.
 * @inputs id - Unique thread identifier; author - owning comment author name; resolved - whether the thread is closed; createdAt - ISO timestamp string used for ordering.
 * @outputs A fully-formed CommentThread object matching the core type shape.
 * @dataflow Scalar inputs → nested anchor/comments objects assembled into a single CommentThread return value.
 * @controlflow Pure construction with no branching: assembles literal fields and returns them in one expression.
 */
function makeThread(
  id: string,
  author: string,
  resolved: boolean,
  createdAt: string,
): CommentThread {
  return {
    id,
    anchor: {
      quotedText: 'quoted ' + id,
      prefixContext: '',
      suffixContext: '',
      charOffset: 0,
      blockHash: 'h',
    },
    comments: [
      {
        id: id + '-c1',
        author,
        body: 'body of ' + id,
        createdAt,
        editedAt: null,
      },
    ],
    resolved,
    createdAt,
  };
}

/**
 * @purpose Provides no-op callbacks satisfying the comment card's required interface.
 * @inputs None; each field is a deliberately empty handler so tests never trigger side effects from rendered cards.
 * @outputs A CommentCardCallbacks object whose five handlers are inert arrow functions typed `(): void`.
 * @dataflow Five literal arrow-function expressions → one callback object returned to makePane().
 * @controlflow Pure construction; no branching, each field assigned a constant no-op function.
 */
const noopCallbacks: CommentCardCallbacks = {
  onSelect: (): void => {},
  onReply: (): void => {},
  onToggleResolved: (): void => {},
  onDelete: (): void => {},
  onEdit: (): void => {},
};

/**
 * @purpose Creates a CommentsPane bound to the jsdom document and no-op callbacks.
 * @inputs None; relies on module-level noopCallbacks and the jsdom-provided global `document`.
 * @outputs A fresh CommentsPane instance ready for render() calls or filter interaction.
 * @dataflow Global document + noopCallbacks → createCommentsPane() → returned pane object.
 * @controlflow Single delegation to createCommentsPane with no intermediate state; a new pane per call keeps tests isolated.
 */
function makePane(): CommentsPane {
  return createCommentsPane({ doc: document, callbacks: noopCallbacks });
}

/**
 * @purpose Collects the data-thread-id of every rendered comment card in DOM order.
 * @inputs pane - The comments pane whose list currently holds zero or more cards.
 * @outputs An ordered string[] of thread ids; null attribute values are skipped so callers never see a null entry.
 * @dataflow querySelectorAll NodeList → per-node getAttribute('data-thread-id') → filtered non-null strings collected into an array.
 * @controlflow Iterates the NodeList with for...of, asserts each id is present (guarding against missing attributes), and pushes only confirmed ids — never early-returns so a malformed card surfaces as an assertion failure.
 */
function cardIds(pane: CommentsPane): string[] {
  const cards = pane.element.querySelectorAll('.kdoc-comment-card');
  const ids: string[] = [];
  for (const card of cards) {
    // Each rendered card must carry its thread id; assert presence so a missing attribute fails loudly instead of being silently dropped.
    const id = card.getAttribute('data-thread-id');
    assertNotNull(id);
    if (id !== null) {
      ids.push(id);
    } else {
      // Unreachable after the assertion above; present only to satisfy strict narrowing without a cast.
    }
  }
  return ids;
}

describe('comments-pane', () => {
  it('defaults to the open filter, hiding resolved threads', () => {
    // A resolved comment is finished business, so showing it by default would keep drawing attention to something already dealt with.
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', true, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    expect(cardIds(pane)).toEqual(['a']);
  });

  it('shows both threads when the state filter is switched to all', () => {
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', true, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    // Locate the state filter and switch it to "all" via a real change event so the pane's listener repaints.
    const stateSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-comments-filter-state');
    assertNotNull(stateSelect);
    stateSelect.value = 'all';
    stateSelect.dispatchEvent(new Event('change'));

    expect(cardIds(pane)).toHaveLength(2);
    expect(cardIds(pane)).toContain('a');
    expect(cardIds(pane)).toContain('b');
  });

  it('shows only the resolved thread when the state filter is switched to resolved', () => {
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', true, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    // Reuse the same mechanics as the "all" case but select the resolved state.
    const stateSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-comments-filter-state');
    assertNotNull(stateSelect);
    stateSelect.value = 'resolved';
    stateSelect.dispatchEvent(new Event('change'));

    expect(cardIds(pane)).toEqual(['b']);
  });

  it('populates the author select from the threads present, leading with "all authors"', () => {
    // Two distinct authors must yield an options list of [All authors, Ada, Grace] in sorted order.
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', false, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    const authorSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-comments-filter-author');
    assertNotNull(authorSelect);
    expect(authorSelect.options.length).toBe(3);
    const firstOption = authorSelect.options[0];
    assertNotNull(firstOption ?? null);
    expect(firstOption?.value).toBe('');

    // Collect option values to assert the two authors are present alongside the leading empty "all authors" entry.
    const values: string[] = [];
    for (const option of authorSelect.options) {
      values.push(option.value);
    }
    expect(values).toContain('Ada');
    expect(values).toContain('Grace');
  });

  it('narrows the list to a single author when that author is selected', () => {
    // With two open threads by different authors, selecting Ada should leave only Ada's card.
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', false, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    const authorSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-comments-filter-author');
    assertNotNull(authorSelect);
    authorSelect.value = 'Ada';
    authorSelect.dispatchEvent(new Event('change'));

    expect(cardIds(pane)).toEqual(['a']);
  });

  it('resets the author filter when the selected author disappears rather than showing an empty pane', () => {
    // A filter silently pointing at an author with no comments would show an empty pane with no explanation; instead reset to "all authors".
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', false, '2026-01-02T00:00:00Z')],
      new Set(),
      null,
    );

    // First narrow to Grace so the author select holds that selection.
    const authorSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-comments-filter-author');
    assertNotNull(authorSelect);
    authorSelect.value = 'Grace';
    authorSelect.dispatchEvent(new Event('change'));
    expect(cardIds(pane)).toEqual(['b']);

    // Re-render with only Ada's thread; Grace is gone, so the selection must reset and Ada must remain visible.
    pane.render([makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z')], new Set(), null);

    assertNotNull(authorSelect);
    expect(authorSelect.value).toBe('');
    expect(cardIds(pane)).toEqual(['a']);
  });

  it('uses a distinct empty-state label for filter-empty versus no-comments', () => {
    // An empty pane caused by a filter looks identical to one with no comments, so the user must be told which without being misled.
    const noThreads = makePane();
    noThreads.render([], new Set(), null);
    const emptyNoComments = noThreads.element.querySelector<HTMLParagraphElement>('.kdoc-comments-empty');
    assertNotNull(emptyNoComments);
    expect(emptyNoComments.hidden).toBe(false);
    expect(emptyNoComments.textContent).toBe('No comments yet');

    // One resolved thread with the default open filter yields a matching-but-filtered pane.
    const filtered = makePane();
    filtered.render([makeThread('b', 'Grace', true, '2026-01-02T00:00:00Z')], new Set(), null);
    const emptyFiltered = filtered.element.querySelector<HTMLParagraphElement>('.kdoc-comments-empty');
    assertNotNull(emptyFiltered);
    expect(emptyFiltered.hidden).toBe(false);
    expect(emptyFiltered.textContent).toBe('No comments match the current filter');
  });

  it('hides the empty state when cards are showing', () => {
    // With one open thread a card renders, so the empty-state paragraph must be hidden.
    const pane = makePane();
    pane.render([makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z')], new Set(), null);

    const emptyState = pane.element.querySelector<HTMLParagraphElement>('.kdoc-comments-empty');
    assertNotNull(emptyState);
    expect(emptyState.hidden).toBe(true);
  });

  it('sorts orphaned threads last regardless of their createdAt', () => {
    // An orphaned thread has no position in the document to sit beside, so it is grouped at the end rather than interleaved where its stale offset would put it.
    const pane = makePane();
    pane.render(
      [makeThread('x', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('y', 'Ada', false, '2026-01-02T00:00:00Z'), makeThread('z', 'Ada', false, '2026-01-03T00:00:00Z')],
      new Set(['y']),
      null,
    );

    expect(cardIds(pane)).toEqual(['x', 'z', 'y']);
  });

  it('marks exactly one card as active for the active thread id', () => {
    // The second thread is highlighted; assert a single active marker exists and points at that thread.
    const pane = makePane();
    pane.render(
      [makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z'), makeThread('b', 'Grace', false, '2026-01-02T00:00:00Z')],
      new Set(),
      'b',
    );

    const activeCards = pane.element.querySelectorAll('.kdoc-comment-card-active');
    expect(activeCards.length).toBe(1);
    const activeCard = activeCards[0];
    assertNotNull(activeCard ?? null);
    expect(activeCard?.getAttribute('data-thread-id')).toBe('b');
  });

  it('detaches the element from its parent on destroy', () => {
    // After appending to document.body, destroy() must remove the pane so nothing remains in the DOM.
    const pane = makePane();
    pane.render([makeThread('a', 'Ada', false, '2026-01-01T00:00:00Z')], new Set(), null);
    document.body.appendChild(pane.element);

    pane.destroy();

    expect(pane.element.parentNode).toBeNull();
    expect(document.body.contains(pane.element)).toBe(false);
  });
});