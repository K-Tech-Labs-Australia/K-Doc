/**
 * @file open-tab.spec.ts
 * @purpose Verifies openTabFor finds the tab already showing a file.
 * @inputs tab records (PathTab[]).
 * @outputs vitest assertions.
 * @functions none.
 * @dataflow records -> openTabFor -> id.
 * @controlflow one describe.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { openTabFor, type PathTab } from '../src/shell/open-tab.js';

const TABS: readonly PathTab[] = [
  { id: 'untitled', payload: { path: null } },
  { id: 'alpha', payload: { path: 'C:/notes/alpha.md' } },
  { id: 'beta', payload: { path: 'C:/notes/beta.md' } },
  { id: 'beta-again', payload: { path: 'C:/notes/beta.md' } },
];

describe('openTabFor', (): void => {
  it('finds the tab showing the file', (): void => {
    expect(openTabFor(TABS, 'C:/notes/alpha.md')).toBe('alpha');
  });
  it('matches a path written with other separators or case, as Windows does', (): void => {
    expect(openTabFor(TABS, 'c:\\Notes\\ALPHA.md')).toBe('alpha');
  });
  it('returns the first tab when two show the file', (): void => {
    expect(openTabFor(TABS, 'C:/notes/beta.md')).toBe('beta');
  });
  it('returns null for a file no tab shows, and never matches an unsaved tab', (): void => {
    expect(openTabFor(TABS, 'C:/notes/gamma.md')).toBeNull();
    expect(openTabFor([{ id: 'untitled', payload: { path: null } }], '')).toBeNull();
  });
});