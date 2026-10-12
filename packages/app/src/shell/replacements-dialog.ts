/**
 * @file replacements-dialog.ts
 * @purpose The Autocorrect Replacements dialog (FR-7.8): lists the replacement table and lets the user add, change, remove and restore entries, publishing each valid change.
 * @inputs live replacements getter, default table, change callback, DOM events.
 * @outputs a dialog controller and REPLACEMENTS_DIALOG_STYLES.
 * @functions el: element factory; button: labelled button factory; input: constrained text-input factory; say: status writer; publish: commit + redraw; without: copy minus key; renderRow: single row builder; draw: rebuild list; add: validate + insert; open: show dialog; close: hide dialog; destroy: teardown.
 * @dataflow settings table -> rows; edits -> validation -> onChange(next table) -> redraw from the getter.
 * @controlflow build once; each event validates and either publishes or reports why not.
 * @version 3
 * @date 2026-10-04
 */

import { isValidReplacementKey, isValidReplacementValue, MAX_REPLACEMENT_LENGTH } from '@k-doc/config';

export interface ReplacementsDialogOptions {
  readonly doc: Document;
  readonly replacements: () => Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
  readonly onChange: (next: Readonly<Record<string, string>>) => void;
}

export interface ReplacementsDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

export const REPLACEMENTS_DIALOG_STYLES: string = `
dialog.kdoc-replacements-dialog {
  width: min(560px, 92vw);
  max-height: 80vh;
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
  overflow: hidden;
}

dialog.kdoc-replacements-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-replacements-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  max-height: 80vh;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-lg);
}

.kdoc-replacements-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kdoc-chrome-text);
}

.kdoc-replacements-hint {
  margin: 0;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-replacements-add {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-replacements-input {
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  font: inherit;
}

.kdoc-replacements-button {
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

.kdoc-replacements-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-replacements-button:active,
.kdoc-replacements-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-replacements-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-replacements-input:focus-visible,
.kdoc-replacements-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-replacements-status {
  min-height: 18px;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-replacements-status[data-state="warning"] {
  color: var(--kdoc-emissive-red);
}

.kdoc-replacements-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--kdoc-radius-md);
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-replacements-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--kdoc-radius-sm);
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-replacements-from {
  font-family: var(--kdoc-mono-font, monospace);
  font-size: 13px;
  overflow-wrap: anywhere;
  color: var(--kdoc-chrome-text);
}

.kdoc-replacements-empty {
  padding: 8px 4px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-replacements-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-replacements-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-replacements-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-replacements-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-replacements-dialog,
  dialog.kdoc-replacements-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

export function installReplacementsDialog(options: ReplacementsDialogOptions): ReplacementsDialog {
  const { doc } = options;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let destroyed = false;
  let rowsAbort: AbortController | null = null;

  // Creates an element with a class name and optional text content.
  // @purpose Factory for DOM nodes used by the dialog, all carrying a CSS class.
  // @inputs tag - HTML tag name; className - class to assign; text - initial text (default '').
  // @outputs The created element typed to its tag map entry.
  // @dataflow tag + className + text → createElement → set properties → return.
  // @controlflow Linear construction with no branching.
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string = ''): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  // Creates an icon-only button carrying an accessible label.
  // @purpose Builds a control with an aria-label for screen readers and no visible-text semantics beyond the given text.
  // @inputs text - visible button text; label - accessible name.
  // @outputs A configured HTMLButtonElement.
  // @dataflow text + label → el('button') → set type and aria-label → return.
  // @controlflow Linear construction with no branching.
  function button(text: string, label: string): HTMLButtonElement {
    const b = el('button', 'kdoc-replacements-button', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  // Creates a single-line text input constrained to the max replacement length.
  // @purpose Builds an editable field for keys/values with an accessible name and placeholder.
  // @inputs label - accessible name; placeholder - prompt shown when empty.
  // @outputs A configured HTMLInputElement.
  // @dataflow label + placeholder → el('input') → set type, aria-label, placeholder, maxLength → return.
  // @controlflow Linear construction with no branching.
  function input(label: string, placeholder: string): HTMLInputElement {
    const i = el('input', 'kdoc-replacements-input');
    i.type = 'text';
    i.setAttribute('aria-label', label);
    i.placeholder = placeholder;
    i.maxLength = MAX_REPLACEMENT_LENGTH;
    return i;
  }

  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-replacements-dialog';
  dialog.setAttribute('aria-labelledby', 'kdoc-replacements-heading');
  const body = el('div', 'kdoc-replacements-body');
  const heading = el('h2', 'kdoc-replacements-heading', 'Autocorrect Replacements');
  heading.id = 'kdoc-replacements-heading';
  const hint = el('p', 'kdoc-replacements-hint', 'Text is replaced when you type a space or punctuation after it. A lowercase entry also matches a capitalised word.');
  const addRow = el('div', 'kdoc-replacements-add');
  const fromInput = input('Replace', 'Replace…');
  const toInput = input('With', 'With…');
  const addButton = button('Add', 'Add replacement');
  addRow.append(fromInput, toInput, addButton);
  const status = el('div', 'kdoc-replacements-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = el('div', 'kdoc-replacements-list');
  list.setAttribute('role', 'list');
  const footer = el('div', 'kdoc-replacements-footer');
  const restoreButton = button('Restore Defaults', 'Restore the default replacements');
  const closeButton = button('Close', 'Close');
  footer.append(restoreButton, closeButton);
  body.append(heading, hint, addRow, status, list, footer);
  dialog.append(body);
  doc.body.append(dialog);

  // Writes the status line and toggles its warning state.
  // @purpose Reports success or error feedback to the user via the live region.
  // @inputs text - message to show; warning - whether to mark it as an error.
  // @outputs void; mutates status element in place.
  // @dataflow text + warning → status.textContent + data-state attribute toggle.
  // @controlflow Set text always; branch on warning to set or clear the warning state.
  function say(text: string, warning: boolean): void {
    status.textContent = text;
    if (warning) {
      status.setAttribute('data-state', 'warning');
    } else {
      status.removeAttribute('data-state');
    }
  }

  // Commits a new table and redraws from it.
  // @purpose Persists the change through the app callback then refreshes the view so the dialog never shows a rejected table.
  // @inputs next - the full replacement table to store.
  // @outputs void; triggers onChange and a redraw.
  // @dataflow next → options.onChange → draw() reads live getter.
  // @controlflow Linear: publish then redraw.
  function publish(next: Readonly<Record<string, string>>): void {
    options.onChange(next);
    draw();
  }

  // Returns a copy of the current table with one entry removed.
  // @purpose Builds the next table for a remove action without mutating live state.
  // @inputs key - the replacement key to delete.
  // @outputs A new Record without that key.
  // @dataflow Current table → shallow copy → delete key → return copy.
  // @controlflow Linear construction with no branching.
  function without(key: string): Record<string, string> {
    const next: Record<string, string> = { ...options.replacements() };
    delete next[key];
    return next;
  }

  // Builds a single editable replacement row with change and remove handlers.
  // @purpose Renders one key/value pair as a list item whose edits are validated before publishing.
  // @inputs key - the search text; value - current replacement; rowSignal - signal to scope this row's listeners.
  // @outputs The row element containing from, to-input and remove button.
  // @dataflow key + value → spans/inputs wired with change/remove handlers bound to rowSignal.
  // @controlflow Linear construction; inner handlers branch on validation at runtime.
  function renderRow(key: string, value: string, rowSignal: AbortSignal): HTMLElement {
    const row = el('div', 'kdoc-replacements-row');
    row.setAttribute('role', 'listitem');
    row.dataset['key'] = key;
    const from = el('span', 'kdoc-replacements-from', key);
    const to = input(`Replacement for ${key}`, 'With…');
    to.value = value;
    const remove = button('Remove', `Remove the replacement for ${key}`);
    to.addEventListener('change', () => {
      // Commit only when the edited value is valid; otherwise revert and explain.
      if (isValidReplacementValue(to.value)) {
        publish({ ...options.replacements(), [key]: to.value });
        say(`Changed the replacement for ${key}.`, false);
      } else {
        to.value = value;
        say(`A replacement must be 1 to ${MAX_REPLACEMENT_LENGTH} characters.`, true);
      }
    }, { signal: rowSignal });
    remove.addEventListener('click', () => {
      publish(without(key));
      say(`Removed the replacement for ${key}.`, false);
    }, { signal: rowSignal });
    row.append(from, to, remove);
    return row;
  }

  // Rebuilds the replacement list from the live table.
  // @purpose Tears down old rows and renders fresh ones with new listeners so edits always reflect current state.
  // @inputs void; reads options.replacements() for the source of truth.
  // @outputs void; replaces list children.
  // @dataflow Live table → sorted keys → empty message or rendered rows.
  // @controlflow Early return if destroyed; abort old row listeners; branch on empty vs populated table.
  function draw(): void {
    // Only open() and the row and button listeners draw, and destroy() stops both, so a destroyed dialog never gets here.
    rowsAbort?.abort();
    const rowsController = new AbortController();
    rowsAbort = rowsController;
    const table = options.replacements();
    const keys = Object.keys(table).sort((a, b) => a.localeCompare(b));
    if (keys.length === 0) {
      list.replaceChildren(el('div', 'kdoc-replacements-empty', 'No replacements. Add one above.'));
    } else {
      list.replaceChildren(...keys.map((key) => renderRow(key, table[key] ?? '', rowsController.signal)));
    }
  }

  // Validates and adds (or overwrites) a replacement from the add fields.
  // @purpose Applies the Add button/Enter flow, reporting why an entry was rejected.
  // @inputs void; reads fromInput and toInput values.
  // @outputs void; publishes on success or reports the first validation failure.
  // @dataflow Field text → key/value validation → publish + status → clear fields.
  // @controlflow Branch on key validity, then value validity, else commit; focus returns to the from field.
  function add(): void {
    const key = fromInput.value.trim();
    const value = toInput.value;
    if (!isValidReplacementKey(key)) {
      say(`The text to replace must be 1 to ${MAX_REPLACEMENT_LENGTH} characters with no spaces.`, true);
      fromInput.focus();
    } else if (!isValidReplacementValue(value)) {
      // Key valid but value invalid: keep focus on the value field and explain.
      say(`A replacement must be 1 to ${MAX_REPLACEMENT_LENGTH} characters.`, true);
      toInput.focus();
    } else {
      const existed = Object.prototype.hasOwnProperty.call(options.replacements(), key);
      publish({ ...options.replacements(), [key]: value });
      // Existing entries report as changed; new ones report as added.
      say(existed ? `Changed the replacement for ${key}.` : `Added a replacement for ${key}.`, false);
      fromInput.value = '';
      toInput.value = '';
      fromInput.focus();
    }
  }

  addButton.addEventListener('click', () => { add(); }, { signal });
  for (const field of [fromInput, toInput]) {
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      } else {
        // Not Enter: typing continues in the field.
      }
    }, { signal });
  }
  restoreButton.addEventListener('click', () => {
    publish({ ...options.defaults });
    say('Restored the default replacements.', false);
  }, { signal });
  closeButton.addEventListener('click', () => { close(); }, { signal });

  // Opens the dialog and draws a fresh list.
  // @purpose Shows the modal (or open attribute) after clearing status and rendering rows.
  // @inputs void; reads options.replacements() for the initial draw.
  // @outputs void.
  // @dataflow Cleared status → draw() → show/hide-open → focus from field.
  // @controlflow Early return if destroyed or already open; branch on showModal availability.
  function open(): void {
    if (destroyed || dialog.open) {
      return;
    } else {
      // Mounted and closed: proceed to open.
    }
    say('', false);
    draw();
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // jsdom lacks showModal, so the open attribute stands in.
      dialog.setAttribute('open', '');
    }
    fromInput.focus();
  }

  // Closes the dialog when it is open.
  // @purpose Hides the modal (or clears the open attribute) using the best available API.
  // @inputs void.
  // @outputs void.
  // @dataflow dialog.open flag → close()/removeAttribute path.
  // @controlflow Early return if already closed; branch on close() availability.
  function close(): void {
    // Closing a dialog that is already closed does nothing, so there is no guard.
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  // Tears down the dialog and releases all listeners.
  // @purpose Detaches from the DOM, aborts pending row work and the lifetime signal exactly once.
  // @inputs void.
  // @outputs void.
  // @dataflow destroyed flag → close → abort rows + lifetime → remove node.
  // @controlflow Early return if already destroyed; else mark, close, abort, remove.
  function destroy(): void {
    // A second call closes a closed dialog, aborts aborted signals and removes a detached node, all harmless.
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
