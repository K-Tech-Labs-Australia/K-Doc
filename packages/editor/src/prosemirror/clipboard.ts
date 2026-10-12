/**
 * @file clipboard.ts
 * @purpose ProseMirror clipboard integration for K-Doc (FR-7.4). Handles rich pasting (HTML converted
 *   to mdast to ProseMirror), Markdown plain-text pasting, verbatim plain-text insertion, and clipboard
 *   serialization (selection to Markdown and HTML). The end of a replacement is the old end mapped
 *   through the transaction, not wherever the selection landed.
 * @inputs EditorView and ClipboardEvent on paste events; ProseMirror EditorState on selection queries;
 *   raw HTML or plain text strings for programmatic paste commands.
 * @outputs ClipboardHandlers interface containing handlePaste prop; pasteContent utility; pasteAsPlainText
 *   command; selectionAsMarkdown and selectionAsHtml serializers; and RichPasteInfo descriptors.
 * @functions
 *   - createClipboardHandlers: Installs the ProseMirror handlePaste prop handler with rich paste notifications.
 *   - pasteContent: Single point of entry for executing plain, markdown, or html pastes into an EditorView.
 *   - pasteAsPlainText: Command placeholder declaring paste-as-plain-text (Ctrl+Shift+V) capability.
 *   - selectionAsMarkdown: Extracts the active EditorState selection and serializes it to Markdown.
 *   - selectionAsHtml: Extracts the active EditorState selection and renders it to an HTML fragment.
 *   - isInsideCodeBlock: Helper predicate detecting whether the caret or selection resides within a codeBlock.
 *   - selectionToKdocDocument: Helper extracting selection contents and constructing a canonical KdocDocument.
 * @dataflow ClipboardEvent -> extract HTML/text -> route mode to pasteContent -> convert (htmlToMdast / parseMarkdown)
 *   -> mdastToProseMirror -> replaceSelection(Slice) -> onRichPaste callback.
 * @controlflow Inspect target node type (bail on codeBlock) -> detect clipboard format -> dispatch transaction with
 *   converted slice -> invoke optional rich paste notification hook.
 * @version 4
 * @date 2026-09-18
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Slice, Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import {
  htmlToMdast,
  parseMarkdown,
  renderHtml,
  serializeDocument,
  type KdocDocument,
} from '@k-doc/core';
import { mdastToProseMirror } from './from-mdast.js';
import { parseDelimitedText, buildTableNode } from './paste-table.js';
import { parseCsvText } from './csv-table.js';
import { kdocSchema } from './schema.js';
import { proseMirrorToMdast } from './to-mdast.js';

// 'table' reads tab-separated text as a grid. It is a mode rather than something the Markdown paste
// guesses at, because a tab is not always a column, and turning prose into a table uninvited is a
// harder mistake to notice than pasting a line with tabs in it.
export type PasteMode = 'markdown' | 'plain' | 'html' | 'table';

export interface ClipboardHandlers {
  handlePaste(view: EditorView, event: ClipboardEvent): boolean;
}

export interface ClipboardOptions {
  readonly schema: Schema;
  /** Notified after a rich paste, so the shell can show the paste-options popup. FR-7.4. */
  readonly onRichPaste?: (info: RichPasteInfo) => void;
  /**
   * Notified when the clipboard carries image files rather than text, so the shell can write them into the
   * attachments folder and embed them (FR-6.14). Returning true means the shell took the paste; returning
   * false lets the ordinary text handling run.
   */
  readonly onPasteImages?: (images: readonly File[]) => boolean;
  /**
   * Consulted once per paste. A non-null result overrides the mode this handler would otherwise
   * choose, and the implementation is expected to clear itself after being read.
   *
   * This exists because `Ctrl+Shift+V` cannot be a ProseMirror command: a command runs against a
   * state and has no access to a clipboard. The shell records the intent on keydown and the very
   * next paste event consumes it, which keeps the decision in the one place a paste is applied.
   */
  readonly takePasteMode?: () => PasteMode | null;
}

export interface RichPasteInfo {
  /** Document range the paste occupied, for a re-paste in another mode. */
  readonly from: number;
  readonly to: number;
  readonly html: string;
  readonly text: string;
}

/** The document range a paste occupied, so a second reading can replace exactly that. */
export interface PastedRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Detects whether the current selection or caret is positioned inside a code block.
 *
 * @purpose Prevents rich Markdown/HTML parsing from applying inside code blocks, where text is verbatim code.
 * @inputs state - The ProseMirror EditorState to inspect.
 * @outputs boolean - True if the caret or selection is enclosed by or selects a codeBlock node.
 * @dataflow state.selection -> inspect NodeSelection node type or climb $from ancestor depths -> match 'codeBlock'.
 * @controlflow Check NodeSelection target -> traverse ancestor nodes from $from.depth to 1 -> return true if codeBlock found, false otherwise.
 */
function isInsideCodeBlock(state: EditorState): boolean {
  // Check if current selection is a NodeSelection directly targeting a codeBlock node.
  if ('node' in state.selection) {
    const selectedNode = (state.selection as { node?: PMNode }).node;
    if (selectedNode && selectedNode.type.name === 'codeBlock') {
      // Branch: Selection is a NodeSelection targeting a codeBlock node directly.
      return true;
    } else {
      // Branch: Selected node is not a codeBlock; continue checking ancestors.
    }
  } else {
    // Branch: Selection is not a NodeSelection.
  }

  const $from = state.selection.$from;
  // Traverse upward through all ancestor depths from the caret position.
  for (let depth = $from.depth; depth > 0; depth--) {
    const ancestor = $from.node(depth);
    if (ancestor.type.name === 'codeBlock') {
      // Branch: Enclosing ancestor at this depth is a codeBlock.
      return true;
    } else {
      // Branch: Ancestor at this depth is not a codeBlock; continue searching upwards.
    }
  }

  // Branch: No codeBlock ancestor found in the selection hierarchy.
  return false;
}

/**
 * Dispatches a paste transaction to an EditorView and returns the document range it occupied.
 *
 * @purpose Dispatches a paste transaction to the view and computes the resulting document range by mapping selection positions forward.
 * @inputs view - The ProseMirror EditorView to which the transaction is dispatched.
 * @inputs tr - The ProseMirror Transaction representing the paste operation.
 * @outputs PastedRange - The document range occupied by the applied paste.
 * @dataflow view.state.selection -> capture before positions -> tr.mapping.map(before.to) -> view.dispatch(tr) -> PastedRange.
 * @controlflow Capture pre-dispatch selection -> map end position through transaction -> dispatch transaction -> return range.
 */
function applyPaste(view: EditorView, tr: Transaction): PastedRange {
  // The range has to be worked out *before* the dispatch, because the positions it is expressed in are
  // the ones the transaction maps from.
  const before = view.state.selection;
  // Both ends are mapped, and the bias is what makes them the edges of the inserted content rather than
  // points inside it: -1 keeps the start in front of what arrived, 1 keeps the end behind it.
  //
  // The start needs mapping as much as the end does. A table pasted over a text selection is lifted out
  // of the paragraph that held it, so the position the selection started at ends up one step inside the
  // new block -- and a range that starts inside a table replaces the table's contents rather than the
  // table. Reading either end off the selection after the dispatch is worse still: ProseMirror puts the
  // caret inside a newly inserted block, which is a cell.
  const mapped: PastedRange = { from: tr.mapping.map(before.from, -1), to: tr.mapping.map(before.to, 1) };
  const range = changedRange(tr, mapped);
  view.dispatch(tr);
  return range;
}

/**
 * @purpose The span of the finished document that a transaction's steps replaced, for reporting where a paste landed.
 * @inputs tr - The paste transaction, not yet dispatched; selection - The old selection mapped through it.
 * @outputs PastedRange - The smallest range covering the mapped selection and every replaced span, in the coordinates of
 *   the transaction's result.
 * @dataflow each step map -> its replaced spans -> mapped through the later steps -> widened min start, max end.
 * @controlflow Start from the mapped selection and widen it over every step's changed spans.
 *
 * Mapping the old selection is not enough: a block pasted with the caret at the end of a paragraph is inserted after that
 * paragraph, beyond both ends of the selection, so both map to the same point in front of it and the paste would be
 * recorded as empty. A later "paste as" would then insert beside the first paste instead of replacing it.
 */
export function changedRange(tr: Transaction, selection: PastedRange): PastedRange {
  let from = selection.from;
  let to = selection.to;
  tr.mapping.maps.forEach((map, index) => {
    // A span replaced by one step is expressed in that step's output; the steps after it can still move it. Only the end
    // needs mapping: a later step that moves a start does so by changing something in front of it, whose own span then
    // starts earlier still, so the minimum is the same either way.
    const later = tr.mapping.slice(index + 1);
    map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number): void => {
      from = Math.min(from, newStart);
      to = Math.max(to, later.map(newEnd, 1));
    });
  });
  return { from, to };
}

/**
 * Applies pasted content to an EditorView under the specified PasteMode.
 *
 * NOTE ON ARCHITECTURE:
 * `pasteContent` is the single place a paste is applied, so every entry point — the native paste
 * event, `Ctrl+Shift+V` plain-text shortcut, and a later Paste Special re-paste from the UI popup —
 * goes through one implementation.
 *
 * @purpose Centralized paste applicator executing plain text, Markdown, or HTML insertion into ProseMirror.
 * @inputs view - The ProseMirror EditorView into which content should be pasted.
 * @inputs html - The HTML representation from the clipboard, or empty string.
 * @inputs text - The plain text representation from the clipboard, or empty string.
 * @inputs mode - The target PasteMode ('plain', 'markdown', or 'html').
 * @outputs PastedRange | null - Returns the range the paste occupied, or null when nothing was inserted.
 * @dataflow html/text string -> convert to ProseMirror Slice (or plain text) -> replaceSelection -> view.dispatch(tr).
 * @controlflow Branch on mode -> validate non-empty payload -> construct Slice/transaction -> dispatch and return true (or return false on empty/invalid).
 */
export function pasteContentAt(
  view: EditorView,
  html: string,
  rawText: string,
  mode: PasteMode
): PastedRange | null {
  // A Windows clipboard ends lines with CRLF while the document holds LF. A carriage return left in pasted text would sit
  // in the paragraph as a character that the Source pane counts differently.
  const text = rawText.replace(/\r\n?/g, '\n');
  // Branch: Plain text paste mode.
  if (mode === 'plain') {
    // Check if plain text string is empty.
    if (text.length === 0) {
      // Branch: Empty plain text; nothing to insert.
      return null;
    } else {
      // Branch: Non-empty plain text; proceed with verbatim insertion.
    }

    // Plain text means plain: no input rules, no Markdown interpretation, just the characters.
    const tr = view.state.tr.insertText(text);
    return applyPaste(view, tr);
  }
  // Branch: Markdown paste mode.
  else if (mode === 'markdown') {
    // Check if Markdown text payload is empty.
    if (text.length === 0) {
      // Branch: Empty Markdown text; nothing to insert.
      return null;
    } else {
      // Branch: Non-empty Markdown text; parse with parseMarkdown.
    }

    // Parse text as Markdown through the core unified parser.
    const kdocDoc = parseMarkdown(text);
    // Check if the parsed mdast root contains any children.
    if (kdocDoc.root.children.length === 0) {
      // Branch: Parsed mdast root is empty; return false.
      return null;
    } else {
      // Branch: Parsed mdast root has content; convert to ProseMirror node tree.
    }

    const node = mdastToProseMirror(kdocDoc.root, view.state.schema);
    // Check if the converted node has content.
    if (node.content.size === 0) {
      // Branch: Converted node content is empty; return false.
      return null;
    } else {
      // Branch: Converted node has content; build Slice and replace selection.
    }

    // Build a Slice from the converted node's content with `new Slice(node.content, 0, 0)`.
    // Why a Slice rather than `replaceSelectionWith`: the pasted content is usually several
    // blocks (paragraphs, lists, headings), whereas `replaceSelectionWith` only accepts a single node.
    const slice = new Slice(node.content, 0, 0);
    const tr = view.state.tr.replaceSelection(slice);
    return applyPaste(view, tr);
  }
  // Branch: HTML paste mode.
  else if (mode === 'html') {
    // Check if HTML payload is empty or whitespace-only.
    if (html.trim().length === 0) {
      // Branch: Empty or whitespace-only HTML; nothing to insert.
      return null;
    } else {
      // Branch: Non-empty HTML; convert through core htmlToMdast pipeline.
    }

    // Convert HTML to mdast through the core rehype/remark pipeline.
    const mdastRoot = htmlToMdast(html);
    // Check if the converted mdast root contains any children.
    if (mdastRoot.children.length === 0) {
      // Branch: Converted mdast root is empty; return false.
      return null;
    } else {
      // Branch: Converted mdast root has content; convert to ProseMirror node tree.
    }

    const node = mdastToProseMirror(mdastRoot, view.state.schema);
    // Check if the converted node has content.
    if (node.content.size === 0) {
      // Branch: Converted node content is empty; return false.
      return null;
    } else {
      // Branch: Converted node has content; build Slice and replace selection.
    }

    // Build a Slice from the converted node's content with `new Slice(node.content, 0, 0)`.
    // Why a Slice rather than `replaceSelectionWith`: the pasted content is usually several
    // blocks (paragraphs, lists, headings), whereas `replaceSelectionWith` only accepts a single node.
    const slice = new Slice(node.content, 0, 0);
    const tr = view.state.tr.replaceSelection(slice);
    return applyPaste(view, tr);
  }
  // Branch: Table paste mode.
  else if (mode === 'table') {
    // The text carries the grid: tab-separated first, which Excel, Sheets and a Word table all put on the clipboard,
    // then comma- or semicolon-separated values (FR-8.24). Only when the text is neither does the HTML's first table
    // stand in, which keeps its cells' formatting. Prose that is none of these is refused rather than made a table.
    const parsed = parseDelimitedText(text) ?? parseCsvText(text);
    let tableNode: PMNode | null;
    // Check whether the text held a grid.
    if (parsed !== null) {
      // Branch: A grid; build the table node from it.
      tableNode = buildTableNode(parsed);
    } else {
      // Branch: Not a grid; fall back to a table in the HTML, if any.
      tableNode = htmlTableNode(html, view.state.schema);
    }
    // Check whether the schema could build a table from it.
    if (tableNode === null) {
      // Branch: No table node type in the schema, or no rows; nothing to insert.
      return null;
    } else {
      // Branch: Table built; replace the selection with it.
    }

    const tr = view.state.tr.replaceSelection(new Slice(Fragment.from(tableNode), 0, 0));
    return applyPaste(view, tr);
  }
  // Branch: Unrecognized paste mode.
  else {
    return null;
  }
}

/**
 * @purpose Reports whether table paste mode would insert a table for this clipboard content, so the option is offered exactly
 *   when taking it works (FR-8.24).
 * @inputs html - The clipboard's HTML, possibly empty; text - Its plain text.
 * @outputs boolean - True for tab- or comma/semicolon-separated text, or HTML holding a table.
 * @dataflow text -> parseDelimitedText / parseCsvText; html -> htmlTableNode.
 * @controlflow The same tests, in the same order, as the table branch of pasteContentAt.
 */
export function canPasteAsTable(html: string, text: string): boolean {
  return parseDelimitedText(text) !== null || parseCsvText(text) !== null || htmlTableNode(html, kdocSchema) !== null;
}

/**
 * @purpose Builds the ProseMirror node for the first table in pasted HTML, for table paste mode (FR-8.24).
 * @inputs html - The clipboard's HTML, possibly empty; schema - The editor schema.
 * @outputs PMNode | null - The table node with its cell formatting, or null when the HTML holds no table.
 * @dataflow html -> htmlToMdast -> first table -> mdastToProseMirror -> the document's first child.
 * @controlflow Convert; refuse HTML whose conversion has no table; return the converted table.
 */
function htmlTableNode(html: string, schema: Schema): PMNode | null {
  const table = htmlToMdast(html).children.find((child) => child.type === 'table');
  // The table may have been dropped by the converter (for example, one with no rows).
  if (table === undefined) {
    return null;
  } else {
    // Converted: build its ProseMirror node below.
  }
  // The conversion of a lone table yields that table as the document's first child.
  return mdastToProseMirror({ type: 'root', children: [table] }, schema).firstChild;
}

/**
 * Applies pasted content to an EditorView under the specified PasteMode.
 *
 * Kept because most callers only need to know whether anything happened.
 *
 * @purpose Centralized paste applicator returning whether content was successfully inserted.
 * @inputs view - The ProseMirror EditorView into which content should be pasted.
 * @inputs html - The HTML representation from the clipboard, or empty string.
 * @inputs text - The plain text representation from the clipboard, or empty string.
 * @inputs mode - The target PasteMode ('plain', 'markdown', 'html', or 'table').
 * @outputs boolean - Returns true if content was successfully applied, false if there was nothing to insert.
 * @dataflow html/text string -> pasteContentAt -> check non-null range -> return boolean flag.
 * @controlflow Delegate to pasteContentAt -> check if returned range is non-null -> return true or false.
 */
export function pasteContent(
  view: EditorView,
  html: string,
  text: string,
  mode: PasteMode
): boolean {
  // Check whether the paste inserted content into the document.
  if (pasteContentAt(view, html, text, mode) !== null) {
    // Branch: Content was inserted; return true.
    return true;
  } else {
    // Branch: Nothing was inserted; return false.
    return false;
  }
}

/**
 * Constructs ProseMirror view props for clipboard handling.
 *
 * @purpose Creates the handlePaste prop handler conforming to ProseMirror's EditorProps interface.
 * @inputs options - ClipboardOptions providing the schema and optional onRichPaste callback.
 * @outputs ClipboardHandlers - An object exposing the handlePaste(view, event) method.
 * @dataflow ClipboardEvent -> read clipboardData -> check code block -> route mode -> pasteContent -> notify onRichPaste.
 * @controlflow Guard codeBlock -> guard clipboardData -> branch on HTML presence (apply 'html' and notify) -> branch on text presence (apply 'markdown') -> return false.
 */
export function createClipboardHandlers(options: ClipboardOptions): ClipboardHandlers {
  return {
    handlePaste(view: EditorView, event: ClipboardEvent): boolean {
      // Do nothing (return false) when the caret is inside a code block, so pasting into code
      // inserts the characters — Markdown structure inside a fence is text, not structure.
      if (isInsideCodeBlock(view.state)) {
        // Branch: Caret is within a code block; return false so ProseMirror performs default insertion.
        return false;
      } else {
        // Branch: Caret is in standard content; proceed to inspect clipboard data.
      }

      // Read text/html and text/plain from event.clipboardData.
      const clipboardData = event.clipboardData;
      // When there is no clipboard data at all, return false and let ProseMirror do its default.
      if (!clipboardData) {
        // Branch: clipboardData is missing; return false.
        return false;
      } else {
        // Branch: clipboardData is present; extract payloads.
      }

      // Image files on the clipboard are offered to the shell first: a screenshot pasted into a note is a
      // file to write, not text to insert, and the clipboard's own text for it names nothing useful.
      const images: File[] = [];
      // A clipboard that reports no file list at all is read as carrying no files, rather than as a failure:
      // the list is optional in practice, and a paste of text must not depend on it being there.
      const files: FileList | undefined = clipboardData.files;
      // Check whether there is a list of files to look through.
      if (files !== undefined) {
        for (let i = 0; i < files.length; i++) {
          const file = files.item(i);
          // Check whether the entry is a file whose type says it is an image.
          if (file !== null && file.type.startsWith('image/')) {
            images.push(file);
          } else {
            // Not an image file: left to the text handling below.
          }
        }
      } else {
        // No list: nothing on the clipboard is a file.
      }
      // Check whether there are images and something willing to take them.
      if (images.length > 0 && options.onPasteImages !== undefined) {
        const taken = options.onPasteImages(images);
        // Check whether the shell took the paste.
        if (taken) {
          return true;
        } else {
          // It did not: fall through to the ordinary text handling.
        }
      } else {
        // No images, or nothing to hand them to: carry on with text.
      }
      const html = clipboardData.getData('text/html');
      const text = clipboardData.getData('text/plain');

      // An override set by Ctrl+Shift+V takes precedence over everything below, including the
      // presence of HTML: the user has said explicitly what they want this paste to mean.
      const override = options.takePasteMode?.() ?? null;
      if (override !== null) {
        // Override present: apply it and report handled, whether or not it inserted anything. A
        // deliberate "paste as plain" over an empty clipboard should not silently fall back to a
        // rich paste of the same clipboard.
        pasteContent(view, html, text, override);
        return true;
      } else {
        // No override: fall through to the ordinary HTML-then-Markdown preference.
      }

      // Check if both extracted payloads are empty.
      if (html.length === 0 && text.length === 0) {
        // Branch: Neither HTML nor text payload exists; return false.
        return false;
      } else {
        // Branch: At least one payload exists.
      }

      // When HTML is present, use it (mode: 'html') and return true; record from/to of the inserted
      // range and call onRichPaste with the info. This is what the paste-options popup needs in order
      // to offer a different interpretation of the same clipboard afterwards.
      if (html.length > 0) {
        const range = pasteContentAt(view, html, text, 'html');
        // Check whether the paste inserted anything.
        if (range !== null) {
          // Check whether anyone is listening for the report.
          if (options.onRichPaste) {
            options.onRichPaste({ from: range.from, to: range.to, html, text });
          } else {
            // Branch: onRichPaste callback not supplied in options.
          }
          return true;
        } else {
          // Branch: HTML paste yielded no inserted content; fall through to evaluate plain text.
        }
      } else {
        // Branch: No HTML payload present in clipboard data.
      }

      // When only plain text is present, parse it as Markdown (mode: 'markdown').
      // Reasoning: text copied out of a Markdown file IS Markdown, and pasting "## Heading" as
      // a literal line of prose in a Markdown editor is the wrong default. Ctrl+Shift+V is the escape
      // hatch for when it is not.
      if (text.length > 0) {
        const range = pasteContentAt(view, html, text, 'markdown');
        // Check whether the paste inserted anything.
        if (range !== null) {
          // A text-only clipboard is reported too. A TSV copied out of a terminal arrives with no HTML
          // at all, and that is exactly the paste whose user most wants the table option -- reporting
          // only the HTML path would offer the choice to the pastes that least need it.
          // Check whether anyone is listening for the report.
          if (options.onRichPaste) {
            options.onRichPaste({ from: range.from, to: range.to, html, text });
          } else {
            // Branch: onRichPaste callback not supplied in options.
          }
          return true;
        } else {
          // Branch: Nothing was inserted, so there is nothing to offer a second reading of.
        }
        return false;
      } else {
        // Branch: No text payload available to paste.
        return false;
      }
    },
  };
}

/**
 * Command placeholder for pasting clipboard content as plain text.
 *
 * @purpose Registry placeholder command for paste-as-plain-text (Ctrl+Shift+V).
 * @inputs None.
 * @outputs Command - A ProseMirror Command returning false always.
 * @dataflow None.
 * @controlflow Returns a command that returns false unconditionally.
 */
export function pasteAsPlainText(): Command {
  // `pasteAsPlainText()` is a Command that reads nothing itself — it cannot, since a command
  // has no clipboard access. Instead it returns false always, and carries a comment saying it
  // exists as a registry placeholder whose real work is done by the shell's keydown handler
  // calling `pasteContent(..., 'plain')` with the clipboard event; a command that silently
  // did nothing would be worse than one that declares it cannot apply.
  return (_state: EditorState, _dispatch?: (tr: Transaction) => void, _view?: EditorView): boolean => {
    return false;
  };
}

/**
 * Helper extracting the current selection from EditorState into a canonical KdocDocument.
 *
 * @purpose Wraps selection content into block nodes, converts to mdast Root via proseMirrorToMdast, and constructs KdocDocument.
 * @inputs state - The ProseMirror EditorState containing the active selection.
 * @outputs KdocDocument | null - The constructed KdocDocument, or null if the selection is empty or produced no content.
 * @dataflow state.selection.content() -> collect block nodes (wrapping loose inlines in paragraph) -> doc.create -> proseMirrorToMdast -> KdocDocument.
 * @controlflow Guard empty selection -> iterate slice content -> buffer inlines and collect blocks -> build doc PMNode -> convert to mdast -> return KdocDocument.
 */
function selectionToKdocDocument(state: EditorState): KdocDocument | null {
  // Check if the current selection is empty. Both selectionAsMarkdown and selectionAsHtml return '' for an empty selection.
  if (state.selection.empty) {
    // Branch: Selection is empty; return null immediately.
    return null;
  } else {
    // Branch: Selection is non-empty; proceed to extract selection content.
  }

  const slice = state.selection.content();
  const blocks: PMNode[] = [];
  const inlineBuffer: PMNode[] = [];

  const flushInlineBuffer = (): void => {
    if (inlineBuffer.length > 0) {
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        blocks.push(paragraphType.create(null, inlineBuffer));
      } else {
        // Branch: Schema lacks paragraph node type.
      }
      inlineBuffer.length = 0;
    } else {
      // Branch: Inline buffer is already empty.
    }
  };

  // Inspect child nodes in slice content: wrap inline runs in paragraphs so doc node receives valid block+ children.
  slice.content.forEach((child) => {
    if (child.isBlock) {
      // Flush preceding inlines into a paragraph before adding this block.
      flushInlineBuffer();
      blocks.push(child);
    } else {
      // Accumulate inline node into current inline run buffer.
      inlineBuffer.push(child);
    }
  });
  // Flush any remaining trailing inlines.
  flushInlineBuffer();

  // Check if any blocks were generated from the selection.
  if (blocks.length === 0) {
    // Branch: Selection produced no valid block content.
    return null;
  } else {
    // Branch: Blocks exist; construct doc node.
  }

  const docType = state.schema.nodes.doc;
  if (!docType) {
    // Branch: Schema lacks doc node type.
    return null;
  } else {
    // Branch: doc NodeType exists.
  }

  const docNode = docType.create(null, blocks);
  const mdastRoot = proseMirrorToMdast(docNode);

  return {
    text: '',
    root: mdastRoot,
    frontMatter: null,
  };
}

/**
 * Serializes the current editor selection to Markdown text.
 *
 * @purpose Converts the current ProseMirror selection to mdast with proseMirrorToMdast over a document built from selection content, and serializes it.
 * @inputs state - The ProseMirror EditorState containing the active selection.
 * @outputs string - The formatted Markdown text, or empty string if selection is empty.
 * @dataflow state -> selectionToKdocDocument -> serializeDocument -> Markdown string.
 * @controlflow Call selectionToKdocDocument -> if null return '' -> else return serializeDocument(document).
 */
export function selectionAsMarkdown(state: EditorState): string {
  const document = selectionToKdocDocument(state);
  // Check if document was successfully built from selection.
  if (!document) {
    // Branch: Empty selection or no content; return empty string.
    return '';
  } else {
    // Branch: Document exists; serialize to Markdown text.
    return serializeDocument(document);
  }
}

/**
 * Serializes the current editor selection to an HTML fragment.
 *
 * @purpose Converts the current ProseMirror selection to mdast with proseMirrorToMdast over a document built from selection content, and renders through core HTML renderer.
 * @inputs state - The ProseMirror EditorState containing the active selection.
 * @outputs string - The rendered HTML fragment string, or empty string if selection is empty.
 * @dataflow state -> selectionToKdocDocument -> renderHtml -> HTML fragment string.
 * @controlflow Call selectionToKdocDocument -> if null return '' -> else return renderHtml(document).
 */
export function selectionAsHtml(state: EditorState): string {
  const document = selectionToKdocDocument(state);
  // Check if document was successfully built from selection.
  if (!document) {
    // Branch: Empty selection or no content; return empty string.
    return '';
  } else {
    // Branch: Document exists; render through core's HTML renderer.
    return renderHtml(document);
  }
}
