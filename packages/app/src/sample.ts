/**
 * @file sample.ts
 * @purpose Supplies the welcome document K-Doc opens with on an ordinary launch.
 * @inputs None.
 * @outputs SAMPLE_DOCUMENT - a short Markdown tour of the editor that also exercises the constructs it supports.
 * @functions None (constant module).
 * @dataflow SAMPLE_DOCUMENT -> EditorShell initialText -> DocumentSession.
 * @controlflow Static constant evaluated on module load.
 * @version 2
 * @date 2026-10-07
 */

/**
 * The welcome document. It is untitled, so nothing is written to disk until the reader saves it, and it
 * deliberately exercises the constructs the editor models, so opening the app is itself a smoke test of the
 * conversion layer. Paragraphs are single lines because the editor shows a soft line break as a break; the
 * non-canonical bullets near the end make byte preservation visible in the Source pane.
 */
export const SAMPLE_DOCUMENT = `# Welcome to K-Doc

K-Doc shows you the **document**, not the syntax. You write in a word-processor view, and the file on disk stays plain Markdown that any other tool can read.

## Getting started

- **Open** a Markdown file with *Ctrl+O*, or open a whole folder of notes as a vault from the **Files** panel (the folder icon on the left).
- **Save** with *Ctrl+S*. This welcome page is untitled, so its first save asks where to put it.
- Press *Ctrl+Shift+P* for the command palette: every command, with its shortcut, in one searchable list.
- Switch between K-Doc, Source and Split from the **View** menu. Split shows both at once, and they share one undo history whichever side you type in.

## Things worth knowing

- [x] Anything you do not edit is written back exactly as it was.
- [x] Unsaved work is journalled, so a crash costs at most a moment of typing.
- [ ] Try a comment or tracked change from the **Review** menu.

> Raw HTML in a document stays in the file, but K-Doc never runs a document's scripts.

| Feature | Where to find it |
| ------- | ---------------- |
| Spell check and grammar | Review menu |
| Export to HTML, Word, LaTeX or EPUB | File menu |
| Themes and keyboard presets | Settings |

\`\`\`ts
const answer: number = 42;
\`\`\`

Inline \`code\`, ~~strikethrough~~, ==highlight==, and a [link](https://example.com).

## Why the Source pane looks the way it does

Open Split view and look at the list below. Its bullets use three spaces after the marker, which is not how K-Doc would write them. Edit any other paragraph and they stay exactly as they are.

*   A deliberately non-canonical bullet
*   Another one
`;
