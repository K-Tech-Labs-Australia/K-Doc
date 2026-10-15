# Reviewing documents

This page covers the tools for checking and reviewing a document: comments, track changes, comparing two files, version history, spelling, grammar, statistics and the Problems panel. Most of them live on the **Review** menu and in the right panel.

## Where the review tools are

The **Review** menu holds **New Comment**, **Bundle Annotations into File**, **Toggle Track Changes**, the **Spelling & Grammar** submenu, **Statistics…**, **Version History…** and **Compare Documents…**. The **Review** tab on the ribbon has buttons for **New Comment**, **Toggle Track Changes**, **Spelling…** and **Toggle Spell Check**.

The right panel holds the **Comments**, **Backlinks**, **History**, **Metadata**, **Problems** and **Review** panels. To show or hide it, press `Ctrl+Shift+R` or choose **View → Panels → Toggle Right Panel**.

Version history and dictionary downloads need the desktop app. They are not available in the browser build.

## Set your author name

K-Doc puts a name on every comment and tracked change. It is `You` until you change it.

1. Open **Settings** (`Ctrl+,`).
2. Under **General**, type your name in **Author name**.

A new name applies straight away. Comments you wrote before the change keep the old name. A blank name is not accepted.

## Add a comment

1. Select the text you want to comment on.
2. Press `Ctrl+Alt+M`, or choose **Review → New Comment**.
3. Type the comment in the box that opens in the **Comments** panel.
4. Press `Ctrl+Enter` or click **Reply** to post it.

K-Doc reads the selection from the Source pane. If you are in **K-Doc** view, K-Doc switches to **Split** view first so the selection can be read. If nothing is selected, the status line says "Select some text to comment on."

The commented text is underlined and tinted in both panes, and a thin line joins it to its card in the panel. Nothing is saved until you post the first reply: an empty draft is discarded.

## Reply to, edit or delete a comment

Each comment card in the **Comments** panel shows one conversation: the first comment and its replies.

- **Reply:** type in the **Reply** box at the bottom of the card, then press `Ctrl+Enter` or click **Reply**. Plain `Enter` starts a new line.
- **Edit:** click **Edit** beside a comment, change the text and click **Save**. Click **Cancel** to leave it as it was. An edited comment is marked **(edited)**. An empty or unchanged comment is not saved.
- **Delete:** click **Delete** beside the comment. Deleting the last comment in a card removes the whole card.

## Resolve a comment

Click **Resolve** on a card when the discussion is finished. The highlight in the document turns muted. To bring it back, click **Reopen**.

## Use the Comments panel

The controls at the top of the **Comments** panel filter and display comments.

| Control | Choices | What it does |
| --- | --- | --- |
| Filter | **Open**, **Resolved**, **All** | Shows only open comments, only resolved ones, or both |
| Author | **All authors**, or one name | Shows only one person's comments |
| Comment display | **Margin**, **Inline**, **Hidden** | Chooses how comments appear in the document |

The display choices work like this:

- **Margin** highlights the commented text and keeps the comments in the panel. This is the default.
- **Inline** keeps the highlight and also shows the first comment of each thread after the text it refers to.
- **Hidden** removes the highlights from the document. The panel still lists every comment.

When the panel is empty it says either **No comments yet** or **No comments match the current filter**, so you can tell whether a filter is hiding comments.

## When a comment loses its text

Comments are not written into your Markdown. K-Doc remembers the commented words and the text around them, and finds them again each time you open the document, even after edits nearby. A highlight drawn fainter than usual means K-Doc found the text by a close match rather than an exact one.

If the text was rewritten too much to find, the card shows **Original text not found** and moves to the end of the list. The comment is kept, with a quote of the text it was about.

## Where comments are stored

By default, comments are kept beside the document, not in it.

- **In a vault or shared folder:** K-Doc looks for a `.k-doc` folder in the document's folder and each folder above it. If it finds one, comments go in `.k-doc/comments/`. You can share that folder through git with the documents: each comment is one line, so two people adding comments rarely conflict.
- **Anywhere else:** comments go in K-Doc's own data folder on your computer. Commenting works on any file, including one opened straight from Downloads.

When a document gets its first comment, K-Doc adds a `kdoc_id` field to its YAML front matter. This lets the comments follow the file if you rename or move it. When the last comment is deleted, K-Doc removes the field again, and the front matter block too if that was its only field.

See [Vaults](vaults.md) for more about vault folders.

## Send comments with the file

To send someone a single file with its comments, write the comments into the file itself.

- **Once:** choose **Review → Bundle Annotations into File**. K-Doc adds the comments to the end of the document as HTML comments, which other Markdown programs do not display. This is an ordinary edit: you can undo it, and it is written to disk when you save. Comments you add afterwards are not included until you run the command again.
- **Always:** in **Settings → General**, turn on **Keep comments in the file**. K-Doc then keeps the comments in the document every time a comment changes, so saving the file is enough to send them. It is off by default because every comment then becomes an edit to the document.

When you open a document that carries comments written into it, K-Doc asks **Import comments?**. Click **Import** to move them into the **Comments** panel and take them out of the text, or **Leave them** to leave the file as it is. K-Doc does not ask again for that document. With **Keep comments in the file** turned on, K-Doc does not ask.

Only comments are written into the file. Tracked changes are not.

## Include comments in an export

Comments are left out of exports and printouts unless you choose otherwise.

1. Open **Settings** (`Ctrl+,`).
2. Under **Export**, set **Comments in exports** to one of the choices below.

| Choice | Result |
| --- | --- |
| **Leave out** | No comments in the output. This is the default. |
| **As endnotes** | Each comment becomes a numbered note at the end of the document. |
| **In the margin** | Each comment appears beside the text it refers to. On a narrow page it moves below the text. |

This setting applies to **Export as HTML** and **Print**. Every reply is included and named. Resolved comments are always left out. A comment whose text can no longer be found is added at the end with a quote of what it was about. See [Export and print](export-and-print.md).

## Turn on track changes

Press `Ctrl+Shift+E`, or choose **Review → Toggle Track Changes**. The **Review** panel opens and the status line says "Track changes: on". You can also tick **Track changes** at the top of the **Review** panel.

While tracking is on, K-Doc records each edit you type, with your author name and the time. Undo and redo are not recorded as new changes. Edits that K-Doc applies to the document as a whole, such as **Replace**, restoring a version or a quick fix, are not recorded either, and nor are changes made to the file outside K-Doc. Edits made while tracking was off are never recorded later.

The Markdown file on disk always holds the text with all pending changes applied. The record of the changes is kept beside the file, in the same place as comments.

## Accept or reject a change

The **Review** panel lists every pending change with its kind (**Inserted** or **Deleted**), author, time and text. Deleted text is shown struck through. Click a change to scroll to it.

- Click **Accept** on a row to keep the change. The text stays as it is and the change leaves the list.
- Click **Reject** on a row to undo the change. K-Doc removes inserted text or puts deleted text back.

To decide many changes at once, pick a scope in the selector beside the buttons, then click **Accept all** or **Reject all**.

| Scope | Changes affected |
| --- | --- |
| **in document** | Every pending change |
| **in selection** | Changes inside the selected text |
| **by** *name* | Changes by one author |

Rejecting several changes at once is a single edit, so one `Ctrl+Z` undoes it.

## Choose how changes are shown

The **Markup display** selector in the **Review** panel has four modes.

| Mode | What you see |
| --- | --- |
| **All Markup** | Insertions marked in the author's colour, deletions struck through, and a bar in the margin beside each changed line |
| **Simple Markup** | Only the bars in the margin, so you can read the text and still see where it changed |
| **No Markup** | The document as it would be with every change accepted |
| **Original** | A read-only view of the document as it would be with every change rejected |

Each author keeps the same colour on every computer. To leave **Original**, choose another mode in the **Review** panel.

## Compare two documents

1. Choose **Review → Compare Documents…**.
2. Pick the original file.
3. Pick the revised file.

K-Doc opens a new, unsaved tab holding the revised text, with every difference from the original shown as a tracked change. The author of each change is the revised file's name. Review them in the **Review** panel as you would any other tracked changes. If the files are the same, K-Doc says nothing differs.

Moved text shows as a deletion and an insertion. The new tab has no file name until you save it.

## Take a snapshot

K-Doc keeps local snapshots, which are whole copies of a saved document, so you can go back to an earlier version.

- **On save:** K-Doc takes a snapshot each time you save. Turn this off with **Snapshot on save** under **Settings → Editor**.
- **On a timer:** K-Doc takes a snapshot of an open document every 10 minutes, including unsaved edits. Change the interval with **Snapshot every (minutes, 0 = off)** under **Settings → Editor**.
- **By hand:** choose **File → Take Snapshot**. The status line says "Snapshot taken." or "No changes since the last snapshot."

Snapshots only work for a document that has been saved to a file. Inside a vault they go in `.k-doc/local/snapshots/`, which is not shared through git. Elsewhere they go in K-Doc's data folder.

K-Doc thins out old snapshots. By default it keeps every snapshot for 24 hours, one an hour for 7 days and one a day for 90 days. Snapshots you take by hand and the newest snapshot are always kept. You can change these periods in the settings file: see [Settings reference](settings-reference.md).

## Restore an earlier version

Choose **Review → Version History…**, or click **Version History…** at the top of the **History** panel. The dialog lists the document's snapshots, newest first, labelled **Saved**, **Snapshot**, **Automatic** or **Before restore**. If the document is in a git repository, the commits that changed it are listed too, labelled **Git commit**.

Select a version, then use the buttons:

- **Changes** shows the differences between that version and the document now. Added text is marked as inserted and removed text as deleted, with a count of words added and removed.
- **Old Version** shows the version as it was.
- **Copy Selection** copies the text you selected in the version, or the whole version if nothing is selected.
- **Restore This Version** replaces the document with that version.
- **Open as Tracked Changes** shows the differences as tracked changes, so you can accept or reject them one at a time.

Before restoring, K-Doc saves the current text as a **Before restore** snapshot. The restore is a single edit, so `Ctrl+Z` brings the current text back.

## Go back to an edit from this session

The **History** panel lists the edits made since you opened the document, newest first. Each row shows how long ago the edit was, which pane it was made in, and how many words it differs by from the document now.

Click a row to return the document to how it was before that edit. This is an ordinary edit that you can undo. The panel only reaches back to when you opened the document: for anything older, use **Version History…**.

## Check spelling

Spelling is checked as you type in the K-Doc pane. Misspelt words are underlined. Code, inline code and front matter are skipped. The Source pane is not spell-checked.

To fix a word, right-click it. The menu offers up to five suggestions, then **Ignore All** and **Add to Dictionary**.

To go through the whole document, press `F7` or choose **Review → Spelling & Grammar → Spelling…**. The **Spelling** dialog shows each word under **Not in dictionary**, with **Suggestions** below. Its buttons are:

| Button | What it does |
| --- | --- |
| **Change** | Replaces this occurrence with the selected suggestion |
| **Change All** | Replaces every occurrence |
| **Ignore** | Skips this occurrence only |
| **Ignore All** | Skips the word everywhere until you close K-Doc |
| **Add to Dictionary** | Adds the word to your own dictionary on this computer, permanently |

To turn the underlining on or off, choose **Review → Spelling & Grammar → Toggle Spell Check**. The **Spell check** setting under **Settings → Proofing** controls the same thing.

## Choose the spelling language

Each document is checked in its own language. The status bar shows the language, for example `en-GB` or `fr`. Hover over it to see where the language came from.

K-Doc chooses the language in this order:

1. A `lang:` or `language:` field in the document's YAML front matter.
2. A language you picked for this document.
3. A guess from the document's text, when **Detect each document's language** is on under **Settings → Proofing**. It is on by default.
4. The **Language** setting under **Settings → Proofing**, which is `en-GB` by default.

To pick a language, click the language in the status bar, or choose **Review → Spelling & Grammar → Spelling Language**. Choose **Detect automatically** to go back to the automatic choice. K-Doc remembers your pick for that file. If the front matter names the language, change it there instead.

Detection recognises English, French, German, Spanish, Italian, Portuguese, Dutch, Swedish, Danish, Norwegian, Polish and Finnish. It needs at least 20 words and a clear winner, otherwise the default language is used. A document is checked in one language only.

## Download a dictionary

K-Doc comes with a British English dictionary. When a document needs a language you do not have, K-Doc asks **Download a dictionary?** before fetching anything.

- Click **Download** to fetch the dictionary from the wooorm/dictionaries project on GitHub. K-Doc keeps it in its data folder for next time.
- Click **Not now** to leave spelling off for that language. K-Doc does not ask again until you restart it or pick the language from the status bar.

Nothing is downloaded without your yes. If no dictionary is published for a language, the status line says spelling is not checked in that document. Downloaded dictionaries cannot be removed from inside K-Doc.

## Check grammar

K-Doc can send a document to a LanguageTool-compatible grammar server that you choose. There is no built-in server, and nothing is sent until you set one up and ask for a check.

To set up a server:

1. Open **Settings** (`Ctrl+,`).
2. Under **Proofing**, enter the server's check address in **Grammar service URL**. For a LanguageTool server this address ends in `/v2/check`, for example `http://localhost:8081/v2/check` for one running on your own computer.

The address must use `https`. Plain `http` is allowed only for a server on your own computer (such as `localhost`) or on your local network. K-Doc refuses any other address.

To check a document, choose **Review → Spelling & Grammar → Check Grammar**. K-Doc sends the document's text and its spelling language to the server, once, and lists what it finds in the **Problems** panel under **Grammar**. Where the server suggests a correction, the problem has a button that applies the first suggestion. You can undo it.

Things to know about grammar checking:

- **Privacy:** the whole document text goes to the server you named, and only when you run **Check Grammar**. Nothing is sent as you type.
- **Length:** a document over 60,000 characters is refused rather than sent in parts.
- **Edits:** the findings are cleared as soon as you change the text, because their positions no longer match. Run the check again.
- **Servers needing a key:** K-Doc cannot send an API key, so a server that requires one does not work.
- **Errors:** if the server cannot be reached or gives an unexpected answer, K-Doc says so. It never reports "nothing found" when the check failed.

If the check says the server "could not be reached", see [Troubleshooting](troubleshooting.md).

## See word counts and readability

The status bar shows the word count. Click it, or choose **Review → Statistics…**, to open the **Statistics** dialog. It gives figures for the whole document and for the current selection.

| Statistic | Notes |
| --- | --- |
| **Words** | |
| **Characters (with spaces)** | |
| **Characters (no spaces)** | |
| **Paragraphs** | |
| **Sentences** | An estimate: abbreviations such as "Dr." count as the end of a sentence |
| **Reading time** | |
| **Reading ease (Flesch)** | Higher is easier to read |
| **Grade level (Flesch–Kincaid)** | Approximate school grade needed to read the text |
| **Gunning fog index** | Approximate years of schooling needed to read the text |

The readability scores are measured on the prose only: code and link addresses are left out. They are designed for English text and mean little for other languages. A dash means there is nothing to measure.

Below the table, **Most used words** lists the ten words the document uses most, leaving out common words such as "the" and "and". **Repeated phrases** lists the ten phrases of three to six words that repeat most. Both lists cover the whole document, not the selection.

The dialog shows the figures at the moment you open it. Close and reopen it to update them.

## Find problems with the Problems panel

The **Problems** panel in the right panel lists what is wrong with the document, in groups that always appear in the same order. When there is nothing to report it says **No problems found.**

| Group | What it lists |
| --- | --- |
| **Spelling** | Misspelt words |
| **Grammar** | Findings from the last grammar check |
| **Links** | Links to notes in your vault that do not exist |
| **Document** | Structural problems in the Markdown |
| **Fidelity** | Changes K-Doc made on save to text you did not edit (only in developer mode) |

Click a problem to go to it. Spelling problems open in the K-Doc pane. All other problems open in the Source pane, and K-Doc switches to **Split** view if only the K-Doc pane is showing.

Links are not checked while the vault is still being scanned. Links to web addresses are not checked.

## Fix structural problems

The **Document** group checks the Markdown for:

- headings that skip a level, such as a heading 4 straight after a heading 2
- duplicate headings
- links with no text or no address
- links to a `#heading` that does not exist in the document
- pictures whose file is missing
- tables with rows that are too short or too long, and tables whose header and divider rows do not match

Some problems have a quick-fix button beside them:

| Problem | Quick fix |
| --- | --- |
| A heading that skips a level | **Make it H***n*, which changes it to the next level down from the heading before |
| A link with no address | **Remove the link, keep the text** |
| A link with no text and no address | **Remove the empty link** |
| A link with an address but no text | **Use the address as text** |
| A table row that is too short | **Add empty cells** |
| A table whose divider row does not match its header | **Fix the delimiter row** |

A quick fix is an ordinary edit, so you can undo it. Duplicate headings, missing pictures, broken note links and rows that are too long have no quick fix. Headings inside quotes and lists are not checked.

## Check that saving keeps your formatting

K-Doc is designed to leave the parts of a file you did not edit exactly as they were. The Fidelity Check tests this each time you save.

To turn it on, open **Settings** (`Ctrl+,`) and, under **General**, turn on **Developer mode (Fidelity Check on save)**. After each save, any byte that changed in a part of the document you did not edit is listed in the **Problems** panel under **Fidelity**. The findings disappear when you next edit the document. It is off by default and most people do not need it. If it reports something, see [Troubleshooting](troubleshooting.md).

## See also

- [Getting started](getting-started.md)
- [Writing and formatting](writing-and-formatting.md)
- [Vaults](vaults.md)
- [Export and print](export-and-print.md)
- [Settings reference](settings-reference.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Troubleshooting](troubleshooting.md)
