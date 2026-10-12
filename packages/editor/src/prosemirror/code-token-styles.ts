/**
 * @file code-token-styles.ts
 * @purpose Colours the `tok-*` classes @lezer/highlight's classHighlighter emits, for fenced code blocks and raw-source widgets (FR-7.9).
 * @inputs None.
 * @outputs CODE_TOKEN_STYLES stylesheet string.
 * @functions None (constant only).
 * @dataflow Static CSS string -> injected by the app shell alongside the other editor stylesheets.
 * @controlflow None.
 * @version 1
 * @date 2026-09-13
 */

/**
 * Token colours built only from existing theme tokens, so light and dark themes follow automatically and every
 * colour inherits the contrast the theme already guarantees against its background. The highlighter emitted
 * these classes before this file existed, but nothing styled them, so code rendered in one flat colour.
 */
export const CODE_TOKEN_STYLES: string = `
.tok-keyword, .tok-propertyName, .tok-macroName { color: var(--kdoc-color-accent); }
.tok-string, .tok-inserted { color: var(--kdoc-color-success); }
.tok-number, .tok-bool, .tok-atom, .tok-literal, .tok-labelName { color: var(--kdoc-color-warning); }
.tok-typeName, .tok-className, .tok-namespace, .tok-deleted { color: var(--kdoc-color-danger); }
.tok-comment, .tok-meta { color: var(--kdoc-color-text-muted); font-style: italic; }
.tok-link, .tok-url { color: var(--kdoc-color-accent); text-decoration: underline; }
.tok-heading, .tok-strong { font-weight: 600; }
.tok-emphasis { font-style: italic; }
.tok-invalid { text-decoration: underline wavy var(--kdoc-color-danger); }
`;
