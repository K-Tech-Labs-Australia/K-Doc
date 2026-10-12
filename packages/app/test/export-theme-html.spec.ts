/**
 * @file export-theme-html.spec.ts
 * @purpose Covers FR-13.8: the chosen theme reaches the exported file and the printout — an explicit stylesheet is written into both, the shipped K-Doc stylesheet is used when none is given, a theme with no CSS still yields a valid document, and the printout keeps its page setup rules alongside the theme.
 * @inputs A parsed Markdown document plus optional theme CSS strings and a page setup passed to the export/print helpers.
 * @outputs Assertions over the generated HTML for whether it contains the chosen stylesheet, the shipped stylesheet, an empty style block, or the page setup rules.
 * @functions exportDocumentHtml - builds the standalone exported HTML document from a parsed document and theme.
 *   - printableHtml - builds the print-ready HTML document from a parsed document, page setup, and theme.
 * @dataflow parseMarkdown -> document -> exportDocumentHtml / printableHtml -> generated HTML -> assertions over its contents.
 * @controlflow Two describe blocks (exported file, printout); each it invokes an export helper then asserts on the returned HTML string.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_STYLESHEET, EXPORT_THEMES, parseMarkdown } from '@k-doc/core';
import { exportDocumentHtml, printableHtml, DEFAULT_PAGE_SETUP } from '../src/files/export.js';

const document = parseMarkdown('# Title\n\nWords.\n');

describe('an exported file', () => {
  // Guards writing the chosen theme's stylesheet into the exported file when one is supplied.
  it('is written with the stylesheet it was given', () => {
    const html = exportDocumentHtml(document, 'T', undefined, undefined, 'body { color: rebeccapurple }');
    expect(html).toContain('body { color: rebeccapurple }');
    expect(html).not.toContain(EXPORT_STYLESHEET);
  });

  // Guards falling back to the shipped stylesheet when no theme is supplied.
  it('is written with the stylesheet K-Doc ships when it is given none', () => {
    expect(exportDocumentHtml(document, 'T')).toContain(EXPORT_STYLESHEET);
  });

  // Guards writing an empty style block and rendered content when a theme provides no CSS.
  it('can be written with no stylesheet at all', () => {
    const html = exportDocumentHtml(document, 'T', undefined, undefined, EXPORT_THEMES.plain);
    expect(html).toContain('<style>\n\n</style>');
    expect(html).toContain('<h1>Title</h1>');
  });
});

describe('a printout', () => {
  // Guards styling the printout with the chosen theme while keeping the page setup rules.
  it('is styled by the theme, and still by the page setup', () => {
    const html = printableHtml(document, 'T', DEFAULT_PAGE_SETUP, undefined, 'body { color: rebeccapurple }');
    expect(html).toContain('body { color: rebeccapurple }');
    expect(html).toContain('@page');
    expect(html).not.toContain(EXPORT_STYLESHEET);
  });

  // Guards falling back to the shipped stylesheet for a printout with no theme, still applying the page setup.
  it('is styled by the stylesheet K-Doc ships when it is given no theme', () => {
    const html = printableHtml(document, 'T', DEFAULT_PAGE_SETUP);
    expect(html).toContain(EXPORT_STYLESHEET);
    expect(html).toContain('@page');
  });
});
