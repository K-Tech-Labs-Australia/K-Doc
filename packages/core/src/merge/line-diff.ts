/**
 * @file line-diff.ts
 * @purpose Implements line-based text splitting, joining, and Myers diffing for K-Doc three-way merge (FR-6.4). Line endings are never normalised (FR-6.6): splitting on LF retains any trailing CR so CRLF files survive merges byte-for-byte. The lossless invariant joinLines(splitLines(t)) === t holds for every string t, including empty strings and strings with trailing newlines.
 * @inputs Raw text strings for splitting; readonly arrays of line strings for joining and line-by-line diffing.
 * @outputs Readonly arrays of split line strings; concatenated text strings; readonly arrays of LineOp edit operations (keep, insert, delete).
 * @functions
 *   - splitLines: Splits text on LF without stripping CR, preserving exact line ending bytes.
 *   - joinLines: Joins line arrays on LF, inverting splitLines losslessly.
 *   - diffLines: Computes the minimal sequence of LineOp operations transforming before into after via Myers greedy diff.
 * @dataflow Text strings -> splitLines -> line arrays -> diffLines (Myers greedy graph search + trace backtrack) -> LineOp array; line arrays -> joinLines -> reconstructed text.
 * @controlflow splitLines splits on '\n' -> joinLines joins on '\n' -> diffLines builds diagonal vectors across edit depths d, traces furthest-reaching paths, and backtracks trace to emit minimal keep/insert/delete operations.
 * @version 2
 * @date 2026-09-16
 */

/** What a diff step does to one line. */
export type LineOpKind = 'keep' | 'insert' | 'delete';

/** One step of a line diff. */
export interface LineOp {
  readonly kind: LineOpKind;
  /** Index into the `before` lines, or -1 for an 'insert'. */
  readonly beforeIndex: number;
  /** Index into the `after` lines, or -1 for a 'delete'. */
  readonly afterIndex: number;
}

// Sentinel index indicating that an inserted line has no beforeIndex or a deleted line has no afterIndex.
const NO_LINE_INDEX = -1;

/**
 * @purpose Splits a text string into an array of lines on LF ('\n') only, without stripping CR ('\r').
 * @inputs text: string - The raw input text to split.
 * @outputs readonly string[] - The array of line strings partitioned strictly by LF.
 * @dataflow text -> text.split('\n') -> readonly array of lines preserving any trailing CR characters.
 * @controlflow Splits input text on newline character '\n' and returns the resulting line array.
 */
export function splitLines(text: string): readonly string[] {
  // Split on LF only; CR ('\r') is retained as part of each line to preserve CRLF endings byte-for-byte (FR-6.6).
  return text.split('\n');
}

/**
 * @purpose Joins an array of line strings into a single string using LF ('\n') delimiters.
 * @inputs lines: readonly string[] - The array of lines to concatenate.
 * @outputs string - The concatenated string joined by LF.
 * @dataflow lines -> lines.join('\n') -> concatenated string.
 * @controlflow Joins line array elements using newline delimiter '\n' and returns the resulting string.
 */
export function joinLines(lines: readonly string[]): string {
  // Join lines with LF delimiter, exactly inverting splitLines so joinLines(splitLines(t)) === t.
  return lines.join('\n');
}

/**
 * @purpose Backtracks through the Myers diff search trace to reconstruct the sequence of line edit operations.
 * @inputs
 *   - trace: readonly Int32Array[] - Array of diagonal vector snapshots saved at each edit distance d.
 *   - n: number - Total line count in the before sequence.
 *   - m: number - Total line count in the after sequence.
 *   - max: number - Sum of n and m, defining the diagonal offset in each vector snapshot.
 * @outputs readonly LineOp[] - The minimal sequence of keep, insert, and delete operations transforming before into after.
 * @dataflow trace + dimensions -> walks backwards from d = trace.length - 1 down to 0 -> pushes ops in reverse -> reverses and returns ops.
 * @controlflow Outer loop steps backward through search depths d -> identifies predecessor diagonal and step direction -> emits kept lines along snake -> emits insertion or deletion for d > 0 -> reverses array to restore forward sequence.
 */
function backtrackTrace(
  trace: readonly Int32Array[],
  n: number,
  m: number,
  max: number,
): readonly LineOp[] {
  const ops: LineOp[] = [];
  let x = n;
  let y = m;

  // Trace backward through search depths d from trace.length - 1 down to 0 to reconstruct edit path.
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d]!;
    const k = x - y;

    // Decide which move reached this diagonal, mirroring the forward pass exactly.
    // Move down (take from after, an insert) when k === -d, or when k !== d and vPrev[k - 1 + max]! < vPrev[k + 1 + max]!.
    // Otherwise move right (take from before, a delete).
    const down = k === -d || (k !== d && vPrev[k - 1 + max]! < vPrev[k + 1 + max]!);

    // Predecessor diagonal: diagonal k+1 if move was down, or diagonal k-1 if move was right.
    const kPrev = down ? k + 1 : k - 1;
    const xStart = vPrev[kPrev + max]!;

    // Compute endpoint of the edit move before following any diagonal snake:
    // If moving down, x matches xStart; if moving right, x stepped right from xStart to xStart + 1.
    const xMid = down ? xStart : xStart + 1;
    const yMid = xMid - k;

    // Emit the snake (equal lines) this move ended with, walking backwards until (xMid, yMid).
    while (x > xMid && y > yMid) {
      // Both x and y remain above the snake start: step back one line on both sequences and emit keep operation.
      x--;
      y--;
      ops.push({ kind: 'keep', beforeIndex: x, afterIndex: y });
    }

    // Check whether d > 0 to emit the single insert or delete operation performed at this step.
    if (d > 0) {
      // Check whether this edit step was a vertical move (down/insert) or horizontal move (right/delete).
      if (down) {
        // Downward move: decrement y and emit an insert operation for the line taken from after.
        y--;
        ops.push({ kind: 'insert', beforeIndex: NO_LINE_INDEX, afterIndex: y });
      } else {
        // Rightward move: decrement x and emit a delete operation for the line taken from before.
        x--;
        ops.push({ kind: 'delete', beforeIndex: x, afterIndex: NO_LINE_INDEX });
      }
    } else {
      // At d = 0, origin (0, 0) has been reached and no edit step was performed.
    }
  }

  // Reverse ops array so edit operations run in forward order from start to end of text.
  ops.reverse();
  return ops;
}

/**
 * @purpose Computes a minimal line-by-line edit script transforming before into after using Myers diff algorithm.
 * @inputs
 *   - before: readonly string[] - The array of lines in the baseline text.
 *   - after: readonly string[] - The array of lines in the modified text.
 * @outputs readonly LineOp[] - The minimal sequence of keep, insert, and delete operations.
 * @dataflow before and after line arrays -> Myers diagonal search across edit depths d -> edit trace -> backtrackTrace -> LineOp array.
 * @controlflow Initialize diagonal vector and trace -> loop d from 0 to max -> loop k from -d to d stepping by 2 -> select move direction -> follow matching snake -> test for completion -> backtrack and return upon reaching (n, m); throw if loop finishes without completion.
 */
export function diffLines(
  before: readonly string[],
  after: readonly string[],
): readonly LineOp[] {
  // Greedy LCS/SES, Myers 1986, "An O(ND) Difference Algorithm and Its Variations", section 2.
  // http://www.xmailserver.org/diff2.pdf
  const n = before.length;
  const m = after.length;

  const max = n + m;
  // One slot past 2 * max: at d = 0 the first move reads diagonal k + 1, which for two empty inputs (max = 0) is index 1.
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];

  // Iterate over edit distances d from 0 to max inclusive.
  for (let d = 0; d <= max; d++) {
    // Save snapshot of v before exploring distance d so the path can be backtracked later.
    trace.push(v.slice());

    // Iterate over diagonals k from -d to d in steps of 2.
    for (let k = -d; k <= d; k += 2) {
      // Choose to move down or right.
      // Move down (take from after, an insert) when k === -d, or when k !== d and v[k - 1 + max]! < v[k + 1 + max]!.
      // Otherwise move right (take from before, a delete).
      const down = k === -d || (k !== d && v[k - 1 + max]! < v[k + 1 + max]!);

      // If moving down, inherit furthest x from diagonal k+1; if moving right, step right from diagonal k-1.
      let x = down ? v[k + 1 + max]! : v[k - 1 + max]! + 1;
      let y = x - k;

      // Follow diagonal snake while corresponding lines in before and after match.
      while (x < n && y < m && before[x] === after[y]) {
        // Matching line encountered: advance both coordinates along diagonal.
        x++;
        y++;
      }

      v[k + max] = x;

      // Check whether the search has reached the bottom-right corner of the edit graph (n, m).
      if (x >= n && y >= m) {
        // Edit path reached end of both sequences: backtrack the trace to produce the edit script.
        return backtrackTrace(trace, n, m, max);
      } else {
        // Destination not yet reached: continue search on remaining diagonals.
      }
    }
  }

  // The edit distance cannot exceed n + m for finite sequences; reaching here indicates an invariant violation.
  throw new Error('Myers diff failed to find an edit script: search space exhausted');
}
