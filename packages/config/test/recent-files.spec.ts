/**
 * @file recent-files.spec.ts
 * @purpose Vitest test suite for the recent-files list and its settings persistence (FR-6.1).
 * @inputs Readonly arrays of RecentFile records, file paths, timestamps, JSON settings text, and KdocSettings objects.
 * @outputs Vitest assertions validating menu ordering, recording, eviction limits, pin toggling, forgetting, and serialization round-trip.
 * @functions
 *   - entry: Constructs a frozen RecentFile test record from path, pinned, and openedAt parameters.
 * @dataflow Test inputs -> recent-files operations (order, record, toggle, forget) & settings schema (parse, serialize) -> Vitest assertions.
 * @controlflow Execute test suites across orderRecentFiles, recordRecentFile, togglePinnedFile, forgetRecentFile, and the settings round trip.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import {
  RECENT_FILES_LIMIT,
  recordRecentFile,
  togglePinnedFile,
  forgetRecentFile,
  orderRecentFiles,
  type RecentFile,
} from '../src/settings/recent-files.js';
import { parseSettings, serializeSettings, DEFAULT_SETTINGS } from '../src/settings/schema.js';

/**
 * Constructs a frozen RecentFile test entry.
 *
 * @purpose Constructs a frozen RecentFile test record from path, pinned, and openedAt parameters.
 * @inputs path: string - File path string.
 * @inputs pinned: boolean - Flag indicating whether the file is pinned.
 * @inputs openedAt: number - Epoch millisecond timestamp of file access.
 * @outputs RecentFile - A frozen RecentFile record matching the input properties.
 * @dataflow path + pinned + openedAt -> Object.freeze -> frozen RecentFile object.
 * @controlflow Create object literal with properties -> freeze with Object.freeze -> return object.
 */
function entry(path: string, pinned: boolean, openedAt: number): RecentFile {
  return Object.freeze({
    path,
    pinned,
    openedAt,
  });
}

describe('orderRecentFiles', () => {
  it('pinned entries come first even when older', () => {
    // A pinned entry outranks a newer unpinned entry because that is what pinning means.
    const olderPinned = entry('/docs/pinned.md', true, 1);
    const newerUnpinned = entry('/docs/recent.md', false, 100);
    const result = orderRecentFiles([newerUnpinned, olderPinned]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(olderPinned);
    expect(result[1]).toEqual(newerUnpinned);
  });

  it('within a group, newest first', () => {
    // Within each group, entries are sorted descending by openedAt timestamp.
    const pinnedOlder = entry('/docs/p1.md', true, 10);
    const pinnedNewer = entry('/docs/p2.md', true, 50);
    const unpinnedOlder = entry('/docs/u1.md', false, 100);
    const unpinnedNewer = entry('/docs/u2.md', false, 500);

    const result = orderRecentFiles([pinnedOlder, unpinnedOlder, pinnedNewer, unpinnedNewer]);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(pinnedNewer);
    expect(result[1]).toEqual(pinnedOlder);
    expect(result[2]).toEqual(unpinnedNewer);
    expect(result[3]).toEqual(unpinnedOlder);
  });

  it('it does not mutate its input', () => {
    // The list is written into frozen settings and a mutating operation would change a
    // value another part of the program still believes it holds.
    const first = entry('/docs/older.md', false, 10);
    const second = entry('/docs/newer.md', false, 20);
    const input: RecentFile[] = [first, second];

    const result = orderRecentFiles(input);

    expect(input[0]).toBe(first);
    expect(input[1]).toBe(second);
    expect(result[0]).toBe(second);
    expect(result[1]).toBe(first);
  });
});

describe('recordRecentFile', () => {
  it('a new path is added', () => {
    const initial: readonly RecentFile[] = [];
    const result = recordRecentFile(initial, '/docs/new-file.md', 1000);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry('/docs/new-file.md', false, 1000));
  });

  it('an existing path is moved to the front rather than duplicated', () => {
    const step1 = recordRecentFile([], '/docs/a.md', 100);
    const step2 = recordRecentFile(step1, '/docs/b.md', 200);
    const step3 = recordRecentFile(step2, '/docs/a.md', 300);

    expect(step3).toHaveLength(2);
    expect(step3[0]?.path).toBe('/docs/a.md');
    expect(step3[0]?.openedAt).toBe(300);
    expect(step3[1]?.path).toBe('/docs/b.md');
    expect(step3[1]?.openedAt).toBe(200);
  });

  it('re-recording keeps the pin', () => {
    // Re-opening a file is not a reason to forget the user pinned it.
    const pinnedList: readonly RecentFile[] = [entry('/docs/a.md', true, 100)];
    const result = recordRecentFile(pinnedList, '/docs/a.md', 500);

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/docs/a.md');
    expect(result[0]?.pinned).toBe(true);
    expect(result[0]?.openedAt).toBe(500);
  });

  it('an empty or blank path is ignored', () => {
    const initial: readonly RecentFile[] = [entry('/docs/existing.md', false, 100)];
    const result = recordRecentFile(initial, '   ', 5);

    expect(result).toHaveLength(initial.length);
    expect(result).toEqual(initial);
  });

  it('the unpinned tail is capped', () => {
    let list: readonly RecentFile[] = [];
    const totalToRecord = RECENT_FILES_LIMIT + 5;

    for (let i = 1; i <= totalToRecord; i += 1) {
      list = recordRecentFile(list, `/docs/file-${i}.md`, i * 10);
    }

    expect(list).toHaveLength(RECENT_FILES_LIMIT);
    // Verify that the oldest 5 files (file-1 through file-5) are gone.
    for (let i = 1; i <= 5; i += 1) {
      const evictedPath = `/docs/file-${i}.md`;
      const found = list.some((item) => item.path === evictedPath);
      expect(found).toBe(false);
    }
    // Verify that the newest file is at index 0.
    expect(list[0]?.path).toBe(`/docs/file-${totalToRecord}.md`);
  });

  it('pinned entries are exempt from the cap', () => {
    // A limit that overrode a pin would make pinning a suggestion.
    const pinnedEntries: readonly RecentFile[] = [
      entry('/docs/pinned-1.md', true, 10),
      entry('/docs/pinned-2.md', true, 20),
      entry('/docs/pinned-3.md', true, 30),
    ];

    let list: readonly RecentFile[] = pinnedEntries;
    const unpinnedCount = RECENT_FILES_LIMIT + 3;

    for (let i = 1; i <= unpinnedCount; i += 1) {
      list = recordRecentFile(list, `/docs/unpinned-${i}.md`, 100 + i * 10);
    }

    expect(list).toHaveLength(3 + RECENT_FILES_LIMIT);
    // Verify that all three pinned entries survived.
    for (const pinned of pinnedEntries) {
      const found = list.some((item) => item.path === pinned.path && item.pinned);
      expect(found).toBe(true);
    }
  });
});

describe('togglePinnedFile', () => {
  it('it pins an unpinned entry and unpins a pinned one', () => {
    const initial: readonly RecentFile[] = [entry('/docs/note.md', false, 100)];

    const pinnedResult = togglePinnedFile(initial, '/docs/note.md');
    expect(pinnedResult[0]?.pinned).toBe(true);

    const unpinnedResult = togglePinnedFile(pinnedResult, '/docs/note.md');
    expect(unpinnedResult[0]?.pinned).toBe(false);
  });

  it('a path that is not in the list is left alone', () => {
    // Inventing an entry would be recording a file the user never opened.
    const initial: readonly RecentFile[] = [
      entry('/docs/a.md', false, 100),
      entry('/docs/b.md', true, 200),
    ];

    const result = togglePinnedFile(initial, '/docs/absent.md');

    expect(result).toHaveLength(initial.length);
    expect(result).toEqual(initial);
  });

  it('unpinning does not remove the entry', () => {
    // Removing it at the moment of the unpin would look like the unpin deleted it.
    const unpinnedList: RecentFile[] = [];
    for (let i = 1; i <= RECENT_FILES_LIMIT; i += 1) {
      unpinnedList.push(entry(`/docs/unpinned-${i}.md`, false, i * 10));
    }
    const pinned = entry('/docs/pinned.md', true, 500);
    const combined = orderRecentFiles([...unpinnedList, pinned]);

    const result = togglePinnedFile(combined, '/docs/pinned.md');

    expect(result).toHaveLength(RECENT_FILES_LIMIT + 1);
    const target = result.find((item) => item.path === '/docs/pinned.md');
    expect(target?.pinned).toBe(false);
  });
});

describe('forgetRecentFile', () => {
  it('it removes an unpinned entry', () => {
    const initial: readonly RecentFile[] = [
      entry('/docs/a.md', false, 100),
      entry('/docs/b.md', false, 200),
    ];

    const result = forgetRecentFile(initial, '/docs/a.md');

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/docs/b.md');
  });

  it('it removes a pinned one too', () => {
    // Forget is the user saying so explicitly, which outranks a pin.
    const initial: readonly RecentFile[] = [
      entry('/docs/pinned.md', true, 100),
      entry('/docs/other.md', false, 200),
    ];

    const result = forgetRecentFile(initial, '/docs/pinned.md');

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/docs/other.md');
  });

  it('a path that is not there changes nothing', () => {
    const initial: readonly RecentFile[] = [entry('/docs/a.md', false, 100)];

    const result = forgetRecentFile(initial, '/docs/absent.md');

    expect(result).toHaveLength(1);
    expect(result).toEqual(initial);
  });
});

describe('the settings round trip', () => {
  it('a recent-files list survives serialize and parse', () => {
    const file1 = entry('/docs/file1.md', true, 1000);
    const file2 = entry('/docs/file2.md', false, 2000);
    const customSettings = {
      ...DEFAULT_SETTINGS,
      general: {
        ...DEFAULT_SETTINGS.general,
        recentFiles: [file1, file2],
      },
    };

    const serialized = serializeSettings(customSettings);
    const parsed = parseSettings(serialized);

    expect(parsed.settings.general.recentFiles).toHaveLength(2);
    expect(parsed.settings.general.recentFiles[0]?.path).toBe(file1.path);
    expect(parsed.settings.general.recentFiles[0]?.pinned).toBe(file1.pinned);
    expect(parsed.settings.general.recentFiles[0]?.openedAt).toBe(file1.openedAt);
    expect(parsed.settings.general.recentFiles[1]?.path).toBe(file2.path);
    expect(parsed.settings.general.recentFiles[1]?.pinned).toBe(file2.pinned);
    expect(parsed.settings.general.recentFiles[1]?.openedAt).toBe(file2.openedAt);
  });

  it('a malformed entry is dropped and the rest survive', () => {
    // A settings file is one a user can edit by hand, and one bad line in
    // a list of ten should cost them that line rather than the whole list.
    const json = JSON.stringify({
      general: {
        recentFiles: [
          { path: '/docs/good1.md', pinned: true, openedAt: 1000 },
          42,
          { path: '' },
          // Well formed in every way except the path, which is blank. The earlier fixture was
          // rejected for its missing fields, so nothing had ever reached the path check.
          { path: '   ', pinned: false, openedAt: 3000 },
          { path: '/docs/good2.md', pinned: false, openedAt: 2000 },
        ],
      },
    });

    const parsed = parseSettings(json);

    expect(parsed.settings.general.recentFiles).toHaveLength(2);
    expect(parsed.settings.general.recentFiles[0]?.path).toBe('/docs/good1.md');
    expect(parsed.settings.general.recentFiles[1]?.path).toBe('/docs/good2.md');

    const droppedProblems = parsed.problems.filter((p) =>
      p.path.startsWith('general.recentFiles['),
    );
    expect(droppedProblems.length).toBe(3);
    // The two good entries survived intact -- one bad line costs that line, not the list.
    expect(parsed.settings.general.recentFiles.map((f) => f.path)).toEqual([
      '/docs/good1.md',
      '/docs/good2.md',
    ]);
  });

  it('a non-array recentFiles falls back to empty and reports it', () => {
    const json = JSON.stringify({
      general: {
        recentFiles: 'nope',
      },
    });

    const parsed = parseSettings(json);

    expect(parsed.settings.general.recentFiles).toEqual([]);
    const problem = parsed.problems.find((p) => p.path === 'general.recentFiles');
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('the default is an empty list', () => {
    // A user who has never opened a file sees an empty Open Recent rather than a missing one.
    expect(DEFAULT_SETTINGS.general.recentFiles).toHaveLength(0);
  });

  it('serialising rebuilds each entry field by field', () => {
    // A key that crept into the in-memory object never reaches the file.
    const entryWithExtra: RecentFile = Object.assign({}, entry('/docs/file.md', false, 1000), {
      extraKey: 'leakedValue',
    });

    const customSettings = {
      ...DEFAULT_SETTINGS,
      general: {
        ...DEFAULT_SETTINGS.general,
        recentFiles: [entryWithExtra],
      },
    };

    const serialized = serializeSettings(customSettings);

    expect(serialized).not.toContain('extraKey');
    expect(serialized).not.toContain('leakedValue');
  });
});
