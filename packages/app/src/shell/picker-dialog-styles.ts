/**
 * @file picker-dialog-styles.ts
 * @purpose Exposes the stylesheet string used to style the picker dialog shared by Quick Open and Go To.
 * @inputs none
 * @outputs PICKER_DIALOG_STYLES — a CSS template literal applied to the document head or host element.
 * @functions none; one exported constant (PICKER_DIALOG_STYLES).
 * @dataflow Source file → exported string constant → consuming dialog module injects styles into the DOM.
 * @controlflow Module evaluates once on import and exports the constant; no runtime branching or state transitions.
 * @version 4
 * @date 2026-10-03
 */

import { UI_FONT_STACK } from './ui-font.js';

/** Stylesheet for the Quick Open / Go To picker dialog element and its descendants. */
export const PICKER_DIALOG_STYLES: string = `
dialog.kdoc-picker-dialog {
  position: fixed;
  top: 15vh;
  margin: 0 auto;
  width: min(640px, 90vw);
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  /* A dialog in the top layer sits outside .kdoc-shell, so it inherits nothing and would fall back to serif. */
  font-family: ${UI_FONT_STACK};
  font-size: 14px;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
  overflow: hidden;
}
dialog.kdoc-picker-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}
.kdoc-picker-input {
  box-sizing: border-box;
  display: block;
  width: calc(100% - 32px);
  margin: 16px 16px 8px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 15px;
  outline: none;
  box-shadow: none;
  border-radius: var(--kdoc-radius-md);
}
.kdoc-picker-input:focus-visible {
  border: 2px solid var(--kdoc-chrome-accent);
}
.kdoc-picker-list {
  max-height: 50vh;
  overflow-y: auto;
  margin: 0;
  padding: 4px 8px 8px;
  list-style: none;
  border-radius: var(--kdoc-radius-md);
}
.kdoc-picker-option {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 40px;
  padding: 0 14px;
  cursor: pointer;
  border-radius: var(--kdoc-radius-pill);
}
.kdoc-picker-option:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}
.kdoc-picker-option.active {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}
.kdoc-picker-option.active .kdoc-picker-label {
  color: var(--kdoc-chrome-on-selected);
}
.kdoc-picker-label {
  color: var(--kdoc-chrome-text);
  white-space: nowrap;
}
.kdoc-picker-detail {
  margin-left: auto;
  min-width: 0;
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
mark.kdoc-picker-hit {
  background: transparent;
  color: var(--kdoc-chrome-accent);
  font-weight: 600;
  border-radius: var(--kdoc-radius-sm);
}
/* On the selection colour the accent disappears, so the active row marks its matches by underline instead. */
.kdoc-picker-option.active mark.kdoc-picker-hit {
  color: inherit;
  text-decoration: underline;
}
.kdoc-picker-option.active .kdoc-picker-detail {
  color: var(--kdoc-chrome-on-selected);
}
.kdoc-picker-empty {
  padding: 10px 14px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}
.kdoc-picker-list::-webkit-scrollbar { width: 8px; }
.kdoc-picker-list::-webkit-scrollbar-track { background: transparent; border-radius: var(--kdoc-radius-pill); box-shadow: none; }
.kdoc-picker-list::-webkit-scrollbar-thumb { background: var(--kdoc-chrome-raised); border-radius: var(--kdoc-radius-pill); box-shadow: none; }
`;