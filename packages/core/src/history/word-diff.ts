/**
 * @file word-diff.ts
 * @purpose Word-level comparison of two versions of a document for the history browser (FR-11.9): splits text into word, space and punctuation tokens and diffs the tokens with the Myers diff used for merging.
 * @inputs two texts.
 * @outputs runs of equal, inserted and deleted text, and word counts of the change.
 * @functions
 *   - tokenizeWords: split a string into whitespace, word and punctuation tokens.
 *   - diffWords: diff the token arrays with the line Myers diff and merge same-kind neighbours.
 *   - countChangedWords: count whole words in inserted and deleted runs.
 * @dataflow texts -> tokens -> diffLines ops -> merged runs.
 * @controlflow one pass over the ops, joining neighbours of the same kind.
 * @version 1
 * @date 2026-09-16
 */

import { diffLines } from '../merge/line-diff.js';

/** Word-level diff part kind: equal means present in both versions; insert means only in the later one; delete means only in the earlier one. */
export type WordDiffKind = 'equal' | 'insert' | 'delete';

/** A run of adjacent tokens of one kind; joined in order the equal and delete runs give the earlier text and the equal and insert runs the later one. */
export interface WordDiffPart {
  readonly kind: WordDiffKind;
  readonly text: string;
}

// A token is a run of whitespace, a word (letters, digits, underscore and apostrophes so "don't" stays whole), or one other character, so Markdown punctuation such as ** or # changes on its own.
const TOKEN = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu;

// A token counts as a word when it holds a letter or digit.
const WORD = /[\p{L}\p{N}]/u;

/** Split text into tokens; the tokens joined give back the text exactly and an empty text has none. */
export function tokenizeWords(text: string): readonly string[] {
  return text.match(TOKEN) ?? [];
}

/** Diff two texts at word granularity using the line Myers diff, which compares any string arrays so it serves tokens too (FR-6.4). */
export function diffWords(before: string, after: string): readonly WordDiffPart[] {
  const beforeTokens = tokenizeWords(before);
  const afterTokens = tokenizeWords(after);
  const parts: { kind: WordDiffKind; text: string }[] = [];
  for (const op of diffLines(beforeTokens, afterTokens)) {
    // A keep op means both tokens are equal, so map it to the 'equal' kind.
    const kind: WordDiffKind = op.kind === 'keep' ? 'equal' : op.kind;
    // Read the token for this operation: an insert takes the after token, otherwise the before token.
    const token = op.kind === 'insert' ? afterTokens[op.afterIndex] : beforeTokens[op.beforeIndex];
    // An index outside the tokens would mean a bug in the diff, so fail fast rather than produce garbage.
    if (token === undefined) {
      throw new Error(`Word diff produced an operation outside the text (${op.kind} ${op.beforeIndex}/${op.afterIndex}).`);
    } else {
      // The token is defined; append it below to a same-kind run.
    }
    const last = parts[parts.length - 1];
    // Neighbouring tokens of the same kind are merged so the browser draws one mark per change rather than per word.
    if (last !== undefined && last.kind === kind) {
      last.text += token;
    } else {
      parts.push({ kind, text: token });
    }
  }
  return parts;
}

/** Count whole words in inserted and deleted runs, ignoring spaces and punctuation, for the summary line. */
export function countChangedWords(parts: readonly WordDiffPart[]): { readonly inserted: number; readonly deleted: number } {
  let inserted = 0;
  let deleted = 0;
  for (const part of parts) {
    const words = tokenizeWords(part.text).filter((token) => WORD.test(token)).length;
    // Inserted runs add to the inserted word count.
    if (part.kind === 'insert') {
      inserted += words;
    } else if (part.kind === 'delete') {
      // Deleted runs add to the deleted word count.
      deleted += words;
    } else {
      // Equal runs contribute no changed words.
    }
  }
  return { inserted, deleted };
}
