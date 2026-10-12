// @vitest-environment jsdom

/**
 * @file list-picker.spec.ts
 * @purpose Vitest test suite for K-Doc's Word-style multi-level list picker gallery (FR-8.6).
 *   Validates gallery rendering, hierarchical indentation cascading, marker glyph mapping,
 *   visibility transitions, coordinate positioning, mouse selection, keyboard navigation,
 *   current-tile reflection, and static stylesheet rules under jsdom.
 * @inputs Synthetic DOM click, mouseenter, and keydown events; viewport coordinates; ListPickerScheme and level definitions.
 * @outputs Vitest assertions verifying DOM attributes (aria-label, aria-current, hidden, class, style),
 *   callback selection records, and CSS rule presence.
 * @functions
 *   - mount: Installs a fresh ListPicker instance attached to document.body and returns a test harness.
 *   - tiles: Queries all tile elements within the list picker container.
 *   - tileFor: Locates a specific tile within the list picker by its accessible aria-label.
 *   - press: Dispatches a synthetic keydown KeyboardEvent to document simulating keyboard navigation.
 * @dataflow Synthetic user interactions -> ListPicker event listeners -> DOM element updates and onPick callback -> test assertions.
 * @controlflow Mount ListPicker -> execute interaction sequences across gallery rendering, opening/picking, keyboard navigation, current tile tracking, and styles -> assert DOM attributes and callback state -> tear down pickers in afterEach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  installListPicker,
  LIST_PICKER_LEVELS,
  LIST_PICKER_STYLES,
  type ListPicker,
  type ListPickerScheme,
} from '../src/shell/list-picker.js';

let pickers: ListPicker[] = [];

afterEach(() => {
  // The picker mounts onto doc.body and would otherwise leak between tests.
  for (const picker of pickers) {
    picker.destroy();
  }
  pickers = [];
});

interface Harness {
  readonly picker: ListPicker;
  readonly picks: Array<{ scheme: ListPickerScheme; level: number }>;
  readonly root: HTMLElement;
}

/**
 * Installs a fresh ListPicker instance attached to document.body and returns a test harness.
 *
 * @purpose Creates and mounts a ListPicker controller tracking picks and registering it for test cleanup.
 * @inputs void.
 * @outputs Harness - The test harness containing picker controller, picks history array, and root DOM element.
 * @dataflow installListPicker -> query root element on document.body -> register in pickers -> return harness.
 * @controlflow Initialize picks array -> instantiate picker with document and window -> push to pickers -> query .kdoc-list-picker -> throw if null -> return harness.
 */
function mount(): Harness {
  const picks: Array<{ scheme: ListPickerScheme; level: number }> = [];
  const picker = installListPicker({
    doc: document,
    win: window,
    onPick: (scheme: ListPickerScheme, level: number): void => {
      picks.push({ scheme, level });
    },
  });
  pickers.push(picker);

  const root = document.querySelector<HTMLElement>('.kdoc-list-picker');
  // Check if root element was mounted to document.body.
  if (root === null) {
    // Missing root element: fail fast.
    throw new Error('List picker root element not found on document.body');
  } else {
    // Root element found.
  }

  return { picker, picks, root };
}

/**
 * Queries all tile elements within the list picker container.
 *
 * @purpose Returns an array of HTMLElement instances corresponding to list picker tiles.
 * @inputs root: HTMLElement - The root list picker container element.
 * @outputs HTMLElement[] - Array of tile DOM elements.
 * @dataflow root.querySelectorAll('.kdoc-list-picker-tile') -> Array.from -> HTMLElement[].
 * @controlflow Query all matching elements -> convert NodeList to Array -> return array.
 */
function tiles(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.kdoc-list-picker-tile'));
}

/**
 * Locates a specific tile within the list picker by its accessible aria-label.
 *
 * @purpose Finds the tile element matching the specified aria-label or throws an Error.
 * @inputs
 *   - root: HTMLElement - The root list picker container element.
 *   - label: string - The aria-label attribute value to find.
 * @outputs HTMLElement - The matching tile DOM element.
 * @dataflow root.querySelector with aria-label selector -> validate found -> return tile.
 * @controlflow Query selector for aria-label -> check if null -> throw descriptive Error if null -> return element.
 */
function tileFor(root: HTMLElement, label: string): HTMLElement {
  const tile = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  // Check if tile with the specified aria-label exists in the picker root.
  if (tile === null) {
    // Tile not found: throw descriptive error.
    throw new Error(`Tile with aria-label "${label}" not found`);
  } else {
    // Tile found.
  }
  return tile;
}

describe('the gallery', () => {
  it('offers every scheme at every level', () => {
    const { root } = mount();
    const allTiles = tiles(root);
    expect(allTiles.length).toBe(3 * LIST_PICKER_LEVELS);

    const labels = allTiles.map((t) => t.getAttribute('aria-label'));
    const expectedLabels: string[] = [];
    const schemeLabels: readonly string[] = ['Bullet', 'Numbered', 'Task'];
    for (let s = 0; s < schemeLabels.length; s++) {
      const schemeLabel = schemeLabels[s];
      // Check if scheme label is defined under strict indexed access.
      if (schemeLabel === undefined) {
        // Skip undefined scheme label.
        continue;
      } else {
        // Valid scheme label: append level labels.
      }
      for (let level = 1; level <= LIST_PICKER_LEVELS; level++) {
        expectedLabels.push(`${schemeLabel} list, level ${level}`);
      }
    }
    expect(labels).toEqual(expectedLabels);
  });

  it('each tile previews three rows', () => {
    const { root } = mount();
    const allTiles = tiles(root);
    for (const tile of allTiles) {
      const rows = tile.querySelectorAll('.kdoc-list-picker-row');
      expect(rows.length).toBe(3);
    }
  });

  it('a level-1 tile is flat and a level-3 tile cascades', () => {
    const { root } = mount();
    const level1Tile = tileFor(root, 'Bullet list, level 1');
    const level1Rows = Array.from(level1Tile.querySelectorAll<HTMLElement>('.kdoc-list-picker-row'));
    // The indent is what a user actually reads the tile by — the label only confirms what the shape already said.
    const level1Paddings = level1Rows.map((r) => r.style.paddingLeft);
    expect(level1Paddings).toEqual(['0px', '0px', '0px']);

    const level3Tile = tileFor(root, 'Bullet list, level 3');
    const level3Rows = Array.from(level3Tile.querySelectorAll<HTMLElement>('.kdoc-list-picker-row'));
    const level3Paddings = level3Rows.map((r) => r.style.paddingLeft);
    expect(level3Paddings).toEqual(['0px', '10px', '20px']);
  });

  it('the markers match the scheme', () => {
    const { root } = mount();
    const bulletMarkers = Array.from(
      tileFor(root, 'Bullet list, level 1').querySelectorAll('.kdoc-list-picker-marker'),
    ).map((el) => el.textContent);
    expect(bulletMarkers).toEqual(['•', '•', '•']);

    const numberedMarkers = Array.from(
      tileFor(root, 'Numbered list, level 1').querySelectorAll('.kdoc-list-picker-marker'),
    ).map((el) => el.textContent);
    expect(numberedMarkers).toEqual(['1.', '2.', '3.']);

    const taskMarkers = Array.from(
      tileFor(root, 'Task list, level 1').querySelectorAll('.kdoc-list-picker-marker'),
    ).map((el) => el.textContent);
    expect(taskMarkers).toEqual(['☐', '☐', '☐']);
  });

  it('it starts hidden', () => {
    const { picker, root } = mount();
    expect(root.hidden).toBe(true);
    expect(picker.isOpen).toBe(false);
  });
});

describe('opening and picking', () => {
  it('openAt shows it and positions it', () => {
    const { picker, root } = mount();
    picker.openAt(40, 60);

    expect(root.hidden).toBe(false);
    expect(picker.isOpen).toBe(true);

    // jsdom reports every measured size as 0, so openAt coordinates cannot be asserted for clamping.
    // We assert only that left and top styles were set at all.
    expect(root.style.left.length).toBeGreaterThan(0);
    expect(root.style.top.length).toBeGreaterThan(0);
  });

  it('clicking a tile reports its scheme and level and closes', () => {
    const { picker, picks, root } = mount();
    picker.openAt(40, 60);

    tileFor(root, 'Numbered list, level 2').click();

    // The picker reports 'ordered' while the label says "Numbered", because the schema's
    // node is orderedList and the label is what a user calls it.
    expect(picks).toEqual([{ scheme: 'ordered', level: 2 }]);
    expect(picker.isOpen).toBe(false);
  });

  it('a click while closed reports nothing', () => {
    const { picks, root } = mount();
    tileFor(root, 'Numbered list, level 2').click();
    expect(picks).toEqual([]);
  });

  it('hovering a tile names it in the caption', () => {
    const { picker, root } = mount();
    picker.openAt(40, 60);

    tileFor(root, 'Task list, level 3').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false }),
    );

    expect(root.querySelector('.kdoc-list-picker-caption')?.textContent).toBe('Task list, level 3');
  });
});

describe('keyboard', () => {
  /**
   * Dispatches a synthetic keydown KeyboardEvent to document.
   *
   * @purpose Creates and dispatches a keyboard event simulating user key presses on document.
   * @inputs key: string - The KeyboardEvent key value (e.g. 'ArrowRight', 'Enter', 'Escape').
   * @outputs KeyboardEvent - The dispatched event instance.
   * @dataflow key -> KeyboardEvent -> document.dispatchEvent -> return event.
   * @controlflow Construct KeyboardEvent with bubbles and cancelable -> dispatch to document -> return event.
   */
  function press(key: string): KeyboardEvent {
    // The listener is on the document as well as the picker because focus stays in the
    // editor behind it — a picker that only heard keys when focused would never hear one.
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  }

  it('arrows move across levels and between schemes', () => {
    const { picker, picks } = mount();
    picker.openAt(40, 60);

    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('Enter');

    expect(picks).toEqual([{ scheme: 'ordered', level: 3 }]);
  });

  it('arrows clamp at the edges', () => {
    const { picker, picks } = mount();
    picker.openAt(40, 60);

    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');

    expect(picks).toEqual([{ scheme: 'bullet', level: 1 }]);
  });

  it('every navigation key is prevented, not only one of them', () => {
    const { picker } = mount();
    picker.openAt(40, 60);

    // Without this the same key would also reach the editor behind the gallery -- an arrow would
    // move the caret and Enter would split the paragraph while the user thought they were choosing
    // a list. Asserting one key would leave the other three free to do it.
    const keys: readonly string[] = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
    for (const key of keys) {
      expect(press(key).defaultPrevented).toBe(true);
    }
    expect(press('Escape').defaultPrevented).toBe(true);
  });

  it('the right arrow stops at the last level', () => {
    const { picker, picks } = mount();
    picker.openAt(40, 60);

    // Four presses from level 1 would reach level 5 unclamped, and there is no level 5 tile to pick.
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowRight');
    press('Enter');

    expect(picks).toEqual([{ scheme: 'bullet', level: LIST_PICKER_LEVELS }]);
  });

  it('Escape closes without picking', () => {
    const { picker, picks } = mount();
    picker.openAt(40, 60);

    press('Escape');
    expect(picker.isOpen).toBe(false);
    expect(picks).toEqual([]);
  });

  it('keys do nothing while closed', () => {
    const { picker, picks } = mount();

    press('Enter');
    expect(picks).toEqual([]);
    expect(picker.isOpen).toBe(false);
  });
});

describe('the current tile', () => {
  it('setCurrent marks exactly one tile', () => {
    const { picker, root } = mount();
    picker.setCurrent('ordered', 2);

    const currentTiles = root.querySelectorAll('.kdoc-list-picker-tile-current');
    expect(currentTiles.length).toBe(1);

    const target = tileFor(root, 'Numbered list, level 2');
    expect(target.classList.contains('kdoc-list-picker-tile-current')).toBe(true);
    expect(target.getAttribute('aria-current')).toBe('true');
  });

  it('setCurrent(null, null) clears every mark', () => {
    const { picker, root } = mount();
    picker.setCurrent('ordered', 2);
    picker.setCurrent(null, null);

    const currentClasses = root.querySelectorAll('.kdoc-list-picker-tile-current');
    expect(currentClasses.length).toBe(0);

    const currentAria = root.querySelectorAll('[aria-current]');
    expect(currentAria.length).toBe(0);
  });

  it('opening starts on the current tile', () => {
    const { picker, picks } = mount();
    picker.setCurrent('task', 3);
    picker.openAt(0, 0);

    // A gallery which forgot where you were standing would make Enter mean something different each time it opened.
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(picks).toEqual([{ scheme: 'task', level: 3 }]);
  });
});

describe('the styles', () => {
  it('the panel hides when hidden', () => {
    expect(LIST_PICKER_STYLES).toContain('.kdoc-list-picker[hidden]');
  });

  it('the gallery is three tiles wide', () => {
    expect(LIST_PICKER_STYLES).toContain('repeat(3, 1fr)');
  });

  it('a selection dragged across it does not take the tiles', () => {
    expect(LIST_PICKER_STYLES).toContain('user-select: none');
  });
});
