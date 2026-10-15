/**
 * @file split-divider.ts
 * @purpose Implements SplitDivider, an accessible draggable divider that resizes the dual editor panes (K-Doc and Source) in split view for K-Doc.
 *   Resizing updates pane flex proportions rather than fixed pixel widths to preserve window responsiveness, while pointer capture prevents drag-sticking on fast cursor movements.
 *   Includes full keyboard accessibility via arrow keys and ARIA separator attributes per WCAG 2.2 guidelines.
 * @inputs SplitDividerOptions containing divider HTMLElement, Document context, first pane HTMLElement, second pane HTMLElement, and container HTMLElement.
 * @outputs SplitDivider controller interface exposing ratio, setRatio, reset, and destroy lifecycle methods, alongside SPLIT_DIVIDER_STYLES CSS stylesheet definition.
 * @functions
 *   - installSplitDivider: Instantiates and mounts draggable split divider controls, binds pointer and keyboard listeners, coordinates pane resizing, and returns the SplitDivider controller.
 *   - setRatio: Clamps the target split ratio within safe bounds and applies proportional flex styles to both panes.
 *   - reset: Restores the even 50/50 split ratio between both editor panes.
 *   - endDrag: Concludes an active pointer drag session, releasing pointer capture and container drag styles.
 *   - destroy: Tears down all event listeners via AbortController, clears inline flex styles, and removes drag styling.
 * @dataflow Pointer / keyboard events -> compute ratio -> clamp to [MIN_RATIO, MAX_RATIO] -> update first/second pane style.flex & aria-valuenow.
 * @controlflow Configure divider accessibility attributes -> attach pointer, keyboard, and double-click listeners with AbortController -> apply initial 50/50 ratio -> return SplitDivider controller.
 * @version 5
 * @date 2026-10-15
 */

/**
 * Which way the divider runs, named as the editor.splitOrientation setting names it: 'vertical' is a vertical bar
 * between panes side by side (dragged left and right), 'horizontal' a horizontal bar between stacked panes (dragged
 * up and down). This is also the divider's aria-orientation.
 */
export type DividerOrientation = 'vertical' | 'horizontal';

export interface SplitDividerOptions {
  readonly element: HTMLElement;
  readonly doc: Document;
  /** The pane before the divider: on the left, or on top when stacked. */
  readonly first: HTMLElement;
  /** The pane after the divider: on the right, or below when stacked. */
  readonly second: HTMLElement;
  /** The flex box containing both panes and the divider. */
  readonly container: HTMLElement;
  /** Defaults to 'vertical' (panes side by side). */
  readonly orientation?: DividerOrientation;
}

export interface SplitDivider {
  /** The first pane's share of the container, 0..1. */
  readonly ratio: number;
  /** Which way the divider runs. */
  readonly orientation: DividerOrientation;
  setRatio(ratio: number): void;
  /** Restore the even 50/50 split. */
  reset(): void;
  /** Switch between side-by-side and stacked panes, keeping the ratio. */
  setOrientation(orientation: DividerOrientation): void;
  destroy(): void;
}

/**
 * Minimum ratio for the first pane (15%).
 * A pane dragged to zero width cannot be dragged back, because there is nothing left to grab.
 */
const MIN_RATIO: number = 0.15;

/**
 * Maximum ratio for the first pane (85%).
 * Symmetrically prevents the second pane from collapsing to zero width, leaving nothing to grab.
 */
const MAX_RATIO: number = 0.85;

/**
 * Default ratio allocating an equal 50/50 split between both editor panes.
 */
const DEFAULT_RATIO: number = 0.5;

/**
 * Ratio delta per left or right arrow keystroke (2% of container width).
 */
const KEYBOARD_STEP: number = 0.02;

/**
 * Multiplier used to convert decimal ratio values into integer percentages for ARIA value attributes.
 */
const PERCENT_MULTIPLIER: number = 100;

/**
 * Precision factor (4 decimal places) used to eliminate IEEE 754 floating-point inaccuracies.
 */
const PRECISION_FACTOR: number = 10000;

/**
 * Pointer event button index representing the primary button (left button or touch contact).
 */
const PRIMARY_BUTTON: number = 0;

/**
 * CSS class applied to the container flex row during drag operations.
 * Sets user-select: none and cursor: col-resize so dragging does not select text across editors.
 */
const DRAG_CLASS: string = 'kdoc-split-resizing';

/** On the divider when it runs horizontally between stacked panes. */
const HORIZONTAL_CLASS: string = 'kdoc-split-divider-horizontal';

/** On the container alongside DRAG_CLASS while a horizontal divider is dragged, for the up-down cursor. */
const DRAG_ROWS_CLASS: string = 'kdoc-split-resizing-rows';

/**
 * Static stylesheet for the draggable split divider, defining a sunken trench track,
 * an extruded rounded-pill grab handle on top, grab hit-area expansion, focus outlines,
 * and drag-mode cursor and selection locking using exclusively authoritative K-Doc chrome design tokens.
 */
export const SPLIT_DIVIDER_STYLES: string = `
.kdoc-split-divider {
  width: 6px;
  min-width: 6px;
  max-width: 6px;
  flex: 0 0 auto;
  cursor: col-resize;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  border-radius: var(--kdoc-radius-sm);
  box-sizing: border-box;
  position: relative;
  touch-action: none;
  transition: box-shadow 0.15s ease;
}

/* The UA stylesheet's [hidden] { display: none } loses to class rules specifying display: block or flex.
   An explicit [hidden] selector rule is mandatory so elements with hidden = true never stay visible. */

.kdoc-split-divider[hidden] {
  display: none !important;
}

/* Hit area extension: extends the interactive grab zone 4px on each side without altering the 6px visual width */

.kdoc-split-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
  cursor: col-resize;
  z-index: 1;
}

/* Extruded rounded-pill grab handle centered on the sunken track */

.kdoc-split-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 32px;
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
  z-index: 2;
  pointer-events: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.kdoc-split-divider:hover::after,
.kdoc-split-divider:focus::after {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  box-shadow: none;
}

.kdoc-split-divider:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-split-resizing .kdoc-split-divider::after {
  background: var(--kdoc-chrome-accent);
}

.kdoc-split-resizing {
  user-select: none;
  cursor: col-resize;
}

.kdoc-split-resizing * {
  user-select: none;
  cursor: col-resize;
}

/* Stacked panes: the divider becomes a horizontal bar, dragged up and down. */

.kdoc-split-divider.kdoc-split-divider-horizontal {
  width: auto;
  min-width: 0;
  max-width: none;
  height: 6px;
  min-height: 6px;
  max-height: 6px;
  cursor: row-resize;
}

.kdoc-split-divider.kdoc-split-divider-horizontal::before {
  top: -4px;
  bottom: -4px;
  left: 0;
  right: 0;
  cursor: row-resize;
}

.kdoc-split-divider.kdoc-split-divider-horizontal::after {
  width: 32px;
  height: 4px;
}

.kdoc-split-resizing.kdoc-split-resizing-rows,
.kdoc-split-resizing.kdoc-split-resizing-rows * {
  cursor: row-resize;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-split-divider,
  .kdoc-split-divider::after {
    transition: none !important;
  }
}
`;

/**
 * Installs draggable split divider controls onto the provided element, configuring pointer dragging,
 * keyboard accessibility, double-click reset, and proportional flex style application.
 *
 * @purpose Instantiates split divider controller, initializes ARIA separator attributes, attaches event listeners, and returns the SplitDivider controller.
 * @inputs options - SplitDividerOptions specifying divider element, document context, left pane, right pane, and container element.
 * @outputs SplitDivider - Controller interface exposing ratio getter, setRatio, reset, and destroy methods.
 * @dataflow options -> configure element ARIA attributes & classes -> attach event handlers with AbortController -> return SplitDivider controller.
 * @controlflow Initialize ARIA attributes -> bind pointerdown, pointermove, pointerup, pointercancel, dblclick, and keydown listeners -> apply initial 50/50 split -> return controller interface.
 */
export function installSplitDivider(options: SplitDividerOptions): SplitDivider {
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;
  let isDragging: boolean = false;
  let currentRatio: number = DEFAULT_RATIO;
  let orientation: DividerOrientation = options.orientation ?? 'vertical';

  // Configure divider element styling and accessible separator semantics.
  options.element.classList.add('kdoc-split-divider');
  options.element.setAttribute('role', 'separator');
  applyOrientation();
  options.element.setAttribute('aria-label', 'Resize panes');
  options.element.setAttribute('tabindex', '0');
  options.element.setAttribute('aria-valuemin', String(Math.round(MIN_RATIO * PERCENT_MULTIPLIER)));
  options.element.setAttribute('aria-valuemax', String(Math.round(MAX_RATIO * PERCENT_MULTIPLIER)));

  /**
   * @purpose Reflects the current orientation on the divider: its class (which reshapes it) and aria-orientation.
   * @inputs void; reads orientation.
   * @outputs void.
   * @dataflow orientation -> HORIZONTAL_CLASS toggle -> aria-orientation.
   * @controlflow No branching beyond the class toggle.
   */
  function applyOrientation(): void {
    options.element.classList.toggle(HORIZONTAL_CLASS, orientation === 'horizontal');
    options.element.setAttribute('aria-orientation', orientation);
  }

  /**
   * Clamps the target split ratio within [MIN_RATIO, MAX_RATIO] and applies proportional flex styles to both panes.
   *
   * @purpose Updates left and right pane flex allocations and synchronizes aria-valuenow on the divider element.
   * @inputs ratio - Target fraction of container width allocated to the left pane [0..1].
   * @outputs void.
   * @dataflow ratio -> clamp to [MIN_RATIO, MAX_RATIO] -> options.first.style.flex & options.second.style.flex -> aria-valuenow.
   * @controlflow Check destroyed guard -> clamp ratio -> update currentRatio -> set inline flex on both panes -> update aria-valuenow attribute.
   */
  function setRatio(ratio: number): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort ratio update.
      return;
    } else {
      // Component is active: proceed with clamping and applying ratio.
    }

    let clamped: number;
    // Check if requested ratio is NaN or non-finite.
    if (Number.isNaN(ratio) || !Number.isFinite(ratio)) {
      // Malformed ratio value: fallback to default 50/50 ratio.
      clamped = DEFAULT_RATIO;
    } else if (ratio < MIN_RATIO) {
      // Ratio below minimum threshold: clamp to MIN_RATIO to prevent left pane from collapsing.
      clamped = MIN_RATIO;
    } else if (ratio > MAX_RATIO) {
      // Ratio exceeds maximum threshold: clamp to MAX_RATIO to prevent right pane from collapsing.
      clamped = MAX_RATIO;
    } else {
      // Ratio within valid range: retain requested value.
      clamped = ratio;
    }

    // Round to 4 decimal places to prevent IEEE 754 floating-point precision artifacts (e.g. 1 - 0.85 becoming 0.15000000000000002).
    const normalizedFirst = Math.round(clamped * PRECISION_FACTOR) / PRECISION_FACTOR;
    const normalizedSecond = Math.round((1 - normalizedFirst) * PRECISION_FACTOR) / PRECISION_FACTOR;

    currentRatio = normalizedFirst;

    // Set flex values proportionally so the flex row responds naturally to window resizing.
    // Pixel widths are avoided because they freeze the layout at the window size when dragged.
    options.first.style.flex = String(normalizedFirst);
    options.second.style.flex = String(normalizedSecond);

    // Keep aria-valuenow in step on every change as an integer percentage.
    const percent = Math.round(normalizedFirst * PERCENT_MULTIPLIER);
    options.element.setAttribute('aria-valuenow', String(percent));
  }

  /**
   * Restores the even 50/50 split ratio between both editor panes.
   *
   * @purpose Resets left and right pane sizes to equal distribution.
   * @inputs void.
   * @outputs void.
   * @dataflow DEFAULT_RATIO -> setRatio.
   * @controlflow Check destroyed guard -> delegate to setRatio with DEFAULT_RATIO.
   */
  function reset(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort reset.
      return;
    } else {
      // Component is active: restore 50/50 split.
      setRatio(DEFAULT_RATIO);
    }
  }

  /**
   * Concludes an active pointer drag session, releasing pointer capture and container drag styles.
   *
   * @purpose Cleans up drag state and releases pointer capture after pointerup, pointercancel, or teardown.
   * @inputs event - Optional PointerEvent supplying pointerId for capture release.
   * @outputs void.
   * @dataflow isDragging reset -> releasePointerCapture -> container class removal.
   * @controlflow Check isDragging flag -> release pointer capture if active and supported -> remove DRAG_CLASS from container -> set isDragging = false.
   */
  function endDrag(event?: PointerEvent): void {
    // Check if dragging was currently active.
    if (!isDragging) {
      // Not dragging: no cleanup needed.
      return;
    } else {
      // Dragging active: proceed with releasing capture and styles.
      isDragging = false;
    }

    // Check if a pointer event was provided with a pointerId to release capture.
    if (event !== undefined && typeof options.element.releasePointerCapture === 'function') {
      // Check if hasPointerCapture is supported to verify capture state before release.
      if (
        typeof options.element.hasPointerCapture === 'function' &&
        !options.element.hasPointerCapture(event.pointerId)
      ) {
        // Element does not hold capture for this pointer: skip release to prevent DOMException.
      } else {
        // Element holds capture or hasPointerCapture is absent: release capture safely.
        try {
          options.element.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore capture release error in mock or transitional environments.
        }
      }
    } else {
      // No pointer event or releasePointerCapture unsupported: skip capture release.
    }

    // Remove drag classes to restore normal text selection and default cursor on the container.
    options.container.classList.remove(DRAG_CLASS, DRAG_ROWS_CLASS);
  }

  // Bind pointerdown to initiate pointer capture and drag state.
  options.element.addEventListener(
    'pointerdown',
    (event: PointerEvent): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore pointer interaction.
        return;
      } else {
        // Component is active: proceed with pointer interaction check.
      }

      // Check if event is initiated by the primary pointer button (left click or touch contact).
      if (event.button !== PRIMARY_BUTTON) {
        // Secondary or auxiliary button: ignore to avoid unintended dragging.
        return;
      } else {
        // Primary button pressed: begin drag operation.
        isDragging = true;
      }

      // Pointer capture is essential: without it a fast drag that leaves the divider stops
      // receiving moves and the divider sticks mid-drag. Guard setPointerCapture with a
      // typeof check so a jsdom test environment that lacks it does not throw.
      if (typeof options.element.setPointerCapture === 'function') {
        // Environment supports pointer capture: capture subsequent pointer events to this element.
        options.element.setPointerCapture(event.pointerId);
      } else {
        // Environment lacks setPointerCapture (e.g. jsdom): skip capture invocation safely.
      }

      // Add resizing class to container to disable text selection across editors and enforce col-resize cursor.
      options.container.classList.add(DRAG_CLASS);
      // A horizontal divider is dragged up and down, so the whole window shows the up-down cursor while it moves.
      options.container.classList.toggle(DRAG_ROWS_CLASS, orientation === 'horizontal');
      event.preventDefault();
    },
    { signal },
  );

  // Bind pointermove to calculate and update split ratio from pointer x coordinates.
  options.element.addEventListener(
    'pointermove',
    (event: PointerEvent): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore pointer movement.
        return;
      } else {
        // Component is active: check dragging state.
      }

      // Check whether divider drag operation is currently active.
      if (!isDragging) {
        // Dragging is not active: ignore pointer movements.
        return;
      } else {
        // Dragging is active: calculate container relative position.
      }

      const rect = options.container.getBoundingClientRect();
      const stacked = orientation === 'horizontal';
      // Side by side the pointer's x position sets the ratio; stacked, its y position does.
      const size = stacked ? rect.height : rect.width;

      // Check if the container's size along the drag axis is non-positive, to prevent division by zero.
      if (size <= 0) {
        // Container has no size along that axis: cannot compute a meaningful ratio.
        return;
      } else {
        // Container has a size: calculate the pointer offset from its start.
      }

      // Measure against the content box: the panes container is padded to make room for the floating
      // sidebars, and that padding is not space either pane can occupy.
      const containerStyle = getComputedStyle(options.container);
      const paddingStart = parseFloat(stacked ? containerStyle.paddingTop : containerStyle.paddingLeft) || 0;
      const paddingEnd = parseFloat(stacked ? containerStyle.paddingBottom : containerStyle.paddingRight) || 0;
      const contentSize = size - paddingStart - paddingEnd;
      const pointer = (stacked ? event.clientY - rect.top : event.clientX - rect.left) - paddingStart;
      // Divide by the content size when it is positive; a degenerate padding larger than the box falls back to the full size.
      const computedRatio = pointer / (contentSize > 0 ? contentSize : size);
      setRatio(computedRatio);
    },
    { signal },
  );

  // Bind pointerup to conclude drag session on pointer release.
  options.element.addEventListener(
    'pointerup',
    (event: PointerEvent): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore pointerup.
        return;
      } else {
        // Component is active: end drag session.
        endDrag(event);
      }
    },
    { signal },
  );

  // Bind pointercancel to safely terminate drag session if pointer event stream is interrupted.
  options.element.addEventListener(
    'pointercancel',
    (event: PointerEvent): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore pointercancel.
        return;
      } else {
        // Component is active: cancel drag session.
        endDrag(event);
      }
    },
    { signal },
  );

  // Double-click resets to 50/50, which is the convention every split-pane UI uses.
  options.element.addEventListener(
    'dblclick',
    (): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore double click.
        return;
      } else {
        // Component is active: reset to 50/50 split.
        reset();
      }
    },
    { signal },
  );

  // Bind keyboard navigation to support WCAG 2.2 accessibility without a pointing device.
  options.element.addEventListener(
    'keydown',
    (event: KeyboardEvent): void => {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Component is destroyed: ignore keyboard interactions.
        return;
      } else {
        // Component is active: process keyboard navigation keys.
      }

      // Check which key was pressed to adjust the split ratio.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        // ArrowLeft or ArrowUp: decrease first pane ratio by KEYBOARD_STEP (shift divider left, or up when stacked).
        event.preventDefault();
        setRatio(currentRatio - KEYBOARD_STEP);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        // ArrowRight or ArrowDown: increase first pane ratio by KEYBOARD_STEP (shift divider right, or down when stacked).
        event.preventDefault();
        setRatio(currentRatio + KEYBOARD_STEP);
      } else if (event.key === 'Home') {
        // Home: jump directly to minimum ratio boundary.
        event.preventDefault();
        setRatio(MIN_RATIO);
      } else if (event.key === 'End') {
        // End: jump directly to maximum ratio boundary.
        event.preventDefault();
        setRatio(MAX_RATIO);
      } else if (event.key === 'Enter') {
        // Enter: reset to even 50/50 split ratio.
        event.preventDefault();
        reset();
      } else {
        // Other keys: allow default browser processing.
      }
    },
    { signal },
  );

  // Apply initial 50/50 split ratio.
  setRatio(DEFAULT_RATIO);

  return {
    /**
     * @purpose Returns the current left pane share ratio [0..1].
     * @inputs void.
     * @outputs number - Current ratio value.
     * @dataflow currentRatio -> number.
     * @controlflow Return currentRatio value.
     */
    get ratio(): number {
      return currentRatio;
    },

    /**
     * @purpose Returns which way the divider currently runs.
     * @inputs void.
     * @outputs DividerOrientation.
     * @dataflow orientation -> DividerOrientation.
     * @controlflow Return orientation.
     */
    get orientation(): DividerOrientation {
      return orientation;
    },

    setRatio,
    reset,

    /**
     * @purpose Switches the divider between side-by-side and stacked panes; the ratio is kept, because flex shares
     *   mean the same thing along either axis.
     * @inputs next - The orientation to switch to.
     * @outputs void.
     * @dataflow next -> orientation -> applyOrientation.
     * @controlflow Ignored after destroy.
     */
    setOrientation(next: DividerOrientation): void {
      // A destroyed divider keeps no state to update.
      if (destroyed) {
        return;
      } else {
        orientation = next;
        applyOrientation();
      }
    },

    /**
     * Cleans up all resources held by the split divider, aborting event listeners,
     * clearing inline flex styles from both panes, removing drag styling, and emptying the divider element.
     *
     * @purpose Idempotently tears down event listeners, clears inline styles, and restores DOM container state.
     * @inputs void.
     * @outputs void.
     * @dataflow AbortController abort -> remove inline flex -> remove DRAG_CLASS -> replaceChildren.
     * @controlflow Check destroyed flag (return early if true) -> set destroyed = true -> abort signals -> clear styles -> empty element.
     */
    destroy(): void {
      // Check if component has already been destroyed.
      if (destroyed) {
        // Already destroyed: return immediately for idempotent teardown.
        return;
      } else {
        // Active component: mark destroyed and execute teardown.
        destroyed = true;
      }

      endDrag();
      abortController.abort();

      // Clear inline flex styles on both panes to restore stylesheet defaults.
      options.first.style.removeProperty('flex');
      options.second.style.removeProperty('flex');

      // Remove divider CSS class and accessibility attributes from the element.
      options.element.classList.remove('kdoc-split-divider', HORIZONTAL_CLASS);
      options.element.removeAttribute('role');
      options.element.removeAttribute('aria-orientation');
      options.element.removeAttribute('aria-label');
      options.element.removeAttribute('aria-valuemin');
      options.element.removeAttribute('aria-valuemax');
      options.element.removeAttribute('aria-valuenow');
      options.element.removeAttribute('tabindex');

      // Empty the divider element children.
      options.element.replaceChildren();
    },
  };
}
