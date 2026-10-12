/**
 * @file file-service-read-file.spec.ts
 * @purpose readFile keeps the encoding a file was found in so a file opened from Recent, Quick Open or the vault saves back as it was.
 * @inputs Mocked Tauri invoke result (ipc.result); a fake Tauri Window carrying __TAURI_INTERNALS__ and a plain browser Window; the file path passed to readFile.
 * @outputs Promise<OpenedFile> resolving to { path, contents, encoding } inside Tauri, or a rejected promise whose message is 'Reading files requires the desktop app.' outside it.
 * @functions none exported — describe('FileService.readFile', ...) groups four behaviours of the readFile method: faithful mapping, host-resolved path, browser rejection, and field trimming.
 * @dataflow ipc.result → mocked invoke → readFile → hand-mapped {path, contents, encoding} → assertion on the returned file and recorded ipc.calls.
 * @controlflow beforeEach resets mocks → each test sets ipc.result or selects a window → call readFile → assert result shape / host calls / rejection.
 * @version 2
 * @date 2026-09-15
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: unknown }>; result: unknown } => ({ calls: [], result: undefined }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    return ipc.result;
  },
}));

import { createFileService } from '../src/files/file-service.js';

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.result = undefined;
});

// Fake Tauri window: carries the internal marker that announces the desktop host.
const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;

// Build a fake browser window with no Tauri internals, so readFile must refuse to run.
const browserWin = {} as unknown as Window;

describe('FileService.readFile', (): void => {
  it('returns the path, contents and encoding the host reported', async (): Promise<void> => {
    ipc.result = { path: 'C:/v/a.md', contents: '# A\r\n', encoding: 'utf-16le' };
    const file = await createFileService(tauriWin).readFile('C:/v/a.md');
    // The mapped result mirrors the fields the host reported; a CRLF file's text reaches the editor with LF breaks.
    // A host that says nothing about the lock means the file is writable, not that the answer is missing.
    expect(file).toEqual({ path: 'C:/v/a.md', contents: '# A\n', encoding: 'utf-16le', readOnly: false });
    // The host command is issued once with the requested path in args.
    expect(ipc.calls).toEqual([{ cmd: 'read_text_file', args: { path: 'C:/v/a.md' } }]);
  });

  it('keeps the path the host resolved rather than the one asked for', async (): Promise<void> => {
    ipc.result = { path: 'C:/v/A.md', contents: 'x', encoding: 'utf-8' };
    const file = await createFileService(tauriWin).readFile('c:/v/a.md');
    // The host's resolved path wins over the caller-supplied one.
    expect(file.path).toBe('C:/v/A.md');
  });

  it('refuses outside the desktop app without calling the host', async (): Promise<void> => {
    await expect(createFileService(browserWin).readFile('C:/v/a.md')).rejects.toThrow('Reading files requires the desktop app.');
    // No host command is issued when there is no desktop runtime.
    expect(ipc.calls).toHaveLength(0);
  });

  it('drops fields the host adds beyond the ones it maps', async (): Promise<void> => {
    ipc.result = { path: 'p.md', contents: 'c', encoding: 'utf-8', extra: 1 };
    // Only the mapped fields survive; any host-added extras are discarded.
    expect(Object.keys(await createFileService(tauriWin).readFile('p.md')).sort()).toEqual(['contents', 'encoding', 'path', 'readOnly']);
  });

  it('asks the host to clear a file lock (FR-6.7)', async (): Promise<void> => {
    await createFileService(tauriWin).setReadOnly?.('C:/v/a.md', false);
    // The path and the wanted state both reach the host; clearing the wrong file's attribute, or setting
    // one the caller meant to clear, are the two ways this can go wrong silently.
    expect(ipc.calls).toEqual([{ cmd: 'set_file_read_only', args: { path: 'C:/v/a.md', readOnly: false } }]);
  });

  it('refuses to change a file lock outside the desktop app', async (): Promise<void> => {
    await expect(createFileService(browserWin).setReadOnly?.('C:/v/a.md', false)).rejects.toThrow(
      'Changing a file lock requires the desktop app.',
    );
    // Nothing is asked of a host that is not there, so the caller sees the refusal rather than a resolve.
    expect(ipc.calls).toHaveLength(0);
  });

  it('reports a read-only file as locked (FR-6.7)', async (): Promise<void> => {
    ipc.result = { path: 'p.md', contents: 'c', encoding: 'utf-8', readOnly: true };
    // The attribute the host read alongside the file is what decides whether the document opens locked.
    expect((await createFileService(tauriWin).readFile('p.md')).readOnly).toBe(true);
  });

  it('treats anything but a true lock as writable', async (): Promise<void> => {
    // A host that sends something other than true is not saying the file is locked; locking a document
    // the user can in fact edit is worse than missing one that is genuinely read-only.
    ipc.result = { path: 'p.md', contents: 'c', encoding: 'utf-8', readOnly: 'yes' };
    expect((await createFileService(tauriWin).readFile('p.md')).readOnly).toBe(false);
  });
});