/**
 * @file command-registry.ts
 * @purpose Defines the central command registry and fuzzy search filtering for all user-invokable K-Doc editor and shell commands (FR-9.8).
 * @inputs CommandRegistryDeps containing the active ProseMirror EditorView and application shell callbacks, search queries, and command collections.
 * @outputs buildCommandRegistry factory returning readonly KdocCommand array, filterCommands subsequence query filter, and public command interfaces.
 * @functions
 *   - buildCommandRegistry: Constructs the complete catalogue of user-invokable commands across File, Edit, Format, Insert, Table, View, and Find categories.
 *   - filterCommands: Filters commands via case-insensitive subsequence matching on combined category and label while preserving stable order.
 * @dataflow Command definitions / user search input -> buildCommandRegistry / filterCommands -> filtered command lists & executed actions.
 * @controlflow buildCommandRegistry instantiates command records via editorCommand and appCommand helpers -> filterCommands checks whitespace then performs subsequence matching -> commands execute actions and refocus editor view.
 * @version 40
 * @date 2026-10-06
 */

import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { ViewMode } from './editor-shell.js';
import {
  toggleKdocMark,
  clearFormatting,
  pickUpFormat,
  setParagraph,
  setHeading,
  setCodeBlock,
  toggleBlockquote,
  toggleList,
  toggleTask,
  insertThematicBreak,
  insertFootnote,
  insertTable,
  deleteTable,
  moveBlockUp,
  moveBlockDown,
  promoteHeading,
  demoteHeading,
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  setColumnAlign,
  duplicateRow,
  duplicateColumn,
  moveRow,
  moveColumn,
  sortTableByColumn,
  toggleHeaderRow,
  refreshTableOfContents,
  indentList,
  outdentList,
  indentBlock,
  outdentBlock,
  stepImageWidth,
  resetImageSize,
  setCallout,
  clearCallout,
  CALLOUT_KINDS,
} from '@k-doc/editor';

export type CommandCategory =
  | 'File'
  | 'Edit'
  | 'Format'
  | 'Insert'
  | 'Table'
  | 'View'
  | 'Find'
  | 'Review';

export interface KdocCommand {
  readonly id: string;
  readonly label: string;
  readonly category: CommandCategory;
  /** Human-readable shortcut, e.g. 'Ctrl+B'. Empty string when the command has none. */
  readonly shortcut: string;
  /** Runs the command. Returns false when it could not apply. */
  run(): boolean;
  /** Whether the command can run right now; drives the palette's disabled styling. */
  isEnabled(): boolean;
}

export interface CommandRegistryDeps {
  readonly view: EditorView;
  readonly newDocument: () => void;
  readonly closeDocument: () => void;
  readonly nextDocument: () => void;
  readonly openDocument: () => void;
  readonly saveDocument: () => void;
  readonly saveDocumentAs: () => void;
  /** Takes a local snapshot of the document now (FR-11.8). */
  readonly takeSnapshot: () => void;
  readonly exportHtml: () => void;
  readonly printDocument: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly zoomReset: () => void;
  readonly openSettings: () => void;
  /** Opens the Keyboard Shortcuts dialog (FR-14.16). */
  readonly openKeyboardShortcuts: () => void;
  /** Opens Help > About K-Doc. */
  readonly openAbout: () => void;
  /** Opens the autocorrect replacement table (FR-7.8). */
  readonly openReplacements: () => void;
  /** Opens the snippets editor (FR-7.10). */
  readonly openSnippets: () => void;
  /** Returns to where the caret was before the last jump (FR-9.10). */
  readonly goBack: () => void;
  /** Undoes a Go Back (FR-9.10). */
  readonly goForward: () => void;
  readonly cycleRibbon: () => void;
  readonly customiseRibbon: () => void;
  /** Opens the graph of which notes link to which (FR-6.15). */
  readonly showGraph: () => void;
  /** Asks for a folder and opens it as the vault (FR-6.11). */
  readonly openVault: () => void;
  /** Opens Windows Settings at K-Doc's Default apps page, where the user can make it open Markdown files. */
  readonly makeDefaultMarkdownApp: () => void;
  /** Opens another document in the second pane, beside the one being edited (FR-6.9). */
  readonly openDocumentBeside: () => void;
  /** Writes the document out in a format a plugin added (FR-14.18). */
  readonly exportThroughPlugin: () => void;
  /** Reads the plugins folder again and starts everything in it (FR-14.18). */
  readonly reloadPlugins: () => void;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly toggleTheme: () => void;
  readonly toggleOutline: () => void;
  /** Locks or unlocks Split view's scroll sync (the toolbar button that did this is no longer mounted). */
  readonly toggleSyncScroll: () => void;
  /** Hides or shows the status bar (and the breadcrumb and saved indicator it carries). */
  readonly toggleStatusBar: () => void;
  readonly openFind: () => void;
  readonly openLink: () => void;
  /** Opens the multi-level list gallery (FR-8.6). */
  readonly openListPicker: () => void;
  /** Opens the Styles gallery (FR-8.5). */
  readonly openStylesGallery: () => void;
  /** Opens the Open Recent list (FR-6.1). */
  readonly openRecent: () => void;
  /** Opens Quick Open, the fuzzy file switcher (FR-9.7). */
  readonly quickOpen: () => void;
  /** Opens Go To: a line in Source, a heading in WYSIWYG (FR-9.6). */
  readonly goTo: () => void;
  /** Asks for the minimum width of the table column under the caret (FR-8.26). */
  readonly setColumnWidth: () => void;
  /** Inserts a table of contents, asking for its depth, or refreshes the one the document has (FR-8.30). */
  readonly insertTableOfContents: () => void;
  /** Rewrites the document's inline links as reference links with definitions at the end (FR-8.16). */
  readonly convertToReferenceLinks: () => void;
  /** Opens the Link Definitions panel (FR-8.16). */
  readonly showLinkDefinitions: () => void;
  /** Opens the Version History dialog over the document's snapshots (FR-11.9). */
  readonly showVersionHistory: () => void;
  /** Compares two picked files as tracked changes in a new tab (FR-11.7). */
  readonly compareDocuments: () => void;
  /** Stages the saved document in its git repository (FR-11.11). */
  readonly gitStageFile: () => void;
  /** Commits just the saved document, asking for a message (FR-11.11). */
  readonly gitCommitFile: () => void;
  /** Focus mode at paragraph scope, on or off (FR-5.8). */
  readonly toggleFocusParagraph: () => void;
  /** Focus mode at sentence scope, on or off (FR-5.8). */
  readonly toggleFocusSentence: () => void;
  /** Typewriter mode on or off (FR-5.8). */
  readonly toggleTypewriter: () => void;
  /** Zen mode on or off: chrome hidden and the window full screen (FR-5.8). */
  readonly toggleZen: () => void;
  /** Shows the document as slides, split at --- rules (FR-5.9). */
  readonly startPresentation: () => void;
  readonly checkGrammar: () => void;
  /** Chooses the language the document's spelling is checked in (FR-12.3). */
  readonly chooseSpellingLanguage: () => void;
  readonly exportDocx: () => void;
  /** Exports the document as CommonMark, GFM or vault-portable Markdown (FR-13.6). */
  readonly exportMarkdown: () => void;
  /** Chooses the stylesheet exports and printouts are written with (FR-13.8). */
  readonly chooseExportTheme: () => void;
  /** Exports the document through Pandoc, when Pandoc is on PATH (FR-13.7). */
  readonly exportThroughPandoc: (format: 'latex' | 'epub') => void;
  /** Aligns every selected paragraph and heading, or clears the alignment when given null (FR-8.11). */
  readonly alignBlocks: (align: 'left' | 'center' | 'right' | null) => void;
  /** Opens a report of the attachments no note refers to (FR-6.14). */
  readonly reportUnusedAttachments: () => void;
  /** Opens the folder holding the reader's own export themes (FR-13.8). */
  readonly openExportThemeFolder: () => void;
  /** Chooses a theme of the reader's own for the app itself (FR-14.10). */
  readonly chooseAppTheme: () => void;
  /** Opens the folder holding the reader's own app themes (FR-14.10). */
  readonly openAppThemeFolder: () => void;
  /** Converts a Word, HTML, RTF or text file into a new Markdown document (FR-13.5). */
  readonly importDocument: () => void;
  readonly bundleAnnotations: () => void;
  readonly toggleSecondaryPane: () => void;
  readonly unlockDocument: () => void;
  readonly cycleDocumentWidth: () => void;
  readonly cycleDocumentDensity: () => void;
  readonly clearDocumentDisplay: () => void;
  /** Folds or unfolds the section or list item at the caret in the focused pane (FR-8.29). */
  readonly toggleFold: () => void;
  /** Moves the section at the caret into a new untitled document (FR-8.31). */
  readonly splitAtHeading: () => void;
  /** Appends a Markdown file the user picks to the end of the document (FR-8.31). */
  readonly mergeDocument: () => void;
  /** Folds every heading section (FR-8.29). */
  readonly foldAllHeadings: () => void;
  /** Unfolds everything (FR-8.29). */
  readonly unfoldAll: () => void;
  /** Opens the Paste Special dialog (FR-7.4). */
  readonly pasteSpecial: () => void;
  /** Opens the page-setup dialog, which prints on accept (FR-13.2). */
  readonly pageSetup: () => void;
  /** Writes the document to a second file, leaving this one open (FR-6.1). */
  readonly saveACopy: () => void;
  /** Renames the file on disk and follows it (FR-6.1). */
  readonly renameDocument: () => void;
  /** Shows the file in the system file manager (FR-6.1). */
  readonly revealDocument: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly checkSpelling: () => void;
  readonly toggleSpellCheck: () => void;
  readonly insertImage: () => void;
  readonly insertTable: () => void;
  readonly setCodeLanguage: () => void;
  readonly showStatistics: () => void;
  readonly pasteAsPlainText: () => void;
  readonly copyAsMarkdown: () => void;
  readonly copyAsHtml: () => void;
  /** Opens the command palette (FR-14.2). */
  readonly openCommandPalette: () => void;
  /** Moves to the next view mode (FR-5.7). */
  readonly cycleViewMode: () => void;
  /** Collapses or reopens the left sidebar (FR-14.6). */
  readonly toggleSidebar: () => void;
  /** Collapses the right panel, or reopens it on the panel it last showed (FR-20.2). */
  readonly toggleRightPanel: () => void;
  /** Opens the find bar in replace mode (FR-9.3). */
  readonly openReplace: () => void;
  /** Opens the vault Search panel with its query focused (FR-9.5). */
  readonly findInVault: () => void;
  /** Starts a comment on the selection (FR-10.1). */
  readonly newComment: () => void;
  /** Turns track changes on or off (FR-11.1). */
  readonly toggleTrackChanges: () => void;
}

/**
 * Constructs the single catalogue of every user-invokable command in K-Doc, wiring editor commands to ProseMirror and application actions to shell callbacks.
 *
 * @purpose Builds the complete registry of user-invokable commands across File, Edit, Format, Insert, Table, View, and Find categories.
 * @inputs deps: CommandRegistryDeps - Dependencies providing the ProseMirror EditorView and application shell callbacks.
 * @outputs readonly KdocCommand[] - The complete array of registered commands.
 * @dataflow deps -> command helper closures (editorCommand, appCommand) -> populated KdocCommand array.
 * @controlflow Initialize command list -> define local editorCommand and appCommand helpers -> register File, Edit, Format (including headings 1..6 loop), Insert, Table, View, and Find commands -> return command array.
 */
export function buildCommandRegistry(deps: CommandRegistryDeps): readonly KdocCommand[] {
  /**
   * Helper constructing an editor command backed by a ProseMirror Command function.
   *
   * @purpose Creates a KdocCommand executing a ProseMirror command against the view state and dispatch callback, restoring focus afterwards.
   * @inputs
   *   - id: string - Unique identifier for the command.
   *   - label: string - Display label for the command.
   *   - category: CommandCategory - Category group for the command.
   *   - shortcut: string - Human-readable shortcut string.
   *   - command: Command - The underlying ProseMirror Command to execute.
   * @outputs KdocCommand - Configured editor command instance.
   * @dataflow command -> KdocCommand run/isEnabled methods closed over deps.view.
   * @controlflow Invokes command with state and dispatch in run() -> refocuses view -> returns applicability boolean; dry-runs in isEnabled().
   */
  function editorCommand(
    id: string,
    label: string,
    category: CommandCategory,
    shortcut: string,
    command: Command,
  ): KdocCommand {
    return {
      id,
      label,
      category,
      shortcut,
      run(): boolean {
        // The view is passed as ProseMirror's own third argument so a command that has to measure what is
        // on screen - stepping a picture's width from the size it is drawn at (FR-8.15) - can reach it.
        const applied = command(deps.view.state, deps.view.dispatch, deps.view);
        // Focus must return to the pane because K-Doc keys its edit lock on which pane holds focus,
        // so leaving focus on the palette would make the next keystroke throw.
        deps.view.focus();
        return applied;
      },
      isEnabled(): boolean {
        // Dry-run execution without dispatch callback queries whether the command can apply to the current editor state.
        return command(deps.view.state, undefined, deps.view);
      },
    };
  }

  /**
   * Helper constructing an application-level command backed by a shell callback.
   *
   * @purpose Creates a KdocCommand executing an application shell action callback.
   * @inputs
   *   - id: string - Unique identifier for the command.
   *   - label: string - Display label for the command.
   *   - category: CommandCategory - Category group for the command.
   *   - shortcut: string - Human-readable shortcut string.
   *   - action: () => void - Shell action callback to invoke.
   * @outputs KdocCommand - Configured application command instance.
   * @dataflow action -> KdocCommand run/isEnabled methods.
   * @controlflow Invokes action() and returns true in run(); always returns true in isEnabled().
   */
  function appCommand(
    id: string,
    label: string,
    category: CommandCategory,
    shortcut: string,
    action: () => void,
  ): KdocCommand {
    return {
      id,
      label,
      category,
      shortcut,
      run(): boolean {
        action();
        return true;
      },
      isEnabled(): boolean {
        // App-level actions such as Save have no ProseMirror dry-run form, so they are always offered and report their own failures.
        return true;
      },
    };
  }

  const commands: KdocCommand[] = [
    // File
    appCommand('file:new', 'New', 'File', 'Ctrl+N', deps.newDocument),
    appCommand('file:open', 'Open', 'File', 'Ctrl+O', deps.openDocument),
    appCommand('file:close', 'Close Document', 'File', 'Ctrl+W', deps.closeDocument),
    appCommand('file:next', 'Next Document', 'File', 'Ctrl+Tab', deps.nextDocument),
    appCommand('file:save', 'Save', 'File', 'Ctrl+S', deps.saveDocument),
    appCommand('file:open-recent', 'Open Recent', 'File', '', deps.openRecent),
    appCommand('file:quick-open', 'Quick Open', 'File', 'Ctrl+Shift+O', deps.quickOpen),
    appCommand('file:save-as', 'Save As', 'File', 'Ctrl+Shift+S', deps.saveDocumentAs),
    appCommand('file:take-snapshot', 'Take Snapshot', 'File', '', deps.takeSnapshot),
    appCommand('file:save-a-copy', 'Save a Copy', 'File', '', deps.saveACopy),
    appCommand('file:rename', 'Rename', 'File', 'F2', deps.renameDocument),
    appCommand('file:reveal', 'Reveal in File Explorer', 'File', '', deps.revealDocument),
    appCommand('file:export-html', 'Export as HTML', 'File', '', deps.exportHtml),
    appCommand('file:export-docx', 'Export as Word Document', 'File', '', deps.exportDocx),
    appCommand('file:export-markdown', 'Export as Markdown Flavour', 'File', '', deps.exportMarkdown),
    appCommand('file:export-theme', 'Export Theme', 'File', '', deps.chooseExportTheme),
    appCommand('file:export-latex', 'Export as LaTeX', 'File', '', (): void => {
      deps.exportThroughPandoc('latex');
    }),
    appCommand('file:export-epub', 'Export as EPUB', 'File', '', (): void => {
      deps.exportThroughPandoc('epub');
    }),
    appCommand('file:unused-attachments', 'Unused Attachments Report', 'File', '', deps.reportUnusedAttachments),
    appCommand('file:export-theme-folder', 'Open Export Themes Folder', 'File', '', deps.openExportThemeFolder),
    appCommand('view:app-theme', 'App Theme', 'View', '', deps.chooseAppTheme),
    appCommand('view:app-theme-folder', 'Open App Themes Folder', 'View', '', deps.openAppThemeFolder),
    appCommand('file:import', 'Import Document', 'File', '', deps.importDocument),
    appCommand('file:page-setup', 'Page Setup', 'File', '', deps.pageSetup),
    appCommand('file:print', 'Print', 'File', 'Ctrl+P', deps.printDocument),

    // Edit
    appCommand('edit:undo', 'Undo', 'Edit', 'Ctrl+Z', deps.undo),
    appCommand('edit:redo', 'Redo', 'Edit', 'Ctrl+Y', deps.redo),

    // Format
    editorCommand('format:bold', 'Bold', 'Format', 'Ctrl+B', toggleKdocMark('strong')),
    editorCommand('format:italic', 'Italic', 'Format', 'Ctrl+I', toggleKdocMark('emphasis')),
    editorCommand('format:strikethrough', 'Strikethrough', 'Format', 'Ctrl+Shift+X', toggleKdocMark('strikethrough')),
    editorCommand('format:highlight', 'Highlight', 'Format', 'Ctrl+Alt+H', toggleKdocMark('highlight')),
    editorCommand('format:subscript', 'Subscript', 'Format', 'Ctrl+=', toggleKdocMark('subscript')),
    editorCommand('format:superscript', 'Superscript', 'Format', 'Ctrl+Shift+=', toggleKdocMark('superscript')),
    editorCommand('format:inline-code', 'Inline Code', 'Format', 'Ctrl+E', toggleKdocMark('inlineCode')),
    editorCommand('format:clear-formatting', 'Clear Formatting', 'Format', 'Ctrl+Space', clearFormatting()),
    appCommand('format:align-left', 'Align Left', 'Format', '', (): void => {
      deps.alignBlocks('left');
    }),
    appCommand('format:align-centre', 'Align Centre', 'Format', '', (): void => {
      deps.alignBlocks('center');
    }),
    appCommand('format:align-right', 'Align Right', 'Format', '', (): void => {
      deps.alignBlocks('right');
    }),
    appCommand('format:align-none', 'Remove Alignment', 'Format', '', (): void => {
      deps.alignBlocks(null);
    }),
    editorCommand('format:format-painter', 'Format Painter', 'Format', 'Ctrl+Shift+C', pickUpFormat(false)),
    editorCommand('format:normal-text', 'Normal Text', 'Format', 'Ctrl+Alt+0', setParagraph()),
  ];

  // Headings 1 through 6 registered sequentially via a loop over levels 1..6.
  const headingLevels: readonly [1, 2, 3, 4, 5, 6] = [1, 2, 3, 4, 5, 6];
  for (let i = 0; i < headingLevels.length; i++) {
    const level = headingLevels[i];
    // Check if heading level is defined to satisfy strict noUncheckedIndexedAccess.
    if (level === undefined) {
      // Undefined level: skip iteration.
      continue;
    } else {
      // Valid heading level: register editor command with corresponding level and shortcut.
    }
    commands.push(
      editorCommand(
        `format:heading-${level}`,
        `Heading ${level}`,
        'Format',
        `Ctrl+Alt+${level}`,
        setHeading(level),
      ),
    );
  }

  commands.push(
    editorCommand('format:code-block', 'Code Block', 'Format', 'Ctrl+Alt+C', setCodeBlock()),
    editorCommand('format:blockquote', 'Blockquote', 'Format', 'Ctrl+Shift+Q', toggleBlockquote()),
    editorCommand('format:bullet-list', 'Bullet List', 'Format', 'Ctrl+Shift+8', toggleList('bullet')),
    editorCommand('format:numbered-list', 'Numbered List', 'Format', 'Ctrl+Shift+7', toggleList('ordered')),
    editorCommand('format:task-list', 'Task List', 'Format', 'Ctrl+Shift+9', toggleTask()),
    editorCommand('format:increase-list-level', 'Increase List Level', 'Format', 'Tab', indentList()),
    editorCommand('format:decrease-list-level', 'Decrease List Level', 'Format', 'Shift+Tab', outdentList()),
    // Indent and Outdent are the same operation reached from anywhere: inside a list they nest the item,
    // and outside one they use the only indentation Markdown has, which is a blockquote.
    editorCommand('format:indent', 'Indent', 'Format', 'Ctrl+M', indentBlock()),
    editorCommand('format:outdent', 'Outdent', 'Format', 'Ctrl+Shift+M', outdentBlock()),
    // Resizing a picture without a mouse (FR-8.15). Each step is a tenth of what the picture is currently
    // drawn at, so a picture that has never been resized has somewhere to start from.
    editorCommand('format:widen-image', 'Widen Image', 'Format', 'Alt+Shift+Right', stepImageWidth(true)),
    editorCommand('format:narrow-image', 'Narrow Image', 'Format', 'Alt+Shift+Left', stepImageWidth(false)),
    editorCommand('format:reset-image-size', 'Reset Image Size', 'Format', '', resetImageSize()),
    appCommand('format:styles-gallery', 'Styles Gallery', 'Format', '', deps.openStylesGallery),
    ...CALLOUT_KINDS.map((kind) =>
      editorCommand(
        `format:callout-${kind}`,
        `Callout: ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
        'Format',
        '',
        setCallout(kind),
      ),
    ),
    editorCommand('format:clear-callout', 'Remove Callout', 'Format', '', clearCallout()),
    appCommand('format:list-gallery', 'Multi-level List Gallery', 'Format', '', deps.openListPicker),
    editorCommand('format:move-block-up', 'Move Block Up', 'Format', 'Alt+Up', moveBlockUp()),
    editorCommand('format:move-block-down', 'Move Block Down', 'Format', 'Alt+Down', moveBlockDown()),
    editorCommand('format:promote-heading', 'Promote Heading', 'Format', 'Ctrl+Alt+Left', promoteHeading()),
    editorCommand('format:demote-heading', 'Demote Heading', 'Format', 'Ctrl+Alt+Right', demoteHeading()),

    // Insert
    appCommand('insert:link', 'Link', 'Insert', 'Ctrl+K', deps.openLink),
    editorCommand('insert:horizontal-rule', 'Horizontal Rule', 'Insert', 'Ctrl+Shift+-', insertThematicBreak()),
    editorCommand('insert:footnote', 'Footnote', 'Insert', '', insertFootnote()),
    editorCommand('insert:table', 'Table', 'Insert', 'Ctrl+Alt+T', insertTable(3, 3)),

    // Table
    editorCommand('table:insert-row-above', 'Insert Row Above', 'Table', '', addRowBefore()),
    editorCommand('table:insert-row-below', 'Insert Row Below', 'Table', '', addRowAfter()),
    editorCommand('table:delete-row', 'Delete Row', 'Table', '', deleteRow()),
    editorCommand('table:duplicate-row', 'Duplicate Row', 'Table', '', duplicateRow()),
    editorCommand('table:move-row-up', 'Move Row Up', 'Table', '', moveRow(-1)),
    editorCommand('table:move-row-down', 'Move Row Down', 'Table', '', moveRow(1)),
    editorCommand('table:sort-ascending', 'Sort Column Ascending', 'Table', '', sortTableByColumn('ascending')),
    editorCommand('table:sort-descending', 'Sort Column Descending', 'Table', '', sortTableByColumn('descending')),
    editorCommand('table:toggle-header-row', 'Toggle Header Row', 'Table', '', toggleHeaderRow()),
    appCommand('table:column-width', 'Column Width…', 'Table', '', deps.setColumnWidth),
    appCommand('insert:table-of-contents', 'Table of Contents…', 'Insert', '', deps.insertTableOfContents),
    appCommand('insert:convert-reference-links', 'Convert to Reference Links', 'Insert', '', deps.convertToReferenceLinks),
    appCommand('view:link-definitions', 'Link Definitions', 'View', '', deps.showLinkDefinitions),
    appCommand('view:version-history', 'Version History…', 'View', '', deps.showVersionHistory),
    appCommand('edit:compare-documents', 'Compare Documents…', 'Edit', '', deps.compareDocuments),
    appCommand('file:git-stage', 'Git: Stage File', 'File', '', deps.gitStageFile),
    appCommand('file:git-commit', 'Git: Commit File…', 'File', '', deps.gitCommitFile),
    appCommand('view:focus-paragraph', 'Focus Mode: Paragraph', 'View', '', deps.toggleFocusParagraph),
    appCommand('view:focus-sentence', 'Focus Mode: Sentence', 'View', '', deps.toggleFocusSentence),
    appCommand('view:typewriter', 'Typewriter Mode', 'View', '', deps.toggleTypewriter),
    appCommand('view:zen', 'Zen Mode', 'View', '', deps.toggleZen),
    appCommand('view:presentation', 'Start Presentation', 'View', '', deps.startPresentation),
    appCommand('proofing:grammar', 'Check Grammar', 'Review', '', deps.checkGrammar),
    appCommand('proofing:language', 'Spelling Language', 'Review', '', deps.chooseSpellingLanguage),
    appCommand('comments:bundle', 'Bundle Annotations into File', 'Review', '', deps.bundleAnnotations),
    appCommand('view:second-pane', 'Second Pane on This Document', 'View', '', deps.toggleSecondaryPane),
    appCommand('file:unlock', 'Unlock Document', 'File', '', deps.unlockDocument),
    appCommand('view:document-width', 'Reading Width for This Document', 'View', '', deps.cycleDocumentWidth),
    appCommand('view:document-density', 'Display Density for This Document', 'View', '', deps.cycleDocumentDensity),
    appCommand('view:document-display-reset', 'Use the Settings Width and Density', 'View', '', deps.clearDocumentDisplay),
    editorCommand('insert:refresh-table-of-contents', 'Refresh Table of Contents', 'Insert', '', refreshTableOfContents()),
    editorCommand('table:insert-column-left', 'Insert Column Left', 'Table', '', addColumnBefore()),
    editorCommand('table:insert-column-right', 'Insert Column Right', 'Table', '', addColumnAfter()),
    editorCommand('table:delete-column', 'Delete Column', 'Table', '', deleteColumn()),
    editorCommand('table:duplicate-column', 'Duplicate Column', 'Table', '', duplicateColumn()),
    editorCommand('table:move-column-left', 'Move Column Left', 'Table', '', moveColumn(-1)),
    editorCommand('table:move-column-right', 'Move Column Right', 'Table', '', moveColumn(1)),
    editorCommand('table:align-column-left', 'Align Column Left', 'Table', '', setColumnAlign('left')),
    editorCommand('table:align-column-center', 'Align Column Center', 'Table', '', setColumnAlign('center')),
    editorCommand('table:align-column-right', 'Align Column Right', 'Table', '', setColumnAlign('right')),
    editorCommand('table:delete-table', 'Delete Table', 'Table', '', deleteTable()),

    // View
    appCommand('view:wysiwyg', 'WYSIWYG', 'View', '', (): void => {
      deps.setViewMode('wysiwyg');
    }),
    appCommand('view:split', 'Split', 'View', '', (): void => {
      deps.setViewMode('split');
    }),
    appCommand('view:source', 'Source', 'View', '', (): void => {
      deps.setViewMode('source');
    }),
    appCommand('view:preview', 'Preview', 'View', '', (): void => {
      deps.setViewMode('preview');
    }),
    appCommand('view:toggle-outline', 'Toggle Outline', 'View', '', deps.toggleOutline),
    appCommand('view:toggle-sync-scroll', 'Sync Scroll', 'View', '', deps.toggleSyncScroll),
    appCommand('view:toggle-status-bar', 'Status Bar', 'View', '', deps.toggleStatusBar),
    appCommand('view:toggle-fold', 'Toggle Fold', 'View', '', deps.toggleFold),
    appCommand('view:fold-all', 'Fold All Headings', 'View', '', deps.foldAllHeadings),
    appCommand('view:unfold-all', 'Unfold All', 'View', '', deps.unfoldAll),
    appCommand('view:toggle-theme', 'Toggle Theme', 'View', '', deps.toggleTheme),
    appCommand('view:zoom-in', 'Zoom In', 'View', 'Ctrl+Shift+>', deps.zoomIn),
    appCommand('view:zoom-out', 'Zoom Out', 'View', 'Ctrl+Shift+<', deps.zoomOut),
    appCommand('view:zoom-reset', 'Reset Zoom', 'View', 'Ctrl+0', deps.zoomReset),
    appCommand('view:settings', 'Settings', 'View', 'Ctrl+,', deps.openSettings),
    appCommand('view:keyboard-shortcuts', 'Keyboard Shortcuts', 'View', '', deps.openKeyboardShortcuts),
    appCommand('help:about', 'About K-Doc', 'View', '', deps.openAbout),
    appCommand('view:autocorrect-replacements', 'Autocorrect Replacements…', 'View', '', deps.openReplacements),
    appCommand('view:snippets', 'Snippets…', 'View', '', deps.openSnippets),
    appCommand('view:ribbon', 'Cycle Ribbon', 'View', 'Ctrl+F1', deps.cycleRibbon),
    appCommand('view:customise-ribbon', 'Customise Ribbon…', 'View', '', deps.customiseRibbon),
    appCommand('view:graph', 'Graph…', 'View', '', deps.showGraph),
    appCommand('vault:open', 'Open Vault Folder…', 'File', '', deps.openVault),
    appCommand('file:default-markdown-app', 'Make K-Doc the Default for Markdown…', 'File', '', deps.makeDefaultMarkdownApp),
    appCommand('view:document-beside', 'Another Document Beside This One…', 'View', '', deps.openDocumentBeside),
    appCommand('view:reload-plugins', 'Reload Plugins', 'View', '', deps.reloadPlugins),
    appCommand('file:export-plugin', 'Export with a Plugin…', 'File', '', deps.exportThroughPlugin),

    // Find
    appCommand('find:open', 'Find', 'Find', 'Ctrl+F', deps.openFind),
    appCommand('find:go-to', 'Go To', 'Find', 'Ctrl+G', deps.goTo),
    appCommand('nav:back', 'Go Back', 'Find', 'Alt+Left', deps.goBack),
    appCommand('nav:forward', 'Go Forward', 'Find', 'Alt+Right', deps.goForward),
    appCommand('find:replace', 'Replace', 'Find', 'Ctrl+H', deps.openReplace),
    appCommand('find:in-vault', 'Find in Vault', 'Find', 'Ctrl+Shift+F', deps.findInVault),
    appCommand('view:command-palette', 'Command Palette', 'View', 'Ctrl+Shift+P', deps.openCommandPalette),
    appCommand('view:cycle-view-mode', 'Cycle View Mode', 'View', 'Ctrl+/', deps.cycleViewMode),
    appCommand('view:toggle-sidebar', 'Toggle Sidebar', 'View', 'Ctrl+Shift+B', deps.toggleSidebar),
    appCommand('view:toggle-right-panel', 'Toggle Right Panel', 'View', 'Ctrl+Shift+R', deps.toggleRightPanel),
    appCommand('review:new-comment', 'New Comment', 'Review', 'Ctrl+Alt+M', deps.newComment),
    appCommand('review:toggle-track-changes', 'Toggle Track Changes', 'Review', 'Ctrl+Shift+E', deps.toggleTrackChanges),
  );

  // The three insert affordances. Each opens a chooser rather than inserting something fixed, so they
  // are app commands: the editor command underneath needs an argument only the user can supply.
  commands.push(
    appCommand('insert:image', 'Image\u2026', 'Insert', '', deps.insertImage),
    appCommand('insert:table-picker', 'Table\u2026', 'Insert', '', deps.insertTable),
    appCommand('insert:code-language', 'Code Block Language\u2026', 'Insert', '', deps.setCodeLanguage),
  );

  // Clipboard commands that the browser cannot express as an editor command, because a ProseMirror
  // command runs against a state and has no access to a clipboard.
  commands.push(
    appCommand('edit:paste-special', 'Paste Special', 'Edit', 'Ctrl+Alt+V', deps.pasteSpecial),
    appCommand('edit:paste-plain', 'Paste as Plain Text', 'Edit', 'Ctrl+Shift+V', deps.pasteAsPlainText),
    appCommand('edit:copy-markdown', 'Copy as Markdown', 'Edit', '', deps.copyAsMarkdown),
    appCommand('edit:copy-html', 'Copy as HTML', 'Edit', '', deps.copyAsHtml),
    appCommand('edit:split-at-heading', 'Split Document at Heading', 'Edit', '', deps.splitAtHeading),
    appCommand('edit:merge-document', 'Merge Document…', 'Edit', '', deps.mergeDocument),
  );

  // Review is its own category rather than a corner of View, because the menu bar builds its
  // submenus from this field: putting proofing under View would file Spelling next to Zoom.
  commands.push(
    appCommand('spell:check', 'Spelling…', 'Review', 'F7', deps.checkSpelling),
    appCommand('spell:toggle', 'Toggle Spell Check', 'Review', '', deps.toggleSpellCheck),
    appCommand('review:statistics', 'Statistics…', 'Review', '', deps.showStatistics),
  );

  return commands;
}

/**
 * Filters a list of commands using case-insensitive subsequence (fuzzy) matching against combined category and label strings.
 *
 * @purpose Filters commands by matching query characters in sequence against command category and label while maintaining stable order.
 * @inputs
 *   - commands: readonly KdocCommand[] - The list of commands to filter.
 *   - query: string - The search query string entered by the user.
 * @outputs readonly KdocCommand[] - Filtered array of matching commands in original stable order.
 * @dataflow commands + query -> whitespace check -> per-command haystack construction -> subsequence character matching -> filtered command list.
 * @controlflow Return commands unchanged if query is empty/whitespace -> iterate each command -> construct haystack -> walk non-whitespace query characters in sequence -> collect matching commands -> return filtered list.
 */
export function filterCommands(
  commands: readonly KdocCommand[],
  query: string,
): readonly KdocCommand[] {
  const trimmed = query.trim();
  // Check whether the query is empty or consists solely of whitespace.
  if (trimmed.length === 0) {
    // Empty or whitespace-only query: return the full command list unchanged.
    return commands;
  } else {
    // Query contains non-whitespace characters: proceed to filter commands using subsequence matching.
  }

  const filtered: KdocCommand[] = [];
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    // Check if the command element at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (command === undefined) {
      // Command element is undefined: skip iteration.
      continue;
    } else {
      // Command element is defined: proceed with subsequence matching against haystack.
    }

    const haystack = `${command.category} ${command.label}`.toLowerCase();
    let haystackIndex = 0;
    let matches = true;

    for (let q = 0; q < lowerQuery.length; q++) {
      const char = lowerQuery[q];
      // Check if the query character at index q is defined to satisfy strict noUncheckedIndexedAccess.
      if (char === undefined) {
        // Query character is undefined: skip iteration.
        continue;
      } else {
        // Query character is defined: check if it represents whitespace or a search character.
      }

      // Check if the current query character is whitespace.
      // Whitespace in the query is skipped so "hed 2" still finds "Heading 2".
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        // Skip whitespace character in query without advancing haystack index.
        continue;
      } else {
        // Non-whitespace character: test against remaining haystack.
      }

      const foundIndex = haystack.indexOf(char, haystackIndex);
      // Check if the query character exists in the remaining portion of the haystack.
      if (foundIndex === -1) {
        // Character not found in order: command fails subsequence match.
        matches = false;
        break;
      } else {
        // Character found: advance haystack index past the matched character for strict subsequence ordering.
        haystackIndex = foundIndex + 1;
      }
    }

    // Check if all non-whitespace query characters were found in sequential order.
    if (matches) {
      // Stable order matters: a palette that reshuffles as you type makes the entry you were aiming for move out from under the cursor.
      filtered.push(command);
    } else {
      // Command does not match query: omit from results.
    }
  }

  return filtered;
}
