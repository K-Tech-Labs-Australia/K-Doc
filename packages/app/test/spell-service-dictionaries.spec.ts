/**
 * @file spell-service-dictionaries.spec.ts
 * @purpose Covers the spell service's dictionary discovery and download behaviour (FR-12.3): switching to an already-loaded dictionary, loading a bundled dictionary, falling back to a downloaded copy, reporting when no dictionary exists, surfacing switch/read failures, downloading under a primary language, reporting unpublished languages, stopping on server errors, naming failed files, refusing engine-rejected downloads, and refusing downloads outside the desktop app.
 * @inputs An `ipc` mock capturing Tauri invoke calls, a `server()` helper serving dictionary files from an in-memory map, plus fixtures of served aff/dic content for bundled and remote dictionaries.
 * @outputs Assertions over loadDictionary / downloadDictionary behaviour against mocked IPC and fetch.
 * @functions server - serves dictionary files from a record and records requested URLs.
 *   - service - builds a SpellService wired to the mocked IPC and fetch, returning it alongside requested URLs and captured errors.
 *   - commands - lists the invoke command names issued in order.
 * @dataflow server() + ipc mock -> createSpellService -> loadDictionary / downloadDictionary -> assertions.
 * @controlflow Two describe blocks (loadDictionary, downloadDictionary); each it configures IPC handlers and served files, then asserts on results, commands, and errors.
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

import { createSpellService, DICTIONARY_SOURCE_URL, type SpellService } from '../src/spell/spell-service.js';

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.handlers = {};
});

const storage = { getItem: (): string | null => null, setItem: (): void => {} };
const tauriWin = { __TAURI_INTERNALS__: {}, localStorage: storage } as unknown as Window;
const browserWin = { localStorage: storage } as unknown as Window;

interface Served { readonly status: number; readonly body?: string }

function server(files: Record<string, Served>): { readonly fetchImpl: (url: string) => Promise<Response>; readonly requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    fetchImpl: async (url: string): Promise<Response> => {
      requested.push(url);
      const file = files[url];
      return file === undefined ? new Response('', { status: 404 }) : new Response(file.body ?? '', { status: file.status });
    },
  };
}

function service(files: Record<string, Served>, win: Window = tauriWin): { readonly spell: SpellService; readonly requested: string[]; readonly errors: Error[] } {
  const errors: Error[] = [];
  const served = server(files);
  const spell = createSpellService({ win, fetchImpl: served.fetchImpl, onError: (error: Error): void => { errors.push(error); } });
  return { spell, requested: served.requested, errors };
}

function commands(): string[] {
  return ipc.calls.map((call) => call.cmd);
}

describe('loadDictionary', () => {
  // Guards switching to a dictionary loaded earlier without fetching it.
  it('switches to a dictionary loaded earlier without fetching it', async () => {
    ipc.handlers.spell_select = (): boolean => true;
    const { spell, requested } = service({});
    expect(await spell.loadDictionary('fr')).toBe(true);
    expect(spell.loaded).toBe(true);
    expect(requested).toEqual([]);
    expect(commands()).toEqual(['spell_select']);
  });

  // Guards loading the bundled dictionary from served files and naming its language.
  it('loads the bundled dictionary and names its language', async () => {
    ipc.handlers.spell_select = (): boolean => false;
    ipc.handlers.spell_load = (): number => 0;
    const { spell } = service({ 'dictionaries/en-GB/index.aff': { status: 200, body: 'SET UTF-8' }, 'dictionaries/en-GB/index.dic': { status: 200, body: '1\nhello' } });
    expect(await spell.loadDictionary('en-GB')).toBe(true);
    expect(ipc.calls.find((call) => call.cmd === 'spell_load')?.args).toEqual({ language: 'en-GB', aff: 'SET UTF-8', dic: '1\nhello' });
    expect(commands().at(-1)).toBe('spell_set_user_words');
  });

  // Guards treating HTML served in place of a missing bundled file as no bundled dictionary, then using the downloaded copy.
  it('treats a page served in place of a missing file as no bundled dictionary, then uses the downloaded copy', async () => {
    ipc.handlers.spell_select = (): boolean => false;
    ipc.handlers.spell_load_cached = (): boolean => true;
    const { spell } = service({ 'dictionaries/fr/index.aff': { status: 200, body: '<!doctype html>' }, 'dictionaries/fr/index.dic': { status: 200, body: '<!doctype html>' } });
    expect(await spell.loadDictionary('fr')).toBe(true);
    expect(commands()).not.toContain('spell_load');
    expect(ipc.calls.find((call) => call.cmd === 'spell_load_cached')?.args).toEqual({ language: 'fr' });
    expect(commands().at(-1)).toBe('spell_set_user_words');
  });

  // Guards reporting no dictionary when none is bundled or downloaded, issuing no user-word command.
  it('reports no dictionary when none is bundled or downloaded', async () => {
    ipc.handlers.spell_select = (): boolean => false;
    ipc.handlers.spell_load_cached = (): boolean => false;
    const { spell, errors } = service({});
    expect(await spell.loadDictionary('de')).toBe(false);
    expect(spell.loaded).toBe(false);
    expect(commands()).not.toContain('spell_set_user_words');
    expect(errors).toEqual([]);
  });

  // Guards surfacing a switch failure as an error with no dictionary loaded.
  it('reports a failure to switch as an error and no dictionary', async () => {
    ipc.handlers.spell_select = (): boolean => {
      throw new Error('boom');
    };
    const { spell, errors } = service({});
    expect(await spell.loadDictionary('de')).toBe(false);
    expect(errors.map((error) => error.message)).toEqual(['boom']);
  });

  // Guards surfacing a cached-read failure as an error with no dictionary loaded.
  it('reports a failure to read the downloaded copy as an error and no dictionary', async () => {
    ipc.handlers.spell_select = (): boolean => false;
    ipc.handlers.spell_load_cached = (): boolean => {
      throw new Error('unreadable');
    };
    const { spell, errors } = service({});
    expect(await spell.loadDictionary('de')).toBe(false);
    expect(spell.loaded).toBe(false);
    expect(errors.map((error) => error.message)).toEqual(['unreadable']);
  });
});

describe('downloadDictionary', () => {
  // Guards downloading under the primary language when only that variant is published, verifying requested URLs and install args.
  it('downloads a dictionary under its primary language when the full tag is not published', async () => {
    ipc.handlers.spell_install_dictionary = (): number => 0;
    const { spell, requested } = service({ [`${DICTIONARY_SOURCE_URL}/fr/index.aff`]: { status: 200, body: 'SET UTF-8' }, [`${DICTIONARY_SOURCE_URL}/fr/index.dic`]: { status: 200, body: '1\npomme' } });
    expect(await spell.downloadDictionary('fr-FR')).toBe('fr');
    expect(requested.slice(0, 2)).toEqual([`${DICTIONARY_SOURCE_URL}/fr-FR/index.aff`, `${DICTIONARY_SOURCE_URL}/fr-FR/index.dic`]);
    expect(ipc.calls.find((call) => call.cmd === 'spell_install_dictionary')?.args).toEqual({ language: 'fr', aff: 'SET UTF-8', dic: '1\npomme' });
    expect(spell.loaded).toBe(true);
    expect(commands().at(-1)).toBe('spell_set_user_words');
  });

  // Guards a name with only one of its two files published counting as not published, so the next name is tried.
  it('moves on from a name that publishes only half a dictionary', async () => {
    ipc.handlers.spell_install_dictionary = (): number => 0;
    const { spell } = service({ [`${DICTIONARY_SOURCE_URL}/fr-FR/index.dic`]: { status: 200, body: '1\npomme' }, [`${DICTIONARY_SOURCE_URL}/fr/index.aff`]: { status: 200, body: 'SET UTF-8' }, [`${DICTIONARY_SOURCE_URL}/fr/index.dic`]: { status: 200, body: '1\npomme' } });
    expect(await spell.downloadDictionary('fr-FR')).toBe('fr');
  });

  // Guards rejecting with an unpublished-language error and issuing no commands when nothing is published.
  it('says when no dictionary is published for the language', async () => {
    const { spell } = service({});
    await expect(spell.downloadDictionary('tlh')).rejects.toThrow('github.com/wooorm/dictionaries has no dictionary for tlh.');
    expect(commands()).toEqual([]);
  });

  // Guards stopping at a server error instead of trying another language variant.
  it('stops at a server error instead of trying another name', async () => {
    const { spell, requested } = service({ [`${DICTIONARY_SOURCE_URL}/fr-FR/index.aff`]: { status: 500 }, [`${DICTIONARY_SOURCE_URL}/fr-FR/index.dic`]: { status: 200, body: '1\npomme' } });
    await expect(spell.downloadDictionary('fr-FR')).rejects.toThrow('The download failed: HTTP 500.');
    expect(requested).toHaveLength(2);
  });

  // Guards naming the word list in the failure message when it is the file that failed.
  it('names the word list when it is the file that failed', async () => {
    const { spell } = service({ [`${DICTIONARY_SOURCE_URL}/fr/index.aff`]: { status: 200, body: 'SET UTF-8' }, [`${DICTIONARY_SOURCE_URL}/fr/index.dic`]: { status: 503 } });
    await expect(spell.downloadDictionary('fr')).rejects.toThrow('The download failed: HTTP 503.');
  });

  // Guards not counting a download the spell engine refuses as a dictionary.
  it('does not count a download the spell engine refuses as a dictionary', async () => {
    ipc.handlers.spell_install_dictionary = (): number => {
      throw new Error('Dictionary parse error: bad');
    };
    const { spell } = service({ [`${DICTIONARY_SOURCE_URL}/fr/index.aff`]: { status: 200, body: 'SET UTF-8' }, [`${DICTIONARY_SOURCE_URL}/fr/index.dic`]: { status: 200, body: 'nonsense' } });
    await expect(spell.downloadDictionary('fr')).rejects.toThrow('Dictionary parse error: bad');
    expect(spell.loaded).toBe(false);
  });

  // Guards refusing to download outside the desktop app and issuing no requests.
  it('refuses to download outside the desktop app', async () => {
    const { spell, requested } = service({}, browserWin);
    await expect(spell.downloadDictionary('fr')).rejects.toThrow('Downloading dictionaries requires the desktop app.');
    expect(requested).toEqual([]);
  });
});
