/**
 * @file fidelity-controller.ts
 * @purpose Runs the Fidelity Check (FR-4.5): after a save, compares what was written against what the user edited to flag spans that changed on save though they were not touched by the user. The check is off unless developer mode is on — the shell decides this and passes it through `FidelityControllerOptions.enabled`, read at each save so a settings change takes effect on the next one.
 * @inputs A DocumentSession via attach, saved text via saved, current buffer text via problems, and FidelityControllerOptions providing the enabled gate and report sink.
 * @outputs Problem descriptors of kind 'fidelity' via problems(), plus findings reported through options.onReport after each checked save.
 * @functions
 *   - previewSpan: Bounds a changed span to FIDELITY_PREVIEW_CHARS and serializes it so control characters stay visible.
 *   - describeFinding: Maps a FidelityFinding to a Problem carrying the 'fidelity' kind.
 *   - createFidelityController: Builds the controller wiring the tracker, session subscription, and save-time check.
 *   - attach: Rebuilds the tracker from a session's saved text and subscribes to its changes.
 *   - saved: Runs the fidelity check against the saved text when enabled, then rebases onto it.
 *   - problems: Returns described findings only while the buffer still matches what was checked.
 *   - destroy: Releases the subscription and clears all closure state; idempotent.
 * @dataflow Session snapshot (savedText, text) → FidelityTracker base/buffer → record on each change → check at save → FidelityFinding[] → describeFinding → Problem[] → problems-panel UI.
 * @controlflow Attach rebuilds tracker and subscribes → edits record into the tracker → saved runs check-before-rebase when enabled → problems returns findings only for the exact checked text → destroy tears down.
 * @version 1
 * @date 2026-09-14
 */

import { FidelityTracker, type DocumentSession, type FidelityFinding, type SessionChange } from '@k-doc/core';
import type { Problem } from './problems-panel.js';

export interface FidelityControllerOptions {
  /** Whether the check runs; read at each save so a settings change takes effect on the next one. */
  readonly enabled: () => boolean;
  /** Called after each checked save with what it found, including an empty list. */
  readonly onReport: (findings: readonly FidelityFinding[]) => void;
}

export interface FidelityController {
  /** Starts tracking a newly mounted document, replacing whatever was attached before. */
  attach(session: DocumentSession): void;
  /** Runs the check against the text just written, when enabled, and makes it the new baseline. */
  saved(text: string): void;
  /** The last check's findings as problems, while the document is still exactly the text checked. */
  problems(currentText: string): readonly Problem[];
  /** Releases the session subscription. */
  destroy(): void;
}

/** Longest excerpt of a changed span shown in a problem's detail, in characters. */
export const FIDELITY_PREVIEW_CHARS = 40;

/**
 * @purpose Returns a bounded, JSON-serialized view of a changed span so newlines and trailing spaces stay visible as `\n` inside quotes.
 * @inputs text: string — the exact before/after excerpt to preview.
 * @outputs string — the quoted excerpt, truncated with an ellipsis glyph when it exceeds FIDELITY_PREVIEW_CHARS.
 * @dataflow text → slice at the preview budget (if too long) → JSON.stringify so escapes render inside quotes.
 * @controlflow If longer than the budget, truncate and append '…'; else serialize the whole span verbatim.
 */
export function previewSpan(text: string): string {
  // Check whether the span exceeds the preview character budget.
  if (text.length > FIDELITY_PREVIEW_CHARS) {
    // Truncate to the budget and mark continuation with a single ellipsis glyph so the reader knows it was cut.
    const excerpt = text.slice(0, FIDELITY_PREVIEW_CHARS) + '…';
    return JSON.stringify(excerpt);
  } else {
    // Short enough to show in full: serialize verbatim.
    return JSON.stringify(text);
  }
}

/**
 * @purpose Maps a fidelity finding to a Problem of kind 'fidelity' with a human-readable label and detail excerpt.
 * @inputs finding: FidelityFinding — the before/after span the check reported against saved text.
 * @outputs Problem — a descriptor ready for the problems-panel UI, indexed by the finding's current offsets.
 * @dataflow finding.kind and nodeType → label; finding.before/after → previewSpan into detail; finding.from/to → range.
 * @controlflow Branch on kind to pick the gap vs block label, then assemble the fixed detail template and copy the offsets.
 */
export function describeFinding(finding: FidelityFinding): Problem {
  // Check whether the finding is an inserted blank gap or a changed node.
  let label: string;
  if (finding.kind === 'gap') {
    // A gap means blank space was introduced between existing blocks.
    label = 'Blank space between blocks';
  } else {
    // A changed node keeps its own type in the label, e.g. 'paragraph block'.
    label = `${finding.nodeType} block`;
  }

  return {
    kind: 'fidelity',
    label,
    detail: `Changed on save though not edited: ${previewSpan(finding.before)} became ${previewSpan(finding.after)}`,
    from: finding.from,
    to: finding.to,
  };
}

/**
 * @purpose Builds the Fidelity Check controller that ties a DocumentSession's lifecycle to the tracker and save-time check.
 * @inputs options — FidelityControllerOptions gating the check via enabled() and receiving reports via onReport().
 * @outputs FidelityController — attach/saved/problems/destroy wired to the closure state.
 * @dataflow options.enabled/onReport → controller methods → FidelityTracker + session subscription → findings → describeFinding.
 * @controlflow Declare closure state (tracker, unsubscribe, findings, reportText) → return the four-method controller object.
 */
export function createFidelityController(options: FidelityControllerOptions): FidelityController {
  // The saved-text baseline and touched ranges for the attached document, rebuilt on every attach.
  let tracker: FidelityTracker | null = null;
  // The active session subscription, released exactly once per attach or destroy.
  let unsubscribe: (() => void) | null = null;
  // Findings from the last checked save, indexed against reportText.
  let findings: readonly FidelityFinding[] = [];
  // The exact text the current findings were computed against; withdrawn when the buffer diverges.
  let reportText: string | null = null;

  /**
   * @purpose Rebuilds the tracker from a session's saved text and subscribes to its changes, releasing any prior subscription first.
   * @inputs session — DocumentSession whose snapshot provides the merge base (savedText) and buffer (text).
   * @outputs void.
   * @dataflow session.snapshot → new FidelityTracker(savedText, text); subscribe listener records each change into the tracker.
   * @controlflow Unsubscribe prior if present → create tracker from saved text → clear findings/reportText → subscribe new listener.
   */
  function attach(session: DocumentSession): void {
    // Check whether a previous subscription exists that must be released before re-attaching.
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    } else {
      // No prior subscription to release, e.g. first attach or post-destroy.
    }

    const snapshot = session.snapshot;
    // Start from the saved text as the merge base so unsaved work on a remounted tab is judged against what was actually written.
    tracker = new FidelityTracker(snapshot.savedText, snapshot.text);
    findings = [];
    reportText = null;

    // The webview runs everything on a single thread and session.notify fires synchronously, so this listener never races other controller methods.
    unsubscribe = session.subscribe((change: SessionChange): void => {
      /**
       * @purpose Records each session change into the tracker, treating resets specially and ignoring focus-only moves.
       * @inputs change — SessionChange describing the new snapshot, its reason, and replaced ranges.
       * @outputs void.
       * @dataflow change.snapshot.text → tracker.rebase (reset) or tracker.record (edit/external/undo/redo); reset also clears findings/reportText.
       * @controlflow Early-return if no tracker; branch on reason: reset rebases and clears, focus is a no-op, else classify textEdit and record.
       */
      // Check whether the controller has an active tracker (attached and not destroyed).
      if (tracker === null) {
        return;
      } else {
        // Tracker present: proceed with change handling.
      }

      // Check whether the session was reset to a different document, e.g. reloaded from disk.
      if (change.reason === 'reset') {
        // A reset is an entirely new baseline: rebase onto it and forget prior findings.
        tracker.rebase(change.snapshot.text);
        findings = [];
        reportText = null;
      } else if (change.reason === 'focus') {
        // Focus moves with no text change, so there is nothing to record or re-check.
      } else {
        // A real text change: classify its origin before recording it with the tracker.
        const textEdit =
          // Source-pane typing, tool-applied text (find/replace, restore), undo and redo are the user's bytes;
          // only a WYSIWYG edit is serializer output the check must judge. Undo counts as the user's because it
          // can reach back past a save to text the user typed, which the tracker has already forgotten.
          change.reason === 'external' ||
          change.reason === 'undo' ||
          change.reason === 'redo' ||
          (change.reason === 'edit' && change.snapshot.focusedPane === 'source');

        tracker.record(change.snapshot.text, textEdit);
      }
    });
  }

  /**
   * @purpose Runs the fidelity check against saved text when enabled, reports findings, and rebases onto the new baseline.
   * @inputs text — the exact text written on save; findings are reported through options.onReport.
   * @outputs void.
   * @dataflow options.enabled() → tracker.check(text) → findings + onReport; then tracker.rebase(text) sets the new base.
   * @controlflow Early-return if no tracker; branch on enabled: check+report vs clear; always rebase after (check before rebase).
   */
  function saved(text: string): void {
    // Check whether a session is attached and the tracker can run a check.
    if (tracker === null) {
      return;
    } else {
      // Tracker present: proceed with the save-time fidelity check.
    }

    // Check whether the fidelity check is currently enabled by developer-mode settings.
    if (options.enabled()) {
      // Run the check against the saved text, remember what was checked, and report it.
      findings = tracker.check(text);
      reportText = text;
      options.onReport(findings);
    } else {
      // Disabled: show no fidelity problems and do not emit an (empty) report.
      findings = [];
      reportText = null;
    }

    // The saved text becomes the new merge base for subsequent edits, so rebase after checking (order matters).
    tracker.rebase(text);
  }

  /**
   * @purpose Returns described fidelity findings only while the buffer still matches what was last checked.
   * @inputs currentText — the document's current text, used to confirm offsets still point at the right bytes.
   * @outputs readonly Problem[] — described findings for the exact checked text, or [] when withdrawn.
   * @dataflow reportText vs currentText → findings.map(describeFinding) or [].
   * @controlflow If no check ran or the buffer diverged, return []; else map findings to problems.
   */
  function problems(currentText: string): readonly Problem[] {
    // Check whether a check has run and the buffer still matches what was checked.
    if (reportText === null || currentText !== reportText) {
      // No findings exist, or the document changed since the last check: withdraw rather than point at wrong bytes.
      return [];
    } else {
      // Findings are valid for this exact text: describe them for the UI.
    }

    return findings.map(describeFinding);
  }

  /**
   * @purpose Releases the session subscription and clears all closure state so the controller can be discarded.
   * @inputs void.
   * @outputs void.
   * @dataflow unsubscribe() → detaches from session; tracker/findings/reportText reset to empty/null.
   * @controlflow Unsubscribe if present (idempotent) → null tracker, clear findings and reportText.
   */
  function destroy(): void {
    // Check whether a subscription is still active before releasing it.
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    } else {
      // No active subscription to release, e.g. already destroyed or never attached.
    }

    tracker = null;
    findings = [];
    reportText = null;
  }

  return {
    attach,
    saved,
    problems,
    destroy,
  };
}