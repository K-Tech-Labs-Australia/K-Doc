/**
 * @file snippets-dialog.ts
 * @purpose The Snippets dialog (FR-7.10): lists the user's snippets and lets them add, change, remove and restore snippets, publishing each valid change.
 * @inputs live snippets getter, default snippets, change callback, DOM events
 * @outputs a dialog controller and SNIPPETS_DIALOG_STYLES
 * @functions installSnippetsDialog: builds and returns the Snippets dialog controller; el/button/textArea: element factory helpers; say/publish/renderRow/draw/add/open/close/destroy: dialog behavior.
 * @dataflow settings snippets -> rows; edits -> validation -> onChange(next) -> redraw from the getter.
 * @controlflow build once; each event validates and either publishes or reports why not.
 * @version 3
 * @date 2026-10-04
 */
import { isValidSnippetBody, isValidSnippetPrefix, MAX_SNIPPET_BODY_LENGTH, MAX_SNIPPET_PREFIX_LENGTH } from '@k-doc/config';

export interface SnippetsDialogOptions {
  readonly doc: Document;
  readonly snippets: () => Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
  readonly onChange: (next: Readonly<Record<string, string>>) => void;
}

export interface SnippetsDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

export const SNIPPETS_DIALOG_STYLES: string = `
dialog.kdoc-snippets-dialog {
  width: min(680px, 94vw);
  max-height: 86vh;
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
  overflow: hidden;
}

dialog.kdoc-snippets-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-snippets-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  max-height: 86vh;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-lg);
}

.kdoc-snippets-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-snippets-hint {
  margin: 0;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-snippets-row,
.kdoc-snippets-add {
  display: grid;
  grid-template-columns: minmax(6em, 10em) 1fr 5.5em;
  gap: 8px;
  align-items: start;
}

.kdoc-snippets-add {
  padding: 8px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-snippets-row {
  padding: 6px 8px;
  border-radius: var(--kdoc-radius-sm);
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-snippets-input,
.kdoc-snippets-text {
  min-width: 0;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  font: inherit;
}

.kdoc-snippets-text {
  font-family: var(--kdoc-mono-font, monospace);
  font-size: 13px;
  min-height: 3.5em;
  resize: vertical;
}

.kdoc-snippets-prefix {
  font-family: var(--kdoc-mono-font, monospace);
  font-size: 13px;
  padding-top: 5px;
  overflow-wrap: anywhere;
  color: var(--kdoc-chrome-text);
}

.kdoc-snippets-button {
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-snippets-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-snippets-button:active,
.kdoc-snippets-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-snippets-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-snippets-input:focus-visible,
.kdoc-snippets-text:focus-visible,
.kdoc-snippets-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-snippets-status {
  min-height: 18px;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-snippets-status[data-state="warning"] {
  color: var(--kdoc-emissive-red);
}

.kdoc-snippets-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--kdoc-radius-md);
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-snippets-empty {
  padding: 8px 4px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-snippets-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-snippets-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-snippets-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-snippets-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-snippets-dialog,
  dialog.kdoc-snippets-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

const PREFIX_RULE = `A prefix must be 1 to ${MAX_SNIPPET_PREFIX_LENGTH} characters with no spaces.`;
const BODY_RULE = `A snippet body must be 1 to ${MAX_SNIPPET_BODY_LENGTH} characters.`;

export function installSnippetsDialog(options: SnippetsDialogOptions): SnippetsDialog {
  const { doc } = options;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let destroyed = false;
  let rowsAbort: AbortController | null = null;

  // Creates a typed element with a class name and optional text content.
  // @purpose Constructs an HTMLElement of the given tag with its className and textContent set.
  // @inputs tag - Tag name from HTMLElementTagNameMap; className - CSS class to apply; text - optional initial text (default '').
  // @outputs An element of type K with the class and text applied.
  // @dataflow tag + className + text → createElement → assigned properties → returned element.
  // @controlflow No branching: create, assign, return.
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string = ''): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  // Creates a labeled button with an accessible name and type="button".
  // @purpose Builds a button element carrying visible text plus an aria-label for accessibility.
  // @inputs text - Visible label; label - Accessible description for screen readers.
  // @outputs A configured HTMLButtonElement.
  // @dataflow text + label → el('button') → type and aria-label assigned → returned button.
  // @controlflow No branching: create, assign, return.
  function button(text: string, label: string): HTMLButtonElement {
    const b = el('button', 'kdoc-snippets-button', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  // Creates a body textarea constrained to the maximum snippet body length.
  // @purpose Builds a labeled textarea with placeholder, max length, and row count for editing a snippet body.
  // @inputs label - Accessible name; placeholder - Placeholder hint text.
  // @outputs A configured HTMLTextAreaElement.
  // @dataflow label + placeholder → el('textarea') → aria-label, placeholder, maxLength, rows assigned → returned area.
  // @controlflow No branching: create, assign, return.
  function textArea(label: string, placeholder: string): HTMLTextAreaElement {
    const area = el('textarea', 'kdoc-snippets-text');
    area.setAttribute('aria-label', label);
    area.placeholder = placeholder;
    area.maxLength = MAX_SNIPPET_BODY_LENGTH;
    area.rows = 3;
    return area;
  }

  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-snippets-dialog';
  dialog.setAttribute('aria-labelledby', 'kdoc-snippets-heading');
  const body = el('div', 'kdoc-snippets-body');
  const heading = el('h2', 'kdoc-snippets-heading', 'Snippets');
  heading.id = 'kdoc-snippets-heading';
  const hint = el('p', 'kdoc-snippets-hint', 'Type a prefix and press Tab. In a body, ${1:text} is a placeholder, $0 is where the cursor ends, and $DATE and $TIME fill themselves in.');
  const addRow = el('div', 'kdoc-snippets-add');
  const prefixInput = el('input', 'kdoc-snippets-input');
  prefixInput.type = 'text';
  prefixInput.setAttribute('aria-label', 'Prefix');
  prefixInput.placeholder = 'Prefix';
  prefixInput.maxLength = MAX_SNIPPET_PREFIX_LENGTH;
  const bodyInput = textArea('Body', 'Body…');
  const addButton = button('Add', 'Add snippet');
  addRow.append(prefixInput, bodyInput, addButton);
  const status = el('div', 'kdoc-snippets-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = el('div', 'kdoc-snippets-list');
  list.setAttribute('role', 'list');
  const footer = el('div', 'kdoc-snippets-footer');
  const restoreButton = button('Restore Defaults', 'Restore the default snippets');
  const closeButton = button('Close', 'Close');
  footer.append(restoreButton, closeButton);
  body.append(heading, hint, addRow, status, list, footer);
  dialog.append(body);
  doc.body.append(dialog);

  // Sets the live status region's message and warning state.
  // @purpose Writes a one-line status message to the aria-live region and toggles its warning styling.
  // @inputs text - Message to display; warning - Whether to mark the message as an error/warning.
  // @outputs void (mutates the status element).
  // @dataflow text + warning → status.textContent → data-state attribute set or removed.
  // @controlflow Branch on warning: set data-state="warning" when true, remove it otherwise.
  function say(text: string, warning: boolean): void {
    status.textContent = text;
    if (warning) {
      // Warning requested: mark the status as an error so it renders in the danger color.
      status.setAttribute('data-state', 'warning');
    } else {
      // Normal message: clear any previous warning styling.
      status.removeAttribute('data-state');
    }
  }

  // Stores accepted edits and redraws from the live snippets so the dialog never shows what the app did not accept.
  // @purpose Persists a new snippet map via the change callback, then rebuilds rows from the getter.
  // @inputs next - The full next snippet map to publish.
  // @outputs void (side effects: onChange call and redraw).
  // @dataflow next → options.onChange(next) → draw() reads options.snippets() fresh.
  // @controlflow No branching: publish, then redraw.
  function publish(next: Readonly<Record<string, string>>): void {
    options.onChange(next);
    draw();
  }

  // Builds a single editable snippet row; a body is committed on change (when the field loses focus), an invalid one is put back and explained.
  // @purpose Renders a prefix label, a body textarea, and a remove button wired to validation-driven edits.
  // @inputs prefix - The snippet key displayed as the name; value - Current body text; rowSignal - Abort signal scoping this row's listeners.
  // @outputs A listitem element containing the row controls.
  // @dataflow prefix + value → row with name, textarea (value), remove button → change/remove listeners capture edits.
  // @controlflow No branching at build time; each listener branches on validation when fired.
  function renderRow(prefix: string, value: string, rowSignal: AbortSignal): HTMLElement {
    const row = el('div', 'kdoc-snippets-row');
    row.setAttribute('role', 'listitem');
    row.dataset['prefix'] = prefix;
    const name = el('span', 'kdoc-snippets-prefix', prefix);
    const area = textArea(`Body of ${prefix}`, 'Body…');
    area.value = value;
    let committed = value;
    const remove = button('Remove', `Remove the snippet ${prefix}`);
    area.addEventListener('change', () => {
      if (isValidSnippetBody(area.value)) {
        // Valid body: commit it without redrawing, since change fires as focus leaves (Tab) and a redraw would drop the focus.
        options.onChange({ ...options.snippets(), [prefix]: area.value });
        committed = area.value;
        say(`Changed the snippet ${prefix}.`, false);
      } else {
        // Invalid body: revert the field to its last committed value and explain the rule.
        area.value = committed;
        say(BODY_RULE, true);
      }
    }, { signal: rowSignal });
    remove.addEventListener('click', () => {
      const next: Record<string, string> = { ...options.snippets() };
      delete next[prefix];
      publish(next);
      say(`Removed the snippet ${prefix}.`, false);
    }, { signal: rowSignal });
    row.append(name, area, remove);
    return row;
  }

  // Rebuilds rows with fresh listeners, old ones released.
  // @purpose Clears the list and renders one editable row per snippet prefix in sorted order.
  // @inputs void (reads options.snippets() live).
  // @outputs void (mutates the list element's children).
  // @dataflow options.snippets() → sorted prefixes → renderRow per prefix → list.replaceChildren.
  // @controlflow Abort prior row listeners, then branch on empty vs non-empty: empty shows a hint, otherwise rows are rendered.
  function draw(): void {
    rowsAbort?.abort();
    const rowsController = new AbortController();
    rowsAbort = rowsController;
    const items = options.snippets();
    const prefixes = Object.keys(items).sort((a, b) => a.localeCompare(b));
    if (prefixes.length === 0) {
      // No snippets: show the empty-state hint instead of any rows.
      list.replaceChildren(el('div', 'kdoc-snippets-empty', 'No snippets. Add one above.'));
    } else {
      // One or more snippets: render a row for each prefix, passing the controller signal to its listeners.
      list.replaceChildren(...prefixes.map((prefix) => renderRow(prefix, items[prefix] ?? '', rowsController.signal)));
    }
  }

  // Adds or overwrites a snippet; an existing prefix is overwritten and the status says so.
  // @purpose Validates the prefix/body inputs, publishes the new map when valid, and reports why not otherwise.
  // @inputs void (reads prefixInput.value and bodyInput.value).
  // @outputs void (side effects: status message, focus, publish).
  // @dataflow prefix + value → validation → publish(copy with [prefix]: value) or error message.
  // @controlflow Branch on prefix validity, then body validity, then success: each failure focuses and reports; success publishes and clears.
  function add(): void {
    const prefix = prefixInput.value.trim();
    const value = bodyInput.value;
    if (!isValidSnippetPrefix(prefix)) {
      // Prefix invalid: report the rule and return focus to the prefix field.
      say(PREFIX_RULE, true);
      prefixInput.focus();
    } else if (!isValidSnippetBody(value)) {
      // Body invalid (prefix was fine): report the rule and return focus to the body field.
      say(BODY_RULE, true);
      bodyInput.focus();
    } else {
      // Both valid: publish into a copy of the live snippets and note whether this replaced an existing prefix.
      const existed = Object.prototype.hasOwnProperty.call(options.snippets(), prefix);
      publish({ ...options.snippets(), [prefix]: value });
      // Report the outcome based on whether this prefix already existed; true → "Changed", false → "Added".
      say(existed ? `Changed the snippet ${prefix}.` : `Added the snippet ${prefix}.`, false);
      prefixInput.value = '';
      bodyInput.value = '';
      prefixInput.focus();
    }
  }

  addButton.addEventListener('click', () => { add(); }, { signal });
  prefixInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      // Enter in the prefix field moves to the body, since a body can span lines.
      event.preventDefault();
      bodyInput.focus();
    } else {
      // Any other key is left to default handling; nothing to intercept here.
    }
  }, { signal });
  restoreButton.addEventListener('click', () => {
    publish({ ...options.defaults });
    say('Restored the default snippets.', false);
  }, { signal });
  closeButton.addEventListener('click', () => { close(); }, { signal });

  // Opens the dialog once, showing it and focusing the prefix field.
  // @purpose Displays the modal (or fallback open attribute) after clearing status and drawing fresh rows.
  // @inputs void.
  // @outputs void (side effects: redraw, showModal/attribute, focus).
  // @dataflow clear status → draw() builds rows → show()/open attribute → prefixInput.focus().
  // @controlflow Branch on already-open/destroyed to short-circuit; else clears and draws; then branch on showModal availability for the display mechanism.
  function open(): void {
    if (destroyed || dialog.open) {
      // Already open or destroyed: do nothing further.
      return;
    } else {
      // First open: fall through to clear status and draw rows below.
    }
    say('', false);
    draw();
    if (typeof dialog.showModal === 'function') {
      // Native showModal available: use the real modal.
      dialog.showModal();
    } else {
      // jsdom lacks showModal/close: fall back to the open attribute so the dialog still shows.
      dialog.setAttribute('open', '');
    }
    prefixInput.focus();
  }

  // Closes the dialog; closing a closed dialog does nothing, jsdom lacks showModal/close so the attribute stands in.
  // @purpose Hides the modal via close() when available, falling back to removing the open attribute.
  // @inputs void.
  // @outputs void (side effect: hides the dialog).
  // @dataflow No state read; toggles dialog visibility directly.
  // @controlflow Branch on close() availability: call it, else remove the open attribute.
  function close(): void {
    if (typeof dialog.close === 'function') {
      // Native close available: invoke it to hide the modal.
      dialog.close();
    } else {
      // jsdom lacks close(): clear the open attribute so the dialog hides.
      dialog.removeAttribute('open');
    }
  }

  // Tears down listeners and removes the dialog; a second call is harmless.
  // @purpose Marks destroyed, closes the dialog, aborts all pending controllers, and detaches it from the DOM.
  // @inputs void.
  // @outputs void (side effects: cleanup).
  // @dataflow No state read; cancels rowsAbort and lifetime, removes dialog element.
  // @controlflow No branching: set flag, close, abort controllers, remove element.
  function destroy(): void {
    destroyed = true;
    close();
    rowsAbort?.abort();
    lifetime.abort();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      return dialog.open;
    },
    destroy,
  };
}
