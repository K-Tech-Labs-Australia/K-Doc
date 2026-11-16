# Changelog

All notable changes to K-Doc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The detailed development log from before the first public release is kept in
[docs/internal/development-log.md](docs/internal/development-log.md). From 0.1.0 on, each release's notes are
written by Release Please from the conventional commits merged since the last one.

## [0.5.0](https://github.com/K-Tech-Labs-Australia/K-Doc/compare/v0.4.0...v0.5.0) (2026-10-29)


### Features

* Draw Mermaid diagrams in the K-Doc view, HTML export and print ([#14](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/14)) ([baffbdc](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/baffbdc2b1cd509a23cc9754569fdc1093eb2e90))


### Bug Fixes

* **editor:** Draw Mermaid diagrams flat, with labels cut into their lines ([#16](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/16)) ([43d47f8](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/43d47f8e71eb638418a85252ac0752813c1678c5))

## [0.4.0](https://github.com/K-Tech-Labs-Australia/K-Doc/compare/v0.3.0...v0.4.0) (2026-10-15)


### Features

* Add a user guide, opened from Help &gt; User Guide (F1) ([#8](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/8)) ([5d4c445](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/5d4c445f7d010f2e1188e1eda5c3fe374f7de910))


### Bug Fixes

* Make the Input rules and Split orientation settings work, and remove dead code ([#10](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/10)) ([84c5047](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/84c5047c0d45e6ebc41e7c3f1a8a579335f330a2))
* Time out grammar checks and give every vault a .gitignore ([#11](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/11)) ([f829e08](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/f829e0851b86eb6319b3d29b3459932388416dbc))

## [0.3.0](https://github.com/K-Tech-Labs-Australia/K-Doc/compare/v0.2.0...v0.3.0) (2026-10-13)


### Features

* Rename the WYSIWYG view to K-Doc, remove the Preview view, and make the Default view setting work ([#5](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/5)) ([bf18d34](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/bf18d34aa3b0d3ee2e9545007c5ebafda16d952a))


### Bug Fixes

* Stop the status bar naming the view twice ([#7](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/7)) ([03e381d](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/03e381d61f41bae3fc725ad368c487246381165f))

## [0.2.0](https://github.com/K-Tech-Labs-Australia/K-Doc/compare/v0.1.0...v0.2.0) (2026-10-12)


### Features

* **app:** Open Markdown files from Windows and offer to be the default app ([#2](https://github.com/K-Tech-Labs-Australia/K-Doc/issues/2)) ([63f6b58](https://github.com/K-Tech-Labs-Australia/K-Doc/commit/63f6b587cfc89a8f1d2d2bb5566b7bbcfaba3dda))

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
- Saves write through a temporary file with an unpredictable name that is created exclusively, so a file or
  symlink planted beside a document can never receive the write. Text files larger than 64 MiB are refused.
- Pandoc exports run with `--sandbox`, `mailto:` links that ask the mail client to attach a file are refused, and
  the grammar service must use https unless it runs on this computer or the local network.
- Plugins cannot answer another plugin's request, patterns that could freeze rendering are refused, and network,
  storage and peer-connection APIs are removed from the plugin worker.
