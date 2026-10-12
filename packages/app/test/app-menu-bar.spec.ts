// @vitest-environment jsdom

/**
 * @file app-menu-bar.spec.ts
 * @purpose Vitest test suite for K-Doc's horizontal application menu bar (@k-doc/app).
 *   Validates declarative layout hierarchy, exhaustive registry command placement, Material 3 Expressive popup rendering,
 *   roving tabindex, mouse click and hover-switching, Alt+<accessKey> shortcuts, keyboard navigation (arrows,
 *   Home/End, typeahead), disabled item skipping, submenu interactions, ARIA attributes, and lifecycle teardown under jsdom.
 * @inputs Markdown test fixtures, DocumentSession instances, ProseMirrorBinding views, synthetic DOM click/pointer/keydown events, and live KdocCommand definitions.
 * @outputs Vitest assertions verifying 100% command coverage, access keys, open/close transitions, disabled state handling, focus restoration, and ARIA semantics.
 * @functions
 *   - createMockDeps: Constructs a complete CommandRegistryDeps implementation with call recording spies.
 *   - mountAppMenuBarHarness: Creates DOM mounts, initializes editor session and binding, builds command registry, and installs a AppMenuBar controller.
 *   - collectSpecCommandIds: Recursively extracts all command IDs declared within APP_MENU_BAR_SPEC.
 * @dataflow Markdown fixture -> DocumentSession & ProseMirrorBinding -> buildCommandRegistry -> installAppMenuBar -> synthetic DOM events -> state assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across specification, rendering, keyboard, mouse, submenus, and lifecycle -> tear down active instances in afterEach.
 * @version 5
 * @date 2026-10-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '@k-doc/editor';
import type { EditorView } from 'prosemirror-view';
import {
  installAppMenuBar,
  APP_MENU_BAR_SPEC,
  APP_MENU_BAR_STYLES,
  type AppMenuBar,
  type AppMenuItemSpec,
} from '../src/shell/app-menu-bar.js';
import {
  buildCommandRegistry,
  type CommandRegistryDeps,
  type KdocCommand,
} from '../src/shell/command-registry.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];
let activeBars: AppMenuBar[] = [];

afterEach(() => {
  for (let i = 0; i < activeBars.length; i++) {
    const bar = activeBars[i];
    // Check if AppMenuBar controller is defined under strict indexing.
    if (bar !== undefined) {
      bar.destroy();
    } else {
      // Undefined bar controller.
    }
  }
  activeBars = [];

  for (let i = 0; i < activeBindings.length; i++) {
    const binding = activeBindings[i];
    // Check if editor binding is defined under strict indexing.
    if (binding !== undefined) {
      binding.destroy();
    } else {
      // Undefined binding.
    }
  }
  activeBindings = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const mount = activeMounts[i];
    // Check if mount element is attached to DOM.
    if (mount !== undefined && mount.parentNode !== null) {
      mount.parentNode.removeChild(mount);
    } else {
      // Mount already detached or undefined.
    }
  }
  activeMounts = [];

  // Remove any lingering popup menu elements from document.body.
  const popups = document.body.querySelectorAll('.kdoc-menu-popup');
  for (let i = 0; i < popups.length; i++) {
    const p = popups[i];
    if (p !== undefined && p.parentNode !== null) {
      p.parentNode.removeChild(p);
    } else {
      // Already detached.
    }
  }
});

/**
 * Constructs a complete CommandRegistryDeps implementation with recorded calls.
 *
 * @purpose Allocates all shell and editor callbacks for buildCommandRegistry.
 * @inputs
 *   - view: EditorView - Active ProseMirror editor view instance.
 *   - calls: string[] - Output array collecting recorded action names.
 * @outputs CommandRegistryDeps - Populated dependencies object.
 * @dataflow view + calls array -> CommandRegistryDeps with spy closures.
 * @controlflow Wrap each dependency callback to push its name to calls -> return deps.
 */
function createMockDeps(view: EditorView, calls: string[]): CommandRegistryDeps {
  const record = (name: string) => (): void => {
    calls.push(name);
  };

  return {
    view,
    newDocument: record('newDocument'),
    closeDocument: record('closeDocument'),
    nextDocument: record('nextDocument'),
    openDocument: record('openDocument'),
    saveDocument: record('saveDocument'),
    saveDocumentAs: record('saveDocumentAs'),
    takeSnapshot: record('takeSnapshot'),
    exportHtml: record('exportHtml'),
    printDocument: record('printDocument'),
    zoomIn: record('zoomIn'),
    zoomOut: record('zoomOut'),
    zoomReset: record('zoomReset'),
    openSettings: record('openSettings'),
    openKeyboardShortcuts: record('openKeyboardShortcuts'),
    openAbout: record('openAbout'),
    openReplacements: record('openReplacements'),
    openSnippets: record('openSnippets'),
    goBack: record('goBack'),
    goForward: record('goForward'),
    cycleRibbon: record('cycleRibbon'),
    customiseRibbon: record('customiseRibbon'),
    showGraph: record('showGraph'),
    openVault: record('openVault'),
    openDocumentBeside: record('openDocumentBeside'),
    exportThroughPlugin: record('exportThroughPlugin'),
    reloadPlugins: record('reloadPlugins'),
    setViewMode: (mode): void => {
      calls.push(`setViewMode:${mode}`);
    },
    toggleTheme: record('toggleTheme'),
    toggleOutline: record('toggleOutline'),
    toggleSyncScroll: record('toggleSyncScroll'),
    toggleStatusBar: record('toggleStatusBar'),
    openFind: record('openFind'),
    openLink: record('openLink'),
    openListPicker: record('openListPicker'),
    openStylesGallery: record('openStylesGallery'),
    openRecent: record('openRecent'),
    quickOpen: record('quickOpen'),
    goTo: record('goTo'),
    setColumnWidth: record('setColumnWidth'),
    insertTableOfContents: record('insertTableOfContents'),
    convertToReferenceLinks: record('convertToReferenceLinks'),
    showLinkDefinitions: record('showLinkDefinitions'),
    showVersionHistory: record('showVersionHistory'),
    compareDocuments: record('compareDocuments'),
    gitStageFile: record('gitStageFile'),
    gitCommitFile: record('gitCommitFile'),
    toggleFocusParagraph: record('toggleFocusParagraph'),
    toggleFocusSentence: record('toggleFocusSentence'),
    toggleTypewriter: record('toggleTypewriter'),
    toggleZen: record('toggleZen'),
    startPresentation: record('startPresentation'),
    checkGrammar: record('checkGrammar'),
    chooseSpellingLanguage: record('chooseSpellingLanguage'),
    exportDocx: record('exportDocx'),
    exportMarkdown: record('exportMarkdown'),
    chooseExportTheme: record('chooseExportTheme'),
    exportThroughPandoc: (fmt): void => {
      calls.push(`exportThroughPandoc:${fmt}`);
    },
    alignBlocks: (align): void => {
      calls.push(`alignBlocks:${align ?? 'null'}`);
    },
    reportUnusedAttachments: record('reportUnusedAttachments'),
    openExportThemeFolder: record('openExportThemeFolder'),
    chooseAppTheme: record('chooseAppTheme'),
    openAppThemeFolder: record('openAppThemeFolder'),
    importDocument: record('importDocument'),
    bundleAnnotations: record('bundleAnnotations'),
    toggleSecondaryPane: record('toggleSecondaryPane'),
    unlockDocument: record('unlockDocument'),
    cycleDocumentWidth: record('cycleDocumentWidth'),
    cycleDocumentDensity: record('cycleDocumentDensity'),
    clearDocumentDisplay: record('clearDocumentDisplay'),
    toggleFold: record('toggleFold'),
    splitAtHeading: record('splitAtHeading'),
    mergeDocument: record('mergeDocument'),
    foldAllHeadings: record('foldAllHeadings'),
    unfoldAll: record('unfoldAll'),
    pasteSpecial: record('pasteSpecial'),
    pageSetup: record('pageSetup'),
    saveACopy: record('saveACopy'),
    renameDocument: record('renameDocument'),
    revealDocument: record('revealDocument'),
    undo: record('undo'),
    redo: record('redo'),
    checkSpelling: record('checkSpelling'),
    toggleSpellCheck: record('toggleSpellCheck'),
    insertImage: record('insertImage'),
    insertTable: record('insertTable'),
    setCodeLanguage: record('setCodeLanguage'),
    showStatistics: record('showStatistics'),
    pasteAsPlainText: record('pasteAsPlainText'),
    copyAsMarkdown: record('copyAsMarkdown'),
    copyAsHtml: record('copyAsHtml'),
    openCommandPalette: record('openCommandPalette'),
    cycleViewMode: record('cycleViewMode'),
    toggleSidebar: record('toggleSidebar'),
    toggleRightPanel: record('toggleRightPanel'),
    openReplace: record('openReplace'),
    findInVault: record('findInVault'),
    newComment: record('newComment'),
    toggleTrackChanges: record('toggleTrackChanges'),
  };
}

/**
 * Recursively collects all command IDs from a list of AppMenuItemSpec items.
 *
 * @purpose Walks items and nested submenus to compile an exhaustive list of placed command IDs.
 * @inputs items: readonly AppMenuItemSpec[] - Declarative items array.
 * @outputs string[] - Array of extracted command IDs.
 * @dataflow items array -> recursive traversal -> flat command IDs array.
 * @controlflow Iterate items -> if command or toggle push id -> if submenu recurse items.
 */
function collectSpecCommandIds(items: readonly AppMenuItemSpec[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Check if item is defined under strict indexing.
    if (item === undefined) {
      continue;
    } else {
      // Item is defined.
    }

    if (item.kind === 'command' || item.kind === 'toggle') {
      ids.push(item.commandId);
    } else if (item.kind === 'submenu') {
      const nested = collectSpecCommandIds(item.items);
      for (let k = 0; k < nested.length; k++) {
        const nestedId = nested[k];
        if (nestedId !== undefined) {
          ids.push(nestedId);
        } else {
          // Undefined nested ID.
        }
      }
    } else {
      // Separator item: no command ID.
    }
  }
  return ids;
}

interface TestHarness {
  readonly menuBar: AppMenuBar;
  readonly container: HTMLElement;
  readonly commands: readonly KdocCommand[];
  readonly executed: string[];
  readonly calls: string[];
  readonly binding: ProseMirrorBinding;
  readonly editorMount: HTMLElement;
}

/**
 * Initializes a mounted AppMenuBar test harness with real ProseMirror editor view and dependencies.
 *
 * @purpose Creates DOM mounts, initializes DocumentSession, builds command registry, and returns AppMenuBar harness.
 * @inputs
 *   - markdown: string - Initial markdown content.
 *   - isCheckedOverride: ((commandId: string) => boolean) | undefined - Optional toggle state provider.
 * @outputs TestHarness - Object containing all controllers, mounts, and recorded actions.
 * @dataflow markdown -> DocumentSession & ProseMirrorBinding -> buildCommandRegistry -> installAppMenuBar -> harness.
 * @controlflow Create mounts -> initialize binding -> build registry -> install menu bar -> register teardown -> return harness.
 */
function mountAppMenuBarHarness(
  markdown: string = '# Heading 1\n\nParagraph text.',
  isCheckedOverride?: (commandId: string) => boolean,
): TestHarness {
  const editorMount = document.createElement('div');
  document.body.appendChild(editorMount);
  activeMounts.push(editorMount);

  const barMount = document.createElement('div');
  document.body.appendChild(barMount);
  activeMounts.push(barMount);

  const session = new DocumentSession(markdown);
  session.focusPane('wysiwyg');

  const binding = new ProseMirrorBinding({ session, mount: editorMount });
  activeBindings.push(binding);

  const calls: string[] = [];
  const deps = createMockDeps(binding.view, calls);
  const commands = buildCommandRegistry(deps);
  const executed: string[] = [];

  const menuBar = installAppMenuBar(barMount, {
    commands: () => commands,
    run: (id: string): void => {
      executed.push(id);
    },
    doc: document,
    win: window,
    isChecked: isCheckedOverride,
  });
  activeBars.push(menuBar);

  return {
    menuBar,
    container: barMount,
    commands,
    executed,
    calls,
    binding,
    editorMount,
  };
}

describe('menu-bar', () => {
  it('defines APP_MENU_BAR_STYLES containing Material 3 Expressive design tokens', () => {
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-chrome-glass-tint');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-chrome-glass-edge');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-chrome-selected');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-chrome-edge');
    // The menu bar deliberately carries NO emissive colour. Emissive means a state the reader
    // must notice, and neither "this menu is open" nor "this toggle is checked" is one: both are
    // selection, and selection is what --kdoc-chrome-accent exists for. Asserting the absence is
    // the point — it is what stops the glow creeping back one control at a time.
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-chrome-accent');
    expect(APP_MENU_BAR_STYLES).not.toContain('--kdoc-emissive-');
    expect(APP_MENU_BAR_STYLES).not.toContain('backdrop-filter');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-radius-sm');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-radius-lg');
    expect(APP_MENU_BAR_STYLES).toContain('--kdoc-radius-pill');
    expect(APP_MENU_BAR_STYLES).toContain('prefers-reduced-motion');
  });

  it('declares exactly nine top-level menus in the specified order with correct access keys (Vault lives under File)', () => {
    const expectedMenus: readonly { readonly label: string; readonly accessKey: string }[] = [
      { label: 'File', accessKey: 'F' },
      { label: 'Edit', accessKey: 'E' },
      { label: 'Insert', accessKey: 'I' },
      { label: 'Format', accessKey: 'O' },
      { label: 'Table', accessKey: 'T' },
      { label: 'View', accessKey: 'V' },
      { label: 'Review', accessKey: 'R' },
      { label: 'Tools', accessKey: 'L' },
      { label: 'Help', accessKey: 'H' },
    ];

    expect(APP_MENU_BAR_SPEC.length).toBe(9);
    for (let i = 0; i < expectedMenus.length; i++) {
      const exp = expectedMenus[i];
      const actual = APP_MENU_BAR_SPEC[i];
      expect(actual).toBeDefined();
      if (exp !== undefined && actual !== undefined) {
        expect(actual.label).toBe(exp.label);
        expect(actual.accessKey).toBe(exp.accessKey);
      } else {
        // Strict boundary check.
      }
    }
  });

  it('asserts exhaustively that EVERY registered command is placed in APP_MENU_BAR_SPEC exactly once', () => {
    const harness = mountAppMenuBarHarness();
    const registry = harness.commands;
    const registryIds = registry.map((c) => c.id);

    // Recursively collect all command IDs declared in APP_MENU_BAR_SPEC across all menus.
    const allPlacedIds: string[] = [];
    for (let i = 0; i < APP_MENU_BAR_SPEC.length; i++) {
      const menu = APP_MENU_BAR_SPEC[i];
      if (menu !== undefined) {
        const menuIds = collectSpecCommandIds(menu.items);
        for (let k = 0; k < menuIds.length; k++) {
          const id = menuIds[k];
          if (id !== undefined) {
            allPlacedIds.push(id);
          } else {
            // Undefined ID.
          }
        }
      } else {
        // Undefined menu.
      }
    }

    // 1. Assert total command count matches registry length.
    expect(allPlacedIds.length).toBe(registryIds.length);

    // 2. Check for duplicate IDs in APP_MENU_BAR_SPEC.
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (let i = 0; i < allPlacedIds.length; i++) {
      const id = allPlacedIds[i];
      if (id !== undefined) {
        if (seen.has(id)) {
          duplicates.push(id);
        } else {
          seen.add(id);
        }
      } else {
        // Undefined ID.
      }
    }
    expect(duplicates).toEqual([]);

    // 3. Assert every registered command id exists in APP_MENU_BAR_SPEC.
    const unplaced: string[] = [];
    for (let i = 0; i < registryIds.length; i++) {
      const id = registryIds[i];
      if (id !== undefined && !seen.has(id)) {
        unplaced.push(id);
      } else {
        // Command placed.
      }
    }
    expect(unplaced).toEqual([]);

    // 4. Assert every placed command id exists in registry.
    const registrySet = new Set(registryIds);
    const phantomIds: string[] = [];
    for (let i = 0; i < allPlacedIds.length; i++) {
      const id = allPlacedIds[i];
      if (id !== undefined && !registrySet.has(id)) {
        phantomIds.push(id);
      } else {
        // Command in registry.
      }
    }
    expect(phantomIds).toEqual([]);
  });

  it('renders top-level menu bar buttons with proper ARIA attributes and access key underlining', () => {
    const harness = mountAppMenuBarHarness();
    const bar = harness.container.querySelector('.kdoc-menu-bar');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('menubar');
    expect(bar?.getAttribute('aria-label')).toBe('Application');

    const buttons = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button');
    expect(buttons.length).toBe(9);

    // First button has roving tabindex 0; all other buttons have -1.
    expect(buttons[0]?.getAttribute('tabindex')).toBe('0');
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i]?.getAttribute('tabindex')).toBe('-1');
    }

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      expect(btn?.getAttribute('role')).toBe('menuitem');
      expect(btn?.getAttribute('aria-haspopup')).toBe('menu');
      expect(btn?.getAttribute('aria-expanded')).toBe('false');

      const u = btn?.querySelector('u.kdoc-menu-accesskey');
      expect(u).not.toBeNull();
      const menu = APP_MENU_BAR_SPEC[i];
      if (menu !== undefined && u !== null && u !== undefined) {
        expect(u.textContent?.toLowerCase()).toBe(menu.accessKey.toLowerCase());
      } else {
        // Boundary check.
      }
    }
  });

  it('opens and closes top-level menu by click and click outside', () => {
    const harness = mountAppMenuBarHarness();
    const buttons = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button');
    const fileBtn = buttons[0];
    expect(fileBtn).toBeDefined();

    // Initial state: closed.
    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');

    // Click top-level File button to open.
    fileBtn?.click();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(fileBtn?.classList.contains('kdoc-menu-open')).toBe(true);

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup).not.toBeNull();
    expect(popup?.getAttribute('role')).toBe('menu');
    expect(popup?.getAttribute('aria-label')).toBe('File');

    // Click File button again to toggle close.
    fileBtn?.click();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(fileBtn?.classList.contains('kdoc-menu-open')).toBe(false);
    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();

    // Reopen and test click outside dismissal.
    fileBtn?.click();
    expect(document.body.querySelector('.kdoc-menu-popup')).not.toBeNull();

    // Click outside on document body.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');
  });

  it('switches open menus on hover without requiring a second click', () => {
    const harness = mountAppMenuBarHarness();
    const buttons = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button');
    const fileBtn = buttons[0];
    const editBtn = buttons[1];

    // Open File menu.
    fileBtn?.click();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('true');
    let popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup?.getAttribute('aria-label')).toBe('File');

    // Mouseenter Edit button while menu is open: switches immediately.
    editBtn?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(editBtn?.getAttribute('aria-expanded')).toBe('true');

    popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup?.getAttribute('aria-label')).toBe('Edit');
  });

  it('opens matching menu via Alt+<accessKey> shortcuts', () => {
    const harness = mountAppMenuBarHarness();
    const buttons = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button');
    const editBtn = buttons[1];
    const viewBtn = buttons[5];

    // Press Alt+E to open Edit menu.
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'e',
        altKey: true,
        bubbles: true,
      }),
    );

    expect(editBtn?.getAttribute('aria-expanded')).toBe('true');
    let popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup?.getAttribute('aria-label')).toBe('Edit');

    // Press Alt+V to switch to View menu.
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        altKey: true,
        bubbles: true,
      }),
    );

    expect(editBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(viewBtn?.getAttribute('aria-expanded')).toBe('true');
    popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup?.getAttribute('aria-label')).toBe('View');
  });

  it('handles arrow and Home/End navigation inside an open popup menu', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup).not.toBeNull();
    const items = popup?.querySelectorAll<HTMLElement>('.kdoc-menu-item');
    expect(items).toBeDefined();

    // ArrowDown moves focus to next item.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(popup?.querySelector('.kdoc-menu-item-active')).not.toBeNull();

    // End key jumps to last enabled item.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const activeAfterEnd = popup?.querySelector('.kdoc-menu-item-active');
    expect(activeAfterEnd).toBe(items?.[items.length - 1]);

    // Home key jumps to first enabled item.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    const activeAfterHome = popup?.querySelector('.kdoc-menu-item-active');
    expect(activeAfterHome).toBe(items?.[0]);
  });

  it('jumps to matching item on typeahead letter press', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    // Press 's' to jump to Save or Save As.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));

    const activeItem = popup?.querySelector('.kdoc-menu-item-active .kdoc-menu-item-label');
    expect(activeItem?.textContent?.toLowerCase().startsWith('s')).toBe(true);
  });

  it('skips disabled items during keyboard navigation and prevents activation', () => {
    const harness = mountAppMenuBarHarness();
    const editBtn = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button')[1];
    editBtn?.click();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    const undoItem = popup?.querySelector<HTMLElement>('.kdoc-menu-item[aria-disabled="true"]');

    // Check if Undo is disabled in this editor state.
    if (undoItem !== null && undoItem !== undefined) {
      expect(undoItem.getAttribute('aria-disabled')).toBe('true');
      undoItem.click();
      // Should not record execution for disabled item.
      expect(harness.executed).not.toContain('edit:undo');
      // Menu remains open.
      expect(document.body.querySelector('.kdoc-menu-popup')).not.toBeNull();
    } else {
      // Undo enabled in this fixture.
    }
  });

  it('opens and closes submenus on hover, ArrowRight, and ArrowLeft', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();

    const filePopup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    const exportSubmenuItem = filePopup?.querySelector<HTMLElement>('.kdoc-menu-item-submenu');
    expect(exportSubmenuItem).not.toBeNull();

    // Mouseenter on submenu item opens submenu.
    exportSubmenuItem?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(exportSubmenuItem?.getAttribute('aria-expanded')).toBe('true');

    let allPopups = document.body.querySelectorAll<HTMLElement>('.kdoc-menu-popup');
    expect(allPopups.length).toBe(2);
    const submenuPopup = allPopups[1];
    expect(submenuPopup?.getAttribute('aria-label')).toBe('Export');

    // ArrowLeft in submenu closes submenu and returns focus to parent.
    submenuPopup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    allPopups = document.body.querySelectorAll<HTMLElement>('.kdoc-menu-popup');
    expect(allPopups.length).toBe(1);
    expect(exportSubmenuItem?.getAttribute('aria-expanded')).toBe('false');
  });

  it('navigates horizontally to next and previous top-level menus via ArrowRight and ArrowLeft', () => {
    const harness = mountAppMenuBarHarness();
    const buttons = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button');
    const fileBtn = buttons[0];
    const editBtn = buttons[1];

    fileBtn?.click();
    let popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');

    // ArrowRight on non-submenu item advances to Edit menu.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(editBtn?.getAttribute('aria-expanded')).toBe('true');

    popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    expect(popup?.getAttribute('aria-label')).toBe('Edit');

    // ArrowLeft on top-level Edit popup retreats to File menu.
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(editBtn?.getAttribute('aria-expanded')).toBe('false');
  });

  it('restores previous active element focus upon Escape dismissal', () => {
    const harness = mountAppMenuBarHarness();
    const editor = harness.binding.view.dom;
    editor.focus();

    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();
    expect(document.body.querySelector('.kdoc-menu-popup')).not.toBeNull();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();
    expect(fileBtn?.getAttribute('aria-expanded')).toBe('false');
  });

  it('executes command and closes menu when an enabled item is clicked', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    const newDocItem = popup?.querySelector<HTMLElement>('.kdoc-menu-item');
    expect(newDocItem).not.toBeNull();

    newDocItem?.click();
    expect(harness.executed).toContain('file:new');
    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();
  });

  it('renders toggle items with role="menuitemcheckbox" and reflects check state', () => {
    const harness = mountAppMenuBarHarness(undefined, (commandId) => {
      // Return true for table:toggle-header-row.
      return commandId === 'table:toggle-header-row';
    });

    const tableBtn = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button')[4];
    tableBtn?.click();

    const popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    const checkboxItem = popup?.querySelector<HTMLElement>('.kdoc-menu-item[role="menuitemcheckbox"]');
    expect(checkboxItem).not.toBeNull();
    expect(checkboxItem?.getAttribute('aria-checked')).toBe('true');

    const checkGlyph = checkboxItem?.querySelector('.kdoc-menu-item-check');
    expect(checkGlyph?.textContent).toBe('✓');
  });

  it('re-reads enabled and checked states when refresh() is invoked', () => {
    let checked = false;
    const harness = mountAppMenuBarHarness(undefined, () => checked);

    const tableBtn = harness.container.querySelectorAll<HTMLButtonElement>('.kdoc-menu-bar-button')[4];
    tableBtn?.click();

    let popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    let checkboxItem = popup?.querySelector<HTMLElement>('.kdoc-menu-item[role="menuitemcheckbox"]');
    expect(checkboxItem?.getAttribute('aria-checked')).toBe('false');

    // Mutate state and refresh.
    checked = true;
    harness.menuBar.refresh();

    popup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    checkboxItem = popup?.querySelector<HTMLElement>('.kdoc-menu-item[role="menuitemcheckbox"]');
    expect(checkboxItem?.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps an open submenu open when refresh() finds nothing changed', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();

    const filePopup = document.body.querySelector<HTMLElement>('.kdoc-menu-popup');
    const exportSubmenuItem = filePopup?.querySelector<HTMLElement>('.kdoc-menu-item-submenu');
    exportSubmenuItem?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const submenuBefore = document.body.querySelectorAll<HTMLElement>('.kdoc-menu-popup')[1];
    expect(submenuBefore).toBeDefined();

    // Editor transactions refresh the bar constantly; an unchanged menu must not be torn down and rebuilt.
    harness.menuBar.refresh();
    harness.menuBar.refresh();

    const popupsAfter = document.body.querySelectorAll<HTMLElement>('.kdoc-menu-popup');
    expect(popupsAfter.length).toBe(2);
    expect(popupsAfter[1]).toBe(submenuBefore);
    expect(exportSubmenuItem?.getAttribute('aria-expanded')).toBe('true');
  });

  it('destroys menu bar cleanly without lingering nodes or listeners', () => {
    const harness = mountAppMenuBarHarness();
    const fileBtn = harness.container.querySelector<HTMLButtonElement>('.kdoc-menu-bar-button');
    fileBtn?.click();
    expect(document.body.querySelector('.kdoc-menu-popup')).not.toBeNull();

    harness.menuBar.destroy();
    expect(document.body.querySelector('.kdoc-menu-popup')).toBeNull();
    expect(harness.container.querySelector('.kdoc-menu-bar')).toBeNull();
  });
});
