/**
 * @file session-timeline.spec.ts
 * @purpose Vitest suite for DocumentSession.timeline verifying FR-14.7 records states to undo to.
 * @inputs Synthetic editor text snapshots, PaneId identifiers ('wysiwyg' | 'source'), and an injectable millisecond clock.
 * @outputs Vitest assertions validating timeline contents, pane attribution, coalescing separation, reset clearing, and canUndo agreement.
 * @functions None.
 * @dataflow DocumentSession edits -> EditHistory recording -> DocumentSession.timeline getter -> Vitest assertions.
 * @controlflow Execute eight tests across empty timeline, pre-edit capture, multi-edit ordering, pane attribution, external edit, reset, and undo agreement.
 * @version 1
 * @date 2026-09-12
 */

import { describe, beforeEach, expect, it } from 'vitest';
import { parseMarkdown } from '../src/parse/parser.js';
import { DocumentSession } from '../src/session/document-session.js';

describe('DocumentSession.timeline', (): void => {
  let clock: number = 0;

  beforeEach((): void => {
    clock = 0;
  });

  function session(text: string): DocumentSession {
    return new DocumentSession(text, { now: (): number => clock });
  }

  it('records nothing on a fresh session, so the timeline starts empty', (): void => {
    const doc = session('one');

    // Nothing has been edited yet, so there is no prior state to return to.
    expect(doc.timeline).toHaveLength(0);
  });

  it('records the pre-edit text so undo returns to what was there before', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyText('two');

    // The stored entry is what undo returns to, so it must be 'one' not the current 'two'.
    expect(doc.timeline.map((entry): string => entry.text)).toEqual(['one']);
  });

  it('keeps two separated edits as distinct entries in chronological order', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyText('two');
    clock += 5000;
    doc.applyText('three');

    // The gap exceeds the coalesce window, so each edit becomes its own entry, oldest first.
    expect(doc.timeline.map((entry): string => entry.text)).toEqual(['one', 'two']);
  });

  it('attributes a source-pane edit to the source pane on the timeline', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyText('two');

    // The entry records which pane made the edit for correct labeling in a history browser.
    expect(doc.timeline.map((entry): string => entry.pane)).toEqual(['source']);
  });

  it('attributes an apply-tree edit to the wysiwyg pane even when text is unchanged', (): void => {
    const doc = session('one');

    // A new session defaults to wysiwyg, so this round-trip tree application is attributed there.
    doc.applyTree(parseMarkdown(doc.snapshot.text).root);

    expect(doc.timeline.map((entry): string => entry.pane)).toEqual(['wysiwyg']);
  });

  it('records a find-and-replace replace-all as an undoable timeline entry', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyExternalText('four');

    // A non-pane edit still belongs on the shared history so Ctrl+Z can take it back.
    expect(doc.timeline.map((entry): string => entry.text)).toEqual(['one']);
  });

  it('clears the timeline on reset because a reload is a different document', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyText('two');
    doc.reset('fresh');

    // The old versions belong to the previous content and must not survive a reload.
    expect(doc.timeline).toHaveLength(0);
  });

  it('keeps the timeline length in lockstep with canUndo across an undo', (): void => {
    const doc = session('one');
    doc.focusPane('source');
    doc.applyText('two');

    // After one edit both describe a single undoable entry still on the stack.
    expect(doc.snapshot.canUndo).toBe(true);
    expect(doc.timeline).toHaveLength(1);

    // Undoing empties the shared stack, so canUndo and timeline length both drop to zero.
    doc.undo();
    expect(doc.snapshot.canUndo).toBe(false);
    expect(doc.timeline).toHaveLength(0);
  });
});
