/**
 * @file vault-search.spec.ts
 * @purpose Unit tests for the pure vault-search module: snippet trimming with ellipses and CRLF handling, per-file search with 1-based line/column annotation under a limit, multi-file aggregation under a global cap with truncation reporting, and selective replacement with staleness detection.
 * @inputs Vitest runner; the vault-search implementation (snippetAt, searchFile, searchFiles, replaceSelected), InvalidQueryError, MAX_VAULT_MATCHES, and SearchableFile fixtures.
 * @outputs Test results asserting exact MatchSnippet records, FileMatch rows, VaultSearchResult aggregation, and ReplaceOutcome records across 30 cases in four describe suites.
 * @functions
 *   - None exported; contains four describe suites exercising the module: snippetAt (cases 1-10), searchFile (11-16), searchFiles (17-22), replaceSelected (23-30).
 * @dataflow SearchableFile fixtures + query + options + selected offset pairs → vault-search functions → asserted result values.
 * @controlflow Each it() runs one self-contained scenario with fixed inputs and asserts the exact expected output via toEqual/toBe/toThrow; no shared mutable state between cases.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { InvalidQueryError } from '../src/search/search.js';
import type { SearchableFile } from '../src/search/vault-search.js';
import { MAX_VAULT_MATCHES, replaceSelected, searchFile, searchFiles, snippetAt } from '../src/search/vault-search.js';

describe('snippetAt', () => {
  it('keeps the line before the match', () => {
    expect(snippetAt('hello world', 6, 11)).toEqual({ before: 'hello ', match: 'world', after: '' });
  });

  it('drops leading indentation', () => {
    expect(snippetAt('  indented word', 11, 15)).toEqual({ before: 'indented ', match: 'word', after: '' });
  });

  it('stays inside the match line', () => {
    expect(snippetAt('one\ntwo three\nfour', 8, 13)).toEqual({ before: 'two ', match: 'three', after: '' });
  });

  it('cuts a match that runs past its line', () => {
    expect(snippetAt('ab\ncd', 1, 4)).toEqual({ before: 'a', match: 'b…', after: '' });
  });

  it('marks cut leading context', () => {
    const text = 'x'.repeat(50) + 'hit';
    expect(snippetAt(text, 50, 53)).toEqual({ before: '…' + 'x'.repeat(40), match: 'hit', after: '' });
  });

  it('marks cut trailing context', () => {
    expect(snippetAt('hit' + 'y'.repeat(50), 0, 3)).toEqual({ before: '', match: 'hit', after: 'y'.repeat(40) + '…' });
  });

  it('does not mark trailing context that reaches the line end exactly', () => {
    expect(snippetAt('hit' + 'y'.repeat(40), 0, 3).after).toBe('y'.repeat(40));
  });

  it('does not mark leading context that starts exactly at the line start', () => {
    expect(snippetAt('x'.repeat(40) + 'hit', 40, 43).before).toBe('x'.repeat(40));
  });

  it('hides a CRLF carriage return after the match', () => {
    expect(snippetAt('a hit\r\nnext', 2, 5)).toEqual({ before: 'a ', match: 'hit', after: '' });
  });

  it('hides a carriage return inside a cut match', () => {
    expect(snippetAt('hit\r\nx', 0, 6).match).toBe('hit…');
  });
});

describe('searchFile', () => {
  const file: SearchableFile = { path: '/v/a.md', relative: 'a.md', text: 'x\nfoo foo\nfoo' };

  it('reports line and column of each match', () => {
    const r = searchFile(file, 'foo', {}, 10);
    expect(r.path).toBe('/v/a.md');
    expect(r.relative).toBe('a.md');
    expect(r.matches.map((m) => [m.start, m.end, m.line, m.column])).toEqual([
      [2, 5, 2, 1],
      [6, 9, 2, 5],
      [10, 13, 3, 1],
    ]);
  });

  it('carries a snippet per match', () => {
    expect(searchFile(file, 'foo', {}, 10).matches.map((m) => m.snippet)).toEqual([
      { before: '', match: 'foo', after: ' foo' },
      { before: 'foo ', match: 'foo', after: '' },
      { before: '', match: 'foo', after: '' },
    ]);
  });

  it('stops at the limit', () => {
    expect(searchFile(file, 'foo', {}, 2).matches.length).toBe(2);
  });

  it('counts CRLF lines', () => {
    expect(
      searchFile({ path: 'p', relative: 'p', text: 'a\r\nfoo' }, 'foo', {}, 10).matches.map((m) => [m.line, m.column])
    ).toEqual([[2, 1]]);
  });

  it('returns no matches for a file without the query', () => {
    expect(searchFile(file, 'zzz', {}, 10).matches).toEqual([]);
  });

  it('throws InvalidQueryError for a malformed regex', () => {
    expect(() => searchFile(file, '(', { regex: true }, 10)).toThrow(InvalidQueryError);
  });
});

describe('searchFiles', () => {
  const a: SearchableFile = { path: '/v/a.md', relative: 'a.md', text: 'foo' };
  const b: SearchableFile = { path: '/v/b.md', relative: 'b.md', text: 'bar' };
  const c: SearchableFile = { path: '/v/c.md', relative: 'c.md', text: 'foo foo' };

  it('lists only files that matched, in order', () => {
    const r = searchFiles([a, b, c], 'foo', {});
    expect(r.files.map((f) => f.relative)).toEqual(['a.md', 'c.md']);
    expect(r.totalMatches).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('stops inside a file at the limit and says so', () => {
    const r = searchFiles([a, b, c], 'foo', {}, 2);
    expect(r.files.map((f) => [f.relative, f.matches.length])).toEqual([
      ['a.md', 1],
      ['c.md', 1],
    ]);
    expect(r.totalMatches).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it('is not truncated when the limit is met by the last match there is', () => {
    const r = searchFiles([a, b, c], 'foo', {}, 3);
    expect(r.totalMatches).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('is truncated when the limit is met with files left unsearched', () => {
    const r = searchFiles([c, a], 'foo', {}, 2);
    expect(r.files.map((f) => f.relative)).toEqual(['c.md']);
    expect(r.truncated).toBe(true);
  });

  it('caps a vault search at MAX_VAULT_MATCHES by default', () => {
    const big: SearchableFile = { path: 'big', relative: 'big', text: 'a '.repeat(MAX_VAULT_MATCHES + 1) };
    const r = searchFiles([big], 'a', {});
    expect(r.totalMatches).toBe(MAX_VAULT_MATCHES);
    expect(r.truncated).toBe(true);
  });

  it('finds nothing for an empty query', () => {
    expect(searchFiles([a, c], '', {})).toEqual({ files: [], totalMatches: 0, truncated: false });
  });

  it('is not truncated when the limit is met and the files left have no matches', () => {
    // Only a match left out makes a result truncated; a file with nothing to show does not.
    const r = searchFiles([c, b], 'foo', {}, 2);
    expect(r.totalMatches).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it('is truncated by a later file whose matches none of the budget was left for', () => {
    const r = searchFiles([c, b, a], 'foo', {}, 2);
    expect(r.files.map((f) => f.relative)).toEqual(['c.md']);
    expect(r.truncated).toBe(true);
  });
});

describe('replaceSelected', () => {
  it('replaces only the chosen match', () => {
    expect(replaceSelected('a foo b foo', 'foo', {}, 'bar', [{ start: 8, end: 11 }])).toEqual({
      text: 'a foo b bar',
      replaced: 1,
      stale: 0,
    });
  });

  it('replaces every chosen match', () => {
    expect(replaceSelected('a foo b foo', 'foo', {}, 'bar', [{ start: 2, end: 5 }, { start: 8, end: 11 }])).toEqual({
      text: 'a bar b bar',
      replaced: 2,
      stale: 0,
    });
  });

  it('keeps later offsets right when a replacement changes length', () => {
    expect(
      replaceSelected('foo foo foo', 'foo', {}, 'longer', [{ start: 0, end: 3 }, { start: 8, end: 11 }])
    ).toEqual({
      text: 'longer foo longer',
      replaced: 2,
      stale: 0,
    });
  });

  it('leaves a match that moved since the search and counts it stale', () => {
    expect(replaceSelected('xx a foo', 'foo', {}, 'bar', [{ start: 2, end: 5 }])).toEqual({
      text: 'xx a foo',
      replaced: 0,
      stale: 1,
    });
  });

  it('expands capture groups in regex mode', () => {
    expect(replaceSelected('k=v', '(\\w)=(\\w)', { regex: true }, '$2=$1', [{ start: 0, end: 3 }]).text).toBe('v=k');
  });

  it('honours case sensitivity when checking a match is still there', () => {
    expect(replaceSelected('Foo foo', 'foo', { caseSensitive: true }, 'x', [{ start: 0, end: 3 }])).toEqual({
      text: 'Foo foo',
      replaced: 0,
      stale: 1,
    });
  });

  it('counts a match chosen twice once', () => {
    expect(replaceSelected('foo', 'foo', {}, 'x', [{ start: 0, end: 3 }, { start: 0, end: 3 }])).toEqual({
      text: 'x',
      replaced: 1,
      stale: 0,
    });
  });

  it('changes nothing when nothing is chosen', () => {
    expect(replaceSelected('foo', 'foo', {}, 'x', [])).toEqual({ text: 'foo', replaced: 0, stale: 0 });
  });
});
