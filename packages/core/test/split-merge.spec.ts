/**
 * @file split-merge.spec.ts
 * @purpose Tests sectionIndexAtOffset, splitSection, and mergeDocumentText from the outline splitter/merger module.
 * @inputs DOC sample markdown document; inline markdown strings passed to the functions under test.
 * @outputs Assertion results asserting exact remaining/section/title shapes and merged text output.
 * @functions
 *   - split: helper that parses text, builds an outline, and calls splitSection at a given index.
 *   - sectionIndexAtOffset tests: verify heading lookup by offset.
 *   - splitSection tests: verify extraction of middle/last/whole-document sections.
 *   - mergeDocumentText tests: verify body merging with front-matter stripping and CRLF normalization.
 * @dataflow Markdown string → parseMarkdown → buildOutline → sectionIndexAtOffset/splitSection/mergeDocumentText → expected value.
 * @controlflow describe blocks group each function; each it() asserts one behavior and fails fast on mismatch.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { buildOutline } from '../src/outline/outline.js';
import { parseMarkdown } from '../src/parse/parser.js';
import { mergeDocumentText, sectionIndexAtOffset, splitSection, withoutFrontMatter } from '../src/outline/split-merge.js';

const DOC = '# Title\n\nIntro.\n\n## One\n\nFirst.\n\n### Deep\n\nDeeper.\n\n## Two\n\nSecond.\n';

// Parse the text into an outline and extract the section at `index` using splitSection.
// @purpose Convenience wrapper that chains parseMarkdown + buildOutline before calling splitSection.
// @inputs text - Markdown source to parse; index - Outline entry index to extract.
// @outputs The { remaining, section, title } tuple returned by splitSection, or undefined when the index is out of range.
// @dataflow text → parseMarkdown → buildOutline → splitSection(text, outline, index) → result object.
// @controlflow Sequential: no branching; always returns whatever splitSection produces for the given index.
function split(text: string, index: number): ReturnType<typeof splitSection> {
  return splitSection(text, buildOutline(parseMarkdown(text)), index);
}

describe('sectionIndexAtOffset', () => {
  // A valid offset should resolve to the nearest preceding heading index.
  it('finds the last heading at or before the offset', () => {
    const entries = buildOutline(parseMarkdown(DOC));
    expect(sectionIndexAtOffset(entries, 0)).toBe(0);
    expect(sectionIndexAtOffset(entries, DOC.indexOf('First'))).toBe(1);
    expect(sectionIndexAtOffset(entries, DOC.indexOf('## One'))).toBe(1);
    expect(sectionIndexAtOffset(entries, DOC.indexOf('## One') - 1)).toBe(0);
    expect(sectionIndexAtOffset(entries, DOC.indexOf('Deeper'))).toBe(2);
    expect(sectionIndexAtOffset(entries, DOC.length)).toBe(3);
  });

  // Offsets before the first heading or in a heading-less document resolve to -1.
  it('is -1 before the first heading or without headings', () => {
    const text = 'Lead.\n\n# Title\n';
    expect(sectionIndexAtOffset(buildOutline(parseMarkdown(text)), 2)).toBe(-1);
    expect(sectionIndexAtOffset([], 0)).toBe(-1);
  });
});

describe('splitSection', () => {
  // Extracting a middle section leaves the preceding and following sections in `remaining`.
  it('takes a section with its subsections out of the middle', () => {
    expect(split(DOC, 1)).toEqual({
      remaining: '# Title\n\nIntro.\n\n## Two\n\nSecond.\n',
      section: '## One\n\nFirst.\n\n### Deep\n\nDeeper.\n',
      title: 'One',
    });
  });

  // Removing a trailing section trims the blank lines it left behind.
  it('trims the blank lines left by a last section', () => {
    expect(split(DOC, 3)).toEqual({
      remaining: '# Title\n\nIntro.\n\n## One\n\nFirst.\n\n### Deep\n\nDeeper.\n',
      section: '## Two\n\nSecond.\n',
      title: 'Two',
    });
  });

  // When the split section is the entire document, a single newline remains.
  it('keeps one newline when the section was the whole document', () => {
    expect(split('# Only *one*\n\nText.\n\n\n', 0)).toEqual({ remaining: '\n', section: '# Only *one*\n\nText.\n', title: 'Only one' });
  });

  // Text preceding the first heading is preserved in `remaining`.
  it('keeps text before the first heading', () => {
    expect(split('Lead.\n\n# Title\n\nBody.\n', 0)?.remaining).toBe('Lead.\n');
  });

  // An out-of-range index yields no section.
  it('is null for an index with no section', () => {
    expect(split(DOC, -1)).toBeNull();
    expect(split(DOC, 4)).toBeNull();
  });
});

describe('mergeDocumentText', () => {
  // The merged body is appended after exactly one blank line.
  it('appends the body after one blank line', () => {
    expect(mergeDocumentText('# A\n\nText.\n\n\n', parseMarkdown('\n\n# B\n\nMore.\n\n'))).toBe('# A\n\nText.\n\n# B\n\nMore.\n');
  });

  // Front matter on the merged source is dropped while the target's front matter is kept.
  it('drops the merged document front matter', () => {
    const source = parseMarkdown('---\ntitle: B\n---\n\n# B\n');
    expect(withoutFrontMatter(source)).toBe('\n\n# B\n');
    expect(mergeDocumentText('---\ntitle: A\n---\n\nA.\n', source)).toBe('---\ntitle: A\n---\n\nA.\n\n# B\n');
  });

  // A horizontal rule surrounded by body text is not treated as front matter.
  it('keeps a document that only looks like it has front matter', () => {
    const source = parseMarkdown('Text\n\n---\n\nMore\n');
    expect(withoutFrontMatter(source)).toBe('Text\n\n---\n\nMore\n');
  });

  // CRLF line breaks in the merged body are normalized to LF.
  it('turns CRLF line breaks into LF', () => {
    expect(mergeDocumentText('A.\n', parseMarkdown('B.\r\nC.\r\n'))).toBe('A.\n\nB.\nC.\n');
  });

  // When the source has no mergeable body, the target is left unchanged.
  it('leaves the target alone when there is nothing to merge', () => {
    expect(mergeDocumentText('A.\n', parseMarkdown('---\ntitle: x\n---\n\n  \n'))).toBe('A.\n');
  });

  // When the target is empty, only the merged body is returned.
  it('gives the body when the target is empty', () => {
    expect(mergeDocumentText('\n', parseMarkdown('B.\n'))).toBe('B.\n');
  });
});
