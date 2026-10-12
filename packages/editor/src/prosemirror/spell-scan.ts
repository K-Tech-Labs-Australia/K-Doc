/**
 * @file spell-scan.ts
 * @purpose Finds words in a ProseMirror document that are eligible for spell checking (FR-12.2), operating without DOM dependencies.
 *   Pure ProseMirror document scanner that identifies what to check rather than judging correctness.
 * @inputs ProseMirror Node instances (doc) and EditorState objects.
 * @outputs WordSpan records marking candidate words and their exact document positions.
 * @functions
 *   - isCheckableWord: Evaluates whether a candidate word string is eligible for spell checking.
 *   - wordsInText: Splits a text run into candidate WordSpan records with document positions computed from offset.
 *   - scanDocument: Traverses a ProseMirror document to collect all checkable word spans from eligible nodes and marks.
 *   - scanState: Extracts checkable word spans from the root document of an EditorState.
 * @dataflow doc / EditorState -> node traversal (filtering skipped node & mark types) -> wordsInText -> isCheckableWord -> readonly WordSpan[].
 * @controlflow Walk document via doc.descendants -> prune skipped nodes -> filter text nodes by skipped marks -> extract word spans -> return accumulated spans.
 * @version 1
 * @date 2026-09-06
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export interface WordSpan {
  /** Document position of the first character. */
  readonly from: number;
  /** Document position just past the last character. */
  readonly to: number;
  readonly word: string;
}

/**
 * ProseMirror node type names whose text content must be skipped during spell checking.
 *
 * Reasoning per node group:
 * - `codeBlock`: Code is not prose and its identifiers would be flagged forever.
 * - `frontMatter`: Front matter is structured metadata whose keys and values are not natural-language prose.
 * - `unknownBlock`, `unknownInline`: Unknown nodes are verbatim passthrough constructs that K-Doc does not interpret and must not judge.
 * - Dropped types: `math` and `mathInline` represent mathematical notation; however, neither is defined in K-Doc's `schema.ts`,
 *   so they have been deliberately dropped to avoid illusory coverage.
 */
export const SKIPPED_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'codeBlock',
  'frontMatter',
  'unknownBlock',
  'unknownInline',
]);

/**
 * ProseMirror mark type names whose text content must be skipped during spell checking.
 *
 * Reasoning:
 * - `inlineCode`: Code is not prose and its identifiers would be flagged forever.
 * - `link` decision: For the `link` mark, it is the URL that must be skipped rather than the link text.
 *   In K-Doc's schema (`schema.ts`), the URL lives in the mark's `href` attribute rather than in the text content,
 *   so skipping marked text would wrongly skip prose the user wrote. Therefore, `link` is excluded from this set.
 */
export const SKIPPED_MARK_TYPES: ReadonlySet<string> = new Set<string>([
  'inlineCode',
]);

/**
 * Evaluates whether a candidate word string is eligible for spell checking.
 *
 * @purpose Filters out tokens that are not worth checking (e.g. single characters, identifiers, paths, acronyms).
 * @inputs word: string - The candidate word token to inspect.
 * @outputs boolean - True if the word should be spell checked, false otherwise.
 * @dataflow word -> length, digit, punctuation, and uppercase casing checks -> boolean.
 * @controlflow Guard length < 2 -> guard digits -> guard path/email delimiters -> guard ALL CAPS -> return boolean.
 */
export function isCheckableWord(word: string): boolean {
  // Check if the word is shorter than 2 characters.
  // Single letters (such as "a" or "I") are almost always intentional and not worth checking.
  if (word.length < 2) {
    // Word is shorter than 2 characters: return false.
    return false;
  } else {
    // Word length is >= 2: proceed to check for numeric digits.
  }

  // Check if the word contains any numeric digits.
  // Tokens like "h1", "utf8", and "x2" are identifiers or technical terms, not misspellings.
  if (/\d/.test(word)) {
    // Word contains one or more digits: return false.
    return false;
  } else {
    // Word contains no digits: proceed to check for identifier or path punctuation.
  }

  // Check if the word contains path, email, or identifier delimiters ('_', '/', '\', '@', or '.').
  // These mark paths, emails, and identifiers; a checker that flags "README.md" teaches the user to ignore it.
  if (/[_\\/@.]/.test(word)) {
    // Word contains path, email, or identifier delimiters: return false.
    return false;
  } else {
    // Word contains no identifier punctuation: proceed to check for acronym casing.
  }

  // Check if the word is in ALL CAPS with length >= 2.
  // Acronyms (e.g. "NASA", "HTML", "API") are not misspellings and flagging them produces noise.
  if (word.length >= 2 && word === word.toUpperCase()) {
    // Word is in ALL CAPS: return false.
    return false;
  } else {
    // Word is mixed-case or lowercase: it is eligible for spell checking.
  }

  return true;
}

/**
 * Splits a run of text into words, returning each with document positions computed from offset.
 *
 * @purpose Splits a text run into candidate WordSpan records with document positions computed from offset.
 * @inputs
 *   - text: string - The raw text content of the text node.
 *   - offset: number - Document position of the beginning of this text node.
 * @outputs readonly WordSpan[] - Array of valid WordSpan records within this text run.
 * @dataflow text + offset -> RegExp match -> strip leading/trailing apostrophes -> isCheckableWord -> WordSpan[].
 * @controlflow Execute wordPattern RegExp -> check match bounds -> compute from/to -> strip leading/trailing apostrophes -> filter via isCheckableWord -> accumulate spans.
 */
export function wordsInText(text: string, offset: number): readonly WordSpan[] {
  const spans: WordSpan[] = [];

  // Match maximal runs of Unicode letters and apostrophes.
  // Using the 'u' flag with \p{L} ensures non-ASCII letters (e.g. accented characters in "café") are included as words;
  // a checker that treats "café" as "caf" + "é" produces two wrong answers instead of one right one.
  // Both standard ASCII apostrophe (') and typographic apostrophe (’ / \u2019) are included.
  const wordPattern = /[\p{L}'\u2019]+/gu;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;

    // Check if the regex match element and index are defined to satisfy strict noUncheckedIndexedAccess.
    if (rawMatch === undefined || matchIndex === undefined) {
      // Unchecked match element or index is undefined: skip iteration.
      continue;
    } else {
      // Match element and index are valid: proceed with word processing.
    }

    let word = rawMatch;
    // Compute document positions relative to the caller-supplied text node offset.
    // Positions are offset + matchIndex, and the caller supplies the text node's document position;
    // returning positions rather than just words is what lets the caller decorate exactly the wrong word rather than the paragraph.
    let from = offset + matchIndex;
    let to = from + rawMatch.length;

    // Strip leading apostrophes from the matched token, adjusting the document start position accordingly.
    while (word.startsWith("'") || word.startsWith('’')) {
      word = word.slice(1);
      from += 1;
    }

    // Strip trailing apostrophes from the matched token, adjusting the document end position accordingly.
    // Possessives like "dogs'" should be checked as the base word "dogs".
    while (word.endsWith("'") || word.endsWith('’')) {
      word = word.slice(0, -1);
      to -= 1;
    }

    // Check if the stripped word is eligible for spell checking.
    if (isCheckableWord(word)) {
      // Word is checkable: record WordSpan with accurate document positions.
      spans.push({ from, to, word });
    } else {
      // Word is not checkable (e.g. empty after stripping, too short, digits, delimiters, or all caps): omit from results.
    }
  }

  return spans;
}

/**
 * Traverses a ProseMirror document and finds all words eligible for spell checking.
 *
 * @purpose Walks a ProseMirror document via doc.descendants to collect all checkable word spans (FR-12.2).
 * @inputs doc: ProseMirrorNode - The root ProseMirror document node.
 * @outputs readonly WordSpan[] - Array of eligible WordSpan descriptors across the document.
 * @dataflow doc -> doc.descendants traversal -> check SKIPPED_NODE_TYPES -> check SKIPPED_MARK_TYPES -> wordsInText -> WordSpan[].
 * @controlflow Walk descendants -> return false if skipped node type -> inspect text marks -> call wordsInText if mark allowed -> accumulate spans.
 */
export function scanDocument(doc: ProseMirrorNode): readonly WordSpan[] {
  const spans: WordSpan[] = [];

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    // Check if the current node type is in the set of skipped node types.
    // Returning false is what makes skipping a code block skip everything inside it, rather than only the block node itself.
    if (SKIPPED_NODE_TYPES.has(node.type.name)) {
      // Node type is skipped (e.g. codeBlock, frontMatter, unknownBlock, unknownInline): stop descending into its subtree.
      return false;
    } else {
      // Node type is not skipped: proceed to inspect node content.
    }

    // Check if the current node is a text node.
    if (node.isText) {
      // Check whether any mark on this text node is in SKIPPED_MARK_TYPES (e.g. inlineCode).
      let hasSkippedMark = false;
      for (let i = 0; i < node.marks.length; i++) {
        const mark = node.marks[i];
        // Check if the mark at index i is defined to satisfy strict noUncheckedIndexedAccess.
        if (mark === undefined) {
          // Mark element is undefined: skip iteration.
          continue;
        } else {
          // Mark element is defined: check its type name.
        }

        // Check if the mark's type name is in SKIPPED_MARK_TYPES.
        if (SKIPPED_MARK_TYPES.has(mark.type.name)) {
          // Mark is in SKIPPED_MARK_TYPES (e.g. inlineCode): flag node as skipped.
          hasSkippedMark = true;
          break;
        } else {
          // Mark is not in SKIPPED_MARK_TYPES: continue checking remaining marks.
        }
      }

      // Check if the text node carries any skipped marks.
      if (hasSkippedMark) {
        // Text node has a skipped mark: skip scanning this text node.
      } else {
        // Text node has no skipped marks: extract words and collect their spans.
        const text = node.text ?? '';
        const words = wordsInText(text, pos);
        for (let i = 0; i < words.length; i++) {
          const span = words[i];
          // Check if the word span at index i is defined to satisfy strict noUncheckedIndexedAccess.
          if (span === undefined) {
            // Span element is undefined: skip iteration.
            continue;
          } else {
            // Span element is defined: push into collected spans.
            spans.push(span);
          }
        }
      }
    } else {
      // Current node is a container node (e.g. paragraph, heading, list): continue descending into its children.
    }
  });

  return spans;
}

/**
 * Scans an EditorState's document to find all words eligible for spell checking.
 *
 * @purpose Extracts all checkable word spans from the root document of an EditorState (FR-12.2).
 * @inputs state: EditorState - The ProseMirror editor state whose document should be scanned.
 * @outputs readonly WordSpan[] - Array of eligible WordSpan descriptors with document positions.
 * @dataflow state.doc -> scanDocument -> readonly WordSpan[].
 * @controlflow Delegate directly to scanDocument passing state.doc.
 */
export function scanState(state: EditorState): readonly WordSpan[] {
  return scanDocument(state.doc);
}
