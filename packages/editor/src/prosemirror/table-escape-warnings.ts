/**
 * @file table-escape-warnings.ts
 * @purpose Tells the host when content that Markdown tables cannot hold as written is entered into a table cell (FR-8.25): a pipe saved escaped as \|, or a line break saved as a space.
 * @inputs ProseMirror transactions produced by edits to table cells.
 * @outputs A plugin whose appendTransaction reports each escape kind once per batch; exported message text for the host to display.
 * @functions
 *   - sliceKinds: Determines which escape kinds an inserted Slice contains.
 *   - insideTableCell: Reports whether a document position lies within a table cell's content.
 *   - escapeKindsIn: Collects the escape kinds entered into table cells by each replace step of a transaction.
 *   - createTableEscapeWarningPlugin: Builds an observational plugin that forwards escape kinds to a callback.
 * @dataflow Transaction steps → sliceKinds / insideTableCell → escapeKindsIn → appendTransaction callback → onWarning.
 * @controlflow Mount plugin → observe transactions in appendTransaction → for each docChanged transaction collect escape kinds → report each kind once via onWarning.
 * @version 1
 * @date 2026-09-15
 */

import { Plugin, type Transaction } from 'prosemirror-state';
import { ReplaceStep, type Step } from 'prosemirror-transform';
import type { Node as ProseMirrorNode, Slice } from 'prosemirror-model';

export type TableEscapeKind = 'pipe' | 'line-break';

/** What the host is told for each kind, worded for the person typing. */
export const TABLE_ESCAPE_MESSAGES: Readonly<Record<TableEscapeKind, string>> = {
  pipe: 'A | in a table cell is saved as \\| so the table stays intact.',
  'line-break': 'A Markdown table cell cannot hold a line break; it will be saved as a space.',
};

/**
 * @purpose Determines which escape kinds an inserted Slice contains: a pipe in text, or a hard break node / line feed in text.
 * @inputs slice - The Slice of content being inserted into a table cell.
 * @returns TableEscapeKind[] - The distinct escape kinds present ('pipe' and/or 'line-break'); order is not significant.
 * @dataflow Slice nodes → text inspection → boolean flags (pipe, lineBreak) → collected kind array.
 * @controlflow Descend every node in the slice; set pipe on a text run containing '|', set lineBreak on a hardBreak node or a text run containing '\n'; then push each detected kind into the result.
 */
function sliceKinds(slice: Slice): TableEscapeKind[] {
  // Which kinds the inserted content holds: text containing a pipe, and a hard break node or text containing a line feed.
  let pipe = false;
  let lineBreak = false;
  slice.content.descendants((node: ProseMirrorNode): boolean => {
    if (node.isText) {
      // The node is inline text that may contain an escaped-content marker.
      const text = node.text ?? '';
      // Text contains a pipe character: mark the pipe escape kind.
      if (text.includes('|')) {
        pipe = true;
      } else {
        // No pipe in this run of text.
      }
      // Text contains a line feed: mark the line-break escape kind.
      if (text.includes('\n')) {
        lineBreak = true;
      } else {
        // No line feed in this run of text.
      }
    } else if (node.type.name === 'hardBreak') {
      // A hard break node represents a line break that a GFM cell cannot hold.
      lineBreak = true;
    } else {
      // Another node: its children are visited next.
    }
    return true;
  });
  const kinds: TableEscapeKind[] = [];
  if (pipe) {
    kinds.push('pipe');
  } else {
    // No pipe escape kind detected.
  }
  if (lineBreak) {
    kinds.push('line-break');
  } else {
    // No line-break escape kind detected.
  }
  return kinds;
}

/**
 * @purpose Reports whether a position in `doc` lies inside a table cell's content.
 * @inputs doc - The document whose structure is inspected. pos - A flat offset within `doc`.
 * @returns boolean - True if the position is nested within a node named 'tableCell'.
 * @dataflow Flat offset → resolved $pos → climb from depth to root checking each enclosing node's type name.
 * @controlflow Resolve pos; loop depth from $pos.depth down to 1, returning true on the first 'tableCell' node, else return false after the loop.
 */
function insideTableCell(doc: ProseMirrorNode, pos: number): boolean {
  // Whether a position in `doc` lies inside a table cell's content.
  const $pos = doc.resolve(pos);
  // Climb from the innermost enclosing node toward the document root.
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    // Check whether this enclosing node is a table cell.
    if ($pos.node(depth).type.name === 'tableCell') {
      // Position is inside a table cell.
      return true;
    } else {
      // Keep climbing toward the document root.
    }
  }
  return false;
}

/**
 * @purpose Collects the escape kinds entered into table cells by each replace step of a transaction.
 * @inputs tr - The transaction whose steps are inspected; prior documents are read from tr.docs.
 * @returns TableEscapeKind[] - The distinct escape kinds found across all qualifying replace steps.
 * @dataflow Each step → its prior doc + inserted slice → insideTableCell + sliceKinds → accumulated Set.
 * @controlflow For each step, early-return unless it is a ReplaceStep with a valid prior doc and an insertion point inside a cell; otherwise add the slice's kinds to the set; return the spread of the set.
 */
export function escapeKindsIn(tr: Transaction): TableEscapeKind[] {
  // The kinds a transaction entered into table cells: each replace step whose insertion point is inside a cell of the document it applied to.
  const found = new Set<TableEscapeKind>();
  tr.steps.forEach((step: Step, index: number) => {
    const before = tr.docs[index];
    // A replace step with a matching prior document is required to inspect inserted content.
    if (!(step instanceof ReplaceStep) || before === undefined) {
      return;
    } else {
      // A replace step.
    }
    // Content entered into a cell needs an insertion point inside a table cell. A pure deletion needs no check of its own:
    // its empty slice holds nothing to report.
    if (!insideTableCell(before, step.from)) {
      return;
    } else {
      // Content entered into a cell.
    }
    for (const kind of sliceKinds(step.slice)) {
      found.add(kind);
    }
  });
  return [...found];
}

/**
 * @purpose Builds an observational plugin that forwards each escape kind detected in a batch of transactions to a callback, once per kind.
 * @inputs onWarning - Callback invoked with the escape kind entered into a table cell.
 * @returns Plugin - A ProseMirror plugin whose appendTransaction reports kinds and appends nothing.
 * @dataflow Batch of transactions → docChanged filter → escapeKindsIn → Set of kinds → onWarning per kind.
 * @controlflow For each transaction, if docChanged collect its escape kinds into a set; after the loop report every collected kind once via onWarning; return null to append nothing.
 */
export function createTableEscapeWarningPlugin(onWarning: (kind: TableEscapeKind) => void): Plugin {
  return new Plugin({
    appendTransaction(transactions: readonly Transaction[]): null {
      // Only document edits can enter content; each kind is reported once per batch of transactions.
      const kinds = new Set<TableEscapeKind>();
      // A transaction that only moves the selection has no steps, so it contributes nothing without a check of its own.
      for (const tr of transactions) {
        for (const kind of escapeKindsIn(tr)) {
          kinds.add(kind);
        }
      }
      for (const kind of kinds) {
        onWarning(kind);
      }
      // Nothing to append: the plugin only observes.
      return null;
    },
  });
}
