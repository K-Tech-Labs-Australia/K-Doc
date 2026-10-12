/**
 * @file command-palette.ts
 * @purpose Implements CommandPalette, an accessible modal command palette for K-Doc (FR-9.8) using the native HTMLDialogElement.
 *   Provides quick fuzzy search and execution for all editor and application commands with full keyboard navigation.
 * @inputs CommandPaletteOptions containing the Document context and a commands provider function returning live KdocCommand array.
 * @outputs CommandPalette controller instance exposing open, close, isOpen, and destroy lifecycle methods, alongside COMMAND_PALETTE_STYLES CSS stylesheet definition.
 * @functions
 *   - installCommandPalette: Constructs and mounts the native command palette dialog, wires search input filtering, keyboard navigation, and returns the CommandPalette controller.
 * @dataflow User search input -> filterCommands subsequence query filter -> filtered KdocCommand options rendered to list -> user keyboard/click selection -> palette close -> command execution.
 * @controlflow Mount native dialog to document body -> bind input, keydown, and cancel handlers with AbortController -> open() refreshes live commands, filters, and displays modal dialog -> selection closes dialog and invokes command.run().
 * @version 3
 * @date 2026-10-04
 */

import type { KdocCommand } from './command-registry.js';
import { filterCommands } from './command-registry.js';

export interface CommandPaletteOptions {
  readonly doc: Document;
  readonly commands: () => readonly KdocCommand[];
}

export interface CommandPalette {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * Static stylesheet for the command palette modal dialog, styling the tonal modal container,
 * sunken search input, scrollable results list with sunken/extruded scrollbar, palette option rows
 * with sunken active state and coupled emissive cyan label glow, and rounded corners using exclusively
 * authoritative K-Doc chrome design tokens.
 */
export const COMMAND_PALETTE_STYLES: string = `
dialog.kdoc-command-palette-dialog {
  position: fixed;
  top: 15vh;
  margin: 0 auto;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 0;
  width: 540px;
  max-width: calc(100% - 32px);
  max-height: 480px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

/* Ensure closed dialogs never remain visible when display: flex is applied. */

dialog.kdoc-command-palette-dialog:not([open]) {
  display: none !important;
}

dialog.kdoc-command-palette-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-command-palette-header {
  padding: 10px;
  border-bottom: 1px solid var(--kdoc-chrome-shadow-dark);
  flex-shrink: 0;
}

.kdoc-command-palette-input {
  width: 100%;
  min-height: 32px;
  height: 32px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 4px 10px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.kdoc-command-palette-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-command-palette-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px;
  overflow-y: auto;
  flex: 1 1 auto;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-command-palette-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-command-palette-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-command-palette-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-command-palette-list::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-command-palette-empty {
  padding: 12px 16px;
  font-size: 13px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  text-align: center;
}

.kdoc-command-palette-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  min-height: 28px;
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
  border-radius: var(--kdoc-radius-sm);
  margin: 1px 0;
  border: 1px solid transparent;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.kdoc-command-palette-option:hover:not([aria-disabled="true"]) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
  box-shadow: none;
}

.kdoc-command-palette-option.kdoc-command-palette-option-active,
.kdoc-command-palette-option[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-command-palette-option[aria-disabled="true"] {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-command-palette-option-main {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-command-palette-category {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kdoc-chrome-text-muted);
  flex-shrink: 0;
}

.kdoc-command-palette-option[aria-selected="true"] .kdoc-command-palette-category {
  color: var(--kdoc-chrome-on-selected);
  opacity: 0.8;
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  font-weight: 700;
}

.kdoc-command-palette-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-command-palette-shortcut {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  flex-shrink: 0;
  margin-left: auto;
}

.kdoc-command-palette-option[aria-selected="true"] .kdoc-command-palette-shortcut {
  color: var(--kdoc-chrome-on-selected);
  opacity: 0.8;
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-command-palette-dialog,
  dialog.kdoc-command-palette-dialog * {
    transition: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple command palette instances. */
let nextCommandPaletteId: number = 0;

/**
 * Installs the command palette dialog into the document body, configuring search filtering, keyboard navigation, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for searching and invoking K-Doc commands.
 * @inputs options - CommandPaletteOptions containing document context and live command list provider.
 * @outputs CommandPalette - Controller exposing open, close, isOpen, and destroy lifecycle methods.
 * @dataflow options.commands -> filterCommands -> DOM options hierarchy -> command execution.
 * @controlflow Create dialog DOM hierarchy -> attach input, keydown, and cancel listeners with AbortController -> append dialog to document body -> return CommandPalette controller.
 */
export function installCommandPalette(options: CommandPaletteOptions): CommandPalette {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const paletteId = ++nextCommandPaletteId;
  const inputId = `kdoc-command-palette-input-${paletteId}`;
  const listId = `kdoc-command-palette-list-${paletteId}`;

  let destroyed: boolean = false;
  let currentCommands: readonly KdocCommand[] = [];
  let filteredCommands: readonly KdocCommand[] = [];
  let activeIndex: number = -1;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-command-palette-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Command Palette');

  // Construct header containing search input.
  const header = doc.createElement('div');
  header.className = 'kdoc-command-palette-header';

  const input = doc.createElement('input');
  input.id = inputId;
  input.type = 'text';
  input.className = 'kdoc-command-palette-input';
  input.setAttribute('placeholder', 'Type a command…');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', listId);
  header.appendChild(input);

  dialog.appendChild(header);

  // Construct results listbox.
  const list = doc.createElement('ul');
  list.id = listId;
  list.className = 'kdoc-command-palette-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commands');
  dialog.appendChild(list);

  /**
   * Executes a chosen command, closing the palette dialog first to restore editor focus.
   *
   * @purpose Closes the dialog before executing the command so editor focus restoration succeeds.
   * @inputs command - The KdocCommand to execute.
   * @outputs void.
   * @dataflow command -> close() -> command.run().
   * @controlflow Close palette dialog -> invoke command.run().
   */
  function executeCommand(command: KdocCommand): void {
    // Running a command must close the palette before invoking run().
    // The editor commands focus the ProseMirror view as their last act, and K-Doc keys its edit
    // lock on which pane holds focus — running first would hand focus to the pane and then a closing
    // dialog would snatch it back, leaving the lock pointing at nothing.
    close();
    command.run();
  }

  /**
   * Synchronizes active selection state across rendered options and updates ARIA attributes.
   *
   * @purpose Updates aria-activedescendant on the input, aria-selected and active CSS class on option items, and scrolls the active option into view.
   * @inputs void.
   * @outputs void.
   * @dataflow activeIndex -> input.aria-activedescendant & option element attributes -> scrollIntoView.
   * @controlflow Check if filtered commands exist -> iterate option children -> update aria-selected and active class -> update aria-activedescendant -> scroll active option into view.
   */
  function updateActiveOption(): void {
    // Check if filtered commands list is empty or active index is uninitialized.
    if (filteredCommands.length === 0 || activeIndex < 0) {
      // Clear aria-activedescendant when no option is actively selected.
      input.removeAttribute('aria-activedescendant');
      return;
    } else {
      // Commands present: synchronize active state across options.
    }

    for (let i = 0; i < list.children.length; i++) {
      const child = list.children[i];
      // Check if child element exists and is an HTMLElement under strict indexing.
      if (child === undefined || !(child instanceof HTMLElement)) {
        // Skip non-HTMLElement child or undefined index.
        continue;
      } else {
        // Valid HTMLElement child: check against active index.
      }

      // Check if this option matches the active index.
      if (i === activeIndex) {
        // Active option: set aria-selected, apply active CSS class, and point aria-activedescendant at its id.
        child.setAttribute('aria-selected', 'true');
        child.classList.add('kdoc-command-palette-option-active');
        input.setAttribute('aria-activedescendant', child.id);

        // Check if scrollIntoView is available in the current environment.
        if (typeof child.scrollIntoView === 'function') {
          // Scroll the active option into view nearest the visible boundary.
          child.scrollIntoView({ block: 'nearest' });
        } else {
          // scrollIntoView not available (e.g. jsdom test environment).
        }
      } else {
        // Inactive option: clear aria-selected and active class.
        child.setAttribute('aria-selected', 'false');
        child.classList.remove('kdoc-command-palette-option-active');
      }
    }
  }

  /**
   * Reconstructs the list of command options in the DOM based on current filtered commands.
   *
   * @purpose Clears existing options, clamps activeIndex, creates option elements for each filtered command, and updates selection state.
   * @inputs void.
   * @outputs void.
   * @dataflow filteredCommands -> DOM list items -> updateActiveOption.
   * @controlflow Clear list -> check if filteredCommands is empty (show empty state) -> clamp activeIndex -> create li elements with category, label, shortcut -> update active option.
   */
  function renderList(): void {
    list.replaceChildren();

    // Check if filtered commands list is empty.
    if (filteredCommands.length === 0) {
      // No matching commands: reset active index, clear activedescendant, and show empty state message.
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');

      const emptyItem = doc.createElement('li');
      emptyItem.className = 'kdoc-command-palette-empty';
      emptyItem.setAttribute('role', 'presentation');
      emptyItem.textContent = 'No commands found';
      list.appendChild(emptyItem);
      return;
    } else {
      // Filtered commands available: clamp active index into valid range.
    }

    // Check if activeIndex is below 0 or beyond the filtered commands bounds.
    if (activeIndex < 0) {
      // Clamp negative index to the first option.
      activeIndex = 0;
    } else if (activeIndex >= filteredCommands.length) {
      // Clamp index exceeding bounds to the last option.
      activeIndex = filteredCommands.length - 1;
    } else {
      // activeIndex is within valid bounds.
    }

    for (let i = 0; i < filteredCommands.length; i++) {
      const command = filteredCommands[i];
      // Check if command is defined to satisfy strict noUncheckedIndexedAccess.
      if (command === undefined) {
        // Skip undefined command entry.
        continue;
      } else {
        // Command defined: construct option element.
      }

      const optionId = `kdoc-command-palette-opt-${paletteId}-${i}`;
      const optionEl = doc.createElement('li');
      optionEl.id = optionId;
      optionEl.setAttribute('role', 'option');
      optionEl.className = 'kdoc-command-palette-option';

      const enabled = command.isEnabled();
      // Check whether the command can run right now.
      if (enabled) {
        // Enabled command: set aria-disabled false.
        optionEl.setAttribute('aria-disabled', 'false');
      } else {
        // Disabled command: set aria-disabled true for dimmed styling.
        optionEl.setAttribute('aria-disabled', 'true');
      }

      const mainDiv = doc.createElement('div');
      mainDiv.className = 'kdoc-command-palette-option-main';

      const categorySpan = doc.createElement('span');
      categorySpan.className = 'kdoc-command-palette-category';
      categorySpan.textContent = command.category;
      mainDiv.appendChild(categorySpan);

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'kdoc-command-palette-label';
      labelSpan.textContent = command.label;
      mainDiv.appendChild(labelSpan);

      optionEl.appendChild(mainDiv);

      // Check if the command specifies a shortcut.
      if (command.shortcut !== '') {
        // Shortcut present: render shortcut label aligned to the right.
        const shortcutSpan = doc.createElement('span');
        shortcutSpan.className = 'kdoc-command-palette-shortcut';
        shortcutSpan.textContent = command.shortcut;
        optionEl.appendChild(shortcutSpan);
      } else {
        // No keyboard shortcut specified.
      }

      optionEl.addEventListener(
        'click',
        (): void => {
          // Check whether the command is enabled before executing.
          if (command.isEnabled()) {
            // Command enabled: execute command and close palette.
            executeCommand(command);
          } else {
            // Command disabled: cannot be chosen.
          }
        },
        { signal },
      );

      list.appendChild(optionEl);
    }

    updateActiveOption();
  }

  /**
   * Keyboard shortcut event listener managing option navigation and command activation.
   *
   * @purpose Intercepts ArrowDown, ArrowUp, and Enter inside the dialog, leaving Escape to the native dialog cancel event.
   * @inputs event - KeyboardEvent captured from dialog keydown listener.
   * @outputs void.
   * @dataflow event.key -> activeIndex calculation -> updateActiveOption() or executeCommand().
   * @controlflow Check destroyed flag -> route ArrowDown / ArrowUp (with wrap-around) -> route Enter to executeCommand -> pass other keys through.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: ignore keyboard event.
      return;
    } else {
      // Component is active: inspect key event.
    }

    // Check if the pressed key is ArrowDown.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Check if filtered commands list has options to navigate.
      if (filteredCommands.length === 0) {
        // No options available: do nothing.
        return;
      } else {
        // Options available: compute next active index with wrap-around.
      }

      // Check if advancing past the last item or from uninitialized state.
      if (activeIndex >= filteredCommands.length - 1 || activeIndex < 0) {
        // Wrap around to the first option.
        activeIndex = 0;
      } else {
        // Step forward to the next option.
        activeIndex = activeIndex + 1;
      }
      updateActiveOption();
    } else if (event.key === 'ArrowUp') {
      // Check if the pressed key is ArrowUp.
      event.preventDefault();
      // Check if filtered commands list has options to navigate.
      if (filteredCommands.length === 0) {
        // No options available: do nothing.
        return;
      } else {
        // Options available: compute previous active index with wrap-around.
      }

      // Check if moving before the first item or from uninitialized state.
      if (activeIndex <= 0) {
        // Wrap around to the last option.
        activeIndex = filteredCommands.length - 1;
      } else {
        // Step backward to the previous option.
        activeIndex = activeIndex - 1;
      }
      updateActiveOption();
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if active index is valid within the filtered commands list.
      if (activeIndex >= 0 && activeIndex < filteredCommands.length) {
        const targetCommand = filteredCommands[activeIndex];
        // Check if command at active index is defined under strict indexing.
        if (targetCommand !== undefined) {
          // Check if the command is enabled before executing.
          if (targetCommand.isEnabled()) {
            // Command enabled: execute command.
            executeCommand(targetCommand);
          } else {
            // Command disabled: cannot be chosen.
          }
        } else {
          // Target command is undefined.
        }
      } else {
        // No active command selected.
      }
    } else {
      // Other keys (e.g. typing or Escape handled by native cancel): allow standard handling.
    }
  }

  // Handle native Escape key dismiss event without double-closing.
  dialog.addEventListener(
    'cancel',
    (event: Event): void => {
      event.preventDefault();
      close();
    },
    { signal },
  );

  // Attach keydown listener for ArrowDown, ArrowUp, and Enter navigation.
  dialog.addEventListener('keydown', onKeyDown, { signal });

  // Filter commands on every text input event.
  input.addEventListener(
    'input',
    (): void => {
      filteredCommands = filterCommands(currentCommands, input.value);
      activeIndex = 0;
      renderList();
    },
    { signal },
  );

  // Mount native dialog to document body.
  doc.body.appendChild(dialog);

  /**
   * Opens the command palette dialog, refreshing command list and focusing search input.
   *
   * @purpose Refreshes commands from provider, resets query and selection, displays modal dialog, and focuses input.
   * @inputs void.
   * @outputs void.
   * @dataflow options.commands() -> filterCommands -> DOM options rendering -> dialog.showModal() -> input.focus().
   * @controlflow Check destroyed guard -> reset input query -> fetch live commands -> filter and render list -> show dialog -> focus input.
   */
  function open(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    // Clear search query.
    input.value = '';

    // Retrieve live commands freshly from registry on every open.
    // The registry closes over live editor state, so a list captured once would show stale enabled/disabled styling.
    currentCommands = options.commands();
    filteredCommands = filterCommands(currentCommands, '');
    activeIndex = 0;
    renderList();

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

    input.focus();
  }

  /**
   * Closes the command palette dialog.
   *
   * @purpose Closes the modal dialog element in an idempotent manner across environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check destroyed guard -> check if dialog is open -> invoke dialog.close() or set open = false.
   */
  function close(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort close.
      return;
    } else {
      // Component is active: proceed with closing.
    }

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
   * Tears down the command palette component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes the dialog, and removes element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> dialog.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> abort controller -> close dialog -> remove dialog from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    /**
     * @purpose Returns boolean indicating whether the command palette dialog is currently open.
     * @inputs void.
     * @outputs boolean - True if the dialog is open and component is not destroyed; false otherwise.
     * @dataflow dialog.open -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed; otherwise return dialog.open.
     */
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else {
        // Return live open status of the dialog element.
        return dialog.open;
      }
    },
    destroy,
  };
}
