/**
 * @file file-tree-selection.ts
 * @purpose Maintains multi-select state for the vault file tree (FR-6.11), computing new selection states from user interactions such as clicks, focus movement, and row pruning.
 * @inputs SelectionState plus the ordered list of visible rows; user interaction parameters (row identifier, click mode, focus delta, extend flag).
 * @outputs New SelectionState instances produced by each pure transformation function.
 * @functions
 *   - clickRow: Applies a single click under a given ClickMode and returns the resulting selection state.
 *   - moveFocus: Moves the focus row by a delta within the visible rows, optionally extending the selection.
 *   - focusRow: Sets the focus to a specific row when it is visible, otherwise returns state unchanged.
 *   - pruneSelection: Removes selected/anchor/focus entries that are no longer present in the visible rows.
 *   - selectionInOrder: Returns the currently selected rows filtered to and ordered by the visible rows.
 * @dataflow User interaction (row, mode, delta) → transformation function → new SelectionState.
 * @controlflow Each function is pure: it reads immutable inputs and returns a fresh state object without mutating or touching the DOM.
 * @version 1
 * @date 2026-09-14
 */

export interface SelectionState {
  readonly selected: ReadonlySet<string>;
  readonly anchor: string | null;
  readonly focus: string | null;
}

export type ClickMode = 'replace' | 'toggle' | 'range';

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set<string>(),
  anchor: null,
  focus: null,
};

/**
 * @purpose Applies a single click on a row under the given ClickMode and returns the resulting selection state.
 * @inputs state - Current selection state; rows - Visible rows in display order; row - The clicked row identifier; mode - How the click should modify the selection.
 * @outputs New SelectionState reflecting the applied click.
 * @dataflow (state, row, mode) → branch on mode → build new selected set with updated anchor/focus → return state.
 * @controlflow Switches on mode: replace resets to a single-row selection; toggle adds or removes the row; range selects the span between the stored anchor and the clicked row.
 */
export function clickRow(
  state: SelectionState,
  rows: readonly string[],
  row: string,
  mode: ClickMode,
): SelectionState {
  // 'replace' discards the prior selection and isolates the clicked row as both anchor and focus.
  if (mode === 'replace') {
    return { selected: new Set([row]), anchor: row, focus: row };
  } else if (mode === 'toggle') {
    // 'toggle' keeps the existing selection but adds or removes the clicked row depending on membership.
    const next = new Set(state.selected);

    if (next.has(row)) {
      // Row is currently selected: remove it from the set.
      next.delete(row);
    } else {
      // Row is not selected: add it to the set.
      next.add(row);
    }

    return { selected: next, anchor: row, focus: row };
  } else {
    // 'range' selects every row between the stored anchor (or the clicked row if no anchor exists) and the clicked row.
    // The anchor defaults to the clicked row when none is recorded so a range can start from nothing.
    const anchor = state.anchor ?? row;
    const from = rows.indexOf(anchor);
    const to = rows.indexOf(row);

    // If either endpoint is absent from the visible rows, fall back to isolating the clicked row.
    if (from < 0 || to < 0) {
      return { selected: new Set([row]), anchor: row, focus: row };
    } else {
      // Both endpoints exist: build a contiguous selection between the lower and upper indices.
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      return {
        selected: new Set(rows.slice(low, high + 1)),
        anchor,
        focus: row,
      };
    }
  }
}

/**
 * @purpose Moves the focus row by a delta within the visible rows and returns the resulting selection state.
 * @inputs state - Current selection state; rows - Visible rows in display order; delta - Signed step count to move the focus; extend - Whether the movement should extend the current selection (range) or replace it.
 * @outputs New SelectionState with an updated focus row.
 * @dataflow (state, delta) → compute target index → resolve target row → clickRow under range/replace mode → return state.
 * @controlflow Returns early on empty rows; computes the next index clamped to bounds or wrapping when no focus exists; delegates the actual selection update to clickRow.
 */
export function moveFocus(
  state: SelectionState,
  rows: readonly string[],
  delta: number,
  extend: boolean,
): SelectionState {
  // An empty tree needs no guard of its own: no row resolves, and the undefined check below returns the state.

  // Locate the current focus; treat a null focus as index -1 so it resolves to a boundary rather than a real row.
  const current = state.focus === null ? -1 : rows.indexOf(state.focus);

  // Determine the next index: when there is no active focus, jump to the nearest boundary by direction; otherwise step and clamp within bounds.
  let next: number;
  if (current < 0) {
    // No current focus exists: move to the first row on a positive delta or the last row on a negative delta.
    next = delta > 0 ? 0 : rows.length - 1;
  } else {
    // A current focus exists: step by delta and clamp to the valid index range.
    next = Math.min(rows.length - 1, Math.max(0, current + delta));
  }

  const target = rows[next];

  // With noUncheckedIndexedAccess `target` is string | undefined; guard against an out-of-range resolve.
  if (target === undefined) {
    // The resolved index was invalid: return the state unchanged.
    return state;
  } else {
    // The target row exists: apply a range click when extending, otherwise replace.
    return clickRow(state, rows, target, extend ? 'range' : 'replace');
  }
}

/**
 * @purpose Sets the focus to a specific row when it is visible, otherwise returns the state unchanged.
 * @inputs state - Current selection state; rows - Visible rows in display order; row - The target row identifier.
 * @outputs New SelectionState with focus set to row, or the original state if row is not visible.
 * @dataflow (state, row) → check visibility → clickRow under replace mode when present → return state.
 * @controlflow Single conditional: delegate to clickRow when the row exists in rows, else short-circuit to the input state.
 */
export function focusRow(
  state: SelectionState,
  rows: readonly string[],
  row: string,
): SelectionState {
  // Only act when the target row is part of the visible set; otherwise leave the selection untouched.
  if (rows.includes(row)) {
    return clickRow(state, rows, row, 'replace');
  } else {
    // The row is not visible: return the original state without modification.
    return state;
  }
}

/**
 * @purpose Removes selected, anchor, and focus entries that are no longer present in the visible rows.
 * @inputs state - Current selection state; rows - Visible rows in display order.
 * @outputs New SelectionState containing only entries that remain visible.
 * @dataflow (state, rows) → build a visibility set → filter selected/anchor/focus against it → return pruned state.
 * @controlflow Computes the visible set once, then filters each field independently; no branching beyond membership tests.
 */
export function pruneSelection(
  state: SelectionState,
  rows: readonly string[],
): SelectionState {
  // Build a lookup of currently visible rows for O(1) membership checks.
  const visible = new Set(rows);

  // Keep only selected rows that are still visible; anchor and focus are validated below.
  const selected = new Set([...state.selected].filter((row) => visible.has(row)));

  // Retain the anchor only when it is present in the visible set, otherwise drop it.
  const anchor = state.anchor !== null && visible.has(state.anchor) ? state.anchor : null;

  // Retain the focus only when it is present in the visible set, otherwise drop it.
  const focus = state.focus !== null && visible.has(state.focus) ? state.focus : null;

  return { selected, anchor, focus };
}

/**
 * @purpose Returns the currently selected rows filtered to and ordered by their position in the visible rows.
 * @inputs state - Current selection state; rows - Visible rows in display order.
 * @outputs Array of selected row identifiers in display order.
 * @dataflow (state, rows) → filter rows by membership in the selected set → return ordered array.
 * @controlflow Single pass over rows preserving display order; no branching beyond membership tests.
 */
export function selectionInOrder(
  state: SelectionState,
  rows: readonly string[],
): readonly string[] {
  // Preserve visible-row display order while keeping only rows that are currently selected.
  return rows.filter((row) => state.selected.has(row));
}
