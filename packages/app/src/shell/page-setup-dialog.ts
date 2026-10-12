/**
 * @file page-setup-dialog.ts
 * @purpose Implements PageSetupDialog, an accessible modal dialog using the native HTMLDialogElement for configuring print and PDF export page options including paper size, orientation, margins, running headers and footers, and table of contents generation (FR-13.2).
 * @inputs PageSetupDialogOptions containing the Document context, and PageSetup configuration objects passed to ask().
 * @outputs PageSetupDialog controller instance exposing ask and destroy lifecycle methods, alongside PAGE_SETUP_STYLES CSS stylesheet definition.
 * @functions
 *   - installPageSetupDialog: Constructs, styles, and mounts the native modal page setup dialog element into the document body, wires control inputs and actions, and returns the PageSetupDialog controller.
 * @dataflow Dialog ask(current) -> form control population -> user input/selection -> Print (resolved PageSetup) / Cancel / Escape (null) -> settle -> Promise resolution.
 * @controlflow Mount native dialog to document body -> configure dialog role, heading, form rows, hint, and action buttons -> wire submit, cancel, and click handlers -> return PageSetupDialog controller with ask and destroy methods.
 * @version 3
 * @date 2026-10-04
 */

import {
  MARGIN_MIN_MM,
  MARGIN_MAX_MM,
  type PageSetup,
  type PaperSize,
  type Orientation,
} from '../files/page-setup.js';

export interface PageSetupDialogOptions {
  readonly doc: Document;
}

export interface PageSetupDialog {
  /** Opens the dialog on `current`, resolving the edited setup or null when cancelled. */
  ask(current: PageSetup): Promise<PageSetup | null>;
  destroy(): void;
}

/**
 * Static stylesheet for the page setup modal dialog, styling the dialog backdrop, container,
 * heading, form rows, controls, hint text, and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const PAGE_SETUP_STYLES: string = `
dialog.kdoc-page-setup {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  min-width: 380px;
  max-width: 440px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

.kdoc-page-setup[hidden] {
  display: none;
}

dialog.kdoc-page-setup:not([open]) {
  display: none;
}

dialog.kdoc-page-setup::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-page-setup-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-page-setup-heading {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-page-setup-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-page-setup-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: center;
}

.kdoc-page-setup-row label {
  font-size: 13px;
  color: var(--kdoc-chrome-text);
}

.kdoc-page-setup select,
.kdoc-page-setup input[type="text"],
.kdoc-page-setup input[type="number"] {
  min-height: 28px;
  height: 28px;
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

.kdoc-page-setup input[type="checkbox"] {
  accent-color: var(--kdoc-chrome-accent);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-page-setup select:focus-visible,
.kdoc-page-setup input[type="text"]:focus-visible,
.kdoc-page-setup input[type="number"]:focus-visible,
.kdoc-page-setup input[type="checkbox"]:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-page-setup-margin-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kdoc-page-setup input.kdoc-page-setup-margin {
  width: 5em;
  font-variant-numeric: tabular-nums;
}

.kdoc-page-setup-unit {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-page-setup-hint {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  grid-column: 2;
  margin: 4px 0 0 128px;
  line-height: 1.4;
}

.kdoc-page-setup-actions {
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

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-page-setup,
  dialog.kdoc-page-setup * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple page setup dialog instances. */
let nextPageSetupDialogId = 0;

/**
 * Installs the modal page setup dialog into the document body, wiring controls, hints, actions, and lifecycle methods.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for configuring page layout, margins, running headers/footers, and TOC.
 * @inputs options - PageSetupDialogOptions containing the document context.
 * @outputs PageSetupDialog - Controller exposing ask and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> form inputs & action buttons -> Promise resolution with PageSetup or null.
 * @controlflow Create dialog DOM hierarchy -> configure dialog role and aria attributes -> bind submit, button click, and cancel handlers -> append dialog to document body -> return PageSetupDialog controller.
 */
export function installPageSetupDialog(options: PageSetupDialogOptions): PageSetupDialog {
  const doc = options.doc;
  const dialogId = ++nextPageSetupDialogId;
  const titleId = `kdoc-page-setup-title-${dialogId}`;
  const paperId = `kdoc-page-setup-paper-${dialogId}`;
  const orientationId = `kdoc-page-setup-orientation-${dialogId}`;
  const marginId = `kdoc-page-setup-margin-${dialogId}`;
  const headerId = `kdoc-page-setup-header-${dialogId}`;
  const footerId = `kdoc-page-setup-footer-${dialogId}`;
  const tocId = `kdoc-page-setup-toc-${dialogId}`;

  let destroyed = false;
  let settled = true;
  let activeSetup: PageSetup | null = null;

  /** Module-scoped per-instance holder avoiding bare let closure narrowing under strict control-flow analysis. */
  const pendingHolder: { resolve: ((val: PageSetup | null) => void) | null } = {
    resolve: null,
  };

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-page-setup';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-page-setup-content';

  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'kdoc-page-setup-heading';
  heading.textContent = 'Page Setup';
  content.appendChild(heading);

  // Construct form container for labelled rows.
  const form = doc.createElement('form');
  form.className = 'kdoc-page-setup-form';
  form.setAttribute('novalidate', 'true');

  // Row 1: Paper
  const paperRow = doc.createElement('div');
  paperRow.className = 'kdoc-page-setup-row';

  const paperLabel = doc.createElement('label');
  paperLabel.htmlFor = paperId;
  paperLabel.textContent = 'Paper';
  paperRow.appendChild(paperLabel);

  const paperSelect = doc.createElement('select');
  paperSelect.id = paperId;
  paperSelect.className = 'kdoc-page-setup-paper';

  const paperSizes: readonly PaperSize[] = ['A4', 'Letter', 'Legal', 'A3'];
  for (const size of paperSizes) {
    const option = doc.createElement('option');
    option.value = size;
    option.textContent = size;
    paperSelect.appendChild(option);
  }
  paperRow.appendChild(paperSelect);
  form.appendChild(paperRow);

  // Row 2: Orientation
  const orientationRow = doc.createElement('div');
  orientationRow.className = 'kdoc-page-setup-row';

  const orientationLabel = doc.createElement('label');
  orientationLabel.htmlFor = orientationId;
  orientationLabel.textContent = 'Orientation';
  orientationRow.appendChild(orientationLabel);

  const orientationSelect = doc.createElement('select');
  orientationSelect.id = orientationId;
  orientationSelect.className = 'kdoc-page-setup-orientation';

  const orientations: readonly { readonly value: Orientation; readonly text: string }[] = [
    { value: 'portrait', text: 'Portrait' },
    { value: 'landscape', text: 'Landscape' },
  ];
  for (const entry of orientations) {
    const option = doc.createElement('option');
    option.value = entry.value;
    option.textContent = entry.text;
    orientationSelect.appendChild(option);
  }
  orientationRow.appendChild(orientationSelect);
  form.appendChild(orientationRow);

  // Row 3: Margin
  const marginRow = doc.createElement('div');
  marginRow.className = 'kdoc-page-setup-row';

  const marginLabel = doc.createElement('label');
  marginLabel.htmlFor = marginId;
  marginLabel.textContent = 'Margin';
  marginRow.appendChild(marginLabel);

  const marginGroup = doc.createElement('div');
  marginGroup.className = 'kdoc-page-setup-margin-group';

  const marginInput = doc.createElement('input');
  marginInput.id = marginId;
  marginInput.type = 'number';
  marginInput.className = 'kdoc-page-setup-margin';
  marginInput.min = String(MARGIN_MIN_MM);
  marginInput.max = String(MARGIN_MAX_MM);
  marginInput.step = '1';
  marginGroup.appendChild(marginInput);

  const unitSpan = doc.createElement('span');
  unitSpan.className = 'kdoc-page-setup-unit';
  unitSpan.textContent = 'mm';
  marginGroup.appendChild(unitSpan);

  marginRow.appendChild(marginGroup);
  form.appendChild(marginRow);

  // Row 4: Header
  const headerRow = doc.createElement('div');
  headerRow.className = 'kdoc-page-setup-row';

  const headerLabel = doc.createElement('label');
  headerLabel.htmlFor = headerId;
  headerLabel.textContent = 'Header';
  headerRow.appendChild(headerLabel);

  const headerInput = doc.createElement('input');
  headerInput.id = headerId;
  headerInput.type = 'text';
  headerInput.className = 'kdoc-page-setup-header';
  headerRow.appendChild(headerInput);
  form.appendChild(headerRow);

  // Row 5: Footer
  const footerRow = doc.createElement('div');
  footerRow.className = 'kdoc-page-setup-row';

  const footerLabel = doc.createElement('label');
  footerLabel.htmlFor = footerId;
  footerLabel.textContent = 'Footer';
  footerRow.appendChild(footerLabel);

  const footerInput = doc.createElement('input');
  footerInput.id = footerId;
  footerInput.type = 'text';
  footerInput.className = 'kdoc-page-setup-footer';
  footerRow.appendChild(footerInput);
  form.appendChild(footerRow);

  // Shared hint for header and footer tokens.
  // The hint sits under both fields rather than being repeated, because the two
  // take the same tokens and saying it twice invites the reader to look for a difference.
  const hint = doc.createElement('p');
  hint.className = 'kdoc-page-setup-hint';
  hint.textContent = '{title}, {page} and {pages} are replaced when printing.';
  form.appendChild(hint);

  // Row 6: Contents page (Table of Contents checkbox)
  const tocRow = doc.createElement('div');
  tocRow.className = 'kdoc-page-setup-row';

  const tocLabel = doc.createElement('label');
  tocLabel.htmlFor = tocId;
  tocLabel.textContent = 'Include a table of contents';
  tocRow.appendChild(tocLabel);

  const tocInput = doc.createElement('input');
  tocInput.id = tocId;
  tocInput.type = 'checkbox';
  tocInput.className = 'kdoc-page-setup-toc';
  tocRow.appendChild(tocInput);
  form.appendChild(tocRow);

  content.appendChild(form);

  // Construct dialog action buttons (Print and Cancel).
  // The primary button is labelled Print rather than OK, because that is what accepting the dialog
  // actually does, and a button that says OK leaves the user unsure whether anything is about to happen.
  const actions = doc.createElement('div');
  actions.className = 'kdoc-page-setup-actions';

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary';
  cancelButton.setAttribute('aria-label', 'Cancel');
  actions.appendChild(cancelButton);

  const printButton = doc.createElement('button');
  printButton.type = 'button';
  printButton.textContent = 'Print';
  printButton.className = 'kdoc-dialog-button kdoc-dialog-button-primary';
  printButton.setAttribute('aria-label', 'Print');
  actions.appendChild(printButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the page setup modal dialog if currently open.
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
   * @inputs value - The edited PageSetup configuration on confirmation, or null on cancellation.
   * @outputs void.
   * @dataflow value -> closeDialog() -> pendingHolder.resolve(value) -> clear pendingHolder.
   * @controlflow Close dialog -> check settled guard (return if true) -> mark settled = true -> extract and clear resolver -> invoke resolve with value.
   */
  function settle(value: PageSetup | null): void {
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

  /**
   * Reads form control values, narrows paper and orientation types, clamps margin bounds, and settles with the new PageSetup.
   *
   * @purpose Reads current form control values back into a valid PageSetup configuration and resolves the dialog.
   * @inputs void.
   * @outputs void.
   * @dataflow Form control values -> narrowed PaperSize/Orientation + clamped margin -> PageSetup -> settle(setup).
   * @controlflow Read control values -> narrow paper with comparison chain -> narrow orientation with comparison chain -> parse and clamp margin -> assemble PageSetup -> settle(setup).
   */
  function handlePrint(): void {
    // Narrow paper size via explicit comparison chain against PaperSize union members.
    // A <select> the code built cannot hold an unknown value and the fallback exists so the narrowing needs no assertion.
    let paper: PaperSize;
    if (paperSelect.value === 'A4') {
      paper = 'A4';
    } else if (paperSelect.value === 'Letter') {
      paper = 'Letter';
    } else if (paperSelect.value === 'Legal') {
      paper = 'Legal';
    } else if (paperSelect.value === 'A3') {
      paper = 'A3';
    } else if (activeSetup !== null) {
      // A <select> the code built cannot hold an unknown value; fallback exists so the narrowing needs no assertion.
      paper = activeSetup.paper;
    } else {
      // Fallback for initial state before ask invocation.
      paper = 'A4';
    }

    // Narrow orientation via explicit comparison chain against Orientation union members.
    // A <select> the code built cannot hold an unknown value and the fallback exists so the narrowing needs no assertion.
    let orientation: Orientation;
    if (orientationSelect.value === 'portrait') {
      orientation = 'portrait';
    } else if (orientationSelect.value === 'landscape') {
      orientation = 'landscape';
    } else if (activeSetup !== null) {
      // A <select> the code built cannot hold an unknown value; fallback exists so the narrowing needs no assertion.
      orientation = activeSetup.orientation;
    } else {
      // Fallback for initial state before ask invocation.
      orientation = 'portrait';
    }

    // Read margin with Number.parseFloat and guard against non-finite or out-of-bounds numbers.
    // The browser's own min/max only constrain the spinner, not what a user can type.
    const parsedMargin = Number.parseFloat(marginInput.value);
    let marginMm: number;

    // Check whether the parsed margin is a finite number.
    if (!Number.isFinite(parsedMargin)) {
      // Non-finite margin entered: fall back to current setup margin or 20mm baseline.
      if (activeSetup !== null) {
        marginMm = activeSetup.marginMm;
      } else {
        marginMm = 20;
      }
    } else if (parsedMargin < MARGIN_MIN_MM) {
      // Parsed margin is below the minimum allowed bound: clamp to MARGIN_MIN_MM.
      marginMm = MARGIN_MIN_MM;
    } else if (parsedMargin > MARGIN_MAX_MM) {
      // Parsed margin exceeds the maximum allowed bound: clamp to MARGIN_MAX_MM.
      marginMm = MARGIN_MAX_MM;
    } else {
      // Parsed margin is finite and within the allowed range [MARGIN_MIN_MM, MARGIN_MAX_MM].
      marginMm = parsedMargin;
    }

    const setup: PageSetup = {
      paper,
      orientation,
      marginMm,
      header: headerInput.value,
      footer: footerInput.value,
      includeToc: tocInput.checked,
    };

    settle(setup);
  }

  // Wire Print button click.
  printButton.addEventListener('click', (): void => {
    handlePrint();
  });

  // Wire Cancel button click.
  cancelButton.addEventListener('click', (): void => {
    settle(null);
  });

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    settle(null);
  });

  // Intercept form submit to confirm print settings when Enter is pressed in input fields.
  form.addEventListener('submit', (event: Event): void => {
    event.preventDefault();
    handlePrint();
  });

  /**
   * Opens the page setup modal dialog pre-filled with current configuration, resolving the edited setup or null when cancelled.
   *
   * @purpose Populates form controls from current setup, displays the modal dialog, focuses the paper select, and returns a promise.
   * @inputs current - PageSetup configuration to pre-populate in the dialog controls.
   * @outputs Promise<PageSetup | null> - Resolves to the edited PageSetup on confirmation, or null on cancellation.
   * @dataflow current -> form control values -> showModal() -> paperSelect.focus() -> Promise<PageSetup | null>.
   * @controlflow Check destroyed guard -> cancel existing pending promise -> populate controls -> reset settled flag -> open dialog -> focus paper select -> return Promise.
   */
  function ask(current: PageSetup): Promise<PageSetup | null> {
    // Check if the page setup dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: resolve with null immediately.
      return Promise.resolve(null);
    } else {
      // Component is active: proceed with asking.
    }

    // Check if a prior ask invocation is currently pending resolution.
    if (pendingHolder.resolve !== null) {
      // A second ask while one is pending resolves the earlier promise with null first.
      const previousResolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      previousResolve(null);
    } else {
      // No outstanding promise pending.
    }

    // Retain active setup for fallback narrowing on confirmation.
    activeSetup = current;

    // Populate every control from current configuration.
    paperSelect.value = current.paper;
    orientationSelect.value = current.orientation;
    marginInput.value = String(current.marginMm);
    headerInput.value = current.header;
    footerInput.value = current.footer;
    tocInput.checked = current.includeToc;

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

    // Focus the paper select control.
    paperSelect.focus();

    return new Promise<PageSetup | null>((resolve): void => {
      pendingHolder.resolve = resolve;
    });
  }

  /**
   * Destroys the page setup dialog component, canceling any pending promise and removing the dialog DOM node.
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
