// @vitest-environment jsdom
/**
 * @file user-guide.test.ts
 * @purpose Verifies K-Doc's user-guide capability: host path validation, Tauri-presence probing, and the browser fallback URL constant.
 * @inputs Mocked '@tauri-apps/api/core' invoke plus a jsdom window global; no real Tauri host is present.
 * @outputs Test results asserting installedGuidePath/hasInstalledGuide behavior and ONLINE_GUIDE_URL shape.
 * @functions No named exports exercised directly beyond the imported capability members.
 * @dataflow vi.mocked(invoke) stubs → user-guide functions under test → expect() assertions.
 * @controlflow beforeEach resets mocks; each it drives one scenario and asserts its outcome before cleanup.
 * @version 1
 * @date 2026-10-15
 */


import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { installedGuidePath, hasInstalledGuide, ONLINE_GUIDE_URL } from './user-guide.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('installedGuidePath', () => {
  beforeEach(() => {
    // Reset the mocked command between tests so each scenario starts with a clean invocation record.
    vi.mocked(invoke).mockReset();
  });

  it('invokes user_guide_path and returns the host path when invoke resolves to C:\\K-Doc\\guide\\index.md', async () => {
    // Stub the host command to resolve a valid Windows-style guide location.
    vi.mocked(invoke).mockResolvedValue('C:\\K-Doc\\guide\\index.md');
    await expect(installedGuidePath()).resolves.toBe('C:\\K-Doc\\guide\\index.md');
  });

  it('rejects with /unexpected location/ when invoke resolves to a non-string', async () => {
    // A numeric payload is malformed; the guard must reject rather than return garbage.
    vi.mocked(invoke).mockResolvedValue(42);
    await expect(installedGuidePath()).rejects.toThrow(/unexpected location/);
  });

  it('rejects with /unexpected location/ when invoke resolves to an empty string', async () => {
    // An absent path is treated as invalid by the length guard.
    vi.mocked(invoke).mockResolvedValue('');
    await expect(installedGuidePath()).rejects.toThrow(/unexpected location/);
  });

  it('passes through the host error when invoke rejects', async () => {
    // A genuine host failure (guide not installed) must propagate unchanged to callers.
    vi.mocked(invoke).mockRejectedValue(new Error('The user guide is not installed'));
    await expect(installedGuidePath()).rejects.toThrow(/not installed/);
  });
});

describe('hasInstalledGuide', () => {
  beforeEach(() => {
    // Ensure a clean window without the Tauri marker between tests.
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('is false in plain jsdom where no Tauri internals exist', () => {
    expect(hasInstalledGuide()).toBe(false);
  });

  it('is true after the Tauri internals marker is defined on window', () => {
    // Simulate a webview host by defining the marker, then restore a clean window afterwards.
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    try {
      expect(hasInstalledGuide()).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    }
  });
});

describe('ONLINE_GUIDE_URL', () => {
  it('points at the K-Doc guide on GitHub', () => {
    expect(ONLINE_GUIDE_URL.startsWith('https://github.com/K-Tech-Labs-Australia/K-Doc/')).toBe(true);
    expect(ONLINE_GUIDE_URL.endsWith('docs/guide/index.md')).toBe(true);
  });
});
