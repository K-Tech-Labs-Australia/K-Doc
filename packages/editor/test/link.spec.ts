/**
 * @file link.spec.ts
 * @purpose Vitest test suite for K-Doc's link range queries, applicability testing, and link manipulation commands (@k-doc/editor).
 *   Like commands.spec.ts, assertions verify resulting Markdown rather than ProseMirror internals to test commands, schema, AST converters, and serializer together.
 *   All operations execute directly over ProseMirror EditorState and Transaction without requiring a DOM or jsdom environment.
 * @inputs Markdown test fixtures, ProseMirror EditorState instances, target link attributes (LinkAttrs), document positions, and selection ranges.
 * @outputs Vitest assertions verifying LinkRange query results, boolean applicability flags, resulting Markdown strings, and structural transaction metadata.
 * @functions
 *   - stateFor: Parses Markdown to mdast, converts to a ProseMirror document Node, and initializes an EditorState with kdocSchema.
 *   - selectWord: Finds a word in textContent, maps text offsets to document positions by walking text nodes, and returns an EditorState with that range selected.
 *   - runToMarkdown: Applies a ProseMirror Command with capturing dispatch, transforms state, and serializes the resulting doc back to Markdown.
 *   - caretAt: Finds a word in textContent, computes its midpoint document position, and returns an EditorState with a collapsed TextSelection at that position.
 * @dataflow Markdown string -> stateFor -> EditorState -> selectWord/caretAt/selectAll -> command execution / range query -> nextState -> proseMirrorToMdast -> serializeDocument -> Markdown string assertions.
 * @controlflow Define helper functions -> test linkAt and activeLink queries -> test canLink applicability predicate -> test setLink command -> test removeLink command -> test round-trip conversion guard.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import {
  kdocSchema,
  mdastToProseMirror,
  proseMirrorToMdast,
  linkAt,
  activeLink,
  canLink,
  setLink,
  removeLink,
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
 * Finds a target word within the document text content and returns a new EditorState with a collapsed cursor at the word's midpoint.
 *
 * @purpose Locates a target word in textContent, maps the word midpoint text offset to a document position by walking text nodes, and sets a collapsed TextSelection.
 * @inputs
 *   - state: EditorState - The current editor state to search within.
 *   - word: string - The exact substring to locate.
 * @outputs EditorState - A new editor state with a collapsed caret positioned at the midpoint of the target word.
 * @dataflow state.doc.textContent -> find word index -> compute midpoint offset -> walk doc.descendants accumulating text node lengths -> compute document position -> state.apply.
 * @controlflow Locate word in textContent (throw if missing) -> compute midpoint offset -> iterate doc.descendants matching character offset to node position -> verify position found (throw if unmapped) -> set collapsed TextSelection -> return updated state.
 */
function caretAt(state: EditorState, word: string): EditorState {
  const text = state.doc.textContent;
  const targetIndex = text.indexOf(word);

  // Check if the requested word exists in the document text content.
  if (targetIndex === -1) {
    throw new Error(`Word "${word}" not found in document text content: "${text}"`);
  } else {
    // Word found: proceed to find midpoint offset and map to document position.
  }

  const midOffset = targetIndex + Math.floor(word.length / 2);
  let currentOffset = 0;
  let caretPos: number | undefined;

  state.doc.descendants((node, pos) => {
    // Check if the visited node is a text node.
    if (node.isText && node.text !== undefined) {
      const nodeLen = node.text.length;
      const nextOffset = currentOffset + nodeLen;

      // Check if midpoint offset is within this text node and not yet recorded.
      if (caretPos === undefined && midOffset >= currentOffset && midOffset <= nextOffset) {
        caretPos = pos + (midOffset - currentOffset);
      } else {
        // Midpoint offset not in current text node range or already found.
      }

      currentOffset = nextOffset;
    } else {
      // Non-text node: continue traversal.
    }
  });

  // Check if document position was successfully resolved.
  if (caretPos === undefined) {
    throw new Error(`Could not map midpoint of word "${word}" to document position in state`);
  } else {
    // Document position resolved: construct collapsed selection and apply to state.
  }

  const selection = TextSelection.create(state.doc, caretPos, caretPos);
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
 * @dataflow state + command -> dispatch(tr) -> state.apply(captured.tr) -> nextState.doc -> proseMirrorToMdast -> serializeDocument -> Markdown string.
 * @controlflow Execute command passing capturing dispatch callback -> check if command returned true and captured transaction -> if false or uncaptured, throw Error -> apply transaction -> convert doc to mdast -> serialize to Markdown -> return string.
 */
function runToMarkdown(state: EditorState, command: Command): string {
  const captured: { tr: Transaction | null } = { tr: null };
  const applied = command(state, (tr: Transaction): void => {
    captured.tr = tr;
  });

  // Check if the command applied successfully and dispatched a transaction.
  // When the command returns false, throw an Error saying the command did not apply,
  // so a silently inapplicable command fails loudly rather than producing unchanged output that looks like a wrong result.
  if (!applied || captured.tr === null) {
    throw new Error('Command did not apply to the given editor state');
  } else {
    // Command applied: proceed to apply transaction and serialize resulting AST.
  }

  const nextState = state.apply(captured.tr);
  const root = proseMirrorToMdast(nextState.doc);
  return serializeDocument({ text: '', root, frontMatter: null });
}

describe('linkAt and activeLink', () => {
  it('resolves link range and href for a caret inside link text', () => {
    const state = caretAt(stateFor('A [site](https://example.com) here.\n'), 'site');
    const range = linkAt(state, state.selection.from);
    expect(range).not.toBeNull();
    expect(range?.attrs.href).toBe('https://example.com');
    expect(range?.attrs.title).toBeNull();
    expect(range !== null ? range.to - range.from : 0).toBe('site'.length);
    // Asserting the covered TEXT, not just its length: the first version of this range was the right
    // width but two characters to the left, and a length-only check passed against it.
    expect(range !== null ? state.doc.textBetween(range.from, range.to) : '').toBe('site');

    const active = activeLink(state);
    expect(active).toEqual(range);
  });

  it('returns null for a caret in plain unlinked text', () => {
    const state = caretAt(stateFor('A [site](https://example.com) here.\n'), 'here');
    expect(linkAt(state, state.selection.from)).toBeNull();
    expect(activeLink(state)).toBeNull();
  });

  // The mark.eq comparison prevents two adjacent links with differing hrefs from merging into a single range.
  it('returns only the targeted link range for adjacent links with differing hrefs', () => {
    const state1 = caretAt(stateFor('[one](https://a.example)[two](https://b.example)\n'), 'one');
    const range1 = linkAt(state1, state1.selection.from);
    expect(range1).not.toBeNull();
    expect(range1?.attrs.href).toBe('https://a.example');
    expect(range1 !== null ? range1.to - range1.from : 0).toBe('one'.length);
    expect(range1 !== null ? state1.doc.textBetween(range1.from, range1.to) : '').toBe('one');

    const state2 = caretAt(stateFor('[one](https://a.example)[two](https://b.example)\n'), 'two');
    const range2 = linkAt(state2, state2.selection.from);
    expect(range2).not.toBeNull();
    expect(range2?.attrs.href).toBe('https://b.example');
    expect(range2 !== null ? range2.to - range2.from : 0).toBe('two'.length);
    expect(range2 !== null ? state2.doc.textBetween(range2.from, range2.to) : '').toBe('two');
  });

  it('reports title attribute when link carries a title', () => {
    const state = caretAt(stateFor('[site](https://example.com "Tip")\n'), 'site');
    const range = linkAt(state, state.selection.from);
    expect(range).not.toBeNull();
    expect(range?.attrs.title).toBe('Tip');
    expect(range?.attrs.href).toBe('https://example.com');
  });

  it('returns null for a position inside a heading without links', () => {
    const state = caretAt(stateFor('# Heading title\n'), 'title');
    expect(linkAt(state, state.selection.from)).toBeNull();
    expect(activeLink(state)).toBeNull();
  });
});

describe('canLink', () => {
  it('returns true for a non-empty selection over plain text', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    expect(canLink(state)).toBe(true);
  });

  it('returns false for a collapsed caret in plain text', () => {
    const state = caretAt(stateFor('Hello world.\n'), 'world');
    expect(canLink(state)).toBe(false);
  });

  it('returns true for a collapsed caret inside an existing link', () => {
    const state = caretAt(stateFor('A [site](https://example.com) here.\n'), 'site');
    expect(canLink(state)).toBe(true);
  });
});

describe('setLink', () => {
  it('applies link to selected text without title', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, setLink({ href: 'https://example.com', title: null }));
    expect(md).toContain('[world](https://example.com)');
  });

  it('applies link to selected text with title', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const md = runToMarkdown(state, setLink({ href: 'https://example.com', title: 'Tip' }));
    expect(md).toContain('[world](https://example.com "Tip")');
  });

  // A browser's double-click selects the word AND its trailing space. Strong hides that (Markdown cannot
  // hold a trailing space inside ** **, so the serializer moves it out) but a link carries it straight
  // through as `[word ](url)`, which is how this surfaced in the running app.
  it('trims trailing whitespace from the selection before applying the link', () => {
    const state = stateFor('A Markdown editor.\n');
    // Select 'Markdown ' including the trailing space, exactly as a double-click hands it over.
    const withSpace = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 12)));
    expect(withSpace.doc.textBetween(3, 12)).toBe('Markdown ');

    const md = runToMarkdown(withSpace, setLink({ href: 'https://example.com', title: null }));
    expect(md).toBe('A [Markdown](https://example.com) editor.\n');
  });

  it('trims leading whitespace from the selection before applying the link', () => {
    const state = stateFor('A Markdown editor.\n');
    // Select ' Markdown' with the space in front of it.
    const withSpace = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 11)));
    expect(withSpace.doc.textBetween(2, 11)).toBe(' Markdown');

    const md = runToMarkdown(withSpace, setLink({ href: 'https://example.com', title: null }));
    expect(md).toBe('A [Markdown](https://example.com) editor.\n');
  });

  // An all-whitespace selection is left alone rather than trimmed to nothing: a command that silently
  // does nothing is worse than one that links the space the user actually selected.
  it('leaves an all-whitespace selection untrimmed rather than doing nothing', () => {
    const state = stateFor('A Markdown editor.\n');
    const spaceOnly = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 11, 12)));
    expect(spaceOnly.doc.textBetween(11, 12)).toBe(' ');

    const command = setLink({ href: 'https://example.com', title: null });
    expect(command(spaceOnly)).toBe(true);
  });

  // Editing an existing link from a collapsed caret rewrites the entire contiguous link span rather than splitting it.
  it('rewrites the whole link when editing from a collapsed caret', () => {
    const state = caretAt(stateFor('A [site](https://old.example) here.\n'), 'site');
    const md = runToMarkdown(state, setLink({ href: 'https://new.example', title: null }));
    expect(md).toContain('[site](https://new.example)');
    expect(md).not.toContain('old.example');
  });

  it('returns false and dispatches nothing when href is empty string', () => {
    const input = 'Hello world.\n';
    const state = selectWord(stateFor(input), 'world');
    const captured: { tr: Transaction | null } = { tr: null };
    const command = setLink({ href: '', title: null });
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(false);
    expect(captured.tr).toBeNull();
    const root = proseMirrorToMdast(state.doc);
    const md = serializeDocument({ text: '', root, frontMatter: null });
    expect(md).toBe(input);
  });

  it('returns false and dispatches nothing when href is whitespace only', () => {
    const input = 'Hello world.\n';
    const state = selectWord(stateFor(input), 'world');
    const captured: { tr: Transaction | null } = { tr: null };
    const command = setLink({ href: '   ', title: null });
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(false);
    expect(captured.tr).toBeNull();
    const root = proseMirrorToMdast(state.doc);
    const md = serializeDocument({ text: '', root, frontMatter: null });
    expect(md).toBe(input);
  });

  it('returns false when called on a collapsed caret in plain text', () => {
    const state = caretAt(stateFor('Hello world.\n'), 'world');
    const captured: { tr: Transaction | null } = { tr: null };
    const command = setLink({ href: 'https://example.com', title: null });
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(false);
    expect(captured.tr).toBeNull();
  });

  it('returns true during dry-run with no dispatch without modifying state', () => {
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const command = setLink({ href: 'https://example.com', title: null });
    const canApply = command(state, undefined);

    expect(canApply).toBe(true);
    const root = proseMirrorToMdast(state.doc);
    const md = serializeDocument({ text: '', root, frontMatter: null });
    expect(md).toBe('Hello world.\n');
  });

  // Captures transaction in a holder object to prevent TypeScript control-flow narrowing on closure assignments.
  it('tags structural transactions with kdocStructural metadata flag', () => {
    const captured: { tr: Transaction | null } = { tr: null };
    const state = selectWord(stateFor('Hello world.\n'), 'world');
    const command = setLink({ href: 'https://example.com', title: null });
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(true);
    expect(captured.tr).not.toBeNull();
    expect(captured.tr?.getMeta('kdocStructural')).toBe(true);
  });
});

describe('removeLink', () => {
  it('removes link mark from a collapsed caret inside an existing link', () => {
    const state = caretAt(stateFor('A [site](https://example.com) here.\n'), 'site');
    const md = runToMarkdown(state, removeLink());
    expect(md).not.toContain('[');
    expect(md).not.toContain(']');
    expect(md).not.toContain('https://example.com');
    expect(md).toContain('A site here.');
  });

  it('returns false when removeLink is called on a collapsed caret in plain text', () => {
    const state = caretAt(stateFor('Hello world.\n'), 'world');
    const captured: { tr: Transaction | null } = { tr: null };
    const command = removeLink();
    const applied = command(state, (tr: Transaction): void => {
      captured.tr = tr;
    });

    expect(applied).toBe(false);
    expect(captured.tr).toBeNull();
  });

  it('removes link when selection spans across the link', () => {
    const state = selectWord(stateFor('A [site](https://example.com) here.\n'), 'site');
    const md = runToMarkdown(state, removeLink());
    expect(md).not.toContain('[');
    expect(md).not.toContain(']');
    expect(md).not.toContain('https://example.com');
    expect(md).toContain('A site here.');
  });
});

describe('round-trip guard', () => {
  // Validates that the AST conversion round-trip preserves links byte-identically before commands are executed.
  it('preserves link with title byte-identically across conversion round-trip without commands', () => {
    const input = 'See [the docs](https://example.com "Docs") for more.\n';
    const state = stateFor(input);
    const root = proseMirrorToMdast(state.doc);
    const output = serializeDocument({ text: '', root, frontMatter: null });
    expect(output).toBe(input);
  });
});
