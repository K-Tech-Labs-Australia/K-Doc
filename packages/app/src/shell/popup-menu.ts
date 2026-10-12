/**
 * @file popup-menu.ts
 * @purpose Implements PopupMenu, a reusable anchored popup menu for K-Doc (FR-14.2 context menu and FR-14.4 slash insert menu).
 *   Renders an absolutely-positioned menu element on doc.body without taking focus from the editor, maintaining selection and edit lock.
 * @inputs PopupMenuOptions containing Document and Window context references, and PopupMenuEntry arrays passed to openAt.
 * @outputs PopupMenu controller instance exposing openAt, setFilter, close, isOpen, and destroy lifecycle methods, alongside POPUP_MENU_STYLES CSS definition.
 * @functions
 *   - installPopupMenu: Constructs the popup menu container, wires keyboard and outside-click listeners, and returns the PopupMenu controller.
 * @dataflow PopupMenuEntry array -> renderEntries DOM hierarchy -> keyboard/click navigation -> close menu -> execute item.run().
 * @controlflow Mount absolutely-positioned menu element to document body -> openAt positions, clamps, and renders entries -> keydown and outside-click listeners manage navigation and dismissal -> item execution closes menu and calls run().
 * @version 3
 * @date 2026-10-03
 */

export interface PopupMenuItem {
  readonly id: string;
  readonly label: string;
  /** Right-aligned hint, e.g. a shortcut. Empty string for none. */
  readonly hint: string;
  readonly enabled: boolean;
  run(): void;
}

/** A visual divider between groups. */
export interface PopupMenuSeparator {
  readonly separator: true;
}

export type PopupMenuEntry = PopupMenuItem | PopupMenuSeparator;

export interface PopupMenuOptions {
  readonly doc: Document;
  readonly win: Window;
}

export interface PopupMenu {
  /** Opens at viewport coordinates, clamped to stay on screen. */
  openAt(x: number, y: number, entries: readonly PopupMenuEntry[]): void;
  /** Filters the open menu's items by a query, for the slash menu's type-to-filter. */
  setFilter(query: string): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * Static stylesheet for the anchored popup menu, styling the Material 3 Expressive overlay panel,
 * separators, menu items, disabled state, active tonal selection, label,
 * and shortcut hint using exclusively authoritative K-Doc chrome design tokens.
 */
export const POPUP_MENU_STYLES: string = `
.kdoc-popup-menu {
  position: absolute;
  z-index: 1000;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-lg);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 4px;
  min-width: 240px;
  max-width: 320px;
  box-sizing: border-box;
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-height: calc(100vh - 32px);
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) transparent;
}

.kdoc-popup-menu::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-popup-menu::-webkit-scrollbar-track {
  background: transparent;
}

.kdoc-popup-menu::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-popup-menu::-webkit-scrollbar-thumb:hover {
  background: var(--kdoc-chrome-text-muted);
}

.kdoc-popup-menu[hidden] {
  display: none;
}

.kdoc-popup-menu-separator {
  height: 1px;
  background: var(--kdoc-chrome-glass-edge);
  margin: 6px 10px;
  padding: 0;
  border: none;
  flex-shrink: 0;
}

.kdoc-popup-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 0 6px;
  height: 36px;
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
  border-radius: var(--kdoc-radius-sm);
  border: none;
  transition: background 150ms ease, color 150ms ease, border-radius 150ms ease;
}

.kdoc-popup-menu-item:hover:not([aria-disabled="true"]),
.kdoc-popup-menu-item.kdoc-popup-menu-item-active,
.kdoc-popup-menu-item[aria-selected="true"],
.kdoc-popup-menu-item[aria-expanded="true"] {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-popup-menu-item:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-popup-menu-item[aria-disabled="true"] {
  cursor: not-allowed;
  color: color-mix(in srgb, var(--kdoc-chrome-text) 38%, transparent);
}

.kdoc-popup-menu-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-popup-menu-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--kdoc-chrome-text-muted);
  flex-shrink: 0;
  margin-left: auto;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-popup-menu,
  .kdoc-popup-menu-item {
    transition: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple popup menu instances. */
let nextPopupMenuId: number = 0;

/**
 * Installs an anchored popup menu into the document body, configuring positioning, keyboard navigation, and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts an absolutely-positioned menu element for right-click and slash insert commands.
 * @inputs options - PopupMenuOptions containing document and window DOM contexts.
 * @outputs PopupMenu - Controller exposing openAt, setFilter, close, isOpen, and destroy lifecycle methods.
 * @dataflow options -> DOM hierarchy -> openAt entries -> keyboard/click interaction -> item execution -> close().
 * @controlflow Create menu DOM element -> append to document body -> bind keydown and outside-click listeners with AbortController -> return PopupMenu controller.
 */
export function installPopupMenu(options: PopupMenuOptions): PopupMenu {
  const doc = options.doc;
  const win = options.win;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const menuId = ++nextPopupMenuId;
  const menuElementId = `kdoc-popup-menu-${menuId}`;

  let destroyed: boolean = false;
  let open: boolean = false;
  let allEntries: readonly PopupMenuEntry[] = [];
  let renderedEntries: readonly PopupMenuEntry[] = [];
  let activeIndex: number = -1;
  let openTimeoutId: ReturnType<typeof win.setTimeout> | null = null;

  // Construct container <div> element.
  // The popup menu is constructed as a plain absolutely-positioned <div> appended to doc.body, rather than a native <dialog>.
  // This differs intentionally from command-palette.ts: a context menu must not take focus away from the editor,
  // because the commands it runs act on the current selection and a modal dialog would blur the pane and collapse it.
  // command-palette.ts uses showModal() for exactly the opposite reason.
  const menuEl = doc.createElement('div');
  menuEl.id = menuElementId;
  menuEl.className = 'kdoc-popup-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.setAttribute('aria-label', 'Popup Menu');
  menuEl.hidden = true;

  /**
   * Executes a chosen popup menu item, closing the menu first to preserve editor focus and lock.
   *
   * @purpose Closes the popup menu before executing the item callback so editor focus and edit lock are maintained.
   * @inputs item - The PopupMenuItem to execute.
   * @outputs void.
   * @dataflow item -> close() -> item.run().
   * @controlflow Close popup menu -> invoke item.run().
   */
  function executeItem(item: PopupMenuItem): void {
    // Running an item must close the menu before invoking run().
    // The editor commands focus the ProseMirror view as their last act, and K-Doc keys its edit
    // lock on which pane holds focus — running first would hand focus to the pane and then a closing
    // dialog would snatch it back, leaving the lock pointing at nothing.
    close();
    item.run();
  }

  /**
   * Synchronizes the active highlight and ARIA activedescendant attribute across rendered menu items.
   *
   * @purpose Updates aria-activedescendant on the menu container, aria-selected and active CSS classes on item elements, and scrolls the active item into view.
   * @inputs void.
   * @outputs void.
   * @dataflow activeIndex -> menuEl.aria-activedescendant & item element attributes -> scrollIntoView.
   * @controlflow Check if rendered entries exist and activeIndex is valid -> iterate children -> toggle aria-selected and active class -> update aria-activedescendant -> scroll active item into view.
   */
  function updateActiveItem(): void {
    // Check if rendered entries list is empty or activeIndex is uninitialized.
    if (renderedEntries.length === 0 || activeIndex < 0) {
      // Clear aria-activedescendant when no item is actively selected.
      menuEl.removeAttribute('aria-activedescendant');
      return;
    } else {
      // Entries present: synchronize active state across children.
    }

    for (let i = 0; i < menuEl.children.length; i++) {
      const child = menuEl.children[i];
      // Check if child element exists and is an HTMLElement under strict indexing.
      if (child === undefined || !(child instanceof HTMLElement)) {
        // Skip non-HTMLElement child or undefined index.
        continue;
      } else {
        // Valid HTMLElement child: check against active index.
      }

      // Check if this child matches the active index.
      if (i === activeIndex) {
        // Active item: set aria-selected, apply active CSS class, and point aria-activedescendant at its id.
        child.setAttribute('aria-selected', 'true');
        child.classList.add('kdoc-popup-menu-item-active');
        menuEl.setAttribute('aria-activedescendant', child.id);

        // Check if scrollIntoView is available in the current environment.
        if (typeof child.scrollIntoView === 'function') {
          // Scroll the active item into view nearest the visible boundary.
          child.scrollIntoView({ block: 'nearest' });
        } else {
          // scrollIntoView not available (e.g. jsdom test environment).
        }
      } else {
        // Inactive item: clear aria-selected and active class.
        child.removeAttribute('aria-selected');
        child.classList.remove('kdoc-popup-menu-item-active');
      }
    }
  }

  /**
   * Reconstructs the DOM hierarchy of popup menu items and separators based on current rendered entries.
   *
   * @purpose Clears existing child elements, creates menuitem and separator DOM nodes, wires click handlers, and updates active selection.
   * @inputs void.
   * @outputs void.
   * @dataflow renderedEntries -> DOM menuitem and separator elements -> updateActiveItem().
   * @controlflow Clear menu children -> iterate renderedEntries -> construct separator or menuitem with label and hint -> attach click listeners -> synchronize active item.
   */
  function renderEntries(): void {
    menuEl.replaceChildren();

    for (let i = 0; i < renderedEntries.length; i++) {
      const entry = renderedEntries[i];
      // Check if entry is defined to satisfy strict noUncheckedIndexedAccess.
      if (entry === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Entry defined: inspect entry type.
      }

      // Check if entry is a separator.
      if ('separator' in entry) {
        // Separator entry: construct divider element.
        const separatorEl = doc.createElement('div');
        separatorEl.id = `kdoc-popup-menu-sep-${menuId}-${i}`;
        separatorEl.className = 'kdoc-popup-menu-separator';
        separatorEl.setAttribute('role', 'separator');
        menuEl.appendChild(separatorEl);
      } else {
        // Menu item entry: construct item element.
        const item = entry;
        const itemId = `kdoc-popup-menu-item-${menuId}-${i}`;
        const itemEl = doc.createElement('div');
        itemEl.id = itemId;
        itemEl.className = 'kdoc-popup-menu-item';
        itemEl.setAttribute('role', 'menuitem');

        // Check whether the item is enabled.
        if (item.enabled) {
          // Enabled item: mark aria-disabled false.
          itemEl.setAttribute('aria-disabled', 'false');
        } else {
          // Disabled item: mark aria-disabled true for dimmed styling and screen reader announcement.
          itemEl.setAttribute('aria-disabled', 'true');
        }

        const labelSpan = doc.createElement('span');
        labelSpan.className = 'kdoc-popup-menu-label';
        labelSpan.textContent = item.label;
        itemEl.appendChild(labelSpan);

        // Check if the item specifies a hint (e.g. keyboard shortcut).
        if (item.hint !== '') {
          // Hint present: render hint label aligned to the right.
          const hintSpan = doc.createElement('span');
          hintSpan.className = 'kdoc-popup-menu-hint';
          hintSpan.textContent = item.hint;
          itemEl.appendChild(hintSpan);
        } else {
          // No hint specified for this item.
        }

        itemEl.addEventListener(
          'click',
          (): void => {
            // Check whether the item is enabled before executing.
            if (item.enabled) {
              // Item enabled: execute item action and close popup menu.
              executeItem(item);
            } else {
              // Item disabled: cannot be activated by click.
            }
          },
          { signal },
        );

        menuEl.appendChild(itemEl);
      }
    }

    updateActiveItem();
  }

  /**
   * Locates the index of the first enabled item in the rendered entries list.
   *
   * @purpose Finds the first non-separator item whose enabled property is true.
   * @inputs void.
   * @outputs number - The index of the first enabled item, or -1 if no enabled items exist.
   * @dataflow renderedEntries -> search loop -> index or -1.
   * @controlflow Iterate renderedEntries from index 0 -> check if entry is non-separator and enabled -> return index if found -> return -1 if exhausted.
   */
  function findFirstEnabledIndex(): number {
    for (let i = 0; i < renderedEntries.length; i++) {
      const entry = renderedEntries[i];
      // Check if entry exists under strict indexing.
      if (entry === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Entry exists: check type.
      }

      // Check if entry is a separator.
      if ('separator' in entry) {
        // Separator: skip.
        continue;
      } else if (entry.enabled) {
        // Enabled item found: return index.
        return i;
      } else {
        // Disabled item: skip.
        continue;
      }
    }

    return -1;
  }

  /**
   * Advances or rewinds the active item index, skipping separators and disabled items with circular wrap-around.
   *
   * @purpose Navigates between enabled menu items in response to ArrowDown and ArrowUp keyboard events.
   * @inputs direction - Navigation direction: 1 for forward (ArrowDown), -1 for backward (ArrowUp).
   * @outputs void.
   * @dataflow activeIndex & direction -> candidate index search -> activeIndex update -> updateActiveItem().
   * @controlflow Check if rendered entries exist -> loop up to renderedEntries.length steps -> check each candidate for enabled item -> if found, set activeIndex and update active item -> if none found, leave activeIndex unchanged.
   */
  function stepActiveIndex(direction: 1 | -1): void {
    const count = renderedEntries.length;
    // Check if there are rendered entries to navigate.
    if (count === 0) {
      // No entries: do nothing.
      return;
    } else {
      // Entries present: proceed to step.
    }

    // Determine starting search position.
    let start: number;
    if (activeIndex >= 0) {
      start = activeIndex;
    } else if (direction === 1) {
      start = -1;
    } else {
      start = 0;
    }

    // Search circularly for the next enabled item.
    for (let step = 1; step <= count; step++) {
      const candidate = (start + step * direction + count * count) % count;
      const entry = renderedEntries[candidate];
      // Check if candidate entry exists under strict indexing.
      if (entry === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Candidate entry exists: check type and enabled status.
      }

      // Check if entry is a separator.
      if ('separator' in entry) {
        // Separator: skip during keyboard navigation.
        continue;
      } else if (!entry.enabled) {
        // Disabled item: skip during keyboard navigation.
        continue;
      } else {
        // Found next enabled item: update activeIndex and refresh DOM attributes.
        activeIndex = candidate;
        updateActiveItem();
        return;
      }
    }

    // No enabled items found in rendered entries.
  }

  /**
   * Keyboard event listener managing menu item navigation, execution, and dismissal.
   *
   * @purpose Intercepts ArrowDown, ArrowUp, Enter, and Escape keys when the menu is open, executing actions or navigating options.
   * @inputs event - KeyboardEvent captured from menu or document listeners.
   * @outputs void.
   * @dataflow event.key -> stepActiveIndex() | executeItem() | close().
   * @controlflow Check destroyed and open guards -> route ArrowDown / ArrowUp -> route Enter to execute active item -> route Escape to close -> pass other keys through.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has already been destroyed or menu is not open.
    if (destroyed || !open) {
      // Component destroyed or menu closed: ignore keyboard event.
      return;
    } else {
      // Menu is open: inspect pressed key.
    }

    // Check if default has already been prevented by a preceding listener.
    if (event.defaultPrevented) {
      // Already handled: skip.
      return;
    } else {
      // Not yet handled: process key.
    }

    // Check if the pressed key is ArrowDown.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepActiveIndex(1);
    } else if (event.key === 'ArrowUp') {
      // Check if the pressed key is ArrowUp.
      event.preventDefault();
      stepActiveIndex(-1);
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if activeIndex is valid within rendered entries bounds.
      if (activeIndex >= 0 && activeIndex < renderedEntries.length) {
        const targetEntry = renderedEntries[activeIndex];
        // Check if target entry is defined under strict indexing and is not a separator.
        if (targetEntry !== undefined && !('separator' in targetEntry)) {
          // Check whether the targeted item is enabled.
          if (targetEntry.enabled) {
            // Item enabled: execute item action and close menu.
            executeItem(targetEntry);
          } else {
            // Item disabled: cannot be activated by Enter.
          }
        } else {
          // Target entry is undefined or a separator.
        }
      } else {
        // No active item selected.
      }
    } else if (event.key === 'Escape') {
      // Check if the pressed key is Escape.
      event.preventDefault();
      close();
    } else {
      // Other keys: pass through for standard handling.
    }
  }

  /**
   * Outside-click event listener closing the popup menu when the user clicks anywhere outside the menu container.
   *
   * @purpose Detects outside clicks and dismisses the open popup menu.
   * @inputs event - MouseEvent captured on document.
   * @outputs void.
   * @dataflow event.target -> container contains check -> close().
   * @controlflow Check destroyed and open guards -> inspect event.target -> if target outside menuEl, close menu.
   */
  function onDocClick(event: MouseEvent): void {
    // Check if component has been destroyed or menu is not currently open.
    if (destroyed || !open) {
      // Component destroyed or menu closed: ignore click.
      return;
    } else {
      // Menu is open: inspect click target.
    }

    // Check if click target is outside the menu container element.
    if (event.target instanceof Node && !menuEl.contains(event.target)) {
      // Click occurred outside menu container: close popup menu.
      close();
    } else {
      // Click occurred inside menu container: allow item click listeners to handle.
    }
  }

  /**
   * Opens the popup menu at the specified viewport coordinates, clamping the position to remain within the screen.
   *
   * @purpose Stores entries, renders menu DOM nodes, positions and clamps coordinates against window boundaries, and attaches outside-click dismissal.
   * @inputs x - Viewport horizontal coordinate in pixels.
   * @inputs y - Viewport vertical coordinate in pixels.
   * @inputs entries - Readonly array of PopupMenuEntry items and separators to display.
   * @outputs void.
   * @dataflow entries -> allEntries & renderedEntries -> renderEntries() -> position clamping against win dimensions -> left/top styles.
   * @controlflow Check destroyed guard -> store entries -> reset active index to first enabled -> render DOM -> make visible -> measure & clamp coordinates -> apply styles -> schedule outside-click listener.
   */
  function openAt(x: number, y: number, entries: readonly PopupMenuEntry[]): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    allEntries = entries.slice();
    renderedEntries = allEntries;
    activeIndex = findFirstEnabledIndex();

    // Render entries into DOM and display menu element.
    renderEntries();
    menuEl.hidden = false;
    open = true;

    // Measure dimensions for screen clamping.
    // A menu opened near the bottom-right corner is the common case for a right-click, not an edge case,
    // so clamping is the normal path.
    const menuWidth = menuEl.offsetWidth;
    const menuHeight = menuEl.offsetHeight;
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;

    let clampedX = x;
    let clampedY = y;

    // Check if the menu would extend past the right boundary of the viewport.
    if (clampedX + menuWidth > viewportWidth) {
      // Shift menu back horizontally so it fits within the viewport.
      clampedX = viewportWidth - menuWidth;
    } else {
      // Menu fits horizontally.
    }

    // Check if horizontal shift produced a negative coordinate.
    if (clampedX < 0) {
      // Clamp negative coordinate to zero to keep menu on screen.
      clampedX = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    // Check if the menu would extend past the bottom boundary of the viewport.
    if (clampedY + menuHeight > viewportHeight) {
      // Shift menu back vertically so it fits within the viewport.
      clampedY = viewportHeight - menuHeight;
    } else {
      // Menu fits vertically.
    }

    // Check if vertical shift produced a negative coordinate.
    if (clampedY < 0) {
      // Clamp negative coordinate to zero to keep menu on screen.
      clampedY = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    menuEl.style.left = `${clampedX}px`;
    menuEl.style.top = `${clampedY}px`;

    // Clear any previously pending outside-click registration timeout.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending timeout.
    }

    // Register outside-click listener on document on a zero-delay timeout.
    // A contextmenu event is followed by no click, but a programmatic open from a click handler
    // would otherwise close instantly, so the listener is attached on a zero-delay timeout.
    openTimeoutId = win.setTimeout((): void => {
      openTimeoutId = null;
      // Check if component has been destroyed or menu was closed before timeout expired.
      if (destroyed || !open) {
        // Component destroyed or menu closed: do not attach listener.
        return;
      } else {
        // Menu still open: attach outside-click dismiss listener to document.
        doc.addEventListener('click', onDocClick, { signal });
      }
    }, 0);
  }

  /**
   * Filters the open menu's items by query, re-rendering matching items and dropping separators.
   *
   * @purpose Supports type-to-filter search (e.g. slash insert menu), showing only items whose label contains the query case-insensitively.
   * @inputs query - Substring search query string.
   * @outputs void.
   * @dataflow query -> filter allEntries -> renderedEntries -> renderEntries().
   * @controlflow Check destroyed guard -> if empty query restore allEntries -> otherwise filter items case-insensitively (dropping separators) -> reset activeIndex to first enabled -> re-render entries.
   */
  function setFilter(query: string): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort filtering.
      return;
    } else {
      // Component is active: proceed with filter.
    }

    // Check if search query is empty.
    // An empty query restores everything.
    if (query === '') {
      // Empty query: restore all original entries including separators.
      renderedEntries = allEntries;
    } else {
      // Filter active: show only items whose label contains the query case-insensitively.
      // Separators group things, and a filtered list has no groups, so separators are dropped entirely while a filter is active.
      const lowerQuery = query.toLowerCase();
      const filtered: PopupMenuEntry[] = [];

      for (let i = 0; i < allEntries.length; i++) {
        const entry = allEntries[i];
        // Check if entry exists under strict indexing.
        if (entry === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Entry exists: inspect type.
        }

        // Check if entry is a separator.
        if ('separator' in entry) {
          // Separator dropped during active filtering.
          continue;
        } else if (entry.label.toLowerCase().includes(lowerQuery)) {
          // Item label matches query: include in filtered results.
          filtered.push(entry);
        } else {
          // Item does not match query.
        }
      }

      renderedEntries = filtered;
    }

    // Resets the active index to the first enabled item.
    activeIndex = findFirstEnabledIndex();
    renderEntries();
  }

  /**
   * Closes the popup menu and removes outside-click event listeners.
   *
   * @purpose Hides the menu element, resets active selection, and detaches outside-click listeners in an idempotent manner.
   * @inputs void.
   * @outputs void.
   * @dataflow open = false -> menuEl.hidden = true -> cleanup listeners.
   * @controlflow Check destroyed guard -> if open, set open to false, hide element, clear timeouts, and remove doc click listener.
   */
  function close(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort close.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    // Check if any open timeout is pending.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending open timeout.
    }

    // Detach outside-click listener from document.
    doc.removeEventListener('click', onDocClick);

    // Check if menu is currently open.
    if (open) {
      open = false;
      menuEl.hidden = true;
      activeIndex = -1;
      updateActiveItem();
    } else {
      // Menu already closed.
    }
  }

  /**
   * Tears down the popup menu component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes the menu, and removes the menu element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> menuEl.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> abort controller -> close menu -> remove menu element from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    close();
    menuEl.remove();
  }

  // Bind keyboard navigation on the menu element AND on the document.
  // Focus stays in the editor so commands can act on the current selection;
  // this is the cost of not taking focus, and the reason the keys are handled on doc rather than relying on the element being focused.
  menuEl.addEventListener('keydown', onKeyDown, { signal });
  doc.addEventListener('keydown', onKeyDown, { signal });

  // Mount popup menu element to document body.
  doc.body.appendChild(menuEl);

  return {
    openAt,
    setFilter,
    close,
    /**
     * @purpose Returns boolean indicating whether the popup menu is currently open.
     * @inputs void.
     * @outputs boolean - True if the menu is open and component is not destroyed; false otherwise.
     * @dataflow open -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed; otherwise return open flag.
     */
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else {
        // Return live open status of the popup menu.
        return open;
      }
    },
    destroy,
  };
}
