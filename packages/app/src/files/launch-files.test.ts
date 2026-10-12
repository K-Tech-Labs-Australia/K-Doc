/**
 * @file launch-files.test.ts
 * @purpose Verifies the LaunchFiles capabilities and the sequential openLaunchFiles driver for both Tauri desktop and browser builds.
 * @inputs Mocked @tauri-apps invoke/listen globals plus fake LaunchFiles sources; asserts on their behavior.
 * @outputs Test cases that pass when each capability behaves per the launch-files.ts contract.
 * @functions (test suites) tauriLaunchFiles.take / take validation / onRequest / openDefaultAppsSettings; browserLaunchFiles.*; openLaunchFiles ordering & counting.
 * @dataflow Mocked host responses → capability methods → expect() assertions on calls and return values.
 * @controlflow Reset mocks per test; for each scenario, configure the mock, invoke the capability, and assert outcomes.
 * @version 1
 * @date 2026-10-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LAUNCH_EVENT, type LaunchFiles, tauriLaunchFiles, browserLaunchFiles, openLaunchFiles } from './launch-files.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

// Clear all mock state before each test so scenarios start from a clean slate.
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
});

describe('tauriLaunchFiles', () => {
  // take() should forward the host command and return whatever flat string array it resolves to.
  it('take() invokes take_launch_paths and returns the resolved list', async () => {
    vi.mocked(invoke).mockResolvedValue(['C:\\a.md', 'C:\\b.md']);
    const paths = await tauriLaunchFiles().take();
    expect(invoke).toHaveBeenCalledWith('take_launch_paths');
    expect(paths).toEqual(['C:\\a.md', 'C:\\b.md']);
  });

  // take() must reject when the host returns a non-array payload.
  it('take() rejects with an unexpected-list error when the host returns a non-array', async () => {
    vi.mocked(invoke).mockResolvedValue([1]);
    await expect(tauriLaunchFiles().take()).rejects.toThrow(/unexpected list/);
  });

  // take() must reject when the host returns a bare string instead of an array.
  it('take() rejects with an unexpected-list error when the host returns a string', async () => {
    vi.mocked(invoke).mockResolvedValue('C:\\a.md');
    await expect(tauriLaunchFiles().take()).rejects.toThrow(/unexpected list/);
  });

  // onRequest should subscribe to the launch event, fire the handler when the host broadcasts, and return the unsubscribe fn.
  it('onRequest subscribes to the launch event and returns the unsubscribe function', async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    const handler = vi.fn();
    const source = tauriLaunchFiles();
    const stop = await source.onRequest(handler);
    expect(listen).toHaveBeenCalledWith(LAUNCH_EVENT, expect.any(Function));
    // Capture the registered listener and fire it as if the host delivered an event payload.
    const callback = vi.mocked(listen).mock.calls[0]?.[1] as (payload: unknown) => void;
    callback({} as never);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(stop).toBe(unlisten);
  });

  // openDefaultAppsSettings should delegate to the Rust command that opens Windows settings.
  it('openDefaultAppsSettings invokes the open_default_apps_settings command', async () => {
    await tauriLaunchFiles().openDefaultAppsSettings();
    expect(invoke).toHaveBeenCalledWith('open_default_apps_settings');
  });
});

describe('browserLaunchFiles', () => {
  // A browser tab cannot queue files, so take() resolves an empty list.
  it('take() resolves an empty list', async () => {
    await expect(browserLaunchFiles().take()).resolves.toEqual([]);
  });

  // The default-app chooser is a Windows feature, so the settings shortcut must reject with a desktop-only message.
  it('openDefaultAppsSettings rejects with a desktop-only message', async () => {
    await expect(browserLaunchFiles().openDefaultAppsSettings()).rejects.toThrow(/only available in the desktop app/);
  });

  // onRequest resolves to a no-op and never subscribes because the browser receives no host events.
  it('onRequest resolves to a no-op and never subscribes', async () => {
    const stop = await browserLaunchFiles().onRequest(vi.fn());
    expect(typeof stop).toBe('function');
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('openLaunchFiles', () => {
  // Every waiting path should be opened in order and the total count returned.
  it('opens each waiting path in order and returns the count', async () => {
    const source: LaunchFiles = {
      take: async (): Promise<readonly string[]> => ['a', 'b', 'c'],
      onRequest: async (): Promise<() => void> => () => {},
      openDefaultAppsSettings: async (): Promise<void> => {},
    };
    const open = vi.fn(async (): Promise<void> => {});
    const opened = await openLaunchFiles(source, open);
    expect(opened).toBe(3);
    expect(open).toHaveBeenNthCalledWith(1, 'a');
    expect(open).toHaveBeenNthCalledWith(2, 'b');
    expect(open).toHaveBeenNthCalledWith(3, 'c');
  });

  // Each open must fully resolve before the next begins, preserving strict ordering.
  it('awaits each open before starting the next', async () => {
    const order: string[] = [];
    const source: LaunchFiles = {
      take: async (): Promise<readonly string[]> => ['a', 'b'],
      onRequest: async (): Promise<() => void> => () => {},
      openDefaultAppsSettings: async (): Promise<void> => {},
    };
    const open = vi.fn(async (path: string): Promise<void> => {
      order.push(`start ${path}`);
      // Yield to the microtask queue so a concurrent caller could interleave if opens were not awaited.
      await Promise.resolve();
      order.push(`end ${path}`);
    });
    await openLaunchFiles(source, open);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  // With nothing queued, openLaunchFiles returns zero and never invokes the opener.
  it('returns 0 and opens nothing when there are no waiting paths', async () => {
    const source: LaunchFiles = {
      take: async (): Promise<readonly string[]> => [],
      onRequest: async (): Promise<() => void> => () => {},
      openDefaultAppsSettings: async (): Promise<void> => {},
    };
    const open = vi.fn(async (): Promise<void> => {});
    const opened = await openLaunchFiles(source, open);
    expect(opened).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });
});
