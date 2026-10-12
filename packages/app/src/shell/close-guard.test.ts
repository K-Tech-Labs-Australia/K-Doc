/**
 * @file close-guard.test.ts
 * @purpose Verifies the window-close guard contract: installCloseGuard asks whether the shell may close,
 *   keeps the window open on a no or on any failure, and serializes overlapping requests. tauriCloseRequests is
 *   checked only for its null fallback outside a desktop host.
 * @inputs Fake CloseRequestSource (module-level `source`), an event factory (`ev`), per-test confirm/onError fakes.
 * @outputs Assertions on CloseRequestEvent.prevented, call counts of the confirm and onError fakes, resolution values.
 * @functions
 *   - ev: Builds a fake CloseRequestEvent that records whether preventDefault was invoked.
 *   - describe/it blocks: Cover null source, true/false/rejecting confirm, overlapping requests, and rejection at install.
 * @dataflow Test invokes the registered handler with an event → guard calls confirm() → guards sets prevented or reports error.
 * @controlflow beforeEach resets module state; each test installs a fresh guard then drives events through the captured handler.
 * @version 1
 * @date 2026-10-07
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloseRequestEvent, CloseRequestSource } from './close-guard.js';
import { installCloseGuard, tauriCloseRequests } from './close-guard.js';

// A single reusable source whose registered handler is captured in module state; reset before each test.
let handler: ((e: CloseRequestEvent) => Promise<void>) | null = null;
const source: CloseRequestSource = {
  onCloseRequested: async (h) => {
    // Capture the guard's callback so tests can drive close requests deterministically.
    handler = h;
    return () => {};
  },
};

// Build a fake event that records whether preventDefault was invoked, without touching any real DOM/window.
function ev(): CloseRequestEvent & { prevented: boolean } {
  const e = { prevented: false, preventDefault() { e.prevented = true; } };
  return e;
}

beforeEach(() => {
  // Reset the captured handler so each test starts from a clean install.
  handler = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installCloseGuard', () => {
  it('resolves without doing anything when source is null', async () => {
    // A null source means there is nothing to guard, so install must be a no-op.
    const onError = vi.fn();
    await expect(installCloseGuard(null, async () => true, onError)).resolves.toBeUndefined();
    // No confirm should ever run and no error path should fire for an absent source.
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the window open when confirm resolves true', async () => {
    // A yes from confirm permits closing, so preventDefault must not be called.
    const onError = vi.fn();
    await installCloseGuard(source, async () => true, onError);
    expect(handler).not.toBeNull();

    const e = ev();
    await handler!(e);
    expect(e.prevented).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('prevents closing when confirm resolves false', async () => {
    // A no from confirm keeps the window, so preventDefault must be called.
    const onError = vi.fn();
    await installCloseGuard(source, async () => false, onError);
    expect(handler).not.toBeNull();

    const e = ev();
    await handler!(e);
    expect(e.prevented).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('prevents closing and reports when confirm rejects', async () => {
    // A failing check must not lose work: keep the window open and surface the error.
    const onError = vi.fn();
    const boom = new Error('check failed');
    await installCloseGuard(source, async () => {
      throw boom;
    }, onError);
    expect(handler).not.toBeNull();

    const e = ev();
    await handler!(e);
    expect(e.prevented).toBe(true);
    // The exact thrown error is forwarded to the reporter.
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('refuses a second close while the first request is still asking', async () => {
    // Defer confirm so we can observe overlapping requests; count invocations and resolve manually later.
    const onError = vi.fn();
    let calls = 0;
    let resolveFirst!: (value: boolean) => void;
    const firstConfirm = new Promise<boolean>((resolve) => {
      // Defer resolution until the test drives it, keeping the first request "asking".
      resolveFirst = resolve;
    });

    await installCloseGuard(source, async () => {
      // confirm was invoked exactly once for the first request.
      calls += 1;
      return firstConfirm;
    }, onError);
    expect(handler).not.toBeNull();

    // First close request: enters asking state and awaits the pending confirm.
    const e1 = ev();
    void handler!(e1);

    // Second close arrives while the first is still asking, so it must be refused immediately without re-asking.
    const e2 = ev();
    await handler!(e2);
    expect(e2.prevented).toBe(true);
    expect(calls).toBe(1);

    // Resolving the first confirm with a yes lets that original request proceed (no preventDefault on it).
    resolveFirst(true);
    await e1;
    expect(e1.prevented).toBe(false);
  });

  it('reports and resolves when source.onCloseRequested rejects', async () => {
    // If the platform itself fails to register a handler, report the error but still finish installing.
    const onError = vi.fn();
    const boom = new Error('register failed');
    const failingSource: CloseRequestSource = {
      onCloseRequested: async () => {
        throw boom;
      },
    };

    await installCloseGuard(failingSource, async () => true, onError);
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe('tauriCloseRequests', () => {
  it('returns null outside the desktop host where there is no window to guard', () => {
    // A plain Window without Tauri internals has nothing to bridge, so the source must be absent.
    expect(tauriCloseRequests({} as Window)).toBeNull();
  });
});
