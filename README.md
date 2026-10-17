# K-Doc

K-Doc is a desktop Markdown editor from K-Tech Labs. It shows you the document, not the syntax: you write in a
word-processor-style view while the file on disk stays plain, portable Markdown, and anything you did not touch is
written back byte-for-byte. It is for people who want Word-like editing without giving up Markdown files and folders.

- **Three views of one document:** K-Doc (the formatted document, which you edit directly), Source (the Markdown) and
  Split (both side by side, with one shared undo history).
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
Windows user only, so it needs no administrator rights. To make the installer yourself, see
[Build an installer](#build-an-installer).

**K-Doc is not code-signed, and there are no plans to sign it.** Windows SmartScreen may therefore say the publisher
is unknown when you run the installer; choose **More info**, then **Run anyway**. To check that the file you downloaded
is the one the release built, compare its SHA-256 checksum with the one printed in that release's notes. In
PowerShell, in the folder you saved it to:

```powershell
Get-FileHash .\K-Doc_<version>_x64-setup.exe
```

Every installer is built from the tagged source by the project's release workflow
(`.github/workflows/release-please.yml`), so you can also build the same installer yourself.

The installer registers K-Doc for Markdown files (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn`), so it appears
under **Open with**. The first time you install, it asks whether to make K-Doc the default app for them; answering
**Yes** opens Windows' Default apps settings for K-Doc, where you confirm (Windows lets only you change a default). You
can do this later with **Tools → Make K-Doc the Default for Markdown…**.

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

The [user guide](docs/guide/index.md) explains how to do everything in K-Doc. Inside the app, open it with
**Help → User Guide** or `F1`. A short tour:

- **Commands:** every command is in the menu bar and the command palette (`Ctrl+Shift+P`).
  **Help → Keyboard Shortcuts** lists the shortcuts and lets you change them. See
  [Keyboard shortcuts](docs/guide/keyboard-shortcuts.md).
- **Views and windows:** switch between K-Doc, Split and Source with the title-bar buttons or `Ctrl+/`. Several
  documents open as tabs, and you can drag a tab out into its own window. Double-clicking a Markdown file opens it in
  the K-Doc window you used last. See [Getting started](docs/guide/getting-started.md).
- **Writing:** format from the ribbon, the menus or by typing Markdown; tables, footnotes, callouts, snippets and
  autocorrect are built in. See [Writing and formatting](docs/guide/writing-and-formatting.md).
- **Reviewing:** comments, track changes, spelling and grammar, statistics and version history. See
  [Reviewing documents](docs/guide/reviewing.md).
- **Vaults:** **File → Vault → Open Vault Folder…** turns a folder of notes into a vault with a file tree, quick
  open, search, backlinks, tags and a link graph. See [Working with a vault](docs/guide/vaults.md).
- **Export and print:** **File → Export** writes HTML, Word and other formats; you can also print and present. See
  [Export, print and present](docs/guide/export-and-print.md).
- **Customising:** themes, keyboard presets, the ribbon and plugins. See
  [Customising K-Doc](docs/guide/customising.md).

## Configuration

K-Doc has no environment variables. Everything is in the settings dialog (**Ctrl+,**), which writes
`settings.json` in K-Doc's application data folder (`%APPDATA%\au.ktechlabs.kdoc` on Windows). A malformed
or unknown value falls back to its default and is reported, and keys K-Doc does not recognise are kept.

Every setting, with its allowed values and default, is described in the
[Settings reference](docs/guide/settings-reference.md).

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
