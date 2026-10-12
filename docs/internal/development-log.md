# Changelog

All notable changes to K-Doc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### fix/git-untrusted-repo

- **Security: opening Version History in a downloaded repository no longer runs that repository's
  `core.fsmonitor` command.** Every git call passes `-c core.fsmonitor=false` and `GIT_TERMINAL_PROMPT=0`;
  committing still runs the repository's hooks, as `git commit` does.

### fix/unsaved-work-safety

- **Closing the window asks about unsaved work.** The title-bar button, Alt+F4 and the taskbar now go
  through `shell/close-guard.ts`: each document with unsaved changes is shown and asked Save / Don't Save /
  Cancel, and a cancelled or failed save keeps the window open. Previously the window closed at once.
- **Save in the close-tab prompt waits for the write.** `FileMenu.save()`/`saveAs()` resolve whether the
  document was written; a failed save or a cancelled Save As no longer closes the tab and loses the work.
- **Text typed during a save is no longer marked saved** (`DocumentSession.markSaved(written)`).
- **Crash recovery is per document.** Every tab journals under its own id, so saving or closing one tab
  no longer deletes another's journal; recovery offers each journal separately and restores it into its
  own file's tab (or a new untitled document) instead of whichever tab was in front.
- **A dragged-out untitled tab is no longer lost**: a window opened on a handed-over document skips
  session restore and recovery.
- **File watching is per window**, so a second window no longer silently stops the first from noticing
  external edits; K-Doc's own save no longer raises a "changed on disk" conflict when you keep typing.
- Adding the first comment no longer reverts text typed while the annotation store was writing.

### fix/untrusted-document-scripts

- **Security: a document can no longer run script.** Raw HTML in rendered output (Presentation, the
  track-changes Original view, Print, HTML export) now passes through an allow-list
  (`core/src/render/sanitize.ts`, `rehype-sanitize`): scripts, event handlers, `javascript:` links,
  foreign iframes, forms, `<base>`, `<meta>` and `<style>` are removed, while formatting, alignment, image
  widths, footnotes and the YouTube/Vimeo players survive. The document file itself is unchanged.
- **Security: a real Content Security Policy** (`script-src 'self'`, no inline script or `eval`) replaces
  `"csp": null`, and a new `navigation-guard` plugin (`src-tauri/src/navigation.rs`) refuses any
  navigation away from the app's own pages.
- **Security: Print renders in a sandboxed iframe** without `allow-scripts`, and theme CSS can no longer
  close its `<style>` element.
- Links clicked in Presentation and the Original view open through the app's own link handling
  (`shell/rendered-links.ts`) instead of navigating the window.

### chore/licence-overrides

- **Every shipped component now carries its licence text.** The 16 packages that include no licence file
  (webview2-com and friends, alloc-stdlib, the unic crates, defmt-parser, selectors, hash.js, isarray, format,
  remark-math, dingbat-to-unicode) get theirs from `scripts/licence-overrides/`, copied from upstream with sources
  recorded. `npm run notices`, and so the release build, now fails if a shipped component has no licence text.

### chore/third-party-notices

- **Third-party licence texts ship with K-Doc.** The new `npm run notices` generates `THIRD-PARTY-NOTICES.txt` from the
  npm packages, Rust crates and dictionaries that are actually bundled, printing each licence text once. It runs
  before every release build. The installer places it, with `LICENSE` and `NOTICE`, beside the program.
- **Help → About K-Doc → Third-party notices** shows the same text inside the app.
- `npm run fetch-dictionary` now also downloads each dictionary's licence. `npm test` now covers `scripts/`.

### chore/license

- **K-Doc is licensed under Apache-2.0.** Adds `LICENSE` (canonical text) and `NOTICE` (copyright, a trademark
  note for the K-Tech and K-Doc marks, and attributions for bundled fonts, the dictionary and MPL-2.0 crates). Sets
  `license` in every `package.json` and in `Cargo.toml`, and updates the README's License section.

### chore/readme

- **README.md** covers installing K-Doc, running it from source, everyday commands, vaults, export and themes, every
  setting with its default, the test and build commands, and troubleshooting. It links to DESIGN.md for internals
  rather than repeating it.

### feat/ktech-branding

- **K-Tech branding.** The title bar shows the K-Doc wordmark: the K-Tech sliced-K mark replaces the K, then "-Doc" in
  Sansation Bold, which is now bundled as `@fontsource/sansation`. The mark's geometry is copied verbatim from the
  K-Tech Branding repo and follows the theme's text colour.
- **New app icon:** the light mark on a flat ink tile, generated for every desktop size with `tauri icon`.
- **Help → About K-Doc:** a new dialog with the wordmark, the version (read from the host), and the K-Tech stacked
  lockup with the slogan and credit.
- **Installer artwork:** the NSIS installer gains a branded header, sidebar and icon, and the bundle now names K-Tech
  Labs as publisher.
- **Favicon:** the web build gets an SVG favicon.

### fix/format-painter-element-from-point

- **The full test suite exits clean again.** `format-painter.test.ts` stubs `document.elementFromPoint`, which jsdom
  lacks. ProseMirror's mousedown handler calls it, and it threw 4 unhandled errors that made `vitest` exit non-zero
  even though every test passed.

### feat/ui-themes

- **Six built-in UI themes.** K-Doc, Nord, Solarized, Paper, Graphite and High Contrast each come in a light and a
  dark version, so System/Light/Dark still applies. Every version passes the same WCAG AA contrast checks as
  K-Doc's own palette. The choice is the new `appearance.uiTheme` setting (default `kdoc`), and a theme of your own
  CSS still goes on top.
- **The title-bar theme button opens a theme menu.** The menu has a System/Light/Dark row and the theme list with
  colour swatches, and works with the keyboard (arrows, Home/End, Escape). Settings → Appearance gains a matching
  *Colour theme* select.
- **The light/dark choice is now saved.** The old button cycled the mode without saving it. The *Toggle Theme*
  command still cycles, and now saves too.

### feat/discrete-tabs

- **Document tabs moved below the ribbon and restyled as a discrete strip.** The strip is now 26px of flat,
  muted text tabs separated by hairlines. The active tab is marked by a 2px accent underline, and its close
  button only appears on hover, on focus or on the active tab. It still hides while only one document is open.

### chore/release-build

- **`npm run tauri build` now produces an installer.** Bundling was switched off, so a release build
  gave only a bare executable, and with no `beforeBuildCommand` it shipped whatever stale frontend
  happened to be in `packages/app/dist`. The build now rebuilds the frontend first and bundles a
  per-user NSIS installer (no admin rights, a Start-menu entry, an uninstaller) from the existing
  `icons/icon.ico`. MSI was left out because it needs WiX and an elevated install.
- The identifier stays `tech.k-labs.kdoc.spike`, so an installed copy shares its settings and
  session with development builds; changing it would move the app-data folder.

### fix/submenu-hover-status-toggle

- **Submenus stay open.** Every editor transaction refreshed the menu bar, which tore down and rebuilt an
  open menu; the pointer then re-entered the parent item and reopened the submenu, so it flashed and never
  stayed. `refresh()` now redraws only when something the open menu draws has changed.
- **Collapsible status bar.** A chevron at the right end of the status bar hides it, and View > Panels >
  Status Bar (also in the command palette) shows it again. The choice survives relaunches
  (`kdoc.statusbar.v1`). Hiding it also hides the breadcrumb and saved indicator it carries.

### fix/fit-window-collapsible-ribbon

- **No more page scrollbar.** The page kept the browser's default 8px body margin around a shell sized to
  the full window, so it was 16px taller than the window. `html` and `body` now have no margin, fill the
  window exactly and never scroll; the panes, panels and dialogs scroll themselves.
- **The ribbon can be hidden from the top bar.** A chevron button beside the theme toggle hides or shows
  the whole ribbon row (Ctrl+F1 still cycles expanded / collapsed / hidden, and the button follows it).
  The choice is remembered across launches (new `shell/ribbon-preference.ts`, localStorage key
  `kdoc.ribbon.v1`). Hiding it moves the document up a further 44px at 1440x900.
- **Tests:** 4,537 passing across 288 files (14 new for the ribbon preference).

### fix/slim-sidebars

- **Slimmer side panels.** Both rails are icon-only at 48px (was 74px with a label under each icon; the
  labels stay as tooltips and for assistive technology), the open panel card is 240px (was 280px), and
  the gutters are 6px (was 12px). At 1440px the document now starts at 320px with the Outline open
  (was 394px) and at 74px with only the rails (was about 106px); the right side reserves 58px (was 90px).

### feat/frameless-compact-chrome

- **The desktop window is frameless.** No Windows title bar or native menu strip: K-Doc's own top bar is
  the title bar (drag to move, double-click to maximise) with minimise, maximise/restore and close at
  its right end (new `shell/window-controls.ts`), and the window starts maximised. Dragged-out document
  windows match. Any native menu left by an earlier build is cleared at startup.
- **Much more room for the document.** Open/Save/Save As left the top bar (they are in the File menu);
  the Vault menu is now a File submenu; Outline and Sync Scroll left the top bar (the rail and View >
  Panels > Sync Scroll, a new command, do those jobs, and both show ticks); the ribbon is a single row
  with its tabs inline; the breadcrumb moved into the status bar; the status bar is 28px; and the left
  panel starts collapsed to its rail. The document starts about 110px higher at 1440x900.
- **Tests:** 4,523 passing across 287 files (11 new for the window controls); Rust 242 passing.

### fix/panels-reserve-space

- **An open side panel no longer covers the document.** New `shell/pane-reserve.ts` measures how far
  each floating sidebar reaches into the panes and pads them by that much (CSS custom properties
  `--kdoc-pane-reserve-left/-right`), re-measured by a `ResizeObserver` as panels open, collapse to
  the rail, switch, or the window resizes; Zen mode reserves nothing. The panels still float as cards.
- **Split dragging measures the padded content area**, so dragging the divider to the middle of the
  two panes still gives 50/50.
- **Tests:** 4,512 passing across 286 files (13 new for the reserve).

### fix/material-secondary-dialogs

- **The remaining 44 stylesheets follow Material 3 Expressive.** Every dialog, popover, side panel and
  toolbar that PR #152 had only recoloured now has Material shapes too: opaque dialogs with a large
  radius and Material shadow, popovers with a lighter shadow, outlined pill buttons with a filled
  primary action, outlined fields, the tonal selection fill for selected rows and options, filled
  pressed toggles, the 8% hover layer, 3px focus rings, and headline-size dialog headings. All
  blurred-glass declarations, their `@supports` fallbacks, light-catch shadows and glows are gone.
- **Shared dialog classes have one definition.** `.kdoc-dialog-button` (and its variants),
  `.kdoc-dialog-heading` and `.kdoc-dialog-actions` were defined differently in up to ten dialog
  stylesheets that share one `<style>` element, so whichever loaded last won; the confirm dialog's Save
  button lost its fill this way. Every copy is now identical and the variants are written as
  `.kdoc-dialog-button.<variant>` so they outrank the base rule.
- **Quote bars are visible again** in comment cards and the styles gallery (they used the now
  transparent highlight token).
- **Tests:** 4,499 passing across 285 files.

### feat/avimorphism-ui

- **The chrome is now Material 3 Expressive, replacing the Avimorphism styling below before it
  shipped.** Per-theme tonal palettes (`LIGHT_CHROME`, `DARK_CHROME`) built from a full-chroma blue
  primary with an orange tertiary replace the theme-independent dark cockpit palette, so the chrome
  now follows the light/dark theme. Token names are unchanged; the glass tokens carry opaque tonal
  surfaces with a 0px blur, and new roles cover the 3:1 control outline, the tonal selection pair and
  the tertiary accent. Status colours, the radius scale (8/12/16/28) and the elevation shadows moved
  to Material values. Verified at WCAG 2.2 AA: body text at least 9.5:1, outlines at least 3.7:1.
- **Shapes change with state.** Toolbar toggles turn from round outlined pills into squarer filled
  ones when pressed; the view switcher is a segmented button with a tick; ribbon tabs carry an
  indicator bar; menus, the outline and pickers use a tonal selection pill.
- **Line icons replace the emoji glyphs.** New `shell/icons.ts`; both sidebar rails are Material
  navigation rails with visible labels under each icon, and the ribbon's formatting, alignment and
  list commands are icon buttons in connected groups with visible group captions.
- **Boolean settings are switches** (checkbox with `role="switch"` and a tick handle).
- **Roboto Flex is bundled** (`@fontsource-variable/roboto-flex`) as the chrome typeface, with Segoe UI
  as the fallback.
- **Tests:** 4,499 passing across 285 files; new tests pin the labelled rail item, the icon ribbon
  buttons and group captions, and the settings switch.

- **The chrome is now an Avimorphism instrument panel.** A matte base lit from a single top-left
  source, controls that are extruded at rest and depress with a coupled emissive glow when active,
  and the five aviation status colours reserved strictly for state. The document page keeps its
  themed light/dark colours: the cockpit is the frame around it, not the paper.
- **New chrome token layer** in `@k-doc/config`: `chrome`, `emissive` and `radius` groups beside the
  existing page colours, emitted as `--kdoc-chrome-*`, `--kdoc-emissive-*` and `--kdoc-radius-*`,
  plus derived `--kdoc-elevation-raised` / `--kdoc-elevation-sunken` shadows. Purely additive, so
  existing user themes keep working. The chrome tokens are identical in both themes by design.
- **An in-app menu bar (`app-menu-bar.ts`)** with ten menus - File, Edit, Insert, Format, Table,
  View, Review, Vault, Tools, Help - over the command registry, with submenus, check-marked toggles,
  shortcut hints, Alt access keys and full keyboard navigation. A test enumerates the registry
  against the spec and fails if any command is unplaced or placed twice. It sits beside the existing
  native OS menu (FR-14.8), which is untouched.
- **The ribbon became the fast path** rather than a second menu: Home carries the text and paragraph
  shortcuts, with Insert, Review and View beside it, and a contextual Table tab that appears only
  while the caret is in a table.
- **Panels float over the document instead of shrinking it.** Both sidebars leave the flex row for
  dark aero-glass cards with a blurred backdrop and a light-catch edge; the gutter passes clicks
  through to the document beneath. Mounting, visibility and scroll retention are unchanged.
- **Square corners are nearly gone.** Every hard-coded 2-8px radius across the restyled components
  became a radius token, and every previously square surface gained one.
- **Fixed: the editor stayed half-width after leaving Split view.** The split divider sizes the panes
  with an inline `style.flex` that `setViewMode` never cleared, so switching to WYSIWYG, Source or
  Preview left the surviving pane at flex 0.5 with dead space beside it. Leaving Split now clears
  the inline sizing, and returning to it restores the divider's remembered ratio. A second document
  opened beside is deliberately left alone.
- Full suite green at each step: 4494 tests over 285 files, `tsc` clean across all four packages.
- **The menu bar is mounted as the first chrome row**, and three things it made redundant went with
  it: the native OS menu is no longer installed (FR-14.8 is now met by the in-app bar; the native
  adapter stays in the tree, unreferenced), and the standalone format and table toolbar rows are
  gone, their caret-in-table signal now driving the ribbon's contextual Table tab. Two chrome rows
  of height went back to the document.
- **The editor panes are floating cards**: rounded, lifted off the matte base by a shadow, with a
  gutter of base showing around and between them, so Split view reads as two documents side by side.
  The page keeps its themed colours — the cockpit is the frame, not the paper.
- **Every dialog, panel and picker is restyled** — 19 dialogs and 21 panels and overlays — as glass
  or matte panel with physical controls, sunken inputs, flat data readouts and tokenised corners.
- Three defects were caught in review rather than shipped: the contextual Table tab leaked table
  commands into the ribbon outside a table, a pane was given `overflow: hidden` although it is the
  document's own scroll container, and the restyle introduced 91 raw `rgba()` literals that broke
  the repo's tokens-only invariant, along with one invented `--kdoc-radius-xs` that silently left a
  square corner behind.

### chore/rename-k-doc

- **The app is now called K-Doc.** The rename runs the whole way down: visible text and window
  title, every `Kmd*` type and `kmd*` identifier, the `kmd-` CSS class and `--kmd-` custom-property
  prefixes, DOM ids, the npm scope (`@k-md/*` -> `@k-doc/*`), the crate name, and prose throughout
  the documentation.
- **This is a clean break with no backward compatibility.** Four names that are written to disk or
  relied on by third-party code changed with no fallback read:
  - the front-matter identity field `kmd_id` is now `kdoc_id`;
  - the store folder walked up for, like `.git`, is now `.k-doc/` rather than `.k-md/`;
  - the plugin API global is now `kdoc`, so `kmd.command(...)` becomes `kdoc.command(...)`;
  - the Tauri identifier is now `tech.k-labs.kdoc.spike`, which moves the app-data directory.
  A document, vault, plugin or settings file from a K-MD build is therefore not read by K-Doc:
  documents lose their identity and their comments, vaults are not discovered, plugins do not load,
  and settings and session start empty.
- No behaviour changed. The full suite passes unaltered: 4465 Vitest tests over 283 files and
  242 Rust tests.

### feat/second-document

- **Two documents side by side (FR-6.9).** `View -> Another Document Beside This One…` opens another file
  in the second pane, with its own session, and **Second Pane on This Document** still opens a second view
  of the one you are editing.
  - A strip above the pane names the file, says **Edited** when it holds unsaved changes or **Read-only**
    when the file will not take a write, and carries Save and Close.
  - **Ctrl+S saves what you are looking at**: the document in the second pane when your caret is in it,
    and the open document otherwise.
  - A read-only file opens beside and cannot be edited. A lock on the document you are editing no longer
    refuses writes to a different file shown beside it.
  - The second document stays put when you switch tabs.
- 18 new tests (10 for the document, 8 for the strip). Mutation testing: 21 mutants over two passes, every
  one killed. A duplicate record of what was on disk was deleted after a mutant proved the two copies
  could hide each other's failure.
### feat/wiki-embeds

- **Wiki image embeds are pictures, and pictures resize from the keyboard (FR-8.15).**
  - `![[img.png]]` and `![[img.png|600]]` are now drawn as pictures in the WYSIWYG pane, selectable and
    resizable like any other, and written back as exactly the text they were read from. An embed of
    something that is not a picture, such as `![[Some Note]]`, stays the words you wrote.
  - Embedded pictures are drawn in exports and printouts too, with their width, and a standalone export
    embeds them as data URIs like any other local picture.
  - **Alt+Shift+Right** and **Alt+Shift+Left** widen and narrow the selected picture by a tenth, working
    from the size it is drawn at when it has never been resized. **Widen Image**, **Narrow Image** and
    **Reset Image Size** are in the command palette and on the picture's context menu.
  - Editing a wiki embed's address keeps it a wiki embed. Giving it alt text or a caption, which the
    syntax cannot hold, turns it into an ordinary Markdown image rather than discarding what you typed.
- 40 new tests (25 for the embed reader and what it renders, 7 for the round trip through the editor, 8
  for keyboard resizing and the dialog). Mutation testing: 31 mutants over three passes, all killed but
  two documented in the source as equivalent; two pieces of dead code were deleted, a "step by at least
  one pixel" floor the clamp already covered and an empty-text guard the splitter can never reach.
### feat/indent-commands

- **Indent and Outdent outside a list (FR-20.2).** `Ctrl+M` and `Ctrl+Shift+M`, with `Ctrl+]` and `Ctrl+[`
  as aliases, now indent and outdent whatever the caret is in. Both are also in the ribbon's **Paragraph**
  group and in the command palette under Format.
  - Inside a list they nest and lift the item, exactly as Tab and Shift+Tab do, and an item that cannot
    nest does nothing rather than becoming a quote inside a list item.
  - Outside a list they add and remove one level of blockquote, which is the only indentation Markdown
    has: leading spaces make a code block, not an indented paragraph.
  - Both are remappable and appear in the Keyboard Shortcuts dialog.
- 12 new tests (11 for the two commands, 1 for the bindings and their aliases). Mutation testing: 16
  mutants over three passes, all killed but one documented in the source as equivalent; a blockquote guard
  in the outdent path was deleted after a mutant proved nothing could reach it.
### feat/plugin-api

- **Plugins (FR-14.18).** A folder under the app's `plugins` directory holding a `plugin.json` and a
  `main.js` can add commands, its own inline syntax, a panel and an export format.
  - Each plugin runs in a Web Worker of its own with no DOM, no filesystem and, because K-Doc takes them
    away before the plugin's code runs, no way out to the network. It is given the document's text and
    nothing else.
  - Everything a plugin says is checked before K-Doc acts on it, and a plugin that will not answer within
    four seconds is stopped and stops being offered.
  - A plugin's syntax is drawn in exports and printouts and never written: what it recognises serialises
    back as exactly the text it was recognised from, so a plugin cannot change your file by reading it.
  - The **Plugins** panel lists what loaded, what each one added, and why any that would not load failed.
    **Export with a Plugin…** writes the document out in a format a plugin added.
- 93 new tests (30 for the manifest, 28 for the protocol, 16 for the sandbox run as a real script, 14 for
  the syntax, 13 for the panel) and 9 Rust tests for reading the folder. Mutation testing: 65 TypeScript
  mutants over two passes and 13 Rust ones, all killed but seven documented in the source as equivalent;
  one redundant guard was deleted.
### feat/graph-view

- **A graph of your vault (FR-6.15).** **Graph** draws every note as a circle and every link as a line.
  - A note is drawn bigger the more notes it is joined to, and a link thicker the more often it is written.
    The note you are reading is picked out, and clicking any note opens it.
  - **Around this note** narrows the picture to the note on screen and what it names.
  - The layout is worked out the same way every time, so reopening the graph does not shuffle it.
- 50 new tests (25 for building the graph and its shapes, 9 for the layout, 16 for the window). Mutation
  testing: 63 mutants over three passes, all killed but two documented in the source as equivalent; two
  guards were deleted for saying nothing the code did not already say.
### feat/custom-ribbon

- **A ribbon of your own (FR-14.17).** **Customise Ribbon** opens a dialog in which you reorder and remove
  the buttons on each ribbon tab, reorder the groups, and add any command K-Doc has.
  - Your arrangement is kept in your settings and drawn on every launch. **Use K-Doc's ribbon** puts it back.
  - An arrangement written by a newer build still draws: a tab, group or command this build has not got is
    left out rather than refusing the arrangement, and a command it cannot draw is shown by its id in the
    dialog so you can remove it. If nothing in an arrangement survives, K-Doc draws its own ribbon.
- 67 new tests (16 for reading the setting, 36 for resolving and editing an arrangement, 15 for the dialog),
  plus four for the ribbon drawing a layout it is given. Mutation testing: 63 mutants across two passes, all
  killed but two documented in the source as equivalent; three guards were deleted for saying nothing the
  code did not already say.
### feat/pandoc-export

- **LaTeX and EPUB export (FR-13.7).** **Export as LaTeX** and **Export as EPUB** hand the document to Pandoc when
  it is on your PATH.
  - K-Doc asks Pandoc for its version first, so a machine without it is told plainly instead of being walked
    through a save dialog for a file that cannot be written. K-Doc does not install Pandoc.
  - The document goes to Pandoc over a pipe, never through a shell and never through a temporary file, and both
    the format and the output path are checked before the program is launched.
- 18 new tests (12 TypeScript, 6 Rust — one of which converts a real document when Pandoc is installed and
  reports nothing when it is not). Mutation testing: 18 mutants, all killed.
### feat/media-embeds

- **Video and audio (FR-8.17).** A paragraph that is nothing but a link or image naming a media file plays in the
  editor, and so does a link to YouTube or Vimeo.
  - The file keeps the link you wrote: K-Doc adds no syntax, and writes the reference back exactly as it found it.
  - A provider shows a card with a **Play** button, and nothing is fetched from the site until you press it; the
    embed then loads from the no-cookie host.
  - Exports and printouts carry a real `<video>`, `<audio>` or provider frame.
  - Local clips are read by the desktop app, capped at 64 MiB.
- 39 new tests (20 core, 7 editor, 12 Rust). Mutation testing: 33 mutants, all killed.
### feat/block-alignment

- **Alignment (FR-8.11).** **Align Left**, **Align Centre**, **Align Right** and **Remove Alignment** in the
  command palette set the alignment of every paragraph and heading the selection covers.
  - Markdown cannot express alignment, so K-Doc writes an HTML wrapper — and only once you turn on
    **Settings → Editor → Allow HTML formatting**, which is off by default. Until then the commands say so and
    write nothing.
  - An aligned block stays an ordinary editable block, keeps its inline formatting, and is centred in the
    Preview pane and in exports too.
  - A wrapper K-Doc does not understand — one holding several blocks, or naming something other than left, centre
    or right — is left exactly as you wrote it.
- **Fixed:** clearing a block's alignment left the `<div>` lines behind in the file, because the wrapper's source
  range belonged to nothing once the block had absorbed it.
- 32 new tests (22 core, 10 editor). Mutation testing: 27 mutants, all killed.
### feat/attachments

- **Attachments (FR-6.14).** An image you paste or drag into a note is written into an attachments folder beside
  it, and the note refers to it by a relative path, so the two travel together.
  - **Settings → General** names the folder (`attachments` by default) and the template an attachment is named by
    (`{name}-{date}`, with `{name}`, `{doc}`, `{date}` and `{time}` to choose from). The extension always comes from
    the file.
  - Nothing is overwritten: a name already taken gets a number, and the name actually used is what the note says.
  - A dropped image already in the folder is referred to where it is, rather than copied again.
  - **Unused Attachments Report** opens a document listing the files in that folder that no note refers to.
- 44 new tests (30 TypeScript, 14 Rust). Mutation testing: 49 mutants, 48 killed, 1 survivor kept with a comment.
### feat/user-themes

- **User themes (FR-14.10).** The app can wear a stylesheet you wrote: **View → App Theme** offers the `.css` files
  in the themes folder, and **View → Open App Themes Folder** opens it.
  - A theme is reloaded as soon as you save it, so you can write one with K-Doc open.
  - The first time you open the folder, K-Doc writes `custom.css` into it: every colour it paints with, at its own
    values, for light and dark. That file is the contract, and an untouched copy looks exactly like K-Doc.
  - Your rules come last, so they win without `!important`.
- Export themes and app themes are now served by one Rust module, which takes the *kind* of theme and decides the
  folder itself.
- 12 new tests (11 TypeScript, 1 Rust). Mutation testing: 19 mutants, all killed.
### feat/export-themes

- **Export themes (FR-13.8).** The stylesheet an HTML export or printout uses is now a choice.
  - **File → Export Theme** offers four themes K-Doc ships (default, serif, compact and plain, which is no styling at
    all) and any `.css` file in the export themes folder.
  - **File → Open Export Themes Folder** opens that folder, putting a copy of the default stylesheet in it the first
    time so there is something to edit.
  - A theme of yours replaces one of K-Doc's with the same name. Printing keeps its page setup whatever the theme says.
- 28 new tests (21 TypeScript, 7 Rust). Mutation testing: 26 mutants, 25 killed; the survivor is a sort that Windows
  makes unobservable and that keeps the theme list stable on other systems.
### feat/markdown-flavours

- **Export to Markdown flavours (FR-13.6).** **File → Export as Markdown Flavour** writes the document as strict
  CommonMark, GitHub Flavored Markdown, or vault-portable Markdown, and says what it changed.
  - CommonMark: tables, footnotes, strikethrough, highlights and sub/superscript become HTML, checkboxes text, maths
    code, and front matter an HTML comment. GFM: only K-Doc's own syntax is rewritten.
  - Vault-portable: wikilinks become relative links to the notes they name, measured from where the export is saved;
    one that names no note is left as written.
  - The export never writes over the open document.
- **Fixed: editing a paragraph with a wikilink broke the wikilink on save.** `[[Note]]` was written back as
  `\[\[Note]]`, which is no longer a link anywhere. Wikilinks and embeds are now written exactly as read.
- 30 new tests. Mutation testing: 30 mutants; 29 killed, and the one survivor was code with no effect, now removed.
### feat/document-language

- **A language per document (FR-12.3).** Spelling is checked in each document's own language: `lang:` in its
  front matter, a choice from the new status bar button, or a guess from the text, before the default.
  - A dictionary K-Doc does not have is downloaded from github.com/wooorm/dictionaries only after you agree, and is
    kept for next time. Say no and spelling is simply off for that language, and the status bar tells you so.
  - Dictionaries already loaded are kept in memory, so moving between documents in different languages is instant.
  - Language detection is built in (twelve languages, no dependency) and can be turned off in Settings → Proofing.
  - Grammar checking uses the document's language.
- 68 new tests (55 TypeScript, 13 Rust). Mutation testing: 44 mutants (34 TypeScript, 10 Rust), all killed.
### feat/document-import

- **Import from Word, HTML, RTF and plain text (FR-13.5).** **File → Import Document** converts the file to
  Markdown and opens it as a new unsaved document. Before it opens, a dialog lists what Markdown cannot hold, and
  the import can be cancelled there.
  - Headings, emphasis, links, lists, tables (with a header row, and column alignment from RTF) and footnotes
    come across; underlining, highlighting, colours, alignment, merged cells, media, forms and embedded pictures
    are named rather than dropped quietly.
  - Word documents are read with mammoth; RTF with a small reader of our own; web pages in the character set they
    declare.
  - New dependency: `mammoth` 1.12.3 (BSD-2-Clause). Its new packages are BSD-2-Clause, MIT and BSD-3-Clause.
- 88 new tests (82 TypeScript, 6 Rust). Mutation testing: 62 mutants; the 7 survivors were code that made no
  difference and has been removed, and the remaining 55 are all killed.
### feat/docx-export

- **Export to Word (FR-13.4).** **File → Export as Word Document** writes a `.docx` that Word treats as
  its own: Heading styles, real lists that restart their numbering, tables with a repeating header row, Word
  footnotes, and embedded pictures.
  - Written to a temporary file and renamed into place, so a failed export leaves the old file untouched.
  - Whatever could not be carried across — raw HTML, pictures that could not be read or that Word cannot
    embed — is named in the status message.
  - New dependency: `docx` 9.7.1 (MIT). Its 22 packages are MIT, ISC, Zlib, BlueOak-1.0.0, and JSZip under
    its MIT option.
- Fixed `@codemirror/lang-css` being required at 6.4.1, a version that was never published, which made every
  `npm install` fail.
- 52 new tests (45 TypeScript, 7 Rust). Mutation testing: 45 mutants, 42 killed; the three survivors are
  equivalent or untestable and are described in the pull request.
### feat/grammar-provider

- **Grammar checking (FR-12.4).** **Review → Check Grammar** sends the document to a LanguageTool-compatible
  service and lists what it reports in the Problems panel, with the first suggestion as a quick fix.
  - Off unless you name a service in Settings → Proofing, and only ever when you run the command: nothing is
    sent as you type, and with no service named nothing is sent at all.
  - Every failure is reported as itself; none of them is reported as "nothing wrong".
  - The findings clear as soon as the text changes, since their offsets describe the document as it was.
- 21 new tests. Mutation testing: 30 mutants, all killed.

### feat/word-frequency

- **Word and phrase analysis (FR-12.8).** The statistics dialog now lists the ten words a document uses
  most and the ten phrases it repeats.
  - Counted on the prose, so links and code are not mistaken for writing, and the words every English
    document is made of are left out.
  - The longest repetitions are reported first and their fragments suppressed, so one repeated sentence
    does not fill the list with its own pieces.
- 16 new tests. Mutation testing: 19 mutants, all killed.

### feat/readability

- **Readability metrics (FR-12.6).** The statistics dialog now reports Flesch Reading Ease, the
  Flesch–Kincaid grade level and the Gunning fog index, for the document and the selection.
  - Measured on the prose rather than the Markdown source: code blocks, link addresses and front matter are
    not read, and counting them made the welcome document score −40.8 for reading ease instead of 18.4.
  - A document with no words or no sentences shows an em dash rather than a number.
- 25 new tests. Mutation testing: 23 mutants, all killed, after five unobservable conditions were removed.

### feat/portable-comments-mode

- **Keep comments in the file (FR-10.6).** A new **General** setting, off by default, keeps the document's
  comments written into it as HTML comments: adding, editing, resolving or deleting one rewrites the file's
  copy at once, so saving is all it takes to send the comments with the document.
  - With the mode on, a document that carries comments is not offered as an import, since it is meant to
    carry them.
  - Turning it off writes the next change without a bundle rather than stripping every document at once.
- 3 new tests.

### feat/portable-comments

- **Send a document with its comments (FR-6.22).** **Bundle Annotations into File** writes the document's
  comments into it as HTML comments, so a single `.md` can be sent to someone who does not share the folder
  the comments normally live in. Every Markdown renderer drops them, so the file still reads as itself.
  - Opening a document that carries them offers to take them out into the comments pane; declining is
    remembered for that document.
  - Bundling again replaces the previous block. A comment that cannot be read is skipped and reported rather
    than costing the reader the rest.
- 19 new tests. Mutation testing: 24 mutants, 23 killed, 1 kept (a type guard whose removal only changes
  which of two identical failures is reported).

### feat/comments-in-export

- **Comments in exports (FR-10.7).** Comments stay out of an exported or printed document unless asked for.
  **Settings → Export → Comments in exports** offers **Leave out** (the default), **As endnotes** and
  **In the margin**.
  - An endnote gets a numbered marker at the commented word and a back-link from the note; a margin note
    sits beside the text it is about.
  - Every reply is written out and attributed; resolved threads are left out; a comment whose text has since
    gone is still shown, quoting what it was about.
- New `export` settings section.
- 24 new tests. Mutation testing: 25 mutants, 24 killed, 1 kept (a range check whose lower bound the scan
  order already guarantees).

### feat/session-restore

- **Session restore (FR-6.10).** With **Restore session on launch** on — the default — K-Doc reopens the
  files that were open, brings the same one to the front, and puts the view mode, the split, the sidebars
  and the scroll position back where they were.
  - Only saved files are remembered; unsaved text stays the crash journal's to offer, and the journal is now
    offered after the restore so recovered work lands on the file it came from rather than on the welcome
    document.
  - Turning the setting off deletes the stored arrangement, and files that have since been moved or deleted
    are reported together rather than one by one.
- 19 new tests. Mutation testing: 29 mutants, 27 killed, 2 kept (one required by the types, one subsumed by
  the check that follows it).

### feat/split-editor-panes

- **A second pane on the same document (FR-6.9, partial).** **Second Pane on This Document** opens a second
  editable view of the open document beside the first, with its own scroll position and its own share of the
  width, independent of the WYSIWYG/Source split. It follows you from tab to tab until you close it.
  - Under it, a `SessionChange` now says which view applied an edit, so any number of views over one
    document stay in step. Before this, two views of one pane each read the other's edit as their own and
    neither updated.
- Two documents side by side are still not offered, and the toolbars, find, comments and spelling stay
  attached to the first pane.
- 8 new tests. Mutation testing: 12 mutants, all killed, after one unobservable conditional was removed.

### feat/read-only-lock

- **Read-only files open locked (FR-6.7).** A file that is read-only on disk opens as a locked document:
  neither pane takes typing and saving is refused, with **Locked** shown in the status bar.
  - Clicking **Locked**, or running **Unlock Document**, offers to clear the read-only attribute on disk and
    unlocks the document once it has.
  - The lock stays with the document across tab switches.
- 15 new tests (6 Rust, 9 TypeScript). Mutation testing: 16 mutants, all killed, after two unobservable
  conditions were removed.

### feat/reading-width

- **Reading width and display density per document (FR-5.10, FR-14.13).**
  - New **Display density** setting (compact / comfortable / spacious) controlling the space between blocks;
    `comfortable` matches the spacing the editor already had.
  - **Reading Width for This Document** and **Display Density for This Document** give the open document its own
    choice, remembered against its path and restored when you come back to it; **Use the Settings Width and Density**
    drops it again.
- 27 new tests. Mutation testing: 41 mutants, 39 killed, 2 kept (one required by the types, one unreachable through JSON).

### feat/presentation-mode

- **Presentation mode (FR-5.9).** **Start Presentation** shows the document as slides, split at `---` rules, over the
  whole screen.
  - Arrow, Page Up/Down and Space move; Home and End jump to the first or last slide; clicking advances; Esc leaves.
  - Local images are loaded as they are in the editor, and a slide counter shows where you are.
- 13 new tests. Mutation testing: 31 mutants, all killed (3 by tests added for survivors).

### feat/zen-mode

- **Zen mode (FR-5.8).** **Zen Mode** in the command palette hides every toolbar, sidebar and the status bar, leaving just
  the editor, and makes the window full screen. Press Esc or run the command again to leave.
- 8 new tests. Mutation testing: 16 mutants, all killed.

### feat/focus-typewriter

- **Focus and Typewriter modes (FR-5.8).**
  - **Focus Mode: Paragraph** and **Focus Mode: Sentence** fade everything except the paragraph or sentence you are
    writing, in both panes. Run the command again to turn it off.
  - **Typewriter Mode** keeps the line you are typing in the middle of the window.
  - Both are in the command palette and last for the session.
- 21 new tests. Mutation testing: 38 mutants.
  - 27 were killed at once and 6 more by tests added for survivors.
  - 4 were redundant clamps or a loop, simplified away.
  - 1 is equivalent: not descending into textblocks only saves work.

### feat/git-awareness

- **Git awareness (FR-11.11).** For a document in a git repository:
  - **Version History** lists the commits that changed the file next to its local snapshots. A commit can be compared,
    restored, copied from, or opened as tracked changes like a snapshot.
  - **Git: Stage File** and **Git: Commit File…** in the palette stage the file or commit just that file.
  - This uses the git already installed, so there is no new dependency.
- 9 new tests (6 Rust against a throwaway repository, 3 TypeScript).
- Mutation testing:
  - TypeScript: 6 mutants, all killed.
  - Rust: 18 mutants. 14 killed at once and 2 more by strengthened tests; the other 2 conditions were unobservable
    (git itself rejects a missing folder, and always writes the subject separator), so the code was simplified.

### feat/compare-documents

- **Compare Documents (FR-11.7).** **Edit → Compare Documents…** compares two Markdown files and opens the revised one
  in a new tab with every difference as a tracked change. Accept or reject them in the Review panel. In Version History,
  **Open as Tracked Changes** does the same for a saved version against the current document.
- **Fixed: Reject all restored text in the wrong place.** This happened for changes beside one another (such as
  deleting two characters in a row) and after K-Doc added `kdoc_id` front matter. Rejections now run newest first, and a
  change whose surrounding text was partly rewritten is found by the context that remains.
- **Fixed: tracked-change marks vanished** after an outside text change (restore, undo, redo, or front matter being
  added) until the next edit.
- 19 new tests. Mutation testing: 20 mutants on the final code, all killed. Earlier rounds' survivors led to removing
  logic the partial-context rung made unobservable, and to 3 anchor tests.

### feat/history-browser

- **Version History (FR-11.9, FR-11.10).** **View → Version History…**, or the button at the top of the History panel,
  lists a saved document's snapshots.
  - **Changes view:** each snapshot shows as a word-level diff against the current text (removed text struck through,
    added text highlighted), with a word count of the changes.
  - **Old Version view:** shows the text as it was.
  - **Restore This Version** puts a version back as one undoable edit, after keeping the current text as a snapshot.
  - **Copy Selection** copies a selected passage out of an old version, or the whole version.
- Fixed: the core Myers diff threw for two empty inputs.
- 15 new tests. Mutation testing: 27 mutants; 26 killed (1 by a test added for a survivor), 1 equivalent (choosing
  the before or after token by index).

### feat/snapshots

- **Local snapshots (FR-11.8).** K-Doc keeps copies of a saved document on disk, in the vault's `.k-doc/local/snapshots/`
  or in the global store.
  - **When:** after every save, when you run **File → Take Snapshot**, and every 10 minutes. Text identical to the
    newest copy is skipped.
  - **Retention:** everything is kept for 24 hours, then the newest copy per hour for 7 days and the newest per day for
    90 days. Manual snapshots are never removed.
  - **Settings:** Settings → Editor has **Snapshot on save** and the timer interval. The retention periods are in the
    settings file's new `history` section.
- 7 Rust tests and 19 TypeScript tests. Mutation testing: 26 TypeScript mutants (25 killed, 2 by a test added for survivors; 1 guard the type checker requires) and 15 Rust mutants (14 killed, 3 by tests added for survivors; the oldest-first sort survives because NTFS already lists names in order).

### feat/split-merge

- **Split and merge documents (FR-8.31).**
  - **Edit → Split Document at Heading** moves the section at the caret, with its subsections, into a new unsaved tab.
    You stay in the document, where undo puts the section back.
  - **Edit → Merge Document…** appends a Markdown file you pick to the end of the document, after one blank line and
    without its front matter.
  - Both work from WYSIWYG and Source.
- 15 new tests. Mutation testing: 17 mutants; 13 killed (1 by a test added for a survivor), 3 equivalent conditions
  removed, 1 guard required by the type checker.

### feat/snippets-dialog

- **Snippets dialog (FR-7.10).** Add, change, remove and restore snippets without editing the settings file. Open it
  from Settings → Editor (**Snippet list: Edit…**) or the palette (**Snippets…**).
  - Bodies can span lines. Enter in the prefix field moves to the body.
  - Invalid prefixes (spaces) and empty bodies are refused with a reason.
- Fixed before merge: committing a body with Tab lost keyboard focus, because the dialog redrew the row.
- 10 new tests. 18 mutations, all killed (2 by tests strengthened for survivors).

### feat/snippets

- **Snippets (FR-7.10).** In WYSIWYG, type a prefix and press Tab to insert its Markdown body. Tab and Shift+Tab then
  move between its placeholders (`${1:default}`, `$0`), and `$DATE`/`$TIME` fill themselves in.
  - Built-in snippets: `table`, `link`, `img`, `code`, `note`, `task`, `today`.
  - Snippets are defined in the settings file's new `snippets` section and switched on and off in Settings → Editor.
  - Expansion works inside lists, stays inert in code, and is one undo step.
- Found and raised as a follow-up (not fixed here): editing inside an existing `> [!NOTE]` alert in WYSIWYG escapes its
  marker.
- 25 new tests. 32 mutations, all killed (8 by tests added for survivors).

### feat/autocorrect-table-dialog

- **Edit the autocorrect replacement table (FR-7.8).** Settings → Editor → Replacement table → Edit…, or the
  palette's Autocorrect Replacements…, lists the table. You can add, change and remove entries, or restore the
  defaults, and a change applies to the next word you type.
- 11 new tests. 18 mutations: 15 killed (3 by tests added for survivors), 3 equivalent guards removed.

### feat/autocorrect

- **Autocorrect as you type (FR-7.8).** In WYSIWYG it curls quotes, turns `--` and spaced hyphens into dashes and `...`
  into `…`, and replaces text from a table (`teh` → `the`, `(c)` → `©`). Ordinal superscripts (`1^st^`) and sentence
  capitals are opt-in.
  - Each rule has its own switch in Settings → Editor, under the existing Smart substitutions master switch.
  - Nothing changes inside code, and Backspace undoes a correction.
  - The table lives in the settings file's new `autocorrect` section.
- Fixed while verifying: the WYSIWYG editor was missing ProseMirror's required CSS (`white-space: pre-wrap`), so a
  trailing space collapsed, runs of spaces disappeared, and the next keystroke could replace an inserted space.
- 22 new tests. 32 mutations: 30 killed (3 by tests added for survivors), 1 unobservable condition removed, 1 equivalent
  mutant (the 11–13 range widened to 19 gives the same suffixes).

### feat/image-editing

- **Resize, caption and edit images in WYSIWYG (FR-8.15).**
  - Click an image to select it, then drag the corner handle. The width is written into the alt slot (`![alt|600](x.png)`)
    only when you actually resize, and in one undo step.
  - The title shows as a caption under the picture, and the image dialog now calls that field Caption.
  - Right-click an image for **Edit Image…** and **Reset Image Size**.
  - Export writes `width="600"` and a clean alt.
- 27 new tests. 33 mutations: 29 killed (10 by tests added for survivors), 2 equivalent conditions removed, 2 null guards kept for
  type narrowing.

### feat/format-painter

- **Format Painter (FR-8.3).** `Ctrl+Shift+C` or the toolbar brush picks up the character formatting at the selection.
  A click paints the word under it, a drag paints the dragged text, and the painter then turns off. Double-click the
  brush to keep it on until Esc. Painting replaces formatting, is one undo step, and never touches links.
- **Toggle Right Panel (`Ctrl+Shift+R`).** Collapses the right panel or reopens it on the panel it last showed.
- Found while verifying and fixed: a drag released past the edge of the editor did not paint.
- 15 new tests. 27 mutations, all killed (3 by a toolbar test added for survivors).

### feat/reference-link-tools

- **Convert to Reference Links (FR-8.16).** A palette command, and a button in the new Link Definitions panel,
  rewrite every inline link as `[text][n]`. Definitions are added at the end of the document, reusing existing ones
  for the same destination. It is one undo step.
- **Link Definitions panel.** It lists each definition with its destination and whether it is used, unused or a
  shadowed duplicate. Clicking a row shows the definition in Source.
- 20 new tests. 32 mutations: 30 killed (3 by tests added for survivors), 2 equivalent guards removed.

### fix/reference-links-wysiwyg

- **Reference-style links render in WYSIWYG.** `[text][label]`, `[label][]` and `[label]` now show as clickable links
  resolved from their definitions, and definitions show as their `[label]: url "title"` line, instead of
  "[unrenderable inline]" and "[unrenderable block]". Untouched references are written back unchanged. An edited
  shortcut or collapsed reference is written as a full reference so it keeps its target.
- 14 new tests. 28 mutations: 27 killed (6 by tests added for survivors), 1 equivalent condition removed.

### feat/fold-sections

- **Fold heading sections and list items (FR-8.29).** A ▾ button beside a heading or a multi-block list item folds it
  in WYSIWYG. Source folds and unfolds the same sections from its gutter, and both panes always agree. Folds are
  remembered per file across restarts, and a document never saved keeps them while its tab is open.
- Palette commands: Toggle Fold, Fold All Headings, Unfold All.
- Folding never changes the document: no dirty flag and no undo step. Moving the caret into a folded section unfolds it.
- 64 new tests. 51 mutations: 50 killed (15 of them by tests added for survivors), 1 condition that could not be observed removed.

### feat/table-of-contents

- **Insert a table of contents (FR-8.30).** Insert → Table of Contents… asks how deep to go and inserts a nested list
  of real Markdown links between `<!-- toc -->` markers. Running it again, or Refresh Table of Contents, rewrites the
  list from the current headings.
- Anchors are shared with link following, so a generated link always reaches its heading, including repeated headings
  (`#notes-1`).
- 19 new tests. 30 mutations: 26 killed, 4 conditions that could not be observed removed.

### feat/table-width-hints

- **Column width hints (FR-8.26).** Column Width… (palette, table toolbar ↔) sets a column's minimum width in
  characters. It is saved as extra dashes in the delimiter row, which every GFM reader accepts, and read back from
  any table written that way. In WYSIWYG the hinted column is at least that wide.
- Inline formatting works in table cells; block formats stay unavailable there, as GFM requires.
- 24 new tests. 48 mutations: 46 killed, 2 conditions that could not be observed removed.

### feat/table-header-and-hints

- **Header row toggle (FR-8.25).** Toggle Header Row (toolbar **H**, context menu, palette) turns a table's header off,
  writing the empty header row GFM needs, or back on, promoting the first row.
- **Warnings for what a table cell cannot hold as written.** The first `|` typed into a cell in a document explains it
  is saved as `\|`; the first line break explains it will be saved as a space.
- 11 new tests. 18 mutations: 14 killed, 4 conditions that could not be observed removed.

### feat/table-sort-and-paste

- **Sort a table by a column (FR-8.23).** Ascending or descending, from the table toolbar, the context menu or the
  palette. Numbers, dates and text are detected; the header stays first and empty cells go last.
- **Paste CSV or an HTML table as a table, and copy a table out for a spreadsheet (FR-8.24).**
  - The Table paste option now reads comma- or semicolon-separated text (with quoted fields) and the first table in
    copied HTML, as well as tab-separated text.
  - Copying a table, rows or cells puts tab-separated values on the clipboard.
- Choosing another reading for a paste that landed after a paragraph now replaces it instead of adding a second copy.
- Pasted Windows line endings no longer leave carriage returns in the text.
- 33 new tests (3204 total). 55 mutations: 42 killed, 13 conditions that could not be observed removed.

### fix/crlf-source-offsets

- **Notes with Windows line endings work in the Source pane.**
  - Clicking an outline heading, or using Go To line near the end of a CRLF note, threw an error and revealed
    nothing.
  - Typing in the Source pane silently rewrote every line ending in the file to LF.
- CRLF files are now edited as LF and saved back as CRLF, byte for byte. Save As, Save a Copy, vault replace and saves
  from a dragged-out window keep them too.
- A file mixing line endings is left exactly as written.
- 15 new tests (3171 total); 15 mutations, all killed; one condition that could not be observed was removed.

### fix/follow-link-reuse-tab

- **A note opens in one tab.** Following a link to a note that is already open, or opening it from the Tags or
  Backlinks panel, switches to its tab. Before, it opened a second tab on the same file. A link with a heading still
  reveals that heading.
- 4 new tests; 4 mutations, all killed.

### fix/dialog-ui-font

- **Dialogs use the interface font.** Settings, Keyboard Shortcuts, confirmations and other dialogs and popups
  appended outside the shell rendered in a serif font. The UI font is now defined once (`ui-font.ts`) and set on the
  page body.
- 3 new tests.

### feat/serializer-container-splices

- **Edits inside containers keep the surrounding bytes (FR-4.2).** Typing in one paragraph of a blockquote, one item
  of a quoted list, or one block of a list item now leaves everything else as written. That covers the item's nested
  list, its second paragraph and a task's other text. Lists numbered with `)` keep their numbering style.
- Splices below item level are checked against a full rewrite of the block and fall back to one when they would read
  differently.
- Neighbouring blocks that both changed are spliced separately when their types match.
- A loose item in a tight list no longer loses its spacing in the WYSIWYG pane. Before, every save rewrote such a list.
- 75 new tests (3149 total; 45 are the edit sweep). 38 mutations, all killed; 8 conditions that could not be observed were removed.

### feat/navigation-history

- **Back and forward (FR-9.10).** Alt+Left returns to where the caret was before a jump, and Alt+Right goes forward
  again. Jumps are:
  - followed links;
  - Go To and Quick Open;
  - outline and breadcrumb clicks;
  - vault search results;
  - notes opened from the file tree, Files, Tags, Backlinks or Recent Files.
- A note whose tab was closed is reopened. A location that can no longer be reached is skipped.
- Both keys are remappable and are listed in the palette as Go Back and Go Forward.
- 17 new tests (3074 total). 16 mutations, all killed.

### feat/keyboard-shortcuts-dialog

- **Keyboard Shortcuts dialog (FR-14.16).** Open it from the palette (Keyboard Shortcuts). You can:
  - search every remappable command by name, category or key;
  - pick the Word, VS Code, Typora or Obsidian preset;
  - add a shortcut by pressing it, remove one, or reset one command or all of them.
- Shortcuts that two commands both claim are outlined, with a summary line above the list.
- A key already used by another command asks first. Enter moves it; Escape keeps it where it was.
- Changes take effect on the next key and are saved to settings immediately.
- 39 new tests (3057 total). 41 mutations: 37 killed after 6 tests were added; 4 guards that could not be observed were removed.

### feat/keymap-service

- **Shortcuts run from the keymap (FR-14.16, FR-20.2).** One capture-phase listener now dispatches every remappable
  shortcut, replacing the separate listeners in the shell, file menu and find bar and the ProseMirror bindings for the
  same keys. A binding changed in `settings.json` takes effect on the next key. The palette, ribbon and native menu
  show the keys in effect.
- Keys no longer fire twice. `Ctrl+=` only subscripts (zoom is `Ctrl+Shift+>`), and `Ctrl+/` in the Source pane only
  switches view.
- Commands respect where focus is:
  - formatting only in the WYSIWYG pane;
  - undo never inside a text field;
  - F2 and F7 left to widgets such as the file tree.
- **Word shortcuts with no Markdown meaning explain themselves (FR-20.1).** Ctrl+U, Ctrl+J and Ctrl+1/2/5 show a
  dismissible one-line explanation above the status bar.
- Ctrl+K opens the link dialog on the link under the caret, as before.
- 29 new tests (3018 total). 23 mutations, all killed after one test was added for the file menu's opt-out.
- Not covered: there is no dialog to remap shortcuts yet (next).

### feat/keymap-model

- **The keymap model for remappable shortcuts (FR-14.16, FR-20.2).** The config package now knows every remappable
  command, its scope, and the spec's Word-compatible bindings. It also has VS Code, Typora and Obsidian presets that
  differ only in that table. Conflicts are detected, with a user's own binding taking a chord over a preset's.
- Shortcuts have one canonical spelling. A letter is read from the character typed and punctuation from the key's
  position, so Ctrl+Z follows the keyboard layout and Ctrl+Shift+= is the same chord whatever Shift types.
- `settings.json` gains a `keyboard` section (preset and bindings), validated with warnings and written sorted.
- Nothing in the app uses it yet: the key dispatch service and the shortcuts dialog follow.
- 42 new tests (2989 total); 24 mutations, 23 killed, the survivor an unobservable guard, deleted.

### fix/vault-index-on-save

- **Saving a note updates the vault index.** A tag, link or heading added to a note and saved now appears in the
  Tags, Backlinks and Problems panels straight away; before, the index kept the note as it was until the folder was
  opened again. A new note saved into the vault (Save As) is added by a rescan that reads only that file.
- 6 new tests (2947 total); 7 of 7 mutations killed.
- Not verified in the app: Save As into the vault (its file dialog cannot be driven); unit-tested only.

### feat/vault-file-tree

- **The Files panel is a vault file tree (FR-6.11).** Folders, empty ones included, come before notes and expand in
  place. Click, `Ctrl`+click and `Shift`+click select; arrows, Home/End, Enter, F2, Delete and `Ctrl+A` work from
  the keyboard.
- Create a note, a folder, or a note from a template in `.k-doc/templates/`, from the toolbar or the right-click menu.
  Rename and delete the selection; delete sends it to the Recycle Bin after a confirmation. Drag notes and folders
  onto a folder or the empty area to move them.
- Open tabs follow a renamed or moved note, and close (asking about unsaved changes) when it is deleted.
- New host commands in `vault_files.rs` refuse any path outside the vault and never overwrite. Adds the `trash` crate.
- Clicking a note that is already open switches to its tab instead of opening it again.
- Not covered: links to a moved note are not rewritten; a move or rename cannot be undone.
- Tests: vitest 2941 (172 files, 116 new or moved into new files), cargo 143 + 4 (22 new, one real Recycle Bin test
  ignored and run once by hand). Mutation: 66 TypeScript mutations, 64 killed after one added test, the other two
  guards deleted as unobservable; 15 of 15 Rust mutations killed.

### feat/vault-search

- **Find and replace across the vault (FR-9.5).** `Ctrl+Shift+F` opens the Search panel, which now searches the
  full text of every note -- an open note's unsaved text rather than its file -- with match case, whole word and
  regular expression. Results are grouped by file with line numbers and snippets, and a click opens the note at
  the match.
- Replace from a per-match confirm list: matches start ticked, a file's box ticks or clears them all, and only the
  ticked ones are replaced. An open note changes in its tab (`Ctrl+Z` undoes it there); a closed note is rewritten
  in its own encoding. A match that moved since the search is skipped and counted.
- **Undo** in the panel puts back the last replace in every note not changed again since.
- The panel no longer matches a front-matter title or a file name on its own; it searches note text.
- Not covered: notes changed on disk by another program are searched as first read until the folder is reopened;
  untitled documents and files outside the vault are not searched.
- 95 tests in five new or rewritten spec files, replacing the old panel's (2836 total). 67 mutations: 65 killed
  once nine tests were added for survivors; an early limit check that reported a search as cut short when the
  files left had no matches was deleted, and the `break` after truncation survives because it only saves work.

### fix/list-item-fidelity

- **Editing one list item no longer rewrites the others.** The incremental serializer treated a list as one
  block, so typing in one `*` item re-emitted every item with the configured `-`. Now only the changed items
  are re-emitted, in the list's own bullet or number; the Fidelity Check reports nothing for the same edit.
- Inserting or deleting an item adds or removes just its line, spaced like its neighbours.
- A list whose start or tightness changed, or that is numbered with `)`, is still rewritten whole.
- Not covered: lists inside blockquotes, blockquotes, and the rest of an item being edited.
- 27 new tests (2754 total). Twenty-three mutations; three checks that could never decide anything were
  deleted, and one null check stays as a required type narrowing.

### feat/local-images

- **Local images display.** A picture beside the note, in a parent folder or at an absolute path now shows in
  the WYSIWYG pane and in Preview; before, every local image was a broken icon.
- **A standalone HTML export embeds its local images** as data URIs, and names any it could not read.
- Images are read through a new host command that only serves files with an image extension, up to 25 MiB.
- An image that cannot be read is outlined, with the reason on hover.
- Found by running it: the app failed to start (the image loader was created after the first document was
  mounted), and relative images resolved against the previous tab's folder.
- Not covered: an image changed on disk is not reloaded until the document is reopened; print still uses the
  written address.
- 35 new TypeScript tests and 8 Rust tests (2727 total). Thirty-two mutations; one survived and its check was
  deleted because a failed read already refuses a directory.

### fix/detach-tab-state

- **A tab dragged into its own window keeps its unsaved changes and encoding.** The handoff carried only
  the text and path, so the new window showed the document as saved and would write a UTF-16 file as UTF-8.
- **Dragging a tab out now opens a working window in the desktop app.** The command that builds the window
  ran on the main thread and deadlocked: the new window stayed blank and the old one hung. It is async now.
  The desktop half of this feature had never been run before.
- A handoff from an older build, without the new fields, is still accepted.
- 9 new TypeScript tests and 2 Rust tests (2692 total). Ten mutations, all caught.

### fix/persist-trusted-domains

- **"Always trust" survives a restart.** The settings writer lists its fields by hand and left out
  `general.trustedDomains`, so every trusted domain was dropped the next time settings were saved.
- A round-trip test now writes a settings object in which every field differs from its default and
  reads it back, so a field the writer forgets fails a test.
- 3 new tests (2683 total).

### feat/document-linting

- **FR-12.7 is done.** A Document group in the Problems panel reports heading-level skips, duplicate
  headings, links with no address or no text, table rows that do not match the header, delimiter rows that
  stop a table being a table, missing image files, and `#anchor` links no heading has.
- **Quick fixes** apply as one undoable edit: make a skipped heading the next level, unwrap an addressless
  link, use a textless link's address as its text, pad a short row, rewrite a delimiter row.
- **Missing images are checked on disk** through a new host command that only answers whether each file
  exists; they are asked about again after every save.
- **Images are no longer reported as broken note links.** The vault link check treated `img/a.png` as a
  note name.
- Found by running it: saving after adding a missing image did not clear it, because the panel redrew
  before the answers were forgotten.
- Not covered: no fix for broken note links, duplicate headings, long rows or missing images; headings
  inside quotes and lists are not checked.
- 84 new tests (2680 total) and six Rust tests. Seventy mutations; sixteen survived the first run, ten now
  have tests, one was a wrong error message now fixed, and five were checks no input could change, now
  deleted.

### feat/fidelity-check

- **FR-4.5 Fidelity Check.** With the new Settings > General > Developer mode on, every save reports
  blocks and blank space whose content did not change but whose bytes did, under Fidelity in the
  Problems panel. Text the user changed themselves -- in the Source pane, by find and replace, by undo
  -- is not reported. Lists, list items and blockquotes are compared item by item; tables are not.
- **Found a real fidelity gap:** a WYSIWYG edit inside a list rewrites the other items in the configured
  style. FR-4.2 is now marked partial until the serializer splices list items.
- **A problem's kind survives a click.** The Problems panel read any kind but `link` back as spelling.
- **Settings keep `developerMode`.** The settings writer lists its fields by hand, and the new one was
  missing until a save-and-reload test caught it.
- Not covered: findings are withdrawn rather than followed through later edits.
- 93 new tests (2596 total). Forty-six mutations; nine survived the first run and each now has a test.

### fix/tab-state

- **A tab keeps its unsaved changes across a switch.** Switching back remounted the document as clean,
  so the status bar dropped "Modified", closing did not warn and autosave skipped it. A tab now carries
  the text as of its last save.
- **A tab keeps its encoding across a switch.** A UTF-16 or BOM file switched back to was saved as
  plain UTF-8.
- **A file opened from Open Recent, Quick Open or the Files panel keeps its encoding.** Those routes read
  only the text; `FileService.readFile` returns the encoding with it.
- Open Recent no longer asks to save the document it leaves: the file opens in a new tab and the old
  document keeps its unsaved work in its own tab.
- Not covered: dragging a tab out to a new window still starts it clean and as UTF-8.
- 16 new tests (2503 total). Eight mutations, all caught.

### feat/navigation

- **FR-9.7 Quick Open.** `Ctrl+Shift+O` lists open tabs, recent files and every vault note, narrowed
  fuzzily as you type with the matched letters highlighted. A file already open switches to its tab.
- **FR-9.6 Go To.** `Ctrl+G` takes a line or `line:column` in the Source pane, and offers the
  document's headings in WYSIWYG.
- **FR-9.9 Breadcrumbs.** A bar above the panes shows the heading path of the caret; clicking a crumb
  moves the caret to that heading.
- **Opening a file into a tab now shows it.** Open Recent and the Files panel added a tab record but
  left the previous document on screen.
- **A tab keeps its file across switches.** Remounting a tab rebuilt the file menu with no path, so
  Save on a switched-to tab asked where to save instead of writing the file.
- Open Recent no longer carries the `Ctrl+Shift+O` label; the command is still on the File menu.
- Not covered: the command palette does not match file names; a tab's unsaved flag and encoding are
  still lost on a switch.
- 105 new tests (2487 total). Twenty-nine mutations, all caught.

### feat/raw-html-widget

- **FR-7.9 is done.** HTML blocks and inline HTML in the WYSIWYG pane are small CodeMirror editors
  showing their exact source, highlighted as HTML. Typing rewrites only that node's bytes.
- Undo inside a widget walks the document's history; Escape and the arrow keys leave it, with
  up and down leaving only from the first or last visual row of a wrapped line.
- **Focus inside a widget now claims the edit lock.** The binding listened for `focus`, which does
  not bubble; it now listens for `focusin`.
- **Code blocks are visibly highlighted.** They emitted `tok-*` classes that no stylesheet coloured.
- Found by running it: Home did nothing (CodeMirror's default keymap was missing), a lone
  `</span>` was underlined as invalid, and ArrowDown left a wrapped line from its first row.
- Not covered: inline HTML is one widget per tag; link definitions and footnotes are not
  source-editable.
- 35 new tests (2382 total). Seventeen mutations, all caught; four first survived and each now has
  a test, including one showing a document-side rewrite of the node reached the session twice
  without the widget's sync guard.

### feat/link-hover-card

- **FR-8.13 is done.** Resting on a link in the WYSIWYG pane shows where it goes, with an Open
  button; Ctrl+Click follows it. Heading links move the caret to the heading, note links open the
  note, and web and mail links open in the OS handler.
- **Only `http`, `https` and `mailto` are ever opened.** `javascript:`, `data:`, `file:` and every
  other scheme are blocked and say so. The Rust command repeats that check and refuses whitespace
  and control characters, then hands the URL to the protocol handler with no shell in between.
- A web link to an untrusted domain asks: Open, Always trust, or Cancel. New setting
  `general.trustedDomains`; the existing `confirmExternalLinks` is now honoured.
- **Ctrl+Click still adds a caret anywhere except on a link.** The link-follow plugin is installed
  ahead of multi-caret, which otherwise claimed every Ctrl+Click.
- The context menu's Open Link now goes through the same route instead of `window.open`.
- A note link prefers the note beside the document when two notes share a name — pinned by a test
  added after a mutation showed the `.md` step was otherwise untested.
- Not covered: wikilinks are plain text in WYSIWYG, so they get no card; Source-pane links are not
  followable.
- 66 new tests (2347 total) and 19 new Rust tests (106 total). Seventeen mutations, all caught.

### feat/caret-across-modes

- **FR-5.6 is done.** Switching between WYSIWYG, Source and Preview carries the caret and selection
  into the pane being revealed. A backwards selection stays backwards, and focus arrives where the
  user was. Split keeps each pane's own caret.
- Built on the character-level mapping `offset-map.ts` already had; `positionToOffset` gets its
  first caller. New `sourceSelectionToProseMirror` and `proseMirrorSelectionToSource` in
  `@k-doc/editor`.
- **A caret at the end of a line no longer jumps to the start of the next block.** Segments are
  half-open, and the raw mappers snap an offset outside every segment forward — including one
  sitting exactly on a segment's end. The carry functions map endpoints through containment, then a
  segment-end rule, then the forward snap. `offset-map.ts` is unchanged, since what already uses it
  relies on the snap. Found by the first test run: a selected heading came back one character long.
- Either side of an inline delimiter such as `**` is one WYSIWYG position, so one side returns on
  the other. Repeated switching never walks the caret further, and carets inside text round-trip
  exactly.
- Where the documents cannot be matched the carry does nothing rather than guess.
- **Two dead conditions deleted**, found by mutation: a divergence guard the fallback already
  covered, and a zero-width-segment check that cannot fire, since ProseMirror has no empty text nodes.
- 21 new tests (2281 total). Nine mutations run: seven caught, and the two survivors were the dead
  conditions above.

### chore/status-pass

- **Status audit after the sidebar and vault work.** Four rows were still marked not started:
  - **FR-6.13 is done** — the Backlinks surface built for FR-14.7 is exactly what it asks for.
  - **FR-6.11, FR-9.5 and FR-12.7 are partial**, each note naming what is missing.
- **FR-9.5 is partial, not done, because vault search is not full-text.** It matches titles, tags,
  paths and headings; the text of notes is not searched. Checked in the code rather than assumed
  from the panel's name. There is also no `Ctrl+Shift+F` and no replace across files.
- FR-9.7 stays todo: the command palette does not match file names, so neither route to Quick Open
  exists. Its note, and those for FR-6.14 and FR-6.15, no longer say the vault is missing.
- Totals: 92 done, 3 partial, 54 todo.

### fix/right-panels-refresh-on-mount

- **The right panel's surfaces showed stale data whenever a document was mounted.** They redraw
  when the session, the vault or the file menu reports a change, and a newly mounted document has
  not changed yet. On boot, Metadata read `Words 0` for a 175-word document; after a tab switch,
  Backlinks, History, Metadata and Problems kept the previous tab's data until the next edit.
  `mountDocument` now refreshes all four, since every mount path ends there. Introduced in #77 and
  missed by its verification, which typed into the editor first and so triggered a redraw.

### chore/fr-6-12-desktop-verification

- **FR-6.12 verified in the desktop app**, closing the gap PR #78 left open: its Rust and
  TypeScript halves had only been tested separately. Driven over WebView2's DevTools port, with
  IPC counted from the network side rather than trusted from the service's own counter:
  a first open read 3 files and wrote the index; a re-open read none (`reused: 3`); an edit, an
  add and a delete read exactly the 2 changed files and dropped the deleted note from the index
  on disk; a freshly launched process reopened the vault reading no files; and an index truncated
  to half its length was ignored, fully rescanned and rewritten valid.
- The known blind spot was confirmed live rather than only argued: content changed with its size
  and modification time held identical kept the old title and read nothing, and `refresh()`
  repaired it.
- Noted, not fixed: every open rewrites `index.db`, even when every note was reused and nothing
  changed.

### feat/vault-index-persistence

- **FR-6.12 is done.** The vault index is persisted at `.k-doc/local/index.db` and maintained
  incrementally: a re-open reads and parses only the notes that actually changed.
- **The path is `.k-doc/local/index.db`, not the `.k-doc/index.db` the requirement's own sentence
  names.** The layout in spec section 6.4 puts it under `local/` with the snapshots and the
  journal, and the generated `.gitignore` ignores `local/` because the index is derived data.
  Two readings of one spec; this is the one that agrees with the rest of it.
- A note is reused when **both** its modification time and its size still match. Either alone is
  not enough: a time survives a copy or a restore that changed the content, and a size survives an
  edit that swapped one word for another of the same length.
- A deleted note drops out with nothing having to delete it — the plan is built from what is on
  disk now, not from what the index remembers.
- **`parseIndex` rejects anything it cannot fully vouch for**: bad JSON, a different format
  version, a root naming another folder, or one note of the wrong shape anywhere in the array.
  Rejecting a good cache costs one extra scan; trusting a bad one shows a note's old headings and
  tags as though they were current, with nothing on screen to say otherwise.
- **Every failure around the cache leaves the scan working.** An unreadable index, a missing
  command, a write that fails on read-only media — each one falls back to a full scan or a
  skipped save. Refusing to show someone their notes because the cache could not be saved would
  trade a working feature for a broken one.
- **The write is atomic**: to `index.db.tmp`, then renamed over the real file. An interrupted
  write would otherwise leave a truncated file that still parses as far as it goes.
- A note the scan could not read is **not** saved into the index, so the next scan tries it again
  rather than reusing an entry that was never built.
- `refresh()` rebuilds from disk and ignores the saved index — the requirement's "rebuildable on
  demand", and the repair for an index that is wrong in a way the time-and-size check cannot see.
- `VaultStatus` gained `reused`, the count of notes that came from the index. Without it a scan
  that re-read everything and one that skipped nine notes in ten look identical from outside.
- New Rust commands `vault_index_read` and `vault_index_write`; a vault that has never been
  indexed reads as `null` rather than an error, because that is the ordinary first case.
- 36 new tests (2260 total) and 6 new Rust tests (87 total). Twenty-two mutations run, all caught.

### feat/right-panel-surfaces

- **FR-14.7 is done.** The right panel now holds all six surfaces — Comments, Backlinks, History,
  Metadata, Problems and Review. The four new ones sit between Comments and Review, because
  reordering panels a user has already learned to find moves a target for no reason.
- **Backlinks** groups what links to the open note by source note, in first-appearance order, and
  quotes each line. The quoted line is a button too — it is how the user recognises which reference
  they meant. Its three empty states say different things: no vault open is not the same as an
  unsaved note, and neither is the same as a note nothing points at.
- **History** lists the session's edit timeline, newest first, with how long ago each version was,
  which pane made it, and how its length compares with the document now. Clicking one puts it back
  through `applyExternalText` — an ordinary undoable edit, not a destructive overwrite, which is
  what FR-11.10 asks for. `applyText` would have thrown: it demands the Source pane hold the edit
  lock, and a panel is not a pane.
- **History reads the session's in-memory timeline only**, so it goes no further back than the
  document was opened. The persisted snapshots of FR-11.8 and the word-level diff of FR-11.9 are
  still todo; this is the surface those would deepen, not their implementation.
- **Metadata** shows the file, its front matter and its statistics, in three sections that are
  always present. Front-matter values are formatted rather than printed: an array joins with
  commas, because `tags: [a, b]` is the commonest value there is and `[object Object]` would make
  the field unreadable exactly when it matters. A circular value reads `(unreadable)` instead of
  taking the panel down. Reading time says `Under a minute` at zero rather than `0 min`.
- **Problems** lists misspellings and links that resolve to no note, spelling always first so a
  problem does not move because a different one was fixed.
- **`reveal` is handed the problem's kind along with its range**, because the two kinds do not
  measure in the same units: a misspelling's offsets are ProseMirror positions and a link's index
  the source text. Resolving either in the other's pane puts the caret where the problem is not.
- Link checking waits for the scan to finish. Mid-scan the index is still filling, so every link
  would be reported broken and then quietly un-reported as its note arrived.
- **`brokenLinks` added to `@k-doc/core`**, judging only vault-internal links — a URL that 404s is a
  real problem, but one only a network request can find.
- **`EditHistory.entries` and `DocumentSession.timeline` added**, both read-only and both a copy:
  handing out the live undo stack would let a caller splice it while holding what it believes is a
  list to draw. The redo stack is deliberately excluded.
- **A dead guard deleted.** `brokenLinks` skipped a pure `#fragment` target explicitly; a mutation
  showed removing it changed no answer, because such a target strips to the empty string and the
  next check already caught it.
- 123 new tests (2224 total). Forty-six mutations run, all caught — the one survivor was the dead
  guard above, which was deleted rather than papered over with a test that could not reach it.

### feat/left-sidebar-panels

- **FR-14.6 is done.** The left sidebar now holds all four panels — Outline, Files, Search and
  Tags — and `Ctrl+Shift+B` collapses and reopens it.
- **`Ctrl+Shift+B` was bound to nothing at all.** The status note claimed it worked; checking is what
  found otherwise. It now reopens on whichever panel the sidebar was last showing, because always
  reopening on Outline would make it a way of losing your place rather than a toggle. It matches on
  `event.code`, since with Shift held `event.key` differs between keyboard layouts.
- **Files** groups notes by directory, top level first with no header over it, and names the vault's
  own folder rather than repeating a path the user already chose. It says **Scanning…** rather than
  showing an empty list, and shows notes as soon as there are any.
- **Search** is debounced by 150ms and shows nothing for an empty query. A refresh re-runs
  immediately **and cancels a pending keystroke** — otherwise the same query runs twice, which is a
  second pass over every note for an answer already on screen. The count says `1 result`.
- **Tags** lists every tag with its note count and its `#`, and expands one to the notes carrying it.
  Expanding redraws the list, so **focus is put back on the button that replaced the one pressed** —
  without it a keyboard user is dropped to the top of the document mid-gesture.
- A selected tag survives a refresh but is dropped when the tag stops existing.
- Each panel takes plain accessor functions rather than the vault service, so a panel can be tested
  without one and the service can change shape without three panels following it.
- `FileService` gained `chooseFolder()`, separate from `chooseSavePath` because one asks where to
  write a file and the other which folder to read.
- 35 new tests (2101 total). Eighteen mutations run, all caught; three needed tests that could
  actually observe the difference — one directory group cannot show an ordering.

### feat/link-dialog-vault

- **FR-8.12 is done.** The link dialog now offers all four sources it was asked for: a URL, a
  heading in this document, a note in the open vault, and a file from disk.
- Every source writes into the **same URL field** and hands control back to it. A picker that
  applied straight away would give no chance to add a title or correct the target.
- **The heading slug is the renderer's slug.** Punctuation is dropped, not hyphenated:
  `What's New in 2.0?` becomes `whats-new-in-20`. A heading link that did not match the anchor a
  Markdown renderer emits would be a broken link — worse than having no picker at all. The first
  version hyphenated it under a comment claiming to be GitHub-style; it was not.
- Opening on a link to a heading starts on the **Heading** tab, because editing one should show
  you the headings rather than make you find the tab first.
- The **File** tab is drawn only where there is a picker behind it. The browser build has none.
- The note search is debounced by 120ms and shows nothing for an empty query — an unconstrained
  listing of a whole vault is not a search result. Both lists are rebuilt on every open.
- A new `vault-service` opens a folder and holds the index. Its scan is **cancellable**: a user who
  opens one folder and immediately opens another must not get the first folder's notes arriving
  after the second's. A note it cannot read is recorded and the scan carries on.
- 42 new tests (2066 total). Thirteen mutations run, all caught. One guard was deleted as
  unreachable, and `update` lost a second guard that agreed with the first about everything.

### feat/vault-index

- **The vault index the last three open requirements all needed.** FR-8.12's vault-note search,
  FR-14.6's Files/Search/Tags panels and FR-14.7's Backlinks panel each need something that knows
  what notes a folder holds; this is that, built once.
- A new Rust command `vault_list_notes` walks a folder with an explicit stack and `read_dir` — **no
  new crate**, no recursion to overflow. It never follows symlinks (a loop would never finish, and a
  link out of the vault would index files the user did not put there), skips `.k-doc`, `.git`,
  `node_modules` and dot-directories, and caps at 20,000 notes because a person can choose their
  home directory by mistake.
- `packages/core/src/vault/` extracts a note's title, headings, links, wikilinks, tags and front
  matter, purely. Tags and wikilinks are scanned out of the raw text — neither is something remark
  knows about — and both skip fenced and inline code, because `#include` in a C snippet is not a tag.
- Patterns are read with `matchAll`, never `exec`: `matchAll` iterates a clone, so a shared `/g`
  pattern carries no `lastIndex` between calls. **Removing the shared state beat defending it** — a
  mutation showed the hand-written resets could never fire.
- Backlinks skip self-links and are ordered by source then position, so the panel reads the same way
  twice running. An anchor-only link matches no note.
- Tags are counted **by note, not by occurrence**, and a nested tag is found under its parent —
  clicking `work` shows `work/urgent`, while `workshop` is a different tag.
- Search is a weighted sum rather than a fuzzy match, because a ranking a user cannot predict is one
  they cannot use. The three title weights are exclusive, and heading hits are capped at five so a
  long document full of the word cannot outrank the note actually called it.
- **FR-6.12 is recorded as partial, not done**: the index is held in memory and rebuilt on open. It
  is not yet persisted at `.k-doc/index.db` and not yet maintained incrementally.
- 71 new TypeScript tests (2024 total) and 7 new Rust tests (85 total). Twenty-six mutations run,
  all caught; three needed sharper tests first, two of which could only be told apart by asserting
  the search score rather than the result order.

### feat/multi-caret

- **FR-7.2 is done.** The WYSIWYG pane now has multi-caret editing, which the Source pane has had
  all along.
- **ProseMirror's `Selection` is a single range by construction**, so the extra carets could not go
  in the selection. They live in plugin state as document positions, and every edit is applied at
  the primary position and at each extra.
- **Ctrl+Click** adds a caret and removes one already there; **Ctrl+D** selects the word under the
  caret on the first press and adds a caret at each next occurrence after that; **Escape** collapses
  back to one caret. Typing, Backspace and Delete apply everywhere at once.
- Edits are applied **back to front** so each position is still valid when its turn comes, and all
  in **one transaction** — typing at three carets that took three undos to take back would be worse
  than not having the feature.
- The plugin is installed **ahead of every keymap**, because ProseMirror consults `handleKeyDown` in
  plugin order and a Backspace reaching the base keymap first would delete at the primary caret only.
- Enter and the arrow keys are deliberately left alone: splitting at several places at once is a
  different feature, and arrow keys would need every caret to carry its own goal column.
- Ctrl+D matches **whole words only** — otherwise adding the next `in` would land inside `point`,
  `into` and `binding`.
- 37 new tests (1953 total). Seventeen mutations run, all caught. One decoration bounds check was
  deleted after checking what ProseMirror actually does with an out-of-range widget: it does not
  throw, so the guard's stated reason was untrue.

### feat/tab-drag-out

- **FR-6.8 is done.** Dragging a tab clear of the strip opens that document in a window of its own.
- **Where the drag ended is what decides it.** A reorder and a drag-out start identically, so
  `endedOutside` measures the release point against the bar's rectangle with 24px of slop. A drag
  cancelled with Escape reports (0, 0) and is checked first — otherwise changing your mind would
  open a window.
- `dataTransfer` still carries nothing, so the drag remains undroppable into another application.
- **The document is handed over, not copied.** The new window claims it exactly once; a reload that
  claimed again would put the user's unsaved work in two windows at once.
- Inside Tauri a new `open_document_window` parks the document under a generated label and then
  builds the window — **parking first**, because the new window can ask for its document as soon as
  its script runs. `take_handoff_document` reads the label from the calling window itself, which the
  webview cannot spoof. A failed build undoes the park.
- Creating a window stays a Rust command rather than a webview permission, so
  `core:webview:allow-create-webview-window` is still ungranted. The capability's window list widened
  to `["main", "doc-*"]`, because a second window with no capability could not read or save a file.
- **The source tab closes only once a window has actually opened.** A document that exists in neither
  window is the one outcome this gesture must never have. It closes without a save prompt, because
  the document is being moved rather than discarded.
- 17 new TypeScript tests (1916 total) and 3 new Rust tests (78 total). Eleven mutations run, all
  caught; one flag was deleted as unreachable rather than given a test that could not reach it.

### feat/merge-view

- **FR-6.4 is done.** A file changing on disk under a buffer with unsaved edits now opens a
  three-way merge view instead of a one-question prompt.
- **The merge has a real common ancestor**: the text as of the last save, which both the buffer and
  the file on disk diverged from. `SessionSnapshot` exposes it as `savedText`. With a base, a change
  only the buffer made and a change only the other program made are **both taken without asking** —
  the question the old prompt had to ask was mostly about changes that were never in each other's way.
- A new `packages/core/src/merge/`: a Myers line diff, a reduction to replacement ranges, and the
  three-way sweep. **No new dependency** — the existing `diffEdit` is a single-range character diff,
  so two edits far apart collapse into one range and every merge would be one enormous conflict.
- **Lossless.** `splitLines` splits on LF and keeps the CR, so `joinLines(splitLines(t)) === t` for
  every string. A merge that re-guessed line endings would rewrite every line of a CRLF file (FR-6.6).
- Both sides of a conflict are shown **side by side, always**; a dialog that showed one at a time
  would be the old prompt with extra steps. Untouched runs are elided past three lines at each end.
- **An unanswered conflict resolves to the buffer, never to disk.** Losing unsaved work must never be
  the default. A merged buffer stays dirty, because the merged text is on disk nowhere.
- Two edits on neighbouring lines are two hunks rather than a conflict between changes that never met.
- 45 new tests (1899 total). Twenty-two mutations run, all caught; one clamp was deleted as
  unreachable rather than given a test that could not reach it.

### feat/callout-types

- **FR-8.10 is done.** A custom alert word, and the compact `> [!NOTE]` form recognised.
- **The marker is the first line, not the whole paragraph.** `> [!NOTE]` followed by `> body` is one
  paragraph, because a quote's continuation line joins the one above it — so the old rule recognised
  only the shape K-Doc's own editor produces and missed the commonest shape a GFM file arrives in.
- The marker is therefore decorated **inline** rather than over the paragraph node, which would have
  styled the body as the title too.
- **An alert word K-Doc does not know is still an alert.** `[!QUESTION]` gets a panel in a neutral grey
  accent rather than being treated as prose or guessed at as a note.
- A **Custom…** entry in the Styles gallery asks for the word, opening on the one the block already
  carries so changing NOTE to NOTICE is an edit rather than a retype. A word that is not letters is
  refused and said so.
- `canApplyStyle` answers the gallery's enabled/disabled question. Every other entry is its command and
  can be dry run; the custom one has no command until the user has given a word, so it is probed for
  placement instead — without a dispatch, so opening the gallery never writes.
- 18 new tests (1854 total). Seventeen mutations run, all caught.

### feat/page-setup

- **FR-13.2 is done.** A page-setup dialog for paper, orientation and margin, running headers and
  footers, and an include-contents option.
- **Headers and footers are real paged-media margin boxes**, not `position: fixed` elements faked to
  repeat — which is the only way `{page}` can be a page number rather than a guess about where the
  breaks fell. That the engine supports them was checked by parsing the rule and reading it back.
- They are **templates** over `{title}`, `{page}` and `{pages}`, because the useful things to put in a
  running header are not known when the setting is typed. Literals are escaped: a title comes from a
  filename, and a quote in one would close the CSS string.
- An empty template writes **no margin box**, because an empty one still reserves its space.
- The contents page is assembled by the printer, not the renderer: it is not in the Markdown, and a
  renderer that added it would put it in the HTML export and the Preview pane too.
- The dialog's primary button says **Print**, because that is what it does — the only way to see a
  page setup is to look at a page. The setup is remembered for the session but not persisted: a margin
  chosen for one handout is not a fact about the file.
- 33 new tests (1834 total). Thirty mutations run, all caught; two needed a sharper assertion first.

### feat/paste-special

- **FR-7.4 is done.** A Paste Special dialog (`Ctrl+Alt+V`) and a Word-style paste-options control after
  every paste, both offering plain text, Markdown, HTML and **table**.
- **Table paste**: tab-separated text becomes a GFM table, first row the header. The split is on tabs
  only — a spreadsheet emits commas only when asked for CSV, and guessing at them would turn
  `Hello, world` into a two-column table.
- **It re-reads the paste that already happened** rather than the clipboard. By the time the user wants
  a table the clipboard may hold something else, and reading it unprompted is a permission a text editor
  should not need.
- Only readings that would actually work are offered. The dialog greys what is impossible; the popup
  omits it, because it sits over the very text the user is deciding about.
- **Found by running it:** choosing Table and then Unformatted Text pasted *into* the table. The range
  had been read off the selection after the dispatch, and ProseMirror puts the caret inside a new block.
  Both edges are now mapped through the transaction, and `pasteContentAt` reports them.
- 46 new tests (1801 total). Thirty mutations run; five survived the first pass and two were real gaps.

### feat/file-operations

- **FR-6.1 is done.** Open Recent with pinning, Save a Copy, Rename and Reveal in File Explorer join
  New, Open, Save, Save As and Close, on the command palette and the File menu.
- **Save As, Save a Copy and Rename are three different promises.** Save As moves the document and
  leaves the old file; Save a Copy writes a second file and leaves the document; Rename moves the file
  and takes the document with it.
- **The rename refuses to overwrite.** `std::fs::rename` silently replaces an existing target on both
  Windows and POSIX, and destroying a file the user did not name is data loss noticed a week later.
- Reveal shows the file *selected*, not just its folder opened — an opened folder of two hundred files
  does not say which one.
- **Pinning makes the list a list rather than a log.** The unpinned tail is capped at ten; the pinned
  head is not, because a limit that overrode a pin would make pinning a suggestion.
- The list lives in `settings.json` and has exactly one owner. A malformed entry in a hand-edited file
  costs that entry, not the list.
- 51 new tests (1755 total) plus 6 new Rust tests. Thirty-one mutations run; six survived the first
  pass and five were real gaps.

### feat/ribbon-galleries

- **FR-8.5 is done.** A Styles gallery of fourteen entries — Normal, Heading 1–6, Quote, Code Block and
  five GitHub callout types — each drawn in the style it applies, marking the caret's own style and
  greying every entry whose command refuses. Each entry is dry-run rather than reasoned about.
- **Callouts exist.** A callout is a blockquote whose first line is `[!NOTE]`, coloured by decorations
  rather than modelled as a schema node, so the file stays Markdown any reader understands.
- **Found by running it:** the file on disk said `> \[!NOTE]`. Escaping a leading `[` is right in prose
  and fatal in an alert — GitHub and Obsidian both render the escaped form as literal text, so the
  callout looked right in K-Doc and was broken everywhere else. A paragraph handler now emits the marker
  unescaped, and only ever the first block of a quote.
- The first version of that fix missed the commonest shape: `> [!NOTE]\n> body` is one paragraph, not
  two, so a GitHub file read in and written back was still escaped.
- **Also found by running it:** the accent bar never appeared. `.ProseMirror blockquote` outranks a lone
  `.kdoc-callout`, so the tint arrived and the colour did not.
- 65 new tests (1704 total). Thirty-five mutations run; five survived the first pass and four were real
  gaps.
- **FR-8.6 is done.** A multi-level list gallery offers bullet, numbered and task lists at three nesting
  levels, previewing each as a cascade of indented rows and marking the tile the caret is already on.
- **Indent and outdent are commands now, not just keys.** They existed only as Tab and Shift-Tab; a list
  operation that only a key can reach is one a user who does not know the key cannot reach at all. They
  are on the toolbar and in the command palette, and the indent button greys out on a list's first item,
  which has nothing above it to nest under.
- **Fixed: asking for a nested list produced a flat one.** `toggleList` makes a *second, adjacent* list
  rather than adding to the one above, so the new item was always its own first item and could not nest.
  The new list is now joined to the one above first — which GFM renders as one list anyway, so the
  document had been disagreeing with what the user saw.
- The join acts on the **innermost** enclosing list. Joining an outer one would merge two lists somewhere
  above while leaving the item exactly as unnestable — the wrong edit, made silently.
- Asked to nest deeper than a list can go, it stops where it can and still succeeds: refusing outright
  would leave the user with no list at all.
- 39 new tests (1619 total). Twenty mutations run; five survived the first pass, one of them a real
  defect (the join walked out to the outermost list rather than the caret's own).

### feat/table-partials

- **FR-8.20 is done.** Rows and columns can be duplicated, moved one step, or dragged by a grip handle
  onto another row or column.
- **Row 0 is the header and does not move or duplicate.** GFM has no table without a header row, so a
  handle that could move it would offer something the format cannot express.
- **A column's alignment travels with the column.** Alignment lives on the table in mdast, not on the
  cell, so a column that moved without it would arrive right-aligned in a left-aligned slot.
- A grip is a **widget**, so it never reaches the Markdown, and it sits inside a `<td>` rather than
  under the `<tr>` — a `<span>` directly under a row is invalid HTML a browser hoists out of the table.
- A drop puts the caret in its own cell first, because the move commands resolve their table from the
  selection and a drag never moves the caret.
- The same six moves are on the table toolbar, the context menu and the command palette, so reordering
  is reachable without a pointer.
- 26 new tests (1580 total). Sixteen mutations run, fourteen caught; the two survivors are a guard
  TypeScript already enforces and an equivalent mutant (a copy placed above its original is the same
  document as one placed below).

### feat/code-block-partials

- **FR-8.8 is done.** Code blocks are syntax-highlighted in the rendered view and carry a copy button.
- **The same Lezer parsers the Source pane loads** do the highlighting. A second engine would colour the
  same code two different ways in two panes of one window, and the only thing worse than no highlighting
  is highlighting that disagrees with itself.
- A fence in a language K-Doc ships no parser for renders **plain**, because a wrong grammar produces
  confident, wrong colours.
- The copy button is a **separate plugin**: copying has nothing to do with the grammar, and tying them
  together would cost a `bash` block its button for an unrelated reason.
- **Found by running it:** the button's label was part of the block's DOM text, so a native selection
  across the code swept `Copy` into the clipboard — a copy button that copies itself. `user-select: none`
  fixes it; the ProseMirror copy path was never affected because it serialises the document, not the DOM.
- 8 new tests (1554 total). Two mutations survived the first pass — nothing exercised the newline path in
  the offset cursor, and nothing noticed an empty-class decoration — so two cases were added to reach them.

### feat/small-ui-partials

- **FR-10.4 is done.** Comments now have a display toggle: **margin** paints the highlight, **inline** adds
  the comment's text beside it in both panes, and **hidden** draws neither.
- **Hidden hides the markup, not the comments** — the pane still lists every thread, because it is the panel
  the user deliberately opened.
- **Inline keeps the highlight too.** The note says what the comment is, the highlight says what it is about,
  and one without the other is half an answer.
- Only a thread's **first** comment is drawn inline: six replies rendered into the document would bury the
  text they annotate, and a conversation belongs in the pane.

- **FR-6.6 is done.** UTF-16LE and UTF-16BE join UTF-8 with and without a BOM: all four are detected from
  the byte order mark and **written back as found**. K-Doc never adds a BOM, never removes one, and never
  converts a UTF-16 file to UTF-8 behind the user's back.
- **It refuses to guess.** Only encodings that announce themselves are recognised — a UTF-16 file with no
  BOM is indistinguishable from binary without statistics, and statistics are a guess.
- The wire carries a **name, not a flag**: `had_bom` could only answer *UTF-8 with or without a BOM*, and
  the question a save has to answer is *what was this file*.
- **FR-14.5 is done.** The status bar's three named segments are clickable: word count opens statistics,
  the encoding cycles what the next save writes, and the mode indicator switches view.
- The encoding message says **next save**, because nothing has been written yet — rewriting a file the
  moment a control changed would be a destructive act nobody asked for.

### feat/navigation-partials

- **FR-9.1 is done.** The outline folds, and a heading can be dragged to reorder the document — the move
  takes the whole subtree, because a heading without its body is not a section.
- **The insertion offset is computed against the text with the section already removed.** Taking it out
  shifts every later offset, so the original destination would land the section too far along.
- A section dropped inside its own subtree is refused, and one moved from the end of the file gains a
  trailing newline so it cannot weld itself onto the next heading's line.
- Collapsed headings are held **by start offset, not index** — an index is a position in a list that changes
  on every keystroke. Their rows are not built at all rather than hidden, so keyboard navigation never lands
  on something invisible, and the test asks whether *any* ancestor is closed rather than the nearest one.
- **Fixed an unrelated broken test:** the wild-corpus suite walked up for the first `node_modules` it found,
  which in an npm workspace is the package's own directory of symlinks. It found no documents and 356 tests
  silently stopped running. It now takes the outermost one, where the dependencies are hoisted.

- **FR-9.2 is done.** Every find match now highlights in both panes and as a tick in a scrollbar gutter,
  and the search can be narrowed to the current selection.
- **The panel drives none of it directly.** It owns the search and reports through `onMatches`; the shell
  decides what to paint, so the panel needs no idea a WYSIWYG pane or a scrollbar exists.
- **Dropping an unmappable match shifts every later index**, so the WYSIWYG active match is tracked as the
  mapped list is built — painting the incoming index against it would highlight the wrong match.
- The selection is captured **once, when the option goes on**, because the panel's own next/previous move
  the selection and a re-read would collapse the scope to the current match after the first jump.
- A straddling match is excluded (*in selection* means the whole match) and the option refuses to engage
  without a live range — a pressed button that changes nothing is worse than one that refuses to press.
- **Removed a guard mutation testing showed was dead:** the WYSIWYG plugin skipped a range that collapsed
  under clamping, and ProseMirror already drops a collapsed inline decoration. The behaviour is pinned by
  a test rather than by that branch.
- 25 new tests (1527 total).

### feat/comment-author

- **FR-10.3 is done.** Comments can be edited in place, and the author name comes from a new
  `general.authorName` setting instead of the literal `'You'`.
- **The name is read when a comment is written, not when the document was opened.** Settings can change
  while a document is open, and a captured name would mean renaming yourself silently did nothing until the
  next launch. A reply posted after a rename carries the new name; the ones above it keep the old.
- **Fixed: clicking into a comment's reply box rebuilt the card underneath the cursor.** Selecting a card
  repaints it, and a click inside the textarea bubbled to the card's select handler — so the node was
  replaced and focus lost. Every button already stopped propagation; the text boxes did not. This predates
  the editor and was only found because the editor made it unmissable.
- Saving an empty body does nothing (deleting by stealth is not what Save means) and saving an unchanged
  body closes without stamping `(edited)` on a comment nobody edited.
- 12 new tests (1502 total).

**`FR-STATUS.md`'s "things this document exists to stop being forgotten" list is now empty** — both
recorded deviations are closed.

### feat/leader-line

- **FR-10.2 is done.** A dashed leader line joins the active comment card to the text it is anchored to,
  follows it as the pane scrolls, and clears when the highlight leaves the view.
- **The geometry is a pure function of three rectangles**, separately from the drawing, so every rule about
  when *not* to draw is decidable without a layout engine — and each of those rules is a claim the line
  would otherwise be making falsely.
- The path is three points: the first two share the text's height so the line **runs level with the row
  before it turns**, and the anchor is measured from the *last* client rect so a wrapped highlight is left
  from where its text ends.
- **`scroll` and `resize` are not enough.** A CodeMirror re-render, a divider drag and a late-loading font
  all move the geometry without firing either, so while a card is active the redraw re-arms itself each
  frame and stops when nothing is selected.
- Fixed on assembly: the generated layer built a `polyline` and **never appended it to the svg** — a
  failure whose only symptom is a line that is simply never there. The tests caught it.
- 8 new tests (1489 total).

### feat/right-panel

- **The comments pane is on the right**, where FR-10.2 always said it should be, in a new right panel
  (FR-14.7) that also holds Review. Both were built into the left sidebar next to the outline, which was a
  deviation rather than a reading of an ambiguous spec, and `FR-STATUS.md` existed partly to say so.
- **Fixed: choosing Original markup mode trapped the user.** The overlay covers `.kdoc-panes` at `z-index: 5`
  and the sidebars are *inside* `.kdoc-panes`, so it hid the review pane holding the markup-mode selector —
  the only control that can leave the mode. A sidebar is chrome around the panes, not a pane, so it now
  sits above them.
- `sidebar.ts` gains `side` and `startCollapsed`. The right host is a second instance rather than a switch
  on the first, and it starts as a bare rail because a comments column nobody opened is only lost width.
- 3 new tests (1481 total).

**FR-10.2 stays partial:** there is still no leader line joining the active thread to its text.

### feat/source-gutters

- **FR-5.2 is done.** The Source pane gains line numbers, code folding and bracket matching — all three
  named in the requirement and none of them present until now.
- **Folding belongs to the Markdown language, not to the gutter.** `foldGutter()` only draws where
  something publishes a range, and `lang-markdown`'s fold service is what gives a heading the section
  beneath it. Swap the language and the folding changes with it.
- Mutation testing found the gap that mattered: `foldable()` and `matchBrackets()` are pure functions of
  the language and **answer the same whether or not the extensions are installed**, so removing either
  broke no state-level test. Two of the six tests mount a real view and ask the DOM instead.
- The gutters read left to right as identity, then structure, then state: line number, fold arrow, change
  bar. The active line is marked by brightening its number rather than by a band behind the other two.
- `@codemirror/language` is now a declared dependency of `@k-doc/editor` rather than one borrowed from
  `lang-markdown`'s tree.
- 6 new tests (1478 total).

### feat/change-bars

- **FR-11.4 is done.** Simple Markup now draws the margin bars it always planned: a CodeMirror gutter in the
  Source pane and a node decoration in the WYSIWYG pane. Before this the mode looked identical to No Markup.
- **A bar says *this line changed* and deliberately not what**, so it carries no author colour - a line can
  hold changes by several people and picking one of them would be a claim the mode is not making.
- **Offset 0 is clamped up, not down.** Resolving position 0 lands in the document root where there is no
  block to decorate, so without the clamp the first line's bar would silently vanish.
- Bars live in their own plugin rather than inside the mark plugin, whose metadata contract is a bare span
  array and is covered by tests.
- 13 new tests (1472 total).

### feat/track-changes-partials

- **FR-11.3 is done.** All four scopes work from the review pane — this change, in the selection, by an
  author, in the document — and a bulk rejection still lands as a single transaction.
- They reduce to one `ChangeFilter`, because **an omitted field is not a filter**: `{}` and `undefined`
  both mean every change, so "all in the document" needs no case of its own.
- A scope left pointing at an author who no longer has changes **falls back to the document**, since a
  bulk decision that quietly did nothing is worse than one that does too much.
- **Original now renders** (FR-11.4) — a read-only overlay showing the document with every pending change
  rejected. It covers the panes rather than sitting beside them: Original is a view of the whole
  document, and showing it next to the live one would invite editing the wrong copy.
- 8 new tests (1459 total).

**FR-11.4 stays partial:** `planChanges` produces Simple Markup's margin bars and **no renderer consumes
them**, so choosing Simple Markup currently looks the same as No Markup.

### feat/track-changes-wiring

- **Track Changes is reachable.** `Ctrl+Shift+E` toggles it, a Review panel lists every change, and both
  panes paint insertions and deletions. **FR-11.1, FR-11.2, FR-11.5 and FR-11.6 are now done** — the
  first §11 rows to go green.
- The WYSIWYG pane uses `mapChangeSpansToPositions`, not the comment mapper: **a deletion is a zero-width
  point** and the range mapper refuses a collapsed range, so it would silently drop every deletion.
- Both panes are painted on every plan whatever the view mode — skipping the hidden one would leave a
  stale set the moment the user switched back.

**Still partial:** FR-11.3 has no selection-scoped or by-author decisions, and FR-11.4's **Original mode
does not render** — `originalText` exists but nothing displays that projection.

### feat/review-pane

- **Added the review pane** (FR-11.2, FR-11.3, FR-11.4) — every pending change with its kind, author,
  timestamp and text, plus the tracking toggle, the markup-mode selector and bulk accept/reject.
  **Nothing mounts it yet.**
- **The two empty states answer different questions**: *Tracking is off* says nothing will happen until
  the user turns it on, *No tracked changes yet* says nothing has. The wrong one sends someone hunting
  for a bug that is not there.
- **The pane is told the truth on every render** rather than keeping its own copy of the tracking flag or
  the mode — two places disagreeing about that is exactly the bug this avoids.
- Rows sort by `createdAt` then by id, because one edit records a deletion and an insertion in the same
  millisecond and the tie-break is what stops their order depending on the store's read order.
- 9 new tests (1451 total).

### feat/changes-controller

- **Added the changes controller** (FR-11.1, FR-11.3, FR-11.4, FR-11.5) — the recorder, the store and the
  plan joined together. **Nothing constructs it yet.**
- **Accepting never touches the document**; rejecting is the one path that writes text, and it writes
  through `withoutRecording` — otherwise the rejection is recorded as a change describing the rejection,
  which would then be rejectable, without end. Removing that guard fails three tests.
- A bulk rejection is **one** `applyDecisions` call rather than a loop, so the whole set lands as a single
  undoable transaction (FR-11.3).
- A change that cannot be placed is **left in the list and reported**, not dropped — unlike an orphaned
  comment, a tracked change records an edit the user actually made, so losing it loses work.
- 8 new tests (1442 total).

**Not done:** selection-scoped decisions (FR-11.3 asks for "all changes in the selection"), the review
pane, the display-mode control, and `Ctrl+Shift+E`.

### feat/change-painting

- **Added both painting layers for tracked changes** (FR-11.1, FR-11.6) — ProseMirror and CodeMirror.
  **Nothing is wired up yet**: no `Ctrl+Shift+E`, and nothing sends spans to either pane.
- **An insertion paints as a mark, a deletion as a widget.** The deleted characters are not in the
  document, so the widget renders a string the document does not contain — the only way a tracked
  deletion is visible at all. `user-select: none` keeps that text off the clipboard.
- CodeMirror builds its set with `Decoration.set(ranges, true)` rather than `RangeSetBuilder`, because a
  deletion widget and an insertion mark share an offset — exactly what a replacement produces — and the
  builder throws on that ordering.
- **The author's colour is derived, never stored.** A colour table in the overlay would conflict on merge,
  which is the one thing the line-oriented store was shaped to avoid. Only the hue is decided in core.
- The tests caught a real defect before it landed: the CodeMirror builder **never branched on
  `span.kind`**, so an insertion emitted its mark *and* a stray deletion widget, while a deletion emitted
  nothing at all.
- 13 new tests (1434 total).

### feat/change-decoration-spec

- **Added the headless change decoration plan** (FR-11.1, FR-11.4, FR-11.6). **Nothing renders it yet.**
- **A deletion's span is a zero-width point carrying its text**, because its characters are not in the
  document — the renderer must re-project a string the document does not contain.
- **Nothing is ever orphaned.** The anchor ladder always places a change, which is a deliberate
  difference from comments: a comment *points at* text, but a tracked change **is** an edit, and
  dropping one loses the user's work. Each span reports the rung that placed it instead.
- **Only two of the four display modes are decorations.** No Markup is empty because accepting never
  edits the text, so the document already *is* the accepted result; Original is empty because it is a
  different *text*, which `originalText` produces.
- A redundant second guard on `simple` mode was **removed** after mutation testing showed it withheld
  nothing — spans are only ever built under the `all` guard.
- 15 new tests (1421 total).

### feat/change-recorder

- **Added the change recorder** (FR-11.1) — a prefix/suffix diff plus a session subscriber that turns
  each edit into tracked changes. **Still no UI**: nothing binds `Ctrl+Shift+E` and nothing renders.
- **Undo and redo record nothing** — the user retracting their own work is not new work — and neither do
  external reloads or resets. `withoutRecording` gates the recorder's own writes, without which
  rejecting a change would record a change about the rejection and never terminate.
- **The baseline advances on every notification, including declined ones.** That invariant is what stops
  work done while tracking was off being attributed retroactively when it is switched on.
- A redundant baseline refresh in `setTracking` was **deleted** after mutation testing showed removing it
  broke nothing — dead code that looks load-bearing is worse than none.
- 23 new tests (1406 total).

**Known limitation:** `diffEdit` is single-range, so one transaction touching disjoint ranges is recorded
as one change spanning them all. Rejecting it still restores the original, but it is coarser than the
user's actual edit.

### feat/track-changes-model

- **Added the tracked-change model** (FR-11.3, FR-11.5, FR-11.6) — the first slice of Track Changes.
  **The model only**: nothing records changes as you type, renders them, or writes the overlay yet.
- **Accepting never edits the document.** The on-disk `.md` already holds the accepted-plus-pending
  text, so an insertion's characters are present and a deletion's are gone — accepting is purely the
  caller dropping the op, and **rejection is the only operation that changes anything.**
- **One anchor covers both kinds**, because both ask the same question: what should the document
  currently contain here? `prefix + text + suffix` for an insertion, `prefix + suffix` for a deletion.
  The comment anchor could not be reused — `resolveAnchor` rejects an empty quote, which is exactly
  what a deletion has.
- `applyDecisions` both sorts descending and re-resolves each anchor. **Either alone would be correct**,
  and mutation testing showed it: breaking one breaks no test, breaking both fails three. The comment
  explaining why was wrong in both directions before the mutations settled it.
- 13 new tests (1383 total).

### chore/fr-status-matrix

- **Added `FR-STATUS.md`** — every one of the 149 requirements in the spec with its actual state, and a
  note on each partial saying what is missing. Generated by `scripts/gen-fr-status.py`, which lifts the
  requirement text from `PRELIM-SPEC.MD` so the two cannot drift in wording.
- Standing at 62 done, 20 partial, 67 not started. **P0 is 51 done of 70**, with only 3 untouched.
- A row counts as done only when the **whole** requirement is met, so several things that mostly work —
  the Source pane, table row operations, the outline, find — are recorded as partial with the specific
  gap named.
- Two deviations are written down rather than left to be rediscovered: **the comments pane is on the
  left where FR-10.2 and FR-14.7 put it on the right**, and **the comment author is hardcoded to
  `'You'`** where FR-10.3 says it comes from settings.

### feat/comment-ui

- **Added the ProseMirror layer that paints commented ranges** (FR-10.1). It consumes the spans
  `planDecorations` produces and decides only *how* to paint them — which threads are skipped, which
  orphaned, and how overlaps order were all settled headlessly.
- **An edit maps the decorations rather than clearing them.** The authoritative plan is recomputed on a
  debounce, so clearing here would blink every commented range off on each keystroke and back a moment
  later. Briefly approximate is far less distracting than briefly absent.
- **Selecting a thread restyles in place and never recomputes positions**, because recomputing them
  would let clicking a comment move the comment.
- **Confidence drives opacity, not presence.** An anchor the resolver rescued is still a real comment
  about real text, so it is painted — faded, because the reader is entitled to know the position is
  inferred rather than certain.
- `commentsAt` returns **every** thread covering a position, since comments overlap and a click can land
  in several at once; one id could not be disambiguated by the caller.
- `border-bottom` rather than `text-decoration`, which the spell plugin already owns on any misspelled
  word — only one of the two would survive.
- **Added the margin pane and its comment cards** (FR-10.2, FR-10.4). A card shows the quoted text,
  the comments on it, and reply, resolve and delete controls; the pane filters by state and by author.
- **Open is the default filter**, because a resolved comment is finished business and showing it by
  default would keep drawing attention to something already dealt with.
- **The two empty states say different things** — `No comments yet` versus `No comments match the
  current filter`. An empty pane caused by a filter looks identical to one caused by having no
  comments, and the user cannot tell which without being told.
- **Orphaned threads sort last** rather than being interleaved where their stale offset would put them,
  and each still shows its quote — the only remaining record of what the comment was about.
- Every button in a card stops propagation, so pressing Delete or Resolve does not also change the
  selection under the user. An empty reply posts nothing, since a blank comment would be committed to
  git as though it meant something.
- **Added the comments controller**, joining the store, the thread model, the decoration plan and the
  pane. A **draft is a thread with no comments**: `Ctrl+Alt+M` writes nothing, and the first reply
  replaces the draft with a real thread **reusing its id**, so the card does not jump when it becomes
  real. `planDecorations` already skips an empty thread, so a draft shows in the pane without marking
  the document.
- A failed load still repaints, so a previous document's comments never stay on screen; unreadable
  records are **reported**, because losing a comment silently is how a reviewer's note disappears
  without anyone noticing.
- **Wired comments into the running app**: a Comments panel in the sidebar, `Ctrl+Alt+M` on a Source
  pane selection, the annotation store round trip, and clicking a comment scrolling the document to it.
- **Comments paint in the Source pane**, via a new CodeMirror decoration extension. `planDecorations`
  returns source offsets, which is exactly how CodeMirror indexes its document, so the plan needs no
  translation. The WYSIWYG pane still paints nothing: ProseMirror positions differ from source offsets
  because markup characters are absent from its tree, and that mapping does not exist yet. Marking the
  wrong words would be worse than marking none.
- The panel is shown **before** the draft is created, because focusing a reply box inside a hidden
  panel does nothing and the user would have to click into it themselves.
- **Added the source-offset to ProseMirror-position mapper**, so comments now paint in **both** panes.
- It is built by **pairing, not by counting**: rather than re-implementing the parser's markup rules, it
  walks the mdast tree and the ProseMirror doc for their text leaves and pairs them by text equality —
  recovering the correspondence the converter threw away when it dropped each node's `position`.
- A segment is **non-linear** when its two spans differ in length (inline code, escaped characters). An
  offset inside one maps to the segment start and a range to the whole segment: **over-covering marks
  the right words, under-covering can cut one in half.**
- When the two walks lose step, pairing **stops** and every offset past that point maps to `null`.
  Continuing would give confidently wrong positions, and a comment painted over the wrong words is
  worse than one that briefly does not appear.
- 62 new tests (1370 total).

**Not wired up yet:** `Ctrl+Alt+M`, the margin pane and its leader line (FR-10.2), the filters
(FR-10.4), and export handling (FR-10.7). This commit adds the layer, not the surface.

### feat/comment-decoration-spec

- **Added `planDecorations`** — the headless half of comment decoration (FR-10.1): which ranges are
  commented, in what state, and which threads orphaned. No ProseMirror or DOM dependency, so every
  rule is testable without a view, and the same plan can later drive the margin pane.
- Resolved threads are **skipped by default** — a resolved thread is finished business, and tinting it
  keeps drawing attention to something already dealt with. `includeResolved` is the pane's filter.
- Overlapping spans are **never merged or split**: each comment is its own mark, and flattening would
  lose which thread a character belongs to — exactly what a click needs to know. Spans sort by start,
  then by end descending, so an outer range paints before an inner one.
- An orphaned thread carries its **quoted text**, because that is the only thing left saying what the
  comment was about.
- 7 new tests (1297 total).

### feat/comments

- **Added comment anchoring and the thread model** (FR-10.3, FR-10.5) — the model half of comments.
  **The UI half is not built**: no command, no decoration, no margin pane.
- The body Markdown is **never modified**, so an anchor must survive the text around it changing.
  `resolveAnchor` is a ladder — exact, then context (rescues text that *moved*), then nearest identical
  quote, then a bounded fuzzy match — and anything it cannot place becomes an **orphaned comment**,
  listed with its quoted text and never discarded.
- **The fuzzy threshold was measured, not chosen.** A word changed in a long sentence scores 0.905 and
  resolves; the same edit to a three-word quote scores 0.593 and orphans. The calibration is asserted
  so `MIN_SIMILARITY` cannot drift away from it unnoticed.
- The asymmetry behind that threshold: **orphaning is safe, mis-anchoring is not.** An orphan is listed
  and re-anchored in a moment; a comment resolved to the wrong text points at something nobody
  commented on, and does it with confidence.
- Dice similarity over bigrams counted **with multiplicity** — a set would score `aaa` and `aaaaaa` as
  identical, exactly the false confidence an anchor must not act on.
- Thread operations are **pure**: `deleteEntry` returns null when the last comment goes, `editEntry` on
  a missing id returns the thread unchanged, and `setResolved` returns the same object on a no-op so it
  never reaches the store.
- 32 new tests (1290 total).

**Not done:** everything the user can see — `Ctrl+Alt+M` (FR-10.1), the margin pane (FR-10.2), filters
(FR-10.4), export handling (FR-10.7), portable mode (FR-10.6).

### feat/annotation-store

- **Added the annotation store** (FR-6.16–6.23) — the layer comments and tracked changes will be
  written against. It has **no consumer yet**, deliberately: the shape had to be settled before
  anything was built on it.
- **Keyed by identity, never by path.** A `kdoc_id` ULID in front matter means renaming or moving a
  file never orphans its annotations.
- **Lazily added and never volunteered** (FR-6.17). `peekId` reads and never writes; the only moment a
  document acquires an identity is a non-empty save, and the last annotation leaving strips the field —
  removing the whole block when it was the only field, so the text returns to exactly what it was.
- Front matter is edited **line-wise on the source**, not by round-tripping the parser or
  re-serialising the YAML — either would rewrite formatting, ordering and comments the user chose.
- **The store is found the way git finds `.git`**, walking up for `.k-doc/`, with a global fallback in
  app data. The fallback is not a degraded mode but the default one: commenting works on a file
  double-clicked out of Downloads, with no vault and no setup.
- **One record per line** (FR-6.21), sorted by id with recursively sorted keys, so two people
  annotating the same document in git merge cleanly. Decoding **never throws**: a corrupt line is
  reported and skipped and its neighbours survive.
- A **missing** store file reads as empty rather than as an error, because absence is the normal state
  for a document nobody has annotated — while an existing but unreadable file *is* an error.
- `kdoc_id` and `kind` are validated **in the free functions**, not only in the Tauri commands, because
  the id becomes a file name and an unvalidated one is a path-traversal hole.
- 28 new TS tests (1258 total) and 18 new Rust tests (56 total), the Rust ones exercising a **real
  filesystem**: round trip, atomicity, idempotent vault creation, migration, and traversal refusal.

**Not done:** bundling annotations into a file (FR-6.22), which writes *comments* that do not exist
yet; and the vault workspace (FR-6.11–6.15). The store is deliberately vault-optional, so the
workspace is separate work rather than a prerequisite.

### feat/multi-caret

- **Added multiple carets and column selection to the Source pane** (FR-7.2): `Ctrl+Click` to add a
  caret, `Alt+Drag` for a column selection, `Ctrl+D` to add the next occurrence.
- Four extensions and no implementation, which is the point: CodeMirror already has a multi-range
  selection model, and the work was turning it on. `allowMultipleSelections` is the piece everything
  else depends on — without it CodeMirror silently collapses a multi-range selection to one.
- **`Ctrl+Click` needs no code at all** once the facet is on.
- `Mod-d` is bound beside that facet rather than in `keymap.ts`, so removing this module cannot leave a
  shortcut that silently does nothing. It sets `preventDefault` because `Ctrl+D` is the browser's
  bookmark shortcut.
- Added `@codemirror/search` to `@k-doc/editor`. 5 new tests (1230 total), including a **control** that
  asserts a state built *without* these extensions collapses to one range — which is what makes the
  positive test mean something rather than merely describing CodeMirror's default.

**Not done:** the WYSIWYG half. FR-7.2 asks for both panes, and ProseMirror has no multi-selection
model — its `Selection` is a single range by construction. A caret drawn there that looks live and
takes no edit would be worse than no caret.

### feat/find-semantics-stats

- **Added document statistics** (FR-12.5): words, characters with and without spaces, paragraphs and
  reading time live in the status bar, plus a **Statistics** dialog adding sentences and
  selection-scoped counts.
- **One analyser, two surfaces.** The status bar previously counted words itself; two implementations
  disagreeing about how many words a document has would be worse than either being wrong.
- Paragraphs are counted from **text**, not mdast — the status bar updates on every keystroke, and
  re-parsing to count paragraphs would make typing pay for a number nobody reads that closely.
- Sentence counting is a **heuristic** and appears only in the dialog: `Dr. Smith` counts two. There is
  a test asserting the miscount rather than a comment hoping otherwise.
- **Added the three FR-9.4 semantic find filters**: exclude code, exclude link URLs, this section only.
  They **filter `findMatches`' results** rather than becoming a second search — the semantics are a
  lens over one implementation.
- Overlap rather than containment is the exclusion test, because a match that starts in prose and runs
  into a code span is still partly inside the code. A **reference link contributes no URL range**:
  guessing would exclude the wrong characters. A section runs to the next heading of the same or
  shallower depth, because a subsection belongs to its parent.
- 35 new tests (1223 total).

### feat/sidebar

- **Added the left sidebar panel host** (FR-14.6): a tablist rail beside a body that shows one panel
  at a time. The outline, previously a bare `<nav>` mounted next to the panes, is now a panel in it.
- **Panels are mounted once and then hidden, never unmounted** — rebuilding one on every switch would
  discard its scroll position and state, and the outline rebuilds itself from the document.
- The rail is a **tablist** rather than a row of toggles, because the panels are alternatives and a
  screen reader has no other way to learn that. Arrow keys move between them.
- Pressing the active tab again **collapses** the sidebar; collapsing keeps the rail, because
  collapsing to nothing would leave no way back without a menu.
- The toolbar's Outline button now drives the sidebar rather than the pane's own visibility — two
  mechanisms deciding whether the outline is on screen would disagree the moment either was used alone.
- 11 new tests (1188 total).

**Not done:** the Files, Search and Tags panels FR-14.6 also names. Each needs a vault (FR-6.11–6.13)
that does not exist yet. The host is the seam they attach to: a panel is an id, a label, an icon and a
`mount`, and nothing about the host knows what any of them contain.

### feat/clipboard-dragdrop

- **Added rich paste, paste as plain text, Copy as Markdown / Copy as HTML, and OS file drops**
  (FR-7.4, FR-7.5).
- **Pasted HTML goes through mdast, not `parseDOM`.** The schema still has none: rather than a second
  definition of every node and mark kept in step by hand, pasted HTML takes the same
  `HTML → hast → mdast → ProseMirror` path the rest of the editor already speaks. Anything Markdown
  cannot express is dropped at that boundary, deliberately.
- **Plain text is parsed as Markdown by default** — text copied out of a Markdown file *is* Markdown.
  Pasting inside a code block always inserts characters.
- **`Ctrl+Shift+V` is an override, not a command**, because a ProseMirror command has no clipboard to
  read. The shell records the intent on keydown without calling `preventDefault` (the browser's paste
  event is the only thing carrying the clipboard) and the next paste consumes it.
- Copy as Markdown / HTML use the **async Clipboard API**, not `execCommand`: they write a
  *representation* of the selection rather than the selection itself.
- **File drops come from Tauri, not the DOM.** A DOM `File` has a name but no path, so a link built
  from it would point at nothing. Images embed; everything else becomes a link.
- Added `rehype-parse` and `rehype-remark` to `@k-doc/core`. 29 new tests (1177 total).

**Not done:** the Paste Special dialog and the paste-options popup. `pasteContent` already takes the
mode and `onRichPaste` already reports the range and original clipboard — what is missing is the UI.
Also `<mark>`/`<sub>`/`<sup>` on paste: `rehype-remark` has no mapping for the Tier-4 constructs, so a
pasted `<mark>` arrives as emphasis. There is a test asserting that rather than a comment hoping
otherwise.

### feat/insert-affordances

- **Added the image dialog (FR-8.14), the table size picker (FR-8.18) and the code-block language
  picker (FR-8.8)** — three choosers over machinery that already existed. The `image` node and the
  `codeBlock` language attribute were already in the schema; what was missing was any way to reach them.
- Each is an **app** command that opens a chooser, because the editor command underneath needs an
  argument only the user can supply.
- `insertImage` **replaces** a selected image rather than inserting beside it, so one command both
  inserts and edits; `imageAt` also looks at the node before the caret, which is what makes
  “insert, then immediately edit” work without reselecting.
- **Empty is `null`, everywhere** — alt, title and the fence info string. mdast distinguishes an absent
  title from an empty one, and two representations would make output depend on which path set it.
- The size picker anchors to the **caret**, not to the button: it is also reachable from the palette and
  the menu bar, where there is no button. Its 80 cells are built once, and it carries the same
  `mousedown` guard the format toolbar needed.
- The language list is a convenience, **not a whitelist**: Enter with no match takes the typed text
  verbatim, and a *None (plain text)* entry clears the language.
- 18 new tests (1134 total).

**Not done:** pasted image data written to an attachments folder. FR-8.14 names it, but the destination
is the vault attachment path from FR-6.14, which does not exist yet. The dialog's `pickFile` hook is the
seam a native picker will attach to.

### feat/rich-inline-marks

- **Added highlight `==x==`, subscript `~x~` and superscript `^x^`** (spec §4.4), completing
  FR-8.1's mark set: schema, parse, serialize, commands, `Ctrl+Alt+H` / `Ctrl+=` / `Ctrl+Shift+=`,
  toolbar, ribbon, command palette and input rules.
- **The transform needs the raw source, not just the tree.** remark resolves backslash escapes before
  it runs, so `\==x\==` and `==x==` have identical text values — only the source distinguishes them.
  `sourceOffsets` walks both with two pointers and skips any delimiter preceded by a backslash.
- **Pairing spans siblings.** `==**bold** x==` parses as three siblings, so the transform flattens a
  whole parent into tokens, pairs, and rebuilds rather than splitting one text node at a time.
- `remark-gfm` now runs with **`singleTilde: false`** so `~x~` is subscript while `~~x~~` stays
  strikethrough.
- **Positions are preserved wherever nothing changed** — a parent with no delimiter keeps its original
  children. Rebuilding every paragraph discarded the positions `nodeAtOffset` and the incremental
  serializer both depend on; a failure in the position suite is what caught it.
- `highlight` now outranks `strong` in the mark nesting order: putting `strong` first silently rewrote
  `==**bold**==` into `**==bold==**` on every WYSIWYG round trip.
- **Fixed overlapping delimiter hits** — the scanner matched `==` again from its second character, so
  an empty `====` came back out as six characters.
- New corpus fixture `12-rich-inline.md`. 29 new tests (1116 total).

**Cost worth stating:** a literal `^` or `~` in prose is now escaped on save. That is the price of
those characters becoming syntax, and the round trip stays stable either way.

### fix/start-script-port

- **Fixed `start.cmd` failing when a dev server was already on port 5173.** A Tauri run that dies
  while its Vite child survives leaves an orphan holding the port, and the launcher then died with a
  `strictPort` stack trace — a message about the wrong thing entirely.
- Added `scripts/port-5173.cmd`, which reports through its exit code: **0** free, **1** K-Doc's own
  server, **2** somebody else's. On 1 the launcher **attaches** to the running server rather than
  killing it — it did not start that process and has no business ending it. On 2 it refuses and names
  the PID.
- The server is identified by **what it serves** (`curl` for K-Doc's `<title>`), not by process name, so
  an unrelated `node.exe` on that port is never adopted. No `curl` means answer 2: the safe error is
  refusing to touch it.
- Both scripts use `if ... goto :label` with **no parenthesised blocks** — a `REM`-only `else` branch
  is a parse error in `cmd.exe` (`. was unexpected at this time`), which is how the first version broke.

### chore/start-script

- **Added `start.cmd`**, a root Windows launcher: `start.cmd` (dev), `start.cmd build`,
  `start.cmd test`. Batch rather than PowerShell, because a stock execution policy blocks unsigned
  `.ps1` files on double-click — the exact case the script exists for.
- Preflights Node, dependencies, the dictionary and the Rust toolchain. Every failure names the fix
  and the URL. A missing dictionary **warns and continues**, because spell check degrades to drawing
  nothing and a network problem must not stop the editor opening.
- Pauses only on failure: pausing on success leaves a dead console behind a running app.

### feat/spell-check

- **Added spell check** (FR-12.1, FR-12.2): red squiggles, right-click suggestions, `F7` review
  dialog, Ignore / Ignore All / Add to Dictionary, and a `Review` menu built from the command registry.
- **Rust judges words; the webview decides which words.** `spellbook` holds the dictionary because a
  552 KB wordlist has no business being parsed in the webview each launch — but Rust has no schema, so
  the FR-12.2 skip rules (code blocks, front matter, unknown nodes, `inlineCode`) stay in TypeScript and
  Rust is handed a de-duplicated word list.
- `link` is deliberately **not** skipped: the URL lives in the mark's `href`, so skipping marked text
  would skip the user's prose and leave the URL unexamined anyway.
- **Decorations map through edits rather than clearing.** Briefly stale beats briefly absent — clearing
  on each keystroke makes every squiggle in the document flicker while you type one word.
- **A missing dictionary reports nothing wrong.** Flagging everything would fill the document with red
  and be blamed on the text rather than the missing asset. A *corrupt* dictionary does report.
- **Ignore All is session-scoped and never persisted**; Add to Dictionary is the durable option, and
  the user dictionary lives in `localStorage` rather than `settings.json` — settings is a validated
  schema of settings, an unbounded word list is data.
- Added `npm run fetch-dictionary`: the 552 KB asset is gitignored, because committing a third-party
  blob to someone's repository is their call.
- **Fixed a CSS specificity bug found by looking at the dialog**: `.kdoc-spell-review-body`'s
  `display: flex` beat the user agent's `[hidden]` rule, so the empty review panels showed underneath
  “No spelling errors found.”
- 80 new TS tests (1086 total) and 8 new Rust tests (42 total), 4 of them against the **real** en-GB
  dictionary rather than an in-memory fixture.

**Not done:** grammar checking (FR-12.3). `spellbook` checks spelling only; grammar is a different
engine rather than a bigger dictionary.

### feat/tabs

- **Added multiple documents in tabs** (FR-6.8): a tab strip with middle-click close, drag to reorder,
  `Ctrl+N` / `Ctrl+W` / `Ctrl+Tab`, and an unsaved-changes prompt on close.
- **Refactored `EditorShell` into `mountDocument` / `unmountDocument`.** Thirteen controllers captured
  the session or the view at construction, so a tab switch rebuilds them rather than teaching each one
  to swap — the same logic in one place instead of thirteen.
- **Background documents store text, not live sessions.** A session kept alive would keep its bindings,
  watcher and autosave timers alive with it — a background document quietly writing files. The cost,
  stated plainly: a background document's **undo history does not survive** a tab switch.
- Closing activates the most recent **surviving** tab, not the neighbour — closing should return you to
  what you were last looking at. Closing the last document opens a fresh one rather than an empty window.
- **Fixed a layout bug that predates this work.** `.kdoc-shell` was a grid with five named rows and had
  grown to seven children, so the `1fr` had drifted onto the *table toolbar*, stretching it while the
  panes collapsed. It is now a flex column that cannot drift when the next row is added.
- 22 new tests (1006 total).

**Not done:** dragging a tab out to a new window. It needs Tauri multi-window and a way to hand a
document between windows, which is separate work from a tab strip.

### feat/native-menubar

- **Added the native menu bar** (FR-14.8), generated from the command registry.
- **The webview builds the menu spec and Rust only renders it.** Defining the menu in Rust would mean
  a second hand-maintained list of ids that could drift; this way “mirroring every command” is true by
  construction — a stronger guarantee than the ribbon gets, since the ribbon still names ids by hand.
- Groups by the registry's own `category`, so there is no second grouping table. Empty categories
  produce no submenu; `Find` is relabelled `Search`.
- `toAccelerator` emits `CmdOrCtrl` rather than `Ctrl` — costs nothing on Windows and removes a trap
  the day a Mac build happens. It is **total**: an unparseable part passes through, because the Rust
  error then names the offending item, which beats an exception in the translator.
- A clicked item re-reads the command list: the menu is a snapshot, the command must act on now.
- 19 new TS tests (984 total) and 4 new Rust tests (26 total).

**Not verified by hand:** the native menu itself only exists in the desktop build, so this is backed by
compilation against the real Tauri 2.11.5 menu API and unit tests on the translation, not by clicking it.

### feat/ribbon

- **Added the ribbon** (FR-14.1): a tabbed command surface with Home, Insert and View tabs, 34 buttons
  across 9 groups, built entirely from the command registry.
- Cycles **expanded → collapsed → hidden** from one command. Collapsed keeps the tab strip and drops
  the panel; clicking a tab while collapsed expands it again, because a collapsed ribbon whose tabs did
  nothing would look broken.
- **The layout references commands by id**, which is the registry paying off — and its one weakness. A
  test resolves every id against a live registry, because the failure mode is otherwise a silently
  missing button rather than an error.
- **Layout and Review tabs are omitted.** FR-14.1 names them, but there are no layout or review
  commands yet, and an empty ribbon tab is the same broken promise as an empty settings section.
- Buttons carry their shortcut in the tooltip, so the ribbon teaches the keyboard rather than
  competing with it, and every one has the `mousedown` guard the toolbars needed.
- `buildCommands()` is now the single place the registry is constructed, shared by the palette and the
  ribbon and called fresh each time, because a cached list reports stale enabled state.
- 19 new tests (965 total).

**Verified in a real browser:** three tabs, 34 buttons, 9 group captions; switching to View shows its
eleven commands; and the cycle command walks collapsed → hidden → expanded with the strip and panel
visibility changing independently as designed.

### feat/settings-window

- **Added the Settings window** (FR-14.14) on `Ctrl+,` and from the command palette, with live search.
- **Added settings persistence** (FR-14.15): a JSON file in the app data directory via two new Rust
  commands, with a localStorage fallback for the dev build.
- **This makes three earlier slices reachable**: typography, theme and the autosave policy now read
  what the user chose rather than the defaults.
- **Only four sections are rendered** — General, Editor, Appearance, Proofing — one per section that
  actually has settings behind it. An empty settings tab is a promise the app does not keep.
- **Settings persist on every change**, not behind an OK button: the dialog has no Cancel, so there is
  no pending state to discard, and a preference that only survives if you confirm it gets lost.
- `load()` never rejects and `save()` propagates — asymmetric on purpose. A malformed preferences file
  must not stop the editor opening; a failed save is something the user just asked for.
- A **missing** file is the normal first run and is not reported at all.
- Number inputs fall back to the previous value on empty or out-of-range input, because an empty
  number field reads as `NaN` and would otherwise be written into the file.
- `settings.json` is pinned by a test on **both** sides, so a rename on one is caught by the other.
- 19 new TS tests (946 total) and 2 new Rust tests (22 total).

**Not done:** per-vault overrides. `mergeSettingsLayers` exists and is built for it, but vaults do not.

### feat/zoom-typography

- **Applied the appearance settings** (FR-14.11): editor and monospace font families, font size, line
  height and reading width now drive the editor through CSS custom properties.
- **Added zoom** (FR-14.12): `Ctrl+Shift+>`, `Ctrl+Shift+<`, `Ctrl+0`, `Ctrl+-` as an alias,
  `Ctrl+wheel`, and three command-palette entries.
- **Zoom multiplies the font size rather than applying `transform: scale`** — a transform scales the
  pixel grid and blurs text; a font-size change re-lays-out and re-rasterises crisply.
- **Zoom is a discrete ladder.** Repeated ±10% on a float drifts until the displayed percentage stops
  matching the size; a test zooms in three times and out three times and asserts strict equality.
- Multi-word font families are quoted, and every family gets a fallback stack. Both failures are
  **silent** — invalid CSS is dropped whole, and a missing font falls back to the browser default — so
  both have tests rather than waiting to be found by a user.
- `readingWidth: 'full'` emits `max-width: none`; `readingWidthRem` returns `null` rather than
  inventing a number like 10000rem that reads as a measurement but means “no limit”.
- 17 new tests (927 total).

**Not yet reachable:** typography reads the defaults, because no Settings window writes to the store
yet. Zoom works but does not persist across a restart.

### feat/move-block-heading

- **Added block movement** (FR-8.27): `Alt+Up` / `Alt+Down` move the caret's top-level block past its
  sibling, carrying the caret with it so repeated presses work.
- **Added heading promote/demote** (FR-8.28): `Ctrl+Alt+Left` / `Ctrl+Alt+Right`. Promote moves the
  level number **down** (H3 → H2), because promoting makes a heading more important — stated in the
  code and pinned by a test, because it is the kind of thing a later edit inverts.
- All four appear in the command palette with their shortcuts.
- **Two deliberate limits, both commented and tested:** nested list-item movement is not implemented
  (it is a different operation with different rules), and heading changes do not carry the subtree
  (FR-8.28 calls that optional; it needs a different command with a different undo story).
- 18 new tests (910 total).

**Verified in a real browser** through the command palette: a paragraph between a list and the next
heading moved up above the list. The `Alt+Up` chord itself could not be driven through automation —
the same synthetic-key limitation that blocks `Enter` — so the keybinding is unverified by hand.

### feat/context-slash-menu

- **Added the right-click context menu** (FR-14.2), contextual to the caret: clipboard always,
  formatting when there is a selection outside a code block, link actions on or near a link, and table
  actions inside a table.
- **Added the `/` insert menu** (FR-14.4): typing `/` in an empty paragraph opens a filterable list of
  headings, lists, code block, quote, table and divider, each showing its Markdown shorthand.
- Both are built on one shared popup component, so they cannot both be open at once.
- **The popup is a plain positioned div, not a `<dialog>`** — the opposite choice from the command
  palette and for the opposite reason: a context menu must not take focus, or the commands it runs
  would act on a collapsed selection.
- Groups that do not apply are **omitted, not disabled**. A disabled item says the action exists but
  cannot run here; a whole inapplicable group is just noise.
- Choosing a slash item deletes the `/query` text first, and re-reads the trigger position rather than
  trusting the captured one — otherwise you pick “Heading 1” and get a heading reading `/head`.
- Fixed a stray indentation slip in `onStateChange` left by an earlier automated edit.
- 18 new tests (892 total).

**Verified in a real browser:** right-click opens the menu with the browser's own suppressed; typing
`/` opens the insert list; `/head` filters to the three headings with separators dropped; and choosing
Heading 2 leaves an empty `##` with the trigger text gone.

### feat/html-export-print

- **Added HTML export** (FR-13.1): a standalone document with styles inlined, from the command palette.
- **Added printing** (FR-13.3) on `Ctrl+P`, rendering into a hidden iframe so the printed page is the
  document rather than the application chrome.
- **Raw HTML is carried through, not stripped.** K-Doc preserves raw HTML verbatim (FR-4.4), so an
  export that escaped it would produce a different document than the user wrote. The consequence is
  tested and named: exported HTML contains whatever HTML the source did, and **would need sanitising
  before being served to anyone else**.
- The export stylesheet deliberately uses no CSS custom properties, with a test that fails if any
  appear — the exported file must stand alone, and app tokens resolve to nothing outside the app.
- Print stylesheet prints link URLs after the link text, because paper has no clickable links.
- Added `remark-rehype`, `rehype-raw` and `rehype-stringify` to `@k-doc/core`.
- 23 new tests (874 total).

**Not done, and worth stating plainly:** PDF export as its own command (FR-13.2) — reachable today via
Print → "Save as PDF", which is the same pipeline. The page-setup dialog is not built, so paper size,
orientation and margin are honoured but not yet reachable from the UI. Headers and footers with page
numbers **cannot** be done through this pipeline: Chromium does not support `@page` margin boxes.
Image embedding as data URIs is not done either — images export as the links the source carried.

### feat/preview-mode

- **Added Preview mode** (FR-5.4): a read-only, reading-optimised view, reachable from the segmented
  control, the command palette, or `Ctrl+/`.
- **Preview is the WYSIWYG pane with editing switched off, not a second renderer.** A separate HTML
  preview would be a second rendering path to keep in step, and the two would drift within a release.
- Added `ProseMirrorBinding.setEditable()` / `isEditable`. ProseMirror re-reads its `editable` prop on
  every state update, so a mutable field suffices — no view rebuild, so the caret and document survive.
- The format and table toolbars are hidden in Preview: every control on them would act on a pane that
  refuses edits, and a button that looks live but does nothing is worse than one that is absent.
- **Added `Ctrl+/` to cycle view modes** (FR-5.7). Preview sits last, because it is the only mode you
  cannot type in. An unrecognised mode restarts the cycle rather than leaving the shortcut inert.
- **Fixed:** the status bar labelled Preview as “Source”, because every non-WYSIWYG, non-split mode fell
  into a trailing `else`.
- Removed a `kdoc-segment` class from the Preview button that no stylesheet used and its three siblings
  did not have.
- 10 new tests (828 total).

**Verified in a real browser:** Preview renders read-only (`contenteditable="false"`) with both
toolbars hidden and the Source pane closed, and `Ctrl+/` cycles Split → Source → Preview → WYSIWYG → Split.

### feat/preview-sync-scroll

- **Added synchronised scrolling** between the two panes (FR-5.5), with a Sync Scroll toggle in the
  toolbar.
- **Anchored on block index, not line ratio.** A ratio sync drifts the moment one pane draws a block
  taller than the other — a code block, a table, an image — which in a Markdown editor is most
  documents. The same block now sits at the top of both panes however tall each draws it.
- The two anchor providers compute positions completely differently (DOM rect arithmetic for WYSIWYG,
  `lineBlockAt` for Source) but return them in the same frame; that equivalence is the contract.
- Guards for three traps: CodeMirror scrolls its own `.cm-scroller` rather than the pane div; setting
  `scrollTop` echoes a scroll event back; and anchors measured before layout are all zeroes.
- 12 new tests (818 total) covering the alignment algorithm, including panes that disagree on block
  count.

**Not done:** Preview mode (FR-5.4) is still absent — this slice covers the scrolling half of §5 only.

### feat/external-changes

- **Added external change detection** (FR-6.4): a `notify`-based filesystem watcher in the Rust host,
  emitting `kdoc://external-change` to the webview.
- **The watcher watches the parent directory, not the file.** Saving by temp-file-then-rename replaces
  the inode, so a watch on the file itself goes silent after the first external save — exactly the case
  this feature exists to catch.
- **Self-saves are filtered by comparing content, not by a time window.** K-Doc writes the file, the
  watcher fires, and the reconcile step sees the disk text already matches the buffer. A suppression
  window would be a race; content comparison cannot be.
- Events are debounced 150 ms (one external save produces a burst), deliberately shorter than the
  800 ms journal debounce so a change is reconciled before the journal records a doomed buffer.
- A **clean** buffer reloads silently with a status-bar note; a **dirty** buffer asks Reload / Keep mine /
  Decide later.
- Added `notify` to the Rust host and `FileService.readPath` for reading a known path with no dialog.
- 11 new TS tests (806 total) and 6 new Rust tests (20 total).

**Not done:** the three-way *merged diff* FR-6.4 also names. Two of the three resolutions are
implemented; the merge view is a separate piece of work, called out rather than quietly dropped.

### feat/autosave-recovery

- **Added autosave** (FR-6.2): off / on-blur / every N seconds / after N seconds idle, defaulting to
  idle-2s. It refuses to run on a document with no path — silently creating a file the user never
  named is worse than not saving.
- **Added crash recovery** (FR-6.3): the live buffer is journalled on an 800 ms debounce, and an
  unclean exit is met with a Restore / Discard / Not now offer at the next launch.
- The journal runs on a **shorter** timer than autosave and journals **even with no path** — exactly
  the case autosave refuses, because an unnamed buffer has nothing else protecting it.
- New Rust commands `journal_write`, `journal_list`, `journal_clear` writing temp-then-rename to app
  data. A journal half-written during a crash is the file recovery would read, so atomicity is the
  point. Journal ids are validated against `[A-Za-z0-9_-]` before becoming filenames.
- **Fixed before it shipped:** restoring through `reset` would have marked the document clean, handing
  back work that is not on disk and letting the user close without saving it. Restore now uses
  `applyExternalText`, which leaves the buffer dirty.
- `ConfirmDialog` accepts optional labels, so recovery can ask "Restore / Discard / Not now" rather
  than borrowing the unsaved-changes wording.
- Added `serde_json` to the Rust host. 22 new TS tests (795 total) and 4 new Rust tests (14 total).

**Verified in a real browser:** typing writes `kdoc.journal.buffer-main`; reloading offers to restore
it; accepting brings the text back in both panes and leaves the status bar reading **Modified**.

### feat/command-palette

- **Added the command palette** (`Ctrl+Shift+P`, FR-9.8): 41 commands, each showing its keybinding,
  fuzzy-searchable, with arrow-key navigation and full ARIA combobox semantics.
- **Added a command registry** as the single catalogue behind it. It is separate from the palette because
  the ribbon (FR-14.1) and native menu bar (FR-14.8) will need the same list, and three lists would drift.
- Commands that cannot apply are greyed out, using ProseMirror's dry-run form as the test — so the
  palette never offers a command that silently does nothing.
- The palette closes **before** running a command: editor commands focus the pane as their last act, and
  K-Doc keys its edit lock on focus, so running first would leave the lock pointing at nothing.
- `FileMenu` now exposes `open()`, `save()` and `saveAs()`, delegating to the same functions its buttons
  call, so the palette and the toolbar cannot drift apart.
- **New is deliberately absent**: the app has no new-document action yet, and a palette entry that does
  nothing is worse than one that is missing.
- 17 new tests (773 total).

**Verified in a real browser:** `Ctrl+Shift+P` opens the palette with 41 commands; typing `hed 2`
fuzzy-filters to Heading 2 alone; clicking it converts the paragraph and closes the palette.

### feat/input-rules

- **Added Markdown input rules** (FR-7.7): `# ` through `###### ` for headings, `- `/`+ `/`* ` for
  bullets, `1. ` for ordered lists, `> ` for blockquotes, ` ``` ` for code blocks, `---` for a thematic
  break, and `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` inline.
- `Backspace` immediately after a rule fires reverts it (`undoInputRule`), so a rule you did not mean
  costs one keystroke to undo.
- `markInputRule` is hand-written because `prosemirror-inputrules` ships no inline-mark rule. It clears
  the stored mark afterwards — otherwise `**bold** more` would come out entirely bold.
- The heading rule fires on the *space*, not the `#`, so `#hashtag` is left alone. The emphasis rule
  uses a negative lookbehind so it does not eat `**bold**` after the strong rule has had its turn.
- Added `prosemirror-inputrules` to `@k-doc/editor`.
- 18 new tests (756 total), typed character by character because that is the only path that fires rules.

**Verified in a real browser:** typing `## ` at the start of a paragraph converts it to a heading, and
typing `**bold**` one character at a time produces a real strong mark rather than escaped asterisks.
Bulk-inserting the same string does **not** fire the rules — ProseMirror skips the input-rule path for
non-incremental DOM changes, which is also what you want for pasted Markdown.

### feat/tables

- **Added GFM table editing** (Phase 1): insert, add/delete rows and columns, per-column alignment,
  delete table, and `Tab`/`Shift-Tab` cell navigation, with a Word-style contextual toolbar that
  appears only when the caret is inside a table.
- **Fixed a bug in the existing format toolbar.** No toolbar button prevented default on `mousedown`,
  so clicking one moved focus out of the editor, collapsed the selection, and ran the command against
  a caret at position 0 — **bold silently did nothing and an inserted table landed at the top of the
  document**. Keyboard shortcuts were unaffected, which is why it survived: `Ctrl+B` always worked.
- Every structural edit rebuilds the table instead of splicing positions, and rebuilt tables are always
  rectangular with the `align` vector spliced in lockstep — otherwise columns inherit their neighbour's
  alignment and the document re-parses with a shape the user never saw.
- `addRowBefore` on the header inserts below it rather than demoting the headings; `deleteRow` on the
  header promotes the next row. Both follow from mdast having no separate header node.
- 29 new tests (738 total), all asserting on the resulting Markdown rather than ProseMirror internals.

**Verified in a real browser**, not only in tests: insertion lands at the caret, the contextual group
shows and hides with the caret, Insert-table is disabled inside a table, adding a column widens every
row, and centring a column produces `| - | :-: | - | - |`.

### feat/ux-polish

- **Added** the three-way unsaved-changes dialog of FR-6.5: **Save / Discard / Cancel**, replacing a
  `window.confirm` that could not express "save first" and so forced a choice between losing work and
  abandoning the action. If the save fails, the open is abandoned rather than proceeding.
- **Fixed: `dirty` stayed true after undoing back to the saved text.** A flag set on every edit and
  cleared only on save cannot answer "is this different from what is on disk?" - the status bar claimed
  unsaved work that did not exist. The session now keeps `savedText` and compares against it.
- **Added** task-list rendering. The schema already emitted `data-checked` on every `<li>`, so the
  information was there and nothing drew it: a checklist looked exactly like a bullet list. Checked
  items now show a ticked box and read as done.
- **Added** a draggable split divider with keyboard control (arrows, `Home`, `End`, `Enter`). It sizes
  by `flex`, never pixels, so the row still responds to window resizing, and clamps to 15-85% because a
  pane dragged to zero width cannot be dragged back.
- A pending `ask` on the confirm dialog is resolved with `cancel` if a second one starts. An unresolved
  promise there is an `await` in the file menu that never returns, so Open would silently stop working.

### fix/shared-undo-in-source-pane

- **Fixed: the Source pane had its own undo history.** It installed `history()` and `historyKeymap` from
  `@codemirror/commands`, a second pane-local stack alongside the session's. `Ctrl+Z` there rewound
  CodeMirror's edit log, and that rewind reached the session as a *fresh edit* rather than as an undo —
  so the shared history grew instead of shrinking, and an edit made in the WYSIWYG pane could not be
  undone from the Source pane at all. Exactly the divergence the session-owned history exists to
  prevent (FR-3.5).
- Both panes now bind `Mod-z` / `Mod-y` / `Mod-Shift-z` straight to the session, in the same shape the
  WYSIWYG side already used, and both return `true` unconditionally so the keystroke never falls through
  to the browser's own undo.
- Two new tests dispatch a real `Ctrl+Z` keydown into the CodeMirror content DOM and assert on the
  **session**, which is what distinguishes a session undo from a pane-local one. The second undoes an
  edit made in the *other* pane — something a pane-local history cannot do at all.

### feat/outline-pane

- **Added** a Word-style navigation pane listing the document's headings, indented by depth, with the
  section containing the caret marked. Clicking a row reveals that heading in the Source pane. A toolbar
  toggle shows and hides it.
- **Added** `buildOutline` and `activeOutlineIndex` to `@k-doc/core` — pure, and tested in a bare Node
  process. Only top-level headings count as sections: one inside a blockquote or list item is not a
  section, and listing it would not match the document's own structure.
- **Added** `CodeMirrorBinding.onStateChange`, matching the ProseMirror binding. The active row follows
  the caret, and moving the caret changes no text, so the session never fires for it.

**One real defect found by the tests, one by the running app:**

1. **The pane rendered completely blank for a document with no headings.** The rebuild is skipped when
   the entries are unchanged, and on install the previous entries are already `[]` — so an empty
   outline compared equal to nothing-rendered and no DOM was ever produced, not even the pane's title.
2. **Clicking a row left the wrong row highlighted.** Navigation moves the caret but changes no text,
   so nothing refreshed the mark: the user navigated to one heading and watched another stay marked.

- The shell's `outlinePane` field is honestly nullable. CodeMirror can emit its first view update while
  the shell constructor is still running, and a `readonly` field reads as `undefined` before assignment
  whatever its type claims.

### feat/find-replace

- **Added** a Word-style find and replace bar (`Ctrl+F` / `Ctrl+H`) with match case, whole word and
  regular-expression modes, a live `n of m` readout, wrapping next/previous, Replace and Replace all.
- **Added** the search engine to `@k-doc/core`: `findMatches`, `replaceAll`, `replaceMatch`,
  `nextMatchIndex`, `InvalidQueryError`. Pure and string-only, so it is tested in a bare Node process.
- Search runs over the **Markdown source**, not a rendered projection: a user can search for `](` or
  `**`, and a replacement is a splice at known offsets that leaves untouched bytes identical.

**Two real defects found in the running app, both invisible to the unit tests:**

1. **The panes disagreed after Replace all.** The panel borrowed the Source pane's edit lock so the
   session would accept its edit; the Source binding then discarded the change as its own echo, because
   bindings infer an edit's origin from which pane holds the lock. The WYSIWYG pane updated and the
   Source pane did not. Fixed by adding `DocumentSession.applyExternalText` and an `'external'` change
   reason that no pane owns, so both bindings re-render. The edit still enters the shared undo history.
2. **A found match was invisible.** `revealRange` selects in the Source pane without focusing it (focus
   must stay in the find box for incremental search), and CodeMirror does not paint a native selection
   while unfocused. `drawSelection()` is now installed with a theme rule using `--kdoc-color-selection`.

- The panel takes an `onClose` callback so the host can return focus to a pane. Escape otherwise strands
  focus on a now-hidden input, and K-Doc keys its edit lock on which pane holds focus.

### feat/formatting-toolbar

- **Added** a formatting toolbar that reflects the caret (FR-8.4): marks show pressed, the block-type
  select follows the heading level, and every control disables itself when its command cannot apply.
- **Added** link commands (`linkAt`, `activeLink`, `canLink`, `setLink`, `removeLink`) and a native
  `<dialog>` link editor bound to `Ctrl+K` (FR-8.7).
- **Added** `ProseMirrorBinding.onStateChange`, the only signal that carries a selection-only change.
  Moving the caret changes no text, so the session never fires for it.

**Four real defects found and fixed; three were visible only in a browser.**

1. `linkAt` accumulated node sizes over the wrong index range, so `removeLink` stripped `A si` instead
   of `site`. The test asserting the resulting Markdown caught it; a test asserting only the range
   *length* had passed against that same broken range.
2. `Mark.eq()` was being handed a Node, and `parent.child()` throws rather than returning `undefined`
   when the index is out of range.
3. A `hidden` toolbar button stayed on screen: `.kdoc-format-button { display: inline-flex }` beats the
   UA stylesheet's `[hidden] { display: none }`. jsdom applies no cascade, so the unit test asserting
   `button.hidden === true` passed while the button was plainly visible.
4. The link dialog closed *after* notifying its host. A native `<dialog>` restores focus on close, so it
   undid the host's `view.focus()` - focus was stranded on the Link button and `Ctrl+K` then did nothing.

- **`setLink` trims whitespace from the selection.** A double-click selects the word *and its trailing
  space*, which a link renders faithfully as `[word ](url)`. Strong hides the same problem because
  Markdown cannot hold a trailing space inside `**...**`. Inline code was measured and needs no trimming.
- Toolbar tooltips were corrected against the real keymap rather than left advertising shortcuts that
  were never bound.

### feat/formatting-commands

- **Added** the Word-parity formatting commands (FR-8.1 to FR-8.9): bold, italic, strikethrough,
  inline code, clear formatting, headings 1-6, paragraph, code block, blockquote, bullet and ordered
  lists, task items, and thematic break — with the shortcuts from PRELIM-SPEC §20.
- **Fixed a real defect:** the ProseMirror binding created its `EditorState` with **no plugins at
  all**, so `Enter` did nothing and the WYSIWYG pane could not create a paragraph. `baseKeymap` is
  now installed alongside the K-Doc and list keymaps.
- **Undo and redo are bound to the session, not ProseMirror.** `prosemirror-history` is deliberately
  not imported — it would create a second undo stack that knows only about one pane.
- Every structural command tags its transaction `kdocStructural`, so formatting never merges into the
  user's last typing run.
- **Tests assert on Markdown, not internals.** Select a word, run bold, assert `**word**`. That covers
  the command, schema, both converters and the serializer in one assertion. 21 new tests, all in a
  bare Node process with no DOM.

**Verification note:** `Ctrl+B` was confirmed end to end in a browser (`- **Two** panes over one
document`). `Enter` could **not** be verified through browser automation: the synthetic keydown it
sends carries an empty `key` name, which no keymap can match. It needs a human keystroke or the
desktop app — the same lesson the webview probe taught about synthetic events.

### feat/file-io

- **K-Doc opens and saves real files.** Open / Save / Save As with `Ctrl+O`, `Ctrl+S` and
  `Ctrl+Shift+S`, a native file picker, and the current file name in the status bar.
- **Added** the Rust filesystem adapter: `read_text_file` and `write_text_file` alongside the
  existing report writer. The webview is never granted direct disk access — the Tauri capability
  set is the dialog plugin and nothing else, because there is deliberately no filesystem plugin.
- **Reads normalise nothing.** No line-ending conversion, no trimming. The round-trip contract
  depends on the bytes surviving, and normalising CRLF on read would silently rewrite every line
  of a Windows-authored file on its first save.
- **A UTF-8 BOM is preserved**, not added or removed behind the user’s back: it is stripped on read,
  recorded, and restored on write only if the file had one.
- **Decoding failure is an error, not a guess.** K-Doc refuses to guess an encoding, because
  mis-decoding a file and then saving it corrupts it. Other encodings are a later feature (FR-6.6).
- **Writes are atomic** (NFR-3): temp file in the same directory (a rename is only atomic within one
  filesystem), `write_all`, `sync_all` before the rename so a crash cannot leave a truncated file,
  then rename over the target. A failed write removes its temp file.
- **Honest degradation:** in a plain browser the file buttons are disabled with an explanation
  rather than failing on click. `npm run dev` in a browser is a development mode, not a broken app.
- Opening a file uses `session.reset` rather than an edit, so the undo history is cleared — undoing
  back into a different file’s content would be nonsense.

**Known gap:** the unsaved-changes prompt is a two-way `window.confirm`, which cannot express "save
first". FR-6.5 wants Save / Discard / Cancel and that needs a real dialog.

### feat/editor-shell

- **Added** `@k-doc/app` proper — the application shell. Toolbar with a WYSIWYG / Split / Source
  segmented control, two live panes over one document, a theme toggle cycling system/light/dark, and
  a status bar showing dirty state, word count, reading time, focused pane and view mode.
- **The app runs.** Typing in either pane updates the other, the status bar tracks it, and
  non-canonical formatting elsewhere in the document survives untouched — the whole stack, visible.
- **Added** `theme.ts`, which applies the `@k-doc/config` tokens as CSS custom properties and follows
  the system preference, but only while the mode is `system`.
- **Load-bearing rule:** when a view-mode switch hides the pane holding the edit lock, the shell moves
  focus to the visible pane. Leaving the lock with a hidden pane would make every keystroke throw.
- **Moved** the webview parity harness to `/probe.html` so `/` is the editor.
- `tsc --noEmit` now covers all four packages.

**Known gaps, all cosmetic:** task-list items render as plain bullets (the `checked` state
round-trips, but nothing draws a checkbox), there is no draggable split divider, and **there is no
file I/O** — the app opens a built-in sample and persists nothing.

### feat/codemirror-adapter

- **Added** `CodeMirrorBinding` — the Source pane. Simpler than the WYSIWYG binding in one way (the
  pane *is* text, so there is no document-model conversion) and harder in another: it must reflect
  edits made in the other pane.
- **Fixed a real bug the second pane exposed.** `ProseMirrorBinding` ignored every `'edit'` reason.
  That was correct while it was the only pane; it meant typing in Source would never have reached
  WYSIWYG. Both bindings now sync on `undo`/`redo`/`reset`, or on `edit` when the focused pane is not
  their own — the focused pane being a reliable origin signal precisely because the session refuses
  edits from a pane that does not hold the lock.
- **The bridge is complete.** Two panes edit one document, share one undo history, and byte
  preservation survives edits from either side.
- **Fixed** a test expectation asserting a leading space that CommonMark cannot preserve: an insertion
  after the trailing newline begins a new block, and a space at the start of a block is insignificant
  and normalised away. The serializer was right; the assertion was not.

### feat/prosemirror-view-binding

- **Added** `ProseMirrorBinding` — the live wiring between a `DocumentSession` and a ProseMirror
  `EditorView`, and the only file in the package that touches the DOM. Almost all of its complexity is
  about stopping the session and the view fighting each other: a loop guard so the session's response
  to an edit does not bounce back as a fresh edit; resynchronising only on undo/redo/reset so
  re-rendering never destroys the selection mid-typing; ignoring selection-only transactions so the
  undo history does not fill with empty steps; and recovering the view from the session when an edit
  is rejected, because leaving the view ahead of the session is how an editor ends up editing a
  document that no longer exists.
- **Fixed** the schema, which had no `toDOM` on any node or mark. `EditorView` renders every node
  through `spec.toDOM` unless a `nodeViews` entry exists, so constructing a view threw immediately and
  all 11 binding tests failed. Worth being precise: `toDOM` returns a data description (`['p', 0]`),
  performs no DOM calls, and does not compromise the module being DOM-free.
- **Security note:** `unknownBlock` and `unknownInline` render their carried source as a **text**
  child, never as markup. Those nodes hold arbitrary source including raw HTML, and injecting it would
  make the editor an XSS vector for its own documents.
- **Added** `dom-free.spec.ts`. The DOM-free claim used to be compiler-enforced, because the package's
  `lib` excluded DOM. The binding forced DOM types in, so the guarantee is now a test that reads the
  conversion layer's source. An architectural claim nobody checks is a comment, not a constraint.
- **Fixed** that guard's own false positive: scanning raw source matched `document.` inside JSDoc prose
  ("a ProseMirror document."). It now strips comments first, and the stripper itself has a test — one
  that accidentally removed real code would make the whole suite pass vacuously.

### feat/prosemirror-adapter

- **Added** `@k-doc/editor` — the engine adapters package. Its ProseMirror conversion layer uses only
  `prosemirror-model` and never `prosemirror-view`, so it is **DOM-free** and the most
  correctness-critical part of the WYSIWYG pane is tested in a bare Node process.
- **Added** the schema and both converters as one unit (DESIGN.md §7): `schema.ts`,
  `from-mdast.ts`, `to-mdast.ts`. A node the schema can express but a converter cannot restore would
  silently break the round-trip guarantee, so the three must always change together.
- **Nothing is dropped.** Raw HTML, footnote definitions, math, link references — anything the schema
  does not model richly is carried by `unknownBlock` / `unknownInline` atoms holding the original
  mdast node verbatim (FR-4.4). Not richly editable yet, but exact across a round trip.
- **Mark runs are grouped rather than wrapped per node**, so `**bold _and italic_**` produces one
  `strong` containing both children instead of two adjacent ones — matching the shape remark emits.
- **Fixed:** the converter omitted `start` on unordered lists on my instruction that "mdast does not
  carry one". remark emits `start: null`, so every bullet list differed by exactly that key. Five
  tests caught it, including two corpus fixtures.
- **Documented asymmetry:** ProseMirror's `doc` requires `block+`, so an empty mdast root becomes a
  document with one empty paragraph. It is the only non-information-preserving case, and a test
  asserts the behaviour explicitly so it cannot later be mistaken for a bug.

### feat/editor-bridge

- **Added** `DocumentSession` — the authoritative document state machine both editor panes are
  clients of (FR-3.1 to FR-3.5). It owns the text, the undo history and the edit lock, so a single
  Ctrl+Z means one thing regardless of which pane made the edit and survives a pane switch
  mid-history. Headless: no DOM, no framework, no engine imports, and therefore testable without a
  browser.
- **Added** `EditHistory` — undo/redo with typing-run coalescing, split out as its own concern
  (FR-7.3). Structural operations opt out of coalescing so they stay individually undoable.
- **The edit lock throws.** `applyTree` from an unfocused pane, or `applyText` from an unfocused
  pane, raises rather than proceeding. Allowing it would let the two document models diverge
  silently, which is far harder to diagnose than an immediate failure.
- **Fixed a coalescing bug before it shipped:** the merge branch overwrote the stored pre-edit text
  with the newer one, so a single undo would have landed the user in the middle of their own typing
  run instead of at its start. A history entry stores the state to return to, so a coalesced run must
  retain the text from before the run began.
- Undo restores text **byte-for-byte**, non-canonical formatting included — the bridge inherits
  byte preservation from the incremental serializer, and there is a test that stops a future refactor
  quietly routing edits through the whole-document path.

### feat/settings-and-theme

- **Added** `@k-doc/config` — headless settings schema and theme tokens, in their own package because
  they are not the Markdown engine and should not dilute `@k-doc/core`'s contract.
- **Settings** (FR-14.14, FR-14.15): typed schema with defaults, a layered merge (app defaults, then
  user, then per-vault), and a stable human-readable serializer whose key order is fixed so the file
  stays diffable — it is meant to be hand-edited. Two contracts: `parseSettings` **never throws**, so
  a corrupt file cannot stop the editor opening; and **unknown keys are preserved verbatim**, so a file
  written by a newer K-Doc survives an older one.
- **Theme tokens** (FR-14.9, FR-14.10, NFR-4): the documented contract user themes are written
  against, with light and dark palettes, `toCssVariables`, and WCAG relative-luminance and contrast
  maths. A parity test asserts both themes expose an identical token set so neither can drift.
- **Found and fixed by the new contrast gate:** a single `border` token was doing two jobs with
  different accessibility obligations. WCAG 2.2 SC 1.4.11 scopes non-text contrast to interactive
  component boundaries and focus indicators, not decorative rules — so the token was split rather
  than the threshold lowered. `border` stays a subtle divider with no obligation; `borderStrong`
  carries the 3:1 requirement and is asserted in both themes.
- **Phase 0 is complete.**

### feat/incremental-serializer

- **Added** `serializeIncremental(original, updated, style?)` — the FR-4.2 path. It treats the
  original source text as the base and rewrites only the byte ranges whose nodes actually changed,
  matching the old and new child sequences with position-free structural keys and an LCS diff.
- **Behaviour worth knowing:** an unchanged save takes a fast path that serializes nothing at all
  and returns the original text; and when position data is missing it falls back to whole-document
  serialization rather than guessing, signalled to callers by `reusedBytes === 0`. A
  correct-but-unminimal answer always beats a minimal-but-wrong one.
- **Strengthened** the wild corpus: every real-world document it finds is now asserted to survive an
  unchanged incremental save **byte-for-byte**. That turns FR-4.2 from a claim about fixtures into a
  claim about Markdown written by other people and other tools.
- **Fixed** a test that passed for the wrong reason — it built the position-less document and the
  updated tree identically, so the fast path returned before the bail-out it was meant to exercise
  could ever run.
- **Decided** Windows is the only release target for now (OQ-9 closed for that target). macOS and
  Linux are deferred rather than cancelled; portability discipline stays.

### feat/webview-spike

- **Added** `packages/app` — the webview parity spike harness answering OQ-9. Deliberately
  framework-free: the spike tests the webview, so it adds none of its own. Renders the probe
  results, a live-input panel, a ProseMirror smoke editor with a transaction counter, and a
  manual IME area logging composition events.
- **Added** `packages/app/src/probe/webview-probe.ts` — a portable, zero-import probe covering
  input, selection, composition, text and platform capability, each marked critical or not by
  whether ProseMirror's editing path depends on it. It can be lifted into a bare page on a
  machine with none of this project installed.
- **Added** `src-tauri` — a Tauri v2 host with a `save_probe_report` command. Path-traversal
  guarded, and the first piece of the filesystem adapter: every filesystem operation lives in
  Rust behind a narrow validated command.
- **Fixed** two probes that were reporting a critical engine failure that did not exist. They
  triggered input with `execCommand('insertText')`, which on Chromium 148 returns true and
  mutates the text while firing no `beforeinput` at all — on-screen and off. The behavioural
  question moved to a live-input panel that records only genuine `isTrusted` events.
- **Added** `docs/webview-parity.md` — OQ-9 findings, the self-inflicted defect above, the
  contingency ladder, and the procedure for running the probe on the remaining engines.

**Result:** Chromium 148 is green (19 pass, 0 critical failures; live `beforeinput` with
`inputType=insertText`, one target range, `isTrusted=true`, driving ProseMirror correctly).
WKWebView and WebKitGTK are **not yet run** — they need macOS and Linux hosts.

### feat/phase-0-remainder

- **Added** `position/map.ts` — the offset/AST mapping layer the editor bridge needs to preserve
  the caret when focus crosses between the WYSIWYG and Source panes: `nodeRange`, `offsetToPoint`,
  `pointToOffset`, `nodeAtOffset`, and `nodesInRange`.
- **Added** a wild-corpus suite running several hundred real-world Markdown documents from
  `node_modules` through the engine, asserting parser robustness, bounded serialization
  convergence, and text preservation.
- **Fixed** `pointToOffset` losing the round-trip property on CRLF documents. A line's addressable
  range now extends to its terminating `
` rather than stopping before the preceding `
`;
  without this the newline's own offset collapsed onto the carriage return's.
- **Changed** the wild-corpus contract from one-pass fixed point to bounded convergence, after the
  corpus showed the original assertion was simply wrong. CommonMark treats up to three leading
  spaces on a paragraph continuation line as insignificant and remark strips up to three per pass,
  so `postcss/README.md`'s five-space-indented `<img>` block settles over three passes. Pinned as a
  standalone regression test that does not depend on that package being installed.

### feat/phase-0-scaffold

- **Added** `PRELIM-SPEC.MD`, the functional specification: ~120 numbered requirements
  across 20 sections, a Word feature-parity map, a four-phase roadmap, and the open
  questions register.
- **Added** `DESIGN.md`, the living architecture document, plus a `GEMINI.md` pointer
  to it for Antigravity.
- **Decided** the platform (Tauri v2), the editor architecture (a ProseMirror +
  CodeMirror hybrid over a headless TypeScript core), the annotation store (sidecar,
  keyed by a lazily-added `kdoc_id`), image sizing (`![alt|600](img.png)`), store
  resolution (file-first with upward `.k-doc/` discovery), and the spellcheck engine
  (bundled Hunspell). Resolves OQ-1 through OQ-8.
- **Added** the npm workspace scaffold: root manifest, shared strict `tsconfig.base.json`,
  and the `@k-doc/core` package.
- **Added** `@k-doc/core` — the headless Markdown engine:
  - `parseMarkdown(text, options?)` — CommonMark + GFM + YAML/TOML front matter + math,
    with defensive YAML handling that degrades malformed metadata instead of failing.
  - `serializeDocument(doc, style?)` — AST to text under an explicit emission policy,
    with a verbatim handler for unmodellable `kdocRaw` nodes.
  - `MarkdownStyle` — the single place emitted syntax is decided (FR-4.3), with
    validation that fails fast and an unimplemented line-wrap policy that throws rather
    than silently no-opping.
- **Added** the golden-corpus round-trip suite — the FR-4.1 CI gate and Phase 0 exit
  criterion. 11 fixtures covering headings, emphasis, lists, code, blockquotes, links,
  images, tables, front matter, thematic breaks, task lists, and math; each asserted for
  byte identity, AST stability, and text preservation, plus 8 parser-robustness cases and
  a style-policy guard. 21 tests, all passing, with a clean `tsc --noEmit`.
