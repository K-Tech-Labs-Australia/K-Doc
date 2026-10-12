/**
 * @file diff-edit.test.ts
 * @purpose Vitest suite covering the single-range text-diff helpers in ./diff-edit.js: commonPrefixLength, commonSuffixLength, and diffEdit. It asserts each edit shape directly and includes a round-trip check that applying reported edits reproduces `after`.
 * @inputs RecordedEdit-producing functions imported from ./diff-edit.js; before/after string pairs spanning insertion, deletion, replacement, boundary, overlap, and empty-string cases.
 * @outputs Zero or more Vitest assertions (expect) per scenario; the suite fails when any diff output diverges from its expected edit set or a round-trip reconstruction does not equal `after`.
 * @functions
 *   - describe: Groups all tests under 'diff-edit' plus dedicated blocks for commonPrefixLength and commonSuffixLength.
 *   - it: Runs one scenario with one or more assertions, failing on the first mismatched expectation.
 *   - applyEdits: Reconstructs `after` from `before` and the reported edits so a test can prove they faithfully describe the transition.
 * @dataflow before/after pairs → diffEdit/commonPrefixLength/commonSuffixLength produce edit sets or counts → expect compares against expected values; round-trip applies each edit back onto before to compare with after.
 * @controlflow For each scenario compute outputs and assert equality or structural properties; skip the no-change case via early return in diffEdit; iterate over [before, after] pairs in the round trip applying delete-then-insert order.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { commonPrefixLength, commonSuffixLength, diffEdit } from './diff-edit.js';

/**
 * @purpose Narrows a possibly-undefined value so noUncheckedIndexedAccess does not flag reads on array elements.
 * @inputs value - A value of type T | undefined, typically an element read such as `edits[0]`.
 * @outputs void; narrows via an assertion signature so the caller may safely dereference the local.
 * @dataflow value -> expect(...).not.toBeUndefined() -> control-flow narrowing for the caller.
 * @controlflow Fails the test when the value is undefined, otherwise returns and leaves it narrowed.
 */
function assertDefined<T>(value: T | undefined): asserts value is T {
  expect(value).not.toBeUndefined();
}

/**
 * @purpose Reconstructs `after` from `before` plus the edits reported by diffEdit, proving the edits faithfully describe the transition rather than merely looking plausible.
 * @inputs before - The original document text; edits - The RecordedEdit array produced for this pair.
 * @outputs string - The document obtained by applying each edit's insertion and removal at its reported offset in sequence.
 * @dataflow For each edit splice the working buffer: an insert contributes `text` before position p while a delete drops removedLength characters starting at p, progressively rebuilding output that ends equal to after.
 * @controlflow Initialise out as before; iterate edits with per-kind branching (insert splices text in, delete trims chars); return the final string for comparison against after.
 */
function applyEdits(
  before: string,
  edits: readonly { kind: string; text: string; at: number }[],
): string {
  let out = before; // Start from the original document and mutate it as each edit is applied in order.
  for (const e of edits) {
    if (e.kind === 'insert') {
      // An insert contributes its text at offset p without removing anything: splice inserts before p, leaving everything after shifted right by inserted.length.
      const inserted = e.text; // Characters that appear in `after` but not in `before`.
      out = out.slice(0, e.at) + inserted + out.slice(e.at);
    } else {
      // A delete removes removedLength characters starting at offset p and contributes nothing to the output.
      const removedLength = e.text.length; // Width of the deleted region in `before`.
      out = out.slice(0, e.at) + out.slice(e.at + removedLength);
    }
  }
  return out; // Rebuilt document that must equal after for the edits to be faithful.
}

describe('diff-edit', () => {
  it('no change yields nothing', () => {
    // Identical text means no edit occurred, so diffEdit returns an empty array rather than a spurious operation.
    expect(diffEdit('same', 'same')).toEqual([]);
  });

  it('a pure insertion is one insert at the divergence point', () => {
    // Inserting between two shared characters yields exactly one insert carrying only the new text and its offset in `after`.
    expect(diffEdit('The fox', 'The quick fox')).toEqual([
      { kind: 'insert', text: 'quick ', at: 4 },
    ]);
  });

  it('a pure deletion is one delete of the removed region', () => {
    // Removing a run between two shared characters yields exactly one delete carrying only the dropped text and its seam offset.
    expect(diffEdit('The quick fox', 'The fox')).toEqual([
      { kind: 'delete', text: 'quick ', at: 4 },
    ]);
  });

  it('a replacement emits deletion first then insertion sharing one offset', () => {
    // Replacing a run produces both operations; the delete is emitted before the insert so a reader sees removed text before what replaced it.
    const edits = diffEdit('The quick fox', 'The slow fox');
    const first = edits[0];
    const second = edits[1];
    assertDefined(first);
    assertDefined(second);
    expect(first.kind).toBe('delete');
    expect(second.kind).toBe('insert');
    // Both share offset p because the deletion has no width in `after`: the insert occupies [p, p + added.length) and the delete leaves its seam at p.
    expect(first.at).toBe(second.at);
  });

  it('appending at the end is one insert after the shared prefix', () => {
    // When only trailing characters are new, the whole addition lands as a single insert positioned right past the common prefix.
    expect(diffEdit('abc', 'abcdef')).toEqual([
      { kind: 'insert', text: 'def', at: 3 },
    ]);
  });

  it('deleting from the start is one delete beginning at offset zero', () => {
    // When only leading characters are dropped, a single delete spans them starting at position 0 with no shared prefix.
    expect(diffEdit('abcdef', 'def')).toEqual([
      { kind: 'delete', text: 'abc', at: 0 },
    ]);
  });

  it('the prefix and suffix must not overlap on repeated characters', () => {
    // Without the suffix bound the same trailing character would also be counted as part of the prefix, double-counting it and reporting a nonsensical range.
    const edits = diffEdit('aa', 'aaa');
    expect(edits).toHaveLength(1);
    const only = edits[0];
    assertDefined(only);
    expect(only.text).toBe('a'); // A single inserted character: one from `after` beyond the matched prefix, nothing removed.
  });

  it('round trip applies reported edits to reproduce after', () => {
    // This is the test that matters: for each pair the reconstructed document must equal `after`, proving the edits describe the transition rather than merely looking plausible.
    const pairs: readonly [string, string][] = [
      ['The fox', 'The quick fox'],
      ['The quick fox', 'The fox'],
      ['The quick fox', 'The slow fox'],
      ['', 'hello'],
      ['hello', ''],
    ];

    for (const [before, after] of pairs) {
      // Compute the edits describing this transition and rebuild `after` from them.
      const edits = diffEdit(before, after);
      expect(applyEdits(before, edits)).toBe(after);
    }
  });
});

describe('commonPrefixLength', () => {
  it('counts leading characters shared up to the shorter string', () => {
    // The match stops at whichever string is shorter or where characters first diverge.
    expect(commonPrefixLength('abcdef', 'abcxyz')).toBe(3);
    expect(commonPrefixLength('abc', 'xyz')).toBe(0);
    expect(commonPrefixLength('abc', 'abcdef')).toBe(3); // Stops at the end of the shorter string `abc`.
  });
});

describe('commonSuffixLength', () => {
  it('counts trailing characters shared past a zero skip bound', () => {
    // With no prefix already matched, all matching trailing characters are counted.
    expect(commonSuffixLength('xyzabc', 'qrsabc', 0)).toBe(3);
  });

  it('respects the skip bound so only unmatched tail is counted', () => {
    // `a` is only as long as the skip bound, so the walk never starts: every character of 'aa' is already
    // claimed by the common prefix, and counting any of them again is exactly the overlap the bound exists
    // to prevent.
    expect(commonSuffixLength('aa', 'aaa', 2)).toBe(0);

    // The same pair with no prefix claimed does match a trailing run, which is what makes the bound above
    // meaningful rather than vacuous.
    expect(commonSuffixLength('aa', 'aaa', 0)).toBe(2);
  });
});