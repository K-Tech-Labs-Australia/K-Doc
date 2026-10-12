/**
 * @file search-panel.ts
 * @purpose Implements SearchPanel, the vault-wide find-and-replace panel for K-Doc's left sidebar (FR-9.5).
 *   Renders an accessible query input with case/word/regex toggles, a replace field with Replace and Undo actions,
 *   a status readout, and a scrollable body presenting debounced vault matches with per-match selection. Handles empty
 *   vault, empty query, zero-match, multi-match, invalid-regex, unreadable-note, and truncated-result states, plus
 *   full-text replace across selected matches and undo, with complete lifecycle teardown.
 * @inputs SearchPanelOptions containing Document context, vault search/replace/undo callbacks, vault status accessor,
 *   match-open handler, and canUndo predicate.
 * @outputs SearchPanel controller exposing mounted element, refresh, focus, and destroy lifecycle methods, alongside
 *   SEARCH_PANEL_STYLES and SEARCH_DEBOUNCE_MS definitions.
 * @functions
 *   - installSearchPanel: Instantiates the DOM hierarchy, binds debounced search and replace handling with AbortControllers,
 *     and returns the SearchPanel controller.
 *   - messageOf: Extracts a human-readable error string from an unknown thrown value.
 *   - makeButton: Creates an accessible button element with optional tooltip/aria-label.
 *   - makeInput: Creates an accessible input element with aria-label.
 *   - pressed: Reports whether a toggle button is currently pressed via aria-pressed.
 *   - currentOptions: Derives the active case/word/regex modifiers from the toggle buttons.
 *   - say: Publishes status text and its semantic state to assistive technology.
 *   - showRows: Cancels any in-flight rows render and swaps the body's children.
 *   - emptyNote: Creates a kdoc-search-empty div with the given text.
 *   - syncButtons: Enables/disables actions and updates the replace label from the current selection count.
 *   - runSearch: Runs the debounced vault query, renders matches or empty states, and reports a summary.
 *   - runWrite: Serializes replace/undo writes, re-runs search after the write, and reports the result message.
 *   - replaceChosen: Replaces all currently selected matches using the on-screen query and options.
 *   - undoReplace: Undoes the last replace operation.
 *   - refresh: Immediately re-runs the current query without debouncing.
 *   - focus: Focuses the search input and selects its text content.
 *   - destroy: Idempotently cancels pending timers, aborts listeners, and empties child elements.
 * @dataflow Search input event -> debounced timer -> options.search(query) -> renderResults & selection -> replaceChildren on kdoc-search-body -> options.openMatch on match click; Replace/Undo buttons -> runWrite -> options.replace/undoReplace -> re-run search -> say status.
 * @controlflow Construct root, query row, replace row, status, and body DOM -> bind timer functions -> attach input/keydown/toggle/replace/undo listeners -> run initial refresh -> return SearchPanel controller interface.
 * @version 2
 * @date 2026-09-14
 */

import type { FileMatch, SearchOptions } from '@k-doc/core';
import type { ReplaceReport, ReplaceRequest, UndoReport, VaultSearchOutcome } from './vault-search-controller.js';
import { createResultSelection, renderResults } from './search-results-view.js';
import { matchSummary, plural, replaceSummary, undoSummary } from './search-panel-text.js';
export { SEARCH_PANEL_STYLES } from './search-panel-text.js';

export interface SearchPanelOptions {
  readonly doc: Document;
  readonly hasVault: () => boolean;
  readonly search: (query: string, options: SearchOptions, signal: AbortSignal) => Promise<VaultSearchOutcome>;
  readonly replace: (request: ReplaceRequest) => Promise<ReplaceReport>;
  readonly undoReplace: () => Promise<UndoReport | null>;
  readonly canUndo: () => boolean;
  readonly openMatch: (path: string, match: FileMatch) => void;
}

export interface SearchPanel { readonly element: HTMLElement; refresh(): void; focus(): void; destroy(): void; }

/** Debounce delay in milliseconds before dispatching vault search queries. */
export const SEARCH_DEBOUNCE_MS: number = 150;

/**
 * Extracts a human-readable error string from an unknown thrown value.
 *
 * @purpose Normalizes any caught value into displayable text for the status line.
 * @inputs caught - The value thrown or rejected by an awaited operation.
 * @outputs string - The Error.message when available, otherwise String(caught).
 * @dataflow caught -> instanceof check -> message string.
 * @controlflow Return Error.message when caught is an Error; else stringify it.
 */
function messageOf(caught: unknown): string {
  // Extract readable error text: use Error.message when the value is an Error, otherwise stringify it.
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Creates an accessible button element with an optional tooltip and aria-label.
 *
 * @purpose Instantiates a <button type="button"> with text content and, when provided, an accessible name.
 * @inputs doc - Document context used for DOM node instantiation.
 * @inputs className - The CSS class applied to the button.
 * @inputs text - The button's visible label via textContent.
 * @inputs title - Optional tooltip/accessible name; empty means the text content is the only name.
 * @outputs HTMLButtonElement - Configured button DOM element.
 * @dataflow className, text, title -> button attributes and textContent -> returned button.
 * @controlflow Create button -> set type, class, and text -> add aria-label/title only when a title exists -> return it.
 */
function makeButton(doc: Document, className: string, text: string, title: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  // Provide an accessible name from the tooltip only when one exists; otherwise the button's own text is its label.
  if (title !== '') {
    b.title = title;
    b.setAttribute('aria-label', title);
  } else {
    // The button's text content already names it, so no aria-label or tooltip is added.
  }
  return b;
}

/**
 * Creates an accessible input element with a fixed search-input class and an aria-label.
 *
 * @purpose Instantiates an <input> with the given type, placeholder, and accessible name.
 * @inputs doc - Document context used for DOM node instantiation.
 * @inputs type - The input's type attribute (e.g. 'search' or 'text').
 * @inputs placeholder - The placeholder text shown when empty.
 * @inputs label - The aria-label describing the input to assistive technology.
 * @outputs HTMLInputElement - Configured input DOM element.
 * @dataflow type, placeholder, label -> input attributes -> returned input.
 * @controlflow Create input -> set type, class, placeholder, and aria-label -> return it.
 */
function makeInput(doc: Document, type: string, placeholder: string, label: string): HTMLInputElement {
  const i = doc.createElement('input');
  i.type = type;
  i.className = 'kdoc-search-input';
  i.placeholder = placeholder;
  i.setAttribute('aria-label', label);
  return i;
}

/**
 * Installs the search panel into an owned DOM hierarchy, configuring debounced search and replace handling,
 * per-match selection, status announcements, and resource cleanup lifecycles.
 *
 * @purpose Creates the root, query row, replace row, status readout, and stable body, binds lifecycle methods,
 *   and returns the SearchPanel controller.
 * @inputs options - SearchPanelOptions providing Document context, vault state accessor, search/replace/undo callbacks,
 *   match-open handler, and canUndo predicate.
 * @outputs SearchPanel - Controller interface exposing mounted element, refresh, focus, and destroy methods.
 * @dataflow User input events -> debounced runSearch() -> options.search() -> renderResults & selection -> replaceChildren on body;
 *   Replace/Undo clicks -> runWrite -> options.replace/undoReplace -> re-run search -> say status.
 * @controlflow Construct root, query row, replace row, status, and body DOM -> bind timer functions -> attach listeners -> run initial refresh -> return controller.
 */
export function installSearchPanel(options: SearchPanelOptions): SearchPanel {
  const doc = options.doc;
  const lifetime = new AbortController();
  // Take timer functions from options.doc.defaultView when present, falling back to globalThis:
  // a panel built against a detached document has no window of its own, and reaching for the
  // global directly would make the panel untestable against one.
  const win = doc.defaultView ?? globalThis;
  const setTimer = win.setTimeout.bind(win);
  const clearTimer = win.clearTimeout.bind(win);
  let destroyed = false;
  let debounceTimer: ReturnType<typeof setTimer> | null = null;
  let running: AbortController | null = null;
  let rowsAbort: AbortController | null = null;
  let current: VaultSearchOutcome | null = null;
  let currentKey = '';
  // The query and options that produced the results currently on screen, kept in sync with every successful search so
  // replace uses those even if the user edits the box afterwards.
  let currentQuery = '';
  let currentSearchOptions: SearchOptions = {};
  let busy = false;
  const selection = createResultSelection();

  const root = doc.createElement('div');
  root.className = 'kdoc-search-panel';
  const queryRow = doc.createElement('div');
  queryRow.className = 'kdoc-search-row';
  const queryInput = makeInput(doc, 'search', 'Search the vault…', 'Search the vault');
  const caseButton = makeButton(doc, 'kdoc-search-toggle', 'Aa', 'Match case');
  const wordButton = makeButton(doc, 'kdoc-search-toggle', 'W', 'Whole word');
  const regexButton = makeButton(doc, 'kdoc-search-toggle', '.*', 'Regular expression');
  for (const toggle of [caseButton, wordButton, regexButton]) {
    // All three modifiers start in the off state.
    toggle.setAttribute('aria-pressed', 'false');
  }
  queryRow.append(queryInput, caseButton, wordButton, regexButton);
  const replaceRow = doc.createElement('div');
  replaceRow.className = 'kdoc-search-row';
  const replaceInput = makeInput(doc, 'text', 'Replace with…', 'Replace with');
  const replaceButton = makeButton(doc, 'kdoc-search-action', 'Replace', '');
  const undoButton = makeButton(doc, 'kdoc-search-action', 'Undo', 'Undo the last replace');
  replaceRow.append(replaceInput, replaceButton, undoButton);
  const status = doc.createElement('div');
  status.className = 'kdoc-search-count';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = doc.createElement('div');
  body.className = 'kdoc-search-body';
  root.append(queryRow, replaceRow, status, body);

  /**
   * Reports whether a toggle button is currently pressed.
   *
   * @purpose Reads the aria-pressed attribute to determine a modifier toggle's on/off state.
   * @inputs button - The toggle button whose pressed state is being queried.
   * @outputs boolean - True when aria-pressed is 'true'.
   * @dataflow button aria-pressed attribute -> string comparison -> boolean result.
   * @controlflow Compare aria-pressed to 'true' -> return the equality result.
   */
  function pressed(button: HTMLButtonElement): boolean {
    // A toggle button reports its state through aria-pressed.
    return button.getAttribute('aria-pressed') === 'true';
  }

  /**
   * Derives the active match modifiers from the three toggle buttons.
   *
   * @purpose Combines case/word/regex toggle states into a SearchOptions object for the next query.
   * @inputs void (closes over caseButton, wordButton, regexButton).
   * @outputs SearchOptions - The current caseSensitive, wholeWord, and regex flags.
   * @dataflow Toggle pressed states -> SearchOptions literal.
   * @controlflow Read each toggle's pressed state -> build the options object.
   */
  function currentOptions(): SearchOptions {
    // Derive the active match modifiers from the three toggle buttons' pressed states.
    return { caseSensitive: pressed(caseButton), wholeWord: pressed(wordButton), regex: pressed(regexButton) };
  }

  /**
   * Publishes status text and its semantic state to assistive technology.
   *
   * @purpose Updates the live region's text and marks it info or error for screen readers.
   * @inputs text - The status message to announce.
   * @inputs state - 'info' for normal results, 'error' for failures.
   * @outputs void.
   * @dataflow text and state -> status.textContent and data-state attribute.
   * @controlflow Set text content then set the data-state attribute.
   */
  function say(text: string, state: 'info' | 'error'): void {
    // Publish the status line text and its semantic state to assistive technology.
    status.textContent = text;
    status.setAttribute('data-state', state);
  }

  /**
   * Swaps the body's children, cancelling any in-flight render first.
   *
   * @purpose Replaces kdoc-search-body contents while aborting a previous pending rows render.
   * @inputs nodes - The DOM nodes to present as the new body contents.
   * @outputs void.
   * @dataflow nodes -> (abort prior render) -> body.replaceChildren(nodes).
   * @controlflow Abort prior rows render if present -> replace body children with nodes.
   */
  function showRows(nodes: readonly HTMLElement[]): void {
    // Cancel any in-flight rows render before swapping the body's children.
    if (rowsAbort !== null) {
      rowsAbort.abort();
      rowsAbort = null;
    } else {
      // No prior rows render to cancel.
    }
    body.replaceChildren(...nodes);
  }

  /**
   * Creates an empty-state readout element.
   *
   * @purpose Instantiates a kdoc-search-empty div carrying the given message text.
   * @inputs text - The message to display in the empty state.
   * @outputs HTMLElement - The configured empty-state div.
   * @dataflow text -> div.textContent -> returned element.
   * @controlflow Create div -> set class and text content -> return it.
   */
  function emptyNote(text: string): HTMLElement {
    const e = doc.createElement('div');
    e.className = 'kdoc-search-empty';
    e.textContent = text;
    return e;
  }

  /**
   * Reflects the current selection and busy state onto the action buttons.
   *
   * @purpose Enables or disables Replace/Undo and updates the Replace label from the match count.
   * @inputs void (closes over current, busy, selection).
   * @outputs void.
   * @dataflow selection.count(current) -> button.disabled and replaceButton.textContent.
   * @controlflow Count chosen matches -> set replace disabled/label -> set undo disabled.
   */
  function syncButtons(): void {
    let chosen = 0;
    // Count the currently selected matches only when there are results to select from.
    if (current !== null) {
      chosen = selection.count(current);
    } else {
      // No results: nothing is chosen.
    }
    replaceButton.disabled = busy || current === null || chosen === 0;
    // Show how many matches are selected so the action reflects what will happen.
    if (chosen > 0) {
      replaceButton.textContent = `Replace ${chosen}`;
    } else {
      // Nothing chosen: the plain label, on a disabled button.
      replaceButton.textContent = 'Replace';
    }
    undoButton.disabled = busy || !options.canUndo();
  }

  /**
   * Runs the debounced vault query and updates status, body, and button state.
   *
   * @purpose Executes a vault search, renders matches or empty states, and reports a summary line.
   * @inputs void (closes over queryInput, replaceInput, toggles, current, selection).
   * @outputs void.
   * @dataflow queryInput.value -> options.search() -> renderResults/emptyNote -> body children; status via say.
   * @controlflow Guard destroyed -> cancel prior search -> handle no-vault and empty-query early returns -> run query -> render or summarize -> report errors.
   */
  async function runSearch(): Promise<void> {
    // Guard against running after teardown.
    if (destroyed) {
      return;
    } else {
      // Component is active: proceed with the search.
    }
    // Cancel any in-flight search so only the latest query runs to completion.
    if (running !== null) {
      running.abort();
      running = null;
    } else {
      // No prior search in flight.
    }
    // Disable both inputs when there is no vault, then report the empty state and stop.
    if (!options.hasVault()) {
      queryInput.disabled = true;
      replaceInput.disabled = true;
      current = null;
      showRows([emptyNote('No folder open.')]);
      say('', 'info');
      syncButtons();
      return;
    } else {
      // A vault is open: keep the inputs enabled.
      queryInput.disabled = false;
      replaceInput.disabled = false;
    }
    // Not trimmed: a leading or trailing space can be exactly what the user is looking for.
    const query = queryInput.value;
    // Check for an empty box: an empty query is no search, so the list and the status line are cleared.
    if (query === '') {
      current = null;
      showRows([]);
      say('', 'info');
      syncButtons();
      return;
    } else {
      // Non-empty query: continue to run the search.
    }
    const searchOptions = currentOptions();
    const controller = new AbortController();
    running = controller;
    try {
      const outcome = await options.search(query, searchOptions, controller.signal);
      // Check whether a newer search or teardown superseded this one while it read the vault.
      if (controller.signal.aborted || destroyed) {
        // Superseded: its answer is no longer wanted, and the newer search draws its own.
        return;
      } else {
        // Still the latest search: it is no longer running.
        running = null;
      }
      const key = JSON.stringify([query, searchOptions]);
      // A new query starts with every match chosen; the same query run again keeps what was unticked.
      if (key !== currentKey) {
        selection.reset();
        currentKey = key;
      } else {
        // Same query as before: keep the previously chosen matches.
      }
      // Record the query and options that produced these results so replace uses them, even if the box changed afterwards.
      currentQuery = query;
      currentSearchOptions = searchOptions;
      current = outcome;
      // Check whether anything matched.
      if (outcome.totalMatches === 0) {
        // Nothing matched: say so in the body rather than leaving it blank.
        showRows([emptyNote('No matches.')]);
      } else {
        // Matches: drop the old rows and their listeners, then draw the groups with listeners of their own.
        showRows([]);
        rowsAbort = new AbortController();
        body.replaceChildren(...renderResults(outcome, { doc, selection, openMatch: options.openMatch, onSelectionChange: syncButtons, signal: rowsAbort.signal }));
      }
      let summary = matchSummary(outcome.totalMatches, outcome.files.length);
      // Check whether the match limit stopped the search before the end of the vault.
      if (outcome.truncated) {
        summary = `${summary} (stopped at the limit; narrow the search)`;
      } else {
        // Not truncated: no stop-limit warning appended.
      }
      // Check whether any note could not be read, and so was not searched.
      if (outcome.unreadable.length > 0) {
        summary = `${summary}; ${plural(outcome.unreadable.length, 'note', 'notes')} could not be read`;
      } else {
        // All notes were readable: no unreadable note appended.
      }
      say(summary, 'info');
      syncButtons();
    } catch (caught: unknown) {
      // Check whether the failure belongs to a search already superseded (an abort rejects with its reason).
      if (controller.signal.aborted || destroyed) {
        // Superseded: the rejection is the cancellation itself, and says nothing the user needs.
        return;
      } else {
        // The latest search failed: it is no longer running, and the failure is shown below.
        running = null;
      }
      current = null;
      showRows([]);
      // Shown as reported: an InvalidQueryError already reads "Invalid regular expression: /fox(/gi: Unterminated group",
      // as the find bar shows it, and any other failure (an unreadable vault, a host error) names itself.
      say(messageOf(caught), 'error');
      syncButtons();
    }
  }

  /**
   * Serializes a replace/undo write, then re-runs the search and reports the outcome.
   *
   * @purpose Runs one write callback under a busy guard, re-queries the vault, and announces the result message.
   * @inputs write - Callback returning the write's message and whether it failed.
   * @outputs void.
   * @dataflow write() -> message/state -> runSearch() (refreshes list) -> say(message, state).
   * @controlflow Guard destroyed/busy -> set busy -> run write with error handling -> clear busy -> re-run search -> announce result.
   */
  async function runWrite(write: () => Promise<{ readonly message: string; readonly failed: boolean }>): Promise<void> {
    // Skip writes while destroyed or already busy so writes cannot overlap.
    if (destroyed || busy) {
      return;
    } else {
      // Ready to write: proceed.
    }
    busy = true;
    syncButtons();
    let message: string;
    let state: 'info' | 'error';
    try {
      const result = await write();
      message = result.message;
      // A write that failed for any note is reported as an error; otherwise as information.
      state = result.failed ? 'error' : 'info';
    } catch (caught: unknown) {
      message = messageOf(caught);
      state = 'error';
    }
    // Check whether the panel was torn down while the write was in progress.
    if (destroyed) {
      // Torn down: there is no panel left to report into.
      return;
    } else {
      // Not destroyed since the write started: continue updating the UI.
    }
    busy = false;
    // The search runs again so the list shows the vault as it now is; the write's own message is said after, since the search replaces the status line.
    await runSearch();
    say(message, state);
    syncButtons();
  }

  /**
   * Replaces all currently selected matches using the on-screen query and options.
   *
   * @purpose Dispatches a replace for every chosen match via runWrite, using results-on-screen context.
   * @inputs void (closes over current, selection, replaceInput, currentQuery, currentSearchOptions).
   * @outputs void.
   * @dataflow selection.chosen(current) + replacement -> options.replace() -> runWrite summary.
   * @controlflow Guard no-results -> gather selections -> guard nothing-selected -> run write.
   */
  function replaceChosen(): void {
    // Only a completed search has matches to replace.
    if (current === null) {
      return;
    } else {
      // Results are present: proceed with the replace.
    }
    const selections = selection.chosen(current);
    // Nothing selected: nothing to replace.
    if (selections.size === 0) {
      return;
    } else {
      // At least one match is selected: proceed with the replace.
    }
    const replacement = replaceInput.value;
    // Use the query and options of the results on screen, which may differ from the box if the user typed after the search.
    void runWrite(async () => {
      const report = await options.replace({ query: currentQuery, options: currentSearchOptions, replacement, selections });
      return { message: replaceSummary(report), failed: report.failures.length > 0 };
    });
  }

  /**
   * Undoes the last replace operation.
   *
   * @purpose Dispatches an undo via runWrite and reports its summary or a no-op message.
   * @inputs void (closes over options.undoReplace).
   * @outputs void.
   * @dataflow options.undoReplace() -> undoSummary/report -> runWrite.
   * @controlflow Run write that branches on null report -> summarize result.
   */
  function undoReplace(): void {
    void runWrite(async () => {
      const report = await options.undoReplace();
      // A null report means there was no previous replace to revert.
      if (report === null) {
        return { message: 'Nothing to undo.', failed: false };
      } else {
        // A replace was undone: report what was restored, skipped, or failed.
        return { message: undoSummary(report), failed: report.failures.length > 0 };
      }
    });
  }

  /**
   * Immediately re-runs the current query without debouncing.
   *
   * @purpose Cancels any pending debounce timer and runs the search now, for index changes under an existing query.
   * @inputs void (closes over debounceTimer, runSearch).
   * @outputs void.
   * @dataflow Current query in queryInput -> runSearch() -> DOM updates.
   * @controlflow Guard destroyed -> cancel pending timer -> run search immediately.
   */
  function refresh(): void {
    // Guard against refreshing after teardown.
    if (destroyed) {
      // Torn down: nothing to refresh.
      return;
    } else {
      // Component is active: proceed with the immediate search.
    }
    // A refresh supersedes any pending debounce timer so it runs now.
    if (debounceTimer !== null) {
      clearTimer(debounceTimer);
      debounceTimer = null;
    } else {
      // No debounce timer currently pending.
    }
    void runSearch();
  }

  /**
   * Focuses the search input and selects its text content.
   *
   * @purpose Places the caret in the box and selects all text so a follow-up command replaces rather than appends.
   * @inputs void (closes over queryInput).
   * @outputs void.
   * @dataflow DOM focus/select calls on queryInput.
   * @controlflow Guard destroyed -> focus then select.
   */
  function focus(): void {
    // Guard against focusing after teardown.
    if (destroyed) {
      return;
    } else {
      // Component is active: move the caret into the box.
    }
    queryInput.focus();
    queryInput.select();
  }

  /**
   * Idempotently tears down the panel's timers, listeners, and DOM children.
   *
   * @purpose Cancels pending timers, aborts in-flight searches and renders, aborts listeners, and empties the root.
   * @inputs void (closes over timers, controllers, lifetime, root).
   * @outputs void.
   * @dataflow abort signals -> clear timers -> replaceChildren() -> reset DOM.
   * @controlflow Guard idempotency -> mark destroyed -> cancel debounce timer -> abort running and rows renders -> abort lifetime -> empty root.
   */
  function destroy(): void {
    // Idempotent teardown: only the first call performs cleanup.
    if (destroyed) {
      // Already torn down: nothing left to release.
      return;
    } else {
      // First teardown: mark it so every pending callback stops.
      destroyed = true;
    }
    // Check for a pending debounced search.
    if (debounceTimer !== null) {
      clearTimer(debounceTimer);
      debounceTimer = null;
    } else {
      // No debounce timer currently pending.
    }
    // Check for a search in flight.
    if (running !== null) {
      running.abort();
      running = null;
    } else {
      // No search in flight to cancel.
    }
    // Check for drawn rows whose listeners are still attached.
    if (rowsAbort !== null) {
      rowsAbort.abort();
      rowsAbort = null;
    } else {
      // No rows render in flight to cancel.
    }
    lifetime.abort();
    root.replaceChildren();
  }

  const signal = lifetime.signal;
  queryInput.addEventListener(
    'input',
    (): void => {
      // Cancel a pending debounce timer from a previous keystroke before scheduling a new one.
      if (debounceTimer !== null) {
        clearTimer(debounceTimer);
      } else {
        // No debounce timer currently pending to cancel.
      }
      debounceTimer = setTimer((): void => {
        debounceTimer = null;
        void runSearch();
      }, SEARCH_DEBOUNCE_MS);
    },
    { signal },
  );
  queryInput.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      // Enter re-runs the current query immediately rather than submitting a form.
      if (event.key === 'Enter') {
        event.preventDefault();
        refresh();
      } else {
        // Not Enter: let the input handle the key normally.
      }
    },
    { signal },
  );
  for (const button of [caseButton, wordButton, regexButton]) {
    button.addEventListener(
      'click',
      (): void => {
        // Toggle the pressed state so the modifier reflects its new value.
        if (pressed(button)) {
          button.setAttribute('aria-pressed', 'false');
        } else {
          // Off: turn it on.
          button.setAttribute('aria-pressed', 'true');
        }
        refresh();
      },
      { signal },
    );
  }
  replaceButton.addEventListener('click', replaceChosen, { signal });
  undoButton.addEventListener('click', undoReplace, { signal });

  // Execute initial refresh to render the panel's starting state.
  refresh();

  return { element: root, refresh, focus, destroy };
}
