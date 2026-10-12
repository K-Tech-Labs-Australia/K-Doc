/**
 * @file portable-comments.spec.ts
 * @purpose Covers carrying comments inside the document (FR-6.22): that a bundle round-trips, that bundling twice replaces rather than repeats, and that a file someone else has edited cannot cost the reader the rest of their comments.
 * @inputs hand-built threads and hand-written document text.
 * @outputs assertions over bundleComments, extractComments and hasCommentBundle.
 * @functions the describe blocks below.
 * @dataflow threads -> bundleComments -> text -> extractComments -> threads.
 * @controlflow one describe per exported function under test.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import {
  BUNDLE_END,
  BUNDLE_START,
  bundleComments,
  extractComments,
  hasCommentBundle,
} from '../src/comments/portable.js';
import { createAnchor } from '../src/comments/anchor.js';
import type { CommentThread } from '../src/comments/thread.js';

const TEXT = '# Title\n\nA paragraph about Venus.\n';

function thread(id: string, body: string, resolved = false): CommentThread {
  const start = TEXT.indexOf('Venus');
  return {
    id,
    anchor: createAnchor(TEXT, start, start + 5),
    comments: [{ id: `${id}-c1`, author: 'Ada', body, createdAt: '2026-09-16T10:00:00.000Z', editedAt: null }],
    resolved,
    createdAt: '2026-09-16T10:00:00.000Z',
  };
}

describe('bundleComments', () => {
  // Guards that an empty thread list is a no-op and leaves the document un-bundled.
  it('leaves a document without comments alone', () => {
    expect(bundleComments(TEXT, [])).toBe(TEXT);
    expect(hasCommentBundle(bundleComments(TEXT, []))).toBe(false);
  });

  // Guards that the bundle sits below the visible text and every added line is an HTML comment.
  it('writes the comments where a Markdown reader will not see them', () => {
    const bundled = bundleComments(TEXT, [thread('t1', 'Check this.')]);
    expect(bundled.startsWith(TEXT.replace(/\n$/, ''))).toBe(true);
    expect(bundled).toContain(BUNDLE_START);
    expect(bundled).toContain(BUNDLE_END);
    expect(bundled).toContain('Check this.');
    // Every line the bundle adds is an HTML comment, which every Markdown renderer drops.
    for (const line of bundled.slice(TEXT.length).split('\n')) {
      expect(line === '' || line.startsWith('<!--')).toBe(true);
    }
  });

  // Guards that re-bundling replaces the previous bundle rather than stacking a second one.
  it('replaces a bundle rather than writing a second one', () => {
    const once = bundleComments(TEXT, [thread('t1', 'First.')]);
    const twice = bundleComments(once, [thread('t2', 'Second.')]);
    expect(twice.split(BUNDLE_START)).toHaveLength(2);
    expect(twice).toContain('Second.');
    expect(twice).not.toContain('First.');
  });

  // Guards that clearing the thread list restores the document to its original text.
  it('returns the document to what it was when the comments go', () => {
    const bundled = bundleComments(TEXT, [thread('t1', 'Check this.')]);
    expect(bundleComments(bundled, [])).toBe(TEXT);
  });

  // Guards that repeated bundling does not accumulate blank lines.
  it('does not grow blank lines when bundled over and over', () => {
    let text = TEXT;
    for (let i = 0; i < 4; i++) {
      text = bundleComments(text, [thread('t1', 'Check this.')]);
    }
    expect(text).toBe(bundleComments(TEXT, [thread('t1', 'Check this.')]));
  });
});

describe('extractComments', () => {
  // Guards that a plain document yields no threads and no problems.
  it('finds nothing in a document that carries nothing', () => {
    const result = extractComments(TEXT);
    expect(result.threads).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.text).toBe(TEXT);
  });

  // Guards full round-trip fidelity of threads and text through bundle then extract.
  it('reads back exactly what was written', () => {
    const original = [thread('t1', 'Check this.'), thread('t2', 'And this.', true)];
    const result = extractComments(bundleComments(TEXT, original));
    expect(result.threads).toEqual(original);
    expect(result.text).toBe(TEXT);
    expect(result.problems).toEqual([]);
  });

  // Guards that one unreadable comment does not cost the reader the rest of the bundle.
  it('keeps the comments that can be read when one cannot', () => {
    const bundled = bundleComments(TEXT, [thread('t1', 'Good.')]);
    const broken = bundled.replace(BUNDLE_END, `<!-- kdoc:comment {not json} -->\n${BUNDLE_END}`);
    const result = extractComments(broken);
    // One unreadable comment must not cost the reader the rest.
    expect(result.threads).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
  });

  // Guards that a non-thread payload is skipped without losing readable threads.
  it('skips a comment that is not a thread', () => {
    const bundled = bundleComments(TEXT, [thread('t1', 'Good.')]);
    const broken = bundled.replace(BUNDLE_END, `<!-- kdoc:comment {"id":"x"} -->\n${BUNDLE_END}`);
    const result = extractComments(broken);
    expect(result.threads).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
  });

  // Guards against guessing where an unterminated block ends and deleting the document.
  it('leaves a bundle with no end alone', () => {
    const half = `${TEXT}\n${BUNDLE_START}\n<!-- kdoc:comment {"id":"t1"} -->\n`;
    const result = extractComments(half);
    // Guessing where an unterminated block ends risks deleting the document.
    expect(result.text).toBe(half);
    expect(result.threads).toEqual([]);
  });

  // Guards that document text written after the bundle is preserved on extraction.
  it('keeps text written after the bundle', () => {
    const bundled = `${bundleComments(TEXT, [thread('t1', 'Check this.')])}\nA later paragraph.\n`;
    const result = extractComments(bundled);
    expect(result.text).toContain('A later paragraph.');
    expect(result.text).not.toContain(BUNDLE_START);
    expect(result.threads).toHaveLength(1);
  });
});

describe('a document that only looks bundled', () => {
  // An end marker with no start is not a bundle. Treating it as one would take the slice from a start
  // index of -1, which cuts the last character off the document.
  it('ignores an end marker with no start', () => {
    const text = `${TEXT}\n${BUNDLE_END}\n`;
    expect(hasCommentBundle(text)).toBe(false);
    expect(extractComments(text).text).toBe(text);
  });

  // An end marker written before the start marker belongs to neither: searching for the end from the
  // beginning rather than from the start marker would pair them up and cut out the document between.
  it('ignores an end marker that comes before the start', () => {
    const text = `${BUNDLE_END}\n\n${bundleComments(TEXT, [thread('t1', 'Good.')])}`;
    const result = extractComments(text);
    // The real block is the one after the start marker. Searching for the end from the beginning of the
    // document instead pairs the start with the stray marker above it, giving a range that runs
    // backwards: no comment is read, and the text between them is duplicated rather than removed.
    expect(result.threads).toHaveLength(1);
    expect(result.text).toContain('A paragraph about Venus.');
    expect(result.text).not.toContain(BUNDLE_START);
  });

  // A line that opens like a bundled comment but never closes is not one, and taking it as one would
  // slice past the end of the string.
  it('skips a comment line with no end', () => {
    const bundled = bundleComments(TEXT, [thread('t1', 'Good.')]);
    const broken = bundled.replace(BUNDLE_END, `<!-- kdoc:comment {"id":"t2"}\n${BUNDLE_END}`);
    const result = extractComments(broken);
    expect(result.threads).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });
});

describe('a document that is only a bundle', () => {
  // Nothing but comments: taking them out leaves nothing, not a stray blank line.
  it('leaves nothing behind when there was nothing else', () => {
    const only = bundleComments('', [thread('t1', 'Check this.')]);
    expect(only.startsWith(BUNDLE_START)).toBe(true);
    expect(extractComments(only).text).toBe('');
  });
});

describe('the spacing around a bundle', () => {
  // Exactly one blank line between the document and its bundle, however many the document ended with.
  it('does not depend on how the document ended', () => {
    const padded = `${TEXT}\n\n\n`;
    expect(bundleComments(padded, [thread('t1', 'Check this.')])).toBe(
      bundleComments(TEXT, [thread('t1', 'Check this.')]),
    );
  });
});

describe('a bundled comment missing a field', () => {
  // Each field a thread needs is checked, because the file may have been edited by hand or written by
  // something else. A thread missing any one of them cannot be shown and must be reported, not guessed at.
  it('is skipped and reported, whichever field is missing', () => {
    const complete = JSON.parse(JSON.stringify(thread('t1', 'Good.'))) as Record<string, unknown>;
    for (const field of ['id', 'anchor', 'comments', 'resolved']) {
      const broken = { ...complete };
      delete broken[field];
      const text = `${TEXT}\n${BUNDLE_START}\n<!-- kdoc:comment ${JSON.stringify(broken)} -->\n${BUNDLE_END}\n`;
      const result = extractComments(text);
      expect(result.threads, `a thread with no ${field} must not be read`).toEqual([]);
      expect(result.problems, `a thread with no ${field} must be reported`).toHaveLength(1);
    }
  });

  // A payload that is not an object at all is the same kind of failure.
  it('is skipped when it is not an object', () => {
    const text = `${TEXT}\n${BUNDLE_START}\n<!-- kdoc:comment "just a string" -->\n${BUNDLE_END}\n`;
    const result = extractComments(text);
    expect(result.threads).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });
});

describe('hasCommentBundle', () => {
  // Guards distinguishing a bundled document from a plain one by bundle presence.
  it('tells a bundled document from a plain one', () => {
    expect(hasCommentBundle(TEXT)).toBe(false);
    expect(hasCommentBundle(bundleComments(TEXT, [thread('t1', 'Check this.')]))).toBe(true);
  });
});
