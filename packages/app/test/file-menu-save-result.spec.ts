// @vitest-environment jsdom

/**
 * @file file-menu-save-result.spec.ts
 * @purpose Verifies that installFileMenu's save() and saveAs() return a Promise<boolean> reflecting whether the write succeeded, and that doSave/doSaveAs call session.markSaved(written) so snapshot.savedText records exactly what was written while any edit made during the pending write keeps dirty true. It covers: Save of a pathed doc resolving true with a clean session; text typed mid-write staying unsaved (dirty true, savedText is the pre-edit value); a failing write resolving false and routing to onError with the session still dirty; a cancelled Save As resolving false without writing; and an untitled Save delegating to Save As through chooseSavePath.
 * @inputs Vitest jsdom environment; installFileMenu options including initialPath, FileService stubs whose saveFile/chooseSavePath can be told what (and when) to resolve, a DocumentSession seeded with '# Title\n', toolbar, win, onChange/onError listeners recording results.
 * @outputs Boolean pass/fail per assertion across five scenarios asserting the resolved boolean, saved[] contents, onError messages, and session.snapshot.dirty/savedText after each write path settles.
 * @functions
 *   - flush: Resolves the microtask queue by awaiting Promise.resolve() four times so async install/save work settles before assertions read their results.
 *   - setup: Builds a jsdom toolbar, a stubbed FileService whose chooseSavePath resolves an option-provided result and whose saveFile records targets (and rejects when failSave is set), and a DocumentSession seeded with '# Title\n', installs the file menu recording onError messages, and returns handles plus recorded arrays.
 * @dataflow setup() constructs DOM + services → installFileMenu mounts into toolbar → test edits session text or drives chooseSavePath/saveFile via options → menu.save()/saveAs() routes through stubbed saveFile → saved[]/errors[] asserted by the it blocks; resolved boolean and snapshot state read after flush.
 * @controlflow describe runs once → each it calls setup() for isolated state → assertions read mount behavior, then where applicable trigger a save/saveAs and await flush or manually resolve writes → afterEach destroys every menu, removes every root, clears both module arrays.
 * @version 1
 * @date 2026-10-07
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
 * Constructs an isolated jsdom environment and installs a file menu bound to onError/onChange listeners that record outcomes, with FileService stubs whose chooseSavePath result is option-driven.
 * @purpose Provides a shared harness that wires installFileMenu to a stubbed FileService so each test can assert on the boolean returned by save()/saveAs(), what reached the saved[] recorder, and any onError message deterministically across Save, failing Save, cancelled Save As, and untitled-Save-delegates-to-Save-As scenarios.
 * @inputs options.path - The initialPath forwarded to installFileMenu; null models an untitled document. options.chooseSavePathResult - What chooseSavePath resolves to (a path string on accept, or null on cancel); defaults to '/w/chosen.md'. options.failSave - When true, the stubbed saveFile rejects with 'disk full' after recording to simulate a write failure.
 * @outputs An object exposing the installed menu, its DocumentSession, the recording array `saved` (SaveTarget), and the recorded error-messages array `errors`.
 * @dataflow Builds toolbar div → appends to body → records in roots → constructs session + stubbed service → installFileMenu mounts with onError pushing messages → recorded menus pushed to menus.
 * @controlflow Create DOM element → register it → build recording arrays → assemble FileService literal with side-effecting stubs whose chooseSavePath reads options.chooseSavePathResult and whose saveFile records then optionally rejects → call installFileMenu with initialPath from options and onError/onChange listeners → store the returned menu.
 */
function setup(options: { path: string | null; chooseSavePathResult?: string | null; failSave?: boolean; deferSave?: boolean }): {
  menu: FileMenu;
  session: DocumentSession;
  saved: SaveTarget[];
  errors: string[];
  releaseWrite: () => void;
} {
  // Create a toolbar container and append it to the jsdom body so the menu has somewhere to render.
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  // Register the root so afterEach can remove it during teardown.
  roots.push(toolbar);

  // Recording arrays capture what the stubbed FileService does and what onError reports during a test.
  const saved: SaveTarget[] = [];
  const errors: string[] = [];

  // A document session seeded with initial text that tests will edit before saving; it starts clean (dirty false, savedText equal to the seed).
  const session = new DocumentSession('# Title\n');

  // Resolve which path chooseSavePath hands back for this test instance.
  // Only the absent case falls back to the default, so an explicit null (a cancelled picker) is preserved rather than coerced.
  const chooseSavePathResult: string | null = options.chooseSavePathResult === undefined ? '/w/chosen.md' : options.chooseSavePathResult;

  // When deferSave is set, writes are held open until releaseWrite() resolves this gate. Otherwise releaseWrite is a no-op and nothing awaits it.
  let resolveRelease!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const releaseWrite = (): void => {
    // Resolve the gate so any awaited write proceeds to completion.
    resolveRelease();
  };

  // Assemble the stubbed FileService; saveFile records the target so tests can assert on it, then optionally rejects to simulate a write failure.
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
      // When deferred, hold this write open until releaseWrite() resolves the gate before completing.
      if (options.deferSave === true) {
        await releaseGate;
      }
      // Opt-in failure simulation: reject after recording so the menu's catch routes to onError and resolves false without markSaved.
      if (options.failSave === true) {
        throw new Error('disk full');
      } else {
        // Write succeeded; nothing further to do, target already recorded above.
      }
    },
    async chooseSavePath(_suggestedName: string): Promise<string | null> {
      return chooseSavePathResult;
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

  // Install the menu with initialPath taken from options, onChange as a no-op, and onError recording error messages for later assertion.
  const menu = installFileMenu({
    toolbar,
    session,
    fileService,
    win: window,
    onChange: () => {
      // No-op change handler; tests drive state directly through the returned snapshot.
    },
    onError: (message: string): void => {
      // Record the error message so a failing write can be asserted on without a listener throwing.
      errors.push(message);
    },
    confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
      return 'discard';
    },
    initialPath: options.path,
  });

  // Register the installed menu so afterEach can destroy it during teardown.
  menus.push(menu);

  return { menu, session, saved, errors, releaseWrite };
}

describe('installFileMenu save/saveAs result', () => {
  // A Save of a document with a known path must resolve true and leave the session clean (dirty false) after markSaved(written).
  it('save() resolves true and leaves the session clean', async () => {
    const { session, menu } = setup({ path: '/w/notes.md' });
    // Seed an edit so there is something to write; the edited text becomes what gets saved.
    session.focusPane('source');
    session.applyText('# Title edited\n');

    // save() returns a Promise<boolean>; await it once the microtask chain settles.
    const result = await menu.save();
    await flush();

    // The write succeeded, so the returned boolean is true and markSaved cleared dirty.
    expect(result).toBe(true);
    expect(session.snapshot.dirty).toBe(false);
  });

  // Text typed while the write is still pending must stay unsaved: after resolving, dirty is true and savedText holds the pre-edit value that was actually written.
  it('keeps text typed during the write as unsaved', async () => {
    const { session, menu, releaseWrite } = setup({ path: '/w/notes.md', deferSave: true });
    session.focusPane('source');
    session.applyText('# Title edited\n');
    const written = session.snapshot.text;
    const pending = menu.save();
    await flush();
    // Typed while the write is still on its way to disk.
    session.applyText('# Title edited more\n');
    releaseWrite();
    const result = await pending;

    // The save resolved true; savedText is the text actually written, and the mid-write edit keeps the document dirty.
    expect(result).toBe(true);
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.savedText).toBe(written);
  });

  // A failing write must resolve false, deliver the error message to onError, and leave the session still dirty (markSaved never ran).
  it('save() resolves false on a failed write', async () => {
    const { session, menu, errors } = setup({ path: '/w/notes.md', failSave: true });
    // Seed an edit so there is something to attempt writing.
    session.focusPane('source');
    session.applyText('# Title edited\n');

    // save() returns a Promise<boolean>; await it once the microtask chain settles.
    const result = await menu.save();
    await flush();

    // The write rejected, so the returned boolean is false and onError received the disk-full message; dirty remains true because markSaved never ran.
    expect(result).toBe(false);
    expect(errors).toEqual(['disk full']);
    expect(session.snapshot.dirty).toBe(true);
  });

  // A cancelled Save As must resolve false with nothing written to saveFile (chooseSavePath returned null before any write was attempted).
  it('saveAs() resolves false when the picker is cancelled', async () => {
    const { menu, saved } = setup({ path: null, chooseSavePathResult: null });

    // saveAs() returns a Promise<boolean>; await it once the microtask chain settles.
    const result = await menu.saveAs();
    await flush();

    // The picker was cancelled before any write, so nothing reached saveFile and the returned boolean is false; dirty stays true because markSaved never ran.
    expect(result).toBe(false);
    expect(saved).toHaveLength(0);
  });

  // An untitled Save has no path to write to, so it delegates to Save As: chooseSavePath is consulted and the resolved destination becomes where saveFile writes.
  it('untitled save() delegates to Save As through chooseSavePath', async () => {
    const { session, menu, saved } = setup({ path: null, chooseSavePathResult: 'C:/x/a.md' });

    // save() returns a Promise<boolean>; await it once the microtask chain settles.
    const result = await menu.save();
    await flush();

    // The untitled Save routed through Save As to the chosen destination; the write went there and markSaved cleared dirty.
    expect(result).toBe(true);
    expect(saved[0]?.path).toBe('C:/x/a.md');
    expect(session.snapshot.dirty).toBe(false);
  });
});
