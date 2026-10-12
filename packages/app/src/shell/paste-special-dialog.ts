/**
 * @file paste-special-dialog.ts
 * @purpose Implements PasteSpecialDialog, an accessible modal dialog using the native HTMLDialogElement offering the four readings of clipboard content (plain, markdown, html, table) for Paste Special (FR-7.4).
 * @inputs PasteSpecialOptions containing the Document context.
 * @outputs PasteSpecialDialog controller instance exposing ask and destroy lifecycle methods, alongside PASTE_SPECIAL_STYLES CSS stylesheet definition.
 * @functions
 *   - installPasteSpecialDialog: Constructs, styles, and mounts the native paste special dialog element, wires keyboard and click actions, and returns the PasteSpecialDialog controller.
 * @dataflow Dialog ask(available, current) -> options availability and current indicators update -> showModal() -> user choice / Cancel / Escape -> settle -> Promise resolution with PasteMode or null.
 * @controlflow Mount native dialog to document body -> build heading, options list, and Cancel button -> bind keyboard navigation, click, and cancel handlers -> return PasteSpecialDialog controller with ask and destroy methods.
 * @version 4
 * @date 2026-10-04
 */

import type { PasteMode } from '@k-doc/editor';

export interface PasteSpecialOptions {
  readonly doc: Document;
}

export interface PasteSpecialDialog {
  /**
   * Opens the dialog offering only the modes in `available`, with `current` marked as the one already
   * applied. Resolves the chosen mode, or null when the user cancels.
   */
  ask(available: readonly PasteMode[], current: PasteMode | null): Promise<PasteMode | null>;
  destroy(): void;
}

/**
 * Static stylesheet for the paste special modal dialog, styling the dialog backdrop, container,
 * heading, options list, option buttons with label and hint, used indicator, and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const PASTE_SPECIAL_STYLES: string = `
dialog.kdoc-paste-special {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  min-width: 380px;
  max-width: 480px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-paste-special::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-paste-special[hidden] {
  display: none;
}

.kdoc-paste-special-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kdoc-paste-special-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-paste-options {
  list-style: none;
  margin: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-paste-option {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  padding: 8px;
  cursor: pointer;
  font: inherit;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-paste-option:hover:not(:disabled),
.kdoc-paste-option.kdoc-paste-option-highlighted:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-paste-option.kdoc-paste-option-current {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -2px;
}

.kdoc-paste-option:disabled,
.kdoc-paste-option.kdoc-paste-option-disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
  opacity: 0.45;
}

.kdoc-paste-option:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-paste-option-label {
  font-size: 13px;
  font-weight: normal;
  color: var(--kdoc-chrome-text);
  line-height: 1.4;
}

.kdoc-paste-option-hint {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  display: block;
  line-height: 1.4;
}

.kdoc-paste-option-used {
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-paste-actions {
  display: flex;
  justify-content: flex-end;
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
  dialog.kdoc-paste-special,
  dialog.kdoc-paste-special * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Ordered paste modes supported by Paste Special. */
const ORDERED_MODES: readonly PasteMode[] = ['plain', 'markdown', 'html', 'table'];

/** Metadata descriptor for each paste mode option. */
interface ModeDefinition {
  readonly mode: PasteMode;
  readonly label: string;
  readonly hint: string;
}

/** Complete definitions for the four paste modes in fixed order. */
const MODE_DEFINITIONS: readonly ModeDefinition[] = [
  {
    mode: 'plain',
    label: 'Unformatted Text',
    hint: 'The characters only. No headings, no emphasis, no links.',
  },
  {
    mode: 'markdown',
    label: 'Markdown',
    hint: 'Read the text as Markdown. A line starting "## " becomes a heading.',
  },
  {
    mode: 'html',
    label: 'Formatted (HTML)',
    hint: 'Convert the copied formatting into Markdown.',
  },
  {
    mode: 'table',
    label: 'Table',
    hint: 'Read tab- or comma-separated text, or a copied table, as a table; the first row is the header.',
  },
];

/** Internal record tracking DOM elements for each mode option. */
interface OptionRecord {
  readonly mode: PasteMode;
  readonly button: HTMLButtonElement;
  readonly hintEl: HTMLSpanElement;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple paste special dialog instances. */
let nextPasteSpecialDialogId: number = 0;

/**
 * Installs the modal Paste Special dialog into the document body, wiring options, keyboard navigation, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for choosing a paste mode from available clipboard readings.
 * @inputs options - PasteSpecialOptions containing the document context.
 * @outputs PasteSpecialDialog - Controller exposing ask and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> ask(available, current) -> keyboard/click interaction -> Promise resolution with PasteMode or null.
 * @controlflow Create dialog DOM hierarchy -> configure dialog role and aria attributes -> build mode option elements -> bind keyboard, button, and cancel handlers -> append dialog to document body -> return PasteSpecialDialog controller.
 */
export function installPasteSpecialDialog(options: PasteSpecialOptions): PasteSpecialDialog {
  const doc = options.doc;
  const dialogId = ++nextPasteSpecialDialogId;
  const titleId = `kdoc-paste-special-title-${dialogId}`;

  let destroyed: boolean = false;
  let settled: boolean = true;
  let currentAvailable: readonly PasteMode[] = [];
  let highlightedMode: PasteMode | null = null;

  /** Module-scoped per-instance holder avoiding bare let closure narrowing under strict control-flow analysis. */
  const pendingHolder: { resolve: ((val: PasteMode | null) => void) | null } = {
    resolve: null,
  };

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-paste-special';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-paste-special-content';

  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'kdoc-paste-special-heading';
  heading.textContent = 'Paste Special';
  content.appendChild(heading);

  const listEl = doc.createElement('ul');
  listEl.className = 'kdoc-paste-options';

  const optionRecords: OptionRecord[] = [];

  // Build list of four paste mode options in canonical order: plain, markdown, html, table.
  for (let i = 0; i < MODE_DEFINITIONS.length; i++) {
    const def = MODE_DEFINITIONS[i];
    // Check if mode definition is defined under strict index narrowing.
    if (def === undefined) {
      // Skip undefined definition.
      continue;
    } else {
      // Valid definition: proceed with element construction.
    }

    const itemEl = doc.createElement('li');

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'kdoc-paste-option';
    button.setAttribute('data-paste-mode', def.mode);

    const labelSpan = doc.createElement('span');
    labelSpan.className = 'kdoc-paste-option-label';
    labelSpan.textContent = def.label;
    button.appendChild(labelSpan);

    const hintSpan = doc.createElement('span');
    hintSpan.className = 'kdoc-paste-option-hint';
    hintSpan.textContent = def.hint;
    button.appendChild(hintSpan);

    itemEl.appendChild(button);
    listEl.appendChild(itemEl);

    optionRecords.push({
      mode: def.mode,
      button,
      hintEl: hintSpan,
    });

    button.addEventListener('mouseenter', (): void => {
      // Check if dialog is open and mode is available.
      if (!destroyed && dialog.open && currentAvailable.includes(def.mode)) {
        // Mode is available and dialog open: synchronize highlight with hover.
        setHighlight(def.mode);
      } else {
        // Option is disabled or dialog is inactive: do not highlight on hover.
      }
    });

    button.addEventListener('click', (): void => {
      // Check if dialog is currently active and option is available.
      if (destroyed || !dialog.open) {
        // Component destroyed or dialog closed: ignore click.
        return;
      } else {
        // Dialog open: check availability.
      }

      // Check whether this mode is in the available modes list.
      if (currentAvailable.includes(def.mode)) {
        // Enabled option clicked: resolve chosen mode.
        settle(def.mode);
      } else {
        // Disabled option clicked: ignore.
      }
    });
  }

  content.appendChild(listEl);

  // Construct Cancel action button.
  const actions = doc.createElement('div');
  actions.className = 'kdoc-paste-actions';

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary kdoc-paste-cancel';
  cancelButton.setAttribute('aria-label', 'Cancel');
  cancelButton.addEventListener('click', (): void => {
    settle(null);
  });
  actions.appendChild(cancelButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the paste special modal dialog if currently open.
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
   * Closes the dialog and resolves any pending promise with the resulting mode or null once only.
   *
   * @purpose Closes the dialog before resolving the pending promise to ensure host focus calls are not overwritten by native dialog focus restoration.
   * @inputs mode - The chosen PasteMode on confirmation, or null on cancellation.
   * @outputs void.
   * @dataflow mode -> closeDialog() -> pendingHolder.resolve(mode) -> clear pendingHolder.
   * @controlflow Close dialog -> check settled guard (return if true) -> mark settled = true -> extract and clear resolver -> invoke resolve with mode.
   */
  function settle(mode: PasteMode | null): void {
    // Close BEFORE notifying the host, not after. A native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so closing afterwards silently undoes any focus the host sets
    // in its resolution path. The host's focus call has to be the last thing that runs.
    closeDialog();

    // Check if this ask session has already settled.
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
      resolve(mode);
    } else {
      // No pending promise to resolve.
    }
  }

  /**
   * Updates the keyboard/hover highlight across the option buttons.
   *
   * @purpose Highlights a specific paste mode option button and focuses it, removing highlight from others.
   * @inputs targetMode - The PasteMode to highlight, or null to clear all highlights.
   * @outputs void.
   * @dataflow targetMode -> highlightedMode -> update kdoc-paste-option-highlighted class on option buttons.
   * @controlflow Store targetMode in closure state -> iterate option records -> if matching targetMode add highlight class and focus; otherwise remove highlight class.
   */
  function setHighlight(targetMode: PasteMode | null): void {
    highlightedMode = targetMode;

    for (let i = 0; i < optionRecords.length; i++) {
      const record = optionRecords[i];
      // Check if record exists under strict indexing.
      if (record === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid option record.
      }

      // Check if option record matches target mode.
      if (record.mode === targetMode) {
        // Matching option: add highlight class and focus.
        record.button.classList.add('kdoc-paste-option-highlighted');
        record.button.focus();
      } else {
        // Mismatch: clear highlight class.
        record.button.classList.remove('kdoc-paste-option-highlighted');
      }
    }
  }

  /**
   * Keyboard event listener managing list highlight navigation, option selection, and dialog dismissal.
   *
   * @purpose Intercepts arrow keys, Enter, and Escape when dialog is open, moving highlight over enabled options only or confirming selection.
   * @inputs event - KeyboardEvent captured on dialog or document.
   * @outputs void.
   * @dataflow event.key -> arrow moves -> setHighlight() | Enter -> settle(highlightedMode) | Escape -> settle(null).
   * @controlflow Check destroyed and open guards -> inspect event.key -> route ArrowUp/Down over enabled options -> route Enter to settle highlighted mode -> route Escape to settle null.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has been destroyed or dialog is not currently open.
    if (destroyed || !dialog.open) {
      // Component destroyed or dialog closed: ignore keyboard event.
      return;
    } else {
      // Dialog is open: inspect event.
    }

    // Check if default has already been prevented by a preceding listener.
    if (event.defaultPrevented) {
      // Already handled: skip.
      return;
    } else {
      // Not yet handled: process key.
    }

    // Collect all enabled modes in order.
    const enabledModes: PasteMode[] = [];
    for (let i = 0; i < ORDERED_MODES.length; i++) {
      const m = ORDERED_MODES[i];
      // Check if mode item is defined.
      if (m === undefined) {
        // Skip undefined mode.
        continue;
      } else {
        // Valid mode item.
      }
      // Check if mode is available in current ask session.
      if (currentAvailable.includes(m)) {
        // Mode is available: include in enabled list.
        enabledModes.push(m);
      } else {
        // Mode is disabled: exclude from keyboard traversal.
      }
    }

    // Check if the pressed key is ArrowDown.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Check whether any options are enabled.
      if (enabledModes.length > 0) {
        let currentIdx = -1;
        // Check if a mode is currently highlighted.
        if (highlightedMode !== null) {
          currentIdx = enabledModes.indexOf(highlightedMode);
        } else {
          // No mode currently highlighted.
        }
        // Stop at the ends: cap next index at enabledModes.length - 1.
        const nextIdx = Math.min(enabledModes.length - 1, currentIdx + 1);
        const nextMode = enabledModes[nextIdx];
        // Check if nextMode is defined.
        if (nextMode !== undefined) {
          setHighlight(nextMode);
        } else {
          // Strict index guard fallback.
        }
      } else {
        // No enabled options available.
      }
    } else if (event.key === 'ArrowUp') {
      // Check if the pressed key is ArrowUp.
      event.preventDefault();
      // Check whether any options are enabled.
      if (enabledModes.length > 0) {
        let currentIdx = -1;
        // Check if a mode is currently highlighted.
        if (highlightedMode !== null) {
          currentIdx = enabledModes.indexOf(highlightedMode);
        } else {
          // No mode currently highlighted.
        }
        // Stop at the ends: clamp next index to 0.
        const nextIdx = Math.max(0, currentIdx - 1);
        const nextMode = enabledModes[nextIdx];
        // Check if nextMode is defined.
        if (nextMode !== undefined) {
          setHighlight(nextMode);
        } else {
          // Strict index guard fallback.
        }
      } else {
        // No enabled options available.
      }
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if a valid enabled mode is currently highlighted.
      if (highlightedMode !== null && currentAvailable.includes(highlightedMode)) {
        // Enter chooses the highlighted mode.
        settle(highlightedMode);
      } else {
        // No valid highlighted option: do not settle.
      }
    } else if (event.key === 'Escape') {
      // Check if the pressed key is Escape.
      event.preventDefault();
      // Escape cancels the dialog.
      settle(null);
    } else {
      // Other keys: allow default handling.
    }
  }

  dialog.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keydown', onKeyDown);

  // Handle native Escape key dismiss event on the dialog.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    settle(null);
  });

  /**
   * Opens the Paste Special dialog offering only the modes in available, with current marked as already applied.
   *
   * @purpose Displays the modal dialog, marks available/disabled and current modes, sets initial highlight, and resolves on choice or cancellation.
   * @inputs
   *   - available: readonly PasteMode[] - Paste modes satisfiable by the current clipboard.
   *   - current: PasteMode | null - Mode already applied to the document, or null.
   * @outputs Promise<PasteMode | null> - Resolves to chosen PasteMode or null when cancelled.
   * @dataflow available/current -> DOM updates -> showModal() -> Promise<PasteMode | null>.
   * @controlflow Check destroyed guard -> cancel existing pending promise -> reset settled flag -> update options DOM -> determine initial highlight -> showModal() -> return new Promise.
   */
  function ask(available: readonly PasteMode[], current: PasteMode | null): Promise<PasteMode | null> {
    // Check if the paste special dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: resolve with null immediately.
      return Promise.resolve(null);
    } else {
      // Component is active: proceed with asking.
    }

    // Check if a prior ask invocation is currently pending resolution.
    if (pendingHolder.resolve !== null) {
      // An ask called while one is pending resolves the earlier promise with null first.
      const previousResolve = pendingHolder.resolve;
      pendingHolder.resolve = null;
      previousResolve(null);
    } else {
      // No outstanding promise pending.
    }

    settled = false;
    currentAvailable = available;

    // Update DOM presentation for each mode option.
    for (let i = 0; i < MODE_DEFINITIONS.length; i++) {
      const def = MODE_DEFINITIONS[i];
      // Check if mode definition is defined.
      if (def === undefined) {
        // Skip undefined definition.
        continue;
      } else {
        // Valid definition.
      }
      const record = optionRecords[i];
      // Check if option record is defined.
      if (record === undefined) {
        // Skip undefined record.
        continue;
      } else {
        // Valid option record.
      }

      const isAvailable = available.includes(def.mode);
      const isCurrent = current === def.mode;

      // Check whether the clipboard satisfies this paste mode.
      if (isAvailable) {
        // Mode is available: enable option button.
        record.button.disabled = false;
        record.button.classList.remove('kdoc-paste-option-disabled');
        record.button.removeAttribute('aria-disabled');
      } else {
        // An option the clipboard cannot satisfy is shown greyed rather than hidden, because a
        // dialog whose contents change shape between invocations is one the user has to re-read every time.
        record.button.disabled = true;
        record.button.classList.add('kdoc-paste-option-disabled');
        record.button.setAttribute('aria-disabled', 'true');
      }

      // Check whether this mode matches the one already applied to the document.
      if (isCurrent) {
        // Marking what was already done is what makes this a change your mind dialog rather than a second paste.
        record.button.classList.add('kdoc-paste-option-current');
        record.button.setAttribute('aria-current', 'true');
        record.hintEl.textContent = def.hint;
        const usedSpan = doc.createElement('span');
        usedSpan.className = 'kdoc-paste-option-used';
        usedSpan.textContent = ' (used)';
        record.hintEl.appendChild(usedSpan);
      } else {
        // Not the current mode: clear current styling and (used) suffix.
        record.button.classList.remove('kdoc-paste-option-current');
        record.button.removeAttribute('aria-current');
        record.hintEl.textContent = def.hint;
      }
    }

    // Determine initial highlight: starts on current when it is enabled, else on the first enabled option.
    let initialHighlight: PasteMode | null = null;
    if (current !== null && available.includes(current)) {
      // Current mode is available: highlight current.
      initialHighlight = current;
    } else {
      // Find the first enabled option in canonical order.
      for (let i = 0; i < ORDERED_MODES.length; i++) {
        const m = ORDERED_MODES[i];
        // Check if mode is defined.
        if (m === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid mode.
        }
        // Check if mode is available.
        if (available.includes(m)) {
          // First available mode found: highlight it.
          initialHighlight = m;
          break;
        } else {
          // Mode not available.
        }
      }
    }

    setHighlight(initialHighlight);

    // Check if the dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog is already open: skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open modal dialog.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments.
      dialog.open = true;
    }

    return new Promise<PasteMode | null>((resolve): void => {
      pendingHolder.resolve = resolve;
    });
  }

  /**
   * Destroys the Paste Special dialog component, canceling any pending promise and removing DOM elements.
   *
   * @purpose Idempotently cleans up the dialog component, detaches listeners, resolves outstanding promises with null, and removes the DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow mark destroyed = true -> detach listeners -> settle(null) -> dialog.remove().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> remove keydown listeners -> settle with null -> remove dialog element.
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

    dialog.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keydown', onKeyDown);

    settle(null);
    dialog.remove();
  }

  return {
    ask,
    destroy,
  };
}
