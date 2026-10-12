/**
 * @file readability.spec.ts
 * @purpose Covers the readability measures (FR-12.6): the syllable heuristic they rest on, which words count as hard, the three formulae against worked examples, and the refusal to score text there is not enough of.
 * @inputs short English words and sentences with known counts.
 * @outputs assertions over countSyllables, isComplexWord and readability.
 * @functions
 *   - countSyllables: verifies the vowel-cluster, silent-e and minimum-syllable heuristic.
 *   - isComplexWord: verifies the three-syllable complexity threshold and suffix handling.
 *   - readability: verifies null refusal, formula arithmetic and metric ordering.
 * @dataflow text -> readability -> assertions.
 * @controlflow one describe per exported function; each it guards a single behaviour of that function.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import {
  COMPLEX_WORD_SYLLABLES,
  countSyllables,
  documentProse,
  isComplexWord,
  readability,
} from '../src/analysis/readability.js';

describe('countSyllables', () => {
  // Guards that a cluster of vowels counts as a single syllable rather than one per vowel.
  it('counts a run of vowels as one syllable', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('queue')).toBe(1);
    expect(countSyllables('table')).toBe(2);
    expect(countSyllables('reading')).toBe(2);
  });

  // Guards the silent-final-e deletion rule.
  it('drops a silent final e', () => {
    expect(countSyllables('make')).toBe(1);
    expect(countSyllables('hope')).toBe(1);
  });

  // Guards the exception where a final e is sounded after a vowel pair and must not be dropped.
  it('keeps a final e that is sounded after a vowel', () => {
    // "agree" and "idea" end in a vowel pair that is said, so the e is not silent.
    expect(countSyllables('agree')).toBe(2);
  });

  // Guards the floor of one syllable per written word so formulae never divide by too small a total.
  it('gives every written word at least one syllable', () => {
    // A word made only of consonants is still said once; returning zero would make the formulae divide
    // by a total that is too small and report the text as easier than it is.
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1);
    expect(countSyllables('nth')).toBe(1);
  });

  // y carries a syllable of its own in plenty of English words. Leaving it out of the vowels undercounts
  // every word that ends in one, which is a great many.
  it('treats y as a vowel', () => {
    expect(countSyllables('very')).toBe(2);
    expect(countSyllables('happy')).toBe(2);
  });

  // Guards punctuation surrounding a word being ignored before syllable counting.
  it('ignores punctuation around a word', () => {
    expect(countSyllables('"Hello,"')).toBe(countSyllables('hello'));
  });

  // Guards that non-word input yields zero syllables rather than an accidental count.
  it('has nothing to count in something that is not a word', () => {
    expect(countSyllables('')).toBe(0);
    expect(countSyllables('—')).toBe(0);
    expect(countSyllables('123')).toBe(0);
  });
});

describe('isComplexWord', () => {
  // Guards that a word of three or more syllables is flagged as complex.
  it('counts a word of three syllables or more', () => {
    expect(isComplexWord('important')).toBe(true);
    expect(isComplexWord('readability')).toBe(true);
  });

  // Guards that short words fall below the complexity threshold.
  it('does not count a short word', () => {
    expect(isComplexWord('simple')).toBe(false);
    expect(isComplexWord('word')).toBe(false);
  });

  // Guards that a familiar suffix does not by itself make a word complex.
  it('does not count a word made long only by a familiar ending', () => {
    // Gunning excludes these deliberately: "created" is not a hard word, it is "create" with an ending.
    expect(isComplexWord('created')).toBe(false);
    expect(isComplexWord('changes')).toBe(false);
    // "remaining" is three syllables only because of the ending; "remain" is two, so it is not hard.
    expect(countSyllables('remaining')).toBe(3);
    expect(isComplexWord('remaining')).toBe(false);
  });

  // Guards that the predicate agrees with the COMPLEX_WORD_SYLLABLES threshold it is defined by.
  it('agrees with the threshold it is defined by', () => {
    expect(COMPLEX_WORD_SYLLABLES).toBe(3);
    expect(isComplexWord('banana')).toBe(countSyllables('banana') >= COMPLEX_WORD_SYLLABLES);
  });

  // Guards that non-word input is never reported as complex.
  it('is not complex when there is no word there', () => {
    expect(isComplexWord('')).toBe(false);
    expect(isComplexWord('!!!')).toBe(false);
  });
});

describe('documentProse', () => {
  // The heading's hashes and the emphasis markers are markup, not words.
  it('keeps the words and drops the markup', () => {
    const prose = documentProse('# A Title\n\nSome **bold** text here.\n');
    expect(prose).toContain('A Title');
    expect(prose).toContain('bold');
    expect(prose).not.toContain('#');
    expect(prose).not.toContain('**');
  });

  // A link is read as its label. Its address is one very long word of nonsense syllables, and counting
  // it makes a page with three links score as harder than legal boilerplate.
  it('reads a link as its words, not its address', () => {
    const prose = documentProse('See [the guide](https://example.com/very/long/path/indeed).\n');
    expect(prose).toContain('the guide');
    expect(prose).not.toContain('example.com');
  });

  // Nobody reads a code block aloud, and its identifiers would be counted as enormous words.
  it('leaves code out', () => {
    const prose = documentProse('Text here.\n\n```js\nconst unreadableIdentifier = 1;\n```\n\nMore text.\n');
    expect(prose).toContain('Text here.');
    expect(prose).toContain('More text.');
    expect(prose).not.toContain('unreadableIdentifier');
  });

  // One paragraph ending and the next beginning are not one word. Run them together and "two.Three"
  // counts once instead of twice, and every count built on it is wrong.
  it('keeps one block from running into the next', () => {
    const prose = documentProse('One two.\n\nThree four.\n');
    expect(prose).not.toContain('two.Three');
    expect(readability('One two.\n\nThree four.\n')).toEqual(readability('One two. Three four.\n'));
  });

  // Front matter is metadata about the document, not part of it.
  it('leaves front matter out', () => {
    const prose = documentProse('---\ntitle: Something\n---\n\nThe body.\n');
    expect(prose).toContain('The body.');
    expect(prose).not.toContain('title:');
  });

  // A document that is nothing but markup has no prose to measure, and so no score.
  it('has nothing to measure in a document of pure markup', () => {
    expect(documentProse('```js\nlet x = 1;\n```\n').trim()).toBe('');
    expect(readability('```js\nlet x = 1;\n```\n')).toBe(null);
  });

  // The whole point: markup that is not read must not change the score. A heading is read, so it counts
  // as the words it is; a code block and a link's address are not, so they must count for nothing.
  it('scores the writing rather than the source', () => {
    const prose = 'The cat sat on the mat. The dog ran away.\n';
    const withCode = `${prose}\n\`\`\`js\nconst unpronounceableIdentifier = 1;\n\`\`\`\n`;
    const withLink = 'The cat sat on the [mat](https://example.com/a/very/long/address). The dog ran away.\n';

    const plainEase = readability(prose)?.fleschReadingEase ?? 0;
    expect(readability(withCode)?.fleschReadingEase).toBeCloseTo(plainEase, 5);
    expect(readability(withLink)?.fleschReadingEase).toBeCloseTo(plainEase, 5);
  });
});

describe('readability', () => {
  // Guards that unmeasurable text yields null rather than a misleading numeric score.
  it('has no score for text it cannot measure', () => {
    // A score computed by dividing by zero would print as a number and be believed.
    expect(readability('')).toBe(null);
    expect(readability('   ')).toBe(null);
    expect(readability('no terminator here')).toBe(null);
  });

  // Guards that all three metrics agree on which of an easy and a dense sentence is harder.
  it('scores a plain sentence as easy and a dense one as hard', () => {
    const easy = readability('The cat sat on the mat.');
    const hard = readability('Subsequent institutional accommodation necessitates comprehensive reconsideration.');
    expect(easy).not.toBe(null);
    expect(hard).not.toBe(null);
    // Higher reading ease means easier; higher grade and fog mean harder. All three must agree about
    // which of these two sentences is the difficult one, or one of the formulae is wrong.
    expect(easy?.fleschReadingEase).toBeGreaterThan(hard?.fleschReadingEase ?? 0);
    expect(easy?.fleschKincaidGrade).toBeLessThan(hard?.fleschKincaidGrade ?? 0);
    expect(easy?.gunningFog).toBeLessThan(hard?.gunningFog ?? 0);
  });

  // Guards the arithmetic of the Flesch and Flesch-Kincaid formulae against a worked example.
  it('matches the published formulae on a worked example', () => {
    // Six words, one sentence. The syllables are counted by the heuristic above, so the expectation is
    // written in terms of it rather than as a literal: what is being checked is the arithmetic.
    const text = 'The cat sat on the mat.';
    const scores = readability(text);
    const words = 6;
    const sentences = 1;
    const syllables = scores?.syllables ?? 0;
    expect(scores?.fleschReadingEase).toBeCloseTo(206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words), 5);
    expect(scores?.fleschKincaidGrade).toBeCloseTo(0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59, 5);
  });

  // Guards that the underlying counts feeding the scores are exposed and non-trivial for real text.
  it('reports the counts the scores were built from', () => {
    const scores = readability('Important considerations require careful thought.');
    expect(scores?.complexWords).toBeGreaterThan(0);
    expect(scores?.syllables).toBeGreaterThan(5);
  });

  // Guards that sentence length increases difficulty when everything else is held equal.
  it('says longer sentences are harder, all else equal', () => {
    const short = readability('Dogs run. Cats sleep. Birds sing.');
    const long = readability('Dogs run and cats sleep and birds sing and the whole garden is busy all day.');
    expect(short?.fleschKincaidGrade).toBeLessThan(long?.fleschKincaidGrade ?? 0);
  });

  // The same words split into more sentences are easier to read. This is the whole reason the formulae
  // divide by the sentence count rather than using the word count on its own.
  it('says the same words are easier in more sentences', () => {
    const one = readability('Dogs run and cats sleep today.');
    const two = readability('Dogs run. And cats sleep today.');
    expect(one?.fleschKincaidGrade).toBeGreaterThan(two?.fleschKincaidGrade ?? 0);
    expect(one?.fleschReadingEase).toBeLessThan(two?.fleschReadingEase ?? 0);
  });
});
