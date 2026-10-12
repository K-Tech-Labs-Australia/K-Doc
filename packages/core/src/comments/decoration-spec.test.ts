/**
 * @file decoration-spec.test.ts
 * @purpose Vitest suite covering the pure decision half of comment decoration (planDecorations): which ranges are commented and in what state, plus orphaned quotes that can no longer be located.
 * @inputs planDecorations from ./decoration-spec.js, createThread/createAnchor fixtures, and a fixed document TEXT.
 * @outputs Test assertions verifying span/orphan classification, the resolved-skip flag, empty-comment handling, overlap ordering, and an empty input list.
 * @functions base: build one open thread anchored on "hello" for shared setup; anchorOn: build a thread whose quote is sliced from TEXT at [start,end).
 * @dataflow Fixture constants -> planDecorations -> expect() assertions over DecorationPlan.spans / .orphaned.
 * @controlflow Each it() exercises one classification rule and asserts the resulting spans/orphans lists.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { createAnchor } from './anchor.js';
import { createThread } from './thread.js';
import type { CommentThread } from './thread.js';
import { planDecorations } from './decoration-spec.js';

const TEXT = 'hello world, the quick brown fox jumps.'; // document whose comment ranges are decorated throughout this suite.
const T0 = new Date('2026-09-06T10:00:00.000Z'); // fixed creation stamp so threads compare deterministically without clock drift.

function anchorOn(id: string, start: number, end: number): CommentThread {
  const quotedText = TEXT.slice(start, end); // the exact characters this thread quotes within TEXT
  return createThread(id, createAnchor(quotedText, start, end), 'e1', 'Ada', 'hi', T0); // open one-entry thread anchored on [start,end)
}

describe('planDecorations', () => {
  it('one open thread yields exactly one span at its offsets', () => {
    const t = anchorOn('t1', 0, 5); // "hello" sits at [0,5) in TEXT
    const plan = planDecorations(TEXT, [t]); // decorate the document with this single thread
    expect(plan.spans).toHaveLength(1); // exactly one comment range is marked on the page
    const sp0 = plan.spans[0]; // narrow CommentSpan | undefined under noUncheckedIndexedAccess
    if (sp0 === undefined) throw new Error('expected a span for the open thread'); // fail fast rather than assert through an empty list
    expect(sp0.threadId).toBe('t1'); // this range is owned by the single thread
    expect(sp0.start).toBe(0); // quote begins at offset 0
    expect(sp0.end).toBe(5); // and ends just past "hello"
    expect(sp0.state).toBe('open'); // an unresolved thread paints as open (FR-10.4)
  });

  it('a resolved thread is skipped by default', () => {
    const t = anchorOn('t1', 0, 5); // "hello" at [0,5), still open before the flip
    const plan = planDecorations(TEXT, [{ ...t, resolved: true }]); // spread flips it to finished business before decorating (FR-10.4)
    expect(plan.spans).toHaveLength(0); // nothing is painted for a thread already dealt with by default
  });

  it('a resolved thread appears when includeResolved is set', () => {
    const t = anchorOn('t1', 0, 5); // "hello" at [0,5), still open before the flip
    const plan = planDecorations(TEXT, [{ ...t, resolved: true }], true); // opt in to finished threads via the pane filter (FR-10.4)
    expect(plan.spans).toHaveLength(1); // the resolved thread is now painted like an open one
    const sp0 = plan.spans[0]; // narrow CommentSpan | undefined under noUncheckedIndexedAccess
    if (sp0 === undefined) throw new Error('expected a span for the opted-in resolved thread'); // fail fast rather than assert through an empty list
    expect(sp0.state).toBe('resolved'); // state mirrors the flipped flag so tint matches status
  });

  it('an orphaned quote is listed, not dropped (FR-10.5)', () => {
    const t = createThread('t9', createAnchor('a completely separate document', 2, 12), 'e9', 'Ada', 'lost comment', T0); // anchor points at foreign text that cannot live inside TEXT
    const plan = planDecorations(TEXT, [t]); // decorate against the real document so this quote can never be re-located
    expect(plan.spans).toHaveLength(0); // no range resolves within this document
    expect(plan.orphaned).toHaveLength(1); // but the thread is preserved for display rather than discarded (FR-10.5)
    const or0 = plan.orphaned[0]; // narrow OrphanedThread | undefined under noUncheckedIndexedAccess
    if (or0 === undefined) throw new Error('expected an orphan entry'); // fail fast rather than assert through an empty list
    expect(or0.threadId).toBe('t9'); // the orphan stays identifiable by its thread id on click and in the pane
    expect(or0.quotedText).toBe(t.anchor.quotedText); // FR-10.5: the quote must travel with the orphan because it is the only thing left saying what the comment was about
  });

  it('overlapping threads both produce spans, longer first', () => {
    const short = anchorOn('short', 0, 5); // "hello" at [0,5), nested inside the longer range
    const long = anchorOn('long', 0, 11); // "hello world" at [0,11), sharing start with the shorter one
    const plan = planDecorations(TEXT, [short, long]); // pass shortest-first on purpose to prove ordering is not insertion-driven (FR-10.5)
    expect(plan.spans).toHaveLength(2); // both overlapping ranges are marked independently — never merged or split
    const sp0 = plan.spans[0]; // narrow CommentSpan | undefined under noUncheckedIndexedAccess
    if (sp0 === undefined) throw new Error('expected the outer span first'); // fail fast rather than assert through an empty list
    expect(sp0.threadId).toBe('long'); // outer-before-inner is what makes nesting paint correctly so the child sits inside its parent's tint
  });

  it('a thread with no comments is ignored even when resolved', () => {
    const t: CommentThread = { id: 'empty', anchor: createAnchor(TEXT.slice(0, 5), 0, 5), createdAt: T0.toISOString(), resolved: false, comments: [] }; // explicit empty-thread literal — a present-but-empty store entry means a hand-edited file
    const plan = planDecorations(TEXT, [t], true); // includeResolved is on so the only thing that could surface this thread is its emptiness (FR-10.4)
    expect(plan.spans).toHaveLength(0); // deleteEntry returns null for an emptied thread, so a live empty one carries no real state to paint
    expect(plan.orphaned).toHaveLength(0); // and it must not be treated as orphaned either — there is nothing lost to recover
  });

  it('an empty thread list gives two empty arrays', () => {
    const plan = planDecorations(TEXT, []); // decorate a document with no threads at all
    expect(plan.spans).toHaveLength(0); // nothing commented means nothing painted
    expect(plan.orphaned).toHaveLength(0); // and there are no quotes to preserve either
  });
});
