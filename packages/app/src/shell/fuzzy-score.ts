/**
 * @file fuzzy-score.ts
 * @purpose Implements FR-9.7 Quick Open and FR-9.6 Go To picker item ranking via case-insensitive subsequence fuzzy matching with bonus/penalty scoring.
 * @inputs Query string, a readonly array of PickerItem candidates (for rankItems), and a numeric result limit.
 * @outputs A FuzzyMatch from fuzzyScore; a frozen array of RankedItem objects from rankItems.
 * @functions
 *   - fuzzyScore: Case-insensitive greedy subsequence match producing a score and matched positions, or null on no full match.
 *   - rankItems: Score each item's label (weighted) then detail, sort by descending score with deterministic tie-breaks, and truncate to the limit.
 * @dataflow Query → whitespace-stripped needle → left-to-right text scan → positions + bonus/penalty score → per-item RankedItem assembly → stable sort → truncated frozen output.
 * @controlflow Validate query; early-return zero-score match on empty needle; scan for subsequence and early-return null if incomplete; accumulate score; rank items, skip unmatched, sort, truncate; early returns on non-positive limit and empty query.
 * @version 1
 * @date 2026-09-13
 */

// Boundary bonus awarded when a match starts at the text start, after a separator, or across a camelCase transition.
const BOUNDARY_BONUS = 5;

// Additional bonus for matches that are adjacent in the target text (a contiguous run).
const CONSECUTIVE_BONUS = 3;

// Per skipped character penalty applied between two consecutive matched positions.
const GAP_PENALTY = 0.1;

// Small penalty proportional to candidate length, favoring shorter matches.
const LENGTH_PENALTY = 0.01;

// Multiplier applied to label scores so that label matches outrank detail-only matches.
const LABEL_WEIGHT = 2;

// Structural boundary characters that award the boundary bonus when immediately preceding a match: slash, backslash, hyphen, underscore, dot, space.
const SEPARATORS: ReadonlySet<string> = new Set(['/', '\\', '-', '_', '.', ' ']);

export interface FuzzyMatch {
  readonly score: number;
  /** Indices into the matched text of each matched character, ascending. */
  readonly positions: readonly number[];
}

export interface PickerItem {
  /** Opaque identity handed back to whoever opened the picker, e.g. a file path. */
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface RankedItem {
  readonly item: PickerItem;
  readonly score: number;
  readonly labelPositions: readonly number[];
  readonly detailPositions: readonly number[];
}

/**
 * @purpose Performs a case-insensitive greedy subsequence match of `query` against `text`, returning a score and matched positions, or null when the query is not a subsequence.
 * @inputs query - The user's search string; all whitespace is stripped before matching. text - The candidate label or detail string to scan.
 * @outputs A FuzzyMatch with the computed numeric score and an ascending frozen array of matched text indices, or null when no full subsequence match exists.
 * @dataflow Query → whitespace-stripped needle → left-to-right text scan producing positions → bonus/penalty scoring → frozen FuzzyMatch.
 * @controlflow Strip whitespace; return zero-score match on empty needle; scan for subsequence and early-return null if incomplete; accumulate score via boundary/consecutive/gap/length rules; freeze and return.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  // Remove all whitespace from the query to form a contiguous matching needle.
  const needle = query.replace(/\s+/g, '');

  // An empty (or whitespace-only) query trivially matches with a zero score and no positions.
  if (needle.length === 0) {
    return { score: 0, positions: [] };
  }

  // Greedy left-to-right subsequence scan: advance the query index only on a case-insensitive character match.
  const positions: number[] = [];
  let q = 0;
  for (let t = 0; t < text.length && q < needle.length; t += 1) {
    // Record the index and advance the query pointer when characters match case-insensitively.
    if (text.charAt(t).toLowerCase() === needle.charAt(q).toLowerCase()) {
      positions.push(t);
      q += 1;
    }
  }

  // If any query character was not consumed, the query is not a subsequence of the text.
  if (q < needle.length) {
    return null;
  }

  // Accumulate the score from base, boundary, consecutive, gap, and length components.
  let score = 0;
  // The previous matched position, or -1 before the first match.
  let prevPos = -1;
  for (const pos of positions) {
    // Award one base point per matched character.
    score += 1;

    // Only a match after the first has a gap or a run to measure against.
    if (prevPos >= 0) {
      const gap = pos - prevPos - 1;

      // Penalize the number of skipped characters between two consecutive matches.
      score -= GAP_PENALTY * gap;

      // Award a consecutive bonus when this match immediately follows the previous one in text.
      if (pos === prevPos + 1) {
        score += CONSECUTIVE_BONUS;
      }
    }

    // Read the preceding and current text characters, guarding against out-of-range reads under noUncheckedIndexedAccess.
    const prevChar = pos > 0 ? text.charAt(pos - 1) : undefined;
    const curChar = text.charAt(pos);

    if (pos === 0) {
      // The match starts at the very beginning of the text, which is a boundary.
      score += BOUNDARY_BONUS;
    } else if (prevChar !== undefined && SEPARATORS.has(prevChar)) {
      // The preceding character is a structural separator marking a boundary.
      score += BOUNDARY_BONUS;
    } else if (
      prevChar !== undefined &&
      curChar !== undefined &&
      prevChar !== prevChar.toUpperCase() &&
      curChar !== curChar.toLowerCase()
    ) {
      // The preceding character is a lowercase letter and the current character is an uppercase letter (camelCase boundary).
      score += BOUNDARY_BONUS;
    }
    prevPos = pos;
  }

  // Apply a length penalty proportional to candidate text length, favoring shorter matches.
  score -= LENGTH_PENALTY * text.length;

  // Return the computed score with a frozen ascending array of matched positions.
  return { score, positions: Object.freeze(positions) };
}

/**
 * @purpose Ranks picker items by fuzzy-matching the query against each item's label (weighted) then detail, returning the top results sorted by score.
 * @inputs items - The candidate picker items to rank. query - The user's search string used for fuzzy matching. limit - Maximum number of ranked entries to return; a non-positive value yields an empty array.
 * @outputs A frozen array of RankedItem objects (up to `limit`), ordered by descending score with deterministic tie-breaking.
 * @dataflow Query → per-item label/detail FuzzyMatch → weighted score assembly → stable sort by score then ordinal label/detail → truncation to limit.
 * @controlflow Early-return empty on non-positive limit; early-return leading items on empty query; otherwise score each item, skip unmatched entries, sort, and truncate without mutating the input.
 */
export function rankItems(items: readonly PickerItem[], query: string, limit: number): readonly RankedItem[] {
  // A non-positive limit yields no results; return an empty frozen array.
  if (limit <= 0) {
    return Object.freeze<RankedItem[]>([]);
  }

  // An empty or whitespace-only query returns the leading items unranked with zero scores, preserving input order.
  if (query.trim() === '') {
    const ranked: RankedItem[] = [];
    for (let i = 0; i < limit && i < items.length; i += 1) {
      const item = items[i];

      // The loop bounds guarantee i is within range, but noUncheckedIndexedAccess types the read as possibly undefined.
      if (item === undefined) {
        continue;
      }

      // Emit an unranked entry carrying zero score and empty position arrays.
      ranked.push({ item, score: 0, labelPositions: [], detailPositions: [] });
    }

    return Object.freeze(ranked);
  }

  // Score each item against the query via its label first, falling back to its detail when the label does not match.
  const scored: RankedItem[] = [];
  for (const item of items) {
    const label = fuzzyScore(query, item.label);

    if (label !== null) {
      // A label match is weighted higher than a detail-only match to keep label matches ranked above detail matches.
      scored.push({ item, score: label.score * LABEL_WEIGHT, labelPositions: label.positions, detailPositions: [] });
    } else {
      const detail = fuzzyScore(query, item.detail);

      if (detail !== null) {
        // No label match; fall back to a detail-only match carrying the detail positions.
        scored.push({ item, score: detail.score, labelPositions: [], detailPositions: detail.positions });
      }

      // Neither the label nor the detail matched, so the item is skipped entirely.
    }
  }

  // Order by descending score, breaking ties by ordinal label then ordinal detail for deterministic results.
  scored.sort((a, b) => {
    // Higher score ranks first; return a negative value when a outranks b.
    if (a.score > b.score) {
      return -1;
    } else if (a.score < b.score) {
      // Lower score ranks last; return a positive value when b outranks a.
      return 1;
    }

    // Scores are tied; compare labels ordinally so equal-scoring items remain deterministically ordered.
    const labelCmp = a.item.label < b.item.label ? -1 : a.item.label > b.item.label ? 1 : 0;
    if (labelCmp !== 0) {
      // Labels differ; use their ordinal comparison as the first tie-breaker.
      return labelCmp;
    }

    // Labels are also tied; compare details ordinally as the final, deterministic tie-breaker.
    return a.item.detail < b.item.detail ? -1 : a.item.detail > b.item.detail ? 1 : 0;
  });

  // Truncate to the requested limit and freeze the result so callers cannot mutate it.
  const result = scored.slice(0, limit);
  return Object.freeze(result);
}
