/**
 * @file app-themes.spec.ts
 * @purpose Covers FR-14.10: the reader's themes for the app itself (the themes offered by the reader, resolved to their CSS, opened in a folder seeded with the contract starter, and watched for changes), plus the contract they are written against (the change event name, every colour token used for light and dark, and how a theme is reloaded).
 * @inputs An `ipc` mock capturing Tauri invoke calls and event listeners plus fixtures of a tauri window (with `__TAURI_INTERNALS__`) and a browser window.
 * @outputs Assertions over createThemeFiles names / css / openFolder / watch behaviour against mocked IPC, and assertions over appThemeStarter and THEME_CHANGED_EVENT.
 * @functions ipc - hoisted recorder of every invoke call, its registered command handlers, event listeners, and unlistens.
 * @dataflow ipc mock -> createThemeFiles -> names / css / openFolder / watch -> assertions over results and issued commands; appThemeStarter and THEME_CHANGED_EVENT asserted directly.
 * @controlflow Two describe blocks; each it registers IPC handlers, then asserts on the returned values, the CSS payload, the command sequence, and event delivery.
 * @version 1
 * @date 2026-09-18
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (args: Record<string, unknown>) => unknown;
const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: Record<string, unknown> }>; handlers: Record<string, Handler>; listeners: Array<(payload: string) => void>; unlistened: number } => ({ calls: [], handlers: {}, listeners: [], unlistened: 0 }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    const handler = ipc.handlers[cmd];
    return handler === undefined ? undefined : handler(args);
  },
}));

vi.mock('@tauri-apps/api/event', (): { listen: (name: string, handler: (event: { payload: string }) => void) => Promise<() => void> } => ({
  listen: async (_name: string, handler: (event: { payload: string }) => void): Promise<() => void> => {
    const deliver = (payload: string): void => {
      handler({ payload });
    };
    ipc.listeners.push(deliver);
    return (): void => {
      ipc.unlistened += 1;
    };
  },
}));

import { createThemeFiles, THEME_CHANGED_EVENT } from '../src/files/theme-files.js';
import { appThemeStarter } from '../src/shell/theme.js';

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.handlers = {};
  ipc.listeners.length = 0;
  ipc.unlistened = 0;
});

const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;
const browserWin = {} as unknown as Window;
const appThemes = (win: Window = tauriWin) => createThemeFiles(win, 'app', {}, '');

describe('the app themes a reader writes', () => {
  // Guards offering only what is in the folder, since K-Doc ships none of its own.
  it('offers only what is in the folder, since K-Doc ships none of its own', async () => {
    ipc.handlers.theme_names = (): string[] => ['midnight', 'paper'];
    expect(await appThemes().names()).toEqual(['midnight', 'paper']);
    expect(ipc.calls[0]?.args).toEqual({ kind: 'app' });
  });

  // Guards giving a theme as the reader wrote it.
  it('gives a theme as the reader wrote it', async () => {
    ipc.handlers.theme_names = (): string[] => ['midnight'];
    ipc.handlers.theme_css = (): string => ':root { --kdoc-color-background: #000 }';
    expect(await appThemes().css('midnight')).toBe(':root { --kdoc-color-background: #000 }');
  });

  // Guards giving nothing at all for a theme that is not there, so the app keeps its own colours.
  it('gives nothing at all for a theme that is not there, so the app keeps its own colours', async () => {
    ipc.handlers.theme_names = (): string[] => [];
    expect(await appThemes().css('gone')).toBe('');
  });

  // Guards asking for the folder with the contract as a starter.
  it('asks for the folder with the contract as a starter', async () => {
    ipc.handlers.theme_folder = (): string => 'C:/data/themes';
    expect(await appThemes().openFolder(appThemeStarter())).toBe('C:/data/themes');
    const args = ipc.calls.find((call) => call.cmd === 'theme_folder')?.args ?? {};
    expect(args.kind).toBe('app');
    expect(String(args.starter)).toContain('--kdoc-color-background');
  });

  // Guards reporting a theme file changing, and stopping when told to.
  it('reports a theme file changing, and stops when told to', async () => {
    let changes = 0;
    const stop = await appThemes().watch((): void => {
      changes += 1;
    });
    expect(ipc.calls.some((call) => call.cmd === 'theme_watch' && call.args.kind === 'app')).toBe(true);
    ipc.listeners.forEach((deliver) => deliver('app'));
    expect(changes).toBe(1);
    // A change to the export themes is not this watcher's business.
    ipc.listeners.forEach((deliver) => deliver('export'));
    expect(changes).toBe(1);
    stop();
    expect(ipc.unlistened).toBe(1);
    expect(ipc.calls.some((call) => call.cmd === 'theme_unwatch')).toBe(true);
  });

  // Guards watching nothing outside the desktop app.
  it('watches nothing outside the desktop app', async () => {
    let changes = 0;
    const stop = await appThemes(browserWin).watch((): void => {
      changes += 1;
    });
    stop();
    expect(ipc.calls).toEqual([]);
    expect(changes).toBe(0);
  });
});

describe('the contract a theme is written against', () => {
  // Guards naming the event the app listens for.
  it('names the event the app listens for', () => {
    expect(THEME_CHANGED_EVENT).toBe('kdoc://theme-changed');
  });

  // Guards setting every colour K-Doc paints with, once in the light block and once in the dark block.
  it('sets every colour K-Doc paints with, for light and for dark', async () => {
    const starter = appThemeStarter();
    expect(starter).toContain(':root {');
    expect(starter).toContain(':root[data-kdoc-theme="dark"] {');
    for (const token of ['--kdoc-color-background', '--kdoc-color-text', '--kdoc-color-accent', '--kdoc-color-border', '--kdoc-color-danger', '--kdoc-color-code-background']) {
      // With the colon, so a token that is the start of another name is not counted twice.
      expect(starter.split(token + ':').length - 1).toBe(2);
    }
  });

  // Guards stating what a theme is and how it is reloaded.
  it('says what a theme is and how it is reloaded', () => {
    expect(appThemeStarter()).toContain('reloaded as soon as you save it');
  });
});
