// @vitest-environment jsdom

/**
 * @file context-menu.spec.ts
 * @purpose Vitest test suite for K-Doc's anchored popup menu and K-Doc right-click context menu (@k-doc/app, FR-14.2).
 *   Validates caret context inspection (describeTarget), contextual menu entries construction (buildEntries),
 *   pane contextmenu event interception and default prevention (installContextMenu), and PopupMenu DOM rendering,
 *   filtering, ARIA attributes, and lifecycle teardown under jsdom.
 * @inputs Markdown test fixtures, ProseMirrorBinding instances, synthetic MouseEvents (contextmenu), and PopupMenuEntry arrays.
 * @outputs Vitest assertions verifying context descriptors, menu entries, event prevention, ARIA disabled/activedescendant attributes, and idempotent cleanup.
 * @functions
 *   - mountBinding: Allocates a mount DOM container, initializes a DocumentSession, focuses the kdoc pane, and constructs a ProseMirrorBinding.
 *   - selectAll: Sets a TextSelection spanning the entire document content so hasSelection evaluates to true.
 *   - labels: Extracts user-visible display labels from an array of popup menu entries, skipping separators.
 *   - menuOptionsFor: Constructs a ContextMenuOptions configuration object with recorded action spy callbacks and binding pane reference.
 *   - mountMenu: Installs a PopupMenu instance attached to document.body, recorded for lifecycle teardown.
 *   - mountContextMenu: Installs a ContextMenu instance attached to the editor pane, recorded for lifecycle teardown.
 * @dataflow Markdown string -> DocumentSession & ProseMirrorBinding -> describeTarget / buildEntries / installContextMenu / installPopupMenu -> DOM events & state queries -> Vitest assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across describeTarget, buildEntries, installContextMenu, and PopupMenu -> clean up active menus, bindings, and mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, afterEach } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '@k-doc/editor';
import { installPopupMenu, type PopupMenu, type PopupMenuEntry, type PopupMenuItem } from '../src/shell/popup-menu.js';
import {
  describeTarget,
  buildEntries,
  installContextMenu,
  type ContextMenu,
  type ContextMenuOptions,
} from '../src/shell/context-menu.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];
let activeMenus: PopupMenu[] = [];
let activeContextMenus: ContextMenu[] = [];
const bindingMounts = new WeakMap<ProseMirrorBinding, HTMLElement>();

afterEach(() => {
  for (let i = 0; i < activeContextMenus.length; i++) {
    const contextMenu = activeContextMenus[i];
    // Check if context menu controller is defined under strict indexing.
    if (contextMenu !== undefined) {
      // Destroy active context menu controller.
      contextMenu.destroy();
    } else {
      // Undefined context menu controller.
    }
  }
  activeContextMenus = [];

  for (let i = 0; i < activeMenus.length; i++) {
    const menu = activeMenus[i];
    // Check if popup menu controller is defined under strict indexing.
    if (menu !== undefined) {
      // Destroy active popup menu controller.
      menu.destroy();
    } else {
      // Undefined popup menu controller.
    }
  }
  activeMenus = [];

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

  // Detach any lingering popup menu elements attached to document.body.
  const lingeringMenus = document.body.querySelectorAll('.kdoc-popup-menu');
  for (let i = 0; i < lingeringMenus.length; i++) {
    const menuEl = lingeringMenus[i];
    // Check if popup menu element is defined and attached to parent DOM node.
    if (menuEl !== undefined && menuEl.parentNode !== null) {
      // Detach popup menu element from document body.
      menuEl.parentNode.removeChild(menuEl);
    } else {
      // Popup menu already detached or undefined.
    }
  }
});

/**
 * Instantiates a DocumentSession, focuses the kdoc pane, and mounts a ProseMirrorBinding.
 *
 * @purpose Allocates a DOM mount container, initializes the session and editor binding, and records them for teardown.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @outputs ProseMirrorBinding - The configured editor binding attached to the mounted element.
 * @dataflow markdown -> DocumentSession -> focusPane -> ProseMirrorBinding -> active arrays -> return binding.
 * @controlflow Create mount div -> append to body -> initialize session and focus kdoc pane -> create ProseMirrorBinding -> record references for teardown -> return binding.
 */
function mountBinding(markdown: string): ProseMirrorBinding {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const session = new DocumentSession(markdown);
  session.focusPane('kdoc');

  const binding = new ProseMirrorBinding({ session, mount });
  activeBindings.push(binding);
  bindingMounts.set(binding, mount);

  return binding;
}

/**
 * Dispatches a transaction selecting the entire content of the document.
 *
 * @purpose Sets a TextSelection spanning from position 1 to doc.content.size - 1 so hasSelection evaluates to true.
 * @inputs binding - The ProseMirrorBinding instance whose view selection should be expanded.
 * @outputs void.
 * @dataflow binding.view.state.doc -> compute selection range -> TextSelection.create -> dispatch transaction.
 * @controlflow Resolve doc -> compute end position clamped at content.size - 1 -> construct TextSelection -> dispatch transaction to view.
 */
function selectAll(binding: ProseMirrorBinding): void {
  const doc = binding.view.state.doc;
  const to = Math.max(1, doc.content.size - 1);
  const selection = TextSelection.create(doc, 1, to);
  binding.view.dispatch(binding.view.state.tr.setSelection(selection));
}

/**
 * Extracts the user-visible display labels from an array of popup menu entries, skipping visual separators.
 *
 * @purpose Maps a list of PopupMenuEntry items to their string labels, filtering out separator objects using discriminant narrowing.
 * @inputs entries - Readonly array of PopupMenuEntry items and separators.
 * @outputs string[] - Array of matching menu item string labels.
 * @dataflow entries -> iterate and check 'separator' discriminant -> accumulate label strings -> return string array.
 * @controlflow Iterate entries -> check if undefined -> check if 'separator' in entry -> if item, push label to array -> return array.
 */
function labels(entries: readonly PopupMenuEntry[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Check if entry is defined under strict indexing.
    if (entry === undefined) {
      // Undefined entry: skip iteration.
      continue;
    } else {
      // Entry is defined: inspect discriminant.
    }

    // Check if entry is a visual separator divider.
    if ('separator' in entry) {
      // Separator entry: omit from labels collection.
    } else {
      // Menu item entry: record user-visible label.
      result.push(entry.label);
    }
  }
  return result;
}

/**
 * Constructs a ContextMenuOptions configuration object wired to the given binding and popup menu.
 *
 * @purpose Provides a valid ContextMenuOptions object with spy recorders for link operations and resolves the binding's mount pane.
 * @inputs
 *   - binding - The active ProseMirrorBinding instance.
 *   - menu - The active PopupMenu controller instance.
 *   - calls - Array used to record invocations of openLink and followLink callbacks.
 * @outputs ContextMenuOptions - Configured context menu options object.
 * @dataflow binding & menu & calls -> ContextMenuOptions object.
 * @controlflow Resolve mount pane from recorded map or fallback -> construct options object with recording link handlers -> return options.
 */
function menuOptionsFor(
  binding: ProseMirrorBinding,
  menu: PopupMenu,
  calls: string[],
): ContextMenuOptions {
  const mount = bindingMounts.get(binding);
  let pane: HTMLElement;
  // Check if the recorded mount element exists for this binding.
  if (mount !== undefined) {
    pane = mount;
  } else if (binding.view.dom.parentElement instanceof HTMLElement) {
    // Fall back to editor view container's parent element.
    pane = binding.view.dom.parentElement;
  } else {
    // Fail fast if mount pane cannot be located.
    throw new Error('Mount pane not found for binding');
  }

  return {
    menu,
    view: binding.view,
    pane,
    doc: document,
    openLink: (): void => {
      calls.push('openLink');
    },
    followLink: (href: string): void => {
      calls.push(`followLink:${href}`);
    },
    editImage: (): void => {
      calls.push('editImage');
    },
  };
}

/**
 * Instantiates and installs a PopupMenu controller attached to document.body, recording it for teardown.
 *
 * @purpose Allocates and returns a PopupMenu controller tracked in activeMenus for afterEach lifecycle cleanup.
 * @inputs void.
 * @outputs PopupMenu - The installed popup menu controller.
 * @dataflow installPopupMenu({ doc: document, win: window }) -> record in activeMenus -> return controller.
 * @controlflow Call installPopupMenu -> push to activeMenus array -> return controller.
 */
function mountMenu(): PopupMenu {
  const menu = installPopupMenu({ doc: document, win: window });
  activeMenus.push(menu);
  return menu;
}

/**
 * Installs a ContextMenu controller on the editor pane, recording it for teardown.
 *
 * @purpose Installs a ContextMenu instance and tracks it in activeContextMenus for afterEach lifecycle cleanup.
 * @inputs options - ContextMenuOptions configuration object.
 * @outputs ContextMenu - The installed context menu controller.
 * @dataflow installContextMenu(options) -> record in activeContextMenus -> return controller.
 * @controlflow Call installContextMenu -> push to activeContextMenus array -> return controller.
 */
function mountContextMenu(options: ContextMenuOptions): ContextMenu {
  const contextMenu = installContextMenu(options);
  activeContextMenus.push(contextMenu);
  return contextMenu;
}

describe('describeTarget', () => {
  it('reports all four flags false for a plain paragraph with no selection', () => {
    const binding = mountBinding('Plain paragraph text.\n');
    const target = describeTarget(binding.view);

    expect(target.inTable).toBe(false);
    expect(target.onLink).toBe(false);
    expect(target.inCodeBlock).toBe(false);
    expect(target.hasSelection).toBe(false);
  });

  it('reports hasSelection true after selectAll', () => {
    const binding = mountBinding('Plain paragraph text.\n');
    selectAll(binding);
    const target = describeTarget(binding.view);

    expect(target.hasSelection).toBe(true);
    expect(target.inTable).toBe(false);
    expect(target.onLink).toBe(false);
    expect(target.inCodeBlock).toBe(false);
  });

  it('reports inCodeBlock true with the caret inside a fenced code block', () => {
    const binding = mountBinding('```\nconst x = 1;\n```\n');
    // Position collapsed caret inside the fenced code block content.
    const sel = TextSelection.create(binding.view.state.doc, 1, 1);
    binding.view.dispatch(binding.view.state.tr.setSelection(sel));

    const target = describeTarget(binding.view);
    expect(target.inCodeBlock).toBe(true);
    expect(target.hasSelection).toBe(false);
    expect(target.inTable).toBe(false);
    expect(target.onLink).toBe(false);
  });

  it('reports inTable true with the caret inside a GFM table', () => {
    const TABLE_MD = [
      '| Head A | Head B |',
      '| ------ | ------ |',
      '| Cell 1 | Cell 2 |',
      '',
    ].join('\n');
    const binding = mountBinding(TABLE_MD);

    let cellPos: number | undefined;
    binding.view.state.doc.descendants((node, pos) => {
      // Check if node is a text node containing table cell text.
      if (cellPos === undefined && node.isText && node.text !== undefined && node.text.includes('Cell 1')) {
        cellPos = pos + 1;
      } else {
        // Other node or position already resolved.
      }
    });

    // Check if table cell position was located.
    if (cellPos === undefined) {
      throw new Error('Table cell position not found in document');
    } else {
      // Position found: set collapsed caret inside table cell.
    }

    const sel = TextSelection.create(binding.view.state.doc, cellPos, cellPos);
    binding.view.dispatch(binding.view.state.tr.setSelection(sel));

    const target = describeTarget(binding.view);
    expect(target.inTable).toBe(true);
    expect(target.inCodeBlock).toBe(false);
    expect(target.onLink).toBe(false);
    expect(target.hasSelection).toBe(false);
  });
});

describe('buildEntries', () => {
  it('always includes Cut, Copy and Paste, with Cut and Copy disabled when there is no selection', () => {
    const binding = mountBinding('Plain paragraph text.\n');
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const target = describeTarget(binding.view);
    const entries = buildEntries(binding.view, target, options);

    const entryLabels = labels(entries);
    expect(entryLabels).toContain('Cut');
    expect(entryLabels).toContain('Copy');
    expect(entryLabels).toContain('Paste');

    const cutItem = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.label === 'Cut');
    const copyItem = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.label === 'Copy');
    const pasteItem = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.label === 'Paste');

    // Check if Cut, Copy, and Paste items exist in the entries.
    if (cutItem === undefined || copyItem === undefined || pasteItem === undefined) {
      throw new Error('Expected Cut, Copy, and Paste items to be present');
    } else {
      // Items present: verify enabled states.
    }

    // A disabled item says the action exists but cannot run here, which is different from omitting it.
    expect(cutItem.enabled).toBe(false);
    expect(copyItem.enabled).toBe(false);
    expect(pasteItem.enabled).toBe(true);
  });

  it('omits the formatting group entirely when there is no selection', () => {
    const binding = mountBinding('Plain paragraph text.\n');
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const target = describeTarget(binding.view);
    const entries = buildEntries(binding.view, target, options);

    // Formatting with no selection acts on a zero-width range and looks like nothing happening,
    // so the group is omitted rather than shown greyed out.
    const entryLabels = labels(entries);
    expect(entryLabels).not.toContain('Bold');
    expect(entryLabels).not.toContain('Italic');
    expect(entryLabels).not.toContain('Inline Code');
    expect(entryLabels).not.toContain('Clear Formatting');
  });

  it('includes Bold, Italic, Inline Code, and Clear Formatting when a paragraph has a selection', () => {
    const binding = mountBinding('Paragraph with selectable text.\n');
    selectAll(binding);
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const target = describeTarget(binding.view);
    const entries = buildEntries(binding.view, target, options);

    const entryLabels = labels(entries);
    expect(entryLabels).toContain('Bold');
    expect(entryLabels).toContain('Italic');
    expect(entryLabels).toContain('Inline Code');
    expect(entryLabels).toContain('Clear Formatting');

    const cutItem = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.label === 'Cut');
    const copyItem = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.label === 'Copy');
    // Check if Cut and Copy items exist in entries under selection.
    if (cutItem === undefined || copyItem === undefined) {
      throw new Error('Expected Cut and Copy items to be present');
    } else {
      // Items present.
    }
    expect(cutItem.enabled).toBe(true);
    expect(copyItem.enabled).toBe(true);
  });

  it('omits the formatting group inside a code block even when text is selected', () => {
    const binding = mountBinding('```\nconst x = 42;\n```\n');
    selectAll(binding);
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const target = describeTarget(binding.view);
    const entries = buildEntries(binding.view, target, options);

    // Inline marks are not expressible in a code block, so the group would be four greyed-out lines telling the user nothing.
    const entryLabels = labels(entries);
    expect(entryLabels).not.toContain('Bold');
    expect(entryLabels).not.toContain('Italic');
    expect(entryLabels).not.toContain('Inline Code');
    expect(entryLabels).not.toContain('Clear Formatting');
  });

  it('omits table entries outside a table and includes them when caret is inside a table', () => {
    // 1. Outside a table
    const outsideBinding = mountBinding('Plain paragraph outside table.\n');
    const outsideMenu = mountMenu();
    const outsideCalls: string[] = [];
    const outsideOptions = menuOptionsFor(outsideBinding, outsideMenu, outsideCalls);
    const outsideTarget = describeTarget(outsideBinding.view);
    const outsideEntries = buildEntries(outsideBinding.view, outsideTarget, outsideOptions);

    const outsideLabels = labels(outsideEntries);
    expect(outsideLabels).not.toContain('Delete Table');
    expect(outsideLabels).not.toContain('Insert Row Below');

    // 2. Inside a table
    const TABLE_MD = [
      '| Head A | Head B |',
      '| ------ | ------ |',
      '| Cell 1 | Cell 2 |',
      '',
    ].join('\n');
    const tableBinding = mountBinding(TABLE_MD);
    let cellPos: number | undefined;
    tableBinding.view.state.doc.descendants((node, pos) => {
      // Check if node is a text node containing table cell text.
      if (cellPos === undefined && node.isText && node.text !== undefined && node.text.includes('Cell 1')) {
        cellPos = pos + 1;
      } else {
        // Other node or position already resolved.
      }
    });
    // Check if table cell position was located.
    if (cellPos === undefined) {
      throw new Error('Table cell position not found in document');
    } else {
      // Position found: set collapsed caret inside table cell.
    }
    const sel = TextSelection.create(tableBinding.view.state.doc, cellPos, cellPos);
    tableBinding.view.dispatch(tableBinding.view.state.tr.setSelection(sel));

    const tableMenu = mountMenu();
    const tableCalls: string[] = [];
    const tableOptions = menuOptionsFor(tableBinding, tableMenu, tableCalls);
    const tableTarget = describeTarget(tableBinding.view);
    const tableEntries = buildEntries(tableBinding.view, tableTarget, tableOptions);

    const tableLabels = labels(tableEntries);
    expect(tableLabels).toContain('Insert Row Below');
    expect(tableLabels).toContain('Delete Row');
    expect(tableLabels).toContain('Insert Column Right');
    expect(tableLabels).toContain('Delete Column');
    expect(tableLabels).toContain('Delete Table');
  });

  // A selected image gets its own group; other content does not.
  it('offers image entries only for a selected image', () => {
    const binding = mountBinding('Before ![Logo|120](https://x.example/l.png) after.\n');
    const menu = mountMenu();
    const options = menuOptionsFor(binding, menu, []);
    expect(labels(buildEntries(binding.view, describeTarget(binding.view), options))).not.toContain('Edit Image…');
    const view = binding.view;
    const holder: { pos: number | null } = { pos: null };
    view.state.doc.descendants((node, pos) => {
      if (holder.pos === null && node.type.name === 'image') {
        holder.pos = pos;
      } else {
        // Not the image; keep looking.
      }
      return holder.pos === null;
    });
    if (holder.pos === null) {
      throw new Error('no image');
    } else {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, holder.pos)));
      const entries = labels(buildEntries(view, describeTarget(view), options));
      expect(entries).toContain('Edit Image…');
      expect(entries).toContain('Reset Image Size');
    }
  });

  // A right-click on a picture selects it before the menu is built.
  it('selects the right-clicked image', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    activeMounts.push(mount);
    const session = new DocumentSession('Before ![Logo](https://x.example/l.png) after.\n');
    session.focusPane('kdoc');
    const binding = new ProseMirrorBinding({ session, mount, loadImage: () => Promise.resolve(null) });
    activeBindings.push(binding);
    bindingMounts.set(binding, mount);
    const menu = mountMenu();
    const options = menuOptionsFor(binding, menu, []);
    mountContextMenu(options);
    const picture = binding.view.dom.querySelector('img');
    picture?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(binding.view.state.selection instanceof NodeSelection).toBe(true);
  });

  it('shows Add Link… when a link could be made and omits Open Link', () => {
    const binding = mountBinding('Paragraph with selectable text.\n');
    selectAll(binding);
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const target = describeTarget(binding.view);
    const entries = buildEntries(binding.view, target, options);

    const entryLabels = labels(entries);
    expect(entryLabels).toContain('Add Link…');
    expect(entryLabels).not.toContain('Open Link');
  });

  it('contains no separators when only the clipboard group is present, and at least one separator when multiple groups are present', () => {
    // 1. Plain paragraph with no selection: only clipboard group applies.
    const collapsedBinding = mountBinding('Plain paragraph with no selection.\n');
    const collapsedMenu = mountMenu();
    const collapsedCalls: string[] = [];
    const collapsedOptions = menuOptionsFor(collapsedBinding, collapsedMenu, collapsedCalls);
    const collapsedTarget = describeTarget(collapsedBinding.view);
    const collapsedEntries = buildEntries(collapsedBinding.view, collapsedTarget, collapsedOptions);

    const collapsedSeparators = collapsedEntries.filter((e) => 'separator' in e);
    // In this schema, canLink returns false when the selection is collapsed and not on an active link,
    // so no link group is created. With no selection, formatting is also omitted, leaving only the clipboard group.
    // When only the clipboard group is present, no separators are rendered.
    expect(collapsedSeparators.length).toBe(0);

    // 2. Document with active selection: clipboard, formatting, and link groups apply.
    const selectedBinding = mountBinding('Selectable text for multiple groups.\n');
    selectAll(selectedBinding);
    const selectedMenu = mountMenu();
    const selectedCalls: string[] = [];
    const selectedOptions = menuOptionsFor(selectedBinding, selectedMenu, selectedCalls);
    const selectedTarget = describeTarget(selectedBinding.view);
    const selectedEntries = buildEntries(selectedBinding.view, selectedTarget, selectedOptions);

    const selectedSeparators = selectedEntries.filter((e) => 'separator' in e);
    // When multiple groups are present, group divider separators are inserted.
    expect(selectedSeparators.length).toBeGreaterThan(0);
  });
});

describe('installContextMenu', () => {
  it('opens menu and prevents default browser context menu when contextmenu event is dispatched on the pane', () => {
    const binding = mountBinding('Editable content in pane.\n');
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    mountContextMenu(options);

    expect(menu.isOpen).toBe(false);

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });

    options.pane.dispatchEvent(event);

    expect(menu.isOpen).toBe(true);
    // Preventing the default replaces the browser's own menu, which would otherwise offer Back, Reload and View Source.
    expect(event.defaultPrevented).toBe(true);
  });

  it('provides an idempotent destroy() method after which contextmenu events no longer open the menu', () => {
    const binding = mountBinding('Editable content in pane.\n');
    const menu = mountMenu();
    const calls: string[] = [];
    const options = menuOptionsFor(binding, menu, calls);
    const contextMenu = mountContextMenu(options);

    // Call destroy twice to test idempotency.
    expect(() => {
      contextMenu.destroy();
      contextMenu.destroy();
    }).not.toThrow();

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });

    options.pane.dispatchEvent(event);

    // After destruction, event listener is aborted and menu remains closed.
    expect(menu.isOpen).toBe(false);
  });
});

describe('the popup menu', () => {
  it('renders one element per entry on openAt, updates isOpen state, and closes on close()', () => {
    const menu = mountMenu();
    const entries: PopupMenuEntry[] = [
      { id: '1', label: 'Item One', hint: 'Ctrl+1', enabled: true, run(): void {} },
      { separator: true },
      { id: '2', label: 'Item Two', hint: '', enabled: false, run(): void {} },
    ];

    expect(menu.isOpen).toBe(false);

    menu.openAt(20, 30, entries);
    expect(menu.isOpen).toBe(true);

    const menuEl = document.querySelector<HTMLElement>('.kdoc-popup-menu');
    // Check if popup menu element exists in the DOM.
    if (menuEl === null) {
      throw new Error('Popup menu element (.kdoc-popup-menu) not found in DOM');
    } else {
      // Menu element found: assert child count matches entries length.
    }
    expect(menuEl.children.length).toBe(entries.length);

    menu.close();
    expect(menu.isOpen).toBe(false);
    expect(menuEl.hidden).toBe(true);
  });

  it('narrows to matching labels and drops separators on setFilter("bold")', () => {
    const menu = mountMenu();
    const entries: PopupMenuEntry[] = [
      { id: 'bold', label: 'Bold', hint: 'Ctrl+B', enabled: true, run(): void {} },
      { separator: true },
      { id: 'italic', label: 'Italic', hint: 'Ctrl+I', enabled: true, run(): void {} },
      { id: 'bold-variant', label: 'Semi-Bold Heading', hint: '', enabled: false, run(): void {} },
    ];

    menu.openAt(0, 0, entries);

    const menuEl = document.querySelector<HTMLElement>('.kdoc-popup-menu');
    // Check if popup menu element exists in the DOM.
    if (menuEl === null) {
      throw new Error('Popup menu element not found in DOM');
    } else {
      // Menu element found.
    }
    expect(menuEl.children.length).toBe(4);

    menu.setFilter('bold');

    // Separators group things, and a filtered list has no groups, so separators are dropped entirely while a filter is active.
    expect(menuEl.children.length).toBe(2);
    const separators = menuEl.querySelectorAll('.kdoc-popup-menu-separator');
    expect(separators.length).toBe(0);

    const items = menuEl.querySelectorAll('.kdoc-popup-menu-item');
    expect(items.length).toBe(2);
    const firstItem = items[0];
    const secondItem = items[1];
    // Check if filtered item elements are present under strict indexing.
    if (firstItem === undefined || secondItem === undefined) {
      throw new Error('Expected two filtered menu item elements');
    } else {
      // Elements present: assert matching label content.
    }
    expect(firstItem.textContent).toContain('Bold');
    expect(secondItem.textContent).toContain('Semi-Bold Heading');
  });

  it('restores every entry including separators when an empty filter is applied', () => {
    const menu = mountMenu();
    const entries: PopupMenuEntry[] = [
      { id: 'bold', label: 'Bold', hint: 'Ctrl+B', enabled: true, run(): void {} },
      { separator: true },
      { id: 'italic', label: 'Italic', hint: 'Ctrl+I', enabled: true, run(): void {} },
    ];

    menu.openAt(0, 0, entries);
    menu.setFilter('bold');

    const menuEl = document.querySelector<HTMLElement>('.kdoc-popup-menu');
    // Check if popup menu element exists in the DOM.
    if (menuEl === null) {
      throw new Error('Popup menu element not found in DOM');
    } else {
      // Menu element found.
    }
    expect(menuEl.children.length).toBe(1);

    menu.setFilter('');
    expect(menuEl.children.length).toBe(3);
    const separators = menuEl.querySelectorAll('.kdoc-popup-menu-separator');
    expect(separators.length).toBe(1);
  });

  it('renders aria-disabled="true" on disabled items and aria-disabled="false" on enabled items', () => {
    const menu = mountMenu();
    const entries: PopupMenuEntry[] = [
      { id: 'enabled', label: 'Active Action', hint: '', enabled: true, run(): void {} },
      { id: 'disabled', label: 'Inactive Action', hint: '', enabled: false, run(): void {} },
    ];

    menu.openAt(0, 0, entries);

    const items = document.querySelectorAll<HTMLElement>('.kdoc-popup-menu-item');
    expect(items.length).toBe(2);

    const enabledEl = items[0];
    const disabledEl = items[1];
    // Check if item elements exist under strict indexing.
    if (enabledEl === undefined || disabledEl === undefined) {
      throw new Error('Expected both enabled and disabled item elements');
    } else {
      // Elements exist: check aria-disabled attributes.
    }

    expect(enabledEl.getAttribute('aria-disabled')).toBe('false');
    expect(disabledEl.getAttribute('aria-disabled')).toBe('true');
  });

  it('handles destroy() idempotently without throwing', () => {
    const menu = mountMenu();
    menu.openAt(10, 10, [
      { id: 'test', label: 'Test Item', hint: '', enabled: true, run(): void {} },
    ]);

    expect(() => {
      menu.destroy();
      menu.destroy();
    }).not.toThrow();
  });
});
