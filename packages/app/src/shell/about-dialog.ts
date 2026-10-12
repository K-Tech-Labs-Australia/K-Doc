/**
 * @file about-dialog.ts
 * @purpose The About K-Doc dialog: renders the K-Doc wordmark, a version line, and the
 *          K-Tech stacked lockup (brand mark above slogan) with the maker's credit.
 * @inputs Document; a `version` callback that resolves to the app version string.
 * @outputs An `AboutDialog` controller handle plus the `ABOUT_DIALOG_STYLES` stylesheet text.
 * @functions
 *   - installAboutDialog: Builds and mounts the dialog, returning its controller.
 *   - open: Shows the modal while loading the version asynchronously.
 *   - close: Hides the modal (native or jsdom fallback).
 *   - destroy: Aborts listeners and removes the dialog from the DOM.
 *   - toggleNotices: Shows or hides the bundled third-party notices, loading them on first show.
 * @dataflow version() promise -> version line text ("Version …" then "Version <v>" or "Version unknown").
 * @controlflow installAboutDialog builds markup, appends to body, wires backdrop click; open shows modal + fetches version; close hides via button/Escape/backdrop; destroy cleans up.
 * @version 2
 * @date 2026-10-07
 */

import { BRAND_SLOGAN, createBrandMark, createProductWordmark } from './brand.js';

/** Options for {@link installAboutDialog}. */
export interface AboutDialogOptions {
  /** The document the dialog is mounted into. */
  readonly doc: Document;
  /** Resolves to the app version; rejected or unavailable shows 'unknown'. */
  readonly version: () => Promise<string>;
  /** Resolves to the third-party notices text; rejected means it is not available in this build. */
  readonly notices: () => Promise<string>;
}

/** Controller handle returned by {@link installAboutDialog}. */
export interface AboutDialog {
  /** Shows the dialog. */
  open(): void;
  /** Hides the dialog. */
  close(): void;
  /** Whether the underlying <dialog> is currently shown. */
  readonly isOpen: boolean;
  /** Tears down listeners and removes the dialog from the DOM. */
  destroy(): void;
}

/**
 * Styles for the About K-Doc dialog, authored as CSS custom-property tokens only.
 * @purpose Centralizes all visual styling of the modal so markup stays presentational.
 * @outputs Raw stylesheet text consumed by a <style> element or style tag injection elsewhere.
 */
export const ABOUT_DIALOG_STYLES: string = `dialog.kdoc-about-dialog { position: fixed; top: 18vh; margin: 0 auto; border: 0; border-radius: var(--kdoc-radius-xl); background: var(--kdoc-chrome-glass-tint); color: var(--kdoc-chrome-text); padding: 28px 28px 20px; width: 380px; max-width: calc(100% - 32px); box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark); }
dialog.kdoc-about-dialog:not([open]) { display: none; }
dialog.kdoc-about-dialog::backdrop { background: var(--kdoc-chrome-shadow-deeper); }
.kdoc-about-heading { margin: 0; font-size: 34px; font-weight: 700; color: var(--kdoc-chrome-text); }
.kdoc-about-tagline { margin: 4px 0 0; font-size: 13px; color: var(--kdoc-chrome-text-muted); }
.kdoc-about-version { margin: 0; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--kdoc-chrome-text-muted); }
.kdoc-about-rule { align-self: stretch; height: 1px; margin: 12px 0 8px; background: var(--kdoc-chrome-glass-edge); }
.kdoc-about-maker { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--kdoc-chrome-text); }
.kdoc-about-credit { margin: 2px 0 0; font-size: 12px; color: var(--kdoc-chrome-text-muted); }
.kdoc-about-footer { align-self: stretch; display: flex; justify-content: flex-end; margin-top: 12px; }
.kdoc-about-notices { align-self: stretch; flex: 0 0 auto; margin: 8px 0 0; height: 40vh; overflow: auto; padding: 10px 12px; border-radius: var(--kdoc-radius-md); background: var(--kdoc-chrome-container-low); color: var(--kdoc-chrome-text); font-family: var(--kdoc-font-mono, 'Cascadia Mono', Consolas, monospace); font-size: 11px; line-height: 1.45; text-align: left; white-space: pre-wrap; }
.kdoc-about-notices[hidden] { display: none; }
.kdoc-about-notices:focus-visible { outline: 2px solid var(--kdoc-chrome-accent); outline-offset: 2px; }
.kdoc-about-footer { justify-content: space-between; }`;

/**
 * Installs the About K-Doc dialog into the given document.
 * @purpose Creates and mounts the modal, wiring backdrop-click dismissal and async version loading.
 * @inputs options.doc - Document to mount the <dialog> under; options.version - resolves the app version string.
 * @outputs An {@link AboutDialog} controller controlling open/close/destroy of the mounted dialog.
 * @dataflow Options -> DOM elements built from brand helpers + text nodes -> appended into doc.body.
 * @controlflow Create abort signal and destroyed flag -> build markup in order -> append to body -> wire backdrop click -> return controller whose methods mutate state; returns immediately after wiring completes.
 */
export function installAboutDialog(options: AboutDialogOptions): AboutDialog {
  // Shared teardown primitives created once per installation.
  const abort = new AbortController();
  let destroyed = false;

  // The modal element, labelled by the heading for assistive tech.
  const dialog = options.doc.createElement('dialog');
  dialog.className = 'kdoc-about-dialog';
  dialog.setAttribute('aria-labelledby', 'kdoc-about-heading');

  // Heading carrying the product wordmark (K-Doc).
  const heading = options.doc.createElement('h2');
  heading.id = 'kdoc-about-heading';
  heading.className = 'kdoc-about-heading';
  heading.appendChild(createProductWordmark(options.doc, '-Doc', 'K-Doc'));

  // Product tagline shown beneath the wordmark.
  const tagline = options.doc.createElement('p');
  tagline.className = 'kdoc-about-tagline';
  tagline.textContent = 'A Markdown editor that shows you the document, not the syntax.';

  // Version line placeholder updated once version() settles.
  const versionLine = options.doc.createElement('p');
  versionLine.className = 'kdoc-about-version';
  versionLine.textContent = 'Version …';

  // Visual separator between product identity and maker lockup.
  const rule = options.doc.createElement('div');
  rule.className = 'kdoc-about-rule';
  rule.setAttribute('role', 'separator');

  // Maker section: brand mark, slogan inline, credit line below.
  const maker = options.doc.createElement('div');
  maker.className = 'kdoc-about-maker';
  maker.appendChild(createBrandMark(options.doc, { heightPx: 40, label: 'K-Tech' }));

  // Slogan rendered as an inline span following the brand mark.
  const slogan = options.doc.createElement('span');
  slogan.className = 'kdoc-brand-slogan';
  slogan.textContent = BRAND_SLOGAN;
  maker.appendChild(slogan);

  // Maker credit line beneath the lockup.
  const credit = options.doc.createElement('p');
  credit.className = 'kdoc-about-credit';
  credit.textContent = '© 2026 K-Tech Labs · ktechlabs.au';
  maker.appendChild(credit);

  // Footer with a single Close button that hides the modal.
  // The notices viewer: hidden until asked for, then filled once with the bundled text.
  const noticesView = options.doc.createElement('pre');
  noticesView.className = 'kdoc-about-notices';
  noticesView.tabIndex = 0;
  noticesView.setAttribute('aria-label', 'Third-party notices');
  noticesView.hidden = true;
  let noticesLoaded = false;

  // Footer: the notices toggle on the left, Close on the right.
  const footer = options.doc.createElement('div');
  footer.className = 'kdoc-about-footer';
  const noticesButton = options.doc.createElement('button');
  noticesButton.type = 'button';
  noticesButton.className = 'kdoc-dialog-button kdoc-about-notices-button';
  noticesButton.textContent = 'Third-party notices';
  noticesButton.setAttribute('aria-expanded', 'false');
  noticesButton.addEventListener(
    'click',
    (): void => {
      toggleNotices();
    },
    { signal: abort.signal }
  );
  const closeButton = options.doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'kdoc-dialog-button kdoc-about-close';
  closeButton.textContent = 'Close';
  closeButton.addEventListener(
    'click',
    (): void => {
      // Close button pressed -> hide the modal.
      close();
    },
    { signal: abort.signal }
  );
  footer.append(noticesButton, closeButton);

  // Append children in visual order, then mount into the document body.
  dialog.append(heading, tagline, versionLine, rule, maker, noticesView, footer);
  options.doc.body.appendChild(dialog);

  // Dismiss on backdrop click: only react to direct hits on the <dialog> element itself.
  const handleBackdropClick = (event: Event): void => {
    if (event.target === dialog) {
      close();
    }
  };
  dialog.addEventListener('click', handleBackdropClick, { signal: abort.signal });

  // Guards a late version answer from an earlier open() against overwriting a newer one.
  let request = 0;

  /**
   * Shows the modal while loading the app version asynchronously.
   * @purpose Reveals the dialog and fills in the resolved version, or 'unknown' on failure.
   * @inputs None beyond captured closure state (dialog, versionLine, closeButton, options).
   * @outputs Mutates DOM: sets <dialog> open, focuses Close button, updates version line text.
   * @dataflow Captured request id -> version() promise -> resolved value or rejection -> versionLine.textContent.
   * @controlflow Guard destroyed/already-open with early returns; bump and capture request counter; set loading text; show modal (native showModal else jsdom flag); focus button; on settle, update line only if still the latest request.
   */
  /**
   * Shows or hides the third-party notices, loading the text the first time it is shown.
   * @purpose Lets the reader read every bundled licence inside K-Doc (the same text installed beside the app).
   * @inputs None beyond captured closure state (noticesView, noticesButton, options.notices).
   * @outputs Mutates DOM: the viewer's visibility and text, and the button's aria-expanded.
   * @dataflow options.notices() promise -> noticesView.textContent, or a message when the text is unavailable.
   * @controlflow Toggle visibility; on the first show, set a loading line and fill it when the promise settles.
   */
  function toggleNotices(): void {
    const show = noticesView.hidden;
    noticesView.hidden = !show;
    noticesButton.setAttribute('aria-expanded', String(show));
    // Only the first time it is shown does the text need fetching; afterwards it is already there.
    if (show && !noticesLoaded) {
      noticesLoaded = true;
      noticesView.textContent = 'Loading…';
      options.notices().then(
        (text: string): void => {
          noticesView.textContent = text;
        },
        (): void => {
          // A development build has no generated file; say how to make one rather than showing nothing.
          noticesLoaded = false;
          noticesView.textContent = 'The third-party notices are generated for release builds (npm run notices).';
        }
      );
    } else {
      // Hiding, or showing text that has already loaded: nothing to fetch.
    }
  }

  function open(): void {
    // Ignore opens after teardown to avoid resurrecting a removed dialog.
    if (destroyed) {
      return;
    }

    // Already shown: treat as idempotent no-op rather than re-showing.
    if (dialog.open) {
      return;
    }

    // Claim this open attempt so only the newest answer updates the line.
    request += 1;
    const mine = request;

    // Show a loading placeholder until version() settles.
    versionLine.textContent = 'Version …';

    // Use showModal when available, falling back to the boolean flag under jsdom.
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.open = true;
    }

    // Focus the Close button so Escape and Enter are immediately usable.
    closeButton.focus();

    // Resolve or reject: update only if this open() is still the latest request.
    options.version().then(
      (v): void => {
        if (mine === request) {
          versionLine.textContent = `Version ${v}`;
        }
      },
      (): void => {
        // Rejected or unavailable version -> show 'unknown'.
        if (mine === request) {
          versionLine.textContent = 'Version unknown';
        }
      }
    );
  }

  /**
   * Hides the modal.
   * @purpose Closes the dialog via native close() with a jsdom fallback.
   * @inputs None beyond captured closure state (dialog).
   * @outputs Mutates DOM: clears <dialog> open state.
   * @dataflow Captured request id -> nothing; only toggles dialog.open off.
   * @controlflow Guard when already closed with early return; call native close() or clear the flag under jsdom.
   */
  function close(): void {
    // Not shown: treat as idempotent no-op rather than clearing an empty state.
    if (!dialog.open) {
      return;
    }

    // Use native close() when available, falling back to clearing the flag under jsdom.
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.open = false;
    }
  }

  /**
   * Tears down all listeners and removes the dialog from the DOM.
   * @purpose Releases resources so this installation can be garbage collected.
   * @inputs None beyond captured closure state (abort, closeButton, dialog).
   * @outputs Mutates lifecycle flags; aborts event listeners; detaches <dialog>.
   * @dataflow Nothing read; sets destroyed true and disposes side effects.
   * @controlflow Set destroyed flag first so subsequent open() is ignored; abort signal to detach listeners; close modal; remove element from DOM.
   */
  function destroy(): void {
    // Mark destroyed before closing so a stray listener cannot reopen the dialog.
    destroyed = true;

    // Abort all signal-wired listeners (backdrop click, Close button).
    abort.abort();

    // Hide any still-open modal and detach it from the document.
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      // Reflects whether the underlying <dialog> is currently shown.
      return dialog.open;
    },
    destroy
  };
}
