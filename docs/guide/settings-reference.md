# Settings reference

This page lists every setting you can change in K-Doc, with its label, what it does, the values it accepts, and its default. It follows the order of the Settings dialog, then covers the settings you change elsewhere.

## Open the Settings dialog

Press `Ctrl+,`, or choose **Tools → Settings**. Type in **Search settings…** to show only the settings whose label contains your text.

Each change applies and is saved as soon as you make it. There is no OK or Cancel button: click **Close**, or press `Escape`, when you are done.

## Where settings are stored

K-Doc writes your settings to `settings.json` in its application data folder:

`%APPDATA%\au.ktechlabs.kdoc\settings.json`

You can edit this file by hand while K-Doc is closed. If a value is missing or not one K-Doc accepts, K-Doc uses the default for that one setting and keeps the rest. If the whole file cannot be read, K-Doc starts with the defaults. Keys K-Doc does not recognise, for example from a newer version, are kept when it saves.

The name in brackets after each label below is the setting's key in `settings.json`.

## General

| Setting | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| **Keep comments in the file** (`general.portableComments`) | Writes the document's comments into the Markdown file itself, as HTML comments, so they travel with the file. When off, every comment stays out of the document text. | On, Off | Off |
| **Restore session on launch** (`general.restoreSessionOnLaunch`) | Reopens the documents you had open last time when K-Doc starts. | On, Off | On |
| **Confirm external links** (`general.confirmExternalLinks`) | Asks before opening a web link in your browser. | On, Off | On |
| **Developer mode (Fidelity Check on save)** (`general.developerMode`) | Checks each save for changes to parts of the file you did not edit, and lists any in the **Problems** panel. Meant for people working on K-Doc itself. | On, Off | Off |
| **Author name** (`general.authorName`) | The name put on your comments and tracked changes. | Any text that is not blank | `You` |
| **Attachments folder** (`general.attachmentsFolder`) | The folder a pasted or dropped image is saved in. A relative path is taken from the document's own folder. Leave it empty to use the document's own folder. | A folder path, or empty | `attachments` |
| **Attachment name template** (`general.attachmentNameTemplate`) | How a saved image is named. You can use `{name}`, `{doc}`, `{date}`, and `{time}`. Leave it empty to use the default. | Text, or empty | `{name}-{date}` |

## Editor

| Setting | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| **Default view mode** (`editor.defaultViewMode`) | The view a new window starts in. A restored session uses the view it was saved in. | **K-Doc**, **Source**, **Split** | **Split** |
| **Split orientation** (`editor.splitOrientation`) | K-Doc saves this choice but does not yet act on it. | **Vertical**, **Horizontal** | **Vertical** |
| **Reveal syntax markers** (`editor.revealSyntaxMarkers`) | K-Doc saves this choice but does not yet act on it. | On, Off | On |
| **Smart substitutions** (`editor.smartSubstitutions`) | Turns all the typing substitutions below on or off together. When off, none of them apply, whatever their own switch says. | On, Off | On |
| **Smart quotes** (`autocorrect.smartQuotes`) | Turns straight quotes into curly quotes as you type. | On, Off | On |
| **Dashes (-- and spaced -)** (`autocorrect.dashes`) | Turns `--` and a hyphen with a space on each side into a dash. | On, Off | On |
| **Ellipsis (...)** (`autocorrect.ellipsis`) | Turns three full stops into an ellipsis character. | On, Off | On |
| **Ordinal superscripts (1st)** (`autocorrect.ordinals`) | Raises the letters after a number, as in 1st and 2nd. | On, Off | Off |
| **Capitalise sentences** (`autocorrect.capitalizeSentences`) | Capitalises the first letter of a sentence. | On, Off | Off |
| **Replace text as you type** (`autocorrect.replaceText`) | Applies the replacement table, for example `teh` to `the`. | On, Off | On |
| **Replacement table** | Click **Edit…** to change the replacement table. | A list of pairs | `(c)`, `(r)`, `(tm)`, and four common misspellings |
| **Snippets (prefix + Tab)** (`snippets.enabled`) | Expands a snippet when you type its prefix and press `Tab` in the K-Doc view. | On, Off | On |
| **Snippet list** | Click **Edit…** to add, change, or delete snippets. | A list of prefixes and texts | K-Doc's starter snippets |
| **Allow HTML formatting** (`editor.allowHtmlFormatting`) | Lets K-Doc write HTML into the file for formatting Markdown cannot express, such as aligning a paragraph. The alignment is lost wherever HTML is removed. | On, Off | Off |
| **Input rules** (`editor.inputRules`) | K-Doc saves this choice but does not yet act on it. | On, Off | On |
| **Autosave** (`editor.autosave`) | When K-Doc saves a document for you. **Off** never does. **On blur** saves when you switch to another window. **Interval** saves every few seconds while there are unsaved changes. **Idle** saves after you stop typing. | **Off**, **On blur**, **Interval**, **Idle** | **Idle** |
| **Autosave delay (ms)** (`editor.autosaveDelayMs`) | For **Interval** and **Idle**, how long K-Doc waits, in milliseconds. K-Doc rounds it to whole seconds, with a minimum of 1 second. | 200 to 60000 | 2000 |
| **Snapshot on save** (`history.snapshotOnSave`) | Takes a version-history snapshot each time you save. | On, Off | On |
| **Snapshot every (minutes, 0 = off)** (`history.snapshotMinutes`) | Also takes a snapshot of an open, saved document this often. Use 0 to turn it off. | 0 to 1440 | 10 |

## Appearance

| Setting | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| **Theme** (`appearance.theme`) | Light or dark. **System** follows Windows. | **System**, **Light**, **Dark** | **System** |
| **Colour theme** (`appearance.uiTheme`) | Which built-in colour theme K-Doc uses. | **K-Doc**, **Nord**, **Solarized**, **Paper**, **Graphite**, **High Contrast** | **K-Doc** |
| **Editor font family** (`appearance.editorFontFamily`) | The font for the document. | A font name, not blank | `Segoe UI` |
| **Monospace font family** (`appearance.monospaceFontFamily`) | The font for code and the Source view. | A font name, not blank | `Cascadia Mono` |
| **Editor font size (px)** (`appearance.editorFontSizePx`) | The size of the document text, in pixels. | Whole numbers from 8 to 72 | 16 |
| **Line height** (`appearance.lineHeight`) | The space between lines, as a multiple of the font size. | 1.0 to 3.0 | 1.6 |
| **Display density** (`appearance.density`) | How much space sits between blocks. A document can override it. | **Compact**, **Comfortable**, **Spacious** | **Comfortable** |
| **Reading width** (`appearance.readingWidth`) | How wide the text column is. A document can override it. | **Narrow**, **Medium**, **Wide**, **Full** | **Medium** |

See [Customising K-Doc](customising.md) for the theme menu and for giving one document its own width or density.

## Proofing

| Setting | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| **Spell check** (`proofing.spellCheck`) | Underlines words the dictionary does not know. | On, Off | On |
| **Grammar service URL** (`proofing.grammarEndpoint`) | The address of a LanguageTool-compatible grammar service. K-Doc sends the document's text to it only when you run **Check Grammar**. Leave it empty and nothing is sent anywhere. The address must use `https` unless the service runs on your computer or local network. | A URL, or empty | Empty |
| **Language** (`proofing.language`) | The language a document is checked in when nothing else names one. | A language tag, such as `en-GB` | `en-GB` |
| **Detect each document's language** (`proofing.detectLanguage`) | Guesses a document's language from its text when neither the document nor you name one. The status bar says when the language is a guess. | On, Off | On |

## Export

| Setting | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| **Comments in exports** (`export.comments`) | Whether comments go into exported and printed documents, and where. | **Leave out**, **As endnotes**, **In the margin** | **Leave out** |
| **Export theme** (`export.theme`) | The stylesheet HTML exports and printouts use. **File → Export → Export Theme** offers the same choice as a list. | `default`, `serif`, `compact`, `plain`, or the name of your own export theme | `default` |

See [Export and print](export-and-print.md).

## Settings you change elsewhere

These settings are saved in the same file but are not in the Settings dialog.

| Setting | Where you change it | Default |
| :--- | :--- | :--- |
| Keyboard preset (`keyboard.preset`) | **Help → Keyboard Shortcuts**, **Preset** list. Values: **Word**, **VS Code**, **Typora**, **Obsidian**. | **Word** |
| Your own shortcuts (`keyboard.bindings`) | **Help → Keyboard Shortcuts** | None |
| Ribbon arrangement (`appearance.ribbon`) | **Tools → Ribbon → Customise Ribbon…** | K-Doc's own ribbon |
| Your own app theme (`appearance.userTheme`) | **View → Theme → App Theme** | None |
| Trusted link domains (`general.trustedDomains`) | Click **Always trust** when K-Doc asks before opening a web link. Links to that domain then open without asking. A subdomain is not covered by its parent domain. | None |

## Settings only in the file

These settings control how long version-history snapshots are kept. They have no control in K-Doc, so edit `settings.json` while K-Doc is closed.

| Key | What it does | Values | Default |
| :--- | :--- | :--- | :--- |
| `history.keepAllHours` | Every snapshot younger than this many hours is kept. | Whole numbers from 0 to 8760 | 24 |
| `history.keepHourlyDays` | Up to this many days old, the newest snapshot of each hour is kept. | Whole numbers from 0 to 3650 | 7 |
| `history.keepDailyDays` | Up to this many days old, the newest snapshot of each day is kept. Older snapshots are deleted. | Whole numbers from 0 to 36500 | 90 |

## Choices K-Doc remembers outside the settings file

K-Doc also remembers some choices on this computer without writing them to `settings.json`:

- **Ribbon state**, whether the ribbon is expanded, collapsed, or hidden.
- **A document's own reading width and display density**, set from **View → Reading Width**.

## See also

- [Customising K-Doc](customising.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Reviewing](reviewing.md)
- [Export and print](export-and-print.md)
- [Troubleshooting](troubleshooting.md)
