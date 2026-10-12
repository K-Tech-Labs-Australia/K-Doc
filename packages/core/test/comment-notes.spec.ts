/**
 * @file comment-notes.spec.ts
 * @purpose Covers writing comments into a document for export (FR-10.7): that nothing reaches the export unless asked for, that each arrangement puts the comment where it belongs, and that a comment whose anchor has moved is still shown rather than lost.
 * @inputs a parsed markdown document and hand-built CommentThread values anchored inside it;
 * @outputs assertions over the HTML produced by withCommentNotes followed by renderFragment;
 * @functions
 *   - threadOn: builds a single-comment CommentThread anchored on a word in TEXT.
 *   - describe('withCommentNotes'): groups the arrangement-level assertions below.
 * @dataflow text -> parseMarkdown -> withCommentNotes -> renderFragment -> assertions.
 * @controlflow one describe per arrangement; each test parses fresh, runs one arrangement, and asserts on the rendered HTML.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderFragment, renderHtml, withCommentNotes, MARGIN_NOTE_CLASS } from '../src/index.js';
import { createAnchor } from '../src/comments/anchor.js';
import type { CommentThread } from '../src/comments/thread.js';

const TEXT = 'The first paragraph mentions Venus.\n\nThe second paragraph mentions Mars.\n';

function threadOn(word: string, body: string, resolved = false): CommentThread {
  const start = TEXT.indexOf(word);
  return {
    id: `t-${word}`,
    anchor: createAnchor(TEXT, start, start + word.length),
    comments: [{ id: 'c1', author: 'Ada', body, createdAt: '2026-09-16T10:00:00.000Z', editedAt: null }],
    resolved,
    createdAt: '2026-09-16T10:00:00.000Z',
  };
}

describe('withCommentNotes', () => {
  // Guards: with no threads the annotated render must be byte-for-byte identical to the plain one.
  it('leaves the tree alone when there is nothing to write', () => {
    const doc = parseMarkdown(TEXT);
    const before = renderFragment(doc.root);
    const after = renderFragment(withCommentNotes(doc.root, { mode: 'endnotes', threads: [], text: TEXT }));
    expect(after).toBe(before);
  });

  // Guards: the function must not mutate the caller's document tree.
  it('never changes the tree it was given', () => {
    const doc = parseMarkdown(TEXT);
    const original = JSON.stringify(doc.root);
    withCommentNotes(doc.root, { mode: 'endnotes', threads: [threadOn('Venus', 'Check this.')], text: TEXT });
    expect(JSON.stringify(doc.root)).toBe(original);
  });

  // Guards: resolved threads are dropped from the export entirely.
  it('leaves out a thread that has been resolved', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, { mode: 'endnotes', threads: [threadOn('Venus', 'Settled.', true)], text: TEXT }),
    );
    expect(html).not.toContain('Settled.');
  });

  // Guards: an endnote emits a ref marker at the anchor and its definition later, in that order.
  it('writes an endnote with a marker where the comment was anchored', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, { mode: 'endnotes', threads: [threadOn('Venus', 'Check this.')], text: TEXT }),
    );
    expect(html).toContain('data-footnote-ref');
    expect(html).toContain('Ada: Check this.');
    expect(html.indexOf('data-footnote-ref')).toBeLessThan(html.indexOf('Ada: Check this.'));
  });

  // Guards: multiple endnotes are numbered in the order their anchors appear in the text.
  it('numbers several endnotes in the order the comments come', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, {
        mode: 'endnotes',
        threads: [threadOn('Venus', 'First note.'), threadOn('Mars', 'Second note.')],
        text: TEXT,
      }),
    );
    expect(html.indexOf('Ada: First note.')).toBeLessThan(html.indexOf('Ada: Second note.'));
  });

  // Guards: a margin note is placed inside the paragraph it annotates, not after the whole document.
  it('writes a margin note beside the text it is about', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, { mode: 'margin-notes', threads: [threadOn('Venus', 'Check this.')], text: TEXT }),
    );
    expect(html).toContain(`<span class="${MARGIN_NOTE_CLASS}">Ada: Check this.</span>`);
    // The note belongs inside the paragraph it annotates, not after the whole document.
    expect(html.indexOf('kdoc-margin-note')).toBeLessThan(html.indexOf('second paragraph'));
  });

  // Guards: every reply in a thread is rendered and attributed to its author.
  it('writes every reply in the thread, attributed', () => {
    const doc = parseMarkdown(TEXT);
    const thread = threadOn('Venus', 'First.');
    const withReply: CommentThread = {
      ...thread,
      comments: [
        ...thread.comments,
        { id: 'c2', author: 'Grace', body: 'Disagree.', createdAt: '2026-09-16T11:00:00.000Z', editedAt: null },
      ],
    };
    const html = renderFragment(withCommentNotes(doc.root, { mode: 'endnotes', threads: [withReply], text: TEXT }));
    expect(html).toContain('Ada: First.');
    expect(html).toContain('Grace: Disagree.');
  });

  // Guards: a comment whose anchor now points at other document text is still shown as ordinary quoting.
  it('still shows a comment whose text has gone', () => {
    const doc = parseMarkdown(TEXT);
    const orphan: CommentThread = {
      ...threadOn('Venus', 'About a word that has gone.'),
      anchor: createAnchor('A different document entirely.\n', 2, 11),
    };
    const html = renderFragment(withCommentNotes(doc.root, { mode: 'endnotes', threads: [orphan], text: TEXT }));
    // A footnote definition nothing refers to renders as nothing at all, so an unanchorable comment is
    // written as ordinary text quoting what it was about.
    expect(html).toContain('About a word that has gone.');
    expect(html).toContain('different');
  });

  // Guards: HTML markup and ampersands in a note body are escaped rather than emitted verbatim.
  it('escapes markup in a margin note', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, {
        mode: 'margin-notes',
        threads: [threadOn('Venus', 'Try <script>alert(1)</script> & more')],
        text: TEXT,
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#x3C;script>');
    // An unescaped ampersand would swallow whatever entity happened to follow it.
    expect(html).toContain('&#x26; more');
  });

  // A comment that quotes an entity has to survive as the characters the commenter typed. Without the
  // ampersand being escaped first, "&lt;b&gt;" in a comment becomes a real <b> tag in the export.
  it('keeps an entity a commenter typed as text', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, {
        mode: 'margin-notes',
        threads: [threadOn('Venus', 'Write &lt;b&gt; for bold')],
        text: TEXT,
      }),
    );
    expect(html).not.toContain('<b>');
    expect(html).toContain('&#x26;lt;b&#x26;gt;');
  });

  // The export stylesheet names this class in its own text, so the two have to agree; a rename that
  // touched only one of them would style nothing.
  it('names the margin note class the stylesheet styles', () => {
    expect(MARGIN_NOTE_CLASS).toBe('kdoc-margin-note');
  });

  // The marker goes exactly where the comment was anchored, not at the head of the paragraph: a note
  // about one word is useless beside a different one.
  it('puts the note at the anchored word, not at the start of the block', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, { mode: 'margin-notes', threads: [threadOn('Venus', 'Here.')], text: TEXT }),
    );
    // Inside the paragraph, between the words: an element the HTML parser treats as a block would end
    // the paragraph here and split the sentence in two.
    expect(html).toContain(`<p>The first paragraph mentions <span class="${MARGIN_NOTE_CLASS}">Ada: Here.</span>Venus`);
  });

  // A comment on the second paragraph must land in the second paragraph. Placing every note in the
  // first block to contain any text would put this one in the wrong place entirely.
  it('finds the block the comment is actually in', () => {
    const doc = parseMarkdown(TEXT);
    const html = renderFragment(
      withCommentNotes(doc.root, { mode: 'margin-notes', threads: [threadOn('Mars', 'Later.')], text: TEXT }),
    );
    expect(html).toContain(`<p>The second paragraph mentions <span class="${MARGIN_NOTE_CLASS}">Ada: Later.</span>Mars`);
    expect(html.indexOf('Ada: Later.')).toBeGreaterThan(html.indexOf('first paragraph'));
  });

  // The replies are separated by something, or two comments run together into one sentence.
  it('separates the replies in a thread', () => {
    const doc = parseMarkdown(TEXT);
    const thread = threadOn('Venus', 'First.');
    const withReply: CommentThread = {
      ...thread,
      comments: [
        ...thread.comments,
        { id: 'c2', author: 'Grace', body: 'Disagree.', createdAt: '2026-09-16T11:00:00.000Z', editedAt: null },
      ],
    };
    const html = renderFragment(withCommentNotes(doc.root, { mode: 'endnotes', threads: [withReply], text: TEXT }));
    expect(html).toContain('Ada: First. — Grace: Disagree.');
  });

  // The margin arrangement has the same duty as endnotes: a comment that can no longer be placed
  // beside its text is still shown somewhere rather than dropped.
  it('still shows a margin note whose text has gone', () => {
    const doc = parseMarkdown(TEXT);
    const orphan: CommentThread = {
      ...threadOn('Venus', 'Orphaned note.'),
      anchor: createAnchor('A different document entirely.\n', 2, 11),
    };
    const html = renderFragment(withCommentNotes(doc.root, { mode: 'margin-notes', threads: [orphan], text: TEXT }));
    expect(html).toContain('Orphaned note.');
  });

  // renderHtml is the door every export goes through, so the arrangement has to reach it from there
  // and nothing may reach it without being asked for.
  it('reaches an export only when renderHtml is asked for it', () => {
    const doc = parseMarkdown(TEXT);
    const threads = [threadOn('Venus', 'Only if asked.')];

    expect(renderHtml(doc, { standalone: false })).not.toContain('Only if asked.');
    expect(
      renderHtml(doc, { standalone: false, comments: { mode: 'endnotes', threads, text: TEXT } }),
    ).toContain('Ada: Only if asked.');
  });
});
