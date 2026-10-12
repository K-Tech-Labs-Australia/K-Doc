/**
 * @file confirm-dialog.ts
 * @purpose Implements ConfirmDialog, an accessible three-way modal dialog using the native HTMLDialogElement offering Save, Discard, and Cancel choices for unsaved changes (FR-6.5). The file menu currently guards unsaved work with window.confirm, and a two-way confirm cannot express "save first". The user is forced to choose between losing work and abandoning the action they asked for, and there is no way to say the thing they almost always mean. That is a real gap, not a cosmetic one.
 * @inputs ConfirmDialogOptions containing the Document context.
 * @outputs ConfirmDialog controller instance exposing ask and destroy lifecycle methods, alongside CONFIRM_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installConfirmDialog: Constructs and mounts the native confirm dialog element, wires button actions and keyboard handlers, and returns the ConfirmDialog controller.
 * @dataflow Dialog ask(message) -> message text update -> showModal() -> user choice (Save / Discard / Cancel / Escape / destroy) -> closeDialog() -> Promise resolution with ConfirmChoice.
 * @controlflow Mount native dialog to document body -> configure alertdialog role, heading, message, and action buttons -> bind click and cancel handlers -> return ConfirmDialog controller with ask and destroy methods.
 * @version 4
 * @date 2026-10-04
 */

export type ConfirmChoice = 'save' | 'discard' | 'cancel';

/**
 * Overrides for the dialog's heading and the three button captions.
 *
 * The three *choices* are the same everywhere — do the thing, throw the work away, back out — but the
 * words for them are not. Crash recovery asks "Restore / Discard / Not now", which is the same shape as
 * "Save / Discard / Cancel" and a completely different sentence. Reusing the dialog with the wrong
 * captions would be worse than having two dialogs.
 */
export interface ConfirmLabels {
  readonly heading?: string;
  readonly confirm?: string;
  /** Null leaves the middle button out, for a question with only two answers (FR-6.11's delete). */
  readonly discard?: string | null;
  readonly cancel?: string;
}

export interface ConfirmDialogOptions {
  readonly doc: Document;
}

export interface ConfirmDialog {
  /** Opens the dialog and resolves with the user's choice. */
  ask(message: string, labels?: ConfirmLabels): Promise<ConfirmChoice>;
  destroy(): void;
}

/**
 * Static stylesheet for the confirm modal dialog, styling the dialog backdrop, container,
 * heading, message, and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const CONFIRM_DIALOG_STYLES: string = `
dialog.kdoc-confirm-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 440px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-confirm-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-confirm-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-dialog-heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.kdoc-dialog-button {
  min-width: 64px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-dialog-button:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
}

.kdoc-dialog-button.kdoc-dialog-button-primary,
.kdoc-dialog-button.kdoc-dialog-button-save,
.kdoc-dialog-button.kdoc-dialog-apply {
  border-color: var(--kdoc-chrome-accent);
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
}

.kdoc-dialog-button.kdoc-dialog-button-primary:hover,
.kdoc-dialog-button.kdoc-dialog-button-save:hover,
.kdoc-dialog-button.kdoc-dialog-apply:hover,
.kdoc-dialog-button.kdoc-dialog-button-primary:active,
.kdoc-dialog-button.kdoc-dialog-button-save:active,
.kdoc-dialog-button.kdoc-dialog-apply:active {
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 88%, var(--kdoc-chrome-text));
}

.kdoc-dialog-button.kdoc-dialog-button-primary:disabled,
.kdoc-dialog-button.kdoc-dialog-apply:disabled {
  border-color: var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-button.kdoc-dialog-button-discard {
  color: var(--kdoc-emissive-red);
}

.kdoc-confirm-dialog-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kdoc-chrome-text);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-confirm-dialog,
  dialog.kdoc-confirm-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple confirm dialog instances. */
let nextConfirmDialogId = 0;

/**
 * Installs the modal confirm dialog into the document body, wiring button actions and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal alertdialog element for prompting three-way unsaved changes choices (Save / Discard / Cancel).
 * @inputs options - ConfirmDialogOptions containing the document context.
 * @outputs ConfirmDialog - Controller exposing ask and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> button click / keyboard events -> Promise resolution with ConfirmChoice.
 * @controlflow Create dialog DOM hierarchy -> configure alertdialog role and aria attributes -> bind button and escape handlers -> append dialog to document body -> return ConfirmDialog controller.
 */
export function installConfirmDialog(options: ConfirmDialogOptions): ConfirmDialog {
  const doc = options.doc;
  const dialogId = ++nextConfirmDialogId;
  const titleId = `kdoc-confirm-title-${dialogId}`;
  const messageId = `kdoc-confirm-message-${dialogId}`;

  let destroyed = false;

  /** Module-scoped per-instance holder avoiding bare let closure narrowing under strict control-flow analysis. */
  const pendingHolder: { resolve: ((choice: ConfirmChoice) => void) | null } = {
    resolve: null,
  };

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-confirm-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('aria-describedby', messageId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-confirm-dialog-content';

  const heading = doc.createElement('h3');
  heading.id = titleId;
  heading.className = 'kdoc-dialog-heading';
  heading.textContent = 'Save Changes?';
  content.appendChild(heading);

  const messageEl = doc.createElement('p');
  messageEl.id = messageId;
  messageEl.className = 'kdoc-confirm-dialog-message';
  content.appendChild(messageEl);

  // Construct dialog action buttons (Save, Discard, Cancel in order).
  const actions = doc.createElement('div');
  actions.className = 'kdoc-dialog-actions';

  const saveButton = doc.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Save';
  saveButton.className = 'kdoc-dialog-button kdoc-dialog-button-save';
  saveButton.setAttribute('aria-label', 'Save changes');
  saveButton.addEventListener('click', (): void => {
    settle('save');
  });
  actions.appendChild(saveButton);

  const discardButton = doc.createElement('button');
  discardButton.type = 'button';
  discardButton.textContent = 'Discard';
  discardButton.className = 'kdoc-dialog-button kdoc-dialog-button-discard';
  discardButton.setAttribute('aria-label', 'Discard changes');
  discardButton.addEventListener('click', (): void => {
    settle('discard');
  });
  actions.appendChild(discardButton);

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-button-cancel';
  cancelButton.setAttribute('aria-label', 'Cancel');
  cancelButton.addEventListener('click', (): void => {
    settle('cancel');
  });
  actions.appendChild(cancelButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    settle('cancel');
  });

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the confirm modal dialog if currently open.
   *
   * @purpose Dismisses the modal dialog in an idempotent manner across native and test environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check if dialog is currently open -> invoke native close() or set open = false -> return.
   */
  function closeDialog(): void {
    // Check if the dialog element is currently open.
    if (dialog.open) {
      // Check if the native close() method is supported.
      if (typeof dialog.close === 'function') {
        // Close via native HTMLDialogElement API.
        dialog.close();
      } else {
        // Fallback for test environments: set open attribute to false.
        dialog.open = false;
      }
    } else {
      // Dialog is already closed: no operation required.
    }
  }

  /**
   * Closes the dialog and resolves any pending promise with the user's choice.
   *
   * @purpose Closes the dialog before resolving the pending promise to ensure host focus calls are not overwritten by native dialog focus restoration.
   * @inputs choice - The ConfirmChoice ('save' | 'discard' | 'cancel') to resolve the pending promise with.
   * @outputs void.
   * @dataflow choice -> closeDialog() -> pendingHolder.resolve(choice) -> clear pendingHolder.
   * @controlflow Close dialog -> check if pendingHolder.resolve is non-null -> extract and clear resolve function -> invoke resolve with choice.
   */
  function settle(choice: ConfirmChoice): void {
    // Close BEFORE notifying the host, not after. A native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so closing afterwards silently undoes any focus the host sets
    // in its resolution path. The host's focus call has to be the last thing that runs.
    closeDialog();

    // Check if there is an active pending promise to resolve.
    if (pendingHolder.resolve !== null) {
      // Extract and clear the pending resolver before invocation.
      const resolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      resolve(choice);
    } else {
      // No pending promise to resolve.
    }
  }

  /**
   * Opens the confirm dialog with the specified message and returns a Promise resolving with the user's choice.
   *
   * @purpose Displays the three-way confirm dialog, sets the message text, focuses the Save button, and resolves when a choice is made.
   * @inputs message - The unsaved changes explanation message to display to the user.
   * @outputs Promise<ConfirmChoice> - A Promise resolving to 'save', 'discard', or 'cancel'.
   * @dataflow message -> messageEl.textContent -> showModal() -> saveButton.focus() -> Promise<ConfirmChoice>.
   * @controlflow Check destroyed guard -> cancel any existing pending promise -> update message text -> open dialog via showModal or open fallback -> focus Save button -> return new Promise.
   */
  function ask(message: string, labels?: ConfirmLabels): Promise<ConfirmChoice> {
    // Captions are reset on every ask, not just when labels are supplied: a dialog that kept the words
    // from its previous caller would eventually ask about unsaved changes using the recovery wording.
    heading.textContent = labels?.heading ?? 'Save Changes?';
    saveButton.textContent = labels?.confirm ?? 'Save';
    saveButton.setAttribute('aria-label', labels?.confirm ?? 'Save changes');
    discardButton.textContent = labels?.discard ?? 'Discard';
    discardButton.setAttribute('aria-label', labels?.discard ?? 'Discard changes');
    // Reset on every ask like the captions, so a two-answer question never hides the button from the next caller.
    discardButton.hidden = labels?.discard === null;
    cancelButton.textContent = labels?.cancel ?? 'Cancel';
    cancelButton.setAttribute('aria-label', labels?.cancel ?? 'Cancel');

    // Check if the confirm dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: resolve with 'cancel' immediately.
      return Promise.resolve('cancel');
    } else {
      // Component is active: proceed with asking.
    }

    // Check if a prior ask invocation is currently pending resolution.
    if (pendingHolder.resolve !== null) {
      // A second ask while one is pending must not strand the first promise.
      // An unresolved promise here means an await in the file menu that never returns,
      // so the app quietly stops responding to Open. Resolve the outstanding promise with 'cancel'.
      const previousResolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      previousResolve('cancel');
    } else {
      // No outstanding promise pending.
    }

    messageEl.textContent = message;

    // Check if the dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog is already open: skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Focus Save button by default as the safe primary action.
    saveButton.focus();

    return new Promise<ConfirmChoice>((resolve): void => {
      pendingHolder.resolve = resolve;
    });
  }

  /**
   * Destroys the confirm dialog component, canceling any pending promise and removing the dialog DOM node.
   *
   * @purpose Idempotently cleans up the dialog component, resolves outstanding promises with 'cancel', and removes the DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow mark destroyed = true -> settle('cancel') -> dialog.remove().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> settle with 'cancel' -> remove dialog from DOM.
   */
  function destroy(): void {
    // Check if the dialog has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active dialog: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    settle('cancel');
    dialog.remove();
  }

  return {
    ask,
    destroy,
  };
}
