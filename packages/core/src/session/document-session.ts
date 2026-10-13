/**
 * @file document-session.ts
 * @purpose Implements DocumentSession, the authoritative document state machine and edit coordinator for K-Doc's editor bridge (FR-3.1 to FR-3.5).
 *   K-Doc runs two editor engines over one document — ProseMirror for the K-Doc pane, CodeMirror for the Source pane. Neither owns the document;
 *   this class does. The text is authoritative, exactly one pane holds the edit lock, and the undo history lives here so a single Ctrl+Z means
 *   one thing regardless of which pane made the edit. Headless: no DOM, no framework, no engine imports.
 * @inputs Markdown source text, AST trees (Root), pane focus changes (PaneId), apply options, and subscription callbacks.
 * @outputs SessionSnapshot states, SessionChange notifications with replaced OffsetRanges, and undo/redo restoration.
 * @functions
 *   - DocumentSession: Constructor initializing document AST, history stack, and clock.
 *   - snapshot getter: Builds a fresh immutable snapshot from current state.
 *   - timeline getter: Exposes the session's recorded states so a history browser can list them and put one back (FR-14.7).
 *   - subscribe: Registers a change listener callback and returns an unsubscription disposer.
 *   - focusPane: Transfers edit focus to the specified pane and terminates open history typing runs.
 *   - applyTree: Applies a modified mdast Root from the focused K-Doc pane via incremental serialization.
 *   - applyText: Applies replacement Markdown text from the focused Source pane.
 *   - undo: Restores the previous text state from edit history and updates document state.
 *   - redo: Restores an undone text state from edit history and updates document state.
 *   - markSaved: Records the current text as the saved text, so dirty reads false until it changes again.
 *   - reset: Replaces document content externally, clearing history and dirty flags.
 * @dataflow Editor changes (K-Doc AST or Source text) → DocumentSession state machine → EditHistory recording → KdocDocument update → SessionChange notification to listeners.
 * @controlflow Enforce single-pane edit lock (throw on unfocused edits) → update document & history → notify all registered listeners on consistent state.
 * @version 4
 * @date 2026-09-16
 */

import type { Root } from 'mdast';
import type { KdocDocument } from '../ast/types.js';
import type { MarkdownStyle } from '../style/markdown-style.js';
import type { OffsetRange } from '../position/map.js';
import { parseMarkdown } from '../parse/parser.js';
import { serializeIncremental } from '../serialize/incremental.js';
import { EditHistory, type EditHistoryOptions, type HistoryEntry, type PaneId } from './history.js';

export type { PaneId, HistoryEntry } from './history.js';

export type SessionChangeReason = 'edit' | 'external' | 'undo' | 'redo' | 'focus' | 'reset';

export interface SessionSnapshot {
  readonly text: string;
  readonly document: KdocDocument;
  readonly focusedPane: PaneId;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * The text as it was when the file was last saved, or when the session was reset to it.
   *
   * `dirty` is simply this differing from `text`. It is exposed because it is also the common ancestor
   * of the buffer and whatever another program has since written to the file, which is what makes a
   * three-way merge possible when the two disagree (FR-6.4). Without it there is no way to tell an edit
   * one side made from an edit the other side undid.
   */
  readonly savedText: string;
}

export interface SessionChange {
  readonly snapshot: SessionSnapshot;
  readonly reason: SessionChangeReason;
  readonly replacedRanges: readonly OffsetRange[];
  /**
   * Which view applied this edit, when one said (FR-6.9).
   *
   * `focusedPane` cannot answer this once two views share a pane: both are the K-Doc pane, so a
   * view comparing against it concludes the edit was its own and ignores it, and the second view
   * never updates. An identity the applying view chose distinguishes "mine" from "someone else's"
   * however many views there are.
   *
   * Absent for changes no view applied -- an external reload, a reset, a focus move.
   */
  readonly originId?: string;
}

export interface ApplyOptions {
  readonly coalesce?: boolean;
  /**
   * The applying view's identity, reported back on the resulting SessionChange (FR-6.9).
   *
   * A view that does not pass one is simply never recognised as the origin, which is what every
   * caller before two views existed wanted.
   */
  readonly originId?: string;
}

export interface DocumentSessionOptions extends EditHistoryOptions {
  readonly style?: MarkdownStyle;
  readonly now?: () => number;
  /**
   * The text as of the last save, when it is not the text the session starts from.
   *
   * A tab being switched back to is remounted from its stored text, and without this the new session
   * took that text as its saved state: unsaved work read as clean, so closing did not warn and autosave
   * skipped it. Omitted, the starting text is the saved text.
   */
  readonly savedText?: string;
}

/**
 * Authoritative document state machine for K-Doc's editor bridge (FR-3.1 to FR-3.5).
 * Coordinates text state, AST representation, single-pane edit locking, and unified undo/redo history.
 */
export class DocumentSession {
  private document: KdocDocument;
  private focusedPane: PaneId = 'kdoc';
  /**
   * The text as of the last save, against which `dirty` is computed.
   *
   * A boolean flag set on every edit and cleared only on save cannot answer "is this document
   * different from what is on disk?": undoing back to the saved text left the flag set, and the status
   * bar claimed unsaved work that did not exist. Comparing text answers the question actually asked.
   */
  private savedText: string;
  private readonly history: EditHistory;
  private readonly style: MarkdownStyle | undefined;
  private readonly now: () => number;
  private readonly listeners: Array<(change: SessionChange) => void> = [];

  /**
   * @purpose Initializes a new DocumentSession with parsed markdown content, edit history, and optional configuration.
   * @inputs text - The initial Markdown source text for the session.
   * @inputs options - Optional DocumentSessionOptions including style emission policy, history limits, and injectable clock.
   * @outputs void — instantiates and initializes the DocumentSession instance.
   * @dataflow text → parseMarkdown → this.document; options.savedText (or the parsed text) → this.savedText; options → this.history, this.style, this.now.
   * @controlflow Parse initial text into KdocDocument → construct EditHistory instance → assign style and clock fallback.
   */
  constructor(text: string, options?: DocumentSessionOptions) {
    this.document = parseMarkdown(text);
    this.savedText = options?.savedText ?? this.document.text;
    this.history = new EditHistory(options);
    this.style = options?.style;
    // The clock is injectable so coalescing is tested deterministically rather than with real timers.
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * @purpose Builds a fresh immutable snapshot from the current document state, active focus, dirty status, and undo/redo availability.
   * @inputs void.
   * @outputs SessionSnapshot - Fresh immutable snapshot of the current session state.
   * @dataflow Current private fields (document, focusedPane, savedText) and history getters (canUndo, canRedo) → SessionSnapshot object.
   * @controlflow Read current property values and history availability flags → construct and return new SessionSnapshot.
   */
  get snapshot(): SessionSnapshot {
    return {
      text: this.document.text,
      document: this.document,
      focusedPane: this.focusedPane,
      dirty: this.document.text !== this.savedText,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      savedText: this.savedText,
    };
  }

  /**
   * The document's edit timeline: every state still available to undo to, oldest first.
   *
   * @purpose Exposes the session's recorded states so a history browser can list them and put one back (FR-14.7).
   * @inputs void.
   * @outputs readonly HistoryEntry[] - The recorded states, oldest first.
   * @dataflow this.history.entries -> returned to the caller.
   * @controlflow No branching: forwards the history's own read-only view.
   *
   * These are the states to return TO, not the states that were typed: a coalesced typing run keeps
   * the text from before the run began, which is what makes one undo land at the start of a word
   * rather than in the middle of it. A caller restoring entry i therefore gets the document as it
   * stood before edit i, which is the version the timeline's row is naming.
   */
  get timeline(): readonly HistoryEntry[] {
    return this.history.entries;
  }

  /**
   * @purpose Subscribes a listener callback to session state change notifications and returns an unsubscription disposer.
   * @inputs listener - Callback function invoked with SessionChange whenever session state mutates.
   * @outputs () => void - Disposer function that unregisters the listener by identity.
   * @dataflow listener callback → this.listeners registration; unregister closure → filter/splice removal from this.listeners.
   * @controlflow Push listener to listeners array → return closure that finds listener by identity and removes it.
   */
  subscribe(listener: (change: SessionChange) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      // Check if the listener exists in the active listeners array.
      if (index !== -1) {
        // Remove the listener by index from the listeners array.
        this.listeners.splice(index, 1);
      } else {
        // Listener already removed or not found: no action required.
      }
    };
  }

  /**
   * @purpose Constructs a SessionChange from current snapshot state and broadcasts it to all registered listeners.
   * @inputs reason - The SessionChangeReason triggering this notification.
   * @inputs replacedRanges - Readonly array of OffsetRange byte ranges affected in the document text.
   * @outputs SessionChange - The constructed change object delivered to listeners.
   * @dataflow (reason, replacedRanges) + this.snapshot → SessionChange → broadcast to listeners array copy.
   * @controlflow Create snapshot and SessionChange → iterate shallow copy of listeners calling each callback → return SessionChange.
   */
  private notify(
    reason: SessionChangeReason,
    replacedRanges: readonly OffsetRange[],
    originId?: string,
  ): SessionChange {
    const change: SessionChange = {
      snapshot: this.snapshot,
      reason,
      replacedRanges,
      // Undefined when no view claimed the change -- an external reload, a reset, a focus move -- which
      // reads the same to a view comparing it against its own identity as leaving the field off would.
      originId,
    };

    // A listener that unsubscribes during notification must not corrupt the iteration,
    // so iterate over a shallow copy of the listeners array.
    const listenersCopy = [...this.listeners];
    for (const listener of listenersCopy) {
      listener(change);
    }

    return change;
  }

  /**
   * @purpose Transfers editor focus to the specified pane, closing any active history typing run and notifying listeners.
   * @inputs pane - The PaneId ('kdoc' | 'source') to receive focus.
   * @outputs void.
   * @dataflow pane → this.focusedPane; history.endRun() → closes coalescing window; notify('focus', []) → broadcast.
   * @controlflow Check if pane is already focused (return early if true) → update focusedPane → call history.endRun() → notify focus change.
   */
  focusPane(pane: PaneId): void {
    // Check if the requested pane is already the currently focused pane.
    if (this.focusedPane === pane) {
      // Already focused: return without notifying listeners since no state changed.
      return;
    } else {
      // Focus changed: proceed with pane transition.
    }

    this.focusedPane = pane;

    // Ending the run matters because merging across a pane switch would produce one undo entry spanning two engines.
    this.history.endRun();

    this.notify('focus', []);
  }

  /**
   * @purpose Applies an updated mdast Root from the focused K-Doc pane via incremental serialization, updating history and document state.
   * @inputs updated - The modified mdast Root syntax tree from the K-Doc editor.
   * @inputs options - Optional ApplyOptions controlling edit coalescing.
   * @outputs SessionChange - Change descriptor containing the new snapshot, 'edit' reason, and replaced offset ranges.
   * @dataflow updated + this.document → serializeIncremental → new text & ranges → parseMarkdown → this.document; history.push → recorded state.
   * @controlflow Guard focusedPane === 'kdoc' (throw Error if false) → push current text to history → incrementally serialize and re-parse → set dirty = true → notify listeners.
   */
  applyTree(updated: Root, options?: ApplyOptions): SessionChange {
    // Check whether the K-Doc pane currently holds edit focus.
    if (this.focusedPane !== 'kdoc') {
      // Failing fast catches a bridge bug immediately, while allowing it would let the two document models diverge silently.
      throw new Error(
        `Cannot apply tree edit: current focused pane is '${this.focusedPane}', but only the focused pane may apply edits (FR-3.1).`,
      );
    } else {
      // K-Doc pane is focused: proceed with tree application.
    }

    this.history.push(
      this.document.text,
      'kdoc',
      this.now(),
      options?.coalesce !== false,
    );

    const result = serializeIncremental(this.document, updated, this.style);
    this.document = parseMarkdown(result.text);

    return this.notify('edit', result.replacedRanges, options?.originId);
  }

  /**
   * @purpose Applies replacement Markdown text from the focused Source pane, updating history and document state.
   * @inputs text - The new Markdown source text from the Source editor.
   * @inputs options - Optional ApplyOptions controlling edit coalescing.
   * @outputs SessionChange - Change descriptor containing the new snapshot, 'edit' reason, and conservative whole-document range.
   * @dataflow text → parseMarkdown → this.document; history.push → recorded state; notify('edit', ...) → SessionChange.
   * @controlflow Guard focusedPane === 'source' (throw Error if false) → push current text to history → parse new text → set dirty = true → notify listeners.
   */
  applyText(text: string, options?: ApplyOptions): SessionChange {
    // Check whether the Source pane currently holds edit focus.
    if (this.focusedPane !== 'source') {
      // Failing fast catches a bridge bug immediately, while allowing it would let the two document models diverge silently.
      throw new Error(
        `Cannot apply text edit: current focused pane is '${this.focusedPane}', but only the focused pane may apply edits (FR-3.1).`,
      );
    } else {
      // Source pane is focused: proceed with text application.
    }

    this.history.push(
      this.document.text,
      'source',
      this.now(),
      options?.coalesce !== false,
    );

    this.document = parseMarkdown(text);

    // A raw text replacement carries no information about what changed, so the range is deliberately conservative rather than guessed.
    const replacedRanges: readonly OffsetRange[] = [{ start: 0, end: text.length }];

    return this.notify('edit', replacedRanges, options?.originId);
  }

  /**
   * @purpose Applies replacement Markdown text from something that is not a pane, such as find-and-replace.
   * @inputs text - The new Markdown source text.
   * @inputs options - Optional ApplyOptions controlling edit coalescing.
   * @outputs SessionChange - Change descriptor carrying the 'external' reason and a conservative whole-document range.
   * @dataflow text -> history.push -> parseMarkdown -> this.document; notify('external', ...) -> SessionChange.
   * @controlflow Push current text to history -> parse the new text -> set dirty -> notify listeners with the 'external' reason.
   *
   * The edit lock (FR-3.1) infers an edit's origin from which pane holds focus: whoever holds the lock is
   * whoever made the edit, and a binding therefore treats an 'edit' arriving while it holds the lock as its
   * own echo and skips re-rendering. A tool that is not a pane breaks that inference. Find-and-replace
   * originally borrowed the Source pane's lock to get its edit accepted, and the Source binding then
   * correctly-but-wrongly discarded the change as its own echo: the K-Doc pane updated and the Source
   * pane did not. The two panes visibly disagreed about the document.
   *
   * Hence a separate reason rather than a borrowed lock. No pane owns 'external', so no binding mistakes it
   * for its own echo and both re-render. The edit is still pushed onto the shared undo history, because a
   * replace-all is exactly the kind of thing a user expects a single Ctrl+Z to take back.
   */
  applyExternalText(text: string, options?: ApplyOptions): SessionChange {
    this.history.push(
      this.document.text,
      this.focusedPane,
      this.now(),
      options?.coalesce !== false,
    );

    this.document = parseMarkdown(text);

    // A raw text replacement carries no information about what changed, so the range is deliberately conservative rather than guessed.
    const replacedRanges: readonly OffsetRange[] = [{ start: 0, end: text.length }];

    return this.notify('external', replacedRanges);
  }

  /**
   * @purpose Restores the previous text state by popping from the undo history and updating the document.
   * @inputs void.
   * @outputs SessionChange | null - Change descriptor on successful undo, or null if nothing to undo.
   * @dataflow history.undo() → restored text → parseMarkdown → this.document → notify('undo', ...).
   * @controlflow Pop undo entry from history → if null return null → re-parse restored text → set dirty = true → notify listeners with whole-document range.
   */
  undo(): SessionChange | null {
    const restoredText = this.history.undo(
      this.document.text,
      this.focusedPane,
      this.now(),
    );

    // Check if the history stack contained an undoable state.
    if (restoredText === null) {
      // Nothing to undo is normal, not an error.
      return null;
    } else {
      // Restored text available: proceed with document state restoration.
    }

    this.document = parseMarkdown(restoredText);

    const replacedRanges: readonly OffsetRange[] = [{ start: 0, end: restoredText.length }];
    return this.notify('undo', replacedRanges);
  }

  /**
   * @purpose Restores an undone text state by popping from the redo history and updating the document.
   * @inputs void.
   * @outputs SessionChange | null - Change descriptor on successful redo, or null if nothing to redo.
   * @dataflow history.redo() → restored text → parseMarkdown → this.document → notify('redo', ...).
   * @controlflow Pop redo entry from history → if null return null → re-parse restored text → set dirty = true → notify listeners with whole-document range.
   */
  redo(): SessionChange | null {
    const restoredText = this.history.redo(
      this.document.text,
      this.focusedPane,
      this.now(),
    );

    // Check if the history stack contained an undone state to redo.
    if (restoredText === null) {
      // Nothing to redo is normal, not an error.
      return null;
    } else {
      // Restored text available: proceed with document state restoration.
    }

    this.document = parseMarkdown(restoredText);

    const replacedRanges: readonly OffsetRange[] = [{ start: 0, end: restoredText.length }];
    return this.notify('redo', replacedRanges);
  }

  /**
   * @purpose Marks the session state as clean/saved without modifying history or broadcasting a change event.
   * @inputs written - The exact text that reached disk; defaults to the current text.
   * @outputs void.
   * @dataflow written ?? this.document.text → this.savedText.
   * @controlflow Record the written text as the saved text; no notification or history mutation.
   */
  markSaved(written?: string): void {
    // Saving is not an edit: it records the text now on disk, without notifying listeners or touching
    // history. Everything downstream compares against this, so an undo back to it reads as clean again.
    // A save is asynchronous, so the caller passes what it actually wrote: anything typed while the write
    // was in flight is not on disk and must keep the document dirty.
    this.savedText = written ?? this.document.text;
  }
  /**
   * @purpose Reloads the document state with fresh source text, resetting history and clearing dirty state (FR-6.4).
   * @inputs text - The new Markdown source text to load into the session.
   * @outputs void.
   * @dataflow text → parseMarkdown → this.document; history.clear() → empty history; notify('reset', ...) → broadcast.
   * @controlflow Re-parse document text → clear edit history → set dirty = false → notify listeners of reset with whole-document range.
   */
  reset(text: string): void {
    // This is the external-change reload path of FR-6.4: re-parse content, discard history, and treat the new content as saved.
    this.document = parseMarkdown(text);
    this.savedText = this.document.text;
    this.history.clear();

    const replacedRanges: readonly OffsetRange[] = [{ start: 0, end: text.length }];
    this.notify('reset', replacedRanges);
  }
}
