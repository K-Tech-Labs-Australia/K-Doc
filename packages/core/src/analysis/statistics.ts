/**
 * @file statistics.ts
 * @purpose Pure, dependency-free document statistics calculation engine for @k-doc/core (FR-12.5).
 *   Computes live word count, character count with and without spaces, paragraph count, sentence count,
 *   and estimated reading time over text buffers for the status bar and detailed statistics dialog.
 * @inputs Raw text strings (Markdown source, rendered prose, or selection slices).
 * @outputs DocumentStatistics objects, word counts, sentence counts, paragraph counts, and WORDS_PER_MINUTE constant.
 * @functions
 *   - countWords: Counts non-empty whitespace-delimited word tokens in a text string.
 *   - countSentences: Counts sentence terminators (. ! ?), collapsing runs and ignoring decimal points.
 *   - countParagraphs: Counts contiguous runs of non-blank lines separated by blank lines.
 *   - analyzeText: Composes word, character, paragraph, sentence, and reading time statistics for a text string.
 * @dataflow Text string -> whitespace and terminator regex analysis / line iteration -> DocumentStatistics payload.
 * @controlflow Guard empty input -> compute word/character/paragraph/sentence metrics -> calculate bounded reading minutes -> return DocumentStatistics.
 * @version 1
 * @date 2026-09-06
 */

/**
 * Document statistics payload reporting lexical and structural metrics (FR-12.5).
 */
export interface DocumentStatistics {
  readonly words: number;
  readonly charactersWithSpaces: number;
  readonly charactersWithoutSpaces: number;
  readonly paragraphs: number;
  readonly sentences: number;
  readonly readingMinutes: number;
}

/**
 * Average adult silent reading speed in words per minute used to estimate document reading time.
 * Conventional figure for silent reading of prose. The number matters less than its being stable:
 * a reading time that moved between releases would be worse than one that is merely approximate.
 */
export const WORDS_PER_MINUTE: number = 200;

/**
 * Counts the number of words in a text string by splitting on whitespace.
 *
 * @purpose Counts whitespace-delimited word tokens in text without requiring DOM or AST parsing.
 * @inputs text - The raw text string to analyze.
 * @outputs number - The total count of words in the text.
 * @dataflow text -> empty check -> split on whitespace -> count non-empty token runs.
 * @controlflow Check for empty or whitespace-only text -> return 0 if empty -> split on \s+ -> return token count.
 */
export function countWords(text: string): number {
  // Check if input text is empty or consists solely of whitespace.
  if (text.trim().length === 0) {
    // Branch: Empty or whitespace-only text contains zero words.
    return 0;
  } else {
    // Branch: Non-empty text contains one or more word tokens.
  }

  // Split on whitespace runs and count non-empty tokens.
  // Rule decision: Pure whitespace splitting (/\s+/), counting all non-empty runs. This deliberately does
  // not strip Markdown syntax (e.g. "##", ">", "*"): a heading's "##" is followed by a space and thus counted
  // as a token. Stripping syntax would require AST parsing on every keystroke or heuristic regexes diverging
  // from character counts; keeping both on raw text maintains consistency. In WYSIWYG mode, text is prose.
  const tokens = text.trim().split(/\s+/);
  return tokens.length;
}

/**
 * Counts the number of sentences in a text string based on terminator punctuation.
 *
 * @purpose Estimates sentence count by identifying sentence terminators with run collapsing and decimal exclusion.
 * @inputs text - The raw text string to analyze.
 * @outputs number - The total count of sentences identified in the text.
 * @dataflow text -> empty check -> strip decimal points -> match terminator runs -> return match count.
 * @controlflow Check empty/whitespace text -> strip /\d\.\d/ decimals -> match [.!?]+ runs -> return count or 0.
 */
export function countSentences(text: string): number {
  // Check if input text is empty or contains only whitespace.
  if (text.trim().length === 0) {
    // Branch: Empty or whitespace-only text contains zero sentences.
    return 0;
  } else {
    // Branch: Non-empty text; proceed with terminator analysis.
  }

  // Rule 1: Ignore decimal points sitting directly between two digits so numbers like "3.14" are not two sentences.
  const withoutDecimals = text.replace(/(?<=\d)\.(?=\d)/g, '');

  // Rule 2: Count terminators ('.', '!', '?'), collapsing runs so "..." or "?!" counts as one terminator.
  // Heuristic note: This heuristic miscounts abbreviations ("Dr. Smith"). This trade-off is acceptable because
  // sentence count is surfaced only in the detailed statistics dialog opened on demand (FR-12.5), where an
  // approximation is acceptable, whereas guessing in the live status bar on every keystroke would not be.
  const matches = withoutDecimals.match(/[.!?]+/g);

  // Check if any terminator runs were found.
  if (matches !== null) {
    // Branch: One or more terminator runs found; return match count.
    return matches.length;
  } else {
    // Branch: No terminators found; return 0.
    return 0;
  }
}

/**
 * Counts the number of paragraphs in a text string.
 *
 * @purpose Counts contiguous runs of non-blank lines separated by blank lines.
 * @inputs text - The raw text string to analyze.
 * @outputs number - The total count of paragraphs identified in the text.
 * @dataflow text -> split lines -> scan non-blank runs -> return paragraph count.
 * @controlflow Check empty/whitespace text -> iterate lines tracking inParagraph state -> increment count on transitions -> return count.
 */
export function countParagraphs(text: string): number {
  // Check if input text is empty or contains only whitespace.
  if (text.trim().length === 0) {
    // Branch: Empty or whitespace-only text contains zero paragraphs.
    return 0;
  } else {
    // Branch: Non-empty text; scan lines for contiguous runs of non-blank lines.
  }

  // Text measure rather than mdast AST measure: status bar updates on every keystroke, and re-parsing
  // into an AST to count paragraph nodes would make typing pay for a number nobody is inspecting that closely.
  const lines = text.split(/\r?\n/);
  let count = 0;
  let inParagraph = false;

  // Iterate over lines to identify non-blank runs separated by blank lines.
  for (const line of lines) {
    // Check if current line contains non-whitespace content.
    if (line.trim().length > 0) {
      // Branch: Line is non-blank.
      // Check if entering a new paragraph run from a blank line or start of text.
      if (!inParagraph) {
        // Increment count when entering a new paragraph run.
        count++;
        inParagraph = true;
      } else {
        // Continue inside current paragraph run.
      }
    } else {
      // Branch: Line is blank.
      // Check if exiting an active paragraph run.
      if (inParagraph) {
        // Reset inParagraph flag upon encountering a blank separator line.
        inParagraph = false;
      } else {
        // Continue in blank region.
      }
    }
  }

  return count;
}

/**
 * Analyzes a text string and produces a comprehensive DocumentStatistics summary.
 *
 * @purpose Computes lexical, structural, and reading time statistics over a text string (FR-12.5).
 * @inputs text - The raw text string to analyze.
 * @outputs DocumentStatistics - Comprehensive statistics including words, characters, paragraphs, sentences, and reading minutes.
 * @dataflow text -> compute individual counts -> calculate reading time -> construct DocumentStatistics.
 * @controlflow Compute words, characters with/without spaces, paragraphs, and sentences -> calculate readingMinutes -> assemble and return DocumentStatistics.
 */
export function analyzeText(text: string): DocumentStatistics {
  const words = countWords(text);

  // charactersWithSpaces is text.length (UTF-16 code units as seen in editor, not grapheme clusters).
  const charactersWithSpaces = text.length;

  // charactersWithoutSpaces excludes every whitespace character (\s).
  const charactersWithoutSpaces = text.replace(/\s/g, '').length;

  const paragraphs = countParagraphs(text);
  const sentences = countSentences(text);

  // Reading time floors at 1 min for non-empty text (words > 0) because "0 min read" is uninformative;
  // returns 0 when words === 0 to ensure empty text returns zeros across all metrics.
  let readingMinutes = 0;
  if (words === 0) {
    // Branch: Zero words take zero minutes to read.
    readingMinutes = 0;
  } else {
    // Branch: Words present; compute rounded minutes with a floor of 1 minute.
    readingMinutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  }

  return {
    words,
    charactersWithSpaces,
    charactersWithoutSpaces,
    paragraphs,
    sentences,
    readingMinutes,
  };
}
