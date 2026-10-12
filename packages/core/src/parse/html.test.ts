/**
 * @file html.test.ts
 * @purpose Vitest test suite for K-Doc's HTML-to-mdast and HTML-to-Markdown parser (packages/core/src/parse/html.ts).
 *   Verifies conversion of HTML blocks and inlines to canonical Markdown, empty/whitespace guards, and documented Tier-4 limitations.
 * @inputs Raw HTML string fragments representing paragraphs, headings, lists, tables, links, code blocks, blockquotes, and strikethrough.
 * @outputs Vitest assertions verifying serialized Markdown strings and mdast Root AST node trees.
 * @functions None.
 * @dataflow Raw HTML input string -> htmlToMarkdown / htmlToMdast -> mdast AST / serialized Markdown -> Vitest assertions.
 * @controlflow Execute test cases covering inlines, blocks, tables, code blocks, empty input guards, AST structure, and mark tag limitation.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import type { Paragraph } from 'mdast';
import { htmlToMdast, htmlToMarkdown } from './html.js';

describe('htmlToMarkdown and htmlToMdast', () => {
  // Pins bold and italic conversion to canonical Markdown emphasis and strong syntax.
  it('converts strong and em tags into bold and italic markdown', () => {
    const input = '<p>Hello <strong>bold</strong> and <em>italic</em>.</p>';
    const output = htmlToMarkdown(input);
    expect(output.trim()).toBe('Hello **bold** and _italic_.');
  });

  // Pins heading level 2 and following paragraph conversion into ATX heading and body paragraph.
  it('converts h2 and paragraph into an ATX heading followed by paragraph', () => {
    const input = '<h2>A heading</h2><p>Body.</p>';
    const output = htmlToMarkdown(input);
    expect(output).toBe('## A heading\n\nBody.\n');
  });

  // Pins unordered list conversion into bullet list markdown with dash markers.
  it('converts unordered list elements into a bullet list', () => {
    const input = '<ul><li>one</li><li>two</li></ul>';
    const output = htmlToMarkdown(input);
    expect(output).toBe('- one\n- two\n');
  });

  // Pins table element conversion into a GFM table with header, delimiter row, and body.
  it('converts a table with header and one body row into a GFM table with delimiter row', () => {
    const input = '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>';
    const output = htmlToMarkdown(input);
    expect(output).toContain('| H1 | H2 |');
    expect(output).toContain('| -- | -- |');
    expect(output).toContain('| A  | B  |');
  });

  // Pins anchor tag conversion into an inline markdown link preserving target URL.
  it('converts an anchor tag into an inline link with URL', () => {
    const input = '<a href="https://example.com">link</a>';
    const output = htmlToMarkdown(input);
    expect(output.trim()).toBe('[link](https://example.com)');
  });

  // Pins preformatted code block conversion into a fenced block with language info string.
  it('converts pre and code tags with language class into a fenced block with info string', () => {
    const input = '<pre><code class="language-ts">const x = 1;</code></pre>';
    const output = htmlToMarkdown(input);
    expect(output).toBe('```ts\nconst x = 1;\n```\n');
  });

  // Pins blockquote element conversion into a markdown blockquote with > prefix.
  it('converts blockquote into a markdown quote', () => {
    const input = '<blockquote><p>quoted</p></blockquote>';
    const output = htmlToMarkdown(input);
    expect(output.trim()).toBe('> quoted');
  });

  // Pins del element conversion into GFM strikethrough syntax.
  it('converts del tag into strikethrough markdown', () => {
    const input = '<del>struck</del>';
    const output = htmlToMarkdown(input);
    expect(output.trim()).toBe('~~struck~~');
  });

  // Pins empty and whitespace-only input guard yielding empty root without throwing.
  it('yields a root with no children from htmlToMdast on empty and whitespace-only input', () => {
    const emptyResult = htmlToMdast('');
    expect(emptyResult.type).toBe('root');
    expect(emptyResult.children).toEqual([]);

    const whitespaceResult = htmlToMdast('   \n\t  ');
    expect(whitespaceResult.type).toBe('root');
    expect(whitespaceResult.children).toEqual([]);
  });

  // Pins AST root structure for paragraph input producing a single paragraph child node.
  it('returns an mdast root whose single child has type paragraph for a paragraph input', () => {
    const root = htmlToMdast('<p>Sample paragraph</p>');
    expect(root.type).toBe('root');
    expect(root.children.length).toBe(1);
    const firstChild = root.children[0] as Paragraph | undefined;
    expect(firstChild?.type).toBe('paragraph');
  });

  // Pins the known limitation that mark tags lose highlight formatting because rehype-remark maps them to emphasis rather than K-Doc highlight.
  it('drops highlight formatting on mark tags as an expected limitation', () => {
    // rehype-remark has no mapping for K-Doc's Tier-4 constructs, so a pasted <mark> loses its highlight and emits emphasis.
    const input = '<mark>marked</mark>';
    const output = htmlToMarkdown(input);
    expect(output.trim()).toBe('_marked_');
  });
});
