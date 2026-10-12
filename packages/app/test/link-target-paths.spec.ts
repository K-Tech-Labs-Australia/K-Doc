/**
 * @file link-target-paths.spec.ts
 * @purpose Tests how classifyLink resolves file-path links against the open document and the vault (FR-8.13).
 * @version 2
 * @date 2026-09-18
 */
import { describe, it, expect } from 'vitest';
import { canonicalFilePath, classifyLink } from '../src/shell/link-target.js';
import type { LinkContext } from '../src/shell/link-target.js';
import type { NoteIndexEntry } from '@k-doc/core';

function note(path: string, relative: string, title: string): NoteIndexEntry {
  return { path, relative, title, headings: [], links: [], tags: [], frontMatter: {} };
}
const VAULT: readonly NoteIndexEntry[] = [
  note('C:/vault/index.md', 'index.md', 'Home'),
  note('C:/vault/guides/setup.md', 'guides/setup.md', 'Setup Guide'),
  note('C:/vault/guides/advanced.md', 'guides/advanced.md', 'Advanced Topics'),
];
const SAVED: LinkContext = { documentPath: 'C:/vault/guides/advanced.md', notes: VAULT };
const UNSAVED: LinkContext = { documentPath: null, notes: VAULT };
const BARE: LinkContext = { documentPath: null, notes: [] };
const SETUP = { kind: 'note', path: 'C:/vault/guides/setup.md', slug: null, label: 'Setup Guide' } as const;

describe('classifyLink with paths', (): void => {
  // A Windows drive letter makes the string an absolute path rather than a bare name.
  it('treats a Windows drive path as absolute', (): void => {
    expect(classifyLink('C:\\vault\\index.md', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/index.md', slug: null, label: 'Home' });
  });

  // A relative filename resolves against the open document's directory.
  it('resolves a relative filename from the open document', (): void => {
    expect(classifyLink('setup.md', SAVED)).toEqual(SETUP);
  });

  // A hash fragment is captured as the link slug.
  it('captures a hash fragment as the slug', (): void => {
    expect(classifyLink('./setup.md#install', SAVED)).toEqual({ ...SETUP, slug: 'install' });
  });

  // An upward traversal resolves to the sibling note in the vault root.
  it('resolves an upward relative path', (): void => {
    expect(classifyLink('../index.md', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/index.md', slug: null, label: 'Home' });
  });

  // The file extension may be omitted when the name matches a vault note.
  it('matches without an extension', (): void => {
    expect(classifyLink('setup', SAVED)).toEqual(SETUP);
  });

  // Matching is case-insensitive for the filename.
  it('matches case-insensitively', (): void => {
    expect(classifyLink('SETUP.MD', SAVED)).toEqual(SETUP);
  });

  // A bare title resolves to a vault note with that title.
  it('matches by note title', (): void => {
    expect(classifyLink('Home', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/index.md', slug: null, label: 'Home' });
  });

  // Traversal may escape the vault when no vault entry matches.
  it('resolves outside the vault', (): void => {
    expect(classifyLink('../other/notes.md', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/other/notes.md', slug: null, label: 'notes' });
  });

  // Traversal never climbs above the drive root.
  it('never resolves above the drive', (): void => {
    expect(classifyLink('../../../../x.md', SAVED)).toEqual({ kind: 'note', path: 'C:/x.md', slug: null, label: 'x' });
  });

  // Percent-encoded sequences are decoded into the resolved path and label.
  it('decodes percent-encoding', (): void => {
    expect(classifyLink('my%20note.md', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/guides/my note.md', slug: null, label: 'my note' });
  });

  // A literal percent sign that is not a valid escape survives decoding.
  it('keeps a literal percent sign', (): void => {
    expect(classifyLink('100%.md', SAVED)).toEqual({ kind: 'note', path: 'C:/vault/guides/100%.md', slug: null, label: '100%' });
  });

  // With two notes of the same name, the one beside the document wins over the first in vault order.
  it('prefers the neighbouring note when a name is ambiguous', (): void => {
    const ambiguous: LinkContext = {
      documentPath: 'C:/vault/guides/advanced.md',
      notes: [note('C:/vault/other/setup.md', 'other/setup.md', 'Other Setup'), ...VAULT],
    };
    expect(classifyLink('setup', ambiguous)).toEqual(SETUP);
  });

  // An unsaved document can still resolve a note named in the vault.
  it('resolves an unsaved document against the vault', (): void => {
    expect(classifyLink('setup', UNSAVED)).toEqual(SETUP);
  });

  // An unknown name on an unsaved document cannot be resolved without saving.
  it('leaves an unknown unsaved name unresolved', (): void => {
    expect(classifyLink('setup.md', BARE)).toEqual({ kind: 'unresolved', target: 'setup.md', reason: 'Save the note to follow relative links.' });
  });
});

describe('canonicalFilePath', (): void => {
  // A Windows path with parent and current-folder segments comes out plain, with its case kept.
  it('resolves dot segments under a drive, keeping case', (): void => {
    expect(canonicalFilePath('C:/Vault/export/../Index.md')).toBe('C:/Vault/Index.md');
    expect(canonicalFilePath('C:\\vault\\.\\a\\..\\index.md')).toBe('C:/vault/index.md');
  });

  // A path from a Unix root resolves under the root.
  it('resolves dot segments under a Unix root', (): void => {
    expect(canonicalFilePath('/home/me/out/../x.md')).toBe('/home/me/x.md');
  });

  // A path that is already plain is unchanged.
  it('leaves a plain path as it is', (): void => {
    expect(canonicalFilePath('C:/vault/index.md')).toBe('C:/vault/index.md');
  });
});
