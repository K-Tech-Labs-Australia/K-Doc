/**
 * @file compare-changes.spec.ts
 * @purpose Tests the change-detection and reconciliation logic: comparing two text versions into tracked changes, reconstructing original/newer text from decisions, and rendering markup spans.
 * @inputs Two text strings (older and newer), an author label, a monotonic id generator, and a fixed timestamp; exercised through compareAsChanges, applyDecisions, originalText, and planChanges.
 * @outputs Boolean/structural assertions on change arrays, reconstructed text equality, and span kinds; no runtime side effects beyond test evaluation.
 * @functions ids: returns a closure producing zero-padded incremental change ids (c000, c001, ...).
 * @dataflow Test fixtures (older/newer strings) → compareAsChanges → change objects → assertions on id/kind/text/author/createdAt and anchor offsets; same changes → applyDecisions/originalText/planChanges for reconstruction checks.
 * @controlflow describe block groups the compareAsChanges suite; each it() runs one scenario, asserts expectations, then returns; ids() is recreated per case to guarantee fresh sequential ids.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { compareAsChanges } from '../src/changes/compare.js';
import { applyDecision, applyDecisions } from '../src/changes/change.js';
import { originalText, planChanges } from '../src/changes/decoration-spec.js';

const NOW = new Date('2026-09-16T08:00:00Z');

// ids returns a closure that yields sequential zero-padded change ids (c000, c001, ...) so each test starts from a clean id sequence.
function ids(): () => string {
  let next = 0;
  return () => `c${String(next++).padStart(3, '0')}`;
}

describe('compareAsChanges', () => {
  // Asserts that replacing one word yields a delete of the old word followed by an insert of the new word, with matching author and timestamp.
  it('marks a replaced word as a deletion then an insertion in the newer text', () => {
    const changes = compareAsChanges('The quick fox', 'The slow fox', 'Revised', ids(), NOW);
    expect(changes.map((change) => [change.id, change.kind, change.text, change.author, change.createdAt])).toEqual([
      ['c000', 'delete', 'quick', 'Revised', '2026-09-16T08:00:00.000Z'],
      ['c001', 'insert', 'slow', 'Revised', '2026-09-16T08:00:00.000Z'],
    ]);
    expect(changes[0]?.anchor.offset).toBe(4);
    expect(changes[1]?.anchor.offset).toBe(4);
  });

  // Asserts that rejecting all changes reconstructs the older text while accepting all changes yields the newer text.
  it('gives back the older text when every change is rejected, and the newer when accepted', () => {
    const older = '# Plan\n\nFirst draft. Second pass.\n\n- one\n- two\n- two\n';
    const newer = '# Plan v2\n\nFirst draft. Third pass, revised.\n\n- two\n- three\n';
    const changes = compareAsChanges(older, newer, 'Revised', ids(), NOW);
    expect(originalText(newer, changes)).toBe(older);
    expect(applyDecisions(newer, changes, 'reject')).toBe(older);
    expect(applyDecisions(newer, changes, 'accept')).toBe(newer);
  });

  // Asserts that adjacent repeated words are not collapsed into a single spurious change.
  it('rejects every change back to the older text after front matter is added above them', () => {
    // The store adds kdoc_id front matter once changes are saved; neighbouring changes must still restore in place.
    const older = '# Plan\n\nFirst draft. Second pass.\n\n- one\n- two\n';
    const newer = '# Plan v2\n\nFirst draft. Third pass, revised.\n\n- two\n- three\n';
    const changes = compareAsChanges(older, newer, 'Revised', ids(), NOW);
    const matter = '---\nkdoc_id: 01M2KF3PW1J0RN0PP5R95B9YKJ\n---\n\n';
    expect(applyDecisions(matter + newer, changes, 'reject')).toBe(matter + older);
    expect(originalText(matter + newer, changes)).toBe(matter + older);
  });

  it('rejects one change on its own in place, after front matter is added', () => {
    // Deciding changes one at a time, out of order, must also restore each where it belongs.
    const older = '# Plan\n\nFirst draft. Second pass.\n';
    const newer = '# Plan v2\n\nFirst draft. Third pass.\n';
    const changes = compareAsChanges(older, newer, 'Revised', ids(), NOW);
    const matter = '---\nkdoc_id: 01M2KF3PW1J0RN0PP5R95B9YKJ\n---\n\n';
    const second = changes.find((change) => change.text === 'Second');
    const third = changes.find((change) => change.text === 'Third');
    if (second === undefined || third === undefined) {
      throw new Error('expected a deletion of Second and an insertion of Third');
    } else {
      const restored = applyDecision(matter + newer, second, 'reject');
      expect(restored).toBe(`${matter}# Plan v2\n\nFirst draft. SecondThird pass.\n`);
      expect(applyDecision(restored ?? '', third, 'reject')).toBe(`${matter}# Plan v2\n\nFirst draft. Second pass.\n`);
    }
  });

  it('rejects the rest in place after some changes were decided one by one', () => {
    // Reject one deletion, accept one insertion, then reject everything left: each restores where it belongs.
    const older = '# Plan\n\nFirst draft. Second pass.\n\n- one\n- two\n';
    const newer = '# Plan v2\n\nFirst draft. Third pass, revised.\n\n- two\n- three\n';
    const matter = '---\nkdoc_id: 01M2KF3PW1J0RN0PP5R95B9YKJ\n---\n\n';
    const changes = compareAsChanges(older, newer, 'Revised', ids(), NOW);
    const second = changes.find((change) => change.text === 'Second');
    const renamed = changes.find((change) => change.text === ' v2');
    if (second === undefined || renamed === undefined) {
      throw new Error('expected a deletion of Second and an insertion of v2');
    } else {
      const afterOne = applyDecision(matter + newer, second, 'reject') ?? '';
      const rest = changes.filter((change) => change !== second && change !== renamed);
      expect(applyDecisions(afterOne, rest, 'reject')).toBe(`${matter}# Plan v2\n\nFirst draft. Second pass.\n\n- one\n- two\n`);
    }
  });

  it('keeps repeated words apart', () => {
    const older = 'a a a b a a';
    const newer = 'a a b a a a';
    const changes = compareAsChanges(older, newer, 'Revised', ids(), NOW);
    expect(originalText(newer, changes)).toBe(older);
  });

  // Asserts that the "all" markup mode renders a span for every change with matching kind and text.
  it('draws every change in the All Markup mode', () => {
    const newer = 'One three four';
    const changes = compareAsChanges('One two three', newer, 'Revised', ids(), NOW);
    expect(planChanges(newer, changes, 'all').spans.map((span) => [span.kind, span.text])).toEqual(changes.map((change) => [change.kind, change.text]));
  });

  // Asserts that identical texts produce no changes and that empty-string edges yield a single insert or delete.
  it('finds nothing for identical texts and handles empty ones', () => {
    expect(compareAsChanges('Same\n', 'Same\n', 'Revised', ids(), NOW)).toEqual([]);
    expect(compareAsChanges('', 'New', 'Revised', ids(), NOW).map((change) => change.kind)).toEqual(['insert']);
    expect(compareAsChanges('Old', '', 'Revised', ids(), NOW).map((change) => change.kind)).toEqual(['delete']);
  });
});
