/**
 * @file pandoc-export.spec.ts
 * @purpose Covers FR-13.7: whether Pandoc is reachable and what version it reports, how export requests are forwarded to the Tauri host, that refusal happens outside the desktop app, and how a save-dialog file name is derived from a document path plus format.
 * @inputs An `ipc` mock capturing every Tauri invoke call plus command handlers, fixtures of a tauri window (with `__TAURI_INTERNALS__`) and a browser window, and the Pandoc export helpers under test.
 * @outputs Assertions over createPandocExport version / write against mocked IPC, assertions over pandocFileName path derivation, and assertions over PANDOC_FORMAT_NAMES and PANDOC_FORMAT_EXTENSIONS.
 * @functions ipc - hoisted recorder of every invoke call and its registered command handlers.
 * @dataflow ipc mock -> createPandocExport -> version / write -> assertions over results and issued commands; documentPath + format asserted directly through pandocFileName.
 * @controlflow Three describe blocks; each it registers IPC handlers, then awaits the result and asserts on the returned value or the recorded invoke args.
 * @version 1
 * @date 2026-09-18
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (args: Record<string, unknown>) => unknown;
const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: Record<string, unknown> }>; handlers: Record<string, Handler> } => ({ calls: [], handlers: {} }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    const handler = ipc.handlers[cmd];
    return handler === undefined ? undefined : handler(args);
  },
}));

import { createPandocExport, pandocFileName, PANDOC_FORMAT_EXTENSIONS, PANDOC_FORMAT_NAMES } from '../src/files/pandoc-export.js';

beforeEach((): void => {
  // Clear the recorded calls and registered handlers between tests.
  ipc.calls.length = 0;
  ipc.handlers = {};
});

const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;
const browserWin = {} as unknown as Window;

describe('asking whether Pandoc is there', () => {
  // Guards reporting the banner line the host returns when Pandoc is present.
  it('is answered with the version it reports', async () => {
    ipc.handlers['pandoc_version'] = (): string => 'pandoc 3.1.11';
    expect(await createPandocExport(tauriWin).version()).toBe('pandoc 3.1.11');
  });

  // Guards reporting an empty version when the host says Pandoc is absent.
  it('is answered with nothing when it is not installed', async () => {
    ipc.handlers['pandoc_version'] = (): string => '';
    expect(await createPandocExport(tauriWin).version()).toBe('');
  });

  // Guards collapsing a host refusal into an empty version rather than throwing.
  it('never throws when the host refuses', async () => {
    ipc.handlers['pandoc_version'] = (): string => { throw new Error('no'); };
    expect(await createPandocExport(tauriWin).version()).toBe('');
  });

  // Guards reporting an empty version outside the desktop app without ever calling the host.
  it('is answered with nothing outside the desktop app', async () => {
    expect(await createPandocExport(browserWin).version()).toBe('');
    expect(ipc.calls.length).toBe(0);
  });
});

describe('exporting through Pandoc', () => {
  // Guards forwarding markdown, format and path to the host export command.
  it('hands the host the document, the format and the path', async () => {
    ipc.handlers['pandoc_export'] = (): void => undefined;
    await createPandocExport(tauriWin).write('# Hi\n', 'latex', 'C:/out/doc.tex');
    expect(ipc.calls[0]?.args).toEqual({ markdown: '# Hi\n', format: 'latex', path: 'C:/out/doc.tex' });
  });

  // Guards refusing to convert anything when there is no desktop app.
  it('cannot be done outside the desktop app', async () => {
    await expect(createPandocExport(browserWin).write('x', 'epub', 'C:/out/doc.epub')).rejects.toThrow('Exporting through Pandoc requires the desktop app.');
  });

  // Guards surfacing a host conversion failure to the caller.
  it('passes the failure on', async () => {
    ipc.handlers['pandoc_export'] = (): void => { throw new Error('pandoc: cannot write'); };
    await expect(createPandocExport(tauriWin).write('# Hi\n', 'latex', 'C:/out/doc.tex')).rejects.toThrow('pandoc: cannot write');
  });
});

describe('the file an export suggests', () => {
  // Guards keeping the document base name and swapping in the format extension.
  it('keeps the document name and takes the format extension', () => {
    expect(pandocFileName('C:/notes/report.md', 'latex')).toBe('report.tex');
    expect(pandocFileName('C:/notes/report.md', 'epub')).toBe('report.epub');
  });

  // Guards reading a Windows backslash-separated path to find the base name.
  it('reads a windows path too', () => {
    expect(pandocFileName('C:\\notes\\report.md', 'latex')).toBe('report.tex');
  });

  // Guards falling back to a plain document name when nothing has been saved yet.
  it('is a plain name for a document that has never been saved', () => {
    expect(pandocFileName('', 'epub')).toBe('document.epub');
  });

  // Guards keeping a base name that carries no extension at all.
  it('keeps a name that carries no extension', () => {
    expect(pandocFileName('C:/notes/README', 'latex')).toBe('README.tex');
  });

  // Guards exposing the two formats with their human names and extensions.
  it('names the two formats it offers', () => {
    expect(PANDOC_FORMAT_NAMES).toEqual({ latex: 'LaTeX', epub: 'EPUB' });
    expect(PANDOC_FORMAT_EXTENSIONS).toEqual({ latex: 'tex', epub: 'epub' });
  });
});
