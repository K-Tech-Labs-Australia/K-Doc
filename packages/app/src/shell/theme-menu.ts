/**
 * @file theme-menu.ts
 * @purpose Implements an accessible popover (WAI-ARIA menu) opened by the title-bar theme button, offering light/dark/system mode toggles and a catalogue of built-in UI themes with colour swatches. Built imperatively via createElement/textContent only; styling is provided as a token-only CSS string.
 * @inputs ThemeMenuOptions: owner Document, anchor HTMLElement (the trigger button), a state() accessor returning fresh ThemeMenuState on each render, and callbacks for mode/theme selection.
 * @outputs A ThemeMenu handle exposing isOpen plus open/close/toggle/destroy; also exports the THEME_MENU_STYLES CSS string used by the host stylesheet loader.
 * @functions
 *   - installThemeMenu: Wires up DOM listeners, builds the menu element tree via render(), and returns a control object.
 *   - render (inner): Rebuilds every child of the menu from current state (mode group + theme catalogue).
 *   - position (inner): Lays out the menu beneath the anchor while keeping it inside the window viewport.
 *   - items (inner): Selects all live menu-itemradio buttons for keyboard navigation.
 * @dataflow options.state() -> render() builds DOM tree with aria-checked/title/swatch backgrounds from uiThemeSwatch -> listeners mutate state via callbacks and re-render; position() reads anchor rect to set CSS top/left.
 * @controlflow installThemeMenu sets initial ARIA attributes, appends hidden menu, attaches keydown/pointer listeners under one AbortController, returns handle; open()/close() guard on `open`, render+position as needed; destroy tears down all state and DOM.
 * @version 1
 * @date 2026-10-06
 */

import { UI_THEME_IDS, UI_THEMES, uiThemeSwatch, type ThemeMode, type ThemeModeName, type UiThemeId } from '@k-doc/config';

/**
 * The three mode options offered in the menu's Mode group.
 * @constant Ordered list of selectable modes with their display labels; index order defines tab/arrow traversal order within the group.
 */
const MODES: readonly { value: ThemeMode; label: string }[] = [
  // System defers to the OS preference, resolved later by resolveUiTheme via state.resolvedMode.
  { value: 'system', label: 'System' },
  // Explicit light forces the light token variant regardless of OS setting.
  { value: 'light', label: 'Light' },
  // Explicit dark forces the dark token variant regardless of OS setting.
  { value: 'dark', label: 'Dark' },
];

/** @constant Gap in pixels between the anchor's bottom edge and the menu's top edge (MENU_GAP_PX = 6). */
const MENU_GAP_PX = 6;

/** @constant Minimum clearance, in pixels, kept from every window edge so the popover never clips (VIEWPORT_MARGIN_PX = 8). */
const VIEWPORT_MARGIN_PX = 8;

/**
 * CSS rules for the theme menu and its swatch components.
 * @constant Token-only stylesheet consumed by the host app's style injector; uses only --kdoc-* design tokens so it adapts to any active theme without hard-coded colours.
 */
export const THEME_MENU_STYLES: string = `
.kdoc-theme-menu { position: fixed; z-index: 1000; width: 260px; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 2px; background: var(--kdoc-chrome-container-low); color: var(--kdoc-chrome-text); border: 1px solid var(--kdoc-chrome-glass-edge); border-radius: var(--kdoc-radius-lg); box-shadow: 0 8px 24px var(--kdoc-chrome-shadow-dark); font-size: 13px; }
.kdoc-theme-menu[hidden] { display: none; }
.kdoc-theme-menu-heading { padding: 6px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--kdoc-chrome-text-muted); }
.kdoc-theme-menu-modes { display: flex; gap: 2px; padding: 2px; border-radius: var(--kdoc-radius-md); background: var(--kdoc-chrome-raised); }
.kdoc-theme-menu-mode { flex: 1; height: 28px; border: 0; border-radius: var(--kdoc-radius-sm); background: transparent; color: var(--kdoc-chrome-text-muted); font: inherit; font-size: 12px; cursor: pointer; }
.kdoc-theme-menu-mode[aria-checked="true"] { background: var(--kdoc-chrome-selected); color: var(--kdoc-chrome-on-selected); font-weight: 600; }
.kdoc-theme-menu-separator { height: 1px; margin: 6px 4px; background: var(--kdoc-chrome-glass-edge); }
.kdoc-theme-menu-item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 8px; border: 0; border-radius: var(--kdoc-radius-sm); background: transparent; color: var(--kdoc-chrome-text); font: inherit; text-align: left; cursor: pointer; }
.kdoc-theme-menu-item:hover, .kdoc-theme-menu-mode:hover:not([aria-checked="true"]) { background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent); }
.kdoc-theme-menu-item[aria-checked="true"] { background: var(--kdoc-chrome-selected); color: var(--kdoc-chrome-on-selected); font-weight: 600; }
.kdoc-theme-menu-item:focus-visible, .kdoc-theme-menu-mode:focus-visible { outline: 2px solid var(--kdoc-chrome-accent); outline-offset: -2px; }
.kdoc-theme-swatch { display: inline-flex; flex-shrink: 0; }
.kdoc-theme-swatch-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--kdoc-chrome-edge); box-sizing: border-box; }
.kdoc-theme-swatch-dot + .kdoc-theme-swatch-dot { margin-left: -3px; }
.kdoc-theme-menu-label { flex: 1; }
.kdoc-theme-menu-check { visibility: hidden; color: var(--kdoc-chrome-accent); }
.kdoc-theme-menu-item[aria-checked="true"] .kdoc-theme-menu-check { visibility: visible; color: inherit; }
`;

/**
 * Immutable snapshot of the theme settings read fresh on every render.
 */
export interface ThemeMenuState { readonly mode: ThemeMode; readonly uiTheme: UiThemeId; readonly resolvedMode: ThemeModeName; }

/**
 * Configuration and callbacks passed to installThemeMenu().
 */
export interface ThemeMenuOptions {
  /** Owner document that hosts the menu element tree. */
  readonly doc: Document;
  /** The theme button whose popover this is; placed under by position() and refocused on dismiss. */
  readonly anchor: HTMLElement;
  /** Reads a fresh ThemeMenuState on every render so external state changes are reflected immediately. */
  readonly state: () => ThemeMenuState;
  /** Invoked when the user picks a mode from the Mode group. */
  readonly onChooseMode: (mode: ThemeMode) => void;
  /** Invoked when the user picks a theme from the catalogue, then closes the menu. */
  readonly onChooseTheme: (id: UiThemeId) => void;
}

/**
 * Handle returned by installThemeMenu() controlling popover lifecycle.
 */
export interface ThemeMenu { readonly isOpen: boolean; open(): void; close(): void; toggle(): void; destroy(): void; }

/**
 * Installs an accessible theme-selection menu anchored to a title-bar button.
 * @purpose Creates and wires the WAI-ARIA menu popover (mode group + themed catalogue with swatches) for the given anchor, returning a handle that controls its open/close lifecycle until destroyed.
 * @inputs options - Owner Document, trigger HTMLElement, fresh state() accessor, and onChooseMode/onChooseTheme callbacks.
 * @outputs ThemeMenu - Handle exposing isOpen plus open()/close()/toggle()/destroy().
 * @dataflow Anchor ARIA initialised -> hidden menu appended to body -> render/position/listeners bound under one AbortController -> handle returned; lifecycle methods mutate shared `open` and DOM state.
 * @controlflow Set initial aria-haspopup/aria-expanded, build+append hidden menu, define helpers (render/position/items), attach keydown on menu + pointerdown capture on document via an AbortController, then return the control object with a live isOpen getter.
 */
export function installThemeMenu(options: ThemeMenuOptions): ThemeMenu {
  const doc = options.doc;
  const anchor = options.anchor;

  // Announce to assistive tech that activating the trigger opens a menu of choices.
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');

  const menu = doc.createElement('div');
  menu.className = 'kdoc-theme-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Theme');
  menu.hidden = true;
  doc.body.appendChild(menu);

  // Shared open flag driving all lifecycle guards and the public isOpen getter.
  let isOpen = false;

  /**
   * Builds the menu element tree from current state, replacing all prior children and re-attaching listeners per node.
   * @purpose Re-renders every mode button and theme item so aria-checked/title/swatch colours always reflect options.state() at call time.
   * @inputs None beyond closure-bound `menu` (the host div) and `options` (state accessor + callbacks).
   * @outputs void; mutates the menu's child nodes in place.
   * @dataflow options.state() -> per-mode aria-checked, per-theme title/swatch backgrounds/labels/checks -> appended into menu.
   * @controlflow Clear existing children first; append Mode heading + group (one radio button per MODES entry); separator; Theme heading; one item per UI_THEME_IDS; each click handler invokes the matching callback and re-renders or closes as required.
   */
  function render(): void {
    // Remove all prior nodes so a fresh, consistent tree is built from state on every call.
    while (menu.firstChild) {
      menu.removeChild(menu.firstChild);
    }

    const s = options.state();

    // Section heading for the mode group; static label with no interactivity.
    const modeHeading = doc.createElement('div');
    modeHeading.className = 'kdoc-theme-menu-heading';
    modeHeading.textContent = 'Mode';
    menu.appendChild(modeHeading);

    // Group wrapping the three mutually-exclusive mode radios (single selection semantics).
    const modesDiv = doc.createElement('div');
    modesDiv.setAttribute('role', 'group');
    modesDiv.setAttribute('aria-label', 'Mode');
    modesDiv.className = 'kdoc-theme-menu-modes';
    menu.appendChild(modesDiv);

    // One radio button per mode; aria-checked tracks the currently selected value from state.
    for (const entry of MODES) {
      const value = entry.value;
      const label = entry.label;

      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'kdoc-theme-menu-mode';
      button.setAttribute('role', 'menuitemradio');
      // data-mode stores the raw mode so post-render focus can locate its node without re-reading state.
      button.dataset.mode = value;
      button.textContent = label;

      const isChecked = value === s.mode;
      if (isChecked) {
        // Selected mode is announced to assistive tech via aria-checked="true".
        button.setAttribute('aria-checked', 'true');
      } else {
        // Unselected modes are explicitly unchecked so the radio group state is unambiguous.
        button.setAttribute('aria-checked', 'false');
      }

      button.addEventListener('click', () => {
        // Notify owner of new mode, then re-render so aria-checked updates reflect the change.
        options.onChooseMode(value);
        render();

        // Stay open and move focus to the newly rendered radio for this same mode (stay-open behaviour).
        const target = menu.querySelector<HTMLButtonElement>(`[data-mode="${value}"]`);
        // The re-render replaced the button that was clicked; focus its successor when it exists.
        if (target !== null) {
          target.focus();
        }
      });

      modesDiv.appendChild(button);
    }

    // Visual divider between the Mode group and the Theme catalogue.
    const separator = doc.createElement('div');
    separator.setAttribute('role', 'separator');
    separator.className = 'kdoc-theme-menu-separator';
    menu.appendChild(separator);

    // Section heading for the theme catalogue below the separator.
    const themeHeading = doc.createElement('div');
    themeHeading.className = 'kdoc-theme-menu-heading';
    themeHeading.textContent = 'Theme';
    menu.appendChild(themeHeading);

    // One selectable item per built-in theme, rendered in UI_THEME_IDS order with a live colour swatch.
    for (const id of UI_THEME_IDS) {
      const description = UI_THEMES[id].description;
      const labelValue = UI_THEMES[id].label;

      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'kdoc-theme-menu-item';
      item.setAttribute('role', 'menuitemradio');
      // data-theme records the theme id for potential post-render lookups.
      item.dataset.theme = id;

      const isThemeChecked = id === s.uiTheme;
      if (isThemeChecked) {
        // Selected theme shows its check mark and selected styling via aria-checked="true".
        item.setAttribute('aria-checked', 'true');
      } else {
        // Unselected themes are explicitly unchecked.
        item.setAttribute('aria-checked', 'false');
      }

      // Tooltip exposes the human-readable description for accessibility and hover context.
      item.title = description;

      const swatch = doc.createElement('span');
      swatch.className = 'kdoc-theme-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      // Swatch reflects the theme's colours under the currently resolved (light/dark) mode so previews match live rendering.
      const colours = uiThemeSwatch(id, s.resolvedMode);

      for (const colour of colours) {
        const dot = doc.createElement('span');
        dot.className = 'kdoc-theme-swatch-dot';
        // Each swatch dot is painted with one element of the frozen [base, accent, tertiary] tuple.
        dot.style.background = colour;
        swatch.appendChild(dot);
      }

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'kdoc-theme-menu-label';
      labelSpan.textContent = labelValue;

      const checkSpan = doc.createElement('span');
      checkSpan.className = 'kdoc-theme-menu-check';
      checkSpan.setAttribute('aria-hidden', 'true');
      // Unicode check mark shown only when the theme is selected (CSS toggles visibility).
      checkSpan.textContent = '\u2713';

      item.appendChild(swatch);
      item.appendChild(labelSpan);
      item.appendChild(checkSpan);

      const chosenThemeId: UiThemeId = id;

      item.addEventListener('click', () => {
        // Notify owner of the new theme, then close and return focus to the trigger button.
        options.onChooseTheme(chosenThemeId);
        close();
        anchor.focus();
      });

      menu.appendChild(item);
    }
  }

  /**
   * Positions the popover directly beneath the anchor while clamping it inside the window viewport.
   * @purpose Computes left/top so the menu sits under the trigger with a fixed gap and never clips against any window edge (left, right).
   * @inputs None beyond closure-bound `anchor` (source rect) and `menu` (measured width).
   * @outputs void; writes CSS top/left to menu.style.
   * @dataflow anchor.getBoundingClientRect() -> candidate left from right alignment -> clamp [VIEWPORT_MARGIN_PX, innerWidth - width - margin] -> applied as px strings.
   * @controlflow Derive initial left from the anchor's right edge minus measured width (fallback 260px); enforce a hard left margin; when a view exists cap against the right edge then re-enforce the left margin to avoid over-correction.
   */
  function position(): void {
    const r = anchor.getBoundingClientRect(); // Anchor rect in viewport coordinates, used for alignment and gap offset (all px).
    const win = doc.defaultView; // Window reference; null when document is detached from a live view.
    const width = menu.offsetWidth || 260; // Measured rendered width, falling back to the stylesheet default.

    let left = r.right - width; // Right-align the menu's right edge with the anchor's right edge (px).
    left = Math.max(VIEWPORT_MARGIN_PX, left); // Prevent clipping past the left window edge by enforcing a minimum margin.

    if (win !== null) {
      // When a live view is available, also prevent clipping past the right window edge via an upper cap.
      const cappedByRightEdge = Math.min(left, win.innerWidth - width - VIEWPORT_MARGIN_PX);
      left = Math.max(VIEWPORT_MARGIN_PX, cappedByRightEdge); // Re-apply the left margin after capping so both edges stay clear.
    }

    menu.style.top = `${r.bottom + MENU_GAP_PX}px`; // Place below the anchor with a fixed gap (px).
    menu.style.left = `${left}px`;
  }

  /**
   * Collects all live WAI-ARIA radio buttons in the menu for keyboard navigation.
   * @purpose Returns every [role=menuitemradio] element so arrow/home/end handlers can move focus across the full set of interactive items.
   * @inputs None beyond closure-bound `menu`.
   * @outputs HTMLButtonElement[] - The ordered list of selectable mode and theme buttons.
   * @dataflow menu.querySelectorAll('[role="menuitemradio"]') -> Array.from materialised into a plain array for index-based navigation.
   * @controlflow Single query-and-materialise with no branching; returns an empty array if the tree is momentarily unrendered.
   */
  function items(): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  }

  /**
   * Opens the popover, rendering it and moving focus to the selected theme item.
   * @purpose Makes the menu visible beneath the anchor, updates ARIA expanded state, and focuses the checked theme radio (falling back to the first) for immediate keyboard use.
   * @inputs None beyond closure-bound DOM handles and options.
   * @outputs void; sets open=true and mutates menu.hidden + aria-expanded on the anchor.
   * @dataflow Guarded by `open` -> render() rebuilds tree -> position() lays it out -> anchor ARIA updated -> focus set to checked item.
   * @controlflow Early return when already open (idempotent); otherwise flip state, show, lay out, announce expanded=true, and focus the selected theme radio or first available node.
   */
  function open(): void {
    if (isOpen) {
      // Already displayed: skip to keep rendering idempotent across repeated triggers.
      return;
    }

    isOpen = true;
    render();
    menu.hidden = false;
    position();
    anchor.setAttribute('aria-expanded', 'true');

    const all = items();
    // Only theme items count here: the checked mode button sits earlier in the list.
    const checkedThemeItem = all.find((el) => el.dataset.theme !== undefined && el.getAttribute('aria-checked') === 'true');
    // Focus the selected theme item, falling back to the first available radio when none is marked.
    (checkedThemeItem ?? all[0])?.focus();
  }

  /**
   * Closes the popover and restores the anchor's collapsed ARIA state without moving focus away from it permanently.
   * @purpose Hides the menu and sets aria-expanded="false" on the trigger; does not refocus so theme-click dismissal keeps focus where the user acted.
   * @inputs None beyond closure-bound `menu` and `anchor`.
   * @outputs void; sets open=false and mutates menu.hidden + aria-expanded.
   * @dataflow Guarded by `open` -> hide element -> update anchor ARIA to collapsed state.
   * @controlflow Early return when already closed (idempotent); otherwise flip state, hide the element, and announce expanded=false on the anchor.
   */
  function close(): void {
    if (!isOpen) {
      // Already hidden: skip to keep closing idempotent across stray events.
      return;
    }

    isOpen = false;
    menu.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
  }

  /**
   * Toggles the popover between open and closed states based on current status.
   * @purpose Convenience wrapper delegating to open() or close() depending on the live `open` flag, matching typical trigger-button behaviour.
   * @inputs None beyond closure-bound state.
   * @outputs void; results in either opening or closing the menu.
   * @dataflow Reads `open` -> routes to toggle target's logic (which handles render/position/focus or hide).
   * @controlflow Ternary branch: when open, close(); otherwise open(). No direct DOM mutation here.
   */
  function toggle(): void {
    if (isOpen) {
      // Currently displayed: dismiss it via the closing path.
      close();
    } else {
      // Not displayed: reveal it via the opening path.
      open();
    }
  }

  /**
   * Handles key presses inside the menu to provide standard WAI-ARIA menu navigation (Escape, arrows, Home/End).
   * @purpose Implements keyboard affordances: Escape closes and returns focus to the anchor; ArrowDown/Up cycle with wrap-around; Home/End jump to first/last item.
   * @inputs event - The KeyboardEvent dispatched on the menu element.
   * @outputs void; mutates focus or popover open state as dictated by the key.
   * @dataflow e.key -> branch (Escape / ArrowDown / ArrowUp / Home / End) -> close()/focus() calls against items().
   * @controlflow Guard with !open to ignore stray keys when hidden; switch on e.key; for arrows compute next index via modulo wrap-around, defaulting to 0 when nothing is focused.
   */
  function handleKeyDown(event: KeyboardEvent): void {
    if (!isOpen) {
      // Ignore keyboard input while the menu is closed so focus events elsewhere are unaffected.
      return;
    }

    const key = event.key;

    if (key === 'Escape') {
      // Escape dismisses and returns focus to the trigger button, restoring a predictable focus origin.
      event.preventDefault();
      close();
      anchor.focus();
      return;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      // Arrow keys move selection with wrap-around across all radios in DOM order.
      event.preventDefault();
      const list = items();
      const current = doc.activeElement as HTMLButtonElement | null;
      let index = 0;

      // With nothing focused, navigation starts from the first item.
      if (current !== null) {
        // Locate the currently focused radio so navigation continues from it rather than always item 0.
        const foundIndex = list.indexOf(current);
        if (foundIndex === -1) {
          // Focused element is not a menu radio: start at the first item instead of skipping ahead.
          index = 0;
        } else if (key === 'ArrowDown') {
          // Move down, wrapping from last back to first via modulo arithmetic.
          index = (foundIndex + 1) % list.length;
        } else {
          // Move up, wrapping from first back to last using a positive modulo of the offset.
          index = (foundIndex - 1 + list.length) % list.length;
        }
      }

      const nextItem = list[index];
      // The list can be empty while the menu is mid-render; only focus a real item.
      if (nextItem !== undefined) {
        nextItem.focus();
      }
      return;
    }

    if (key === 'Home') {
      // Home jumps to the first selectable item in the menu.
      event.preventDefault();
      const firstItem = items()[0];
      // Only focus when the menu has items.
      if (firstItem !== undefined) {
        firstItem.focus();
      }
      return;
    }

    if (key === 'End') {
      // End jumps to the last selectable item in the menu.
      event.preventDefault();
      const allList = items();
      const lastIndex = allList.length - 1;
      const lastItem = allList[lastIndex];
      // Only focus when the menu has items.
      if (lastItem !== undefined) {
        lastItem.focus();
      }
      return;
    }
  }

  /**
   * Dismisses the popover when a pointer press occurs outside both the menu and its anchor.
   * @purpose Implements click-outside-to-close: any non-menu, non-anchor pointerdown while open closes the menu so users can escape it without Escape or a direct selection.
   * @inputs event - The PointerEvent dispatched on document during capture phase.
   * @outputs void; calls close() when the target is external to the popover.
   * @dataflow e.target (Node) -> containment checks against menu and anchor -> close() if neither contains it.
   * @controlflow Guard with open first; then, only when a Node target exists, test containment both ways; skip clicks originating inside or on the trigger since those are handled by their own handlers.
   */
  function handlePointerDown(event: PointerEvent): void {
    if (!isOpen) {
      // Ignore pointer events while closed so outside-click logic never runs spuriously.
      return;
    }

    const target = event.target as Node | null;

    // Only a press outside both the menu and its button dismisses the menu.
    if (target !== null && !menu.contains(target) && !anchor.contains(target)) {
      // Press landed entirely outside the popover and its trigger: close to dismiss.
      close();
    }
  }

  const controller = new AbortController();
  const { signal } = controller;

  menu.addEventListener('keydown', handleKeyDown, { signal });
  doc.addEventListener('pointerdown', handlePointerDown, { capture: true, signal });

  return {
    get isOpen(): boolean {
      // Reflects the live internal state without exposing mutable internals.
      return isOpen;
    },
    open,
    close,
    toggle,
    destroy(): void {
      controller.abort(); // Detaches both keydown and pointerdown listeners registered under this signal.
      menu.remove(); // Removes the popover from the DOM entirely.
      anchor.removeAttribute('aria-expanded'); // Restores the trigger's ARIA to its pre-install collapsed state.
      anchor.removeAttribute('aria-haspopup'); // Clears the menu-popover announcement on the trigger.
      isOpen = false; // Marks the handle as fully torn down so late calls become no-ops.
    },
  };
}
