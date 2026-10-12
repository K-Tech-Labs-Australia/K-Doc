/**
 * @file plugin-syntax.spec.ts
 * @purpose Exercises applyPluginSyntax (FR-14.18): that a plugin's syntax is drawn onto the tree about to be rendered as emphasis nodes carrying hName and className, while the reader's original document serialises back unchanged because renderHtml clones before drawing.
 * @inputs The MARK and BOX PluginSyntax registrations plus markdown source strings parsed into trees by parseMarkdown; options objects passed to renderHtml that may carry pluginSyntax.
 * @outputs void - every assertion compares rendered HTML fragments or a re-serialised Markdown document against expected text, never mutating the shared syntax constants.
 * @functions
 *   - MARK: The '@@[a-z]+' mark-syntax registration used across the applyPluginSyntax suite.
 *   - BOX: The '%%[0-9]+' box-syntax registration combined with MARK to test multiple simultaneous draws.
 *   - drawn: Parse one markdown string, draw every syntax into that same in-place tree, and return its rendered fragment for assertions.
 *   - describe('applyPluginSyntax'): The twelve cases covering no-op, single match, surrounding text, repeated matches, multi-syntax, first-registered-wins, empty-match, emphasis, heading, code span, un-compilable pattern, and non-matching pattern.
 *   - describe('a plugin never rewrites a document'): The two serializer-half cases proving renderHtml draws into a copy so serializeDocument reports the original source with and without a plugin.
 * @dataflow markdown string -> parseMarkdown builds an mdast Root -> applyPluginSyntax mutates that root in place (or renderHtml clones first, then mutates the clone) -> renderFragment/renderHtml serialise the drawn tree to HTML text while serializeDocument re-reads the untouched original Root back to Markdown.
 * @controlflow Module constants are declared once; each it parses a fresh document so tests stay independent and share no mutated state; describe blocks group by whether they assert on in-place drawing or on serializer round-trip safety.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { applyPluginSyntax, type PluginSyntax } from '../src/plugins/plugin-syntax.js';
import { parseMarkdown, serializeDocument, renderFragment, renderHtml } from '../src/index.js';

// MARK claims '@@[a-z]+' runs and draws them as a <mark> carrying the plugin-mark class.
const MARK: PluginSyntax = { id: 'p:mark', pattern: '@@[a-z]+', tag: 'mark', className: 'plugin-mark' };
// BOX claims '%%[0-9]+' runs and draws them as a <code> carrying the plugin-box class, used alongside MARK.
const BOX: PluginSyntax = { id: 'p:box', pattern: '%%[0-9]+', tag: 'code', className: 'plugin-box' };

/**
 * @purpose Draws one markdown source through parse then applyPluginSyntax then renderFragment so tests assert on the drawing itself.
 * @inputs markdown - The raw text parsed into a tree before any plugin syntax is applied.
 * @inputs syntaxes - Every registered syntax drawn into that same in-place root, exactly as they would be for rendering.
 * @outputs string - The rendered HTML fragment produced after the walk has mutated document.root directly on this parse.
 * @dataflow markdown -> parseMarkdown builds a Root -> applyPluginSyntax mutates document.root in place -> renderFragment serialises the drawn tree to an HTML text fragment returned to the caller.
 * @controlflow Parse once, draw into that same root without cloning (renderHtml would clone first), then return the fragment; no branching is needed because every branch of applyPluginSyntax already guards itself.
 */
function drawn(markdown: string, syntaxes: readonly PluginSyntax[]): string {
  // The tree is drawn on directly here - renderHtml clones before it draws, but this helper mutates document.root in place, so what we assert is exactly what the drawing does to a tree rather than to a reader's file.
  const document = parseMarkdown(markdown);
  applyPluginSyntax(document.root, syntaxes);
  return renderFragment(document.root);
}

describe('applyPluginSyntax', () => {
  // Proves that without any syntax, the document is drawn exactly as parsed and no plugin element appears.
  it('draws nothing when no syntax is registered', () => {
    const output = drawn('Hello @@there.', []);
    expect(output).toContain('@@there');
    expect(output).not.toContain('<mark');
  });

  // Proves a match becomes the element and class the plugin asked for while keeping its original text.
  it('draws a match as the element the plugin requested', () => {
    const output = drawn('Hello @@there.', [MARK]);
    expect(output).toContain('plugin-mark');
    expect(output).toContain('@@there');
  });

  // Proves the text surrounding a match survives the draw untouched.
  it('keeps the text around a match', () => {
    const output = drawn('Hello @@there.', [MARK]);
    expect(output).toContain('Hello ');
  });

  // Proves every match within one run is drawn, counted by how many class tokens appear in the fragment.
  it('draws every match in a single run', () => {
    const output = drawn('@@one and @@two', [MARK]);
    expect(output.split('plugin-mark').length - 1).toBe(2);
  });

  // Proves two registered syntaxes both draw within the same document.
  it('draws when two syntaxes are registered', () => {
    const output = drawn('@@a and %%1', [MARK, BOX]);
    expect(output).toContain('plugin-mark');
    expect(output).toContain('plugin-box');
  });

  // Proves the first registered syntax keeps every character it claimed from later ones.
  it('lets the first registered syntax win its characters', () => {
    const SECOND: PluginSyntax = { id: 'p:two', pattern: 'there', tag: 'em', className: 'plugin-two' };
    const output = drawn('Hello @@there', [MARK, SECOND]);
    expect(output).toContain('plugin-mark');
    expect(output).not.toContain('plugin-two');
  });

  it('a match is drawn as the element the plugin named, not another', () => {
    const html = drawn('Hello @@there.', [MARK]);
    expect(html).toContain('<mark');
    expect(html).not.toContain('<em');
  });

  it('a match keeps the text it matched', () => {
    const html = drawn('Hello @@there.', [MARK]);
    expect(html).toContain('>@@there<');
  });

  it('a pattern that can match nothing draws nothing', () => {
    const EMPTY: PluginSyntax = { id: 'p:empty', pattern: 'x*', tag: 'mark', className: 'plugin-empty' };
    const html = drawn('Hello', [EMPTY]);
    expect(html).toContain('Hello');
    expect(html).not.toContain('plugin-empty');
  });

  it('what one syntax claimed is not offered to the next', () => {
    const WORDS: PluginSyntax = { id: 'p:words', pattern: '[a-z]+', tag: 'em', className: 'plugin-words' };
    const html = drawn('Hello @@there', [MARK, WORDS]);
    expect(html).toContain('@@there');
  });

  // Proves a syntax that matches nothing leaves the document exactly as it was.
  it('changes nothing when a syntax matches no text', () => {
    const output = drawn('Hello.', [MARK]);
    expect(output).not.toContain('plugin-mark');
  });

  // Proves a match inside emphasis is still reached and drawn by the walk.
  it('draws a match found inside emphasis', () => {
    const output = drawn('*Hello @@there*', [MARK]);
    expect(output).toContain('plugin-mark');
  });

  // Proves a match in a heading is drawn while the heading element itself remains intact.
  it('draws a match found inside a heading', () => {
    const output = drawn('# @@title', [MARK]);
    expect(output).toContain('plugin-mark');
    expect(output).toContain('<h1');
  });

  // Proves inline code is left alone, because the text inside a code span is not a run of text the walk reaches.
  it('leaves inline code untouched', () => {
    const output = drawn('`@@there`', [MARK]);
    expect(output).not.toContain('plugin-mark');
  });

  // Proves an un-compilable pattern draws nothing and never throws over a reader's document.
  it('draws nothing when a pattern cannot compile', () => {
    const BAD: PluginSyntax = { id: 'p:bad', pattern: '([a-z', tag: 'mark', className: 'plugin-bad' };
    const output = drawn('Hello.', [BAD]);
    expect(output).toContain('Hello.');
    expect(output).not.toContain('plugin-bad');
  });

  // Proves a pattern that can match nothing does not sweep forever; the test finishing at all is the assertion.
  it('stops sweeping when a pattern matches only empty text', () => {
    const EMPTY: PluginSyntax = { id: 'p:empty', pattern: 'x*', tag: 'mark', className: 'plugin-empty' };
    const output = drawn('Hello', [EMPTY]);
    expect(output).toContain('Hello');
  });
});

describe('a plugin never rewrites a document', () => {
  // Proves the serializer half of the triple: renderHtml draws into a copy so serializeDocument still reports the original source.
  it('draws into a copy while leaving the reader file untouched', () => {
    const document = parseMarkdown('Hello @@there.');
    const html = renderHtml(document, { pluginSyntax: [MARK] });
    // A plugin's syntax is drawn, never written, so nothing a plugin recognises can change the reader's file.
    expect(html).toContain('plugin-mark');
    expect(serializeDocument(document)).toBe('Hello @@there.\n');
  });

  // Proves that with no plugin registered both renderHtml and serializeDocument report the unchanged original source.
  it('renders and serialises a plain document with no plugin syntax present', () => {
    const document = parseMarkdown('Hello @@there.');
    expect(renderHtml(document, {})).not.toContain('plugin-mark');
    expect(serializeDocument(document)).toBe('Hello @@there.\n');
  });
});
