/**
 * @file snapshot-retention.ts
 * @purpose Decides which local snapshots a retention policy lets go (FR-11.8): every snapshot for the first hours, the newest per hour for some days, the newest per day for longer, and nothing older;
 * @inputs snapshot entries, the current time, a policy;
 * @outputs the ids to delete;
 * @functions snapshotsToPrune
 * @dataflow entries -> newest first -> per entry: kept (newest, manual, recent) or bucketed by hour/day -> first in a bucket kept, the rest pruned;
 * @controlflow one pass newest to oldest;
 * @version 1
 * @date 2026-09-16
 */

/**
 * A single stored snapshot.
 * @property id names the snapshot.
 * @property at is milliseconds since the epoch.
 * @property reason is save/manual/timer/restore.
 */
export interface SnapshotEntry {
  readonly id: string;
  readonly at: number;
  readonly reason: string;
}

/**
 * How long snapshots are retained before they may be pruned (FR-11.8).
 * @property keepAllHours every snapshot younger than this is kept.
 * @property keepHourlyDays up to this age the newest snapshot of each clock hour is kept.
 * @property keepDailyDays up to this age the newest of each day is kept.
 */
export interface RetentionPolicy {
  readonly keepAllHours: number;
  readonly keepHourlyDays: number;
  readonly keepDailyDays: number;
}

// Milliseconds in an hour.
const HOUR_MS = 3_600_000;
// Milliseconds in a day.
const DAY_MS = 86_400_000;

/**
 * Returns the ids of snapshots a retention policy lets go (FR-11.8).
 * @purpose Sorts entries newest first and keeps the newest overall, all manual snapshots, every snapshot within keepAllHours, and the newest snapshot in each hour/day bucket; everything else is pruned.
 * @inputs entries - the snapshots to consider; now - current time in milliseconds since the epoch; policy - retention thresholds.
 * @outputs array of ids to delete, oldest first as encountered.
 * @dataflow entries -> sorted newest first -> per entry: kept (newest, manual, recent) or bucketed by hour/day -> first in a bucket kept, the rest pruned.
 * @controlflow one pass newest to oldest; early return for kept snapshots, otherwise claim the newest member of each bucket and prune later ones.
 */
export function snapshotsToPrune(entries: readonly SnapshotEntry[], now: number, policy: RetentionPolicy): readonly string[] {
  // Sort newest first so the first snapshot met in a bucket is its newest; ties break by id for determinism.
  const newestFirst = [...entries].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const claimed = new Set<string>();
  const prune: string[] = [];
  newestFirst.forEach((entry, position) => {
    const age = now - entry.at;
    let bucket: string | null;
    // Within keepHourlyDays the newest snapshot of each clock hour is kept, so bucket by UTC hour.
    if (age <= policy.keepHourlyDays * DAY_MS) {
      bucket = `h${Math.floor(entry.at / HOUR_MS)}`;
    } else if (age <= policy.keepDailyDays * DAY_MS) {
      // Within keepDailyDays the newest of each day is kept, so bucket by UTC day.
      bucket = `d${Math.floor(entry.at / DAY_MS)}`;
    } else {
      // Past the daily window: nothing is retained, so no bucket is claimed and the entry is pruned.
      bucket = null;
    }
    // Keep the newest snapshot overall (position 0), all manual snapshots asked for by name, and every snapshot within keepAllHours; a future timestamp has negative age and is kept here too.
    if (position === 0 || entry.reason === 'manual' || age <= policy.keepAllHours * HOUR_MS) {
      // A kept snapshot still claims its bucket, so an older one in the same hour or day is not kept beside it.
      if (bucket !== null) {
        claimed.add(bucket);
      } else {
        // Past every window: there is no bucket to claim.
      }
      return;
    } else {
      // Not kept outright: the bucket decides below.
    }
    // The first (newest) snapshot seen in a bucket claims it and is kept; later (older) members of that bucket are pruned.
    if (bucket !== null && !claimed.has(bucket)) {
      claimed.add(bucket);
    } else {
      prune.push(entry.id);
    }
  });
  return prune;
}
