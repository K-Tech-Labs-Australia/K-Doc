/**
 * @file plugin-host.spec.ts
 * @purpose Pins two guarantees of createPluginHost (FR-14.18): only the plugin a call was sent to can answer it, and a
 *   misbehaving plugin cannot grow the problems list without bound.
 * @inputs Mocked Tauri invoke (plugin_names / plugin_read) and a mocked startPluginWorker that captures each plugin's
 *   onMessage callback and records what was posted to its worker.
 * @outputs Vitest assertions over run()'s result and host.problems.
 * @functions
 *   - workerFor: Returns the captured harness entry for one plugin.
 * @dataflow load() -> invoke mocks -> startPluginWorker mock (captures onMessage per plugin) -> run() posts a call ->
 *   test delivers replies through the captured callbacks -> assertions.
 * @controlflow Each test resets the harness, loads two plugins, then drives replies directly.
 * @version 1
 * @date 2026-10-08
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Harness {
  readonly onMessage: (data: unknown) => void;
  readonly posted: unknown[];
}

const h = vi.hoisted(() => ({ workers: new Map<string, Harness>() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { name?: string }): Promise<unknown> => {
    // The plugins folder holds two plugins.
    if (cmd === 'plugin_names') {
      return ['alpha', 'beta'];
    }
    // Each plugin's manifest and code; the code names its plugin so the worker mock can tell them apart.
    if (cmd === 'plugin_read' && args?.name !== undefined) {
      return [JSON.stringify({ name: args.name, version: '1.0.0', description: 'test' }), `/* ${args.name} */`];
    }
    throw new Error(`Unexpected command ${cmd}`);
  },
}));

vi.mock('../src/plugins/plugin-worker.js', () => ({
  startPluginWorker: async (code: string, onMessage: (data: unknown) => void): Promise<unknown> => {
    const name = code.includes('alpha') ? 'alpha' : 'beta';
    const posted: unknown[] = [];
    h.workers.set(name, { onMessage, posted });
    return {
      worker: { postMessage: (data: unknown): void => { posted.push(data); }, terminate: (): void => {} },
      url: `blob:${name}`,
      registrations: [{ point: 'command', id: 'go', label: 'Go' }],
    };
  },
  stopPluginWorker: (): void => {},
}));

import { createPluginHost } from '../src/plugins/plugin-host.js';

const win = { __TAURI_INTERNALS__: {} } as unknown as Window;

/** Returns the captured harness entry for one plugin, failing the test if it never started. */
function workerFor(name: string): Harness {
  const found = h.workers.get(name);
  if (found === undefined) {
    throw new Error(`${name} never started`);
  }
  return found;
}

beforeEach((): void => {
  h.workers.clear();
});

describe('createPluginHost', () => {
  it('only the plugin that was asked can answer its call', async () => {
    const host = createPluginHost({ win });
    await host.load();
    const pending = host.run('alpha', 'command', 'go', 'text');
    const { call } = workerFor('alpha').posted[0] as { call: number };

    // Another plugin replying to alpha's call number is ignored and reported.
    workerFor('beta').onMessage({ kind: 'answer', call, text: 'spoofed', message: null });
    // Alpha's own reply settles the call.
    workerFor('alpha').onMessage({ kind: 'answer', call, text: 'real', message: null });

    expect(await pending).toEqual({ text: 'real', message: null });
    expect(host.problems.some((problem) => problem.includes('answered a request it was not sent'))).toBe(true);
  });

  it('keeps the problems list bounded however much a plugin misbehaves', async () => {
    const host = createPluginHost({ win });
    await host.load();
    // Two hundred unreadable messages each record a problem until the cap is reached.
    for (let i = 0; i < 200; i += 1) {
      workerFor('alpha').onMessage(42);
    }
    expect(host.problems.length).toBe(50);
  });
});
