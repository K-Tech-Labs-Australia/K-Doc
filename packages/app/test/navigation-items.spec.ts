/**
 * @file navigation-items.spec.ts
 * @purpose Exercises the pure navigation helpers in navigation-controller.ts: path equality, Quick Open list construction, and outline-to-heading mapping.
 * @inputs Frozen NOTES vault-note fixture; synthetic OutlineEntry arrays passed to headingItems; raw path strings passed to samePath and quickOpenItems.
 * @outputs Assertion outcomes via vitest expect; no exported values or persistent side effects.
 * @functions
 *   - describe('samePath'): asserts Windows/Mac case-insensitive path equality.
 *   - describe('quickOpenItems'): asserts open→recent→notes ordering, de-duplication, label/detail mapping, and result immutability.
 *   - describe('headingItems'): asserts index/level item mapping with an empty-heading fallback.
 * @dataflow Test fixtures → samePath/quickOpenItems/headingItems → PickerItem[] or boolean → expect assertions.
 * @controlflow Register three describe blocks; each it invokes one helper against its fixture and asserts the result.
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import type { OutlineEntry } from '@k-doc/core';
import { headingItems, quickOpenItems, samePath, type QuickOpenNote } from '../src/shell/navigation-controller.js';

const NOTES: readonly QuickOpenNote[] = [
  { path: '/v/a.md', relative: 'a.md', title: 'Alpha' },
  { path: '/v/b.md', relative: 'sub/b.md', title: 'Beta' },
];

describe('samePath', () => {
  // True when only separators and case differ so normalised forms compare equal; false when the filenames differ.
  it('compares paths tolerating Windows separators and case', () => {
    expect(samePath('C:\\Notes\\A.md', 'c:/notes/a.md')).toBe(true);
    expect(samePath('/a/b.md', '/a/c.md')).toBe(false);
  });
});

describe('quickOpenItems', () => {
  // Open tabs surface first, then recents, then vault notes, with no repeated ids.
  it('orders open, recent, and vault entries without duplicates', () => {
    const result = quickOpenItems(NOTES, ['/x/r.md', '/v/b.md'], ['/v/b.md', '/y/t.md'], null);
    expect(result.map((item) => item.id)).toEqual(['/v/b.md', '/y/t.md', '/x/r.md', '/v/a.md']);
  });

  // Vault notes keep their title and relative detail; plain files show their base name and full path.
  it('labels vault notes by title/relative and other files by basename/full path', () => {
    const result = quickOpenItems(NOTES, ['/x/r.md', '/v/b.md'], ['/v/b.md', '/y/t.md'], null);
    const beta = result.find((item) => item.id === '/v/b.md');
    expect(beta?.label).toBe('Beta');
    expect(beta?.detail).toBe('sub/b.md');
    const yt = result.find((item) => item.id === '/y/t.md');
    expect(yt?.label).toBe('t.md');
    expect(yt?.detail).toBe('/y/t.md');
  });

  // A Windows path yields its trailing filename while retaining the original full path as detail.
  it('extracts a base name from a Windows path', () => {
    const items = quickOpenItems([], ['C:\\docs\\w.md'], [], null);
    expect(items[0]?.label).toBe('w.md');
    expect(items[0]?.detail).toBe('C:\\docs\\w.md');
  });

  // A bare filename with no separator is its own base name.
  it('treats a separator-less path as its own base name', () => {
    expect(quickOpenItems([], ['loose.md'], [], null)[0]?.label).toBe('loose.md');
  });

  // The active document is excluded, matched loosely by case and separators.
  it('omits the current document regardless of case or separator style', () => {
    const result = quickOpenItems([{ path: 'c:/v/a.md', relative: 'a.md', title: 'A' }], [], [], 'C:\\V\\A.md');
    expect(result).toEqual([]);
  });

  // Paths differing only in case or separator collapse to the first occurrence.
  it('de-dupes paths that differ only by case or separator, keeping the first', () => {
    const result = quickOpenItems([], ['c:/v/a.md'], ['C:\\v\\a.md'], null);
    expect(result.map((item) => item.id)).toEqual(['C:\\v\\a.md']);
  });

  // A vault note surfaced through a tab still carries its title and relative detail.
  it('keeps the vault-note metadata when reached via an open tab', () => {
    const items = quickOpenItems([{ path: '/v/a.md', relative: 'a.md', title: 'Alpha' }], [], ['/V/A.md'], null);
    expect(items[0]?.id).toBe('/V/A.md');
    expect(items[0]?.label).toBe('Alpha');
  });

  // The assembled list is frozen so callers cannot mutate the picker contents.
  it('freezes the returned item list', () => {
    expect(Object.isFrozen(quickOpenItems(NOTES, [], [], null))).toBe(true);
  });
});

describe('headingItems', () => {
  // Each entry maps to its index id, heading text (or fallback), and H{level} detail.
  it('maps entries by index with an empty-heading placeholder', () => {
    const entries: OutlineEntry[] = [
      { depth: 1, text: 'One', start: 0, end: 5, index: 0 },
      { depth: 3, text: '', start: 7, end: 11, index: 1 },
    ];
    expect(headingItems(entries)).toEqual([
      { id: '0', label: 'One', detail: 'H1' },
      { id: '1', label: 'Untitled heading', detail: 'H3' },
    ]);
  });
});