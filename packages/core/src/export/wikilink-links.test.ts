/**
 * @file wikilink-links.test.ts
 * @purpose Vitest test suite for K-Doc's portable Markdown export flavour (packages/core/src/export/markdown-flavours.ts) and the relativeLinkPath helper (packages/core/src/export/wikilink-links.ts). Verifies that wikilinks are turned into links with aliases shown, unresolved and embedded wikilinks are left as written, link nesting is avoided, other extensions are preserved, absolute paths become relative encoded links, and wikilinks serialize back unescaped.
 * @inputs Markdown documents containing K-Doc wikilinks ([[note]], [[note#heading|alias]], ![[embed]]); the 'portable' flavour tag; source and target file system paths for relativeLinkPath; a resolveWikiLink resolver mapping Known targets to known.md.
 * @outputs Vitest assertions on exported .markdown strings and .changes tallies, plus relativeLinkPath path results and serializeDocument output.
 * @functions None.
 * @dataflow Markdown string -> parseMarkdown AST -> exportMarkdownFlavour (portable) / relativeLinkPath / serializeDocument -> Vitest assertions on .markdown / .changes / serialized output.
 * @controlflow Run describe blocks for the portable flavour, relativeLinkPath and wikilink serialization; each it asserts an exact output or change list under a Guards comment.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parse/parser.js';
import { serializeDocument } from '../serialize/serializer.js';
import { exportMarkdownFlavour } from './markdown-flavours.js';
import { relativeLinkPath } from './wikilink-links.js';

const portable = (text: string) => exportMarkdownFlavour(parseMarkdown(text), 'portable', { resolveWikiLink: (target: string): string | null => (target.startsWith('Known') ? `known.md${target.includes('#') ? '#part' : ''}` : null) });

describe('exportMarkdownFlavour: vault-portable', () => {
  // Guards wikilinks are turned into links showing their alias, while embeds, unresolved links and inline code are left as written.
  it('turns wikilinks into links, showing the alias, and leaves the rest as written', () => {
    expect(portable('See [[Known]], [[Known#Part|alias]], [[Unknown]], ![[Known]] and `[[Known]]`.\n')).toEqual({
      markdown: 'See [Known](known.md), [alias](known.md#part), [[Unknown]], ![[Known]] and `[[Known]]`.\n',
      changes: [
        { label: 'wikilinks turned into links', count: 2 },
        { label: 'wikilinks that match no note, left as written', count: 1 },
      ],
    });
  });
  // Guards every wikilink is left as written when nothing can resolve them.
  it('leaves every wikilink as written when nothing can resolve them', () => {
    expect(exportMarkdownFlavour(parseMarkdown('See [[Known]].\n'), 'portable')).toEqual({ markdown: 'See [[Known]].\n', changes: [{ label: 'wikilinks that match no note, left as written', count: 1 }] });
  });
  // Guards a wikilink is not placed inside an existing link, but is rewritten when nested within emphasis.
  it('does not put a link inside a link, but does inside emphasis', () => {
    expect(portable('[a [[Known]] link](x.md) and **[[Known]]**\n').markdown).toBe('[a [[Known]] link](x.md) and **[Known](known.md)**\n');
  });
  // Guards a wikilink inside a reference link's text is left alone, as one inside an ordinary link is.
  it('does not put a link inside a reference link', () => {
    expect(portable('[see [[Known]]][r]\n\n[r]: x.md\n').markdown).toBe('[see [[Known]]][r]\n\n[r]: x.md\n');
  });

  // Guards every other K-Doc extension is preserved unchanged with an empty change list.
  it('keeps every other extension', () => {
    expect(portable('Some ==mark== and $x$.\n')).toEqual({ markdown: 'Some ==mark== and $x$.\n', changes: [] });
  });
});

describe('relativeLinkPath', () => {
  // Guards a file in the same folder is named by its own filename.
  it('names a file in the same folder by its name', () => {
    expect(relativeLinkPath('C:/vault', 'C:/vault/note.md')).toBe('note.md');
  });
  // Guards climbing out of a folder into a sibling works regardless of slash direction.
  it('climbs out of a folder into a sibling, whatever the slashes', () => {
    expect(relativeLinkPath('C:\\vault\\a', 'C:\\vault\\b\\note.md')).toBe('../b/note.md');
  });
  // Guards descending into nested folders produces a forward-slash relative path.
  it('descends into folders', () => {
    expect(relativeLinkPath('C:/vault', 'C:/vault/x/y/note.md')).toBe('x/y/note.md');
  });
  // Guards folder names match case-insensitively while the target file keeps its own case.
  it('matches folders whatever their case', () => {
    expect(relativeLinkPath('c:/Vault/A', 'C:/vault/a/Note.md')).toBe('Note.md');
  });
  // Guards a path on another drive is returned in full with spaces encoded.
  it('gives the whole path on another drive', () => {
    expect(relativeLinkPath('C:/vault', 'D:/other/My Note.md')).toBe('D:/other/My%20Note.md');
  });
  // Guards spaces in folder and file names are percent-encoded.
  it('encodes spaces', () => {
    expect(relativeLinkPath('/home/me', '/home/me/My Notes/a b.md')).toBe('My%20Notes/a%20b.md');
  });
  // Guards a file that shares its name with a folder above the export is still reached by climbing out.
  it('climbs out to a file named like a folder above', () => {
    expect(relativeLinkPath('C:/vault/notes/deeper', 'C:/vault/notes')).toBe('../../notes');
  });

  // Guards relative resolution works from a Unix root.
  it('works from a Unix root', () => {
    expect(relativeLinkPath('/home/me/out', '/home/me/notes/n.md')).toBe('../notes/n.md');
  });
});

describe('writing wikilinks back', () => {
  // Guards wikilinks, aliases and embeds are written unescaped while the surrounding text is still escaped.
  it('writes wikilinks, aliases and embeds unescaped, and still escapes the text around them', () => {
    expect(serializeDocument(parseMarkdown('[[A]] and [[B#H|Alias]] and ![[P.png]] then [x] and *y* and [[unclosed\n'))).toBe('[[A]] and [[B#H|Alias]] and ![[P.png]] then \\[x] and _y_ and \\[\\[unclosed\n');
  });
  // Guards text before a wikilink in the same run is still escaped.
  it('escapes text that comes before a wikilink', () => {
    expect(serializeDocument(parseMarkdown('A [x] before [[B]]\n'))).toBe('A \\[x] before [[B]]\n');
  });

  // Guards wikilinks at the start and end of a paragraph are written verbatim.
  it('writes wikilinks at the start and end of a paragraph', () => {
    expect(serializeDocument(parseMarkdown('[[Start]] middle [[End]]\n'))).toBe('[[Start]] middle [[End]]\n');
  });
});
