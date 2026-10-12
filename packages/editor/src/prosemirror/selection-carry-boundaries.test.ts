// @vitest-environment jsdom
/** short file header: purpose = pins that a caret at the END of a text segment stays at that end when carried between panes (FR-5.6); segments are half-open, and the raw mappers snap such an offset forward to the next block. @version 1 @date 2026-09-13 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import type { Node as PMNode } from 'prosemirror-model';
import { mdastToProseMirror } from './from-mdast.js';
import { buildPositionIndex, positionToOffset, type PositionIndex } from './offset-map.js';
import { sourceSelectionToProseMirror, proseMirrorSelectionToSource } from './selection-carry.js';

const SOURCE: string = '# Title\n\nFirst paragraph ends here.\n\nSome **bold words** here\n\n- alpha\n- beta';

function build(source: string): { readonly index: PositionIndex; readonly doc: PMNode } {
  const parsed = parseMarkdown(source);
  const doc = mdastToProseMirror(parsed.root);
  return { index: buildPositionIndex(parsed.root, doc), doc };
}

function endOf(word: string): number {
  const start = SOURCE.indexOf(word);
  // Check whether the target word was found in the source string.
  if (start === -1) {
    expect.fail('missing ' + word);
  } else {
    // found
  }
  return start + word.length;
}

function caretInPm(index: PositionIndex, doc: PMNode, offset: number): number {
  const sel = sourceSelectionToProseMirror(index, doc, { anchor: offset, head: offset });
  // Check whether mapping the caret offset to ProseMirror succeeded.
  if (sel === null) {
    expect.fail('no mapping for ' + String(offset));
  } else {
    // mapped
  }
  return sel.head;
}

describe('carrying a caret at the end of a text segment', (): void => {
  it('keeps a caret at the end of a heading on the heading', (): void => {
    const { index, doc } = build(SOURCE);
    const head = caretInPm(index, doc, endOf('Title'));
    expect(doc.textBetween(head - 5, head)).toBe('Title');
  });

  it('keeps a caret at the end of a paragraph in that paragraph', (): void => {
    const { index, doc } = build(SOURCE);
    const head = caretInPm(index, doc, endOf('here.'));
    expect(doc.textBetween(head - 5, head)).toBe('here.');
  });

  it('keeps a caret at the end of a list item in that item', (): void => {
    const { index, doc } = build(SOURCE);
    const head = caretInPm(index, doc, endOf('alpha'));
    expect(doc.textBetween(head - 5, head)).toBe('alpha');
  });

  it('covers exactly a block\'s text when a selection ends at its end', (): void => {
    const { index, doc } = build(SOURCE);
    for (const word of ['Title', 'First paragraph ends here.']) {
      const start = SOURCE.indexOf(word);
      const sel = sourceSelectionToProseMirror(index, doc, { anchor: start, head: endOf(word) });
      // Narrow null selection before asserting content.
      if (sel === null) {
        expect.fail('no mapping for ' + word);
      } else {
        // mapped
      }
      expect(doc.textBetween(sel.from, sel.to, '\n')).toBe(word);
    }
  });

  it('returns a line-end caret to the same source offset', (): void => {
    const { index, doc } = build(SOURCE);
    for (const word of ['Title', 'here.', 'alpha']) {
      const offset = endOf(word);
      const head = caretInPm(index, doc, offset);
      const back = proseMirrorSelectionToSource(index, { anchor: head, head }, SOURCE.length);
      expect(back).toEqual({ anchor: offset, head: offset });
    }
  });

  it('handles the edge the raw mapper deliberately snaps past', (): void => {
    const { index, doc } = build(SOURCE);
    const offset = endOf('Title');
    const head = caretInPm(index, doc, offset);
    // If the first assertion ever fails, offset-map.ts no longer snaps forward and the carry's ending rule is redundant.
    expect(positionToOffset(index, head)).not.toBe(offset);
    expect(proseMirrorSelectionToSource(index, { anchor: head, head }, SOURCE.length)).toEqual({
      anchor: offset,
      head: offset,
    });
  });

  // Carets strictly inside text are unambiguous, so they must come back exactly.
  it('round-trips every caret strictly inside text', (): void => {
    const { index, doc } = build(SOURCE);
    for (const seg of index.segments) {
      // Check whether the segment maps character for character.
      if (!seg.linear) {
        // Non-linear segment: its interior snaps to a boundary by design.
        continue;
      } else {
        // Linear segment: every interior offset must survive a round trip.
      }
      for (let i = seg.srcStart + 1; i < seg.srcEnd; i++) {
        const head = caretInPm(index, doc, i);
        const back = proseMirrorSelectionToSource(index, { anchor: head, head }, SOURCE.length);
        expect(back).toEqual({ anchor: i, head: i });
      }
    }
  });

  // At an inline formatting boundary two source offsets -- either side of invisible markup such as
  // `**` -- are one position in WYSIWYG, so one of them must come back on the other side. What must
  // hold is that switching again never walks the caret further, and it never changes visible place.
  it('never walks a caret at a segment edge on repeated switches', (): void => {
    const { index, doc } = build(SOURCE);
    for (const seg of index.segments) {
      for (const i of [seg.srcStart, seg.srcEnd]) {
        const head = caretInPm(index, doc, i);
        const once = proseMirrorSelectionToSource(index, { anchor: head, head }, SOURCE.length);
        // Check whether the edge offset mapped back at all.
        if (once === null) {
          expect.fail('no mapping back for ' + String(i));
        } else {
          // Mapped: it must land on the same visible position, and a second trip must not move it.
        }
        expect(caretInPm(index, doc, once.head)).toBe(head);
        const twice = proseMirrorSelectionToSource(index, { anchor: head, head }, SOURCE.length);
        expect(twice).toEqual(once);
        const headAgain = caretInPm(index, doc, once.head);
        expect(proseMirrorSelectionToSource(index, { anchor: headAgain, head: headAgain }, SOURCE.length)).toEqual(once);
      }
    }
  });

  it('never lets the carried ends cross', (): void => {
    const { index, doc } = build(SOURCE);
    for (let a = 0; a <= SOURCE.length; a += 3) {
      for (let b = a; b <= SOURCE.length; b += 3) {
        const sel = sourceSelectionToProseMirror(index, doc, { anchor: a, head: b });
        // Check whether the selection range mapped to ProseMirror.
        if (sel !== null) {
          expect(sel.anchor <= sel.head).toBe(true);
        } else {
          // Unmapped range.
        }
      }
    }
  });
});
