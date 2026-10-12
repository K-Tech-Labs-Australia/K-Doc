/**
 * @file three-way.ts
 * @purpose Implements the three-way line merge sweep for K-Doc's merge view (FR-6.4): given the last-saved common ancestor plus two competing sides, it turns each side's replacement ranges into classified hunks ('stable', 'mine', 'theirs', or 'conflict'). resolvedText(mergeThreeWay(b, m, t), new Map()) returns the buffer's own text exactly when no hunk is 'theirs'. Because splitLines/joinLines are lossless, a merge never rewrites a line ending it did not touch (FR-6.6).
 * @inputs base: string - The last-saved common ancestor text; mine: string - The unsaved buffer text; theirs: string - The file-on-disk text for mergeThreeWay; MergeResult and ReadonlyMap<number, HunkChoice> for resolvedText.
 * @outputs MergeResult carrying classified hunks and a conflict count from mergeThreeWay; the reconstructed final text string from resolvedText.
 * @functions
 *   - mergeThreeWay: Sweeps each side's ascending replacement ranges into grouped, classified MergeHunks over the base text.
 *   - resolvedText: Reconstructs final text from hunks and a choices map, defaulting unresolved conflicts to the buffer's own lines.
 * @dataflow base, mine, theirs strings -> splitLines -> line arrays -> replacementsOf -> ascending Replacement lists -> mergeThreeWay groups overlapping changes and classifies each group; result.hunks + choices map -> resolvedText forEach -> joinLines -> final text.
 * @controlflow Compute both sides' replacements -> sweep the two ascending lists with a cursor, emitting stable gaps between groups -> grow each change group until no touching change remains -> reconstruct and classify each side's version into stable/mine/theirs/conflict -> emit trailing stable lines -> count conflicts; resolvedText walks hunks in order applying the chosen or default side per hunk.
 * @version 1
 * @date 2026-09-12
 */

import { splitLines, joinLines } from './line-diff.js';
import { replacementsOf, linesEqual, applyWithin } from './replacements.js';
import type { Replacement } from './replacements.js';

/** Sentinel base index for an exhausted change list: larger than any valid line index so it never wins the Math.min in groupStart selection. */
const EXHAUSTED: number = Number.MAX_SAFE_INTEGER;

export type MergeHunkKind = 'stable' | 'mine' | 'theirs' | 'conflict';

export interface MergeHunk {
  readonly kind: MergeHunkKind;
  /** The run of lines as it was when the file was last saved. */
  readonly base: readonly string[];
  /** The run as it is in the unsaved buffer. */
  readonly mine: readonly string[];
  /** The run as it is in the file on disk. */
  readonly theirs: readonly string[];
}

export interface MergeResult {
  readonly hunks: readonly MergeHunk[];
  /** How many hunks are 'conflict' - how many questions the user has to answer. */
  readonly conflictCount: number;
}

export type HunkChoice = 'mine' | 'theirs';

/**
 * @purpose Sweeps each side's ascending replacement ranges into grouped, classified MergeHunks over the base text, taking both sides' changes without asking unless a run changed differently on both.
 * @inputs
 *   - base: string - The last-saved common ancestor document text.
 *   - mine: string - The unsaved buffer document text.
 *   - theirs: string - The file-on-disk document text.
 * @outputs MergeResult - The classified hunks and the number of conflict hunks the user must resolve.
 * @dataflow base, mine, theirs -> splitLines -> line arrays -> replacementsOf -> ascending Replacement lists -> sweep groups overlapping changes -> applyWithin reconstructs each side -> classify into a MergeHunk; trailing lines counted for conflictCount.
 * @controlflow Compute both sides' replacements -> loop while either list has a pending change -> emit stable gaps -> grow each group until no touching change remains -> reconstruct and classify each group -> advance cursor -> emit trailing stable lines -> count conflicts and return.
 */
export function mergeThreeWay(base: string, mine: string, theirs: string): MergeResult {
  const baseLines = splitLines(base);
  const mineChanges = replacementsOf(baseLines, splitLines(mine));
  const theirsChanges = replacementsOf(baseLines, splitLines(theirs));

  let cursor = 0;
  let i = 0;
  let j = 0;
  const hunks: MergeHunk[] = [];

  // Advance while either side still has a pending change to consider.
  while (i < mineChanges.length || j < theirsChanges.length) {
    // Pick the earliest pending change start, using EXHAUSTED for an exhausted list so it never wins the Math.min.
    const mineNext = i < mineChanges.length ? mineChanges[i]!.start : EXHAUSTED;
    const theirsNext = j < theirsChanges.length ? theirsChanges[j]!.start : EXHAUSTED;
    // The group begins at whichever side has the earliest pending change.
    const groupStart = Math.min(mineNext, theirsNext);

    // If there is a gap of untouched lines before the next change, emit them as a stable hunk.
    if (groupStart > cursor) {
      // Untouched lines are identical on every side, so base, mine and theirs all equal this slice.
      const gap = baseLines.slice(cursor, groupStart);
      hunks.push({ kind: 'stable', base: gap, mine: gap, theirs: gap });
      cursor = groupStart;
    } else {
      // No gap before the next change: nothing to emit as stable here.
    }

    let groupEnd = groupStart;
    const takenMine: Replacement[] = [];
    const takenTheirs: Replacement[] = [];

    // Grow the group by pulling in every pending change that touches it, repeating until no more join.
    let grew = true;
    while (grew) {
      grew = false;
      // Pull in a mine change while it overlaps the group or begins exactly where the group does.
      while (i < mineChanges.length && touches(mineChanges[i]!, groupStart, groupEnd)) {
        // Extend the group end and record this mine change before advancing the index.
        groupEnd = Math.max(groupEnd, mineChanges[i]!.end);
        takenMine.push(mineChanges[i]!);
        i++;
        grew = true;
      }
      // Pull in a theirs change while it overlaps the group or begins exactly where the group does.
      while (j < theirsChanges.length && touches(theirsChanges[j]!, groupStart, groupEnd)) {
        // Extend the group end and record this theirs change before advancing the index.
        groupEnd = Math.max(groupEnd, theirsChanges[j]!.end);
        takenTheirs.push(theirsChanges[j]!);
        j++;
        grew = true;
      }
    }

    // Reconstruct each side's version of the group from base lines and that side's collected changes.
    const hunkBase = baseLines.slice(groupStart, groupEnd);
    const hunkMine = applyWithin(baseLines, groupStart, groupEnd, takenMine);
    const hunkTheirs = applyWithin(baseLines, groupStart, groupEnd, takenTheirs);

    // Classify the group by comparing each side's reconstruction against the others.
    if (linesEqual(hunkMine, hunkTheirs)) {
      // Both sides produced identical text: nothing to ask even though both edited this run.
      hunks.push({ kind: 'stable', base: hunkBase, mine: hunkMine, theirs: hunkTheirs });
    } else if (linesEqual(hunkMine, hunkBase)) {
      // The buffer matches the baseline exactly, so only the file on disk changed this run.
      hunks.push({ kind: 'theirs', base: hunkBase, mine: hunkMine, theirs: hunkTheirs });
    } else if (linesEqual(hunkTheirs, hunkBase)) {
      // The file on disk matches the baseline exactly, so only the buffer changed this run.
      hunks.push({ kind: 'mine', base: hunkBase, mine: hunkMine, theirs: hunkTheirs });
    } else {
      // Both sides changed the run differently: this is a conflict for the user to resolve.
      hunks.push({ kind: 'conflict', base: hunkBase, mine: hunkMine, theirs: hunkTheirs });
    }

    cursor = groupEnd;
  }

  // If untouched lines remain after the last change, emit them as a final stable hunk.
  if (cursor < baseLines.length) {
    // Remaining lines were never changed by either side, so all three sides are identical here.
    const tail = baseLines.slice(cursor);
    hunks.push({ kind: 'stable', base: tail, mine: tail, theirs: tail });
  } else {
    // The cursor already reached the end of base: no trailing lines remain to emit.
  }

  const conflictCount = hunks.filter((hunk: MergeHunk): boolean => hunk.kind === 'conflict').length;

  return { hunks, conflictCount };
}

/**
 * @purpose Determines whether a pending change should join the current merge group.
 * @inputs
 *   - change: Replacement - The pending replacement to test against the group.
 *   - groupStart: number - The starting base index of the current group (inclusive).
 *   - groupEnd: number - The ending base index of the current group (exclusive).
 * @outputs boolean - True if the change overlaps the group or begins exactly where it does, false otherwise.
 * @dataflow change.start + group boundaries -> overlap and anchor checks -> boolean result.
 * @controlflow Return true when change.start is strictly before groupEnd; also return true when it equals groupStart; otherwise return false.
 *
 * The `=== groupStart` half is doing two jobs. It is what lets a pure insertion join, since an insertion
 * consumes no base line and so can never be strictly inside the span -- and two sides inserting at the same
 * base position are competing for it. It is also what lets a group's own first change join: a fresh group
 * starts with groupEnd === groupStart, so an overlap test alone would admit nothing and the sweep would spin
 * on the same change forever.
 */
function touches(change: Replacement, groupStart: number, groupEnd: number): boolean {
  // A change overlaps the group when it begins before the group's exclusive end.
  if (change.start < groupEnd) {
    // Overlap detected: the change shares base lines with the group.
    return true;
  } else if (change.start === groupStart) {
    // Anchored at the group's own start: either the change that opened the group, or an insertion competing
    // for the same position as one already in it.
    return true;
  } else {
    // Starts past the group and shares no base line with it: leave it for a later group.
    return false;
  }
}

/**
 * @purpose Reconstructs final text from a merge result by applying each hunk's chosen side, defaulting unresolved conflicts to the buffer's own lines so unsaved work is never silently discarded. resolvedText(mergeThreeWay(b, m, t), new Map()) returns the buffer's own text exactly when no hunk is 'theirs'.
 * @inputs
 *   - result: MergeResult - The classified hunks produced by mergeThreeWay.
 *   - choices: ReadonlyMap<number, HunkChoice> - Per-hunk index to a user choice; entries may be absent for conflicts.
 * @outputs string - The fully resolved text with each hunk expanded to its chosen side's lines.
 * @dataflow result.hunks + choices -> forEach over hunks -> per-hunk line selection -> out array -> joinLines -> final text.
 * @controlflow Iterate hunks in order -> take theirs for 'theirs' hunks, the user's or default choice for conflicts, and mine otherwise -> concatenate all chosen lines -> return joined text.
 */
export function resolvedText(result: MergeResult, choices: ReadonlyMap<number, HunkChoice>): string {
  const out: string[] = [];

  result.hunks.forEach((hunk: MergeHunk, index: number): void => {
    // Classify each hunk to decide which side's lines contribute to the resolved output.
    if (hunk.kind === 'theirs') {
      // Only the file on disk changed this run: take theirs and discard the buffer's version.
      for (const line of hunk.theirs) {
        out.push(line);
      }
    } else if (hunk.kind === 'conflict') {
      // A missing choice must never silently discard the user's unsaved work, so the buffer's own text is
      // the fallback. The dialog always supplies a choice; the fallback exists so a caller that forgets one
      // loses nothing rather than losing the user's edits.
      if (choices.get(index) === 'theirs') {
        // The user explicitly chose theirs for this conflict: take the file-on-disk version.
        for (const line of hunk.theirs) {
          out.push(line);
        }
      } else {
        // No explicit theirs choice, a missing entry included: keep the buffer's own text.
        for (const line of hunk.mine) {
          out.push(line);
        }
      }
    } else {
      // 'stable' and 'mine'. For 'stable' the two sides agree so either serves, and using mine for both
      // keeps this one rule rather than two.
      for (const line of hunk.mine) {
        out.push(line);
      }
    }
  });

  return joinLines(out);
}
