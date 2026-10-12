# Changelog

All notable changes to K-Doc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The detailed development log from before the first public release is kept in
[docs/internal/development-log.md](docs/internal/development-log.md).

## [Unreleased]

### fix/ux-and-data

- **Open Vault Folder…** is now in File › Vault and the command palette (it was only reachable from the Files panel).
- Editing a paragraph with emphasis inside a word (`2*3*4`, `un*believ*able`) no longer writes character references.
- Moving or renaming a file updates every K-Doc window that has it open, so no window saves to the old path.
- A closed window's file watch is released immediately.

### feat/wysiwyg-footnotes

- Footnotes are edited in WYSIWYG: a reference shows as a superscript number and its note as editable text
  labelled with that number, where it sits in the file. Clicking a reference goes to its note; clicking the
  note's number goes back. Previously both showed as uneditable placeholders.
- Insert › Footnote (also on the ribbon beside Link) adds a reference at the caret with the next free number and
  its note at the end of the document, with the caret in the note.
- `npm test` allows each test 30 seconds, so a test starved of CPU on a busy CI runner is not reported as a failure.

### fix/security-hardening

- Saves write through a temporary file with an unpredictable name that is created exclusively, so a file or
  symlink planted beside a document can never receive the write.
- Pandoc exports run with `--sandbox`, so an EPUB cannot embed local files a document names.
- `mailto:` links that ask the mail client to attach a file are refused.
- The grammar service must use https unless it runs on this computer or the local network.
- Plugins: a plugin can no longer answer another plugin's request, the problems list is capped, patterns that could
  freeze rendering (nested quantifiers) are refused, and WebTransport, WebRTC and `navigator` are removed from the
  plugin worker.
- Text files larger than 64 MiB are refused rather than read whole.

## [0.1.0] - Initial public release

The first public release of K-Doc, a desktop Markdown word processor for Windows. The release date is set when
the version is tagged.

### Added

- **Editing:** WYSIWYG, Source, Split and Preview views of one document with a single shared undo history;
  Markdown input rules, a format painter, tables (sorting, CSV/HTML paste, column widths), callouts, footnotes,
  maths, task lists, wikilinks and embeds, block alignment, media embeds, snippets and autocorrect.
- **Fidelity:** the file stays plain Markdown, and anything you did not edit is written back byte for byte;
  encodings (UTF-8 with or without BOM, UTF-16) and line endings are preserved.
- **Documents and vaults:** tabs that can be dragged into their own window, a second pane, session restore,
  autosave, crash recovery, read-only locking, a vault file tree, quick open, vault-wide find and replace,
  backlinks, a link graph and note templates.
- **Review:** comments (portable or kept beside the file), track changes, compare documents, spell check in
  multiple languages, an optional LanguageTool-compatible grammar provider, readability and word statistics,
  linting with quick fixes, local version history and Git awareness (stage, commit, history).
- **Import and export:** DOCX, HTML and RTF import; HTML, DOCX and other Markdown flavours on export, plus LaTeX and
  EPUB through Pandoc; print with page setup.
- **Customisation:** six built-in UI themes in light and dark, user CSS themes, export themes, keyboard presets
  (Word, VS Code, Typora, Obsidian) with remapping, a customisable ribbon, and a sandboxed plugin API.

### Security

- Raw HTML in a document is sanitised before it is rendered, the app runs under a strict Content Security Policy,
  and the window cannot be navigated away from K-Doc's own pages.
- Printing renders in a sandboxed frame, and Git features never run a repository's `core.fsmonitor` command.
- File access is limited to what you chose: K-Doc's file commands only reach files and folders you opened,
  saved, dropped or picked, and a link to any other file asks for permission first.
- A document cannot make Windows send your credentials to another machine: images and media on network
  (UNC) paths are refused rather than opened.
