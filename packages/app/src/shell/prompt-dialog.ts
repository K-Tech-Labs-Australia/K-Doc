/**
 * @file prompt-dialog.ts
 * @purpose Implements PromptDialog, an accessible modal dialog using the native HTMLDialogElement for single-line text input (FR-6.1). Rename operations require a new name, and window.prompt is not available in a Tauri webview and would not be themed if it were.
 * @inputs PromptDialogOptions containing the Document context.
 * @outputs PromptDialog controller instance exposing ask and destroy lifecycle methods, alongside PROMPT_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installPromptDialog: Constructs, styles, and mounts the native prompt dialog element, binds input validation and lifecycle controls, and returns the PromptDialog controller.
 * @dataflow Dialog ask(title, label, initial) -> text input population & selection -> user input -> OK (trimmed text) / Cancel / Escape (null) -> settle -> Promise resolution.
 * @controlflow Mount native dialog to document body -> configure dialog role, heading, input, and action buttons -> wire input events, keydown, click, and cancel handlers -> return PromptDialog controller with ask and destroy methods.
 * @version 3
 * @date 2026-10-04
 */

export interface PromptDialogOptions {
  readonly doc: Document;
}

export interface PromptDialog {
  /**
   * Opens the dialog with `initial` pre-filled and selected, resolving the entered text or null when
   * the user cancels.
   */
  ask(title: string, label: string, initial: string): Promise<string | null>;
  destroy(): void;
}

/**
 * Static stylesheet for the prompt modal dialog, styling the dialog backdrop, container,
 * heading, text input field, label, and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const PROMPT_DIALOG_STYLES: string = `
dialog.kdoc-prompt-dialog {
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

dialog.kdoc-prompt-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-prompt-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-prompt-heading {
  margin: 0 0 4px 0;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kdoc-prompt-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kdoc-prompt-input {
  min-height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  padding: 6px 10px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
  box-shadow: none;
}

.kdoc-prompt-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
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

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-prompt-dialog,
  dialog.kdoc-prompt-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple prompt dialog instances. */
let nextPromptDialogId = 0;

/**
 * Installs the modal prompt dialog into the document body, wiring input validation, actions, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for single-line text input with OK and Cancel choices.
 * @inputs options - PromptDialogOptions containing the document context.
 * @outputs PromptDialog - Controller exposing ask and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> input change / button click / keyboard events -> Promise resolution with trimmed string or null.
 * @controlflow Create dialog DOM hierarchy -> configure dialog role and aria attributes -> bind input, button, and cancel handlers -> append dialog to document body -> return PromptDialog controller.
 */
export function installPromptDialog(options: PromptDialogOptions): PromptDialog {
  const doc = options.doc;
  const dialogId = ++nextPromptDialogId;
  const titleId = `kdoc-prompt-title-${dialogId}`;
  const inputId = `kdoc-prompt-input-${dialogId}`;

  let destroyed = false;
  let settled = true;

  /** Module-scoped per-instance holder avoiding bare let closure narrowing under strict control-flow analysis. */
  const pendingHolder: { resolve: ((val: string | null) => void) | null } = {
    resolve: null,
  };

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-prompt-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-prompt-dialog-content';

  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'kdoc-prompt-heading';
  content.appendChild(heading);

  const field = doc.createElement('div');
  field.className = 'kdoc-prompt-field';

  const labelEl = doc.createElement('label');
  labelEl.htmlFor = inputId;
  labelEl.className = 'kdoc-prompt-label';
  field.appendChild(labelEl);

  const input = doc.createElement('input');
  input.id = inputId;
  input.type = 'text';
  input.className = 'kdoc-prompt-input';
  field.appendChild(input);

  content.appendChild(field);

  // Construct dialog action buttons (OK and Cancel).
  const actions = doc.createElement('div');
  actions.className = 'kdoc-prompt-actions';

  const okButton = doc.createElement('button');
  okButton.type = 'button';
  okButton.textContent = 'OK';
  okButton.className = 'kdoc-dialog-button kdoc-dialog-button-primary';
  okButton.setAttribute('aria-label', 'OK');
  actions.appendChild(okButton);

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary';
  cancelButton.setAttribute('aria-label', 'Cancel');
  actions.appendChild(cancelButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the prompt modal dialog if currently open.
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
   * Closes the dialog and resolves any pending promise with the resulting value once only.
   *
   * @purpose Closes the dialog before resolving the pending promise to ensure host focus calls are not overwritten by native dialog focus restoration.
   * @inputs value - The trimmed text string on confirmation, or null on cancellation.
   * @outputs void.
   * @dataflow value -> closeDialog() -> pendingHolder.resolve(value) -> clear pendingHolder.
   * @controlflow Close dialog -> check settled guard (return if true) -> mark settled = true -> extract and clear resolver -> invoke resolve with value.
   */
  function settle(value: string | null): void {
    // Close BEFORE notifying the host, not after. A native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so closing afterwards silently undoes any focus the host sets
    // in its resolution path. The host's focus call has to be the last thing that runs.
    closeDialog();

    // Check if this ask session has already settled.
    // Resolving must be once-only: guard with a settled flag so a Cancel arriving after an OK cannot resolve twice.
    if (settled) {
      // Already settled: ignore subsequent resolution attempts.
      return;
    } else {
      // Mark settled to prevent duplicate resolution.
      settled = true;
    }

    // Check if there is an active pending promise to resolve.
    if (pendingHolder.resolve !== null) {
      // Extract and clear the pending resolver before invocation.
      const resolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      resolve(value);
    } else {
      // No pending promise to resolve.
    }
  }

  // OK is disabled while the input is blank, updated on input.
  // A rename to an empty name is not a rename.
  input.addEventListener('input', (): void => {
    // Check whether the trimmed input value is blank.
    if (input.value.trim().length === 0) {
      // Input is blank: disable OK button.
      okButton.disabled = true;
    } else {
      // Input has non-blank content: enable OK button.
      okButton.disabled = false;
    }
  });

  // Handle Enter key on input to confirm if input is non-blank.
  input.addEventListener('keydown', (event: KeyboardEvent): void => {
    // Check if the Enter key was pressed.
    if (event.key === 'Enter') {
      event.preventDefault();
      // Check whether the trimmed input value is non-blank.
      if (input.value.trim().length > 0) {
        // Input has non-blank content: settle with trimmed value.
        settle(input.value.trim());
      } else {
        // Input is blank: rename to an empty name is not a rename; ignore Enter.
      }
    } else {
      // Non-Enter key: allow standard event handling.
    }
  });

  // Wire OK button click.
  okButton.addEventListener('click', (): void => {
    // Check whether the trimmed input value is non-blank.
    if (input.value.trim().length > 0) {
      // Input has non-blank content: settle with trimmed value.
      settle(input.value.trim());
    } else {
      // Input is blank: do not resolve.
    }
  });

  // Wire Cancel button click.
  cancelButton.addEventListener('click', (): void => {
    // User cancelled: settle with null.
    settle(null);
  });

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    // Escape key fires the native dialog cancel event rather than a click.
    event.preventDefault();
    settle(null);
  });

  /**
   * Opens the prompt dialog with initial pre-filled and selected, resolving the entered text or null when cancelled.
   *
   * @purpose Displays the modal prompt dialog, populates heading and input text, selects input text, and resolves on choice.
   * @inputs
   *   - title: string - The dialog title text.
   *   - label: string - The input field label text.
   *   - initial: string - Pre-filled initial input string.
   * @outputs Promise<string | null> - Resolves to trimmed string if confirmed, or null if cancelled.
   * @dataflow title/label/initial -> DOM updates -> showModal() -> input.select() -> Promise<string | null>.
   * @controlflow Populate heading, label, and input -> update OK disabled state -> check destroyed guard -> cancel existing pending promise -> reset settled flag -> open dialog -> focus and select input -> return new Promise.
   */
  function ask(title: string, label: string, initial: string): Promise<string | null> {
    heading.textContent = title;
    labelEl.textContent = label;
    input.value = initial;

    // OK is disabled while the input is blank, updated on input.
    // A rename to an empty name is not a rename.
    if (initial.trim().length === 0) {
      // Initial value is blank: disable OK button.
      okButton.disabled = true;
    } else {
      // Initial value is non-blank: enable OK button.
      okButton.disabled = false;
    }

    // Check if the prompt dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: resolve with null immediately.
      return Promise.resolve(null);
    } else {
      // Component is active: proceed with asking.
    }

    // Check if a prior ask invocation is currently pending resolution.
    if (pendingHolder.resolve !== null) {
      // A second ask while one is pending must not strand the first promise.
      const previousResolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      previousResolve(null);
    } else {
      // No outstanding promise pending.
    }

    // Reset the settled flag for the new ask cycle.
    settled = false;

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

    // Focus the input element.
    input.focus();
    // A rename almost always keeps the extension, so selecting the whole name lets the user type a new one or click once to keep part of it.
    input.select();

    return new Promise<string | null>((resolve): void => {
      pendingHolder.resolve = resolve;
    });
  }

  /**
   * Destroys the prompt dialog component, canceling any pending promise and removing the dialog DOM node.
   *
   * @purpose Idempotently cleans up the dialog component, resolves outstanding promises with null, and removes the DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow mark destroyed = true -> settle(null) -> dialog.remove().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> settle with null -> remove dialog from DOM.
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

    settle(null);
    dialog.remove();
  }

  return {
    ask,
    destroy,
  };
}
