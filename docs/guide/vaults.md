# Working with a vault

A vault is a folder of Markdown notes that K-Doc indexes as a set. This page covers opening a vault, managing its files, finding things across it, linking notes together, and the git commands K-Doc offers.

## Open a folder as a vault

1. Choose **File → Vault → Open Vault Folder…**.
2. Pick the folder that holds your notes.

K-Doc scans the folder and its subfolders for Markdown files. Notes appear in the panels as the scan finds them, so you can start working before it finishes. You can also open a vault from the **Files** panel: when no folder is open, it shows an **Open Folder** button.

Only one vault is open at a time. Opening another folder replaces the current vault. K-Doc does not reopen the vault when it starts, so open the folder again in each session.

The scan skips some folders by name: `.k-doc`, `.git`, `node_modules`, `.obsidian`, `target`, `.venv`, and any folder whose name starts with a dot. It does not follow shortcuts or symbolic links. A note it cannot read is skipped, and the rest of the vault still opens. A vault holds at most 20,000 notes.

## Show the vault panels

The vault panels live in the two sidebars. Each sidebar has a rail of icons; click an icon to show that panel.

| Sidebar | Panels | Toggle |
| :--- | :--- | :--- |
| Left | **Outline**, **Files**, **Search**, **Tags** | **View → Panels → Toggle Sidebar** (`Ctrl+Shift+B`) |
| Right | **Comments**, **Backlinks**, **History**, **Metadata**, **Problems**, **Link Definitions**, **Plugins**, **Review** | **View → Panels → Toggle Right Panel** (`Ctrl+Shift+R`) |

Each toggle reopens its sidebar on the panel it last showed.

## Manage files in the Files panel

The **Files** panel shows the vault as a tree, with folders before files. It shows Markdown notes only; other files in the vault are not listed.

- **Open a note:** click it. If the note is already open, K-Doc switches to its tab.
- **Expand a folder:** click it.
- **Select several items:** `Ctrl`+click to add or remove one item, or `Shift`+click to select a range.

Right-click in the panel for these commands:

| Command | What it does |
| :--- | :--- |
| **New Note** | Creates a note in the selected folder, or in the folder of the selected note. |
| **New Folder** | Creates a folder in the same place. |
| **New Note from Template…** | Creates a note from one of the vault's templates. See [Create a note from a template](#create-a-note-from-a-template). |
| **Rename…** | Renames the selected note or folder. |
| **Delete** | Moves the selected items to the Windows Recycle Bin. |
| **Reveal in File Explorer** | Shows the item in File Explorer. |

To move notes or folders, drag them onto another folder.

You can also work from the keyboard when the tree has focus:

| Key | Action |
| :--- | :--- |
| `Up` / `Down` | Move through the tree |
| `Shift+Up` / `Shift+Down` | Extend the selection |
| `Home` / `End` | Go to the first or last item |
| `Right` / `Left` | Expand or collapse a folder |
| `Enter` | Open the selected item |
| `F2` | Rename |
| `Delete` | Delete |
| `Ctrl+A` | Select all |

K-Doc never overwrites a file. Creating, renaming or moving an item onto a name that already exists fails with a message. A folder cannot be moved into itself.

### Delete notes safely

**Delete** asks you to confirm, then sends the items to the Windows Recycle Bin. K-Doc does not delete them permanently, so you can restore them from the Recycle Bin. Tabs open on deleted notes close; if a tab has unsaved changes, K-Doc asks first.

### What renaming and moving do not change

When you rename or move a note, open tabs follow it to its new name. Links to the note in other notes are not rewritten, so update them yourself. A rename or move cannot be undone from K-Doc; rename or move the item back instead.

## Create a note from a template

Templates are ordinary Markdown files in the `.k-doc/templates` folder inside the vault.

1. Create the folder `.k-doc/templates` in the vault, if it does not exist.
2. Save one or more Markdown files in it. Each file is one template.
3. In the **Files** panel, right-click and choose **New Note from Template…**.
4. Pick a template, then type a name for the new note.

K-Doc copies the template's text into the new note as it is. Templates do not appear in the file tree, search, tags or backlinks.

## Switch files with Quick Open

Choose **File → Quick Open** or press `Ctrl+Shift+O`. Type part of a file name and press `Enter`.

The list shows your open tabs first, then recent files, then every note in the vault. Matching is fuzzy, so you can type letters from the name in order without typing all of it. Picking a file that is already open switches to its tab.

## Find and replace across the vault

Choose **Edit → Find in Vault** or press `Ctrl+Shift+F`. The **Search** panel opens with its box ready for typing.

- Type in **Search the vault…**. Results are grouped by note, with a line of text around each match.
- Use the toggles to set **Match case** (`Aa`), **Whole word** (`W`) and **Regular expression** (`.*`).
- Click a match to open its note with the caret on the match.

Open notes are searched as they are in their tabs, including unsaved edits. A search stops at 2,000 matches and says so.

To replace across notes:

1. Search for the text you want to change.
2. Type the new text in **Replace with…**.
3. Every match starts ticked. Untick the matches you want to keep. A note's own tick box ticks or clears all its matches at once.
4. Click **Replace**.

K-Doc replaces the matches that were on screen when you clicked, using the search and options shown in the results. A note that changed since the search is checked again: a match that moved is skipped and reported. A note open in the front tab can be undone with `Ctrl+Z`; a note open in a background tab is marked as unsaved; a closed note is saved straight to disk.

To reverse the last replace, click **Undo** in the panel. A note you edited after the replace is left alone.

To find text in the current document only, use **Edit → Find** or **Edit → Replace** (`Ctrl+H`). See [Writing and formatting](writing-and-formatting.md).

## Link notes together

### Markdown links to notes

Choose **Insert → Link** (`Ctrl+K`). The link dialog has four tabs:

| Tab | Use it to |
| :--- | :--- |
| **URL** | Type a web address or path. |
| **Heading** | Link to a heading in this document. |
| **Note** | Search the vault's notes by title, path, tag or heading. |
| **File...** | Pick a file on disk. |

Each tab fills in the address field, so you can check or edit the target before you insert the link. The **Note** tab returns nothing when no vault is open.

To follow a link, hover over it to see its target and use the card's open button, or `Ctrl`+click it. A link to a note opens that note in a tab. A web link opens in your browser; for a domain you have not trusted, K-Doc asks first.

### Wikilinks

K-Doc reads wikilinks in the forms `[[Note]]`, `[[Note#Heading]]` and `[[Note|Shown text]]`. A wikilink counts as a link for backlinks, the graph and the Problems panel, and K-Doc saves it exactly as you wrote it.

In the K-Doc view a wikilink is plain text. It has no hover card and you cannot follow it with `Ctrl`+click. To turn wikilinks into ordinary relative links for other apps, export the note as Vault-portable Markdown. See [Export and print](export-and-print.md).

### Image embeds

An image embed has the form `![[picture.png]]`, or `![[picture.png|600]]` to set a width in pixels. K-Doc shows the picture in the K-Doc view and writes the embed back unchanged.

- Resize the selected picture with `Alt+Shift+Right` and `Alt+Shift+Left`, or with **Format → Image Size → Widen Image**, **Narrow Image** and **Reset Image Size**.
- Embeds work for pictures only. `![[Some Note]]` stays as text; K-Doc does not insert one note inside another.
- An embed holds a width and nothing else. If you add alt text or a caption in the image dialog, K-Doc converts the embed to an ordinary Markdown image.

## See what links to a note

Open the **Backlinks** panel in the right sidebar. It lists every note that links to the note on screen, grouped by note, with the line that holds each link. Click a note name or a quoted line to open it.

The panel says **No folder open.** without a vault, and **Save the note to see what links to it.** for an untitled note.

Links you add are picked up when you save: saving a note updates the vault's index, so the **Tags**, **Backlinks** and **Problems** panels stay current.

## Browse by tag

A tag is a word that starts with `#`, such as `#todo` or `#work/urgent`. It must start a line or follow a space or bracket, and its first character must be a letter or digit, so a `# Heading` and a link's `#fragment` are not tags. Tags inside code are ignored.

The **Tags** panel lists every tag with the number of notes that carry it. Click a tag to list its notes, and click it again to collapse the list. A tag with a slash is nested: clicking `#work` also shows notes tagged `#work/urgent`.

## See the link graph

Choose **File → Vault → Graph…**. Each note is a circle, and each link between two notes is a line. A note with more connections has a larger circle, and a link written several times has a thicker line.

- **Whole vault** shows every note.
- **Around this note** shows the note on screen and the notes it links to or is linked from.
- Click a circle to open the note.

The graph is fitted to the window and has no zoom, pan or dragging. It shows the vault as indexed when you opened it, so a vault still being scanned shows only the notes found so far.

## Store attachments

When you paste an image, or drag an image file into a note, K-Doc copies it into an attachments folder beside the note and links to it with a relative path. The note and its pictures can then move together.

| Setting | Default | What it controls |
| :--- | :--- | :--- |
| **Attachments folder** | `attachments` | The folder, relative to the note's own folder. An absolute path puts every attachment in one place. |
| **Attachment name template** | `{name}-{date}` | The file name. Tokens: `{name}` (the dropped file's name, or `pasted` for a clipboard image), `{doc}` (the note's name), `{date}` and `{time}`. |

Both settings are in **Tools → Settings → General**. K-Doc keeps the file's own extension and never overwrites an existing file: it adds `-2`, `-3` and so on to the name instead.

- Save a new document before you paste an image into it. An untitled document has no folder to put the image in.
- Only images are copied. A dropped PDF or other file becomes a link to where the file already is.
- An image larger than 25 MB is refused.

### Find unused attachments

Choose **File → Vault → Unused Attachments Report**. K-Doc checks the open note's attachments folder against every note in the vault and opens a new document listing the files nothing refers to. The report only lists files; it does not move or delete them.

## Manage reference links

A reference link keeps the address out of the sentence: `[the guide][1]` in the text, with `[1]: https://example.com` at the end of the document.

### Convert inline links

Choose **File → Vault → Convert to Reference Links**. K-Doc rewrites each inline link `[text](address)` in the document as a reference link and adds the definitions at the end.

- Links to the same address share one definition. An existing definition for that address is reused.
- New labels are numbers.
- Bare web addresses and links with no text are left alone.
- The whole conversion is one undo step.

There is no command to convert reference links back to inline links.

### Review link definitions

Choose **File → Vault → Link Definitions** to open the **Link Definitions** panel. It lists each definition with its label, address and title, and a badge: "used N times", "unused", or "duplicate, never used". The panel's **Convert inline links** button runs the conversion above.

Click a definition to show it in the Source view, where you can edit it. If you are in the K-Doc view, K-Doc switches to Split first, because definitions can only be edited as source.

## Use git with your notes

If a saved note is inside a git repository, K-Doc offers two commands in **Tools → Git**:

- **Git: Stage File** stages the note.
- **Git: Commit File…** asks for a commit message, then commits this note only, whatever else is staged. The message names the branch and the new commit.

Both commands need git installed and on your PATH. Save the note first; K-Doc refuses to stage or commit a note with unsaved changes, so git gets what is on screen. Committing runs the repository's own hooks, as `git commit` does.

**Review → Version History…** lists the commits that changed the note alongside K-Doc's own snapshots, labelled "Git commit". You can restore a commit, copy from it, or open it as tracked changes. The list shows up to 100 commits. See [Reviewing](reviewing.md).

K-Doc does not push, pull, switch branches, show a diff against the staging area or show a note's git status. Use git or your git tool for those.

## What K-Doc stores in the vault

K-Doc keeps its own data in a `.k-doc` folder at the top of the vault. The scan skips this folder, so its contents never appear as notes.

| Path | What it holds | Commit it? |
| :--- | :--- | :--- |
| `.k-doc/templates/` | Your note templates | Yes, to share them |
| `.k-doc/comments/`, `.k-doc/changes/` | Comments and tracked changes for the vault's notes | Yes, to share them |
| `.k-doc/local/` | Machine-local data, such as the saved index (`index.db`) and snapshots | No |

The saved index lets the vault open faster: K-Doc reads only notes whose size or modified time has changed since the last scan. You can delete `.k-doc/local/index.db` at any time; K-Doc rebuilds it the next time you open the vault.

Comments are stored by an id in the note's front matter (`kdoc_id`), not by file name, so renaming or moving a note keeps its comments. K-Doc adds that id only when you add a comment. See [Reviewing](reviewing.md).

## See also

- [Getting started](getting-started.md)
- [Writing and formatting](writing-and-formatting.md)
- [Reviewing](reviewing.md)
- [Export and print](export-and-print.md)
- [Settings reference](settings-reference.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
