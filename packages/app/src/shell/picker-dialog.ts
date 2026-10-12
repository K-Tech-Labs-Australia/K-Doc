/**
 * @file picker-dialog.ts
 * @purpose Renders a keyboard-driven fuzzy picker dialog used by Quick Open and Go To.
 * @inputs PickerDialogOptions (doc, ariaLabel, placeholder, emptyText, limit); items + onPick via open().
 * @outputs A PickerDialog handle exposing open/close/isOpen/destroy over a <dialog> element.
 * @functions
 *   - appendHighlighted: splits text into matched/unmatched runs and highlights matches.
 *   - installPickerDialog: builds the dialog, wires listeners, returns the public handle.
 * @dataflow Options + items → createElement → render() ranks via fuzzy-score.js → DOM list → events → choose().
 * @controlflow open() populates state and shows modal → listeners mutate activeIndex/ranked → updateActive() syncs ARIA → choose() closes and invokes callback.
 * @version 1
 * @date 2026-09-13
 */

import type { PickerItem, RankedItem } from './fuzzy-score.js';
import { rankItems } from './fuzzy-score.js';
// PickerItem = { id: string; label: string; detail: string }
// RankedItem = { item: PickerItem; score: number; labelPositions: readonly number[]; detailPositions: readonly number[] }
// rankItems(items, query, limit): readonly RankedItem[]  (empty query -> first `limit` items in order)

export interface PickerDialogOptions {
  readonly doc: Document;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly emptyText: string;
  readonly limit: number;
}

export interface PickerDialog {
  open(items: readonly PickerItem[], onPick: (item: PickerItem) => void): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

// Monotonic id counter so multiple picker dialogs never share DOM ids.
let nextPickerId: number = 0;

/**
 * @purpose Appends text to parent, wrapping matched character indices in <mark> highlights.
 * @inputs doc - Document used to create nodes; parent - target element to append into; text - source string; positions - zero-based match indices.
 * @outputs void
 * @dataflow positions → Set membership per index → grouped runs → <mark> or text node children appended to parent.
 * @controlflow Walk characters once, flushing a run whenever the hit-state flips, then flush the trailing run.
 */
function appendHighlighted(
  doc: Document,
  parent: HTMLElement,
  text: string,
  positions: readonly number[],
): void {
  const hits = new Set(positions);
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    // Flush a run whenever the hit-state flips between adjacent characters.
    if (hits.has(i) !== hits.has(start)) {
      const run = text.slice(start, i);
      if (hits.has(start)) {
        // Matched run: wrap in a <mark> highlight element.
        const mark = doc.createElement('mark');
        mark.className = 'kdoc-picker-hit';
        mark.textContent = run;
        parent.appendChild(mark);
      } else {
        // Unmatched run: append as plain text to avoid innerHTML.
        parent.appendChild(doc.createTextNode(run));
      }
      start = i;
    }
  }
  // Flush the trailing run after the loop reaches string end.
  if (start < text.length) {
    const run = text.slice(start);
    if (hits.has(start)) {
      const mark = doc.createElement('mark');
      mark.className = 'kdoc-picker-hit';
      mark.textContent = run;
      parent.appendChild(mark);
    } else {
      parent.appendChild(doc.createTextNode(run));
    }
  }
}

/**
 * @purpose Builds the picker dialog, wires listeners, and returns the public handle.
 * @inputs options - PickerDialogOptions controlling document, labels, placeholder, empty text, and result limit.
 * @outputs A PickerDialog handle exposing open/close/isOpen/destroy over the mounted <dialog>.
 * @dataflow options → createElement → render/rank via fuzzy-score.js → listeners mutate state → choose() invokes callback.
 * @controlflow Declare state + nodes; define inner functions; attach signal-scoped listeners; return the handle.
 */
export function installPickerDialog(options: PickerDialogOptions): PickerDialog {
  const doc = options.doc;
  const id = ++nextPickerId;
  const listId = `kdoc-picker-list-${id}`;
  const controller = new AbortController();
  const signal = controller.signal;

  // Mutable picker state, repopulated on open() and guarded by destroyed.
  let items: readonly PickerItem[] = [];
  let ranked: readonly RankedItem[] = [];
  let activeIndex = -1;
  let pick: ((item: PickerItem) => void) | null = null;
  let destroyed = false;

  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-picker-dialog';
  dialog.setAttribute('aria-label', options.ariaLabel);

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'kdoc-picker-input';
  input.placeholder = options.placeholder;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', listId);

  const list = doc.createElement('ul');
  list.id = listId;
  list.className = 'kdoc-picker-list';
  list.setAttribute('role', 'listbox');

  dialog.append(input, list);
  doc.body.appendChild(dialog);

  /**
   * @purpose Syncs ARIA selection and scroll for the active option across all rows.
   * @inputs void (closes over dialog state)
   * @outputs void
   * @dataflow activeIndex → per-row aria-selected toggle → activedescendant + scrollIntoView.
   * @controlflow Iterate rows, flag the matching index, then clear activedescendant when none is active.
   */
  function updateActive(): void {
    const optionEls = list.querySelectorAll('li.kdoc-picker-option');
    for (let i = 0; i < optionEls.length; i += 1) {
      const el = optionEls[i];
      if (el === undefined) continue; // Guard indexed read under noUncheckedIndexedAccess.
      const on = i === activeIndex;
      el.setAttribute('aria-selected', String(on));
      el.classList.toggle('active', on);
      if (on) {
        // Point ARIA at the active option id and reveal it if off-screen.
        input.setAttribute('aria-activedescendant', el.id);
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' });
        }
      }
    }
    // No active option means no activedescendant to announce.
    if (activeIndex < 0) {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * @purpose Re-ranks items against the query and rebuilds the list DOM.
   * @inputs void (closes over items, input.value, options.limit)
   * @outputs void
   * @dataflow items + query → rankItems → ranked rows → <li> options with highlighted spans.
   * @controlflow Clear list; emit empty row when no matches, else one option per entry; set activeIndex then updateActive().
   */
  function render(): void {
    // Re-rank current items against the query and clear the list before repopulating.
    ranked = rankItems(items, input.value, options.limit);
    list.replaceChildren();
    if (ranked.length === 0) {
      // No matches: show a single empty-state row and clear the active index.
      const empty = doc.createElement('li');
      empty.className = 'kdoc-picker-empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = options.emptyText;
      list.appendChild(empty);
      activeIndex = -1;
    } else {
      // Populate one option row per ranked entry with highlighted label/detail.
      for (let i = 0; i < ranked.length; i += 1) {
        const entry = ranked[i];
        if (entry === undefined) continue; // Guard indexed read under noUncheckedIndexedAccess.
        const li = doc.createElement('li');
        li.className = 'kdoc-picker-option';
        li.setAttribute('role', 'option');
        li.id = `${listId}-opt-${i}`;
        li.dataset['index'] = String(i);

        // Render the label with matched-character highlights.
        const labelSpan = doc.createElement('span');
        labelSpan.className = 'kdoc-picker-label';
        appendHighlighted(doc, labelSpan, entry.item.label, entry.labelPositions);
        li.append(labelSpan);

        // Append a detail row only when the item carries one.
        if (entry.item.detail !== '') {
          const detailSpan = doc.createElement('span');
          detailSpan.className = 'kdoc-picker-detail';
          appendHighlighted(doc, detailSpan, entry.item.detail, entry.detailPositions);
          li.append(detailSpan);
        }
        list.appendChild(li);
      }
      // First option becomes the default active row.
      activeIndex = 0;
    }
    updateActive();
  }

  /**
   * @purpose Picks the ranked option at index, closing before invoking the callback.
   * @inputs index - Position into the current ranked list.
   * @outputs void
   * @dataflow ranked[index] + pick → close() then callback(entry.item).
   * @controlflow Early return when entry or callback is missing; else close first to avoid focus theft.
   */
  function choose(index: number): void {
    // Snapshot the ranked entry and pick callback before any mutation.
    const entry = ranked[index];
    const callback = pick;
    if (entry === undefined || callback === null) {
      // Nothing selectable yet: no ranking or no open session.
      return;
    }
    // Close first so the callback can focus an editor without a closing modal stealing focus.
    close();
    callback(entry.item);
  }

  /**
   * @purpose Resolves the option index for a DOM event target, or -1 when unmatched.
   * @inputs target - The event.target that may sit inside an <li> option.
   * @outputs number - Parsed dataset.index, or -1 when no option is found.
   * @dataflow target → closest('li.kdoc-picker-option') → parsed index string.
   * @controlflow Reject non-elements and null matches; parse the stored index otherwise.
   */
  function optionIndex(target: EventTarget | null): number {
    // Only element targets can contain an <li> option.
    if (!(target instanceof Element)) {
      return -1;
    }
    const li = target.closest('li.kdoc-picker-option');
    if (!(li instanceof HTMLElement)) {
      // Click missed any option row.
      return -1;
    }
    // Parse the stored index, defaulting to -1 when absent.
    return Number.parseInt(li.dataset['index'] ?? '-1', 10);
  }

  /**
   * @purpose Reports whether the dialog is currently shown via property or attribute.
   * @inputs void
   * @outputs boolean - True when the dialog is open.
   * @dataflow dialog.open || dialog.hasAttribute('open').
   * @controlflow Returns the disjunction of the live property and the manual attribute.
   */
  function isDialogOpen(): boolean {
    // Treat both the live .open property and a manual 'open' attribute as open.
    return dialog.open || dialog.hasAttribute('open');
  }

  /**
   * @purpose Populates state, renders, and shows the modal for a new pick session.
   * @inputs nextItems - Items to rank and display; onPick - Callback invoked on selection.
   * @outputs void
   * @dataflow nextItems + onPick → items/pick → render() → showModal/fallback → input.focus().
   * @controlflow Early return when destroyed; populate, clear query, render, show, then focus.
   */
  function open(nextItems: readonly PickerItem[], onPick: (item: PickerItem) => void): void {
    // Ignore calls after teardown.
    if (destroyed) {
      return;
    }
    items = nextItems;
    pick = onPick;
    input.value = '';
    render();
    if (!isDialogOpen()) {
      // Show via showModal when available, else fall back to the open attribute.
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    input.focus();
  }

  /**
   * @purpose Ends the current session, hiding the dialog and dropping the callback.
   * @inputs void
   * @outputs void
   * @dataflow pick → null; dialog.close()/removeAttribute('open').
   * @controlflow Drop callback; early return if already closed; then close via method or attribute.
   */
  function close(): void {
    // Drop the pending callback so a late Enter cannot pick after closing.
    pick = null;
    if (!isDialogOpen()) {
      // Already closed: nothing to do.
      return;
    }
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    // Clear the attribute too so jsdom reflects a closed state.
    dialog.removeAttribute('open');
  }

  /**
   * @purpose Idempotently tears down listeners, DOM node, and session state.
   * @inputs void
   * @outputs void
   * @dataflow close() → controller.abort() → dialog.remove().
   * @controlflow Early return when already destroyed; then close, abort, and detach.
   */
  function destroy(): void {
    // Idempotent teardown.
    if (destroyed) {
      return;
    }
    close();
    destroyed = true;
    // Abort listeners and detach the DOM node.
    controller.abort();
    dialog.remove();
  }

  input.addEventListener('input', () => {
    // Re-render on each keystroke to reflect the current query.
    render();
  }, { signal });

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      // Move selection down, wrapping around at the end.
      event.preventDefault();
      if (ranked.length > 0) {
        activeIndex = (activeIndex + 1) % ranked.length;
        updateActive();
      }
    } else if (event.key === 'ArrowUp') {
      // Move selection up, wrapping around at the start.
      event.preventDefault();
      if (ranked.length > 0) {
        activeIndex = (activeIndex - 1 + ranked.length) % ranked.length;
        updateActive();
      }
    } else if (event.key === 'Enter') {
      // Activate the currently highlighted option.
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      // Dismiss the picker.
      event.preventDefault();
      close();
    }
  }, { signal });

  list.addEventListener('mousedown', (event: MouseEvent) => {
    // Consume the click so it does not blur the input before choosing.
    event.preventDefault();
    const i = optionIndex(event.target);
    if (i >= 0) {
      choose(i);
    }
  }, { signal });

  list.addEventListener('mousemove', (event: MouseEvent) => {
    // Highlight the option under the pointer when it differs from the active one.
    const i = optionIndex(event.target);
    if (i >= 0 && i !== activeIndex) {
      activeIndex = i;
      updateActive();
    }
  }, { signal });

  dialog.addEventListener('cancel', (event: Event) => {
    // A native cancel should close without running the default action.
    event.preventDefault();
    close();
  }, { signal });

  return {
    open,
    close,
    get isOpen(): boolean {
      return isDialogOpen();
    },
    destroy,
  };
}
