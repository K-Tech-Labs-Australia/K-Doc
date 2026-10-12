// @vitest-environment jsdom

/**
 * @file confirm-dialog.spec.ts
 * @purpose Vitest test suite for K-Doc's ConfirmDialog modal component and the three-way unsaved-changes file menu workflow (@k-doc/app).
 *   Validates modal dialog lifecycle, accessible button triggers (Save, Discard, Cancel), Escape cancel event handling,
 *   focus preservation order on close, sequential ask resolution, idempotent destruction, and FileMenu unsaved changes coordination.
 * @inputs Synthetic DOM click, cancel, and keyboard events, DocumentSession state mutations, and fake FileService I/O responses.
 * @outputs Vitest assertions verifying Promise resolution choices ('save' | 'discard' | 'cancel'), DOM open attributes, element presence, and session content updates.
 * @functions
 *   - mountElement: Allocates and attaches a DOM container element to document.body, tracking it for lifecycle cleanup.
 *   - findDialog: Queries the most recently mounted HTMLDialogElement with class .kdoc-confirm-dialog in the document.
 *   - button: Locates a button element within a container by aria-label or textContent, throwing a descriptive error if missing.
 *   - messageElement: Locates the message paragraph element within a confirm dialog container, throwing a descriptive error if missing.
 *   - drainMacrotasks: Flushes pending microtasks and macrotasks in the event loop before asserting on async operations.
 *   - mountMenu: Instantiates a DocumentSession, fake FileService, and FileMenu mounted on a dedicated toolbar with callback recording.
 * @dataflow Synthetic user events -> ConfirmDialog / FileMenu -> DocumentSession / FileService -> Promise resolution & DOM assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across ConfirmDialog and FileMenu flows -> destroy controllers and detach DOM mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import {
  installConfirmDialog,
  type ConfirmChoice,
  type ConfirmDialog,
} from '../src/shell/confirm-dialog.js';
import { installFileMenu, type FileMenu } from '../src/files/file-menu.js';
import type { FileService, OpenedFile, SaveTarget } from '../src/files/file-service.js';

let activeMounts: HTMLElement[] = [];
let activeDialogs: ConfirmDialog[] = [];
let activeMenus: FileMenu[] = [];

/**
 * Creates a container div element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *
 * @purpose Allocates and attaches a mount DOM container to document.body for component hosting.
 * @inputs void.
 * @outputs HTMLElement - The newly created and attached DOM container element.
 * @dataflow document.createElement -> document.body.appendChild -> tracked in activeMounts -> return element.
 * @controlflow Create div element -> append to document.body -> record in activeMounts array -> return element.
 */
function mountElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  activeMounts.push(element);
  return element;
}

/**
 * Queries the active confirm dialog element in the document body, throwing a descriptive error if missing.
 *
 * @purpose Locates the most recent dialog element with class .kdoc-confirm-dialog mounted in document.body.
 * @inputs doc - The Document instance to query (defaults to global document).
 * @outputs HTMLDialogElement - The matching dialog DOM element.
 * @dataflow doc.body.querySelectorAll('dialog.kdoc-confirm-dialog') -> select last element -> return HTMLDialogElement.
 * @controlflow Query all dialogs matching class -> check if list is empty -> if empty throw descriptive Error -> return last dialog element.
 */
function findDialog(doc: Document = document): HTMLDialogElement {
  const dialogs = doc.body.querySelectorAll<HTMLDialogElement>('dialog.kdoc-confirm-dialog');
  const last = dialogs[dialogs.length - 1];
  // Check if a matching confirm dialog element was found in the document.
  if (last === undefined) {
    // Dialog element not found: throw descriptive named error.
    throw new Error('No dialog with class "kdoc-confirm-dialog" found in document body');
  } else {
    // Dialog element found: return element.
  }
  return last;
}

/**
 * Queries a button element inside a container by its accessible aria-label or text content, throwing a descriptive error if missing.
 *
 * @purpose Locates a button by its accessible name or visible text, failing fast with a descriptive error when not found.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the button.
 *   - label: string - The exact aria-label or textContent string to locate.
 * @outputs HTMLButtonElement - The matching button DOM element.
 * @dataflow container.querySelector with aria-label selector / textContent filter -> validate found -> return HTMLButtonElement.
 * @controlflow Query button with aria-label selector -> if null search by textContent -> if still not found throw descriptive Error -> return button element.
 */
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const byAria = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // Check if a button matching the aria-label attribute was found.
  if (byAria !== null) {
    // Button matched by aria-label: return element.
    return byAria;
  } else {
    // Fall back to searching buttons by visible text content.
  }

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  const byText = buttons.find((btn: HTMLButtonElement): boolean => btn.textContent?.trim() === label);
  // Check if a button matching the text content was found.
  if (byText !== undefined) {
    // Button matched by text content: return element.
    return byText;
  } else {
    // Button not found: throw descriptive named error.
    throw new Error(`No button matching "${label}" found in container`);
  }
}

/**
 * Queries the message paragraph element inside a confirm dialog container, throwing a descriptive error if missing.
 *
 * @purpose Locates the message text element within a confirm dialog, failing fast with a descriptive error when not found.
 * @inputs container: HTMLElement - The parent dialog DOM container hosting the message paragraph.
 * @outputs HTMLElement - The matching message paragraph DOM element.
 * @dataflow container.querySelector with .kdoc-confirm-dialog-message selector -> validate found -> return HTMLElement.
 * @controlflow Query element with .kdoc-confirm-dialog-message -> check if null -> if null throw descriptive Error -> return element.
 */
function messageElement(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.kdoc-confirm-dialog-message');
  // Check if the message element was found in the dialog container.
  if (el === null) {
    // Message element not found: throw descriptive named error.
    throw new Error('No element with class "kdoc-confirm-dialog-message" found in dialog container');
  } else {
    // Message element found: return element.
  }
  return el;
}

/**
 * Yields execution to let the JavaScript microtask queue and macrotask timers drain.
 *
 * @purpose Flushes asynchronous event loops and resolved promises before making test assertions.
 * @inputs void.
 * @outputs Promise<void> - A promise that resolves after the next timer tick.
 * @dataflow setTimeout(0) -> Promise resolution.
 * @controlflow Construct Promise wrapping setTimeout with 0ms delay -> return Promise.
 */
function drainMacrotasks(): Promise<void> {
  return new Promise((resolve): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * Harness return structure exposing mounted controllers, DocumentSession, and recorded file operations.
 */
interface MountMenuHarness {
  readonly toolbar: HTMLElement;
  readonly session: DocumentSession;
  readonly menu: FileMenu;
  readonly fileService: FileService;
  readonly confirmCalls: string[];
  readonly openedFiles: OpenedFile[];
  readonly savedTargets: SaveTarget[];
  readonly callLog: string[];
  readonly errors: string[];
  readonly getChanges: () => number;
}

/**
 * Instantiates a DocumentSession, fake FileService, and FileMenu mounted on a dedicated toolbar with recording mocks.
 *
 * @purpose Sets up an integrated test harness for verifying the file menu unsaved changes flow across Save, Discard, and Cancel choices.
 * @inputs options - Configuration object specifying initial document text, confirm dialog choice, and save operation outcome.
 * @outputs MountMenuHarness - Object containing DOM container, controllers, session, and invocation recorders.
 * @dataflow options -> DocumentSession & fake FileService -> installFileMenu -> return harness record.
 * @controlflow Create toolbar container -> initialize DocumentSession -> construct fake FileService matching saveSucceeds flag -> call installFileMenu with recording callbacks -> register menu in activeMenus -> return harness object.
 */
function mountMenu(options: {
  readonly initialText: string;
  readonly choice: ConfirmChoice;
  readonly saveSucceeds: boolean;
}): MountMenuHarness {
  const toolbar = mountElement();
  const session = new DocumentSession(options.initialText);
  const confirmCalls: string[] = [];
  const openedFiles: OpenedFile[] = [];
  const savedTargets: SaveTarget[] = [];
  const callLog: string[] = [];
  const errors: string[] = [];
  let changeCount = 0;

  const cannedOpenedFile: OpenedFile = {
    path: '/mock/workspace/opened-doc.md',
    contents: '# Opened Document\n\nReplaced file contents.\n',
    encoding: 'utf-8',
  };

  const fakeFileService: FileService = {
    available: true,
    async openFile(): Promise<OpenedFile | null> {
      callLog.push('openFile');
      openedFiles.push(cannedOpenedFile);
      return cannedOpenedFile;
    },
    async readPath(path: string): Promise<string> {
      // This suite never exercises the external-change watcher, so the stub records the call and
      // returns the canned text rather than pretending to read anything.
      callLog.push(`readPath:${path}`);
      return cannedOpenedFile.contents;
    },
    async readFile(path: string): Promise<OpenedFile> {
      // Nothing in this suite opens a known path into a tab; record the call like readPath does.
      callLog.push(`readFile:${path}`);
      return cannedOpenedFile;
    },
    async saveFile(target: SaveTarget): Promise<void> {
      callLog.push('saveFile');
      savedTargets.push(target);
      // Check whether the save operation is configured to succeed or fail.
      if (options.saveSucceeds) {
        // Save succeeded.
        return;
      } else {
        // Save failed: reject with descriptive Error to trigger onError routing.
        throw new Error('Disk write failed: permission denied');
      }
    },
    async chooseFolder(): Promise<string | null> {
      // These suites are about files, not vaults: a picker that chooses nothing is enough to satisfy
      // the interface without inventing a folder none of them looks at.
      return null;
    },
    async chooseSavePath(suggestedName: string): Promise<string | null> {
      callLog.push('chooseSavePath');
      return `/mock/workspace/${suggestedName}`;
    },
    async renameFile(_from: string, to: string): Promise<string> {
      callLog.push('renameFile');
      return to;
    },
    async revealInFileManager(_path: string): Promise<void> {
      callLog.push('revealInFileManager');
    },
  };

  const menu = installFileMenu({
    toolbar,
    session,
    fileService: fakeFileService,
    win: window,
    onChange: (): void => {
      changeCount += 1;
    },
    onError: (message: string): void => {
      errors.push(message);
    },
    confirmUnsaved: async (message: string): Promise<ConfirmChoice> => {
      callLog.push('confirmUnsaved');
      confirmCalls.push(message);
      return options.choice;
    },
  });
  activeMenus.push(menu);

  return {
    toolbar,
    session,
    menu,
    fileService: fakeFileService,
    confirmCalls,
    openedFiles,
    savedTargets,
    callLog,
    errors,
    getChanges: (): number => changeCount,
  };
}

describe('ConfirmDialog', () => {
  beforeEach((): void => {
    activeMounts = [];
    activeDialogs = [];
    activeMenus = [];
  });

  afterEach((): void => {
    for (const dialog of activeDialogs) {
      dialog.destroy();
    }
    activeDialogs = [];

    for (const menu of activeMenus) {
      menu.destroy();
    }
    activeMenus = [];

    for (const mount of activeMounts) {
      // Check if mount element is currently attached to the DOM.
      if (mount.parentNode !== null) {
        mount.parentNode.removeChild(mount);
      } else {
        // Mount element already detached.
      }
    }
    activeMounts = [];
  });

  it('opens the dialog and displays the message text on ask', () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    // jsdom has no native HTMLDialogElement.prototype.showModal, so the source falls back to open = true.
    // That makes this fallback load-bearing in headless/test environments and non-modal execution contexts.
    void dialog.ask('Save changes before closing?');

    expect(dialogEl.open).toBe(true);
    expect(messageElement(dialogEl).textContent).toBe('Save changes before closing?');
  });

  it('resolves with "save" when clicking Save', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Save changes?');
    button(dialogEl, 'Save changes').click();

    const choice = await promise;
    expect(choice).toBe('save');
  });

  it('resolves with "discard" when clicking Discard', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Discard changes?');
    button(dialogEl, 'Discard changes').click();

    const choice = await promise;
    expect(choice).toBe('discard');
  });

  it('resolves with "cancel" when clicking Cancel', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Cancel changes?');
    button(dialogEl, 'Cancel').click();

    const choice = await promise;
    expect(choice).toBe('cancel');
  });

  it('resolves with "cancel" on the dialog cancel event', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Cancel event?');
    dialogEl.dispatchEvent(new Event('cancel', { cancelable: true }));

    const choice = await promise;
    expect(choice).toBe('cancel');
  });

  it('ensures the dialog is already closed when the promise resolves', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Close before resolve?');
    button(dialogEl, 'Save changes').click();

    let wasOpenAtResolution: boolean | null = null;
    const choice = await promise.then((result: ConfirmChoice): ConfirmChoice => {
      // A native <dialog> restores focus to whatever held it before opening when it closes.
      // Resolving first and closing after would silently undo any focus the caller sets in its resolution handler —
      // a defect this project already hit once with the link dialog.
      wasOpenAtResolution = dialogEl.open;
      return result;
    });

    expect(choice).toBe('save');
    expect(wasOpenAtResolution).toBe(false);
    expect(dialogEl.open).toBe(false);
  });

  it('resolves the first pending ask with "cancel" when a second ask is called', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    // A second ask while one is pending must resolve the first with 'cancel' rather than stranding it.
    // An unresolved promise here is an await in the file menu that never returns, so Open silently stops working forever.
    const firstPromise = dialog.ask('First question?');
    const secondPromise = dialog.ask('Second question?');

    button(dialogEl, 'Save changes').click();

    const [firstChoice, secondChoice] = await Promise.all([firstPromise, secondPromise]);
    expect(firstChoice).toBe('cancel');
    expect(secondChoice).toBe('save');
  });

  it('resolves pending promises with "cancel" and removes the dialog element on destroy()', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    const promise = dialog.ask('Destroy while pending?');
    dialog.destroy();

    const choice = await promise;
    expect(choice).toBe('cancel');
    expect(dialogEl.parentNode).toBeNull();
    expect(document.body.contains(dialogEl)).toBe(false);
  });

  it('handles multiple destroy() calls idempotently and resolves ask after destroy with "cancel"', async () => {
    const dialog = installConfirmDialog({ doc: document });
    activeDialogs.push(dialog);
    const dialogEl = findDialog(document);

    expect((): void => {
      dialog.destroy();
      dialog.destroy();
    }).not.toThrow();

    const promise = dialog.ask('Ask after destroy');
    const choice = await promise;

    expect(choice).toBe('cancel');
    expect(dialogEl.open).toBe(false);
    expect(document.body.contains(dialogEl)).toBe(false);
  });
});

describe('the file menu unsaved-changes flow', () => {
  beforeEach((): void => {
    activeMounts = [];
    activeDialogs = [];
    activeMenus = [];
  });

  afterEach((): void => {
    for (const dialog of activeDialogs) {
      dialog.destroy();
    }
    activeDialogs = [];

    for (const menu of activeMenus) {
      menu.destroy();
    }
    activeMenus = [];

    for (const mount of activeMounts) {
      // Check if mount element is currently attached to the DOM.
      if (mount.parentNode !== null) {
        mount.parentNode.removeChild(mount);
      } else {
        // Mount element already detached.
      }
    }
    activeMounts = [];
  });

  it('proceeds directly to the file picker without confirming when the session is clean', async () => {
    const harness = mountMenu({
      initialText: 'Clean document text\n',
      choice: 'cancel',
      saveSucceeds: true,
    });

    button(harness.toolbar, 'Open').click();
    // The click handler is async, so the test awaits a macrotask to allow the microtask queue to drain first.
    await drainMacrotasks();

    expect(harness.confirmCalls.length).toBe(0);
    expect(harness.openedFiles.length).toBe(1);
    expect(harness.session.snapshot.text).toBe('# Opened Document\n\nReplaced file contents.\n');
  });

  it('never invokes the file picker and preserves session text when cancelled on a dirty session', async () => {
    const harness = mountMenu({
      initialText: 'Initial clean text\n',
      choice: 'cancel',
      saveSucceeds: true,
    });

    harness.session.focusPane('source');
    harness.session.applyText('Unsaved dirty modifications\n');

    button(harness.toolbar, 'Open').click();
    // The click handler is async, so the test awaits a macrotask to allow the microtask queue to drain first.
    await drainMacrotasks();

    expect(harness.confirmCalls.length).toBe(1);
    expect(harness.openedFiles.length).toBe(0);
    expect(harness.session.snapshot.text).toBe('Unsaved dirty modifications\n');
  });

  it('invokes the file picker and replaces document text when discarded on a dirty session', async () => {
    const harness = mountMenu({
      initialText: 'Initial clean text\n',
      choice: 'discard',
      saveSucceeds: true,
    });

    harness.session.focusPane('source');
    harness.session.applyText('Unsaved dirty modifications\n');

    button(harness.toolbar, 'Open').click();
    // The click handler is async, so the test awaits a macrotask to allow the microtask queue to drain first.
    await drainMacrotasks();

    expect(harness.confirmCalls.length).toBe(1);
    expect(harness.openedFiles.length).toBe(1);
    expect(harness.session.snapshot.text).toBe('# Opened Document\n\nReplaced file contents.\n');
  });

  it('runs save and then runs the file picker in order when save succeeds on a dirty session', async () => {
    const harness = mountMenu({
      initialText: 'Initial clean text\n',
      choice: 'save',
      saveSucceeds: true,
    });

    harness.session.focusPane('source');
    harness.session.applyText('Unsaved dirty modifications\n');

    button(harness.toolbar, 'Open').click();
    // The click handler is async, so the test awaits a macrotask to allow the microtask queue to drain first.
    await drainMacrotasks();

    expect(harness.confirmCalls.length).toBe(1);
    expect(harness.savedTargets.length).toBe(1);
    expect(harness.openedFiles.length).toBe(1);

    const saveIndex = harness.callLog.indexOf('saveFile');
    const openIndex = harness.callLog.indexOf('openFile');
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(openIndex).toBeGreaterThan(saveIndex);
    expect(harness.session.snapshot.text).toBe('# Opened Document\n\nReplaced file contents.\n');
  });

  it('does not invoke the file picker and leaves the document untouched when save fails on a dirty session', async () => {
    const harness = mountMenu({
      initialText: 'Initial clean text\n',
      choice: 'save',
      saveSucceeds: false,
    });

    harness.session.focusPane('source');
    harness.session.applyText('Unsaved dirty modifications\n');

    button(harness.toolbar, 'Open').click();
    // The click handler is async, so the test awaits a macrotask to allow the microtask queue to drain first.
    await drainMacrotasks();

    // Opening on top of a failed save is exactly the data loss the dialog exists to prevent.
    // The flow checks the session's dirty flag afterwards rather than trusting a return value because doSave routes its failures to onError.
    expect(harness.confirmCalls.length).toBe(1);
    expect(harness.errors.length).toBe(1);
    expect(harness.openedFiles.length).toBe(0);
    expect(harness.callLog).not.toContain('openFile');
    expect(harness.session.snapshot.text).toBe('Unsaved dirty modifications\n');
  });
});
