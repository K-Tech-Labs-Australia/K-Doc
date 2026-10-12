// @vitest-environment jsdom
/**
 * @file picker-dialog.spec.ts
 * @purpose Exercises the keyboard-driven fuzzy picker dialog under jsdom, covering rendering, filtering, ARIA sync, navigation, selection, and teardown.
 * @inputs jsdom `document`; a `PickerDialog` handle produced by `installPickerDialog`; a fixed `readonly PickerItem[]` fixture (`ITEMS`).
 * @outputs Test outcomes via Vitest `expect` assertions; no runtime values are returned to callers.
 * @functions
 *   - input: Returns the combobox `<input>` element, throwing when absent or mis-typed.
 *   - options: Returns every rendered `.kdoc-picker-option` row as an array of elements.
 *   - type: Sets the input value and dispatches a bubbling `input` event to trigger re-rendering.
 *   - key: Dispatches a bubbling, cancelable `keydown` on the input and returns the event for assertions.
 * @dataflow install() builds the dialog → open(items) ranks via fuzzy-score.js and renders rows → type()/key()/event dispatch mutate DOM state → expect reads attributes/textContent to assert behavior.
 * @controlflow afterEach tears down any live picker → each test installs, opens, drives events, asserts outcomes, then relies on afterEach for cleanup.
 * @version 1
 * @date 2026-09-13
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installPickerDialog, type PickerDialog } from '../src/shell/picker-dialog.js';
import type { PickerItem } from '../src/shell/fuzzy-score.js';

let picker: PickerDialog | undefined;
afterEach(() => {
  picker?.destroy();
  picker = undefined;
});

const ITEMS: readonly PickerItem[] = [
  { id: '/v/alpha.md', label: 'Alpha', detail: 'alpha.md' },
  { id: '/v/beta.md', label: 'Beta', detail: 'notes/beta.md' },
  { id: '/v/gamma.md', label: 'Gamma', detail: 'gamma.md' },
];

function install(limit: number = 50): PickerDialog {
  picker = installPickerDialog({
    doc: document,
    ariaLabel: 'Quick Open',
    placeholder: 'Type',
    emptyText: 'No matching files',
    limit,
  });
  return picker;
}

/**
 * @purpose Returns the picker's text input element, throwing when absent or mis-typed.
 * @inputs void
 * @outputs HTMLInputElement - The `.kdoc-picker-input` combobox field.
 * @dataflow document query → Element guard → typed return.
 * @controlflow Query selector; early throw when result is not an HTMLInputElement.
 */
function input(): HTMLInputElement {
  const el = document.querySelector('.kdoc-picker-input');
  if (!(el instanceof HTMLInputElement)) {
    throw new Error('picker input element not found or of unexpected type');
  }
  return el;
}

/**
 * @purpose Returns every rendered option row as an array of elements.
 * @inputs void
 * @outputs HTMLElement[] - Each `<li class="kdoc-picker-option">` currently in the DOM.
 * @dataflow document querySelectorAll → array conversion.
 * @controlflow Collect matching listbox options into a plain array.
 */
function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll('li.kdoc-picker-option'));
}

/**
 * @purpose Simulates typing by setting the input value and firing an input event.
 * @inputs text - The string to place into the input field.
 * @outputs void
 * @dataflow text → input.value → dispatched `input` event → render().
 * @controlflow Assign value then dispatch a bubbling input event so listeners re-render.
 */
function type(text: string): void {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * @purpose Dispatches a keydown event on the input and returns it for assertions.
 * @inputs k - The KeyboardEvent.key value (e.g. 'ArrowDown', 'Enter', 'Escape').
 * @outputs KeyboardEvent - The dispatched event, inspectable via defaultPrevented.
 * @dataflow k → KeyboardEvent → dispatched on input().
 * @controlflow Construct a cancelable, bubbling keydown then dispatch and return it.
 */
function key(k: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  input().dispatchEvent(event);
  return event;
}

describe('picker-dialog', () => {
  // open lists every item in order and marks the first active.
  it('open lists every item in order and marks the first active', () => {
    install().open(ITEMS, () => {});
    const opts = options();
    expect(opts.map((o) => o.querySelector('.kdoc-picker-label')?.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(opts[0]?.getAttribute('aria-selected')).toBe('true');
    expect(opts[0]?.classList.contains('active')).toBe(true);
    expect(picker!.isOpen).toBe(true);
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0]?.id);
  });

  // typing filters and highlights matched characters.
  it('typing filters and highlights matched characters', () => {
    install().open(ITEMS, () => {});
    type('bt');
    const opts = options();
    expect(opts.map((o) => o.querySelector('.kdoc-picker-label')?.textContent)).toEqual(['Beta']);
    const label = opts[0]?.querySelector('.kdoc-picker-label');
    const marks = label?.querySelectorAll('mark.kdoc-picker-hit');
    expect(Array.from(marks ?? []).map((m) => m.textContent)).toEqual(['B', 't']);
  });

  // a detail-only match highlights the detail.
  it('a detail-only match highlights the detail', () => {
    install().open(ITEMS, () => {});
    type('notes');
    const opts = options();
    expect(opts.length).toBe(1);
    const opt = opts[0];
    expect(opt?.querySelector('.kdoc-picker-detail mark')).not.toBeNull();
    expect(opt?.querySelector('.kdoc-picker-label mark')).toBeNull();
  });

  // no match shows the empty row.
  it('no match shows the empty row', () => {
    install().open(ITEMS, () => {});
    type('zzz');
    expect(options().length).toBe(0);
    const empty = document.querySelector('li.kdoc-picker-empty');
    expect(empty?.textContent).toBe('No matching files');
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
  });

  // ArrowDown moves and wraps; ArrowUp wraps backwards.
  it('ArrowDown moves and wraps; ArrowUp wraps backwards', () => {
    install().open(ITEMS, () => {});
    key('ArrowDown');
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    key('ArrowDown');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    expect(options()[2]?.getAttribute('aria-selected')).toBe('true');
    const ev = key('ArrowDown');
    expect(ev.defaultPrevented).toBe(true);
  });

  // Enter picks the active item and closes before calling back.
  it('Enter picks the active item and closes before calling back', () => {
    let openDuringPick: boolean | null = null;
    const picked: string[] = [];
    install().open(ITEMS, (item) => {
      openDuringPick = picker?.isOpen ?? null;
      picked.push(item.id);
    });
    key('ArrowDown');
    key('Enter');
    expect(picked).toEqual(['/v/beta.md']);
    expect(openDuringPick).toBe(false);
    expect(picker!.isOpen).toBe(false);
  });

  // Escape closes without picking.
  it('Escape closes without picking', () => {
    const picked: string[] = [];
    install().open(ITEMS, (item) => {
      picked.push(item.id);
    });
    key('Escape');
    expect(picker!.isOpen).toBe(false);
    expect(picked).toEqual([]);
    // A late Enter reaching the closed picker must not pick with the callback it was opened with.
    key('Enter');
    expect(picked).toEqual([]);
  });

  // mousedown on an option picks it and is prevented.
  it('mousedown on an option picks it and is prevented', () => {
    const picked: string[] = [];
    install().open(ITEMS, (item) => {
      picked.push(item.id);
    });
    const labelSpan = options()[2]?.querySelector('.kdoc-picker-label');
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    labelSpan?.dispatchEvent(ev);
    expect(picked).toEqual(['/v/gamma.md']);
    expect(ev.defaultPrevented).toBe(true);
  });

  // mousemove makes the hovered option active.
  it('mousemove makes the hovered option active', () => {
    install().open(ITEMS, () => {});
    const ev = new MouseEvent('mousemove', { bubbles: true });
    options()[1]?.dispatchEvent(ev);
    expect(options()[1]?.classList.contains('active')).toBe(true);
  });

  // the limit caps rendered rows.
  it('the limit caps rendered rows', () => {
    install(2).open(ITEMS, () => {});
    expect(options().length).toBe(2);
  });

  // reopening clears the previous query and callback.
  it('reopening clears the previous query and callback', () => {
    let firstCalls = 0;
    install().open(ITEMS, () => {
      firstCalls += 1;
    });
    type('gam');
    key('Escape');

    const secondPicked: string[] = [];
    picker!.open(ITEMS, (item) => {
      secondPicked.push(item.id);
    });

    expect(input().value).toBe('');
    expect(options().length).toBe(3);
    key('Enter');
    expect(secondPicked).toEqual(['/v/alpha.md']);
    expect(firstCalls).toBe(0);
  });

  // text is inserted as text, never markup.
  it('text is inserted as text, never markup', () => {
    install().open([{ id: 'x', label: '<img src=x onerror=1>', detail: '' }], () => {});
    expect(document.querySelector('.kdoc-picker-dialog img')).toBeNull();
    expect(options()[0]?.querySelector('.kdoc-picker-label')?.textContent).toBe('<img src=x onerror=1>');
  });

  // destroy removes the dialog and later opens do nothing.
  it('destroy removes the dialog and later opens do nothing', () => {
    const p = install();
    p.destroy();
    picker = undefined;
    p.open(ITEMS, () => {});
    expect(document.querySelector('.kdoc-picker-dialog')).toBeNull();
  });
});