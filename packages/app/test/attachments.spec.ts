/**
 * @file attachments.spec.ts
 * @purpose Covers FR-6.14: where an attachment is written (the folder resolved against the note), what the document refers to it by, whether a file already sits in that folder, and the three host commands that write, copy, and list attachments through the Tauri backend.
 * @inputs An `ipc` mock capturing every Tauri invoke call plus command handlers, fixtures of a tauri window (with `__TAURI_INTERNALS__`) and a browser window, and the pure path helpers under test.
 * @outputs Assertions over createAttachments write / copy / names against mocked IPC, and assertions over attachmentsFolderPath, attachmentReference, isInsideFolder, and DEFAULT_ATTACHMENTS_FOLDER.
 * @functions ipc - hoisted recorder of every invoke call and its registered command handlers.
 * @dataflow ipc mock -> createAttachments -> write / copy / names -> assertions over results and issued commands; path helpers asserted directly.
 * @controlflow Four describe blocks; each it registers IPC handlers, then awaits the result and asserts on the returned value or the recorded invoke args.
 * @version 2
 * @date 2026-09-18
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (args: Record<string, unknown>) => unknown;
const ipc = vi.hoisted((): { calls: Array<{ cmd: string; args: Record<string, unknown> }>; handlers: Record<string, Handler> } => ({ calls: [], handlers: {} }));

vi.mock('@tauri-apps/api/core', (): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    ipc.calls.push({ cmd, args });
    const handler = ipc.handlers[cmd];
    return handler === undefined ? undefined : handler(args);
  },
}));

import { createAttachments, attachmentExtensionFor, attachmentsFolderPath, attachmentReference, isInsideFolder, DEFAULT_ATTACHMENTS_FOLDER } from '../src/files/attachments.js';

beforeEach((): void => {
  // Clear the recorded calls and registered handlers between tests.
  ipc.calls.length = 0;
  ipc.handlers = {};
});

const tauriWin = { __TAURI_INTERNALS__: {} } as unknown as Window;
const browserWin = {} as unknown as Window;

describe('the folder attachments go in', () => {
  // Guards defaulting to a sibling folder beside the document when none is named.
  it('sits beside the document by default', () => {
    expect(attachmentsFolderPath('C:/notes/note.md', '')).toBe('C:/notes/attachments');
  });

  // Guards using the reader's own name for the attachment folder.
  it('is the folder the reader named', () => {
    expect(attachmentsFolderPath('C:/notes/note.md', 'media')).toBe('C:/notes/media');
  });

  // Guards honouring an absolute folder exactly as written, ignoring the document's location.
  it('is used as written when the reader named an absolute one', () => {
    expect(attachmentsFolderPath('C:/notes/note.md', 'D:/shared/media')).toBe('D:/shared/media');
  });

  // Guards having no folder at all until the note is saved to disk.
  it('is nowhere until the document is saved', () => {
    expect(attachmentsFolderPath('', 'media')).toBe('');
  });

  // Guards the documented default folder name.
  it('defaults to the documented folder name', () => {
    expect(DEFAULT_ATTACHMENTS_FOLDER).toBe('attachments');
  });
});

describe('what the document says about an attachment', () => {
  // Guards naming the attachment relative to the note so it travels with the document.
  it('names it relative to the note', () => {
    expect(attachmentReference('', 'shot.png')).toBe('attachments/shot.png');
  });

  // Guards naming the file directly when the folder is the note's own directory.
  it('names it directly when the folder is the note\'s own', () => {
    expect(attachmentReference('.', 'shot.png')).toBe('shot.png');
  });

  // Guards converting a Windows backslash separator into a forward slash in the reference.
  it('turns a windows separator into a forward slash', () => {
    expect(attachmentReference('media\\shots', 'shot.png')).toBe('media/shots/shot.png');
  });

  // Guards naming an absolute folder with its absolute path intact.
  it('names an absolute folder absolutely', () => {
    expect(attachmentReference('D:/shared', 'shot.png')).toBe('D:/shared/shot.png');
  });
});

describe('an attachment already in the folder', () => {
  // Guards case-insensitive recognition of a file already inside the folder.
  it('is recognised whatever case it is spelled in', () => {
    expect(isInsideFolder('C:/Notes/Attachments/shot.png', 'C:/notes/attachments')).toBe(true);
  });

  // Guards recognition across Windows separators as well as forward slashes.
  it('is recognised across separators', () => {
    expect(isInsideFolder('C:\\notes\\attachments\\shot.png', 'C:/notes/attachments')).toBe(true);
  });

  // Guards rejecting a file that lives outside the folder.
  it('is not recognised outside the folder', () => {
    expect(isInsideFolder('C:/elsewhere/shot.png', 'C:/notes/attachments')).toBe(false);
  });

  // Guards never treating a path as inside when no folder was named at all.
  it('is never inside a folder nobody named', () => {
    expect(isInsideFolder('C:/notes/attachments/shot.png', '')).toBe(false);
    expect(isInsideFolder('/home/notes/attachments/shot.png', '')).toBe(false);
  });
});

describe('writing an attachment', () => {
  // Guards handing the bytes to the host and reporting the name it actually used.
  it('hands the bytes to the host and reports the name it used', async () => {
    ipc.handlers['attachment_write'] = (): string => 'shot-2.png';
    const name = await createAttachments(tauriWin).write('C:/notes/attachments', 'shot.png', new Uint8Array([1, 2]));
    expect(name).toBe('shot-2.png');
    expect(ipc.calls[0]?.args).toEqual({ folder: 'C:/notes/attachments', name: 'shot.png', data: [1, 2] });
  });

  // Guards asking the host to copy a file it already holds.
  it('asks the host to copy a file it already has', async () => {
    ipc.handlers['attachment_copy'] = (): string => 'shot.png';
    await createAttachments(tauriWin).copy('C:/notes/attachments', 'shot.png', 'D:/pics/shot.png');
    expect(ipc.calls[0]?.args).toEqual({ folder: 'C:/notes/attachments', name: 'shot.png', source: 'D:/pics/shot.png' });
  });

  // Guards listing the names the host reports for a folder.
  it('lists what the folder holds', async () => {
    ipc.handlers['attachment_names'] = (): string[] => ['a.png'];
    expect(await createAttachments(tauriWin).names('C:/notes/attachments')).toEqual(['a.png']);
  });

  // Guards refusing to write or copy anything outside the desktop app.
  it('cannot be done outside the desktop app', async () => {
    await expect(createAttachments(browserWin).write('f', 'a.png', new Uint8Array())).rejects.toThrow('Adding attachments requires the desktop app.');
    await expect(createAttachments(browserWin).copy('f', 'a.png', 'x')).rejects.toThrow('Adding attachments requires the desktop app.');
  });

  // Guards reporting an empty folder rather than failing outside the desktop app.
  it('reports an empty folder outside the desktop app', async () => {
    expect(await createAttachments(browserWin).names('f')).toEqual([]);
    expect(ipc.calls.length).toBe(0);
  });
});

describe('the extension a pasted image is written with', () => {
  // Guards each image type K-Doc writes mapping to the extension its file carries.
  it('is the one its type names', () => {
    expect(attachmentExtensionFor('image/png')).toBe('png');
    expect(attachmentExtensionFor('image/jpeg')).toBe('jpg');
    expect(attachmentExtensionFor('image/gif')).toBe('gif');
    expect(attachmentExtensionFor('image/webp')).toBe('webp');
    expect(attachmentExtensionFor('image/svg+xml')).toBe('svg');
    expect(attachmentExtensionFor('image/avif')).toBe('avif');
    expect(attachmentExtensionFor('image/bmp')).toBe('bmp');
  });

  // Guards reading a clipboard type that carries parameters or unusual case.
  it('is found whatever case and parameters the type carries', () => {
    expect(attachmentExtensionFor('IMAGE/PNG')).toBe('png');
    expect(attachmentExtensionFor('image/png;charset=binary')).toBe('png');
    expect(attachmentExtensionFor('  image/png  ')).toBe('png');
  });

  // Guards refusing a type that is not an image K-Doc writes.
  it('is nothing for a type K-Doc does not write', () => {
    expect(attachmentExtensionFor('image/tiff')).toBe('');
    expect(attachmentExtensionFor('text/plain')).toBe('');
    expect(attachmentExtensionFor('')).toBe('');
  });
});
