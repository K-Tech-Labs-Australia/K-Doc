# Getting started

This page covers installing K-Doc, opening and saving documents, the three views, tabs and windows, and how K-Doc protects your work and your files. Read it first, then move on to [Writing and formatting](writing-and-formatting.md).

## Install K-Doc

K-Doc runs on Windows 10 and 11.

1. Download `K-Doc_<version>_x64-setup.exe` from the [K-Doc Releases page](https://github.com/K-Tech-Labs-Australia/K-Doc/releases).
2. Run it. The installer installs K-Doc for your Windows user only, so it does not need administrator rights.
3. If Windows SmartScreen warns that the publisher is unknown, choose **More info**, then **Run anyway**. The installer is not code-signed yet, so Windows cannot name the publisher.

K-Doc draws its window with Microsoft Edge WebView2. WebView2 is part of Windows 11. If K-Doc does not start on Windows 10, see [Troubleshooting](troubleshooting.md).

The installer registers K-Doc for Markdown files with these extensions: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn` and `.mdwn`. K-Doc then appears in the **Open with** list for those files.

## Make K-Doc the default app for Markdown files

The first time you install K-Doc, the installer asks **Make K-Doc the default app for Markdown files?** **No** is selected unless you choose otherwise.

If you answer **Yes**, Windows opens its Default apps settings at the page for K-Doc. Confirm the choice there. Windows lets only you change a default app, so K-Doc cannot make itself the default.

The installer asks this question once. Upgrading or reinstalling does not ask again. To do it later, choose **Tools → Make K-Doc the Default for Markdown…**, which opens the same Windows settings page.

## Open a Markdown file from File Explorer

Double-click a Markdown file to open it in K-Doc.

- If K-Doc is not running, it starts and opens the file in front.
- If K-Doc is already running, the file opens as a new tab in the K-Doc window you used last. K-Doc never starts a second copy of itself.
- If the file is already open in that window, K-Doc switches to its tab instead of opening it twice.

## The welcome page

When K-Doc starts with nothing else to open, it shows **Welcome to K-Doc**. The page is a short tour of the editor, written in Markdown. It is untitled, so nothing is written to disk unless you save it, and the first save asks where to put it.

The welcome page closes by itself when K-Doc reopens your previous session or opens a file you double-clicked.

## Find your way around the window

The top bar of the window holds the menus, the view buttons and the theme button. Drag an empty part of it to move the window, and double-click an empty part to maximise it.

The menus are **File**, **Edit**, **Insert**, **Format**, **Table**, **View**, **Review**, **Tools** and **Help**. Hold `Alt` and press the underlined letter to open one from the keyboard:

| Menu | Keys |
| --- | --- |
| File | `Alt+F` |
| Edit | `Alt+E` |
| Insert | `Alt+I` |
| Format | `Alt+O` |
| Table | `Alt+T` |
| View | `Alt+V` |
| Review | `Alt+R` |
| Tools | `Alt+L` |
| Help | `Alt+H` |

Below the top bar is the ribbon, with the **Home**, **Insert**, **Review** and **View** tabs. A **Table** tab appears while the caret is in a table. `Ctrl+F1` (**Tools → Ribbon → Cycle Ribbon**) changes how much of the ribbon is shown.

The status bar at the bottom shows whether the document is saved, its file name, word and character counts, the view, the encoding and the spelling language. Some of these parts are buttons: click the word count for statistics, the view name to switch views, and the encoding to change it. To hide or show the status bar, use **View → Panels → Status Bar**.

Every command is also in the command palette. Press `Ctrl+Shift+P` (**Tools → Command Palette**), type part of a command's name, and press `Enter`.

The shortcuts on this page are K-Doc's defaults. If you chose another keyboard preset, see [Keyboard shortcuts](keyboard-shortcuts.md).

## Create a new document

Choose **File → New** or press `Ctrl+N`. The new document opens in its own tab and is untitled until you save it. You can also click **+** at the end of the tab strip.

## Open a document

Choose **File → Open** or press `Ctrl+O`, then pick a Markdown file.

**File → Open** opens the file in place of the document in the current tab. If that document has unsaved changes, K-Doc asks whether to save them first. To keep the current document open as well, press `Ctrl+N` for a new tab and then open the file.

To open a note in a vault by name, use **File → Quick Open** (`Ctrl+Shift+O`). See [Vaults](vaults.md).

## Open a recent file

Choose **File → Open Recent**. The list shows each file's name and the folder it is in, newest first.

- Click a file to open it in a new tab.
- Click the pin button beside a file to keep it at the top of the list. Click it again to unpin it.
- Click **✕** to remove a file from the list. This does not delete the file.

The list survives a restart. If a file has moved or been deleted since you last opened it, K-Doc says so instead of opening it.

## Save a document

| To | Do this |
| --- | --- |
| Save the document | **File → Save** or `Ctrl+S` |
| Save it under a new name or in a new place | **File → Save As** or `Ctrl+Shift+S` |
| Write a copy to another file and keep working on this one | **File → Save a Copy** |
| Rename the file on disk | **File → Rename** or `F2` |
| Show the file in File Explorer | **File → Reveal in File Explorer** |

Saving an untitled document is the same as **Save As**: K-Doc asks where to put it.

**Rename** changes the file's name in the same folder. To move a file to another folder, use **Save As**.

## Switch views

K-Doc shows one document in three views:

| View | What you see |
| --- | --- |
| **K-Doc** | The formatted document. You edit it directly, like a word processor. |
| **Split** | K-Doc and Source together, side by side or stacked. |
| **Source** | The raw Markdown, as it is in the file. |

To switch, click **K-Doc**, **Split** or **Source** in the top bar, or choose the view from the **View** menu. `Ctrl+/` (**View → Cycle View Mode**) moves through K-Doc, Split and Source in turn. Clicking the view name in the status bar does the same.

In Split view you can type on either side. Both sides share one undo history, so `Ctrl+Z` undoes your last change whichever side you made it in. **View → Panels → Sync Scroll** keeps the two sides scrolled to the same place.

### Choose the view K-Doc starts in

Open **Tools → Settings** (`Ctrl+,`) and set **Editor → Default view mode** to **K-Doc**, **Source** or **Split**. The default is **Split**.

When K-Doc reopens your previous session, it uses the view you had last, not this setting. See [Reopen your last session](#reopen-your-last-session).

**Editor → Split orientation** sets whether Split view puts the two sides next to each other (**Vertical**, the default) or one above the other (**Horizontal**).

## Work with tabs

Each open document has a tab. The tab strip appears below the ribbon once a second document is open.

- Click a tab to switch to it. `Ctrl+Tab` (**File → Next Document**) moves to the next one.
- A dot on a tab means the document has unsaved changes.
- Drag a tab along the strip to change the order.
- Click **×** on a tab, middle-click the tab, or press `Ctrl+W` (**File → Close Document**) to close it.

If you close a document with unsaved changes, K-Doc asks **Close document?** Choose **Save**, **Discard** or **Cancel**.

## Move a tab to its own window

Drag a tab off the tab strip, for example down onto the document, and let go. The document opens in a new K-Doc window and leaves the first one.

The document keeps its file, its unsaved changes and its encoding, so K-Doc does not ask you to save first. Press `Esc` during the drag to cancel it.

## Show a second document beside the first

Choose **View → Another Document Beside This One…** and pick a file. It opens in a second pane to the right of the current document.

A strip at the top of the second pane names the file and shows **Edited** when it has unsaved changes, or **Read-only** when the file cannot be saved. Its **Save** button saves that file. `Ctrl+S` saves the document the caret is in.

The second document is simpler than a tab:

- It has no autosave and no crash recovery, and it is not reopened with your session.
- **Close** on its strip closes the pane without asking, and unsaved changes are lost. Save first.
- The ribbon, find, comments, spelling and the outline work on the first document only.

To see two parts of the same document at once, choose **View → Second Pane on This Document** instead. Choose it again to close the second pane.

## Save automatically

K-Doc saves a document by itself after you stop typing for 2 seconds. Change this in **Tools → Settings → Editor**:

| Setting | What it does |
| --- | --- |
| **Autosave** | **Off**: never save by itself. **On blur**: save when you switch away from the K-Doc window. **Interval**: save at a fixed interval. **Idle**: save once you stop typing (the default). |
| **Autosave delay (ms)** | The wait for **Interval** and **Idle**, in milliseconds, from 200 to 60000. The default is 2000. K-Doc rounds it to whole seconds, with a minimum of 1 second. |

Autosave only saves documents that already have a file. Save a new document yourself once, and autosave takes over from then on. Autosave does not save a locked document.

Each save also keeps a copy in the document's version history, unless you turn off **Snapshot on save** in the same section. See [Reviewing](reviewing.md).

## Reopen your last session

When you start K-Doc, it reopens the files you had open, puts the same one in front, and restores the view, the split, the side panels and where you had scrolled to in the front document.

To turn this off, open **Tools → Settings → General** and clear **Restore session on launch**. Turning it off also forgets the stored session.

A restored session includes only saved files, up to 30 of them. Untitled documents are not reopened; crash recovery looks after their text instead. If some files have moved or been deleted, K-Doc opens the rest and tells you how many it could not reopen. The second pane and the zoom level are not restored.

## Recover unsaved work after a crash

While you type, K-Doc keeps a recovery copy of every open document, including untitled ones. If K-Doc or Windows stops before you save, the next start asks **Restore unsaved work?** for each document it found:

- **Restore** opens the file the work belongs to, or a new untitled document, and puts the unsaved text back. The text is not saved yet, so save it.
- **Discard** deletes the recovery copy.
- **Not now** keeps the recovery copy and asks again next time.

When you close K-Doc normally with unsaved documents, it shows each one and asks **Save changes?** with **Save**, **Don't Save** and **Cancel**. **Don't Save** also deletes that document's recovery copy, so it is not offered back to you.

## Open a read-only document

A file that is read-only on disk opens locked. Neither view accepts typing, saving is refused, and the status bar shows **Locked**.

To edit it, click **Locked** in the status bar or choose **File → Unlock Document**. K-Doc asks **Unlock this file?** Choose **Unlock** to clear the file's read-only attribute on disk, so it can be saved.

- If Windows refuses the change, K-Doc says so and the document stays locked.
- A file made read-only while it is already open stays editable until you open it again.
- You cannot lock a writable file from inside K-Doc.

## Allow K-Doc to open a file

K-Doc reads and writes only files and folders you have chosen. You choose a file when you open it, save it, drop it on the window or double-click it, and you choose a folder when you open it as a vault. K-Doc remembers these choices between sessions.

When a link in a document points to a file you have not chosen, K-Doc asks **Allow access?** and names the file. Choose **Open** to open it, or **Cancel** to leave it closed.

## Keep your Markdown as you wrote it

K-Doc writes back exactly what you did not change. When you save, every block you did not touch keeps its exact bytes: spacing, list markers, blank lines and all. A block you edited is written in K-Doc's own Markdown style.

To check this for yourself, turn on **Developer mode (Fidelity Check on save)** in **Tools → Settings → General**. Each save then reports any byte that changed outside the parts you edited.

### Encodings

K-Doc reads files in these encodings and saves each file back in the encoding it was found in:

| Status bar shows | Encoding |
| --- | --- |
| `utf-8` | UTF-8, without a byte order mark |
| `utf-8-bom` | UTF-8 with a byte order mark |
| `utf-16le` | UTF-16 little-endian, with a byte order mark |
| `utf-16be` | UTF-16 big-endian, with a byte order mark |

K-Doc never adds or removes a byte order mark by itself, and never converts a UTF-16 file to UTF-8. New documents are saved as `utf-8`.

To save a file in a different encoding, click the encoding in the status bar. Each click moves to the next encoding and shows **Next save:** with its name. Nothing changes on disk until you save.

K-Doc does not guess at other encodings. A file in another encoding, such as an older Windows code page, does not open. See [Troubleshooting](troubleshooting.md).

### Line endings

K-Doc keeps a file's line endings:

- A file whose lines all end in Windows line endings (CRLF) is saved with CRLF.
- A file with Unix line endings (LF), or a mix of both, is saved exactly as it was.
- **Save As** and **Save a Copy** use the original file's line endings.
- New documents are saved with LF.

### Comments and tracked changes

By default, comments and tracked changes are kept beside the file, not in it. The first time you save one, K-Doc adds a `kdoc_id` line to the document's front matter so it can find them again. When you remove the last one, K-Doc takes that line out again. See [Reviewing](reviewing.md).

## See also

- [Writing and formatting](writing-and-formatting.md)
- [Vaults](vaults.md)
- [Reviewing](reviewing.md)
- [Settings reference](settings-reference.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Troubleshooting](troubleshooting.md)
