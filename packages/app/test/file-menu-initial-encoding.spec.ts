// @vitest-environment jsdom

/**
 * @file file-menu-initial-encoding.spec.ts
 * @purpose Verifies that a tab remounted with installFileMenu's initialEncoding reports that encoding and saves the file back in it; when omitted, the menu starts at UTF-8. setEncoding still overrides the mounted value on the next save.
 * @inputs Vitest jsdom environment; installFileMenu options including an optional initialEncoding; a stubbed FileService that records saves; a DocumentSession whose text is edited during each scenario.
 * @outputs Boolean pass/fail per assertion across four scenarios: encoding reported on mount, save written in the mounted encoding, UTF-8 default when omitted, and setEncoding override.
 * @functions
 *   - flush: Resolves the microtask queue by awaiting Promise.resolve() four times so async install/save work settles before assertions read their results.
 *   - setup: Builds a jsdom toolbar, a stubbed FileService recording saves, and a DocumentSession, installs the file menu with an optional initialEncoding, and returns handles plus the recording array.
 * @dataflow setup() constructs DOM + services → installFileMenu mounts into toolbar → menu reads initialEncoding into encoding → test edits session text → menu.save() routes through stubbed saveFile → recorded saved[] asserted by the it blocks.
 * @controlflow describe runs once → each it calls setup() for isolated state → assertions read mount behavior, then where applicable trigger a save and await flush → afterEach destroys every menu, removes every root, clears both module arrays.
 * @version 2
 * @date 2026-09-15
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
 * Constructs an isolated jsdom environment and installs a file menu bound to an optional initialEncoding.
 * @purpose Provides a shared harness that wires installFileMenu to a stubbed FileService so each test can assert mount/save encoding behavior deterministically.
 * @inputs initialEncoding: Optional encoding string passed through to installFileMenu; undefined omits the option entirely so the menu defaults to UTF-8.
 * @outputs An object exposing the installed menu, its DocumentSession, and the recording array `saved` (SaveTarget).
 * @dataflow Builds toolbar div → appends to body → records in roots → constructs session + stubbed service → installFileMenu mounts → recorded menu pushed to menus.
 * @controlflow Create DOM element → register it → build recording array → assemble FileService literal with side-effecting stubs → call installFileMenu with initialPath always set and initialEncoding spread only when defined → store the returned menu.
 */
function setup(initialEncoding?: string): {
  menu: FileMenu;
  session: DocumentSession;
  saved: SaveTarget[];
} {
  // Create a toolbar container and append it to the jsdom body so the menu has somewhere to render.
  const toolbar = document.createElement('div');
  document.body.appendChild(toolbar);
  // Register the root so afterEach can remove it during teardown.
  roots.push(toolbar);

  // Recording arrays capture what the stubbed FileService does during a test.
  const saved: SaveTarget[] = [];

  // A document session seeded with initial text that tests will edit before saving.
  const session = new DocumentSession('# Title\n');

  // Assemble the stubbed FileService; saveFile records the target so tests can assert on it.
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
    lineEndingOf(path: string): 'lf' | 'crlf' | undefined {
      // The mounted note was read as a CRLF file; nothing else is known.
      if (path === '/w/notes.md') {
        return 'crlf';
      } else {
        return undefined;
      }
    },
  };

  // Install the menu with initialPath always set (a remounted tab), and initialEncoding only when supplied.
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
    initialPath: '/w/notes.md',
    // undefined omits the key so installFileMenu treats it as absent and defaults to UTF-8; a defined value is forwarded explicitly.
    ...(initialEncoding === undefined ? {} : { initialEncoding }),
  });

  // Register the installed menu so afterEach can destroy it during teardown.
  menus.push(menu);

  return { menu, session, saved };
}

describe('installFileMenu initialEncoding', () => {
  // A tab given an explicit encoding should report that exact value as its working encoding.
  it('reports the encoding it was mounted with', () => {
    const { menu } = setup('utf-16le');
    expect(menu.encoding).toBe('utf-16le');
  });

  // With a known path and an explicit encoding, saving must write back to that file in that encoding.
  it('saves the file back in the mounted encoding', async () => {
    const { session, menu, saved } = setup('utf-8-bom');
    session.focusPane('source');
    session.applyText('# Title edited\n');
    menu.save();
    await flush();

    expect(saved).toHaveLength(1);
    // Optional chaining guards against an empty saved array if the save never reached the stub.
    expect(saved[0]?.encoding).toBe('utf-8-bom');
    expect(saved[0]?.path).toBe('/w/notes.md');
    expect(saved[0]?.contents).toBe('# Title edited\n');
  });

  // Save As writes a new file with the line endings of the file it was read from; Save leaves them to the file service.
  it('carries the line endings of the original file into Save As', async () => {
    const { menu, saved } = setup('utf-8');
    menu.saveAs();
    await flush();
    expect(saved[0]?.path).toBe('/w/chosen.md');
    expect(saved[0]?.lineEnding).toBe('crlf');
    menu.save();
    await flush();
    expect(saved[1]?.path).toBe('/w/chosen.md');
    expect(saved[1]?.lineEnding).toBeUndefined();
  });

  // Without an initialEncoding the menu must default to UTF-8, and a save must write it back as UTF-8.
  it('starts at UTF-8 when no encoding is given', async () => {
    const { menu, saved } = setup();
    expect(menu.encoding).toBe('utf-8');

    menu.save();
    await flush();

    // Optional chaining guards against an empty saved array if the save never reached the stub.
    expect(saved[0]?.encoding).toBe('utf-8');
  });

  // setEncoding must override the mounted encoding on the next save, not be pinned by it.
  it('setEncoding still overrides the mounted encoding', async () => {
    const { menu, saved } = setup('utf-16be');
    menu.setEncoding('utf-8');
    expect(menu.encoding).toBe('utf-8');

    menu.save();
    await flush();

    // Optional chaining guards against an empty saved array if the save never reached the stub.
    expect(saved[0]?.encoding).toBe('utf-8');
  });
});