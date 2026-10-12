/**
 * @file window-controls.ts
 * @purpose Renders and manages window control buttons (minimise, maximise/restore, close) for frameless desktop windows.
 * @inputs WindowControlsOptions containing Document, container HTMLElement, WindowControlsApi (or null for browser builds), and error callback.
 * @outputs WindowControlsApi, tauriWindowApi, WindowControlsOptions, WindowControls, WINDOW_CONTROLS_STYLES, and installWindowControls.
 * @functions
 *   - tauriWindowApi: Adapts Tauri runtime window operations to the WindowControlsApi contract, returning null in browser environments.
 *   - installWindowControls: Mounts window action buttons into the container and binds window lifecycle events.
 * @dataflow User interaction / window resize events -> WindowControlsApi operations -> DOM updates (button icon and accessibility attributes).
 * @controlflow Mount controls -> detect desktop/browser environment -> bind button click and window resize listeners -> teardown on destroy.
 * @version 1
 * @date 2026-10-04
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { createIcon } from './icons.js';

/** The window operations the controls need; tauriWindowApi adapts Tauri's window, tests pass a fake. */
export interface WindowControlsApi {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Subscribe to window resizes; resolves to an unsubscribe function. */
  onResized(handler: () => void): Promise<() => void>;
}

/**
 * Adapts Tauri runtime window operations to the WindowControlsApi contract.
 * @purpose Creates a WindowControlsApi bridge for Tauri desktop environments or returns null in browser builds.
 * @inputs win - The Window global context to test for Tauri internals.
 * @outputs WindowControlsApi | null - Desktop window operations API bridge, or null if running in a browser.
 * @dataflow Window object -> '__TAURI_INTERNALS__' check -> getCurrentWindow() bridge -> WindowControlsApi.
 * @controlflow Check for Tauri runtime internals on window -> return null if absent -> instantiate Tauri window bridge and return API.
 */
export function tauriWindowApi(win: Window): WindowControlsApi | null {
  // Check if Tauri runtime internals exist on the window object (detect native desktop vs browser build).
  if (!('__TAURI_INTERNALS__' in win)) {
    // Browser build: there is no native window to control, return null.
    return null;
  } else {
    // Desktop build: obtain the current Tauri window instance and return the WindowControlsApi bridge.
    const w = getCurrentWindow();
    return {
      minimize: (): Promise<void> => w.minimize(),
      toggleMaximize: (): Promise<void> => w.toggleMaximize(),
      close: (): Promise<void> => w.close(),
      isMaximized: (): Promise<boolean> => w.isMaximized(),
      onResized: async (handler: () => void): Promise<() => void> => {
        const unlisten = await w.onResized((): void => {
          handler();
        });
        return (): void => {
          unlisten();
        };
      },
    };
  }
}

export interface WindowControlsOptions {
  readonly doc: Document;
  /** Element the controls are appended to (the top bar). */
  readonly container: HTMLElement;
  /** null in the browser build: nothing is drawn. */
  readonly api: WindowControlsApi | null;
  /** Receives any rejected window operation; never swallowed. */
  readonly onError: (error: unknown) => void;
}

export interface WindowControls {
  readonly element: HTMLElement;
  destroy(): void;
}

/** Embedded CSS stylesheet defining styles for window controls and buttons. */
export const WINDOW_CONTROLS_STYLES: string = `
.kdoc-window-controls { display: flex; align-items: center; gap: 2px; margin-left: 4px; }
.kdoc-window-controls[hidden] { display: none; }
.kdoc-window-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 32px; padding: 0; border: 0; border-radius: var(--kdoc-radius-pill); background: transparent; color: var(--kdoc-chrome-text); cursor: pointer; transition: background-color 150ms ease, color 150ms ease; }
.kdoc-window-button:hover { background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent); }
.kdoc-window-button:active { background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent); }
.kdoc-window-button:focus-visible { outline: 3px solid var(--kdoc-chrome-accent); outline-offset: 2px; }
.kdoc-window-button.is-close:hover, .kdoc-window-button.is-close:active { background: var(--kdoc-emissive-red); color: var(--kdoc-chrome-base); }
@media (prefers-reduced-motion: reduce) { .kdoc-window-button { transition: none; } }
`;

/**
 * Installs frameless desktop window controls (minimise, maximise/restore, close) into the top bar.
 * @purpose Mounts window controls container, creates action buttons, and binds resize synchronization.
 * @inputs options - WindowControlsOptions specifying Document, container HTMLElement, WindowControlsApi, and onError handler.
 * @outputs WindowControls - Controller exposing the mounted HTMLElement and an idempotent destroy method.
 * @dataflow options.container -> DOM button elements appended -> Tauri window API events and actions.
 * @controlflow Create container -> check for null API -> create and append buttons -> attach click handlers -> subscribe to window resize -> run initial refresh -> return controller.
 */
export function installWindowControls(options: WindowControlsOptions): WindowControls {
  const doc: Document = options.doc;
  const element: HTMLDivElement = doc.createElement('div');
  element.className = 'kdoc-window-controls';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Window');
  options.container.appendChild(element);

  let destroyed: boolean = false;

  // Check if the window controls API is null (browser build without native window).
  if (options.api === null) {
    // Browser build: mark element hidden and return early with DOM cleanup destroy method.
    element.hidden = true;
    return {
      element,
      destroy(): void {
        // Check if controls have already been destroyed.
        if (destroyed) {
          // Already destroyed: return early for idempotent teardown.
          return;
        } else {
          // Mark destroyed and remove element from DOM.
          destroyed = true;
          element.remove();
        }
      },
    };
  } else {
    // Desktop build: proceed with button creation, event binding, and resize subscription.
  }

  const api: WindowControlsApi = options.api;

  /**
   * Factory creating a styled window control button with icon and accessibility attributes.
   * @purpose Creates and configures an HTML button element with SVG icon and drag-prevention mousedown listener.
   * @inputs icon - The icon identifier to render ('minimise' | 'maximise' | 'close').
   *         label - Accessible text label and tooltip for the button.
   *         extraClass - Optional extra CSS class name for specialized styling (e.g. 'is-close').
   * @outputs HTMLButtonElement - The configured button DOM element.
   * @dataflow icon/label parameters -> button DOM configuration -> appendChild SVG -> HTMLButtonElement.
   * @controlflow Create button element -> set type and classes -> set aria attributes and title -> append icon -> bind stopPropagation on mousedown -> return button.
   */
  function makeButton(
    icon: 'minimise' | 'maximise' | 'close',
    label: string,
    extraClass: string | null,
  ): HTMLButtonElement {
    const btn: HTMLButtonElement = doc.createElement('button');
    btn.type = 'button';

    // Check if an extra CSS class was provided for button styling.
    if (extraClass !== null) {
      // Extra class provided: append it to the base button class name.
      btn.className = `kdoc-window-button ${extraClass}`;
    } else {
      // No extra class: set base button class name only.
      btn.className = 'kdoc-window-button';
    }

    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.appendChild(createIcon(doc, icon, 16));

    btn.addEventListener('mousedown', (event: MouseEvent): void => {
      // Stop mousedown event propagation so top bar drag region does not trigger a window drag.
      event.stopPropagation();
    });

    return btn;
  }

  const minimise: HTMLButtonElement = makeButton('minimise', 'Minimise', null);
  const maximise: HTMLButtonElement = makeButton('maximise', 'Maximise', null);
  const close: HTMLButtonElement = makeButton('close', 'Close', 'is-close');

  element.appendChild(minimise);
  element.appendChild(maximise);
  element.appendChild(close);

  /**
   * Executes an asynchronous window operation and forwards any errors to options.onError.
   * @purpose Dispatches a window action promise without swallowing rejections.
   * @inputs operation - Function returning a Promise representing the window action.
   * @outputs void - No return value.
   * @dataflow operation Promise -> catch handler -> options.onError callback.
   * @controlflow Invoke operation -> handle Promise rejection by calling onError.
   */
  function run(operation: () => Promise<void>): void {
    operation().catch((error: unknown): void => {
      options.onError(error);
    });
  }

  minimise.addEventListener('click', (): void => {
    run((): Promise<void> => api.minimize());
  });

  close.addEventListener('click', (): void => {
    run((): Promise<void> => api.close());
  });

  maximise.addEventListener('click', (): void => {
    run(async (): Promise<void> => {
      await api.toggleMaximize();
      await refresh();
    });
  });

  /**
   * Queries window maximized state and updates the maximise/restore button UI accordingly.
   * @purpose Synchronizes maximise button icon, tooltip, and aria-label with the actual window state.
   * @inputs None.
   * @outputs Promise<void> - Resolves when button attributes and icon have been updated.
   * @dataflow api.isMaximized() -> boolean state -> DOM updates on maximise button.
   * @controlflow Check destroyed guard -> query isMaximized -> compute label and icon -> update button attributes and replace icon element.
   */
  async function refresh(): Promise<void> {
    // Check if controls have already been destroyed.
    if (destroyed) {
      // Controls destroyed: return early to avoid DOM mutations after teardown.
      return;
    } else {
      // Controls active: proceed with querying window state and updating button appearance.
    }

    const maximized: boolean = await api.isMaximized();

    // Evaluate if window is maximized: if true, set label to 'Restore'; if false, set label to 'Maximise'.
    const label: string = maximized ? 'Restore' : 'Maximise';
    maximise.setAttribute('aria-label', label);
    maximise.title = label;

    // Evaluate if window is maximized: if true, render 'restore' icon; if false, render 'maximise' icon.
    const iconName = maximized ? 'restore' : 'maximise';
    maximise.replaceChildren(createIcon(doc, iconName, 16));
  }

  let unlisten: (() => void) | null = null;

  api
    .onResized((): void => {
      refresh().catch((error: unknown): void => {
        options.onError(error);
      });
    })
    .then((u: () => void): void => {
      // Check if the component was destroyed while subscription was pending.
      if (destroyed) {
        // Subscribed after destroy: release the listener immediately.
        u();
      } else {
        // Still active: retain the unsubscribe callback for teardown.
        unlisten = u;
      }
    })
    .catch((error: unknown): void => {
      options.onError(error);
    });

  // Perform initial refresh to align button appearance with current window state.
  refresh().catch((error: unknown): void => {
    options.onError(error);
  });

  /**
   * Tears down window controls, unsubscribes from window events, and removes elements from the DOM.
   * @purpose Cleans up event listeners and DOM elements idempotently.
   * @inputs None.
   * @outputs void - No return value.
   * @dataflow Teardown signal -> unsubscribe callback invocation -> element removal.
   * @controlflow Guard destroyed state -> set destroyed flag -> invoke unlisten if present -> remove container element.
   */
  function destroy(): void {
    // Check if controls have already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Mark destroyed to prevent any further updates or event handling.
      destroyed = true;
    }

    // Check if an active resize unlisten callback exists.
    if (unlisten !== null) {
      // Active unlisten callback present: call it to detach the resize listener.
      unlisten();
      unlisten = null;
    } else {
      // No unlisten callback registered or pending.
    }

    element.remove();
  }

  return {
    element,
    destroy,
  };
}
