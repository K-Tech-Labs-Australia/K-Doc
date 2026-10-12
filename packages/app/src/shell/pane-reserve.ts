/**
 * @file pane-reserve.ts
 * @purpose Measures floating sidebar host intrusion into document panes and publishes CSS custom properties for pane padding.
 * @inputs Bounding geometry of .kdoc-panes and floating sidebar hosts, window resize events, and ResizeObserver notifications.
 * @outputs PANE_RESERVE_GAP_PX, RESERVE_LEFT_PROPERTY, RESERVE_RIGHT_PROPERTY, ReserveRect, PaneInsets, PaneReserveOptions, PaneReserve, reservedInsets, and installPaneReserve.
 * @functions
 *   - reservedInsets: Computes left and right inset pixel dimensions based on pane container and host bounding rectangles.
 *   - installPaneReserve: Binds geometry measurement to ResizeObserver or window resize and publishes CSS custom properties.
 * @dataflow Host and pane DOM bounding rectangles -> reservedInsets calculation -> CSS custom properties set on panes element.
 * @controlflow Initialize observation -> run initial update measurement -> update on element/window resize -> teardown on destroy.
 * @version 1
 * @date 2026-10-04
 */

/** Gap in CSS px kept between a floating panel host and the panes beside it. */
export const PANE_RESERVE_GAP_PX: number = 4;

/** Custom property names written on the panes element. */
export const RESERVE_LEFT_PROPERTY: string = '--kdoc-pane-reserve-left';
export const RESERVE_RIGHT_PROPERTY: string = '--kdoc-pane-reserve-right';

/** The rectangle fields this module reads (a DOMRect satisfies it). */
export interface ReserveRect {
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

export interface PaneInsets {
  readonly left: number;
  readonly right: number;
}

/**
 * Computes left and right inset pixel dimensions based on pane container and host bounding rectangles.
 * @purpose Calculates the inward pixel reserve needed so document panes do not collide with floating sidebar hosts.
 * @inputs panes - ReserveRect representing the bounding bounds of the panes container.
 *         left - ReserveRect representing the left sidebar host, or null if unmounted/hidden.
 *         right - ReserveRect representing the right sidebar host, or null if unmounted/hidden.
 * @outputs PaneInsets - Object containing computed left and right inset values in pixels.
 * @dataflow panes and host rectangles -> intrusion edge arithmetic with gap addition -> clamped PaneInsets.
 * @controlflow Evaluate left host availability -> compute left inset -> evaluate right host availability -> compute right inset -> return insets.
 */
export function reservedInsets(
  panes: ReserveRect,
  left: ReserveRect | null,
  right: ReserveRect | null,
): PaneInsets {
  let leftInset: number = 0;
  // Check if left sidebar host rectangle is null or collapsed to zero or negative width.
  if (left === null || left.width <= 0) {
    // Left host is absent or collapsed: set left inset to zero pixels.
    leftInset = 0;
  } else {
    // Left host is present and visible: calculate intrusion past pane left edge plus reserve gap, clamped to zero minimum.
    leftInset = Math.max(0, Math.round(left.right - panes.left + PANE_RESERVE_GAP_PX));
  }

  let rightInset: number = 0;
  // Check if right sidebar host rectangle is null or collapsed to zero or negative width.
  if (right === null || right.width <= 0) {
    // Right host is absent or collapsed: set right inset to zero pixels.
    rightInset = 0;
  } else {
    // Right host is present and visible: calculate intrusion past pane right edge plus reserve gap, clamped to zero minimum.
    rightInset = Math.max(0, Math.round(panes.right - right.left + PANE_RESERVE_GAP_PX));
  }

  return { left: leftInset, right: rightInset };
}

export interface PaneReserveOptions {
  /** The .kdoc-panes container the hosts are positioned against. */
  readonly panes: HTMLElement;
  /** Left sidebar host element. */
  readonly left: HTMLElement;
  /** Right sidebar host element. */
  readonly right: HTMLElement;
  /** Window used for ResizeObserver and the resize fallback. */
  readonly win: Window;
}

export interface PaneReserve {
  /** Re-measure now and publish the insets. */
  update(): void;
  /** Stop observing; idempotent. */
  destroy(): void;
}

/**
 * Installs responsive measurement and CSS property publication for document pane insets.
 * @purpose Binds sidebar host and pane geometry tracking to ResizeObserver or window resize events and publishes custom properties.
 * @inputs options - PaneReserveOptions containing DOM elements (panes, left, right) and target Window.
 * @outputs PaneReserve - Controller object exposing update and destroy lifecycle methods.
 * @dataflow Element bounding boxes -> reservedInsets -> CSS custom property updates on panes element.
 * @controlflow Set up internal state and helper functions -> detect ResizeObserver support -> register observer or resize event listener -> perform initial update -> return controller.
 */
export function installPaneReserve(options: PaneReserveOptions): PaneReserve {
  let destroyed: boolean = false;

  /**
   * Measures bounding rectangle of an element if connected and visible.
   * @purpose Obtains the ReserveRect bounds for an element, returning null if hidden or disconnected.
   * @inputs el - HTMLElement to measure.
   * @outputs ReserveRect | null - Bounding geometry or null if element is hidden or disconnected.
   * @dataflow el -> hidden/isConnected check -> getBoundingClientRect() -> ReserveRect or null.
   * @controlflow Check hidden and connection status -> return null early if hidden/disconnected -> return getBoundingClientRect() otherwise.
   */
  function measure(el: HTMLElement): ReserveRect | null {
    // Check if the element has its hidden property set or is disconnected from the DOM.
    if (el.hidden || !el.isConnected) {
      // Element is hidden or disconnected: return null to omit measurement.
      return null;
    } else {
      // Element is visible and connected: return its bounding client rectangle.
      return el.getBoundingClientRect();
    }
  }

  /**
   * Re-measures host and pane positions and publishes custom CSS properties.
   * @purpose Re-measures layout rectangles and writes CSS variables to panes element if values changed.
   * @inputs None.
   * @outputs void - No return value.
   * @dataflow DOM geometry -> reservedInsets -> CSS custom property string formatting -> panes style attributes.
   * @controlflow Guard destroyed state -> measure elements -> compute insets -> iterate property entries -> set style property if changed.
   */
  function update(): void {
    // Check if the pane reserve manager has been destroyed.
    if (destroyed) {
      // Instance is destroyed: return early to prevent updates after teardown.
      return;
    } else {
      // Instance is active: proceed with measuring geometry and updating custom properties.
    }

    const insets: PaneInsets = reservedInsets(
      options.panes.getBoundingClientRect(),
      measure(options.left),
      measure(options.right),
    );

    const properties: readonly (readonly [string, number])[] = [
      [RESERVE_LEFT_PROPERTY, insets.left],
      [RESERVE_RIGHT_PROPERTY, insets.right],
    ];

    for (const [name, value] of properties) {
      const next: string = `${value}px`;
      // Check if the current CSS custom property value on panes element differs from the computed pixel string.
      if (options.panes.style.getPropertyValue(name) !== next) {
        // Value changed: write the new custom property value to update pane padding.
        options.panes.style.setProperty(name, next);
      } else {
        // Value unchanged: skip setting property to prevent cyclical ResizeObserver triggers.
      }
    }
  }

  let observer: ResizeObserver | null = null;
  const RO = (options.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

  // Check if ResizeObserver constructor function is available on the target window object.
  if (typeof RO === 'function') {
    // ResizeObserver is supported: instantiate observer and observe left host, right host, and panes container.
    observer = new RO((): void => {
      update();
    });
    observer.observe(options.left);
    observer.observe(options.right);
    observer.observe(options.panes);
  } else {
    // ResizeObserver is not available: register fallback resize event listener on the window.
    options.win.addEventListener('resize', update);
  }

  // Call update() once before returning to ensure initial insets are applied immediately.
  update();

  /**
   * Disconnects observers and unbinds event listeners.
   * @purpose Stops geometry tracking and tears down observer or window event listener idempotently.
   * @inputs None.
   * @outputs void - No return value.
   * @dataflow Teardown signal -> observer disconnection or window listener removal.
   * @controlflow Guard destroyed state -> mark destroyed -> check observer presence -> disconnect or unbind resize listener.
   */
  function destroy(): void {
    // Check if the instance has already been destroyed.
    if (destroyed) {
      // Instance is already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Mark instance as destroyed to ignore any future updates.
      destroyed = true;
    }

    // Check if an active ResizeObserver was created during initialization.
    if (observer !== null) {
      // ResizeObserver exists: disconnect all element observations.
      observer.disconnect();
    } else {
      // ResizeObserver does not exist: remove the window resize event listener.
      options.win.removeEventListener('resize', update);
    }
  }

  return {
    update,
    destroy,
  };
}
