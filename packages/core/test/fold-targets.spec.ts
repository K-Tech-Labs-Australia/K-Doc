/**
 * @file fold-targets.spec.ts
 * @purpose Verifies fold-key generation and fold-target range computation for markdown documents (FR-8.29).
 * @inputs Markdown source strings; a synthetic entry list of heading/list-item kinds and texts.
 * @outputs vitest assertions covering key slugification, occurrence suffixing, target ranges, nesting coverage and innermost lookup.
 * @functions none
 * @dataflow markdown text -> parseMarkdown -> KdocDocument -> foldTargets -> {key,kind,start,end}[] -> assertions; entry list -> foldKeys -> string[].
 * @controlflow describe per concern; each it() asserts one behavior against a fixture or the SAMPLE document.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { foldKeys, foldTargets, innermostFoldTarget, parseMarkdown } from '../src/index.js';

// SAMPLE is a 44-character markdown document reused across the range assertions.
// Character offsets of each significant token: '# A' at 0, 'text' at 5, '## B' at 11,
// '- one' at 17, '- two' at 25, '- three' at 31, '# C' at 40.
const SAMPLE = '# A\n\ntext\n\n## B\n\n- one\n  - two\n- three\n\n# C\n';

describe('foldKeys', () => {
  // Headings slugify to 'heading:<slug>' with a '-<n>' suffix on repeats; list items trim and collapse internal whitespace,
  // use an 'item:<text>' form, and append '#<n>' on repeats.
  it('slugifies headings, normalizes list-item text, and suffixes repeated keys', () => {
    expect(
      foldKeys([
        { kind: 'heading', text: 'Intro' },
        { kind: 'listItem', text: 'a' },
        { kind: 'heading', text: 'Intro' },
        { kind: 'listItem', text: 'a' },
        { kind: 'listItem', text: ' b  c ' },
      ])
    ).toEqual(['heading:intro', 'item:a', 'heading:intro-1', 'item:a#1', 'item:b c']);
  });
});

describe('foldTargets', () => {
  // Emits one target per section heading and list item, sorted ascending by start offset.
  it('emits a target per section heading and list item, sorted by start', () => {
    const targets = foldTargets(parseMarkdown(SAMPLE));
    expect(targets.map(t => t.key)).toEqual(['heading:a', 'heading:b', 'item:one', 'item:two', 'item:three', 'heading:c']);
    expect(targets.map(t => t.start)).toEqual([0, 11, 17, 25, 31, 40]);
    expect(targets.map(t => t.kind)).toEqual(['heading', 'heading', 'listItem', 'listItem', 'listItem', 'heading']);
  });

  // A heading section extends until the next heading at the same or shallower level; deeper headings do not close it.
  it('ends a heading section at the next heading of same or shallower level', () => {
    const targets = foldTargets(parseMarkdown(SAMPLE));
    // '# A' (level 1) is not closed by the deeper '## B', so it runs until the level-1 '# C'.
    expect(targets[0]?.end).toBe(40);
    // '## B' (level 2) closes at the shallower '# C'.
    expect(targets[1]?.end).toBe(40);
    // The final heading has no following section, so it runs to end of document.
    expect(targets[5]?.end).toBe(44);
  });

  // A list item's range covers the indented nested list beneath it before a sibling begins.
  it('extends a list-item range over its nested list', () => {
    const targets = foldTargets(parseMarkdown(SAMPLE));
    expect(targets.find(t => t.key === 'item:one')?.end).toBe(30);
  });

  // Headings nested inside a blockquote are prose, not section markers.
  it('rejects headings nested inside a blockquote', () => {
    expect(foldTargets(parseMarkdown('> # Quoted\n'))).toEqual([]);
  });

  // A list item inside a blockquote is still treated as a fold target.
  it('treats a quoted list item as a section target', () => {
    const targets = foldTargets(parseMarkdown('> - x\n'));
    expect(targets.map(t => t.key)).toEqual(['item:x']);
  });

  // Identical list-item texts receive an ascending '#<n>' occurrence suffix.
  it('names an empty list item by empty text', () => {
    expect(foldTargets(parseMarkdown('-\n')).map(t => t.key)).toEqual(['item:']);
  });
  it('suffixes repeated list-item text with an occurrence index', () => {
    const targets = foldTargets(parseMarkdown('- same\n- same\n'));
    expect(targets.map(t => t.key)).toEqual(['item:same', 'item:same#1']);
  });
});

describe('innermostFoldTarget', () => {
  // Shared target list so each lookup is evaluated against the same SAMPLE document.
  const targets = foldTargets(parseMarkdown(SAMPLE));

  // Chooses the deepest target whose [start, end) range contains the offset (largest start wins on overlap).
  it('returns the deepest target whose range contains the offset', () => {
    expect(innermostFoldTarget(targets, 26)?.key).toBe('item:two');
  });

  // Prefers the nested heading over its enclosing section when both contain the offset.
  it('prefers the nested heading over its enclosing section', () => {
    expect(innermostFoldTarget(targets, 12)?.key).toBe('heading:b');
  });

  // Returns the single enclosing target when only one range contains the offset.
  it('returns the enclosing target for an offset inside a single range', () => {
    expect(innermostFoldTarget(targets, 5)?.key).toBe('heading:a');
  });

  it('picks the innermost target whatever order the targets come in', () => {
    const outer = { key: 'outer', kind: 'heading' as const, start: 0, end: 40 };
    const inner = { key: 'inner', kind: 'listItem' as const, start: 17, end: 30 };
    expect(innermostFoldTarget([inner, outer], 20)?.key).toBe('inner');
  });
  // Offset 44 sits at or past every end boundary, so no range satisfies start <= offset < end.
  it('returns null when no target range contains the offset', () => {
    expect(innermostFoldTarget(targets, 44)).toBeNull();
  });
});
