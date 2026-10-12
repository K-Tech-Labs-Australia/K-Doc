/**
 * @file move-section.spec.ts
 * @purpose Vitest suite for FR-9.1 (drag-to-reorder an outline section): it pins outlineSectionRange's subtree bounds and moveSection's splice behaviour against resulting document text rather than raw offsets.
 * @inputs Markdown source strings — the DOC fixture and a no-trailing-newline variant — parsed into outlines, plus the index pairs naming each move under test.
 * @outputs Nothing executable; the suite asserts heading order, subtree travel, and newline normalisation through Vitest expect() calls.
 * @functions
 *   - outlineOf: Parses a Markdown string and builds its flat outline for assertions.
 *   - describe / it / expect: The Vitest harness that runs each scenario and records pass/fail.
 * @dataflow Markdown source → parseMarkdown AST → buildOutline flattens top-level headings → OutlineEntry array → outlineSectionRange / moveSection → reordered text → expect() assertions on heading order and body travel.
 * @controlflow Define the fixture; for each scenario build the outline, invoke the function under test, then assert the resulting text; throw on any unexpected undefined indexed read.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, buildOutline, outlineSectionRange, moveSection } from '../src/index.js';

/**
 * Builds a flat outline from a Markdown source string for use in move-section assertions.
 *
 * @purpose Parses the given Markdown and derives its top-level heading entries so each scenario can address sections by index without re-parsing.
 * @inputs text - The Markdown source to parse into an outline.
 * @outputs readonly OutlineEntry[] - The flat sequence of top-level heading entries for `text`.
 * @dataflow Markdown string → parseMarkdown AST → buildOutline flattens top-level headings → OutlineEntry array.
 * @controlflow Parse once, build the outline once, and return the entry array to the caller.
 */
function outlineOf(text: string): ReturnType<typeof buildOutline> {
  // Delegate parsing and flattening to the library so the suite exercises real behaviour end to end.
  return buildOutline(parseMarkdown(text));
}

// Three top-level sections; the second owns a child, so moving it must take the child along.
const DOC = [
  '# Alpha',
  '',
  'Alpha body.',
  '',
  '# Beta',
  '',
  'Beta body.',
  '',
  '## Beta child',
  '',
  'Child body.',
  '',
  '# Gamma',
  '',
  'Gamma body.',
  '',
].join('\n');

describe('move-section', () => {
  it('bounds a section at the next heading of the same level', () => {
    // Pins that outlineSectionRange returns Beta's subtree as [Beta.start, Gamma.start): Beta's level-2 child sits inside this range
    // because everything deeper than a section belongs to that section and therefore does not bound it.
    const entries = outlineOf(DOC);

    // Guard the index-1 read against a malformed fixture that lacks this entry.
    const beta = entries[1];
    if (beta === undefined) {
      // No entry at index 1: the fixture is broken, so fail loudly rather than dereference an undefined value.
      throw new Error('move-section fixture expected an entry at index 1 (Beta) but none exists');
    } else {
      // Entry present at index 1 (Beta): safe to read its offsets for range assertions below.
    }

    // Guard the index-3 read against a malformed fixture that lacks this entry.
    const gamma = entries[3];
    if (gamma === undefined) {
      // No entry at index 3: the fixture is broken, so fail loudly rather than dereference an undefined value.
      throw new Error('move-section fixture expected an entry at index 3 (Gamma) but none exists');
    } else {
      // Entry present at index 3 (Gamma): safe to read its start as the bounding offset for Beta's subtree.
    }

    const range = outlineSectionRange(entries, 1, DOC.length);

    // A non-null range is required to assert bounds; refuse the scenario if the fixture produced no entry to range.
    if (range === null) {
      // No range returned: fail loudly rather than compare against an absent subtree.
      throw new Error('expected a section range for Beta but outlineSectionRange returned null');
    } else {
      // Range present: compare its bounds against the sibling offsets below.
    }

    // The subtree starts at Beta's heading and ends where Gamma — the next same-level sibling — begins, consuming the child in between.
    expect(range.start).toBe(beta.start);
    expect(range.end).toBe(gamma.start);
  });

  it('bounds the last section at the end of the document', () => {
    // Pins that the final section's subtree runs to the very end of the source, since no later sibling bounds it.
    const range = outlineSectionRange(outlineOf(DOC), 3, DOC.length);

    // A non-null range is required to assert its end; refuse the scenario if the fixture produced no entry to range.
    if (range === null) {
      // No range returned: fail loudly rather than compare against an absent subtree.
      throw new Error('expected a section range for Gamma but outlineSectionRange returned null');
    } else {
      // Range present: its end must coincide with the document length.
    }

    // The last section has no following sibling, so its subtree extends to the final character of the source.
    expect(range.end).toBe(DOC.length);
  });

  it('answers null for an index that is not a section', () => {
    // Pins that both a negative index and a past-the-end index name no real section, so outlineSectionRange returns null either way.
    const entries = outlineOf(DOC);

    // A negative index names a slot before the first section; there is nothing to range there.
    expect(outlineSectionRange(entries, -1, DOC.length)).toBeNull();

    // An index equal to the entry count names the empty slot after the last section; it is not a section either.
    expect(outlineSectionRange(entries, entries.length, DOC.length)).toBeNull();
  });

  it('takes the whole subtree with it', () => {
    // Pins that moving Beta before Alpha reorders headings to [Beta, Beta child, Alpha, Gamma] and carries Child body. along, because a
    // heading without its body is not a section — which is exactly why the gesture moves a subtree rather than a single line.
    const entries = outlineOf(DOC);
    const result = moveSection(DOC, entries, 1, 0);

    // The moved subtree leads with Beta's level-2 child immediately after its heading, before Alpha and Gamma follow in order.
    expect(result.split('\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Beta',
      '## Beta child',
      '# Alpha',
      '# Gamma',
    ]);

    // The child's body travelled with the subtree rather than being left behind at the original position.
    expect(result).toContain('Child body.');
  });

  it('moves a section downwards', () => {
    // Pins that moving Alpha before Gamma yields [Beta, Beta child, Alpha, Gamma]; the destination offset had to be adjusted for the removed
    // section — using the original Gamma offset would have landed Alpha too far along in the shortened text.
    const entries = outlineOf(DOC);
    const result = moveSection(DOC, entries, 0, 3);

    // After removing Alpha and reinserting it before Gamma, Beta leads with its child, then Alpha, then Gamma trails.
    expect(result.split('\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Beta',
      '## Beta child',
      '# Alpha',
      '# Gamma',
    ]);
  });

  it('moves a section to the end', () => {
    // Pins that moving Alpha with toIndex equal to the entry count appends it last, yielding [Beta, Beta child, Gamma, Alpha].
    const entries = outlineOf(DOC);
    const result = moveSection(DOC, entries, 0, entries.length);

    // Appending after every section places Alpha at the tail while Beta and its child keep their leading positions.
    expect(result.split('\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Beta',
      '## Beta child',
      '# Gamma',
      '# Alpha',
    ]);
  });

  it('refuses to move a section inside itself', () => {
    // Pins that moving Beta before its own child (index 2) returns the document unchanged, because a drag onto one of its own children is
    // impossible — a section cannot contain itself.
    const entries = outlineOf(DOC);
    const result = moveSection(DOC, entries, 1, 2);

    // The destination falls strictly inside Beta's subtree [Beta.start, Gamma.start), so the move is refused verbatim.
    expect(result).toBe(DOC);
  });

  it('changes nothing when dropped where it already is', () => {
    // Pins that dropping Beta before its current position (index 1) returns the document unchanged, because rewriting the source to produce an
    // identical string would put a pointless entry in the undo history.
    const entries = outlineOf(DOC);
    const result = moveSection(DOC, entries, 1, 1);

    // The destination offset equals the source offset, so no splice occurs and the original text is returned as-is.
    expect(result).toBe(DOC);
  });

  it('refuses an index that is not a place', () => {
    // Pins that an out-of-range fromIndex (past the end) and a negative toIndex each leave the document untouched.
    const entries = outlineOf(DOC);

    // A fromIndex beyond the last section names no source subtree, so there is nothing valid to relocate.
    expect(moveSection(DOC, entries, 9, 0)).toBe(DOC);

    // A negative toIndex names a position before the first section, which is not a valid drop target.
    expect(moveSection(DOC, entries, 1, -1)).toBe(DOC);
  });

  it('gives a moved last section a trailing newline', () => {
    // Pins that a section taken from the end of a file (no trailing newline) gains exactly one when moved forward, so pasting it in front of
    // another heading does not weld two headings onto one line; here Two moves before One.
    const noTrailing = '# One\n\nBody one.\n\n# Two\n\nBody two.';
    const entries = outlineOf(noTrailing);
    const result = moveSection(noTrailing, entries, 1, 0);

    // A section removed from the file's end has no terminating newline; without normalisation "Body two." would abut "# One" on one line.
    // The moved subtree now leads with Two and trails off before One, so no single line carries two headings welded together.
    expect(result.split('\n').filter((l) => l.startsWith('#'))).toEqual(['# Two', '# One']);

    // Assert the weld did not happen: Body two. and # One remain on separate lines of the reordered document.
    expect(result).not.toContain('Body two.# One');
  });
});
