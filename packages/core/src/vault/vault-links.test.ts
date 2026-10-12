/**
 * @file vault-links.test.ts
 * @purpose Vitest test suite for vault link resolution and backlink discovery in @k-doc/core (FR-6.13).
 *   Verifies extension stripping, target normalisation, note target matching by path, file name,
 *   and title, and backlink discovery with self-link exclusion and deterministic sorting.
 * @inputs Fixture NoteIndexEntry records, NoteLink objects, file names, and target path strings.
 * @outputs Vitest assertions validating withoutExtension, normaliseTarget, targetsNote, and backlinksTo.
 * @functions
 *   - note: Test helper constructing a NoteIndexEntry fixture with default values.
 *   - link: Test helper constructing a NoteLink fixture with default wikilink kind and context.
 * @dataflow Test fixtures -> vault-links functions -> assertion checks against expected normalised targets, boolean matches, and sorted backlink arrays.
 * @controlflow Execute test suites covering withoutExtension, normaliseTarget, targetsNote, and backlinksTo.
 * @version 2
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { withoutExtension, normaliseTarget, targetsNote, backlinksTo } from './vault-links.js';
import type { NoteIndexEntry, NoteLink } from './note-index.js';

/**
 * Builds a test NoteIndexEntry fixture with specified relative path, title, and optional links.
 *
 * @purpose Creates a NoteIndexEntry with path set to '/vault/' + relative, given title and links, and empty headings, tags, and frontMatter.
 * @inputs relative - Relative path of the note within the vault.
 * @inputs title - Display title of the note.
 * @inputs links - Optional array of NoteLink references, defaulting to an empty array.
 * @outputs NoteIndexEntry - Fully populated note index entry fixture.
 * @dataflow relative, title, links inputs -> assembled NoteIndexEntry fixture with default collections.
 * @controlflow Construct path with '/vault/' prefix -> assign relative and title -> fallback links to empty array -> initialize empty collections -> return fixture.
 */
function note(
  relative: string,
  title: string,
  links?: readonly NoteLink[],
): NoteIndexEntry {
  return {
    path: `/vault/${relative}`,
    relative,
    title,
    headings: [],
    // Use provided links or default to empty array.
    links: links ?? [],
    tags: [],
    frontMatter: {},
  };
}

/**
 * Builds a test NoteLink fixture with wikilink kind and dummy context.
 *
 * @purpose Creates a NoteLink with kind 'wiki', specified target, context 'ctx', and specified or default 0 offset.
 * @inputs target - Link destination target string.
 * @inputs offset - Optional character offset within source text, defaulting to 0.
 * @outputs NoteLink - Configured note link fixture.
 * @dataflow target and optional offset -> assembled NoteLink record with kind 'wiki' and context 'ctx'.
 * @controlflow Resolve offset with nullish coalescing to 0 -> assemble NoteLink object -> return fixture.
 */
function link(target: string, offset?: number): NoteLink {
  return {
    kind: 'wiki',
    target,
    context: 'ctx',
    // Use provided offset or default to 0.
    offset: offset ?? 0,
  };
}

describe('withoutExtension', (): void => {
  it('strips every markdown extension, whatever the case', (): void => {
    expect(withoutExtension('a.md')).toBe('a');
    expect(withoutExtension('a.MARKDOWN')).toBe('a');
    expect(withoutExtension('a.mdown')).toBe('a');
  });

  it('leaves a name that is not a note alone', (): void => {
    expect(withoutExtension('a.png')).toBe('a.png');
    expect(withoutExtension('plain')).toBe('plain');
  });

  it('only strips a trailing extension', (): void => {
    // The extension is what a name ends with, and a.md.bak ends with .bak.
    expect(withoutExtension('a.md.bak')).toBe('a.md.bak');
  });
});

describe('normaliseTarget', (): void => {
  it('lower-cases and drops the extension', (): void => {
    // File names differ in case between platforms, and a link written one way must find a file named the other.
    expect(normaliseTarget('Notes/Setup.md')).toBe('notes/setup');
  });

  it('drops an anchor', (): void => {
    // An anchor names a heading inside a note, not a different note.
    expect(normaliseTarget('guide.md#install')).toBe('guide');
  });

  it('drops a leading dot-slash', (): void => {
    expect(normaliseTarget('./guide.md')).toBe('guide');
  });

  it('turns backslashes into forward slashes', (): void => {
    expect(normaliseTarget('notes\\sub\\x.md')).toBe('notes/sub/x');
  });

  it('is empty for an anchor-only target', (): void => {
    expect(normaliseTarget('#intro')).toBe('');
    expect(normaliseTarget('   ')).toBe('');
  });
});

describe('targetsNote', (): void => {
  const target = note('notes/setup.md', 'Getting Started');

  it('matches on the full path', (): void => {
    expect(targetsNote(link('notes/setup.md'), target)).toBe(true);
    expect(targetsNote(link('notes/setup'), target)).toBe(true);
  });

  it('matches on the file name alone', (): void => {
    // That is how a wikilink usually names a note.
    expect(targetsNote(link('setup'), target)).toBe(true);
  });

  it('matches on the title', (): void => {
    expect(targetsNote(link('Getting Started'), target)).toBe(true);
  });

  it('does not match a different note', (): void => {
    expect(targetsNote(link('other'), target)).toBe(false);
  });

  it('does not match an anchor-only link', (): void => {
    // [top](#intro) points inside its own note, and treating it as a link to every note would fill the backlinks panel with noise.
    expect(targetsNote(link('#intro'), target)).toBe(false);
  });

  it('does not match a note whose name is empty', (): void => {
    // The empty-target guard is what this pins. A note whose title and file stem are both empty is
    // the only thing an empty target could equal, and without the guard an anchor-only link would
    // match it -- putting every `[top](#intro)` in the vault into that note's backlinks.
    const nameless: NoteIndexEntry = {
      path: '/vault/.md',
      relative: '.md',
      title: '',
      headings: [],
      links: [],
      tags: [],
      frontMatter: {},
    };
    expect(targetsNote(link('#intro'), nameless)).toBe(false);
    expect(targetsNote(link('   '), nameless)).toBe(false);
  });

  it('does not match on a prefix of the file name', (): void => {
    // A link either names a note or it does not; a near-miss is a broken link, not a backlink.
    expect(targetsNote(link('set'), target)).toBe(false);
  });
});

describe('backlinksTo', (): void => {
  const target = note('setup.md', 'Setup');
  const a = note('a.md', 'A', [link('setup', 10), link('elsewhere', 20)]);
  const b = note('b.md', 'B', [link('Setup.md', 5)]);
  const selfRef = note('setup.md', 'Setup', [link('setup', 1)]);

  it('finds every note that links to it', (): void => {
    const results = backlinksTo([a, b], target);
    expect(results).toHaveLength(2);
    expect(results[0]!.from.relative).toBe('a.md');
    expect(results[1]!.from.relative).toBe('b.md');
    expect(results.map((entry): string => entry.from.relative)).toEqual(['a.md', 'b.md']);
  });

  it('carries the link that did it', (): void => {
    // The panel quotes the line, so it needs the link and not just the note.
    const results = backlinksTo([a, b], target);
    expect(results[0]!.link.target).toBe('setup');
    expect(results[0]!.link.offset).toBe(10);
  });

  it('skips a note linking to itself', (): void => {
    // Compared by path, not by object identity, so a second index entry for the same file is still the same note; a note that links to itself is not a backlink.
    expect(backlinksTo([selfRef], target)).toEqual([]);
    expect(backlinksTo([selfRef], target)).toHaveLength(0);
  });

  it('sorts by source and then by position', (): void => {
    // The panel has to read the same way twice running.
    const twice = note('a.md', 'A', [link('setup', 30), link('setup', 5)]);
    expect(backlinksTo([twice], target).map((entry): number => entry.link.offset)).toEqual([5, 30]);
  });

  it('finds nothing in an empty vault', (): void => {
    expect(backlinksTo([], target)).toEqual([]);
    expect(backlinksTo([], target)).toHaveLength(0);
  });
});
