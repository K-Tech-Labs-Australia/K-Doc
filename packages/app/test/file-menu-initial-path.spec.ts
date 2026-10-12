// @vitest-environment jsdom

/**
 * @file file-menu-initial-path.spec.ts
 * @purpose Verifies that a tab created by installFileMenu with an initialPath keeps that file as its working target: the menu reports the mounted path and base filename, saving writes back to it without prompting for a location, and the absence of a path (undefined or null) leaves the tab untitled and forces a save-location prompt.
 * @inputs Vitest jsdom environment; installFileMenu options including an optional initialPath; a stubbed FileService that records saves and chosen paths; a DocumentSession whose text is edited during each scenario.
 * @outputs Boolean pass/fail per assertion across two scenarios: path retained on mount, and untitled fallback when no path is supplied.
 * @functions
 *   - flush: Resolves the microtask queue by awaiting Promise.resolve() four times so async install/save work settles before assertions read their results.
 *   - setup: Builds a jsdom toolbar, a stubbed FileService recording saves/choices, and a DocumentSession, installs the file menu with an optional initialPath, and returns handles plus recording arrays.
 * @dataflow setup() constructs DOM + services → installFileMenu mounts into toolbar → menu reads initialPath into filePath/fileName → test edits session text → menu.save() routes through stubbed saveFile or chooseSavePath → recorded saved[]/asked[] arrays asserted by the it blocks.
 * @controlflow describe runs once → each it calls setup() for isolated state → assertions read mount behavior, then where applicable trigger a save and await flush → afterEach destroys every menu, removes every root, clears both module arrays.
 * @version 1
 * @date 2026-09-13
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
 * @purpose Gives pending Promise chains (initialPath handling, saveFile) time to resolve before assertions read their results.
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
 * Constructs an isolated jsdom environment and installs a file menu bound to an optional initialPath.
 * @purpose Provides a shared harness that wires installFileMenu to a stubbed FileService so each test can assert mount/save behavior deterministically.
 * @inputs initialPath: Optional absolute path string or null passed through to installFileMenu; undefined omits the option entirely.
 * @outputs An object exposing the installed menu, its DocumentSession, and recording arrays `saved` (SaveTarget) and `asked` (suggested names).
 * @dataflow Builds toolbar div → appends to body → records in roots → constructs session + stubbed service → installFileMenu mounts → recorded menu pushed to menus.
 * @controlflow Create DOM element → register it → build recording arrays → assemble FileService literal with side-effecting stubs → call installFileMenu with a spread that includes initialPath only when defined → store the returned menu.
 */
function setup(initialPath?: string | null): {
  menu: FileMenu;
  session: DocumentSession;
  saved: SaveTarget[];
  asked: string[];
} {
  // Create a toolbar container and append it to the jsdom body so the menu has somewhere to render.
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  // Register the root so afterEach can remove it during teardown.
  roots.push(toolbar);

  // Recording arrays capture what the stubbed FileService does during a test.
  const saved: SaveTarget[] = [];
  const asked: string[] = [];

  // A document session seeded with initial text that tests will edit before saving.
  const session = new DocumentSession('body\n');

  // Assemble the stubbed FileService; saveFile records the target, chooseSavePath records the suggestion and resolves a fixed path.
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
    async chooseSavePath(suggestedName: string): Promise<string | null> {
      asked.push(suggestedName);
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

  // Install the menu, passing initialPath only when it was actually supplied; undefined omits the key so installFileMenu treats it as absent, while null is forwarded explicitly.
  const menu = installFileMenu({
    toolbar,
    session,
    fileService,
    win: window,
    onChange: () => {
      // No-op change handler; tests drive state directly.
    },
    onError: (_message: string) => {
      // No-op error handler; no failure is expected in these scenarios.
    },
    confirmUnsaved: async (): Promise<'save' | 'discard' | 'cancel'> => {
      return 'discard';
    },
    ...(initialPath === undefined ? {} : { initialPath }),
  });

  // Register the installed menu so afterEach can destroy it during teardown.
  menus.push(menu);

  return { menu, session, saved, asked };
}

describe('installFileMenu initialPath', () => {
  // A tab given an explicit path should report that exact path and its base filename.
  it('retains the file it was mounted from', () => {
    const { menu } = setup('/w/notes/today.md');
    expect(menu.filePath).toBe('/w/notes/today.md');
    expect(menu.fileName).toBe('today.md');
  });

  // With a known path, saving must target that file directly and never prompt for a location.
  it('writes back to the mounted file without asking where', async () => {
    const { session, menu, saved, asked } = setup('/w/notes/today.md');
    session.focusPane('source');
    session.applyText('edited\n');
    menu.save();
    await flush();

    expect(saved.map((s) => s.path)).toEqual(['/w/notes/today.md']);
    // Optional chaining guards against an empty saved array if the save never reached the stub.
    expect(saved[0]?.contents).toBe('edited\n');
    expect(asked).toEqual([]);
  });

  // Without an initialPath the menu must remain untitled, then prompt on save.
  it('stays untitled and asks for a location when no path was given', async () => {
    const { session, menu, saved, asked } = setup();
    expect(menu.filePath).toBeNull();

    session.focusPane('source');
    session.applyText('edited\n');
    menu.save();
    await flush();

    expect(asked.length).toBe(1);
    expect(saved.map((s) => s.path)).toEqual(['/w/chosen.md']);
  });

  // An explicit null must behave identically to omitting the option: untitled.
  it('treats an explicit null like no path', () => {
    const { menu } = setup(null);
    expect(menu.filePath).toBeNull();
  });
});