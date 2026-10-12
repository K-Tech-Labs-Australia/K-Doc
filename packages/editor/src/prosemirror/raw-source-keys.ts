/**
 * @file raw-source-keys.ts
 * @purpose Decides when a key pressed inside an embedded raw-source editor belongs to the surrounding document (FR-7.9).
 * @inputs CodeMirror editor state and keyboard events.
 * @outputs Booleans.
 * @functions
 *   - atEdge: True when an arrow key would move the caret out of the widget.
 *   - isHistoryKey: True for Ctrl/Cmd+Z and Ctrl/Cmd+Y, which the document's history owns.
 * @dataflow State/event -> boolean.
 * @controlflow Pure checks, no side effects.
 * @version 1
 * @date 2026-09-13
 */
import type { EditorState } from '@codemirror/state';

/**
 * @purpose True when the caret sits on the widget's edge in the given direction with nothing selected.
 * @inputs state - the embedded editor's state; dir - -1 for up/left, 1 for down/right; unit - 'line' for up/down arrows, 'char' for left/right.
 * @outputs boolean.
 * @dataflow selection.main + doc -> edge comparison.
 * @controlflow Non-empty selection -> false; otherwise compare against the first/last line or the start/end of the text.
 */
export function atEdge(state: EditorState, dir: -1 | 1, unit: 'line' | 'char'): boolean {
  // Capture the primary caret position and its selection range for edge comparisons.
  const sel = state.selection.main;
  // A non-empty selection cannot be an edge case for arrow navigation, so reject it early.
  if (!sel.empty) return false;
  // Arrow moves by whole lines: compare the current line number against document boundaries.
  if (unit === 'line') {
    // Resolve the line containing the caret to read its 1-based number.
    const line = state.doc.lineAt(sel.head);
    // Up/left at line 1 or down/right at the final line means the caret is at a vertical edge.
    return dir < 0 ? line.number === 1 : line.number === state.doc.lines;
  } else {
    // Arrow moves by characters: compare the caret offset against the document's character bounds.
    return dir < 0 ? sel.head === 0 : sel.head === state.doc.length;
  }
}

/**
 * @purpose True for undo/redo chords, so the widget can hand them to the document's single history.
 * @inputs event - the keydown event.
 * @outputs boolean.
 * @dataflow modifier flags + key -> boolean.
 * @controlflow Requires Ctrl or Meta; then z or y, case-insensitive.
 */
export function isHistoryKey(event: KeyboardEvent): boolean {
  // Require a platform modifier (Ctrl on Windows/Linux, Meta on macOS) to avoid false positives.
  if (!event.ctrlKey && !event.metaKey) return false;
  // Normalize the key so Shift+Z still matches the undo/redo chords.
  const key = event.key.toLowerCase();
  // z is undo and y is redo per cross-platform convention.
  return key === 'z' || key === 'y';
}
