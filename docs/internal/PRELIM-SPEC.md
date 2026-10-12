---
audience: internal
title: K-Doc — Preliminary Functional Specification
status: draft
doc_version: 3
last_updated: 2026-09-04
---

# K-Doc — Preliminary Functional Specification

> **Status:** DRAFT — for review and iteration. Nothing here is implemented yet.
> This document defines *what* K-Doc does. `DESIGN.md` (created at implementation
> kick-off) will define *how* it is built.

---

## 1. Document Control

| Field | Value |
| --- | --- |
| **Product** | K-Doc — WYSIWYG Markdown viewer and editor |
| **Doc Version** | 3 |
| **Last Updated** | 2026-09-04 |
| **Owner** | K-Tech Labs |
| **Audience** | Internal (maintainers, implementing agents) |
| **Supersedes** | v2 — every question OQ-1 through OQ-8 is now resolved. OQ-9 (webview parity) is the only one open, and it is a Phase 0 spike rather than a design choice. Architecture lives in [DESIGN.md](DESIGN.md). |

### 1.1 Requirement Notation

- **FR-x.y** — Functional Requirement.
- **NFR-x** — Non-Functional Requirement.
- **Priority** — `P0` (MVP, ship-blocking) / `P1` (v1.0) / `P2` (post-1.0).
- **MUST / SHOULD / MAY** used per RFC 2119.

---

## 2. Product Vision

K-Doc is a **desktop Markdown word processor**. It opens `.md` files and presents
them as *finished documents* — headings styled, tables ruled, images inline, math
typeset — and lets you edit them directly in that rendered view, the way you edit
in Microsoft Word. The raw Markdown is always one keystroke away, never more.

### 2.1 Design Principles

1. **The Markdown file is the single source of truth.** K-Doc never invents a
   proprietary document format for body content. Any file K-Doc writes MUST be
   readable, sensible Markdown in any other editor.
2. **Round-trip fidelity is sacred.** Opening a file and saving it without edits
   MUST produce a byte-identical file. This is a hard acceptance test, not an
   aspiration.
3. **WYSIWYG is the default, not a mode you opt into.** A first-run user never
   sees a `#` unless they ask for it.
4. **Word muscle memory works.** `Ctrl+B`, `Ctrl+K`, `F7` spellcheck, right-click
   context menus, a ribbon-shaped toolbar. Familiar gestures map to Markdown
   concepts.
5. **Markdown's limits are respected, not papered over.** Where Word has a
   feature Markdown cannot express (arbitrary fonts, page breaks, floating text
   boxes), K-Doc either omits it or expresses it through an explicit, documented
   extension — never through silent HTML soup.
6. **Fast on real documents.** A 10 MB Markdown file with 2,000 headings scrolls
   at 60 fps. See NFR-1.
7. **Local-first, offline-always.** No account, no cloud dependency, no telemetry
   by default.

### 2.2 Non-Goals (v1)

- Real-time multi-user collaboration (deferred; see §16).
- A general rich-text editor for non-Markdown formats.
- Page-layout/DTP fidelity — K-Doc is a *document* editor, not a *page* editor.
- Publishing / static-site generation.
- Mobile or web builds (the core is kept portable, but no shipped target).

---

## 3. Platform & Delivery

| Aspect | Decision |
| --- | --- |
| **Form factor** | Native desktop application |
| **Primary OS** | **Windows 11 only, for now.** macOS and Linux are deferred rather than cancelled: the code stays portable behind the NFR-9 adapter interface and nothing may assume Windows in `@k-doc/core`, but neither is a release target and neither is tested. The trigger for revisiting is having a Mac or Linux host to close OQ-9 against. |
| **Shell** | **Tauri v2** — decided (OQ-1). Small signed binary, a real Rust process for filesystem and indexing work, OS webview for the UI |
| **UI runtime** | TypeScript + React 19, `strict: true`, no `any` |
| **Distribution** | Signed installer (MSI/NSIS on Windows, `.dmg`, `.AppImage`/`.deb`); auto-update channel |
| **File associations** | Registers `.md`, `.markdown`, `.mdx` (read-only for `.mdx` in v1) |

### 3.1 Consequences of the Tauri Decision

- The UI runs in the **OS webview** — WebView2 on Windows, WKWebView on macOS,
  WebKitGTK on Linux. Rendering differences are cosmetic; *editing* differences are
  not. IME composition, `beforeinput`, selection APIs, and `contenteditable`
  behaviour genuinely diverge across the three. The editor core MUST be exercised on
  all three from Phase 0 rather than at the end — see OQ-9.
- Everything touching the filesystem — open, atomic save, watcher, vault index,
  snapshot store, full-text search — lives in **Rust**, not JavaScript. This is the
  main performance dividend (NFR-1) and it keeps the webview's capability surface
  narrow (NFR-5).
- Native menus, file associations, and global accelerators are registered from Rust,
  so K-Doc owns shortcuts the webview would otherwise swallow. WebView2's built-in
  zoom and find are **disabled**, which is what makes the Word-true keymap in §20
  achievable.

### 3.2 Editor Architecture — The Hybrid (decided, OQ-2)

K-Doc runs **two editor engines over one canonical document**, joined by a mapping
layer:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| **Core** | Pure TypeScript, headless | Markdown text ⇄ AST (`mdast`-shaped, extended). Parse, incremental serialize, position mapping. No DOM, no framework. The only thing the round-trip contract (§4.6) is tested against. |
| **WYSIWYG pane** | ProseMirror (via Tiptap) | A rich document model derived from the AST. Owns the Word-like editing that decorations cannot do: table grips, image handles, drag-reorder, node views for math, Mermaid, and callouts. |
| **Source pane** | CodeMirror 6 | The Markdown text itself — syntax highlighting, folding, multi-caret, large-file virtualisation. |
| **Bridge** | K-Doc | Bidirectional position mapping, transaction translation, and caret hand-off when focus crosses panes. |

**Which engine is authoritative? The text is, always.** Specifically:

- **FR-3.1** `P0` — Exactly one pane holds the edit lock at a time: the focused one.
  The unfocused pane is a projection, re-derived from the authoritative text.
- **FR-3.2** `P0` — A ProseMirror transaction applies to the doc model, serializes to
  Markdown through the Core, and the resulting text becomes the new truth. A
  CodeMirror transaction edits the text directly and re-parses.
- **FR-3.3** `P0` — Serialization on the WYSIWYG path MUST be **incremental**: only
  the byte range covered by changed nodes is re-emitted and spliced into the text,
  which is what satisfies FR-4.2. Full-document re-serialization is a debug path only.
- **FR-3.4** `P0` — Node types the ProseMirror schema cannot express (unknown HTML,
  MDX, unsupported directives) are carried as **opaque leaf nodes** holding their
  original source bytes verbatim (FR-4.4).
- **FR-3.5** `P0` — Undo history belongs to the **Core**, not to either engine, so one
  `Ctrl+Z` behaves identically regardless of which pane made the edit and survives a
  pane switch mid-history.

> **The cost, stated plainly:** two document models, a schema-to-AST mapping, and an
> incremental serializer are roughly 60% of this project's difficulty. Phase 0 exists
> to prove this bridge before any UI is built on it.

---

## 4. The Content Model — Markdown Dialect

K-Doc parses and emits a defined superset. Everything below is **read + write +
WYSIWYG-editable** unless marked otherwise.

### 4.1 Tier 1 — CommonMark (P0)

Paragraphs, ATX and Setext headings (emitted as ATX), thematic breaks, blockquotes,
ordered/unordered lists with nesting, fenced and indented code blocks, inline code,
emphasis, strong emphasis, links (inline, reference, autolink), images, hard breaks,
HTML blocks and inline HTML (preserved verbatim; see FR-7.9), entity references,
and backslash escapes.

### 4.2 Tier 2 — GitHub Flavored Markdown (P0)

Tables, task list items (`- [ ]` / `- [x]`), strikethrough, autolink literals,
footnotes, and disallowed-raw-HTML handling.

### 4.3 Tier 3 — Front Matter (P0)

YAML front matter delimited by `---`, presented as a **structured metadata panel**
— a form with typed fields — rather than raw YAML, though raw editing MUST remain
available. TOML (`+++`) front matter is parsed and preserved but edited raw in v1.

### 4.4 Tier 4 — Rich Extensions (P1)

| Extension | Syntax | WYSIWYG behaviour |
| --- | --- | --- |
| **Math** | `$inline$`, `$$block$$` | KaTeX-rendered; click to edit source in place with a live preview beneath |
| **Diagrams** | ` ```mermaid ` fences | Rendered diagram; split code/preview when focused; parse errors shown inline |
| **Callouts / admonitions** | `> [!NOTE]` (GitHub/Obsidian style) | Rendered as a coloured, icon-bearing panel; type selectable from a dropdown |
| **Definition lists** | `Term` / `: Definition` | Rendered as an indented definition block |
| **Highlight** | `==text==` | Rendered as marked text; `Ctrl+Alt+H` |
| **Sub/superscript** | `~sub~`, `^sup^` | Rendered; `Ctrl+=` / `Ctrl+Shift+=` per Word |
| **Emoji shortcodes** | `:smile:` | Rendered as emoji; `:` triggers an autocomplete popup |

### 4.5 Tier 5 — Vault Extensions (P1)

| Extension | Syntax | Behaviour |
| --- | --- | --- |
| **Wikilinks** | `[[Note]]`, `[[Note#Heading]]`, `[[Note\|Alias]]` | Rendered as a link showing the alias or name; `[[` opens a fuzzy note picker; unresolved links render in a distinct "broken" style |
| **Embeds / transclusion** | `![[Note]]`, `![[Note#Section]]`, `![[image.png]]` | Rendered inline, read-only, with a visible source chip and an "open source" affordance |
| **Tags** | `#tag` (word-initial only) | Rendered as a chip; clicking filters the vault |
| **Block references** | `^block-id` | `P2` |

### 4.6 Serialization Contract (P0 — critical)

- **FR-4.1** `P0` — The serializer MUST be **stable**: `parse(serialize(parse(x))) == parse(x)` for all inputs, and `serialize(parse(x)) == x` for all *canonically formatted* inputs.
- **FR-4.2** `P0` — For non-canonical input, the editor MUST NOT reformat regions the user has not touched. Unedited byte ranges pass through untouched.
- **FR-4.3** `P0` — A user-configurable **Markdown Style** governs emitted syntax: bullet marker (`-`/`*`/`+`), emphasis marker (`_`/`*`), strong marker, ATX closing hashes, ordered-list numbering (incrementing vs all-`1.`), table column padding, line-wrap policy (never / at column N / one sentence per line), and trailing-whitespace handling.
- **FR-4.4** `P0` — Constructs K-Doc cannot render (unknown HTML, MDX, unsupported directives) MUST be preserved verbatim and shown in WYSIWYG as a distinct **raw block** widget, editable as source, never silently dropped.
- **FR-4.5** `P1` — A **Fidelity Check** diagnostic reports, on save, any byte-level change to untouched regions. Off by default; on in developer mode.

---

## 5. View Modes

- **FR-5.1** `P0` — **WYSIWYG (default).** Rendered document, directly editable. Syntax markers are hidden except on the element containing the caret, which reveals its markers (a "live preview" reveal) — configurable to *never reveal*.
- **FR-5.2** `P0` — **Source.** Raw Markdown in a syntax-highlighted code editor with line numbers, code folding, and bracket matching.
- **FR-5.3** `P0` — **Split.** Two panes, side by side (vertical split) or stacked (horizontal split), with a draggable divider whose ratio persists per window. Combinations: Source | WYSIWYG, Source | Preview, WYSIWYG | Preview.
- **FR-5.4** `P0` — **Preview (read-only).** Rendered, non-editable, optimised for reading; caret and editing toolbars suppressed.
- **FR-5.5** `P0` — **Synchronised scrolling** across split panes, anchored on block boundaries rather than line ratio, bidirectional, with a lock/unlock toggle.
- **FR-5.6** `P0` — Caret position and selection are **preserved across mode switches**: WYSIWYG→Source lands the caret on the corresponding source character, and the reverse holds.
- **FR-5.7** `P0` — Mode switching via `Ctrl+/` (cycle), the command palette, a status-bar segmented control, and the View menu.
- **FR-5.8** `P1` — **Focus mode** (dims all but the active paragraph or sentence), **Typewriter mode** (keeps the caret vertically centred), **Zen mode** (full screen, chrome hidden).
- **FR-5.9** `P1` — **Presentation mode**: thematic breaks (`---`) split the document into slides; arrow keys navigate; `Esc` exits.
- **FR-5.10** `P2` — **Reading width** control (narrow / medium / wide / full) with a persisted per-document override.

---

## 6. Files, Windows & Workspaces

### 6.1 File Operations

- **FR-6.1** `P0` — New, Open, Open Recent (with pinning), Save (`Ctrl+S`), Save As, Save a Copy, Rename, Reveal in File Explorer, Close.
- **FR-6.2** `P0` — **Autosave**, configurable: off / on blur / every N seconds / after N seconds idle. Default: on-idle-2s, once a document has been saved at least once.
- **FR-6.3** `P0` — **Crash recovery.** Unsaved buffers are journalled to app data; after an unclean exit, K-Doc offers to restore each one with a diff against the on-disk version.
- **FR-6.4** `P0` — **External change detection.** A filesystem watcher detects out-of-band edits. If the buffer is clean, reload silently and preserve the caret. If dirty, present a **three-way conflict resolver** (mine / theirs / merged diff).
- **FR-6.5** `P0` — Dirty state is shown in the tab, title bar, and status bar; closing a dirty document prompts Save / Discard / Cancel.
- **FR-6.6** `P1` — **Encoding and line endings**: detect and preserve UTF-8 (with and without BOM) and UTF-16, and CRLF/LF; both are shown in the status bar and switchable.
- **FR-6.7** `P1` — Read-only files open in a locked state with an explicit "Unlock" action.

### 6.2 Windows, Tabs & Panes

- **FR-6.8** `P0` — Multiple documents in **tabs**: drag to reorder, drag out to a new window, middle-click to close, `Ctrl+Tab` MRU switching.
- **FR-6.9** `P1` — **Split editor panes**, independent of the view-mode split: two documents side by side, or the same document at two scroll positions.
- **FR-6.10** `P1` — **Session restore**: reopen the previous window layout, tabs, scroll positions, and view modes on launch (configurable).

### 6.3 Vault / Workspace

- **FR-6.11** `P1` — **Open Folder as Vault.** A left-sidebar file tree with create / rename / delete / move (drag and drop), new-file-from-template, and multi-select operations.
- **FR-6.12** `P1` — **Vault index**: an incrementally maintained index of headings, links, wikilinks, tags, and front-matter fields, persisted at `.k-doc/index.db` and rebuildable on demand.
- **FR-6.13** `P1` — **Backlinks panel**: every note linking to the current one, with quoted context.
- **FR-6.14** `P2` — **Attachment management**: pasted and dragged images are written to a configurable attachments folder using a configurable naming template; an "unused attachments" report is available.
- **FR-6.15** `P2` — **Graph view** of wikilink relationships.

### 6.4 The Annotation Store

Comments and tracked changes cannot live in the Markdown body without breaking the
round-trip contract (§4.6) — and tracked *deletions* cannot live there at all, since
deleted text must be absent from the file yet visible on screen. K-Doc therefore keeps
annotations in a separate store. This section defines where that store is and how a
document finds it. *(Resolved, OQ-3 and OQ-6.)*

- **FR-6.16** `P1` — **Document identity.** The first time a document gains a comment
  or a tracked change, K-Doc adds one front-matter field, `kdoc_id: <ULID>`. The store is
  keyed by that ID, never by path, so renaming or moving a file — inside or outside
  K-Doc — never orphans its annotations.
- **FR-6.17** `P1` — `kdoc_id` is **lazily added and never volunteered**. A document
  that is only read or edited never acquires one, and the field is removed when the
  last annotation is deleted.
- **FR-6.18** `P1` — **Store resolution — file-first, vault-optional.** On open, K-Doc
  walks up from the document's directory looking for a `.k-doc/` folder, the way git
  discovers `.git`. The first one found is that document's store. If none exists,
  annotations go to a **global fallback store** in app data, keyed by `kdoc_id` with
  the last known path recorded as a hint. Commenting therefore works on a file
  double-clicked out of Downloads, with no vault and no setup.
- **FR-6.19** `P1` — Opening a folder as a vault creates `.k-doc/` at its root and
  offers to **migrate** annotations for documents beneath it out of the global store.
  Because the key is `kdoc_id`, migration is lossless and reversible.
- **FR-6.20** `P1` — **Store layout**, split by whether the content deserves sharing:

```text
<vault>/.k-doc/
  comments/<kdoc_id>.json      shared — commit to git
  changes/<kdoc_id>.json       shared — commit to git
  .gitignore                  generated; ignores local/
  local/
    index.db                  vault index (FR-6.12)
    snapshots/<kdoc_id>/       version history (FR-11.8)
    journal/                  crash-recovery buffers (FR-6.3)
    state.json                fold state, scroll positions, pane layout
```

- **FR-6.21** `P1` — Shared files are **line-oriented JSON** — one thread or one
  change-op per line, stably ordered — so that two people annotating the same document
  in a git repository merge without conflict in the common case.
- **FR-6.22** `P1` — **Interchange.** A *Bundle annotations into file* command writes
  comments into the document as HTML comments (FR-10.6) so a single `.md` can be sent
  to someone without the store; opening a file containing those markers imports them
  and offers to strip them. Always an explicit user action, never automatic. Tracked
  changes have no in-file form and are excluded from bundling.
- **FR-6.23** `P1` — A missing or unreadable store MUST degrade to a plain, correct
  document. Annotations are an overlay; losing them never damages content.

---

## 7. Editing Core

- **FR-7.1** `P0` — Full caret and selection model: character / word / line / paragraph / document movement, `Shift` extension, `Ctrl` word jumps, Home/End/PgUp/PgDn, `Ctrl+A`.
- **FR-7.2** `P0` — **Multi-caret and column selection** (`Ctrl+Click`, `Alt+Drag`, `Ctrl+D` add-next-occurrence) in both Source and WYSIWYG.
- **FR-7.3** `P0` — **Undo/redo** with a coalescing transaction model: typing runs coalesce, structural operations are atomic. Unlimited depth within a session, bounded by a configurable memory budget. `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`.
- **FR-7.4** `P0` — **Clipboard**: Cut / Copy / Paste, **Paste as Plain Text** (`Ctrl+Shift+V`), **Paste Special** (`Ctrl+Alt+V`, Word-true — a dialog offering plain text, Markdown, HTML, or table), **Paste as Markdown** (converts pasted HTML — from a browser or Word — into Markdown), **Copy as HTML**, and **Copy as Markdown** from the rendered view. A Word-style paste-options popup appears after a rich paste.
- **FR-7.5** `P0` — **Drag and drop**: text within and between documents; files from the OS (images embed; `.md` files link, or embed with a modifier).
- **FR-7.6** `P0` — **Smart typing**: auto-continue lists and blockquotes on Enter; Enter on an empty list item outdents, then exits; `Tab`/`Shift+Tab` indent and outdent list items; auto-pair brackets, quotes, backticks, and `$`; typing a pair character over a selection wraps it.
- **FR-7.7** `P0` — **Markdown input rules** (auto-format as you type): `# ` → heading, `- ` → bullet, `1. ` → ordered item, `> ` → quote, fences → code block, `---` → thematic break, `**bold**` → bold, `[[` → wikilink picker, `|` → table shorthand. Each rule is individually toggleable and reverted by a single `Ctrl+Z`.
- **FR-7.8** `P1` — **Autocorrect / smart substitutions**: smart quotes, em and en dashes, ellipsis, ordinal superscripts, sentence capitalisation — individually toggleable, with a user-editable replacement table (Word's AutoCorrect equivalent). MUST be inert inside code spans and code blocks.
- **FR-7.9** `P0` — Inline HTML and raw blocks are editable as source in a focused code widget with syntax highlighting.
- **FR-7.10** `P1` — **Snippets and templates**: user-defined expansions with placeholders and cursor stops, triggered by prefix + `Tab`.

---

## 8. Formatting — Word Parity Surface

### 8.1 Inline Character Formatting

- **FR-8.1** `P0` — Bold `Ctrl+B`, Italic `Ctrl+I`, Strikethrough `Ctrl+Shift+X`, Inline code `Ctrl+E`, Highlight `Ctrl+Alt+H`, Subscript `Ctrl+=`, Superscript `Ctrl+Shift+=`.
- **FR-8.2** `P0` — **Clear formatting** `Ctrl+Space` strips all inline marks from the selection.
- **FR-8.3** `P1` — **Format Painter**: `Ctrl+Shift+C` picks up the inline mark set from the selection, after which clicking or dragging over other text applies it; double-clicking the toolbar brush locks the tool on until `Esc`. It deliberately has no paste shortcut — `Ctrl+Shift+V` belongs to paste-as-plain-text (§20) — because the painter is a modal mouse tool, exactly as it is in Word.
- **FR-8.4** `P0` — Formatting commands are **toggles that reflect caret state**: the toolbar shows Bold as active when the caret sits inside strong emphasis.

### 8.2 Block & Paragraph Styles

- **FR-8.5** `P0` — A **Styles dropdown** (Word's Styles gallery equivalent): Normal, Heading 1–6, Quote, Code Block, Callout types. Shortcuts `Ctrl+Alt+1..6`, `Ctrl+Alt+0` for Normal.
- **FR-8.6** `P0` — Lists: bullet, ordered, task. Convert between types, increase and decrease indent, a **multi-level list** picker for nesting depth, and restart/continue numbering.
- **FR-8.7** `P0` — Blockquote wrap/unwrap `Ctrl+Shift+Q`, with nesting.
- **FR-8.8** `P0` — Code block: insert `Ctrl+Alt+C`, with a searchable **language selector**, syntax highlighting in the rendered view, and a copy button on hover.
- **FR-8.9** `P0` — Horizontal rule / thematic break insertion.
- **FR-8.10** `P1` — Callout insertion with a type picker (note, tip, important, warning, caution, custom).
- **FR-8.11** `P2` — **Alignment** (left / center / right) — expressible only via HTML attributes; gated behind an "allow HTML formatting" setting, off by default, because it breaks portability.

### 8.3 Links, Images & Media

- **FR-8.12** `P0` — Insert/Edit Link `Ctrl+K` with a dialog offering: paste a URL, search vault notes, pick a heading in this document, or select a local file. Selected text becomes the link text.
- **FR-8.13** `P0` — Link **hover card** showing the target; `Ctrl+Click` follows. Internal links navigate; external links open in the OS browser, with a confirmation for unknown domains.
- **FR-8.14** `P0` — Insert Image from file, URL, or clipboard paste. Pasted image data is written to the attachments folder (FR-6.14).
- **FR-8.15** `P1` — **Image editing affordances**: click to select, drag handles to resize, alt-text editor, and caption. *(Resolved, OQ-5.)* A resize emits a **width hint in the alt slot** — `![alt|600](img.png)` for inline images and `![[img.png|600]]` for embeds — the one syntax that works for both link forms and degrades to harmless alt text in renderers that do not understand it, rather than to visible junk or a broken image. Height is derived from the intrinsic aspect ratio. The hint is written **only when the user actually resizes**; untouched images stay plain. Captions use the CommonMark title slot — `![alt|600](img.png "Caption")` — so nothing is invented. Pandoc-attribute output (`{width=600}`) is available as an export flavour (FR-13.6). Alignment is *not* encoded in Markdown; it is a display concern and belongs to the HTML-gated path (FR-8.11).
- **FR-8.16** `P1` — Reference-style link management: a "convert to reference links" command and a link-definitions panel.
- **FR-8.17** `P2` — Video and audio embeds for local files and known providers.

### 8.4 Tables — First-Class, Word-Like Editing

Markdown tables are the single most painful thing to hand-edit. This is where
WYSIWYG earns its keep.

- **FR-8.18** `P0` — Insert a table via a **size-picker grid** (Word-style hover matrix) or `Ctrl+Alt+T`.
- **FR-8.19** `P0` — Cell navigation: `Tab`/`Shift+Tab` between cells (creating a new row at the end), arrow keys across cells, `Ctrl+Home`/`Ctrl+End` to table bounds.
- **FR-8.20** `P0` — Row and column operations: insert above/below/left/right, delete, duplicate, and **drag to reorder** via grip handles.
- **FR-8.21** `P0` — Per-column **alignment** (left / center / right) from the toolbar, mapping to `:---`, `:---:`, `---:`.
- **FR-8.22** `P0` — The table serializer keeps columns padded and aligned in the source (configurable per FR-4.3) so the raw Markdown stays human-readable.
- **FR-8.23** `P1` — **Sort by column**, ascending or descending, with text / numeric / date detection.
- **FR-8.24** `P1` — Paste TSV, CSV, or HTML-table clipboard content directly as a Markdown table; copy a table out as TSV for Excel.
- **FR-8.25** `P1` — Header-row toggle, and a warning when content requiring escaping (pipes, newlines) is entered.
- **FR-8.26** `P2` — Column width hints and cell-level formatting within GFM's constraints.

### 8.5 Structure Tools

- **FR-8.27** `P0` — **Move block up/down** `Alt+Up` / `Alt+Down` (paragraph, list item with children, table, code block).
- **FR-8.28** `P0` — **Promote / demote heading** `Ctrl+Alt+Right` / `Ctrl+Alt+Left`, optionally carrying the subtree.
- **FR-8.29** `P1` — **Fold / collapse** heading sections and list subtrees in both WYSIWYG and Source; fold state persists per document.
- **FR-8.30** `P1` — **Insert Table of Contents** — generated from headings at a configurable depth, inserted as real Markdown links, refreshable on demand.
- **FR-8.31** `P2` — **Split document at heading** and **merge documents** commands.

---

## 9. Navigation, Search & Replace

- **FR-9.1** `P0` — **Outline / Navigation pane** (Word's Navigation Pane): a live heading tree with click-to-jump, current-position highlighting, drag-to-reorder sections that move the whole subtree, and collapse/expand.
- **FR-9.2** `P0` — **Find** `Ctrl+F`: incremental, with match count, next/previous, match case, whole word, **regex**, and "search in selection". Matches highlight in both panes and in a scrollbar gutter.
- **FR-9.3** `P0` — **Replace** `Ctrl+H`: replace, replace all, regex capture groups (`$1`), a preview of the replacement, and undo as a single transaction.
- **FR-9.4** `P0` — Find and Replace operate on **document semantics**, not just text: options to exclude code blocks, include or exclude link URLs, and restrict to a heading section.
- **FR-9.5** `P1` — **Vault-wide search** `Ctrl+Shift+F`: full text, results grouped by file with context snippets, and **replace across files** with a per-match confirm list.
- **FR-9.6** `P1` — **Go To** `Ctrl+G` — line number in Source, heading in WYSIWYG.
- **FR-9.7** `P1` — **Quick Open** `Ctrl+Shift+O` — fuzzy file switcher across the vault. `Ctrl+P` stays with Print (FR-13.3), per §20; the command palette (FR-9.8) also matches bare filenames, so either route reaches a file.
- **FR-9.8** `P0` — **Command palette** `Ctrl+Shift+P` — every command, searchable, each showing its keybinding.
- **FR-9.9** `P1` — Breadcrumb bar showing the heading path of the caret's position.
- **FR-9.10** `P2` — Back/forward navigation history (`Alt+Left` / `Alt+Right`) across follows and jumps.

---

## 10. Comments & Annotations

Markdown has no comment syntax, so K-Doc uses a **sidecar store** with a
degradable fallback.

- **FR-10.1** `P1` — Insert a comment on a selection (`Ctrl+Alt+M`, Word's shortcut). The commented range is subtly underlined and tinted.
- **FR-10.2** `P1` — **Margin comment pane** on the right, showing threads anchored to their text, with the active thread joined by a leader line.
- **FR-10.3** `P1` — Threads support reply, edit, delete, **resolve/unresolve**, author name (from settings), and timestamps.
- **FR-10.4** `P1` — Pane filters (all / unresolved / by author) and a display toggle (inline / margin / hidden).
- **FR-10.5** `P1` — **Storage.** Comments live in the annotation store at `comments/<kdoc_id>.json` (§6.4); the body Markdown is never modified. Anchors are **resilient** — `{quoted_text, prefix_context, suffix_context, char_offset, block_hash}` — re-resolved by fuzzy match on load. An anchor that cannot be resolved becomes an **orphaned comment**, listed in the pane with its quoted text, never silently discarded.
- **FR-10.6** `P2` — **Portable comments mode** (opt-in): comments are additionally written into the file as HTML comments (`<!-- kdoc:comment id=... -->`) so they survive travelling outside the vault. Off by default because it mutates the file.
- **FR-10.7** `P1` — Comments are excluded from exports by default, with an "include comments" option that renders them as endnotes or margin notes.

---

## 11. Track Changes & Version History

### 11.1 Track Changes (P1)

- **FR-11.1** `P1` — **Toggle Track Changes** (`Ctrl+Shift+E`, Word's shortcut). While on, insertions render underlined in the author's colour and deletions render struck through rather than disappearing.
- **FR-11.2** `P1` — **Review pane** listing every change with author, timestamp, and type; click to jump.
- **FR-11.3** `P1` — **Accept / Reject** for: this change, all changes in the selection, all changes by an author, all changes in the document. Each is a single undoable transaction.
- **FR-11.4** `P1` — **Display modes**: Simple Markup (clean view with change bars in the margin), All Markup, No Markup (preview of the accepted result), Original.
- **FR-11.5** `P1` — **Storage.** The on-disk `.md` always holds the current accepted-plus-pending text as ordinary Markdown; the change overlay — an ordered op-log with anchors — lives in the annotation store at `changes/<kdoc_id>.json` (§6.4). A file opened elsewhere therefore reads sensibly, and reopening in K-Doc restores the marks. Unlike comments, tracked changes have **no in-file representation at all** and are never bundled (FR-6.22).
- **FR-11.6** `P1` — Deletions cannot be represented in the body text, so tracked deletions are held in the overlay and re-projected on load. If the overlay is lost, the document is simply the accepted text — a safe degradation.
- **FR-11.7** `P2` — **Compare Documents**: pick two files (or two versions) and produce a merged, marked-up document.

### 11.2 Version History (P1)

- **FR-11.8** `P1` — **Local snapshots** on every save (deduplicated), on demand, and on a timer, retained under a configurable policy (for example: all for 24 h, hourly for 7 days, daily for 90 days).
- **FR-11.9** `P1` — **History browser**: a per-document timeline with a side-by-side or inline **word-level diff** against the current version.
- **FR-11.10** `P1` — **Restore** a version as a new revision, never destructively, and **copy a passage** out of an old version.
- **FR-11.11** `P2` — **Git awareness**: when the vault is a git repository, surface the file's commit history alongside local snapshots and offer stage/commit for the current file.

---

## 12. Proofing, Statistics & Document Tools

- **FR-12.1** `P0` — **Spell check** with red squiggles, right-click suggestions, Ignore / Ignore All / Add to Dictionary, and a custom user dictionary. `F7` opens a walk-the-document review dialog. Engine: **bundled Hunspell** (decided, OQ-7), running in the Rust process with dictionaries shipped per language, so suggestions and behaviour are identical on Windows, macOS, and Linux.
- **FR-12.2** `P0` — Spell check MUST skip code blocks, inline code, URLs, math, and front-matter keys.
- **FR-12.3** `P1` — Multi-language dictionaries with a per-document language (from front matter `lang:` or the status bar) and automatic detection.
- **FR-12.4** `P1` — **Grammar and style checks** through a pluggable provider (LanguageTool-compatible, local or self-hosted), disabled by default. No data leaves the machine without explicit opt-in.
- **FR-12.5** `P0` — **Statistics**: live word count, character count (with and without spaces), paragraph count, and estimated reading time in the status bar; a detailed dialog adds sentence count and selection-scoped counts.
- **FR-12.6** `P1` — **Readability metrics** (Flesch–Kincaid, Gunning fog) in the statistics dialog.
- **FR-12.7** `P1` — **Document linting** — a problems panel reporting broken internal links, missing images, duplicate headings, empty links, malformed tables, unresolvable wikilinks, and heading-level skips, each with a quick fix where one exists.
- **FR-12.8** `P2` — Word-frequency and repeated-phrase analysis.

---

## 13. Import, Export & Print

- **FR-13.1** `P0` — **Export to HTML** — standalone (styles inlined, images embedded as data URIs) or with linked assets.
- **FR-13.2** `P0` — **Export to PDF** via the webview print pipeline, with a page-setup dialog: paper size, margins, orientation, headers and footers with page numbers, and an "include TOC" option.
- **FR-13.3** `P0` — **Print** `Ctrl+P` with a print preview honouring the same page setup.
- **FR-13.4** `P1` — **Export to DOCX** — headings map to Word styles, tables to Word tables, images embedded; comments map to Word comments and tracked changes to Word revisions where feasible.
- **FR-13.5** `P1` — **Import from DOCX, HTML, RTF, and plain text**, converting to Markdown, with a pre-import report listing anything that cannot be represented.
- **FR-13.6** `P1` — **Export to Markdown flavours**: strict CommonMark (extensions downgraded to HTML or plain text), GFM, and "vault-portable" (wikilinks resolved to relative paths).
- **FR-13.7** `P2` — Export to LaTeX and EPUB via an optional Pandoc integration when Pandoc is on PATH.
- **FR-13.8** `P1` — **Export themes** — the CSS used for HTML and PDF export is a selectable, user-editable stylesheet.
- **FR-13.9** `P1` — Copy the whole document as rich text for pasting into Word, Outlook, or Slack.

---

## 14. Application Shell & UI

### 14.1 Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  Title bar / native menu (File Edit View Insert Format Tools Review Help)│
├──────────────────────────────────────────────────────────────────────────┤
│  RIBBON / TOOLBAR   [Home] [Insert] [Layout] [Review] [View]             │
│  B I S  |  Styles v |  list  ord  task |  indent |  link img table |  Q  │
├────────┬──────────────────────────────────────────────┬──────────────────┤
│        │  Breadcrumb: Doc > Chapter 2 > Overview      │                  │
│ SIDE   ├───────────────────────┬──────────────────────┤   RIGHT PANEL    │
│ BAR    │                       │                      │  (comments /     │
│        │      WYSIWYG          │      SOURCE          │   outline /      │
│ files  │      (primary)        │      (optional)      │   backlinks /    │
│ search │                       │                      │   history /      │
│ outline│                       │                      │   metadata /     │
│ tags   │                       │                      │   problems)      │
├────────┴───────────────────────┴──────────────────────┴──────────────────┤
│ STATUS: saved · 1,204 words · 5 min read · UTF-8 · LF · Ln 42 · [W|S|//] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **FR-14.1** `P0` — A **ribbon-style command surface** grouped into tabs (Home, Insert, Layout, Review, View), collapsible to a compact single-row toolbar or hidden entirely.
- **FR-14.2** `P0` — **Context menus** on right-click, contextual to what is under the cursor: text, link, image, table cell, code block, comment.
- **FR-14.3** `P1` — **Floating selection toolbar** appearing on text selection with the most-used inline commands.
- **FR-14.4** `P0` — **Slash command menu** — typing `/` at the start of an empty block opens an insert palette (heading, list, table, code, image, callout, math, diagram, TOC).
- **FR-14.5** `P0` — **Status bar** per the wireframe, with clickable segments: word count opens statistics, encoding opens the encoding switcher, the mode indicator switches view.
- **FR-14.6** `P0` — Left sidebar with switchable panels (Files, Search, Outline, Tags), collapsible via `Ctrl+Shift+B`.
- **FR-14.7** `P1` — Right panel with switchable panels (Comments, Backlinks, History, Metadata, Problems).
- **FR-14.8** `P0` — A full **native menu bar** mirroring every command, so the app is discoverable without learning shortcuts.

### 14.2 Appearance

- **FR-14.9** `P0` — **Light / Dark / Follow system** themes built on a token-based palette.
- **FR-14.10** `P1` — **User themes**: one CSS file per theme, hot-reloaded, against a documented token contract. Editor and export themes are selected independently.
- **FR-14.11** `P0` — Typography controls: editor font family and size, line height, paragraph spacing, and a separate monospace font for code.
- **FR-14.12** `P0` — Zoom in / out / reset — `Ctrl+Shift+>` / `Ctrl+Shift+<` / `Ctrl+0`, plus `Ctrl+MouseWheel` and the View menu, with `Ctrl+-` as an accepted alias. These are Word's grow-font and shrink-font keys, which is exactly what zoom means in a document with no per-character font size. `Ctrl+=` stays with subscript (FR-8.1); WebView2's own zoom is disabled to make that possible (§3.1).
- **FR-14.13** `P1` — Per-document **display density** and reading-width overrides.

### 14.3 Settings & Customisation

- **FR-14.14** `P0` — A **Settings** window with searchable sections: General, Editor, Appearance, Markdown Style, Files & Links, Proofing, Review, Export, Shortcuts, Plugins, Advanced.
- **FR-14.15** `P0` — Settings persist as a human-readable JSON file the user may edit directly, with app-level defaults and **per-vault overrides**.
- **FR-14.16** `P1` — **Fully remappable keyboard shortcuts** with conflict detection, a searchable list, and importable presets ("Word", "VS Code", "Typora", "Obsidian").
- **FR-14.17** `P2` — Customisable ribbon and toolbar contents.

### 14.4 Extensibility

- **FR-14.18** `P2` — **Plugin API** — a sandboxed extension point covering new Markdown syntax (parser + renderer + serializer triple), new commands, new sidebar panels, and new export formats. Plugins are local folders; no marketplace in v1.

---

## 15. Non-Functional Requirements

- **NFR-1 Performance.** Cold launch to first paint under 1.5 s. Open a 1 MB document in under 500 ms; a 10 MB document in under 3 s with progressive rendering. Keystroke-to-paint latency under 16 ms at the 95th percentile on a 1 MB document. Scrolling holds 60 fps through block-level virtualisation. Mermaid and KaTeX render off the main thread, lazily, for viewport-proximate blocks only.
- **NFR-2 Memory.** Under 400 MB resident with five typical documents open.
- **NFR-3 Data safety.** No user action may lose data silently. Every destructive operation is undoable or confirmable. Saves are atomic (write temp → fsync → rename). Snapshots and journals survive a process kill.
- **NFR-4 Accessibility.** Full keyboard operability with a visible focus ring; WCAG 2.2 AA contrast in both themes; correct ARIA roles on the editing surface; screen-reader announcement of structure (heading levels, list positions, table cell coordinates); honours `prefers-reduced-motion`.
- **NFR-5 Security.** Rendered HTML is sanitised — no script execution, no remote script or style loads — unless the user explicitly trusts a document. External links confirm before opening. The webview runs with the narrowest capability set the shell allows. The default configuration makes no network requests at all.
- **NFR-6 Privacy.** Zero telemetry by default. Any opt-in diagnostics are explicit, documented, and local-first.
- **NFR-7 Internationalisation.** Full Unicode including CJK IME composition, RTL text rendering (RTL *editing* is best-effort in v1), and grapheme-cluster-correct caret movement. The UI is localisable; English ships first.
- **NFR-8 Testability.** The parser/serializer core is a pure, headless, unit-testable module with no UI dependency. The CommonMark and GFM spec suites run in CI. A golden-corpus round-trip test (FR-4.1) gates every merge.
- **NFR-9 Portability.** All platform-specific behaviour sits behind an adapter interface — filesystem, dialogs, menus, watcher, print — so a future web or mobile target needs no core rewrite.
- **NFR-10 Code standards.** All code conforms to the global engineering standards: strict typing, no `any`, RAII and ownership discipline in Rust, and the mandated file, function, and inline comment headers.

---

## 16. Phasing

### Phase 0 — Foundations

Shell scaffold, filesystem adapter, parser/serializer core with the round-trip test
harness, settings store, theming tokens.
**Exit criterion:** the golden-corpus round-trip suite passes on a 500-document corpus.

### Phase 1 — MVP (every `P0`)

WYSIWYG, Source, Split, and Preview with synced scrolling and caret mapping;
CommonMark, GFM, and front matter; the full formatting surface of §8.1–8.5 at `P0`;
tables; file operations with autosave, crash recovery, and external-change handling;
find and replace; outline pane; spell check; statistics; command palette; ribbon,
menus, context menus, and status bar; HTML and PDF export and print; light and dark themes.

**MVP definition of done:** a user can write a substantial technical document start
to finish without ever seeing raw Markdown, and the resulting file is clean,
canonical Markdown that renders identically on GitHub.

### Phase 2 — v1.0 (the `P1` set)

Vault and workspace with file tree, index, backlinks, and vault-wide search;
wikilinks and embeds; math, Mermaid, and callouts; comments; track changes;
version history; DOCX import and export; remappable shortcuts; user themes;
linting; focus and typewriter modes.

### Phase 3 — Post-1.0 (the `P2` set)

Graph view, plugin API, presentation mode, compare documents, git integration,
Pandoc-backed exports, block references, customisable ribbon.

### Phase 4 — Deferred / Speculative

Real-time collaboration (CRDT plus sync server), mobile companion, web build,
AI-assisted drafting and rewriting.

---

## 17. Open Questions

| ID | Question | Status |
| --- | --- | --- |
| **OQ-1** | Tauri v2 or Electron? | ✅ **RESOLVED — Tauri v2.** Consequences recorded in §3.1. |
| **OQ-2** | ProseMirror rich-model or CodeMirror decorations for WYSIWYG? | ✅ **RESOLVED — the hybrid.** ProseMirror for WYSIWYG, CodeMirror 6 for Source, a headless TypeScript Core owning the text, AST, undo history, and incremental serializer. Architecture in §3.2. |
| **OQ-3** | Sidecar store or in-file encoding for comments and tracked changes? | ✅ **RESOLVED — sidecar canonical, keyed by `kdoc_id`, with in-file bundling as an explicit export.** Tracked changes are sidecar-only, since a deletion cannot be represented in the body text. See §6.4, FR-10.5, FR-11.5. |
| **OQ-4** | Keymap conflicts with Word | ✅ **RESOLVED.** Four collision classes and their resolutions are documented in §20. Residual: whether "reveal syntax markers" — the analogue of Word's ¶ button — earns a default binding. |
| **OQ-5** | Where do image resize hints live? | ✅ **RESOLVED — width in the alt slot**, `![alt\|600](img.png)` and `![[img.png\|600]]`. Same syntax for both link forms, degrades to harmless alt text elsewhere. See FR-8.15. |
| **OQ-6** | Vault-first or file-first? | ✅ **RESOLVED — file-first.** Upward `.k-doc/` discovery like git, with a global fallback store so a loose file can still be commented on, and lossless migration when a folder later becomes a vault. See §6.4. |
| **OQ-7** | OS-native spellcheck or bundled Hunspell? | ✅ **RESOLVED — bundled Hunspell**, in the Rust process, identical on all platforms. FR-12.1. |
| **OQ-8** | Does the product ship as "K-Doc"? | ✅ **RESOLVED — yes, K-Doc.** |
| **OQ-9** | *(New, from OQ-1.)* Which webview sets the floor for `contenteditable` and IME behaviour, and what is the contingency if WKWebView or WebKitGTK cannot host the ProseMirror pane acceptably — ship a bundled Chromium on that platform, or degrade it to Source-only? | ✅ **CLOSED FOR THE SHIPPING TARGET, DEFERRED OTHERWISE.** Windows is the only release target (§3), and its engine is answered. The WKWebView and WebKitGTK columns stay open in `docs/webview-parity.md` and are a prerequisite for ever declaring those platforms supported — they are not a prerequisite for shipping. Evidence below.<br><br>🟡 **PARTLY ANSWERED.** A portable probe harness exists and **Chromium 148 is green** — 19 pass, 0 critical failures, and a genuine (`isTrusted`) `beforeinput` carrying one target range drives ProseMirror correctly. **WKWebView and WebKitGTK are not yet run**; they need macOS and Linux hosts. IME composition cannot be automated on any engine and remains outstanding. Contingencies are chosen and recorded in [docs/webview-parity.md](docs/webview-parity.md). |

---

## 18. Acceptance Criteria for This Specification

This document is ready to build against when:

1. ~~OQ-1 through OQ-8 are resolved~~ — done in v3.
2. **OQ-9** has a Phase 0 spike result: ProseMirror editing verified on WebView2, WKWebView, and WebKitGTK, with the contingency chosen.
3. Every `P0` requirement has an owner and a rough estimate.
4. A golden test corpus of Markdown documents exists for the round-trip contract (§4.6).
5. Low-fidelity wireframes exist for the main window, the comments pane, the review pane, the table toolbar, and the settings window.
6. `DESIGN.md` is stubbed with the Tauri + hybrid-engine architecture from §3.1–3.2.

---

## 19. Appendix A — Word Feature Parity Map

| Microsoft Word feature | K-Doc treatment | Requirement |
| --- | --- | --- |
| Bold / Italic / Underline | Bold and Italic; **underline omitted** — no Markdown equivalent, and it reads as a link | FR-8.1 |
| Font family / size / colour | Omitted — governed by theme, not by the document | — |
| Styles gallery | Styles dropdown (Normal, H1–H6, Quote, Code, Callout) | FR-8.5 |
| Format Painter | Supported for inline marks | FR-8.3 |
| Bullets / Numbering / Multilevel | Supported, plus task lists | FR-8.6 |
| Alignment / justification | Omitted by default; HTML-gated option | FR-8.11 |
| Line and paragraph spacing | Theme-level, not document-level | FR-14.11 |
| Tables | Full parity within GFM's expressive limits | FR-8.18–8.26 |
| Pictures with wrap and position | Insert, resize, alt text; **text wrapping omitted** | FR-8.14–8.15 |
| Shapes / SmartArt / charts | Replaced by Mermaid diagrams | §4.4 |
| Equations | KaTeX math | §4.4 |
| Header / footer / page numbers | Export and print time only | FR-13.2 |
| Page breaks / sections / columns | Omitted; thematic breaks serve as section and slide splits | FR-5.9 |
| Table of Contents field | Generated TOC, refreshable | FR-8.30 |
| Footnotes / endnotes | GFM footnotes | §4.2 |
| Captions and cross-references | Image captions `P1`; cross-references via heading links | FR-8.15 |
| Bibliography and citations | Deferred — a Phase 4 plugin candidate | FR-14.18 |
| Find and Replace with wildcards | Find and Replace with full regex | FR-9.2–9.4 |
| Navigation Pane | Outline pane | FR-9.1 |
| Spelling and Grammar (F7) | Spell check `P0`, grammar `P1` | FR-12.1–12.4 |
| Word Count | Status bar plus statistics dialog | FR-12.5 |
| Comments | Margin comment threads | §10 |
| Track Changes | Full accept/reject with display modes | §11.1 |
| Compare Documents | `P2` | FR-11.7 |
| Version History | Local snapshots, diff, restore | §11.2 |
| Read Mode / Print Layout / Web Layout | Preview / Print preview / WYSIWYG | §5 |
| Zoom, split window | Zoom, split panes | FR-14.12, FR-6.9 |
| AutoCorrect | Smart substitutions with a user table | FR-7.8 |
| Building Blocks / Quick Parts | Snippets and templates | FR-7.10 |
| Mail merge, macros, VBA | Out of scope | — |

---

## 20. Appendix B — Provisional Keyboard Map

Word-compatible by default. K-Doc departs from Word's map for exactly four reasons,
and only the fourth costs anything (resolves OQ-4):

1. **The webview or OS would swallow the key.** Not a real constraint under Tauri:
   WebView2's own zoom and find are disabled and accelerators are registered natively
   (§3.1), so `Ctrl+=`, `Ctrl+F`, and `Ctrl+P` reach the document rather than the
   browser. This class of conflict is *bought out by the platform decision*, which is
   part of why OQ-1 mattered.
2. **The Word feature does not exist in Markdown, so its key is free — but the muscle
   memory misfires.** `Ctrl+U` (underline) and `Ctrl+E` (centre) have nothing to do
   here. `Ctrl+E` is reassigned to inline code, the near-universal Markdown-editor
   binding; `Ctrl+U` stays unbound and explains itself (FR-20.1).
3. **Another application's convention has overtaken Word's.** `Ctrl+Shift+V` means
   paste-as-plain-text everywhere in 2026. K-Doc follows the world here and gives
   Word's Paste Special its own `Ctrl+Alt+V`, which is Word-true anyway.
4. **Two K-Doc commands genuinely want one key.** Only two survive, and both resolve in
   Word's favour: **Print keeps `Ctrl+P`** (Quick Open moves to `Ctrl+Shift+O`), and
   **Bold keeps `Ctrl+B`** (the sidebar moves to `Ctrl+Shift+B`). VS Code and Obsidian
   users get their expectations back through the presets in FR-14.16.

- **FR-20.1** `P1` — Pressing a Word shortcut with no K-Doc equivalent (`Ctrl+U`,
  `Ctrl+J`, `Ctrl+1`/`2`/`5`) shows a dismissible one-line explanation of why, rather
  than doing nothing silently.
- **FR-20.2** `P1` — Every binding below is remappable (FR-14.16). The "Word",
  "VS Code", "Typora", and "Obsidian" presets differ only in this table.

| Command | Shortcut |
| --- | --- |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| New / Open / Close | `Ctrl+N` / `Ctrl+O` / `Ctrl+W` |
| Print | `Ctrl+P` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` (alias `Ctrl+Shift+Z`) |
| Cut / Copy / Paste | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` |
| Paste as plain text / Paste Special | `Ctrl+Shift+V` / `Ctrl+Alt+V` |
| Format painter (pick up, then click or drag) | `Ctrl+Shift+C` |
| Bold / Italic / Strikethrough | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` |
| Inline code / Code block | `Ctrl+E` / `Ctrl+Alt+C` |
| Highlight | `Ctrl+Alt+H` |
| Subscript / Superscript | `Ctrl+=` / `Ctrl+Shift+=` |
| Clear formatting | `Ctrl+Space` |
| Heading 1–6 / Normal | `Ctrl+Alt+1..6` / `Ctrl+Alt+0` |
| Blockquote | `Ctrl+Shift+Q` |
| Bullet / Ordered / Task list | `Ctrl+Shift+8` (Word alias `Ctrl+Shift+L`) / `Ctrl+Shift+7` / `Ctrl+Shift+9` |
| Indent / Outdent | `Tab` / `Shift+Tab` in lists; `Ctrl+M` / `Ctrl+Shift+M` elsewhere (Word), aliases `Ctrl+]` / `Ctrl+[` |
| Insert link / image / table | `Ctrl+K` / `Ctrl+Shift+I` / `Ctrl+Alt+T` |
| Move block up / down | `Alt+Up` / `Alt+Down` |
| Promote / demote heading | `Ctrl+Alt+Left` / `Ctrl+Alt+Right` |
| Find / Replace / Find in vault | `Ctrl+F` / `Ctrl+H` / `Ctrl+Shift+F` |
| Go to | `Ctrl+G` |
| Quick open / Command palette | `Ctrl+Shift+O` / `Ctrl+Shift+P` |
| Cycle view mode | `Ctrl+/` |
| Toggle sidebar / right panel | `Ctrl+Shift+B` / `Ctrl+Shift+R` |
| New comment | `Ctrl+Alt+M` |
| Toggle track changes | `Ctrl+Shift+E` |
| Spell check dialog | `F7` |
| Zoom in / out / reset | `Ctrl+Shift+>` / `Ctrl+Shift+<` (alias `Ctrl+-`) / `Ctrl+0` |
| Underline — no Markdown equivalent | `Ctrl+U`, unbound; shows the FR-20.1 explanation |
