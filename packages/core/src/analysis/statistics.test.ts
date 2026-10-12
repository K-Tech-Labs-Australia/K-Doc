/**
 * @file statistics.test.ts
 * @purpose Vitest test suite for document statistics calculation engine in @k-doc/core (FR-12.5).
 *   Verifies word count parsing across whitespace and newlines, raw and trimmed character metrics,
 *   blank-line delimited paragraph identification, sentence terminator detection with decimal and
 *   abbreviation heuristics, composite analysis payloads, and reading time estimation bounds.
 * @inputs Raw test strings with whitespace variations, punctuation patterns, and multi-paragraph prose.
 * @outputs Vitest assertions verifying DocumentStatistics records and individual metric calculations.
 * @functions None.
 * @dataflow Raw text input -> statistics functions (countWords, countSentences, countParagraphs, analyzeText) -> numerical assertions.
 * @controlflow Execute test cases covering countWords, character counts, countParagraphs, countSentences, analyzeText, and WORDS_PER_MINUTE.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import {
  WORDS_PER_MINUTE,
  countWords,
  countSentences,
  countParagraphs,
  analyzeText,
} from './statistics.js';

describe('countWords', () => {
  // Pins that empty and whitespace-only strings evaluate to zero words.
  it('returns 0 for empty and whitespace-only strings', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \t\r\n  ')).toBe(0);
  });

  // Pins that standard space-separated words are counted correctly.
  it('counts space-delimited words accurately', () => {
    expect(countWords('one two three')).toBe(3);
  });

  // Pins that multiple contiguous whitespace characters are collapsed into single separators.
  it('collapses runs of whitespace', () => {
    expect(countWords('one   two     three')).toBe(3);
  });

  // Pins that words separated by newlines and carriage returns are counted across lines.
  it('counts words across newlines', () => {
    expect(countWords('one\ntwo\r\nthree')).toBe(3);
  });
});

describe('character counts', () => {
  // Pins that charactersWithSpaces measures raw string length while charactersWithoutSpaces excludes spaces, tabs, and newlines.
  it('calculates characters with and without whitespace on a mixed-whitespace string', () => {
    // String length: 5 + 1 + 5 + 1 + 3 + 1 + 3 = 19; without whitespace (space, tab, newline): 16.
    const text = 'hello world\tfoo\nbar';
    const stats = analyzeText(text);

    expect(stats.charactersWithSpaces).toBe(text.length);
    expect(stats.charactersWithSpaces).toBe(19);
    expect(stats.charactersWithoutSpaces).toBe(16);
  });
});

describe('countParagraphs', () => {
  // Pins that a single line or contiguous block of lines evaluates to one paragraph.
  it('counts a single paragraph of text', () => {
    expect(countParagraphs('One paragraph of text.')).toBe(1);
    expect(countParagraphs('Line one.\nLine two without blank line.')).toBe(1);
  });

  // Pins that two non-blank line blocks separated by a blank line count as two paragraphs.
  it('counts two paragraphs separated by a single blank line', () => {
    expect(countParagraphs('First paragraph.\n\nSecond paragraph.')).toBe(2);
  });

  // Pins that multiple contiguous blank lines between paragraphs still evaluate to exactly two paragraphs.
  it('counts two paragraphs separated by multiple blank lines', () => {
    expect(countParagraphs('First paragraph.\n\n\n\nSecond paragraph.')).toBe(2);
  });

  // Pins that leading and trailing blank lines do not add phantom paragraphs.
  it('ignores leading and trailing blank lines', () => {
    expect(countParagraphs('\n\nLeading and trailing.\n\n')).toBe(1);
    expect(countParagraphs('\n\nFirst paragraph.\n\n\nSecond paragraph.\n\n\n')).toBe(2);
  });
});

describe('countSentences', () => {
  // Pins that distinct sentence terminators (., !, ?) each increment the sentence count.
  it('counts sentences ending with period, exclamation mark, and question mark', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
  });

  // Pins that consecutive terminator punctuation runs (such as ellipsis or interrobang) collapse into a single terminator.
  it('collapses runs of terminators into a single sentence boundary', () => {
    expect(countSentences('Wait... really')).toBe(1);
  });

  // Pins that decimal points between digits are ignored so floating-point numbers do not trigger false sentence splits.
  it('ignores decimal points between numeric digits', () => {
    expect(countSentences('Pi is 3.14 today.')).toBe(1);
  });

  // Pins the documented abbreviation heuristic where titles like "Dr." honestly miscount as a sentence boundary.
  it('asserts known miscount on abbreviations honestly per documented heuristic', () => {
    // This is a documented heuristic, acceptable in a dialog the user opened deliberately
    // where the same guess in the status bar would not be.
    expect(countSentences('Dr. Smith arrived.')).toBe(2);
  });
});

describe('analyzeText', () => {
  // Pins that empty input text yields all zeros across every document statistic metric.
  it('returns all zeros for empty input string', () => {
    const stats = analyzeText('');
    expect(stats.words).toBe(0);
    expect(stats.charactersWithSpaces).toBe(0);
    expect(stats.charactersWithoutSpaces).toBe(0);
    expect(stats.paragraphs).toBe(0);
    expect(stats.sentences).toBe(0);
    expect(stats.readingMinutes).toBe(0);
  });

  // Pins that real multi-paragraph prose produces accurate composed statistics.
  it('returns composed figures for real prose text', () => {
    const prose = 'The quick brown fox jumps over the lazy dog.\n\nIt was a sunny day.';
    const stats = analyzeText(prose);

    expect(stats.words).toBe(14);
    expect(stats.charactersWithSpaces).toBe(prose.length);
    expect(stats.charactersWithoutSpaces).toBe(prose.replace(/\s/g, '').length);
    expect(stats.paragraphs).toBe(2);
    expect(stats.sentences).toBe(2);
    expect(stats.readingMinutes).toBe(1);
  });

  // Pins that readingMinutes floors at 1 for any non-empty text with at least one word.
  it('floors readingMinutes at 1 for short non-empty text', () => {
    const stats = analyzeText('Brief snippet.');
    expect(stats.words).toBe(2);
    expect(stats.readingMinutes).toBe(1);
  });

  // Pins that readingMinutes rounds words divided by WORDS_PER_MINUTE for longer texts (~400 words yields 2).
  it('rounds readingMinutes for longer texts with approximately 400 words giving 2', () => {
    const words400 = Array.from({ length: 400 }, () => 'word').join(' ');
    const stats = analyzeText(words400);

    expect(stats.words).toBe(400);
    expect(stats.readingMinutes).toBe(2);
  });
});

describe('WORDS_PER_MINUTE', () => {
  // Pins the constant adult silent reading speed baseline at 200 words per minute.
  it('equals 200 words per minute', () => {
    expect(WORDS_PER_MINUTE).toBe(200);
  });
});
