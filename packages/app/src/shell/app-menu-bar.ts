/**
 * @file app-menu-bar.ts
 * @purpose Implements a Word-style horizontal application menu bar for K-Doc with Material 3 Expressive styling, full keyboard navigation, ARIA semantics, and complete command registry coverage.
 * @inputs AppMenuBarOptions providing live KdocCommand array from command registry and run(commandId) execution callback; mouse and keyboard events.
 * @outputs AppMenuBar controller handle (element, refresh, destroy), APP_MENU_BAR_SPEC declarative hierarchy, and APP_MENU_BAR_STYLES CSS stylesheet string.
 * @functions
 *   - installAppMenuBar: Instantiates and mounts the menubar, builds top-level menus and popups, binds roving tabindex, mouse hover-switching, Alt access keys, and returns AppMenuBar handle.
 *   - renderAccessKeyLabel: Constructs label DOM nodes with the designated access key character underlined.
 *   - positionPopup: Computes viewport-bounded coordinates for top-level popups and nested submenus to prevent window edge clipping.
 * @dataflow APP_MENU_BAR_SPEC + live commands() -> top-level buttons + popup menu DOM tree -> keyboard/mouse selection -> close popups -> options.run(commandId).
 * @controlflow Mount menubar -> bind roving tabindex and Alt access keys -> top-level click or hover-switch opens popup -> keyboard (arrows, Home/End, typeahead) navigates enabled items -> Enter/Space/click executes command via options.run() -> Escape or click outside closes menus.
 * @version 5
 * @date 2026-10-06
 */

import type { KdocCommand } from './command-registry.js';

export interface CommandAppMenuItemSpec {
  readonly kind: 'command';
  readonly commandId: string;
}

export interface SubmenuAppMenuItemSpec {
  readonly kind: 'submenu';
  readonly label: string;
  readonly items: readonly AppMenuItemSpec[];
}

export interface SeparatorAppMenuItemSpec {
  readonly kind: 'separator';
}

export interface ToggleAppMenuItemSpec {
  readonly kind: 'toggle';
  readonly commandId: string;
  readonly isChecked?: () => boolean;
}

export type AppMenuItemSpec =
  | CommandAppMenuItemSpec
  | SubmenuAppMenuItemSpec
  | SeparatorAppMenuItemSpec
  | ToggleAppMenuItemSpec;

export interface AppMenuSpec {
  readonly label: string;
  readonly accessKey: string;
  readonly items: readonly AppMenuItemSpec[];
}

export interface AppMenuBarOptions {
  /** Accessor returning the current catalogue of registered commands. */
  readonly commands: () => readonly KdocCommand[];
  /** Callback invoked when a command item is triggered by the user. */
  readonly run?: (commandId: string) => boolean | void;
  /** Optional Document context; defaults to mount.ownerDocument. */
  readonly doc?: Document;
  /** Optional Window context; defaults to doc.defaultView ?? window. */
  readonly win?: Window;
  /** Optional error reporting callback for shell compatibility. */
  readonly onError?: (message: string) => void;
  /** Optional predicate querying dynamic toggle checked state. */
  readonly isChecked?: (commandId: string) => boolean;
  /** Optional callback invoked when all menus close and editor focus should be restored. */
  readonly onRestoreFocus?: () => void;
}

export interface AppMenuBar {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * Authoritative declarative specification for the K-Doc application menu bar.
 * Contains exactly ten top-level menus in order: File, Edit, Insert, Format, Table, View, Review, Vault, Tools, Help.
 * Every command registered in command-registry.ts is placed in exactly one menu.
 */
export const APP_MENU_BAR_SPEC: readonly AppMenuSpec[] = [
  {
    label: 'File',
    accessKey: 'F',
    items: [
      { kind: 'command', commandId: 'file:new' },
      { kind: 'command', commandId: 'file:open' },
      { kind: 'command', commandId: 'file:quick-open' },
      { kind: 'command', commandId: 'file:open-recent' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'file:save' },
      { kind: 'command', commandId: 'file:save-as' },
      { kind: 'command', commandId: 'file:save-a-copy' },
      { kind: 'command', commandId: 'file:rename' },
      { kind: 'command', commandId: 'file:reveal' },
      { kind: 'command', commandId: 'file:take-snapshot' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Export',
        items: [
          { kind: 'command', commandId: 'file:export-html' },
          { kind: 'command', commandId: 'file:export-docx' },
          { kind: 'command', commandId: 'file:export-markdown' },
          { kind: 'command', commandId: 'file:export-latex' },
          { kind: 'command', commandId: 'file:export-epub' },
          { kind: 'command', commandId: 'file:export-plugin' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'file:export-theme' },
          { kind: 'command', commandId: 'file:export-theme-folder' },
        ],
      },
      { kind: 'command', commandId: 'file:import' },
      {
        kind: 'submenu',
        label: 'Vault',
        items: [
          { kind: 'command', commandId: 'vault:open' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'view:graph' },
          { kind: 'command', commandId: 'view:link-definitions' },
          { kind: 'command', commandId: 'insert:convert-reference-links' },
          { kind: 'command', commandId: 'file:unused-attachments' },
        ],
      },
      { kind: 'separator' },
      { kind: 'command', commandId: 'file:page-setup' },
      { kind: 'command', commandId: 'file:print' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'file:unlock' },
      { kind: 'command', commandId: 'file:next' },
      { kind: 'command', commandId: 'file:close' },
    ],
  },
  {
    label: 'Edit',
    accessKey: 'E',
    items: [
      { kind: 'command', commandId: 'edit:undo' },
      { kind: 'command', commandId: 'edit:redo' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'edit:copy-markdown' },
      { kind: 'command', commandId: 'edit:copy-html' },
      {
        kind: 'submenu',
        label: 'Paste Special',
        items: [
          { kind: 'command', commandId: 'edit:paste-special' },
          { kind: 'command', commandId: 'edit:paste-plain' },
        ],
      },
      { kind: 'command', commandId: 'edit:split-at-heading' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'find:open' },
      { kind: 'command', commandId: 'find:replace' },
      { kind: 'command', commandId: 'find:go-to' },
      { kind: 'command', commandId: 'find:in-vault' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'nav:back' },
      { kind: 'command', commandId: 'nav:forward' },
    ],
  },
  {
    label: 'Insert',
    accessKey: 'I',
    items: [
      { kind: 'command', commandId: 'insert:link' },
      { kind: 'command', commandId: 'insert:image' },
      {
        kind: 'submenu',
        label: 'Table',
        items: [
          { kind: 'command', commandId: 'insert:table' },
          { kind: 'command', commandId: 'insert:table-picker' },
        ],
      },
      { kind: 'command', commandId: 'insert:horizontal-rule' },
      { kind: 'command', commandId: 'insert:footnote' },
      { kind: 'command', commandId: 'format:code-block' },
      { kind: 'command', commandId: 'insert:code-language' },
      {
        kind: 'submenu',
        label: 'Callout',
        items: [
          { kind: 'command', commandId: 'format:callout-note' },
          { kind: 'command', commandId: 'format:callout-tip' },
          { kind: 'command', commandId: 'format:callout-important' },
          { kind: 'command', commandId: 'format:callout-warning' },
          { kind: 'command', commandId: 'format:callout-caution' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:clear-callout' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Table of Contents',
        items: [
          { kind: 'command', commandId: 'insert:table-of-contents' },
          { kind: 'command', commandId: 'insert:refresh-table-of-contents' },
        ],
      },
    ],
  },
  {
    label: 'Format',
    accessKey: 'O',
    items: [
      { kind: 'command', commandId: 'format:bold' },
      { kind: 'command', commandId: 'format:italic' },
      { kind: 'command', commandId: 'format:strikethrough' },
      { kind: 'command', commandId: 'format:highlight' },
      { kind: 'command', commandId: 'format:subscript' },
      { kind: 'command', commandId: 'format:superscript' },
      { kind: 'command', commandId: 'format:inline-code' },
      { kind: 'command', commandId: 'format:format-painter' },
      { kind: 'command', commandId: 'format:clear-formatting' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Headings',
        items: [
          { kind: 'command', commandId: 'format:heading-1' },
          { kind: 'command', commandId: 'format:heading-2' },
          { kind: 'command', commandId: 'format:heading-3' },
          { kind: 'command', commandId: 'format:heading-4' },
          { kind: 'command', commandId: 'format:heading-5' },
          { kind: 'command', commandId: 'format:heading-6' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:promote-heading' },
          { kind: 'command', commandId: 'format:demote-heading' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Paragraph',
        items: [
          { kind: 'command', commandId: 'format:normal-text' },
          { kind: 'command', commandId: 'format:blockquote' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:indent' },
          { kind: 'command', commandId: 'format:outdent' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:move-block-up' },
          { kind: 'command', commandId: 'format:move-block-down' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Alignment',
        items: [
          { kind: 'command', commandId: 'format:align-left' },
          { kind: 'command', commandId: 'format:align-centre' },
          { kind: 'command', commandId: 'format:align-right' },
          { kind: 'command', commandId: 'format:align-none' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Lists',
        items: [
          { kind: 'command', commandId: 'format:bullet-list' },
          { kind: 'command', commandId: 'format:numbered-list' },
          { kind: 'command', commandId: 'format:task-list' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:increase-list-level' },
          { kind: 'command', commandId: 'format:decrease-list-level' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'format:list-gallery' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Image Size',
        items: [
          { kind: 'command', commandId: 'format:widen-image' },
          { kind: 'command', commandId: 'format:narrow-image' },
          { kind: 'command', commandId: 'format:reset-image-size' },
        ],
      },
      { kind: 'separator' },
      { kind: 'command', commandId: 'format:styles-gallery' },
    ],
  },
  {
    label: 'Table',
    accessKey: 'T',
    items: [
      {
        kind: 'submenu',
        label: 'Row',
        items: [
          { kind: 'command', commandId: 'table:insert-row-above' },
          { kind: 'command', commandId: 'table:insert-row-below' },
          { kind: 'command', commandId: 'table:delete-row' },
          { kind: 'command', commandId: 'table:duplicate-row' },
          { kind: 'command', commandId: 'table:move-row-up' },
          { kind: 'command', commandId: 'table:move-row-down' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Column',
        items: [
          { kind: 'command', commandId: 'table:insert-column-left' },
          { kind: 'command', commandId: 'table:insert-column-right' },
          { kind: 'command', commandId: 'table:delete-column' },
          { kind: 'command', commandId: 'table:duplicate-column' },
          { kind: 'command', commandId: 'table:move-column-left' },
          { kind: 'command', commandId: 'table:move-column-right' },
          { kind: 'separator' },
          { kind: 'command', commandId: 'table:column-width' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Alignment',
        items: [
          { kind: 'command', commandId: 'table:align-column-left' },
          { kind: 'command', commandId: 'table:align-column-center' },
          { kind: 'command', commandId: 'table:align-column-right' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Sort',
        items: [
          { kind: 'command', commandId: 'table:sort-ascending' },
          { kind: 'command', commandId: 'table:sort-descending' },
        ],
      },
      { kind: 'separator' },
      { kind: 'toggle', commandId: 'table:toggle-header-row' },
      { kind: 'command', commandId: 'table:delete-table' },
    ],
  },
  {
    label: 'View',
    accessKey: 'V',
    items: [
      { kind: 'command', commandId: 'view:kdoc' },
      { kind: 'command', commandId: 'view:split' },
      { kind: 'command', commandId: 'view:source' },
      { kind: 'command', commandId: 'view:cycle-view-mode' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Panels',
        items: [
          { kind: 'toggle', commandId: 'view:toggle-sidebar' },
          { kind: 'toggle', commandId: 'view:toggle-outline' },
          { kind: 'toggle', commandId: 'view:toggle-sync-scroll' },
          { kind: 'toggle', commandId: 'view:toggle-status-bar' },
          { kind: 'toggle', commandId: 'view:toggle-right-panel' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Zoom',
        items: [
          { kind: 'command', commandId: 'view:zoom-in' },
          { kind: 'command', commandId: 'view:zoom-out' },
          { kind: 'command', commandId: 'view:zoom-reset' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Reading Width',
        items: [
          { kind: 'command', commandId: 'view:document-width' },
          { kind: 'command', commandId: 'view:document-density' },
          { kind: 'command', commandId: 'view:document-display-reset' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Focus Mode',
        items: [
          { kind: 'toggle', commandId: 'view:focus-paragraph' },
          { kind: 'toggle', commandId: 'view:focus-sentence' },
        ],
      },
      { kind: 'toggle', commandId: 'view:typewriter' },
      { kind: 'toggle', commandId: 'view:zen' },
      { kind: 'command', commandId: 'view:presentation' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Folding',
        items: [
          { kind: 'command', commandId: 'view:toggle-fold' },
          { kind: 'command', commandId: 'view:fold-all' },
          { kind: 'command', commandId: 'view:unfold-all' },
        ],
      },
      { kind: 'separator' },
      { kind: 'toggle', commandId: 'view:second-pane' },
      { kind: 'command', commandId: 'view:document-beside' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Theme',
        items: [
          { kind: 'command', commandId: 'view:toggle-theme' },
          { kind: 'command', commandId: 'view:app-theme' },
          { kind: 'command', commandId: 'view:app-theme-folder' },
        ],
      },
    ],
  },
  {
    label: 'Review',
    accessKey: 'R',
    items: [
      { kind: 'command', commandId: 'review:new-comment' },
      { kind: 'command', commandId: 'comments:bundle' },
      { kind: 'toggle', commandId: 'review:toggle-track-changes' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Spelling & Grammar',
        items: [
          { kind: 'command', commandId: 'spell:check' },
          { kind: 'toggle', commandId: 'spell:toggle' },
          { kind: 'command', commandId: 'proofing:grammar' },
          { kind: 'command', commandId: 'proofing:language' },
        ],
      },
      { kind: 'separator' },
      { kind: 'command', commandId: 'review:statistics' },
      { kind: 'command', commandId: 'view:version-history' },
      { kind: 'command', commandId: 'edit:compare-documents' },
      { kind: 'command', commandId: 'edit:merge-document' },
    ],
  },
  {
    label: 'Tools',
    accessKey: 'L',
    items: [
      { kind: 'command', commandId: 'view:command-palette' },
      { kind: 'command', commandId: 'view:snippets' },
      { kind: 'command', commandId: 'view:autocorrect-replacements' },
      { kind: 'command', commandId: 'view:reload-plugins' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Ribbon',
        items: [
          { kind: 'command', commandId: 'view:ribbon' },
          { kind: 'command', commandId: 'view:customise-ribbon' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Git',
        items: [
          { kind: 'command', commandId: 'file:git-stage' },
          { kind: 'command', commandId: 'file:git-commit' },
        ],
      },
      { kind: 'separator' },
      { kind: 'command', commandId: 'file:default-markdown-app' },
      { kind: 'command', commandId: 'view:settings' },
    ],
  },
  {
    label: 'Help',
    accessKey: 'H',
    items: [
      { kind: 'command', commandId: 'help:user-guide' },
      { kind: 'command', commandId: 'view:keyboard-shortcuts' },
      { kind: 'separator' },
      { kind: 'command', commandId: 'help:about' },
    ],
  },
];

/**
 * Static CSS stylesheet for K-Doc's horizontal menu bar and popups.
 * Conforms strictly to Material 3 Expressive design tokens.
 */
export const APP_MENU_BAR_STYLES: string = `
.kdoc-menu-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0;
  padding: 2px;
  background: transparent;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
  user-select: none;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 12px;
  position: relative;
  z-index: 900;
}

.kdoc-menu-bar-button {
  background: transparent;
  border: 0;
  border-radius: var(--kdoc-radius-pill);
  color: var(--kdoc-chrome-text);
  height: 28px;
  padding: 0 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  transition: background 150ms ease, color 150ms ease, border-radius 150ms ease;
}

.kdoc-menu-bar-button:hover:not([aria-expanded="true"]):not(.kdoc-menu-open) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-menu-bar-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-menu-bar-button.kdoc-menu-open,
.kdoc-menu-bar-button[aria-expanded="true"] {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-menu-accesskey {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.kdoc-menu-popup {
  position: fixed;
  z-index: 1000;
  min-width: 240px;
  max-width: 380px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 4px;
  box-sizing: border-box;
  background: var(--kdoc-chrome-glass-tint);
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.kdoc-menu-separator {
  height: 1px;
  background: var(--kdoc-chrome-glass-edge);
  margin: 6px 10px;
  border: none;
  flex-shrink: 0;
}

.kdoc-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 0 6px;
  height: 36px;
  border-radius: var(--kdoc-radius-sm);
  color: var(--kdoc-chrome-text);
  font-size: 12px;
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
  transition: background 150ms ease, color 150ms ease, border-radius 150ms ease;
}

.kdoc-menu-item:hover:not([aria-disabled="true"]),
.kdoc-menu-item.kdoc-menu-item-active,
.kdoc-menu-item[aria-expanded="true"] {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-menu-item:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-menu-item[aria-disabled="true"] {
  cursor: not-allowed;
  color: color-mix(in srgb, var(--kdoc-chrome-text) 38%, transparent);
}

.kdoc-menu-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-menu-item-check {
  width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--kdoc-chrome-accent);
  flex-shrink: 0;
}

.kdoc-menu-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-menu-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  flex-shrink: 0;
}

.kdoc-menu-item-shortcut {
  font-size: 12px;
  font-weight: 400;
  color: var(--kdoc-chrome-text-muted);
  white-space: nowrap;
}

.kdoc-menu-item-arrow {
  font-size: 10px;
  color: var(--kdoc-chrome-text-muted);
  display: inline-flex;
  align-items: center;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-menu-bar,
  .kdoc-menu-bar-button,
  .kdoc-menu-popup,
  .kdoc-menu-item {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Renders a label with its access key character underlined.
 *
 * @purpose Builds child text nodes and a <u> element for the designated access key.
 * @inputs
 *   - target: HTMLElement - Target element to append child nodes to.
 *   - label: string - Display label text.
 *   - accessKey: string - Single character access key to underline.
 *   - doc: Document - DOM document instance.
 * @outputs void.
 * @dataflow label + accessKey -> index calculation -> DOM text and <u> element creation.
 * @controlflow Locate access key index in label -> append pre-match text, <u> element, and post-match text.
 */
function renderAccessKeyLabel(
  target: HTMLElement,
  label: string,
  accessKey: string,
  doc: Document,
): void {
  target.textContent = '';

  const lowerLabel = label.toLowerCase();
  const lowerKey = accessKey.toLowerCase();
  const index = lowerLabel.indexOf(lowerKey);

  // Check whether the access key character exists within the label.
  if (index !== -1) {
    const pre = label.slice(0, index);
    const char = label.slice(index, index + 1);
    const post = label.slice(index + 1);

    // Check if leading text is present.
    if (pre.length > 0) {
      target.appendChild(doc.createTextNode(pre));
    } else {
      // No leading text.
    }

    const u = doc.createElement('u');
    u.className = 'kdoc-menu-accesskey';
    u.textContent = char;
    target.appendChild(u);

    // Check if trailing text is present.
    if (post.length > 0) {
      target.appendChild(doc.createTextNode(post));
    } else {
      // No trailing text.
    }
  } else {
    // Access key not found in label text: render plain label.
    target.textContent = label;
  }
}

interface OpenPopupLevel {
  readonly popup: HTMLElement;
  readonly parentItem: HTMLElement | null;
  readonly items: readonly AppMenuItemSpec[];
  readonly itemElements: HTMLElement[];
  activeIndex: number;
}

export function installAppMenuBar(mount: HTMLElement, options: AppMenuBarOptions): AppMenuBar;
export function installAppMenuBar(options: AppMenuBarOptions): AppMenuBar;
/**
 * Installs the horizontal menu bar into the mount element, configuring roving tabindex, popups, and keyboard navigation.
 *
 * @purpose Mounts the application menubar and establishes lifecycle coordination with command registry and editor view.
 * @inputs
 *   - mountOrOptions: HTMLElement | AppMenuBarOptions - Mount container or options object.
 *   - maybeOptions: AppMenuBarOptions | undefined - Options object when mount is passed first.
 * @outputs AppMenuBar - Handle exposing element, refresh(), and destroy().
 * @dataflow options -> menubar DOM hierarchy -> user interactions -> options.run(commandId).
 * @controlflow Create nav element -> append to mount -> build top-level buttons -> bind global and item event listeners -> return controller handle.
 */
export function installAppMenuBar(
  mountOrOptions: HTMLElement | AppMenuBarOptions,
  maybeOptions?: AppMenuBarOptions,
): AppMenuBar {
  let mount: HTMLElement;
  let options: AppMenuBarOptions;

  // Check whether first argument is an HTMLElement or options bag.
  if (typeof (mountOrOptions as HTMLElement).nodeType === 'number') {
    mount = mountOrOptions as HTMLElement;
    options = maybeOptions ?? { commands: (): readonly KdocCommand[] => [] };
  } else {
    options = mountOrOptions as AppMenuBarOptions;
    const resolvedDoc = options.doc ?? (typeof document !== 'undefined' ? document : null);
    mount = resolvedDoc !== null ? resolvedDoc.body : ({} as HTMLElement);
  }

  const doc = options.doc ?? mount.ownerDocument ?? document;
  const win = options.win ?? doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed = false;
  let focusedTopIndex = 0;
  let openTopIndex: number | null = null;
  const openLevels: OpenPopupLevel[] = [];

  // Snapshot active element prior to opening menu so focus can be returned accurately.
  let previousActiveElement: HTMLElement | null = null;

  // Construct main menubar element.
  const barElement = doc.createElement('nav');
  barElement.className = 'kdoc-menu-bar';
  barElement.setAttribute('role', 'menubar');
  barElement.setAttribute('aria-label', 'Application');
  mount.appendChild(barElement);

  const topButtons: HTMLButtonElement[] = [];

  /**
   * Builds an index of commands by id for quick retrieval.
   *
   * @purpose Creates a Map from command id to KdocCommand for enabled and label lookups.
   * @inputs void.
   * @outputs Map<string, KdocCommand> - Mapped command registry.
   * @dataflow options.commands() -> command Map.
   * @controlflow Retrieve live commands array -> iterate and populate Map -> return Map.
   */
  function getCommandMap(): Map<string, KdocCommand> {
    const list = options.commands();
    const map = new Map<string, KdocCommand>();
    for (let i = 0; i < list.length; i++) {
      const cmd = list[i];
      // Check if command is defined under strict indexing.
      if (cmd !== undefined) {
        map.set(cmd.id, cmd);
      } else {
        // Skip undefined command.
      }
    }
    return map;
  }

  /**
   * Summarises everything an open menu draws, so refresh() can tell a real change from a no-op.
   *
   * @purpose Builds a string of every item's label, shortcut, enabled and checked state, recursing into submenus.
   * @inputs items - The menu's item specs; commandMap - Current commands by id.
   * @outputs string - Equal for two calls exactly when the menu would render identically.
   * @dataflow items + commandMap + options.isChecked -> one token per item -> joined signature.
   * @controlflow Iterate items -> branch on kind (command/toggle, submenu, separator) -> recurse into submenus -> join.
   */
  function menuSignature(items: readonly AppMenuItemSpec[], commandMap: Map<string, KdocCommand>): string {
    const parts: string[] = [];
    for (const item of items) {
      // Check which kind of entry this is, since each contributes different drawn state.
      if (item.kind === 'command' || item.kind === 'toggle') {
        // Command or toggle: its label, shortcut and enabled state are drawn; a toggle also draws its tick.
        const cmd = commandMap.get(item.commandId);
        let checked = false;
        // Check whether this entry is a toggle, the only kind that draws a checked state.
        if (item.kind === 'toggle') {
          // Toggle: the item's own predicate wins, then the bar-wide one, else unchecked (as rendering does).
          checked = typeof item.isChecked === 'function' ? item.isChecked() : (options.isChecked?.(item.commandId) ?? false);
        } else {
          // Plain command: never checked.
        }
        // A missing command renders as enabled, so it signs as enabled too.
        const enabled = cmd === undefined ? true : cmd.isEnabled();
        parts.push(`${item.commandId}|${cmd?.label ?? ''}|${cmd?.shortcut ?? ''}|${enabled ? 1 : 0}|${checked ? 1 : 0}`);
      } else if (item.kind === 'submenu') {
        // Submenu: its label plus everything its own items draw.
        parts.push(`>${item.label}[${menuSignature(item.items, commandMap)}]`);
      } else {
        // Separator: draws nothing that can change.
        parts.push('-');
      }
    }
    return parts.join(';');
  }

  /** Signature of the menu as last drawn; refresh() redraws only when the current one differs. */
  let openSignature: string | null = null;

  /**
   * Closes all open popups and restores top-level button states.
   *
   * @purpose Dismisses open menu hierarchy and returns focus to editor or menubar button.
   * @inputs restoreFocus: boolean - Whether to restore focus to previously active element or editor.
   * @outputs void.
   * @dataflow openLevels stack -> DOM node removal -> focus restoration.
   * @controlflow Walk openLevels backwards -> remove popup elements -> reset top button state -> restore focus.
   */
  function closeAllMenus(restoreFocus: boolean = true): void {
    // Check if any menus are currently open.
    if (openTopIndex === null && openLevels.length === 0) {
      return;
    } else {
      // Proceed with closing all open levels.
    }

    while (openLevels.length > 0) {
      const level = openLevels.pop();
      // Check if level entry exists.
      if (level !== undefined) {
        // Check if popup node is attached to DOM.
        if (level.popup.parentNode !== null) {
          level.popup.parentNode.removeChild(level.popup);
        } else {
          // Popup already detached.
        }
        // Check if parent item exists and clear expanded attribute.
        if (level.parentItem !== null) {
          level.parentItem.setAttribute('aria-expanded', 'false');
        } else {
          // Top-level popup has no parent item.
        }
      } else {
        // Level entry undefined.
      }
    }

    // Check if a top-level menu was open.
    if (openTopIndex !== null) {
      const topBtn = topButtons[openTopIndex];
      // Check if button exists.
      if (topBtn !== undefined) {
        topBtn.setAttribute('aria-expanded', 'false');
        topBtn.classList.remove('kdoc-menu-open');
      } else {
        // Button not found.
      }
      openTopIndex = null;
    } else {
      // No top-level menu recorded.
    }

    // Check whether focus restoration was requested.
    if (restoreFocus) {
      // Check if external restore callback was provided.
      if (options.onRestoreFocus !== undefined) {
        options.onRestoreFocus();
      } else if (previousActiveElement !== null && typeof previousActiveElement.focus === 'function') {
        // Restore focus to pre-opening active element.
        previousActiveElement.focus();
      } else {
        // Fallback: focus the active menubar button.
        const currentBtn = topButtons[focusedTopIndex];
        if (currentBtn !== undefined) {
          currentBtn.focus();
        } else {
          // No active button.
        }
      }
    } else {
      // Do not restore focus.
    }
  }

  /**
   * Positions a popup element relative to an anchor element, avoiding window edge collisions.
   *
   * @purpose Computes absolute viewport coordinates ensuring popups remain fully visible on screen.
   * @inputs
   *   - popup: HTMLElement - The popup menu element to position.
   *   - anchor: HTMLElement - The anchor button or parent menuitem.
   *   - isSubmenu: boolean - True for nested submenus; false for top-level dropdowns.
   * @outputs void.
   * @dataflow anchor rect + window dimensions -> computed left/top coordinates -> popup inline styles.
   * @controlflow Measure anchor rect -> calculate prospective coordinates -> flip or shift if boundary crossed -> apply styles.
   */
  function positionPopup(popup: HTMLElement, anchor: HTMLElement, isSubmenu: boolean): void {
    const anchorRect = anchor.getBoundingClientRect();
    const winWidth = win?.innerWidth ?? 1024;
    const winHeight = win?.innerHeight ?? 768;

    // Attach off-screen or unpositioned to obtain rendered dimensions.
    doc.body.appendChild(popup);
    const popupRect = popup.getBoundingClientRect();

    let left = isSubmenu ? anchorRect.right : anchorRect.left;
    let top = isSubmenu ? anchorRect.top : anchorRect.bottom;

    // Check if horizontal position overflows right viewport boundary.
    if (left + popupRect.width > winWidth) {
      // Check if positioning as a submenu allows flipping to the left of the anchor.
      if (isSubmenu) {
        const flippedLeft = anchorRect.left - popupRect.width;
        // Check if flipped position stays within left viewport boundary.
        if (flippedLeft >= 8) {
          left = flippedLeft;
        } else {
          left = Math.max(8, winWidth - popupRect.width - 8);
        }
      } else {
        // Top-level popup shifts leftwards to remain on screen.
        left = Math.max(8, winWidth - popupRect.width - 8);
      }
    } else {
      // No horizontal overflow.
    }

    // Check if left edge runs off left boundary.
    if (left < 8) {
      left = 8;
    } else {
      // Left coordinate is within bounds.
    }

    // Check if vertical position overflows bottom viewport boundary.
    if (top + popupRect.height > winHeight) {
      // Check if top-level popup can flip upwards above the anchor button.
      if (!isSubmenu) {
        const flippedTop = anchorRect.top - popupRect.height;
        // Check if upward flipped position fits within top window edge.
        if (flippedTop >= 8) {
          top = flippedTop;
        } else {
          top = Math.max(8, winHeight - popupRect.height - 8);
        }
      } else {
        // Submenu shifts upward to fit on screen.
        top = Math.max(8, winHeight - popupRect.height - 8);
      }
    } else {
      // Vertical coordinate is within bounds.
    }

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  /**
   * Renders and displays a popup menu for a specific top-level menu or submenu.
   *
   * @purpose Constructs aero-glass menu DOM hierarchy, binds item interactions, and tracks level in openLevels.
   * @inputs
   *   - items: readonly AppMenuItemSpec[] - Declarative menu items to render.
   *   - anchor: HTMLElement - Anchoring element (top-level button or parent submenu item).
   *   - isSubmenu: boolean - True for nested submenus; false for top-level dropdowns.
   *   - menuLabel: string - Accessible label for the menu container.
   *   - focusFirst: boolean - Whether to focus the first enabled item automatically.
   * @outputs OpenPopupLevel - Configured level entry.
   * @dataflow items + commands map -> DOM items hierarchy -> positioning -> focus management -> return level entry.
   * @controlflow Create popup div -> render items and separators -> position -> attach keyboard and click handlers -> push to openLevels.
   */
  function showMenuPopup(
    items: readonly AppMenuItemSpec[],
    anchor: HTMLElement,
    isSubmenu: boolean,
    menuLabel: string,
    focusFirst: boolean,
  ): OpenPopupLevel {
    const commandMap = getCommandMap();

    const popup = doc.createElement('div');
    popup.className = 'kdoc-menu-popup';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-orientation', 'vertical');
    popup.setAttribute('aria-label', menuLabel);

    const itemElements: HTMLElement[] = [];
    const activeLevelIndex = openLevels.length;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Check if item is defined under strict indexing.
      if (item === undefined) {
        continue;
      } else {
        // Item is defined.
      }

      // Check item kind.
      if (item.kind === 'separator') {
        const sep = doc.createElement('div');
        sep.className = 'kdoc-menu-separator';
        sep.setAttribute('role', 'separator');
        popup.appendChild(sep);
        continue;
      } else {
        // Non-separator item.
      }

      const itemEl = doc.createElement('div');
      itemEl.className = 'kdoc-menu-item';
      itemEl.setAttribute('tabindex', '-1');

      let labelText = '';
      let shortcutText = '';
      let isEnabled = true;
      let isChecked = false;
      const isSubmenuItem = item.kind === 'submenu';

      if (item.kind === 'command') {
        itemEl.setAttribute('role', 'menuitem');
        const cmd = commandMap.get(item.commandId);
        labelText = cmd ? cmd.label : item.commandId;
        shortcutText = cmd ? cmd.shortcut : '';
        isEnabled = cmd ? cmd.isEnabled() : true;
      } else if (item.kind === 'toggle') {
        itemEl.setAttribute('role', 'menuitemcheckbox');
        const cmd = commandMap.get(item.commandId);
        labelText = cmd ? cmd.label : item.commandId;
        shortcutText = cmd ? cmd.shortcut : '';
        isEnabled = cmd ? cmd.isEnabled() : true;

        // Check if item defines its own isChecked predicate.
        if (typeof item.isChecked === 'function') {
          isChecked = item.isChecked();
        } else if (typeof options.isChecked === 'function') {
          // Query options isChecked predicate.
          isChecked = options.isChecked(item.commandId);
        } else {
          isChecked = false;
        }
        itemEl.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      } else if (item.kind === 'submenu') {
        itemEl.classList.add('kdoc-menu-item-submenu');
        itemEl.setAttribute('role', 'menuitem');
        itemEl.setAttribute('aria-haspopup', 'menu');
        itemEl.setAttribute('aria-expanded', 'false');
        labelText = item.label;
        isEnabled = true;
      } else {
        // Exhaustive check.
      }

      // Check whether item is enabled.
      if (!isEnabled) {
        itemEl.setAttribute('aria-disabled', 'true');
      } else {
        // Item is enabled.
      }

      // Left container with checkchip and label.
      const leftSpan = doc.createElement('span');
      leftSpan.className = 'kdoc-menu-item-left';

      const checkSpan = doc.createElement('span');
      checkSpan.className = 'kdoc-menu-item-check';
      // Check whether item is checked.
      if (isChecked) {
        checkSpan.textContent = '✓';
      } else {
        checkSpan.setAttribute('aria-hidden', 'true');
      }
      leftSpan.appendChild(checkSpan);

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'kdoc-menu-item-label';
      labelSpan.textContent = labelText;
      leftSpan.appendChild(labelSpan);
      itemEl.appendChild(leftSpan);

      // Right container with shortcut hint or submenu arrow.
      const rightSpan = doc.createElement('span');
      rightSpan.className = 'kdoc-menu-item-right';

      // Check whether shortcut hint is present.
      if (shortcutText !== '') {
        const shortcutSpan = doc.createElement('span');
        shortcutSpan.className = 'kdoc-menu-item-shortcut';
        shortcutSpan.textContent = shortcutText;
        rightSpan.appendChild(shortcutSpan);
      } else {
        // No shortcut hint.
      }

      // Check whether item is a submenu.
      if (isSubmenuItem) {
        const arrowSpan = doc.createElement('span');
        arrowSpan.className = 'kdoc-menu-item-arrow';
        arrowSpan.textContent = '▶';
        rightSpan.appendChild(arrowSpan);
      } else {
        // Not a submenu.
      }

      itemEl.appendChild(rightSpan);
      popup.appendChild(itemEl);

      const itemIndexInLevel = itemElements.length;
      itemElements.push(itemEl);

      // Handle pointer enter on item.
      itemEl.addEventListener(
        'mouseenter',
        () => {
          // Check if item is disabled.
          if (itemEl.getAttribute('aria-disabled') === 'true') {
            return;
          } else {
            // Enabled item: highlight and set focus.
          }

          const currentLevel = openLevels[activeLevelIndex];
          if (currentLevel !== undefined) {
            currentLevel.activeIndex = itemIndexInLevel;
            for (let k = 0; k < currentLevel.itemElements.length; k++) {
              const el = currentLevel.itemElements[k];
              if (el !== undefined) {
                el.classList.toggle('kdoc-menu-item-active', k === itemIndexInLevel);
              } else {
                // Element undefined.
              }
            }
          } else {
            // Level undefined.
          }

          // Check if any deeper nested submenus are open.
          while (openLevels.length > activeLevelIndex + 1) {
            const deeper = openLevels.pop();
            if (deeper !== undefined) {
              if (deeper.popup.parentNode !== null) {
                deeper.popup.parentNode.removeChild(deeper.popup);
              } else {
                // Deeper popup already detached.
              }
              if (deeper.parentItem !== null) {
                deeper.parentItem.setAttribute('aria-expanded', 'false');
              } else {
                // No parent item.
              }
            } else {
              // Undefined deeper level.
            }
          }

          // Check if hovered item is a submenu: open it automatically.
          if (item.kind === 'submenu') {
            itemEl.setAttribute('aria-expanded', 'true');
            showMenuPopup(item.items, itemEl, true, item.label, false);
          } else {
            // Regular command or toggle.
          }
        },
        { signal },
      );

      // Handle click on item.
      itemEl.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          // Check if item is disabled.
          if (itemEl.getAttribute('aria-disabled') === 'true') {
            return;
          } else {
            // Enabled item.
          }

          // Check if item is a submenu.
          if (item.kind === 'submenu') {
            itemEl.setAttribute('aria-expanded', 'true');
            showMenuPopup(item.items, itemEl, true, item.label, true);
          } else if (item.kind === 'command' || item.kind === 'toggle') {
            // Command or toggle execution: close all menus first to allow editor focus restoration.
            const commandId = item.commandId;
            closeAllMenus(false);
            if (typeof options.run === 'function') {
              options.run(commandId);
            } else {
              // No run callback provided.
            }
          } else {
            // Separator or other kind.
          }
        },
        { signal },
      );
    }

    positionPopup(popup, anchor, isSubmenu);

    const levelEntry: OpenPopupLevel = {
      popup,
      parentItem: isSubmenu ? anchor : null,
      items,
      itemElements,
      activeIndex: -1,
    };
    openLevels.push(levelEntry);

    /**
     * Focuses an item by index within this level.
     *
     * @purpose Sets active index, synchronizes active styling class, and focuses DOM node.
     * @inputs targetIndex: number - Target index in itemElements array.
     * @outputs void.
     * @dataflow targetIndex -> activeIndex update -> itemElements focus.
     * @controlflow Bounds check targetIndex -> update active styling -> invoke focus().
     */
    function focusItem(targetIndex: number): void {
      // Check if target index is in range.
      if (targetIndex < 0 || targetIndex >= itemElements.length) {
        return;
      } else {
        // Valid target index.
      }

      levelEntry.activeIndex = targetIndex;
      for (let k = 0; k < itemElements.length; k++) {
        const el = itemElements[k];
        if (el !== undefined) {
          el.classList.toggle('kdoc-menu-item-active', k === targetIndex);
        } else {
          // Element undefined.
        }
      }

      const activeEl = itemElements[targetIndex];
      if (activeEl !== undefined) {
        activeEl.focus();
      } else {
        // Active element undefined.
      }
    }

    // Check if initial item focus is requested.
    if (focusFirst) {
      for (let k = 0; k < itemElements.length; k++) {
        const el = itemElements[k];
        // Check if item exists and is enabled.
        if (el !== undefined && el.getAttribute('aria-disabled') !== 'true') {
          focusItem(k);
          break;
        } else {
          // Disabled or undefined item: continue searching.
        }
      }
    } else {
      // Focus not requested on popup mount.
    }

    // Bind keyboard navigation to the popup element.
    popup.addEventListener(
      'keydown',
      (ev: KeyboardEvent) => {
        const key = ev.key;

        // Check if key is ArrowDown.
        if (key === 'ArrowDown') {
          ev.preventDefault();
          ev.stopPropagation();
          let nextIndex = levelEntry.activeIndex;
          for (let step = 1; step <= itemElements.length; step++) {
            const candidate = (levelEntry.activeIndex + step) % itemElements.length;
            const candidateEl = itemElements[candidate];
            // Check if candidate item is enabled.
            if (candidateEl !== undefined && candidateEl.getAttribute('aria-disabled') !== 'true') {
              nextIndex = candidate;
              break;
            } else {
              // Item disabled.
            }
          }
          focusItem(nextIndex);
          return;
        } else if (key === 'ArrowUp') {
          // Check if key is ArrowUp.
          ev.preventDefault();
          ev.stopPropagation();
          let prevIndex = levelEntry.activeIndex;
          for (let step = 1; step <= itemElements.length; step++) {
            const candidate =
              (levelEntry.activeIndex - step + itemElements.length) % itemElements.length;
            const candidateEl = itemElements[candidate];
            // Check if candidate item is enabled.
            if (candidateEl !== undefined && candidateEl.getAttribute('aria-disabled') !== 'true') {
              prevIndex = candidate;
              break;
            } else {
              // Item disabled.
            }
          }
          focusItem(prevIndex);
          return;
        } else if (key === 'Home') {
          // Check if key is Home.
          ev.preventDefault();
          ev.stopPropagation();
          for (let k = 0; k < itemElements.length; k++) {
            const el = itemElements[k];
            // Check if item is enabled.
            if (el !== undefined && el.getAttribute('aria-disabled') !== 'true') {
              focusItem(k);
              break;
            } else {
              // Item disabled.
            }
          }
          return;
        } else if (key === 'End') {
          // Check if key is End.
          ev.preventDefault();
          ev.stopPropagation();
          for (let k = itemElements.length - 1; k >= 0; k--) {
            const el = itemElements[k];
            // Check if item is enabled.
            if (el !== undefined && el.getAttribute('aria-disabled') !== 'true') {
              focusItem(k);
              break;
            } else {
              // Item disabled.
            }
          }
          return;
        } else if (key === 'ArrowRight') {
          // Check if key is ArrowRight.
          ev.preventDefault();
          ev.stopPropagation();

          // Check if active item is a submenu.
          const activeSpec =
            levelEntry.activeIndex >= 0 ? items[levelEntry.activeIndex] : undefined;
          if (activeSpec !== undefined && activeSpec.kind === 'submenu') {
            const activeEl = itemElements[levelEntry.activeIndex];
            if (activeEl !== undefined && activeEl.getAttribute('aria-disabled') !== 'true') {
              activeEl.setAttribute('aria-expanded', 'true');
              showMenuPopup(activeSpec.items, activeEl, true, activeSpec.label, true);
              return;
            } else {
              // Submenu item disabled.
            }
          } else {
            // Not a submenu: move to the next top-level menu bar item.
            if (openTopIndex !== null) {
              const nextTop = (openTopIndex + 1) % topButtons.length;
              closeAllMenus(false);
              openMenu(nextTop, true);
            } else {
              // No top menu active.
            }
          }
          return;
        } else if (key === 'ArrowLeft') {
          // Check if key is ArrowLeft.
          ev.preventDefault();
          ev.stopPropagation();

          // Check if current popup is a nested submenu level.
          if (openLevels.length > 1) {
            const popped = openLevels.pop();
            if (popped !== undefined) {
              if (popped.popup.parentNode !== null) {
                popped.popup.parentNode.removeChild(popped.popup);
              } else {
                // Popped popup detached.
              }
              if (popped.parentItem !== null) {
                popped.parentItem.setAttribute('aria-expanded', 'false');
                popped.parentItem.focus();
              } else {
                // No parent item.
              }
            } else {
              // Popped level undefined.
            }
          } else {
            // At top-level popup: move to previous top-level menu bar item.
            if (openTopIndex !== null) {
              const prevTop = (openTopIndex - 1 + topButtons.length) % topButtons.length;
              closeAllMenus(false);
              openMenu(prevTop, true);
            } else {
              // No top menu active.
            }
          }
          return;
        } else if (key === 'Enter' || key === ' ') {
          // Check if key is Enter or Space.
          ev.preventDefault();
          ev.stopPropagation();

          const activeSpec =
            levelEntry.activeIndex >= 0 ? items[levelEntry.activeIndex] : undefined;
          const activeEl =
            levelEntry.activeIndex >= 0 ? itemElements[levelEntry.activeIndex] : undefined;

          // Check if active element is defined and enabled.
          if (
            activeSpec !== undefined &&
            activeEl !== undefined &&
            activeEl.getAttribute('aria-disabled') !== 'true'
          ) {
            if (activeSpec.kind === 'submenu') {
              activeEl.setAttribute('aria-expanded', 'true');
              showMenuPopup(activeSpec.items, activeEl, true, activeSpec.label, true);
            } else if (activeSpec.kind === 'command' || activeSpec.kind === 'toggle') {
              const commandId = activeSpec.commandId;
              closeAllMenus(false);
              if (typeof options.run === 'function') {
                options.run(commandId);
              } else {
                // No run callback.
              }
            } else {
              // Separator or other kind.
            }
          } else {
            // Disabled or undefined active item.
          }
          return;
        } else if (key === 'Escape') {
          // Check if key is Escape.
          ev.preventDefault();
          ev.stopPropagation();

          // Check if in a nested submenu level.
          if (openLevels.length > 1) {
            const popped = openLevels.pop();
            if (popped !== undefined) {
              if (popped.popup.parentNode !== null) {
                popped.popup.parentNode.removeChild(popped.popup);
              } else {
                // Popped popup detached.
              }
              if (popped.parentItem !== null) {
                popped.parentItem.setAttribute('aria-expanded', 'false');
                popped.parentItem.focus();
              } else {
                // No parent item.
              }
            } else {
              // Popped level undefined.
            }
          } else {
            // Close all menus and restore focus to previous element or editor.
            closeAllMenus(true);
          }
          return;
        } else if (key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
          // Typeahead navigation: jump to the next item starting with typed letter.
          const lowerChar = key.toLowerCase();
          const startIndex = levelEntry.activeIndex + 1;

          for (let step = 0; step < itemElements.length; step++) {
            const candidate = (startIndex + step) % itemElements.length;
            const candidateEl = itemElements[candidate];
            // Check if candidate element is enabled.
            if (candidateEl !== undefined && candidateEl.getAttribute('aria-disabled') !== 'true') {
              const labelEl = candidateEl.querySelector('.kdoc-menu-item-label');
              const text = labelEl?.textContent?.toLowerCase() ?? '';
              // Check if label text starts with typed character.
              if (text.startsWith(lowerChar)) {
                ev.preventDefault();
                ev.stopPropagation();
                focusItem(candidate);
                return;
              } else {
                // Label does not match.
              }
            } else {
              // Disabled item.
            }
          }
        } else {
          // Other unhandled key.
        }
      },
      { signal },
    );

    return levelEntry;
  }

  /**
   * Opens the top-level menu at the specified index.
   *
   * @purpose Activates the top-level button, renders its dropdown popup, and sets roving focus.
   * @inputs
   *   - index: number - Index of the top-level menu in APP_MENU_BAR_SPEC.
   *   - focusFirst: boolean - Whether to automatically focus the first enabled menu item.
   * @outputs void.
   * @dataflow index -> update openTopIndex -> button active styling -> showMenuPopup.
   * @controlflow Capture active element -> set roving tabindex -> update button styling -> invoke showMenuPopup.
   */
  function openMenu(index: number, focusFirst: boolean): void {
    // Check if index is within range.
    if (index < 0 || index >= APP_MENU_BAR_SPEC.length) {
      return;
    } else {
      // Valid index.
    }

    const menu = APP_MENU_BAR_SPEC[index];
    const button = topButtons[index];
    // Check if menu and button are defined.
    if (menu === undefined || button === undefined) {
      return;
    } else {
      // Defined menu and button.
    }

    // Capture previous active element if none captured yet.
    if (openTopIndex === null && doc.activeElement instanceof HTMLElement) {
      previousActiveElement = doc.activeElement;
    } else {
      // Already captured or not HTMLElement.
    }

    openTopIndex = index;
    focusedTopIndex = index;
    openSignature = menuSignature(menu.items, getCommandMap());

    // Update roving tabindex on all top buttons.
    for (let i = 0; i < topButtons.length; i++) {
      const btn = topButtons[i];
      if (btn !== undefined) {
        btn.setAttribute('tabindex', i === index ? '0' : '-1');
        btn.setAttribute('aria-expanded', i === index ? 'true' : 'false');
        btn.classList.toggle('kdoc-menu-open', i === index);
      } else {
        // Button undefined.
      }
    }

    showMenuPopup(menu.items, button, false, menu.label, focusFirst);
  }

  // Construct top-level buttons for each menu in APP_MENU_BAR_SPEC.
  for (let i = 0; i < APP_MENU_BAR_SPEC.length; i++) {
    const menu = APP_MENU_BAR_SPEC[i];
    // Check if menu entry is defined under strict indexing.
    if (menu === undefined) {
      continue;
    } else {
      // Menu is defined.
    }

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'kdoc-menu-bar-button';
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('tabindex', i === 0 ? '0' : '-1');

    renderAccessKeyLabel(button, menu.label, menu.accessKey, doc);
    barElement.appendChild(button);
    topButtons.push(button);

    const buttonIndex = i;

    // Handle button click.
    button.addEventListener(
      'click',
      (ev) => {
        ev.stopPropagation();
        // Check if this menu is already open: toggle close.
        if (openTopIndex === buttonIndex) {
          closeAllMenus(true);
        } else {
          // Open this menu.
          closeAllMenus(false);
          openMenu(buttonIndex, true);
        }
      },
      { signal },
    );

    // Handle mouse hover over top button when any menu is already open.
    button.addEventListener(
      'mouseenter',
      () => {
        // Check if another top-level menu is currently open: switch immediately without second click.
        if (openTopIndex !== null && openTopIndex !== buttonIndex) {
          closeAllMenus(false);
          openMenu(buttonIndex, false);
        } else {
          // No menu open, or same menu already open.
        }
      },
      { signal },
    );

    // Handle button focus tracking.
    button.addEventListener(
      'focus',
      () => {
        focusedTopIndex = buttonIndex;
        for (let k = 0; k < topButtons.length; k++) {
          const btn = topButtons[k];
          if (btn !== undefined) {
            btn.setAttribute('tabindex', k === buttonIndex ? '0' : '-1');
          } else {
            // Button undefined.
          }
        }
      },
      { signal },
    );

    // Keyboard navigation while focus is on the menubar buttons (closed menu state).
    button.addEventListener(
      'keydown',
      (ev: KeyboardEvent) => {
        const key = ev.key;

        // Check if key is ArrowRight.
        if (key === 'ArrowRight') {
          ev.preventDefault();
          const nextIndex = (buttonIndex + 1) % topButtons.length;
          const nextBtn = topButtons[nextIndex];
          if (nextBtn !== undefined) {
            nextBtn.focus();
          } else {
            // Button undefined.
          }
          return;
        } else if (key === 'ArrowLeft') {
          // Check if key is ArrowLeft.
          ev.preventDefault();
          const prevIndex = (buttonIndex - 1 + topButtons.length) % topButtons.length;
          const prevBtn = topButtons[prevIndex];
          if (prevBtn !== undefined) {
            prevBtn.focus();
          } else {
            // Button undefined.
          }
          return;
        } else if (key === 'Home') {
          // Check if key is Home.
          ev.preventDefault();
          const firstBtn = topButtons[0];
          if (firstBtn !== undefined) {
            firstBtn.focus();
          } else {
            // Button undefined.
          }
          return;
        } else if (key === 'End') {
          // Check if key is End.
          ev.preventDefault();
          const lastBtn = topButtons[topButtons.length - 1];
          if (lastBtn !== undefined) {
            lastBtn.focus();
          } else {
            // Button undefined.
          }
          return;
        } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
          // Check if key is ArrowDown, Enter, or Space to open menu focusing first item.
          ev.preventDefault();
          closeAllMenus(false);
          openMenu(buttonIndex, true);
          return;
        } else if (key === 'Escape') {
          // Check if key is Escape: close all menus and return focus.
          ev.preventDefault();
          closeAllMenus(true);
          return;
        } else {
          // Other key.
        }
      },
      { signal },
    );
  }

  // Global listener for Alt+<accessKey> shortcuts and outside clicks.
  if (win !== null) {
    win.addEventListener(
      'keydown',
      (ev: KeyboardEvent) => {
        // Check if Alt modifier is pressed without Ctrl or Meta.
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
          const pressedKey = ev.key.toUpperCase();
          for (let i = 0; i < APP_MENU_BAR_SPEC.length; i++) {
            const menu = APP_MENU_BAR_SPEC[i];
            // Check if accessKey matches pressed key.
            if (menu !== undefined && menu.accessKey.toUpperCase() === pressedKey) {
              ev.preventDefault();
              ev.stopPropagation();
              closeAllMenus(false);
              openMenu(i, true);
              return;
            } else {
              // Access key does not match.
            }
          }
        } else {
          // Modifier does not match Alt+accessKey pattern.
        }
      },
      { signal },
    );
  } else {
    // Window context not available.
  }

  // Click outside listener to dismiss menus.
  doc.addEventListener(
    'pointerdown',
    (ev: PointerEvent) => {
      // Check if any menus are open.
      if (openTopIndex === null) {
        return;
      } else {
        // Menu is open.
      }

      const target = ev.target;
      // Check if target is a Node.
      if (target instanceof Node) {
        // Check if clicked inside the menubar itself.
        if (barElement.contains(target)) {
          return;
        } else {
          // Not inside menubar.
        }

        // Check if clicked inside any open popup element.
        for (let i = 0; i < openLevels.length; i++) {
          const level = openLevels[i];
          if (level !== undefined && level.popup.contains(target)) {
            return;
          } else {
            // Not inside this popup level.
          }
        }

        // Click is outside: close all menus without forcing editor refocus.
        closeAllMenus(false);
      } else {
        // Target is not a DOM node.
      }
    },
    { signal },
  );

  return {
    element: barElement,
    refresh(): void {
      // Check whether destroyed.
      if (destroyed) {
        return;
      } else {
        // Not destroyed.
      }

      // Check whether a menu is currently open: re-render to reflect new enabled/checked states.
      if (openTopIndex !== null) {
        const currentOpenIndex = openTopIndex;
        const openSpec = APP_MENU_BAR_SPEC[currentOpenIndex];
        // Check whether anything the open menu draws has changed. Editor transactions call refresh() constantly;
        // redrawing an unchanged menu would close an open submenu under the pointer, which reopens it on hover.
        if (openSpec !== undefined && menuSignature(openSpec.items, getCommandMap()) === openSignature) {
          // Unchanged: leave the open menus and their submenus exactly as they are.
          return;
        } else {
          // Changed (or the spec is missing): redraw below.
        }
        closeAllMenus(false);
        openMenu(currentOpenIndex, false);
      } else {
        // No menus currently open; nothing to redraw.
      }
    },
    destroy(): void {
      // Check whether already destroyed.
      if (destroyed) {
        return;
      } else {
        destroyed = true;
      }

      closeAllMenus(false);
      abortController.abort();

      // Detach menubar element from DOM.
      if (barElement.parentNode !== null) {
        barElement.parentNode.removeChild(barElement);
      } else {
        // Already detached.
      }
    },
  };
}
