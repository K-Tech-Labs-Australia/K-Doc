/**
 * @file readability.ts
 * @purpose Estimates how hard a document is to read (FR-12.6): Flesch Reading Ease, Flesch–Kincaid grade level and the Gunning fog index. All three are arithmetic over three counts — words, sentences and syllables — so the only judgement in here is how syllables are counted.
 * @inputs the document's prose
 * @outputs the three scores, or nothing when there is not enough text to say
 * @functions countSyllables — syllable count for a single word; isComplexWord — whether a word meets Gunning's hard-word threshold; readability — the three scores for a whole document.
 * @dataflow text -> words and sentences -> syllables per word -> the three formulae
 * @controlflow a text with no words or no sentences has no score rather than a made-up one, because dividing by zero would give a number that looks like an answer
 * @version 1
 * @date 2026-09-16
 */

import type { Node, Parent } from 'unist';
import { parseMarkdown } from '../parse/parser.js';
import { countSentences, countWords } from './statistics.js';

/**
 * Node types whose text is not prose and must not be measured.
 *
 * A code block is not read aloud; a URL is one enormous word of nonsense syllables; front matter is
 * metadata. Counting any of them makes a document look far harder than it reads -- a page with three
 * links can score below zero on a scale whose bottom is meant to be legal boilerplate.
 */
/**
 * Node types that end a run of prose.
 *
 * Inline text is joined with nothing between the pieces, because the pieces are already spaced as the
 * writer spaced them: "the [mat](…)." is "the ", "mat", "." and joining those with a space would put
 * one before the full stop and make it a word of its own. Blocks are a different matter -- one
 * paragraph ending and the next beginning are not one sentence -- so they are separated here.
 */
const BLOCKS: ReadonlySet<string> = new Set<string>(['paragraph', 'heading', 'listItem', 'blockquote', 'tableCell']);

/**
 * @purpose Pulls the readable prose out of a Markdown document, leaving the markup behind (FR-12.6).
 * @inputs text - The document's Markdown source.
 * @outputs string - The words a reader actually reads, separated by spaces, with sentence punctuation kept.
 * @dataflow text -> parseMarkdown -> walk the tree -> the value of every text node in it.
 * @controlflow Only `text` nodes contribute, which is what leaves the markup behind and needs no list of
 *   things to skip: a code block, an inline code span, raw HTML and front matter each keep their content
 *   in the node's own `value`, and a link keeps its address in `url`. None of those is a text node, and
 *   none of them has text children, so the walk never reaches any of it. A link's label does have text
 *   children, which is right -- the label is read and the address is not.
 */
export function documentProse(text: string): string {
  const parts: string[] = [];

  const walk = (node: Node): void => {
    // Check whether this is the text itself rather than a wrapper around it.
    if (node.type === 'text') {
      parts.push((node as unknown as { readonly value: string }).value);
    } else {
      // A wrapper: descend into whatever it holds.
    }

    const children = (node as Parent).children;
    // Check whether there is anything inside to descend into.
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child);
      }
    } else {
      // A leaf: nothing further down.
    }

    // Check whether this node ends a run of prose, so the next one does not run into it.
    if (BLOCKS.has(node.type)) {
      parts.push('\n\n');
    } else {
      // Inline: the pieces are already spaced as the writer spaced them.
    }
  };

  walk(parseMarkdown(text).root);
  return parts.join('');
}

/**
 * ReadabilityScores — the three published measures plus the two counts they are built from,
 * so a reader who distrusts a score can see what went into it.
 * @purpose The three readability scores together with the syllable and complex-word counts they are computed from, so an untrusted score can be audited against its inputs.
 * @inputs words, sentences and syllables counted from the document's prose.
 * @outputs fleschReadingEase — Flesch Reading Ease score.
 * @outputs fleschKincaidGrade — Flesch–Kincaid grade level.
 * @outputs gunningFog — Gunning fog index.
 * @outputs syllables — total syllable count across the document.
 * @outputs complexWords — number of complex (3+ syllable) words.
 * @dataflow word and sentence counts -> syllables per word and complex-word ratio -> the three formulae.
 * @controlflow No branching: a plain record exposing both scores and their underlying counts.
 */
export interface ReadabilityScores {
  readonly fleschReadingEase: number;
  readonly fleschKincaidGrade: number;
  readonly gunningFog: number;
  readonly syllables: number;
  readonly complexWords: number;
}

/**
 * COMPLEX_WORD_SYLLABLES — Gunning's definition of a hard word.
 * @purpose The syllable threshold above which a word is treated as complex for the Gunning fog index.
 * @inputs Nothing; a fixed constant from Gunning's method.
 * @outputs A word with at least this many syllables counts as complex.
 * @dataflow Constant -> compared against each word's syllable count in isComplexWord.
 * @controlflow No branching: a single numeric threshold used by isComplexWord.
 */
export const COMPLEX_WORD_SYLLABLES: number = 3;

// A run of vowels counts as one syllable; y is treated as a vowel because it carries one in
// "rhythm" and "very".
const VOWEL_GROUPS = /[aeiouy]+/g;

// Gunning excludes words made long only by a familiar ending, so "created" is not counted as hard.
const COMMON_SUFFIX = /(?:es|ed|ing)$/;

/**
 * countSyllables — English syllable counting has no exact rule short of a dictionary, and a dictionary is not worth carrying for a number shown in a dialog; this counts vowel runs, drops a silent final e, and never returns zero for a word that has letters, because every written word is said at least once. The silent-e rule is skipped after a vowel, so "agree" keeps both.
 * @purpose Counts the syllables in a single English word using a heuristic over vowel groups.
 * @inputs word — the raw token to measure; non-letter characters are ignored.
 * @outputs The number of syllables in the word (at least 1 for any word with letters, 0 for an empty result).
 * @dataflow lowercased word -> stripped of non-letters -> silent-e removed -> vowel groups counted.
 * @controlflow Returns 0 for a cleaned-empty word; returns 1 when no vowel group is found; otherwise the greater of 1 and the vowel-group count, with the silent-e rule skipped after a vowel.
 */
export function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  // A word with no letters after stripping non-alphabetic characters has no syllables to report.
  if (cleaned.length === 0) {
    return 0;
  } else {
    // The cleaned word contains at least one letter, so fall through to the syllable count below.
  }

  // A final e is usually silent, and dropping it is what turns "make" from two syllables into one. The
  // one ending it must not be dropped from is a consonant followed by le, where the l carries a syllable
  // of its own: "table" and "little" are two, not one.
  //
  // A final e after a vowel needs no exception of its own. Dropping it cannot change the count, because
  // it belongs to the same run of vowels as the letter before it: "agree" is a-gree either way.
  const silentE = cleaned.endsWith('e') && !/[^aeiouy]le$/.test(cleaned);
  const withoutSilentE = silentE ? cleaned.slice(0, -1) : cleaned;
  const groups = withoutSilentE.match(VOWEL_GROUPS);
  // A word with no vowel left to count is still said once -- "nth", or "he" with its e dropped.
  if (groups === null) {
    return 1;
  } else {
    // A match is never empty, so the number of runs is the number of syllables.
    return groups.length;
  }
}

/**
 * isComplexWord — the suffix is stripped before counting, and a word that is nothing but a suffix is counted whole rather than as nothing.
 * @purpose Decides whether a word is complex (hard) for the Gunning fog index: it has at least COMPLEX_WORD_SYLLABLES syllables after removing a common inflectional suffix.
 * @inputs word — the raw token to classify; non-letter characters are ignored.
 * @outputs true when the cleaned, suffix-stripped word meets the syllable threshold; false otherwise.
 * @dataflow lowercased word -> stripped of non-letters -> common suffix removed -> syllables counted vs threshold.
 * @controlflow Returns false for a cleaned-empty word; strips COMMON_SUFFIX before comparing so that "created" is not treated as complex purely because of its ending.
 */
export function isComplexWord(word: string): boolean {
  // Something with no letters in it has no syllables either, so it falls below the threshold without
  // needing a guard of its own.
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  const stem = cleaned.replace(COMMON_SUFFIX, '');
  return countSyllables(stem) >= COMPLEX_WORD_SYLLABLES;
}

/**
 * readability — no words or no sentences means no score; a score computed by dividing by zero would print as a number and be believed. The three formulae are the published ones and are deliberately not clamped: a grade level above 12 or an ease below zero are real answers about genuinely hard text.
 * @purpose Computes Flesch Reading Ease, Flesch–Kincaid grade level and Gunning fog for a document.
 * @inputs text — the document's prose whose words, sentences and syllables are measured.
 * @outputs ReadabilityScores when there is at least one word and one sentence; null otherwise.
 * @dataflow text -> countWords/countSentences -> per-word syllables and complex words -> the three formulae.
 * @controlflow Returns null when there are no words or no sentences (avoids dividing by zero); otherwise totals syllables and complex words across tokens and returns the three published scores plus counts.
 */
export function readability(markdown: string): ReadabilityScores | null {
  // Measured on the prose, not the source. A heading's hashes, a link's address and a code block are
  // not read, and counting them makes the formulae describe the markup rather than the writing.
  const text = documentProse(markdown);
  const words = countWords(text);
  const sentences = countSentences(text);
  // Without enough text to divide by, there is no meaningful score rather than a made-up one.
  if (words === 0 || sentences === 0) {
    return null;
  } else {
    // There is at least one word and one sentence, so the scores below are safe to compute.
  }

  let syllables = 0;
  let complexWords = 0;
  for (const token of text.trim().split(/\s+/)) {
    syllables += countSyllables(token);
    if (isComplexWord(token)) {
      complexWords += 1;
    } else {
      // The token is not complex, so it does not add to the Gunning fog complex-word total.
    }
  }

  const wordsPerSentence = words / sentences;
  const syllablesPerWord = syllables / words;

  return {
    fleschReadingEase: 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord,
    fleschKincaidGrade: 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59,
    gunningFog: 0.4 * (wordsPerSentence + 100 * (complexWords / words)),
    syllables,
    complexWords,
  };
}
