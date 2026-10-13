/**
 * @file history-panel.ts
 * @purpose Implements HistoryPanel for K-Doc's right sidebar (FR-14.7) displaying the document's edit timeline where clicking an entry restores that version.
 * @inputs HistoryPanelOptions containing Document context, entries accessor, current words clock, and restore callback.
 * @outputs HistoryPanel controller exposing element, refresh, and destroy, alongside HISTORY_PANEL_STYLES stylesheet and pure formatting helpers.
 * @functions
 *   - formatRelativeTime: Pure helper converting an epoch timestamp to a relative time string against now.
 *   - formatWordDelta: Pure helper describing how many words a historical entry differs from the current document length.
 *   - installHistoryPanel: Instantiates DOM hierarchy, binds delegated click listener, and returns HistoryPanel controller.
 *   - refresh: Rebuilds history body DOM newest-first based on entries or renders empty state.
 *   - historyRow: Builds a single timeline entry button displaying relative time and word delta.
 *   - destroy: Idempotently aborts event listener signals and clears body children.
 * @dataflow options.entries() -> historyRow DOM buttons -> bodyElement.replaceChildren -> click events invoke options.restore.
 * @controlflow Mount root and body -> attach delegated click listener with signal -> initial refresh -> return controller.
 * @version 4
 * @date 2026-10-04
 */

export interface HistoryRow {
  /** Position in the session's timeline, oldest first. Handed back to restore(). */
  readonly index: number;
  /** When it was recorded, in epoch milliseconds. */
  readonly at: number;
  /** The pane the edit was made in. */
  readonly pane: 'kdoc' | 'source';
  /** How many words the document held at that point. */
  readonly words: number;
}

export interface HistoryPanelOptions {
  readonly doc: Document;
  /** Every recorded point, oldest first. */
  readonly entries: () => readonly HistoryRow[];
  /** How many words the document holds right now. */
  readonly currentWords: () => number;
  /** The clock, injectable so the relative times are testable. */
  readonly now: () => number;
  /** Puts the version at that timeline index back, as a new edit. */
  readonly restore: (index: number) => void;
  /** Opens the saved snapshots (FR-11.9); without it the panel has no button for them. */
  readonly browseVersions?: () => void;
}

export interface HistoryPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export const HISTORY_PANEL_STYLES: string = `
.kdoc-history-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-history-panel[hidden] {
  display: none !important;
}

.kdoc-history-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-history-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-history-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-history-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-history-browse {
  margin: 8px 12px 0;
  align-self: flex-start;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-history-browse:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-history-browse:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-history-browse:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-history-empty {
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px 12px;
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-history-entry {
  width: calc(100% - 8px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  padding: 4px 12px;
  box-sizing: border-box;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-history-entry:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-history-entry:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-history-when {
  font-size: 13px;
  color: var(--kdoc-chrome-text);
}

.kdoc-history-detail {
  font-size: 11px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-history-panel * {
    transition: none !important;
  }
}
`;

/**
 * Converts an epoch timestamp to a relative time string against the current clock.
 * @purpose Maps elapsed milliseconds to human-friendly past-relative phrases, clamping negative or future skew to 'just now'.
 * @inputs at - Recorded timestamp in epoch milliseconds.
 * @inputs now - Current time in epoch milliseconds used as the reference point.
 * @outputs string - Relative phrase such as 'just now', '3 minutes ago', or '2 days ago'.
 * @dataflow elapsed = now - at -> range checks against fixed thresholds -> formatted relative phrase.
 * @controlflow Compute elapsed -> evaluate thresholds in ascending order -> return first matching phrase; otherwise fall through to days.
 */
export function formatRelativeTime(at: number, now: number): string {
  // Difference in milliseconds between the recorded timestamp and the current clock.
  const elapsed: number = now - at;

  // Under one minute (including negative or future clock skew) reads as just now.
  if (elapsed < 45000) {
    return 'just now';
  } else if (elapsed < 90000) {
    // Between 45 and 90 seconds: report a single minute ago.
    return '1 minute ago';
  } else if (elapsed < 3600000) {
    // Under an hour: report whole minutes elapsed, rounded.
    return `${Math.round(elapsed / 60000)} minutes ago`;
  } else if (elapsed < 5400000) {
    // Between 60 and 90 minutes: report a single hour ago.
    return '1 hour ago';
  } else if (elapsed < 86400000) {
    // Under a day: report whole hours elapsed, rounded.
    return `${Math.round(elapsed / 3600000)} hours ago`;
  } else if (elapsed < 129600000) {
    // Between 24 and 36 hours: report a single day ago.
    return '1 day ago';
  } else {
    // 36 hours or more: report whole days elapsed, rounded.
    return `${Math.round(elapsed / 86400000)} days ago`;
  }
}

/**
 * Describes how a historical word count compares to the current document length.
 * @purpose Maps a past word count against the present count to a relative-length phrase, singularizing single-word deltas.
 * @inputs words - Historical entry's word count.
 * @inputs currentWords - Current document word count used as the reference point.
 * @outputs string - One of 'same length', '<n> words fewer', or '<n> words more'.
 * @dataflow Compare words to currentWords -> compute signed delta -> format singular or plural phrase.
 * @controlflow Equal check first -> else branch on less-than/greater-than -> singularize when the delta is exactly one.
 */
export function formatWordDelta(words: number, currentWords: number): string {
  // Equal lengths: nothing to compare.
  if (words === currentWords) {
    return 'same length';
  } else if (words < currentWords) {
    // Historical entry shorter than the current document.
    const fewer: number = currentWords - words;
    // A single-word difference uses the singular phrasing.
    if (fewer === 1) {
      return '1 word fewer';
    } else {
      return `${fewer} words fewer`;
    }
  } else {
    // Historical entry longer than the current document.
    const more: number = words - currentWords;
    // A single-word difference uses the singular phrasing.
    if (more === 1) {
      return '1 word more';
    } else {
      return `${more} words more`;
    }
  }
}

/**
 * Installs the history panel into an owned DOM hierarchy, binding delegated click restoration and returning the controller.
 * @purpose Creates history panel container, mounts stable body, binds click listener, and returns controller.
 * @inputs options - HistoryPanelOptions providing Document context, entries accessor, current words clock, and restore callback.
 * @outputs HistoryPanel - Controller interface exposing mounted element, refresh, and destroy methods.
 * @dataflow options.entries() -> historyRow DOM buttons -> bodyElement.replaceChildren -> click events invoke options.restore.
 * @controlflow Mount root and body -> attach delegated click listener with signal -> execute initial refresh -> return controller.
 */
export function installHistoryPanel(options: HistoryPanelOptions): HistoryPanel {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;
  let destroyed: boolean = false;

  const rootElement = doc.createElement('div');
  rootElement.className = 'kdoc-history-panel';

  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-history-body';
  const browseVersions = options.browseVersions;
  // Check whether the host can show saved snapshots.
  if (browseVersions !== undefined) {
    // It can: the session timeline above is lost on close, so point to what survives it.
    const browseButton = doc.createElement('button');
    browseButton.type = 'button';
    browseButton.className = 'kdoc-history-browse';
    browseButton.textContent = 'Version History…';
    browseButton.addEventListener('click', (): void => {
      browseVersions();
    }, { signal });
    rootElement.appendChild(browseButton);
  } else {
    // No snapshots to show: the panel lists only this session's edits.
  }
  rootElement.appendChild(bodyElement);

  /**
   * Refreshes the history panel body DOM from the session timeline.
   * @purpose Reads entries, current word count, and a single clock sample, then rebuilds the body newest-first or renders empty state.
   * @inputs void.
   * @outputs void.
   * @dataflow options.entries(), options.currentWords(), options.now() -> row buttons -> bodyElement.replaceChildren.
   * @controlflow Check destroyed guard -> read entries/words/now once -> if empty render empty message; else iterate newest-first and build rows.
   */
  function refresh(): void {
    // Check whether the panel has been destroyed.
    if (destroyed) {
      // Panel is destroyed: abort refresh.
      return;
    } else {
      // Panel is active: proceed with refreshing history list.
    }

    const rows = options.entries();
    const currentWords: number = options.currentWords();
    // Sample the clock once per refresh so every row agrees on "now".
    const now: number = options.now();

    // Check whether there are no recorded entries yet.
    if (rows.length === 0) {
      // No history: render empty state readout and stop.
      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-history-empty';
      emptyLine.textContent = 'No earlier versions yet.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // History exists: build rows newest-first.
    }

    const children: HTMLElement[] = [];
    // Iterate backwards so the most recent entry is drawn first for easy access.
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      // Guard against undefined under noUncheckedIndexedAccess.
      if (row === undefined) {
        // Undefined row: skip element.
        continue;
      } else {
        // Defined row: build its button.
      }

      children.push(historyRow(row, now, currentWords));
    }
    bodyElement.replaceChildren(...children);
  }

  /**
   * Builds a button element representing a single timeline entry.
   * @purpose Builds button element with data-index attribute, relative-time span, and pane/word-delta detail span.
   * @inputs row - HistoryRow describing the timeline position, timestamp, pane, and word count.
   * @inputs now - Current epoch milliseconds used to compute the relative time string.
   * @inputs currentWords - Current document word count used to compute the word delta string.
   * @outputs HTMLButtonElement - Configured button element for the history entry.
   * @dataflow HistoryRow attributes -> button element with data-index, when span, and detail span.
   * @controlflow Create button -> set type, class, dataset index -> build when and detail spans -> return button.
   */
  function historyRow(row: HistoryRow, now: number, currentWords: number): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'kdoc-history-entry';
    button.setAttribute('data-index', String(row.index));

    const whenSpan = doc.createElement('span');
    whenSpan.className = 'kdoc-history-when';
    whenSpan.textContent = formatRelativeTime(row.at, now);

    // Check whether the edit was made in the K-Doc pane; use 'Editor' for it and 'Source' otherwise.
    const paneLabel: string = row.pane === 'kdoc' ? 'Editor' : 'Source';

    const detailSpan = doc.createElement('span');
    detailSpan.className = 'kdoc-history-detail';
    detailSpan.textContent = `${paneLabel} \u00B7 ${formatWordDelta(row.words, currentWords)}`;

    button.appendChild(whenSpan);
    button.appendChild(detailSpan);

    return button;
  }

  bodyElement.addEventListener(
    'click',
    (event: MouseEvent): void => {
      // Check whether event target is an HTMLElement.
      if (!(event.target instanceof HTMLElement)) {
        // Target is not an HTMLElement: ignore click.
        return;
      } else {
        // Target is an HTMLElement: search for nearest history entry button.
      }

      const button = event.target.closest<HTMLButtonElement>('button.kdoc-history-entry');
      // Check whether the click landed inside a history entry button.
      if (button === null) {
        // Click outside any history entry: ignore it.
        return;
      } else {
        // Click inside a history entry: read its data-index attribute.
      }

      const rawIndex = button.getAttribute('data-index');
      const index = Number.parseInt(rawIndex ?? '', 10);

      // Check whether the parsed index is a finite number before restoring.
      if (Number.isFinite(index)) {
        // Finite index: restore that timeline version as a new edit.
        options.restore(index);
      } else {
        // Missing or non-finite index: ignore click.
      }
    },
    { signal },
  );

  /**
   * Cleans up all history panel resources and event listeners.
   * @purpose Idempotently aborts controller signal and clears body children.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> clear bodyElement children -> set destroyed flag.
   * @controlflow Check destroyed flag -> if destroyed return early; else mark destroyed -> abort signal -> clear body.
   */
  function destroy(): void {
    // Check whether the panel has already been destroyed.
    if (destroyed) {
      // Already destroyed: return early to ensure idempotency.
      return;
    } else {
      // Active panel: mark as destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    bodyElement.replaceChildren();
  }

  refresh();

  return {
    element: rootElement,
    refresh,
    destroy,
  };
}
