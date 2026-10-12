/**
 * @file path-probe.spec.ts
 * @purpose Tests createPathProbe, the probe that asks the desktop host which image files exist (FR-12.7).
 * @inputs Mocked Tauri invoke result/rejection (ipc.result / ipc.reject); a fake Tauri Window carrying __TAURI_INTERNALS__ and a plain browser Window; the path list passed to exist().
 * @outputs A PathProbe whose available reflects Tauri presence, and whose exist() resolves with per-path booleans inside the desktop app or rejects outside it.
 * @functions none exported — describe('createPathProbe', ...) groups six behaviours of the probe: availability detection, empty-question short-circuit, browser refusal, ordered host answer, rejection normalization, and malformed-answer rejection.
 * @dataflow ipc.result / ipc.reject → mocked invoke → createPathProbe().exist() → shape validation → resolved boolean[] or thrown Error; assertions on returned values and recorded ipc.calls.
 * @controlflow beforeEach resets mocks → each test sets ipc.result/reject and selects a window → call exist() → assert result shape / host calls / rejection.
 * @version 1
 * @date 2026-09-14
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: unknown }>; result: unknown; reject: unknown } => ({ calls: [], result: undefined, reject: undefined }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: unknown) => Promise<unknown> } => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    if (ipc.reject !== undefined) {
      // The host rejected the command; surface the stored rejection value to the caller.
      throw ipc.reject;
    } else {
      // No rejection queued; return the stored result to the caller.
      return ipc.result;
    }
  },
}));

import { createPathProbe } from '../src/files/path-probe.js';

beforeEach((): void => {
  ipc.calls.length = 0;
  ipc.result = undefined;
  ipc.reject = undefined;
});

// Fake Tauri window: carries the internal marker that announces the desktop host.
const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;

// Build a fake browser window with no Tauri internals, so the probe must refuse to run.
const browserWin = {} as unknown as Window;

describe('createPathProbe', (): void => {
  it('reports availability from the window', (): void => {
    // The Tauri host reports available, while a plain browser window does not.
    expect(createPathProbe(tauriWin).available).toBe(true);
    expect(createPathProbe(browserWin).available).toBe(false);
  });

  it('answers an empty question without asking the host', async (): Promise<void> => {
    // No paths means no host query, so resolve immediately with an empty list.
    await expect(createPathProbe(browserWin).exist([])).resolves.toEqual([]);
    expect(ipc.calls).toEqual([]);
  });

  it('refuses outside the desktop app', async (): Promise<void> => {
    // A browser window cannot reach the Rust host, so it rejects without calling invoke.
    await expect(createPathProbe(browserWin).exist(['C:/a.png'])).rejects.toThrow('Checking files requires the desktop app.');
    expect(ipc.calls).toEqual([]);
  });

  it('returns the host answer in order', async (): Promise<void> => {
    // The resolved booleans are returned verbatim and forwarded to the host in request order.
    ipc.result = [true, false];
    await expect(createPathProbe(tauriWin).exist(['C:/a.png', 'C:/b.png'])).resolves.toEqual([true, false]);
    expect(ipc.calls).toEqual([{ cmd: 'paths_exist', args: { paths: ['C:/a.png', 'C:/b.png'] } }]);
  });

  it('turns a host rejection into an error', async (): Promise<void> => {
    // A bare-string host rejection is normalized into an Error carrying the same message.
    ipc.reject = 'Asked about 2000 paths; the limit is 1024';
    await expect(createPathProbe(tauriWin).exist(['C:/a.png'])).rejects.toThrow('Asked about 2000 paths; the limit is 1024');
  });

  it('refuses an answer of the wrong shape', async (): Promise<void> => {
    // A non-array reply is rejected as malformed.
    ipc.result = 'yes';
    await expect(createPathProbe(tauriWin).exist(['C:/a.png'])).rejects.toThrow('The desktop app gave an unexpected answer about which files exist.');

    // A one-character string has the right length for one path, but is still not an array.
    ipc.result = 'y';
    await expect(createPathProbe(tauriWin).exist(['C:/a.png'])).rejects.toThrow('The desktop app gave an unexpected answer about which files exist.');

    // An array too short for the request is rejected as malformed.
    ipc.result = [true];
    await expect(createPathProbe(tauriWin).exist(['C:/a.png', 'C:/b.png'])).rejects.toThrow('The desktop app gave an unexpected answer about which files exist.');

    // An array with a non-boolean entry is rejected as malformed.
    ipc.result = [true, 'no'];
    await expect(createPathProbe(tauriWin).exist(['C:/a.png', 'C:/b.png'])).rejects.toThrow('The desktop app gave an unexpected answer about which files exist.');
  });
});
