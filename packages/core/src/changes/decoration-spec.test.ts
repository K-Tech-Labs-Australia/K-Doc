/**
 * @file decoration-spec.test.ts
 * @purpose Vitest suite for the headless change-decoration decision layer in ./decoration-spec.js: it pins every FR-11 rule — which markup surface emits spans vs bars, how a deletion becomes a zero-width point carrying its text, why replacements sort deletions before insertions by geometry, and how originalText() reverts edits. Each case builds the post-edit document plus concrete changes with createInsertion/createDeletion, then asserts on planChanges output (spans/bars), lineOf bar attribution, and originalText round-trips so the drawing layer's "what to mark" stays independently verifiable without a browser or ProseMirror.
 * @inputs The ./decoration-spec.js exports (lineOf, planChanges, originalText) plus createInsertion/createDeletion from ./change.js; a fixed clock Date and hand-built Markdown strings used as the post-edit source for every change.
 * @outputs No persisted values — only expect(...) assertions whose failures surface as failing Vitest cases.
 * @functions assertDefined: narrow T | undefined to T so bound spans can be read without unsafe casts or lost fields. at: locate a phrase within source, failing loudly if it is absent rather than returning -1 to downstream assertions.
 * @dataflow Fixed clock + literal documents -> change constructors (source = post-edit text) -> planChanges/lineOf/originalText -> expect comparisons against expected kinds, offsets, line indices, and reverted strings.
 * @controlflow describe('change decoration-spec') groups all cases; each it() builds its own post-edit document and one or more changes, invokes the decision function under test, binds any returned span via assertDefined before reading fields, then asserts the rule before moving on.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { lineOf, planChanges, originalText } from './decoration-spec.js';
import { createInsertion, createDeletion } from './change.js';

const clock = new Date('2026-09-07T10:00:00.000Z'); // Fixed wall-clock so every recorded createdAt is deterministic across runs.

/** assertDefined narrows a nullable span to non-null, letting tests read kind/start/end without an unsafe cast or a lost field. */
function assertDefined<T>(value: T | undefined): asserts value is T {
  expect(value).not.toBeUndefined(); // A missing mark means the plan regressed and must surface as a failing test rather than being coerced past.
}

/** at locates a phrase within source, failing loudly if it is absent rather than returning -1 to downstream assertions. */
function at(source: string, phrase: string): number {
  const found = source.indexOf(phrase); // Scan for the first occurrence of the phrase in the document text.
  expect(found).not.toBe(-1); // Guard: a missing phrase means the test's own premise is wrong and must surface immediately.

  return found; // Return the confirmed offset so callers can anchor changes against it.
}

describe('change decoration-spec', () => {
  // 'none' markup decorates nothing — but this is not an empty stub, as explained in the branch below.
  it("does not decorate when markup mode is 'none'", () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    // This is not a stub: accepting never edits the text, so the document already *is* the accepted result and a clean preview needs no decoration.
    const plan = planChanges(after, [change], 'none');
    expect(plan.spans).toEqual([]); // No inline marks when markup is disabled.
    expect(plan.bars).toEqual([]); // And no margin bars either — nothing to draw at all in this mode.
  });

  // 'original' renders a different text, so it also decorates neither spans nor bars of the current document.
  it("does not decorate when markup mode is 'original'", () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    // Original renders a different *text*, which originalText() produces read-only — not a decoration of this document.
    const plan = planChanges(after, [change], 'original');
    expect(plan.spans).toEqual([]); // No inline marks: the current text is replaced wholesale by its pre-edit form.
    expect(plan.bars).toEqual([]); // And no margin bars either — there is nothing to attribute on a document that is not shown.
  });

  // 'simple' markup shows only the touched line, never an inline tint over the change itself.
  it("emits only margin bars when markup mode is 'simple'", () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    // Simple surface adds a bar for the line but records no inline span.
    const plan = planChanges(after, [change], 'simple');
    expect(plan.spans).toEqual([]); // No inline marks in simple mode (FR-11.4).
    expect(plan.bars.length).toBe(1); // Exactly one bar for the single line carrying this change.
  });

  // 'all' markup adds both an inline span and its corresponding margin bar.
  it("emits both spans and bars when markup mode is 'all'", () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    // Full surface records the inline mark alongside the margin bar.
    const plan = planChanges(after, [change], 'all');
    expect(plan.spans.length).toBe(1); // One inline span for this one change (FR-11.4).
    expect(plan.bars.length).toBe(1); // And its single line's bar alongside it.
  });

  // An insertion's span covers exactly the run that now sits in the document.
  it('an insertion span covers its own text', () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    const plan = planChanges(after, [change], 'all');

    // Bind the span before reading any field so a missing mark fails loudly instead of throwing.
    const span = plan.spans[0];
    assertDefined(span);

    expect(after.slice(span.start, span.end)).toBe('quick '); // The recorded run is exactly what sits in the document between start and end.
    expect(span.kind).toBe('insert'); // An added run is marked as an insert change (FR-11.4).
    expect(span.author).toBe('Ada'); // The recording author surfaces on hover or selection of the mark.
    expect(span.changeId).toBe('c1'); // Each mark ties back to its tracked-change record for pane handling.
  });

  // A deletion has no characters in the document, so its span is a point that carries the removed string instead of a range.
  it('a deletion span is a zero-width point carrying its text', () => {
    const after = 'The brown fox';
    const change = createDeletion('c1', 'quick ', after, at(after, 'brown'), 'Ada', clock);

    const plan = planChanges(after, [change], 'all');

    // Bind the span before reading any field so a missing mark fails loudly instead of throwing.
    const span = plan.spans[0];
    assertDefined(span);

    expect(span.start).toBe(span.end); // A deletion occupies no characters in the document, so its range collapses to a single point.
    expect(span.kind).toBe('delete'); // A removed run is marked as a delete change (FR-11.4).
    expect(span.text).toBe('quick ');

    // The deleted characters are not in the document, so this span carries the string for the renderer to re-project rather than a range to mark over existing glyphs (FR-11.6).
  });

  // A replacement is recorded insertion-first but must be drawn deletion-first on the shared offset.
  it('a replacement sorts the deletion before the insertion', () => {
    const after = 'The slow fox';
    const where = at(after, 'slow ');
    const removal = createDeletion('c1', 'quick ', after, where, 'Ada', clock);
    const insertion = createInsertion('c2', 'slow ', after, where, 'Ada', clock);

    // The changes are passed insertion-first on purpose so the resulting order proves the plan sorts by geometry rather than by recording order.
    const plan = planChanges(after, [insertion, removal], 'all');

    const firstSpan = plan.spans[0];
    assertDefined(firstSpan);
    expect(firstSpan.kind).toBe('delete'); // The zero-width deletion has the smaller end at a shared offset, so it sorts ahead (FR-11.6).

    const secondSpan = plan.spans[1];
    assertDefined(secondSpan);
    expect(secondSpan.kind).toBe('insert'); // The replacement insertion follows its own deletion on the same line and draws removed text first.
  });

  // An untouched document places every change with maximum confidence: exact resolution.
  it('marks resolution exact on an untouched document', () => {
    const after = 'The quick brown fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    const plan = planChanges(after, [change], 'all');

    // Bind the span before reading any field so a missing mark fails loudly instead of throwing.
    const span = plan.spans[0];
    assertDefined(span);

    expect(span.resolution).toBe('exact'); // An unedited document matches the recorded context verbatim, so placement is exact (FR-11.x).
  });

  // Two changes on one physical line collapse to a single margin bar via keyed dedup.
  it('merges two same-line changes into a single bar', () => {
    const after = 'alpha quick bravo slow charlie';
    const first = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);
    const second = createInsertion('c2', 'slow ', after, at(after, 'slow '), 'Ada', clock);

    // Both changes sit on line 0, so the keyed Map collapses them into one bar (FR-11.x dedup).
    const plan = planChanges(after, [first, second], 'simple');
    expect(plan.bars.length).toBe(1); // A single bar represents both same-line edits.
  });

  // Changes on different lines each earn their own bar, emitted in ascending line order.
  it('emits one bar per line for changes on different lines', () => {
    const after = 'alpha\nbravo\ncharlie';
    const first = createInsertion('c1', 'x ', after, at(after, 'alpha'), 'Ada', clock);
    const second = createInsertion('c2', 'y ', after, at(after, 'charlie'), 'Ada', clock);

    // The first change lands on line 0 and the second on line 2; each gets its own bar in document order.
    const plan = planChanges(after, [first, second], 'simple');
    expect(plan.bars.length).toBe(2); // One bar per distinct line carrying a change.
    expect(plan.bars.map((b) => b.lineIndex)).toEqual([0, 2]); // Bars are sorted top-to-bottom by their zero-based row index.
  });

  // A single-line document places any offset on the first (and only) line at column zero.
  it('locates the first character of a single-line document', () => {
    const bar = lineOf('abc', 0);

    expect(bar.lineIndex).toBe(0); // Offset 0 is on the very first row.
    expect(bar.lineStart).toBe(0); // That row begins at column zero with no preceding newline.
  });

  // A offset past two newlines resolves to the third line and its true starting character.
  it('locates a line past two newlines', () => {
    const text = 'alpha\nbravo\ncharlie';

    const bar = lineOf(text, at(text, 'charlie'));

    expect(bar.lineIndex).toBe(2); // Two preceding separators place this offset on the third row (zero-based index 2).
    expect(text.slice(bar.lineStart).startsWith('charlie')).toBe(true); // The derived column is exactly where that line's first character begins.
  });

  // An out-of-range offset clamps into the document rather than throwing, landing on the last existing line.
  it('clamps an out-of-range offset to a valid line', () => {
    const bar = lineOf('abc', 999);

    expect(bar.lineIndex).toBe(0); // The single-line document has only row 0, so clamping keeps the lookup in bounds without throwing.
  });

  // Rejecting an insertion cuts its run out of the post-edit text, recovering the pre-edit string.
  it('undoes an insertion to recover the original text', () => {
    const before = 'The fox';
    const after = 'The quick fox';
    const change = createInsertion('c1', 'quick ', after, at(after, 'quick '), 'Ada', clock);

    expect(originalText(after, [change])).toBe(before); // Removing the inserted run restores exactly what was there before.
  });

  // Rejecting a deletion re-inserts its recorded text, recovering the pre-edit string.
  it('restores a deletion to recover the original text', () => {
    const before = 'The quick fox';
    const after = 'The fox';
    const change = createDeletion('c1', 'quick ', after, at(after, 'fox'), 'Ada', clock);

    expect(originalText(after, [change])).toBe(before); // Restoring the deleted run brings back exactly what was removed.
  });
});
