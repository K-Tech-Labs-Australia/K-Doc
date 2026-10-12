/**
 * @file fuzzy-score.spec.ts
 * @purpose Exercises the FR-9.7/FR-9.6 fuzzy ranking implementation with Vitest, covering subsequence matching, bonus/penalty scoring, and item ranking with deterministic tie-breaking.
 * @inputs The exported `fuzzyScore`, `rankItems`, and `PickerItem` type from ../src/shell/fuzzy-score.js; local helper factories for items and scalar scores.
 * @outputs Vitest describe/it blocks asserting match results, numeric scores, matched positions, and ranked ordering.
 * @functions
 *   - item: Build a PickerItem whose id mirrors the label and whose detail defaults to an empty string.
 *   - score: Extract the numeric score from a fuzzyScore result, throwing when the query does not match.
 * @dataflow Query + text → helper factories → fuzzyScore/rankItems assertions → pass/fail per it block.
 * @controlflow Module load → define helpers → describe fuzzyScore (10 cases) → describe rankItems (8 cases).
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankItems, type PickerItem } from '../src/shell/fuzzy-score.js';

/**
 * @purpose Build a PickerItem whose id mirrors the label and whose detail defaults to an empty string.
 * @inputs label - The item's display label, also used as its opaque identity. detail - Optional human-readable detail text.
 * @outputs A new PickerItem object with id, label, and detail fields populated.
 * @dataflow label/detail parameters → object literal construction → returned PickerItem.
 * @controlflow No branching; constructs and returns a single object.
 */
function item(label: string, detail: string = ''): PickerItem {
  return { id: label, label, detail };
}

/**
 * @purpose Extract the numeric score from a fuzzyScore result for concise assertions, failing loudly on no match.
 * @inputs q - The query string passed to fuzzyScore. t - The target text passed to fuzzyScore.
 * @outputs The matched FuzzyMatch's numeric score.
 * @dataflow Query/text → fuzzyScore → m.score extraction.
 * @controlflow Call fuzzyScore; early-throw when the result is null (no subsequence match); otherwise return the score.
 */
function score(q: string, t: string): number {
  const m = fuzzyScore(q, t);
  if (m === null) throw new Error(`no match for ${q} in ${t}`);
  return m.score;
}

describe('fuzzyScore', () => {
  // Case 1a: a query that is not a subsequence of the text yields no match.
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'readme.md')).toBeNull();
  });

  // Case 1b: order matters — reversed characters are not matched out of sequence.
  it('treats character order as significant for subsequence matching', () => {
    expect(fuzzyScore('dmr', 'readme')).toBeNull();
  });

  // Case 2: case-insensitive match reports the greedy left-to-right positions.
  it('matches case-insensitively and reports matched positions', () => {
    expect(fuzzyScore('RDM', 'readme.md')?.positions).toEqual([0, 3, 4]);
  });

  // Case 3: whitespace in the query is stripped before matching.
  it('ignores whitespace within the query', () => {
    expect(fuzzyScore('re ad', 'readme')?.positions).toEqual([0, 1, 2, 3]);
  });

  // Case 4: an empty (whitespace-only) query trivially matches with a zero score.
  it('matches an empty query with a zero score and no positions', () => {
    expect(fuzzyScore('  ', 'anything')).toEqual({ score: 0, positions: [] });
  });

  // Case 5: a contiguous run of matched characters scores higher than a scattered one.
  it('rewards a contiguous run over a scattered match of equal length', () => {
    expect(score('abc', 'abcxxxxxx')).toBeGreaterThan(score('abc', 'axxbxxcxx'));
  });

  // A run must be worth clearly more than the one-character gap it avoids, or runs would not lead a ranking.
  it('values a run by more than the gap it avoids costs', () => {
    expect(score('ab', 'xabx') - score('ab', 'xaxb')).toBeGreaterThan(1);
  });

  // Case 6: starting at a word boundary scores higher than starting mid-word.
  it('rewards a word-boundary start over a mid-word start of equal length', () => {
    expect(score('b', 'a-b')).toBeGreaterThan(score('b', 'aab'));
  });

  // Case 7: a camelCase lowercase-to-uppercase transition counts as a boundary.
  it('treats a camelCase boundary as a word start', () => {
    expect(score('n', 'aN')).toBeGreaterThan(score('n', 'an'));
  });

  // Case 8: a structural slash separator counts as a boundary.
  it('counts a slash boundary as a word start', () => {
    expect(score('n', 'a/n')).toBeGreaterThan(score('n', 'aan'));
  });

  // Case 9: shorter candidate text wins when scores would otherwise tie.
  it('favors a shorter text on an equal-scoring match', () => {
    expect(score('ab', 'ab')).toBeGreaterThan(score('ab', 'abxxxxxxxx'));
  });

  // Case 10: larger gaps between matched characters cost more than smaller ones.
  it('penalizes a larger gap over an equal-length smaller gap', () => {
    expect(score('ac', 'abcxxx')).toBeGreaterThan(score('ac', 'abbbbc'));
  });
});

describe('rankItems', () => {
  // Case 11: an empty query preserves input order for the leading items with zero scores.
  it('returns the first limit items in order with zero scores on an empty query', () => {
    const items = [item('a'), item('b'), item('c')];
    const ranked = rankItems(items, '', 2);
    expect(ranked.map((r) => r.item.label)).toEqual(['a', 'b']);
    for (const entry of ranked) {
      // Empty query yields unranked entries carrying a zero score.
      expect(entry.score).toBe(0);
    }
  });

  // Case 12: a non-positive limit yields no results regardless of the query.
  it('returns an empty array for a non-positive limit', () => {
    const items = [item('a'), item('b')];
    expect(rankItems(items, 'a', 0)).toEqual([]);
    expect(rankItems(items, '', -1)).toEqual([]);
  });

  // Case 13: items matching neither label nor detail are dropped from the ranking.
  it('drops items that match neither label nor detail', () => {
    const items = [item('notes.md', 'docs/notes.md'), item('todo.md', 'todo.md')];
    expect(rankItems(items, 'nts', 10).map((r) => r.item.label)).toEqual(['notes.md']);
  });

  // A weaker label match still leads a stronger detail-only match, because what a row is called matters most.
  it('weights a label match above an equally strong detail match', () => {
    const items = [item('notes', 'setup'), item('my setup file', 'zzz')];
    expect(rankItems(items, 'setup', 10)[0]?.item.label).toBe('my setup file');
  });

  // Case 14: a label match outranks a detail-only match and carries empty label positions.
  it('ranks a label match above a detail-only match', () => {
    const items = [item('alpha', 'guide/setup.md'), item('setup', 'other/x.md')];
    const ranked = rankItems(items, 'setup', 10);
    // The exact label match sorts first.
    expect(ranked[0]?.item.label).toBe('setup');
    // The detail-only entry is retained with no label positions but populated detail positions.
    const alpha = ranked.find((r) => r.item.label === 'alpha');
    expect(alpha).toBeDefined();
    if (alpha) {
      expect(alpha.labelPositions).toEqual([]);
      expect(alpha.detailPositions.length).toBeGreaterThan(0);
    }
  });

  // Case 15: a label match records the matched label positions and no detail positions.
  it('records label positions and empty detail positions for a label match', () => {
    const items = [item('alpha', 'guide/setup.md'), item('setup', 'other/x.md')];
    const ranked = rankItems(items, 'setup', 10);
    expect(ranked[0]?.labelPositions).toEqual([0, 1, 2, 3, 4]);
    expect(ranked[0]?.detailPositions).toEqual([]);
  });

  // Case 16: equal scores are broken deterministically by label then detail.
  it('breaks ties by label then detail', () => {
    const items = [item('zz', 'd2'), item('zz', 'd1'), item('yy', 'd9')];
    expect(rankItems(items, 'd', 10).map((r) => [r.item.label, r.item.detail])).toEqual([
      ['yy', 'd9'],
      ['zz', 'd1'],
      ['zz', 'd2'],
    ]);
  });

  // Case 17: ranking must not mutate a frozen input array.
  it('does not mutate the input array', () => {
    const items = Object.freeze([item('a'), item('b'), item('c')]);
    expect(() => rankItems(items, 'a', 10)).not.toThrow();
    // The frozen input retains its original order after ranking.
    expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
  });

  // Case 18: the result is truncated to the requested limit after ranking.
  it('respects the limit after ranking', () => {
    const items = [item('apple'), item('apricot'), item('avocado'), item('asparagus'), item('almond')];
    expect(rankItems(items, 'a', 3).length).toBe(3);
  });
});