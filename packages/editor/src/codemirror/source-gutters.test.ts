// @vitest-environment jsdom
/**
 * @file source-gutters.test.ts
 * @purpose Vitest suite proving that the three stock CodeMirror affordances composed by ./source-gutters.js — line numbers, code folding, and bracket matching — actually find something in Markdown rather than merely being present. Because these are existing extensions (not new implementations), what is worth testing is not their existence but that lang-markdown's fold service publishes ranges for headings and its bracket matcher recognises link delimiters; a suite that never asked whether the language folds anything would pass on a pane whose fold column is empty, so every case queries real behaviour.
 * @inputs The markdown() language extension, createSourceGutterExtensions(), EditorState/EditorView from @codemirror/state and @codemirror/view, and foldable/matchBrackets/ensureSyntaxTree from @codemirror/language — all exercised against a small Markdown fixture so no session or network state is required.
 * @outputs Pass/fail assertions pinning: the heading owns a fold range extending past its own line, the standalone paragraph yields no fold, the link's brackets match with matched=true, and at least one live gutter number element renders '1'.
 * @functions
 *   - makeState: Builds an EditorState carrying markdown() plus the source-gutter extensions, forcing a syntax tree so lazy parsing cannot answer null for reasons unrelated to the extensions.
 *   - lineAt: Returns the DocumentLine at a 1-based line number from state.doc.line().
 * @dataflow Test builds state via makeState -> queries foldable/matchBrackets against the parsed Markdown tree, or mounts an EditorView and reads .cm-lineNumbers DOM nodes for the gutter assertion.
 * @controlflow A single describe('source-gutters') block runs four independent it() cases; each derives its own state from makeState so tests never share mutable syntax trees or mounted views.
 * @version 1
 * @date 2026-09-10
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { foldable, matchBrackets, ensureSyntaxTree } from '@codemirror/language';
import { createSourceGutterExtensions } from './source-gutters.js';

// A heading that owns the two lines beneath it, then a standalone paragraph that owns nothing.
const TEXT = [
  '# Heading',
  '',
  'Body under the heading.',
  '',
  'A [link](https://example.com) alone.',
].join('\n');

/**
 * @purpose Builds an EditorState carrying markdown() plus the source-gutter extensions so fold and bracket queries run against real Markdown syntax.
 * @inputs none; uses the shared TEXT document.
 * @outputs A fresh EditorState whose lazily-parsed Markdown tree is guaranteed present (via ensureSyntaxTree) before any query runs.
 * @dataflow TEXT -> EditorState.create with [markdown(), ...createSourceGutterExtensions()] -> ensureSyntaxTree forces parsing of the full doc length within a 5000ms budget.
 * @controlflow Create state, then call ensureSyntaxTree(state, state.doc.length, 5000) before returning; no branching — every test derives from this so syntax-tree availability is uniform across cases.
 */
function makeState(): EditorState {
  const state = EditorState.create({ doc: TEXT, extensions: [markdown(), ...createSourceGutterExtensions()] });

  // The Markdown tree is parsed lazily by lang-markdown, so a fold or bracket query against an unparsed document would answer null for reasons that have nothing to do with the source-gutter extensions; forcing it here isolates the extension behaviour under test.
  ensureSyntaxTree(state, state.doc.length, 5000);

  return state;
}

/**
 * @purpose Returns the DocumentLine at a 1-based line number for fold queries that need from/to offsets.
 * @inputs state - EditorState whose document is queried; oneBasedLine - the human-facing line number (1 = first line).
 * @outputs The DocumentLine value returned by state.doc.line(oneBasedLine), carrying .from and .to offsets.
 * @dataflow Test-provided 1-based index -> state.doc.line() -> Line object handed back to caller for foldable().
 * @controlflow Single accessor, no branching — keeps line offset extraction in one place so test bodies stay declarative.
 */
function lineAt(state: EditorState, oneBasedLine: number) {
  return state.doc.line(oneBasedLine);
}

describe('source-gutters', () => {
  it('folds the section a heading owns', () => {
    // Pins that lang-markdown's fold service (not the gutter itself) reports a range for the '# Heading' line whose extent reaches past the heading's own end — the heading owns everything down to the next same-level heading or document end, so this is the language speaking through foldGutter().
    const state = makeState();
    const line1 = lineAt(state, 1);

    const range = foldable(state, line1.from, line1.to);

    expect(range).not.toBeNull();
    // The folded section must extend beyond the heading's own line to prove it owns the body beneath.
    const folded = range as { to: number };
    expect(folded.to).toBeGreaterThan(line1.to);
  });

  it('offers no fold on a line that owns nothing', () => {
    // Pins that the standalone paragraph 'A [link](...) alone.' yields null, so the gutter shows an empty cell rather than a dead control — this is exactly why foldGutter() is called bare instead of configured to always draw arrows.
    const state = makeState();
    const line5 = lineAt(state, 5);

    expect(foldable(state, line5.from, line5.to)).toBeNull();
  });

  it("matches a link's brackets", () => {
    // Pins that the matcher recognises a Markdown link's delimiters. The direction argument is the thing
    // to get right: dir 1 reads the bracket AT the given offset and scans forward, dir -1 reads the bracket
    // ENDING at it and scans back. An opening '[' is therefore queried at its own offset with dir 1;
    // asking at offset + 1 with dir -1 finds a closing bracket that is not there and answers null.
    const open = TEXT.indexOf('[');
    const close = TEXT.indexOf(']');

    expect(open).toBeGreaterThanOrEqual(0);

    const state = makeState();
    const result = matchBrackets(state, open, 1);

    expect(result).not.toBeNull();
    // matched=true confirms a partner was found, and its offset confirms the partner is the right one:
    // a matcher that paired the '[' with anything else would still report matched.
    const bracket = result as { matched: boolean; end?: { from: number } };
    expect(bracket.matched).toBe(true);
    expect(bracket.end?.from).toBe(close);
  });

  it('highlights the matching bracket in the view', () => {
    // matchBrackets() above is a pure function of the language and answers the same whether or not
    // bracketMatching() is installed - removing it breaks no state-level test. This one puts the caret
    // beside the link's '[' in a mounted view and asks whether anything was actually painted.
    const open = TEXT.indexOf('[');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let view: EditorView | undefined;

    try {
      const state = EditorState.create({
        doc: TEXT,
        extensions: [markdown(), ...createSourceGutterExtensions()],
        selection: { anchor: open },
      });
      ensureSyntaxTree(state, state.doc.length, 5000);
      view = new EditorView({ state, parent });

      expect(view.dom.querySelectorAll('.cm-matchingBracket').length).toBeGreaterThanOrEqual(1);
    } finally {
      // Torn down the same way as the other view cases, and for the same reason.
      if (view !== undefined) {
        view.destroy();
      } else {
        // The view was never built; only the mount point needs removing.
      }
      parent.remove();
    }
  });

  it('installs the fold gutter beside the numbers', () => {
    // foldable() above proves the LANGUAGE publishes fold ranges, which it would do whether or not the
    // gutter that draws them were installed - removing foldGutter() breaks no other test here. This is the
    // one that notices, by asking the mounted view for the column itself.
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let view: EditorView | undefined;

    try {
      view = new EditorView({ state: makeState(), parent });

      expect(view.dom.querySelectorAll('.cm-foldGutter').length).toBeGreaterThanOrEqual(1);
    } finally {
      // Torn down the same way as the numbering case, and for the same reason.
      if (view !== undefined) {
        view.destroy();
      } else {
        // The view was never built; only the mount point needs removing.
      }
      parent.remove();
    }
  });

  it('numbers every line in the gutter', () => {
    // Pins that a live view actually paints line-number gutter cells by reading the DOM, asserting membership ('1' present) rather than an exact count because CodeMirror renders a spacer element first.
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let view: EditorView | undefined;

    try {
      // Mounting with makeState() installs markdown(), the source-gutter extensions, and (via makeState) a forced syntax tree so line numbers render against real content.
      view = new EditorView({ state: makeState(), parent });

      // Query the leftmost gutter's rendered number cells; .cm-lineNumbers is CM's built-in class for the line-number gutter.
      const numbers = view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement');

      expect(numbers.length).toBeGreaterThanOrEqual(1);

      // Membership check: at least one cell must display '1' so we know numbering starts and renders text, without pinning an exact count against the doc's line total (a spacer element is rendered first).
      const texts = Array.from(numbers).map((el) => el.textContent ?? '');
      expect(texts).toContain('1');
    } finally {
      // Teardown in a finally so a failed assertion cannot leak a mounted view into the next test; destroy() releases CM resources and remove() detaches from DOM.
      // A constructor that threw leaves nothing to destroy, so the view is only torn down when it exists.
      if (view !== undefined) {
        view.destroy();
      } else {
        // The view was never built; only the mount point needs removing.
      }
      parent.remove();
    }
  });
});
