/**
 * @file autocorrect.ts
 * @purpose Autocorrect as you type in the WYSIWYG pane (FR-7.8): smart quotes, dashes, ellipsis, ordinal superscripts, sentence capitals and a replacement table, each read from live options at the moment it would fire, and all inert in code.
 * @inputs The options getter returning current AutocorrectOptions; typed text via ProseMirror match arrays; editor state for position and mark resolution.
 * @outputs An input-rules Plugin plus pure helpers (isInCode, ordinalSuffixFits, findReplacement) used by the rule factories.
 * @functions
 *   - isInCode: Detects whether a position sits inside code so autocorrect leaves it untouched.
 *   - ordinalSuffixFits: Validates that a typed ordinal suffix matches the number's last digits.
 *   - findReplacement: Finds the best replacement for text before the cursor honouring word boundaries and casing.
 *   - textBefore: Reads contiguous text before a position with inline atoms counted as one character.
 *   - guarded: Wraps an InputRule so it only fires when enabled by live options and not inside code.
 *   - replacementRule: Replaces a known token with its replacement when the terminator is typed.
 *   - ordinalRule: Converts a typed ordinal like "1st" into a digit with a superscript suffix.
 *   - capitalRule: Capitalises the first letter of a sentence while sparing abbreviations and single initials.
 *   - quoteRule: Maps an opening or closing straight quote to its typographic counterpart.
 *   - emDashRule: Turns a double hyphen into an em dash.
 *   - enDashRule: Turns a spaced hyphen or double hyphen between words into an en dash.
 *   - ellipsisRule: Turns three full stops into an ellipsis character.
 *   - createAutocorrectPlugin: Assembles all autocorrect rules into a single input-rules plugin.
 * @dataflow Typed character → rule regex → guard (options, code) → replacement transaction (undoable with Backspace).
 * @controlflow Each handler returns null to decline; the first rule that returns a transaction wins.
 * @version 1
 * @date 2026-09-16
 */

import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Plugin, EditorState, Transaction } from 'prosemirror-state';

export interface AutocorrectOptions {
  readonly enabled: boolean;
  readonly smartQuotes: boolean;
  readonly dashes: boolean;
  readonly ellipsis: boolean;
  readonly ordinals: boolean;
  readonly capitalizeSentences: boolean;
  readonly replaceText: boolean;
  readonly replacements: Readonly<Record<string, string>>;
}

type Flag = 'smartQuotes' | 'dashes' | 'ellipsis' | 'ordinals' | 'capitalizeSentences' | 'replaceText';

const ABBREVIATIONS: ReadonlySet<string> = new Set(['e.g', 'i.e', 'etc', 'vs', 'cf', 'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'fig', 'approx']);

/**
 * isInCode
 * @purpose Detects whether a position sits inside code so autocorrect leaves it untouched.
 * @inputs state - the editor state; pos - the document offset to test.
 * @outputs boolean - true when the position is within a code block or an inline code span.
 * @dataflow doc resolve → node spec / stored marks → boolean result.
 * @controlflow Resolve pos; if the parent node is a code block return true immediately; otherwise inspect stored and current marks for an inlineCode mark.
 */
export function isInCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.spec.code === true) {
    // The parent node is a code block: leave it exactly as typed and stop here.
    return true;
  } else {
    // Not a code block: fall through to check inline marks below.
  }
  const marks = state.storedMarks ?? $pos.marks();
  return marks.some((mark) => mark.type.name === 'inlineCode');
}

/**
 * ordinalSuffixFits
 * @purpose Validates that a typed ordinal suffix matches the number's last digits.
 * @inputs digits - the numeric portion of the ordinal as a string; suffix - the typed two/three-letter suffix.
 * @outputs boolean - true when the suffix is correct for this number.
 * @dataflow slice digits → parse ints → compare against 11–13 and final-digit rules.
 * @controlflow Check the teens range first (always "th"); then branch on the final digit to "st"/"nd"/"rd"; default to "th".
 */
export function ordinalSuffixFits(digits: string, suffix: string): boolean {
  const lastTwo = Number(digits.slice(-2));
  const last = Number(digits.slice(-1));
  if (lastTwo >= 11 && lastTwo <= 13) {
    // Teens (11th, 12th, 13th) always take "th" regardless of the final digit.
    return suffix === 'th';
  } else if (last === 1) {
    // Final digit 1 takes "st", except for the teens handled above.
    return suffix === 'st';
  } else if (last === 2) {
    // Final digit 2 takes "nd", except for the teens handled above.
    return suffix === 'nd';
  } else if (last === 3) {
    // Final digit 3 takes "rd", except for the teens handled above.
    return suffix === 'rd';
  } else {
    // Any other final digit takes "th".
    return suffix === 'th';
  }
}

/**
 * findReplacement
 * @purpose Finds the best replacement for text typed before a cursor, honouring word boundaries and casing.
 * @inputs before - the text preceding the trigger; replacements - the key→value table.
 * @outputs { from, value } object or null when no replacement applies.
 * @dataflow sort keys longest-first → slice candidate → validate boundary/case → build return value.
 * @controlflow Iterate keys by descending length; skip unusable values and non-word-boundary matches; skip entries equal to what was typed; capitalise the first letter of a title-cased match for a lowercase key.
 */
export function findReplacement(before: string, replacements: Readonly<Record<string, string>>): { readonly from: number; readonly value: string } | null {
  const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const value = replacements[key];
    const candidate = before.slice(-key.length);
    const charBefore = before[before.length - key.length - 1];
    // Text shorter than the key yields a shorter candidate, which the comparison below can never match.
    if (value === undefined) {
      // No usable replacement: skip this key.
      continue;
    } else if (charBefore !== undefined && !/[\s([{"'\u201C\u2018]/.test(charBefore)) {
      // The preceding character is not a word boundary: the key does not start the word, so skip.
      continue;
    } else {
      // Value present and the key starts at a valid boundary: proceed to case matching below.
    }
    const lowerKey = key === key.toLowerCase();
    // A lowercase key matches any letter case; otherwise the candidate must equal the key verbatim.
    const matches = lowerKey ? candidate.toLowerCase() === key : candidate === key;
    if (!matches || candidate === value) {
      // No textual match, or the replacement equals what was already typed: skip this key.
      continue;
    } else {
      // Match confirmed and a real change is possible: compute the return value below.
    }
    const first = candidate.charAt(0);
    // Preserve the original first-letter casing when the source was title-cased but the key is lowercase (e.g. "Teh" → "The"); otherwise use the replacement unchanged.
    const capitalised = lowerKey && first !== first.toLowerCase();
    return { from: before.length - key.length, value: capitalised ? value.charAt(0).toUpperCase() + value.slice(1) : value };
  }
  return null;
}

/**
 * textBefore
 * @purpose Reads the text immediately before a position with inline atoms counted as one character.
 * @inputs state - the editor state; pos - the document offset.
 * @outputs string - the contiguous text before pos, so offsets line up with positions.
 * @dataflow doc resolve → parent.textBetween(0, parentOffset) → string.
 * @controlflow Resolve pos and return the parent's text up to the caret offset.
 */
function textBefore(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos);
  return $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\ufffc');
}

/**
 * guarded
 * @purpose Wraps an InputRule so it only fires when enabled by live options and not inside code.
 * @inputs options - a getter returning current AutocorrectOptions; flag - which option toggles this rule; pattern - the regex that triggers the rule; apply - the transaction builder.
 * @outputs InputRule - the wrapped rule, inert until its guard passes.
 * @dataflow typed text → regex match → guard (options, code) → apply or null.
 * @controlflow On match, read options lazily; if disabled or in code return null, else delegate to apply.
 */
function guarded(options: () => AutocorrectOptions, flag: Flag, pattern: RegExp, apply: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const current = options();
    if (!current.enabled || !current[flag] || isInCode(state, start)) {
      // Autocorrect is off, this flag is disabled, or we are inside code: decline the rule.
      return null;
    } else {
      // All guards pass: apply the replacement transaction.
      return apply(state, match, start, end);
    }
  });
}

/**
 * replacementRule
 * @purpose Replaces a known token with its replacement when the terminator is typed.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped replacement rule.
 * @dataflow text before cursor → findReplacement → rewrite key, append terminator.
 * @controlflow Guarded on replaceText; if no entry found return null, else insert the replacement then the typed terminator after it.
 */
function replacementRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'replaceText', /[\s.,;:!?)\]]$/, (state, match, start) => {
    const found = findReplacement(textBefore(state, start), options().replacements);
    if (found === null) {
      // No matching entry in the replacement table: decline this rule.
      return null;
    } else {
      // A replacement was found: rewrite the key and append the typed terminator character after it.
      const blockStart = state.doc.resolve(start).start();
      const from = blockStart + found.from;
      // One replace step carrying the typed character, for the same reason as the dash rules.
      return state.tr.insertText(found.value + match[0], from, start);
    }
  });
}

/**
 * ordinalRule
 * @purpose Converts a typed ordinal like "1st" into a digit with a superscript suffix.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped ordinal rule.
 * @dataflow match digits/suffix/terminator → validate suffix → add superscript mark, write terminator.
 * @controlflow Guarded on ordinals; if no superscript mark or suffix doesn't fit return null, else mark the suffix and insert the trailing character without it.
 */
function ordinalRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'ordinals', /(?:^|[^\p{L}\p{N}_])(\d+)(st|nd|rd|th)([\s.,;:!?])$/u, (state, match, _start, end) => {
    const digits = match[1] ?? '';
    const suffix = match[2] ?? '';
    const typed = match[3] ?? '';
    const superscript = state.schema.marks['superscript'];
    if (superscript === undefined || !ordinalSuffixFits(digits, suffix)) {
      // No superscript mark available or the suffix is wrong for this number: decline.
      return null;
    } else {
      // Superscript exists and the suffix fits: mark the suffix and write the trailing character without it.
      const tr = state.tr.addMark(end - suffix.length, end, superscript.create());
      return tr.insert(end, state.schema.text(typed));
    }
  });
}

/**
 * capitalRule
 * @purpose Capitalises the first letter of a sentence while sparing abbreviations and single initials.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped capitalisation rule.
 * @dataflow text before cursor → abbreviation/initial check → insert uppercase letter.
 * @controlflow Guarded on capitalizeSentences; after a full stop, decline for abbreviations or single initials, otherwise capitalise the following lowercase letter.
 */
function capitalRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'capitalizeSentences', /(?:^|[.!?]\s+)(\p{Ll})$/u, (state, match, _start, end) => {
    const before = textBefore(state, end).trimEnd();
    if (before.endsWith('.')) {
      // The terminator is a full stop: check for abbreviations and single initials before capitalising.
      const word = before.slice(0, -1).split(/\s/).pop()?.toLowerCase() ?? '';
      if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) {
        // Common abbreviation or a lone initial: do not capitalise the following letter.
        return null;
      } else {
        // Not an abbreviation and not a single initial: proceed to capitalise below.
      }
    } else {
      // The terminator is not a full stop (paragraph start, "!", or "?"): capitalise unconditionally below.
    }
    return state.tr.insertText((match[1] ?? '').toUpperCase(), end, end);
  });
}

/**
 * quoteRule
 * @purpose Maps an opening or closing straight quote to its typographic counterpart.
 * @inputs options - a getter returning current AutocorrectOptions; pattern - regex distinguishing open vs close; quote - the replacement glyph.
 * @outputs InputRule - the wrapped quote rule.
 * @dataflow typed quote → guard → insert typographic quote at caret.
 * @controlflow Guarded on smartQuotes; always inserts the mapped quote at the end position.
 */
function quoteRule(options: () => AutocorrectOptions, pattern: RegExp, quote: string): InputRule {
  return guarded(options, 'smartQuotes', pattern, (state, _match, _start, end) => state.tr.insertText(quote, end, end));
}

/**
 * emDashRule
 * @purpose Turns a double hyphen into an em dash.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped em-dash rule.
 * @dataflow "--" after a character → guard → replace with em dash.
 * @controlflow Guarded on dashes; replaces the second hyphen with an em dash (line-start "---" is left to the horizontal-rule).
 */
function emDashRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'dashes', /[^\s-]--$/, (state, _match, _start, end) => state.tr.insertText('\u2014', end - 1, end));
}

/**
 * enDashRule
 * @purpose Turns a spaced hyphen or double hyphen between words ("a - b", "a -- b") into an en dash.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped en-dash rule.
 * @dataflow " - " or " -- " → guard → replace the hyphens with an en dash and add the typed space.
 * @controlflow Guarded on dashes; the match is a character, a space, one or two hyphens and the typed space, so the hyphens are its length less three.
 */
function enDashRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'dashes', /\S\s--?\s$/, (state, match, _start, end) => {
    const hyphens = match[0].length - 3;
    // One replace step, as ProseMirror's own rules make: a second insert after the typed space let the browser's next
    // keystroke land on that space.
    return state.tr.insertText('\u2013 ', end - hyphens, end);
  });
}

/**
 * ellipsisRule
 * @purpose Turns three full stops into an ellipsis character.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs InputRule - the wrapped ellipsis rule.
 * @dataflow "..." → guard → replace with single ellipsis glyph.
 * @controlflow Guarded on ellipsis; replaces the last two full stops with an ellipsis.
 */
function ellipsisRule(options: () => AutocorrectOptions): InputRule {
  return guarded(options, 'ellipsis', /\.\.\.$/, (state, _match, _start, end) => state.tr.insertText('\u2026', end - 2, end));
}

/**
 * createAutocorrectPlugin
 * @purpose Assembles all autocorrect rules into a single ProseMirror input-rules plugin.
 * @inputs options - a getter returning current AutocorrectOptions.
 * @outputs Plugin - the input-rules plugin driving every autocorrect rule.
 * @dataflow options → rule factories → inputRules plugin.
 * @controlflow Build each rule factory in precedence order and pass them to inputRules; the first rule that returns a transaction wins.
 */
export function createAutocorrectPlugin(options: () => AutocorrectOptions): Plugin {
  return inputRules({
    rules: [
      replacementRule(options),
      ordinalRule(options),
      capitalRule(options),
      quoteRule(options, /(?:^|[\s{[(<'"\u2018\u201C])"$/, '\u201C'),
      quoteRule(options, /"$/, '\u201D'),
      quoteRule(options, /(?:^|[\s{[(<'"\u2018\u201C])'$/, '\u2018'),
      quoteRule(options, /'$/, '\u2019'),
      emDashRule(options),
      enDashRule(options),
      ellipsisRule(options),
    ],
  });
}
