/**
 * @file spell-dialog.ts
 * @purpose Implements SpellDialog, an accessible modal dialog using the native HTMLDialogElement for interactive F7 document spelling review (FR-12.1).
 * @inputs SpellDialogOptions containing Document context, SpellCheck controller instance, and reveal callback.
 * @outputs SpellDialog controller instance exposing open, close, isOpen, and destroy lifecycle methods, alongside SPELL_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installSpellDialog: Constructs, styles, and mounts the native modal spelling review dialog into the document body, wiring review controls, suggestions list, action buttons, and keyboard navigation.
 * @dataflow spell.checkNow() -> spell.misspellings() -> reveal(span) -> spell.suggest(word) -> user action (Change / Change All / Ignore / Ignore All / Add to Dictionary) -> spell mutation -> misspellings() re-read & clamp.
 * @controlflow Mount native dialog to document body -> await spell.checkNow() on open() -> if clean render clean message, else display misspelled word & suggestions -> bind action buttons and keyboard listeners with AbortController -> update view and clamp index after each action -> clean up via destroy().
 * @version 3
 * @date 2026-10-04
 */

import type { WordSpan } from '@k-doc/editor';
import type { SpellCheck } from './spell-check.js';

export const SPELL_DIALOG_STYLES: string = `
dialog.kdoc-spell-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 480px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

/* An explicit \`display\` on a class beats the user-agent's \`[hidden] { display: none }\` rule, which is
   why the review panels stayed on screen underneath the clean-result message: .kdoc-spell-review-body
   sets display: flex, and \`hidden\` lost. Restating it at higher specificity is what makes \`hidden\`
   mean hidden for every panel in this dialog rather than only the ones with no display of their own. */

.kdoc-spell-dialog [hidden] {
  display: none;
}

/* Ensure closed dialogs never remain visible when flex layout is applied. */

dialog.kdoc-spell-dialog:not([open]) {
  display: none;
}

dialog.kdoc-spell-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-spell-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.kdoc-spell-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-spell-review-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.kdoc-spell-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kdoc-spell-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.kdoc-spell-section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-spell-count {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-variant-numeric: tabular-nums;
}

.kdoc-spell-context-box {
  padding: 8px 12px;
  background: var(--kdoc-chrome-base);
  border: 0;
  border-radius: var(--kdoc-radius-md);
  box-shadow: none;
  min-height: 36px;
  box-sizing: border-box;
  font-size: 13px;
  line-height: 1.4;
  color: var(--kdoc-chrome-text);
  word-break: break-word;
}

.kdoc-spell-word {
  color: var(--kdoc-emissive-red);
  font-weight: 600;
  text-decoration: underline wavy var(--kdoc-emissive-red);
}

.kdoc-spell-suggestions-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  border: 0;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  max-height: 140px;
  min-height: 72px;
  overflow-y: auto;
  box-sizing: border-box;
}

.kdoc-spell-suggestions-list:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-spell-suggestion-item {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  user-select: none;
  border-radius: var(--kdoc-radius-sm);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-spell-suggestion-item:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-spell-suggestion-item[aria-selected="true"],
.kdoc-spell-suggestion-item.kdoc-selected {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-spell-no-suggestions {
  padding: 8px 12px;
  font-size: 13px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-spell-clean-message {
  margin: 12px 0 20px 0;
  font-size: 14px;
  color: var(--kdoc-emissive-green);
}

.kdoc-spell-dialog-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.kdoc-spell-dialog-button {
  min-height: 28px;
  border-radius: var(--kdoc-radius-pill);
  padding: 4px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-sizing: border-box;
  border: 1px solid var(--kdoc-chrome-edge);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-spell-dialog-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-spell-dialog-button:active:not(:disabled),
.kdoc-spell-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-spell-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-spell-dialog-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-spell-btn-primary {
  border: 1px solid var(--kdoc-chrome-edge);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
}

.kdoc-spell-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-spell-btn-primary:active:not(:disabled) {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-spell-suggestions-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-spell-suggestions-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-spell-suggestions-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-spell-dialog,
  dialog.kdoc-spell-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

export interface SpellDialogOptions {
  readonly doc: Document;
  readonly spell: SpellCheck;
  /** Moves the caret to a span and scrolls it into view, so the user can see the word in context. */
  readonly reveal: (span: WordSpan) => void;
}

export interface SpellDialog {
  open(): Promise<void>;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple spell dialog instances. */
let nextSpellDialogId: number = 0;

/**
 * Installs the modal spelling review dialog into the document body, wiring review controls and action callbacks.
 *
 * @purpose Constructs, styles, and mounts the native modal spelling review dialog for interactive F7 document checking.
 * @inputs options - SpellDialogOptions containing Document context, SpellCheck controller, and reveal callback.
 * @outputs SpellDialog - Controller exposing open, close, isOpen, and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> spell check queries -> suggestions rendering -> action buttons -> DOM updates.
 * @controlflow Create dialog DOM hierarchy -> bind action buttons and keyboard listeners with AbortController -> append to body -> return SpellDialog controller.
 */
export function installSpellDialog(options: SpellDialogOptions): SpellDialog {
  const doc = options.doc;
  const dialogId = ++nextSpellDialogId;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;
  let currentIndex: number = 0;
  let currentSuggestions: readonly string[] = [];
  let selectedSuggestionIndex: number = 0;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-spell-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Spelling');

  // Header
  const header = doc.createElement('div');
  header.className = 'kdoc-spell-dialog-header';

  const heading = doc.createElement('h3');
  heading.className = 'kdoc-spell-heading';
  heading.textContent = 'Spelling';
  header.appendChild(heading);
  dialog.appendChild(header);

  // Clean result message (shown when no errors exist).
  const cleanMessage = doc.createElement('div');
  cleanMessage.className = 'kdoc-spell-clean-message';
  cleanMessage.textContent = 'No spelling errors found.';
  cleanMessage.hidden = true;
  dialog.appendChild(cleanMessage);

  // Review body container (shown when errors exist).
  const reviewContainer = doc.createElement('div');
  reviewContainer.className = 'kdoc-spell-review-body';

  // Section 1: Not in dictionary
  const notInDictSection = doc.createElement('div');
  notInDictSection.className = 'kdoc-spell-section';

  const notInDictHeader = doc.createElement('div');
  notInDictHeader.className = 'kdoc-spell-section-header';

  const notInDictLabel = doc.createElement('span');
  notInDictLabel.className = 'kdoc-spell-section-label';
  notInDictLabel.textContent = 'Not in dictionary';
  notInDictHeader.appendChild(notInDictLabel);

  const countElement = doc.createElement('span');
  countElement.className = 'kdoc-spell-count';
  countElement.textContent = '';
  notInDictHeader.appendChild(countElement);

  notInDictSection.appendChild(notInDictHeader);

  const contextBox = doc.createElement('div');
  contextBox.className = 'kdoc-spell-context-box';

  const wordElement = doc.createElement('span');
  wordElement.className = 'kdoc-spell-word';
  contextBox.appendChild(wordElement);

  notInDictSection.appendChild(contextBox);
  reviewContainer.appendChild(notInDictSection);

  // Section 2: Suggestions
  const suggestionsSection = doc.createElement('div');
  suggestionsSection.className = 'kdoc-spell-section';

  const suggestionsLabel = doc.createElement('span');
  suggestionsLabel.className = 'kdoc-spell-section-label';
  suggestionsLabel.textContent = 'Suggestions';
  suggestionsSection.appendChild(suggestionsLabel);

  const suggestionsList = doc.createElement('ul');
  suggestionsList.className = 'kdoc-spell-suggestions-list';
  suggestionsList.setAttribute('role', 'listbox');
  suggestionsList.setAttribute('tabindex', '0');
  suggestionsList.setAttribute('aria-label', 'Suggestions');
  suggestionsSection.appendChild(suggestionsList);

  reviewContainer.appendChild(suggestionsSection);
  dialog.appendChild(reviewContainer);

  // Section 3: Action Buttons
  const actionsContainer = doc.createElement('div');
  actionsContainer.className = 'kdoc-spell-dialog-actions';

  const changeButton = doc.createElement('button');
  changeButton.type = 'button';
  changeButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-change kdoc-spell-btn-primary';
  changeButton.textContent = 'Change';
  actionsContainer.appendChild(changeButton);

  const changeAllButton = doc.createElement('button');
  changeAllButton.type = 'button';
  changeAllButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-change-all';
  changeAllButton.textContent = 'Change All';
  actionsContainer.appendChild(changeAllButton);

  const ignoreButton = doc.createElement('button');
  ignoreButton.type = 'button';
  ignoreButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-ignore';
  ignoreButton.textContent = 'Ignore';
  actionsContainer.appendChild(ignoreButton);

  const ignoreAllButton = doc.createElement('button');
  ignoreAllButton.type = 'button';
  ignoreAllButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-ignore-all';
  ignoreAllButton.textContent = 'Ignore All';
  actionsContainer.appendChild(ignoreAllButton);

  const addButton = doc.createElement('button');
  addButton.type = 'button';
  addButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-add';
  addButton.textContent = 'Add to Dictionary';
  actionsContainer.appendChild(addButton);

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'kdoc-spell-dialog-button kdoc-spell-btn-close';
  closeButton.textContent = 'Close';
  actionsContainer.appendChild(closeButton);

  dialog.appendChild(actionsContainer);

  /**
   * Updates the selected suggestion item in the suggestions list.
   *
   * @purpose Highlights the active suggestion option, synchronizes ARIA selection, and scrolls into view.
   * @inputs index - number - Candidate suggestion index to select.
   * @outputs void.
   * @dataflow index -> clamped selectedSuggestionIndex -> DOM aria-selected and class updates.
   * @controlflow Check if suggestions array is empty -> clamp target index -> update selectedSuggestionIndex -> toggle aria-selected and class names on items.
   */
  function selectSuggestion(index: number): void {
    // Check if any suggestions are available.
    if (currentSuggestions.length === 0) {
      // Branch: No suggestions available to select.
      return;
    } else {
      // Branch: Suggestions present; proceed to clamp and select.
    }

    // Clamp index within valid suggestions bounds.
    let nextIndex: number = index;
    if (nextIndex < 0) {
      // Branch: Negative index requested; clamp to 0.
      nextIndex = 0;
    } else if (nextIndex >= currentSuggestions.length) {
      // Branch: Index exceeds suggestions count; clamp to last item.
      nextIndex = currentSuggestions.length - 1;
    } else {
      // Branch: Index is within valid range.
    }

    selectedSuggestionIndex = nextIndex;

    const items = suggestionsList.querySelectorAll<HTMLLIElement>('.kdoc-spell-suggestion-item');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Guard against undefined under strict indexing.
      if (item === undefined) {
        // Branch: Undefined item reference; skip.
        continue;
      } else {
        // Branch: Valid list item.
      }

      // Check if current item matches selected index.
      if (i === nextIndex) {
        // Branch: Matching active suggestion item; mark selected.
        item.setAttribute('aria-selected', 'true');
        item.classList.add('kdoc-selected');
        // Scroll selected item into visible listbox area.
        if (typeof item.scrollIntoView === 'function') {
          // Branch: scrollIntoView supported; invoke with nearest alignment.
          item.scrollIntoView({ block: 'nearest' });
        } else {
          // Branch: scrollIntoView not supported in test environment.
        }
      } else {
        // Branch: Inactive suggestion item; unmark selection.
        item.setAttribute('aria-selected', 'false');
        item.classList.remove('kdoc-selected');
      }
    }
  }

  /**
   * Renders suggestion options into the listbox container.
   *
   * @purpose Populates the suggestions listbox with candidate words or displays empty indicator.
   * @inputs suggestions - readonly string[] - Array of suggested corrections.
   * @outputs void.
   * @dataflow suggestions -> list items DOM rendering -> button enable/disable state.
   * @controlflow Clear existing list children -> if empty show placeholder and disable Change buttons, else populate items, preselect first, and enable buttons.
   */
  function renderSuggestions(suggestions: readonly string[]): void {
    // Clear previous suggestion DOM nodes.
    suggestionsList.replaceChildren();

    // Check if suggestions were returned for the misspelled word.
    if (suggestions.length === 0) {
      // When the current word has no suggestions, show (no suggestions) and disable Change / Change All
      // rather than hiding them — comment that a button that vanishes moves everything below it and makes
      // the dialog feel unstable while stepping through words.
      const emptyItem = doc.createElement('li');
      emptyItem.className = 'kdoc-spell-no-suggestions';
      emptyItem.textContent = '(no suggestions)';
      emptyItem.setAttribute('role', 'option');
      emptyItem.setAttribute('aria-disabled', 'true');
      suggestionsList.appendChild(emptyItem);

      changeButton.disabled = true;
      changeAllButton.disabled = true;
    } else {
      // Suggestions exist: enable Change and Change All buttons.
      changeButton.disabled = false;
      changeAllButton.disabled = false;

      for (let i = 0; i < suggestions.length; i++) {
        const itemText = suggestions[i];
        // Guard against undefined under strict indexing.
        if (itemText === undefined) {
          // Branch: Undefined suggestion entry; skip.
          continue;
        } else {
          // Branch: Valid suggestion text string.
        }

        const item = doc.createElement('li');
        item.id = `kdoc-spell-suggestion-${dialogId}-${i}`;
        item.className = 'kdoc-spell-suggestion-item';
        item.textContent = itemText;
        item.setAttribute('role', 'option');

        // Check if item is the preselected first suggestion.
        if (i === selectedSuggestionIndex) {
          // Branch: Preselected active item; mark aria-selected true.
          item.setAttribute('aria-selected', 'true');
          item.classList.add('kdoc-selected');
        } else {
          // Branch: Inactive item; mark aria-selected false.
          item.setAttribute('aria-selected', 'false');
        }

        // Single click selects item.
        const capturedIndex = i;
        item.addEventListener('click', (): void => {
          selectSuggestion(capturedIndex);
        }, { signal });

        // Double click selects item and immediately applies Change.
        item.addEventListener('dblclick', (): void => {
          selectSuggestion(capturedIndex);
          handleChange();
        }, { signal });

        suggestionsList.appendChild(item);
      }
    }
  }

  /**
   * Configures the dialog display for the clean state when no spelling errors exist.
   *
   * @purpose Displays clean result message and hides review controls, keeping only the Close button active.
   * @inputs void.
   * @outputs void.
   * @dataflow void -> update DOM hidden and disabled attributes.
   * @controlflow Hide reviewContainer -> show cleanMessage -> hide and disable mutation buttons -> show Close button and focus.
   */
  function showCleanState(): void {
    reviewContainer.hidden = true;
    cleanMessage.hidden = false;

    changeButton.hidden = true;
    changeButton.disabled = true;
    changeAllButton.hidden = true;
    changeAllButton.disabled = true;
    ignoreButton.hidden = true;
    ignoreButton.disabled = true;
    ignoreAllButton.hidden = true;
    ignoreAllButton.disabled = true;
    addButton.hidden = true;
    addButton.disabled = true;

    closeButton.hidden = false;
    closeButton.disabled = false;
    closeButton.focus();
  }

  /**
   * Configures the dialog display for the interactive review state.
   *
   * @purpose Displays misspelling context, suggestions, and all action buttons.
   * @inputs void.
   * @outputs void.
   * @dataflow void -> update DOM hidden and disabled attributes.
   * @controlflow Show reviewContainer -> hide cleanMessage -> unhide action buttons.
   */
  function showReviewState(): void {
    reviewContainer.hidden = false;
    cleanMessage.hidden = true;

    changeButton.hidden = false;
    changeAllButton.hidden = false;
    ignoreButton.hidden = false;
    ignoreButton.disabled = false;
    ignoreAllButton.hidden = false;
    ignoreAllButton.disabled = false;
    addButton.hidden = false;
    addButton.disabled = false;
    closeButton.hidden = false;
    closeButton.disabled = false;
  }

  /**
   * Refreshes the dialog view with the current misspellings and suggestions.
   *
   * @purpose Central update coordinator re-reading misspellings, clamping index, and updating DOM.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow spell.misspellings() -> index clamping -> reveal(span) -> spell.suggest(word) -> renderSuggestions().
   * @controlflow Check destroyed guard -> query live misspellings -> if empty showCleanState -> clamp currentIndex -> update word and count -> reveal current span -> fetch suggestions -> render suggestions.
   */
  async function updateView(): Promise<void> {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; abort view update.
      return;
    } else {
      // Branch: Component active; proceed.
    }

    // The list is re-read from spell.misspellings() after every action, not held as a snapshot.
    // This is the central decision — comment it at length: each correction shifts every later position,
    // and Ignore All / Add to Dictionary remove several entries at once. A snapshot taken at open would
    // address stale positions within two or three corrections. The dialog keeps only an index,
    // clamped after each re-read.
    const misspellings = options.spell.misspellings();

    // Check if there are any remaining misspellings in the document.
    if (misspellings.length === 0) {
      // No spelling errors found: display clean result state with only Close.
      // Reporting the clean result is the point of pressing F7, and closing silently would be
      // indistinguishable from the dialog failing to open.
      showCleanState();
      return;
    } else {
      // Errors exist: display review interface.
      showReviewState();
    }

    // Clamp current index within valid bounds of the newly read misspellings array.
    if (currentIndex >= misspellings.length) {
      // Branch: Index exceeds misspellings array length; clamp to last item.
      currentIndex = Math.max(0, misspellings.length - 1);
    } else if (currentIndex < 0) {
      // Branch: Negative index; clamp to first item.
      currentIndex = 0;
    } else {
      // Branch: Current index is within valid bounds.
    }

    const currentSpan = misspellings[currentIndex];
    // Guard against undefined span under strict indexing.
    if (currentSpan === undefined) {
      // Branch: Undefined span entry; abort view update.
      return;
    } else {
      // Branch: Current span is valid.
    }

    // Update "Not in dictionary" display and position count.
    wordElement.textContent = currentSpan.word;
    countElement.textContent = `${currentIndex + 1} of ${misspellings.length}`;

    // After every action, call reveal(...) for the new current span, so the document scrolls in step with the dialog.
    options.reveal(currentSpan);

    // Fetch suggestions for the active misspelled word.
    const suggestions = await options.spell.suggest(currentSpan.word);

    // Check if component was destroyed or dialog closed while awaiting suggestions.
    if (destroyed || !dialog.open) {
      // Branch: Dialog inactive or closed; suppress rendering.
      return;
    } else {
      // Branch: Dialog remains active and open.
    }

    currentSuggestions = suggestions;
    selectedSuggestionIndex = 0;
    renderSuggestions(suggestions);
  }

  /**
   * Replaces the current misspelled word with the selected suggestion.
   *
   * @purpose Applies spelling correction for the current span and refreshes document misspellings.
   * @inputs void.
   * @outputs void.
   * @dataflow selectedSuggestion -> spell.correct(span, suggestion) -> updateView().
   * @controlflow Check destroyed guard -> retrieve selected suggestion -> query current span -> invoke spell.correct -> trigger updateView().
   */
  function handleChange(): void {
    // Check if component has been destroyed or no suggestions exist.
    if (destroyed || currentSuggestions.length === 0) {
      // Branch: Component destroyed or no suggestions available; abort change.
      return;
    } else {
      // Branch: Component active with suggestions; proceed with change.
    }

    const selectedWord = currentSuggestions[selectedSuggestionIndex];
    // Check if selected word exists under strict indexing.
    if (selectedWord === undefined) {
      // Branch: Undefined suggestion entry; abort change.
      return;
    } else {
      // Branch: Selected suggestion word is valid.
    }

    const misspellings = options.spell.misspellings();
    const currentSpan = misspellings[currentIndex];
    // Check if current span exists under strict indexing.
    if (currentSpan === undefined) {
      // Branch: Undefined span entry; abort change.
      return;
    } else {
      // Branch: Current span is valid.
    }

    // Change calls spell.correct(span, selected).
    options.spell.correct(currentSpan, selectedWord);

    // Re-read misspellings and update view.
    void updateView();
  }

  /**
   * Replaces all occurrences of the current misspelled word in the document.
   *
   * @purpose Applies correction to every matching WordSpan in descending position order.
   * @inputs void.
   * @outputs void.
   * @dataflow currentSpan.word -> collect matching spans -> sort descending from -> spell.correct calls -> updateView().
   * @controlflow Check destroyed guard -> collect all matching spans -> sort back-to-front -> iterate and correct -> trigger updateView().
   */
  function handleChangeAll(): void {
    // Check if component has been destroyed or no suggestions exist.
    if (destroyed || currentSuggestions.length === 0) {
      // Branch: Component destroyed or no suggestions available; abort change all.
      return;
    } else {
      // Branch: Component active with suggestions; proceed with change all.
    }

    const selectedWord = currentSuggestions[selectedSuggestionIndex];
    // Check if selected word exists under strict indexing.
    if (selectedWord === undefined) {
      // Branch: Undefined suggestion entry; abort change all.
      return;
    } else {
      // Branch: Selected suggestion word is valid.
    }

    const misspellings = options.spell.misspellings();
    const currentSpan = misspellings[currentIndex];
    // Check if current span exists under strict indexing.
    if (currentSpan === undefined) {
      // Branch: Undefined span entry; abort change all.
      return;
    } else {
      // Branch: Current span is valid.
    }

    const targetWord = currentSpan.word;

    // Filter all spans matching the current misspelled word.
    const matchingSpans: WordSpan[] = [];
    for (let i = 0; i < misspellings.length; i++) {
      const s = misspellings[i];
      // Check if span is defined and matches target word.
      if (s !== undefined && s.word === targetWord) {
        // Branch: Matching span found; append to list.
        matchingSpans.push(s);
      } else {
        // Branch: Non-matching span or undefined entry; ignore.
      }
    }

    // Change All applies the replacement to every span in the current list whose word matches,
    // working from the end of the document backwards — comment that correcting back-to-front means
    // each edit only moves positions the loop has already passed, which is what makes it safe
    // without re-mapping between steps.
    matchingSpans.sort((a: WordSpan, b: WordSpan): number => b.from - a.from);

    for (let i = 0; i < matchingSpans.length; i++) {
      const s = matchingSpans[i];
      // Guard against undefined under strict indexing.
      if (s !== undefined) {
        // Branch: Valid span; apply correction.
        options.spell.correct(s, selectedWord);
      } else {
        // Branch: Undefined span entry under strict indexing.
      }
    }

    // Re-read misspellings and update view.
    void updateView();
  }

  /**
   * Advances the review to the next misspelling without persisting an ignore rule.
   *
   * @purpose Skips the current occurrence of the misspelled word for this review pass.
   * @inputs void.
   * @outputs void.
   * @dataflow currentIndex increment -> updateView().
   * @controlflow Check destroyed guard -> increment currentIndex -> trigger updateView().
   */
  function handleIgnore(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; abort ignore.
      return;
    } else {
      // Branch: Component active; proceed.
    }

    // Ignore advances the index without telling the service anything — comment that Ignore is
    // "not this one, this once", so it must not enter any list; Ignore All is the durable
    // version and is what the service is told about.
    currentIndex++;

    // Re-read misspellings, clamp index, and refresh display.
    void updateView();
  }

  /**
   * Permanently ignores all occurrences of the current misspelled word for this session.
   *
   * @purpose Registers the word in the spell check service's session ignore list.
   * @inputs void.
   * @outputs void.
   * @dataflow currentSpan.word -> spell.ignoreAll(word) -> updateView().
   * @controlflow Check destroyed guard -> query current span -> invoke spell.ignoreAll -> trigger updateView().
   */
  function handleIgnoreAll(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; abort ignore all.
      return;
    } else {
      // Branch: Component active; proceed.
    }

    const misspellings = options.spell.misspellings();
    const currentSpan = misspellings[currentIndex];
    // Check if current span exists under strict indexing.
    if (currentSpan === undefined) {
      // Branch: Undefined span entry; abort ignore all.
      return;
    } else {
      // Branch: Current span is valid.
    }

    // Ignore All is the durable version and is what the service is told about.
    options.spell.ignoreAll(currentSpan.word);

    // Re-read misspellings and update view.
    void updateView();
  }

  /**
   * Adds the current misspelled word to the user's custom persistent dictionary.
   *
   * @purpose Persists the word into the user dictionary and refreshes document spelling.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow currentSpan.word -> spell.addToDictionary(word) -> updateView().
   * @controlflow Check destroyed guard -> query current span -> await spell.addToDictionary -> check destroyed guard -> trigger updateView().
   */
  async function handleAddToDictionary(): Promise<void> {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; abort add to dictionary.
      return;
    } else {
      // Branch: Component active; proceed.
    }

    const misspellings = options.spell.misspellings();
    const currentSpan = misspellings[currentIndex];
    // Check if current span exists under strict indexing.
    if (currentSpan === undefined) {
      // Branch: Undefined span entry; abort add to dictionary.
      return;
    } else {
      // Branch: Current span is valid.
    }

    // Add word to user dictionary via spell check service.
    await options.spell.addToDictionary(currentSpan.word);

    // Check if component was destroyed or dialog closed while awaiting dictionary addition.
    if (destroyed || !dialog.open) {
      // Branch: Dialog inactive or closed; suppress view update.
      return;
    } else {
      // Branch: Component active.
    }

    // Re-read misspellings and update view.
    void updateView();
  }

  // Wire button event listeners with AbortController signal.
  changeButton.addEventListener('click', (): void => {
    handleChange();
  }, { signal });

  changeAllButton.addEventListener('click', (): void => {
    handleChangeAll();
  }, { signal });

  ignoreButton.addEventListener('click', (): void => {
    handleIgnore();
  }, { signal });

  ignoreAllButton.addEventListener('click', (): void => {
    handleIgnoreAll();
  }, { signal });

  addButton.addEventListener('click', (): void => {
    void handleAddToDictionary();
  }, { signal });

  closeButton.addEventListener('click', (): void => {
    close();
  }, { signal });

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    close();
  }, { signal });

  // Handle keyboard navigation within the dialog.
  dialog.addEventListener('keydown', (event: KeyboardEvent): void => {
    // Check if dialog is destroyed or closed.
    if (destroyed || !dialog.open) {
      // Branch: Inactive or closed dialog; ignore keyboard event.
      return;
    } else {
      // Branch: Active open dialog; process keyboard navigation.
    }

    // Check key code.
    if (event.key === 'Escape') {
      // Branch: Escape key pressed; close dialog.
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      // Branch: Down arrow key pressed; select next suggestion.
      event.preventDefault();
      selectSuggestion(selectedSuggestionIndex + 1);
    } else if (event.key === 'ArrowUp') {
      // Branch: Up arrow key pressed; select previous suggestion.
      event.preventDefault();
      selectSuggestion(selectedSuggestionIndex - 1);
    } else if (event.key === 'Enter') {
      // Branch: Enter key pressed.
      const activeEl = doc.activeElement;
      // Check if focus is on an action button other than Change.
      if (
        activeEl === closeButton ||
        activeEl === ignoreButton ||
        activeEl === ignoreAllButton ||
        activeEl === changeAllButton ||
        activeEl === addButton
      ) {
        // Branch: Focus is on another action button; let native button activation proceed.
        return;
      } else {
        // Branch: Focus is in dialog or suggestions list; trigger Change if enabled.
        if (!changeButton.disabled && !changeButton.hidden) {
          // Branch: Change button is active; trigger correction.
          event.preventDefault();
          handleChange();
        } else {
          // Branch: Change button disabled or hidden; no-op.
        }
      }
    } else {
      // Branch: Non-navigation key; allow default browser behavior.
    }
  }, { signal });

  // Mount the dialog element into the document body.
  options.doc.body.appendChild(dialog);

  /**
   * Opens the spelling review dialog, running an immediate document check and loading the first error.
   *
   * @purpose Initiates the F7 document spelling review walkthrough.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow spell.checkNow() -> showModal() -> updateView().
   * @controlflow Check destroyed guard -> reset currentIndex = 0 -> await spell.checkNow() -> open modal dialog -> updateView().
   */
  async function open(): Promise<void> {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; abort open.
      return;
    } else {
      // Branch: Component active; proceed with open.
    }

    // Reset index to start review from the first misspelling.
    currentIndex = 0;

    // open() awaits spell.checkNow() first so the list is current, then reads spell.misspellings().
    // If there are none, show a "No spelling errors found." state with only Close — comment that
    // reporting the clean result is the point of pressing F7, and closing silently would be
    // indistinguishable from the dialog failing to open.
    await options.spell.checkNow();

    // Check if component was destroyed during checkNow.
    if (destroyed) {
      // Branch: Component destroyed while awaiting checkNow; abort.
      return;
    } else {
      // Branch: Component remains active.
    }

    // Check if dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Branch: Dialog is already open; skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Branch: Native showModal supported; open as modal dialog with backdrop.
      dialog.showModal();
    } else {
      // Branch: Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Update view with live misspellings and suggestions.
    await updateView();
  }

  /**
   * Closes the spelling review dialog.
   *
   * @purpose Dismisses the modal dialog.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check destroyed guard -> check if dialog is open -> invoke dialog.close() or set open = false.
   */
  function close(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Branch: Component destroyed; return immediately.
      return;
    } else {
      // Branch: Component active; proceed with close.
    }

    // Check if dialog element is currently open.
    if (dialog.open) {
      // Check if native close() method is supported.
      if (typeof dialog.close === 'function') {
        // Branch: Native close() supported; invoke HTMLDialogElement API.
        dialog.close();
      } else {
        // Branch: Fallback for test environments lacking close(); update open property.
        dialog.open = false;
      }
    } else {
      // Branch: Dialog already closed; no-op.
    }
  }

  /**
   * Tears down the spelling review dialog component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes dialog, and removes element from document.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> dialog.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard -> mark destroyed = true -> abort controller -> close dialog -> remove dialog element from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Branch: Already destroyed; return immediately for idempotent teardown.
      return;
    } else {
      // Branch: Component active; mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Branch: Destroyed component; isOpen is false.
        return false;
      } else {
        // Branch: Active component; reflect dialog.open attribute.
        return dialog.open;
      }
    },
    destroy,
  };
}
