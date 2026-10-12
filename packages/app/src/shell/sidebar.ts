/**
 * @file sidebar.ts
 * @purpose Implements Sidebar, the left and right floating Material 3 Expressive sidebar panel hosts for K-Doc (FR-14.6, FR-14.7).
 *   Renders edge-snapped tonal cards floating above the document pane without shrinking its flex layout.
 *   Hosts a vertical tablist rail with labelled icon buttons with a tonal active indicator alongside an auto-scrolling card body.
 *   Provides ARIA tablist accessibility, roving focus keyboard navigation, selection-preserving mousedown suppression,
 *   single-instance registration mounting, panel activation lifecycle hooks, and collapsible panel display states.
 * @inputs SidebarOptions containing Document context, array of SidebarPanel definitions, optional initialPanelId, and optional onActiveChange listener.
 * @outputs Sidebar controller interface exposing element, activePanelId, isCollapsed, show, toggle, collapse, and destroy, alongside SIDEBAR_STYLES.
 * @functions
 *   - installSidebar: Instantiates DOM hierarchy, mounts panel containers, binds tablist interactions, and returns the Sidebar controller.
 *   - show: Reveals a specified panel by id, hides other panels, updates ARIA selection, invokes panel activate hook, and un-collapses the body.
 *   - toggle: Toggles panel visibility, collapsing the sidebar if the requested panel is currently active, or displaying it otherwise.
 *   - collapse: Hides the sidebar body and sets activePanelId to null while retaining the rail for subsequent reopening.
 *   - destroy: Idempotently aborts event listener signals, invokes destroy hooks on all panels, and removes the root element from the DOM.
 * @dataflow SidebarPanel registrations -> DOM rail buttons & panel containers -> user click/keyboard events -> show/toggle/collapse state mutations -> panel activate/destroy hooks & onActiveChange notifications.
 * @controlflow Create root/rail/body DOM structure -> register and mount each panel into hidden containers -> bind mousedown/click/keydown listeners with AbortController -> activate initial panel -> return Sidebar controller interface.
 * @version 5
 * @date 2026-10-04
 */

/**
 * Static stylesheet for the floating Material 3 Expressive side panel host, defining edge-snapped tonal cards
 * taken out of flex flow via absolute positioning, an icon-only navigation rail (labels kept for assistive technology and as tooltips) with a tonal active indicator,
 * thin pill scrollbars, and rounded corners on all surfaces using authoritative K-Doc design tokens.
 */
import { createIcon, type IconName } from './icons.js';

export const SIDEBAR_STYLES: string = `
/* Floating Material 3 Expressive side panels.
   The sidebar hosts are taken completely out of flex flow via position: absolute against .kdoc-panes,
   so the document pane always occupies full container width.
   Gutter spacing (12px) insets the floating cards from window edges.
   pointer-events: none on the host allows clicks in the gutter to pass through to the underlying document. */
.kdoc-sidebar {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 6px;
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 6px;
  box-sizing: border-box;
  max-height: calc(100% - 24px);
  pointer-events: none;
  color: var(--kdoc-chrome-text);
}

/* An explicit display on a class beats the user agent's [hidden] rule.
   This selector guarantees that elements with hidden = true remain hidden even when class styles specify display: flex or display: block. */
.kdoc-sidebar [hidden] {
  display: none !important;
}

.kdoc-sidebar[hidden] {
  display: none !important;
}

/* The right sidebar host anchors to the right edge and reverses flex direction so the body opens inward. */
.kdoc-sidebar-right {
  left: auto;
  right: 6px;
  flex-direction: row-reverse;
}

/* Navigation rail: a rounded tonal container holding labelled panel buttons */
.kdoc-sidebar-rail {
  pointer-events: auto;
  width: 48px;
  min-width: 48px;
  max-width: 48px;
  height: fit-content;
  max-height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  background: var(--kdoc-chrome-raised);
  border: none;
  border-radius: var(--kdoc-radius-xl);
  box-shadow: var(--kdoc-elevation-raised);
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Rail items: an icon in a pill-shaped active indicator above a visible label */
.kdoc-sidebar-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 40px;
  min-width: 0;
  min-height: 0;
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  line-height: 1.15;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.kdoc-sidebar-tab:hover {
  color: var(--kdoc-chrome-text);
}

.kdoc-sidebar-tab:focus-visible {
  outline: none;
}

/* Active rail item: the label turns bold and the indicator fills with the tertiary container, and the
   button also carries aria-selected/aria-pressed, so the active panel is never signalled by colour alone. */
.kdoc-sidebar-tab.depressed,
.kdoc-sidebar-tab[aria-selected="true"],
.kdoc-sidebar-tab[aria-pressed="true"] {
  color: var(--kdoc-chrome-text);
  font-weight: 750;
  background: transparent;
  box-shadow: none;
}

/* Floating body card: an edge-snapped tonal container with internal scrolling. */
.kdoc-sidebar-body {
  pointer-events: auto;
  width: 240px;
  min-width: 200px;
  max-width: min(360px, calc(100vw - 120px));
  /* Fit the content rather than the pane. A full-height card over a four-item outline is mostly
     empty surface laid across the prose, which is what made the floating panels feel like
     they were covering the document rather than hovering beside it. */
  height: fit-content;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--kdoc-chrome-container-low);
  border-radius: var(--kdoc-radius-xl);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
}

/* Individual panel container inside the floating body card. */
.kdoc-sidebar-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
  overflow: auto;
  border-radius: var(--kdoc-radius-lg);
  color: var(--kdoc-chrome-text);
}

/* Square corners are the exception here, not the rule: anything rectangular a panel draws inherits a
   radius token so a panel's own markup cannot reintroduce a hard corner inside a rounded card. */
.kdoc-sidebar header,
.kdoc-sidebar .kdoc-sidebar-header,
.kdoc-sidebar .kdoc-panel-header,
.kdoc-sidebar button,
.kdoc-sidebar input,
.kdoc-sidebar select,
.kdoc-sidebar textarea,
.kdoc-sidebar .kdoc-sidebar-group,
.kdoc-sidebar .kdoc-panel-section,
.kdoc-sidebar .kdoc-panel-card {
  border-radius: var(--kdoc-radius-md);
}

/* Thin pill scrollbars on a transparent track. */
.kdoc-sidebar ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-sidebar ::-webkit-scrollbar-track {
  background: transparent;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-sidebar ::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-sidebar ::-webkit-scrollbar-corner {
  background: transparent;
}

.kdoc-sidebar,
.kdoc-sidebar * {
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-sidebar,
  .kdoc-sidebar * {
    transition: none !important;
    animation: none !important;
  }
}
.kdoc-rail-indicator {
  width: 40px;
  height: 36px;
  border-radius: var(--kdoc-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 150ms ease, color 150ms ease;
}
.kdoc-sidebar-tab:hover .kdoc-rail-indicator {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}
.kdoc-sidebar-tab.depressed .kdoc-rail-indicator,
.kdoc-sidebar-tab[aria-selected="true"] .kdoc-rail-indicator {
  background: var(--kdoc-chrome-tertiary-container);
  color: var(--kdoc-chrome-on-tertiary-container);
}
.kdoc-sidebar-tab:focus-visible .kdoc-rail-indicator {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}
/* Icon-only rail: the label stays in the DOM for assistive technology (the button also carries
   aria-label and a title tooltip) but takes no space. */
.kdoc-rail-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  margin: -1px;
  padding: 0;
  border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .kdoc-rail-indicator { transition: none; }
}
`;

export interface SidebarPanel {
  readonly id: string;
  readonly label: string;
  /** Line icon drawn in the rail item's active indicator, above the visible label. */
  readonly icon: IconName;
  /** The host appends the panel's own content into this element, once, at registration. */
  mount(container: HTMLElement): void;
  /** Called when the panel becomes visible, so it can refresh work it skipped while hidden. */
  activate?(): void;
  destroy?(): void;
}

export interface SidebarOptions {
  readonly doc: Document;
  readonly panels: readonly SidebarPanel[];
  /** Notified when the visible panel changes, or with null when the sidebar is collapsed. */
  readonly onActiveChange?: (panelId: string | null) => void;
  /** Panel shown first. Defaults to the first registered panel. */
  readonly initialPanelId?: string;
  /**
   * Which edge the host sits on. 'left' (the default) puts the rail before the body; 'right' reverses
   * that so the rail hugs the window edge and the body opens inward, which is the only arrangement in
   * which two of these can face each other across the panes.
   */
  readonly side?: 'left' | 'right';
  /**
   * Start with every panel hidden and only the rail showing. The left sidebar opens on its first panel
   * because the outline is worth seeing unasked; the right panel does not, because a comments column
   * that no one opened is just lost width.
   */
  readonly startCollapsed?: boolean;
}

export interface Sidebar {
  readonly element: HTMLElement;
  readonly activePanelId: string | null;
  readonly isCollapsed: boolean;
  show(panelId: string): void;
  toggle(panelId: string): void;
  collapse(): void;
  destroy(): void;
}

interface PanelRegistration {
  readonly panel: SidebarPanel;
  readonly button: HTMLButtonElement;
  readonly container: HTMLElement;
}

/**
 * Installs the sidebar host component into an owned DOM hierarchy, configuring tablist navigation,
 * panel container mounting, activation lifecycles, and collapse/expand transitions.
 *
 * @purpose Creates and mounts the sidebar rail and body elements, registers all panels, and returns the Sidebar controller.
 * @inputs options - SidebarOptions providing the Document context, registered panels, initial panel selection, and change callback.
 * @outputs Sidebar - Controller interface exposing element, activePanelId, isCollapsed, show, toggle, collapse, and destroy methods.
 * @dataflow options.panels -> DOM tab buttons and panel containers -> mount() per panel -> initial show() -> Sidebar controller returned.
 * @controlflow Construct root, rail, and body elements -> register and mount each panel -> bind tablist keyboard listeners with AbortController -> show initial panel -> return Sidebar controller interface.
 */
export function installSidebar(options: SidebarOptions): Sidebar {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;
  let isCollapsedState: boolean = true;
  let currentActivePanelId: string | null = null;

  const panelRecords: PanelRegistration[] = [];
  const panelMap = new Map<string, PanelRegistration>();

  // Construct root container element.
  // 'left' is the default because every existing caller already means left; nothing here changes that contract for them.
  const side = options.side ?? 'left';

  // Construct root container element on the chosen edge, then assign the class matching that edge so the stylesheet can flip direction.
  const rootElement = doc.createElement('div');
  if (side === 'left') {
    // Left host keeps only the base class: layout and styling are unchanged from before this change.
    rootElement.className = 'kdoc-sidebar';
  } else {
    // Right host adds a second class that flips direction via stylesheet; .kdoc-sidebar still supplies every other value.
    rootElement.className = 'kdoc-sidebar kdoc-sidebar-right';
  }

  // Construct rail element.
  // The rail is a tablist rather than a row of toggle buttons because that is what it behaves like,
  // and a screen reader has no other way to learn the panels are alternatives.
  const railElement = doc.createElement('div');
  railElement.className = 'kdoc-sidebar-rail';
  railElement.setAttribute('role', 'tablist');
  // Two rails answering to the same name is a real problem for anyone navigating by landmark, so the label follows the side.
  railElement.setAttribute(
    'aria-label',
    side === 'left' ? 'Sidebar' : 'Right panel',
  );
  railElement.setAttribute('aria-orientation', 'vertical');

  // Construct body element hosting panel containers.
  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-sidebar-body';
  bodyElement.hidden = true;

  rootElement.appendChild(railElement);
  rootElement.appendChild(bodyElement);

  /**
   * Reveals the requested panel, hiding all other panels, updating ARIA selection attributes,
   * triggering the panel's activate lifecycle method, un-collapsing the sidebar, and dispatching onActiveChange.
   *
   * @purpose Displays the specified panel and synchronizes sidebar active state and ARIA attributes.
   * @inputs panelId - Unique identifier of the panel to display.
   * @outputs void.
   * @dataflow panelId -> panelMap lookup -> container.hidden and button aria-selected updates -> panel.activate() -> onActiveChange notification.
   * @controlflow Check destroyed flag -> lookup panelRecord -> if unknown ignore and return -> update active state -> show body -> toggle container hidden and button attributes -> call activate -> notify onActiveChange.
   */
  function show(panelId: string): void {
    // Check if the sidebar component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort show operation.
      return;
    } else {
      // Component is active: proceed with showing requested panel.
    }

    const targetRecord = panelMap.get(panelId);
    // Check if the requested panel id is registered.
    // A caller asking for a panel that is not registered is a programming error that should not take the sidebar down with it.
    if (targetRecord === undefined) {
      // Unknown panel id: ignore and preserve current sidebar state.
      return;
    } else {
      // Known panel id: proceed to reveal target panel and update state.
    }

    const previousVisiblePanelId = isCollapsedState ? null : currentActivePanelId;

    currentActivePanelId = panelId;
    isCollapsedState = false;

    // Un-collapse the sidebar body to ensure the active panel is visible.
    bodyElement.hidden = false;

    // Synchronize container visibility, button ARIA attributes, and the tactile depressed class across all panels.
    for (let i = 0; i < panelRecords.length; i++) {
      const rec = panelRecords[i];
      // Check if record is defined under strict noUncheckedIndexedAccess.
      if (rec === undefined) {
        continue;
      } else {
        // Record is defined.
      }

      // Check if this record corresponds to the requested panel id.
      if (rec.panel.id === panelId) {
        // Target panel: reveal container, mark the button selected and pressed, depress it, and assign roving tabindex 0.
        rec.container.hidden = false;
        rec.button.setAttribute('aria-selected', 'true');
        rec.button.setAttribute('aria-pressed', 'true');
        rec.button.classList.add('depressed');
        rec.button.tabIndex = 0;
      } else {
        // Background panel: hide container, clear both ARIA states, raise the button, and assign tabindex -1.
        rec.container.hidden = true;
        rec.button.setAttribute('aria-selected', 'false');
        rec.button.setAttribute('aria-pressed', 'false');
        rec.button.classList.remove('depressed');
        rec.button.tabIndex = -1;
      }
    }

    // Call panel activate lifecycle method so it can refresh work it skipped while hidden.
    targetRecord.panel.activate?.();

    // Check if the visible panel changed to notify onActiveChange listener.
    if (previousVisiblePanelId !== panelId) {
      // Check if an onActiveChange callback is configured.
      if (options.onActiveChange !== undefined) {
        options.onActiveChange(panelId);
      } else {
        // No active change callback provided.
      }
    } else {
      // Visible panel did not change: suppress duplicate notification.
    }
  }

  /**
   * Toggles panel visibility: collapses the sidebar if the panel is already active and visible,
   * or displays the panel if currently collapsed or viewing another panel.
   *
   * @purpose Toggles panel display or collapses the sidebar when clicking the active tab.
   * @inputs panelId - Unique identifier of the panel to toggle.
   * @outputs void.
   * @dataflow panelId -> compare with activePanelId and isCollapsed -> collapse() or show(panelId).
   * @controlflow Check destroyed flag -> check if active and un-collapsed -> collapse if active; show otherwise.
   */
  function toggle(panelId: string): void {
    // Check if the sidebar component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort toggle operation.
      return;
    } else {
      // Component is active: proceed with toggle evaluation.
    }

    // Check if the target panel is already the active one and the sidebar is not collapsed.
    // This is what makes the rail button feel like the thing it looks like: pressing the active tab again puts the sidebar away.
    if (!isCollapsedState && currentActivePanelId === panelId) {
      // Active panel clicked again: collapse the sidebar.
      collapse();
    } else {
      // Inactive panel clicked or sidebar is collapsed: reveal the requested panel.
      show(panelId);
    }
  }

  /**
   * Collapses the sidebar by hiding the body element and resetting activePanelId to null,
   * retaining the rail so the sidebar can be reopened.
   *
   * @purpose Collapses the sidebar panel body while keeping the rail tabs visible and accessible.
   * @inputs void.
   * @outputs void.
   * @dataflow isCollapsedState and currentActivePanelId updates -> bodyElement.hidden = true -> onActiveChange(null).
   * @controlflow Check destroyed flag -> check if already collapsed -> set collapsed state -> hide body -> reset aria-selected -> notify onActiveChange(null).
   */
  function collapse(): void {
    // Check if the sidebar component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort collapse operation.
      return;
    } else {
      // Component is active: proceed with collapse.
    }

    // Check if the sidebar is already in collapsed state.
    if (isCollapsedState) {
      // Already collapsed: no-op to prevent redundant state updates and notifications.
      return;
    } else {
      // Currently expanded: proceed with collapsing sidebar.
    }

    isCollapsedState = true;
    currentActivePanelId = null;

    // Hide the body and set activePanelId to null; the element keeps the rail so the sidebar can be reopened.
    // Collapsing to nothing would leave no way back without a menu.
    bodyElement.hidden = true;

    // Reset both ARIA states and the depressed class on all rail buttons since no panel is active.
    for (let i = 0; i < panelRecords.length; i++) {
      const rec = panelRecords[i];
      // Check if record is defined under strict noUncheckedIndexedAccess.
      if (rec === undefined) {
        continue;
      } else {
        // Record is defined: clear its ARIA states and raise its button.
      }
      rec.button.setAttribute('aria-selected', 'false');
      rec.button.setAttribute('aria-pressed', 'false');
      rec.button.classList.remove('depressed');
    }

    // Check if an onActiveChange callback is configured.
    if (options.onActiveChange !== undefined) {
      // Notify listener with null indicating sidebar is collapsed.
      options.onActiveChange(null);
    } else {
      // No callback provided.
    }
  }

  /**
   * Cleans up all sidebar resources, aborting event listeners, calling destroy on each registered panel,
   * and detaching the root sidebar element from the DOM.
   *
   * @purpose Idempotently tears down sidebar event listeners, panel instances, and DOM nodes.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> panel.destroy() for each panel -> remove root element.
   * @controlflow Check destroyed flag -> mark destroyed -> abort listeners -> destroy panels -> detach element -> clear state collections.
   */
  function destroy(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active instance: mark destroyed and proceed with destruction.
      destroyed = true;
    }

    // Abort all event listeners bound with the AbortController signal.
    abortController.abort();

    // Call each registered panel's destroy hook for resource disposal.
    for (let i = 0; i < panelRecords.length; i++) {
      const rec = panelRecords[i];
      // Check if record is defined under strict noUncheckedIndexedAccess.
      if (rec === undefined) {
        continue;
      } else {
        // Record is defined.
      }
      rec.panel.destroy?.();
    }

    // Remove the sidebar root element from the DOM.
    if (rootElement.parentNode !== null) {
      rootElement.parentNode.removeChild(rootElement);
    } else {
      rootElement.remove();
    }

    rootElement.replaceChildren();
    panelRecords.length = 0;
    panelMap.clear();
    currentActivePanelId = null;
    isCollapsedState = true;
  }

  // Register each panel in the provided options array.
  for (let i = 0; i < options.panels.length; i++) {
    const panel = options.panels[i];
    // Check if panel is defined under strict noUncheckedIndexedAccess.
    if (panel === undefined) {
      continue;
    } else {
      // Panel is defined: proceed with registration.
    }

    const buttonId = `kdoc-sidebar-tab-${panel.id}`;
    const containerId = `kdoc-sidebar-panel-${panel.id}`;

    // Construct rail tab button.
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'kdoc-sidebar-tab';
    button.id = buttonId;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', containerId);
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-pressed', 'false');
    button.tabIndex = -1;
    // Material rail item: the icon sits in a pill-shaped active indicator, with the label visible below it.
    const indicator = doc.createElement('span');
    indicator.className = 'kdoc-rail-indicator';
    indicator.appendChild(createIcon(doc, panel.icon, 20));
    const railLabel = doc.createElement('span');
    railLabel.className = 'kdoc-rail-label';
    railLabel.textContent = panel.label;
    button.append(indicator, railLabel);
    button.title = panel.label;
    button.setAttribute('aria-label', panel.label);

    // Keep the caret where the user left it.
    // The rail buttons must call event.preventDefault() on mousedown.
    // Without it, clicking the rail moves focus out of the editor pane and collapses the selection — the same defect the format toolbar had.
    button.addEventListener(
      'mousedown',
      (event: MouseEvent): void => {
        event.preventDefault();
      },
      { signal },
    );

    button.addEventListener(
      'click',
      (): void => {
        toggle(panel.id);
      },
      { signal },
    );

    railElement.appendChild(button);

    // Construct container element for the panel.
    const panelContainer = doc.createElement('div');
    panelContainer.className = 'kdoc-sidebar-panel';
    panelContainer.id = containerId;
    panelContainer.setAttribute('role', 'tabpanel');
    panelContainer.setAttribute('aria-labelledby', buttonId);

    // Each panel's container is created and mounted once at registration, then shown or hidden.
    // Panels are hidden rather than unmounted, because rebuilding a panel on every switch would throw away its scroll position
    // and any state it holds — and the outline in particular rebuilds from the document, which is work worth not repeating.
    panelContainer.hidden = true;

    // The host appends the panel's own content into this element, once, at registration.
    panel.mount(panelContainer);
    bodyElement.appendChild(panelContainer);

    const record: PanelRegistration = {
      panel,
      button,
      container: panelContainer,
    };

    panelRecords.push(record);
    panelMap.set(panel.id, record);
  }

  // Arrow keys move between rail buttons (roving focus), matching the tablist pattern.
  railElement.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      // Check if key is a tablist navigation arrow key or Home/End.
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowLeft' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault();
        const panelCount = panelRecords.length;
        // Check if there are panels available to navigate.
        if (panelCount === 0) {
          // No panels registered: abort navigation.
          return;
        } else {
          // Panels registered: proceed with index calculation.
        }

        let currentIndex = -1;
        for (let i = 0; i < panelCount; i++) {
          const rec = panelRecords[i];
          // Check if entry matches event target or activeElement under strict indexing.
          if (
            rec !== undefined &&
            (rec.button === event.target || rec.button === doc.activeElement)
          ) {
            currentIndex = i;
            break;
          } else {
            // Not current focused button.
          }
        }

        // Check if focused button was not located among rail buttons.
        if (currentIndex === -1) {
          // Check if an active panel is currently visible.
          if (currentActivePanelId !== null) {
            for (let i = 0; i < panelCount; i++) {
              const rec = panelRecords[i];
              // Check if entry matches the active panel id.
              if (rec !== undefined && rec.panel.id === currentActivePanelId) {
                currentIndex = i;
                break;
              } else {
                // Not active panel.
              }
            }
          } else {
            // Sidebar is collapsed: fallback to index 0.
          }
        } else {
          // Focused button index located.
        }

        // Check if index remains unresolved.
        if (currentIndex === -1) {
          currentIndex = 0;
        } else {
          // Valid currentIndex resolved.
        }

        let nextIndex = 0;
        // Check arrow direction to advance or reverse with wrapping.
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          // Advance to next button with wrapping.
          nextIndex = (currentIndex + 1) % panelCount;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          // Reverse to previous button with wrapping.
          nextIndex = (currentIndex - 1 + panelCount) % panelCount;
        } else if (event.key === 'Home') {
          // Jump to first rail button.
          nextIndex = 0;
        } else {
          // Jump to last rail button (End key).
          nextIndex = panelCount - 1;
        }

        const nextRecord = panelRecords[nextIndex];
        // Check if target record is defined under strict noUncheckedIndexedAccess.
        if (nextRecord !== undefined) {
          show(nextRecord.panel.id);
          nextRecord.button.focus();
        } else {
          // Record undefined: skip navigation.
        }
      } else {
        // Non-navigation key: allow default browser behavior.
      }
    },
    { signal },
  );

  // Determine initial panel to display.
  // Panel shown first. Defaults to the first registered panel.
  // Resolve which panel to open first. An explicitly requested collapse wins over any registration so that a host can ship only a rail; otherwise fall back to the caller's explicit id and then to the first registered panel.
  let targetInitialId: string | undefined;
  if (options.startCollapsed === true) {
    // Collapse was explicitly requested: resolve nothing, opening no panel whatever panels are registered.
    targetInitialId = undefined;
  } else {
    // No explicit collapse: use the caller's id if given, otherwise fall back to the first registered panel.
    targetInitialId = options.initialPanelId ?? options.panels[0]?.id;
  }

  // Decide whether to open a panel or start collapsed. Both empty outcomes are distinct and each comment names its cause so they are never confused at review time.
  if (targetInitialId !== undefined) {
    // A panel id resolved: show it as the initial selection.
    show(targetInitialId);
  } else if (options.startCollapsed === true) {
    // Collapse was explicitly requested with no panels opened: start collapsed on purpose, not by accident.
    collapse();
  } else {
    // No id could be resolved and no explicit collapse was asked for; the only remaining cause is an empty registration list.
    // No panels registered: collapse sidebar so a rail-only host still has somewhere to point at.
    collapse();
  }

  return {
    element: rootElement,
    get activePanelId(): string | null {
      return currentActivePanelId;
    },
    get isCollapsed(): boolean {
      return isCollapsedState;
    },
    show,
    toggle,
    collapse,
    destroy,
  };
}
