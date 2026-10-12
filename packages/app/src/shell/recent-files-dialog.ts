/**
 * @file recent-files-dialog.ts
 * @purpose Implements RecentFilesDialog, an accessible modal dialog using the native HTMLDialogElement for displaying, opening, pinning, and forgetting recent files (FR-6.1).
 * @inputs RecentFilesDialogOptions containing the Document context, onOpen, onTogglePin, and onForget callbacks.
 * @outputs RecentFilesDialog controller instance exposing open, close, and destroy lifecycle methods, alongside RECENT_FILES_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installRecentFilesDialog: Constructs, styles, and mounts the native recent files dialog element, binds button actions and lifecycle controls, and returns the RecentFilesDialog controller.
 *   - splitPath: Splits a file path into its basename for primary recognition and containing folder for disambiguation.
 * @dataflow options.open(files) -> DOM list reconstruction -> user interaction (pin / forget / open / close) -> callback dispatch -> list update or dialog close.
 * @controlflow Mount native dialog to document body -> build header, list, and Close button -> wire Escape and cancel handlers -> return RecentFilesDialog controller with open, close, and destroy methods.
 * @version 3
 * @date 2026-10-04
 */

import type { RecentFile } from '@k-doc/config';

export interface RecentFilesDialogOptions {
  readonly doc: Document;
  /** Opens the chosen path. */
  readonly onOpen: (path: string) => void;
  /** Pins an unpinned entry or unpins a pinned one, and returns the list as it now stands. */
  readonly onTogglePin: (path: string) => readonly RecentFile[];
  /** Removes an entry outright, and returns the list as it now stands. */
  readonly onForget: (path: string) => readonly RecentFile[];
}

export interface RecentFilesDialog {
  /** Opens the dialog showing `files` in the order given. */
  open(files: readonly RecentFile[]): void;
  close(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the recent files modal dialog, styling the dialog backdrop, container,
 * header, recent files list, items, pin button, open button with basename and folder, forget button,
 * empty state, and footer Close button using exclusively authoritative K-Doc design tokens.
 */
export const RECENT_FILES_DIALOG_STYLES: string = `
dialog.kdoc-recent-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  min-width: 420px;
  max-width: 520px;
  width: calc(100% - 32px);
  max-height: 70vh;
  overflow-y: auto;
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-recent-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

dialog.kdoc-recent-dialog::-webkit-scrollbar {
  width: 8px;
}

dialog.kdoc-recent-dialog::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

dialog.kdoc-recent-dialog::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-recent-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kdoc-recent-title {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-recent-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--kdoc-chrome-base);
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  box-shadow: none;
}

.kdoc-recent-item {
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  padding: 4px;
  border-radius: var(--kdoc-radius-sm);
  transition: background 0.15s ease;
}

.kdoc-recent-item:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-recent-pin,
.kdoc-recent-forget {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  box-sizing: border-box;
  flex-shrink: 0;
  box-shadow: var(--kdoc-elevation-raised);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-recent-pin:hover,
.kdoc-recent-forget:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-recent-pin:active,
.kdoc-recent-forget:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-recent-pin:focus-visible,
.kdoc-recent-forget:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-recent-open {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  padding: 6px 8px;
  cursor: pointer;
  font: inherit;
  text-align: left;
  box-sizing: border-box;
  min-width: 0;
  transition: background 0.15s ease;
}

.kdoc-recent-open:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-recent-open:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-recent-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
  line-height: 1.3;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-recent-path {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1.3;
  width: 100%;
}

.kdoc-recent-empty {
  color: var(--kdoc-chrome-text-muted);
  text-align: center;
  font-size: 13px;
  padding: 24px 8px;
  font-style: italic;
}

.kdoc-recent-actions {
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

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-recent-dialog,
  dialog.kdoc-recent-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Splits a file path into its basename and containing directory.
 *
 * @purpose Splits a file path into the basename displayed to the user and the containing directory path.
 * @inputs filePath - The raw file path to parse.
 * @outputs An object with readonly name and folder string fields.
 * @dataflow filePath -> last index search for '/' and '\\' -> slice into basename and folder components.
 * @controlflow Find rightmost path separator -> if separator exists split into folder and basename; otherwise folder is empty and name is full path.
 */
function splitPath(filePath: string): { readonly name: string; readonly folder: string } {
  // Find the last '/' or '\\' path delimiter. Both separators are checked because a
  // Windows path uses one and a path that came back from a dialog or URL may use the other.
  // The name is what the user recognises and the folder is what tells two files of the same
  // name apart — which is the whole reason the folder is shown at all rather than the full
  // path, which would push the name off the left of a narrow dialog. Split the basename on both '/' and '\\'.
  const lastSlash = filePath.lastIndexOf('/');
  const lastBackslash = filePath.lastIndexOf('\\');
  const lastSepIndex = Math.max(lastSlash, lastBackslash);

  // Check whether a path separator was found in the path string.
  if (lastSepIndex >= 0) {
    const name = filePath.slice(lastSepIndex + 1);
    let folder: string;
    // Check if the separator is at the very root (index 0, e.g. /file.md).
    if (lastSepIndex === 0) {
      // Root Unix separator: retain root slash as containing folder.
      folder = filePath.slice(0, 1);
    } else if (lastSepIndex === 2 && filePath.charAt(1) === ':') {
      // Root Windows drive separator (e.g. C:\file.md): retain drive with trailing slash.
      folder = filePath.slice(0, 3);
    } else {
      // Standard directory path: omit trailing separator for clean display.
      folder = filePath.slice(0, lastSepIndex);
    }
    return { name, folder };
  } else {
    // No path separator present: folder is empty and entire string is the basename.
    return { name: filePath, folder: '' };
  }
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple recent files dialog instances. */
let nextRecentFilesDialogId = 0;

/**
 * Installs the modal recent files dialog into the document body, wiring actions and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for managing and opening recent files with pinning support.
 * @inputs options - RecentFilesDialogOptions containing document context and onOpen, onTogglePin, onForget callbacks.
 * @outputs RecentFilesDialog - Controller exposing open, close, and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> user clicks / Escape -> callbacks & close() -> RecentFilesDialog.
 * @controlflow Create dialog DOM hierarchy -> configure dialog role and aria attributes -> bind cancel and close handlers -> append dialog to document body -> return RecentFilesDialog controller.
 */
export function installRecentFilesDialog(options: RecentFilesDialogOptions): RecentFilesDialog {
  const doc = options.doc;
  const dialogId = ++nextRecentFilesDialogId;
  const titleId = `kdoc-recent-title-${dialogId}`;

  let destroyed = false;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-recent-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-recent-dialog-content';

  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'kdoc-recent-title';
  heading.textContent = 'Open Recent';
  content.appendChild(heading);

  const listEl = doc.createElement('ul');
  listEl.className = 'kdoc-recent-list';
  content.appendChild(listEl);

  const actions = doc.createElement('div');
  actions.className = 'kdoc-recent-actions';

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.className = 'kdoc-dialog-button kdoc-dialog-button-secondary kdoc-recent-close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.addEventListener('click', (): void => {
    close();
  });
  actions.appendChild(closeButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Closes the recent files modal dialog if currently open.
   *
   * @purpose Dismisses the modal dialog in an idempotent manner across native and test environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check if dialog is currently open -> invoke native close() or set open = false -> return.
   */
  function close(): void {
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

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    // Escape key fires the native dialog cancel event rather than a click.
    event.preventDefault();
    close();
  });

  /**
   * Rebuilds the recent files list items inside the <ul> element.
   *
   * @purpose Clears and reconstructs the recent file items or renders the empty state placeholder.
   *   The dialog never edits the list itself — it shows what it is given and reports what the user did,
   *   so there is one owner of the list and it is not this file.
   * @inputs files - The ordered array of recent file records to render.
   * @outputs void.
   * @dataflow files -> map to <li> DOM elements (pin button, open button with name/folder, forget button) or empty <li> -> listEl.
   * @controlflow Clear existing list items -> check if files array is empty -> if empty append empty placeholder -> else for each file build item elements, wire handlers, and append to list.
   */
  function renderList(files: readonly RecentFile[]): void {
    // Clear any existing list items.
    while (listEl.firstChild !== null) {
      listEl.removeChild(listEl.firstChild);
    }

    // Check if the recent files list is empty.
    if (files.length === 0) {
      // Render a single <li class="kdoc-recent-empty"> reading 'No recent files.' instead of the items.
      const emptyLi = doc.createElement('li');
      emptyLi.className = 'kdoc-recent-empty';
      emptyLi.textContent = 'No recent files.';
      listEl.appendChild(emptyLi);
      return;
    } else {
      // List contains entries: render each recent file item.
    }

    // Iterate over each file record in the given order.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Strict TypeScript with noUncheckedIndexedAccess: narrow every indexed access.
      if (file === undefined) {
        // Element at index is undefined: skip iteration.
        continue;
      } else {
        // Valid file entry: construct DOM item.
      }

      const itemLi = doc.createElement('li');
      itemLi.className = 'kdoc-recent-item';

      // 1. Pin button: class="kdoc-recent-pin", text is '📌' when pinned and '📍' when not.
      // aria-pressed set accordingly and title of 'Unpin' / 'Pin'.
      const pinBtn = doc.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'kdoc-recent-pin';
      // Check if the current entry is pinned.
      if (file.pinned) {
        // Entry is pinned: set pin emoji, aria-pressed true, and Unpin title.
        pinBtn.textContent = '📌';
        pinBtn.setAttribute('aria-pressed', 'true');
        pinBtn.title = 'Unpin';
        pinBtn.setAttribute('aria-label', 'Unpin');
      } else {
        // Entry is not pinned: set unpinned emoji, aria-pressed false, and Pin title.
        pinBtn.textContent = '📍';
        pinBtn.setAttribute('aria-pressed', 'false');
        pinBtn.title = 'Pin';
        pinBtn.setAttribute('aria-label', 'Pin');
      }

      pinBtn.addEventListener('click', (): void => {
        // Clicking pin calls onTogglePin and rebuilds from what it returns, without closing —
        // pinning is a thing you do to the list, not a way of leaving it.
        const updatedList = options.onTogglePin(file.path);
        renderList(updatedList);
      });
      itemLi.appendChild(pinBtn);

      // 2. Open button: class="kdoc-recent-open", containing two spans:
      // kdoc-recent-name holding basename and kdoc-recent-path holding containing folder.
      const openBtn = doc.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'kdoc-recent-open';
      openBtn.title = file.path;

      const parsed = splitPath(file.path);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'kdoc-recent-name';
      nameSpan.textContent = parsed.name;
      openBtn.appendChild(nameSpan);

      const pathSpan = doc.createElement('span');
      pathSpan.className = 'kdoc-recent-path';
      pathSpan.textContent = parsed.folder;
      openBtn.appendChild(pathSpan);

      openBtn.addEventListener('click', (): void => {
        // Clicking the open button calls options.onOpen(path) then close().
        options.onOpen(file.path);
        close();
      });
      itemLi.appendChild(openBtn);

      // 3. Forget button: class="kdoc-recent-forget" with text '✕', title 'Remove from this list'.
      const forgetBtn = doc.createElement('button');
      forgetBtn.type = 'button';
      forgetBtn.className = 'kdoc-recent-forget';
      forgetBtn.textContent = '✕';
      forgetBtn.title = 'Remove from this list';
      forgetBtn.setAttribute('aria-label', 'Remove from this list');

      forgetBtn.addEventListener('click', (): void => {
        // Clicking forget calls onForget and rebuilds, without closing.
        const updatedList = options.onForget(file.path);
        renderList(updatedList);
      });
      itemLi.appendChild(forgetBtn);

      listEl.appendChild(itemLi);
    }
  }

  /**
   * Opens the recent files modal dialog displaying the given file list.
   *
   * @purpose Populates and displays the modal recent files dialog with current entries.
   * @inputs files - The ordered list of recent file records to display.
   * @outputs void.
   * @dataflow files -> renderList(files) -> showModal() or open = true.
   * @controlflow Check destroyed guard -> rebuild list via renderList -> check dialog open state -> open dialog via showModal or open fallback.
   */
  function open(files: readonly RecentFile[]): void {
    // Check if the recent files dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: do not open.
      return;
    } else {
      // Component is active: proceed to display recent files.
    }

    // The list is rebuilt on every open and after every pin or forget, from the array the callback returns.
    // The dialog never edits the list itself — it shows what it is given and reports what the user did,
    // so there is one owner of the list and it is not this file.
    renderList(files);

    // Check if the dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog is already open: skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }
  }

  /**
   * Destroys the recent files dialog component, closing it and removing its DOM element.
   *
   * @purpose Idempotently cleans up the dialog component, closes the dialog, and removes the DOM element.
   * @inputs void.
   * @outputs void.
   * @dataflow mark destroyed = true -> close() -> dialog.remove().
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> close dialog -> remove dialog from DOM.
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

    close();
    dialog.remove();
  }

  return {
    open,
    close,
    destroy,
  };
}
