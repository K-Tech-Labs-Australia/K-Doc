/**
 * @file second-document.spec.ts
 * @purpose A Vitest suite for the second pane's own document (FR-6.9): it verifies that a file name is derived from a path and that the separate session starts clean, goes dirty on edit, reports its save target with the read encoding, returns to clean after saving or an undone edit, refuses writes when the file is read-only, and never shares state with another document's session.
 * @inputs Vitest describe/it scaffolding; SecondDocumentFile objects passed to secondDocumentOf; path strings for fileNameOf.
 * @outputs Nothing persisted; assertions that pass or fail the suite via expect.
 * @functions
 *   - naming-a-file tests: Verify fileNameOf derives a display name from a path's last segment, handling both separators and trailing slashes.
 *   - second-pane-document tests: Verify secondDocumentOf builds an independent session whose dirty/target/markSaved behaviour matches edits against the saved baseline.
 * @dataflow Test inputs -> fileNameOf / secondDocumentOf -> DocumentSession snapshot plus saved baseline -> expect assertions comparing names, dirty flags, and save targets to expected values.
 * @controlflow For each it run the described edit sequence then assert; naming tests call fileNameOf directly while document tests mutate a session before querying dirty/target/markSaved.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { fileNameOf, secondDocumentOf, type SecondDocument } from '../src/shell/second-document.js';

/**
 * @purpose Opens a second-pane document ready to be edited by these tests.
 * @inputs file - The file to open, in the shape secondDocumentOf takes.
 * @outputs SecondDocument - The document, with its source pane focused.
 * @dataflow file -> secondDocumentOf -> focusPane('source') -> the document.
 * @controlflow A session only takes a text edit while its source pane has focus (FR-3.1), and these tests
 *   edit by text because that is the smallest way to say "something changed" without a ProseMirror view.
 */
function opened(file: { path: string; contents: string; encoding: string; readOnly?: boolean }): SecondDocument {
  const doc = secondDocumentOf(file);
  doc.session.focusPane('source');
  return doc;
}

describe('naming a file', (): void => {
  it('takes the last segment of a path', (): void => {
    // A Windows path can arrive with either separator as its directory delimiter.
    expect(fileNameOf('C:/notes/deep/one.md')).toBe('one.md');
    expect(fileNameOf('C:\\notes\\deep\\one.md')).toBe('one.md');
  });

  it('takes the whole of a path with nothing to cut', (): void => {
    // A path ending in a separator names no file, so the whole of it is better than nothing.
    expect(fileNameOf('one.md')).toBe('one.md');
    expect(fileNameOf('C:/notes/')).toBe('C:/notes/');
  });

  it('reads the LAST separator, not the first', (): void => {
    // The name after the final separator is what a header shows, so earlier separators are ignored.
    expect(fileNameOf('a/b/c/d.md')).toBe('d.md');
  });
});

describe("the second pane's own document", (): void => {
  it('opens clean', (): void => {
    const doc = opened({ path: 'C:/notes/one.md', contents: 'Hello.\n', encoding: 'utf-8' });
    expect(doc.name).toBe('one.md');
    expect(doc.path).toBe('C:/notes/one.md');
    expect(doc.readOnly).toBe(false);
    expect(doc.dirty()).toBe(false);
    // Nothing to write until something is written in it.
    expect(doc.target()).toBeNull();
  });

  it('is dirty once it is edited, and says what to write', (): void => {
    const doc = opened({ path: 'C:/notes/one.md', contents: 'Hello.\n', encoding: 'utf-16le' });
    doc.session.applyText('Hello there.\n');
    expect(doc.dirty()).toBe(true);
    // The encoding it was read in is the encoding it is written back in.
    expect(doc.target()).toEqual({ path: 'C:/notes/one.md', contents: 'Hello there.\n', encoding: 'utf-16le' });
  });

  it('is clean again once it is saved', (): void => {
    const doc = opened({ path: 'C:/notes/one.md', contents: 'Hello.\n', encoding: 'utf-8' });
    doc.session.applyText('Hello there.\n');
    doc.markSaved();
    expect(doc.dirty()).toBe(false);
    expect(doc.target()).toBeNull();
  });

  it('is dirty again after a further edit', (): void => {
    const doc = opened({ path: 'C:/notes/one.md', contents: 'A\n', encoding: 'utf-8' });
    doc.session.applyText('B\n');
    doc.markSaved();
    doc.session.applyText('C\n');
    expect(doc.dirty()).toBe(true);
    // Optional chaining avoids a non-null assertion while still reading the target's contents.
    expect(doc.target()?.contents).toBe('C\n');
  });

  it('has nothing to write when the file refuses writes', (): void => {
    // A read-only file still opens, because reading something beside what you are writing is the point.
    const doc = opened({ path: 'C:/notes/one.md', contents: 'A\n', encoding: 'utf-8', readOnly: true });
    expect(doc.readOnly).toBe(true);
    doc.session.applyText('B\n');
    expect(doc.dirty()).toBe(true);
    expect(doc.target()).toBeNull();
  });

  it('gets back to exactly what was read without being dirty', (): void => {
    // An edit undone by hand is not a change, so there is nothing to write.
    const doc = opened({ path: 'C:/notes/one.md', contents: 'A\n', encoding: 'utf-8' });
    doc.session.applyText('B\n');
    doc.session.applyText('A\n');
    expect(doc.dirty()).toBe(false);
    expect(doc.target()).toBeNull();
  });

  it('is a session of its own', (): void => {
    // Two documents opened beside each other must not share anything.
    const one = opened({ path: 'a.md', contents: 'A\n', encoding: 'utf-8' });
    const two = opened({ path: 'b.md', contents: 'B\n', encoding: 'utf-8' });
    one.session.applyText('changed\n');
    expect(two.session.snapshot.document.text).toBe('B\n');
    expect(two.dirty()).toBe(false);
  });
});
