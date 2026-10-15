/**
 * @file editor-shell.ts
 * @purpose Implements EditorShell, the K-Doc Material 3 Expressive application shell coordinating toolbar controls, dual synchronized editor panes (K-Doc and Source), theme switching, and live status bar readouts over a shared DocumentSession.
 * @inputs EditorShellOptions containing DOM mount container, initial Markdown source text, optional initial ViewMode ('kdoc' | 'split' | 'source'), and optional initial ThemeMode ('light' | 'dark' | 'system').
 * @outputs EditorShell instance exposing the authoritative DocumentSession, setViewMode layout controller, and destroy lifecycle teardown method.
 * @functions
 *   - EditorShell: Constructor initializing stylesheet injection, theme controller, in-app menu bar, DOM elements, DocumentSession, editor bindings, session subscription, and initial view mode.
 *   - session getter: Returns the underlying DocumentSession instance.
 *   - setViewMode: Toggles pane visibility and button states, transferring focus if the active edit lock holder is hidden.
 *   - destroy: Idempotently cleans up session subscriptions, editor bindings, theme controllers, and mount container children.
 *   - cycleTheme: Cycles active theme mode (system -> light -> dark -> system) and saves it.
 *   - chooseAppearance: Applies and saves a mode or built-in UI theme picked from the theme menu.
 *   - formatThemeMode: Formats a ThemeMode into a human-readable title-cased button label.
 *   - showMessage: Displays a transient message in the status bar live region.
 *   - refreshStatusBar: Updates status bar indicators for dirty state, word count, reading time, focused pane, and view mode.
 * @dataflow User interaction & DocumentSession changes -> EditorShell state updates -> ProseMirror & CodeMirror view updates -> status bar DOM mutations.
 * @controlflow Inject static stylesheet once -> initialize theme controller -> construct DOM hierarchy (toolbar with integrated app menu bar, tab bar, ribbon, panes, status bar) -> create DocumentSession & bindings -> subscribe to session changes -> route contextual table tab -> apply initial view mode -> focus ProseMirror pane -> return EditorShell instance.
 * @version 68
 * @date 2026-10-07
 */

import { DocumentSession } from '@k-doc/core';
import { CodeMirrorBinding, ProseMirrorBinding, setLink, createSpellPlugin, type LinkAttrs, type LinkRange, type WordSpan } from '@k-doc/editor';
import type { ThemeMode } from '@k-doc/config';
import type { AppearanceSettings, UiThemeId } from '@k-doc/config';
import { installThemeMenu, THEME_MENU_STYLES, type ThemeMenu } from './theme-menu.js';
import { installTheme, type ThemeController } from './theme.js';
import { createFileService, type FileService, type OpenedFile } from '../files/file-service.js';
import { installFileMenu, type FileMenu } from '../files/file-menu.js';
import { installAutosave, type Autosave } from '../files/autosave.js';
import { createJournalStore, type JournalStore } from '../files/journal.js';
import { installRecovery, pickRecoverable, describeRecord, type Recovery } from '../files/recovery.js';
import type { JournalRecord } from '../files/journal.js';
import { installCloseGuard, tauriCloseRequests } from './close-guard.js';
import { emit, listen } from '@tauri-apps/api/event';
import { installExternalWatch, type ExternalWatch, type ConflictResolution } from '../files/external-watch.js';
import { createWindowHandoff, type WindowHandoff } from '../files/window-handoff.js';
import { createVaultService, type VaultService } from '../files/vault-service.js';
import { installFilesPanel, FILES_PANEL_STYLES, type FilesPanel } from './files-panel.js';
import { installLinkHoverCard, LINK_HOVER_CARD_STYLES, type LinkCardContent, type LinkHoverCard } from './link-hover-card.js';
import { canonicalFilePath, classifyLink, findHeadingBySlug, type LinkContext } from './link-target.js';
import { createExternalOpener, type ExternalOpener } from '../files/external-links.js';
import { defaultLaunchFiles, openLaunchFiles, type LaunchFiles } from '../files/launch-files.js';
import { hasInstalledGuide, installedGuidePath, ONLINE_GUIDE_URL } from '../files/user-guide.js';
import { installBacklinksPanel, BACKLINKS_PANEL_STYLES, type BacklinksPanel } from './backlinks-panel.js';
import { installHistoryPanel, HISTORY_PANEL_STYLES, type HistoryPanel } from './history-panel.js';
import {
  installMetadataPanel,
  METADATA_PANEL_STYLES,
  type MetadataPanel,
  type MetadataStatistics,
} from './metadata-panel.js';
import {
  installProblemsPanel,
  PROBLEMS_PANEL_STYLES,
  type Problem,
  type ProblemFix,
  type ProblemKind,
  type ProblemsPanel,
} from './problems-panel.js';
import { installLinkDefinitionsPanel, LINK_DEFINITIONS_PANEL_STYLES, type LinkDefinitionsPanel } from './link-definitions-panel.js';
import { convertToReferenceLinks, linkDefinitions } from '@k-doc/core';
import { installSearchPanel, SEARCH_PANEL_STYLES, type SearchPanel } from './search-panel.js';
import { createVaultSearchController, type VaultSearchController } from './vault-search-controller.js';
import { planVaultSaveSync } from '../files/vault-save-sync.js';
import { installTagsPanel, TAGS_PANEL_STYLES, type TagsPanel } from './tags-panel.js';
import { installFileDrop, type FileDrop, type DroppedInsert } from '../files/file-drop.js';
import { saveHtmlExport, printDocument, DEFAULT_PAGE_SETUP, type PageSetup } from '../files/export.js';
import { installPopupMenu, POPUP_MENU_STYLES, type PopupMenu, type PopupMenuEntry } from './popup-menu.js';
import { installContextMenu, type ContextMenu } from './context-menu.js';
import { installSlashMenu, type SlashMenu } from './slash-menu.js';
import { applyTypography, zoomIn, zoomOut, clampZoom, DEFAULT_ZOOM, TYPOGRAPHY_STYLES } from './typography.js';
import { DEFAULT_SETTINGS, type KdocSettings } from '@k-doc/config';
import { DEFAULT_TOC_DEPTH } from '@k-doc/core';
import { vaultGraph, type VaultGraph, type PluginSyntax } from '@k-doc/core';
import type { CommentNoteOptions } from '@k-doc/core';
import { bundleComments, extractComments, hasCommentBundle } from '@k-doc/core';
import type { CommentThread, GrammarIssue } from '@k-doc/core';
import { checkGrammar } from '../spell/grammar-service.js';
import { exportDocx } from '../files/docx-export.js';
import { createFoldPlugin, toggleFoldCommand, FOLD_STYLES } from '@k-doc/editor';
import { createFormatPainterPlugin, FORMAT_PAINTER_STYLES } from '@k-doc/editor';
import { FOOTNOTE_STYLES, IMAGE_VIEW_STYLES, MEDIA_VIEW_STYLES } from '@k-doc/editor';
import { createAutocorrectPlugin, PROSEMIRROR_BASE_STYLES, type AutocorrectOptions } from '@k-doc/editor';
import { createSnippetPlugin, SNIPPET_STYLES, type SnippetOptions } from '@k-doc/editor';
import { installReplacementsDialog, REPLACEMENTS_DIALOG_STYLES, type ReplacementsDialog } from './replacements-dialog.js';
import { DEFAULT_AUTOCORRECT_REPLACEMENTS, DEFAULT_SNIPPETS } from '@k-doc/config';
import { installSnippetsDialog, SNIPPETS_DIALOG_STYLES, type SnippetsDialog } from './snippets-dialog.js';
import { createFoldSync, type FoldSync } from './fold-sync.js';
import { clearFolds, loadFolds, saveFolds } from './fold-state.js';
import {
  clearSession,
  loadSession,
  saveSession,
  type PersistedPanel,
  type PersistedSession,
} from './session-state.js';
import {
  effectiveAppearance,
  loadDisplayOverride,
  nextDensity,
  nextReadingWidth,
  saveDisplayOverride,
  type DisplayOverride,
} from './display-overrides.js';
import { UNBOUND_SHORTCUT_EXPLANATIONS, formatChord, resolveKeymap, scopeOf, type ResolvedKeymap } from '@k-doc/config';
import { installKeymapService, type KeymapService } from './keymap-service.js';
import { focusContextOf } from './keymap-scope.js';
import { installKeyHint, KEY_HINT_STYLES, type KeyHint } from './key-hint.js';
import {
  analyzeText,
  brokenLinks,
  countWords,
  extractInlineLinks,
  localImages,
  wikiEmbedTargets,
  type KdocDocument,
  extractWikiLinks,
  type Backlink,
  type HistoryEntry,
  type NoteLink,
  attachmentFileName,
  attachmentReferences,
  unusedAttachments,
} from '@k-doc/core';
import { buildOutline, moveSection, mergeDocumentText, sectionIndexAtOffset, splitSection } from '@k-doc/core';
import { sectionIndexAtCaret } from '@k-doc/editor';
import { createWritingModesPlugin, refreshWritingModes, refreshWritingModesIn, writingModes, TYPEWRITER_CLASS, WRITING_MODE_STYLES, type WritingModes } from '@k-doc/editor';
import { createSnapshotStore, type SnapshotReason, type SnapshotStore } from '../files/snapshot-store.js';
import { installVersionHistoryDialog, VERSION_HISTORY_STYLES, type VersionEntry, type VersionHistoryDialog } from './version-history-dialog.js';
import { createGitService, type GitCommit, type GitFileInfo, type GitService } from '../files/git-service.js';
import { installZenMode, ZEN_MODE_STYLES, type ZenMode } from './zen-mode.js';
import { installPresentation, PRESENTATION_STYLES, type Presentation } from './presentation-mode.js';
import { routeRenderedLinks } from './rendered-links.js';
import { splitSlides } from '@k-doc/core';
import { invoke } from '@tauri-apps/api/core';
import { buildFileTree, remapPath, type TreeNode } from '@k-doc/core';
import { createVaultFiles, type VaultFiles, type VaultTemplate } from '../files/vault-files.js';
import { createFileTreeActions, type FileTreeActions } from './file-tree-actions.js';
import type { FileMatch, NoteMatch } from '@k-doc/core';
import { mergeThreeWay } from '@k-doc/core';
import { createSettingsStore, type SettingsStore } from '../files/settings-store.js';
import { installSettingsDialog, SETTINGS_DIALOG_STYLES, type SettingsDialog } from './settings-dialog.js';
import { UI_FONT_STACK, UI_FONT_STYLES } from './ui-font.js';
import { openTabFor } from './open-tab.js';
import { installKeyboardShortcutsDialog, KEYBOARD_SHORTCUTS_STYLES, type KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog.js';
import { createNavigator, type NavLocation, type Navigator } from './navigation-history.js';
import type { KeyboardSettings } from '@k-doc/config';
import { installRibbon, RIBBON_STYLES, type Ribbon, type RibbonState, type RibbonTabSpec } from './ribbon.js';
import { knownCommandIds, resolveRibbonLayout, ribbonLayoutSetting, type RibbonTabSetting } from './ribbon-layout.js';
import { installRibbonDialog, RIBBON_DIALOG_STYLES, type RibbonDialog } from './ribbon-dialog.js';
import { installGraphDialog, GRAPH_DIALOG_STYLES, type GraphDialog } from './graph-dialog.js';
import { installPluginsPanel, PLUGINS_PANEL_STYLES, type PluginsPanel } from './plugins-panel.js';
import { secondDocumentOf, type SecondDocument } from './second-document.js';
import { installSecondPaneHeader, SECOND_PANE_HEADER_STYLES, type SecondPaneHeader } from './second-pane-header.js';
import { createPluginHost, type PluginHost } from '../plugins/plugin-host.js';
import { installAppMenuBar, APP_MENU_BAR_STYLES, type AppMenuBar } from './app-menu-bar.js';
import { TabSet } from './tab-set.js';
import { installTabBar, TAB_BAR_STYLES, type TabBar, type TabView } from './tab-bar.js';
import { installScrollSync, type ScrollSync, type BlockAnchor } from './scroll-sync.js';
import { kdocAnchors, sourceAnchors, sourceScroller } from './pane-anchors.js';
import { installCommandPalette, COMMAND_PALETTE_STYLES, type CommandPalette } from './command-palette.js';
import { installPickerDialog, type PickerDialog } from './picker-dialog.js';
import { PICKER_DIALOG_STYLES } from './picker-dialog-styles.js';
import { installBreadcrumbBar, BREADCRUMB_BAR_STYLES, type BreadcrumbBar } from './breadcrumb-bar.js';
import { createNavigationController, samePath, type NavigationController } from './navigation-controller.js';
import { createFidelityController, type FidelityController } from './fidelity-controller.js';
import { createImageLoader, type ImageLoader } from '../files/image-loader.js';
import { createMediaLoader, type MediaLoader } from '../files/media-loader.js';
import { createPandocExport, pandocFileName, PANDOC_FORMAT_NAMES, type PandocExport, type PandocFormat } from '../files/pandoc-export.js';
import { resolveImagePath } from './lint-controller.js';
import { createLintController, type LintController } from './lint-controller.js';
import { createPathProbe, type PathProbe } from '../files/path-probe.js';
import { buildCommandRegistry, type KdocCommand } from './command-registry.js';
import { activeLink, canLink } from '@k-doc/editor';
import {
  isInTable,
  insertTable,
  insertImage,
  setBlockAlignment,
  imageAt,
  setCodeBlockLanguage,
  codeBlockLanguageAt,
  createClipboardHandlers,
  pasteContentAt,
  canPasteAsTable,
  kdocSchema,
  selectionAsMarkdown,
  selectionAsHtml,
  type PasteMode,
  offsetToPosition,
  offsetRangeToPositions,
  changeBars,
  changeBarTheme,
  setChangeBarsIn,
  createChangeBarPlugin,
  setChangeBarPositions,
  searchMarks,
  searchMarkTheme,
  setSearchMatchesIn,
  createSearchPlugin,
  setSearchRanges,
  SEARCH_STYLES,
  type SearchRange,
  commentNotes,
  commentNoteTheme,
  setCommentNotesIn,
  createCommentNotePlugin,
  setCommentNotes,
  COMMENT_NOTE_STYLES,
  type CommentNote,
  type CommentNotePoint,
  createCodeHighlightPlugin,
  createCodeCopyPlugin,
  CODE_COPY_STYLES,
  CODE_TOKEN_STYLES,
  RAW_SOURCE_STYLES,
  createTableGripsPlugin,
  createTableEscapeWarningPlugin,
  columnWidthHintAt,
  hasTableOfContents,
  insertTableOfContents,
  refreshTableOfContents,
  parseWidthHint,
  setColumnWidthHint,
  MAX_WIDTH_HINT,
  TABLE_ESCAPE_MESSAGES,
  type TableEscapeKind,
  applyListScheme,
  listDepthAt,
  isBlockActive,
  createCalloutPlugin,
  CALLOUT_STYLES,
  MULTI_CARET_STYLES,
  alertMarkerAt,
  setCalloutWord,
  TABLE_GRIP_STYLES,
} from '@k-doc/editor';
import { installLinkDialog, LINK_DIALOG_STYLES, type LinkDialog } from './link-dialog.js';
import { installFindPanel, FIND_PANEL_STYLES, type FindPanel } from './find-panel.js';
import { installOutlinePane, OUTLINE_PANE_STYLES, type OutlinePane } from './outline-pane.js';
import { installSplitDivider, SPLIT_DIVIDER_STYLES, type SplitDivider } from './split-divider.js';
import { installConfirmDialog, CONFIRM_DIALOG_STYLES, type ConfirmDialog } from './confirm-dialog.js';
import { createSpellService, DICTIONARY_SOURCE_NAME, type SpellService } from '../spell/spell-service.js';
import {
  LANGUAGE_CHOICES,
  LANGUAGE_SOURCE_TEXT,
  languageName,
  loadLanguageChoice,
  resolveDocumentLanguage,
  saveLanguageChoice,
  type DocumentLanguage,
} from '../spell/document-language.js';
import { normaliseLanguageTag, primaryLanguage } from '@k-doc/core';
import { exportMarkdownFlavour, FLAVOUR_NAMES, headingSlug, relativeLinkPath, WIKILINK_LABEL, type MarkdownFlavour } from '@k-doc/core';
import { EXPORT_THEMES } from '@k-doc/core';
import { createThemeFiles, type ThemeFiles } from '../files/theme-files.js';
import { createAttachments, attachmentExtensionFor, attachmentReference, attachmentsFolderPath, isInsideFolder, type Attachments } from '../files/attachments.js';
import { appThemeStarter } from './theme.js';
import { TextSelection } from 'prosemirror-state';
import { SPELL_STYLES } from '@k-doc/editor';
import { installSpellCheck, type SpellCheck } from './spell-check.js';
import { installSpellDialog, SPELL_DIALOG_STYLES, type SpellDialog } from './spell-dialog.js';
import { buildSpellEntries } from './spell-menu.js';
import { installImageDialog, IMAGE_DIALOG_STYLES, type ImageDialog, type ImageDialogValue } from './image-dialog.js';
import { installSizePicker, SIZE_PICKER_STYLES, type SizePicker } from './size-picker.js';
import { styleIdAt, commandForStyle, canApplyStyle } from './style-mapping.js';
import { installPromptDialog, PROMPT_DIALOG_STYLES, type PromptDialog } from './prompt-dialog.js';
import { installMergeDialog, MERGE_DIALOG_STYLES, type MergeDialog } from './merge-dialog.js';
import {
  installPageSetupDialog,
  PAGE_SETUP_STYLES,
  type PageSetupDialog,
} from './page-setup-dialog.js';
import {
  installPasteSpecialDialog,
  PASTE_SPECIAL_STYLES,
  type PasteSpecialDialog,
} from './paste-special-dialog.js';
import {
  installPasteOptionsPopup,
  PASTE_OPTIONS_STYLES,
  type PasteOptionsPopup,
} from './paste-options-popup.js';
import {
  installRecentFilesDialog,
  RECENT_FILES_DIALOG_STYLES,
  type RecentFilesDialog,
} from './recent-files-dialog.js';
import {
  createRecentFilesController,
  type RecentFilesController,
} from './recent-files-controller.js';
import type { RecentFile } from '@k-doc/config';
import {
  installStylesGallery,
  STYLE_ENTRIES,
  STYLES_GALLERY_STYLES,
  type StylesGallery,
  type StyleId,
} from './styles-gallery.js';
import {
  installListPicker,
  LIST_PICKER_STYLES,
  type ListPicker,
  type ListPickerScheme,
} from './list-picker.js';
import { installLanguagePicker, LANGUAGE_PICKER_STYLES, type LanguagePicker } from './language-picker.js';
import { installSidebar, SIDEBAR_STYLES, type Sidebar, type SidebarPanel } from './sidebar.js';
import { installPaneReserve, type PaneReserve } from './pane-reserve.js';
import { installWindowControls, tauriWindowApi, WINDOW_CONTROLS_STYLES, type WindowControls } from './window-controls.js';
import { readRibbonState, ribbonStateStore, writeRibbonState } from './ribbon-preference.js';
import { readStatusBarVisibility, statusBarStore, writeStatusBarVisibility } from './status-bar-preference.js';
import { createIcon } from './icons.js';
import type { InlineNote } from './comments-controller.js';
import { createMatchScrollbar, MATCH_SCROLLBAR_STYLES, type MatchScrollbar } from './match-scrollbar.js';
import type { SearchMatch } from '@k-doc/core';
import { createLeaderLayer, leaderPath, LEADER_LINE_STYLES, type LeaderLayer } from './leader-line.js';
import { createCommentPlugin, setCommentSpansIn, commentMarks, commentSpanTheme, COMMENT_STYLES } from '@k-doc/editor';
import {
  buildPositionIndex,
  mapSpansToPositions,
  setCommentSpans,
  sourceSelectionToProseMirror,
  proseMirrorSelectionToSource
} from '@k-doc/editor';
import { createCommentsController, type CommentsController } from './comments-controller.js';
import { createAnnotationStore, type AnnotationStore } from '../files/annotation-store.js';
import { COMMENT_CARD_STYLES } from './comment-card.js';
import { COMMENTS_PANE_STYLES } from './comments-pane.js';
import type { CommentSpan } from '@k-doc/core';
import { createChangePlugin, setChangeSpans, changeMarks, changeSpanTheme, setChangeSpansIn, mapChangeSpansToPositions, CHANGE_STYLES } from '@k-doc/editor';
import { createChangesController, type ChangesController } from './changes-controller.js';
import { createReviewPane, REVIEW_PANE_STYLES, ORIGINAL_OVERLAY_STYLES, type ReviewPane, type DecisionScope } from './review-pane.js';
import { parseMarkdown, renderFragment, originalText } from '@k-doc/core';
import { compareAsChanges, generateUlid, type ChangeSpan, type ChangeBar, type MarkupMode, type ChangeDecision } from '@k-doc/core';
import {
  installStatisticsDialog,
  STATISTICS_DIALOG_STYLES,
  type StatisticsDialog,
} from './statistics-dialog.js';
import { BRAND_STYLES, createProductWordmark } from './brand.js';
import { ABOUT_DIALOG_STYLES, installAboutDialog, type AboutDialog } from './about-dialog.js';
import { getVersion } from '@tauri-apps/api/app';

export type ViewMode = 'kdoc' | 'split' | 'source';

/**
 * What a background tab remembers about its document.
 *
 * The text is stored rather than the DocumentSession itself, because a session that stayed alive
 * would keep its bindings, filesystem watcher and autosave timers alive with it -- a background
 * document quietly writing files. Round-tripping through text is exactly the guarantee the
 * serializer already makes, so nothing is lost by it.
 */
export interface DocumentState {
  readonly text: string;
  readonly path: string | null;
  readonly dirty?: boolean;
  /** The text as of the last save. Without it a remounted tab takes its unsaved text as saved. */
  readonly savedText?: string;
  /** The encoding the file was found in, which the next save writes back. Absent means UTF-8. */
  readonly encoding?: string;
  /** The document's folded sections (FR-8.29), so a tab switch keeps them, including in a document never saved. */
  readonly folds?: readonly string[];
  /**
   * Whether the document is locked against editing because its file is read-only (FR-6.7).
   *
   * It rides with the tab so a locked document stays locked across a switch, rather than being
   * unlocked by the act of looking at something else.
   */
  readonly locked?: boolean;
}

/** The order Ctrl+/ cycles through, matching the order of the view buttons. */
export const VIEW_MODE_CYCLE: readonly ViewMode[] = ['kdoc', 'split', 'source'];

/**
 * @purpose Returns the mode that follows the given one in the cycle, wrapping at the end.
 * @inputs mode - The current view mode.
 * @outputs ViewMode - The next mode in VIEW_MODE_CYCLE.
 * @dataflow mode -> index lookup -> next index modulo length -> ViewMode.
 * @controlflow Find the mode's index -> step forward with wraparound -> return that entry, falling back
 *   to the first when the lookup fails, so an unknown mode cannot strand the user.
 */
export function nextViewMode(mode: ViewMode): ViewMode {
  const index = VIEW_MODE_CYCLE.indexOf(mode);
  const first = VIEW_MODE_CYCLE[0] ?? 'split';

  // Check whether the current mode is one the cycle knows about.
  if (index === -1) {
    // Unknown mode: restart the cycle rather than leaving the shortcut doing nothing.
    return first;
  } else {
    // Known mode: step forward, wrapping past the end.
  }

  return VIEW_MODE_CYCLE[(index + 1) % VIEW_MODE_CYCLE.length] ?? first;
}

export interface EditorShellOptions {
  readonly mount: HTMLElement;
  readonly initialText: string;
  /**
   * The file the initial text came from, when it came from one.
   *
   * A window opened by dragging a tab out is showing a document that already has a path, and losing
   * it would turn the next Save into a Save As for a file that is already on disk.
   */
  readonly initialPath?: string | null;
  /**
   * The initial document's text as of its last save, when that differs from `initialText` -- a tab dragged
   * out with unsaved work. Absent or null, the initial text is the saved text.
   */
  readonly initialSavedText?: string | null;
  /** The encoding the initial document's file was found in. Absent or null means UTF-8. */
  readonly initialEncoding?: string | null;
  /**
   * True when this window was opened on a document handed over from another window (a dragged-out tab).
   * Such a window neither restores the last session nor offers crash recovery: it was asked for one
   * document, and the journals it would find belong to windows that are still open.
   */
  readonly handedOff?: boolean;
  readonly initialViewMode?: ViewMode;
  readonly initialThemeMode?: ThemeMode;
}

/**
 * Static stylesheet for the K-Doc application shell layout and editor surfaces.
 * The shell owns layout structure and sizing, while CSS custom properties (tokens) own color definitions.
 * This separation ensures a user theme can completely restyle the visual palette without altering layout rules.
 */
/**
 * How long the shell waits before writing the window's arrangement (FR-6.10).
 *
 * Long enough that a divider drag or a scroll writes once when it settles rather than on every event,
 * short enough that the arrangement is already stored by the time a reader closes the window after it.
 */
const SESSION_SAVE_DELAY_MS = 400;

const SHELL_STYLES: string = `
.kdoc-shell {
  height: 100vh;
  /* Flex column rather than a grid with a fixed row template. The template named five rows and the
     shell has grown to more than that (toolbar, tabs, ribbon, find, panes, status), so the 1fr
     had drifted onto the table toolbar and was stretching it while the panes collapsed. A column that
     lets every chrome row size itself and gives the remainder to the panes cannot drift that way when
     the next row is added. */
  display: flex;
  flex-direction: column;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  font-family: ${UI_FONT_STACK};
  overflow: hidden;
}

.kdoc-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  /* Wrap rather than clip. Merging the menu bar into this row saves a whole chrome row at normal
     widths, but with nowrap a narrow window pushed the view switcher off the right edge entirely.
     Wrapping costs the saved row back only when the window is genuinely too narrow to hold it. */
  flex-wrap: wrap;
  row-gap: 4px;
  gap: 8px;
  min-height: 34px;
  margin: 6px 6px 4px;
  padding: 4px 6px 4px 12px;
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-xl);
  color: var(--kdoc-chrome-text);
}

.kdoc-brand {
  /* K-Tech minimum for a wordmark: 24px, which sets the inline mark at about 17px. */
  font-size: 24px;
  color: var(--kdoc-chrome-text);
  background: transparent;
  box-shadow: none;
  padding: 2px 6px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  user-select: none;
}

.kdoc-menu-bar-container {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.kdoc-toolbar .kdoc-menu-bar {
  background: transparent;
  border: none;
  padding: 0;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

/* The shell is exactly the window: no default body margin, no page scroll. Every scrolling region (the
   panes, panels, dialogs) scrolls itself, so a page scrollbar only ever meant the shell overflowed. */
html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

.kdoc-ribbon-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
}

.kdoc-ribbon-toggle:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-ribbon-toggle:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

/* The reader hid the status bar: it takes no room, so the panes reach the bottom of the window. */
.kdoc-status.kdoc-status-hidden {
  display: none;
}

.kdoc-status-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
}

.kdoc-status-toggle:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-status-toggle:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-spacer {
  flex: 1;
}

.kdoc-segmented {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  overflow: hidden;
  box-sizing: border-box;
}

.kdoc-segmented button {
  height: 100%;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-left: 1px solid var(--kdoc-chrome-edge);
  border-radius: 0;
  cursor: pointer;
  font: inherit;
  color: var(--kdoc-chrome-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, border-radius 150ms ease, color 150ms ease;
}

.kdoc-segmented button:first-child {
  border-left: none;
}

.kdoc-segmented button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-segmented button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-segmented button[aria-pressed="true"] {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  box-shadow: none;
}

.kdoc-segmented button[aria-pressed="true"]::before {
  content: '\\2713';
  margin-right: 5px;
}

.kdoc-segmented button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  opacity: 1;
  cursor: not-allowed;
}

.kdoc-file-group {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.kdoc-file-button,
.kdoc-theme-toggle,
.kdoc-outline-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  font: inherit;
  font-weight: 550;
  box-shadow: none;
  box-sizing: border-box;
  transition: background-color 150ms ease, border-color 150ms ease, border-radius 150ms ease, color 150ms ease;
}

.kdoc-file-button:hover,
.kdoc-theme-toggle:hover,
.kdoc-outline-toggle:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-file-button:active,
.kdoc-theme-toggle:active,
.kdoc-outline-toggle:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-file-button[aria-pressed="true"],
.kdoc-theme-toggle[aria-pressed="true"],
.kdoc-outline-toggle[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
  border-radius: var(--kdoc-radius-md);
  font-weight: 700;
  box-shadow: none;
}

.kdoc-file-button:focus-visible,
.kdoc-theme-toggle:focus-visible,
.kdoc-outline-toggle:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-file-button:disabled,
.kdoc-theme-toggle:disabled,
.kdoc-outline-toggle:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  opacity: 1;
  cursor: not-allowed;
  box-shadow: none;
}

.kdoc-panes {
  /* Room for the floating sidebars, measured by pane-reserve.ts: the panels still float as cards, but the
     panes start beside them instead of underneath. The hosts are absolutely positioned against this box,
     so the padding moves the panes and leaves the hosts where they are. */
  padding-left: var(--kdoc-pane-reserve-left, 0px);
  padding-right: var(--kdoc-pane-reserve-right, 0px);
  box-sizing: border-box;
  transition: padding 150ms ease;
  /* Takes whatever the chrome rows leave. min-height: 0 is load-bearing in a flex column for the same
     reason it was in the grid: without it the panes refuse to shrink and overflow the viewport. */
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  min-height: 0; /* min-height: 0 is load-bearing inside a grid row: without it the panes refuse to scroll and overflow the viewport instead */
  overflow: hidden;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
}

/* Split orientation Horizontal (editor.splitOrientation): the panes stack, K-Doc above Source. */
.kdoc-panes.kdoc-panes-stacked {
  flex-direction: column;
}

.kdoc-pane {
  flex: 1;
  min-width: 0;
  /* Lets a stacked pane shrink below its content's height; side by side it changes nothing. */
  min-height: 0;
  /* The pane is the document's scroll container, so it cannot be overflow: hidden outright. Hiding
     only the horizontal axis is what clips the page to the card's rounded corners while leaving the
     vertical scroll the document depends on. */
  overflow-x: hidden;
  overflow-y: auto;
  padding: 24px 28px;
  background: var(--kdoc-color-background);
  color: var(--kdoc-color-text);
  border: 1px solid var(--kdoc-color-border);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  margin: 8px;
  box-sizing: border-box;
}

.kdoc-pane[hidden] {
  display: none;
}

/* The hidden attribute always wins: component rules that set display (the status bar's buttons) must not reveal it. */
[hidden] {
  display: none !important;
}

.kdoc-status {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  box-shadow: none;
  font-size: 12px;
  white-space: nowrap;
  color: var(--kdoc-chrome-text-muted);
  box-sizing: border-box;
}

.kdoc-status-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--kdoc-radius-sm);
  color: var(--kdoc-chrome-text);
}

.kdoc-status span[aria-label="Current file"] {
  color: var(--kdoc-chrome-text);
}

/* A clickable segment has to look clickable on hover and take focus like any other control, because a
   status bar that silently responds to clicks in three places and not the others is worse than one that
   responds nowhere. */
.kdoc-status-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-sm);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  font: inherit;
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, border-radius 150ms ease, color 150ms ease;
}

.kdoc-status-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-status-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-status-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
  opacity: 1;
}

.kdoc-status-readout,
.kdoc-status-button,
.kdoc-status span {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
}

.kdoc-status-readout,
.kdoc-status span {
  box-shadow: none;
  border: none;
}

.kdoc-status .kdoc-error {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-status .kdoc-error.error,
.kdoc-status .kdoc-error[data-error="true"] {
  color: var(--kdoc-emissive-red);
}

.kdoc-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--kdoc-radius-pill);
  box-sizing: border-box;
  background: transparent;
  border: 1.5px solid var(--kdoc-chrome-text-muted);
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.kdoc-dot.dirty {
  background: var(--kdoc-emissive-amber);
  border-color: var(--kdoc-emissive-amber);
  box-shadow: 0 0 6px var(--kdoc-emissive-amber);
}

.kdoc-key-hint,
.kdoc-shell .kdoc-key-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  box-shadow: inset 1px 1px 0 var(--kdoc-chrome-highlight), 0 -2px 6px var(--kdoc-chrome-shadow-dark);
  border-radius: var(--kdoc-radius-md);
  margin: 4px 8px;
  font-size: 12px;
  border: none;
}

.kdoc-key-hint[hidden],
.kdoc-shell .kdoc-key-hint[hidden] {
  display: none;
}

.kdoc-key-hint-text,
.kdoc-shell .kdoc-key-hint-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-key-hint-dismiss,
.kdoc-shell .kdoc-key-hint-dismiss {
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  padding: 2px 10px;
  cursor: pointer;
  box-shadow: var(--kdoc-elevation-raised);
  transition: box-shadow 0.15s ease, color 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-key-hint-dismiss:hover,
.kdoc-shell .kdoc-key-hint-dismiss:hover {
  color: var(--kdoc-chrome-text);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-key-hint-dismiss:active,
.kdoc-shell .kdoc-key-hint-dismiss:active {
  background: var(--kdoc-chrome-recessed);
  box-shadow: var(--kdoc-elevation-sunken);
  color: var(--kdoc-chrome-accent);
}

.kdoc-key-hint-dismiss:focus-visible,
.kdoc-shell .kdoc-key-hint-dismiss:focus-visible {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: 1px;
}

${PROSEMIRROR_BASE_STYLES}

.ProseMirror {
  outline: none;
  line-height: 1.65;
  max-width: 70ch;
  color: var(--kdoc-color-text);
}

.ProseMirror h1,
.ProseMirror h2,
.ProseMirror h3 {
  color: var(--kdoc-color-text);
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.ProseMirror h1 {
  font-size: 1.8em;
  border-bottom: 1px solid var(--kdoc-color-border);
  padding-bottom: 0.3em;
}

.ProseMirror h2 {
  font-size: 1.4em;
  border-bottom: 1px solid var(--kdoc-color-border);
  padding-bottom: 0.25em;
}

.ProseMirror h3 {
  font-size: 1.2em;
}

.ProseMirror p {
  margin-top: 0;
  margin-bottom: 1em;
}

.ProseMirror blockquote {
  border-left: 3px solid var(--kdoc-color-border-strong);
  margin: 1em 0;
  padding-left: 16px;
  color: var(--kdoc-color-text-muted);
}

.ProseMirror pre {
  background: var(--kdoc-color-code-background);
  border-radius: var(--kdoc-radius-sm);
  padding: 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.9em;
}

.ProseMirror code {
  background: var(--kdoc-color-code-background);
  border-radius: var(--kdoc-radius-sm);
  padding: 2px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.9em;
}

.ProseMirror pre code {
  padding: 0;
  background: transparent;
}

.ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  border-radius: var(--kdoc-radius-sm);
  overflow: hidden;
}

.ProseMirror th,
.ProseMirror td {
  border: 1px solid var(--kdoc-color-border);
  padding: 6px 10px;
  text-align: left;
}

.ProseMirror th {
  background: var(--kdoc-color-background-elevated);
  font-weight: 600;
}

.cm-editor {
  height: 100%;
  background: transparent;
}

.cm-scroller {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  line-height: 1.6;
}

/* Task list items.
   The schema emits data-checked on every <li> ("true", "false" or "none"), so a task item and an
   ordinary bullet are already distinguishable in the DOM -- but until now both rendered as a plain
   bullet, and a checklist looked exactly like a list. The marker is drawn with ::before rather than a
   real <input> because the checkbox is a rendering of document state, not a separate control: the
   document is the truth, and an input would be a second place for that truth to live.
   Toggling is done with the Task toolbar button or Ctrl+Shift+9; the marker itself is not clickable. */
.ProseMirror li[data-checked="true"],
.ProseMirror li[data-checked="false"] {
  list-style: none;
  position: relative;
}

.ProseMirror li[data-checked="true"]::before,
.ProseMirror li[data-checked="false"]::before {
  position: absolute;
  left: -1.35em;
  top: 0;
  width: 1em;
  text-align: center;
  font-size: 1em;
  line-height: inherit;
}

.ProseMirror li[data-checked="false"]::before {
  content: '☐'; /* U+2610 BALLOT BOX -- the literal character, because a CSS \ escape does not survive the TypeScript template literal this stylesheet lives in */
  color: var(--kdoc-color-text-muted);
}

.ProseMirror li[data-checked="true"]::before {
  content: '☑'; /* U+2611 BALLOT BOX WITH CHECK -- the literal character, because a CSS \ escape does not survive the TypeScript template literal this stylesheet lives in */
  color: var(--kdoc-color-success);
}

/* Completed items read as done at a glance, the way every task list does. */
.ProseMirror li[data-checked="true"] > p {
  color: var(--kdoc-color-text-muted);
  text-decoration: line-through;
}

.kdoc-error { color: var(--kdoc-color-danger); }

.ProseMirror img.kdoc-image-loading,
.ProseMirror img.kdoc-image-missing {
  display: inline-block;
  min-width: 2em;
  min-height: 1.5em;
  vertical-align: middle;
  border: 1px dashed var(--kdoc-color-border-strong);
  border-radius: var(--kdoc-radius-sm);
}

.ProseMirror img.kdoc-image-missing {
  border-color: var(--kdoc-color-danger);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-panes,
  .kdoc-file-button,
  .kdoc-theme-toggle,
  .kdoc-outline-toggle,
  .kdoc-segmented button,
  .kdoc-status-button,
  .kdoc-dot,
  .kdoc-key-hint-dismiss {
    transition: none !important;
  }
}
`;

/**
 * EditorShell orchestrates the visual application container for K-Doc, coordinating the toolbar,
 * dual synchronized editor panes (K-Doc ProseMirror and raw Source CodeMirror), theme switching,
 * and live document metrics over a shared DocumentSession.
 */
// Four encodings is too few to justify a menu of its own: a dropdown for four items is more ceremony
// than it is worth, so clicking cycles through them instead. The segment always names the current one,
// so the user can see exactly where they are in the cycle at any time.
const ENCODING_CYCLE: readonly string[] = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'];

/**
 * How many vault notes the link dialog offers at once.
 *
 * The list sits inside a dialog rather than a pane, so it has a screen's worth of room and no more.
 * The ranking has already put the best first, and a list that scrolled past twenty would be asking
 * the user to read rather than to choose.
 */
const LINK_NOTE_RESULTS: number = 20;

export class EditorShell {
  private readonly mount: HTMLElement;
  private readonly shellElement: HTMLElement;
  private readonly toolbarElement: HTMLElement;
  private readonly kdocButton: HTMLButtonElement;
  private readonly splitButton: HTMLButtonElement;
  private readonly sourceButton: HTMLButtonElement;
  private readonly themeButton: HTMLButtonElement;
  private readonly themeMenu: ThemeMenu;
  private readonly panesElement: HTMLElement;
  private readonly menuBarContainer: HTMLElement;
  private readonly fileGroup: HTMLElement;
  private readonly findRow: HTMLElement;
  private readonly outlineNav: HTMLElement;
  private readonly kdocPane: HTMLElement;
  private readonly sourcePane: HTMLElement;
  private readonly statusBarElement: HTMLElement;
  private readonly statusDot: HTMLElement;
  private readonly statusDirtyText: HTMLElement;
  private readonly statusWordCount: HTMLButtonElement;
  private readonly statusCharCount: HTMLElement;

  private readonly statusParagraphCount: HTMLElement;

  private readonly statusReadingTime: HTMLElement;
  private readonly statusFocus: HTMLElement;

  // Shown only while the document is locked (FR-6.7); clicking it offers to unlock the file.
  private readonly statusLock: HTMLButtonElement;

  // Shows the mounted document's spelling language; clicking it offers the others (FR-12.3).
  private readonly statusLanguage: HTMLButtonElement;
  private readonly spellingLanguagePicker: PickerDialog;
  // Picks the Markdown flavour an export is written in (FR-13.6).
  private readonly flavourPicker: PickerDialog;
  // The stylesheets an export or printout can be written with, and the folder the reader's own live in (FR-13.8).
  private readonly exportThemes: ThemeFiles;
  private readonly exportThemePicker: PickerDialog;
  private readonly pluginExportPicker: PickerDialog;
  // The reader's own themes for the app itself, the element their stylesheet is written into, and the watch that
  // reloads it when they save (FR-14.10).
  private readonly appThemes: ThemeFiles;
  private readonly appThemePicker: PickerDialog;
  private readonly userThemeElement: HTMLStyleElement;
  private stopThemeWatch: (() => void) | null = null;
  // The language the mounted document is checked in, and where that came from.
  private documentLanguage: DocumentLanguage = { language: DEFAULT_SETTINGS.proofing.language, source: 'default' };
  // The language the front matter named when last looked at, so an edit that changes it is noticed.
  private declaredLanguage: string | null = null;
  // Languages whose dictionary the reader declined, or which failed to download, this session: not asked again.
  private readonly declinedDictionaries: Set<string> = new Set<string>();
  // Languages chosen for unsaved documents, which have no path to remember them under, by tab.
  private readonly unsavedLanguageChoices: Map<string, string> = new Map<string, string>();
  // Whether the download question is on screen, so two documents do not ask at once.
  private dictionaryPromptOpen: boolean = false;

  // Whether the mounted document is locked. Read-only files open this way.
  private locked: boolean = false;
  private readonly statusViewMode: HTMLButtonElement;
  /** Names the encoding the next save will write, and cycles it when clicked (FR-14.5, FR-6.6). */
  private readonly statusEncoding: HTMLButtonElement;
  private readonly statusFileName: HTMLElement;
  private readonly statusMessage: HTMLElement;
  private fileMenu!: FileMenu;
  private readonly linkDialog: LinkDialog;
  private findPanel!: FindPanel;
  private outlinePane: OutlinePane | null = null;
  private readonly outlineButton: HTMLButtonElement;
  // The second view of the same document (FR-6.9), between the K-Doc pane and the Source pane.
  // Hidden until it is asked for, so nothing changes for anyone who never opens it.
  private readonly secondaryPane: HTMLElement;

  private readonly secondaryDividerElement: HTMLElement;

  private secondaryDivider: SplitDivider | null = null;

  // The binding over the second pane, made when it opens and destroyed with the document. Null while
  // the pane is closed, so a document that is never split pays for nothing.
  private secondaryBinding: ProseMirrorBinding | null = null;

  // Whether the second pane is open. Kept separate from the binding because a tab switch destroys the
  // binding and rebuilds it, and the pane should still be open on the other side of that.
  private secondaryOpen: boolean = false;

  /** The second pane's own document, when it holds one rather than another view of the open one (FR-6.9). */
  private secondaryDocument: SecondDocument | null = null;

  /** The strip above the second pane saying what it holds (FR-6.9). */
  private secondaryHeader: SecondPaneHeader | null = null;

  /** Cancels the subscription that keeps that strip up to date (FR-6.9). */
  private secondaryWatch: (() => void) | null = null;

  private readonly splitDividerElement: HTMLElement;
  private readonly splitDivider: SplitDivider;
  private readonly confirmDialog: ConfirmDialog;
  private readonly commandPalette: CommandPalette;
  /** Quick Open (FR-9.7), Go To (FR-9.6) and the breadcrumb bar (FR-9.9). Undefined until installNavigation runs, because both editor bindings report state changes before the constructor gets that far. */
  private navigation: NavigationController | undefined;
  private quickOpenDialog: PickerDialog | undefined;
  private goToDialog: PickerDialog | undefined;
  private breadcrumbBar: BreadcrumbBar | undefined;
  private readonly journalStore: JournalStore;
  private recovery!: Recovery;
  /** Set when the window was opened on a handed-over document (see EditorShellOptions.handedOff). */
  private readonly handedOff: boolean;
  /**
   * Prefix for this launch's crash-journal ids. Each tab journals under its own id (prefix + tab id), so one
   * document's save or close never deletes another's journal, and the random part keeps this launch from
   * overwriting a previous launch's journals before they have been offered for recovery.
   */
  private readonly journalPrefix: string = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  private autosave!: Autosave;
  private externalWatch!: ExternalWatch;
  private scrollSync!: ScrollSync;
  private readonly scrollLockButton: HTMLButtonElement;
  // The annotation store backing this document's comments. Rebuilt per document, like the panels.
  private annotationStore!: AnnotationStore;
  // Owns the comment threads, the margin pane and the decoration plan for the mounted document.
  private commentsController!: CommentsController;
  // The comments panel body. Created once and handed to the sidebar, which owns where it is shown.
  private readonly commentsNav: HTMLElement;
  // Ctrl+Alt+M. Registered once in the constructor rather than per mount, because mountDocument runs
  // on every tab switch and a listener added there would accumulate one per document opened.
  // Rebuilt per document like the other per-document panels, so it takes definite assignment rather than readonly.
  private changesController!: ChangesController;
  /** Settles when the mounted document's stored changes have loaded, so a replacement is not overwritten by them. */
  private changesLoaded: Promise<void> = Promise.resolve();
  // Rebuilt per document like the other per-document panels, so it takes definite assignment rather than readonly.
  private reviewPane!: ReviewPane;
  // Panel body created here and handed to the sidebar for mounting.
  private readonly reviewNav: HTMLElement;
  // Id of the change currently selected in the review pane.
  private activeChangeId: string | null = null;
  // Keydown handler that toggles track changes on Ctrl+Shift+E.
  // The overlay element that covers the panes when showing the original document text.
  private readonly originalOverlay: HTMLElement;
  // The inner content surface of the overlay where the rendered original is injected.
  private readonly originalBody: HTMLElement;
  private pageSetup: PageSetup = DEFAULT_PAGE_SETUP;
  private readonly fileService: FileService;
  /** Files K-Doc is asked to open from outside: a double-clicked Markdown file, at launch or later. */
  private readonly launchFiles: LaunchFiles = defaultLaunchFiles();
  /** Local version snapshots (FR-11.8). */
  private readonly snapshotStore: SnapshotStore;
  /** The document's git history and stage/commit (FR-11.11). */
  private readonly gitService: GitService;
  /** The interval taking timer snapshots and the minutes it was started with, or null when none runs. */
  private snapshotTimer: { readonly id: number; readonly minutes: number } | null = null;
  /** Browses, restores and copies from the document's snapshots (FR-11.9, FR-11.10). */
  private versionHistoryDialog!: VersionHistoryDialog;
  /** Focus and Typewriter modes (FR-5.8). They last for the session and apply to every tab; they are not saved. */
  private writingModes: WritingModes = { focus: 'off', typewriter: false };
  /** Zen mode: chrome hidden, window full screen (FR-5.8). */
  private zenMode!: ZenMode;
  /** Presentation mode: the document as slides over the whole window (FR-5.9). */
  private presentation!: Presentation;
  private readonly popupMenu: PopupMenu;
  private contextMenu!: ContextMenu;
  private slashMenu!: SlashMenu;
  private readonly handleZoomWheel: (event: WheelEvent) => void;
  private zoom: number = DEFAULT_ZOOM;

  // Pending write of the window's arrangement (FR-6.10), so a drag or a scroll writes once when it
  // settles rather than on every event.
  private sessionSaveTimer: number | null = null;

  // Documents already asked about their bundled comments (FR-6.22), so a tab switch does not ask again.
  // Keyed by path, with the empty string standing for an unsaved document.
  private readonly declinedBundles: Set<string> = new Set<string>();

  // What the last grammar check found (FR-12.4). Empty until one is run, and emptied whenever the text
  // changes, because an issue's offsets describe the document as it was when it was checked.
  private grammarIssues: readonly GrammarIssue[] = [];

  // True while a check is in flight, so a second one cannot be started on top of the first.
  private grammarChecking: boolean = false;

  /**
   * Whether the launch has finished deciding what to restore (FR-6.10).
   *
   * Nothing is written before it has. Construction sets the view mode, which schedules a write, while
   * the restore is still waiting on the settings file -- so without this the empty launch window
   * overwrites the stored arrangement a moment before the restore reads it, and every launch after the
   * first restores nothing.
   */
  private sessionRestored: boolean = false;
  /** Whether the restored session set the view mode; if not, the Default view setting does. */
  private viewModeRestored: boolean = false;

  // The active document's own reading width and density (FR-5.10, FR-14.13), read from local storage
  // when it is mounted. Empty means it simply follows the appearance settings.
  private displayOverride: DisplayOverride = {};
  private settings: KdocSettings = DEFAULT_SETTINGS;

  // The service is per-window, not per-document: it owns the user dictionary and the session's
  // ignore list, and both of those are decisions about words rather than about a file. The
  // controller below it is per-document, because it holds a view.
  // The three choosers are window-level rather than per-document: each is a piece of chrome that acts on
  // whichever document is in front, exactly like the popup menu and the command palette.
  private readonly imageDialog: ImageDialog;
  private readonly sizePicker: SizePicker;
  private readonly listPicker: ListPicker;
  private readonly stylesGallery: StylesGallery;
  private readonly promptDialog: PromptDialog;
  private readonly windowHandoff: WindowHandoff;
  // Loads local images through the host for display in the pane and embedding in HTML export. Initialised
  // here rather than in the constructor body because the first document is mounted before that body reaches
  // the handoff setup, and mounting clears this loader.
  private readonly imageLoader: ImageLoader = createImageLoader(window);
  // Reads a local video or audio file so the editor can play it (FR-8.17).
  private readonly mediaLoader: MediaLoader = createMediaLoader(window);
  // Converts the document to LaTeX or EPUB, when Pandoc is on PATH (FR-13.7).
  private readonly pandoc: PandocExport = createPandocExport(window);
  private readonly vault: VaultService;
  private readonly filesPanel: FilesPanel;
  private readonly vaultFiles: VaultFiles;
  private readonly fileTreeActions: FileTreeActions;
  private readonly templatePicker: PickerDialog;
  /** The vault's folders as relative paths, so an empty folder still shows in the tree. */
  private vaultFolders: readonly string[] = [];
  /** The vault root the folder list was last loaded for. */
  private vaultFoldersRoot: string | null = null;
  /** Says where a hovered link in the K-Doc pane goes (FR-8.13). */
  private readonly linkHoverCard: LinkHoverCard;
  /** Hands web and mail links to the operating system (FR-8.13). */
  private readonly externalOpener: ExternalOpener;
  private readonly backlinksPanel: BacklinksPanel;
  private readonly historyPanel: HistoryPanel;
  private readonly metadataPanel: MetadataPanel;
  private readonly problemsPanel: ProblemsPanel;
  /** Edits the autocorrect replacement table (FR-7.8). Opened from Settings and the palette. */
  private replacementsDialog!: ReplacementsDialog;
  /** Edits the snippets (FR-7.10). Opened from Settings and the palette. */
  private snippetsDialog!: SnippetsDialog;
  /** Lists the document's reference-link definitions (FR-8.16). */
  private readonly linkDefinitionsPanel: LinkDefinitionsPanel;
  /** Runs the Fidelity Check on save when developer mode is on (FR-4.5). */
  private readonly fidelity: FidelityController;
  // Asks the host which image files exist on disk for the current document.
  private readonly pathProbe: PathProbe;
  // Document linting for the Problems panel, per FR-12.7.
  private readonly lint: LintController;
  private readonly searchPanel: SearchPanel;
  private readonly vaultSearch: VaultSearchController;
  private readonly tagsPanel: TagsPanel;
  /**
   * The panel the left sidebar was last showing.
   *
   * Ctrl+Shift+B reopens onto this rather than always onto Outline, so pressing it twice leaves the
   * user where they were instead of somewhere else.
   */
  private lastSidebarPanelId: string = 'outline';
  private readonly mergeDialog: MergeDialog;
  private readonly pageSetupDialog: PageSetupDialog;
  private readonly recentFilesDialog: RecentFilesDialog;
  private readonly recentFiles: RecentFilesController;
  private readonly pasteSpecialDialog: PasteSpecialDialog;
  private readonly pasteOptionsPopup: PasteOptionsPopup;
  /**
   * What the last paste inserted and how. Kept so a second reading of the same clipboard is possible
   * without re-reading the clipboard -- which by then may hold something else, and which is a
   * permission a text editor should not need.
   */
  private lastPaste: { from: number; to: number; html: string; text: string; mode: PasteMode } | null = null;
  private readonly languagePicker: LanguagePicker;

  /**
   * Set by Ctrl+Shift+V and consumed by the very next paste.
   *
   * A paste mode cannot be a ProseMirror command, because a command runs against a state and has no
   * clipboard to read. Recording the intent on keydown and letting the paste event consume it keeps
   * the decision in the one place that actually applies a paste.
   */
  private pendingPasteMode: PasteMode | null = null;

  // The sidebar hosts the outline today and is where Files, Search and Tags will live once a vault
  // exists to populate them (FR-14.6).
  private readonly sidebar: Sidebar;
  /** Draws the line joining the active comment card to the text it is anchored to (FR-10.2). */
  private readonly leaderLayer: LeaderLayer;
  /** The match scrollbar belongs to the Source pane rather than the shell: it is an overview of that pane's scroll extent and means nothing beside a pane that is not scrolling the source. */
  private readonly matchScrollbar: MatchScrollbar;
  // Redraws are coalesced into a single animation frame because scrolling fires far faster than the line needs redrawing, and measuring layout inside a scroll handler is the classic way to make a pane feel heavy — defer it off the hot path.
  private leaderFrame: number | null = null;
  /** Held as fields so teardown detaches exactly these functions rather than fresh closures. */
  private readonly handleLeaderScroll: () => void;
  private readonly handleLeaderResize: () => void;
  // Two separate Sidebar instances rather than one host with a side switch: they hold different panels and answer to
  // different affordances — the left rail is the outline's, the right rail is where an annotation surface belongs.
  private readonly rightSidebar: Sidebar;
  /** Pads the panes by how far each floating sidebar reaches into them, so an open panel never covers the text. */
  private readonly paneReserve: PaneReserve;
  /** Minimise / maximise / close for the frameless desktop window; hidden in the browser build. */
  private readonly windowControls: WindowControls;
  /** Top-bar button that hides or shows the whole ribbon row. */
  private readonly ribbonToggleButton: HTMLButtonElement;
  /** Status-bar button that hides the whole status bar; View > Panels > Status Bar brings it back. */
  private readonly statusBarToggleButton: HTMLButtonElement;
  /** The right panel shown last, which Ctrl+Shift+R reopens (FR-20.2). */
  private lastRightPanelId: string = 'comments';

  private readonly statisticsDialog: StatisticsDialog;
  private readonly aboutDialog: AboutDialog;

  private readonly fileDrop: FileDrop;
  // Writes pasted and dropped images into the attachments folder (FR-6.14).
  private readonly attachments: Attachments;

  private readonly spellService: SpellService;
  private spellCheck!: SpellCheck;
  private spellDialog!: SpellDialog;
  private readonly settingsStore: SettingsStore;
  private readonly settingsDialog: SettingsDialog;
  private readonly keyboardShortcutsDialog: KeyboardShortcutsDialog;
  /** Kinds of table-cell content already explained for the mounted document, so a warning is given once, not per keystroke. */
  private readonly tableEscapesWarned = new Set<TableEscapeKind>();
  /** The mounted document's folds (FR-8.29); null only before the first mount. */
  private foldSync: FoldSync | null = null;
  /** Back and forward across followed links and jumps (FR-9.10). */
  private readonly navHistory: Navigator = createNavigator({
    current: (): NavLocation | null => this.currentNavLocation(),
    show: (location: NavLocation): Promise<boolean> => this.showNavLocation(location),
  });
  /** Replaced whole when the reader rearranges it, because a ribbon is built from its layout (FR-14.17). */
  private ribbon: Ribbon;
  /** The row the ribbon is drawn into, kept so it can be drawn again. */
  private readonly ribbonRow: HTMLElement;
  private readonly ribbonDialog: RibbonDialog;
  private readonly graphDialog: GraphDialog;
  private readonly pluginHost: PluginHost;
  private readonly pluginsPanel: PluginsPanel;
  private readonly appMenuBar: AppMenuBar;
  private readonly tabs: TabSet<DocumentState>;
  private tabBar!: TabBar;
  private readonly tabBarRow: HTMLElement;
  private activeTabId: string | null = null;
  private readonly handleTabKey: (event: KeyboardEvent) => void;
  /** The shortcuts in effect: the chosen preset with the user's own bindings over it (FR-14.16). */
  private keymap: ResolvedKeymap = resolveKeymap(DEFAULT_SETTINGS.keyboard.preset, DEFAULT_SETTINGS.keyboard.bindings);
  private readonly keymapService: KeymapService;
  private readonly keyHint: KeyHint;

  private documentSession!: DocumentSession;
  private readonly themeController: ThemeController;
  private proseMirrorBinding!: ProseMirrorBinding;
  private codeMirrorBinding!: CodeMirrorBinding;

  private themeMode: ThemeMode;
  private currentViewMode: ViewMode;
  private unsubscribeSession: (() => void) | null = null;
  private destroyed: boolean = false;
  private messageTimer: number | null = null;

  /**
   * @purpose Initializes a new EditorShell instance, injecting static stylesheet, setting up theme controller, constructing DOM hierarchy, instantiating DocumentSession and editor view bindings, and setting initial view mode and focus.
   * @inputs options - EditorShellOptions specifying DOM mount container, initial Markdown source text, optional initial view mode, and optional initial theme mode.
   * @outputs void — instantiates the EditorShell instance.
   * @dataflow options -> DOM construction, DocumentSession(initialText), installTheme, ProseMirrorBinding & CodeMirrorBinding -> initial setViewMode & focus.
   * @controlflow Check for existing #kdoc-shell style element and inject if absent -> initialize theme controller -> create DOM elements using createElement and textContent -> instantiate DocumentSession -> construct ProseMirror and CodeMirror bindings -> subscribe to session changes -> set initial view mode -> focus ProseMirror pane.
   */
  constructor(options: EditorShellOptions) {
    // Step 1: Inject the static stylesheet once into document.head.
    // Check for an existing #kdoc-shell element first and skip injection if present,
    // so constructing a second shell does not duplicate it in the document.
    const existingStyle = document.getElementById('kdoc-shell');
    if (existingStyle === null) {
      // Create and append the static shell style element to document.head.
      const styleElement = document.createElement('style');
      styleElement.id = 'kdoc-shell';
      styleElement.textContent = UI_FONT_STYLES + SHELL_STYLES + TYPOGRAPHY_STYLES + APP_MENU_BAR_STYLES + COMMAND_PALETTE_STYLES + PICKER_DIALOG_STYLES + BREADCRUMB_BAR_STYLES + POPUP_MENU_STYLES + SETTINGS_DIALOG_STYLES + KEYBOARD_SHORTCUTS_STYLES + RIBBON_STYLES + WINDOW_CONTROLS_STYLES + TAB_BAR_STYLES + LINK_DIALOG_STYLES + FIND_PANEL_STYLES + OUTLINE_PANE_STYLES + SPLIT_DIVIDER_STYLES + CONFIRM_DIALOG_STYLES + SPELL_STYLES + SPELL_DIALOG_STYLES + RIBBON_DIALOG_STYLES + GRAPH_DIALOG_STYLES + PLUGINS_PANEL_STYLES + SECOND_PANE_HEADER_STYLES
        + IMAGE_DIALOG_STYLES + SIZE_PICKER_STYLES + LIST_PICKER_STYLES + STYLES_GALLERY_STYLES
        + PROMPT_DIALOG_STYLES + MERGE_DIALOG_STYLES + RECENT_FILES_DIALOG_STYLES + PASTE_SPECIAL_STYLES + PASTE_OPTIONS_STYLES
        + PAGE_SETUP_STYLES
        + CALLOUT_STYLES + MULTI_CARET_STYLES + FILES_PANEL_STYLES + KEY_HINT_STYLES + SEARCH_PANEL_STYLES
        + BACKLINKS_PANEL_STYLES + HISTORY_PANEL_STYLES + METADATA_PANEL_STYLES + PROBLEMS_PANEL_STYLES + LINK_DEFINITIONS_PANEL_STYLES + REPLACEMENTS_DIALOG_STYLES + SNIPPETS_DIALOG_STYLES + VERSION_HISTORY_STYLES + WRITING_MODE_STYLES + ZEN_MODE_STYLES + PRESENTATION_STYLES + LINK_HOVER_CARD_STYLES
        + CODE_TOKEN_STYLES + RAW_SOURCE_STYLES
        + TAGS_PANEL_STYLES + LANGUAGE_PICKER_STYLES + SIDEBAR_STYLES
        + COMMENT_STYLES + COMMENT_CARD_STYLES + COMMENTS_PANE_STYLES + LEADER_LINE_STYLES + SEARCH_STYLES + MATCH_SCROLLBAR_STYLES + COMMENT_NOTE_STYLES + CODE_COPY_STYLES + TABLE_GRIP_STYLES + FOLD_STYLES + FORMAT_PAINTER_STYLES + IMAGE_VIEW_STYLES + MEDIA_VIEW_STYLES + FOOTNOTE_STYLES + SNIPPET_STYLES
        + CHANGE_STYLES + REVIEW_PANE_STYLES + ORIGINAL_OVERLAY_STYLES
        + STATISTICS_DIALOG_STYLES
        + BRAND_STYLES
        + ABOUT_DIALOG_STYLES
        + THEME_MENU_STYLES;
      document.head.appendChild(styleElement);
    } else {
      // Stylesheet already present in document.head: skip duplicate injection.
    }

    // Step 2: Install theme controller, resolving default to 'system' mode.
    const initialThemeMode: ThemeMode = options.initialThemeMode ?? 'system';
    this.themeMode = initialThemeMode;
    this.themeController = installTheme(document, window, initialThemeMode);

    // Step 3: Build the DOM hierarchy using createElement and textContent only (never innerHTML).
    this.mount = options.mount;
    this.mount.textContent = '';

    this.shellElement = document.createElement('div');
    this.shellElement.className = 'kdoc-shell';

    // Build Toolbar
    this.toolbarElement = document.createElement('div');
    this.toolbarElement.className = 'kdoc-toolbar';
    // The window is frameless, so this bar is its title bar: dragging an empty part of it moves the window and a
    // double-click maximises. Tauri only starts a drag when the pressed element itself carries the attribute.
    this.toolbarElement.setAttribute('data-tauri-drag-region', '');

    const brand = document.createElement('span');
    brand.className = 'kdoc-brand';
    // The K-Tech mark replaces the K of the product name, so the K never appears twice (K-Tech brand rule).
    brand.appendChild(createProductWordmark(document, '-Doc', 'K-Doc'));
    brand.setAttribute('data-tauri-drag-region', '');
    this.toolbarElement.appendChild(brand);

    this.menuBarContainer = document.createElement('div');
    this.menuBarContainer.className = 'kdoc-menu-bar-container';
    this.toolbarElement.appendChild(this.menuBarContainer);

    // Open, Save and Save As live in the File menu only. The file menu still builds its buttons into this group,
    // which is deliberately never mounted, so the bar stays a single quiet row and the file logic is unchanged.
    this.fileGroup = document.createElement('div');
    this.fileGroup.className = 'kdoc-file-group';

    const spacer = document.createElement('div');
    spacer.className = 'kdoc-spacer';
    spacer.setAttribute('data-tauri-drag-region', '');
    this.toolbarElement.appendChild(spacer);

    // Build Segmented View Switcher Control
    const segmented = document.createElement('div');
    segmented.className = 'kdoc-segmented';
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', 'View mode');

    this.kdocButton = document.createElement('button');
    this.kdocButton.type = 'button';
    this.kdocButton.textContent = 'K-Doc';
    this.kdocButton.addEventListener('click', (): void => {
      this.setViewMode('kdoc');
    });
    segmented.appendChild(this.kdocButton);

    this.splitButton = document.createElement('button');
    this.splitButton.type = 'button';
    this.splitButton.textContent = 'Split';
    this.splitButton.addEventListener('click', (): void => {
      this.setViewMode('split');
    });
    segmented.appendChild(this.splitButton);

    this.sourceButton = document.createElement('button');
    this.sourceButton.type = 'button';
    this.sourceButton.textContent = 'Source';
    this.sourceButton.addEventListener('click', (): void => {
      this.setViewMode('source');
    });
    segmented.appendChild(this.sourceButton);

    this.toolbarElement.appendChild(segmented);

    this.outlineButton = document.createElement('button');
    this.outlineButton.type = 'button';
    this.outlineButton.className = 'kdoc-outline-toggle';
    this.outlineButton.textContent = 'Outline';
    this.outlineButton.setAttribute('aria-pressed', 'true');
    this.outlineButton.addEventListener('click', (): void => {
      // Toggles the sidebar panel rather than the pane's own visibility. Two mechanisms controlling
      // whether the outline is on screen would disagree the moment either was used alone; the sidebar
      // owns that now, and the button's pressed state is mirrored from its onActiveChange.
      this.sidebar.toggle('outline');
    });
    // Not mounted: the rail's Outline item and View > Panels > Toggle Outline do this job. The button stays as
    // the command's target and as the mirror of the sidebar's state.

    this.scrollLockButton = document.createElement('button');
    this.scrollLockButton.type = 'button';
    this.scrollLockButton.className = 'kdoc-outline-toggle';
    this.scrollLockButton.textContent = 'Sync Scroll';
    this.scrollLockButton.title = 'Keep the two panes scrolled to the same block';
    this.scrollLockButton.setAttribute('aria-pressed', 'true');
    this.scrollLockButton.addEventListener('click', (): void => {
      // Null only during construction, which the user cannot click through.
      if (this.scrollSync === undefined) {
        // Sync not installed yet: nothing to toggle.
        return;
      } else {
        // Installed: flip the lock and mirror the new state on the button.
        this.scrollSync.setLocked(!this.scrollSync.locked);
        this.scrollLockButton.setAttribute('aria-pressed', this.scrollSync.locked ? 'true' : 'false');
      }
    });
    // Not mounted: View > Panels > Sync Scroll toggles the lock through this button's handler.

    // Hides or shows the whole ribbon row to give the document more height; Ctrl+F1 still cycles all three states.
    this.ribbonToggleButton = document.createElement('button');
    this.ribbonToggleButton.type = 'button';
    this.ribbonToggleButton.className = 'kdoc-ribbon-toggle';
    this.ribbonToggleButton.addEventListener('click', (): void => {
      this.toggleRibbonVisibility();
    });
    this.toolbarElement.appendChild(this.ribbonToggleButton);

    // Build Theme Button labelled with current mode
    this.themeButton = document.createElement('button');
    this.themeButton.type = 'button';
    this.themeButton.className = 'kdoc-theme-toggle';
    this.themeButton.textContent = this.formatThemeMode(this.themeMode);
    this.themeButton.addEventListener('click', (): void => {
      this.themeMenu.toggle();
    });
    this.toolbarElement.appendChild(this.themeButton);
    this.themeMenu = installThemeMenu({
      doc: document,
      anchor: this.themeButton,
      state: () => ({
        mode: this.themeMode,
        uiTheme: this.settings.appearance.uiTheme,
        resolvedMode: this.themeController.tokens.mode,
      }),
      onChooseMode: (mode: ThemeMode): void => {
        this.chooseAppearance({ theme: mode });
      },
      onChooseTheme: (id: UiThemeId): void => {
        this.chooseAppearance({ uiTheme: id });
      },
    });

    this.windowControls = installWindowControls({
      doc: document,
      container: this.toolbarElement,
      api: tauriWindowApi(window),
      onError: (error: unknown): void => {
        // Show the failure in the status bar's live region rather than losing it.
        this.showMessage(`Window control failed: ${error instanceof Error ? error.message : String(error)}`, true);
      },
    });
    // Closing the window -- the title-bar button, Alt+F4, the taskbar -- asks about every unsaved document first.
    void installCloseGuard(tauriCloseRequests(window), (): Promise<boolean> => this.confirmCloseAll(), (error: unknown): void => {
      this.showMessage(`Could not check for unsaved work: ${error instanceof Error ? error.message : String(error)}`, true);
    });
    // A file moved or renamed in another K-Doc window is followed here too, so this window never saves to the old path.
    if ('__TAURI_INTERNALS__' in window) {
      listen<{ readonly from: string; readonly to: string; readonly origin: string }>('kdoc://path-moved', (event): void => {
        // Only another window's move needs following; this window followed its own when it made it.
        if (event.payload.origin !== this.journalPrefix) {
          this.followMovedPath(event.payload.from, event.payload.to);
        } else {
          // Our own announcement: already followed.
        }
      }).catch((error: unknown): void => {
        this.showMessage(`Could not listen for files moved in other windows: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      // The browser build has one window and no host to relay events.
    }

    this.shellElement.appendChild(this.toolbarElement);

    const ribbonRow = document.createElement('div');
    this.ribbonRow = ribbonRow;
    this.shellElement.appendChild(ribbonRow);

    // The document tabs sit directly under the ribbon, between it and the find row.
    this.tabBarRow = document.createElement('div');
    this.shellElement.appendChild(this.tabBarRow);

    this.findRow = document.createElement('div');
    this.shellElement.appendChild(this.findRow);

    // Build Editor Panes Container
    this.panesElement = document.createElement('div');
    this.panesElement.className = 'kdoc-panes';

    // The outline's own element. It is created here and handed to the sidebar as a panel body rather
    // than appended to the panes directly, because the sidebar owns where a panel is shown.
    this.outlineNav = document.createElement('nav');

    // The navigation node is created here and handed to the sidebar as this panel's body;
    // the sidebar owns where any given panel is actually rendered on screen.
    this.commentsNav = document.createElement('div');

    const commentsPanel: SidebarPanel = {
      id: 'comments',
      label: 'Comments',
      icon: 'comments',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.commentsNav);
      },
    };

    // Created here and handed to the sidebar as a panel body, because the sidebar owns where a panel is shown.
    this.reviewNav = document.createElement('div');

    const reviewPanel: SidebarPanel = {
      id: 'review',
      label: 'Review',
      icon: 'review',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.reviewNav);
      },
    };

    const outlinePanel: SidebarPanel = {
      id: 'outline',
      label: 'Outline',
      icon: 'outline',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.outlineNav);
      },
    };

    // Built before the panels, because each of them reads the vault on its very first draw. Creating
    // it beside the other services further down left three panels asking an undefined field for its
    // status, which is a blank window rather than an empty one.
    this.vault = createVaultService({
      win: window,
      // Every panel reads the same index, so one notification redraws all three rather than each
      // subscribing separately and redrawing at a different moment from its neighbours.
      onChange: (): void => {
        // A different folder (or none) is now the vault: its folder list has to be read before the tree can show empty folders.
        if (this.vault.status.root !== this.vaultFoldersRoot) {
          this.vaultFoldersRoot = this.vault.status.root;
          this.vaultFolders = [];
          void this.loadVaultFolders();
        } else {
          // The same vault: the folder list is reloaded only after a tree operation, which calls refreshVaultTree.
        }
        this.filesPanel.refresh();
        this.searchPanel.refresh();
        this.tagsPanel.refresh();
        // These two also read the index: backlinks are drawn from it, and a link is only broken
        // relative to the notes it could have named.
        this.backlinksPanel.refresh();
        this.problemsPanel.refresh();
      },
    });

    // The three vault panels. Each is handed plain functions rather than the service itself, so the
    // panel can be tested without one and the service can change shape without three panels
    // following it.
    this.vaultFiles = createVaultFiles(window);
    this.templatePicker = installPickerDialog({ doc: document, ariaLabel: 'New note from template', placeholder: 'Type a template name…', emptyText: 'No matching templates', limit: 100 });
    this.fileTreeActions = createFileTreeActions({
      files: this.vaultFiles,
      root: (): string | null => this.vault.status.root,
      tree: (): readonly TreeNode[] => buildFileTree(this.vault.notes, this.vaultFolders),
      ask: (title: string, label: string, initial: string): Promise<string | null> => this.promptDialog.ask(title, label, initial),
      confirm: async (heading: string, message: string, yes: string): Promise<boolean> => (await this.confirmDialog.ask(message, { heading, confirm: yes, discard: null, cancel: 'Cancel' })) === 'save',
      pickTemplate: (templates: readonly VaultTemplate[]): Promise<VaultTemplate | null> => this.pickTemplate(templates),
      readText: async (path: string): Promise<string> => (await this.fileService.readFile(path)).contents,
      refresh: (): Promise<void> => this.refreshVaultTree(),
      moved: (from: string, to: string): void => {
        this.followMovedPath(from, to);
        this.announceMove(from, to);
      },
      trashed: (paths: readonly string[]): void => { this.closeTrashedTabs(paths); },
      open: (path: string): void => { this.navHistory.recordJump(); this.openOrActivatePath(path); },
      reveal: (path: string): void => { this.fileService.revealInFileManager(path).catch((caught: unknown): void => { this.showMessage(caught instanceof Error ? caught.message : String(caught)); }); },
      showMessage: (text: string): void => { this.showMessage(text); },
    });

    this.filesPanel = installFilesPanel({
      doc: document,
      notes: (): readonly { readonly path: string; readonly relative: string; readonly title: string }[] =>
        this.vault.notes,
      root: (): string | null => this.vault.status.root,
      scanning: (): boolean => this.vault.status.scanning,
      canOpen: (): boolean => this.vault.available,
      openVault: (): void => {
        void this.openVaultFolder();
      },
      // A note already open is switched to, not opened a second time: clicking it in the tree is a way back to it.
      openNote: (path: string): void => {
        this.navHistory.recordJump();
        this.openOrActivatePath(path);
      },
      folders: (): readonly string[] => this.vaultFolders,
      actions: this.fileTreeActions,
      showMenu: (x: number, y: number, entries: readonly PopupMenuEntry[]): void => { this.popupMenu.openAt(x, y, entries); },
    });

    // The Search panel's text comes from here: an open tab's text when the note is open, since that is what the user sees, and the file otherwise.
    this.vaultSearch = createVaultSearchController({
      notes: (): readonly { readonly path: string; readonly relative: string }[] => this.vault.notes,
      openText: (path: string): string | null => this.openNoteText(path),
      writeOpen: (path: string, text: string): void => { this.writeOpenNote(path, text); },
      readFile: (path: string): Promise<{ readonly contents: string; readonly encoding: string }> => this.fileService.readFile(path),
      saveFile: (target: { readonly path: string; readonly contents: string; readonly encoding: string }): Promise<void> => this.fileService.saveFile(target),
      // A note rewritten on disk changes what the vault index holds for it: its headings, links and tags.
      onWritten: (path: string, text: string): void => { this.vault.update(path, text); },
    });

    this.searchPanel = installSearchPanel({
      doc: document,
      hasVault: (): boolean => this.vault.status.root !== null,
      search: (query, options, signal) => this.vaultSearch.search(query, options, signal),
      replace: (request) => this.vaultSearch.replace(request),
      undoReplace: () => this.vaultSearch.undoLastReplace(),
      canUndo: (): boolean => this.vaultSearch.canUndo,
      openMatch: (path: string, match: FileMatch): void => { void this.openSearchMatch(path, match); },
    });

    this.tagsPanel = installTagsPanel({
      doc: document,
      hasVault: (): boolean => this.vault.status.root !== null,
      tags: (): readonly { readonly tag: string; readonly count: number }[] => this.vault.tags(),
      notesTagged: (tag: string): readonly {
        readonly path: string;
        readonly relative: string;
        readonly title: string;
      }[] => this.vault.tagged(tag),
      openNote: (path: string): void => {
        this.navHistory.recordJump();
        void this.openNoteFromVault(path);
      },
    });

    // The right sidebar's four new surfaces. Like the vault panels, each is handed plain functions
    // rather than a service, so it can be tested without one.
    //
    // Every accessor that reads this.fileMenu, this.documentSession or this.spellCheck checks it
    // against undefined first. Those three are declared with `!:` and assigned further down the
    // constructor than this, and a panel runs its own refresh() once while installing -- so the very
    // first draw happens before the shell has finished building itself. Reading through an undefined
    // field there is a blank window rather than a caught error.
    // A plugin runs in a worker of its own, with no DOM, no filesystem and no way out to the network
    // (FR-14.18). The host is built here and asked to read the folder once the shell is up.
    this.pluginHost = createPluginHost({ win: window });

    this.pluginsPanel = installPluginsPanel({
      doc: document,
      plugins: () => this.pluginHost.plugins,
      problems: () => this.pluginHost.problems,
      showPanel: async (pluginId: string, id: string): Promise<string> => {
        const answer = await this.pluginHost.run(pluginId, 'panel', id, this.documentSession.snapshot.text);
        // Check whether the plugin answered with anything to show.
        if (answer.text === null) {
          // Nothing: say so where its answer would have been, rather than leaving the panel blank.
          return 'The plugin showed nothing.';
        } else {
          return answer.text;
        }
      },
      reload: (): void => {
        void this.reloadPlugins();
      },
      openFolder: (): void => {
        void this.openPluginsFolder();
      },
    });

    this.backlinksPanel = installBacklinksPanel({
      doc: document,
      hasVault: (): boolean => this.vault.status.root !== null,
      documentPath: (): string | null => {
        // Check whether the file menu, which owns the open file's path, exists yet.
        if (this.fileMenu === undefined) {
          // Still building: no path to report.
          return null;
        } else {
          // Built: the path it holds is the document's, and null there means never saved.
          return this.fileMenu.filePath;
        }
      },
      backlinks: (): readonly { readonly path: string; readonly relative: string; readonly title: string; readonly context: string }[] => {
        const path: string | null = this.fileMenu === undefined ? null : this.fileMenu.filePath;

        // Check whether the document has a path for other notes to have linked to.
        if (path === null) {
          // No path: nothing can name it, so there is nothing to look up.
          return [];
        } else {
          // Saved: ask the index what refers to it, and flatten to what the panel draws.
          return this.vault.backlinks(path).map((entry: Backlink): { readonly path: string; readonly relative: string; readonly title: string; readonly context: string } => ({
            path: entry.from.path,
            relative: entry.from.relative,
            title: entry.from.title,
            context: entry.link.context,
          }));
        }
      },
      openNote: (path: string): void => {
        this.navHistory.recordJump();
        void this.openNoteFromVault(path);
      },
    });

    this.historyPanel = installHistoryPanel({
      doc: document,
      entries: (): readonly {
        readonly index: number;
        readonly at: number;
        readonly pane: 'kdoc' | 'source';
        readonly words: number;
      }[] => {
        // Check whether the session, which owns the timeline, exists yet.
        if (this.documentSession === undefined) {
          // Still building: there is no document, so there is no history of one.
          return [];
        } else {
          // Built: the position in the timeline is the index the panel hands back to restore().
          return this.documentSession.timeline.map(
            (entry: HistoryEntry, index: number): {
        readonly index: number;
        readonly at: number;
        readonly pane: 'kdoc' | 'source';
        readonly words: number;
      } => ({
              index,
              at: entry.at,
              pane: entry.pane,
              words: countWords(entry.text),
            }),
          );
        }
      },
      currentWords: (): number => {
        // Check whether the session exists yet.
        if (this.documentSession === undefined) {
          // Still building: an absent document holds no words.
          return 0;
        } else {
          // Built: count what is in the buffer now, which is what every row is compared against.
          return countWords(this.documentSession.snapshot.text);
        }
      },
      now: (): number => Date.now(),
      restore: (index: number): void => {
        this.restoreVersion(index);
      },
      browseVersions: (): void => {
        this.showVersionHistory();
      },
    });

    this.metadataPanel = installMetadataPanel({
      doc: document,
      documentPath: (): string | null => {
        // Check whether the file menu exists yet.
        if (this.fileMenu === undefined) {
          // Still building: no path to report.
          return null;
        } else {
          // Built: report the open file's path.
          return this.fileMenu.filePath;
        }
      },
      frontMatter: (): Readonly<Record<string, unknown>> | null => {
        // Check whether the session exists yet.
        if (this.documentSession === undefined) {
          // Still building: no document, so no front matter.
          return null;
        } else {
          // Built: a document with no front-matter block parses to null, which the panel reads as None.
          return this.documentSession.snapshot.document.frontMatter?.data ?? null;
        }
      },
      statistics: (): MetadataStatistics => {
        // Check whether the session exists yet.
        if (this.documentSession === undefined) {
          // Still building: analysing the empty string gives the zeroes an absent document deserves,
          // rather than a shape assembled by hand here that could drift from the real one.
          return analyzeText('');
        } else {
          // Built: count the text as it stands.
          return analyzeText(this.documentSession.snapshot.text);
        }
      },
    });

    this.fidelity = createFidelityController({
      // Read at each save, so turning developer mode on applies from the next save without a restart.
      enabled: (): boolean => this.settings.general.developerMode,
      onReport: (findings): void => {
        this.problemsPanel.refresh();
        // Check whether the save changed anything it should not have.
        if (findings.length > 0) {
          // It did: say so, since the Problems panel may not be the one showing.
          this.showMessage(`Fidelity Check: ${findings.length} unedited region(s) changed on save. See Problems.`);
        } else {
          // Clean save: the panel already shows nothing, and a message for every save would be noise.
        }
      },
    });

    this.pathProbe = createPathProbe(window);
    this.lint = createLintController({
      // Read when the problems are computed, so a Save As is followed without re-creating anything.
      // The file menu is built per mounted document, so it is undefined while the shell is constructing.
      documentPath: (): string | null => (this.fileMenu === undefined ? null : this.fileMenu.filePath),
      exist: (paths: readonly string[]): Promise<readonly boolean[]> => this.pathProbe.exist(paths),
      canProbe: (): boolean => this.pathProbe.available,
      // An answer about image files changes what the panel shows even though the text did not change.
      onChange: (): void => {
        this.problemsPanel.refresh();
      },
      onError: (message: string): void => {
        this.showMessage(message);
      },
    });

    this.problemsPanel = installProblemsPanel({
      doc: document,
      problems: (): readonly Problem[] => this.currentProblems(),
      reveal: (kind: ProblemKind, from: number, to: number): void => {
        this.revealProblem(kind, from, to);
      },
      // A quick fix is an ordinary edit, so it can be undone like any other (FR-12.7).
      fix: (fix: ProblemFix): void => {
        this.applyProblemFix(fix);
      },
    });

    this.linkDefinitionsPanel = installLinkDefinitionsPanel({
      doc: document,
      // Before the first document is mounted there is no session to read.
      definitions: () => (this.documentSession === undefined ? [] : linkDefinitions(this.documentSession.snapshot.document)),
      reveal: (offset: number): void => {
        this.navHistory.recordJump();
        // A definition is only editable as source, and K-Doc has no caret position inside it, so it is shown in Source.
        this.revealSourceOffset(offset);
      },
      convert: (): void => {
        this.convertToReferenceLinks();
      },
    });

    const filesPanelEntry: SidebarPanel = {
      id: 'files',
      label: 'Files',
      icon: 'files',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.filesPanel.element);
      },
    };

    const searchPanelEntry: SidebarPanel = {
      id: 'search',
      label: 'Search',
      icon: 'search',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.searchPanel.element);
      },
      // Showing a search panel and leaving the caret somewhere else makes the user click the box
      // they just asked for.
      activate: (): void => {
        this.searchPanel.focus();
      },
    };

    const tagsPanelEntry: SidebarPanel = {
      id: 'tags',
      label: 'Tags',
      icon: 'tags',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.tagsPanel.element);
      },
    };

    const backlinksPanelEntry: SidebarPanel = {
      id: 'backlinks',
      label: 'Backlinks',
      icon: 'backlinks',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.backlinksPanel.element);
      },
    };

    const historyPanelEntry: SidebarPanel = {
      id: 'history',
      label: 'History',
      icon: 'history',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.historyPanel.element);
      },
    };

    const metadataPanelEntry: SidebarPanel = {
      id: 'metadata',
      label: 'Metadata',
      icon: 'metadata',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.metadataPanel.element);
      },
    };

    const linkDefinitionsPanelEntry: SidebarPanel = {
      id: 'link-definitions',
      label: 'Link Definitions',
      icon: 'link-definitions',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.linkDefinitionsPanel.element);
      },
    };

    const pluginsPanelEntry: SidebarPanel = {
      id: 'plugins',
      label: 'Plugins',
      icon: 'plugins',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.pluginsPanel.element);
      },
    };

    const problemsPanelEntry: SidebarPanel = {
      id: 'problems',
      label: 'Problems',
      icon: 'problems',
      mount: (container: HTMLElement): void => {
        container.appendChild(this.problemsPanel.element);
      },
    };

    this.sidebar = installSidebar({
      doc: document,
      // Outline first: it is the panel worth seeing unasked, and the only one that says anything
      // about a document with no vault behind it.
      panels: [outlinePanel, filesPanelEntry, searchPanelEntry, tagsPanelEntry],
      // Rail only at first: the document gets the width until the reader opens a panel.
      startCollapsed: true,
      onActiveChange: (panelId: string | null): void => {
        // The outline button in the toolbar and the sidebar rail describe the same state, so the
        // button mirrors whatever the sidebar decided rather than tracking its own idea of it.
        this.outlineButton.setAttribute('aria-pressed', panelId === 'outline' ? 'true' : 'false');

        // Check whether a panel is showing or the sidebar has collapsed.
        if (panelId === null) {
          // Collapsed: keep the last panel, which is what the shortcut reopens onto.
        } else {
          // Showing: remember it.
          this.lastSidebarPanelId = panelId;
        }
      },
    });
    this.panesElement.appendChild(this.sidebar.element);

    // FR-10.2 puts the margin comment pane on the right, and FR-14.7 asks for a right panel holding Comments and its neighbours;
    // both were previously built into the left sidebar next to the outline, which was a deviation rather than a reading of an ambiguous spec.
    // It starts collapsed because a comments column nobody opened is only lost width, whereas the outline is
    // worth seeing unasked - which is why the left host still opens on its first panel.
    this.rightSidebar = installSidebar({
      doc: document,
      side: 'right',
      startCollapsed: true,
      // Comments stays first and Review stays last. Reordering panels a user has already learned
      // to find moves a target for no reason; the new surfaces go between them.
      panels: [
        commentsPanel,
        backlinksPanelEntry,
        historyPanelEntry,
        metadataPanelEntry,
        problemsPanelEntry,
        linkDefinitionsPanelEntry,
        pluginsPanelEntry,
        reviewPanel,
      ],
      onActiveChange: (panelId: string | null): void => {
        // Remember the last panel shown, so Ctrl+Shift+R reopens it rather than always opening Comments.
        if (panelId !== null) {
          this.lastRightPanelId = panelId;
        } else {
          // Collapsed: keep the panel it was showing.
        }
        // Opening or collapsing the right sidebar shifts the card's geometry; redrawing to where it used to sit would point at stale text, and a line aimed wrong is worse than no line at all.
        this.scheduleLeaderLine();
      },
    });

    this.kdocPane = document.createElement('div');
    this.kdocPane.className = 'kdoc-pane';
    this.panesElement.appendChild(this.kdocPane);

    this.secondaryDividerElement = document.createElement('div');
    this.secondaryDividerElement.hidden = true;
    this.panesElement.appendChild(this.secondaryDividerElement);

    this.secondaryPane = document.createElement('div');
    this.secondaryPane.className = 'kdoc-pane';
    // Its own scroll position is the point of the second pane, so it is a separate scrolling box and
    // is deliberately left out of the Source/K-Doc scroll sync.
    this.secondaryPane.hidden = true;
    this.panesElement.appendChild(this.secondaryPane);

    this.splitDividerElement = document.createElement('div');
    this.panesElement.appendChild(this.splitDividerElement);

    this.sourcePane = document.createElement('div');
    this.sourcePane.className = 'kdoc-pane';
    this.panesElement.appendChild(this.sourcePane);

    this.externalOpener = createExternalOpener(window);
    // One card for the life of the shell: it watches the K-Doc pane's element, which survives every
    // document mount, so re-creating it per tab would only stack duplicate listeners.
    this.linkHoverCard = installLinkHoverCard({
      doc: document,
      win: window,
      pane: this.kdocPane,
      describe: (href: string): LinkCardContent => this.describeLink(href),
      follow: (href: string): void => {
        void this.followLink(href);
      },
    });

    // The overlay is absolutely positioned over the panes, so the panes need to be its containing block.
    this.panesElement.style.position = 'relative';
    this.originalOverlay = document.createElement('div');
    this.originalOverlay.className = 'kdoc-original-overlay';
    // The overlay only exists for one of the four markup modes, so it starts out of the way and the panes behave exactly as they did before it was added.
    this.originalOverlay.hidden = true;

    const originalBanner = document.createElement('div');
    originalBanner.className = 'kdoc-original-banner';
    originalBanner.textContent = 'Original — read only';
    this.originalOverlay.appendChild(originalBanner);

    this.originalBody = document.createElement('div');
    this.originalBody.className = 'kdoc-original-body';
    this.originalOverlay.appendChild(this.originalBody);
    // The Original view is rendered HTML, so a link in it must never navigate the webview: open it the way the editor does.
    routeRenderedLinks(this.originalBody, (href: string): void => void this.followLink(href));

    this.panesElement.appendChild(this.originalOverlay);

    // Appended last — after both panes and the Original overlay — so the flex row lays out as left rail, panes, right rail;
    // DOM order is the layout here, there being no explicit ordering.
    this.panesElement.appendChild(this.rightSidebar.element);

    // Both hosts are mounted now, so their footprint can be measured; the reserve keeps re-measuring as panels open, close or resize.
    this.paneReserve = installPaneReserve({ panes: this.panesElement, left: this.sidebar.element, right: this.rightSidebar.element, win: window });

    // Give the Source pane a positioning context so the absolutely positioned strip anchors to it instead of measuring itself against the viewport.
    this.sourcePane.style.position = 'relative';

    // Build the gutter overlay detached from any parent until mounted below.
    this.matchScrollbar = createMatchScrollbar(document);

    // Mount the strip inside the Source pane so it sits beside that pane's own scrollbar.
    this.sourcePane.appendChild(this.matchScrollbar.element);

    this.leaderLayer = createLeaderLayer(document);
    // Appended last, after the sidebars and panes, so nothing else paints over it; the layer's pointer-events: none (set in LEADER_LINE_STYLES) is what makes that safe — a click meant for a card underneath still lands on the card.
    this.panesElement.appendChild(this.leaderLayer.element);

    this.handleLeaderScroll = (): void => {
      this.scheduleLeaderLine();
    };
    this.handleLeaderResize = (): void => {
      this.scheduleLeaderLine();
    };

    // A scroll event does not bubble, so an ancestor listener only ever observes it during the capture phase; capture: true is therefore mandatory here — without it this panesElement listener would never fire. passive lets the browser keep scrolling smooth while we merely schedule a redraw.
    this.panesElement.addEventListener('scroll', this.handleLeaderScroll, { capture: true, passive: true });

    // Resizing changes every pane and card's geometry so the line must be recomputed; window is targeted because resize fires on it rather than on any individual pane.
    window.addEventListener('resize', this.handleLeaderResize);

    this.shellElement.appendChild(this.panesElement);

    // Build Status Bar
    this.statusBarElement = document.createElement('div');
    this.statusBarElement.className = 'kdoc-status';

    const dirtyItem = document.createElement('div');
    dirtyItem.className = 'kdoc-status-item';
    this.statusDot = document.createElement('span');
    this.statusDot.className = 'kdoc-dot';
    this.statusDirtyText = document.createElement('span');
    dirtyItem.appendChild(this.statusDot);
    dirtyItem.appendChild(this.statusDirtyText);

    this.statusFileName = document.createElement('span');
    this.statusFileName.setAttribute('aria-label', 'Current file');

    this.statusLock = document.createElement('button');
    this.statusLock.type = 'button';
    this.statusLock.className = 'kdoc-status-button';
    this.statusLock.textContent = 'Locked';
    this.statusLock.title = 'This file is read-only. Unlock it to edit.';
    this.statusLock.setAttribute('aria-label', 'Document locked; unlock to edit');
    // Hidden until a locked document is mounted, so the bar says nothing about a file that is fine.
    this.statusLock.hidden = true;
    this.statusLock.addEventListener('click', (): void => {
      void this.unlockDocument();
    });

    // A count the reader wants to act on should be the way in to the detail, rather than making them
    // hunt through a menu for the same number they are already looking at (FR-14.5).
    this.statusWordCount = document.createElement('button');
    this.statusWordCount.type = 'button';
    this.statusWordCount.className = 'kdoc-status-button';
    this.statusWordCount.setAttribute('aria-label', 'Word count. Opens statistics.');
    this.statusWordCount.title = 'Statistics';
    this.statusWordCount.addEventListener('click', (): void => {
      // The reader clicked the statistic they were already reading; open its detail dialog.
      this.statisticsDialog.open();
    });

    // Character and paragraph counts sit beside the word count because FR-12.5 asks for all four
    // live in the status bar, and a reader comparing them wants them adjacent.
    this.statusCharCount = document.createElement('span');
    this.statusCharCount.setAttribute('aria-label', 'Character count');

    this.statusParagraphCount = document.createElement('span');
    this.statusParagraphCount.setAttribute('aria-label', 'Paragraph count');

    this.statusReadingTime = document.createElement('span');
    this.statusReadingTime.setAttribute('aria-label', 'Reading time');

    this.statusFocus = document.createElement('span');
    this.statusFocus.setAttribute('aria-label', 'Focused pane');

    // The indicator already names the current mode, so clicking it to change the thing it names is the
    // shortest path there rather than routing through a menu (FR-14.5).
    this.statusViewMode = document.createElement('button');
    this.statusViewMode.type = 'button';
    this.statusViewMode.className = 'kdoc-status-button';
    this.statusViewMode.setAttribute('aria-label', 'View mode. Click to switch.');
    this.statusViewMode.title = 'Switch view';
    this.statusViewMode.addEventListener('click', (): void => {
      // Compute the next mode from the current one and apply it; setViewMode persists and notifies.
      this.setViewMode(nextViewMode(this.currentViewMode));
    });

    // New encoding segment so the user can change what the next save writes straight from the status bar.
    this.statusEncoding = document.createElement('button');
    this.statusEncoding.type = 'button';
    this.statusEncoding.className = 'kdoc-status-button';
    this.statusEncoding.setAttribute('aria-label', 'Encoding. Click to change what the next save writes.');
    this.statusEncoding.title = 'Encoding';
    this.statusEncoding.addEventListener('click', (): void => {
      // Advance to the next encoding in ENCODING_CYCLE.
      this.cycleEncoding();
    });

    this.statusLanguage = document.createElement('button');
    this.statusLanguage.type = 'button';
    this.statusLanguage.className = 'kdoc-status-button';
    this.statusLanguage.textContent = DEFAULT_SETTINGS.proofing.language;
    this.statusLanguage.addEventListener('click', (): void => {
      this.chooseLanguage();
    });
    this.spellingLanguagePicker = installPickerDialog({ doc: document, ariaLabel: 'Spelling language', placeholder: 'Type a language…', emptyText: 'No matching languages', limit: 100 });
    this.flavourPicker = installPickerDialog({ doc: document, ariaLabel: 'Markdown flavour', placeholder: 'Type a flavour…', emptyText: 'No matching flavours', limit: 10 });
    this.exportThemes = createThemeFiles(window, 'export', EXPORT_THEMES, EXPORT_THEMES['default'] ?? '');
    this.exportThemePicker = installPickerDialog({ doc: document, ariaLabel: 'Export theme', placeholder: 'Type a theme…', emptyText: 'No matching themes', limit: 50 });
    this.pluginExportPicker = installPickerDialog({ doc: document, ariaLabel: 'Plugin export format', placeholder: 'Type a format…', emptyText: 'No plugin adds an export format', limit: 50 });
    this.appThemes = createThemeFiles(window, 'app', {}, '');
    this.appThemePicker = installPickerDialog({ doc: document, ariaLabel: 'App theme', placeholder: 'Type a theme…', emptyText: 'No matching themes', limit: 50 });
    // Last in the head, so a theme's rules win over the app's own stylesheet without needing !important.
    this.userThemeElement = document.createElement('style');
    this.userThemeElement.id = 'kdoc-user-theme';
    document.head.appendChild(this.userThemeElement);

    this.statusMessage = document.createElement('span');
    this.statusMessage.className = 'kdoc-error';
    this.statusMessage.setAttribute('role', 'status');
    // Live region so save failures are announced rather than only drawn. Stays empty until something goes wrong.

    // Left group: save state, file name, read-only lock
    this.statusBarElement.appendChild(dirtyItem);
    this.statusBarElement.appendChild(this.statusFileName);
    this.statusBarElement.appendChild(this.statusLock);

    const statusSpacerLeft = document.createElement('div');
    statusSpacerLeft.className = 'kdoc-spacer';
    this.statusBarElement.appendChild(statusSpacerLeft);

    // Middle group: document statistics
    this.statusBarElement.appendChild(this.statusWordCount);
    this.statusBarElement.appendChild(this.statusCharCount);
    this.statusBarElement.appendChild(this.statusParagraphCount);
    this.statusBarElement.appendChild(this.statusReadingTime);

    const statusSpacerRight = document.createElement('div');
    statusSpacerRight.className = 'kdoc-spacer';
    this.statusBarElement.appendChild(statusSpacerRight);

    // Right group: focused pane, view mode, encoding, language, transient message
    this.statusBarElement.appendChild(this.statusFocus);
    this.statusBarElement.appendChild(this.statusViewMode);
    this.statusBarElement.appendChild(this.statusEncoding);
    this.statusBarElement.appendChild(this.statusLanguage);
    this.statusBarElement.appendChild(this.statusMessage);
    // Last item: hides the bar. Once hidden it cannot be clicked, so View > Panels > Status Bar shows it again.
    this.statusBarToggleButton = document.createElement('button');
    this.statusBarToggleButton.type = 'button';
    this.statusBarToggleButton.className = 'kdoc-status-toggle';
    this.statusBarToggleButton.setAttribute('aria-label', 'Hide status bar');
    this.statusBarToggleButton.title = 'Hide status bar (View > Panels > Status Bar shows it again)';
    this.statusBarToggleButton.appendChild(createIcon(document, 'chevron-down', 14));
    this.statusBarToggleButton.addEventListener('click', (): void => {
      this.setStatusBarVisible(false);
    });
    this.statusBarElement.appendChild(this.statusBarToggleButton);

    this.shellElement.appendChild(this.statusBarElement);
    // Restore the reader's last choice without re-saving it; nothing saved means shown.
    this.setStatusBarVisible(readStatusBarVisibility(statusBarStore(window)) !== 'hidden', false);
    this.mount.appendChild(this.shellElement);

    // These are global to the window rather than to a document, and mountDocument depends on every
    // one of them, so they are created before the first document rather than alongside it.
    // NOTE: This must run BEFORE the initial setViewMode call, because refreshStatusBar
    // reads this.fileMenu.fileName and must not run before the field is assigned.
    // It is the kind of thing that only fails at runtime if ordered incorrectly.
    this.confirmDialog = installConfirmDialog({ doc: document });

    // One service shared by the file menu and the external-change watcher: two instances would be
    // harmless today but would drift the moment either grew per-instance state.
    const fileService = createFileService(window);
    this.fileService = fileService;
    this.snapshotStore = createSnapshotStore({
      available: fileService.available,
      policy: () => this.settings.history,
      now: (): number => Date.now(),
    });
    this.gitService = createGitService({ available: fileService.available });

    this.linkDialog = installLinkDialog({
      doc: document,
      // Read at the moment the dialog opens rather than held, because the document it is about to
      // link into is the one on screen now, not the one that was on screen when the shell was built.
      headings: (): readonly { readonly depth: number; readonly text: string }[] =>
        buildOutline(this.documentSession.snapshot.document),
      // The dialog asks rather than being told, because whether a vault is open can change between
      // one Ctrl+K and the next. With none open this is an empty list, and the Note tab says so.
      searchNotes: (query: string): readonly { readonly title: string; readonly relative: string }[] =>
        this.vault.find(query, LINK_NOTE_RESULTS).map((match: NoteMatch): { readonly title: string; readonly relative: string } => ({
          title: match.note.title,
          relative: match.note.relative,
        })),
      // Only offered when there is a real picker behind it. In the browser build openFile resolves
      // null and the button would be a control that never does anything.
      ...(fileService.available
        ? {
            pickFile: async (): Promise<string | null> => {
              const opened = await fileService.openFile();
              // Check whether the user picked a file or dismissed the picker.
              if (opened === null) {
                // Dismissed: a cancelled picker is not an error, and the field is left as it was.
                return null;
              } else {
                // Picked: hand back the path for the dialog to put in the field.
                return opened.path;
              }
            },
          }
        : {}),
      onSubmit: (attrs: LinkAttrs): void => {
        const view = this.proseMirrorBinding.view;
        setLink(attrs)(view.state, view.dispatch);
        // Focus returns to the pane because K-Doc keys its edit lock on which pane holds focus:
        // leaving focus on a closed dialog would make the next keystroke throw.
        view.focus();
      },
    });

    this.splitDivider = installSplitDivider({
      element: this.splitDividerElement,
      doc: document,
      first: this.kdocPane,
      second: this.sourcePane,
      container: this.panesElement,
      orientation: this.settings.editor.splitOrientation,
    });

    // Each tab journals under its own id (journalIdFor); ids stay within [A-Za-z0-9_-], which the Rust side
    // enforces by rejecting anything else as a filename.
    this.journalStore = createJournalStore(window);
    this.handedOff = options.handedOff === true;

    // The menu is owned here and shared: the context menu and, later, the slash menu are two callers
    // of one popup rather than two popups that could both be open at once.
    this.popupMenu = installPopupMenu({ doc: document, win: window });

    this.imageDialog = installImageDialog({
      doc: document,
      onSubmit: (value: ImageDialogValue): void => {
        const view = this.proseMirrorBinding.view;
        insertImage(value)(view.state, view.dispatch);
        // Focus returns to the pane because K-Doc keys its edit lock on which pane holds focus.
        view.focus();
      },
    });

    this.sizePicker = installSizePicker({
      doc: document,
      win: window,
      onPick: (rows: number, columns: number): void => {
        const view = this.proseMirrorBinding.view;
        insertTable(rows, columns)(view.state, view.dispatch);
        view.focus();
      },
    });

    this.listPicker = installListPicker({
      doc: document,
      win: window,
      onPick: (scheme: ListPickerScheme, level: number): void => {
        const view = this.proseMirrorBinding.view;
        applyListScheme(scheme, level)(view.state, view.dispatch);
        view.focus();
      },
    });

    this.stylesGallery = installStylesGallery({
      doc: document,
      win: window,
      onPick: (id: StyleId): void => {
        this.applyStyle(id);
      },
    });

    this.languagePicker = installLanguagePicker({
      doc: document,
      onPick: (language: string | null): void => {
        const view = this.proseMirrorBinding.view;
        setCodeBlockLanguage(language)(view.state, view.dispatch);
        view.focus();
      },
    });

    this.aboutDialog = installAboutDialog({
      doc: document,
      version: async (): Promise<string> => {
        // Inside the desktop app the host knows its version; a browser build has no host to ask.
        if ('__TAURI_INTERNALS__' in window) {
          return getVersion();
        } else {
          return 'development build';
        }
      },
      notices: async (): Promise<string> => {
        // The release build serves the generated file beside index.html; a dev build may not have one.
        const response = await fetch('/THIRD-PARTY-NOTICES.txt');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        } else {
          return response.text();
        }
      },
    });

    this.statisticsDialog = installStatisticsDialog({
      doc: document,
      read: (): { readonly document: string; readonly selection: string } => {
        const view = this.proseMirrorBinding.view;
        const { from, to, empty } = view.state.selection;

        // Check whether anything is actually selected.
        // `textBetween` with a block separator so a multi-paragraph selection counts as several
        // paragraphs rather than one run-on line -- the paragraph count depends on the blank lines.
        const selection = empty ? '' : view.state.doc.textBetween(from, to, '\n\n', ' ');

        return { document: this.documentSession.snapshot.text, selection };
      },
    });

    this.attachments = createAttachments(window);

    this.fileDrop = installFileDrop({
      win: window,
      onInsert: (insert: DroppedInsert): void => {
        const view = this.proseMirrorBinding.view;

        // Check which kind of reference the dropped file deserves.
        if (insert.kind === 'image') {
          // An image the editor can render: embed it, so the author sees what they dropped. A dropped image is
          // copied into the attachments folder first, so the note refers to a file that travels with it (FR-6.14).
          void this.embedDroppedImage(insert.path, insert.label);
        } else {
          // Anything else -- a Markdown note, a PDF, a spreadsheet -- becomes a link. A link is always
          // expressible in Markdown, and an embed of an arbitrary file is not.
          //
          // Built as a marked text node rather than by inserting text and then running setLink: a drop
          // leaves no selection, and setLink has nothing to apply a mark to.
          const linkType = view.state.schema.marks['link'];

          // Check whether the schema has a link mark at all.
          if (linkType !== undefined) {
            // Present: insert the file's name carrying a link to its path.
            const marked = view.state.schema.text(insert.label, [
              linkType.create({ href: insert.path, title: null }),
            ]);
            view.dispatch(view.state.tr.replaceSelectionWith(marked, false));
          } else {
            // Absent: fall back to the bare path, which is still something the author can act on.
            view.dispatch(view.state.tr.insertText(insert.path));
          }
        }

        // Focus returns to the pane because K-Doc keys its edit lock on which pane holds focus.
        view.focus();
      },
      onError: (error: Error): void => {
        this.showMessage(error.message);
      },
    });

    this.spellService = createSpellService({
      win: window,
      onError: (error: Error): void => {
        this.showMessage(error.message);
      },
    });

    // The first document is mounted here; every later one arrives through activateTab.
    this.tabs = new TabSet<DocumentState>();
    // The first document may be a tab handed over from another window, carrying its baseline and encoding.
    const initialState: DocumentState = {
      text: options.initialText,
      path: options.initialPath ?? null,
      // Only carry the saved-text baseline when one was actually provided, so an ordinary launch stays unmodified.
      ...(options.initialSavedText === undefined || options.initialSavedText === null ? {} : { savedText: options.initialSavedText }),
      // Only carry the encoding when one was handed over; otherwise it defaults to UTF-8.
      ...(options.initialEncoding === undefined || options.initialEncoding === null ? {} : { encoding: options.initialEncoding }),
    };
    this.activeTabId = this.tabs.open(initialState);
    this.mountDocument(initialState);















    // Installed last because the registry closes over this.fileMenu, this.findPanel and the bindings;
    // building it earlier would capture fields that are not assigned yet.
    this.commandPalette = installCommandPalette({
      doc: document,
      commands: (): readonly KdocCommand[] => this.buildCommands(),
    });

    // One line above the status bar explains a Word shortcut K-Doc leaves unbound (FR-20.1).
    this.keyHint = installKeyHint({ doc: document, container: this.shellElement });
    this.shellElement.insertBefore(this.keyHint.element, this.statusBarElement);

    // Every remappable shortcut goes through one listener that reads the keymap (FR-14.16), replacing the
    // document listeners each feature used to add for its own keys.
    this.keymapService = installKeymapService({
      doc: document,
      keymap: (): ResolvedKeymap => this.keymap,
      commands: (): readonly KdocCommand[] => this.buildCommands(),
      scopeOf: (commandId: string) => scopeOf(commandId),
      // Read on every key: a remounted document has new editor views.
      contextOf: (target: EventTarget | null) => focusContextOf(target, this.proseMirrorBinding.view.dom, this.codeMirrorBinding.view.dom),
      explanations: UNBOUND_SHORTCUT_EXPLANATIONS,
      explain: (message: string): void => {
        this.keyHint.show(message);
      },
    });






    // The ribbon and the palette are two views of one registry, so the ribbon is given the same
    // provider function rather than its own list. A second list would drift the first time a command
    // was added to one and not the other, which is exactly what the registry exists to prevent.
    this.ribbon = installRibbon({
      container: ribbonRow,
      doc: document,
      commands: (): readonly KdocCommand[] => this.buildCommands(),
      layout: (): readonly RibbonTabSpec[] => this.ribbonLayoutSpec(),
      onStateChange: (next: RibbonState): void => {
        this.ribbonStateChanged(next);
      },
    });
    // Restore the ribbon the reader left: one hidden to save space stays hidden on the next launch.
    this.ribbon.setState(readRibbonState(ribbonStateStore(window)) ?? 'expanded');
    this.syncRibbonToggle();

    // Initialize contextual table tab visibility based on initial document caret position.
    // Check whether the caret currently sits inside a GFM table.
    if (isInTable(this.proseMirrorBinding.view.state)) {
      this.ribbon.setContextualTableTabVisible(true);
    } else {
      this.ribbon.setContextualTableTabVisible(false);
    }
    this.ribbon.refresh();

    // The dialog reads the arrangement and the registry through the same functions the ribbon does, so what
    // it offers is always what the ribbon can draw (FR-14.17).
    this.ribbonDialog = installRibbonDialog({
      doc: document,
      // The dialog opens on what the ribbon is drawing, not on the setting: a reader who has never arranged
      // it has an empty setting, and a dialog with nothing in it is no way to start from K-Doc's own ribbon.
      layout: (): readonly RibbonTabSetting[] => ribbonLayoutSetting(this.ribbonLayoutSpec()),
      commands: (): readonly KdocCommand[] => this.buildCommands(),
      onApply: (layout: readonly RibbonTabSetting[]): void => {
        this.applyRibbonLayout(layout);
      },
    });

    // The graph is built from the vault index each time it is opened, rather than kept and invalidated:
    // it is one sweep of what the index already holds, and a stale picture of a vault is worse than a pause.
    this.graphDialog = installGraphDialog({
      doc: document,
      graph: (): VaultGraph => vaultGraph(this.vault.notes),
      documentPath: (): string | null => {
        // Check whether the file menu, which owns the open file's path, exists yet.
        if (this.fileMenu === undefined) {
          // Still building: no path to report.
          return null;
        } else {
          // Built: the path it holds is the document's, and null there means never saved.
          return this.fileMenu.filePath;
        }
      },
      openNote: (path: string): void => {
        this.navHistory.recordJump();
        void this.openNoteFromVault(path);
      },
    });


    // Typography is applied from the defaults for now: the settings store exists and models every
    // field, but no Settings window writes to it yet, so this reads the defaults rather than pretending
    // to be user-configurable.
    this.applyZoom();

    // Ctrl+wheel zooms. It is registered non-passive because it must preventDefault, and a passive
    // listener cannot: the browser would zoom the whole application on top of K-Doc zooming the text.
    this.handleZoomWheel = (event: WheelEvent): void => {
      // Check for the Ctrl or Cmd modifier that distinguishes zoom from ordinary scrolling.
      if (!event.ctrlKey && !event.metaKey) {
        // Plain wheel: this is a scroll, and the panes handle it.
        return;
      } else {
        // Modified wheel: claim it as zoom.
      }

      event.preventDefault();

      // Check the wheel direction. Up (negative deltaY) enlarges, matching every other application.
      if (event.deltaY < 0) {
        this.setZoom(zoomIn(this.zoom));
      } else if (event.deltaY > 0) {
        this.setZoom(zoomOut(this.zoom));
      } else {
        // A horizontal-only wheel event: nothing to do.
      }
    };
    this.shellElement.addEventListener('wheel', this.handleZoomWheel, { passive: false });

    this.settingsStore = createSettingsStore(window);

    // The controller is the only thing that edits the list. It reads and writes it through the very
    // settings object the dialog persists, so there is never a second copy to fall out of step.
    this.recentFiles = createRecentFilesController({
      readSettings: (): KdocSettings => this.settings,
      writeSettings: (next: KdocSettings): void => {
        this.settings = next;
        this.settingsStore.save(next).catch((error: unknown): void => {
          // A recent-files entry is a convenience. Reporting the failure is right; blocking the open
          // that caused it would not be.
          this.showMessage(
            `Could not save the recent files list: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      onError: (message: string): void => {
        this.showMessage(message);
      },
    });

    this.promptDialog = installPromptDialog({ doc: document });
    this.installNavigation();
    this.windowHandoff = createWindowHandoff(window);
    // The vault is indexed on demand rather than at launch: a folder nobody has opened is a folder
    // nobody is searching, and scanning one at startup would spend the user's first second on work
    // they did not ask for. onChange is a no-op until a panel subscribes to it.
    this.mergeDialog = installMergeDialog({ doc: document });

    this.pasteSpecialDialog = installPasteSpecialDialog({ doc: document });

    this.pageSetupDialog = installPageSetupDialog({ doc: document });

    this.pasteOptionsPopup = installPasteOptionsPopup({
      doc: document,
      win: window,
      onChoose: (mode: PasteMode): void => {
        this.repaste(mode);
      },
      onMore: (): void => {
        void this.openPasteSpecial();
      },
    });

    this.recentFilesDialog = installRecentFilesDialog({
      doc: document,
      onOpen: (path: string): void => {
        this.navHistory.recordJump();
        void this.openRecentPath(path);
      },
      onTogglePin: (path: string): readonly RecentFile[] => this.recentFiles.togglePin(path),
      onForget: (path: string): readonly RecentFile[] => this.recentFiles.forget(path),
    });
    this.settingsDialog = installSettingsDialog({
      doc: document,
      initial: this.settings,
      openReplacements: (): void => {
        this.replacementsDialog.open();
      },
      openSnippets: (): void => {
        this.snippetsDialog.open();
      },
      onChange: (next: KdocSettings): void => {
        this.settings = next;
        this.applySettings();

        // Persisted on every change rather than behind an OK button. The dialog has no Cancel, so
        // there is no pending state to discard, and a preference that only survives if you remember
        // to confirm it is a preference that gets lost.
        this.settingsStore.save(next).catch((error: unknown): void => {
          // A failed save is worth reporting, unlike a failed load: the user just asked for
          // something and it did not happen.
          this.showMessage(
            `Could not save settings: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
    });

    this.zenMode = installZenMode({
      doc: document,
      setFullscreen: (fullscreen: boolean): Promise<void> =>
        // The desktop host sets its own window full screen; the browser build has no window to change, and hiding the chrome is the rest of Zen mode.
        this.fileService.available ? invoke<void>('set_window_fullscreen', { fullscreen }) : Promise.resolve(),
      onError: (message: string): void => {
        this.showMessage(message);
      },
    });

    this.presentation = installPresentation({
      doc: document,
      setFullscreen: (fullscreen: boolean): Promise<void> =>
        // As for Zen mode: the desktop host fills the screen with its own window; the browser build shows the slides in the window it has.
        this.fileService.available ? invoke<void>('set_window_fullscreen', { fullscreen }) : Promise.resolve(),
      resolveImage: (src: string): Promise<string | null> => this.loadImageSource(src),
      onError: (message: string): void => {
        this.showMessage(message);
      },
      followLink: (href: string): void => {
        void this.followLink(href);
      },
    });

    this.versionHistoryDialog = installVersionHistoryDialog({
      doc: document,
      list: (): Promise<readonly VersionEntry[]> => this.listVersions(),
      read: (id: string): Promise<string> => this.readVersion(id),
      current: (): string => this.documentSession.snapshot.text,
      now: (): number => Date.now(),
      restore: (text: string, snapshot: VersionEntry): void => {
        this.restoreSnapshot(text, snapshot);
      },
      compare: (text: string, snapshot: VersionEntry): void => {
        this.compareSnapshot(text, snapshot);
      },
      copy: (text: string): Promise<void> => navigator.clipboard.writeText(text),
    });

    this.snippetsDialog = installSnippetsDialog({
      doc: document,
      snippets: (): Readonly<Record<string, string>> => this.settings.snippets.items,
      defaults: DEFAULT_SNIPPETS,
      onChange: (items: Readonly<Record<string, string>>): void => {
        const next: KdocSettings = { ...this.settings, snippets: { ...this.settings.snippets, items } };
        this.settings = next;
        // The settings dialog keeps its own copy; without this its next change would write the old snippets back.
        this.settingsDialog.setSettings(next);
        this.applySettings();
        this.settingsStore.save(next).catch((error: unknown): void => {
          this.showMessage(`Could not save settings: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
    });

    this.replacementsDialog = installReplacementsDialog({
      doc: document,
      replacements: (): Readonly<Record<string, string>> => this.settings.autocorrect.replacements,
      defaults: DEFAULT_AUTOCORRECT_REPLACEMENTS,
      onChange: (replacements: Readonly<Record<string, string>>): void => {
        const next: KdocSettings = { ...this.settings, autocorrect: { ...this.settings.autocorrect, replacements } };
        this.settings = next;
        // The settings dialog keeps its own copy; without this its next change would write the old table back.
        this.settingsDialog.setSettings(next);
        this.applySettings();
        this.settingsStore.save(next).catch((error: unknown): void => {
          this.showMessage(`Could not save settings: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
    });

    this.keyboardShortcutsDialog = installKeyboardShortcutsDialog({
      doc: document,
      keyboard: (): KeyboardSettings => this.settings.keyboard,
      labels: () => this.buildCommands().map((command: KdocCommand) => ({ id: command.id, label: command.label, category: command.category })),
      onChange: (keyboard: KeyboardSettings): void => {
        const next: KdocSettings = { ...this.settings, keyboard };
        this.settings = next;
        // The settings dialog keeps its own copy; without this its next change would write the old shortcuts back.
        this.settingsDialog.setSettings(next);
        this.applySettings();
        this.settingsStore.save(next).catch((error: unknown): void => {
          this.showMessage(`Could not save settings: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
      // While a new shortcut is being recorded, the keys must reach the dialog rather than run commands.
      onRecording: (recording: boolean): void => {
        this.keymapService.setSuspended(recording);
      },
    });

    // Loaded after construction so a slow or failing read cannot delay the editor appearing. It runs
    // here rather than earlier because it reads the settings store, which is built above this line.
    //
    // The previous window is restored on the back of it, and only then is the crash journal offered
    // (FR-6.10, FR-6.5): recovered text is applied to whichever document is in front, so the file it
    // belongs to has to be open before the offer is made, or the work lands on the welcome document.
    void this.restoreThenRecover();

    // The in-app menu bar is generated from the same registry as the palette and the ribbon, so it
    // mirrors every command by construction rather than by a hand-kept list that could drift.
    this.appMenuBar = installAppMenuBar(this.menuBarContainer, {
      commands: (): readonly KdocCommand[] => this.buildCommands(),
      run: (commandId: string): void => {
        const command = this.buildCommands().find((cmd: KdocCommand): boolean => cmd.id === commandId);
        // Check whether the command exists in the command registry.
        if (command !== undefined) {
          command.run();
        } else {
          // Command not found in registry.
        }
      },
      // Ticks for the toggles whose state the shell owns; the others report unchecked as before.
      isChecked: (commandId: string): boolean => {
        // Check which toggle is being asked about.
        if (commandId === 'view:toggle-outline') {
          // Outline: ticked while the left sidebar is showing it.
          return this.sidebar.activePanelId === 'outline';
        } else if (commandId === 'view:toggle-sync-scroll') {
          // Sync Scroll: ticked while the lock is on.
          return this.scrollSync?.locked ?? false;
        } else if (commandId === 'view:toggle-status-bar') {
          // Status Bar: ticked while the bar is showing.
          return this.isStatusBarVisible();
        } else {
          // Any other toggle: unchecked, as before this option existed.
          return false;
        }
      },
      doc: document,
      win: window,
    });
    this.appMenuBar.refresh();

    this.tabBar = installTabBar({
      container: this.tabBarRow,
      doc: document,
      tabs: (): { views: readonly TabView[]; activeId: string | null } => this.tabViews(),
      onActivate: (id: string): void => {
        this.activateTab(id);
      },
      onClose: (id: string): void => {
        this.closeTab(id);
      },
      onReorder: (id: string, toIndex: number): void => {
        this.tabs.move(id, toIndex);
        this.tabBar.refresh();
      },
      onDetach: (id: string): void => {
        void this.detachTab(id);
      },
      onNew: (): void => {
        this.newDocument();
      },
    });

    // Ctrl+Shift+V only marks the next paste as plain. It is not a keymap command because it must not prevent the
    // key: the browser's own paste event is the only thing carrying the clipboard.
    this.handleTabKey = (event: KeyboardEvent): void => {
      // Check for the plain-paste chord.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v') {
        this.pendingPasteMode = 'plain';
      } else {
        // Any other key belongs to the keymap or to whichever pane holds focus.
      }
    };
    document.addEventListener('keydown', this.handleTabKey);

    // Step 7: Apply the initial view mode, defaulting to 'split'.
    const initialViewMode: ViewMode = options.initialViewMode ?? 'split';
    this.currentViewMode = initialViewMode;
    this.setViewMode(initialViewMode);

    // Step 8: Focus the K-Doc pane so the edit lock starts held by a real pane.
    this.proseMirrorBinding.focus();
  }

  /**
   * @purpose Offers to restore any journalled buffer left behind by an unclean exit (FR-6.3).
   * @inputs void.
   * @outputs Promise<void> - Resolves once the offer has been made and acted on, or skipped.
   * @dataflow journalStore.list -> pickRecoverable -> confirmDialog.ask -> session.reset or journal clear.
   * @controlflow List journals -> return early when none are worth offering -> ask the user -> restore, discard, or leave the journal in place.
   */
  private async offerRecovery(): Promise<void> {
    // A window opened on a handed-over document is not a launch: the journals it would find belong to
    // windows that are still open, so only an ordinary launch offers recovery.
    if (this.handedOff) {
      return;
    } else {
      // An ordinary launch: look for work a previous session left behind.
    }

    const records = await this.journalStore.list();

    // The disk text is unknown at startup because nothing has been opened yet, so every non-empty
    // journal is a candidate. Passing null rather than guessing keeps the comparison honest.
    const candidates = pickRecoverable(records, (): string | null => null);

    // Each journal is one document, so each is offered on its own, newest first.
    for (const record of candidates) {
      const choice = await this.confirmDialog.ask(
        `Unsaved work from a previous session was found: ${describeRecord(record, Date.now())}. Restore it?`,
        { heading: 'Restore unsaved work?', confirm: 'Restore', discard: 'Discard', cancel: 'Not now' },
      );

      // Check what the user chose to do with this recovered document.
      if (choice === 'save') {
        // Restore into the document the journal belongs to; from there it journals under its own tab's id,
        // so the old record is no longer needed.
        await this.restoreRecord(record);
        // Journal the restored buffer under its new tab at once, so a second crash cannot lose it.
        this.recovery.flush();
        await this.clearJournal(record.id);
        this.showMessage('Restored unsaved work from the previous session.');
      } else if (choice === 'discard') {
        // Discard: drop this journal so the offer is not repeated on the next launch.
        await this.clearJournal(record.id);
      } else {
        // Not now: leave this journal untouched so the offer survives to the next launch.
      }
    }
  }

  /**
   * @purpose Puts one recovered journal back into the document it belongs to.
   * @inputs record: JournalRecord - The journal to restore.
   * @outputs Promise<void>.
   * @dataflow record.path -> that file's tab (opened or activated) -> applyExternalText(record.contents); no path, or a file
   *   that can no longer be opened -> a new untitled document holding the contents.
   * @controlflow Restoring never writes into a document other than the record's own: when the file's tab is not the one on
   *   screen after the open, the text goes to a new untitled document instead.
   */
  private async restoreRecord(record: JournalRecord): Promise<void> {
    // Check whether the journal belonged to a saved file.
    if (record.path !== null) {
      await this.openNoteFromVault(record.path);
      const shown = this.fileMenu.filePath;
      // Check the file's own tab is on screen now (paths compared as Windows does: case and separators ignored).
      if (shown !== null && EditorShell.samePath(shown, record.path)) {
        // applyExternalText, deliberately not reset: the restored buffer must read dirty, because it is not on
        // disk, and the restore itself must be undoable.
        this.documentSession.applyExternalText(record.contents);
        return;
      } else {
        // The file could not be opened (moved or deleted): fall through to an untitled document.
      }
    } else {
      // An untitled document's journal: it gets a new untitled document.
    }
    this.newDocument(record.contents);
  }

  /**
   * @purpose Compares two file paths the way Windows does.
   * @inputs a, b: string - The paths.
   * @outputs boolean - True when they name the same file.
   * @dataflow both paths -> backslashes to slashes, lower case -> equality.
   * @controlflow No branching.
   */
  private static samePath(a: string, b: string): boolean {
    return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
  }

  /**
   * @purpose Names the crash journal a tab writes to.
   * @inputs tabId: string - The tab's id.
   * @outputs string - This launch's prefix joined to the tab id.
   * @dataflow journalPrefix + tabId -> journal id.
   * @controlflow No branching.
   */
  private journalIdFor(tabId: string): string {
    return `${this.journalPrefix}-${tabId}`;
  }

  /**
   * @purpose Deletes one crash journal, reporting rather than throwing when the store refuses.
   * @inputs id: string - The journal to delete.
   * @outputs Promise<void>.
   * @dataflow id -> journalStore.clear -> any failure to the status bar.
   * @controlflow A failure is reported and otherwise ignored: a journal left behind costs one extra offer, never data.
   */
  private async clearJournal(id: string): Promise<void> {
    try {
      await this.journalStore.clear(id);
    } catch (error: unknown) {
      // The store refused: say so; the worst outcome is that the next launch offers this journal again.
      this.showMessage(`Crash journal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @purpose Asks about every document with unsaved work before the window closes (title-bar button, Alt+F4, the taskbar).
   * @inputs void.
   * @outputs Promise<boolean> - True when the window may close; false when the user cancelled or a save did not happen.
   * @dataflow tabs -> the dirty ones in strip order -> each brought on screen and asked Save / Don't Save / Cancel -> fileMenu.save().
   * @controlflow Clean tabs are skipped; Cancel or a save that failed or was cancelled stops at once and keeps the window open;
   *   Don't Save deletes that document's crash journal so the next launch does not offer the discarded work back.
   */
  private async confirmCloseAll(): Promise<boolean> {
    this.captureActiveDocument();
    for (const tab of this.tabs.snapshot.tabs) {
      const isActive = tab.id === this.activeTabId;
      // The active document is asked directly; a background one carries the flag it was swapped out with.
      const dirty = isActive ? this.documentSession.snapshot.dirty : tab.payload.dirty === true;
      // Check whether this document has anything to lose.
      if (!dirty) {
        continue;
      } else {
        // Unsaved work: show it before asking about it.
      }
      // Check whether it is already on screen; otherwise bring it forward so the reader sees what they are deciding about.
      if (!isActive) {
        this.activateTab(tab.id);
      } else {
        // Already showing.
      }
      const choice = await this.confirmDialog.ask(
        `${this.titleFor(tab.payload)} has unsaved changes. Save them before closing?`,
        { heading: 'Save changes?', confirm: 'Save', discard: "Don't Save", cancel: 'Cancel' },
      );
      // Check what the reader decided for this document.
      if (choice === 'cancel') {
        // Cancel: the window stays open with everything as it was.
        return false;
      } else if (choice === 'save') {
        const saved = await this.fileMenu.save();
        // Check the write happened; anything short of a successful save keeps the window open.
        if (!saved) {
          return false;
        } else {
          // Written: on to the next document.
        }
      } else {
        // Don't Save: forget its crash journal too, or the next launch would offer the discarded work back.
        await this.clearJournal(this.journalIdFor(tab.id));
      }
    }
    return true;
  }

  /**
   * @purpose Returns the source offset at which each top-level block starts, in document order.
   * @inputs void.
   * @outputs readonly number[] - One start offset per top-level block.
   * @dataflow session snapshot AST root -> child node positions -> offsets.
   * @controlflow Read the root children -> take each start offset when the node carries a position -> return the list.
   */
  private topLevelBlockOffsets(): readonly number[] {
    const offsets: number[] = [];
    const children = this.documentSession.snapshot.document.root.children;

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      // Check the child is present, since noUncheckedIndexedAccess types the read as possibly undefined.
      if (node === undefined) {
        // Missing child: nothing to anchor on.
        continue;
      } else {
        // Present: read its start offset if the parser recorded one.
      }

      const offset = node.position?.start?.offset;
      // Check whether the node carries a source position. Synthesised nodes do not, and a block with
      // no offset cannot be located in the Source pane, so it is skipped rather than guessed at.
      if (offset === undefined) {
        // No recorded position: skip this block rather than inventing an offset.
        continue;
      } else {
        // Position recorded: use it as this block's anchor.
        offsets.push(offset);
      }
    }

    return offsets;
  }

  /**
   * @purpose Resolve an image's written address to a URL the pane can load, or null to use it as written (FR-8.14).
   * @inputs src - The image's written address as stored in the node attrs.
   * @outputs A promise resolving to a webview-loadable URL, or null when the address should be used as written.
   * @dataflow src → resolveImagePath against the document path → resolved absolute path (or null) → loader object URL or passthrough.
   * @controlflow Wait one microtask, derive the document path; if it is unresolved or the host cannot read files return null, else hand the path to the loader.
   *
   * The node view asks for an image while mountDocument is still building the document, before that document's
   * file menu exists, so reading the path straight away read the previous document's. mountDocument runs to
   * completion synchronously, so after one microtask the file menu is this document's -- and a later Save As is
   * followed too.
   */
  /**
   * @purpose Resolves a local video or audio address to a URL the webview can play (FR-8.17).
   * @inputs src - The address exactly as the document wrote it.
   * @outputs Promise<string | null> - A URL to play, or null to use the address as written.
   * @dataflow src -> resolveImagePath against the document's own folder -> mediaLoader.objectUrl.
   * @controlflow An address that names no file on disk, or a host that cannot read one, is left as written; the
   *   wait for a microtask is the same one loadImageSource needs, and for the same reason.
   */
  private async loadMediaSource(src: string): Promise<string | null> {
    await Promise.resolve();
    const documentPath = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    const resolved = resolveImagePath(src, documentPath);
    // Check whether the address names a file this host can read.
    if (resolved === null || !this.mediaLoader.available) {
      return null;
    } else {
      // A resolvable path in a capable host: hand it to the loader for an object URL.
    }
    return this.mediaLoader.objectUrl(resolved);
  }

  private async loadImageSource(src: string): Promise<string | null> {
    await Promise.resolve();
    // The file menu is undefined only while the very first document is still being constructed.
    const documentPath = this.fileMenu === undefined ? null : this.fileMenu.filePath;

    // Resolve the written address to an absolute path on disk when one exists.
    const resolved = resolveImagePath(src, documentPath);
    if (resolved === null || !this.imageLoader.available) {
      // The address names no file on disk or the host cannot read files: keep it as written rather than failing.
      return null;
    } else {
      // A resolvable path in a capable host: hand it to the loader for an object URL.
      return this.imageLoader.objectUrl(resolved);
    }
  }

  /**
   * @purpose Read every local image referenced by the document and map each address to an embeddable data URI (FR-13.1).
   * @inputs document - The KdocDocument whose images should be embedded in the HTML export.
   * @outputs A promise resolving to the source map and the list of addresses that could not be read.
   * @dataflow localImages(document) → per address resolve on disk → loader dataUri → sources map; failures accumulate into failed.
   * @controlflow Bail early when the host cannot read files, else iterate images skipping duplicates, resolving each, and try/catch embedding.
   */
  private async embeddableImages(
    document: KdocDocument,
  ): Promise<{ readonly sources: ReadonlyMap<string, string>; readonly failed: readonly string[] }> {
    const sources = new Map<string, string>();
    const failed: string[] = [];

    // Without a capable host there is nothing to read, so the export keeps every address as written.
    if (!this.imageLoader.available) {
      return { sources, failed };
    } else {
      // The document was just loaded through this same menu, so its path is present here.
      const documentPath = this.fileMenu.filePath;

      // A wiki embed, `![[img.png]]`, is plain text in the file rather than an image node, so its picture
      // is named separately here (FR-8.15). Its address is read the same way and embedded the same way.
      const addresses: string[] = [];
      for (const image of localImages(document)) {
        addresses.push(image.url);
      }
      for (const target of wikiEmbedTargets(document.root)) {
        addresses.push(target);
      }

      // Walk each referenced image, embedding the first occurrence of any given address only once.
      for (const address of addresses) {
        if (sources.has(address)) {
          // This address was already embedded: skip the duplicate to avoid reading it twice.
          continue;
        } else {
          // A not-yet-embedded address: resolve and embed it below.
        }

        const resolved = resolveImagePath(address, documentPath);
        if (resolved === null) {
          // Nothing on disk matches this address, so there is nothing to embed and the address stays as written.
          continue;
        } else {
          // A resolvable path: read it into a data URI for embedding below.
        }

        try {
          sources.set(address, await this.imageLoader.dataUri(resolved));
        } catch (caught) {
          // The picture cannot be read: keep its address and report it rather than stopping the export, so the error reaches the user through failed in exportHtml.
          failed.push(address);
        }
      }
    }

    return { sources, failed };
  }

  /**
   * @purpose Exports the current document as a standalone HTML file (FR-13.1), with its local images embedded.
   * @inputs void.
   * @outputs Promise<void> - Resolves once the file is written or the user cancels.
   * @dataflow session document -> embeddableImages -> renderHtml standalone with image data -> chooseSavePath -> saveFile -> status message.
   * @controlflow Derive a suggested name from the open file -> embed images -> save -> report the path and any image not embedded, the cancellation, or the error.
   */
  /**
   * @purpose Works out whether comments belong in an export or a print, and how (FR-10.7).
   * @inputs void; reads the export setting and the loaded threads.
   * @outputs An object to spread into the export or print options: empty when comments are excluded.
   * @dataflow settings.export.comments + the controller's threads + the document text -> CommentNoteOptions.
   * @controlflow Returns nothing at all when the setting excludes comments, or when there are none to
   *   write, so the renderer is never handed an arrangement with no content to put in it.
   */
  /**
   * @purpose Writes the document's comments into the document itself, as HTML comments (FR-6.22).
   * @inputs void; reads the loaded threads and the document text.
   * @outputs void.
   * @dataflow The threads + the text -> bundleComments -> the session, as an edit the reader can undo.
   * @controlflow Report and stop when there is nothing to bundle; otherwise apply and say what happened.
   *
   * The bundle is put in the document rather than written to disk behind the reader's back, so it is an
   * ordinary edit: it shows in the Source pane, it can be undone, and it is saved when they save.
   */
  /**
   * @purpose Keeps the document's comments written into it while portable mode is on (FR-10.6).
   * @inputs void; reads the setting, the loaded threads and the document text.
   * @outputs void.
   * @dataflow The threads + the text -> bundleComments -> the session when the result differs.
   * @controlflow Does nothing while the mode is off, and nothing when the document already says what it
   *   would say -- which is what stops this from looping, since the rewrite it makes brings the comments
   *   round again to be planned.
   *
   * Turning the mode off is handled here too: with no threads the bundle is removed, so a document that
   * was carrying comments stops carrying them the next time anything about them changes.
   */
  private syncPortableComments(): void {
    // Check whether the reader asked for their comments to live in the file.
    if (!this.settings.general.portableComments) {
      return;
    } else {
      // On: the document should say exactly what the comments pane says.
    }

    const text = this.documentSession.snapshot.text;
    const bundled = bundleComments(text, this.commentsController.threads);
    // Check whether the document already carries exactly these comments. Without this the rewrite would
    // arrive back here as another change and the two would chase each other.
    if (bundled === text) {
      return;
    } else {
      // Out of date: bring the file's copy in line with the pane.
    }

    this.documentSession.applyExternalText(bundled);
  }

  private bundleAnnotations(): void {
    const threads = this.commentsController.threads;
    // Check whether there is anything to carry; bundling nothing would only strip an existing bundle,
    // which is a different act and should be asked for differently.
    if (threads.length === 0) {
      this.showMessage('This document has no comments to bundle.');
      return;
    } else {
      // There are comments: write them into the document.
    }

    const text = this.documentSession.snapshot.text;
    const bundled = bundleComments(text, threads);
    // Check whether this changed anything; bundling a document that already carries the same comments
    // would otherwise report success while making no edit to undo.
    if (bundled === text) {
      this.showMessage('The comments are already bundled into this document.');
      return;
    } else {
      // A real change: apply it as an edit.
    }

    this.documentSession.applyExternalText(bundled);
    this.showMessage(
      `${threads.length} comment${threads.length === 1 ? '' : 's'} bundled into the document. Save to send it on.`,
    );
  }

  /**
   * @purpose Offers to take the comments out of a document that arrived carrying them (FR-6.22).
   * @inputs path - The document's path, so a refusal is remembered against it.
   * @outputs Promise<void> - Resolves once the offer has been made and acted on.
   * @dataflow The text -> extractComments -> the threads saved to the store, the stripped text to the session.
   * @controlflow Ask once per document per session; on agreement save the threads, strip the bundle and
   *   reload the pane; a refusal is remembered so a tab switch does not ask again.
   */
  private async offerBundledComments(path: string | null): Promise<void> {
    const key = path ?? '';
    // Check whether this document has already been asked about; being asked the same question on every
    // tab switch is worse than not being asked at all.
    if (this.declinedBundles.has(key)) {
      return;
    } else {
      // Not asked yet in this session.
    }

    const extracted = extractComments(this.documentSession.snapshot.text);
    // Check whether anything readable was in the bundle; a bundle of nothing but unreadable lines is
    // reported below rather than offered as an import.
    if (extracted.threads.length === 0) {
      this.declinedBundles.add(key);
      // Check whether the bundle was there but unreadable, which is worth saying.
      if (extracted.problems.length > 0) {
        this.showMessage('This document carries comments that could not be read.');
      } else {
        // An empty bundle: nothing to say.
      }
      return;
    } else {
      // There are comments to offer.
    }

    const count = extracted.threads.length;
    const choice = await this.confirmDialog.ask(
      `This document carries ${count} comment${count === 1 ? '' : 's'} written into the file. Take them out and show them in the comments pane?`,
      { heading: 'Import comments?', confirm: 'Import', discard: null, cancel: 'Leave them' },
    );
    // Check what was decided; the document is left exactly as it arrived unless the reader agrees.
    if (choice !== 'save') {
      this.declinedBundles.add(key);
      return;
    } else {
      // Agreed: save the threads where comments normally live, then take them out of the text.
    }

    try {
      await this.annotationStore.save<CommentThread>('comments', extracted.threads);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`The comments could not be imported. ${message}`);
      return;
    }

    this.documentSession.applyExternalText(extracted.text);
    await this.commentsController.load();
    this.declinedBundles.add(key);
    const note = extracted.problems.length === 0 ? '' : ` ${extracted.problems.length} could not be read.`;
    this.showMessage(`${count} comment${count === 1 ? '' : 's'} imported.${note}`);
  }

  /**
   * @purpose Sends the document to the reader's grammar service and reports what comes back (FR-12.4).
   * @inputs void; reads the configured service, the document text and the proofing language.
   * @outputs Promise<void> - Resolves once the check has finished or failed.
   * @dataflow The text -> checkGrammar -> this.grammarIssues -> the Problems panel.
   * @controlflow Refuses when no service is configured and when a check is already running; every failure
   *   is reported rather than being left to look like a document with nothing wrong with it.
   *
   * On demand rather than as you type. This sends the document's text to an address outside the machine,
   * which is a thing to do when asked and not on a timer.
   */
  private async checkGrammarNow(): Promise<void> {
    const endpoint = this.settings.proofing.grammarEndpoint;
    // Check whether a service has been named. Without one there is nowhere to send the text, and the
    // reader is told where to name one rather than left wondering why nothing happened.
    if (endpoint.length === 0) {
      this.showMessage('No grammar service is set. Add one in Settings under Proofing.');
      return;
    } else {
      // A service is named: the reader has chosen to send their text there.
    }

    // Check whether a check is already running; two at once would race to write the findings.
    if (this.grammarChecking) {
      this.showMessage('A grammar check is already running.');
      return;
    } else {
      // Nothing running: start one.
    }

    this.grammarChecking = true;
    this.showMessage('Checking grammar…');
    try {
      const issues = await checkGrammar({
        endpoint,
        text: this.documentSession.snapshot.text,
        language: this.documentLanguage.language,
      });
      this.grammarIssues = issues;
      this.problemsPanel.refresh();
      // Check whether anything was found, so "nothing found" is said rather than left as silence.
      if (issues.length === 0) {
        this.showMessage('Grammar check found nothing.');
      } else {
        this.showMessage(`Grammar check found ${issues.length} issue${issues.length === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The findings are cleared on a failure: keeping the last run's would be showing the reader
      // something about a document they have since changed.
      this.grammarIssues = [];
      this.problemsPanel.refresh();
      this.showMessage(message);
    } finally {
      this.grammarChecking = false;
    }
  }

  /**
   * @purpose Drops the last grammar check's findings (FR-12.4).
   * @inputs void.
   * @outputs void.
   * @dataflow The findings are emptied and the panel redrawn.
   * @controlflow Does nothing when there are none, so an edit to a document that was never checked does
   *   not redraw the panel on every keystroke.
   */
  private clearGrammarIssues(): void {
    // Check whether there is anything to clear.
    if (this.grammarIssues.length === 0) {
      return;
    } else {
      // Findings from a check of text that no longer exists: their offsets describe a document that has
      // changed underneath them, so they go rather than pointing at the wrong words.
    }
    this.grammarIssues = [];
    this.problemsPanel.refresh();
  }

  private commentExportOptions(): { readonly comments?: CommentNoteOptions } {
    const mode = this.settings.export.comments;
    // Excluding is the default and the usual answer: comments are working notes, and publishing them
    // unasked leaks them.
    if (mode === 'exclude') {
      return {};
    } else {
      // Endnotes or margin notes: gather what there is to write.
    }

    const threads = this.commentsController.threads;
    // A document with no comments gets the same file either way; saying so keeps the renderer's work
    // to documents that actually have something to show.
    if (threads.length === 0) {
      return {};
    } else {
      // There are comments: hand them over with the text their anchors are resolved against.
    }

    return {
      comments: { mode, threads, text: this.documentSession.snapshot.text },
    };
  }

  /**
   * @purpose Imports a Word, HTML, RTF or text file as a new unsaved Markdown document (FR-13.5).
   * @inputs void; asks the reader for the file.
   * @outputs Promise<void> - Resolves once the document is open, the import is cancelled, or it fails.
   * @dataflow chosen file bytes -> importDocument -> Markdown + losses -> report -> newDocument.
   * @controlflow Refuses when the host cannot read files; a dismissed dialog says nothing; anything that cannot be
   *   represented is listed BEFORE the document opens, and the reader can cancel there.
   */
  /**
   * Resolves the folder an attachment is written into for the currently open document.
   *
   * @purpose Implements FR-6.14's path resolution: anchors the reader's attachment-folder setting to the note's own directory, or '' when the note has not been saved.
   * @outputs string - The absolute attachments folder, or an empty string when there is no saved document path.
   * @dataflow this.fileMenu.filePath -> attachmentsFolderPath -> resolved folder (or '').
   * @controlflow Read the menu's file path; return '' for an unsaved document, else resolve the setting against that path.
   */
  /**
   * @purpose Aligns every selected paragraph and heading, or clears the alignment, when the reader allows HTML (FR-8.11).
   * @inputs align - 'left', 'center', 'right', or null to clear.
   * @outputs void - The document changes, or a message says why it did not.
   * @dataflow editor.allowHtmlFormatting -> setBlockAlignment(align) -> the ProseMirror view.
   * @controlflow Refuse with a message while the setting is off, since alignment is HTML the reader has not asked
   *   for; report when the selection held nothing that can be aligned; return focus to the editor either way.
   */
  private alignBlocks(align: 'left' | 'center' | 'right' | null): void {
    // Check whether the reader has allowed K-Doc to write HTML; alignment cannot be expressed without it.
    if (!this.settings.editor.allowHtmlFormatting) {
      this.showMessage('Alignment is written as HTML. Turn on Allow HTML formatting in Settings to use it.');
      return;
    } else {
      // Allowed: apply it to whatever the selection covers.
    }
    const view = this.proseMirrorBinding.view;
    const applied = setBlockAlignment(align)(view.state, view.dispatch);
    // Check whether anything changed; a selection of, say, a code block has nothing to align.
    if (!applied) {
      this.showMessage('Only a paragraph or a heading can be aligned.');
    } else {
      // Something changed: the document now carries the alignment.
    }
    view.focus();
  }

  /**
   * @purpose Exports the document to LaTeX or EPUB by handing it to Pandoc (FR-13.7).
   * @inputs format - 'latex' or 'epub'.
   * @outputs Promise<void> - The file is written, or a message says why it was not.
   * @dataflow pandoc.version() -> save dialog -> documentSession text -> pandoc.write -> a file on disk.
   * @controlflow Pandoc is optional, so a machine without it is told so rather than shown a failure; the reader
   *   chooses the path, and nothing is written until they do.
   */
  private async exportThroughPandoc(format: PandocFormat): Promise<void> {
    const name = PANDOC_FORMAT_NAMES[format];
    // Check whether this host can run a program at all.
    if (!this.pandoc.available) {
      this.showMessage(`Exporting as ${name} requires the desktop app.`);
      return;
    } else {
      // The desktop app: ask whether Pandoc is installed before offering to write anything.
    }
    const version = await this.pandoc.version();
    // Check whether Pandoc answered; an empty version means it is not on PATH.
    if (version === '') {
      this.showMessage(`Exporting as ${name} needs Pandoc on your PATH. K-Doc does not install it.`);
      return;
    } else {
      // Pandoc is there: ask where the file should go.
    }
    const documentPath = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    const suggested = pandocFileName(documentPath ?? '', format);
    const chosen = await this.fileService.chooseSavePath(suggested);
    // Check whether the reader picked a path or dismissed the dialog.
    if (chosen === null) {
      return;
    } else {
      // A path: hand Pandoc the document's text as it stands, unsaved edits included.
    }
    try {
      await this.pandoc.write(this.documentSession.snapshot.text, format, chosen);
      this.showMessage(`Exported as ${name}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Pandoc could not write the ${name} file: ${message}`);
    }
  }

  private attachmentsFolder(): string {
    // reads the document's own path; an unsaved document has no folder, and attachmentsFolderPath returns '' for it
    const path = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    // Check whether the document has been saved; without a path there is nowhere to put an attachment.
    if (path === null) { return ''; } else { /* saved: resolve the folder against it */ }
    return attachmentsFolderPath(path, this.settings.general.attachmentsFolder);
  }

  /**
   * Derives the note's base name — its file name without folder or extension — used as the {doc} token when naming attachments.
   *
   * @purpose Implements FR-6.14's document-name token so attachment names can reference the note they travel with.
   * @outputs string - The document's base name, or '' when the note has not been saved.
   * @dataflow this.fileMenu.filePath -> split on separators -> last segment -> strip extension -> base name (or '').
   * @controlflow Read the menu's file path; return '' for an unsaved document, else take the final path segment and cut it at its last dot.
   */
  private documentBaseName(): string {
    // the document's file name without its folder or extension, for the {doc} token
    const path = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    if (path === null) { return ''; } else { /* saved */ }
    const fileName = path.split(/[\\/]/).pop() ?? '';
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
  }

  /**
   * Names an attachment against the reader's template and writes it into the folder, returning the reference the document should carry.
   *
   * @purpose Implements FR-6.14's write path: resolves a free file name from the template, invokes the host write closure, and turns the result into a document-side reference.
   * @inputs sourceName - The reader-facing label used as the {name} token in the naming template. extension - The stored file's extension without its dot. write - A closure that writes bytes (or copies a source) into the folder under a free name and resolves to the final name.
   * @outputs Promise<string | null> - The attachment reference for the document, or null when there is no saved folder or the write failed.
   * @dataflow attachmentsFolder() -> template + context -> attachmentFileName() -> write(folder, name) -> attachmentReference(folder, written).
   * @controlflow Guard on a non-empty folder (else prompt and return null); name the file via the template; invoke write inside try/catch and convert any failure to null.
   */
  private async storeAttachment(sourceName: string, extension: string, write: (folder: string, name: string) => Promise<string>): Promise<string | null> {
    // Names an attachment by the reader's template and hands it to `write`, returning the reference the document should carry, or null when it could not be stored.
    const folder = this.attachmentsFolder();
    // Check whether there is a folder to write into at all.
    if (folder === '') {
      this.showMessage('Save the document first, so K-Doc knows where its attachments go.');
      return null;
    } else { /* a folder: name the file and write it */ }
    const name = attachmentFileName(this.settings.general.attachmentNameTemplate, {
      name: sourceName,
      document: this.documentBaseName(),
      extension,
      at: new Date(),
    });
    try {
      const written = await write(folder, name);
      return attachmentReference(this.settings.general.attachmentsFolder, written);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not write the attachment: ${message}`);
      return null;
    }
  }

  /**
   * Copies a dropped image into the attachments folder and embeds the copy, so the note and its image travel together.
   *
   * @purpose Implements FR-6.14's drop path: an image already inside the folder (or one dropped on an unsaved document) is embedded by its own path; otherwise it is copied in first and the copy is embedded.
   * @inputs path - The absolute path of the dropped image as delivered by the file-drop handler. label - The alt text to embed with the image.
   * @outputs Promise<void> - Nothing; the side effect is an inserted image node referencing either the original or the copied attachment.
   * @dataflow attachmentsFolder() + path -> isInsideFolder() -> embed original path or storeAttachment(label, extension, copy) -> attachmentReference -> embedded image.
   * @controlflow Guard on folder presence and whether the path already sits inside it (embed directly); else derive the extension, copy via storeAttachment, and embed only when the copy succeeded.
   */
  private async embedDroppedImage(path: string, label: string): Promise<void> {
    // Copies a dropped image into the attachments folder and embeds the copy; an image already in that folder, or a drop into an unsaved document, is embedded by the path it was dropped from.
    const view = this.proseMirrorBinding.view;
    const folder = this.attachmentsFolder();
    const fileName = path.split(/[\\/]/).pop() ?? '';
    // Check whether there is a folder to copy into at all; an unsaved document has none, so the image is embedded
    // by the path it was dropped from and nothing is written.
    if (folder === '') {
      insertImage({ src: path, alt: label, title: null })(view.state, view.dispatch);
      return;
    } else { /* a folder: the image is either already in it or copied into it */ }
    // Check whether the image already sits in the attachments folder, in which case there is nothing to copy and
    // the note can name it relatively at once.
    if (isInsideFolder(path, folder)) {
      const settled = attachmentReference(this.settings.general.attachmentsFolder, fileName);
      insertImage({ src: settled, alt: label, title: null })(view.state, view.dispatch);
      return;
    } else { /* outside the folder: copy it in so the note and its image travel together */ }
    const dot = fileName.lastIndexOf('.');
    const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
    const reference = await this.storeAttachment(label, extension, (target: string, name: string): Promise<string> => this.attachments.copy(target, name, path));
    // Check whether the copy was made.
    if (reference === null) { return; } else { /* copied: embed the copy */ }
    insertImage({ src: reference, alt: label, title: null })(view.state, view.dispatch);
  }

  /**
   * Writes each pasted image into the attachments folder and embeds it (FR-6.14).
   *
   * @purpose Turns clipboard image files into attachments the note refers to by a relative path.
   * @inputs images - The image files the clipboard carried, in the order it listed them.
   * @outputs Promise<void> - Nothing; each written image is embedded in the document.
   * @dataflow File -> arrayBuffer -> Uint8Array -> attachments.write -> attachmentReference -> insertImage.
   * @controlflow Each image is written in turn, so two pasted images keep the order they arrived in; an image
   *   of a type K-Doc does not write, or one the host refuses, is reported and the rest still go in.
   */
  private async embedPastedImages(images: readonly File[]): Promise<void> {
    for (const image of images) {
      const extension = attachmentExtensionFor(image.type);
      // Check whether this is an image type K-Doc writes.
      if (extension === '') {
        this.showMessage(`K-Doc does not write ${image.type} attachments.`);
        continue;
      } else {
        // A type it writes: read the bytes and write them.
      }
      const bytes = new Uint8Array(await image.arrayBuffer());
      // A pasted image has no name of its own, so the template's {name} token stands in for it.
      const reference = await this.storeAttachment('', extension, (folder: string, name: string): Promise<string> => this.attachments.write(folder, name, bytes));
      // Check whether the write succeeded; storeAttachment has already reported any failure.
      if (reference === null) {
        continue;
      } else {
        // Written: embed the file the document now owns.
      }
      const view = this.proseMirrorBinding.view;
      insertImage({ src: reference, alt: '', title: null })(view.state, view.dispatch);
    }
  }

  /**
   * Opens a new document listing the files in the attachments folder that no note refers to (FR-6.14).
   *
   * @purpose Implements FR-6.14's cleanup command: sweeps every note for attachment references and reports any stored file left unreferenced.
   * @inputs Nothing; reads the current document text, the vault notes, and the attachments folder from open state.
   * @outputs Promise<void> - Nothing beyond opening a new report document and showing a summary message.
   * @dataflow attachmentsFolder() -> names(folder) + attachmentReferences(document + each note) -> unusedAttachments(names, referenced) -> report document text.
   * @controlflow Guard on a saved folder (else prompt); list the folder's files; build a set of every reference across the open document and all notes; compute the difference and publish it as a new document.
   */
  private async reportUnusedAttachments(): Promise<void> {
    // Opens a new document listing the files in the attachments folder that no note refers to (FR-6.14).
    const folder = this.attachmentsFolder();
    if (folder === '') { this.showMessage('Save the document first, so K-Doc knows which attachments folder to report on.'); return; } else { /* report on it */ }
    try {
      const names = await this.attachments.names(folder);
      // Check whether the folder holds anything at all.
      if (names.length === 0) { this.showMessage('There are no attachments to report on.'); return; } else { /* something to check */ }
      const referenced = new Set<string>();
      // The open document's own text is read from the editor rather than from disk, so unsaved edits count.
      for (const reference of attachmentReferences(this.documentSession.snapshot.text)) { referenced.add(reference); }
      const notes = this.vault.notes;
      for (const note of notes) {
        try {
          const text = await this.fileService.readPath(note.path);
          for (const reference of attachmentReferences(text)) { referenced.add(reference); }
        } catch { /* a note that cannot be read is left out of the sweep rather than failing the report */ }
      }
      const unused = unusedAttachments(names, referenced);
      const lines: string[] = ['# Unused attachments', '', `Folder: \`${folder}\``, '', `Attachments: ${names.length}. Notes searched: ${notes.length}.`, ''];
      // Check whether anything is unused.
      if (unused.length === 0) {
        lines.push('Every attachment is referred to by a note.');
      } else {
        lines.push(`Nothing refers to these ${unused.length}:`, '');
        // Each name is written in backticks rather than as a link, so that saving this report inside the vault does not make the files look referenced.
        for (const name of unused) { lines.push(`- \`${name}\``); }
      }
      this.newDocument(`${lines.join('\n')}\n`);
      this.showMessage(`${unused.length} of ${names.length} attachments are unused.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not read the attachments folder: ${message}`);
    }
  }

  private async importDocument(): Promise<void> {
    const openImport = this.fileService.openImportFile?.bind(this.fileService);
    // Check whether the host can read a picked file at all.
    if (openImport === undefined) {
      this.showMessage('Importing documents requires the desktop app.');
      return;
    } else {
      // The host can read it: ask for the file.
    }

    try {
      const chosen = await openImport();
      // Check whether the reader picked a file or dismissed the dialog.
      if (chosen === null) {
        return;
      } else {
        // A file: convert it.
      }
      const name = chosen.path.split(/[\\/]/).pop() ?? chosen.path;
      // Loaded on first use, so the Word reader is not part of starting the app.
      const { importDocument, describeLosses } = await import('../files/document-import.js');
      const result = await importDocument(name, chosen.bytes);

      // Check whether anything will be left behind, so the reader decides before the document opens.
      if (result.losses.length > 0) {
        const choice = await this.confirmDialog.ask(
          `Markdown cannot hold everything in ${name}. Not imported: ${describeLosses(result.losses)}.`,
          { heading: 'Import document?', confirm: 'Import', discard: null, cancel: 'Cancel' },
        );
        // Check whether the reader went ahead.
        if (choice !== 'save') {
          this.showMessage('Import cancelled.');
          return;
        } else {
          // Going ahead with what can be carried.
        }
      } else {
        // Nothing is lost: open it straight away.
      }

      this.newDocument(result.markdown === '' ? '\n' : result.markdown);
      this.showMessage(`Imported ${name} as a new document. Save it to choose where the Markdown goes.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Import failed: ${message}`);
    }
  }

  /**
   * @purpose Puts the reader's chosen theme on the window, and keeps it there while they edit it (FR-14.10).
   * @inputs void; reads appearance.userTheme.
   * @outputs Promise<void> - Resolves once the stylesheet is applied.
   * @dataflow appThemes.css -> the kdoc-user-theme element; appThemes.watch -> this method again.
   * @controlflow No theme chosen means an empty element and no watch. A theme is watched so saving it shows at once;
   *   a theme that has gone missing leaves the app in its own colours rather than half-themed.
   */
  private async applyUserTheme(): Promise<void> {
    const name = this.settings.appearance.userTheme;
    // Check whether a theme of the reader's is in use at all.
    if (name === '') {
      this.userThemeElement.textContent = '';
      this.stopThemeWatch?.();
      this.stopThemeWatch = null;
      return;
    } else {
      // A theme: read it and put it on the window.
    }
    try {
      this.userThemeElement.textContent = await this.appThemes.css(name);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.userThemeElement.textContent = '';
      this.showMessage(`The ${name} theme could not be read. ${message}`);
    }
    // Check whether the folder is already being watched, so a second theme does not add a second watch.
    if (this.stopThemeWatch === null) {
      this.stopThemeWatch = await this.appThemes.watch((): void => {
        void this.applyUserTheme();
      });
    } else {
      // Already watching: the same watch covers the new theme.
    }
  }

  /**
   * @purpose Lets the reader choose a theme for the app itself (FR-14.10).
   * @inputs void.
   * @outputs Promise<void> - Resolves once a theme is chosen or the picker is dismissed.
   * @dataflow appThemes.names -> picker -> appearance.userTheme -> applyUserTheme.
   * @controlflow "K-Doc's own colours" is offered first and clears the choice.
   */
  private async chooseAppTheme(): Promise<void> {
    const names = await this.appThemes.names();
    const items = [
      { id: '', label: "K-Doc's own colours", detail: 'No theme of your own' },
      ...names.map((name: string) => ({ id: name, label: name, detail: 'Your own theme' })),
    ];
    this.appThemePicker.open(items, (item): void => {
      const next: KdocSettings = { ...this.settings, appearance: { ...this.settings.appearance, userTheme: item.id } };
      this.settings = next;
      void this.applyUserTheme();
      // Check whether a theme was chosen or cleared, so the message says what happened.
      if (item.id === '') {
        this.showMessage("The app is in K-Doc's own colours.");
      } else {
        this.showMessage(`The app is using the ${item.id} theme. Saving the file applies it again.`);
      }
      this.settingsStore.save(next).catch((error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error);
        this.showMessage(`The theme is in use, but the choice was not saved. ${message}`);
      });
    });
  }

  /**
   * @purpose Opens the folder the reader's app themes live in (FR-14.10).
   * @inputs void.
   * @outputs Promise<void> - Resolves once the folder is open or the failure is reported.
   * @dataflow appThemes.openFolder(appThemeStarter()) -> revealInFileManager.
   * @controlflow A folder with no theme in it is given a starter that lists every colour K-Doc paints with.
   */
  private async openAppThemeFolder(): Promise<void> {
    try {
      const folder = await this.appThemes.openFolder(appThemeStarter());
      await this.fileService.revealInFileManager(folder);
      this.showMessage(`App themes are the .css files in ${folder}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open the themes folder. ${message}`);
    }
  }

  /**
   * @purpose Lets the reader choose the stylesheet exports and printouts are written with (FR-13.8).
   * @inputs void.
   * @outputs Promise<void> - Resolves once a theme is chosen or the picker is dismissed.
   * @dataflow exportThemes.names -> picker -> settings.export.theme.
   * @controlflow The themes K-Doc ships come first, then the reader's own; a folder that cannot be read offers the
   *   built-in ones alone.
   */
  private async chooseExportTheme(): Promise<void> {
    const names = await this.exportThemes.names();
    const items = names.map((name: string) => ({ id: name, label: name, detail: EXPORT_THEMES[name] === undefined ? 'Your own theme' : 'Included with K-Doc' }));
    this.exportThemePicker.open(items, (item): void => {
      // Settings are written whole, as every other change to them is.
      const next: KdocSettings = { ...this.settings, export: { ...this.settings.export, theme: item.id } };
      this.settings = next;
      this.showMessage(`Exports and printouts will use the ${item.id} theme.`);
      this.settingsStore.save(next).catch((error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error);
        this.showMessage(`The ${item.id} theme is in use, but the choice was not saved. ${message}`);
      });
    });
  }

  /**
   * @purpose Opens the folder the reader's own export themes live in (FR-13.8).
   * @inputs void.
   * @outputs Promise<void> - Resolves once the folder is open or the failure is reported.
   * @dataflow exportThemes.openFolder -> revealInFileManager.
   * @controlflow A folder with no theme in it is given a copy of the default stylesheet to start from.
   */
  private async openExportThemeFolder(): Promise<void> {
    try {
      const folder = await this.exportThemes.openFolder(EXPORT_THEMES['default'] ?? '');
      await this.fileService.revealInFileManager(folder);
      this.showMessage(`Export themes are the .css files in ${folder}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open the export themes folder. ${message}`);
    }
  }

  /**
   * @purpose Asks which Markdown flavour to export in, then exports (FR-13.6).
   * @inputs void.
   * @outputs void.
   * @dataflow picker choice -> exportMarkdown.
   * @controlflow Dismissing the picker does nothing.
   */
  private chooseMarkdownFlavour(): void {
    const items = [
      { id: 'commonmark', label: FLAVOUR_NAMES.commonmark, detail: 'Strict CommonMark: tables, footnotes, highlights and maths written as HTML or code' },
      { id: 'gfm', label: FLAVOUR_NAMES.gfm, detail: 'For GitHub: highlights, sub- and superscript written as HTML, maths as code' },
      { id: 'portable', label: FLAVOUR_NAMES.portable, detail: 'Wikilinks turned into relative links any Markdown reader can follow' },
    ];
    this.flavourPicker.open(items, (item): void => {
      void this.exportMarkdown(item.id as MarkdownFlavour);
    });
  }

  /**
   * @purpose Writes the document to a new file in a Markdown flavour and says what was changed (FR-13.6).
   * @inputs flavour - The flavour to write.
   * @outputs Promise<void> - Resolves once the file is written, the export is cancelled, or it fails.
   * @dataflow document -> exportMarkdownFlavour (with a wikilink resolver for the portable flavour) -> saveFile.
   * @controlflow A cancelled save dialog says nothing. The open document's own file is refused, since the export would
   *   replace it. Wikilinks are resolved against the vault's notes, relative to the folder the export is saved in.
   */
  private async exportMarkdown(flavour: MarkdownFlavour): Promise<void> {
    const base = this.fileMenu.fileName.replace(/\.[^.]+$/, '');
    const title = base.length > 0 ? base : 'Untitled';
    // The suggested name says which flavour the file is, and is never the open document's own name.
    const suffix = flavour === 'commonmark' ? 'CommonMark' : flavour === 'gfm' ? 'GFM' : 'portable';
    try {
      const chosen = await this.fileService.chooseSavePath(`${title} (${suffix}).md`);
      // The path is compared and linked from in its plain form, so `export/../note.md` is known to be `note.md`.
      const path = chosen === null ? null : canonicalFilePath(chosen);
      // Check whether the reader picked somewhere or dismissed the dialog.
      if (path === null) {
        return;
      } else if (this.fileMenu.filePath !== null && path.toLowerCase() === canonicalFilePath(this.fileMenu.filePath).toLowerCase()) {
        this.showMessage('Choose a different file: exporting over the open document would replace it.');
        return;
      } else {
        // A new file: write the export there.
      }
      const folder = path.replace(/[\\/][^\\/]*$/, '');
      const context = this.linkContext();
      const result = exportMarkdownFlavour(this.documentSession.snapshot.document, flavour, {
        resolveWikiLink: (target: string): string | null => {
          const resolved = classifyLink(target, context);
          // classifyLink also answers "note" for a relative path with no file behind it, which suits an ordinary link
          // but not a wikilink: only a note the vault actually holds counts.
          const held = resolved.kind === 'note' && context.notes.some((entry) => entry.path.replace(/\\/g, '/').toLowerCase() === resolved.path.replace(/\\/g, '/').toLowerCase());
          // Check whether the target names a note in the vault.
          if (resolved.kind !== 'note' || !held) {
            return null;
          } else {
            const anchor = resolved.slug === null ? '' : `#${headingSlug(resolved.slug)}`;
            return `${relativeLinkPath(folder, resolved.path)}${anchor}`;
          }
        },
      });
      await this.fileService.saveFile({ path, contents: result.markdown, encoding: 'utf-8' });
      const described = result.changes.map((change) => (change.count > 1 ? `${change.label} (${change.count})` : change.label));
      const unresolved = result.changes.some((change) => change.label === WIKILINK_LABEL.unresolved);
      // Check whether wikilinks went unresolved because no vault is open to resolve them in.
      if (unresolved && this.vault.status.root === null) {
        described.push('no vault is open to find the notes wikilinks name');
      } else {
        // A vault was consulted, or nothing was unresolved.
      }
      // Check whether anything was changed, so the reader knows what the file does not say the way the document does.
      if (described.length === 0) {
        this.showMessage(`Exported as ${FLAVOUR_NAMES[flavour]} to ${path}.`);
      } else {
        this.showMessage(`Exported as ${FLAVOUR_NAMES[flavour]} to ${path}. Changed: ${described.join('; ')}.`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Export failed: ${message}`);
    }
  }

  /**
   * @purpose Exports the document as a Word document (FR-13.4).
   * @inputs void; reads the mounted document and its local pictures.
   * @outputs Promise<void> - Resolves once the file is written, the export is cancelled, or it fails.
   * @dataflow The document tree + embedded pictures -> exportDocx -> bytes -> the chosen path.
   * @controlflow Refuses when the host cannot write binary files; a cancelled save dialog says nothing;
   *   a written file names itself and anything that could not be carried across.
   */
  private async exportDocx(): Promise<void> {
    const saveBinary = this.fileService.saveBinaryFile?.bind(this.fileService);
    // Check whether the host can write a binary file at all; the text path would corrupt one.
    if (saveBinary === undefined) {
      this.showMessage('Exporting to Word requires the desktop app.');
      return;
    } else {
      // The host can write it: build the document.
    }

    // The suggested name follows the open document with its extension swapped, as the HTML export does.
    const base = this.fileMenu.fileName.replace(/\.[^.]+$/, '');
    const title = base.length > 0 ? base : 'Untitled';

    try {
      const path = await this.fileService.chooseSavePath(`${title}.docx`);
      // Check whether the reader picked somewhere or dismissed the dialog.
      if (path === null) {
        // Cancelled: say nothing about an action the reader deliberately abandoned.
        return;
      } else {
        // A destination: gather the pictures and build the file.
      }

      const document = this.documentSession.snapshot.document;
      // Local pictures are read the same way the HTML export reads them, so both embed the same files.
      const embedded = await this.embeddableImages(document);
      const result = await exportDocx(document.root, { title, images: embedded.sources });
      await saveBinary(path, result.bytes);

      const lost = [...result.skipped];
      // Check whether some pictures could not even be read from disk.
      if (embedded.failed.length > 0) {
        lost.push(`${embedded.failed.length} picture(s) that could not be read`);
      } else {
        // Every picture was read.
      }
      // Check whether anything was left out, so the reader is told what the Word file does not contain.
      if (lost.length === 0) {
        this.showMessage(`Exported to ${path}.`);
      } else {
        this.showMessage(`Exported to ${path}. Not carried across: ${lost.join(', ')}.`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Export failed: ${message}`);
    }
  }

  private async exportHtml(): Promise<void> {
    // The suggested name follows the open document, with the extension swapped rather than appended:
    // "notes.md.html" is what you get from appending, and nobody wants that.
    const base = this.fileMenu.fileName.replace(/\.[^.]+$/, '');
    const title = base.length > 0 ? base : 'Untitled';

    try {
      const document = this.documentSession.snapshot.document;
      // Local pictures are read and embedded first, so the exported file stands on its own (FR-13.1).
      const embedded = await this.embeddableImages(document);
      const path = await saveHtmlExport({
        fileService: this.fileService,
        document,
        title,
        suggestedName: `${title}.html`,
        imageSources: embedded.sources,
        // The stylesheet the reader chose, theirs or one K-Doc ships (FR-13.8).
        css: await this.exportThemes.css(this.settings.export.theme),
        // Syntax the reader's plugins added is drawn into the exported copy (FR-14.18).
        pluginSyntax: this.pluginSyntax(),
        ...this.commentExportOptions(),
      });

      // Check whether the user picked a destination or dismissed the dialog.
      if (path === null) {
        // Cancelled: say nothing. A message about an action the user deliberately abandoned is noise.
        return;
      } else {
        // Written: name the file, because an export with no feedback leaves the user unsure it happened.
        // Name any picture that could not be embedded, so a broken image in the file is not a surprise.
        const note = embedded.failed.length === 0 ? '' : ` ${embedded.failed.length} image(s) could not be embedded: ${embedded.failed.join(', ')}.`;
        this.showMessage(`Exported to ${path}.${note}`);
      }
    } catch (error: unknown) {
      // Check the caught value so the message shown is the real reason, not "[object Object]".
      if (error instanceof Error) {
        this.showMessage(`Export failed: ${error.message}`);
      } else {
        this.showMessage(`Export failed: ${String(error)}`);
      }
    }
  }

  /**
   * @purpose Prints the current document through an isolated render, not the live application (FR-13.3).
   * @inputs void.
   * @outputs void.
   * @dataflow session document + pageSetup -> printDocument -> hidden iframe -> the platform print dialog.
   * @controlflow Build the title from the open file -> hand the document to printDocument -> report a failure.
   */
  /**
   * @purpose Opens the page-setup dialog and prints with whatever the user settles on.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow pageSetupDialog.ask(this.pageSetup) -> this.pageSetup -> print().
   * @controlflow Ask, remember the answer for the rest of the session, then print.
   *
   * The dialog's primary button says Print because that is what it does. A page-setup dialog that only
   * recorded a setting would leave the user to find Print afterwards and wonder whether the setting had
   * taken -- and the only way to see a page setup is to look at a page.
   *
   * The setup is remembered for the session but not persisted. It belongs to a printing, not to the
   * document: a margin chosen for one handout is not a fact about the file, and writing it into
   * settings.json would make it one.
   */
  private async openPageSetup(): Promise<void> {
    const chosen = await this.pageSetupDialog.ask(this.pageSetup);

    // Check whether the user accepted the dialog.
    if (chosen === null) {
      // Cancelled: the setup is left as it was and nothing is printed.
      return;
    } else {
      // Accepted: keep the setup for the rest of the session and print with it.
      this.pageSetup = chosen;
      void this.print();
    }
  }

  private async print(): Promise<void> {
    const base = this.fileMenu.fileName.replace(/\.[^.]+$/, '');
    const title = base.length > 0 ? base : 'Untitled';

    try {
      // A printout is styled by the same theme an export is (FR-13.8), read before the print dialog opens.
      const css = await this.exportThemes.css(this.settings.export.theme);
      printDocument({
        win: window,
        document: this.documentSession.snapshot.document,
        title,
        setup: this.pageSetup,
        css,
        // A plugin's own syntax is drawn in a printout on the same terms as an export (FR-14.18).
        pluginSyntax: this.pluginSyntax(),
        ...this.commentExportOptions(),
      });
    } catch (error: unknown) {
      // Check the caught value so the message shown is the real reason.
      if (error instanceof Error) {
        this.showMessage(`Print failed: ${error.message}`);
      } else {
        this.showMessage(`Print failed: ${String(error)}`);
      }
    }
  }

  /**
   * @purpose Sets the zoom level and re-applies typography at the new scale (FR-14.12).
   * @inputs next - The requested zoom multiplier; snapped to the nearest ladder step.
   * @outputs void.
   * @dataflow next -> clampZoom -> this.zoom -> applyTypography -> CSS custom properties.
   * @controlflow Snap the value -> return early when it did not change -> store it -> re-apply -> report it.
   */
  private setZoom(next: number): void {
    const snapped = clampZoom(next);

    // Check whether the zoom actually moved. At either end of the ladder the step functions return
    // the value they were given, so without this the status message would flash on every keypress
    // as though something had happened.
    if (snapped === this.zoom) {
      // Already at this step, which means the user is at the top or bottom of the ladder.
      return;
    } else {
      // A real change: store it and re-apply.
      this.zoom = snapped;
    }

    this.applyZoom();
    this.showMessage(`Zoom ${Math.round(this.zoom * 100)}%.`);
  }

  /**
   * @purpose Applies the appearance settings and the current zoom to the shell (FR-14.11, FR-14.12).
   * @inputs void.
   * @outputs void.
   * @dataflow DEFAULT_SETTINGS.appearance + this.zoom -> applyTypography -> CSS custom properties on the shell.
   * @controlflow Delegate to applyTypography with the shell element as the property host.
   */
  private applyZoom(): void {
    // The properties go on the shell rather than on documentElement so a second editor instance on one
    // page would not fight this one over the same variables.
    // The document's own width and density (FR-5.10, FR-14.13) sit on top of the settings; a document
    // with no overrides gets the settings unchanged.
    applyTypography(
      this.shellElement,
      effectiveAppearance(this.settings.appearance, this.displayOverride),
      this.zoom,
    );
  }

  /**
   * @purpose Loads persisted settings and applies them (FR-14.15).
   * @inputs void.
   * @outputs Promise<void> - Resolves once settings are loaded and applied.
   * @dataflow settingsStore.load -> this.settings -> applySettings -> dialog.setSettings.
   * @controlflow Load (never rejects) -> store -> apply -> push into the dialog -> report any problems once.
   */
  /**
   * @purpose Restores the previous window if asked to, then offers any unsaved work the journal kept (FR-6.10).
   * @inputs void.
   * @outputs Promise<void> - Resolves once both have been attempted.
   * @dataflow The settings -> restoreSession -> the reopened tabs; then offerRecovery -> the active document.
   * @controlflow The settings decide whether to restore, so they are loaded first; recovery is offered
   *   afterwards either way, and a failure to restore never stops it being offered.
   */
  private async restoreThenRecover(): Promise<void> {
    // The untitled document the launch started with, replaced if a restored or double-clicked file opens.
    const startingTab = this.activeTabId;
    try {
      await this.loadSettings();
      await this.restoreSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`The previous session could not be restored. ${message}`);
    }
    // The Default view setting applies whenever the session did not bring a view back with it.
    if (!this.viewModeRestored) {
      this.setViewMode(this.settings.editor.defaultViewMode);
    } else {
      // The restored session's view wins.
    }
    // A file the user double-clicked opens after the restored ones, so it ends up in front.
    await this.openFilesAskedFor(startingTab);
    // Whether it restored or failed, the launch is done reading the stored arrangement, so what happens
    // from here is worth remembering.
    this.sessionRestored = true;
    await this.offerRecovery();

    // The reader's plugins are read last, because nothing K-Doc does itself waits on them and a plugin
    // that is slow to start should not hold up the document appearing (FR-14.18).
    await this.pluginHost.load();
    this.pluginsPanel.refresh();
    this.appMenuBar.refresh();

    // Check whether anything went wrong reading them, because the panel it would have been said in is
    // not open, and a plugin that did not load says nothing for itself.
    if (this.pluginHost.problems.length > 0) {
      this.showMessage(`${this.pluginHost.problems.length} plugin problem(s). See the Plugins panel.`);
    } else {
      // Every plugin that was there loaded, or there were none.
    }
  }

  /**
   * @purpose Opens the files K-Doc was started to open (a double-clicked Markdown file), then listens for more.
   * @inputs startingTab - The untitled tab the launch began with, or null.
   * @outputs Promise<void> - Resolves once the waiting files are open and the listener is installed.
   * @dataflow launchFiles.take -> openNoteFromVault per path; later requests -> the same.
   * @controlflow A window opened for a detached tab does not take the launch's files; every window listens,
   *   because the host sends a later file to whichever window was used last.
   */
  private async openFilesAskedFor(startingTab: string | null): Promise<void> {
    // The launch's files belong to the window the launch opened, not to a detached tab's window.
    if (!this.handedOff) {
      await this.openWaitingLaunchFiles(startingTab);
    } else {
      // A detached tab's window: it was asked for that tab only.
    }
    try {
      await this.launchFiles.onRequest((): void => {
        void this.openWaitingLaunchFiles(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not listen for files opened from Windows. ${message}`);
    }
  }

  /**
   * @purpose Opens every file waiting to be opened, switching to any that is already open.
   * @inputs startingTab - The untitled launch tab to drop once a file has opened, or null.
   * @outputs Promise<void>.
   * @dataflow take_launch_paths -> openNoteFromVault (reads, opens, records as recent) -> tab strip.
   * @controlflow The placeholder is dropped only when a file opened; a failure is reported, never thrown.
   */
  private async openWaitingLaunchFiles(startingTab: string | null): Promise<void> {
    try {
      const opened = await openLaunchFiles(this.launchFiles, (path: string): Promise<void> => this.openNoteFromVault(path));
      // Check whether a file replaced the untitled document the launch started with.
      if (opened > 0 && startingTab !== null) {
        this.dropLaunchPlaceholder(startingTab);
      } else {
        // Nothing opened, or no placeholder to drop.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open the file you asked for. ${message}`);
    }
  }

  /**
   * @purpose Reopens the files, layout and scroll positions the window was last left with (FR-6.10).
   * @inputs void; reads the setting and the stored session.
   * @outputs Promise<void> - Resolves once everything that could be restored has been.
   * @dataflow local storage -> loadSession -> the files read from disk -> tabs; the layout -> the panes.
   * @controlflow Do nothing when the setting is off, when the window was handed a document to open, or
   *   when there is no stored session; otherwise open each file that still reads, close the document the
   *   launch started with once at least one opened, and apply the layout last.
   */
  private async restoreSession(): Promise<void> {
    // Check whether the reader asked for the previous window back.
    if (!this.settings.general.restoreSessionOnLaunch) {
      // Off: also drop anything stored earlier, so turning it off really does forget.
      clearSession(window.localStorage);
      return;
    } else {
      // On: work out whether there is anything to restore.
    }

    // A window opened to show a particular document -- a detached tab, a file opened from the shell --
    // was asked for that document, not for the last session.
    if (this.handedOff || this.fileMenu.filePath !== null) {
      return;
    } else {
      // An ordinary launch on an untitled document, so restoring will not displace anything the reader asked for.
    }

    const stored = loadSession(window.localStorage);
    // Nothing stored, or nothing that could be trusted: a first launch.
    if (stored === null) {
      return;
    } else {
      // A session to restore.
    }

    const startingTab = this.activeTabId;
    const missing: string[] = [];
    let opened = 0;
    for (const path of stored.paths) {
      try {
        const file = await this.fileService.readFile(path);
        this.openInTab(file);
        opened += 1;
      } catch {
        // A file that has been moved, renamed or deleted since. Collected rather than reported one by
        // one, because a moved folder would otherwise produce a message per file.
        missing.push(path);
      }
    }

    // Check whether anything actually opened; the welcome document stays if nothing did, rather than
    // leaving the window with no document at all.
    if (opened > 0 && startingTab !== null) {
      this.dropLaunchPlaceholder(startingTab);
    } else {
      // Nothing opened: keep the document the launch started with.
    }

    const active = stored.activePath;
    // Check whether one of the restored files was the one in front.
    if (active !== null) {
      const tab = this.tabs.snapshot.tabs.find((record) => record.payload.path === active);
      // Check whether that file is among the ones that opened.
      if (tab !== undefined) {
        this.activateTab(tab.id);
      } else {
        // It did not open: whichever tab ended up active stays active.
      }
    } else {
      // Nothing was in front: leave the last opened tab active.
    }

    this.applyStoredLayout(stored);

    // Check whether any file could not be reopened.
    if (missing.length > 0) {
      this.showMessage(
        `${missing.length} file${missing.length === 1 ? '' : 's'} from the previous session could not be reopened.`,
      );
    } else {
      // Everything opened: say nothing.
    }
  }

  /**
   * @purpose Removes the untitled document a launch starts with, once a restored file has replaced it (FR-6.10).
   * @inputs id - The tab the launch created.
   * @outputs void.
   * @dataflow The tab set -> close(id) -> the tab strip redrawn.
   * @controlflow Only an untitled background tab is dropped, and it is dropped through the tab set rather
   *   than through closeTab.
   *
   * closeTab exists to protect unsaved work and asks before discarding any. That is the wrong question
   * here twice over: the welcome document counts as modified from the moment it is parsed, so the prompt
   * would appear on every launch, and what it would be asking about is a placeholder the reader never
   * typed into -- the restore happens within a second of the window opening. A file the reader did ask
   * for has a path and is never dropped here.
   */
  private dropLaunchPlaceholder(id: string): void {
    const record = this.tabs.get(id);
    // Check that this is still the untitled placeholder and not something opened since; anything with a
    // path is a real file and is left alone.
    if (record === null || record.path !== null) {
      return;
    } else {
      // The placeholder: drop it without asking.
    }

    // It is in the background by now -- the restored files were activated as they opened -- so it owns no
    // live controllers and removing the record is the whole job.
    this.tabs.close(id);
    this.tabBar.refresh();
  }

  /**
   * @purpose Puts the panes, the split and the sidebars back where they were (FR-6.10).
   * @inputs stored - The session read from storage.
   * @outputs void.
   * @dataflow stored -> setViewMode / setRatio / the sidebars / the two scrollers.
   * @controlflow Scroll positions are applied after a frame, because a pane that has only just been given
   *   its document has no height yet and would clamp the offset to zero.
   */
  private applyStoredLayout(stored: PersistedSession): void {
    this.setViewMode(stored.viewMode);
    this.viewModeRestored = true;
    this.splitDivider.setRatio(stored.splitRatio);
    this.applyStoredPanel(this.sidebar, stored.sidebar);
    this.applyStoredPanel(this.rightSidebar, stored.rightSidebar);

    window.requestAnimationFrame((): void => {
      this.kdocPane.scrollTop = stored.scrollKdoc;
      const source = sourceScroller(this.codeMirrorBinding.view);
      source.scrollTop = stored.scrollSource;
    });
  }

  /**
   * @purpose Puts one sidebar back as it was (FR-6.10).
   * @inputs panel - The sidebar to arrange. stored - What it looked like.
   * @outputs void.
   * @dataflow stored -> show(panelId) or collapse().
   * @controlflow A sidebar stored as collapsed is collapsed; one stored as showing a panel shows it, and
   *   a panel name this build no longer has is ignored rather than throwing.
   */
  private applyStoredPanel(panel: Sidebar, stored: PersistedPanel): void {
    // Check whether it was collapsed when the window closed.
    if (stored.collapsed || stored.panelId === null) {
      panel.collapse();
    } else {
      panel.show(stored.panelId);
    }
  }

  /**
   * @purpose Records the window's arrangement so the next launch can put it back (FR-6.10).
   * @inputs void; reads the tabs, the panes and the sidebars.
   * @outputs void.
   * @dataflow The live shell -> a PersistedSession -> local storage.
   * @controlflow Writes nothing while restoring is turned off, so the stored session cannot creep back.
   *   Only saved files are listed: unsaved work is the crash journal's to keep.
   */
  private persistSession(): void {
    // Check whether the launch has finished with the stored arrangement. Writing before it has would
    // overwrite the arrangement with the empty window that exists while the restore is still running.
    if (!this.sessionRestored) {
      return;
    } else {
      // The restore is done: what is on screen is now worth remembering.
    }

    // Check whether the reader wants the window remembered at all.
    if (!this.settings.general.restoreSessionOnLaunch) {
      return;
    } else {
      // Remembering is on: take the arrangement as it stands.
    }

    const paths: string[] = [];
    for (const record of this.tabs.snapshot.tabs) {
      const path = record.payload.path;
      // An untitled document has no path to reopen by; the journal keeps its text instead.
      if (path !== null) {
        paths.push(path);
      } else {
        // Untitled: not listed.
      }
    }

    saveSession(window.localStorage, {
      version: 1,
      paths,
      activePath: this.fileMenu === undefined ? null : this.fileMenu.filePath,
      viewMode: this.currentViewMode,
      splitRatio: this.splitDivider.ratio,
      sidebar: { collapsed: this.sidebar.isCollapsed, panelId: this.sidebar.activePanelId },
      rightSidebar: { collapsed: this.rightSidebar.isCollapsed, panelId: this.rightSidebar.activePanelId },
      scrollKdoc: this.kdocPane.scrollTop,
      scrollSource: sourceScroller(this.codeMirrorBinding.view).scrollTop,
    });
  }

  /**
   * @purpose Records the arrangement shortly after it changes, rather than on every event (FR-6.10).
   * @inputs void.
   * @outputs void.
   * @dataflow A timer -> persistSession.
   * @controlflow Each call replaces the pending one, so a drag or a scroll writes once when it settles
   *   rather than on every pixel.
   */
  private restartSessionSave(): void {
    // Check whether a write is already pending, and replace it so only the latest state is written.
    if (this.sessionSaveTimer !== null) {
      window.clearTimeout(this.sessionSaveTimer);
    } else {
      // Nothing pending.
    }
    this.sessionSaveTimer = window.setTimeout((): void => {
      this.sessionSaveTimer = null;
      this.persistSession();
    }, SESSION_SAVE_DELAY_MS);
  }

  private async loadSettings(): Promise<void> {
    const loaded = await this.settingsStore.load();
    this.settings = loaded.settings;
    this.applySettings();

    // The dialog was built from the defaults, so it has to be told what was actually loaded.
    this.settingsDialog.setSettings(loaded.settings);

    // Check whether the file had anything wrong with it. parseSettings recovers field by field, so a
    // problem means one setting fell back to its default, not that the file was rejected.
    if (loaded.problems.length > 0) {
      // Report the count rather than every message: a file with twenty bad fields would otherwise
      // produce twenty status messages, and the useful information is that the file needs looking at.
      this.showMessage(
        `${loaded.problems.length} setting${loaded.problems.length === 1 ? '' : 's'} in the settings file could not be read and fell back to defaults.`,
      );
    } else {
      // Nothing wrong: say nothing.
    }
  }

  /**
   * @purpose Applies the current settings to the parts of the shell that consume them.
   * @inputs void.
   * @outputs void.
   * @dataflow this.settings -> typography, theme, autosave policy.
   * @controlflow Re-apply typography -> push the theme -> map the autosave settings onto a policy.
   */
  private applySettings(): void {
    this.applyZoom();
    this.restartSnapshotTimer();
    this.applySplitOrientation();

    // Guarded because applySettings runs from the settings load, which can land before the first
    // document is mounted.
    if (this.spellCheck !== undefined) {
      // Mounted: the toggle clears or restores the squiggles immediately.
      this.spellCheck.setEnabled(this.settings.proofing.spellCheck);
      // The default language, or whether to guess, may have changed with it.
      this.refreshDocumentLanguage();
    } else {
      // Not mounted yet: mountDocument reads the same setting when it installs the controller.
    }

    this.themeController.setUiTheme(this.settings.appearance.uiTheme);
    this.themeController.setMode(this.settings.appearance.theme);
    // A theme of the reader's own goes on after K-Doc's colours, and follows a settings change like the rest (FR-14.10).
    void this.applyUserTheme();
    this.themeMode = this.settings.appearance.theme;
    this.themeButton.textContent = this.formatThemeMode(this.themeMode);

    // The settings model and the autosave controller describe the same thing in different shapes:
    // the settings carry a mode and a delay side by side, while the policy is a discriminated union
    // where the delay only exists for the modes that have one. Mapping here keeps the controller from
    // having to know about a delay that does not apply to it.
    const seconds = Math.max(1, Math.round(this.settings.editor.autosaveDelayMs / 1000));

    // Check which autosave mode the settings name.
    if (this.settings.editor.autosave === 'off') {
      this.autosave.setPolicy({ kind: 'off' });
    } else if (this.settings.editor.autosave === 'on-blur') {
      this.autosave.setPolicy({ kind: 'onBlur' });
    } else if (this.settings.editor.autosave === 'interval') {
      this.autosave.setPolicy({ kind: 'interval', seconds });
    } else {
      // 'idle' is the remaining mode and the default.
      this.autosave.setPolicy({ kind: 'idle', seconds });
    }

    // A changed preset or binding applies to the next key, and the menus relabel to match.
    this.keymap = resolveKeymap(this.settings.keyboard.preset, this.settings.keyboard.bindings);
    // Check whether the in-app menu bar has been installed before refreshing its state.
    if (this.appMenuBar !== undefined) {
      this.appMenuBar.refresh();
    } else {
      // Still constructing: app menu bar will be installed and refreshed shortly.
    }

    // The ribbon is built from its arrangement, so a settings load that brings one has to draw it again.
    // Guarded because applySettings runs from that load, which can land while the shell is still building.
    if (this.ribbon !== undefined) {
      this.rebuildRibbon();
    } else {
      // Still constructing: the ribbon is installed with the arrangement it reads for itself.
    }
  }

  /**
   * @purpose Writes the current K-Doc selection to the clipboard as Markdown or HTML (FR-7.4).
   * @inputs format - Which serialization the user asked for.
   * @outputs Promise<void>.
   * @dataflow view.state -> selectionAsMarkdown / selectionAsHtml -> navigator.clipboard.writeText.
   * @controlflow Serialize the selection, report an empty selection, write, report a rejected write.
   *
   * The async Clipboard API rather than execCommand, because this writes a *representation* of the
   * selection rather than the selection itself, and execCommand can only copy what is selected.
   */
  private async copySelection(format: 'markdown' | 'html'): Promise<void> {
    const state = this.proseMirrorBinding.view.state;

    // Check which serialization was asked for.
    const text = format === 'markdown' ? selectionAsMarkdown(state) : selectionAsHtml(state);

    // Check whether the selection produced anything.
    if (text === '') {
      // Nothing selected: say so rather than silently writing an empty clipboard, which would also
      // destroy whatever the user had copied before.
      this.showMessage('Nothing selected to copy.');
      return;
    } else {
      // Content present: write it.
    }

    try {
      await navigator.clipboard.writeText(text);
      this.showMessage(format === 'markdown' ? 'Copied as Markdown.' : 'Copied as HTML.');
    } catch (error: unknown) {
      // The clipboard write can be refused by permissions policy. Reporting it is the only useful
      // response: the user pressed a menu item and needs to know it did not happen.
      this.showMessage(error instanceof Error ? error.message : 'Could not write to the clipboard.');
    }
  }

  /**
   * @purpose Opens the table size picker anchored to the caret.
   * @inputs void.
   * @outputs void.
   * @dataflow view.coordsAtPos(selection.from) -> sizePicker.openAt.
   * @controlflow Read the caret's viewport coordinates, fall back to the pane's top-left, then open.
   *
   * Anchored to the caret rather than to the button that opened it, because the picker is also reachable
   * from the command palette and the menu bar, where there is no button to anchor to.
   */
  private openSizePicker(): void {
    const view = this.proseMirrorBinding.view;

    try {
      const coords = view.coordsAtPos(view.state.selection.from);
      this.sizePicker.openAt(coords.left, coords.bottom);
    } catch {
      // coordsAtPos throws for a position it cannot map, which happens while the pane is hidden in
      // Source-only view. Falling back to the pane's own corner keeps the picker reachable rather than
      // letting a layout question become an exception.
      const rect = this.kdocPane.getBoundingClientRect();
      this.sizePicker.openAt(rect.left + 8, rect.top + 8);
    }
  }

  /**
   * @purpose Opens the multi-level list gallery anchored to the caret, with the caret's own list marked.
   * @inputs void.
   * @outputs void.
   * @dataflow listDepthAt + isBlockActive -> listPicker.setCurrent -> view.coordsAtPos -> listPicker.openAt.
   * @controlflow Read the caret's list kind and depth, mark the matching tile, then open at the caret.
   *
   * The gallery marks where the caret already is, because a gallery that cannot say which of its nine
   * tiles you are standing on is a menu with pictures.
   */
  /**
   * @purpose Opens the Styles gallery anchored to the caret, marked on the caret's own style and with
   *   every entry the caret cannot take greyed out.
   * @inputs void.
   * @outputs void.
   * @dataflow styleIdAt -> setCurrent; canApplyStyle -> setEnabled; coordsAtPos -> openAt.
   * @controlflow Mark the current style, grey what cannot apply, then open at the caret.
   *
   * Every entry is dry-run rather than reasoned about. Asking the command whether it applies is the only
   * answer that cannot fall out of step with what the command actually does when clicked.
   */
  /**
   * @purpose Reports which readings of the last paste's clipboard payload are actually possible.
   * @inputs void.
   * @outputs readonly PasteMode[] - The modes that would insert something.
   * @dataflow lastPaste -> payload inspection -> mode list.
   * @controlflow Plain and Markdown need text; HTML needs an HTML payload; Table needs tabular text.
   *
   * Asked rather than assumed. Offering Table for prose, or HTML for a clipboard that has none, would
   * be offering a choice that quietly does nothing when taken.
   */
  private availablePasteModes(): readonly PasteMode[] {
    const paste = this.lastPaste;
    // Check whether anything has been pasted yet.
    if (paste === null) {
      // Nothing to re-read.
      return [];
    } else {
      // A payload is held: work out what it can be read as.
    }

    const modes: PasteMode[] = [];
    // Check whether there is any text at all.
    if (paste.text.length > 0) {
      // Text is all plain and Markdown need.
      modes.push('plain');
      modes.push('markdown');
    } else {
      // No text: neither plain nor Markdown can insert anything.
    }

    // Check whether the clipboard carried an HTML representation.
    if (paste.html.trim().length > 0) {
      // HTML present: the formatted reading is possible.
      modes.push('html');
    } else {
      // No HTML: a copy from a plain-text source, and there is nothing to convert.
    }

    // Check whether the paste can become a table: tab- or comma-separated text, or an HTML table. canPasteAsTable runs
    // the same tests as the paste itself, so the option is offered exactly when taking it would work.
    if (canPasteAsTable(paste.html, paste.text)) {
      // Tabular: the table reading is possible.
      modes.push('table');
    } else {
      // Not tabular: offering Table would offer a choice that does nothing.
    }

    return modes;
  }

  /**
   * @purpose Shows the after-paste options control at the caret.
   * @inputs void.
   * @outputs void.
   * @dataflow availablePasteModes -> coordsAtPos -> pasteOptionsPopup.showAt.
   * @controlflow Skip when fewer than two readings are possible; otherwise open at the caret.
   */
  private showPasteOptions(): void {
    const paste = this.lastPaste;
    // Check whether there is a paste to offer options for.
    if (paste === null) {
      // Nothing pasted: nothing to offer.
      return;
    } else {
      // A paste is held: work out whether there is a choice worth showing.
    }

    const modes = this.availablePasteModes();
    // Check whether there is more than one reading available.
    if (modes.length < 2) {
      // One reading or none is not a choice, and a control offering no alternative is just clutter
      // over the text the user has just pasted.
      return;
    } else {
      // A real choice: show the control.
    }

    const view = this.proseMirrorBinding.view;
    try {
      const coords = view.coordsAtPos(view.state.selection.to);
      this.pasteOptionsPopup.showAt(coords.left, coords.bottom + 4, modes, paste.mode);
    } catch {
      // coordsAtPos throws for a position it cannot map, which happens while the pane is hidden in
      // Source-only view. There is nowhere sensible to put the control, so it simply does not appear.
    }
  }

  /**
   * @purpose Re-reads the last paste in a different mode, replacing what the first reading inserted.
   * @inputs mode: PasteMode - The reading to apply instead.
   * @outputs void.
   * @dataflow lastPaste range -> setSelection over it -> pasteContent in the new mode -> new range.
   * @controlflow Select the range the paste occupies, paste again over it, and record the new range.
   *
   * The range is replaced rather than undone. Undo would put the *whole* undo entry back, which on a
   * paste into a selection means restoring the text the paste replaced -- and then pasting over it
   * again, leaving two entries in the history for what the user thinks of as one decision.
   */
  private repaste(mode: PasteMode): void {
    const paste = this.lastPaste;
    // Check whether there is a paste to redo.
    if (paste === null) {
      // Nothing held: nothing to redo.
      return;
    } else {
      // A paste is held: replace the range it occupies.
    }

    const view = this.proseMirrorBinding.view;
    const size = view.state.doc.content.size;
    // Check whether the recorded range still lies inside the document. An edit since the paste can
    // have moved or removed it, and replacing a range that is no longer there would delete the wrong
    // text -- much worse than declining to redo.
    if (paste.from < 0 || paste.to > size || paste.from > paste.to) {
      // The range has gone: forget the paste rather than act on a stale position.
      this.lastPaste = null;
      return;
    } else {
      // The range is still valid: select it and paste over it.
    }

    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, paste.from, paste.to),
      ),
    );

    const range = pasteContentAt(view, paste.html, paste.text, mode);
    // Check whether the new reading inserted anything.
    if (range === null) {
      // Nothing inserted: the selection is left as it was, holding the original paste.
    } else {
      // Record the range the paste reports rather than reading the selection back. ProseMirror puts the
      // caret *inside* a newly inserted block, so a table pasted this way would be remembered as one of
      // its cells -- and the next change of mind would paste into the table instead of replacing it.
      this.lastPaste = { ...paste, from: range.from, to: range.to, mode };
    }

    view.focus();
  }

  /**
   * @purpose Opens the Paste Special dialog over the last paste, and applies what the user chooses.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow availablePasteModes -> pasteSpecialDialog.ask -> repaste.
   * @controlflow With nothing pasted, arm the next paste instead and say so; otherwise offer the readings.
   *
   * With no paste to reinterpret there is nothing for the dialog to show, so the command falls back to
   * arming the next paste -- the same mechanism Paste as Plain Text uses, for the same reason: a command
   * cannot reach the clipboard, and a dialog that opened with every option greyed out would be worse
   * than one that does not open.
   */
  private async openPasteSpecial(): Promise<void> {
    this.pasteOptionsPopup.hide();
    const modes = this.availablePasteModes();

    // Check whether there is a paste to offer readings of.
    if (modes.length === 0) {
      // Nothing pasted yet: arm the next paste instead of opening an empty dialog.
      const chosen = await this.pasteSpecialDialog.ask(
        ['plain', 'markdown', 'html', 'table'],
        null,
      );
      // Check whether the user picked a reading.
      if (chosen === null) {
        // Cancelled: nothing to arm.
        return;
      } else {
        // Arm it for the next paste and say so, since nothing visible happens until they press Ctrl+V.
        this.pendingPasteMode = chosen;
        this.showMessage(`Next paste will be inserted as ${chosen}.`);
        return;
      }
    } else {
      // A paste is held: offer its readings with the one already applied marked.
    }

    const paste = this.lastPaste;
    const current = paste === null ? null : paste.mode;
    const chosen = await this.pasteSpecialDialog.ask(modes, current);

    // Check whether the user picked a reading.
    if (chosen === null) {
      // Cancelled: leave the paste as it is.
      return;
    } else {
      // Apply the chosen reading over the range the last one occupies.
      this.repaste(chosen);
    }
  }

  /**
   * @purpose Opens a path chosen from the recent-files list in a new tab.
   * @inputs path: string - The file to open.
   * @outputs Promise<void>.
   * @dataflow fileService.readFile -> openInTab -> recentFiles.record.
   * @controlflow Read the file, open it in a tab, and record the path; report a failed read.
   *
   * It does not ask about unsaved changes. It used to, from when a recent file replaced the document on
   * screen, but the file now opens in a tab of its own and the document it leaves keeps its unsaved work
   * in its tab -- so the question protected nothing and stood between the user and the file.
   */
  private async openRecentPath(path: string): Promise<void> {
    try {
      const file = await this.fileService.readFile(path);
      this.openInTab(file);
      this.recentFiles.record(path);
    } catch (caught: unknown) {
      // A file in the list can have been moved or deleted since it was recorded, and the honest
      // answer is to say so rather than to open an empty buffer named after it.
      this.showMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /**
   * @purpose Shows the merge view when a file changed on disk under a buffer with unsaved edits, and
   *   reports back what the user settled on.
   * @inputs path: string - The file that changed. diskText: string - What is now on disk.
   * @outputs Promise<ConflictResolution> - The resolution to apply, carrying the merged text when merged.
   * @dataflow snapshot.savedText + snapshot.text + diskText -> mergeThreeWay -> mergeDialog.ask -> ConflictResolution.
   * @controlflow Build the three-way merge -> show it -> map the dialog's outcome onto a resolution.
   *
   * The merge has a real common ancestor: the text as it was when the file was last saved, which is what
   * the buffer and the file on disk both diverged from. That is what lets an edit only the user made and an
   * edit only the other program made both be taken without asking. The question the old two-way prompt had
   * to ask -- yours or theirs, all or nothing -- was mostly a question about changes that were never in
   * each other's way.
   */
  private async resolveExternalConflict(path: string, diskText: string): Promise<ConflictResolution> {
    const name = path.split(/[/\\]/).pop() ?? path;
    const snapshot = this.documentSession.snapshot;
    const merge = mergeThreeWay(snapshot.savedText, snapshot.text, diskText);
    const outcome = await this.mergeDialog.ask(name, merge);

    // Check which of the four outcomes the user settled on.
    if (outcome.kind === 'merged') {
      // Merged: the text the merge produced goes into the buffer, unsaved, because it is on disk nowhere.
      return { kind: 'merged', text: outcome.text };
    } else if (outcome.kind === 'takeTheirs') {
      // Use theirs: take the version on disk, discarding the unsaved edits.
      return { kind: 'takeTheirs' };
    } else if (outcome.kind === 'keepMine') {
      // Keep mine: the buffer is untouched and the next save overwrites the external change.
      return { kind: 'keepMine' };
    } else {
      // Decide later: unlike keep mine this records no decision, so the next external change asks again.
      return { kind: 'ignore' };
    }
  }

  /**
   * @purpose Collapses the left sidebar when it is open, and reopens it on whichever panel it last showed.
   * @inputs void.
   * @outputs void.
   * @dataflow sidebar.isCollapsed + sidebar.activePanelId -> collapse() or show().
   * @controlflow Branch on whether the sidebar is collapsed.
   *
   * Reopening on the last panel rather than always on Outline is what makes the shortcut a toggle
   * rather than a way of losing your place: a user who was reading Files and pressed it twice
   * expects to be back in Files.
   */
  private toggleSidebar(): void {
    // Check whether the sidebar is currently collapsed.
    if (this.sidebar.isCollapsed) {
      // Collapsed: reopen it on whichever panel it was last showing, or Outline the first time.
      this.sidebar.show(this.lastSidebarPanelId);
    } else {
      // Open: collapse it.
      this.sidebar.collapse();
    }
    // The sidebars are part of the arrangement a launch puts back (FR-6.10).
    this.restartSessionSave();
  }

  /**
   * @purpose The autocorrect switches as the settings currently stand (FR-7.8).
   * @inputs none
   * @outputs AutocorrectOptions - Options reflecting current smart substitution toggles and replacement table.
   * @dataflow settings.editor.smartSubstitutions + settings.autocorrect -> options
   * @controlflow no branching
   */
  private autocorrectOptions(): AutocorrectOptions {
    // Read when a rule would fire, so a settings change applies without rebuilding the editor.
    return { enabled: this.settings.editor.smartSubstitutions, ...this.settings.autocorrect };
  }

  /**
   * @purpose Collapses the right panel, or reopens it on the panel it last showed (Ctrl+Shift+R, FR-20.2).
   * @inputs void.
   * @outputs void.
   * @dataflow rightSidebar.isCollapsed + lastRightPanelId -> collapse() or show().
   * @controlflow Branch on whether the right panel is collapsed.
   */
  private toggleRightPanel(): void {
    // Check whether the right panel is currently collapsed.
    if (this.rightSidebar.isCollapsed) {
      // Collapsed: reopen it on the panel it last showed, or Comments the first time.
      this.rightSidebar.show(this.lastRightPanelId);
    } else {
      // Open: collapse it.
      this.rightSidebar.collapse();
    }
  }

  /**
   * @purpose Asks the user for a folder and opens it as the vault.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow fileService.chooseFolder -> vault.open -> the panels redraw through the service's onChange.
   * @controlflow Ask for a folder -> do nothing when the user dismisses the picker -> otherwise scan it.
   *
   * The panels are not refreshed here. The service notifies on every step of its scan, and refreshing
   * here as well would mean two things deciding when a panel redraws.
   */
  private async openVaultFolder(): Promise<void> {
    const folder = await this.fileService.chooseFolder();

    // Check whether the user picked a folder.
    if (folder === null) {
      // Dismissed: a cancelled picker is not an error, and no vault changes.
      return;
    } else {
      // Picked: scan it. The panels follow the scan through the service's own notifications.
    }

    // Opening a folder (the same one again included) is when its files may have changed outside the app.
    this.vaultSearch.forget();
    await this.vault.open(folder);
  }

  /**
   * @purpose Opens one of the vault's notes in a tab.
   * @inputs path: string - The note's path on disk.
   * @outputs Promise<void>.
   * @dataflow fileService.readFile -> openInTab -> recentFiles.record.
   * @controlflow Read the file -> open it as a tab -> report a failure rather than opening a blank one.
   *
   * It goes through the same path as opening a file from the File menu, so a note opened from a panel
   * is a tab like any other: it can be saved, closed, and dragged out to its own window.
   */
  private async openNoteFromVault(path: string): Promise<void> {
    const openId = openTabFor(this.tabs.snapshot.tabs, path);
    // A note that is already open is switched to, not read again: a second tab on the same file would split its
    // unsaved edits between two buffers, and whichever saved last would win.
    if (openId !== null) {
      this.activateTab(openId);
      return;
    } else {
      // Not open yet: read it from disk below.
    }
    try {
      const file = await this.fileService.readFile(path);
      this.openInTab(file);
      this.recentFiles.record(path);
    } catch (caught: unknown) {
      // A note can have been moved or deleted since the scan indexed it, and the honest answer is to
      // say so rather than to open an empty buffer named after it.
      this.showMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /**
   * @purpose Collects everything currently wrong with the document, for the Problems panel (FR-14.7).
   * @inputs none - reads this.spellCheck for misspellings and this.vault plus the session for links.
   * @outputs readonly Problem[] - The problems, spelling first and then links.
   * @dataflow spellCheck.misspellings + brokenLinks(document links, vault notes) -> one flat list.
   * @controlflow Add the spelling problems, then the link problems, each skipped when its source is absent.
   *
   * Spelling comes first because the panel groups by kind, and a stable input order is what makes the
   * output order stable: a problem should not move because a different one was fixed.
   */
  private currentProblems(): readonly Problem[] {
    const problems: Problem[] = [];

    // Check whether the spell checker has been installed yet.
    if (this.spellCheck === undefined) {
      // Still building: no check has run, so there is nothing to report.
    } else {
      // Installed: every word it has flagged is a problem the user can act on.
      for (const span of this.spellCheck.misspellings()) {
        problems.push({
          kind: 'spelling',
          label: span.word,
          detail: 'Not in dictionary',
          from: span.from,
          to: span.to,
        });
      }
    }

    // Check whether the session exists yet.
    if (this.documentSession === undefined) {
      // Still building: there is no document to find links in.
    } else if (this.vault.status.root === null) {
      // No vault: a link resolves against the other notes, and without them there is nothing to
      // resolve against. Reporting every internal link as broken would be an accusation, not a finding.
    } else if (this.vault.status.scanning) {
      // Mid-scan: the index is still filling, so every link would be reported broken and then quietly
      // un-reported as its note arrives. A panel that accuses the document and then takes it back is
      // worse than one that waits.
    } else {
      // A scanned vault and a parsed document: now the question has an answer.
      const snapshot = this.documentSession.snapshot;
      // An image is a file, not a note: the document linter checks it on disk (FR-12.7), and asking the vault for
      // a note named img/a.png reported every picture in the document as a broken link.
      const imageStarts = new Set(localImages(snapshot.document).map((image) => image.from));
      const links: readonly NoteLink[] = [
        ...extractWikiLinks(snapshot.text),
        ...extractInlineLinks(snapshot.document.root, snapshot.text).filter((link) => !imageStarts.has(link.offset)),
      ];

      for (const broken of brokenLinks(links, this.vault.notes)) {
        problems.push({
          kind: 'link',
          label: broken.link.target,
          detail: broken.reason,
          from: broken.link.offset,
          to: broken.link.offset + broken.link.target.length,
        });
      }
    }

    // Grammar findings are whatever the last check reported (FR-12.4). They are not recomputed here:
    // recomputing would mean sending the document away again, and the panel refreshes constantly.
    for (const issue of this.grammarIssues) {
      const replacement = issue.replacements[0];
      problems.push({
        kind: 'grammar',
        label: this.documentSession.snapshot.text.slice(issue.offset, issue.offset + issue.length),
        detail: issue.message,
        from: issue.offset,
        to: issue.offset + issue.length,
        // Only the first suggestion becomes a button. A row with five buttons is a row nobody reads,
        // and the rest are in the message the service sent.
        ...(replacement === undefined
          ? {}
          : {
              fix: {
                label: `Use “${replacement}”`,
                edits: [{ from: issue.offset, to: issue.offset + issue.length, insert: replacement }],
              },
            }),
      });
    }

    // Check whether the session exists yet, since fidelity findings index its text.
    if (this.documentSession !== undefined) {
      // Present: structure problems are computed from the snapshot on every refresh, then the last save's fidelity findings.
      problems.push(...this.lint.problems(this.documentSession.snapshot));
      problems.push(...this.fidelity.problems(this.documentSession.snapshot.text));
    } else {
      // Still building: no save has happened.
    }

    return problems;
  }

  /**
   * @purpose Applies a quick-fix from the Problems panel as an external text edit on the active document.
   * @inputs fix - The ProblemFix describing the replacement to apply.
   * @outputs void
   * @dataflow fix → lint.applyFix(fix, snapshot.text) → documentSession.applyExternalText(next).
   * @controlflow Reads the current snapshot; returns early if the controller yields null or an unchanged copy; otherwise applies the edit externally.
   */
  private applyProblemFix(fix: ProblemFix): void {
    // The text to fix is the active document's current snapshot.
    const text = this.documentSession.snapshot.text;
    // Ask the lint controller for the resulting text after applying the fix.
    const next = this.lint.applyFix(fix, text);
    if (next === null) {
      // The controller already reported why it could not apply the fix; do nothing further.
      return;
    } else if (next === text) {
      // A fix that changes nothing must not add an empty undo step; skip without applying.
      return;
    } else {
      // Apply externally: a panel is not a pane and applyText demands the Source pane hold the edit lock, whereas this makes the fix one undoable edit.
      this.documentSession.applyExternalText(next);
    }
  }

  /**
   * @purpose Selects and scrolls to one problem, in whichever pane can actually show it.
   * @inputs kind - Which kind of problem it is. from, to - Its range, in that kind's own units.
   * @outputs void.
   * @dataflow kind -> the pane that owns those coordinates -> a selection dispatched into it.
   * @controlflow Branch on the kind: ProseMirror for spelling, CodeMirror for a link.
   *
   * The kind is what picks the pane, because the two ranges are not measured in the same units. A
   * misspelling's offsets are ProseMirror document positions, counted over nodes; a link's index the
   * raw source text. Resolving either in the other's pane puts the caret somewhere the problem is
   * not, which is worse than not moving it at all.
   */
  private revealProblem(kind: ProblemKind, from: number, to: number): void {
    // Check which coordinate space this problem's range is expressed in.
    if (kind === 'spelling') {
      // ProseMirror positions: move the caret there so the rendered pane scrolls to the word.
      const view = this.proseMirrorBinding.view;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to));
      view.dispatch(tr.scrollIntoView());
    } else {
      // Source offsets: the Source pane is the one that counts in these, so reveal it there.
      // Check whether that pane is on screen, since a range cannot be revealed in a hidden one.
      if (this.currentViewMode === 'kdoc') {
        // Only the rendered pane is showing: open the split so there is something to scroll.
        this.setViewMode('split');
      } else {
        // The Source pane is already visible in split or source mode.
      }

      this.codeMirrorBinding.view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
      });
    }
  }

  /**
   * @purpose Puts an earlier version of the document back, as a new edit (FR-11.10).
   * @inputs index - Position in the session's timeline, as the History panel drew it.
   * @outputs void.
   * @dataflow documentSession.timeline[index].text -> applyExternalText -> a new current document.
   * @controlflow Refuse an index the timeline no longer has -> refuse a no-op -> apply the text.
   */
  private restoreVersion(index: number): void {
    const timeline: readonly HistoryEntry[] = this.documentSession.timeline;

    // Check whether the index still names a version in the timeline.
    if (index < 0 || index >= timeline.length) {
      // It does not. The row the user clicked was drawn from a timeline that has since moved on, and
      // restoring whatever now sits at that index would restore a version they never chose.
      return;
    } else {
      // In range: read it, guarding the index under noUncheckedIndexedAccess.
    }

    const entry: HistoryEntry | undefined = timeline[index];

    // Check whether the entry survived the read.
    if (entry === undefined) {
      // Unreachable given the bounds check above, but the compiler cannot know that and a
      // non-null assertion would only hide it.
      return;
    } else {
      // Present: compare it with what is on screen.
    }

    // Check whether restoring it would change anything.
    if (entry.text === this.documentSession.snapshot.text) {
      // It would not. Restoring the version you are already looking at adds an undo step that undoes
      // nothing, which makes Ctrl+Z appear broken the next time it is pressed.
      return;
    } else {
      // Genuinely different: apply it.
    }

    // applyExternalText, not applyText: applyText demands the Source pane hold the edit lock and
    // throws otherwise, and a panel is not a pane. It also makes the restore an ordinary undoable
    // edit rather than a destructive overwrite, which is what FR-11.10 asks for.
    this.documentSession.applyExternalText(entry.text);
  }

  private openStylesGallery(): void {
    const view = this.proseMirrorBinding.view;
    this.stylesGallery.setCurrent(styleIdAt(view.state));

    for (const entry of STYLE_ENTRIES) {
      this.stylesGallery.setEnabled(entry.id, canApplyStyle(entry.id, view.state));
    }

    try {
      const coords = view.coordsAtPos(view.state.selection.from);
      this.stylesGallery.openAt(coords.left, coords.bottom);
    } catch {
      // coordsAtPos throws for a position it cannot map, which happens while the pane is hidden in
      // Source-only view. The pane's own corner keeps the gallery reachable.
      const rect = this.kdocPane.getBoundingClientRect();
      this.stylesGallery.openAt(rect.left + 8, rect.top + 8);
    }
  }

  /**
   * @purpose Applies one gallery style to the block under the caret.
   * @inputs id: StyleId - The entry the user picked.
   * @outputs void.
   * @dataflow commandForStyle(id) -> view.dispatch -> view.focus.
   * @controlflow Run the command, then return focus to the pane.
   *
   * Focus goes back to the pane because K-Doc keys its edit lock on which pane holds focus, and a style
   * applied from a gallery that left focus behind would leave the user unable to keep typing.
   */
  private applyStyle(id: StyleId): void {
    // Check whether this is the entry whose word belongs to the user rather than to K-Doc.
    if (id === 'callout-custom') {
      // A custom callout needs a word, and the word is a question the shell knows how to ask. The
      // gallery deliberately does not: it shows what a style looks like, and this one looks like
      // whatever the user is about to type.
      void this.applyCustomCallout();
      return;
    } else {
      // An ordinary style: the command is all there is to it.
    }

    const view = this.proseMirrorBinding.view;
    commandForStyle(id)(view.state, view.dispatch);
    view.focus();
  }

  /**
   * @purpose Asks for an alert word and makes the block under the caret a callout carrying it.
   * @inputs void.
   * @outputs Promise<void>.
   * @dataflow alertMarkerAt -> promptDialog.ask -> setCalloutWord -> view.dispatch.
   * @controlflow Offer the word already there as the starting point, then apply what comes back.
   *
   * The prompt opens on the word the block already carries, so changing NOTE to NOTICE is an edit rather
   * than a retype. GFM's alert syntax admits letters only, and setCalloutWord refuses anything else --
   * reported here rather than silently doing nothing, because a dialog that accepted a word and then
   * changed nothing is worse than one that says why.
   */
  private async applyCustomCallout(): Promise<void> {
    const view = this.proseMirrorBinding.view;
    const existing = alertMarkerAt(view.state);

    // Check whether the block already carries an alert word to start from.
    let initial = '';
    if (existing === null) {
      // No marker yet: start empty rather than suggesting one, since any suggestion would be K-Doc's
      // word rather than the user's.
    } else {
      // A marker is there: offer it upper-cased, which is how it is written in the file.
      initial = existing.word.toUpperCase();
    }

    const word = await this.promptDialog.ask('Custom callout', 'Alert word', initial);

    // Check whether the user gave a word.
    if (word === null) {
      // Cancelled: the block is left as it was.
      return;
    } else {
      // A word was given: try to apply it.
    }

    const applied = setCalloutWord(word)(view.state, view.dispatch);
    // Check whether the word was one the format can carry.
    if (applied) {
      // Applied: return focus to the pane so typing continues where it left off.
      view.focus();
    } else {
      // Refused: say why rather than leaving the user to guess at the rule.
      this.showMessage('An alert word can only contain letters.');
    }
  }

  private openListPicker(): void {
    const view = this.proseMirrorBinding.view;
    const depth = listDepthAt(view.state);

    // Check whether the caret is inside a list at all.
    if (depth === null) {
      // Not in a list: no tile is current, and the gallery opens on its first.
      this.listPicker.setCurrent(null, null);
    } else if (isBlockActive(view.state, 'orderedList')) {
      // An ordered list encloses the caret.
      this.listPicker.setCurrent('ordered', depth);
    } else {
      // A bullet list encloses the caret. A task item is a bullet item carrying a checkbox, so which
      // tile matches is decided by whether that checkbox is there rather than by the list type.
      const $from = view.state.selection.$from;
      const checked = $from.depth > 0 ? $from.node($from.depth - 1).attrs['checked'] : null;
      // Check whether the enclosing item carries a checkbox state.
      if (checked === null || checked === undefined) {
        // A plain bullet item.
        this.listPicker.setCurrent('bullet', depth);
      } else {
        // A task item.
        this.listPicker.setCurrent('task', depth);
      }
    }

    try {
      const coords = view.coordsAtPos(view.state.selection.from);
      this.listPicker.openAt(coords.left, coords.bottom);
    } catch {
      // coordsAtPos throws for a position it cannot map, which happens while the pane is hidden in
      // Source-only view. The pane's own corner keeps the gallery reachable.
      const rect = this.kdocPane.getBoundingClientRect();
      this.listPicker.openAt(rect.left + 8, rect.top + 8);
    }
  }

  /**
   * @purpose Builds the command registry against the live editor state.
   * @inputs void.
   * @outputs readonly KdocCommand[] - Every user-invokable command, bound to this shell.
   * @dataflow shell fields -> buildCommandRegistry -> command list.
   * @controlflow Assemble the dependency record and hand it to the registry builder.
   *
   * Called fresh by every consumer rather than cached, because each command closes over live
   * editor state and a cached list would report stale enabled/disabled results the moment the
   * caret moved.
   */
  /**
   * @purpose Gives each registry command the shortcut label the keymap assigns it, so the palette, ribbon and native menu show the keys in effect.
   * @inputs commands - The commands as the registry built them.
   * @outputs readonly KdocCommand[] - The same commands; a remappable one labelled with its first chord, or no label when unbound.
   * @dataflow commands + this.keymap.bindings -> formatChord(first chord) -> copied command with that shortcut.
   * @controlflow Map each command: keep a command the keymap does not cover (its label is fixed), else relabel it.
   */
  private labelWithKeymap(commands: readonly KdocCommand[]): readonly KdocCommand[] {
    return commands.map((command: KdocCommand): KdocCommand => {
      const chords = this.keymap.bindings.get(command.id);
      // Check whether this command's shortcut is remappable.
      if (chords === undefined) {
        // Not in the keymap (list indentation, plain paste): its label describes a fixed key.
        return command;
      } else {
        const first = chords[0];
        return { ...command, shortcut: first === undefined ? '' : formatChord(first) };
      }
    });
  }

  /**
   * @purpose Starts a comment on the selection (FR-10.1), showing the pane that holds it.
   * @inputs none.
   * @outputs void.
   * @dataflow view mode -> split when K-Doc -> comments pane shown -> commentsController.addComment().
   * @controlflow Switch K-Doc to split -> show the comments pane -> add the comment, or say to select text.
   */
  private newComment(): void {
    if (this.currentViewMode === 'kdoc') {
      // The anchor is taken from the Source pane's selection, so that pane must be on screen for this to mean anything.
      this.setViewMode('split');
    } else {
      // A source or split view is already active: no switch needed before reading the selection.
    }
    // Shown before the draft is created: addComment focuses the new card's reply box, and focusing an element inside a hidden pane does nothing.
    this.rightSidebar.show('comments');
    if (!this.commentsController.addComment()) {
      // No usable selection: say so rather than silently doing nothing.
      this.showMessage('Select some text to comment on.');
    } else {
      // The draft is on screen with its reply box focused.
    }
  }

  /**
   * @purpose Turns track changes on or off (FR-11.1), showing the review pane and saying which.
   * @inputs none.
   * @outputs void.
   * @dataflow changesController.tracking -> flipped -> review pane refreshed -> status message.
   * @controlflow Show the review pane -> flip tracking -> refresh -> report on or off.
   */
  private toggleTrackChanges(): void {
    // Shown first, so the user sees the state they just changed.
    this.rightSidebar.show('review');
    const nowOn = !this.changesController.tracking;
    this.changesController.setTracking(nowOn);
    this.refreshReviewPane();
    if (nowOn) {
      this.showMessage('Track changes: on');
    } else {
      this.showMessage('Track changes: off');
    }
  }

  private buildCommands(): readonly KdocCommand[] {
    return [...this.builtInCommands(), ...this.pluginCommands()];
  }

  /**
   * @purpose Builds the commands K-Doc itself has, which the palette, the ribbon and the menus all read.
   * @inputs void.
   * @outputs readonly KdocCommand[] - Every command of K-Doc's own, labelled with the keys in effect.
   * @dataflow buildCommandRegistry -> labelWithKeymap -> commands.
   * @controlflow None of its own; it is the body buildCommands had before plugins could add to it.
   */
  private builtInCommands(): readonly KdocCommand[] {
    return this.labelWithKeymap(buildCommandRegistry({
          view: this.proseMirrorBinding.view,
          pageSetup: (): void => {
            void this.openPageSetup();
          },
          pasteSpecial: (): void => {
            void this.openPasteSpecial();
          },
          openRecent: (): void => {
            this.recentFilesDialog.open(this.recentFiles.files);
          },
          quickOpen: (): void => {
            this.navigation?.openQuickOpen();
          },
          goTo: (): void => {
            void this.navigation?.openGoTo();
          },
          setColumnWidth: (): void => {
            void this.askColumnWidth();
          },
          insertTableOfContents: (): void => {
            void this.askTableOfContents();
          },
          convertToReferenceLinks: (): void => {
            this.convertToReferenceLinks();
          },
          showLinkDefinitions: (): void => {
            this.rightSidebar.show('link-definitions');
          },
          showVersionHistory: (): void => {
            this.showVersionHistory();
          },
          compareDocuments: (): void => {
            this.compareDocuments();
          },
          gitStageFile: (): void => {
            this.gitStageFile();
          },
          gitCommitFile: (): void => {
            this.gitCommitFile();
          },
          toggleFocusParagraph: (): void => {
            this.toggleFocusMode('paragraph');
          },
          toggleFocusSentence: (): void => {
            this.toggleFocusMode('sentence');
          },
          toggleTypewriter: (): void => {
            this.toggleTypewriterMode();
          },
          toggleZen: (): void => {
            this.zenMode.toggle();
          },
          startPresentation: (): void => {
            // Each --- rule starts a new slide; every slide goes through the same renderer as export.
            this.presentation.open(splitSlides(this.documentSession.snapshot.document).map((slide) => renderFragment(slide)));
          },
          exportDocx: (): void => {
            void this.exportDocx();
          },
          exportMarkdown: (): void => {
            this.chooseMarkdownFlavour();
          },
          chooseExportTheme: (): void => {
            void this.chooseExportTheme();
          },
          exportThroughPandoc: (format: PandocFormat): void => {
            void this.exportThroughPandoc(format);
          },
          alignBlocks: (align: 'left' | 'center' | 'right' | null): void => {
            this.alignBlocks(align);
          },
          reportUnusedAttachments: (): void => {
            void this.reportUnusedAttachments();
          },
          chooseAppTheme: (): void => {
            void this.chooseAppTheme();
          },
          openAppThemeFolder: (): void => {
            void this.openAppThemeFolder();
          },
          openExportThemeFolder: (): void => {
            void this.openExportThemeFolder();
          },
          chooseSpellingLanguage: (): void => {
            this.chooseLanguage();
          },
          importDocument: (): void => {
            void this.importDocument();
          },
          checkGrammar: (): void => {
            void this.checkGrammarNow();
          },
          bundleAnnotations: (): void => {
            this.bundleAnnotations();
          },
          toggleSecondaryPane: (): void => {
            this.toggleSecondaryPane();
          },
          unlockDocument: (): void => {
            void this.unlockDocument();
          },
          cycleDocumentWidth: (): void => {
            this.cycleDocumentWidth();
          },
          cycleDocumentDensity: (): void => {
            this.cycleDocumentDensity();
          },
          clearDocumentDisplay: (): void => {
            this.clearDocumentDisplay();
          },
          toggleFold: (): void => {
            this.toggleFold();
          },
          splitAtHeading: (): void => {
            this.splitAtHeading();
          },
          mergeDocument: (): void => {
            this.mergeDocument();
          },
          foldAllHeadings: (): void => {
            this.foldAllHeadings();
          },
          unfoldAll: (): void => {
            this.unfoldAll();
          },
          saveACopy: (): void => {
            this.fileMenu.saveACopy();
          },
          renameDocument: (): void => {
            this.fileMenu.rename();
          },
          revealDocument: (): void => {
            this.fileMenu.reveal();
          },
          openStylesGallery: (): void => {
            this.openStylesGallery();
          },
          openListPicker: (): void => {
            this.openListPicker();
          },
          newDocument: (): void => {
            this.newDocument();
          },
          closeDocument: (): void => {
            this.closeActiveDocument();
          },
          nextDocument: (): void => {
            this.nextDocument();
          },
          openDocument: (): void => {
            this.fileMenu.open();
          },
          saveDocument: (): void => {
            // Ctrl+S saves what the reader is looking at. A second pane holding its own document is where
            // the caret is when they press it, so saving the open document instead would be the wrong file.
            if (this.secondaryDocument !== null && this.secondaryPane.contains(document.activeElement)) {
              void this.saveSecondDocument();
              return;
            } else {
              // The open document is the one to save.
            }
            // Check whether the file will take the write, so a locked document says so rather than
            // failing in the host with an attribute error.
            if (this.allowSave()) {
              this.fileMenu.save();
            } else {
              // Locked: allowSave has already reported it.
            }
          },
          saveDocumentAs: (): void => {
            this.fileMenu.saveAs();
          },
          takeSnapshot: (): void => {
            this.takeSnapshot('manual');
          },
          exportHtml: (): void => {
            void this.exportHtml();
          },
          printDocument: (): void => {
            void this.print();
          },
          zoomIn: (): void => {
            this.setZoom(zoomIn(this.zoom));
          },
          zoomOut: (): void => {
            this.setZoom(zoomOut(this.zoom));
          },
          zoomReset: (): void => {
            this.setZoom(DEFAULT_ZOOM);
          },
          openSettings: (): void => {
            this.settingsDialog.open();
          },
          openKeyboardShortcuts: (): void => {
            this.keyboardShortcutsDialog.open();
          },
          openAbout: (): void => {
            this.aboutDialog.open();
          },
          openUserGuide: (): void => {
            void this.openUserGuide();
          },
          goBack: (): void => {
            void this.navHistory.back();
          },
          goForward: (): void => {
            void this.navHistory.forward();
          },
          showStatistics: (): void => {
            this.statisticsDialog.open();
          },
          pasteAsPlainText: (): void => {
            // Arms the next paste. Invoked from the palette or menu it cannot paste by itself, so it
            // reports what it did rather than appearing to do nothing.
            this.pendingPasteMode = 'plain';
            this.showMessage('Next paste will be inserted as plain text.');
          },
          copyAsMarkdown: (): void => {
            void this.copySelection('markdown');
          },
          copyAsHtml: (): void => {
            void this.copySelection('html');
          },
          insertImage: (): void => {
            // Opened with the image under the caret when there is one, so the same command edits and inserts.
            this.imageDialog.open(imageAt(this.proseMirrorBinding.view.state));
          },
          insertTable: (): void => {
            this.openSizePicker();
          },
          setCodeLanguage: (): void => {
            this.languagePicker.open(codeBlockLanguageAt(this.proseMirrorBinding.view.state));
          },
          checkSpelling: (): void => {
            void this.spellDialog.open();
          },
          toggleSpellCheck: (): void => {
            this.spellCheck.setEnabled(!this.spellCheck.isEnabled);
          },
          customiseRibbon: (): void => {
            this.customiseRibbon();
          },
          showGraph: (): void => {
            this.graphDialog.open();
          },
          openVault: (): void => {
            void this.openVaultFolder();
          },
          makeDefaultMarkdownApp: (): void => {
            this.launchFiles.openDefaultAppsSettings().catch((error: unknown): void => {
              this.showMessage(error instanceof Error ? error.message : String(error), true);
            });
          },
          openDocumentBeside: (): void => {
            void this.openDocumentBeside();
          },
          exportThroughPlugin: (): void => {
            this.exportThroughPlugin();
          },
          reloadPlugins: (): void => {
            void this.reloadPlugins();
          },
          cycleRibbon: (): void => {
            this.cycleRibbon();
          },
          setViewMode: (mode: ViewMode): void => {
            this.setViewMode(mode);
          },
          // Clicking the real buttons rather than reimplementing their handlers keeps the palette and
          // the toolbar on one implementation, including the aria-pressed mirroring each button does.
          toggleTheme: (): void => {
            this.cycleTheme();
          },
          toggleOutline: (): void => {
            this.outlineButton.click();
          },
          toggleSyncScroll: (): void => {
            this.scrollLockButton.click();
          },
          toggleStatusBar: (): void => {
            this.toggleStatusBar();
          },
          openFind: (): void => {
            this.findPanel.open('find');
          },
          // The link under the caret is offered for editing, as the editor's own Ctrl+K did before the keymap owned it.
          openLink: (): void => {
            const state = this.proseMirrorBinding.view.state;
            // Check the selection can hold a link at all (not inside code).
            if (!canLink(state)) {
              this.showMessage('A link cannot go here.');
            } else {
              const current = activeLink(state);
              this.linkDialog.open(current === null ? null : current.attrs);
            }
          },
          undo: (): void => {
            this.documentSession.undo();
          },
          redo: (): void => {
            this.documentSession.redo();
          },
          openCommandPalette: (): void => {
            this.commandPalette.open();
          },
          cycleViewMode: (): void => {
            this.setViewMode(nextViewMode(this.currentViewMode));
          },
          toggleSidebar: (): void => {
            this.toggleSidebar();
          },
          toggleRightPanel: (): void => {
            this.toggleRightPanel();
          },
          openReplacements: (): void => {
            this.replacementsDialog.open();
          },
          openSnippets: (): void => {
            this.snippetsDialog.open();
          },
          openReplace: (): void => {
            this.findPanel.open('replace');
          },
          findInVault: (): void => {
            // The query is focused and selected, so typing replaces the last search.
            this.sidebar.show('search');
            this.searchPanel.focus();
          },
          newComment: (): void => {
            this.newComment();
          },
          toggleTrackChanges: (): void => {
            this.toggleTrackChanges();
          },
    }));
  }

  /**
   * @purpose Cycles the ribbon through expanded, collapsed and hidden (FR-14.1).
   * @inputs void.
   * @outputs void.
   * @dataflow ribbon.state -> next state -> ribbon.setState -> status message.
   * @controlflow Pick the next state in the cycle -> apply it -> name it, since two of the three
   *   states look similar enough that the user needs telling which one they landed on.
   */
/**
   * @purpose Works out what the ribbon should draw: the reader's own arrangement when they have one, K-Doc's otherwise (FR-14.17).
   * @inputs this.settings.appearance.ribbon - the stored ribbon layout setting; buildCommands() supplies the command ids it is matched against.
   * @outputs readonly RibbonTabSpec[] - the tab specs to render for the current build of commands.
   * @dataflow Stored ribbon setting -> knownCommandIds(buildCommands()) -> resolveRibbonLayout -> resolved tab specs.
   * @controlflow Single expression: resolveRibbonLayout reads the stored arrangement and falls back to RIBBON_LAYOUT when it is empty or names nothing this build has, so there is no branch here.
   */
  private ribbonLayoutSpec(): readonly RibbonTabSpec[] {
    return resolveRibbonLayout(this.settings.appearance.ribbon, knownCommandIds(this.buildCommands()));
  }

  /**
   * @purpose Opens the dialog in which the reader arranges the ribbon, and saves what they settle on (FR-14.17).
   * @inputs this.ribbonDialog - already configured with its own layout, commands and onApply callbacks at install time.
   * @outputs void - no return value; saving is handled by the dialog's installed callback, not here.
   * @dataflow User action -> ribbonDialog.open() -> (dialog applies changes via its own onApply) -> applyRibbonLayout saves.
   * @controlflow Opens the dialog and returns immediately; all further work lives in the callbacks supplied when installRibbon ran.
   */
  private customiseRibbon(): void {
    this.ribbonDialog.open();
  }

  /**
   * @purpose Takes the arrangement the reader settled on, redraws the ribbon with it and saves it (FR-14.17).
   * @inputs layout - readonly RibbonTabSetting[] the reader settled on; an empty array means K-Doc's own ribbon.
   * @outputs void - no return value; persistence is a fire-and-forget save that reports failure via showMessage.
   * @dataflow Layout -> merged into settings.appearance.ribbon -> this.settings replaced -> rebuildRibbon draws it -> saved through settingsStore.
   * @controlflow Replace the setting whole, redraw, then report success or (on save error) partial success; empty layout is reported as K-Doc's arrangement.
   */
  private applyRibbonLayout(layout: readonly RibbonTabSetting[]): void {
    // Settings are written whole, as every other change to them is.
    const next: KdocSettings = { ...this.settings, appearance: { ...this.settings.appearance, ribbon: layout } };
    this.settings = next;
    this.rebuildRibbon();
    // An empty arrangement means K-Doc's own ribbon, so the message says which of the two is now drawn.
    if (layout.length === 0) {
      this.showMessage("The ribbon is back to K-Doc's own arrangement.");
    } else {
      this.showMessage('The ribbon is arranged your way.');
    }
    this.settingsStore.save(next).catch((error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`The ribbon is arranged, but the arrangement was not saved. ${message}`);
    });
  }

  /**
   * @purpose Draws the ribbon again after its arrangement changed, keeping the tab and the expanded/collapsed state the reader was on (FR-14.17).
   * @inputs this.ribbon - the current ribbon whose state is captured before it is destroyed; rebuildRibbon() itself takes no parameters.
   * @outputs void - no return value; a fresh Ribbon replaces this.ribbon in place.
   * @dataflow Captured state + active tab -> destroy old ribbon -> installRibbon with live command/layout getters -> restore state and, if present, the active tab.
   * @controlflow Snapshot state then active tab, tear down the old ribbon, build a new one via installRibbon, reapply the snapshot; the previously open tab is only restored when it still exists in the new arrangement.
   */
  private rebuildRibbon(): void {
    const state = this.ribbon.state;
    const activeTab = this.ribbon.activeTab;
    this.ribbon.destroy();
    this.ribbon = installRibbon({
      container: this.ribbonRow,
      doc: document,
      commands: (): readonly KdocCommand[] => this.buildCommands(),
      layout: (): readonly RibbonTabSpec[] => this.ribbonLayoutSpec(),
      onStateChange: (next: RibbonState): void => {
        this.ribbonStateChanged(next);
      },
    });
    this.ribbon.setState(state);
    // The tab the reader was on may not exist in the new arrangement, so it is only restored when it does.
    if (this.ribbonLayoutSpec().some((spec) => spec.tab === activeTab)) {
      this.ribbon.setActiveTab(activeTab);
    } else {
      // That tab is gone: the ribbon keeps the one it opened on.
    }
  }

  /**
   * @purpose Gives the renderer every syntax the reader's plugins added (FR-14.18).
   * @inputs void.
   * @outputs readonly PluginSyntax[] - What the loaded plugins recognise, namespaced by plugin.
   * @dataflow pluginHost.syntaxes -> exports and printouts.
   * @controlflow Guarded because it is read from paths that can run while the shell is still building.
   */
  private pluginSyntax(): readonly PluginSyntax[] {
    // Check whether the host exists yet; exporting is not possible that early, but printing a preview is.
    if (this.pluginHost === undefined) {
      // Still building: no plugin has been read, so nothing of theirs is drawn.
      return [];
    } else {
      return this.pluginHost.syntaxes;
    }
  }

  /**
   * @purpose Turns what the reader's plugins added into commands the palette and the ribbon can run (FR-14.18).
   * @inputs void.
   * @outputs readonly KdocCommand[] - One command per plugin command, named `plugin:<plugin>:<command>`.
   * @dataflow pluginHost.plugins -> registrations of point 'command' -> KdocCommand.
   * @controlflow A plugin command always reports that it can run: whether it can is the plugin's business,
   *   and a button greyed out for reasons K-Doc cannot explain is worse than one that says why it did not.
   */
  private pluginCommands(): readonly KdocCommand[] {
    // Guarded because the registry is built during construction, before the host exists.
    if (this.pluginHost === undefined) {
      // Still building: K-Doc's own commands are all there are.
      return [];
    } else {
      // Built: add one command for each a plugin registered.
    }

    const commands: KdocCommand[] = [];

    for (const plugin of this.pluginHost.plugins) {
      for (const registration of plugin.registrations) {
        // Check whether this is something the reader can run at all.
        if (registration.point !== 'command') {
          continue;
        } else {
          // A command: give it an id no other plugin can collide with.
        }

        const pluginId = plugin.manifest.id;
        const id = registration.id;
        commands.push({
          id: `plugin:${pluginId}:${id}`,
          label: registration.label,
          category: 'View',
          shortcut: '',
          run: (): boolean => {
            void this.runPluginCommand(pluginId, id, plugin.manifest.name);
            return true;
          },
          isEnabled: (): boolean => true,
        });
      }
    }

    return commands;
  }

  /**
   * @purpose Runs one command a plugin added, and applies whatever it answers with (FR-14.18).
   * @inputs pluginId - which plugin; id - which of its commands; name - what to call it in a message.
   * @outputs Promise<void> - Resolves once the answer has been applied or the failure reported.
   * @dataflow document text -> plugin -> replacement text and/or a message -> applyExternalText, status bar.
   * @controlflow A plugin that answers with text rewrites the document as one undoable edit; one that
   *   answers with only a message says it and changes nothing; one that fails says why.
   */
  private async runPluginCommand(pluginId: string, id: string, name: string): Promise<void> {
    try {
      const answer = await this.pluginHost.run(pluginId, 'command', id, this.documentSession.snapshot.text);

      // Check whether the plugin sent back a document to put in place of this one.
      if (answer.text !== null) {
        // It did: apply it as an ordinary edit, so it can be undone like any other.
        this.documentSession.applyExternalText(answer.text);
      } else {
        // It did not: whatever it did, it did not rewrite the document.
      }

      // Check whether it had anything to say.
      if (answer.message !== null) {
        this.showMessage(answer.message);
      } else if (answer.text !== null) {
        // It rewrote the document without saying anything, so say that much.
        this.showMessage(`${name} rewrote the document.`);
      } else {
        // Nothing to apply and nothing to say.
        this.showMessage(`${name} did nothing.`);
      }
    } catch (error: unknown) {
      this.showMessage(`${name} failed. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @purpose Reads the plugins folder again and starts everything in it (FR-14.18).
   * @inputs void.
   * @outputs Promise<void> - Resolves once every plugin has been started or reported.
   * @dataflow pluginHost.load -> pluginsPanel.refresh -> the palette's next read of buildCommands.
   * @controlflow The panel is refreshed whether or not anything loaded, because the problems are the
   *   point when nothing did.
   */
  private async reloadPlugins(): Promise<void> {
    await this.pluginHost.load();
    this.pluginsPanel.refresh();
    this.appMenuBar.refresh();

    // Check whether anything at all came of it, so the reader is told either way.
    if (this.pluginHost.plugins.length === 0 && this.pluginHost.problems.length === 0) {
      this.showMessage('No plugins to load.');
    } else {
      this.showMessage(`${this.pluginHost.plugins.length} plugin(s) loaded, ${this.pluginHost.problems.length} problem(s).`);
    }
  }

  /**
   * @purpose Opens the folder plugins live in, so a reader can put one there (FR-14.18).
   * @inputs void.
   * @outputs Promise<void> - Resolves once the folder is open or the failure is reported.
   * @dataflow pluginHost.folder -> revealInFileManager.
   * @controlflow A host with no folder to name says so rather than opening nothing.
   */
  private async openPluginsFolder(): Promise<void> {
    const folder = await this.pluginHost.folder();

    // Check whether there is a folder to open at all.
    if (folder === '') {
      this.showMessage('Plugins live in a folder the desktop app keeps; there is none here.');
      return;
    } else {
      // There is: show it.
    }

    try {
      await this.fileService.revealInFileManager(folder);
      this.showMessage(`Plugins are the folders in ${folder}.`);
    } catch (error: unknown) {
      this.showMessage(`Could not open the plugins folder. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @purpose Writes the document out in a format a plugin added (FR-14.18).
   * @inputs void.
   * @outputs void - The picker and the write it leads to run on their own.
   * @dataflow pluginHost.plugins -> registrations of point 'export' -> picker -> plugin -> saveFile.
   * @controlflow With no plugin offering a format, it says so rather than opening an empty picker.
   */
  private exportThroughPlugin(): void {
    const formats: { readonly id: string; readonly label: string; readonly detail: string; readonly pluginId: string; readonly formatId: string; readonly extension: string }[] = [];

    for (const plugin of this.pluginHost.plugins) {
      for (const registration of plugin.registrations) {
        // Check whether this is a format the document can be written in.
        if (registration.point !== 'export') {
          continue;
        } else {
          // It is: offer it under the name of the plugin that added it.
        }

        formats.push({
          id: `${plugin.manifest.id}:${registration.id}`,
          label: registration.name,
          detail: plugin.manifest.name,
          pluginId: plugin.manifest.id,
          formatId: registration.id,
          extension: registration.extension,
        });
      }
    }

    // Check whether any plugin offers a format at all.
    if (formats.length === 0) {
      this.showMessage('No plugin adds an export format.');
      return;
    } else {
      // At least one: let the reader choose which.
    }

    this.pluginExportPicker.open(
      formats.map((format) => ({ id: format.id, label: format.label, detail: format.detail })),
      (item): void => {
        const chosen = formats.find((format) => format.id === item.id);

        // Check whether the chosen format is still one that is offered.
        if (chosen === undefined) {
          // The plugins were reloaded while the picker was open: say so rather than writing nothing.
          this.showMessage('That format is no longer offered.');
        } else {
          void this.writePluginExport(chosen.pluginId, chosen.formatId, chosen.label, chosen.extension);
        }
      },
    );
  }

  /**
   * @purpose Asks one plugin to convert the document, and writes what it answers with (FR-14.18).
   * @inputs pluginId - which plugin; formatId - which of its formats; label - what to call it in a message; extension - what the file is called.
   * @outputs Promise<void> - Resolves once the file is written, the dialog dismissed, or the failure said.
   * @dataflow document text -> plugin -> text -> chooseSavePath -> saveFile.
   * @controlflow A plugin that answers with nothing has written nothing, and is said to have.
   */
  private async writePluginExport(pluginId: string, formatId: string, label: string, extension: string): Promise<void> {
    try {
      const answer = await this.pluginHost.run(pluginId, 'export', formatId, this.documentSession.snapshot.text);

      // Check whether the plugin produced anything to write.
      if (answer.text === null) {
        this.showMessage(`${label} produced nothing to write.`);
        return;
      } else {
        // It did: ask where to put it.
      }

      const base = this.documentBaseName();
      const path = await this.fileService.chooseSavePath(`${base}.${extension}`);

      // Check whether the reader chose a place for it.
      if (path === null) {
        // Dismissed: an action deliberately abandoned needs no message.
        return;
      } else {
        // Chosen: write it as plain UTF-8, the way every other export K-Doc writes is written.
      }

      await this.fileService.saveFile({ path, contents: answer.text, encoding: 'utf-8' });
      this.showMessage(`Exported as ${label}: ${path}`);
    } catch (error: unknown) {
      this.showMessage(`${label} failed. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @purpose Shows a hidden or collapsed ribbon fully, or hides an expanded one, from the top-bar toggle.
   * @inputs None.
   * @outputs void.
   * @dataflow ribbon.state -> next state -> ribbon.setState (which persists and re-labels via ribbonStateChanged).
   * @controlflow Expanded hides; any other state expands.
   */
  private toggleRibbonVisibility(): void {
    // Check whether the ribbon is fully showing.
    if (this.ribbon.state === 'expanded') {
      // Showing: hide the whole row.
      this.ribbon.setState('hidden');
    } else {
      // Hidden or collapsed: bring it back in full.
      this.ribbon.setState('expanded');
    }
  }

  /**
   * @purpose Reacts to any ribbon state change (toggle, Ctrl+F1, rebuild): remembers it and updates the toggle.
   * @inputs next - The ribbon's new state.
   * @outputs void.
   * @dataflow next -> localStorage (kdoc.ribbon.v1) and the toggle's icon/label.
   * @controlflow Persist, then re-label.
   */
  private ribbonStateChanged(next: RibbonState): void {
    writeRibbonState(ribbonStateStore(window), next);
    this.syncRibbonToggle();
  }

  /**
   * @purpose Draws the toggle for the current ribbon state: chevron-up 'Hide ribbon' while expanded, chevron-down 'Show ribbon' otherwise.
   * @inputs None.
   * @outputs void.
   * @dataflow ribbon.state -> aria-expanded, aria-label, title and icon on the toggle button.
   * @controlflow Guarded: the ribbon does not exist yet while the toolbar is being built.
   */
  private syncRibbonToggle(): void {
    // Check whether the ribbon has been built yet.
    if (this.ribbon === undefined) {
      // Still constructing: the first install calls this again.
      return;
    } else {
      // Built: reflect its state.
    }
    const shown = this.ribbon.state === 'expanded';
    // Label the action the button will take, which is the opposite of the current state.
    const label = shown ? 'Hide ribbon' : 'Show ribbon';
    this.ribbonToggleButton.setAttribute('aria-expanded', String(shown));
    this.ribbonToggleButton.setAttribute('aria-label', label);
    this.ribbonToggleButton.title = `${label} (Ctrl+F1 cycles)`;
    // Chevron-up collapses the row; chevron-down brings it back.
    this.ribbonToggleButton.replaceChildren(createIcon(document, shown ? 'chevron-up' : 'chevron-down', 18));
  }

  /**
   * @purpose Hides a showing status bar or shows a hidden one (View > Panels > Status Bar, command palette).
   * @inputs None.
   * @outputs void.
   * @dataflow Current visibility -> its opposite -> setStatusBarVisible.
   * @controlflow Single call; setStatusBarVisible persists the result.
   */
  private toggleStatusBar(): void {
    this.setStatusBarVisible(!this.isStatusBarVisible());
  }

  /**
   * @purpose Reports whether the status bar is showing, for the toggle and the menu's tick.
   * @inputs None.
   * @outputs boolean - True unless the bar carries the hidden class.
   * @dataflow statusBarElement class list -> boolean.
   * @controlflow Single expression.
   */
  private isStatusBarVisible(): boolean {
    return !this.statusBarElement.classList.contains('kdoc-status-hidden');
  }

  /**
   * @purpose Shows or hides the status bar (with its breadcrumb and saved indicator) and optionally remembers the choice.
   * @inputs visible - True to show the bar; persist - Whether to save the choice (false when restoring it at launch).
   * @outputs void.
   * @dataflow visible -> kdoc-status-hidden class on the bar -> localStorage (kdoc.statusbar.v1) when persist is true.
   * @controlflow Toggle the class -> save only when asked.
   */
  private setStatusBarVisible(visible: boolean, persist: boolean = true): void {
    this.statusBarElement.classList.toggle('kdoc-status-hidden', !visible);
    // Check whether this change should be remembered for the next launch.
    if (persist) {
      // A reader's choice: save it.
      writeStatusBarVisibility(statusBarStore(window), visible ? 'shown' : 'hidden');
    } else {
      // Restoring the saved choice at launch: nothing new to save.
    }
  }

  private cycleRibbon(): void {
    let next: RibbonState;

    // Check the current state to pick the next one in the cycle.
    if (this.ribbon.state === 'expanded') {
      // Expanded collapses to the tab strip alone.
      next = 'collapsed';
    } else if (this.ribbon.state === 'collapsed') {
      // Collapsed hides entirely.
      next = 'hidden';
    } else {
      // Hidden comes back fully, so one more press always returns the user to a usable ribbon.
      next = 'expanded';
    }

    this.ribbon.setState(next);
    this.showMessage(`Ribbon ${next}.`);
  }

  /**
   * @purpose Builds every controller that belongs to one document (FR-6.8).
   * @inputs state - The document to mount: its text, its file (null when untitled), and, for a tab being
   *   switched back to, the text as of its last save and the encoding its file was found in.
   * @outputs void.
   * @dataflow state.text + state.savedText -> DocumentSession -> bindings -> the controllers over them;
   *   state.path + state.encoding -> file menu.
   * @controlflow Create the session, then each controller that captures it or the view, in dependency order.
   *
   * Split out of the constructor so a tab switch rebuilds exactly what the first document got.
   * Everything here captures either the session or the ProseMirror view at construction and so cannot
   * be pointed at another document afterwards. The alternative -- teaching each of these to swap its
   * session -- would put the same rebuild logic in a dozen places instead of one.
   */
  private mountDocument(state: DocumentState): void {
    // A different document may reference different files, and one it shares may have changed on disk.
    this.imageLoader.clear();
    // The width and density belong to the document, so they are read here, where a tab switch and a
    // first open both arrive, rather than at each of the places that open one.
    this.displayOverride = this.savedDisplayFor(state.path);
    this.applyZoom();
    // The lock belongs to the document, so it is read here, where a first open and a tab switch both
    // arrive. applyLock runs after the bindings exist, at the end of the mount.
    this.locked = state.locked === true;
    // Step 4: Create authoritative DocumentSession from the text, keeping the saved text a tab carried so
    // unsaved work stays unsaved across a switch.
    this.documentSession = new DocumentSession(state.text, { savedText: state.savedText });
    // The Fidelity Check follows the mounted document; attaching replaces the previous one's tracking.
    this.fidelity.attach(this.documentSession);
    // A different document references different images; answers about the last one's files are dropped.
    this.lint.reset();
    // Each document gets its own first warning about pipes and line breaks in table cells.
    this.tableEscapesWarned.clear();
    // Folds (FR-8.29) come before the bindings, which take the fold plugin and the Source listener from them.
    const foldSync = createFoldSync({
      initialKeys: state.folds ?? this.savedFoldsFor(state.path),
      documentOf: () => this.documentSession.snapshot.document,
      sourceView: () => this.codeMirrorBinding.view,
      persist: (keys: readonly string[]): void => {
        this.persistFolds(keys);
      },
    });
    this.foldSync = foldSync;

    // Step 5: Create both view bindings over the shared DocumentSession.
    this.proseMirrorBinding = new ProseMirrorBinding({
      session: this.documentSession,
      // The shell's keymap dispatches the remappable shortcuts (FR-14.16), so the editor must not also bind them.
      hostOwnsShortcuts: true,
      // Read on every keystroke, so turning Markdown input rules off in Settings applies at once.
      inputRulesEnabled: (): boolean => this.settings.editor.inputRules,
      // Local pictures load through the host (FR-8.14).
      loadImage: (src: string): Promise<string | null> => this.loadImageSource(src),
      mount: this.kdocPane,
      // Ctrl+Click on a link follows it (FR-8.13); the same route as the hover card and the context menu.
      onFollowLink: (href: string): void => {
        void this.followLink(href);
      },
      // Passed to the binding rather than added afterwards: syncFromSession rebuilds the EditorState
      // from the binding's own plugin list, so a plugin added later would survive until the first
      // external reload and then vanish.
      plugins: [createSpellPlugin(), createCommentPlugin(), createChangePlugin(), createChangeBarPlugin(), createSearchPlugin(), createCommentNotePlugin(), createCodeHighlightPlugin(), createCodeCopyPlugin(), createTableGripsPlugin(), createCalloutPlugin(), createTableEscapeWarningPlugin((kind: TableEscapeKind): void => { this.warnTableEscape(kind); }), createFoldPlugin(foldSync.store), createFormatPainterPlugin(), createAutocorrectPlugin((): AutocorrectOptions => this.autocorrectOptions()), createSnippetPlugin((): SnippetOptions => this.settings.snippets), createWritingModesPlugin((): WritingModes => this.writingModes)],
      loadMedia: (src: string): Promise<string | null> => this.loadMediaSource(src),
      clipboard: createClipboardHandlers({
        schema: kdocSchema,
        onPasteImages: (images: readonly File[]): boolean => {
          // Check whether there is a folder to write into; without one the paste is left to the text handling,
          // which at least puts something in the document.
          if (this.attachmentsFolder() === '') {
            this.showMessage('Save the document first, so K-Doc knows where its attachments go.');
            return false;
          } else {
            // A folder: write every image the clipboard carried.
          }
          void this.embedPastedImages(images);
          return true;
        },
        onRichPaste: (info): void => {
          // The mode is recorded alongside the payload because the popup has to say which reading is
          // already in the document -- an options control that cannot tell you what you have is a
          // control that makes you guess.
          const mode: PasteMode = info.html.length > 0 ? 'html' : 'markdown';
          this.lastPaste = { from: info.from, to: info.to, html: info.html, text: info.text, mode };
          this.showPasteOptions();
        },
        takePasteMode: (): PasteMode | null => {
          // Read once and clear: the override belongs to one paste, not to every paste that follows.
          const mode = this.pendingPasteMode;
          this.pendingPasteMode = null;
          return mode;
        },
      }),
      // The toolbar reflects the caret, and moving the caret changes no text, so the session never
      // fires for it. This is the only signal that carries a selection-only change.
      onStateChange: (): void => {
        // The breadcrumb follows the caret, and a caret move changes no text (FR-9.9).
        this.navigation?.scheduleBreadcrumbs();

        // The ribbon mirrors the caret; it is guarded because the binding fires during construction,
        // before the ribbon exists.
        if (this.ribbon !== undefined) {
          // Check whether the caret currently sits inside a GFM table.
          if (isInTable(this.proseMirrorBinding.view.state)) {
            this.ribbon.setContextualTableTabVisible(true);
          } else {
            this.ribbon.setContextualTableTabVisible(false);
          }
          this.ribbon.refresh();
        } else {
          // Still constructing: no ribbon to refresh yet.
        }

        // Check whether the in-app menu bar has been installed before refreshing its state.
        if (this.appMenuBar !== undefined) {
          this.appMenuBar.refresh();
        } else {
          // Still constructing: no app menu bar to refresh yet.
        }

        // The binding is constructed before the menus exist, and it fires during that construction,
        // so this is undefined on the first calls rather than merely null.
        if (this.slashMenu !== undefined) {
          // Menus installed: let the slash menu open, filter or close itself from the new caret.
          this.slashMenu.refresh();
        } else {
          // Still constructing: there is no menu to refresh yet.
        }

        // Same guard, same reason: the binding fires during its own construction, before the spell
        // controller built from it exists.
        if (this.spellCheck !== undefined) {
          // Installed: restart the debounce. A selection-only change costs nothing here, because
          // this restarts a timer rather than running a check.
          this.spellCheck.schedule();
        } else {
          // Still constructing.
        }
      },
      onRequestLink: (current: LinkRange | null): void => {
        this.linkDialog.open(current === null ? null : current.attrs);
      },
    });

    this.codeMirrorBinding = new CodeMirrorBinding({
      session: this.documentSession,
      mount: this.sourcePane,
      // Comment marks live in the Source pane because a decoration plan is expressed in source
      // offsets, which is exactly how CodeMirror indexes its document.
      extensions: [commentMarks(), commentSpanTheme(), changeMarks(), changeSpanTheme(), changeBars(), changeBarTheme(), searchMarks(), searchMarkTheme(), commentNotes(), commentNoteTheme(), foldSync.sourceExtension, writingModes((): WritingModes => this.writingModes)],
      // The outline marks the section the caret is in, and the caret offset it reads is CodeMirror's.
      // Moving the caret changes no text, so the session never fires: this is the only signal for it.
      onStateChange: (): void => {
        // The breadcrumb follows the Source caret too (FR-9.9).
        this.navigation?.scheduleBreadcrumbs();
        // CodeMirror can emit its first update while this constructor is still running, before the
        // outline pane is assigned. The field's type says it is always there; at runtime it is not.
        if (this.outlinePane === null) {
          // Pane not installed yet: the install's own initial refresh will cover this.
          return;
        } else {
          // Pane installed: re-mark the section the caret is now in.
          this.outlinePane.refresh();
        }
      },
    });

    // Step 6: Subscribe to the session and refresh status bar on every change.
    this.unsubscribeSession = this.documentSession.subscribe((change): void => {
      this.refreshStatusBar();
      // A grammar finding's offsets describe the document as it was when it was checked, so an edit
      // makes them point at the wrong words (FR-12.4). A focus move changes no text and is left alone.
      if (change.reason === 'focus') {
        // Nothing was edited: the findings still describe this text.
      } else {
        this.clearGrammarIssues();
        // A lang: line added, changed or removed in the front matter changes the dictionary at once (FR-12.3).
        this.noticeDeclaredLanguage();
      }
      // An edit can add, remove or rename the headings the breadcrumb shows.
      this.navigation?.scheduleBreadcrumbs();
      // Route table detection signal to contextual table tab on document change.
      if (this.ribbon !== undefined) {
        // Check whether the caret currently sits inside a GFM table.
        if (isInTable(this.proseMirrorBinding.view.state)) {
          this.ribbon.setContextualTableTabVisible(true);
        } else {
          this.ribbon.setContextualTableTabVisible(false);
        }
        this.ribbon.refresh();
      } else {
        // Still constructing: no ribbon to refresh yet.
      }

      // Check whether the in-app menu bar has been installed before refreshing its state.
      if (this.appMenuBar !== undefined) {
        this.appMenuBar.refresh();
      } else {
        // Still constructing: no app menu bar to refresh yet.
      }

      this.findPanel.refresh();

      // Same construction-order guard as the CodeMirror observer above.
      if (this.outlinePane === null) {
        // Pane not installed yet: nothing to refresh.
      } else {
        // Pane installed: rebuild the outline from the new document.
        this.outlinePane.refresh();
      }

      // The backlinks panel is deliberately absent from this list: what links TO this note is a fact
      // about the other notes, and editing this one cannot change it.
      this.historyPanel.refresh();
      this.metadataPanel.refresh();
      this.problemsPanel.refresh();
      this.linkDefinitionsPanel.refresh();
      // Source rebuilds its text when the other pane edits, which drops its folds; put them back.
      foldSync.sessionChanged();
    });

    this.fileMenu = installFileMenu({
      toolbar: this.fileGroup,
      // Open, Save and Save As keys come from the keymap (FR-14.16).
      ownShortcuts: false,
      session: this.documentSession,
      // Without it every mounted tab would forget its file, and the next capture would store that loss.
      initialPath: state.path,
      // Likewise the encoding: without it a UTF-16 file switched back to would be saved as UTF-8.
      initialEncoding: state.encoding ?? 'utf-8',
      onSaved: (text: string): void => {
        // Check whether saves take snapshots (FR-11.8).
        if (this.settings.history.snapshotOnSave) {
          // On: keep a copy of what was just written; text identical to the newest snapshot is skipped.
          this.takeSnapshot('save', text);
        } else {
          // Off: snapshots come only from the timer and the command.
        }
        // A save is a natural moment for image files to have appeared on disk, so forget what the host said.
        // It goes first because the Fidelity Check's report redraws the panel, which would re-read the old answers.
        this.lint.reset();
        this.fidelity.saved(text);
        // Redraw even when the Fidelity Check is off, so the images are asked about again.
        this.problemsPanel.refresh();
        // The index describes the note's headings, links and tags; a save changes them.
        this.syncVaultAfterSave(text);
      },
      fileService: this.fileService,
      win: window,
      onChange: (): void => {
        // The watch follows the open file: an Open or Save As changes which path matters, and a watch
        // left on the previous file would report its changes as though they were this document's.
        this.externalWatch.setPath(this.fileMenu.filePath);

        // A save or open leaves the session clean, at which point this buffer's journal describes work
        // that is now safely on disk. Leaving it would make the next launch offer to "recover" it.
        if (!this.documentSession.snapshot.dirty) {
          this.recovery.clear();
        } else {
          // Still dirty: the journal is still the only copy of the unsaved part.
        }
        this.refreshStatusBar();

        // A Save As gives the document a different path, which is the one input both of these read
        // that an edit never changes -- so the session's own subscription would never report it.
        this.backlinksPanel.refresh();
        this.metadataPanel.refresh();
      },
      onError: (message: string): void => {
        this.showMessage(message);
      },
      confirmUnsaved: (message: string): Promise<'save' | 'discard' | 'cancel'> => {
        return this.confirmDialog.ask(message);
      },
      onRenamed: (from: string, to: string): void => {
        this.announceMove(from, to);
      },
      onPathUsed: (path: string): void => {
        this.recentFiles.record(path);
      },
      promptName: (currentName: string): Promise<string | null> => {
        return this.promptDialog.ask('Rename', 'New name', currentName);
      },
    });

    this.findPanel = installFindPanel({
      // Find and Replace keys come from the keymap (FR-14.16).
      ownShortcuts: false,
      readScope: (): { readonly root: import('mdast').Root; readonly caretOffset: number } => {
        // Read fresh on every search: the snapshot's tree and the caret both move as the user types,
        // and a scope computed once would narrow against a document that no longer exists.
        return {
          root: this.documentSession.snapshot.document.root,
          caretOffset: this.codeMirrorBinding.view.state.selection.main.head,
        };
      },
      readSelection: (): { readonly start: number; readonly end: number } | null => {
        // The selection comes from the Source pane because the search operates over source character offsets and that is the pane indexed by them.
        const main = this.codeMirrorBinding.view.state.selection.main;

        if (main.from === main.to) {
          // A collapsed selection has no range to offer, so report nothing rather than a zero-width match.
          return null;
        } else {
          // An open selection: expose its source-offset bounds for the find panel to search against.
          return { start: main.from, end: main.to };
        }
      },
      onMatches: (matches: readonly SearchMatch[], activeIndex: number): void => {
        this.paintSearchMatches(matches, activeIndex);
      },      container: this.findRow,
      doc: document,
      session: this.documentSession,
      revealRange: (start: number, end: number): void => {
        // A match the user cannot see is not a result. When only the K-Doc pane is showing there is
        // nowhere to reveal a source offset, so the view switches to split rather than silently
        // selecting text in a hidden pane.
        if (this.currentViewMode === 'kdoc') {
          this.setViewMode('split');
        } else {
          // The Source pane is already visible in split or source mode.
        }

        this.codeMirrorBinding.view.dispatch({
          selection: { anchor: start, head: end },
          scrollIntoView: true,
        });
      },
      applyText: (next: string): void => {
        // Deliberately NOT applyText with a borrowed Source-pane lock. The bindings infer an edit's
        // origin from which pane holds it, so borrowing made the Source binding discard the change as
        // its own echo: the K-Doc pane updated and the Source pane did not.
        this.documentSession.applyExternalText(next);
      },
      onClose: (): void => {
        // Escape would otherwise leave focus on a now-hidden input, and the next keystroke would be lost.
        this.proseMirrorBinding.focus();
      },
      onError: (message: string): void => {
        this.showMessage(message);
      },
    });

    this.outlinePane = installOutlinePane({
      container: this.outlineNav,
      doc: document,
      session: this.documentSession,
      revealRange: (start: number, end: number): void => {
        this.navHistory.recordJump();
        // Same reasoning as the find panel: a heading cannot be revealed in a pane that is not on screen.
        if (this.currentViewMode === 'kdoc') {
          this.setViewMode('split');
        } else {
          // The Source pane is already visible in split or source mode.
        }

        this.codeMirrorBinding.view.dispatch({
          selection: { anchor: start, head: end },
          scrollIntoView: true,
        });
      },
      caretOffset: (): number => {
        return this.codeMirrorBinding.view.state.selection.main.head;
      },
      moveSection: (fromIndex: number, toIndex: number): void => {
        // The current source text of record that a reorder would be spliced into.
        const text = this.documentSession.snapshot.text;
        // Rebuild the outline from the parsed document rather than trusting a cached list, because the pane's indices name positions in an ordered list that the document may have changed underneath since it was last shown.
        const entries = buildOutline(this.documentSession.snapshot.document);
        // Attempt to splice the section at fromIndex just before toIndex; moveSection returns the original text when it refuses or changes nothing.
        const next = moveSection(text, entries, fromIndex, toIndex);

        // Check whether moveSection returned the identical string, which means the drag was either refused (a section dropped inside itself) or changed nothing at all.
        if (next === text) {
          // No change occurred: return without applying anything so a no-op or rejected move does not write an entry into the undo history for an edit that never happened.
          return;
        } else {
          // The reorder produced genuinely new source, so apply it as an external change rather than borrowing a pane's edit lock — a whole-document splice initiated by the outline would otherwise be read by the bindings as that pane's own echo.
          this.documentSession.applyExternalText(next);
          // A drag that moved the document without visible feedback reads as a failed drag, since the pane the user is looking at may not be the one that scrolled; confirm the move in the status area.
          this.showMessage('Section moved');
        }
      },
    });

    this.annotationStore = createAnnotationStore({
      win: window,
      documentPath: (): string | null => this.fileMenu.filePath,
      readText: (): string => this.documentSession.snapshot.text,
      applyText: (text: string): void => {
        this.documentSession.applyExternalText(text);
      },
      onError: (error: Error): void => {
        this.showMessage(`Comments: ${error.message}`);
      },
    });

    this.commentsController = createCommentsController({
      doc: document,
      session: this.documentSession,
      store: this.annotationStore,
      // The author name is read at the moment a comment is written rather than when the document opened, so a rename in Settings applies to newly written comments immediately. There is no fallback here because the settings schema refuses a blank name and always keeps a default.
      author: (): string => this.settings.general.authorName,
      readSelection: (): { readonly start: number; readonly end: number } | null => {
        // The Source pane (CodeMirror) indexes characters by raw source offset, which is exactly what a comment anchor records; the ProseMirror selection would require an as-yet-undefined position mapping, so read from CodeMirror instead.
        const { from, to } = this.codeMirrorBinding.view.state.selection.main;
        if (from === to) {
          // No characters are selected: a comment needs a real range of source offsets, so return null.
          return null;
        } else {
          // A non-empty selection exists: anchor the comment across its start..end source offsets.
          return { start: from, end: to };
        }
      },
      revealRange: (start: number, end: number): void => {
        // A comment the user cannot see is not a comment; switch view before moving the caret rather than selecting text inside a Source pane that would remain off-screen.
        if (this.currentViewMode === 'kdoc') {
          // K-Doc-view-only view: reveal the Source pane so the revealed range becomes visible to the user.
          this.setViewMode('split');
        } else {
          // The Source pane is already on screen (split or source mode): no view switch is required.
        }

        this.codeMirrorBinding.view.dispatch({
          selection: { anchor: start, head: end },
          scrollIntoView: true,
        });
      },
      onSpans: (spans: readonly CommentSpan[]): void => {
        // The Source pane takes the plan unchanged because a CodeMirror document is indexed by source offsets already.
        setCommentSpansIn(this.codeMirrorBinding.view, spans);

        // ProseMirror positions and source offsets are different coordinate systems — markup characters exist in one and not the other — so every span must be translated before painting here.
        const pmView = this.proseMirrorBinding.view;
        const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);

        // The index is rebuilt on each plan rather than cached: a plan arrives only when a comment is added, edited, resolved or deleted, never on a keystroke, so the walk costs nothing in the common case — and a cached index would go stale on the very next edit, which is exactly the situation where a wrong position would be painted.
        pmView.dispatch(setCommentSpans(pmView.state.tr, mapSpansToPositions(index, spans)));

        // A plan arrives whenever a comment is added, selected, resolved or deleted — every occasion on which the anchored text or its card could have moved, so recompute the connector after each one.
        this.scheduleLeaderLine();

        // The same occasions are the ones on which a document keeping its comments in itself (FR-10.6)
        // has to be rewritten.
        this.syncPortableComments();
      },
      onNotes: (notes: readonly InlineNote[]): void => {
        // The CodeMirror document is indexed by source offsets already, so a note's offset needs no translation before painting.
        const cmNotes: CommentNote[] = notes.map((note) => ({
          threadId: note.threadId,
          offset: note.offset,
          author: note.author,
          body: note.body,
        }));
        setCommentNotesIn(this.codeMirrorBinding.view, cmNotes);

        // ProseMirror indexes by document position rather than source offset; capture the view and build an index from the live snapshot so offsets can be translated.
        const pmView = this.proseMirrorBinding.view;
        const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);
        const pmNotes: CommentNotePoint[] = [];

        for (const note of notes) {
          // Translate the source offset to a ProseMirror document position; null means the text no longer exists at that offset.
          const pos = offsetToPosition(index, note.offset);

          if (pos === null) {
            // The mapper cannot place this note: drop it rather than guess, because a note beside the wrong sentence says the wrong thing about it.
          } else {
            // A position resolved; record the note at that exact spot so it sits beside the text it annotates.
            pmNotes.push({ threadId: note.threadId, pos, author: note.author, body: note.body });
          }
        }

        // Both panes are painted whatever the view mode is; skipping the hidden pane would leave a stale set that reappears the moment the user switches back.
        setCommentNotes(pmView, { notes: pmNotes });
      },
      onError: (error: Error): void => {
        this.showMessage(`Comments: ${error.message}`);
      },
    });

    // The panel body outlives the controller, which is rebuilt on every mount, so the previous
    // document's pane is removed before this one's is attached. Without this the panel would show
    // the comments of every document opened so far, stacked.
    while (this.commentsNav.firstChild !== null) {
      this.commentsNav.removeChild(this.commentsNav.firstChild);
    }
    this.commentsNav.appendChild(this.commentsController.element);

    // Loaded after construction so a slow or failing read cannot delay the editor appearing.
    void this.commentsController.load();

    this.reviewPane = createReviewPane({
      doc: document,
      callbacks: {
        onSelect: (changeId: string): void => {
          // Record the selection so the pane and controller agree on which change is active.
          this.activeChangeId = changeId;
          const change = this.changesController.changes().find((c) => c.id === changeId);
          if (change !== undefined) {
            // A matching change exists, so navigate to it.
            if (this.currentViewMode === 'kdoc') {
              // K-Doc hides anchors, so switch to split view first.
              this.setViewMode('split');
            }
            const at = Math.max(0, Math.min(change.anchor.offset, this.codeMirrorBinding.view.state.doc.length));
            // The recorded offset is a hint rather than a resolved position: good enough to scroll to but not to paint with.
            this.codeMirrorBinding.view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
          } else {
            // No matching change, so there is nothing to navigate to; the pane still updates below.
          }
          this.refreshReviewPane();
        },
        onDecide: (changeId: string, decision: ChangeDecision): void => {
          this.changesController.decide(changeId, decision);
        },
        onDecideAll: (decision: ChangeDecision, scope: DecisionScope): void => {
          // The selection is read from the Source pane: a change's range lives in source offsets,
          // and only CodeMirror indexes those offsets.
          if (scope.kind === 'author') {
            // Author filter: decide only changes attributed to this author.
            this.changesController.decideAll(decision, { author: scope.author });
          } else if (scope.kind === 'selection') {
            const sel = this.codeMirrorBinding.view.state.selection.main;
            // A collapsed caret selects no changes, so acting on it would look like the button had failed; saying so is better than silently doing nothing.
            if (sel.from === sel.to) {
              this.showMessage('Select some text first, or choose "in document".');
              return;
            } else {
              // The caret spans a range: pass it as the filter's bounds.
              this.changesController.decideAll(decision, { range: { start: sel.from, end: sel.to } });
            }
          } else {
            // An absent filter means every change, so the document scope needs no filter of its own.
            this.changesController.decideAll(decision);
          }
        },
        onModeChange: (mode: MarkupMode): void => {
          this.changesController.setMode(mode);
        },
        onTrackingChange: (on: boolean): void => {
          this.changesController.setTracking(on);
          this.refreshReviewPane();
        },
      },
    });

    this.changesController = createChangesController({
      session: this.documentSession,
      store: this.annotationStore,
      // The author name is read at the moment a tracked change is written rather than when the document opened, so a rename in Settings applies to newly recorded changes immediately. There is no fallback here because the settings schema refuses a blank name and always keeps a default.
      author: (): string => this.settings.general.authorName,
      newId: (): string => generateUlid(),
      applyText: (text: string): void => {
        this.documentSession.applyExternalText(text);
      },
      onSpans: (spans: readonly ChangeSpan[]): void => {
        // A CodeMirror document is already indexed by source offsets, so paint the Source pane directly.
        setChangeSpansIn(this.codeMirrorBinding.view, spans);
        // The K-Doc pane is painted whatever the current view mode: skipping it while the Source pane
        // is showing would leave a stale set behind the moment the user switched back.
        const pmView = this.proseMirrorBinding.view;
        const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);
        pmView.dispatch(setChangeSpans(pmView.state.tr, mapChangeSpansToPositions(index, spans)));
      },
      onBars: (bars: readonly ChangeBar[]): void => {
        // Both panes are painted on every plan regardless of the current view mode, because whichever pane is hidden would otherwise be left with a stale bar set that resurfaces the instant the user switches back.

        // The CodeMirror document is already indexed by source offsets, so the Source pane's gutter takes the plan's lineStart values unchanged without any remapping through the ProseMirror mapper.
        setChangeBarsIn(this.codeMirrorBinding.view, bars);

        // Build the ProseMirror position index from the current mdast root and live document, exactly as onSpans does, so each bar's source offset can be resolved to a concrete document position in this pane.
        const pmView = this.proseMirrorBinding.view;
        const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);

        const positions: number[] = [];
        for (const bar of bars) {
          const position = offsetToPosition(index, bar.lineStart);
          // A line the mapper cannot place is dropped rather than guessed at: a bar in the wrong margin claims a line changed that did not.
          if (position === null) {
            continue;
          } else {
            // The offset mapped cleanly, so this line gets a bar beside its block.
          }
          positions.push(position);
        }
        setChangeBarPositions(pmView, positions);
      },
      onChanged: (): void => {
        this.refreshReviewPane();
      },
      onError: (error: Error): void => {
        this.showMessage(`Track changes: ${error.message}`);
      },
    });

    // Rebuild the pane body from scratch so stale nodes never accumulate across reloads.
    while (this.reviewNav.firstChild !== null) {
      this.reviewNav.removeChild(this.reviewNav.firstChild);
    }
    this.reviewNav.appendChild(this.reviewPane.element);

    // Loaded after construction so a slow or failing read cannot delay the editor appearing.
    this.changesLoaded = this.changesController.load();

    this.recovery = installRecovery({
      session: this.documentSession,
      store: this.journalStore,
      win: window,
      bufferId: this.journalIdFor(this.activeTabId ?? 'untitled'),
      currentPath: (): string | null => this.fileMenu.filePath,
      onError: (message: string): void => {
        this.showMessage(`Crash journal: ${message}`);
      },
    });

    this.autosave = installAutosave({
      session: this.documentSession,
      win: window,
      save: (): void => {
        // Autosave runs on a timer, so a locked document would otherwise report the same failure over
        // and over; it simply does not save until the file is unlocked.
        if (this.allowSave()) {
          this.fileMenu.save();
        } else {
          // Locked: nothing to write, and the status bar already shows the lock.
        }
      },
      // Autosave refuses to run on a document with no path, so an untitled buffer is protected by the
      // journal alone. That is the intended split: autosave writes the user's file, the journal does not.
      hasPath: (): boolean => this.fileMenu.filePath !== null,
    });

    this.externalWatch = installExternalWatch({
      session: this.documentSession,
      win: window,
      readDiskText: (path: string): Promise<string> => this.fileService.readPath(path),
      // diskText is deliberately unused: this dialog asks which side wins, it does not show a diff.
      resolveConflict: (path: string, diskText: string): Promise<ConflictResolution> =>
        this.resolveExternalConflict(path, diskText),
      onReloaded: (path: string): void => {
        const name = path.split(/[/\\]/).pop() ?? path;
        this.showMessage(`${name} was reloaded after changing on disk.`);
      },
      onError: (message: string): void => {
        this.showMessage(`Watching the file: ${message}`);
      },
    });
    // A mounted tab that already has a file is watched from the start, not only after its next save.
    this.externalWatch.setPath(this.fileMenu.filePath);

    // Installed after both bindings exist, because the anchor providers read their views.
    this.scrollSync = installScrollSync({
      session: this.documentSession,
      win: window,
      first: this.kdocPane,
      // CodeMirror scrolls its own .cm-scroller rather than the pane div, so syncing against the pane
      // would read a scrollTop that never changes.
      second: sourceScroller(this.codeMirrorBinding.view),
      anchorsFor: (element: HTMLElement): readonly BlockAnchor[] => {
        // Check which pane is being measured; the two editors lay a document out completely differently.
        if (element === this.kdocPane) {
          // K-Doc: one anchor per top-level child of the ProseMirror content DOM.
          return kdocAnchors(this.proseMirrorBinding.view, this.kdocPane);
        } else {
          // Source: one anchor per top-level block, located by its start offset in the Markdown text.
          return sourceAnchors(this.codeMirrorBinding.view, this.topLevelBlockOffsets());
        }
      },
    });

    // The document's own language (FR-12.3): its front matter, the reader's choice, a guess, or the default.
    this.documentLanguage = this.resolveLanguage(state.path);
    this.declaredLanguage = this.declaredLanguageOf();
    this.refreshLanguageStatus();
    this.spellCheck = installSpellCheck({
      view: this.proseMirrorBinding.view,
      service: this.spellService,
      win: window,
      enabled: this.settings.proofing.spellCheck,
      language: this.documentLanguage.language,
      onError: (error: Error): void => {
        this.showMessage(error.message);
      },
      onMissingDictionary: (language: string): void => {
        void this.offerDictionary(language);
      },
    });

    this.spellDialog = installSpellDialog({
      doc: document,
      spell: this.spellCheck,
      reveal: (span: WordSpan): void => {
        // The caret moves to the word under review so the pane scrolls to it: a review dialog that
        // names a word without showing where it is makes you hunt for it.
        const view = this.proseMirrorBinding.view;
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, span.from, span.to),
        );
        view.dispatch(tr.scrollIntoView());
      },
    });

    this.contextMenu = installContextMenu({
      menu: this.popupMenu,
      view: this.proseMirrorBinding.view,
      spellEntries: (): Promise<readonly PopupMenuEntry[]> =>
        buildSpellEntries({ spell: this.spellCheck, view: this.proseMirrorBinding.view }),
      pane: this.kdocPane,
      doc: document,
      openLink: (): void => {
        this.linkDialog.open(activeLink(this.proseMirrorBinding.view.state)?.attrs ?? null);
      },
      followLink: (href: string): void => {
        // Opened in a new context rather than navigated to in place: navigating this window would
        // unload the editor and take any unsaved buffer with it.
        void this.followLink(href);
      },
      editImage: (): void => {
        this.imageDialog.open(imageAt(this.proseMirrorBinding.view.state));
      },
    });

    this.slashMenu = installSlashMenu({
      menu: this.popupMenu,
      view: this.proseMirrorBinding.view,
    });

    // The right panel's surfaces only redraw when something changes, and a newly mounted document has
    // not changed yet. Without this they kept whatever they last drew -- on boot, an empty document
    // from before any existed; after a tab switch, the previous tab's. Every mount path ends here.
    this.backlinksPanel.refresh();
    this.historyPanel.refresh();
    this.metadataPanel.refresh();
    this.problemsPanel.refresh();
    this.linkDefinitionsPanel.refresh();
    // The K-Doc fold plugin drew the document's folds when it was created; Source needs them applied.
    foldSync.applyToSource();
    // A second pane left open follows the reader from document to document, so it is rebuilt here over
    // the newly mounted session rather than closing itself on every tab switch.
    if (this.secondaryOpen) {
      this.openSecondaryPane();
    } else {
      // Closed: nothing to rebuild.
    }
    // Last, because it reaches into both bindings: a read-only file's document opens unable to be typed
    // into (FR-6.7), and one that is not locked is explicitly made editable again after a switch.
    this.applyLock();
    // A document that arrived with its comments written into it (FR-6.22) is offered as an import, once.
    // In portable mode the document is meant to carry them, so there is nothing to import and the offer
    // would be asking the reader to undo the mode they turned on.
    if (hasCommentBundle(state.text) && !this.settings.general.portableComments) {
      void this.offerBundledComments(state.path);
    } else {
      // No bundle, or the mode that puts one there: nothing to offer.
    }
  }

  /**
   * @purpose Tears down the controllers belonging to the current document.
   * @inputs void.
   * @outputs void.
   * @dataflow each per-document controller -> destroy().
   * @controlflow Journal the buffer, destroy in reverse dependency order, drop the subscription.
   *
   * Deliberately mirrors mountDocument. Anything added there and forgotten here becomes a leak that
   * only surfaces after several tab switches, which is the hardest kind to attribute.
   */
  private unmountDocument(): void {
    // Flushed first: a tab switch is exactly the moment an unsaved buffer stops being on screen,
    // which is when its journal most needs to be current.
    this.recovery.flush();

    // Before the rest: it holds a binding over the session everything below is about to release.
    // secondaryOpen is left alone, so a pane the reader opened is rebuilt over the next document.
    this.closeSecondaryPane();
    this.slashMenu.destroy();
    this.contextMenu.destroy();
    this.spellDialog.destroy();
    this.spellCheck.destroy();
    this.scrollSync.destroy();
    this.externalWatch.destroy();
    this.autosave.destroy();
    this.recovery.destroy();

    // Check whether an outline pane exists; it is the one per-document controller that can be null.
    if (this.outlinePane !== null) {
      // Present: destroy it and clear the field so a later mount does not see a dead pane.
      this.outlinePane.destroy();
      this.outlinePane = null;
    } else {
      // Never installed, or already torn down.
    }

    this.commentsController.destroy();
    this.changesController.destroy();
    this.reviewPane.destroy();
    this.findPanel.destroy();
    this.fileMenu.destroy();
    // Check whether folds were set up for this document.
    if (this.foldSync !== null) {
      // Set up: stop it applying folds to the Source view about to be destroyed.
      this.foldSync.destroy();
      this.foldSync = null;
    } else {
      // Never mounted: nothing to stop.
    }
    this.codeMirrorBinding.destroy();
    this.proseMirrorBinding.destroy();

    // Check whether a session subscription is still live.
    if (this.unsubscribeSession !== null) {
      // Live: drop it, or the closed document would keep driving a status bar that now describes another one.
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    } else {
      // Already dropped.
    }
  }

  /**
   * @purpose Renders the tab set as the view models the tab strip draws (FR-6.8).
   * @inputs void.
   * @outputs An ordered list of tab views plus the active id.
   * @dataflow tabs.snapshot -> per-tab title and dirty flag -> TabView[].
   * @controlflow Read the snapshot -> derive each title from its stored path -> mark the active tab dirty
   *   from the live session, and the others from what was stored when they were last on screen.
   */
  private tabViews(): { views: readonly TabView[]; activeId: string | null } {
    const snapshot = this.tabs.snapshot;
    const views: TabView[] = [];

    for (let i = 0; i < snapshot.tabs.length; i++) {
      const record = snapshot.tabs[i];
      // Check the record is present, since noUncheckedIndexedAccess types the read as possibly undefined.
      if (record === undefined) {
        // Missing: nothing to draw for this slot.
        continue;
      } else {
        // Present: derive its view model.
      }

      // Only the active document has a live session to ask. The others carry the dirty flag they had
      // when they were last swapped out, which is accurate because nothing can edit them meanwhile.
      let dirty: boolean;
      if (record.id === snapshot.activeId) {
        // Active: ask the session, which is authoritative.
        dirty = this.documentSession.snapshot.dirty;
      } else {
        // Background: use the flag stored at swap-out time.
        dirty = record.payload.dirty === true;
      }

      views.push({ id: record.id, title: this.titleFor(record.payload), dirty });
    }

    return { views, activeId: snapshot.activeId };
  }

  /**
   * @purpose Derives the label a tab shows from the document it holds.
   * @inputs state - The stored state of one document.
   * @outputs string - The file name, or 'Untitled'.
   * @dataflow state.path -> last path segment -> title.
   * @controlflow Return 'Untitled' for a document with no path, else its last path segment.
   */
  private titleFor(state: DocumentState): string {
    // Check whether this document has ever been saved.
    if (state.path === null) {
      // Never saved: it has no name to show yet.
      return 'Untitled';
    } else {
      // Saved: show the file name rather than the whole path, which would not fit.
      return state.path.split(/[/\\]/).pop() ?? 'Untitled';
    }
  }

  /**
   * @purpose Captures the active document's state so it survives being swapped out.
   * @inputs void.
   * @outputs void.
   * @dataflow session text + savedText + dirty, fileMenu path + encoding -> tabs.replacePayload.
   * @controlflow Return early when no tab is active, else store the current text, path, saved text, dirty
   *   flag and encoding.
   *
   * The text has to be stored rather than the session itself, because the session is torn down with the
   * rest of the per-document controllers. Keeping the session alive per tab would keep its bindings,
   * watcher and autosave timers alive too, which is a background document editing files.
   */
  private captureActiveDocument(): void {
    // Check whether there is an active tab to capture into.
    if (this.activeTabId === null) {
      // No active tab: nothing to capture.
      return;
    } else {
      // Active tab present: store what the document currently is.
    }

    this.tabs.replacePayload(this.activeTabId, {
      text: this.documentSession.snapshot.text,
      path: this.fileMenu.filePath,
      dirty: this.documentSession.snapshot.dirty,
      savedText: this.documentSession.snapshot.savedText,
      encoding: this.fileMenu.encoding,
      // Keep the folds with the tab; before any mount there are none.
      folds: this.foldSync === null ? [] : this.foldSync.store.keys(),
      // Keep the lock with the tab, so coming back to a read-only file finds it still locked.
      locked: this.locked,
    });
  }

  /**
   * @purpose Switches to another open document (FR-6.8).
   * @inputs id - The tab to activate.
   * @outputs void.
   * @dataflow capture current -> unmount -> mount the target's text -> refresh chrome.
   * @controlflow Ignore a switch to the tab already active, else capture, tear down, rebuild, refresh.
   */
  private activateTab(id: string): void {
    // Which file is in front is restored along with the list (FR-6.10).
    this.restartSessionSave();
    // Check whether this tab is already the one on screen.
    if (id === this.activeTabId) {
      // Already active: rebuilding it would throw away the caret for no reason.
      return;
    } else {
      // A different tab: swap to it.
    }

    const target = this.tabs.get(id);
    // Check the target still exists; a click can arrive after a close.
    if (target === null) {
      // Gone: ignore rather than tearing down the document that is on screen.
      return;
    } else {
      // Present: proceed with the switch.
    }

    this.captureActiveDocument();
    this.unmountDocument();
    this.tabs.activate(id);
    this.activeTabId = id;
    this.mountDocument(target);
    this.setViewMode(this.currentViewMode);
    this.tabBar.refresh();
    this.refreshStatusBar();

    // Route table detection signal to contextual table tab for the activated document.
    if (this.ribbon !== undefined) {
      // Check whether the caret currently sits inside a GFM table.
      if (isInTable(this.proseMirrorBinding.view.state)) {
        this.ribbon.setContextualTableTabVisible(true);
      } else {
        this.ribbon.setContextualTableTabVisible(false);
      }
      this.ribbon.refresh();
    } else {
      // Still constructing: no ribbon to refresh yet.
    }

    // Check whether the in-app menu bar has been installed before refreshing its state.
    if (this.appMenuBar !== undefined) {
      this.appMenuBar.refresh();
    } else {
      // Still constructing: no app menu bar to refresh yet.
    }

    this.proseMirrorBinding.focus();
  }

  /**
   * @purpose Opens text read from a file in a new tab and puts it on screen (FR-6.8).
   * @inputs file - The file as read: its contents, where it was read from, and the encoding it was found in.
   * @outputs void.
   * @dataflow capture current -> tabs.open({ text, path, encoding }) -> unmount -> mount it -> refresh.
   * @controlflow Capture, open a tab, swap the editor onto it; no branching.
   *
   * Adding a tab record is not enough on its own: the editor shows whatever was last mounted, so a
   * record that is never mounted leaves the previous document on screen while the tab set says otherwise.
   */
  private openInTab(file: OpenedFile): void {
    this.captureActiveDocument();
    this.unmountDocument();
    // A read-only file opens locked (FR-6.7): edits that could never be saved are refused up front
    // rather than collected and then lost.
    const state: DocumentState = {
      text: file.contents,
      path: file.path,
      encoding: file.encoding,
      locked: file.readOnly === true,
    };
    const id = this.tabs.open(state);
    this.activeTabId = id;
    // Mounting the whole state (not just recording it in the tab) is what keeps Save writing to this file
    // in the encoding it was found in.
    this.mountDocument(state);
    this.setViewMode(this.currentViewMode);
    this.tabBar.refresh();
    this.refreshStatusBar();
    this.proseMirrorBinding.focus();
    // A newly opened file joins the list a launch puts back (FR-6.10).
    this.restartSessionSave();
  }

  /**
   * @purpose Opens a new empty document in a new tab.
   * @inputs void.
   * @outputs void.
   * @dataflow capture current -> tabs.open -> unmount -> mount empty -> refresh.
   * @controlflow Capture, open a tab, swap the editor onto it.
   */
  private newDocument(text: string = '\n'): void {
    this.captureActiveDocument();
    this.unmountDocument();

    // A single newline rather than an empty string by default: the parser needs a document to produce, and an
    // empty one gives ProseMirror nothing to put a caret in. The saved text is that empty document, so given text
    // (a comparison) starts unsaved and closing its tab asks first.
    const id = this.tabs.open({ text, path: null, savedText: '\n', dirty: text !== '\n' });
    this.activeTabId = id;
    this.mountDocument({ text, path: null, savedText: '\n' });
    this.setViewMode(this.currentViewMode);
    this.tabBar.refresh();
    this.refreshStatusBar();
    this.proseMirrorBinding.focus();
  }

  /**
   * @purpose Closes a document, prompting when it has unsaved changes (FR-6.5, FR-6.8).
   * @inputs id - The tab to close.
   * @outputs void.
   * @dataflow dirty check -> confirm -> tabs.close -> activate whatever survives.
   * @controlflow Ask before discarding unsaved work, then close and switch to the next tab, or open a
   *   fresh empty document when the last one goes.
   */
  private closeTab(id: string): void {
    // Which files are open is the main thing a launch puts back (FR-6.10). Recorded here, and in the
    // two places a tab is opened or brought to the front, rather than on a timer that polls for changes.
    this.restartSessionSave();
    void (async (): Promise<void> => {
      const isActive = id === this.activeTabId;
      const record = this.tabs.get(id);

      // Check the tab still exists.
      if (record === null) {
        // Already gone: nothing to close.
        return;
      } else {
        // Present: work out whether it has unsaved work.
      }

      // Only the active document can be asked directly; a background one carries its stored flag.
      const dirty = isActive ? this.documentSession.snapshot.dirty : record.dirty === true;

      // Check whether closing would discard unsaved work.
      if (dirty) {
        // Dirty: ask before discarding. This is the same three-way prompt the file menu uses.
        const choice = await this.confirmDialog.ask(
          `${this.titleFor(record)} has unsaved changes. Close it anyway?`,
          { heading: 'Close document?', confirm: 'Save', discard: 'Discard', cancel: 'Cancel' },
        );

        // Check what the user decided.
        if (choice === 'cancel') {
          // Cancelled: leave everything exactly as it was.
          return;
        } else if (choice === 'save') {
          // Save first. Only the active document can be saved, because saving needs its file menu.
          if (isActive) {
            // The close waits for the write: a save that failed or was cancelled (an untitled document's
            // Save As) keeps the tab open rather than discarding the work the user asked to keep.
            const saved = await this.fileMenu.save();
            // Check the save actually happened.
            if (!saved) {
              return;
            } else {
              // Written: carry on closing.
            }
          } else {
            // A background document cannot be saved without mounting it first, so say so rather than
            // silently discarding work the user asked to keep.
            this.showMessage('Switch to that document to save it before closing.');
            return;
          }
        } else {
          // Discard: fall through to the close.
        }
      } else {
        // Clean: close without asking.
      }

      // Check whether the tab being closed is the one on screen.
      if (isActive) {
        // On screen: tear it down before removing it from the set.
        this.unmountDocument();
        this.activeTabId = null;
      } else {
        // In the background: it owns no live controllers, so removing the record is the whole job.
      }

      this.tabs.close(id);
      // The document is gone from the strip, saved or discarded, so its crash journal goes with it.
      await this.clearJournal(this.journalIdFor(id));
      const nextId = this.tabs.snapshot.activeId;

      // Check whether any document survived the close.
      if (nextId === null) {
        // None left. K-Doc is a document editor, so an empty window with no document is not a state
        // worth having: open a fresh one rather than showing nothing.
        const fresh = this.tabs.open({ text: '\n', path: null });
        this.activeTabId = fresh;
        this.mountDocument({ text: '\n', path: null });
      } else if (isActive) {
        // The closed tab was on screen: mount whichever one the set chose to succeed it.
        const target = this.tabs.get(nextId);
        this.activeTabId = nextId;
        // The successor mounts with everything its tab carried, so its unsaved work and encoding survive.
        this.mountDocument(target ?? { text: '\n', path: null });
      } else {
        // A background tab closed: the document on screen is untouched.
      }

      this.setViewMode(this.currentViewMode);
      this.tabBar.refresh();
      this.refreshStatusBar();
    })();
  }

  /**
   * @purpose Moves one tab's document into a window of its own.
   * @inputs id: string - The tab that was dragged out of the strip.
   * @outputs Promise<void>.
   * @dataflow tab payload (or the live session, for the active tab) -> windowHandoff.detach -> close the tab here.
   * @controlflow Read the document -> open a window on it -> only then let go of it here.
   *
   * The order matters. The tab is closed only after a window has actually opened, because a detach that
   * failed -- no handoff available, a blocked popup -- would otherwise take the document with it. A
   * document that exists in neither window is the one outcome this gesture must never have.
   *
   * Closing goes through TabSet directly rather than through closeTab, which would ask whether to save
   * first. The document is not being discarded; it is being moved, unsaved edits and all, and a prompt
   * about losing work that is not being lost would be a question with no right answer.
   */
  private async detachTab(id: string): Promise<void> {
    // Check whether the tab being dragged out is the one on screen.
    if (id === this.activeTabId) {
      // On screen: its live text and path are in the session and the file menu, not in the stored payload.
      this.captureActiveDocument();
    } else {
      // In the background: its payload is already the current state of it.
    }

    const record = this.tabs.get(id);

    // Check whether the tab still exists.
    if (record === null) {
      // Gone between the drop and here: there is nothing to move.
      return;
    } else {
      // Present: hand its document to a new window.
    }

    // The baseline and encoding go with it; captureActiveDocument above stored both for the tab on screen.
    const opened = await this.windowHandoff.detach({
      text: record.text,
      path: record.path,
      // Only carry saved-text when present so a plain detach doesn't fabricate a baseline.
      ...(record.savedText === undefined ? {} : { savedText: record.savedText }),
      // Only carry encoding when present; absent means the file was UTF-8.
      ...(record.encoding === undefined ? {} : { encoding: record.encoding }),
    });

    // Check whether a window actually opened.
    if (!opened) {
      // It did not. Say so and keep the document exactly where it is.
      this.showMessage('Could not open a new window for that tab.');
      return;
    } else {
      // It did: the document now lives there, so this window lets go of it.
    }

    const wasActive = id === this.activeTabId;

    // Check whether the detached tab was the one on screen.
    if (wasActive) {
      // On screen: tear down its controllers before the record goes.
      this.unmountDocument();
      this.activeTabId = null;
    } else {
      // In the background: it owns no live controllers.
    }

    this.tabs.close(id);
    const nextId = this.tabs.snapshot.activeId;

    // Check whether any document is left in this window.
    if (nextId === null) {
      // None. K-Doc is a document editor, so an empty window is not a state worth having.
      const fresh = this.tabs.open({ text: '\n', path: null });
      this.activeTabId = fresh;
      this.mountDocument({ text: '\n', path: null });
    } else if (wasActive) {
      // The detached tab was on screen: mount whichever one the set chose to succeed it.
      const target = this.tabs.get(nextId);
      this.activeTabId = nextId;
      // The successor mounts with everything its tab carried, so its unsaved work and encoding survive.
      this.mountDocument(target ?? { text: '\n', path: null });
    } else {
      // A background tab left: the document on screen is untouched.
    }

    this.setViewMode(this.currentViewMode);
    this.tabBar.refresh();
    this.refreshStatusBar();
  }

  /**
   * @purpose Closes the document currently on screen.
   * @inputs void.
   * @outputs void.
   * @dataflow activeTabId -> closeTab.
   * @controlflow Delegate when a tab is active, otherwise do nothing.
   */
  private closeActiveDocument(): void {
    // Check whether anything is open to close.
    if (this.activeTabId === null) {
      // Nothing active: nothing to do.
      return;
    } else {
      // Active tab present: close it through the same path the tab strip uses.
      this.closeTab(this.activeTabId);
    }
  }

  /**
   * @purpose Switches to the previously active document (FR-6.8).
   * @inputs void.
   * @outputs void.
   * @dataflow tabs.nextInMru -> activateTab.
   * @controlflow Do nothing with fewer than two documents, else activate the previous one.
   *
   * Most-recently-used rather than positional, so repeated presses toggle between the two documents you
   * are actually working across, which is what the shortcut is for.
   */
  private nextDocument(): void {
    const next = this.tabs.nextInMru();

    // Check whether there is another document to reach.
    if (next === null) {
      // Only one document open: the shortcut has nowhere to go.
      return;
    } else {
      // A previous document exists: switch to it.
      this.activateTab(next);
    }
  }

  /**
   * @purpose Returns the underlying authoritative DocumentSession instance.
   * @inputs void.
   * @outputs DocumentSession - The active document session coordinating edits and undo history.
   * @dataflow Returns this.documentSession reference directly.
   * @controlflow Return this.documentSession property.
   */
  get session(): DocumentSession {
    return this.documentSession;
  }

  /**
   * Builds the link context used to classify links against the current document.
   * @purpose Supplies the open file path and vault notes so link classification is document-aware.
   * @inputs Nothing; reads this.fileMenu.filePath and this.vault.notes.
   * @outputs A LinkContext with documentPath (null when no file menu) and the shared notes map.
   * @dataflow this.fileMenu.filePath / this.vault.notes → constructed LinkContext object.
   * @controlflow Choose null or filePath depending on whether the file menu exists, then return.
   */
  private linkContext(): LinkContext {
    // The file menu may be absent during construction, so treat that as "no document path".
    const documentPath: string | null = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    return { documentPath, notes: this.vault.notes };
  }

  /**
   * Produces the human-readable card content for a hovered link (FR-8.13).
   * @purpose Maps each classified link kind to a title/detail/followable triple for the hover card.
   * @inputs href - The raw link string to describe.
   * @outputs A LinkCardContent describing where the link points and whether it can be followed.
   * @dataflow classifyLink(href) + outline lookup → LinkCardContent shape for the resolved kind.
   * @controlflow Switch on target.kind, return the matching shape; default returns unresolved defensively.
   */
  private describeLink(href: string): LinkCardContent {
    // Classify the href once and let each branch read only what it needs from the result.
    const target = classifyLink(href, this.linkContext());
    switch (target.kind) {
      case 'heading': {
        // A heading link resolves against the current document's outline; a missing entry means no match.
        const entry = findHeadingBySlug(buildOutline(this.documentSession.snapshot.document), target.slug);
        return { title: entry === null ? 'No heading with this name' : entry.text, detail: '#' + target.slug, followable: entry !== null };
      }
      case 'note': {
        // A note link points at another file; append the slug only when one is present.
        return { title: target.label, detail: target.slug === null ? target.path : target.path + '#' + target.slug, followable: true };
      }
      case 'web': {
        // A web link shows its domain and full URL so the user can see where it leads.
        return { title: target.domain, detail: target.url, followable: true };
      }
      case 'mail': {
        // A mail link is presented as a send-email action rather than a raw address string.
        return { title: target.address, detail: 'Send an email', followable: true };
      }
      case 'unresolved': {
        // An unresolved link reports why it could not be classified and cannot be followed.
        return { title: target.reason, detail: target.target, followable: false };
      }
      case 'blocked': {
        // A blocked scheme is reported with its reason string; the card never shows this for a normal link.
        return { title: 'Links starting "' + target.scheme + ':" are not opened', detail: target.target, followable: false };
      }
      default: {
        // Unreachable today because classifyLink exhausts every kind, but kept so a new kind cannot slip through silently.
        return { title: 'Unrecognised link', detail: href, followable: false };
      }
    }
  }

  /**
   * @purpose Wires up Quick Open, Go To and the breadcrumb navigation bar to the editor bindings.
   * @inputs None; reads class state (documentSession, vault, recentFiles, tabs, promptDialog) through closures passed to createNavigationController.
   * @outputs Installs three UI components plus a NavigationController stored in `this.navigation`.
   * @dataflow Class state → closure callbacks → picker/dialog/breadcrumb components and the navigation controller.
   * @controlflow Build the three components → insert the breadcrumb bar above the panes → assign fields → create the controller → refresh breadcrumbs; runs once, from the constructor.
   */
  private installNavigation(): void {
    // Quick Open searches vault notes and recent files (capped at 50 results).
    const quickOpen = installPickerDialog({ doc: document, ariaLabel: 'Quick Open', placeholder: 'Type a file name…', emptyText: 'No matching files', limit: 50 });

    // Go To searches the document outline headings (capped at 100 results).
    const goTo = installPickerDialog({ doc: document, ariaLabel: 'Go to heading', placeholder: 'Type a heading…', emptyText: 'No matching headings', limit: 100 });

    // Breadcrumb bar shows the current path; revealing an entry scrolls to its start offset.
    const breadcrumbs = installBreadcrumbBar({ doc: document, onReveal: (entry: { readonly start: number }): void => { this.navHistory.recordJump(); this.revealOffset(entry.start); } });

    // The breadcrumb path leads the status bar rather than taking a row of its own above the panes.
    this.statusBarElement.insertBefore(breadcrumbs.element, this.statusBarElement.firstChild);

    // Store the components so destroy() can tear them down in a defined order.
    this.quickOpenDialog = quickOpen;
    this.goToDialog = goTo;
    this.breadcrumbBar = breadcrumbs;

    // Create the controller that bridges keyboard shortcuts and component state to the editor bindings.
    this.navigation = createNavigationController({
      session: (): DocumentSession => this.documentSession,
      win: window,
      quickOpen,
      goTo,
      breadcrumbs,
      notes: (): readonly { path: string; relative: string; title: string }[] => this.vault.notes,
      recentPaths: (): readonly string[] => this.recentFiles.files.map((file: { path: string }): string => file.path),
      openPaths: (): readonly string[] => this.tabs.snapshot.tabs.map((tab: { id: string; payload: { path: string | null } }): string | null => tab.payload.path).filter((path): path is string => path !== null),
      currentPath: (): string | null => {
        // Return the active tab's path, or null when there is no active tab.
        const active = this.tabs.snapshot.tabs.find((tab: { id: string; payload: { path: string | null } }): boolean => tab.id === this.tabs.snapshot.activeId);
        return active?.payload.path ?? null;
      },
      // Quick Open and Go To are jumps (FR-9.10): each records where the caret was first.
      openPath: (path: string): void => { this.navHistory.recordJump(); this.openOrActivatePath(path); },
      // Source is focused when in pure Source mode, or in Split with the source pane focused.
      sourceFocused: (): boolean => this.currentViewMode === 'source' || (this.currentViewMode === 'split' && this.documentSession.snapshot.focusedPane === 'source'),
      askLine: (lineCount: number): Promise<string | null> => this.promptDialog.ask('Go to line', `Line number (1–${lineCount}), or line:column`, ''),
      caretOffset: (): number => this.navigationCaretOffset(),
      revealSourceOffset: (offset: number): void => { this.navHistory.recordJump(); this.revealSourceOffset(offset); },
      revealOffset: (offset: number): void => { this.navHistory.recordJump(); this.revealOffset(offset); },
      showMessage: (message: string): void => { this.showMessage(message); },
    });

    // Populate the breadcrumb bar with the current document path.
    this.navigation.refreshBreadcrumbs();
  }

  /**
   * @purpose Returns the current text of a vault note: its live session text when it is the active tab, otherwise the
   *   text recorded in any other open tab, or null when the note is not open anywhere.
   * @inputs path - The absolute path of the note whose text should be returned.
   * @outputs string | null - The note's text if open in the active session or a background tab; null otherwise.
   * @dataflow fileMenu.filePath and tabs records -> samePath comparison against target path -> session or tab text.
   * @controlflow Check the active tab first (session wins) -> fall back to a non-active open tab -> return null when none.
   */
  private openNoteText(path: string): string | null {
    // The active tab's document lives in the session, which is ahead of its tab record until the next switch captures it.
    const activePath = this.fileMenu.filePath;

    // If the note is the one on screen, the session holds the freshest text (ahead of the tab record).
    if (activePath !== null && samePath(activePath, path)) {
      // Active note: return the session's live text.
      return this.documentSession.snapshot.text;
    } else {
      // Not the active note: fall through to check any other open tab below.
    }

    const open = this.tabs.snapshot.tabs.find((tab) => tab.id !== this.activeTabId && tab.payload.path !== null && samePath(tab.payload.path, path));

    // A background tab holds the note's text as recorded before the next switch captures it.
    if (open !== undefined) {
      // Found in a non-active open tab: return its recorded text.
      return open.payload.text;
    } else {
      // Not open anywhere: report that no text is available for this note.
      return null;
    }
  }

  /**
   * @purpose Writes replacement text into wherever a note currently lives: as an external edit on the active tab, or by
   *   rewriting the recorded text of a background tab; throws when the note is no longer open.
   * @inputs path - The absolute path of the note to rewrite. text - The new contents for that note.
   * @outputs void.
   * @dataflow fileMenu.filePath and tabs records -> session.applyExternalText or tabs.replacePayload -> tabBar.refresh.
   * @controlflow Check the active tab (external edit, early return) -> find a background tab -> throw if closed -> rewrite
   *   its text with a saved baseline derived from savedText ?? text -> refresh the bar.
   */
  private writeOpenNote(path: string, text: string): void {
    const activePath = this.fileMenu.filePath;

    // If the note is on screen, edit it in place so both panes update and one undo reverts it.
    if (activePath !== null && samePath(activePath, path)) {
      // The note on screen: applied as an external edit, so both panes update and one Ctrl+Z takes it back.
      this.documentSession.applyExternalText(text);
      return;
    } else {
      // Not the active note: look for it in a background tab below.
    }

    const open = this.tabs.snapshot.tabs.find((tab) => tab.id !== this.activeTabId && tab.payload.path !== null && samePath(tab.payload.path, path));

    // A closed tab between read and write must fail loudly rather than discard the edit into nothing.
    if (open === undefined) {
      // The tab closed between the read and the write; failing beats writing to nothing.
      throw new Error(`${path} is no longer open`);
    } else {
      // A background tab holds the note: rewrite its recorded text below.
    }

    // A tab record without a saved baseline takes its current text as saved, so the pre-edit text becomes the baseline
    // and the replace shows as an unsaved change rather than silently becoming the saved state.
    const savedText = open.payload.savedText ?? open.payload.text;
    this.tabs.replacePayload(open.id, { ...open.payload, text, savedText, dirty: text !== savedText });
    this.tabBar.refresh();
  }

  /**
   * @purpose Navigates to and reveals a search match: moves the caret when the note is already active, switches to it when
   *   open in another tab, or opens it from the vault otherwise, then revealing only if that note actually came up.
   * @inputs path - The absolute path of the note holding the match. match - The FileMatch whose start offset to reveal.
   * @outputs Promise<void> - Resolves once navigation and any caret reveal are complete.
   * @dataflow fileMenu.filePath and tabs records -> revealOffset, activateTab, or openNoteFromVault -> revealOffset on success.
   * @controlflow Check the active tab (reveal only) -> switch to an open background tab or open from vault -> confirm the
   *   expected note is now shown before revealing its match offset.
   */
  private async openSearchMatch(path: string, match: FileMatch): Promise<void> {
    this.navHistory.recordJump();
    const activePath = this.fileMenu.filePath;

    // If the note is already on screen, only the caret needs to move.
    if (activePath !== null && samePath(activePath, path)) {
      // Already on screen: reveal the match without opening or switching notes.
      this.revealOffset(match.start);
      return;
    } else {
      // Another note: open or switch to it below.
    }

    const open = this.tabs.snapshot.tabs.find((tab) => tab.payload.path !== null && samePath(tab.payload.path, path));

    // If the note is already open in a background tab, switching preserves its unsaved text (the text the match was found in).
    if (open !== undefined) {
      // Open in a background tab: switch to it without reloading.
      this.activateTab(open.id);
    } else {
      // Not open at all: load it from the vault, which may fail if it moved or was deleted.
      await this.openNoteFromVault(path);
    }

    // Opening can fail (the note was moved or deleted), and openNoteFromVault has already reported that; reveal only in the
    // note that actually came up rather than a different one.
    const shown = this.activeTabId === null ? null : this.tabs.get(this.activeTabId);

    if (shown !== null && shown.path !== null && samePath(shown.path, path)) {
      // The expected note is now active: move its caret to the match.
      this.revealOffset(match.start);
    } else {
      // The note did not open (or a different one did): leave the view as-is; the failure was already surfaced.
    }
  }

  /**
   * Reads the vault's folders as relative paths so empty folders still render in the tree.
   *
   * @purpose Loads `<root>`'s folder list from the host and applies it only if this load is still current, refreshing the panel when it changes.
   * @inputs None.
   * @outputs void - No return; mutates vaultFolders and refreshes the files panel on success or when no vault is open.
   * @dataflow status.root → VaultFiles.listFolders → folder list assignment → filesPanel.refresh(); failure → showMessage.
   * @controlflow Gate on an open, available vault → read folders → apply if current; otherwise clear and refresh; show message on any failure.
   */
  private async loadVaultFolders(): Promise<void> {
    // The folder list is keyed by the open vault root, so read it from the live status each time.
    const root = this.vault.status.root;
    if (root === null || !this.vaultFiles.available) {
      // Branch: No vault open or the host cannot touch disk; clear any stale folders and refresh so the tree shows nothing.
      this.vaultFolders = [];
      this.filesPanel.refresh();
      return;
    } else {
      // Branch: A vault is open on the desktop host; proceed to read its folder list from disk.
    }
    try {
      const folders = await this.vaultFiles.listFolders(root);
      // The root may have changed while the async list was in flight; only apply the result if it still matches.
      if (this.vault.status.root === root) {
        // Branch: This load is still current; store the folders and refresh the panel to show them.
        this.vaultFolders = folders;
        this.filesPanel.refresh();
      } else {
        // Branch: A newer vault open superseded this load; discard the result without touching the panel.
      }
    } catch (caught: unknown) {
      // Any failure to read the folder list surfaces through showMessage rather than being swallowed.
      this.showMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /**
   * Rescans the vault and then reloads its folder list so tree operations are reflected immediately.
   *
   * @purpose Combines the incremental rescan (FR-6.12) with a fresh folder list so created or moved folders appear.
   * @inputs None.
   * @outputs void - No return; refreshes both the note tree and the folder-derived empty-folder set.
   * @dataflow vault.refresh → loadVaultFolders → updated notes + folders → panel re-render.
   * @controlflow Rescan first, then reload folders in sequence so the two stay consistent.
   */
  private async refreshVaultTree(): Promise<void> {
    const root = this.vault.status.root;
    // Opening the same folder again plans the scan from the saved index (FR-6.12), so only notes whose size or
    // time changed are read; refresh() would re-read every note after every rename. The folder list follows.
    if (root !== null) { await this.vault.open(root); } else { /* no vault: nothing to rescan */ }
    await this.loadVaultFolders();
  }

  /**
   * Presents the template picker and resolves the chosen template, or null when dismissed.
   *
   * @purpose Bridges the callback-based PickerDialog to a promise so newFromTemplate can await the user's choice.
   * @inputs templates - The available vault templates to offer in the picker.
   * @outputs Promise<VaultTemplate | null> - The selected template, or null if the picker was dismissed.
   * @dataflow templates → picker.open with mapped entries → onPick resolves the matching template from the id.
   * @controlflow Build a promise that resolves once the picker fires its single pick callback; never rejects.
   */
  private async pickTemplate(templates: readonly VaultTemplate[]): Promise<VaultTemplate | null> {
    return new Promise((resolve): void => {
      // The picker has no cancel callback, so a dismissed picker leaves this promise pending; nothing waits on it but the one command that asked.
      this.templatePicker.open(templates.map((template) => ({ id: template.path, label: template.name, detail: '' })), (item): void => {
        resolve(templates.find((template) => template.path === item.id) ?? null);
      });
    });
  }

  /**
   * @purpose Tells every other K-Doc window that a file moved, so their tabs follow it too.
   * @inputs from - The path before the move; to - the path after it.
   * @outputs void.
   * @dataflow (from, to, this window's id) -> 'kdoc://path-moved' event to every window.
   * @controlflow Outside the desktop host there are no other windows, so nothing is sent; a failed send is reported.
   */
  private announceMove(from: string, to: string): void {
    // Only the desktop host has other windows to tell.
    if ('__TAURI_INTERNALS__' in window) {
      emit('kdoc://path-moved', { from, to, origin: this.journalPrefix }).catch((error: unknown): void => {
        this.showMessage(`Could not tell other windows about the move: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      // Browser build: a single window.
    }
  }

  /**
   * Follows a disk move across every open tab so each tracks its note's new path.
   *
   * @purpose Remaps active and background tabs when the vault file tree moved a node, updating the menu for the open tab and payloads otherwise.
   * @inputs from - The absolute path the node occupied before the move.
   * @inputs to - The absolute path the node occupies after the move.
   * @outputs void - No return; mutates active menu path or tab payloads and refreshes the tab bar.
   * @dataflow vaultSearch.forget → per-tab remapPath → followPath (active) or replacePayload (background) → tabBar.refresh.
   * @controlflow Forget search, then for each saved tab under the moved path update it; ignore unsaved tabs and unrelated notes.
   */
  private followMovedPath(from: string, to: string): void {
    // Search remembers note text by path; a moved note is a different key now.
    this.vaultSearch.forget();
    for (const tab of this.tabs.snapshot.tabs) {
      const isActive = tab.id === this.activeTabId;
      const current = isActive ? this.fileMenu.filePath : tab.payload.path;
      if (current === null) {
        // Branch: An unsaved or untitled tab has no path to remap; skip it unchanged.
        continue;
      } else {
        // Branch: A saved document; its path is eligible for remapping below.
      }
      const next = remapPath(current, from, to);
      if (next === null) {
        // Branch: The note is not under the moved path; nothing follows it.
        continue;
      } else {
        // Branch: The note sits under the moved path; its new path is computed above.
      }
      if (isActive) {
        // Branch: This is the open document; point the menu at the new path so saves go there.
        this.fileMenu.followPath(next);
      } else {
        // Branch: A background tab; its record is the whole of its state.
      }
      // Every tab's record takes the new path too: the tab strip names even the active tab from its record.
      this.tabs.replacePayload(tab.id, { ...tab.payload, path: next });
    }
    this.tabBar.refresh();
  }

  /**
   * Closes tabs whose notes or containing folders were moved to the Recycle Bin.
   *
   * @purpose Detects trashed files and folders across open tabs and closes them, asking about unsaved changes as a manual close would.
   * @inputs paths - Absolute paths of the notes or folders sent to the Recycle Bin.
   * @outputs void - No return; mutates open tabs by closing those affected.
   * @dataflow vaultSearch.forget → per-tab remapPath against each trash path → doomed ids → closeTab(id) for each.
   * @controlflow Forget search, collect doomed tab ids, then close them in sequence via the normal close path.
   */
  private closeTrashedTabs(paths: readonly string[]): void {
    this.vaultSearch.forget();
    const doomed: string[] = [];
    for (const tab of this.tabs.snapshot.tabs) {
      const current = tab.id === this.activeTabId ? this.fileMenu.filePath : tab.payload.path;
      // A tab is closed when its file, or a folder holding it, went to the Recycle Bin.
      if (current !== null && paths.some((path) => remapPath(current, path, path) !== null)) {
        // Branch: The tab's file (or a folder holding it) was trashed; mark this tab for closing.
        doomed.push(tab.id);
      } else {
        // Branch: The tab is untouched by the trash; leave it open.
      }
    }
    // closeTab asks first about unsaved changes, exactly as closing the tab by hand does.
    for (const id of doomed) { this.closeTab(id); }
  }

  /**
   * @purpose Keeps the vault index in step with saves (FR-6.12) so a note's headings, links and tags reflect the text just written.
   * @inputs text - The document text that was just saved.
   * @outputs void.
   * @dataflow vault root + saved path + indexed paths -> planVaultSaveSync -> vault.update for a held note, or refreshVaultTree for a new one.
   * @controlflow Plan the sync -> do nothing, re-index the held note and forget its remembered search text, or rescan.
   */
  private syncVaultAfterSave(text: string): void {
    // Classify the save as a non-note, an update to an existing held note, or a new vault note.
    const plan = planVaultSaveSync(this.vault.status.root, this.fileMenu.filePath, this.vault.notes.map((note) => note.path));

    if (plan.kind === 'none') {
      // The saved file is not a vault note: leave the index alone.
      return;
    } else if (plan.kind === 'update') {
      // A note the index already holds: re-index it from the text just written, under the index's own spelling of its path.
      this.vault.update(plan.path, text);
      // Vault search remembers this note's disk text, which the save just replaced.
      this.vaultSearch.forget(plan.path);
    } else {
      // A new note in the vault (Save As into it): only a rescan can add it, and the rescan reads just what changed.
      this.refreshVaultTree().catch((caught: unknown): void => {
        this.showMessage(caught instanceof Error ? caught.message : String(caught));
      });
    }
  }

  /**
   * @purpose Opens a note in a new tab if it is not already open, otherwise switches to the existing tab.
   * @inputs path - Absolute or vault-relative path of the note to activate.
   * @outputs Toggles the active tab or opens a new one; no return value.
   * @dataflow Path string → tab lookup → activate(id) or openNoteFromVault(path).
   * @controlflow Find a matching open tab; if found, switch to it and return; otherwise open in a new tab.
   */
  private openOrActivatePath(path: string): void {
    // openNoteFromVault switches to a tab already showing the note, so this only starts the open.
    void this.openNoteFromVault(path);
  }

  /**
   * @purpose Loads the remembered folded section keys for a document path from local storage (FR-8.29).
   * @inputs path - The document's file path, or null when it has never been saved.
   * @outputs readonly string[] - The restored fold keys; empty when there are none to restore.
   * @dataflow window.localStorage → loadFolds() → returned key array (or reset on failure).
   * @controlflow Return [] immediately for an unsaved path; otherwise attempt the read and, on error, reset storage and report before returning [].
   */
  /**
   * @purpose Reads a document's own reading width and density from local storage (FR-5.10, FR-14.13).
   * @inputs path - The document's file path, or null when it has never been saved.
   * @outputs DisplayOverride - The stored override; empty when there is none.
   * @dataflow window.localStorage → loadDisplayOverride() → the override (or {} when it cannot be read).
   * @controlflow An unsaved document has no override; a storage that throws is reported and treated as having none.
   */
  /**
   * @purpose Applies the document's locked state to both panes and the status bar (FR-6.7).
   * @inputs void; reads this.locked.
   * @outputs void.
   * @dataflow this.locked -> both bindings' setEditable -> the panes; -> statusLock.hidden -> the status bar.
   * @controlflow Both panes follow the lock; a second pane holding its own document follows that file's read-only flag.
   */
  /**
   * @purpose Refuses a save while the document is locked, reporting why (FR-6.7).
   * @inputs void; reads this.locked.
   * @outputs boolean - True when the save may go ahead.
   * @dataflow this.locked -> the message -> the caller's decision.
   * @controlflow Report and refuse when locked; otherwise allow.
   */
  private allowSave(): boolean {
    // Check whether the document is locked, in which case the file underneath cannot take the write.
    if (this.locked) {
      this.showMessage('This file is read-only. Unlock it before saving.');
      return false;
    } else {
      // Not locked: the save goes ahead.
      return true;
    }
  }

  /**
   * @purpose Opens a second editable view of the mounted document, or rebuilds it after a tab switch (FR-6.9).
   * @inputs void; acts on the mounted session.
   * @outputs void.
   * @dataflow A new ProseMirrorBinding over this.documentSession -> the secondary pane; a divider between
   *   it and the K-Doc pane.
   * @controlflow Destroy any previous binding first, so a rebuild cannot leave one attached to the old
   *   session; then build the binding, show the pane and its divider, and apply the document's lock.
   */
  private openSecondaryPane(): void {
    // A rebuild after a tab switch arrives here with the previous document's binding still attached.
    if (this.secondaryBinding !== null) {
      this.closeSecondaryPane();
    } else {
      // Nothing attached: this is a fresh open.
    }

    this.secondaryOpen = true;
    // The pane shows its own document when one was opened beside, and otherwise another view of the open
    // one. Both are ordinary sessions, so the binding does not need to know which it was given.
    const session = this.secondaryDocument === null ? this.documentSession : this.secondaryDocument.session;
    // Deliberately plainer than the main pane: it is a view, not a second set of the pane's features. The
    // toolbars, find, comments and spelling stay attached to the pane they were mounted over.
    this.secondaryBinding = new ProseMirrorBinding({
      session,
      hostOwnsShortcuts: true,
      inputRulesEnabled: (): boolean => this.settings.editor.inputRules,
      loadImage: (src: string): Promise<string | null> => this.loadImageSource(src),
      mount: this.secondaryPane,
      onError: (error: Error): void => {
        this.showMessage(`Second pane: ${error.message}`);
      },
    });

    this.secondaryHeader = installSecondPaneHeader({
      doc: document,
      mount: this.secondaryPane,
      onSave: (): void => {
        void this.saveSecondDocument();
      },
      onClose: (): void => {
        this.secondaryOpen = false;
        this.secondaryDocument = null;
        this.closeSecondaryPane();
      },
    });
    // The strip has to follow what the pane holds, and a document is edited without the shell being told,
    // so it is redrawn on every change to that session rather than only when the pane is opened.
    this.secondaryWatch = session.subscribe((): void => {
      this.refreshSecondPaneHeader();
    });
    this.refreshSecondPaneHeader();

    this.secondaryPane.hidden = false;
    this.secondaryDividerElement.hidden = false;
    this.secondaryDivider = installSplitDivider({
      element: this.secondaryDividerElement,
      doc: document,
      first: this.kdocPane,
      second: this.secondaryPane,
      container: this.panesElement,
      orientation: this.settings.editor.splitOrientation,
    });
    this.applyLock();
  }

  /**
   * @purpose Closes the second view and releases what it held (FR-6.9).
   * @inputs void.
   * @outputs void.
   * @dataflow The binding and the divider -> destroyed; the pane and the divider -> hidden.
   * @controlflow Destroy each part only if it exists, so closing an already-closed pane is harmless.
   */
  private closeSecondaryPane(): void {
    // Check whether the strip is being watched, which it is only while the pane is open.
    if (this.secondaryWatch !== null) {
      this.secondaryWatch();
      this.secondaryWatch = null;
    } else {
      // Nothing subscribed.
    }

    // Check whether a strip was built; a rebuild calls this before there is one on the first open.
    if (this.secondaryHeader !== null) {
      this.secondaryHeader.destroy();
      this.secondaryHeader = null;
    } else {
      // No strip to remove.
    }

    // Check whether a divider was installed, which it is only while the pane is open.
    if (this.secondaryDivider !== null) {
      this.secondaryDivider.destroy();
      this.secondaryDivider = null;
    } else {
      // No divider to release.
    }

    // Check whether a binding exists; a rebuild calls this before there is one on the first open.
    if (this.secondaryBinding !== null) {
      this.secondaryBinding.destroy();
      this.secondaryBinding = null;
    } else {
      // No binding to release.
    }

    this.secondaryPane.hidden = true;
    this.secondaryDividerElement.hidden = true;
  }

  /**
   * @purpose Opens or closes the second view of the document (FR-6.9).
   * @inputs void.
   * @outputs void.
   * @dataflow this.secondaryOpen -> open or close -> the reported state.
   * @controlflow Close when open, open when closed; closing also clears the flag so a tab switch does
   *   not bring it back.
   */
  private toggleSecondaryPane(): void {
    // Check whether the second pane is already showing.
    if (this.secondaryOpen) {
      this.secondaryOpen = false;
      this.secondaryDocument = null;
      this.closeSecondaryPane();
      this.showMessage('Second pane closed.');
    } else {
      this.openSecondaryPane();
      this.showMessage('Second pane opened on the same document.');
    }
  }

  /**
   * @purpose Redraws the strip above the second pane so it says what the pane now holds (FR-6.9).
   * @inputs void; reads this.secondaryDocument and this.secondaryHeader.
   * @outputs void.
   * @dataflow this.secondaryDocument -> a name, a dirty flag and a read-only flag -> the strip.
   * @controlflow Does nothing without a strip; a pane holding no document of its own reports a null name,
   *   which is what tells the strip to say it is another view rather than name a file.
   */
  private refreshSecondPaneHeader(): void {
    // Check whether there is a strip to redraw. There is none while the pane is closed.
    if (this.secondaryHeader === null) {
      return;
    } else {
      // There is: say what the pane holds.
    }

    const own = this.secondaryDocument;
    // Check whether the pane holds a document of its own.
    if (own === null) {
      this.secondaryHeader.setState({ name: null, dirty: false, readOnly: false });
    } else {
      this.secondaryHeader.setState({ name: own.name, dirty: own.dirty(), readOnly: own.readOnly });
    }
  }

  /**
   * @purpose Opens another document beside the one being edited (FR-6.9).
   * @inputs void; asks the host for a file.
   * @outputs A promise that settles once the pane holds it, or once the reader has cancelled.
   * @dataflow The host's open dialog -> an OpenedFile -> a SecondDocument of its own -> the second pane.
   * @controlflow Cancelling leaves everything as it was. A file that will not read is reported and leaves
   *   the pane as it was too, rather than closing it and losing what was already there.
   */
  private async openDocumentBeside(): Promise<void> {
    // Check whether the host can open files at all. In a browser there is nothing to ask.
    if (!this.fileService.available) {
      this.showMessage('Opening a document beside this one needs the desktop app.');
      return;
    } else {
      // It can: ask for a file.
    }

    try {
      const file = await this.fileService.openFile();
      // Check whether the reader picked anything. Cancelling is not a failure and says nothing.
      if (file === null) {
        return;
      } else {
        // They did: give the second pane its own document over it.
      }

      this.secondaryDocument = secondDocumentOf(file);
      this.secondaryOpen = true;
      this.openSecondaryPane();
      this.showMessage(`${this.secondaryDocument.name} opened beside this document.`);
    } catch (caught) {
      this.showMessage(`Could not open that document: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  /**
   * @purpose Writes the second pane's own document back to its file (FR-6.9).
   * @inputs void; reads this.secondaryDocument.
   * @outputs A promise that settles once it is written, or at once when there is nothing to write.
   * @dataflow this.secondaryDocument.target() -> fileService.saveFile -> markSaved -> the strip.
   * @controlflow A pane with no document of its own, a read-only file and a document with no edits all
   *   have nothing to write, which target() answers with null in one place rather than three checks here.
   */
  private async saveSecondDocument(): Promise<void> {
    const own = this.secondaryDocument;
    // Check whether the pane holds a document of its own to save.
    if (own === null) {
      return;
    } else {
      // It does: write it if there is anything to write.
    }

    const target = own.target();
    // Check whether there is anything to write.
    if (target === null) {
      return;
    } else {
      // There is: write it.
    }

    try {
      await this.fileService.saveFile(target);
      own.markSaved();
      this.refreshSecondPaneHeader();
      this.showMessage(`${own.name} saved.`);
    } catch (caught) {
      this.showMessage(`Could not save ${own.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  private applyLock(): void {
    this.proseMirrorBinding.setEditable(!this.locked);
    this.codeMirrorBinding.setEditable(!this.locked);
    // Check whether the second pane holds a document of its own. The open document's lock is about the
    // open document, so applying it to another file would refuse writes to a file nothing has locked.
    if (this.secondaryDocument === null) {
      // Another view of the open document: it takes the same lock.
      this.secondaryBinding?.setEditable(!this.locked);
    } else {
      // Its own document: only the file's own read-only flag decides whether it can be edited.
      this.secondaryBinding?.setEditable(!this.secondaryDocument.readOnly);
    }
    this.statusLock.hidden = !this.locked;
  }

  /**
   * @purpose Lays the panes out as editor.splitOrientation says: side by side (Vertical) or stacked (Horizontal).
   * @inputs void; reads this.settings.editor.splitOrientation.
   * @outputs void.
   * @dataflow The setting -> the panes container's stacked class -> both dividers' orientation.
   * @controlflow The main divider is guarded because applySettings can run before the constructor installs it; the
   *   second pane's divider exists only while that pane is open.
   */
  private applySplitOrientation(): void {
    const orientation = this.settings.editor.splitOrientation;
    // The whole row stacks, so a second document beside the first stacks with it.
    this.panesElement.classList.toggle('kdoc-panes-stacked', orientation === 'horizontal');
    const main = this.splitDivider as SplitDivider | undefined;
    // Installed: turn it to match. Not yet: it is installed with the current setting.
    if (main !== undefined) {
      main.setOrientation(orientation);
    } else {
      // Constructor still running; installSplitDivider reads the setting itself.
    }
    this.secondaryDivider?.setOrientation(orientation);
  }

  /**
   * @purpose Opens the user guide installed with K-Doc (Help > User Guide).
   * @inputs void.
   * @outputs Promise<void> - Resolves once the guide is on screen or the failure has been reported.
   * @dataflow user_guide_path (which also grants the guide's folder) -> openNoteFromVault -> a tab; the host reports
   *   every guide page read-only, so the tab opens locked and the installed copy is never edited by accident.
   * @controlflow The browser build has no installed copy, so it opens the published guide instead; a failure is
   *   reported, never thrown.
   */
  private async openUserGuide(): Promise<void> {
    // Only the desktop app installs the guide; the browser build points at the published copy.
    if (!hasInstalledGuide()) {
      await this.externalOpener.open(ONLINE_GUIDE_URL).catch((error: unknown): void => {
        this.showMessage(`Could not open the user guide. ${error instanceof Error ? error.message : String(error)}`, true);
      });
      return;
    } else {
      // Desktop app: open the copy installed with this version.
    }
    try {
      const path = await installedGuidePath();
      await this.openNoteFromVault(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not open the user guide. ${message}`, true);
    }
  }

  /**
   * @purpose Offers to clear a read-only file's lock and, on agreement, unlocks the document (FR-6.7).
   * @inputs void; acts on the active document.
   * @outputs Promise<void> - Resolves once the answer has been acted on.
   * @dataflow The confirmation -> fileService.setReadOnly(path, false) -> this.locked -> applyLock.
   * @controlflow Report and stop when the document is not locked, has no path, or the host cannot change
   *   attributes; otherwise ask, and unlock only if the file was really made writable.
   */
  private async unlockDocument(): Promise<void> {
    // Check whether there is anything to unlock, so the command says something useful when there is not.
    if (!this.locked) {
      this.showMessage('This document is not locked.');
      return;
    } else {
      // Locked: work out whether the file behind it can be unlocked.
    }

    const path = this.fileMenu.filePath;
    // A document with no file has no attribute to clear; it should never be locked, but saying so beats
    // silently doing nothing.
    if (path === null) {
      this.showMessage('This document has no file to unlock.');
      return;
    } else {
      // A real file: check the host can change it.
    }

    const setReadOnly = this.fileService.setReadOnly?.bind(this.fileService);
    // The browser build has no filesystem, so there is nothing it could clear.
    if (setReadOnly === undefined) {
      this.showMessage('Unlocking a file requires the desktop app.');
      return;
    } else {
      // The host can change attributes: ask before changing someone's file.
    }

    const choice = await this.confirmDialog.ask(
      `${this.fileMenu.fileName} is read-only. Unlocking clears that on disk so the file can be saved.`,
      { heading: 'Unlock this file?', confirm: 'Unlock', discard: null, cancel: 'Cancel' },
    );
    const agreed = choice === 'save';
    // Check whether the change was agreed to; changing a file's attributes is never done unasked.
    if (!agreed) {
      // Declined: the document stays locked and the file is untouched.
      return;
    } else {
      // Agreed: clear the attribute before unlocking, so the editor is never unlocked over a file that
      // still cannot take a save.
    }

    try {
      await setReadOnly(path, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`The file could not be unlocked. ${message}`);
      return;
    }

    this.locked = false;
    this.applyLock();
    this.showMessage('Unlocked. This file can now be saved.');
  }

  /**
   * @purpose Works out the language the mounted document is written in (FR-12.3).
   * @inputs path - The document's path, or null when it has never been saved.
   * @outputs DocumentLanguage - The language and where it came from.
   * @dataflow front matter + remembered choice + text + Settings -> resolveDocumentLanguage.
   * @controlflow A choice is read from storage for a saved file and from memory for an unsaved one; a choice that
   *   cannot be read counts as none, and the reader is told.
   */
  private resolveLanguage(path: string | null): DocumentLanguage {
    let chosen: string | null = null;
    // Check where a choice for this document would be kept.
    if (path === null) {
      chosen = this.activeTabId === null ? null : (this.unsavedLanguageChoices.get(this.activeTabId) ?? null);
    } else {
      try {
        chosen = loadLanguageChoice(window.localStorage, path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.showMessage(`This document's spelling language could not be read. ${message}`);
      }
    }
    const snapshot = this.documentSession.snapshot;
    return resolveDocumentLanguage({
      frontMatter: snapshot.document.frontMatter?.data ?? null,
      chosen,
      detect: this.settings.proofing.detectLanguage,
      text: snapshot.text,
      defaultLanguage: this.settings.proofing.language,
    });
  }

  /**
   * @purpose Reads the language the front matter names, if any (FR-12.3).
   * @inputs void; reads the mounted document.
   * @outputs string | null - The normalised tag from lang: (or language:), or null.
   * @dataflow front matter data -> normaliseLanguageTag.
   * @controlflow No branches.
   */
  private declaredLanguageOf(): string | null {
    const data = this.documentSession.snapshot.document.frontMatter?.data ?? null;
    return normaliseLanguageTag(data?.['lang'] ?? data?.['language']);
  }

  /**
   * @purpose Re-decides the mounted document's language and switches spelling to it (FR-12.3).
   * @inputs void.
   * @outputs void.
   * @dataflow resolveLanguage -> documentLanguage -> status bar + spellCheck.setLanguage.
   * @controlflow Runs after a settings change, a choice from the picker, or an edit to the front matter's lang:.
   */
  private refreshDocumentLanguage(): void {
    const path = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    this.documentLanguage = this.resolveLanguage(path);
    this.declaredLanguage = this.declaredLanguageOf();
    this.refreshLanguageStatus();
    this.spellCheck.setLanguage(this.documentLanguage.language);
  }

  /**
   * @purpose Notices an edit that changes the language the front matter names (FR-12.3).
   * @inputs void.
   * @outputs void.
   * @dataflow front matter -> declaredLanguageOf -> compare with declaredLanguage.
   * @controlflow Only a change of the named language re-decides; ordinary typing does not re-run detection.
   */
  private noticeDeclaredLanguage(): void {
    // Check whether the front matter now names a different language from before.
    if (this.declaredLanguageOf() === this.declaredLanguage) {
      return;
    } else {
      this.refreshDocumentLanguage();
    }
  }

  /**
   * @purpose Shows the document's language in the status bar, and where it came from in the tooltip (FR-12.3).
   * @inputs void.
   * @outputs void.
   * @dataflow documentLanguage -> button text, title and label.
   * @controlflow No branches.
   */
  private refreshLanguageStatus(): void {
    const name = languageName(this.documentLanguage.language);
    const from = LANGUAGE_SOURCE_TEXT[this.documentLanguage.source];
    this.statusLanguage.textContent = this.documentLanguage.language;
    this.statusLanguage.title = `Spelling language: ${name}, ${from}. Click to change.`;
    this.statusLanguage.setAttribute('aria-label', `Spelling language: ${name}, ${from}`);
  }

  /**
   * @purpose Lets the reader choose the document's language (FR-12.3).
   * @inputs void.
   * @outputs void.
   * @dataflow picker choice -> saveLanguageChoice (saved file) or unsavedLanguageChoices -> refreshDocumentLanguage.
   * @controlflow A language named in the front matter is changed there instead. "Detect automatically" forgets the
   *   choice. Choosing a language clears an earlier refusal of its dictionary, so the reader is asked again.
   */
  private chooseLanguage(): void {
    // Check whether the file itself names the language.
    if (this.documentLanguage.source === 'front-matter') {
      this.showMessage(`This document's front matter sets lang: ${this.documentLanguage.language}. Change it there.`);
      return;
    } else {
      // Not fixed by the file: offer the choices.
    }
    const automatic = this.settings.proofing.detectLanguage ? 'Guess from the text, or use the default' : `Use the default, ${this.settings.proofing.language}`;
    const items = [
      { id: '', label: 'Detect automatically', detail: automatic },
      ...LANGUAGE_CHOICES.map((tag: string) => ({ id: tag, label: languageName(tag), detail: tag })),
    ];
    this.spellingLanguagePicker.open(items, (item): void => {
      const language = item.id === '' ? null : item.id;
      const path = this.fileMenu.filePath;
      // Check where to remember the choice: storage for a saved file, memory for an unsaved one.
      if (path !== null) {
        try {
          saveLanguageChoice(window.localStorage, path, language);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.showMessage(`The language was applied but not remembered. ${message}`);
        }
      } else if (this.activeTabId === null) {
        // No document at all: nothing to remember it against.
      } else if (language === null) {
        this.unsavedLanguageChoices.delete(this.activeTabId);
      } else {
        this.unsavedLanguageChoices.set(this.activeTabId, language);
      }
      // Check whether a language was named, whose dictionary may have been refused before.
      if (language !== null) {
        this.declinedDictionaries.delete(language);
      } else {
        // Automatic: nothing to ask about yet.
      }
      this.refreshDocumentLanguage();
      this.showMessage(`Checking spelling in ${languageName(this.documentLanguage.language)}.`);
    });
  }

  /**
   * @purpose Offers to download a dictionary the document needs and K-Doc does not have (FR-12.3).
   * @inputs language - The language with no dictionary.
   * @outputs Promise<void> - Settles once the reader has answered and any download has finished.
   * @dataflow confirm dialog -> spellService.downloadDictionary -> spellCheck.reload.
   * @controlflow Nothing is downloaded without a yes. It does not ask for a language with no published dictionary,
   *   one refused or failed this session, while already asking, or outside the desktop app; it says spelling is off.
   */
  private async offerDictionary(language: string): Promise<void> {
    const name = languageName(language);
    const published = LANGUAGE_CHOICES.some((tag: string) => tag === language || tag === primaryLanguage(language));
    // Check whether there is anything to offer.
    if (!published || !this.spellService.available) {
      this.showMessage(`There is no ${name} dictionary to use, so spelling is not checked in this document.`);
      return;
    } else if (this.declinedDictionaries.has(language) || this.dictionaryPromptOpen) {
      this.showMessage(`Spelling is not checked in ${name}. Choose the language from the status bar to be asked again.`);
      return;
    } else {
      // Ask.
    }
    this.dictionaryPromptOpen = true;
    const choice = await this.confirmDialog
      .ask(`This document is in ${name}, and there is no ${name} dictionary on this computer. Download one from ${DICTIONARY_SOURCE_NAME}? It is kept for next time.`, {
        heading: 'Download a dictionary?',
        confirm: 'Download',
        discard: null,
        cancel: 'Not now',
      })
      .finally((): void => {
        this.dictionaryPromptOpen = false;
      });
    // Check the answer.
    if (choice !== 'save') {
      this.declinedDictionaries.add(language);
      this.showMessage(`Spelling is not checked in ${name}. Choose the language from the status bar to be asked again.`);
      return;
    } else {
      this.showMessage(`Downloading the ${name} dictionary…`);
    }
    try {
      const installed = await this.spellService.downloadDictionary(language);
      this.showMessage(`Downloaded the ${languageName(installed)} dictionary.`);
    } catch (error) {
      // A failure is not retried on every re-check: the reader chooses the language again to try again.
      this.declinedDictionaries.add(language);
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`Could not download the ${name} dictionary. ${message}`);
    }
    // The download made its dictionary the one in use; the mounted document goes back to its own language.
    this.spellCheck.reload();
  }

  private savedDisplayFor(path: string | null): DisplayOverride {
    // A document never saved has nothing to key an override on.
    if (path === null) {
      return {};
    } else {
      try {
        return loadDisplayOverride(window.localStorage, path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.showMessage(`This document's width and density could not be read. ${message}`);
        return {};
      }
    }
  }

  /**
   * @purpose Stores the active document's own width and density and applies them at once (FR-5.10, FR-14.13).
   * @inputs override - The new per-document choices; empty clears them.
   * @outputs boolean - True when it was stored, false when there is no saved document to store it against.
   * @dataflow override → this.displayOverride → applyZoom (CSS properties) and saveDisplayOverride (local storage).
   * @controlflow Report and refuse when the document has never been saved; otherwise apply, then persist, reporting a storage failure.
   */
  private setDisplayOverride(override: DisplayOverride): boolean {
    const path = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    // An unsaved document has no path to remember the choice against, and silently forgetting it
    // would look like the command had not worked.
    if (path === null) {
      this.showMessage('Save the document before giving it its own width or density.');
      return false;
    } else {
      // A saved document: apply the choice first so it shows even if storing it fails.
    }
    this.displayOverride = override;
    this.applyZoom();
    try {
      saveDisplayOverride(window.localStorage, path, override);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showMessage(`The width and density were applied but not remembered. ${message}`);
    }
    return true;
  }

  /**
   * @purpose Steps the active document's reading width to the next one (FR-5.10).
   * @inputs void; reads the override in force and the appearance settings.
   * @outputs void.
   * @dataflow The width in force → nextReadingWidth → setDisplayOverride → applied and stored → reported.
   * @controlflow Start from the document's own width, or the setting when it has none; report only when the choice was stored.
   */
  private cycleDocumentWidth(): void {
    // The step starts from what the reader sees now, which is the document's own width when it has
    // one and the setting when it does not.
    const current = this.displayOverride.readingWidth ?? this.settings.appearance.readingWidth;
    const width = nextReadingWidth(current);
    // Check whether the choice could be stored against a document.
    if (this.setDisplayOverride({ ...this.displayOverride, readingWidth: width })) {
      this.showMessage(`Reading width for this document: ${width}.`);
    } else {
      // Unsaved: setDisplayOverride has already said so.
    }
  }

  /**
   * @purpose Steps the active document's display density to the next one (FR-14.13).
   * @inputs void; reads the override in force and the appearance settings.
   * @outputs void.
   * @dataflow The density in force → nextDensity → setDisplayOverride → applied and stored → reported.
   * @controlflow Start from the document's own density, or the setting when it has none; report only when the choice was stored.
   */
  private cycleDocumentDensity(): void {
    // As with the width, the step starts from what the reader sees now.
    const current = this.displayOverride.density ?? this.settings.appearance.density;
    const density = nextDensity(current);
    // Check whether the choice could be stored against a document.
    if (this.setDisplayOverride({ ...this.displayOverride, density })) {
      this.showMessage(`Display density for this document: ${density}.`);
    } else {
      // Unsaved: setDisplayOverride has already said so.
    }
  }

  /**
   * @purpose Drops the active document's own width and density so it follows the settings again (FR-5.10, FR-14.13).
   * @inputs void.
   * @outputs void.
   * @dataflow An empty override → setDisplayOverride → the stored entry removed → the settings apply again.
   * @controlflow Report only when the document had a path to clear the override from.
   */
  private clearDocumentDisplay(): void {
    // Check whether the empty override could be stored against a document.
    if (this.setDisplayOverride({})) {
      this.showMessage('This document follows the appearance settings again.');
    } else {
      // Unsaved: setDisplayOverride has already said so.
    }
  }

  private savedFoldsFor(path: string | null): readonly string[] {
    // A document never saved has no remembered folds.
    if (path === null) {
      return [];
    } else {
      try {
        return loadFolds(window.localStorage, path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearFolds(window.localStorage);
        this.showMessage(`Folded sections could not be restored, so they were reset. ${message}`);
        return [];
      }
    }
  }

  /**
   * @purpose Persists the current folded section keys for the active document to local storage (FR-8.29).
   * @inputs keys - The fold keys to store for the document's path.
   * @outputs void.
   * @dataflow Active file menu path → saveFolds(window.localStorage, path, keys) → persisted on success (reset + reported on failure).
   * @controlflow Resolve the path via the file menu; return early when unsaved; otherwise attempt the write and, on error, reset storage and report.
   */
  private persistFolds(keys: readonly string[]): void {
    // Before the first mount there is no file menu.
    const path = this.fileMenu === undefined ? null : this.fileMenu.filePath;
    // An unsaved document keeps its folds only in its tab.
    if (path === null) {
      return;
    } else {
      try {
        saveFolds(window.localStorage, path, keys);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearFolds(window.localStorage);
        this.showMessage(`Folded sections could not be saved, so the saved folds were reset. ${message}`);
      }
    }
  }

  /**
   * @purpose Folds or unfolds the section or list item at the caret in the focused pane (FR-8.29).
   * @inputs void; operates on the current document's fold state and focused pane.
   * @outputs void.
   * @dataflow FoldSync store toggled via Source caret or ProseMirror command → reported when nothing matched.
   * @controlflow Return early if no fold sync is mounted; branch on the focused pane to toggle in Source or K-Doc; report when no toggle occurred.
   */
  /**
   * @purpose Takes a local snapshot of the open document (FR-11.8).
   * @inputs reason - A save, the command or the timer; text - The text to keep, the session's by default.
   * @outputs void; reports the result of a snapshot the user asked for, and any failure.
   * @dataflow file path + text -> snapshot store -> written, deduplicated and pruned on disk.
   * @controlflow Skip a document without a file (explaining only when asked); otherwise take it and report.
   */
  private takeSnapshot(reason: SnapshotReason, text: string = this.documentSession.snapshot.text): void {
    const path = this.fileMenu.filePath;
    // Check whether the document has a file to keep snapshots for.
    if (path === null || !this.snapshotStore.available) {
      // Untitled, or no desktop host: there is nowhere to keep them. Only a requested snapshot says so.
      if (reason === 'manual') {
        this.showMessage('Save the document in the desktop app before taking a snapshot.');
      } else {
        // Automatic: stay quiet.
      }
      return;
    } else {
      // A saved document: take it below.
    }
    this.snapshotStore.take(path, text, reason).then((taken): void => {
      // Only the command reports success, since saves and the timer take snapshots without being asked.
      if (reason === 'manual') {
        // Asked for: say whether anything new was kept.
        this.showMessage(taken === null ? 'No changes since the last snapshot.' : 'Snapshot taken.');
      } else {
        // Automatic: nothing to report.
      }
    }).catch((error: unknown): void => {
      this.showMessage(`Could not take a snapshot: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * @purpose Switches Focus and Typewriter modes and redraws both panes (FR-5.8).
   * @inputs next - The modes to use; message - What to tell the user.
   * @outputs void; both panes redraw and the message is shown.
   * @dataflow next -> this.writingModes (read through both panes' getters) -> TYPEWRITER_CLASS on the body -> pane refreshes.
   * @controlflow Store, set the padding class, redraw both panes, report.
   */
  private setWritingModes(next: WritingModes, message: string): void {
    this.writingModes = next;
    // The class gives both panes room below the last line, so it too can reach the middle.
    document.body.classList.toggle(TYPEWRITER_CLASS, next.typewriter);
    refreshWritingModesIn(this.proseMirrorBinding.view);
    refreshWritingModes(this.codeMirrorBinding.view);
    this.showMessage(message);
  }

  /**
   * @purpose Turns Focus mode on at the given scope, or off when it is already on at that scope (FR-5.8).
   * @inputs scope - Paragraph or sentence.
   * @outputs void.
   * @dataflow current focus scope -> next modes -> setWritingModes.
   * @controlflow The same scope again turns it off; the other scope switches to it.
   */
  private toggleFocusMode(scope: 'paragraph' | 'sentence'): void {
    const on = this.writingModes.focus !== scope;
    // Check whether this turns Focus mode on or off.
    if (on) {
      // On, or switched from the other scope.
      this.setWritingModes({ ...this.writingModes, focus: scope }, `Focus mode: ${scope}. Run the command again to turn it off.`);
    } else {
      // Already on at this scope: off.
      this.setWritingModes({ ...this.writingModes, focus: 'off' }, 'Focus mode off.');
    }
  }

  /**
   * @purpose Turns Typewriter mode on or off (FR-5.8).
   * @inputs void.
   * @outputs void.
   * @dataflow current typewriter flag -> next modes -> setWritingModes.
   * @controlflow Flip the flag and report.
   */
  private toggleTypewriterMode(): void {
    const on = !this.writingModes.typewriter;
    // Check which way the flag flipped, for the message.
    if (on) {
      this.setWritingModes({ ...this.writingModes, typewriter: true }, 'Typewriter mode on: the line you type stays in the middle.');
    } else {
      this.setWritingModes({ ...this.writingModes, typewriter: false }, 'Typewriter mode off.');
    }
  }

  /**
   * @purpose Opens Version History for the open document (FR-11.9).
   * @inputs void.
   * @outputs void; the dialog opens, or a message says why it cannot.
   * @dataflow file path -> dialog.open() -> snapshot store list and read.
   * @controlflow Explain and stop for a document without a file or without a desktop host; otherwise open.
   */
  /**
   * @purpose Lists the open document's versions for Version History: its local snapshots and, when it is in a git working tree, the commits that touched it (FR-11.8, FR-11.11).
   * @inputs void; reads the file path and text.
   * @outputs The versions, oldest first.
   * @dataflow snapshot store list + git log -> VersionEntry[] sorted by time.
   * @controlflow A git failure is reported and leaves the snapshots listed; otherwise both are merged.
   */
  private async listVersions(): Promise<readonly VersionEntry[]> {
    const path = this.fileMenu.filePath ?? '';
    // How many commits to list; older ones are rarely wanted in a dialog.
    const commitLimit = 100;
    const [snapshots, commits] = await Promise.all([
      this.snapshotStore.list(path, this.documentSession.snapshot.text),
      this.gitService.log(path, commitLimit).catch((error: unknown): readonly GitCommit[] => {
        this.showMessage(`Git history is unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
    ]);
    const entries: VersionEntry[] = [
      ...snapshots,
      // git lists newest first; reversed, commits made in the same second (git keeps whole seconds) stay in order below.
      ...[...commits].reverse().map((commit: GitCommit): VersionEntry => ({ id: `git:${commit.hash}`, at: commit.at, reason: 'commit', detail: `${commit.shortHash} ${commit.subject}` })),
    ];
    // The dialog takes versions oldest first and draws them newest first.
    return entries.sort((a: VersionEntry, b: VersionEntry): number => a.at - b.at);
  }

  /**
   * @purpose Reads one version's text for Version History, from git for a commit and from the snapshot store otherwise.
   * @inputs id - A version id from listVersions.
   * @outputs The text of that version.
   * @dataflow id -> git show (LF line breaks) or snapshot read.
   * @controlflow Branch on the git: prefix.
   */
  private readVersion(id: string): Promise<string> {
    const path = this.fileMenu.filePath ?? '';
    const prefix = 'git:';
    // Check whether the version is a commit.
    if (id.startsWith(prefix)) {
      // A commit: git hands back the stored bytes, while the editor holds LF line breaks, so match them before comparing.
      return this.gitService.fileAt(path, id.slice(prefix.length)).then((text: string): string => text.replace(/\r\n/g, '\n'));
    } else {
      // A snapshot.
      return this.snapshotStore.read(path, this.documentSession.snapshot.text, id);
    }
  }

  /**
   * @purpose Runs a git action on the saved open document after the checks both actions share (FR-11.11).
   * @inputs verb - The action's name for messages; run - The action, given the path, file name and git state; resolves with a message, or null to say nothing.
   * @outputs A message in the status area.
   * @dataflow path + dirty flag -> gitService.info -> run -> message.
   * @controlflow Stop with a reason for an unsaved or untitled document or one outside git; report any git failure.
   */
  private async withGitFile(verb: string, run: (path: string, name: string, info: GitFileInfo) => Promise<string | null>): Promise<void> {
    const path = this.fileMenu.filePath;
    // Check whether there is a saved file in the desktop app to act on.
    if (path === null || !this.gitService.available) {
      // Untitled, or the browser build.
      this.showMessage(`Save the document in the desktop app before you ${verb} it.`);
      return;
    } else if (this.documentSession.snapshot.dirty) {
      // Unsaved changes: git works on the file on disk, which would not match the screen.
      this.showMessage(`Save the document before you ${verb} it, so git gets what is on screen.`);
      return;
    } else {
      // Saved: ask git about it below.
    }
    try {
      const info = await this.gitService.info(path);
      // Check whether the file is in a git working tree.
      if (info === null) {
        // No repository around it.
        this.showMessage('This document is not in a git repository.');
        return;
      } else {
        // In a repository: run the action.
      }
      const message = await run(path, path.split(/[\\/]/).pop() ?? path, info);
      // Check whether the action has something to report.
      if (message === null) {
        // Cancelled: nothing to say.
      } else {
        this.showMessage(message);
      }
    } catch (error: unknown) {
      this.showMessage(`Git: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @purpose Stages the saved open document in its git repository (FR-11.11).
   * @inputs void.
   * @outputs void; a message says what happened.
   * @dataflow withGitFile -> gitService.stage.
   * @controlflow Delegates the checks to withGitFile.
   */
  private gitStageFile(): void {
    void this.withGitFile('stage', async (path: string, name: string): Promise<string> => {
      await this.gitService.stage(path);
      return `Staged ${name}.`;
    });
  }

  /**
   * @purpose Commits just the saved open document, asking for a message (FR-11.11).
   * @inputs void; the message comes from a prompt.
   * @outputs void; a message names the new commit.
   * @dataflow withGitFile -> prompt -> gitService.commit -> short hash.
   * @controlflow A cancelled or empty message commits nothing.
   */
  private gitCommitFile(): void {
    void this.withGitFile('commit', async (path: string, name: string, info: GitFileInfo): Promise<string | null> => {
      const message = await this.promptDialog.ask('Commit File', 'Commit message', '');
      // Check whether a message was given.
      if (message === null || message.trim() === '') {
        // Cancelled or empty: git needs a message, so commit nothing.
        return null;
      } else {
        // Given: commit below.
      }
      const hash = await this.gitService.commit(path, message);
      // Name the branch when there is one; a first commit has none to name beforehand.
      const branch = info.branch === '' ? '' : ` on ${info.branch}`;
      return `Committed ${name}${branch} (${hash}).`;
    });
  }

  /**
   * @purpose Compares two Markdown files the user picks as tracked changes in a new tab (FR-11.7).
   * @inputs void; the files come from two open dialogs, original first.
   * @outputs void.
   * @dataflow open dialog x2 -> contents -> openComparison.
   * @controlflow Report no file access; stop when either pick is dismissed; report a failed read; otherwise compare.
   */
  private compareDocuments(): void {
    // Check whether this build can open files at all.
    if (!this.fileService.available) {
      // Browser build: there is no picker behind the command.
      this.showMessage('Comparing documents is only available in the K-Doc desktop app.');
      return;
    } else {
      // Desktop: ask for the two files below.
    }
    void (async (): Promise<void> => {
      try {
        this.showMessage('Choose the original document.');
        const original = await this.fileService.openFile();
        // Check whether the first pick was made.
        if (original === null) {
          // Dismissed: nothing to compare.
          return;
        } else {
          // Picked: ask for the second.
        }
        this.showMessage('Choose the revised document to compare with it.');
        const revised = await this.fileService.openFile();
        // Check whether the second pick was made.
        if (revised === null) {
          // Dismissed: nothing to compare.
          return;
        } else {
          // Both picked: compare them.
        }
        const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
        this.openComparison(original.contents, revised.contents, fileName(revised.path), `${fileName(original.path)} and ${fileName(revised.path)}`);
      } catch (caught: unknown) {
        this.showMessage(`Could not open a document to compare: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    })();
  }

  /**
   * @purpose Opens a new tab holding the newer text, with every difference from the older text as a tracked change (FR-11.7).
   * @inputs older - The original text; newer - The revised text; author - Who the changes are credited to; label - What was compared, for the messages.
   * @outputs void; a new unsaved tab with pending changes and the Review panel shown, or a message that nothing differs.
   * @dataflow older + newer -> compareAsChanges -> new tab with newer text -> changesController.replace after the tab's own load.
   * @controlflow Report identical texts; otherwise open the tab, wait for its stored changes to load, and replace them unless another document was mounted meanwhile.
   */
  private openComparison(older: string, newer: string, author: string, label: string): void {
    // One millisecond apart in id order: the changes share a timestamp, and the Review pane breaks that tie by id, so
    // random ULIDs from one millisecond would list them out of document order.
    const base = Date.now();
    let sequence = 0;
    const changes = compareAsChanges(older, newer, author, (): string => generateUlid(base + sequence++));
    // Check whether the texts differ at all.
    if (changes.length === 0) {
      // Identical: an empty comparison tab would only need closing.
      this.showMessage(`${label} are the same.`);
      return;
    } else {
      // Different: open the comparison.
    }
    this.newDocument(newer);
    const controller = this.changesController;
    void this.changesLoaded.then((): void => {
      // Check that the comparison tab is still the one mounted; a quick tab switch would have replaced the controller.
      if (this.changesController === controller) {
        // Still mounted: the load has finished, so the replacement will not be overwritten by it.
        controller.replace(changes);
        this.rightSidebar.show('review');
        // One change reads in the singular.
        const count = changes.length === 1 ? '1 change' : `${changes.length} changes`;
        this.showMessage(`Compared ${label}: ${count} to accept or reject in the Review panel.`);
      } else {
        // Switched away: the comparison tab keeps only its text.
      }
    });
  }

  /**
   * @purpose Opens a snapshot compared with the current document as tracked changes (FR-11.7, two versions).
   * @inputs text - The snapshot's text; snapshot - Which snapshot, for the author and message.
   * @outputs void.
   * @dataflow snapshot text + current text -> openComparison.
   * @controlflow Delegates.
   */
  private compareSnapshot(text: string, snapshot: VersionEntry): void {
    const when = new Date(snapshot.at).toLocaleString();
    this.openComparison(text, this.documentSession.snapshot.text, `Since ${when}`, `the version from ${when} and the current document`);
  }

  private showVersionHistory(): void {
    // Check whether the document has snapshots it could show.
    if (this.fileMenu.filePath === null || !this.snapshotStore.available) {
      // Untitled, or the browser build: snapshots are kept only for saved files in the desktop app.
      this.showMessage('Save the document in the desktop app to keep and browse its versions.');
    } else {
      // Saved: list its snapshots.
      void this.versionHistoryDialog.open();
    }
  }

  /**
   * @purpose Restores a snapshot as a new revision, never destructively (FR-11.10).
   * @inputs text - The snapshot's text; snapshot - Which snapshot it was, for the message.
   * @outputs void; the document changes as one undoable edit, after the current text is kept as a snapshot.
   * @dataflow current text -> 'restore' snapshot; snapshot text -> applyExternalText.
   * @controlflow Report when the version equals the document; otherwise keep the current text, apply the version and confirm.
   */
  private restoreSnapshot(text: string, snapshot: VersionEntry): void {
    const current = this.documentSession.snapshot.text;
    // Check whether restoring would change anything.
    if (text === current) {
      // Identical: an undo step that undoes nothing would make Ctrl+Z look broken.
      this.showMessage('That version is the same as the document.');
    } else {
      // Different: keep what is on screen first, so the restore can itself be browsed back from.
      this.takeSnapshot('restore', current);
      this.documentSession.applyExternalText(text);
      this.showMessage(`Restored the version from ${new Date(snapshot.at).toLocaleString()}. Undo puts the current text back.`);
    }
  }

  /**
   * @purpose Starts, restarts or stops the timer that takes a snapshot every few minutes (FR-11.8).
   * @inputs void; reads settings.history.snapshotMinutes.
   * @outputs void.
   * @dataflow setting -> window interval -> takeSnapshot('timer').
   * @controlflow Leave a timer already running at the set interval alone, since applySettings runs on every settings change; otherwise stop it and start one unless the setting is 0 or the shell is torn down.
   */
  private restartSnapshotTimer(): void {
    const minutes = this.settings.history.snapshotMinutes;
    // Check the running timer against the setting.
    if (this.snapshotTimer !== null && this.snapshotTimer.minutes === minutes) {
      // Already running at this interval: restarting would only push the next snapshot back.
      return;
    } else if (this.snapshotTimer !== null) {
      // A different interval: stop the old timer before starting the new one.
      window.clearInterval(this.snapshotTimer.id);
      this.snapshotTimer = null;
    } else {
      // No timer yet.
    }
    // Check whether timer snapshots are on.
    if (minutes > 0 && !this.destroyed) {
      // On: take a snapshot every interval; unchanged text is skipped by the store.
      const id = window.setInterval((): void => {
        this.takeSnapshot('timer');
      }, minutes * 60_000);
      this.snapshotTimer = { id, minutes };
    } else {
      // Off (0) or torn down: no timer.
    }
  }

  /**
   * @purpose Moves the section at the caret, with its subsections, into a new untitled tab (FR-8.31).
   * @inputs void; reads the focused pane's caret.
   * @outputs void; the current document loses the section as one undoable external edit and a background tab opens.
   * @dataflow caret -> outline index -> splitSection -> remaining text applied here, section text stored in a new tab.
   * @controlflow Report when the caret is before any heading; otherwise shorten this document and add the tab without switching.
   */
  private splitAtHeading(): void {
    const snapshot = this.documentSession.snapshot;
    const entries = buildOutline(snapshot.document);
    // The Source caret is a source offset; the K-Doc caret is found by counting top-level headings.
    const index = snapshot.focusedPane === 'source'
      ? sectionIndexAtOffset(entries, this.codeMirrorBinding.view.state.selection.main.head)
      : sectionIndexAtCaret(this.proseMirrorBinding.view.state);
    const split = splitSection(snapshot.text, entries, index);
    const current = this.activeTabId;
    // Check whether the caret is inside a section and there is a tab to return to.
    if (split === null || current === null) {
      // Before the first heading, or no headings: there is no section to split off.
      this.showMessage('Put the caret under a heading to split its section into a new document.');
      return;
    } else {
      // A section: take it out of this document, which stays on screen so undo can put it back (undo history does not survive a tab switch).
      this.documentSession.applyExternalText(split.remaining);
      // The new tab's saved text is the empty document, so it counts as unsaved and closing it asks first.
      this.tabs.open({ text: split.section, path: null, savedText: '\n', dirty: true });
      // TabSet.open activates what it opens; the mounted document is still this one, so make it active again.
      this.tabs.activate(current);
      this.tabBar.refresh();
      this.showMessage(`Split “${split.title}” into a new tab.`);
    }
  }

  /**
   * @purpose Appends a Markdown file the user picks to the end of the current document (FR-8.31).
   * @inputs void; the file comes from the open dialog.
   * @outputs void; the document changes as one undoable external edit.
   * @dataflow open dialog -> file contents -> parse -> mergeDocumentText -> applyExternalText.
   * @controlflow Report when file access is missing or the pick fails; stop on a dismissed dialog; report a file with nothing to merge; otherwise apply and confirm.
   */
  private mergeDocument(): void {
    // Check whether this build can open files at all.
    if (!this.fileService.available) {
      // Browser build: no picker behind the command.
      this.showMessage('Merging documents is only available in the K-Doc desktop app.');
      return;
    } else {
      // Desktop: continue to the picker.
    }
    void (async (): Promise<void> => {
      let opened: OpenedFile | null;
      try {
        opened = await this.fileService.openFile();
      } catch (caught: unknown) {
        this.showMessage(`Could not open the document to merge: ${caught instanceof Error ? caught.message : String(caught)}`);
        return;
      }
      // Check whether the user picked a file.
      if (opened === null) {
        // Dismissed: nothing to merge.
        return;
      } else {
        // Picked: merge it below.
      }
      const name = opened.path.split(/[\\/]/).pop() ?? opened.path;
      const text = this.documentSession.snapshot.text;
      const next = mergeDocumentText(text, parseMarkdown(opened.contents));
      // Check whether the file added anything.
      if (next === text) {
        // Empty body (perhaps only front matter): leave the document and its undo history alone.
        this.showMessage(`${name} has nothing to merge.`);
      } else {
        // Content: append it as one external edit, which undo reverts.
        this.documentSession.applyExternalText(next);
        this.showMessage(`Merged ${name} at the end of this document.`);
      }
    })();
  }

  private toggleFold(): void {
    const foldSync = this.foldSync;
    // No mount yet: nothing to toggle.
    if (foldSync === null) {
      return;
    } else {
      let toggled: boolean;
      // The caret is in the Source pane when focused there.
      if (this.documentSession.snapshot.focusedPane === 'source') {
        toggled = foldSync.toggleAtSourceCaret();
      } else {
        const view = this.proseMirrorBinding.view;
        toggled = toggleFoldCommand(foldSync.store)(view.state, view.dispatch);
      }
      // Report only when the caret had no foldable target.
      if (!toggled) {
        this.showMessage('There is no section or list item to fold at the caret.');
      } else {
        // A toggle occurred: nothing to report.
      }
    }
  }

  /**
   * @purpose Folds every heading section in the mounted document (FR-8.29).
   * @inputs void; operates on the current document's fold state.
   * @outputs void.
   * @dataflow FoldSync.foldAllHeadings() applies folds to all heading sections.
   * @controlflow Return early if no fold sync is mounted; otherwise delegate to FoldSync.
   */
  private foldAllHeadings(): void {
    // No mount yet: nothing to fold.
    if (this.foldSync === null) {
      return;
    } else {
      this.foldSync.foldAllHeadings();
    }
  }

  /**
   * @purpose Unfolds every folded section in the mounted document (FR-8.29).
   * @inputs void; operates on the current document's fold state.
   * @outputs void.
   * @dataflow FoldSync.unfoldAll() restores all sections to their unfolded state.
   * @controlflow Return early if no fold sync is mounted; otherwise delegate to FoldSync.
   */
  private unfoldAll(): void {
    // No mount yet: nothing to unfold.
    if (this.foldSync === null) {
      return;
    } else {
      this.foldSync.unfoldAll();
    }
  }

  /**
   * @purpose Rewrites inline links in the mounted document as reference links and opens the Link Definitions panel (FR-8.16).
   * @inputs None; reads this.documentSession.snapshot.document internally.
   * @outputs void; applies an undoable external text edit, shows a status message, and reveals the link-definitions sidebar.
   * @dataflow document → convertToReferenceLinks() → { text, converted } → applyExternalText + showMessage + rightSidebar.show.
   * @controlflow Convert → if zero results, show empty message and return; else apply text, report count, open panel.
   */
  private convertToReferenceLinks(): void {
    const result = convertToReferenceLinks(this.documentSession.snapshot.document);
    // Zero converted links: nothing to do beyond informing the user.
    if (result.converted === 0) {
      this.showMessage('There are no inline links to convert.');
    } else {
      // One undoable edit that both panes pick up.
      this.documentSession.applyExternalText(result.text, { coalesce: false });
      this.showMessage(result.converted === 1 ? 'Converted 1 link to a reference link.' : `Converted ${result.converted} links to reference links.`);
      this.rightSidebar.show('link-definitions');
    }
  }

  /**
   * @purpose Inserts a table of contents at the caret, asking how deep it goes, or refreshes the one the document already has (FR-8.30).
   * @inputs none - reads the K-Doc view's document and caret.
   * @outputs Promise<void>.
   * @dataflow hasTableOfContents -> refresh, or promptDialog.ask -> depth -> insertTableOfContents -> dispatch.
   * @controlflow With a table of contents, refresh it and say what happened; otherwise ask, refuse a bad level, insert, and say when no heading qualified.
   */
  private async askTableOfContents(): Promise<void> {
    const view = this.proseMirrorBinding.view;
    // A document keeps one table of contents: asking again refreshes it rather than adding a second.
    if (hasTableOfContents(view.state)) {
      const refreshed = refreshTableOfContents()(view.state, view.dispatch);
      // Say whether the list changed, since a refresh that finds nothing to do is otherwise invisible.
      if (refreshed) {
        this.showMessage('Table of contents refreshed.');
      } else {
        this.showMessage('The table of contents is already up to date.');
      }
      view.focus();
      return;
    } else {
      // No table of contents yet: ask how deep the new one goes.
    }
    const answer = await this.promptDialog.ask('Table of contents', 'Include headings down to level (1 to 6)', String(DEFAULT_TOC_DEPTH));
    // Cancelled: insert nothing.
    if (answer === null) {
      return;
    } else {
      // Answered: read the level below.
    }
    const level = answer.trim();
    // Only a single digit from 1 to 6 names a heading level.
    if (!/^[1-6]$/.test(level)) {
      this.showMessage('Enter a heading level from 1 to 6.');
    } else if (!insertTableOfContents(Number(level))(view.state, view.dispatch)) {
      this.showMessage(`There are no headings down to level ${level} to list.`);
    } else {
      // Inserted at the caret.
    }
    view.focus();
  }

  /**
   * @purpose Asks for the minimum width of the table column under the caret and applies it (FR-8.26).
   * @inputs none - reads the caret's column from the K-Doc view.
   * @outputs Promise<void>.
   * @dataflow columnWidthHintAt -> promptDialog.ask -> parseWidthHint -> setColumnWidthHint -> dispatch.
   * @controlflow Outside a table, say so; on cancel, stop; on an invalid answer, say what is accepted; otherwise set the hint.
   */
  private async askColumnWidth(): Promise<void> {
    const view = this.proseMirrorBinding.view;
    const current = columnWidthHintAt(view.state);
    // Only a caret in a table has a column to size.
    if (current === undefined) {
      this.showMessage('Put the caret in a table column to set its width.');
      return;
    } else {
      // In a table: ask, starting from the column's current hint.
    }
    const answer = await this.promptDialog.ask('Column width', `Minimum width in characters (1 to ${MAX_WIDTH_HINT}); empty for automatic`, current === null ? '' : String(current));
    // Cancelled: leave the column as it is.
    if (answer === null) {
      return;
    } else {
      // Answered: read it below.
    }
    const width = parseWidthHint(answer);
    // An answer that is not a width is reported rather than guessed at.
    if (width === 'invalid') {
      this.showMessage(`Enter a whole number from 1 to ${MAX_WIDTH_HINT}, or leave it empty for automatic.`);
    } else {
      // Unchanged widths make the command refuse, which needs no message: the column already is that wide.
      setColumnWidthHint(width)(view.state, view.dispatch);
    }
    view.focus();
  }

  /**
   * @purpose Explains, once per document, content entered into a table cell that Markdown cannot hold as written (FR-8.25).
   * @inputs kind - A pipe (saved escaped) or a line break (saved as a space).
   * @outputs void.
   * @dataflow kind -> tableEscapesWarned -> showMessage(TABLE_ESCAPE_MESSAGES[kind]).
   * @controlflow Say nothing for a kind already explained in this document; otherwise record it and show the message.
   */
  private warnTableEscape(kind: TableEscapeKind): void {
    // Once per kind per document: a message on every pipe typed would bury everything else in the status line.
    if (this.tableEscapesWarned.has(kind)) {
      return;
    } else {
      this.tableEscapesWarned.add(kind);
      this.showMessage(TABLE_ESCAPE_MESSAGES[kind]);
    }
  }

  /**
   * @purpose Describes where the caret is, for the navigation history (FR-9.10).
   * @inputs None; reads the active tab and the caret.
   * @outputs NavLocation | null - The active tab, its path and the caret's Source offset, or null with no tab open.
   * @dataflow activeTabId + tab payload path + navigationCaretOffset() -> NavLocation.
   * @controlflow Return null without an active tab; otherwise build the location.
   */
  private currentNavLocation(): NavLocation | null {
    const tabId = this.activeTabId;
    const payload = tabId === null ? null : this.tabs.get(tabId);
    // A location needs a document: with no active tab there is nowhere to come back to.
    if (tabId === null || payload === null) {
      return null;
    } else {
      return { tabId, path: payload.path, offset: this.navigationCaretOffset() };
    }
  }

  /**
   * @purpose Shows a location from the navigation history: its tab, or its note reopened, with the caret at its offset.
   * @inputs location - The tab id, path and Source offset to return to.
   * @outputs Promise<boolean> - True when the location is on screen; false when it can no longer be reached.
   * @dataflow location -> tab by id, tab by path, or openNoteFromVault(path) -> revealOffset(offset clamped to the text).
   * @controlflow Prefer the same tab, then a tab on the same path, then reopening the path; give up on a closed unsaved tab or a failed open.
   */
  private async showNavLocation(location: NavLocation): Promise<boolean> {
    const wanted = location.path;
    const byPath = wanted === null ? undefined : this.tabs.snapshot.tabs.find((tab) => tab.payload.path !== null && samePath(tab.payload.path, wanted));
    // The tab it was in comes first; a tab showing the same note (reopened since) comes next.
    if (this.tabs.get(location.tabId) !== null) {
      this.activateTab(location.tabId);
    } else if (byPath !== undefined) {
      this.activateTab(byPath.id);
    } else if (wanted !== null) {
      // Closed since: reopen the note. openNoteFromVault reports its own failure.
      await this.openNoteFromVault(wanted);
    } else {
      // An unsaved document whose tab was closed cannot be reached again.
      return false;
    }
    const shown = this.currentNavLocation();
    const arrived = shown !== null && (shown.tabId === location.tabId || (shown.path !== null && wanted !== null && samePath(shown.path, wanted)));
    // Reveal only in the document that actually came up, not whatever is active after a failed open.
    if (!arrived) {
      return false;
    } else {
      // The text may have shrunk since: clamp so the caret lands at the end instead.
      this.revealOffset(Math.min(location.offset, this.documentSession.snapshot.text.length));
      return true;
    }
  }

  /**
   * @purpose Returns the caret offset in Source coordinates for whichever pane currently has focus.
   * @inputs None; reads documentSession, codeMirrorBinding and proseMirrorBinding through closures.
   * @outputs Caret head position as a character offset into the Source text.
   * @dataflow Focused pane → CodeMirror selection head or ProseMirror selection mapped through the position index.
   * @controlflow If Source is focused return the CodeMirror head directly; otherwise map the ProseMirror selection to Source coordinates.
   */
  private navigationCaretOffset(): number {
    if (this.documentSession.snapshot.focusedPane === 'source') {
      // Source has focus: the CodeMirror head is already a character offset into the text.
      return this.codeMirrorBinding.view.state.selection.main.head;
    } else {
      // The K-Doc pane has focus: map the ProseMirror selection to Source coordinates via the position index.
      const pmView = this.proseMirrorBinding.view;
      const snapshot = this.documentSession.snapshot;
      const index = buildPositionIndex(snapshot.document.root, pmView.state.doc);
      const selection = pmView.state.selection;
      const carried = proseMirrorSelectionToSource(index, { anchor: selection.anchor, head: selection.head }, snapshot.text.length);
      // An unmappable selection falls back to the Source caret, which the binding keeps in step.
      return carried === null ? this.codeMirrorBinding.view.state.selection.main.head : carried.head;
    }
  }

  /**
   * @purpose Scrolls the Source pane to a character offset, switching to Split mode when necessary.
   * @inputs offset - Character offset into the Source text to reveal.
   * @outputs Positions and focuses the CodeMirror caret at offset; no return value.
   * @dataflow Offset → view dispatch with selection anchor → CodeMirror focus.
   * @controlflow If in a non-line pane, switch to Split first; then set the CodeMirror selection and focus it.
   */
  private revealSourceOffset(offset: number): void {
    if (this.currentViewMode === 'kdoc') {
      // A line number is meaningless in a pane that does not show lines, so switch to Split first.
      this.setViewMode('split');
    }

    // Place the caret at the offset and ensure it scrolls into view.
    this.codeMirrorBinding.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    this.codeMirrorBinding.view.focus();
  }

  /**
   * @purpose Reveals a character offset in the currently focused pane, falling back to Source on mapping failure.
   * @inputs offset - Character offset into the Source text to reveal.
   * @outputs Positions and focuses either the CodeMirror or ProseMirror editor; no return value.
   * @dataflow Offset → pane-specific selection dispatch → editor focus (or fallback to revealSourceOffset).
   * @controlflow If Source is focused use CodeMirror directly; otherwise map via ProseMirror, falling back to Source if mapping fails.
   */
  private revealOffset(offset: number): void {
    if (this.currentViewMode === 'source') {
      // Source has focus: position the CodeMirror caret directly and return before touching ProseMirror.
      this.codeMirrorBinding.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
      this.codeMirrorBinding.view.focus();
      return;
    }

    // The K-Doc pane has focus: map the Source offset to a ProseMirror TextSelection via the position index.
    const pmView = this.proseMirrorBinding.view;
    const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);
    const selection = sourceSelectionToProseMirror(index, pmView.state.doc, { anchor: offset, head: offset });

    if (selection === null) {
      // ProseMirror could not map the offset, so reveal it in Source instead.
      this.revealSourceOffset(offset);
    } else {
      // The selection mapped successfully: apply it to the ProseMirror view and focus the editor.
      pmView.dispatch(pmView.state.tr.setSelection(selection).scrollIntoView());
      this.proseMirrorBinding.focus();
    }
  }

  /**
   * Moves the active caret to a heading within the current document (FR-8.13).
   * @purpose Reveals the target heading in whichever pane currently owns the document.
   * @inputs slug - The heading slug to locate and reveal.
   * @outputs True when a heading was revealed, false when it does not exist in this document.
   * @dataflow buildOutline + findHeadingBySlug → position → CodeMirror/ProseMirror selection dispatch.
   * @controlflow Null entry returns false; source mode uses CodeMirror; otherwise ProseMirror with a CodeMirror fallback.
   */
  private revealHeading(slug: string): boolean {
    // Locate the heading in the current document's outline before touching any pane.
    const entry = findHeadingBySlug(buildOutline(this.documentSession.snapshot.document), slug);
    if (entry === null) {
      // The heading does not exist in this document, so there is nothing to reveal.
      return false;
    }
    // Move the caret to the heading in whichever pane is being edited.
    this.revealOffset(entry.start);
    return true;
  }

  /**
   * Opens a web or mail URL through the operating system (FR-8.13).
   * @purpose Delegates link opening to the OS handler and reports failures without throwing.
   * @inputs url - The absolute URL to hand to the external opener.
   * @outputs Nothing; surfaces any error through showMessage instead of propagating it.
   * @dataflow externalOpener.open(url) → success or caught error → showMessage on failure.
   * @controlflow Try the open; catch unknown errors and display their message.
   */
  private async openExternalLink(url: string): Promise<void> {
    // Open the URL through the OS handler and surface any failure to the user instead of crashing.
    try {
      await this.externalOpener.open(url);
    } catch (caught: unknown) {
      this.showMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  /**
   * Follows a clicked link using the same routing as the hover card and context menu (FR-8.13).
   * @purpose Classifies the href and routes it to reveal-a-heading, open-a-note, or open-an-external-link.
   * @inputs href - The raw link string that was activated.
   * @outputs Nothing; mutates the current document view or opens a new file/URL as needed.
   * @dataflow classifyLink(href) → kind-specific action (revealHeading / openNoteFromVault / openExternalLink).
   * @controlflow Switch on target.kind and perform the matching branch; each case returns explicitly.
   */
  private async followLink(href: string): Promise<void> {
    // Classify the clicked link once so every branch reads only what it needs.
    const target = classifyLink(href, this.linkContext());
    // A heading or note link moves within the notes, so it is worth coming back from; other kinds leave the caret where it is.
    if (target.kind === 'heading' || target.kind === 'note') {
      this.navHistory.recordJump();
    } else {
      // Web, mail, blocked, inline or unresolved: no jump.
    }
    switch (target.kind) {
      case 'heading': {
        // Reveal the heading in the current document; if it is missing, tell the user.
        if (!this.revealHeading(target.slug)) {
          this.showMessage('No heading "#' + target.slug + '" in this document.');
        }
        return;
      }
      case 'note': {
        // If the link points at the currently open file, reveal its heading inline instead of reloading.
        if (this.fileMenu !== undefined && this.fileMenu.filePath !== null && this.fileMenu.filePath.replace(/\\/g, '/').toLowerCase() === target.path.replace(/\\/g, '/').toLowerCase()) {
          // Same document: only attempt to reveal when a slug is present, else report it as missing.
          if (target.slug !== null) {
            if (!this.revealHeading(target.slug)) {
              this.showMessage('No heading "#' + target.slug + '" in this document.');
            }
          } else {
            // No anchor to reveal, so keep the current document open and do nothing further.
            return;
          }
        } else {
          // A different file: open it from the vault first.
          await this.openNoteFromVault(target.path);
          // Only reveal when a slug was requested and the newly opened file matches, because a failed open
          // leaves the old document in front and revealing would search the wrong one.
          if (target.slug !== null && this.fileMenu !== undefined && this.fileMenu.filePath !== null && this.fileMenu.filePath.replace(/\\/g, '/').toLowerCase() === target.path.replace(/\\/g, '/').toLowerCase()) {
            if (!this.revealHeading(target.slug)) {
              this.showMessage('No heading "#' + target.slug + '" in this document.');
            }
          } else {
            // The open failed or had no slug, so leave the current view as-is.
            return;
          }
        }
        return;
      }
      case 'web': {
        // Trusted or non-confirmed web links open directly; anything else asks first.
        if (!this.settings.general.confirmExternalLinks || this.settings.general.trustedDomains.includes(target.domain)) {
          await this.openExternalLink(target.url);
        } else {
          const choice = await this.confirmDialog.ask('This link opens ' + target.domain + ' in your browser.', { heading: 'Open External Link?', confirm: 'Open', discard: 'Always trust ' + target.domain, cancel: 'Cancel' });
          // A confirmation for an unknown domain exists because a link the user did not write can arrive in a file they were sent, and the domain is the one thing the hover card shows that the link text can lie about.
          if (choice === 'save') {
            // Open once from this prompt without changing settings.
            await this.openExternalLink(target.url);
          } else if (choice === 'discard') {
            // Trust the domain for next time, then open exactly once from this prompt.
            const next: KdocSettings = { ...this.settings, general: { ...this.settings.general, trustedDomains: [...this.settings.general.trustedDomains, target.domain] } };
            this.settings = next;
            this.settingsDialog.setSettings(next);
            this.settingsStore.save(next).catch((error: unknown): void => {
              this.showMessage('Could not save settings: ' + (error instanceof Error ? error.message : String(error)));
            });
            await this.openExternalLink(target.url);
          } else {
            // Cancelled: leave the document and its links untouched.
            return;
          }
        }
        return;
      }
      case 'mail': {
        // Mail links are handled by the same OS opener as web links.
        await this.openExternalLink(target.url);
        return;
      }
      case 'unresolved': {
        // The link could not be classified, so show the reason rather than attempting to open it.
        this.showMessage(target.reason);
        return;
      }
      case 'blocked': {
        // A blocked scheme is never opened from documents, so just report it.
        this.showMessage('Links starting "' + target.scheme + ':" are not opened from documents.');
        return;
      }
      default: {
        // Unreachable today because classifyLink exhausts every kind; kept so a new kind cannot slip through silently.
        this.showMessage('Unrecognised link.');
        return;
      }
    }
  }

  /**
   * @purpose Carries the user's caret position between editing panes when the view mode changes, ensuring the caret is preserved across view-mode switches (FR-5.6).
   * @inputs previous - The ViewMode being left.
   * @inputs next - The ViewMode being entered.
   * @inputs focused - Which pane currently holds focus ('kdoc' | 'source').
   * @outputs void.
   * @dataflow previous & next & focused -> determine pane visibility -> read selection from active pane -> convert selection using position index -> dispatch new selection to target pane.
   * @controlflow If mode unchanged, return immediately -> calculate target pane visibility -> if Source active and hiding, convert to K-Doc selection -> else if K-Doc active and hiding, convert to Source selection -> else do nothing.
   */
  private carrySelectionAcross(previous: ViewMode, next: ViewMode, focused: 'kdoc' | 'source'): void {
    // Check whether the mode is actually changing. If previous === next, return. setViewMode is re-applied after every tab mount with the mode unchanged, and carrying then would push a stale caret into a document that was just opened.
    if (previous === next) {
      // Unchanged: nothing to carry.
      return;
    } else {
      // The mode is genuinely changing, proceed to evaluate visibility.
    }

    const sourceVisible: boolean = next === 'split' || next === 'source';
    const kdocVisible: boolean = next !== 'source';

    // Check which pane holds the caret and whether that pane is about to be hidden.
    if (focused === 'source' && !sourceVisible) {
      const pmView = this.proseMirrorBinding.view;
      const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);
      const main = this.codeMirrorBinding.view.state.selection.main;
      const selection: TextSelection | null = sourceSelectionToProseMirror(index, pmView.state.doc, { anchor: main.anchor, head: main.head });

      // Check whether the Source caret could be placed in the rendered document.
      if (selection === null) {
        // It could not: leave the K-Doc caret as it was, since guessing would put it where the user was not.
        return;
      } else {
        // It could: move the rendered pane's caret there and bring it into view.
        pmView.dispatch(pmView.state.tr.setSelection(selection).scrollIntoView());
      }
    } else if (focused === 'kdoc' && !kdocVisible) {
      const pmView = this.proseMirrorBinding.view;
      const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);
      const pmSelection = pmView.state.selection;
      const carried: { anchor: number; head: number } | null = proseMirrorSelectionToSource(index, { anchor: pmSelection.anchor, head: pmSelection.head }, this.documentSession.snapshot.text.length);

      // Check whether the K-Doc caret could be placed in the source text.
      if (carried === null) {
        // It could not: leave the Source caret as it was.
        return;
      } else {
        // It could: move the Source pane's caret there and bring it into view.
        this.codeMirrorBinding.view.dispatch({ selection: { anchor: carried.anchor, head: carried.head }, scrollIntoView: true });
      }
    } else {
      // Nothing to carry: the pane holding the caret stays on screen, so there is nothing to carry — in split both panes keep their own carets.
    }
  }

  /**
   * @purpose Switches the visible editor layout mode, updating pane visibility, segmented button states, and transferring focus if the active edit lock holder is hidden.
   * @inputs mode - Target ViewMode ('kdoc' | 'split' | 'source').
   * @outputs void.
   * @dataflow mode -> pane.hidden flags, button aria-pressed attributes, session focus transfer if hidden, refreshStatusBar.
   * @controlflow Check view mode -> update hidden attributes on kdocPane and sourcePane -> update aria-pressed on segmented buttons -> check if currently focused pane is now hidden and transfer focus to visible pane -> update currentViewMode -> refresh status bar.
   */
  setViewMode(mode: ViewMode): void {
    // The mode being left, so the caret is only carried on a real change of mode.
    const previousMode: ViewMode = this.currentViewMode;
    this.currentViewMode = mode;

    // Check the target view mode and set hidden attributes on editor panes accordingly.
    if (mode === 'kdoc') {
      // In K-Doc mode, show the ProseMirror pane and hide the CodeMirror source pane.
      this.kdocPane.hidden = false;
      this.sourcePane.hidden = true;
    } else if (mode === 'source') {
      // In Source mode, hide the ProseMirror pane and show the CodeMirror source pane.
      this.kdocPane.hidden = true;
      this.sourcePane.hidden = false;
    } else {
      // In Split mode, show both editor panes side-by-side.
      this.kdocPane.hidden = false;
      this.sourcePane.hidden = false;
    }

    // The divider has nothing to divide when a single pane fills the row, and leaving it on screen
    // would offer a control that cannot do anything.
    this.splitDividerElement.hidden = mode !== 'split';

    // Check whether the view mode is split or a single-pane mode.
    if (mode === 'split') {
      // In Split mode, check if split divider is installed.
      if (this.splitDivider !== undefined) {
        // Split divider is active: re-apply proportional flex styles so both panes honour the divider ratio.
        this.splitDivider.setRatio(this.splitDivider.ratio);
      } else {
        // Divider not yet installed during early construction: sizing will be applied upon installation.
      }
    } else {
      // In non-split modes (K-Doc or Source), clear inline flex on both panes
      // so stylesheet rules take over and the visible pane occupies all available width.
      this.kdocPane.style.flex = '';
      this.sourcePane.style.flex = '';
    }

    // A locked document (FR-6.7) stays read-only in every mode.
    this.proseMirrorBinding.setEditable(!this.locked);
    this.codeMirrorBinding.setEditable(!this.locked);

    // Update aria-pressed attributes on segmented mode buttons to reflect active selection.
    this.kdocButton.setAttribute('aria-pressed', mode === 'kdoc' ? 'true' : 'false');
    this.splitButton.setAttribute('aria-pressed', mode === 'split' ? 'true' : 'false');
    this.sourceButton.setAttribute('aria-pressed', mode === 'source' ? 'true' : 'false');

    // CRITICAL FOCUS TRANSFER ON PANE VISIBILITY CHANGE:
    // K-Doc enforces single-pane edit locking (FR-3.1), where DocumentSession.applyTree and applyText
    // strictly throw errors when invoked by an unfocused pane. If the user switches view mode such that
    // the currently focused pane becomes hidden (for example, switching to 'kdoc' while 'source' holds
    // the edit lock, or switching to 'source' while 'kdoc' holds the lock), leaving the lock on the hidden
    // pane would cause every subsequent keystroke in the visible pane to throw an unhandled error.
    // Therefore, whenever the active edit lock resides on a newly hidden pane, focus MUST be explicitly
    // transferred to the remaining visible pane so that the edit lock moves with user visibility.
    const currentFocusedPane = this.documentSession.snapshot.focusedPane;

    // Carry the caret into the pane being revealed before focus moves there, so focus arrives at the
    // place the user was rather than wherever that pane's caret happened to be left (FR-5.6).
    this.carrySelectionAcross(previousMode, mode, currentFocusedPane);
    if (mode === 'kdoc' && currentFocusedPane === 'source') {
      // Source pane is now hidden but held the edit lock: transfer focus to visible ProseMirror pane.
      this.proseMirrorBinding.focus();
    } else if (mode === 'source' && currentFocusedPane === 'kdoc') {
      // K-Doc pane is now hidden but held the edit lock: transfer focus to visible CodeMirror pane.
      this.codeMirrorBinding.focus();
    } else {
      // In split mode or when the focused pane remains visible: no lock transfer required.
    }

    // Update status bar to display the newly active view mode.
    this.refreshStatusBar();
    // The view mode is part of the arrangement a launch puts back (FR-6.10).
    this.restartSessionSave();

    // Guarded because the status bar refreshes during construction, before the tab strip exists.
    if (this.tabBar !== undefined) {
      // Installed: the dirty dot and the title both live on the tab.
      this.tabBar.refresh();
    } else {
      // Still constructing.
    }
  }

  /**
   * @purpose Cleans up all resources held by the shell, destroying editor bindings, unsubscribing from session events, destroying the theme controller, and emptying the mount element.
   * @inputs void.
   * @outputs void.
   * @dataflow Disposes session subscription -> destroys ProseMirror & CodeMirror bindings -> destroys theme controller -> empties mount.
   * @controlflow Check destroyed guard (return early if already destroyed) -> mark destroyed = true -> unsubscribe session listener -> destroy bindings -> destroy theme controller -> clear mount children.
   */
  /**
   * @purpose Repaints the review pane from the controller's state.
   * @inputs None; reads the controller's changes, tracking flag and markup mode, plus the active selection.
   * @outputs void; the pane re-renders.
   * @dataflow controller state + activeChangeId -> reviewPane.render.
   * @controlflow Straight-line; called after every action that could change what the pane should show.
   *   The pane is handed the controller's state on every call rather than keeping its own, so the two
   *   can never disagree about whether tracking is on.
   */
  /**
   * @purpose Rebuilds the original-document overlay from the current snapshot and pending changes.
   * @inputs None; reads this.documentSession.snapshot.text and this.changesController state.
   * @outputs void — sets this.originalBody.innerHTML and toggles this.originalOverlay.hidden.
   * @dataflow Snapshot text → originalText() projected string → parseMarkdown().root → renderFragment → overlay body HTML.
   * @controlflow If the mode is not 'original', hide the overlay and return; otherwise render the projected original into the overlay body.
   */
  private refreshOriginalOverlay(): void {
    // Every other markup mode decorates the live document, so the overlay must be out of the way for them.
    if (this.changesController.mode !== 'original') {
      this.originalOverlay.hidden = true;
      return;
    }

    // Original is a different text, not a decoration of this one — it is the document with every pending change rejected, which is why it needs a surface of its own rather than a mark.
    const projected = originalText(this.documentSession.snapshot.text, this.changesController.changes());
    // The markup comes from K-Doc's own renderer over text the editor already holds — the same path the export and preview take; the alternative would be re-implementing the renderer against the DOM.
    this.originalBody.innerHTML = renderFragment(parseMarkdown(projected).root);
    this.originalOverlay.hidden = false;
  }

  private refreshReviewPane(): void {
    this.reviewPane.render(
      this.changesController.changes(),
      this.activeChangeId,
      this.changesController.tracking,
      this.changesController.mode,
    );
    this.refreshOriginalOverlay();
  }

  /**
   * @purpose Coalesces leader-line redraw requests into a single animation frame so rapid scroll events do not force one paint per event.
   * @inputs none - Reads this.leaderFrame to decide whether a redraw is already queued and, if not, queues one on the browser's next frame.
   * @outputs none - Mutates this.leaderFrame with a pending request-id; the actual draw happens later in refreshLeaderLine via the rAF callback.
   * @dataflow scroll / resize / on-span events -> scheduleLeaderLine -> (when idle) window.requestAnimationFrame(callback) stored on this.leaderFrame.
   * @controlflow If leaderFrame is already non-null, return immediately; otherwise store a new request-id and clear it inside the frame callback before invoking refreshLeaderLine.
   */
  /**
   * @purpose Paints find matches into both the CodeMirror and ProseMirror panes plus the Source gutter (FR-9.2).
   * @inputs matches - readonly SearchMatch[] describing each hit's character range; activeIndex - index into matches of the currently highlighted hit.
   * @outputs void - Mutates both editor views' search state and the match scrollbar's ticks in place.
   * @dataflow incoming matches + activeIndex -> CodeMirror setSearchMatchesIn (offset-indexed) -> matchScrollbar.render against source text length -> ProseMirror index built from root + pmDoc -> offsetRangeToPositions per match -> SearchRange[] with mappedActive -> setSearchRanges; both panes painted regardless of view mode.
   * @controlflow Paint CodeMirror first using direct offsets, then the gutter measured against source length, then map each match through the position index pushing only non-null ranges while tracking which pushed slot is active because dropped matches shift later indices; finally apply the mapped list to ProseMirror with the corrected active index.
   */
  private paintSearchMatches(matches: readonly SearchMatch[], activeIndex: number): void {
    // Both panes are painted regardless of the current view mode — skipping the hidden pane would leave a stale set that reappears the instant the user switches back to it.

    // The CodeMirror document is already indexed by source character offsets, exactly what the search produced, so no translation is needed — pass the matches through directly.
    setSearchMatchesIn(this.codeMirrorBinding.view, { matches, activeIndex });

    // The gutter strip is measured against the source text because that is precisely what the offsets index; its length normalises every tick's position along the document.
    this.matchScrollbar.render(matches, activeIndex, this.documentSession.snapshot.text.length);

    // Map into ProseMirror: build a character-offset to node-position index from the snapshot root and the live ProseMirror document so match ranges can be translated into valid doc positions.
    const pmView = this.proseMirrorBinding.view;
    const index = buildPositionIndex(this.documentSession.snapshot.document.root, pmView.state.doc);

    // Collect only the matches that resolve to real ProseMirror ranges; unmappable ones are dropped and must not occupy a slot in this list.
    const ranges: SearchRange[] = [];

    // The active match's index can shift once unmappable matches are removed, so track which pushed position corresponds to the incoming activeIndex rather than reusing it directly — dropping earlier matches shifts every later index.
    let mappedActive = -1;

    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      // Possibly undefined under noUncheckedIndexedAccess; a hole has no range to map, so skip it without consuming an active slot.
      if (match === undefined) {
        continue;
      } else {
        // A real match: attempt to translate its source offset range into ProseMirror positions below.
      }

      const positions = offsetRangeToPositions(index, match.start, match.end);
      if (positions === null) {
        // The range is collapsed or unmappable — offsetRangeToPositions refuses a collapsed range by design, so drop it and do not advance mappedActive against this slot.
        continue;
      } else {
        // A resolvable range: record whether this pushed slot is the active match before pushing, because dropping earlier matches would otherwise shift the active index into the wrong highlight.
        if (i === activeIndex) {
          // This is the currently highlighted match: capture its future position in the mapped list so it stays highlighted after unmappable matches are removed.
          mappedActive = ranges.length;
        } else {
          // Not the active match: leave mappedActive untouched for this iteration.
        }

        // Push the translated range into the mapped list at the slot just accounted for above.
        ranges.push({ from: positions.from, to: positions.to });
      }
    }

    // Apply the translated ranges with the corrected active index so the highlighted match lines up with what the find panel reports.
    setSearchRanges(pmView, { ranges, activeIndex: mappedActive });
  }

  private scheduleLeaderLine(): void {
    // A redraw is already queued for the next frame; scheduling another would run the same geometry twice and waste a paint.
    if (this.leaderFrame !== null) {
      return;
    }

    // No draw pending: register one with requestAnimationFrame, clearing this.leaderFrame inside the callback so the next event can queue again, then performing the actual measurement + render in refreshLeaderLine.
    this.leaderFrame = window.requestAnimationFrame(() => {
      this.leaderFrame = null;
      this.refreshLeaderLine();

      // Re-arm while a comment is selected. Scroll and resize are not the only ways the geometry moves --
      // a CodeMirror re-render, a divider drag and a late-loading font all shift it without firing anything
      // this class listens for, and a leader line pointing at where the text used to be is worse than none.
      // The loop costs a frame only while a card is active, which is the one moment the line has to be right.
      if (this.rightSidebar.element.querySelector('.kdoc-comment-card-active') !== null) {
        this.scheduleLeaderLine();
      } else {
        // No card is selected, so there is no line to keep up to date and the loop stops until an event restarts it.
      }
    });
  }

  /**
   * @purpose Measures the active comment card and its anchored text, then draws (or clears) the leader-line connector joining them.
   * @inputs none - Reads this.rightSidebar for the active card, this.currentViewMode to pick a pane, this.panesElement as the coordinate container, and this.leaderLayer to emit geometry.
   * @outputs none - Calls this.leaderLayer.render with either three container-relative points or null (which clears any drawn line).
   * @dataflow DOM nodes -> getClientRects / getBoundingClientRect viewport rects -> leaderPath arithmetic -> LeaderLayer.render writes polyline points.
   * @controlflow Locate active card; bail when absent or thread-less; pick the rightmost visible pane and its anchor element; bail when unmeasured; take the last client rect for a multi-line highlight; feed both rects plus container to leaderPath and render the result.
   */
  private refreshLeaderLine(): void {
    // The active comment card is what identifies which selection should be joined; without it there is no selected text, so nothing to connect.
    const card = this.rightSidebar.element.querySelector('.kdoc-comment-card-active');

    // No active card means nothing is currently selected: the line describes a selection, and with none present we clear any stale connector rather than drawing into empty space.
    if (card === null) {
      this.leaderLayer.render(null);
      return;
    }

    // The thread id links the card to its anchored span in either pane; without it there is no way to find the text the comment refers to.
    const threadId = card.getAttribute('data-thread-id');

    // A missing data-thread-id means the card cannot be matched to any anchor, so we render nothing instead of guessing at a position.
    if (threadId === null) {
      this.leaderLayer.render(null);
      return;
    }

    // Anchor in whichever pane is actually visible: when viewing source or split, the marked text lives in the Source pane; otherwise it lives in the K-Doc pane. This encodes the rightmost-visible-pane rule — the line runs rightward toward the panel, and a line starting from the K-Doc pane would have to cross over the Source pane to reach the card, which reads as pointing at the wrong text.
    const anchorEl =
      this.currentViewMode === 'source' || this.currentViewMode === 'split'
        ? this.sourcePane.querySelector(`[data-thread-id="${threadId}"]`)
        : this.kdocPane.querySelector('.kdoc-commented-active');

    // The thread is anchored somewhere that is not currently painted (e.g. scrolled out of view or in a hidden pane), so there is no geometry to join and we clear the line.
    if (anchorEl === null) {
      this.leaderLayer.render(null);
      return;
    }

    // Measure with getClientRects() rather than boundingClientRect(): a highlight wrapping across lines yields one rect per physical line, and we want the connector to leave from where the text ends — so take the last rect instead of the widest row's right edge.
    const rects = anchorEl.getClientRects();

    // Reduce the per-line rects to either the final one (the end of a wrapped highlight) or null when there are none at all; guarding against indexing an empty array avoids reading undefined.
    const anchorRect = rects.length > 0 ? rects[rects.length - 1] : undefined;

    // A measured rect exists: leaderPath takes the structural Rect and getClientRects returns DOMRect, which satisfies Rect structurally (identical left/top/right/bottom members), so no conversion is needed — feed both viewport rectangles straight through.
    if (anchorRect !== undefined) {
      this.leaderLayer.render(leaderPath(anchorRect, card.getBoundingClientRect(), this.panesElement.getBoundingClientRect()));
    } else {
      // No client rects were produced for the anchor element: there is nothing to join, so clear any stale line rather than drawing into empty space.
      this.leaderLayer.render(null);
    }
  }

  /**
   * Cycles the document's save encoding to the next value in ENCODING_CYCLE and tells the user what comes next.
   *
   * @purpose Advances the file-menu encoding by one step (with wraparound) and surfaces it as a "next save" message.
   * @inputs void.
   * @outputs void.
   * @dataflow this.fileMenu.encoding -> index in ENCODING_CYCLE -> next value with wraparound -> fileMenu.setEncoding -> showMessage.
   * @controlflow Find current encoding's index -> if absent fall back to utf-8 -> compute next index with modulo wraparound -> bounds-guard the read -> setEncoding(next) -> report "Next save: next".
   */
  private cycleEncoding(): void {
    // Read the encoding the file menu currently reports as what the next save will write.
    const current = this.fileMenu.encoding;

    // Locate the current value in the cycle so we can advance from it.
    const currentIndex = ENCODING_CYCLE.indexOf(current);

    // Determine where to go next. When the current value is not in the cycle, start from utf-8: an unknown
    // value can only come from a hand-edited or newer file listing an encoding K-Doc does not yet know about,
    // and UTF-8 is the safe landing place rather than guessing at something exotic.
    let next: string | undefined;
    if (currentIndex === -1) {
      // Current encoding absent from the cycle: land on the first entry (utf-8) as the safe default.
      next = ENCODING_CYCLE[0];
    } else {
      // Current encoding present in the cycle: advance one step with wraparound at the end.
      const nextIndex = (currentIndex + 1) % ENCODING_CYCLE.length;
      next = ENCODING_CYCLE[nextIndex];
    }

    // Guard the indexed read so an out-of-range index can never write undefined back to disk on save.
    if (next !== undefined) {
      // Record what the next save should write, then tell the user before anything is persisted.
      this.fileMenu.setEncoding(next);
      // Nothing has been written yet: "Next save" is truthful, whereas implying the file changed would be a lie.
      this.showMessage(`Next save: ${next}`);
    } else {
      // Read yielded nothing despite a computed index: refuse to overwrite with an unknown encoding.
    }
  }

  destroy(): void {
    // Check if the shell instance has already been destroyed.
    // Idempotent teardown prevents errors during duplicate unmount cycles.
    if (this.destroyed) {
      // Already destroyed: return immediately.
      return;
    } else {
      // Active instance: proceed with destruction.
      this.destroyed = true;
      // The theme folder watch is the app's, not a document's, so it ends here.
      this.stopThemeWatch?.();
      this.stopThemeWatch = null;
    }

    // Leave Zen mode so the window does not stay full screen without its chrome.
    this.zenMode.destroy();
    // Likewise a presentation in progress.
    this.presentation.destroy();

    // Check whether a snapshot timer is running.
    if (this.snapshotTimer !== null) {
      // Running: stop it, so a torn-down shell takes no more snapshots.
      window.clearInterval(this.snapshotTimer.id);
      this.snapshotTimer = null;
    } else {
      // No timer to stop.
    }

    // Check if an active session change listener subscription exists.
    if (this.unsubscribeSession !== null) {
      // Unsubscribe from session change notifications.
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    } else {
      // No active subscription to dispose.
    }

    this.fileMenu.destroy();
    this.fidelity.destroy();
    this.lint.destroy();
    // Flushed before teardown so a clean shutdown still leaves the journal current: destroy() runs on
    // paths that are not always a save, and an out-of-date journal is worse than none.
    this.recovery.flush();
    this.scrollSync.destroy();
    this.externalWatch.destroy();
    this.autosave.destroy();
    this.recovery.destroy();
    this.tabBar.destroy();
    document.removeEventListener('keydown', this.handleTabKey);
    this.keymapService.destroy();
    this.keyHint.destroy();
    this.appMenuBar.destroy();
    this.ribbon.destroy();
    this.ribbonDialog.destroy();
    this.graphDialog.destroy();
    this.pluginsPanel.destroy();
    this.pluginHost.destroy();
    this.settingsDialog.destroy();
    this.keyboardShortcutsDialog.destroy();
    this.slashMenu.destroy();
    this.contextMenu.destroy();
    this.spellDialog.destroy();
    this.spellCheck.destroy();
    this.statisticsDialog.destroy();
    this.aboutDialog.destroy();
    this.sidebar.destroy();
    // Two hosts torn down together because they are created together; destroying only one would leak the other's listeners and DOM node.
    this.rightSidebar.destroy();
    this.paneReserve.destroy();
    this.windowControls.destroy();

    // Remove the scroll listener registered in construction so it stops scheduling redraws after teardown.
    this.panesElement.removeEventListener('scroll', this.handleLeaderScroll, { capture: true });

    // Remove the resize listener registered in construction against window.
    window.removeEventListener('resize', this.handleLeaderResize);

    // If a redraw is still pending when we tear down, cancel it so refreshLeaderLine cannot run after the layer has been destroyed; otherwise there is nothing to cancel and we proceed straight to destroying the layer.
    if (this.leaderFrame !== null) {
      window.cancelAnimationFrame(this.leaderFrame);
    } else {
      // No frame is queued, so there is no pending redraw to cancel.
    }

    // Detach the SVG layer from the DOM; destroy() handles both attached and never-attached cases internally.
    this.leaderLayer.destroy();
    // Detach the gutter overlay so nothing remains on screen after the shell is torn down.
    this.matchScrollbar.destroy();
    this.fileDrop.destroy();
    this.spellService.destroy();
    this.languagePicker.destroy();
    this.sizePicker.destroy();
    this.listPicker.destroy();
    this.stylesGallery.destroy();
    this.promptDialog.destroy();
    this.mergeDialog.destroy();
    this.filesPanel.destroy();
    this.linkHoverCard.destroy();
    this.backlinksPanel.destroy();
    this.historyPanel.destroy();
    this.metadataPanel.destroy();
    this.problemsPanel.destroy();
    this.searchPanel.destroy();
    this.tagsPanel.destroy();
    this.vault.destroy();
    this.recentFilesDialog.destroy();
    this.pasteSpecialDialog.destroy();
    this.pasteOptionsPopup.destroy();
    this.pageSetupDialog.destroy();
    this.imageDialog.destroy();
    this.popupMenu.destroy();
    this.commandPalette.destroy();
    this.shellElement.removeEventListener('wheel', this.handleZoomWheel);
    this.linkDialog.destroy();
    this.findPanel.destroy();
    this.splitDivider.destroy();
    this.confirmDialog.destroy();
    // Check whether the outline pane was installed before teardown reached this point.
    if (this.outlinePane === null) {
      // Never installed: nothing to destroy.
    } else {
      // Installed: tear it down.
      this.outlinePane.destroy();
    }
    // Check for a pending status message timer and clear it, so a timer cannot fire against a
    // detached element after teardown.
    if (this.messageTimer !== null) {
      window.clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }

    // Tear down navigation before the bindings it reads from.
    this.navigation?.destroy();
    this.quickOpenDialog?.destroy();
    this.goToDialog?.destroy();
    this.breadcrumbBar?.destroy();

    // Destroy editor view bindings to release DOM listeners and internal editor states.
    this.proseMirrorBinding.destroy();
    this.codeMirrorBinding.destroy();

    // Destroy the theme controller to remove window media query listeners and theme style elements.
    this.themeMenu.destroy();
    this.themeController.destroy();

    // Empty the mount container element.
    this.mount.replaceChildren();
  }

  /**
   * @purpose Cycles the active theme mode between system, light, and dark modes.
   * @inputs void.
   * @outputs void.
   * @dataflow this.themeMode transition -> this.themeController.setMode -> this.themeButton.textContent update.
   * @controlflow Evaluate current themeMode -> advance to next mode -> invoke setMode -> update button label text.
   */
  private cycleTheme(): void {
    // Check the current theme mode to determine the next mode in the cycle.
    // The theme button cycles system -> light -> dark -> system.
    let nextMode: ThemeMode;
    if (this.themeMode === 'system') {
      // Current mode is system: cycle to light mode.
      nextMode = 'light';
    } else if (this.themeMode === 'light') {
      // Current mode is light: cycle to dark mode.
      nextMode = 'dark';
    } else {
      // Current mode is dark: cycle back to system mode.
      nextMode = 'system';
    }

    // Saved like any other setting, so the choice survives a restart.
    this.chooseAppearance({ theme: nextMode });
  }

  /**
   * @purpose Applies and saves a change to the light/dark mode or the built-in UI theme picked from the theme menu.
   * @inputs patch - The appearance fields to change: `theme`, `uiTheme`, or both.
   * @outputs void.
   * @dataflow patch -> next KdocSettings -> this.settings, the settings dialog's copy, applySettings (theme controller + button label) -> settingsStore.save.
   * @controlflow Build next settings -> sync dialog -> apply -> save; a failed save is reported in the status bar.
   */
  private chooseAppearance(patch: Partial<Pick<AppearanceSettings, 'theme' | 'uiTheme'>>): void {
    const next: KdocSettings = { ...this.settings, appearance: { ...this.settings.appearance, ...patch } };
    this.settings = next;
    // The settings dialog keeps its own copy; without this its next change would write the old theme back.
    this.settingsDialog.setSettings(next);
    this.applySettings();
    this.settingsStore.save(next).catch((error: unknown): void => {
      this.showMessage(`Could not save settings: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * @purpose Formats a ThemeMode into a human-readable title-cased button label string.
   * @inputs mode - The active ThemeMode ('system' | 'light' | 'dark').
   * @outputs string - The formatted title-cased label string.
   * @dataflow mode -> capitalized string formatting.
   * @controlflow Capitalize first character of mode string -> return formatted string.
   */
  private formatThemeMode(mode: ThemeMode): string {
    // Format the mode string with initial uppercase letter.
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  /**
   * @purpose Displays a transient error or status message in the status bar's live region.
   * @inputs message - The string message to display; isError - Optional boolean indicating whether message is an error.
   * @outputs void.
   * @dataflow message -> this.statusMessage.textContent, with error styling when error and a 6000ms timer to clear it.
   * @controlflow Evaluate error status -> apply or remove error styling -> set text -> clear previous timer -> when non-empty, schedule clear.
   */
  private showMessage(message: string, isError: boolean = false): void {
    // Check whether the message represents an error state via explicit flag or error keywords.
    if (isError || /\b(error|failed|could not|cannot)\b/i.test(message)) {
      // Message is an error: add error class for emissive red styling.
      this.statusMessage.classList.add('error');
    } else {
      // Message is informational or empty: remove error class to preserve muted styling.
      this.statusMessage.classList.remove('error');
    }

    this.statusMessage.textContent = message;

    // Clearing the previous timer matters because two errors in quick succession
    // would otherwise have the first one's timer wipe the second one's message early.
    if (this.messageTimer !== null) {
      // Active timer exists: cancel it before setting a new timer.
      window.clearTimeout(this.messageTimer);
      this.messageTimer = null;
    } else {
      // No active timer to clear.
    }

    // Check whether there is a message to clear later; an empty message needs no timer.
    if (message !== '') {
      // Non-empty message: schedule clearing text and error class after 6000ms.
      this.messageTimer = window.setTimeout((): void => {
        this.statusMessage.textContent = '';
        this.statusMessage.classList.remove('error');
        this.messageTimer = null;
      }, 6000);
    } else {
      // Empty message: no timer needed.
    }
  }

  /**
   * @purpose Updates status bar readouts from the authoritative DocumentSession snapshot and the ProseMirror document tree.
   * @inputs void.
   * @outputs void.
   * @dataflow DocumentSession snapshot & ProseMirror view doc -> compute dirty status, word count, reading time, focused pane, and view mode -> update status bar DOM text.
   * @controlflow Read session snapshot -> update dirty dot class and Modified/Saved label -> compute word count from ProseMirror doc text -> calculate reading time -> format focused pane and view mode -> update DOM textContent.
   */
  private refreshStatusBar(): void {
    const snapshot = this.documentSession.snapshot;

    this.statusFileName.textContent = this.fileMenu.fileName;

    // Update dirty state indicator dot and text label.
    if (snapshot.dirty) {
      // Document contains unsaved modifications.
      this.statusDot.classList.add('dirty');
      this.statusDirtyText.textContent = 'Modified';
    } else {
      // Document matches clean/saved state.
      this.statusDot.classList.remove('dirty');
      this.statusDirtyText.textContent = 'Saved';
    }

    // One analyser rather than a second hand-rolled count here: the dialog and the status bar
    // disagreeing about how many words a document has would be worse than either being wrong.
    const stats = analyzeText(this.documentSession.snapshot.text);

    this.statusWordCount.textContent = `${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'}`;
    this.statusEncoding.textContent = this.fileMenu.encoding;
    this.statusCharCount.textContent = `${stats.charactersWithSpaces.toLocaleString()} chars`;
    this.statusParagraphCount.textContent = `${stats.paragraphs.toLocaleString()} ${stats.paragraphs === 1 ? 'para' : 'paras'}`;
    this.statusReadingTime.textContent = `${stats.readingMinutes} min read`;

    // Format the active focused pane name.
    if (snapshot.focusedPane === 'kdoc') {
      this.statusFocus.textContent = 'K-Doc';
    } else {
      this.statusFocus.textContent = 'Source';
    }
    // Which pane has focus only matters in Split; with one pane showing it would repeat the view's name.
    this.statusFocus.hidden = this.currentViewMode !== 'split';

    // Format the active view mode label.
    if (this.currentViewMode === 'kdoc') {
      this.statusViewMode.textContent = 'K-Doc';
    } else if (this.currentViewMode === 'split') {
      this.statusViewMode.textContent = 'Split';
    } else {
      this.statusViewMode.textContent = 'Source';
    }
  }
}
