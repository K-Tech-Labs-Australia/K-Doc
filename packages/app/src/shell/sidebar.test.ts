// @vitest-environment jsdom

/**
 * @file sidebar.test.ts
 * @purpose Vitest test suite for K-Doc's left sidebar panel host (packages/app/src/shell/sidebar.ts, FR-14.6).
 *   Verifies tablist DOM structure, single-registration mounting, initial panel selection, active panel toggling
 *   and collapsing, roving focus keyboard navigation, mousedown event default prevention, and lifecycle teardown,
 *   and also covers edge-snapped floating positioning, the depressed/ARIA coupling on rail buttons, and scroll retention across hide/show.
 * @inputs SidebarPanel test definitions with tracking arrays, synthetic MouseEvents, synthetic KeyboardEvents, and Document context.
 * @outputs Vitest assertions validating tab attributes, container visibility, hook invocations, and state transitions.
 * @functions
 *   - createTestPanel: Helper constructing an object literal implementing SidebarPanel with invocation recording arrays.
 *   - createTestSidebar: Helper instantiating a Sidebar controller attached to document.body and registered for afterEach cleanup.
 * @dataflow SidebarPanel definitions -> installSidebar -> DOM elements & event dispatch -> state inspections & Vitest assertions.
 * @controlflow Mount test sidebar -> dispatch user events or invoke API methods -> verify DOM and controller state -> clean up in afterEach.
 * @version 4
 * @date 2026-10-03
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  installSidebar,
  SIDEBAR_STYLES,
  type Sidebar,
  type SidebarOptions,
  type SidebarPanel,
} from './sidebar.js';
import type { IconName } from './icons.js';

interface TestPanelRecord {
  readonly panel: SidebarPanel;
  readonly mountCalls: HTMLElement[];
  readonly activateCalls: number[];
  readonly destroyCalls: number[];
}

let activeSidebars: Sidebar[] = [];

afterEach((): void => {
  for (let i = 0; i < activeSidebars.length; i++) {
    const sidebar = activeSidebars[i];
    // Check if sidebar instance is defined under strict indexing.
    if (sidebar !== undefined) {
      // Destroy active sidebar instance to clean up listeners and DOM elements.
      sidebar.destroy();
    } else {
      // Undefined entry.
    }
  }
  activeSidebars = [];
});

/**
 * Constructs a test SidebarPanel recording its lifecycle hook calls into arrays for assertion without mocking libraries.
 *
 * @purpose Creates a test SidebarPanel implementation recording mount, activate, and destroy invocations.
 * @inputs
 *   - id: string - Unique panel identifier.
 *   - label: string - Display label and title for the rail button.
 *   - icon: string - Short glyph icon rendered on the rail button.
 * @outputs TestPanelRecord - Record containing the SidebarPanel and inspection arrays for mount, activate, and destroy calls.
 * @dataflow id, label, icon -> SidebarPanel methods -> push into call tracking arrays.
 * @controlflow Initialize tracking arrays -> construct object literal implementing SidebarPanel -> return panel and tracking arrays.
 */
function createTestPanel(
  id: string,
  label: string,
  icon: IconName,
): TestPanelRecord {
  const mountCalls: HTMLElement[] = [];
  const activateCalls: number[] = [];
  const destroyCalls: number[] = [];

  const panel: SidebarPanel = {
    id,
    label,
    icon,
    mount(container: HTMLElement): void {
      mountCalls.push(container);
    },
    activate(): void {
      activateCalls.push(Date.now());
    },
    destroy(): void {
      destroyCalls.push(Date.now());
    },
  };

  return {
    panel,
    mountCalls,
    activateCalls,
    destroyCalls,
  };
}

/**
 * Instantiates and mounts a Sidebar instance into document.body, registered for automatic cleanup in afterEach.
 *
 * @purpose Creates a Sidebar with provided panels and options, attaches it to document.body, and tracks it for teardown.
 * @inputs
 *   - panels: readonly SidebarPanel[] - Array of panels to register in the sidebar.
 *   - overrides?: Partial<SidebarOptions> - Optional configuration overrides (such as initialPanelId or onActiveChange).
 * @outputs Sidebar - The instantiated and mounted Sidebar controller.
 * @dataflow panels + overrides -> installSidebar -> document.body.appendChild -> activeSidebars tracking -> return controller.
 * @controlflow Construct options -> call installSidebar -> append element to document.body -> push to activeSidebars -> return sidebar.
 */
function createTestSidebar(
  panels: readonly SidebarPanel[],
  overrides?: Partial<SidebarOptions>,
): Sidebar {
  const options: SidebarOptions = {
    doc: document,
    panels,
    ...overrides,
  };
  const sidebar = installSidebar(options);
  document.body.appendChild(sidebar.element);
  activeSidebars.push(sidebar);
  return sidebar;
}

describe('Sidebar (sidebar.ts)', (): void => {
  it('defaults to the left edge and names its rail Sidebar', (): void => {
    // Pins that a sidebar with no options defaults to the left host ('kdoc-sidebar' only, no right class) and labels its rail 'Sidebar'; this is the case every existing caller relies on, so it must be pinned before introducing the new side option — a default that quietly changed would move the whole outline pane.
    const panel1 = createTestPanel('outline', 'Document Outline', 'outline');
    const panel2 = createTestPanel('files', 'File Explorer', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    // No overrides supplied: the root carries only the base left-edge class and nothing else.
    expect(sidebar.element.className).toBe('kdoc-sidebar');

    const rail = sidebar.element.querySelector('[role="tablist"]');
    // Guard against a missing tablist before reading its accessible name; if it is absent the fixture itself is broken, so fail loudly rather than dereference null.
    if (rail === null) {
      // Tablist not found in the DOM — abort with an explicit error instead of asserting non-null and risking an undefined read downstream.
      throw new Error('Expected [role="tablist"] rail to be present inside the sidebar root.');
    } else {
      // Rail is present; assert its accessible name matches the default left-edge label.
      expect(rail.getAttribute('aria-label')).toBe('Sidebar');
    }
  });

  it('draws each rail tab as an icon in an active indicator above a visible label', (): void => {
    // Pins the Material rail item: an SVG line icon inside .kdoc-rail-indicator, then the panel label as visible text, so the rail no longer relies on a glyph alone.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const sidebar = createTestSidebar([panel1.panel]);
    const tab = sidebar.element.querySelector('[role="tab"]');
    // Guard against a missing tab before inspecting its children.
    if (tab === null) {
      // No tab rendered: the fixture is broken, so fail loudly.
      throw new Error('Expected a rail tab to be rendered.');
    } else {
      // Tab present: check the indicator icon and the visible label.
      expect(tab.querySelector('.kdoc-rail-indicator svg.kdoc-icon')).not.toBeNull();
      expect(tab.querySelector('.kdoc-rail-label')?.textContent).toBe('Outline');
    }
  });

  it('flips to the right edge and renames its rail', (): void => {
    // Pins that side:'right' adds the 'kdoc-sidebar-right' class on top of the base class (rather than replacing it) and relabels the rail to 'Right panel'.
    const panel1 = createTestPanel('outline', 'Document Outline', 'outline');
    const panel2 = createTestPanel('files', 'File Explorer', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel], { side: 'right' });

    // The right host adds to the base class rather than replacing it — keeping both hosts on a shared root class is what prevents them from drifting apart.
    expect(sidebar.element.classList.contains('kdoc-sidebar-right')).toBe(true);
    expect(sidebar.element.classList.contains('kdoc-sidebar')).toBe(true);

    const rail = sidebar.element.querySelector('[role="tablist"]');
    // Guard against a missing tablist before reading its accessible name; if it is absent the fixture itself is broken, so fail loudly rather than dereference null.
    if (rail === null) {
      // Tablist not found in the DOM — abort with an explicit error instead of asserting non-null and risking an undefined read downstream.
      throw new Error('Expected [role="tablist"] rail to be present inside the sidebar root.');
    } else {
      // Rail is present; assert its accessible name reflects the right-edge label. Two rails answering to one name would strand anyone navigating by landmark, so each side must rename itself.
      expect(rail.getAttribute('aria-label')).toBe('Right panel');
    }
  });

  it('starts collapsed on request even with panels registered', (): void => {
    // Pins that startCollapsed:true leaves the sidebar collapsed and activePanelId null despite having two panels, then opens to the requested panel on show.
    const panel1 = createTestPanel('outline', 'Document Outline', 'outline');
    const panel2 = createTestPanel('files', 'File Explorer', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel], { startCollapsed: true });

    // Requested collapse state holds even though two panels are registered.
    expect(sidebar.isCollapsed).toBe(true);
    expect(sidebar.activePanelId).toBeNull();

    // Collapsing on request is not the same state as having nothing to show, even though they look identical: a host that started collapsed still has its panels and must open on demand — the follow-up show is what separates the two.
    sidebar.show(panel1.panel.id);

    expect(sidebar.isCollapsed).toBe(false);
    expect(sidebar.activePanelId).toBe('outline');
  });

  it('renders two tab buttons and two tabpanel containers with matching aria-controls and id attributes', (): void => {
    // Pins that two registered panels produce two rail buttons with role="tab" and two containers with role="tabpanel", with aria-controls matching container id.
    const panel1 = createTestPanel('outline', 'Document Outline', 'outline');
    const panel2 = createTestPanel('files', 'File Explorer', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    const buttons = sidebar.element.querySelectorAll('button[role="tab"]');
    const containers = sidebar.element.querySelectorAll('div[role="tabpanel"]');

    expect(buttons.length).toBe(2);
    expect(containers.length).toBe(2);

    const firstButton = buttons[0];
    const secondButton = buttons[1];
    const firstContainer = containers[0];
    const secondContainer = containers[1];

    expect(firstButton).toBeDefined();
    expect(secondButton).toBeDefined();
    expect(firstContainer).toBeDefined();
    expect(secondContainer).toBeDefined();

    // Check if DOM elements are defined under strict noUncheckedIndexedAccess.
    if (
      firstButton !== undefined &&
      secondButton !== undefined &&
      firstContainer !== undefined &&
      secondContainer !== undefined
    ) {
      // First panel: verify button aria-controls matches container id, and container aria-labelledby matches button id.
      expect(firstButton.getAttribute('aria-controls')).toBe(firstContainer.id);
      expect(firstContainer.getAttribute('aria-labelledby')).toBe(firstButton.id);
      expect(firstContainer.id).toBe('kdoc-sidebar-panel-outline');

      // Second panel: verify button aria-controls matches container id, and container aria-labelledby matches button id.
      expect(secondButton.getAttribute('aria-controls')).toBe(secondContainer.id);
      expect(secondContainer.getAttribute('aria-labelledby')).toBe(secondButton.id);
      expect(secondContainer.id).toBe('kdoc-sidebar-panel-files');
    } else {
      // Undefined tab elements.
    }
  });

  it('calls mount exactly once per panel at registration and never during subsequent switches', (): void => {
    // Pins that mount is called exactly once per panel at registration, not per switch.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    expect(panel1.mountCalls.length).toBe(1);
    expect(panel2.mountCalls.length).toBe(1);

    // Switch back and forth between the panels three times.
    sidebar.show('files');
    sidebar.show('outline');
    sidebar.show('files');
    sidebar.show('outline');
    sidebar.show('files');
    sidebar.show('outline');

    // Panels are hidden rather than unmounted, so a switch cannot throw away a panel's scroll position or state.
    expect(panel1.mountCalls.length).toBe(1);
    expect(panel2.mountCalls.length).toBe(1);
  });

  it('shows the first panel initially by default, and respects initialPanelId when specified', (): void => {
    // Pins that the first panel is shown initially, and initialPanelId selects a different one when given.
    const p1 = createTestPanel('outline', 'Outline', 'outline');
    const p2 = createTestPanel('files', 'Files', 'files');
    const sidebarDefault = createTestSidebar([p1.panel, p2.panel]);

    expect(sidebarDefault.activePanelId).toBe('outline');
    expect(sidebarDefault.isCollapsed).toBe(false);

    const defaultContainers = sidebarDefault.element.querySelectorAll<HTMLElement>('div[role="tabpanel"]');
    const container1 = defaultContainers[0];
    const container2 = defaultContainers[1];
    // Check if container elements are defined under strict noUncheckedIndexedAccess.
    if (container1 !== undefined && container2 !== undefined) {
      expect(container1.hidden).toBe(false);
      expect(container2.hidden).toBe(true);
    } else {
      // Undefined container elements.
    }

    const p3 = createTestPanel('outline', 'Outline', 'outline');
    const p4 = createTestPanel('files', 'Files', 'files');
    const sidebarCustom = createTestSidebar([p3.panel, p4.panel], {
      initialPanelId: 'files',
    });

    expect(sidebarCustom.activePanelId).toBe('files');
    expect(sidebarCustom.isCollapsed).toBe(false);

    const customContainers = sidebarCustom.element.querySelectorAll<HTMLElement>('div[role="tabpanel"]');
    const customContainer1 = customContainers[0];
    const customContainer2 = customContainers[1];
    // Check if custom container elements are defined under strict noUncheckedIndexedAccess.
    if (customContainer1 !== undefined && customContainer2 !== undefined) {
      expect(customContainer1.hidden).toBe(true);
      expect(customContainer2.hidden).toBe(false);
    } else {
      // Undefined container elements.
    }
  });

  it('reveals target container, hides other containers, updates aria-selected, and calls activate on show(id)', (): void => {
    // Pins that show(id) reveals that panel's container, hides the other, sets aria-selected correctly on both, and calls that panel's activate.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    const buttons = sidebar.element.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const containers = sidebar.element.querySelectorAll<HTMLElement>('div[role="tabpanel"]');
    const btn1 = buttons[0];
    const btn2 = buttons[1];
    const c1 = containers[0];
    const c2 = containers[1];

    expect(panel1.activateCalls.length).toBe(1);
    expect(panel2.activateCalls.length).toBe(0);

    sidebar.show('files');

    expect(sidebar.activePanelId).toBe('files');
    expect(panel2.activateCalls.length).toBe(1);

    // Check if elements are defined under strict noUncheckedIndexedAccess.
    if (
      btn1 !== undefined &&
      btn2 !== undefined &&
      c1 !== undefined &&
      c2 !== undefined
    ) {
      expect(c1.hidden).toBe(true);
      expect(c2.hidden).toBe(false);
      expect(btn1.getAttribute('aria-selected')).toBe('false');
      expect(btn2.getAttribute('aria-selected')).toBe('true');
      expect(btn1.tabIndex).toBe(-1);
      expect(btn2.tabIndex).toBe(0);
    } else {
      // Undefined elements.
    }
  });

  it('preserves existing state and does not throw when show is called with an unregistered id', (): void => {
    // Pins that show on an unregistered id changes nothing and does not throw.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    expect(sidebar.activePanelId).toBe('outline');

    // A caller asking for a panel that is not registered is a programming error that should not take the sidebar down with it.
    expect((): void => {
      sidebar.show('unregistered-panel-id');
    }).not.toThrow();

    expect(sidebar.activePanelId).toBe('outline');
    expect(sidebar.isCollapsed).toBe(false);

    const buttons = sidebar.element.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const containers = sidebar.element.querySelectorAll<HTMLElement>('div[role="tabpanel"]');
    const btn1 = buttons[0];
    const c1 = containers[0];
    // Check if elements are defined under strict noUncheckedIndexedAccess.
    if (btn1 !== undefined && c1 !== undefined) {
      expect(c1.hidden).toBe(false);
      expect(btn1.getAttribute('aria-selected')).toBe('true');
    } else {
      // Undefined elements.
    }
  });

  it('collapses sidebar, resets activePanelId to null, and hides body while retaining rail when toggling active panel', (): void => {
    // Pins that toggle(id) on the active panel collapses: isCollapsed becomes true, activePanelId becomes null, and the body is hidden while the rail is still in the DOM.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    expect(sidebar.activePanelId).toBe('outline');
    expect(sidebar.isCollapsed).toBe(false);

    sidebar.toggle('outline');

    expect(sidebar.isCollapsed).toBe(true);
    expect(sidebar.activePanelId).toBeNull();

    const bodyElement = sidebar.element.querySelector('.kdoc-sidebar-body');
    const railElement = sidebar.element.querySelector('.kdoc-sidebar-rail');

    expect(bodyElement).not.toBeNull();
    expect(railElement).not.toBeNull();

    // Check if body and rail elements are present in DOM.
    if (bodyElement instanceof HTMLElement && railElement instanceof HTMLElement) {
      expect(bodyElement.hidden).toBe(true);
      // Collapsing to nothing would leave no way back without a menu.
      expect(sidebar.element.contains(railElement)).toBe(true);
    } else {
      // Missing body or rail element.
    }

    const buttons = sidebar.element.querySelectorAll('button[role="tab"]');
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // Check if button is defined under strict noUncheckedIndexedAccess.
      if (btn !== undefined) {
        expect(btn.getAttribute('aria-selected')).toBe('false');
      } else {
        // Undefined button.
      }
    }
  });

  it('switches to the requested panel rather than collapsing when toggle is called on a different panel', (): void => {
    // Pins that toggle(id) on a different panel switches to it rather than collapsing.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    expect(sidebar.activePanelId).toBe('outline');

    sidebar.toggle('files');

    expect(sidebar.isCollapsed).toBe(false);
    expect(sidebar.activePanelId).toBe('files');

    const containers = sidebar.element.querySelectorAll<HTMLElement>('div[role="tabpanel"]');
    const c1 = containers[0];
    const c2 = containers[1];
    // Check if containers are defined under strict noUncheckedIndexedAccess.
    if (c1 !== undefined && c2 !== undefined) {
      expect(c1.hidden).toBe(true);
      expect(c2.hidden).toBe(false);
    } else {
      // Undefined containers.
    }
  });

  it('notifies onActiveChange with panel id on show and with null on collapse', (): void => {
    // Pins that onActiveChange fires with the panel id on show and with null on collapse.
    const notifications: (string | null)[] = [];
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');

    const sidebar = createTestSidebar([panel1.panel, panel2.panel], {
      onActiveChange: (panelId: string | null): void => {
        notifications.push(panelId);
      },
    });

    // Initial show at registration notifies initial panel id.
    expect(notifications).toEqual(['outline']);

    // Show different panel:
    sidebar.show('files');
    expect(notifications).toEqual(['outline', 'files']);

    // Redundant show of already visible panel does not re-notify:
    sidebar.show('files');
    expect(notifications).toEqual(['outline', 'files']);

    // Collapse notifies null:
    sidebar.collapse();
    expect(notifications).toEqual(['outline', 'files', null]);

    // Redundant collapse does not re-notify:
    sidebar.collapse();
    expect(notifications).toEqual(['outline', 'files', null]);

    // Toggle to open panel again notifies panel id:
    sidebar.toggle('files');
    expect(notifications).toEqual(['outline', 'files', null, 'files']);

    // Toggle active panel collapses and notifies null:
    sidebar.toggle('files');
    expect(notifications).toEqual(['outline', 'files', null, 'files', null]);
  });

  it('calls preventDefault on rail button mousedown to preserve editor pane focus and selection', (): void => {
    // Pins that a rail button's mousedown has defaultPrevented set.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const sidebar = createTestSidebar([panel1.panel]);

    const button = sidebar.element.querySelector('button[role="tab"]');
    expect(button).not.toBeNull();

    // Check if button exists in DOM.
    if (button instanceof HTMLButtonElement) {
      const mousedownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(mousedownEvent);

      // Without it, clicking the rail moves focus out of the editor pane and collapses the selection — the same defect the format toolbar had.
      expect(mousedownEvent.defaultPrevented).toBe(true);
    } else {
      // Button not found.
    }
  });

  it('navigates with ArrowDown to the next panel and wraps with ArrowUp to the last panel', (): void => {
    // Pins that ArrowDown on the rail moves to the next panel and ArrowUp wraps to the last, asserting the resulting activePanelId.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const panel3 = createTestPanel('search', 'Search', 'search');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel, panel3.panel]);

    expect(sidebar.activePanelId).toBe('outline');

    const buttons = sidebar.element.querySelectorAll('button[role="tab"]');
    const firstButton = buttons[0];
    expect(firstButton).toBeDefined();

    // Check if first button exists in DOM.
    if (firstButton instanceof HTMLButtonElement) {
      firstButton.focus();

      // ArrowDown from panel 1 ('outline') moves to the next panel ('files').
      const downEvent = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      firstButton.dispatchEvent(downEvent);
      expect(sidebar.activePanelId).toBe('files');

      // Focus first button again to test ArrowUp wrapping from first panel to last panel ('search').
      firstButton.focus();

      const upEvent = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      });
      firstButton.dispatchEvent(upEvent);
      expect(sidebar.activePanelId).toBe('search');
    } else {
      // First button not found.
    }
  });

  it('calls destroy on every panel, removes root element from DOM, and is idempotent on repeat destroy', (): void => {
    // Pins that destroy() calls every panel's destroy, removes the element from the document, and is idempotent.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel]);

    expect(document.body.contains(sidebar.element)).toBe(true);
    expect(panel1.destroyCalls.length).toBe(0);
    expect(panel2.destroyCalls.length).toBe(0);

    sidebar.destroy();

    expect(panel1.destroyCalls.length).toBe(1);
    expect(panel2.destroyCalls.length).toBe(1);
    expect(document.body.contains(sidebar.element)).toBe(false);

    // Call destroy a second time to verify idempotence:
    expect((): void => {
      sidebar.destroy();
    }).not.toThrow();

    // Destroy hooks must not be called repeatedly:
    expect(panel1.destroyCalls.length).toBe(1);
    expect(panel2.destroyCalls.length).toBe(1);
    expect(document.body.contains(sidebar.element)).toBe(false);
  });

  it('takes both hosts out of flex flow so a panel floats instead of shrinking the document', (): void => {
    // Pins that left and right sidebar hosts are taken out of flex flow via absolute positioning with 6px gutter insets and pointer-events: none, while the rail restores pointer-events: auto; if flex flow were retained, opening a sidebar would squeeze the document pane, and without pointer-events: none on the host, clicks in the gutter would be swallowed.
    const styleElement = document.createElement('style');
    styleElement.textContent = SIDEBAR_STYLES;
    document.head.appendChild(styleElement);

    const panel = createTestPanel('outline', 'Document Outline', 'outline');
    const leftSidebar = createTestSidebar([panel.panel], { side: 'left' });
    const rightSidebar = createTestSidebar([panel.panel], { side: 'right' });

    // Assert via getComputedStyle that both hosts have position absolute, gutters are 6px, and host pointer-events is none.
    expect(getComputedStyle(leftSidebar.element).position).toBe('absolute');
    expect(getComputedStyle(rightSidebar.element).position).toBe('absolute');
    expect(getComputedStyle(leftSidebar.element).left).toBe('6px');
    expect(getComputedStyle(rightSidebar.element).right).toBe('6px');
    expect(getComputedStyle(leftSidebar.element).pointerEvents).toBe('none');

    const rail = leftSidebar.element.querySelector('.kdoc-sidebar-rail');
    // Check if the rail element is an HTMLElement before asserting its computed styles.
    if (rail instanceof HTMLElement) {
      // Rail restores pointer-events to auto so tab buttons remain interactive.
      expect(getComputedStyle(rail).pointerEvents).toBe('auto');
    } else {
      // Rail element was expected to exist inside the left sidebar host.
      throw new Error('Expected .kdoc-sidebar-rail to exist inside the left sidebar host.');
    }

    styleElement.remove();
  });

  it('couples the depressed class to both aria-selected and aria-pressed on the active rail button', (): void => {
    // Pins that active rail buttons couple the tactile depressed class to both aria-selected and aria-pressed attributes across show, switch, and collapse states; decoupling them or relying on styling alone would break screen reader navigation and tactile feedback synchronization.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel], { startCollapsed: true });

    const buttons = sidebar.element.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const btn1 = buttons[0];
    const btn2 = buttons[1];

    // Check if rail buttons are defined under strict noUncheckedIndexedAccess.
    if (btn1 === undefined || btn2 === undefined) {
      // Rail buttons not found in the tablist.
      throw new Error('Expected two button[role="tab"] elements in the rail.');
    } else {
      // Rail buttons are present in the tablist.
    }

    // Initially startCollapsed: btn1 has no depressed class and aria-pressed is false.
    expect(btn1.classList.contains('depressed')).toBe(false);
    expect(btn1.getAttribute('aria-pressed')).toBe('false');

    // Show outline: btn1 becomes depressed, selected, and pressed; btn2 remains unpressed and not depressed.
    sidebar.show('outline');
    expect(btn1.classList.contains('depressed')).toBe(true);
    expect(btn1.getAttribute('aria-selected')).toBe('true');
    expect(btn1.getAttribute('aria-pressed')).toBe('true');
    expect(btn2.classList.contains('depressed')).toBe(false);
    expect(btn2.getAttribute('aria-pressed')).toBe('false');

    // Show files: states swap exactly between btn1 and btn2.
    sidebar.show('files');
    expect(btn1.classList.contains('depressed')).toBe(false);
    expect(btn1.getAttribute('aria-selected')).toBe('false');
    expect(btn1.getAttribute('aria-pressed')).toBe('false');
    expect(btn2.classList.contains('depressed')).toBe(true);
    expect(btn2.getAttribute('aria-selected')).toBe('true');
    expect(btn2.getAttribute('aria-pressed')).toBe('true');

    // Collapse sidebar: neither button has depressed class and btn2 aria-pressed resets to false.
    sidebar.collapse();
    expect(btn1.classList.contains('depressed')).toBe(false);
    expect(btn2.classList.contains('depressed')).toBe(false);
    expect(btn2.getAttribute('aria-pressed')).toBe('false');
  });

  it('retains a panel scroll position across hide and show', (): void => {
    // Pins that a panel's internal scroll position is preserved across hide and show transitions; tearing down or recreating panel contents on hide would snap the viewport to top and lose the user's reading position in document outlines.
    let outlineScroller: HTMLElement | null = null;

    const outlinePanel: SidebarPanel = {
      id: 'outline',
      label: 'Outline',
      icon: 'outline',
      mount(container: HTMLElement): void {
        const scroller = document.createElement('div');
        scroller.style.overflow = 'auto';
        scroller.style.height = '100px';

        const inner = document.createElement('div');
        inner.style.height = '500px';
        scroller.appendChild(inner);

        container.appendChild(scroller);
        outlineScroller = scroller;
      },
    };

    const filesPanel = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([outlinePanel, filesPanel.panel]);

    // Guard that the scroller element was mounted and assigned.
    if (outlineScroller === null) {
      // Outline scroller element missing.
      throw new Error('Expected outlineScroller to be assigned during panel mount.');
    } else {
      // Outline scroller element successfully assigned.
    }

    const scroller: HTMLElement = outlineScroller;
    scroller.scrollTop = 175;
    expect(scroller.scrollTop).toBe(175);

    sidebar.show('files');

    const outlineContainer = sidebar.element.querySelector('#kdoc-sidebar-panel-outline');
    // Check if the outline container element is an HTMLElement.
    if (outlineContainer instanceof HTMLElement) {
      expect(outlineContainer.hidden).toBe(true);
    } else {
      // Outline container missing from DOM.
      throw new Error('Expected #kdoc-sidebar-panel-outline to exist in the sidebar.');
    }

    sidebar.show('outline');
    expect(outlineContainer.hidden).toBe(false);
    expect(scroller.scrollTop).toBe(175);
  });

  it('keeps the rail visible and clickable while the body is collapsed', (): void => {
    // Pins that collapsing the sidebar body card leaves the rail tabs visible and clickable; if collapsing hid the entire host or detached the rail, users would have no visible surface to reopen the panel.
    const panel1 = createTestPanel('outline', 'Outline', 'outline');
    const panel2 = createTestPanel('files', 'Files', 'files');
    const sidebar = createTestSidebar([panel1.panel, panel2.panel], { startCollapsed: true });

    const rail = sidebar.element.querySelector('.kdoc-sidebar-rail');
    const body = sidebar.element.querySelector('.kdoc-sidebar-body');

    // Guard that both rail and body elements exist and are HTMLElements.
    if (!(rail instanceof HTMLElement) || !(body instanceof HTMLElement)) {
      // Missing rail or body host element.
      throw new Error('Expected both .kdoc-sidebar-rail and .kdoc-sidebar-body to exist.');
    } else {
      // Both rail and body elements are present.
    }

    expect(body.hidden).toBe(true);
    expect(rail.hidden).toBe(false);

    const tabButton = rail.querySelector('button[role="tab"]');
    // Guard that the rail tab button exists and is an HTMLButtonElement before simulating click.
    if (!(tabButton instanceof HTMLButtonElement)) {
      // Rail tab button missing from DOM.
      throw new Error('Expected button[role="tab"] inside rail.');
    } else {
      // Rail tab button is present.
    }

    tabButton.click();

    expect(sidebar.isCollapsed).toBe(false);
    expect(body.hidden).toBe(false);
    expect(sidebar.activePanelId).toBe('outline');
  });
});
