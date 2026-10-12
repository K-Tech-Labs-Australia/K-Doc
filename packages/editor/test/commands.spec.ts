/**
 * @file commands.spec.ts
 * @purpose Vitest test suite for K-Doc's pure ProseMirror formatting commands, state queries, and structural transaction tagging (@k-doc/editor).
 *   Rather than asserting on ProseMirror internals, each test runs a command and checks the resulting Markdown (e.g. select a word, press bold, assert document reads `**word**`).
 *   That tests the command, the schema, both converters and the serializer in one assertion, and it fails in terms a reader can act on.
 *   All commands operate purely over ProseMirror EditorState and Transaction without requiring a DOM or jsdom environment, enabling direct headless Node execution.
 * @inputs Markdown test fixtures, ProseMirror EditorState instances, formatting commands, and selection ranges.
 * @outputs Vitest assertions verifying resulting Markdown strings, mark/block activity predicates, and kdocStructural transaction metadata.
 * @functions
 *   - stateFor: Parses Markdown to mdast, converts to a ProseMirror document Node, and initializes an EditorState with kdocSchema.
 *   - selectAll: Creates a new EditorState with a TextSelection spanning the entire document content.
 *   - selectWord: Finds a word in textContent, maps text offsets to document positions by walking text nodes, and returns an EditorState with that range selected.
 *   - runToMarkdown: Applies a ProseMirror Command with capturing dispatch, transforms state, and serializes the resulting doc back to Markdown.
 * @dataflow Markdown string -> stateFor -> EditorState -> selectWord/selectAll -> command execution -> nextState -> proseMirrorToMdast -> serializeDocument -> Markdown string assertions.
 * @controlflow Define helper functions -> test inline marks -> test mark state queries -> test block types -> test lists -> test block state queries -> test other commands -> test structural transaction metadata tagging.
 * @version 1
 * @date 2026-09-04
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import {
  kdocSchema,
  mdastToProseMirror,
  proseMirrorToMdast,
  isMarkActive,
  isBlockActive,
  toggleKdocMark,
  clearFormatting,
  setParagraph,
  setHeading,
  setCodeBlock,
  toggleBlockquote,
  toggleList,
  toggleTask,
  insertThematicBreak,
} from '../src/index.js';

/**
 * Creates an EditorState initialized from a Markdown source string.
 *
 * @purpose Parses Markdown to mdast, converts resulting mdast Root to a ProseMirror document Node, and creates an EditorState with kdocSchema.
 * @inputs markdown - The raw Markdown source string to load into the editor state.
 * @outputs EditorState - Initialized ProseMirror editor state containing the converted document.
 * @dataflow markdown -> parseMarkdown -> mdast Root -> mdastToProseMirror -> ProseMirror doc Node -> EditorState.create.
 * @controlflow Parse markdown to AST root -> convert AST to ProseMirror Node -> initialize EditorState with doc and kdocSchema -> return EditorState.
 */
function stateFor(markdown: string): EditorState {
  const parsed = parseMarkdown(markdown);
  const doc = mdastToProseMirror(parsed.root);
  return EditorState.create({ doc, schema: kdocSchema });
}

/**
 * Creates a new EditorState whose selection spans the whole document content.
 *
 * Positions 1 and size-1 stay inside the first and last block rather than selecting the document node itself.
 *
 * @purpose Sets a TextSelection spanning the whole document content from position 1 to content.size - 1.
 * @inputs state - The current EditorState.
 * @outputs EditorState - A new editor state with the entire document content selected.
 * @dataflow state.doc -> compute selection boundaries [1, max(1, content.size - 1)] -> TextSelection.create -> state.apply.
 * @controlflow Compute end position bounded by doc.content.size - 1 -> construct TextSelection -> apply selection transaction -> return updated state.
 */
function selectAll(state: EditorState): EditorState {
  // Positions 1 and size-1 stay inside the first and last block rather than selecting the document node itself.
  const to = Math.max(1, state.doc.content.size - 1);
  const selection = TextSelection.create(state.doc, 1, to);
  return state.apply(state.tr.setSelection(selection));
}

/**
 * Finds a target word within the document text content and returns a new EditorState with that range selected.
 *
 * @purpose Locates a target word in textContent, maps text offsets to document positions by walking text nodes, and sets a TextSelection.
 * @inputs
 *   - state: EditorState - The current editor state to search within.
 *   - word: string - The exact substring to locate and select.
 * @outputs EditorState - A new editor state with the target word selected.
 * @dataflow state.doc.textContent -> find word index -> walk doc.descendants accumulating text node lengths -> compute from/to document positions -> state.apply.
 * @controlflow Locate word in textContent (throw if missing) -> iterate doc.descendants matching character offsets to node positions -> verify positions found (throw if unmapped) -> set TextSelection -> return updated state.
 */
function selectWord(state: EditorState, word: string): EditorState {
  const text = state.doc.textContent;
  const targetIndex = text.indexOf(word);

  // Check if the requested word exists in the document text content.
  // When the word is not found, throw an Error naming it — a test asking for a word that is not there is a broken test, not a failing assertion.
  if (targetIndex === -1) {
    throw new Error(`Word "${word}" not found in document text content: "${text}"`);
  } else {
    // Word found: proceed to walk text nodes and map text offset to document positions.
  }

  const targetEnd = targetIndex + word.length;
  let currentOffset = 0;
  let fromPos: number | undefined;
  let toPos: number | undefined;

  state.doc.descendants((node, pos) => {
    // Check if the visited node is a text node.
    if (node.isText && node.text !== undefined) {
      const nodeLen = node.text.length;
      const nextOffset = currentOffset + nodeLen;

      // Check if word start offset is within this text node and not yet recorded.
      if (fromPos === undefined && targetIndex >= currentOffset && targetIndex <= nextOffset) {
        fromPos = pos + (targetIndex - currentOffset);
      } else {
        // Start offset not in current text node range or already found.
      }

      // Check if word end offset is within this text node and not yet recorded.
      if (toPos === undefined && targetEnd >= currentOffset && targetEnd <= nextOffset) {
        toPos = pos + (targetEnd - currentOffset);
      } else {
        // End offset not in current text node range or already found.
      }

      currentOffset = nextOffset;
    } else {
      // Non-text node: continue traversal.
    }
  });

  // Check if both start and end document positions were successfully resolved.
  if (fromPos === undefined || toPos === undefined) {
    throw new Error(`Could not map word "${word}" to document positions in state`);
  } else {
    // Document positions resolved: construct selection and apply to state.
  }

  const selection = TextSelection.create(state.doc, fromPos, toPos);
  return state.apply(state.tr.setSelection(selection));
}

/**
 * Applies a ProseMirror command to an EditorState and serializes the resulting document to Markdown.
 *
 * @purpose Executes a ProseMirror Command with capturing dispatch and serializes the resulting document back to Markdown.
 * @inputs
 *   - state: EditorState - The current editor state to execute the command on.
 *   - command: Command - The ProseMirror command to execute.
 * @outputs string - The serialized Markdown output produced after command execution.
 * @dataflow state + command -> dispatch(tr) -> state.apply(tr) -> nextState.doc -> proseMirrorToMdast -> serializeDocument -> Markdown string.
 * @controlflow Execute command passing capturing dispatch callback -> check if command returned true and captured transaction -> if false or uncaptured, throw Error -> apply transaction -> convert doc to mdast -> serialize to Markdown -> return string.
 */
function runToMarkdown(state: EditorState, command: Command): string {
  let capturedTr: Transaction | null = null;
  const applied = command(state, (tr: Transaction): void => {
    capturedTr = tr;
  });

  // Check if the command applied successfully and dispatched a transaction.
  // When the command returns false, throw an Error saying the command did not apply,
  // so a silently inapplicable command fails loudly rather than producing unchanged output that looks like a wrong result.
  if (!applied || capturedTr === null) {
    throw new Error('Command did not apply to the given editor state');
  } else {
    // Command applied: proceed to apply transaction and serialize resulting AST.
  }

  const nextState = state.apply(capturedTr);
  const root = proseMirrorToMdast(nextState.doc);
  return serializeDocument({ text: '', root, frontMatter: null });
}

describe('inline marks', () => {
  it('toggles bold mark producing strong markdown', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, toggleKdocMark('strong'));
    expect(md).toContain('**world**');
  });

  it('toggles italic mark producing emphasis markdown', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, toggleKdocMark('emphasis'));
    expect(md).toContain('_world_');
  });

  it('toggles strikethrough mark producing strikethrough markdown', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, toggleKdocMark('strikethrough'));
    expect(md).toContain('~~world~~');
  });

  it('toggles inline code mark producing backtick markdown', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, toggleKdocMark('inlineCode'));
    expect(md).toContain('`world`');
  });

  it('removes bold mark when applied a second time', () => {
    const state1 = selectWord(stateFor('Hello world.\n'), 'world');
    const md1 = runToMarkdown(state1, toggleKdocMark('strong'));
    expect(md1).toContain('**world**');

    const state2 = selectWord(stateFor(md1), 'world');
    const md2 = runToMarkdown(state2, toggleKdocMark('strong'));
    expect(md2).not.toContain('**');
    expect(md2).toContain('world');
  });
});

describe('mark state queries', () => {
  it('reports isMarkActive false on plain text and true after mark application', () => {
    const state0 = selectWord(stateFor('Hello world.\n'), 'world');
    expect(isMarkActive(state0, 'strong')).toBe(false);

    const md = runToMarkdown(state0, toggleKdocMark('strong'));
    const state1 = selectWord(stateFor(md), 'world');
    expect(isMarkActive(state1, 'strong')).toBe(true);
  });
});

describe('block types', () => {
  it('converts paragraph to level-2 heading', () => {
    const state = stateFor('Hello world.\n');
    const md = runToMarkdown(state, setHeading(2));
    expect(md).toContain('## Hello world.');
  });

  it('clamps heading level to 6 when level exceeds maximum', () => {
    const state = stateFor('Hello world.\n');
    const md = runToMarkdown(state, setHeading(9));
    expect(md).toContain('###### Hello world.');
  });

  it('converts heading back to paragraph removing leading hashes', () => {
    const state = stateFor('## Hello world.\n');
    const md = runToMarkdown(state, setParagraph());
    expect(md).not.toContain('#');
    expect(md).toContain('Hello world.');
  });

  it('converts block to fenced code block', () => {
    const state = stateFor('const x = 1;\n');
    const md = runToMarkdown(state, setCodeBlock());
    expect(md).toContain('```');
  });

  it('toggles blockquote container on and off', () => {
    const state1 = stateFor('Hello world.\n');
    const md1 = runToMarkdown(state1, toggleBlockquote());
    expect(md1.startsWith('> ')).toBe(true);

    const state2 = stateFor(md1);
    const md2 = runToMarkdown(state2, toggleBlockquote());
    expect(md2.startsWith('> ')).toBe(false);
    expect(md2).not.toContain('>');
  });
});

describe('lists', () => {
  it('wraps paragraph in bullet list', () => {
    const state = stateFor('List item\n');
    const md = runToMarkdown(state, toggleList('bullet'));
    expect(md.startsWith('- ')).toBe(true);
  });

  it('wraps paragraph in ordered list', () => {
    const state = stateFor('List item\n');
    const md = runToMarkdown(state, toggleList('ordered'));
    expect(md.startsWith('1. ')).toBe(true);
  });

  it('lifts list item back to paragraph when bullet list toggled on existing list', () => {
    const state = stateFor('- List item\n');
    const md = runToMarkdown(state, toggleList('bullet'));
    expect(md.startsWith('-')).toBe(false);
    expect(md).toContain('List item');
  });

  it('toggles task item checkbox between bullet and task states', () => {
    const state1 = stateFor('- List item\n');
    const md1 = runToMarkdown(state1, toggleTask());
    // Toggling task converts checked from null to false, producing an unchecked task item '- [ ] '.
    // This is the null ⇄ false transition the mdast round-trip preserves.
    expect(md1.startsWith('- [ ] ')).toBe(true);

    const state2 = stateFor(md1);
    const md2 = runToMarkdown(state2, toggleTask());
    // Toggling task a second time reverts checked from false to null, restoring a plain bullet list item.
    expect(md2.startsWith('- ')).toBe(true);
    expect(md2).not.toContain('- [ ]');
  });
});

describe('block state queries', () => {
  it('checks heading block activity with level attribute matching', () => {
    const headingState = stateFor('## Heading 2\n');
    expect(isBlockActive(headingState, 'heading', { level: 2 })).toBe(true);
    expect(isBlockActive(headingState, 'heading', { level: 3 })).toBe(false);

    const paragraphState = stateFor('Paragraph text\n');
    expect(isBlockActive(paragraphState, 'heading', { level: 2 })).toBe(false);
  });

  it('finds active ancestor block container beyond immediate parent', () => {
    const state = selectWord(stateFor('> quoted\n'), 'quoted');
    // In ProseMirror, the selection sits inside a paragraph child node within the blockquote.
    // This is the case a parent-only check would get wrong by inspecting only the immediate paragraph node.
    expect(isBlockActive(state, 'blockquote')).toBe(true);
  });
});

describe('other commands', () => {
  it('inserts thematic break divider', () => {
    const state = stateFor('Paragraph\n');
    const md = runToMarkdown(state, insertThematicBreak());
    expect(md).toContain('---');
  });

  it('clears all formatting marks across selection', () => {
    const state = selectAll(stateFor('**bold** and _italic_ text.\n'));
    const md = runToMarkdown(state, clearFormatting());
    expect(md).not.toContain('**');
    expect(md).not.toContain('_');
    expect(md).toContain('bold and italic text.');
  });

  it('returns false when clearFormatting is called on an empty selection', () => {
    const state = stateFor('Sample text\n');
    // Place an empty cursor selection at position 1.
    const emptyState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 1)));
    const canClear = clearFormatting()(emptyState, undefined);
    expect(canClear).toBe(false);
  });
});

describe('structural transactions are tagged', () => {
  it('tags structural transactions with kdocStructural metadata flag', () => {
    // TypeScript's control-flow analysis cannot see the assignment made inside the dispatch
    // callback, so after the initializer a plain `let` narrows to `null`, which makes reading
    // `.getMeta` off that narrowed type an error on `never`. A property on an object is not
    // narrowed that way, so capture the transaction in a holder.
    const captured: { tr: Transaction | null } = { tr: null };
    const state = stateFor('Hello world.\n');
    const command = setHeading(2);
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(true);
    expect(captured.tr).not.toBeNull();
    // This tag is what stops a formatting command merging into the user's last typing run,
    // and losing it would be invisible until somebody noticed undo behaving oddly.
    expect(captured.tr?.getMeta('kdocStructural')).toBe(true);
  });
});
