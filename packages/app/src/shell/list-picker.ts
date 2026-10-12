/**
 * @file list-picker.ts
 * @purpose Implements ListPicker, a Word-style multi-level list gallery for choosing list styles (FR-8.6).
 *   Renders an absolutely-positioned grid on doc.body without taking focus from the editor, maintaining selection and edit lock.
 * @inputs ListPickerOptions containing Document and Window context references, and an onPick callback for chosen list scheme and level.
 * @outputs ListPicker controller instance exposing openAt, close, isOpen, setCurrent, and destroy lifecycle methods, alongside LIST_PICKER_STYLES CSS definition.
 * @functions
 *   - installListPicker: Constructs the list picker grid, wires hover, click, and keyboard listeners, and returns the ListPicker controller.
 * @dataflow User hover/keyboard navigation -> highlightedScheme and highlightedLevel closure state -> update tile active classes and caption -> click/Enter -> onPick(scheme, level) -> close().
 * @controlflow Mount absolutely-positioned grid container with pre-built tiles to document body -> openAt positions, clamps, and highlights initial tile -> mouseenter, keydown, and outside-click manage selection and dismissal -> tile pick invokes onPick and closes.
 * @version 3
 * @date 2026-10-04
 */

/** Maximum nesting level for the list picker gallery. */
export const LIST_PICKER_LEVELS: number = 3;

/** Available list formatting schemes. */
export type ListPickerScheme = 'bullet' | 'ordered' | 'task';

/** Configuration options supplied to installListPicker. */
export interface ListPickerOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly onPick: (scheme: ListPickerScheme, level: number) => void;
}

/** Controller interface managing the lifecycle and visibility of the list picker. */
export interface ListPicker {
  /** Opens the list picker at the given viewport coordinates, clamped to fit on screen. */
  openAt(x: number, y: number): void;
  /** Closes the list picker and removes temporary outside-click listeners. */
  close(): void;
  /** True when the list picker is currently visible and not destroyed. */
  readonly isOpen: boolean;
  /** Marks the tile matching the caret's current list, or clears the mark when the caret is not in a list. */
  setCurrent(scheme: ListPickerScheme | null, level: number | null): void;
  /** Cleans up all DOM elements and listeners idempotently. */
  destroy(): void;
}

/**
 * Static stylesheet for the Word-style multi-level list picker gallery.
 */
export const LIST_PICKER_STYLES: string = `
.kdoc-list-picker {
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
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  user-select: none;
}

.kdoc-list-picker[hidden] {
  display: none;
}

.kdoc-list-picker-tile {
  width: 64px;
  height: 56px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  box-sizing: border-box;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  padding: 4px;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
}

.kdoc-list-picker-tile:hover,
.kdoc-list-picker-tile.kdoc-list-picker-tile-hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  border-color: var(--kdoc-chrome-accent);
  box-shadow: none;
}

.kdoc-list-picker-tile.kdoc-list-picker-tile-current {
  background: var(--kdoc-chrome-selected);
  border-color: var(--kdoc-chrome-accent);
  box-shadow: none;
  outline: none;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-list-picker-tile:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  box-shadow: none;
  transform: translateY(1px);
}

.kdoc-list-picker-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.kdoc-list-picker-marker {
  font-size: 10px;
  line-height: 1;
  width: 10px;
  text-align: center;
  color: var(--kdoc-chrome-text);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
}

.kdoc-list-picker-text {
  flex: 1;
  height: 2px;
  background: var(--kdoc-chrome-text-muted);
  opacity: 0.5;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-list-picker-caption {
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
  .kdoc-list-picker,
  .kdoc-list-picker-tile {
    transition: none;
  }
}
`;

/** Internal tracking record mapping each DOM tile element to its scheme and level. */
interface TileRecord {
  readonly scheme: ListPickerScheme;
  readonly level: number;
  readonly el: HTMLDivElement;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple list picker instances. */
let nextListPickerId: number = 0;

/** Ordered schemes for navigation. */
const SCHEMES: ListPickerScheme[] = ['bullet', 'ordered', 'task'];

/**
 * Maps a scheme to its visual marker glyph for the tile previews.
 * 
 * @purpose Returns the appropriate marker string based on scheme and row number.
 * @inputs scheme - The list scheme type.
 * @inputs rowNum - The 1-based row index within the tile preview.
 * @outputs string - The marker glyph to display.
 * @dataflow scheme & rowNum -> string marker.
 * @controlflow Inspect scheme to return the correct marker.
 */
function getMarker(scheme: ListPickerScheme, rowNum: number): string {
  // Check which scheme is requested to provide the correct marker.
  if (scheme === 'bullet') {
    // Bullet scheme: use a bullet point.
    return '•';
  } else if (scheme === 'ordered') {
    // Ordered scheme: use the row number followed by a dot.
    return `${rowNum}.`;
  } else {
    // Task scheme: use an empty checkbox.
    return '☐';
  }
}

/**
 * Maps a scheme to its user-friendly label for ARIA and caption text.
 * 
 * @purpose Returns the display label for a given scheme.
 * @inputs scheme - The list scheme type.
 * @outputs string - The capitalized display label.
 * @dataflow scheme -> string label.
 * @controlflow Inspect scheme to return the corresponding label.
 */
function getSchemeLabel(scheme: ListPickerScheme): string {
  // Check which scheme is requested to provide the label.
  if (scheme === 'bullet') {
    // Bullet scheme label.
    return 'Bullet';
  } else if (scheme === 'ordered') {
    // Ordered scheme label.
    return 'Numbered';
  } else {
    // Task scheme label.
    return 'Task';
  }
}

/**
 * Installs a Word-style multi-level list picker into the document body, configuring gallery tiles, hover behavior, and keyboard navigation.
 *
 * @purpose Constructs, styles, and mounts an absolutely-positioned list picker overlay for choosing list styles.
 * @inputs options - ListPickerOptions containing Document, Window DOM contexts, and onPick callback.
 * @outputs ListPicker - Controller exposing openAt, close, isOpen, setCurrent, and destroy lifecycle methods.
 * @dataflow options -> DOM grid hierarchy -> openAt -> mouse/keyboard navigation -> setHighlight -> onPick(scheme, level) -> close().
 * @controlflow Create container and 9 tiles once at construction -> append to doc.body -> bind mousedown preventDefault, tile mouseenter/click, and keyboard navigation -> return ListPicker controller.
 */
export function installListPicker(options: ListPickerOptions): ListPicker {
  const doc = options.doc;
  const win = options.win;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const pickerId = ++nextListPickerId;
  const pickerElementId = `kdoc-list-picker-${pickerId}`;

  let destroyed: boolean = false;
  let open: boolean = false;
  let highlightedScheme: ListPickerScheme | null = null;
  let highlightedLevel: number | null = null;
  let currentScheme: ListPickerScheme | null = null;
  let currentLevel: number | null = null;
  let openTimeoutId: ReturnType<typeof win.setTimeout> | null = null;

  // Construct container <div> element.
  const pickerEl = doc.createElement('div');
  pickerEl.id = pickerElementId;
  pickerEl.className = 'kdoc-list-picker';
  pickerEl.setAttribute('role', 'grid');
  pickerEl.setAttribute('aria-label', 'Multi-level list picker');
  pickerEl.hidden = true;

  // Prevent default on mousedown.
  pickerEl.addEventListener(
    'mousedown',
    (event: MouseEvent): void => {
      event.preventDefault();
    },
    { signal },
  );

  const tiles: TileRecord[] = [];

  // Build 9 cell <div>s once at construction (3 schemes x 3 levels).
  for (let sIdx = 0; sIdx < SCHEMES.length; sIdx++) {
    const schemeItem = SCHEMES[sIdx];
    // Check if scheme item is defined.
    if (schemeItem === undefined) {
      // Skip undefined scheme.
      continue;
    } else {
      // Valid scheme: process it.
    }
    const scheme = schemeItem;
    
    for (let level = 1; level <= LIST_PICKER_LEVELS; level++) {
      const tileEl = doc.createElement('div');
      tileEl.id = `kdoc-list-picker-tile-${pickerId}-${scheme}-${level}`;
      tileEl.className = 'kdoc-list-picker-tile';
      tileEl.setAttribute('role', 'gridcell');
      tileEl.setAttribute('tabindex', '-1');
      const schemeLabel = getSchemeLabel(scheme);
      tileEl.setAttribute('aria-label', `${schemeLabel} list, level ${level}`);

      // Create 3 rows inside each tile to preview the indentation.
      for (let row = 1; row <= 3; row++) {
        const rowEl = doc.createElement('div');
        rowEl.className = 'kdoc-list-picker-row';
        
        let indentSteps = 0;
        // Check if the current row index meets or exceeds the tile's target nesting level.
        if (row >= level) {
          // Row is at or beyond the target level: it gets indented.
          indentSteps = level - 1;
        } else {
          // Row is before the target level: less indent.
          indentSteps = row - 1;
        }
        
        rowEl.style.paddingLeft = `${indentSteps * 10}px`;

        const markerEl = doc.createElement('span');
        markerEl.className = 'kdoc-list-picker-marker';
        markerEl.textContent = getMarker(scheme, row);
        
        const textEl = doc.createElement('span');
        textEl.className = 'kdoc-list-picker-text';

        rowEl.appendChild(markerEl);
        rowEl.appendChild(textEl);
        tileEl.appendChild(rowEl);
      }

      tileEl.addEventListener(
        'mouseenter',
        (): void => {
          // Check if component has been destroyed or picker is not open.
          if (destroyed || !open) {
            // Component destroyed or picker closed: ignore hover.
            return;
          } else {
            // Active and open: highlight the hovered tile and update caption.
            setHighlight(scheme, level);
          }
        },
        { signal },
      );

      tileEl.addEventListener(
        'click',
        (): void => {
          // Check if component has been destroyed or picker is not open.
          if (destroyed || !open) {
            // Component destroyed or picker closed: ignore click.
            return;
          } else {
            // Valid pick: invoke callback with scheme and level then close.
            options.onPick(scheme, level);
            close();
          }
        },
        { signal },
      );

      pickerEl.appendChild(tileEl);
      tiles.push({ scheme, level, el: tileEl });
    }
  }

  // Caption element showing selected tile's label.
  const captionEl = doc.createElement('div');
  captionEl.id = `kdoc-list-picker-caption-${pickerId}`;
  captionEl.className = 'kdoc-list-picker-caption';
  captionEl.textContent = 'Select list style';
  pickerEl.appendChild(captionEl);

  doc.body.appendChild(pickerEl);

  /**
   * Updates the visual hover highlight across all gallery tiles and synchronizes the caption text.
   *
   * @purpose Highlights a specific tile and updates the caption label.
   * @inputs targetScheme - The list scheme to highlight, or null to clear.
   * @inputs targetLevel - The level to highlight, or null to clear.
   * @outputs void.
   * @dataflow targetScheme & targetLevel -> highlightedScheme/highlightedLevel -> toggle kdoc-list-picker-tile-hover -> update captionEl.textContent.
   * @controlflow Store scheme/level in closure state -> iterate tiles -> toggle hover class -> update caption text.
   */
  function setHighlight(targetScheme: ListPickerScheme | null, targetLevel: number | null): void {
    highlightedScheme = targetScheme;
    highlightedLevel = targetLevel;

    for (let i = 0; i < tiles.length; i++) {
      const item = tiles[i];
      // Check if item exists under strict indexing.
      if (item === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid tile record: check if it matches target scheme and level.
      }

      // Check if tile matches the highlight target.
      if (item.scheme === highlightedScheme && item.level === highlightedLevel) {
        // Tile matches target: mark as hovered.
        item.el.classList.add('kdoc-list-picker-tile-hover');
      } else {
        // Tile does not match: clear hover mark.
        item.el.classList.remove('kdoc-list-picker-tile-hover');
      }
    }

    // Check if valid scheme and level are highlighted.
    if (highlightedScheme !== null && highlightedLevel !== null) {
      // Tile highlighted: format caption.
      const schemeLabel = getSchemeLabel(highlightedScheme);
      captionEl.textContent = `${schemeLabel} list, level ${highlightedLevel}`;
    } else {
      // No tile highlighted: restore default prompt.
      captionEl.textContent = 'Select list style';
    }
  }

  /**
   * Marks the tile matching the caret's current list, or clears the mark when the caret is not in a list.
   *
   * @purpose Toggles class kdoc-list-picker-tile-current and aria-current on the matching tile.
   * @inputs scheme - The current list scheme, or null if not in a list.
   * @inputs level - The current list level, or null.
   * @outputs void.
   * @dataflow scheme & level -> currentScheme/currentLevel -> iterate tiles and apply/remove current styling.
   * @controlflow Iterate all tiles -> if tile matches scheme and level, add current class and aria attribute; else remove them.
   */
  function setCurrent(scheme: ListPickerScheme | null, level: number | null): void {
    currentScheme = scheme;
    currentLevel = level;

    // Check if scheme or level is null.
    if (scheme === null || level === null) {
      // Clear current state from all tiles.
      for (let i = 0; i < tiles.length; i++) {
        const item = tiles[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid tile record.
        }
        item.el.classList.remove('kdoc-list-picker-tile-current');
        item.el.removeAttribute('aria-current');
      }
    } else {
      // Specific scheme and level provided: apply to matching tile.
      for (let i = 0; i < tiles.length; i++) {
        const item = tiles[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid tile record.
        }

        // Check if tile matches current scheme and level.
        if (item.scheme === scheme && item.level === level) {
          // Match: apply current state styling.
          item.el.classList.add('kdoc-list-picker-tile-current');
          item.el.setAttribute('aria-current', 'true');
        } else {
          // Mismatch: clear current state styling.
          item.el.classList.remove('kdoc-list-picker-tile-current');
          item.el.removeAttribute('aria-current');
        }
      }
    }
  }

  /**
   * Keyboard event listener managing gallery highlight navigation, list picking, and dismissal.
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

    // Check whether a tile is highlighted, to know which one the arrow keys move from.
    let currentSIdx = 0;
    let currentLvl = 1;
    if (highlightedScheme === null || highlightedLevel === null) {
      // Nothing highlighted yet: the arrows start from the first tile.
    } else {
      // A tile is highlighted: move relative to it.
      currentSIdx = SCHEMES.indexOf(highlightedScheme);
      currentLvl = highlightedLevel;
    }

    // Check if the pressed key is ArrowUp.
    if (event.key === 'ArrowUp') {
      // Move highlight up to the previous scheme.
      event.preventDefault();
      const nextSIdx = Math.max(0, currentSIdx - 1);
      const nextScheme = SCHEMES[nextSIdx];
      // Check if nextScheme is defined.
      if (nextScheme === undefined) {
        // Fallback for undefined scheme.
      } else {
        setHighlight(nextScheme, currentLvl);
      }
    } else if (event.key === 'ArrowDown') {
      // Check if the pressed key is ArrowDown.
      // Move highlight down to the next scheme.
      event.preventDefault();
      const nextSIdx = Math.min(SCHEMES.length - 1, currentSIdx + 1);
      const nextScheme = SCHEMES[nextSIdx];
      // Check if nextScheme is defined.
      if (nextScheme === undefined) {
        // Fallback for undefined scheme.
      } else {
        setHighlight(nextScheme, currentLvl);
      }
    } else if (event.key === 'ArrowLeft') {
      // Check if the pressed key is ArrowLeft.
      // Move highlight left to the previous level.
      event.preventDefault();
      const nextLvl = Math.max(1, currentLvl - 1);
      const scheme = SCHEMES[currentSIdx];
      // Check if scheme is defined.
      if (scheme === undefined) {
        // Fallback for undefined scheme.
      } else {
        setHighlight(scheme, nextLvl);
      }
    } else if (event.key === 'ArrowRight') {
      // Check if the pressed key is ArrowRight.
      // Move highlight right to the next level.
      event.preventDefault();
      const nextLvl = Math.min(LIST_PICKER_LEVELS, currentLvl + 1);
      const scheme = SCHEMES[currentSIdx];
      // Check if scheme is defined.
      if (scheme === undefined) {
        // Fallback for undefined scheme.
      } else {
        setHighlight(scheme, nextLvl);
      }
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if a valid tile is currently highlighted.
      if (highlightedScheme !== null && highlightedLevel !== null) {
        options.onPick(highlightedScheme, highlightedLevel);
        close();
      } else {
        // No tile highlighted: do nothing.
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
   * Outside-click event listener closing the list picker when the user clicks anywhere outside the container.
   *
   * @purpose Detects outside clicks and dismisses the open list picker.
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
      // Click occurred outside list picker container: dismiss picker.
      close();
    } else {
      // Click occurred inside container: allow tile click listeners to handle.
    }
  }

  /**
   * Opens the list picker at the specified viewport coordinates, clamping the position to remain within the screen.
   *
   * @purpose Displays picker, sets initial highlight, clamps coordinates against window boundaries, and attaches outside-click dismissal.
   * @inputs x - Viewport horizontal coordinate in pixels.
   * @inputs y - Viewport vertical coordinate in pixels.
   * @outputs void.
   * @dataflow (x, y) -> display -> highlight initial tile -> measure & clamp against win dimensions -> apply left/top styles -> schedule outside click.
   * @controlflow Check destroyed guard -> unhide element -> highlight current or bullet level 1 -> measure offsetWidth/offsetHeight -> clamp to win.innerWidth/innerHeight -> set left and top -> schedule outside-click listener.
   */
  function openAt(x: number, y: number): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    pickerEl.hidden = false;
    open = true;

    // Check if a current scheme and level are set.
    if (currentScheme !== null && currentLevel !== null) {
      // Highlight the currently set tile.
      setHighlight(currentScheme, currentLevel);
    } else {
      // No current tile set: default highlight to bullet level 1.
      setHighlight('bullet', 1);
    }

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
   * Closes the list picker, resets selection highlight, and removes outside-click event listeners.
   *
   * @purpose Hides the list picker element, resets hover highlight, and detaches outside-click listeners in an idempotent manner.
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

    doc.removeEventListener('click', onDocClick);

    // Check if picker is currently open.
    if (open) {
      open = false;
      pickerEl.hidden = true;
      setHighlight(null, null);
    } else {
      // Picker already closed.
    }
  }

  /**
   * Tears down the list picker component, aborting listeners and removing DOM nodes.
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

  pickerEl.addEventListener('keydown', onKeyDown, { signal });
  doc.addEventListener('keydown', onKeyDown, { signal });

  return {
    openAt,
    close,
    /**
     * @purpose Returns boolean indicating whether the list picker is currently open.
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
        // Return live open status of the list picker.
        return open;
      }
    },
    setCurrent,
    destroy,
  };
}
