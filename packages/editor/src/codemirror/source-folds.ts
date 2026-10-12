/**
 * @file source-folds.ts
 * @purpose Keeps the Source pane's CodeMirror folds in step with the shell's per-document fold keys for FR-8.29. Folding ranges themselves come from `@codemirror/lang-markdown` (heading sections via its fold service, list items via foldNodeProp); this module only maps keyed targets onto those ranges, applies folds, and reports user-made folds.
 * @inputs EditorState or EditorView plus a list of SourceFoldTarget keys with the source offsets where each heading section or list item begins; for the listener, a callback invoked when the user changes a fold.
 * @outputs A Map of target key to folded state (sourceFoldStates), a boolean indicating whether any change was applied (applySourceFolds), and an Extension wiring the update listener (sourceFoldListener); internal FoldRange values are returned by the private helpers only.
 * @functions
 *   - foldRangeOf: Resolves the fold range covering the line at a source offset, or null when that line is not foldable in Source.
 *   - foldedAt: Returns the currently-applied fold range starting exactly at an offset, or null when none is active there.
 *   - sourceFoldStates: Builds a Map of every target key to whether its fold is currently applied.
 *   - applySourceFolds: Dispatches fold/unfold effects so Source's folds match the shell's desired state; returns false when nothing changed.
 *   - sourceFoldListener: Returns an EditorView update listener that reports user-made fold changes while ignoring our own sync and doc edits.
 * @dataflow Shell-provided targets (key + start offset) → foldRangeOf/foldedAt read the Markdown tree → Map<boolean> or StateEffect[] → view.dispatch; gutter/user folds → updateListener callback → onUserFoldChange(state).
 * @controlflow Each helper reads the parse tree once, resolves every target's range, and compares current vs. desired fold state; applySourceFolds batches effects and dispatches a single annotated transaction only when something differs.
 * @version 1
 * @date 2026-09-16
 */

import { Annotation } from '@codemirror/state';
import type { EditorState, Extension, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';

/** A fold key owned by the shell paired with the source offset where its heading section or list item begins. */
export interface SourceFoldTarget {
  readonly key: string;
  readonly start: number;
}

/** Marks transactions this module dispatches so the update listener ignores them as user actions. */
export const foldSyncAnnotation = Annotation.define<boolean>();

// How long to let the Markdown parser catch up before reading fold ranges; a parse that has not reached a line reports it as not foldable.
const PARSE_TIMEOUT_MS = 200;

/** A resolved fold range in source offsets, matching what `@codemirror/language` reports for a heading section or list item. */
interface FoldRange {
  readonly from: number;
  readonly to: number;
}

/**
 * @purpose Resolves the fold range covering the line that contains a source offset, returning null when that line is not foldable in Source (so Source has no say about it).
 * @inputs state - The editor state whose Markdown tree and document are consulted. start - The source offset of the target's heading or list item.
 * @outputs FoldRange | null — the fold range starting at the resolved line, or null when the offset is out of bounds or the line reports no foldable range.
 * @dataflow start → validated against doc length → lineAt extracts the line → foldable reads the syntax tree and returns the range (or null).
 * @controlflow Guards the offset against [0, doc.length]; if outside, returns null early. Otherwise resolves the containing line and delegates to foldable; its result is returned directly.
 */
function foldRangeOf(state: EditorState, start: number): FoldRange | null {
  // Reject offsets outside the document so lineAt never throws on a dangling index.
  if (start < 0 || start > state.doc.length) {
    return null;
  } else {
    const line = state.doc.lineAt(start);
    return foldable(state, line.from, line.to);
  }
}

/**
 * @purpose Returns the currently-applied fold range that starts exactly at an offset, or null when no active fold begins there.
 * @inputs state - The editor state whose applied folds are inspected via foldedRanges(). from - The source offset a target's fold would start at.
 * @outputs FoldRange | null — the active fold range beginning at `from`, or null when none is present.
 * @dataflow foldedRanges(state) → between(from, from, ...) walks active ranges → holder captures the matching {from, to} and halts iteration.
 * @controlflow Iterates active ranges; on the first whose start equals `from`, records it and returns false to stop; otherwise continues until exhausted, then returns the captured range (or null).
 */
function foldedAt(state: EditorState, from: number): FoldRange | null {
  // Holder object resolves the TypeScript narrowing issue where assigning inside the callback leaves a plain `let` typed as null.
  const holder: { range: FoldRange | null } = { range: null };
  foldedRanges(state).between(from, from, (rangeFrom, rangeTo) => {
    if (rangeFrom === from) {
      // Found the active fold that starts exactly here; capture it and stop iterating.
      holder.range = { from: rangeFrom, to: rangeTo };
      return false;
    } else {
      // Different range start; keep scanning for an exact match.
      return undefined;
    }
  });
  return holder.range;
}

/**
 * @purpose Reports, for each shell-provided target, whether its fold is currently applied in Source.
 * @inputs state - The editor state whose Markdown tree and applied folds are read. targets - The ordered keys with start offsets to resolve.
 * @outputs Map<string, boolean> — keyed by target.key, true when that target's fold range has an active fold starting at its resolved from offset.
 * @dataflow Each target → foldRangeOf resolves its line range → foldedAt checks if a fold is active there → result map entry set.
 * @controlflow Ensures the parse tree is ready, then iterates targets; non-foldable ranges are skipped (Source has no say), and every resolvable target records its folded state.
 */
export function sourceFoldStates(state: EditorState, targets: readonly SourceFoldTarget[]): Map<string, boolean> {
  ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  const result = new Map<string, boolean>();
  for (const t of targets) {
    const range = foldRangeOf(state, t.start);
    if (range === null) {
      // Not foldable in Source, so Source has no say about this target; leave it out of the map.
      continue;
    } else {
      result.set(t.key, foldedAt(state, range.from) !== null);
    }
  }
  return result;
}

/**
 * @purpose Applies or removes Source's folds so they match the shell's desired per-key state, dispatching a single annotated transaction only when something changes. Folds on lines that are not targets (a fenced code block, a table) are never touched because effects are produced solely from resolved target ranges.
 * @inputs view - The live editor whose state is mutated. targets - The keys with start offsets to reconcile. isFolded - Predicate returning true when a key should be folded.
 * @outputs boolean — true when at least one fold effect was dispatched, false when Source already matched the desired state (no transaction sent).
 * @dataflow Each target → foldRangeOf resolves its range → current vs. wanted (isFolded) compared → foldEffect/unfoldEffect pushed to a batch → view.dispatch with foldSyncAnnotation.
 * @controlflow Ensures the parse tree, builds an effects list, and for each target pushes exactly one effect when current diverges from wanted; dispatches only if the list is non-empty, tagging the transaction so the listener ignores it.
 */
export function applySourceFolds(
  view: EditorView,
  targets: readonly SourceFoldTarget[],
  isFolded: (key: string) => boolean,
): boolean {
  const state = view.state;
  ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  const effects: StateEffect<unknown>[] = [];
  for (const t of targets) {
    const range = foldRangeOf(state, t.start);
    if (range === null) {
      // Not foldable in Source, so this target is never touched.
      continue;
    } else {
      const current = foldedAt(state, range.from);
      const wanted = isFolded(t.key);
      if (wanted && current === null) {
        // Desired to be folded but no active fold exists here; create one.
        effects.push(foldEffect.of(range));
      } else if (!wanted && current !== null) {
        // Desired unfolded and a fold is currently active; remove it.
        effects.push(unfoldEffect.of(current));
      } else {
        // Already matches the desired state; no effect needed.
      }
    }
  }
  if (effects.length === 0) {
    // Nothing diverged from the desired fold state, so there is no transaction to send.
    return false;
  } else {
    view.dispatch({ effects, annotations: foldSyncAnnotation.of(true) });
    return true;
  }
}

/**
 * @purpose Returns an EditorView update listener that surfaces user-made fold changes while ignoring our own sync transactions and doc edits.
 * @inputs onUserFoldChange - Callback invoked with the post-change state whenever a genuine user fold/unfold occurs.
 * @outputs Extension — an EditorView.updateListener extension wired to classify each update.
 * @dataflow Each view update → docChanged / foldedRanges equality / annotation checks → onUserFoldChange(update.state) for genuine user changes.
 * @controlflow Skips updates where the document changed (fold offsets would lag), where no fold range differs, or where the transaction is our own sync; only then forwards to the callback.
 */
export function sourceFoldListener(onUserFoldChange: (state: EditorState) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      // Edits only move existing folds; the offsets the shell holds may lag the new text, so defer to the next stable update.
      return;
    } else if (foldedRanges(update.startState) === foldedRanges(update.state)) {
      // No fold range differs between states, so nothing a consumer cares about changed.
      return;
    } else if (update.transactions.some((tr) => tr.annotation(foldSyncAnnotation) === true)) {
      // This update was produced by our own applySourceFolds dispatch; the listener must ignore it.
      return;
    } else {
      // A genuine user fold or unfold — from the gutter, the fold keys, or CodeMirror clearing a fold the caret entered.
      onUserFoldChange(update.state);
    }
  });
}
