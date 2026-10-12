// @vitest-environment jsdom

// Note on test strategy: vault-service.ts imports invoke from @tauri-apps/api/core at module scope.
// Outside Tauri its available flag is false and the scan never runs, so the incremental cache code —
// reading the saved index, planning the scan, skipping unchanged notes, writing the new index —
// would be untestable. Mock the IPC boundary, not the service: vi.mock('@tauri-apps/api/core', ...)
// replaces invoke with a stub the test drives; everything on this side of that call is the real thing.
// A fake window carrying __TAURI_INTERNALS__ makes available true.

/**
 * @file vault-index-cache.spec.ts
 * @purpose Vitest test suite proving the incremental behaviour of the vault index cache (FR-6.12).
 * @inputs Seeded vault note listings, simulated Markdown files, fake Tauri Window contexts, and saved index states.
 * @outputs Vitest assertions verifying cache hits, skip-reading unchanged notes, re-indexing modified notes, refresh rebuilds, and error recovery.
 * @functions
 *   - fakeTauriWindow: Constructs a fake Window object carrying __TAURI_INTERNALS__ to satisfy Tauri host detection.
 *   - seed: Populates mock IPC stub note rows and file contents.
 *   - makeService: Creates a VaultService instance with a fake Tauri window and tracks VaultStatus changes.
 * @dataflow Seed entries -> ipc.rows & ipc.files -> service.open() / refresh() -> mocked invoke IPC calls -> planScan & indexNote -> assertions on ipc.readPaths, ipc.saved, and VaultStatus.
 * @controlflow Declare hoisted IPC stub -> mock @tauri-apps/api/core invoke -> reset IPC stub in beforeEach -> execute test cases across initial open, reuse, modifications, deletions, refresh, and error resilience.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVaultService } from '../src/files/vault-service.js';
import type { VaultService, VaultStatus } from '../src/files/vault-service.js';

interface IpcStub {
  readonly calls: Array<{ readonly cmd: string; readonly args: unknown }>;
  /** The vault's files, keyed by absolute path. */
  rows: Array<{ path: string; relative: string; size: number; modifiedMs: number }>;
  files: Map<string, string>;
  /** Paths whose read should reject, standing in for an unreadable file. */
  unreadable: Set<string>;
  /** Every path `read_text_file` was actually asked for. The whole point of the cache is that this stays short. */
  readPaths: string[];
  /** The saved index, as the host would hold it on disk. */
  saved: string | null;
  /** When set, `vault_index_read` rejects, standing in for an unreadable cache. */
  readRejects: boolean;
  /** When set, `vault_index_write` rejects, standing in for read-only media. */
  writeRejects: boolean;
}

const ipc = vi.hoisted((): IpcStub => ({
  calls: [],
  rows: [],
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
  readPaths: [],
  saved: null,
  readRejects: false,
  writeRejects: false,
}));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });

    // Check which IPC command is being invoked.
    if (cmd === 'vault_list_notes') {
      // Return the current vault note rows.
      return ipc.rows;
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

      ipc.readPaths.push(path);

      // Check if the file path is marked unreadable.
      if (ipc.unreadable.has(path)) {
        // Reject with an error simulating a read permissions failure.
        throw new Error(`Permission denied: ${path}`);
      } else {
        // Return file contents with utf-8 encoding.
        return { contents: ipc.files.get(path) ?? '', encoding: 'utf-8' };
      }
    } else if (cmd === 'vault_index_read') {
      // Check if reading the index was configured to reject.
      if (ipc.readRejects) {
        // Reject with an error simulating an unreadable index file.
        throw new Error('read failed');
      } else {
        // Return the saved index payload or null.
        return ipc.saved;
      }
    } else if (cmd === 'vault_index_write') {
      // Check if writing the index was configured to reject.
      if (ipc.writeRejects) {
        // Reject with an error simulating read-only media or write failure.
        throw new Error('write failed');
      } else {
        let contents = '';
        // Check if args is a non-null object containing a contents property.
        if (typeof args === 'object' && args !== null && 'contents' in args) {
          const candidate = (args as Record<string, unknown>)['contents'];
          // Check if candidate contents is a string.
          if (typeof candidate === 'string') {
            // Candidate contents is a valid string.
            contents = candidate;
          } else {
            // Candidate contents is not a string.
          }
        } else {
          // Args is missing or not a record.
        }

        ipc.saved = contents;
        return undefined;
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
 * Populates mock IPC stub note rows and file contents from provided note descriptors.
 *
 * @purpose Seeds the simulated filesystem for vault listing and file reading operations.
 * @inputs entries - Readonly array of note specifications containing relative path, text, and modified timestamp.
 * @outputs void.
 * @dataflow entries -> iterate and transform -> append to ipc.rows and set in ipc.files.
 * @controlflow Iterate entries -> construct row with 'C:/vault/' prefix -> populate ipc.rows and ipc.files.
 */
function seed(entries: readonly { relative: string; text: string; modifiedMs: number }[]): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Check if entry is defined under strict index access.
    if (entry !== undefined) {
      const fullPath = `C:/vault/${entry.relative}`;
      ipc.rows.push({
        path: fullPath,
        relative: entry.relative,
        size: entry.text.length,
        modifiedMs: entry.modifiedMs,
      });
      ipc.files.set(fullPath, entry.text);
    } else {
      // Entry is undefined under strict index access.
    }
  }
}

/** Module-level storage recording the latest VaultStatus emitted by VaultService. */
let lastStatus: VaultStatus | null = null;

/**
 * Constructs a VaultService instance running against a fake Tauri window with a status change recorder.
 *
 * @purpose Instantiates a test-ready VaultService tracking the latest emitted VaultStatus.
 * @inputs None.
 * @outputs VaultService - The created VaultService instance.
 * @dataflow fakeTauriWindow -> createVaultService with onChange listener updating lastStatus -> VaultService.
 * @controlflow Call createVaultService with fake window and onChange callback -> return service instance.
 */
function makeService(): VaultService {
  return createVaultService({
    win: fakeTauriWindow(),
    onChange: (status: VaultStatus): void => {
      lastStatus = status;
    },
  });
}

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.rows = [];
  ipc.files.clear();
  ipc.unreadable.clear();
  ipc.readPaths = [];
  ipc.saved = null;
  ipc.readRejects = false;
  ipc.writeRejects = false;
  lastStatus = null;
});

describe('vault index cache', (): void => {
  it('reads every note and saves an index on first open', async (): Promise<void> => {
    // A cold scan with no saved index must read and parse every note from disk and persist a new index.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const service = makeService();
    await service.open('C:/vault');

    expect(ipc.readPaths).toHaveLength(3);
    expect(ipc.readPaths).toEqual([
      'C:/vault/alpha.md',
      'C:/vault/beta.md',
      'C:/vault/gamma.md',
    ]);
    expect(ipc.saved).not.toBeNull();
    expect(lastStatus).not.toBeNull();
    // Verify that zero notes were reused on cold initial scan.
    if (lastStatus !== null) {
      expect(lastStatus.reused).toBe(0);
    } else {
      // Status was unexpectedly null.
    }
    expect(service.status.reused).toBe(0);
  });

  it('reads nothing on a second open with identical files', async (): Promise<void> => {
    // A warm scan with an intact index matching disk files must skip all reads and restore notes from cache.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const firstService = makeService();
    await firstService.open('C:/vault');

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(ipc.readPaths).toHaveLength(0);
    expect(lastStatus).not.toBeNull();
    // Verify that all 3 notes were restored from cache without any disk reads.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(3);
      expect(lastStatus.reused).toBe(3);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.noteCount).toBe(3);
    expect(secondService.status.reused).toBe(3);
  });

  it('preserves full note metadata and content when reusing cached entries', async (): Promise<void> => {
    // Reused notes must preserve the complete indexed metadata including titles and relative paths.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const firstService = makeService();
    await firstService.open('C:/vault');

    const firstRelatives = firstService.notes.map((n): string => n.relative);
    const firstTitle = firstService.notes[0]?.title;

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(secondService.notes.map((n): string => n.relative)).toEqual(firstRelatives);
    expect(secondService.notes[0]?.title).toBe(firstTitle);
    expect(secondService.notes[0]?.title).toBe('Alpha');
  });

  it('re-reads only the changed note when file metadata changes', async (): Promise<void> => {
    // When a single note is modified on disk, only that note should be re-read while unchanged notes are reused.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const firstService = makeService();
    await firstService.open('C:/vault');

    const targetRow = ipc.rows[1];
    // Check if targetRow is defined under strict index access.
    if (targetRow !== undefined) {
      targetRow.modifiedMs = 2000;
      targetRow.size = '# Beta Updated Long Text'.length;
    } else {
      // Target row was unexpectedly undefined.
    }
    ipc.files.set('C:/vault/beta.md', '# Beta Updated Long Text');

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(ipc.readPaths).toEqual(['C:/vault/beta.md']);
    expect(lastStatus).not.toBeNull();
    // Verify that exactly two unchanged notes were reused from cache.
    if (lastStatus !== null) {
      expect(lastStatus.reused).toBe(2);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.reused).toBe(2);
    const betaNote = secondService.notes.find((n): boolean => n.relative === 'beta.md');
    expect(betaNote?.title).toBe('Beta Updated Long Text');
  });

  it('reads only newly added notes and reuses existing ones', async (): Promise<void> => {
    // Newly added notes must be read and indexed while all existing notes are reused from cache.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const firstService = makeService();
    await firstService.open('C:/vault');

    const newPath = 'C:/vault/delta.md';
    ipc.rows.push({
      path: newPath,
      relative: 'delta.md',
      size: '# Delta'.length,
      modifiedMs: 1000,
    });
    ipc.files.set(newPath, '# Delta');

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(ipc.readPaths).toEqual(['C:/vault/delta.md']);
    expect(lastStatus).not.toBeNull();
    // Verify total note count increases to 4 with 3 reused.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(4);
      expect(lastStatus.reused).toBe(3);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.noteCount).toBe(4);
    expect(secondService.status.reused).toBe(3);
  });

  it('drops deleted notes without requiring explicit cache invalidation', async (): Promise<void> => {
    // Deleted notes must be omitted automatically because the scan plan is derived from current disk files.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const firstService = makeService();
    await firstService.open('C:/vault');

    ipc.rows = ipc.rows.filter((r): boolean => r.relative !== 'beta.md');
    ipc.files.delete('C:/vault/beta.md');

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(lastStatus).not.toBeNull();
    // Verify noteCount drops to 2 and deleted note is not present.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(2);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.noteCount).toBe(2);
    expect(secondService.notes.map((n): string => n.relative)).not.toContain('beta.md');
    expect(secondService.notes.map((n): string => n.relative)).toEqual(['alpha.md', 'gamma.md']);
  });

  it('rebuilds everything from disk and ignores the saved index on refresh', async (): Promise<void> => {
    // Refresh must bypass the cache and rebuild the index from scratch for full consistency on demand.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    const service = makeService();
    await service.open('C:/vault');

    // Warm open that reuses everything.
    ipc.readPaths = [];
    await service.open('C:/vault');
    expect(service.status.reused).toBe(3);
    expect(ipc.readPaths).toHaveLength(0);

    // Refresh rebuilds everything.
    ipc.readPaths = [];
    await service.refresh();

    expect(ipc.readPaths).toHaveLength(3);
    expect(ipc.readPaths).toEqual([
      'C:/vault/alpha.md',
      'C:/vault/beta.md',
      'C:/vault/gamma.md',
    ]);
    expect(lastStatus).not.toBeNull();
    // Verify that zero notes were reused during full refresh.
    if (lastStatus !== null) {
      expect(lastStatus.reused).toBe(0);
    } else {
      // Status was unexpectedly null.
    }
    expect(service.status.reused).toBe(0);
  });

  it('ignores corrupt saved index JSON and performs a clean full scan', async (): Promise<void> => {
    // A corrupted cache JSON payload must be discarded safely and fall back to a full scan without throwing.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    ipc.saved = 'not json{';
    const service = makeService();

    await expect(service.open('C:/vault')).resolves.not.toThrow();

    expect(ipc.readPaths).toHaveLength(3);
    expect(ipc.readPaths).toEqual([
      'C:/vault/alpha.md',
      'C:/vault/beta.md',
      'C:/vault/gamma.md',
    ]);
    expect(lastStatus).not.toBeNull();
    // Verify that corrupted cache causes 0 notes to be reused.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(3);
      expect(lastStatus.reused).toBe(0);
    } else {
      // Status was unexpectedly null.
    }
    expect(service.status.noteCount).toBe(3);
    expect(service.status.reused).toBe(0);
  });

  it('does not reuse an index that was saved for a different folder', async (): Promise<void> => {
    // An index saved for another folder must not be reused when scanning a different folder root.
    const entries = [
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ];
    seed(entries);
    const firstService = makeService();
    await firstService.open('C:/vault');

    expect(ipc.saved).not.toBeNull();

    ipc.readPaths = [];
    ipc.rows = [];
    ipc.files.clear();
    seed(entries);

    const secondService = makeService();
    await secondService.open('C:/other');

    expect(ipc.readPaths).toHaveLength(3);
    expect(ipc.readPaths).toEqual([
      'C:/vault/alpha.md',
      'C:/vault/beta.md',
      'C:/vault/gamma.md',
    ]);
    expect(lastStatus).not.toBeNull();
    // Verify that zero notes were reused due to folder mismatch.
    if (lastStatus !== null) {
      expect(lastStatus.reused).toBe(0);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.reused).toBe(0);
  });

  it('treats an unreadable index as absent and performs a full scan without throwing', async (): Promise<void> => {
    // IPC rejection while reading the index must be handled gracefully by falling back to a full scan.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    ipc.readRejects = true;
    const service = makeService();

    await expect(service.open('C:/vault')).resolves.not.toThrow();

    expect(ipc.readPaths).toHaveLength(3);
    expect(ipc.readPaths).toEqual([
      'C:/vault/alpha.md',
      'C:/vault/beta.md',
      'C:/vault/gamma.md',
    ]);
    expect(lastStatus).not.toBeNull();
    // Verify that unreadable index triggers full scan with zero notes reused.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(3);
      expect(lastStatus.reused).toBe(0);
    } else {
      // Status was unexpectedly null.
    }
    expect(service.status.noteCount).toBe(3);
    expect(service.status.reused).toBe(0);
  });

  it('completes indexing successfully even when saving the index to disk fails', async (): Promise<void> => {
    // A cache write rejection (e.g. read-only media) must not abort the scan or leave the service scanning.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    ipc.writeRejects = true;
    const service = makeService();

    await expect(service.open('C:/vault')).resolves.not.toThrow();

    expect(lastStatus).not.toBeNull();
    // Verify noteCount is correct and scanning is false despite cache write failure.
    if (lastStatus !== null) {
      expect(lastStatus.noteCount).toBe(3);
      expect(lastStatus.scanning).toBe(false);
    } else {
      // Status was unexpectedly null.
    }
    expect(service.status.noteCount).toBe(3);
    expect(service.status.scanning).toBe(false);
  });

  it('does not save unreadable files into the cache so they are re-attempted on next scan', async (): Promise<void> => {
    // Files that fail to read must not be recorded in the cache so subsequent scans re-attempt reading them.
    seed([
      { relative: 'alpha.md', text: '# Alpha', modifiedMs: 1000 },
      { relative: 'beta.md', text: '# Beta', modifiedMs: 1000 },
      { relative: 'gamma.md', text: '# Gamma', modifiedMs: 1000 },
    ]);
    ipc.unreadable.add('C:/vault/beta.md');

    const firstService = makeService();
    await firstService.open('C:/vault');

    expect(firstService.status.unreadable).toEqual(['C:/vault/beta.md']);
    expect(firstService.notes.map((n): string => n.relative)).toEqual(['alpha.md', 'gamma.md']);

    ipc.readPaths = [];
    const secondService = makeService();
    await secondService.open('C:/vault');

    expect(ipc.readPaths).toEqual(['C:/vault/beta.md']);
    expect(lastStatus).not.toBeNull();
    // Verify that 2 readable notes were reused and unreadable note was re-read.
    if (lastStatus !== null) {
      expect(lastStatus.reused).toBe(2);
    } else {
      // Status was unexpectedly null.
    }
    expect(secondService.status.reused).toBe(2);
  });
});
