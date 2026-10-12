/**
 * @file line-endings.spec.ts
 * @purpose Verifies CRLF files convert to LF for the editor and back exactly
 * @inputs fromDisk, toDisk
 * @outputs vitest assertions
 * @functions none
 * @dataflow text -> fromDisk -> toDisk
 * @controlflow one describe per function
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { fromDisk, toDisk } from '../src/files/line-endings.js';

describe('fromDisk', (): void => {
  it('converts a CRLF file to LF and remembers it', (): void => {
    expect(fromDisk('# A\r\n\r\ntext\r\n')).toEqual({ text: '# A\n\ntext\n', lineEnding: 'crlf' });
  });
  it('leaves an LF file, a file without breaks, and a file mixing endings as written', (): void => {
    expect(fromDisk('a\nb\n')).toEqual({ text: 'a\nb\n', lineEnding: 'lf' });
    expect(fromDisk('one line')).toEqual({ text: 'one line', lineEnding: 'lf' });
    expect(fromDisk('a\r\nb\n')).toEqual({ text: 'a\r\nb\n', lineEnding: 'lf' });
    expect(fromDisk('\na\r\n')).toEqual({ text: '\na\r\n', lineEnding: 'lf' });
  });
  it('keeps a lone carriage return', (): void => {
    expect(fromDisk('a\rb\r\n')).toEqual({ text: 'a\rb\n', lineEnding: 'crlf' });
  });
});

describe('toDisk', (): void => {
  it('writes LF text unchanged and CRLF text with CRLF', (): void => {
    expect(toDisk('a\nb\n', 'lf')).toBe('a\nb\n');
    expect(toDisk('a\nb\n', 'crlf')).toBe('a\r\nb\r\n');
  });
  it('restores every CRLF file byte for byte', (): void => {
    for (const original of ['# A\r\n\r\ntext\r\n', 'x\r\r\ny\r\n', '\r\n', 'a\rb\r\nc', 'no final break\r\nend']) {
      const internal = fromDisk(original);
      expect(internal.lineEnding).toBe('crlf');
      expect(toDisk(internal.text, internal.lineEnding)).toBe(original);
    }
  });
});