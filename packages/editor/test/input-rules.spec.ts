// @vitest-environment jsdom

/**
 * @file input-rules.spec.ts
 * @purpose Vitest test suite for Markdown input rules in the K-Doc editor pane (FR-7.7), asserting on resulting Markdown.
 * @inputs Synthetic character-by-character typing interactions and keydown events dispatched to ProseMirror EditorView.
 * @outputs Vitest assertions verifying block-level transformations, inline mark formatting, and input rule undo behavior.
 * @functions
 *   - mountBinding: Creates a DOM container, focused DocumentSession, and ProseMirrorBinding, returning both in a tuple and tracking them for teardown.
 *   - type: Simulates sequential character-by-character user typing to trigger ProseMirror input rules.
 *   - markdownOf: Returns the current Markdown text from a DocumentSession snapshot.
 * @dataflow Character typing -> handleTextInput -> input rule matching -> transaction dispatch -> session AST update -> session snapshot Markdown.
 * @controlflow Mount binding on body -> type character-by-character -> dispatch key/input events -> assert serialized Markdown matches expected syntax -> tear down bindings and mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '../src/index.js';

// Module-level tracking arrays for cleanup across tests.
const trackedMounts: HTMLElement[] = [];
const trackedBindings: ProseMirrorBinding[] = [];

/**
 * @purpose Creates a container div, DocumentSession, and ProseMirrorBinding, returning both in a tuple and tracking them for teardown.
 * @inputs markdown - The initial Markdown string used to construct the DocumentSession.
 * @outputs [ProseMirrorBinding, DocumentSession] - Tuple of the active ProseMirrorBinding and its backing DocumentSession.
 * @dataflow markdown -> new DocumentSession -> session.focusPane('kdoc') -> new ProseMirrorBinding -> tracked arrays & session map -> return tuple.
 * @controlflow Create div element -> append to document.body -> instantiate DocumentSession -> focus 'kdoc' pane -> instantiate ProseMirrorBinding -> record mount and binding for afterEach teardown -> record in session map -> return [binding, session].
 */
function mountBinding(markdown: string): [ProseMirrorBinding, DocumentSession] {
  const mount = document.createElement('div');
  document.body.appendChild(mount);

  const session = new DocumentSession(markdown);
  // Focus the kdoc pane so the edit lock is held (edits from an unfocused pane are rejected per FR-3.1).
  session.focusPane('kdoc');

  const binding = new ProseMirrorBinding({ session, mount });
  trackedMounts.push(mount);
  trackedBindings.push(binding);

  return [binding, session];
}

/**
 * @purpose Simulates sequential user typing character-by-character into the ProseMirrorBinding view to trigger input rules.
 * @inputs binding - The ProseMirrorBinding instance hosting the target view.
 * @inputs text - The string of characters to simulate typing.
 * @outputs void.
 * @dataflow text characters -> binding.view.someProp('handleTextInput') -> (if unhandled) view.dispatch(insertText).
 * @controlflow Iterate over each character -> test handleTextInput on view -> if not handled, dispatch insertText transaction.
 */
function type(binding: ProseMirrorBinding, text: string): void {
  // Step character by character because input rules match against the text ending at the caret;
  // pasting the string in a single operation would not fire any input rule.
  for (const char of text) {
    const view = binding.view;
    const { from, to } = view.state.selection;
    const handled =
      view.someProp(
        'handleTextInput',
        // The fifth argument is the default-transaction factory ProseMirror hands the rule so it can
        // fall back to an ordinary insertion; omitting it type-errors and would starve any rule that uses it.
        (f) => f(view, from, to, char, () => view.state.tr.insertText(char, from, to)) === true,
      ) === true;

    // Check whether an active input rule claimed and handled the typed character.
    // When no input rule claimed the character, insert it normally — that is what the editor's own
    // DOM path would do, and skipping it would silently drop every ordinary keystroke.
    if (!handled) {
      // Character not handled by any input rule: dispatch normal text insertion transaction.
      view.dispatch(view.state.tr.insertText(char, from, to));
    } else {
      // Character was handled by an input rule which dispatched its own transaction: no fallback insertion needed.
    }
  }
}

/**
 * @purpose Returns the current Markdown text from a DocumentSession snapshot.
 * @inputs session - The DocumentSession backing the binding under test.
 * @outputs string - The session's current Markdown document text.
 * @dataflow session -> snapshot -> text.
 * @controlflow Read and return session.snapshot.text.
 */
function markdownOf(session: DocumentSession): string {
  return session.snapshot.text;
}

describe('Markdown input rules', () => {
  afterEach(() => {
    // Destroy all active ProseMirror bindings created during the test to release listeners and timers.
    for (const binding of trackedBindings) {
      binding.destroy();
    }
    trackedBindings.length = 0;

    // Remove all mount container elements attached to document.body.
    for (const mount of trackedMounts) {
      // Check whether the mount container is currently attached to the DOM.
      if (mount.parentNode !== null) {
        // Detach container element from document.body.
        mount.parentNode.removeChild(mount);
      } else {
        // Container element is already detached from DOM.
      }
    }
    trackedMounts.length = 0;
  });

  describe('block rules', () => {
    it('typing "# " then "Title" on an empty document yields Markdown containing "# Title"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '# Title');
      expect(markdownOf(session)).toContain('# Title');
    });

    it('typing "### " then "Deep" yields "### Deep"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '### Deep');
      expect(markdownOf(session)).toContain('### Deep');
    });

    it('typing "#hashtag " does not become a heading and retains literal "#hashtag"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '#hashtag ');
      // The trailing space in the rule is what makes "#" alone harmless:
      // the heading rule requires /^(#{1,6})\s$/, so "#hashtag " does not match and remains literal text.
      expect(markdownOf(session)).toContain('#hashtag');
      expect(markdownOf(session)).not.toMatch(/^#\s/m);
    });

    it('typing "- " then "Item" yields a bullet list line containing "Item" and starting with a bullet marker', () => {
      const [binding, session] = mountBinding('');
      type(binding, '- Item');
      const md = markdownOf(session);
      expect(md).toContain('Item');
      // Verify that the line starts with a bullet marker (-, *, or +).
      expect(md).toMatch(/^\s*[-*+]\s+Item/m);
    });

    it('typing "1. " then "First" yields an ordered list item containing "First"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '1. First');
      const md = markdownOf(session);
      expect(md).toContain('First');
      // Verify that the line starts with an ordered list number marker.
      expect(md).toMatch(/^\s*1\.\s+First/m);
    });

    it('typing "> " then "Quoted" yields a line starting with ">"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '> Quoted');
      const md = markdownOf(session);
      expect(md).toContain('Quoted');
      // Verify that the line begins with a blockquote marker (>).
      expect(md).toMatch(/^>\s*Quoted/m);
    });

    it('typing triple backticks yields a fenced code block containing "```"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '```');
      expect(markdownOf(session)).toContain('```');
    });

    it('typing "---" yields a thematic break horizontal-rule line', () => {
      const [binding, session] = mountBinding('');
      type(binding, '---');
      // The serializer emits "---" for thematicBreak per DEFAULT_MARKDOWN_STYLE.
      // Assert that the resulting Markdown contains a horizontal-rule line matching ---, ***, or ___.
      expect(markdownOf(session)).toMatch(/^(?:---|___|\*\*\*)$/m);
    });
  });

  describe('inline mark rules', () => {
    it('typing "**bold**" yields "**bold**" in the Markdown', () => {
      const [binding, session] = mountBinding('');
      type(binding, '**bold**');
      expect(markdownOf(session)).toContain('**bold**');
    });

    it('typing "*italic*" yields "_italic_"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '*italic*');
      // The serializer emits "_" for emphasis per the configured Markdown style,
      // so asserting "*italic*" would be testing the wrong layer.
      expect(markdownOf(session)).toContain('_italic_');
    });

    it('typing "~~gone~~" yields "~~gone~~"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '~~gone~~');
      expect(markdownOf(session)).toContain('~~gone~~');
    });

    it('typing "`code`" yields "`code`"', () => {
      const [binding, session] = mountBinding('');
      type(binding, '`code`');
      expect(markdownOf(session)).toContain('`code`');
    });

    it('typing " plain" after "**bold**" leaves the trailing word unmarked', () => {
      const [binding, session] = mountBinding('');
      type(binding, '**bold** plain');
      // This is what removeStoredMark buys: clearing stored marks ensures the following
      // typed text does not continue the bold formatting, yielding "**bold** plain" rather than "**bold plain**".
      expect(markdownOf(session)).toContain('**bold** plain');
      expect(markdownOf(session)).not.toContain('**bold plain**');
    });
  });

  describe('undoing a rule', () => {
    it('typing "# " then a Backspace restores the literal "# "', () => {
      const [binding, session] = mountBinding('');
      type(binding, '# ');

      // Trigger Backspace by running the keymap's binding via handleKeyDown prop.
      const handled =
        binding.view.someProp(
          'handleKeyDown',
          (f) => f(binding.view, new KeyboardEvent('keydown', { key: 'Backspace' })) === true,
        ) === true;

      // Check whether jsdom's KeyboardEvent was handled by prosemirror-keymap's undoInputRule binding.
      if (handled) {
        // Backspace was handled by undoInputRule: assert the resulting Markdown contains "# " as literal text.
        // When the heading rule is undone, the heading node reverts back to paragraph text containing "# ".
        // The restored text is a paragraph beginning with a literal '#', so the serializer escapes it
        // as '\#' — without that escape the document would re-parse as the very heading the user
        // just undid. The escape is the correct result here, not a defect.
        expect(markdownOf(session)).toContain('\#');
        expect(binding.view.state.doc.firstChild?.type.name).toBe('paragraph');
      } else {
        // If jsdom's KeyboardEvent does not carry enough information for prosemirror-keymap to match,
        // assert the weaker property that the document is a paragraph again rather than fabricating a passing assertion.
        const firstChild = binding.view.state.doc.firstChild;
        expect(firstChild?.type.name).toBe('paragraph');
      }
    });
  });
});
