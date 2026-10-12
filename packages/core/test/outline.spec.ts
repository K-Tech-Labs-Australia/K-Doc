/**
 * @file outline.spec.ts
 * @purpose Vitest test suite for document outline construction, text flattening, depth clamping, and active heading resolution in @k-doc/core.
 * @inputs Source Markdown strings, character offsets, OutlineEntry arrays, and parsed KdocDocument objects.
 * @outputs Vitest assertions validating buildOutline, text flattening, depth clamping, and activeOutlineIndex.
 * @functions
 *   - outlineFor: Parses Markdown source text and extracts its sequence of top-level heading outline entries.
 * @dataflow Markdown text string -> parseMarkdown -> KdocDocument -> buildOutline -> OutlineEntry array -> activeOutlineIndex lookup -> active entry index -> Vitest expect assertions.
 * @controlflow Execute test suites across buildOutline document structure, inline text flattening rules, depth clamping bounds, and activeOutlineIndex offset resolution.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import {
  activeOutlineIndex,
  buildOutline,
  parseMarkdown,
  type OutlineEntry,
} from '../src/index.js';

/**
 * Parses Markdown source text and builds its document outline.
 *
 * @purpose Parses Markdown source text and extracts its sequence of top-level heading outline entries.
 * @inputs markdown - Raw Markdown source string.
 * @outputs readonly OutlineEntry[] - Readonly array of OutlineEntry items representing document headings.
 * @dataflow Markdown text string -> parseMarkdown -> KdocDocument -> buildOutline -> OutlineEntry array.
 * @controlflow Call parseMarkdown with source text -> pass resultant KdocDocument to buildOutline -> return outline entries.
 */
function outlineFor(markdown: string): readonly OutlineEntry[] {
  return buildOutline(parseMarkdown(markdown));
}

describe('buildOutline', () => {
  it('returns one entry per top-level heading in document order with corresponding depths and texts', () => {
    const markdown = '# One\n\n## Two\n\n### Three\n\ntext\n';
    const entries = outlineFor(markdown);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.depth)).toEqual([1, 2, 3]);
    expect(entries.map((entry) => entry.text)).toEqual(['One', 'Two', 'Three']);
  });

  it('assigns index matching the position of each entry in the returned array', () => {
    const markdown = '# First\n\n## Second\n\n### Third\n';
    const entries = outlineFor(markdown);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.index).toBe(0);
    expect(entries[1]?.index).toBe(1);
    expect(entries[2]?.index).toBe(2);
  });

  it('records accurate start and end character offsets matching the heading source span', () => {
    // Asserting that markdown.slice(start, end) equals the exact heading source proves
    // navigation will land in the right place, whereas depth-and-text checks alone could pass against wrong offsets.
    const markdown = '# One\n\n## Two\n\n### Three\n\ntext\n';
    const entries = outlineFor(markdown);
    const second = entries[1];
    expect(second).toBeDefined();
    if (second !== undefined) {
      expect(markdown.slice(second.start, second.end)).toBe('## Two');
    }
  });

  it('returns an empty array when the document contains no headings', () => {
    const markdown = 'Just a paragraph with plain text.\n\nAnother paragraph without headings.\n';
    const entries = outlineFor(markdown);
    expect(entries).toEqual([]);
  });

  it('ignores headings nested inside blockquotes or list items', () => {
    // A nested heading is not a document section, and an outline that lists it
    // does not match the structure the rendered document shows.
    const markdown = '# Real\n\n> ## Quoted\n\n- ### In a list\n';
    const entries = outlineFor(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe('Real');
  });
});

describe('text flattening', () => {
  it('strips inline emphasis from heading text', () => {
    const entries = outlineFor('## A **bold** word\n');
    expect(entries[0]?.text).toBe('A bold word');
  });

  it('preserves text content inside inline code spans', () => {
    // Preserves inline code content because dropping it would lose the very word the heading is about.
    const entries = outlineFor('## The `parse` step\n');
    expect(entries[0]?.text).toBe('The parse step');
  });

  it('extracts alt text from embedded images', () => {
    const entries = outlineFor('## See ![a diagram](x.png)\n');
    expect(entries[0]?.text).toBe('See a diagram');
  });

  it('ignores images with empty alt text without leaving extra whitespace', () => {
    const entries = outlineFor('## See ![](x.png) here\n');
    expect(entries[0]?.text).toBe('See here');
  });

  it('collapses whitespace runs and trims leading and trailing whitespace', () => {
    const entries = outlineFor('##   Heading   with   extra   spaces   \n');
    expect(entries[0]?.text).toBe('Heading with extra spaces');
  });

  it('preserves link label text while stripping target URLs', () => {
    const entries = outlineFor('## Read [the docs](https://x)\n');
    expect(entries[0]?.text).toBe('Read the docs');
  });
});

describe('depth clamping', () => {
  it('reports depths within 1 to 6 for both ATX and Setext headings', () => {
    // A setext underline must sit on the line DIRECTLY below its text, so the setext pair is written
    // with a single newline. Joining every line with a blank line turns '===' into its own paragraph
    // and the heading silently disappears from the outline, which is what the first version of this
    // fixture did.
    const markdown = [
      '# Heading 1',
      '## Heading 2',
      '### Heading 3',
      '#### Heading 4',
      '##### Heading 5',
      '###### Heading 6',
      'Setext 1\n===',
      'Setext 2\n---',
    ].join('\n\n');
    const entries = outlineFor(markdown);
    expect(entries).toHaveLength(8);
    for (const entry of entries) {
      expect(entry.depth).toBeGreaterThanOrEqual(1);
      expect(entry.depth).toBeLessThanOrEqual(6);
    }
  });
});

describe('activeOutlineIndex', () => {
  it('returns -1 when given an empty entries array', () => {
    expect(activeOutlineIndex([], 0)).toBe(-1);
    expect(activeOutlineIndex([], 50)).toBe(-1);
  });

  it('returns -1 for an offset positioned before the first heading', () => {
    // Text above the first heading belongs to no section, and marking the first row
    // would highlight a section the user is not in.
    const markdown = 'Preamble text above all headings.\n\n# First\nBody text.\n';
    const entries = outlineFor(markdown);
    expect(activeOutlineIndex(entries, 0)).toBe(-1);
    expect(activeOutlineIndex(entries, 10)).toBe(-1);
  });

  it('returns the matching heading index for an offset exactly at a heading start', () => {
    const markdown = '# First\n\n## Second\n\n### Third\n';
    const entries = outlineFor(markdown);
    const first = entries[0];
    const second = entries[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first !== undefined && second !== undefined) {
      expect(activeOutlineIndex(entries, first.start)).toBe(0);
      expect(activeOutlineIndex(entries, second.start)).toBe(1);
    }
  });

  it('returns the earlier heading index for an offset located in body text between headings', () => {
    const markdown = '# First\nBody text under first heading.\n\n## Second\nBody text under second.\n';
    const entries = outlineFor(markdown);
    const first = entries[0];
    const second = entries[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first !== undefined && second !== undefined) {
      const midOffset = first.start + 10;
      expect(midOffset).toBeLessThan(second.start);
      expect(activeOutlineIndex(entries, midOffset)).toBe(0);
    }
  });

  it('returns the last heading index for an offset positioned past the last heading', () => {
    const markdown = '# First\n\n## Second\nTrailing text after the last heading.\n';
    const entries = outlineFor(markdown);
    const lastIndex = entries.length - 1;
    expect(activeOutlineIndex(entries, markdown.length - 1)).toBe(lastIndex);
  });
});
