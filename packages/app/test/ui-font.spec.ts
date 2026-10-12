// @vitest-environment jsdom
/**
 * @file ui-font.spec.ts
 * @purpose Verifies the shared interface font and that it reaches elements appended to the body, outside the shell.
 * @inputs UI_FONT_STACK and UI_FONT_STYLES from ../src/shell/ui-font.js; PICKER_DIALOG_STYLES from ../src/shell/picker-dialog-styles.js; jsdom DOM environment.
 * @outputs vitest assertions validating font-family propagation and picker dialog usage.
 * @functions none — the file contains only describe/it test blocks.
 * @dataflow ui-font constants -> injected <style> element -> getComputedStyle on body and dialog -> assertion comparison.
 * @controlflow afterEach clears head and body before each test; each it() builds fresh DOM, reads computed style, asserts equality with UI_FONT_STACK.
 * @version 2
 * @date 2026-10-03
 */

import { afterEach, describe, expect, it } from 'vitest';
import { UI_FONT_STACK, UI_FONT_STYLES } from '../src/shell/ui-font.js';
import { PICKER_DIALOG_STYLES } from '../src/shell/picker-dialog-styles.js';

afterEach((): void => { document.head.replaceChildren(); document.body.replaceChildren(); });

describe('the interface font', (): void => {
  it('is a sans-serif stack led by the bundled Roboto Flex, falling back to the platform UI face', (): void => {
    expect(UI_FONT_STACK.startsWith("'Roboto Flex Variable'")).toBe(true);
    expect(UI_FONT_STACK.endsWith('sans-serif')).toBe(true);
    expect(UI_FONT_STACK).toContain("'Segoe UI'");
  });

  it('reaches a dialog appended to the body, outside the shell', (): void => {
    const style = document.createElement('style');
    style.textContent = UI_FONT_STYLES;
    document.head.append(style);
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    // The computed value re-quotes family names with double quotes.
    const expected = UI_FONT_STACK.replaceAll("'", '"');
    expect(getComputedStyle(document.body).fontFamily).toBe(expected);
    expect(getComputedStyle(dialog).fontFamily).toBe(expected);
  });

  it('is the one the picker dialog uses', (): void => {
    expect(PICKER_DIALOG_STYLES).toContain(`font-family: ${UI_FONT_STACK};`);
  });
});