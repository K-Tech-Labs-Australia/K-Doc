/**
 * @file binding.ts
 * @purpose Implements CodeMirrorBinding, the live wiring between a K-Doc DocumentSession and a CodeMirror 6 EditorView showing raw Markdown (FR-3.1 to FR-3.5).
 *   The DocumentSession is authoritative and the EditorView is a client of it. This class coordinates bidirectional updates:
 *   view edits are forwarded to the session without echo bounces, and session changes (undo, redo, reset, or edits from the K-Doc pane)
 *   are synchronized into the view without fighting the user's cursor or being mistaken for fresh user edits.
 * @inputs DocumentSession state and SessionChange events, DOM container HTMLElement, optional CodeMirror Extensions, optional onError handler, and CodeMirror ViewUpdates.
 * @outputs CodeMirrorBinding instance, live CodeMirror EditorView, synchronized DocumentSession text updates, and error notifications.
 * @functions
 *   - constructor: Initializes CodeMirrorBinding, creates initial EditorState & EditorView, configures extensions and focus handling, and subscribes to session changes.
 *   - view getter: Returns the underlying CodeMirror EditorView instance.
 *   - focus: Focuses the CodeMirror EditorView DOM element.
 *   - destroy: Disposes session subscription and destroys the EditorView idempotently.
 *   - handleUpdate: Intercepts CodeMirror ViewUpdate events, filtering out non-doc changes and session echoes, and forwards text changes to DocumentSession.
 *   - handleSessionChange: Filters incoming session change events and triggers view synchronization on undo, redo, reset, or edits originating from the other pane.
 *   - syncFromSession: Replaces CodeMirror document content with authoritative session text while preserving caret position under a safety loop guard.
 * @dataflow View interaction → CodeMirror updateListener → handleUpdate → DocumentSession.applyText; Session change → handleSessionChange → syncFromSession → EditorView.dispatch.
 * @controlflow Process view update → verify docChanged and !applyingFromSession → forward to session.applyText (recovering view on error); On session change (undo/redo/reset/other pane edit) → syncFromSession with applyingFromSession loop guard.
 * @version 4
 * @date 2026-09-16
 */

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, type ViewUpdate } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { createSourceKeymap } from './keymap.js';
import { createMultiCaretExtensions } from './multi-caret.js';
import { createSourceGutterExtensions } from './source-gutters.js';
import type { DocumentSession, SessionChange } from '@k-doc/core';

/** Counts the bindings made in this module; see the ProseMirror binding (FR-6.9). */
let bindingCounter = 0;

export interface CodeMirrorBindingOptions {
  readonly session: DocumentSession;
  readonly mount: HTMLElement;
  readonly extensions?: readonly Extension[];
  readonly onError?: (error: Error) => void;

  /**
   * Called after every view update, including selection-only ones.
   *
   * The outline pane marks the section the caret is in, and moving the caret changes no text, so the
   * session never fires for it. This is the only signal that carries it -- the same reason
   * ProseMirrorBinding has one.
   */
  readonly onStateChange?: (view: EditorView) => void;
}

export class CodeMirrorBinding {
  private readonly session: DocumentSession;
  private readonly onError: (error: Error) => void;
  private readonly onStateChange: ((view: EditorView) => void) | null;
  private readonly editorView: EditorView;
  private unsubscribe: (() => void) | null;
  private applyingFromSession: boolean = false;

  /** This view's identity among the views over the session; see the ProseMirror binding (FR-6.9). */
  private readonly originId: string = `cm-${(bindingCounter += 1)}`;

  // Editability is reconfigured rather than rebuilt, so locking a document (FR-6.7) keeps the view,
  // its scroll position and its history rather than replacing them.
  private readonly editableCompartment: Compartment = new Compartment();

  // What the compartment currently holds, so setEditable can tell a real change from a repeat.
  private editable: boolean = true;
  private destroyed: boolean = false;

  /**
   * @purpose Constructs a new CodeMirrorBinding instance, setting up EditorState and EditorView, configuring extensions, focus handling, and session subscription.
   * @inputs options - CodeMirrorBindingOptions specifying session, DOM mount container, optional extensions, and optional error handler.
   * @outputs void — instantiates the CodeMirrorBinding instance.
   * @dataflow options.session.snapshot.text → EditorState.create → EditorView; session.subscribe listener attached.
   * @controlflow Resolves onError default → builds extension list in order → creates EditorState & EditorView → subscribes to session changes.
   */
  constructor(options: CodeMirrorBindingOptions) {
    this.session = options.session;

    // Check if a custom onError handler is provided in options.
    // An unhandled binding failure is a real defect and must not be swallowed,
    // while a host supplying a handler has chosen to surface it its own way.
    if (options.onError !== undefined) {
      // Custom error callback supplied by host.
      this.onError = options.onError;
    } else {
      // Default error handler rethrowing uncaught exceptions to fail fast.
      this.onError = (error: Error): void => {
        throw error;
      };
    }

    // Check whether the host wants to observe view updates; null means nobody is listening.
    if (options.onStateChange !== undefined) {
      // Host supplied an observer: store it for handleUpdate to notify.
      this.onStateChange = options.onStateChange;
    } else {
      // No observer supplied: handleUpdate skips notification entirely.
      this.onStateChange = null;
    }

    const extensions: Extension[] = [
      // Editability first, so a caller's own extension can still override it by coming later.
      this.editableCompartment.of(EditorView.editable.of(true)),
      markdown(),
      // Line numbers, code folding and bracket matching (FR-5.2). They sit directly after markdown()
      // because folding is the language's to decide: lang-markdown registers the fold service that
      // knows a heading owns the section beneath it, and foldGutter() only reads what it publishes.
      ...createSourceGutterExtensions(),
      // Without drawSelection, CodeMirror leans on the browser's native selection, which is not painted
      // at all while the editor is unfocused. Find-and-replace reveals a match without taking focus --
      // taking it would pull the caret out of the find box mid-search -- so the match was located
      // correctly and shown to nobody. drawSelection paints CodeMirror's own selection layer regardless
      // of focus, and the theme below gives the unfocused state a colour that is actually visible.
      drawSelection(),
      EditorView.theme({
        '.cm-selectionBackground': {
          background: 'var(--kdoc-color-selection)',
        },
        '&.cm-focused .cm-selectionBackground': {
          background: 'var(--kdoc-color-selection)',
        },
      }),
      // Undo and redo bind to the SESSION, not to CodeMirror. history() and historyKeymap are
      // deliberately not installed: they are a second, pane-local undo stack, and rewinding it reached
      // the session as a fresh edit rather than as an undo, so the shared history grew instead of
      // shrinking and Ctrl+Z meant different things in the two panes (FR-3.5).
      // Multiple carets and column selection (FR-7.2). Placed before the session keymap so a binding
      // K-Doc owns still wins: Mod-d is not one K-Doc claims, but the ordering should not depend on that.
      ...createMultiCaretExtensions(),
      createSourceKeymap({ session: this.session }),
      EditorView.updateListener.of((update: ViewUpdate): void => {
        this.handleUpdate(update);
      }),
      EditorView.domEventHandlers({
        focus: (): boolean => {
          // Claim the edit lock when the pane receives focus, because applyText throws for a pane that does not hold it (FR-3.1).
          this.session.focusPane('source');
          // Returning false indicates the focus event was not exclusively consumed, letting CodeMirror continue.
          return false;
        },
      }),
    ];

    // Check if caller supplied additional extensions.
    // The caller's extensions go last deliberately, because later extensions win in CodeMirror's precedence.
    if (options.extensions !== undefined) {
      // Host supplied extensions: append to extension list so they take precedence.
      extensions.push(...options.extensions);
    } else {
      // No extra extensions provided.
    }

    const state = EditorState.create({
      doc: options.session.snapshot.text,
      extensions,
    });

    // Create the CodeMirror EditorView attached to the mount element.
    this.editorView = new EditorView({
      state,
      parent: options.mount,
    });

    // Subscribe to session state change notifications and retain the unsubscription disposer.
    this.unsubscribe = this.session.subscribe((change: SessionChange): void => {
      this.handleSessionChange(change);
    });
  }

  /**
   * @purpose Returns the underlying CodeMirror EditorView instance.
   * @inputs void.
   * @outputs EditorView - The active CodeMirror editor view instance.
   * @dataflow Accesses this.editorView → returns EditorView reference.
   * @controlflow Returns this.editorView directly.
   */
  /**
   * @purpose Reports whether the Source pane currently accepts typing (FR-6.7).
   * @inputs void.
   * @outputs boolean - True when the view is editable.
   * @dataflow The flag last given to setEditable.
   * @controlflow No branching; a field read.
   */
  get isEditable(): boolean {
    return this.editable;
  }

  /**
   * @purpose Turns typing in the Source pane on or off without rebuilding the view (FR-6.7).
   * @inputs editable - True to accept typing, false to refuse it.
   * @outputs void.
   * @dataflow editable -> the editable compartment -> EditorView.editable.
   * @controlflow Return early when the value has not changed, so an unchanged call dispatches nothing;
   *   otherwise record it and reconfigure the compartment.
   */
  setEditable(editable: boolean): void {
    // Check whether this actually changes anything, so repeated calls cost nothing.
    if (this.editable === editable) {
      // Already in this state: nothing to reconfigure.
      return;
    } else {
      // A real change: record it before reconfiguring.
      this.editable = editable;
    }
    this.editorView.dispatch({
      effects: this.editableCompartment.reconfigure(EditorView.editable.of(editable)),
    });
  }

  get view(): EditorView {
    return this.editorView;
  }

  /**
   * @purpose Focuses the underlying CodeMirror EditorView DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow Calls this.editorView.focus() → browser focuses editor DOM element.
   * @controlflow Delegates focus call directly to this.editorView.focus().
   */
  focus(): void {
    this.editorView.focus();
  }

  /**
   * @purpose Cleans up all resources held by the binding, unsubscribing from session events and destroying the editor view idempotently.
   * @inputs void.
   * @outputs void.
   * @dataflow Disposes session subscription → destroys editorView.
   * @controlflow Checks destroyed guard (returns early if already destroyed) → marks destroyed = true → invokes unsubscribe disposer → destroys editorView.
   */
  destroy(): void {
    // Check if the binding instance has already been destroyed.
    // Idempotence matters because host frameworks routinely unmount twice.
    if (this.destroyed) {
      // Already destroyed: return immediately to prevent duplicate teardown.
      return;
    } else {
      // Active binding: mark as destroyed and proceed with teardown.
      this.destroyed = true;
    }

    // Check if an active session unsubscription disposer exists.
    if (this.unsubscribe !== null) {
      // Disposer present: invoke to unsubscribe and null out reference.
      this.unsubscribe();
      this.unsubscribe = null;
    } else {
      // Disposer already null: no action required.
    }

    this.editorView.destroy();
  }

  /**
   * @purpose Intercepts CodeMirror view updates, filtering non-doc changes and loop echoes, and forwards new text to DocumentSession.
   * @inputs update - The CodeMirror ViewUpdate describing state mutations in the view.
   * @outputs void.
   * @dataflow update.state.doc.toString() → this.session.applyText; on error → syncFromSession() & this.onError(error).
   * @controlflow Check update.docChanged (return early if false) → check this.applyingFromSession (return early if true) → try applyText to session; on error resynchronize view from session and report to onError.
   */
  private handleUpdate(update: ViewUpdate): void {
    // Notify BEFORE the docChanged guard, so a caret move still reaches the host.
    // Check whether a host observer is registered and the binding is still alive.
    if (this.onStateChange !== null && !this.destroyed) {
      // Observer present on a live binding: hand it the view so it can read the current state.
      this.onStateChange(this.editorView);
    } else {
      // No observer, or the binding is destroyed: nothing to notify.
    }

    // Check if the document content actually changed.
    // A selection or viewport change is not an edit and forwarding it would create empty undo entries.
    if (!update.docChanged) {
      // Selection or viewport change only: return immediately.
      return;
    } else {
      // Document content changed: proceed to session synchronization.
    }

    // Check if this update was triggered by synchronization from the session.
    // This update is the binding writing the session's own change back into the view, and forwarding it would bounce straight back as a fresh edit.
    if (this.applyingFromSession) {
      // Update originated from session synchronization: return immediately.
      return;
    } else {
      // Update originated from user edit: forward to authoritative session.
    }

    try {
      this.session.applyText(update.state.doc.toString(), { originId: this.originId });
    } catch (caught: unknown) {
      // Recovering the view before reporting is what stops the pane showing text the document does not contain.
      this.syncFromSession();

      // Check whether the caught value is an Error instance.
      let error: Error;
      if (caught instanceof Error) {
        // Caught value is Error: forward directly.
        error = caught;
      } else {
        // Caught value is not Error: wrap in Error instance.
        error = new Error(String(caught));
      }

      this.onError(error);
    }
  }

  /**
   * @purpose Handles session change notifications, filtering out edit echoes and focus events, and syncing the view on undo, redo, reset, or edits from the other pane.
   * @inputs change - The SessionChange notification object emitted by DocumentSession.
   * @outputs void.
   * @dataflow change inspection → syncFromSession() on external document changes.
   * @controlflow Check change.reason and focusedPane → syncFromSession if undo/redo/reset or edit from K-Doc pane; return early otherwise.
   */
  private handleSessionChange(change: SessionChange): void {
    // Check whether the session change is restorative (undo/redo/reset) or an edit from the other pane.
    // An 'edit' while this pane holds the lock is this binding's own echo and re-rendering it would fight the user's cursor mid-keystroke,
    // but an 'edit' while the OTHER pane holds the lock is a change this pane has not seen and must show.
    // The focused pane is a reliable origin signal precisely because the session refuses edits from a pane that does not hold the lock,
    // so whoever holds it is whoever made the edit. That inference only covers panes, which is why 'external'
    // exists: no pane owns it, so neither binding can mistake it for its own echo and both re-render.
    if (
      change.reason === 'undo' ||
      change.reason === 'redo' ||
      change.reason === 'reset' ||
      change.reason === 'external' ||
      // An edit this view did not apply; see the ProseMirror binding for why identity, not pane.
      (change.reason === 'edit' && change.originId !== this.originId)
    ) {
      // Reason is undo/redo/reset or external edit from K-Doc pane: resynchronize view with session.
      this.syncFromSession();
    } else {
      // Change is this pane's own edit echo or a focus event: ignore and return early.
      return;
    }
  }

  /**
   * @purpose Re-synchronizes the CodeMirror EditorView state with the authoritative DocumentSession text, preserving caret position.
   * @inputs void.
   * @outputs void.
   * @dataflow this.session.snapshot.text → EditorView.dispatch transaction replacing doc range and clamping selection.
   * @controlflow Compare session text with current doc (return early if equal) → set applyingFromSession = true → try dispatch doc replacement and selection update → finally restore applyingFromSession = false.
   */
  private syncFromSession(): void {
    const text = this.session.snapshot.text;

    // Check if the view document already matches the authoritative session text.
    // Skipping a no-op dispatch avoids disturbing the selection for nothing.
    if (text === this.editorView.state.doc.toString()) {
      // Text is already identical: return early without dispatching.
      return;
    } else {
      // Text differs: proceed with full document synchronization.
    }

    const previousAnchor = this.editorView.state.selection.main.anchor;

    // Set applyingFromSession = true to guard against echo updates while writing to the view.
    this.applyingFromSession = true;
    try {
      // Dispatch a transaction replacing the whole document and clamping the caret position.
      // Exact selection restoration is not attempted across a whole-document replacement;
      // keeping the caret near where it was is the honest best effort.
      this.editorView.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: text,
        },
        selection: {
          anchor: Math.min(previousAnchor, text.length),
        },
      });
    } finally {
      // Restore applyingFromSession in a finally block so an exception cannot leave the guard stuck on.
      // A stuck guard would silently stop every future edit reaching the session.
      this.applyingFromSession = false;
    }
  }
}
