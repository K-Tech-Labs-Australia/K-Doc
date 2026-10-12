/**
 * @file language-picker.ts
 * @purpose Implements LanguagePicker, an accessible modal language selector dialog for fenced code blocks (FR-8.8).
 *   Provides curated and freeform language selection with case-insensitive filtering, keyboard navigation, and autofocus.
 * @inputs LanguagePickerOptions containing Document context and onPick callback.
 * @outputs LanguagePicker controller instance exposing open, close, isOpen, and destroy lifecycle methods, alongside LANGUAGE_PICKER_STYLES and CODE_LANGUAGES catalogue.
 * @functions
 *   - installLanguagePicker: Constructs and mounts the native language picker dialog, wires search input filtering, keyboard navigation, and returns the LanguagePicker controller.
 * @dataflow User search input -> case-insensitive substring filter over CODE_LANGUAGES -> filtered options rendered to list -> user keyboard/click selection -> picker close -> onPick callback.
 * @controlflow Mount native dialog to document body -> bind input, keydown, and cancel handlers with AbortController -> open(current) prefills input, selects text, filters list, and shows modal dialog -> selection closes dialog and invokes onPick.
 * @version 3
 * @date 2026-10-04
 */

/**
 * Static stylesheet for the language picker modal dialog, styling the dialog backdrop, filter input,
 * option items, active selection indicators, and scrollable results list using exclusively authoritative K-Doc design tokens.
 */
export const LANGUAGE_PICKER_STYLES: string = `
dialog.kdoc-language-picker {
  position: fixed;
  top: 15vh;
  margin: 0 auto;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 0;
  width: 380px;
  max-width: calc(100% - 32px);
  max-height: 400px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

/* Ensure closed dialogs never remain visible when display: flex is applied. */

dialog.kdoc-language-picker:not([open]) {
  display: none;
}

dialog.kdoc-language-picker::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

/* An explicit display on a class beats the user agent's [hidden] rule, so it must be restated at higher specificity. */

.kdoc-language-picker [hidden] {
  display: none;
}

.kdoc-language-picker-header {
  padding: 8px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  flex-shrink: 0;
}

.kdoc-language-picker-input {
  width: 100%;
  min-height: 32px;
  height: 32px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  box-shadow: none;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.kdoc-language-picker-input:focus-visible {
  outline: none;
  border-color: var(--kdoc-chrome-accent);
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-edge);
  background: transparent;
}

.kdoc-language-picker-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  flex: 1 1 auto;
  box-sizing: border-box;
}

.kdoc-language-picker-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-language-picker-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-language-picker-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-language-picker-empty {
  padding: 12px 16px;
  font-size: 13px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  text-align: center;
}

.kdoc-language-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  margin: 1px 0;
  border-radius: var(--kdoc-radius-md);
  min-height: 28px;
  font-size: 13px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
  transition: background 120ms ease, box-shadow 120ms ease, color 120ms ease;
}

.kdoc-language-picker-option:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-language-picker-option.kdoc-language-picker-option-active,
.kdoc-language-picker-option[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-language-picker,
  .kdoc-language-picker-input,
  .kdoc-language-picker-option {
    transition: none;
  }
}
`;

/**
 * The languages offered, in the order shown before any filtering.
 * This is a curated set rather than an exhaustive one, because a list of 300 is worse to scan
 * than a filter box over 40, and a language not listed can still be typed in freely.
 */
export const CODE_LANGUAGES: readonly string[] = Object.freeze<readonly string[]>([
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'yaml',
  'toml',
  'html',
  'css',
  'scss',
  'markdown',
  'bash',
  'shell',
  'powershell',
  'python',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'sql',
  'graphql',
  'dockerfile',
  'ini',
  'diff',
  'xml',
  'lua',
  'r',
  'matlab',
  'perl',
  'scala',
  'haskell',
  'elixir',
  'dart',
  'vim',
]);

export interface LanguagePickerOptions {
  readonly doc: Document;
  readonly onPick: (language: string | null) => void;
}

export interface LanguagePicker {
  /** `current` preselects and prefills; null means the block has no language yet. */
  open(current: string | null): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

interface LanguagePickerItem {
  readonly label: string;
  readonly value: string | null;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple language picker instances. */
let nextLanguagePickerId: number = 0;

/**
 * Installs the searchable language picker modal dialog into the document body, configuring search filtering, keyboard navigation, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for selecting code block fence languages.
 * @inputs options - LanguagePickerOptions containing document context and onPick callback.
 * @outputs LanguagePicker - Controller exposing open, close, isOpen, and destroy lifecycle methods.
 * @dataflow options.onPick -> DOM event listeners -> filter CODE_LANGUAGES -> user pick -> dialog close -> callback.
 * @controlflow Create dialog DOM hierarchy -> attach input, keydown, and cancel listeners with AbortController -> append dialog to document body -> return LanguagePicker controller.
 */
export function installLanguagePicker(options: LanguagePickerOptions): LanguagePicker {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const pickerId = ++nextLanguagePickerId;
  const inputId = `kdoc-language-picker-input-${pickerId}`;
  const listId = `kdoc-language-picker-list-${pickerId}`;

  let destroyed: boolean = false;
  let filteredItems: readonly LanguagePickerItem[] = [];
  let activeIndex: number = -1;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-language-picker';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Select Code Language');

  // Construct header containing filter input.
  const header = doc.createElement('div');
  header.className = 'kdoc-language-picker-header';

  const input = doc.createElement('input');
  input.id = inputId;
  input.type = 'text';
  input.className = 'kdoc-language-picker-input';
  input.setAttribute('placeholder', 'Search or enter language…');
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
  list.className = 'kdoc-language-picker-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Languages');
  dialog.appendChild(list);

  /**
   * Closes the dialog before calling onPick, preserving editor focus.
   *
   * @purpose Dismisses dialog before invoking onPick callback because a native <dialog> restores focus on close and would otherwise undo the host focus.
   * @inputs language - Selected language string, or null for plain text / no language.
   * @outputs void.
   * @dataflow language -> close() -> options.onPick(language).
   * @controlflow Close modal dialog -> invoke options.onPick callback with selected language.
   */
  function pick(language: string | null): void {
    // Picking closes the dialog before calling onPick, because a native <dialog>
    // restores focus on close and would otherwise undo the focus the host sets inside the callback.
    close();
    options.onPick(language);
  }

  /**
   * Filters the available languages and updates the internal filteredItems array.
   *
   * @purpose Performs case-insensitive substring matching against CODE_LANGUAGES with "None (plain text)" at top of unfiltered list.
   * @inputs query - Search string from the filter input.
   * @outputs void.
   * @dataflow query -> normalized query -> populate filteredItems array.
   * @controlflow Check if query is empty -> if empty, set None item and full CODE_LANGUAGES -> if non-empty, check None item match and test substring on each language.
   */
  function updateFilteredItems(query: string): void {
    const normalized = query.trim().toLowerCase();

    // Check if the filter query is empty.
    if (normalized === '') {
      // A "None (plain text)" entry sits at the top of the unfiltered list and calls onPick(null).
      // Clearing a language must be as easy as setting one, and null rather than '' is what
      // keeps one representation of "no language" — a fence with an empty info string and
      // one with none are the same thing.
      const items: LanguagePickerItem[] = [
        { label: 'None (plain text)', value: null },
      ];
      for (let i = 0; i < CODE_LANGUAGES.length; i++) {
        const lang = CODE_LANGUAGES[i];
        // Check if language entry exists under strict indexing.
        if (lang !== undefined) {
          items.push({ label: lang, value: lang });
        } else {
          // Undefined language item.
        }
      }
      filteredItems = items;
      return;
    } else {
      // Non-empty query: filter options using case-insensitive substring match.
    }

    const matches: LanguagePickerItem[] = [];

    // Check if query matches the None (plain text) option.
    if ('none (plain text)'.includes(normalized)) {
      // Query matches None option: include at top of matches.
      matches.push({ label: 'None (plain text)', value: null });
    } else {
      // Query does not match None option.
    }

    for (let i = 0; i < CODE_LANGUAGES.length; i++) {
      const lang = CODE_LANGUAGES[i];
      // Check if language string exists under strict indexing.
      if (lang === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Language defined: check substring match.
      }

      // Filtering is a case-insensitive substring match on the language name.
      if (lang.toLowerCase().includes(normalized)) {
        // Substring matched: append language to filtered items.
        matches.push({ label: lang, value: lang });
      } else {
        // Substring not matched: skip language.
      }
    }

    filteredItems = matches;
  }

  /**
   * Synchronizes active selection state across rendered options and updates ARIA attributes.
   *
   * @purpose Updates aria-activedescendant on the input, aria-selected and active CSS class on option items, and scrolls the active option into view.
   * @inputs void.
   * @outputs void.
   * @dataflow activeIndex -> input.aria-activedescendant & option element attributes -> scrollIntoView.
   * @controlflow Check if filtered items exist -> iterate option children -> update aria-selected and active class -> update aria-activedescendant -> scroll active option into view.
   */
  function updateActiveOption(): void {
    // Check if filtered items list is empty or active index is uninitialized.
    if (filteredItems.length === 0 || activeIndex < 0) {
      // Clear aria-activedescendant when no option is actively selected.
      input.removeAttribute('aria-activedescendant');
      return;
    } else {
      // Items present: synchronize active state across options.
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
        child.classList.add('kdoc-language-picker-option-active');
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
        child.classList.remove('kdoc-language-picker-option-active');
      }
    }
  }

  /**
   * Reconstructs the list of language options in the DOM based on current filtered items.
   *
   * @purpose Clears existing options, clamps activeIndex, creates option elements for each filtered item, and updates selection state.
   * @inputs void.
   * @outputs void.
   * @dataflow filteredItems -> DOM list items -> updateActiveOption.
   * @controlflow Clear list -> check if filteredItems is empty (show empty state) -> clamp activeIndex -> create li elements -> update active option.
   */
  function renderList(): void {
    list.replaceChildren();

    // Check if filtered items list is empty.
    if (filteredItems.length === 0) {
      // No matching languages: reset active index, clear activedescendant, and show empty state message.
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');

      const emptyItem = doc.createElement('li');
      emptyItem.className = 'kdoc-language-picker-empty';
      emptyItem.setAttribute('role', 'presentation');
      const queryText = input.value.trim();
      // Check if the user typed text that will be used verbatim on Enter.
      if (queryText !== '') {
        // Show hint that pressing Enter will use typed text verbatim.
        emptyItem.textContent = `No match — press Enter to use "${queryText}"`;
      } else {
        // Fallback message when input query is blank.
        emptyItem.textContent = 'No matching languages';
      }
      list.appendChild(emptyItem);
      return;
    } else {
      // Filtered items available: clamp active index into valid range.
    }

    // Check if activeIndex is below 0 or beyond the filtered items bounds.
    if (activeIndex < 0) {
      // Clamp negative index to the first option.
      activeIndex = 0;
    } else if (activeIndex >= filteredItems.length) {
      // Clamp index exceeding bounds to the last option.
      activeIndex = filteredItems.length - 1;
    } else {
      // activeIndex is within valid bounds.
    }

    for (let i = 0; i < filteredItems.length; i++) {
      const item = filteredItems[i];
      // Check if item is defined to satisfy strict noUncheckedIndexedAccess.
      if (item === undefined) {
        // Skip undefined item entry.
        continue;
      } else {
        // Item defined: construct option element.
      }

      const optionId = `kdoc-language-picker-opt-${pickerId}-${i}`;
      const optionEl = doc.createElement('li');
      optionEl.id = optionId;
      optionEl.setAttribute('role', 'option');
      optionEl.className = 'kdoc-language-picker-option';
      optionEl.textContent = item.label;

      optionEl.addEventListener(
        'click',
        (): void => {
          // Clicking an item picks its language value and closes the dialog.
          pick(item.value);
        },
        { signal },
      );

      list.appendChild(optionEl);
    }

    updateActiveOption();
  }

  /**
   * Keyboard shortcut event listener managing option navigation and language selection.
   *
   * @purpose Intercepts ArrowDown, ArrowUp, Enter, and Escape inside the dialog.
   * @inputs event - KeyboardEvent captured from dialog keydown listener.
   * @outputs void.
   * @dataflow event.key -> activeIndex calculation -> updateActiveOption() or pick().
   * @controlflow Check destroyed flag -> route ArrowDown / ArrowUp (with wrap-around) -> route Enter to pick active match or verbatim text -> route Escape to close dialog.
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
      // Check if filtered items list has options to navigate.
      if (filteredItems.length === 0) {
        // No options available: do nothing.
        return;
      } else {
        // Options available: compute next active index with wrap-around.
      }

      // Check if advancing past the last item or from uninitialized state.
      if (activeIndex >= filteredItems.length - 1 || activeIndex < 0) {
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
      // Check if filtered items list has options to navigate.
      if (filteredItems.length === 0) {
        // No options available: do nothing.
        return;
      } else {
        // Options available: compute previous active index with wrap-around.
      }

      // Check if moving before the first item or from uninitialized state.
      if (activeIndex <= 0) {
        // Wrap around to the last option.
        activeIndex = filteredItems.length - 1;
      } else {
        // Step backward to the previous option.
        activeIndex = activeIndex - 1;
      }
      updateActiveOption();
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if there is an active match selected from the filtered list.
      if (activeIndex >= 0 && activeIndex < filteredItems.length) {
        const item = filteredItems[activeIndex];
        // Check if item is defined under strict indexing.
        if (item !== undefined) {
          // Valid item selected: pick its value (null for None, or language string).
          pick(item.value);
        } else {
          // Item at active index is undefined.
        }
      } else {
        // Enter with no match picks the typed text verbatim.
        // The curated list is a convenience, not a whitelist — refusing an unlisted
        // language would make the picker worse than typing the fence by hand.
        const typed = input.value.trim();
        // Check whether the author entered non-empty text.
        if (typed !== '') {
          // Non-empty custom language: pick typed text verbatim.
          pick(typed);
        } else {
          // Empty input with no matches: pick null.
          pick(null);
        }
      }
    } else if (event.key === 'Escape') {
      // Check if the pressed key is Escape.
      event.preventDefault();
      close();
    } else {
      // Other keys: allow standard typing and navigation handling.
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

  // Attach keydown listener for ArrowDown, ArrowUp, Enter, and Escape navigation.
  dialog.addEventListener('keydown', onKeyDown, { signal });

  // Filter languages on every text input event.
  input.addEventListener(
    'input',
    (): void => {
      updateFilteredItems(input.value);
      // Check if filtered items are available after typing.
      if (filteredItems.length > 0) {
        // Matches found: highlight first match.
        activeIndex = 0;
      } else {
        // No matches found: reset active index.
        activeIndex = -1;
      }
      renderList();
    },
    { signal },
  );

  // Mount native dialog to document body.
  doc.body.appendChild(dialog);

  /**
   * Opens the language picker dialog, prefilling the filter input and focusing it.
   *
   * @purpose Prefills filter with current language, selects text, opens modal dialog, and focuses input.
   * @inputs current - Existing language string of the code block, or null if no language is set.
   * @outputs void.
   * @dataflow current -> input.value -> updateFilteredItems -> renderList -> dialog.showModal() -> input.focus() -> input.select().
   * @controlflow Check destroyed guard -> prefill input with current ?? '' -> update filtered list -> find target index -> render list -> show dialog -> focus and select input.
   */
  function open(current: string | null): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    // Prefill filter with current ?? ''.
    const initialText = current ?? '';
    input.value = initialText;

    // Filter items based on prefilled initial text.
    updateFilteredItems(initialText);

    // Find if an item in the filtered list matches current to preselect it.
    let targetIndex = -1;
    // Check whether current is null (plain text).
    if (current === null) {
      // Locate None (plain text) option where value is null.
      targetIndex = filteredItems.findIndex((item) => item.value === null);
    } else {
      // Locate matching language by case-insensitive comparison.
      const normalizedCurrent = current.trim().toLowerCase();
      targetIndex = filteredItems.findIndex(
        (item) => item.value !== null && item.value.toLowerCase() === normalizedCurrent,
      );
    }

    // Check if matching item index was found.
    if (targetIndex >= 0) {
      // Matching item found: preselect target index.
      activeIndex = targetIndex;
    } else if (filteredItems.length > 0) {
      // No exact match but filtered items exist: default to first item.
      activeIndex = 0;
    } else {
      // No items available (e.g. unlisted custom language): reset active index.
      activeIndex = -1;
    }

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

    // Focus input and select all text so typing immediately replaces while Enter immediately accepts.
    input.focus();
    // Check if select method is available on input element.
    if (typeof input.select === 'function') {
      input.select();
    } else {
      // select() not supported in current environment.
    }
  }

  /**
   * Closes the language picker dialog.
   *
   * @purpose Closes the modal dialog element idempotently across environments.
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
      // Check if native close() method is supported.
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
   * Tears down the language picker component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes the dialog, and removes element from document body.
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
     * @purpose Returns boolean indicating whether the language picker dialog is currently open.
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
