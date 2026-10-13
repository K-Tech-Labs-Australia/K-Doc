/**
 * @file binding.ts
 * @purpose Implements ProseMirrorBinding, the live wiring between a K-Doc DocumentSession and a ProseMirror EditorView (FR-3.1 to FR-3.5).
 *   The DocumentSession is authoritative and the EditorView is a client of it. This class is the single point of interaction between the two,
 *   coordinating bidirectional updates: view edits are forwarded to the session without echo bounces, and session changes (undo, redo, reset)
 *   are synchronized into the view without being mistaken for fresh user edits. This is the only file in the package that touches the DOM.
 * @inputs DocumentSession state and SessionChange events, DOM container HTMLElement, optional Schema, optional onError handler, ProseMirror Transactions, and DOM focus events.
 * @outputs ProseMirrorBinding instance, live ProseMirror EditorView, synchronized DocumentSession tree updates, and error notifications.
 * @functions
 *   - constructor: Initializes ProseMirrorBinding, creates initial EditorState & EditorView, subscribes to session changes, and attaches DOM focus handler.
 *   - view getter: Returns the underlying ProseMirror EditorView instance.
 *   - isEditable getter: Returns whether the ProseMirror editor view is currently editable.
 *   - focus: Focuses the ProseMirror EditorView DOM element.
 *   - setEditable: Updates the editable state of the editor view, making the pane read-only while the document is locked.
 *   - destroy: Disposes session subscription, detaches DOM event listeners, and destroys the EditorView.
 *   - handleTransaction: Dispatches transactions to the view, enforces selection and echo loop guards, converts docs to mdast Root, and forwards edits to DocumentSession.
 *   - handleSessionChange: Filters incoming session change events and triggers view synchronization on undo, redo, or reset.
 *   - syncFromSession: Rebuilds ProseMirror EditorState from authoritative session document snapshot while preserving caret position under a safety loop guard.
 * @dataflow View interaction → EditorView transaction → handleTransaction → proseMirrorToMdast → DocumentSession.applyTree; Session change → handleSessionChange → syncFromSession → mdastToProseMirror → EditorView.updateState.
 * @controlflow Apply transaction to view → verify docChanged and !applyingFromSession → forward to session.applyTree (recovering view on error); On session change (undo/redo/reset or other-pane edit) → syncFromSession with applyingFromSession loop guard.
 * @version 6
 * @date 2026-09-18
 */

import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Plugin, Transaction } from 'prosemirror-state';
import type { ClipboardHandlers } from './clipboard.js';
import type { Schema, Slice } from 'prosemirror-model';
import { clipboardText } from './table-tsv.js';
import type { DocumentSession, SessionChange } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { createMultiCaretPlugin } from './multi-caret-plugin.js';
import { createLinkFollowPlugin } from './link-follow-plugin.js';
import { createRawSourceNodeViews } from './raw-source-view.js';
import { createImageNodeView, type ImageSourceLoader } from './image-view.js';
import { createMediaNodeView, type MediaSourceLoader } from './media-view.js';
import { createKdocKeymap } from './keymap.js';
import { createFootnoteDefinitionView, createFootnoteNavigationPlugin } from './footnotes.js';
import type { LinkRange } from './link.js';

/**
 * Counts the bindings made in this module, so each view's identity differs from every other's (FR-6.9).
 *
 * A counter rather than a random id: two views of one document in one window is the whole population,
 * the ids never leave the process, and a counter is reproducible in a test where a random id is not.
 */
let bindingCounter = 0;

export interface ProseMirrorBindingOptions {
  readonly session: DocumentSession;
  readonly mount: HTMLElement;
  readonly schema?: Schema;
  readonly onError?: (error: Error) => void;

  /**
   * Called after every view state update, including selection-only changes.
   *
   * A toolbar that reflects the caret cannot subscribe to the session for this: moving the caret
   * changes no document text, so the session never fires. This is the only signal that carries it.
   */
  readonly onStateChange?: (view: EditorView) => void;

  /**
   * Invoked when the user presses the link shortcut, carrying the link under the caret when there is one.
   */
  readonly onRequestLink?: (current: LinkRange | null) => void;

  /** Passed to the keymap: the host dispatches the remappable shortcuts itself (FR-14.16). */
  readonly hostOwnsShortcuts?: boolean;

  /**
   * Called when Ctrl+Click (Cmd+Click) lands on a link, with its href as written (FR-8.13). When set,
   * the link-follow plugin is installed ahead of multi-caret, so a modified click on a link follows it
   * while a modified click anywhere else still adds a caret.
   */
  readonly onFollowLink?: (href: string) => void;

  /**
   * Extra plugins appended after the keymap, for features the binding itself has no business knowing
   * about — spell-check decorations are the first.
   *
   * They are an option rather than something a caller adds afterwards because syncFromSession rebuilds
   * the EditorState from `this.plugins`, so a plugin bolted on later would survive until the first
   * external reload and then vanish.
   */
  readonly plugins?: readonly Plugin[];
  /**
   * Resolves a local image address to a URL the webview can load (FR-8.14). Without it an image's src is
   * used as written, which cannot load a file beside the document.
   */
  readonly loadImage?: ImageSourceLoader;

  /**
   * Resolves a local video or audio address to a URL the webview can play (FR-8.17). Without it a player is
   * given the address as written, which cannot reach a file beside the document.
   */
  readonly loadMedia?: MediaSourceLoader;

  /**
   * Clipboard handling for the K-Doc pane (FR-7.4).
   *
   * Supplied by the host rather than built here, because the paste path converts HTML through the
   * core pipeline and the host is what knows whether a paste-options popup should follow.
   */
  readonly clipboard?: ClipboardHandlers;
}

export class ProseMirrorBinding {
  private readonly session: DocumentSession;
  private readonly schema: Schema;
  private readonly onError: (error: Error) => void;
  private readonly onStateChange: ((view: EditorView) => void) | null;
  private readonly editorView: EditorView;
  private unsubscribe: (() => void) | null;
  private applyingFromSession: boolean = false;

  /**
   * This view's identity among the views over the session (FR-6.9).
   *
   * Two K-Doc views are both the 'kdoc' pane, so the pane cannot say which of them applied an
   * edit. This can: an edit comes back carrying the identity of whichever view applied it, and every
   * other view takes it.
   */
  private readonly originId: string = `pm-${(bindingCounter += 1)}`;
  private destroyed: boolean = false;
  // A locked document turns the pane read-only. It is a field rather than a constructor option because the shell flips it
  // as the user locks and unlocks the document, and rebuilding the binding to change one boolean would throw away the undo history
  // the session owns and the caret the user was at.
  private editable: boolean = true;
  private readonly handleDomFocus: () => void;
  private plugins: readonly Plugin[];

  /**
   * @purpose Constructs a new ProseMirrorBinding instance, setting up EditorState and EditorView, subscribing to session events, and attaching DOM focus handlers.
   * @inputs options - ProseMirrorBindingOptions specifying session, DOM mount container, optional schema, and optional error callback.
   * @outputs void — instantiates the ProseMirrorBinding instance.
   * @dataflow options.session.snapshot → mdastToProseMirror → EditorState → EditorView; session.subscribe & DOM focus listeners attached.
   * @controlflow Resolves schema and onError defaults → converts initial AST to ProseMirror doc → creates EditorState & EditorView → subscribes to session → binds and adds DOM focus listener.
   */
  constructor(options: ProseMirrorBindingOptions) {
    this.session = options.session;

    // Check if a custom schema is provided in options; fallback to kdocSchema.
    if (options.schema !== undefined) {
      // Use custom schema provided by host.
      this.schema = options.schema;
    } else {
      // Default to canonical K-Doc schema.
      this.schema = kdocSchema;
    }

    // Check if a custom onError handler is provided in options.
    // Rethrowing is the default because an unhandled binding failure is a real defect and must not be swallowed,
    // while a host that supplies a handler has chosen to surface it its own way.
    if (options.onError !== undefined) {
      // Custom error callback supplied by host.
      this.onError = options.onError;
    } else {
      // Default error handler rethrowing uncaught exceptions to fail fast.
      this.onError = (error: Error): void => {
        throw error;
      };
    }

    // Check whether the host wants to observe view state changes; null means nobody is listening.
    if (options.onStateChange !== undefined) {
      // Host supplied an observer: store it for the update paths to notify.
      this.onStateChange = options.onStateChange;
    } else {
      // No observer supplied: the update paths skip notification entirely.
      this.onStateChange = null;
    }

    // Convert initial mdast syntax tree from session snapshot to a ProseMirror document.
    const initialDoc = mdastToProseMirror(this.session.snapshot.document.root, this.schema);
    // The keymap is built here rather than accepted as an option, because the binding already holds
    // the session and every K-Doc pane needs exactly these bindings. It is stored so syncFromSession
    // can rebuild state with the same plugins; a rebuilt state without them would silently lose every
    // shortcut, including Enter.
    // Multi-caret goes first, ahead of every keymap. ProseMirror consults handleKeyDown in plugin
    // order, so a Backspace that reached the base keymap first would delete at the primary caret and
    // stop -- the extra carets would watch it happen. It is core editing rather than a feature the
    // host opts into, which is why it is built in here rather than passed in options.plugins.
    // The link-follow plugin, when the host wants it, goes first: ProseMirror asks plugins in order and
    // the first handleClick to return true wins, so after multi-caret every Ctrl+Click on a link would
    // add a caret instead of following it.
    const followPlugins: readonly Plugin[] =
      options.onFollowLink === undefined ? [] : [createLinkFollowPlugin({ onFollow: options.onFollowLink })];
    this.plugins = [
      ...followPlugins,
      createMultiCaretPlugin(),
      // Clicking a footnote's number goes to its note, and the note's label goes back to the text.
      createFootnoteNavigationPlugin(),
      ...createKdocKeymap({
        session: this.session,
        schema: this.schema,
        ...(options.onRequestLink === undefined ? {} : { onRequestLink: options.onRequestLink }),
        ...(options.hostOwnsShortcuts === undefined ? {} : { hostOwnsShortcuts: options.hostOwnsShortcuts }),
      }),
    ];

    // Check whether the host supplied extra plugins to run alongside the keymap.
    if (options.plugins !== undefined) {
      // Supplied: append them after the keymap, so a host plugin cannot shadow a core binding.
      this.plugins = [...this.plugins, ...options.plugins];
    } else {
      // None supplied: the keymap alone is the plugin set.
    }

    // Captured before the view is built so the prop above closes over a definite value rather than
    // an optional one that TypeScript would have to re-narrow on every call.
    const clipboardHandlers: ClipboardHandlers = options.clipboard ?? {
      handlePaste: (): boolean => false,
    };

    const state = EditorState.create({
      doc: initialDoc,
      plugins: [...this.plugins],
      schema: this.schema,
    });

    // Create the ProseMirror EditorView attached to the mount element.
    this.editorView = new EditorView(options.mount, {
      state,
      // Raw HTML is edited as source in an embedded CodeMirror widget (FR-7.9). Core editing like
      // multi-caret, so it is built in rather than something a host must remember to pass.
      nodeViews: {
        ...createRawSourceNodeViews(),
        // A note is drawn with its number in front, outside the editable text.
        footnoteDefinition: createFootnoteDefinitionView(),
        // Images go through the host's loader when one is given, so a picture beside the document can be shown.
        ...(options.loadImage === undefined ? {} : { image: createImageNodeView(options.loadImage) }),

        // A video or audio reference plays through the host's loader on the same terms (FR-8.17).
        ...(options.loadMedia === undefined ? {} : { media: createMediaNodeView(options.loadMedia) }),
      },
      // ProseMirror calls editable on every state update rather than reading it once,
      // which is exactly why a mutable field works and no view rebuild is needed.
      editable: (): boolean => this.editable,
      // Copied table content goes on the plain-text clipboard as tab-separated values, so a spreadsheet pastes cells (FR-8.24).
      clipboardTextSerializer: (slice: Slice): string => clipboardText(slice),
      // Check whether the host supplied clipboard handling.
      ...(options.clipboard === undefined
        ? {}
        : {
            handlePaste: (view: EditorView, event: ClipboardEvent): boolean =>
              // Narrowed above; re-read through the captured handler so the property is not optional here.
              clipboardHandlers.handlePaste(view, event),
          }),
      dispatchTransaction: (tr: Transaction): void => {
        this.handleTransaction(tr);
      },
    });

    // Subscribe to session state change notifications and retain the unsubscription disposer.
    this.unsubscribe = this.session.subscribe((change: SessionChange): void => {
      this.handleSessionChange(change);
    });

    // Register a DOM focus listener on this.editorView.dom.
    // The binding claims the edit lock when the pane is focused, because applyTree throws for a pane that does not hold it (FR-3.1).
    this.handleDomFocus = (): void => {
      this.session.focusPane('kdoc');
    };
    // focusin rather than focus: it bubbles, so focus landing inside an embedded widget -- a raw-HTML
    // editor is a CodeMirror of its own -- still hands this pane the edit lock. A plain focus listener
    // only fires for the editor element itself, and the first keystroke in a widget would then be
    // applied by a pane that does not hold the lock, which the session refuses.
    this.editorView.dom.addEventListener('focusin', this.handleDomFocus);
  }

  /**
   * @purpose Returns the underlying ProseMirror EditorView instance.
   * @inputs void.
   * @outputs EditorView - The active ProseMirror editor view instance.
   * @dataflow Accesses this.editorView → returns EditorView reference.
   * @controlflow Returns this.editorView directly.
   */
  get view(): EditorView {
    return this.editorView;
  }

  /**
   * @purpose Returns whether the ProseMirror editor view is currently editable.
   * @inputs void.
   * @outputs boolean - True if the view is editable, false if read-only.
   * @dataflow Accesses this.editable → returns boolean value.
   * @controlflow Returns this.editable directly.
   */
  get isEditable(): boolean {
    return this.editable;
  }

  /**
   * @purpose Focuses the underlying ProseMirror EditorView DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow Calls this.editorView.focus() → browser focuses editor DOM element.
   * @controlflow Delegates focus call directly to this.editorView.focus().
   */
  focus(): void {
    this.editorView.focus();
  }

  /**
   * @purpose Updates the editable state of the editor view, making the pane read-only while the document is locked.
   * @inputs editable - boolean flag indicating whether the editor view should be editable.
   * @outputs void.
   * @dataflow editable argument → this.editable; prompts editorView to re-evaluate editable prop via updateState.
   * @controlflow Checks if editable flag is unchanged (returns early if so) → updates this.editable → calls editorView.updateState with current state.
   */
  setEditable(editable: boolean): void {
    // Check whether the flag actually changed, since ProseMirror has to be told to re-read it.
    if (this.editable === editable) {
      // No change: avoid a pointless state update.
      return;
    } else {
      // Changed: record it and prompt ProseMirror to re-evaluate its editable prop.
      this.editable = editable;
    }

    // updateState with the current state is how ProseMirror is asked to re-read its props; there is no
    // setProp for this. Passing the existing state means nothing about the document or selection changes.
    this.editorView.updateState(this.editorView.state);
  }

  /**
   * @purpose Cleans up all resources held by the binding, unsubscribing from session events, removing DOM listeners, and destroying the editor view.
   * @inputs void.
   * @outputs void.
   * @dataflow Disposes session subscription → removes DOM focus listener → destroys editorView.
   * @controlflow Checks destroyed guard (returns early if already destroyed) → marks destroyed = true → invokes unsubscribe disposer → removes DOM listener → destroys editorView.
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

    // Remove DOM focus listener and destroy the underlying ProseMirror EditorView.
    this.editorView.dom.removeEventListener('focusin', this.handleDomFocus);
    this.editorView.destroy();
  }

  /**
   * @purpose Hands the current EditorView to the host's optional state observer after any view update.
   * @inputs void.
   * @outputs void.
   * @dataflow this.onStateChange → invoked with this.editorView.
   * @controlflow Check for a registered observer on a live binding → invoke it with the view, or do nothing.
   */
  private notifyStateChange(): void {
    // Check whether a host observer is registered and the binding is still alive.
    // A notification after destroy would hand out a view whose DOM has already been torn down.
    if (this.onStateChange !== null && !this.destroyed) {
      // Observer present on a live binding: hand it the view so it can read the current state.
      this.onStateChange(this.editorView);
    } else {
      // No observer, or the binding is destroyed: nothing to notify.
    }
  }

  /**
   * @purpose Applies an incoming ProseMirror transaction to the view and, when it is a genuine user edit, forwards the resulting tree to the session.
   * @inputs tr - The ProseMirror Transaction to apply.
   * @outputs void.
   * @dataflow tr → editorView.state.apply → editorView.updateState → notifyStateChange → (if docChanged & !applyingFromSession) proseMirrorToMdast → session.applyTree.
   * @controlflow Apply and install the new state → notify observers → return early on selection-only changes → return early on session echoes → convert to mdast → read the kdocStructural meta → applyTree.
   */
  private handleTransaction(tr: Transaction): void {
    // Always apply the transaction to the view first, so typing stays responsive regardless of what the session decides.
    const next = this.editorView.state.apply(tr);
    this.editorView.updateState(next);
    this.notifyStateChange();

    // Guard 1 — selection-only transactions.
    // Check if the document content actually changed.
    // Moving the caret is not an edit: forwarding it would create empty undo entries and mark the document dirty for doing nothing.
    if (!tr.docChanged) {
      // Selection or mark change only: return immediately.
      return;
    } else {
      // Document content changed: proceed to session synchronization.
    }

    // Guard 2 — the loop guard.
    // Check if this transaction is the binding writing the session's own change back into the view.
    // This transaction is the binding writing the session's own change back into the view, and forwarding it would bounce straight back to the session as a fresh edit — an infinite loop in the obvious case and a corrupted undo history in the subtle one.
    if (this.applyingFromSession) {
      // Transaction is an internal echo from session synchronization: return immediately.
      return;
    } else {
      // Transaction originated from user edit: forward to authoritative session.
    }

    // Convert the updated ProseMirror document to an mdast syntax tree.
    const root = proseMirrorToMdast(next.doc);

    // Check if the transaction carries the kdocStructural metadata flag.
    // A transaction tagged with the kdocStructural meta opts out of coalescing so that structural commands (insert table, move block) stay individually undoable.
    let coalesce = true;
    if (tr.getMeta('kdocStructural') === true) {
      // Structural transaction: disable coalescing in edit history.
      coalesce = false;
    } else {
      // Standard transaction: allow coalescing runs in edit history.
      coalesce = true;
    }

    try {
      this.session.applyTree(root, { coalesce, originId: this.originId });
    } catch (caught: unknown) {
      // Resynchronise the view from the session, because the session is authoritative and a rejected edit means the view is now showing something the document does not contain.
      // Recovering the view before reporting matters: throwing out of dispatchTransaction while leaving the view ahead of the session is how an editor ends up silently editing a document that no longer exists.
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
   * @purpose Handles session change notifications, filtering out edit echoes and focus events, and syncing the view on undo, redo, or reset.
   * @inputs change - The SessionChange notification object emitted by DocumentSession.
   * @outputs void.
   * @dataflow change.reason inspection → syncFromSession() on restorative changes.
   * @controlflow Check change.reason for 'undo' | 'redo' | 'reset' → return early if other reason → call this.syncFromSession().
   */
  private handleSessionChange(change: SessionChange): void {
    // Determine whether this session change must be synchronized into the ProseMirror view:
    // - An 'edit' arriving while THIS pane holds the lock is this binding's own echo. Re-rendering it would destroy the user's selection mid-typing, which is why it is ignored.
    // - An 'edit' arriving while the OTHER pane holds the lock is a change this pane has not seen and must show.
    // - The focused pane is a reliable origin signal precisely because the session refuses edits from a pane that does not hold the lock (FR-3.1), so whoever holds the lock is necessarily whoever made the edit.
    // - A 'focus' reason changes no text and is ignored.
    // Check if the change is a restorative action (undo, redo, reset) or an edit made by the other pane.
    if (
      change.reason === 'undo' ||
      change.reason === 'redo' ||
      change.reason === 'reset' ||
      change.reason === 'external' ||
      // An edit this view did not apply. Comparing identities rather than panes is what lets a second
      // K-Doc view exist: against the pane, both views conclude the edit was their own and neither
      // updates. An edit with no identity was applied by something that is not a view at all, so it is
      // taken as someone else's.
      (change.reason === 'edit' && change.originId !== this.originId)
    ) {
      // Reason is 'undo', 'redo', 'reset', or an edit from the other pane: resynchronize view with session state.
      this.syncFromSession();
    } else {
      // Edit echo from this pane or focus transition: return without action.
      return;
    }
  }

  /**
   * @purpose Re-synchronizes the ProseMirror EditorView state with the authoritative DocumentSession snapshot, preserving caret position.
   * @inputs void.
   * @outputs void.
   * @dataflow session snapshot root → mdastToProseMirror → PM doc + clamped TextSelection → EditorState.create → editorView.updateState.
   * @controlflow Set applyingFromSession = true → try convert root to doc, compute clamped caret selection, create EditorState and update view → finally restore applyingFromSession = false.
   */
  private syncFromSession(): void {
    // Set applyingFromSession = true to guard against echo transactions while writing to the view.
    this.applyingFromSession = true;
    try {
      // Build a fresh ProseMirror document from the authoritative session AST root.
      const doc = mdastToProseMirror(this.session.snapshot.document.root, this.schema);

      // Preserve the caret position as well as possible within the new document boundaries.
      const pos = this.editorView.state.selection.from;
      const clamped = Math.min(pos, doc.content.size);

      // Exact selection restoration across a document replacement is not attempted,
      // because the two documents may have no structural relationship after an undo;
      // keeping the caret near where it was is the honest best effort.
      const selection = TextSelection.near(doc.resolve(clamped));

      const state = EditorState.create({
        doc,
        schema: this.schema,
        plugins: [...this.plugins],
        selection,
      });

      this.editorView.updateState(state);
      this.notifyStateChange();
    } finally {
      // Restore applyingFromSession guard in finally block so an exception cannot leave the guard stuck on.
      // A stuck guard would silently stop every future edit reaching the session, which is far worse than the original failure.
      this.applyingFromSession = false;
    }
  }
}
