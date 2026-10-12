/**
 * @file find-panel.ts
 * @purpose Implements FindPanel, an accessible Word-style find and replace toolbar for K-Doc's Markdown editor.
 *   Search runs over the Markdown source text (`session.snapshot.text`), not over a rendered projection.
 *   That is deliberate: the source is K-Doc's document of record, the user can legitimately search for
 *   `](` or `**`, and a replacement is a text splice at known offsets that feeds straight back through
 *   the session leaving every untouched byte identical. Searching the rendered text would find things
 *   the file does not contain and miss things it does.
 * @inputs FindPanelOptions containing container HTMLElement, Document context, DocumentSession,
 *   revealRange callback, applyText callback, and onError callback.
 * @outputs FindPanel controller interface exposing isOpen, open, close, refresh, and destroy lifecycle
 *   methods, alongside FIND_PANEL_STYLES CSS stylesheet definition.
 * @functions
 *   - installFindPanel: Instantiates and mounts find and replace bar controls into the container, binds keyboard listeners, coordinates search navigation and replacements, and returns the FindPanel controller.
 * @dataflow User input / search queries / keyboard shortcuts -> findMatches / replaceMatch / replaceAll execution over session.snapshot.text -> match list & status readout updates -> revealRange selection & scrolling or applyText session updates.
 * @controlflow Initialize DOM hierarchy with Find and Replace rows -> attach input, click, and document-level keydown listeners with AbortController -> return FindPanel controller with open, close, refresh, and destroy lifecycle methods.
 * @version 4
 * @date 2026-10-04
 */

import type { DocumentSession, SearchMatch, SearchOptions, SearchScope } from '@k-doc/core';
import { scopeMatches } from '@k-doc/core';
import type { Root } from 'mdast';
import {
  findMatches,
  replaceAll,
  replaceMatch,
  nextMatchIndex,
  InvalidQueryError,
} from '@k-doc/core';

export interface FindPanelOptions {
  readonly container: HTMLElement;
  readonly doc: Document;
  readonly session: DocumentSession;
  /** Reveal and select [start, end) of the source text. The host owns pane visibility and scrolling. */
  readonly revealRange: (start: number, end: number) => void;
  /** Apply replaced source text. The host owns the edit lock, so the panel never calls applyText itself. */
  readonly applyText: (text: string) => void;
  readonly onError: (message: string) => void;

  /**
   * When false the panel does not claim Ctrl+F and Ctrl+H itself, because the host's remappable keymap opens it
   * (FR-14.16). Defaults to true.
   */
  readonly ownShortcuts?: boolean;

  /**
   * The parsed document and the caret offset, read fresh whenever a search runs (FR-9.4).
   *
   * The panel searches source text, so scoping by document semantics -- skip code, skip link URLs,
   * stay inside this section -- needs the tree the text parsed into. Taking it as a callback rather
   * than a value keeps the panel from holding a tree that the next keystroke makes stale.
   */
  readonly readScope?: () => { readonly root: Root; readonly caretOffset: number };

  /**
   * Reads the current selection as a [start, end) range in source text, or null if there is none (FR-9.2).
   *
   * This is a callback rather than a value because "search in selection" narrows by where the user's
   * selection sits, and that position changes as the panel navigates: its own next/previous move the
   * caret to each match, so re-reading here on every search would collapse the range to the current
   * match after the first jump. The range is therefore read once, when the option is switched on, and
   * held until it is switched off.
   */
  readonly readSelection?: () => { readonly start: number; readonly end: number } | null;

  /**
   * Reports the settled match list and active index to the host (FR-9.2).
   *
   * The host paints matches in both panes and in the scrollbar, surfaces the panel does not know about;
   * it owns the search but not those surfaces, so it reports here and lets the host decide how to paint.
   */
  readonly onMatches?: (matches: readonly SearchMatch[], activeIndex: number) => void;

  /**
   * Called after the panel closes so the host can return focus to a pane.
   *
   * Escape otherwise leaves focus on an input that is now hidden. K-Doc keys its edit lock on which
   * pane holds focus, so a stranded focus makes the next keystroke go nowhere.
   */
  readonly onClose: () => void;
}

export interface FindPanel {
  readonly isOpen: boolean;
  open(mode: 'find' | 'replace'): void;
  close(): void;
  /** Re-run the current query. Call when the document changed underneath the panel. */
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the find and replace panel, styling the tonal overlay bar,
 * sunken inputs, physical action/toggle buttons (extruded at rest, depressed with a tonal selection when active),
 * flat status readout, emissive red error notice, and rounded corners using exclusively authoritative K-Doc chrome design tokens.
 */
export const FIND_PANEL_STYLES: string = `
.kdoc-find-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-sizing: border-box;
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
}

/* The UA stylesheet's [hidden] { display: none } loses to class rules specifying display: flex.
   An explicit [hidden] selector rule is mandatory so elements with hidden = true never stay visible. */

.kdoc-find-bar[hidden] {
  display: none !important;
}

.kdoc-find-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.kdoc-find-row[hidden] {
  display: none !important;
}

.kdoc-find-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
  min-width: 48px;
}

.kdoc-find-input {
  min-height: 28px;
  height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 2px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  min-width: 180px;
  transition: box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.kdoc-find-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-find-status {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  min-width: 60px;
  padding: 0 4px;
}

.kdoc-find-error {
  font-size: 12px;
  color: var(--kdoc-emissive-red);
  padding: 0 4px;
}

.kdoc-find-error[hidden] {
  display: none !important;
}

.kdoc-find-button {
  min-width: 28px;
  min-height: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.kdoc-find-button[hidden] {
  display: none !important;
}

.kdoc-find-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-find-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-find-button:active:not(:disabled),
.kdoc-find-button[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-find-button:disabled {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0.4;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-find-bar * {
    transition: none !important;
  }
}
`;

/** Monotonically increasing identifier generator ensuring unique DOM element IDs across multiple find panel instances. */
let nextFindPanelId: number = 0;

/**
 * Installs the find and replace panel into the container element, configuring input fields,
 * navigation controls, search options toggles, and document-level keyboard listeners.
 *
 * @purpose Constructs DOM elements, wires search and replace event handlers, registers global shortcuts, and returns the FindPanel controller.
 * @inputs options - FindPanelOptions configuring the host container, document context, session, and callbacks.
 * @outputs FindPanel - Controller interface exposing isOpen, open, close, refresh, and destroy methods.
 * @dataflow Options -> DOM elements creation -> event listeners with AbortController -> search execution -> revealRange and applyText callbacks.
 * @controlflow Initialize DOM elements -> attach event handlers with AbortController -> register document keydown listener -> return FindPanel controller interface.
 */
export function installFindPanel(options: FindPanelOptions): FindPanel {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const panelId = ++nextFindPanelId;
  const findInputId = `kdoc-find-input-${panelId}`;
  const replaceInputId = `kdoc-replace-input-${panelId}`;

  let destroyed: boolean = false;
  let matches: readonly SearchMatch[] = [];
  let currentIndex: number = -1;
  let caseSensitive: boolean = false;
  let wholeWord: boolean = false;
  let isRegex: boolean = false;

  // The three FR-9.4 semantic options. They are off by default, because the plain-text behaviour is
  // what a user typing into a find box expects, and each of these narrows the result silently.
  let excludeCode: boolean = false;
  let excludeUrls: boolean = false;
  let sectionOnly: boolean = false;

  // "Search in selection" is the fourth narrowing option and the only one with a remembered value: the
  // range is captured when the option goes on, because the panel's own navigation moves the selection.
  let inSelection: boolean = false;
  let selectionRange: { readonly start: number; readonly end: number } | null = null;

  // Configure container element as accessible search region.
  options.container.classList.add('kdoc-find-bar');
  options.container.setAttribute('role', 'search');
  options.container.setAttribute('aria-label', 'Find and replace');
  options.container.hidden = true;

  /**
   * Constructs an accessible toolbar button element configured with standard attributes and styling.
   *
   * @purpose Creates and configures a button element with type, textContent, title, aria-label, and CSS classes.
   * @inputs text - The visible button text content.
   * @inputs title - Tooltip title text including label and keyboard shortcut.
   * @inputs ariaLabel - Accessible label for screen readers.
   * @inputs extraClass - Optional extra CSS class name for specific button styling.
   * @outputs HTMLButtonElement - The configured button element ready for DOM attachment.
   * @dataflow Button parameters -> DOM HTMLButtonElement creation and attribute population.
   * @controlflow Create button element -> set type to 'button' -> assign textContent, title, and aria-label -> apply CSS classes -> return element.
   */

  /**
   * Narrows raw matches by the FR-9.4 semantic options.
   *
   * @purpose Applies exclude-code, exclude-URL and this-section-only to a match list.
   * @inputs raw - Matches from findMatches. source - The source text they index into.
   * @outputs SearchMatch[] - The subset the enabled options allow.
   * @dataflow raw + readScope() -> scopeMatches -> filtered matches.
   * @controlflow Return raw untouched when no option is on or no scope reader was supplied.
   *
   * Filtering afterwards rather than teaching findMatches about the tree keeps one search
   * implementation; the semantics are a lens over it rather than a second code path.
   */
  function scopedMatches(raw: readonly SearchMatch[], source: string): SearchMatch[] {
    // Check whether any semantic option is on at all.
    if (!excludeCode && !excludeUrls && !sectionOnly) {
      // None on: skip parsing entirely. The common case must not pay for a feature it is not using.
      return [...raw];
    } else {
      // At least one is on: the parsed tree is needed.
    }

    // Check whether the host supplied a way to read the tree.
    if (options.readScope === undefined) {
      // Absent: the options cannot be honoured, so leave the matches alone rather than pretending to.
      return [...raw];
    } else {
      // Present: read it fresh, because the last keystroke may have changed the document.
    }

    const { root, caretOffset } = options.readScope();
    const scope: SearchScope = {
      excludeCodeBlocks: excludeCode,
      excludeLinkUrls: excludeUrls,
      sectionAt: sectionOnly ? caretOffset : null,
    };
    return [...scopeMatches(raw, root, source, scope)];
  }

  /**
   * Narrows matches to those wholly inside the captured selection range (FR-9.2).
   *
   * @purpose Keeps only matches whose [start, end) lies entirely within the selection range read when
   *   "search in selection" was turned on; drops everything else.
   * @inputs raw - Matches already narrowed by the semantic options.
   * @outputs SearchMatch[] - The subset lying wholly inside the selection, or raw untouched when off.
   * @dataflow raw + inSelection/selectionRange -> filtered matches.
   * @controlflow Return raw untouched when the option is off or no range was captured; otherwise keep
   *   only matches whose start and end both fall inside the range.
   */
  function selectedMatches(raw: readonly SearchMatch[]): SearchMatch[] {
    // Check whether "search in selection" is on and a range was actually captured.
    if (!inSelection || selectionRange === null) {
      // Option off or no usable range: nothing to narrow by, so leave the matches untouched.
      return [...raw];
    } else {
      // Option on with a live range: keep only matches wholly inside it.
    }

    const kept: SearchMatch[] = [];
    for (const m of raw) {
      // Keep a match only when both its endpoints lie within the selection bounds.
      if (m.start >= selectionRange.start && m.end <= selectionRange.end) {
        // Match lies wholly inside the range: include it.
        kept.push(m);
      } else {
        // Match straddles or falls outside the edge: exclude it, because "in selection" means the whole
        // match, not part of it — replacing half a word is not what the user asked for.
      }
    }

    return kept;
  }


  function createButton(
    text: string,
    title: string,
    ariaLabel: string,
    extraClass?: string,
  ): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);

    // Check if an additional CSS class is specified.
    if (extraClass !== undefined) {
      // Append extra class name to baseline find button class.
      button.className = `kdoc-find-button ${extraClass}`;
    } else {
      // Use baseline find button class name.
      button.className = 'kdoc-find-button';
    }

    return button;
  }

  // ---------------------------------------------------------------------------
  // Row 1: Find controls (Find input, match readout, error alert, Previous, Next, Case, Word, Regex)
  // ---------------------------------------------------------------------------
  const findRow = doc.createElement('div');
  findRow.className = 'kdoc-find-row';

  const findLabel = doc.createElement('label');
  findLabel.htmlFor = findInputId;
  findLabel.className = 'kdoc-find-label';
  findLabel.textContent = 'Find';
  findRow.appendChild(findLabel);

  const findInput = doc.createElement('input');
  findInput.id = findInputId;
  findInput.type = 'text';
  findInput.className = 'kdoc-find-input';
  findInput.setAttribute('autocomplete', 'off');
  findInput.setAttribute('spellcheck', 'false');
  findInput.setAttribute('aria-label', 'Find');
  findRow.appendChild(findInput);

  const readout = doc.createElement('span');
  readout.className = 'kdoc-find-status';
  readout.setAttribute('role', 'status');
  readout.setAttribute('aria-live', 'polite');
  findRow.appendChild(readout);

  const errorAlert = doc.createElement('span');
  errorAlert.className = 'kdoc-find-error';
  errorAlert.setAttribute('role', 'alert');
  errorAlert.hidden = true;
  findRow.appendChild(errorAlert);

  const prevButton = createButton('Previous', 'Previous match (Shift+Enter)', 'Previous');
  prevButton.disabled = true;
  findRow.appendChild(prevButton);

  const nextButton = createButton('Next', 'Next match (Enter)', 'Next');
  nextButton.disabled = true;
  findRow.appendChild(nextButton);

  const caseButton = createButton('Case', 'Match case', 'Match case');
  caseButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(caseButton);

  const wordButton = createButton('Word', 'Whole word', 'Whole word');
  wordButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(wordButton);

  const regexButton = createButton('Regex', 'Regular expression', 'Regular expression');
  regexButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(regexButton);

  // The three FR-9.4 semantic filters sit after the textual ones, because they narrow by what the
  // text *is* rather than by how it is matched, and the reading order should follow that.
  const codeButton = createButton('No code', 'Exclude code blocks and inline code', 'Exclude code');
  codeButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(codeButton);

  const urlButton = createButton('No URLs', 'Exclude link destination URLs', 'Exclude link URLs');
  urlButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(urlButton);

  const sectionButton = createButton('Section', 'Search only the heading section containing the caret', 'This section only');
  sectionButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(sectionButton);

  const selectionButton = createButton('In selection', 'Search within the current selection', 'Search in selection');
  selectionButton.setAttribute('aria-pressed', 'false');
  findRow.appendChild(selectionButton);

  options.container.appendChild(findRow);

  // ---------------------------------------------------------------------------
  // Row 2: Replace controls (Replace input, Replace button, Replace all button)
  // ---------------------------------------------------------------------------
  const replaceRow = doc.createElement('div');
  replaceRow.className = 'kdoc-find-row';
  replaceRow.hidden = true;

  const replaceLabel = doc.createElement('label');
  replaceLabel.htmlFor = replaceInputId;
  replaceLabel.className = 'kdoc-find-label';
  replaceLabel.textContent = 'Replace';
  replaceRow.appendChild(replaceLabel);

  const replaceInput = doc.createElement('input');
  replaceInput.id = replaceInputId;
  replaceInput.type = 'text';
  replaceInput.className = 'kdoc-find-input';
  replaceInput.setAttribute('autocomplete', 'off');
  replaceInput.setAttribute('spellcheck', 'false');
  replaceInput.setAttribute('aria-label', 'Replace');
  replaceRow.appendChild(replaceInput);

  const replaceButton = createButton('Replace', 'Replace', 'Replace');
  replaceButton.disabled = true;
  replaceRow.appendChild(replaceButton);

  const replaceAllButton = createButton('Replace all', 'Replace all', 'Replace all');
  replaceAllButton.disabled = true;
  replaceRow.appendChild(replaceAllButton);

  options.container.appendChild(replaceRow);

  /**
   * Updates disabled state on navigation and replace buttons based on match availability.
   *
   * @purpose Disables Next, Previous, Replace, and Replace all buttons when no matches exist, and enables them when matches are present.
   * @inputs void.
   * @outputs void.
   * @dataflow matches.length -> button disabled property updates.
   * @controlflow Check if matches length is greater than zero -> set button disabled states accordingly.
   */
  /**
   * Reports the settled match list and active index to the host (FR-9.2).
   *
   * @purpose Forwards matches and currentIndex to options.onMatches so the host can repaint its surfaces.
   * @inputs void.
   * @outputs void.
   * @dataflow matches + currentIndex -> options.onMatches callback.
   * @controlflow Invoke onMatches once with the current settled list and index.
   */
  function reportMatches(): void {
    // The host is told on every settle rather than only on a new search, because next/previous change
    // which match is active and its highlight has to follow even when the list itself does not.
    options.onMatches?.(matches, currentIndex);
  }

  function updateButtonsDisabled(): void {
    const hasMatches = matches.length > 0;
    // Check if one or more matches exist.
    if (hasMatches) {
      // Matches exist: enable navigation and replacement action buttons.
      prevButton.disabled = false;
      nextButton.disabled = false;
      replaceButton.disabled = false;
      replaceAllButton.disabled = false;
    } else {
      // No matches exist: disable navigation and replacement action buttons.
      prevButton.disabled = true;
      nextButton.disabled = true;
      replaceButton.disabled = true;
      replaceAllButton.disabled = true;
    }

    reportMatches();
  }

  /**
   * Recomputes search matches against the authoritative Markdown source text and updates status readout.
   *
   * @purpose Scans document source text with current query and options, handling regex errors and clamping the active match index.
   * @inputs void.
   * @outputs void.
   * @dataflow findInput.value + session.snapshot.text + SearchOptions -> findMatches -> matches array & readout text.
   * @controlflow Check destroyed flag -> check for empty query -> execute findMatches catching InvalidQueryError -> rethrow unexpected errors -> update readout and disabled states.
   */
  function runSearch(): void {
    // Check if the component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort search execution.
      return;
    } else {
      // Component is active: proceed with search execution.
    }

    const query = findInput.value;

    // Check if query is empty.
    if (query.length === 0) {
      // Empty find query: clear matches, index, error alert, and readout text.
      matches = [];
      currentIndex = -1;
      readout.textContent = '';
      errorAlert.textContent = '';
      errorAlert.hidden = true;
      updateButtonsDisabled();
      return;
    } else {
      // Non-empty query: proceed with search evaluation.
    }

    const sourceText = options.session.snapshot.text;
    const searchOpts: SearchOptions = {
      caseSensitive,
      wholeWord,
      regex: isRegex,
    };

    try {
      // "Search in selection" narrows by where a match sits, while the semantic options narrow by what
      // it is, so the selection filter composes over the scoped result rather than replacing it.
      matches = selectedMatches(scopedMatches(findMatches(sourceText, query, searchOpts), sourceText));
      // Clear any prior regular expression error alert on successful query execution.
      errorAlert.textContent = '';
      errorAlert.hidden = true;
    } catch (caught: unknown) {
      // Check if caught error is specifically an InvalidQueryError.
      if (caught instanceof InvalidQueryError) {
        // Malformed regex syntax: display message inline in role="alert" container and treat as zero matches.
        errorAlert.textContent = caught.message;
        errorAlert.hidden = false;
        matches = [];
        currentIndex = -1;
        readout.textContent = 'No results';
        updateButtonsDisabled();
        return;
      } else {
        // Unexpected error: rethrow to avoid hiding genuine defects.
        throw caught;
      }
    }

    // Check if any matches were found.
    if (matches.length === 0) {
      // Non-empty query with zero matches: show 'No results'.
      currentIndex = -1;
      readout.textContent = 'No results';
    } else {
      // Matches found: clamp active index within valid bounds.
      if (currentIndex < 0) {
        // Uninitialized index: position at first match (index 0).
        currentIndex = 0;
      } else if (currentIndex >= matches.length) {
        // Index dangling past the end: clamp to last match.
        currentIndex = matches.length - 1;
      } else {
        // Current index remains valid within bounds.
      }
      readout.textContent = `${currentIndex + 1} of ${matches.length}`;
    }

    updateButtonsDisabled();
  }

  /**
   * Navigates to the next query match in forward document order with wraparound.
   *
   * @purpose Advances active match index using nextMatchIndex with caret at current match start plus one and triggers revealRange.
   * @inputs void.
   * @outputs void.
   * @dataflow matches + caret offset -> nextMatchIndex -> options.revealRange & readout text update.
   * @controlflow Check for empty matches -> compute caret position -> resolve nextMatchIndex -> update currentIndex -> call revealRange.
   */
  function findNext(): void {
    // Check if matches array is empty.
    if (matches.length === 0) {
      // No matches available to navigate: abort.
      return;
    } else {
      // Matches available: proceed with forward step.
    }

    const currentMatch = matches[currentIndex];
    let caret: number;

    // Check if an active match record exists to derive the forward caret offset.
    if (currentMatch !== undefined) {
      // Forward caret is start plus one to advance to the subsequent match.
      caret = currentMatch.start + 1;
    } else {
      // Fallback caret offset at start of document.
      caret = 0;
    }

    const targetIndex = nextMatchIndex(matches, caret, true);

    // Check if a valid match index was resolved.
    if (targetIndex >= 0) {
      currentIndex = targetIndex;
      const targetMatch = matches[currentIndex];
      // Guard against undefined under strict indexing.
      if (targetMatch !== undefined) {
        options.revealRange(targetMatch.start, targetMatch.end);
        readout.textContent = `${currentIndex + 1} of ${matches.length}`;
        reportMatches();
      } else {
        // Target match at resolved index was undefined.
      }
    } else {
      // Target index resolution returned negative value.
    }
  }

  /**
   * Navigates to the previous query match in backward document order with wraparound.
   *
   * @purpose Decrements active match index using nextMatchIndex with caret at current match start and triggers revealRange.
   * @inputs void.
   * @outputs void.
   * @dataflow matches + caret offset -> nextMatchIndex -> options.revealRange & readout text update.
   * @controlflow Check for empty matches -> compute caret position -> resolve previous match index -> update currentIndex -> call revealRange.
   */
  function findPrevious(): void {
    // Check if matches array is empty.
    if (matches.length === 0) {
      // No matches available to navigate: abort.
      return;
    } else {
      // Matches available: proceed with backward step.
    }

    const currentMatch = matches[currentIndex];
    let caret: number;

    // Check if an active match record exists to derive the backward caret offset.
    if (currentMatch !== undefined) {
      // Backward caret is current match start to find match strictly preceding current.
      caret = currentMatch.start;
    } else {
      // Fallback caret offset at end of document text.
      caret = options.session.snapshot.text.length;
    }

    const targetIndex = nextMatchIndex(matches, caret, false);

    // Check if a valid match index was resolved.
    if (targetIndex >= 0) {
      currentIndex = targetIndex;
      const targetMatch = matches[currentIndex];
      // Guard against undefined under strict indexing.
      if (targetMatch !== undefined) {
        options.revealRange(targetMatch.start, targetMatch.end);
        readout.textContent = `${currentIndex + 1} of ${matches.length}`;
        reportMatches();
      } else {
        // Target match at resolved index was undefined.
      }
    } else {
      // Target index resolution returned negative value.
    }
  }

  /**
   * Replaces the currently focused query match in the Markdown source text.
   *
   * @purpose Substitutes the current match using replaceMatch, delegates text application to options.applyText, re-runs search, and steps to the next match.
   * @inputs void.
   * @outputs void.
   * @dataflow current SearchMatch + replaceInput.value -> replaceMatch -> options.applyText -> runSearch -> reveal next match.
   * @controlflow Check for empty matches or invalid index -> retrieve current match -> compute replacement -> apply text -> re-run search -> reveal next match.
   */
  function doReplace(): void {
    // Check if matches exist and a valid current match index is active.
    if (matches.length === 0 || currentIndex < 0) {
      // No current match available: Replace does nothing rather than replacing something arbitrary.
      return;
    } else {
      // Active match present: proceed with single replacement.
    }

    const match = matches[currentIndex];

    // Guard against undefined under strict indexing.
    if (match === undefined) {
      // Match record is undefined: abort replacement.
      return;
    } else {
      // Valid match record obtained.
    }

    const sourceText = options.session.snapshot.text;
    const replacement = replaceInput.value;
    const searchOpts: SearchOptions = {
      caseSensitive,
      wholeWord,
      regex: isRegex,
    };

    const nextText = replaceMatch(sourceText, match, replacement, searchOpts);

    try {
      options.applyText(nextText);
    } catch (caught: unknown) {
      // Route unexpected application errors to host error handler.
      const message = caught instanceof Error ? caught.message : String(caught);
      options.onError(message);
      return;
    }

    // Re-run search over the modified document text.
    runSearch();

    // Check if any matches remain after the replacement.
    if (matches.length > 0) {
      // Step to the match now positioned at currentIndex (clamped during runSearch).
      const nextMatch = matches[currentIndex];
      // Guard against undefined under strict indexing.
      if (nextMatch !== undefined) {
        options.revealRange(nextMatch.start, nextMatch.end);
      } else {
        // Next match at index was undefined.
      }
    } else {
      // No remaining matches in the document.
    }
  }

  /**
   * Replaces all occurrences of the query across the Markdown source text.
   *
   * @purpose Performs batch replacement across all query matches using replaceAll, applies modified text, re-runs search, and reports replacement count.
   * @inputs void.
   * @outputs void.
   * @dataflow sourceText + query + replacement -> replaceAll -> options.applyText -> runSearch -> report count in readout.
   * @controlflow Check for empty query -> execute replaceAll catching InvalidQueryError -> apply replaced text when count > 0 -> re-run search -> update readout with count.
   */
  function doReplaceAll(): void {
    const query = findInput.value;

    // Check if query string is empty.
    if (query.length === 0) {
      // Empty query: nothing to replace.
      return;
    } else {
      // Non-empty query: proceed with global replacement.
    }

    const sourceText = options.session.snapshot.text;
    const replacement = replaceInput.value;
    const searchOpts: SearchOptions = {
      caseSensitive,
      wholeWord,
      regex: isRegex,
    };

    let result: { readonly text: string; readonly count: number };
    try {
      result = replaceAll(sourceText, query, replacement, searchOpts);
      // Clear regular expression error alert on successful execution.
      errorAlert.textContent = '';
      errorAlert.hidden = true;
    } catch (caught: unknown) {
      // Check if caught error is specifically an InvalidQueryError.
      if (caught instanceof InvalidQueryError) {
        errorAlert.textContent = caught.message;
        errorAlert.hidden = false;
        matches = [];
        currentIndex = -1;
        readout.textContent = 'No results';
        updateButtonsDisabled();
        return;
      } else {
        // Unexpected error: rethrow to surface defect.
        throw caught;
      }
    }

    // Check if any replacements were executed.
    if (result.count > 0) {
      try {
        options.applyText(result.text);
      } catch (caught: unknown) {
        // Route unexpected application errors to host error handler.
        const message = caught instanceof Error ? caught.message : String(caught);
        options.onError(message);
        return;
      }
      runSearch();
      readout.textContent = `Replaced ${result.count}`;
    } else {
      // Zero replacements performed: re-run search to synchronize UI.
      runSearch();
    }
  }

  /**
   * Keyboard shortcut event listener managing document-level shortcuts and intra-panel key navigation.
   *
   * @purpose Intercepts Ctrl/Cmd+F and Ctrl/Cmd+H globally, and routes Enter, Shift+Enter, and Escape inside the panel.
   * @inputs event - KeyboardEvent captured from document keydown listener.
   * @outputs void.
   * @dataflow event.key and modifiers -> open / close / findNext / findPrevious action dispatch.
   * @controlflow Check destroyed flag -> evaluate Ctrl/Cmd modifiers for global shortcuts -> check if target resides inside panel for Enter/Escape handling.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: ignore keyboard event.
      return;
    } else {
      // Component is active: proceed with event inspection.
    }

    const isMod = event.ctrlKey || event.metaKey;

    // Check if primary command modifier (Ctrl/Cmd) is pressed without Alt, and the panel still owns its shortcuts.
    if (isMod && !event.altKey && options.ownShortcuts !== false) {
      const key = event.key.toLowerCase();
      // Check if 'f' key was pressed for Find mode.
      if (key === 'f' && !event.shiftKey) {
        event.preventDefault();
        open('find');
        return;
      } else if (key === 'h' && !event.shiftKey) {
        // Check if 'h' key was pressed for Replace mode.
        event.preventDefault();
        open('replace');
        return;
      } else {
        // Other command key combinations: allow standard processing.
      }
    } else {
      // Non-command keystrokes: evaluate contextual panel controls.
    }

    // Check if keyboard event originated from inside the find panel container.
    if (options.container.contains(event.target as Node)) {
      // Check if Escape key was pressed.
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter') {
        // Enter key pressed: evaluate Shift modifier for navigation direction.
        event.preventDefault();
        if (event.shiftKey) {
          // Shift+Enter navigates to previous match.
          findPrevious();
        } else {
          // Enter navigates to next match.
          findNext();
        }
      } else {
        // Other keys within container: allow default text editing and control activation.
      }
    } else {
      // Event originated outside find panel: do not intercept.
    }
  }

  // Bind input and click event listeners with signal for lifecycle cleanup.
  findInput.addEventListener(
    'input',
    (): void => {
      runSearch();
    },
    { signal },
  );

  prevButton.addEventListener(
    'click',
    (): void => {
      findPrevious();
    },
    { signal },
  );

  nextButton.addEventListener(
    'click',
    (): void => {
      findNext();
    },
    { signal },
  );

  // FR-9.4: exclude code. Each re-runs the search immediately, because a filter whose effect
  // only appears on the next keystroke reads as the button having failed.
  codeButton.addEventListener(
    'click',
    (): void => {
      excludeCode = !excludeCode;
      codeButton.setAttribute('aria-pressed', excludeCode ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  // FR-9.4: exclude link URLs. Each re-runs the search immediately, because a filter whose effect
  // only appears on the next keystroke reads as the button having failed.
  urlButton.addEventListener(
    'click',
    (): void => {
      excludeUrls = !excludeUrls;
      urlButton.setAttribute('aria-pressed', excludeUrls ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  // FR-9.4: restrict to this section. Each re-runs the search immediately, because a filter whose effect
  // only appears on the next keystroke reads as the button having failed.
  sectionButton.addEventListener(
    'click',
    (): void => {
      sectionOnly = !sectionOnly;
      sectionButton.setAttribute('aria-pressed', sectionOnly ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  // FR-9.2: search within the current selection. Like the other filters it re-runs immediately so its
  // effect is visible on the same click rather than waiting for the next keystroke.
  selectionButton.addEventListener(
    'click',
    (): void => {
      inSelection = !inSelection;

      if (inSelection) {
        // Turning on: capture the current selection once, because navigation below moves it away.
        const range = options.readSelection?.() ?? null;
        // Check whether a usable, non-collapsed range came back from the host.
        if (range === null || range.start >= range.end) {
          // No live range: an option that cannot narrow anything must not claim to be on — a pressed
          // button that changes nothing is worse than one that refuses to press — so turn it straight off.
          inSelection = false;
        } else {
          // Live range captured: hold it until the option is switched off again.
          selectionRange = range;
        }
      } else {
        // Turning off: forget the captured range, since narrowing by where no longer applies.
        selectionRange = null;
      }

      selectionButton.setAttribute('aria-pressed', inSelection ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  caseButton.addEventListener(
    'click',
    (): void => {
      caseSensitive = !caseSensitive;
      caseButton.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  wordButton.addEventListener(
    'click',
    (): void => {
      wholeWord = !wholeWord;
      wordButton.setAttribute('aria-pressed', wholeWord ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  regexButton.addEventListener(
    'click',
    (): void => {
      isRegex = !isRegex;
      regexButton.setAttribute('aria-pressed', isRegex ? 'true' : 'false');
      runSearch();
    },
    { signal },
  );

  replaceButton.addEventListener(
    'click',
    (): void => {
      doReplace();
    },
    { signal },
  );

  replaceAllButton.addEventListener(
    'click',
    (): void => {
      doReplaceAll();
    },
    { signal },
  );

  // Register single document-level keydown listener.
  doc.addEventListener('keydown', onKeyDown, { signal });

  /**
   * Opens the find panel in the specified mode ('find' or 'replace'), focusing and selecting the find input.
   *
   * @purpose Displays the panel, configures replace row visibility according to mode, focuses find input, selects text, and recomputes search.
   * @inputs mode - Mode selecting 'find' (replace row hidden) or 'replace' (replace row visible).
   * @outputs void.
   * @dataflow mode -> replaceRow.hidden update -> container.hidden = false -> findInput.focus() & select() -> runSearch().
   * @controlflow Check destroyed flag -> set replaceRow visibility -> reveal container -> focus and select find input -> re-run search.
   */
  function open(mode: 'find' | 'replace'): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening panel.
    }

    // Check requested mode to set replace row visibility.
    if (mode === 'find') {
      // Find mode: hide replace controls row.
      replaceRow.hidden = true;
    } else {
      // Replace mode: show replace controls row.
      replaceRow.hidden = false;
    }

    options.container.hidden = false;
    findInput.focus();
    findInput.select();
    runSearch();
  }

  /**
   * Closes the find panel and clears transient error alert state.
   *
   * @purpose Hides the container element and clears regex error alert in an idempotent manner without stranding focus.
   * @inputs void.
   * @outputs void.
   * @dataflow container.hidden = true -> clear error alert.
   * @controlflow Check destroyed flag -> set container hidden -> clear error alert text and hide alert element.
   */
  function close(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort close.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    options.container.hidden = true;
    errorAlert.textContent = '';
    errorAlert.hidden = true;

    // A hidden panel must not leave the document painted: the highlights answer a question that is no
    // longer on screen, and a reader who closed the find bar has said they are done asking it.
    options.onMatches?.([], -1);
    options.onClose();
  }

  /**
   * Re-evaluates the active search query against current document contents.
   *
   * @purpose Synchronizes search match list and status indicators when document text changes underneath the panel.
   * @inputs void.
   * @outputs void.
   * @dataflow Document text updates -> runSearch recomputation.
   * @controlflow Check destroyed flag -> execute runSearch.
   */
  function refresh(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: re-run search query.
      runSearch();
    }
  }

  /**
   * Tears down panel resources, aborting listeners and emptying the container element.
   *
   * @purpose Idempotently unregisters event listeners, removes keydown handlers, and clears container DOM children.
   * @inputs void.
   * @outputs void.
   * @dataflow Aborts AbortController -> removes document keydown listener -> resets container attributes -> replaces container children.
   * @controlflow Check destroyed flag (return if true) -> set destroyed flag -> abort controller -> remove keydown listener -> clear container.
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
    doc.removeEventListener('keydown', onKeyDown);
    options.container.classList.remove('kdoc-find-bar');
    options.container.hidden = true;
    options.container.replaceChildren();
  }

  return {
    /**
     * @purpose Returns boolean indicating whether the find panel is currently open and visible.
     * @inputs void.
     * @outputs boolean - True if the panel is active and not hidden; false otherwise.
     * @dataflow options.container.hidden state -> boolean.
     * @controlflow Check destroyed flag -> return inverted container.hidden value.
     */
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else if (options.container.hidden) {
        // Hidden container is not open.
        return false;
      } else {
        // Active and unhidden container is open.
        return true;
      }
    },

    open,
    close,
    refresh,
    destroy,
  };
}
