/**
 * @file file-tree-state.spec.ts
 * @purpose Verifies the pure selection state machine (FR-6.11) and its keyboard command mapping by asserting exact outputs of clickRow, moveFocus, focusRow, pruneSelection, selectionInOrder, and treeKeyCommand against fixed inputs.
 * @inputs The exported pure functions from file-tree-selection.ts and file-tree-keys.ts; the fixed visible-row set ROWS = ['a','b','c','d'].
 * @outputs Boolean pass/fail from vitest expect assertions on resulting SelectionState values and resolved TreeKeyCommand shapes.
 * @functions
 *   - view: Projects a SelectionState into a plain object with a sorted selected array for stable equality checks.
 *   - key: Builds a full TreeKey from a partial override, defaulting all modifier flags to false.
 * @dataflow Source pure function → test helper (view/key) → vitest expect assertion.
 * @controlflow Two describe blocks run sequentially; each it() executes one scenario and asserts an exact expected value with no tolerance for drift.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect } from 'vitest';
import { clickRow, EMPTY_SELECTION, focusRow, moveFocus, pruneSelection, selectionInOrder, type SelectionState } from '../src/shell/file-tree-selection.js';
import { treeKeyCommand, type TreeKey } from '../src/shell/file-tree-keys.js';

// Visible rows in display order shared by every selection scenario below.
const ROWS = ['a', 'b', 'c', 'd'];

/**
 * @purpose Projects a SelectionState into a plain object whose selected array is sorted for stable toEqual comparisons.
 * @inputs state - The SelectionState under test.
 * @outputs A plain object with sorted selected rows plus the raw anchor and focus values.
 * @dataflow state.selected → spread + sort → string[]; anchor/focus copied verbatim.
 * @controlflow No branching: single return building a fresh projection object.
 */
function view(state: SelectionState): { selected: string[]; anchor: string | null; focus: string | null } {
  // Sort the selected rows so Set iteration order never affects equality assertions.
  return { selected: [...state.selected].sort(), anchor: state.anchor, focus: state.focus };
}

/**
 * @purpose Assembles a complete TreeKey from a partial override, defaulting every modifier flag to false.
 * @inputs partial - A TreeKey with only the fields under test supplied; key is mandatory.
 * @outputs A fully-populated TreeKey ready for treeKeyCommand.
 * @dataflow Partial<TreeKey> → spread over defaults → complete TreeKey.
 * @controlflow No branching: single return merging defaults with overrides (overrides win).
 */
function key(partial: Partial<TreeKey> & { key: string }): TreeKey {
  // Defaults all four modifier flags to false so only the explicitly supplied ones change.
  return { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...partial };
}

describe('tree selection', () => {
  it('a plain click selects only that row', () => {
    // 'replace' discards the prior selection and isolates the clicked row.
    expect(view(clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace'))).toEqual({ selected: ['b'], anchor: 'b', focus: 'b' });
  });

  it('a toggle adds and removes a row', () => {
    // Start with 'b', add 'd', then remove 'b' leaving only 'd'.
    let s = clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace');
    s = clickRow(s, ROWS, 'd', 'toggle');
    expect(view(s)).toEqual({ selected: ['b', 'd'], anchor: 'd', focus: 'd' });
    s = clickRow(s, ROWS, 'b', 'toggle');
    expect(view(s).selected).toEqual(['d']);
  });

  it('a range runs from the anchor in either direction', () => {
    // Anchor at 'b'; a positive-range to 'd' then a negative-range back to 'a'.
    let s = clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace');
    s = clickRow(s, ROWS, 'd', 'range');
    expect(view(s)).toEqual({ selected: ['b', 'c', 'd'], anchor: 'b', focus: 'd' });
    s = clickRow(s, ROWS, 'a', 'range');
    expect(view(s)).toEqual({ selected: ['a', 'b'], anchor: 'b', focus: 'a' });
  });

  it('a range with no anchor selects just the row', () => {
    // With no stored anchor the range collapses to the clicked row itself.
    expect(view(clickRow(EMPTY_SELECTION, ROWS, 'c', 'range'))).toEqual({ selected: ['c'], anchor: 'c', focus: 'c' });
  });

  it('a range from an anchor no longer shown starts again at the row', () => {
    // The stored anchor 'x' is not visible, so the range restarts at the clicked row.
    const hidden: SelectionState = { selected: new Set(['x']), anchor: 'x', focus: 'x' };
    expect(view(clickRow(hidden, ROWS, 'b', 'range'))).toEqual({ selected: ['b'], anchor: 'b', focus: 'b' });
  });

  it('moving focus stops at the ends', () => {
    // Focus clamps to the first row stepping up and the last row stepping down.
    const first = clickRow(EMPTY_SELECTION, ROWS, 'a', 'replace');
    expect(view(moveFocus(first, ROWS, -1, false)).focus).toBe('a');
    const last = clickRow(EMPTY_SELECTION, ROWS, 'd', 'replace');
    expect(view(moveFocus(last, ROWS, 1, false)).focus).toBe('d');
  });

  it('moving with nothing focused starts at the first or last row', () => {
    // A null focus jumps to a boundary by direction rather than stepping from a real row.
    expect(view(moveFocus(EMPTY_SELECTION, ROWS, 1, false)).focus).toBe('a');
    expect(view(moveFocus(EMPTY_SELECTION, ROWS, -1, false)).focus).toBe('d');
  });

  it('moving with shift extends from the anchor', () => {
    // Shift movement applies a range click anchored at the original selection.
    const s = clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace');
    expect(view(moveFocus(s, ROWS, 1, true))).toEqual({ selected: ['b', 'c'], anchor: 'b', focus: 'c' });
  });

  it('moving in an empty tree changes nothing', () => {
    // An empty row list is a no-op that returns the identical state reference.
    const s = clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace');
    expect(moveFocus(s, [], 1, false)).toBe(s);
  });

  it('focusing a row that is not shown changes nothing', () => {
    // An invisible target returns the same state reference; a visible one replaces selection.
    const s = clickRow(EMPTY_SELECTION, ROWS, 'b', 'replace');
    expect(focusRow(s, ROWS, 'zz')).toBe(s);
    expect(view(focusRow(s, ROWS, 'c')).selected).toEqual(['c']);
  });

  it('pruning drops rows no longer shown', () => {
    // The hidden anchor 'x' is dropped while the visible selected 'a' and focus 'a' survive.
    const s: SelectionState = { selected: new Set(['a', 'x']), anchor: 'x', focus: 'a' };
    expect(view(pruneSelection(s, ROWS))).toEqual({ selected: ['a'], anchor: null, focus: 'a' });
  });

  it('lists the selection in display order', () => {
    // selectionInOrder reorders by visible-row position regardless of Set insertion order.
    const s: SelectionState = { selected: new Set(['d', 'a']), anchor: null, focus: null };
    expect(selectionInOrder(s, ROWS)).toEqual(['a', 'd']);
  });
});

describe('tree keys', () => {
  it('arrows move, and shift extends', () => {
    // ArrowUp/Down resolve to a move command; Shift sets the extend flag.
    expect(treeKeyCommand(key({ key: 'ArrowDown' }))).toEqual({ type: 'move', delta: 1, extend: false });
    expect(treeKeyCommand(key({ key: 'ArrowDown', shiftKey: true }))).toEqual({ type: 'move', delta: 1, extend: true });
    expect(treeKeyCommand(key({ key: 'ArrowUp' }))).toEqual({ type: 'move', delta: -1, extend: false });
  });

  it('Home and End jump, but not with Ctrl', () => {
    // Plain Home/End jump to the boundaries; Ctrl-Home is reserved for another action.
    expect(treeKeyCommand(key({ key: 'Home' }))).toEqual({ type: 'first' });
    expect(treeKeyCommand(key({ key: 'End' }))).toEqual({ type: 'last' });
    expect(treeKeyCommand(key({ key: 'Home', ctrlKey: true }))).toBeNull();
  });

  it('right expands and left collapses, but not with shift', () => {
    // ArrowRight/Left toggle node state; Shift-Arrow is reserved for selection movement.
    expect(treeKeyCommand(key({ key: 'ArrowRight' }))).toEqual({ type: 'expand' });
    expect(treeKeyCommand(key({ key: 'ArrowLeft' }))).toEqual({ type: 'collapse' });
    expect(treeKeyCommand(key({ key: 'ArrowRight', shiftKey: true }))).toBeNull();
  });

  it('Enter opens, F2 renames and Delete trashes', () => {
    // These keys dispatch their actions; Shift-Delete is reserved for another action.
    expect(treeKeyCommand(key({ key: 'Enter' }))).toEqual({ type: 'open' });
    expect(treeKeyCommand(key({ key: 'F2' }))).toEqual({ type: 'rename' });
    expect(treeKeyCommand(key({ key: 'Delete' }))).toEqual({ type: 'trash' });
    expect(treeKeyCommand(key({ key: 'Delete', shiftKey: true }))).toBeNull();
  });

  it('Ctrl or Cmd with A selects all', () => {
    // Ctrl-A and Meta-A select all; Shift is excluded and a bare 'a' does nothing.
    expect(treeKeyCommand(key({ key: 'a', ctrlKey: true }))).toEqual({ type: 'selectAll' });
    expect(treeKeyCommand(key({ key: 'A', metaKey: true }))).toEqual({ type: 'selectAll' });
    expect(treeKeyCommand(key({ key: 'a', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(treeKeyCommand(key({ key: 'a' }))).toBeNull();
  });

  it('leaves Alt combinations and other keys alone', () => {
    // Alt is owned by window chrome; an unmatched letter key falls through to null.
    expect(treeKeyCommand(key({ key: 'ArrowDown', altKey: true }))).toBeNull();
    expect(treeKeyCommand(key({ key: 'x' }))).toBeNull();
  });
});
