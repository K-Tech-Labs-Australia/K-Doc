/**
 * @file focus-range.ts
 * @purpose Finds the stretch of text Focus mode leaves undimmed (FR-5.8): the paragraph holding the caret, or the sentence within it; shared by the WYSIWYG and Source panes so both dim the same way.
 * @inputs A text string, a caret offset, and a scope to search within.
 * @outputs Half-open [start, end) character offsets delimiting the undimmed region.
 * @functions
 *   - FocusScope: Union type selecting which region stays lit ('off', 'paragraph', or 'sentence').
 *   - FocusRange: Interface describing a half-open range of text offsets.
 *   - paragraphRange: Expands from the caret to the full run of non-blank lines around it.
 *   - sentenceRange: Narrows a paragraph to just the sentence containing the caret.
 *   - focusRange: Dispatches on scope, returning the paragraph or its sentence narrowing.
 * @dataflow text + offset -> line scan for the paragraph / punctuation scan for the sentence.
 * @controlflow linear scans outward from the caret; empty else branches are no-ops.
 * @version 1
 * @date 2026-09-16
 */

/**
 * @purpose Selects which region of text Focus mode leaves undimmed.
 * @inputs off: nothing dimmed; paragraph: all but the caret's paragraph; sentence: all but the caret's sentence.
 * @outputs A scope tag consumed by focusRange to choose the lit region.
 * @dataflow Scope tag → focusRange branch → paragraph or sentence narrowing.
 * @controlflow Pure selector with no side effects, passed straight into focusRange.
 */
export type FocusScope = 'off' | 'paragraph' | 'sentence';

/**
 * @purpose A half-open range of character offsets delimiting an undimmed region.
 * @inputs start: inclusive begin offset; end: exclusive end offset.
 * @outputs Half-open [start, end) offsets.
 * @dataflow Immutable value produced by paragraphRange/sentenceRange and consumed by the dimming layer.
 * @controlflow Plain data carrier with no behavior of its own.
 */
export interface FocusRange {
  readonly start: number;
  readonly end: number;
}

// SENTENCE_END — one or more of . ! ? … possibly followed by closing quotes or brackets, then whitespace or the end; the global flag lets exec walk the text.
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;

/**
 * @purpose Finds the paragraph (run of non-blank lines) containing the caret offset.
 * @inputs text: full document text; offset: caret position to locate within it.
 * @outputs Half-open [start, end) offsets bounding the paragraph.
 * @dataflow Clamp offset into text → line helpers find current line → walk up and down across non-blank lines.
 * @controlflow Linear scans outward from the caret's line; stops at blank-line boundaries.
 */
export function paragraphRange(text: string, offset: number): FocusRange {
  // No clamp is needed: lastIndexOf and indexOf already treat an offset before the start or past the end as the edge.
  const at = offset;
  // Line helpers: lastIndexOf finds the line start (-1 + 1 = 0 on the first line), indexOf the line end or the text end.
  const lineStartOf = (position: number): number => text.lastIndexOf('\n', position - 1) + 1;
  const lineEndOf = (position: number): number => {
    const newline = text.indexOf('\n', position);
    // No newline found past this position: the line runs to the end of the document.
    return newline === -1 ? text.length : newline;
  };
  const isBlank = (start: number, end: number): boolean => text.slice(start, end).trim() === '';

  // Anchor to the current line before expanding outward.
  let start = lineStartOf(at);
  let end = lineEndOf(at);
  // If the caret sits on a blank line, focus just that single line and stop here.
  if (isBlank(start, end)) {
    return { start, end };
  } else {
    // No-op: the paragraph spans more than one line, so fall through to expand outward below.
  }
  // Walk up while the previous line is not blank, absorbing preceding lines into the paragraph.
  while (start > 0) {
    const previousStart = lineStartOf(start - 1);
    // A blank line above marks the paragraph boundary; stop expanding upward.
    if (isBlank(previousStart, start - 1)) {
      break;
    } else {
      // Previous line is non-blank: extend the paragraph's top edge to include it.
      start = previousStart;
    }
  }
  // Walk down while the next line is not blank, absorbing following lines into the paragraph.
  while (end < text.length) {
    const nextEnd = lineEndOf(end + 1);
    // A blank line below marks the paragraph boundary; stop expanding downward.
    if (isBlank(end + 1, nextEnd)) {
      break;
    } else {
      // Next line is non-blank: extend the paragraph's bottom edge to include it.
      end = nextEnd;
    }
  }
  return { start, end };
}

/**
 * @purpose Narrows a paragraph down to just the sentence containing the caret.
 * @inputs text: full document text; within: the paragraph range returned by paragraphRange; offset: caret position.
 * @outputs Half-open [start, end) offsets bounding the sentence.
 * @dataflow Punctuation scan for SENTENCE_END markers inside `within` → pick the marker bracketing the caret → trim leading spaces.
 * @controlflow Linear forward scan over sentence terminators, then a left-trim loop; breaks at the first terminator past the caret.
 */
export function sentenceRange(text: string, within: FocusRange, offset: number): FocusRange {
  // Callers pass a caret inside `within`; the scan below only reads sentence ends that start inside it.
  const at = offset;
  let start = within.start;
  let end = within.end;
  // Reset the global regex cursor to the paragraph boundary before scanning forward.
  SENTENCE_END.lastIndex = within.start;
  // Scan forward over sentence terminators inside the paragraph; stop at the first one past the caret or when none remain.
  for (let match = SENTENCE_END.exec(text); match !== null && match.index < within.end; match = SENTENCE_END.exec(text)) {
    const after = match.index + match[0].length;
    // Terminator at or before the caret: this sentence ends here, so the caret's sentence begins right after it.
    if (after <= at) {
      start = after;
    } else {
      // First terminator strictly past the caret bounds the end of the caret's sentence; one starting inside the
      // paragraph also ends inside it, since the pattern cannot cross the line break that ends the paragraph.
      end = after;
      break;
    }
  }
  // Leading spaces are not part of a sentence: skip whitespace from the computed start.
  while (start < end && /\s/.test(text.charAt(start))) {
    start += 1;
  }
  return { start, end };
}

/**
 * @purpose Returns the undimmed region for the given scope: the full paragraph or its containing sentence.
 * @inputs text: full document text; offset: caret position; scope: 'paragraph' or 'sentence'.
 * @outputs Half-open [start, end) offsets bounding the lit region.
 * @dataflow Compute the paragraph first, then narrow to the sentence when scope is 'sentence'.
 * @controlflow Always compute the paragraph; branch on scope to either return it directly or further narrow it.
 */
export function focusRange(text: string, offset: number, scope: Exclude<FocusScope, 'off'>): FocusRange {
  // The paragraph is always computed first and may be returned as-is or narrowed below.
  const paragraph = paragraphRange(text, offset);
  // Scope is 'paragraph': the caret's whole run of non-blank lines stays lit.
  if (scope === 'paragraph') {
    return paragraph;
  } else {
    // Scope is 'sentence': narrow to just the sentence containing the caret.
    return sentenceRange(text, paragraph, offset);
  }
}
