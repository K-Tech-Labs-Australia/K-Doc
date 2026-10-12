/**
 * @file table-grips-plugin.ts
 * @purpose ProseMirror plugin providing drag handles (grips) for reordering GFM table rows and columns (FR-8.20).
 *   A grip is a widget decoration, so it is never part of the document — a handle that ended up in the
 *   Markdown would be a handle that corrupted the file it was meant to help edit.
 *
 *   The drag carries nothing but two integers, because a reorder is entirely described by which and
 *   where to. The dragged index is recorded in the plugin's own closure rather than on the DataTransfer,
 *   since a drag inside one table has no business being droppable anywhere else.
 *
 *   Row 0 gets no grip. GFM has no table without a header row, so a handle that could move it would offer
 *   something the format cannot express — and a control that cannot do what it looks like it does is worse
 *   than no control.
 * @inputs ProseMirror EditorState instances, Transactions, and table document nodes.
 * @outputs ProseMirror Plugin managing a DecorationSet of table grip widget decorations, keyed by tableGripsPluginKey.
 * @functions
 *   - createTableGripsPlugin: Instantiates the ProseMirror plugin providing row and column drag grip decorations.
 * @dataflow Document table nodes -> buildGrips traversal -> create row/column widget decorations with gripFor -> DecorationSet -> view.
 * @controlflow Initialize decorations on plugin init -> on transaction apply: map existing decorations if doc unchanged, rebuild decorations if doc changed -> props.decorations exposes DecorationSet.
 * @version 1
 * @date 2026-09-11
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { moveRowTo, moveColumnTo } from './table-reorder.js';

/**
 * Plugin key uniquely identifying the table grips plugin and its DecorationSet state in an EditorState.
 */
export const tableGripsPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('kdocTableGrips');

/**
 * CSS class name applied to row drag grip handles.
 */
export const TABLE_GRIP_ROW_CLASS: string = 'kdoc-table-grip-row';

/**
 * CSS class name applied to column drag grip handles.
 */
export const TABLE_GRIP_COLUMN_CLASS: string = 'kdoc-table-grip-column';

/**
 * CSS stylesheet defining dimensions, appearance, and hover/focus reveal styles for table grip handles.
 *
 * user-select: none keeps a grip out of a selection dragged across the table, since
 * the handle lives inside a cell and would otherwise join that cell's DOM text run. Note that a grip is
 * revealed on hover and on keyboard focus, because a control that only appears under a pointer cannot be
 * reached without one. Note the selectors use tr:hover rather than th:hover because this schema's cells
 * render as <td> — there is no <th>.
 */
export const TABLE_GRIP_STYLES: string = `
.kdoc-table-grip-row,
.kdoc-table-grip-column {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border-radius: 2px;
  background: var(--kdoc-color-border-strong, #8c959f);
  opacity: 0;
  transition: opacity 120ms;
  cursor: grab;
  vertical-align: middle;
  user-select: none;
  -webkit-user-select: none;
}

tr:hover .kdoc-table-grip-row,
tr:hover .kdoc-table-grip-column,
.kdoc-table-grip-row:focus-visible,
.kdoc-table-grip-column:focus-visible {
  opacity: 1;
}
`;

/**
 * Creates the ProseMirror plugin that attaches drag handle widgets to table rows and columns (FR-8.20).
 *
 * @purpose Instantiates and configures the ProseMirror plugin that generates and maintains drag grip decorations for reordering table rows and columns.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror plugin instance managing table grip widget decorations.
 * @dataflow Dispatched transactions -> apply() updates or maps DecorationSet -> decorations() returns active DecorationSet to view.
 * @controlflow Initialize dragRow/dragColumn in closure -> instantiate Plugin with tableGripsPluginKey -> state.init builds initial decorations -> state.apply maps existing decorations if doc unchanged or rebuilds if doc changed -> props.decorations retrieves state decorations.
 */
export function createTableGripsPlugin(): Plugin<DecorationSet> {
  // The drag state lives in this call's closure rather than module scope so two editors on one page never share one drag.
  let dragRow: number | null = null;
  let dragColumn: number | null = null;

  /**
   * Constructs a draggable grip handle element for a table row or column.
   *
   * @purpose Creates a DOM span element configured as an interactive drag handle for reordering a specific table row or column.
   * @inputs
   *   - view: EditorView - The active ProseMirror EditorView instance.
   *   - kind: 'row' | 'column' - Whether this grip reorders a row or a column.
   *   - index: number - The 0-based index of the row or column to reorder.
   *   - getPos: () => number | undefined - Callback returning the current document position of this widget decoration.
   * @outputs HTMLElement - Draggable span element with configured drag-and-drop event listeners.
   * @dataflow User drag events -> record index in closure on dragstart -> resolve position & dispatch selection on drop -> moveRowTo/moveColumnTo command execution.
   * @controlflow Create span element -> set attributes & class -> attach dragstart, dragover, drop, and dragend listeners -> return span.
   */
  function gripFor(
    view: EditorView,
    kind: 'row' | 'column',
    index: number,
    key: string,
    getPos: () => number | undefined,
  ): HTMLElement {
    // The owning document comes from the view rather than the global, because the plugin
    // has no business assuming the editor lives in the document this module was loaded into.
    const span: HTMLSpanElement = view.dom.ownerDocument.createElement('span');

    // Check whether the grip is for a table row or a table column.
    if (kind === 'row') {
      // Grip is for a row: apply the row grip class name.
      span.className = TABLE_GRIP_ROW_CLASS;
    } else {
      // Grip is for a column: apply the column grip class name.
      span.className = TABLE_GRIP_COLUMN_CLASS;
    }

    span.draggable = true;
    // setAttribute rather than the contentEditable property: the property is an IDL reflection some
    // DOM implementations do not provide, and the attribute is what ProseMirror and the browser read.
    span.setAttribute('contenteditable', 'false');
    span.tabIndex = 0;
    span.title = `Drag to reorder ${kind} ${index + 1}`;
    span.setAttribute('aria-label', `Drag to reorder ${kind} ${index + 1}`);
    span.textContent = '';
    // The widget key is written onto the element as well as handed to the decoration. A key has to be
    // unique across the whole document or ProseMirror may reuse one table's grip for another's, and a
    // key that exists only inside the decoration spec is a correctness property nothing can observe.
    span.dataset['kdocGrip'] = key;

    span.addEventListener('dragstart', (event: DragEvent): void => {
      // The editor's own drag handling would try to move document content; this drag moves a row.
      event.stopPropagation();

      // Check whether this grip is dragging a row or a column.
      if (kind === 'row') {
        // Dragging a row: record row index in closure and reset column drag state.
        dragRow = index;
        dragColumn = null;
      } else {
        // Dragging a column: record column index in closure and reset row drag state.
        dragColumn = index;
        dragRow = null;
      }

      // Check whether the drag event provides a dataTransfer payload. A synthetic event carries none at
      // all, so absence is tested rather than null: reading a property off undefined would throw.
      const startTransfer: DataTransfer | null | undefined = event.dataTransfer;
      if (startTransfer === null || startTransfer === undefined) {
        // No DataTransfer: the closure already holds everything the drop needs.
      } else {
        // Set effectAllowed to 'move' and populate empty text/plain data because some browsers refuse to start a drag that sets no data at all.
        startTransfer.effectAllowed = 'move';
        startTransfer.setData('text/plain', '');
      }
    });

    span.addEventListener('dragover', (event: DragEvent): void => {
      // Preventing the default is what makes an element a drop target at all.
      event.preventDefault();

      // Check whether the drag event provides a dataTransfer object, absence included for the same
      // reason as in dragstart.
      const overTransfer: DataTransfer | null | undefined = event.dataTransfer;
      if (overTransfer === null || overTransfer === undefined) {
        // No DataTransfer: preventDefault alone still accepts the drop.
      } else {
        // Set dropEffect to 'move', because nothing is duplicated by a reorder.
        overTransfer.dropEffect = 'move';
      }
    });

    span.addEventListener('drop', (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // moveRowTo / moveColumnTo resolve their table from the selection, and a drag
      // never moved the caret, so the caret must be put in this grip's own cell first.
      const pos = getPos();

      // Check whether the grip's decoration position is valid.
      if (pos === undefined) {
        // When pos is undefined the grip has outlived its decoration and there is no position to work from.
        return;
      } else {
        // Position is defined: set selection to near this grip's position in its cell.
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
      }

      // Check whether this grip is for a table row or a table column.
      if (kind === 'row') {
        // Check whether a row drag is actually in flight. Whether it ends where it began is left to
        // moveRowTo, which already refuses a move that goes nowhere -- repeating that test here
        // would be a second place for the rule to be stated and a second place for it to drift.
        if (dragRow === null) {
          // No row drag in flight: the drop is not ours to act on.
        } else {
          // A row drag is in flight: ask for the move.
          moveRowTo(dragRow, index)(view.state, view.dispatch);
        }
      } else {
        // Check whether a column drag is actually in flight; moveColumnTo owns the no-op rule.
        if (dragColumn === null) {
          // No column drag in flight: the drop is not ours to act on.
        } else {
          // A column drag is in flight: ask for the move.
          moveColumnTo(dragColumn, index)(view.state, view.dispatch);
        }
      }
    });

    span.addEventListener('dragend', (): void => {
      // The drag is over however it ended; reset row and column drag state to null.
      dragRow = null;
      dragColumn = null;
    });

    return span;
  }

  /**
   * Scans the document for tables and builds a DecorationSet of row and column grip widget decorations.
   *
   * @purpose Traverses all nodes in the document, identifies tables, and creates widget decorations for column grips on header cells and row grips on body rows.
   * @inputs
   *   - state: EditorState - The ProseMirror EditorState whose document is scanned for table nodes.
   * @outputs DecorationSet - The complete set of row and column grip widget decorations for all tables in the document.
   * @dataflow state.doc -> descendants traversal -> filter table nodes -> inspect rows and cells -> instantiate widget decorations with gripFor -> DecorationSet.create.
   * @controlflow Traverse doc nodes via descendants -> return true for non-table nodes to continue descending -> for table, iterate rows -> row 0 iterates cells to place column grips, row > 0 places row grip in first cell -> return false to halt table descent -> return DecorationSet.
   */
  function buildGrips(state: EditorState): DecorationSet {
    const decorations: Decoration[] = [];

    state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
      // Check whether the visited node is a table.
      if (node.type.name !== 'table') {
        // Keep descending, since a table can sit inside a blockquote or a list.
        return true;
      } else {
        // Node is a table: inspect its rows and cells to place row and column grips.
      }

      node.forEach((row: ProseMirrorNode, offset: number, index: number): void => {
        // Check whether this row is row 0 (the header row) or a body row.
        if (index === 0) {
          // Row 0 is the header row: place column grip handles on each header cell.
          row.forEach((_cell: ProseMirrorNode, cellOffset: number, cellIndex: number): void => {
            // A cell holds inline* and renders as a <td>, so a grip must sit inside a cell —
            // pos + 1 steps into the table, + offset + 1 into the row, + cellOffset + 1 past
            // the cell node into its content, which is a position a widget can legally occupy.
            const at = pos + 1 + offset + 1 + cellOffset + 1;
            const key = `col-${pos}-${cellIndex}`;

            // A column has no node of its own in this schema, so its handle lives on the header cell —
            // which is also where a reader would reach for it.
            // The key includes pos because a widget key must be unique across the whole document and a second table would otherwise collide.
            decorations.push(
              Decoration.widget(
                at,
                (view: EditorView, getPos: () => number | undefined): HTMLElement =>
                  gripFor(view, 'column', cellIndex, key, getPos),
                { side: -1, key },
              ),
            );
          });
        } else {
          // Body row: push one widget at pos + 1 + offset + 2 — the content of the row's first cell,
          // i.e. the same arithmetic with cellOffset zero.
          const at = pos + 1 + offset + 2;
          const key = `row-${pos}-${index}`;
          decorations.push(
            Decoration.widget(
              at,
              (view: EditorView, getPos: () => number | undefined): HTMLElement =>
                gripFor(view, 'row', index, key, getPos),
              { side: -1, key },
            ),
          );
        }
      });

      // A table's contents are its rows and cells and the walk above has already read them.
      return false;
    });

    return DecorationSet.create(state.doc, decorations);
  }

  return new Plugin<DecorationSet>({
    key: tableGripsPluginKey,
    state: {
      /**
       * @purpose Initializes the plugin's DecorationSet state with table grips from the initial document.
       * @inputs _config: unknown, state: EditorState - Initial configuration and editor state.
       * @outputs DecorationSet - Initial set of table grip widget decorations.
       * @dataflow state -> buildGrips -> DecorationSet.
       * @controlflow Delegates directly to buildGrips(state).
       */
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial table grip widget decorations from the initial document state.
        return buildGrips(state);
      },

      /**
       * @purpose Updates the plugin's DecorationSet state across editor transactions.
       * @inputs tr: Transaction, value: DecorationSet, _old: EditorState, newState: EditorState.
       * @outputs DecorationSet - Updated decoration set mapped across edits or rebuilt from new structure.
       * @dataflow tr + value -> tr.docChanged check -> mapped DecorationSet or buildGrips(newState).
       * @controlflow Check if document changed -> map decorations if unchanged, rebuild if changed.
       */
      apply(
        tr: Transaction,
        value: DecorationSet,
        _old: EditorState,
        newState: EditorState,
      ): DecorationSet {
        // Check whether the document content was modified by this transaction.
        // A grip's index depends only on structure, so only a document change can invalidate it.
        if (!tr.docChanged) {
          // Document did not change: map existing decorations across transaction changes.
          return value.map(tr.mapping, tr.doc);
        } else {
          // Document changed: rebuild table grips from the new document structure.
          return buildGrips(newState);
        }
      },
    },
    props: {
      /**
       * @purpose Supplies table grip decorations to the ProseMirror view.
       * @inputs state: EditorState - The current editor state.
       * @outputs DecorationSet - Active decoration set from plugin state or DecorationSet.empty.
       * @dataflow state -> tableGripsPluginKey.getState -> DecorationSet.
       * @controlflow Retrieve plugin state or return empty decoration set fallback.
       */
      decorations(state: EditorState): DecorationSet {
        // Return active decoration set from plugin state, defaulting to empty set when state is uninitialized.
        return tableGripsPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
