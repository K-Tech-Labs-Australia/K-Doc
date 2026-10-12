/**
 * @file ui-font.ts
 * @purpose One definition of the interface font, applied to the page body so elements outside the shell (dialogs, menus, popups) use it too.
 * @inputs none
 * @outputs UI_FONT_STACK and UI_FONT_STYLES
 * @functions none (two exported constants)
 * @dataflow constant -> shell stylesheet -> document head
 * @controlflow evaluated once on import
 * @version 2
 * @date 2026-10-03
 */

/** The interface font: the platform's own UI face, then common sans-serif fallbacks. */
export const UI_FONT_STACK: string = "'Roboto Flex Variable', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";

/**
 * Sets the interface font on the page body. Dialogs, menus, hover cards and popups are appended to <body>, outside
 * .kdoc-shell, so without this they fall back to the browser's default serif face.
 */
export const UI_FONT_STYLES: string = `
body {
  font-family: ${UI_FONT_STACK};
}
`;