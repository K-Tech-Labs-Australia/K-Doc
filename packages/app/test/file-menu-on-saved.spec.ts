// @vitest-environment jsdom

/**
 * @file file-menu-on-saved.spec.ts
 * @purpose Verifies that installFileMenu's optional onSaved callback fires with the exact text written after a successful Save and Save As (including an untitled Save, which is a Save As), never for Save a Copy, and never when the write fails; it also confirms a menu installed without the listener does not throw.
 * @inputs Vitest jsdom environment; installFileMenu options including an optional onSaved; a stubbed FileService that records saves and can be told to fail; a DocumentSession whose text is edited during each scenario.
 * @outputs Boolean pass/fail per assertion across six scenarios: Save reports written text, Save As reports it, untitled Save reports it, Save a Copy does not report, a failed save does not report, and an absent listener does not throw.
 * @functions
 *   - flush: Resolves the microtask queue by awaiting Promise.resolve() four times so async install/save work settles before assertions read their results.
 *   - setup: Builds a jsdom toolbar, a stubbed FileService recording saves (optionally throwing), and a DocumentSession, installs the file menu with an onSaved that records reported text, and returns handles plus the recorded arrays.
 * @dataflow setup() constructs DOM + services → installFileMenu mounts into toolbar → test edits session text → menu.save()/saveAs()/saveACopy() routes through stubbed saveFile → recorded saved[] and reported[] asserted by the it blocks; onSaved fires only on successful Save/Save As.
 * @controlflow describe runs once → each it calls setup() for isolated state → assertions read mount behavior, then where applicable trigger a save and await flush → afterEach destroys every menu, removes every root, clears both module arrays.
 * @version 1
 * @date 2026-09-14
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { installFileMenu, type FileMenu } from '../src/files/file-menu.js';
import type { FileService, OpenedFile, SaveTarget } from '../src/files/file-service.js';

// Module-level registries so afterEach can tear down every menu and root created across tests.
const menus: FileMenu[] = [];
const roots: HTMLElement[] = [];

/**
 * Destroys every installed menu, removes every appended root element, and clears both registries.
 * @purpose Prevents DOM/menu leakage between tests by tearing down all state accumulated during a test run.
 * @inputs None; operates on the module-level `menus` and `roots` arrays.
 * @outputs void.
 * @dataflow menus/roots → forEach teardown → array length reset to zero.
 * @controlflow Iterate menus calling destroy(); iterate roots removing each from its parent; then empty both arrays unconditionally.
 */
afterEach(() => {
  // Destroy every installed file menu so it releases listeners and DOM references.
  for (const menu of menus) {
    menu.destroy();
  }
  // Remove every toolbar root that was appended to the jsdom document body.
  for (const root of roots) {
    root.remove();
  }
  // Clear both registries so state cannot leak into a subsequent test.
  menus.length = 0;
  roots.length = 0;
});

/**
 * Awaits the microtask queue enough times for installFileMenu's async mount and save to settle.
 * @purpose Gives pending Promise chains (saveFile) time to resolve before assertions read their results.
 * @inputs None.
 * @outputs void resolved once four microtask ticks have elapsed.
 * @dataflow None; purely a timing primitive that yields control back to the event loop repeatedly.
 * @controlflow Sequentially await Promise.resolve() four times, each yielding one microtask checkpoint.
 */
async function flush(): Promise<void> {
  // Yield four consecutive microtask ticks so chained async work completes before assertions run.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Constructs an isolated jsdom environment and installs a file menu bound to an onSaved listener that records written text.
 * @purpose Provides a shared harness that wires installFileMenu to a stubbed FileService so each test can assert onSaved reporting behavior deterministically across Save, Save As, Save a Copy, and failure scenarios.
 * @inputs options.path - The initialPath forwarded to installFileMenu; null models an untitled document. options.failSave - When true, the stubbed saveFile throws after recording to simulate a write failure.
 * @outputs An object exposing the installed menu, its DocumentSession, the recording array `saved` (SaveTarget), and the recorded text array `reported`.
 * @dataflow Builds toolbar div → appends to body → records in roots → constructs session + stubbed service → installFileMenu mounts with onSaved pushing reported text → recorded menus pushed to menus.
 * @controlflow Create DOM element → register it → build recording arrays → assemble FileService literal with side-effecting stubs → call installFileMenu with initialPath from options and an onSaved listener → store the returned menu.
 */
function setup(options: { path: string | null; failSave?: boolean }): {
  menu: FileMenu;
  session: DocumentSession;
  saved: SaveTarget[];
  reported: string[];
} {
  // Create a toolbar container and append it to the jsdom body so the menu has somewhere to render.
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  // Register the root so afterEach can remove it during teardown.
  roots.push(toolbar);

  // Recording arrays capture what the stubbed FileService does and what onSaved reports during a test.
  const saved: SaveTarget[] = [];
  const reported: string[] = [];

  // A document session seeded with initial text that tests will edit before saving.
  const session = new DocumentSession('# Title\n');

  // Assemble the stubbed FileService; saveFile records the target so tests can assert on it, then optionally throws to simulate a write failure.
  const fileService: FileService = {
    available: true,
    async openFile(): Promise<OpenedFile | null> {
      return null;
    },
    async readPath(_path: string): Promise<string> {
      return '';
    },
    async readFile(path: string): Promise<OpenedFile> {
      return { path, contents: '', encoding: 'utf-8' };
    },
    async saveFile(target: SaveTarget): Promise<void> {
      // Record the written target so tests can assert on its path, contents, and encoding.
      saved.push(target);
      // Opt-in failure simulation: throw after recording so the menu's catch routes to onError and never reports onSaved.
      if (options.failSave === true) {
        throw new Error('disk full');
      } else {
        // Write succeeded; nothing further to do, target already recorded above.
      }
    },
    async chooseSavePath(_suggestedName: string): Promise<string | null> {
      return '/w/chosen.md';
    },
    async chooseFolder(): Promise<string | null> {
      return null;
    },
    async renameFile(_from: string, to: string): Promise<string> {
      return to;
    },
    async revealInFileManager(_path: string): Promise<void> {
      // Reveal is a no-op side effect in tests; nothing to record.
    },
  };

  // Install the menu with initialPath taken from options, onError as a no-op, and onSaved recording reported text.
  const menu = installFileMenu({
    toolbar,
    session,
    fileService,
    win: window,
    onChange: () => {
      // No-op change handler; tests drive state directly.
    },
    onError: (_message: string) => {
      // No-op error handler; failures are observed through the recorded arrays instead of a listener.
    },
    confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
      return 'discard';
    },
    initialPath: options.path,
    onSaved: (text: string): void => {
      // Record the exact text written so tests can assert what a successful save reported.
      reported.push(text);
    },
  });

  // Register the installed menu so afterEach can destroy it during teardown.
  menus.push(menu);

  return { menu, session, saved, reported };
}

describe('installFileMenu onSaved', () => {
  // A Save of a document with a known path must report the exact edited text that was written to disk.
  it('reports the text written by Save', async () => {
    const { session, menu, saved, reported } = setup({ path: '/w/notes.md' });
    session.focusPane('source');
    session.applyText('# Title edited\n');
    menu.save();
    await flush();

    expect(reported).toEqual(['# Title edited\n']);
    // Optional chaining guards against an empty saved array if the save never reached the stub.
    expect(saved[0]?.contents).toBe('# Title edited\n');
  });

  // A Save As of a document with no path must report the current text and write to the chosen destination.
  it('reports the text written by Save As', async () => {
    const { menu, saved, reported } = setup({ path: null });
    menu.saveAs();
    await flush();

    expect(reported).toEqual(['# Title\n']);
    // The stubbed picker always resolves to this fixed destination.
    expect(saved[0]?.path).toBe('/w/chosen.md');
  });

  // An untitled Save has no path to write to, so it is a Save As by definition and must report the text.
  it('reports an untitled Save, which is a Save As', async () => {
    const { menu, reported } = setup({ path: null });
    menu.save();
    await flush();

    expect(reported).toEqual(['# Title\n']);
  });

  // Save a Copy writes another file without changing the active document, so it must never report onSaved.
  it('does not report Save a Copy', async () => {
    const { menu, saved, reported } = setup({ path: '/w/notes.md' });
    menu.saveACopy();
    await flush();

    // The copy still reached the stubbed FileService exactly once.
    expect(saved).toHaveLength(1);
    expect(reported).toEqual([]);
  });

  // A save that fails on disk must not report anything, since nothing was actually written.
  it('does not report a failed save', async () => {
    const { menu, reported } = setup({ path: '/w/notes.md', failSave: true });
    menu.save();
    await flush();

    // The session started clean and the write threw before onSaved could fire.
    expect(reported).toEqual([]);
  });

  // A menu installed without an onSaved listener must still save successfully without throwing.
  it('works without a listener', async () => {
    // Build an isolated toolbar and stubbed service for a menu installed without onSaved.
    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);
    roots.push(toolbar);

    const saved: SaveTarget[] = [];
    const session = new DocumentSession('# Title\n');

    const fileService: FileService = {
      available: true,
      async openFile(): Promise<OpenedFile | null> {
        return null;
      },
      async readPath(_path: string): Promise<string> {
        return '';
      },
      async readFile(path: string): Promise<OpenedFile> {
        return { path, contents: '', encoding: 'utf-8' };
      },
      async saveFile(target: SaveTarget): Promise<void> {
        saved.push(target);
      },
      async chooseSavePath(_suggestedName: string): Promise<string | null> {
        return '/w/chosen.md';
      },
      async chooseFolder(): Promise<string | null> {
        return null;
      },
      async renameFile(_from: string, to: string): Promise<string> {
        return to;
      },
      async revealInFileManager(_path: string): Promise<void> {
        // Reveal is a no-op side effect in tests; nothing to record.
      },
    };

    const menu = installFileMenu({
      toolbar,
      session,
      fileService,
      win: window,
      onChange: () => {
        // No-op change handler; tests drive state directly.
      },
      onError: (_message: string) => {
        // No-op error handler; failures are observed through the recorded arrays instead.
      },
      confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
        return 'discard';
      },
      initialPath: '/w/notes.md',
      // onSaved omitted entirely to prove an absent listener does not throw during save.
    });
    menus.push(menu);

    menu.save();
    await flush();

    expect(saved).toHaveLength(1);
  });

// A menu that does not own its shortcuts must leave Ctrl+S untouched so the host application can handle it (e.g. native Save).
  it('leaves Ctrl+S to the host when it does not own its shortcuts', async () => {
    // Install a first menu that opts out of shortcut ownership via ownShortcuts: false, reusing the same fake FileService and session shape as every other test in this file.
    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);
    // Register the root so afterEach can remove it during teardown.
    roots.push(toolbar);

    // Recording array captures whether any save reached the stubbed FileService while testing the passthrough menu.
    const saved: SaveTarget[] = [];
    const session = new DocumentSession('# Title\n');

    // Assemble the same stubbed FileService used by every other test; saveFile records the target so tests can assert on it.
    const fileService: FileService = {
      available: true,
      async openFile(): Promise<OpenedFile | null> {
        return null;
      },
      async readPath(_path: string): Promise<string> {
        return '';
      },
      async readFile(path: string): Promise<OpenedFile> {
        return { path, contents: '', encoding: 'utf-8' };
      },
      async saveFile(target: SaveTarget): Promise<void> {
        // Record the written target so tests can assert no save happened when shortcuts are not owned.
        saved.push(target);
      },
      async chooseSavePath(_suggestedName: string): Promise<string | null> {
        return '/w/chosen.md';
      },
      async chooseFolder(): Promise<string | null> {
        return null;
      },
      async renameFile(_from: string, to: string): Promise<string> {
        return to;
      },
      async revealInFileManager(_path: string): Promise<void> {
        // Reveal is a no-op side effect in tests; nothing to record.
      },
    };

    const menu = installFileMenu({
      toolbar,
      session,
      fileService,
      win: window,
      onChange: () => {
        // No-op change handler; tests drive state directly.
      },
      onError: (_message: string) => {
        // No-op error handler; failures are observed through the recorded arrays instead.
      },
      confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
        return 'discard';
      },
      initialPath: '/w/notes.md',
      // ownShortcuts: false tells the menu it does not own Ctrl+S, so it must leave the shortcut to the host.
      ownShortcuts: false,
    });
    menus.push(menu);

    // Dispatch Ctrl+S on document; the event starts with defaultPrevented = false and is cancelable so preventDefault is observable.
    const passthroughEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(passthroughEvent);
    // Let any pending async work settle before asserting on the recorded state.
    await flush();

    // The menu did not own the shortcut, so it must neither default-prevent nor trigger a save.
    expect(passthroughEvent.defaultPrevented).toBe(false);
    expect(saved).toHaveLength(0);

    // Control: install a second menu that owns its shortcuts (no option) and confirm Ctrl+S is captured instead of passed through.
    const toolbar2 = document.createElement('div');
    document.body.appendChild(toolbar2);
    // Register the root so afterEach can remove it during teardown.
    roots.push(toolbar2);

    const session2 = new DocumentSession('# Title\n');

    // Assemble an identical stubbed FileService for the control menu; its save recording is not asserted by this control.
    const savedControl: SaveTarget[] = [];
    const fileService2: FileService = {
      available: true,
      async openFile(): Promise<OpenedFile | null> {
        return null;
      },
      async readPath(_path: string): Promise<string> {
        return '';
      },
      async readFile(path: string): Promise<OpenedFile> {
        return { path, contents: '', encoding: 'utf-8' };
      },
      async saveFile(target: SaveTarget): Promise<void> {
        // Record for parity with the other fakes; the control asserts on defaultPrevented rather than a save.
        savedControl.push(target);
      },
      async chooseSavePath(_suggestedName: string): Promise<string | null> {
        return '/w/chosen.md';
      },
      async chooseFolder(): Promise<string | null> {
        return null;
      },
      async renameFile(_from: string, to: string): Promise<string> {
        return to;
      },
      async revealInFileManager(_path: string): Promise<void> {
        // Reveal is a no-op side effect in tests; nothing to record.
      },
    };

    const menu2 = installFileMenu({
      toolbar: toolbar2,
      session: session2,
      fileService: fileService2,
      win: window,
      onChange: () => {
        // No-op change handler; tests drive state directly.
      },
      onError: (_message: string) => {
        // No-op error handler; failures are observed through the recorded arrays instead.
      },
      confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
        return 'discard';
      },
      initialPath: '/w/notes.md',
      // No ownShortcuts option means this menu owns its shortcuts and must capture Ctrl+S.
    });
    menus.push(menu2);

    // Dispatch the same Ctrl+S; this owning menu should default-prevent it so the host never sees it.
    const ownedEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ownedEvent);
    await flush();

    // The owning menu captured the shortcut; the event was default-prevented by contrast with the passthrough case.
    expect(ownedEvent.defaultPrevented).toBe(true);
  });
});
