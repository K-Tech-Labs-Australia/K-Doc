// @vitest-environment jsdom
/**
 * @file pane-reserve.spec.ts
 * @purpose Verifies gutter reservation calculations and style installation for side hosts.
 * @inputs RectLike coordinates and DOM elements; jsdom DOM environment.
 * @outputs Vitest test assertions validating reservedInsets and installPaneReserve.
 * @functions
 *   - rect: Constructs a RectLike bounding geometry descriptor.
 *   - stubRect: Replaces getBoundingClientRect on an element with a stubbed DOMRect.
 * @dataflow Geometry bounds -> reservedInsets calculation -> custom property assignment -> assertions.
 * @controlflow Tests grouped into reservedInsets arithmetic and installPaneReserve DOM integration suites.
 * @version 1
 * @date 2026-10-04
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANE_RESERVE_GAP_PX,
  RESERVE_LEFT_PROPERTY,
  RESERVE_RIGHT_PROPERTY,
  installPaneReserve,
  reservedInsets,
} from '../src/shell/pane-reserve.js';

interface RectLike {
  left: number;
  right: number;
  width: number;
}

interface PaneReserve {
  update(): void;
  destroy(): void;
}

/**
 * Constructs a simplified bounding rect descriptor for layout calculations.
 * @purpose Creates a RectLike object from a left coordinate and width.
 * @inputs left - number: Left boundary coordinate in pixels.
 *         width - number: Width of the rectangle in pixels.
 * @outputs RectLike - An object containing left, right (left + width), and width.
 * @dataflow (left, width) -> calculate right -> return RectLike object.
 * @controlflow Computes right bound as left plus width without branching.
 */
function rect(left: number, width: number): RectLike {
  return { left, right: left + width, width };
}

/**
 * Stubs getBoundingClientRect on an HTMLElement with a synthetic DOMRect.
 * @purpose Replaces getBoundingClientRect on an element with stubbed geometry.
 * @inputs el - HTMLElement: Target element whose bounding rect will be mocked.
 *         r - RectLike: Simplified bounding rect descriptor holding horizontal bounds.
 * @outputs void.
 * @dataflow r -> construct DOMRect object -> assign to el.getBoundingClientRect.
 * @controlflow Direct method replacement on the element without branching.
 */
function stubRect(el: HTMLElement, r: RectLike): void {
  el.getBoundingClientRect = (): DOMRect =>
    ({
      ...r,
      top: 0,
      bottom: 0,
      height: 0,
      x: r.left,
      y: 0,
      toJSON: (): Record<string, unknown> => ({}),
    }) as DOMRect;
}

/**
 * Test double simulating the browser ResizeObserver API.
 */
class FakeRO {
  static instances: FakeRO[] = [];
  observed: Element[] = [];
  disconnected = false;

  /**
   * Initializes a fake ResizeObserver instance and registers it in static collection.
   * @purpose Creates observer double capturing the resize callback.
   * @inputs cb - () => void: Callback invoked when an observed element resizes.
   * @outputs FakeRO instance.
   * @dataflow cb -> stored in this.cb; this -> appended to FakeRO.instances.
   * @controlflow Stores callback and appends instance to registry without branching.
   */
  constructor(public cb: () => void) {
    FakeRO.instances.push(this);
  }

  /**
   * Records an element to be observed.
   * @purpose Adds target element to the observed list.
   * @inputs el - Element: Target DOM element to observe.
   * @outputs void.
   * @dataflow el -> pushed to this.observed array.
   * @controlflow Appends element to tracking array without branching.
   */
  observe(el: Element): void {
    this.observed.push(el);
  }

  /**
   * Disconnects the observer.
   * @purpose Marks the observer instance as disconnected.
   * @inputs None.
   * @outputs void.
   * @dataflow Sets this.disconnected boolean flag to true.
   * @controlflow Direct flag assignment without branching.
   */
  disconnect(): void {
    this.disconnected = true;
  }
}

describe('reservedInsets', (): void => {
  it('exports expected gap size constant', (): void => {
    expect(PANE_RESERVE_GAP_PX).toBe(4);
  });

  it('computes left inset when left host is present and right host is null', (): void => {
    const panes = rect(0, 1400);
    const left = rect(12, 364);
    const insets = reservedInsets(panes, left, null);
    expect(insets).toEqual({ left: 380, right: 0 });
  });

  it('computes right inset when right host is present and left host is null', (): void => {
    const panes = rect(0, 1400);
    const right = rect(1314, 74);
    const insets = reservedInsets(panes, null, right);
    expect(insets).toEqual({ left: 0, right: 90 });
  });

  it('reserves 0 for a host with width 0 even if left and right are non-zero', (): void => {
    const panes = rect(0, 1400);
    const left = { left: 12, right: 376, width: 0 };
    const insets = reservedInsets(panes, left, null);
    expect(insets.left).toBe(0);
  });

  it('accounts for panes horizontal offset from the viewport origin', (): void => {
    const panes = rect(100, 1200);
    const left = rect(112, 74);
    const insets = reservedInsets(panes, left, null);
    expect(insets.left).toBe(90);
  });

  it('rounds fractional values to the nearest integer pixel', (): void => {
    const panes = rect(0, 800);
    const left = rect(12.4, 74.3);
    const insets = reservedInsets(panes, left, null);
    expect(insets.left).toBe(91);
  });

  it('never returns negative inset when right host is entirely right of panes', (): void => {
    const panes = rect(0, 500);
    const right = rect(600, 50);
    const insets = reservedInsets(panes, null, right);
    expect(insets.right).toBe(0);
  });
});

describe('installPaneReserve', (): void => {
  let activeReserve: PaneReserve | null = null;

  afterEach((): void => {
    // Check if an active reserve instance exists and requires cleanup.
    if (activeReserve !== null) {
      // Active reserve exists: invoke destroy to unregister listeners and observers.
      activeReserve.destroy();
      activeReserve = null;
    } else {
      // No active reserve instance exists: nothing to clean up.
    }

    // Clear all DOM children attached to document.body.
    document.body.replaceChildren();
    FakeRO.instances = [];
    vi.restoreAllMocks();
  });

  it('writes both properties on install', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });

    expect(RESERVE_LEFT_PROPERTY).toBe('--kdoc-pane-reserve-left');
    expect(RESERVE_RIGHT_PROPERTY).toBe('--kdoc-pane-reserve-right');
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-left')).toBe('380px');
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-right')).toBe('90px');
  });

  it('reserves 0px when a host element is hidden', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    left.hidden = true;

    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });

    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-left')).toBe('0px');
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-right')).toBe('90px');
  });

  it('re-measures host elements when update is called', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-left')).toBe('380px');

    stubRect(left, rect(12, 74));
    activeReserve.update();
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-left')).toBe('90px');
  });

  it('falls back to a resize listener when the window has no ResizeObserver', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });
    expect(win.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    const resizeCall = vi.mocked(win.addEventListener).mock.calls.find(
      (call): boolean => call[0] === 'resize',
    );
    // Check if the window resize listener registration was captured.
    if (!resizeCall) {
      // Listener registration is missing: abort with explicit failure.
      throw new Error('Expected resize listener to be registered');
    } else {
      // Listener registration is present: proceed to verify listener function.
    }

    const handler = resizeCall[1];
    // Check if the registered handler is a callable function.
    if (typeof handler !== 'function') {
      // Handler is not a function: abort with explicit failure.
      throw new Error('Expected resize handler to be a function');
    } else {
      // Handler is a valid function: proceed with teardown verification.
    }

    activeReserve.destroy();
    expect(win.removeEventListener).toHaveBeenCalledWith('resize', handler);
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);

    // Call destroy a second time to verify idempotency.
    activeReserve.destroy();
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('uses ResizeObserver when present on the window object', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    const win = {
      ResizeObserver: FakeRO,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });

    // Check if a FakeRO instance was created by installPaneReserve.
    if (FakeRO.instances.length === 0) {
      // No observer was instantiated: abort with explicit error.
      throw new Error('Expected FakeRO to be instantiated');
    } else {
      // Observer instance was created: proceed to inspect instance.
    }

    const observer = FakeRO.instances[0];
    // Check if the observer instance at index 0 is defined.
    if (!observer) {
      // Observer is undefined: abort with explicit error.
      throw new Error('Expected observer at index 0');
    } else {
      // Observer is defined: proceed with assertions.
    }

    expect(observer.observed).toEqual([left, right, panes]);

    stubRect(left, rect(12, 74));
    observer.cb();
    expect(panes.style.getPropertyValue('--kdoc-pane-reserve-left')).toBe('90px');

    activeReserve.destroy();
    expect(observer.disconnected).toBe(true);
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it('does not rewrite CSS properties when measured values are unchanged', (): void => {
    const panes = document.createElement('div');
    const left = document.createElement('div');
    const right = document.createElement('div');
    document.body.append(panes, left, right);

    stubRect(panes, rect(0, 1400));
    stubRect(left, rect(12, 364));
    stubRect(right, rect(1314, 74));

    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    activeReserve = installPaneReserve({ panes, left, right, win });

    const setPropertySpy = vi.spyOn(panes.style, 'setProperty');
    activeReserve.update();
    expect(setPropertySpy).not.toHaveBeenCalled();
  });
});
