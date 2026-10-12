// @vitest-environment jsdom

/**
 * @file window-handoff-baseline.spec.ts
 * @purpose Vitest suite verifying that a document dragged out to a new window keeps its saved-text
 *   baseline and encoding through createWindowHandoff (FR-6.8), on both the browser localStorage-parking
 *   route and the Tauri IPC route.
 * @inputs HandoffDocument payloads, fake browser windows backed by jsdom localStorage, a fake Tauri window,
 *   and a mocked @tauri-apps/api/core invoke capturing host command calls.
 * @outputs Vitest assertions verifying baseline/encoding preservation on detach and claim for both routes.
 * @functions
 *   - browserWindow: Builds a browser Window whose popups always open, backed by real jsdom localStorage.
 *   - tauriWindow: Builds a fake Tauri Window carrying __TAURI_INTERNALS__ so the IPC route is selected.
 *   - parkedKey: Returns the first localStorage key parked under HANDOFF_KEY_PREFIX or throws when none exist.
 * @dataflow HandoffDocument -> detach() -> localStorage setItem / Tauri invoke -> claim() -> restored document with baseline and encoding -> Vitest assertions.
 * @controlflow Clear storage and IPC calls in beforeEach -> run browser-route tests -> run desktop-route tests, resetting state between each.
 * @version 1
 * @date 2026-09-14
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: unknown }>; result: unknown } => ({ calls: [], result: undefined }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    return ipc.result;
  },
}));

import { createWindowHandoff, HANDOFF_KEY_PREFIX, HANDOFF_PARAM, type HandoffDocument } from '../src/files/window-handoff.js';

/**
 * A browser Window whose popups always open, backed by the real jsdom localStorage.
 *
 * @purpose Provides a browser handoff context that never blocks window.open so detach succeeds deterministically.
 * @inputs search - URL search string to expose on win.location.search for claim() to read.
 * @outputs Window - A fake Window with localStorage, location, and an open method returning a dummy window.
 * @dataflow search -> constructed Window fake with real jsdom storage -> returned to the handoff factory.
 * @controlflow Build location object from search -> define open as a non-null-returning stub -> return the fake Window.
 */
function browserWindow(search: string): Window {
  return {
    localStorage: window.localStorage,
    location: { search },
    open: (): Window => ({} as unknown as Window),
  } as unknown as Window;
}

/**
 * A fake Tauri desktop Window carrying the __TAURI_INTERNALS__ runtime marker.
 *
 * @purpose Forces createWindowHandoff down the Tauri IPC route instead of the browser localStorage fallback.
 * @inputs None.
 * @outputs Window - A fake Window object with an empty __TAURI_INTERNALS__ property set.
 * @dataflow Empty internals marker -> constructed Window fake -> returned to the handoff factory.
 * @controlflow Assign __TAURI_INTERNALS__ -> return the fake Window.
 */
function tauriWindow(): Window {
  return { __TAURI_INTERNALS__: {} } as unknown as Window;
}

/**
 * The first localStorage key parked under HANDOFF_KEY_PREFIX, or an error when none exist.
 *
 * @purpose Locates the handoff key a browser detach parked so a claim can be constructed against it.
 * @inputs None.
 * @outputs string - The first matching parked key.
 * @dataflow window.localStorage keys -> prefix filter -> first matching key or throw.
 * @controlflow Scan every localStorage entry by index -> return the first that matches the prefix -> throw when none match.
 */
function parkedKey(): string {
  let found: string | null = null;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    // Check if the entry exists and begins with the handoff prefix.
    if (key !== null && key.startsWith(HANDOFF_KEY_PREFIX)) {
      // Branch: A parked handoff key was found; record it for return.
      found = key;
    } else {
      // Branch: Entry is absent or unrelated; keep scanning without recording.
    }
  }

  // Check whether any parked key was discovered during the scan.
  if (found !== null) {
    // Branch: A parked key exists; return it to the caller.
    return found;
  } else {
    // Branch: Nothing was parked; signal the missing key with an error.
    throw new Error('nothing parked');
  }
}

/** The baseline-bearing document detached in these tests, carrying saved text and a non-UTF-8 encoding. */
const EDITED: HandoffDocument = { text: '# Edited\n', path: 'C:/notes/a.md', savedText: '# Saved\n', encoding: 'utf-16le' };

beforeEach((): void => {
  // Reset storage and the captured IPC log so each test starts from a clean slate.
  window.localStorage.clear();
  ipc.calls.length = 0;
  ipc.result = undefined;
});

describe('the browser handoff carries the baseline', (): void => {
  it('hands over the saved text and encoding with the document', async (): Promise<void> => {
    // A detached document parks its full payload so the new window can restore both baseline and encoding.
    expect(await createWindowHandoff(browserWindow('')).detach(EDITED)).toBe(true);
    const key = parkedKey();
    const claimed = await createWindowHandoff(browserWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`)).claim();
    expect(claimed).toEqual(EDITED);
  });

  it('hands over a clean document without inventing a baseline', async (): Promise<void> => {
    // A document with no saved text must not gain a fabricated baseline on the way through.
    await createWindowHandoff(browserWindow('')).detach({ text: '# Clean\n', path: null });
    const key = parkedKey();
    const claimed = await createWindowHandoff(browserWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`)).claim();
    expect(claimed).toEqual({ text: '# Clean\n', path: null });
    expect(claimed).not.toHaveProperty('savedText');
    expect(claimed).not.toHaveProperty('encoding');
  });

  it('still claims a document parked by an older version', async (): Promise<void> => {
    // An entry written without baseline or encoding keys must still be claimable on the browser route.
    window.localStorage.setItem(`${HANDOFF_KEY_PREFIX}old`, JSON.stringify({ text: '# Old\n', path: 'C:/o.md' }));
    const claimed = await createWindowHandoff(browserWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(`${HANDOFF_KEY_PREFIX}old`)}`)).claim();
    expect(claimed).toEqual({ text: '# Old\n', path: 'C:/o.md' });
  });

  it('refuses a baseline or encoding of the wrong type', async (): Promise<void> => {
    // A numeric savedText or encoding is malformed and must be rejected rather than trusted on either field.
    window.localStorage.setItem(`${HANDOFF_KEY_PREFIX}bad1`, JSON.stringify({ text: 'x', path: null, savedText: 5 }));
    const badBaseline = await createWindowHandoff(browserWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(`${HANDOFF_KEY_PREFIX}bad1`)}`)).claim();
    expect(badBaseline).toBeNull();

    window.localStorage.setItem(`${HANDOFF_KEY_PREFIX}bad2`, JSON.stringify({ text: 'x', path: null, encoding: 7 }));
    const badEncoding = await createWindowHandoff(browserWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(`${HANDOFF_KEY_PREFIX}bad2`)}`)).claim();
    expect(badEncoding).toBeNull();
  });
});

describe('the desktop handoff carries the baseline', (): void => {
  it('sends the saved text and encoding to the host', async (): Promise<void> => {
    // Detaching on the Tauri route forwards the full payload, including baseline and encoding, to the host.
    await createWindowHandoff(tauriWindow()).detach(EDITED);
    expect(ipc.calls).toEqual([{ cmd: 'open_document_window', args: { text: '# Edited\n', path: 'C:/notes/a.md', savedText: '# Saved\n', encoding: 'utf-16le' } }]);
  });

  it('sends null for a clean document', async (): Promise<void> => {
    // A document without a baseline sends explicit nulls so the host always receives the same shape.
    await createWindowHandoff(tauriWindow()).detach({ text: 'x', path: null });
    expect(ipc.calls[0]?.args).toEqual({ text: 'x', path: null, savedText: null, encoding: null });
  });

  it('claims the baseline and encoding the host parked', async (): Promise<void> => {
    // The host returns the full payload and the window claims it back through take_handoff_document.
    ipc.result = { text: '# Edited\n', path: 'C:/notes/a.md', savedText: '# Saved\n', encoding: 'utf-16le' };
    expect(await createWindowHandoff(tauriWindow()).claim()).toEqual(EDITED);
    expect(ipc.calls[0]?.cmd).toBe('take_handoff_document');
  });

  it('drops the nulls the host sends for a clean document', async (): Promise<void> => {
    // Null baseline and encoding from the host are stripped so a clean document stays clean.
    ipc.result = { text: 'x', path: null, savedText: null, encoding: null };
    const claimed = await createWindowHandoff(tauriWindow()).claim();
    expect(claimed).toEqual({ text: 'x', path: null });
    expect(claimed).not.toHaveProperty('savedText');
  });

  it('refuses a host payload whose baseline has the wrong type', async (): Promise<void> => {
    // A numeric baseline from the host is malformed and must be rejected rather than surfaced.
    ipc.result = { text: 'x', path: null, savedText: 3, encoding: null };
    expect(await createWindowHandoff(tauriWindow()).claim()).toBeNull();
  });
});
