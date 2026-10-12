/**
 * @file history.ts
 * @purpose Implements EditHistory, the undo/redo stack for K-Doc's editor bridge (FR-7.3).
 *   History and its coalescing policy are isolated from document state so that typing runs can be merged
 *   and undone/redone without touching the document state machine.
 * @inputs Editor edits: a text snapshot, the active PaneId, a monotonic timestamp in milliseconds, and a
 *   coalesce flag indicating whether the edit continues an ongoing typing run.
 * @outputs HistoryEntry text values returned by undo()/redo() (the text to restore), boolean flags
 *   canUndo/canRedo and the size getter for UI affordances, plus internal stack mutations.
 * @functions
 *   - EditHistory: constructor storing coalescing window and max-entry bounds from options.
 *   - canUndo getter: true when the undo stack holds at least one entry.
 *   - canRedo getter: true when the redo stack holds at least one entry.
 *   - size getter: current number of entries on the undo stack.
 *   - entries getter: every recorded state still available to undo to, oldest first.
 *   - push: record a text snapshot, coalescing into or extending an open run.
 *   - undo: pop the last undo entry to restore, pushing current state onto the redo stack.
 *   - redo: pop the last redo entry to restore, pushing current state onto the undo stack.
 *   - endRun: close any open typing run so the next push starts fresh.
 *   - clear: empty both stacks and close the run.
 * @dataflow Editor edit (text, pane, at, coalesce) → push() → undoStack/redoStack mutation → getter return value or undo()/redo() restore value.
 * @controlflow push records state with optional merge then trims to maxEntries; undo/redo pop one side and push onto the other; endRun/clear reset run state.
 * @version 2
 * @date 2026-09-12
 */

/** The editor surface an edit belongs to: the rendered WYSIWYG view or the raw source view. */
export type PaneId = 'wysiwyg' | 'source';

/** A single recorded text state, retained as a full snapshot for undo/redo restoration. */
export interface HistoryEntry {
  readonly text: string;
  readonly pane: PaneId;
  readonly at: number;
}

/** Optional tuning for EditHistory coalescing and memory bounds. */
export interface EditHistoryOptions {
  /** Gap in milliseconds after which a user is considered to have finished a typing run. */
  readonly coalesceWindowMs?: number;
  /** Maximum number of retained history entries before the oldest are dropped. */
  readonly maxEntries?: number;
}

/** Default coalescing window in milliseconds: a gap of at least this duration signals that a user has finished a typing run, so the next edit starts a new entry instead of merging. */
export const DEFAULT_COALESCE_WINDOW_MS = 500;

/** Default maximum history entries: bounds memory because each entry holds a full text snapshot. */
export const DEFAULT_MAX_HISTORY_ENTRIES = 500;

/**
 * Undo/redo stack for K-Doc's editor bridge (FR-7.3).
 * Records text snapshots and coalesces edits that belong to the same typing run, independent of document state.
 */
export class EditHistory {
  /** Stack of past states available to undo to; newest entry is at the end. */
  private undoStack: HistoryEntry[] = [];

  /** Stack of undone states available to redo to; newest undone entry is at the end. */
  private redoStack: HistoryEntry[] = [];

  /** Whether a typing run is currently open and eligible for coalescing into its last entry. Starts false. */
  private runOpen: boolean = false;

  /** Coalescing window in milliseconds, set from options or the default. */
  private readonly coalesceWindowMs: number;

  /** Maximum retained entries before oldest are dropped, set from options or the default. */
  private readonly maxEntries: number;

  /**
   * @purpose Stores the coalescing window and max-entry bounds, falling back to defaults when omitted.
   * @inputs options - Optional EditHistoryOptions; coalesceWindowMs (ms) and maxEntries override the DEFAULT_* constants.
   * @outputs void — initialises the private fields to their provided or default values.
   * @dataflow options.coalesceWindowMs → this.coalesceWindowMs; options.maxEntries → this.maxEntries; each falls back to its DEFAULT_* constant when undefined.
   * @controlflow Read each optional field with ?? fallback and assign to the readonly private fields; no branching.
   */
  constructor(options?: EditHistoryOptions) {
    this.coalesceWindowMs = options?.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
  }

  /**
   * @purpose Reports whether an undo operation is currently available.
   * @inputs void.
   * @outputs boolean true when the undo stack holds at least one entry.
   * @dataflow undoStack.length → comparison with zero.
   * @controlflow Returns the length comparison directly; no branching.
   */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * @purpose Reports whether a redo operation is currently available.
   * @inputs void.
   * @outputs boolean true when the redo stack holds at least one entry.
   * @dataflow redoStack.length → comparison with zero.
   * @controlflow Returns the length comparison directly; no branching.
   */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * @purpose Reports how many undoable states are currently retained.
   * @inputs void.
   * @outputs number the current length of the undo stack.
   * @dataflow undoStack.length returned directly.
   * @controlflow Returns the length; no branching.
   */
  get size(): number {
    return this.undoStack.length;
  }

  /**
   * Every recorded state still available to undo to, oldest first.
   *
   * @purpose Exposes the undo stack as a read-only list so a history browser can show the document's timeline (FR-14.7).
   * @inputs void.
   * @outputs readonly HistoryEntry[] - The undo stack, oldest entry first.
   * @dataflow this.undoStack -> a copy -> returned to the caller.
   * @controlflow No branching: slices the stack and returns it.
   *
   * A copy, not the stack itself. Handing out the live array would let a caller splice the undo
   * stack while holding what it believes is a list to draw, and the entry the user then clicked
   * would name a different version from the one they were looking at.
   *
   * The redo stack is deliberately not included. Its entries are states the user has already
   * stepped away from, and a timeline that listed them would offer to restore a version that
   * pressing redo also reaches -- two controls for one thing, disagreeing about which is current.
   */
  get entries(): readonly HistoryEntry[] {
    return this.undoStack.slice();
  }

  /**
   * @purpose Records a text snapshot, coalescing it into an open run or starting a new entry.
   * @inputs text - The editor text to restore to on the next undo/redo of this entry.
   * @inputs pane - The PaneId of the active editor for this edit.
   * @inputs at - Monotonic timestamp in milliseconds of this edit's state.
   * @inputs coalesce - Whether this edit continues an ongoing typing run and may merge with the previous entry.
   * @outputs void — mutates undoStack/redoStack/runOpen and trims to maxEntries.
   * @dataflow (text, pane, at) → new HistoryEntry merged into or pushed onto undoStack; current redoStack discarded.
   * @controlflow Clear redo stack; if coalescing conditions hold replace the last entry, else push a new entry and set runOpen = coalesce; then trim oldest entries past maxEntries.
   */
  push(text: string, pane: PaneId, at: number, coalesce: boolean): void {
    // Clear the redo stack first: editing after undoing abandons the redone future. This is the standard
    // linear-history rule — a fresh edit discards every state that was previously undone.
    this.redoStack = [];

    const lastIndex = this.undoStack.length - 1;
    const lastEntry = this.undoStack[lastIndex];

    if (coalesce && this.runOpen && lastEntry !== undefined && lastEntry.pane === pane && at - lastEntry.at <= this.coalesceWindowMs) {
      // Merge branch: coalesce is on, a run is open, the previous entry exists and matches this pane, and the new
      // timestamp falls within the window. The `lastEntry !== undefined` guard also narrows the type so `.pane`/`.at` are safe to read.
      // Keep the entry's ORIGINAL text and advance only its timestamp. The stored text is the state to
      // return to, so a coalesced run must retain the text from BEFORE the run began; overwriting it with
      // this edit's text would make a single undo land in the middle of the typing run instead of at its start.
      this.undoStack[lastIndex] = { text: lastEntry.text, pane: lastEntry.pane, at };
    } else {
      // Push branch: any coalescing condition failed (coalesce off, no open run, different pane, or window exceeded).
      // Start a fresh entry and set the run state to `coalesce`; when coalesce is false this closes the run so the next push cannot merge.
      this.undoStack.push({ text, pane, at });
      this.runOpen = coalesce;
    }

    // Bound memory: once past maxEntries, drop the oldest entries from the front. The earliest text becomes
    // unreachable — this is the documented cost of bounding history size. A single push adds at most one entry,
    // so at most one shift occurs, but the loop keeps the invariant correct regardless.
    while (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
  }

  /**
   * @purpose Restores the previous text state by popping the last undo entry.
   * @inputs currentText - The editor's current text, recorded onto the redo stack for a future redo.
   * @inputs pane - The PaneId of the active editor when this edit occurred.
   * @inputs at - Monotonic timestamp in milliseconds of the current state, recorded for coalescing context.
   * @outputs string | null — the restored text on success, or null when nothing can be undone.
   * @dataflow undoStack.pop() → previous entry; (currentText, pane, at) → new redo entry; previous.text returned.
   * @controlflow Return null early when empty; otherwise pop, push current onto redo, close the run, and return the popped text.
   */
  undo(currentText: string, pane: PaneId, at: number): string | null {
    if (this.undoStack.length === 0) {
      // Nothing to undo — pressing Ctrl+Z with an empty stack is normal user behaviour, not an error.
      return null;
    }

    const previous = this.undoStack.pop();
    if (previous === undefined) {
      // Guard: pop() is typed as T | undefined under strict mode even though the length check above guarantees a value.
      // Handle it explicitly to satisfy noUncheckedIndexedAccess-style safety without resorting to a non-null assertion.
      return null;
    }

    // Record the current state onto the redo stack so this edit can be reversed again on a later redo.
    this.redoStack.push({ text: currentText, pane, at });
    // Undoing ends any open typing run so the next push starts a fresh entry rather than merging.
    this.runOpen = false;
    return previous.text;
  }

  /**
   * @purpose Restores an undone text state by popping the last redo entry (mirror image of undo()).
   * @inputs currentText - The editor's current text, recorded onto the undo stack for a future undo.
   * @inputs pane - The PaneId of the active editor when this edit occurred.
   * @inputs at - Monotonic timestamp in milliseconds of the current state, recorded for coalescing context.
   * @outputs string | null — the restored text on success, or null when nothing can be redone.
   * @dataflow redoStack.pop() → next entry; (currentText, pane, at) → new undo entry; next.text returned.
   * @controlflow Return null early when empty; otherwise pop, push current onto undo, close the run, and return the popped text.
   */
  redo(currentText: string, pane: PaneId, at: number): string | null {
    if (this.redoStack.length === 0) {
      // Nothing to redo — normal user behaviour, not an error.
      return null;
    }

    const next = this.redoStack.pop();
    if (next === undefined) {
      // Guard: pop() is typed as T | undefined under strict mode even though the length check above guarantees a value.
      // Handle it explicitly to satisfy noUncheckedIndexedAccess-style safety without resorting to a non-null assertion.
      return null;
    }

    // Record the current state onto the undo stack so this edit can be undone again on a later undo.
    this.undoStack.push({ text: currentText, pane, at });
    // Redoing ends any open typing run so the next push starts a fresh entry rather than merging.
    this.runOpen = false;
    return next.text;
  }

  /**
   * @purpose Closes any open typing run so the next push cannot merge into the previous entry.
   * @inputs void.
   * @outputs void — sets runOpen to false.
   * @dataflow literal false → this.runOpen.
   * @controlflow Single assignment; no branching.
   */
  endRun(): void {
    // Closing the run forces the next push() to start a new entry instead of coalescing into the last one.
    this.runOpen = false;
  }

  /**
   * @purpose Discards all history state and closes any open typing run.
   * @inputs void.
   * @outputs void — empties both stacks and resets runOpen to false.
   * @dataflow empty arrays → undoStack/redoStack; literal false → runOpen.
   * @controlflow Three assignments; no branching.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.runOpen = false;
  }
}
