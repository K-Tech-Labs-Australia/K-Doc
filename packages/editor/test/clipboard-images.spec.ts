// @vitest-environment jsdom
/**
 * @file clipboard-images.spec.ts
 * @purpose Tests the image-file branch of createClipboardHandlers (FR-6.14): when a clipboard carries
 *   image files they are offered to the shell via onPasteImages rather than inserted as text, and only
 *   the entries whose type is an image are handed over.
 * @inputs ClipboardEvents carrying a FileList-like `files` array plus html/plain strings; an EditorState
 *   built from kdocSchema standing in for a ProseMirror view with a no-op dispatch.
 * @outputs The boolean returned by handlePaste, the File[] arrays passed to onPasteImages, and call counts.
 * @functions
 *   - fakeFile: Builds a File carrying a given MIME type for a clipboard entry.
 *   - pasteEvent: Builds the minimal ClipboardEvent object handlePaste reads.
 *   - emptyView: Returns an EditorState-backed stand-in for an EditorView with a no-op dispatch.
 * @dataflow ClipboardEvent → iterate files → keep image-typed entries → onPasteImages(images) → return true or fall through to text handling.
 * @controlflow Guard code block and clipboardData → collect images → if images exist and onPasteImages is set, call it and honor its boolean; otherwise continue with the ordinary paste path.
 * @version 2
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createClipboardHandlers } from '../src/prosemirror/clipboard.js';
import { kdocSchema } from '../src/prosemirror/schema.js';

/** The FileList-like shape handlePaste reads for image files. */
interface FakeFileList {
  readonly length: number;
  item(index: number): File | null;
}

/** The clipboardData object handlePaste reads, typed so the fake is built without `any`. */
interface FakeClipboardData {
  readonly files: FakeFileList;
  getData(kind: string): string;
}

/** The ClipboardEvent stand-in built by pasteEvent. */
interface FakeClipboardEvent {
  readonly clipboardData: FakeClipboardData;
  preventDefault(): void;
}

/**
 * Builds a File the clipboard would carry, carrying only a MIME type for a type check.
 * @purpose Produce a minimal File whose `type` field can be asserted against 'image/'.
 * @inputs type - The MIME type string to give the file (for example 'image/png').
 * @outputs File - A File named 'shot.png' with the given type.
 */
function fakeFile(type: string): File {
  return new File([new Uint8Array([1])], 'shot.png', { type });
}

/**
 * Builds the smallest object handlePaste reads for a paste event.
 * @purpose Assemble a clipboardData with a FileList-like `files` and a getData that returns html or text.
 * @inputs files - The files to expose on the clipboard; html - The value getData('text/html') returns; text - The value getData('text/plain') returns.
 * @outputs ClipboardEvent - A cast stand-in carrying the fake clipboardData and a no-op preventDefault.
 */
function pasteEvent(files: readonly File[], html: string, text: string): ClipboardEvent {
  const list: FakeFileList = {
    length: files.length,
    item: (index: number): File | null => files[index] ?? null,
  };
  const clipboardData: FakeClipboardData = {
    files: list,
    getData: (kind: string): string => (kind === 'text/html' ? html : text),
  };
  const event: FakeClipboardEvent = {
    clipboardData,
    preventDefault: (): void => {},
  };
  return event as unknown as ClipboardEvent;
}

/**
 * Returns the least an EditorView needs for these cases: a fresh state and a no-op dispatch.
 * @purpose Stand in for a ProseMirror view so handlePaste can read view.state and receive dispatched transactions without mounting a DOM.
 * @outputs EditorView - A cast stand-in exposing state and a dispatch that applies nothing.
 */
let dispatched = 0;

function emptyView(): EditorView {
  // Each test takes a fresh view, so the count belongs to the paste that test makes.
  dispatched = 0;
  const view = {
    state: EditorState.create({ schema: kdocSchema }),
    dispatch: (): void => {
      dispatched += 1;
    },
  };
  return view as unknown as EditorView;
}

describe('a pasted image', () => {
  // Guards that an image file is handed to the shell via onPasteImages and returns true without text insertion.
  it('is handed to the shell rather than inserted as text', () => {
    const seen: File[][] = [];
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      onPasteImages: (images): boolean => {
        seen.push([...images]);
        return true;
      },
    });
    const view = emptyView();
    const result = handlers.handlePaste(view, pasteEvent([fakeFile('image/png')], '', ''));
    expect(result).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0]?.length).toBe(1);
    expect(seen[0]?.[0]?.type).toBe('image/png');
    expect(dispatched).toBe(0);
  });

  // Guards that declining the images lets the ordinary text path run, with onPasteImages called exactly once.
  it('is left to the text handling when the shell declines it', () => {
    let calls = 0;
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      onPasteImages: (): boolean => {
        calls += 1;
        return false;
      },
    });
    const view = emptyView();
    handlers.handlePaste(view, pasteEvent([fakeFile('image/png')], '', 'hello'));
    expect(calls).toBe(1);
    expect(dispatched).toBe(1);
  });

  // Guards that only image-typed entries are handed over when the clipboard mixes a text file with an image.
  it('is only the image files on the clipboard', () => {
    const seen: File[][] = [];
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      onPasteImages: (images): boolean => {
        seen.push([...images]);
        return true;
      },
    });
    const view = emptyView();
    handlers.handlePaste(
      view,
      pasteEvent([fakeFile('text/plain'), fakeFile('image/jpeg')], '', '')
    );
    expect(seen.length).toBe(1);
    expect(seen[0]?.length).toBe(1);
    expect(seen[0]?.[0]?.type).toBe('image/jpeg');
  });

  // Guards that no image handling occurs when onPasteImages is not supplied, and the result stays a boolean.
  it('is not looked for when nothing wants it', () => {
    const handlers = createClipboardHandlers({ schema: kdocSchema });
    const view = emptyView();
    const result = handlers.handlePaste(view, pasteEvent([fakeFile('image/png')], '', 'hello'));
    expect(typeof result).toBe('boolean');
  });

  // Guards that a text-only paste never invokes onPasteImages.
  it('leaves a text-only paste alone', () => {
    let calls = 0;
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      onPasteImages: (): boolean => {
        calls += 1;
        return false;
      },
    });
    const view = emptyView();
    handlers.handlePaste(view, pasteEvent([], '', 'hello'));
    expect(calls).toBe(0);
  });
});
