# Export, print and present

K-Doc saves your work as Markdown, and can also write it out in other formats, print it, or show it as slides. This page also covers bringing Word, web and rich-text documents into K-Doc, and choosing how pasted content is read.

## Export formats at a glance

All exports are in **File → Export**. Exporting never changes the open document.

| Command | Writes | Needs |
| :--- | :--- | :--- |
| **Export as HTML** | One standalone web page with its pictures embedded | Nothing extra |
| **Export as Word Document** | A `.docx` file | The desktop app |
| **Export as Markdown Flavour** | A `.md` file in CommonMark, GitHub Flavored Markdown or Vault-portable Markdown | Nothing extra |
| **Export as LaTeX** | A LaTeX file | Pandoc on your PATH |
| **Export as EPUB** | An e-book | Pandoc on your PATH |
| **Export with a Plugin…** | Whatever format a plugin adds | A plugin that adds an export format |

Each export asks where to save the file and suggests the document's name with the new extension. When it finishes, the status bar names the file and anything that could not be carried across.

## Export to HTML

Choose **File → Export → Export as HTML**.

The result is a single `.html` file that opens in any browser. Pictures stored on your computer, including `![[picture.png]]` embeds, are embedded in the file, so you can send it on its own. Pictures on the web stay as web addresses. If a local picture cannot be read, the status bar names it.

K-Doc removes anything in the document that could run code, such as scripts, before it writes the file. Formatting, footnotes, image sizes and YouTube or Vimeo players are kept.

Mermaid diagrams are embedded as pictures, drawn in the light theme. A diagram whose code has a mistake is written as its code instead, and the status bar says how many could not be drawn.

The page is styled by the current export theme. See [Choose an export theme](#choose-an-export-theme).

## Export to Word

Choose **File → Export → Export as Word Document**.

K-Doc builds a real Word document rather than formatted text pasted into one:

| In K-Doc | In Word |
| :--- | :--- |
| Headings 1 to 6 | Word's Heading 1 to Heading 6 styles |
| Bold, italic, strikethrough | The same character formatting |
| Code and code blocks | Consolas on grey shading |
| Links | Hyperlinks |
| Bulleted and numbered lists | Word lists; each numbered list starts again at 1 |
| Task list items | ☑ or ☐ before the text |
| Tables | Word tables, with the first row repeated as a header and column alignment kept |
| Block quotes | Indented paragraphs with a left border |
| Footnotes | Word footnotes |
| Pictures | Embedded, at most 600 pixels wide |

Some things do not carry across:

- Maths is written as its TeX source, and a Mermaid diagram as its source in a code block.
- Code blocks are not colour-highlighted.
- Raw HTML is left out.
- SVG and WebP pictures, and pictures that cannot be read, are written as their description in brackets.
- Front matter and link definitions are left out.

The status bar lists what was not carried across, apart from front matter and link definitions.

## Export to another Markdown flavour

Choose **File → Export → Export as Markdown Flavour**, then pick a flavour. Use this when another app or website cannot read everything K-Doc writes. K-Doc refuses to export over the open document's own file.

| What you wrote | CommonMark | GitHub Flavored Markdown | Vault-portable Markdown |
| :--- | :--- | :--- | :--- |
| `==highlight==` | HTML `<mark>` | HTML `<mark>` | Kept |
| `~sub~`, `^sup^` | HTML `<sub>`, `<sup>` | HTML `<sub>`, `<sup>` | Kept |
| Maths | Code | Code | Kept |
| Tables | HTML table | Kept | Kept |
| `~~strikethrough~~` | HTML `<del>` | Kept | Kept |
| Task list checkboxes | Plain text `[x]` | Kept | Kept |
| Footnotes | Numbered HTML links | Kept | Kept |
| Front matter | An HTML comment | Kept | Kept |
| `[[wikilinks]]` | As written | As written | Relative Markdown links |

The status bar lists what the export changed, for example "Changed: tables written as HTML; maths written as code."

For Vault-portable Markdown, K-Doc turns each wikilink that names a note in the open vault into a link relative to the folder you export to. A wikilink that names no note, and every `![[...]]` embed, is left as written. Open the vault first, or wikilinks cannot be resolved. The export does not copy the notes or pictures that links point at.

## Export to LaTeX or EPUB with Pandoc

Choose **File → Export → Export as LaTeX** or **File → Export → Export as EPUB**.

K-Doc hands these to [Pandoc](https://pandoc.org), a separate program that you install yourself. K-Doc does not include or install it. If Pandoc is not on your PATH, K-Doc says so before asking where to save.

The document is converted with Pandoc's own defaults, including unsaved edits. You cannot pass Pandoc options such as a template or a bibliography. Pictures are referenced at the addresses the document uses, so an exported LaTeX file moved elsewhere may not find them.

## Export through a plugin

Choose **File → Export → Export with a Plugin…**, then pick a format. The list shows the export formats your installed plugins add. If no plugin adds one, K-Doc says so. See [Customising K-Doc](customising.md) for how plugins are installed.

## Choose an export theme

The export theme is the stylesheet used for HTML exports and printouts. It does not change how K-Doc itself looks.

Choose **File → Export → Export Theme** and pick a theme. You can also set **Export theme** in **Tools → Settings → Export**.

| Theme | Look |
| :--- | :--- |
| `default` | K-Doc's standard export style |
| `serif` | Georgia body text on a wider column |
| `compact` | Smaller 14px text with tighter spacing |
| `plain` | No stylesheet, for a page something else will style |

### Write your own export theme

1. Choose **File → Export → Open Export Themes Folder**. The first time, K-Doc puts a copy of the default stylesheet in the folder as `custom.css`.
2. Edit `custom.css`, or add your own `.css` files. A file's name, without `.css`, is the theme's name. Use letters, digits, spaces, hyphens and underscores, up to 64 characters.
3. Choose **File → Export → Export Theme** and pick your theme.

A theme of your own with the same name as a built-in theme replaces it. K-Doc does not check your CSS; it goes into the file as written.

## Include comments in an export

By default, comments are left out of exports and printouts. To include them, open **Tools → Settings → Export** and set **Comments in exports**:

| Option | Result |
| :--- | :--- |
| **Leave out** | No comments (the default) |
| **As endnotes** | Each comment becomes a numbered note at the end, linked from the text it is about |
| **In the margin** | Each comment sits beside the text it is about |

Replies are included with their authors. Resolved comments are always left out. This setting applies to **Export as HTML** and **Print**. See [Reviewing](reviewing.md).

## Print a document

Choose **File → Print** or press `Ctrl+P`. K-Doc prints the document alone, without the toolbars or panels, styled by the current export theme.

To save a PDF, print and choose **Save as PDF** as the destination. K-Doc has no separate PDF export.

Mermaid diagrams are printed as pictures, in the light theme, just as in an HTML export.

Pictures stored on your computer may not appear in a printout, because printing does not embed them the way **Export as HTML** does. If they are missing, export to HTML, open the file in your browser and print from there.

### Set up the page and add a contents page

Choose **File → Page Setup**. The dialog's main button is **Print**: it prints with the settings you choose.

| Setting | Choices |
| :--- | :--- |
| **Paper** | A4 (default), Letter, Legal, A3 |
| **Orientation** | Portrait (default) or Landscape |
| **Margin** | 0 to 50 mm on all sides (default 20 mm) |
| **Header** | Text printed at the top of each page |
| **Footer** | Text printed at the bottom of each page |
| **Include a table of contents** | Adds a contents page built from the document's headings |

In **Header** and **Footer**, `{title}` is replaced by the document's name, `{page}` by the page number and `{pages}` by the page count. For example, `{title} – page {page} of {pages}`. Leave a field empty for no header or footer.

The contents page is added to the printout only, never to the document or an HTML export. A document with no headings gets no contents page. To put a table of contents in the document itself, use **Insert → Table of Contents → Table of Contents…**. See [Writing and formatting](writing-and-formatting.md).

K-Doc remembers your page setup until you close the app. It is not saved with the document or in your settings.

## Present a document as slides

Choose **View → Start Presentation**. K-Doc shows the document full screen, one slide at a time.

A horizontal rule (`---` or `***`) on its own line starts a new slide. A document without rules is one slide. Rules inside a quote or a list do not split slides. Front matter is not shown, and empty slides are skipped.

| To | Press |
| :--- | :--- |
| Go to the next slide | `Right`, `Down`, `Page Down`, `Space` or `Enter`, or click the slide |
| Go to the previous slide | `Left`, `Up`, `Page Up` or `Backspace` |
| Go to the first or last slide | `Home` or `End` |
| Leave the presentation | `Esc` |

The presentation always starts at the first slide. There are no speaker notes, presenter view or transitions, and slides cannot be exported.

## Import a Word, web or rich-text document

Choose **File → Import Document** and pick a file. K-Doc can import:

- Word documents (`.docx`)
- Web pages (`.html`, `.htm`)
- Rich text (`.rtf`)
- Plain text (`.txt`)

K-Doc converts the file to Markdown. If the file holds things Markdown cannot, a dialog lists them with a count, for example "text colours, fonts and sizes (3)". Click **Import** to continue without them, or **Cancel** to stop.

Things the import can report as lost include underlining, highlighting, subscript and superscript, colours, fonts and sizes, paragraph alignment, merged table cells, tables or lists inside table cells, embedded media, form fields, scripts and pictures stored inside the file. Pictures stored inside a Word or RTF file are dropped, not saved beside the document. Pictures on the web are kept as links to their web address.

A table without a header row has its first row made the header, because a Markdown table needs one.

The imported document opens as a new, unsaved document. Choose **File → Save** (`Ctrl+S`) to decide where the Markdown file goes.

Some limits:

- A Word document can lose paragraph alignment, text colour and fonts without the dialog saying so.
- Import the `.docx` rather than a web page saved from Word: the `.docx` gives real lists and footnotes.
- Nested lists in RTF are flattened, and RTF footnotes are dropped. Both are reported.
- K-Doc cannot import `.odt`, `.doc` or `.pages` files.

## Choose how pasted content is read

When you paste, K-Doc reads the clipboard as follows:

- Text copied from a web page or Word keeps its formatting, converted to Markdown. Formatting Markdown cannot hold is dropped.
- Plain text is read as Markdown, so a pasted line starting `## ` becomes a heading.
- Inside a code block, a paste is always plain characters.

To paste without formatting, press `Ctrl+Shift+V`, or choose **Edit → Paste Special → Paste as Plain Text** before you paste.

### Change a paste after the fact

After a paste, a small control appears at the caret offering other ways to read what you pasted. Pick one to replace the paste. For the full list, choose **Edit → Paste Special → Paste Special** or press `Ctrl+Alt+V`:

| Option | Result |
| :--- | :--- |
| **Unformatted Text** | The characters only. No headings, no emphasis, no links. |
| **Markdown** | Reads the text as Markdown. |
| **Formatted (HTML)** | Converts the copied formatting into Markdown. |
| **Table** | Reads tab- or comma-separated text, or a copied table, as a table. The first row becomes the header. |

The dialog greys out options that would not work for what you pasted. If you have not pasted anything yet, choosing an option applies it to your next paste.

Paste Special works on the paste that already happened, so it still works if the clipboard has changed since.

## See also

- [Getting started](getting-started.md)
- [Writing and formatting](writing-and-formatting.md)
- [Reviewing](reviewing.md)
- [Vaults](vaults.md)
- [Customising K-Doc](customising.md)
- [Settings reference](settings-reference.md)
- [Troubleshooting](troubleshooting.md)
