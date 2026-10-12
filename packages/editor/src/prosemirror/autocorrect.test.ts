// @vitest-environment jsdom
/**
 * @file autocorrect.test.ts
 * @purpose Unit tests for the ProseMirror autocorrect plugin covering quote, dash, ellipsis, ordinal, capitalization, and replacement behaviour.
 * @inputs Vitest test runner; ProseMirror editor instances created via helper functions; autocorrect option fixtures.
 * @outputs Test pass/fail results reported to Vitest via expect assertions.
 * @functions
 *   - viewWith: Creates a seeded EditorView from markdown and autocorrect options.
 *   - type: Types text character-by-character through input handlers.
 *   - paragraphText: Reads the current document's plain text.
 *   - markdownOf: Serializes the document back to Markdown.
 * @dataflow Test body -> helper-built editor -> simulated typing -> assertions on resulting text.
 * @controlflow afterEach tears down views; each it() builds a fresh editor, types input, and asserts output.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undoInputRule } from 'prosemirror-inputrules';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { createAutocorrectPlugin, findReplacement, isInCode, ordinalSuffixFits } from './autocorrect.js';
import type { AutocorrectOptions } from './autocorrect.js';

const ALL_ON: AutocorrectOptions = {
  enabled: true,
  smartQuotes: true,
  dashes: true,
  ellipsis: true,
  ordinals: true,
  capitalizeSentences: true,
  replaceText: true,
  replacements: { teh: 'the', '(c)': '\u00a9', USA: 'United States' },
};

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

/**
 * @purpose Builds an EditorView seeded with parsed markdown and the given autocorrect options.
 * @inputs markdown - Source text to parse; options - A thunk returning autocorrect configuration.
 * @outputs EditorView - A live editor view positioned at end of document.
 * @dataflow Markdown string -> parser -> mdast tree -> prose-mirror doc -> editor state -> view.
 * @controlflow Parse and build doc, create state with plugin, instantiate view, set selection, register for cleanup.
 */
function viewWith(markdown: string, options: () => AutocorrectOptions): EditorView {
  const doc = mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
  const state = EditorState.create({ doc, plugins: [createAutocorrectPlugin(options)] });
  const view = new EditorView(document.createElement('div'), { state });
  const end = TextSelection.atEnd(view.state.doc);
  view.dispatch(view.state.tr.setSelection(end));
  views.push(view);
  return view;
}

/**
 * @purpose Simulates typing a string one character at a time through ProseMirror's input handlers.
 * @inputs view - The editor to type into; text - The characters to enter in order.
 * @outputs void.
 * @dataflow Each char -> handleTextInput prop -> transaction insert or no-op.
 * @controlflow Loop over chars, attempt handler dispatch, fall back to plain insert when unhandled.
 */
function type(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, char, () => view.state.tr.insertText(char, from, to)));
    if (handled !== true) {
      view.dispatch(view.state.tr.insertText(char, from, to));
    } else {
      // An autocorrect input handler already consumed this character; leave the transaction untouched.
    }
  }
}

/**
 * @purpose Returns the concatenated text content of the editor's document.
 * @inputs view - The editor whose document text is read.
 * @outputs string - All visible text in the current document.
 * @dataflow Editor state doc -> textContent property -> returned string.
 * @controlflow Single accessor with no branching.
 */
function paragraphText(view: EditorView): string {
  return view.state.doc.textContent;
}

/**
 * @purpose Serializes the editor's document back to a Markdown string.
 * @inputs view - The editor whose document is serialized.
 * @outputs string - The round-tripped Markdown representation.
 * @dataflow Doc -> prose-mirror to mdast -> serializeDocument -> markdown string.
 * @controlflow Single conversion pipeline with no branching.
 */
function markdownOf(view: EditorView): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(view.state.doc), frontMatter: null });
}

describe('autocorrect', () => {
  // Verify smart-quote conversion for both double and single quotation marks.
  it('curls double and single quotes', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' "Hi," she said, \'it\'s fine\'');
    expect(paragraphText(view)).toBe('x \u201cHi,\u201d she said, \u2018it\u2019s fine\u2019');
  });

  // Verify en-dash and em-dash substitution based on surrounding context.
  it('turns hyphens into dashes', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' well--maybe and yes - no -- fine');
    expect(paragraphText(view)).toBe('x well\u2014maybe and yes \u2013 no \u2013 fine');
  });

  // Verify that three consecutive periods become a single horizontal ellipsis.
  it('turns three full stops into an ellipsis', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' wait...');
    expect(paragraphText(view)).toBe('x wait\u2026');
  });

  // Verify correct ordinals are wrapped while malformed ones are left untouched.
  it('raises a correct ordinal suffix and leaves a wrong one', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' the 21st and 12nd.');
    expect(markdownOf(view)).toBe('x the 21^st^ and 12nd.\n');
  });

  // Verify sentence-start capitalization is skipped after known abbreviations.
  it('capitalises the start of a sentence but not after an abbreviation', () => {
    const view = viewWith('Start.\n', () => ALL_ON);
    type(view, ' next one e.g. this');
    expect(paragraphText(view)).toBe('Start. Next one e.g. this');
    const initial = viewWith('Name.\n', () => ALL_ON);
    type(initial, ' by J. doe');
    expect(paragraphText(initial)).toBe('Name. By J. doe');
  });

  // Verify case-preserving replacements fire only on whole-word boundaries.
  it('replaces table entries at a word boundary, keeping a capital', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' Teh cat (c) steh USA.');
    expect(paragraphText(view)).toBe('x The cat \u00a9 steh United States.');
  });

  // Verify autocorrect is suppressed within inline and fenced code spans.
  it('does nothing inside inline code or a code block', () => {
    const inline = viewWith('`code`\n', () => ALL_ON);
    inline.dispatch(inline.state.tr.setSelection(TextSelection.create(inline.state.doc, 4)));
    type(inline, '"a"--...');
    expect(paragraphText(inline)).toBe('cod"a"--...e');
    const block = viewWith('```\ncode\n```\n', () => ALL_ON);
    type(block, ' "teh"... ');
    expect(block.state.doc.textContent).toBe('code "teh"... ');
  });

  // A code block counts as code by itself, whatever marks the caret has.
  it('reports a position in a code block as code', () => {
    const view = viewWith('Text\n\n```\ncode\n```\n', () => ALL_ON);
    expect(isInCode(view.state, view.state.doc.content.size - 2)).toBe(true);
    expect(isInCode(view.state, 2)).toBe(false);
  });

  // Verify toggles are re-read per keystroke so disabling takes effect immediately.
  it('does nothing when switched off, reading the switches as it types', () => {
    let options: AutocorrectOptions = { ...ALL_ON, enabled: false };
    const view = viewWith('x\n', () => options);
    type(view, ' "a"');
    expect(paragraphText(view)).toBe('x "a"');
    options = { ...ALL_ON, smartQuotes: false };
    type(view, ' "b" teh ');
    expect(paragraphText(view)).toBe('x "a" "b" the ');
  });

  // Verify undoInputRule reverts an applied autocorrect correction.
  it('lets Backspace undo a correction', () => {
    const view = viewWith('x\n', () => ALL_ON);
    type(view, ' wait...');
    expect(undoInputRule(view.state, view.dispatch)).toBe(true);
    expect(paragraphText(view)).toBe('x wait...');
  });

  // Verify the ordinal suffix selection table across representative numbers.
  it('works out ordinal suffixes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((n) => ['st', 'nd', 'rd', 'th'].find((suffix) => ordinalSuffixFits(String(n), suffix)))).toEqual(['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'rd', 'st', 'th']);
  });

  // Verify longest-match priority, whole-word boundaries, and no-op self-replacements.
  it('prefers the longest key and skips a replacement equal to the text', () => {
    expect(findReplacement('a (tm)', { tm: 'X', '(tm)': '\u2122' })).toEqual({ from: 2, value: '\u2122' });
    expect(findReplacement('say same', { same: 'same' })).toBeNull();
    expect(findReplacement('xteh', { teh: 'the' })).toBeNull();
    expect(findReplacement('usa', { USA: 'United States' })).toBeNull();
    expect(findReplacement('x ((c)', { '(c)': '\u00a9', '((c)': 'double' })).toEqual({ from: 2, value: 'double' });
  });
});
