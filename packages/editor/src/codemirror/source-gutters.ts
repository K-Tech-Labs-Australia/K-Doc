/**
 * @file source-gutters.ts
 * @purpose Composes the CodeMirror extensions that provide the three Source-pane affordances FR-5.2 names — line numbers, code folding, and bracket matching — for K-Doc's editor. This is a composition of existing CodeMirror pieces rather than a new implementation; it exists as its own file for the same reason multi-caret.ts does: the binding is a wiring file, and a named group of extensions with its own rationale is easier to read there than five bare calls in a list.
 * @inputs void — the extensions are self-contained and require no session or view state to be constructed. Folding behaviour comes from `@codemirror/lang-markdown`, not from this module (see @note).
 * @outputs an ordered array of CodeMirror Extensions returned by createSourceGutterExtensions(), plus a standalone theme Extension from sourceGutterTheme() that the host passes into EditorState.create alongside markdown() and createSourceKeymap().
 * @functions
 *   - createSourceGutterExtensions: Returns the ordered list of extensions enabling line numbers, folding, and bracket matching in the Source pane.
 *   - sourceGutterTheme: Returns a CodeMirror theme Extension styling the gutters to K-Doc's palette.
 * @dataflow (none) — this file produces configuration objects only; no data flows through it, extension descriptors are simply returned.
 * @controlflow Build an ordered array of five extensions in dependency order and return it from createSourceGutterExtensions(); sourceGutterTheme() builds a single theme object literal and returns it. There is no branching or state to transition.
 * @note Folding comes from the Markdown language, not from here: `@codemirror/lang-markdown` registers a foldService that folds a heading's section and a foldNodeProp for fenced blocks and quotes, so foldGutter() finds ranges without any configuration. A different language in the pane would fold differently, which is correct.
 * @note foldGutter() already brings codeFolding() with it, so the fold state is not installed separately here.
 * @version 1
 * @date 2026-09-10
 */

import type { Extension } from '@codemirror/state';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { foldGutter, foldKeymap, bracketMatching } from '@codemirror/language';

/**
 * @purpose Composes the CodeMirror extensions enabling line numbers, code folding, and bracket matching for K-Doc's Source pane (FR-5.2).
 * @inputs void.
 * @outputs readonly Extension[] — a five-element array of extensions in dependency order.
 * @dataflow No data flows through this function; it assembles extension descriptors and returns them.
 * @controlflow Returns an ordered array literal: line numbers first, then fold gutter, the fold keymap, bracket matching, and finally the theme. There is no branching or state to transition.
 */
export function createSourceGutterExtensions(): readonly Extension[] {
  return [
    // Line numbers are the leftmost gutter because they name the line — it is the line's identity — whereas everything else in the margin describes the line rather than naming it, so this goes first and is called bare (no domEventHandlers option).
    lineNumbers(),

    // The fold arrows appear only on lines the language reports as foldable, so a document of plain paragraphs shows an empty column rather than a row of dead controls; foldGutter() also brings codeFolding() with it. Called bare.
    foldGutter(),

    // keymap binds Ctrl-Shift-[ / Ctrl-Shift-] to fold and unfold the range at the caret, and Ctrl-Alt-[ / Ctrl-Alt-] to fold and unfold everything; K-Doc claims none of those shortcuts here, so nothing is being shadowed.
    keymap.of(foldKeymap),

    // Bracket matching highlights the partner of the bracket beside the caret using the syntax tree. In
    // Markdown that covers both the link and image delimiters in prose and ordinary punctuation inside a
    // fenced block, because lang-markdown gives the fence's contents their own nodes. Called bare.
    bracketMatching(),

    sourceGutterTheme(),
  ];
}

/**
 * @purpose Styles the Source pane's gutters (line numbers, fold arrows, active line, brackets) to K-Doc's palette so they read as part of the same editor chrome.
 * @inputs void.
 * @outputs Extension — a CodeMirror theme Extension that the host passes into EditorState.create alongside markdown() and createSourceKeymap().
 * @dataflow No data flows through this function; it builds a single theme object literal and returns it.
 * @controlflow Returns an EditorView.theme(...) call with one rule per gutter affordance; there is no branching or state to transition.
 */
export function sourceGutterTheme(): Extension {
  return EditorView.theme({
    // The gutter background follows the subtle surface so the margin recedes behind the text rather than competing with it.
    '.cm-gutters': {
      background: 'var(--kdoc-color-background-subtle)',
      color: 'var(--kdoc-color-text-muted)',
      border: 'none',
    },

    // Line numbers are given left padding and a minimum width so the number column stays aligned with the text block regardless of digit count.
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 0.5rem 0 1rem',
      minWidth: '2.5rem',
    },

    // Fold arrows get tight horizontal padding and a pointer cursor so the small triangle reads as an affordance rather than dead text.
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 0.25rem',
      cursor: 'pointer',
    },

    // The active line's number is brightened rather than given a background band, because the change bar and the fold arrow share that column and a band behind them reads as a highlight on *them*.
    '.cm-activeLineGutter': {
      background: 'transparent',
      color: 'var(--kdoc-color-text)',
    },

    // The matched bracket partner is filled with the selection colour and outlined so it stays legible against both light and dark surfaces.
    '.cm-matchingBracket': {
      background: 'var(--kdoc-color-selection)',
      outline: '1px solid var(--kdoc-color-border-strong)',
    },

    // A non-matched bracket is coloured danger to signal the unbalanced delimiter without relying on shape alone.
    '.cm-nonmatchingBracket': {
      color: 'var(--kdoc-color-danger)',
    },
  });
}
