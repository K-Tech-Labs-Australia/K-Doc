/**
 * @file attachment-name.spec.ts
 * @purpose Verifies the on-disk attachment naming template: token expansion, sanitisation, extension sourcing, and fallback selection per FR-6.14.
 * @inputs The AttachmentNameContext fixture (source name, document title, extension, timestamp) and the exported naming functions under test.
 * @outputs A vitest describe/it suite asserting each documented behaviour of attachment-name.ts against its expected value.
 * @functions
 *   - context: Builds an AttachmentNameContext fixture with defaults overridable per test.
 *   - (describe groups): Twelve focused tests covering the default template, {doc}/{time} tokens, pasted fallback, extension source, path-traversal safety, sanitisation, unknown tokens, and the public token/template contract.
 * @dataflow Fixture context → naming function under test → produced file name → assertion against expected value.
 * @controlflow Define fixture → group assertions under describe → run each it in isolation, asserting one behaviour at a time.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { attachmentFileName, applyTemplate, sanitizeNamePart, DEFAULT_ATTACHMENT_TEMPLATE, PASTED_ATTACHMENT_NAME, FALLBACK_ATTACHMENT_NAME, ATTACHMENT_TOKENS } from '../src/attachments/attachment-name.js';

// 18 September 2026, 09:05:03 local time — the month argument is zero-based in the Date constructor.
const at = new Date(2026, 8, 18, 9, 5, 3);

/**
 * @purpose Builds an AttachmentNameContext fixture with default values that each test may override.
 * @inputs over - An optional partial context whose fields replace the corresponding defaults.
 * @outputs A complete AttachmentNameContext ready to feed the naming functions under test.
 */
function context(over: Partial<{ name: string; document: string; extension: string; at: Date }> = {}) {
  return { name: 'Photo', document: 'My Note', extension: 'png', at, ...over };
}

describe('an attachment name', () => {
  // Guards the default template: source name followed by the date, with the file extension appended.
  it('keeps the source name and the date the default template asks for', () => {
    expect(attachmentFileName('', context())).toBe('Photo-2026-09-18.png');
  });

  // Guards the {doc} token: a document title carrying a space is sanitised to a hyphen in the stem.
  it('names itself for the document when the template asks for it', () => {
    expect(attachmentFileName('{doc}-{name}', context())).toBe('My-Note-Photo.png');
  });

  // Guards the {time} token: local wall-clock time is emitted as a compact HHMMSS stamp.
  it('carries the time when the template asks for it', () => {
    expect(attachmentFileName('{name}-{time}', context())).toBe('Photo-090503.png');
  });

  // Guards the pasted-image fallback: an empty source name resolves to the fixed pasted name.
  it('stands in for a pasted image that has no name of its own', () => {
    expect(attachmentFileName('{name}', context({ name: '' }))).toBe(`${PASTED_ATTACHMENT_NAME}.png`);
  });

  // Guards extension sourcing: the template's trailing text is part of the stem, never an extension.
  it('takes its extension from the file, never from the template', () => {
    // The ".jpg" written in the template is sanitised into the stem; only the context extension is appended after it.
    expect(attachmentFileName('{name}.jpg', context())).toBe('Photo.jpg.png');
  });

  // Guards extension omission: a file with no extension yields a bare stem with no trailing dot.
  it('is left without an extension when the file has none', () => {
    expect(attachmentFileName('{name}', context({ extension: '' }))).toBe('Photo');
  });

  // Guards the fallback name: a template whose only token sanitises to nothing falls back to "attachment".
  it('falls back to a name of its own when nothing survives', () => {
    expect(attachmentFileName('{doc}', context({ document: '   ' }))).toBe(`${FALLBACK_ATTACHMENT_NAME}.png`);
  });

  // Guards path-traversal safety: separators and dot-dots are stripped so the stem cannot escape its folder.
  it('cannot be made to leave its folder', () => {
    const result = attachmentFileName('{name}', context({ name: '../../etc/passwd' }));
    expect(result).toBe('etc-passwd.png');
    expect(result).not.toContain('/');
    expect(result).not.toContain('..');
  });

  // Guards forbidden-character removal: characters a file system rejects are rewritten to hyphens.
  it('loses the characters a file name may not carry', () => {
    expect(sanitizeNamePart('a:b*c?d"e<f>g|h\\i/j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  // Guards whitespace and hyphen-run collapsing: spacing and repeated separators collapse to single hyphens.
  it('collapses whitespace and runs of hyphens', () => {
    expect(sanitizeNamePart('  two   words -- here  ')).toBe('two-words-here');
  });

  // Guards unknown tokens: braces the template does not define are left untouched in the output.
  it('keeps an unknown token as written in the template', () => {
    expect(applyTemplate('{name}-{nope}', context())).toBe('Photo-{nope}');
  });

  // Guards the public contract: the exact set of tokens and the default template string.
  it('lists the tokens a template may use', () => {
    expect(ATTACHMENT_TOKENS).toEqual(['name', 'doc', 'date', 'time']);
    expect(DEFAULT_ATTACHMENT_TEMPLATE).toBe('{name}-{date}');
  });
});
