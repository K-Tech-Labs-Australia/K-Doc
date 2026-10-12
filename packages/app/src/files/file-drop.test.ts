/**
 * @file file-drop.test.ts
 * @purpose Vitest test suite for K-Doc's file drop path classifier and controller installation (packages/app/src/files/file-drop.ts).
 *   Verifies POSIX and Windows path handling, image vs link categorization, dotfiles, compound extensions, case insensitivity,
 *   and fallback behavior outside Tauri desktop host.
 * @inputs File path strings with diverse separators and extensions; mock Window objects.
 * @outputs Vitest assertions verifying DroppedInsert structures (kind, path, label) and FileDrop controller lifecycle.
 * @functions None.
 * @dataflow File path string -> classifyDroppedPath -> DroppedInsert descriptor -> Vitest assertions.
 * @controlflow Execute tests for image paths, link fallbacks, dotfiles, compound extensions, case insensitivity, and browser mode installation.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import {
  classifyDroppedPath,
  installFileDrop,
  type DroppedInsert,
} from './file-drop.js';

describe('classifyDroppedPath', () => {
  // Pins POSIX image path classification extracting image kind and extensionless label.
  it('classifies a POSIX image path as an image with stripped directory and extension', () => {
    const result = classifyDroppedPath('/home/user/images/photo.png');
    expect(result).toEqual({
      kind: 'image',
      path: '/home/user/images/photo.png',
      label: 'photo',
    });
  });

  // Pins Windows backslash path classification extracting image kind and extensionless label.
  it('classifies a Windows image path with backslashes as an image with stripped directory and extension', () => {
    const result = classifyDroppedPath('C:\\Users\\user\\Pictures\\diagram.jpg');
    expect(result).toEqual({
      kind: 'image',
      path: 'C:\\Users\\user\\Pictures\\diagram.jpg',
      label: 'diagram',
    });
  });

  // Pins markdown document path classification as a link fallback.
  it('classifies a markdown file as a link', () => {
    // Everything unrecognised (or non-image, such as markdown documents) becomes a link rather than being refused,
    // because a link is always expressible in Markdown while an embed is not.
    const result = classifyDroppedPath('/docs/readme.md');
    expect(result).toEqual({
      kind: 'link',
      path: '/docs/readme.md',
      label: 'readme',
    });
  });

  // Pins PDF document path classification as a link fallback.
  it('classifies a pdf file as a link', () => {
    // Everything unrecognised becomes a link rather than being refused, because a link is always expressible in Markdown while an embed is not.
    const result = classifyDroppedPath('/files/document.pdf');
    expect(result).toEqual({
      kind: 'link',
      path: '/files/document.pdf',
      label: 'document',
    });
  });

  // Pins extensionless filename classification as a link fallback retaining full name as label.
  it('classifies an extensionless LICENSE file as a link', () => {
    // Everything unrecognised becomes a link rather than being refused, because a link is always expressible in Markdown while an embed is not.
    const result = classifyDroppedPath('/project/LICENSE');
    expect(result).toEqual({
      kind: 'link',
      path: '/project/LICENSE',
      label: 'LICENSE',
    });
  });

  // Pins dotfile classification preserving the leading dot and complete filename as label.
  it('keeps the whole name as label for a dotfile such as .gitignore', () => {
    const result = classifyDroppedPath('/repo/.gitignore');
    expect(result).toEqual({
      kind: 'link',
      path: '/repo/.gitignore',
      label: '.gitignore',
    });
  });

  // Pins compound extension filenames stripping only the final extension suffix.
  it('takes only the final extension for a filename with two dots', () => {
    const result = classifyDroppedPath('/downloads/archive.tar.gz');
    expect(result).toEqual({
      kind: 'link',
      path: '/downloads/archive.tar.gz',
      label: 'archive.tar',
    });
  });

  // Pins case-insensitive matching for uppercase image extensions.
  it('performs case-insensitive extension matching for uppercase image extensions', () => {
    const result = classifyDroppedPath('/media/PHOTO.PNG');
    expect(result).toEqual({
      kind: 'image',
      path: '/media/PHOTO.PNG',
      label: 'PHOTO',
    });
  });
});

describe('installFileDrop', () => {
  // Pins inert controller behavior reporting unavailable and non-throwing destroy outside Tauri.
  it('reports available false outside Tauri and does not throw on destroy', () => {
    // The browser dev harness has no OS drop to receive, so installFileDrop reports available: false and remains inert.
    const inserted: DroppedInsert[] = [];
    const controller = installFileDrop({
      win: {} as Window,
      onInsert: (item: DroppedInsert): void => {
        inserted.push(item);
      },
    });

    expect(controller.available).toBe(false);
    expect((): void => {
      controller.destroy();
    }).not.toThrow();
  });
});
