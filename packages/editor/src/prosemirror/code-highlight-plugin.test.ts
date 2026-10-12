// @vitest-environment jsdom
/**
 * @file code-highlight-plugin.test.ts
 * @purpose Vitest test suite for K-Doc's code-block ProseMirror plugins (FR-8.8): code highlighting and code copy button.
 *   Verifies syntax highlighting for supported languages and aliases, plain rendering for unsupported grammars or missing languages,
 *   universal copy button decoration, and copy button DOM widget attributes and behavior.
 * @inputs ProseMirror EditorState instances built on kdocSchema, codeBlock nodes with varying languages and code contents, Lezer syntax highlighting parsers, and mock DOM view stubs.
 * @outputs Vitest assertions over ProseMirror DecorationSet states, token classes on inline decorations, and DOM button widget elements.
 * @functions
 *   - docWith: Constructs a test document containing a single codeBlock node with the given language and code.
 *   - highlightState: Creates an EditorState initialized with kdocSchema, a test code block doc, and the code highlight plugin.
 *   - copyState: Creates an EditorState initialized with kdocSchema, a test code block doc, and the code copy plugin.
 *   - classesIn: Extracts an array of CSS class names from inline syntax highlighting decorations in an EditorState.
 * @dataflow language & code -> docWith -> EditorState with plugin -> decoration inspection (classesIn / decoration queries) -> Vitest expect assertions.
 * @controlflow Setup test documents and states -> execute syntax highlighting and copy button plugins -> extract decorations and inspect attributes/DOM -> assert expectations.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { createCodeHighlightPlugin, codeHighlightPluginKey } from './code-highlight-plugin.js';
import { createCodeCopyPlugin, codeCopyPluginKey, CODE_COPY_CLASS } from './code-copy-plugin.js';

/**
 * Constructs a test document containing a single code block node.
 *
 * @purpose Builds a minimal ProseMirror document with a single codeBlock child having the specified language attribute and code text.
 * @inputs
 *   - language: string | null - The language identifier for the code block fence, or null for an unannotated fence.
 *   - code: string - The text content of the code block.
 * @outputs ProseMirrorNode - A ProseMirror document node containing the configured codeBlock.
 * @dataflow language & code -> create text node -> create codeBlock node -> wrap in doc node.
 * @controlflow Check if code is non-empty -> create text node if present -> instantiate codeBlock with attrs -> wrap in doc node -> return doc.
 */
function docWith(language: string | null, code: string): ProseMirrorNode {
  let content: ProseMirrorNode[];
  // Check whether the code string is non-empty, since ProseMirror throws on empty text nodes.
  if (code.length > 0) {
    // Non-empty code: wrap the text in a ProseMirror text node.
    content = [kdocSchema.text(code)];
  } else {
    // Empty code: supply an empty array of content nodes.
    content = [];
  }

  return kdocSchema.node('doc', null, [
    kdocSchema.node('codeBlock', { language, meta: null }, content),
  ]);
}

/**
 * Creates an EditorState initialized with kdocSchema, a test code block document, and the code highlight plugin.
 *
 * @purpose Builds a ProseMirror EditorState containing a code block document with the code highlight plugin installed.
 * @inputs
 *   - language: string | null - The language identifier for the code block fence, or null.
 *   - code: string - The text content of the code block.
 * @outputs EditorState - The initialized EditorState with code highlight plugin active.
 * @dataflow language & code -> docWith -> EditorState.create with createCodeHighlightPlugin.
 * @controlflow Generate test document via docWith -> instantiate EditorState with schema and createCodeHighlightPlugin() -> return state.
 */
function highlightState(language: string | null, code: string): EditorState {
  return EditorState.create({
    doc: docWith(language, code),
    schema: kdocSchema,
    plugins: [createCodeHighlightPlugin()],
  });
}

/**
 * Creates an EditorState initialized with kdocSchema, a test code block document, and the code copy plugin.
 *
 * @purpose Builds a ProseMirror EditorState containing a code block document with the code copy plugin installed.
 * @inputs
 *   - language: string | null - The language identifier for the code block fence, or null.
 *   - code: string - The text content of the code block.
 * @outputs EditorState - The initialized EditorState with code copy plugin active.
 * @dataflow language & code -> docWith -> EditorState.create with createCodeCopyPlugin.
 * @controlflow Generate test document via docWith -> instantiate EditorState with schema and createCodeCopyPlugin() -> return state.
 */
function copyState(language: string | null, code: string): EditorState {
  return EditorState.create({
    doc: docWith(language, code),
    schema: kdocSchema,
    plugins: [createCodeCopyPlugin()],
  });
}

/**
 * Extracts an array of CSS class names from inline syntax highlighting decorations in an EditorState.
 *
 * @purpose Reads the code highlight plugin's DecorationSet and extracts the CSS class strings from all inline decorations.
 * @inputs
 *   - state: EditorState - The ProseMirror EditorState to inspect for syntax highlighting decorations.
 * @outputs string[] - Array of CSS class names associated with inline decorations, or empty array if uninitialized.
 * @dataflow state -> codeHighlightPluginKey.getState -> decorations.find() -> extract d.type.attrs.class -> string[].
 * @controlflow Read plugin state -> check if undefined (return empty array) -> map decorations extracting class attribute -> return array.
 */
function classesIn(state: EditorState): string[] {
  const decorations = codeHighlightPluginKey.getState(state);

  // Check whether the code highlight plugin state exists on this EditorState.
  if (decorations === undefined) {
    // Plugin absent or uninitialized: return an empty list of classes.
    return [];
  } else {
    // Plugin present: map each inline decoration in its set to its CSS class attribute.
    // Decoration.inline's third argument is the attribute set, so the class lives on the
    // decoration's type rather than on spec.
    return decorations
      .find()
      .map((d) => (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class ?? '');
  }
}

describe('code-block plugins', () => {
  it('never emits a decoration with no class', () => {
    // Pins that syntax highlighting never emits a decoration with an empty class for unclassified tokens.
    const state = highlightState('javascript', 'const x = 1; // note');

    // Whitespace and punctuation come back from the highlighter unclassified, and a decoration
    // carrying no class is a DOM node that changes nothing — the check would pass vacuously without the
    // non-empty guard, which is why both assertions are here.
    expect(classesIn(state).length).toBeGreaterThan(0);
    expect(classesIn(state).every((c) => c.length > 0)).toBe(true);
  });

  it('keeps its offsets across a line break', () => {
    // Pins that token decoration offsets remain accurate across line breaks by stepping the cursor over newlines.
    const code = 'let a = 1;\nconst b = 2;';
    const state = highlightState('javascript', code);
    const found = codeHighlightPluginKey.getState(state)?.find() ?? [];

    // The plugin walks the highlighted tokens with an offset cursor, and a newline contributes no token
    // but still occupies one position. If the cursor failed to step over it, every decoration after the first line
    // would sit one character too early — which a single-line fixture can never notice.
    expect(found.some((d) => d.from === 12 && d.to === 17)).toBe(true);
  });

  it('highlights a language it has a parser for', () => {
    // Pins that code blocks with supported languages receive syntax highlighting decorations from Lezer.
    const state = highlightState('javascript', 'const x = 1;');
    const classes = classesIn(state);

    // const is a keyword in every JavaScript grammar, so this pins that a real parse happened rather than that decorations merely exist.
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.some((c) => c.includes('tok-keyword'))).toBe(true);
  });

  it('accepts the aliases people actually write', () => {
    // Pins that common language fence aliases like 'js' resolve to the corresponding Lezer parser.
    const state = highlightState('js', 'const x = 1;');
    const classes = classesIn(state);

    // A fence says js far more often than javascript, and a table that only knew the
    // long name would highlight almost nothing.
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.some((c) => c.includes('tok-keyword'))).toBe(true);
    expect(classes).toEqual(classesIn(highlightState('javascript', 'const x = 1;')));
  });

  it('leaves a language it has no parser for alone', () => {
    // Pins that unsupported languages are left unhighlighted rather than incorrectly guessed.
    const state = highlightState('bash', 'echo hi');

    // A wrong grammar produces confident, wrong colours, so plain is the honest output.
    expect(classesIn(state)).toEqual([]);
  });

  it('leaves a fence with no language alone', () => {
    // Pins that a code block without any language attribute produces no highlight decorations.
    const state = highlightState(null, 'plain text');

    // Fences with no language annotation must remain completely plain without syntax decorations.
    expect(classesIn(state)).toEqual([]);
  });

  it('puts a copy button on every fence, highlighted or not', () => {
    // Pins that every code block receives a copy button widget decoration regardless of language support.
    const state = copyState('bash', 'echo hi');

    // Copying has nothing to do with the grammar, which is why the two plugins are separate —
    // tying them together would cost a bash block its copy button for an unrelated reason.
    expect(codeCopyPluginKey.getState(state)?.find().length).toBe(1);
  });

  it('renders the button as a real, non-editable control', () => {
    // Pins that the copy button widget renders a real, non-editable DOM button element with expected attributes and text.
    const state = copyState('bash', 'echo hi');
    const decorations = codeCopyPluginKey.getState(state)?.find() ?? [];
    const deco = decorations[0];

    // Check if a copy button widget decoration exists at index 0 under noUncheckedIndexedAccess.
    if (deco === undefined) {
      // Decoration missing: throw to satisfy compiler and fail loudly.
      throw new Error('expected one copy button decoration');
    } else {
      // Decoration found: extract DOM factory and render widget element using stub view.
    }

    const widgetType = (deco as unknown as { type: { toDOM: (view: unknown) => HTMLElement } }).type;
    const element = widgetType.toDOM({ dom: { ownerDocument: document } });

    // Assert that the rendered button has the expected class name, contenteditable attribute, and label text.
    expect(element.className).toBe(CODE_COPY_CLASS);
    // contenteditable="false" is what keeps the button out of the text a copy produces —
    // a copy button that copies itself is the failure this guards.
    expect(element.getAttribute('contenteditable')).toBe('false');
    expect(element.textContent).toBe('Copy');
  });
});
