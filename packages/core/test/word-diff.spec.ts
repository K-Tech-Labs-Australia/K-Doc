/**
 * @file word-diff.spec.ts
 * @purpose Unit tests for the word-level diff utilities in word-diff.js, covering tokenization, diff generation, and change counting.
 * @inputs Source and target strings to be compared; pre-built WordDiffPart arrays for the counter test.
 * @outputs Test assertions via vitest expect; no runtime values returned beyond pass/fail status.
 * @functions
 *   - sides: Reconstructs the before/after text from a diff part list.
 *   - tokenizeWords tests: Verify word/space/punctuation splitting and round-trip joining.
 *   - diffWords tests: Verify replacement, run merging, reconstruction, and empty handling.
 *   - countChangedWords tests: Verify word-only counting ignores spaces and punctuation.
 * @dataflow Source strings → diffWords/tokenizeWords/countChangedWords → WordDiffPart arrays → expect assertions.
 * @controlflow Describe blocks group each unit; each it() runs one scenario and asserts equality or reconstruction.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { countChangedWords, diffWords, tokenizeWords } from '../src/history/word-diff.js';
import type { WordDiffPart } from '../src/history/word-diff.js';

// Reconstruct the original before/after text by filtering out insert-only and delete-only parts respectively.
// @purpose Derive readable pre-change and post-change strings from a diff part list for round-trip assertions.
// @inputs parts - readonly WordDiffPart[] produced by diffWords.
// @outputs { before: string; after: string } - reconstructed text, empty string when no matching parts exist.
// @dataflow Diff parts → kind-based filtering → text concatenation → before/after pair.
// @controlflow Filter inserts out for `before`; filter deletes out for `after`; join remaining texts.
function sides(parts: readonly WordDiffPart[]): { before: string; after: string } {
  return {
    before: parts.filter((part) => part.kind !== 'insert').map((part) => part.text).join(''),
    after: parts.filter((part) => part.kind !== 'delete').map((part) => part.text).join(''),
  };
}

describe('tokenizeWords', () => {
  // Verify that words, whitespace, and punctuation are split into discrete tokens that rejoin to the original text.
  it('splits words, spaces and punctuation and joins back exactly', () => {
    const text = "# Plan\n\nDon't **stop** now, café_2!";
    expect(tokenizeWords(text)).toEqual(['#', ' ', 'Plan', '\n\n', "Don't", ' ', '*', '*', 'stop', '*', '*', ' ', 'now', ',', ' ', 'café_2', '!']);
    expect(tokenizeWords(text).join('')).toBe(text);
    expect(tokenizeWords('')).toEqual([]);
  });
});

describe('diffWords', () => {
  // Verify a single word replacement is marked delete/insert while surrounding equal text is preserved.
  it('marks a replaced word and keeps the rest equal', () => {
    expect(diffWords('The quick fox', 'The slow fox')).toEqual([
      { kind: 'equal', text: 'The ' },
      { kind: 'delete', text: 'quick' },
      { kind: 'insert', text: 'slow' },
      { kind: 'equal', text: ' fox' },
    ]);
  });

  // Verify that adjacent changes collapse into a single contiguous insert run rather than separate tokens.
  it('merges neighbouring changes into one run', () => {
    const parts = diffWords('Keep this.', 'Keep this. Added two words.');
    expect(parts).toEqual([
      { kind: 'equal', text: 'Keep this.' },
      { kind: 'insert', text: ' Added two words.' },
    ]);
  });

  // Verify that both original versions can be fully rebuilt from the diff runs via the sides() helper.
  it('rebuilds both versions from its runs', () => {
    const before = '# Title\n\nOne two three.\n\n- a\n- b\n';
    const after = '# New title\n\nOne three, four.\n\n- a\n';
    expect(sides(diffWords(before, after))).toEqual({ before, after });
  });

  // Verify diff behaviour when one or both versions are empty strings.
  it('handles empty versions', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('', 'New')).toEqual([{ kind: 'insert', text: 'New' }]);
    expect(diffWords('Old', '')).toEqual([{ kind: 'delete', text: 'Old' }]);
  });
});

describe('countChangedWords', () => {
  // Verify that only word tokens count toward inserted/deleted totals, ignoring spaces and punctuation.
  it('counts words, not spaces or punctuation', () => {
    expect(countChangedWords(diffWords('A b.', 'A c d, e!'))).toEqual({ inserted: 3, deleted: 1 });
    expect(countChangedWords([{ kind: 'equal', text: 'same words' }, { kind: 'insert', text: ' ** ' }])).toEqual({ inserted: 0, deleted: 0 });
  });
});
