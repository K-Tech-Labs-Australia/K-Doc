/**
 * @file fold-sync.ts
 * @purpose Owns the shared fold store rendered by both editor panes and keeps the Source pane (CodeMirror) in step with it, so folding state stays consistent across the WYSIWYG and Source views.
 * @inputs FoldSyncOptions: initial folded keys, a session document accessor, a lazily-read Source view accessor, and a persistence callback; fold APIs from '@k-doc/core' and '@k-doc/editor'.
 * @outputs A FoldSync object exposing the shared store, a CodeMirror extension that pushes user fold changes into the store, and lifecycle/commands for reconciling folds with the current session.
 * @functions
 *   - sourceTargets: Projects document fold targets down to the {key, start} shape SourceFoldTarget expects.
 *   - createFoldSync: Wires the shared FoldController, the Source→store listener, and the reconciliation commands into a FoldSync.
 *   - applyToSource: Drives CodeMirror's folds to match the store for the current session (skipped until Source catches up).
 *   - schedule: Defers applyToSource to the next microtask so it runs outside CodeMirror/ProseMirror update cycles.
 * @dataflow initialKeys → FoldController.store ↔ persist; documentOf + sourceView → applySourceFolds into Source; user fold edits via sourceFoldListener → store.setMany; session change → schedule → applyToSource restores folds.
 * @controlflow Build controller and listener, return object whose methods branch on destroyed/text-length guards before mutating the store or dispatching folds to Source.
 * @version 1
 * @date 2026-09-16
 */

import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { foldTargets, innermostFoldTarget } from '@k-doc/core';
import type { KdocDocument } from '@k-doc/core';
import { applySourceFolds, sourceFoldListener, sourceFoldStates } from '@k-doc/editor';
import type { SourceFoldTarget } from '@k-doc/editor';
import { createFoldController } from './fold-state.js';
import type { FoldController } from './fold-state.js';

/**
 * @purpose Projects each document fold target down to the {key, start} shape that Source's fold APIs consume.
 * @inputs document - the session's current parsed document whose headings and list items are fold targets.
 * @outputs An array of SourceFoldTarget objects (key + source start offset), one per document fold target.
 * @dataflow foldTargets(document) → map each {key, kind, start, end} to {key, start}.
 * @controlflow Unconditional single-pass map; no branching.
 */
function sourceTargets(document: KdocDocument): SourceFoldTarget[] {
  return foldTargets(document).map((target) => ({ key: target.key, start: target.start }));
}

/**
 * What createFoldSync needs from the shell: the saved keys, the session's document, the Source view and a place to save keys.
 */
export interface FoldSyncOptions {
  readonly initialKeys: readonly string[];
  readonly documentOf: () => KdocDocument; // the session's current parsed document
  readonly sourceView: () => EditorView; // the Source pane's view; read lazily because it is created after this
  readonly persist: (keys: readonly string[]) => void;
}

/**
 * @purpose The public contract returned by createFoldSync: the shared store, a CodeMirror extension, and session reconciliation commands.
 * @inputs none.
 * @outputs A FoldSync instance consumed by both editor panes in the shell.
 * @dataflow store is rendered by both panes; sourceExtension feeds user fold edits back into store; methods reconcile folds with the current session.
 * @controlflow Callers read store.isFolded/setFolded, add sourceExtension to Source's view, and invoke commands on session or caret events.
 */
export interface FoldSync {
  readonly store: FoldController;
  readonly sourceExtension: Extension;
  sessionChanged(): void;
  applyToSource(): void;
  toggleAtSourceCaret(): boolean;
  foldAllHeadings(): void;
  unfoldAll(): void;
  destroy(): void;
}

/**
 * @purpose Creates the FoldSync that owns the shared fold store and reconciles it with both editor panes for one session.
 * @inputs options - initial folded keys, a document accessor, a lazily-read Source view accessor, and a persistence callback.
 * @outputs A FoldSync exposing the shared store, a CodeMirror extension feeding user edits back into the store, and reconciliation commands.
 * @dataflow initialKeys seed the controller; persist + schedule fan out on store change; sourceFoldListener pushes Source fold state into the store; returned methods drive applyToSource or mutate the store.
 * @controlflow Declare guards, define applyToSource/schedule, build the controller and listener, then return the object wiring each command with text-length and destroyed guards.
 */
export function createFoldSync(options: FoldSyncOptions): FoldSync {
  let destroyed = false;
  let scheduled = false;

  /**
   * @purpose Drives CodeMirror's Source folds to match the shared store for the current session.
   * @inputs none; reads options.sourceView(), options.documentOf(), and store.isFolded via closure.
   * @outputs void; applies the folds to Source, or skips when destroyed or Source has not caught up with the session yet.
   * @dataflow sourceView + documentOf → sourceTargets(document) + isFolded predicate → applySourceFolds mutates Source's fold decorations.
   * @controlflow Early return when destroyed; else compare doc lengths and either skip until Source catches up or apply the folds.
   */
  function applyToSource(): void {
    if (destroyed) {
      // The sync has been torn down: nothing should mutate the store or Source now.
      return;
    } else {
      const view = options.sourceView();
      const document = options.documentOf();
      if (view.state.doc.length !== document.text.length) {
        // Source has not caught up with the session yet; defer to the next session change.
        return;
      } else {
        applySourceFolds(view, sourceTargets(document), (key) => store.isFolded(key));
      }
    }
  }

  /**
   * @purpose Defers applyToSource to the next microtask so it runs outside CodeMirror/ProseMirror update cycles.
   * @inputs none; reads the module-scheduled guard and applies via closure.
   * @outputs void; schedules at most one pending microtask that re-runs applyToSource.
   * @dataflow scheduled flag → queueMicrotask callback clears the flag then calls applyToSource.
   * @controlflow Early return when a microtask is already pending; otherwise set the guard and enqueue the deferred call.
   */
  function schedule(): void {
    if (scheduled) {
      // A microtask is already pending: do not schedule a duplicate reconciliation.
      return;
    } else {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        applyToSource();
      });
    }
  }

  const store = createFoldController(
    options.initialKeys,
    /**
     * @purpose Persists new fold keys and schedules a Source reconciliation whenever the store changes.
     * @inputs keys - the fresh snapshot of folded keys emitted by the controller.
     * @outputs void; side-effecting through persist and schedule.
     * @dataflow controller change → options.persist(keys) then schedule() → deferred applyToSource.
     * @controlflow Unconditional: persist first, then request a deferred sync.
     */
    (keys) => {
      options.persist(keys);
      schedule();
    },
  );

  const sourceExtension = sourceFoldListener(
    /**
     * @purpose Pushes user-driven Source fold changes back into the shared store without echoing applySourceFolds' own transactions.
     * @inputs state - the CodeMirror EditorState after a user fold edit.
     * @outputs void; mutates the store via setMany when text is in step.
     * @dataflow state.doc + documentOf → sourceTargets(document) → sourceFoldStates(state) → store.setMany.
     * @controlflow Compare doc lengths and skip when out of step (offsets would be wrong); otherwise sync the whole fold snapshot into the store.
     */
    (state) => {
      const document = options.documentOf();
      if (state.doc.length !== document.text.length) {
        // Text is out of step with the store; source offsets would be wrong, so ignore this update.
        return;
      } else {
        store.setMany(sourceFoldStates(state, sourceTargets(document)));
      }
    },
  );

  return {
    store,
    sourceExtension,
    /**
     * @purpose Restores folded sections into Source after it replaced its whole text and lost its folds during another pane's edit.
     * @inputs none; reads store.keys() via closure.
     * @outputs void; schedules a deferred reconciliation only when something is folded.
     * @dataflow store keys → schedule() → applyToSource re-applies the folds to Source.
     * @controlflow Branch on whether any section is folded: schedule a restore, or do nothing when none are folded.
     */
    sessionChanged(): void {
      if (store.keys().length > 0) {
        // Sections are folded; Source dropped its folds when it replaced text, so re-apply them.
        schedule();
      } else {
        // Nothing is folded: there is nothing to restore, so do nothing.
      }
    },
    applyToSource,
    /**
     * @purpose Toggles the fold of the innermost section under the Source caret, syncing both panes through the shared store.
     * @inputs none; reads options.sourceView(), options.documentOf(), and store via closure.
     * @outputs boolean — true when a section was toggled, false when skipped (not caught up) or no target lies under the caret.
     * @dataflow sourceView + documentOf → fold states + innermostFoldTarget(caret) → store.toggle(target.key).
     * @controlflow Skip until Source catches up; find the innermost folded target at the caret and toggle it, else report nothing found.
     */
    toggleAtSourceCaret(): boolean {
      const view = options.sourceView();
      const document = options.documentOf();
      if (view.state.doc.length !== document.text.length) {
        // Source has not caught up with the session yet; there is nothing to toggle reliably.
        return false;
      } else {
        const states = sourceFoldStates(view.state, sourceTargets(document));
        const target = innermostFoldTarget(
          foldTargets(document).filter((candidate) => states.has(candidate.key)),
          view.state.selection.main.head,
        );
        if (target === null) {
          // No folded section contains the caret: nothing to toggle.
          return false;
        } else {
          store.toggle(target.key);
          return true;
        }
      }
    },
    /**
     * @purpose Folds every heading section in the current document through the shared store.
     * @inputs none; reads options.documentOf() via closure.
     * @outputs void; mutates the store so both panes render all headings folded.
     * @dataflow foldTargets(document) → filter kind === 'heading' → map to keys → store.setMany(all true).
     * @controlflow Unconditional: build the heading key set and apply it in one batch.
     */
    foldAllHeadings(): void {
      const keys = foldTargets(options.documentOf())
        .filter((candidate) => candidate.kind === 'heading')
        .map((candidate) => candidate.key);
      store.setMany(new Map(keys.map((key) => [key, true] as const)));
    },
    /**
     * @purpose Unfolds every section by replacing the store's folded set with an empty list.
     * @inputs none; reads store via closure.
     * @outputs void; clears all folds so both panes render fully expanded.
     * @dataflow [] → store.replaceAll([]) → emit notifies subscribers and persists.
     * @controlflow Unconditional single replacement of the folded set with nothing.
     */
    unfoldAll(): void {
      store.replaceAll([]);
    },
    /**
     * @purpose Marks the FoldSync torn down so deferred reconciliations become no-ops.
     * @inputs none; mutates the module-scope destroyed guard via closure.
     * @outputs void; sets the destroyed flag checked by applyToSource.
     * @dataflow destroy() → destroyed = true → future applyToSource early-returns.
     * @controlflow Unconditional single flag set.
     */
    destroy(): void {
      destroyed = true;
    },
  };
}
