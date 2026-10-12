# K-Doc

K-Doc is a desktop Markdown editor from K-Tech Labs. It shows you the document, not the syntax: you write in a
word-processor-style view while the file on disk stays plain, portable Markdown, and anything you did not touch is
written back byte-for-byte. It is for people who want Word-like editing without giving up Markdown files and folders.

- **Four views of one document:** WYSIWYG, Source, Split (both side by side, with one shared undo history) and Preview.
- **Vaults:** open a folder of notes to get a file tree, quick open, find and replace across the vault, a link graph
  and templates.
- **Tabs:** several documents open at once, which you can drag out into a window of their own.
- **Review tools:** comments, track changes, spell check, optional grammar checking, statistics and version history
  (local snapshots).
- **Export:** HTML, Word (DOCX) and other Markdown flavours, plus LaTeX and EPUB when Pandoc is installed.
- **Make it yours:**
  - six built-in UI themes, each with a light and a dark version, plus CSS themes of your own
  - keyboard presets (Word, VS Code, Typora, Obsidian)
  - a ribbon you can rearrange
  - snippets, autocorrect and plugins

K-Doc runs on **Windows 10 and 11**. macOS and Linux are not supported yet.

How K-Doc works inside is described in [DESIGN.md](DESIGN.md). Release notes are in [CHANGELOG.md](CHANGELOG.md),
how to report a vulnerability is in [SECURITY.md](SECURITY.md), and how to contribute is in
[CONTRIBUTING.md](CONTRIBUTING.md).

**Contents:** [Quick start](#quick-start) · [Usage](#usage) · [Configuration](#configuration) ·
[Development and testing](#development-and-testing) · [Troubleshooting](#troubleshooting) · [Security](#security) · [License](#license)

## Quick start

### Install a release build

Download `K-Doc_<version>_x64-setup.exe` from the [Releases page](https://github.com/K-Tech-Labs-Australia/K-Doc/releases) and run it. It installs for your
Windows user only, so it needs no administrator rights. The installer is not code-signed yet, so Windows SmartScreen
may warn that the publisher is unknown; choose **More info**, then **Run anyway**. To make the installer yourself,
see [Build an installer](#build-an-installer).

### Run from source

Prerequisites:

| Tool | Version | Notes |
| --- | --- | --- |
| Windows | 10 or 11 | WebView2 is required; it ships with Windows 11. |
| Node.js | 22 or later | Required by `engines` in `package.json`. |
| Rust | stable, via [rustup](https://rustup.rs) | Builds the Tauri host in `src-tauri/`. |
| Pandoc | any recent | Optional; only for LaTeX and EPUB export. K-Doc finds it on your `PATH`. |

Clone the repository, install the workspace and start the desktop app:

```bash
git clone https://github.com/K-Tech-Labs-Australia/K-Doc.git
```

```bash
cd K-Doc
```

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run tauri dev` starts the Vite dev server on port 5173 and opens K-Doc in a desktop window. On Windows,
`start.cmd` does the same and also checks that Rust is installed; it reuses a dev server that is already running on
port 5173:

```bash
start.cmd dev
```

To run only the web front end in a browser, with no desktop host, start Vite on its own and open
`http://localhost:5173`:

```bash
npm run dev --workspace @k-doc/app
```

File access, vaults, version history and export to disk need the desktop host, so they are unavailable in the browser.

### Spell-check dictionaries

Dictionaries are not committed. Download the Hunspell dictionary for a language (British English by default) into
`packages/app/public/dictionaries/`:

```bash
npm run fetch-dictionary
```

```bash
npm run fetch-dictionary -- en-US
```

## Usage

### Everyday commands

Every command is in the menu bar and the command palette (**Ctrl+Shift+P**). These are the default shortcuts (the
Word preset); **View → Keyboard Shortcuts** lists them all and lets you change them.

| Action | Shortcut |
| --- | --- |
| New, Open, Save, Save As | Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S |
| Close document, Next document | Ctrl+W, Ctrl+Tab |
| Quick open a note in the vault | Ctrl+Shift+O |
| Find, Replace, Go to | Ctrl+F, Ctrl+H, Ctrl+G |
| Find in vault | Ctrl+Shift+F |
| Back, Forward | Alt+Left, Alt+Right |
| Command palette | Ctrl+Shift+P |
| Settings | Ctrl+, |
| New comment, Toggle track changes | Ctrl+Alt+M, Ctrl+Shift+E |
| Show or hide the sidebar, Cycle the ribbon | Ctrl+Shift+B, Ctrl+F1 |
| Zoom in, Zoom out, Reset zoom | Ctrl+Shift+>, Ctrl+Shift+<, Ctrl+0 |
| Print | Ctrl+P |

### Views and windows

- Switch between WYSIWYG, Split, Source and Preview with the buttons in the title bar or the **View** menu.
- Open documents appear as tabs below the ribbon once a second one is open. Drag a tab out of the strip to open it in
  its own window.
- **Another Document Beside This One…** in the **View** menu opens a second file next to the first.
- Focus, Typewriter, Zen and Presentation modes are under **View → Focus Mode**.

### Vaults

Open the **Files** panel in the left rail and choose a folder; that folder becomes the vault. You then get:

- the file tree and Quick Open (Ctrl+Shift+O)
- Find in Vault (Ctrl+Shift+F)
- the link graph (**File → Vault → Graph…**)
- templates: put Markdown files in `<vault>/.k-doc/templates/` and they are offered when you create a note

### Export

Use **File → Export**:

| Command | Output |
| --- | --- |
| Export as HTML | A standalone HTML page, with local images embedded |
| Export as Word Document | DOCX |
| Export as Markdown Flavour | The same document in another Markdown dialect |
| Export as LaTeX, Export as EPUB | Via Pandoc, which must be on your `PATH` |
| Export with a Plugin… | Any format a plugin provides |

**Export Theme** chooses the stylesheet used for HTML exports. **Open Export Themes Folder** is where you add your own.

### Themes

- The theme button in the title bar opens a menu with System, Light and Dark and six built-in themes: K-Doc, Nord,
  Solarized, Paper, Graphite and High Contrast. The same choice is under **Settings → Appearance**.
- To restyle the app yourself, use **View → Theme → Open App Themes Folder**. Edit the generated `custom.css` (it
  lists every colour token), then pick it with **View → Theme → App Theme**. A theme reloads as soon as you save it.

## Configuration

K-Doc has no environment variables. Everything is in the settings dialog (**Ctrl+,**), which writes
`settings.json` in K-Doc's application data folder (`%APPDATA%\au.ktechlabs.kdoc` on Windows). A malformed
or unknown value falls back to its default and is reported, and keys K-Doc does not recognise are kept.

| Setting | Default | What it does |
| --- | --- | --- |
| `general.restoreSessionOnLaunch` | `true` | Reopen the previous session's tabs at start-up |
| `general.confirmExternalLinks` | `true` | Ask before opening a web link |
| `general.trustedDomains` | `[]` | Domains whose links open without asking |
| `general.portableComments` | `false` | Keep comments in the Markdown file instead of beside it |
| `general.developerMode` | `false` | Show developer tools such as the Fidelity Check |
| `general.authorName` | `You` | Name stamped on comments and tracked changes |
| `general.attachmentsFolder` | `attachments` | Folder for pasted and dropped images |
| `general.attachmentNameTemplate` | `{name}-{date}` | File name for attachments; tokens `{name}` `{doc}` `{date}` `{time}` |
| `editor.defaultViewMode` | `wysiwyg` | `wysiwyg`, `source`, `split` or `preview` |
| `editor.splitOrientation` | `vertical` | `vertical` or `horizontal` |
| `editor.revealSyntaxMarkers` | `true` | Reveal Markdown syntax markers in the editor |
| `editor.smartSubstitutions` | `true` | Typographic substitutions while typing |
| `editor.inputRules` | `true` | Markdown shortcuts such as `# ` for a heading |
| `editor.autosave` | `idle` | `off`, `on-blur`, `interval` or `idle` |
| `editor.autosaveDelayMs` | `2000` | Autosave delay in milliseconds (200 to 60000) |
| `editor.allowHtmlFormatting` | `false` | Let K-Doc write HTML for formatting Markdown cannot express |
| `appearance.theme` | `system` | `light`, `dark` or `system` |
| `appearance.uiTheme` | `kdoc` | `kdoc`, `nord`, `solarized`, `paper`, `graphite` or `high-contrast` |
| `appearance.userTheme` | `""` | Name of your own CSS theme; empty for none |
| `appearance.editorFontFamily` | `Segoe UI` | Document font |
| `appearance.monospaceFontFamily` | `Cascadia Mono` | Code and Source view font |
| `appearance.editorFontSizePx` | `16` | Document font size, 8 to 72 |
| `appearance.lineHeight` | `1.6` | Line height, 1.0 to 3.0 |
| `appearance.readingWidth` | `medium` | `narrow`, `medium`, `wide` or `full` |
| `appearance.density` | `comfortable` | `compact`, `comfortable` or `spacious` |
| `appearance.ribbon` | `[]` | Your ribbon layout; empty for K-Doc's own |
| `proofing.spellCheck` | `true` | Underline misspellings |
| `proofing.language` | `en-GB` | Default spelling language |
| `proofing.detectLanguage` | `true` | Guess each document's language |
| `proofing.grammarEndpoint` | `""` | A LanguageTool-compatible URL; empty sends nothing anywhere |
| `keyboard.preset` | `word` | `word`, `vscode`, `typora` or `obsidian` |
| `keyboard.bindings` | `{}` | Your shortcut overrides, by command |
| `autocorrect.smartQuotes` | `true` | Curly quotes |
| `autocorrect.dashes` | `true` | `--` to an en or em dash |
| `autocorrect.ellipsis` | `true` | `...` to an ellipsis |
| `autocorrect.ordinals` | `false` | Superscript ordinals |
| `autocorrect.capitalizeSentences` | `false` | Capitalise the first letter of a sentence |
| `autocorrect.replaceText` | `true` | Apply the replacement table |
| `snippets.enabled` | `true` | Expand a snippet prefix with Tab in WYSIWYG |
| `history.snapshotOnSave` | `true` | Take a version-history snapshot on every save |
| `history.snapshotMinutes` | `10` | Also snapshot an open, saved document every N minutes; `0` for never |
| `history.keepAllHours` | `24` | Keep every snapshot this many hours |
| `history.keepHourlyDays` | `7` | Then keep one per hour for this many days |
| `history.keepDailyDays` | `90` | Then keep one per day for this many days |
| `export.comments` | `exclude` | `exclude`, `endnotes` or `margin-notes` |
| `export.theme` | `default` | Stylesheet for HTML export |

Folders K-Doc reads, under the same application data folder:

| Folder | Holds |
| --- | --- |
| `themes` | Your app themes (`.css`) |
| `export-themes` | Your export themes (`.css`) |
| `plugins` | Plugins; **Reload Plugins** picks up changes |

## Development and testing

The repository is an npm workspace. The four TypeScript packages are `packages/core`, `packages/config`,
`packages/editor` and `packages/app`, and `src-tauri/` holds the Rust host. [DESIGN.md](DESIGN.md) describes how
they fit together.

| Command | What it does |
| --- | --- |
| `npm test` | Vitest across every package and the scripts (`vitest run packages scripts`) |
| `npm run test:roundtrip` | The Markdown round-trip contract suite alone |
| `npm run test:rust` | `cargo test` for the Rust host |
| `npm run lint` | `tsc --noEmit` across all four packages |
| `npm run build` | Build every package |
| `npm run notices` | Regenerate `packages/app/public/THIRD-PARTY-NOTICES.txt` from the shipped npm packages, Rust crates and dictionaries |
| `npm run typecheck --workspace @k-doc/app` | Type-check the app package alone |
| `start.cmd test` | `npm test`, then `npm run test:rust` |

```bash
npm test
```

```bash
npm run lint
```

How to propose a change (branches, commit messages, tests, the commenting convention) is in
[CONTRIBUTING.md](CONTRIBUTING.md). Continuous integration runs the type-check, both test suites, clippy and a
dependency audit on every pull request.

### Build an installer

```bash
npm run tauri build
```

This regenerates the third-party notices (`npm run notices`), rebuilds the front end, compiles the host in release mode
and writes a per-user NSIS installer to `src-tauri/target/release/bundle/nsis/`. `start.cmd build` does the same.
The installer puts `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.txt` next to the program. Fetch the dictionaries
(`npm run fetch-dictionary`) before building, so their licences are included.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `start.cmd` says Rust is missing | `cargo` is not on `PATH` | Install Rust from [rustup.rs](https://rustup.rs) and open a new terminal |
| Spell check underlines nothing, or the status bar says there is no dictionary | The dictionary was never downloaded | Run `npm run fetch-dictionary`, adding `-- <lang>` for another language |
| Export as LaTeX or EPUB is unavailable | Pandoc is not on `PATH` | Install Pandoc and restart K-Doc |
| Opening files or a vault does nothing in the browser | The browser build has no desktop host | Run the desktop app with `npm run tauri dev` |
| `npm run tauri dev` fails because port 5173 is in use | Another dev server is running | Stop it, or use `start.cmd dev`, which attaches to K-Doc's own server |

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md), which also explains what K-Doc
trusts: documents are untrusted (their raw HTML is sanitised before it is shown), while plugins, themes and the
repositories you use the Git features in are trusted code.

## License

K-Doc is licensed under the [Apache License, Version 2.0](LICENSE). © 2026 K-Tech Labs.

The license does not cover the K-Tech and K-Doc names or logos, which are trademarks of K-Tech Labs. Bundled
third-party components (fonts, the spell-check dictionary and dependencies) keep their own licenses, listed in
[NOTICE](NOTICE). Their full licence texts are in `THIRD-PARTY-NOTICES.txt` in the install folder and under
**Help → About K-Doc → Third-party notices**.
