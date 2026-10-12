/**
 * @file vault-query.test.ts
 * @purpose Vitest test suite for vault index queries in @k-doc/core (FR-8.12, FR-14.6).
 *   Verifies tag aggregation counting distinct notes per tag with stable tiebreaks,
 *   hierarchical tag filtering matching exact and parent paths, and multi-signal
 *   relevance search scoring across title, tags, path, and capped headings.
 * @inputs NoteIndexEntry fixture records and query strings for tags and full-text search.
 * @outputs Vitest test assertions verifying tagCounts, notesTagged, and searchNotes behaviors.
 * @functions
 *   - heading: Constructs an OutlineEntry test helper fixture with depth 2.
 *   - note: Constructs a NoteIndexEntry test helper fixture with path, title, tags, and headings.
 * @dataflow Test fixture notes → query functions (tagCounts, notesTagged, searchNotes) → assertion checks against expected matches and scores.
 * @controlflow Execute test suites for tagCounts (counting, sorting, empty), notesTagged (exact, hash prefix, nested tags, boundary checks, ordering), and searchNotes (scoring hierarchy, caps, context, limit handling, tiebreaks).
 * @version 2
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { tagCounts, notesTagged, searchNotes } from './vault-query.js';
import type { TagCount, NoteMatch } from './vault-query.js';
import type { NoteIndexEntry } from './note-index.js';
import type { OutlineEntry } from '../outline/outline.js';

/**
 * Constructs an OutlineEntry test helper fixture.
 *
 * @purpose Builds a mock OutlineEntry with depth 2 and specified text for vault query testing.
 * @inputs text - Heading title string.
 * @outputs OutlineEntry - Constructed heading outline entry fixture with depth 2.
 * @dataflow text string → assemble OutlineEntry object → return fixture.
 * @controlflow Construct OutlineEntry object literal with fixed depth 2, offsets, index, and provided text → return.
 */
function heading(text: string): OutlineEntry {
  return { depth: 2, text, start: 0, end: 1, index: 0 };
}

/**
 * Constructs a NoteIndexEntry test helper fixture.
 *
 * @purpose Builds a mock NoteIndexEntry with relative path, title, and optional tags or headings.
 * @inputs relative - Relative path within the vault.
 * @inputs title - Display title of the note.
 * @inputs extras - Optional object specifying tags and headings arrays.
 * @outputs NoteIndexEntry - Complete NoteIndexEntry fixture object.
 * @dataflow relative + title + extras → assemble NoteIndexEntry record → return fixture.
 * @controlflow Extract or default headings and tags → assemble NoteIndexEntry with prepended /vault/ path, relative path, title, and empty links/frontMatter → return.
 */
function note(
  relative: string,
  title: string,
  extras?: { readonly tags?: readonly string[]; readonly headings?: readonly OutlineEntry[] },
): NoteIndexEntry {
  let headings: readonly OutlineEntry[] = [];
  // Check if custom headings are provided in extras.
  if (extras !== undefined && extras.headings !== undefined) {
    // Use provided headings array.
    headings = extras.headings;
  } else {
    // Default to empty headings array.
    headings = [];
  }

  let tags: readonly string[] = [];
  // Check if custom tags are provided in extras.
  if (extras !== undefined && extras.tags !== undefined) {
    // Use provided tags array.
    tags = extras.tags;
  } else {
    // Default to empty tags array.
    tags = [];
  }

  return {
    path: '/vault/' + relative,
    relative,
    title,
    headings,
    links: [],
    tags,
    frontMatter: {},
  };
}

describe('tagCounts', (): void => {
  it('counts notes, not occurrences', (): void => {
    // a note that says #todo five times is still one note to visit, and the tags on an entry are already distinct.
    const noteA = note('a.md', 'A', { tags: ['todo', 'idea'] });
    const noteB = note('b.md', 'B', { tags: ['todo'] });
    const counts: readonly TagCount[] = tagCounts([noteA, noteB]);
    expect(counts).toEqual([
      { tag: 'todo', count: 2 },
      { tag: 'idea', count: 1 },
    ]);
  });

  it('sorts by count, then by tag', (): void => {
    // a panel that reordered itself between runs would look broken.
    const noteZ = note('z.md', 'Z', { tags: ['zz'] });
    const noteA = note('a.md', 'A', { tags: ['aa'] });
    const noteBoth = note('both.md', 'Both', { tags: ['zz', 'aa', 'common'] });
    const counts: readonly TagCount[] = tagCounts([noteZ, noteA, noteBoth]);
    expect(counts).toEqual([
      { tag: 'aa', count: 2 },
      { tag: 'zz', count: 2 },
      { tag: 'common', count: 1 },
    ]);
  });

  it('is empty for no notes', (): void => {
    expect(tagCounts([])).toEqual([]);
  });
});

describe('notesTagged', (): void => {
  const plain = note('plain.md', 'Plain', { tags: ['work'] });
  const nested = note('nested.md', 'Nested', { tags: ['work/urgent'] });
  const other = note('other.md', 'Other', { tags: ['home'] });
  const all = [other, nested, plain];

  it('finds an exact tag', (): void => {
    const results = notesTagged(all, 'home');
    expect(results).toHaveLength(1);
    expect(results[0]!).toBe(other);
  });

  it('accepts a tag written with or without its hash', (): void => {
    // a caller passing #todo and one passing todo mean the same thing.
    expect(notesTagged(all, '#home')).toHaveLength(1);
    expect(notesTagged(all, 'home')).toHaveLength(1);
  });

  it('finds nested tags under their parent', (): void => {
    // nested tags are a hierarchy, and clicking work that did not show work/urgent would hide notes the user was looking for.
    const results = notesTagged(all, 'work');
    expect(results).toHaveLength(2);
    expect(results.map((n: NoteIndexEntry): string => n.relative)).toEqual([
      'nested.md',
      'plain.md',
    ]);
  });

  it('does not match a tag that merely starts the same', (): void => {
    // the separator is what makes it a child; workshop is a different tag that happens to begin with the same letters.
    const workshopNote = note('workshop.md', 'Workshop', { tags: ['workshop'] });
    const results = notesTagged([workshopNote], 'work');
    expect(results).toEqual([]);
  });

  it('is empty for an empty tag', (): void => {
    expect(notesTagged(all, '')).toEqual([]);
    expect(notesTagged(all, '#')).toEqual([]);
  });

  it('orders by path', (): void => {
    const results = notesTagged(all, 'work');
    const relatives = results.map((n: NoteIndexEntry): string => n.relative);
    expect(relatives).toEqual(['nested.md', 'plain.md']);
  });
});

describe('searchNotes', (): void => {
  it('is empty for an empty query', (): void => {
    // an empty query matches everything, and showing every note is not a search result.
    expect(searchNotes([note('a.md', 'A')], '  ')).toEqual([]);
  });

  it('ranks an exact title first', (): void => {
    // the three title weights are exclusive — scoring an exact match as exact *and* prefix *and* contains would count it three times.
    const notes = [
      note('guide.md', 'Setup Guide'),
      note('setup.md', 'Setup'),
      note('adv.md', 'Advanced Setup'),
    ];
    const results = searchNotes(notes, 'setup');
    expect(results).toHaveLength(3);
    expect(results[0]!.note.title).toBe('Setup');

    // The order alone cannot tell an exclusive chain from an additive one -- adding the weights keeps
    // the same ranking, just with bigger numbers. The score is what says which happened: an exact
    // title (100) at a path that also contains the query (10) is 110, not 110 plus a prefix and a
    // contains on top.
    expect(results[0]!.score).toBe(110);
  });

  it('ranks a prefix above a mere containment', (): void => {
    const notes = [
      note('guide.md', 'Setup Guide'),
      note('setup.md', 'Setup'),
      note('adv.md', 'Advanced Setup'),
    ];
    const results = searchNotes(notes, 'setup');
    expect(results.map((m: NoteMatch): string => m.note.title)).toEqual([
      'Setup',
      'Setup Guide',
      'Advanced Setup',
    ]);
  });

  it('matches on a tag', (): void => {
    const n = note('unrelated.md', 'Unrelated', { tags: ['setup'] });
    const results = searchNotes([n], 'setup');
    expect(results).toHaveLength(1);
    expect(results[0]!.note).toBe(n);
  });

  it('matches on the path', (): void => {
    const n = note('guides/setup.md', 'Unrelated');
    const results = searchNotes([n], 'setup');
    expect(results).toHaveLength(1);
    expect(results[0]!.note).toBe(n);
  });

  it('caps how much headings can contribute', (): void => {
    // without a cap a long document full of the word would outrank the note actually called it, which is the opposite of what the user asked for.
    const noteA = note('zzz.md', 'Nothing', {
      headings: [
        heading('setup 1'),
        heading('setup 2'),
        heading('setup 3'),
        heading('setup 4'),
        heading('setup 5'),
        heading('setup 6'),
        heading('setup 7'),
        heading('setup 8'),
        heading('setup 9'),
        heading('setup 10'),
      ],
    });
    const noteB = note('aaa.md', 'Setup');
    const results = searchNotes([noteA, noteB], 'setup');
    expect(results).toHaveLength(2);
    expect(results[0]!.note).toBe(noteB);

    // The ranking alone cannot see the cap here, because an exact title outscores ten headings either
    // way. The score can: five hits at five points each is 25, and the other five are not counted.
    expect(results[1]!.score).toBe(25);
  });

  it('shows the most specific thing that matched', (): void => {
    // Context specificity order: title takes precedence, followed by heading text, falling back to relative path.
    const titleNote = note('title.md', 'Setup Guide');
    const headingNote = note('heading.md', 'General Notes', {
      headings: [heading('Setup Instructions')],
    });
    const pathNote = note('setup/overview.md', 'General Notes');

    const titleResults = searchNotes([titleNote], 'setup');
    expect(titleResults[0]!.context).toBe('Setup Guide');

    const headingResults = searchNotes([headingNote], 'setup');
    expect(headingResults[0]!.context).toBe('Setup Instructions');

    const pathResults = searchNotes([pathNote], 'setup');
    expect(pathResults[0]!.context).toBe('setup/overview.md');
  });

  it('honours a limit', (): void => {
    const notes = [
      note('1.md', 'Note 1'),
      note('2.md', 'Note 2'),
      note('3.md', 'Note 3'),
      note('4.md', 'Note 4'),
      note('5.md', 'Note 5'),
    ];
    const results = searchNotes(notes, 'note', 2);
    expect(results).toHaveLength(2);
  });

  it('returns nothing for a limit of zero', (): void => {
    // asking for no results is a request the function should honour rather than silently ignore.
    const notes = [
      note('1.md', 'Note 1'),
      note('2.md', 'Note 2'),
      note('3.md', 'Note 3'),
      note('4.md', 'Note 4'),
      note('5.md', 'Note 5'),
    ];
    expect(searchNotes(notes, 'note', 0)).toEqual([]);
    expect(searchNotes(notes, 'note', -1)).toEqual([]);
  });

  it('skips a note that matches nothing', (): void => {
    const n = note('alpha.md', 'Alpha');
    expect(searchNotes([n], 'zzzz')).toEqual([]);
  });

  it('sorts equal scores by path', (): void => {
    // a result list that reordered itself between identical searches would look broken.
    const noteB = note('b.md', 'Same');
    const noteA = note('a.md', 'Same');
    const results = searchNotes([noteB, noteA], 'same');
    expect(results.map((m: NoteMatch): string => m.note.relative)).toEqual([
      'a.md',
      'b.md',
    ]);
  });
});
