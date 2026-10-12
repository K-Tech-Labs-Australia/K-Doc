/**
 * @file external-links.spec.ts
 * @purpose Tests the external link opener: host command inside Tauri, window.open outside it (FR-8.13).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: unknown }>; reject: unknown } => ({ calls: [], reject: undefined }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    // Reject when the test asked the host to refuse.
    if (ipc.reject !== undefined) {
      throw ipc.reject;
    } else {
      // Accept: the host opened it.
      return undefined;
    }
  },
}));

import { createExternalOpener } from '../src/files/external-links.js';

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.reject = undefined;
});

// Fake Tauri window: carries the internal marker and a spy for window.open.
const tauriWin = { __TAURI_INTERNALS__: {}, open: vi.fn() } as unknown as Window;

// Build a fake browser window whose open is the given spy.
const browserWin = (openSpy: ReturnType<typeof vi.fn>): Window => ({ open: openSpy }) as unknown as Window;

// Recover the mock from a cast Window so assertions stay strict-safe.
const asMock = (w: Window): ReturnType<typeof vi.fn> => w.open as unknown as ReturnType<typeof vi.fn>;

describe('external link opener', (): void => {
  it('opens via host command inside Tauri', async (): Promise<void> => {
    const opener = createExternalOpener(tauriWin);
    // Inside Tauri the opener reports itself available.
    expect(opener.available).toBe(true);
    await opener.open('https://example.com');
    // The host command is issued exactly once with the URL in args.
    expect(ipc.calls).toEqual([{ cmd: 'open_external_url', args: { url: 'https://example.com' } }]);
    // window.open must never be used inside Tauri.
    expect(asMock(tauriWin)).not.toHaveBeenCalled();
  });

  it('propagates a host string rejection as an Error message', async (): Promise<void> => {
    const message = "Cannot open 'javascript:x': only http, https and mailto links may be opened";
    ipc.reject = message;
    const opener = createExternalOpener(tauriWin);
    // Tauri rejects commands with the Rust side's string; surface it in an Error.
    let caught: unknown;
    try {
      await opener.open('https://example.com');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(message);
  });

  it('propagates a host Error rejection as-is', async (): Promise<void> => {
    ipc.reject = new Error('boom');
    const opener = createExternalOpener(tauriWin);
    let caught: unknown;
    try {
      await opener.open('https://example.com');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });

  it('opens via window.open outside Tauri', async (): Promise<void> => {
    const openSpy = vi.fn();
    const opener = createExternalOpener(browserWin(openSpy));
    // Outside Tauri the opener is not available.
    expect(opener.available).toBe(false);
    await opener.open('https://example.com');
    // window.open is called once with the blank target and security features.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    // No host command is issued outside Tauri.
    expect(ipc.calls).toHaveLength(0);
  });

  it('resolves when window.open returns null outside Tauri', async (): Promise<void> => {
    const openSpy = vi.fn(() => null);
    const opener = createExternalOpener(browserWin(openSpy));
    // window.open returns null with noopener; the promise must still resolve.
    await expect(opener.open('https://example.com')).resolves.toBeUndefined();
  });
});
