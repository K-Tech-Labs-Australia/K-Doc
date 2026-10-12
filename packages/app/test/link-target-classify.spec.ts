/**
 * @file link-target-classify.spec.ts
 * @purpose Tests headingSlug, findHeadingBySlug and the non-path branches of classifyLink (FR-8.13).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect } from 'vitest';
import { classifyLink, findHeadingBySlug, headingSlug } from '../src/shell/link-target.js';
import type { LinkContext } from '../src/shell/link-target.js';
import type { OutlineEntry } from '@k-doc/core';

const CTX: LinkContext = { documentPath: null, notes: [] };

function heading(text: string, index: number): OutlineEntry {
  return { depth: 2, text, start: index * 10, end: index * 10 + text.length, index };
}

describe('headingSlug', () => {
  it('strips punctuation and lowercases the text', (): void => {
    expect(headingSlug("What's New in 2.0?")).toBe('whats-new-in-20');
  });

  it('collapses internal whitespace and trims edges', (): void => {
    expect(headingSlug('  Hello   World  ')).toBe('hello-world');
  });

  it('trims leading and trailing dashes', (): void => {
    expect(headingSlug('--Edge--')).toBe('edge');
  });
});

describe('findHeadingBySlug', () => {
  const introInstall = [heading('Intro', 0), heading('Install', 1)];

  it('returns the matching entry by slug', (): void => {
    expect(findHeadingBySlug(introInstall, 'install')?.index).toBe(1);
  });

  it('appends a numeric suffix for duplicate slugs', (): void => {
    const notes = [heading('Notes', 0), heading('Other', 1), heading('Notes', 2)];
    expect(findHeadingBySlug(notes, 'notes')?.index).toBe(0);
    expect(findHeadingBySlug(notes, 'notes-1')?.index).toBe(2);
  });

  it('matches slugs case-insensitively', (): void => {
    expect(findHeadingBySlug(introInstall, 'INSTALL')?.index).toBe(1);
  });

  it('returns null when no heading matches', (): void => {
    expect(findHeadingBySlug([heading('Intro', 0)], 'missing')).toBeNull();
  });
});

describe('classifyLink without paths', () => {
  it('treats whitespace-only input as unresolved', (): void => {
    expect(classifyLink('   ', CTX)).toEqual({ kind: 'unresolved', target: '   ', reason: 'This link has no target.' });
  });

  it('classifies a heading reference', (): void => {
    expect(classifyLink('#install', CTX)).toEqual({ kind: 'heading', slug: 'install' });
  });

  it('leaves a bare hash unresolved', (): void => {
    expect(classifyLink('#', CTX).kind).toBe('unresolved');
  });

  it('normalizes the URL and extracts the domain', (): void => {
    expect(classifyLink('https://Example.com/a?b=1', CTX)).toEqual({ kind: 'web', url: 'https://example.com/a?b=1', domain: 'example.com' });
  });

  it('classifies a protocol-relative URL as web', (): void => {
    const result = classifyLink('//cdn.example.com/x', CTX);
    if (result.kind === 'web') {
      expect(result.domain).toBe('cdn.example.com');
    } else {
      expect.fail('not web');
    }
  });

  it('rejects an empty web scheme', (): void => {
    expect(classifyLink('https://', CTX)).toEqual({ kind: 'unresolved', target: 'https://', reason: 'Not a valid web address.' });
  });

  it('parses mailto links and extracts the address', (): void => {
    expect(classifyLink('mailto:someone@example.com?subject=Hi', CTX)).toEqual({ kind: 'mail', url: 'mailto:someone@example.com?subject=Hi', address: 'someone@example.com' });
  });

  it('rejects an empty mailto scheme', (): void => {
    expect(classifyLink('mailto:', CTX)).toEqual({ kind: 'unresolved', target: 'mailto:', reason: 'This link has no address.' });
  });

  it('blocks javascript schemes', (): void => {
    expect(classifyLink('javascript:alert(1)', CTX)).toEqual({ kind: 'blocked', target: 'javascript:alert(1)', scheme: 'javascript' });
  });

  it('blocks data schemes', (): void => {
    expect(classifyLink('data:text/html,x', CTX)).toEqual({ kind: 'blocked', target: 'data:text/html,x', scheme: 'data' });
  });

  it('blocks file schemes', (): void => {
    expect(classifyLink('file:///C:/x', CTX)).toEqual({ kind: 'blocked', target: 'file:///C:/x', scheme: 'file' });
  });

  it('blocks vbscript schemes', (): void => {
    expect(classifyLink('VBScript:x', CTX)).toEqual({ kind: 'blocked', target: 'VBScript:x', scheme: 'vbscript' });
  });
});
