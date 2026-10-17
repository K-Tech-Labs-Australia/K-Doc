# Troubleshooting

This page lists common problems and how to fix them, and where K-Doc keeps its own files. If a problem is not here, the message in the status bar usually says what went wrong.

## Installing and starting

### Windows SmartScreen warns about the installer

K-Doc is not code-signed, and there are no plans to sign it, so SmartScreen cannot name the publisher. Choose **More info**, then **Run anyway**.

To check that the installer is the file the release built, compare its SHA-256 checksum with the one in the release notes. In PowerShell, in the folder you saved it to, run `Get-FileHash .\K-Doc_<version>_x64-setup.exe`; the hash it prints should match.

### K-Doc does not start on Windows 10

K-Doc needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11. On Windows 10, install the WebView2 Runtime from Microsoft, then start K-Doc again.

### K-Doc is not in the Open with list

The installer registers K-Doc for `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn` and `.mdwn` files. A file with another extension does not list K-Doc. Rename the file to one of these extensions, or start K-Doc and open the file with **File → Open**.

### Markdown files still open in another app

Installing K-Doc does not make it the default app; only you can do that, in Windows. Choose **Tools → Make K-Doc the Default for Markdown…** and confirm K-Doc on the Windows settings page that opens. See [Getting started](getting-started.md#make-k-doc-the-default-app-for-markdown-files).

### A double-clicked file opens in a different K-Doc window

K-Doc runs as a single app. A double-clicked file opens as a tab in the K-Doc window you used last. Click the other window before you double-click the file, or drag the tab to where you want it.

## Opening files

### "file is not valid UTF-8"

K-Doc opens files in UTF-8, or in UTF-16 with a byte order mark. It does not guess at other encodings, because saving a wrongly guessed file would damage it. Open the file in another editor, save it as UTF-8, then open it in K-Doc.

### "it is larger than 64 MiB"

K-Doc does not open text files larger than 64 MiB. Split the file into smaller ones.

### K-Doc asks "Allow access?"

A link in the document points to a file you have not opened in K-Doc before. K-Doc reads only files and folders you have chosen. Choose **Open** to open the file, or **Cancel** to leave it closed. See [Getting started](getting-started.md#allow-k-doc-to-open-a-file).

### A recent file does not open

The file has moved, been renamed or been deleted since you last opened it. Open it from its new place with **File → Open**. To remove the old entry, choose **File → Open Recent** and click **✕** beside it.

### Some files from the last session were not reopened

The status bar says how many files from the previous session could not be reopened. They have moved, been renamed or been deleted. Open them again from their new place. Untitled documents are never reopened with a session; K-Doc offers their text through crash recovery instead.

### The document says "Locked" and will not take typing

The file is read-only on disk. Click **Locked** in the status bar, or choose **File → Unlock Document**, then choose **Unlock**. If K-Doc reports that the file could not be unlocked, Windows refused the change: check that your Windows account is allowed to change the file.

## Saving

### Autosave does not save my document

Autosave never saves a document that has no file yet. Save a new document yourself once with `Ctrl+S`; autosave takes over after that. Autosave also skips locked documents, and it does nothing when **Autosave** is **Off** in **Tools → Settings → Editor**.

### Unsaved work was offered back when K-Doc started

K-Doc keeps a recovery copy of every open document while you type. If it stopped before you saved, the next start asks **Restore unsaved work?** Choose **Restore** to get the text back, **Discard** to delete the copy, or **Not now** to be asked again next time.

### The file changed in another program while it was open

If you have no unsaved changes, K-Doc reloads the file and says so in the status bar.

If you do have unsaved changes, K-Doc shows your edits and the changes on disk side by side:

| Button | What it does |
| --- | --- |
| **Apply merge** | Keeps both sets of changes where they fit together. The result is not saved yet. |
| **Keep mine** | Keeps your version. Your next save overwrites the other program's changes. |
| **Use theirs** | Loads the version on disk and drops your unsaved changes. |
| **Decide later** | Leaves your version on screen and asks again at the next change on disk. |

### Changes in the second pane were lost

A document opened with **View → Another Document Beside This One…** has no autosave and no crash recovery, and closing its pane does not ask about unsaved changes. Click **Save** on the pane's strip, or press `Ctrl+S` with the caret in it, before you close it.

### A saved file has different line endings or encoding

K-Doc saves a file back in the encoding and line endings it was opened with. Check the encoding in the status bar: if you clicked it, the next save uses the encoding it now shows. New documents are saved as UTF-8 with LF line endings. See [Getting started](getting-started.md#keep-your-markdown-as-you-wrote-it).

## Spelling, grammar and export

### Spell check underlines nothing

- Check that **Spell check** is on in **Tools → Settings → Proofing**, and that **Review → Spelling & Grammar → Toggle Spell Check** is on.
- If K-Doc has no dictionary for the document's language, it asks **Download a dictionary?** Choose **Download**. If you chose **Not now**, click the language in the status bar and choose the language again to be asked again.
- If the status bar says there is no dictionary for the language at all, K-Doc has none to offer for it. Choose another language from the status bar.

See [Reviewing](reviewing.md).

### "No grammar service is set"

K-Doc has no built-in grammar checker and sends nothing anywhere until you name a service. Enter the address of a LanguageTool-compatible service in **Tools → Settings → Proofing → Grammar service URL**, then choose **Review → Spelling & Grammar → Check Grammar**.

### Export as LaTeX or EPUB does not work

These two formats go through Pandoc, which K-Doc does not install. Install Pandoc so that it is on your `PATH`, then restart K-Doc. See [Export and print](export-and-print.md).

### K-Doc asks before opening every web link

K-Doc asks **Open External Link?** before it opens a web link in your browser. Choose **Always trust** with the site's name to stop it asking for that site. To stop it asking for every site, clear **Confirm external links** in **Tools → Settings → General**.

## Settings and plugins

### "settings in the settings file could not be read"

A value in K-Doc's settings file is the wrong type or out of range. K-Doc used the default for that setting and kept everything else. Open **Tools → Settings** and set it again, which writes a valid value. If you edited `settings.json` by hand, check your change against the [Settings reference](settings-reference.md).

### A plugin did not load

The status bar reports how many plugin problems there were. The Plugins panel lists them. After you fix a plugin, choose **Tools → Reload Plugins**. See [Customising K-Doc](customising.md).

## Where K-Doc keeps its data

K-Doc keeps its own files in your Windows user profile, in `%APPDATA%\au.ktechlabs.kdoc`. To open it, paste that path into the File Explorer address bar.

| In that folder | Holds |
| --- | --- |
| `settings.json` | Your settings, including the list of recent files |
| `grants.json` | The files and folders you have chosen, so K-Doc can open them again |
| `journal` | Recovery copies of unsaved work |
| `store` | Comments, tracked changes and version history for files that are not in a vault |
| `dictionaries` | Spelling dictionaries you have downloaded |
| `themes` | Your own app themes |
| `export-themes` | Your own export themes |
| `plugins` | Your plugins |

A vault keeps its comments, tracked changes and version history in a `.k-doc` folder inside the vault folder instead. See [Vaults](vaults.md).

Your last session's layout, and choices you make for a single document, such as its spelling language, are kept in K-Doc's internal storage rather than in these files.

### Reset K-Doc's settings

1. Close K-Doc.
2. Rename `settings.json` in `%APPDATA%\au.ktechlabs.kdoc`, for example to `settings-old.json`.
3. Start K-Doc. It starts with the default settings.

Your recent files list is stored in `settings.json`, so it starts empty. Your documents are not affected.

### Remove K-Doc

Uninstall K-Doc from Windows' list of installed apps. The uninstaller offers to delete K-Doc's application data as well. If you keep it, your settings are still there when you reinstall, and the installer does not ask again about making K-Doc the default app.

## See also

- [Getting started](getting-started.md)
- [Settings reference](settings-reference.md)
- [Reviewing](reviewing.md)
- [Export and print](export-and-print.md)
- [Customising K-Doc](customising.md)
