// @vitest-environment jsdom

/**
 * @file ribbon.spec.ts
 * @purpose Vitest test suite for K-Doc's Material 3 Expressive ribbon command surface (@k-doc/app, FR-14.1).
 *   Validates curated layout specification integrity, registry resolution, DOM rendering of tab strips and command plateaus,
 *   ARIA tab navigation and keyboard arrow switching, visibility states (expanded, collapsed, hidden),
 *   contextual Table tab dynamic visibility, depressed toggle states with aria-pressed, Home tab formatting coverage,
 *   command enabledness reflection, and lifecycle teardown under jsdom.
 * @inputs Markdown test fixtures, DocumentSession instances, ProseMirrorBinding views, synthetic DOM click/keydown events, and live KdocCommand definitions.
 * @outputs Vitest assertions verifying layout structure, button titles and shortcuts, ARIA tab attributes (role, aria-selected, aria-controls), depressed aria-pressed states, visibility transitions, and controller destruction.
 * @functions
 *   - mountRibbon: Creates DOM containers, initializes a DocumentSession and ProseMirrorBinding, builds a command registry, and installs a Ribbon controller with recorded teardown.
 *   - buttonLabels: Queries text contents of all ribbon buttons rendered in the container.
 *   - tabButtons: Queries all [role="tab"] elements within the container, narrowing to HTMLElement.
 *   - mountWithLayout: Installs a Ribbon controller with a custom layout specification.
 *   - tabNames: Queries trimmed label strings of all rendered tab elements.
 * @dataflow Markdown fixture -> DocumentSession & ProseMirrorBinding -> buildCommandRegistry -> installRibbon -> DOM interactions & state mutations -> assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across layout, rendering, tabs, states, contextual tab, toggle states, formatting coverage, and enabled state -> tear down active ribbons, bindings, and mounts in afterEach.
 * @version 18
 * @date 2026-10-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '@k-doc/editor';
import {
  installRibbon,
  RIBBON_LAYOUT,
  TABLE_TAB_SPEC,
  type Ribbon,
  type RibbonOptions,
  type RibbonState,
  type RibbonTabSpec,
} from '../src/shell/ribbon.js';
import { buildCommandRegistry, type KdocCommand } from '../src/shell/command-registry.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];
let activeRibbons: Ribbon[] = [];

afterEach(() => {
  for (let i = 0; i < activeRibbons.length; i++) {
    const ribbon = activeRibbons[i];
    // Check if ribbon controller is defined under strict indexing.
    if (ribbon !== undefined) {
      // Destroy active ribbon controller.
      ribbon.destroy();
    } else {
      // Undefined ribbon controller.
    }
  }
  activeRibbons = [];

  for (let i = 0; i < activeBindings.length; i++) {
    const binding = activeBindings[i];
    // Check if editor binding is defined under strict indexing.
    if (binding !== undefined) {
      // Destroy active ProseMirror binding.
      binding.destroy();
    } else {
      // Undefined binding.
    }
  }
  activeBindings = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const mount = activeMounts[i];
    // Check if mount element is defined and attached to parent DOM node.
    if (mount !== undefined && mount.parentNode !== null) {
      // Detach mount element from document body.
      mount.parentNode.removeChild(mount);
    } else {
      // Mount already detached or undefined.
    }
  }
  activeMounts = [];
});

/**
 * Instantiates a DOM container, DocumentSession, and ProseMirrorBinding, builds the command registry,
 * installs a Ribbon controller with state change listener, and registers all instances for teardown.
 *
 * @purpose Sets up a fully mounted Ribbon controller with real ProseMirror editor view and spy dependency callbacks.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @inputs extraOptions - Optional partial overrides for RibbonOptions (e.g. isActive predicate).
 * @outputs Object containing ribbon controller, container element, commands array, calls recorder array, and states recorder array.
 * @dataflow markdown -> DocumentSession -> ProseMirrorBinding -> buildCommandRegistry -> installRibbon -> harness record.
 * @controlflow Mount editor and ribbon containers -> initialize session and focus kdoc -> bind editor view -> build command registry with recording dependency closures -> install ribbon -> record instances in active tracking arrays -> return harness record.
 */
function mountRibbon(
  markdown: string,
  extraOptions?: Partial<RibbonOptions>,
): {
  ribbon: Ribbon;
  container: HTMLElement;
  commands: readonly KdocCommand[];
  calls: string[];
  states: RibbonState[];
} {
  const editorMount = document.createElement('div');
  document.body.appendChild(editorMount);
  activeMounts.push(editorMount);

  const container = document.createElement('div');
  document.body.appendChild(container);
  activeMounts.push(container);

  const session = new DocumentSession(markdown);
  session.focusPane('kdoc');

  const binding = new ProseMirrorBinding({ session, mount: editorMount });
  activeBindings.push(binding);

  const calls: string[] = [];
  const commands = buildCommandRegistry({
    view: binding.view,
    newDocument: (): void => {
      calls.push('newDocument');
    },
    closeDocument: (): void => {
      calls.push('closeDocument');
    },
    nextDocument: (): void => {
      calls.push('nextDocument');
    },
    openDocument: (): void => {
      calls.push('openDocument');
    },
    saveDocument: (): void => {
      calls.push('saveDocument');
    },
    saveDocumentAs: (): void => {
      calls.push('saveDocumentAs');
    },
    exportHtml: (): void => {
      calls.push('exportHtml');
    },
    printDocument: (): void => {
      calls.push('printDocument');
    },
    zoomIn: (): void => {
      calls.push('zoomIn');
    },
    zoomOut: (): void => {
      calls.push('zoomOut');
    },
    zoomReset: (): void => {
      calls.push('zoomReset');
    },
    openSettings: (): void => {
      calls.push('openSettings');
    },
    openKeyboardShortcuts: (): void => {
      calls.push('openKeyboardShortcuts');
    },
    openAbout: (): void => {
      calls.push('openAbout');
    },
    goBack: (): void => {
      calls.push('goBack');
    },
    goForward: (): void => {
      calls.push('goForward');
    },
    cycleRibbon: (): void => {
      calls.push('cycleRibbon');
    },
    customiseRibbon: (): void => {
      calls.push('customiseRibbon');
    },
    showGraph: (): void => {
      calls.push('showGraph');
    },
    openVault: (): void => {
      calls.push('openVault');
    },
    makeDefaultMarkdownApp: (): void => {
      calls.push('makeDefaultMarkdownApp');
    },
    openUserGuide: (): void => {
      calls.push('openUserGuide');
    },
    openDocumentBeside: (): void => {
      calls.push('openDocumentBeside');
    },
    exportThroughPlugin: (): void => {
      calls.push('exportThroughPlugin');
    },
    reloadPlugins: (): void => {
      calls.push('reloadPlugins');
    },
    setViewMode: (): void => {
      calls.push('setViewMode');
    },
    toggleTheme: (): void => {
      calls.push('toggleTheme');
    },
    toggleOutline: (): void => {
      calls.push('toggleOutline');
    },
    toggleSyncScroll: (): void => {
      calls.push('toggleSyncScroll');
    },
    toggleStatusBar: (): void => {
      calls.push('toggleStatusBar');
    },
    openFind: (): void => {
      calls.push('openFind');
    },
    pageSetup: (): void => {},
    pasteSpecial: (): void => {},
    quickOpen: (): void => {},
    setColumnWidth: (): void => {},
    toggleFold: (): void => {},
    toggleRightPanel: (): void => {},
    openReplacements: (): void => {},
    openSnippets: (): void => {},
    splitAtHeading: (): void => {},
    mergeDocument: (): void => {},
    takeSnapshot: (): void => {},
    convertToReferenceLinks: (): void => {},
    showLinkDefinitions: (): void => {},
    showVersionHistory: (): void => {},
    compareDocuments: (): void => {},
    gitStageFile: (): void => {},
    gitCommitFile: (): void => {},
    toggleFocusParagraph: (): void => {},
    toggleFocusSentence: (): void => {},
    toggleTypewriter: (): void => {},
    toggleZen: (): void => {},
    startPresentation: (): void => {},
    checkGrammar: (): void => {},
    exportDocx: (): void => {},
    exportMarkdown: (): void => {},
    chooseExportTheme: (): void => {},
    reportUnusedAttachments: (): void => {},
    alignBlocks: (): void => {},
    exportThroughPandoc: (): void => {},
    openExportThemeFolder: (): void => {},
    chooseAppTheme: (): void => {},
    openAppThemeFolder: (): void => {},
    chooseSpellingLanguage: (): void => {},
    importDocument: (): void => {},
    bundleAnnotations: (): void => {},
    toggleSecondaryPane: (): void => {},
    unlockDocument: (): void => {},
    cycleDocumentWidth: (): void => {},
    cycleDocumentDensity: (): void => {},
    clearDocumentDisplay: (): void => {},
    foldAllHeadings: (): void => {},
    unfoldAll: (): void => {},
    insertTableOfContents: (): void => {},
    goTo: (): void => {},
    openRecent: (): void => {},
    saveACopy: (): void => {},
    renameDocument: (): void => {},
    revealDocument: (): void => {},
    openStylesGallery: (): void => {},
    openListPicker: (): void => {},
    openLink: (): void => {
      calls.push('openLink');
    },
    undo: (): void => {
      calls.push('undo');
    },
    redo: (): void => {
      calls.push('redo');
    },
    checkSpelling: (): void => {
      calls.push('checkSpelling');
    },
    toggleSpellCheck: (): void => {
      calls.push('toggleSpellCheck');
    },
    insertImage: (): void => {
      calls.push('insertImage');
    },
    insertTable: (): void => {
      calls.push('insertTable');
    },
    setCodeLanguage: (): void => {
      calls.push('setCodeLanguage');
    },
    showStatistics: (): void => {
      calls.push('showStatistics');
    },
    pasteAsPlainText: (): void => {
      calls.push('pasteAsPlainText');
    },
    copyAsMarkdown: (): void => {
      calls.push('copyAsMarkdown');
    },
    copyAsHtml: (): void => {
      calls.push('copyAsHtml');
    },
    openCommandPalette: (): void => {
      calls.push('openCommandPalette');
    },
    cycleViewMode: (): void => {
      calls.push('cycleViewMode');
    },
    toggleSidebar: (): void => {
      calls.push('toggleSidebar');
    },
    openReplace: (): void => {
      calls.push('openReplace');
    },
    findInVault: (): void => {
      calls.push('findInVault');
    },
    newComment: (): void => {
      calls.push('newComment');
    },
    toggleTrackChanges: (): void => {
      calls.push('toggleTrackChanges');
    },
  });

  const states: RibbonState[] = [];
  const ribbon = installRibbon({
    container,
    doc: document,
    commands: (): readonly KdocCommand[] => commands,
    onStateChange: (state: RibbonState): void => {
      states.push(state);
    },
    ...extraOptions,
  });
  activeRibbons.push(ribbon);

  return { ribbon, container, commands, calls, states };
}

/**
 * Queries the text content of every ribbon button currently rendered within the specified container element.
 *
 * @purpose Extracts button labels from all rendered .kdoc-ribbon-button elements, guarding against undefined entries and null text content.
 * @inputs container: HTMLElement - The root container hosting the ribbon elements.
 * @outputs string[] - Array of button label strings in DOM order.
 * @dataflow container.querySelectorAll -> Array.from -> map textContent with guards -> string array.
 * @controlflow Query all .kdoc-ribbon-button elements -> loop through nodes -> guard index and textContent -> collect non-null text -> return array.
 */
function buttonLabels(container: HTMLElement): string[] {
  const elements = Array.from(container.querySelectorAll('.kdoc-ribbon-button'));
  const labels: string[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Check if button element is defined under strict indexing.
    if (el !== undefined) {
      const text = el.textContent;
      // Check if textContent is non-null.
      if (text !== null) {
        labels.push(text);
      } else {
        // textContent is null: record empty string.
        labels.push('');
      }
    } else {
      // Undefined element: skip iteration.
    }
  }
  return labels;
}

/**
 * Queries all tab role elements within the specified container, narrowing each match to HTMLElement.
 *
 * @purpose Returns an array of HTMLElement tab buttons ([role="tab"]) rendered within the ribbon container.
 * @inputs container: HTMLElement - The root container hosting the ribbon elements.
 * @outputs HTMLElement[] - Array of validated tab button elements.
 * @dataflow container.querySelectorAll -> Array.from -> verify and narrow to HTMLElement -> return array.
 * @controlflow Query [role="tab"] elements -> loop through matches -> verify defined and instanceof HTMLElement -> collect elements -> return array.
 */
function tabButtons(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll('[role="tab"]'));
  const tabs: HTMLElement[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Check if element is defined and is an instance of HTMLElement.
    if (el !== undefined && el instanceof HTMLElement) {
      tabs.push(el);
    } else {
      // Element missing or not an HTMLElement: throw clear descriptive error.
      throw new Error('Tab element is not an HTMLElement or is undefined');
    }
  }
  return tabs;
}

/**
 * Installs a ribbon with a custom layout specification and registers instances for teardown.
 *
 * @purpose Helper to test custom layout rendering without default built-in layout.
 * @inputs layout - The custom RibbonTabSpec[] layout specification to mount.
 * @outputs HTMLElement - The detached container element hosting the mounted ribbon.
 * @dataflow layout -> installRibbon -> mounted container.
 * @controlflow Mount editor and container -> initialize dependencies -> install ribbon with layout callback -> register instances -> return container.
 */
function mountWithLayout(layout: readonly RibbonTabSpec[]): HTMLElement {
  const { commands } = mountRibbon('Sample text.\n');
  const container = document.createElement('div');
  document.body.appendChild(container);
  activeMounts.push(container);
  const ribbon = installRibbon({
    container,
    doc: document,
    commands: (): readonly KdocCommand[] => commands,
    layout: (): readonly RibbonTabSpec[] => layout,
  });
  activeRibbons.push(ribbon);
  return container;
}

/**
 * Queries trimmed label strings of all rendered tab elements in the container.
 *
 * @purpose Extracts tab names for layout assertions.
 * @inputs container: HTMLElement - The container element to inspect.
 * @outputs string[] - Array of trimmed tab label strings.
 * @dataflow container.querySelectorAll -> map text content.
 * @controlflow Query [role="tab"] -> map each element's textContent -> return string array.
 */
function tabNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="tab"]')).map((tab) => (tab.textContent ?? '').trim());
}

describe('the layout', () => {
  it('has exactly four base tabs: Home, Insert, Review, View', () => {
    expect(RIBBON_LAYOUT.length).toBe(4);
    const names = RIBBON_LAYOUT.map((spec) => spec.tab);
    expect(names).toEqual(['Home', 'Insert', 'Review', 'View']);
  });

  it('resolves every command id in RIBBON_LAYOUT and TABLE_TAB_SPEC against the registry', () => {
    const { commands } = mountRibbon('Sample text.\n');
    const registeredIds = new Set<string>();
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      // Check if command is defined under strict indexing.
      if (cmd !== undefined) {
        registeredIds.add(cmd.id);
      } else {
        // Undefined command entry: skip.
      }
    }

    const allSpecs: readonly RibbonTabSpec[] = [...RIBBON_LAYOUT, TABLE_TAB_SPEC];
    for (let t = 0; t < allSpecs.length; t++) {
      const tabSpec = allSpecs[t];
      // Check if tabSpec is defined under strict indexing.
      if (tabSpec === undefined) {
        continue;
      } else {
        // Tab specification is defined.
      }

      for (let g = 0; g < tabSpec.groups.length; g++) {
        const groupSpec = tabSpec.groups[g];
        // Check if groupSpec is defined under strict indexing.
        if (groupSpec === undefined) {
          continue;
        } else {
          // Group specification is defined.
        }

        for (let c = 0; c < groupSpec.commandIds.length; c++) {
          const commandId = groupSpec.commandIds[c];
          // Check if commandId is defined under strict indexing.
          if (commandId === undefined) {
            continue;
          } else {
            // Command id is defined.
          }

          // The layout names ids by hand; every single command id must resolve against the central command registry.
          expect(registeredIds.has(commandId)).toBe(true);
        }
      }
    }
  });

  it('contains no empty groups in the layout', () => {
    const allSpecs: readonly RibbonTabSpec[] = [...RIBBON_LAYOUT, TABLE_TAB_SPEC];
    for (let t = 0; t < allSpecs.length; t++) {
      const tabSpec = allSpecs[t];
      // Check if tabSpec is defined under strict indexing.
      if (tabSpec === undefined) {
        continue;
      } else {
        // Tab specification is defined.
      }

      expect(tabSpec.groups.length).toBeGreaterThan(0);
      for (let g = 0; g < tabSpec.groups.length; g++) {
        const groupSpec = tabSpec.groups[g];
        // Check if groupSpec is defined under strict indexing.
        if (groupSpec === undefined) {
          continue;
        } else {
          // Group specification is defined.
        }

        // Check that the group has at least one command configured.
        expect(groupSpec.commandIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('omits the Layout tab from the layout', () => {
    const names = RIBBON_LAYOUT.map((spec) => spec.tab);
    expect(names).not.toContain('Layout');
  });
});

describe('rendering', () => {
  it('renders a tab strip with four base tab buttons and one visible tabpanel', () => {
    const { container } = mountRibbon('Sample text.\n');
    const tabs = tabButtons(container);
    expect(tabs.length).toBe(4);

    const panels = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    // 4 base panels (contextual Table panel is not mounted into the DOM until visible).
    expect(panels.length).toBe(4);

    const visiblePanels: HTMLElement[] = [];
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      // Check if panel is defined under strict indexing.
      if (panel !== undefined) {
        // Check if panel is visible (hidden attribute is false and display style is not none).
        if (!panel.hidden && panel.style.display !== 'none') {
          visiblePanels.push(panel);
        } else {
          // Panel is hidden.
        }
      } else {
        // Undefined panel entry.
      }
    }
    expect(visiblePanels.length).toBe(1);
  });

  it('renders buttons for Home panel commands including Bold, Italic, and Heading 1', () => {
    const { container } = mountRibbon('Sample text.\n');
    const homePanel = container.querySelector<HTMLElement>('#kdoc-ribbon-panel-home');
    // Check if Home panel exists in DOM.
    if (homePanel === null) {
      throw new Error('Expected #kdoc-ribbon-panel-home to exist in DOM');
    } else {
      // Home panel found.
    }

    const labels = buttonLabels(homePanel);
    expect(labels).toContain('Bold');
    expect(labels).toContain('Italic');
    expect(labels).toContain('Heading 1');
  });

  it('assigns a non-empty title tooltip to every rendered ribbon button', () => {
    const { container } = mountRibbon('Sample text.\n');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.kdoc-ribbon-button'));
    expect(buttons.length).toBeGreaterThan(0);

    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      // Check if button is defined under strict indexing.
      if (button !== undefined) {
        // The title carries the shortcut, which is how the ribbon teaches the keyboard.
        expect(button.title.trim().length).toBeGreaterThan(0);
      } else {
        // Undefined button entry.
      }
    }
  });

  it('renders group plateaus with accessible names including Font and Paragraph', () => {
    const { container } = mountRibbon('Sample text.\n');
    const groupElements = Array.from(container.querySelectorAll<HTMLElement>('.kdoc-ribbon-group'));
    const groupLabels: string[] = [];
    for (let i = 0; i < groupElements.length; i++) {
      const el = groupElements[i];
      // Check if element is defined under strict indexing.
      if (el !== undefined) {
        const label = el.getAttribute('aria-label');
        // Check if aria-label attribute is non-null.
        if (label !== null) {
          groupLabels.push(label.trim());
        } else {
          // Null aria-label attribute.
        }
      } else {
        // Undefined group element.
      }
    }

    expect(groupLabels).toContain('Font');
    expect(groupLabels).toContain('Paragraph');
  });

  it('renders icon buttons with visually hidden labels and group labels matching aria-label', () => {
    const { container } = mountRibbon('Sample text.\n');
    const boldButton = container.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    // Check if bold button exists in DOM.
    if (boldButton === null) {
      throw new Error('Expected Bold button to exist in DOM');
    } else {
      // Bold button found.
    }

    expect(boldButton.classList.contains('is-icon')).toBe(true);
    const iconSvg = boldButton.querySelector('svg.kdoc-icon');
    expect(iconSvg).not.toBeNull();
    const hiddenSpan = boldButton.querySelector('span.kdoc-visually-hidden');
    expect(hiddenSpan).not.toBeNull();
    expect(hiddenSpan?.textContent).toBe('Bold');

    const groups = Array.from(container.querySelectorAll<HTMLElement>('.kdoc-ribbon-group'));
    expect(groups.length).toBeGreaterThan(0);
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      // Check if group is defined under strict indexing.
      if (group !== undefined) {
        const ariaLabel = group.getAttribute('aria-label');
        const labelSpan = group.querySelector<HTMLElement>('.kdoc-ribbon-group-label');
        expect(labelSpan).not.toBeNull();
        expect(labelSpan?.textContent).toBe(ariaLabel);
      } else {
        // Undefined group element.
      }
    }
  });
});

describe('tabs', () => {
  it('starts with Home as activeTab and sets aria-selected accordingly', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    expect(ribbon.activeTab).toBe('Home');

    const tabs = tabButtons(container);
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      // Check if tab element is defined under strict indexing.
      if (tab !== undefined) {
        // Check if this tab is the Home tab.
        if (tab.textContent === 'Home') {
          expect(tab.getAttribute('aria-selected')).toBe('true');
          expect(tab.tabIndex).toBe(0);
        } else {
          expect(tab.getAttribute('aria-selected')).toBe('false');
          expect(tab.tabIndex).toBe(-1);
        }
      } else {
        // Undefined tab element.
      }
    }
  });

  it('moves aria-selected and swaps panel visibility when calling setActiveTab', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    const homePanel = container.querySelector<HTMLElement>('#kdoc-ribbon-panel-home');
    const insertPanel = container.querySelector<HTMLElement>('#kdoc-ribbon-panel-insert');
    // Check if panels exist in DOM.
    if (homePanel === null || insertPanel === null) {
      throw new Error('Expected #kdoc-ribbon-panel-home and #kdoc-ribbon-panel-insert to exist in DOM');
    } else {
      // Panels found.
    }

    ribbon.setActiveTab('Insert');
    expect(ribbon.activeTab).toBe('Insert');

    const tabs = tabButtons(container);
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      // Check if tab is defined under strict indexing.
      if (tab !== undefined) {
        // Check if this tab is Insert.
        if (tab.textContent === 'Insert') {
          expect(tab.getAttribute('aria-selected')).toBe('true');
          expect(tab.tabIndex).toBe(0);
        } else {
          expect(tab.getAttribute('aria-selected')).toBe('false');
          expect(tab.tabIndex).toBe(-1);
        }
      } else {
        // Undefined tab element.
      }
    }

    expect(homePanel.hidden).toBe(true);
    expect(homePanel.style.display).toBe('none');
    expect(insertPanel.hidden).toBe(false);
    expect(insertPanel.style.display).toBe('');
  });

  it('activates a tab when clicking its tab button', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    const tabs = tabButtons(container);
    let viewTab: HTMLElement | undefined = undefined;
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      // Check if tab is defined and matches 'View'.
      if (tab !== undefined && tab.textContent === 'View') {
        viewTab = tab;
        break;
      } else {
        // Continue searching.
      }
    }

    // Check if View tab was found.
    if (viewTab === undefined) {
      throw new Error('Expected View tab button to exist');
    } else {
      // View tab found.
    }

    viewTab.click();
    expect(ribbon.activeTab).toBe('View');
    expect(viewTab.getAttribute('aria-selected')).toBe('true');

    const viewPanel = container.querySelector<HTMLElement>('#kdoc-ribbon-panel-view');
    // Check if View panel exists in DOM.
    if (viewPanel === null) {
      throw new Error('Expected #kdoc-ribbon-panel-view to exist in DOM');
    } else {
      // View panel found.
    }
    expect(viewPanel.hidden).toBe(false);
    expect(viewPanel.style.display).toBe('');
  });

  it('navigates tabs with ArrowRight and ArrowLeft on the tab strip wrapping at both ends', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    const tabStrip = container.querySelector<HTMLElement>('.kdoc-ribbon-tab-strip');
    // Check if tab strip exists in DOM.
    if (tabStrip === null) {
      throw new Error('Expected .kdoc-ribbon-tab-strip to exist in DOM');
    } else {
      // Tab strip found.
    }

    expect(ribbon.activeTab).toBe('Home');

    // ArrowRight: Home -> Insert
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ribbon.activeTab).toBe('Insert');

    // ArrowRight: Insert -> Review
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ribbon.activeTab).toBe('Review');

    // ArrowRight: Review -> View
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ribbon.activeTab).toBe('View');

    // ArrowRight: View -> Home (wraps to start)
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(ribbon.activeTab).toBe('Home');

    // ArrowLeft: Home -> View (wraps to end)
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(ribbon.activeTab).toBe('View');

    // ArrowLeft: View -> Review
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(ribbon.activeTab).toBe('Review');

    // ArrowLeft: Review -> Insert
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(ribbon.activeTab).toBe('Insert');

    // ArrowLeft: Insert -> Home
    tabStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(ribbon.activeTab).toBe('Home');
  });
});

describe('state', () => {
  it('initializes state to expanded', () => {
    const { ribbon } = mountRibbon('Sample text.\n');
    expect(ribbon.state).toBe('expanded');
  });

  it('hides panels but keeps tab strip visible when state is collapsed', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    const tabStrip = container.querySelector<HTMLElement>('.kdoc-ribbon-tab-strip');
    const panelsContainer = container.querySelector<HTMLElement>('.kdoc-ribbon-panels');
    // Check if tab strip and panels container exist in DOM.
    if (tabStrip === null || panelsContainer === null) {
      throw new Error('Expected tab strip and panels container to exist in DOM');
    } else {
      // Elements found.
    }

    ribbon.setState('collapsed');
    expect(ribbon.state).toBe('collapsed');

    // In collapsed state, the tab strip remains visible while command panels are hidden.
    expect(container.hidden).toBe(false);
    expect(container.style.display).toBe('');
    expect(tabStrip.hidden).toBe(false);
    expect(tabStrip.style.display).toBe('');
    expect(panelsContainer.hidden).toBe(true);
    expect(panelsContainer.style.display).toBe('none');
  });

  it('hides the entire container when state is hidden', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    ribbon.setState('hidden');
    expect(ribbon.state).toBe('hidden');
    expect(container.hidden).toBe(true);
    expect(container.style.display).toBe('none');
  });

  it('fires onStateChange once per real change and not when set to existing state', () => {
    const { ribbon, states } = mountRibbon('Sample text.\n');
    expect(states.length).toBe(0);

    ribbon.setState('collapsed');
    expect(states.length).toBe(1);
    expect(states).toEqual(['collapsed']);

    // Setting the same state again must not fire onStateChange.
    ribbon.setState('collapsed');
    expect(states.length).toBe(1);

    ribbon.setState('hidden');
    expect(states.length).toBe(2);
    expect(states).toEqual(['collapsed', 'hidden']);

    // Setting the same state again must not fire onStateChange.
    ribbon.setState('hidden');
    expect(states.length).toBe(2);

    ribbon.setState('expanded');
    expect(states.length).toBe(3);
    expect(states).toEqual(['collapsed', 'hidden', 'expanded']);
  });

  it('expands the ribbon when clicking a tab while in collapsed state', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    ribbon.setState('collapsed');
    expect(ribbon.state).toBe('collapsed');

    const tabs = tabButtons(container);
    let insertTab: HTMLElement | undefined = undefined;
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      // Check if tab is defined and matches 'Insert'.
      if (tab !== undefined && tab.textContent === 'Insert') {
        insertTab = tab;
        break;
      } else {
        // Continue searching.
      }
    }

    // Check if Insert tab button was found.
    if (insertTab === undefined) {
      throw new Error('Expected Insert tab button to exist');
    } else {
      // Insert tab button found.
    }

    insertTab.click();
    expect(ribbon.state).toBe('expanded');
    expect(ribbon.activeTab).toBe('Insert');
  });
});

describe('enabled state', () => {
  it('reflects command isEnabled() state on buttons and handles refresh', () => {
    const { ribbon, container, commands } = mountRibbon('Plain paragraph text.\n');
    const labels = buttonLabels(container);

    // With the caret in a plain paragraph, table commands are in the contextual Table tab which is not yet visible.
    expect(labels).not.toContain('Delete Row');

    // format:clear-formatting is on the ribbon and is genuinely disabled because the selection is empty.
    const clearBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Clear Formatting"]');
    // Check if Clear Formatting button exists.
    if (clearBtn === null) {
      throw new Error('Expected Clear Formatting button to exist on the ribbon');
    } else {
      // Clear Formatting button exists.
    }
    expect(clearBtn.disabled).toBe(true);

    // Re-verify that refresh() leaves every button disabled matching its command's live isEnabled().
    ribbon.refresh();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.kdoc-ribbon-button'));
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      // Check if button is defined under strict indexing.
      if (button !== undefined) {
        const label = button.textContent;
        // Check if label is non-null.
        if (label !== null) {
          let matchingCmd: KdocCommand | undefined = undefined;
          for (let c = 0; c < commands.length; c++) {
            const candidate = commands[c];
            // Check if candidate is defined and matches label.
            if (candidate !== undefined && candidate.label === label) {
              matchingCmd = candidate;
              break;
            } else {
              // Not matching command.
            }
          }

          // Check if matching command was found.
          if (matchingCmd !== undefined) {
            // Button disabled attribute must match inverse of command isEnabled().
            expect(button.disabled).toBe(!matchingCmd.isEnabled());
          } else {
            // Command not found in registry: button should be disabled.
            expect(button.disabled).toBe(true);
          }
        } else {
          // Label is null.
        }
      } else {
        // Undefined button.
      }
    }
  });

  it('handles destroy idempotently and empties the container', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    expect(container.children.length).toBeGreaterThan(0);

    // Call destroy multiple times to verify idempotence without throwing.
    expect(() => {
      ribbon.destroy();
      ribbon.destroy();
    }).not.toThrow();

    // Container should be emptied of all children upon destroy.
    expect(container.children.length).toBe(0);
    expect(container.classList.contains('kdoc-ribbon')).toBe(false);
  });
});

describe('contextual Table tab', () => {
  it('appears and disappears dynamically via setContextualTableTabVisible and handles tab switching', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');

    // Initially, Table tab is not rendered in the tab strip.
    const initialTabs = tabButtons(container);
    expect(initialTabs.map((t) => t.textContent)).toEqual(['Home', 'Insert', 'Review', 'View']);
    expect(ribbon.isContextualTableTabVisible).toBe(false);

    // Calling setContextualTableTabVisible(false) when already hidden is a no-op.
    ribbon.setContextualTableTabVisible(false);
    expect(tabButtons(container).map((t) => t.textContent)).toEqual(['Home', 'Insert', 'Review', 'View']);
    expect(ribbon.isContextualTableTabVisible).toBe(false);

    // Make Table tab appear when caret enters a table.
    ribbon.setContextualTableTabVisible(true);
    expect(ribbon.isContextualTableTabVisible).toBe(true);
    const tabsWithTable = tabButtons(container);
    expect(tabsWithTable.map((t) => t.textContent)).toEqual(['Home', 'Insert', 'Review', 'View', 'Table']);

    // Calling setContextualTableTabVisible(true) when already visible is a no-op.
    ribbon.setContextualTableTabVisible(true);
    expect(tabButtons(container).map((t) => t.textContent)).toEqual(['Home', 'Insert', 'Review', 'View', 'Table']);

    // Activate the Table tab and verify panel visibility.
    ribbon.setActiveTab('Table');
    expect(ribbon.activeTab).toBe('Table');
    const tablePanel = container.querySelector<HTMLElement>('#kdoc-ribbon-panel-table');
    // Check if table panel exists in DOM.
    if (tablePanel === null) {
      throw new Error('Expected #kdoc-ribbon-panel-table to exist in DOM');
    } else {
      // Table panel exists.
    }
    expect(tablePanel.hidden).toBe(false);
    expect(tablePanel.style.display).toBe('');

    // Verify table panel contains command buttons (Rows, Columns, Layout, Sort).
    const tableBtns = Array.from(tablePanel.querySelectorAll('.kdoc-ribbon-button'));
    expect(tableBtns.length).toBeGreaterThan(0);

    // When caret exits table, setContextualTableTabVisible(false) removes tab and reverts active tab to Home.
    ribbon.setContextualTableTabVisible(false);
    expect(ribbon.isContextualTableTabVisible).toBe(false);
    expect(tabButtons(container).map((t) => t.textContent)).toEqual(['Home', 'Insert', 'Review', 'View']);
    expect(ribbon.activeTab).toBe('Home');
    expect(tablePanel.hidden).toBe(true);
    expect(tablePanel.style.display).toBe('none');
  });
});

describe('depressed state and aria-pressed', () => {
  it('carries aria-pressed attribute matching active depressed toggle state', () => {
    const { ribbon, container } = mountRibbon('Sample text.\n');
    const boldButton = container.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    // Check if bold button exists in DOM.
    if (boldButton === null) {
      throw new Error('Expected Bold button to exist in DOM');
    } else {
      // Bold button exists.
    }

    // At rest, toggle button carries aria-pressed="false".
    expect(boldButton.getAttribute('aria-pressed')).toBe('false');

    // Setting command active depresses the button and applies aria-pressed="true".
    ribbon.setCommandActive('format:bold', true);
    expect(boldButton.getAttribute('aria-pressed')).toBe('true');

    // Toggling off resets aria-pressed="false".
    ribbon.setCommandActive('format:bold', false);
    expect(boldButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('synchronizes aria-pressed with optional isActive predicate on refresh', () => {
    let activeCommand: string | null = 'format:italic';
    const { ribbon, container } = mountRibbon('Sample text.\n', {
      isActive: (id: string): boolean => id === activeCommand,
    });

    const italicButton = container.querySelector<HTMLButtonElement>('button[aria-label="Italic"]');
    const boldButton = container.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    // Check if buttons exist in DOM.
    if (italicButton === null || boldButton === null) {
      throw new Error('Expected Italic and Bold buttons to exist');
    } else {
      // Buttons found.
    }

    expect(italicButton.getAttribute('aria-pressed')).toBe('true');
    expect(boldButton.getAttribute('aria-pressed')).toBe('false');

    // Change active command and trigger refresh.
    activeCommand = 'format:bold';
    ribbon.refresh();

    expect(italicButton.getAttribute('aria-pressed')).toBe('false');
    expect(boldButton.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Home tab formatting coverage', () => {
  it('covers the essential formatting commands', () => {
    const homeSpec = RIBBON_LAYOUT.find((spec) => spec.tab === 'Home');
    // Check if Home tab specification exists.
    if (homeSpec === undefined) {
      throw new Error('Expected Home tab specification in RIBBON_LAYOUT');
    } else {
      // Home tab found.
    }

    const commandSet = new Set<string>();
    for (let g = 0; g < homeSpec.groups.length; g++) {
      const group = homeSpec.groups[g];
      // Check if group is defined.
      if (group !== undefined) {
        for (let c = 0; c < group.commandIds.length; c++) {
          const id = group.commandIds[c];
          // Check if command id is defined.
          if (id !== undefined) {
            commandSet.add(id);
          } else {
            // Undefined id.
          }
        }
      } else {
        // Undefined group.
      }
    }

    // Inline formatting coverage
    expect(commandSet.has('format:bold')).toBe(true);
    expect(commandSet.has('format:italic')).toBe(true);
    expect(commandSet.has('format:strikethrough')).toBe(true);
    expect(commandSet.has('format:inline-code')).toBe(true);
    expect(commandSet.has('format:clear-formatting')).toBe(true);

    // Heading and style selector coverage
    expect(commandSet.has('format:normal-text')).toBe(true);
    expect(commandSet.has('format:heading-1')).toBe(true);
    expect(commandSet.has('format:heading-2')).toBe(true);
    expect(commandSet.has('format:heading-3')).toBe(true);
    expect(commandSet.has('format:styles-gallery')).toBe(true);

    // Paragraph alignment and quote coverage
    expect(commandSet.has('format:align-left')).toBe(true);
    expect(commandSet.has('format:align-centre')).toBe(true);
    expect(commandSet.has('format:align-right')).toBe(true);
    expect(commandSet.has('format:blockquote')).toBe(true);

    // List and indentation coverage
    expect(commandSet.has('format:bullet-list')).toBe(true);
    expect(commandSet.has('format:numbered-list')).toBe(true);
    expect(commandSet.has('format:outdent')).toBe(true);
    expect(commandSet.has('format:indent')).toBe(true);
  });
});

describe("a layout of the reader's own", () => {
  it('draws the tabs the layout names, in its order', () => {
    const container = mountWithLayout([
      { tab: 'View', groups: [{ title: 'Panes', commandIds: ['view:toggle-outline'] }] },
      { tab: 'Home', groups: [{ title: 'Text', commandIds: ['format:bold'] }] },
    ]);
    expect(tabNames(container)).toEqual(['View', 'Home']);
  });

  it("draws K-Doc's own layout when none is supplied", () => {
    const { container } = mountRibbon('Sample text.\n');
    expect(tabNames(container)).toHaveLength(RIBBON_LAYOUT.length);
    const firstLayoutTab = RIBBON_LAYOUT[0];
    const drawnFirstTab = tabNames(container)[0];
    // Check if first layout tab and drawn tab are both defined.
    if (firstLayoutTab !== undefined && drawnFirstTab !== undefined) {
      expect(drawnFirstTab).toBe(firstLayoutTab.tab);
    } else {
      expect.unreachable('the built-in layout must contain at least one tab');
    }
  });

  it('opens on the first tab when the layout has no Home', () => {
    const container = mountWithLayout([{ tab: 'View', groups: [{ title: 'Panes', commandIds: ['view:toggle-outline'] }] }]);
    const selectedTab = container.querySelector('[role="tab"]');
    // Check if tab is HTMLElement.
    if (selectedTab instanceof HTMLElement) {
      expect(selectedTab.getAttribute('aria-selected')).toBe('true');
    } else {
      expect.unreachable('the tab must be an element');
    }
    const panel = container.querySelector('[role="tabpanel"]');
    // Check if panel is HTMLElement.
    if (panel instanceof HTMLElement) {
      expect(panel.hidden).toBe(false);
    } else {
      expect.unreachable('the panel must be an element');
    }
  });

  it('draws only the groups the layout names', () => {
    const container = mountWithLayout([{ tab: 'Home', groups: [{ title: 'Just One', commandIds: ['format:bold'] }] }]);
    const titles = Array.from(container.querySelectorAll('.kdoc-ribbon-group')).map(
      (group) => (group.getAttribute('aria-label') ?? '').trim(),
    );
    expect(titles).toEqual(['Just One']);
  });
});
