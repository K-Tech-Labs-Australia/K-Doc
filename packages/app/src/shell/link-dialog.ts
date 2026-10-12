/**
 * @file link-dialog.ts
 * @purpose Implements LinkDialog, an accessible modal dialog using the native HTMLDialogElement for inserting and editing Markdown links, supporting manual URL entry, document heading picking, vault note search, and local file selection.
 * @inputs LinkDialogOptions containing Document context, onSubmit callback, headings provider, searchNotes query handler, and optional pickFile delegate.
 * @outputs LinkDialog controller instance exposing open, close, and destroy lifecycle methods, alongside LINK_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installLinkDialog: Constructs and mounts the native dialog element, wires source tabs (URL, Heading, Note, File), form inputs, validation, and lifecycle controls, and returns the LinkDialog controller.
 *   - slugify: Converts heading text into a GitHub-compatible anchor slug identifier for in-document fragment links.
 * @dataflow Dialog open(current) -> populate fields / query headings -> user selects source or types -> input validation -> onSubmit callback -> dialog close().
 * @controlflow Mount native dialog to document body -> configure form with source tabs, URL/Title fields, heading list, note search, file picker, and action buttons -> bind tab switching, input, and lifecycle handlers with AbortController -> return LinkDialog controller.
 * @version 4
 * @date 2026-10-04
 */

export interface LinkDialogOptions {
  readonly doc: Document;
  readonly onSubmit: (attrs: { href: string; title: string | null }) => void;
  /**
   * The headings in the document being edited, newest read at the moment the dialog opens.
   * Empty when the document has none.
   */
  readonly headings: () => readonly { readonly depth: number; readonly text: string }[];
  /**
   * Notes in the open vault matching a query, best first. Returns an empty list when no vault is
   * open, which is why the dialog asks rather than being told up front.
   */
  readonly searchNotes: (query: string) => readonly { readonly title: string; readonly relative: string }[];
  /**
   * Asks the host to pick a file from disk and resolves with a path to link to, or null. Optional:
   * a browser build has no file picker, and the button is simply not drawn when this is absent.
   */
  readonly pickFile?: () => Promise<string | null>;
}

export interface LinkDialog {
  open(current: { href: string; title: string | null } | null): void;
  close(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the link modal dialog, styling the dialog backdrop, inputs, labels,
 * inline validation errors, and action buttons using exclusively authoritative K-Doc design tokens.
 */
export const LINK_DIALOG_STYLES: string = `
dialog.kdoc-link-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 420px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-link-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-link-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-dialog-heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.kdoc-dialog-button {
  min-width: 64px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-dialog-button:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
}

.kdoc-dialog-button.kdoc-dialog-button-primary,
.kdoc-dialog-button.kdoc-dialog-button-save,
.kdoc-dialog-button.kdoc-dialog-apply {
  border-color: var(--kdoc-chrome-accent);
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
}

.kdoc-dialog-button.kdoc-dialog-button-primary:hover,
.kdoc-dialog-button.kdoc-dialog-button-save:hover,
.kdoc-dialog-button.kdoc-dialog-apply:hover,
.kdoc-dialog-button.kdoc-dialog-button-primary:active,
.kdoc-dialog-button.kdoc-dialog-button-save:active,
.kdoc-dialog-button.kdoc-dialog-apply:active {
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 88%, var(--kdoc-chrome-text));
}

.kdoc-dialog-button.kdoc-dialog-button-primary:disabled,
.kdoc-dialog-button.kdoc-dialog-apply:disabled {
  border-color: var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-button.kdoc-dialog-button-discard {
  color: var(--kdoc-emissive-red);
}

.kdoc-link-sources {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-link-source {
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-link-source:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-link-source:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-link-source[aria-selected="true"],
.kdoc-link-source.selected {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-link-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-link-body[hidden] {
  display: none;
}

.kdoc-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kdoc-dialog-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-input {
  min-height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
}

.kdoc-dialog-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-link-search {
  min-height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
}

.kdoc-link-search:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-link-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  border: 0;
  border-radius: var(--kdoc-radius-md);
  padding: 4px;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
}

.kdoc-link-results:empty {
  display: none;
}

.kdoc-link-heading {
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  width: 100%;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-link-heading:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-link-heading:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-link-heading:active,
.kdoc-link-heading.active,
.kdoc-link-heading[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-link-note {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  width: 100%;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-link-note:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-link-note:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-link-note:active,
.kdoc-link-note.active,
.kdoc-link-note[aria-selected="true"] {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-link-note-path {
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-link-empty {
  font-size: 12px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px;
  text-align: center;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-link-pick {
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
  padding: 4px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-sizing: border-box;
  align-self: flex-start;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-link-pick:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-link-pick:active,
.kdoc-link-pick[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
}

.kdoc-link-pick:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-link-pick:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-error {
  color: var(--kdoc-emissive-red);
  font-size: 12px;
  min-height: 16px;
}

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-link-results::-webkit-scrollbar {
  width: 8px;
}

.kdoc-link-results::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-link-results::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-link-dialog,
  dialog.kdoc-link-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Debounce interval in milliseconds for note search queries.
 * A vault search runs over every note, and running it on every keystroke of a long word is work nobody asked for.
 */
const SEARCH_DEBOUNCE_MS: number = 120;

/** Indentation step in pixels per heading depth level beyond the first level. */
const HEADING_INDENT_STEP_PX: number = 12;

/**
 * Converts heading text into a GitHub-compatible anchor slug identifier for in-document fragment links.
 *
 * @purpose Normalizes heading text into a sanitized URL fragment slug suitable for Markdown anchor targets.
 * @inputs text - The raw heading text string to be converted into a URL fragment slug.
 * @outputs string - The formatted slug string with letters, digits, and single hyphens.
 * @dataflow text -> toLowerCase() -> trim() -> replace non-alphanumeric with hyphen -> strip outer hyphens -> slug.
 * @controlflow Convert text to lowercase and trim whitespace -> replace runs of non-alphanumeric characters with single hyphen -> strip leading and trailing hyphens -> return normalized slug.
 */
function slugify(text: string): string {
  // Convert heading text to lowercase and trim leading and trailing whitespace.
  const lower = text.toLowerCase().trim();

  // Punctuation is DROPPED, not turned into a hyphen. This is what GitHub and every Markdown
  // renderer that follows it actually do: "What's New in 2.0?" becomes "whats-new-in-20", not
  // "what-s-new-in-2-0". The difference is the whole point of the feature -- a heading link that
  // does not match the anchor the renderer emits is a broken link, which is worse than no picker.
  const withoutPunctuation = lower.replace(/[^\p{L}\p{N} _-]+/gu, '');

  // Runs of whitespace become a single hyphen. Existing hyphens are left alone, again matching
  // what the renderers do.
  const hyphenated = withoutPunctuation.replace(/\s+/g, '-');

  // Strip leading and trailing hyphens.
  const stripped = hyphenated.replace(/^-+|-+$/g, '');
  return stripped;
}

/** Possible link source tab views available in the link modal dialog. */
export type LinkSource = 'url' | 'heading' | 'note' | 'file';

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple dialog instances. */
let nextDialogId: number = 0;

/**
 * Installs the modal link dialog into the document body, wiring form validation and submission callbacks.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for configuring link destination and title attributes.
 * @inputs options - LinkDialogOptions containing the document context and onSubmit callback.
 * @outputs LinkDialog - Controller exposing open, close, and destroy lifecycle methods.
 * @dataflow options -> dialog DOM hierarchy -> form submit events -> onSubmit callback invocation.
 * @controlflow Create dialog and form hierarchy -> bind submission, cancellation, and input events -> append dialog to document body -> return LinkDialog controller.
 */
export function installLinkDialog(options: LinkDialogOptions): LinkDialog {
  const doc = options.doc;
  const dialogId = ++nextDialogId;
  const urlId = `kdoc-link-url-${dialogId}`;
  const titleId = `kdoc-link-title-${dialogId}`;

  let destroyed: boolean = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Single AbortController owns every listener so destroy() can detach them all at once via { signal }.
  const controller = new AbortController();
  const { signal } = controller;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-link-dialog';

  // Construct form container with novalidate to allow custom accessible inline error alerts.
  const form = doc.createElement('form');
  form.className = 'kdoc-link-dialog-form';
  form.setAttribute('novalidate', 'true');

  const heading = doc.createElement('h3');
  heading.className = 'kdoc-dialog-heading';
  heading.textContent = 'Link Details';
  form.appendChild(heading);

  // Source picker tablist container above the URL field.
  const tabList = doc.createElement('div');
  tabList.className = 'kdoc-link-sources';
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Link source');

  // Tab 1: URL (always)
  const urlTab = doc.createElement('button');
  urlTab.type = 'button';
  urlTab.className = 'kdoc-link-source';
  urlTab.setAttribute('role', 'tab');
  urlTab.setAttribute('aria-selected', 'true');
  urlTab.textContent = 'URL';
  tabList.appendChild(urlTab);

  // Tab 2: Heading (always)
  const headingTab = doc.createElement('button');
  headingTab.type = 'button';
  headingTab.className = 'kdoc-link-source';
  headingTab.setAttribute('role', 'tab');
  headingTab.setAttribute('aria-selected', 'false');
  headingTab.textContent = 'Heading';
  tabList.appendChild(headingTab);

  // Tab 3: Note (always)
  const noteTab = doc.createElement('button');
  noteTab.type = 'button';
  noteTab.className = 'kdoc-link-source';
  noteTab.setAttribute('role', 'tab');
  noteTab.setAttribute('aria-selected', 'false');
  noteTab.textContent = 'Note';
  tabList.appendChild(noteTab);

  // Source Body 1: URL view container
  const urlBody = doc.createElement('div');
  urlBody.className = 'kdoc-link-body';
  urlBody.setAttribute('role', 'tabpanel');

  // Field 1: Link Address (URL)
  const urlField = doc.createElement('div');
  urlField.className = 'kdoc-dialog-field';

  const urlLabel = doc.createElement('label');
  urlLabel.htmlFor = urlId;
  urlLabel.textContent = 'Link address';
  urlField.appendChild(urlLabel);

  const urlInput = doc.createElement('input');
  urlInput.id = urlId;
  urlInput.type = 'url';
  urlInput.className = 'kdoc-dialog-input';
  urlInput.setAttribute('autocomplete', 'off');
  urlInput.setAttribute('spellcheck', 'false');
  urlField.appendChild(urlInput);

  urlBody.appendChild(urlField);

  // Field 2: Title (optional)
  const titleField = doc.createElement('div');
  titleField.className = 'kdoc-dialog-field';

  const titleLabel = doc.createElement('label');
  titleLabel.htmlFor = titleId;
  titleLabel.textContent = 'Title (optional)';
  titleField.appendChild(titleLabel);

  const titleInput = doc.createElement('input');
  titleInput.id = titleId;
  titleInput.type = 'text';
  titleInput.className = 'kdoc-dialog-input';
  titleInput.setAttribute('autocomplete', 'off');
  titleField.appendChild(titleInput);

  urlBody.appendChild(titleField);

  // Source Body 2: Heading view container
  const headingBody = doc.createElement('div');
  headingBody.className = 'kdoc-link-body';
  headingBody.setAttribute('role', 'tabpanel');
  headingBody.hidden = true;

  // Source Body 3: Note view container
  const noteBody = doc.createElement('div');
  noteBody.className = 'kdoc-link-body';
  noteBody.setAttribute('role', 'tabpanel');
  noteBody.hidden = true;

  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'kdoc-dialog-input kdoc-link-search';
  searchInput.placeholder = 'Search notes…';
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchInput.setAttribute('aria-label', 'Search notes');
  noteBody.appendChild(searchInput);

  const noteResultsContainer = doc.createElement('div');
  noteResultsContainer.className = 'kdoc-link-results';
  noteResultsContainer.hidden = true;
  noteBody.appendChild(noteResultsContainer);

  // Tab 4 & Source Body 4: File… (only when options.pickFile is provided)
  const pickFile = options.pickFile;
  let fileTab: HTMLButtonElement | null = null;
  let fileBody: HTMLElement | null = null;

  // Check if a file picker delegate was provided by the host.
  if (pickFile !== undefined) {
    fileTab = doc.createElement('button');
    fileTab.type = 'button';
    fileTab.className = 'kdoc-link-source';
    fileTab.setAttribute('role', 'tab');
    fileTab.setAttribute('aria-selected', 'false');
    fileTab.textContent = 'File…';
    tabList.appendChild(fileTab);

    fileBody = doc.createElement('div');
    fileBody.className = 'kdoc-link-body';
    fileBody.setAttribute('role', 'tabpanel');
    fileBody.hidden = true;

    const pickButton = doc.createElement('button');
    pickButton.type = 'button';
    pickButton.className = 'kdoc-link-pick';
    pickButton.textContent = 'Choose a file…';

    pickButton.addEventListener('click', (): void => {
      // Check if the component has been destroyed.
      if (destroyed) {
        // Dialog already destroyed: ignore click.
        return;
      } else {
        // Dialog active: proceed with picking file.
      }

      // Guard the async call so a rejection cannot escape: wrap in try/catch and leave the field alone on a failure.
      void (async (): Promise<void> => {
        try {
          const picked = await pickFile();
          // Check if dialog was destroyed during async picker invocation.
          if (destroyed) {
            // Destroyed during round-trip: do not touch DOM.
            return;
          } else {
            // Active dialog: process picker result.
          }

          // Check if the user selected a valid file path.
          if (typeof picked === 'string') {
            // When the result is a string it sets the URL field and switches back to URL.
            urlInput.value = picked;
            // Check if error alert is currently visible.
            if (!errorAlert.hidden) {
              errorAlert.textContent = '';
              errorAlert.hidden = true;
            } else {
              // Error alert already hidden.
            }
            switchSource('url');
          } else {
            // When it is null it does nothing: a cancelled picker is not an error.
          }
        } catch {
          // Rejection occurred: leave the field alone on a failure so the dialog remains stable and usable.
        }
      })();
    }, { signal });

    fileBody.appendChild(pickButton);

    fileTab.addEventListener('click', (): void => {
      switchSource('file');
    }, { signal });
  } else {
    // No pickFile option provided: File tab and panel are omitted.
  }

  // Append source picker tablist above the URL field.
  form.appendChild(tabList);
  form.appendChild(urlBody);
  form.appendChild(headingBody);
  form.appendChild(noteBody);
  // Check if file body container exists.
  if (fileBody !== null) {
    form.appendChild(fileBody);
  } else {
    // File body not present.
  }

  // Inline error alert region for validation failures.
  const errorAlert = doc.createElement('div');
  errorAlert.className = 'kdoc-dialog-error';
  errorAlert.setAttribute('role', 'alert');
  errorAlert.hidden = true;
  form.appendChild(errorAlert);

  // Form action buttons (Cancel and Apply)
  const actions = doc.createElement('div');
  actions.className = 'kdoc-dialog-actions';

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button kdoc-dialog-cancel';
  cancelButton.addEventListener('click', (): void => {
    close();
  }, { signal });
  actions.appendChild(cancelButton);

  const applyButton = doc.createElement('button');
  applyButton.type = 'submit';
  applyButton.textContent = 'Apply';
  applyButton.className = 'kdoc-dialog-button kdoc-dialog-apply';
  actions.appendChild(applyButton);

  form.appendChild(actions);
  dialog.appendChild(form);

  // Clear validation error when user edits the URL input.
  urlInput.addEventListener('input', (): void => {
    // Check if error message is currently displayed.
    if (!errorAlert.hidden) {
      errorAlert.textContent = '';
      errorAlert.hidden = true;
    } else {
      // Error message is already cleared.
    }
  }, { signal });

  // Handle native Escape key dismiss event.
  dialog.addEventListener('cancel', (event: Event): void => {
    event.preventDefault();
    close();
  }, { signal });

  // Handle form submission.
  form.addEventListener('submit', (event: SubmitEvent | Event): void => {
    event.preventDefault();

    const trimmedHref = urlInput.value.trim();
    // Check if the link address input is empty.
    if (trimmedHref === '') {
      // Empty URL: display inline error in role="alert" container and keep dialog open.
      errorAlert.textContent = 'Please enter a link address.';
      errorAlert.hidden = false;
      urlInput.focus();
      return;
    } else {
      // Non-empty link address: clear error message.
      errorAlert.textContent = '';
      errorAlert.hidden = true;
    }

    const rawTitle = titleInput.value.trim();
    // Check whether an optional title was provided.
    let resolvedTitle: string | null;
    if (rawTitle === '') {
      // Empty title: resolve to null.
      resolvedTitle = null;
    } else {
      // Non-empty title: resolve to trimmed string.
      resolvedTitle = rawTitle;
    }

    // Close BEFORE notifying the host, not after. A native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so a close() running after onSubmit silently undoes the host's
    // own focus call — which left focus on the Link toolbar button and made the next shortcut do nothing.
    // The host's focus call has to be the last thing that runs.
    close();

    options.onSubmit({
      href: trimmedHref,
      title: resolvedTitle,
    });
  }, { signal });

  // Mount the dialog into the document body.
  options.doc.body.appendChild(dialog);

  /**
   * Switches the active link source tab and activates the corresponding source body.
   *
   * @purpose Coordinates source tab selection states and toggles visibility of the corresponding content panel.
   * @inputs source - The LinkSource ('url' | 'heading' | 'note' | 'file') to activate.
   * @outputs void.
   * @dataflow source -> aria-selected updates on tabs -> hidden toggles on panels -> focus adjustments.
   * @controlflow Set tab aria-selected attributes -> toggle hidden properties on source panels -> if heading rebuild headings -> if url focus and select url input.
   */
  function switchSource(source: LinkSource): void {
    // Update tab selection states.
    urlTab.setAttribute('aria-selected', source === 'url' ? 'true' : 'false');
    headingTab.setAttribute('aria-selected', source === 'heading' ? 'true' : 'false');
    noteTab.setAttribute('aria-selected', source === 'note' ? 'true' : 'false');
    // Check if the optional File tab is present.
    if (fileTab !== null) {
      fileTab.setAttribute('aria-selected', source === 'file' ? 'true' : 'false');
    } else {
      // File tab is absent when pickFile is not configured.
    }

    // Toggle visibility of each source body.
    urlBody.hidden = source !== 'url';
    headingBody.hidden = source !== 'heading';
    noteBody.hidden = source !== 'note';
    // Check if the optional File body is present.
    if (fileBody !== null) {
      fileBody.hidden = source !== 'file';
    } else {
      // File body is absent.
    }

    // Check which source tab is being activated.
    if (source === 'heading') {
      // Rebuild document headings and display heading picker.
      rebuildHeadings();
    } else if (source === 'note') {
      // Note source active: focus search input.
      searchInput.focus();
    } else if (source === 'url') {
      // URL source active: focus and select link address input.
      urlInput.focus();
      urlInput.select();
    } else {
      // File source active: focus choose file button if present.
      if (fileBody !== null) {
        const pickBtn = fileBody.querySelector<HTMLButtonElement>('button.kdoc-link-pick');
        // Check if pick button is found.
        if (pickBtn !== null) {
          pickBtn.focus();
        } else {
          // Pick button not found in DOM.
        }
      } else {
        // File body not present.
      }
    }
  }

  // Wire tab click event listeners.
  urlTab.addEventListener('click', (): void => {
    switchSource('url');
  }, { signal });

  headingTab.addEventListener('click', (): void => {
    switchSource('heading');
  }, { signal });

  noteTab.addEventListener('click', (): void => {
    switchSource('note');
  }, { signal });

  /**
   * Rebuilds the document heading list in the heading source view.
   *
   * @purpose Reads current document headings via options.headings() and renders interactive picker buttons.
   * @inputs void.
   * @outputs void.
   * @dataflow options.headings() -> empty check -> construct button elements with indentation -> append to headingBody.
   * @controlflow Clear existing heading DOM content -> fetch headings -> if empty render empty message -> else iterate and append button per heading with depth-based paddingLeft.
   */
  function rebuildHeadings(): void {
    headingBody.textContent = '';

    const rawHeadings = typeof options.headings === 'function' ? options.headings() : [];

    // Check if the document contains any headings.
    if (rawHeadings.length === 0) {
      // When there are no headings, render a single non-interactive line reading This document has no headings. in a kdoc-link-empty class.
      // Comment: an empty list with no explanation looks broken.
      const emptyEl = doc.createElement('div');
      emptyEl.className = 'kdoc-link-empty';
      emptyEl.textContent = 'This document has no headings.';
      headingBody.appendChild(emptyEl);
    } else {
      // Headings present: render scrolling list with interactive button per heading.
      const resultsContainer = doc.createElement('div');
      resultsContainer.className = 'kdoc-link-results';

      // Iterate over headings and create an interactive button for each heading.
      for (const h of rawHeadings) {
        const headingButton = doc.createElement('button');
        headingButton.type = 'button';
        headingButton.className = 'kdoc-link-heading';
        headingButton.textContent = h.text;
        // Its text indented by (depth - 1) * 12 pixels via style.paddingLeft, showing the heading's text.
        headingButton.style.paddingLeft = `${Math.max(0, h.depth - 1) * HEADING_INDENT_STEP_PX}px`;

        headingButton.addEventListener('click', (): void => {
          // Clicking one sets the URL field to '#' + slugify(text) and switches back to the URL source so the user can see what they are about to apply.
          // Comment: the dialog's job is to fill the field, not to bypass it — a picker that applied straight away would give no chance to add a title or correct the target.
          urlInput.value = '#' + slugify(h.text);
          // Check if error alert is currently visible.
          if (!errorAlert.hidden) {
            errorAlert.textContent = '';
            errorAlert.hidden = true;
          } else {
            // Error alert is already hidden.
          }
          switchSource('url');
        }, { signal });

        resultsContainer.appendChild(headingButton);
      }

      headingBody.appendChild(resultsContainer);
    }
  }

  /**
   * Clears the note search input, results container, and any pending search debounce timer.
   *
   * @purpose Resets the note search interface to an empty state when opening the dialog.
   * @inputs void.
   * @outputs void.
   * @dataflow Clear searchTimer -> reset searchInput.value -> empty noteResultsContainer.
   * @controlflow Check and clear debounce timer -> clear search input value -> empty results container textContent and set hidden.
   */
  function clearNoteSearch(): void {
    // Check if an active debounce timer is pending.
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    } else {
      // No active debounce timer.
    }

    searchInput.value = '';
    noteResultsContainer.textContent = '';
    noteResultsContainer.hidden = true;
  }

  /**
   * Executes a vault note search for the given query and renders the resulting note buttons.
   *
   * @purpose Queries matching notes in the vault and populates the results container with selectable note items.
   * @inputs query - The search query string entered by the user.
   * @outputs void.
   * @dataflow query -> trim -> options.searchNotes() -> construct DOM elements -> append to noteResultsContainer.
   * @controlflow Trim query -> if empty show nothing and return -> query searchNotes -> if no results render empty message -> else render note buttons with title and relative path.
   */
  function executeNoteSearch(query: string): void {
    const trimmed = query.trim();
    noteResultsContainer.textContent = '';

    // Check if the query is empty.
    if (trimmed === '') {
      // When the query is empty, show nothing rather than every note — an unconstrained vault listing is overwhelming.
      noteResultsContainer.hidden = true;
      return;
    } else {
      // Query is non-empty: display results container and query vault notes.
      noteResultsContainer.hidden = false;
    }

    // Safely query matching notes from options provider.
    const results = typeof options.searchNotes === 'function' ? options.searchNotes(trimmed) : [];

    // Check if any notes match the query.
    if (results.length === 0) {
      // When it is not empty and there are no results, show No notes match. in the kdoc-link-empty class.
      const emptyEl = doc.createElement('div');
      emptyEl.className = 'kdoc-link-empty';
      emptyEl.textContent = 'No notes match.';
      noteResultsContainer.appendChild(emptyEl);
    } else {
      // Matching notes found: render interactive buttons for each note.
      // Iterate over matching vault notes and render an interactive button for each note.
      for (const note of results) {
        const noteBtn = doc.createElement('button');
        noteBtn.type = 'button';
        noteBtn.className = 'kdoc-link-note';

        const titleEl = doc.createElement('span');
        titleEl.textContent = note.title;
        noteBtn.appendChild(titleEl);

        const pathEl = doc.createElement('span');
        pathEl.className = 'kdoc-link-note-path';
        pathEl.textContent = note.relative;
        noteBtn.appendChild(pathEl);

        noteBtn.addEventListener('click', (): void => {
          urlInput.value = note.relative;
          // Check if error alert is currently visible.
          if (!errorAlert.hidden) {
            errorAlert.textContent = '';
            errorAlert.hidden = true;
          } else {
            // Error alert is already hidden.
          }
          switchSource('url');
        }, { signal });

        noteResultsContainer.appendChild(noteBtn);
      }
    }
  }

  // Handle live debounced search on note search input.
  searchInput.addEventListener('input', (): void => {
    // Check if an existing debounce timer is running.
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    } else {
      // No active debounce timer.
    }

    // Debounce the search by SEARCH_DEBOUNCE_MS = 120.
    // A vault search runs over every note, and running it on every keystroke of a long word is work nobody asked for.
    searchTimer = setTimeout((): void => {
      searchTimer = null;
      executeNoteSearch(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  }, { signal });

  // Prevent form submission when pressing Enter inside the note search input.
  searchInput.addEventListener('keydown', (event: KeyboardEvent): void => {
    // Check if Enter key was pressed in search input.
    if (event.key === 'Enter') {
      // Prevent submitting the outer form when pressing Enter in search field.
      event.preventDefault();
    } else {
      // Non-Enter key: allow default event handling.
    }
  }, { signal });

  /**
   * Opens the link dialog, populating inputs with existing link attributes or clearing them for a new link.
   *
   * @purpose Displays the modal dialog, initializes form inputs, clears validation errors, and focuses the URL field.
   * @inputs current - Existing LinkAttrs if editing an active link, or null if creating a new link.
   * @outputs void.
   * @dataflow current -> urlInput.value & titleInput.value -> showModal() -> urlInput.focus() & urlInput.select().
   * @controlflow Check destroyed guard -> clear error message -> populate or clear input fields -> invoke showModal with fallback -> focus and select URL input.
   */
  function open(current: { href: string; title: string | null } | null): void {
    // Check if the link dialog has already been destroyed.
    if (destroyed) {
      // Component is destroyed: do not open.
      return;
    } else {
      // Component is active: proceed to open dialog.
    }

    // Reset inline error alert on opening.
    errorAlert.textContent = '';
    errorAlert.hidden = true;

    // Check whether existing link attributes were provided for editing.
    if (current !== null) {
      // Existing link attributes provided: pre-fill input fields.
      urlInput.value = current.href;
      // Check whether a title string exists on the current link.
      if (current.title !== null) {
        // Title present: populate title input.
        titleInput.value = current.title;
      } else {
        // Title absent: clear title input.
        titleInput.value = '';
      }
    } else {
      // New link creation: initialize inputs with empty strings.
      urlInput.value = '';
      titleInput.value = '';
    }

    // open(current) must rebuild the heading list and clear the note search each time, so a dialog opened twice never shows the first document's headings.
    rebuildHeadings();
    clearNoteSearch();

    // The default is URL, unless the dialog was opened on an existing link whose href starts with #, in which case it opens on Heading — comment that: editing a link to a heading should show you the headings, not make you find the tab first.
    if (current !== null && current.href.startsWith('#')) {
      // Editing a link to a heading should show you the headings, not make you find the tab first.
      switchSource('heading');
    } else {
      // Default to URL source view for new links or standard web URLs.
      switchSource('url');
    }

    // Check if the dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog is already open: skip showModal invocation.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Check whether dialog opened on Heading source tab.
    if (current !== null && current.href.startsWith('#')) {
      // Heading tab active: focus first heading button if available, or heading tab button.
      const firstHeading = headingBody.querySelector<HTMLButtonElement>('button.kdoc-link-heading');
      // Check if a heading button exists in the document.
      if (firstHeading !== null) {
        firstHeading.focus();
      } else {
        headingTab.focus();
      }
    } else {
      // URL tab active: focus URL input and select all text to allow immediate replacement.
      urlInput.focus();
      urlInput.select();
    }
  }

  /**
   * Closes the link modal dialog, clearing validation errors.
   *
   * @purpose Dismisses the modal dialog and cleans up temporary form state in an idempotent manner.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false -> errorAlert cleanup.
   * @controlflow Check destroyed guard -> check if dialog is currently open -> invoke native close() or set open = false -> clear error alert.
   */
  function close(): void {
    // Check if the dialog has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    // Check if the dialog element is currently open.
    if (dialog.open) {
      // Check if the native close() method is supported.
      if (typeof dialog.close === 'function') {
        // Close via native HTMLDialogElement API.
        dialog.close();
      } else {
        // Fallback for test environments: set open attribute to false.
        dialog.open = false;
      }
    } else {
      // Dialog is already closed: no operation required.
    }

    // Clear validation error message upon closing.
    errorAlert.textContent = '';
    errorAlert.hidden = true;
  }

  /**
   * Destroys the link dialog component, closing the modal and removing the dialog DOM node.
   *
   * @purpose Idempotently cleans up event listeners and removes the dialog element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow close() -> dialog.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> close dialog -> remove dialog from DOM.
   */
  function destroy(): void {
    // Check if the dialog has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active dialog: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    // Check if an active note search debounce timer is running.
    if (searchTimer !== null) {
      // Clear pending search timer.
      clearTimeout(searchTimer);
      searchTimer = null;
    } else {
      // No active search timer.
    }

    // Abort controller to detach all event listeners registered with { signal }.
    controller.abort();
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    destroy,
  };
}
