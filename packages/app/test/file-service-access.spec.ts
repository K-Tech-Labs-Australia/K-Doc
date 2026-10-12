/**
 * @file file-service-access.spec.ts
 * @purpose Verifies that createFileService grants access only for files the user chose, prompts once on first read of an unknown path, refuses when declined, surfaces genuine read failures without prompting, and delegates picking to host pickers.
 * @inputs Mocked Tauri invoke result (host.calls / host.granted / host.answer / host.pick); a fake Tauri Window carrying __TAURI_INTERNALS__; file paths passed to readFile, openFile, chooseSavePath and chooseFolder.
 * @outputs Promise<OpenedFile> resolving for granted or newly-granted files; null from pickers when cancelled; rejected promises on decline or genuine read failure.
 * @functions none exported — describe('FileService grant-aware reads', ...) groups seven behaviours of the file service: silent read, first-read prompt, declined refusal, readPath parity, untransformed read error, host picker open, and cancelled pickers.
 * @dataflow mocked invoke → readFile/readPath/openFile/choose* → returned value and recorded host.calls → assertions.
 * @controlflow beforeEach resets mocks → each test seeds host state → call a service method → assert result shape / host calls / rejection.
 * @version 1
 * @date 2026-10-07
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared mock state: recorded commands, the set of paths already granted access, the decline flag for prompts, and the picker's chosen path.
const host = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: unknown }>,
  granted: new Set<string>(),
  answer: true,
  pick: null as string | null,
}));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  // Records every host command and returns grant-aware results so the service's prompt-and-retry flow can be exercised.
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    host.calls.push({ cmd, args });

    if (cmd === 'read_text_file') {
      const path = (args as { path: string }).path;
      // A genuine read failure must surface as-is; it is never mistaken for a missing grant and never triggers a prompt.
      if (path.endsWith('broken.md')) {
        throw new Error('Failed to read file');
      }
      // Without an explicit grant the host refuses, forcing the service to prompt before retrying the read.
      if (!host.granted.has(path)) {
        throw new Error(`ACCESS_DENIED: ${path}`);
      }
      return { path, contents: 'text\n', encoding: 'utf-8', readOnly: false };
    }

    if (cmd === 'request_file_access') {
      // The host records the grant only when it answers yes; a decline leaves the file locked for later reads.
      const path = (args as { path: string }).path;
      if (host.answer) {
        host.granted.add(path);
      }
      return host.answer;
    }

    if (cmd === 'pick_open_file' || cmd === 'pick_save_path' || cmd === 'pick_folder') {
      // Only a chosen open file is auto-granted, so the subsequent read succeeds without another prompt.
      if (host.pick !== null && cmd === 'pick_open_file') {
        host.granted.add(host.pick);
      }
      return host.pick;
    }

    throw new Error(`Unexpected command ${cmd}`);
  },
}));

import { createFileService } from '../src/files/file-service.js';

// Fake Tauri window: carries the internal marker that announces the desktop host.
const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;

beforeEach((): void => {
  // Reset recorded commands, granted paths, decline flag and picker result before each test.
  host.calls.length = 0;
  host.granted.clear();
  host.answer = true;
  host.pick = null;
});

describe('FileService grant-aware reads', (): void => {
  it('reads a granted file without asking', async (): Promise<void> => {
    // The path was already chosen, so the service should read directly with no prompt.
    host.granted.add('C:/v/a.md');
    const file = await createFileService(tauriWin).readFile('C:/v/a.md');

    expect(file.contents).toBe('text\n');
    // No request_file_access call is issued because access was already granted for this path.
    expect(host.calls.some((c) => c.cmd === 'request_file_access')).toBe(false);
  });

  it('asks once for a file the user never chose, then reads it', async (): Promise<void> => {
    const file = await createFileService(tauriWin).readFile('C:/x/b.md');

    // The first read is denied; one prompt grants access and the retry returns the contents.
    expect(file.contents).toBe('text\n');
    // The command sequence proves a single deny, one grant request, then a successful re-read.
    expect(host.calls.map((c) => c.cmd)).toEqual(['read_text_file', 'request_file_access', 'read_text_file']);
  });

  it('refuses when the user declines', async (): Promise<void> => {
    host.answer = false;

    await expect(createFileService(tauriWin).readFile('C:/x/c.md')).rejects.toThrow(
      'K-Doc was not given access to C:/x/c.md.',
    );
    // A decline ends the attempt after the first read, so no retry is issued.
    expect(host.calls.filter((c) => c.cmd === 'read_text_file')).toHaveLength(1);
  });

  it('readPath goes through the same prompt', async (): Promise<void> => {
    const text = await createFileService(tauriWin).readPath('C:/x/d.md');

    // readPath mirrors readFile: an unknown path is denied once, prompted for, then re-read.
    expect(text).toBe('text\n');
    expect(host.calls.map((c) => c.cmd)).toEqual(['read_text_file', 'request_file_access', 'read_text_file']);
  });

  it('a real read failure is not turned into a prompt', async (): Promise<void> => {
    // The path is granted, so the only way this read fails is a genuine host error rather than missing access.
    host.granted.add('C:/v/broken.md');

    await expect(createFileService(tauriWin).readFile('C:/v/broken.md')).rejects.toThrow('Failed to read file');
    // A real failure must not trigger request_file_access; the caller sees the original error unchanged.
    expect(host.calls.some((c) => c.cmd === 'request_file_access')).toBe(false);
  });

  it('Open asks the host picker and reads what was picked', async (): Promise<void> => {
    // The picker reports a chosen markdown file, which is auto-granted for the subsequent read.
    host.pick = 'C:/v/picked.md';
    const file = await createFileService(tauriWin).openFile();

    expect(file?.path).toBe('C:/v/picked.md');
    // The picker is the first host interaction and carries the markdown kind filter for this action.
    expect(host.calls[0]).toEqual({ cmd: 'pick_open_file', args: { kind: 'markdown' } });
  });

  it('a cancelled picker returns null', async (): Promise<void> => {
    // pick stays null, so every host picker resolves to null and the service reports no selection.
    expect(await createFileService(tauriWin).openFile()).toBeNull();

    const save = await createFileService(tauriWin).chooseSavePath('Untitled.md');
    expect(save).toBeNull();
    // The suggested name reaches the host as the picker's argument, not as a path to open.
    expect(
      host.calls.some(
        (c) => c.cmd === 'pick_save_path' && (c.args as { suggested: string }).suggested === 'Untitled.md',
      ),
    ).toBe(true);

    const folder = await createFileService(tauriWin).chooseFolder();
    expect(folder).toBeNull();
    // chooseFolder issues only the pick_folder command, with no path argument to resolve.
    expect(host.calls.some((c) => c.cmd === 'pick_folder')).toBe(true);
  });
});
