/**
 * @file size-picker.ts
 * @purpose Implements SizePicker, a Word-style hover matrix for choosing table dimensions (FR-8.18).
 *   Renders an absolutely-positioned grid on doc.body without taking focus from the editor, maintaining selection and edit lock.
 * @inputs SizePickerOptions containing Document and Window context references, and an onPick callback for chosen row/column dimensions.
 * @outputs SizePicker controller instance exposing openAt, close, isOpen, and destroy lifecycle methods, alongside SIZE_PICKER_STYLES CSS definition.
 * @functions
 *   - installSizePicker: Constructs the size picker grid, wires hover, click, and keyboard listeners, and returns the SizePicker controller.
 * @dataflow User hover/keyboard navigation -> hoveredRow and hoveredCol closure state -> update cell active classes and caption -> click/Enter -> onPick(rows, columns) -> close().
 * @controlflow Mount absolutely-positioned grid container with pre-built cells to document body -> openAt positions, clamps, and highlights 1x1 -> mouseenter, keydown, and outside-click manage selection and dismissal -> cell pick invokes onPick and closes.
 * @version 3
 * @date 2026-10-04
 */

/** Maximum number of selectable table rows in the size picker matrix. */
export const MAX_PICKER_ROWS: number = 8;

/** Maximum number of selectable table columns in the size picker matrix. */
export const MAX_PICKER_COLUMNS: number = 10;

/** Configuration options supplied to installSizePicker. */
export interface SizePickerOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly onPick: (rows: number, columns: number) => void;
}

/** Controller interface managing the lifecycle and visibility of the size picker. */
export interface SizePicker {
  /** Opens the size picker at the given viewport coordinates, clamped to fit on screen. */
  openAt(x: number, y: number): void;
  /** Closes the size picker and removes temporary outside-click listeners. */
  close(): void;
  /** True when the size picker is currently visible and not destroyed. */
  readonly isOpen: boolean;
  /** Cleans up all DOM elements and listeners idempotently. */
  destroy(): void;
}

/**
 * Static stylesheet for the Word-style table size picker grid, styling the container,
 * bordered square cells, active state in the accent colour, centered caption label,
 * and hidden state using authoritative K-Doc design tokens.
 */
export const SIZE_PICKER_STYLES: string = `
.kdoc-size-picker {
  position: absolute;
  z-index: 1000;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 8px;
  box-sizing: border-box;
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  display: grid;
  grid-template-columns: repeat(var(--kdoc-picker-cols), 1fr);
  gap: 3px;
  user-select: none;
}

.kdoc-size-picker[hidden] {
  display: none;
}

.kdoc-size-picker-cell {
  width: 18px;
  height: 18px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.kdoc-size-picker-cell.kdoc-size-picker-cell-active {
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
}

.kdoc-size-picker-label {
  grid-column: 1 / -1;
  text-align: center;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  padding-top: 6px;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-size-picker,
  .kdoc-size-picker-cell {
    transition: none;
  }
}
`;

/** Internal tracking record mapping each DOM cell element to its 1-based row and column coordinates. */
interface CellRecord {
  readonly row: number;
  readonly col: number;
  readonly el: HTMLDivElement;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple size picker instances. */
let nextSizePickerId: number = 0;

/**
 * Installs a Word-style table size picker into the document body, configuring grid cells, hover matrix, and keyboard navigation.
 *
 * @purpose Constructs, styles, and mounts an absolutely-positioned table size picker overlay for choosing table dimensions.
 * @inputs options - SizePickerOptions containing Document, Window DOM contexts, and onPick callback.
 * @outputs SizePicker - Controller exposing openAt, close, isOpen, and destroy lifecycle methods.
 * @dataflow options -> DOM grid hierarchy -> openAt -> mouse/keyboard navigation -> setHighlight -> onPick(rows, columns) -> close().
 * @controlflow Create container and 80 cells once at construction -> append to doc.body -> bind mousedown preventDefault, cell mouseenter/click, and keyboard navigation -> return SizePicker controller.
 */
export function installSizePicker(options: SizePickerOptions): SizePicker {
  const doc = options.doc;
  const win = options.win;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const pickerId = ++nextSizePickerId;
  const pickerElementId = `kdoc-size-picker-${pickerId}`;

  let destroyed: boolean = false;
  let open: boolean = false;
  let hoveredRow: number = 0;
  let hoveredCol: number = 0;
  let openTimeoutId: ReturnType<typeof win.setTimeout> | null = null;

  // Construct container <div> element.
  // The size picker is constructed as an absolutely-positioned <div> appended to doc.body rather than a <dialog>.
  // Like popup-menu.ts, it must not take focus from the editor because the table command must insert at the current selection.
  const pickerEl = doc.createElement('div');
  pickerEl.id = pickerElementId;
  pickerEl.className = 'kdoc-size-picker';
  pickerEl.setAttribute('role', 'grid');
  pickerEl.setAttribute('aria-label', 'Table size picker');
  pickerEl.hidden = true;

  // Prevent default on mousedown.
  // Without it, clicking the picker moves focus out of the editor pane and collapses the selection,
  // so the table would be inserted at the wrong position — the same defect the format toolbar had.
  pickerEl.addEventListener(
    'mousedown',
    (event: MouseEvent): void => {
      event.preventDefault();
    },
    { signal },
  );

  const cells: CellRecord[] = [];

  // Build MAX_PICKER_ROWS * MAX_PICKER_COLUMNS cell <div>s once at construction.
  // Rebuilding 80 elements per open is work with no purpose, since the grid never changes size.
  for (let r = 1; r <= MAX_PICKER_ROWS; r++) {
    for (let c = 1; c <= MAX_PICKER_COLUMNS; c++) {
      const cellEl = doc.createElement('div');
      cellEl.id = `kdoc-size-picker-cell-${pickerId}-${r}-${c}`;
      cellEl.className = 'kdoc-size-picker-cell';
      cellEl.setAttribute('role', 'gridcell');
      cellEl.setAttribute('aria-label', `${r} rows by ${c} columns`);

      // Hovering a cell adds kdoc-size-picker-cell-active to every cell up to and including it, and updates the caption.
      cellEl.addEventListener(
        'mouseenter',
        (): void => {
          // Check if component has been destroyed or picker is not open.
          if (destroyed || !open) {
            // Component destroyed or picker closed: ignore hover.
            return;
          } else {
            // Active and open: highlight up to hovered cell and update caption.
            setHighlight(r, c);
          }
        },
        { signal },
      );

      // Clicking a cell calls onPick(rows, columns) then closes. Rows and columns are 1-based.
      cellEl.addEventListener(
        'click',
        (): void => {
          // Check if component has been destroyed or picker is not open.
          if (destroyed || !open) {
            // Component destroyed or picker closed: ignore click.
            return;
          } else {
            // Valid pick: invoke callback with 1-based dimensions then close.
            options.onPick(r, c);
            close();
          }
        },
        { signal },
      );

      pickerEl.appendChild(cellEl);
      cells.push({ row: r, col: c, el: cellEl });
    }
  }

  // Caption element showing selected table size, or "Select size" before any hover.
  const labelEl = doc.createElement('div');
  labelEl.id = `kdoc-size-picker-label-${pickerId}`;
  labelEl.className = 'kdoc-size-picker-label';
  labelEl.textContent = 'Select size';
  pickerEl.appendChild(labelEl);

  // Mount size picker element to document body.
  doc.body.appendChild(pickerEl);

  /**
   * Updates the visual highlight across all grid cells and synchronizes the caption text.
   *
   * @purpose Activates all cells up to targetRow and targetCol and updates caption with dimensions.
   * @inputs targetRow - 1-based row limit to highlight, or 0 to clear highlight.
   * @inputs targetCol - 1-based column limit to highlight, or 0 to clear highlight.
   * @outputs void.
   * @dataflow targetRow & targetCol -> hoveredRow/hoveredCol -> toggle kdoc-size-picker-cell-active on cells -> update labelEl.textContent.
   * @controlflow Store row/col in closure state -> iterate cells -> toggle active class -> update labelEl text.
   */
  function setHighlight(targetRow: number, targetCol: number): void {
    hoveredRow = targetRow;
    hoveredCol = targetCol;

    for (let i = 0; i < cells.length; i++) {
      const item = cells[i];
      // Check if item exists under strict indexing.
      if (item === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid cell record: check coordinates against target dimensions.
      }

      // Check if cell falls within active selection matrix rectangle.
      if (item.row <= hoveredRow && item.col <= hoveredCol) {
        // Cell within matrix: mark active.
        item.el.classList.add('kdoc-size-picker-cell-active');
      } else {
        // Cell outside matrix: mark inactive.
        item.el.classList.remove('kdoc-size-picker-cell-active');
      }
    }

    // Check if valid dimensions are currently highlighted.
    if (hoveredRow > 0 && hoveredCol > 0) {
      // Dimensions active: format caption as row × col table.
      labelEl.textContent = `${hoveredRow} × ${hoveredCol} table`;
    } else {
      // No dimensions active: restore default prompt label.
      labelEl.textContent = 'Select size';
    }
  }

  /**
   * Keyboard event listener managing grid highlight navigation, dimension picking, and dismissal.
   *
   * @purpose Intercepts arrow keys, Enter, and Escape when picker is open, navigating or confirming selection.
   * @inputs event - KeyboardEvent captured on document or container.
   * @outputs void.
   * @dataflow event.key -> arrow moves -> setHighlight() | Enter -> onPick() & close() | Escape -> close().
   * @controlflow Check destroyed and open guards -> inspect event.key -> route ArrowUp/Down/Left/Right to setHighlight -> route Enter to onPick and close -> route Escape to close.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has been destroyed or picker is not open.
    if (destroyed || !open) {
      // Component destroyed or picker closed: ignore keyboard event.
      return;
    } else {
      // Picker is open: inspect event.
    }

    // Check if default has already been prevented by a preceding listener.
    if (event.defaultPrevented) {
      // Already handled: skip.
      return;
    } else {
      // Not yet handled: process key.
    }

    // Check if the pressed key is ArrowUp.
    if (event.key === 'ArrowUp') {
      // Move highlight up by one row, clamping at row 1.
      event.preventDefault();
      const nextRow = Math.max(1, (hoveredRow > 0 ? hoveredRow : 1) - 1);
      const nextCol = hoveredCol > 0 ? hoveredCol : 1;
      setHighlight(nextRow, nextCol);
    } else if (event.key === 'ArrowDown') {
      // Check if the pressed key is ArrowDown.
      // Move highlight down by one row, clamping at MAX_PICKER_ROWS.
      event.preventDefault();
      const nextRow = Math.min(MAX_PICKER_ROWS, (hoveredRow > 0 ? hoveredRow : 1) + 1);
      const nextCol = hoveredCol > 0 ? hoveredCol : 1;
      setHighlight(nextRow, nextCol);
    } else if (event.key === 'ArrowLeft') {
      // Check if the pressed key is ArrowLeft.
      // Move highlight left by one column, clamping at column 1.
      event.preventDefault();
      const nextRow = hoveredRow > 0 ? hoveredRow : 1;
      const nextCol = Math.max(1, (hoveredCol > 0 ? hoveredCol : 1) - 1);
      setHighlight(nextRow, nextCol);
    } else if (event.key === 'ArrowRight') {
      // Check if the pressed key is ArrowRight.
      // Move highlight right by one column, clamping at MAX_PICKER_COLUMNS.
      event.preventDefault();
      const nextRow = hoveredRow > 0 ? hoveredRow : 1;
      const nextCol = Math.min(MAX_PICKER_COLUMNS, (hoveredCol > 0 ? hoveredCol : 1) + 1);
      setHighlight(nextRow, nextCol);
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if valid dimensions are currently highlighted.
      if (hoveredRow > 0 && hoveredCol > 0) {
        const pickedRows = hoveredRow;
        const pickedCols = hoveredCol;
        options.onPick(pickedRows, pickedCols);
        close();
      } else {
        // No dimensions selected: do nothing.
      }
    } else if (event.key === 'Escape') {
      // Check if the pressed key is Escape.
      event.preventDefault();
      close();
    } else {
      // Other keys: allow standard handling.
    }
  }

  /**
   * Outside-click event listener closing the size picker when the user clicks anywhere outside the container.
   *
   * @purpose Detects outside clicks and dismisses the open size picker.
   * @inputs event - MouseEvent captured on document.
   * @outputs void.
   * @dataflow event.target -> container contains check -> close().
   * @controlflow Check destroyed and open guards -> inspect event.target -> if target outside pickerEl, close picker.
   */
  function onDocClick(event: MouseEvent): void {
    // Check if component has been destroyed or picker is not currently open.
    if (destroyed || !open) {
      // Component destroyed or picker closed: ignore click.
      return;
    } else {
      // Picker is open: inspect click target.
    }

    // Check if click target is outside the picker container element.
    if (event.target instanceof Node && !pickerEl.contains(event.target)) {
      // Click occurred outside size picker container: dismiss picker.
      close();
    } else {
      // Click occurred inside container: allow cell click listeners to handle.
    }
  }

  /**
   * Opens the size picker at the specified viewport coordinates, clamping the position to remain within the screen.
   *
   * @purpose Sets grid column property inline, displays picker, highlights 1×1 for keyboard starting point, clamps coordinates against window boundaries, and attaches outside-click dismissal.
   * @inputs x - Viewport horizontal coordinate in pixels.
   * @inputs y - Viewport vertical coordinate in pixels.
   * @outputs void.
   * @dataflow (x, y) -> set inline CSS property -> display -> measure & clamp against win dimensions -> apply left/top styles -> schedule outside click.
   * @controlflow Check destroyed guard -> set --kdoc-picker-cols -> unhide element -> highlight 1×1 -> measure offsetWidth/offsetHeight -> clamp to win.innerWidth/innerHeight -> set left and top -> schedule outside-click listener.
   */
  function openAt(x: number, y: number): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    // Set the custom property inline in openAt.
    pickerEl.style.setProperty('--kdoc-picker-cols', String(MAX_PICKER_COLUMNS));

    // Make the element visible to enable layout and measurement.
    pickerEl.hidden = false;
    open = true;

    // Keyboard: open highlights 1×1 so the keyboard has a starting point.
    // A hover-only picker is unusable from the keyboard, which NFR-4 does not allow.
    setHighlight(1, 1);

    // Positions at the viewport coordinates clamped to stay on screen using win.innerWidth / win.innerHeight
    // and the element's own measured size, the same way the popup menu does.
    // A picker opening off the right edge is unreachable.
    const pickerWidth = pickerEl.offsetWidth;
    const pickerHeight = pickerEl.offsetHeight;
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;

    let clampedX = x;
    let clampedY = y;

    // Check if the picker would extend past the right boundary of the viewport.
    if (clampedX + pickerWidth > viewportWidth) {
      // Shift picker back horizontally so it fits within the viewport.
      clampedX = viewportWidth - pickerWidth;
    } else {
      // Picker fits horizontally.
    }

    // Check if horizontal shift produced a negative coordinate.
    if (clampedX < 0) {
      // Clamp negative coordinate to zero to keep picker on screen.
      clampedX = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    // Check if the picker would extend past the bottom boundary of the viewport.
    if (clampedY + pickerHeight > viewportHeight) {
      // Shift picker back vertically so it fits within the viewport.
      clampedY = viewportHeight - pickerHeight;
    } else {
      // Picker fits vertically.
    }

    // Check if vertical shift produced a negative coordinate.
    if (clampedY < 0) {
      // Clamp negative coordinate to zero to keep picker on screen.
      clampedY = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    pickerEl.style.left = `${clampedX}px`;
    pickerEl.style.top = `${clampedY}px`;

    // Clear any previously pending outside-click registration timeout.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending timeout.
    }

    // The outside-click listener is attached on open and removed on close, not bound for the life of the app.
    // A zero-delay timeout prevents the click event that opened the picker from immediately dismissing it.
    openTimeoutId = win.setTimeout((): void => {
      openTimeoutId = null;
      // Check if component has been destroyed or picker was closed before timeout expired.
      if (destroyed || !open) {
        // Component destroyed or picker closed: do not attach listener.
        return;
      } else {
        // Picker still open: attach outside-click dismiss listener to document.
        doc.addEventListener('click', onDocClick, { signal });
      }
    }, 0);
  }

  /**
   * Closes the size picker, resets selection highlight, and removes outside-click event listeners.
   *
   * @purpose Hides the size picker element, resets active highlight, and detaches outside-click listeners in an idempotent manner.
   * @inputs void.
   * @outputs void.
   * @dataflow open = false -> pickerEl.hidden = true -> cleanup listeners.
   * @controlflow Check destroyed guard -> if open, set open to false, hide element, clear timeouts, and remove doc click listener.
   */
  function close(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort close.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    // Check if any open timeout is pending.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending open timeout.
    }

    // Remove outside-click listener on close so it is not bound for the life of the app.
    doc.removeEventListener('click', onDocClick);

    // Check if picker is currently open.
    if (open) {
      open = false;
      pickerEl.hidden = true;
      setHighlight(0, 0);
    } else {
      // Picker already closed.
    }
  }

  /**
   * Tears down the size picker component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes the picker, and removes the picker element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> pickerEl.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> abort controller -> close picker -> remove picker element from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    close();
    pickerEl.remove();
  }

  // Bind keyboard navigation on the picker element AND on the document.
  // Focus stays in the editor so commands can act on the current selection;
  // this is the cost of not taking focus, and the reason keys are handled on doc rather than relying on the element being focused.
  pickerEl.addEventListener('keydown', onKeyDown, { signal });
  doc.addEventListener('keydown', onKeyDown, { signal });

  return {
    openAt,
    close,
    /**
     * @purpose Returns boolean indicating whether the size picker is currently open.
     * @inputs void.
     * @outputs boolean - True if the picker is open and component is not destroyed; false otherwise.
     * @dataflow open -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed; otherwise return open flag.
     */
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else {
        // Return live open status of the size picker.
        return open;
      }
    },
    destroy,
  };
}
