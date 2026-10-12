// @vitest-environment jsdom

/**
 * @file page-setup.spec.ts
 * @purpose Vitest test suite for K-Doc's page-setup model, CSS @page rules, table of contents rendering, and the modal PageSetupDialog controller (FR-13.2).
 * @inputs Synthetic DOM click, cancel, and input events; PageSetup configurations; markdown document ASTs.
 * @outputs Vitest assertions verifying CSS @page rules, TOC HTML structures, dialog form control values, and promise settlements.
 * @functions
 *   - setupWith: Creates a PageSetup configuration by spreading overrides over DEFAULT_PAGE_SETUP.
 *   - mount: Installs and mounts a PageSetupDialog instance to document.body and registers it for lifecycle cleanup.
 *   - control: Queries a descendant element within a container by CSS selector, failing fast if missing.
 * @dataflow PageSetup configurations & Markdown AST -> pageRule / runningContent / tocHtml / PageSetupDialog -> CSS rules, HTML strings, & resolved PageSetup options.
 * @controlflow Mount dialog and query controls -> execute test cases across runningContent, pageRule, tocHtml, and PageSetupDialog -> destroy controllers in afterEach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it, afterEach } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import {
  DEFAULT_PAGE_SETUP,
  MARGIN_MIN_MM,
  MARGIN_MAX_MM,
  pageRule,
  runningContent,
  tocHtml,
  TOC_STYLESHEET,
  type PageSetup,
} from '../src/files/page-setup.js';
import { printableHtml } from '../src/files/export.js';
import {
  installPageSetupDialog,
  PAGE_SETUP_STYLES,
  type PageSetupDialog,
} from '../src/shell/page-setup-dialog.js';

let dialogs: PageSetupDialog[] = [];

afterEach((): void => {
  // Destroy all active dialog instances to clean up listeners and DOM elements.
  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    // Check if dialog controller exists under strict array indexing.
    if (dialog !== undefined) {
      dialog.destroy();
    } else {
      // Skip undefined dialog reference.
    }
  }
  dialogs = [];

  // Remove any lingering dialog elements attached to document.body.
  const lingeringDialogs = document.body.querySelectorAll<HTMLDialogElement>(
    'dialog.kdoc-page-setup',
  );
  for (let i = 0; i < lingeringDialogs.length; i++) {
    const d = lingeringDialogs[i];
    // Check if dialog node is defined and currently attached to a parent node.
    if (d !== undefined && d.parentNode !== null) {
      d.parentNode.removeChild(d);
    } else {
      // Dialog already detached.
    }
  }
});

/**
 * Creates a PageSetup configuration by spreading partial overrides over DEFAULT_PAGE_SETUP.
 *
 * @purpose Merges partial page setup overrides with the default page setup baseline.
 * @inputs overrides - Partial<PageSetup> containing configuration fields to override.
 * @outputs PageSetup - The merged PageSetup configuration.
 * @dataflow overrides -> spread over DEFAULT_PAGE_SETUP -> PageSetup object.
 * @controlflow Return new object spreading DEFAULT_PAGE_SETUP and overrides.
 */
function setupWith(overrides: Partial<PageSetup>): PageSetup {
  return {
    ...DEFAULT_PAGE_SETUP,
    ...overrides,
  };
}

/**
 * Installs a PageSetupDialog instance mounted to document.body, registers it for teardown, and returns it with its root element.
 *
 * @purpose Allocates, installs, and tracks a PageSetupDialog instance for testing.
 * @inputs void.
 * @outputs { dialog: PageSetupDialog; root: HTMLDialogElement } - The controller and root dialog element.
 * @dataflow installPageSetupDialog -> track in dialogs -> query dialog root element -> return pair.
 * @controlflow Inject PAGE_SETUP_STYLES into head if needed -> install dialog with document -> push to dialogs -> query dialog.kdoc-page-setup -> if null throw Error -> return dialog and root.
 */
function mount(): { dialog: PageSetupDialog; root: HTMLDialogElement } {
  // Check if dialog stylesheet has already been injected into document.head.
  if (document.head.querySelector('style[data-kdoc-page-setup]') === null) {
    // Stylesheet missing: inject PAGE_SETUP_STYLES into document head.
    const style = document.createElement('style');
    style.setAttribute('data-kdoc-page-setup', 'true');
    style.textContent = PAGE_SETUP_STYLES;
    document.head.appendChild(style);
  } else {
    // Stylesheet already injected: skip duplicate insertion.
  }

  const dialog = installPageSetupDialog({ doc: document });
  dialogs.push(dialog);

  const root = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-page-setup');
  // Check if the dialog root element was successfully mounted to document.body.
  if (root === null) {
    // Dialog root element not found: throw descriptive Error.
    throw new Error('Mounted dialog element "dialog.kdoc-page-setup" not found in document.body');
  } else {
    // Dialog root element found: return controller and root.
    return { dialog, root };
  }
}

/**
 * Queries an element matching a CSS selector within a container, throwing a descriptive error if missing.
 *
 * @purpose Queries a DOM element with fail-fast missing element error handling.
 * @inputs
 *   - root: HTMLElement - The parent container element to query within.
 *   - selector: string - CSS selector string to query.
 * @outputs T - The matched HTMLElement.
 * @dataflow root.querySelector<T>(selector) -> check null -> return element.
 * @controlflow Query selector on root -> check if null -> if null throw descriptive Error -> return element.
 */
function control<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  // Check if an element matching the given selector exists in the container.
  if (element === null) {
    // Element not found: throw descriptive Error.
    throw new Error(`Control element matching selector "${selector}" not found in root`);
  } else {
    // Element found: return element.
    return element;
  }
}

describe('runningContent', () => {
  it('plain text becomes a quoted string', () => {
    expect(runningContent('Draft', 'T')).toBe('"Draft"');
  });

  it('{page} becomes a counter', () => {
    const result = runningContent('{page}', 'T');
    expect(result).toBe('counter(page)');
    expect(result).not.toContain('"counter(page)"');
  });

  it('{pages} becomes counter(pages)', () => {
    expect(runningContent('{pages}', 'T')).toBe('counter(pages)');
  });

  it('{title} becomes the quoted title', () => {
    expect(runningContent('{title}', 'My Doc')).toBe('"My Doc"');
  });

  it('a mixed template keeps its literals', () => {
    // The spaces around "of" are the user's and have to survive as part of the literal,
    // because a CSS content value concatenates without adding any.
    expect(runningContent('{page} of {pages}', 'T')).toBe(
      'counter(page) " of " counter(pages)',
    );
  });

  it('an empty template produces nothing', () => {
    // An empty template produces nothing (''), which is what decides whether a margin box is written at all.
    expect(runningContent('', 'T')).toBe('');
  });

  it('a quote in the title is escaped', () => {
    // A title comes from a filename, a filename can contain a quote, and an unescaped one
    // would close the CSS string and leave the rest as broken syntax.
    const result = runningContent('{title}', 'He said "hi"');
    expect(result).toContain('\\"');
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
  });

  it('a newline in the title becomes a space', () => {
    const result = runningContent('{title}', 'Line 1\nLine 2');
    expect(result).not.toContain('\n');
  });
});

describe('pageRule', () => {
  it('it carries size and margin', () => {
    const rule = pageRule(DEFAULT_PAGE_SETUP, 'Title');
    expect(rule).toContain('size: a4 portrait');
    expect(rule).toContain('margin: 20mm');
  });

  it('the paper name is lower-cased', () => {
    const rule = pageRule(setupWith({ paper: 'Letter' }), 'Title');
    expect(rule).toContain('size: letter');
  });

  it('no header or footer means no margin boxes', () => {
    // An empty margin box would still reserve its space on the page,
    // so no header or footer means no margin boxes are written.
    const rule = pageRule(DEFAULT_PAGE_SETUP, 'Title');
    expect(rule).not.toContain('@top-center');
    expect(rule).not.toContain('@bottom-center');
  });

  it('a header becomes @top-center and a footer becomes @bottom-center', () => {
    const rule = pageRule(setupWith({ header: 'H', footer: '{page}' }), 'Title');
    expect(rule).toContain('@top-center');
    expect(rule).toContain('@bottom-center');
  });

  it('the margin is clamped at both ends', () => {
    const minRule = pageRule(setupWith({ marginMm: -5 }), 'Title');
    expect(minRule).toContain(`margin: ${MARGIN_MIN_MM}mm`);

    const maxRule = pageRule(setupWith({ marginMm: 500 }), 'Title');
    expect(maxRule).toContain(`margin: ${MARGIN_MAX_MM}mm`);
  });

  it('a non-finite margin falls back to the default', () => {
    // A settings file the user edited by hand can hold anything, and a margin the page
    // cannot hold prints nothing at all.
    const rule = pageRule(setupWith({ marginMm: Number.NaN }), 'Title');
    expect(rule).toContain(`margin: ${DEFAULT_PAGE_SETUP.marginMm}mm`);
  });
});

describe('tocHtml', () => {
  it('a document with headings gets a contents list', () => {
    const doc = parseMarkdown('# One\n\n## Two\n\npara\n');
    const result = tocHtml(doc);
    expect(result).toContain('Contents');
    expect(result).toContain('One');
    expect(result).toContain('Two');

    const liMatches = result.match(/<li/g);
    // Check if matching <li> tags were found.
    if (liMatches !== null) {
      expect(liMatches.length).toBe(2);
    } else {
      expect(liMatches).not.toBeNull();
    }
  });

  it('each entry carries its depth class', () => {
    const doc = parseMarkdown('# One\n\n## Two\n\npara\n');
    const result = tocHtml(doc);
    expect(result).toContain('kdoc-toc-l1');
    expect(result).toContain('kdoc-toc-l2');
  });

  it('a document with no headings gets nothing', () => {
    // A heading reading Contents over nothing is worse than no contents page at all.
    const doc = parseMarkdown('just prose\n');
    expect(tocHtml(doc)).toBe('');
  });

  it('heading text is escaped', () => {
    const doc = parseMarkdown('# A < B & C\n');
    const result = tocHtml(doc);
    expect(result).toContain('A &lt; B &amp; C');
    expect(result).toContain('&lt;');
    expect(result).toContain('&amp;');

    const liMatch = result.match(/<li[^>]*>(.*?)<\/li>/);
    // Check if the <li> element content match is defined.
    if (liMatch !== null && liMatch[1] !== undefined) {
      expect(liMatch[1]).not.toContain('<');
    } else {
      expect(liMatch).not.toBeNull();
    }
  });

  it('the stylesheet breaks the page after it', () => {
    // break-after: page is what makes it a contents page rather than a paragraph the document starts with.
    expect(TOC_STYLESHEET).toContain('break-after: page');
  });
});

describe('printableHtml', () => {
  it('puts the contents page before the document', () => {
    // The contents page belongs to printing rather than to the document -- it is not in the Markdown --
    // so it is prepended to the rendered fragment rather than inserted by the renderer, which would put
    // it in the HTML export and the Preview pane too.
    const doc = parseMarkdown('# One\n\nbody text\n');
    const html = printableHtml(doc, 'T', setupWith({ includeToc: true }));

    // The needle is the element, not the class name: '.kdoc-toc' also appears in the stylesheet in the
    // <head>, which comes before the body whichever order the two halves are assembled in.
    const tocAt = html.indexOf('<nav class="kdoc-toc">');
    const bodyAt = html.indexOf('body text');
    expect(tocAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
    expect(tocAt).toBeLessThan(bodyAt);
  });

  it('leaves the contents page out when it was not asked for', () => {
    const doc = parseMarkdown('# One\n\nbody text\n');
    const html = printableHtml(doc, 'T', setupWith({ includeToc: false }));
    expect(html).not.toContain('nav class="kdoc-toc"');
    expect(html).toContain('body text');
  });

  it('carries the page rule and both stylesheets', () => {
    const doc = parseMarkdown('# One\n');
    const html = printableHtml(doc, 'T', setupWith({ footer: '{page}' }));
    expect(html).toContain('@page {');
    expect(html).toContain('counter(page)');
    expect(html).toContain('break-after: page');
  });

  it('the title reaches both the head and the running header', () => {
    const doc = parseMarkdown('# One\n');
    const html = printableHtml(doc, 'My Report', setupWith({ header: '{title}' }));
    expect(html).toContain('<title>My Report</title>');
    expect(html).toContain('"My Report"');
  });

  it('a title carrying markup is escaped in the head', () => {
    // The title comes from a filename, and a filename can contain an angle bracket.
    const doc = parseMarkdown('# One\n');
    const html = printableHtml(doc, 'A <b> & name', setupWith({}));
    // The ampersand is in the fixture deliberately: escaping only the angle brackets would leave an
    // ampersand that the parser reads as the start of an entity.
    expect(html).toContain('<title>A &lt;b&gt; &amp; name</title>');
  });
});

describe('the dialog', () => {
  it('it opens on the current setup', () => {
    const { dialog, root } = mount();
    void dialog.ask(
      setupWith({
        paper: 'Legal',
        marginMm: 7,
        header: 'H',
        includeToc: true,
      }),
    );

    const paperSelect = control<HTMLSelectElement>(root, 'select.kdoc-page-setup-paper');
    const marginInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-margin');
    const headerInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-header');
    const tocCheckbox = control<HTMLInputElement>(root, 'input.kdoc-page-setup-toc');

    expect(paperSelect.value).toBe('Legal');
    expect(marginInput.value).toBe('7');
    expect(headerInput.value).toBe('H');
    expect(tocCheckbox.checked).toBe(true);
  });

  it('Print resolves what the controls hold', async () => {
    const { dialog, root } = mount();
    const pending = dialog.ask(DEFAULT_PAGE_SETUP);

    const paperSelect = control<HTMLSelectElement>(root, 'select.kdoc-page-setup-paper');
    const orientationSelect = control<HTMLSelectElement>(root, 'select.kdoc-page-setup-orientation');
    const marginInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-margin');
    const footerInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-footer');
    const tocCheckbox = control<HTMLInputElement>(root, 'input.kdoc-page-setup-toc');

    paperSelect.value = 'A3';
    orientationSelect.value = 'landscape';
    marginInput.value = '12';
    footerInput.value = '{page}';
    tocCheckbox.checked = true;

    // Find the Print button by its text among the dialog's buttons, with a commented guard.
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    let printButton: HTMLButtonElement | null = null;
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button is defined under strict array indexing.
      if (btn !== undefined) {
        let text = '';
        // Check whether button textContent is non-null.
        if (btn.textContent !== null) {
          text = btn.textContent.trim();
        } else {
          text = '';
        }
        // Check if button text matches 'Print'.
        if (text === 'Print') {
          printButton = btn;
          break;
        } else {
          // Not the Print button: continue searching.
        }
      } else {
        // Undefined array entry.
      }
    }

    // Check with a guard that the Print button was found among dialog buttons.
    if (printButton === null) {
      throw new Error('Print button not found in dialog buttons');
    } else {
      printButton.click();
    }

    const result = await pending;
    expect(result).toEqual({
      paper: 'A3',
      orientation: 'landscape',
      marginMm: 12,
      header: '',
      footer: '{page}',
      includeToc: true,
    });
  });

  it('Cancel resolves null', async () => {
    const { dialog, root } = mount();
    const pending = dialog.ask(DEFAULT_PAGE_SETUP);

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    let cancelButton: HTMLButtonElement | null = null;
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button is defined under strict array indexing.
      if (btn !== undefined) {
        let text = '';
        // Check whether button textContent is non-null.
        if (btn.textContent !== null) {
          text = btn.textContent.trim();
        } else {
          text = '';
        }
        // Check if button text matches 'Cancel'.
        if (text === 'Cancel') {
          cancelButton = btn;
          break;
        } else {
          // Not the Cancel button: continue searching.
        }
      } else {
        // Undefined array entry.
      }
    }

    // Check with a guard that the Cancel button was found among dialog buttons.
    if (cancelButton === null) {
      throw new Error('Cancel button not found in dialog buttons');
    } else {
      cancelButton.click();
    }

    const result = await pending;
    expect(result).toBeNull();
  });

  it('Escape resolves null', async () => {
    const { dialog, root } = mount();
    const pending = dialog.ask(DEFAULT_PAGE_SETUP);

    // Escape reaches a <dialog> as its own cancel event rather than as a click.
    root.dispatchEvent(new Event('cancel'));

    const result = await pending;
    expect(result).toBeNull();
  });

  it('a typed margin outside the range is clamped', async () => {
    const { dialog, root } = mount();
    const pending = dialog.ask(DEFAULT_PAGE_SETUP);

    const marginInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-margin');
    // The browser's min/max only constrain the spinner, not what a user can type or paste.
    marginInput.value = '999';

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    let printButton: HTMLButtonElement | null = null;
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button is defined under strict array indexing.
      if (btn !== undefined) {
        let text = '';
        // Check whether button textContent is non-null.
        if (btn.textContent !== null) {
          text = btn.textContent.trim();
        } else {
          text = '';
        }
        // Check if button text matches 'Print'.
        if (text === 'Print') {
          printButton = btn;
          break;
        } else {
          // Not the Print button: continue searching.
        }
      } else {
        // Undefined array entry.
      }
    }

    // Check with a guard that the Print button was found among dialog buttons.
    if (printButton === null) {
      throw new Error('Print button not found in dialog buttons');
    } else {
      printButton.click();
    }

    const result = await pending;
    // Check if result is non-null before checking marginMm.
    if (result !== null) {
      expect(result.marginMm).toBe(MARGIN_MAX_MM);
    } else {
      expect(result).not.toBeNull();
    }
  });

  it('a non-numeric margin falls back to the one it opened on', async () => {
    const { dialog, root } = mount();
    const openedMargin = 15;
    const pending = dialog.ask(setupWith({ marginMm: openedMargin }));

    const marginInput = control<HTMLInputElement>(root, 'input.kdoc-page-setup-margin');
    marginInput.value = 'abc';

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    let printButton: HTMLButtonElement | null = null;
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button is defined under strict array indexing.
      if (btn !== undefined) {
        let text = '';
        // Check whether button textContent is non-null.
        if (btn.textContent !== null) {
          text = btn.textContent.trim();
        } else {
          text = '';
        }
        // Check if button text matches 'Print'.
        if (text === 'Print') {
          printButton = btn;
          break;
        } else {
          // Not the Print button: continue searching.
        }
      } else {
        // Undefined array entry.
      }
    }

    // Check with a guard that the Print button was found among dialog buttons.
    if (printButton === null) {
      throw new Error('Print button not found in dialog buttons');
    } else {
      printButton.click();
    }

    const result = await pending;
    // Check if result is non-null before checking marginMm.
    if (result !== null) {
      expect(result.marginMm).toBe(openedMargin);
    } else {
      expect(result).not.toBeNull();
    }
  });

  it('the token hint is shown once', () => {
    const { dialog, root } = mount();
    void dialog.ask(DEFAULT_PAGE_SETUP);

    const hints = root.querySelectorAll('.kdoc-page-setup-hint');
    expect(hints.length).toBe(1);

    const firstHint = hints[0];
    // Check if firstHint is defined under strict array indexing.
    if (firstHint !== undefined) {
      let text = '';
      // Check whether hint textContent is non-null.
      if (firstHint.textContent !== null) {
        text = firstHint.textContent;
      } else {
        text = '';
      }
      expect(text).toContain('{title}');
      expect(text).toContain('{page}');
      expect(text).toContain('{pages}');
    } else {
      expect(firstHint).toBeDefined();
    }
  });

  it('the primary button says Print', () => {
    const { dialog, root } = mount();
    void dialog.ask(DEFAULT_PAGE_SETUP);

    const primaryButton = control<HTMLButtonElement>(root, 'button.kdoc-dialog-button-primary');
    let text = '';
    // Check whether primaryButton textContent is non-null.
    if (primaryButton.textContent !== null) {
      text = primaryButton.textContent.trim();
    } else {
      text = '';
    }
    // It says what it does, because a page setup is only visible on a page.
    expect(text).toBe('Print');
    expect(text).not.toBe('OK');
  });

  it('a second ask resolves the first with null', async () => {
    const { dialog } = mount();
    const firstPending = dialog.ask(DEFAULT_PAGE_SETUP);
    const secondPending = dialog.ask(setupWith({ paper: 'Legal' }));

    const firstResult = await firstPending;
    expect(firstResult).toBeNull();

    dialog.destroy();
    const secondResult = await secondPending;
    expect(secondResult).toBeNull();
  });
});
