/**
 * @file index.ts
 * @purpose The single public API surface of the @k-doc/editor package, re-exporting the ProseMirror schema and bidirectional mdast converters.
 *
 *   @k-doc/editor adapts K-Doc's document model to concrete editor engines. The ProseMirror conversion
 *   layer is deliberately DOM-free — it uses only `prosemirror-model`, never `prosemirror-view` — so
 *   the hardest and most correctness-critical part of the K-Doc pane is testable in a bare Node process.
 *   The schema and the two converters form the triple DESIGN.md §7 requires and must always change together:
 *   a node the schema can express but a converter cannot restore would silently break the round-trip guarantee.
 *   Anything mdast can express that the schema does not model richly is carried by the `unknownBlock` and
 *   `unknownInline` atoms holding the original node verbatim, so nothing is dropped (FR-4.4). The one deliberate
 *   asymmetry is the empty document: ProseMirror's `doc` requires `block+` and cannot represent an empty document,
 *   so an empty mdast root becomes a document with one empty paragraph. The conversion layer (`schema`,
 *   `mdastToProseMirror`, `proseMirrorToMdast`) is DOM-free and testable in a bare Node process, whereas
 *   `ProseMirrorBinding` is the one part of this package that touches the DOM and therefore the one part that
 *   needs a browser-like environment to test. The binding exists to stop the session and the view fighting
 *   each other: a view edit must reach the session without the session's response bouncing back, and a
 *   session-initiated change (undo, redo, external reload) must reach the view without being mistaken for
 *   a fresh user edit.
 *
 * @inputs mdast Root AST nodes, ProseMirror doc Nodes conforming to kdocSchema, and optional Schema overrides.
 * @outputs Unified ProseMirror schema (`kdocSchema`), AST conversion functions (`mdastToProseMirror`, `proseMirrorToMdast`), and schema union types (`KdocNodeName`, `KdocMarkName`).
 * @functions
 *   - mdastToProseMirror: Converts an mdast Root AST tree into a ProseMirror document Node.
 *   - proseMirrorToMdast: Converts a ProseMirror document Node into an mdast Root AST tree.
 *   - ProseMirrorBinding: Live wiring between a DocumentSession and a ProseMirror EditorView.
 * @dataflow mdast Root ⇄ (mdastToProseMirror / proseMirrorToMdast via kdocSchema) ⇄ ProseMirror doc Node.
 * @controlflow Re-export barrel only; all execution is delegated to the submodules.
 * @version 24
 * @date 2026-09-18
 */

export type { KdocNodeName, KdocMarkName } from './prosemirror/schema.js';

export { kdocSchema } from './prosemirror/schema.js';

export { mdastToProseMirror } from './prosemirror/from-mdast.js';

export { proseMirrorToMdast } from './prosemirror/to-mdast.js';

export type { ProseMirrorBindingOptions } from './prosemirror/binding.js';

export { ProseMirrorBinding } from './prosemirror/binding.js';

export type { CodeMirrorBindingOptions } from './codemirror/binding.js';

export { CodeMirrorBinding } from './codemirror/binding.js';

export {
  createSourceGutterExtensions,
  sourceGutterTheme,
  SOURCE_GUTTER_CLASS,
} from './codemirror/source-gutters.js';

export type { CodeMirrorKeymapOptions } from './codemirror/keymap.js';

export { createSourceKeymap } from './codemirror/keymap.js';

export type { KdocMark, ListKind } from './prosemirror/commands.js';

export {
  isMarkActive,
  isBlockActive,
  toggleKdocMark,
  clearFormatting,
  setParagraph,
  setHeading,
  setCodeBlock,
  setBlockAlignment,
  toggleBlockquote,
  toggleList,
  toggleTask,
  insertThematicBreak,
} from './prosemirror/commands.js';

export type { LinkAttrs, LinkRange } from './prosemirror/link.js';

export { linkAt, activeLink, canLink, setLink, removeLink } from './prosemirror/link.js';

export type { ColumnAlign, TableContext } from './prosemirror/table-query.js';

export { tableAt, isInTable, tableAlign, columnCountOf } from './prosemirror/table-query.js';

export {
  insertTable,
  deleteTable,
  addRowBefore,
  addRowAfter,
  deleteRow,
} from './prosemirror/table.js';

export {
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  setColumnAlign,
  goToNextCell,
} from './prosemirror/table-columns.js';

export type { TopBlock } from './prosemirror/structure.js';

export {
  topBlockAt,
  moveBlockUp,
  moveBlockDown,
  headingLevelAt,
  promoteHeading,
  demoteHeading,
} from './prosemirror/structure.js';

export type { KdocInputRulesOptions } from './prosemirror/input-rules.js';

export { markInputRule, createKdocInputRules } from './prosemirror/input-rules.js';

export type { KdocKeymapOptions } from './prosemirror/keymap.js';

export { createKdocKeymap, HOST_OWNED_KEYS } from './prosemirror/keymap.js';

export type { WordSpan } from './prosemirror/spell-scan.js';

export {
  SKIPPED_NODE_TYPES,
  SKIPPED_MARK_TYPES,
  isCheckableWord,
  wordsInText,
  scanDocument,
  scanState,
} from './prosemirror/spell-scan.js';

export type { SpellPluginState } from './prosemirror/spell-plugin.js';

export {
  SPELL_DECORATION_CLASS,
  SPELL_STYLES,
  spellPluginKey,
  createSpellPlugin,
  setMisspellings,
  misspellingAt,
  misspellingsIn,
} from './prosemirror/spell-plugin.js';

export type { CommentPluginState } from './prosemirror/comment-plugin.js';

export {
  createCommentPlugin,
  setCommentSpans,
  setActiveThread,
  commentsAt,
  activeThreadId,
  commentPluginKey,
  COMMENT_DECORATION_CLASS,
  COMMENT_RESOLVED_CLASS,
  COMMENT_ACTIVE_CLASS,
  COMMENT_STYLES,
} from './prosemirror/comment-plugin.js';

export {
  commentMarks,
  commentSpanTheme,
  setCommentSpansIn,
  commentMarksField,
  setCommentSpansEffect,
  CM_COMMENT_CLASS,
  CM_COMMENT_RESOLVED_CLASS,
} from './codemirror/comment-marks.js';

export type { ChangePluginState } from './prosemirror/change-plugin.js';
export {
  createChangePlugin,
  setChangeSpans,
  changesAt,
  changePluginKey,
  CHANGE_INSERT_CLASS,
  CHANGE_DELETE_CLASS,
  CHANGE_STYLES,
} from './prosemirror/change-plugin.js';

export {
  changeMarks,
  changeSpanTheme,
  setChangeSpansIn,
  changeMarksField,
  setChangeSpansEffect,
  CM_CHANGE_INSERT_CLASS,
  CM_CHANGE_DELETE_CLASS,
} from './codemirror/change-marks.js';

export type { ChangeBarMeta } from './prosemirror/change-bar-plugin.js';
export {
  createChangeBarPlugin,
  setChangeBarPositions,
  changeBarPluginKey,
  PM_CHANGE_BAR_CLASS,
} from './prosemirror/change-bar-plugin.js';

export {
  changeBars,
  changeBarTheme,
  setChangeBarsIn,
  changeBarsField,
  setChangeBarsEffect,
  CM_CHANGE_BAR_CLASS,
} from './codemirror/change-bars.js';

export {
  createCalloutPlugin,
  calloutPluginKey,
  calloutClassFor,
  CALLOUT_CLASS,
  CALLOUT_MARKER_CLASS,
  CALLOUT_CUSTOM_CLASS,
  CALLOUT_STYLES,
} from './prosemirror/callout-plugin.js';

export {
  CALLOUT_KINDS,
  calloutMarker,
  parseCalloutMarker,
  calloutAt,
  setCallout,
  clearCallout,
  parseAlertMarker,
  alertMarkerAt,
  setCalloutWord,
} from './prosemirror/callout.js';
export type { CalloutKind, AlertMarker } from './prosemirror/callout.js';

export {
  indentList,
  outdentList,
  listDepthAt,
  applyListScheme,
  joinListWithPrevious,
} from './prosemirror/list-commands.js';
export type { ListScheme } from './prosemirror/list-commands.js';

export { indentBlock, outdentBlock } from './prosemirror/indent-commands.js';

export {
  duplicateRow,
  duplicateColumn,
  moveRow,
  moveColumn,
  moveRowTo,
  moveColumnTo,
} from './prosemirror/table-reorder.js';
export {
  createTableGripsPlugin,
  tableGripsPluginKey,
  TABLE_GRIP_ROW_CLASS,
  TABLE_GRIP_COLUMN_CLASS,
  TABLE_GRIP_STYLES,
} from './prosemirror/table-grips-plugin.js';

export { createCodeHighlightPlugin, codeHighlightPluginKey } from './prosemirror/code-highlight-plugin.js';
export { createCodeCopyPlugin, codeCopyPluginKey, CODE_COPY_CLASS, CODE_COPY_STYLES } from './prosemirror/code-copy-plugin.js';

export type { CommentNotePoint, CommentNoteMeta } from './prosemirror/comment-note-plugin.js';
export {
  createCommentNotePlugin,
  setCommentNotes,
  commentNotePluginKey,
  PM_COMMENT_NOTE_CLASS,
  COMMENT_NOTE_STYLES,
} from './prosemirror/comment-note-plugin.js';

export type { CommentNote } from './codemirror/comment-notes.js';
export {
  commentNotes,
  commentNoteTheme,
  setCommentNotesIn,
  commentNotesField,
  setCommentNotesEffect,
  CM_COMMENT_NOTE_CLASS,
} from './codemirror/comment-notes.js';

export type { SearchRange, SearchMeta } from './prosemirror/search-plugin.js';
export {
  createSearchPlugin,
  setSearchRanges,
  searchPluginKey,
  PM_SEARCH_MATCH_CLASS,
  PM_SEARCH_ACTIVE_CLASS,
  SEARCH_STYLES,
} from './prosemirror/search-plugin.js';

export type { SearchMarkState } from './codemirror/search-marks.js';
export {
  searchMarks,
  searchMarkTheme,
  setSearchMatchesIn,
  searchMarksField,
  setSearchMatchesEffect,
  CM_SEARCH_MATCH_CLASS,
  CM_SEARCH_ACTIVE_CLASS,
} from './codemirror/search-marks.js';

export type { OffsetSegment, PositionIndex } from './prosemirror/offset-map.js';

export {
  buildPositionIndex,
  offsetToPosition,
  positionToOffset,
  offsetRangeToPositions,
  mapSpansToPositions,
  mapChangeSpansToPositions,
} from './prosemirror/offset-map.js';

export { CODE_TOKEN_STYLES } from './prosemirror/code-token-styles.js';
export { RAW_SOURCE_STYLES } from './prosemirror/raw-source-styles.js';
export type { RawSource } from './prosemirror/raw-source.js';
export { rawSourceOf, withRawValue } from './prosemirror/raw-source.js';
export { RawSourceView, createRawSourceNodeViews } from './prosemirror/raw-source-view.js';
export type { CarriedSelection } from './prosemirror/selection-carry.js';
export { sourceSelectionToProseMirror, proseMirrorSelectionToSource } from './prosemirror/selection-carry.js';

export type { ImageAttrs } from './prosemirror/insert-commands.js';

export {
  insertImage,
  imageAt,
  canInsertImage,
  setCodeBlockLanguage,
  codeBlockLanguageAt,
} from './prosemirror/insert-commands.js';

export type {
  PasteMode,
  ClipboardHandlers,
  ClipboardOptions,
  RichPasteInfo,
  PastedRange,
} from './prosemirror/clipboard.js';

export {
  createClipboardHandlers,
  pasteContent,
  pasteContentAt,
  selectionAsMarkdown,
  selectionAsHtml,
  canPasteAsTable,
} from './prosemirror/clipboard.js';
export { parseDelimitedText, buildTableNode } from './prosemirror/paste-table.js';
export { parseCsvText, parseCsvRecords } from './prosemirror/csv-table.js';
export { sortTableByColumn, sortOrder, detectColumnKind, numberValue, dateValue } from './prosemirror/table-sort.js';
export type { SortDirection, ColumnKind } from './prosemirror/table-sort.js';
export { clipboardText, tableRowsAsTsv } from './prosemirror/table-tsv.js';
export { toggleHeaderRow, hasHeaderRow, headerRowIsEmpty } from './prosemirror/table-header.js';
export { setColumnWidthHint, columnWidthHintAt, parseWidthHint, MAX_WIDTH_HINT } from './prosemirror/table-width.js';
export { insertTableOfContents, refreshTableOfContents, hasTableOfContents, findTableOfContents, documentHeadings } from './prosemirror/table-of-contents.js';
export type { TocRange } from './prosemirror/table-of-contents.js';
export { sectionIndexAtCaret } from './prosemirror/section-at-caret.js';
export { createFoldPlugin, foldPluginKey, proseMirrorFoldTargets, foldTargetAt, hiddenFoldTargetAt, toggleFoldCommand, FOLD_STYLES, FOLD_TOGGLE_CLASS, FOLD_HIDDEN_CLASS, FOLDED_CLASS } from './prosemirror/fold-plugin.js';
export type { FoldStore, ProseMirrorFoldTarget } from './prosemirror/fold-plugin.js';
export { createFormatPainterPlugin, formatPainterKey, formatPainterState, marksToPaint, paintFormat, paintAtSelection, pickUpFormat, stopFormatPainter, wordRangeAt, PAINTABLE_MARKS, FORMAT_PAINTER_ACTIVE_CLASS, FORMAT_PAINTER_STYLES } from './prosemirror/format-painter.js';
export type { FormatPainterState } from './prosemirror/format-painter.js';
export { createAutocorrectPlugin, findReplacement, isInCode, ordinalSuffixFits } from './prosemirror/autocorrect.js';
export { PROSEMIRROR_BASE_STYLES } from './prosemirror/base-styles.js';
export { createSnippetPlugin, expandSnippet, expandSnippetAt, markStops, moveToStop, snippetContent, snippetPluginKey, snippetPrefixAt, SNIPPET_STOP_CLASS, SNIPPET_STYLES } from './prosemirror/snippets.js';
export type { SnippetOptions, SnippetSession, StopRange } from './prosemirror/snippets.js';
export type { AutocorrectOptions } from './prosemirror/autocorrect.js';
export { createWritingModesPlugin, focusDecorations, refreshWritingModesIn, FOCUS_DIM_CLASS, TYPEWRITER_CLASS, WRITING_MODE_STYLES } from './prosemirror/writing-modes.js';
export type { WritingModes } from './prosemirror/writing-modes.js';
export { writingModes, refreshWritingModes, sourceFocusDecorations } from './codemirror/writing-modes.js';
export { centreInContainer, scrollContainerOf } from './writing-scroll.js';
export { applySourceFolds, sourceFoldStates, sourceFoldListener, foldSyncAnnotation } from './codemirror/source-folds.js';
export type { SourceFoldTarget } from './codemirror/source-folds.js';
export { createTableEscapeWarningPlugin, escapeKindsIn, TABLE_ESCAPE_MESSAGES } from './prosemirror/table-escape-warnings.js';
export type { TableEscapeKind } from './prosemirror/table-escape-warnings.js';
export type { DelimitedTable } from './prosemirror/paste-table.js';

export { createMultiCaretExtensions } from './codemirror/multi-caret.js';

export type { MultiCaretState } from './prosemirror/multi-caret-state.js';
export {
  EMPTY_MULTI_CARET,
  normaliseCarets,
  mapCarets,
  toggleCaret,
  allCaretPositions,
  insertAtCarets,
  deleteAtCarets,
} from './prosemirror/multi-caret-state.js';

export {
  MULTI_CARET_CLASS,
  MULTI_CARET_STYLES,
  multiCaretPluginKey,
  extraCarets,
  addCaret,
  clearCarets,
  createMultiCaretPlugin,
} from './prosemirror/multi-caret-plugin.js';

export type { WordAt } from './prosemirror/multi-caret-occurrence.js';
export {
  wordAround,
  findOccurrence,
  addNextOccurrence,
} from './prosemirror/multi-caret-occurrence.js';

export type { ImageSourceLoader } from './prosemirror/image-view.js';
export type { MediaSourceLoader } from './prosemirror/media-view.js';
export { createMediaNodeView, MediaView, MEDIA_LOADING_CLASS, MEDIA_MISSING_CLASS, MEDIA_VIEW_STYLES } from './prosemirror/media-view.js';
export {
  insertFootnote,
  nextFootnoteLabel,
  createFootnoteDefinitionView,
  createFootnoteNavigationPlugin,
  FOOTNOTE_STYLES,
} from './prosemirror/footnotes.js';
export { createImageNodeView, isDirectImageSource, ImageView, IMAGE_LOADING_CLASS, IMAGE_MISSING_CLASS, IMAGE_SELECTED_CLASS, IMAGE_VIEW_STYLES, MIN_IMAGE_WIDTH } from './prosemirror/image-view.js';
export { resetImageSize, selectedImage, selectImageAt, setImageWidth, stepImageWidth } from './prosemirror/image-commands.js';
export { wikiEmbedNodes } from './prosemirror/wiki-embed-nodes.js';
export type { SelectedImage } from './prosemirror/image-commands.js';
