/**
 * @file export.ts
 * @purpose Provides standalone HTML document export and native print facilities with configurable page setup for K-Doc (FR-13.1, FR-13.3).
 *
 *   HEADER NOTE: Printing renders the document into a hidden, isolated iframe rather than invoking win.print()
 *   on the main app window. Printing the live app would include toolbars, panes, and active scroll offsets,
 *   which would require an invasive print stylesheet. An isolated iframe ensures that only the document is printed
 *   and allows @page rules (paper size, orientation, margins) to apply specifically to the document.
 *
 * @inputs KdocDocument AST structures, document titles, PageSetup configurations, FileService adapters, and browser Window contexts.
 * @outputs Standalone HTML document strings, CSS @page rule strings, exported file persistence on disk, and native print dialog triggers.
 * @functions
 *   - pageRule: Generates a CSS @page rule specifying paper size, orientation, and clamped margins [0, 50]mm.
 *   - exportDocumentHtml: Renders a KdocDocument into a complete standalone HTML document string.
 *   - saveHtmlExport: Prompts for a save path via FileService and writes a standalone HTML export to disk.
 *   - printDocument: Mounts a hidden iframe, populates it with styled document HTML, and triggers window printing.
 * @dataflow Document AST & PageSetup -> HTML generation (renderHtml + pageRule + EXPORT_STYLESHEET) -> FileService disk persistence or iframe print spooling.
 * @controlflow Format page CSS rules -> render standalone HTML -> (for export: prompt chooseSavePath and write to disk; for print: create hidden iframe, write document, trigger print dialog, and clean up after delay).
 * @version 5
 * @date 2026-10-07
 */

import { escapeStyleContent, renderHtml, EXPORT_STYLESHEET, type CommentNoteOptions, type KdocDocument, type PluginSyntax } from '@k-doc/core';
import type { FileService } from './file-service.js';
import { pageRule, tocHtml, TOC_STYLESHEET, type PageSetup } from './page-setup.js';

// Re-exported so the one import a caller already has keeps working. The model itself lives in
// page-setup.ts, because the dialog that edits it has no business importing the printer.
export {
  DEFAULT_PAGE_SETUP,
  MARGIN_MIN_MM,
  MARGIN_MAX_MM,
  pageRule,
  runningContent,
  tocHtml,
  TOC_STYLESHEET,
} from './page-setup.js';
export type { PageSetup, PaperSize, Orientation } from './page-setup.js';

/**
 * Renders a KdocDocument into a complete standalone HTML document suitable for file export.
 *
 * @purpose Generates a self-contained HTML document with embedded styles and metadata from a KdocDocument.
 * @inputs
 *   - document: KdocDocument - The parsed Markdown document AST to render.
 *   - title: string - The document title to embed in the HTML head.
 * @outputs string - A complete standalone HTML document string.
 * @dataflow document + title -> renderHtml with standalone: true -> standalone HTML string.
 * @controlflow Delegate to renderHtml with standalone: true and return the generated HTML string.
 */
export function exportDocumentHtml(
  document: KdocDocument,
  title: string,
  imageSources?: ReadonlyMap<string, string>,
  comments?: CommentNoteOptions,
  css?: string,
  pluginSyntax?: readonly PluginSyntax[],
): string {
  // Export is always standalone: a fragment written to a .html file on disk would open in a browser
  // as unstyled text, which is not what "export to HTML" means to anyone.
  // Embedded image data is passed on only when the caller gathered some, and comments only when the
  // caller asked for them -- left out, nothing about them reaches the file (FR-10.7).
  return renderHtml(document, {
    standalone: true,
    title,
    ...(imageSources === undefined ? {} : { imageSources }),
    ...(comments === undefined ? {} : { comments }),
    // The chosen export theme, or the one K-Doc ships when no theme was resolved (FR-13.8).
    ...(css === undefined ? {} : { css }),
    // Syntax the reader's plugins added, drawn into the exported copy and nowhere else (FR-14.18).
    ...(pluginSyntax === undefined ? {} : { pluginSyntax }),
  });
}

export interface ExportOptions {
  /** Comments to write into the exported file, and how; left out, nothing about them is written (FR-10.7). */
  readonly comments?: CommentNoteOptions;
  readonly fileService: FileService;
  readonly document: KdocDocument;
  readonly title: string;
  readonly suggestedName: string;
  /** Data URIs for the document's local images, keyed by address as written, so the file carries its pictures. */
  readonly imageSources?: ReadonlyMap<string, string>;
  /** Syntax the reader's plugins added, drawn into the exported file (FR-14.18). */
  readonly pluginSyntax?: readonly PluginSyntax[];
  /** The stylesheet to write into the file (FR-13.8); left out, the one K-Doc ships is used. */
  readonly css?: string;
}

/**
 * Prompts the user for a destination path and saves the document as standalone HTML to disk.
 *
 * @purpose Coordinates user destination selection and file persistence for standalone HTML document export.
 * @inputs options - ExportOptions containing fileService, document, title, and suggestedName.
 * @outputs Promise<string | null> - The saved file path, or null if the user cancelled the save dialog.
 * @dataflow options.suggestedName -> fileService.chooseSavePath -> exportDocumentHtml -> fileService.saveFile -> destination path or null.
 * @controlflow Prompt user for path via chooseSavePath -> if null return null -> render standalone HTML -> write via fileService.saveFile -> return chosen path.
 */
export async function saveHtmlExport(options: ExportOptions): Promise<string | null> {
  const path = await options.fileService.chooseSavePath(options.suggestedName);

  // Check if the user cancelled the save dialog.
  // A cancelled dialog is a normal outcome, not an error.
  if (path === null) {
    // User cancelled the file picker: return null without writing to disk.
    return null;
  } else {
    // User selected a target path: proceed to render HTML and persist to disk.
  }

  const contents = exportDocumentHtml(
    options.document,
    options.title,
    options.imageSources,
    options.comments,
    options.css,
    options.pluginSyntax,
  );

  // SaveTarget requires exact field names: path, contents, and encoding. An export is a new file rather
  // than a round trip of one that was read, so it is written as plain UTF-8 with no byte order mark.
  await options.fileService.saveFile({
    path,
    contents,
    encoding: 'utf-8',
  });

  return path;
}

/**
 * Wraps a rendered fragment in a standalone HTML document.
 *
 * @purpose Produces the complete document the print iframe is given, from a fragment the caller has
 *   already assembled.
 * @inputs
 *   - fragment: string - The body HTML, which may carry a contents page in front of the document.
 *   - title: string - The document title, for the <title> element.
 *   - css: string - The stylesheet to inline.
 * @outputs string - A complete HTML document.
 * @dataflow fragment + title + css -> a minimal HTML skeleton.
 * @controlflow Escape the title, then assemble.
 *
 * renderHtml's own standalone mode cannot be used here: it renders the document itself, and the thing
 * being printed is the document with a contents page in front of it. Wrapping a fragment is the only way
 * to put something before the body without teaching the renderer about printing.
 */
function standaloneWith(fragment: string, title: string, css: string): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // A theme stylesheet is user-supplied text: escaping a closing tag keeps it inside the <style> element it is written into.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${escapeStyleContent(css)}</style></head><body>${fragment}</body></html>`;
}

/**
 * Builds the complete HTML document that is handed to the print iframe.
 *
 * @purpose Assembles the page CSS, the optional contents page and the rendered document into one
 *   standalone HTML document.
 * @inputs
 *   - document: KdocDocument - The document to print.
 *   - title: string - The document title, which a running header may ask for.
 *   - setup: PageSetup - Paper, margins, running content and whether to include a contents page.
 * @outputs string - A complete HTML document.
 * @dataflow pageRule + TOC_STYLESHEET + EXPORT_STYLESHEET -> css; tocHtml + renderHtml -> body; both -> standaloneWith.
 * @controlflow Build the CSS, render the document, prepend a contents page when asked, and wrap the result.
 *
 * Separate from printDocument because this is the part worth testing: the iframe, the write and the
 * print call are the browser's behaviour, while what goes into them is K-Doc's.
 */
export function printableHtml(
  document: KdocDocument,
  title: string,
  setup: PageSetup,
  comments?: CommentNoteOptions,
  css?: string,
  pluginSyntax?: readonly PluginSyntax[],
): string {
  // The rule needs the title because a running header may ask for it, and the printer is the only
  // place that knows both the setup and the document it is about to print.
  // The page rule and the contents-page rules always apply; the rest is the chosen export theme (FR-13.8).
  const styles = pageRule(setup, title) + TOC_STYLESHEET + (css ?? EXPORT_STYLESHEET);
  const rendered = renderHtml(document, {
    standalone: false,
    // Printing takes comments on the same terms as an export: only when asked for (FR-10.7).
    ...(comments === undefined ? {} : { comments }),
    // A plugin's own syntax is drawn in a printout too, on the same terms (FR-14.18).
    ...(pluginSyntax === undefined ? {} : { pluginSyntax }),
  });

  // Check whether the setup asks for a table of contents.
  let contents = '';
  if (setup.includeToc) {
    // Built from the document's own headings, so it cannot disagree with what follows it.
    contents = tocHtml(document);
  } else {
    // No contents page asked for.
  }

  // The contents page is prepended to the rendered fragment rather than inserted by the renderer,
  // because it belongs to printing rather than to the document: it is not in the Markdown, and a
  // renderer that added it would put it in the HTML export and the Preview pane too.
  return standaloneWith(contents + rendered, title, styles);
}

export interface PrintOptions {
  readonly win: Window;
  readonly document: KdocDocument;
  readonly title: string;
  readonly setup: PageSetup;
  /** Comments to print, and how; left out, nothing about them is printed (FR-10.7). */
  readonly comments?: CommentNoteOptions;
  /** The stylesheet to print with (FR-13.8); left out, the one K-Doc ships is used. */
  readonly css?: string;
  /** Syntax the reader's plugins added, drawn into the printout (FR-14.18). */
  readonly pluginSyntax?: readonly PluginSyntax[];
}

/**
 * Prints a KdocDocument via a hidden, isolated iframe configured with the specified page setup.
 *
 * Printing via a hidden iframe rather than win.print() on the app itself: printing the live app
 * would print the toolbars, the outline pane, the Source pane and whatever is scrolled into view,
 * and getting that right would mean a print stylesheet that hides most of the application.
 * Rendering the document into an isolated iframe means the printed page is the document and nothing else,
 * and it is also what makes the page setup meaningful, because the @page rule applies to that document rather than to the app.
 *
 * @purpose Renders the document into an isolated DOM iframe and triggers native window printing with @page styles.
 * @inputs options - PrintOptions containing the host Window, KdocDocument, document title, and PageSetup.
 * @outputs void.
 * @dataflow options -> renderHtml with pageRule(options.setup) + EXPORT_STYLESHEET -> hidden iframe in win.document.body -> contentDocument.write -> contentWindow.print -> deferred iframe removal.
 * @controlflow Render standalone HTML with page CSS -> create and style hidden iframe -> attach to document.body -> try writing HTML and invoking print -> schedule iframe removal via setTimeout -> catch error, clean up iframe, and rethrow.
 */
export function printDocument(options: PrintOptions): void {
  // Build standalone HTML injecting pageRule(options.setup) ahead of EXPORT_STYLESHEET:
  const html = printableHtml(
    options.document,
    options.title,
    options.setup,
    options.comments,
    options.css,
    options.pluginSyntax,
  );

  const iframe = options.win.document.createElement('iframe');

  // The iframe is sized to nothing rather than display: none, because a display: none iframe
  // does not lay out and therefore has nothing to print.
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  // The printed document is never allowed to run script: without allow-scripts nothing in it executes, while
  // allow-same-origin keeps contentDocument/contentWindow reachable so the page can be written and printed,
  // and allow-modals is what lets print() open the system dialog from inside a sandboxed frame.
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');

  const doc = options.win.document;
  const body = doc.body;

  // Check whether the document body is present to host the print iframe.
  if (body === null) {
    // Document body is not available: bail out cleanly.
    return;
  } else {
    // Document body is present: append the hidden iframe element.
    body.appendChild(iframe);
  }

  // Wrap steps 3-5 so a failure removes the iframe rather than leaving an invisible one attached forever:
  try {
    const contentDoc = iframe.contentDocument;

    // Guard contentDocument being null and bail out cleanly.
    if (contentDoc === null) {
      // Content document is null (e.g. detached iframe or cross-origin restriction): remove iframe and bail out cleanly.
      iframe.remove();
      return;
    } else {
      // Content document is available: write standalone HTML into the iframe.
    }

    contentDoc.open();
    contentDoc.write(html);
    contentDoc.close();

    const contentWin = iframe.contentWindow;

    // Guard contentWindow being null and bail out cleanly.
    if (contentWin === null) {
      // Content window is null: remove iframe and bail out cleanly.
      iframe.remove();
      return;
    } else {
      // Content window is available: focus and open system print dialog.
    }

    contentWin.focus();
    contentWin.print();

    // Removing the iframe synchronously after print() races the print dialog in some engines,
    // which then prints a blank page, and a delay is the pragmatic fix rather than a correct one —
    // there is no reliable cross-engine "printing finished" signal.
    options.win.setTimeout((): void => {
      // Check whether the iframe is still attached to the DOM before removing.
      if (iframe.parentNode !== null) {
        // Iframe remains in the DOM: detach it cleanly.
        iframe.remove();
      } else {
        // Iframe was already detached: no action required.
      }
    }, 1000);
  } catch (error: unknown) {
    // Wrap steps 3-5 so a failure removes the iframe rather than leaving an invisible one attached forever.
    iframe.remove();
    throw error;
  }
}
