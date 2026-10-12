/**
 * @file vault-files.spec.ts
 * @purpose Verifies the VaultFiles wrapper produced by createVaultFiles: availability gating outside the desktop host, IPC command construction for each file operation, result validation against malformed answers, and propagation of a host refusal as an Error carrying its message.
 * @inputs A mocked `@tauri-apps/api/core` invoke driven by the hoisted `ipc` object; a fake browser Window and a host Window carrying `__TAURI_INTERNALS__`.
 * @outputs Assertions over VaultFiles method return values, recorded IPC calls, and thrown errors.
 * @functions
 *   - createVaultFiles: Factory under test producing a VaultFiles instance bound to a Window.
 *   - listFolders: Lists vault folders via the `vault_list_folders` IPC command.
 *   - createNote: Creates a note file with contents via `vault_create_note`.
 *   - createFolder: Creates a folder via `vault_create_folder`.
 *   - move: Moves a file via `vault_move`.
 *   - trash: Trashes files via `vault_trash`.
 *   - listTemplates: Lists templates via `vault_list_templates`.
 * @dataflow Test sets `ipc.answer` → VaultFiles method call → Tauri invoke (mocked) → `ipc.answer` returned → assertion compares the result and recorded IPC calls.
 * @controlflow The mock module is hoisted; `beforeEach` resets the `ipc` object; each test configures `ipc.answer`/`ipc.reject`, invokes a VaultFiles method, then asserts on the return value, recorded IPC call, or thrown error.
 * @version 1
 * @date 2026-09-14
 */

// @vitest-environment node

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createVaultFiles } from '../src/files/vault-files.js';

const ipc = vi.hoisted(() => ({ calls: [] as { command: string; args: unknown }[], answer: undefined as unknown, reject: null as unknown }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: unknown): Promise<unknown> => {
    ipc.calls.push({ command, args });
    if (ipc.reject !== null) {
      throw ipc.reject;
    } else {
      return ipc.answer;
    }
  },
}));

beforeEach(() => {
  ipc.calls.length = 0;
  ipc.answer = undefined;
  ipc.reject = null;
});

const hostWindow = { __TAURI_INTERNALS__: {} } as unknown as Window;
const browserWindow = {} as unknown as Window;

describe('vault files', () => {
  it('is unavailable outside the desktop host and says why', async () => {
    const files = createVaultFiles(browserWindow);
    expect(files.available).toBe(false);
    await expect(files.listFolders('/v')).rejects.toThrow('File operations need the desktop app.');
    expect(ipc.calls).toEqual([]);
  });

  it('lists folders', async () => {
    ipc.answer = ['a', 'a/b'];
    const files = createVaultFiles(hostWindow);
    expect(await files.listFolders('/v')).toEqual(['a', 'a/b']);
    expect(ipc.calls).toEqual([{ command: 'vault_list_folders', args: { root: '/v' } }]);
  });

  it('rejects a malformed folder list', async () => {
    ipc.answer = ['a', 3];
    const files = createVaultFiles(hostWindow);
    await expect(files.listFolders('/v')).rejects.toThrow('vault_list_folders returned an unexpected result');
  });

  it('creates a note with its contents', async () => {
    ipc.answer = '/v/n.md';
    const files = createVaultFiles(hostWindow);
    expect(await files.createNote('/v', '/v/n.md', '# N\n')).toBe('/v/n.md');
    expect(ipc.calls).toEqual([{ command: 'vault_create_note', args: { root: '/v', path: '/v/n.md', contents: '# N\n' } }]);
  });

  it('creates a folder', async () => {
    ipc.answer = '/v/f';
    const files = createVaultFiles(hostWindow);
    expect(await files.createFolder('/v', '/v/f')).toBe('/v/f');
    expect(ipc.calls[0]).toEqual({ command: 'vault_create_folder', args: { root: '/v', path: '/v/f' } });
  });

  it('moves', async () => {
    ipc.answer = '/v/b.md';
    const files = createVaultFiles(hostWindow);
    expect(await files.move('/v', '/v/a.md', '/v/b.md')).toBe('/v/b.md');
    expect(ipc.calls[0]).toEqual({ command: 'vault_move', args: { root: '/v', from: '/v/a.md', to: '/v/b.md' } });
  });

  it('rejects a move that answers something other than a path', async () => {
    ipc.answer = 42;
    const files = createVaultFiles(hostWindow);
    await expect(files.move('/v', '/v/a.md', '/v/b.md')).rejects.toThrow('vault_move returned an unexpected result');
  });

  it('trashes a copy of the paths it was given', async () => {
    const paths = ['/v/a.md'];
    const files = createVaultFiles(hostWindow);
    await files.trash('/v', paths);
    expect(ipc.calls[0]).toEqual({ command: 'vault_trash', args: { root: '/v', paths: ['/v/a.md'] } });
  });

  it('lists templates', async () => {
    ipc.answer = [{ name: 'Daily', path: '/v/.k-doc/templates/Daily.md' }];
    const files = createVaultFiles(hostWindow);
    expect(await files.listTemplates('/v')).toEqual([{ name: 'Daily', path: '/v/.k-doc/templates/Daily.md' }]);
    expect(ipc.calls[0]?.command).toBe('vault_list_templates');
  });

  it('rejects a malformed template list', async () => {
    ipc.answer = [{ name: 'Daily', path: 7 }];
    const files = createVaultFiles(hostWindow);
    await expect(files.listTemplates('/v')).rejects.toThrow('vault_list_templates returned an unexpected result');
  });

  it("passes the host's refusal on as an Error with its message", async () => {
    ipc.reject = "Cannot move to '/v/b.md': something with that name is already there";
    const files = createVaultFiles(hostWindow);
    await expect(files.move('/v', '/v/a.md', '/v/b.md')).rejects.toThrow("Cannot move to '/v/b.md': something with that name is already there");
  });
});
