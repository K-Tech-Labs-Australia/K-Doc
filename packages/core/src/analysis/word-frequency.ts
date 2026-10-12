/**
 * @file word-frequency.ts
 * @purpose Finds the words and phrases a document leans on (FR-12.8): which words it uses most, and which runs of words it repeats. Both are measured on the prose, because a URL repeated in three links is not a writing habit;
 * @inputs the document's Markdown;
 * @outputs the most frequent words and the repeated phrases, longest and most repeated first;
 * @functions frequentWords, repeatedPhrases;
 * @dataflow markdown -> documentProse -> lowercased word tokens -> counts, and sliding windows -> counts;
 * @controlflow the words everyone uses are left out of the word counts, because a list headed by "the" says nothing about the writing; a phrase is reported only if it repeats, and a longer phrase hides the shorter ones inside it;
 * @version 1
 * @date 2026-09-16
 */

import { documentProse } from './readability.js';

/**
 * @purpose A single word and the number of times it appears in a document's prose.
 * @inputs None; produced by frequentWords from counted word tokens.
 * @outputs The word string and its occurrence count.
 * @dataflow Counted token -> immutable record holding that token and its tally.
 * @controlflow No control flow; a plain data carrier returned in the frequentWords list.
 */
export interface WordCount {
  readonly word: string;
  readonly count: number;
}

/**
 * @purpose A repeated run of words and how often it recurs, carrying its length so a longer repetition outranks a shorter one at the same count.
 * @inputs None; produced by repeatedPhrases from counted sliding windows.
 * @outputs The phrase text, its word span, and its occurrence count.
 * @dataflow Counted window -> immutable record holding that phrase, its span in words, and its tally.
 * @controlflow No control flow; a plain data carrier returned in the repeatedPhrases list.
 */
export interface PhraseCount {
  readonly phrase: string;
  readonly words: number;
  readonly count: number;
}

/**
 * @purpose The function words every English document is made of, excluded from frequency counts so a list headed by "the" does not describe this writing.
 * @inputs None; a static vocabulary shared across calls.
 * @outputs A read-only set of lowercase stop words matched against tokens.
 * @dataflow Static literal set -> membership test in frequentWords that drops common words.
 * @controlflow No control flow; consulted with Set.has on each token.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'she', 'so', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'were', 'what',
  'when', 'which', 'who', 'will', 'with', 'would', 'you', 'your',
]);

/**
 * @purpose The smallest window reported as a phrase, below which a repeat is treated as coincidence rather than habit.
 * @inputs None; a constant bounding the sliding-window search.
 * @outputs A lower bound on phrase length in words.
 * @dataflow Literal 3 -> loop bounds in repeatedPhrases.
 * @controlflow No control flow; used to size windows.
 */
export const MIN_PHRASE_WORDS: number = 3;

/**
 * @purpose The largest window counted as a phrase, beyond which any longer repetition is still found as its six-word head.
 * @inputs None; a constant bounding the sliding-window search.
 * @outputs An upper bound on phrase length in words.
 * @dataflow Literal 6 -> loop start value in repeatedPhrases.
 * @controlflow No control flow; used to size windows.
 */
export const MAX_PHRASE_WORDS: number = 6;

/**
 * @purpose Extracts word-like tokens from the document's prose, lowercased and language-agnostic.
 * @inputs markdown - the source Markdown to analyse.
 * @outputs An array of lowercase token strings, or an empty array when none are found.
 * @dataflow markdown -> documentProse -> lowercased text -> regex match -> token list.
 * @controlflow Match tokens against the prose; return an empty list on no match, otherwise the full match array.
 */
function tokens(markdown: string): string[] {
  const prose = documentProse(markdown).toLowerCase();
  const found = prose.match(/[\p{L}\p{N}']+/gu);
  // No matches: the prose has no word-like tokens, so return an empty list.
  if (found === null) {
    return [];
  } else {
    // At least one token matched: hand back all of them.
    return found;
  }
}

/**
 * @purpose Returns the most frequently used content words in a document's prose, ordered by descending count then alphabetical word.
 * @inputs markdown - the source Markdown to analyse; limit - maximum number of rows to return (default 20).
 * @outputs A readonly list of WordCount entries ordered by descending count then alphabetical word.
 * @dataflow markdown -> tokens -> filtered counts -> sorted slice.
 * @controlflow Iterate tokens, skipping stop words and single letters; tally the rest in a Map; sort by count desc then word asc; return the top limit rows.
 */
export function frequentWords(markdown: string, limit: number = 20): readonly WordCount[] {
  const counts = new Map<string, number>();
  for (const word of tokens(markdown)) {
    // Skip stop words and single letters; they are not content worth counting.
    if (STOP_WORDS.has(word) || word.length < 2) {
      continue;
    } else {
      // A content token: fall through to tally it below.
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const ordered = [...counts.entries()]
    .map(([word, count]): WordCount => ({ word, count }))
    .sort((left, right) => {
      // Order by descending count first.
      if (left.count !== right.count) {
        return right.count - left.count;
      } else {
        // Tie on count: break alphabetically so the list is stable between runs rather than depending on Map iteration order.
        return left.word.localeCompare(right.word);
      }
    });
  return ordered.slice(0, Math.max(0, limit));
}

/**
 * @purpose Returns runs of three to six words that recur at least twice, longest windows first so a longer repetition hides the shorter ones inside it.
 * @inputs markdown - the source Markdown to analyse; limit - maximum number of rows to return (default 20).
 * @outputs A readonly list of PhraseCount entries ordered by descending count, then length, then alphabetical phrase.
 * @dataflow markdown -> tokens -> sliding windows per size -> counts -> covered set -> sorted slice.
 * @controlflow For each window size from MAX down to MIN, tally phrases; report a phrase only if it repeats and is not already covered by a longer one; mark every sub-window of a reported phrase as covered; sort and slice.
 */
export function repeatedPhrases(markdown: string, limit: number = 20): readonly PhraseCount[] {
  const words = tokens(markdown);
  const found: PhraseCount[] = [];
  const covered = new Set<string>();

  for (let size = MAX_PHRASE_WORDS; size >= MIN_PHRASE_WORDS; size--) {
    const counts = new Map<string, number>();
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(' ');
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }

    for (const [phrase, count] of counts) {
      // A phrase seen only once is not a repetition; skip it.
      if (count < 2) {
        continue;
      } else {
        // Repeats at least twice: fall through to the coverage check below.
      }
      // Already reported as part of a longer phrase; do not list its shorter windows too.
      if (covered.has(phrase)) {
        continue;
      } else {
        // Not covered by a longer phrase: this is a genuine repeated phrase.
      }
      found.push({ phrase, words: size, count });
      for (let inner = MIN_PHRASE_WORDS; inner <= size; inner++) {
        const parts = phrase.split(' ');
        for (let start = 0; start + inner <= parts.length; start++) {
          covered.add(parts.slice(start, start + inner).join(' '));
        }
      }
    }
  }

  found.sort((left, right) => {
    // Primary order: most repeated first.
    if (left.count !== right.count) {
      return right.count - left.count;
    } else if (left.words !== right.words) {
      // Tie on count: longer phrases first, since a six-word repetition matters more than a three-word one at the same count.
      return right.words - left.words;
    } else {
      // Tie on count and length: break alphabetically for stable output.
      return left.phrase.localeCompare(right.phrase);
    }
  });
  return found.slice(0, Math.max(0, limit));
}
