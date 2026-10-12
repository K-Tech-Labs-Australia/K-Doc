/**
 * @file export-themes.spec.ts
 * @purpose Covers which stylesheet an export is written with (FR-13.8): the themes offered by K-Doc and then by the reader, deduplicating a reader theme that shares a name with a shipped one, resolving a theme's CSS to its bundled or reader stylesheet, falling back to the default when a theme cannot be read or does not exist, requesting the export-theme folder seeded with the default stylesheet, and refusing to open that folder outside the desktop app.
 * @inputs An `ipc` mock capturing Tauri invoke calls plus fixtures of a tauri window (with `__TAURI_INTERNALS__`) and a browser window.
 * @outputs Assertions over createExportThemes names / css / openFolder behaviour against mocked IPC.
 * @functions ipc - hoisted recorder of every invoke call and its registered command handlers.
 * @dataflow ipc mock -> createExportThemes -> names / css / openFolder -> assertions over results and issued commands.
 * @controlflow Single describe block; each it registers IPC handlers, then asserts on the returned values, the CSS payload, and the command sequence.
 * @version 2
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

import { EXPORT_THEMES } from '@k-doc/core';
import { createThemeFiles, type ThemeFiles } from '../src/files/theme-files.js';

// Every test here is about the export stylesheets, which are the themes K-Doc ships plus the reader's own.
function createExportThemes(win: Window): ThemeFiles {
  return createThemeFiles(win, 'export', EXPORT_THEMES, EXPORT_THEMES['default'] ?? '');
}

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.handlers = {};
});

const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;
const browserWin = {} as unknown as Window;

describe('export themes', () => {
  // Guards offering the themes K-Doc ships, then any theme of the reader's own.
  it('offers the themes K-Doc ships, then the reader own', async () => {
    ipc.handlers.theme_names = (): string[] => ['house style'];
    expect(await createExportThemes(tauriWin).names()).toEqual(['default', 'serif', 'compact', 'plain', 'house style']);
  });

  // Guards offering only what K-Doc ships outside the desktop app, issuing no IPC.
  it('offers only what K-Doc ships outside the desktop app', async () => {
    expect(await createExportThemes(browserWin).names()).toEqual(['default', 'serif', 'compact', 'plain']);
    expect(ipc.calls).toEqual([]);
  });

  // Guards treating a folder it cannot read as contributing no themes of its own.
  it('lists a folder it cannot read as no themes of its own', async () => {
    ipc.handlers.theme_names = (): string[] => {
      throw new Error('no folder');
    };
    expect(await createExportThemes(tauriWin).names()).toEqual(['default', 'serif', 'compact', 'plain']);
  });

  // Guards not listing a reader theme twice when it shares a name with one of K-Doc's own.
  it('does not list a reader theme twice when it shares a name with one of K-Doc own', async () => {
    ipc.handlers.theme_names = (): string[] => ['serif'];
    expect(await createExportThemes(tauriWin).names()).toEqual(['default', 'serif', 'compact', 'plain']);
  });

  // Guards resolving a theme K-Doc ships to its bundled stylesheet, and an unknown name to empty CSS.
  it('gives a theme K-Doc ships as its stylesheet', async () => {
    ipc.handlers.theme_names = (): string[] => [];
    expect(await createExportThemes(tauriWin).css('serif')).toBe(EXPORT_THEMES.serif);
    expect(await createExportThemes(tauriWin).css('plain')).toBe('');
  });

  // Guards serving a reader's own CSS for a theme that shares a name with one of K-Doc's shipped themes.
  it('gives a reader theme in place of one of the same name', async () => {
    ipc.handlers.theme_names = (): string[] => ['serif'];
    ipc.handlers.theme_css = (): string => 'body { color: red }';
    expect(await createExportThemes(tauriWin).css('serif')).toBe('body { color: red }');
    expect(ipc.calls.some((call) => call.cmd === 'theme_css' && call.args.kind === 'export' && call.args.name === 'serif')).toBe(true);
  });

  // Guards falling back to the default stylesheet when a reader theme cannot be read.
  it('falls back to the default when a theme cannot be read', async () => {
    ipc.handlers.theme_names = (): string[] => ['broken'];
    ipc.handlers.theme_css = (): string => {
      throw new Error('unreadable');
    };
    expect(await createExportThemes(tauriWin).css('broken')).toBe(EXPORT_THEMES.default);
  });

  // Guards falling back to the default for a name that has no theme at all.
  it('falls back to the default for a theme that does not exist', async () => {
    ipc.handlers.theme_names = (): string[] => [];
    expect(await createExportThemes(tauriWin).css('nothing by this name')).toBe(EXPORT_THEMES.default);
  });

  // Guards requesting the export-theme folder seeded with the default stylesheet, verifying the starter arg.
  it('asks for the folder with the default stylesheet to start from', async () => {
    ipc.handlers.theme_folder = (): string => 'C:/data/export-themes';
    expect(await createExportThemes(tauriWin).openFolder(EXPORT_THEMES['default'] ?? '')).toBe('C:/data/export-themes');
    expect(ipc.calls.find((call) => call.cmd === 'theme_folder')?.args).toEqual({ kind: 'export', starter: EXPORT_THEMES.default });
  });

  // Guards refusing to open an export-theme folder outside the desktop app.
  it('refuses to open a folder outside the desktop app', async () => {
    await expect(createExportThemes(browserWin).openFolder(EXPORT_THEMES['default'] ?? '')).rejects.toThrow('Editing themes requires the desktop app.');
  });
});
