/**
 * @file html-render.spec.ts
 * @purpose Vitest test suite for HTML fragment and standalone document rendering, entity escaping, and export stylesheet definitions in @k-doc/core (FR-13.1).
 * @inputs Source Markdown strings, parsed KdocDocument instances, HtmlRenderOptions configurations, and EXPORT_STYLESHEET.
 * @outputs Vitest test assertions verifying emitted HTML fragments, standalone HTML documents, escaped entity sequences, and stylesheet rules.
 * @functions
 *   - html: Parses Markdown source text and renders its mdast root into an HTML fragment string.
 * @dataflow Markdown source string -> parseMarkdown -> KdocDocument AST root -> renderFragment / renderHtml -> HTML output string -> Vitest expect assertions.
 * @controlflow Execute test suites across Markdown construct rendering, raw HTML preservation, escapeHtml entity conversion, standalone document wrapping, and EXPORT_STYLESHEET CSS rules.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderFragment, renderHtml, escapeHtml, EXPORT_STYLESHEET } from '../src/index.js';

/**
 * Parses Markdown text and compiles its AST root into an HTML fragment.
 *
 * @purpose Renders Markdown source into an HTML fragment string.
 * @inputs markdown - Raw Markdown source string to parse and render.
 * @outputs string - Rendered HTML fragment.
 * @dataflow Markdown string -> parseMarkdown -> KdocDocument -> document.root -> renderFragment -> HTML fragment string.
 * @controlflow Parse markdown into KdocDocument -> extract mdast root -> pass to renderFragment -> return HTML string.
 */
function html(markdown: string): string {
  return renderFragment(parseMarkdown(markdown).root);
}

describe('rendering Markdown constructs', () => {
  it('renders headings (# Title -> <h1>Title</h1>)', () => {
    expect(html('# Title')).toBe('<h1>Title</h1>');
  });

  it('renders bold and italic text (**bold** -> <strong>bold</strong>, _em_ -> <em>em</em>)', () => {
    expect(html('**bold**')).toContain('<strong>bold</strong>');
    expect(html('_em_')).toContain('<em>em</em>');
  });

  it('renders inline code (`code` -> <code>code</code>)', () => {
    expect(html('`code`')).toContain('<code>code</code>');
  });

  it('renders fenced code blocks with language producing <pre> and <code', () => {
    const output = html('```typescript\nconst answer = 42;\n```');
    expect(output).toContain('<pre>');
    expect(output).toContain('<code');
  });

  it('renders unordered lists with <ul> and <li>, and ordered lists with <ol>', () => {
    const unordered = html('- a');
    expect(unordered).toContain('<ul>');
    expect(unordered).toContain('<li>');

    const ordered = html('1. a');
    expect(ordered).toContain('<ol>');
  });

  it('renders blockquotes (> quoted -> <blockquote>)', () => {
    expect(html('> quoted')).toContain('<blockquote>');
  });

  it('renders links with href attribute ([text](https://example.com) -> href="https://example.com")', () => {
    expect(html('[text](https://example.com)')).toContain('href="https://example.com"');
  });

  it('renders images with <img and alt attribute (![alt](img.png) -> <img with alt="alt")', () => {
    const output = html('![alt](img.png)');
    expect(output).toContain('<img');
    expect(output).toContain('alt="alt"');
  });

  it('renders GFM tables producing <table>, <thead>, and <th>', () => {
    const markdown = '| Col 1 | Col 2 |\n| --- | --- |\n| Val 1 | Val 2 |';
    const output = html(markdown);
    expect(output).toContain('<table>');
    expect(output).toContain('<thead>');
    expect(output).toContain('<th>');
  });

  it('renders strikethrough (~~gone~~ -> <del>)', () => {
    expect(html('~~gone~~')).toContain('<del>');
  });

  it('renders task lists producing checkbox inputs with one checked', () => {
    const markdown = '- [ ] a\n- [x] b';
    const output = html(markdown);
    expect(output).toContain('type="checkbox"');
    expect(output).toContain('checked');
  });
});

describe('raw HTML', () => {
  it('preserves raw HTML elements verbatim without escaping them into entity text', () => {
    const rawDiv = '<div class="raw">kept</div>';
    const output = html(rawDiv);

    // K-Doc preserves raw HTML verbatim (FR-4.4), so an export that stripped or escaped it
    // would produce a different document than the one the user wrote.
    expect(output).toContain('<div class="raw">kept</div>');

    // Assert explicitly that the output does not contain &lt;div, which is what stripping-by-escaping would look like.
    expect(output).not.toContain('&lt;div');
  });

  it('never carries a script or event handler into rendered HTML', () => {
    const output = html('<script>alert("k-doc")</script><img src="x" onerror="alert(1)">');

    // Rendered HTML reaches live DOM and exported files, so a document's script must not survive it.
    expect(output).not.toContain('<script');
    expect(output).not.toContain('onerror');
    expect(output).toContain('<img src="x">');
  });
});

describe('escapeHtml', () => {
  it('escapes special characters &, <, >, ", and \' to their HTML entities', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('avoids double-escaping when & precedes other special characters like <', () => {
    // Ampersand-first ordering is what prevents the double escape, and that this test
    // is the reason the order in the implementation is not arbitrary.
    expect(escapeHtml('&<')).toBe('&amp;&lt;');
    expect(escapeHtml('&<')).not.toBe('&amp;&amp;lt;');
  });

  it('returns text with no special characters unchanged', () => {
    const plainText = 'The quick brown fox jumps over the lazy dog 12345';
    expect(escapeHtml(plainText)).toBe(plainText);
  });
});

describe('standalone documents', () => {
  it('returns a fragment with no doctype when options are omitted', () => {
    const doc = parseMarkdown('# Heading\n\nContent paragraph');
    const output = renderHtml(doc);
    expect(output).not.toContain('<!doctype html>');
  });

  it('wraps content in a full HTML document when standalone option is true', () => {
    const doc = parseMarkdown('# Heading\n\nContent paragraph');
    const output = renderHtml(doc, { standalone: true });
    expect(output).toContain('<!doctype html>');
    expect(output).toContain('<meta charset="utf-8">');
    expect(output).toContain('<style>');
    expect(output).toContain('<h1>Heading</h1>');
    expect(output).toContain('<p>Content paragraph</p>');
  });

  it('escapes special characters in the document title', () => {
    const doc = parseMarkdown('# Test');
    const output = renderHtml(doc, { standalone: true, title: 'A <b> & "quote"' });
    expect(output).toContain('&lt;b&gt;');
    expect(output).toContain('&amp;');
    expect(output).not.toContain('<title>A <b>');
  });

  it('defaults to "Untitled" when title is absent or blank', () => {
    const doc = parseMarkdown('# Test');

    const absentTitle = renderHtml(doc, { standalone: true });
    expect(absentTitle).toContain('<title>Untitled</title>');

    const blankTitle = renderHtml(doc, { standalone: true, title: '   ' });
    expect(blankTitle).toContain('<title>Untitled</title>');
  });

  it('allows custom css to override the default stylesheet', () => {
    const doc = parseMarkdown('# Test');
    const customCss = '/*custom*/';
    const output = renderHtml(doc, { standalone: true, css: customCss });
    expect(output).toContain('/*custom*/');
    // Default stylesheet body rule specifies max-width: 42rem
    expect(output).not.toContain('max-width: 42rem;');
  });
});

describe('the export stylesheet', () => {
  it('contains no CSS custom properties so the exported document stands completely alone', () => {
    // The exported file must stand alone, and tokens defined in the app's stylesheet would resolve to nothing
    // outside it — this test is what stops someone helpfully "tidying" the sheet to use them.
    expect(EXPORT_STYLESHEET).not.toMatch(/--[a-z-]+\s*:/);
  });

  it('contains an @media print block that prints link hrefs after link text', () => {
    // In print media, page margins are provided by physical paper and printed pages have no clickable links,
    // so external link URLs are printed after the text using attr(href).
    expect(EXPORT_STYLESHEET).toContain('@media print');
    expect(EXPORT_STYLESHEET).toContain('attr(href)');
  });
});
