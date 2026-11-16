/**
 * @file index.ts
 * @purpose The single public API surface of the @k-doc/core package. Nothing outside the package
 *   may import from a deeper path, so this barrel defines the whole contract.
 *
 *   The contract in one paragraph: `parseMarkdown` never throws, because CommonMark has no parse
 *   failures and a malformed document is one the editor must still be able to open and repair.
 *   `serializeDocument` throws only on an unimplemented style policy or a genuine serialization
 *   defect. Together they satisfy `serializeDocument(parseMarkdown(x)) === x` for canonically
 *   formatted input, which is the contract the golden-corpus round-trip suite enforces. The
 *   position functions are pure lookups over an already-parsed document and throw only on a
 *   structurally invalid Point. `serializeIncremental` is the FR-4.2 path — it preserves untouched
 *   bytes exactly, and falls back to whole-document serialization (signalled by `reusedBytes === 0`)
 *   whenever position data is missing, because a correct-but-unminimal answer is always preferable
 *   to a minimal-but-wrong one. `DocumentSession` owns the text, the undo history and the edit lock,
 *   so a single undo means one thing regardless of which pane made the edit, and it throws when a
 *   pane that does not hold the lock tries to apply an edit.
 *
 * @inputs Markdown source text, KdocDocument values, parse options, MarkdownStyle configurations,
 *   DocumentSession edits and change notifications.
 * @outputs Parsed KdocDocument values, serialized Markdown strings, resolved MarkdownStyle objects,
 *   and a live DocumentSession instance.
 * @functions
 *   - parseMarkdown: Parses Markdown source into a KdocDocument; never throws.
 *   - serializeDocument: Serializes a KdocDocument into Markdown under a style.
 *   - serializeIncremental: Serializes an edited tree against the original source, rewriting only changed byte ranges.
 *   - resolveMarkdownStyle: Merges, validates, and freezes a partial style over the defaults.
 *   - nodeRange: Extracts the character offset range from a unist node's position.
 *   - offsetToPoint: Converts a 0-based character offset into a 1-based unist Point.
 *   - pointToOffset: Converts a 1-based unist Point into a 0-based character offset.
 *   - nodeAtOffset: Finds the deepest AST node and ancestor path containing an offset.
 *   - nodesInRange: Finds all AST nodes intersecting a character offset range in pre-order.
 *   - DocumentSession: The authoritative document state machine both editor panes are clients of.
 * @dataflow Markdown text → parseMarkdown → KdocDocument → serializeDocument → Markdown text; edits → DocumentSession → change events.
 * @controlflow Re-export barrel only; all execution is delegated to the submodules.
 * @version 33
 * @date 2026-09-18
 */

export type {
  FrontMatterFormat,
  FrontMatter,
  KdocRawReason,
  KdocRaw,
  KdocDocument,
  ParseOptions,
  Toml,
} from './ast/types.js';

export { DEFAULT_PARSE_OPTIONS } from './ast/types.js';

export type {
  BulletMarker,
  EmphasisMarker,
  StrongMarker,
  FenceMarker,
  ThematicBreakMarker,
  OrderedListNumbering,
  ListItemIndent,
  LineWrapPolicy,
  MarkdownStyle,
} from './style/markdown-style.js';

export { DEFAULT_MARKDOWN_STYLE, resolveMarkdownStyle } from './style/markdown-style.js';

export { parseMarkdown } from './parse/parser.js';
export { headingSlug, headingAnchors, tocItems, tocList, tocStartMarker, parseTocStart, isTocEnd, DEFAULT_TOC_DEPTH, TOC_END_MARKER } from './outline/toc.js';
export type { TocHeading, TocItem } from './outline/toc.js';
export { foldKeys, foldTargets, innermostFoldTarget } from './outline/fold-targets.js';
export type { FoldEntry, FoldKind, FoldTarget } from './outline/fold-targets.js';
export { convertToReferenceLinks, linkDefinitions } from './references/reference-links.js';
export type { LinkDefinitionEntry, ReferenceConversion } from './references/reference-links.js';
export { annotateTableWidths, applyColumnWidths, columnWidthHints, hintsOf, splitTableRow, COLUMN_WIDTHS_KEY } from './table/column-widths.js';
export { ALIGNMENT_KEY, ALIGN_CLOSE, ALIGN_OPEN_PATTERN, alignedBlockHandler, alignmentOf, applyAlignment, foldAlignment } from './align/block-alignment.js';
export type { BlockAlignment } from './align/block-alignment.js';
export { applyMediaEmbeds, AUDIO_EXTENSIONS, mediaKindOf, mediaOfParagraph, providerEmbedOf, VIDEO_EXTENSIONS } from './media/media-embeds.js';
export type { MediaEmbed, MediaKind, MediaProvider } from './media/media-embeds.js';
export type { ColumnWidthHints } from './table/column-widths.js';

export { serializeDocument } from './serialize/serializer.js';

export type { OffsetRange, NodePath } from './position/map.js';

export { nodeRange, offsetToPoint, pointToOffset, nodeAtOffset, nodesInRange } from './position/map.js';

export type { IncrementalResult } from './serialize/incremental.js';

export { serializeIncremental } from './serialize/incremental.js';

export type {
  PaneId,
  HistoryEntry,
  SessionChangeReason,
  SessionSnapshot,
  SessionChange,
  ApplyOptions,
  DocumentSessionOptions,
} from './session/document-session.js';

export { DocumentSession } from './session/document-session.js';

export type { OutlineEntry } from './outline/outline.js';

export { buildOutline, activeOutlineIndex } from './outline/outline.js';
export { applyImageWidths, joinImageAlt, splitImageAlt, MAX_IMAGE_WIDTH } from './images/image-hints.js';
export {
  expandWikiEmbeds,
  isWikiImageTarget,
  parseWikiEmbed,
  splitWikiEmbeds,
  wikiEmbedText,
  wikiEmbedTargets,
  WIKI_IMAGE_EXTENSIONS,
} from './images/wiki-embeds.js';
export type { WikiEmbed, WikiEmbedPart } from './images/wiki-embeds.js';
export { parseSnippetBody, snippetDate, snippetTime } from './snippets/snippet-body.js';
export type { ParsedSnippet, SnippetStop } from './snippets/snippet-body.js';
export type { ImageAltParts } from './images/image-hints.js';
export { headingPath } from './outline/heading-path.js';

export type { SectionRange } from './outline/move-section.js';
export { outlineSectionRange, moveSection } from './outline/move-section.js';
export type { RetentionPolicy, SnapshotEntry } from './history/snapshot-retention.js';
export { snapshotsToPrune } from './history/snapshot-retention.js';
export type { WordDiffKind, WordDiffPart } from './history/word-diff.js';
export { tokenizeWords, diffWords, countChangedWords } from './history/word-diff.js';
export type { SplitResult } from './outline/split-merge.js';
export { sectionIndexAtOffset, splitSection, mergeDocumentText, withoutFrontMatter } from './outline/split-merge.js';

export type { SearchOptions, SearchMatch, ReplaceResult } from './search/search.js';

export {
  InvalidQueryError,
  findMatches,
  replaceAll,
  replaceMatch,
  nextMatchIndex,
} from './search/search.js';

export type {
  SearchableFile,
  MatchSnippet,
  FileMatch,
  FileResult,
  VaultSearchResult,
  ReplaceOutcome,
} from './search/vault-search.js';

export {
  SNIPPET_CONTEXT_CHARS,
  MAX_VAULT_MATCHES,
  snippetAt,
  searchFile,
  searchFiles,
  replaceSelected,
} from './search/vault-search.js';

export type { HtmlRenderOptions } from './render/html.js';

export { renderFragment, renderHtml, escapeHtml, EXPORT_STYLESHEET } from './render/html.js';
export { KDOC_SANITIZE_SCHEMA, escapeStyleContent, filterStyle, isEmbedFrameSource } from './render/sanitize.js';
export { EXPORT_THEMES, DEFAULT_EXPORT_THEME, builtInThemeNames, builtInThemeCss } from './render/export-themes.js';
export {
  ATTACHMENT_TOKENS,
  DEFAULT_ATTACHMENT_TEMPLATE,
  FALLBACK_ATTACHMENT_NAME,
  PASTED_ATTACHMENT_NAME,
  applyTemplate,
  attachmentFileName,
  sanitizeNamePart,
} from './attachments/attachment-name.js';
export type { AttachmentNameContext } from './attachments/attachment-name.js';
export { attachmentReferences, referencedFileName, unusedAttachments } from './attachments/attachment-references.js';
export { withCommentNotes, MARGIN_NOTE_CLASS } from './render/comment-notes.js';
export { bundleComments, extractComments, hasCommentBundle, BUNDLE_START, BUNDLE_END } from './comments/portable.js';
export type { ExtractedComments } from './comments/portable.js';
export type { CommentNoteMode, CommentNoteOptions } from './render/comment-notes.js';

export type { HtmlImportOptions } from './parse/html.js';

export { htmlToMdast, htmlToMarkdown } from './parse/html.js';

export type { ImportLoss, ImportResult } from './import/html-import.js';

export { importHtml, importPlainText, mergeLosses, IMPORT_LOSS } from './import/html-import.js';

export {
  normaliseLanguageTag,
  dictionaryCandidates,
  primaryLanguage,
  detectLanguage,
  LANGUAGE_MARKERS,
  LANGUAGE_TAG_PATTERN,
  MIN_DETECTION_WORDS,
  MIN_DETECTION_SHARE,
  DETECTION_MARGIN,
} from './proofing/document-language.js';

export type { MarkdownFlavour, FlavourChange, FlavourExport, FlavourOptions } from './export/markdown-flavours.js';
export { exportMarkdownFlavour, FLAVOUR_NAMES } from './export/markdown-flavours.js';
export type { ResolveWikiLink } from './export/wikilink-links.js';
export { relativeLinkPath, WIKILINK_LABEL } from './export/wikilink-links.js';
export { DOWNGRADE_LABEL } from './export/flavour-downgrades.js';
export { WIKILINK_TEXT_PATTERN } from './serialize/wikilink-text.js';

export type { RtfConversion } from './import/rtf-import.js';

export { rtfToHtml, importRtf, RTF_LOSS } from './import/rtf-import.js';

export type { DocumentStatistics } from './analysis/statistics.js';
export type { ReadabilityScores } from './analysis/readability.js';
export { countSyllables, documentProse, isComplexWord, readability, COMPLEX_WORD_SYLLABLES } from './analysis/readability.js';
export type { GrammarIssue } from './proofing/grammar.js';
export { parseGrammarResponse, MAX_REPLACEMENTS } from './proofing/grammar.js';
export type { WordCount, PhraseCount } from './analysis/word-frequency.js';
export { frequentWords, repeatedPhrases, STOP_WORDS, MIN_PHRASE_WORDS, MAX_PHRASE_WORDS } from './analysis/word-frequency.js';

export {
  WORDS_PER_MINUTE,
  countWords,
  countSentences,
  countParagraphs,
  analyzeText,
} from './analysis/statistics.js';

export type { SourceRange, SearchScope } from './search/scope.js';

export { codeRanges, linkUrlRanges, sectionRange, scopeMatches } from './search/scope.js';

export {
  KDOC_ID_FIELD,
  generateUlid,
  isValidUlid,
  readKdocId,
  withKdocId,
  withoutKdocId,
} from './store/identity.js';

export type { JsonlRecord, JsonlProblem, JsonlReadResult } from './store/jsonl.js';

export { encodeJsonl, decodeJsonl, mergeRecords } from './store/jsonl.js';

export type { CommentAnchor, ResolvedAnchor, AnchorMatchKind } from './comments/anchor.js';

export { CONTEXT_LENGTH, MIN_SIMILARITY, hashBlock, blockAround } from './comments/anchor-text.js';

export { similarity } from './comments/similarity.js';

export { FUZZY_RADIUS, createAnchor, resolveAnchor } from './comments/anchor.js';

export type { CommentEntry, CommentThread } from './comments/thread.js';

export {
  createThread,
  addReply,
  editEntry,
  deleteEntry,
  setResolved,
} from './comments/thread.js';

export type {
  CommentMarkState,
  CommentSpan,
  OrphanedThread,
  DecorationPlan,
} from './comments/decoration-spec.js';

export { planDecorations } from './comments/decoration-spec.js';

export type { ChangeKind, ChangeAnchor, ResolvedChange } from './changes/anchor.js';
export { createChangeAnchor, expectedText, resolveChangeAnchor } from './changes/anchor.js';

export type { TrackedChange, ChangeDecision } from './changes/change.js';
export {
  createInsertion,
  createDeletion,
  resolveChange,
  applyDecision,
  applyDecisions,
} from './changes/change.js';

export type { RecordedEdit } from './changes/diff-edit.js';
export { commonPrefixLength, commonSuffixLength, diffEdit } from './changes/diff-edit.js';

export type { ChangeRecorder, ChangeRecorderOptions } from './changes/recorder.js';
export { createChangeRecorder } from './changes/recorder.js';

export type { MarkupMode, ChangeSpan, ChangeBar, ChangePlan } from './changes/decoration-spec.js';
export { lineOf, authorHue, planChanges, originalText } from './changes/decoration-spec.js';
export { compareAsChanges } from './changes/compare.js';
export type { FocusRange, FocusScope } from './focus/focus-range.js';
export { focusRange, paragraphRange, sentenceRange } from './focus/focus-range.js';
export { splitSlides } from './render/slides.js';

export type { LineOpKind, LineOp } from './merge/line-diff.js';
export { splitLines, joinLines, diffLines } from './merge/line-diff.js';

export type { Replacement } from './merge/replacements.js';
export { replacementsOf, linesEqual, applyWithin } from './merge/replacements.js';

export type { MergeHunkKind, MergeHunk, MergeResult, HunkChoice } from './merge/three-way.js';
export { mergeThreeWay, resolvedText } from './merge/three-way.js';

export type { NoteLinkKind, NoteLink, NoteIndexEntry } from './vault/note-index.js';
export {
  extractTags,
  extractWikiLinks,
  extractInlineLinks,
  noteTitle,
  indexNote,
} from './vault/note-index.js';

export type { Backlink, BrokenLink } from './vault/vault-links.js';

export type { GraphNode, GraphEdge, VaultGraph } from './vault/vault-graph.js';
export { vaultGraph, graphNeighbourhood, graphNode } from './vault/vault-graph.js';
export type { GraphPosition } from './vault/graph-layout.js';
export { layoutGraph } from './vault/graph-layout.js';
export type { DrawnEdge, DrawnNode, GraphDrawing } from './vault/graph-drawing.js';
export { graphDrawing, shortLabel, GRAPH_VIEW_SIZE } from './vault/graph-drawing.js';

export type { PluginManifest, PluginManifestResult } from './plugins/plugin-manifest.js';
export { isPluginId, parsePluginManifest, pluginProblem, PLUGIN_MAIN } from './plugins/plugin-manifest.js';
export type { PluginPoint, PluginRegistration, PluginCall, PluginMessage } from './plugins/plugin-protocol.js';
export { readPluginMessage, readRegistration } from './plugins/plugin-protocol.js';
export { PLUGIN_BOOTSTRAP, PLUGIN_EPILOGUE, pluginWorkerSource } from './plugins/plugin-sandbox.js';
export type { PluginSyntax } from './plugins/plugin-syntax.js';
export { applyPluginSyntax } from './plugins/plugin-syntax.js';
export {
  withoutExtension,
  normaliseTarget,
  targetsNote,
  backlinksTo,
  brokenLinks,
} from './vault/vault-links.js';

export type {
  VaultFileStat,
  CachedNote,
  VaultIndexFile,
  ScanPlan,
} from './vault/index-cache.js';
export { INDEX_FORMAT_VERSION, serialiseIndex, parseIndex, planScan } from './vault/index-cache.js';

export type { FidelityFinding, FidelityFindingKind, BlockPair } from './fidelity/fidelity-check.js';
export { checkFidelity } from './fidelity/fidelity-check.js';
export type { DiffRegion } from './fidelity/fidelity-tracker.js';
export { FidelityTracker, diffRegion, shiftRanges, mergeRanges } from './fidelity/fidelity-tracker.js';

export type { LintRuleId, LintEdit, LintFix, LintFinding } from './lint/lint-finding.js';
export { applyLintEdits, lineNumberAt } from './lint/lint-finding.js';
export type { ImageRef } from './lint/link-rules.js';
export { localImages } from './lint/link-rules.js';
export type { LintOptions } from './lint/lint-document.js';
export { lintDocument } from './lint/lint-document.js';

export type { TagCount, NoteMatch } from './vault/vault-query.js';
export { tagCounts, notesTagged, searchNotes } from './vault/vault-query.js';

export type { TreeNote, TreeFolderNode, TreeFileNode, TreeNode, VisibleRow } from './vault/file-tree.js';
export {
  INVALID_NAME_CHARACTERS,
  compareNames,
  parentRelative,
  baseName,
  childRelative,
  buildFileTree,
  flattenVisible,
  childNames,
  validateEntryName,
  withNoteExtension,
  absolutePath,
  isSameOrInside,
  topLevelOnly,
  remapPath,
  uniqueChildName,
} from './vault/file-tree.js';

export { replaceImageSources } from './render/image-sources.js';

export { applyDiagramImages, isMermaidCode, mermaidSources, DIAGRAM_ALT_TEXT } from './render/diagram-images.js';
