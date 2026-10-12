// @vitest-environment jsdom

/**
 * @file styles-gallery.spec.ts
 * @purpose Vitest test suite for K-Doc's Word-style styles gallery panel (FR-8.5).
 *   Validates gallery entry rendering, style previews, group labeling, visibility transitions,
 *   coordinate positioning, mouse picking, disabled states, current entry reflection, keyboard navigation,
 *   and static stylesheet rules under jsdom.
 * @inputs Synthetic DOM click and keydown events; viewport coordinates; StyleId identifiers and StyleEntry definitions.
 * @outputs Vitest assertions verifying DOM attributes (aria-label, aria-selected, aria-disabled, hidden, class, style),
 *   callback selection records, and CSS rule presence and font-size scaling.
 * @functions
 *   - mount: Installs a fresh StylesGallery instance attached to document.body and returns a test harness.
 *   - entries: Queries all style entry elements within the styles gallery container.
 *   - entryFor: Locates a specific style entry within the styles gallery by its data-style-id attribute.
 *   - press: Dispatches a synthetic keydown KeyboardEvent to document simulating keyboard navigation.
 * @dataflow Synthetic user interactions -> StylesGallery event listeners -> DOM element updates and onPick callback -> test assertions.
 * @controlflow Mount StylesGallery -> execute interaction sequences across entry rendering, opening/picking, current entry tracking, keyboard navigation, and styles -> assert DOM attributes and callback state -> tear down galleries in afterEach.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  installStylesGallery,
  STYLE_ENTRIES,
  STYLES_GALLERY_STYLES,
  type StylesGallery,
  type StyleId,
} from '../src/shell/styles-gallery.js';

let galleries: StylesGallery[] = [];

afterEach(() => {
  // The panel mounts onto doc.body and would otherwise leak between tests.
  for (const gallery of galleries) {
    gallery.destroy();
  }
  galleries = [];
});

interface Harness {
  readonly gallery: StylesGallery;
  readonly picks: StyleId[];
  readonly root: HTMLElement;
}

/**
 * Installs a fresh StylesGallery instance attached to document.body and returns a test harness.
 *
 * @purpose Creates and mounts a StylesGallery controller tracking picks and registering it for test cleanup.
 * @inputs void.
 * @outputs Harness - The test harness containing gallery controller, picks history array, and root DOM element.
 * @dataflow installStylesGallery -> query root element on document.body -> register in galleries -> return harness.
 * @controlflow Initialize picks array -> instantiate gallery with document and window -> push to galleries -> query .kdoc-styles-gallery -> throw if null -> return harness.
 */
function mount(): Harness {
  const picks: StyleId[] = [];
  const gallery = installStylesGallery({
    doc: document,
    win: window,
    onPick: (id: StyleId): void => {
      picks.push(id);
    },
  });
  galleries.push(gallery);

  const root = document.querySelector<HTMLElement>('.kdoc-styles-gallery');
  // Check if root element was mounted to document.body.
  if (root === null) {
    // Missing root element: fail fast.
    throw new Error('Styles gallery root element not found on document.body');
  } else {
    // Root element found.
  }

  return { gallery, picks, root };
}

/**
 * Queries all style entry elements within the styles gallery container.
 *
 * @purpose Returns an array of HTMLElement instances corresponding to styles gallery entries.
 * @inputs root: HTMLElement - The root styles gallery container element.
 * @outputs HTMLElement[] - Array of entry DOM elements.
 * @dataflow root.querySelectorAll('.kdoc-styles-gallery-entry') -> Array.from -> HTMLElement[].
 * @controlflow Query all matching elements -> convert NodeList to Array -> return array.
 */
function entries(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.kdoc-styles-gallery-entry'));
}

/**
 * Locates a specific style entry within the styles gallery by its data-style-id attribute.
 *
 * @purpose Finds the entry element matching the specified style id or throws an Error.
 * @inputs
 *   - root: HTMLElement - The root styles gallery container element.
 *   - id: StyleId - The style identifier attribute value to find.
 * @outputs HTMLElement - The matching entry DOM element.
 * @dataflow root.querySelector with data-style-id selector -> validate found -> return entry.
 * @controlflow Query selector for data-style-id -> check if null -> throw descriptive Error if null -> return element.
 */
function entryFor(root: HTMLElement, id: StyleId): HTMLElement {
  const entry = root.querySelector<HTMLElement>(`[data-style-id="${id}"]`);
  // Check if entry with the specified data-style-id exists in the gallery root.
  if (entry === null) {
    // Entry not found: throw descriptive error.
    throw new Error(`Entry with data-style-id "${id}" not found`);
  } else {
    // Entry found.
  }
  return entry;
}

/**
 * Dispatches a synthetic keydown KeyboardEvent to document simulating keyboard navigation.
 *
 * @purpose Creates and dispatches a keyboard event simulating user key presses on document.
 * @inputs key: string - The KeyboardEvent key value (e.g. 'ArrowDown', 'Enter', 'Escape').
 * @outputs KeyboardEvent - The dispatched event instance.
 * @dataflow key -> KeyboardEvent -> document.dispatchEvent -> return event.
 * @controlflow Construct KeyboardEvent with bubbles and cancelable -> dispatch to document -> return event.
 */
function press(key: string): KeyboardEvent {
  // The listener is on the document as well as the panel because focus stays in the
  // editor behind it — a panel that only heard keys when focused would never hear one.
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe('the entries', () => {
  it('every gallery entry is rendered, in order', () => {
    const { root } = mount();
    const allEntries = entries(root);
    expect(allEntries.length).toBe(STYLE_ENTRIES.length);

    const ids = allEntries.map((el) => el.getAttribute('data-style-id'));
    const expectedIds = STYLE_ENTRIES.map((e) => e.id);
    expect(ids).toEqual(expectedIds);
  });

  it('each entry previews itself in its own style', () => {
    const { root } = mount();
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry: proceed with preview assertions.
      }

      const el = entryFor(root, entry.id);
      const preview = el.querySelector<HTMLElement>('.kdoc-styles-gallery-preview');
      // Check if preview element exists in entry.
      if (preview === null) {
        // Preview element missing: fail test.
        throw new Error(`Preview element not found for entry "${entry.id}"`);
      } else {
        // Preview element found.
      }

      // The preview class is the entire mechanism by which a gallery differs from a menu:
      // the entry is drawn in the style it applies.
      expect(preview.classList.contains(`kdoc-styles-preview-${entry.id}`)).toBe(true);
      expect(preview.textContent).toBe(entry.sample);
    }
  });

  it('the four groups are labelled', () => {
    const { root } = mount();
    const groupLabels = Array.from(
      root.querySelectorAll<HTMLElement>('.kdoc-styles-gallery-group-label'),
    ).map((el) => el.textContent);
    expect(groupLabels).toEqual(['Text', 'Headings', 'Blocks', 'Callouts']);
  });

  it('it starts hidden', () => {
    const { gallery, root } = mount();
    expect(root.hidden).toBe(true);
    expect(gallery.isOpen).toBe(false);
  });
});

describe('picking', () => {
  it('openAt shows and positions it', () => {
    const { gallery, root } = mount();
    gallery.openAt(40, 60);

    expect(root.hidden).toBe(false);
    expect(gallery.isOpen).toBe(true);

    // jsdom reports every measured size as 0, so openAt coordinates cannot be asserted for clamping.
    // We assert only that left and top styles were set at all.
    expect(root.style.left.length).toBeGreaterThan(0);
    expect(root.style.top.length).toBeGreaterThan(0);
  });

  it('clicking an entry reports its id and closes', () => {
    const { gallery, picks, root } = mount();
    gallery.openAt(40, 60);

    entryFor(root, 'heading-2').click();

    expect(picks).toEqual(['heading-2']);
    expect(gallery.isOpen).toBe(false);
  });

  it('a click while closed reports nothing', () => {
    const { picks, root } = mount();
    entryFor(root, 'heading-2').click();
    expect(picks).toEqual([]);
  });

  it('a disabled entry cannot be clicked', () => {
    const { gallery, picks, root } = mount();
    gallery.setEnabled('code-block', false);
    gallery.openAt(40, 60);

    // An entry the command refuses must not look clickable and then act clicked.
    entryFor(root, 'code-block').click();

    expect(picks).toEqual([]);
    expect(gallery.isOpen).toBe(true);
  });

  it('setEnabled marks the entry', () => {
    const { gallery, root } = mount();
    const entry = entryFor(root, 'code-block');

    gallery.setEnabled('code-block', false);
    expect(entry.classList.contains('kdoc-styles-gallery-entry-disabled')).toBe(true);
    expect(entry.getAttribute('aria-disabled')).toBe('true');

    gallery.setEnabled('code-block', true);
    expect(entry.classList.contains('kdoc-styles-gallery-entry-disabled')).toBe(false);
    expect(entry.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('the current entry', () => {
  it('setCurrent marks exactly one', () => {
    const { gallery, root } = mount();
    gallery.setCurrent('quote');

    const currentEntries = root.querySelectorAll('.kdoc-styles-gallery-entry-current');
    expect(currentEntries.length).toBe(1);

    const target = entryFor(root, 'quote');
    expect(target.classList.contains('kdoc-styles-gallery-entry-current')).toBe(true);
    expect(target.getAttribute('aria-selected')).toBe('true');
  });

  it('setCurrent(null) clears every mark', () => {
    const { gallery, root } = mount();
    gallery.setCurrent('quote');
    gallery.setCurrent(null);

    const currentClasses = root.querySelectorAll('.kdoc-styles-gallery-entry-current');
    expect(currentClasses.length).toBe(0);

    const currentAria = root.querySelectorAll('[aria-selected]');
    expect(currentAria.length).toBe(0);
  });

  it('opening starts on the current entry', () => {
    const { gallery, picks } = mount();
    gallery.setCurrent('callout-tip');
    gallery.openAt(40, 60);

    press('Enter');

    expect(picks).toEqual(['callout-tip']);
  });

  it('opening falls back to the first enabled entry when the current one is disabled', () => {
    const { gallery, picks } = mount();
    gallery.setCurrent('code-block');
    gallery.setEnabled('code-block', false);
    gallery.openAt(40, 60);

    // Opening on a tile that cannot be picked would put Enter on a dead key.
    press('Enter');

    expect(picks).toEqual(['normal']);
  });
});

describe('keyboard', () => {
  it('ArrowDown and ArrowUp walk the list', () => {
    const { gallery, picks } = mount();
    gallery.openAt(40, 60);

    press('ArrowDown');
    press('ArrowDown');
    press('Enter');

    expect(picks).toEqual(['heading-2']);
  });

  it('they skip a disabled entry', () => {
    const { gallery, picks } = mount();
    gallery.setEnabled('heading-1', false);
    gallery.openAt(40, 60);

    // Skipping is what makes the arrow keys agree with the mouse, which also cannot land on a disabled entry.
    press('ArrowDown');
    press('Enter');

    expect(picks).toEqual(['heading-2']);
  });

  it('they stop at the ends rather than wrapping', () => {
    const { gallery, picks } = mount();
    gallery.openAt(40, 60);

    // Wrapping would make the last entry one keypress from the first, which is a surprise in a list this long.
    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');

    expect(picks).toEqual(['normal']);
  });

  it('Home and End jump to the ends', () => {
    const { gallery, picks } = mount();
    gallery.openAt(40, 60);

    press('End');
    press('Enter');

    const lastEntry = STYLE_ENTRIES[STYLE_ENTRIES.length - 1];
    // Check if last entry is defined under strict indexing.
    if (lastEntry === undefined) {
      // Last entry missing: fail test.
      throw new Error('STYLE_ENTRIES is empty');
    } else {
      // Last entry defined.
    }

    expect(picks).toEqual([lastEntry.id]);
  });

  it('every navigation key is prevented', () => {
    const { gallery } = mount();
    gallery.openAt(40, 60);

    // The same keys would otherwise scroll the document behind the panel.
    const keys: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // Check if key is defined under strict indexing.
      if (key === undefined) {
        // Skip undefined key.
        continue;
      } else {
        // Valid key.
      }
      expect(press(key).defaultPrevented).toBe(true);
    }
  });

  it('Escape closes without picking', () => {
    const { gallery, picks } = mount();
    gallery.openAt(40, 60);

    press('Escape');
    expect(gallery.isOpen).toBe(false);
    expect(picks).toEqual([]);
  });

  it('keys do nothing while closed', () => {
    const { gallery, picks } = mount();

    press('Enter');
    expect(picks).toEqual([]);
    expect(gallery.isOpen).toBe(false);
  });
});

describe('the styles', () => {
  it('the panel hides when hidden', () => {
    expect(STYLES_GALLERY_STYLES).toContain('.kdoc-styles-gallery[hidden]');
  });

  it('it scrolls rather than growing past the window', () => {
    // Fourteen entries do not fit on a short window.
    expect(STYLES_GALLERY_STYLES).toContain('max-height');
    expect(STYLES_GALLERY_STYLES).toContain('overflow-y: auto');
  });

  it('every entry has a preview rule', () => {
    // An entry with no rule would render as plain text and silently stop being a preview.
    for (let i = 0; i < STYLE_ENTRIES.length; i++) {
      const entry = STYLE_ENTRIES[i];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry.
      }
      expect(STYLES_GALLERY_STYLES).toContain(`.kdoc-styles-preview-${entry.id}`);
    }
  });

  it('the six headings are a visible scale', () => {
    // Six identical rules would be six labels, not a scale.
    const headingIds: readonly string[] = [
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
    ];
    const fontSizes: number[] = [];

    for (let i = 0; i < headingIds.length; i++) {
      const id = headingIds[i];
      // Check if heading id is defined under strict indexing.
      if (id === undefined) {
        // Skip undefined id.
        continue;
      } else {
        // Valid heading id.
      }

      const pattern = new RegExp(`\\.kdoc-styles-preview-${id}\\s*\\{[^}]*font-size:\\s*(\\d+)px`);
      const match = STYLES_GALLERY_STYLES.match(pattern);

      // Guard a missing match for the heading preview font-size rule.
      if (match === null) {
        // Missing pattern match: fail test.
        throw new Error(`Font size not found for heading preview rule ".kdoc-styles-preview-${id}"`);
      } else {
        // Match found: extract numeric font-size value.
        const sizeStr = match[1];
        // Check if captured font size string exists under strict indexing.
        if (sizeStr === undefined) {
          // Missing captured group: fail test.
          throw new Error(`Captured font-size string is undefined for "${id}"`);
        } else {
          // Valid size string: push numeric value.
          fontSizes.push(Number(sizeStr));
        }
      }
    }

    expect(fontSizes.length).toBe(6);

    for (let i = 1; i < fontSizes.length; i++) {
      const current = fontSizes[i];
      const previous = fontSizes[i - 1];
      // Check if current and previous font sizes are defined under strict indexing.
      if (current === undefined || previous === undefined) {
        // Undefined array element: fail test.
        throw new Error('Font size elements undefined during strictly decreasing assertion');
      } else {
        // Both elements defined: assert strictly decreasing font size.
        expect(current).toBeLessThan(previous);
      }
    }
  });
});
