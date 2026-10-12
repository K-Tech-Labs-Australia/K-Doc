/**
 * @file code-highlight-plugin.ts
 * @purpose ProseMirror plugin providing syntax highlighting inside code blocks in the WYSIWYG pane (FR-8.8).
 *   The rendered view is the WYSIWYG pane — Preview makes it read-only rather than swapping in a second
 *   renderer — so highlighting happens there.
 *   It reuses the same Lezer parsers the Source pane already loads. A second highlighting engine would
 *   colour the same code two different ways in two panes of one window, and the only thing worse than no
 *   highlighting is highlighting that disagrees with itself.
 *   Only languages K-Doc already ships a parser for are highlighted; anything else renders plain, because a wrong
 *   grammar produces confident, wrong colours.
 * @inputs ProseMirror EditorState instances, Transactions, and codeBlock document nodes with language attributes.
 * @outputs ProseMirror Plugin managing a DecorationSet of inline syntax highlighting decorations, keyed by codeHighlightPluginKey.
 * @functions
 *   - createCodeHighlightPlugin: Instantiates the ProseMirror plugin providing syntax highlighting decorations for code blocks.
 * @dataflow Document codeBlock nodes -> extract language and text -> parse with Lezer -> walk tokens via highlightCode -> accumulate inline decorations -> DecorationSet -> view.
 * @controlflow Initialize decorations on plugin init -> on transaction apply: return existing mapped decorations if doc unchanged, rebuild decorations if doc changed -> props.decorations exposes DecorationSet.
 * @version 1
 * @date 2026-09-11
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import type { Parser } from '@lezer/common';
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { markdownLanguage } from '@codemirror/lang-markdown';

/**
 * Plugin key uniquely identifying the code block syntax highlighting plugin and its state in an EditorState.
 */
export const codeHighlightPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('codeHighlightPlugin');

/**
 * Lookup table mapping lower-case language identifiers and common fence aliases to Lezer parsers.
 * The aliases (e.g., 'js', 'jsx', 'ts', 'tsx', 'md') reflect the names people actually write in a fence.
 * A fence saying 'sh' or 'python' is left plain rather than guessed at, because only languages K-Doc already
 * ships a parser for are highlighted; a wrong grammar produces confident, wrong colours.
 */
const PARSERS: ReadonlyMap<string, Parser> = new Map<string, Parser>([
  ['javascript', javascriptLanguage.parser],
  ['js', javascriptLanguage.parser],
  ['jsx', javascriptLanguage.parser],
  ['typescript', typescriptLanguage.parser],
  ['ts', typescriptLanguage.parser],
  ['tsx', typescriptLanguage.parser],
  ['css', cssLanguage.parser],
  ['html', htmlLanguage.parser],
  ['markdown', markdownLanguage.parser],
  ['md', markdownLanguage.parser],
]);

/**
 * Resolves a Lezer parser for the given language identifier attribute.
 *
 * @purpose Maps a raw language attribute from a code block node to an available Lezer parser.
 * @inputs language - Unknown attribute value from node.attrs.language.
 * @outputs Parser | null - The matching Lezer parser instance, or null if unsupported or non-string.
 * @dataflow Raw language attribute -> validate string type -> trim and lower-case -> lookup in PARSERS map -> Parser or null.
 * @controlflow Check typeof language === 'string' -> if not string return null -> normalize name -> check map lookup -> return Parser or null.
 */
function parserFor(language: unknown): Parser | null {
  // Check if the provided language attribute is a valid string.
  if (typeof language !== 'string') {
    // Non-string language attribute (undefined, null, or invalid type): cannot resolve a parser.
    return null;
  } else {
    // String language attribute: trim whitespace and convert to lower case for lookup.
    const normalized: string = language.trim().toLowerCase();
    const parser: Parser | undefined = PARSERS.get(normalized);

    // Check if a parser exists in the table for the normalized language name.
    if (parser !== undefined) {
      // Known language grammar: return the registered Lezer parser.
      return parser;
    } else {
      // Unknown language grammar: return null so the block renders plain without guessing.
      return null;
    }
  }
}

/**
 * Scans the document for code blocks and builds a DecorationSet of syntax highlighting tokens.
 *
 * @purpose Traverses all nodes in the document, identifies code blocks with supported languages, parses their content with Lezer, and generates inline decorations for highlighted tokens.
 * @inputs state - The ProseMirror EditorState whose document is scanned for code blocks.
 * @outputs DecorationSet - The complete set of inline token decorations for all recognized code blocks.
 * @dataflow state.doc -> iterate descendants -> filter codeBlock -> parse text with Lezer -> highlightCode callbacks -> push Decoration.inline -> DecorationSet.create.
 * @controlflow Traverse doc nodes via descendants -> skip non-codeBlock nodes (return true) -> lookup parser for language -> bail if unsupported (return false) -> highlight tokens -> return DecorationSet.
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    // Check if the current node is not a code block.
    if (node.type.name !== 'codeBlock') {
      // Not a code block: return true to continue descending into child nodes.
      return true;
    } else {
      // Node is a code block: resolve the parser for its language attribute.
      const parser = parserFor(node.attrs.language);

      // Check if a valid parser was resolved for the code block language.
      if (parser === null) {
        // An unknown grammar means no decorations, and returning false skips the block's text children because there is nothing inside worth walking.
        return false;
      } else {
        // Known grammar: extract the text content and parse a syntax tree.
        const text: string = node.textContent;
        const tree = parser.parse(text);

        // pos + 1 is the first character inside the block, because pos is the block node itself.
        let cursor: number = pos + 1;

        highlightCode(
          text,
          tree,
          classHighlighter,
          (code: string, classes: string): void => {
            // Check if the highlighter assigned one or more CSS classes to this token.
            if (classes.length > 0) {
              // Token has classes: emit an inline decoration spanning the token range.
              decorations.push(
                Decoration.inline(cursor, cursor + code.length, {
                  class: classes,
                }),
              );
            } else {
              // Unclassified text needing no decoration — a decoration with no class would be a wasted node.
            }
            // Always advance cursor by token length afterwards, outside the branch.
            cursor += code.length;
          },
          (): void => {
            // A newline occupies one position and contributes no decoration.
            cursor += 1;
          },
        );

        // Returning false skips the block's text children because syntax decorations are already generated.
        return false;
      }
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Creates the ProseMirror plugin that provides syntax highlighting inside code blocks (FR-8.8).
 *
 * @purpose Instantiates and configures the ProseMirror plugin that computes and maintains syntax highlighting decorations for code blocks.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror plugin instance managing code block syntax highlighting.
 * @dataflow Dispatched transactions -> apply() updates or maps DecorationSet -> decorations() returns active DecorationSet to view.
 * @controlflow Instantiate Plugin with codeHighlightPluginKey -> state.init builds initial decorations -> state.apply rebuilds on doc changes or maps on selection changes -> props.decorations retrieves state decorations.
 */
export function createCodeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeHighlightPluginKey,
    state: {
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial syntax highlighting decorations from the initial document state.
        return buildDecorations(state);
      },
      apply(tr: Transaction, value: DecorationSet, _old: EditorState, newState: EditorState): DecorationSet {
        // Check whether the document content was modified by this transaction.
        if (!tr.docChanged) {
          // Document did not change: a selection change moves no text and re-parsing every block for it would be waste; map existing decorations across transaction mapping.
          return value.map(tr.mapping, tr.doc);
        } else {
          // Document changed: re-parsing is the price of correct colours and is only paid when the document actually changed.
          return buildDecorations(newState);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        // Return active decoration set from plugin state, defaulting to empty set when state is uninitialized.
        return codeHighlightPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
