/**
 * @file ribbon.ts
 * @purpose Implements the Material 3 Expressive ribbon command surface for K-Doc (FR-14.1), providing curated Word-style shortcut strips, tactile raised plateaus, recessed toggle states, keyboard navigation, collapsible/hidden visibility states, and a contextual Table tab.
 * @inputs RibbonOptions containing container HTMLElement, Document context, commands provider callback, an optional layout callback naming what to draw (FR-14.17), an optional onStateChange listener, and an optional isActive query predicate.
 * @outputs Ribbon controller interface exposing refresh, activeTab getter, setActiveTab, state getter, setState, setContextualTableTabVisible, isContextualTableTabVisible getter, setCommandActive, and destroy, alongside RIBBON_LAYOUT, TABLE_TAB_SPEC, RIBBON_ICONS, and RIBBON_STYLES.
 * @functions
 *   - installRibbon: Instantiates and mounts the tactile ribbon command bar, binds tab navigation, command triggers, contextual tabs, and returns the Ribbon controller.
 * @dataflow Registry commands & user interactions -> Ribbon tab & button event dispatch -> command execution & state transitions -> refresh() UI updates.
 * @controlflow Build tab strip and command panels from layout or RIBBON_LAYOUT -> instantiate contextual table tab -> attach event listeners with AbortController -> sync initial state & tab -> return Ribbon controller interface with idempotent destroy.
 * @version 8
 * @date 2026-10-04
 */

import type { KdocCommand } from './command-registry.js';
import { createIcon, type IconName } from './icons.js';

export type RibbonTab = 'Home' | 'Insert' | 'Review' | 'View' | 'Table';

export interface RibbonGroup {
  readonly title: string;
  readonly commandIds: readonly string[];
}

export interface RibbonTabSpec {
  readonly tab: RibbonTab;
  readonly groups: readonly RibbonGroup[];
}

/**
 * Curated layout specification for K-Doc's Word-style shortcut ribbon (FR-14.1).
 * Features fast-path everyday shortcuts curated for writers across Home, Insert, Review, and View.
 */
export const RIBBON_LAYOUT: readonly RibbonTabSpec[] = [
  {
    tab: 'Home',
    groups: [
      {
        title: 'Font',
        commandIds: [
          'format:bold',
          'format:italic',
          'format:strikethrough',
          'format:inline-code',
          'format:clear-formatting',
        ],
      },
      {
        title: 'Styles',
        commandIds: [
          'format:normal-text',
          'format:heading-1',
          'format:heading-2',
          'format:heading-3',
          'format:styles-gallery',
        ],
      },
      {
        title: 'Paragraph',
        commandIds: [
          'format:align-left',
          'format:align-centre',
          'format:align-right',
          'format:blockquote',
        ],
      },
      {
        title: 'Lists',
        commandIds: [
          'format:bullet-list',
          'format:numbered-list',
          'format:outdent',
          'format:indent',
        ],
      },
    ],
  },
  {
    tab: 'Insert',
    groups: [
      {
        title: 'Tables',
        commandIds: ['insert:table'],
      },
      {
        title: 'Media',
        commandIds: ['insert:image'],
      },
      {
        title: 'Links',
        commandIds: ['insert:link', 'insert:footnote'],
      },
      {
        title: 'Breaks',
        commandIds: ['insert:horizontal-rule'],
      },
    ],
  },
  {
    tab: 'Review',
    groups: [
      {
        title: 'Comments',
        commandIds: ['review:new-comment'],
      },
      {
        title: 'Tracking',
        commandIds: ['review:toggle-track-changes'],
      },
      {
        title: 'Proofing',
        commandIds: ['spell:check', 'spell:toggle'],
      },
    ],
  },
  {
    tab: 'View',
    groups: [
      {
        title: 'Views',
        commandIds: ['view:wysiwyg', 'view:split', 'view:source', 'view:preview'],
      },
      {
        title: 'Zoom',
        commandIds: ['view:zoom-in', 'view:zoom-out', 'view:zoom-reset'],
      },
      {
        title: 'Focus',
        commandIds: ['view:focus-paragraph', 'view:zen'],
      },
    ],
  },
];

/**
 * Contextual specification for the Table tab, appearing only when the caret is positioned within a table.
 */
export const TABLE_TAB_SPEC: RibbonTabSpec = {
  tab: 'Table',
  groups: [
    {
      title: 'Rows',
      commandIds: [
        'table:insert-row-above',
        'table:insert-row-below',
        'table:delete-row',
      ],
    },
    {
      title: 'Columns',
      commandIds: [
        'table:insert-column-left',
        'table:insert-column-right',
        'table:delete-column',
      ],
    },
    {
      title: 'Layout',
      commandIds: [
        'table:toggle-header-row',
        'table:align-column-left',
        'table:align-column-center',
        'table:align-column-right',
      ],
    },
    {
      title: 'Sort',
      commandIds: [
        'table:sort-ascending',
        'table:sort-descending',
      ],
    },
  ],
};

/**
 * Maps command identifiers to line icon names for visual button rendering.
 */
export const RIBBON_ICONS: Readonly<Partial<Record<string, IconName>>> = Object.freeze({
  'format:bold': 'bold',
  'format:italic': 'italic',
  'format:strikethrough': 'strikethrough',
  'format:inline-code': 'code',
  'format:clear-formatting': 'clear-formatting',
  'format:align-left': 'align-left',
  'format:align-centre': 'align-centre',
  'format:align-right': 'align-right',
  'format:blockquote': 'blockquote',
  'format:bullet-list': 'bullet-list',
  'format:numbered-list': 'numbered-list',
  'format:outdent': 'outdent',
  'format:indent': 'indent',
});

export type RibbonState = 'expanded' | 'collapsed' | 'hidden';

export interface RibbonOptions {
  readonly container: HTMLElement;
  readonly doc: Document;
  readonly commands: () => readonly KdocCommand[];
  /** What to draw, when the reader has arranged the ribbon themselves; K-Doc's own layout otherwise (FR-14.17). */
  readonly layout?: () => readonly RibbonTabSpec[];
  readonly onStateChange?: (state: RibbonState) => void;
  /** Optional predicate reporting whether a command is currently active (toggled on). */
  readonly isActive?: (commandId: string) => boolean;
}

export interface Ribbon {
  refresh(): void;
  readonly activeTab: RibbonTab;
  setActiveTab(tab: RibbonTab): void;
  readonly state: RibbonState;
  setState(state: RibbonState): void;
  setContextualTableTabVisible(visible: boolean): void;
  readonly isContextualTableTabVisible: boolean;
  setCommandActive(commandId: string, active: boolean): void;
  destroy(): void;
}

/**
 * Static stylesheet for the Material 3 Expressive ribbon command surface.
 * Employs tonal container surfaces, segmented button styling, active tab indicators, and corner radius tokens.
 */
export const RIBBON_STYLES: string = `
.kdoc-ribbon {
  display: flex;
  /* One row: the tab names sit at the start of the same strip as their commands. */
  flex-direction: row;
  align-items: center;
  background: var(--kdoc-chrome-container-low);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-xl);
  margin: 0 6px 4px;
  box-shadow: none;
  user-select: none;
  box-sizing: border-box;
}

.kdoc-ribbon[hidden] {
  display: none;
}

.kdoc-ribbon-tab-strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 10px;
  border-right: 1px solid var(--kdoc-chrome-glass-edge);
  align-self: stretch;
  box-sizing: border-box;
}

.kdoc-ribbon-tab {
  height: 40px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  color: var(--kdoc-chrome-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  position: relative;
  cursor: pointer;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 150ms ease, background-color 150ms ease;
}

.kdoc-ribbon-tab:hover:not(:disabled) {
  color: var(--kdoc-chrome-text);
  background-color: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  border-radius: 12px 12px 0 0;
}

.kdoc-ribbon-tab:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-ribbon-tab[aria-selected="true"] {
  color: var(--kdoc-chrome-accent);
  font-weight: 700;
}

.kdoc-ribbon-tab[aria-selected="true"]:hover:not(:disabled) {
  color: var(--kdoc-chrome-accent);
}

.kdoc-ribbon-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--kdoc-chrome-accent);
}

.kdoc-ribbon-panels {
  display: flex;
  box-sizing: border-box;
}

.kdoc-ribbon-panels[hidden] {
  display: none;
}

.kdoc-ribbon-panel {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 4px 10px;
  box-sizing: border-box;
}

.kdoc-ribbon-panel[hidden] {
  display: none;
}

.kdoc-ribbon-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  box-shadow: none;
  box-sizing: border-box;
  flex-shrink: 0;
}

.kdoc-ribbon-group-buttons {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
}

/* Captions stay in the DOM (and in each group's aria-label) but are not drawn: the strip is one row. */
.kdoc-ribbon-group-label {
  display: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--kdoc-chrome-text-muted);
  letter-spacing: 0.4px;
  line-height: 1;
  user-select: none;
  white-space: nowrap;
}

.kdoc-ribbon-separator {
  display: none;
}

.kdoc-ribbon-button {
  height: 32px;
  min-width: 36px;
  padding: 0 10px;
  background: var(--kdoc-chrome-recessed);
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--kdoc-chrome-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  box-sizing: border-box;
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease, background-image 150ms ease;
}

.kdoc-ribbon-button.is-icon {
  padding: 0 8px;
}

.kdoc-ribbon-group-buttons > .kdoc-ribbon-button:first-of-type {
  border-radius: 18px 6px 6px 18px;
}

.kdoc-ribbon-group-buttons > .kdoc-ribbon-button:last-of-type {
  border-radius: 6px 18px 18px 6px;
}

.kdoc-ribbon-group-buttons > .kdoc-ribbon-button:only-of-type {
  border-radius: 18px;
}

.kdoc-ribbon-button[aria-pressed="true"],
.kdoc-ribbon-group-buttons > .kdoc-ribbon-button[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
  border-radius: 18px;
  font-weight: 700;
}

.kdoc-ribbon-button:disabled {
  background: transparent;
  border: 1px dashed var(--kdoc-chrome-edge);
  color: var(--kdoc-chrome-text-muted);
  box-shadow: none;
  cursor: default;
}

.kdoc-ribbon-button:hover:not(:disabled) {
  background-image: linear-gradient(
    color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent),
    color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent)
  );
}

.kdoc-ribbon-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-ribbon-button[hidden] {
  display: none;
}

.kdoc-visually-hidden {
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
  .kdoc-ribbon,
  .kdoc-ribbon *,
  .kdoc-ribbon-tab,
  .kdoc-ribbon-button {
    transition: none !important;
    animation: none !important;
  }
}
`;

interface TabButtonEntry {
  readonly tab: RibbonTab;
  readonly button: HTMLButtonElement;
}

interface TabPanelEntry {
  readonly tab: RibbonTab;
  readonly panel: HTMLElement;
}

interface CommandButtonBinding {
  readonly id: string;
  readonly button: HTMLButtonElement;
}

/**
 * Installs the ribbon command surface into the specified container, wiring tab navigation, command execution, and visibility state transitions.
 *
 * @purpose Constructs and mounts the tactile ribbon command bar, binding tab buttons, command action handlers, keyboard navigation, and lifecycle management.
 * @inputs options - RibbonOptions containing container element, Document context, commands callback, optional layout, optional onStateChange handler, and optional isActive predicate.
 * @outputs Ribbon - Controller exposing refresh, activeTab, setActiveTab, state, setState, setContextualTableTabVisible, isContextualTableTabVisible, setCommandActive, and destroy methods.
 * @dataflow Options & registry commands -> ribbon DOM elements -> tab & command event listeners -> command execution & state transitions -> refresh() synchronization.
 * @controlflow Mount tab strip and panels -> render command buttons per layout -> build contextual table tab -> bind click and keydown listeners with AbortController -> sync initial state -> return Ribbon interface.
 */
export function installRibbon(options: RibbonOptions): Ribbon {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed = false;
  let currentState: RibbonState = 'expanded';
  let currentActiveTab: RibbonTab = 'Home';
  let contextualTableTabVisible = false;

  const tabEntries: TabButtonEntry[] = [];
  const panelEntries: TabPanelEntry[] = [];
  const buttonBindings: CommandButtonBinding[] = [];
  const commandActiveStates = new Map<string, boolean>();

  // Ensure container carries base ribbon styling.
  options.container.classList.add('kdoc-ribbon');

  // Construct tab strip container.
  const tabStrip = doc.createElement('div');
  tabStrip.className = 'kdoc-ribbon-tab-strip';
  tabStrip.setAttribute('role', 'tablist');
  tabStrip.setAttribute('aria-label', 'Ribbon tabs');

  // Construct panels container hosting each tab's group controls.
  const panelsContainer = doc.createElement('div');
  panelsContainer.className = 'kdoc-ribbon-panels';

  // Read initial command catalogue to construct matching command buttons.
  const initialCommands = options.commands();
  const initialCommandMap = new Map<string, KdocCommand>();
  for (let i = 0; i < initialCommands.length; i++) {
    const cmd = initialCommands[i];
    // Check if command entry is defined to satisfy strict noUncheckedIndexedAccess.
    if (cmd !== undefined) {
      initialCommandMap.set(cmd.id, cmd);
    } else {
      // Undefined command entry: skip map addition.
    }
  }

  // What to draw: the reader's own arrangement when one was supplied, K-Doc's own layout otherwise (FR-14.17).
  const layout: readonly RibbonTabSpec[] = options.layout === undefined ? RIBBON_LAYOUT : options.layout();

  // The ribbon opens on Home, but a reader's arrangement need not have a Home tab; when it does not it opens
  // on whatever tab comes first, because a ribbon showing no panel at all is not a ribbon (FR-14.17).
  const firstTab = layout[0];
  // Check if first tab is defined and currentActiveTab is not present in the layout.
  if (firstTab !== undefined && !layout.some((spec: RibbonTabSpec): boolean => spec.tab === currentActiveTab)) {
    currentActiveTab = firstTab.tab;
  } else {
    // Either the arrangement has no tabs at all, or the tab it opens on is one of them.
  }

  /**
   * Helper constructing a tab button and its corresponding panel for a given tab specification.
   *
   * @purpose Constructs a tab button and panel container populated with groups and command buttons.
   * @inputs tabSpec - RibbonTabSpec defining the tab and its groups.
   * @inputs initialActive - RibbonTab identifying the active tab at initialization.
   * @outputs Object containing the created tab button element and panel element.
   * @dataflow tabSpec -> DOM tab button & panel -> command button elements with event bindings.
   * @controlflow Create button and panel elements -> iterate groups -> iterate commands -> attach click and mousedown listeners -> return pair.
   */
  function buildTabAndPanel(
    tabSpec: RibbonTabSpec,
    initialActive: RibbonTab,
  ): { tabButton: HTMLButtonElement; panel: HTMLElement } {
    const tabName = tabSpec.tab;
    const tabLower = tabName.toLowerCase();
    const tabId = `kdoc-ribbon-tab-${tabLower}`;
    const panelId = `kdoc-ribbon-panel-${tabLower}`;

    // 1. Construct tab button element
    const tabButton = doc.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'kdoc-ribbon-tab';
    tabButton.id = tabId;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', panelId);
    tabButton.textContent = tabName;
    tabButton.setAttribute('aria-label', tabName);

    // Check if this tab is the initial active tab.
    if (tabName === initialActive) {
      tabButton.setAttribute('aria-selected', 'true');
      tabButton.tabIndex = 0;
    } else {
      tabButton.setAttribute('aria-selected', 'false');
      tabButton.tabIndex = -1;
    }

    // Keep caret where user left it by suppressing focus movement on mousedown.
    tabButton.addEventListener(
      'mousedown',
      (event: MouseEvent): void => {
        event.preventDefault();
      },
      { signal },
    );

    tabButton.addEventListener(
      'click',
      (): void => {
        setActiveTab(tabName);
        // Check if the ribbon is currently in collapsed state.
        if (currentState === 'collapsed') {
          // In collapsed state, clicking a tab expands the ribbon command panel again.
          setState('expanded');
        } else {
          // Ribbon is already expanded or in another state: active tab switched.
        }
      },
      { signal },
    );

    // 2. Construct panel element for this tab
    const panel = doc.createElement('div');
    panel.className = 'kdoc-ribbon-panel';
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);

    // Check if this panel belongs to the active tab to set initial visibility.
    if (tabName === initialActive) {
      panel.hidden = false;
      panel.style.display = '';
    } else {
      panel.hidden = true;
      panel.style.display = 'none';
    }

    for (let groupIdx = 0; groupIdx < tabSpec.groups.length; groupIdx++) {
      const groupSpec = tabSpec.groups[groupIdx];
      // Check if groupSpec is defined to satisfy strict noUncheckedIndexedAccess.
      if (groupSpec === undefined) {
        continue;
      } else {
        // Valid group specification.
      }

      const validCommands: KdocCommand[] = [];
      for (let cmdIdx = 0; cmdIdx < groupSpec.commandIds.length; cmdIdx++) {
        const commandId = groupSpec.commandIds[cmdIdx];
        // Check if commandId is defined to satisfy strict noUncheckedIndexedAccess.
        if (commandId === undefined) {
          continue;
        } else {
          // Valid commandId string.
        }

        const cmd = initialCommandMap.get(commandId);
        // Check if command was found in initial registry map.
        if (cmd !== undefined) {
          validCommands.push(cmd);
        } else {
          // Command not found in registry: omit button deliberately.
        }
      }

      // Check if group has at least one valid command.
      if (validCommands.length === 0) {
        // Empty group: omit from rendering.
        continue;
      } else {
        // Group has valid commands: proceed to render group plateau.
      }

      const groupEl = doc.createElement('div');
      groupEl.className = 'kdoc-ribbon-group';
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute('aria-label', groupSpec.title);

      const buttonsContainer = doc.createElement('div');
      buttonsContainer.className = 'kdoc-ribbon-group-buttons';

      for (let vIdx = 0; vIdx < validCommands.length; vIdx++) {
        const cmd = validCommands[vIdx];
        // Check if cmd is defined to satisfy strict noUncheckedIndexedAccess.
        if (cmd === undefined) {
          continue;
        } else {
          // Valid command instance.
        }

        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'kdoc-ribbon-button';

        const iconName = RIBBON_ICONS[cmd.id];
        // Check if an icon is registered for this command in RIBBON_ICONS.
        if (iconName !== undefined) {
          // Icon registered: style as icon button, append SVG icon element, and append visually hidden label.
          button.classList.add('is-icon');
          button.appendChild(createIcon(doc, iconName, 18));
          const hiddenLabel = doc.createElement('span');
          hiddenLabel.className = 'kdoc-visually-hidden';
          hiddenLabel.textContent = cmd.label;
          button.appendChild(hiddenLabel);
        } else {
          // No icon registered: render textual command label directly.
          button.textContent = cmd.label;
        }

        button.setAttribute('aria-label', cmd.label);

        // Check if command defines a keyboard shortcut to format title tooltip.
        if (cmd.shortcut.length > 0) {
          button.title = `${cmd.label} (${cmd.shortcut})`;
        } else {
          button.title = cmd.label;
        }

        // Check if command is currently enabled in editor state.
        if (cmd.isEnabled()) {
          button.disabled = false;
        } else {
          button.disabled = true;
        }

        // Check initial active toggle state.
        const isActive = options.isActive !== undefined ? options.isActive(cmd.id) : false;
        commandActiveStates.set(cmd.id, isActive);
        // Check if active to assign initial aria-pressed attribute.
        if (isActive) {
          button.setAttribute('aria-pressed', 'true');
        } else {
          button.setAttribute('aria-pressed', 'false');
        }

        // Keep caret where user left it by suppressing focus movement on mousedown.
        button.addEventListener(
          'mousedown',
          (event: MouseEvent): void => {
            event.preventDefault();
          },
          { signal },
        );

        const commandId = cmd.id;
        button.addEventListener(
          'click',
          (): void => {
            // Re-read latest command from registry so execution reflects live editor state.
            const freshCommands = options.commands();
            let liveCmd: KdocCommand | undefined = undefined;
            for (let j = 0; j < freshCommands.length; j++) {
              const candidate = freshCommands[j];
              // Check candidate presence and id match.
              if (candidate !== undefined && candidate.id === commandId) {
                liveCmd = candidate;
                break;
              } else {
                // Command id mismatch: check next candidate.
              }
            }

            // Check if matching command was found in live registry.
            if (liveCmd !== undefined) {
              liveCmd.run();
              refresh();
            } else {
              // Command missing from live registry: do not execute.
            }
          },
          { signal },
        );

        buttonBindings.push({
          id: cmd.id,
          button,
        });

        buttonsContainer.appendChild(button);
      }

      groupEl.appendChild(buttonsContainer);

      const groupLabel = doc.createElement('span');
      groupLabel.className = 'kdoc-ribbon-group-label';
      groupLabel.textContent = groupSpec.title;
      groupEl.appendChild(groupLabel);

      panel.appendChild(groupEl);
    }

    return { tabButton, panel };
  }

  // Build base tabs and panels from layout specification.
  for (let tabIdx = 0; tabIdx < layout.length; tabIdx++) {
    const tabSpec = layout[tabIdx];
    // Check if tabSpec is defined to satisfy strict noUncheckedIndexedAccess.
    if (tabSpec === undefined) {
      continue;
    } else {
      // Valid tab specification: proceed to construct tab button and panel.
    }

    const { tabButton, panel } = buildTabAndPanel(tabSpec, currentActiveTab);
    tabEntries.push({ tab: tabSpec.tab, button: tabButton });
    panelEntries.push({ tab: tabSpec.tab, panel });

    tabStrip.appendChild(tabButton);
    panelsContainer.appendChild(panel);
  }

  // Contextual Table tab is part of the default layout only (FR-14.17).
  // Caller-supplied custom layouts are honoured exactly as given and never have contextual tabs injected.
  const isDefaultLayout = options.layout === undefined;
  let tableTabButton: HTMLButtonElement | undefined = undefined;
  let tablePanel: HTMLElement | undefined = undefined;

  // Check if ribbon uses default layout to configure the contextual Table tab.
  if (isDefaultLayout) {
    // Default layout: instantiate contextual Table tab without mounting it into the DOM yet.
    const built = buildTabAndPanel(TABLE_TAB_SPEC, currentActiveTab);
    tableTabButton = built.tabButton;
    tablePanel = built.panel;
    tablePanel.hidden = true;
    tablePanel.style.display = 'none';
    panelEntries.push({ tab: 'Table', panel: tablePanel });
  } else {
    // Custom layout supplied: contextual Table tab is not injected into caller-supplied layouts.
  }

  // Handle Left/Right arrow key navigation on the tab strip per the ARIA tabs pattern.
  tabStrip.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      // Check if the pressed key is an ARIA tab navigation arrow key.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const tabCount = tabEntries.length;
        // Check if there are tabs available to navigate.
        if (tabCount === 0) {
          // No tabs available: abort navigation.
          return;
        } else {
          // Tabs available: proceed to calculate target tab index.
        }

        let currentIndex = -1;
        for (let i = 0; i < tabCount; i++) {
          const entry = tabEntries[i];
          // Check if entry is defined and matches active tab.
          if (entry !== undefined && entry.tab === currentActiveTab) {
            currentIndex = i;
            break;
          } else {
            // Not current tab: continue search.
          }
        }

        // Check if the active tab was found in tabEntries.
        if (currentIndex === -1) {
          // Active tab not found: fall back to first tab.
          currentIndex = 0;
        } else {
          // Active tab found at currentIndex.
        }

        let nextIndex = 0;
        // Check arrow direction to step backwards or forwards with wrapping.
        if (event.key === 'ArrowLeft') {
          // Step left: wrap to end if at beginning.
          nextIndex = (currentIndex - 1 + tabCount) % tabCount;
        } else {
          // Step right: wrap to beginning if at end.
          nextIndex = (currentIndex + 1) % tabCount;
        }

        const nextEntry = tabEntries[nextIndex];
        // Check if target tab entry is defined to satisfy strict noUncheckedIndexedAccess.
        if (nextEntry !== undefined) {
          setActiveTab(nextEntry.tab);
          nextEntry.button.focus();
        } else {
          // Target tab entry undefined: skip focus transition.
        }
      } else {
        // Non-arrow key: allow default keyboard behavior.
      }
    },
    { signal },
  );

  // Mount tab strip and panels into container.
  options.container.appendChild(tabStrip);
  options.container.appendChild(panelsContainer);

  /**
   * Applies visibility attributes and display styling to container and sub-panels corresponding to RibbonState.
   *
   * @purpose Synchronizes DOM element visibility with the target ribbon state ('expanded', 'collapsed', or 'hidden').
   * @inputs targetState: RibbonState - The target state to reflect in DOM structure.
   * @outputs void.
   * @dataflow targetState -> container, tab strip, and panels hidden attributes and style.display values.
   * @controlflow Branch on targetState -> if hidden, hide container; if collapsed, show tab strip and hide panels; if expanded, show both.
   */
  function applyState(targetState: RibbonState): void {
    // Check target ribbon state to adjust container and panel visibility.
    if (targetState === 'hidden') {
      // Hidden: entire ribbon container is hidden from view.
      options.container.hidden = true;
      options.container.style.display = 'none';
      panelsContainer.hidden = true;
      panelsContainer.style.display = 'none';
    } else if (targetState === 'collapsed') {
      // Collapsed: tab strip remains visible but command group panels are hidden.
      options.container.hidden = false;
      options.container.style.display = '';
      tabStrip.hidden = false;
      tabStrip.style.display = '';
      panelsContainer.hidden = true;
      panelsContainer.style.display = 'none';
    } else {
      // Expanded: both tab strip and active command panel are visible.
      options.container.hidden = false;
      options.container.style.display = '';
      tabStrip.hidden = false;
      tabStrip.style.display = '';
      panelsContainer.hidden = false;
      panelsContainer.style.display = '';
    }
  }

  /**
   * Updates the ribbon visibility state and dispatches change notification if state modified.
   *
   * @purpose Changes ribbon display mode ('expanded', 'collapsed', or 'hidden') and invokes onStateChange callback.
   * @inputs newState: RibbonState - The new display mode to apply.
   * @outputs void.
   * @dataflow newState -> currentState -> applyState(currentState) -> options.onStateChange(currentState).
   * @controlflow Check destroyed guard -> check if state differs from current -> update currentState -> apply DOM changes -> invoke onStateChange callback.
   */
  function setState(newState: RibbonState): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort state modification.
      return;
    } else {
      // Component is active.
    }

    // Check if the requested state is identical to current state.
    if (newState === currentState) {
      // State is unchanged: no-op to prevent duplicate notifications.
      return;
    } else {
      // State has changed: proceed with update.
    }

    currentState = newState;
    applyState(currentState);

    // Check if a state change callback is registered.
    if (options.onStateChange !== undefined) {
      options.onStateChange(currentState);
    } else {
      // No state change callback configured.
    }
  }

  /**
   * Switches the active ribbon tab, updating ARIA selection states, tab indices, and panel visibility.
   *
   * @purpose Selects a ribbon tab and displays its corresponding command group panel.
   * @inputs tab: RibbonTab - The tab name to activate ('Home', 'Insert', 'Review', 'View', or 'Table').
   * @outputs void.
   * @dataflow tab -> currentActiveTab -> tab button aria-selected/tabindex & panel hidden/display synchronization.
   * @controlflow Check destroyed guard -> update currentActiveTab -> update tab button aria attributes and roving tabIndex -> update panel hidden and display styles.
   */
  function setActiveTab(tab: RibbonTab): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort tab switch.
      return;
    } else {
      // Component is active: proceed with tab switch.
    }

    currentActiveTab = tab;

    for (let i = 0; i < tabEntries.length; i++) {
      const entry = tabEntries[i];
      // Check if entry is defined to satisfy strict noUncheckedIndexedAccess.
      if (entry === undefined) {
        continue;
      } else {
        // Entry is defined.
      }

      const isSelected = entry.tab === currentActiveTab;
      // Check whether this tab entry is the newly selected tab.
      if (isSelected) {
        entry.button.setAttribute('aria-selected', 'true');
        entry.button.tabIndex = 0;
      } else {
        entry.button.setAttribute('aria-selected', 'false');
        entry.button.tabIndex = -1;
      }
    }

    for (let i = 0; i < panelEntries.length; i++) {
      const entry = panelEntries[i];
      // Check if entry is defined to satisfy strict noUncheckedIndexedAccess.
      if (entry === undefined) {
        continue;
      } else {
        // Entry is defined.
      }

      const isSelected = entry.tab === currentActiveTab;
      // Check whether this panel corresponds to the newly selected tab.
      if (isSelected) {
        entry.panel.hidden = false;
        entry.panel.style.display = '';
      } else {
        entry.panel.hidden = true;
        entry.panel.style.display = 'none';
      }
    }
  }

  /**
   * Sets the visibility of the contextual Table tab, attaching or detaching its tab button and panel from the DOM.
   *
   * @purpose Drives the contextual Table tab to appear or disappear based on whether the caret is within a table.
   * @inputs visible: boolean - Whether the contextual Table tab should be visible.
   * @outputs void.
   * @dataflow visible boolean -> DOM tabStrip and panelsContainer insertion/removal -> tabEntries array sync -> activeTab fallback if hidden while active.
   * @controlflow Check destroyed guard -> check if contextual tab is available -> check if visibility is unchanged (no-op) -> if visible attach button to tabStrip and panel to panelsContainer; if hidden detach both and switch to Home if active.
   */
  function setContextualTableTabVisible(visible: boolean): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort visibility update.
      return;
    } else {
      // Component is active: proceed with visibility update.
    }

    // Check if Table tab is managed contextually (not part of static custom layout).
    if (tableTabButton === undefined || tablePanel === undefined) {
      // Table is statically part of custom layout or unavailable: no-op.
      return;
    } else {
      // Contextual Table tab is available.
    }

    // Check if target visibility equals current visibility state.
    if (visible === contextualTableTabVisible) {
      // State unchanged: no-op as required by contract.
      return;
    } else {
      // State change requested.
    }

    contextualTableTabVisible = visible;

    // Check whether to show or hide the contextual Table tab.
    if (visible) {
      // Show: append tab button to tab strip and register in tabEntries.
      tabStrip.appendChild(tableTabButton);
      tabEntries.push({ tab: 'Table', button: tableTabButton });

      // Check if table panel is already attached to panels container.
      if (tablePanel.parentNode !== panelsContainer) {
        // Table panel not attached: mount table panel into panels container.
        panelsContainer.appendChild(tablePanel);
      } else {
        // Table panel already attached.
      }

      // Check if Table is currently active to set panel display state.
      if (currentActiveTab === 'Table') {
        // Table is active tab: show table panel.
        tablePanel.hidden = false;
        tablePanel.style.display = '';
      } else {
        // Another tab is active: hide table panel.
        tablePanel.hidden = true;
        tablePanel.style.display = 'none';
      }
    } else {
      // Hide: remove tab button from tab strip and unregister from tabEntries.
      // Check if table tab button is currently attached to tab strip.
      if (tableTabButton.parentNode === tabStrip) {
        // Attached: detach tab button from tab strip.
        tabStrip.removeChild(tableTabButton);
      } else {
        // Tab button already detached.
      }

      const idx = tabEntries.findIndex((e: TabButtonEntry): boolean => e.tab === 'Table');
      // Check if Table tab entry was found.
      if (idx !== -1) {
        // Entry found: remove from tabEntries array.
        tabEntries.splice(idx, 1);
      } else {
        // Table tab entry not found.
      }

      // Check if Table was the currently active tab when it disappeared.
      if (currentActiveTab === 'Table') {
        // Table was active: fall back to first layout tab or Home.
        const fallbackTab = layout[0]?.tab ?? 'Home';
        setActiveTab(fallbackTab);
      } else {
        // Table was not the active tab: active tab remains unchanged.
      }

      // Hide and detach table panel from DOM so table commands are not present when hidden.
      tablePanel.hidden = true;
      tablePanel.style.display = 'none';
      // Check if table panel is currently attached to panels container.
      if (tablePanel.parentNode === panelsContainer) {
        // Attached: detach table panel from panels container.
        panelsContainer.removeChild(tablePanel);
      } else {
        // Table panel already detached.
      }
    }
  }

  /**
   * Sets or updates the active pressed toggle state of a command button.
   *
   * @purpose Updates the aria-pressed attribute and depressed styling of matching command buttons.
   * @inputs commandId: string - The command identifier.
   * @inputs active: boolean - Whether the command toggle is active.
   * @outputs void.
   * @dataflow commandId + active -> commandActiveStates Map -> button element aria-pressed attributes.
   * @controlflow Check destroyed guard -> store active state in Map -> iterate button bindings and update matching buttons.
   */
  function setCommandActive(commandId: string, active: boolean): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      return;
    } else {
      // Component is active.
    }

    commandActiveStates.set(commandId, active);

    for (let i = 0; i < buttonBindings.length; i++) {
      const binding = buttonBindings[i];
      // Check if binding is defined and matches commandId.
      if (binding !== undefined && binding.id === commandId) {
        // Check active boolean to set aria-pressed string value.
        if (active) {
          binding.button.setAttribute('aria-pressed', 'true');
        } else {
          binding.button.setAttribute('aria-pressed', 'false');
        }
      } else {
        // Non-matching binding.
      }
    }
  }

  /**
   * Re-reads the live command registry and synchronizes the disabled attribute and active toggle state of every button.
   *
   * @purpose Updates command button disabled and active states based on current editor state and optional isActive query.
   * @inputs void.
   * @outputs void.
   * @dataflow options.commands() -> fresh KdocCommand list -> Map lookup -> button disabled & aria-pressed state synchronization.
   * @controlflow Check destroyed guard -> fetch live commands -> populate command map -> update each button binding's disabled and aria-pressed attributes.
   */
  function refresh(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: proceed with refreshing button states.
    }

    // The registry closes over live editor state, so the list must be re-read rather than captured once.
    const liveCommands = options.commands();
    const commandMap = new Map<string, KdocCommand>();
    for (let i = 0; i < liveCommands.length; i++) {
      const cmd = liveCommands[i];
      // Check if cmd is defined to satisfy strict noUncheckedIndexedAccess.
      if (cmd !== undefined) {
        commandMap.set(cmd.id, cmd);
      } else {
        // Undefined command entry: skip map addition.
      }
    }

    for (let i = 0; i < buttonBindings.length; i++) {
      const binding = buttonBindings[i];
      // Check if binding is defined to satisfy strict noUncheckedIndexedAccess.
      if (binding === undefined) {
        continue;
      } else {
        // Binding is defined.
      }

      const cmd = commandMap.get(binding.id);
      // Check if command is present in the latest registry snapshot.
      if (cmd !== undefined) {
        // Check if command is enabled in current editor state.
        if (cmd.isEnabled()) {
          binding.button.disabled = false;
        } else {
          binding.button.disabled = true;
        }
      } else {
        // Command missing from registry: disable button.
        binding.button.disabled = true;
      }

      // Check if an isActive callback was provided to evaluate active toggle state.
      if (options.isActive !== undefined) {
        const active = options.isActive(binding.id);
        commandActiveStates.set(binding.id, active);
        // Check active state to set aria-pressed attribute.
        if (active) {
          binding.button.setAttribute('aria-pressed', 'true');
        } else {
          binding.button.setAttribute('aria-pressed', 'false');
        }
      } else {
        // Retain recorded active toggle state.
        const active = commandActiveStates.get(binding.id) ?? false;
        // Check active state to set aria-pressed attribute.
        if (active) {
          binding.button.setAttribute('aria-pressed', 'true');
        } else {
          binding.button.setAttribute('aria-pressed', 'false');
        }
      }
    }
  }

  /**
   * Cleans up ribbon resources, aborting event listeners, removing CSS classes, and emptying container elements.
   *
   * @purpose Idempotently tears down ribbon event listeners, resets visibility, and removes child DOM elements.
   * @inputs void.
   * @outputs void.
   * @dataflow AbortController.abort() -> reset container style and classes -> empty container children -> mark destroyed.
   * @controlflow Check destroyed flag (return if true) -> set destroyed to true -> abort listener controller -> clean up container.
   */
  function destroy(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: proceed with destruction.
      destroyed = true;
    }

    abortController.abort();
    options.container.hidden = false;
    options.container.style.display = '';
    options.container.classList.remove('kdoc-ribbon');
    options.container.replaceChildren();
  }

  // Set initial visibility and active tab state.
  applyState(currentState);
  setActiveTab(currentActiveTab);
  refresh();

  return {
    refresh,
    get activeTab(): RibbonTab {
      return currentActiveTab;
    },
    setActiveTab,
    get state(): RibbonState {
      return currentState;
    },
    setState,
    setContextualTableTabVisible,
    get isContextualTableTabVisible(): boolean {
      return contextualTableTabVisible;
    },
    setCommandActive,
    destroy,
  };
}
