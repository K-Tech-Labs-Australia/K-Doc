/**
 * @file snapshot-retention.spec.ts
 * @purpose Unit tests for the snapshot retention pruning algorithm in snapshotsToPrune.
 * @inputs SnapshotEntry arrays, a reference NOW timestamp, and RetentionPolicy objects.
 * @outputs expect(...) assertions on the pruned id list returned by snapshotsToPrune.
 * @functions
 *   - snap: Builds a SnapshotEntry at a given age relative to NOW for test fixtures.
 *   - describe/it/expect: Vitest harness exercising pruning rules across edge cases.
 * @dataflow Test fixture entries → snapshotsToPrune(pruned, NOW, policy) → expected id list.
 * @controlflow For each scenario, build entries, call the function, assert the pruned result.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { snapshotsToPrune } from '../src/history/snapshot-retention.js';
import type { RetentionPolicy, SnapshotEntry } from '../src/history/snapshot-retention.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_000 * DAY;
const POLICY: RetentionPolicy = { keepAllHours: 24, keepHourlyDays: 7, keepDailyDays: 90 };

// snap builds a fixture SnapshotEntry aged `age` ms before the reference time NOW.
function snap(id: string, age: number, reason = 'save'): SnapshotEntry {
  return { id, at: NOW - age, reason };
}

describe('snapshotsToPrune', () => {
  // All entries fall inside the keep-all window so nothing is pruned.
  it('keeps everything younger than the keep-all window', () => {
    expect(snapshotsToPrune([snap('a', 1), snap('b', HOUR), snap('c', 24 * HOUR)], NOW, POLICY)).toEqual([]);
  });

  // Within the hourly tier, only the oldest snapshot of a shared hour bucket is pruned.
  it('keeps the newest snapshot of each hour after the first day', () => {
    const base = 2 * DAY + 0.5 * HOUR;
    const entries = [snap('old', base + 0.2 * HOUR), snap('new', base), snap('other-hour', base + 2 * HOUR)];
    expect(snapshotsToPrune(entries, NOW, POLICY)).toEqual(['old']);
  });

  // Within the daily tier, only the oldest snapshot of a shared day bucket is pruned.
  it('keeps the newest snapshot of each day after the hourly window', () => {
    const base = 10 * DAY + 0.5 * DAY;
    const entries = [snap('early', base + 3 * HOUR), snap('late', base), snap('next-day', base + DAY)];
    expect(snapshotsToPrune(entries, NOW, POLICY)).toEqual(['early']);
  });

  // Past the daily window only the single newest entry survives; ties resolve by id.
  it('deletes snapshots past the daily window but never the newest', () => {
    expect(snapshotsToPrune([snap('ancient', 200 * DAY), snap('older', 300 * DAY)], NOW, POLICY)).toEqual(['older']);
    expect(snapshotsToPrune([snap('recent', HOUR), snap('ancient', 91 * DAY)], NOW, POLICY)).toEqual(['ancient']);
  });

  // Manual snapshots are exempt from pruning regardless of age.
  it('never prunes a manual snapshot', () => {
    expect(snapshotsToPrune([snap('recent', HOUR), snap('kept', 400 * DAY, 'manual')], NOW, POLICY)).toEqual([]);
  });

  // With all windows zeroed, only the future-dated entry is retained.
  it('keeps a snapshot from the future', () => {
    expect(snapshotsToPrune([snap('future', -HOUR), snap('now', 1)], NOW, { keepAllHours: 0, keepHourlyDays: 0, keepDailyDays: 0 })).toEqual(['now']);
  });

  // Window boundaries are inclusive; only entries strictly past the daily edge are pruned.
  it('treats the window edges as inside', () => {
    const edges: RetentionPolicy = { keepAllHours: 1, keepHourlyDays: 2, keepDailyDays: 3 };
    const entries = [snap('newest', 0), snap('all-edge', HOUR), snap('hour-edge', 2 * DAY), snap('day-edge', 3 * DAY), snap('past', 3 * DAY + 1)];
    expect(snapshotsToPrune(entries, NOW, edges)).toEqual(['past']);
  });

  // An edge snapshot is kept by its own window even when an older rule's bucket is already taken.
  it('keeps a snapshot exactly at a window edge even when its bucket is taken', () => {
    const edges: RetentionPolicy = { keepAllHours: 1, keepHourlyDays: 2, keepDailyDays: 3 };
    const later = NOW + 30 * 60_000;
    const at = (id: string, age: number): SnapshotEntry => ({ id, at: later - age, reason: 'save' });
    expect(snapshotsToPrune([at('newest', 0), at('claims', HOUR - 1), at('all-edge', HOUR)], later, edges)).toEqual([]);
    expect(snapshotsToPrune([at('newest', 0), at('hour-edge', 2 * DAY), at('same-day', 2 * DAY + 1)], later, edges)).toEqual([]);
  });

  // Ties on time break by id; pruning is independent of input ordering.
  it('breaks a tie on time by id and ignores input order', () => {
    const base = 3 * DAY;
    const entries = [snap('a', base), snap('b', base)];
    expect(snapshotsToPrune(entries, NOW, POLICY)).toEqual(['a']);
    expect(snapshotsToPrune([snap('recent', 0), ...entries], NOW, POLICY)).toEqual(['a']);
    expect(snapshotsToPrune([snap('recent', 0), ...[...entries].reverse()], NOW, POLICY)).toEqual(['a']);
  });
});
