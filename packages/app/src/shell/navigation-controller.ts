/**
 * @file navigation-controller.ts
 * @purpose Implements editor-shell navigation for FR-9.6 Go To, FR-9.7 Quick Open, and FR-9.9 breadcrumbs.
 * @inputs DocumentSession snapshot, window handle, picker dialogs, breadcrumb bar, and shell dependency callbacks.
 * @outputs NavigationController (openQuickOpen/openGoTo/scheduleBreadcrumbs/refreshBreadcrumbs/destroy) plus pure item builders.
 * @functions
 *   - samePath: Normalise-and-compare two note paths for Windows/Mac case-insensitive equality.
 *   - baseName: Extract the trailing filename segment from a path string.
 *   - quickOpenItems: Build the Quick Open picker list from notes, recents, and open tabs.
 *   - headingItems: Map outline entries to heading picker items keyed by entry index.
 *   - createNavigationController: Wire shell dependencies into the navigation behaviour.
 * @dataflow Shell callbacks → item builders → PickerDialog prompts → reveal/offset side effects.
 * @controlflow Create controller → invoke action on request → guard destroyed state → prompt or reveal; breadcrumbs coalesced per frame.
 * @version 1
 * @date 2026-09-13
 */

import { buildOutline, headingPath } from '@k-doc/core';
import type { DocumentSession, OutlineEntry } from '@k-doc/core';
import type { PickerItem } from './fuzzy-score.js';
import type { PickerDialog } from './picker-dialog.js';
import type { BreadcrumbBar } from './breadcrumb-bar.js';
import { parseLineTarget, lineTargetOffset } from './go-to-line.js';

export interface QuickOpenNote {
  readonly path: string;
  readonly relative: string;
  readonly title: string;
}

export interface NavigationControllerOptions {
  /** The active document's session; read on every use because each mounted document gets a new one. */
  readonly session: () => DocumentSession;
  readonly win: Window;
  readonly quickOpen: PickerDialog;
  readonly goTo: PickerDialog;
  readonly breadcrumbs: BreadcrumbBar;
  /** Every indexed vault note; empty when no vault is open. */
  readonly notes: () => readonly QuickOpenNote[];
  /** Recently opened paths, newest first. */
  readonly recentPaths: () => readonly string[];
  /** Paths of the documents open in tabs, in tab order; untitled tabs are left out. */
  readonly openPaths: () => readonly string[];
  /** The active document's path, or null when it is untitled. */
  readonly currentPath: () => string | null;
  /** Opens a path, or switches to its tab when it is already open. */
  readonly openPath: (path: string) => void;
  /** True when Go To should ask for a line: the Source pane is the one being edited. */
  readonly sourceFocused: () => boolean;
  /** Asks for a line number; resolves null when cancelled. */
  readonly askLine: (lineCount: number) => Promise<string | null>;
  /** The focused pane's caret as a source offset. */
  readonly caretOffset: () => number;
  /** Moves the caret to a source offset in the Source pane and scrolls it into view. */
  readonly revealSourceOffset: (offset: number) => void;
  /** Moves the caret to a source offset in whichever pane is being edited. */
  readonly revealOffset: (offset: number) => void;
  readonly showMessage: (message: string) => void;
}

export interface NavigationController {
  openQuickOpen(): void;
  openGoTo(): Promise<void>;
  /** Coalesces breadcrumb refreshes into one per animation frame. */
  scheduleBreadcrumbs(): void;
  refreshBreadcrumbs(): void;
  destroy(): void;
}

/**
 * @purpose Compare two note paths for equality, tolerating Windows separators and case.
 * @inputs a - First path string to compare.
 *           b - Second path string to compare.
 * @outputs boolean - True when both paths normalise to the same value.
 * @dataflow Each raw path → separator-normalised lowercase form → strict equality comparison.
 * @controlflow Normalise both inputs identically, then return a single equality result.
 */
export function samePath(a: string, b: string): boolean {
  // Normalise backslashes to forward slashes and force lower case for case-insensitive matching.
  const normalisedA = a.replace(/\\/g, '/').toLowerCase();
  // Apply the identical normalisation to the second path so both sides are comparable.
  const normalisedB = b.replace(/\\/g, '/').toLowerCase();
  // Return whether the two normalised forms are exactly equal.
  return normalisedA === normalisedB;
}

/**
 * @purpose Extract the trailing filename segment from a path string.
 * @inputs path - A possibly slash- or backslash-separated path.
 * @outputs string - Text after the last separator, or the whole string when none exists.
 * @dataflow Raw path → lastIndexOf of each separator → slice past the greatest match.
 * @controlflow Take the later of the two separator positions (or -1), then slice from one past it.
 */
function baseName(path: string): string {
  // Find the last forward slash and the last backslash independently.
  const lastSlash = path.lastIndexOf('/');
  const lastBackslash = path.lastIndexOf('\\');
  // Choose whichever separator appears later in the string (-1 when neither is present).
  const lastSeparator = Math.max(lastSlash, lastBackslash);
  // A separator was found: return everything after it, otherwise return the whole string.
  return lastSeparator >= 0 ? path.slice(lastSeparator + 1) : path;
}

/**
 * @purpose Build the Quick Open picker list from vault notes, recents, and open tabs.
 * @inputs notes - Every indexed vault note.
 *           recentPaths - Recently opened paths, newest first.
 *           openPaths - Paths of documents open in tabs, in tab order.
 *           currentPath - The active document's path, or null when untitled.
 * @outputs readonly PickerItem[] - Frozen picker items with no duplicates and excluding the active note.
 * @dataflow Candidate paths → normalised keys deduplicated → mapped to label/detail PickerItems.
 * @controlflow Index notes by key, walk open→recent→notes skipping seen/current, then freeze results.
 */
export function quickOpenItems(
  notes: readonly QuickOpenNote[],
  recentPaths: readonly string[],
  openPaths: readonly string[],
  currentPath: string | null
): readonly PickerItem[] {
  // Local normaliser mirroring samePath so keys and comparisons stay consistent.
  const normalise = (value: string): string => value.replace(/\\/g, '/').toLowerCase();
  // Index every vault note by its normalised path for O(1) lookup while walking candidates.
  const byKey = new Map<string, QuickOpenNote>();
  for (const note of notes) {
    // Store each note keyed by the same normalisation used elsewhere for equality checks.
    byKey.set(normalise(note.path), note);
  }
  // Track which candidate paths have already produced an item to avoid duplicates.
  const seen = new Set<string>();
  // Accumulate the resulting picker items in walk order.
  const items: PickerItem[] = [];
  // Map a kept path to its PickerItem, preferring vault-note metadata when present.
  const toItem = (path: string): PickerItem => {
    // Look up a vault note by this path's normalised key.
    const note = byKey.get(normalise(path));
    // Prefer the note's title/relative detail; otherwise fall back to filename and full path.
    return note !== undefined
      ? { id: path, label: note.title, detail: note.relative }
      : { id: path, label: baseName(path), detail: path };
  };
  // Walk a list of path strings, skipping seen/current entries and appending the rest.
  const walkPaths = (paths: readonly string[]): void => {
    for (const path of paths) {
      // Skip paths already emitted or that match the currently active document.
      if (seen.has(normalise(path)) || (currentPath !== null && samePath(path, currentPath))) {
        continue;
      }
      // Record this path as seen before appending its item.
      seen.add(normalise(path));
      items.push(toItem(path));
    }
  };
  // Open tabs first so they surface at the top of the list.
  walkPaths(openPaths);
  // Recently opened paths next, preserving recency order.
  walkPaths(recentPaths);
  // Vault notes last so unopened notes still appear in the list.
  walkPaths(notes.map((note: QuickOpenNote): string => note.path));
  // Return the assembled list as an immutable array to callers.
  return Object.freeze(items);
}

/**
 * @purpose Map outline entries to Go To / breadcrumb-less heading picker items.
 * @inputs entries - The document's ordered outline entries.
 * @outputs readonly PickerItem[] - Frozen items keyed by entry index with heading-level detail.
 * @dataflow Each OutlineEntry → stringified index, text-or-fallback label, and H{depth} detail.
 * @controlflow Map every entry in order, then freeze the resulting array for immutability.
 */
export function headingItems(entries: readonly OutlineEntry[]): readonly PickerItem[] {
  // Map each outline entry to a picker item keyed by its array index.
  const items = entries.map((entry) => ({
    // Use the entry's array position as the stable lookup id for later reversal.
    id: String(entry.index),
    // Show the heading text, or a fallback label when the entry has no text.
    label: entry.text.length > 0 ? entry.text : 'Untitled heading',
    // Encode the heading level (e.g. H2) as the secondary detail.
    detail: `H${entry.depth}`,
  }));
  // Return the mapped list as an immutable array to callers.
  return Object.freeze(items);
}

/**
 * @purpose Wire shell dependencies into the FR-9.6/9.7/9.9 navigation behaviour.
 * @inputs options - Session, window, picker dialogs, breadcrumb bar, and dependency callbacks.
 * @outputs NavigationController - openQuickOpen/openGoTo/scheduleBreadcrumbs/refreshBreadcrumbs/destroy.
 * @dataflow Shell callbacks feed cached outline + picker prompts; prompts drive reveal/offset side effects.
 * @controlflow Build closure state, define guarded actions, return the controller surface.
 */
export function createNavigationController(
  options: NavigationControllerOptions
): NavigationController {
  // Track the pending breadcrumb animation frame so refreshes coalesce to one per frame.
  let pendingFrame: number | null = null;
  // Flag that disables every action once the controller is torn down.
  let destroyed = false;
  // Cache the document used to build the outline for identity-based invalidation.
  let outlineDocument: unknown = null;
  // Cache the built outline entries, rebuilt only when the document identity changes.
  let outlineEntries: readonly OutlineEntry[] = [];

  // Build (or reuse) the cached outline, rebuilding when the snapshot document changes.
  const currentOutline = (): readonly OutlineEntry[] => {
    // Read the live snapshot document from the session.
    const document = options.session().snapshot.document;
    // The document is immutable per snapshot, so identity tells us whether it changed.
    if (document !== outlineDocument) {
      // Rebuild the outline and cache both the source document and its entries.
      outlineEntries = buildOutline(document);
      outlineDocument = document;
    }
    // Return the cached entries, rebuilt above when necessary.
    return outlineEntries;
  };

  // Open the Quick Open picker over notes, recents, and open tabs.
  const openQuickOpen = (): void => {
    // No-op once the controller has been destroyed.
    if (destroyed) {
      return;
    }
    // Build the candidate list from all shell-provided path sources.
    const items = quickOpenItems(
      options.notes(),
      options.recentPaths(),
      options.openPaths(),
      options.currentPath()
    );
    // With no candidates, explain how to populate the list instead of opening an empty picker.
    if (items.length === 0) {
      options.showMessage(
        'There are no files to open yet. Open a folder as a vault, or open a file once, and it will be listed here.'
      );
      return;
    }
    // Present the items and open whichever one the user picks.
    options.quickOpen.open(items, (item) => {
      options.openPath(item.id);
    });
  };

  // Open the Go To picker, line-based in Source or heading-based in K-Doc.
  const openGoTo = async (): Promise<void> => {
    // No-op once the controller has been destroyed.
    if (destroyed) {
      return;
    }
    // The Source pane edits raw text, so Go To resolves a line target there.
    if (options.sourceFocused()) {
      // Read the source text and count its lines for validation bounds.
      const text = options.session().snapshot.text;
      const lineCount = text.split('\n').length;
      // Ask the user for a line target, resolving null when they cancel.
      const answer = await options.askLine(lineCount);
      // A cancelled prompt aborts without moving anything.
      if (answer === null) {
        return;
      }
      // Parse the user's text into a concrete line/column target.
      const target = parseLineTarget(answer, lineCount);
      // An unparseable answer shows usage guidance and aborts.
      if (target === null) {
        options.showMessage(`"${answer}" is not a line number. Type a line, or line:column.`);
        return;
      }
      // Reveal the computed source offset for the parsed target.
      options.revealSourceOffset(lineTargetOffset(text, target));
      return;
    }
    // K-Doc editing navigates by heading instead of raw lines.
    const entries = currentOutline();
    // With no headings, explain that there is nothing to go to.
    if (entries.length === 0) {
      options.showMessage('This document has no headings to go to.');
      return;
    }
    // Present the heading items and reveal the chosen heading's start offset.
    options.goTo.open(headingItems(entries), (item) => {
      // Reverse the picker id back into its numeric entry index.
      const entry = entries[Number.parseInt(item.id, 10)];
      // Only reveal when the index resolves to a real entry.
      if (entry !== undefined) {
        options.revealOffset(entry.start);
      }
    });
  };

  // Refresh breadcrumbs from the current outline and caret position.
  const refreshBreadcrumbs = (): void => {
    // No-op once the controller has been destroyed.
    if (destroyed) {
      return;
    }
    // Update the bar with the heading path under the current caret offset.
    options.breadcrumbs.update(headingPath(currentOutline(), options.caretOffset()));
  };

  // Schedule a coalesced breadcrumb refresh on the next animation frame.
  const scheduleBreadcrumbs = (): void => {
    // No-op once destroyed, or when a refresh is already queued this frame.
    if (destroyed || pendingFrame !== null) {
      return;
    }
    // Queue a single refresh for the next frame, clearing the queue slot first.
    pendingFrame = options.win.requestAnimationFrame(() => {
      pendingFrame = null;
      refreshBreadcrumbs();
    });
  };

  // Tear down the controller and cancel any queued work.
  const destroy = (): void => {
    // No-op when already destroyed.
    if (destroyed) {
      return;
    }
    // Mark destroyed so all actions become no-ops from here on.
    destroyed = true;
    // Cancel the pending frame if one is queued, clearing the slot.
    if (pendingFrame !== null) {
      options.win.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  };

  // Expose the navigation surface to the editor shell.
  return { openQuickOpen, openGoTo, scheduleBreadcrumbs, refreshBreadcrumbs, destroy };
}