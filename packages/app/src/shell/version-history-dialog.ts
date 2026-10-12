/**
 * @file version-history-dialog.ts
 * @purpose The Version History dialog (FR-11.9, FR-11.10): lists a document's local snapshots newest first, shows the chosen one as a word-level diff against the current text or as the old text, restores it as a new revision and copies a passage out of it.
 * @inputs snapshot list and read callbacks, the current text, the clock, restore and copy callbacks.
 * @outputs a dialog controller and VERSION_HISTORY_STYLES.
 * @functions installVersionHistoryDialog - installs the dialog into doc.body and returns its controller.
 * @dataflow list() -> rows; row click -> read(id) -> diffWords(old, current) -> ins/del spans or old text; buttons -> restore/copy.
 * @controlflow open lists and selects the newest; each selection loads its text once (cached) and ignores a load that a later selection overtook.
 * @version 5
 * @date 2026-10-04
 */

import { countChangedWords, diffWords } from '@k-doc/core';
import type { SnapshotReason } from '../files/snapshot-store.js';
import { formatRelativeTime } from './history-panel.js';

/**
 * @purpose Configuration for installVersionHistoryDialog: callbacks into the snapshot store and editor.
 * @inputs doc — host document; list/read reach the snapshot store for the open document; current is the text now on screen, compared with every version; restore puts a version back as a new revision; copy writes to the clipboard; now is the clock in milliseconds.
 * @outputs none (describes callback shapes).
 */
export interface VersionHistoryOptions {
  readonly doc: Document;
  readonly list: () => Promise<readonly VersionEntry[]>;
  readonly read: (id: string) => Promise<string>;
  readonly current: () => string;
  readonly now: () => number;
  readonly restore: (text: string, snapshot: VersionEntry) => void;
  /** Opens the version compared with the current document as tracked changes (FR-11.7); without it there is no button. */
  readonly compare?: (text: string, snapshot: VersionEntry) => void;
  readonly copy: (text: string) => Promise<void>;
}

/**
 * @purpose Controller returned by installVersionHistoryDialog for opening, closing and tearing down the dialog.
 * @inputs none.
 * @outputs open resolves once the dialog is shown; close hides it; isOpen reflects dialog.open; destroy removes it permanently.
 */
/**
 * @purpose One version the dialog lists: a local snapshot, or a git commit that touched the file (FR-11.11).
 * @inputs none.
 * @outputs id - Handed back to read(); at - When, in epoch milliseconds; reason - Why it exists; detail - An extra line, such as a commit's short hash and subject.
 */
export interface VersionEntry {
  readonly id: string;
  readonly at: number;
  readonly reason: SnapshotReason | 'commit';
  readonly detail?: string;
}

export interface VersionHistoryDialog {
  open(): Promise<void>;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * @purpose How a selected snapshot is rendered: 'changes' shows a word-level diff against the current text, 'old' shows the version's text as it was.
 * @inputs none.
 * @outputs none.
 */
export type VersionView = 'changes' | 'old';

// Theme-token CSS for the dialog; ins/del mark added and removed words in the diff view.
export const VERSION_HISTORY_STYLES: string = `
dialog.kdoc-version-history {
  width: min(960px, 96vw);
  height: min(720px, 90vh);
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
  overflow: hidden;
}

dialog.kdoc-version-history::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-version-body {
  display: grid;
  grid-template-columns: minmax(12em, 16em) 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 12px 16px;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-lg);
}

.kdoc-version-heading {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-version-list {
  overflow-y: auto;
  border-right: 1px solid var(--kdoc-chrome-glass-edge);
  padding-right: 8px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-version-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-version-row:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-version-row[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-version-row:focus-visible,
.kdoc-version-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-version-when {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  border: 0;
  box-shadow: none;
  background: transparent;
}

.kdoc-version-reason {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-version-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}

.kdoc-version-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kdoc-version-summary {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  border: 0;
  box-shadow: none;
  background: transparent;
}

.kdoc-version-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--kdoc-mono-font, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kdoc-chrome-text);
  user-select: text;
}

.kdoc-version-content ins {
  text-decoration: none;
  background: color-mix(in srgb, var(--kdoc-emissive-green) 25%, transparent);
  color: var(--kdoc-emissive-green);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-version-content del {
  background: color-mix(in srgb, var(--kdoc-emissive-red) 25%, transparent);
  color: var(--kdoc-emissive-red);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-version-button {
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-version-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-version-button:active:not(:disabled),
.kdoc-version-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-version-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-version-empty {
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  padding: 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-version-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-version-status {
  flex: 1;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-version-list::-webkit-scrollbar,
.kdoc-version-content::-webkit-scrollbar {
  width: 8px;
}

.kdoc-version-list::-webkit-scrollbar-track,
.kdoc-version-content::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-version-list::-webkit-scrollbar-thumb,
.kdoc-version-content::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-version-history,
  dialog.kdoc-version-history * {
    transition: none !important;
    animation: none !important;
  }
}
`;

// How each snapshot reason is labelled in the list.
const REASON_LABELS: Readonly<Record<VersionEntry['reason'], string>> = { save: 'Saved', manual: 'Snapshot', timer: 'Automatic', restore: 'Before restore', commit: 'Git commit' };

/**
 * @purpose Builds the Version History dialog, mounts it into doc.body and returns its controller.
 * @inputs options — list/read reach the snapshot store for the open document; current is the text now on screen, compared with every version; restore puts a version back as a new revision; copy writes to the clipboard; now is the clock.
 * @outputs VersionHistoryDialog - open/close/isOpen/destroy plus the mounted <dialog>.
 * @dataflow options callbacks -> local state (snapshots, selected, texts) -> DOM rows and content pane.
 * @controlflow Create elements once, wire event listeners with a lifetime signal, return the controller; open() populates state on demand.
 */
export function installVersionHistoryDialog(options: VersionHistoryOptions): VersionHistoryDialog {
  const { doc } = options;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  // Caches what each snapshot held, loaded once per opening of the dialog.
  const texts = new Map<string, string>();
  let snapshots: readonly VersionEntry[] = [];
  let selected: VersionEntry | null = null;
  let view: VersionView = 'changes';
  // Each selection or close bumps this so a slow read that a later click overtook does not draw.
  let loadToken = 0;
  let destroyed = false;

  /**
   * @purpose Creates an element with a class and optional text content.
   * @inputs tag — HTML tag name; className — single class name; text — optional initial text (default '').
   * @outputs The created element typed by its tag.
   * @dataflow Inputs -> createElement -> set className and textContent -> return.
   * @controlflow Linear construction with no branching.
   */
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string = ''): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  /**
   * @purpose Creates a styled action button of type "button" so it never submits a form.
   * @inputs text — the button label.
   * @outputs The created HTMLButtonElement.
   * @dataflow text -> el('button', ...) -> set type -> return.
   * @controlflow Linear construction with no branching.
   */
  function button(text: string): HTMLButtonElement {
    const b = el('button', 'kdoc-version-button', text);
    b.type = 'button';
    return b;
  }

  // Build the static dialog markup once.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-version-history';
  dialog.setAttribute('aria-labelledby', 'kdoc-version-heading');
  const body = el('div', 'kdoc-version-body');
  const heading = el('h2', 'kdoc-version-heading', 'Version History');
  heading.id = 'kdoc-version-heading';
  const list = el('div', 'kdoc-version-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Snapshots');
  const main = el('div', 'kdoc-version-main');
  const toolbar = el('div', 'kdoc-version-toolbar');
  const changesButton = button('Changes');
  const oldButton = button('Old Version');
  const summary = el('span', 'kdoc-version-summary');
  toolbar.append(changesButton, oldButton, summary);
  const content = el('div', 'kdoc-version-content');
  content.tabIndex = 0;
  content.setAttribute('aria-label', 'Selected version');
  main.append(toolbar, content);
  const footer = el('div', 'kdoc-version-footer');
  const status = el('div', 'kdoc-version-status');
  status.setAttribute('role', 'status');
  const copyButton = button('Copy Selection');
  const restoreButton = button('Restore This Version');
  const compareButton = button('Open as Tracked Changes');
  const closeButton = button('Close');
  footer.append(status, copyButton);
  // Check whether the host can open a comparison.
  if (options.compare !== undefined) {
    // It can: offer it beside Restore.
    footer.append(compareButton);
  } else {
    // It cannot: leave the button out rather than show one that does nothing.
  }
  footer.append(restoreButton, closeButton);
  body.append(heading, list, main, footer);
  dialog.append(body);
  doc.body.append(dialog);

  /**
   * @purpose Enables or disables the copy and restore actions, which require a loaded version.
   * @inputs enabled — true to enable both action buttons, false to disable them.
   * @outputs none.
   * @dataflow enabled -> disabled flags on copyButton and restoreButton.
   * @controlflow Linear assignment with no branching.
   */
  function setActionsEnabled(enabled: boolean): void {
    copyButton.disabled = !enabled;
    restoreButton.disabled = !enabled;
    compareButton.disabled = !enabled;
  }

  /**
   * @purpose Renders the snapshot listbox newest first, marking the selected row.
   * @inputs now — current time in milliseconds used by formatRelativeTime.
   * @outputs none (mutates the list element's children).
   * @dataflow snapshots -> reversed -> per-snapshot rows with relative time and reason label.
   * @controlflow Empty list shows a placeholder; otherwise maps each snapshot to a row button.
   */
  function drawList(now: number): void {
    // No snapshots: show the empty placeholder instead of a listbox.
    if (snapshots.length === 0) {
      list.replaceChildren(el('div', 'kdoc-version-empty', 'No snapshots yet. One is kept each time you save.'));
    } else {
      // Snapshots exist: build one row per snapshot, newest first via reverse().
      list.replaceChildren(...[...snapshots].reverse().map((snapshot) => {
        const row = el('button', 'kdoc-version-row');
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.dataset['id'] = snapshot.id;
        // Highlight the currently selected row.
        row.setAttribute('aria-selected', String(selected?.id === snapshot.id));
        // The full local date is available on hover via the tooltip.
        row.title = new Date(snapshot.at).toLocaleString();
        row.append(el('span', 'kdoc-version-when', formatRelativeTime(snapshot.at, now)), el('span', 'kdoc-version-reason', REASON_LABELS[snapshot.reason]));
        // Check whether this version carries an extra line, as a commit does.
        if (snapshot.detail !== undefined) {
          // A commit: show its short hash and subject under the reason.
          row.append(el('span', 'kdoc-version-reason', snapshot.detail));
        } else {
          // A snapshot: the reason says it all.
        }
        return row;
      }));
    }
  }

  /**
   * @purpose Draws the content pane for the selected snapshot in the current view.
   * @inputs none (reads selected, texts, view and options.current()).
   * @outputs none (mutates summary, content and action-button state).
   * @dataflow loaded text -> diffWords(old, current) -> ins/del spans or plain old text; counts feed the summary.
   * @controlflow Without a loaded version nothing is shown and actions are off; otherwise render changes or old view.
   */
  function drawContent(): void {
    // Reflect the active view in the two toggle buttons.
    changesButton.setAttribute('aria-pressed', String(view === 'changes'));
    oldButton.setAttribute('aria-pressed', String(view === 'old'));
    const text = selected === null ? undefined : texts.get(selected.id);
    // No loaded version: hide the summary and disable the actions.
    if (text === undefined) {
      summary.textContent = '';
      setActionsEnabled(false);
      return;
    } else {
      // A version is loaded: enable the actions.
      setActionsEnabled(true);
    }
    const parts = diffWords(text, options.current());
    const counts = countChangedWords(parts);
    // The diff runs old -> current, so ins is what was added since and del what was removed.
    if (parts.every((part) => part.kind === 'equal')) {
      // Identical texts: say so instead of reporting a diff.
      summary.textContent = 'Same as the current document';
    } else {
      summary.textContent = `Since then: ${counts.inserted} words added, ${counts.deleted} removed`;
    }
    // The old view shows the version text verbatim; the changes view renders the word-level diff.
    if (view === 'old') {
      content.replaceChildren(doc.createTextNode(text));
    } else {
      content.replaceChildren(...parts.map((part) => {
        // Inserted words were added since the snapshot: mark them as ins.
        if (part.kind === 'insert') {
          return el('ins', 'kdoc-diff-insert', part.text);
        } else if (part.kind === 'delete') {
          // Deleted words were present in the snapshot but not now: mark them as del.
          return el('del', 'kdoc-diff-delete', part.text);
        } else {
          // Equal words are unchanged text nodes.
          return doc.createTextNode(part.text);
        }
      }));
    }
  }

  /**
   * @purpose Selects a snapshot, loading its text once (cached) and redrawing the content pane.
   * @inputs snapshot — the VersionEntry to select.
   * @outputs none (mutates selected, status, content and list).
   * @dataflow snapshot.id -> read(id) if uncached -> texts cache -> diffWords(old, current) in drawContent.
   * @controlflow Mark selection, bump loadToken, load cached-or-fresh text, then draw only if not overtaken; a failed read is reported only if still the current selection.
   */
  async function select(snapshot: VersionEntry): Promise<void> {
    selected = snapshot;
    status.textContent = '';
    drawList(options.now());
    // Bump the token so an overtook load ignores its result.
    const token = ++loadToken;
    // Cached versions draw at once without a read.
    if (!texts.has(snapshot.id)) {
      content.replaceChildren(el('div', 'kdoc-version-empty', 'Loading…'));
      drawContent();
      try {
        const text = await options.read(snapshot.id);
        texts.set(snapshot.id, text);
      } catch (error: unknown) {
        // Report the failure only if this read has not been overtaken by a later selection.
        if (token === loadToken) {
          content.replaceChildren(el('div', 'kdoc-version-empty', `Could not read this version: ${error instanceof Error ? error.message : String(error)}`));
        } else {
          // Overtaken: drop the result silently; a newer selection owns the pane.
        }
        return;
      }
    } else {
      // Cached: nothing to load, fall through to draw below.
    }
    // Draw only if this selection still owns the pane and the dialog is alive.
    if (token === loadToken && !destroyed) {
      drawContent();
    } else {
      // Overtaken or destroyed: do not redraw.
    }
  }

  /**
   * @purpose Returns the selected text within the content pane, stripping diff markup.
   * @inputs none (reads doc.getSelection and content).
   * @outputs The plain-text selection, or null if there is no valid in-pane selection.
   * @dataflow selection range -> cloneContents -> remove <ins> -> fragment.textContent.
   * @controlflow Reject empty/out-of-pane selections; drop inserted words so the copied passage reflects the old version.
   */
  function selectionText(): string | null {
    const selection = doc.getSelection();
    // No live, non-collapsed selection: nothing to copy.
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    } else {
      // A valid selection exists; fall through to extract it.
    }
    const range = selection.getRangeAt(0);
    // Only a selection anchored inside the content pane counts.
    if (!content.contains(range.commonAncestorContainer)) {
      return null;
    } else {
      // The selection is in-pane; fall through to clone it.
    }
    const fragment = range.cloneContents();
    // In the Changes view inserted text did not exist in the old version, so drop <ins> from the copied passage.
    for (const inserted of Array.from(fragment.querySelectorAll('ins'))) {
      inserted.remove();
    }
    return fragment.textContent ?? '';
  }

  // A row click selects its snapshot; clicks outside a row are ignored.
  list.addEventListener('click', (event: MouseEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.kdoc-version-row') : null;
    const snapshot = snapshots.find((candidate) => candidate.id === row?.dataset['id']);
    // A recognised row was clicked: select it.
    if (snapshot !== undefined) {
      void select(snapshot);
    } else {
      // Not a row click (e.g. clicking the list gutter): ignore.
    }
  }, { signal });
  // Toggle to the diff view.
  changesButton.addEventListener('click', () => { view = 'changes'; drawContent(); }, { signal });
  // Toggle to the raw old-text view.
  oldButton.addEventListener('click', () => { view = 'old'; drawContent(); }, { signal });
  // A mouse press on a button would collapse the text selection before the click, leaving nothing to copy; cancelling the press keeps it.
  copyButton.addEventListener('mousedown', (event: MouseEvent) => { event.preventDefault(); }, { signal });
  // Copy either the selected passage or, without a selection, the whole version.
  copyButton.addEventListener('click', () => {
    const text = selected === null ? undefined : texts.get(selected.id);
    // No loaded version: nothing to copy.
    if (text === undefined) {
      return;
    } else {
      // A version is loaded; fall through to build the passage.
    }
    const passage = selectionText();
    options.copy(passage ?? text).then(() => {
      // Report whether a passage or the whole version was copied.
      status.textContent = passage === null ? 'Copied the whole version.' : 'Copied the selected passage.';
    }).catch((error: unknown) => {
      // On failure report the error message or its string form.
      status.textContent = `Could not copy: ${error instanceof Error ? error.message : String(error)}`;
    });
  }, { signal });
  // Restore the selected version as a new revision, then close so it is on screen.
  restoreButton.addEventListener('click', () => {
    const text = selected === null ? undefined : texts.get(selected.id);
    // No selection or loaded version: nothing to restore.
    if (selected === null || text === undefined) {
      return;
    } else {
      options.restore(text, selected);
      close();
    }
  }, { signal });
  // Dismiss the dialog without changing any document state.
  // Open the selected version against the current document as tracked changes, then close so the new tab is on screen.
  compareButton.addEventListener('click', () => {
    const text = selected === null ? undefined : texts.get(selected.id);
    // Check that a version is loaded and the host can compare.
    if (selected === null || text === undefined || options.compare === undefined) {
      // Nothing loaded, or no comparison: nothing to do.
      return;
    } else {
      // Loaded: hand it over and close.
      options.compare(text, selected);
      close();
    }
  }, { signal });
  closeButton.addEventListener('click', () => { close(); }, { signal });

  /**
   * @purpose Opens the dialog, refreshing the snapshot list and selecting the newest entry.
   * @inputs none.
   * @outputs Resolves once the newest snapshot has been selected (or immediately if empty).
   * @dataflow options.list() -> rows; newest row -> select(newest) -> read + drawContent.
   * @controlflow Reset state, show the dialog, load the list afresh, then select the newest; a destroyed dialog returns early.
   */
  async function open(): Promise<void> {
    // Already destroyed: refuse to reopen.
    if (destroyed) {
      return;
    } else {
      // Not destroyed; fall through to initialise and show.
    }
    texts.clear();
    selected = null;
    view = 'changes';
    status.textContent = '';
    content.replaceChildren();
    setActionsEnabled(false);
    // Show the dialog modally when supported, falling back to the open attribute.
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        // No showModal support: use the boolean open attribute instead.
        dialog.setAttribute('open', '');
      }
    } else {
      // Already open: leave it as-is.
    }
    list.replaceChildren(el('div', 'kdoc-version-empty', 'Loading…'));
    try {
      snapshots = await options.list();
    } catch (error: unknown) {
      snapshots = [];
      list.replaceChildren(el('div', 'kdoc-version-empty', `Could not list versions: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    drawList(options.now());
    drawContent();
    // The newest snapshot is the last entry in the store's order.
    const newest = snapshots[snapshots.length - 1];
    if (newest !== undefined) {
      await select(newest);
    } else {
      // No snapshots: leave the empty list visible.
    }
  }

  /**
   * @purpose Closes the dialog and overtakes any in-flight read so it cannot draw afterwards.
   * @inputs none.
   * @outputs none.
   * @dataflow loadToken bump -> dialog.close() (or remove open attribute).
   * @controlflow Increment loadToken to invalidate pending loads, then hide the dialog.
   */
  function close(): void {
    // Bump the token so any pending read ignores its result on return.
    loadToken += 1;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      // No close() method: clear the open attribute instead.
      dialog.removeAttribute('open');
    }
  }

  /**
   * @purpose Permanently tears down the dialog and stops all listeners.
   * @inputs none.
   * @outputs none.
   * @dataflow destroyed flag + abort signal -> close() -> remove element.
   * @controlflow Mark destroyed, close, abort the lifetime signal to detach listeners, then remove the element.
   */
  function destroy(): void {
    destroyed = true;
    close();
    lifetime.abort();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      // isOpen reflects the native dialog's open state.
      return dialog.open;
    },
    destroy,
  };
}
