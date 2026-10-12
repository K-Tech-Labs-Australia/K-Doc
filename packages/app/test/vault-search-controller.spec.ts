/**
 * @file vault-search-controller.spec.ts
 * @purpose Unit tests for the application-side vault-wide find-and-replace controller, exercising search, replace, and undo over injected in-memory I/O.
 * @inputs A readonly list of note paths per test; an in-memory harness providing open tabs, disk entries, and ordered read/write/notify traces.
 * @outputs Asserted outcomes: match counts, file listings, unreadable notes, replace reports, undo reports, and the recorded I/O traces.
 * @functions
 *   - harness: Builds a controller wired to in-memory maps and trace arrays for one test's set of note paths.
 *   - signal: Returns a fresh AbortSignal so each search can be cancelled independently.
 *   - request: Builds a ReplaceRequest with empty options, keeping the replace tests terse.
 * @dataflow Test note paths -> harness I/O stubs -> controller methods (search/replace/undo) -> pure engine -> trace arrays and maps -> expect assertions.
 * @controlflow For each test: build harness, seed open/disk state, invoke a controller method, assert the report and traces; abort or forget where specified.
 * @version 1
 * @date 2026-09-14
 */

import { createVaultSearchController, type ReplaceRequest } from '../src/shell/vault-search-controller.js';
import { InvalidQueryError } from '@k-doc/core';
import { describe, expect, it } from 'vitest';

/** A note's text on disk together with the encoding it was read and must be written back in. */
interface DiskEntry {
  /** The note's contents as stored on disk. */
  readonly contents: string;
  /** The encoding the note was found in, reused when writing it back. */
  readonly encoding: string;
}

/**
 * Builds a controller wired to in-memory maps and trace arrays for one test's set of note paths.
 *
 * @purpose Provides isolated open tabs, disk entries, and ordered read/write/notify traces so each test asserts exact behavior without real I/O.
 * @inputs notes - The absolute note paths this harness should expose via the controller's notes() list.
 * @outputs A controller plus every map and trace (open, disk, reads, saves, tabWrites, written, failSave) a test can assert against.
 * @dataflow Test notes -> controller methods -> stubbed I/O append to the trace arrays/maps -> assertions read them back.
 * @controlflow Declare maps and traces -> wire createVaultSearchController to them via stub callbacks -> return the controller and all traces.
 */
const harness = (notes: readonly string[]) => {
  // Open tabs, keyed by absolute path, holding the text currently shown in each tab.
  const open = new Map<string, string>();
  // Disk contents keyed by absolute path, paired with the encoding to write back.
  const disk = new Map<string, DiskEntry>();
  // Every path passed to readFile, in call order, so tests can assert read caching and re-reading.
  const reads: string[] = [];
  // Every successful saveFile call, capturing what was written and in which encoding.
  const saves: { readonly path: string; readonly contents: string; readonly encoding: string }[] = [];
  // Every writeOpen call, capturing the tab edits made to open notes.
  const tabWrites: { readonly path: string; readonly text: string }[] = [];
  // Every onWritten notification, so tests can confirm the vault index was told about disk rewrites.
  const written: { readonly path: string; readonly text: string }[] = [];
  // Paths whose saveFile is made to reject, simulating an unwritable note.
  const failSave = new Set<string>();

  const controller = createVaultSearchController({
    notes: () => notes.map((path) => ({ path, relative: path.replace('/v/', '') })),
    openText: (path) => open.get(path) ?? null,
    writeOpen: (path, text) => {
      // Record the tab edit before applying it so trace order matches call order.
      tabWrites.push({ path, text });
      open.set(path, text);
    },
    readFile: async (path) => {
      reads.push(path);
      const entry = disk.get(path);
      if (entry === undefined) {
        // No disk entry exists for this note: surface a missing-file error the controller reports as unreadable.
        throw new Error(`missing ${path}`);
      } else {
        // Entry present: return its contents and encoding to the caller.
        return { contents: entry.contents, encoding: entry.encoding };
      }
    },
    saveFile: async (target) => {
      if (failSave.has(target.path)) {
        // This path is flagged as unwritable: reject so the controller records a failure and moves on.
        throw new Error('denied');
      } else {
        // Writable: record the save and update the disk copy in its reported encoding.
        saves.push({ ...target });
        disk.set(target.path, { contents: target.contents, encoding: target.encoding });
      }
    },
    onWritten: (path, text) => {
      written.push({ path, text });
    },
  });

  return { controller, open, disk, reads, saves, tabWrites, written, failSave };
};

/**
 * Returns a fresh AbortSignal for one search so cancellation can be tested in isolation.
 *
 * @purpose Supplies an independent signal per test without leaking state between assertions.
 * @inputs none.
 * @outputs AbortSignal - A new, not-yet-aborted signal.
 * @dataflow new AbortController -> its public signal exposed to the caller.
 * @controlflow Construct a controller and return its signal; never aborts on its own.
 */
const signal = (): AbortSignal => new AbortController().signal;

/** Absolute paths of the notes used across the suite. */
const A = '/v/a.md';
const B = '/v/b.md';

/**
 * Builds a ReplaceRequest for a single note, defaulting the query to 'foo' and options to empty.
 *
 * @purpose Collapses the common single-note replace shape into one call so tests stay short.
 * @inputs path - The note path whose matches are selected. ranges - The chosen [start, end) match ranges for that note. replacement - The replacement template applied to each chosen match. query - The original search query; defaults to 'foo'.
 * @outputs ReplaceRequest - A request with empty options and a one-entry selections map.
 * @dataflow path, ranges, replacement, query -> a single ReplaceRequest object.
 * @controlflow Assemble the fields into a request object and return it.
 */
const request = (
  path: string,
  ranges: readonly { start: number; end: number }[],
  replacement: string,
  query = 'foo',
): ReplaceRequest => ({
  // Empty options keep every replace a plain literal search unless a test opts into regex.
  options: {},
  query,
  replacement,
  selections: new Map<string, readonly { start: number; end: number }[]>([[path, ranges]]),
});

describe('search', () => {
  it('searches an open note tab text, not its file', async () => {
    const h = harness([A]);
    // The tab holds 'foo' while the disk copy differs; a search must read the tab.
    h.open.set(A, 'foo');
    h.disk.set(A, { contents: 'bar', encoding: 'utf-8' });

    const r = await h.controller.search('foo', {}, signal());

    // One match found in the tab text and no disk read performed because the note is open.
    expect(r.totalMatches).toBe(1);
    expect(h.reads).toEqual([]);
  });

  it('reads closed notes once and remembers them', async () => {
    const h = harness([A, B]);
    // Seed both closed notes on disk before the first search.
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });
    h.disk.set(B, { contents: 'foo foo', encoding: 'utf-8' });

    const first = await h.controller.search('foo', {}, signal());

    // Results listed in vault order; A has one match and B two, for three total.
    expect(first.files.map((f) => f.relative)).toEqual(['a.md', 'b.md']);
    expect(first.totalMatches).toBe(3);

    // A second identical search reuses the cached disk text instead of re-reading.
    await h.controller.search('foo', {}, signal());
    expect(h.reads).toEqual([A, B]);
  });

  it('forgets one note, or all', async () => {
    const h = harness([A, B]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });
    h.disk.set(B, { contents: 'foo', encoding: 'utf-8' });

    // First search reads and caches both notes.
    await h.controller.search('foo', {}, signal());
    // Forgetting A drops only its cache; the next search re-reads just A.
    h.controller.forget(A);
    await h.controller.search('foo', {}, signal());
    expect(h.reads).toEqual([A, B, A]);

    // Forgetting everything forces both notes to be read again on the following search.
    h.controller.forget();
    await h.controller.search('foo', {}, signal());
    expect(h.reads).toEqual([A, B, A, A, B]);
  });

  it('reports a note it could not read and searches the rest', async () => {
    const h = harness([A, B]);
    // Only B is present on disk; A has no entry so its read fails.
    h.disk.set(B, { contents: 'foo', encoding: 'utf-8' });

    const r = await h.controller.search('foo', {}, signal());

    // A is reported unreadable with the missing-file reason and excluded from the file list.
    expect(r.unreadable).toEqual([{ path: A, message: `missing ${A}` }]);
    expect(r.files.map((f) => f.path)).toEqual([B]);
  });

  it('rejects a malformed regex before reading anything', async () => {
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });

    // An unterminated group is an invalid pattern; the search must fail fast with no disk read.
    await expect(h.controller.search('(', { regex: true }, signal())).rejects.toThrow(InvalidQueryError);
    expect(h.reads).toEqual([]);
  });

  it('rejects with the abort reason, keeping what it read', async () => {
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });

    // Start a search and immediately abort it; the in-flight read still completes and is cached.
    const ac = new AbortController();
    const pending = h.controller.search('foo', {}, ac.signal);
    ac.abort(new Error('superseded'));
    await expect(pending).rejects.toThrow('superseded');

    // The superseded search's read was remembered, so the next search performs no additional disk read.
    const r = await h.controller.search('foo', {}, signal());
    expect(r.totalMatches).toBe(1);
    expect(h.reads).toEqual([A]);
  });

  it('prefers a tab opened since the note was read from disk', async (): Promise<void> => {
    // A tab opened after the disk read wins over the cached disk text for searching.
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo foo', encoding: 'utf-8' });
    await h.controller.search('foo', {}, signal());
    h.open.set(A, 'foo');
    const r = await h.controller.search('foo', {}, signal());
    expect(r.totalMatches).toBe(1);
  });

  it('remembers the text a replace wrote, without reading the note again', async (): Promise<void> => {
    // A replace updates the remembered text so the next search counts matches without re-reading.
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo foo', encoding: 'utf-8' });
    await h.controller.search('foo', {}, signal());
    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));
    const r = await h.controller.search('foo', {}, signal());
    expect(r.totalMatches).toBe(1);
    expect(h.reads).toEqual([A, A]);
  });

  it('remembers the text an undo put back, without reading the note again', async (): Promise<void> => {
    // Undo restores the original text, which search then counts again without re-reading.
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo foo', encoding: 'utf-8' });
    await h.controller.search('foo', {}, signal());
    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));
    await h.controller.undoLastReplace();
    const r = await h.controller.search('foo', {}, signal());
    expect(r.totalMatches).toBe(2);
    expect(h.reads).toEqual([A, A, A]);
  });
});

describe('replace', () => {
  it('changes an open note in its tab, not on disk', async () => {
    const h = harness([A]);
    // The open tab holds two 'foo' occurrences; only the second is selected.
    h.open.set(A, 'foo foo');

    const report = await h.controller.replace(request(A, [{ start: 4, end: 7 }], 'bar'));

    // One match replaced in one file; because the note is open nothing is saved or reported to the index.
    expect(report).toEqual({ replaced: 1, files: 1, stale: 0, failures: [] });
    expect(h.tabWrites).toEqual([{ path: A, text: 'foo bar' }]);
    expect(h.saves).toEqual([]);
    expect(h.written).toEqual([]);
  });

  it('rewrites a closed note in its own encoding and tells the index', async () => {
    const h = harness([A]);
    // A closed note stored as UTF-16LE must be written back in that same encoding.
    h.disk.set(A, { contents: 'foo foo', encoding: 'utf-16le' });

    const report = await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));

    // One match replaced; the save carries the original encoding and the index is notified of the new text.
    expect(report).toEqual({ replaced: 1, files: 1, stale: 0, failures: [] });
    expect(h.saves).toEqual([{ path: A, contents: 'bar foo', encoding: 'utf-16le' }]);
    expect(h.written).toEqual([{ path: A, text: 'bar foo' }]);
  });

  it('reads a closed note fresh, leaving a match that moved since the search', async () => {
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo foo', encoding: 'utf-8' });

    // The search caches the original text; the disk copy then changes so the chosen range no longer matches.
    await h.controller.search('foo', {}, signal());
    h.disk.set(A, { contents: 'xfoo foo', encoding: 'utf-8' });

    const report = await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));

    // The match is stale from the fresh read: nothing replaced, nothing saved, and no undo entry recorded.
    expect(report).toEqual({ replaced: 0, files: 0, stale: 1, failures: [] });
    expect(h.saves).toEqual([]);
    expect(h.controller.canUndo).toBe(false);
  });

  it('reports a file it could not write and carries on', async () => {
    const h = harness([A, B]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });
    h.disk.set(B, { contents: 'foo', encoding: 'utf-8' });
    // A is made unwritable; B must still be rewritten.
    h.failSave.add(A);

    const report = await h.controller.replace({
      query: 'foo',
      options: {},
      replacement: 'bar',
      selections: new Map<string, readonly { start: number; end: number }[]>([
        [A, [{ start: 0, end: 3 }]],
        [B, [{ start: 0, end: 3 }]],
      ]),
    });

    // A fails with the save's denial message while B is rewritten on disk.
    expect(report).toEqual({ replaced: 1, files: 1, stale: 0, failures: [{ path: A, message: 'denied' }] });
    expect(h.disk.get(B)?.contents).toBe('bar');
  });

  it('skips a note with nothing chosen', async () => {
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });

    // An empty selection list means "leave this note alone", so no read or write occurs.
    const report = await h.controller.replace(request(A, [], 'bar'));

    expect(report).toEqual({ replaced: 0, files: 0, stale: 0, failures: [] });
    expect(h.reads).toEqual([]);
  });

  it('rejects a malformed regex before touching a note', async () => {
    const h = harness([A]);
    h.open.set(A, 'foo');

    // A bad pattern with regex mode must fail fast without editing the open tab.
    await expect(
      h.controller.replace({
        query: '(',
        options: { regex: true },
        replacement: 'x',
        selections: new Map<string, readonly { start: number; end: number }[]>([[A, [{ start: 0, end: 3 }]]]),
      }),
    ).rejects.toThrow(InvalidQueryError);
    expect(h.tabWrites).toEqual([]);
  });
});

describe('undoLastReplace', () => {
  it('has nothing to undo at first', async () => {
    const h = harness([A]);

    // No replace has run yet: undo is unavailable and returns null.
    expect(h.controller.canUndo).toBe(false);
    expect(await h.controller.undoLastReplace()).toBeNull();
  });

  it('puts back open and closed notes', async () => {
    const h = harness([A, B]);
    // A is open; B is a closed UTF-16BE note.
    h.open.set(A, 'foo');
    h.disk.set(B, { contents: 'foo', encoding: 'utf-16be' });

    await h.controller.replace({
      query: 'foo',
      options: {},
      replacement: 'bar',
      selections: new Map<string, readonly { start: number; end: number }[]>([
        [A, [{ start: 0, end: 3 }]],
        [B, [{ start: 0, end: 3 }]],
      ]),
    });

    // A real replace is now undoable.
    expect(h.controller.canUndo).toBe(true);

    const undo = await h.controller.undoLastReplace();

    // Both notes are restored to their pre-replace text; the closed note's save and index notification carry the original encoding/text.
    expect(undo).toEqual({ restored: 2, skipped: 0, failures: [] });
    expect(h.open.get(A)).toBe('foo');
    expect(h.disk.get(B)).toEqual({ contents: 'foo', encoding: 'utf-16be' });
    expect(h.written.at(-1)).toEqual({ path: B, text: 'foo' });

    // The log is drained after one undo, so a second undo finds nothing.
    expect(h.controller.canUndo).toBe(false);
    expect(await h.controller.undoLastReplace()).toBeNull();
  });

  it('leaves alone a note edited since the replace', async () => {
    const h = harness([A]);
    h.open.set(A, 'foo');

    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));
    // The user edits the tab after the replace; their newer change must win on undo.
    h.open.set(A, 'bar!');

    const undo = await h.controller.undoLastReplace();

    // The edited note is skipped rather than reverted, leaving the user's text intact.
    expect(undo).toEqual({ restored: 0, skipped: 1, failures: [] });
    expect(h.open.get(A)).toBe('bar!');
  });

  it('keeps the last real replace when a later one changed nothing', async () => {
    const h = harness([A]);
    h.open.set(A, 'foo');

    // First replace succeeds and is logged.
    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));
    // Second replace targets the same range but 'foo' no longer matches, so it changes nothing.
    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'baz'));

    // The stale second run does not overwrite the undo log of the first real run.
    expect(h.controller.canUndo).toBe(true);
    await h.controller.undoLastReplace();

    // Undoing restores the text from the last successful replace only.
    expect(h.open.get(A)).toBe('foo');
  });

  it('keeps each controller memory to itself', async () => {
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });

    // A second controller shares the same disk read trace but keeps its own cache.
    const second = createVaultSearchController({
      notes: () => [{ path: A, relative: 'a.md' }],
      openText: () => null,
      writeOpen: () => undefined,
      readFile: async (path) => {
        h.reads.push(path);
        return { contents: 'foo', encoding: 'utf-8' };
      },
      saveFile: async () => undefined,
      onWritten: () => undefined,
    });

    await h.controller.search('foo', {}, signal());
    // The second controller has no cache of its own, so it reads A again through the shared trace.
    await second.search('foo', {}, signal());
    expect(h.reads).toEqual([A, A]);
  });

  it('leaves alone a closed note changed on disk since the replace', async (): Promise<void> => {
    // The closed note changed on disk after the replace, so undo skips rather than reverts it.
    const h = harness([A]);
    h.disk.set(A, { contents: 'foo', encoding: 'utf-8' });
    await h.controller.replace(request(A, [{ start: 0, end: 3 }], 'bar'));
    h.disk.set(A, { contents: 'bar!', encoding: 'utf-8' });
    const undo = await h.controller.undoLastReplace();
    expect(undo).toEqual({ restored: 0, skipped: 1, failures: [] });
    expect(h.disk.get(A)?.contents).toBe('bar!');
    expect(h.saves.length).toBe(1);
  });
});
