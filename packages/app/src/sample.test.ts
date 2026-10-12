/**
 * @file sample.test.ts
 * @purpose Pins the welcome document: it parses and re-serializes stably and makes no stale claims.
 * @inputs SAMPLE_DOCUMENT.
 * @outputs Vitest assertions.
 * @functions (suite) SAMPLE_DOCUMENT.
 * @dataflow SAMPLE_DOCUMENT -> parseMarkdown -> serializeDocument -> comparison.
 * @controlflow Independent cases.
 * @version 1
 * @date 2026-10-07
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { SAMPLE_DOCUMENT } from './sample.js';

describe('SAMPLE_DOCUMENT', () => {
  it('parses and re-serializes stably, so every construct in it is one the engine understands', () => {
    // Canonical form is a fixed point: a construct the parser or serializer mishandled would drift on the second pass.
    const canonical = serializeDocument(parseMarkdown(SAMPLE_DOCUMENT));
    expect(serializeDocument(parseMarkdown(canonical))).toBe(canonical);
  });

  it('makes no claim from before files could be saved', () => {
    expect(SAMPLE_DOCUMENT).not.toMatch(/saved anywhere yet|Opening and saving real files/);
  });

  it('starts with the welcome heading', () => {
    expect(SAMPLE_DOCUMENT.startsWith('# Welcome to K-Doc\n')).toBe(true);
  });
});
