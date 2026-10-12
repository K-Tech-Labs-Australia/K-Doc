// @vitest-environment jsdom
/**
 * @file window-controls.spec.ts
 * @purpose Verifies window control buttons installation, event forwarding, dynamic title bar relabelling, and style token conformance.
 * @inputs WindowControlsApi mock objects, DOM elements, mouse events, and jsdom Window environment.
 * @outputs Vitest test assertions validating installWindowControls, tauriWindowApi, and WINDOW_CONTROLS_STYLES.
 * @functions
 *   - fakeApi: Constructs a fake WindowControlsApi double with call logging and state tracking.
 *   - flush: Flushes the microtask and macrotask queues using a zero-delay setTimeout Promise.
 * @dataflow Window control events -> WindowControlsApi method invocations -> DOM mutations and error callback notifications.
 * @controlflow Tests grouped into rendering, window operations, resize observation, teardown, Tauri detection, and stylesheet token suites.
 * @version 1
 * @date 2026-10-04
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WINDOW_CONTROLS_STYLES,
  installWindowControls,
  tauriWindowApi,
  type WindowControlsApi,
} from '../src/shell/window-controls.js';

interface FakeApiResult {
  api: WindowControlsApi;
  calls: string[];
  resize: () => void;
  unlisten: ReturnType<typeof vi.fn>;
  setMaximized: (v: boolean) => void;
}

/**
 * Creates a test double simulating the WindowControlsApi.
 * @purpose Produces a stubbed WindowControlsApi tracking method invocations and window maximization state.
 * @inputs maximized - boolean (optional, defaults to false): Initial maximization state flag.
 * @outputs FakeApiResult - Object containing api double, call history, resize trigger, unlisten spy, and state setter.
 * @dataflow Calls to api methods -> recorded in calls array; toggleMaximize and setMaximized -> mutate internal flag.
 * @controlflow Captures callbacks and returns controller object without complex branching.
 */
function fakeApi(maximized: boolean = false): FakeApiResult {
  const calls: string[] = [];
  let isMax: boolean = maximized;
  let resizeHandler: (() => void) | null = null;
  const unlisten = vi.fn();

  const api: WindowControlsApi = {
    minimize: async (): Promise<void> => {
      calls.push('minimize');
    },
    toggleMaximize: async (): Promise<void> => {
      calls.push('toggleMaximize');
      // Flip the internal maximization state flag.
      isMax = !isMax;
    },
    close: async (): Promise<void> => {
      calls.push('close');
    },
    isMaximized: async (): Promise<boolean> => isMax,
    onResized: async (handler: () => void): Promise<() => void> => {
      resizeHandler = handler;
      return unlisten;
    },
  };

  /**
   * Triggers the registered resize handler callback.
   * @purpose Simulates external window resize notification events.
   * @inputs None.
   * @outputs void.
   * @dataflow Calls stored resizeHandler if defined.
   * @controlflow Checks if resizeHandler exists -> executes handler if non-null.
   */
  const resize = (): void => {
    // Check if an external resize callback was registered via onResized.
    if (resizeHandler !== null) {
      // Resize handler is registered: invoke the callback.
      resizeHandler();
    } else {
      // No resize handler registered: no action required.
    }
  };

  /**
   * Updates the internal maximized state directly.
   * @purpose Mutates window maximization state for test assertions.
   * @inputs v - boolean: Target maximization state.
   * @outputs void.
   * @dataflow v -> stored in isMax variable.
   * @controlflow Direct state assignment without branching.
   */
  const setMaximized = (v: boolean): void => {
    isMax = v;
  };

  return {
    api,
    calls,
    resize,
    unlisten,
    setMaximized,
  };
}

/**
 * Yields execution to flush pending microtasks and macrotasks.
 * @purpose Allows asynchronous DOM updates and Promise chains to settle before assertions.
 * @inputs None.
 * @outputs Promise<void> - Resolves on the next macrotask turn.
 * @dataflow None.
 * @controlflow Creates a Promise resolved via setTimeout without branching.
 */
function flush(): Promise<void> {
  return new Promise((resolve): void => {
    setTimeout(resolve, 0);
  });
}

describe('window-controls', (): void => {
  afterEach((): void => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('draws nothing in the browser build', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);

    const controls = installWindowControls({
      doc: document,
      container,
      api: null,
      onError: vi.fn(),
    });

    expect(controls.element.hidden).toBe(true);
    const buttons: NodeListOf<HTMLButtonElement> = controls.element.querySelectorAll('button');
    expect(buttons.length).toBe(0);
    expect(container.contains(controls.element)).toBe(true);

    controls.destroy();
  });

  it('draws minimise, maximise and close in order', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );

    const labels: (string | null)[] = buttons.map(
      (b: HTMLButtonElement): string | null => b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Minimise', 'Maximise', 'Close']);

    // Check if exactly three window buttons are rendered.
    if (buttons.length !== 3) {
      // Button count differs from expected: fail with descriptive error.
      throw new Error('Expected exactly 3 window control buttons');
    } else {
      // Button count matches expectation: proceed to verify icon contents.
    }

    for (const button of buttons) {
      const icon: SVGElement | null = button.querySelector('svg.kdoc-icon');
      // Check if the button contains an SVG icon with class kdoc-icon.
      if (!icon) {
        // Icon element is missing: abort with explicit failure.
        throw new Error('Expected button to contain svg.kdoc-icon');
      } else {
        // Icon element is present: assert truthy node.
        expect(icon).not.toBeNull();
      }
    }

    const lastButton: HTMLButtonElement | undefined = buttons[2];
    // Check if the third (close) button exists in the buttons array.
    if (!lastButton) {
      // Close button is missing: abort with explicit failure.
      throw new Error('Expected close button at index 2');
    } else {
      // Close button is found: assert presence of is-close class.
      expect(lastButton.classList.contains('is-close')).toBe(true);
    }

    controls.destroy();
  });

  it('shows Restore when the window starts maximised', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(true);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const secondButton: HTMLButtonElement | undefined = buttons[1];

    // Check if the second (maximize/restore) button exists in the buttons array.
    if (!secondButton) {
      // Second button is missing: abort with explicit failure.
      throw new Error('Expected second button at index 1');
    } else {
      // Second button is found: verify Restore aria-label and title attributes.
      expect(secondButton.getAttribute('aria-label')).toBe('Restore');
      expect(secondButton.getAttribute('title')).toBe('Restore');
    }

    controls.destroy();
  });

  it('runs the window operations', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const minBtn: HTMLButtonElement | undefined = buttons[0];
    const maxBtn: HTMLButtonElement | undefined = buttons[1];
    const closeBtn: HTMLButtonElement | undefined = buttons[2];

    // Check if all three control buttons exist before dispatching clicks.
    if (!minBtn || !maxBtn || !closeBtn) {
      // One or more buttons missing: abort with explicit failure.
      throw new Error('Expected three window buttons to be present');
    } else {
      // All three buttons are present: trigger click events in sequence.
      minBtn.click();
      maxBtn.click();
      closeBtn.click();
    }

    await flush();

    expect(fake.calls).toEqual(['minimize', 'toggleMaximize', 'close']);

    controls.destroy();
  });

  it('relabels after maximising', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const maxBtn: HTMLButtonElement | undefined = buttons[1];

    // Check if the second button exists prior to triggering maximize action.
    if (!maxBtn) {
      // Second button is missing: abort with explicit failure.
      throw new Error('Expected second button at index 1');
    } else {
      // Second button is present: verify initial Maximise label and click it.
      expect(maxBtn.getAttribute('aria-label')).toBe('Maximise');
      maxBtn.click();
    }

    await flush();
    await flush();

    expect(maxBtn.getAttribute('aria-label')).toBe('Restore');

    controls.destroy();
  });

  it('follows resizes made elsewhere', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const maxBtn: HTMLButtonElement | undefined = buttons[1];

    // Check if the second button exists prior to external resize notification.
    if (!maxBtn) {
      // Second button is missing: abort with explicit failure.
      throw new Error('Expected second button at index 1');
    } else {
      // Second button is present: verify initial Maximise label before external resize.
      expect(maxBtn.getAttribute('aria-label')).toBe('Maximise');
    }

    fake.setMaximized(true);
    fake.resize();

    await flush();
    await flush();

    expect(maxBtn.getAttribute('aria-label')).toBe('Restore');

    controls.destroy();
  });

  it('reports a failed operation', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);
    fake.api.close = (): Promise<void> => Promise.reject(new Error('denied'));

    const onError = vi.fn();
    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError,
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const closeBtn: HTMLButtonElement | undefined = buttons[2];

    // Check if the close button exists before triggering failed close action.
    if (!closeBtn) {
      // Close button is missing: abort with explicit failure.
      throw new Error('Expected close button at index 2');
    } else {
      // Close button is present: simulate click triggering rejected operation.
      closeBtn.click();
    }

    await flush();

    expect(onError).toHaveBeenCalledTimes(1);

    const errorArg: unknown = onError.mock.calls[0]?.[0];
    // Check if the reported error argument is an instance of Error.
    if (!(errorArg instanceof Error)) {
      // Argument is not an Error: abort with explicit failure.
      throw new Error('Expected onError to be called with an Error instance');
    } else {
      // Argument is an Error: verify the failure message matches denied.
      expect(errorArg.message).toBe('denied');
    }

    controls.destroy();
  });

  it('keeps button presses out of the drag region', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const containerSpy = vi.fn();
    container.addEventListener('mousedown', containerSpy);

    const fake = fakeApi(false);
    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    const buttons: HTMLButtonElement[] = Array.from(
      controls.element.querySelectorAll<HTMLButtonElement>('button.kdoc-window-button'),
    );
    const minBtn: HTMLButtonElement | undefined = buttons[0];

    // Check if the minimise button exists before dispatching mousedown event.
    if (!minBtn) {
      // Minimise button is missing: abort with explicit failure.
      throw new Error('Expected minimise button at index 0');
    } else {
      // Minimise button is present: dispatch bubbling mousedown event.
      const event: MouseEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      minBtn.dispatchEvent(event);
    }

    expect(containerSpy).not.toHaveBeenCalled();

    controls.destroy();
  });

  it('destroys idempotently and unsubscribes', async (): Promise<void> => {
    const container: HTMLDivElement = document.createElement('div');
    document.body.appendChild(container);
    const fake = fakeApi(false);

    const controls = installWindowControls({
      doc: document,
      container,
      api: fake.api,
      onError: vi.fn(),
    });

    await flush();

    expect(controls.element.isConnected).toBe(true);

    controls.destroy();
    controls.destroy();

    expect(controls.element.isConnected).toBe(false);
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
  });

  it('tauriWindowApi returns null outside Tauri', (): void => {
    const fakeWin: Window = {} as unknown as Window;
    const result: WindowControlsApi | null = tauriWindowApi(fakeWin);
    expect(result).toBeNull();
  });

  it('styles use tokens only', (): void => {
    expect(WINDOW_CONTROLS_STYLES).toContain('.kdoc-window-button');
    expect(WINDOW_CONTROLS_STYLES).toContain('prefers-reduced-motion');
    expect(WINDOW_CONTROLS_STYLES).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(WINDOW_CONTROLS_STYLES).not.toContain('rgba(');
  });
});
