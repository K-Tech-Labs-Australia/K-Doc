/**
 * @file note-index.test.ts
 * @purpose Vitest test suite for note extraction and indexing in @k-doc/core (FR-6.12).
 *   Verifies hashtag scanning across prose and code boundaries, wikilink extraction with aliases
 *   and whitespace normalization, inline link and image discovery across nested AST structures,
 *   note title resolution hierarchy with front-matter and outline fallbacks, and composite note index entry assembly.
 * @inputs Markdown text samples containing tags, wikilinks, inline links, images, headings, and front matter.
 * @outputs Vitest assertions verifying extractTags, extractWikiLinks, extractInlineLinks, noteTitle, and indexNote.
 * @functions None.
 * @dataflow Markdown text samples -> extraction and indexing functions -> assertion checks against expected NoteLink, NoteIndexEntry, and tag arrays.
 * @controlflow Execute test suites covering tags, wikilinks, inline links, note title resolution, and composite note indexing.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../parse/parser.js';
import {
  extractTags,
  extractWikiLinks,
  extractInlineLinks,
  noteTitle,
  indexNote,
} from './note-index.js';
import type { NoteLink } from './note-index.js';
import type { OutlineEntry } from '../outline/outline.js';

describe('tags', (): void => {
  // Pins that a single hashtag in prose is extracted and stripped of the hash symbol.
  it('finds a tag and drops the hash', (): void => {
    expect(extractTags('a #todo b')).toEqual(['todo']);
  });

  // A tag is a label, and #Todo and #todo are the same label written twice.
  it('lower-cases and de-duplicates, keeping first-appearance order', (): void => {
    expect(extractTags('#Beta #alpha #BETA')).toEqual(['beta', 'alpha']);
  });

  // A heading's # is followed by a space or another #, and a tag's is followed by a letter.
  it('does not take a heading for a tag', (): void => {
    expect(extractTags('# Heading\n\ntext')).toEqual([]);
    expect(extractTags('### Deep')).toEqual([]);
  });

  // A tag has to start a word, so a # in the middle of one is not a tag.
  it('does not take a URL fragment for a tag', (): void => {
    expect(extractTags('see [x](https://e.com/p#section)')).toEqual([]);
  });

  // Pins that forward slashes are permitted within tags to support hierarchical tagging.
  it('allows a nested tag', (): void => {
    expect(extractTags('#work/urgent')).toEqual(['work/urgent']);
  });

  // #include in a C snippet is not a tag.
  it('ignores tags inside a fenced code block', (): void => {
    const text = ['#real', '', '```c', '#include <stdio.h>', '```', '', '#alsoreal'].join('\n');
    expect(extractTags(text)).toEqual(['real', 'alsoreal']);
  });

  // Pins that inline code spans delimited by backticks do not contribute tags.
  it('ignores a tag inside inline code', (): void => {
    expect(extractTags('prose `#nottag` #istag')).toEqual(['istag']);
  });

  // Pins that an empty source string produces an empty array of tags.
  it('finds nothing in empty text', (): void => {
    expect(extractTags('')).toEqual([]);
  });
});

describe('wikilinks', (): void => {
  // Pins that a standard wikilink [[Target]] is identified with kind, target, and line context.
  it('finds a plain wikilink', (): void => {
    const links = extractWikiLinks('see [[Setup]] now');
    expect(links).toHaveLength(1);
    expect(links[0]!.kind).toBe('wiki');
    expect(links[0]!.target).toBe('Setup');
    expect(links[0]!.context).toBe('see [[Setup]] now');
  });

  // The alias is what the reader sees; the target is what the link points at.
  it('takes the target, not the alias', (): void => {
    const links = extractWikiLinks('[[setup|the setup guide]]');
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe('setup');
  });

  // Pins that leading and trailing whitespace inside the target brackets is trimmed.
  it('trims the target', (): void => {
    const links = extractWikiLinks('[[  spaced  ]]');
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe('spaced');
  });

  // Pins that empty wikilink brackets and whitespace-only targets are skipped.
  it('skips an empty target', (): void => {
    expect(extractWikiLinks('[[]] and [[   ]]')).toEqual([]);
  });

  // Pins that wikilink syntax inside inline backtick code spans is ignored.
  it('ignores a wikilink inside code', (): void => {
    const links = extractWikiLinks('`[[nope]]` [[yes]]');
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe('yes');
  });

  // A backlink is only useful if it shows the sentence it was found in.
  it('reports the line it was found on', (): void => {
    const links = extractWikiLinks('first line\n\nsecond [[target]] here');
    expect(links).toHaveLength(1);
    expect(links[0]!.context).toBe('second [[target]] here');
  });

  // A module-level /g regex carries lastIndex between calls, and a scanner that forgot to reset it would find nothing the second time.
  it('can be called twice with the same answer', (): void => {
    const text = 'check [[first]] and [[second]]';
    const firstCall = extractWikiLinks(text);
    const secondCall = extractWikiLinks(text);
    expect(secondCall.length).toBe(firstCall.length);
  });
});

describe('inline links', (): void => {
  // Pins that standard Markdown links [text](url) are parsed from AST with kind and target.
  it('finds a markdown link', (): void => {
    const text = 'see [docs](./guide.md) here';
    const root = parseMarkdown(text).root;
    const links = extractInlineLinks(root, text);
    expect(links).toHaveLength(1);
    expect(links[0]!.kind).toBe('inline');
    expect(links[0]!.target).toBe('./guide.md');
  });

  // An image is a reference to a file, so an attachments report needs it in the index too.
  it('finds an image', (): void => {
    const text = '![alt](pic.png)';
    const root = parseMarkdown(text).root;
    const links = extractInlineLinks(root, text);
    expect(links).toHaveLength(1);
    expect(links[0]!.target).toBe('pic.png');
  });

  // Pins that the line context for an inline link quotes the containing line.
  it('reports the line', (): void => {
    const text = 'para one\n\nsee [x](y.md)';
    const root = parseMarkdown(text).root;
    const links = extractInlineLinks(root, text);
    expect(links).toHaveLength(1);
    expect(links[0]!.context).toBe('see [x](y.md)');
  });

  // The walk has to descend, because a link is almost never a direct child of the document.
  it('finds links inside a list and a blockquote', (): void => {
    const text = '- [a](a.md)\n\n> [b](b.md)';
    const root = parseMarkdown(text).root;
    const links = extractInlineLinks(root, text);
    expect(links).toHaveLength(2);
    expect(links.map((link: NoteLink): string => link.target)).toEqual(['a.md', 'b.md']);
  });
});

describe('the title', (): void => {
  // Pins that non-empty front-matter title takes top precedence.
  it('prefers the front-matter title', (): void => {
    expect(noteTitle('notes/x.md', { title: 'From Front Matter' }, [])).toBe('From Front Matter');
  });

  // Pins that blank or whitespace-only front-matter titles are ignored in favor of subsequent fallbacks.
  it('ignores a blank front-matter title', (): void => {
    expect(noteTitle('notes/x.md', { title: '   ' }, [])).toBe('x');
  });

  // Pins that in the absence of front-matter title, the first level-1 heading is used.
  it('falls back to the first level-1 heading', (): void => {
    const headings: readonly OutlineEntry[] = [
      { depth: 1, text: 'The Heading', start: 0, end: 1, index: 0 },
    ];
    expect(noteTitle('notes/x.md', {}, headings)).toBe('The Heading');
  });

  // A level-2 heading is a section of the note, not its name.
  it('skips a level-2 heading', (): void => {
    const headings: readonly OutlineEntry[] = [
      { depth: 2, text: 'The Section', start: 0, end: 1, index: 0 },
    ];
    expect(noteTitle('notes/x.md', {}, headings)).toBe('x');
  });

  // A note with neither is still a note, and its file name beats "Untitled" in a list of twenty.
  it('falls back to the file name without its extension', (): void => {
    expect(noteTitle('a/b/Setup.MARKDOWN', {}, [])).toBe('Setup');
  });
});

describe('indexing a note', (): void => {
  const TEXT: string = [
    '---',
    'title: The Real Title',
    '---',
    '',
    '# A Heading',
    '',
    'Body with #atag and a [link](other.md) and a [[WikiTarget]].',
    '',
    '## Second',
  ].join('\n');

  // Pins that canonical file path and relative path are preserved intact on the index entry.
  it('carries the path and the relative path through', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.path).toBe('/abs/notes/x.md');
    expect(entry.relative).toBe('notes/x.md');
  });

  // Pins that front-matter title is preferred over document level-1 heading.
  it('uses the front-matter title over the heading', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.title).toBe('The Real Title');
  });

  // Pins that outline headings across all depths are collected into the entry.
  it('collects the headings', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.headings).toHaveLength(2);
    expect(entry.headings.map((h: OutlineEntry): string => h.text)).toEqual([
      'A Heading',
      'Second',
    ]);
  });

  // Inline links come first, followed by wikilinks.
  it('collects both kinds of link', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.links).toHaveLength(2);
    expect(entry.links.map((link: NoteLink): string => link.kind)).toEqual(['inline', 'wiki']);
  });

  // Pins that distinct hashtags are extracted into the tags array.
  it('collects the tags', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.tags).toEqual(['atag']);
  });

  // Pins that front-matter attributes are retained on the frontMatter data dictionary.
  it('keeps the front matter as data', (): void => {
    const entry = indexNote('/abs/notes/x.md', 'notes/x.md', TEXT);
    expect(entry.frontMatter['title']).toBe('The Real Title');
  });

  // An empty file is a real thing to find in a folder, and the index must not fall over on one.
  it('handles an empty note', (): void => {
    const entry = indexNote('/a/empty.md', 'empty.md', '');
    expect(entry.title).toBe('empty');
    expect(entry.headings).toEqual([]);
    expect(entry.links).toEqual([]);
    expect(entry.tags).toEqual([]);
  });
});
