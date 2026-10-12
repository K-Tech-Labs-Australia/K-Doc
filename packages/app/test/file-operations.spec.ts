// @vitest-environment jsdom

/**
 * @file file-operations.spec.ts
 * @purpose Vitest test suite verifying FR-6.1 file operations including Save a Copy, Rename, Reveal, the recent-files controller, prompt dialog, and recent-files dialog (@k-doc/app).
 * @inputs Synthetic DOM click, input, and keyboard events, DocumentSession state mutations, and fake FileService I/O operations.
 * @outputs Vitest assertions validating file menu actions, recent files controller persistence, prompt dialog resolution, and recent files dialog rendering.
 * @functions
 *   - flush: Flushes microtasks across multiple turns to allow fire-and-forget file menu actions to drain.
 *   - fakeService: Constructs a test double implementing FileService with tracking arrays for saved, renamed, and revealed operations.
 *   - mountMenu: Instantiates a DocumentSession, fake FileService, and FileMenu mounted on a dedicated toolbar container with callback recording.
 *   - findPromptDialog: Locates the active prompt modal dialog in the document body.
 *   - findPromptInput: Locates the text input field within a prompt dialog container.
 *   - findButton: Locates an action button by textContent or aria-label within a container, throwing a descriptive error if missing.
 *   - findRecentFilesDialog: Locates the active recent files modal dialog in the document body.
 * @dataflow Synthetic user events -> FileMenu / RecentFilesController / PromptDialog / RecentFilesDialog -> FileService / DocumentSession / Settings -> assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across suites -> destroy controllers and remove DOM mounts in afterEach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { DEFAULT_SETTINGS, type KdocSettings, type RecentFile } from '@k-doc/config';
import { installFileMenu, type FileMenu } from '../src/files/file-menu.js';
import type { FileService, OpenedFile, SaveTarget } from '../src/files/file-service.js';
import { createRecentFilesController } from '../src/shell/recent-files-controller.js';
import { installPromptDialog, type PromptDialog } from '../src/shell/prompt-dialog.js';
import { installRecentFilesDialog, type RecentFilesDialog } from '../src/shell/recent-files-dialog.js';

const menus: FileMenu[] = [];
const prompts: PromptDialog[] = [];
const dialogs: RecentFilesDialog[] = [];
const roots: HTMLElement[] = [];

afterEach((): void => {
  for (const menu of menus) {
    menu.destroy();
  }
  menus.length = 0;

  for (const prompt of prompts) {
    prompt.destroy();
  }
  prompts.length = 0;

  for (const dialog of dialogs) {
    dialog.destroy();
  }
  dialogs.length = 0;

  for (const root of roots) {
    // Check if the root element is currently attached to the DOM.
    if (root.parentNode !== null) {
      // Detach root element from its parent node.
      root.parentNode.removeChild(root);
    } else {
      // Root element is already detached from DOM.
    }
  }
  roots.length = 0;
});

/**
 * Flushes pending microtasks across multiple turns to allow fire-and-forget file menu actions to drain.
 * Two turns are needed because the file menu actions await more than once.
 *
 * @purpose Flushes pending microtasks to allow asynchronous file menu workflows to complete.
 * @inputs None.
 * @outputs Promise<void> - Resolves after multiple microtask turns have completed.
 * @dataflow Promise.resolve() chaining -> execution yield.
 * @controlflow Await Promise.resolve() across two distinct turns -> return.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface FakeService extends FileService {
  readonly saved: SaveTarget[];
  readonly renamed: Array<{ from: string; to: string }>;
  readonly revealed: string[];
}

/**
 * Constructs a test double implementing FileService with tracking arrays for saved, renamed, and revealed operations.
 *
 * @purpose Allocates a FakeService instance recording invocations and returning canned responses for file operations.
 * @inputs opts - Optional configuration specifying chosen save path override or simulated rename failure message.
 * @outputs FakeService - The fake service object implementing FileService with saved, renamed, and revealed recorder arrays.
 * @dataflow opts -> FakeService method closures -> recorder arrays and resolved promises.
 * @controlflow Initialize tracking arrays and canned OpenedFile -> return FakeService implementation with guarded methods.
 */
function fakeService(opts?: { chosenPath?: string | null; renameFails?: string }): FakeService {
  const saved: SaveTarget[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const revealed: string[] = [];

  const fixedOpenedFile: OpenedFile = {
    path: '/w/opened.md',
    contents: 'opened content\n',
    encoding: 'utf-8',
  };

  return {
    available: true,
    saved,
    renamed,
    revealed,
    async openFile(): Promise<OpenedFile | null> {
      return fixedOpenedFile;
    },
    async readPath(_path: string): Promise<string> {
      return 'read';
    },
    async readFile(_path: string): Promise<OpenedFile> {
      return fixedOpenedFile;
    },
    async saveFile(target: SaveTarget): Promise<void> {
      saved.push(target);
    },
    async chooseFolder(): Promise<string | null> {
      // These suites are about files, not vaults: a picker that chooses nothing is enough to satisfy
      // the interface without inventing a folder none of them looks at.
      return null;
    },
    async chooseSavePath(_suggestedName: string): Promise<string | null> {
      // Check if a chosen path option was explicitly provided.
      if (opts?.chosenPath !== undefined) {
        // Return configured chosen path (which may be null).
        return opts.chosenPath;
      } else {
        // Default to '/w/copy.md' when not specified.
        return '/w/copy.md';
      }
    },
    async renameFile(from: string, to: string): Promise<string> {
      renamed.push({ from, to });
      // Check whether rename is configured to fail with an error.
      if (opts?.renameFails !== undefined) {
        // Reject with the configured failure error message.
        throw new Error(opts.renameFails);
      } else {
        // Rename succeeded: return destination path.
        return to;
      }
    },
    async revealInFileManager(path: string): Promise<void> {
      revealed.push(path);
    },
  };
}

interface MenuHarness {
  readonly menu: FileMenu;
  readonly service: FakeService;
  readonly session: DocumentSession;
  readonly errors: string[];
  readonly recorded: string[];
  readonly prompted: string[];
}

/**
 * Instantiates a DocumentSession, fake FileService, and FileMenu mounted on a dedicated toolbar with recording mocks.
 *
 * @purpose Sets up an integrated test harness for verifying file menu actions such as Save a Copy, Rename, and Reveal.
 * @inputs opts - Optional configuration specifying custom service, prompt dialog response, or initial file path.
 * @outputs Promise<MenuHarness> - Promise resolving to the harness containing menu, service, session, and recorders.
 * @dataflow opts -> toolbar element + DocumentSession + fakeService -> installFileMenu -> optional initialPath saveAs -> MenuHarness.
 * @controlflow Create toolbar container -> construct session and fake service -> install file menu with tracking callbacks -> if initialPath specified, run saveAs and flush, then clear logs -> return MenuHarness.
 */
async function mountMenu(opts?: {
  service?: FakeService;
  promptAnswer?: string | null;
  initialPath?: string;
}): Promise<MenuHarness> {
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  roots.push(toolbar);

  const session = new DocumentSession('body\n');
  const service = opts?.service ?? fakeService();
  const errors: string[] = [];
  const recorded: string[] = [];
  const prompted: string[] = [];

  const menu = installFileMenu({
    toolbar,
    session,
    fileService: service,
    win: window,
    onChange: (): void => {
      // Change notification received.
    },
    onError: (message: string): void => {
      errors.push(message);
    },
    confirmUnsaved: async (_message: string): Promise<'discard'> => {
      return 'discard';
    },
    onPathUsed: (path: string): void => {
      recorded.push(path);
    },
    promptName: async (currentName: string): Promise<string | null> => {
      prompted.push(currentName);
      // Check whether a promptAnswer option was provided.
      if (opts?.promptAnswer !== undefined) {
        // Return configured prompt answer (may be string or null).
        return opts.promptAnswer;
      } else {
        // Default to null when no prompt answer is configured.
        return null;
      }
    },
  });
  menus.push(menu);

  // Check if an initial path was requested for the menu.
  if (opts?.initialPath !== undefined) {
    const targetInitialPath = opts.initialPath;
    const originalChoose = service.chooseSavePath.bind(service);
    service.chooseSavePath = async (_suggestedName: string): Promise<string | null> => targetInitialPath;
    menu.saveAs();
    await flush();
    service.chooseSavePath = originalChoose;
    service.saved.splice(0, service.saved.length);
    recorded.splice(0, recorded.length);
    errors.splice(0, errors.length);
  } else {
    // No initial path requested: menu starts with untitled document.
  }

  return {
    menu,
    service,
    session,
    errors,
    recorded,
    prompted,
  };
}

/**
 * Locates the active prompt modal dialog in the document body.
 *
 * @purpose Queries the HTMLDialogElement matching class .kdoc-prompt-dialog, failing fast with a descriptive error if missing.
 * @inputs doc - The Document instance to query (defaults to global document).
 * @outputs HTMLDialogElement - The matching prompt dialog DOM element.
 * @dataflow doc.body.querySelectorAll('dialog') -> filter by class .kdoc-prompt-dialog -> HTMLDialogElement.
 * @controlflow Query all dialog elements -> find element matching class -> check if found -> throw Error if missing -> return element.
 */
function findPromptDialog(doc: Document = document): HTMLDialogElement {
  const dialogs = Array.from(doc.body.querySelectorAll('dialog'));
  const promptDialog = dialogs.find((el): boolean => el.classList.contains('kdoc-prompt-dialog'));
  // Check if a dialog element with class kdoc-prompt-dialog was found.
  if (promptDialog === undefined) {
    // Prompt dialog element not found: throw descriptive error.
    throw new Error('No dialog with class "kdoc-prompt-dialog" found in document body');
  } else {
    // Matching dialog element found: return element.
    return promptDialog;
  }
}

/**
 * Locates the text input field within a prompt dialog container.
 *
 * @purpose Queries the HTMLInputElement matching class .kdoc-prompt-input, failing fast with a descriptive error if missing.
 * @inputs dialogEl: HTMLElement - The parent dialog element hosting the input field.
 * @outputs HTMLInputElement - The matching prompt input DOM element.
 * @dataflow dialogEl.querySelectorAll('input') -> filter by class .kdoc-prompt-input -> HTMLInputElement.
 * @controlflow Query all input elements -> find element matching class -> check if found -> throw Error if missing -> return element.
 */
function findPromptInput(dialogEl: HTMLElement): HTMLInputElement {
  const inputs = Array.from(dialogEl.querySelectorAll('input'));
  const promptInput = inputs.find((el): boolean => el.classList.contains('kdoc-prompt-input'));
  // Check if an input element with class kdoc-prompt-input was found.
  if (promptInput === undefined) {
    // Prompt input element not found: throw descriptive error.
    throw new Error('No input with class "kdoc-prompt-input" found in dialog');
  } else {
    // Matching input element found: return element.
    return promptInput;
  }
}

/**
 * Queries a button element inside a container matching the expected label text or aria-label.
 *
 * @purpose Locates an action button by textContent or aria-label within a container, throwing a descriptive error if missing.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the button.
 *   - label: string - The expected button textContent or aria-label to match.
 * @outputs HTMLButtonElement - The matching button DOM element.
 * @dataflow container.querySelectorAll('button') -> match textContent or aria-label -> HTMLButtonElement.
 * @controlflow Query all buttons -> find button matching label -> check if found -> throw Error if missing -> return button.
 */
function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((btn): boolean => {
    const textMatches = btn.textContent?.trim() === label;
    const ariaMatches = btn.getAttribute('aria-label') === label;
    return textMatches || ariaMatches;
  });

  // Check if a button matching label was found.
  if (match === undefined) {
    // Button not found: fail loudly with a descriptive error.
    throw new Error(`No button matching "${label}" found in container`);
  } else {
    // Button found: return element.
    return match;
  }
}

/**
 * Locates the active recent files modal dialog in the document body.
 *
 * @purpose Queries the HTMLDialogElement matching class .kdoc-recent-dialog, failing fast with a descriptive error if missing.
 * @inputs doc - The Document instance to query (defaults to global document).
 * @outputs HTMLDialogElement - The matching recent files dialog DOM element.
 * @dataflow doc.body.querySelectorAll('dialog') -> filter by class .kdoc-recent-dialog -> HTMLDialogElement.
 * @controlflow Query all dialog elements -> find element matching class -> check if found -> throw Error if missing -> return element.
 */
function findRecentFilesDialog(doc: Document = document): HTMLDialogElement {
  const dialogs = Array.from(doc.body.querySelectorAll('dialog'));
  const recentDialog = dialogs.find((el): boolean => el.classList.contains('kdoc-recent-dialog'));
  // Check if a dialog element with class kdoc-recent-dialog was found.
  if (recentDialog === undefined) {
    // Recent files dialog element not found: throw descriptive error.
    throw new Error('No dialog with class "kdoc-recent-dialog" found in document body');
  } else {
    // Matching dialog element found: return element.
    return recentDialog;
  }
}

describe('Save a Copy', (): void => {
  it('writes to the chosen path', async (): Promise<void> => {
    const harness = await mountMenu({ initialPath: '/w/original.md' });

    harness.menu.saveACopy();
    await flush();

    expect(harness.service.saved.length).toBe(1);
    const firstSaved = harness.service.saved[0];
    // Check if the first saved target entry is present.
    if (firstSaved !== undefined) {
      // Entry present: assert target path matches expected copy path.
      expect(firstSaved.path).toBe('/w/copy.md');
    } else {
      // Entry missing: throw descriptive error to satisfy noUncheckedIndexedAccess.
      throw new Error('Expected at least one saved file entry');
    }
  });

  it("does not change the document's own path", async (): Promise<void> => {
    const harness = await mountMenu({ initialPath: '/w/original.md' });

    harness.menu.saveACopy();
    await flush();

    // A copy is a second file and the document being edited is still the original.
    expect(harness.menu.filePath).toBe('/w/original.md');
  });

  it('leaves the document dirty', async (): Promise<void> => {
    const harness = await mountMenu({ initialPath: '/w/original.md' });
    harness.session.focusPane('source');
    harness.session.applyText('Unsaved edits\n');
    expect(harness.session.snapshot.dirty).toBe(true);

    harness.menu.saveACopy();
    await flush();

    // Marking it saved would tell the user their unsaved changes reached the file they are looking at when they reached a different one.
    expect(harness.session.snapshot.dirty).toBe(true);
  });

  it('does not record the copy as recent', async (): Promise<void> => {
    const harness = await mountMenu({ initialPath: '/w/original.md' });

    harness.menu.saveACopy();
    await flush();

    // The user is not editing the copy, so offering it in Open Recent would be offering a file they have never had open.
    expect(harness.recorded.length).toBe(0);
  });

  it('a cancelled picker writes nothing', async (): Promise<void> => {
    const service = fakeService({ chosenPath: null });
    const harness = await mountMenu({
      service,
      initialPath: '/w/original.md',
    });

    harness.menu.saveACopy();
    await flush();

    expect(harness.service.saved.length).toBe(0);
    expect(harness.errors.length).toBe(0);
  });
});

describe('Rename', (): void => {
  it('asks for a name and renames in the same folder', async (): Promise<void> => {
    const harness = await mountMenu({
      initialPath: '/w/a.md',
      promptAnswer: 'b.md',
    });

    harness.menu.rename();
    await flush();

    expect(harness.prompted).toEqual(['a.md']);
    expect(harness.service.renamed).toEqual([{ from: '/w/a.md', to: '/w/b.md' }]);
    expect(harness.menu.filePath).toBe('/w/b.md');
  });

  it('keeps a Windows folder prefix', async (): Promise<void> => {
    const harness = await mountMenu({
      initialPath: 'C:\\w\\a.md',
      promptAnswer: 'b.md',
    });

    harness.menu.rename();
    await flush();

    // Both separators are checked because a path from a dialog may use either.
    expect(harness.service.renamed).toEqual([{ from: 'C:\\w\\a.md', to: 'C:\\w\\b.md' }]);
    expect(harness.menu.filePath).toBe('C:\\w\\b.md');
  });

  it('a cancelled prompt renames nothing', async (): Promise<void> => {
    const harness = await mountMenu({
      initialPath: '/w/a.md',
      promptAnswer: null,
    });

    harness.menu.rename();
    await flush();

    expect(harness.service.renamed.length).toBe(0);
    expect(harness.menu.filePath).toBe('/w/a.md');
  });

  it('an untitled document is refused with a message', async (): Promise<void> => {
    const harness = await mountMenu();

    harness.menu.rename();
    await flush();

    expect(harness.service.renamed.length).toBe(0);
    expect(harness.errors.length).toBe(1);
    const firstError = harness.errors[0];
    // Check if error message is defined.
    if (firstError !== undefined) {
      expect(firstError.toLowerCase()).toContain('saved first');
    } else {
      throw new Error('Expected at least one error message');
    }
  });

  it('a dirty document is refused', async (): Promise<void> => {
    const harness = await mountMenu({
      initialPath: '/w/a.md',
      promptAnswer: 'b.md',
    });
    harness.session.focusPane('source');
    harness.session.applyText('Dirty changes\n');

    harness.menu.rename();
    await flush();

    // Renaming with unsaved changes would leave the edits pointing at a path that no longer exists.
    expect(harness.service.renamed.length).toBe(0);
    expect(harness.errors.length).toBe(1);
    const firstError = harness.errors[0];
    // Check if error message is defined.
    if (firstError !== undefined) {
      expect(firstError).toBe('The document must be saved before it is renamed.');
    } else {
      throw new Error('Expected at least one error message');
    }
  });

  it('a host refusal is reported and the path is unchanged', async (): Promise<void> => {
    const service = fakeService({
      renameFails: 'a file with that name is already there',
    });
    const harness = await mountMenu({
      service,
      initialPath: '/w/a.md',
      promptAnswer: 'b.md',
    });

    harness.menu.rename();
    await flush();

    expect(harness.errors).toContain('a file with that name is already there');
    expect(harness.menu.filePath).toBe('/w/a.md');
  });

  it('a successful rename is recorded as recent', async (): Promise<void> => {
    const harness = await mountMenu({
      initialPath: '/w/a.md',
      promptAnswer: 'b.md',
    });

    harness.menu.rename();
    await flush();

    expect(harness.recorded).toContain('/w/b.md');
  });
});

describe('Reveal', (): void => {
  it('asks the host to reveal the current path', async (): Promise<void> => {
    const harness = await mountMenu({ initialPath: '/w/doc.md' });

    harness.menu.reveal();
    await flush();

    expect(harness.service.revealed).toEqual(['/w/doc.md']);
    expect(harness.errors.length).toBe(0);
  });

  it('an untitled document is refused with a message', async (): Promise<void> => {
    const harness = await mountMenu();

    harness.menu.reveal();
    await flush();

    expect(harness.service.revealed.length).toBe(0);
    expect(harness.errors.length).toBe(1);
    const firstError = harness.errors[0];
    // Check if error message is defined.
    if (firstError !== undefined) {
      expect(firstError).toBe('An untitled document is not on disk yet.');
    } else {
      throw new Error('Expected at least one error message');
    }
  });
});

describe('the recent-files controller', (): void => {
  it('record writes the list into the settings', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let timeCounter = 1000;
    let writeCount = 0;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        writeCount += 1;
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => {
        timeCounter += 1;
        return timeCounter;
      },
    });

    controller.record('/w/first.md');

    expect(writeCount).toBe(1);
    expect(settings.general.recentFiles.length).toBe(1);
    const firstEntry = settings.general.recentFiles[0];
    // Check if the first recent file entry is present.
    if (firstEntry !== undefined) {
      expect(firstEntry.path).toBe('/w/first.md');
    } else {
      throw new Error('Expected at least one recent file entry in settings');
    }
  });

  it('recording the same path twice writes twice', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let timeCounter = 1000;
    let writeCount = 0;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        writeCount += 1;
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => {
        timeCounter += 1;
        return timeCounter;
      },
    });

    controller.record('/w/first.md');
    controller.record('/w/first.md');

    // Because the timestamp changed, and the timestamp is the ordering.
    expect(writeCount).toBe(2);
    expect(settings.general.recentFiles.length).toBe(1);
  });

  it('recording a path that changes nothing does not write', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let writeCount = 0;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        writeCount += 1;
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => 1000,
    });

    // An unchanged list written back would cost a disk write for nothing.
    controller.record('   ');
    expect(writeCount).toBe(0);
  });

  it('togglePin returns the list it wrote', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let timeCounter = 1000;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => {
        timeCounter += 1;
        return timeCounter;
      },
    });

    controller.record('/w/first.md');
    const returnedList = controller.togglePin('/w/first.md');

    // The dialog rebuilds from the return value, so the two must be the same list.
    const returnedEntry = returnedList[0];
    // Check if the returned entry is present.
    if (returnedEntry !== undefined) {
      expect(returnedEntry.pinned).toBe(true);
    } else {
      throw new Error('Expected at least one entry in returned list');
    }

    const settingsEntry = settings.general.recentFiles[0];
    // Check if the settings entry is present.
    if (settingsEntry !== undefined) {
      expect(settingsEntry.pinned).toBe(true);
    } else {
      throw new Error('Expected at least one entry in settings');
    }

    expect(returnedList).toEqual(settings.general.recentFiles);
  });

  it('forget returns the list it wrote', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let timeCounter = 1000;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => {
        timeCounter += 1;
        return timeCounter;
      },
    });

    controller.record('/w/first.md');
    controller.record('/w/second.md');

    const returnedList = controller.forget('/w/first.md');

    expect(returnedList.length).toBe(1);
    expect(returnedList).toEqual(settings.general.recentFiles);
    const remaining = returnedList[0];
    // Check if the remaining entry after forget is present.
    if (remaining !== undefined) {
      expect(remaining.path).toBe('/w/second.md');
    } else {
      throw new Error('Expected remaining entry');
    }
  });

  it('files orders a list that arrives out of order', (): void => {
    // Ordering on read is for a settings.json edited by hand: the list the controller writes is
    // already ordered, so only a list that arrives unordered can show whether it happens at all.
    const unordered: readonly RecentFile[] = [
      { path: '/w/newer-unpinned.md', pinned: false, openedAt: 9000 },
      { path: '/w/older-pinned.md', pinned: true, openedAt: 1000 },
    ];
    const settings: KdocSettings = {
      ...DEFAULT_SETTINGS,
      general: { ...DEFAULT_SETTINGS.general, recentFiles: unordered },
    };

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (): void => {},
      onError: (_msg: string): void => {},
      now: (): number => 1,
    });

    const files = controller.files;
    const first = files[0];
    // Check if the first ordered entry is present.
    if (first === undefined) {
      throw new Error('Expected the ordered list to have a first entry');
    } else {
      expect(first.path).toBe('/w/older-pinned.md');
    }
  });

  it('togglePin reports what the user did even when the write fails', (): void => {
    // The list being right for this session is better than the list being empty, so the answer the
    // dialog rebuilds from is the one just computed -- not one re-read from a store that refused it.
    const settings: KdocSettings = {
      ...DEFAULT_SETTINGS,
      general: {
        ...DEFAULT_SETTINGS.general,
        recentFiles: [{ path: '/w/a.md', pinned: false, openedAt: 1000 }],
      },
    };
    const errors: string[] = [];

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (): void => {
        throw new Error('settings are read-only');
      },
      onError: (message: string): void => {
        errors.push(message);
      },
      now: (): number => 1,
    });

    const returned = controller.togglePin('/w/a.md');
    const entryBack = returned[0];
    // Check if the returned entry is present.
    if (entryBack === undefined) {
      throw new Error('Expected the returned list to have an entry');
    } else {
      expect(entryBack.pinned).toBe(true);
    }
    expect(errors).toEqual(['settings are read-only']);
  });

  it('files comes back in menu order', (): void => {
    let settings: KdocSettings = DEFAULT_SETTINGS;
    let timeCounter = 1000;

    const controller = createRecentFilesController({
      readSettings: (): KdocSettings => settings,
      writeSettings: (next: KdocSettings): void => {
        settings = next;
      },
      onError: (_msg: string): void => {},
      now: (): number => {
        timeCounter += 1000;
        return timeCounter;
      },
    });

    controller.record('/w/older.md');
    controller.record('/w/newer.md');

    // Pin the older file; pinned files take precedence over newer unpinned files.
    controller.togglePin('/w/older.md');

    const files = controller.files;
    expect(files.length).toBe(2);
    const first = files[0];
    const second = files[1];
    // Check if both ordered files are present.
    if (first !== undefined && second !== undefined) {
      expect(first.path).toBe('/w/older.md');
      expect(first.pinned).toBe(true);
      expect(second.path).toBe('/w/newer.md');
      expect(second.pinned).toBe(false);
    } else {
      throw new Error('Expected two files in controller.files');
    }
  });
});

describe('the prompt dialog', (): void => {
  it('resolves the trimmed text on OK', async (): Promise<void> => {
    const prompt = installPromptDialog({ doc: document });
    prompts.push(prompt);
    const dialogEl = findPromptDialog(document);
    const inputEl = findPromptInput(dialogEl);

    const promise = prompt.ask('Rename', 'New name', 'a.md');
    inputEl.value = '  b.md  ';
    inputEl.dispatchEvent(new Event('input'));

    const okBtn = findButton(dialogEl, 'OK');
    okBtn.click();

    const result = await promise;
    expect(result).toBe('b.md');
  });

  it('OK is disabled while the input is blank', (): void => {
    const prompt = installPromptDialog({ doc: document });
    prompts.push(prompt);
    const dialogEl = findPromptDialog(document);
    const inputEl = findPromptInput(dialogEl);

    void prompt.ask('Rename', 'New name', 'a.md');
    const okBtn = findButton(dialogEl, 'OK');

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input'));
    expect(okBtn.disabled).toBe(true);

    inputEl.value = 'c.md';
    inputEl.dispatchEvent(new Event('input'));
    expect(okBtn.disabled).toBe(false);
  });

  it('Cancel resolves null', async (): Promise<void> => {
    const prompt = installPromptDialog({ doc: document });
    prompts.push(prompt);
    const dialogEl = findPromptDialog(document);

    const promise = prompt.ask('Rename', 'New name', 'a.md');
    const cancelBtn = findButton(dialogEl, 'Cancel');
    cancelBtn.click();

    const result = await promise;
    expect(result).toBeNull();
  });

  it('the initial value is pre-filled', (): void => {
    const prompt = installPromptDialog({ doc: document });
    prompts.push(prompt);
    const dialogEl = findPromptDialog(document);
    const inputEl = findPromptInput(dialogEl);

    void prompt.ask('Rename', 'New name', 'initial-name.md');
    expect(inputEl.value).toBe('initial-name.md');
  });
});

describe('the recent-files dialog', (): void => {
  it('lists every entry with its name and folder', (): void => {
    const dialog = installRecentFilesDialog({
      doc: document,
      onOpen: (): void => {},
      onTogglePin: (): readonly RecentFile[] => [],
      onForget: (): readonly RecentFile[] => [],
    });
    dialogs.push(dialog);
    const dialogEl = findRecentFilesDialog(document);

    const entries: readonly RecentFile[] = [
      { path: '/w/folder1/alpha.md', pinned: false, openedAt: 1000 },
      { path: '/w/folder2/beta.md', pinned: false, openedAt: 2000 },
    ];

    dialog.open(entries);

    const nameEls = Array.from(dialogEl.querySelectorAll('span')).filter(
      (el): boolean => el.classList.contains('kdoc-recent-name'),
    );
    const names = nameEls.map((el): string => el.textContent?.trim() ?? '');

    const folderEls = Array.from(dialogEl.querySelectorAll('span')).filter(
      (el): boolean => el.classList.contains('kdoc-recent-path'),
    );
    const folders = folderEls.map((el): string => el.textContent?.trim() ?? '');

    expect(names).toEqual(['alpha.md', 'beta.md']);
    expect(folders).toEqual(['/w/folder1', '/w/folder2']);
  });

  it('an empty list says so', (): void => {
    const dialog = installRecentFilesDialog({
      doc: document,
      onOpen: (): void => {},
      onTogglePin: (): readonly RecentFile[] => [],
      onForget: (): readonly RecentFile[] => [],
    });
    dialogs.push(dialog);
    const dialogEl = findRecentFilesDialog(document);

    dialog.open([]);

    const emptyEls = Array.from(dialogEl.querySelectorAll('li')).filter(
      (el): boolean => el.classList.contains('kdoc-recent-empty'),
    );
    const itemEls = Array.from(dialogEl.querySelectorAll('li')).filter(
      (el): boolean => el.classList.contains('kdoc-recent-item'),
    );

    expect(emptyEls.length).toBe(1);
    expect(itemEls.length).toBe(0);
    // An empty element is not a message: the point of the row is that it explains the emptiness.
    expect(emptyEls[0]?.textContent).toBe('No recent files.');
  });

  it('clicking an entry opens it and closes the dialog', (): void => {
    let openedPath: string | null = null;

    const dialog = installRecentFilesDialog({
      doc: document,
      onOpen: (path: string): void => {
        openedPath = path;
      },
      onTogglePin: (): readonly RecentFile[] => [],
      onForget: (): readonly RecentFile[] => [],
    });
    dialogs.push(dialog);
    const dialogEl = findRecentFilesDialog(document);

    dialog.open([
      { path: '/w/project/readme.md', pinned: false, openedAt: 1000 },
    ]);

    expect(dialogEl.open).toBe(true);

    const openBtns = Array.from(dialogEl.querySelectorAll('button')).filter(
      (btn): boolean => btn.classList.contains('kdoc-recent-open'),
    );
    const openBtn = openBtns[0];
    // Check if the open button was located in the dialog.
    if (openBtn !== undefined) {
      openBtn.click();
    } else {
      throw new Error('Expected button with class "kdoc-recent-open" in dialog');
    }

    expect(openedPath).toBe('/w/project/readme.md');
    expect(dialogEl.open).toBe(false);
  });

  it('clicking pin rebuilds from what the callback returns and stays open', (): void => {
    const initialFiles: readonly RecentFile[] = [
      { path: '/w/notes.md', pinned: false, openedAt: 1000 },
    ];
    const pinnedFiles: readonly RecentFile[] = [
      { path: '/w/notes.md', pinned: true, openedAt: 1000 },
    ];

    let toggledPath: string | null = null;
    const dialog = installRecentFilesDialog({
      doc: document,
      onOpen: (): void => {},
      onTogglePin: (path: string): readonly RecentFile[] => {
        toggledPath = path;
        return pinnedFiles;
      },
      onForget: (): readonly RecentFile[] => [],
    });
    dialogs.push(dialog);
    const dialogEl = findRecentFilesDialog(document);

    dialog.open(initialFiles);

    const pinBtns = Array.from(dialogEl.querySelectorAll('button')).filter(
      (btn): boolean => btn.classList.contains('kdoc-recent-pin'),
    );
    const pinBtn = pinBtns[0];
    // Check if the pin button was located in the dialog.
    if (pinBtn !== undefined) {
      pinBtn.click();
    } else {
      throw new Error('Expected button with class "kdoc-recent-pin" in dialog');
    }

    expect(toggledPath).toBe('/w/notes.md');

    // After the click, the dialog rebuilt from the callback's return value.
    const updatedPinBtns = Array.from(dialogEl.querySelectorAll('button')).filter(
      (btn): boolean => btn.classList.contains('kdoc-recent-pin'),
    );
    const updatedPinBtn = updatedPinBtns[0];
    // Check if the rebuilt pin button was located in the dialog.
    if (updatedPinBtn !== undefined) {
      expect(updatedPinBtn.getAttribute('aria-pressed')).toBe('true');
    } else {
      throw new Error('Expected button with class "kdoc-recent-pin" after rebuild');
    }

    // Pinning is a thing you do to the list, not a way of leaving it.
    expect(dialogEl.open).toBe(true);
  });

  it('clicking forget rebuilds and stays open', (): void => {
    const initialFiles: readonly RecentFile[] = [
      { path: '/w/first.md', pinned: false, openedAt: 1000 },
      { path: '/w/second.md', pinned: false, openedAt: 2000 },
    ];
    const afterForgetFiles: readonly RecentFile[] = [
      { path: '/w/second.md', pinned: false, openedAt: 2000 },
    ];

    let forgottenPath: string | null = null;
    const dialog = installRecentFilesDialog({
      doc: document,
      onOpen: (): void => {},
      onTogglePin: (): readonly RecentFile[] => [],
      onForget: (path: string): readonly RecentFile[] => {
        forgottenPath = path;
        return afterForgetFiles;
      },
    });
    dialogs.push(dialog);
    const dialogEl = findRecentFilesDialog(document);

    dialog.open(initialFiles);
    expect(dialogEl.querySelectorAll('.kdoc-recent-item').length).toBe(2);

    const forgetBtns = Array.from(dialogEl.querySelectorAll('button')).filter(
      (btn): boolean => btn.classList.contains('kdoc-recent-forget'),
    );
    const firstForgetBtn = forgetBtns[0];
    // Check if the forget button was located in the dialog.
    if (firstForgetBtn !== undefined) {
      firstForgetBtn.click();
    } else {
      throw new Error('Expected button with class "kdoc-recent-forget" in dialog');
    }

    expect(forgottenPath).toBe('/w/first.md');
    expect(dialogEl.querySelectorAll('.kdoc-recent-item').length).toBe(1);
    expect(dialogEl.open).toBe(true);
  });
});
