// @vitest-environment jsdom
/**
 * @file image-loader.spec.ts
 * @purpose Tests mimeForPath, bytesToBase64, and createImageLoader — the loader that reads local images through the Tauri host for K-Doc display (FR-8.14) and HTML export embedding as data URIs (FR-13.1).
 * @inputs Mocked Tauri invoke result/rejection (ipc.result / ipc.reject); a fake Tauri Window carrying __TAURI_INTERNALS__ and a plain browser Window; absolute image paths handed to the loader methods.
 * @outputs MIME strings, base64 encodings, and an ImageLoader whose objectUrl()/dataUri()/clear() behave correctly inside the desktop app or refuse outside it.
 * @functions none exported — describe('mimeForPath'), describe('bytesToBase64'), and describe('createImageLoader') group extension mapping, chunked encoding, availability detection, read caching, failure retry, byte-shape normalization, URL revocation, and browser refusal.
 * @dataflow ipc.result / ipc.reject → mocked invoke → createImageLoader().objectUrl()/dataUri() → host read → Blob/object URL or base64 data URI; assertions on returned values, the created/revoked arrays, and recorded ipc.calls.
 * @controlflow beforeEach resets mocks and patches URL.createObjectURL/revokeObjectURL → each test sets ipc.result/reject and selects a window → call the loader → assert result / host calls / issued URLs.
 * @version 1
 * @date 2026-09-14
 */
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

import { bytesToBase64, createImageLoader, mimeForPath } from '../src/files/image-loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom provides no object URLs, so track every blob handed out and every URL revoked.
const created: Blob[] = [];
const revoked: string[] = [];

beforeEach((): void => {
  // Reset the mocked IPC state between tests.
  ipc.calls.length = 0;
  ipc.result = undefined;
  ipc.reject = undefined;
  // Forget blobs/URLs from previous tests so created and revoked stay isolated.
  created.length = 0;
  revoked.length = 0;
  // jsdom has no object URLs, so patch createObjectURL to record the blob and return a stable handle.
  URL.createObjectURL = vi.fn((blob: Blob): string => {
    created.push(blob);
    return `blob:${created.length}`;
  }) as unknown as typeof URL.createObjectURL;
  // Patch revokeObjectURL so clear() can be exercised without a real implementation.
  URL.revokeObjectURL = vi.fn((url: string): void => {
    revoked.push(url);
  }) as unknown as typeof URL.revokeObjectURL;
});

afterEach((): void => {
  // Restore the original URL methods and any per-test spies installed by the tests.
  vi.restoreAllMocks();
});

// Fake Tauri window: carries the internal marker that announces the desktop host.
const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;

// Build a fake browser window with no Tauri internals, so the loader must refuse to run.
const browserWin = {} as unknown as Window;

// bytes builds an ArrayBuffer from a list of byte values for use as a mocked host reply.
function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe('mimeForPath', (): void => {
  it('maps a path extension to its MIME type', (): void => {
    // Extension case is ignored and both slash styles resolve the same file's type.
    expect(mimeForPath('C:/p/a.PNG')).toBe('image/png');
    expect(mimeForPath('C:\\p\\b.jpeg')).toBe('image/jpeg');
    expect(mimeForPath('/x/c.svg')).toBe('image/svg+xml');
    expect(mimeForPath('C:/p/a.avif')).toBe('image/avif');

    // A path with no extension, or an unrecognized one, resolves to null.
    expect(mimeForPath('C:/p.dir/noext')).toBeNull();
    expect(mimeForPath('notes.md')).toBeNull();
  });
});

describe('bytesToBase64', (): void => {
  it('encodes like btoa', (): void => {
    // A short input matches the built-in encoder output byte for byte.
    expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });

  it('encodes an image larger than one chunk', async (): Promise<void> => {
    // Fill a large array with a repeating pattern that spans many BASE64_CHUNK boundaries.
    const big = new Uint8Array(100_000).map((_: number, i: number): number => i % 256);
    // Decode the assembled base64 back to a binary string and check both length and tail byte.
    const decoded = atob(bytesToBase64(big));
    expect(decoded.length).toBe(100_000);
    expect(decoded.charCodeAt(99_999)).toBe(99_999 % 256);
  });
});

describe('createImageLoader', (): void => {
  it('reads an image once and hands out an object URL of the right type', async (): Promise<void> => {
    // Serve a PNG signature so the host read resolves with four recognized bytes.
    ipc.result = bytes(137, 80, 78, 71);
    const loader = createImageLoader(tauriWin);
    const url = await loader.objectUrl('C:/p/a.png');
    expect(url).toBe('blob:1');
    expect(ipc.calls).toEqual([{ cmd: 'read_image_file', args: { path: 'C:/p/a.png' } }]);
    expect(created[0]?.type).toBe('image/png');
    expect(created[0]?.size).toBe(4);

    // A second read of the same path is served from cache without another host call.
    expect(await loader.objectUrl('C:/p/a.png')).toBe('blob:1');
    expect(ipc.calls).toHaveLength(1);
  });

  it('forgets a failed read so it can be tried again', async (): Promise<void> => {
    // Queue a host rejection for the first attempt to simulate a missing file.
    ipc.reject = "Cannot read 'C:/p/gone.png'";
    const loader = createImageLoader(tauriWin);
    await expect(loader.objectUrl('C:/p/gone.png')).rejects.toThrow("Cannot read 'C:/p/gone.png'");

    // Clear the rejection and serve a byte so the retried read succeeds from cache.
    ipc.reject = undefined;
    ipc.result = bytes(1);
    await expect(loader.objectUrl('C:/p/gone.png')).resolves.toBe('blob:1');
    expect(ipc.calls).toHaveLength(2);
  });

  it('refuses a non-image without asking the host', async (): Promise<void> => {
    // A non-image extension is rejected before any invoke, so the host is never queried.
    await expect(createImageLoader(tauriWin).objectUrl('C:/p/notes.md')).rejects.toThrow('C:/p/notes.md is not an image K-Doc can show.');
    expect(ipc.calls).toEqual([]);
  });

  it('refuses outside the desktop app', async (): Promise<void> => {
    // A browser window cannot reach the Rust host, so objectUrl() rejects and reports unavailable.
    await expect(createImageLoader(browserWin).objectUrl('C:/p/a.png')).rejects.toThrow('Showing local images requires the desktop app.');
    expect(createImageLoader(browserWin).available).toBe(false);
    expect(createImageLoader(tauriWin).available).toBe(true);
  });

  it('accepts bytes delivered as a typed array or a number array', async (): Promise<void> => {
    // A Uint8Array reply is normalized and embedded with the gif MIME type.
    ipc.result = new Uint8Array([1, 2]);
    await expect(createImageLoader(tauriWin).dataUri('C:/p/a.gif')).resolves.toBe('data:image/gif;base64,AQI=');

    // An older number-array reply is normalized the same way to an identical data URI.
    ipc.result = [1, 2];
    await expect(createImageLoader(tauriWin).dataUri('C:/p/a.gif')).resolves.toBe('data:image/gif;base64,AQI=');
  });

  it('refuses an answer that is not bytes', async (): Promise<void> => {
    // A string reply does not match any expected byte shape, so dataUri() rejects.
    ipc.result = 'nope';
    await expect(createImageLoader(tauriWin).dataUri('C:/p/a.png')).rejects.toThrow('The desktop app gave an unexpected answer when reading an image.');
  });

  it('builds a data URI for embedding without caching it', async (): Promise<void> => {
    // Serve a PNG signature so the first dataUri() resolves to its base64 form.
    ipc.result = bytes(137, 80, 78, 71);
    const loader = createImageLoader(tauriWin);
    expect(await loader.dataUri('C:/p/a.png')).toBe('data:image/png;base64,iVBORw==');

    // A second embedding reads the host again but never creates a blob to track.
    await loader.dataUri('C:/p/a.png');
    expect(ipc.calls).toHaveLength(2);
    expect(created).toEqual([]);
  });

  it('revokes what it handed out and reads again after clear', async (): Promise<void> => {
    // Read once, then clear() revokes exactly the URL that was issued.
    ipc.result = bytes(1);
    const loader = createImageLoader(tauriWin);
    const url = await loader.objectUrl('C:/p/a.png');
    loader.clear();
    expect(revoked).toEqual([url]);

    // After clear the cache is empty, so a new read issues a second URL and revokes it too.
    await loader.objectUrl('C:/p/a.png');
    expect(ipc.calls).toHaveLength(2);
    loader.clear();
    expect(revoked).toHaveLength(2);
  });
});
