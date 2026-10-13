// @vitest-environment jsdom
/**
 * @file fold-plugin.test.ts
 * @purpose Verifies FR-8.29 K-Doc folding: target enumeration, toggle/hidden-block rendering, click and command toggling, and caret handling on fold and unfold.
 * @inputs Markdown fixtures; FoldStore test doubles; ProseMirror editor state and view helpers.
 * @outputs vitest assertions covering proseMirrorFoldTargets, foldTargetAt, hiddenFoldTargetAt, createFoldPlugin, toggleFoldCommand, and the shared core targets.
 * @functions
 *   - SAMPLE: The canonical Markdown fixture used across every case.
 *   - docOf: Parses a Markdown string into a ProseMirror document node.
 *   - posAfter: Locates the absolute document offset immediately after a marker substring.
 *   - testStore: Builds a FoldStore backed by a Set of folded keys and a set of subscribers.
 *   - viewOf: Constructs an EditorView over parsed Markdown with an optional caret position.
 *   - hiddenCount: Counts rendered blocks carrying the fold-hidden class.
 * @dataflow Markdown -> parseMarkdown + mdastToProseMirror -> doc -> plugin/store -> rendered DOM -> assertions.
 * @controlflow describe per behavior; each it builds a store and view, mutates fold state, then asserts rendering or command results.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { foldTargets, parseMarkdown } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { createFoldPlugin, foldTargetAt, hiddenFoldTargetAt, proseMirrorFoldTargets, toggleFoldCommand, FOLD_HIDDEN_CLASS, FOLDED_CLASS, FOLD_TOGGLE_CLASS } from './fold-plugin.js';
import type { FoldStore } from './fold-plugin.js';

/** Markdown fixture covering nested headings and a two-level list (FR-8.29). */
const SAMPLE = '# A\n\ntext\n\n## B\n\n- one\n  - two\n- three\n\n# C\n';

/**
 * Parse a Markdown string into a ProseMirror document node.
 * @purpose Converts source Markdown through the mdast pipeline into schema-typed nodes.
 * @inputs markdown - Source Markdown text to parse.
 * @outputs ProseMirrorNode - The root document node ready for selection and traversal.
 * @dataflow markdown -> parseMarkdown -> .root mdast -> mdastToProseMirror -> doc node.
 * @controlflow Single linear transformation with no branching.
 */
function docOf(markdown: string): ProseMirrorNode {
  return mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
}

/**
 * Find the document offset immediately after a marker substring within the first matching text node.
 * @purpose Walks descendants to locate a marker and computes an absolute position past its last character.
 * @inputs doc - Document to search; needle - Substring whose end offset becomes the returned position.
 * @outputs number - Absolute document offset just after the final character of the marker.
 * @dataflow doc -> descendants walk -> text.indexOf(needle) -> nodePos + matchIndex + needle.length.
 * @controlflow Return false from the walker once a match is found; throw when no text node contains the marker.
 */
function posAfter(doc: ProseMirrorNode, needle: string): number {
  let result = -1;
  doc.descendants((node, nodePos) => {
    // Stop the walk as soon as the first text node containing the marker is located.
    if (result === -1 && node.isText && node.text !== undefined && node.text.includes(needle)) {
      const matchIndex = node.text.indexOf(needle);
      result = nodePos + matchIndex + needle.length;
    } else {
      // Not the marker, or already found: keep walking until the walker stops.
    }
    return result === -1;
  });
  if (result === -1) {
    // Marker not present anywhere in the document.
    throw new Error(`missing ${needle}`);
  } else {
    return result;
  }
}

/**
 * Build a FoldStore backed by a Set of folded keys and a set of subscribers.
 * @purpose Provides an in-memory FoldStore whose mutations notify listeners only on state changes.
 * @inputs initial - Keys that start in the folded state.
 * @outputs FoldStore - A store implementing isFolded, setFolded, toggle, and subscribe.
 * @dataflow key + boolean -> Set mutation -> listener notification.
 * @controlflow Notify subscribers only when the fold state actually flips; toggle negates current state.
 */
function testStore(initial: readonly string[]): FoldStore {
  const folded = new Set<string>(initial);
  const listeners = new Set<() => void>();

  // Apply a fold-state change, notifying subscribers only when the state flips.
  function applyFold(key: string, next: boolean): void {
    if (folded.has(key) !== next) {
      // Fold or unfold as asked, then tell the plugin.
      if (next) { folded.add(key); } else { folded.delete(key); }
      for (const listener of listeners) { listener(); }
    } else {
      // Already in that state: stay silent, as the shell's store does.
    }
  }

  return {
    isFolded(key: string): boolean {
      return folded.has(key);
    },
    setFolded(key: string, next: boolean): void {
      applyFold(key, next);
    },
    toggle(key: string): void {
      applyFold(key, !folded.has(key));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
  };
}

/**
 * Construct an EditorView over parsed Markdown with an optional caret position.
 * @purpose Wires a document, the fold plugin, and an optional selection into a rendered view.
 * @inputs markdown - Source Markdown; store - FoldStore driving fold state; caretAfter - Optional marker for the caret.
 * @outputs EditorView - A jsdom-rendered editor whose DOM reflects the current fold state.
 * @dataflow markdown -> docOf -> EditorState -> EditorView(document) -> view.dom.
 * @controlflow Build a default-selection state when no marker is given, otherwise place the caret after the marker.
 */
function viewOf(markdown: string, store: FoldStore, caretAfter?: string): EditorView {
  const doc = docOf(markdown);
  if (caretAfter === undefined) {
    // No caret marker supplied: build a state with an implicit selection.
    const state = EditorState.create({ doc, plugins: [createFoldPlugin(store)] });
    return new EditorView(document.createElement('div'), { state });
  } else {
    // Caret marker supplied: place the selection at the computed document offset.
    const pos = posAfter(doc, caretAfter);
    const state = EditorState.create({ doc, plugins: [createFoldPlugin(store)], selection: TextSelection.create(doc, pos) });
    return new EditorView(document.createElement('div'), { state });
  }
}

/**
 * Count rendered blocks carrying the fold-hidden class.
 * @purpose Counts hidden content regions produced by a folded target in the view DOM.
 * @inputs view - The editor view whose DOM is inspected.
 * @outputs number - Quantity of elements with the kdoc-fold-hidden class.
 * @dataflow view.dom -> querySelectorAll(class) -> length.
 * @controlflow Single selector count with no branching.
 */
function hiddenCount(view: EditorView): number {
  return view.dom.querySelectorAll(`.${FOLD_HIDDEN_CLASS}`).length;
}

describe('proseMirrorFoldTargets', () => {
  it('lists the same keys as the core targets', () => {
    const keys = proseMirrorFoldTargets(docOf(SAMPLE)).map(t => t.key);
    expect(keys).toEqual(['heading:a', 'heading:b', 'item:one', 'item:two', 'item:three', 'heading:c']);
    expect(keys).toEqual(foldTargets(parseMarkdown(SAMPLE)).map(t => t.key));
  });
  it('bounds a heading section by the next heading at its level or above', () => {
    const targets = proseMirrorFoldTargets(docOf(SAMPLE));
    const first = targets[0];
    const last = targets[5];
    // Heading A's body ends where the next same-or-higher heading (C) begins.
    expect(first?.bodyTo).toBe(last?.pos);
    // Heading C is a trailing section with no following heading, so it has nothing to fold.
    expect(last?.bodyTo).toBe(last?.bodyFrom);
  });
  it('folds a list item only when it has more than one block', () => {
    const targets = proseMirrorFoldTargets(docOf(SAMPLE));
    // item:one contains a nested list, so its body spans multiple document offsets.
    const one = targets[2];
    expect(one?.bodyTo ?? 0).toBeGreaterThan(one?.bodyFrom ?? 0);
    // item:two is a single block, so its body bounds coincide.
    const two = targets[3];
    expect(two?.bodyTo).toBe(two?.bodyFrom);
  });
});

describe('rendering folded state', () => {
  it('shows a toggle for each foldable target', () => {
    const view = viewOf(SAMPLE, testStore([]));
    // Three foldable targets: heading A, heading B, and list item one.
    expect(view.dom.querySelectorAll(`.${FOLD_TOGGLE_CLASS}`).length).toBe(3);
    expect(hiddenCount(view)).toBe(0);
    view.destroy();
  });
  it('hides the blocks of a folded section', () => {
    const viewB = viewOf(SAMPLE, testStore(['heading:b']));
    // Heading B's body holds a single list block.
    expect(hiddenCount(viewB)).toBe(1);
    expect(viewB.dom.querySelector('h2')?.classList.contains(FOLDED_CLASS)).toBe(true);
    viewB.destroy();

    const viewA = viewOf(SAMPLE, testStore(['heading:a']));
    // Folding A hides its paragraph, the nested heading B and the list under B.
    expect(hiddenCount(viewA)).toBe(3);
    viewA.destroy();
  });
  it('hides the nested list of a folded item', () => {
    const view = viewOf(SAMPLE, testStore(['item:one']));
    expect(hiddenCount(view)).toBe(1);
    expect(view.dom.querySelector(`li.${FOLDED_CLASS}`)).not.toBeNull();
    view.destroy();
  });
});

describe('folding interactions', () => {
  it('folds when the toggle is clicked', () => {
    const store = testStore([]);
    const view = viewOf(SAMPLE, store);
    // The first fold button belongs to heading A.
    const button = view.dom.querySelector('button[aria-label="Fold section"]');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(store.isFolded('heading:a')).toBe(true);
    expect(hiddenCount(view)).toBe(3);
    // A freshly folded heading keeps its toggle collapsed.
    expect(view.dom.querySelector('h1 button')?.getAttribute('aria-expanded')).toBe('false');
    view.destroy();
  });
  it('toggles the innermost foldable target at the caret', () => {
    const doc = docOf(SAMPLE);
    const store = testStore([]);
    // The innermost foldable target containing item two is its ancestor item one.
    expect(foldTargetAt(doc, posAfter(doc, 'two'))?.key).toBe('item:one');
    const stateTwo = EditorState.create({ doc, selection: TextSelection.create(doc, posAfter(doc, 'two')) });
    expect(toggleFoldCommand(store)(stateTwo, () => undefined)).toBe(true);
    expect(store.isFolded('item:one')).toBe(true);

    // Caret inside the paragraph resolves to heading A.
    const stateText = EditorState.create({ doc, selection: TextSelection.create(doc, posAfter(doc, 'text')) });
    toggleFoldCommand(store)(stateText, () => undefined);
    expect(store.isFolded('heading:a')).toBe(true);

    // Caret inside heading C text is not within any foldable body.
    const storeC = testStore([]);
    const stateC = EditorState.create({ doc, selection: TextSelection.create(doc, posAfter(doc, 'C')) });
    expect(toggleFoldCommand(storeC)(stateC, () => undefined)).toBe(false);
  });
  it('finds the folded target hiding a position', () => {
    const doc = docOf(SAMPLE);
    const store = testStore(['heading:a']);
    // 'text' sits inside heading A's hidden body.
    expect(hiddenFoldTargetAt(doc, store, posAfter(doc, 'text'))?.key).toBe('heading:a');
    // The heading text itself is not strictly contained in the folded body.
    expect(hiddenFoldTargetAt(doc, store, posAfter(doc, 'A'))).toBeNull();
  });
  it('finds nothing hidden when nothing is folded', () => {
    const doc = docOf(SAMPLE);
    expect(hiddenFoldTargetAt(doc, testStore([]), posAfter(doc, 'text'))).toBeNull();
  });
  it('does not count the start of a folded body as hidden', () => {
    const doc = docOf(SAMPLE);
    const a = proseMirrorFoldTargets(doc)[0];
    expect(hiddenFoldTargetAt(doc, testStore(['heading:a']), a?.bodyFrom ?? -1)).toBeNull();
  });
  it('gives no button to a list item whose first block is not a paragraph', () => {
    const view = viewOf('- > quoted\n\n  more\n', testStore([]));
    expect(proseMirrorFoldTargets(view.state.doc).filter(t => t.bodyTo > t.bodyFrom).length).toBe(1);
    expect(view.dom.querySelectorAll(`.${FOLD_TOGGLE_CLASS}`).length).toBe(0);
    view.destroy();
  });
  it('only reports applicability when the command is not dispatched', () => {
    const doc = docOf(SAMPLE);
    const store = testStore([]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, posAfter(doc, 'text')) });
    expect(toggleFoldCommand(store)(state)).toBe(true);
    expect(store.isFolded('heading:a')).toBe(false);
  });
  it('unfolds when the caret moves into a folded section', async () => {
    const store = testStore(['heading:a']);
    const view = viewOf(SAMPLE, store);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posAfter(view.state.doc, 'text'))));
    // Unfolding is scheduled on a microtask.
    await Promise.resolve();
    expect(store.isFolded('heading:a')).toBe(false);
    view.destroy();
  });
  it('moves the caret out of a section as it folds', async () => {
    const store = testStore([]);
    const view = viewOf(SAMPLE, store, 'text');
    store.setFolded('heading:a', true);
    // Caret is pushed to the end of the visible heading line (offset 1 + 1).
    expect(view.state.selection.head).toBe(2);
    await Promise.resolve();
    expect(store.isFolded('heading:a')).toBe(true);
    view.destroy();
  });
});
