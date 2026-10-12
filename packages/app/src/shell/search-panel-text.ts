/**
 * @file search-panel-text.ts
 * @purpose Holds only the wording and stylesheet of the vault Search panel (FR-9.5), kept separate from its behaviour.
 * @inputs ReplaceReport and UndoReport type shapes; SEARCH_RESULTS_STYLES shared stylesheet fragment.
 * @outputs Human-readable summary strings for replace/undo operations and the SEARCH_PANEL_STYLES CSS string.
 * @functions
 *   - plural: Renders a count with the correct singular or plural noun form.
 *   - matchSummary: Summarizes how many matches were found across how many files.
 *   - failureText: Formats failed path/message records into one human-readable clause (internal helper).
 *   - replaceSummary: Builds the period-terminated summary sentence for a ReplaceReport.
 *   - undoSummary: Builds the period-terminated summary sentence for an UndoReport.
 * @dataflow Imported report types + SEARCH_RESULTS_STYLES → text-builder functions and style constant → search-panel behaviour caller.
 * @controlflow Module load interpolates SEARCH_PANEL_STYLES once; callers invoke the summary functions on demand to render status text.
 * @version 1
 * @date 2026-09-14
 */

import type { ReplaceReport, UndoReport } from './vault-search-controller.js';
import { SEARCH_RESULTS_STYLES } from './search-results-view.js';

/**
 * Renders a count with the correct singular or plural noun form.
 * @purpose Interpolates a quantity with either the singular or plural label depending on whether it equals one.
 * @inputs count - The quantity to describe. one - Singular label used when count is exactly 1. many - Plural label used otherwise.
 * @outputs A string of the form "N <label>", using the singular label at count 1 and the plural label everywhere else.
 * @dataflow count, one, many → branch on count === 1 → selected label → interpolated "N label" string.
 * @controlflow Selects the singular label when count equals 1; otherwise selects the plural label; returns the interpolation.
 */
export function plural(count: number, one: string, many: string): string {
  // Choose the singular label only when the count is exactly one; otherwise fall back to the plural label.
  let chosenLabel: string;
  if (count === 1) {
    // Count equals one: emit the singular form.
    chosenLabel = one;
  } else {
    // Count is zero or greater than one: emit the plural form.
    chosenLabel = many;
  }
  return `${count} ${chosenLabel}`;
}

/**
 * Summarizes how many matches were found across how many files.
 * @purpose Combines a match count and a file count into a single "N matches in M files" phrase.
 * @inputs matches - Total number of matches found. files - Number of distinct files containing matches.
 * @outputs A string such as "5 matches in 2 files", built by pluralizing both quantities independently.
 * @dataflow matches, files → two plural() calls → combined "N matches in M files" string.
 * @controlflow Calls plural() once per quantity and concatenates the results with a fixed " in " separator.
 */
export function matchSummary(matches: number, files: number): string {
  return `${plural(matches, 'match', 'matches')} in ${plural(files, 'file', 'files')}`;
}

/**
 * Formats a list of failed paths into a single human-readable failure clause.
 * @purpose Prefixes each "path: message" record with a pluralized file count for status reporting.
 * @inputs failures - Read-only list of { path, message } records describing each individual failure.
 * @outputs A string such as "2 files failed: /v/a.md: denied; /v/b.md: timeout".
 * @dataflow failures → per-record "path: message" mapping → joined with "; " → prefixed by the pluralized count clause.
 * @controlflow Maps each failure to its "path: message" text, joins them with "; ", and prepends the pluralized header.
 */
function failureText(failures: readonly { readonly path: string; readonly message: string }[]): string {
  const detail = failures.map((f) => `${f.path}: ${f.message}`).join('; ');
  return `${plural(failures.length, 'file', 'files')} failed: ${detail}`;
}

/**
 * Builds the human-readable summary of a replace operation report.
 * @purpose Assembles a period-terminated sentence describing what was replaced, skipped, and failed.
 * @inputs report - ReplaceReport containing replaced count, files touched, stale skips, and failures.
 * @outputs A sentence such as "Replaced 3 in 2 files; 2 skipped because the note changed; 1 file failed: /v/a.md: denied.".
 * @dataflow report fields → parts array (base clause + optional stale + optional failure clause) → joined with "; " and terminated.
 * @controlflow Emits the base replaced clause, appends a stale-note caveat when stale > 0, appends a failure clause when failures exist, then joins and terminates.
 */
export function replaceSummary(report: ReplaceReport): string {
  const parts: string[] = [`Replaced ${report.replaced} in ${plural(report.files, 'file', 'files')}`];

  // Append a stale-note caveat only when at least one note was skipped because it changed.
  if (report.stale > 0) {
    parts.push(`${report.stale} skipped because the note changed`);
  } else {
    // No stale notes: leave this clause out of the summary entirely.
  }

  // Append a failure clause only when at least one replacement failed.
  if (report.failures.length > 0) {
    parts.push(failureText(report.failures));
  } else {
    // No failures: no additional clause is needed for this case.
  }

  return `${parts.join('; ')}.`;
}

/**
 * Builds the human-readable summary of an undo operation report.
 * @purpose Assembles a period-terminated sentence describing what was restored, skipped, and failed.
 * @inputs report - UndoReport containing restored count, skipped notes, and failures.
 * @outputs A sentence such as "Restored 2 files; 3 left alone because it changed since.".
 * @dataflow report fields → parts array (base clause + optional skipped + optional failure clause) → joined with "; " and terminated.
 * @controlflow Emits the base restored clause, appends a skipped caveat when skipped > 0, appends a failure clause when failures exist, then joins and terminates.
 */
export function undoSummary(report: UndoReport): string {
  const parts: string[] = [`Restored ${plural(report.restored, 'file', 'files')}`];

  // Append a skipped caveat only when at least one note was left alone because it changed since.
  if (report.skipped > 0) {
    parts.push(`${plural(report.skipped, 'file', 'files')} left alone because it changed since`);
  } else {
    // No skipped notes: leave this clause out of the summary entirely.
  }

  // Append a failure clause only when at least one undo failed.
  if (report.failures.length > 0) {
    parts.push(failureText(report.failures));
  } else {
    // No failures: no additional clause is needed for this case.
  }

  return `${parts.join('; ')}.`;
}

/**
 * CSS stylesheet string for the vault Search panel (FR-9.5), layered on top of the shared results styles.
 * @purpose Exposes the search-panel presentation rules, reusing SEARCH_RESULTS_STYLES as their foundation.
 * @inputs SEARCH_RESULTS_STYLES - The shared result-view stylesheet fragment to embed verbatim at the top.
 * @outputs A single template-literal string containing the base styles followed by every search-panel rule.
 * @dataflow SEARCH_RESULTS_STYLES → interpolated first, then concatenated with each .kdoc-search-* rule in order.
 * @controlflow Interpolated once at module load; consumed as a static stylesheet string by the panel behaviour.
 */
export const SEARCH_PANEL_STYLES: string = `${SEARCH_RESULTS_STYLES}
.kdoc-search-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; box-sizing: border-box; background: var(--kdoc-color-background-elevated); color: var(--kdoc-color-text); }
.kdoc-search-panel[hidden] { display: none; }
.kdoc-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 12px 0 12px; }
.kdoc-search-input { flex: 1 1 6em; min-width: 0; padding: 4px 8px; border: 1px solid var(--kdoc-color-border); border-radius: 4px; background: transparent; color: var(--kdoc-color-text); font: inherit; font-size: 13px; box-sizing: border-box; outline: none; }
.kdoc-search-input:focus-visible { outline: 2px solid var(--kdoc-color-accent); outline-offset: -1px; }
.kdoc-search-input:disabled { opacity: 0.5; cursor: not-allowed; }
.kdoc-search-toggle { border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--kdoc-color-text-muted); font: inherit; font-size: 12px; padding: 2px 5px; cursor: pointer; }
.kdoc-search-toggle[aria-pressed="true"] { border-color: var(--kdoc-color-accent); color: var(--kdoc-color-text); background: var(--kdoc-color-background-subtle); }
.kdoc-search-action { border: 1px solid var(--kdoc-color-border); border-radius: 4px; background: transparent; color: var(--kdoc-color-text); font: inherit; font-size: 12px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.kdoc-search-action:disabled { opacity: 0.5; cursor: not-allowed; }
.kdoc-search-count { font-size: 11px; color: var(--kdoc-color-text-muted); padding: 4px 12px; min-height: 16px; box-sizing: border-box; }
.kdoc-search-count[data-state="error"] { color: var(--kdoc-color-text); }
.kdoc-search-body { flex: 1; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; display: flex; flex-direction: column; padding: 4px 0; }
.kdoc-search-empty { font-size: 13px; color: var(--kdoc-color-text-muted); padding: 8px 12px; font-style: italic; }
`;
