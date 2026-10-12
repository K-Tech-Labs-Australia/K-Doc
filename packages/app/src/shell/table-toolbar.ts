/**
 * @file table-toolbar.ts
 * @purpose Implements the contextual GFM table toolbar for K-Doc's WYSIWYG editor pane, providing controls for inserting tables, modifying rows and columns, toggling column alignment, and deleting tables that execute ProseMirror commands and reflect table context.
 * @inputs TableToolbarOptions containing container element, ProseMirror EditorView instance, and Document context.
 * @outputs TableToolbar interface with refresh() and destroy() lifecycle methods, alongside TABLE_TOOLBAR_STYLES CSS stylesheet definition.
 * @functions
 *   - installTableToolbar: Instantiates and mounts table toolbar controls, registers event listeners, and returns the TableToolbar controller.
 * @dataflow User interaction -> ProseMirror Command execution -> EditorView state transaction -> caret/selection updates -> toolbar refresh() reflection.
 * @controlflow Mount insert table button and contextual control group -> attach click event listeners with AbortController -> execute initial refresh to reflect table presence and caret coordinates -> return TableToolbar interface with refresh and idempotent destroy.
 * @version 6
 * @date 2026-10-04
 */

import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { ColumnAlign } from '@k-doc/editor';
import {
  isInTable,
  tableAt,
  tableAlign,
  insertTable,
  deleteTable,
  addRowBefore,
  addRowAfter,
  deleteRow,
  duplicateRow,
  duplicateColumn,
  moveRow,
  moveColumn,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  setColumnAlign,
  sortTableByColumn,
  toggleHeaderRow,
  hasHeaderRow,
} from '@k-doc/editor';

export interface TableToolbarOptions {
  readonly container: HTMLElement;
  readonly view: EditorView;
  readonly doc: Document;
  /** Asks for the caret column's width hint (FR-8.26); the button is left out when absent. */
  readonly onColumnWidth?: () => void;
}

export interface TableToolbar {
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the table toolbar, defining raised plateau control groups,
 * physical buttons (extruded at rest, depressed with a tonal selection when active),
 * and rounded corners using exclusively authoritative K-Doc chrome design tokens.
 */
export const TABLE_TOOLBAR_STYLES: string = `
.kdoc-table-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kdoc-chrome-shadow-dark);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  flex-wrap: wrap;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-table-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-lg);
  padding: 12px;
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-table-contextual-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-lg);
  padding: 12px;
  box-shadow: var(--kdoc-elevation-raised);
}

/* The UA stylesheet's [hidden] { display: none } loses to the class rule above, which sets
   display: inline-flex. Without this the contextual group stays visible when outside a table.
   jsdom does not apply the cascade, so no unit test can catch this — only a real browser can. */

.kdoc-table-group[hidden] {
  display: none !important;
}

.kdoc-table-contextual-group[hidden] {
  display: none !important;
}

.kdoc-table-button[hidden] {
  display: none !important;
}

.kdoc-table-separator {
  display: none;
}

.kdoc-table-button {
  min-width: 28px;
  min-height: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.kdoc-table-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-table-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-table-button:active:not(:disabled),
.kdoc-table-button[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-table-button:disabled {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0.4;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-table-toolbar * {
    transition: none !important;
  }
}
`;

/**
 * Installs contextual GFM table toolbar controls into the specified container, wiring command execution and caret state synchronization.
 *
 * @purpose Constructs and mounts table insertion and contextual editing controls, wiring event listeners and table state synchronization.
 * @inputs options - TableToolbarOptions containing container DOM element, EditorView instance, and Document context.
 * @outputs TableToolbar - Controller exposing refresh and destroy lifecycle methods.
 * @dataflow Options -> toolbar DOM elements -> click event listeners -> ProseMirror commands & EditorView state -> refresh UI updates.
 * @controlflow Construct DOM elements for insert button and contextual group -> attach event listeners with AbortController -> perform initial refresh -> return TableToolbar instance.
 */
export function installTableToolbar(options: TableToolbarOptions): TableToolbar {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed = false;

  /**
   * Executes a ProseMirror command against the editor view, restoring focus and updating toolbar state.
   *
   * @purpose Runs a ProseMirror table editing command, ensures editor view retains DOM focus for edit-lock invariant, and triggers toolbar refresh.
   * @inputs command - The ProseMirror Command function to execute.
   * @outputs void.
   * @dataflow command -> options.view.dispatch(tr) -> options.view.focus() -> refresh().
   * @controlflow Execute command with current editor state and dispatch -> focus editor view -> invoke refresh to update toolbar button states.
   */
  function runCommand(command: Command): void {
    command(options.view.state, options.view.dispatch);
    options.view.focus();
    refresh();
  }

  /**
   * Constructs an accessible toolbar button element configured with standard attributes and styling.
   *
   * @purpose Creates and configures a button element with type, text, title, aria-label, and CSS classes.
   * @inputs
   *   - text: string - The visible button text content.
   *   - title: string - Tooltip title text including label and keyboard shortcut.
   *   - ariaLabel: string - Accessible label for screen readers.
   *   - extraClass: string | undefined - Optional extra CSS class name for specific button styling.
   * @outputs HTMLButtonElement - The configured button element ready for DOM attachment.
   * @dataflow Button specifications -> DOM HTMLButtonElement creation and attribute population.
   * @controlflow Create button element -> set type to 'button' -> assign textContent, title, and aria-label -> apply CSS class names -> return element.
   */
  function createButton(
    text: string,
    title: string,
    ariaLabel: string,
    extraClass?: string,
  ): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);

    // Check if an additional CSS class is specified.
    if (extraClass !== undefined) {
      // Append extra class name to default table button class.
      button.className = `kdoc-table-button ${extraClass}`;
    } else {
      // Use baseline table button class name.
      button.className = 'kdoc-table-button';
    }


    // Keep the caret where the user left it. Without this, mousedown moves DOM focus out of the
    // ProseMirror contentDOM, the browser collapses the selection, and the command then runs against
    // a caret sitting at position 0 — bold silently did nothing and an inserted table landed at the
    // top of the document. preventDefault on mousedown suppresses the focus change while still
    // firing click, so the button acts on the selection the user can actually see.
    button.addEventListener(
      'mousedown',
      (event: MouseEvent): void => {
        event.preventDefault();
      },
      { signal },
    );

    return button;
  }

  /**
   * Creates a semantic grouping container for toolbar controls with accessibility attributes.
   *
   * @purpose Creates a div element configured as an accessible role="group" container with an aria-label and optional extra class.
   * @inputs
   *   - ariaLabel: string - The descriptive label for the control group.
   *   - extraClass: string | undefined - Optional additional CSS class name for group styling.
   * @outputs HTMLElement - The configured container element.
   * @dataflow ariaLabel string -> DOM HTMLElement with group role and aria-label.
   * @controlflow Create div element -> assign CSS classes -> set role="group" and aria-label -> return element.
   */
  function createGroup(ariaLabel: string, extraClass?: string): HTMLElement {
    const group = doc.createElement('div');
    // Check if an additional CSS class is specified.
    if (extraClass !== undefined) {
      // Append extra class name to default table group class.
      group.className = `kdoc-table-group ${extraClass}`;
    } else {
      // Use baseline table group class name.
      group.className = 'kdoc-table-group';
    }
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ariaLabel);
    return group;
  }

  /**
   * Creates a visual and accessible separator element between toolbar control groups.
   *
   * @purpose Constructs a separator element with role="separator" and vertical orientation.
   * @inputs void.
   * @outputs HTMLElement - The configured separator element.
   * @dataflow DOM HTMLElement creation with separator role and vertical orientation.
   * @controlflow Create span element -> set CSS class -> assign role="separator" and aria-orientation="vertical" -> return element.
   */
  function createSeparator(): HTMLElement {
    const separator = doc.createElement('span');
    separator.className = 'kdoc-table-separator';
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-orientation', 'vertical');
    return separator;
  }

  /**
   * Toggles column alignment between target token and null when already active.
   *
   * @purpose Inspects current column alignment and either clears it to null or sets it to the target alignment.
   * @inputs targetAlign: 'left' | 'center' | 'right' - The target alignment to toggle.
   * @outputs void.
   * @dataflow options.view.state -> tableAt & tableAlign query -> setColumnAlign(null | targetAlign) command -> runCommand.
   * @controlflow Read table context -> if current column alignment matches target, dispatch setColumnAlign(null); else dispatch setColumnAlign(targetAlign).
   */
  function toggleAlign(targetAlign: 'left' | 'center' | 'right'): void {
    const ctx = tableAt(options.view.state);
    let current: ColumnAlign = null;
    // Check if caret sits inside an enclosing table.
    if (ctx !== null) {
      // Read current column alignment from table alignment vector.
      const aligns = tableAlign(ctx.table);
      current = aligns[ctx.cellIndex] ?? null;
    } else {
      // Not in table: alignment remains null.
    }

    // Check if the current column is already aligned to the target alignment.
    if (current === targetAlign) {
      // Already matches: clear alignment back to null for toggle behavior.
      runCommand(setColumnAlign(null));
    } else {
      // Does not match: set column alignment to target value.
      runCommand(setColumnAlign(targetAlign));
    }
  }

  // Ensure container carries base table toolbar layout styling.
  options.container.classList.add('kdoc-table-toolbar');

  // ---------------------------------------------------------------------------
  // 1. Always-visible Insert table button
  // ---------------------------------------------------------------------------
  const insertTableButton = createButton('⊞', 'Insert table (Ctrl+Alt+T)', 'Insert table');
  insertTableButton.addEventListener(
    'click',
    (): void => {
      runCommand(insertTable(3, 3));
    },
    { signal },
  );
  options.container.appendChild(insertTableButton);

  // ---------------------------------------------------------------------------
  // 2. Contextual group holding table modification controls
  // ---------------------------------------------------------------------------
  const contextualGroup = createGroup('Table controls', 'kdoc-table-contextual-group');

  // Row buttons
  const addRowBeforeButton = createButton('+R↑', 'Insert row above', 'Insert row above');
  addRowBeforeButton.addEventListener(
    'click',
    (): void => {
      runCommand(addRowBefore());
    },
    { signal },
  );
  contextualGroup.appendChild(addRowBeforeButton);

  const addRowAfterButton = createButton('+R↓', 'Insert row below', 'Insert row below');
  addRowAfterButton.addEventListener(
    'click',
    (): void => {
      runCommand(addRowAfter());
    },
    { signal },
  );
  contextualGroup.appendChild(addRowAfterButton);

  const deleteRowButton = createButton('-R', 'Delete row', 'Delete row');
  deleteRowButton.addEventListener(
    'click',
    (): void => {
      runCommand(deleteRow());
    },
    { signal },
  );
  contextualGroup.appendChild(deleteRowButton);

  const duplicateRowButton = createButton('⧉R', 'Duplicate row', 'Duplicate row');
  duplicateRowButton.addEventListener(
    'click',
    (): void => {
      runCommand(duplicateRow());
    },
    { signal },
  );
  contextualGroup.appendChild(duplicateRowButton);

  // Sorting reorders the body rows by the caret's column, detecting numbers, dates and text (FR-8.23).
  const sortAscendingButton = createButton('A→Z', 'Sort column ascending', 'Sort column ascending');
  sortAscendingButton.addEventListener(
    'click',
    (): void => {
      runCommand(sortTableByColumn('ascending'));
    },
    { signal },
  );
  contextualGroup.appendChild(sortAscendingButton);

  const sortDescendingButton = createButton('Z→A', 'Sort column descending', 'Sort column descending');
  sortDescendingButton.addEventListener(
    'click',
    (): void => {
      runCommand(sortTableByColumn('descending'));
    },
    { signal },
  );
  contextualGroup.appendChild(sortDescendingButton);

  const moveRowUpButton = createButton('R↑', 'Move row up', 'Move row up');
  moveRowUpButton.addEventListener(
    'click',
    (): void => {
      runCommand(moveRow(-1));
    },
    { signal },
  );
  contextualGroup.appendChild(moveRowUpButton);

  const moveRowDownButton = createButton('R↓', 'Move row down', 'Move row down');
  moveRowDownButton.addEventListener(
    'click',
    (): void => {
      runCommand(moveRow(1));
    },
    { signal },
  );
  contextualGroup.appendChild(moveRowDownButton);

  contextualGroup.appendChild(createSeparator());

  // Column buttons
  const addColumnBeforeButton = createButton('+C←', 'Insert column left', 'Insert column left');
  addColumnBeforeButton.addEventListener(
    'click',
    (): void => {
      runCommand(addColumnBefore());
    },
    { signal },
  );
  contextualGroup.appendChild(addColumnBeforeButton);

  const addColumnAfterButton = createButton('+C→', 'Insert column right', 'Insert column right');
  addColumnAfterButton.addEventListener(
    'click',
    (): void => {
      runCommand(addColumnAfter());
    },
    { signal },
  );
  contextualGroup.appendChild(addColumnAfterButton);

  const deleteColumnButton = createButton('-C', 'Delete column', 'Delete column');
  deleteColumnButton.addEventListener(
    'click',
    (): void => {
      runCommand(deleteColumn());
    },
    { signal },
  );
  contextualGroup.appendChild(deleteColumnButton);

  const duplicateColumnButton = createButton('⧉C', 'Duplicate column', 'Duplicate column');
  duplicateColumnButton.addEventListener(
    'click',
    (): void => {
      runCommand(duplicateColumn());
    },
    { signal },
  );
  contextualGroup.appendChild(duplicateColumnButton);

  const moveColumnLeftButton = createButton('C←', 'Move column left', 'Move column left');
  moveColumnLeftButton.addEventListener(
    'click',
    (): void => {
      runCommand(moveColumn(-1));
    },
    { signal },
  );
  contextualGroup.appendChild(moveColumnLeftButton);

  const moveColumnRightButton = createButton('C→', 'Move column right', 'Move column right');
  moveColumnRightButton.addEventListener(
    'click',
    (): void => {
      runCommand(moveColumn(1));
    },
    { signal },
  );
  contextualGroup.appendChild(moveColumnRightButton);

  contextualGroup.appendChild(createSeparator());

  // Alignment buttons
  const leftAlignButton = createButton('←', 'Align left', 'Align left');
  leftAlignButton.addEventListener(
    'click',
    (): void => {
      toggleAlign('left');
    },
    { signal },
  );
  contextualGroup.appendChild(leftAlignButton);

  const centerAlignButton = createButton('↔', 'Align center', 'Align center');
  centerAlignButton.addEventListener(
    'click',
    (): void => {
      toggleAlign('center');
    },
    { signal },
  );
  contextualGroup.appendChild(centerAlignButton);

  const rightAlignButton = createButton('→', 'Align right', 'Align right');
  rightAlignButton.addEventListener(
    'click',
    (): void => {
      toggleAlign('right');
    },
    { signal },
  );
  contextualGroup.appendChild(rightAlignButton);

  contextualGroup.appendChild(createSeparator());

  // Header row toggle (FR-8.25): pressed while the table shows a header. GFM needs a header row, so "off" is an empty one.
  const headerRowButton = createButton('H', 'Header row', 'Header row');
  headerRowButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleHeaderRow());
    },
    { signal },
  );
  contextualGroup.appendChild(headerRowButton);

  // Column width hint (FR-8.26): the host asks for the number, since a prompt is the host's to show.
  const onColumnWidth = options.onColumnWidth;
  // Check whether the host can ask for a width.
  if (onColumnWidth !== undefined) {
    const columnWidthButton = createButton('↔', 'Column width', 'Column width');
    columnWidthButton.addEventListener(
      'click',
      (): void => {
        onColumnWidth();
      },
      { signal },
    );
    contextualGroup.appendChild(columnWidthButton);
  } else {
    // No prompt available: no button.
  }

  // Delete table button
  const deleteTableButton = createButton('✕', 'Delete table', 'Delete table');
  deleteTableButton.addEventListener(
    'click',
    (): void => {
      runCommand(deleteTable());
    },
    { signal },
  );
  contextualGroup.appendChild(deleteTableButton);

  options.container.appendChild(contextualGroup);

  /**
   * Recomputes toolbar control states from the current ProseMirror editor state, updating disabled, aria-pressed, and hidden attributes.
   *
   * @purpose Synchronizes table toolbar controls with active caret position and table context.
   * @inputs void.
   * @outputs void.
   * @dataflow options.view.state -> isInTable, tableAt, tableAlign queries & dry-run command evaluations -> button attributes & contextual group hidden state.
   * @controlflow Check destroyed guard -> query isInTable to toggle contextual group visibility -> dry-run evaluate all commands to set disabled states -> query tableAlign to update aria-pressed on alignment toggle buttons.
   */
  function refresh(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: proceed with refreshing control states.
    }

    const state = options.view.state;

    // Check whether the current selection sits inside a GFM table.
    if (isInTable(state)) {
      // Selection is inside a table: reveal contextual table manipulation controls.
      contextualGroup.hidden = false;
    } else {
      // Selection is outside a table: hide contextual table manipulation controls.
      contextualGroup.hidden = true;
    }

    // Check if insertTable command can apply at the current selection.
    if (insertTable(3, 3)(state)) {
      // Command can apply: enable insert table button.
      insertTableButton.disabled = false;
    } else {
      // Command cannot apply (e.g. already inside table): disable button.
      insertTableButton.disabled = true;
    }

    // Check if addRowBefore command can apply.
    if (addRowBefore()(state)) {
      // Command can apply: enable button.
      addRowBeforeButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      addRowBeforeButton.disabled = true;
    }

    // Check if addRowAfter command can apply.
    if (addRowAfter()(state)) {
      // Command can apply: enable button.
      addRowAfterButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      addRowAfterButton.disabled = true;
    }

    // Check if deleteRow command can apply.
    if (deleteRow()(state)) {
      // Command can apply: enable button.
      deleteRowButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      deleteRowButton.disabled = true;
    }

    // Sorting is offered only when it would change the order.
    sortAscendingButton.disabled = !sortTableByColumn('ascending')(state);
    sortDescendingButton.disabled = !sortTableByColumn('descending')(state);
    headerRowButton.disabled = !toggleHeaderRow()(state);
    headerRowButton.setAttribute('aria-pressed', String(hasHeaderRow(state) === true));

    // Check if duplicateRow command can apply.
    if (duplicateRow()(state)) {
      // Command can apply: enable button.
      duplicateRowButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      duplicateRowButton.disabled = true;
    }

    // Check if moveRow up command can apply.
    if (moveRow(-1)(state)) {
      // Command can apply: enable button.
      moveRowUpButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      moveRowUpButton.disabled = true;
    }

    // Check if moveRow down command can apply.
    if (moveRow(1)(state)) {
      // Command can apply: enable button.
      moveRowDownButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      moveRowDownButton.disabled = true;
    }

    // Check if addColumnBefore command can apply.
    if (addColumnBefore()(state)) {
      // Command can apply: enable button.
      addColumnBeforeButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      addColumnBeforeButton.disabled = true;
    }

    // Check if addColumnAfter command can apply.
    if (addColumnAfter()(state)) {
      // Command can apply: enable button.
      addColumnAfterButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      addColumnAfterButton.disabled = true;
    }

    // Check if duplicateColumn command can apply.
    if (duplicateColumn()(state)) {
      // Command can apply: enable button.
      duplicateColumnButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      duplicateColumnButton.disabled = true;
    }

    // Check if moveColumn left command can apply.
    if (moveColumn(-1)(state)) {
      // Command can apply: enable button.
      moveColumnLeftButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      moveColumnLeftButton.disabled = true;
    }

    // Check if moveColumn right command can apply.
    if (moveColumn(1)(state)) {
      // Command can apply: enable button.
      moveColumnRightButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      moveColumnRightButton.disabled = true;
    }

    // Check if deleteColumn command can apply.
    if (deleteColumn()(state)) {
      // Command can apply: enable button.
      deleteColumnButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      deleteColumnButton.disabled = true;
    }

    // Check if setColumnAlign('left') command can apply.
    if (setColumnAlign('left')(state)) {
      // Command can apply: enable left alignment button.
      leftAlignButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      leftAlignButton.disabled = true;
    }

    // Check if setColumnAlign('center') command can apply.
    if (setColumnAlign('center')(state)) {
      // Command can apply: enable center alignment button.
      centerAlignButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      centerAlignButton.disabled = true;
    }

    // Check if setColumnAlign('right') command can apply.
    if (setColumnAlign('right')(state)) {
      // Command can apply: enable right alignment button.
      rightAlignButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      rightAlignButton.disabled = true;
    }

    // Check if deleteTable command can apply.
    if (deleteTable()(state)) {
      // Command can apply: enable delete table button.
      deleteTableButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      deleteTableButton.disabled = true;
    }

    const ctx = tableAt(state);
    let currentColAlign: ColumnAlign = null;
    // Check if current selection sits inside an enclosing table.
    if (ctx !== null) {
      // Extract column alignment for the current cell index.
      const aligns = tableAlign(ctx.table);
      currentColAlign = aligns[ctx.cellIndex] ?? null;
    } else {
      // Caret is not in a table: alignment is null.
    }

    // Check if left alignment is currently active.
    if (currentColAlign === 'left') {
      // Left alignment active: indicate pressed state.
      leftAlignButton.setAttribute('aria-pressed', 'true');
    } else {
      // Left alignment not active: indicate unpressed state.
      leftAlignButton.setAttribute('aria-pressed', 'false');
    }

    // Check if center alignment is currently active.
    if (currentColAlign === 'center') {
      // Center alignment active: indicate pressed state.
      centerAlignButton.setAttribute('aria-pressed', 'true');
    } else {
      // Center alignment not active: indicate unpressed state.
      centerAlignButton.setAttribute('aria-pressed', 'false');
    }

    // Check if right alignment is currently active.
    if (currentColAlign === 'right') {
      // Right alignment active: indicate pressed state.
      rightAlignButton.setAttribute('aria-pressed', 'true');
    } else {
      // Right alignment not active: indicate unpressed state.
      rightAlignButton.setAttribute('aria-pressed', 'false');
    }
  }

  /**
   * Cleans up toolbar resources, aborting event listeners and emptying the container element.
   *
   * @purpose Idempotently tears down toolbar event listeners and removes child elements from the container.
   * @inputs void.
   * @outputs void.
   * @dataflow Aborts AbortController listeners -> empties options.container children -> marks destroyed true.
   * @controlflow Check destroyed flag (return if true) -> set destroyed to true -> abort listener controller -> replace container children.
   */
  function destroy(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: proceed with destruction.
      destroyed = true;
    }

    abortController.abort();
    options.container.replaceChildren();
  }

  // Execute initial refresh to synchronize toolbar state with the editor view's current selection.
  refresh();

  return {
    refresh,
    destroy,
  };
}
