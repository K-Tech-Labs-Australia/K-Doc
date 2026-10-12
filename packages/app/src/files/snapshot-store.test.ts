/**
 * @file snapshot-store.test.ts
 * @purpose Exercises createSnapshotStore against a fake host to verify write, prune, list, read, and unavailability behavior.
 * @inputs SnapshotInfo/SnapshotInvoke types from snapshot-store.js; canned command→response maps built by fakeHost.
 * @outputs Asserted call sequences and resolved values produced by the store under each scenario.
 * @functions
 *   - fakeHost: Records invoke calls and returns canned responses keyed by command name.
 *   - info: Builds a minimal SnapshotInfo record for test fixtures.
 * @dataflow Test constants → fakeHost response maps → createSnapshotStore → host.invoke → recorded Call[] → expect assertions.
 * @controlflow describe block runs four it() scenarios sequentially; each builds its own store/host and asserts call order and return values.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { createSnapshotStore } from './snapshot-store.js';
import type { SnapshotInfo, SnapshotInvoke } from './snapshot-store.js';

const HOUR = 3_600_000;
const NOW = 400 * 24 * HOUR;
const POLICY = { keepAllHours: 24, keepHourlyDays: 7, keepDailyDays: 90 };
const KDOC_ID = '01HZY3G6Q2K8V4M5N6P7R8S9TA';

interface Call {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

// Build a fake host that records every invoke call and resolves it from the provided response map.
function fakeHost(responses: Record<string, unknown>): { calls: Call[]; invoke: SnapshotInvoke } {
  const calls: Call[] = [];
  const invoke = <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    return Promise.resolve(responses[command] as T);
  };
  return { calls, invoke };
}

// Construct a SnapshotInfo fixture with a default reason of 'save'.
function info(id: string, at: number, reason: SnapshotInfo['reason'] = 'save'): SnapshotInfo {
  return { id, at, reason, bytes: 1 };
}

describe('snapshot store', () => {
  // A write succeeds and pruning removes the stale snapshot outside the retention window.
  it('writes a snapshot and deletes what the policy lets go', async () => {
    const written = info('new', NOW);
    const host = fakeHost({ snapshot_write: written, snapshot_list: [info('old', NOW - 200 * 24 * HOUR), written], snapshot_delete: 1 });
    const store = createSnapshotStore({ available: true, policy: () => POLICY, now: () => NOW, invoke: host.invoke });
    await expect(store.take('C:/n.md', 'Text', 'save')).resolves.toBe(written);
    expect(host.calls).toEqual([
      { command: 'snapshot_write', args: { documentPath: 'C:/n.md', kdocId: null, at: NOW, reason: 'save', contents: 'Text' } },
      { command: 'snapshot_list', args: { documentPath: 'C:/n.md', kdocId: null } },
      { command: 'snapshot_delete', args: { documentPath: 'C:/n.md', kdocId: null, ids: ['old'] } },
    ]);
  });

  // Pruning is skipped when nothing new was written or when the list contains only the just-written snapshot.
  it('skips pruning when nothing new was written or nothing is due', async () => {
    const unchanged = fakeHost({ snapshot_write: null });
    const store = createSnapshotStore({ available: true, policy: () => POLICY, now: () => NOW, invoke: unchanged.invoke });
    await expect(store.take('C:/n.md', 'Text', 'timer')).resolves.toBeNull();
    expect(unchanged.calls.map((call) => call.command)).toEqual(['snapshot_write']);
    const fresh = fakeHost({ snapshot_write: info('new', NOW), snapshot_list: [info('new', NOW)] });
    await createSnapshotStore({ available: true, policy: () => POLICY, now: () => NOW, invoke: fresh.invoke }).take('C:/n.md', 'Text', 'manual');
    expect(fresh.calls.map((call) => call.command)).toEqual(['snapshot_write', 'snapshot_list']);
  });

  // The kdoc_id from front matter is threaded through so the host keys snapshots by it.
  it('passes the kdoc_id from front matter so the host keys by it', async () => {
    const host = fakeHost({ snapshot_list: [], snapshot_read: 'old text' });
    const store = createSnapshotStore({ available: true, policy: () => POLICY, now: () => NOW, invoke: host.invoke });
    const text = `---\nkdoc_id: ${KDOC_ID}\n---\n\nBody\n`;
    await expect(store.list('C:/n.md', text)).resolves.toEqual([]);
    await expect(store.read('C:/n.md', text, '0000000000001-save.md')).resolves.toBe('old text');
    expect(host.calls).toEqual([
      { command: 'snapshot_list', args: { documentPath: 'C:/n.md', kdocId: KDOC_ID } },
      { command: 'snapshot_read', args: { documentPath: 'C:/n.md', kdocId: KDOC_ID, id: '0000000000001-save.md' } },
    ]);
  });

  // With no desktop host available, reads reject and writes/lists are no-ops that record nothing.
  it('does nothing without a desktop host', async () => {
    const host = fakeHost({});
    const store = createSnapshotStore({ available: false, policy: () => POLICY, now: () => NOW, invoke: host.invoke });
    expect(store.available).toBe(false);
    await expect(store.take('C:/n.md', 'Text', 'save')).resolves.toBeNull();
    await expect(store.list('C:/n.md', 'Text')).resolves.toEqual([]);
    await expect(store.read('C:/n.md', 'Text', 'x')).rejects.toThrow('only available in the K-Doc desktop app');
    expect(host.calls).toEqual([]);
  });
});
