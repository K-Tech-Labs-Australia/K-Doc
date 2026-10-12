/**
 * @file image-dialog.ts
 * @purpose Implements ImageDialog, an accessible modal dialog using the native HTMLDialogElement for inserting and editing Markdown images with source URL, alternative text, and optional title fields.
 * @inputs ImageDialogOptions containing the Document context, onSubmit callback, and optional native file picker.
 * @outputs ImageDialog controller instance exposing open, close, isOpen, and destroy lifecycle methods, alongside IMAGE_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installImageDialog: Constructs and mounts the native dialog element, wires form inputs, validation, file picking, and lifecycle controls, and returns the ImageDialog controller.
 * @dataflow Dialog open(current) -> form input population -> user input & file pick -> validation -> onSubmit callback -> dialog close().
 * @controlflow Mount native dialog to document body -> configure form with Source/Alt/Title fields and optional choose-file button -> bind submit/cancel/pick/input handlers via AbortController signal -> return ImageDialog controller.
 * @version 4
 * @date 2026-10-04
 */

/**
 * Static stylesheet for the image modal dialog, styling the dialog backdrop, inputs, labels, alt-text hint,
 * inline validation (via a disabled submit button), and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const IMAGE_DIALOG_STYLES: string = `
dialog.kdoc-image-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 460px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-image-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-image-dialog-form {
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

.kdoc-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Source field lays its input and the "Choose file…" button side by side. */

.kdoc-image-source-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.kdoc-image-source-row .kdoc-dialog-input {
  flex: 1 1 auto;
}

.kdoc-dialog-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-hint {
  font-size: 11px;
  line-height: 1.35;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-input {
  min-height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
}

.kdoc-dialog-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

/* A disabled submit button must stay visually distinct from an enabled one. */

/* An explicit display declaration on a class selector outranks the user agent's bare [hidden] rule, so
   restating display: none here at higher specificity is what makes hidden mean hidden inside this dialog. */

.kdoc-image-dialog [hidden] {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-image-dialog,
  dialog.kdoc-image-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * The image the dialog reports back.
 *
 * `alt` and `title` are `string | null` rather than `string` because mdast distinguishes an absent title
 * from an empty one, and the serializer emits the two differently. The dialog never sends `''`.
 */
export interface ImageDialogValue {
  readonly src: string;
  readonly alt: string | null;
  readonly title: string | null;
}

export interface ImageDialogOptions {
  readonly doc: Document;
  readonly onSubmit: (value: ImageDialogValue) => void;
  /**
   * Opens a native file picker and resolves to a path or URL, or null when cancelled.
   *
   * Optional because there is no native picker in the browser dev harness. When it is absent the
   * "Choose file..." button is not rendered at all, rather than rendered disabled.
   */
  readonly pickFile?: () => Promise<string | null>;
}

export interface ImageDialog {
  open(current: ImageDialogValue | null): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple dialog instances. */
let nextDialogId = 0;

/**
 * Installs the modal image dialog into the document body, wiring form validation and submission callbacks.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for configuring Markdown image source, alt text, and title attributes.
 * @inputs options - ImageDialogOptions containing the document context, onSubmit callback, and optional file picker.
 * @outputs ImageDialog - Controller exposing open, close, isOpen, and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> form input & pick events -> onSubmit callback invocation.
 * @controlflow Create dialog and form hierarchy -> bind submission, cancellation, picking, and input events via an AbortController signal -> append dialog to document body -> return ImageDialog controller.
 */
export function installImageDialog(options: ImageDialogOptions): ImageDialog {
  const doc = options.doc;
  const dialogId = ++nextDialogId;
  const sourceId = `kdoc-image-source-${dialogId}`;
  const altId = `kdoc-image-alt-${dialogId}`;
  const titleId = `kdoc-image-title-${dialogId}`;

  let destroyed = false;
  let openState = false;

  // Single AbortController owns every listener so destroy() can detach them all at once via { signal }.
  const controller = new AbortController();
  const { signal } = controller;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-image-dialog';

  // Construct form container with novalidate to allow custom validation via the disabled submit button.
  const form = doc.createElement('form');
  form.className = 'kdoc-image-dialog-form';
  form.setAttribute('novalidate', 'true');

  // Heading text is set on open: "Insert Image" for a new image, "Edit Image" when editing an existing one.
  const heading = doc.createElement('h3');
  heading.className = 'kdoc-dialog-heading';
  heading.textContent = 'Insert Image';
  form.appendChild(heading);

  // Field 1: Source (required). Laid out with a "Choose file…" button beside the input when a picker exists.
  const sourceField = doc.createElement('div');
  sourceField.className = 'kdoc-dialog-field';

  const sourceLabel = doc.createElement('label');
  sourceLabel.htmlFor = sourceId;
  sourceLabel.textContent = 'Source';
  sourceField.appendChild(sourceLabel);

  const sourceRow = doc.createElement('div');
  sourceRow.className = 'kdoc-image-source-row';
  sourceField.appendChild(sourceRow);

  const sourceInput = doc.createElement('input');
  sourceInput.id = sourceId;
  sourceInput.type = 'text';
  sourceInput.className = 'kdoc-dialog-input';
  // Marked required for native semantics/a11y; live submission is additionally gated by the disabled button.
  sourceInput.required = true;
  sourceInput.setAttribute('autocomplete', 'off');
  sourceInput.setAttribute('spellcheck', 'false');
  sourceRow.appendChild(sourceInput);

  // The choose-file button is rendered only when options.pickFile is supplied. It is absent (not disabled) when
  // there is no picker, because a file picker that cannot open is worse than no button at all — and this is what
  // keeps the dialog usable in the browser dev harness, where there is no native dialog.
  const pickFile = options.pickFile;
  if (pickFile !== undefined) {
    const pickButton = doc.createElement('button');
    pickButton.type = 'button';
    pickButton.textContent = 'Choose file…';
    pickButton.className = 'kdoc-dialog-button kdoc-dialog-cancel';
    pickButton.addEventListener('click', (): void => {
      // Guard against a click that outlives destroy(); the aborted signal already detached this listener.
      if (destroyed) {
        // Component destroyed: ignore stray click.
        return;
      } else {
        // Active dialog: proceed to launch the native picker.
      }

      // Await the native picker; a cancelled or failed pick must NOT close the dialog the user is still filling in.
      // Captured above rather than read through `options` here: the narrowing does not survive into the
      // callback, and re-reading a field that could in principle change is not what this button means.
      pickFile()
        .then((picked: string | null): void => {
          if (destroyed) {
            // Destroyed during the async round trip: do not touch DOM state.
            return;
          } else if (picked !== null) {
            // Picked a path/URL: write it into Source and re-run the enable check so Insert/Save becomes active.
            sourceInput.value = picked;
            updateSubmitEnabled();
          } else {
            // User cancelled: leave Source untouched.
          }
        })
        .catch((): void => {
          // Picker rejected or threw: swallow so the dialog stays open for continued editing.
        });
    }, { signal });
    sourceRow.appendChild(pickButton);
  }

  form.appendChild(sourceField);

  // Field 2: Alt text (recommended). Hint explains screen-reader and fallback-visibility behaviour.
  const altField = doc.createElement('div');
  altField.className = 'kdoc-dialog-field';

  const altLabel = doc.createElement('label');
  altLabel.htmlFor = altId;
  altLabel.textContent = 'Alt text';
  altField.appendChild(altLabel);

  const altInput = doc.createElement('input');
  altInput.id = altId;
  altInput.type = 'text';
  altInput.className = 'kdoc-dialog-input';
  altInput.setAttribute('autocomplete', 'off');
  altInput.setAttribute('spellcheck', 'false');
  altField.appendChild(altInput);

  const altHint = doc.createElement('div');
  altHint.className = 'kdoc-dialog-hint';
  altHint.textContent = 'Read aloud by screen readers and shown when the image cannot load.';
  altField.appendChild(altHint);

  form.appendChild(altField);

  // Field 3: Caption (optional). Stored in the CommonMark title slot and shown under the image (FR-8.15).
  const titleField = doc.createElement('div');
  titleField.className = 'kdoc-dialog-field';

  const titleLabel = doc.createElement('label');
  titleLabel.htmlFor = titleId;
  titleLabel.textContent = 'Caption (optional)';
  titleField.appendChild(titleLabel);

  const titleInput = doc.createElement('input');
  titleInput.id = titleId;
  titleInput.type = 'text';
  titleInput.className = 'kdoc-dialog-input';
  titleInput.setAttribute('autocomplete', 'off');
  titleInput.setAttribute('spellcheck', 'false');
  titleField.appendChild(titleInput);

  form.appendChild(titleField);

  // Form action buttons (Insert/Save and Cancel).
  const actions = doc.createElement('div');
  actions.className = 'kdoc-dialog-actions';

  // Submit label follows the same rule as the heading: "Insert" for a new image, "Save" when editing.
  const submitButton = doc.createElement('button');
  submitButton.type = 'submit';
  submitButton.textContent = 'Insert';
  submitButton.className = 'kdoc-dialog-button kdoc-dialog-apply';
  actions.appendChild(submitButton);

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-cancel';
  cancelButton.addEventListener('click', (): void => {
    close();
  }, { signal });
  actions.appendChild(cancelButton);

  form.appendChild(actions);
  dialog.appendChild(form);

  // Re-run the submit-enable check whenever the user edits Source, so Insert/Save enables/disables live.
  sourceInput.addEventListener('input', (): void => {
    updateSubmitEnabled();
  }, { signal });

  // Handle native Escape key dismiss event (fires on the dialog's cancel event). Route through close() so there is
  // a single teardown path regardless of whether Escape or a programmatic close triggered it.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    close();
  }, { signal });

  // Handle form submission from the Insert/Save button click or Enter in any text field. The submit button carries
  // type="submit" and is enabled only while Source is non-empty, so pressing Enter in any text field triggers the
  // browser's default form submission exactly when allowed; with the button disabled (empty source) the browser
  // performs no submission at all.
  form.addEventListener('submit', (event: SubmitEvent | Event): void => {
    event.preventDefault();

    const trimmedSource = sourceInput.value.trim();
    // An image with no source renders as a broken icon, so refuse rather than letting the command silently decline.
    if (trimmedSource === '') {
      // Empty or whitespace-only source: do not submit; the button is already disabled to reflect this state.
      return;
    } else {
      // Non-empty source: proceed to build and dispatch the value.
    }

    const rawAlt = altInput.value.trim();
    let resolvedAlt: string | null;
    if (rawAlt === '') {
      // Empty alt text: resolve to null.
      resolvedAlt = null;
    } else {
      // Non-empty alt text: keep the trimmed string.
      resolvedAlt = rawAlt;
    }

    const rawTitle = titleInput.value.trim();
    let resolvedTitle: string | null;
    if (rawTitle === '') {
      // Empty title: resolve to null.
      resolvedTitle = null;
    } else {
      // Non-empty title: keep the trimmed string.
      resolvedTitle = rawTitle;
    }

    // mdast distinguishes an absent title from an empty one and the serializer emits them differently, so the dialog
    // must not send '' — absent fields resolve to null above rather than to an empty string.
    // Close BEFORE notifying the host for the same focus reason as link-dialog: a native <dialog> restores focus on
    // close, which would otherwise undo the host's own focus call made inside onSubmit. The host's focus call must be
    // the last thing that runs.
    close();

    options.onSubmit({
      src: trimmedSource,
      alt: resolvedAlt,
      title: resolvedTitle,
    });
  }, { signal });

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /** Toggles the submit button's disabled state from the current Source value (empty/whitespace => disabled). */
  function updateSubmitEnabled(): void {
    const trimmedSource = sourceInput.value.trim();
    if (trimmedSource === '') {
      // Empty or whitespace-only source: disable so neither Enter nor click can submit a broken image.
      submitButton.disabled = true;
    } else {
      // Non-empty source: enable submission.
      submitButton.disabled = false;
    }
  }

  /**
   * Opens the image dialog, populating inputs with existing image attributes or clearing them for a new image.
   *
   * @purpose Displays the modal dialog, initializes form fields, sets heading and submit label, shows modally, and focuses the Source field with its text selected.
   * @inputs current - Existing ImageDialogValue when editing an active image, or null if creating a new image.
   * @outputs void.
   * @dataflow current -> sourceInput/altInput/titleInput values + heading & submit label text -> showModal() -> sourceInput.focus() & sourceInput.select().
   * @controlflow Check destroyed guard -> set heading and submit label by edit-vs-new branch -> populate or clear fields -> run enable check -> invoke showModal with fallback -> set openState -> focus and select Source input.
   */
  function open(current: ImageDialogValue | null): void {
    // Check if the image dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: do not open.
      return;
    } else {
      // Component is active: proceed to open dialog.
    }

    // Heading and submit label follow the same rule: "Edit …" when editing, "Insert …" for a new image.
    if (current !== null) {
      // Editing an existing image: set Edit heading and Save submit label.
      heading.textContent = 'Edit Image';
      submitButton.textContent = 'Save';
    } else {
      // Creating a new image: set Insert heading and Insert submit label.
      heading.textContent = 'Insert Image';
      submitButton.textContent = 'Insert';
    }

    // Populate fields from current, or clear them for a new image.
    if (current !== null) {
      // Existing attributes provided: pre-fill Source, Alt, and Title (null alt/title fall back to empty strings).
      sourceInput.value = current.src;
      altInput.value = current.alt ?? '';
      titleInput.value = current.title ?? '';
    } else {
      // New image creation: initialize all fields with empty strings.
      sourceInput.value = '';
      altInput.value = '';
      titleInput.value = '';
    }

    // Reflect the initial Source state on the submit button before showing the dialog.
    updateSubmitEnabled();

    // Show as modal, with a fallback for environments lacking showModal (e.g. jsdom test harness).
    if (dialog.open) {
      // Dialog is already open: skip showModal to avoid an InvalidStateError.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback for non-modal or test environments lacking showModal.
      dialog.open = true;
    }

    // Record that the dialog is now open so isOpen reports accurate state to callers.
    openState = true;

    // Focus Source input and select all text to allow immediate replacement by typing over it.
    sourceInput.focus();
    sourceInput.select();
  }

  /**
   * Closes the image modal dialog, clearing open state in an idempotent manner.
   *
   * @purpose Dismisses the modal dialog and clears the open-state flag without touching form field values.
   * @inputs void.
   * @outputs void.
   * @dataflow sets openState = false -> dialog.close() / dialog.open = false.
   * @controlflow Check destroyed guard (return if true) -> set openState false -> check if dialog is currently open -> invoke native close() or set open = false.
   */
  function close(): void {
    // Check if the dialog has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    // Record that the dialog is no longer open before detaching focus via close().
    openState = false;

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
   * Destroys the image dialog component, closing the modal and removing the dialog DOM node.
   *
   * @purpose Idempotently cleans up event listeners (via AbortController) and removes the dialog element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow controller.abort() detaches all { signal } listeners -> close() -> dialog.remove().
   * @controlflow Check destroyed guard (return if true for idempotent teardown) -> mark destroyed = true -> abort controller -> close dialog -> remove dialog from DOM.
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

    // Abort the controller to detach every listener registered with { signal }, then close and remove the node.
    controller.abort();
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      return openState;
    },
    destroy,
  };
}
