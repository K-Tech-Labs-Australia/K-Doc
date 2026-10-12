// @vitest-environment jsdom

// Note on test strategy: vault-service.ts imports invoke from @tauri-apps/api/core at module scope.
// Outside Tauri its available flag is false and the scan never runs, so the interesting code —
// listing, reading, indexing, the unreadable list, scan supersession, progress notifications —
// would be untestable. Mock the IPC boundary, not the service: vi.mock('@tauri-apps/api/core', ...)
// replaces invoke with a stub the test drives; everything on this side of that call is the real thing.
// A fake window carrying __TAURI_INTERNALS__ makes available true.

/**
 * @file vault-service.spec.ts
 * @purpose Vitest test suite covering vault service scan orchestration, indexing, query methods, and lifecycle (FR-6.12).
 * @inputs Seeded vault note listings, simulated Markdown files, fake Tauri Window contexts, and search/tag/backlink queries.
 * @outputs Vitest assertions verifying capability detection, scan progress notifications, note indexing, search/tag/backlink results, and teardown safety.
 * @functions
 *   - fakeTauriWindow: Constructs a fake Window object carrying __TAURI_INTERNALS__ to satisfy Tauri host detection.
 *   - seed: Populates mock IPC stub note listings and file contents.
 *   - makeService: Creates a VaultService instance with a fake Tauri window and tracks VaultStatus changes.
 * @dataflow Seed entries -> ipc.notes & ipc.files -> service.open() -> mocked invoke IPC calls -> indexNote -> VaultService queries & status assertions.
 * @controlflow Declare hoisted IPC stub -> mock @tauri-apps/api/core invoke -> reset IPC stub in beforeEach -> execute test cases across availability, opening, superseding, querying, and updating/closing suites.
 * @version 2
 * @date 2026-09-15
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVaultService } from '../src/files/vault-service.js';
import type { VaultService, VaultStatus } from '../src/files/vault-service.js';

/** What the mocked `invoke` was asked for, and what it should answer. */
interface IpcStub {
  readonly calls: Array<{ readonly cmd: string; readonly args: unknown }>;
  notes: Array<{ path: string; relative: string; size: number; modifiedMs: number }>;
  /** Per-folder listings, so two scans of different folders can be told apart. */
  byFolder: Map<string, Array<{ path: string; relative: string; size: number; modifiedMs: number }>>;
  files: Map<string, string>;
  /** Paths whose read should reject, standing in for a permissions error. */
  unreadable: Set<string>;
  /**
   * When set, a `read_text_file` for this path blocks until `release` is called.
   *
   * This is what lets a test supersede a scan while it is READING rather than while it is still
   * listing. Without it the scan is always overtaken before its listing resolves, and the guard
   * inside the read loop is never the one that decides anything.
   */
  gatePath: string | null;
  /** Called by the stub when the gated read is reached. */
  onGateReached: (() => void) | null;
  /** Resolved by the test to let the gated read finish. */
  gate: Promise<void> | null;
  /** When set, `vault_list_notes` rejects. */
  listRejects: boolean;
  /**
   * When set, `vault_list_notes` resolves with an ARRAY whose rows are the wrong shape.
   *
   * Returning a plain object instead would be rejected by the Array.isArray test alone and never
   * reach the per-row check, so the row validation would go untested.
   */
  listGarbage: boolean;
}

// vi.mock is hoisted to the top of the file, so anything the factory reads has to be hoisted too —
// this is the standard shape and not a workaround.
const ipc = vi.hoisted((): IpcStub => ({
  calls: [],
  notes: [],
  byFolder: new Map<string, Array<{ path: string; relative: string; size: number; modifiedMs: number }>>(),
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
  gatePath: null,
  onGateReached: null,
  gate: null,
  listRejects: false,
  listGarbage: false,
}));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });

    // Check which IPC command is being invoked.
    if (cmd === 'vault_list_notes') {
      // Check if listing was set to reject.
      if (ipc.listRejects) {
        // Reject with an error simulating IPC refusal.
        throw new Error('refused');
      } else if (ipc.listGarbage) {
        // An array whose rows are the wrong shape: path is a number, not a string.
        return [{ path: 123, relative: 'x.md', size: 1, modifiedMs: 1 }];
      } else {
        let folder = '';
        // Check whether the call carried a folder to look up.
        if (typeof args === 'object' && args !== null && 'folder' in args) {
          const candidate = (args as Record<string, unknown>)['folder'];
          // Check whether that folder is a string.
          if (typeof candidate === 'string') {
            // A string: use it to pick a per-folder listing.
            folder = candidate;
          } else {
            // Not a string: fall through to the shared listing.
          }
        } else {
          // No folder argument: fall through to the shared listing.
        }
        // Return the folder's own rows when the test seeded any, else the shared ones.
        return ipc.byFolder.get(folder) ?? ipc.notes;
      }
    } else if (cmd === 'read_text_file') {
      let path = '';
      // Check if args is a non-null object containing a path property.
      if (typeof args === 'object' && args !== null && 'path' in args) {
        const candidate = (args as Record<string, unknown>)['path'];
        // Check if candidate path is a string.
        if (typeof candidate === 'string') {
          // Candidate path is a valid string.
          path = candidate;
        } else {
          // Candidate path is not a string.
        }
      } else {
        // Args is missing or not a record.
      }

      // Check whether this read is the one the test is holding open.
      if (ipc.gatePath === path && ipc.gate !== null) {
        // Gated: tell the test the read has been reached, then wait for it to let go.
        const waiting = ipc.gate;
        ipc.gatePath = null;
        // Check whether the test asked to be told.
        if (ipc.onGateReached !== null) {
          // Asked: signal that the scan is now inside its read loop.
          ipc.onGateReached();
        } else {
          // Not asked: nothing to signal.
        }
        await waiting;
      } else {
        // Not gated: read as usual.
      }

      // Check if the file path is marked unreadable.
      if (ipc.unreadable.has(path)) {
        // Reject with an error simulating a permissions failure.
        throw new Error(`Permission denied: ${path}`);
      } else {
        // Return file contents with utf-8 encoding.
        return { contents: ipc.files.get(path) ?? '', encoding: 'utf-8' };
      }
    } else {
      // Unhandled IPC command: reject with a clear error.
      throw new Error(`Unhandled IPC command: ${cmd}`);
    }
  },
}));

/**
 * Constructs a minimal fake Window object carrying __TAURI_INTERNALS__ to simulate a Tauri host.
 *
 * @purpose Simulates a Tauri desktop host environment for availability detection.
 * @inputs None.
 * @outputs Window - Fake Window instance typed as Window.
 * @dataflow Object literal with __TAURI_INTERNALS__ -> cast through unknown -> Window.
 * @controlflow Create object literal -> cast through unknown to Window and return.
 */
function fakeTauriWindow(): Window {
  return { __TAURI_INTERNALS__: {} } as unknown as Window;
}

/**
 * Populates mock IPC stub notes and files from provided relative paths and text contents.
 *
 * @purpose Seeds the simulated filesystem for vault listing and file reading operations.
 * @inputs entries - Readonly array of note specifications containing relative path and text.
 * @outputs void.
 * @dataflow entries -> iterate and transform -> append to ipc.notes and set in ipc.files.
 * @controlflow Iterate entries -> construct row with '/vault/' prefix -> populate ipc.notes and ipc.files.
 */
function seed(entries: readonly { readonly relative: string; readonly text: string }[]): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Check if entry is defined under strict index access.
    if (entry !== undefined) {
      const fullPath = `/vault/${entry.relative}`;
      ipc.notes.push({
        path: fullPath,
        relative: entry.relative,
        size: entry.text.length,
        modifiedMs: 1,
      });
      ipc.files.set(fullPath, entry.text);
    } else {
      // Entry is undefined under strict index access.
    }
  }
}

/**
 * Constructs a VaultService instance running against a fake Tauri window with a status change recorder.
 *
 * @purpose Instantiates a test-ready VaultService tracking every emitted VaultStatus.
 * @inputs None.
 * @outputs Object containing the service instance and the statuses array.
 * @dataflow fakeTauriWindow -> createVaultService with onChange listener -> recorded statuses and service.
 * @controlflow Instantiate statuses array -> call createVaultService -> return service and statuses.
 */
function makeService(): { readonly service: VaultService; readonly statuses: VaultStatus[] } {
  const statuses: VaultStatus[] = [];
  const service = createVaultService({
    win: fakeTauriWindow(),
    onChange: (status: VaultStatus): void => {
      statuses.push(status);
    },
  });
  return { service, statuses };
}

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.notes = [];
  ipc.byFolder.clear();
  ipc.files.clear();
  ipc.unreadable.clear();
  ipc.gatePath = null;
  ipc.onGateReached = null;
  ipc.gate = null;
  ipc.listRejects = false;
  ipc.listGarbage = false;
});

describe('availability', (): void => {
  it('is available inside a Tauri window', (): void => {
    const { service } = makeService();
    expect(service.available).toBe(true);
  });

  it('is not available in a plain window', (): void => {
    // The browser dev build has no filesystem, and this is absence rather than failure.
    const service = createVaultService({
      win: {} as unknown as Window,
      onChange: (): void => {},
    });
    expect(service.available).toBe(false);
  });
});

describe('opening a vault', (): void => {
  it('indexes every note it finds', async (): Promise<void> => {
    seed([
      { relative: 'alpha.md', text: '# Alpha\n\n#tag here' },
      { relative: 'beta.md', text: '# Beta' },
    ]);
    const { service } = makeService();
    await service.open('/vault');

    expect(service.notes).toHaveLength(2);
    expect(service.notes.map((n): string => n.title)).toEqual(['Alpha', 'Beta']);
  });

  it('orders notes by path', async (): Promise<void> => {
    seed([
      { relative: 'z.md', text: '# Z' },
      { relative: 'a.md', text: '# A' },
    ]);
    const { service } = makeService();
    await service.open('/vault');

    // A file list that reordered itself between opens would look broken.
    expect(service.notes.map((n): string => n.relative)).toEqual(['a.md', 'z.md']);
  });

  it('reports scanning while it runs and not after', async (): Promise<void> => {
    seed([
      { relative: 'one.md', text: '# One' },
      { relative: 'two.md', text: '# Two' },
    ]);
    const { service, statuses } = makeService();
    await service.open('/vault');

    // A scan of a large folder takes time, and a panel showing nothing until it finished would look broken.
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses[0]!.scanning).toBe(true);
    expect(statuses[statuses.length - 1]!.scanning).toBe(false);
    expect(statuses[statuses.length - 1]!.noteCount).toBe(2);
  });

  it('records a note it could not read without giving up on the rest', async (): Promise<void> => {
    seed([
      { relative: 'first.md', text: '# First' },
      { relative: 'second.md', text: '# Second' },
      { relative: 'third.md', text: '# Third' },
    ]);
    ipc.unreadable.add('/vault/second.md');

    const { service } = makeService();
    await service.open('/vault');

    // A file the user cannot read is not a reason to refuse them the rest of their vault.
    expect(service.notes).toHaveLength(2);
    expect(service.status.unreadable).toHaveLength(1);
    expect(service.status.unreadable[0]!).toBe('/vault/second.md');
  });

  it('survives the listing being refused', async (): Promise<void> => {
    ipc.listRejects = true;
    const { service } = makeService();

    await expect(service.open('/vault')).resolves.not.toThrow();
    expect(service.notes).toHaveLength(0);
    expect(service.status.scanning).toBe(false);
  });

  it('survives a listing of the wrong shape', async (): Promise<void> => {
    ipc.listGarbage = true;
    const { service } = makeService();

    // The value crossed a boundary the service does not control, so its shape is checked rather than
    // assumed. The listing here is an array of rows with a numeric path -- the shape a real mismatch
    // would take. Without the check the service would go on to read a file named by a number.
    await expect(service.open('/vault')).resolves.not.toThrow();
    expect(service.notes).toHaveLength(0);
    expect(service.status.scanning).toBe(false);
    expect(ipc.calls.filter((c): boolean => c.cmd === 'read_text_file')).toHaveLength(0);
  });

  it('indexes the tags it finds', async (): Promise<void> => {
    seed([
      { relative: 'alpha.md', text: '# Alpha\n\n#tag here' },
      { relative: 'beta.md', text: '# Beta' },
    ]);
    const { service } = makeService();
    await service.open('/vault');

    expect(service.notes[0]!.tags).toEqual(['tag']);
  });

  it('indexes a CRLF note at the offsets the editor uses', async (): Promise<void> => {
    seed([{ relative: 'crlf.md', text: '# Alpha\r\n\r\n## Two\r\n' }]);
    const { service } = makeService();
    await service.open('/vault');

    // '# Alpha\n\n' is 9 characters; counted with CRLF it would be 11.
    expect(service.notes[0]!.headings.map((heading) => heading.start)).toEqual([0, 9]);
  });
});

describe('superseding a scan', (): void => {
  it('drops a scan the user replaced', async (): Promise<void> => {
    // Each folder gets its own listing, so the notes say which scan finished last. Asserting only
    // that root is '/two' proves nothing: root is set synchronously at the top of open, before any
    // of the first scan's awaits have resolved.
    ipc.byFolder.set('/one', [
      { path: '/one/from-one.md', relative: 'from-one.md', size: 1, modifiedMs: 1 },
    ]);
    ipc.byFolder.set('/two', [
      { path: '/two/from-two.md', relative: 'from-two.md', size: 1, modifiedMs: 1 },
    ]);
    ipc.files.set('/one/from-one.md', '# From One');
    ipc.files.set('/two/from-two.md', '# From Two');

    const { service } = makeService();

    // A user who opens one folder and immediately opens another must not get the first folder's notes arriving after the second's.
    const first = service.open('/one');
    const second = service.open('/two');
    await Promise.all([first, second]);

    expect(service.status.root).toBe('/two');
    expect(service.notes.map((n): string => n.relative)).toEqual(['from-two.md']);
  });

  it('drops a scan replaced while it was reading', async (): Promise<void> => {
    // The case above is overtaken before its listing resolves, so the check after the listing is the
    // one that stops it. This one is overtaken mid-read, which is the only way to reach the check
    // inside the read loop -- and mid-read is exactly when it happens on a vault big enough to care.
    ipc.byFolder.set('/one', [
      { path: '/one/slow.md', relative: 'slow.md', size: 1, modifiedMs: 1 },
    ]);
    ipc.byFolder.set('/two', [
      { path: '/two/from-two.md', relative: 'from-two.md', size: 1, modifiedMs: 1 },
    ]);
    ipc.files.set('/one/slow.md', '# Slow');
    ipc.files.set('/two/from-two.md', '# From Two');

    let release: () => void = (): void => {};
    ipc.gate = new Promise<void>((resolve): void => {
      release = resolve;
    });
    let reached: () => void = (): void => {};
    const atTheRead = new Promise<void>((resolve): void => {
      reached = resolve;
    });
    ipc.gatePath = '/one/slow.md';
    ipc.onGateReached = reached;

    const { service } = makeService();
    const first = service.open('/one');

    // Wait until the first scan is actually inside its read loop before replacing it.
    await atTheRead;

    const second = service.open('/two');
    release();
    await Promise.all([first, second]);

    expect(service.notes.map((n): string => n.relative)).toEqual(['from-two.md']);
  });
});

describe('the queries', (): void => {
  let service: VaultService;

  beforeEach(async (): Promise<void> => {
    seed([
      { relative: 'alpha.md', text: '# Alpha\n\n#work' },
      { relative: 'beta.md', text: '# Beta\n\n#work/urgent' },
      { relative: 'gamma.md', text: '# Gamma\n\n[[alpha]]' },
    ]);
    const bundle = makeService();
    service = bundle.service;
    await service.open('/vault');
  });

  it('finds notes by query', (): void => {
    const matches = service.find('alpha');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.note.title).toBe('Alpha');
  });

  it('counts tags', (): void => {
    expect(service.tags()).toContainEqual({ tag: 'work', count: 1 });
  });

  it('finds notes under a parent tag', (): void => {
    expect(service.tagged('work')).toHaveLength(2);
  });

  it('finds backlinks by path', (): void => {
    const links = service.backlinks('/vault/alpha.md');
    expect(links).toHaveLength(1);
    expect(links[0]!.from.relative).toBe('gamma.md');
  });

  it('has no backlinks for a path it does not know', (): void => {
    // A document that is not in the vault has no backlinks rather than an error.
    expect(service.backlinks('/elsewhere/x.md')).toHaveLength(0);
  });
});

describe('updating and closing', (): void => {
  it('re-indexes one note from text it is given', async (): Promise<void> => {
    seed([{ relative: 'a.md', text: '# Original' }]);
    const { service } = makeService();
    await service.open('/vault');

    const callsBefore = ipc.calls.filter((c): boolean => c.cmd === 'read_text_file').length;

    // The caller already has the text, so going back to the disk for it would be reading a file to learn what the editor already knows.
    service.update('/vault/a.md', '# Renamed');

    expect(service.notes[0]!.title).toBe('Renamed');
    const callsAfter = ipc.calls.filter((c): boolean => c.cmd === 'read_text_file').length;
    expect(callsAfter).toBe(callsBefore);
  });

  it('ignores an update for a note it does not hold', async (): Promise<void> => {
    seed([{ relative: 'a.md', text: '# A' }]);
    const { service } = makeService();
    await service.open('/vault');

    expect((): void => {
      service.update('/elsewhere/x.md', '# Outside');
    }).not.toThrow();

    expect(service.notes).toHaveLength(1);
    expect(service.notes[0]!.title).toBe('A');
  });

  it('forgets everything on close', async (): Promise<void> => {
    seed([{ relative: 'a.md', text: '# A' }]);
    const { service } = makeService();
    await service.open('/vault');

    service.close();

    expect(service.status.root).toBeNull();
    expect(service.notes).toHaveLength(0);
  });

  it('does nothing after destroy', async (): Promise<void> => {
    seed([{ relative: 'a.md', text: '# A' }]);
    const { service } = makeService();
    await service.open('/vault');

    // A scan still in flight when the shell tears down must not write into state nobody is reading.
    service.destroy();

    expect(service.notes).toHaveLength(0);
    expect(service.find('a')).toHaveLength(0);
    expect(service.tags()).toHaveLength(0);
    expect(service.backlinks('x')).toHaveLength(0);

    await service.open('/again');
    expect(service.notes).toHaveLength(0);
  });

  it('refresh does nothing with no vault open', async (): Promise<void> => {
    const { service } = makeService();

    await expect(service.refresh()).resolves.not.toThrow();
    const listCalls = ipc.calls.filter((c): boolean => c.cmd === 'vault_list_notes');
    expect(listCalls).toHaveLength(0);
  });
});
