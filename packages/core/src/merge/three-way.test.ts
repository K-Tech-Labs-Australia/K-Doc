/**
 * @file three-way.test.ts
 * @purpose Vitest test suite for line diffing and three-way document merging (FR-6.4, FR-6.6). Covers line splitting, joining, Myers diff operations, hunk classifications, conflict detection, and resolved text reconstruction.
 * @inputs Baseline, buffer, and file-on-disk document strings, line arrays, and user conflict choices.
 * @outputs Vitest assertions verifying lossless line round-trips, diff minimality, hunk classifications, and merge resolution.
 * @functions
 *   - kindsOf: Extracts the ordered kinds of all hunks produced by a three-way merge.
 * @dataflow Document strings -> splitLines / joinLines / diffLines / mergeThreeWay / resolvedText -> assertions against expected structures and resolved texts.
 * @controlflow Suite 1 tests line splitting/joining -> Suite 2 tests Myers line diffing -> Suite 3 tests three-way merging and conflict resolution.
 * @version 2
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { splitLines, joinLines, diffLines } from './line-diff.js';
import { mergeThreeWay, resolvedText } from './three-way.js';
import type { HunkChoice, MergeHunk, MergeHunkKind } from './three-way.js';
import type { LineOp } from './line-diff.js';
import { replacementsOf } from './replacements.js';
import type { Replacement } from './replacements.js';

/**
 * A four-line document used as the common ancestor by most of the merge cases.
 * BASE ends with a newline, so splitLines(BASE) is ['one', 'two', 'three', 'four', ''] —
 * five lines, the last empty; it is the shape real files have.
 */
const BASE: string = 'one\ntwo\nthree\nfour\n';

/**
 * The kinds of a merge's hunks, in order - what a test usually wants to assert.
 *
 * @purpose Extracts the ordered kinds of all hunks produced by a three-way merge.
 * @inputs
 *   - base: string - The common ancestor document text.
 *   - mine: string - The unsaved buffer document text.
 *   - theirs: string - The file-on-disk document text.
 * @outputs readonly MergeHunkKind[] - Array containing the kind of each hunk in merge order.
 * @dataflow base, mine, theirs -> mergeThreeWay -> result.hunks -> map each hunk to its kind -> readonly MergeHunkKind[].
 * @controlflow Executes mergeThreeWay on the inputs -> maps hunks array to kind strings using an explicitly typed arrow callback -> returns mapped array.
 */
function kindsOf(base: string, mine: string, theirs: string): readonly MergeHunkKind[] {
  const result = mergeThreeWay(base, mine, theirs);
  return result.hunks.map((hunk: MergeHunk): MergeHunkKind => hunk.kind);
}

describe('splitLines and joinLines', (): void => {
  it('round-trips any text exactly', (): void => {
    // This is the invariant that makes a merge lossless.
    const samples: readonly string[] = ['', 'a', 'a\n', '\n', 'a\nb', 'a\r\nb\r\n', '\n\n\n'];
    for (const t of samples) {
      expect(joinLines(splitLines(t))).toBe(t);
    }
  });

  it('keeps a carriage return as part of the line', (): void => {
    // K-Doc never normalises line endings (FR-6.6), so the CR belongs to the line rather than being stripped and re-guessed on the way out.
    expect(splitLines('a\r\nb')).toEqual(['a\r', 'b']);
  });

  it('an empty string is one empty line, not no lines', (): void => {
    // An empty string splits into a single empty string element.
    expect(splitLines('')).toEqual(['']);
  });
});

describe('diffLines', (): void => {
  it('reports every line as kept when nothing changed', (): void => {
    // Diffing identical sequences reports every line as kept without insertions or deletions.
    const lines: readonly string[] = ['a', 'b', 'c'];
    const ops = diffLines(lines, lines);
    expect(ops).toHaveLength(3);
    for (const op of ops) {
      expect(op.kind).toBe('keep');
    }
  });

  it('finds a single inserted line', (): void => {
    // Diffing against a sequence with an added line detects exactly one insert and zero deletes.
    const before: readonly string[] = ['a', 'c'];
    const after: readonly string[] = ['a', 'b', 'c'];
    const ops = diffLines(before, after);
    const inserts = ops.filter((o: LineOp): boolean => o.kind === 'insert');
    const deletes = ops.filter((o: LineOp): boolean => o.kind === 'delete');
    expect(inserts.length).toBe(1);
    expect(deletes.length).toBe(0);
    expect(inserts[0]!.afterIndex).toBe(1);
  });

  it('finds a single deleted line', (): void => {
    // Diffing against a sequence with a removed line detects exactly one delete and zero inserts.
    const before: readonly string[] = ['a', 'b', 'c'];
    const after: readonly string[] = ['a', 'c'];
    const ops = diffLines(before, after);
    const deletes = ops.filter((o: LineOp): boolean => o.kind === 'delete');
    const inserts = ops.filter((o: LineOp): boolean => o.kind === 'insert');
    expect(deletes.length).toBe(1);
    expect(inserts.length).toBe(0);
    expect(deletes[0]!.beforeIndex).toBe(1);
  });

  it('is minimal for a replaced line', (): void => {
    // A diff that rewrote the whole document would also be correct and would make every merge a conflict, so minimality is the property that matters.
    const before: readonly string[] = ['a', 'b', 'c'];
    const after: readonly string[] = ['a', 'x', 'c'];
    const ops = diffLines(before, after);
    const deletes = ops.filter((o: LineOp): boolean => o.kind === 'delete');
    const inserts = ops.filter((o: LineOp): boolean => o.kind === 'insert');
    const keeps = ops.filter((o: LineOp): boolean => o.kind === 'keep');
    expect(deletes.length).toBe(1);
    expect(inserts.length).toBe(1);
    expect(keeps.length).toBe(2);
  });

  it('diffs against an empty side', (): void => {
    // Diffing against an empty sequence produces only deletions, and diffing from an empty sequence produces only insertions.
    const toEmpty = diffLines(['a', 'b'], []);
    expect(toEmpty.filter((o: LineOp): boolean => o.kind === 'delete').length).toBe(2);
    expect(toEmpty.filter((o: LineOp): boolean => o.kind === 'keep').length).toBe(0);

    const fromEmpty = diffLines([], ['a', 'b']);
    expect(fromEmpty.filter((o: LineOp): boolean => o.kind === 'insert').length).toBe(2);
    expect(fromEmpty.filter((o: LineOp): boolean => o.kind === 'keep').length).toBe(0);
  });

  it('reconstructs the after side from its ops', (): void => {
    // This is what makes the op list usable rather than merely plausible.
    const before: readonly string[] = ['a', 'b', 'c', 'd'];
    const after: readonly string[] = ['b', 'x', 'd', 'e'];
    const ops = diffLines(before, after);
    const rebuilt: string[] = [];
    for (const op of ops) {
      // Check whether this operation contributes a line to the after sequence.
      if (op.kind === 'keep' || op.kind === 'insert') {
        // Kept and inserted operations correspond to valid lines in after at op.afterIndex.
        rebuilt.push(after[op.afterIndex]!);
      } else {
        // Delete operations correspond to removed before lines and do not contribute to after.
      }
    }
    expect(rebuilt).toEqual(after);
  });
});

describe('mergeThreeWay', (): void => {
  it('is all stable when neither side changed', (): void => {
    // When neither side modified the ancestor document, the merge yields only stable hunks and zero conflicts.
    const result = mergeThreeWay(BASE, BASE, BASE);
    expect(kindsOf(BASE, BASE, BASE)).toEqual(['stable']);
    expect(result.conflictCount).toBe(0);
  });

  it('takes a change only the buffer made, without asking', (): void => {
    // Edits made solely in the buffer are accepted automatically without prompting.
    const mine: string = 'one\nTWO\nthree\nfour\n';
    const theirs: string = BASE;
    const result = mergeThreeWay(BASE, mine, theirs);
    const kinds = kindsOf(BASE, mine, theirs);
    expect(kinds).toContain('mine');
    expect(kinds).not.toContain('conflict');
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe(mine);
  });

  it('takes a change only the file made, without asking', (): void => {
    // This is the case a two-way merge would have had to ask about.
    const mine: string = BASE;
    const theirs: string = 'one\ntwo\nTHREE\nfour\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    const kinds = kindsOf(BASE, mine, theirs);
    expect(kinds).toContain('theirs');
    expect(kinds).not.toContain('conflict');
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe(theirs);
  });

  it('takes both sides when they changed different lines', (): void => {
    // This is the whole point of having a base — neither edit is in the other's way.
    const mine: string = 'ONE\ntwo\nthree\nfour\n';
    const theirs: string = 'one\ntwo\nthree\nFOUR\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('ONE\ntwo\nthree\nFOUR\n');
  });

  it('calls the same line changed differently a conflict', (): void => {
    // Competing non-identical edits to the same line produce a conflict.
    const mine: string = 'one\nMINE\nthree\nfour\n';
    const theirs: string = 'one\nTHEIRS\nthree\nfour\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(result.conflictCount).toBe(1);
    const conflictHunk = result.hunks.find(
      (hunk: MergeHunk): boolean => hunk.kind === 'conflict',
    );
    expect(conflictHunk).toBeDefined();
    expect(conflictHunk!.mine).not.toEqual(conflictHunk!.theirs);
  });

  it('does not call the same change on both sides a conflict', (): void => {
    // Both sides agreeing is not a disagreement, and asking would be a question with one answer.
    const mine: string = 'one\nSAME\nthree\nfour\n';
    const theirs: string = 'one\nSAME\nthree\nfour\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe(mine);
  });

  it('resolves a conflict to the chosen side', (): void => {
    // Choosing a side for a conflict adopts that side's version into the resolved text.
    const mine: string = 'one\nMINE\nthree\nfour\n';
    const theirs: string = 'one\nTHEIRS\nthree\nfour\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    const idx: number = result.hunks.findIndex(
      (hunk: MergeHunk): boolean => hunk.kind === 'conflict',
    );
    expect(idx).toBeGreaterThanOrEqual(0);

    const resolvedTheirs: string = resolvedText(
      result,
      new Map<number, HunkChoice>([[idx, 'theirs']]),
    );
    expect(resolvedTheirs).toContain('THEIRS');
    expect(resolvedTheirs).not.toContain('MINE');

    const resolvedMine: string = resolvedText(
      result,
      new Map<number, HunkChoice>([[idx, 'mine']]),
    );
    expect(resolvedMine).toContain('MINE');
    expect(resolvedMine).not.toContain('THEIRS');
  });

  it('keeps the buffer when a conflict has no choice', (): void => {
    // An unanswered question must never cost the user their unsaved work.
    const mine: string = 'one\nMINE\nthree\nfour\n';
    const theirs: string = 'one\nTHEIRS\nthree\nfour\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toContain('MINE');
  });

  it('merges insertions at different places', (): void => {
    // Independent insertions at distinct positions merge cleanly without conflict.
    const base: string = 'a\nb\nc\n';
    const mine: string = 'a\nX\nb\nc\n';
    const theirs: string = 'a\nb\nY\nc\n';
    const result = mergeThreeWay(base, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('a\nX\nb\nY\nc\n');
  });

  it('preserves CRLF on lines it did not touch', (): void => {
    // FR-6.6 — a merge that normalised line endings would rewrite every line of the file.
    const base: string = 'a\r\nb\r\nc\r\n';
    const mine: string = 'a\r\nB\r\nc\r\n';
    const theirs: string = base;
    const result = mergeThreeWay(base, mine, theirs);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe(mine);
  });

  it('handles a side that deleted everything', (): void => {
    // When one side clears the whole document and the other does not change it, the deletion resolves cleanly to empty text.
    const mine: string = '';
    const theirs: string = BASE;
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('');
  });

  it('counts two separate conflicts separately', (): void => {
    // Separate conflicting changes separated by untouched lines produce distinct conflict hunks.
    const mine: string = 'MINE_ONE\ntwo\nthree\nMINE_FOUR\n';
    const theirs: string = 'THEIRS_ONE\ntwo\nthree\nTHEIRS_FOUR\n';
    const result = mergeThreeWay(BASE, mine, theirs);
    expect(result.conflictCount).toBe(2);
  });

  it('keeps two adjacent one-line changes apart', (): void => {
    // Guards change.start < groupEnd in touches. If it were <=, adjacent changes would falsely fold into a conflict. Neighbouring is not overlapping — both edits stand.
    const base = 'a\nb\nc\nd\n';
    const mine = 'A\nb\nc\nd\n';     // the buffer changed line 1
    const theirs = 'a\nB\nc\nd\n';  // the other program changed line 2
    const result = mergeThreeWay(base, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('A\nB\nc\nd\n');
  });

  it('records a change that runs to the end of the document', (): void => {
    // Guards closing still-open runs at the end of replacementsOf. A run left open when the ops end would silently drop the change. With no trailing newline there is no kept line after the change to close its run, so the run has to be closed by the walk finishing.
    const base = 'a\nb';            // deliberately no trailing newline, so the last line is 'b'
    const mine = 'a\nB';            // the buffer rewrote the very last line
    const theirs = 'a\nb';
    const result = mergeThreeWay(base, mine, theirs);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('a\nB');

    // Appending case: a change extending past the previous end of the document.
    const appended = mergeThreeWay('a\nb\n', 'a\nb\nc\n', 'a\nb\n');
    expect(resolvedText(appended, new Map<number, HunkChoice>())).toBe('a\nb\nc\n');
  });

  it('an inserted line consumes no line of the base', (): void => {
    // Guards replacementsOf NOT advancing baseCursor on an 'insert' op. If an insertion moved the cursor, every later change on that side would be recorded one line further down the base than it really is, and would land in the wrong hunk. The insertion at the top must not shift where the edit to e is recorded.
    const base = 'a\nb\nc\nd\ne\n';
    const mine = 'X\na\nb\nc\nd\nE\n';   // an insertion at the top AND a change to the last line
    const theirs = 'a\nB\nc\nd\ne\n';    // an untouched-by-mine line in the middle
    const result = mergeThreeWay(base, mine, theirs);
    expect(result.conflictCount).toBe(0);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('X\na\nB\nc\nd\nE\n');
  });

  it('an insertion beside a replacement in one hunk keeps both', (): void => {
    // Guards Math.max(cursor, change.end) in applyWithin. A plain cursor = change.end moves the cursor backwards when a pure insertion follows a replacement inside one group, and lines get emitted twice.
    const base = 'a\nb\nc\n';
    const mine = 'A\nNEW\nb\nc\n';   // line 1 replaced, and a line inserted straight after it
    const theirs = 'a\nb\nc\n';
    const result = mergeThreeWay(base, mine, theirs);
    expect(resolvedText(result, new Map<number, HunkChoice>())).toBe('A\nNEW\nb\nc\n');
  });
});

describe('replacementsOf', (): void => {
  it('reports where a change sits in the base, not in the side', (): void => {
    // start and end index the BASE. An insertion consumes none of it, so its start and end are equal, and the replacement after it still names base line 2 rather than 3.
    const baseLines = splitLines('a\nb\nc\n');
    const changes: readonly Replacement[] = replacementsOf(baseLines, splitLines('X\na\nb\nC\n'));
    expect(changes).toHaveLength(2);
    expect(changes[0]!.start).toBe(0);
    expect(changes[0]!.end).toBe(0);
    expect(changes[0]!.lines).toEqual(['X']);
    expect(changes[1]!.start).toBe(2);
    expect(changes[1]!.end).toBe(3);
    expect(changes[1]!.lines).toEqual(['C']);
  });
});
