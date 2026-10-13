/**
 * @file raw-source-styles.ts
 * @purpose Styles for the embedded raw-HTML source widgets in the K-Doc pane (FR-7.9).
 * @inputs None.
 * @outputs RAW_SOURCE_STYLES stylesheet string.
 * @functions None (constant only).
 * @dataflow Static CSS -> injected by the app shell.
 * @controlflow None.
 * @version 1
 * @date 2026-09-13
 */

/**
 * A block widget reads as a code panel with a quiet language label; an inline widget as a code chip in the line.
 *
 * The parser's "invalid" marking is switched off inside these widgets. A widget holds a fragment by construction --
 * inline HTML arrives one tag at a time, and a <details> block split by blank lines arrives as separate blocks -- so
 * a closing tag with no opener in the widget is not an error in the document, and a wavy underline saying so is wrong.
 */
export const RAW_SOURCE_STYLES: string = `.kdoc-raw-block{position:relative;margin:.5em 0;border:1px solid var(--kdoc-color-border);border-radius:6px;background:var(--kdoc-color-code-background);color:var(--kdoc-color-code-text)}
.kdoc-raw-label{position:absolute;top:2px;right:8px;z-index:1;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--kdoc-color-text-muted);user-select:none;pointer-events:none}
.kdoc-raw-block .cm-editor{background:transparent;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;padding:6px 0;border-radius:6px}
.kdoc-raw-inline{display:inline-block;vertical-align:baseline;border:1px solid var(--kdoc-color-border);border-radius:4px;background:var(--kdoc-color-code-background);color:var(--kdoc-color-code-text)}
.kdoc-raw-inline .cm-editor{display:inline-block;background:transparent;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.kdoc-raw-inline .cm-content{padding:0}
.kdoc-raw-inline .cm-line{padding:0 3px}
.kdoc-raw-block .cm-editor.cm-focused,.kdoc-raw-inline .cm-editor.cm-focused{outline:2px solid var(--kdoc-color-accent);outline-offset:-1px}
.kdoc-raw-block .tok-invalid,.kdoc-raw-inline .tok-invalid{text-decoration:none}`;
