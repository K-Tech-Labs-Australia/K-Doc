/**
 * @file file-service-line-endings.spec.ts
 * @purpose Verifies the file service gives the editor LF text for CRLF files and writes CRLF back, remembering line endings per path.
 * @inputs a fake host disk behind a mocked invoke.
 * @outputs vitest assertions.
 * @functions none.
 * @dataflow fake disk -> read -> service -> save -> fake disk.
 * @controlflow beforeEach clears the fake disk.
 * @version 1
 * @date 2026-09-15
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Disk { files: Map<string, string>; writes: Array<{ path: string; contents: string; encoding: string }>; reads: string[]; pick: string | null }

const disk = vi.hoisted((): Disk => ({ files: new Map<string, string>(), writes: [], reads: [], pick: null }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    const request = args as { path: string; contents?: string; encoding?: string };
    // The fake host serves reads from the in-memory disk and records writes onto it.
    if (cmd === 'read_text_file') {
      disk.reads.push(request.path);
      const contents = disk.files.get(request.path);
      // A path with no file behaves as the host does for a missing file.
      if (contents === undefined) {
        throw new Error(`No such file: ${request.path}`);
      } else {
        return { path: request.path, contents, encoding: 'utf-8' };
      }
    } else if (cmd === 'pick_open_file') {
      return disk.pick;
    } else if (cmd === 'write_text_file') {
      disk.writes.push({ path: request.path, contents: request.contents ?? '', encoding: request.encoding ?? '' });
      disk.files.set(request.path, request.contents ?? '');
      return null;
    } else {
      throw new Error(`Unexpected command ${cmd}`);
    }
  },
}));

import { createFileService } from '../src/files/file-service.js';

const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;

beforeEach((): void => {
  disk.files.clear();
  disk.writes.length = 0;
  disk.reads.length = 0;
  disk.pick = null;
});

describe('line endings through the file service', (): void => {
  it('hands the editor LF text for a CRLF file and writes CRLF back', async (): Promise<void> => {
    disk.files.set('C:/v/a.md', '# A\r\n\r\ntext\r\n');
    const service = createFileService(tauriWin);
    const file = await service.readFile('C:/v/a.md');
    expect(file.contents).toBe('# A\n\ntext\n');
    expect(service.lineEndingOf?.('c:\\v\\A.md')).toBe('crlf');
    await service.saveFile({ path: 'C:/v/a.md', contents: '# A\n\nmore text\n', encoding: 'utf-8' });
    expect(disk.writes).toEqual([{ path: 'C:/v/a.md', contents: '# A\r\n\r\nmore text\r\n', encoding: 'utf-8' }]);
  });

  it('gives LF text for a CRLF file chosen in the Open dialog', async (): Promise<void> => {
    disk.files.set('C:/v/picked.md', 'p\r\nq\r\n');
    disk.pick = 'C:/v/picked.md';
    const service = createFileService(tauriWin);
    const file = await service.openFile();
    expect(file?.contents).toBe('p\nq\n');
    expect(service.lineEndingOf?.('C:/v/picked.md')).toBe('crlf');
  });

  it('reads the external-change text the same way', async (): Promise<void> => {
    disk.files.set('C:/v/b.md', 'x\r\ny\r\n');
    const service = createFileService(tauriWin);
    expect(await service.readPath('C:/v/b.md')).toBe('x\ny\n');
    expect(service.lineEndingOf?.('C:/v/b.md')).toBe('crlf');
  });

  it('keeps an LF file and a mixed file exactly as written', async (): Promise<void> => {
    disk.files.set('C:/v/lf.md', 'a\nb\n');
    disk.files.set('C:/v/mixed.md', 'a\r\nb\n');
    const service = createFileService(tauriWin);
    expect((await service.readFile('C:/v/lf.md')).contents).toBe('a\nb\n');
    expect((await service.readFile('C:/v/mixed.md')).contents).toBe('a\r\nb\n');
    await service.saveFile({ path: 'C:/v/mixed.md', contents: 'a\r\nb\nc\n', encoding: 'utf-8' });
    expect(disk.files.get('C:/v/mixed.md')).toBe('a\r\nb\nc\n');
  });

  it('checks the file on disk before saving a path it has not read', async (): Promise<void> => {
    disk.files.set('C:/v/elsewhere.md', 'old\r\n');
    const service = createFileService(tauriWin);
    await service.saveFile({ path: 'C:/v/elsewhere.md', contents: 'new\n', encoding: 'utf-8' });
    expect(disk.reads).toEqual(['C:/v/elsewhere.md']);
    expect(disk.files.get('C:/v/elsewhere.md')).toBe('new\r\n');
    await service.saveFile({ path: 'C:/v/elsewhere.md', contents: 'newer\n', encoding: 'utf-8' });
    // Remembered after the first save: no second read.
    expect(disk.reads).toEqual(['C:/v/elsewhere.md']);
    expect(disk.files.get('C:/v/elsewhere.md')).toBe('newer\r\n');
  });

  it('writes a new file with LF', async (): Promise<void> => {
    const service = createFileService(tauriWin);
    await service.saveFile({ path: 'C:/v/new.md', contents: 'fresh\n', encoding: 'utf-8' });
    expect(disk.files.get('C:/v/new.md')).toBe('fresh\n');
    expect(service.lineEndingOf?.('C:/v/new.md')).toBe('lf');
  });

  it('uses a line ending the caller names over what it remembers', async (): Promise<void> => {
    disk.files.set('C:/v/a.md', 'a\n');
    const service = createFileService(tauriWin);
    await service.readFile('C:/v/a.md');
    await service.saveFile({ path: 'C:/v/a.md', contents: 'a\n', encoding: 'utf-8', lineEnding: 'crlf' });
    expect(disk.files.get('C:/v/a.md')).toBe('a\r\n');
    expect(disk.reads).toEqual(['C:/v/a.md']);
    expect(service.lineEndingOf?.('C:/v/a.md')).toBe('crlf');
  });

  it('does not know a path it has neither read nor written', (): void => {
    expect(createFileService(tauriWin).lineEndingOf?.('C:/v/unknown.md')).toBeUndefined();
  });
});