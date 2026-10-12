// @vitest-environment jsdom
/**
 * @file review-pane.test.ts
 * @purpose Exercises the review-pane module: empty-state messaging, per-row rendering of change kind/author/text, oldest-first sorting, selection vs. decision isolation on click, and host reporting plus argument-driven control syncing.
 * @inputs TrackedChange fixtures built by makeChange; a detached DOM via jsdom's global document; ReviewPaneCallbacks captured by harness().
 * @outputs expect(...) assertions over rendered DOM nodes and recorded callback arrays.
 * @functions
 *   - assertNotNull: Type-guard asserting a value is non-null before its properties are read.
 *   - makeChange: Builds a TrackedChange fixture with an empty anchor.
 *   - harness: Records every callback invocation into plain arrays and returns the pane plus those arrays.
 * @dataflow Fixture changes → createReviewPane().render() → DOM nodes → dispatched events → recording arrays; assertions read both DOM state and recorded callbacks.
 * @controlflow For each test: build a fresh harness, render or dispatch an event, then assert on DOM properties and/or recorded callback values.
 * @version 1
 * @date 2026-09-08
 */

import { describe, expect, it } from 'vitest';
import type { TrackedChange, ChangeDecision, MarkupMode } from '@k-doc/core';
import { createReviewPane, type ReviewPane, type ReviewPaneCallbacks, type DecisionScope } from './review-pane.js';

// Shared timestamps: the earliest change and a later one used to prove oldest-first ordering.
const clock = '2026-09-08T10:00:00.000Z';
const LATER = '2026-09-08T11:00:00.000Z';

/**
 * @purpose Asserts a value is non-null so its properties can be read under strict null checks.
 * @inputs value the possibly-null candidate to guard.
 * @outputs void; narrows `value` to T for subsequent use via an assertion signature.
 * @dataflow The raw nullable reference → expect() check → narrowed type at call site.
 * @controlflow Single branch: throws when null, otherwise returns leaving the value usable as non-null.
 */
function assertNotNull<T>(value: T | null): asserts value is T {
  // Guard before any property access so a missing node fails loudly instead of throwing on undefined.
  expect(value).not.toBeNull();
}

/**
 * @purpose Builds a TrackedChange fixture with an empty anchor for use in render calls.
 * @inputs id the change identifier; kind insert or delete; author display name; createdAt ISO timestamp; text recorded content.
 * @outputs A fully-populated TrackedChange ready to hand to pane.render().
 * @dataflow Primitive arguments → a single object literal shaped like TrackedChange with an empty anchor.
 * @controlflow No branching: constructs and returns the fixture directly.
 */
function makeChange(
  id: string,
  kind: 'insert' | 'delete',
  author: string,
  createdAt: string,
  text: string,
): TrackedChange {
  // The anchor is empty because this module never computes anchors; only the display fields matter here.
  return {
    id,
    kind,
    author,
    createdAt,
    text,
    anchor: { prefix: '', suffix: '', offset: 0 },
  };
}

/**
 * @purpose Constructs a ReviewPane whose callbacks record every invocation into plain arrays for later assertion.
 * @inputs void; the global jsdom document supplies the detached DOM used by createReviewPane.
 * @outputs The pane plus recording arrays (selected, decided, decidedAll, modes, trackingCalls) so tests can assert on user intent without inspecting live state.
 * @dataflow Five callback closures each push into a captured array; createReviewPane wires those callbacks to the DOM it builds once.
 * @controlflow No branching: initialize recording arrays, close over them in the five handlers, build the pane with { doc: document, callbacks }, and return everything together.
 */
function harness(): {
  readonly pane: ReviewPane;
  readonly selected: string[];
  readonly decided: Array<{ id: string; decision: ChangeDecision }>;
  readonly decidedAll: Array<{ decision: ChangeDecision; scope: DecisionScope }>;
  readonly modes: MarkupMode[];
  readonly trackingCalls: boolean[];
} {
  // Recording arrays capture one entry per user action so assertions compare exact sequences.
  const selected: string[] = [];
  const decided: Array<{ id: string; decision: ChangeDecision }> = [];
  const decidedAll: Array<{ decision: ChangeDecision; scope: DecisionScope }> = [];
  const modes: MarkupMode[] = [];
  const trackingCalls: boolean[] = [];

  // Each handler pushes into its matching array, giving tests a deterministic record of host-facing intent.
  const callbacks: ReviewPaneCallbacks = {
    onSelect(changeId) {
      selected.push(changeId);
    },
    onDecide(changeId, decision) {
      decided.push({ id: changeId, decision });
    },
    onDecideAll(decision, scope) {
      decidedAll.push({ decision, scope });
    },
    onModeChange(mode) {
      modes.push(mode);
    },
    onTrackingChange(on) {
      trackingCalls.push(on);
    },
  };

  // The pane is built against the jsdom global document so all nodes stay detached until attached by a test.
  const pane = createReviewPane({ doc: document, callbacks });
  return { pane, selected, decided, decidedAll, modes, trackingCalls };
}

describe('review-pane', () => {
  it('the empty state distinguishes off from empty', () => {
    const { pane } = harness();

    // With tracking off the message answers "nothing will happen until you turn on tracking".
    pane.render([], null, false, 'all');
    const emptyOff = pane.element.querySelector('.kdoc-review-empty') as HTMLElement;
    assertNotNull(emptyOff);
    expect(emptyOff.hidden).toBe(false);
    expect(emptyOff.textContent).toBe('Tracking is off');

    // With tracking on but no changes yet the message answers "nothing has happened yet".
    pane.render([], null, true, 'all');
    const emptyOn = pane.element.querySelector('.kdoc-review-empty') as HTMLElement;
    assertNotNull(emptyOn);
    expect(emptyOn.textContent).toBe('No tracked changes yet');

    // The two strings answer different questions; showing the wrong one sends the user hunting for a bug that is not there.
  });

  it('renders a row per change', () => {
    const { pane } = harness();
    const changes = [makeChange('a', 'insert', 'Ada', clock, 'x'), makeChange('b', 'delete', 'Ada', LATER, 'y')];

    pane.render(changes, null, true, 'all');

    // One row is built per change.
    expect(pane.element.querySelectorAll('.kdoc-review-row')).toHaveLength(2);

    // With rows present the empty paragraph stays hidden so it never shows over real content.
    const empty = pane.element.querySelector('.kdoc-review-empty') as HTMLElement;
    assertNotNull(empty);
    expect(empty.hidden).toBe(true);
  });

  it('names the kind, the author and the text on a row', () => {
    const { pane } = harness();
    // A trailing space in 'quick ' is asserted verbatim to prove recorded text is copied exactly.
    pane.render([makeChange('a', 'insert', 'Ada', clock, 'quick ')], null, true, 'all');

    // An insertion's kind badge reads "Inserted".
    const kind = pane.element.querySelector('.kdoc-review-kind') as HTMLElement;
    assertNotNull(kind);
    expect(kind.textContent).toBe('Inserted');

    // The author span carries the change's author verbatim.
    const author = pane.element.querySelector('.kdoc-review-author') as HTMLElement;
    assertNotNull(author);
    expect(author.textContent).toBe('Ada');

    // The text span carries the recorded insertion string, including its trailing space.
    const text = pane.element.querySelector('.kdoc-review-text') as HTMLElement;
    assertNotNull(text);
    expect(text.textContent).toBe('quick ');
  });

  it('a deletion is struck through and named', () => {
    const { pane } = harness();
    pane.render([makeChange('a', 'delete', 'Ada', clock, 'gone ')], null, true, 'all');

    // A deletion's kind badge reads "Deleted".
    const kind = pane.element.querySelector('.kdoc-review-kind') as HTMLElement;
    assertNotNull(kind);
    expect(kind.textContent).toBe('Deleted');

    // The text span carries the delete class so it renders struck through.
    const text = pane.element.querySelector('.kdoc-review-text') as HTMLElement;
    assertNotNull(text);
    expect(text.classList.contains('kdoc-review-text-delete')).toBe(true);
  });

  it('rows sort oldest first', () => {
    const { pane } = harness();
    // Rendered newest-first in the array, but the list must present earliest-first.
    const later = makeChange('later', 'insert', 'Ada', LATER, 'x');
    const earlier = makeChange('earlier', 'delete', 'Ada', clock, 'y');

    pane.render([later, earlier], null, true, 'all');

    // The first rendered row belongs to the earliest change because sorting is ascending by createdAt.
    const firstRow = pane.element.querySelector('.kdoc-review-row') as HTMLElement;
    assertNotNull(firstRow);
    expect(firstRow.dataset.changeId).toBe('earlier');
  });

  it('deciding does not also select', () => {
    const { pane, decided, selected } = harness();
    pane.render([makeChange('a', 'insert', 'Ada', clock, 'x ')], null, true, 'all');

    // Clicking the accept button fires a bubbling event so it would reach the row's select handler if unguarded.
    const acceptBtn = pane.element.querySelector<HTMLButtonElement>('.kdoc-review-accept') as HTMLButtonElement;
    assertNotNull(acceptBtn);
    acceptBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // The decision is recorded...
    expect(decided).toEqual([{ id: 'a', decision: 'accept' }]);
    // ...but the row did not also select, because stopPropagation keeps deciding from moving the caret out mid-click.
    expect(selected).toEqual([]);
  });

  it('clicking the row does select', () => {
    const { pane, selected } = harness();
    pane.render([makeChange('a', 'insert', 'Ada', clock, 'x ')], null, true, 'all');

    // A bubbling click dispatched on the row itself triggers its own select handler.
    const row = pane.element.querySelector('.kdoc-review-row') as HTMLElement;
    assertNotNull(row);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Selecting a change records exactly that change's id.
    expect(selected).toEqual(['a']);
  });

  it('the controls report to the host', () => {
    const { pane, trackingCalls, modes, decidedAll } = harness();

    // Toggling the tracking checkbox reports its new checked state up to the host on change.
    const trackingInput = pane.element.querySelector<HTMLInputElement>('.kdoc-review-tracking');
    assertNotNull(trackingInput);
    trackingInput.checked = true;
    trackingInput.dispatchEvent(new Event('change'));
    expect(trackingCalls).toEqual([true]);

    // Choosing a markup mode reports that value up to the host on change.
    const modeSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-review-mode');
    assertNotNull(modeSelect);
    modeSelect.value = 'simple';
    modeSelect.dispatchEvent(new Event('change'));
    expect(modes).toEqual(['simple']);

    // The bulk action buttons each report their decision to the host when clicked.
    const acceptAll = pane.element.querySelector<HTMLButtonElement>('.kdoc-review-accept-all');
    assertNotNull(acceptAll);
    acceptAll.click();
    const rejectAll = pane.element.querySelector<HTMLButtonElement>('.kdoc-review-reject-all');
    assertNotNull(rejectAll);
    rejectAll.click();
    expect(decidedAll).toEqual([
      { decision: 'accept', scope: { kind: 'document' } },
      { decision: 'reject', scope: { kind: 'document' } },
    ]);
  });

  it('the scope selector offers document, selection and each author', () => {
    const { pane } = harness();
    // Two changes by two different authors so the selector must list both alongside the always-present scopes.
    pane.render(
      [makeChange('a', 'insert', 'Ada', clock, 'x'), makeChange('b', 'delete', 'Grace', LATER, 'y')],
      null,
      true,
      'all',
    );

    const scopeSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-review-scope');
    assertNotNull(scopeSelect);
    // Option values are exactly document and selection first, then each distinct author sorted ascending.
    expect(Array.from(scopeSelect.options).map((option) => option.value)).toEqual([
      'document',
      'selection',
      'author:Ada',
      'author:Grace',
    ]);
  });

  it('a bulk decision carries the chosen scope', () => {
    const { pane, decidedAll } = harness();
    pane.render([makeChange('a', 'insert', 'Ada', clock, 'x ')], null, true, 'all');

    // Choose the author-scoped option before pressing a bulk button so its value is read at decision time.
    const scopeSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-review-scope');
    assertNotNull(scopeSelect);
    scopeSelect.value = 'author:Ada';

    // Clicking accept-all reports the chosen author scope, not just a bare document-wide decision.
    const acceptAll = pane.element.querySelector<HTMLButtonElement>('.kdoc-review-accept-all');
    assertNotNull(acceptAll);
    acceptAll.click();
    expect(decidedAll).toEqual([{ decision: 'accept', scope: { kind: 'author', author: 'Ada' } }]);
  });

  it('a scope pointing at a departed author falls back to the document', () => {
    const { pane } = harness();
    // Render one change by Grace and point the selector at her, then re-render with only Ada's change remaining.
    pane.render([makeChange('g', 'insert', 'Grace', clock, 'x ')], null, true, 'all');
    const scopeSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-review-scope');
    assertNotNull(scopeSelect);
    scopeSelect.value = 'author:Grace';
    pane.render([makeChange('a', 'insert', 'Ada', LATER, 'y ')], null, true, 'all');

    // Grace no longer has a change, so her option is gone and the selector must fall back to 'document'. A scope left pointing
    // at someone with no changes would make a bulk decision quietly do nothing.
    assertNotNull(scopeSelect);
    expect(scopeSelect.value).toBe('document');
  });

  it('the controls are synced from the arguments, not from remembered state', () => {
    const { pane } = harness();

    // The first render drives both controls to match its truth.
    pane.render([], null, true, 'none');
    const trackingInput = pane.element.querySelector<HTMLInputElement>('.kdoc-review-tracking');
    assertNotNull(trackingInput);
    expect(trackingInput.checked).toBe(true);
    const modeSelect = pane.element.querySelector<HTMLSelectElement>('.kdoc-review-mode');
    assertNotNull(modeSelect);
    expect(modeSelect.value).toBe('none');

    // A second render overwrites both controls with new truth rather than keeping the previous values.
    pane.render([], null, false, 'original');
    assertNotNull(trackingInput);
    expect(trackingInput.checked).toBe(false);
    assertNotNull(modeSelect);
    expect(modeSelect.value).toBe('original');

    // The pane is told the truth on every render rather than keeping its own copy; two places disagreeing about whether tracking is on is exactly the bug this avoids.
  });
});