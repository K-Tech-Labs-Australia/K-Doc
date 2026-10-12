/**
 * @file merge-dialog.ts
 * @purpose Implements MergeDialog, an accessible modal dialog using the native HTMLDialogElement for reviewing and resolving three-way line merges when a file changes on disk while unsaved edits exist (FR-6.4).
 * @inputs MergeDialogOptions containing the Document context.
 * @outputs MergeDialog controller instance exposing ask, isOpen, and destroy lifecycle methods, alongside MERGE_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installMergeDialog: Constructs, styles, and mounts the native merge dialog element, wires hunk presentation, conflict choices, and action buttons, and returns the MergeDialog controller.
 * @dataflow MergeDialog ask(fileName, result) -> hunks list DOM reconstruction -> user hunk selection -> footer count update -> button action (Apply merge / Keep mine / Use theirs / Decide later / Escape / destroy) -> closeDialog() -> Promise resolution with MergeOutcome.
 * @controlflow Mount native dialog to document body -> configure dialog role and aria attributes -> bind button and cancel handlers -> on ask rebuild hunk items in document order -> seed conflict choices -> update footer -> showModal and focus Apply merge -> return MergeDialog controller.
 * @version 3
 * @date 2026-10-04
 */

import type { HunkChoice, MergeHunk, MergeResult } from '@k-doc/core';
import { resolvedText } from '@k-doc/core';

/** What the user settled on. */
export type MergeOutcome =
  | { readonly kind: 'merged'; readonly text: string }
  | { readonly kind: 'keepMine' }
  | { readonly kind: 'takeTheirs' }
  | { readonly kind: 'cancelled' };

export interface MergeDialogOptions {
  readonly doc: Document;
}

export interface MergeDialog {
  /**
   * Shows the merge and resolves with what the user chose.
   * @param fileName the file's display name, for the heading
   * @param result the merge to show
   */
  ask(fileName: string, result: MergeResult): Promise<MergeOutcome>;
  readonly isOpen: boolean;
  destroy(): void;
}

/** Number of context lines shown at the beginning and end of long stable hunks. */
const CONTEXT_LINES: number = 3;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple merge dialog instances. */
let nextMergeDialogId: number = 0;

/**
 * Static stylesheet for the merge modal dialog, styling the dialog backdrop, container,
 * hunk list, stable context elision, conflict columns, selection buttons, and action buttons
 * using exclusively authoritative K-Doc design tokens.
 */
export const MERGE_DIALOG_STYLES: string = `
dialog.kdoc-merge-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  width: min(900px, 92vw);
  max-width: min(900px, 92vw);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-merge-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-merge-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 85vh;
}

.kdoc-dialog-heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.kdoc-dialog-button {
  min-width: 64px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-dialog-button:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
}

.kdoc-dialog-button.kdoc-dialog-button-primary,
.kdoc-dialog-button.kdoc-dialog-button-save,
.kdoc-dialog-button.kdoc-dialog-apply {
  border-color: var(--kdoc-chrome-accent);
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
}

.kdoc-dialog-button.kdoc-dialog-button-primary:hover,
.kdoc-dialog-button.kdoc-dialog-button-save:hover,
.kdoc-dialog-button.kdoc-dialog-apply:hover,
.kdoc-dialog-button.kdoc-dialog-button-primary:active,
.kdoc-dialog-button.kdoc-dialog-button-save:active,
.kdoc-dialog-button.kdoc-dialog-apply:active {
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 88%, var(--kdoc-chrome-text));
}

.kdoc-dialog-button.kdoc-dialog-button-primary:disabled,
.kdoc-dialog-button.kdoc-dialog-apply:disabled {
  border-color: var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-button.kdoc-dialog-button-discard {
  color: var(--kdoc-emissive-red);
}

.kdoc-merge-hunks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
  border: 0;
  border-radius: var(--kdoc-radius-lg);
  padding: 8px;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
}

.kdoc-merge-hunk {
  border-left: 4px solid transparent;
  padding: 8px 12px;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-raised);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-merge-stable {
  border-left-color: transparent;
}

.kdoc-merge-mine {
  border-left-color: var(--kdoc-chrome-accent);
}

.kdoc-merge-theirs {
  border-left-color: var(--kdoc-emissive-green);
}

.kdoc-merge-conflict {
  border-left-color: var(--kdoc-emissive-amber);
}

.kdoc-merge-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--kdoc-chrome-text-muted);
  margin-bottom: 6px;
}

.kdoc-merge-lines {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
  color: var(--kdoc-chrome-text);
  border: 0;
  box-shadow: none;
  background: transparent;
}

.kdoc-merge-elided {
  font-size: 12px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  padding: 4px 0;
  text-align: center;
  user-select: none;
}

.kdoc-merge-empty {
  font-size: 12px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  padding: 4px 0;
}

.kdoc-merge-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.kdoc-merge-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.kdoc-merge-column-header {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: var(--kdoc-radius-md);
  cursor: pointer;
  box-sizing: border-box;
  text-align: left;
  border: 1px solid transparent;
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text-muted);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-merge-column-header:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-merge-column-header:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-merge-column-header.kdoc-merge-picked {
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  color: var(--kdoc-chrome-accent);
  font-weight: 600;
}

.kdoc-merge-footer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kdoc-merge-status {
  margin: 0;
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  font-variant-numeric: tabular-nums;
}

.kdoc-merge-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-merge-primary {
  border: 1px solid transparent;
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
}

.kdoc-merge-primary:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-merge-primary:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-merge-hunks::-webkit-scrollbar {
  width: 8px;
}

.kdoc-merge-hunks::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-merge-hunks::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-merge-dialog,
  dialog.kdoc-merge-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Installs the modal merge dialog into the document body, wiring hunk presentation, action buttons, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for resolving three-way line merges with conflict choices.
 * @inputs options - MergeDialogOptions containing the Document context.
 * @outputs MergeDialog - Controller exposing ask, isOpen, and destroy lifecycle methods.
 * @dataflow options.doc -> dialog DOM hierarchy -> hunk selections and button actions -> Promise resolution with MergeOutcome.
 * @controlflow Mount native dialog to document body -> configure dialog role and aria attributes -> bind button and cancel handlers -> return MergeDialog controller.
 */
export function installMergeDialog(options: MergeDialogOptions): MergeDialog {
  const doc = options.doc;
  const dialogId = ++nextMergeDialogId;
  const titleId = `kdoc-merge-title-${dialogId}`;
  const statusId = `kdoc-merge-status-${dialogId}`;

  let destroyed = false;
  let settled = true;

  /** Module-scoped per-instance holder avoiding bare let closure narrowing under strict control-flow analysis. */
  const pendingHolder: { resolve: ((outcome: MergeOutcome) => void) | null } = {
    resolve: null,
  };

  const choices: Map<number, HunkChoice> = new Map<number, HunkChoice>();
  let currentResult: MergeResult | null = null;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-merge-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('aria-describedby', statusId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-merge-dialog-content';

  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'kdoc-dialog-heading kdoc-merge-heading';
  content.appendChild(heading);

  // Container for vertical hunk list.
  const hunksContainer = doc.createElement('div');
  hunksContainer.className = 'kdoc-merge-hunks';
  content.appendChild(hunksContainer);

  // Footer containing live conflict status and 4 action buttons.
  const footer = doc.createElement('div');
  footer.className = 'kdoc-merge-footer';

  const statusEl = doc.createElement('div');
  statusEl.id = statusId;
  statusEl.className = 'kdoc-merge-status';
  statusEl.setAttribute('aria-live', 'polite');
  footer.appendChild(statusEl);

  const actions = doc.createElement('div');
  actions.className = 'kdoc-dialog-actions kdoc-merge-actions';

  // Button 1: Apply merge (primary).
  const applyButton = doc.createElement('button');
  applyButton.type = 'button';
  applyButton.textContent = 'Apply merge';
  applyButton.className = 'kdoc-dialog-button kdoc-dialog-button-primary kdoc-merge-primary';
  applyButton.setAttribute('aria-label', 'Apply merge');
  applyButton.addEventListener('click', (): void => {
    // Check if an active merge result exists.
    if (currentResult !== null) {
      // Current result present: resolve with merged outcome using chosen lines.
      settle({ kind: 'merged', text: resolvedText(currentResult, choices) });
    } else {
      // No active result: cancel.
      settle({ kind: 'cancelled' });
    }
  });
  actions.appendChild(applyButton);

  // Button 2: Keep mine.
  const keepMineButton = doc.createElement('button');
  keepMineButton.type = 'button';
  keepMineButton.textContent = 'Keep mine';
  keepMineButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary kdoc-merge-keep-mine';
  keepMineButton.setAttribute('aria-label', 'Keep mine');
  keepMineButton.addEventListener('click', (): void => {
    settle({ kind: 'keepMine' });
  });
  actions.appendChild(keepMineButton);

  // Button 3: Use theirs.
  const useTheirsButton = doc.createElement('button');
  useTheirsButton.type = 'button';
  useTheirsButton.textContent = 'Use theirs';
  useTheirsButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary kdoc-merge-use-theirs';
  useTheirsButton.setAttribute('aria-label', 'Use theirs');
  useTheirsButton.addEventListener('click', (): void => {
    settle({ kind: 'takeTheirs' });
  });
  actions.appendChild(useTheirsButton);

  // Button 4: Decide later.
  const decideLaterButton = doc.createElement('button');
  decideLaterButton.type = 'button';
  decideLaterButton.textContent = 'Decide later';
  decideLaterButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary kdoc-merge-decide-later';
  decideLaterButton.setAttribute('aria-label', 'Decide later');
  decideLaterButton.addEventListener('click', (): void => {
    settle({ kind: 'cancelled' });
  });
  actions.appendChild(decideLaterButton);

  footer.appendChild(actions);
  content.appendChild(footer);
  dialog.appendChild(content);

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    settle({ kind: 'cancelled' });
  });

  // Mount dialog into document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the merge modal dialog if currently open.
   *
   * @purpose Dismisses the modal dialog in an idempotent manner across native and test environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check if dialog is currently open -> invoke native close() or set open = false -> return.
   */
  function closeDialog(): void {
    // Check if the dialog element is currently open.
    if (dialog.open) {
      // Check if the native close() method is supported.
      if (typeof dialog.close === 'function') {
        // Close via native HTMLDialogElement API.
        dialog.close();
      } else {
        // Fallback for test environments: set open attribute to false.
        dialog.open = false;
      }
    } else {
      // Dialog is already closed: no operation required.
    }
  }

  /**
   * Closes the dialog and resolves any pending promise with the user's settled outcome once only.
   *
   * @purpose Closes the dialog before resolving the pending promise to ensure host focus calls are not overwritten by native dialog focus restoration.
   * @inputs outcome - The MergeOutcome to resolve the pending promise with.
   * @outputs void.
   * @dataflow outcome -> closeDialog() -> pendingHolder.resolve(outcome) -> clear pendingHolder.
   * @controlflow Close dialog -> check settled guard -> mark settled -> extract and invoke pendingHolder.resolve.
   */
  function settle(outcome: MergeOutcome): void {
    // Close BEFORE notifying the host, not after. A native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so closing afterwards silently undoes any focus the host sets
    // in its resolution path. The host's focus call has to be the last thing that runs.
    closeDialog();

    // Check if this ask session has already settled.
    // Resolving must be once-only: guard with a settled flag so duplicate events cannot resolve twice.
    if (settled) {
      // Already settled: ignore subsequent resolution attempts.
      return;
    } else {
      // Mark settled to prevent duplicate resolution.
      settled = true;
    }

    // Check if there is an active pending promise to resolve.
    if (pendingHolder.resolve !== null) {
      // Extract and clear the pending resolver before invocation.
      const resolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      resolve(outcome);
    } else {
      // No pending promise to resolve.
    }
  }

  /**
   * Updates the footer status label with live conflict counts and choice tallies.
   *
   * @purpose Refreshes the status text showing how many conflicts are resolved towards mine vs theirs.
   * @inputs void.
   * @outputs void.
   * @dataflow currentResult + choices map -> tally calculation -> statusEl.textContent update.
   * @controlflow Check if currentResult exists -> check if conflictCount is 0 -> set no-conflicts text -> else tally mine and theirs choices -> update status text.
   */
  function updateFooter(): void {
    // Check if there is an active merge result.
    if (currentResult === null) {
      // No active merge result: clear status text.
      statusEl.textContent = '';
      return;
    } else {
      // Active merge result present: proceed to compute status text.
    }

    // Check if there are no conflicts in the merge result.
    if (currentResult.conflictCount === 0) {
      // No conflicts: both sets of changes fit together cleanly without questions.
      statusEl.textContent = 'No conflicts — both sets of changes fit together';
      return;
    } else {
      // Conflicts present: compute choice tallies.
    }

    let mineCount: number = 0;
    let theirsCount: number = 0;

    // Tally current choices across all hunks.
    currentResult.hunks.forEach((hunk: MergeHunk, index: number): void => {
      // Check if this hunk is a conflict.
      if (hunk.kind === 'conflict') {
        const choice = choices.get(index);
        // Check which side is currently chosen.
        if (choice === 'theirs') {
          // Theirs chosen for this conflict hunk.
          theirsCount++;
        } else {
          // Mine chosen for this conflict hunk (default or explicit).
          mineCount++;
        }
      } else {
        // Non-conflict hunk: excluded from choice tally.
      }
    });

    // Update status element with live count and side breakdown.
    statusEl.textContent = `${currentResult.conflictCount} conflict(s), all resolved (${mineCount} taking yours, ${theirsCount} taking theirs)`;
  }

  /**
   * Renders a stable (unchanged) hunk block into the hunks container.
   *
   * @purpose Renders context lines for untouched document sections, collapsing long runs exceeding context limits.
   * @inputs hunk - The MergeHunk of kind 'stable' to render.
   * @outputs void.
   * @dataflow hunk.mine -> slice head and tail or take all -> DOM elements -> hunksContainer.appendChild.
   * @controlflow Check for empty lines -> render empty placeholder -> check if length exceeds twice CONTEXT_LINES -> render head, elided row, and tail -> else render all lines in single pre block.
   */
  function renderStableHunk(hunk: MergeHunk): void {
    const block = doc.createElement('div');
    block.className = 'kdoc-merge-hunk kdoc-merge-stable';

    // Check if the stable hunk contains no lines.
    if (hunk.mine.length === 0) {
      // Empty line array: render visible placeholder row.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-merge-empty';
      emptyRow.textContent = '(nothing)';
      block.appendChild(emptyRow);
    } else if (hunk.mine.length > CONTEXT_LINES * 2) {
      // Long stable hunk exceeding twice CONTEXT_LINES: elide middle unchanged lines.
      const headPre = doc.createElement('pre');
      headPre.className = 'kdoc-merge-lines';
      headPre.textContent = hunk.mine.slice(0, CONTEXT_LINES).join('\n');
      block.appendChild(headPre);

      const elidedCount = hunk.mine.length - CONTEXT_LINES * 2;
      const elidedRow = doc.createElement('div');
      elidedRow.className = 'kdoc-merge-elided';
      elidedRow.textContent = `… ${elidedCount} unchanged lines …`;
      block.appendChild(elidedRow);

      const tailPre = doc.createElement('pre');
      tailPre.className = 'kdoc-merge-lines';
      tailPre.textContent = hunk.mine.slice(-CONTEXT_LINES).join('\n');
      block.appendChild(tailPre);
    } else {
      // Stable hunk within context limits: render all lines in one pre block.
      const pre = doc.createElement('pre');
      pre.className = 'kdoc-merge-lines';
      pre.textContent = hunk.mine.join('\n');
      block.appendChild(pre);
    }

    hunksContainer.appendChild(block);
  }

  /**
   * Renders a mine (unsaved edits) hunk block into the hunks container.
   *
   * @purpose Renders the user's unsaved edits with a descriptive label, accepted automatically.
   * @inputs hunk - The MergeHunk of kind 'mine' to render.
   * @outputs void.
   * @dataflow hunk.mine -> preformatted lines -> DOM elements -> hunksContainer.appendChild.
   * @controlflow Create block container -> append "Your edit" label -> check for empty lines -> append placeholder or pre block -> append block to container.
   */
  function renderMineHunk(hunk: MergeHunk): void {
    const block = doc.createElement('div');
    block.className = 'kdoc-merge-hunk kdoc-merge-mine';

    const label = doc.createElement('div');
    label.className = 'kdoc-merge-label';
    label.textContent = 'Your edit';
    block.appendChild(label);

    // Check if the mine hunk contains no lines.
    if (hunk.mine.length === 0) {
      // Pure deletion on mine side: render visible placeholder row.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-merge-empty';
      emptyRow.textContent = '(nothing)';
      block.appendChild(emptyRow);
    } else {
      // Render mine lines in a pre block with whitespace preserved.
      const pre = doc.createElement('pre');
      pre.className = 'kdoc-merge-lines';
      pre.textContent = hunk.mine.join('\n');
      block.appendChild(pre);
    }

    hunksContainer.appendChild(block);
  }

  /**
   * Renders a theirs (disk changes) hunk block into the hunks container.
   *
   * @purpose Renders the file-on-disk changes with a descriptive label, accepted automatically.
   * @inputs hunk - The MergeHunk of kind 'theirs' to render.
   * @outputs void.
   * @dataflow hunk.theirs -> preformatted lines -> DOM elements -> hunksContainer.appendChild.
   * @controlflow Create block container -> append "Changed on disk" label -> check for empty lines -> append placeholder or pre block -> append block to container.
   */
  function renderTheirsHunk(hunk: MergeHunk): void {
    const block = doc.createElement('div');
    block.className = 'kdoc-merge-hunk kdoc-merge-theirs';

    const label = doc.createElement('div');
    label.className = 'kdoc-merge-label';
    label.textContent = 'Changed on disk';
    block.appendChild(label);

    // Check if the theirs hunk contains no lines.
    if (hunk.theirs.length === 0) {
      // Pure deletion on disk side: render visible placeholder row.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-merge-empty';
      emptyRow.textContent = '(nothing)';
      block.appendChild(emptyRow);
    } else {
      // Render theirs lines in a pre block with whitespace preserved.
      const pre = doc.createElement('pre');
      pre.className = 'kdoc-merge-lines';
      pre.textContent = hunk.theirs.join('\n');
      block.appendChild(pre);
    }

    hunksContainer.appendChild(block);
  }

  /**
   * Renders a two-column conflict hunk with selectable column header buttons.
   *
   * @purpose Renders side-by-side Yours and On disk columns allowing the user to pick which side to resolve to.
   * @inputs
   *   - hunk: MergeHunk - The conflict hunk containing competing mine and theirs lines.
   *   - index: number - Document-order hunk index in result.hunks.
   * @outputs void.
   * @dataflow hunk lines -> two column elements -> button click events -> choices map update -> selection UI update -> updateFooter().
   * @controlflow Construct two columns -> attach Yours and On disk buttons -> populate line blocks -> wire button click handlers -> apply initial selection state -> append to container.
   */
  function renderConflictHunk(hunk: MergeHunk, index: number): void {
    const block = doc.createElement('div');
    block.className = 'kdoc-merge-hunk kdoc-merge-conflict';

    const columns = doc.createElement('div');
    columns.className = 'kdoc-merge-columns';

    // Construct left column: Yours (mine side).
    const leftCol = doc.createElement('div');
    leftCol.className = 'kdoc-merge-column kdoc-merge-column-mine';

    const mineBtn = doc.createElement('button');
    mineBtn.type = 'button';
    mineBtn.className = 'kdoc-merge-column-header';
    mineBtn.textContent = 'Yours';
    mineBtn.setAttribute('data-hunk', String(index));
    mineBtn.setAttribute('data-side', 'mine');
    leftCol.appendChild(mineBtn);

    // Check if mine lines are empty.
    if (hunk.mine.length === 0) {
      // Pure deletion on mine side: render visible placeholder row.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-merge-empty';
      emptyRow.textContent = '(nothing)';
      leftCol.appendChild(emptyRow);
    } else {
      // Render mine lines in a pre block.
      const preMine = doc.createElement('pre');
      preMine.className = 'kdoc-merge-lines';
      preMine.textContent = hunk.mine.join('\n');
      leftCol.appendChild(preMine);
    }

    // Construct right column: On disk (theirs side).
    const rightCol = doc.createElement('div');
    rightCol.className = 'kdoc-merge-column kdoc-merge-column-theirs';

    const theirsBtn = doc.createElement('button');
    theirsBtn.type = 'button';
    theirsBtn.className = 'kdoc-merge-column-header';
    theirsBtn.textContent = 'On disk';
    theirsBtn.setAttribute('data-hunk', String(index));
    theirsBtn.setAttribute('data-side', 'theirs');
    rightCol.appendChild(theirsBtn);

    // Check if theirs lines are empty.
    if (hunk.theirs.length === 0) {
      // Pure deletion on disk side: render visible placeholder row.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-merge-empty';
      emptyRow.textContent = '(nothing)';
      rightCol.appendChild(emptyRow);
    } else {
      // Render theirs lines in a pre block.
      const preTheirs = doc.createElement('pre');
      preTheirs.className = 'kdoc-merge-lines';
      preTheirs.textContent = hunk.theirs.join('\n');
      rightCol.appendChild(preTheirs);
    }

    columns.appendChild(leftCol);
    columns.appendChild(rightCol);
    block.appendChild(columns);
    hunksContainer.appendChild(block);

    /**
     * Updates aria-pressed attributes and picked CSS classes on the two column buttons according to current choice.
     *
     * @purpose Synchronizes button visual and accessibility states with choices map.
     * @inputs void.
     * @outputs void.
     * @dataflow choices.get(index) -> button attribute updates.
     * @controlflow Check if current choice is 'theirs' -> mark theirs button pressed and mine unpressed -> else mark mine button pressed and theirs unpressed.
     */
    function applySelectionState(): void {
      const choice = choices.get(index);
      // Check which side is currently chosen for this conflict.
      if (choice === 'theirs') {
        // Theirs chosen: highlight right button, unhighlight left button.
        theirsBtn.setAttribute('aria-pressed', 'true');
        theirsBtn.classList.add('kdoc-merge-picked');
        mineBtn.setAttribute('aria-pressed', 'false');
        mineBtn.classList.remove('kdoc-merge-picked');
      } else {
        // Mine chosen: highlight left button, unhighlight right button.
        mineBtn.setAttribute('aria-pressed', 'true');
        mineBtn.classList.add('kdoc-merge-picked');
        theirsBtn.setAttribute('aria-pressed', 'false');
        theirsBtn.classList.remove('kdoc-merge-picked');
      }
    }

    // Bind click on Yours button.
    mineBtn.addEventListener('click', (): void => {
      choices.set(index, 'mine');
      applySelectionState();
      updateFooter();
    });

    // Bind click on On disk button.
    theirsBtn.addEventListener('click', (): void => {
      choices.set(index, 'theirs');
      applySelectionState();
      updateFooter();
    });

    // Apply initial selection state reflecting seeded default ('mine').
    applySelectionState();
  }

  /**
   * Opens the merge modal dialog with the specified file name and merge result, resolving with the user's choice.
   *
   * @purpose Rebuilds the hunks display in document order, seeds conflict defaults to 'mine', opens the dialog, and awaits resolution.
   * @inputs
   *   - fileName: string - Display name of the file being merged, displayed in the heading.
   *   - result: MergeResult - Three-way merge result containing classified hunks and conflict count.
   * @outputs Promise<MergeOutcome> - A Promise resolving to 'merged' with resolved text, 'keepMine', 'takeTheirs', or 'cancelled'.
   * @dataflow fileName, result -> DOM updates -> choices map reset & seed -> showModal() -> applyButton.focus() -> Promise<MergeOutcome>.
   * @controlflow Check destroyed guard -> cancel pending promise -> reset settled flag -> update heading -> clear and rebuild hunks -> seed choices -> update footer -> showModal -> focus Apply merge -> return new Promise.
   */
  function ask(fileName: string, result: MergeResult): Promise<MergeOutcome> {
    heading.textContent = fileName;
    currentResult = result;

    // Check if the merge dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: resolve with 'cancelled' immediately.
      return Promise.resolve({ kind: 'cancelled' });
    } else {
      // Component is active: proceed with asking.
    }

    // Check if a prior ask invocation is currently pending resolution.
    if (pendingHolder.resolve !== null) {
      // A second ask while one is pending must not strand the first promise.
      const previousResolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      previousResolve({ kind: 'cancelled' });
    } else {
      // No outstanding promise pending.
    }

    // Reset the settled flag for the new ask cycle.
    settled = false;

    // Clear previous hunks container DOM content.
    hunksContainer.textContent = '';

    // Clear and seed choices: every conflict hunk's index defaults to 'mine'.
    choices.clear();
    // Seed choices for each conflict hunk.
    result.hunks.forEach((hunk: MergeHunk, index: number): void => {
      // Check if this hunk is a conflict requiring user resolution.
      if (hunk.kind === 'conflict') {
        // Seed conflict choice with 'mine' so unsaved work is preserved by default.
        choices.set(index, 'mine');
      } else {
        // Non-conflict hunk: no choice required.
      }
    });

    // Render all hunks in document order.
    result.hunks.forEach((hunk: MergeHunk, index: number): void => {
      // Dispatch rendering based on hunk kind.
      if (hunk.kind === 'stable') {
        renderStableHunk(hunk);
      } else if (hunk.kind === 'mine') {
        renderMineHunk(hunk);
      } else if (hunk.kind === 'theirs') {
        renderTheirsHunk(hunk);
      } else {
        renderConflictHunk(hunk, index);
      }
    });

    // Update footer status message and tallies.
    updateFooter();

    // Check if the dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog is already open: skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Focus Apply merge button by default as the safe primary action.
    applyButton.focus();

    return new Promise<MergeOutcome>((resolve): void => {
      pendingHolder.resolve = resolve;
    });
  }

  /**
   * Destroys the merge dialog component, canceling any pending promise and removing the dialog DOM node.
   *
   * @purpose Idempotently cleans up the dialog component, resolves outstanding promises with 'cancelled', and removes the DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow mark destroyed = true -> settle({ kind: 'cancelled' }) -> dialog.remove().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> settle with 'cancelled' -> remove dialog from DOM.
   */
  function destroy(): void {
    // Check if the dialog has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active dialog: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    settle({ kind: 'cancelled' });
    dialog.remove();
  }

  return {
    ask,
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component reports false.
        return false;
      } else {
        // Active component reflects dialog.open attribute.
        return dialog.open;
      }
    },
    destroy,
  };
}
