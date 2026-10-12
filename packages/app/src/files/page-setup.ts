/**
 * @file page-setup.ts
 * @purpose Defines the page-setup configuration model and generates print CSS @page rules and table of contents HTML (FR-13.2).
 *
 *   Running headers and footers are real paged-media margin boxes, not fixed-position elements faked to
 *   repeat. `@page { @bottom-center { content: ... counter(page) } }` is supported by the engine K-Doc prints
 *   through, which was checked by parsing the rule and reading it back rather than assumed — and it is the only
 *   way a page number can be a page number rather than a guess about where the page breaks fell.
 *
 *   Header and footer are templates, not literals, because the useful things to put in one are the document's
 *   title and the page count and neither is known when the user types the setting.
 *
 * @inputs PageSetup configurations, document title strings, template strings, and KdocDocument AST structures.
 * @outputs CSS @page rule strings, CSS content value strings, table of contents HTML strings, and TOC stylesheet CSS.
 * @functions
 *   - runningContent: Turns a header or footer template into a CSS content value.
 *   - pageRule: Builds the whole @page rule: size, margins, and the two margin boxes.
 *   - tocHtml: Renders a table of contents from the document's headings, or an empty string when there are none.
 * @dataflow PageSetup + title -> runningContent tokenization/interpolation -> @page rule CSS; KdocDocument -> buildOutline -> HTML escaping -> TOC nav HTML.
 * @controlflow Validate & clamp margins -> interpolate header/footer margin boxes -> assemble @page rule; parse outline -> conditionally return TOC or empty string.
 * @version 1
 * @date 2026-09-11
 */

import { buildOutline, type KdocDocument, type OutlineEntry } from '@k-doc/core';

export type PaperSize = 'A4' | 'Letter' | 'Legal' | 'A3';
export type Orientation = 'portrait' | 'landscape';

export interface PageSetup {
  readonly paper: PaperSize;
  readonly orientation: Orientation;
  /** Margin in millimetres, applied to all four sides. */
  readonly marginMm: number;
  /** Running header template. Empty means no header. Supports {title}, {page} and {pages}. */
  readonly header: string;
  /** Running footer template. Empty means no footer. Supports {title}, {page} and {pages}. */
  readonly footer: string;
  /** Put a table of contents, built from the document's headings, before the body. */
  readonly includeToc: boolean;
}

/**
 * Minimum allowable page margin in millimetres.
 */
export const MARGIN_MIN_MM: number = 0;

/**
 * Maximum allowable page margin in millimetres.
 * A margin larger than 50mm leaves insufficient printable area on standard paper sizes.
 */
export const MARGIN_MAX_MM: number = 50;

/**
 * Default page setup configuration for print and PDF export.
 *
 * The three new fields default to off so a user who never opens the dialog gets exactly the
 * printed page they got before it existed; and that A4 is the default because it is the standard nearly
 * everywhere outside North America and a wrong default is one dropdown away from right either way.
 */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'portrait',
  marginMm: 20,
  header: '',
  footer: '',
  includeToc: false,
};

/**
 * Escapes and wraps a string as a CSS double-quoted string literal.
 *
 * @purpose Wraps a string in double quotes and escapes backslashes, quotes, and newlines for CSS string syntax.
 * @inputs value - The raw text string to format as a CSS string literal.
 * @outputs string - The formatted CSS double-quoted string literal.
 * @dataflow value -> replace newlines with space -> replace backslashes -> replace double quotes -> wrap in quotes.
 * @controlflow Strip newlines -> escape '\' to '\\' -> escape '"' to '\"' -> return wrapped in double quotes.
 */
function cssString(value: string): string {
  // Strip newlines so multiline text does not break CSS string literal syntax.
  const singleLine = value.replace(/[\r\n]+/g, ' ');

  // A title comes from a filename and a filename can contain a quote, which would otherwise close
  // the CSS string and leave the rest of it as broken syntax. Backslashes must be escaped before
  // double quotes so that the quote escape character is not doubled.
  const escaped = singleLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `"${escaped}"`;
}

/**
 * Turns a running header or footer template into a CSS content value.
 *
 * @purpose Turns a header or footer template into a CSS `content` value.
 * @inputs template - The header or footer template string containing literal text and placeholders.
 * @inputs title - The document title string to interpolate into the {title} placeholder.
 * @outputs string - The compiled CSS content value string, or an empty string if nothing was produced.
 * @dataflow template -> regex split -> map tokens to CSS counters / quoted literals -> join with spaces.
 * @controlflow Split template on /({title}|{page}|{pages})/ -> branch per token type -> assemble parts array -> check if empty and return '' or joined string.
 */
export function runningContent(template: string, title: string): string {
  const tokens = template.split(/(\{title\}|\{page\}|\{pages\})/);
  const parts: string[] = [];

  for (const token of tokens) {
    // Check if token matches the current page placeholder {page}.
    if (token === '{page}') {
      // {page} placeholder: emit the CSS counter(page) function.
      parts.push('counter(page)');
    } else if (token === '{pages}') {
      // Check if token matches the total pages placeholder {pages}.
      // {pages} placeholder: emit the CSS counter(pages) function.
      parts.push('counter(pages)');
    } else if (token === '{title}') {
      // Check if token matches the document title placeholder {title}.
      // {title} placeholder: emit the quoted, escaped document title.
      parts.push(cssString(title));
    } else {
      // Token is literal text outside of placeholders.
      // Check whether the literal token is non-empty so the value has no "" fragments in it.
      if (token.length > 0) {
        // Non-empty literal string: emit as a quoted, escaped CSS string literal.
        parts.push(cssString(token));
      } else {
        // Empty string from regex split boundary: skip so the value has no "" fragments in it.
      }
    }
  }

  // Check whether any content parts were produced.
  if (parts.length === 0) {
    // Nothing was produced: return empty string so no margin box is rendered.
    return '';
  } else {
    // Join the content parts with a single space separator for CSS content syntax.
    return parts.join(' ');
  }
}

/**
 * Builds the complete CSS @page at-rule declaring page size, orientation, margins, and running margin boxes.
 *
 * @purpose Builds the whole `@page` rule: size, margins and the two margin boxes.
 * @inputs setup - PageSetup configuration specifying paper size, orientation, margins, and running header/footer templates.
 * @inputs title - The document title string to interpolate into running header and footer margin boxes.
 * @outputs string - The formatted CSS @page at-rule string.
 * @dataflow setup + title -> validate & clamp margin -> evaluate header & footer runningContent -> construct @page rule.
 * @controlflow Check Number.isFinite on marginMm -> clamp to [MARGIN_MIN_MM, MARGIN_MAX_MM] -> assemble base size and margin -> conditionally append @top-center and @bottom-center -> return @page string.
 */
export function pageRule(setup: PageSetup, title: string): string {
  let clampedMargin: number = setup.marginMm;

  // Check whether marginMm is a finite number. A margin read from a settings file
  // the user edited by hand can be anything (e.g. NaN, Infinity, or missing).
  if (!Number.isFinite(clampedMargin)) {
    // Value is non-finite: fall back to the default margin.
    clampedMargin = DEFAULT_PAGE_SETUP.marginMm;
  } else {
    // Value is finite: keep the numeric margin value for boundary checks.
  }

  // Check whether the margin is below the minimum allowed bound.
  if (clampedMargin < MARGIN_MIN_MM) {
    // Margin is below minimum: clamp to MARGIN_MIN_MM.
    clampedMargin = MARGIN_MIN_MM;
  } else {
    // Margin satisfies the minimum bound.
  }

  // Check whether the margin exceeds the maximum allowed bound.
  // A margin the page cannot hold prints nothing at all, and one read from a settings file
  // the user edited by hand can be anything.
  if (clampedMargin > MARGIN_MAX_MM) {
    // Margin exceeds maximum: clamp to MARGIN_MAX_MM.
    clampedMargin = MARGIN_MAX_MM;
  } else {
    // Margin satisfies the maximum bound.
  }

  const paper = setup.paper.toLowerCase();
  const orientation = setup.orientation;
  let ruleBody = `size: ${paper} ${orientation}; margin: ${clampedMargin}mm;`;

  const headerContent = runningContent(setup.header, title);
  // Check whether a non-empty running header was produced from the template.
  if (headerContent.length > 0) {
    // Header is non-empty: append @top-center margin box rule.
    ruleBody += ` @top-center { content: ${headerContent}; font-size: 9pt; color: #57606a; }`;
  } else {
    // Header is empty: omit @top-center margin box rule.
  }

  const footerContent = runningContent(setup.footer, title);
  // Check whether a non-empty running footer was produced from the template.
  if (footerContent.length > 0) {
    // Footer is non-empty: append @bottom-center margin box rule.
    ruleBody += ` @bottom-center { content: ${footerContent}; font-size: 9pt; color: #57606a; }`;
  } else {
    // Footer is empty: omit @bottom-center margin box rule.
  }

  return `@page { ${ruleBody} }`;
}

/**
 * Escapes special HTML characters (&, <, >) in plain text strings.
 *
 * @purpose Sanitizes text for HTML inclusion by escaping ampersands and angle brackets.
 * @inputs text - The raw plain text string to escape.
 * @outputs string - The HTML-escaped string.
 * @dataflow text -> replace & -> replace < -> replace > -> HTML-safe string.
 * @controlflow Replace '&' first to avoid double-escaping entities, then replace '<' and '>'.
 */
function escapeHtml(text: string): string {
  // Ampersand '&' must be replaced first: replacing it after any other characters
  // would cause the ampersands in their generated entities to get double-escaped.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Renders a table of contents HTML navigation block from the document's headings.
 *
 * @purpose Renders a table of contents from the document's headings, or an empty string when there are none.
 * @inputs document - The parsed KdocDocument containing markdown AST root and source text.
 * @outputs string - The rendered HTML <nav> element containing the table of contents, or empty string.
 * @dataflow document -> buildOutline -> filter empty -> map headings to <li> with depth class -> wrap in <nav><ol> -> HTML string.
 * @controlflow Extract outline entries -> if entries.length === 0 return '' -> loop entries escaping text and attaching kdoc-toc-l${entry.depth} class -> wrap items in <nav class="kdoc-toc"><h2>Contents</h2><ol>...</ol></nav> -> return HTML string.
 */
export function tocHtml(document: KdocDocument): string {
  const entries: readonly OutlineEntry[] = buildOutline(document);

  // Check if the document contains any headings. A document with no headings has no contents,
  // and a heading reading "Contents" over nothing is worse than no page at all.
  if (entries.length === 0) {
    // No headings present: return empty string so no contents block is inserted.
    return '';
  } else {
    // Headings present: proceed to build the table of contents.
  }

  const items: string[] = [];

  // The list is flat with a depth class rather than genuinely nested, because a document can jump
  // from an h1 to an h3 and building real nesting out of that means inventing levels the author did not
  // write.
  for (const entry of entries) {
    const escapedText = escapeHtml(entry.text);
    items.push(`<li class="kdoc-toc-l${entry.depth}">${escapedText}</li>`);
  }

  return `<nav class="kdoc-toc"><h2>Contents</h2><ol>${items.join('')}</ol></nav>`;
}

/**
 * Stylesheet for the rendered print table of contents (FR-13.2).
 *
 * The break-after: page rule on .kdoc-toc is what makes it a contents page rather than
 * a paragraph the document happens to start with.
 */
export const TOC_STYLESHEET: string = `
.kdoc-toc {
  break-after: page;
}

.kdoc-toc ol {
  list-style: none;
  padding: 0;
  margin: 0;
}

.kdoc-toc-l1 {
  margin-left: 0;
  font-size: 1rem;
}

.kdoc-toc-l2 {
  margin-left: 1em;
  font-size: 0.95rem;
}

.kdoc-toc-l3 {
  margin-left: 2em;
  font-size: 0.9rem;
}

.kdoc-toc-l4 {
  margin-left: 3em;
  font-size: 0.85rem;
}

.kdoc-toc-l5 {
  margin-left: 4em;
  font-size: 0.8rem;
}

.kdoc-toc-l6 {
  margin-left: 5em;
  font-size: 0.75rem;
}
`;
