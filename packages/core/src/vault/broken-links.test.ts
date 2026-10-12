/**
 * @file broken-links.test.ts
 * @purpose Vitest test suite validating unresolved vault-internal link detection in @k-doc/core (FR-14.7).
 *   Verifies that resolving links are omitted, unresolving links are reported with identities and reasons,
 *   external URIs and pure fragments are skipped, anchors/queries are stripped before matching, and empty vault behavior is sound.
 * @inputs Fixture NoteIndexEntry records, NoteLink objects, and target strings.
 * @outputs Vitest assertions validating brokenLinks return values, preserved object identities, and reason descriptions.
 * @functions
 *   - link: Test helper constructing a NoteLink fixture with target, kind, and offset.
 *   - note: Test helper constructing a NoteIndexEntry fixture with relative path and title.
 * @dataflow Test fixtures -> brokenLinks -> assertion checks against expected BrokenLink records, link identities, and reason strings.
 * @controlflow Execute test suites covering resolving links, unresolving links, skipped external schemes/fragments, anchor/query stripping, empty vaults, and reason messages.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect } from 'vitest';
import { brokenLinks } from './vault-links.js';
import type { NoteIndexEntry, NoteLink, NoteLinkKind } from './note-index.js';

/**
 * Builds a test NoteLink fixture with specified target, kind, and offset.
 *
 * @purpose Creates a NoteLink fixture with default wikilink kind, empty context, and default 0 offset.
 * @inputs target - Link destination target string.
 * @inputs kind - Type of link ('wiki' or 'inline'), defaulting to 'wiki'.
 * @inputs offset - Character offset within source text, defaulting to 0.
 * @outputs NoteLink - Configured note link fixture.
 * @dataflow target, kind, offset inputs -> assembled NoteLink record.
 * @controlflow Assign default values for kind and offset -> return NoteLink object.
 */
function link(
  target: string,
  kind: NoteLinkKind = 'wiki',
  offset: number = 0,
): NoteLink {
  return {
    kind,
    target,
    context: '',
    offset,
  };
}

/**
 * Builds a test NoteIndexEntry fixture with specified relative path and title.
 *
 * @purpose Creates a complete NoteIndexEntry with path set to 'C:/vault/' + relative and empty collection arrays.
 * @inputs relative - Relative path of the note within the vault.
 * @inputs title - Display title of the note.
 * @outputs NoteIndexEntry - Fully populated note index entry fixture.
 * @dataflow relative and title inputs -> assembled NoteIndexEntry record with 'C:/vault/' path prefix and empty collections.
 * @controlflow Construct path using 'C:/vault/' prefix -> initialize empty arrays and front-matter record -> return fixture.
 */
function note(relative: string, title: string): NoteIndexEntry {
  return {
    path: `C:/vault/${relative}`,
    relative,
    title,
    headings: [],
    links: [],
    tags: [],
    frontMatter: {},
  };
}

describe('brokenLinks', (): void => {
  describe('resolving links are not reported', (): void => {
    it('omits a wikilink naming an existing note by its file stem', (): void => {
      // Links resolving to a note in the vault must not appear in the broken links list or trigger user warnings.
      const sampleNote = note('notes/setup.md', 'Setup');
      const wikilink = link('setup', 'wiki');
      expect(brokenLinks([wikilink], [sampleNote])).toEqual([]);
    });

    it('omits a link naming an existing note by its full relative path', (): void => {
      // Explicit relative path references allow users to disambiguate notes across subdirectories without false broken-link diagnostics.
      const sampleNote = note('notes/setup.md', 'Setup');
      const pathLink = link('notes/setup.md');
      expect(brokenLinks([pathLink], [sampleNote])).toEqual([]);
    });

    it('omits a link naming an existing note by its display title', (): void => {
      // Human-authored wikilinks frequently reference notes by document title rather than file path, which the vault index recognizes as valid.
      const sampleNote = note('notes/setup.md', 'Setup Guide');
      const titleLink = link('Setup Guide');
      expect(brokenLinks([titleLink], [sampleNote])).toEqual([]);
    });

    it('omits a link whose case differs from the target note', (): void => {
      // File names differ in case between operating systems (e.g. Windows vs Linux); links valid on case-insensitive filesystems must not be reported broken on case-sensitive ones.
      const sampleNote = note('notes/setup.md', 'Setup');
      const caseLink = link('Setup');
      expect(brokenLinks([caseLink], [sampleNote])).toEqual([]);
    });
  });

  describe('unresolving links are reported', (): void => {
    it('reports an unresolving link and preserves the exact NoteLink object reference', (): void => {
      // The problems surface requires the original link reference to pinpoint source line, column, and range in the editor buffer.
      const targetLink = link('nowhere');
      const results = brokenLinks([targetLink], []);
      expect(results).toHaveLength(1);
      const first = results[0];
      // Check if the first broken link entry exists under noUncheckedIndexedAccess.
      if (first !== undefined) {
        // Entry is defined: assert referential identity of the link object and matching reason text.
        expect(first.link).toBe(targetLink);
        expect(first.reason).toBe('No note matches nowhere');
      } else {
        // Entry is undefined: trigger assertion failure.
        expect(first).toBeDefined();
      }
    });

    it('reports all unresolving links preserving their original occurrence order', (): void => {
      // Deterministic ordering guarantees editor problem markers match the reading flow of the Markdown document from top to bottom.
      const first = link('missing-one', 'wiki', 10);
      const second = link('missing-two', 'wiki', 45);
      const third = link('missing-three', 'wiki', 80);
      const results = brokenLinks([first, second, third], []);
      expect(results).toHaveLength(3);
      expect(results.map((entry): NoteLink => entry.link)).toEqual([first, second, third]);
      expect(results.map((entry): string => entry.reason)).toEqual([
        'No note matches missing-one',
        'No note matches missing-two',
        'No note matches missing-three',
      ]);
    });
  });

  describe('skipped targets outside vault-internal resolution', (): void => {
    it('skips external URI schemes regardless of vault contents', (): void => {
      // A URL that 404s is a real problem but one only a network request can find, and reporting it from a string match would be a guess dressed as a finding.
      const externalLinks = [
        link('http://example.com'),
        link('https://example.com/x'),
        link('mailto:someone@example.com'),
        link('file:///c:/tmp/x.md'),
      ];
      expect(brokenLinks(externalLinks, [])).toEqual([]);
    });

    it('skips protocol-relative URLs', (): void => {
      // Protocol-relative URLs point to external web assets resolved by the host environment, not local vault Markdown files.
      const protocolRelative = link('//cdn.example.com/x');
      expect(brokenLinks([protocolRelative], [])).toEqual([]);
    });

    it('skips empty and whitespace-only targets', (): void => {
      // An empty target is a malformed link rather than an unresolved one, and the two want different words.
      const emptyTargets = [link(''), link('   ')];
      expect(brokenLinks(emptyTargets, [])).toEqual([]);
    });

    it('skips pure fragments pointing within the current document', (): void => {
      // A target beginning with '#' names a heading in this same note, not another note, and heading validation belongs to outline checks rather than note resolution.
      const pureFragment = link('#install');
      expect(brokenLinks([pureFragment], [])).toEqual([]);
    });
  });

  describe('stripping fragments and query parameters before matching', (): void => {
    it('strips heading fragments so the destination note can be located', (): void => {
      // Heading anchors target intra-note sections; isolating the note name prevents valid cross-note section links from being flagged as missing notes.
      const sampleNote = note('notes/setup.md', 'Setup');
      const fragmentLink = link('setup#install');
      expect(brokenLinks([fragmentLink], [sampleNote])).toEqual([]);
    });

    it('strips query parameters before evaluating vault note matches', (): void => {
      // Query strings represent metadata or web view state rather than disk file stems, so stripping them allows the underlying document to match.
      const sampleNote = note('notes/setup.md', 'Setup');
      const queryLink = link('setup.md?v=2');
      expect(brokenLinks([queryLink], [sampleNote])).toEqual([]);
    });

    it('strips whichever delimiter occurs first when both query parameters and anchors are present', (): void => {
      // Links may combine URL query strings and hash anchors in varying order; cutting at the earliest delimiter isolates the note file stem cleanly.
      const sampleNote = note('notes/setup.md', 'Setup');
      const queryFirst = link('setup?a=1#b');
      const fragmentFirst = link('setup#b?a=1');
      expect(brokenLinks([queryFirst, fragmentFirst], [sampleNote])).toEqual([]);
    });

    it('skips targets that reduce to empty strings after stripping anchors or queries', (): void => {
      // Targets with no file stem before their anchor or query delimiters refer only to intra-note sections or parameters and must not be flagged as missing files.
      const strippedToEmpty = [link('#'), link('?x=1')];
      expect(brokenLinks(strippedToEmpty, [])).toEqual([]);
    });
  });

  describe('consequences of an empty vault', (): void => {
    it('reports internal links as broken when the vault index is completely empty', (): void => {
      // This is correct rather than unfortunate — a vault with no notes genuinely resolves nothing — but that it is exactly why the caller must not run this mid-scan, because the panel would otherwise accuse every link in the document and then take it back as the notes arrive.
      const internalLink = link('notes/setup.md');
      const results = brokenLinks([internalLink], []);
      expect(results).toHaveLength(1);
      const first = results[0];
      // Check if the first broken link entry exists under noUncheckedIndexedAccess.
      if (first !== undefined) {
        // Entry is defined: assert link identity and unresolved error description.
        expect(first.link).toBe(internalLink);
        expect(first.reason).toBe('No note matches notes/setup.md');
      } else {
        // Entry is undefined: trigger assertion failure.
        expect(first).toBeDefined();
      }
    });
  });

  describe('reason text formatting', (): void => {
    it('formats failure reasons using the stripped target rather than the raw target string', (): void => {
      // The fragment is not the part that failed to resolve, so the reason names the stripped target to clearly inform the user which document could not be found.
      const targetLink = link('nowhere#section');
      const results = brokenLinks([targetLink], []);
      expect(results).toHaveLength(1);
      const first = results[0];
      // Check if the first broken link entry exists under noUncheckedIndexedAccess.
      if (first !== undefined) {
        // Entry is defined: verify reason cites only the stripped target stem.
        expect(first.link).toBe(targetLink);
        expect(first.reason).toBe('No note matches nowhere');
      } else {
        // Entry is undefined: trigger assertion failure.
        expect(first).toBeDefined();
      }
    });
  });
});
