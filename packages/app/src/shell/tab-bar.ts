/**
 * @file tab-bar.ts
 * @purpose Implements the document tab strip for K-Doc (FR-6.8), rendering open document tabs, activation state, dirty indicators, drag-to-reorder, drag-to-detach, and tab close/new actions.
 * @inputs TabBarOptions containing container HTMLElement, Document context, tabs state provider, and onActivate, onClose, onReorder, onDetach, onNew callbacks.
 * @outputs TabBar controller interface exposing refresh and destroy lifecycle methods, alongside TAB_BAR_STYLES stylesheet definition and TabView / TabBarOptions (with its onDetach callback) interfaces.
 * @functions
 *   - installTabBar: Instantiates and mounts the document tab strip, sets up drag-and-drop and click handlers, and returns the TabBar controller.
 * @dataflow Tab set snapshot (views, activeId) -> TabBar DOM rendering (tab strip, tabs, title, dirty dot, close button, new button) -> user interactions (click, auxclick, drag) -> options callbacks.
 * @controlflow Mount tab bar container -> read tabs snapshot -> if <= 1 tab hide bar, else construct tab elements with roving tabindex & drag handlers -> bind AbortController listeners -> return TabBar interface.
 * @version 5
 * @date 2026-10-06
 */

export interface TabView {
  readonly id: string;
  readonly title: string;
  readonly dirty: boolean;
}

export interface TabBarOptions {
  readonly container: HTMLElement;
  readonly doc: Document;
  /** The tabs to draw, in order, plus which is active. */
  readonly tabs: () => { readonly views: readonly TabView[]; readonly activeId: string | null };
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onReorder: (id: string, toIndex: number) => void;
  /**
   * A tab was dragged out of the strip and dropped elsewhere: the user is asking for it in a window
   * of its own. Called only when the drag ended clear of the bar, so a reorder never triggers it.
   */
  readonly onDetach: (id: string) => void;
  readonly onNew: () => void;
}

export interface TabBar {
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the document tab strip, defining a flat 26px strip under the ribbon,
 * muted text tabs separated by hairlines, active tab marked by a 2px accent underline,
 * close button revealed on hover/focus/active, and the amber dirty dot using
 * exclusively authoritative K-Doc chrome design tokens.
 */
export const TAB_BAR_STYLES: string = `
.kdoc-tab-bar {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: 26px;
  padding: 0 8px;
  gap: 2px;
  background: transparent;
  border-bottom: 1px solid var(--kdoc-chrome-edge);
  user-select: none;
  box-sizing: border-box;
}

.kdoc-tab-bar[hidden] {
  display: none;
}

.kdoc-tab-strip {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) transparent;
}

.kdoc-tab-strip::-webkit-scrollbar {
  height: 3px;
}

.kdoc-tab-strip::-webkit-scrollbar-track {
  background: transparent;
}

.kdoc-tab-strip::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
}

.kdoc-tab-strip::-webkit-scrollbar-thumb:hover {
  background: var(--kdoc-chrome-text-muted);
}

.kdoc-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  padding: 0 6px 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  box-shadow: none;
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 150ms ease, background-color 150ms ease;
}

.kdoc-tab + .kdoc-tab::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 1px;
  background: var(--kdoc-chrome-edge);
}

.kdoc-tab[aria-selected="true"]::before,
.kdoc-tab[aria-selected="true"] + .kdoc-tab::before {
  display: none;
}

.kdoc-tab:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 5%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-tab:focus-visible {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -2px;
}

.kdoc-tab[aria-selected="true"] {
  background: transparent;
  color: var(--kdoc-chrome-text);
  font-weight: 600;
  border: 0;
  box-shadow: none;
}

.kdoc-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--kdoc-chrome-accent);
}

.kdoc-tab-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-tab-dirty-marker {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.kdoc-tab-dirty-marker::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: var(--kdoc-radius-pill);
  background: var(--kdoc-emissive-amber);
}

.kdoc-tab-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kdoc-radius-sm);
  border: 0;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
  box-sizing: border-box;
  transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.kdoc-tab:hover .kdoc-tab-close,
.kdoc-tab:focus-within .kdoc-tab-close,
.kdoc-tab[aria-selected="true"] .kdoc-tab-close {
  opacity: 1;
}

.kdoc-tab-close:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-tab-close:focus-visible {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: 0;
}

/* The dirty marker is a dot, and it replaces the close button until hover.
   Showing both at once makes the strip noisy and makes it easy to click Close
   when you meant to notice the dot — this is how every editor with tabs does it,
   and for that reason. */
.kdoc-tab[data-dirty="true"] .kdoc-tab-close {
  display: none;
}

.kdoc-tab[data-dirty="true"]:hover .kdoc-tab-close {
  display: inline-flex;
}

.kdoc-tab[data-dirty="true"]:hover .kdoc-tab-dirty-marker {
  display: none;
}

.kdoc-tab[data-dirty="true"]:focus-within .kdoc-tab-close {
  display: inline-flex;
}

.kdoc-tab[data-dirty="true"]:focus-within .kdoc-tab-dirty-marker {
  display: none;
}

.kdoc-tab-new-button {
  width: 20px;
  height: 20px;
  min-width: 20px;
  min-height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  border-radius: var(--kdoc-radius-sm);
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
  box-sizing: border-box;
  transition: color 0.15s ease, background 0.15s ease;
}

.kdoc-tab-new-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-tab-new-button:active {
  box-shadow: none;
  color: var(--kdoc-chrome-accent);
}

.kdoc-tab-new-button:focus-visible {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: 0;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-tab-bar * {
    transition: none !important;
  }
}
`;

/**
 * How far past the tab bar's edge a drag has to finish before it counts as pulling the tab out.
 *
 * A few pixels of slop stops a reorder that overshot the last tab from being read as a request for a
 * new window -- the two gestures start identically, and only where the pointer stops tells them apart.
 */
const DETACH_MARGIN_PX: number = 24;

/**
 * Installs the document tab strip component into the specified container element.
 *
 * @purpose Constructs and mounts the document tab strip, binding activation, close, reorder, detach, and new document actions.
 * @inputs options: TabBarOptions - Configuration providing container, document context, tabs provider, and event callbacks.
 * @outputs TabBar - Controller exposing refresh() and destroy() lifecycle methods.
 * @dataflow options.tabs() -> tab elements & event listeners -> user clicks & drags -> options callback triggers.
 * @controlflow Mark container with CSS class -> declare lifecycle variables -> invoke refresh() to render initial state -> return TabBar interface.
 */
export function installTabBar(options: TabBarOptions): TabBar {
  const doc = options.doc;
  const mainAbortController = new AbortController();
  let renderAbortController: AbortController | null = null;
  let destroyed = false;
  let draggedTabId: string | null = null;

  options.container.classList.add('kdoc-tab-bar');

  /**
   * Determines whether a drag gesture finished clear of the tab bar container by more than the detach margin.
   *
   * @purpose Evaluates dragend pointer coordinates against container bounds plus DETACH_MARGIN_PX, treating cancelled drags as inside.
   * @inputs event: DragEvent - The dragend DOM event providing pointer coordinates.
   * @outputs boolean - True if the pointer finished beyond container bounds by more than DETACH_MARGIN_PX.
   * @dataflow DragEvent client coordinates -> comparison against options.container bounding rectangle -> boolean.
   * @controlflow Treat a cancelled drag's (0, 0) as inside -> read the container rect -> test each edge -> return.
   */
  function endedOutside(event: DragEvent): boolean {
    // Check whether the drag was cancelled, which most browsers report as clientX === 0 && clientY === 0.
    if (event.clientX === 0 && event.clientY === 0) {
      // Cancelled: treat as inside. This is the whole reason the test is not a one-line rect check --
      // reporting outside here would open a window every time the user pressed Escape.
      return false;
    } else {
      // A real position: measure it against the bar.
    }

    const rect = options.container.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;

    // Check whether the pointer finished past any edge of the bar by more than the slop.
    if (
      x < rect.left - DETACH_MARGIN_PX ||
      x > rect.right + DETACH_MARGIN_PX ||
      y < rect.top - DETACH_MARGIN_PX ||
      y > rect.bottom + DETACH_MARGIN_PX
    ) {
      // Clear of the bar: the tab was pulled out.
      return true;
    } else {
      // On the bar, or within the slop: still a reorder.
      return false;
    }
  }

  /**
   * Re-reads the tab set snapshot and completely rebuilds the tab strip DOM hierarchy.
   *
   * @purpose Synchronizes tab strip DOM representation with the latest TabView array and active tab ID.
   * @inputs void.
   * @outputs void.
   * @dataflow options.tabs() -> fresh views and activeId -> construct tab and button elements -> DOM replacement.
   * @controlflow Check destroyed guard -> read snapshot -> if <= 1 tab hide bar and return -> abort previous render listeners -> build strip, tabs, and new button -> replaceChildren.
   */
  function refresh(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: proceed with refreshing the tab strip.
    }

    // Re-read latest tabs state snapshot from options.
    const snapshot = options.tabs();
    const views = snapshot.views;
    const activeId = snapshot.activeId;

    // Check if there is one tab or none.
    // A tab strip showing a single tab is pure chrome, and the user gains nothing from being told they have one document open.
    if (views.length <= 1) {
      options.container.hidden = true;
      options.container.style.display = 'none';
      options.container.replaceChildren();
      // Check if an active render abort controller exists to clean up.
      if (renderAbortController !== null) {
        renderAbortController.abort();
        renderAbortController = null;
      } else {
        // No active render abort controller.
      }
      return;
    } else {
      // Two or more tabs exist: ensure container is visible and proceed to render the tab strip.
      options.container.hidden = false;
      options.container.style.display = '';
    }

    // Clean up event listeners from the previous render cycle before rebuilding.
    if (renderAbortController !== null) {
      renderAbortController.abort();
      renderAbortController = null;
    } else {
      // First render cycle: no previous render abort controller to abort.
    }
    renderAbortController = new AbortController();
    const renderSignal = renderAbortController.signal;

    // A full rebuild is right at this size — a handful of tabs — and that diffing would add a class of bugs for no visible benefit.
    const strip = doc.createElement('div');
    strip.className = 'kdoc-tab-strip';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Document tabs');

    for (let i = 0; i < views.length; i++) {
      const view = views[i];
      // Check if view entry is defined to satisfy strict noUncheckedIndexedAccess.
      if (view === undefined) {
        // Undefined view entry: skip iteration.
        continue;
      } else {
        // Valid TabView entry: proceed with tab DOM construction.
      }

      const tab = doc.createElement('div');
      tab.className = 'kdoc-tab';
      tab.setAttribute('role', 'tab');
      tab.id = `kdoc-tab-${view.id}`;
      tab.dataset.tabId = view.id;

      const isSelected = view.id === activeId;
      // Check whether this tab represents the currently active document.
      if (isSelected) {
        tab.setAttribute('aria-selected', 'true');
        tab.tabIndex = 0;
      } else {
        tab.setAttribute('aria-selected', 'false');
        tab.tabIndex = -1;
      }

      // 1. Title text element
      const titleSpan = doc.createElement('span');
      titleSpan.className = 'kdoc-tab-title';
      titleSpan.textContent = view.title;

      // 2. Dirty marker dot element
      const dirtyMarker = doc.createElement('span');
      dirtyMarker.className = 'kdoc-tab-dirty-marker';
      dirtyMarker.setAttribute('aria-hidden', 'true');

      // 3. Close button element
      const closeButton = doc.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'kdoc-tab-close';
      closeButton.textContent = '×';
      // The close button carries aria-label of Close ${title} — a bare "×" is unusable with a screen reader when there are eight of them.
      closeButton.setAttribute('aria-label', `Close ${view.title}`);
      closeButton.title = `Close ${view.title}`;

      // Check whether the document has unsaved modifications (dirty).
      // The dirty marker is a dot, and it replaces the close button until hover.
      // Showing both at once makes the strip noisy and makes it easy to click Close
      // when you meant to notice the dot — this is how every editor with tabs does it,
      // and for that reason.
      if (view.dirty) {
        tab.setAttribute('data-dirty', 'true');
        dirtyMarker.hidden = false;
      } else {
        tab.setAttribute('data-dirty', 'false');
        dirtyMarker.hidden = true;
        dirtyMarker.style.display = 'none';
      }

      tab.appendChild(titleSpan);
      tab.appendChild(dirtyMarker);
      tab.appendChild(closeButton);

      // Clicking a tab calls onActivate.
      tab.addEventListener(
        'click',
        (): void => {
          options.onActivate(view.id);
        },
        { signal: renderSignal },
      );

      // Middle-click closes a tab.
      // Using auxclick rather than mousedown is what avoids closing a tab the user was only trying to scroll past with a middle-drag.
      tab.addEventListener(
        'auxclick',
        (event: MouseEvent): void => {
          // Check if the auxclick event was triggered specifically by the middle mouse button (button === 1).
          if (event.button === 1) {
            event.preventDefault();
            options.onClose(view.id);
          } else {
            // Non-middle auxclick: ignore.
          }
        },
        { signal: renderSignal },
      );

      // Clicking the close button calls onClose and must not also activate.
      // Calling event.stopPropagation() stops the click event from bubbling up to the parent tab div,
      // which would otherwise trigger onActivate on a document that is in the process of closing.
      closeButton.addEventListener(
        'click',
        (event: MouseEvent): void => {
          event.stopPropagation();
          options.onClose(view.id);
        },
        { signal: renderSignal },
      );

      // Drag to reorder: make each tab draggable="true".
      tab.draggable = true;

      // On dragstart store the dragged id in a local variable (not dataTransfer, so the drag cannot be dropped into another application).
      // Keeping the id in a local rather than in dataTransfer deliberately confines the drag to this strip.
      // A detach is decided by where the drag ended, not by handing a payload to the platform, so nothing
      // needs to go on dataTransfer for one either.
      tab.addEventListener(
        'dragstart',
        (event: DragEvent): void => {
          draggedTabId = view.id;
          // Check if dataTransfer is non-null to set appropriate drag operation effect.
          if (event.dataTransfer !== null) {
            event.dataTransfer.effectAllowed = 'move';
          } else {
            // dataTransfer is null: proceed with local state tracking.
          }
        },
        { signal: renderSignal },
      );

      // On dragover on a tab, preventDefault() to allow the drop.
      tab.addEventListener(
        'dragover',
        (event: DragEvent): void => {
          event.preventDefault();
          // Check if dataTransfer is non-null to indicate move drop effect.
          if (event.dataTransfer !== null) {
            event.dataTransfer.dropEffect = 'move';
          } else {
            // dataTransfer is null.
          }
        },
        { signal: renderSignal },
      );

      // On drop, compute the target index from the tab's position and call onReorder.
      tab.addEventListener(
        'drop',
        (event: DragEvent): void => {
          event.preventDefault();
          // Check if a tab from this strip is currently being dragged.
          if (draggedTabId !== null) {
            const sourceId = draggedTabId;
            draggedTabId = null;
            // Check if the tab was dropped on a different tab position.
            if (sourceId !== view.id) {
              options.onReorder(sourceId, i);
            } else {
              // Dropped on the same tab: no reorder needed.
            }
          } else {
            // No local drag active: ignore foreign drop.
          }
        },
        { signal: renderSignal },
      );

      tab.addEventListener(
        'dragend',
        (event: DragEvent): void => {
          const sourceId = draggedTabId;
          draggedTabId = null;

          // A drop on a tab is not tracked separately. `drop` only fires on a tab, which is inside the
          // bar, and `dragend` reports the same point the drop happened at -- so a reorder always ends
          // inside and endedOutside already answers for it. A flag saying the same thing twice would be
          // a second source of truth that could only ever disagree by being wrong.

          // Check whether the drag was one of this strip's own.
          if (sourceId === null) {
            // Not our drag, or already cleared: ignore it.
            return;
          } else {
            // One of ours: work out where it was let go.
          }

          // Check whether the pointer finished clear of the bar.
          if (endedOutside(event)) {
            // Dropped away from the strip: the user is asking for this document in its own window.
            options.onDetach(sourceId);
          } else {
            // Let go over the bar but not on a tab -- a cancelled reorder, not a request for a window.
          }
        },
        { signal: renderSignal },
      );

      // Keyboard navigation following ARIA tab pattern.
      tab.addEventListener(
        'keydown',
        (event: KeyboardEvent): void => {
          // Check if Enter or Space was pressed to activate the focused tab.
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            options.onActivate(view.id);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const tabCount = views.length;
            // Check if multiple tabs exist to navigate between.
            if (tabCount <= 1) {
              return;
            } else {
              // Multiple tabs exist: calculate target index with wraparound.
            }

            let nextIndex = 0;
            // Check arrow key direction.
            if (event.key === 'ArrowLeft') {
              nextIndex = (i - 1 + tabCount) % tabCount;
            } else {
              nextIndex = (i + 1) % tabCount;
            }

            const nextView = views[nextIndex];
            // Check if nextView is defined under strict noUncheckedIndexedAccess.
            if (nextView !== undefined) {
              options.onActivate(nextView.id);
            } else {
              // nextView is undefined.
            }
          } else {
            // Other keys: allow default browser behavior.
          }
        },
        { signal: renderSignal },
      );

      strip.appendChild(tab);
    }

    // Trailing + button calling onNew with aria-label="New document".
    const newButton = doc.createElement('button');
    newButton.type = 'button';
    newButton.className = 'kdoc-tab-new-button';
    newButton.textContent = '+';
    newButton.setAttribute('aria-label', 'New document');
    newButton.title = 'New document';
    newButton.addEventListener(
      'click',
      (): void => {
        options.onNew();
      },
      { signal: renderSignal },
    );

    options.container.replaceChildren(strip, newButton);
  }

  /**
   * Cleans up all tab bar resources, aborts event listeners, clears container attributes, and removes DOM elements.
   *
   * @purpose Idempotently tears down the tab bar controller and restores host container state.
   * @inputs void.
   * @outputs void.
   * @dataflow mainAbortController.abort() -> renderAbortController.abort() -> container style and class resets -> replaceChildren.
   * @controlflow Check destroyed guard -> set destroyed = true -> abort controllers -> reset container styling -> remove children.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: proceed with destruction.
      destroyed = true;
    }

    // Clean up active render listeners.
    if (renderAbortController !== null) {
      renderAbortController.abort();
      renderAbortController = null;
    } else {
      // No active render abort controller.
    }

    mainAbortController.abort();
    draggedTabId = null;

    options.container.hidden = false;
    options.container.style.display = '';
    options.container.classList.remove('kdoc-tab-bar');
    options.container.replaceChildren();
  }

  // Initial render pass.
  refresh();

  return {
    refresh,
    destroy,
  };
}
