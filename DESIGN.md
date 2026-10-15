# K-Doc — Living Architecture Document

| Field | Value |
| --- | --- |
| **Doc Version** | 175 |
| **Last Updated** | 2026-10-15 |
| **Version** | 0.1.0 (first public release) |
| **Scope** | **Windows only, for now.** macOS and Linux are deferred, not cancelled: portability discipline stays (NFR-9) and nothing may assume Windows in `@k-doc/core`, but neither is a release target and neither is tested. |
| **Requirements** | [docs/internal/PRELIM-SPEC.md](docs/internal/PRELIM-SPEC.md) — this document says *how*, that one says *what*; per-requirement status is in [docs/internal/FR-STATUS.md](docs/internal/FR-STATUS.md) |

> **Status:** every requirement in the specification is implemented. Sections describe what exists on disk; the
> few that still carry **[PLANNED]** describe design intent recorded before the code, and say so.

---

## 1. What K-Doc Is

A desktop Markdown word processor: a K-Doc editing surface over plain `.md` files,
replicating the parts of Microsoft Word that Markdown can honestly express. The
Markdown file is always the source of truth, and byte-level round-trip fidelity is a
CI-gating contract rather than a goal.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Desktop shell | **Tauri v2** (Rust) | ~10 MB binary, real Rust process for I/O, narrow webview capability surface. Resolved OQ-1. |
| UI runtime | **TypeScript 5 + React 19**, `strict: true` | Global standards §3; no `any`. |
| K-Doc engine | **ProseMirror** (via Tiptap) | Node views give real table grips, image handles, and embedded math/diagram widgets. |
| Source engine | **CodeMirror 6** | Large-file virtualisation, folding, multi-caret over raw text. |
| Markdown core | **unified / remark** (`mdast`) | Mature CommonMark + GFM base with a clean extension seam for the Tier 4–5 syntax. |
| Test runner | **Vitest** | Headless, fast, native ESM + TypeScript. |
| Package layout | **npm workspaces** | One lockfile; core stays publishable and UI-free. |

---

## 3. Repository Map

```text
K-Doc/
├── README.md                Install, run, configure and use
├── DESIGN.md                This file (the architecture)
├── CHANGELOG.md             Release notes (Keep a Changelog)
├── SECURITY.md              Vulnerability reporting and the trust model
├── CONTRIBUTING.md          Development workflow and conventions
├── LICENSE / NOTICE         Apache-2.0 and attribution
├── package.json             npm workspace root; scripts for build/test/lint
├── tsconfig.base.json       Shared strict compiler options
├── start.cmd                Windows launcher for the dev app
├── .github/workflows/       CI: type-check, Vitest, cargo test, clippy, audit
├── packages/
│   ├── core/                @k-doc/core — headless Markdown engine: parse, serialize, render, analysis
│   ├── config/              @k-doc/config — settings schema, keymaps, theme tokens
│   ├── editor/              @k-doc/editor — ProseMirror (K-Doc) and CodeMirror (Source) adapters
│   └── app/                 @k-doc/app — the application shell that runs in the webview
├── src-tauri/               Rust host: windows, validated filesystem commands, spell check, git, pandoc
├── scripts/                 Dictionary fetch, third-party notices, FR status generator
└── docs/internal/           Specification, FR status, development log, webview-parity notes
```

---

## 4. Process Architecture

Two processes, one boundary, deliberately narrow:

```text
┌──────────────────────────── Tauri host (Rust) ────────────────────────────┐
│  file open/save (atomic)   fs watcher   vault index   snapshots           │
│  Hunspell spellcheck       native menus & accelerators                    │
└────────────────────────────── IPC commands ───────────────────────────────┘
                                     ▲
                                     │  typed command/event channel
                                     ▼
┌────────────────────────── Webview (TypeScript) ───────────────────────────┐
│  @k-doc/core   ← the canonical text, AST, undo history, serializer         │
│       ▲                    ▲                                              │
│       │                    │                                              │
│  ProseMirror pane     CodeMirror pane        React shell (ribbon, panes)   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Rules that keep this honest:**

1. No filesystem access from JavaScript. Everything goes through a Rust IPC command,
   which is what keeps the webview's capability set narrow (NFR-5).
2. `@k-doc/core` has zero imports from React, ProseMirror, CodeMirror, or Tauri. It is
   testable with `vitest` in a bare Node process, and that is what the round-trip
   contract runs against.
3. Both editor panes are *clients* of the Core. Neither owns the document.

---

## 4a. The Filesystem Adapter

Every filesystem operation lives in Rust and is reached through a narrow, validated command. The
webview is never granted direct disk access: there is deliberately no filesystem plugin, and the only
dialog permission is message boxes.

**Atomic writes never reuse a name.** Every writer that saves through a temporary file (`main.rs`,
`binary_file.rs`, `store.rs`, `vault.rs`) takes its name from `atomic::unique_temp_path`
(`.<name>.<pid>-<nanos>-<counter>.kdoc-tmp`) and creates it with `atomic::create_exclusive` (`create_new`), so a file or
symlink planted beside the target is refused instead of followed. `read_text_file` refuses files over 64 MiB.

**Opening files from Windows.** The installer registers K-Doc for `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`
and `.mdwn` (`bundle.fileAssociations`, one class `K-Doc.Markdown`). `src-tauri/windows/installer-hooks.nsh` adds what
Tauri's template does not: `OpenWithProgids` entries (so K-Doc is in **Open with**), a `Capabilities` key and a
`RegisteredApplications` value named `K-Doc` (so it is listed in Settings > Default apps), and, once per user and never
for a silent, passive or `/UPDATE` install, a question that opens `ms-settings:defaultapps?registeredAppUser=K-Doc`.
Windows lets only the user choose a default, so that page is as far as K-Doc can go. Uninstalling removes the keys.

`src-tauri/src/launch.rs` handles the launches that follow. At startup, `setup` reads the command line
(`launch_paths`: the executable and flags skipped, relative paths resolved against the working directory,
normalised, existing files only, duplicates dropped), grants each file and queues it in `LaunchState`.
`tauri-plugin-single-instance` (registered first) turns a second launch into a call to `handle_second_instance` in the
running process: its files are granted and queued, the window last focused (tracked from `WindowEvent::Focused`;
else `main`, else any) is restored and focused, and that window gets a `kdoc://launch-paths` nudge. The webview pulls
the queue with `take_launch_paths` rather than receiving paths in the event, so a nudge that arrives before its
listener exists loses nothing. In the shell, `files/launch-files.ts` wraps the two commands and the event, and
`restoreThenRecover` opens the queued files after session restore (so the double-clicked file ends up in front),
switching to a file that is already open and dropping the untitled launch document. A window opened for a detached tab
does not take the startup queue, but every window listens. **Make K-Doc the Default for Markdown…** (Tools menu) calls
`open_default_apps_settings`.

**The user guide.** `docs/guide/` is the user guide, written for people using K-Doc (task pages plus a settings
reference and a shortcut list). The pages carry no front matter, because K-Doc would show it at the top of
each page. It ships with the installer as the bundle resource folder
`guide` (`bundle.resources` maps `../docs/guide/` to `guide/`). **Help → User Guide** (`help:user-guide`, `F1`) calls
`user_guide_path` in `src-tauri/src/guide.rs`, which finds `<resource dir>/guide/index.md` (stripping a Windows `\\?\`
prefix so the grant store does not mistake it for a network path), grants the whole folder so links between pages
open, and returns the index; the shell opens it like any note. `read_text_file` reports every file inside that
folder as read-only (`guide::is_guide_file`), so a guide page opens locked however it is reached (the menu, a link,
session restore), and an edit is never made to the copy the next update replaces. The browser build has no installed
copy and opens the published guide on GitHub instead (`files/user-guide.ts`).

**File-access grants.** `src-tauri/src/grants.rs` keeps the files and folders the user has chosen
(`GrantState`, persisted to `<app data>/grants.json`, the 2000 most recent files and 200 folders), and
every command that takes a path from the webview checks it first, returning an error that starts with
`ACCESS_DENIED: ` otherwise. A grant is created only by the host, never by the webview:

- `src-tauri/src/access.rs` runs the native pickers (`pick_open_file` with kind `markdown` or `import`,
  `pick_save_path`, whose filter follows the suggested name's extension, and `pick_folder`) and grants
  what the user picks;
- `request_file_access` shows a native "Allow access?" prompt for a path the user never picked (a link to
  another file); `FileService` calls it once when a read is refused, then retries;
- a file dropped on a window is granted in `main.rs`'s `on_window_event` before the webview sees the drop;
- a file K-Doc is started to open (a double-clicked Markdown file) is granted by `launch.rs` (below);
- a rename keeps the grant (and must stay in the same folder).

Three levels of check exist. `require(path)` allows a granted file or anything inside a granted folder.
`require_folder(folder)` additionally allows the folder holding a granted file and folders inside it, which
is where a document's attachments go. `require_vault(folder)` allows only a folder the user picked, because
vault commands reach every note under it. Image and media reads stay ungated (they are limited to image and
media extensions and size-capped) so a document can show pictures from anywhere. Because the grant list
persists, recent files, session restore and crash recovery keep working across launches.

| Command | Contract |
| --- | --- |
| `read_text_file` | Reads bytes, strips a UTF-8 BOM and reports whether one was present, decodes strictly as UTF-8. |
| `write_text_file` | Writes atomically, restoring the BOM only if the file had one. |

Three decisions are load-bearing:

- **Reads do not normalise anything.** No line-ending conversion, no trimming. The round-trip contract
  depends on the bytes surviving, and "helpfully" normalising CRLF here would silently rewrite every
  line of a Windows-authored file on its first save.
- **Decoding failure is an error, not a guess.** K-Doc refuses to guess an encoding, because
  mis-decoding a file and then saving the result corrupts it. Other encodings are a later feature
  (FR-6.6), not a silent fallback.
- **Writes are atomic** (NFR-3): temp file in the *same directory* (a rename is only atomic within one
  filesystem), `write_all`, `sync_all` before the rename so a crash cannot leave a truncated file, then
  rename over the target. On any failure the temp file is removed, and that removal's own failure is
  deliberately not reported because it would mask the real error.

On the webview side, `file-service.ts` detects the Tauri runtime and reports `available: false` in a
plain browser, where the file buttons are disabled with an explanation rather than failing on click.
Running `npm run dev` in a browser is a legitimate development mode, not a broken one.

**Known gap:** the unsaved-changes prompt is a two-way `window.confirm`, which cannot express "save
first". FR-6.5 wants Save / Discard / Cancel, and that needs a real dialog.

---

## 5. The Document Pipeline

The single most important data flow in the project:

```text
  disk bytes
      │  Rust: read + encoding detect
      ▼
  source text  ◄──────────────────────────────────┐
      │  parseMarkdown()                          │
      ▼                                           │
  KdocDocument { text, root, frontMatter }         │ serializeDocument()
      │                                           │  (incremental splice)
      ├──► ProseMirror doc  ──edit──► transaction ┘
      │
      └──► CodeMirror state ──edit──► text directly, then re-parse
```

- **The text is authoritative, always.** A ProseMirror edit is serialized back to text
  before it counts as having happened.
- **Exactly one pane holds the edit lock** — the focused one. The other is a
  projection (FR-3.1).
- **Serialization is incremental** — only the byte range under changed nodes is
  re-emitted and spliced, which is what makes FR-4.2 (never reformat untouched
  regions) real. `serializeIncremental` diffs the edited tree against the original
  using position-free structural keys and an LCS match, then rewrites only the spans
  that actually changed. Two properties matter: an **unchanged save is exactly free**
  (fast path, zero serialization, byte-identical output), and when position data is
  missing it **falls back to whole-document serialization** rather than guessing —
  a correct-but-unminimal answer always beats a minimal-but-wrong one. Callers detect
  the fallback via `reusedBytes === 0`. Granularity is the innermost changed block, inside
  lists, items and blockquotes too (§6bn, §6bv); inline-level minimality is a later refinement,
  not a correctness gap.
- **Undo history belongs to the Core** (FR-3.5), not to either engine, so one
  `Ctrl+Z` means one thing regardless of which pane made the edit.

---

## 6. `@k-doc/core` Public API

The only surface the rest of the app may depend on:

| Export | Signature | Purpose |
| --- | --- | --- |
| `parseMarkdown` | `(text: string, options?: ParseOptions) => KdocDocument` | Text → AST. Never throws on malformed Markdown; unparseable constructs become `kdocRaw` nodes. |
| `serializeDocument` | `(doc: KdocDocument, style?: MarkdownStyle) => string` | AST → text, under an explicit emission style. Whole-document; normalises everything. |
| `serializeIncremental` | `(original: KdocDocument, updated: Root, style?) => IncrementalResult` | The FR-4.2 path. Rewrites only changed byte ranges against the original source. Returns the text plus `replacedRanges`, `reusedBytes`, `totalBytes`. |
| `DEFAULT_MARKDOWN_STYLE` | `MarkdownStyle` | The canonical style the golden corpus is written in. |
| `resolveMarkdownStyle` | `(partial?: Partial<MarkdownStyle>) => MarkdownStyle` | Fills defaults, validates bounds, freezes; the only way a style is constructed. |
| `nodeRange` | `(node: Node) => OffsetRange \| null` | A node's half-open `[start, end)` byte range, or `null` for a node built in memory. |
| `offsetToPoint` / `pointToOffset` | `(text, offset) => Point` / `(text, point) => number` | Offset ⇄ line/column. Mutually inverse for every offset in a document, LF and CRLF alike. |
| `nodeAtOffset` | `(doc, offset) => NodePath \| null` | The deepest node containing an offset, with root-first ancestors. |
| `nodesInRange` | `(doc, range) => readonly NodePath[]` | Every node intersecting a range, pre-order. An empty range is a caret and is handled specially. |
| `DocumentSession` | `new DocumentSession(text, options?)` | The authoritative state machine both panes are clients of. Owns the text, the undo history and the edit lock; `applyTree` and `applyText` **throw** when called by a pane that does not hold the lock (FR-3.1). |

Style translation is deliberately split in two, because the underlying libraries split it:
`toRemarkStringifyOptions` feeds remark-stringify, while `toRemarkGfmOptions` carries the
table settings (`tableCellPadding`, `tablePipeAlign`) that belong to remark-gfm and have no
effect on remark-stringify. Both stay internal to the serializer rather than joining the
public API above.

`KdocDocument` carries `{ text, root, frontMatter }` — the source text is retained
alongside the tree precisely so untouched byte ranges can be spliced through.

---

## 6a. `@k-doc/config`

Settings and theme tokens are headless for the same reason the core is: reading and writing the
settings file belongs to the Rust host, and applying CSS variables belongs to the UI. Two contracts
are worth stating because they are easy to erode later:

- **`parseSettings` never throws.** A corrupt settings file degrades to defaults with reported
  problems rather than stopping the editor opening — the same treatment malformed front matter gets.
- **Unknown keys are preserved verbatim.** A settings file written by a newer K-Doc survives being
  loaded and re-saved by an older one. Silently dropping a key the user set is the same class of
  failure as silently dropping a Markdown construct (FR-4.4).

The theme tokens are the documented contract user themes (FR-14.10) are written against, so adding,
renaming, or removing one is a breaking change. `contrastRatio` makes WCAG 2.2 AA (NFR-4) a CI gate
rather than an aspiration, and a parity test asserts both themes expose an identical token set so
neither can drift and leave a user theme half-styled.

That gate immediately earned its place: it caught a single `border` token doing two jobs with
different accessibility obligations. SC 1.4.11 scopes non-text contrast to interactive component
boundaries and focus indicators, not to decorative rules, so the token was split — `border` stays a
subtle divider with no contrast obligation, and `borderStrong` carries the 3:1 requirement.

---

## 6b. The ProseMirror Adapter

`@k-doc/editor` holds the engine adapters. The ProseMirror conversion layer uses only
`prosemirror-model` and never `prosemirror-view`, so it is **DOM-free** — which means the most
correctness-critical part of the K-Doc pane is tested in a bare Node process rather than a browser.

Three files form one unit and must always change together, which is §7's rule applied concretely:
`schema.ts` (what the model can express), `from-mdast.ts`, and `to-mdast.ts`. A node the schema can
express but a converter cannot restore would silently break the round-trip guarantee.

Two design decisions carry most of the weight:

- **Nothing is ever dropped.** Anything mdast can express that the schema does not model richly —
  raw HTML, math, link references — is carried by the `unknownBlock` and
  `unknownInline` atoms, which hold the original mdast node verbatim in an attribute (FR-4.4). Those
  constructs are not richly editable yet, but they survive a round trip exactly.
- **Footnotes are real nodes.** `footnoteReference` is an inline atom drawn as a superscript label, and
  `footnoteDefinition` is a block container of ordinary blocks, shown where it sits in the file with its
  label in front. Both carry `identifier` and the `label` as written, so the round trip is exact.
  `prosemirror/footnotes.ts` holds the rest: `insertFootnote` (Insert › Footnote; the reference goes at
  the caret with the next free number, the note is appended at the end and the caret placed in it), a
  plugin where clicking a reference goes to its note and clicking a note's label goes back, the
  definition's node view (the label is `contenteditable=false`, outside the editable body) and
  `FOOTNOTE_STYLES`.
- **Mark runs are grouped, not wrapped per node.** Converting each inline node independently would
  emit two adjacent `strong` nodes where remark produces one containing both children. The converter
  therefore scans forward for the maximal run sharing a mark and nests in a fixed order (link →
  strong → emphasis → delete) to match the shape remark produces.

**One deliberate asymmetry:** ProseMirror's `doc` requires `block+` and cannot represent an empty
document, so an empty mdast root becomes a document with one empty paragraph and does not round-trip
back to empty. It is the only place the conversion is not information-preserving, and there is a test
asserting the behaviour explicitly so it cannot later be mistaken for a bug.

### The view binding

`binding.ts` is the **only** file in the package that touches the DOM. Almost all of its complexity is
about stopping the session and the view fighting each other:

- **A view edit must reach the session without the session's response bouncing back.** An
  `applyingFromSession` flag guards the write-back; without it, an infinite loop in the obvious case
  and a corrupted undo history in the subtle one.
- **A session-initiated change must reach the view without looking like a fresh user edit.** Only
  `undo`, `redo` and `reset` resynchronise the view; re-rendering on an `edit` reason would destroy
  the user's selection mid-typing, because that reason is almost always the binding's own echo.
- **Selection-only transactions are not edits.** Forwarding them is the classic way an editor ends up
  with an undo history full of empty steps and a document marked dirty for doing nothing.
- **A rejected edit resynchronises the view before reporting.** The session is authoritative; leaving
  the view ahead of it is how an editor ends up silently editing a document that no longer exists.

### Two panes, one session

`CodeMirrorBinding` is the Source-pane counterpart. It is simpler in one way — the pane *is* text, so
there is no document-model conversion, it just hands the session a string — and harder in another: it
must reflect edits made in the **other** pane.

That requirement exposed a real bug in the ProseMirror binding, which had ignored every `'edit'`
reason. Correct while it was the only pane; wrong the moment a second one existed, because typing in
Source would never have reached K-Doc.

Both bindings now use the same rule: **sync when the reason is `undo`/`redo`/`reset`, or when it is
`edit` and the focused pane is not mine.** The focused pane is a reliable origin signal precisely
because the session refuses edits from a pane that does not hold the lock (FR-3.1) — so whoever holds
it is necessarily whoever made the edit. That is the edit lock paying for itself twice: once as a
correctness guard, and again as the only signal needed to route change notifications.

**The DOM-free claim is now tested, not assumed.** It used to be enforced by the compiler, because the
package's `lib` excluded DOM. The binding forced DOM types into that `lib`, so `dom-free.spec.ts` reads
the conversion layer's source directly and fails if `prosemirror-view`, `document.`, `window.`,
`HTMLElement` or `addEventListener` appears in its code. An architectural claim nobody checks is a
comment, not a constraint.

---

## 6c. The Application Shell

`EditorShell` is the first thing in the project a user can look at. It owns layout only; colour comes
entirely from the `@k-doc/config` tokens, so a user theme (FR-14.10) can restyle the app without
touching it.

One rule in it is load-bearing rather than cosmetic. **When a view-mode switch hides the pane holding
the edit lock, the shell moves focus to the visible pane.** Leaving the lock with a hidden pane would
make every keystroke in the visible one throw — the most obvious way this shell could be broken, and
a direct consequence of the edit lock being enforced rather than advisory.

Two smaller notes worth recording:

- Word count is computed from the **ProseMirror document's text content**, not the raw Markdown, so it
  counts words rather than syntax.
- `min-height: 0` on the panes container is required, not decorative: without it a flex row inside a
  grid row refuses to scroll and overflows the viewport instead.

**Known gaps in the shell**, all cosmetic rather than structural: task-list items render as plain
bullets (the `checked` attribute round-trips, but nothing draws a checkbox), there is no draggable
split divider, and there is no file I/O — the app opens a built-in sample and persists nothing.

---

## 6d. Editing Commands

The Word-parity formatting surface (FR-8.1 to FR-8.9) is a set of pure ProseMirror commands in
`commands.ts`, bound by `keymap.ts`. Because commands are pure functions over `EditorState`, they are
tested in a bare Node process — and the tests assert on the resulting **Markdown** rather than on
ProseMirror internals. Select a word, run bold, assert the document reads `**word**`: that covers the
command, the schema, both converters and the serializer in one assertion.

Three things in here are load-bearing:

- **Undo and redo are bound to the session, not to ProseMirror.** `prosemirror-history` is
  deliberately not imported. Installing it would create a second undo stack that knows only about one
  pane, so `Ctrl+Z` would mean different things depending on focus and would not survive a pane
  switch — exactly what the session-owned history exists to prevent (FR-3.5).
- **Every structural command tags its transaction `kdocStructural`,** which the binding reads to opt the
  edit out of undo coalescing. A formatting command that forgot the tag would silently merge into the
  user's last typing run, and nobody would notice until undo behaved oddly.
- **The binding builds its own keymap** rather than accepting one, because it already holds the
  session and every K-Doc pane needs exactly these bindings. It stores the plugin array so
  `syncFromSession` rebuilds state with the same plugins; a rebuild without them would silently lose
  every shortcut.

`baseKeymap` is part of that array, and its absence was a real defect: the binding previously created
its state with no plugins at all, so `Enter` did nothing and the pane could not create a paragraph.

### 6d.1 Links

Links get their own module because a link is the one mark whose range does not follow the selection.
Bold applies to what you selected; a link applies to the *whole* link when the caret is merely inside
one, because "edit this link" is what a caret in a link means. `linkAt` walks the contiguous run of an
equal `link` mark to find that range, comparing marks rather than nodes so that two adjacent links with
different targets stay two links.

`setLink` trims whitespace from a selection-derived range before applying. This is not fastidiousness:
a browser double-click selects the word **and its trailing space**, and a link renders that faithfully
as `[word ](url)`. Strong and emphasis conceal the same problem because Markdown cannot express a
trailing space inside `**...**`, so the serializer quietly moves it out - which is why the defect
survived until a link exposed it. Inline code was measured and needs no trimming; the serializer
handles it.

---

## 6e. Toolbar and Dialogs

The formatting toolbar reflects the caret, and that requirement shapes the whole file. Reflection needs
a signal that fires on **selection-only** changes, and the session cannot provide one: moving the caret
changes no text, so the session never fires. `ProseMirrorBinding.onStateChange` exists for exactly this
and runs before the binding's own `docChanged` guard.

Two rules govern anything that takes focus away from a pane:

- **Every toolbar button restores focus to the editor.** K-Doc keys its edit lock on which pane holds
  focus, so a button that leaves focus on itself makes the next keystroke throw.
- **The link dialog closes before it notifies its host.** A native `<dialog>` returns focus to whatever
  held it before `showModal()`, so closing after the callback silently undoes the host's own `focus()`.
  The observable symptom was focus stranded on the Link button and `Ctrl+K` doing nothing afterwards.

Neither rule can be verified headlessly. jsdom applies no CSS cascade and performs no dialog focus
restoration, so two real defects here - a `hidden` button still displayed because a class rule beat
`[hidden]`, and the focus-restoration ordering - were found in a browser, not in the suite. The tests
that now guard them assert what jsdom *can* see: that the stylesheet carries the `[hidden]` override,
and that the dialog is already closed when the host is notified.

## 6f. Find and Replace

Search runs over the **Markdown source text**, not over a rendered projection. That is a deliberate
choice with two justifications. It is honest: a user can legitimately search for `](` or `**`, and a
rendered projection would find text the file does not contain while missing text it does. And it is
cheap: a replacement is a text splice at known offsets, which feeds straight back through the session
and leaves every untouched byte identical (FR-4.2).

The engine (`@k-doc/core`'s `search/`) is pure and string-only, so it is tested exhaustively in a bare
Node process. Two of its rules are non-obvious enough to be worth naming, because both are the classic
bug in their respective function:

- `findMatches` advances `lastIndex` by hand after a zero-length match. `exec` does not, so a pattern
  like `x*` loops forever.
- `replaceAll` splices from the end backwards. Splicing forwards invalidates every later offset the
  moment a replacement differs in length from its match.

### The `'external'` change reason

The edit lock (FR-3.1) infers an edit's origin from which pane holds focus: whoever holds the lock is
whoever made the edit, so a binding treats an `'edit'` arriving while it holds the lock as its own echo
and skips re-rendering. That inference covers panes and nothing else.

Find-and-replace is not a pane. Its first implementation borrowed the Source pane's lock so the session
would accept its edit, and the Source binding then correctly-but-wrongly discarded the change as its own
echo: the K-Doc pane updated, the Source pane did not, and the two panes visibly disagreed about the
document. `DocumentSession.applyExternalText` exists to close that hole. No pane owns `'external'`, so
neither binding can mistake it for an echo and both re-render. The edit still enters the shared undo
history, because a replace-all is exactly what a user expects one `Ctrl+Z` to take back.

Anything else that edits the document without being a pane belongs on this path too.

### Revealing a match

`revealRange` selects the match in the CodeMirror pane and switches the view to split when only the
K-Doc pane is showing, since a source offset cannot be revealed in a pane that is not on screen. It
deliberately does **not** focus that pane: focus has to stay in the find box for incremental search to
work at all.

That is why `drawSelection()` is installed in the CodeMirror binding. Without it CodeMirror relies on
the browser's native selection, which is not painted while the editor is unfocused — so the match was
located correctly and shown to nobody.

## 6g. The Outline Pane

`buildOutline` walks **only the top level** of the document. A heading inside a blockquote or a list
item is not a document section, and listing it produces an outline that does not match the structure
the rendered document actually shows. A heading whose mdast node carries no position is skipped
entirely: an entry that cannot be navigated to is worse than an absent one.

`activeOutlineIndex` returns `-1` when the caret sits above the first heading, and the pane marks no
row in that case. Falling back to the first row would highlight a section the user is demonstrably not
in while they edit a preamble.

Two implementation notes that are load-bearing rather than incidental:

- **The pane skips its DOM rebuild when the headings are unchanged.** Rebuilding on every keystroke
  destroys the row under the user's pointer and makes the pane flicker while typing. The first render
  is the trap here: on install the previous entries are `[]`, so a document with no headings compares
  equal to nothing-rendered and the pane comes up completely blank — not even its own title. A
  `hasRendered` flag forces exactly one rebuild.
- **`CodeMirrorBinding.onStateChange` exists for the same reason the ProseMirror one does.** The active
  row follows the caret, moving the caret changes no text, and the session only fires for text. Without
  it the highlight only ever moved when the document changed.

### Known limitation

The active row tracks the **CodeMirror** caret. Editing in the K-Doc pane does not move it, so in
K-Doc-view-only mode the highlight goes stale. Mapping a ProseMirror position back to a source offset is
a separate piece of work; the pane is honest about what it tracks rather than guessing.

## 6h. One Undo History, Both Panes

`DocumentSession` owns the undo history (FR-3.5) so that `Ctrl+Z` means the same thing wherever the
caret is and an undo survives a pane switch. Honouring that requires each pane to bind undo to the
session and to install **no history of its own**.

The K-Doc pane always did: `prosemirror-history` is deliberately never imported. The Source pane did
not. It installed `history()` and `historyKeymap` from `@codemirror/commands`, which is a second,
pane-local undo stack. `Ctrl+Z` there rewound CodeMirror's own edit log, and that rewind then reached
the session as a **fresh edit** rather than as an undo — so the shared history grew instead of
shrinking, and an edit made in the other pane could not be undone from the Source pane at all.

Both panes now bind `Mod-z` / `Mod-y` / `Mod-Shift-z` straight to the session, and both return `true`
unconditionally so the keystroke never falls through to the browser's own undo, which would edit the
DOM behind the editor's back.

The rule for anyone adding a third editing surface: **do not install a history extension.** The session
already has one, and a second is not an optimisation but a divergence.

## 6i. Four Loose Ends

These four were carried as known gaps for several slices. They are grouped here because each one is
small on its own and the reasoning matters more than the code.

**Unsaved changes take three answers, not two.** `window.confirm` cannot express "save first", so it
forced a choice between losing work and abandoning the action - never the thing a user almost always
means. The dialog now returns `save`, `discard` or `cancel`, and the save path checks the session's
dirty flag afterwards rather than trusting a return value, because `doSave` routes its own failures to
`onError`. Opening on top of a failed save is precisely the data loss the dialog exists to prevent.

**`dirty` is derived, not flagged.** A boolean set on every edit and cleared only on save cannot answer
"is this document different from what is on disk?" - undoing back to the saved text left it set, and
the status bar claimed unsaved work that did not exist. The session keeps `savedText` and compares.

**Task items look like tasks.** The schema already emitted `data-checked` on every `<li>`, so the
information was there and nothing drew it; a checklist rendered as an ordinary bullet list. The marker
is a CSS `::before` rather than a real `<input>`, because the checkbox is a *rendering of document
state*, not a separate control - an input would be a second place for that truth to live. Toggling stays
with the Task button and `Ctrl+Shift+9`; the marker itself is not clickable.

**The split is draggable.** Resizing sets `flex` on the two panes, never pixel widths, so the row still
responds to window resizing. The ratio clamps to 15-85%: a pane dragged to zero cannot be dragged back,
because there is nothing left to grab. Arrow keys, `Home`, `End` and `Enter` do the same job without a
pointing device - a mouse-only divider fails WCAG 2.2, so that is a requirement rather than polish.

---

## 6e. Tables

GFM tables round-tripped from the beginning — the schema, both converters and the serializer already
handled them — but nothing let a user make one, and Phase 1's definition of done is writing a document
without seeing raw Markdown. `table-query.ts`, `table-build.ts`, `table.ts` and `table-columns.ts` close
that; the ribbon's contextual Table tab and the Table menu surface them as Word-style controls.

Two decisions shape the whole layer:

- **Every structural edit rebuilds the table rather than splicing positions.** Reading the cells into a
  plain 2-D array, transforming that array, and replacing the node is O(table), which is nothing at real
  table sizes. Position arithmetic across nested `table > row > cell` is where this code goes wrong, and
  it goes wrong silently: an off-by-one corrupts the document instead of throwing. Array operations can
  be checked by eye.
- **Rebuilt tables are always rectangular.** A ragged table serialises to Markdown that re-parses with a
  different shape, so the next edit would operate on a document the user never saw. Rows are padded to
  the widest row, and the `align` vector is spliced in lockstep with the cells — without that, every
  column to the right of an insertion silently inherits its neighbour's alignment.

**mdast has no header node.** Row 0 *is* the header, and the delimiter line is syntax rather than
content, so a table's mdast children are the header plus the body rows. Two consequences are load-bearing
and both are tested: `addRowBefore` on row 0 inserts *below* it, because inserting above would silently
demote the user's headings to body text; and `deleteRow` on row 0 promotes the next row to header,
because a GFM table always has exactly one.

`Tab`/`Shift-Tab` move between cells and are bound in the K-Doc keymap ahead of the list keymap.
`goToNextCell` returns `false` outside a table, so `Tab` falls straight through to list indentation and
keeps its ordinary meaning everywhere else. Tab past the last cell appends a row, which is what every
table editor does. Navigation is deliberately **not** tagged `kdocStructural`: it changes no content, and
tagging it would push a meaningless entry into the undo history.

### The toolbar mousedown guard

Building the first table controls (a toolbar since replaced by the ribbon's Table tab) exposed a bug in the toolbars of the time. Neither prevented default on
`mousedown`, so clicking any button moved DOM focus out of the ProseMirror `contentDOM`, the browser
collapsed the selection, and the command ran against a caret at position 0. Bold silently did nothing;
an inserted table landed at the top of the document. Every button in both toolbars now calls
`preventDefault` on `mousedown`, which suppresses the focus change while still firing `click`.

This survived because the tests drive commands directly and keyboard shortcuts never blur the pane —
`Ctrl+B` worked throughout. Only clicking exercised the broken path. The regression test asserts the
guard is present on every button rather than reproducing the browser behaviour, because jsdom does not
move focus on `mousedown` and so cannot reproduce the bug at all.

---

## 6f. Markdown Input Rules

`input-rules.ts` implements FR-7.7: typing `# ` makes a heading, `- ` makes a bullet, `**bold**` makes
bold. This is what the K-Doc promise actually rests on — without it a user has to reach for a toolbar
to do what typing already means in Markdown.

**Settings → Editor → Input rules** (`editor.inputRules`) switches every rule here on and off live: `createKdocInputRules`
takes an `enabled` getter, and `gateInputRules` wraps the plugin's two entry points (`handleTextInput` and
`compositionend`) so that with the switch off typed text is inserted as typed. The plugin's state and its
`isInputRules` marker are kept, so Backspace still undoes a rule that did fire. The shell passes
`() => this.settings.editor.inputRules` to both editor panes, through the binding's `inputRulesEnabled` option.

`prosemirror-inputrules` ships block-level helpers but no inline-mark rule, so `markInputRule` is the
one piece written by hand. It replaces the matched delimiters with the captured text, marks it, and then
calls `removeStoredMark` — without that last step the mark would carry onto the next character typed, so
`**bold** more` would come out entirely bold.

Two regexes are load-bearing and easy to get wrong:

- The heading rule is `/^(#{1,6})\s$/`. The trailing `\s` is what makes it fire on the *space*, not on
  the `#`, so typing `#hashtag` is left alone. There is a test for exactly that.
- The emphasis rule uses a negative lookbehind, `/(?<![*])\*([^*]+)\*$/`. Without it the emphasis rule
  eats `**bold**` after the strong rule has already had its turn.

`Backspace` is bound to `undoInputRule` ahead of the base keymap, so a rule that fires when you did not
mean it can be reverted with one keystroke. Reverting a heading restores a paragraph whose text begins
with a literal `#`, which the serializer then escapes as `\#` — that escape is correct, not a defect:
without it the document would re-parse as the very heading the user just undid.

**Rules fire on incremental typing only.** ProseMirror routes input rules through `handleTextInput`,
which it invokes for character-by-character input but skips when a large DOM change lands at once. That
is why the tests step character by character, and it is also the behaviour you want: Markdown *pasted*
as a chunk stays literal rather than being silently reinterpreted.

---

## 6g. Command Registry and Palette

`command-registry.ts` is the single catalogue of every user-invokable command; `command-palette.ts` is
the `Ctrl+Shift+P` surface over it (FR-9.8). The registry exists separately from the palette because
FR-14.1 and FR-14.8 will need the same list for the ribbon and the native menu bar, and three
independent lists of commands would drift apart within a release.

Each entry carries an `id`, `label`, `category`, a human-readable `shortcut`, `run()` and `isEnabled()`.
`isEnabled()` is the ProseMirror dry-run — the command called without a dispatch — so the palette greys
out what cannot apply rather than offering a command that silently does nothing. App-level actions such
as Save have no dry-run form and are always offered; they report their own failures.

Three things are deliberate:

- **The registry is rebuilt on every `open()`**, because entries close over live editor state. A list
  captured once would show stale enabled/disabled styling the moment the caret moved.
- **The palette closes before running the command**, not after. Editor commands focus the pane as their
  last act, and K-Doc keys its edit lock on which pane holds focus — running first would hand focus to
  the pane and then let the closing dialog snatch it back, leaving the lock pointing at nothing.
- **View and theme entries click the real toolbar buttons** rather than reimplementing their handlers,
  so the palette and the toolbar cannot drift and each button's `aria-pressed` mirroring still happens.

`filterCommands` is a subsequence match over `category + label` that skips whitespace in the query, so
`hed 2` finds `Heading 2`. It returns matches **in registry order**: a palette that reshuffles as you
type moves the entry you were aiming for out from under the cursor.

`Ctrl+Shift+P` is bound on `document`, not in the ProseMirror keymap, because the palette must open from
either pane and the Source pane's CodeMirror keymap never sees ProseMirror's.

`FileMenu` now exposes `open()`, `save()` and `saveAs()`, which delegate to the very functions its
toolbar buttons call. **New is deliberately absent from the registry**: the app has no new-document
action yet, and a palette entry that silently does nothing is worse than one that is missing.

---

## 6h. Autosave and Crash Recovery

Two mechanisms with different jobs, deliberately kept apart.

**Autosave** (`autosave.ts`, FR-6.2) writes the real file. It is pure timer logic over a save callback
and does no I/O itself. Policies are off / on-blur / every N seconds / after N seconds idle, defaulting
to idle-2s. It **refuses to run on a document with no path**: silently creating a file the user never
named is worse than not saving.

**The journal** (`journal.ts` + `recovery.ts` + `src-tauri/src/journal.rs`, FR-6.3) writes a scratch
copy so a crash cannot destroy more than a moment of work. It runs on an 800 ms debounce, deliberately
*shorter* than the autosave window, because autosave can afford to wait for a pause in typing and the
journal cannot. It journals **regardless of whether the document has a path**, which is the exact case
autosave refuses: an unnamed buffer is the one with nothing else protecting it.

The Rust side writes temp-then-rename. A journal half-written during a crash is precisely the file
recovery would try to read, so atomicity is the whole point rather than a nicety. `journal_list` skips
unparseable entries instead of failing, because one corrupt journal must not hide every other
recoverable document. Journal ids are validated against `[A-Za-z0-9_-]` before becoming filenames, and that is what
stops an id like `../../config`
escaping the journal directory.

`createJournalStore` picks a backend once: Tauri when available (the app-data directory survives a
crash), `localStorage` otherwise so the Vite dev build exercises the same path, and a no-op store when
neither works. Every `localStorage` access is wrapped, because private-browsing modes make it *throw*
rather than return null, and an unguarded read would take the editor down. `list()` never rejects: a
failed recovery offer is a lost convenience, but an exception at startup would stop the editor opening.

**One journal per tab.** Each tab journals under `journalIdFor(tabId)` = a per-launch random prefix plus
the tab id, so a save or close in one tab clears only that tab's journal, two windows never share a
record, and a new launch cannot overwrite the previous launch's journals before they are offered.
Closing a tab, or answering "Don't Save" when the window closes, deletes that tab's journal.

**Recovery goes back where it came from.** `offerRecovery` asks once per recoverable journal, newest
first, and `restoreRecord` opens (or activates) the record's own file and applies the text there; an
untitled record, or a file that can no longer be opened, becomes a new untitled document. Text is never
applied to whichever tab happens to be in front. Windows opened on a handed-over document
(`EditorShellOptions.handedOff`, set by `main.ts` when `claim()` returns a document) skip both session
restore and recovery, because the journals they would find belong to windows that are still open.

**Closing the window asks first.** `shell/close-guard.ts` subscribes to Tauri's `onCloseRequested`
(the title-bar button, Alt+F4 and the taskbar all arrive there) and calls the shell's
`confirmCloseAll`, which brings each dirty tab on screen in turn and asks Save / Don't Save / Cancel.
Cancel, a failed write or a cancelled Save As keeps the window open; a second close request while the
first is still being answered is refused. `FileMenu.save()`/`saveAs()` resolve `true` only when the
document was written, and closing a single dirty tab awaits that result the same way.

**Only what reached disk is saved.** `DocumentSession.markSaved(written)` records the text the save
actually wrote, so anything typed while the write was in flight keeps the document dirty.

**Restoring uses `applyExternalText`, never `reset`.** `dirty` is computed as `text !== savedText` and
`reset` sets both, so restoring through it would mark the document clean, handing back work that is not
on disk and letting the user close without saving it. That was a real bug in the first draft.

`ConfirmDialog` now takes optional labels. The three choices are the same shape everywhere (do it,
throw it away, back out) but recovery asks "Restore / Discard / Not now", which is a completely
different sentence from "Save / Discard / Cancel". Captions reset on every `ask`, so a dialog cannot
inherit wording from a previous caller.

---

## 6i. External Change Detection

`src-tauri/src/watcher.rs` watches the open file; `external-watch.ts` decides what to do (FR-6.4).

**The watcher watches the parent directory, not the file.** This is the decision the whole feature turns
on. Editors and tools (K-Doc included) save by writing a temp file and renaming it over the target, which
on most platforms *replaces the inode*. A watch on the file itself follows the old inode and goes silent
after the first external save, which is precisely the case this feature exists to catch. Watching the
directory and filtering by filename survives the rename.

The `notify` watcher handle is **stored**, not dropped. A `watch_file` that lets it fall out of scope
compiles, runs, and silently never fires - the easiest way to get this wrong. Dropping the handle is
also how `unwatch_file` works; there is no explicit stop call. Handles live in a map **keyed by window
label** (both commands take the calling `tauri::Window`), and the change event is emitted only to that
window, so one window opening or closing a document never replaces or drops another window's watch.

**Moves are shared between windows.** After the file tree moves a note or File › Rename renames the document,
the shell emits `kdoc://path-moved` `{ from, to, origin }`; every other window (origin = its journal prefix) runs
`followMovedPath`, so no window keeps saving to the old path. A window's watch entry is removed on
`WindowEvent::Destroyed`.

**Self-saves are filtered by comparing content, not by a time window.** K-Doc writes the file, the
watcher fires, and the reconcile step sees that the disk text equals the session text, or the session's
`savedText` (the user kept typing while the save was in flight), and does nothing.
A suppression window around our own writes would be a race; content comparison cannot be.

Events are debounced 150 ms, because one save from another editor produces a burst - temp file created,
renamed, metadata touched - and acting on the first would re-read a file mid-write. That is deliberately
shorter than the 800 ms journal debounce, so an external change is reconciled before the journal records
a buffer that is about to be replaced.

Then:

- **Clean buffer** - reload silently and tell the user in the status bar. There is nothing to lose. The
  buffer does end up marked dirty relative to its last save, which is honest: the text now differs from
  what K-Doc last wrote, and marking it clean would mean trusting that the disk read and the last save
  agree.
- **Dirty buffer** - ask: Reload / Keep mine / Decide later. "Keep mine" leaves the buffer alone and the
  next save overwrites the external change, which is what the user asked for. "Decide later" differs
  only in intent: no decision is recorded, so the next external change asks again.

**The three-way merged diff FR-6.4 also names is not built.** Two of the three resolutions are here; the
merge view is a separate piece of work and is called out as missing rather than quietly dropped.

---

## 6j. Synchronised Scrolling

`scroll-sync.ts` holds the algorithm; `pane-anchors.ts` is the only file that knows how each editor
lays a document out (FR-5.5).

**Anchored on block index, not line ratio.** A ratio sync drifts badly the moment one pane renders a
block taller than the other, and in a Markdown editor that is most documents: a code block, a table, an
image. Anchoring on block index means the same block sits at the top of both panes however tall each
pane draws it. `alignedScrollTop` finds the block the viewport top is inside, measures how far through
it the viewport has travelled, and interpolates the same fraction through the matching block on the
other side.

The two anchor providers compute their numbers completely differently and must return them in the same
frame, which is the whole contract between them:

- **K-Doc** measures top-level children of the ProseMirror DOM with
  `rect.top - scrollerRect.top + scroller.scrollTop`. Rects are viewport-relative; that arithmetic
  converts one into a position relative to the *scrollable content*, which is what `scrollTop` measures.
- **Source** asks CodeMirror for `lineBlockAt(offset).top`, which is already in that frame and needs no
  rect arithmetic.

Both index by top-level mdast node, so the panes agree on what block 3 means.

Three details that are easy to get wrong:

- **CodeMirror scrolls its own `.cm-scroller`, not the pane div.** Syncing against the pane would read a
  `scrollTop` that never changes.
- **Setting `scrollTop` fires `scroll` on the other pane**, which would scroll the first one back. A
  `syncing` flag guards it, cleared on a zero-delay timeout rather than synchronously, because the
  scroll event is dispatched asynchronously and a synchronous clear would be gone before it arrived.
- **Anchors are measured from live layout, so they cannot be measured at install time.** The panes exist
  but have not been laid out, and every rect would read zero. The initial measurement is deferred a
  frame, and a scroll that finds an empty cache re-measures rather than declining to scroll.

When the panes disagree on block count - which happens for a moment after an edit - the algorithm falls
back to the other pane's last anchor rather than refusing. Being approximately right beats leaving the
panes visibly out of step.

---

## 6k. View Modes

There are three: **K-Doc** (the rendered, editable ProseMirror pane, called WYSIWYG before 0.3), **Split** (both
panes side by side) and **Source** (CodeMirror over the raw Markdown). The mode id is `'kdoc' | 'split' | 'source'`
in the shell (`ViewMode`), the settings (`editor.defaultViewMode`) and the stored session (`SessionViewMode`), and
the pane id the session's edit lock uses is `'kdoc' | 'source'` (`PaneId`).

A read-only Preview mode existed until 0.3. It was the K-Doc pane with editing switched off and a narrower measure,
not a rendering of the output, so it duplicated the K-Doc view while promising more; it was removed. A locked
document (FR-6.7) is now the only thing that makes the K-Doc pane read-only.

`VIEW_MODE_CYCLE` and `nextViewMode` back `Ctrl+/` (FR-5.7), in the order of the view buttons. An unrecognised mode
restarts the cycle rather than staying put, because a shortcut that silently does nothing is the worst response to an
unexpected state - the user just presses it again harder.

**Split orientation.** `editor.splitOrientation` lays Split out side by side (`vertical`, the default) or stacked,
K-Doc above Source (`horizontal`). `applySplitOrientation` (run from `applySettings`, so it applies live) toggles
`kdoc-panes-stacked` on the panes row, which turns it into a column, and calls `setOrientation` on both dividers.
`split-divider.ts` names orientations as the setting does, which is also the separator's `aria-orientation`: a
horizontal divider gets `kdoc-split-divider-horizontal`, measures the drag on the y axis, and shows the up-down
cursor; the arrow keys work in either orientation, and the ratio (flex shares) carries across. The second pane is a
sibling in the same row, so it stacks too. A `revealSyntaxMarkers` setting that nothing read was removed; an old
settings file keeps the value as an unknown key, without a warning.

**Which mode a window starts in.** A restored session's mode wins (`applyStoredLayout` sets `viewModeRestored`);
otherwise `restoreThenRecover` applies `editor.defaultViewMode`, which defaults to Split. Settings and sessions saved
before 0.3 are read forward: `'wysiwyg'` and `'preview'` both become `'kdoc'`, and a session's old `scrollWysiwyg`
is read as `scrollKdoc`, so an old value never discards the saved session.

---

## 6l. HTML Export and Print

`packages/core/src/render/html.ts` renders mdast to HTML; `packages/app/src/files/export.ts` writes it
to disk or prints it (FR-13.1, FR-13.3).

**Raw HTML is carried through an allow-list, never verbatim.** The pipeline is `remark-rehype` with
`allowDangerousHtml`, then `rehype-raw` to re-parse those raw nodes into real elements, then
`rehype-sanitize` with `KDOC_SANITIZE_SCHEMA` and `rehypeKdocHardening` (both in
`packages/core/src/render/sanitize.ts`). The document file itself still keeps its raw HTML byte for byte
(FR-4.4); only what is *rendered* is filtered. Rendered HTML reaches live DOM in the privileged webview
(Presentation, the track-changes Original view, Print) and exported files, so a document's
`<script>`, `on*` handlers, `javascript:` links, `<object>`/`<embed>`/`<form>`/`<base>`/`<meta>`/`<style>`
and any `<iframe>` other than the YouTube (nocookie) and Vimeo players `media-embeds.ts` builds are
removed. Formatting survives: classes, `align`, image widths, footnote and heading ids, `<mark>`, `<u>`,
`<details>`, media players, and a `style` attribute reduced to an allow-list of presentational
properties (no `position`, no `url()`). `href` keeps `http`, `https`, `mailto`, relative paths and
single-letter Windows drive "protocols"; `src` is not protocol-checked because an image or media
source cannot run script and exports embed `data:` URIs. Theme CSS interpolated into a `<style>` passes
through `escapeStyleContent` so it cannot close the element.

Links clicked in rendered HTML never navigate the webview: Presentation's `followLink` option and
`shell/rendered-links.ts` (`routeRenderedLinks`, used by the Original view) prevent the default action
and hand the href to the shell's own `followLink`.

**Defence in depth.** `tauri.conf.json` sets a real CSP (`script-src 'self'`, no `unsafe-inline` or
`unsafe-eval`; `connect-src` allows `https:` and localhost because the grammar endpoint is
user-configured; `frame-src` only the two video players; `object-src`/`base-uri`/`form-action` none),
with a `devCsp` that also allows Vite's websocket. `src-tauri/src/navigation.rs` registers a
`navigation-guard` plugin whose `on_navigation` hook refuses any top-level navigation outside the app's
own origin (`tauri://`, `http(s)://tauri.localhost`, `about:`, and the dev server in debug builds), so
the frameless window can never be turned into a remote page.

The export stylesheet uses **no CSS custom properties**, and there is a test that fails if any appear.
The exported file has to stand alone, and tokens defined in the app's stylesheet would resolve to
nothing outside it. Its `@media print` block prints link hrefs after the link text, because a printed
page has no clickable links and a reader holding paper cannot reach a URL that is not written down.

**Printing renders into a hidden iframe rather than calling `print()` on the app.** Printing the live
application would print the toolbars, the outline pane, the Source pane, and whatever happened to be
scrolled into view; getting that right would mean a print stylesheet that hides most of the app.
Rendering into an isolated iframe means the printed page *is* the document, and it is also what makes
page setup meaningful, because the `@page` rule then applies to the document rather than to the app.

Two details in that path are deliberate and neither is elegant:

- The iframe is **sandboxed** with `allow-same-origin allow-modals` and no `allow-scripts`: nothing in
  the printed document can execute, while the shell can still write it and call `print()`.
- The iframe is **sized to nothing** rather than `display: none`. A `display: none` iframe does not lay
  out, and therefore has nothing to print.
- The iframe is removed on a one-second timer. Removing it synchronously after `print()` races the print
  dialog in some engines, which then prints a blank page. There is no reliable cross-engine
  "printing finished" signal, so this is pragmatic rather than correct.

`Ctrl+P` is claimed by the app so printing goes through this pipeline instead of the browser's.

### What is not built

**PDF export as a distinct command (FR-13.2)** is not implemented. In practice it is reachable today
through Print, choosing "Save as PDF" as the destination, which is exactly the webview print pipeline
FR-13.2 names. A separate command would be the same pipeline with a fixed destination.

**The page-setup dialog is not built.** `PageSetup` exists and is honoured, but the shell always passes
the default, so paper size, orientation and margin are not yet reachable from the UI. **Headers and
footers with page numbers cannot be done this way at all**: Chromium does not support `@page`
margin boxes, so that part of FR-13.2 needs a different rendering strategy, not a dialog.
Image embedding as data URIs (FR-13.1) was not done here; §6bm adds it.

---

## 6m. Context Menu and Slash Menu

`popup-menu.ts` is one anchored menu component with two callers: the right-click context menu
(`context-menu.ts`, FR-14.2) and the `/` insert menu (`slash-menu.ts`, FR-14.4). One popup rather than
two means they cannot both be open at once, which is the behaviour you want and would otherwise have to
be enforced.

**The popup is a plain positioned `div`, not a `<dialog>`.** This is the opposite choice from the
command palette, and for the opposite reason: a context menu must *not* take focus, because the commands
it runs act on the current selection and a modal would blur the pane and collapse it. The palette uses
`showModal()` precisely because it wants focus for its search box. The cost of not taking focus is that
the arrow keys have to be handled on `document` rather than on the element.

### The context menu

Built from the **caret**, not from the pixel that was right-clicked. ProseMirror moves the selection to
the click position before the `contextmenu` event is dispatched, so reading the caret *is* reading where
the user clicked; hit-testing coordinates as well would be a second source of truth that could disagree.

Groups that do not apply are **omitted, not disabled**. The distinction is deliberate: a disabled item
tells the user the action exists but cannot run here, which is useful; a whole group that does not apply
is noise, and a context menu showing every possible action is just a worse main menu. So the formatting
group is absent with no selection (formatting a zero-width range looks like nothing happening) and
absent inside a code block (inline marks are not expressible there, so it would be four greyed-out lines
telling the user nothing). Cut and Copy, by contrast, are *present but disabled* without a selection.

The clipboard entries use `execCommand`, which is deprecated. It is still the only way to trigger a
clipboard action from a menu without the Async Clipboard API's permission prompt, and Paste from script
is blocked in most browsers - so that entry may do nothing outside the desktop build. It is not the only
way to paste, which is why that is acceptable rather than a defect.

### The slash menu

Fires only when the caret is in a **paragraph whose entire text is `/` plus optional word characters**.
Anchoring the pattern at both ends is what enforces "the block was empty": as soon as any other text
exists, the trigger stops matching and the menu closes on its own, with no separate dismissal rule.
Restricting to paragraphs is also deliberate - a `/` in a heading, table cell or code block is almost
always a literal slash (a path, a date, a fraction) and a menu over it would be an interruption.

Choosing an item **deletes the `/query` text before applying the command**, and re-reads the trigger
position rather than trusting the one captured when the menu opened, because the document can move on in
between and deleting a stale range would remove the wrong characters. Leaving the trigger text behind is
the classic bug here: you pick "Heading 1" and get a heading that reads `/head`.

Each entry shows its Markdown shorthand as a hint, so the menu teaches the input rules and makes itself
unnecessary over time.

---

## 6n. Block Movement and Heading Levels

`structure.ts` holds `Alt+Up`/`Alt+Down` block movement (FR-8.27) and `Ctrl+Alt+Left`/`Ctrl+Alt+Right`
heading promotion and demotion (FR-8.28). Right demotes and Left promotes, matching the direction an
outline indents: deeper on the right, shallower on the left.

**Promote moves the level number *down*** - H3 becomes H2 - because promoting makes a heading *more*
important. That inversion is the single most likely thing here to be "corrected" by a later edit, so it
is stated in the command's own comment as well as in a test.

A move is a delete followed by an insert on the other side of the sibling, with the insert position
computed **before** the delete. The arithmetic holds in both directions because the delete removes
content entirely on one side of the target: after the paragraph moves, the sibling's own size is exactly
how far it travelled.

The caret is restored **inside the moved block**. A move that leaves the caret behind makes a second
`Alt+Up` impossible, and pressing it repeatedly is how the command is actually used. There is a test for
this that does not inspect the selection directly: it moves a block to index 0 and asserts a second move
returns `false`, which can only happen if the caret travelled.

### Two deliberate limits

**Top-level blocks only.** Moving a nested list item is a different operation with different rules - it
has to stay inside its list and carry its children - and conflating the two into one command produces
something that behaves differently depending on where the caret happens to be. Nested list-item movement
is **not implemented**, and `topBlockAt` says so rather than leaving a reader to assume `Alt+Up` handles
it.

**Heading changes do not carry the subtree.** FR-8.28 calls that optional. Doing it would mean
re-levelling every heading until the next one of equal or greater importance - a different command with
a different undo story. A test pins the current behaviour: demoting an H1 leaves the H2 below it alone.

---

## 6o. Typography and Zoom

`typography.ts` turns the appearance settings into CSS custom properties and implements zoom
(FR-14.11, FR-14.12). The settings *model* already existed - `AppearanceSettings` carries the font
families, size, line height and reading width - so this slice is the part that makes it visible.

**Zoom multiplies the font size; it does not apply a CSS transform.** A `transform: scale` scales the
pixel grid and makes text blurry. Changing the font size re-lays-out and re-rasterises at the new size,
which is the only version that stays crisp.

**Zoom is a discrete ladder, not a continuous multiplier.** Every step has to land on a size that still
renders well and keeps the reading measure sensible, and a free-form value reached by repeated 10%
increments accumulates float error until the displayed percentage stops matching the size. There is a
test that zooms in three times and out three times and asserts strict equality back to `1`, which is the
property a continuous multiplier cannot hold.

`clampZoom` **snaps to the nearest step** rather than clamping to a range, so a value restored from
settings written against an older ladder still lands somewhere sane.

### Two things that look like the setting being ignored

- **Multi-word family names must be quoted.** An unquoted `Segoe UI` is invalid CSS and the browser
  drops the whole declaration - which looks exactly like K-Doc ignoring the setting. `applyTypography`
  quotes defensively, and only when the name is not already quoted.
- **Every family gets a real fallback stack.** A font the user names may not be installed, and without a
  fallback the browser silently uses its own default rather than anything chosen.

Both have tests, because both fail *silently* and would otherwise be found by a user rather than by CI.

`readingWidth: 'full'` sets `max-width: none`, and `readingWidthRem` returns `null` for it rather than a
number. Returning 10000rem would read like a measurement while actually being a stand-in for "no limit".

The Source pane shares the font size and line height but **not** the reading width: a wrapped code line
that stops mid-pane is harder to scan than one using the full width.

Every `var()` in the stylesheet carries a fallback, with a test asserting none is missing - that is what
keeps the editor readable between first paint and `applyTypography` running.

### Not yet reachable

Typography reads `DEFAULT_SETTINGS.appearance`. **No Settings window writes to the store yet**, so the
font, size, line height and reading width are applied but not user-editable. Zoom is fully reachable
(`Ctrl+Shift+>`, `Ctrl+Shift+<`, `Ctrl+0`, `Ctrl+-`, `Ctrl+wheel`, and the palette) but does not persist
across a restart.

---

## 6p. The Settings Window

`settings-store.ts` persists, `settings-dialog.ts` edits, and `src-tauri/src/settings.rs` does the file
I/O (FR-14.14, FR-14.15). The *model* already existed in `@k-doc/config`; this is what makes it reachable.

**Only four sections are rendered: General, Editor, Appearance, Proofing** - one per section that
actually has settings behind it. FR-14.14 also names Markdown Style, Files & Links, Review, Export,
Shortcuts, Plugins and Advanced. Those are deliberately absent, because an empty settings tab is a
promise the application does not keep and is worse than the section not being there. A test asserts
every rendered fieldset contains at least one row.

**Settings persist on every change, not behind an OK button.** The dialog has no Cancel, so there is no
pending state to discard - and a preference that only survives if you remember to confirm it is a
preference that gets lost.

**`load()` never rejects; `save()` propagates.** They are asymmetric on purpose. Settings are a
convenience, and an editor that refuses to open because a preferences file is malformed has turned a
cosmetic problem into a total one - so a bad file falls back to defaults and reports how many fields it
had to recover. A failed *save* is different: the user just asked for something and it did not happen,
so that one is surfaced.

A **missing** settings file is the normal first-run case and is not reported at all. The Rust side
returns `Ok("")` for it rather than an error, so a fresh install does not log a failure about a file that
is not supposed to exist yet.

The settings object is treated as **immutable**: every change produces a complete new object rather than
mutating in place, so a consumer can compare old and new by reference to decide what needs re-applying.

Number inputs fall back to the previous value on empty, non-numeric or out-of-range input. An empty
number input reads as `NaN`, which would otherwise be written straight into the file.

Search hides non-matching rows **and** any fieldset left with none, because a section showing a legend
and nothing else reads as a bug.

`SETTINGS_FILE_NAME` is asserted on both sides - TypeScript and Rust each have a test pinning
`settings.json`, so a rename on one side is caught by the other.

### Not done

**Per-vault overrides (FR-14.15).** Not built: there is only the app-level settings file. (A `mergeSettingsLayers`
helper written for it in advance was removed because nothing called it.)

---

## 6q. The Ribbon

`ribbon.ts` is the third consumer of the command registry, after the palette and the context menu
(FR-14.1). It defines no commands of its own - `RIBBON_LAYOUT` is a list of tabs and groups referencing
commands **by id**, and the buttons are built from whatever the registry returns.

That is the payoff the registry was built for, and it is also its one weakness: **the layout names ids
by hand**, so a typo or a renamed command produces a silently missing button rather than an error. Two
things guard it:

- A ribbon id the registry does not supply is **skipped**, and a group left with no buttons is omitted
  entirely. Degrading to a missing button is right; throwing at startup would take the whole editor down
  because someone renamed a command.
- A test resolves **every** id in the layout against a live registry. That test is the thing that
  actually catches the typo, and it is why the skip above can be a quiet fallback rather than a warning.

**Only three tabs: Home, Insert, View.** FR-14.1 also names Layout and Review. There are no layout or
review commands yet - no page setup, no comments, no track changes, no spell check - and an empty ribbon
tab is the same broken promise as an empty settings section. The settings dialog made that decision
first and this follows it.

Three states, cycled by one command: **expanded** shows the tab strip and the panel, **collapsed** keeps
the strip and drops the panel, **hidden** removes both. Clicking a tab while collapsed expands it again,
because a collapsed ribbon whose tabs did nothing would look broken. The cycle ends on expanded so one
more press always returns the user to something usable.

Buttons carry the shortcut in their `title`, so the ribbon teaches the keyboard rather than competing
with it. Every button has the same `mousedown` `preventDefault` guard the toolbars needed - without it,
clicking a ribbon button would collapse the selection before the command ran.

`buildCommands()` on the shell is now the single place the registry is constructed, called fresh by the
palette and the ribbon. Caching it would report stale enabled/disabled results the moment the caret moved.

---

## 6r. The Native Menu Bar

A native OS menu (FR-14.8) came first; it was replaced by the in-app menu bar (6r-bis), and its module was later removed.

**The webview owns the menu; Rust only draws it.** This is the decision the whole file turns on. The
commands live in the TypeScript registry, so defining the menu in Rust would mean a second
hand-maintained list of command ids that could drift from the first. Sending the spec from the side that
owns the commands makes FR-14.8's "mirroring every command" true *by construction* rather than by
discipline - and it is a stronger guarantee than the ribbon gets, because the ribbon still names ids by
hand and needs a test to catch a typo.

`buildMenuSpec` groups by the registry's **own** `category` field. There is no second grouping table to
maintain, and a category with no commands produces no submenu - the same rule the ribbon and the
settings dialog already follow. `Find` is relabelled `Search`, because "Find" names one command and
reads oddly as a menu title.

Separators are inserted where the id prefix changes within a submenu, so `view:*` and `find:*` sit in
visibly different groups without a layout table describing it.

`toAccelerator` translates `Ctrl+B` into `CmdOrCtrl+B`. K-Doc ships Windows-only today, so `Ctrl` would
work - but `CmdOrCtrl` costs nothing and removes a trap the day a Mac build happens. The function is
**total**: an unrecognised part passes through rather than throwing, because an accelerator Tauri cannot
parse fails the menu build in Rust with an error naming the offending item, which is a far more useful
failure than an exception in the translator.

A clicked item re-reads the command list rather than using the one the menu was built from: the menu is
a snapshot, and the command must act on the state as it is now.

An empty accelerator string is not passed to Tauri at all, because an empty accelerator is not the same
as no accelerator and leaves a blank shortcut column on some platforms.

---

## 6r-bis. Material 3 Expressive Chrome, the In-App Menu Bar and Floating Panels

The chrome follows **Material 3 Expressive**: tonal surfaces generated from one seed colour, large
rounded containers, and shapes that change with state. It replaced the short-lived Avimorphism
cockpit styling on the same branch (PR #152) before that shipped; the structural work below (menu
bar, floating panels, floating panes) is unchanged, only the visual language moved. The rule that
shapes every decision is that **the chrome follows the theme and the document page does not change
colour scheme with it**: the page keeps its own `--kdoc-color-*` light/dark tokens.

**Tokens** (`packages/config/src/theme/tokens.ts`). `ThemeTokens` carries four groups: `color` (the
page), `chrome`, `emissive` (status colours) and `radius`. `toCssVariables` emits them as
`--kdoc-color-*`, `--kdoc-chrome-*`, `--kdoc-emissive-*` and `--kdoc-radius-*`, plus two derived
Material elevation shadows, `--kdoc-elevation-raised` and `--kdoc-elevation-sunken`.

**The chrome now differs per theme.** `LIGHT_CHROME` and `DARK_CHROME` are Material tonal palettes
built from a full-chroma blue primary (`#0b57d0` light, `#a8c7ff` dark) with an orange tertiary for
expressive accents. The Avimorphism token **names** were kept so every one of the ~60 component
stylesheets kept resolving: `base` is the window surface, `raised` the toolbar and rails, `recessed`
the highest container tier (fields, ribbon buttons), and `glassTint`/`glassEdge` now carry the opaque
menu/dialog surface and the decorative divider, with `glassBlur` set to `0px` so every former glass
overlay became a Material container without touching its stylesheet. New roles were added beside
them: `containerLow`, `edge` (the 3:1 control outline), `onAccent`, `selected`/`onSelected` (the
tonal selection pair) and `tertiary`/`tertiaryContainer`/`onTertiaryContainer`. User themes
(FR-14.10) keep working because nothing was renamed or removed from the CSS contract.

**Status colours stay reserved for state** under the historic `emissive` name (green saved, amber
unsaved, red error), now per theme so each meets 3:1 on a light chrome. A state is never signalled by
colour alone: a pressed toggle turns from a round outlined pill into a squarer filled one, a selected
segment gains a tick and bold weight, the selected ribbon tab gains an indicator bar, and every one
also carries its ARIA attribute (`aria-pressed`/`aria-selected`/`aria-current`).

**Icons and labels.** `shell/icons.ts` is a small line-icon set (`createIcon(doc, name, size)` builds
an SVG from path data; no `innerHTML`). It replaced the emoji glyphs in both sidebar rails, which are
now slim icon-only navigation rails (48px): each item is an icon in an active indicator, with its
label kept as a tooltip and visually hidden text for assistive technology (`SidebarPanel.icon` is an
`IconName`). The open panel card is 240px and the hosts sit 6px from the window edge. The ribbon's formatting, alignment and list
commands are icon buttons (`RIBBON_ICONS`) with the label kept in a visually hidden span, grouped as
connected button groups with a visible group caption; the style commands keep their text.

**Switches.** Boolean settings are Material switches: the native checkbox keeps its type and gains
`role="switch"`, and a decorative handle beside it grows and shows a tick when on.

**One definition per shared class.** All `*_STYLES` constants are concatenated into one
`<style id="kdoc-shell">`, so a class styled in two stylesheets is decided by load order, not by
the file that owns the component. The shared dialog classes (`.kdoc-dialog-button` and its variants,
`.kdoc-dialog-heading`, `.kdoc-dialog-actions`) therefore carry an identical canonical block in every
dialog stylesheet that defines them, and variants are written as `.kdoc-dialog-button.<variant>` so
they outrank the base. Primary actions (`-primary`, `-save`, `-apply`) are filled accent; destructive
ones use the red status colour on an outlined pill.

**Type.** The chrome typeface is Roboto Flex, bundled through `@fontsource-variable/roboto-flex`
(imported in `main.ts`, weight and optical-size axes) so it works offline; `UI_FONT_STACK` falls back
to Segoe UI.

**`app-menu-bar.ts` is the in-app menu bar**, which replaced the native OS menu of 6r. It is HTML the app draws and can therefore style; the
native menu cannot be, so **the host clears it at startup**. Showing both would have duplicated every
command in two places, one of which could not be made to look like the rest of the app. The unused
native-menu module was removed before the first public release (it is in the git history):
FR-14.8 is superseded, not abandoned, and is now met by this bar instead. It carries ten menus - File, Edit,
Insert, Format, Table, View, Review, Vault, Tools, Help - built over the same command registry as the
palette and the ribbon, with submenus, check-marked toggles, shortcut hints, Alt access keys and full
keyboard navigation.

Where the ribbon names ids by hand and needs a test to catch a typo, the menu bar's test is stronger:
it enumerates the registry against `APP_MENU_BAR_SPEC` and fails if any command is **unplaced or
placed twice**. That is what makes it a complete surface by construction, and it is what allows the
ribbon to stop being one.

**The ribbon became the fast path, not a second menu.** With every command reachable from the menu
bar, `RIBBON_LAYOUT` is curated to what a writer reaches for constantly - Home carrying the text and
paragraph shortcuts, with Insert, Review and View beside it. A **contextual Table tab** appears only
while the caret is inside a table and reverts to Home when it leaves, the way Word does it; it is part
of the default layout only, so a caller-supplied layout is still drawn exactly as given.

**The document panes float too.** `.kdoc-panes` is the window surface; each `.kdoc-pane` is a
rounded card with a page-coloured border lifted off it by a Material level-1 shadow, with a gutter of the base showing around and between the
cards. Split view is therefore two floating documents side by side with the divider running between
them, and the old 1px rule between panes is gone. The pane hides only its horizontal overflow: it is
the document's own scroll container, so `overflow: hidden` outright would stop the document
scrolling — a defect caught in review rather than shipped.

**The ribbon kept its row; two other rows did not.** With the menu bar carrying every command and the
ribbon carrying the fast path, the standalone format and table toolbars were duplicates. Both rows
were removed, and the caret-in-table signal that used to show and hide the table toolbar now drives
the ribbon's contextual Table tab in all four places that computed it, so the behaviour moved rather
than being dropped. The two toolbar modules were later deleted.

**Panels float rather than dock.** Both sidebar hosts leave the flex row for `position: absolute`
against `.kdoc-panes`, which already established a containing block. A panel now overlays the
document instead of shrinking it, as a rounded tonal card (the rail on `raised`, the body on
`containerLow`) with a level-1 shadow. The host itself is `pointer-events: none` so clicks in the gutter reach the document beneath,
and only the cards take input. Mounting, `hidden`-attribute visibility and scroll retention are
unchanged, which is why the change touched no other module.

**The window is frameless and the top bar is its title bar.** `tauri.conf.json` sets the main window
to `decorations: false` and `maximized: true`, and `windows.rs` builds dragged-out `doc-*` windows the
same way, so Windows draws no caption or menu strip. The toolbar, brand and spacer carry
`data-tauri-drag-region` (drag to move, double-click to maximise), and `shell/window-controls.ts`
draws minimise / maximise-restore / close at the right end of the bar through `getCurrentWindow()`;
in the browser build `tauriWindowApi` returns null and nothing is drawn. The capability grants only
`start-dragging`, `internal-toggle-maximize`, `minimize`, `toggle-maximize`, `is-maximized` and
`close`. `main.rs` clears any native menu at startup (`remove_menu`), so no platform default
menu can appear above the frameless window.

**The chrome is compact so the document gets the height.** The top bar holds only the brand, the menu
bar, the view switcher, the theme toggle and the window buttons: Open/Save/Save As live in the File
menu (the file menu still fills the unmounted `.kdoc-file-group`), the Outline toggle is the rail's
job, and Sync Scroll moved to View > Panels as the `view:toggle-sync-scroll` command. The Vault menu
became a File submenu (nine top-level menus). The ribbon is one row with its tab names inline and its
group captions kept only in the DOM; the heading breadcrumb leads the status bar instead of taking a
row; the status bar is 28px; and the left panel starts as its rail. A chevron button in the top bar hides or shows
the whole ribbon row, and `shell/ribbon-preference.ts` remembers the ribbon state across launches
(localStorage `kdoc.ribbon.v1`). The status bar can be hidden the same way: a chevron at its right end or View > Panels > Status Bar (`view:toggle-status-bar`) toggles it, and `shell/status-bar-preference.ts` remembers the choice (localStorage `kdoc.statusbar.v1`). The menu bar's `refresh()` redraws an open menu only when an item's label, shortcut, enabled or checked state changed, so the constant editor transactions no longer close an open submenu under the pointer. `html` and `body` carry no margin, fill the window and never scroll,
so the shell is exactly the window and only the panes, panels and dialogs scroll. At 1440x900 the document starts
about 110px higher than before.

**The panes leave room for the panels** (`packages/app/src/shell/pane-reserve.ts`). Floating over the
document meant an open Outline card covered the opening words of the left pane at a 1440px window.
`installPaneReserve({ panes, left, right, win })` measures how far each host reaches into
`.kdoc-panes` (`reservedInsets`: host edge to panes edge plus a 4px gap, zero for a hidden or
zero-width host) and writes `--kdoc-pane-reserve-left/-right` on the panes element, which pads itself
by them. A `ResizeObserver` on both hosts and the panes re-measures when a panel opens, collapses
(rail only), switches or the window resizes, and Zen mode's hidden hosts measure zero; a value is only
rewritten when it changes, which is what keeps the padding from re-triggering the observer. The cards
still float — the padding moves the panes, not the absolutely positioned hosts. Because the panes
container is now padded, the split divider's drag maths measure its content box, not its border box.

## 6s. Multiple Documents

`tab-set.ts` is the model, `tab-bar.ts` the strip, and `EditorShell` gained `mountDocument` /
`unmountDocument` to swap between them (FR-6.8).

### The refactor this needed

`EditorShell` assumed exactly one `DocumentSession`, and thirteen controllers captured either that
session or the ProseMirror view **at construction**: both bindings, the file menu, both toolbars, find,
outline, recovery, autosave, the watcher, scroll sync, the context menu and the slash menu. None of them
can be pointed at a different document afterwards.

So a tab switch **rebuilds** them. `mountDocument` holds that construction, lifted verbatim out of the
constructor so the first document is built exactly the way every later one is; `unmountDocument` mirrors
it in reverse. The alternative - teaching thirteen controllers to swap their session - would put the same
rebuild logic in thirteen places instead of one, and each would be a separate opportunity to forget a
subscription.

The DOM containers those controllers mount into became fields rather than constructor locals, because a
container outlives any one document.

### Background documents are text, not sessions

A background tab stores its `text`, `path` and dirty flag - **not** a live `DocumentSession`. A session
kept alive would keep its bindings, filesystem watcher and autosave timers alive with it: a background
document quietly watching and writing files. Round-tripping through text is exactly the guarantee the
serializer already makes (FR-4.1), so nothing is lost.

The consequence, stated rather than hidden: a background document's **undo history does not survive** a
tab switch, because the session that owned it was destroyed. Losing history is a smaller harm than a
document editing files while you are not looking at it.

### Closing returns you to what you were reading

`close` activates the most recent **surviving** tab from the MRU order, not the positional neighbour.
Closing should return you to what you were last looking at, which is almost never the tab next to it.
`Ctrl+Tab` uses the same order and returns the *second* MRU entry, which is what makes repeated presses
toggle between the two documents you are actually working across.

Closing the last document opens a fresh empty one rather than leaving an empty window: K-Doc is a document
editor, and no-document is not a state worth having.

Ids are never reused, so a stale reference to a closed tab cannot silently address a new document.

### A layout bug this exposed

`.kdoc-shell` was a grid with `grid-template-rows: auto auto auto 1fr auto` - five rows. The shell had
grown to seven children by the time the ribbon landed, so the `1fr` had drifted onto the **table
toolbar**, stretching it while the panes collapsed. Adding the tab row made it obvious. The shell is now
a flex column: every chrome row sizes itself and the panes take the remainder, which cannot drift when
the next row is added.

### Not done

**Dragging a tab out to a new window.** FR-6.8 names it; it needs Tauri multi-window and a way to hand a
document between windows, which is a different piece of work from a tab strip.

---

## 6t. Spell Check

Five pieces (FR-12.1, FR-12.2): `spell-scan.ts` decides *what* to check, `src-tauri/src/spell.rs`
decides *whether it is a word*, `spell-plugin.ts` draws the squiggle, `spell-check.ts` joins the three,
and `spell-service.ts` owns the dictionary and the word lists.

### The split: scanning is a webview concern, judging is a Rust one

Rust holds the dictionary because `spellbook` is a pure-Rust Hunspell implementation and a 552 KB
wordlist has no business being parsed in the webview on every launch. But Rust is handed **words**, not
a document: it has no schema, no idea that `codeBlock` exists, and no business acquiring one.

So `spell-scan.ts` walks the ProseMirror document and applies FR-12.2's skip rules - code blocks, front
matter, unknown nodes, `inlineCode` - and ships a de-duplicated word list over IPC. A long document
repeats common words heavily, and the answer for a word does not depend on where it appeared.

`link` is deliberately **not** skipped. The URL lives in the mark's `href` attribute rather than in the
text, so skipping marked text would skip the prose the user wrote while leaving the URL unexamined
anyway - the opposite of the intent.

### Decorations map; the check debounces

The plugin holds a `DecorationSet` and **maps it through every transaction** rather than clearing it.
The result is briefly stale after a keystroke, and briefly stale is far less distracting than briefly
absent: clearing on each edit makes every squiggle in the document flicker while you type one word.

The check itself is debounced at 400ms, because the word you are halfway through typing is misspelled by
definition and does not deserve to be told so.

Two checks can be in flight when a fast edit follows a slow IPC call, so a generation counter discards
the older answer. Applying it would resurrect squiggles the newer one had cleared.

### Ignore All is a session; Add to Dictionary is a decision

The ignore set lives in the webview and is **never persisted**. Add to Dictionary is the durable option,
and quietly making Ignore All durable would take away the user's only cheap, reversible choice. `Ignore`
in the review dialog tells nothing to anything - it is "not this one, this once", and belongs in no list
at all.

The user dictionary lives in `localStorage`, not `settings.json`: settings is a validated schema of
*settings*, and an unbounded word list is data. It is pushed to Rust after each dictionary load, because
Rust is a fresh process every launch while the words are not.

### A missing dictionary reports nothing wrong

`spell_check` returns an empty list when no dictionary is loaded, and a 404 on the dictionary fetch is
not an error. Treating every word as misspelled would fill the document with red and get blamed on the
text rather than on the missing asset. A *corrupt* dictionary is a different thing and does report - an
absent dictionary is a configuration, a corrupt one is a fault.

### The dictionary is fetched, not committed

`npm run fetch-dictionary` pulls `en-GB` from `wooorm/dictionaries` - the same maintainer as the
remark/unified libraries K-Doc already depends on - into `packages/app/public/dictionaries/`, which is
gitignored. Adding a 552 KB third-party binary-sized asset to the repository is the repository owner's
call, not this work's.

It is served as a **static asset over the webview's own origin** rather than resolved as a Tauri
resource, because that one path works identically in the Vite dev server, in the packaged app and in
tests; the alternative needs a second code path that only ever runs in one of the three.

### A CSS specificity bug worth recording

The review dialog's clean state hid the review panels with `hidden`, and they stayed on screen anyway:
`.kdoc-spell-review-body { display: flex }` beats the user agent's `[hidden] { display: none }`. The fix
is a `.kdoc-spell-dialog [hidden]` rule at higher specificity. It was found by looking at the dialog, not
by a test, and the regression test asserts on the stylesheet string because the bug is one of cascade
resolution that jsdom does not perform.

### Not done

**Grammar checking** (FR-12.3) and **live language detection**. `spellbook` checks spelling only, and
grammar is a different engine rather than a bigger dictionary. The language comes from
`proofing.language` in settings.

---

## 6u. The Windows Launcher

`start.cmd` at the repository root takes a fresh clone to a running app in one double-click:
`start.cmd` (dev), `start.cmd build`, `start.cmd test`.

Batch rather than PowerShell, because a stock Windows execution policy blocks unsigned `.ps1` files
when they are double-clicked - which is precisely the case the script exists for.

It `pushd`s to its own directory, because Explorer starts a batch file in an arbitrary working
directory and a script that assumes the repository root fails exactly when a non-developer runs it.

`scripts\port-5173.cmd` probes the dev-server port before `dev` mode starts anything, and reports
through its **exit code**: 0 free, 1 K-Doc's own server, 2 somebody else's. A Tauri run that dies while
its Vite child survives leaves an orphan holding 5173, and the launcher then failed with a stack trace
about `strictPort` - a message about the wrong thing entirely.

On 1 it **attaches** to the running server (`scripts/tauri-attach.json` blanks `beforeDevCommand`)
rather than killing it: the launcher did not start that process and has no business ending it. On 2 it
refuses and names the PID, because a port K-Doc does not own is not K-Doc's to reclaim.

The server is identified by **what it serves** - `curl` for K-Doc's `<title>` - not by process name, so
an unrelated `node.exe` on that port is never adopted. If `curl` is unavailable the answer is 2: the
safe error is refusing to touch it.

Both files are written with `if ... goto :label` and **no parenthesised blocks**. A `REM`-only `else`
branch is a parse error in `cmd.exe` (`. was unexpected at this time`), and this code runs before
anything else can report a problem.

Every preflight failure names the fix and the URL, not just the symptom. A missing dictionary is the
one failure that **warns and continues**: spell check degrades to drawing nothing (§6t), so a network
problem must not stop the editor opening. It pauses only on failure - pausing on success would leave a
dead console window behind a running app, and not pausing on failure would hide the message.

---

## 6v. Highlight, Subscript and Superscript

The three Tier-4 inline constructs from the specification (§4.4): `==highlight==`, `~sub~`, `^sup^`,
completing FR-8.1's mark set.

### remark has no plugin for any of them, so they are a pass over the tree

`parse/rich-inline-scan.ts` holds the scanning primitives and `parse/rich-inline.ts` the transform, run
from `parseMarkdown` after `processor.parse`. It needs the **raw source**, not just the tree, and that is
the interesting part: remark has already resolved backslash escapes by then, so `\==x\==` and `==x==`
have identical text values. Only the source can tell them apart.

`sourceOffsets` walks source and value with two pointers, advancing the source by two and the value by one
at each escape, and returns one source offset per value character. A delimiter whose source offset is
preceded by a backslash is skipped. Without this the editor would silently turn something the user
deliberately escaped into a construct - the class of failure FR-4.4 exists to prevent. When the two fall
out of step the function returns nothing and the caller leaves the node alone: declining to transform is
the safe failure.

### Pairing works across siblings, which is why it is not a text-node pass

`==**bold** x==` parses as `text('==')`, `strong`, `text(' x==')`. A transform that split one text node at
a time could never pair those. So the tokens of a whole parent are flattened - literal runs, delimiters,
and untouched child nodes - paired, and rebuilt. Nesting falls out of recursing into the paired interior.

### `singleTilde: false`

`remark-gfm` defaults to treating `~x~` as strikethrough, which would make subscript unreachable. It is
now configured off, so `~~x~~` is still `delete` and a single tilde is left for this transform. The scanner
additionally refuses a `~` adjacent to another `~`, so a stray unbalanced pair in prose cannot become two
subscripts.

### Positions are preserved wherever nothing changed

The rebuilt nodes carry no `position` - they did not come from the parser. That matters, because
`nodeAtOffset` maps a caret to a node through positions and the incremental serializer slices unedited
regions by them. So `transformChildren` returns the **original** children untouched when the parent
contains no delimiter at all. Rewriting every paragraph in the document would have thrown both away for
nothing; the cost is now confined to parents that actually use the syntax. A regression in the position
suite is what surfaced this.

### `highlight` outranks the character formats

`MARK_NESTING_ORDER` decides which mark becomes the outer mdast node. `highlight` sits above `strong` and
`emphasis` because `==**bold**==` is how people write it, and putting `strong` first rewrote that into
`**==bold==**` on every round trip through the K-Doc pane. `subscript` and `superscript` go last: they
wrap a digit or a short token, never a formatted run.

### Literal markers are escaped on output

`unsafe` patterns escape `=` before `=`, and `~` and `^`, in phrasing. A bare `====` therefore comes back
as `\==\==`. That is not byte-identical, but FR-4.1 only requires byte identity for *canonically
formatted* input, and the stability clause holds: it re-parses to the same tree. The visible cost is that a
literal `^` or `~` in prose is now escaped on save, which is the price of the characters becoming syntax.

---

## 6w. Insert Affordances

Three choosers over machinery that already existed: the image dialog (FR-8.14), the table size picker
(FR-8.18) and the code-block language picker (FR-8.8). The `image` node and the `codeBlock` `language`
attribute were already in the schema and already round-tripped - what was missing was any way for a user
to reach them.

### They are commands that open a chooser, not commands that insert something

Each of the three is registered as an **app** command rather than an editor command, because the editor
command underneath needs an argument only the user can supply. `insert:image` opens the dialog;
`insertImage(attrs)` is what the dialog's callback runs.

`insertImage` **replaces** a selected image rather than inserting beside it, so one command both inserts
and edits. `imageAt` looks at the node *before* the caret as well as at the selection, which is what makes
"insert, then immediately edit" work without the user having to reselect the thing they just made.

### Empty is null, everywhere

An empty alt, an empty title and an empty code fence info string are all stored as `null`, never `''`.
mdast distinguishes an absent title from an empty one and the serializer emits them differently, and a
fence with an empty info string is the same thing as one with none. Keeping two representations would
make the output depend on which code path set the value rather than on the document.

`insertImage` refuses an empty `src` outright: an image with no source renders as a broken icon and is
never what the user meant.

### The size picker is anchored to the caret

Not to the button that opened it - the picker is also reachable from the command palette and the menu bar,
where there is no button to anchor to. `coordsAtPos` can throw for a position it cannot map, which happens
while the K-Doc pane is hidden in Source-only view, so the fallback is the pane's own corner: a layout
question should not surface as an exception.

Its 80 cells are built **once** at construction. Rebuilding them per open is work with no purpose, since
the grid never changes size.

It carries the same `mousedown` guard the format toolbar needed: without it, clicking the picker moves
focus out of the pane and collapses the selection, and the table lands wherever the caret fell back to.

### The language list is a convenience, not a whitelist

Forty entries, filtered by substring. Pressing Enter with no match takes the typed text **verbatim** -
refusing an unlisted language would make the picker worse than typing the fence by hand. A
*None (plain text)* entry sits at the top, because clearing a language must be as easy as setting one.

### Not done

**Pasted image data written to an attachments folder.** FR-8.14 names it, but the destination is the vault
attachment path from FR-6.14, which does not exist yet. The dialog takes a path or URL today, and its
`pickFile` hook is the seam a native picker will attach to.

---

## 6x. Clipboard and Drag-Drop

`core/src/parse/html.ts` converts HTML to mdast, `editor/src/prosemirror/clipboard.ts` applies a paste,
and `app/src/files/file-drop.ts` receives files from the OS (FR-7.4, FR-7.5).

### Pasted HTML goes through mdast, not through `parseDOM`

The ProseMirror schema deliberately still has **no `parseDOM`**. The alternative to adding it is better:
pasted HTML is routed through the **same mdast pipeline the rest of the editor already speaks** -
`HTML -> hast -> mdast -> ProseMirror` - so there is one definition of every node and mark rather than two
kept in step by hand.

The consequence is deliberate: anything the HTML expresses that Markdown cannot is **dropped at that
boundary**. That is correct for a Markdown editor - content that cannot be written as Markdown has no
business entering the document, because the very next save would lose it anyway.

### Plain text is parsed as Markdown by default

Text copied out of a Markdown file *is* Markdown. Pasting `## Heading` into a Markdown editor and getting
a literal line of prose is the wrong default, so a text-only clipboard is parsed. `Ctrl+Shift+V` is the
escape hatch, and pasting inside a code block always inserts characters: Markdown structure inside a fence
is text, not structure.

### `Ctrl+Shift+V` cannot be a command, so it is an override

A ProseMirror command runs against a state and has no clipboard to read. The shell records the intent on
keydown - **without** calling `preventDefault`, because the browser's own paste event is the only thing
carrying the clipboard - and the next paste consumes it. The override beats even the presence of HTML: the
user has said explicitly what this paste should mean.

`pasteContent` is the single place a paste is applied, so the paste event, the shortcut and any later
re-paste all run one implementation.

### Copy as Markdown / Copy as HTML use the async Clipboard API

Not `execCommand`, which can only copy what is selected. These write a *representation* of the selection,
which is a different thing. An empty selection reports rather than writing an empty clipboard, since that
would also destroy whatever the user had copied before.

### File drops come from Tauri, not from the DOM

A `File` from a DOM drop has a name but **no path**, so a link or image built from it would point at
nothing. Tauri's `onDragDropEvent` carries absolute paths, which is the only form that can be written into
a document. Images embed; everything else - a Markdown note, a PDF, a spreadsheet - becomes a link,
because a link is always expressible in Markdown and an embed of an arbitrary file is not.

The link is built as a **marked text node** rather than by inserting text and then applying `setLink`: a
drop leaves no selection, and `setLink` would have nothing to apply a mark to.

### Not done

**The Paste Special dialog and the paste-options popup.** FR-7.4 names both. `pasteContent` already takes
the mode and `onRichPaste` already reports the range and the original clipboard, so the machinery is there
- what is missing is the two pieces of UI over it.

**`<mark>`, `<sub>` and `<sup>` on paste.** `rehype-remark` has no mapping for K-Doc's Tier-4 constructs, so
a pasted `<mark>` arrives as emphasis rather than a highlight. There is a test asserting the current
behaviour rather than a comment hoping otherwise.

---

## 6y. The Sidebar

`sidebar.ts` is a panel host: a rail of tab buttons beside a body that shows one panel at a time
(FR-14.6). The outline, which used to be a bare `<nav>` the shell mounted next to the panes, is now the
first panel in it.

**Panels are mounted once and then hidden, never unmounted.** Rebuilding a panel on every switch would
throw away its scroll position and any state it holds, and the outline in particular rebuilds itself from
the document - work worth not repeating each time the user glances at it.

The rail is a **tablist**, not a row of toggle buttons, because that is what it behaves like: the panels
are alternatives, and a screen reader has no other way to learn that. Arrow keys move between them.

Pressing the active tab again **collapses** the sidebar, which is what makes the rail button feel like the
thing it looks like. Collapsing hides the body but keeps the rail, because collapsing to nothing would
leave no way back without a menu.

The toolbar's Outline button now toggles the *sidebar panel* rather than the pane's own visibility. Two
mechanisms deciding whether the outline is on screen would disagree the moment either was used alone, so
the sidebar owns it and the button mirrors its `onActiveChange`.

The rail carries the same `mousedown` guard as the format toolbar and the size picker: without it,
clicking the rail moves focus out of the editor pane and collapses the selection.

### Not done

**Files, Search and Tags.** FR-14.6 names them, and each needs a vault (FR-6.11-6.13) that does not exist
yet. The host is the seam they attach to: a panel is an object with an id, a label, an icon and a `mount`,
and nothing about the host knows what any of them contain.

---

## 6z. Statistics and Semantic Find

`core/src/analysis/statistics.ts` counts, `core/src/search/scope.ts` narrows (FR-12.5, FR-9.4).

### One analyser, two surfaces

The status bar and the statistics dialog both call `analyzeText`. The status bar previously counted words
itself; two implementations disagreeing about how many words a document has would be worse than either
being wrong.

Paragraphs are counted from **text**, not from mdast. The status bar updates on every keystroke, and
re-parsing the document to count paragraphs would make typing pay for a number nobody is reading that
closely.

Sentences are a **heuristic**: terminator runs collapse so `...` is one, and a dot between digits is not a
terminator, but `Dr. Smith` still counts two. That is acceptable in a dialog the user opened deliberately,
where the same guess in the status bar would not be - which is why the sentence count appears only in the
dialog. There is a test asserting the miscount rather than a comment hoping otherwise.

The dialog reads **fresh on open** rather than staying live: it is a snapshot the user asked for, and a
table of numbers moving under a cursor they are not typing at would be motion without information. An
empty selection column shows an em dash, because a zero would read as a measurement and "nothing selected"
is not a measurement of zero.

### Find semantics are a lens over the same search

`findMatches` already returns source offsets, so FR-9.4's three options **filter its results** rather than
becoming a second search. `scopeMatches` drops a match that overlaps a code range or a link's URL range,
or that falls outside the caret's heading section.

Overlap rather than containment is the test, because a match that starts in prose and runs into a code
span is still partly inside the code.

A link's URL range is the subtle part: mdast gives the link's whole range, not its URL's, so the range is
derived by finding `](` inside the link's own source slice. A **reference link contributes nothing** -
guessing at a range would exclude the wrong characters, and excluding nothing merely leaves the text-only
behaviour rather than corrupting a replace.

A section runs to the next heading of the **same or shallower depth**, because a subsection belongs to its
parent section. A caret before the first heading yields `null`, meaning the whole document: "the section
containing the caret" is not defined there, and a null scope must not mean nothing.

The panel skips parsing entirely when no semantic option is on. The common case must not pay for a feature
it is not using.

---

## 6aa. Multiple Carets

`codemirror/multi-caret.ts` is four extensions and no implementation, which is the whole point: CodeMirror
already has a multi-range selection model, and the work was turning it on rather than building it.

`EditorState.allowMultipleSelections` is the piece everything else depends on - without it CodeMirror
silently collapses a multi-range selection to one, and every other extension here becomes inert.
`rectangularSelection()` gives Alt+Drag column selection, `crosshairCursor()` changes the pointer while
Alt is held so the modifier is discoverable rather than folklore, and `Mod-d` is bound to
`selectNextOccurrence`.

**`Ctrl+Click` needs no code at all.** Once the facet is on, CodeMirror adds a caret on a modified click
by itself.

`Mod-d` is bound in this module rather than in `keymap.ts`, beside the facet that makes it work: binding
it where the other shortcuts live would leave a shortcut that silently did nothing if this module were
removed. It sets `preventDefault` because `Ctrl+D` is the browser's bookmark shortcut, and without it the
browser's dialog opens over the editor.

### The edit lock still applies

Multi-caret typing reaches the session only while the Source pane holds focus, exactly as FR-3.1
specifies. This is worth recording because it looks like a bug the first time it is seen: a scripted edit
made without focusing the pane leaves the document untouched and the selection collapsed. That is the lock
doing its job.

### Not done

**The K-Doc half.** FR-7.2 asks for multiple carets in *both* panes, and ProseMirror has no
multi-selection model - its `Selection` is a single range by construction. Drawing extra carets there
would produce a caret that looks live and takes no edit, which is worse than no caret. The Source pane
gets the feature; the K-Doc pane does not, and that is stated rather than papered over.

---

## 6ab. The Annotation Store

Four pieces (FR-6.16 to FR-6.23): `core/store/identity.ts` decides *which document*,
`core/store/jsonl.ts` decides *what a file looks like*, `src-tauri/src/store.rs` decides *where it
lives*, and `app/files/annotation-store.ts` joins them.

This is the layer comments (FR-10) and tracked changes (FR-11) will be written against. It has **no
consumer yet**, which is deliberate and stated rather than hidden - the store's shape had to be settled
before anything was built on top of it.

### Keyed by identity, never by path

A document's identity is one YAML front-matter field, `kdoc_id`, holding a ULID. The store is keyed by
that, so renaming or moving a file - inside K-Doc or outside it - never orphans its annotations.

FR-6.17 shapes the whole module: the field is **lazily added and never volunteered**. `peekId` reads and
never writes. `load` returns nothing when there is no id, without asking the filesystem a question whose
answer is already known. The **only** moment a document acquires an identity is a non-empty `save`, and
the moment the last annotation goes, `withoutKdocId` strips the field - removing the whole front-matter
block when it was the only field, so a document that never had one returns to exactly the text it
started with. A Markdown editor that silently writes metadata into every file it touches is one nobody
can trust with a repository.

The three text functions operate on **source text**, not on a parsed tree, and edit the front matter
**line-wise**. Round-tripping through the parser and serializer would risk reformatting the document
(FR-4.2), and re-serialising the parsed YAML would rewrite the quoting, ordering and comments the user
chose.

### Found the way git finds `.git`

On open, K-Doc walks **up** from the document's directory looking for a `.k-doc/` folder; the first found
is that document's store. If there is none anywhere up the tree, annotations go to a global fallback in
app data, keyed by the same id.

The fallback is **not a degraded mode, it is the default one**: commenting works on a file double-clicked
out of Downloads, with no vault and no setup. And because the key is the id rather than the path,
migrating into a vault later is lossless and reversible - nothing is rewritten, only moved.

### One record per line

A pretty-printed JSON array would conflict on every concurrent addition: both sides touch the same
closing bracket. One record per line means two people adding different comments touch different lines and
git merges them cleanly (FR-6.21).

Records are sorted by id and object keys are sorted recursively, because without that a rewrite could
reorder untouched records and turn a one-comment change into a whole-file conflict. The store's files are
K-Doc's format rather than the user's document, so they always use `\n`.

Decoding **never throws** (FR-6.23). A corrupt line is reported and skipped and its neighbours survive;
duplicate ids keep the last and report the earlier. Annotations are an overlay, and losing one must never
stop a document from opening. A **missing** file reads as an empty string rather than an error, because
absence is the normal state for a document nobody has annotated - while an existing but unreadable file
*is* an error. Absent is a state; unreadable is a fault.

Writes are read-merge-encode, never append: an append cannot express a deletion or an edit.

### The id becomes a file name

`kdoc_id` is validated as 26 characters of Crockford base32 before it is used, and `kind` is validated
against exactly `comments` and `changes` before it becomes a directory name. An unvalidated id is a
path-traversal hole - `../../` in one would write outside the store entirely. The validation lives in the
**free functions** rather than only in the Tauri commands, so the guard holds no matter who calls them.

Writes go to a temporary sibling and are renamed over the target: a partial write of an annotation file
loses annotations, and rename is the only cheap way to make the replacement all-or-nothing.

### Not done

**Bundling annotations into a file** (FR-6.22) - it writes comments as HTML comments, and there are no
comments yet. **The vault workspace** (FR-6.11 to FR-6.15) - file tree, index, backlinks. The store is
deliberately vault-*optional*, so that is a separate piece of work rather than a prerequisite.

---

## 6ac. Comment Anchoring and Threads

The model half of comments (FR-10.3, FR-10.5): `comments/anchor-text.ts` and `comments/similarity.ts`
hold the primitives, `comments/anchor.ts` creates and resolves anchors, `comments/thread.ts` is the
thread. The UI half - the decoration, the margin pane, the filters - is **not** built yet.

### The body Markdown is never modified

A comment points at a range of text, and nothing is written into the document to record that. So the
anchor has to survive the text around it changing. It records
`{quotedText, prefixContext, suffixContext, charOffset, blockHash}` and is re-resolved on load.

`resolveAnchor` is a ladder, and each rung rescues something different:

1. **exact** - the text is still at `charOffset`. The overwhelmingly common case, and nothing else runs
   when it hits, so an unedited document pays one slice comparison.
2. **context** - `prefix + quote + suffix` found elsewhere. Rescues text that merely *moved*.
3. **quote** - the quote alone, choosing the occurrence nearest the old offset, because proximity is the
   only signal left distinguishing several identical strings.
4. **fuzzy** - a sliding window scored by Dice similarity, searched within `FUZZY_RADIUS` of the old
   offset **first** and only widened if nothing there clears the threshold. Bounding it is what stops a
   large document paying a quadratic cost for a comment that has not moved far, which is nearly all of them.
5. **null** - an **orphaned** comment, listed in the pane with its quoted text and never discarded.

### The threshold was measured, not chosen

`MIN_SIMILARITY` is 0.75, and the calibration is asserted in `similarity.test.ts` so the constant cannot
drift away from it unnoticed:

| Edit | Score | Result |
| --- | --- | --- |
| one word changed in a long sentence | 0.905 | resolves |
| a word inserted in a long sentence | 0.959 | resolves |
| a transposed typo in a short quote | 0.857 | resolves |
| a word replaced in a three-word quote | 0.593 | orphans |
| a word replaced in a three-word quote | 0.583 | orphans |

The asymmetry is the point: **orphaning is safe and mis-anchoring is not.** An orphaned comment is listed
with its quoted text and re-anchored in a moment. A comment resolved to the *wrong* text points at
something nobody commented on, and does it with confidence. The threshold sits on the safe side of that,
and the visible consequence - a short quote tolerates less editing than a long one - is inherent to any
similarity measure rather than a defect in this one.

Dice over character bigrams rather than edit distance: O(n) instead of O(n·m), and for "was this sentence
lightly edited" the two rank candidates almost identically. Bigrams are counted with **multiplicity**,
because a set would score `aaa` and `aaaaaa` as identical - exactly the false confidence an anchor must
not act on.

### Threads are pure

Every operation returns a new thread and never mutates its argument, because threads round-trip through
the JSONL store and an in-place edit would make it impossible to tell what changed since the last write.

`deleteEntry` returns **null** when it removes the last comment, because a thread with no comments is not
a thread. `editEntry` on an id that is gone returns the thread unchanged - an edit to something already
deleted is a race, not a fault. `setResolved` returns the same object when the flag already matches, so a
no-op never reaches the store.

### Not done

**Everything the user can see.** The `Ctrl+Alt+M` command, the underline and tint on a commented range
(FR-10.1), the margin pane and its leader line (FR-10.2), the filters (FR-10.4), export handling
(FR-10.7), and portable HTML-comment mode (FR-10.6, P2). The model is complete and tested; the surface is
not started.

---

## 6ad. The Comment Surface

Four layers, each ignorant of the next one down: `core/comments/decoration-spec.ts` decides *what* is
commented, `editor/prosemirror/comment-plugin.ts` decides *how it is painted*, `app/shell/comment-card.ts`
and `app/shell/comments-pane.ts` are the margin pane, and `app/shell/comments-controller.ts` joins them to
the annotation store.

Only the plugin knows about ProseMirror and only the controller knows about the store, so the pane and the
cards - the whole visible surface - are testable in jsdom with no editor at all.

### An edit maps the decorations; it never clears them

The authoritative plan is recomputed on a debounce. Clearing on each transaction would blink every
commented range off on each keystroke and back on a moment later. Mapped positions are briefly
approximate; absent ones are briefly *wrong*, and far more distracting.

Selecting a thread takes the other path: the ranges are kept and only their classes are rebuilt.
Recomputing positions there would let clicking a comment move the comment.

**Confidence drives opacity, not presence.** An anchor the resolver rescued by context or similarity is
still a real comment about real text, and hiding it would lose the comment entirely - but the reader is
entitled to know the position is inferred, and a fainter range says so without needing a second
affordance to explain itself.

The underline is a `border-bottom` rather than a `text-decoration`, because the spell plugin already owns
`text-decoration` on any misspelled word and only one of the two would survive.

### A draft is a thread with no comments

`Ctrl+Alt+M` writes nothing. It pushes a thread with an empty `comments` array and focuses its reply box;
the first reply replaces it with a real thread **reusing the same id**, so the card the user is looking at
does not jump when it becomes real.

The representation falls out of decisions already made elsewhere. `planDecorations` skips a thread with no
comments, so a draft appears in the pane without marking the document - which is right, because a comment
with no text yet has nothing to say about it. `deleteEntry` returns `null` rather than an empty thread, so
an empty thread never arises any other way and the state stays unambiguous. `persist` filters drafts out:
an unwritten comment is not a comment, and writing one would put an empty record into a file that is
committed to git.

Resolved threads are planned **in** rather than out, though `planDecorations` defaults to excluding them,
because the plugin paints a resolved range in its own muted style. Dropping it at plan time would lose
exactly the distinction the stylesheet was written to draw. The pane filter is what hides it from the list.

### What the pane refuses to guess

**The two empty states say different things** - `No comments yet` versus `No comments match the current
filter`. An empty pane caused by a filter looks identical to one caused by having no comments, and the
user cannot tell which without being told.

When the author a filter points at loses their last comment, both the control **and** the variable it
filters by are reset. Resetting only the control would leave the select reading *All authors* while the
pane still showed nothing - worse than the empty pane, because the pane would then be lying about what it
was showing.

**Orphaned threads sort last** rather than interleaved: an orphan has no position in the document to sit
beside, and its stale offset would put it somewhere arbitrary. Each still shows its quote, the only
remaining record of what the comment was about.

### Painted in both panes

`codemirror/comment-marks.ts` paints the plan directly, because **`planDecorations` returns source
offsets, which is exactly how a CodeMirror document is indexed**. The K-Doc pane needs a translation
first, and `prosemirror/offset-map.ts` is it.

The two stylesheets are deliberately identical in colour and weight, so the same comment reads the same in
either pane.

## 6ae. Source Offsets to ProseMirror Positions

A ProseMirror position and a Markdown source offset are different coordinate systems: `**`, `#`, `> `, a
list marker and a fence all exist in the source and not in the tree. `core/position/map.ts` was no help
here - it maps offsets to *mdast points*, which is a different question.

### Built by pairing, not by counting

The mapping is not derived by tracking markup lengths, which would mean re-implementing the parser's rules
and keeping them in step forever. Instead it exploits a fact already true of the pipeline: **the converter
creates ProseMirror text nodes from mdast leaf values in document order.** So walking the mdast tree for
value-bearing leaves and walking the ProseMirror doc for text nodes yields two lists that should line up
one for one, and pairing them by text equality recovers the correspondence the converter threw away.

Each pair becomes an `OffsetSegment`. The gaps between segments are markup, which has no position of its
own.

### Two admissions the design makes out loud

**`linear` is false when a segment's two spans differ in length** - inline code, where the source carries
backticks the rendered text does not, and escaped characters, where it carries a backslash. Inside such a
segment there is no character-for-character counterpart, so an interior offset maps to the segment's
*start* and a range maps to the whole segment. The choice is deliberate and always in the same direction:
**over-covering marks the right words, under-covering can cut one in half.**

**`divergedAt` records where the two walks stopped agreeing.** A one-step resync handles a source leaf that
rendered nothing and a document leaf with no source position, but if neither side can recover, pairing
stops and every offset past that point maps to `null`. Continuing would produce positions that are
confidently wrong, and a comment painted over the wrong words is worse than one that briefly does not
appear - the Source pane still shows it either way.

### The index is rebuilt per plan, never cached

A decoration plan arrives when a comment is added, edited, resolved or deleted - never on a keystroke - so
the walk costs nothing in the common case. A cached index would go stale on the very next edit, which is
precisely the situation in which a wrong position would be painted.

### How the shell holds it

`mountDocument` runs on **every tab switch**, so the store and controller are rebuilt per document and torn
down in `unmountDocument` beside the other per-document panels. The `Ctrl+Alt+M` listener is registered
once in the constructor instead: registering it per mount would add a listener for every document ever
opened.

The shortcut shows the panel **before** creating the draft. `addComment` focuses the new card's reply box,
and `focus()` on an element inside a hidden panel does nothing - the user would press the shortcut and
then have to click into the box themselves.

The selection is read from the **Source pane**, because a comment anchor is a range of source offsets and
only CodeMirror is indexed by those. The consequence is honest rather than hidden: pressing the shortcut in
K-Doc-view-only view switches to split first, because the anchor comes from a pane that has to be on screen.

### Not done

The leader line (FR-10.2), export handling (FR-10.7) and portable HTML-comment mode (FR-10.6, P2).

One gap worth naming: a decoration plan is recomputed on comment operations, not on document edits, so
while the user types the marks are carried by each pane's own change mapping rather than re-anchored.
That is correct in the short run and drifts over a long editing session until the next comment operation
re-plans.

---

## 6af. The Tracked-Change Model

`core/changes/anchor.ts` locates a change, `core/changes/change.ts` is the change and its decisions. This
is the model half of FR-11 only: nothing records changes as the user types, nothing renders them, and
nothing writes the overlay yet.

### Accepting never edits the document

FR-11.5 says the on-disk `.md` always holds the **accepted-plus-pending** text. Follow that through and
the whole design falls out of it:

| | in the document? | accept | reject |
| --- | --- | --- | --- |
| insertion | present | no edit | cut the text out |
| deletion | absent | no edit | put the text back |

So **`applyDecision` returns the source unchanged for an accept**, of either kind, and rejection is the
only operation that edits anything. Accepting is purely the caller dropping the op from the overlay.
Returning the text unchanged states that in the type rather than in a comment nobody reads.

### One anchor, because both kinds ask the same question

A deletion cannot reuse the comment anchor: `resolveAnchor` rejects an empty quote, and a deletion's quote
in the current document is exactly that. But there is a formulation that covers both - **search for the
string the document should currently contain there**:

- insertion: `prefix + text + suffix`, resolving to the span of its own text
- deletion: `prefix + suffix`, resolving to the empty point at the seam its text left

One anchor type, one resolver, four rungs (exact, context, text, offset). The last rung clamps to the
recorded offset rather than giving up, because a tracked change that vanishes silently is data loss in a
way a mis-placed one shown in the review pane is not.

### Two mechanisms, deliberately kept

`applyDecisions` sorts descending by resolved offset **and** re-resolves every anchor against the running
text. Either alone would be correct, and mutation testing proves it: inverting the sort breaks no test,
trusting stale offsets breaks no test, and breaking both together fails three. The redundancy is kept
because the sort also keeps each change resolving on the `exact` rung rather than a coarser one, which
matters when a phrase repeats in the document.

That comment was wrong twice before it was right. It first claimed the ordering was what made the fold
correct; the correction then claimed re-resolution was. Both were over-claims, and only running the
mutations settled it.

### Recording an edit

`changes/diff-edit.ts` answers "the text went from A to B, what changed?" with a common prefix/suffix
diff, and `changes/recorder.ts` subscribes to the session and turns each answer into tracked changes.

The suffix walk is bounded by the already-matched prefix. Without that bound `'aa'` becoming `'aaa'`
counts the same character in both, and the reported range is nonsense.

A replacement yields **both** operations at the same offset, deletion first, because a deletion has no
width in the new text: the inserted characters occupy `[p, p + added.length)` and the deletion's seam is
the point immediately before them. Deletion first is also the order Word shows a revision in.

### What the recorder declines to record

| reason | recorded? | why |
| --- | --- | --- |
| `edit` | yes | the author's own work |
| `undo`, `redo` | no | retracting or restoring work already recorded, not new work |
| `external`, `reset` | no | not the author's edit at all |
| `focus` | no | no text changed |

and two further gates: `tracking`, the user's toggle, and `suppressed`, which `withoutRecording` sets
around the recorder's own writes. Without that second gate, rejecting a change would record a change
describing the rejection, which never terminates. Its `finally` matters as much as the flag: a throw that
left suppression set would silently stop recording for the rest of the session, which is far worse than
the original failure.

**The baseline advances on every notification, including the ones the recorder declines.** That single
invariant is what makes work done while tracking was off impossible to attribute retroactively when it is
switched back on. An earlier draft also refreshed the baseline inside `setTracking`; mutation testing
showed removing it broke nothing, because the listener had already done it. It was deleted rather than
kept as defensive-looking dead code.

### What a change looks like on screen

`changes/decoration-spec.ts` decides that headlessly, the way `comments/decoration-spec.ts` does for
comments. Two things fall out of the model rather than being designed here.

**A deletion's span is a zero-width point carrying its text.** Its characters were removed and live only
in the overlay, so a strike-through cannot be a mark over existing text - the renderer has to
*re-project* a string the document does not contain (FR-11.6).

**Nothing is ever orphaned.** The anchor ladder's last rung clamps, so a change is always placed. That is
a deliberate difference from comments, where orphaning is the safe outcome: a comment merely *points at*
text, but a tracked change **is** an edit, and dropping one loses the user's work. Each span carries the
rung that placed it instead, so a renderer can mark an inferred position.

### Only two of the four display modes are decorations

| mode | plan |
| --- | --- |
| All Markup | spans and bars |
| Simple Markup | bars only |
| No Markup | **nothing** |
| Original | **nothing** |

No Markup is empty for a reason worth stating: **accepting a change never edits the text**, so the
document already *is* the accepted result and a clean preview needs no decoration at all. The property
that made `applyDecision` return its input unchanged is what makes this mode free.

Original is empty because it is not a decoration problem. It is a *different text*, which `originalText`
produces by rejecting every pending change, and the caller renders that read-only instead.

### Painting a change in both panes

`prosemirror/change-plugin.ts` and `codemirror/change-marks.ts`. Both face the same asymmetry, and it is
the reason each needs two decoration kinds where the comment layers needed one:

| | in the document? | painted as |
| --- | --- | --- |
| insertion | yes | an inline **mark** over its own range |
| deletion | no | a **widget** at a zero-width seam |

A deletion's characters were removed and live only in the overlay, so a strike-through cannot be a mark
over existing text. The widget renders a string the document does not contain, which is the only way a
tracked deletion is visible at all. It is `user-select: none` in both panes for the same reason: letting
that text into a selection would put characters on the clipboard the file does not have.

CodeMirror's builder needs one accommodation. A deletion widget and an insertion mark share an offset -
exactly what a replacement produces - and `RangeSetBuilder` throws on that ordering, so the set is built
with `Decoration.set(ranges, true)` and the sorting delegated.

### The author's colour is derived, never stored

`authorHue` folds the author name to a hue with FNV-1a. Two people editing offline and later merging still
see each other in the colours they saw before, because a colour table in the overlay would conflict on
merge - the one thing the line-oriented store was shaped to avoid. Only the hue is decided in core;
saturation and lightness belong to each pane's stylesheet, because the same hue needs different treatment
on a light and a dark ground. The two stylesheets are otherwise identical, so a change reads the same in
either pane.

### The changes controller

`app/shell/changes-controller.ts` joins the recorder, the store and the plan, the way the comments
controller does for comments. Two things about it are worth reading.

**Accepting is the path that does nothing.** The on-disk text already holds the accepted-plus-pending
result, so accepting only drops the op from the overlay - `decide(id, 'accept')` never touches the
document. Rejecting is the single path that writes text.

**And that write must be suppressed.** It goes through `recorder.withoutRecording`, because otherwise the
rejection is itself recorded as a change describing the rejection - which would then be rejectable, and so
on without end. This is the only reason `withoutRecording` exists, and removing it fails three tests.

A bulk rejection is **one** `applyDecisions` call rather than a loop, so the whole set lands as a single
undoable transaction, which is what FR-11.3 asks for.

A change that cannot be placed is **left in the list** and reported, rather than dropped. Unlike an
orphaned comment, a tracked change records an edit the user actually made, so losing it loses work.

### The review pane

`app/shell/review-pane.ts` lists every pending change with its kind, author, timestamp and text, and
carries the tracking toggle, the markup-mode selector and the bulk accept and reject buttons (FR-11.2,
FR-11.3, FR-11.4).

**A row shows what the change did to the text.** An insertion's recorded string is what was added, a
deletion's is what was removed - the same shape of data meaning opposite things, which is why the kind
badge is the row's primary signal rather than decoration, and why a deletion's text is struck through in
the list for the same reason it is in the document.

**The two empty states answer different questions.** *Tracking is off* says nothing **will** happen until
the user turns it on; *No tracked changes yet* says nothing **has**. Showing the wrong one sends someone
hunting for a bug that is not there.

**The pane is told the truth on every render** rather than keeping its own copy of whether tracking is on
or which mode is selected. Two places disagreeing about that is exactly the bug the arrangement avoids.

Rows sort by `createdAt` and then by id, because a single edit records a deletion and an insertion in the
same millisecond and without the tie-break their order would depend on the store's read order.

### Wiring it into the shell

`Ctrl+Shift+E` shows the Review panel **before** flipping tracking, so the user sees the state they just
changed. The controller and pane are rebuilt per document like the other per-document panels; the listener
is registered once in the constructor, because `mountDocument` runs on every tab switch.

Both panes are painted on every plan, whatever the current view mode. Skipping the K-Doc pane while the
Source pane is showing would leave a stale set behind the moment the user switched back.

The K-Doc pane needs `mapChangeSpansToPositions` rather than the comment mapper, because **a deletion is
a zero-width point** and `offsetRangeToPositions` refuses a collapsed range by design - reaching for the
range mapper would silently drop every deletion.

Selecting a change scrolls to `change.anchor.offset`, clamped. That offset is a *hint* rather than a
resolved position, which is good enough to scroll to but not to paint with; painting always re-resolves.

### Four scopes, one filter

FR-11.3's four scopes reduce to one `ChangeFilter` of `{ author?, range? }`, because **an omitted field is
not a filter**: `{}` and `undefined` both mean every change, so "all in the document" needs no case of its
own. The pane offers the scope as a selector read at the moment a bulk button is pressed rather than
tracked as state, so there is no second copy of it to fall out of step, and a scope left pointing at an
author who no longer has changes falls back to the document - otherwise a bulk decision would quietly do
nothing.

The range test has one wrinkle. A deletion is zero-width, and the ordinary overlap test
`start < range.end && end > range.start` excludes a point sitting exactly on a boundary. A reviewer who
selects a paragraph beginning where something was deleted means to include it, so endpoints count as
inside. That allowance is *only* about boundaries: a zero-width point strictly inside a range already
passes the ordinary test, and mutation testing was what corrected that claim.

### Original is a surface, not a decoration

`.kdoc-original-overlay` covers the panes when the markup mode is Original, showing
`renderFragment(parseMarkdown(originalText(...)).root)` - the document with every pending change rejected.
It is opaque and covers rather than sits beside, because Original is a view of the *whole* document and
showing it next to the live one would invite editing the wrong copy.

### Simple Markup's margin bars

A bar says *this line changed* and deliberately not what changed. That single fact decides the whole
shape of the layer:

- **The bar carries no author.** A line can hold changes by several people, and colouring it for one of
  them would be a claim the mode is not making, so both panes draw a neutral hue rather than
  `authorHue`.
- **Two changes on one line draw one bar.** `planChanges` already keys its bars by line index; the
  ProseMirror side dedupes again by block start, because two source lines can fold into one block.
- **Bars are not marks, so they get their own plugin.** `change-bar-plugin.ts` sits beside
  `change-plugin.ts` rather than inside it: the mark plugin's metadata contract is a bare span array and
  is covered by tests, and bars arrive as whole-line signals on the same schedule but a different shape.
  Two small plugins each with one job cost less than one plugin with a branch.
- **The two panes need different coordinates.** A CodeMirror gutter is indexed by source offset, so the
  Source pane takes `bar.lineStart` unchanged. ProseMirror needs a document position, so the shell maps
  each `lineStart` through `offsetToPosition` and *drops* what will not map - a bar in the wrong margin
  claims a line changed that did not.
- **Offset 0 has to be clamped up, not down.** Resolving position 0 lands in the document root at depth
  0, where there is no block to decorate, so the first line's bar would silently vanish. Every in-block
  position is at least 1.

All Markup shows the bars too, as Word does: the bar is the margin's summary of what the marks say
inline.

### Known limitation

`diffEdit` is **single-range**. One transaction touching several disjoint ranges - a multi-caret edit -
is recorded as one change spanning the first difference to the last, including untouched text between.
Rejecting it still restores the original, so it is correct, but coarser than the user's actual edit.

---

## 6ag. Source Pane Gutters

`codemirror/source-gutters.ts` is, like `multi-caret.ts`, a composition rather than an implementation:
line numbers, code folding and bracket matching are all stock CodeMirror 6 (FR-5.2). It is a file rather
than five bare calls in the binding because the binding is wiring, and a named group with a reason
attached reads better there than a list.

**Folding belongs to the language, not to the gutter.** `foldGutter()` draws an arrow only where something
publishes a fold range, and for Markdown that is `@codemirror/lang-markdown`: a fold service that gives a
heading the section beneath it, plus node props for fenced blocks and quotes. Swap the language and the
folding changes with it, which is the correct coupling. `foldGutter()` also carries `codeFolding()` with
it, so the fold state is not installed twice.

That split has a testing consequence worth recording, because mutation testing is what surfaced it.
`foldable()` and `matchBrackets()` are pure functions of the language and answer identically whether or
not the extensions are installed - **removing `foldGutter()` or `bracketMatching()` broke no state-level
test at all.** The suite mounts a real view for those two and asks the DOM, which is the only place the
difference shows.

**The gutters read left to right as identity, then structure, then state**: the line number names the
line, the fold arrow says what the line contains, and the change bar (§6af) says what happened to it. The
change bar ends up nearest the text because it is a property of the content rather than of the row, and
the active line is marked by brightening its number rather than by a background band - a band would run
behind the fold arrow and the change bar and read as a highlight on *them*.

The fold keymap binds `Ctrl+Shift+[` / `Ctrl+Shift+]` and `Ctrl+Alt+[` / `Ctrl+Alt+]`. K-Doc claims none of
those, so nothing is shadowed.

## 6ah. Two Sidebars

`sidebar.ts` now hosts both edges. `side: 'right'` adds `kdoc-sidebar-right`, which does nothing but flip
`flex-direction` to `row-reverse` and move the border to the other side - it adds no layout of its own, so
the two hosts cannot drift apart in anything except which way they open. The rail ends up hugging the
window edge and the body opens inward, which is the only arrangement in which two of these can face each
other across the panes.

They are **two instances, not one host with a switch**, because they hold different panels and answer to
different affordances: the left rail is the outline's, the right rail is where an annotation surface
belongs. Comments (FR-10.2) and Review moved there; the outline stayed.

`startCollapsed` exists because the two hosts want opposite defaults. The left one opens on its first
panel, since the outline is worth seeing unasked. The right one starts as a bare rail, because a comments
column nobody opened is only lost width. An explicitly requested collapse and an empty panel list reach
the same state by different routes, and the code says which is which rather than letting one stand in for
the other.

### The Original overlay used to trap the user

`.kdoc-original-overlay` is `position: absolute; inset: 0; z-index: 5` over `.kdoc-panes` - and **the
sidebars are inside `.kdoc-panes`**. Choosing Original therefore covered the review pane holding the markup
mode selector, which is the only control that can leave the mode. `elementFromPoint` over the selector
returned the overlay, not the selector: the mode was a one-way door.

The fix is a stacking context on the host rather than a change to the overlay: a sidebar is chrome around
the panes, not a pane, so it belongs above anything that covers them. The bug predates the right panel and
would have applied to it identically.

## 6ai. The Comment Leader Line

A margin pane breaks the one thing an inline annotation had for free: you could see what it was about. With
the cards in a column at the edge, a highlighted range and the card describing it are separated by the width
of a pane and nothing says which goes with which. Word draws a thin line between them; so does K-Doc
(FR-10.2).

`leader-line.ts` splits the geometry from the drawing, and the split is the point: **`leaderPath` is a pure
function of three rectangles**, so every rule about when a line should *not* be drawn is decidable without a
layout engine - and each of those rules is a claim the line would otherwise be making falsely.

- Either end missing: nothing to join.
- The anchor's midpoint outside the container: the highlight has scrolled away, and a line running to text
  nobody can see points at a claim it cannot support.
- The card not to the right of the text: the panel is collapsed or they overlap, and a line doubling back on
  itself would be worse than none.

The path is three points, not two. The first two share the anchor's height, so the line **runs level with the
row of text before it turns** - a single diagonal would leave the reader guessing which line it left from.
And the anchor is measured from the **last** client rect rather than the bounding box, because a highlight
wrapping across lines has one rect per line and the line should leave where the text ends, not from the right
edge of the widest row.

### Which pane it anchors in

The rightmost visible one. In split view the Source pane is nearer the panel, and a line starting in the
K-Doc pane would have to cross the Source pane to reach the card, which reads as pointing at the wrong
text. The two panes are queried differently because they mark up differently: the K-Doc decoration carries
an active class, and the CodeMirror mark carries `data-thread-id`.

### Why it follows in a loop

The redraw was first hung on `scroll` and `resize` alone. That is not enough, and the reason is worth
recording: a CodeMirror re-render, a divider drag and a late-loading font all move the geometry without
firing either. So while a card is active the redraw **re-arms itself each animation frame**, and stops the
moment nothing is selected. It costs a frame only during the one moment the line has to be right, and it
makes a stale line - the failure the guards above exist to prevent - impossible rather than unlikely.

## 6aj. Who Wrote This

`general.authorName` defaults to `'You'` - exactly what the app stamped before the field existed, so nothing
changes for a user who never opens Settings. A blank name is refused and falls back to the default with a
warning, on the same reasoning the font fields use: an unattributed comment is worse than one attributed to a
default, and this field is the only thing standing between a reader and *who said this?*

**The name is read through a function, not captured.** `CommentsControllerOptions.author`,
`ChangesControllerOptions.author` and `ChangeRecorderOptions.author` are all `() => string`. Settings can
change while a document is open, and a name fixed when a controller was built would mean renaming yourself
silently did nothing until the next launch - a change that appears to work and does not. Reading it per write
also gives the behaviour a reader of a thread expects: **a reply posted after a rename carries the new name
and the comments above it keep the name they were written under.**

### Editing a comment

`editEntry` had existed in core, tested, since the thread model landed; what was missing was a way to reach
it. The card now has an inline editor per entry, and three of its rules are decisions rather than mechanics:

- **An empty body does not save.** Deleting by stealth is not what a Save button means, and Delete is the
  control for that. The editor stays open so the click reads as understood-and-refused rather than lost.
- **An unchanged body does not save either.** A comment nobody changed must not get an `(edited)` marker.
- **The card trims before dispatching**, so the controller never has to decide what an empty comment means.

`onEdit` returns early when `editEntry` hands back the thread it was given, which is what happens when the
entry id is absent - a race rather than a fault. Repainting and rewriting an unchanged thread would put a
spurious version in the store, and the store is committed to git, so a revision nobody made is a change
somebody has to explain.

### A click into a text box no longer rebuilds the card

The card root has a `click` listener that selects the thread, and every selection ends in a repaint that
rebuilds the card from scratch. A click *inside* a textarea bubbled to it, so **clicking into the reply box
destroyed the element the click was meant to focus** - node replaced, focus lost, anything typed gone. Every
button on the card had called `stopPropagation` first for exactly this reason; the two text boxes were the
ones that had not. This predates the editor and was only found because the editor made it unmissable.

## 6ak. Showing the Matches

Find had always moved the selection to the current match and never showed the others. *15 matches* is a
number the reader cannot act on: it says fourteen more exist and gives no way to see where.

Matches now paint on three surfaces, and the panel drives none of them directly. It owns the search and
reports through `onMatches`; the shell decides what to paint. That split is why the panel needs no idea
that a K-Doc pane or a scrollbar exists.

- **The Source pane** takes the offsets unchanged - a CodeMirror document is indexed by exactly what the
  search produced.
- **The K-Doc pane** needs `offsetRangeToPositions`, and the shell drops what will not map. **Dropping
  shifts every later index**, so the active match's slot in the mapped list is not the slot it had in the
  original, and painting the incoming index against the mapped list would highlight the wrong match. The
  shell tracks the mapped position as it builds the list.
- **The scrollbar gutter** places a tick at `offset / docLength`. That is not where the line will be, since
  lines differ in length, but a scrollbar is an overview: **approximately right about the whole document
  beats exactly right about the part already visible.**

The active match is the same hue at greater strength rather than a second colour, because every match is
the same kind of thing. Both panes use a background tint rather than an underline, since `text-decoration`
is already spent on spell squiggles and `border-bottom` on comment ranges.

### Search in selection

The range is captured **once, when the option is switched on**, and held until it is switched off. It has to
be: the panel's own *next* and *previous* move the selection to each match, so a scope re-read on every
search would collapse to the current match after the first jump.

A match straddling the edge is excluded, because *in selection* means the whole match - replacing half a
word is not what was asked for. And the option refuses to engage when there is no live range: a pressed
button that changes nothing is worse than one that refuses to press.

## 6al. Reordering and Folding the Outline

Dragging a heading moves the **section**, not the line. A heading without its body is not a section, and
that single fact is what makes the gesture mean anything.

`core/outline/move-section.ts` does the work over **source text** rather than the tree, because the text is
K-Doc's document of record and a move is a splice: every byte outside the two edits is identical afterwards.

`outlineSectionRange` bounds a section at the first later heading of the **same level or shallower**, since
everything deeper belongs to it. (It is named for the outline because `search/scope.ts` already has a
`sectionRange` that resolves a section from a character offset rather than an outline index.)

Three rules in `moveSection` are decisions rather than mechanics:

- **The insertion offset is computed in the text with the section already removed.** Taking it out shifts
  every offset after it, so the original destination would land the section that many characters too far
  along. This is the one that a test caught and a reader would not.
- **A section dropped inside its own subtree is refused.** That is what a drag onto one of its own children
  means, and a section cannot contain itself.
- **A section moved from the end of the file gains a trailing newline.** It has none, and pasting it in
  front of another heading would weld two headings onto one line.

A move that changes nothing returns the same string, and the shell checks for that rather than applying it -
an undo entry for an edit that did not happen is worse than no feedback.

### Folding

Collapsed headings are held **by start offset, not by index**: an index is a position in a list that changes
on every keystroke, whereas the offset survives an edit somewhere else entirely.

A collapsed section's rows are **not built at all** rather than hidden with CSS, so keyboard navigation and
the active-row search never land on something invisible. And the visibility test asks whether *any* ancestor
is closed rather than the nearest one, because collapsing a grandparent must hide a grandchild even when the
parent is expanded - the rows in between are gone too.

The twisty sits outside the row button rather than inside it: a button inside a button is invalid HTML and
every browser recovers from it differently. Its click stops propagating first, because the row is a jump
target and collapsing must not also navigate.

## 6am. Encoding

`src-tauri/src/encoding.rs` recognises four encodings and **refuses to guess at any other**. The only ones
it knows are the ones that announce themselves with a byte order mark - UTF-8 (`EF BB BF`), UTF-16LE
(`FF FE`), UTF-16BE (`FE FF`) - plus plain UTF-8 as the default for a file that announces nothing. A UTF-16
file without a BOM is indistinguishable from binary without statistics, and statistics are a guess. Guessing
and then saving the guess is how a file gets corrupted by the tool that was meant to edit it.

The encoding rides the whole round trip: `read_text_file` reports it, the webview carries it, and
`write_text_file` writes the file back as it was found. **K-Doc neither adds a byte order mark nor removes
one, and never converts a UTF-16 file to UTF-8 behind the user's back.**

It is a **name rather than a boolean** on the wire. `had_bom` could only ever answer *UTF-8 with or without a
BOM*, and the question the save side has to answer is *what was this file*. An unrecognised name coming back
from the webview falls back to UTF-8, which is the one outcome that cannot corrupt a file that already was
UTF-8.

Two details the tests pin and a reader would not assume: a UTF-16 payload with an odd byte count is refused
rather than having its dangling byte dropped, and a non-BMP character is two UTF-16 code units, so the naive
one-char-one-unit assumption breaks exactly there.

## 6an. The Status Bar Answers Clicks

FR-14.5 names three segments that do something. The word count opens statistics - a count the reader wants
to act on should be the way in to the detail, rather than making them hunt through a menu for the number
they are already looking at. The mode indicator switches the view, because it already names the mode and
clicking the name of a thing to change it is the shortest path there is. And the encoding cycles.

Cycling rather than opening a menu is deliberate: there are four encodings, a dropdown for four items is
more ceremony than it is worth, and the segment always names the current one so the user can see where they
are. The message says **next save**, because nothing has been written yet - changing the encoding is a
statement about what the next save will do, not an immediate conversion. Rewriting a file the moment a
control changed would be a destructive act nobody asked for.

## 6ao. Three Ways to Show a Comment

The three display modes answer different questions, which is why a toggle exists rather than a default:
**margin** is for reviewing, **inline** is for reading a document that has been commented on, and **hidden**
is for reading it as if it had not been.

- **Margin** paints the highlight and nothing else. It is the default because it is the behaviour that
  existed before the toggle, and a setting that changed what a user already saw would be a surprise rather
  than a preference.
- **Inline** keeps the highlight *and* adds the comment's text after the range. Both, not either: the note
  says what the comment is, the highlight says what it is about, and one without the other is half an
  answer.
- **Hidden** draws neither. It hides the **markup**, not the comments - the pane still lists every thread,
  because it is the panel the user deliberately opened.

**Only the first comment of a thread is drawn inline.** A thread of six replies rendered into the document
would bury the text it annotates; a conversation belongs in the pane. And the note sits at the range's
**end**, because a comment is about the text before it.

The note is a **widget in both panes**, for the reason the tracked-change deletion widget is: its text is
not in the document, and a widget is the only decoration that can draw characters the file does not contain.
The Source pane takes the offset unchanged; the K-Doc pane needs `offsetToPosition`, and a note the mapper
cannot place is dropped rather than guessed at - a note beside the wrong sentence says the wrong thing about
it.

The toggle never leaves the controller. The pane owns the control and the controller owns what it means, so
routing the choice out to the shell and back would add a hop that decides nothing.

## 6ap. Code Blocks

**The rendered view is the K-Doc pane**, so highlighting has to happen there - there is no separate HTML surface
to highlight.

It reuses the **same Lezer parsers the Source pane already loads**. A second highlighting engine would
colour the same code two different ways in two panes of one window, and the only thing worse than no
highlighting is highlighting that disagrees with itself.

Only languages K-Doc ships a parser for are highlighted - JavaScript, TypeScript, CSS, HTML and Markdown,
under the aliases people actually write in a fence. A fence saying `sh` or `python` renders plain, because a
wrong grammar produces confident, wrong colours.

### Two plugins, not one

The copy button is a separate plugin from the highlighter, because **copying has nothing to do with the
grammar**. Tying them together would cost a `bash` block its copy button for the entirely unrelated reason
that K-Doc ships no `bash` parser.

The button is a widget, so it is not part of the document and never reaches the clipboard payload - which is
read from the ProseMirror node rather than the DOM. It is `contenteditable="false"` so a click cannot put
the caret inside the code, and `user-select: none` so a **native** selection dragged across the block does
not sweep its label in. That last one was found by running it: `pre.textContent` read `Copiedconst answer…`
before the rule existed - a copy button that copies itself, exactly the failure the file's own header warns
about.

It is revealed on hover **and on keyboard focus**, because a control that only appears under a pointer
cannot be reached without one.

## 6aq. Reordering a Table

Every row and column operation is a **grid rewrite**: the table is read out into an array of arrays of
cells, the array is spliced, and `applyTableRewrite` builds a new table from it. Nothing tries to patch a
ProseMirror table in place, because every row/column operation is the same operation on a different axis and
one rewrite path is easier to keep correct than six mutation paths.

**Row 0 is the header and does not move or duplicate.** GFM has no table without a header row, so a move
that could take it out of first place would produce something the format cannot express. That rule lives in
exactly one place - the body-row range in `moveRowTo` starts at 1 rather than 0 - rather than in a separate
guard that would have to be kept in step with it.

**A column's alignment travels with the column.** Alignment lives on the table in mdast, not on the cell, so
moving a column without its alignment entry would land it right-aligned in a left-aligned slot. The vector is
padded to full width before any splice, because a table's align vector can be shorter than its column count
and splicing into a short array silently shifts every entry after the insertion point.

A duplicated row shares its cells with the original. ProseMirror nodes are immutable values, so one node may
stand in two places; copying them would allocate a second tree to hold content that can never diverge.

### Grips

A grip is a **widget decoration**, so it is never part of the document - a handle that ended up in the
Markdown would be a handle that corrupted the file it was meant to help edit. The row's grip sits in the
content of its first cell and a column's grip sits in its header cell, because a cell holds `inline*` and
renders as a `<td>`: a `<span>` placed directly under a `<tr>` is invalid HTML that a browser hoists out of
the table entirely. A column has no node of its own in this schema, which is why its handle lives on the
header cell - also where a reader would reach for it.

The drag carries **nothing but two integers**. The dragged index is recorded in the plugin's own closure
rather than on the `DataTransfer`, since a drag inside one table has no business being droppable anywhere
else, and the closure is created per `createTableGripsPlugin()` call so two editors never share one drag.

The move commands resolve their table from the **selection**, and a drag never moves the caret, so a drop
puts the caret in its own cell before asking for the move. Without that, dragging a grip while the caret sat
in a paragraph elsewhere would silently do nothing.

Each grip's widget key carries the table's position as well as its own index, and is written onto the
element as `data-kdoc-grip`. A key has to be unique across the whole document or ProseMirror may treat one
table's grip as another's and reuse its DOM; putting the key on the element makes that property something a
test can see rather than an assertion buried in a decoration spec.

Whether a drop ends where it began is left to `moveRowTo`, which already refuses a move that goes nowhere.
Repeating that test in the drop handler would be a second place for the rule to be stated and a second place
for it to drift.

## 6ar. Multi-level Lists

### A binding is not a command

Indent and outdent existed only as Tab and Shift-Tab in the keymap. A binding cannot be put on a toolbar,
offered in the command palette, or asked whether it applies right now - so a list operation that only a key
could reach was one a user who did not know the key could not reach at all. `indentList` and `outdentList`
wrap the same `prosemirror-schema-list` primitives the keymap already used, so there is one behaviour with
two ways in rather than two behaviours.

`indentList` refuses on the first item of a list, because an item with no sibling above it has nothing to
nest under. That refusal is what greys the toolbar button out in exactly the right place.

### Joining, before nesting

`toggleList` on a paragraph that follows an existing list of the same kind produces a **second, adjacent**
list rather than adding an item to the one above. `sinkListItem` then correctly refuses, because the new
item is the first item of its own list - so asking for level 2 silently produced a level-1 list.

`applyListScheme` therefore joins the new list into the one above before it nests. The join is also right on
its own terms: GFM renders two adjacent lists of one kind as a single list, so the document already
disagreed with what the user saw.

The join acts on the **innermost** list enclosing the caret - the one that directly holds the item needing a
sibling. Joining an outer list would merge two lists somewhere above while leaving that item exactly as
unnestable as before, which is the wrong edit made silently. `canJoin` decides whether the two neighbours
may merge at all, which is how a numbered list is stopped from absorbing a bullet one.

Each nesting step has to see the document the previous one produced. The command has no view, so it captures
the transactions it dispatches and re-applies them to a local state as it goes.

### What "multi-level" can honestly mean here

Word's multi-level list picker offers marker *schemes* - `1. / a. / i.`, discs then circles then squares.
Markdown has no way to say any of that: nesting is indentation, and the rendered marker is the renderer's
choice. So the gallery offers what the format can actually express - the three list kinds at three nesting
depths - and the tiles preview the **shape** of each, cascading the indent down three rows.

`listDepthAt` returns `null` outside a list and a 1-based depth inside one, because the gallery has to tell
"not in a list" from "level 1" and would otherwise mark a tile for a caret standing in a paragraph. The
gallery marks the tile the caret is already on, because a gallery that cannot say which of its nine tiles
you are standing on is a menu with pictures.

Asked to nest deeper than the list can go, the command stops where it can and still reports success.
Refusing outright would leave the user with no list at all, which is further from what they asked for than a
list one level shallower than they wanted.

## 6as. Styles and Callouts

### A gallery, not a menu

Word's Styles gallery draws each entry **in the style it applies**. That is the whole difference between a
gallery and a list of names: the user picks by recognising the shape they want. K-Doc's gallery is fourteen
entries in four groups - Normal, Heading 1-6, Quote, Code Block, and the five callouts - each rendered in
its own preview rule, with the caret's own style marked and every entry whose command refuses greyed out.

Each entry is **dry-run** rather than reasoned about. Asking the command whether it applies is the only
answer that cannot fall out of step with what the command does when clicked.

The block-type `<select>` stays beside the gallery rather than being replaced by it. It is the fast path for
the seven styles a writer reaches for constantly and it carries the `Ctrl+Alt+0..6` keys; the gallery is the
full set, shown as what it looks like.

Reading the caret's style and writing a style are **not mirror images**. Reading has to pick one answer out
of several that are true at once, so the order of the checks is the answer, not an implementation detail: a
callout is asked about before a quote, because a callout *is* a quote and the quote check would swallow it;
headings are asked about before quotes, because a heading inside a quote is the block the caret is in. A
block with no entry - a table cell, a list item - marks nothing, because that is the truthful answer.

"Quote" is the one entry whose command is not a toggle. Applying it to a callout strips the marker and
leaves the quote; applying it to a plain quote does nothing and says so, because `toggleBlockquote` would
take the quote *away* - the opposite of picking the style you are already in.

### A callout is not a node

GitHub and Obsidian both write a callout as a blockquote whose first line is `[!NOTE]`, and that is ordinary
Markdown: a reader that knows nothing about alerts still sees a quote with a line of text in it. Adding a
`callout` node to the schema would have bought a prettier tree at the cost of a document only K-Doc can read.

So the marker paragraph stays in the document, and the colour is **node decorations** over the blockquote.
The marker is decorated rather than hidden: a marker invisible in the K-Doc pane but present in the Source
pane is a difference between two views of one document whose effect the user can see and whose cause they
cannot - they would delete the word they can see and wonder why the colour stayed.

Each kind carries its accent on one custom property, so the panel rule is written once and each kind only
says what colour it is, and the tint comes from `color-mix` on that same accent rather than five hand-picked
pale colours that would drift out of step with it.

### The escape that broke every reader but this one

**Found by running it, not by a test.** The callout rendered correctly in K-Doc while the file on disk said
`> \[!NOTE]`. The serializer escapes a leading `[` in prose and is right to - a bare `[` could start a link,
and `\[` is what keeps the round trip stable - but inside an alert marker that escape is fatal: GitHub and
Obsidian both render `> \[!NOTE]` as the literal text. An editor whose promise is that the file on disk is
ordinary Markdown cannot ship that.

The fix is a paragraph handler that emits the marker without `state.safe`, which is what inserts the
backslash. The exception is deliberately narrow: only the **first block of a blockquote**, only when it
opens with a text node, and only when that text matches `[!WORD]` followed by a line break or the end of the
paragraph. `[!NOTE] and more` is prose and keeps its escape - the lookahead is what tells those apart - and
so is a marker anywhere but the opening block.

The first version of that handler recognised only a marker that was a paragraph *by itself*, which is what
K-Doc's own editor produces. It is not how a marker usually arrives: `> [!NOTE]\n> body` is a **single**
paragraph, because a quote's continuation line joins the one above it. A GitHub file read in and written
straight back still came out escaped - the same defect surviving in the commonest shape of the thing. The
handler now takes the marker off the front of that first text node and serialises the remainder normally, so
only the marker skips escaping and everything after it keeps what it needs.

An unknown alert word such as `[!QUESTION]` is emitted unescaped too, because the serializer asks only
whether the line has the *shape* of an alert: a word K-Doc does not colour is still one some other reader
might, and re-escaping it would change somebody else's document. `calloutAt`, which decides what to colour,
is stricter and refuses it.

**Known limitation.** A compact `> [!NOTE]\n> body` read from disk round-trips byte-for-byte but is not
recognised as a callout to colour, because its marker and body share one paragraph. Nothing is lost or
corrupted; it renders as the plain quote it structurally is. Recognising that shape belongs with FR-8.10.

## 6at. The Rest of the File Menu

### Three verbs that are not each other

**Save As** moves the document to a new file and leaves the old one where it was. **Save a Copy** writes a
second file and leaves the document where *it* was. **Rename** moves the file and takes the document with
it. They are three different promises, and a user who picked one would be surprised to get another.

Save a Copy therefore does not touch the current path, does not call `markSaved`, and does not record the
copy as recent. All three omissions are the point: the document being edited is still the original, marking
it saved would say the unsaved changes reached the file on screen when they reached a different one, and
offering the copy in Open Recent would offer a file the user has never had open.

Rename refuses an untitled document and refuses a dirty one. The second refusal matters more than it looks:
renaming a file with unsaved changes would leave those edits pointing at a path that no longer exists.

### The host does the filesystem

`rename_file` and `reveal_in_file_manager` are Rust commands because both are about the filesystem and the
shell, and the webview can reach neither.

The rename **refuses to overwrite**. `std::fs::rename` silently replaces an existing target on both Windows
and POSIX, and a rename that destroys a file the user did not name is the kind of data loss noticed a week
later. That guard is the reason the command exists rather than the webview calling rename directly.

Reveal opens the file manager with the file *selected*, not merely its folder opened - the point is to show
which file, and an opened folder of two hundred files does not. On Windows that is `explorer /select,`,
whose exit status is non-zero even on success, so only the failure to *launch* it is treated as an error.
Linux has no portable select-the-file, so the containing folder is opened and the comment says so.

### One owner for the recent list

The list lives in `settings.json`, because a recent-files list that did not survive a restart would be a
list of what you did since launch - which the user already knows.

It has exactly one owner: `recent-files-controller.ts`. The dialog shows what it is given and reports what
the user did; the settings store persists what it is handed; the pure functions in `@k-doc/config` do the
arithmetic. Every one of those would work perfectly while disagreeing with the others if any two also held
a copy. The controller re-reads the list from the settings on every operation rather than caching it, so it
cannot hold a stale copy of the one thing it is supposed to own.

**Pinning is what makes it a list rather than a log.** An unpinned entry is a record of what you last
touched and is evicted by newer work; a pinned one is a statement that this file matters. The two are
capped separately - the unpinned tail has a limit of ten and the pinned head has none - because a limit
that overrode a pin would make pinning a suggestion. Unpinning does not remove the entry at that moment
even when the list is over its limit, because removing it right then would look like the unpin deleted it.

A malformed entry in a hand-edited `settings.json` costs that entry and not the list: one bad line in a
list of ten should lose the user that line. A missing entry is a menu item that is gone; a refused list is a
menu that is empty.

## 6au. Paste Special

### Changing your mind, not reading the clipboard

Word's Paste Special pastes immediately from the clipboard. K-Doc's does something subtly different and
better suited to where it lives: it **re-reads the paste that already happened**.

The payload is handed over by the paste event and kept, rather than read back from the clipboard later. Two
reasons, and the second is the stronger: by the time the user decides they wanted a table the clipboard may
hold something else entirely, and reading the clipboard unprompted is a permission a text editor should not
need.

So the flow is Word's, arrived at from the other end. A paste happens; a small control appears at the caret
offering the other readings; the full dialog is one click further on, or `Ctrl+Alt+V` away. With nothing
pasted yet the dialog falls back to arming the next paste, the same mechanism Paste as Plain Text uses and
for the same reason: a command cannot reach the clipboard.

### Only the readings that would work

Both surfaces ask `parseDelimitedText` and the payload itself which readings are possible, rather than
offering all four and letting three of them quietly do nothing. Plain and Markdown need text; HTML needs an
HTML representation; Table needs the text to be tabular.

The dialog **greys** what is impossible and the popup **omits** it. That is not an inconsistency: a dialog
whose contents change shape between invocations is one the user has to re-read every time, while the popup
sits over the document and every millimetre it occupies covers the text the user is deciding about.

### A tab is a column; a comma is punctuation

Copying a range out of Excel, Sheets or a Word table puts tab-separated text on the clipboard. The split is
on tabs only. A spreadsheet emits commas solely when asked for CSV, and guessing at them would turn
`Hello, world` into a two-column table - being wrong there is worse than not offering the option.

Every line must contain a tab, or the text is prose. The first row becomes the header, because GFM has no
table without one and the alternative is inventing a row of nothing at the top of the user's data. A ragged
grid is padded to its widest row, because a spreadsheet range with a merged cell produces one and GFM tables
are rectangular. Alignment is left unset: pasted data carries none, and inventing it would assert something
about the data the user did not say.

### The range a paste occupied

**Found by running it.** Pasting a TSV, choosing Table, then choosing Unformatted Text inserted the text
*into* the table instead of replacing it.

The range had been read off the selection after the dispatch. For an inline paste that is right, which is
why every test before that one passed - but ProseMirror puts the caret **inside** a newly inserted block, so
after a table paste the recorded range was one of its cells.

The edges of a replacement are the old edges **mapped through the transaction**, with the bias that keeps
them outside what arrived: `-1` at the start, `1` at the end. The start needs mapping as much as the end
does, because a table pasted over a text selection is lifted out of the paragraph that held it and the
starting position ends up one step inside the new block.

`pasteContentAt` returns that range; `pasteContent` is kept as a boolean wrapper because most callers only
need to know whether anything happened.

## 6av. Page Setup

### Real margin boxes, not faked ones

Running headers and footers are `@page { @top-center { ... } }` - genuine paged-media margin boxes. The
usual web workaround is a `position: fixed` element, which Chromium repeats on every printed page but which
cannot count them: `counter(page)` only resolves inside a margin box.

That the engine supports them was **checked rather than assumed** - the rule was parsed and read back
through `cssRules` to confirm it survived rather than being dropped. Without that, a page number would have
had to be a guess about where the page breaks fell.

### Templates, not literals

Header and footer are templates over `{title}`, `{page}` and `{pages}`, because the useful things to put in
a running header are the document's title and the page count and neither is known when the user types the
setting. `runningContent` compiles a template into a CSS `content` value: tokens become `counter(...)`
functions and everything else becomes a quoted string.

A title comes from a filename and a filename can contain a quote, which would close the CSS string and leave
the rest of the rule as broken syntax - so literals are escaped, and newlines are flattened to spaces.

An empty template produces an empty value, and an empty value writes **no margin box at all**, because a box
with nothing in it still reserves its space on the page.

### The contents page belongs to printing

`includeToc` prepends a contents page built from the document's own headings. It is assembled by the
printer, not by the renderer: it is not in the Markdown, and a renderer that added it would put it in the
HTML export and the presentation slides too.

The list is flat with a depth class rather than genuinely nested, because a document can jump from an `h1`
to an `h3` and building real nesting out of that means inventing levels the author did not write. A document
with no headings gets nothing, because a heading reading "Contents" over an empty list is worse than no
contents page.

`break-after: page` is what makes it a contents *page* rather than a paragraph the document happens to start
with.

### The dialog prints

Its primary button says **Print**, because that is what accepting it does. A page-setup dialog that only
recorded a setting would leave the user to find Print afterwards and wonder whether the setting had taken -
and the only way to see a page setup is to look at a page.

The setup is remembered for the session but **not persisted**. It belongs to a printing rather than to the
document: a margin chosen for one handout is not a fact about the file, and writing it into `settings.json`
would make it one.

The margin is clamped on the way in *and* on the way out. The browser's own `min` and `max` constrain the
spinner, not what a user can type or paste, and a margin the page cannot hold prints nothing at all.

## 6aw. Callouts

### The marker is a line, not a paragraph

`> [!NOTE]` followed by `> body` is a **single paragraph**: a quote's continuation line joins the one above
it. So a rule that required the marker to be the paragraph's entire text recognised only the shape K-Doc's own
editor produces, and missed the commonest shape a GFM file arrives in. `parseAlertMarker` matches the marker
at the start of the text with a `(?=\n|$)` lookahead, which is what separates a marker opening a line from
`[!NOTE] and more`, which is prose.

That the marker is part of a larger paragraph is also why it is decorated **inline** rather than as a node
decoration. A node decoration over the paragraph would style the body as the title too.

### An unknown alert word is still an alert

`[!QUESTION]` is somebody else's extension or the user's own. Refusing to colour it would make K-Doc the only
reader that treats it as prose, and colouring it as one of the five K-Doc knows would be a guess. So
`AlertMarker` carries the `word` and a `kind` that is `null` for anything outside the five, and the panel
gets `kdoc-callout-custom` and a neutral grey accent - visibly a callout, visibly not one of the named ones.

`calloutAt` and `alertMarkerAt` are deliberately different questions: "which of the five is this" and "is
there a marker here at all".

### The custom entry has no command

Every other Styles gallery entry *is* a ProseMirror `Command`, and a command run without a dispatch reports
rather than edits - which is how the gallery greys out an entry that cannot apply. The custom callout cannot
work that way: its word does not exist until the user has been asked for it.

So `canApplyStyle` answers for it separately, by probing the only question that does not depend on the word:
can a callout go here at all. The probe runs `setCalloutWord` with a valid word and **no dispatch**, so it is
a report; a probe that dispatched would write `[!NOTE]` into the document every time the gallery was opened.

Applying it is intercepted in `applyStyle`, which asks for the word and then runs `setCalloutWord`. The
prompt opens on the word the block already carries, so changing NOTE to NOTICE is an edit rather than a
retype. GFM's alert syntax admits letters only, and a word with a space or a digit in it is refused and said
so - a dialog that accepted a word and then changed nothing is worse than one that says why.

## 6ax. The Merge View

### There is a common ancestor, so use it

When a file changes on disk under a buffer with unsaved edits, the old prompt asked one question --
yours or theirs, all or nothing. Most of the time that was the wrong question: two people editing
different parts of a document are not in each other's way, and either answer threw away work.

The buffer and the file on disk both diverged from the same text: what was on disk when K-Doc last wrote
it. `SessionSnapshot.savedText` exposes it, and `dirty` is simply that text differing from the current
one. With a base, a change only the buffer made and a change only the other program made can both be
taken without asking anybody anything, and only a run of lines both sides changed *differently* is a
question worth putting to the user.

### Line-based, and lossless

`packages/core/src/merge/` is three files and no dependencies. `line-diff.ts` is a Myers diff over lines.
`replacements.ts` reduces a diff to replacement ranges over the base. `three-way.ts` sweeps the two sides'
ranges into hunks and classifies each one.

`splitLines` splits on LF only and does **not** strip a trailing CR, so `joinLines(splitLines(t)) === t`
for every string. That invariant is what makes a merge lossless: K-Doc never normalises line endings
(FR-6.6), and a merge that re-guessed them would rewrite every line of a CRLF file to settle one.

The diff is line-based rather than character-based because the existing `diffEdit` is a single-range
diff: two edits five hundred lines apart collapse into one range spanning everything between them, which
would make every merge one enormous conflict.

### The four kinds of hunk

`stable` when both sides agree -- including when both made the same change, which is not a disagreement.
`mine` and `theirs` when only one side touched the run; those are taken silently. `conflict` only when
both changed it and landed somewhere different.

`resolvedText` takes a map of choices for the conflicts. **A conflict with no choice resolves to the
buffer's own text**, never to disk. The dialog always supplies one; the fallback exists so that a caller
which forgets loses nothing rather than losing the user's unsaved work.

Two changes on neighbouring lines are two hunks, not one. The group-growing test is
`change.start < groupEnd`, and making it `<=` would fold adjacent edits together and report a conflict
between changes that never met.

### The dialog shows both sides

`merge-dialog.ts` lists the hunks in document order so it reads like the file. Runs nobody touched are
context, elided past three lines at each end, because a merge view that made the user scroll a thousand
unchanged lines to find the one question is worse than no merge view.

A conflict renders both versions side by side, always -- a dialog that showed one at a time would be the
old prompt with extra steps. The buffer's side is selected by default.

Four buttons: **Apply merge**, **Keep mine**, **Use theirs**, **Decide later**. Escape is Decide later,
which records no decision, so the next external change asks again.

### Applying it

`applyConflictResolution` is exported from `external-watch.ts` rather than inlined, so the step that
decides whether the user's unsaved work survives can be tested. Outside Tauri the watch never activates,
and a branch reachable only through a runtime the tests do not have is a branch nothing checks.

It returns whether the buffer was replaced, which is exactly when the caller should announce a reload --
there is no other signal, and a caller that guessed would either claim a reload that did not happen or
stay silent about one that did.

A merged buffer stays **dirty**. The merged text is on disk nowhere: the file still holds the other
program's version, so marking it clean would let the user close the window and lose it.

## 6ay. Dragging a Tab Out

### Where the drag ended, not what it carried

A reorder and a drag-out start identically, and the only thing that tells them apart is where the pointer
stopped. `dragend` reports that, so `endedOutside` measures it against the bar's own rectangle with
`DETACH_MARGIN_PX` of slop -- a reorder that overshot the last tab must not be read as a request for a
new window.

A cancelled drag reports `clientX === 0 && clientY === 0`, and that case is checked first. Without it,
pressing Escape would open a window every time the user changed their mind.

`dataTransfer` still carries nothing. The dragged tab's id lives in a closure exactly as it did for
reordering, which is what keeps the drag from being droppable into another application; a detach is
decided by where the drag finished rather than by handing a payload to the platform, so nothing needs to
go on `dataTransfer` for one either.

No flag records whether a drop landed on a tab. `drop` only fires on a tab, which is inside the bar, and
`dragend` reports the same point the drop happened at -- so a reorder always ends inside, and
`endedOutside` already answers for it. A flag saying the same thing twice would be a second source of
truth that could only ever disagree by being wrong.

### The document is handed over, not copied

`window-handoff.ts` parks a document for the window that is about to show it, and that window claims it
on boot. Claiming is **destructive**: the window is being given the document, not shown a copy of it, and
a reload that claimed again would put the user's unsaved work in two windows at once.

Inside Tauri, `open_document_window` parks the document in `HandoffState` under a generated label and
then builds the window; `take_handoff_document` reads the label from the calling window itself, which the
webview cannot spoof, so a script cannot ask for another window's document by guessing a label. Parking
happens **before** the build, because the new window can call for its document as soon as its script runs.
If the build fails the park is undone, because a document nobody will ever claim is a leak.

Creating the window is a Rust command rather than a webview permission, so
`core:webview:allow-create-webview-window` stays ungranted and the webview cannot open windows of its own
accord. The capability's window list had to widen from `["main"]` to `["main", "doc-*"]`: a second window
with no capability would come up unable to read or save a file.

Outside Tauri the same interface parks the document in `localStorage` and opens `?handoff=<key>`. This is
not only for the dev build -- it is what makes the mechanism testable and verifiable at all, since there
is no Tauri runtime in a browser or in jsdom.

### The tab closes last

`detachTab` opens the window first and closes the source tab only once one actually appeared. A detach
that failed -- a blocked popup, no handoff available -- would otherwise take the document with it, and a
document that exists in neither window is the one outcome this gesture must never have.

Closing goes through `TabSet` directly rather than through `closeTab`, which would ask whether to save
first. The document is not being discarded; it is being moved, unsaved edits and all, and a prompt about
losing work that is not being lost is a question with no right answer.

The path travels with the text. A window opened by dragging a tab out is showing a document that already
has a file, and losing that would turn its next Save into a Save As for a file already on disk.

So do the saved text and the encoding (§6bj). `HandoffDocument` carries optional `savedText` and `encoding`;
the Rust `open_document_window` takes them as `Option` parameters and serialises the parked document in
camelCase, and `main.ts` hands them to `EditorShellOptions.initialSavedText` and `initialEncoding` for the
first mount. A payload from an older build, with neither key, is still claimed; a value of the wrong type is
refused like any other malformed payload, and a null becomes an absent field so a clean document stays clean.

### The window has to be built off the main thread

`open_document_window` was a synchronous command, and Tauri runs those on the main thread. Building a
webview there on Windows waits for the event loop that same thread is blocking, so the new window stayed at
`about:blank` and the detaching window's call never returned. The desktop half had never been exercised --
the original work verified the browser route only -- and the first desktop run of the handoff found it.
The command is now `async`, which Tauri runs on its own thread.

## 6az. Multi-Caret in the K-Doc Pane

### The carets cannot live in the selection

CodeMirror has multiple selection ranges, so the Source pane needed four extensions and no logic.
ProseMirror's `Selection` is a **single range by construction**, so the K-Doc pane could not be given
the same thing. The extra carets live in plugin state as document positions; the primary caret stays in
`state.selection`, and every edit is applied at the primary position *and* at each extra.

Three files, each doing one job:

| File | What it holds |
| --- | --- |
| `multi-caret-state.ts` | the positions and the transaction builders -- no DOM, no `Plugin` |
| `multi-caret-plugin.ts` | the decorations and the `handleClick` / `handleTextInput` / `handleKeyDown` props |
| `multi-caret-occurrence.ts` | the word search behind Ctrl+D |

The invariant the state module keeps is that extras are **ascending, distinct, and never equal to the
primary position**. Ascending is what lets edits be applied back to front; distinct because two carets in
one place are one caret; never the primary because a caret that is also the selection would apply every
edit twice. The plugin enforces the last part on every transaction, dropping any extra that a mapping or
a selection change has brought onto the selection head.

### Back to front, in one transaction

`insertAtCarets` sorts its positions descending and applies them in that order. An edit at a higher
position cannot move a lower one, so each position is still valid when its turn comes. Everything goes in
one `Transaction`: typing at three carets that took three undos to take back would be worse than not
having the feature.

An extra that falls **inside** the primary selection is dropped rather than applied -- the primary
replacement would wipe it anyway, and keeping it shifts the document under the primary range so the
replacement stops a character short.

The primary caret afterwards is just `tr.mapping.map(primaryFrom)`. ProseMirror's default association of
+1 carries a position at the start of an edit to the far side of it, so it already lands after the text
just inserted there. Adding `text.length` on top counted the same characters twice -- which is what the
first version did, and what a test caught on its first run.

### The plugin goes first

It is installed in `binding.ts` **before** every keymap. ProseMirror consults `handleKeyDown` in plugin
order, and a Backspace that reached the base keymap first would delete at the primary caret and stop,
while the extra carets watched it happen. It is core editing rather than a feature the host opts into,
which is why it is built into the binding rather than passed through `options.plugins`.

Enter and the arrow keys are deliberately **not** intercepted. Splitting at several places at once is a
different feature with its own question about where the carets go afterwards, and arrow keys would need
every caret to carry its own goal column. Left to the ordinary commands they act on the primary caret and
the extras map along, which is predictable rather than surprising.

### The caret is a painted line

Each extra is a zero-width `Decoration.widget`: a 1px by 1.2em span in `currentColor`, blinking on a
`step-end` animation, `pointer-events: none` so it cannot swallow the click that would place a caret
beside it, and carrying **no text** -- a widget with a character in it would be text the document does
not contain.

There is no bounds check on the decoration's position. One was written, on the belief that ProseMirror
throws on a decoration past the end of the document. It does not: `DecorationSet.create` accepts it, the
set reports holding it, and the view mounts without complaint -- it simply paints nothing. That was
checked by running it after a mutation of the guard changed no outcome. A guard whose stated reason is
untrue is worse than no guard, so it went, and a test pins the behaviour the plugin now relies on.

### Ctrl+D

The first press **selects** the word under the caret; the second starts adding carets at each next
occurrence. That is what every other editor does, and it gives the user something to look at before
anything is duplicated.

Matches are whole words only. Without that, adding the next `in` would land inside `point`, `into` and
`binding`. A word is letters, digits, underscore and hyphen -- the hyphen because a hyphenated word reads
as one word to a person, and Ctrl+D is a person's tool. The search runs forward from the last caret so
repeated presses walk down the document, and wraps to the top when it runs out.

## 6ba. The Vault Index

Three of the requirements left open -- the link dialog's vault-note search (FR-8.12), the Files,
Search and Tags panels (FR-14.6), and the Backlinks panel (FR-14.7) -- all needed the same thing
first: something that knows what notes a folder holds and what is in them. This is that.

### The scan is a command, not filesystem access

`src-tauri/src/vault.rs` exposes one command for the scan, `vault_list_notes(folder)` (the file tree's commands are in `vault_files.rs`, §6bp). K-Doc deliberately grants the
webview no general filesystem access -- every read goes through a validated Rust command -- and a
folder walk is no exception.

The walk uses an explicit stack and `std::fs::read_dir` rather than the `walkdir` crate: no new
dependency, and no recursion to overflow on a deep vault. It **never follows symlinks**, because a
symlink loop would make the walk never finish and a symlink out of the vault would index files the
user did not put there. It skips `.k-doc`, `.git`, `node_modules`, `.obsidian`, `target` and `.venv`
by name, and any directory whose name begins with a dot.

An entry it cannot read is skipped rather than fatal -- a folder the user lacks permission for is not
a reason to refuse them the rest of their vault. The result is capped at 20,000 notes: a vault is a
folder a person chose, and a person can choose their home directory by mistake.

`relative` is reported with forward slashes on every platform, so the same vault gives the same
relative paths on Windows and elsewhere, and the list is sorted by it so the order is stable between
runs rather than whatever the filesystem happened to hand back.

### Extraction is pure

`packages/core/src/vault/note-index.ts` turns one note's text into a `NoteIndexEntry`: its title, its
headings, its links, its tags and its front matter. No filesystem, no DOM.

Tags and wikilinks are scanned out of the raw text rather than the AST, because neither is a Markdown
construct that remark knows about. Both scans skip fenced and inline code -- `#include` in a C snippet
is not a tag. A tag must start a line or follow whitespace or a bracket, and its first character must
be a letter or digit, which is what separates `#todo` from a `# heading` and from a URL's `#fragment`.

The patterns are read with `String.prototype.matchAll`, never `exec`. `matchAll` iterates a clone, so
a shared `/g` pattern carries no `lastIndex` between calls. The first version used `exec` and reset
`lastIndex` by hand; a mutation showed the reset could never fire, because a loop that runs to
exhaustion resets it anyway. Removing the shared state was better than defending it.

Inline links come from the mdast, walking into children -- a link is almost never a direct child of
the document. Images count too: an image is a reference to a file, which an attachments report will
need.

A note's title is its front-matter `title`, else its first level-1 heading, else its file name without
the extension. The last one matters: a note with neither is still a note, and its file name beats
"Untitled" in a list of twenty.

### Matching a link to a note

`vault-links.ts` decides which note a link points at. A target is normalised -- trimmed, its `#anchor`
dropped, `./` dropped, backslashes turned to forward slashes, lower-cased, extension removed -- and
then matched against the note's full relative path, its file name alone, or its title. Those three are
the three ways a person writes a link to a note.

An anchor-only target normalises to nothing and matches nothing. Without that, every `[top](#intro)`
in the vault would appear in the backlinks of any note whose name happened to be empty.

Backlinks skip self-links, compared by `path` rather than by object identity, and are ordered by the
source's path then by position, so the panel reads the same way twice running.

### The queries

`vault-query.ts` counts tags **by note, not by occurrence** -- a note that says `#todo` five times is
still one note to visit. A nested tag is found under its parent, so clicking `work` shows `work/urgent`;
the separator is what makes it a child, which is why `workshop` is not one.

Search is a weighted sum, not a fuzzy match, because a ranking a user cannot predict is a ranking they
cannot use. An exact title is 100, a prefix 50, a containment 25 -- **exclusive**, since an exact match
already implies the other two and adding all three would count it three times. A tag is 15, a path 10,
and each matching heading 5, capped at five of them: without the cap a long document full of the word
would outrank the note actually called it.

### Not done yet

FR-6.12 also asks for the index to be **persisted at `.k-doc/index.db` and maintained incrementally**.
Neither is built: the index is held in memory and rebuilt when a vault is opened. The requirement is
recorded as partial rather than done.

## 6bb. The Link Dialog's Four Sources

FR-8.12 asks for a dialog offering a URL, a search of vault notes, a heading in this document, or a
local file. Only the first existed.

### One field, four ways to fill it

Every source writes into the same URL field and then hands control back to it. A picker that applied
straight away would give no chance to add a title or correct the target, and the dialog's job is to
fill the field rather than to bypass it.

The tabs are **URL**, **Heading**, **Note**, and **File...** -- the last drawn only when the host
supplies a picker. The browser build has none, and a button that never does anything is worse than no
button.

Opening on a link whose `href` starts with `#` starts on **Heading**: editing a link to a heading
should show you the headings, not make you find the tab first.

### The heading slug is the renderer's slug

`slugify` drops punctuation rather than turning it into a hyphen. `What's New in 2.0?` becomes
`whats-new-in-20`, not `what-s-new-in-2-0`. That difference is the whole point of the feature: a
heading link that does not match the anchor the renderer emits is a broken link, which is worse than
having no picker at all. The first version hyphenated punctuation under a comment claiming it was
GitHub-style; it was not, and a test written against the real behaviour is what said so.

### The note search asks rather than being told

The dialog holds no vault. It calls `searchNotes(query)` and draws whatever comes back, which is an
empty list when no vault is open. Whether one is open can change between one `Ctrl+K` and the next,
so being told up front would mean being told something that had since stopped being true.

The search is debounced by 120ms, because a vault search runs over every note and running it on every
keystroke of a long word is work nobody asked for. An empty query shows nothing rather than every
note: an unconstrained listing of a whole vault is not a search result.

Both the heading list and the search box are rebuilt on every open. A dialog opened twice must never
show the first document's headings, and a search box still holding the last document's query is a
result list about a document you are no longer in.

### The vault service

`vault-service.ts` opens a folder, reads every note the Rust scan found, and holds the index. The
scan is cancellable by a token: a user who opens one folder and immediately opens another must not
get the first folder's notes arriving after the second's. Every `await` is followed by its own check,
so a superseded scan stops at the next one rather than finishing into state nobody is reading.

A note it cannot read goes on an `unreadable` list and the scan carries on -- a file the user lacks
permission for is not a reason to refuse them the rest of their vault. Progress is reported every 25
notes: a panel that only updated at the end would look frozen on a large vault, and one that updated
on every note would spend its time redrawing.

`update(path, text)` re-indexes one note from text the caller already has. Going back to the disk for
it would be reading a file to learn what the editor already knows.

## 6bc. The Left Sidebar's Panels

FR-14.6 asks for Files, Search, Outline and Tags, collapsible with `Ctrl+Shift+B`. Only Outline
existed, and the shortcut was bound to nothing at all -- the status note claiming otherwise was
wrong, which is the sort of thing only checking finds.

### Each panel is handed functions, not the service

`installFilesPanel`, `installSearchPanel` and `installTagsPanel` each take plain accessors --
`notes()`, `root()`, `search(query)`, `tags()` -- rather than the `VaultService` itself. A panel can
then be tested without a service, and the service can change shape without three panels following it.

They share one redraw. The service notifies on every step of a scan and the shell refreshes all three
from that one callback, rather than each subscribing separately and redrawing at a different moment
from its neighbours.

Every panel keeps a stable `element` and only ever replaces the children of an inner body. The
sidebar mounts a panel once, so replacing the element would leave a panel on screen showing nothing.

### Files

The panel is now the vault file tree (§6bp); the grouped list described here was replaced by it.

Notes are grouped by the directory part of their relative path. The top-level group comes first with
**no header** -- a heading over it would be a heading with no name -- and the rest follow in
ascending order. Within a group the caller's order is kept, so one place decides it.

The header names the vault's own folder rather than its whole path: the path is already the thing the
user chose, and repeating it in a narrow column just truncates it.

Three states, in order: no folder open (with an **Open Folder** button only where there is a picker
behind it), scanning with nothing yet, and the notes. The scanning line matters because an empty
panel with no explanation looks like a folder with no notes in it -- and notes are shown as soon as
there are any, rather than waiting for the scan to finish.

### Search

The panel now searches the full text of the notes and replaces across them (§6bo); what follows still holds.

Debounced by 150ms, because a vault search runs over every note and running it on every keystroke of
a long word is work nobody asked for. `refresh()` re-runs immediately and **cancels any pending
keystroke**: a refresh is the index changing under a query the user already typed, so making them
wait again would be waiting for nothing, and leaving the timer to fire would run the same query twice.

An empty query shows nothing rather than every note. With no vault open the box is disabled: a search
box that searched nothing would be a control that looks like it works.

The count says `1 match in 1 file`, never `1 matches in 1 files`.

### Tags

Every tag with the count of **notes** carrying it, shown with its `#` so what the user reads is what
they would type. Clicking one expands the notes beneath it; clicking again collapses it, because a
panel that could only ever open would grow until it was unusable.

The expansion redraws the list, which destroys the button the user just pressed -- so focus is put
back on the one that replaced it. Without that a keyboard user is dropped to the top of the document
in the middle of a gesture they have not finished.

A selection survives a refresh, but is dropped when the tag no longer exists: silently showing its
old note list would be showing something that is not there.

### The shortcut

`Ctrl+Shift+B` collapses an open sidebar and reopens a collapsed one **on whichever panel it was last
showing**. Always reopening on Outline would make the shortcut a way of losing your place rather than
a toggle.

It matches on `event.code === 'KeyB'` rather than `event.key`. With Shift held, `key` is `'B'` on one
layout and something else entirely on another, while `code` names the physical key the user pressed.

## 6bd. The Right Panel's Surfaces

FR-14.7 asks the right panel for Comments, Backlinks, History, Metadata and Problems. Comments and
Review were already there; the other four are new, and they sit between them -- Comments stays first
and Review stays last, because reordering panels a user has already learned to find moves a target
for no reason.

They follow the left sidebar's panels exactly: plain accessor functions rather than a service, a
stable `element` whose inner body alone is replaced, one delegated click listener on that body, and
an idempotent `destroy`.

### The construction-order trap

Each panel draws once while installing. At that point in the shell's constructor `fileMenu`,
`documentSession` and `spellCheck` are all still undefined -- they are declared with `!:` and
assigned further down. So every accessor that reads one checks it first and returns the empty answer.

This is not defensive padding. Reading through an undefined field on that first draw is a blank
window rather than a caught error, which is how the same mistake presented when the vault panels
were added and the vault was built after them.

### Backlinks

What links to the open note, grouped by the note the reference came from, in first-appearance order.
Each group quotes its own lines, and the quoted line is a button too: it is how the user recognises
which reference they meant, so it would be strange for it to be the one part that is not clickable.

Three empty states, and they say different things. No vault open is not the same as an unsaved note
-- nothing can link to a file that has no name yet -- and neither is the same as a saved note in a
scanned vault that simply has nothing pointing at it. One message for all three would answer a
question the user did not ask.

### History

The session's edit timeline, newest first, because the version someone wants back is nearly always a
recent one. Each row names how long ago it was, which pane made the edit, and how that version's
length compares with the document now.

The entries are the states to return **to**, not the states that were typed. A coalesced typing run
keeps the text from before the run began, which is what makes one undo land at the start of a word
rather than in the middle of it -- so restoring row *i* gives the document as it stood before edit
*i*, which is the version the row is naming.

Restoring goes through `applyExternalText`, not `applyText`. `applyText` demands that the Source pane
hold the edit lock and throws otherwise, and a panel is not a pane. It also makes a restore an
ordinary undoable edit rather than a destructive overwrite, which is what FR-11.10 asks for.

**What this is not.** It reads the session's in-memory history, so it goes no further back than the
document was opened. The persisted snapshot store of FR-11.8 and the word-level diff of FR-11.9 are
not built; this is the FR-14.7 surface those would later deepen, not their implementation.

### Metadata

Three sections -- File, Front matter, Statistics -- always present, because the sections are the
panel's shape and should not come and go with their content.

Front-matter values are formatted rather than printed. An array joins with commas, since `tags: [a,
b]` is the commonest front-matter value there is and `[object Object]` would make the field
unreadable at exactly the moment it matters. A value that cannot be serialised at all -- a circular
structure does throw -- reads `(unreadable)` rather than taking the panel down with it.

Reading time says `Under a minute` at zero rather than `0 min`, which would claim the document takes
no time to read.

### Problems

Misspellings and links that resolve to no note, grouped with spelling always first, so a problem does
not move in the list merely because a different one was fixed.

The two kinds do not measure in the same units, and that is why `reveal` is handed the kind along
with the range. A misspelling's offsets are ProseMirror document positions, counted over nodes; a
link's index the raw source text. Resolving either in the other's pane puts the caret somewhere the
problem is not, which is worse than not moving it at all -- so spelling reveals in the rendered pane
and a link reveals in Source, opening the split first if only the rendered pane is showing.

Link checking is skipped entirely while the vault is still scanning. The index is filling, so every
link would be reported broken and then quietly un-reported as its note arrived; a panel that accuses
the document and then takes it back is worse than one that waits.

`brokenLinks` in the core deliberately judges only vault-internal links. A URL that 404s is a real
problem, but one only a network request can find, and reporting it from a string match would be a
guess dressed as a finding.

## 6be. The Vault Index on Disk

FR-6.12 asks for an index that is persisted and incrementally maintained. It was neither: every open
walked the folder, read every note, and parsed every one of them again.

### Where it lives

`.k-doc/local/index.db`, not the `.k-doc/index.db` the requirement's own sentence names. The layout in
spec section 6.4 puts `index.db` under `local/` alongside the snapshots and the journal, and the
generated `.gitignore` ignores `local/` for the obvious reason: the index is derived data, so
committing it would put a large, constantly-churning file into everyone's history to say something
the vault already says. Two readings of one spec, and this is the one that agrees with the rest of it.

`vault_index_write` calls `store::ensure_vault_layout` first, so opening a vault is what lays out `.k-doc/`
(`comments/`, `changes/`, `local/snapshots/`, `local/journal/`) and writes that `.gitignore`. It is idempotent and
never overwrites a `.gitignore` the user has changed, and an existing vault gets it the next time it is opened.

### What makes it incremental

The Rust walk already reported each file's modification time and size, so nothing new had to be
collected — only kept. A saved note records both, and `planScan` compares them against what the walk
found now:

- both match: the saved entry still describes the file, so it is reused and the file is never read;
- either differs: the file is read and parsed again;
- no saved record: read it;
- a saved record whose file the walk did not find: it is simply never looked at, so it drops out
  without anything having to delete it. The plan is built from what is on disk now, not from what the
  index remembers.

It is deliberately **both** the time and the size rather than either alone. A modification time can be
preserved by a copy or a restore that changed the content; a size can survive an edit that swapped one
word for another of the same length. Together they are wrong far less often, and the case that defeats
both — an edit keeping the time and the length — is repaired by the user's next save, which moves the
time.

### Why the cache is so quick to give up

`parseIndex` returns null for anything it cannot fully vouch for: bad JSON, a different format
version, a root naming another folder, or a single note of the wrong shape anywhere in the array. One
bad note sinks the whole file rather than being skipped, because a file that is partly corrupt gives
no reason to believe the rest of it.

That looks severe until you price the two mistakes. Rejecting a good cache costs one extra scan.
Trusting a bad one shows the user a note's old headings, old tags and old links as though they were
current, and nothing on screen says otherwise. A cache that cannot be trusted is a cache that is not
there.

Every failure around it lands the same way. The index cannot be read, the host has no such command,
the write fails on read-only media: each leaves `cached` null or the save undone, and the scan carries
on. A vault indexes perfectly well in memory, and refusing to show someone their notes because the
cache could not be saved would trade a working feature for a broken one.

### Written atomically

The write goes to `index.db.tmp` and is then renamed over the real file. A write interrupted partway
through would otherwise leave a truncated file that still parses as far as it goes, and the next open
would trust it. A rename is the one step the filesystem will not do halfway.

### Rebuildable on demand

`refresh()` runs the scan with the cache switched off. That is the requirement's "rebuildable on
demand", and it is also the repair: if the index is ever wrong in a way the time-and-size check cannot
see, a refresh is the thing that fixes it. A refresh that quietly reused the cache would be a refresh
that could not fix anything.

### The reuse count

`VaultStatus` reports how many notes came from the index rather than from disk. It is there because it
is the only outward sign that any of this worked: a scan that silently re-read everything and one that
skipped nine notes in ten look identical from outside, and a test cannot tell them apart either.

## 6bf. Carrying the Caret Across Modes

FR-5.6 asks that switching between K-Doc and Source keep the caret and selection in the same place.
Nothing did: each pane kept whatever caret it last had, so switching modes dropped the user somewhere
unrelated to where they were working.

### Almost everything already existed

`offset-map.ts` already maps between the two coordinate systems at character precision -- a Source
offset is a character in the Markdown text, a K-Doc position counts across ProseMirror's nodes --
and comments, track changes and find highlights have used the source-to-K-Doc direction for some
time. The reverse, `positionToOffset`, was built and tested but had no caller.

So the work is small: `selection-carry.ts` in `@k-doc/editor` maps an anchor-and-head pair each way,
and `setViewMode` calls it when the mode genuinely changes and the pane holding the caret is about to
be hidden. It carries before the existing focus handoff, so focus arrives at the place the user was.
Selection-only transactions never reach the document session in either binding, so carrying a caret
cannot create an edit.

### The edge the mapping left unowned

Segments in a `PositionIndex` are half-open: `[start, end)`. The single-offset mappers snap an offset
that falls in no segment forward to the next one -- right for a point inside markup, which should land
on the text that markup introduces, and relied on by the existing features that anchor points. But an
offset exactly at a segment's END belongs to no segment either. Carried through the raw mapper, a
caret at the end of a heading jumped to the start of the next paragraph, and a selection of a whole
heading came back one character too long.

That is the most common place for a caret to be, and the first run of the tests found it. The carry
functions therefore map an endpoint through containment first, then an ending rule -- an offset at a
segment's end maps to that segment's end -- and only then fall back to the forward snap. `offset-map.ts`
is left alone: its forward snap is right for what already uses it, and the edge is a caret's concern.

### What cannot be exact, and what is instead

Two source offsets can be one K-Doc position. In `Some **bold**`, the offsets either side of `**` are
the same point in the rendered pane, because a mark takes no position there. One of them has to come
back on the other side of the delimiter. What is guaranteed instead is the property a user actually
feels: a caret never moves visible place, and switching modes again never walks it any further.
Carets strictly inside text round-trip exactly.

Where the two documents cannot be matched at all the mapping returns null, and the carry leaves the
target pane's caret where it was. That is the behaviour before this existed, and it is better than a
guess that puts the caret somewhere the user was not.

### When it does nothing

- The mode did not change. `setViewMode` is re-applied after every tab mount with the mode unchanged,
  and carrying then would push a stale caret into a document that was just opened.
- The pane holding the caret stays on screen. In Split both panes are visible and each keeps its own
  caret; only leaving Split for a single pane carries it.

## 6bg. Following Links

FR-8.13 asks for a hover card showing a link's target, Ctrl+Click to follow, internal links that
navigate, and external links that open in the OS browser with a confirmation for unknown domains.

### One classifier, three routes

`link-target.ts` decides what an href points at, purely: a heading in this document, a note (resolved
against the open file and then the vault), a web address, a mail address, something unresolved, or a
blocked scheme. The hover card describes that answer, and the card's Open button, Ctrl+Click and the
context menu's Open Link all follow it through one `followLink`, so the three cannot disagree about
where a link goes.

A note link resolves in a fixed order: the exact path beside the document; that path with `.md` added,
since links often omit it; then any note the vault matches by name; and finally the resolved path as
written, for a file outside the vault. The order matters when two notes share a name -- `setup` from
`guides/advanced.md` must mean `guides/setup.md`, not whichever `setup.md` the vault lists first --
and a test pins exactly that case, added after a mutation showed the `.md` step was otherwise
unobserved.

A heading link matches GitHub's anchors, including the `-1`, `-2` suffixes it gives repeated headings,
using the same slug rule the link dialog writes.

### What is never opened

Only `http`, `https` and `mailto` ever leave the document. Every other scheme -- `javascript:`, `data:`,
`file:`, `vbscript:` -- is classified as blocked and says so on the card. A link a user did not write
can arrive in a file they were sent, and following it is how a document becomes an attack. A Windows
drive such as `C:\notes\a.md` looks like a scheme to a naive parser; it is recognised as a path first.

The Rust command `open_external_url` repeats the allow-list rather than trusting the webview, because it
runs with the user's full permissions, and also refuses any whitespace or control character. It hands
the URL to `rundll32 url.dll,FileProtocolHandler` directly -- `cmd /c start` would read `&` and `^` in
a query string as shell syntax.

### Unknown domains

When `general.confirmExternalLinks` is on (the default), a web link to a domain not in
`general.trustedDomains` asks: Open once, Always trust the domain, or Cancel. The domain is the one
thing on the card the link text cannot lie about, which is why the decision is made on it.

### Ctrl+Click and multi-caret

Ctrl+Click already added a caret. ProseMirror asks plugins in order and the first `handleClick` to
return true wins, and the multi-caret plugin is built into the binding ahead of every host plugin. So
the link-follow plugin is a binding option installed before multi-caret: a modified click on a link
follows it, and a modified click anywhere else still reaches multi-caret.

### Not covered

Wikilinks are plain text in the K-Doc pane -- there is no wikilink node or mark -- so they get no
card and Ctrl+Click on one adds a caret. Links in the Source pane are not followable either.

## 6bh. Editing Raw HTML as Source

FR-7.9 asks for inline HTML and raw blocks to be editable as source in a focused code widget with
syntax highlighting. Until now they rendered as inert grey text: preserved byte for byte (FR-4.4),
but only editable from the Source pane.

### A node view over the atom

Raw HTML already maps to `unknownBlock` and `unknownInline` atoms whose `attrs.node` holds the
original mdast node. `raw-source.ts` decides, purely, which of those carry editable text:
`html` nodes (labelled HTML, highlighted as HTML) and `kdocRaw` nodes (labelled Raw, highlighted as
HTML only when the parser kept them as unknown HTML). Link definitions, footnotes and the like
carry structure rather than a single source string, so they keep the old rendering.

`RawSourceView` is a ProseMirror node view hosting a CodeMirror editor. An edit inside it
dispatches one outer `setNodeMarkup` with the node's `value` replaced, so it travels the normal
path to the session and the incremental serializer rewrites only that node's bytes. A change
arriving from the document -- undo, or an edit in the Source pane -- is pushed into CodeMirror
under a `syncing` flag so it is not written back as a fresh edit.

### Keys

Escape leaves the widget, placing the caret after it. ArrowLeft and ArrowRight leave at the first
or last character; ArrowUp and ArrowDown leave only on the first or last *visual* row, measured
with `coordsAtPos`, because a long single line wraps and a line-number check would leave from the
top row of a four-row line. CodeMirror's default keymap is installed so Home, End and Ctrl+A behave
as in any editor. Ctrl+Z and Ctrl+Y are forwarded to the outer view, so undo walks the document's
history rather than a private one inside the widget.

### Focus and the edit lock

The binding claimed the edit lock on `focus`, which does not bubble, so focus landing inside the
widget never reached it and edits were rejected as coming from an unfocused pane. It now listens
for `focusin`.

### Highlighting

`CODE_TOKEN_STYLES` colours `@lezer/highlight` `tok-*` classes from the theme tokens. Code blocks
already emitted those classes but no stylesheet coloured them, so this also makes code-block
highlighting visible for the first time. Inside a widget `tok-invalid` is not underlined: inline
HTML arrives one tag per node, so a lone `</span>` is expected, not an error.

### Not covered

Inline HTML is one widget per tag, because mdast splits `<span>x</span>` into an opening tag, text
and a closing tag. jsdom cannot lay out text, so Home, End and the visual-row rule are verified in
the browser rather than by unit tests.

## 6bi. Navigation: Go To, Quick Open and Breadcrumbs

FR-9.6 asks for Go To on `Ctrl+G` -- a line in Source, a heading in K-Doc. FR-9.7 asks for Quick Open
on `Ctrl+Shift+O`, a fuzzy file switcher across the vault. FR-9.9 asks for a breadcrumb bar showing the
heading path of the caret.

### Pieces

| File | Role |
| --- | --- |
| `core/src/outline/heading-path.ts` | `headingPath(entries, offset)`: the last heading at or before the offset, plus each strictly shallower heading before it, outermost first. |
| `app/src/shell/fuzzy-score.ts` | `fuzzyScore` (case-insensitive subsequence with word-start, run, gap and length terms) and `rankItems` (label weighted over detail, deterministic ties). |
| `app/src/shell/go-to-line.ts` | `parseLineTarget` (`12`, `:12`, `12:5`) and `lineTargetOffset`, which clamps and never lands between CR and LF. |
| `app/src/shell/picker-dialog.ts` + `picker-dialog-styles.ts` | One keyboard-driven fuzzy picker dialog, used for both Quick Open and Go To's heading list. |
| `app/src/shell/breadcrumb-bar.ts` | The bar above the panes; rebuilds only when the path actually changes. |
| `app/src/shell/navigation-controller.ts` | The logic between them: which files Quick Open offers, which Go To flow runs, and when the breadcrumb refreshes. The shell only wires dependencies in. |

### Quick Open's list

Open tabs come first, then recent files, then every vault note, with duplicates and the current document
removed. Paths are compared with separators unified and case folded, because a Windows path reaches the
list both ways. A vault note shows its title and relative path wherever it appears; any other file shows its
name and full path. Picking a file already open switches to that tab -- loading it again would put a second,
diverging copy beside the one holding unsaved edits.

### Go To

Go To asks for a line when the Source pane is being edited (Source mode, or Split with Source focused) and
otherwise offers the headings. A line target from a pane that shows no lines switches to Split first. A heading
is revealed by mapping its source offset through the position index into ProseMirror, falling back to the
Source pane when it cannot be mapped; `revealHeading` (FR-8.13) now goes through the same `revealOffset`.

### Breadcrumb refresh

The breadcrumb reads the focused pane's caret as a source offset (mapped through the position index from
ProseMirror). Both bindings' state-change hooks and the session's change hook schedule a refresh, and the
controller coalesces them into one per animation frame. The outline is cached by snapshot document identity,
so a caret move does not re-walk the tree. The session is read through a getter because each mounted
document gets a new one.

### Opening a file into a tab

Wiring Quick Open exposed that Open Recent and the Files panel called `tabs.open` without mounting, so the
tab set changed while the old document stayed on screen, and that `mountDocument` rebuilt the file menu with
no path, so a switched-to tab forgot its file and the next capture stored the loss. `openInTab(text, path)`
now captures, opens, and mounts; `mountDocument` takes the path and hands it to `installFileMenu`'s new
`initialPath`; and the external-file watch starts on that path immediately.

### Not covered

The command palette does not match bare file names. A tab's unsaved-changes flag and encoding are still
lost when it is switched back to, because the remount builds a fresh session and file menu. jsdom cannot
exercise the shell wiring, so that part was verified in the desktop app.

## 6bj. A Tab Keeps Its State

FR-6.8's tabs were losing two things on every switch. `activateTab` remounted the target from its stored
text with `new DocumentSession(text)`, and a session takes its starting text as its saved text, so unsaved
work read as clean: the status bar dropped "Modified", closing did not warn, and autosave skipped it. And
`installFileMenu` started every mount at UTF-8, so a UTF-16 file switched back to was saved as UTF-8.

### What a tab carries

`DocumentState` now holds `savedText` and `encoding` beside `text`, `path` and `dirty`.
`captureActiveDocument` fills them from `snapshot.savedText` and `fileMenu.encoding`, and `mountDocument`
takes the whole state: `DocumentSessionOptions.savedText` gives the session its baseline, and
`FileMenuOptions.initialEncoding` gives the menu its encoding, mirroring `initialPath`. The successor
mounted after a close or a detach goes through the same path.

The saved text is carried rather than the dirty flag because `dirty` is derived. A session given the
flag alone could not become clean again when the user typed the change back out; given the baseline, it
compares text as it always has. `savedText: ''` is a real baseline, not an absent one -- `??`, not `||`.

### Opening a known path keeps the encoding too

Open Recent, Quick Open and the Files panel read a file with `readPath`, which returns only text, so a
file opened that way lost its encoding before any tab switch. `FileService.readFile(path)` returns the
full `OpenedFile`, and `openInTab` takes it. `readPath` stays for the external-change watcher, which
only compares text.

### Open Recent stops asking

`openRecentPath` asked "save before opening a different file?" from when a recent file replaced the
document on screen. It now opens in a tab of its own, and the document it leaves keeps its unsaved work
in its tab, so the question protected nothing. File > Open still asks, because it still replaces the
document in place.

### Not covered

Dragging a tab out used to hand over only `{ text, path }`; it now carries both (§6ay). A tab's undo
history is still not carried across a switch. The shell wiring has no jsdom harness, so it was verified
in the desktop app.

## 6bk. The Fidelity Check

FR-4.5 asks for a diagnostic that reports, on save, any byte-level change to regions the user did not
touch, off by default and on in developer mode. It is the test of K-Doc's central promise (FR-4.2) run
against real editing rather than a corpus.

### Why not the serializer's own ranges

`serializeIncremental` already reports the ranges it replaced, and it is tempting to check that nothing
outside them changed. But the splice preserves everything outside those ranges by construction, so that
check could never fail; and when the serializer falls back to the whole document, its range is the
whole document and the check would excuse everything. The question has to be answered independently of
the code being checked.

### What counts as unchanged

`checkFidelity(baseText, currentText, touched)` parses both texts and aligns their top-level blocks by
content: `contentKey` is the node's JSON with every `position` dropped, and `alignBlocks` pairs equal
keys by longest common subsequence after trimming the common prefix and suffix. A block whose content is
the same on both sides but whose source bytes differ is a finding. So is the blank space between two
blocks that are adjacent and aligned on both sides, and the space before the first and after the last.
Space next to an inserted or deleted block is not judged, because it legitimately changed.

A block whose content changed is the user's edit, and its formatting is not judged. But a list is one
block, so an edit to one item would hide a rewrite of every other item. Where exactly one block on each
side sits between two aligned pairs, and both are the same kind of container -- list, list item or
blockquote -- the comparison recurses into their children, with the container's own span as the bounds
for the leading and trailing space. Tables are not entered: FR-8.22 realigns every row's padding when a
cell widens, on purpose.

The LCS table is capped at `MAX_ALIGNMENT_CELLS` (four million); a larger unmatched middle is left
unaligned, which can only hide findings.

### What the user touched

`FidelityTracker` holds the base text and the ranges of the current text the user changed as text since
the base. Each change is reduced to one differing region by common prefix and suffix; existing ranges are
shifted through it, and a text edit adds the region. `FidelityController` decides which changes are the
user's bytes: a Source-pane edit, an external edit (find and replace, restore, paste special), undo and
redo. Only a K-Doc edit is serializer output to be judged. Undo is the user's because it can reach back
past a save to text the user typed, which the tracker has already forgotten -- found by thinking through
the desktop run rather than by a test.

A tab mounted with unsaved work does not know what its user did before; the whole span between its saved
and current text is treated as touched. Every conservative choice here hides findings; none invents one.

### On save

`FileMenuOptions.onSaved(text)` fires after a successful Save or Save As (autosave goes through Save;
Save a Copy writes another file and does not fire). The controller checks, reports, and makes the saved
text the new base. `general.developerMode` is read at each save. Findings are Problems of kind `fidelity`,
revealed in the Source pane like links; they index the saved text, so they are withdrawn once the
document changes rather than shown at offsets that no longer mean anything.

### Found by running it

In the desktop app, typing in one item of a `*` list in K-Doc and saving rewrote the other item's
marker to `-`. The first version, judging top-level blocks only, stayed silent, which is why containers
are now entered. The finding itself was an FR-4.2 gap in the incremental serializer, closed for top-level lists in §6bn.

### Not covered

Findings are not followed through later edits. Formatting inside a paragraph whose own content changed
is not judged. A stretch where one side replaced several blocks is not entered even when it contains
a changed list.

## 6bl. Document Linting

FR-12.7 asks for a problems panel reporting broken internal links, missing images, duplicate headings, empty
links, malformed tables, unresolvable wikilinks and heading-level skips, each with a quick fix where one
exists. The panel reported only links that match no note.

### Pieces

| File | Role |
| --- | --- |
| `core/src/lint/lint-finding.ts` | `LintFinding` (rule, label, message, source range, fix), `LintFix` and `LintEdit`; `applyLintEdits`, `lineNumberAt`, and the structural tree helpers the rules share. |
| `core/src/lint/heading-rules.ts` | `headingSkips` (with a fix to the next level) and `duplicateHeadings`, over top-level headings. |
| `core/src/lint/link-rules.ts` | `emptyLinks` (two fixes), `localImages` and `missingImages`. |
| `core/src/lint/anchor-rules.ts` | `brokenAnchors(doc, hasAnchor)`: `#anchor` links no heading has. |
| `core/src/lint/table-rules.ts` | `malformedTables`: short and long rows, and header/delimiter mismatches. |
| `core/src/lint/lint-document.ts` | `lintDocument(doc, { missingImageUrls, hasAnchor })`: every rule, ordered by position. |
| `app/src/files/path-probe.ts` | Asks the host which absolute paths are files. |
| `app/src/shell/lint-controller.ts` | Resolves image addresses against the document, caches the host's answers, maps findings to problems, and applies fixes. |
| `src-tauri/src/fileops.rs` | `paths_exist`: up to 1024 absolute paths in, one boolean each out. |

### Rules are pure; the two facts they cannot know are passed in

Core cannot touch the disk and does not own the renderer's anchor rule, so `lintDocument` takes the set of
image addresses the host found missing and a `hasAnchor` lookup. The app supplies the second with
`findHeadingBySlug` over the outline, which applies GitHub's `-1`/`-2` suffixes, so `[x](#setup)` beside two
"Setup" headings resolves exactly as it will when published.

### A table that is not a table

GFM keeps each row's cells as written, so a short or long row is read straight off the tree. But when a
header and its delimiter row disagree, GFM makes no table at all and the lines stay a paragraph; that case is
found by recognising a pipe-bearing first line followed by a delimiter-shaped second line. The counts must
differ there -- had they matched, the lines would have been a table -- so the rule does not test it.

### Quick fixes

A fix is a list of text edits against the text the finding came from. The panel draws a button for it, and the
shell applies it with `applyExternalText`, so it is one undoable edit that goes through the normal session path.
`applyLintEdits` checks bounds before overlap, so a stale fix fails with the right reason, and the controller
reports it rather than editing the wrong bytes.

### Missing images and the host

`paths_exist` returns only whether each path is an existing regular file: no contents, no metadata. It refuses a
relative path, which would resolve against the host's working directory, and more than 1024 paths in one call.
The controller asks once per path, never again while an answer is pending, stops after a failure until reset so
a broken host is reported once, and forgets its answers when a document is mounted or saved -- a save is when a
missing picture has most likely been put in place. Answers are keyed by absolute path, so one arriving after a
document switch is still correct.

### Images are not notes

The vault link check fed every inline link to the note matcher, images included, so every picture was
"No note matches img/a.png". Found by running it; images are now left to the image rule.

### Not covered

Broken note links, duplicate headings, long rows and missing images have no quick fix. Headings inside quotes
and lists are not checked. A relative image did not display in the K-Doc pane at all, a separate
gap in how local images are loaded.

## 6bm. Local Images

FR-8.14 inserts images, and FR-13.1 asks a standalone export to embed them. Neither worked for a picture on
disk: the webview loads the app from its own origin, so `![a](img/a.png)` resolved against the app rather than
the note's folder and showed a broken image, and export wrote the address as it was.

### A narrow host command rather than the asset protocol

Tauri's asset protocol would serve files by URL, but it needs a scope granted in configuration or at run time,
and a scope wide enough for "any folder a note might be in" is most of the disk. `read_image_file` in
`src-tauri/src/images.rs` answers one question instead: the bytes of one file, refused unless the path is
absolute, the extension is one of png, jpg, jpeg, gif, webp, svg, bmp, ico or avif, and the file is at most
25 MiB. The path and extension checks run before the disk is touched. It is `async`, so a large file is read
off the main thread, and returns a raw binary `ipc::Response` rather than a JSON array of numbers.

A document you were sent can still name an image anywhere on your disk, and K-Doc will show it -- to you, in
your own editor. What the command will not do is hand over a file that is not an image.

### Pieces

| File | Role |
| --- | --- |
| `app/src/files/image-loader.ts` | `objectUrl(path)` (cached per path, revoked by `clear()`) and `dataUri(path)`; mirrors the host's MIME list. |
| `editor/src/prosemirror/image-view.ts` | The `image` node view: a web, data or blob address is used as written; anything else goes to the loader, with a loading state, a missing state carrying the reason, and a generation count so a slow answer for an old address is ignored. |
| `editor/src/prosemirror/binding.ts` | `ProseMirrorBindingOptions.loadImage`; without it an image renders exactly as before. |
| `core/src/render/image-sources.ts` | `replaceImageSources(root, sources)`: rewrites image addresses in a copy of the tree. |
| `core/src/render/html.ts` | `HtmlRenderOptions.imageSources`, applied before rendering. |

The shell resolves an address with the same `resolveImagePath` the document linter uses (§6bl), so an image
the Problems panel calls missing is the image that shows as missing.

### Found by running it

Two ordering bugs that no unit test could see, because the shell has no jsdom harness. The loader was created
in the constructor after the first document had already been mounted, and mounting clears it, so the app failed
to start; it is now a field initialiser. And the node view asks for an image while `mountDocument` is still
building the document, before that document's file menu exists, so relative images resolved against the
previous tab's path and fell back to their written address; `loadImageSource` now waits one microtask, by which
time `mountDocument` has run to completion.

### Not covered

An image changed on disk is not reloaded until its document is mounted again. Print (FR-13.3) still renders
local images by their written address.

## 6bn. List Items Keep Their Bytes

`serializeIncremental` diffs the root's children, so a list is one unit to it: typing in one item re-emitted
the whole list in the configured style, and a file written with `*` bullets had every item rewritten to `-`.
The Fidelity Check (§6bk) found this in the desktop app.

### Splicing items

When a replace run is exactly one list for one list, `planListItems` (`core/src/serialize/list-items.ts`)
aligns the two lists' items with the serializer's own `structuralKey` and `matchRuns` -- passed in, so the
module does not import the serializer back -- and plans a splice per changed stretch:

- **Replaced items**: the old items' span is replaced with the new items serialized as a list.
- **Deleted items**: the span runs to the start of the next item, or back from the end of the previous one, so
  the line goes with the item and no blank line is left.
- **Inserted items**: placed before the next item or after the last, with the separator the source itself uses
  between its first two items, so an item added to a loose list is set off by a blank line.

An item keeps the marker it has to have to stay in the list. `listMarker` reads the first item's bullet, and
the re-emitted items are serialized with that bullet, because a different bullet character starts a new list in
CommonMark. An ordered item is written with its own number when it replaces one, or counts on from the item it
follows; untouched items keep their numbers, even out of sequence, since only the first number is meaningful.

### When the whole list is still rewritten

`planListItems` returns null, and the list is replaced as before, when the list's start changed (which also
covers a bullet list becoming ordered: a bullet list has no start), when its tightness changed, when an item has
no position, or when the list is numbered with `)`. (Superseded in §6bv: the style now pins the delimiter, so `)` lists are
spliced too.)

### Not covered

Only lists at the top level are split. A list inside a blockquote, a blockquote itself, and the other contents of
an item being edited -- its nested list, a second paragraph -- are still re-emitted whole. (Closed in §6bv.)

## 6bo. Find and Replace Across the Vault

FR-9.5 asks for a search of every note's text, results grouped by file with snippets, a replace across files
confirmed match by match, and `Ctrl+Shift+F`. The Search panel (§6bc) only matched titles, tags, paths and
headings from the vault index, which holds no note text.

### Three layers

- **`core/src/search/vault-search.ts`** is pure. `searchFiles` runs the find bar's own `findMatches` over each
  file, so case, whole word and regex mean exactly what they mean in one document, and adds a 1-based line and
  column and a snippet to every match. `replaceSelected` replaces chosen matches in one file.
- **`app/src/shell/vault-search-controller.ts`** decides where each note's text comes from and where a
  replacement goes. It is handed functions (`notes`, `openText`, `writeOpen`, `readFile`, `saveFile`,
  `onWritten`), not the shell, so it is tested with maps standing in for tabs and disk.
- **`search-panel.ts`** draws it, with the result rows in `search-results-view.ts` and the wording and styles in
  `search-panel-text.ts`.

### Where the text comes from

An open note is searched as it is in its tab, unsaved edits included, because that is the text the user is
looking at and the text a click will reveal. The active tab's text is the session's; a background tab's is its
tab record. Every other note is read from disk once and remembered, so typing a query does not re-read the vault
on each keystroke. The memory is dropped when a folder is opened. A search superseded by the next keystroke
still remembers what it read before it gives up, since the search replacing it would otherwise read it all
again.

### Snippets

A snippet never leaves its line. It keeps up to 40 characters either side of the match, marks a cut with an
ellipsis, drops the line's leading indentation, and hides the carriage return of a CRLF line. A regular
expression match that runs over a line end is shown up to the end of its first line.

Searches stop at 2000 matches and say so: a one-letter query should not draw tens of thousands of rows.

### Confirming a replace

Every match starts ticked, so the list is the confirmation: the user unticks what to keep. A file's box ticks or
clears all of its matches and shows a dash when they are mixed, and the Replace button counts what will change.
Running the same query again (after an edit, or when the vault changes) keeps what was unticked; a different
query or option starts fresh.

Replace uses the query and options of **the results on screen**, not whatever has been typed into the box since,
so what is replaced is what was reviewed.

### Where a replacement goes

- **The active note** takes it through `applyExternalText`, so both panes update and `Ctrl+Z` takes it back.
- **A background tab** has its record rewritten, keeping the saved text it had (or its text before the edit, when
  it had none), so the tab shows as unsaved rather than the replace silently becoming the saved state.
- **A closed note** is read from disk again and written back in the encoding it was found in, and the vault index
  is told its new text.

A closed note is re-read rather than trusted from memory, and every file's chosen matches are checked against its
text as it is now: `replaceSelected` finds the matches again and replaces only those at the same range. A match
that moved since the search is left alone and reported as skipped, rather than a stale offset overwriting
whatever is there now. One note that cannot be written is reported by path, and the rest are still replaced.

### Undo

The last replace that changed anything can be undone from the panel. Each note is put back only if it still
holds exactly the text the replace wrote; one edited since is left alone and counted, because the newer change is
the one the user meant. Where a note lives is asked again at undo time, so a note closed since the replace is
restored on disk and one opened since in its tab.

### Ctrl+Shift+F

Handled beside `Ctrl+Shift+B` on the document: it shows the Search panel and focuses and selects the query, so
typing replaces the last search. A click on a match switches to the note's tab, or opens it, and puts the caret on
the match -- only once the note actually came up, since opening can fail.

### Not covered

- A note changed on disk by another program while the vault is open is searched as it was when first read, until
  the folder is opened again. A replace still reads it fresh, so it is never overwritten from the stale copy.
- A title from front matter, or a file name, is no longer matched unless the note's text contains it. The link
  dialog's note search (§6bb) still ranks notes by title and path.
- A regular expression that can match nothing (`a|`) lists every empty match, as the find bar does.
- An untitled document, or a file outside the vault, is not searched.

## 6bp. The Vault File Tree

FR-6.11 asks for a left-sidebar file tree with create, rename, delete, move by drag and drop, new file from a
template, and multi-select. The Files panel was a read-only list of notes grouped by directory.

### Host commands

`src-tauri/src/vault_files.rs` adds six commands, each taking the vault root first:

| Command | Does |
| ------- | ---- |
| `vault_list_folders(root)` | every folder as a forward-slash relative path, so an empty folder shows |
| `vault_create_note(root, path, contents)` | creates a `.md`, `.markdown` or `.mdown` file that must not exist |
| `vault_create_folder(root, path)` | creates a folder whose parent exists |
| `vault_move(root, from, to)` | renames or moves a note or folder |
| `vault_trash(root, paths)` | sends notes and folders to the Recycle Bin (async, off the main thread) |
| `vault_list_templates(root)` | the Markdown files directly in `<root>/.k-doc/templates/` |

**Every path must lie inside the vault.** `inside_vault` rejects a relative path or one with `.` or `..`,
canonicalises the parent (so a symlink in it is resolved), and requires the result to start with the canonical
root and not be the root itself. The webview can already read and write files, so this is not a sandbox; it stops
a wrong path computed by the UI from renaming or deleting something the user never saw in the tree.

**Nothing is overwritten.** A note is opened with `create_new`, a folder with `create_dir`, and a move refuses an
existing target -- except the same file under a different case (`note.md` to `Note.md`), which Windows and macOS
report as existing. A folder cannot be moved into itself.

**Delete goes to the Recycle Bin**, through the `trash` crate (MIT; on Windows it uses the shell's file operation
API through `windows` 0.62, alongside the 0.61 Tauri already pulls in). This was chosen over a permanent delete
because a file tree's Delete key is pressed by accident. Every path is validated before any is moved; a missing
path fails the whole request rather than silently shrinking it. The test that really trashes a file is `#[ignore]`d
so `cargo test` does not fill the Recycle Bin.

**Templates live in `.k-doc/templates/`**: shared with the vault through git like comments, and, being under a dot
folder, kept out of the tree, search, tags and backlinks.

### The model

`core/src/vault/file-tree.ts` is pure. `buildFileTree` turns the index's notes and the folder list into nodes,
folders before files, each sorted by `compareNames` (case-insensitive and numeric, `a2` before `a10`, with a
case-sensitive tiebreak so the order is stable). A folder a note lives in is created even when the folder list
omits it. `flattenVisible` gives the rows for a set of expanded folders. The rest are path rules the UI and the
shell share: `validateEntryName` (Windows' forbidden characters, a trailing dot, device names like `CON`),
`topLevelOnly` (a selected folder already carries what is selected inside it), `remapPath` (a moved path and
everything under it, ignoring case and separator as Windows does), and `uniqueChildName` (`Untitled 2.md`).

### The panel

- `files-panel.ts` holds the state: expanded folders, the selection, and what is being dragged.
- `file-tree-selection.ts` (click, `Ctrl`+click toggle, `Shift`+click range from the anchor, keyboard focus) and
  `file-tree-keys.ts` (key to command) are pure.
- `file-tree-view.ts` draws rows as `role="treeitem"` with `aria-level`, `aria-selected` and `aria-expanded`, one
  row taking Tab focus (roving tabindex), and indentation as a `--kdoc-tree-depth` custom property.
- `files-panel-menu.ts` builds the right-click menu and decides where a drag may drop.

A plain click selects and opens a note, or expands a folder; a modified click only changes the selection. A new
item goes into the focused folder, or the folder holding the focused note, and that folder is expanded first so the
item is visible when it appears. A drag carries the selection if the dragged row is in it, and only that row if
not; a drop is refused onto a folder inside a dragged folder, or where nothing would change folder. The drag
carries only a private data type, no text, so the editor has nothing to insert if it is dropped there (not tried
in the app).

**Opening an open note switches to its tab.** The Files panel opened a second copy of a note already open, which a
tree -- clicked far more than a list -- made obvious in the desktop app.

### What an operation does afterwards

`file-tree-actions.ts` asks for names (`prompt-dialog`), confirms a delete (`confirm-dialog`, which now hides its
middle button when `discard` is `null`), calls the host, then tells the shell:

- **Moved or renamed**: every open tab under the old path takes the new one, the active document through
  `FileMenu.followPath` so its next save goes there, and every tab record too, since the tab strip names even the
  active tab from its record.
- **Deleted**: tabs on the deleted paths close through the ordinary close, which asks first about unsaved work.

Then the vault is rescanned by opening it again, which plans the scan from the saved index (§6be) and reads only
notes whose size or time changed; `refresh()` would re-read every note after every rename. The panel keeps drawing
the last tree while a rescan of the same vault runs, because the scan empties the note list as it starts and the
rows, with the selection, would otherwise vanish after every operation.

### Not covered

- Links to a renamed or moved note are not rewritten.
- A move or rename cannot be undone from the app; a delete can be restored from the Recycle Bin.
- Only Markdown notes are shown; other files in the vault are not.
- A dismissed template picker leaves its promise unsettled (the picker has no cancel callback); nothing else waits
  on it.
- A folder's expanded state does not follow it through a rename.

## 6bq. Saves Keep the Vault Index Current

`VaultService.update(path, text)` re-indexes one note, but nothing called it when a note was saved: the only caller
was vault search's replace. A tag, link or heading added and saved stayed out of the Tags, Backlinks and Problems
panels until the folder was opened again.

The Save, Save As and autosave path ends in the file menu's `onSaved`, which now asks `planVaultSaveSync`
(`app/src/files/vault-save-sync.ts`) what the save means:

- **none**: no vault is open, the document has no path, or the file is outside the vault (compared with `remapPath`,
  so `C:ault2` is not inside `C:`), or it is a file the index does not hold that is not a note.
- **update**: a note the index holds. It is re-indexed from the text just written, under the index's own spelling of
  its path (matched with `samePath`), and vault search forgets the text it remembered for it.
- **rescan**: a note file the index does not hold yet, such as a Save As into the vault. Only a scan can add it, and
  reopening the vault plans from the saved index (§6be), so the scan reads just that file.

The planner is pure so every case is tested; the shell only acts on its answer.

## 6br. The Keymap Model

FR-14.16 asks for remappable shortcuts with conflict detection and presets; FR-20.2 says every binding in the
spec's §20 table is remappable and the presets differ only in that table. Shortcuts today are a dozen document
listeners plus the editors' keymaps, and nothing records a binding anywhere a user could change it. This section is
the data those need; the service that dispatches keys from it, and the dialog that edits it, follow.

### Chords

`config/src/keymap/chords.ts` gives every shortcut one spelling: modifiers in the order Ctrl, Alt, Shift, then one key
(`Ctrl+Shift+S`, `Alt+Up`, `F7`). `Ctrl` is the primary modifier, Cmd on macOS, as the existing handlers already
treat it. `normalizeChord` reads looser spellings (`shift+ctrl+s`, `Cmd+Z`, `Ctrl+>`) and refuses anything that
would take over typing or editing: a letter, digit, arrow or Tab needs Ctrl or Alt; only F1-F12 stand alone.

`chordFromEvent` names a key press the same way. A **letter comes from the character typed**, so Ctrl+Z is the key
labelled Z on AZERTY too; a letter key typing a non-Latin character falls back to its position. **Digits and
punctuation come from their position**, because Shift changes the character (`Ctrl+Shift+=` types `+`) but not the
key. A shifted character in a written chord is stored as Shift plus its key (`Ctrl+>` is `Ctrl+Shift+.`), and
`formatChord` shows it back as `>`.

### Presets

`presets.ts` lists the remappable commands, each with a **scope**:
- **global**: works anywhere.
- **document**: works unless typing in a form field (undo, redo, Paste Special, insert image).
- **editor**: only while the K-Doc pane has focus (formatting).

`WORD_BINDINGS` is the §20 table plus the shortcuts K-Doc already had that the table does not name (next document,
settings, ribbon, rename). The other presets override only the commands they change:
- **VS Code**: Quick Open on `Ctrl+P` (Print moves to `Ctrl+Alt+P`), the sidebar on `Ctrl+B` (Bold moves to
  `Ctrl+Shift+B`), zoom on `Ctrl+=` / `Ctrl+-` (sub- and superscript move to `Ctrl+Alt+=`).
- **Typora**: headings on `Ctrl+1`-`6` and paragraph on `Ctrl+0` (zoom reset moves to `Ctrl+Shift+0`), its code, list,
  strikethrough, table and sidebar keys.
- **Obsidian**: Quick Open on `Ctrl+O` (Open moves to `Ctrl+Shift+O`), the palette on `Ctrl+P`, the view toggle on
  `Ctrl+E` (inline code loses its key), task list on `Ctrl+L`.

Cut, copy, paste, paste as plain text, and Tab / Shift+Tab in lists stay fixed: the browser performs the first three,
plain paste has to let the real paste event happen, and list indentation is part of editing a list.

`UNBOUND_SHORTCUT_EXPLANATIONS` holds the FR-20.1 one-liners for `Ctrl+U`, `Ctrl+J` and `Ctrl+1`/`2`/`5`.

### Resolving and conflicts

`resolveKeymap(preset, overrides)` gives each command its chords (the user's own list if they set one, an empty list
meaning unbound, else the preset's) and a chord-to-command map. When two commands claim a chord, a command the user
bound themselves gets it before a preset binding, so a deliberate choice is never lost to a default, and every such
chord is reported as a conflict. Every preset is tested to have none of its own. `withBinding` records a change and
drops it again when it matches the preset; `withoutChord` takes a chord away from everything but one command.

### Settings

`settings.json` gains a `keyboard` section, `{ "preset": "word", "bindings": { "format:bold": ["Ctrl+Alt+B"] } }`,
parsed and serialized in `keymap/keyboard-settings.ts` so `schema.ts` only wires it in. Chords are stored canonically;
one that cannot be used is dropped with a warning; command ids the app does not know are kept, so a newer version's
binding survives an older one. Bindings are written sorted by command, so the file diffs cleanly.

## 6bs. Dispatching Shortcuts from the Keymap

§6br described the bindings; this is what runs them. Before it, nine document listeners in the shell, one each in
the file menu and find bar, and ProseMirror's keymap each claimed their own keys. Some keys fired twice: `Ctrl+=`
subscripted and zoomed, and in the Source pane `Ctrl+/` both switched view and toggled a comment.

### One listener

`installKeymapService` (`app/src/shell/keymap-service.ts`) adds one `keydown` listener to the document in the
**capture phase**, so it decides before either editor sees the key. For a key it names:

1. The chord is looked up in the keymap in effect, read afresh on every key, so a changed binding applies at once.
2. The command's scope is checked against where the key was pressed (`keymap-scope.ts`), classified from the event
   target as the K-Doc pane, the Source pane, a text field, a widget with keys of its own (a tree, list, menu,
   grid or tab strip), or anywhere else:
   - **editor** commands run only in the K-Doc pane, so `Ctrl+B` in Source is still nothing;
   - **document** commands (undo, redo) never run in a text field, whose own undo the key belongs to;
   - a **global** command without Ctrl or Alt (`F2`, `F7`) is left to a widget, so F2 in the file tree renames the
     item rather than the document.
3. If allowed, the key is prevented and stopped, and the registry command runs.

A key already prevented by someone else, or any key while the service is suspended (for recording a shortcut), is
left alone.

### What the editors and panels give up

- ProseMirror's keymap takes `hostOwnsShortcuts`, which removes the §20 bindings (`HOST_OWNED_KEYS`) so a key the user
  moved stops doing its old job. **Undo and redo stay** in both editors: if they went and the user remapped undo, the
  browser's own undo would run on the editor and change its DOM behind its back.
- The find bar and the file menu take `ownShortcuts: false`. Both default to owning their keys, so they still work,
  and their tests still hold, on their own.
- `Ctrl+Shift+V` stays a separate listener: it only marks the next paste as plain and must not prevent the key,
  because the browser's paste event is what carries the clipboard.

The shell's keyboard-only behaviours became registry commands the keymap can name:
- the command palette, cycling the view mode and toggling the sidebar;
- Replace and Find in Vault;
- new comment and track changes.

`insert:link` now opens the dialog on the link under the caret, as ProseMirror's `Mod-k` did.

### Labels

`labelWithKeymap` relabels each registry command with its first chord in effect, or none when it is unbound, so the
palette, ribbon tooltips and native menu show what the keys actually do. A command outside the keymap (list
indentation, plain paste) keeps its fixed label. Settings changes resolve the keymap again and refresh the menu.

### FR-20.1

A chord the keymap does not bind but `UNBOUND_SHORTCUT_EXPLANATIONS` names (`Ctrl+U`, `Ctrl+J`, `Ctrl+1`/`2`/`5`) is
prevented and explained in a one-line bar above the status bar (`key-hint.ts`). The bar has a Dismiss button and goes
by itself 8 seconds after the latest message. Nothing is said while typing in a text field, and nothing once a preset
or the user binds the chord.

### Not covered

- There is no dialog to remap shortcuts yet; the settings file is the only way. (Added in 6bt.)
- The Source pane has no bindings of its own for the formatting commands, as before.
- Native menu accelerators come from the same labels; a label Tauri cannot parse (`Ctrl+Shift+>`) still has no
  accelerator, as before.

## 6bt. Keyboard Shortcuts Dialog (FR-14.16)

`view:keyboard-shortcuts` (palette and View menu, unbound by default) opens a dialog to search and remap every
command in `KEYMAP_COMMANDS`. It edits `settings.keyboard` and saves on every change, the same path as the Settings dialog.

### Modules

- `packages/app/src/shell/keyboard-shortcuts-model.ts` is pure and has no DOM. It wraps `resolveKeymap`,
  `withBinding` and `withoutChord` from `@k-doc/config`.
  - `shortcutRows` lists the rows. A query matches the label, category, id or displayed chord.
  - `recordChord` returns one of three outcomes:
    - `added`, with the next settings;
    - `already`;
    - `taken`, naming the command that holds the chord.
  - Edits:
    - `takeChord` moves a chord from its current holder.
    - `removeChord` removes one chord from a command.
    - `resetCommand` restores one command to its preset.
    - `resetAll` restores every command to its preset.
    - `choosePreset` switches preset and keeps the user's own bindings.
  - `conflictSummary` returns a warning when two commands claim the same chord.
- `packages/app/src/shell/keyboard-shortcuts-dialog.ts` is the `<dialog>`. It contains:
  - a search box and a preset select;
  - Reset All and Close;
  - a status line, plus a separate conflict line so a message never hides or stales it;
  - one row per command, with its chord chips (conflicting chips outlined), a remove button on each chip, Add and Reset.

### Recording

Add puts the row into recording and calls `onRecording(true)`. The shell passes that to
`keymapService.setSuspended`, so the pressed keys reach the dialog instead of running commands.

A capture-phase keydown listener on the dialog handles each key:
- A lone modifier waits for the key.
- Bare Escape cancels, and the dialog's `cancel` event is refused while recording so Escape does not close it.
- A key `chordFromEvent` rejects shows a warning.
- A free chord is added.
- A chord another command holds asks first: Enter moves it, Escape leaves it where it was.

### Shell

The dialog's `onChange` does four things:
1. Sets `settings.keyboard`.
2. Pushes the result into the Settings dialog, whose own copy would otherwise write the old bindings back.
3. Calls `applySettings`, which resolves the keymap again and relabels the menus.
4. Saves the settings.

### Not covered

- Only commands in `KEYMAP_COMMANDS` are listed. The keys FR-20.2 leaves out (cut, copy, paste, plain paste, Tab in
  lists) are not.
- Native menu accelerators are not re-registered while the app runs, beyond the existing `menuBar.refresh()`.

## 6bu. Navigation History (FR-9.10)

Alt+Left (`nav:back`, Go Back) and Alt+Right (`nav:forward`, Go Forward) move through where the caret was before each
jump.
- They are in every preset and remappable.
- They use document scope, so a text field keeps the keys.
- They are also in the palette and menus under Find.

### Modules

`packages/app/src/shell/navigation-history.ts` holds the state and has no DOM. The pure functions:

- **`NavLocation`** is `{ tabId, path, offset }`, with `offset` a Markdown source offset. The path lets a location be
  reached after its tab closes.
- **`sameLocation`** compares offsets first. Two locations match if they have the same tab, or the same non-null path.
- **`recordJump`** pushes onto `back` and clears `forward`, as a browser does.
  - A repeat of the newest entry is dropped.
  - Each stack keeps at most `NAV_HISTORY_LIMIT` (50) entries.
- **`stepBack` / `stepForward`** pop the newest entry and park the current location on the other stack.
  - An entry equal to the current location is still a step. The shell reads the caret from the last-focused pane, which
    can lag what is on screen: the outline reveals only in Source without focusing it. Skipping such an entry would
    jump one step too far.

The same module has the stateful wrapper:

- **`createNavigator({ current, show })`** turns those functions into `recordJump()`, `back()` and `forward()`.
  - An unreachable location (`show` resolves false) is dropped and the next one is tried.
  - A press while a location is still opening is ignored.
  - `busy` is released in `finally`, so a throwing `show` cannot lock the navigator.

### Shell

- **`currentNavLocation()`** combines the active tab, its path and `navigationCaretOffset()`.
- **`showNavLocation(location)`** tries these in order:
  1. the same tab;
  2. an open tab on the same path;
  3. `openNoteFromVault(path)`.

  It reveals only when the expected document is active, clamping the offset to the text length. An unsaved document
  whose tab closed is unreachable.

`navHistory.recordJump()` runs just before each of these jumps:
- a followed heading or note link (`followLink`; web, mail and other kinds are not jumps);
- Go To, by line or heading;
- Quick Open;
- the outline pane and the breadcrumb bar;
- a vault search result;
- opening a note from the file tree, the Files panel, Tags, Backlinks or Recent Files.

Switching tabs, find next and ordinary caret movement are not recorded.

### Not covered

- Mouse back/forward buttons are not bound.
- History is per window and not persisted.
- After a note is renamed or moved, a closed tab's entries keep the old path and are skipped as unreachable.

## 6bv. Blocks Inside Containers Keep Their Bytes (FR-4.2)

Splicing now reaches below the top level. An edit inside a blockquote, inside a list in a blockquote, or among the
blocks of a list item (a nested list, a second paragraph, the text after a task checkbox) re-emits only the innermost
block that changed. Everything else keeps its bytes. A list numbered with `)` is spliced too.

### Modules

- `packages/core/src/serialize/line-prefix.ts` works out what each continuation line carries.
  - `continuationPrefix(text, offset)` reads the line up to a block's start. A `>` or tab stays; anything else
    becomes a space.
  - `itemContentPrefix(text, itemStart)` gives the prefix before a list marker, plus one space per column of the
    marker and its gap. A gap of none or more than four columns counts as one.
  - `indentContinuation(fragment, prefix)` prefixes every line after the first. A blank line gets the prefix without
    its trailing spaces: `>` in a quote, nothing in an item.
- `packages/core/src/serialize/containers.ts` does the splicing.
  - `planChildren` aligns a container's blocks with the same structural keys and LCS as the top level.
    - An unchanged block is kept.
    - A blockquote or list replaced one-for-one is spliced inside in turn.
    - Anything else is re-emitted with the container's prefix.
    - A deletion takes one separator with it.
    - An insertion is spaced like the first two blocks, or by a prefixed blank line when there is only one.
  - `planBlockquote` refuses an alert whose first paragraph changed. The `[!KIND]` marker is only written unescaped
    as a quote's first paragraph.
  - `planItemChildren` refuses an item whose checkbox changed. It measures the prefix from the item's marker, not
    from its first block, which starts after any checkbox.
  - `listSpliceDeps` passes `planItem` to `planListItems`, which tries it for an item replaced one-for-one before
    re-emitting the item whole.
- `planListItems` now works at any depth.
  - It prefixes re-emitted items with the prefix before the first item's marker.
  - A one-item list's inserted item gets that same prefix.
  - It pins `orderedListDelimiter` (a new optional `MarkdownStyle` field, mapped to remark's `bulletOrdered`), so
    `)` lists no longer fall back.

### Checks and fallbacks

- `serializeIncremental` tries container splicing for a one-for-one list or blockquote at the top level.
- When any splice went below item level, `splicesParseAlike` applies the splices to that block's slice alone and
  parses it. It also parses the block re-emitted whole, and accepts the splices only if both have the same
  structural keys. Otherwise the block is replaced whole, as before.
  - Copied separators can change meaning in rare shapes. A paragraph added after a quoted list, separated by
    `\n> `, would become a lazy line of the last item.
  - Two small parses per edit, and only for edits inside containers.
- A replaced stretch with as many new blocks as old, each of the same type, is taken pair by pair. One changed
  block then keeps its untouched parts even when its neighbour changed as well. Pairs whose types differ stay one
  stretch: a separator valid before an ordered list (a single newline after a heading) may not be valid after a
  paragraph.

### Editor

The ProseMirror `listItem` gained a `spread` attribute, carried both ways.
- Before, every item came back tight.
- A loose item in a tight list therefore never matched its source, and every save rewrote its list, including the
  neighbouring list in the same replaced stretch.
- Desktop testing found this.

### Tests

- `incremental-containers.spec.ts` has byte-exact cases for quotes, quoted lists, nested quotes, alerts, item
  blocks, tasks, `)` lists, stretch pairing, and the parse-check fallbacks.
- `incremental-edit-sweep.spec.ts` covers 15 documents in non-canonical container syntax. It edits every text node,
  adds a paragraph to every container, and removes every container's first block. Each save must read back as a full
  rewrite does, since some of those trees (a second block in a tight item) have no exact Markdown form.

### Not covered

- Granularity stops at the innermost block. An edited paragraph, heading, table or code block is re-emitted whole,
  so non-canonical inline syntax inside it (`*emphasis*`) is normalised.
- CRLF documents are spliced by the same code, but only the sweep's one CRLF source covers them.

## 6bw. Interface Font Outside the Shell

The interface font was set only on `.kdoc-shell`. Dialogs, menus, hover cards and popups are appended to `<body>`,
outside the shell, so they rendered in the browser's default serif face.

- `packages/app/src/shell/ui-font.ts` defines the font once:
  - `UI_FONT_STACK`: the platform UI face first, then sans-serif fallbacks.
  - `UI_FONT_STYLES`: a `body` rule using that stack.
- The shell stylesheet starts with `UI_FONT_STYLES`.
- `.kdoc-shell` and the picker dialog use `UI_FONT_STACK` instead of their own copies of the stack.
- A component that sets its own font (monospace code, chord chips) is unaffected.

## 6bx. One Tab per Note

Following a link to a note that was already open opened a second tab on the same file. Opening from the Tags or
Backlinks panel did the same. Two buffers on one file split its unsaved edits, and whichever saved last won.

- `packages/app/src/shell/open-tab.ts` exports `openTabFor(tabs, path)`. It returns the first tab whose path is the
  same file (`samePath`: separators and case ignored), or null. An unsaved tab never matches.
- `openNoteFromVault` checks it first and activates that tab instead of reading the file again.
- Every route that opens a note by path now switches to an open tab:
  - followed links (then revealing the link's heading);
  - Tags, Backlinks, the Files panel and file tree;
  - Quick Open, vault search results and navigation history.
- `openOrActivatePath` is now a plain call to it.

Not covered: File > Open and Recent Files read the file directly and can still open a second tab on a file that is
already open.

## 6by. CRLF Files Are Edited as LF

A note saved with Windows line endings kept `\r\n` in the session text, but CodeMirror counts every line break as one
character whatever its separator. So on a CRLF note:
- Source-pane offsets drifted one character per line from the session's.
- Outline and Go To line reveals near the end threw "Selection points outside of document".
- Any edit typed in the Source pane sent CodeMirror's LF text back, silently converting the whole file to LF.

Setting CodeMirror's `lineSeparator` cannot fix this: `Text` offsets still count one character per break.

### The file service converts at the disk boundary

- `packages/app/src/files/line-endings.ts` does the conversion.
  - `fromDisk(text)` gives the editor LF text and records `crlf`, but only when every line break is CRLF. A file
    mixing endings, or using LF, is kept exactly as written.
  - `toDisk(text, lineEnding)` turns every LF back into CRLF. It is the exact inverse, so a pure CRLF file round-trips
    byte for byte, including a carriage return before a CRLF.
- `createFileService` passes every read through `fromDisk` (`openFile`, `readFile`, and `readPath` for the
  external-change watcher). It remembers each file's line ending by normalised path.
- `saveFile` chooses a line ending in this order:
  1. `SaveTarget.lineEnding` when the caller names one;
  2. the remembered one for that path;
  3. for a path this window has not seen (a dragged-out tab's window), the line ending of the file on disk;
  4. LF for a file that cannot be read, usually because it is new.
- `lineEndingOf(path)` exposes what the service remembers. Save As and Save a Copy pass the original file's line
  ending, so the new file matches it.
- Vault find/replace reads and writes through the service, so replacements keep CRLF.
- The vault scan reads files directly and indexes `fromDisk(...).text`, so heading and link offsets match the editor.

Every offset inside the app is now over LF text: session, ProseMirror mapping, CodeMirror, search, outline and
navigation history.

### Not covered

- A file mixing line endings keeps its `\r` characters. For that file, CodeMirror's offsets still drift as before.
- Track-changes anchors saved in `.k-doc` against a CRLF note before this change counted CRLF, and point slightly
  early in such a note until they are recorded again.
- A note created from a CRLF template is written with LF.

## 6bz. Table Sort, CSV and HTML Paste, TSV Copy (FR-8.23, FR-8.24)

### Sorting

`packages/editor/src/prosemirror/table-sort.ts` holds the sort. The command is `sortTableByColumn(direction)`, offered
as Table commands, context-menu entries, and toolbar buttons (A→Z, Z→A). A button is disabled when sorting would not
change the order.

The column's kind comes from `detectColumnKind`, which ignores empty cells:
- **number:** every filled cell reads as a number (sign, currency, thousands separators, decimals, percent).
- **date:** every filled cell is an ISO date with optional time, or a day-and-month-name date. `15/09/2026` is not a
  date, because day-first and month-first cannot be told apart.
- **text:** anything else, compared with a numeric, case-insensitive collator.

`validDate` rejects dates that do not survive a `Date.UTC` round trip, such as 30 February.

`sortOrder` returns a stable permutation. Empty cells go last in either direction.

The command:
- keeps the header row first;
- rewrites the table through `applyTableRewrite`, keeping column alignment;
- moves the caret with its row;
- refuses when the rows are already in order, which also covers tables with fewer than two body rows.

### Pasting a table

Table paste mode tries three readers in order:
1. tab-separated text (`parseDelimitedText`);
2. comma- or semicolon-separated text (`csv-table.ts`, RFC 4180 quoting, with a line break inside a quoted field
   becoming a space);
3. the first table in the clipboard's HTML, converted through `htmlToMdast`, so cell formatting is kept.

`canPasteAsTable(html, text)` runs the same tests, and the paste-options control offers Table exactly when a table
would result.

Two paste fixes were found in the running app:
- **Empty paste range.** `pasteContentAt` reported the old selection mapped through the transaction. A block pasted
  with the caret at the end of a paragraph lands after it, so that range was empty, and choosing another reading added
  a second copy. `changedRange` now widens the range over every span the transaction replaced, mapping ends through
  later steps.
- **Carriage returns.** Pasted text has `\r\n` and lone `\r` turned into `\n`, so a Windows clipboard does not put
  carriage returns into the document.

### Copying a table

The K-Doc view's `clipboardTextSerializer` is `clipboardText` (`table-tsv.ts`).
- A copied table, whole rows, or cells of one row go on the plain-text clipboard as tab-separated values.
- A tab or line break inside a cell becomes a space.
- Anything else is the default paragraph text.

### Not covered

- Sort by one column only; there is no multi-column sort.
- Dates with numeric day/month order are sorted as text.
- A pasted HTML table is only used when the text is not itself a grid.

## 6ca. Table Header Toggle and Escaping Warnings (FR-8.25)

### Header row

GFM has no table without a header row, so "no header" is written as an empty header row. That is valid Markdown and
round-trips.

- `packages/editor/src/prosemirror/table-header.ts` exports:
  - `headerRowIsEmpty(table)`: true when the first row's content size is twice its cell count, which means only empty
    cells;
  - `hasHeaderRow(state)`;
  - `toggleHeaderRow()`.
- With a header, the toggle puts an empty row above it. Without one, it removes the empty header row, promoting the
  first body row. It refuses a table that is only an empty header.
- The caret keeps its cell. A caret in a removed header asks for row -1, which `cellStartPos` clamps to the new header.
- The command is offered as Toggle Header Row in the palette and context menu, and as an **H** toolbar button whose
  `aria-pressed` shows whether the table has a header.

### Escaping warnings

`table-escape-warnings.ts` exports `escapeKindsIn(tr)`. For each `ReplaceStep` whose insertion point is inside a table
cell, it reports:
- `pipe`, for inserted text containing `|`, which the serializer writes as `\|`;
- `line-break`, for a hard break or text containing a line feed, which a GFM cell cannot hold and the serializer writes
  as a space.

Other steps, such as mark steps, carry no content.

`createTableEscapeWarningPlugin(onWarning)` observes transactions in `appendTransaction`, reporting each kind once per
batch. Session syncs replace the state with `updateState`, not a transaction, so loading a document never warns.

The shell passes the plugin with the binding's other plugins. `warnTableEscape` shows `TABLE_ESCAPE_MESSAGES[kind]` in
the status line once per kind per mounted document.

### Not covered

- The warning does not stop the line break being entered; the save turns it into a space.
- An empty header row renders as an empty first row in K-Doc rather than being hidden.

## 6cb. Column Width Hints and Cell Formatting (FR-8.26)

GFM has no column widths. A width hint is a **minimum column width in characters**, written as a delimiter-row cell
longer than the column's content (`| --------- |`). Every GFM reader accepts that. The padded serializer keeps it,
because padding a column to at least its hint is still an aligned table.

### Core

`packages/core/src/table/column-widths.ts` holds the logic:
- `splitTableRow` splits a line on unescaped pipes.
- `delimiterMinimum(align)` is the shortest delimiter the serializer writes: 1, 2 for left/right, 3 for center.
- `columnWidthHints(lines, align)` gives a hint to a column whose delimiter is longer than both its widest content and
  that minimum.
- `annotateTableWidths(text, root)` runs at the end of `parseMarkdown`. It reads each table's source lines, past any
  container prefix, and stores the hints as `table.data.kdocColumnWidths`. The tree keeps no dash counts.
- `hintsOf(table)` validates stored hints: a non-empty array of positive integers and nulls.
- `applyColumnWidths(text, hints, align)` widens a padded, aligned table. The delimiter row gains dashes inside any
  leading colon; other rows gain spaces placed by alignment.

The serializer's `table` handler wraps `mdast-util-gfm-table`'s own handler, built with the same options remark-gfm
receives. It applies hints only when `padTableCells` is on. `mdast-util-gfm-table` is now a declared dependency of
core; it was already installed as a dependency of remark-gfm.

A canonical table has no hints, so the golden corpus is unchanged. A hinted table re-serializes identically, so an
unchanged save is still free.

### Editor

- `tableCell` gained a `widthHint` attribute.
  - `mdastToProseMirror` puts a table's hints on its header row's cells.
  - `proseMirrorToMdast` reads them back and writes `data` only when a hint exists, so an untouched table compares
    equal to its source.
- Storing the hint on the header cell means a column move, duplicate or sort carries it, with no parallel array to
  keep in step.
- A hinted header cell renders `min-width: Nch`.
- `table-width.ts` has:
  - `columnWidthHintAt(state)`;
  - `setColumnWidthHint(width | null)`, a structural `setNodeMarkup` on the caret column's header cell, refusing
    non-integers, values outside 1–200 (`MAX_WIDTH_HINT`), and unchanged widths;
  - `parseWidthHint(text)`, which reads the prompt's answer.
- The shell's `askColumnWidth` is reached from Column Width… in the palette, the Table menu and the ribbon.

### Cell formatting within GFM's constraints

A GFM cell holds inline content only. Bold, italic, code, links and strikethrough all work in cells. The schema
(`tableCell: inline*`) refuses block formats, so the ribbon's Heading, List, Quote and Code Block buttons are disabled
while the caret is in a cell. Alignment is per column, `setColumnAlign`, as GFM allows.

### Not covered

- The K-Doc width is approximate: `ch` in the proportional UI font.
- A hint cannot be dragged; it is set by number.
- HTML export does not apply hints.

## 6cc. Table of Contents (FR-8.30)

A table of contents is a real Markdown list of links to heading anchors, between two HTML comments:

```markdown
<!-- toc depth=2 -->

- [Guide](#guide)
  - [Install](#install)

<!-- /toc -->
```

The comments are invisible in every renderer and are what a refresh finds. The editor holds them as raw HTML blocks
(`unknownBlock` nodes whose `node` is an mdast `html` node), editable as source.

### Core

`packages/core/src/outline/toc.ts` holds the logic:
- `headingSlug` (moved from the app) and `headingAnchors(texts)`, which gives GitHub's `-1`, `-2` suffixes for
  repeated slugs. `findHeadingBySlug` in `link-target.ts` now uses `headingAnchors`, so a generated link and a
  followed link always agree on which heading an anchor names.
- `tocStartMarker(depth)`, `parseTocStart(html)` and `isTocEnd(html)`. A bare `<!-- toc -->` means
  `DEFAULT_TOC_DEPTH`, 3.
- `tocItems(headings, maxDepth)`:
  - Anchors are counted over every heading, listed or not.
  - A heading nests under the nearest shallower heading before it, and a skipped level nests one step.
- `tocList(items)` builds the tight nested mdast list.

### Editor

`table-of-contents.ts`:
- `documentHeadings(doc)` returns the top-level headings, as the outline lists them.
- `findTableOfContents(doc)` finds the first start marker and the next end marker.
- `insertTableOfContents(depth)` inserts markers and list at the caret. It refuses a depth that is not an integer up
  to 6, a document that already has a table of contents, and a document with no heading that deep.
- `refreshTableOfContents()` replaces what lies between the markers. It refuses when there are no markers or nothing
  has changed. With no listed headings it leaves the markers empty rather than inserting an empty paragraph.

### Shell

- **Insert → Table of Contents…** refreshes the document's existing table of contents and says whether anything
  changed. Otherwise it asks for the depth (default 3) and inserts one.
- **Refresh Table of Contents** is a palette command, enabled only when a refresh would change the list.

### Not covered

- The list does not refresh by itself when headings change; refreshing is on demand, as the requirement says.
- The depth is asked each time rather than kept as a setting.
- Only top-level headings are listed; headings inside blockquotes or lists are not, matching the outline.

## 6cd. Folding (FR-8.29)

Heading sections and list items fold in both panes, and the folds are the same in both. They are kept per document.

### One key per foldable place

`packages/core/src/outline/fold-targets.ts`:
- `foldTargets(document)` lists every foldable place with a source range:
  - A top-level heading's section runs to the next heading at its level or above, as the outline counts it.
  - A list item, at any depth, runs to the end of the item.
- `foldKeys(entries)` names each place:
  - A heading is `heading:<anchor>`, using the anchors links use, so repeated headings are `-1`, `-2`.
  - A list item is `item:<first line text>`, with `#1`, `#2` for repeats.
- `innermostFoldTarget(targets, offset)` gives the innermost place containing an offset.

The key comes from the content, not from positions. So:
- the K-Doc pane can compute it from the ProseMirror document;
- the Source pane can compute it from the session's parsed document;
- an edit elsewhere in the file does not move it.

`outline.ts` now exports `flattenText` for this.

### The store

`packages/app/src/shell/fold-state.ts`:
- `createFoldController` is the set of folded keys for the mounted document. It notifies only when the set really changes.
- `loadFolds` / `saveFolds` keep the set per file path in `localStorage` under `kdoc.folds.v1`:
  - Paths are case-folded, with forward slashes.
  - Only the 500 most recently changed documents are kept.
  - A document with nothing folded is dropped.
- A stored value that is not the expected shape throws. The shell then resets the store and says so.
- A document that has never been saved keeps its folds in its tab (`DocumentState.folds`) until it is closed.

### K-Doc

`packages/editor/src/prosemirror/fold-plugin.ts` renders from the document plus the store:
- Every foldable heading gets a ▾/▸ button in the left margin, shown on hover, on keyboard focus, or while folded.
- A list item with more than one block gets the same button.
- A folded heading hides the blocks of its section; a folded item hides every block after its first. Hidden blocks get `display: none` through node decorations, and the folded node gets a trailing "…".
- The document is never changed, so folding does not make the file dirty or add an undo step.

Fold state is not held in plugin state, because the binding rebuilds its EditorState whenever the other pane edits. Instead:
- The plugin view subscribes to the store and redraws.
- A fold that would swallow the caret moves it to the end of the line that stays visible.
- A selection that lands in hidden content unfolds that section in a microtask. This covers outline jumps, find, and history.
- `toggleFoldCommand(store)` toggles the innermost foldable place at the caret.

### Source

`packages/editor/src/codemirror/source-folds.ts` leaves the fold ranges to `@codemirror/lang-markdown`: heading sections come from its fold service, list items from `foldNodeProp`.
- `applySourceFolds` makes CodeMirror's folds match the store for each target that Source can fold. Folds that are not targets, such as a fenced block, are left alone.
- `sourceFoldListener` reports folds the user makes (gutter, `Ctrl+Shift+[`, or CodeMirror clearing a fold the caret entered). It ignores edits and its own annotated transactions.

`packages/app/src/shell/fold-sync.ts` joins the two for a mounted document:
- User folds in Source go into the store with `setMany`.
- Store changes are saved and re-applied to Source in a microtask, since CodeMirror refuses a dispatch during its own update.
- `sessionChanged` re-applies after the Source binding replaces its text, which happens whenever K-Doc edits.
- Nothing is applied while Source's text length differs from the session's.

### Commands

In the View category of the palette: **Toggle Fold** (acts on the focused pane's caret), **Fold All Headings** and **Unfold All**.

None has a default shortcut:
- Source keeps CodeMirror's own fold keys.
- `Ctrl+Shift+[` / `]` already belong to lists in the Typora preset.

### Not covered

- Renaming a folded heading, or editing the first line of a folded item, changes its key, so the fold opens.
- Keys for files that no longer exist stay in storage until the 500-document limit drops them.
- A list item whose first block is not a paragraph (for example a quote) has no button; Toggle Fold still folds it.
- Folds are remembered per path. A renamed or moved file starts unfolded, and Save As does not carry folds to the new path.
- The outline pane's own collapse state is separate and not saved.

## 6ce. Reference Links in K-Doc

Reference-style links (`[text][label]`, `[label][]`, `[label]`) and link definitions (`[label]: url "title"`) used to
reach the K-Doc pane as opaque atoms reading "[unrenderable inline]" and "[unrenderable block]". They now render as
what they are, and the round trip still writes them back byte for byte.

### Reference links are link marks

`packages/editor/src/prosemirror/reference-links.ts` holds the helpers.

`from-mdast.ts`:
- Collects the document's definitions first with `collectDefinitions`. The first definition of a label wins, and
  definitions inside quotes and lists count.
- Threads them through `convertBlock` and `convertInline`.
- Turns a `linkReference` into the ordinary `link` mark, so it is clickable, shows the link hover card and follows like
  any link:
  - `href` and `title` come from the definition.
  - The new `reference` attribute keeps `{ identifier, label, referenceType, text }`, where `text` is the plain text of
    the link when parsed.

`to-mdast.ts` writes a link mark that carries a reference back as a `linkReference` (`linkReferenceNode`):
- A collapsed or shortcut reference spells its label with its text. When that text has been edited it is written as a
  full reference, `[edited text][Label]`, which keeps it pointing at the same definition.
- Replacing a link's target through the link dialog creates a fresh mark without `reference`, so the link becomes an
  inline link with the new target, and the definition is left as it was.

### Definitions read as source

Definitions stay `unknownBlock` atoms. `unknownNodeText` gives the text both the schema's `toDOM` and `RawSourceView`
show:
- the raw value when the node has one;
- `[label]: url "title"` for a definition;
- otherwise the old placeholder.

### Not covered

- Definitions cannot be edited in K-Doc; edit them in Source.
- Image references (`![alt][label]`) still show the placeholder. (Footnotes have their own nodes; see §6b.)
- Adjacent links with the same mark type are still grouped by mark name when written back (unchanged behaviour).

## 6cf. Reference Link Tools (FR-8.16)

Two tools manage reference-style links: a command that converts inline links, and a panel that lists definitions. They
build on §6ce, which made reference links readable in K-Doc.

### Core

`packages/core/src/references/reference-links.ts` works on the parsed document and its source text.

`convertToReferenceLinks(document)` returns `{ text, converted }`. It rewrites every inline link `[text](url "title")`
as `[text][label]`:
- The link text is kept as written, formatting included.
- Links with the same destination and title share one definition.
- An existing definition for that destination and title is reused under its own label.
- New labels are the lowest unused numbers, skipping labels the document already defines.
- New definitions go at the end of the document. They extend a trailing definition block, or start a new block
  after anything else.
- A destination that is empty or contains spaces is written in angle brackets, and quotes in a title are escaped, so
  the definition parses back to the same link.
- Autolinks, bare URLs and links with empty text are left alone.
- The result is applied with `applyExternalText(..., { coalesce: false })`, so it is a single undo step in both panes.

`linkDefinitions(document)` lists every definition in document order:
- label as written, destination, title, and source range;
- how many link and image references name it;
- whether it is a duplicate, meaning an earlier definition of the same label shadows it.

### Panel and commands

`packages/app/src/shell/link-definitions-panel.ts` is the **Link Definitions** panel in the right sidebar, between
Problems and Review:
- A header shows the count and a **Convert inline links** button.
- Each definition is a row with its label, its destination and title, and a badge: "used N times", "unused" or
  "duplicate, never used". The last two use the warning colour.
- Clicking a row shows the definition in Source, switching K-Doc to Split, because a definition is only editable as
  source. The jump is recorded in navigation history.
- The panel refreshes on every session change and every mount.

Palette:
- **Convert to Reference Links** (Insert) converts the links, reports the count, and opens the panel. It says so when
  there is nothing to convert.
- **Link Definitions** (View) opens the panel.

### Not covered

- Images are not converted to image references.
- There is no reverse command (reference to inline) and no "remove unused definitions" action.
- Labels are always numbers. A definition cannot be renamed from the panel.

## 6cg. Format Painter (FR-8.3) and Right Panel Toggle

### Painter

`packages/editor/src/prosemirror/format-painter.ts` is a ProseMirror plugin whose state is
`{ marks: Mark[] | null, locked }`.

Picking up (`pickUpFormat(locked)`):
- It records the character formatting at the selection: the marks of its first character, or at a caret the marks
  typing would get.
- "Character formatting" means `PAINTABLE_MARKS`: strong, emphasis, strikethrough, inline code, highlight,
  subscript and superscript. Links, comments and changes are content, so the painter neither copies nor removes them.
- Picking up plain text is valid; painting it clears formatting.

Painting (`paintFormat(from, to)`):
- It removes every paintable mark in the range, then adds the picked-up marks. Formatting is replaced, not merged.
- It is one undo step (`kdocStructural`).
- A painter that is not locked turns itself off.

Applying with the mouse:
- A mousedown in the editor arms a one-time `mouseup` listener on the document, so a drag released past the editor
  still paints.
- On release, after a `setTimeout(0)` so ProseMirror has settled the selection, `paintAtSelection` paints the dragged
  range. A plain click paints the word under it (`wordRangeAt`; inline atoms count as non-word characters).
- A click where there is no word paints nothing and leaves the painter on.

Other behaviour:
- Esc turns the painter off. When the painter is already off, the handler returns false, so Esc keeps its other
  meanings.
- While on, the editor gets `kdoc-format-painter-active`, which shows the copy cursor.

### Controls

- **Ctrl+Shift+C** (`format:format-painter`, remappable, editor scope) picks up for one use.
- The toolbar brush (🖌):
  - a click picks up for one use;
  - a click while the painter is on turns it off;
  - a double-click turns it on locked. A double-click arrives as click, click, dblclick.
  - It shows `aria-pressed` while on and `data-locked` while locked.
- There is deliberately no paste shortcut: `Ctrl+Shift+V` is paste-as-plain-text.

### Right panel

**Ctrl+Shift+R** (`view:toggle-right-panel`, global, remappable) collapses the right panel, or reopens it on the panel
it last showed. The panel is tracked through `onActiveChange`, and the first opening shows Comments. The keymap
service's capture-phase handler claims the key, so WebView2's reload accelerator does not fire.

### Not covered

- Paragraph formatting (heading level, lists) is not picked up; the painter is for inline marks, as the requirement
  says.
- `Ctrl+M` / `Ctrl+Shift+M` indentation outside lists is still unbound. Markdown has no paragraph indent, so the
  command would need a definition first.
- Painting re-serializes the edited paragraph in the configured style (for example `***x***` becomes `**_x_**`), like
  any edit to it.

## 6ch. Image Editing (FR-8.15)

### Width hint

A resized image keeps its width in the alt slot, `![alt|600](img.png)`, as OQ-5 decided.

`packages/core/src/images/image-hints.ts`:
- `splitImageAlt(alt)` reads a width of 1 to 5 digits after the last `|`, up to `MAX_IMAGE_WIDTH` (10000):
  - A leading zero or an out-of-range number is left as alt text, so a hint always writes back byte for byte.
  - An empty alt before the hint reads as no alt.
- `joinImageAlt(alt, width)` writes the hint back only when there is a width.
- `applyImageWidths(root)` clones the tree and moves each hint into `data.hProperties.width`. `renderFragment` runs it,
  so export and print get `<img alt="alt" width="600">` and never the raw hint.
- The outline also strips the hint from heading text.

### Editor

- The `image` node has a new `width` attribute. `from-mdast` splits the hint off the alt, so the alt field edits only
  the words. `to-mdast` joins it back, and `toDOM` sizes the picture.
- `ImageView` (`image-view.ts`) now renders a frame: `span.kdoc-image`, containing `span.kdoc-image-frame` (the `img`
  plus a resize handle) and `span.kdoc-image-caption`. `image` is exposed for tests.
  - `selectNode` / `deselectNode` toggle `kdoc-image-selected`. That draws the accent outline and shows the handle.
  - Dragging the handle (pointer events with capture) resizes the picture live. The width is clamped between
    `MIN_IMAGE_WIDTH` (16px) and the width of the block holding the image.
  - On release, if the width changed, it writes `width` with `setNodeMarkup` as one structural undo step and keeps
    the image selected. A cancelled drag puts the width back, and `stopEvent` keeps ProseMirror out of handle events.
  - The caption is the CommonMark title, shown under the picture (hidden when empty). It also stays as the tooltip.
  - `update` re-applies width and caption without reloading the picture.
- `image-commands.ts`:
  - `selectedImage`, `setImageWidth(width | null)` (refuses out-of-range values and no-op changes) and
    `resetImageSize`.
  - `selectImageAt(view, target)`, for a right-click, which does not select an image by itself.
- `insertImage` replacing a selected image keeps its width, so editing the address, alt or caption does not reset the
  size.

### Shell

- The image dialog's third field is now **Caption (optional)**. It still maps to the title.
- The context menu selects a right-clicked picture and adds an Image group: **Edit Image…** (opens the dialog on the
  image) and **Reset Image Size**.

### Not covered

- `![[img.png|600]]` embeds: K-Doc does not render wiki-link embeds yet, so their hint cannot be edited. They keep
  their text untouched.
- Resizing is pointer-only; there is no keyboard resize.
- Height always follows the aspect ratio. Alignment is FR-8.11's.
- Image references (`![alt][label]`) still show as placeholders (a chip was raised in §6ce).

## 6ci. Autocorrect (FR-7.8)

### Settings

`packages/config/src/autocorrect/autocorrect-settings.ts` is a new `autocorrect` section. Like `keyboard`, it parses and
serializes itself.

Switches:
- `smartQuotes`, `dashes`, `ellipsis` and `replaceText` default to on.
- `ordinals` and `capitalizeSentences` default to off, because they change the most of what was typed.
- `editor.smartSubstitutions`, the existing Settings row, is now the master switch.

The `replacements` table:
- The default table is a few symbols (`(c)`, `(r)`, `(tm)`) and common misspellings (`teh`, `adn`, `recieve`,
  `seperate`).
- A user table replaces the defaults whole, so a default can be removed.
- Each key must be 1–200 characters with no whitespace (a space is what triggers a replacement); each value 1–200
  characters. Bad entries are dropped with a warning.
- The table is written sorted.
- A later settings layer replaces the section whole.

The Settings dialog's Editor section has a checkbox for each switch.

### Rules

`packages/editor/src/prosemirror/autocorrect.ts` is a separate `inputRules` plugin in the shell's plugin list.
- It reads `() => AutocorrectOptions` when a rule would fire, so a settings change applies at once without rebuilding the
  editor.
- Every rule declines inside a code block or inline code (`isInCode` checks the parent's `code` spec, then the marks,
  including stored marks). It also declines when the master switch or its own switch is off.
- Each correction is one replace step and undoable with Backspace (`undoInputRule`).

In order:
1. **Replacement table:** on a space or punctuation, the longest key that ends the text and starts a word. A lowercase
   key matches any case and keeps a leading capital ("Teh" becomes "The").
2. **Ordinals:** `1st`, `22nd`, `13th` get a superscript suffix (written `1^st^`) when the suffix is right for the
   number.
3. **Sentence capitals:** a lowercase letter that starts a paragraph or follows `. `, `! ` or `? ` is capitalised,
   except after a common abbreviation (`e.g.`, `i.e.`, `etc.`, `Mr.`, …) or a single initial.
4. **Smart quotes:** opening after the start of the line, a space or an opening bracket; closing, or an apostrophe,
   otherwise.
5. **Dashes:** `word--` gives an em dash. A spaced `-` or `--` between words gives an en dash. `---` at the start of a
   line is left to the horizontal rule.
6. **Ellipsis:** `...` gives `…`.

Autocorrect applies in K-Doc only; the Source pane is plain Markdown and keeps what is typed.

### ProseMirror base styles

Verifying autocorrect showed that the K-Doc editor never loaded ProseMirror's required CSS:
- `white-space` was `normal`, so a space at the end of a line collapsed, and the next keystroke replaced a space that a
  command or rule had inserted. Runs of spaces also disappeared.
- `PROSEMIRROR_BASE_STYLES` (`editor/src/prosemirror/base-styles.ts`, from prosemirror-view's CSS minus the parts the
  theme draws) is now placed ahead of the shell's own `.ProseMirror` rules.

### Not covered

- There is no dialog for editing the replacement table yet; it is edited in the settings file.
- Quote style is English only; there is no per-language quote style.
- Ordinals are English only.

## 6cj. Autocorrect Replacements Dialog (FR-7.8)

`packages/app/src/shell/replacements-dialog.ts` edits the autocorrect replacement table (§6ci).

It can be opened three ways:
- the **Replacement table: Edit…** row in Settings → Editor;
- the palette's **Autocorrect Replacements…**;
- the settings dialog's new optional `openReplacements` option. Without that option the row is left out.

### Behaviour

- The dialog lists the table sorted, one row per entry. Each row shows the text to replace, an editable replacement,
  and Remove.
- Replacement values:
  - A changed value is committed on `change` (blur or Enter).
  - An invalid value (empty, or over 200 characters) is put back and the status line says why.
- Adding entries:
  - The Replace and With fields add an entry with Add or Enter. The key is trimmed.
  - A key with spaces or an empty replacement is refused with a warning.
  - An existing key is overwritten, and the status says "Changed".
- **Restore Defaults** puts back `DEFAULT_AUTOCORRECT_REPLACEMENTS`.
- Every valid edit calls `onChange(next table)`, then redraws from the live `replacements()` getter, so the dialog
  never shows a table the app did not store.
- The shell's `onChange` replaces `settings.autocorrect.replacements`, hands the new settings to the settings dialog
  (so its next change cannot write the old table back), re-applies settings and saves them, as the keyboard shortcuts
  dialog does. The autocorrect plugin reads the table as it fires, so an edit applies to the next word typed.

## 6ck. Snippets (FR-7.10)

In K-Doc, a snippet's prefix followed by Tab expands into its body. Tab and Shift+Tab then move between the body's
tab stops.

### Body syntax

`packages/core/src/snippets/snippet-body.ts` provides `parseSnippetBody(body, now)`, which returns
`{ text, stops }`.
- **Tab stops:** `$1`, `${1}` or `${1:default}`. A number used again inserts its default again but is not a second
  stop.
- **Final cursor:** `$0` or `${0:text}`. Without one, the cursor ends after the whole body.
- **Variables:** `$DATE` / `${DATE}` and `$TIME` / `${TIME}` insert the local `YYYY-MM-DD` and `HH:MM`.
- **Literals:** `\$` is a literal dollar, and a `$` that starts nothing recognised is kept as written.
- Stops are returned in number order, with the final cursor last.

### Settings

`packages/config/src/snippets/snippet-settings.ts` defines the `snippets` section: `{ enabled, items }`.
- `items` maps prefixes to bodies. A prefix is 1–40 characters with no whitespace; a body is 1–5000 characters. Bad
  entries are dropped with a warning.
- The defaults are `code`, `img`, `link`, `note` (a GitHub alert), `table`, `task` and `today`. A user table replaces
  them whole.
- A later settings layer replaces the section whole.
- Settings → Editor has a **Snippets (prefix + Tab)** checkbox.

### Expansion

`packages/editor/src/prosemirror/snippets.ts`:
- **Prefix:** `snippetPrefixAt` requires a caret (not a selection), outside code, where the text before ends with a
  prefix that starts a word. The longest prefix wins.
- **Body to content:**
  - Each stop's start and end are marked with private-use characters (`markStops`, U+E000 to U+E1FF, two per stop).
  - The marked body is parsed as Markdown. Markers outside visible text (a link destination, an image source, a fence
    language) are stripped from the mdast, so those stops are skipped.
  - The result is converted to ProseMirror. A one-line body that parses to one paragraph is inserted inline; anything
    else is inserted as blocks.
- **Stop positions:** the markers are then found in the document and deleted from the end. Each stop's position is its
  marker's position less the markers before it. The expansion is one structural transaction.
- **Session:** the plugin state `{ stops, index }` follows edits.
  - A stop with text grows with typing at its edges; an empty stop moves after typed text.
  - The session ends when the caret leaves the snippet, on Escape, or on reaching the final stop.
  - Stops still ahead are highlighted (`kdoc-snippet-stop`).
- **Keeping marks:** `appendTransaction` puts back marks that an edit dropped from the current stop. ProseMirror does
  not extend a link to text typed over it, so without this, typing over a link snippet's text would unlink it.
- **Tab handling:** a capture-phase keydown listener on the editor element runs before ProseMirror's list and table Tab
  bindings, so a prefix expands even inside a list item. It calls `stopImmediatePropagation` only when it moved a stop
  or expanded; otherwise Tab behaves as before.

### Not covered

- Snippets are edited in the Snippets dialog (§6cl) or the settings file.
- Source pane expansion is not supported.
- No mirrored stops: a repeated number is only text.
- Only the DATE and TIME variables exist.

## 6cl. Snippets Dialog (FR-7.10)

`packages/app/src/shell/snippets-dialog.ts` edits the `snippets.items` table from §6ck without opening the settings
file. `installSnippetsDialog({ doc, snippets, defaults, onChange })` returns `{ open, close, isOpen, destroy }`.

- **Opening:** from Settings → Editor (**Snippet list: Edit…**, the `openSnippets` option) and from the palette
  (`view:snippets`, "Snippets…").
  - The settings dialog's opener row is now shared: `createOpenerRow(idSuffix, label, opener)` builds both this row
    and the replacement table row.
- **Rows:** one per prefix, sorted, each with a multi-line body field and **Remove**.
  - A body is committed on `change`, as the field loses focus. The row is not redrawn, because a redraw during a Tab
    would drop the focus the Tab was moving.
  - An invalid (empty) body is put back to the last committed value, with the rule shown in the status line.
- **Adding:** a prefix field and a body field.
  - Enter in the prefix moves to the body, because a body can span lines.
  - The prefix is trimmed and validated with `isValidSnippetPrefix`, and the body with `isValidSnippetBody`.
  - An existing prefix is overwritten, and the status says "Changed" rather than "Added".
- **Restore Defaults** publishes `DEFAULT_SNIPPETS`.
- **Publishing:** the shell stores the table in its settings, pushes it into the settings dialog with `setSettings` (so
  that dialog's next change does not write the old table back), applies it and saves. Add, remove and restore redraw
  from the live getter, so the dialog shows what the app accepted.

### Not covered

- Snippets expand only in K-Doc; the Source pane has no expansion.

## 6cm. Split and Merge Documents (FR-8.31)

Two Edit commands work on source text, so every byte outside the edit is kept.

### Core

`packages/core/src/outline/split-merge.ts`:
- **`sectionIndexAtOffset(entries, offset)`** returns the outline index of the last top-level heading starting at or
  before the offset, or -1.
- **`splitSection(text, entries, index)`** returns `{ remaining, section, title }`, or null for an index with no
  section.
  - The range comes from `outlineSectionRange` (FR-9.1), so the section includes its deeper subsections.
  - `section` ends in one newline.
  - When the section ran to the end, the blank lines left behind are trimmed to one newline. A document that was only
    the section keeps `\n`.
- **`mergeDocumentText(target, source)`** appends the source's body after exactly one blank line.
  - `withoutFrontMatter` drops the source's leading yaml/toml node, using its end offset, because a document has only
    one front matter block.
  - CRLF becomes LF.
  - A source with no body returns the target unchanged, and an empty target becomes the body.

### Editor

`packages/editor/src/prosemirror/section-at-caret.ts` provides `sectionIndexAtCaret(state)`. The outline lists only
top-level headings, so the K-Doc caret's section is the count of top-level heading nodes up to the caret's block,
minus one. The block index is clamped for a position after the last block.

### Shell

- **Split Document at Heading** (`edit:split-at-heading`):
  - The caret comes from the focused pane: a Source offset, or `sectionIndexAtCaret`.
  - The section is removed with `applyExternalText` and opened as an untitled tab in the background. That tab's saved
    text is `\n`, so it is unsaved and closing it asks first.
  - The current document stays on screen because undo history does not survive a tab switch; staying makes the split
    undoable.
  - `TabSet.open` activates the new tab, so the shell activates the current tab again.
- **Merge Document…** (`edit:merge-document`):
  - Opens the file dialog, parses the pick and applies `mergeDocumentText` as one external edit.
  - Reports a dismissed pick as nothing, a file with no body as "has nothing to merge", and no file access in the
    browser build.

### Not covered

- Heading levels are not shifted: a split `## Section` starts its new document at level 2.
- The split-off document gets no file name and no link back.
- Merge takes a file from disk, not another open tab. The merged file is left as it was.

## 6cn. Local Snapshots (FR-11.8)

Whole-document copies are kept on disk. A snapshot is taken after every save, when **File → Take Snapshot** is run, and
on a timer. Snapshots are retained under a policy.

### Storage (host)

`src-tauri/src/snapshots.rs`:
- **Folder:** `<store>/local/snapshots/<key>/`. The store is the vault's `.k-doc` or the global store, found with
  `store::resolve_store_location` exactly as for comments. In a vault, `local/` is git-ignored (FR-6.20).
- **Key:** the document's `kdoc_id` when it has one, so history survives a rename. Otherwise it is `p` + the 64-bit
  FNV-1a hash of the path, lower-cased with forward slashes.
  - Snapshots never add a `kdoc_id` (FR-6.17 adds one only for annotations).
  - A file without one starts a new history when moved.
  - A document that later gains a `kdoc_id` (its first comment) also starts a new folder.
  - FNV-1a is used because std's hasher is not stable across Rust releases.
- **Files:** `<at>-<reason>.md`, where `at` is epoch milliseconds zero-padded to 13 digits and the reason is `save`,
  `manual`, `timer` or `restore`. `parse_snapshot_id` accepts only that shape, which keeps read and delete inside the
  folder.
- **Commands:**
  - `snapshot_write` skips text identical to the newest snapshot (returns `null`), bumps a same-millisecond stamp, and
    writes through a `.tmp` file plus rename.
  - `snapshot_list` returns entries oldest first.
  - `snapshot_read` reads one snapshot.
  - `snapshot_delete` validates every id before deleting any.

### Retention (core)

`packages/core/src/history/snapshot-retention.ts` exports `snapshotsToPrune(entries, now, policy)`. It walks the
snapshots newest first:
- **Kept outright:** the newest snapshot, every `manual` snapshot, and everything younger than `keepAllHours`. A kept
  snapshot still claims its bucket.
- **Bucketed:** up to `keepHourlyDays`, the newest snapshot of each UTC hour is kept; up to `keepDailyDays`, the newest
  of each UTC day.
- **Pruned:** the rest.
- Window edges count as inside.

### Settings

`packages/config/src/history/history-settings.ts` defines the `history` section:

| Field | Default | Range |
| --- | --- | --- |
| `snapshotOnSave` | `true` | boolean |
| `snapshotMinutes` | `10` | 0–1440; 0 is off |
| `keepAllHours` | `24` | 0–8760 |
| `keepHourlyDays` | `7` | 0–3650 |
| `keepDailyDays` | `90` | 0–36500 |

Settings → Editor has **Snapshot on save** and **Snapshot every (minutes, 0 = off)**. The retention fields are edited in
the settings file.

### App

- **Store:** `packages/app/src/files/snapshot-store.ts` exports `createSnapshotStore({ available, policy, now, invoke? })`.
  - `take(path, text, reason)` writes, then lists and deletes what `snapshotsToPrune` returns. It prunes only after a
    new snapshot was written.
  - `list` and `read` pass `kdocId: readKdocId(text)`.
  - Without a desktop host every method does nothing.
- **Shell:**
  - `onSaved` takes a `save` snapshot of the written text.
  - `restartSnapshotTimer()` runs from `applySettings`. It keeps a timer already at the set interval and is cleared in
    `destroy`. The timer snapshots the session text, including unsaved edits.
  - Documents without a file are skipped; only the command explains why.
  - Only the command reports success, as "Snapshot taken." or "No changes since the last snapshot.".

### Not covered

- There is no browser for snapshots yet (FR-11.9), and no restore from one (FR-11.10).
- The retention fields have no controls in the Settings dialog.

## 6co. Version History (FR-11.9, FR-11.10)

The **Version History** dialog browses a saved document's local snapshots (§6cn). It shows each one as a word-level diff
against the current text, restores one as a new revision, and copies a passage out of it.

### Word diff (core)

`packages/core/src/history/word-diff.ts`:
- **`tokenizeWords(text)`** splits text into tokens: runs of whitespace, words (letters, digits, `_` and apostrophes),
  and single other characters, so Markdown punctuation such as `**` changes on its own. The tokens join back to the
  text exactly.
- **`diffWords(before, after)`** runs `diffLines` (the Myers diff used for merging) over the token arrays. It merges
  neighbouring tokens of one kind into `{ kind: 'equal' | 'insert' | 'delete', text }` runs.
- **`countChangedWords(parts)`** counts letter or digit tokens in the inserted and deleted runs, for the summary line.
- **Bug fixed:** `diffLines` threw for two empty inputs because its diagonal buffer was one slot short at `max = 0`.
  Line splitting always gives at least one line, so merging had never hit it.

### Dialog (app)

`packages/app/src/shell/version-history-dialog.ts` provides
`installVersionHistoryDialog({ doc, list, read, current, now, restore, copy })`:
- **List:** snapshots newest first, each with its relative time and a reason label (Saved, Snapshot, Automatic, Before
  restore). The full date is the row's tooltip. Opening re-reads the list and selects the newest.
- **Views:**
  - **Changes** shows `diffWords(old, current)`: `<ins>` marks text added since the snapshot and `<del>` text removed
    since. The summary counts words added and removed, or says the version is the same as the document.
  - **Old Version** shows the snapshot text as it was.
  - Each version's text is read once per opening. A read that a later selection or a close overtook does not draw.
- **Copy Selection:** copies a selection inside the version pane, with any `<ins>` text dropped (it did not exist in the
  old version). With no selection there, it copies the whole version. The button cancels `mousedown`, because a press
  would otherwise collapse the selection before the click.
- **Restore This Version:** calls `restore` and closes.

### Shell

- **Opening:** from `view:version-history` ("Version History…") and a **Version History…** button at the top of the
  History panel (`browseVersions` option). An untitled document or the browser build gets a message instead.
- **`restoreSnapshot(text, snapshot)`:** identical text is reported and nothing changes. Otherwise the current text is
  first kept as a `restore` snapshot, then the version is applied with `applyExternalText`. That is one undoable edit,
  and the message says undo puts the current text back.

### Not covered

- The diff is inline only; there is no side-by-side view.
- Copying works on text in the dialog, not on rendered Markdown.

## 6cp. Compare Documents (FR-11.7)

A comparison opens a new unsaved tab holding the newer text, with every difference from the older text as a pending
tracked change (§ FR-11.1–11.6). The Review pane then accepts or rejects them like recorded edits.

### Core

- **`compareAsChanges(older, newer, author, newId, now)`** (`packages/core/src/changes/compare.ts`) walks
  `diffWords(older, newer)`, keeping an offset in the newer text:
  - equal runs advance the offset;
  - deleted runs become `createDeletion` seams, which don't move it;
  - inserted runs become `createInsertion` spans, which advance it.
  - All changes are anchored in the newer text and share one timestamp. Rejecting all of them gives back the older text.
- **Rejecting many changes** (`applyDecisions`, used by Reject all and the Original view) now undoes them newest first,
  with a stable sort by `createdAt`, and re-resolves each against the running text.
  - Each change is anchored in the text as it stood right after it was made, so undoing the newer ones first rebuilds the
    text every older one was anchored in.
  - The previous order, by position, restored two quick deletions backwards: backspacing `c` then `b` gave `abdc`.
- **Partial-context rung** (`resolveChangeAnchor`, between the context and text rungs): used when a neighbour's decision
  rewrote part of a change's context.
  - It keeps the full suffix with progressively shorter tails of the prefix, then the full prefix with shorter heads of
    the suffix. It needs at least `PARTIAL_CONTEXT_MIN` (8) characters of context and reports the `'text'` rung.
  - Without it, a change beside one just rejected fell to its recorded offset, and once `kdoc_id` front matter had been
    added above, text was restored in the wrong place.

### App

- **`ChangesController`:**
  - `replace(changes)` sets and stores the whole list.
  - The controller re-plans in a microtask after a session change whose reason is `external`, `undo`, `redo` or `reset`.
    Those rebuild the editors' state and drop painted marks; before this, compared changes lost their marks when the
    store added the document's `kdoc_id`.
- **Shell:**
  - **Edit → Compare Documents…** (`edit:compare-documents`) asks for the original file, then the revised one, and calls
    `openComparison(older, newer, author, label)`. The author is the revised file's name.
  - `openComparison` opens the tab with `newDocument(newer)`, which now takes text and starts unsaved. It waits for that
    tab's own change load (`changesLoaded`) so the replacement is not overwritten, then shows the Review panel.
  - Identical texts report that nothing differs.
  - Changes get ULIDs a millisecond apart, so the Review pane lists them in document order.
- **Version History** has **Open as Tracked Changes**, which compares the selected snapshot with the current document
  the same way (two versions).

### Not covered

- The comparison tab has no file name. Saving it asks for one, and its changes are kept in the global store until then.
- Moved text shows as a deletion plus an insertion.

## 6cq. Git Awareness (FR-11.11)

When a saved document sits in a git working tree, Version History lists the commits that touched it alongside its local
snapshots. The palette can also stage the file or commit just that file.

### Host

`src-tauri/src/git.rs` runs the system `git` with `-C <document folder>`:
- **Safety:** arguments go straight to the process, never through a shell. Commit hashes must be 7–40 lowercase hex
  digits. On Windows the process is created with `CREATE_NO_WINDOW`.
- **Untrusted repositories:** every call passes `-c core.fsmonitor=false`, so reading the status or history of a
  downloaded repository never runs a command its `.git/config` names, and `GIT_TERMINAL_PROMPT=0` stops git waiting
  for input nobody can give. Committing deliberately keeps the repository's hooks: it is an explicit action and behaves
  like `git commit`. Other repository configuration (e.g. clean filters) is honoured exactly as the git CLI honours it.
- **Commands:**
  - `git_file_info` returns `{ root, branch, tracked, staged, modified }`, or `null` when git is missing or the folder is
    outside a repository. The branch is empty before the first commit. The flags come from `status --porcelain=v1` for
    the file.
  - `git_file_log(limit)` runs `log --follow` with unit-separated fields and returns `{ hash, shortHash, author, at (ms),
    subject }`. A repository without commits returns none.
  - `git_file_at(hash)` runs `show <hash>:./<name>`.
  - `git_stage_file` runs `add -- <name>`.
  - `git_commit_file(message)` stages the file, then runs `commit -m <message> -- <name>`, so only this file is
    committed whatever else is staged. It returns the new short hash.
- No new dependency: this uses `std::process::Command`. Tests build a throwaway repository with a local identity.

### App

- **Git service:** `packages/app/src/files/git-service.ts` provides `createGitService({ available, invoke? })`. Without a
  desktop host, reads return empty and writes fail fast.
- **Version History:**
  - The dialog's rows are now `VersionEntry { id, at, reason, detail? }`, where `reason` includes `'commit'` (labelled
    "Git commit") and `detail` holds a commit's short hash and subject.
  - `listVersions()` merges snapshots with up to 100 commits, oldest first. Commits are reversed first, because git keeps
    whole seconds and commits made in the same second would otherwise swap order. A git failure is reported and the
    snapshots are still listed.
  - `readVersion(id)` reads `git:<hash>` ids from git, with CRLF normalised to the editor's LF, and other ids from the
    snapshot store.
  - Restore, Copy Selection and Open as Tracked Changes work on commits as they do on snapshots.
- **Palette:** **Git: Stage File** (`file:git-stage`) and **Git: Commit File…** (`file:git-commit`, which prompts for a
  message).
  - Both refuse an untitled or unsaved document, so git gets what is on screen, and one outside a repository.
  - The message names the file, the branch and the new commit.

### Not covered

- There is no push, pull, branch switching or diff against the index.
- A file renamed since a commit cannot be read at that commit under its new name; git's message is shown.
- The dialog lists at most 100 commits.

## 6cr. Focus and Typewriter Modes (FR-5.8)

Palette commands toggle two writing modes for the session, across every tab:
- **Focus Mode: Paragraph** and **Focus Mode: Sentence** dim everything but the paragraph, or sentence, holding the
  caret. Running the same command again turns it off.
- **Typewriter Mode** keeps the caret's line at the vertical middle while typing.

They are not saved.

### Core

`packages/core/src/focus/focus-range.ts`:
- **`paragraphRange(text, offset)`** returns the run of non-blank lines around the offset. On a blank line it returns
  just that line.
- **`sentenceRange(text, paragraph, offset)`** scans sentence ends (`. ! ? …` with trailing closing quotes or brackets,
  then whitespace) inside the paragraph. The sentence starts after the last end at or before the caret (so a caret right
  after a full stop is in the next sentence) and ends after the next one; leading spaces are trimmed.
- **`focusRange(text, offset, scope)`** combines the two.
- Both panes use these, so they dim alike.

### Editor

- **K-Doc** (`packages/editor/src/prosemirror/writing-modes.ts`, `createWritingModesPlugin(() => modes)`):
  - Decorations read the modes through the getter. Every textblock and leaf block except the caret's gets a node
    decoration with `kdoc-focus-dim` (opacity 0.3).
  - Containers are never decorated, so a list around a focused item keeps its bullets and opacity doesn't compound.
  - In sentence scope, the rest of the active block is dimmed inline. The block is read with one character per inline
    leaf, so offsets are positions.
  - A selected node leaves no textblock to focus, so everything dims.
  - After a text or caret change in a focused editor, Typewriter mode centres the caret in its scroll container.
  - `refreshWritingModesIn(view)` (`setProps({})`) redraws after a toggle.
- **Source** (`codemirror/writing-modes.ts`, `writingModes(() => modes)`):
  - A view plugin marks the Markdown before and after `focusRange` with the same class. It rebuilds on text changes,
    caret changes, or `refreshWritingModesEffect`.
  - Typewriter centring runs in a measure pass. Each pane dims around its own caret.
- **Scroll helper** (`writing-scroll.ts`):
  - `scrollContainerOf(element)` returns the element itself or its nearest ancestor with `overflow-y: auto|scroll` and
    content taller than itself.
  - `centreInContainer` moves by the difference between the caret's middle and the container's middle. Sub-pixel
    differences are ignored.
  - `.kdoc-typewriter` on the body adds half a screen of padding below both editors, so the last lines can reach the
    middle.

### Shell

`writingModes` is a shell field. `toggleFocusMode(scope)` and `toggleTypewriterMode()` store the modes, set the body
class, refresh both panes and report. The commands are `view:focus-paragraph`, `view:focus-sentence` and
`view:typewriter`.

### Not covered

- There are no keyboard shortcuts or ribbon buttons.
- The first lines of a document cannot be centred, because there is no top padding.

## 6cs. Zen Mode (FR-5.8)

**View → Zen Mode** in the palette hides the application chrome, leaving only the editor panes, and makes the window full
screen. Escape, or the command again, leaves.

- **Controller** (`packages/app/src/shell/zen-mode.ts`, `installZenMode({ doc, setFullscreen, onError, hintMs? })`):
  - Toggling adds or removes `kdoc-zen` on the body. `ZEN_MODE_STYLES` hides the toolbar, tab bar, ribbon, format and table
    toolbars, breadcrumbs, both sidebars, status bar and key hint. The find bar and the panes stay.
  - A hint ("Zen mode. Press Esc to leave.") floats at the top for 2.5 s, because the status bar that normally carries
    messages is hidden.
  - Entering and leaving are idempotent. A window that refuses full screen is reported, but the chrome stays hidden.
  - `destroy()` leaves Zen, so a torn-down shell does not stay full screen.
- **Escape:** a capture-phase `keydown` listener on the document takes Escape before the editors, since K-Doc binds
  Escape to "select parent node" and would otherwise keep it. Escape is left alone when a dialog is open, when a find bar
  is visible, or when something already marked it handled.
- **Full screen:** the new host command `set_window_fullscreen(fullscreen)` (`src-tauri/src/windows.rs`) changes only the
  calling window, so the webview gets no general window permission (capabilities unchanged). The browser build skips this
  step.
- **Command:** `view:zen` ("Zen Mode").

### Not covered

- There is no default keyboard shortcut (such as F11).
- Zen mode does not change the view mode, so Split still shows both panes.

## 6ct. Presentation Mode (FR-5.9)

**View → Start Presentation** shows the document as slides over the whole window, full screen. Arrow, page and space keys
move, Home and End jump to the ends, clicking advances, and Escape leaves.

### Slides

`packages/core/src/render/slides.ts` exports `splitSlides(document)`, which groups the top-level nodes between thematic
breaks into one mdast root per slide.
- Only top-level `---` (or `***`) rules split: a rule inside a quote or list stays on its slide.
- Front matter is not shown, and empty slides (two rules in a row, or one at either end) are dropped.
- A document without rules is one slide.
- The shell renders each slide with `renderFragment`, the same renderer export uses.

### Overlay

`packages/app/src/shell/presentation-mode.ts` provides
`installPresentation({ doc, setFullscreen, resolveImage, onError })`:
- The overlay covers the window (`role="dialog"`, `aria-modal`), holding the slide and a counter, and takes focus. Focus
  returns where it was on leaving.
- **Keys** are handled in the capture phase, so they never reach the editor underneath: next (Right, Down, Page Down,
  Space, Enter), previous (Left, Up, Page Up, Backspace), Home, End and Escape. Moving past either end stays put.
  Modified keys (Ctrl, Cmd, Alt) and other keys are left alone.
- **Clicking** the slide advances, except on a link.
- **Images:** every `img` is resolved through the shell's `loadImageSource`, the same path K-Doc uses for local images.
  Each render carries a token, so an image resolved for a slide already left is not written into the next one. An image
  that cannot be resolved keeps its written address.
- **Full screen** uses the `set_window_fullscreen` command added for Zen mode. A refusal is reported and the slides still
  show.
- An empty document is reported instead of showing a blank screen.
- The command is `view:presentation`.

### Not covered

- There are no speaker notes, presenter view, slide transitions or a progress bar.
- Slides cannot be exported; the deck is the document itself.
- The presentation always starts at the first slide, not the one holding the caret.

## 6cu. Reading Width and Display Density (FR-5.10, FR-14.13)

How wide the text column is and how much space sits between blocks are appearance settings, and a document may keep
its own answer to either, remembered against its path.

### The density setting

`appearance.density` (`compact` | `comfortable` | `spacious`, default `comfortable`) joins `appearance.readingWidth` in
the schema, with the same nine touchpoints every settings field has and a **Display density** row in Settings →
Appearance.

`packages/app/src/shell/typography.ts` maps it to the space below each block:

| Density | Spacing |
| --- | --- |
| `compact` | 0.5em |
| `comfortable` | 1em |
| `spacious` | 1.6em |

- `blockSpacingEm(density)` has no default branch, so a density added to the union later is a compile error rather than
  a silent fallthrough.
- `applyTypography` sets `--kdoc-block-spacing`, and `TYPOGRAPHY_STYLES` applies it to the top-level blocks of the
  K-Doc pane. The spacing is in em, so it follows the font size and the zoom. `comfortable` is 1em, the spacing the
  editor already had, so the default changes nothing.
- Only the pane's own children are spaced: a paragraph inside a list item keeps the list's rhythm. The Source pane is
  left alone, as it already is for the reading width.

### Per-document overrides

`packages/app/src/shell/display-overrides.ts` keeps `{ readingWidth?, density? }` per document under the local storage
key `kdoc.display.v1`, the way `fold-state.ts` keeps folds:
- The key is the path with its separators and case normalised, so one document written two ways is one entry.
- A field left out means "use the setting"; `effectiveAppearance` layers the override over `settings.appearance`
  field by field, and the shell passes the result to `applyTypography`.
- At most 500 documents are remembered; past that the ones written longest ago are dropped. An override with nothing
  in it removes the entry rather than storing an empty one.
- Storage that throws or holds something that is not a map of overrides is read as "no override" rather than an error,
  so a private window or a hand-edited entry costs a preference and nothing else.

The shell reads the override in `mountDocument`, where a first open and a tab switch both arrive, so the width and
density follow the document from tab to tab.

### Commands

Three View commands, all acting on the active document:
- `view:document-width` — **Reading Width for This Document** steps narrow → medium → wide → full and wraps.
- `view:document-density` — **Display Density for This Document** steps compact → comfortable → spacious and wraps.
- `view:document-display-reset` — **Use the Settings Width and Density** drops the override.

Each step starts from what the reader sees now, which is the document's own value when it has one and the setting when
it does not. An unsaved document has no path to remember a choice against, so the commands report that and change
nothing rather than applying something that would be lost.

### Not covered

- The commands cycle rather than offering a list to pick from, and they have no default shortcut.
- Saving a document under a new name does not carry its override across; the new path simply has none.
- Density is not applied to the Source pane, or to print and export.
- There is no per-document override for any other appearance setting.

## 6cv. Read-Only Files Open Locked (FR-6.7)

A file that is read-only on disk opens as a locked document: neither pane accepts typing, saving is refused,
and the status bar shows **Locked**. Clicking it, or the **Unlock Document** command, offers to clear the
attribute on disk.

### Reading the attribute

`src-tauri/src/permissions.rs` exports `is_read_only(path)` and `set_read_only(path, read_only)`, plus the
`set_file_read_only` command.
- `read_text_file` now reports `readOnly` alongside the contents and the encoding. It is read at the moment
  of the read rather than asked for afterwards, because a file checked later may already be a different file.
- A path whose metadata cannot be inspected is reported writable: the caller has already read the file, so a
  failure there must not stop it opening.
- `set_read_only` changes only that flag, leaving the rest of the file's permissions as they were, and names
  both the path and the reason when it fails.

`file-service.ts` carries it as `OpenedFile.readOnly` and offers `setReadOnly(path, readOnly)`, optional as
`lineEndingOf` is: a host that cannot change attributes does not offer it, and the shell says so rather than
pretending the lock was cleared. Both `openFile` and `readFile` now map the host's payload through one
`toOpenedFile`, so the two cannot drift apart again.

### The locked document

`DocumentState.locked` rides with the tab, so a locked document stays locked across a switch. The shell reads
it in `mountDocument` and applies it in `applyLock`, which is the last thing the mount does:
- `ProseMirrorBinding.setEditable` and `CodeMirrorBinding.setEditable` each
  reconfigures a compartment rather than rebuilding the view, so locking keeps the text, the scroll position
  and the caret. A locked pane still takes text from the session, or a tab switch would leave the previous
  file on screen.
- `allowSave` refuses a save and says why. Autosave goes through it too, so a locked document does not report
  the same failure on every tick.

### Unlocking

`view`-side, the **Locked** button and the `file:unlock` command both run `unlockDocument`, which asks before
changing anyone's file. Only if the host really cleared the attribute is the document unlocked, so the editor
is never unlocked over a file that still cannot take a save; a refusal is reported and the document stays
locked.

### Not covered

- Formatting commands from the ribbon and the palette still apply to a locked document. They cannot be saved,
  but they are not refused at the point of use.
- There is no way to lock a writable file from inside K-Doc, and no per-document "view only" independent of
  the file's attribute.
- A file made read-only while it is already open is not noticed until it is opened again.
- On Unix the attribute follows the owner's write bit, which is what `std::fs::Permissions::readonly` reports;
  ACLs beyond that are not considered.

## 6cw. A Second Pane on the Same Document (FR-6.9)

**View → Second Pane on This Document** opens a second editable view of the open document beside the first,
with its own scroll position, independent of the K-Doc/Source split.

### Which view made the edit

The obstacle was not the pane but the edit lock. `focusedPane` is `'kdoc' | 'source'`, and a binding
decided whether a change was its own by comparing against it. With two K-Doc views both are the
`'kdoc'` pane, so each reads the other's edit as its own and neither updates: the second view goes stale
on the first keystroke.

`SessionChange` and `ApplyOptions` now carry an optional `originId`:
- Each binding gives itself one (`pm-1`, `cm-2`, from a module counter — two views of one document in one
  window is the whole population, the ids never leave the process, and a counter is reproducible in a test
  where a random id is not) and passes it on every `applyTree` or `applyText`.
- A binding syncs from the session when `change.originId !== this.originId`, which is true however many
  views there are.
- A change no view applied — an external reload, an undo, a reset — carries no identity, so every view takes
  it, as before.
- `focusedPane` still decides *which kind* of edit is allowed (`applyTree` needs K-Doc focus, `applyText`
  needs Source focus); identity decides only who already has the edit.

### The pane

The second pane sits between the K-Doc pane and the Source pane, with its own `installSplitDivider`
between it and the first. It is deliberately plainer than the main pane: a `ProseMirrorBinding` over the same
session with images and the host keymap, and nothing else. It is built when the pane opens, destroyed with
the document, and rebuilt over the next one when a tab switch arrives with the pane still open. It takes the
document's lock (FR-6.7) along with the other panes, and it is left out of the K-Doc/Source scroll sync,
which is what gives it its own scroll position.

### Not covered

- **Two different documents side by side** is not offered. The second pane is another view of the open
  document; a second document would need its own session, file menu and per-document controllers, which is
  the rest of the shell.
- The toolbars, find, comments, spelling, outline, track changes and the slash and context menus stay
  attached to the pane they were mounted over. Typing works in the second pane; those features act on the
  first.
- There is no way to split more than once, to split vertically, or to remember the split across a restart.

## 6cx. Session Restore (FR-6.10)

With **Restore session on launch** on — it is on by default, in Settings → General — K-Doc reopens the files
that were open, brings the same one to the front, and puts the view mode, the split, the sidebars and the
scroll positions back where they were.

### What is stored

`packages/app/src/shell/session-state.ts` keeps one `PersistedSession` under the local storage key
`kdoc.session.v1`: the open files' paths, which was in front, the view mode, the split ratio, both sidebars
(collapsed, or the panel they were showing) and the two scroll offsets.

- **Only saved files.** Unsaved text belongs to the crash journal (FR-6.5); writing it in both places would
  mean two answers to restore and no way to tell which is newer.
- **Read strictly.** A stored session is taken only if every field is the shape it should be — the version
  this build writes, a path list with nothing odd in it, a view mode it knows, finite measurements, two
  well-formed sidebars. Anything else reads as "no session", because a partly-valid session restoring half
  the window is worse than starting clean.
- At most 30 files are listed, on the way in and on the way out, so a runaway session cannot make a launch
  unusable and cannot write an entry it would then refuse to read.
- The arrangement is written 400ms after it changes, so a divider drag or a scroll writes once when it
  settles.

### Restoring

`restoreThenRecover` runs where `loadSettings` used to, after the settings store exists:
1. The settings are loaded, because they say whether to restore at all. With the setting off, any stored
   session is deleted, so turning it off really does forget.
2. A window opened to show a particular document — a detached tab — is left alone; it was asked for that
   document, not for the last session.
3. Each file is read; the ones that no longer open are counted and reported together, because a moved folder
   would otherwise produce a message per file. The document the launch started with is closed once at least
   one file has opened, and kept if none did.
4. The layout is applied last, with the scroll positions a frame later: a pane that has only just been given
   its document has no height yet and would clamp the offset to zero.
5. **Then** the crash journal is offered. Recovered text is applied to whichever document is in front, so the
   file it belongs to has to be open first, or the work lands on the welcome document.

Nothing is written until the launch has finished reading the stored session. Without that, construction's own
`setViewMode` schedules a write that lands while the restore is still waiting on the settings file, and the
empty launch window overwrites the arrangement a moment before the restore reads it — every launch after the
first then restores nothing.

### Not covered

- Scroll positions are stored for the document in front only, not for each tab.
- The window's own size and position are the host's to remember; only the arrangement inside it is restored.
- Untitled documents are not reopened; their text is the crash journal's to offer.
- The second pane (FR-6.9) is not remembered, and neither is the zoom level.

## 6cy. Comments in an Export (FR-10.7)

Comments stay out of an exported or printed document unless asked for. **Settings → Export → Comments in
exports** offers **Leave out** (the default), **As endnotes** and **In the margin**.

### Why the default needed no work, and the option did

Comments never lived in the Markdown: they are kept beside it in `.k-doc/comments/<kdoc_id>.jsonl`, and in the
editor they are view decorations over a tree that knows nothing about them. So nothing about them has ever
reached an export. What was missing was the other half of the requirement — a way to include them.

### The arrangement

`packages/core/src/render/comment-notes.ts` exports `withCommentNotes(root, { mode, threads, text })`, which
returns a **copy** of the tree carrying the comments. The document on disk gains nothing, and the copy is
what the renderer is given.

- Each thread's anchor is resolved against the document text with the same `resolveAnchor` the editor uses,
  giving a source offset. The mdast text node holding that offset is split in two and the note goes between
  the halves, so it lands at the word it is about rather than at the head of the block.
- **Endnotes** insert a `footnoteReference` and append a `footnoteDefinition`. The renderer already compiles
  GFM footnotes, so the numbering, the ordering, the endnote section and the back-links come for free.
- **Margin notes** insert a `<span class="kdoc-margin-note">`, which the export stylesheet makes a floated
  block in the space beside the text column, and collapses back into the column below 70rem. A `<span>`
  rather than an `<aside>`: an `aside` is block-level, so the HTML parser closes the paragraph to make room
  and the note splits the sentence it was meant to sit beside.
- Every reply is written out, each attributed, because a reply that disagrees with the first comment is the
  part a reader must not lose. The bodies are escaped, so a comment mentioning `<script>` does not become one.
- A **resolved** thread is left out: it is a finished conversation, not something to publish.
- A thread whose anchor no longer resolves is written at the end as ordinary text quoting what it was about.
  A footnote definition with nothing referring to it renders as nothing at all, so the fallback is not a
  footnote.

### Where it is applied

`HtmlRenderOptions.comments` carries it, so both paths get it from one place: `exportDocumentHtml` for
**Export as HTML** and `printableHtml` for **Print**. The shell's `commentExportOptions()` reads the setting
and the loaded threads, and returns nothing at all when comments are excluded or there are none.

### Not covered

- The choice is a setting rather than a question asked at export time, so exporting one document with
  comments and the next without means visiting Settings in between.
- Only the two arrangements the requirement names are offered; there is no "as an appendix" or per-thread
  choice, and resolved threads cannot be included.
- The margin note's float was checked in the exported markup, not in a rendered page.
- The export stylesheet always carries the margin-note rules, whether or not the document has any.

## 6cz. Sending a Document With Its Comments (FR-6.22)

Comments normally live beside the file, in `.k-doc/comments/<kdoc_id>.jsonl`. That is right for a folder shared
between people and wrong for sending someone a single file. **Bundle Annotations into File** writes the
comments into the document itself as HTML comments, and a document that arrives carrying them offers to take
them back out.

### The format

`packages/core/src/comments/portable.ts` writes one HTML comment per thread inside a marked block appended to
the document:

```
<!-- kdoc:comments -->
<!-- kdoc:comment {"id":"01M2…","anchor":{…},"comments":[…],"resolved":false,…} -->
<!-- /kdoc:comments -->
```

- Every line the bundle adds is an HTML comment, which every Markdown renderer drops, so a bundled file still
  reads as the document it was.
- One thread per line, so a file that gains a comment gains one line in the diff.
- The block is marked at both ends, so bundling again replaces the previous block rather than writing a
  second, and extracting knows exactly what to take away. An end marker with no start, or one written before
  the start, is not a bundle: guessing where an unterminated block ends risks deleting the document.
- `extractComments` checks every field a thread needs before trusting it — the file may have been edited by
  hand — and a line it cannot read is skipped and reported rather than costing the reader the rest.

### The two directions

- **Bundle Annotations into File** (`comments:bundle`) writes them in as an ordinary edit: it shows in the
  Source pane, it can be undone, and it is saved when the reader saves. It is not written to disk behind
  their back.
- **On opening** a document that carries a bundle, the shell offers to import: the threads are written to the
  annotation store where comments normally live, the block is taken out of the text, and the comments pane
  reloads. Declining is remembered for that document, so a tab switch does not ask again.

### Not covered

- Bundling is a command, not a mode: comments added after bundling are not written into the file until it is
  run again. The opt-in mode that keeps the bundle current is FR-10.6, which is separate.
- Tracked changes are not bundled, only comments.
- An imported thread keeps the id it arrived with, so importing the same file twice replaces rather than
  duplicates — but two people who bundled the same document separately will have their threads merged by id
  rather than kept apart.
- There is no command to strip a bundle without importing it.

## 6da. Keeping Comments in the File (FR-10.6)

**Settings → General → Keep comments in the file** is the standing version of §6cz's one-off command: with it
on, the document always carries its own comments, so saving the file is all it takes to send them with it.

Off by default. It makes every comment an edit to the document — a change to undo, a file to save — which is
the right trade only when the file has to travel on its own.

### How it stays current

The comments controller reports a plan whenever a comment is added, edited, resolved or deleted.
`syncPortableComments` runs on the same signal: it bundles the threads into the text and applies the result
when it differs from what is there.

Comparing before applying is what stops it looping. The rewrite is itself a document change, which brings the
comments round to be planned again; the second pass produces the same text and stops.

Turning the mode off needs no separate step: a document keeps its bundle until something about its comments
changes, and from then on it is written without one, because bundling an empty list removes the block.

With the mode on, a document that arrives carrying comments is **not** offered as an import — it is meant to
carry them, and the offer would be asking the reader to undo the mode they turned on.

### Not covered

- Turning the mode off does not strip the bundles already written; they go the next time a document's
  comments change. There is no command to strip one on its own.
- Tracked changes are not carried, only comments.
- A document edited with the mode on will differ from the same document edited with it off, so a folder
  shared between people who have chosen differently will see the bundle appear and disappear in the diff.

## 6db. Readability (FR-12.6)

The statistics dialog now reports three published measures of how hard the prose is to read, for the
document and for the selection: **Reading ease (Flesch)**, **Grade level (Flesch–Kincaid)** and the
**Gunning fog index**.

### Measured on the prose, not the source

`packages/core/src/analysis/readability.ts` scores the text a reader reads, which `documentProse` pulls out
of the parsed document. Only `text` nodes contribute, and that is all the filtering it takes: a code block,
an inline code span, raw HTML and front matter each keep their content in the node's own `value`, and a link
keeps its address in `url`, so the walk never reaches any of it. A link's *label* does have text children,
which is right — the label is read and the address is not.

This is not a nicety. On the welcome document the scores were an ease of −40.8 and a grade of 20.2 when the
Markdown source was measured; on its prose they are 18.4 and 12.4. A page with three links can otherwise
score below a scale whose bottom is meant to be legal boilerplate, because a URL is one enormous word of
nonsense syllables.

Blocks are separated when the prose is assembled and inline pieces are not, because the inline pieces are
already spaced as the writer spaced them: `the [mat](…).` is `the `, `mat`, `.`, and joining those with a
space would make the full stop a word.

### The three measures

All three are arithmetic over words, sentences and syllables, so the only judgement is how syllables are
counted. English syllable counting has no exact rule short of a dictionary, and a dictionary is not worth
carrying for a number in a dialog, so `countSyllables` counts runs of vowels, treats `y` as a vowel, drops a
silent final `e` — except in a consonant + `le` ending, where the `l` carries a syllable of its own — and
never returns zero for a word with letters.

`isComplexWord` is Gunning's definition: three syllables or more, after a familiar `-es`, `-ed` or `-ing`
ending is removed, so "remaining" is not counted as hard.

A document with no words or no sentences has **no** score rather than a made-up one: dividing by zero would
produce a number that prints and is believed. The dialog shows an em dash, because a readability score of
zero is a real and very bad score, not the absence of one. The scores are shown to one decimal place and are
deliberately not clamped: a grade above 12 or an ease below zero are real answers about genuinely hard text.

### Not covered

- The measures are for English. Applied to another language the syllable heuristic is meaningless, and
  nothing stops them being shown.
- Abbreviations still end sentences as far as the sentence count is concerned, which `countSentences`
  already documents.
- There is no reading-level target, no warning when a document exceeds one, and no per-paragraph breakdown.

## 6dc. Word and Phrase Analysis (FR-12.8)

Below the figures, the statistics dialog lists the ten words the document uses most and the ten phrases it
repeats.

### Words

`frequentWords` counts lowercased word tokens taken from the prose, the same `documentProse` readability
uses, so a URL repeated in three links is not mistaken for a writing habit.

- The function words every English document is made of are left out. A list headed by *the*, *of* and *and*
  describes English rather than this writing; leaving them out is what makes the rest worth reading.
- Single letters are left out too: they are variables and list markers, not words anyone is overusing.
- Ties are settled alphabetically, so the list does not change between two runs over the same document.

### Phrases

`repeatedPhrases` slides a window of six words down to three and reports what repeats.

- Three is the shortest window: below it, a repeat is a coincidence rather than a habit. Six is the longest;
  a longer repetition is still found as its six-word head.
- **The longest windows are counted first**, and every run inside a phrase already reported is marked as
  covered. Without that, one repeated sentence fills the whole list with its own fragments.
- Most repeated first, then longest, then alphabetically — a six-word repetition is a sentence the writer
  reused, a three-word one a turn of phrase.

Both lists describe the document rather than the selection: the table above measures a selection, but a list
of words used twice in one paragraph would say nothing.

### Not covered

- The stop words are English. For another language the list is the whole document's vocabulary, ranked.
- Words are counted as written: *otter* and *otters* are two words, because stemming would need a dictionary
  per language.
- Overlapping phrases that are not contained in one another are both listed, so a long repeated passage can
  produce two entries that share most of their words.
- There is no way to jump from a list entry to where it occurs.

## 6dd. Grammar Checking Through a Service You Name (FR-12.4)

**Review → Check Grammar** sends the document to a LanguageTool-compatible service and lists what it reports
in the Problems panel, under **Grammar**, each with the first suggestion as a quick fix.

### Off unless you say otherwise, and only when you ask

`proofing.grammarEndpoint` is empty by default, and empty is the only state in which nothing can be sent.
Checking grammar means sending the document's text to whatever that names, so:

- There is **no built-in service and no default address**. The reader names one in Settings → Proofing, or
  no check is possible.
- The check is a **command, not a timer**. Nothing is sent as you type. Sending a document off the machine
  is a thing to do when asked.
- `checkGrammar` refuses an empty address before it assembles anything, so there is no path on which text
  reaches a service that was never named — the first test in `grammar-service.spec.ts` is that no request is
  made at all.

### Reading the answer

`packages/core/src/proofing/grammar.ts` turns a `/v2/check` reply into issues, and trusts nothing in it: the
service is one the reader chose, of any version or none. A match is kept only if it says where it is in whole
numbers, has a length, **lies inside the text it was asked about**, and says what is wrong. The range check is
the important one — an issue past the end would highlight a range the document does not have. Results are
sorted into document order, because a service is not obliged to answer in one.

Every failure — unreachable, a status that is not success, a body that is not a check result — is reported as
itself. None of them returns an empty list, which would read as *nothing wrong with your writing*.

### In the panel

Findings become `grammar` problems, measured in source offsets like the link and document groups. The first
suggestion becomes a quick fix; the rest stay in the message, because a row with five buttons is a row nobody
reads. A quick fix is an ordinary edit and can be undone.

The findings are cleared the moment the text changes: their offsets describe the document as it was when it
was checked, and after an edit they point at the wrong words.

### Not covered

- The service must send **CORS headers**; the webview is a different origin from it. A real LanguageTool
  server does, and a stub written without them fails with "could not be reached", which is what the first
  attempt at verifying this did.
- No check as you type, no per-rule configuration, no way to dismiss a rule, and no authentication: a service
  needing an API key cannot be used.
- A document over 60,000 characters is refused rather than sent in pieces.
- Every request times out after `GRAMMAR_TIMEOUT_MS` (20 s, sending and reading the answer) with its own message,
  combined with any signal the caller passes, so a service that stops answering never leaves a check hanging.
- The language sent is the one proofing is set to; there is no per-document language yet (FR-12.3).

## 6de. Exporting to Word (FR-13.4)

**File → Export as Word Document** writes the document as a `.docx` that Word opens as a Word document, not as
formatted text pasted into one: headings use Word's Heading styles, lists are real numbered and bulleted lists,
footnotes are Word footnotes, and pictures are embedded.

### Building the file

`packages/app/src/files/docx-export.ts` walks the Markdown tree and builds a document with the **docx** library
(MIT, pinned at 9.7.1). Nothing is converted through HTML: every construct is mapped to its Word equivalent
directly, so there is no second parser whose idea of the document can differ from K-Doc's.

| Markdown | Word |
| :--- | :--- |
| Heading 1–6 | Heading 1–6 style |
| Bold, italic, strikethrough | Run properties |
| Inline code, code block | Consolas on a grey shading, one paragraph per code line |
| Link | Hyperlink (address kept in the relationships part) |
| Bulleted / numbered list | Word list; nesting raises the list level; **each numbered list starts again at 1** |
| Task item | ☑ or ☐ before the text |
| Table | Word table; the first row repeats as a header; column alignment kept |
| Block quote | Indented 0.5" per level with a left border |
| Thematic break | Bottom border on an empty paragraph |
| Footnote | Word footnote, numbered in the order a reader meets the references |
| Picture | Embedded, at most 600px wide, aspect kept |

Only the first paragraph of a list item carries the number or bullet; the rest are indented under it.
Footnote definitions are gathered from the **whole tree**, since a definition written inside a quotation is still
a definition; a reference whose definition cannot be found is written as `[^label]`.

### Pictures

Pictures come from the same embedding step the HTML export uses, as data URIs.
`packages/app/src/files/docx-images.ts` decodes them and reads the width and height from the file's own header
(PNG, JPEG, GIF, BMP), because Word needs a size and the webview cannot be asked for one without loading the
image. A picture that could not be read, or is in a format Word cannot embed (SVG, WebP), is written as its
description in brackets.

### Writing it

A `.docx` is binary, and the text-file command would corrupt it, so the desktop app has a new command,
`write_binary_file` (`src-tauri/src/binary_file.rs`). It writes to `<name>.kdoc-tmp`, flushes it to disk, and
renames it over the target: a failed export leaves the previous file as it was, and no temporary file behind.

### What is said afterwards

The status message names whatever did not survive — raw HTML, pictures that could not be read, pictures in a
format Word cannot embed — once each. Front matter and link reference definitions are left out without comment:
they are not content a reader of the Word file lost.

### Not covered

- Nothing becomes a Word equation or drawing: inline maths is written as its TeX, a Mermaid diagram as its
  source in a code block, and a node type the exporter does not know is walked for its text or, with none,
  named by its type in the status message.
- Code blocks are not syntax-coloured.
- Pictures on the web are embedded only if the HTML export's embedding step could fetch them.
- The browser build refuses: writing a binary file needs the desktop app.

## 6df. Importing Documents (FR-13.5)

**File → Import Document** turns a Word document (`.docx`), a web page (`.html`, `.htm`), rich text (`.rtf`) or
plain text (`.txt`) into Markdown. Before anything opens, a dialog lists what Markdown cannot hold — *text colours,
fonts and sizes (3); pictures stored inside the file* — and the reader can cancel there. The result opens as a new,
unsaved document, so nothing is written until the reader chooses where.

### One road to Markdown

Every format goes through HTML, and HTML goes through the same hast → mdast step the paste path already uses
(`rehype-remark`). `packages/core/src/import/html-import.ts` adds what an import needs on top of it:

- **A loss report.** Before conversion the tree is walked once. Every construct Markdown cannot express is counted
  under a reader-facing label: underlining, highlighting, subscript and superscript, colours/fonts/sizes, paragraph
  alignment, merged cells, tables inside tables, lists inside cells, embedded media, form fields, scripts, and
  pictures stored inside the file as `data:` URIs.
- **No invented formatting.** `rehype-remark` turns `<u>` and `<mark>` into emphasis. The import unwraps them instead,
  because underlined text was never italic; the report says the underlining was lost.
- **Header rows.** A Markdown table must have one; Word and most pages mark none. A table without `<th>` has its
  first row promoted, rather than getting an empty header above the data.
- **Footnotes.** `html-footnotes.ts` recognises the usual shape — a link, often in `<sup>`, to `<li id>` in a list,
  with a back-link — and writes Markdown footnotes numbered in reading order. The superscript around a reference is
  the reference's, so it is not reported as lost.

Pictures on the web stay as Markdown images. Pictures stored inside the file are dropped and reported: a
megabyte-long data URI in the Markdown source is not a picture anyone can edit.

### Word

`packages/app/src/files/document-import.ts` converts `.docx` with **mammoth** (BSD-2-Clause, pinned at 1.12.3),
which reads Word's own structure: heading styles, lists, tables, footnotes, hyperlinks. Its style map is told to
keep underlining (`u => u`) and highlighting (`highlight => mark`), which it otherwise drops silently, so that the
HTML step can report them. mammoth's own warnings join the report word for word.

mammoth is loaded on first use (`import()`), so it is not part of starting the app.

### Rich text

There is no RTF dependency. `rtf-tokens.ts` splits the source into groups, control words, symbols and text;
`rtf-import.ts` tracks group and paragraph state; `rtf-html-writer.ts` writes simple HTML.

- Headings come from stylesheet names (`heading 1` … `heading 6`), lists from `\ls` with numbering read from
  `\listtext`, tables from `\intbl`/`\cell`/`\row` with each cell's alignment kept as its column's, and links
  from `HYPERLINK` fields.
- Text is decoded from `\'hh` (Windows-1252) and `\uN` escapes, honouring `\uc` fallbacks.
- Pictures (including Word's `\shppict` wrapper, counted once), embedded objects, headers and footers, footnotes,
  comments, nested list levels, colours, highlighting and body-text alignment are reported.
- Run text is escaped before it becomes HTML: a `<` in an RTF document is a character, not markup.

### Reading the file

`read_binary_file` (`src-tauri/src/binary_file.rs`) returns the bytes as a raw IPC response, which the webview
receives as an `ArrayBuffer` rather than a JSON number array. It refuses folders, and files over 64 MB before
reading them.

K-Doc still does not guess at encodings. Text files are UTF-8 or carry a UTF-16 byte order mark. A web page may
also declare its character set in a `<meta>` tag — Word's filtered HTML is windows-1252 — and the declaration is
used, because the page itself is saying what it is. A declared set the platform cannot read is refused by name.
RTF is read byte for byte.

### Not covered

- **Word's filtered HTML** writes lists as paragraphs with the number typed in and footnotes as named anchors; they
  import as such. Importing the `.docx` gives real lists and footnotes.
- mammoth does not report paragraph alignment, text colour or fonts, so a `.docx` loses them without a line in the
  report; nor does it read table column alignment.
- Nested RTF lists are flattened (and reported); RTF footnotes are dropped (and reported), not converted.
- Pictures inside a Word or RTF file are not extracted into files beside the document.
- No `.odt`, `.doc` or `.pages`; no drag-and-drop import.

## 6dg. A Language Per Document (FR-12.3)

Each document is spell-checked in its own language. The status bar shows it (`fr`, `en-GB`) and says in the tooltip
where it came from; clicking it opens a picker. A dictionary the app does not have is downloaded only when the reader
says yes, and is then kept on disk.

### Deciding the language

`packages/app/src/spell/document-language.ts` resolves it, first match wins:

| Source | How |
| :--- | :--- |
| Front matter | `lang:` (or `language:`) in YAML front matter, normalised (`fr_fr` → `fr-FR`) |
| Reader's choice | Picked in the status bar; kept in local storage per file (`kdoc.language.v1`, 500 files), in memory for an unsaved document |
| Detection | When **Settings → Proofing → Detect each document's language** is on (the default) |
| Default | **Settings → Proofing → Language** |

Front matter wins because it travels with the file; a language it names is changed there, not in the picker. An
edit that adds, changes or removes `lang:` switches the dictionary at once. Detection runs when a document is opened,
when settings change and when "Detect automatically" is picked — not on every keystroke.

### Detection

`packages/core/src/proofing/document-language.ts` counts, for twelve languages (en, fr, de, es, it, pt, nl, sv, da,
nb, pl, fi), how many of the prose's words are among that language's thirty most telling common words. It is measured
on `documentProse`, so code and link addresses do not vote. It answers only when there are at least 20 words, the
winner's words are at least 15% of them, and the winner scores at least 1.5 times the runner-up; otherwise it says
nothing and the default stands. A guess names a language, not a region, so a guess that agrees with the default keeps
the default's region (`en` → `en-GB`). There is no dependency.

### Finding a dictionary

The spell service tries, in order, without touching the network:

1. **A dictionary loaded earlier this session** — `spell_select` makes it active again without reading or parsing it.
   `spell.rs` keeps the dictionaries it has parsed, parked under their language, so moving between an English and a
   French document costs nothing after the first time.
2. **The bundled dictionary** (`public/dictionaries/en-GB`). A web page returned in place of a missing file — which a
   packaged app can do — is recognised and treated as no dictionary.
3. **One downloaded before** — `spell_load_cached` reads `<app data>/dictionaries/<tag>/index.aff|dic`.

Each is tried under the full tag and then its primary language (`fr-FR`, then `fr`), because dictionaries are
published under both. When none is found, the document is **not checked**: the service reports no dictionary, so a
French document is never checked against the English one still in memory.

### Downloading one

The shell then asks: *This document is in French, and there is no French dictionary on this computer. Download one
from github.com/wooorm/dictionaries?* **Download** fetches `index.aff` and `index.dic` from
`raw.githubusercontent.com/wooorm/dictionaries`; **Not now** leaves spelling off for that language and says so.

- `spell_install_dictionary` parses the files **before** storing them, so a download that is not a dictionary is
  refused and never cached. It writes with the atomic writer, `.dic` first and `.aff` last, and a read treats either
  file missing as no dictionary.
- The language tag becomes a folder name, so Rust checks it (2–3 lowercase letters, optionally a hyphen and 2–8
  letters or digits) before building a path.
- A refusal or a failed download is remembered for the session so the question is not asked on every re-check;
  choosing the language again from the status bar asks again.
- Only languages wooorm/dictionaries publishes are offered; for any other the status bar says there is no dictionary.

Grammar checking sends the document's language too.

### Not covered

- A document in more than one language is checked in one; there is no per-paragraph language.
- Detection knows twelve languages; others are chosen in the status bar or named in front matter.
- A choice made for an unsaved document is not carried over when it is saved.
- Downloaded dictionaries cannot be removed from inside the app; they live in the app data folder.
- The CodeMirror source view is still not spell-checked (it was not before).

## 6dh. Exporting to Markdown Flavours (FR-13.6)

**File → Export as Markdown Flavour** writes the document to a new `.md` file in one of three flavours and says in the
status bar what it changed: *Changed: tables written as HTML; maths written as code.* The open document is never
touched — every rewrite works on a copy of its tree — and the export refuses to write over the open document's own
file, comparing paths after resolving `.` and `..` (`canonicalFilePath`).

### The flavours

`packages/core/src/export/markdown-flavours.ts` copies the tree, runs one rewrite, and serializes the result.

| Construct | CommonMark | GFM | Vault-portable |
| :--- | :--- | :--- | :--- |
| `==highlight==` | `<mark>` | `<mark>` | kept |
| `~sub~`, `^sup^` | `<sub>`, `<sup>` | `<sub>`, `<sup>` | kept |
| `$maths$`, `$$` blocks | inline code, ```` ```math ```` | inline code, ```` ```math ```` | kept |
| Tables | HTML `<table>` | kept | kept |
| `~~strikethrough~~` | `<del>` | kept | kept |
| Task list checkboxes | `[x]` as text | kept | kept |
| Footnotes | numbered `<sup>` anchors and `<div class="footnote">` | kept | kept |
| Front matter | an HTML comment holding it, fences included | kept | kept |
| `[[wikilinks]]` | as written | as written | relative Markdown links |

`flavour-downgrades.ts` rewrites bottom-up, so a highlight inside a table cell is already HTML when the table is
rendered, and inline wrappers keep their children as Markdown between the tags. Footnotes are numbered in the order
a reader meets their references, then any never referred to. A `-->` in front matter is broken up so it cannot end
the comment early.

### Wikilinks

`wikilink-links.ts` finds `[[Target]]`, `[[Target#Heading]]` and `[[Target|Alias]]` in text and asks the app where
each points. The app resolves the target with `classifyLink` against the vault's notes — accepting only a note the
vault actually holds, since `classifyLink` also answers "note" for any relative path — and writes the path relative
to the **folder the export is saved in** (`relativeLinkPath`: forward slashes, case-insensitive folder matching,
percent-encoded segments, the full path on another drive), with `#heading-slug` for a heading. The link shows the
alias, or the target. A wikilink that names no note, an embed `![[...]]` (which would turn into an image), and a
wikilink inside a link's own text are left as written.

### Wikilinks were being escaped on save

Wikilinks are plain text in the tree, and the serializer's default text handler escapes a `[` that could start a
link. So a paragraph holding `[[Note]]` was written back as `\[\[Note]]` whenever it was serialized — **after any
edit to that paragraph in the rich-text view**, not only on export — and the saved file no longer had a wikilink in
K-Doc, Obsidian or anywhere else. `serialize/wikilink-text.ts` now writes `[[...]]` and `![[...]]` exactly as read and
escapes only the text around them, in the same way `alert-marker.ts` keeps `[!NOTE]` unescaped.

### Not covered

- The portable flavour does not copy the files wikilinks and embeds point at; links are relative to where they are.
- Embeds `![[...]]` are not turned into images or links in any flavour.
- Callout blockquotes keep their `[!NOTE]` marker in every flavour; CommonMark shows it as text.
- Comments kept beside the file are not included.

## 6di. Export Themes (FR-13.8)

The stylesheet an HTML export or a printout is written with is a choice, not a constant. **File → Export Theme**
offers the themes K-Doc ships and any the reader has written; **File → Open Export Themes Folder** opens the folder
they live in. The choice is `export.theme` in settings, and it applies to both the HTML export (FR-13.1) and printing
or PDF (FR-13.2).

### The themes K-Doc ships

`packages/core/src/render/export-themes.ts` holds them. Each is the default stylesheet plus its own rules, so a theme
only says what it changes and nothing is left unstyled:

| Theme | What it is |
| :--- | :--- |
| `default` | `EXPORT_STYLESHEET`, what exports looked like before this |
| `serif` | Georgia body text on a wider measure |
| `compact` | 14px, tighter spacing, a narrower measure |
| `plain` | no stylesheet at all, for a document something else will style |

### The reader's own

A theme of the reader's is a `.css` file in `<app data>/export-themes`. `src-tauri/src/export_themes.rs` lists the
folder (`.css` files only, by name), reads one file, and opens the folder — writing a copy of the default stylesheet
as `custom.css` the first time, so the folder is never empty and there is something to edit. A theme name becomes a
file name, so it is checked first: 1–64 characters, each a letter, digit, space, hyphen or underscore.

`packages/app/src/files/export-themes.ts` puts the two together: the names offered are the built-in ones followed by
the reader's, a theme of the reader's replaces one of the same name rather than appearing twice, and the stylesheet
for a name is theirs if they wrote one, else the built-in one, else the default. A themes folder that cannot be read
is no themes rather than an error, because a missing folder is not something the reader asked about.

### How it reaches the file

`exportDocumentHtml` and `printableHtml` take the stylesheet as an argument, and the shell reads it from the chosen
theme before either runs. Printing keeps the page rule and the contents-page rules whatever the theme says, because
those come from the page setup rather than from the styling.

### Not covered

- The editor is not affected: this is the stylesheet for a file being written or printed,
  not for the app (FR-14.10 is the app's themes).
- A theme cannot be created, renamed or deleted inside K-Doc; the folder is the interface.
- There is no validation of a reader's CSS: it is written into the file as it stands.
- The settings dialog takes a theme by name, because the reader's themes can appear or be renamed while it is open.

## 6dj. User Themes (FR-14.10)

The app can wear a stylesheet the reader wrote. **View → App Theme** offers the `.css` files in
`<app data>/themes`, and **View → Open App Themes Folder** opens that folder. A theme is reloaded the moment it is
saved, so it can be written with K-Doc open in front of you.

### The contract

Every colour K-Doc paints with is a custom property — `--kdoc-color-background`, `--kdoc-color-text`,
`--kdoc-color-accent` and the rest of `ThemeColors` — so a theme that sets them changes the whole app and needs to
know nothing else. `appThemeStarter()` (`packages/app/src/shell/theme.ts`) writes that contract out as a stylesheet:
every token at its K-Doc value, under `:root` and again under `:root[data-kdoc-theme="dark"]`, with the comment that
explains it. It is generated from `LIGHT_THEME` and `DARK_THEME`, so it cannot drift from the code, and it is written
into the themes folder as `custom.css` the first time the folder is opened — the contract and a worked example at
once. An untouched copy looks exactly like K-Doc.

The theme's rules go into a `<style id="kdoc-user-theme">` element appended last, after both the app's own stylesheet
and the token block, so a theme wins without `!important`.

### Reloaded as it is written

`theme_watch` (`src-tauri/src/css_themes.rs`) watches the folder with `notify` and emits `kdoc://theme-changed` with
the kind of theme that changed; the shell reads the file again and replaces the element's text. The folder is watched
rather than the file, because saving a file in most editors replaces it. One watch is kept at a time and it ends with
the window. The document watcher (FR-6.4) is left alone: it holds the open document's watch, and a second use would
take it away.

### One place for both kinds of theme

Export themes (FR-13.8) and app themes are the same shape: `.css` files in a folder under the application data
directory, listed and read by name. `css_themes.rs` serves both, and the webview names a *kind* — `export` or `app` —
which decides the folder (`export-themes` or `themes`); nothing else is accepted, so the folder is never something
the webview names. `packages/app/src/files/theme-files.ts` is the one client of it, made with the themes K-Doc ships
for that kind (four for exports, none for the app) and the stylesheet to fall back on (the default for exports,
nothing for the app, which leaves K-Doc's own colours).

### Not covered

- A theme is colours: there is no contract for spacing, fonts or borders, and a theme that styles K-Doc's own class
  names is writing against markup that may change.
- Nothing validates a theme's CSS, and a theme that sets a token to nonsense simply looks wrong.
- Themes cannot be created, renamed or deleted inside K-Doc; the folder is the interface.
- The K-Doc pane follows the app's tokens, so a theme changes it too; the stylesheet an export is *written* with is
  the export theme (FR-13.8), not this.

## 6dk. Attachments (FR-6.14)

An image pasted or dragged into a note is written into an attachments folder beside it, and the note refers to it by
a relative path, so the note and its files travel together.

### Where it goes and what it is called

`general.attachmentsFolder` (default `attachments`) is resolved against the *document's own folder*, not the vault
root: a note moved with its folder keeps working. An absolute setting is used as written, for a reader who wants one
folder for everything. `general.attachmentNameTemplate` (default `{name}-{date}`) names the file from four tokens —
`{name}` (the dropped file's base name, or `pasted` for a clipboard image), `{doc}`, `{date}` and `{time}`. The
extension always comes from the file, never from the template, so no template can make a PNG claim to be something
else, and every token is sanitised, so nothing a template or a file name carries can take the write out of its
folder. Both settings have a row in Settings → General.

### Writing it

`attachment_write` and `attachment_copy` (`src-tauri/src/attachments.rs`) create the folder, pick a name that is
free — `shot.png`, then `shot-2.png` — and return the name actually used, which is what the webview writes into the
document. Nothing is ever overwritten: an attachment with the name you asked for already existing is a fact about
the folder, not an error. A pasted image arrives as bytes through `attachment_write`; a dropped file is copied by
the host with `attachment_copy` rather than read into the webview and written back. Both refuse a relative folder,
a name carrying a path separator, and anything over 25 MiB.

A pasted image reaches the shell through a new `onPasteImages` option on the clipboard handler
(`packages/editor/src/prosemirror/clipboard.ts`), which offers the clipboard's image files before any text handling:
a screenshot is a file to write, and the text the clipboard carries alongside it names nothing useful. The shell
returns false when the document has never been saved, which leaves the paste to the ordinary text path.

A dropped image already inside the attachments folder is referred to relatively rather than copied again. One
dropped into an unsaved document keeps the path it was dropped from, because there is no folder to resolve against.

### The unused report

**Unused Attachments Report** (command palette) lists the folder's files that no note refers to.
`attachmentReferences` (`packages/core/src/attachments/attachment-references.ts`) sweeps a note for inline links and
images, wikilink embeds, reference definitions and HTML `src` attributes, reduces each target to the file name it
ends in, and drops anything with a scheme — an `https:` or `data:` target names no file on disk. The open document
is read from the editor rather than from disk, so unsaved edits count; every other note comes from the vault index.
The report opens as a new document, and each name in it is written in backticks rather than as a link, so that
saving the report inside the vault does not make the files it lists look referenced.

### Not covered

- Only images are written into the folder: a dropped PDF is still linked where it lies (FR-7.5).
- Nothing moves or deletes an attachment, and the report does not offer to; it says which files nothing points at.
- A reference built at runtime, or one inside a fenced code block, is not distinguished from a real one — the sweep
  is textual, so a name mentioned in an example counts as a use.
- An attachment is never de-duplicated: pasting the same screenshot twice writes two files.

## 6dl. Alignment (FR-8.11)

Markdown has no way to say "centre this". HTML does, so K-Doc writes the HTML — but only once the reader has
said it may. **Settings → Editor → Allow HTML formatting** is off by default, and while it is off the four
commands (**Align Left**, **Align Centre**, **Align Right**, **Remove Alignment**) say so rather than writing
anything.

### What is written

An aligned block is wrapped:

```markdown
<div align="center">

Centred, and **still Markdown**.

</div>
```

The blank lines are load-bearing. An HTML block with no blank line after it swallows what follows, so the bold
inside would stop being bold everywhere but K-Doc. With them, the content is an ordinary paragraph that every
renderer still reads as Markdown, and GitHub, Obsidian and Pandoc all honour the `align` attribute.

### How it is carried

`foldAlignment` (`packages/core/src/align/block-alignment.ts`) runs at the end of `parseMarkdown` and turns the
wrapper into node data on the block it held: `data.kdocAlign` for K-Doc, and `data.hProperties` for
mdast-util-to-hast, which is what centres the block in an exported file with no renderer
changes. The editor's schema carries the same value as an `align` attribute on `paragraph` and `heading`, so an
aligned block is an ordinary editable block rather than two raw HTML blocks around a plain one, and
`alignedBlockHandler` writes the wrapper back on the way out.

The folded block **takes over the wrapper's source range**. Without that, the two HTML nodes' ranges belonged to
nothing once folding removed them, and the incremental serializer (FR-4.2) — which rewrites a changed block over
its own range — left the `<div>` lines in the file when the alignment was cleared. That was found by running it,
and `an aligned block rewritten in place` in the core tests is the guard.

### What is not folded

Only a wrapper holding exactly one paragraph or heading. A wrapper around two blocks, one naming an alignment
K-Doc does not write (`justify`), or one whose close is missing, is left exactly as written: it shows as raw HTML
and round-trips byte for byte. That boundary is what keeps a file K-Doc does not understand safe from it.

### Not covered

- Alignment applies to paragraphs and headings only; a list, a table or a code block cannot be aligned.
- `<p align="center">Text</p>` on one line is a single HTML block whose content is not Markdown, so it is not
  recognised — only the blank-line form is.
- There are no keyboard shortcuts: `Ctrl+Shift+E` and `Ctrl+Shift+R` already belong to Track Changes and the
  right panel, and taking them would be worse than a trip to the palette.
- Nothing warns that an aligned document is less portable than it was; the setting is the warning.

## 6dm. Video and Audio (FR-8.17)

Markdown has no syntax for a video, so K-Doc invents none: a paragraph that is *nothing but* a link or an image
naming a media file, or a link to a site it knows, becomes a player. The file keeps the link it always had.

### What counts

`mediaOfParagraph` (`packages/core/src/media/media-embeds.ts`) accepts a paragraph with exactly one child, a link
or an image, whose address either ends in an extension K-Doc plays (`mp4`, `m4v`, `webm`, `ogv`, `mov`; `mp3`,
`m4a`, `wav`, `ogg`, `oga`, `flac`, `aac` — read past any query or fragment, and case-insensitively) or matches a
provider: `youtube.com/watch?v=`, `youtu.be/` and `vimeo.com/`. A provider wins over an extension, because a URL
that happens to end in `.mov` is still a page. A sentence that merely contains a link stays prose.

### In the editor

The K-Doc pane is the only rendered view of the document, so there is no second rendering path to hang a player
on: the editor needs a node view. `from-mdast` folds a recognised paragraph into a `media` node, `media-view.ts` renders
it, and `to-mdast` writes it back as exactly the link or image it came from — the node carries `syntax`, `target`
and `label` for that purpose, so a file never learns that K-Doc showed it as a player. The fold happens in the
editor bridge rather than in the mdast tree, which is why the incremental serializer (FR-4.2) needs no changes
here, unlike alignment (FR-8.11).

A local file is read by the host — `read_media_file` in `src-tauri/src/media.rs`, absolute paths with a media
extension only, 64 MiB cap — and handed over as a blob. That is a memory limit rather than a judgement about
length: the webview holds the whole file, because K-Doc serves bytes through its own validated command rather
than opening the filesystem to the webview with Tauri's asset protocol.

### Nothing is fetched until it is asked for

A provider reference renders as a card: the title, the address, and a **Play** button. Only a press swaps in the
iframe, and the iframe points at `youtube-nocookie.com`. An editor that quietly asked YouTube for a video every
time a document opened would be telling YouTube what its reader is reading, which is not a thing to do by
default. Exports carry the iframe directly, because a file that has left K-Doc is being read in a browser where
an embedded video is what the document meant.

### What leaves K-Doc

`applyMediaEmbeds` annotates a **copy** of the tree with `hName`/`hProperties`, so `mdast-util-to-hast` emits
`<video controls>`, `<audio controls>` or the provider `<iframe>`. The copy matters: the document the reader is
editing must not gain rendering data because something was exported from it, and a test guards exactly that.

### Not covered

- A local clip is loaded whole before it plays: there is no streaming, and a file over 64 MiB is refused.
- Only YouTube and Vimeo are recognised; every other site stays an ordinary link.
- A player cannot be inserted from the ribbon — write the link and it becomes one.
- A standalone HTML export embeds images as data URIs but references media by address, so a video does not
  travel with the exported file.
- Nothing reads a clip's duration, size or poster frame; the player shows what the browser makes of the bytes.

## 6dn. LaTeX and EPUB through Pandoc (FR-13.7)

K-Doc writes HTML, Markdown and DOCX itself. LaTeX and EPUB it does not: **Export as LaTeX** and **Export as EPUB**
hand the document to Pandoc, if Pandoc is on the reader's PATH. K-Doc does not ship it, install it, or offer to.

### Asking first

`pandoc_version` (`src-tauri/src/pandoc.rs`) runs `pandoc --version` and returns its first line, or an empty
string when the program cannot be launched. That empty string is not an error: an optional tool that is not
installed is a fact, not a failure, and the export command says so in the status bar rather than showing a
stack of process errors. The webview asks before it opens a save dialog, so a reader without Pandoc is never
walked through choosing a file that cannot be written.

### What is run

`pandoc -f markdown -t <format> -o <path>`, with the document on **stdin**. Nothing goes through a shell: every
part is an argument to the process, so a file name or a document's content cannot become one. Both formats are
fixed — the webview names `latex` or `epub` and `pandoc_argument` maps that to the only two values K-Doc will
pass, so a request for anything else is refused before Pandoc is launched. The input format is fixed too, so a
document cannot ask to be read as something it is not. The output path must be absolute, and it is the path the
reader chose in the save dialog.

The document reaches Pandoc through a pipe rather than a temporary file, which means K-Doc never leaves a copy of
the reader's text somewhere on disk it did not choose. Closing that pipe is load-bearing: without the `drop`,
Pandoc waits for more input and neither process moves — a mutation that removed it hung the test run rather than
failing it.

### Not covered

- Only LaTeX and EPUB. Pandoc writes dozens of formats; these are the two the roadmap asks for, and each one
  added is another argument K-Doc has to be sure of.
- No Pandoc options are exposed: no template, no bibliography, no filters. The document is converted with
  Pandoc's own defaults.
- Images and other local files are referenced as the document writes them, so a LaTeX file exported somewhere
  else may point at addresses that no longer resolve.
- K-Doc neither installs Pandoc nor tells the reader how to; it says the export needs it and stops there.

## 6do. A ribbon of the reader's own (FR-14.17)

K-Doc's ribbon is a layout: three tabs, each holding titled groups of command ids. **Customise Ribbon**
lets the reader rewrite that layout — reordering and removing buttons, reordering groups, and adding any
command the build has — and keeps what they settle on in their settings.

### The arrangement lives in settings

`appearance.ribbon` is an array of `{ tab, groups: [{ title, commands }] }`, and empty means K-Doc's own
ribbon. `parseRibbonSetting` (`packages/config/src/settings/ribbon-setting.ts`) reads it defensively: a tab
that cannot be read is left out and reported as a warning rather than refusing the file, because one bad
line should cost its own tab and not the reader's whole configuration. A group that cannot be read costs its
tab, though — a tab drawing half of what was written is worse than one that says nothing.

### What is drawn

`resolveRibbonLayout` (`packages/app/src/shell/ribbon-layout.ts`) turns the saved arrangement into the
layout the ribbon draws, against the set of command ids the registry currently holds. It drops a tab K-Doc
does not draw, a command the build does not have, a command named twice in one group, a group without a
heading, a group left with no commands, and a tab left with no groups. If nothing survives, it returns
K-Doc's own layout: a reader is never left with an empty ribbon. So an arrangement written by a newer build,
naming commands this one has not got, still draws everything it shares.

`installRibbon` takes an optional `layout` callback, and the shell passes one. It is read once, when the
ribbon is built, so changing the arrangement builds a new ribbon — `rebuildRibbon` keeps the expanded or
collapsed state and the tab the reader was on, unless that tab is not in the new arrangement. Settings are
loaded after the shell is constructed, so `applySettings` draws the ribbon again: without that, an
arrangement on disk would not appear until something else happened to redraw.

### The dialog

`installRibbonDialog` (`packages/app/src/shell/ribbon-dialog.ts`) is a native `<dialog>` holding a tab
strip and, for the chosen tab, each group with **Up**, **Down** and **Remove** on every command, **Up** and
**Down** on the group itself, and a list of every command not already in that group. It owns no editing
logic: each button calls one of the four pure functions in `ribbon-editing.ts`, which never touch what they
are given and return the layout unchanged when an index names nothing. That is why the dialog can be driven
by re-rendering from a single working value, and why the editing rules are tested without a DOM.

It opens on the arrangement the ribbon is **drawing**, not on the setting. A reader who has never arranged
the ribbon has an empty setting, and a dialog with nothing in it is no way to start from K-Doc's own ribbon;
`ribbonLayoutSetting` turns what is on screen into something editable. **Apply** hands the arrangement back
and closes first, so the focus the shell restores is the last thing that runs. **Cancel** discards the
working copy, and reopening starts again from what is drawn. **Use K-Doc's ribbon** empties the arrangement,
which is what an empty setting means everywhere else.

A command the build does not have is shown by its id, greyed, so a reader can see what a layout from another
build names and remove it. The alternative — hiding it — would leave them editing something they cannot see.

### Not covered

- No dragging: the buttons move a command one place at a time. Drag and drop is a bigger piece of work than
  the reordering it would replace.
- Groups cannot be added, renamed or removed, and tabs cannot be added or renamed. The reader arranges the
  commands within the shape K-Doc draws.
- Only the three tabs K-Doc has. A tab is a thing the ribbon knows how to build, not just a name.
- The quick-access toolbar is not arrangeable; this is the ribbon only.

## 6dp. The graph of a vault (FR-6.15)

**Graph** draws the notes of the open vault as circles and the links between them as lines. A note can be
clicked to open it, and the graph can be narrowed to the note on screen and what it names.

### Three pure steps, then a window

The work is done in `@k-doc/core`, in three modules that touch no DOM and are tested without one.

`vaultGraph` (`packages/core/src/vault/vault-graph.ts`) turns the vault index into nodes and edges. A link
is resolved with the same `targetsNote` the backlinks panel uses, to the first note in index order it names
— first, not last, so the graph does not depend on which way the index happens to be walked. A link to
nothing is left out, because a broken link is FR-14.7's business. A note linking to itself is not a
relationship between notes, so it is not an edge. The same link written twice is one edge of weight two,
drawn thicker. A note's degree counts its distinct neighbours whichever way the links run, so a note
everything points at is as big as one that points at everything. `graphNeighbourhood` cuts the graph down to
one note and whole rings around it, following links both ways.

`layoutGraph` (`graph-layout.ts`) places the notes: seeded evenly on a circle, then relaxed for a fixed
number of rounds of repulsion, springs along the links, and a drift back to the middle. Nothing is random.
The same graph lays out in the same places every time, so a redraw does not move the notes under the
reader's cursor and a test can assert where they land. Each round is worked out in full before any of it is
applied, so the answer does not depend on the order the notes are visited.

Both axes are then scaled by **one** span, the larger of the two. Scaling each axis to fill the box on its
own — which is what this did first — stretches the picture until the distances no longer mean anything: a
graph of two linked notes came out looking exactly like a graph of two notes with nothing between them. The
axis with less spread is centred in what is left instead.

`graphDrawing` (`graph-drawing.ts`) turns the graph and its layout into circles and lines in a 1000-unit
box: where each one goes, how big, how thick, and what the label under it reads. A long note name is cut by
characters, because a note name is often one long word.

`installGraphDialog` (`packages/app/src/shell/graph-dialog.ts`) only draws what it is handed. The graph is
built afresh each time the window opens rather than kept and invalidated: it is one sweep of what the index
already holds, and a stale picture of a vault is worse than a pause.

### Not covered

- Nothing can be dragged. The layout decides where the notes go.
- No zoom and no pan: the whole graph is fitted to the window. A vault of thousands of notes will be dense.
- Only one ring around the note on screen; the depth is not adjustable.
- Tags and folders are not drawn, and there is no filtering: every note in the vault is a circle.
- The graph does not redraw while it is open, so a vault that is still being scanned shows what had been
  indexed when the window opened.

## 6dq. Plugins (FR-14.18)

A plugin is a folder under `<app data>/plugins` holding a `plugin.json` and a `main.js`. It may add
commands, its own inline syntax, a panel and an export format. Nothing about it is installed, downloaded or
bought: a plugin is a folder the reader put there.

### Where it runs

Each plugin runs in a **Web Worker of its own**, built from a blob whose text is
`PLUGIN_BOOTSTRAP + the plugin's own file + PLUGIN_EPILOGUE`
(`packages/core/src/plugins/plugin-sandbox.ts`). A worker already has no DOM, no `window` and no
filesystem; the prelude takes its way out to the network away as well, setting `fetch`,
`XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`, `Worker`, `SharedWorker`,
`EventSource`, `BroadcastChannel` and `Notification` to `undefined` before the plugin's own code is
reached. The prelude's own bookkeeping - what was registered, and which function answers which call - is
inside a closure rather than on `self`, so a plugin cannot reach it either.

The plugin's code is put in the middle **untouched**. K-Doc does not rewrite it, because a rewrite it got
wrong would be worse than the sandbox the code is already inside.

### What it may say

`packages/core/src/plugins/plugin-protocol.ts` is the whole of what may cross that line, and nothing in it
trusts its input. A registration must name one of the four points; its id must be a plain word, because the
host builds a command id and a file name out of it; a label must be present and short enough to read in a
menu; an export's extension must be letters and digits only, because it becomes part of a file name; a
syntax must name one of eight elements that cannot run or load anything, a class name that cannot write its
way out of the class attribute, and a pattern that **compiles** - checked here, so a pattern that would
throw does so while its registration is being read rather than in the middle of drawing a document.

One registration that does not read costs the whole plugin: a plugin that registered one thing wrongly has
a bug, and half-loading it would hide that.

### What it is asked

One call carries the document's text and nothing else, with a number the answer is matched back by. A
plugin has four seconds to say what it adds and four seconds to answer any call; one that does not is
**stopped** - its worker terminated, its blob given back, and the plugin taken off the list of what loaded,
so nothing it registered is offered again. Waiting for ever is not something a reader can undo.

### The syntax point

A plugin's syntax is a parser, a renderer and a serializer, in the only shape that cannot cost a reader
anything. The parser is the pattern; the renderer is the element and class, written into the tree as
`hName` and `hProperties` so `mdast-util-to-hast` draws it with no renderer change, exactly as block
alignment and media embeds do; and the serializer is the identity, because the drawing happens on the copy
`renderHtml` already clones, and what was recognised is written back as exactly the text it was recognised
from. A plugin cannot change a reader's file by recognising something in it.

Two plugins cannot collide: a syntax is namespaced `<plugin>:<id>`, and the first one registered wins the
characters it claims - what one syntax drew is never offered to the next.

### Reading the folder

`src-tauri/src/plugins.rs` reads and never runs. A folder name must be a plain word before it becomes a
path, which is what stops one climbing out of the plugins folder; a folder without a `main.js` is skipped,
because a folder that is not a plugin is not a broken plugin; and neither file may exceed a megabyte,
because a plugin is a script rather than a payload. The manifest and the code come back together, in one
round trip, because a plugin is only useful with both.

### Not covered

- No marketplace, no installing, no updating: a plugin is a folder the reader put there, as the spec says.
- A plugin's syntax is drawn in exports and printouts, not in the editing pane. The K-Doc pane is
  ProseMirror, and drawing there would mean a node view per plugin syntax and a round trip through the
  editor's own schema.
- A plugin panel shows text, not a surface of its own: it has no DOM, so it cannot draw one.
- A plugin is given the document's text and nothing else. It cannot read the vault, the settings, the
  selection or any other file, and it cannot write anywhere: what it answers with, K-Doc applies.
- No permissions and no prompts, because there is nothing to ask about: the sandbox is the whole of it.
- A plugin's command has no shortcut of its own and is not remappable.

## 6dr. Indentation outside a list (FR-20.2)

Tab and Shift+Tab indent inside a list and always have. The spec's shortcut table also gives **Ctrl+M /
Ctrl+Shift+M** for indenting anywhere else, with **Ctrl+] / Ctrl+[** as aliases, and those keys had nothing
to be bound to: there was no command for them. `packages/editor/src/prosemirror/indent-commands.ts` is that
command, in two halves.

### What indenting means depends on where the caret is

`indentBlock` and `outdentBlock` both ask `listDepthAt` first, and treat the answer as final. Inside a list,
indenting nests the item under the one above it and outdenting lifts it towards the root - and nothing else.
An item that cannot nest, which is the first of its list because `sinkListItem` refuses it, therefore does
**nothing**, rather than quietly becoming a blockquote inside a list item. That is not what the key was
pressed for, and it is the reason the question is asked before anything is acted on rather than after a
first attempt has failed.

Outside a list there is exactly one indentation Markdown has, and it is the blockquote. Leading spaces do
not indent a paragraph in Markdown - four of them make a code block - so a blockquote is not a stand-in
chosen for convenience, it is the whole of what the format offers. `indentBlock` wraps the block in one
more; `outdentBlock` takes one off.

### Why outdent can lift without asking what it is lifting out of

`toggleBlockquote` documents a trap: a bare `lift` takes the caret out of an enclosing **list** before it
ever reaches a blockquote, so it cannot be chained blindly. `outdentBlock` is safe from it for a reason that
is structural rather than lucky - the list has already been asked about and returned, two lines above. Past
that point a blockquote is the only wrapper a paragraph can be lifted out of in K-Doc's schema, and `lift`
refuses of its own accord when there is none, so naming the blockquote again would only be a second way of
saying what `lift` already answers. A guard that did name it was written first and then deleted: a mutant
that removed it could not be killed, because nothing reached it.

### The keys

`format:indent` and `format:outdent` are ordinary remappable commands in `KEYMAP_COMMANDS`, so they appear
in the Keyboard Shortcuts dialog and can be rebound like any other. Word's table binds each to two chords -
`Ctrl+M` and `Ctrl+]`, `Ctrl+Shift+M` and `Ctrl+[` - which the keymap already supports, aliases being how
`edit:redo` answers to both `Ctrl+Y` and `Ctrl+Shift+Z`. Both also sit in the ribbon's **Paragraph** group
next to Blockquote, and in the command palette under Format.

### Not covered

- Tab and Shift+Tab inside a list stay outside the keymap and are not remappable: a list is the one place
  the key already means this, and it is handled by the editor's own keymap rather than by a binding.
- Nesting a blockquote is the only indentation there is outside a list. There is no ruler, no indent width
  and no first-line indent, because nothing in a Markdown file could record one.

## 6ds. Wiki image embeds and resizing without a mouse (FR-8.15)

A Markdown image has been drawn, selected and resized in the K-Doc pane since FR-8.15 first landed. Two
things were missing: a **wiki embed**, `![[img.png|600]]`, was plain text on the screen, so its size hint
could not be edited by the only means K-Doc offers; and every way of resizing needed a pointer.

### An embed is text in the file and a picture on the screen

`packages/core/src/images/wiki-embeds.ts` is the one place that knows the shape of `![[...]]`.
`parseWikiEmbed` reads what is between the brackets into a target and an optional width, `wikiEmbedText`
writes it back, and `splitWikiEmbeds` cuts a run of text into the plain stretches and the embeds between
them. Three rules decide what is an embed at all:

- **Only a picture.** A target must end in an extension K-Doc can draw. `![[Some Note]]` is left as the
  words the reader typed: K-Doc does not transclude notes, and a broken picture where their sentence was
  would be worse than leaving it alone.
- **Only the last pipe, and only when it is a width.** `![[Some Note|a caption]]` keeps its pipe in the
  target rather than losing the caption to a width that was never there, and a width must match the same
  1-to-5-digit rule `image-hints.ts` uses for the alt slot, so a hint written by one is read by the other.
- **Only within a line.** The pattern cannot cross a newline, so two unrelated lines can never be made
  into one embed that swallows the words between them.

The fold lives in **`from-mdast.ts`**, not in the tree `parseMarkdown` builds - the same choice FR-8.17
made for media, and for the same reason: the document the reader holds still says `![[img.png|600]]`, so
the incremental serializer needs no change at all, and `serialize/wikilink-text.ts` already writes such
text back untouched. `wiki-embed-nodes.ts` turns a run of text into text nodes and image nodes, and an
image made from an embed carries `embed: true`. `to-mdast.ts` reads that flag and writes the picture back
as a **text node** holding exactly the source it came from. Resizing an embed changes a size, not a syntax.

### What leaves K-Doc

`expandWikiEmbeds` produces a **copy** of a tree in which each embed has become an ordinary image node,
with the width written into the alt slot in the shape `applyImageWidths` already reads. `renderHtml` runs
it before addresses are replaced, so a standalone export embeds an embedded picture as a data URI like any
other; `renderFragment` runs it too, for a caller that passes no addresses. The reader's own tree gains
nothing: an export is a way of showing a document, not a change to it.

`wikiEmbedTargets` names the pictures a document embeds without expanding it, which is how the export's
image collector finds them - a wiki embed is not an image node until it is drawn, so walking image nodes
alone would have missed exactly these.

### Resizing without a mouse

`stepImageWidth(wider)` makes the selected picture a tenth wider or narrower. It steps from the width hint
when there is one, because that is exact, and otherwise from **the width the picture is drawn at**, read
through ProseMirror's own optional third `view` argument - a picture that has never been resized has no
width in the document, so the only honest starting point is what the reader can see. A picture that has
not loaded measures zero and is refused rather than guessed at. The result is clamped to the same floor
the drag handle uses, so the two ways of resizing agree.

`Alt+Shift+Right` and `Alt+Shift+Left` are bound in the **editor's own keymap** rather than in the
remappable table, because the command returns false when no picture is selected and a key bound in the
table would be claimed before anything could say so - `Alt+Shift+Right` would stop working everywhere
else. **Widen Image**, **Narrow Image** and **Reset Image Size** are also in the command palette under
Format and on the picture's context menu.

### Editing an embed's address

The image dialog now keeps a wiki embed a wiki embed when only its address is edited. It gives the syntax
up in exactly one case: `![[...]]` has nowhere to put alt text or a caption, so words typed into either
turn the picture into an ordinary Markdown image. Keeping the syntax would mean silently throwing the
words away.

### Not covered

- A wiki embed of a note is not transcluded; it stays the text it is.
- An embed carries a width and nothing else. Alt text, a caption and alignment have no place in
  `![[...]]`, and asking for one of them converts the picture to Markdown rather than inventing a syntax.
- Height is still derived from the picture's own proportions and is never written to the file.

## 6dt. Another document beside this one (FR-6.9)

FR-6.9 asks for split editor panes: **two documents side by side, or the same document at two scroll
positions**. The second half has worked since the second pane was built. This is the first half.

### One pane, two kinds of thing in it

`View -> Another Document Beside This One…` asks the host for a file and gives the second pane a document
of its **own**: `packages/app/src/shell/second-document.ts` reads it into a `DocumentSession` of its own,
with `savedText` equal to what was read so it opens clean. `openSecondaryPane` then binds over
`this.secondaryDocument?.session ?? this.documentSession` - both are ordinary sessions, so the binding does
not need to know which it was given, and `Second Pane on This Document` still does exactly what it did.

The session's own comparison of its text against its saved text is the **only** record of what is on disk.
A second copy was written first and then deleted: a mutant that broke one of the two could not be killed
by the other, which is what a second source of truth looks like when you test it.

### Saying which document, and saving it

`second-pane-header.ts` is a strip inserted **first** in the pane, above the editor's own element, so the
editor keeps the rest of the box. It names the file, says `Edited` when the document holds changes that are
not on disk or `Read-only` when the file will not take a write, and carries Save and Close. Save is
disabled rather than hidden when there is nothing to save, because a button that comes and goes is harder
to aim at than one that greys out; it is hidden only when the pane is a second view of the open document,
which `Ctrl+S` already saves.

**`Ctrl+S` saves what the reader is looking at.** When the second pane holds its own document and the caret
is in it, that is the file written - saving the open document instead would be the wrong file. `target()`
answers "is there anything to write" in one place: a read-only file and a document with no changes both
come back null, so the three ways of having nothing to write are one check rather than three.

### What the lock means here

A document locked as read-only is locked because *that* document is. The second pane takes that lock only
while it is another view of the same document; holding a file of its own, its editability comes from that
file's own read-only flag, so a lock on one file never refuses writes to another.

### Not covered

- The toolbars, find, comments, spelling and outline stay attached to the first pane. They were mounted
  over one editor view and one session, and following the focused pane would mean making every one of them
  re-pointable - a larger change than this requirement asks for.
- A second document has no autosave, no recovery, no external-change watching and no place in the restored
  session. It is saved when the reader saves it, and closing the pane discards edits that were not.
- Only one document can be opened beside, and the second pane is always to the right of the first.

## 6du. Built-in UI themes

K-Doc ships six named themes: K-Doc (the default), Nord, Solarized, Paper, Graphite and High Contrast. Each is a
complete light **and** dark `ThemeTokens` set over the tokens.ts contract, so the existing System/Light/Dark mode
still picks the variant and a theme is only ever a choice of palette.

- **Catalogue** (`packages/config/src/theme/ui-themes.ts`, exported from `@k-doc/config`). `UI_THEMES` maps each
  `UiThemeId` to `{ id, label, description, light, dark }`. The K-Doc entry reuses `LIGHT_THEME` / `DARK_THEME` by
  identity. The others are built by a private `variant()` that copies K-Doc's shadow, highlight and blur tokens for
  the same mode, so elevation looks the same in every theme. `resolveUiTheme(id, mode, systemPrefersDark)` replaces
  `resolveTheme` in the shell, and `uiThemeSwatch` gives the picker its three colours (base, accent, tertiary).
- **Contrast is a test, not a taste.** `ui-themes.spec.ts` checks every variant against the same WCAG AA pairings as
  K-Doc's palette, plus the chrome pairs (text on base, raised and container-low; on-accent; on-selected; tertiary;
  edge at 3:1).
- **Setting.** `appearance.uiTheme` (default `kdoc`). An unknown id falls back to `kdoc` with a warning, so a
  settings file written by a newer K-Doc still opens.
- **Applied by** `installTheme(doc, win, mode, uiTheme)`: the controller gains `uiTheme` / `setUiTheme`, and
  `<html data-kdoc-ui-theme="…">` names the active theme so a user theme (6dj) can build on it. A user theme still
  goes on last and wins.
- **Picked from** Settings → Appearance → *Colour theme*, or from `shell/theme-menu.ts`: the title-bar theme button
  now opens a menu (WAI-ARIA `menu` of `menuitemradio`s) holding a System/Light/Dark row and the six themes with
  swatches. Every choice goes through `EditorShell.chooseAppearance`, which saves it. The old cycling button never
  saved the mode; the *Toggle Theme* command still cycles the mode, and now saves it too.
- **Unlike the chrome-only Material restyle (6r-bis),** a built-in theme also changes the page's `--kdoc-color-*`
  tokens, because Solarized or Paper with a white page would not be the theme.

## 6dv. K-Tech branding

K-Doc wears the K-Tech brand from the K-Tech Branding repo (`Brand/readme.md` holds the rules). The one fixed
element is the **sliced-K mark**: three polygons on a 100-unit grid, stroked 7 with round joins, in viewBox
`-4 -4 106 108`. It is copied verbatim and never redrawn.

- **`shell/brand.ts`.** `KTECH_MARK_POLYGONS` (frozen) and `createBrandMark(doc, { heightPx?, label? })` build the
  mark as an SVG in `currentColor`, so it follows the theme. It is decorative unless it has a label.
  `createProductWordmark(doc, '-Doc', 'K-Doc')` builds the wordmark with the mark in place of the K (brand rule: the K
  never appears twice), at cap height (0.72em) on the baseline, in Sansation Bold. `BRAND_STYLES` carries the CSS.
- **Title bar.** `.kdoc-brand` holds the wordmark at 24px, the brand's minimum for a wordmark (the inline mark comes
  out at about 17px).
- **Font.** `@fontsource/sansation` (400 and 700) is imported in `main.ts`, so it works offline like Roboto Flex.
- **About.** `shell/about-dialog.ts`: the wordmark, the version, then the K-Tech stacked lockup (mark over
  `BRAND_SLOGAN`) and the credit. The command is `help:about`, the last item of the Help menu. The version comes from
  `@tauri-apps/api/app` `getVersion()` (covered by `core:default`); a browser build shows "development build".
- **Icons and installer.** `src-tauri/icons/app-icon.png` (1024px: light mark on a flat `#0A0C0E` tile) is the source
  for `tauri icon`. Only the desktop sizes are kept. `installer-header.bmp` (150x57, K-Tech wordmark) and
  `installer-sidebar.bmp` (164x314, K-Doc and K-Tech wordmarks) are NSIS bitmaps. They were rasterised from the same
  polygons, plus the brand repo's Sansation TTFs, by a one-off Pillow script and are not regenerated at build time.
  `packages/app/public/favicon.svg` is the tile as an SVG.

### Third-party notices

`scripts/third-party-notices.mjs` (`npm run notices`) writes `packages/app/public/THIRD-PARTY-NOTICES.txt`, which is
gitignored. It gathers what K-Doc actually ships:

- the production npm tree of the four workspaces (`npm ls --omit=dev --all --parseable`)
- the Rust crates reached from `k-doc` over normal dependency edges only (`cargo metadata --filter-platform
  x86_64-pc-windows-msvc`; build and dev edges are not followed, so `tauri-build` and friends are excluded)
- each fetched dictionary's `license` file (`fetch-dictionary.mjs` now downloads it)

Identical licence texts, after normalising line endings and trailing space, are printed once with the components
that use them. The pure helpers (`isLicenceFileName`, `licenceOfPackageJson`, `normaliseText`, `shippedCrateIds`,
`groupByText`, `renderNotices`) are tested in `scripts/third-party-notices.test.mjs`; `npm test` now covers
`scripts/` too.

`beforeBuildCommand` runs the generator before every release build, and `bundle.resources` installs `LICENSE`,
`NOTICE` and `THIRD-PARTY-NOTICES.txt` beside the executable. Vite also copies the file into `dist/`, where the About
dialog's *Third-party notices* viewer fetches it (`AboutDialogOptions.notices`). A development build without the
file says how to generate it. Packages that ship no licence file get one from `scripts/licence-overrides/`:
`sources.json` maps each package name to a folder of licence files copied from upstream, and records where each came
from. `applyOverrides` uses an override only when a package ships nothing of its own, and the listing marks those
lines "licence copied from upstream". An override nothing needs is reported as unused. A shipped component with no
licence text at all makes the generator exit 1, which fails the release build. `scripts/licence-overrides.test.mjs`
checks that every folder exists, holds a licence file and has a recorded source.

## 7. Extension Seam

Tier 4–5 syntax (math, Mermaid, callouts, wikilinks, embeds, tags — `PRELIM-SPEC.MD`
§4.4–4.5) is added as **micromark extension + mdast node type + serializer handler**
triples. Every extension registers all three or it is rejected: a node that can be
parsed but not serialized would silently break the round-trip contract, which is the
one failure mode the architecture must make impossible. This triple is also the shape
the future plugin API (FR-14.18) exposes.

---

## 8. Build & Run

| Command | Effect |
| --- | --- |
| `npm install` | Install the workspace (root + packages) |
| `npm run build` | Type-check the library packages and build the app bundle (`packages/app/dist`). The libraries are consumed from source, so only the app emits JavaScript. |
| `npm test` | Vitest across the workspace, including the round-trip contract |
| `npm run test:roundtrip` | The FR-4.1 golden-corpus suite alone |
| `npm run lint` | `tsc --noEmit` across all four packages |
| `npm run test:rust` | `cargo test` over the Rust host |
| `npm run tauri dev` | The desktop host: builds the Rust side and loads the app in WebView2 |
| `npx tauri build` | Release binary and NSIS installer under `src-tauri/target/release` |

**Continuous integration and releases.** `.github/workflows/ci.yml` type-checks and tests every push and pull request
on Windows (lint, Vitest, notices, app build, `cargo test`, clippy; plus `npm audit` and `cargo audit`).
`.github/workflows/release-please.yml` runs Release Please on every push to `master`: it maintains the release pull
request from Conventional Commits and, when that pull request is merged, tags `vX.Y.Z`, publishes the GitHub release and
writes its notes into `CHANGELOG.md`. `release-please-config.json` lists every version field it bumps (release type
`node`, plus the four package manifests, their `package-lock.json` entries, `tauri.conf.json`, `Cargo.toml` and the
`k-doc` entry in `Cargo.lock`); `.release-please-manifest.json` holds the current version. A second job then builds the
NSIS installer from the tag and uploads it to the release. The workspace packages depend on each other with `"*"`, so a
version bump never detaches npm's workspace links (a `^0.x` range stops matching at the next minor version).

---

## 9. Known Risks

| Risk | Mitigation |
| --- | --- |
| **Webview divergence (OQ-9).** ProseMirror sits directly on `contenteditable`, IME composition, and selection APIs, which differ across WebView2, WKWebView, and WebKitGTK. | **Partly answered.** A portable probe harness was run during development (since removed; the findings are recorded). Chromium 148 is green: 19 pass, 0 critical failures, and a live `isTrusted` `beforeinput` carrying one target range drives ProseMirror correctly. WKWebView and WebKitGTK are **not yet run** — they need macOS and Linux hosts. IME composition cannot be automated on any engine and is still outstanding. Findings and contingencies: [docs/internal/webview-parity.md](docs/internal/webview-parity.md). |
| **Incremental serialization is the hard part.** Getting "never reformat untouched regions" right is most of the project's difficulty. | Whole-document serialization ships first behind the final signature; the golden corpus grows to cover non-canonical input before the splicer replaces it. |
| **Two document models drift.** ProseMirror's schema and the mdast tree can disagree about what is representable. | The extension-triple rule (§7); any node the schema cannot express is carried opaquely rather than approximated. |
| **Whole-document serialization normalises insignificant whitespace, and does so gradually.** Found by the wild corpus: CommonMark treats up to three leading spaces on a paragraph continuation line as insignificant, and remark strips up to three per pass, so a five-space indent settles over three passes rather than one. | **Largely resolved.** `serializeIncremental` never re-emits an untouched region, so an unchanged save is byte-identical — now asserted against every document in the wild corpus, not just fixtures. The whole-document path retains the old behaviour and the wild suite still asserts *bounded convergence* on it, which catches a serializer that never settles. Residual exposure: an edit inside a block still re-emits that whole block, so non-canonical formatting **within the edited block** is normalised. That is the inline-granularity refinement. Lists, blockquotes and the blocks of an edited item are split down to the innermost changed block (§6bn, §6bv). |

---

## 10. Maintenance

Update this document whenever a source file is created, moved, or deleted; a module,
route, or external integration changes; a dependency is added or removed; or a data
flow shifts. Increment **Doc Version** by 1 and set **Last Updated** on every edit.
Do not update it for bug fixes, styling, or internal renames that preserve interfaces.
