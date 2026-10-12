/**
 * @file second-document.ts
 * @purpose The document held by the second pane when it is another file rather than a second view of the open one (FR-6.9): its own session, its own saved state, kept out of the shell so it can be tested without a pane to put it in.
 * @inputs A SecondDocumentFile read from disk; a path string for deriving a display name.
 * @outputs A SecondDocument with an independent session and save target; a file name derived from a path.
 * @functions
 *   - fileNameOf: Derive a pane-header-friendly name from the last segment of a path.
 *   - secondDocumentOf: Build the second pane's own document from a freshly read file (FR-6.9).
 * @dataflow File bytes on disk -> SecondDocumentFile -> DocumentSession plus saved text; live snapshot compared against saved drives dirty/target queries and markSaved records what is now on disk.
 * @controlflow Create a session whose savedText matches the contents so it starts clean, then return an object whose methods compare the current snapshot to saved and only offer a write when there is something new and the file allows it.
 * @version 1
 * @date 2026-09-18
 */

import { DocumentSession } from '@k-doc/core';
import type { SaveTarget } from '../files/file-service.js';

/** A file read from disk, used to seed the second pane's own document. */
export interface SecondDocumentFile {
  readonly path: string;
  readonly contents: string;
  readonly encoding: string;
  readonly readOnly?: boolean;
}

/** The separate document held by the second pane (FR-6.9). */
export interface SecondDocument {
  /** The session the second pane's binding is built over. Its own, not the open document's. */
  readonly session: DocumentSession;
  readonly path: string;
  /** The file's name, which is what the pane's header shows. */
  readonly name: string;
  readonly encoding: string;
  /** True when the file itself refuses writes, in which case the pane is not editable. */
  readonly readOnly: boolean;
  /** Whether it holds edits that are not on disk. */
  dirty(): boolean;
  /** What to write, or null when there is nothing to write. */
  target(): SaveTarget | null;
  /** Records that what it now holds is what is on disk. */
  markSaved(): void;
}

/**
 * Derive a pane-header-friendly name from the last segment of a path.
 * @purpose Names a file by its last segment, which is what a pane header has room for.
 * @inputs path - The full file path to derive a display name from.
 * @outputs string - The final path segment, or the whole path when there is no usable separator after it.
 * @dataflow Path string -> index of its last separator -> remainder sliced off and returned as the name.
 * @controlflow Look for both separators; if none exists or one trails at the end return the path unchanged, otherwise slice everything after the last separator.
 */
export function fileNameOf(path: string): string {
  // Both separators are checked because a Windows path can arrive with either character as its separator.
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));

  // Check whether there is a separator, and whether anything follows it.
  if (cut < 0 || cut === path.length - 1) {
    return path;
  } else {
    // There is a name after the last separator: that is what to show.
  }

  return path.slice(cut + 1);
}

/**
 * Build the second pane's own document from a file just read from disk (FR-6.9).
 * @purpose Builds the second pane's own document from a file just read from disk (FR-6.9).
 * @inputs file - A SecondDocumentFile freshly read from disk, including its encoding and any read-only flag.
 * @outputs SecondDocument - An independent document whose session starts clean and which reports dirty state and save targets of its own.
 * @dataflow File contents become both the live text and the saved baseline; snapshot text is compared against that baseline to drive dirty/target queries.
 * @controlflow Create a session with savedText equal to the contents so it is not dirty, then return an object whose methods compare the current snapshot to saved and only offer a write when there is something new and the file allows it.
 */
export function secondDocumentOf(file: SecondDocumentFile): SecondDocument {
  // savedText matches the live text, so a document that has just been opened is not dirty. The session's
  // own comparison of the two is the only record of what is on disk: keeping a second copy here would be
  // a second source of truth, and a mutant that broke one of them could not then be killed by the other.
  const session = new DocumentSession(file.contents, { savedText: file.contents });

  const readOnly = file.readOnly === true;

  return {
    session,
    path: file.path,
    name: fileNameOf(file.path),
    encoding: file.encoding,
    readOnly,
    dirty(): boolean {
      return session.snapshot.dirty;
    },
    target(): SaveTarget | null {
      // Check whether there is anything to write. A file that refuses writes has nothing to offer here
      // either, and writing text that is already on disk would touch the file for no reason.
      if (readOnly || !session.snapshot.dirty) {
        return null;
      } else {
        // There is: hand back what to write, with the encoding it was read in.
      }

      return { path: file.path, contents: session.snapshot.document.text, encoding: file.encoding };
    },
    markSaved(): void {
      session.markSaved();
    },
  };
}
