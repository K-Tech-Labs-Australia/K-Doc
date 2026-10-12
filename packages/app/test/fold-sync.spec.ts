// @vitest-environment jsdom
/**
 * @file fold-sync.spec.ts
 * @purpose Vitest suite proving the CodeMirror 6 Source-pane fold sync in ../src/shell/fold-sync.js satisfies FR-8.29: reporting which foldable targets are collapsed, applying store folds to Source exactly once, following store changes and persisting each change, copying user-made Source folds back into the store, restoring folds after a Source text replacement, waiting while Source and the session disagree, toggling the innermost foldable at the caret, folding/unfolding all headings, and stopping applies once destroyed.
 * @inputs EditorState/EditorView from @codemirror/state/@codemirror/view, codeFolding/foldedRanges/foldEffect from @codemirror/language, markdown from @codemirror/lang-markdown, parseMarkdown/KdocDocument from @k-doc/core, and createFoldSync/FoldSync from ../src/shell/fold-sync.js — all exercised against the fixed SAMPLE document.
 * @outputs Pass/fail assertions pinning: saved folds applied to Source ([15] for heading:b), store-driven re-application persisting each change, user-made folds copied into the store, fold restoration after a text replacement, no apply while lengths disagree, caret toggle of the innermost item, fold-all-headings and unfold-all, and cancelled applies after destroy.
 * @functions
 *   - setup: Builds a Fixture containing a FoldSync instance and a mounted EditorView over SAMPLE, wiring markdown, codeFolding, and the sync's sourceExtension.
 *   - foldStarts: Returns the ascending list of live CodeMirror fold start offsets for assertions about collapsed ranges.
 * @dataflow SAMPLE -> parseMarkdown(parsed) + EditorState.create([markdown(), codeFolding(), sync.sourceExtension]) -> EditorView -> applyToSource/store mutations/dispatch foldedRanges -> setup/foldStarts read results -> assertions; the persisted array records every persist(keys) call in order.
 * @controlflow A single describe('fold-sync') block runs eight independent it() cases; each builds its own fixture so fold state never leaks between tests, async cases await a microtask for scheduled re-applies, and every case destroys its view at the end to release the jsdom parent.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { codeFolding, foldedRanges, foldEffect } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { parseMarkdown } from '@k-doc/core';
import type { KdocDocument } from '@k-doc/core';
import { createFoldSync } from '../src/shell/fold-sync.js';
import type { FoldSync } from '../src/shell/fold-sync.js';

// Nested Markdown document used as the shared editor content; offsets below index into this exact string.
const SAMPLE = '# A\n\ntext\n\n## B\n\n- one\n  - two\n- three\n\n# C\n';

// Document offsets into SAMPLE (CodeMirror 0-based, each newline counts as one character):
//   heading:b -> '## B' at 11, its Source fold starting at the end of the line, offset 15;
//   item:one -> '- one' ending at 22 with the item body extending to 30 (fold [22, 30]);
//   item:two -> '- two' starting at 25. Each start is the fold origin for its target.
interface Fixture {
  readonly sync: FoldSync;
  readonly view: EditorView;
  readonly persisted: (readonly string[])[];
}

/**
 * @purpose Constructs a Fixture wiring a FoldSync to a mounted CodeMirror EditorView over SAMPLE, capturing every persist(keys) call into the fixture's persisted array.
 * @inputs initialKeys - the foldable target keys pre-loaded into the store before any Source application.
 *           documentText - optional override of the parsed Markdown document text; defaults to SAMPLE so Source and session lengths agree.
 * @outputs A Fixture exposing the FoldSync, the live EditorView, and the recorded persist calls in order.
 * @dataflow parseMarkdown(documentText) -> parsed KdocDocument + new EditorView over SAMPLE with [markdown(), codeFolding(), sync.sourceExtension] -> createFoldSync closure captures parsed/view/persisted -> returned fixture.
 * @controlflow Single construction with no branching; the sourceView closure defers reading `view` until first call so the forward reference to the not-yet-assigned view resolves correctly at call time.
 */
function setup(initialKeys: readonly string[], documentText: string = SAMPLE): Fixture {
  const persisted: (readonly string[])[] = [];
  const parsed: KdocDocument = parseMarkdown(documentText);
  let view: EditorView | null = null;
  const sync = createFoldSync({
    initialKeys,
    documentOf: () => parsed,
    sourceView: () => {
      // If the view has not been constructed yet, the fold sync cannot resolve it.
      if (view === null) {
        throw new Error('view not created');
      } else {
        // The view exists; return it for the fold sync to read and write folds.
        return view;
      }
    },
    persist: (keys) => {
      persisted.push(keys);
    },
  });
  view = new EditorView({
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [markdown(), codeFolding(), sync.sourceExtension],
    }),
    parent: globalThis.document.body,
  });
  return { sync, view, persisted };
}

/**
 * @purpose Collects the start offset of every live CodeMirror fold in ascending order for assertions about which ranges are currently collapsed.
 * @inputs view - EditorView whose foldedRanges must be inspected across its full document extent.
 * @outputs The number[] of fold `from` offsets — empty when no folds are live, one entry per active fold.
 * @dataflow foldedRanges(view.state).between(0, doc.length) -> callback pushes each `from` into starts in ascending iteration order.
 * @controlflow Single between() scan with an unconditional push (no branch) so every range in the document is counted exactly once.
 */
function foldStarts(view: EditorView): number[] {
  const starts: number[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
    starts.push(from);
  });
  return starts;
}

describe('fold-sync', () => {
  it('shows the saved folds in Source', () => {
    const f = setup(['heading:b']);
    // applyToSource synchronously applies the store's folded heading:b to Source.
    f.sync.applyToSource();
    expect(foldStarts(f.view)).toEqual([15]);
    // No store mutation occurred, so persist was never called.
    expect(f.persisted).toEqual([]);
    f.view.destroy();
  });

  it('follows the store and saves each change', async () => {
    const f = setup(['heading:b']);
    f.sync.applyToSource();
    // Unfolding heading:b persists the now-empty key set synchronously, then schedules a microtask re-apply.
    f.sync.store.setFolded('heading:b', false);
    expect(f.persisted).toEqual([[]]);
    await Promise.resolve();
    expect(foldStarts(f.view)).toEqual([]);
    f.view.destroy();
  });

  it('copies a fold made in Source into the store', () => {
    const f = setup([]);
    // The user folds [22, 30] (the '- one' item) directly via CodeMirror.
    f.view.dispatch({ effects: foldEffect.of({ from: 22, to: 30 }) });
    expect(f.sync.store.isFolded('item:one')).toBe(true);
    // The user-made fold is recorded and persisted as the sole remaining key.
    expect(f.persisted).toEqual([['item:one']]);
    f.view.destroy();
  });

  it('restores folds after Source text is replaced', async () => {
    const f = setup(['heading:b']);
    f.sync.applyToSource();
    // Replacing the whole document invalidates the live fold, clearing all folds immediately.
    f.view.dispatch({ changes: { from: 0, to: f.view.state.doc.length, insert: SAMPLE } });
    expect(foldStarts(f.view)).toEqual([]);
    // sessionChanged re-applies the store's folded heading:b in a microtask.
    f.sync.sessionChanged();
    await Promise.resolve();
    expect(foldStarts(f.view)).toEqual([15]);
    f.view.destroy();
  });

  it('waits while Source and the session disagree', () => {
    const f = setup(['heading:b'], SAMPLE + 'more\n');
    // The parsed session document is longer than the Source view, so applyToSource must not touch folds.
    f.sync.applyToSource();
    expect(foldStarts(f.view)).toEqual([]);
    f.view.destroy();
  });

  it('toggles the innermost list item or section foldable at the Source caret', () => {
    const f = setup([]);
    // The caret sits inside the nested '- two' line, which belongs to the '- one' item.
    f.view.dispatch({ selection: { anchor: 26 } });
    expect(f.sync.toggleAtSourceCaret()).toBe(true);
    // The innermost foldable resolves to item:one; item:two is not a Source fold target at this offset.
    expect(f.sync.store.isFolded('item:one')).toBe(true);
    expect(f.sync.store.isFolded('item:two')).toBe(false);
    f.view.destroy();
  });

  it('finds nothing to toggle past the last section', () => {
    const f = setup([]);
    f.view.dispatch({ selection: { anchor: SAMPLE.length } });
    expect(f.sync.toggleAtSourceCaret()).toBe(false);
    f.view.destroy();
  });
  it('does not toggle while Source and the session disagree', () => {
    const f = setup([], SAMPLE + 'more\n');
    f.view.dispatch({ selection: { anchor: 26 } });
    expect(f.sync.toggleAtSourceCaret()).toBe(false);
    expect(f.sync.store.keys()).toEqual([]);
    f.view.destroy();
  });
  it('ignores Source folds while Source and the session disagree', () => {
    const f = setup([], SAMPLE + 'more\n');
    f.view.dispatch({ effects: foldEffect.of({ from: 22, to: 30 }) });
    expect(f.sync.store.keys()).toEqual([]);
    f.view.destroy();
  });
  it('folds every heading and unfolds everything', () => {
    const f = setup([]);
    // foldAllHeadings folds all headings but leaves list items unfolded.
    f.sync.foldAllHeadings();
    expect(f.sync.store.isFolded('heading:a')).toBe(true);
    expect(f.sync.store.isFolded('heading:b')).toBe(true);
    expect(f.sync.store.isFolded('item:one')).toBe(false);
    // unfoldAll clears every folded key from the store.
    f.sync.unfoldAll();
    expect(f.sync.store.keys()).toEqual([]);
    f.view.destroy();
  });

  it('stops applying once destroyed', async () => {
    const f = setup([]);
    // Folding heading:b schedules a microtask re-apply, which destroy must cancel.
    f.sync.store.setFolded('heading:b', true);
    f.sync.destroy();
    await Promise.resolve();
    expect(foldStarts(f.view)).toEqual([]);
    f.view.destroy();
  });
});
