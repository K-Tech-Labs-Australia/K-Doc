/**
 * @file file-menu.ts
 * @purpose Implements the file menu toolbar controls (Open, Save, Save As), document lifecycle actions, keyboard shortcuts, and document path tracking for K-Doc.
 *   It is deliberately separate from EditorShell so the shell stays about layout and this stays about documents.
 *   **Save a Copy is not Save As.** Save As moves the document to the new file and leaves the old one behind;
 *   Save a Copy writes a second file and leaves the document where it was. Rename is neither: it moves the file
 *   and takes the document with it.
 * @inputs FileMenuOptions containing the toolbar container, DocumentSession, FileService, Window object, change notification callback, and error handler callback.
 * @outputs FileMenu instance providing current fileName and filePath getters, along with a destroy lifecycle cleanup method.
 * @functions
 *   - installFileMenu: Instantiates and mounts the Open, Save, and Save As toolbar buttons, binds keyboard shortcuts, tracks file state, and returns a FileMenu controller.
 *   - saveACopy: Writes the document to a new path, leaving the original open and untouched.
 *   - rename: Renames the file on disk and follows it.
 *   - reveal: Opens the system file manager with this file selected.
 * @dataflow User button clicks / shortcut keypresses -> FileMenu actions (doOpen, doSave, doSaveAs) -> FileService dialogs & Rust IPC -> DocumentSession state updates -> onChange / onError notifications.
 * @controlflow Inspect FileService availability -> construct and append Open/Save/Save As DOM buttons -> attach keydown listener on window.document -> return FileMenu interface with fileName/filePath getters and destroy teardown.
 * @version 6
 * @date 2026-10-07
 */

import type { DocumentSession } from '@k-doc/core';
import type { FileService } from './file-service.js';

export interface FileMenuOptions {
  readonly toolbar: HTMLElement;
  readonly session: DocumentSession;
  readonly fileService: FileService;
  readonly win: Window;
  readonly onChange: () => void;
  readonly onError: (message: string) => void;

  /**
   * When false the menu does not claim Ctrl+O, Ctrl+S and Ctrl+Shift+S itself, because the host's remappable keymap
   * runs them (FR-14.16). Defaults to true.
   */
  readonly ownShortcuts?: boolean;

  /**
   * Asks the user what to do about unsaved changes, resolving 'save', 'discard' or 'cancel'.
   *
   * A two-way confirm cannot express "save first", so it forced a choice between losing work and
   * abandoning the action -- never the thing the user almost always means (FR-6.5).
   */
  readonly confirmUnsaved: (message: string) => Promise<'save' | 'discard' | 'cancel'>;

  /**
   * Called with a path whenever a document becomes associated with one -- opened, saved under a new
   * name, or renamed. The menu does not own the recent-files list; it only says what happened.
   */
  readonly onPathUsed?: (path: string) => void;
  /**
   * Asks the user for a new file name, resolving null when they cancel. Renaming needs a name, and a
   * name is a question the shell knows how to ask and this module does not.
   */
  readonly promptName?: (currentName: string) => Promise<string | null>;
  /** The path the document was read from, when it was opened before the menu was built (a tab being mounted). */
  readonly initialPath?: string | null;
  /** The encoding that file was found in, so a remounted tab saves it back as it was rather than as UTF-8. */
  readonly initialEncoding?: string;
  /**
   * Called with the text just written whenever a save of this document succeeds -- Save, Save As, and
   * autosave, which goes through Save. Save a Copy is not reported: it writes another file.
   */
  readonly onSaved?: (text: string) => void;
  /** Called after a successful rename with the old and new paths. */
  readonly onRenamed?: (from: string, to: string) => void;
}

export interface FileMenu {
  readonly fileName: string;
  readonly filePath: string | null;
  /** The encoding the open file was found in, which the next save writes back. */
  readonly encoding: string;
  /** Changes the encoding the next save will write. Does not rewrite the file on its own. */
  setEncoding(next: string): void;
  /** Runs the same action as the Open button, for the command palette and menus. */
  open(): void;
  /** Runs the same action as the Save button, resolving true when the document was written and false when the save failed or the user cancelled a picker. */
  save(): Promise<boolean>;
  /** Runs the same action as the Save As button, resolving true when the document was written and false when the save failed or (Save As) the user cancelled the file picker. */
  saveAs(): Promise<boolean>;
  /** Writes the document to a new path, leaving the original open and untouched. */
  saveACopy(): void;
  /** Renames the file on disk and follows it. */
  rename(): void;
  /** Follows the file to a new path after something else moved it on disk (the vault file tree, FR-6.11). */
  followPath(path: string): void;
  /** Opens the system file manager with this file selected. */
  reveal(): void;
  destroy(): void;
}

/**
 * Installs the Open, Save, and Save As buttons on the toolbar, attaches keyboard shortcuts, and coordinates document file I/O.
 *
 * @purpose Constructs and mounts file operation toolbar buttons, binds keyboard shortcuts, tracks document path and encoding state, and manages file operations.
 * @inputs options - FileMenuOptions containing DOM containers, DocumentSession, FileService, Window context, and callbacks.
 * @outputs FileMenu - Controller object exposing fileName, filePath, and destroy lifecycle method.
 * @dataflow options -> button elements attached to toolbar -> keyboard listeners attached to window.document -> actions coordinate FileService and DocumentSession -> onChange/onError callbacks.
 * @controlflow Probe fileService availability -> create and configure button elements -> bind click events to actions -> attach global keydown listener -> return FileMenu interface.
 */
export function installFileMenu(options: FileMenuOptions): FileMenu {
  // State held in the closure:
  // Tracks the active file path on disk, or null if the document is untitled.
  let currentPath: string | null = options.initialPath ?? null;

  // The encoding is carried from the opened file so a save writes it back as it was found -- K-Doc neither
  // adds a byte order mark nor removes one behind the user's back, and never converts a UTF-16 file to
  // UTF-8. An untitled buffer has never been read from disk, so it starts as plain UTF-8 unless a remounted
  // tab says what its file was.
  let encoding: string = options.initialEncoding ?? 'utf-8';

  // Idempotency flag for component destruction.
  let destroyed: boolean = false;

  /**
   * Prompts to open a Markdown file from disk, resetting document session content upon selection.
   *
   * @purpose Opens an existing Markdown file via FileService, prompting for unsaved change confirmation if dirty, and updates document state.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow FileService.openFile -> OpenedFile { path, contents, encoding } -> DocumentSession.reset -> markSaved -> onChange.
   * @controlflow Check dirty status and prompt confirmation -> invoke openFile dialog -> return early if cancelled -> reset session with file contents -> update currentPath & encoding -> mark session saved -> invoke onChange callback -> catch and route errors to onError.
   */
  async function doOpen(): Promise<void> {
    try {
      // Check if the current session contains unsaved modifications.
      if (options.session.snapshot.dirty) {
        const choice = await options.confirmUnsaved(
          'This document has unsaved changes. Save them before opening a different file?',
        );

        // Check which of the three answers the user gave.
        if (choice === 'cancel') {
          // User abandoned the whole action: leave the document exactly as it was.
          return;
        } else if (choice === 'save') {
          // User asked to save first. doSave routes its own failures to onError, so success is checked
          // by re-reading the session rather than by a return value: opening on top of a save that
          // failed is precisely the data loss this dialog exists to prevent.
          await doSave();

          // Check whether the save actually cleared the dirty flag.
          if (options.session.snapshot.dirty) {
            // Save failed or was cancelled at the picker: abort rather than discard the work.
            return;
          } else {
            // Save succeeded: proceed to the file picker.
          }
        } else {
          // User chose to discard: proceed to the file picker and lose the changes knowingly.
        }
      } else {
        // Session is clean: proceed directly to file picker.
      }

      const opened = await options.fileService.openFile();
      // Check if file selection was cancelled or returned null.
      if (opened === null) {
        // Open file dialog was cancelled: return early.
        return;
      } else {
        // File successfully selected and read: proceed with document reset.
      }

      // reset is used rather than applyText because opening a file is not an edit:
      // it replaces the document and must clear the undo history, since undoing back into
      // a different file's content would be nonsense.
      options.session.reset(opened.contents);
      currentPath = opened.path;
      encoding = opened.encoding;
      options.session.markSaved();
      options.onChange();

      // Check whether a path usage notification callback was provided.
      // This is how the recent-files list hears about a file without this module having to know the list exists.
      if (options.onPathUsed !== undefined) {
        // Report the opened file path to the recent files listener.
        options.onPathUsed(opened.path);
      } else {
        // Path listener not provided: do nothing.
      }
    } catch (caught: unknown) {
      // A failed save must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);
    }
  }

  /**
   * Persists the current document text to disk at its existing file path, or delegates to Save As if untitled.
   *
   * @purpose Saves document content to the current disk file path, delegating to Save As when no path exists.
   * @inputs void.
   * @outputs Promise<boolean> - true when the document was written.
   * @dataflow DocumentSession.snapshot.text -> FileService.saveFile -> DocumentSession.markSaved -> onChange callback.
   * @controlflow Check if currentPath is null (delegate to doSaveAs if true) -> invoke saveFile with path, text snapshot, and encoding -> mark session saved -> invoke onChange callback -> catch and route errors to onError.
   */
  async function doSave(): Promise<boolean> {
    try {
      // Check if the document currently has an assigned file path.
      if (currentPath === null) {
        // Saving an untitled document is a Save As by definition.
        return await doSaveAs();
      } else {
        // Existing path present: proceed with direct file save.
      }

      const written = options.session.snapshot.text;
      await options.fileService.saveFile({
        path: currentPath,
        contents: written,
        encoding,
      });

      // Only what reached disk is saved: text typed while the write was in flight keeps the document dirty.
      options.session.markSaved(written);
      options.onChange();
      // Check whether the shell asked to hear about completed saves (the Fidelity Check, FR-4.5).
      if (options.onSaved !== undefined) {
        // Report the exact text that was written.
        options.onSaved(written);
      } else {
        // Nobody listening: nothing to report.
      }

      return true;
    } catch (caught: unknown) {
      // A failed save must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);

      return false;
    }
  }

  /**
   * Prompts the user for a destination file path and saves the current document content to the chosen location.
   *
   * @purpose Displays a native save file dialog with a suggested filename, saving document content and updating file tracking.
   * @inputs void.
   * @outputs Promise<boolean> - true when the document was written.
   * @dataflow DocumentSession.snapshot.text -> FileService.chooseSavePath -> FileService.saveFile -> DocumentSession.markSaved -> onChange callback.
   * @controlflow Derive suggested filename from currentPath or default to 'Untitled.md' -> invoke chooseSavePath -> return early if cancelled -> save file to chosen path -> update currentPath -> mark session saved -> invoke onChange callback -> catch and route errors to onError.
   */
  async function doSaveAs(): Promise<boolean> {
    try {
      let suggested = 'Untitled.md';

      // Check if an existing file path exists to derive the suggested filename.
      if (currentPath !== null) {
        // Split on both '/' and '\\' so a Windows path works.
        const segments = currentPath.split(/[/\\]/).filter((segment: string): boolean => segment.length > 0);
        const lastSegment = segments[segments.length - 1];
        // Check if a valid filename segment was found.
        if (lastSegment !== undefined && lastSegment.length > 0) {
          // Use the last path segment as the suggested filename.
          suggested = lastSegment;
        } else {
          // Empty segment array: maintain 'Untitled.md' default.
        }
      } else {
        // Untitled document: maintain 'Untitled.md' default.
      }

      const chosen = await options.fileService.chooseSavePath(suggested);
      // Check if the user cancelled the save path picker dialog.
      if (chosen === null) {
        // Save As dialog cancelled: nothing was written, so report failure to the caller.
        return false;
      } else {
        // Target destination selected: proceed with file save.
      }

      const written = options.session.snapshot.text;
      await options.fileService.saveFile({
        path: chosen,
        contents: written,
        encoding,
        // A copy under a new name keeps the line endings of the file it came from, as it keeps the encoding.
        lineEnding: currentPath === null ? undefined : options.fileService.lineEndingOf?.(currentPath),
      });

      currentPath = chosen;

      // Only what reached disk is saved: text typed while the write was in flight keeps the document dirty.
      options.session.markSaved(written);
      options.onChange();
      // Check whether the shell asked to hear about completed saves (the Fidelity Check, FR-4.5).
      if (options.onSaved !== undefined) {
        // Report the exact text that was written.
        options.onSaved(written);
      } else {
        // Nobody listening: nothing to report.
      }

      // Check whether a recent-file tracking hook was provided by the shell.
      if (options.onPathUsed !== undefined) {
        // Report the new file path to the recent files listener.
        options.onPathUsed(chosen);
      } else {
        // No path tracking listener provided: do nothing.
      }

      return true;
    } catch (caught: unknown) {
      // A failed save must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);

      return false;
    }
  }

  /**
   * Saves a copy of the current document text to a new file chosen by the user, leaving the active document untouched.
   *
   * @purpose Prompts for a destination path and writes document contents without updating currentPath or clearing dirty state.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow DocumentSession.snapshot.text -> FileService.chooseSavePath -> FileService.saveFile.
   * @controlflow Compute suggested filename from currentPath or default to 'Untitled.md' -> invoke chooseSavePath -> return early if cancelled -> save file to chosen path without updating currentPath, marking saved, or notifying onPathUsed -> catch and route errors to onError.
   */
  async function doSaveACopy(): Promise<void> {
    try {
      let suggested = 'Untitled.md';

      // Check if an existing file path exists to derive the suggested filename.
      if (currentPath !== null) {
        // Split on both '/' and '\\' so a Windows path works.
        const segments = currentPath.split(/[/\\]/).filter((segment: string): boolean => segment.length > 0);
        const lastSegment = segments[segments.length - 1];
        // Check if a valid filename segment was found.
        if (lastSegment !== undefined && lastSegment.length > 0) {
          // Use the last path segment as the suggested filename.
          suggested = lastSegment;
        } else {
          // Empty segment array: maintain 'Untitled.md' default.
        }
      } else {
        // Untitled document: maintain 'Untitled.md' default.
      }

      const chosen = await options.fileService.chooseSavePath(suggested);
      // Check if the user cancelled the save path picker dialog.
      // A cancelled dialog is not an error.
      if (chosen === null) {
        // Save copy dialog cancelled: return early without saving.
        return;
      } else {
        // Destination chosen: proceed to write the copy.
      }

      await options.fileService.saveFile({
        path: chosen,
        contents: options.session.snapshot.text,
        encoding,
        // Like Save As: the copy keeps the original file's line endings.
        lineEnding: currentPath === null ? undefined : options.fileService.lineEndingOf?.(currentPath),
      });

      // A copy is a second file: the document the user is editing is still the original.
      // Do not touch currentPath, do not call markSaved, and do not call onPathUsed.
      // Marking it saved would tell them their unsaved changes were written to the file
      // they are looking at when they were written somewhere else.
    } catch (caught: unknown) {
      // A failed save must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);
    }
  }

  /**
   * Prompts for a new filename, renames the active file on disk via FileService, and updates path tracking.
   *
   * @purpose Validates clean document state, asks host for a new filename, renames the file on disk, and updates currentPath.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow options.promptName -> FileService.renameFile -> currentPath update -> onChange & onPathUsed callbacks.
   * @controlflow Guard untitled path -> guard promptName existence -> guard dirty session -> prompt for nextName -> return early if cancelled or empty -> compute nextPath -> invoke renameFile -> update currentPath -> call onChange -> notify onPathUsed -> catch and route errors to onError.
   */
  async function doRename(): Promise<void> {
    try {
      // Check whether the document has an assigned path on disk.
      if (currentPath === null) {
        // Untitled documents have nothing on disk to rename; must be saved first.
        options.onError('An untitled document has nothing to rename and should be saved first.');
        return;
      } else {
        // Document has a disk path: proceed with rename.
      }

      // Check whether the host provided a name prompting callback.
      if (options.promptName === undefined) {
        // Host did not give the menu a way to ask for a new name: return early.
        return;
      } else {
        // Host name prompt available: proceed.
      }

      // Check whether the session contains unsaved changes.
      // Renaming a file with unsaved changes would leave the edits pointing at a path that no longer exists.
      if (options.session.snapshot.dirty) {
        // Edits exist: prompt user to save before renaming.
        options.onError('The document must be saved before it is renamed.');
        return;
      } else {
        // Document is clean: proceed with rename.
      }

      const segments = currentPath.split(/[/\\]/).filter((segment: string): boolean => segment.length > 0);
      const lastSegment = segments[segments.length - 1];
      let currentBasename: string;
      // Check if a valid filename segment was resolved.
      if (lastSegment !== undefined && lastSegment.length > 0) {
        // Use the resolved segment as the current basename.
        currentBasename = lastSegment;
      } else {
        // Fallback to empty string if path had no segments.
        currentBasename = '';
      }

      const nextName = await options.promptName(currentBasename);
      // Check if the user cancelled the rename prompt or entered an empty name.
      if (nextName === null || nextName.trim().length === 0) {
        // User cancelled or provided empty filename: return early.
        return;
      } else {
        // Valid name provided: proceed with renaming.
      }

      // Find the last '/' or '\\' path delimiter. Both separators are checked because a
      // Windows path uses one and a path that came back from a dialog may use the other.
      const lastSlash = currentPath.lastIndexOf('/');
      const lastBackslash = currentPath.lastIndexOf('\\');
      const lastSepIndex = Math.max(lastSlash, lastBackslash);

      let dirPrefix: string;
      // Check whether a path separator was found in the current path.
      if (lastSepIndex >= 0) {
        // Keep everything up to and including the last separator.
        dirPrefix = currentPath.slice(0, lastSepIndex + 1);
      } else {
        // No path separator present: empty directory prefix.
        dirPrefix = '';
      }

      const nextPath = `${dirPrefix}${nextName.trim()}`;
      const previous = currentPath;
      const actual = await options.fileService.renameFile(currentPath, nextPath);

      currentPath = actual;
      options.onChange();
      // Tell the shell the file moved, so other windows that have it open can follow it.
      options.onRenamed?.(previous, actual);

      // Check whether a recent-file tracking hook was provided by the shell.
      if (options.onPathUsed !== undefined) {
        // Notify the shell of the renamed path.
        options.onPathUsed(actual);
      } else {
        // No path listener provided: do nothing.
      }
    } catch (caught: unknown) {
      // A failed rename must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);
    }
  }

  /**
   * Reveals the current document file in the operating system's native file manager.
   *
   * @purpose Opens the system file manager with the active document selected, guarding against untitled documents.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow currentPath -> FileService.revealInFileManager.
   * @controlflow Guard currentPath is null -> invoke revealInFileManager with currentPath -> catch and route errors to onError.
   */
  async function doReveal(): Promise<void> {
    try {
      // Check whether the document has a file path on disk.
      if (currentPath === null) {
        // Untitled document is not on disk yet; cannot be revealed.
        options.onError('An untitled document is not on disk yet.');
        return;
      } else {
        // File path exists: proceed to reveal in file manager.
      }

      await options.fileService.revealInFileManager(currentPath);
    } catch (caught: unknown) {
      // A failed reveal must tell the user, and an unhandled promise rejection in a desktop app is invisible.
      let message: string;
      // Check if the caught error is an instance of Error.
      if (caught instanceof Error) {
        // Use the Error instance message string.
        message = caught.message;
      } else {
        // Fallback to string coercion for non-Error thrown objects.
        message = String(caught);
      }
      options.onError(message);
    }
  }

  /**
   * Keyboard shortcut handler intercepting Ctrl+O, Ctrl+S, and Ctrl+Shift+S for file operations.
   *
   * @purpose Intercepts standard file shortcut combinations and routes them to corresponding file actions while preventing default browser behaviors.
   * @inputs event - KeyboardEvent captured from window.document keydown listener.
   * @outputs void.
   * @dataflow event key and modifier inspection -> preventDefault() -> invocation of doOpen, doSave, or doSaveAs.
   * @controlflow Check FileService availability -> verify Ctrl modifier -> evaluate normalized key and Shift modifier -> prevent default event -> trigger appropriate action.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Ignore keyboard shortcuts when file access is not available, or when the host's keymap owns them.
    if (!options.fileService.available || options.ownShortcuts === false) {
      // File service unavailable, or the host dispatches these keys: do nothing.
      return;
    } else {
      // File service available: inspect modifier keys.
    }

    // Check if the Ctrl modifier key is pressed.
    if (!event.ctrlKey) {
      // Modifier absent: allow standard keystroke handling.
      return;
    } else {
      // Ctrl modifier active: match supported key combinations.
    }

    const key = event.key.toLowerCase();

    // Check if Ctrl+O combination was pressed for Open.
    if (key === 'o' && !event.shiftKey) {
      // Preventing the default matters because the browser's own Open dialog would otherwise fire over the top.
      event.preventDefault();
      void doOpen();
    } else if (key === 's') {
      // Check if Shift modifier is present for Save As (Ctrl+Shift+S) versus Save (Ctrl+S).
      if (event.shiftKey) {
        // Preventing the default matters because the browser's own Save page dialog would otherwise fire over the top.
        event.preventDefault();
        void doSaveAs();
      } else {
        // Preventing the default matters because the browser's own Save page dialog would otherwise fire over the top.
        event.preventDefault();
        void doSave();
      }
    } else {
      // Other Ctrl combinations: allow standard handling.
    }
  }

  // Create toolbar action buttons using the provided window.document context.
  const doc = options.win.document;

  const openButton = doc.createElement('button');
  openButton.type = 'button';
  openButton.textContent = 'Open';
  openButton.className = 'kdoc-file-button';
  openButton.addEventListener('click', (): void => {
    void doOpen();
  });

  const saveButton = doc.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Save';
  saveButton.className = 'kdoc-file-button';
  saveButton.addEventListener('click', (): void => {
    void doSave();
  });

  const saveAsButton = doc.createElement('button');
  saveAsButton.type = 'button';
  saveAsButton.textContent = 'Save As';
  saveAsButton.className = 'kdoc-file-button';
  saveAsButton.addEventListener('click', (): void => {
    void doSaveAs();
  });

  // Check whether file access is available in the current runtime environment.
  // Disabling with an explanation is better than letting the click fail, because a button
  // that does nothing is a bug report and a button that says why is a design decision.
  if (!options.fileService.available) {
    // File access unavailable (e.g. running in browser): disable buttons and provide explanatory tooltip.
    const unavailableTitle = 'File access is only available in the K-Doc desktop app.';
    openButton.disabled = true;
    openButton.title = unavailableTitle;
    saveButton.disabled = true;
    saveButton.title = unavailableTitle;
    saveAsButton.disabled = true;
    saveAsButton.title = unavailableTitle;
  } else {
    // File access available: buttons remain active and clickable.
  }

  // Append buttons to the toolbar in Open, Save, Save As order.
  options.toolbar.appendChild(openButton);
  options.toolbar.appendChild(saveButton);
  options.toolbar.appendChild(saveAsButton);

  // Register global keydown shortcut listener on the window document.
  doc.addEventListener('keydown', onKeyDown);

  /**
   * Cleans up file menu resources, unregistering the keydown listener and removing buttons from the DOM.
   *
   * @purpose Tears down event listeners and DOM elements associated with the file menu.
   * @inputs void.
   * @outputs void.
   * @dataflow Removes onKeyDown from window.document and removes open, save, and saveAs button elements.
   * @controlflow Check destroyed flag -> remove event listener from window.document -> remove button elements -> mark destroyed = true.
   */
  function destroy(): void {
    // Check if the file menu has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active menu: proceed with teardown.
      destroyed = true;
    }

    doc.removeEventListener('keydown', onKeyDown);
    openButton.remove();
    saveButton.remove();
    saveAsButton.remove();
  }

  return {
    // These delegate to the very functions the toolbar buttons call, rather than reimplementing the
    // action, so the palette and the buttons can never drift apart. The promises are deliberately not
    // awaited: each handler already reports its own failures through onError, and a command palette
    // entry has nothing useful to do with a rejected promise.
    open(): void {
      void doOpen();
    },
    save(): Promise<boolean> {
      return doSave();
    },
    saveAs(): Promise<boolean> {
      return doSaveAs();
    },
    saveACopy(): void {
      void doSaveACopy();
    },
    rename(): void {
      void doRename();
    },
    /**
     * Follows the file to a new path after something else moved it on disk (the vault file tree, FR-6.11).
     *
     * @purpose Updates which document this menu item represents when an external move changed its path, without renaming anything on disk.
     * @inputs path - The note's new absolute path after the external move.
     * @outputs void - No return; persists the new path and notifies the host that state changed so the panel re-renders.
     * @dataflow path → currentPath assignment → options.onChange() → panel refresh.
     * @controlflow Store the new path then notify the host of the change.
     */
    followPath(path: string): void {
      // Moved by someone else: nothing is renamed here, only which file this document is.
      currentPath = path;
      options.onChange();
    },
    reveal(): void {
      void doReveal();
    },
    /**
     * @purpose Returns the last path segment of currentPath, or 'Untitled' if no path is set.
     * @inputs void.
     * @outputs string - The current file name or 'Untitled'.
     * @dataflow currentPath -> split on path separators -> last segment / 'Untitled'.
     * @controlflow Check if currentPath is null -> if null return 'Untitled' -> split on '/' and '\\' -> return last non-empty segment or fallback to 'Untitled'.
     */
    get fileName(): string {
      // Check if a file path is currently associated with the session.
      if (currentPath === null) {
        // Untitled document without an active file path.
        return 'Untitled';
      } else {
        // Active file path exists; split on both '/' and '\\' path delimiters.
        const segments = currentPath.split(/[/\\]/).filter((segment: string): boolean => segment.length > 0);
        const lastSegment = segments[segments.length - 1];
        // Check if a valid last segment was resolved.
        if (lastSegment !== undefined && lastSegment.length > 0) {
          // Return the filename segment.
          return lastSegment;
        } else {
          // Fall back to Untitled if path parsing yielded no segment.
          return 'Untitled';
        }
      }
    },

    /**
     * @purpose Returns the full filesystem path of the current document, or null if untitled.
     * @inputs void.
     * @outputs string | null - The current file path string or null.
     * @dataflow Returns currentPath directly.
     * @controlflow Return currentPath value.
     */
    get filePath(): string | null {
      return currentPath;
    },
    get encoding(): string {
      return encoding;
    },
    setEncoding(next: string): void {
      // Assigning here only records what the next save should write; the status bar reads the encoding
      // through onChange like every other piece of document state, so calling a setter on it directly
      // would be a second path to the same fact.
      encoding = next;
      options.onChange();
    },

    destroy,
  };
}
