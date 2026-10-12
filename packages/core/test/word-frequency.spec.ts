/**
 * @file word-frequency.spec.ts
 * @purpose Covers the word and phrase analysis (FR-12.8): that it counts the writing rather than the markup, leaves out the words every document is made of, reports only real repetitions, and does not fill its list with the pieces of one repeated sentence.
 * @inputs short documents with known repetitions; optional limit argument.
 * @outputs assertions over frequentWords and repeatedPhrases.
 * @functions
 *   - frequentWords: describe block exercising word counting, stop-word removal, markup exclusion, ordering, limiting, and empty input.
 *   - repeatedPhrases: describe block exercising phrase repetition detection, minimum length, fragment suppression, ordering, limiting, and markup exclusion.
 * @dataflow markdown → frequentWords / repeatedPhrases → assertions.
 * @controlflow one describe per exported function; each it guards a single behaviour with expect().
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PHRASE_WORDS,
  MIN_PHRASE_WORDS,
  STOP_WORDS,
  frequentWords,
  repeatedPhrases,
} from '../src/analysis/word-frequency.js';

describe('frequentWords', () => {
  // Guards that each word's count reflects how often it actually appears in the writing.
  it('counts the words a document actually uses', () => {
    const words = frequentWords('Otters swim. Otters dive. Otters rest.\n');
    expect(words[0]).toEqual({ word: 'otters', count: 3 });
  });

  // Guards that capitalisation is ignored so all forms of a word share one count.
  it('counts a word the same however it is capitalised', () => {
    const words = frequentWords('Otters and otters and OTTERS.\n');
    expect(words[0]?.count).toBe(3);
  });

  // Guards that common English function words are filtered out as stop-words.
  it('leaves out the words every document is made of', () => {
    // A list headed by "the" and "of" describes English, not this writing.
    const words = frequentWords('The otter and the fish and the river and the otter.\n');
    for (const entry of words) {
      expect(STOP_WORDS.has(entry.word)).toBe(false);
    }
    expect(words[0]?.word).toBe('otter');
  });

  // Guards that links and code blocks are not counted as writing.
  it('counts the writing rather than the markup', () => {
    const marked = 'The [otter](https://example.com/otter/otter/otter) swims.\n\n```js\notter = otter + 1;\n```\n';
    const words = frequentWords(marked);
    // The address and the code mention "otter" five more times; neither is writing.
    expect(words.find((entry) => entry.word === 'otter')?.count).toBe(1);
  });

  // Guards descending order by count with deterministic tie-breaking.
  it('orders by count and settles ties the same way every time', () => {
    const words = frequentWords('Zebra zebra apple apple mango.\n');
    expect(words.slice(0, 2).map((entry) => entry.word)).toEqual(['apple', 'zebra']);
    expect(words[0]?.count).toBe(2);
  });

  // A single letter is a variable or a list marker, not a word anyone is overusing. Counting them puts
  // "x" at the head of the list for any document with a little algebra in it.
  it('does not count single letters as words', () => {
    const words = frequentWords('Solve for x. Then x again, and x once more.\n');
    expect(words.some((entry) => entry.word === 'x')).toBe(false);
    expect(words.some((entry) => entry.word === 'solve')).toBe(true);
  });

  // Guards that the optional limit caps how many entries are returned.
  it('shows no more than it was asked for', () => {
    const words = frequentWords('alpha beta gamma delta epsilon.\n', 2);
    expect(words).toHaveLength(2);
  });

  // Guards that empty or markup-only documents yield an empty list.
  it('has nothing to say about an empty document', () => {
    expect(frequentWords('')).toEqual([]);
    expect(frequentWords('# \n\n```js\nx = 1;\n```\n')).toEqual([]);
  });
});

describe('repeatedPhrases', () => {
  // Guards that a multi-word phrase used twice is detected.
  it('finds a phrase the writer used twice', () => {
    const text = 'It was at the end of the day. Later, at the end of the day, it rained.\n';
    const phrases = repeatedPhrases(text);
    expect(phrases[0]?.phrase).toContain('at the end of the day');
    expect(phrases[0]?.count).toBe(2);
  });

  // Guards that a phrase used only once is never reported.
  it('says nothing about a phrase used once', () => {
    expect(repeatedPhrases('Every single word here appears exactly one time only.\n')).toEqual([]);
  });

  // Guards against listing fragments of a longer phrase already reported.
  it('does not list the pieces of a phrase it has already reported', () => {
    // Without this, one repeated sentence fills the whole list with its own fragments.
    const text = 'The quick brown fox jumps over. The quick brown fox jumps over.\n';
    const phrases = repeatedPhrases(text);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]?.words).toBe(MAX_PHRASE_WORDS);
  });

  // Guards that repetitions shorter than the minimum length are ignored.
  it('does not report a repetition shorter than a habit', () => {
    // Two words repeating is a coincidence; three is a pattern. Written against the number rather than
    // the constant, so lowering the threshold is a change this test notices.
    expect(MIN_PHRASE_WORDS).toBe(3);
    expect(repeatedPhrases('Red car here. Red car there.\n')).toEqual([]);

    const phrases = repeatedPhrases('The red car here. The red car there.\n');
    for (const entry of phrases) {
      expect(entry.words).toBeGreaterThanOrEqual(MIN_PHRASE_WORDS);
    }
  });

  // Two phrases repeated the same number of times are not equally interesting: a six-word repetition is
  // a sentence the writer reused, a three-word one is a turn of phrase.
  it('puts the longer phrase first when two repeat equally often', () => {
    // Separate paragraphs, so a window cannot run from the end of one into the start of the next and
    // turn the short repetition into a long one by accident.
    const text = [
      'alpha beta gamma delta epsilon zeta.',
      'alpha beta gamma delta epsilon zeta.',
      'red one two three blue.',
      'green one two three yellow.',
    ].join('\n\n');
    const phrases = repeatedPhrases(text);
    expect(phrases[0]?.count).toBe(2);
    expect(phrases[1]?.count).toBe(2);
    expect(phrases[0]?.words).toBeGreaterThan(phrases[1]?.words ?? 99);
  });

  // Guards that the most frequently repeated phrase is returned first.
  it('puts the most repeated phrase first', () => {
    const text = [
      'on the other hand it rained.',
      'on the other hand it snowed.',
      'on the other hand it hailed.',
      'as a matter of fact yes.',
      'as a matter of fact no.',
    ].join(' ');
    const phrases = repeatedPhrases(text);
    expect(phrases[0]?.count).toBe(3);
    expect(phrases[0]?.phrase).toContain('on the other hand');
  });

  // Guards that code blocks are not counted as writing for phrase detection.
  it('counts the writing rather than the markup', () => {
    const marked = 'Some words here.\n\n```js\nrepeat this exact line;\nrepeat this exact line;\n```\n';
    expect(repeatedPhrases(marked)).toEqual([]);
  });

  // Guards that the optional limit caps how many phrases are returned.
  it('shows no more than it was asked for', () => {
    const text = 'one two three four. one two three four. five six seven eight. five six seven eight.\n';
    expect(repeatedPhrases(text, 1)).toHaveLength(1);
  });
});
