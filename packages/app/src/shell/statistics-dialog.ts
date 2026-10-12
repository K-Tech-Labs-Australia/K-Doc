/**
 * @file statistics-dialog.ts
 * @purpose Implements StatisticsDialog, an accessible modal dialog using the native HTMLDialogElement for displaying document and selection text statistics (FR-12.5).
 * @inputs StatisticsDialogOptions containing the Document context and a read callback returning fresh document and selection text strings.
 * @outputs StatisticsDialog controller instance exposing open, close, isOpen, and destroy lifecycle methods, alongside STATISTICS_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installStatisticsDialog: Constructs, styles, and mounts the native modal statistics dialog into the document body, wiring metric rows, table updates, and keyboard/button dismiss handlers.
 * @dataflow options.read() -> analyzeText -> number & em-dash formatting -> table DOM textContent updates.
 * @controlflow Mount native dialog to document body -> read fresh text and update metrics on open() -> show modal dialog -> wire Close button and Escape listeners with AbortController -> teardown via destroy().
 * @version 5
 * @date 2026-10-04
 */

import {
  analyzeText,
  frequentWords,
  readability,
  repeatedPhrases,
  type DocumentStatistics,
  type ReadabilityScores,
} from '@k-doc/core';

export interface StatisticsDialogOptions {
  readonly doc: Document;
  /** Returns the whole document text and the selected text, read fresh each time the dialog opens. */
  readonly read: () => { readonly document: string; readonly selection: string };
}

export interface StatisticsDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * Static stylesheet for the statistics modal dialog, styling the dialog backdrop, container,
 * header, metrics table, row headers, numeric value cells, and footer action buttons using
 * exclusively authoritative K-Doc design tokens.
 */
/**
 * How many words and phrases the analysis lists show (FR-12.8).
 *
 * Enough to see what a document leans on, few enough that the dialog stays a thing you read rather than
 * a report you scroll.
 */
const LIST_LIMIT = 10;

export const STATISTICS_DIALOG_STYLES: string = `
dialog.kdoc-statistics-dialog {
  position: fixed;
  top: 15vh;
  margin: 0 auto;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 0;
  width: 440px;
  max-width: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

/* Ensure closed dialogs never remain visible when display: flex is applied. */

dialog.kdoc-statistics-dialog:not([open]) {
  display: none;
}

dialog.kdoc-statistics-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-statistics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px 20px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl) var(--kdoc-radius-xl) 0 0;
  flex-shrink: 0;
}

.kdoc-statistics-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-statistics-close-icon {
  background: var(--kdoc-chrome-base);
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text-muted);
  font-size: 18px;
  line-height: 1;
  width: 28px;
  height: 28px;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-statistics-close-icon:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-statistics-close-icon:active,
.kdoc-statistics-close-icon[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
}

.kdoc-statistics-close-icon:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-statistics-close-icon:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-statistics-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-lg);
}

.kdoc-statistics-subheading {
  margin: 16px 0 6px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-statistics-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.kdoc-statistics-list li {
  padding: 1px 0;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-statistics-empty-note {
  list-style: none;
  margin-left: -20px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  font-family: inherit;
}

.kdoc-statistics-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-statistics-table th,
.kdoc-statistics-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-statistics-th-measure {
  text-align: left;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-statistics-th-value {
  text-align: right;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
  min-width: 80px;
}

.kdoc-statistics-row-header {
  text-align: left;
  font-weight: normal;
  color: var(--kdoc-chrome-text);
}

.kdoc-statistics-cell-value {
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text);
  border: 0;
  box-shadow: none;
  background: transparent;
}

.kdoc-statistics-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
  background: transparent;
  border-radius: 0 0 var(--kdoc-radius-xl) var(--kdoc-radius-xl);
  flex-shrink: 0;
}

.kdoc-statistics-button {
  min-width: 68px;
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

.kdoc-statistics-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-statistics-button:active,
.kdoc-statistics-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-statistics-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-statistics-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-statistics-body::-webkit-scrollbar {
  width: 8px;
}

.kdoc-statistics-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-statistics-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-statistics-dialog,
  dialog.kdoc-statistics-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Representation of a single statistics table row and its associated value cells.
 */
interface StatisticRowElements {
  readonly label: string;
  readonly docCell: HTMLTableCellElement;
  readonly selCell: HTMLTableCellElement;
}

/**
 * Installs the modal statistics dialog into the document body, wiring metric rows and lifecycle handlers.
 *
 * @purpose Constructs, styles, and mounts the native modal statistics dialog displaying lexical counts for document and selection (FR-12.5).
 * @inputs options - StatisticsDialogOptions containing Document context and read callback returning document and selection text.
 * @outputs StatisticsDialog - Controller exposing open, close, isOpen, and destroy lifecycle methods.
 * @dataflow options.read() -> analyzeText -> table cells textContent -> modal dialog lifecycle.
 * @controlflow Create dialog DOM hierarchy -> wire Close button and cancel/keydown handlers with AbortController -> mount to doc.body -> return StatisticsDialog.
 */
export function installStatisticsDialog(options: StatisticsDialogOptions): StatisticsDialog {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-statistics-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Statistics');

  // Header container with title and close icon.
  const header = doc.createElement('div');
  header.className = 'kdoc-statistics-header';

  const heading = doc.createElement('h2');
  heading.className = 'kdoc-statistics-heading';
  heading.textContent = 'Statistics';
  header.appendChild(heading);

  const headerCloseButton = doc.createElement('button');
  headerCloseButton.type = 'button';
  headerCloseButton.className = 'kdoc-statistics-close-icon';
  headerCloseButton.setAttribute('aria-label', 'Close statistics');
  headerCloseButton.textContent = '×';
  headerCloseButton.addEventListener(
    'click',
    (): void => {
      close();
    },
    { signal },
  );
  header.appendChild(headerCloseButton);

  dialog.appendChild(header);

  // Dialog body containing the two-column value table.
  const body = doc.createElement('div');
  body.className = 'kdoc-statistics-body';

  const table = doc.createElement('table');
  table.className = 'kdoc-statistics-table';

  const thead = doc.createElement('thead');
  const headerRow = doc.createElement('tr');

  const thMeasure = doc.createElement('th');
  thMeasure.scope = 'col';
  thMeasure.className = 'kdoc-statistics-th-measure';
  thMeasure.textContent = 'Statistic';
  headerRow.appendChild(thMeasure);

  const thDoc = doc.createElement('th');
  thDoc.scope = 'col';
  thDoc.className = 'kdoc-statistics-th-value';
  thDoc.textContent = 'Document';
  headerRow.appendChild(thDoc);

  const thSel = doc.createElement('th');
  thSel.scope = 'col';
  thSel.className = 'kdoc-statistics-th-value';
  thSel.textContent = 'Selection';
  headerRow.appendChild(thSel);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');

  /**
   * Helper factory creating a table row with row header and two value cells (Document and Selection).
   *
   * @purpose Appends a structured metric row into the statistics table tbody.
   * @inputs labelText - The human-readable measure title for the row header.
   * @outputs StatisticRowElements - Object holding the measure label and references to the docCell and selCell table cells.
   * @dataflow labelText -> create tr/th/td elements -> append to tbody -> return cell references.
   * @controlflow Create tr -> create th with scope="row" -> create doc and sel td elements -> append to tbody -> return record.
   */
  function createRow(labelText: string): StatisticRowElements {
    const tr = doc.createElement('tr');
    tr.className = 'kdoc-statistics-row';

    const th = doc.createElement('th');
    th.scope = 'row';
    th.className = 'kdoc-statistics-row-header';
    th.textContent = labelText;
    tr.appendChild(th);

    const docCell = doc.createElement('td');
    docCell.className = 'kdoc-statistics-cell-value kdoc-statistics-cell-doc';
    tr.appendChild(docCell);

    const selCell = doc.createElement('td');
    selCell.className = 'kdoc-statistics-cell-value kdoc-statistics-cell-sel';
    tr.appendChild(selCell);

    tbody.appendChild(tr);

    return {
      label: labelText,
      docCell,
      selCell,
    };
  }

  const wordsRow = createRow('Words');
  const charsWithSpacesRow = createRow('Characters (with spaces)');
  const charsNoSpacesRow = createRow('Characters (no spaces)');
  const paragraphsRow = createRow('Paragraphs');
  const sentencesRow = createRow('Sentences');
  const readingTimeRow = createRow('Reading time');
  // Readability (FR-12.6). Three published measures of how hard the prose is to read, kept together at
  // the end of the table because they are estimates rather than counts.
  const fleschEaseRow = createRow('Reading ease (Flesch)');
  const fleschGradeRow = createRow('Grade level (Flesch–Kincaid)');
  const fogRow = createRow('Gunning fog index');

  table.appendChild(tbody);
  body.appendChild(table);

  // Word and phrase analysis (FR-12.8). Two lists rather than more table rows: each answer is a list of
  // its own, and a table of counts is the wrong shape for one.
  const wordsHeading = doc.createElement('h3');
  wordsHeading.className = 'kdoc-statistics-subheading';
  wordsHeading.textContent = 'Most used words';
  body.appendChild(wordsHeading);

  const wordsList = doc.createElement('ol');
  wordsList.className = 'kdoc-statistics-list';
  body.appendChild(wordsList);

  const phrasesHeading = doc.createElement('h3');
  phrasesHeading.className = 'kdoc-statistics-subheading';
  phrasesHeading.textContent = 'Repeated phrases';
  body.appendChild(phrasesHeading);

  const phrasesList = doc.createElement('ol');
  phrasesList.className = 'kdoc-statistics-list';
  body.appendChild(phrasesList);

  dialog.appendChild(body);

  // Footer container with primary Close button.
  const footer = doc.createElement('div');
  footer.className = 'kdoc-statistics-footer';

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'kdoc-statistics-button kdoc-statistics-close';
  closeButton.textContent = 'Close';
  closeButton.addEventListener(
    'click',
    (): void => {
      close();
    },
    { signal },
  );
  footer.appendChild(closeButton);

  dialog.appendChild(footer);

  /**
   * Reads fresh document and selection text from options.read() and updates all table cells.
   *
   * @purpose Populates the statistics dialog table with fresh lexical and structural figures on demand.
   * @inputs void.
   * @outputs void.
   * @dataflow options.read() -> analyzeText -> number formatting / dash formatting -> DOM cell textContent.
   * @controlflow Read document and selection -> compute docStats -> check hasSelection -> compute selStats -> populate rows -> format reading time and em dashes.
   */
  function updateMetrics(): void {
    // Figures are read fresh on each open() rather than kept live, and the reason goes in a comment:
    // the dialog is a snapshot the user asked for, and a table of numbers changing under a cursor
    // they are not typing at would be motion without information.
    const { document: docText, selection: selText } = options.read();

    const docStats = analyzeText(docText);
    const hasSelection = selText.length > 0;

    // Check if there is an active selection.
    let selStats: DocumentStatistics | null = null;
    if (hasSelection) {
      // Selection present: compute lexical statistics over selected text slice.
      selStats = analyzeText(selText);
    } else {
      // Nothing selected: remain null to trigger em dash formatting.
    }

    // Row 1: Words
    wordsRow.docCell.textContent = docStats.words.toLocaleString();
    // Check if selection is active for words count.
    if (hasSelection && selStats !== null) {
      // Selection active: display formatted word count.
      wordsRow.selCell.textContent = selStats.words.toLocaleString();
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      wordsRow.selCell.textContent = '—';
    }

    // Row 2: Characters (with spaces)
    charsWithSpacesRow.docCell.textContent = docStats.charactersWithSpaces.toLocaleString();
    // Check if selection is active for characters with spaces.
    if (hasSelection && selStats !== null) {
      // Selection active: display formatted characters with spaces count.
      charsWithSpacesRow.selCell.textContent = selStats.charactersWithSpaces.toLocaleString();
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      charsWithSpacesRow.selCell.textContent = '—';
    }

    // Row 3: Characters (no spaces)
    charsNoSpacesRow.docCell.textContent = docStats.charactersWithoutSpaces.toLocaleString();
    // Check if selection is active for characters without spaces.
    if (hasSelection && selStats !== null) {
      // Selection active: display formatted characters without spaces count.
      charsNoSpacesRow.selCell.textContent = selStats.charactersWithoutSpaces.toLocaleString();
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      charsNoSpacesRow.selCell.textContent = '—';
    }

    // Row 4: Paragraphs
    paragraphsRow.docCell.textContent = docStats.paragraphs.toLocaleString();
    // Check if selection is active for paragraphs count.
    if (hasSelection && selStats !== null) {
      // Selection active: display formatted paragraphs count.
      paragraphsRow.selCell.textContent = selStats.paragraphs.toLocaleString();
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      paragraphsRow.selCell.textContent = '—';
    }

    // Row 5: Sentences
    sentencesRow.docCell.textContent = docStats.sentences.toLocaleString();
    // Check if selection is active for sentences count.
    if (hasSelection && selStats !== null) {
      // Selection active: display formatted sentences count.
      sentencesRow.selCell.textContent = selStats.sentences.toLocaleString();
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      sentencesRow.selCell.textContent = '—';
    }

    // Row 6: Reading time
    // Reading time renders as "1 min" / "4 min", and "—" when there are no words.
    // Check if document contains any words.
    if (docStats.words === 0) {
      // Document has no words: render em dash.
      readingTimeRow.docCell.textContent = '—';
    } else {
      // Document has words: render formatted reading minutes.
      readingTimeRow.docCell.textContent = `${docStats.readingMinutes.toLocaleString()} min`;
    }

    // Check if selection is active for reading time.
    if (hasSelection && selStats !== null) {
      // Check if selected text contains any words.
      if (selStats.words === 0) {
        // Selection contains no words: render em dash.
        readingTimeRow.selCell.textContent = '—';
      } else {
        // Selection contains words: render formatted reading minutes.
        readingTimeRow.selCell.textContent = `${selStats.readingMinutes.toLocaleString()} min`;
      }
    } else {
      // The Selection column shows an em dash for every row when nothing is selected, rather than zeros.
      // A zero would read as a measurement, and "nothing selected" is not a measurement of zero.
      readingTimeRow.selCell.textContent = '—';
    }

    // Rows 7 to 9: readability (FR-12.6).
    const docScores = readability(docText);
    const selScores = hasSelection ? readability(selText) : null;
    writeScore(fleschEaseRow, docScores, selScores, (s: ReadabilityScores): number => s.fleschReadingEase);
    writeScore(fleschGradeRow, docScores, selScores, (s: ReadabilityScores): number => s.fleschKincaidGrade);
    writeScore(fogRow, docScores, selScores, (s: ReadabilityScores): number => s.gunningFog);

    // The two lists (FR-12.8) describe the document; a selection is measured in the table above, but a
    // list of words used twice in one paragraph would say nothing.
    const words = frequentWords(docText, LIST_LIMIT);
    fillList(wordsList, words.map((entry) => `${entry.word} — ${entry.count.toLocaleString()}`), 'No words to count yet.');
    const phrases = repeatedPhrases(docText, LIST_LIMIT);
    fillList(
      phrasesList,
      phrases.map((entry) => `“${entry.phrase}” — ${entry.count.toLocaleString()} times`),
      'Nothing is repeated.',
    );
  }

  /**
   * @purpose Draws one of the two analysis lists, or says why it is empty (FR-12.8).
   * @inputs list - The list element to fill. entries - The lines to show. empty - What to say instead
   *   when there are none.
   * @outputs void.
   * @dataflow entries -> one list item each, by textContent.
   * @controlflow An empty result gets a sentence rather than an empty box: a list with nothing in it
   *   looks like something that failed to load.
   */
  function fillList(list: HTMLElement, entries: readonly string[], empty: string): void {
    list.replaceChildren();
    // Check whether there is anything to list.
    if (entries.length === 0) {
      const note = doc.createElement('li');
      note.className = 'kdoc-statistics-empty-note';
      note.textContent = empty;
      list.appendChild(note);
    } else {
      for (const entry of entries) {
        const item = doc.createElement('li');
        // textContent, not innerHTML: these lines are the reader's own words.
        item.textContent = entry;
        list.appendChild(item);
      }
    }
  }

  /**
   * @purpose Writes one readability measure into its row, for the document and the selection (FR-12.6).
   * @inputs row - The row to fill. docScores / selScores - The scores, or null when there is not enough
   *   text to score. read - Picks the measure out of a score.
   * @outputs void.
   * @dataflow The scores -> the chosen measure -> one decimal place -> the cells.
   * @controlflow A text with no words or no sentences has no score, and shows an em dash rather than a
   *   number: a readability score of zero is a real and very bad score, not the absence of one.
   */
  function writeScore(
    row: { readonly docCell: HTMLElement; readonly selCell: HTMLElement },
    docScores: ReadabilityScores | null,
    selScores: ReadabilityScores | null,
    read: (scores: ReadabilityScores) => number,
  ): void {
    // Check whether the document could be scored at all.
    if (docScores === null) {
      row.docCell.textContent = '—';
    } else {
      // One decimal place: the formulae are estimates, and more figures would suggest a precision the
      // syllable count does not have.
      row.docCell.textContent = read(docScores).toFixed(1);
    }

    // Check whether a selection could be scored; nothing selected and too little selected read the same.
    if (selScores === null) {
      row.selCell.textContent = '—';
    } else {
      row.selCell.textContent = read(selScores).toFixed(1);
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

  // Handle Escape keydown for environments where cancel event is not automatically dispatched.
  dialog.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      // Check if pressed key is Escape.
      if (event.key === 'Escape') {
        // Escape pressed: dismiss dialog.
        event.preventDefault();
        close();
      } else {
        // Other key: allow default event flow.
      }
    },
    { signal },
  );

  // Mount native dialog into the document body.
  options.doc.body.appendChild(dialog);

  /**
   * Opens the statistics modal dialog, refreshing metrics and focusing the Close button.
   *
   * @purpose Displays the modal statistics dialog with showModal() and captures fresh text statistics.
   * @inputs void.
   * @outputs void.
   * @dataflow updateMetrics() -> dialog.showModal() -> closeButton.focus().
   * @controlflow Check destroyed guard -> update statistics snapshot -> open dialog modal -> focus Close button.
   */
  function open(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed; ignore open request.
      return;
    } else {
      // Component is active; proceed with opening dialog.
    }

    updateMetrics();

    // Check if dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog already open: skip showModal.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Focus the Close button on open.
    // Check if focus method is supported on the Close button.
    if (typeof closeButton.focus === 'function') {
      // Focus Close button for accessibility and quick keyboard dismissal.
      closeButton.focus();
    } else {
      // Focus not supported in current environment.
    }
  }

  /**
   * Closes the statistics modal dialog.
   *
   * @purpose Dismisses the modal dialog element idempotently across environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check destroyed guard -> check if dialog is open -> invoke dialog.close() or set open = false.
   */
  function close(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed; ignore close request.
      return;
    } else {
      // Component is active; proceed with closing.
    }

    // Check if dialog is currently open.
    if (dialog.open) {
      // Check if native close() method is supported.
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        // Fallback for test environments lacking close().
        dialog.open = false;
      }
    } else {
      // Dialog already closed: no operation required.
    }
  }

  /**
   * Tears down the statistics dialog component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes dialog, and removes element from document body.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> dialog.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard -> mark destroyed = true -> abort controller -> close dialog -> remove dialog element from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component already destroyed; idempotent return.
      return;
    } else {
      // Component active; mark destroyed and proceed with teardown.
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
        // Destroyed component reports false.
        return false;
      } else {
        // Active component reflects dialog.open attribute.
        return dialog.open;
      }
    },
    destroy,
  };
}
