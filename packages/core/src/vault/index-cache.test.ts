/**
 * @file index-cache.test.ts
 * @purpose Vitest suite for on-disk vault index serialisation, parsing/validation, and scan planning (FR-6.12).
 *   Covers serialiseIndex round-trip and format compactness, parseIndex strict validation and success paths,
 *   and planScan reuse/read partitioning including order preservation and orphaned-cache handling.
 * @inputs Cached note fixtures, file stat descriptors, and raw JSON text strings (valid and malformed).
 * @outputs Vitest assertions validating serialised output, parsed index results or null, and scan plans.
 * @functions
 *   - entry: Builds a NoteIndexEntry fixture rooted at 'C:/vault/'.
 *   - cached: Builds a CachedNote fixture carrying a matching entry.
 *   - stat: Builds a VaultFileStat descriptor for the same path as its cached note.
 * @dataflow Fixture builders -> index-cache functions (serialiseIndex, parseIndex, planScan) -> assertion checks against expected results.
 * @controlflow Execute three describe suites covering serialisation, parsing/validation, and scan planning in order.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { serialiseIndex, parseIndex, planScan, INDEX_FORMAT_VERSION } from './index-cache.js';
import type { CachedNote, VaultFileStat } from './index-cache.js';
import type { NoteIndexEntry } from './note-index.js';

/**
 * Builds a NoteIndexEntry fixture rooted at 'C:/vault/'.
 *
 * @purpose Creates a NoteIndexEntry with path set to 'C:/vault/' + relative, the given title, and empty headings, links, tags, and frontMatter.
 * @inputs relative - Relative path of the note within the vault.
 * @inputs title - Display title of the note.
 * @outputs NoteIndexEntry - Fully populated note index entry fixture.
 * @dataflow relative, title -> assembled NoteIndexEntry with empty collections.
 * @controlflow Construct path with 'C:/vault/' prefix -> assign fields and return fixture.
 */
function entry(relative: string, title: string): NoteIndexEntry {
  return {
    path: 'C:/vault/' + relative,
    relative,
    title,
    headings: [],
    links: [],
    tags: [],
    frontMatter: {},
  };
}

/**
 * Builds a CachedNote fixture carrying a matching entry.
 *
 * @purpose Creates a CachedNote with path 'C:/vault/' + relative, the given modifiedMs and size, and an entry built from the same relative path.
 * @inputs relative - Relative path of the note within the vault.
 * @inputs modifiedMs - Last modification time in milliseconds since the Unix epoch.
 * @inputs size - File size in bytes.
 * @outputs CachedNote - Cached note fixture with a matching NoteIndexEntry.
 * @dataflow relative, modifiedMs, size -> assembled CachedNote whose entry mirrors relative.
 * @controlflow Construct path and delegate to entry(relative, relative) -> return fixture.
 */
function cached(relative: string, modifiedMs: number, size: number): CachedNote {
  return {
    path: 'C:/vault/' + relative,
    relative,
    modifiedMs,
    size,
    entry: entry(relative, relative),
  };
}

/**
 * Builds a VaultFileStat descriptor for the same path as its cached note.
 *
 * @purpose Creates a VaultFileStat with path 'C:/vault/' + relative, the given modifiedMs and size.
 * @inputs relative - Relative path of the note within the vault.
 * @inputs modifiedMs - Last modification time in milliseconds since the Unix epoch.
 * @inputs size - File size in bytes.
 * @outputs VaultFileStat - File stat descriptor matching a cached note's identity fields.
 * @dataflow relative, modifiedMs, size -> assembled VaultFileStat with a shared path prefix.
 * @controlflow Construct path with 'C:/vault/' prefix -> assign fields and return descriptor.
 */
function stat(relative: string, modifiedMs: number, size: number): VaultFileStat {
  return {
    path: 'C:/vault/' + relative,
    relative,
    modifiedMs,
    size,
  };
}

describe('serialiseIndex', (): void => {
  it('round-trips through parseIndex', (): void => {
    // The format is private, but the bytes must survive a trip to disk and back.
    const notes = [cached('a.md', 1, 10), cached('b.md', 2, 20)];
    const parsed = parseIndex(serialiseIndex('C:/vault', notes), 'C:/vault');
    expect(parsed).not.toBeNull();
    expect(parsed?.notes).toEqual(notes);
  });

  it('stamps the current format version', (): void => {
    // Every serialised index carries the version so a future reader can recognise it.
    const parsed = JSON.parse(serialiseIndex('C:/vault', [cached('a.md', 1, 10)])) as { version: number };
    expect(parsed.version).toBe(INDEX_FORMAT_VERSION);
  });

  it('is not pretty-printed', (): void => {
    // Nobody reads this file, so indentation would only waste most of its bytes on a large vault.
    const text = serialiseIndex('C:/vault', [cached('a.md', 1, 10), cached('b.md', 2, 20)]);
    expect(text).not.toContain('\n');
  });
});

describe('parseIndex', (): void => {
  it('returns null for text that is not JSON at all', (): void => {
    // Garbage bytes parse to nothing, and an unparseable file cannot be trusted.
    expect(parseIndex('not json{', 'C:/vault')).toBeNull();
  });

  it('returns null for JSON that is not an object', (): void => {
    // A number, string, null, or array is not a record and cannot be an index.
    expect(parseIndex('42', 'C:/vault')).toBeNull();
    expect(parseIndex('"a string"', 'C:/vault')).toBeNull();
    expect(parseIndex('null', 'C:/vault')).toBeNull();
    expect(parseIndex('[]', 'C:/vault')).toBeNull();
  });

  it('returns null for a different format version', (): void => {
    // An older format's fields may mean something else now, and guessing is how a cache starts lying.
    const text = JSON.stringify({
      version: INDEX_FORMAT_VERSION + 1,
      root: 'C:/vault',
      notes: [cached('a.md', 1, 10)],
    });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when root is not a string', (): void => {
    // A non-string root cannot name any folder the index was built for.
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 42, notes: [] });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when root names a different folder', (): void => {
    // An index built for another folder describes other files.
    const text = serialiseIndex('C:/other-vault', [cached('a.md', 1, 10)]);
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when notes is missing', (): void => {
    // Without a notes array there is nothing to trust or reuse.
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault' });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when notes is not an array', (): void => {
    // notes must be an array; a record of notes cannot stand in for one.
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault', notes: {} });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when a note has a non-string path', (): void => {
    // One corrupt note sinks the whole array rather than being skipped.
    const bad = { path: 42, relative: 'a.md', modifiedMs: 1, size: 10, entry: entry('a.md', 'a.md') } as unknown;
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault', notes: [cached('b.md', 2, 20), bad] });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when a note has a non-finite modifiedMs', (): void => {
    // A single malformed note invalidates the entire notes array.
    const bad = { path: 'C:/vault/a.md', relative: 'a.md', modifiedMs: Number.NaN, size: 10, entry: entry('a.md', 'a.md') } as unknown;
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault', notes: [cached('b.md', 2, 20), bad] });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when a note has no entry', (): void => {
    // A single malformed note invalidates the entire notes array.
    const bad = { path: 'C:/vault/a.md', relative: 'a.md', modifiedMs: 1, size: 10 } as unknown;
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault', notes: [cached('b.md', 2, 20), bad] });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('returns null when a note entry is missing its title', (): void => {
    // A single malformed note invalidates the entire notes array.
    const bad = { path: 'C:/vault/a.md', relative: 'a.md', modifiedMs: 1, size: 10, entry: { path: 'C:/vault/a.md', relative: 'a.md', headings: [], links: [], tags: [], frontMatter: {} } } as unknown;
    const text = JSON.stringify({ version: INDEX_FORMAT_VERSION, root: 'C:/vault', notes: [cached('b.md', 2, 20), bad] });
    expect(parseIndex(text, 'C:/vault')).toBeNull();
  });

  it('parses a valid index and returns its version, root, and notes', (): void => {
    // A well-formed index for the right folder is trusted whole.
    const notes = [cached('a.md', 1, 10), cached('b.md', 2, 20)];
    const parsed = parseIndex(serialiseIndex('C:/vault', notes), 'C:/vault');
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(INDEX_FORMAT_VERSION);
    expect(parsed?.root).toBe('C:/vault');
    expect(parsed?.notes).toEqual(notes);
  });

  it('parses an empty notes array as a valid index with no notes', (): void => {
    // A vault with no notes in it is a real vault, not a corrupt cache.
    const parsed = parseIndex(serialiseIndex('C:/vault', []), 'C:/vault');
    expect(parsed).not.toBeNull();
    expect(parsed?.notes).toEqual([]);
  });
});

describe('planScan', (): void => {
  it('puts every file in read when there is no cache', (): void => {
    // With nothing cached, everything on disk must be read afresh.
    const files = [stat('a.md', 1, 10), stat('b.md', 2, 20)];
    const plan = planScan(files, null);
    expect(plan.reuse).toEqual([]);
    expect(plan.read.map((f): string => f.relative)).toEqual(['a.md', 'b.md']);
  });

  it('reuses a file whose modifiedMs and size both match', (): void => {
    // Identical time and size mean the file was not touched since it was indexed.
    const note = cached('a.md', 100, 500);
    const index = parseIndex(serialiseIndex('C:/vault', [note]), 'C:/vault');
    const plan = planScan([stat('a.md', 100, 500)], index);
    expect(plan.reuse).toEqual([note]);
    expect(plan.read).toEqual([]);
  });

  it('reads a file whose modifiedMs differs even when the size matches', (): void => {
    // An edit that swaps one word for another of the same length keeps the size but moves the time.
    const note = cached('a.md', 100, 500);
    const index = parseIndex(serialiseIndex('C:/vault', [note]), 'C:/vault');
    const plan = planScan([stat('a.md', 101, 500)], index);
    expect(plan.reuse).toEqual([]);
    expect(plan.read.map((f): string => f.relative)).toEqual(['a.md']);
  });

  it('reads a file whose size differs even when the modifiedMs matches', (): void => {
    // A copy or a restore can preserve the modification time while changing the content.
    const note = cached('a.md', 100, 500);
    const index = parseIndex(serialiseIndex('C:/vault', [note]), 'C:/vault');
    const plan = planScan([stat('a.md', 100, 512)], index);
    expect(plan.reuse).toEqual([]);
    expect(plan.read.map((f): string => f.relative)).toEqual(['a.md']);
  });

  it('reads a file with no matching cached record', (): void => {
    // A file the cache never saw cannot be reused, only read.
    const cachedIndex = parseIndex(serialiseIndex('C:/vault', [cached('other.md', 2, 2)]), 'C:/vault');
    const plan = planScan([stat('never.md', 1, 1)], cachedIndex);
    expect(plan.reuse).toEqual([]);
    expect(plan.read.map((f): string => f.relative)).toEqual(['never.md']);
  });

  it('drops a cached note whose file is absent from the scan', (): void => {
    // The plan is built from what is on disk now, not from what the index remembers.
    const orphan = cached('gone.md', 3, 30);
    const cachedIndex = parseIndex(serialiseIndex('C:/vault', [orphan]), 'C:/vault');
    const plan = planScan([stat('present.md', 1, 10)], cachedIndex);
    expect(plan.reuse).toEqual([]);
    expect(plan.read.map((f): string => f.relative)).toEqual(['present.md']);
  });

  it('preserves input order in both output arrays', (): void => {
    // Reused and read files alternate, so each output must keep the order they appeared on disk.
    const a = cached('a.md', 10, 100);
    const c = cached('c.md', 30, 300);
    const e = cached('e.md', 50, 500);
    const cachedIndex = parseIndex(serialiseIndex('C:/vault', [a, c, e]), 'C:/vault');
    const files = [
      stat('a.md', 10, 100),
      stat('b.md', 11, 100),
      stat('c.md', 30, 300),
      stat('d.md', 31, 400),
      stat('e.md', 50, 500),
    ];
    const plan = planScan(files, cachedIndex);
    expect(plan.reuse.map((n): string => n.relative)).toEqual(['a.md', 'c.md', 'e.md']);
    expect(plan.read.map((f): string => f.relative)).toEqual(['b.md', 'd.md']);
  });

  it('splits a mixed vault into two reused and two read', (): void => {
    // Two files are unchanged and two changed, so the plan holds exactly two in each list.
    const keep1 = cached('keep1.md', 100, 200);
    const keep2 = cached('keep2.md', 300, 400);
    const cachedIndex = parseIndex(serialiseIndex('C:/vault', [keep1, keep2]), 'C:/vault');
    const files = [
      stat('keep1.md', 100, 200),
      stat('changed1.md', 100, 999),
      stat('keep2.md', 300, 400),
      stat('changed2.md', 999, 400),
    ];
    const plan = planScan(files, cachedIndex);
    expect(plan.reuse).toHaveLength(2);
    expect(plan.read).toHaveLength(2);
    expect(plan.reuse.map((n): string => n.relative)).toEqual(['keep1.md', 'keep2.md']);
    expect(plan.read.map((f): string => f.relative)).toEqual(['changed1.md', 'changed2.md']);
  });
});
