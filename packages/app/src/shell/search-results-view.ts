/**
 * @file search-results-view.ts
 * @purpose Renders vault search results grouped by file for a confirm-before-replace flow (FR-9.5).
 *   Each match gets a checkbox so the user confirms which matches a replace touches, and a small
 *   selection store holds those choices across renders of the same result set.
 * @inputs VaultSearchResult to render; ResultsViewOptions providing Document, ResultSelection, navigation,
 *   change notification, and an AbortSignal for listener teardown.
 * @outputs DOM group elements (one per file); a ResultSelection interface plus its factory; styles constant.
 * @functions
 *   - createResultSelection: Builds the match-selection store that starts with every match chosen.
 *   - renderResults: Builds one result group per file, in result order.
 *   - renderFileGroup: Builds a single file's confirm-all header plus one selectable row per match.
 *   - syncFileBox: Reflects per-match checkbox state into the file checkbox checked/indeterminate flags.
 * @dataflow VaultSearchResult -> renderResults -> renderFileGroup -> per-match DOM with checkboxes -> selection store + callbacks.
 * @controlflow For each file build header and rows, wire change/click listeners via signal, sync file checkbox, return group list.
 * @version 3
 * @date 2026-10-04
 */

import type { FileMatch, FileResult, VaultSearchResult } from '@k-doc/core';

/** Which matches are chosen for a replace. Every match starts chosen; the user unticks the ones to keep. */
export interface ResultSelection {
  isChosen(path: string, match: FileMatch): boolean;
  setChosen(path: string, match: FileMatch, chosen: boolean): void;
  /** Forgets every untick, for a fresh set of results. */
  reset(): void;
  /** The chosen matches of result, per path, leaving out files with none chosen. */
  chosen(result: VaultSearchResult): Map<string, { readonly start: number; readonly end: number }[]>;
  /** How many matches of result are chosen. */
  count(result: VaultSearchResult): number;
}

/**
 * Creates a selection store tracking which search matches the user has chosen for replace.
 *
 * @purpose Initializes per-match choice state that starts with every match chosen and lets the user untick to keep.
 * @inputs void
 * @outputs ResultSelection - Interface exposing isChosen, setChosen, reset, chosen, and count over a search result.
 * @dataflow unticked key set -> method closures bound to it -> external callers reading/writing selection state.
 * @controlflow Declare the unticked set; define the five methods bound to it; return them as a ResultSelection object.
 */
export function createResultSelection(): ResultSelection {
  // Unticked match keys, formatted as `${path} ${start}:${end}` so each (file, match) pair is unique.
  const unticked = new Set<string>();

  /**
   * Reports whether a match is currently chosen for replace.
   *
   * @purpose A match is chosen unless its key was unticked by the user.
   * @inputs path - Path of the file the match belongs to.
   * @inputs match - The FileMatch whose start:end identifies it uniquely.
   * @outputs boolean - True when the match should be replaced, false when the user kept it.
   * @dataflow path and match -> composite key lookup in unticked set -> negated membership.
   * @controlflow Build key from path and match bounds -> return whether the key is absent from unticked.
   */
  function isChosen(path: string, match: FileMatch): boolean {
    return !unticked.has(`${path} ${match.start}:${match.end}`);
  }

  /**
   * Records the user's choice for a single match.
   *
   * @purpose Toggling a match flips whether its key is remembered as unticked.
   * @inputs path - Path of the file the match belongs to.
   * @inputs match - The FileMatch whose start:end identifies it uniquely.
   * @inputs chosen - True when the user re-selects the match, false when they keep it.
   * @outputs void
   * @dataflow chosen flag -> delete or add composite key in unticked set.
   * @controlflow If chosen: delete the key so the match is replaced; else: add the key to skip it.
   */
  function setChosen(path: string, match: FileMatch, chosen: boolean): void {
    const key = `${path} ${match.start}:${match.end}`;
    // Check which way the choice went.
    if (chosen) {
      // Match re-chosen by the user: forget any prior untick so it participates in the replace.
      unticked.delete(key);
    } else {
      // Match unticked by the user: record it so the replace skips this match.
      unticked.add(key);
    }
  }

  /**
   * Clears every remembered untick for a fresh set of results.
   *
   * @purpose Resets all matches back to chosen after the user moves to new search results.
   * @inputs void
   * @outputs void
   * @dataflow unticked set -> emptied.
   * @controlflow Call Set.clear() so every match is chosen again.
   */
  function reset(): void {
    unticked.clear();
  }

  /**
   * Collects the chosen matches of a result, keyed by file path.
   *
   * @purpose Reduces each file's matches to the ranges the user confirmed for replacement.
   * @inputs result - The full vault search result to reduce.
   * @outputs Map<string, { start; end }[]> - Chosen match ranges per path, omitting files with none chosen.
   * @dataflow result.files -> per-file chosen filter -> {start,end} pairs -> map keyed by file.path.
   * @controlflow For each file: build picked ranges (if any) and set them in the map; skip empty files.
   */
  function chosen(result: VaultSearchResult): Map<string, { readonly start: number; readonly end: number }[]> {
    const map = new Map<string, { readonly start: number; readonly end: number }[]>();
    for (const file of result.files) {
      const picked = file.matches
        .filter((m) => isChosen(file.path, m))
        .map((m) => ({ start: m.start, end: m.end }));
      // Check whether any match of this file is chosen.
      if (picked.length > 0) {
        // At least one match chosen for this file: record the chosen ranges keyed by path.
        map.set(file.path, picked);
      } else {
        // No matches chosen for this file: leave it out of the map so files with no replacement are skipped.
      }
    }
    return map;
  }

  /**
   * Counts how many matches across a result are chosen for replace.
   *
   * @purpose Sums each file's chosen matches to report the total replacements pending.
   * @inputs result - The full vault search result to count.
   * @outputs number - Total number of chosen matches in the result.
   * @dataflow result.files -> per-file chosen filter length -> running sum.
   * @controlflow For each file: add its chosen match count to a running total and return it.
   */
  function count(result: VaultSearchResult): number {
    let total = 0;
    for (const file of result.files) {
      const chosenMatches = file.matches.filter((m) => isChosen(file.path, m));
      total += chosenMatches.length;
    }
    return total;
  }

  return { isChosen, setChosen, reset, chosen, count };
}

export interface ResultsViewOptions {
  readonly doc: Document;
  readonly selection: ResultSelection;
  /** Opens the note at the match. */
  readonly openMatch: (path: string, match: FileMatch) => void;
  /** Told whenever a checkbox changes, so the panel can update its Replace button. */
  readonly onSelectionChange: () => void;
  readonly signal: AbortSignal;
}

/**
 * Renders one result group per file in the order they appear in the result.
 *
 * @purpose Builds a DOM group for every matched file so the panel can mount them in place.
 * @inputs result - The full vault search result to render.
 * @inputs options - ResultsViewOptions providing DOM, selection callbacks, and teardown signal.
 * @outputs HTMLElement[] - One group element per file, in result order.
 * @dataflow result.files -> renderFileGroup per file -> array of group elements.
 * @controlflow For each file: build its group and append to the groups list; return the list.
 */
export function renderResults(result: VaultSearchResult, options: ResultsViewOptions): HTMLElement[] {
  const groups: HTMLElement[] = [];
  for (const file of result.files) {
    // Build this file's group and collect it so all groups preserve result order.
    groups.push(renderFileGroup(file, options));
  }
  return groups;
}

/**
 * Renders a single matched file as a checkbox-header group of selectable match rows.
 *
 * @purpose Draws the file's confirm-all checkbox plus one row per match, wiring selection and navigation.
 * @inputs file - The FileResult whose matches are drawn.
 * @inputs options - ResultsViewOptions providing DOM, selection callbacks, openMatch, and teardown signal.
 * @outputs HTMLElement - A .kdoc-search-file group element containing a header and a match list.
 * @dataflow file.matches -> per-match row DOM with checkboxes -> selection state -> change/click listeners.
 * @controlflow Build header (file checkbox) then one row per match; wire listeners; sync the file checkbox; return group.
 */
function renderFileGroup(file: FileResult, options: ResultsViewOptions): HTMLElement {
  const doc = options.doc;
  const signal = options.signal;

  // Group element for this file, tagged with its path for later lookup.
  const group = doc.createElement('div');
  group.className = 'kdoc-search-file';
  group.setAttribute('data-path', file.path);

  // Header row holding the per-file confirm checkbox and metadata.
  const header = doc.createElement('div');
  header.className = 'kdoc-search-file-header';

  // Per-file checkbox that selects or clears every match in this file at once.
  const fileBox = doc.createElement('input');
  fileBox.type = 'checkbox';
  fileBox.className = 'kdoc-search-file-check';
  fileBox.setAttribute('aria-label', `Replace in ${file.relative}`);

  // File name shown to the user, with the full path exposed as a hover tooltip.
  const name = doc.createElement('span');
  name.className = 'kdoc-search-file-name';
  name.textContent = file.relative;
  name.title = file.path;

  // Match count for this file, kept in sync with the source data.
  const count = doc.createElement('span');
  count.className = 'kdoc-search-file-count';
  count.textContent = String(file.matches.length);

  header.appendChild(fileBox);
  header.appendChild(name);
  header.appendChild(count);

  // Scrollable list of match rows for this file.
  const list = doc.createElement('div');
  list.className = 'kdoc-search-matches';

  // Per-match checkboxes, indexed in lockstep with file.matches for the select-all handler.
  const rowBoxes: HTMLInputElement[] = [];

  for (const match of file.matches) {
    // Row container for one match, tagged with its start offset for debugging and lookup.
    const row = doc.createElement('div');
    // Not 'kdoc-search-match': the editors already paint that class as a highlighted match, which would shade every row.
    row.className = 'kdoc-search-hit';
    row.setAttribute('data-start', String(match.start));

    // Per-match checkbox whose initial state mirrors the persisted selection.
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.className = 'kdoc-search-match-check';
    box.checked = options.selection.isChosen(file.path, match);
    box.setAttribute('aria-label', `Replace match on line ${match.line}`);

    // Line number gutter for the match.
    const line = doc.createElement('span');
    line.className = 'kdoc-search-match-line';
    line.textContent = String(match.line);

    // Clickable row opener showing surrounding snippet context and navigating to the match.
    const open = doc.createElement('button');
    open.type = 'button';
    open.className = 'kdoc-search-match-open';
    open.title = `${file.relative}:${match.line}:${match.column}`;

    // Text before the matched span in the snippet.
    const before = doc.createElement('span');
    before.className = 'kdoc-search-match-before';
    before.textContent = match.snippet.before;

    // The matched text itself, highlighted.
    const hit = doc.createElement('mark');
    hit.className = 'kdoc-search-match-text';
    hit.textContent = match.snippet.match;

    // Text after the matched span in the snippet.
    const after = doc.createElement('span');
    after.className = 'kdoc-search-match-after';
    after.textContent = match.snippet.after;

    open.appendChild(before);
    open.appendChild(hit);
    open.appendChild(after);

    row.appendChild(box);
    row.appendChild(line);
    row.appendChild(open);

    // Per-match checkbox toggled by the user: update selection, resync the file checkbox, and notify.
    box.addEventListener(
      'change',
      (): void => {
        options.selection.setChosen(file.path, match, box.checked);
        syncFileBox();
        options.onSelectionChange();
      },
      { signal },
    );

    // Row click navigates to the match in its note.
    open.addEventListener(
      'click',
      (): void => {
        options.openMatch(file.path, match);
      },
      { signal },
    );

    rowBoxes.push(box);
    list.appendChild(row);
  }

  /**
   * Reflects the per-match checkboxes into the file checkbox's checked and indeterminate states.
   *
   * @purpose Keeps the confirm-all checkbox in sync: all ticked, none ticked, or a partial mix.
   * @inputs void
   * @outputs void
   * @dataflow rowBoxes -> chosen count -> fileBox.checked and fileBox.indeterminate.
   * @controlflow Count checked rows; set checked when all are checked; set indeterminate for a partial selection.
   */
  function syncFileBox(): void {
    // Number of match rows currently ticked.
    const chosenCount = rowBoxes.filter((b) => b.checked).length;

    // All ticked shows ticked, none shows unticked, and a mix shows the indeterminate dash.
    fileBox.checked = chosenCount === rowBoxes.length;
    fileBox.indeterminate = chosenCount > 0 && chosenCount < rowBoxes.length;
  }

  // File checkbox toggled by the user: broadcast the choice to every match row and notify listeners.
  fileBox.addEventListener(
    'change',
    (): void => {
      for (let i = 0; i < file.matches.length; i++) {
        const match = file.matches[i];
        const box = rowBoxes[i];

        // Guard against undefined under strict noUncheckedIndexedAccess.
        if (match !== undefined && box !== undefined) {
          // Both entries present: mirror the file checkbox onto the row and record the choice.
          box.checked = fileBox.checked;
          options.selection.setChosen(file.path, match, fileBox.checked);
        } else {
          // Index out of range between matches and rows: skip to avoid operating on undefined values.
        }
      }

      // A deliberate user toggle resolves any partial state into a definite checked/unchecked value.
      fileBox.indeterminate = false;
      options.onSelectionChange();
    },
    { signal },
  );

  syncFileBox();

  group.appendChild(header);
  group.appendChild(list);

  return group;
}

/**
 * Static stylesheet for the search results view, defining per-file groups with a confirm-all checkbox,
 * match rows with line gutters and snippet previews, highlighted matches, and K-Doc design tokens only.
 */
export const SEARCH_RESULTS_STYLES: string = `
.kdoc-search-file {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  padding: 8px 6px;
  box-sizing: border-box;
}

.kdoc-search-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-md);
}

.kdoc-search-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-search-file-count {
  font-weight: 400;
  font-size: 11px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-search-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 20px;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 2px;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-search-hit:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-search-match-line {
  font-size: 11px;
  font-family: monospace;
  color: var(--kdoc-chrome-text-muted);
  min-width: 2.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kdoc-search-match-open {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 2px 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kdoc-search-match-open:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-search-match-text {
  background: transparent;
  color: var(--kdoc-chrome-accent);
  font-weight: 600;
  border-radius: var(--kdoc-radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-search-file * {
    transition: none !important;
  }
}
`;
