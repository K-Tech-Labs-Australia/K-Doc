/**
 * @file slides.spec.ts
 * @purpose Tests that markdown is parsed, split into slides at top-level thematic breaks, and rendered to HTML fragments as expected.
 * @inputs Markdown strings passed through parseMarkdown, splitSlides, and renderFragment.
 * @outputs Array of trimmed HTML slide strings; pass/fail assertions on slide count and content.
 * @functions
 *   - slidesOf: Parses markdown, splits into slides, and renders each slide to a trimmed HTML string.
 *   - describe('splitSlides'): Groups the splitSlides behavior tests.
 *   - it(...): Individual behavioral assertions for slide splitting rules.
 * @dataflow Markdown → parseMarkdown → splitSlides → renderFragment → trimmed HTML strings → expect assertions.
 * @controlflow For each test, build slides via slidesOf then assert equality, length, or containment of the resulting array.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../src/parse/parser.js';
import { renderFragment } from '../src/render/html.js';
import { splitSlides } from '../src/render/slides.js';

// slidesOf: parses markdown, splits it into slides, and renders each slide to a trimmed HTML string.
// @purpose Produce the rendered HTML for every slide in a markdown document for assertion.
// @inputs markdown - Raw markdown source string to parse, split, and render.
// @outputs string[] - One trimmed HTML fragment per non-empty slide.
// @dataflow markdown → parseMarkdown → splitSlides → renderFragment per slide → trim → returned array.
// @controlflow Single pipeline: parse once, split into slides, map each slide to rendered+trimmed HTML.
function slidesOf(markdown: string): string[] {
  return splitSlides(parseMarkdown(markdown)).map((slide) => renderFragment(slide).trim());
}

describe('splitSlides', () => {
  // Asserts that top-level thematic breaks (--- and ***) divide the document into separate slides.
  it('splits at top-level thematic breaks', () => {
    expect(slidesOf('# One\n\nIntro\n\n---\n\n# Two\n\n***\n\nThree\n')).toEqual(['<h1>One</h1>\n<p>Intro</p>', '<h1>Two</h1>', '<p>Three</p>']);
  });

  // Asserts that front matter blocks and empty slides are dropped from the output.
  it('drops empty slides and front matter', () => {
    expect(slidesOf('---\ntitle: Deck\n---\n\n---\n\nOnly\n\n---\n\n---\n')).toEqual(['<p>Only</p>']);
    expect(slidesOf('')).toEqual([]);
  });

  // Asserts that a thematic break nested inside a quote or list stays on its own slide rather than splitting.
  it('keeps a rule inside a quote or list on its slide', () => {
    const slides = slidesOf('> a\n>\n> ---\n>\n> b\n\n- x\n\n  ---\n\n  y\n');
    expect(slides).toHaveLength(1);
    expect(slides[0]).toContain('<hr>');
  });

  // Asserts that a document with no top-level breaks renders as a single slide.
  it('shows a document without breaks as one slide', () => {
    expect(slidesOf('Just text\n\nMore\n')).toEqual(['<p>Just text</p>\n<p>More</p>']);
  });
});
