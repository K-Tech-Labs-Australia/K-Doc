// @vitest-environment jsdom
/**
 * @file theme-menu.spec.ts
 * @purpose Behavioural tests for the WAI-ARIA theme popover installed by installThemeMenu(), covering open/close lifecycle, ARIA state, keyboard navigation and click-outside dismissal under jsdom.
 * @inputs Mounted ThemeMenu handles produced by mount(); global DOM helpers query the menu tree; vitest matchers assert on rendered attributes and focus.
 * @outputs void; no return values — assertions only via expect(). Exposes helper functions: mount, at, menuElement, themeItems, modeButtons, allItems, key.
 * @functions
 *   - mount: Creates an anchor button + installThemeMenu() instance, registers it for teardown, and returns a Mounted handle with state accessors and spies.
 *   - at: Safe indexed accessor that throws instead of returning undefined under noUncheckedIndexedAccess.
 *   - menuElement: Returns the .kdoc-theme-menu root or throws if not mounted.
 *   - themeItems / modeButtons / allItems: Materialise live button lists for a given selector/role.
 *   - key: Dispatches a bubbling KeyboardEvent on the menu element to drive keyboard handlers.
 * @dataflow mount() -> installThemeMenu builds DOM under document.body -> tests query that tree via helpers and dispatch events -> assertions read resulting attributes/focus state.
 * @controlflow beforeEach-independent per-test mount -> open()/toggle() reveal menu -> event/keyboard interactions mutate shared handle state -> afterEach destroys every mounted instance and clears body.
 * @version 1
 * @date 2026-10-06
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_THEME_IDS, UI_THEMES, type ThemeMode, type UiThemeId } from '@k-doc/config';
import { installThemeMenu, type ThemeMenu } from '../src/shell/theme-menu.js';

interface Mounted {
  readonly anchor: HTMLButtonElement;
  readonly menu: ThemeMenu;
  readonly state: { mode: ThemeMode; uiTheme: UiThemeId };
  readonly onChooseMode: ReturnType<typeof vi.fn>;
  readonly onChooseTheme: ReturnType<typeof vi.fn>;
}

// Track every installed handle so afterEach can tear them all down deterministically.
const mounted: ThemeMenu[] = [];

/**
 * Creates a fresh anchor button and theme menu, registering the instance for cleanup.
 * @purpose Provides an isolated DOM fixture with mutable state accessors and selection spies shared across assertions in one test.
 * @inputs None; reads document.body to append the trigger button.
 * @outputs Mounted - Handle exposing anchor, live ThemeMenu handle, mutable state object, and vi.fn spies for mode/theme choices.
 * @dataflow New <button> -> installThemeMenu with a state() closure over local `state` -> instance pushed into global mounted registry.
 * @controlflow Build button + append -> construct spy callbacks that mutate shared state -> install menu -> return combined handle.
 */
function mount(): Mounted {
  const anchor = document.createElement('button');
  anchor.textContent = 'Theme';
  document.body.appendChild(anchor);

  // Mutable settings snapshot read fresh on every render via the state() accessor.
  const state = { mode: 'system' as ThemeMode, uiTheme: 'nord' as UiThemeId };

  // Spy records chosen modes and reflects them into shared state so re-renders pick up the change.
  const onChooseMode = vi.fn((mode: ThemeMode) => {
    state.mode = mode;
  });
  // Spy records chosen theme ids without side effects (menu closes independently).
  const onChooseTheme = vi.fn();

  const menu = installThemeMenu({
    doc: document,
    anchor,
    state: () => ({ mode: state.mode, uiTheme: state.uiTheme, resolvedMode: 'light' }),
    onChooseMode,
    onChooseTheme,
  });

  // Register for teardown so no listener or DOM node leaks between tests.
  mounted.push(menu);

  return { anchor, menu, state, onChooseMode, onChooseTheme };
}

/**
 * Returns the list item at index i, throwing a descriptive error when out of range.
 * @purpose Avoids undefined results from indexed access under noUncheckedIndexedAccess during assertions.
 * @inputs list - Read-only array to read from; i - Zero-based position requested.
 * @outputs T - The element stored at position i.
 * @dataflow list[i] -> guard against undefined -> return value or throw.
 * @controlflow Single bounds check with early throw before returning the dereferenced element.
 */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) {
    // Index beyond array length is a test bug, not recoverable data — fail loudly.
    throw new Error(`no item ${i}`);
  }
  return v;
}

/**
 * Returns the mounted theme-menu root element or throws when it has not been created yet.
 * @purpose Centralised lookup so tests never handle a null menu node inline.
 * @inputs None beyond document body state left by mount().
 * @outputs HTMLElement - The .kdoc-theme-menu div.
 * @dataflow querySelector result -> guard against unmounted case -> return element.
 * @controlflow Query then early throw when the selector matches nothing (menu not installed).
 */
function menuElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.kdoc-theme-menu');
  if (el === null) {
    // Menu must exist after mount(); a missing node indicates install failed.
    throw new Error('menu not mounted');
  }
  return el;
}

/** Returns every rendered theme catalogue item button in DOM order. */
function themeItems(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.kdoc-theme-menu-item'));
}

/** Returns every mode-group radio button (System, Light, Dark) in DOM order. */
function modeButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.kdoc-theme-menu-mode'));
}

/** Returns all live [role=menuitemradio] buttons for keyboard navigation tests. */
function allItems(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
}

/**
 * Dispatches a key press onto the menu element to exercise handleKeyDown.
 * @purpose Simulates user keyboard input without needing real focus on the host document.
 * @inputs name - The KeyboardEvent.key value (e.g. 'ArrowDown', 'Escape').
 * @outputs void; relies on event bubbling reaching the menu's keydown listener.
 * @dataflow new KeyboardEvent -> dispatch on menu root -> bubbles to attached handler.
 * @controlflow Construct event with bubbles:true then dispatch unconditionally.
 */
function key(name: string): void {
  menuElement().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

/**
 * Tears down every mounted instance and clears the body for the next test.
 * @purpose Guarantees isolation by destroying handles (removing listeners + DOM) before resetting document.body.
 * @inputs None; consumes the global mounted registry via splice to drain it in one pass.
 * @outputs void.
 * @dataflow mounted.splice(0) -> each handle.destroy() clears its own state/body node -> body.replaceChildren wipes residual nodes.
 * @controlflow Drain array first (destroy may not mutate this array), then clear any orphaned DOM left behind.
 */
afterEach(() => {
  for (const m of mounted.splice(0)) {
    // destroy() detaches listeners and removes the menu div plus ARIA attributes on its anchor.
    m.destroy();
  }
  document.body.replaceChildren();
});

describe('the theme menu', () => {
  it('starts closed and announces a menu popup', () => {
    const { anchor, menu } = mount();

    // Menu begins hidden with collapsed ARIA so assistive tech treats the trigger as non-expanding.
    expect(menuElement().hidden).toBe(true);
    expect(anchor.getAttribute('aria-haspopup')).toBe('menu');
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    expect(menu.isOpen).toBe(false);
  });

  it('opens with the three modes and the six themes in order', () => {
    const { anchor, menu } = mount();
    menu.open();

    // Opening reveals the popover and flips the expanded announcement on the trigger.
    expect(menuElement().hidden).toBe(false);
    expect(anchor.getAttribute('aria-expanded')).toBe('true');

    // Mode group renders exactly System, Light, Dark in that fixed order.
    expect(modeButtons().map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark']);

    // Theme catalogue preserves the canonical UI_THEME_IDS ordering via data-theme attributes.
    expect(themeItems().map((b) => b.dataset.theme)).toEqual([...UI_THEME_IDS]);

    // Each item's visible label matches its configured theme label in id order.
    const labels = themeItems()
      .map((b) => b.querySelector<HTMLElement>('.kdoc-theme-menu-label')?.textContent ?? '');
    expect(labels).toEqual(UI_THEME_IDS.map((id) => UI_THEMES[id].label));
  });

  it('marks the current mode and theme', () => {
    const { menu } = mount();
    menu.open();

    // Default state selects System; Light/Dark must be explicitly unchecked.
    expect(at(modeButtons(), 0).getAttribute('aria-checked')).toBe('true');
    expect(at(modeButtons(), 1).getAttribute('aria-checked')).toBe('false');
    expect(at(modeButtons(), 2).getAttribute('aria-checked')).toBe('false');

    // Selected theme (nord) is checked; every other catalogue item stays unchecked.
    for (const item of themeItems()) {
      const isChecked = item.getAttribute('aria-checked') === 'true';
      if (item.dataset.theme === 'nord') {
        expect(isChecked).toBe(true);
      } else {
        expect(isChecked).toBe(false);
      }
    }
  });

  it('focuses the current theme when it opens', () => {
    const { menu } = mount();
    menu.open();

    // The checked theme radio receives focus so keyboard users can immediately act.
    const nordItem = document.querySelector<HTMLButtonElement>('[data-theme="nord"]');
    expect(nordItem).not.toBeNull();
    expect(document.activeElement).toBe(nordItem);
  });

  it('paints three swatch dots per theme', () => {
    const { menu } = mount();
    menu.open();

    // Every catalogue item exposes a base/accent/tertiary colour swatch (3 dots each).
    for (const item of themeItems()) {
      expect(item.querySelectorAll('.kdoc-theme-swatch-dot').length).toBe(3);
    }
  });

  it('changes mode and stays open', () => {
    const { menu, onChooseMode } = mount();
    menu.open();

    // Activating Dark notifies the owner; the popover must remain visible (stay-open semantics).
    at(modeButtons(), 2).click();
    expect(onChooseMode).toHaveBeenCalledWith('dark');
    expect(menu.isOpen).toBe(true);

    // Re-render reflects the new selection and moves focus to the freshly built radio.
    expect(at(modeButtons(), 2).getAttribute('aria-checked')).toBe('true');
    const focused = document.activeElement as HTMLButtonElement | null;
    expect(focused?.dataset.mode).toBe('dark');
  });

  it('chooses a theme, closes and returns focus to the button', () => {
    const { anchor, menu, onChooseTheme } = mount();
    menu.open();

    // Selecting paper notifies the owner of that id.
    const paper = document.querySelector<HTMLButtonElement>('[data-theme="paper"]');
    expect(paper).not.toBeNull();
    // The null check above already failed the test if the item is missing.
    if (paper) {
      paper.click();
    }
    expect(onChooseTheme).toHaveBeenCalledWith('paper');

    // Choosing a theme dismisses the popover and restores focus to the trigger button.
    expect(menu.isOpen).toBe(false);
    expect(menuElement().hidden).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on Escape and returns focus', () => {
    const { anchor, menu } = mount();
    menu.open();

    // Escape dismisses the popover and returns focus to the trigger.
    key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('wraps arrow keys around the items', () => {
    const { menu } = mount();
    menu.open();

    // Capture the live item list once; navigation re-queries internally but DOM order is stable here.
    const items = allItems();
    expect(items.length).toBeGreaterThan(0);

    // Starting from the last item, ArrowDown wraps to the first.
    at(items, items.length - 1).focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(at(items, 0));

    // From the first item, ArrowUp wraps back to the last (re-read since no re-render occurred).
    key('ArrowUp');
    const current = allItems();
    expect(document.activeElement).toBe(at(current, current.length - 1));
  });

  it('jumps with Home and End', () => {
    const { menu } = mount();
    menu.open();

    // End jumps to the last selectable item.
    key('End');
    expect(document.activeElement).toBe(at(allItems(), allItems().length - 1));

    // Home jumps back to the first selectable item.
    key('Home');
    expect(document.activeElement).toBe(at(allItems(), 0));
  });

  it('closes on a press outside but not inside', () => {
    const { menu } = mount();
    menu.open();

    // A pointerdown inside the menu is ignored, leaving it open.
    menuElement().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(true);

    // A pointerdown outside both menu and anchor dismisses the popover (jsdom lacks PointerEvent; target read only).
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(false);
  });

  it('toggles open and closed', () => {
    const { menu } = mount();

    // First toggle opens the popover.
    menu.toggle();
    expect(menu.isOpen).toBe(true);

    // Second toggle closes it again.
    menu.toggle();
    expect(menu.isOpen).toBe(false);
  });

  it('renders one set of items however often it opens', () => {
    const { menu } = mount();

    // Opening twice does not duplicate catalogue items (open is idempotent while open).
    menu.open();
    menu.open();
    expect(themeItems().length).toBe(6);

    // Closing then re-opening rebuilds exactly one fresh set of items.
    menu.close();
    menu.open();
    expect(themeItems().length).toBe(6);
  });

  it('cleans up on destroy', () => {
    const m = mount();

    // Destroying removes the popover DOM and clears ARIA announcements on the trigger.
    m.menu.destroy();
    mounted.splice(mounted.indexOf(m.menu), 1);

    expect(document.querySelector('.kdoc-theme-menu')).toBeNull();
    expect(m.anchor.hasAttribute('aria-haspopup')).toBe(false);
  });
});