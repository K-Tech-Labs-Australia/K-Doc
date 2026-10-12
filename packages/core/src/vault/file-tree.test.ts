/**
 * @file file-tree.test.ts
 * @purpose Unit tests for the vault file-tree model: name comparison, relative/absolute path helpers, tree construction, visibility flattening, and entry-name validation.
 * @inputs Vitest harness (describe/it/expect); fixture NOTES (two notes) and TREE (built from those notes plus folders a, a/empty, B); exported pure functions imported from ./file-tree.js.
 * @outputs Test outcomes: each numbered case asserts exact expected strings, arrays, booleans, or nulls via Vitest's expect.
 * @functions
 *   - names: Maps visible rows to compact "depth:relative" labels for concise assertions.
 *   - describe('names and paths'): cases 1-9 covering comparators, path helpers, remapping, and name generation.
 *   - describe('validateEntryName'): cases 10-15 covering rejection rules and acceptance.
 *   - describe('buildFileTree'): cases 16-19 covering ordering, nesting, note metadata, and implicit folders.
 *   - describe('flattenVisible and childNames'): cases 20-22 covering expansion and child resolution.
 * @dataflow Fixture notes + folders → buildFileTree → TREE; exported helpers exercised directly with fixed inputs → compared against expected values.
 * @controlflow Four describe groups run sequentially; each it() asserts one numbered behavior, throwing on mismatch through Vitest's expect matcher.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect } from 'vitest';
import { absolutePath, baseName, buildFileTree, childNames, childRelative, compareNames, flattenVisible, isSameOrInside, parentRelative, remapPath, topLevelOnly, uniqueChildName, validateEntryName, withNoteExtension, type VisibleRow } from './file-tree.js';

const NOTES = [
  { path: '/v/z.md', relative: 'z.md', title: 'Z' },
  { path: '/v/a/n.md', relative: 'a/n.md', title: 'N' },
];
const TREE = buildFileTree(NOTES, ['a', 'a/empty', 'B']);

/**
 * @purpose Maps visible rows to compact "depth:relative" labels for concise assertions.
 * @inputs rows - the visible rows to label.
 * @outputs string[] - one "depth:relative" string per row, in document order.
 * @dataflow Each VisibleRow → template literal of depth and node.relative → label string.
 * @controlflow Map over rows with no branching.
 */
function names(rows: readonly VisibleRow[]): string[] {
  return rows.map((row) => `${row.depth}:${row.node.relative}`);
}

describe('names and paths', () => {
  it('sorts names case-insensitively and numerically', () => {
    expect(['b', 'A', 'a10', 'a2'].sort(compareNames)).toEqual(['A', 'a2', 'a10', 'b']);
  });

  it('breaks a case-only tie so the order is stable', () => {
    expect(compareNames('a', 'A')).toBe(1);
    expect(compareNames('A', 'a')).toBe(-1);
    expect(compareNames('a', 'a')).toBe(0);
  });

  it('splits relative paths', () => {
    expect(parentRelative('a/b/c.md')).toBe('a/b');
    expect(parentRelative('c.md')).toBe('');
    expect(baseName('a/b/c.md')).toBe('c.md');
    expect(baseName('c.md')).toBe('c.md');
    expect(childRelative('', 'x')).toBe('x');
    expect(childRelative('a', 'x')).toBe('a/x');
  });

  it('builds absolute paths in the root\'s own separator', () => {
    expect(absolutePath('C:\\v', 'a/b.md')).toBe('C:\\v\\a\\b.md');
    expect(absolutePath('/v/', 'a/b.md')).toBe('/v/a/b.md');
    expect(absolutePath('/v', '')).toBe('/v');
  });

  it('tells a path inside a folder from one that only shares its prefix', () => {
    expect(isSameOrInside('a/c', 'a')).toBe(true);
    expect(isSameOrInside('a', 'a')).toBe(true);
    expect(isSameOrInside('ab/c', 'a')).toBe(false);
    expect(isSameOrInside('x', '')).toBe(true);
  });

  it('keeps only the outermost of nested selections', () => {
    expect(topLevelOnly(['a', 'a/b.md', 'c.md', 'ab'])).toEqual(['a', 'c.md', 'ab']);
  });

  it('remaps a moved path and everything under it, ignoring case and separator', () => {
    expect(remapPath('C:\\v\\a\\n.md', 'C:\\V\\a', 'C:\\v\\b')).toBe('C:\\v\\b\\n.md');
    expect(remapPath('C:\\v\\a', 'C:\\v\\a', 'D:\\w')).toBe('D:\\w');
    expect(remapPath('C:/v/a/n.md', 'C:\\v\\a', 'D:\\w')).toBe('D:\\w/n.md');
    expect(remapPath('C:\\v\\ab.md', 'C:\\v\\a', 'C:\\v\\b')).toBeNull();
  });

  it('suggests a name nothing in the folder has', () => {
    expect(uniqueChildName(['Untitled.md', 'untitled 2.md'], 'Untitled', '.md')).toBe('Untitled 3.md');
    expect(uniqueChildName([], 'New folder', '')).toBe('New folder');
  });

  it('adds .md only when the name has no note extension', () => {
    expect(withNoteExtension('a')).toBe('a.md');
    expect(withNoteExtension('a.MD')).toBe('a.MD');
    expect(withNoteExtension('a.markdown')).toBe('a.markdown');
    expect(withNoteExtension('a.txt')).toBe('a.txt.md');
  });
});

describe('validateEntryName', () => {
  it('needs a name', () => {
    expect(validateEntryName('')).toBe('A name is needed.');
    expect(validateEntryName('   ')).toBe('A name is needed.');
  });

  it('refuses dot names', () => {
    expect(validateEntryName('..')).toBe('That name is reserved.');
    expect(validateEntryName('.')).toBe('That name is reserved.');
  });

  it('refuses separators and characters Windows forbids', () => {
    for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateEntryName(name)).toBe('A name cannot contain \\ / : * ? " < > |');
    }
  });

  it('refuses a trailing dot', () => {
    expect(validateEntryName('note.')).toBe('A name cannot end with a dot.');
  });

  it('refuses Windows device names with or without an extension', () => {
    expect(validateEntryName('CON')).toBe('That name is reserved by Windows.');
    expect(validateEntryName('com1.md')).toBe('That name is reserved by Windows.');
    expect(validateEntryName('Console')).toBeNull();
  });

  it('accepts an ordinary name with spaces around it', () => {
    expect(validateEntryName(' Plan ')).toBeNull();
  });
});

describe('buildFileTree', () => {
  it('puts folders first, then files, each sorted', () => {
    expect(TREE.map((node) => `${node.kind}:${node.relative}`)).toEqual(['folder:a', 'folder:B', 'file:z.md']);
  });

  it('nests notes and empty folders under their folders', () => {
    const a = TREE[0];
    // Guard against an unexpected fixture shape so a broken assumption fails loudly instead of masking itself.
    if (a === undefined || a.kind !== 'folder') {
      // The first top-level node must exist and be a folder; otherwise the fixture is wrong.
      throw new Error('fixture');
    } else {
      // The node is the expected folder: assert its children order.
      expect(a.children.map((node) => `${node.kind}:${node.relative}`)).toEqual(['folder:a/empty', 'file:a/n.md']);
    }
  });

  it('carries a note\'s path and title', () => {
    const z = TREE[2];
    expect(z).toEqual({ kind: 'file', name: 'z.md', relative: 'z.md', path: '/v/z.md', title: 'Z' });
  });

  it('creates folders a note lives in even when the folder list omits them', () => {
    const tree = buildFileTree([{ path: '/v/p/q/n.md', relative: 'p/q/n.md', title: '' }], []);
    expect(names(flattenVisible(tree, new Set(['p', 'p/q'])))).toEqual(['0:p', '1:p/q', '2:p/q/n.md']);
  });
});

describe('flattenVisible and childNames', () => {
  it('shows only top-level rows when nothing is expanded', () => {
    expect(names(flattenVisible(TREE, new Set<string>()))).toEqual(['0:a', '0:B', '0:z.md']);
  });

  it('shows an expanded folder\'s children one level deeper', () => {
    expect(names(flattenVisible(TREE, new Set(['a'])))).toEqual(['0:a', '1:a/empty', '1:a/n.md', '0:B', '0:z.md']);
  });

  it('names a folder\'s children', () => {
    expect(childNames(TREE, '')).toEqual(['a', 'B', 'z.md']);
    expect(childNames(TREE, 'a')).toEqual(['empty', 'n.md']);
    expect(childNames(TREE, 'missing')).toEqual([]);
  });
});
