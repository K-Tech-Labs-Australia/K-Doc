/**
 * @file key-hint.ts
 * @purpose Implements a dismissible, auto-expiring inline status hint (the "key hint") shown when a Word shortcut K-Doc leaves unbound is pressed, satisfying FR-20.1. It builds a small DOM node with a message and a Dismiss button, shows it for a bounded time, and tears itself down cleanly.
 * @inputs KeyHintOptions: the owning Document, the container element to append into, plus the exported KEY_HINT_STYLES and KEY_HINT_TIMEOUT_MS constants.
 * @outputs A KeyHint handle exposing element, show(), hide(), isShown, and destroy().
 * @functions
 *   - installKeyHint: Constructs the hint DOM subtree, wires dismissal, and returns a lifecycle handle.
 *   - clearTimer: Cancels any pending auto-hide timer so a later show() re-arms cleanly.
 *   - hide: Clears the message text and hides the element immediately.
 *   - show: Renders a message, makes the element visible, and schedules auto-hide.
 * @dataflow installKeyHint options → created div/span/button subtree appended to container; returned KeyHint handle exposes methods over that subtree; messages flow into show() → text node while timers drive auto-hide via clearTimer/hide.
 * @controlflow Resolve doc/window → create elements → append to container → bind dismiss click → return handle; show() renders and arms a timeout, hide()/clearTimer()/destroy() unwind state and remove the element, all teardown guarded by a destroyed flag.
 * @version 3
 * @date 2026-10-04
 */

/** Options controlling where the key hint is mounted and which Document owns it. */
export interface KeyHintOptions {
  /** The owning Document used to create every node, so the hint works across iframes and Shadow DOM. */
  readonly doc: Document;
  /** The container element into which the hint node is appended. */
  readonly container: HTMLElement;
}

/** Public lifecycle handle returned by installKeyHint(). */
export interface KeyHint {
  /** The root <div> of the hint, already mounted inside the container. */
  readonly element: HTMLElement;
  /** Renders a message and schedules auto-hide after KEY_HINT_TIMEOUT_MS. */
  show(message: string): void;
  /** Clears the message text and hides the element immediately. */
  hide(): void;
  /** Whether the hint is currently visible (i.e. not hidden). */
  readonly isShown: boolean;
  /** Permanently removes the element, unbinds listeners, and cancels timers. */
  destroy(): void;
}

/** How long a hint stays before it goes by itself, in milliseconds. Dismissing it is always available sooner. */
export const KEY_HINT_TIMEOUT_MS: number = 8000;

/**
 * CSS rules for the key hint, scoped with the kdoc- prefix and using only authoritative Material 3 Expressive design tokens.
 * These are exported for external injection into a stylesheet; installKeyHint() does not inject them itself.
 */
export const KEY_HINT_STYLES: string = `
.kdoc-key-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
  background: transparent;
  color: var(--kdoc-chrome-text);
  box-shadow: none;
  font-size: 12px;
  border: 1px solid var(--kdoc-chrome-edge);
}

.kdoc-key-hint[hidden] {
  display: none;
}

.kdoc-key-hint-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.kdoc-key-hint-dismiss {
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  box-shadow: none;
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.kdoc-key-hint-dismiss:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
  border-color: var(--kdoc-chrome-accent);
  box-shadow: none;
}

.kdoc-key-hint-dismiss:focus-visible {
  outline: none;
  border-color: var(--kdoc-chrome-accent);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-key-hint-dismiss:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  box-shadow: none;
  transform: translateY(1px);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-key-hint-dismiss {
    transition: none;
  }
}
`;

/**
 * Builds and mounts a dismissible key hint, returning a handle to show, hide, or destroy it.
 * @purpose Creates the hint DOM subtree, wires the Dismiss button click handler, and returns a KeyHint handle over that subtree.
 * @inputs options - KeyHintOptions describing the owning Document and the mount container.
 * @outputs A KeyHint handle exposing element, show(), hide(), isShown, and destroy().
 * @dataflow options.doc creates nodes; options.container receives the appended subtree; the returned handle exposes methods operating on that subtree.
 * @controlflow Resolve doc/window → create div/span/button → set attributes → append to container → bind dismiss click → return handle; every teardown path checks the destroyed flag before acting.
 */
export function installKeyHint(options: KeyHintOptions): KeyHint {
  const doc = options.doc;
  const win = doc.defaultView ?? globalThis;

  const element = doc.createElement('div');
  element.className = 'kdoc-key-hint';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;

  const text = doc.createElement('span');
  text.className = 'kdoc-key-hint-text';

  const dismiss = doc.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'kdoc-key-hint-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss this explanation');

  element.append(text, dismiss);
  options.container.append(element);

  let timer: ReturnType<typeof win.setTimeout> | null = null;
  let destroyed = false;

  /**
   * Cancels any pending auto-hide timer so a later show() re-arms without firing hide() on stale state.
   * @purpose Clears the scheduled timeout and resets the module-local handle to null.
   * @inputs None.
   * @outputs void.
   * @dataflow Reads module-local timer → win.clearTimeout(timer) → sets timer back to null.
   * @controlflow If a timer exists, cancel it; else no-op (documented empty branch).
   */
  function clearTimer(): void {
    // If a pending timeout exists, cancel it so show() can re-arm cleanly.
    if (timer !== null) {
      // Timeout scheduled from a previous show(): stop it and reset the handle.
      win.clearTimeout(timer);
      timer = null;
    } else {
      // No pending timeout: nothing to cancel, leave timer as null.
    }
  }

  /**
   * Hides the hint immediately and clears any message text.
   * @purpose Marks the element hidden, empties the message, and cancels the auto-hide timer.
   * @inputs None.
   * @outputs void.
   * @dataflow clearTimer() → sets element.hidden true → empties text.textContent.
   * @controlflow Cancel timer → hide element → clear text; runs unconditionally.
   */
  function hide(): void {
    clearTimer();
    element.hidden = true;
    text.textContent = '';
  }

  /**
   * Renders a message on the hint and schedules auto-hide after KEY_HINT_TIMEOUT_MS.
   * @purpose Displays the given message, makes the element visible, and arms the timeout that calls hide().
   * @inputs message - The explanation string to display as both text content and title tooltip.
   * @outputs void.
   * @dataflow message → text.textContent and text.title → element.hidden false → win.setTimeout schedules hide().
   * @controlflow If destroyed, bail; else clear prior timer, render message, show element, arm timeout.
   */
  function show(message: string): void {
    // If the component has already been destroyed, ignore any further show() calls.
    if (destroyed) {
      // Already torn down and removed from the DOM: do not resurrect it.
    } else {
      // Active lifecycle: clear prior timer, render message, show element, arm auto-hide.
      clearTimer();
      text.textContent = message;
      text.title = message;
      element.hidden = false;

      // Auto-hide callback: once KEY_HINT_TIMEOUT_MS elapses, reset the handle and hide the hint.
      // @purpose Cancels the pending timer reference and hides the hint after its timeout window.
      // @inputs None.
      // @outputs void.
      // @dataflow win.setTimeout fires → sets module-local timer to null → calls hide().
      // @controlflow Unconditional single-shot: runs exactly once when the scheduled timeout elapses.
      timer = win.setTimeout(() => {
        timer = null;
        hide();
      }, KEY_HINT_TIMEOUT_MS);
    }
  }

  // Dismiss button closes the hint immediately on user action via hide().
  dismiss.addEventListener('click', hide);

  return {
    element,
    show,
    hide,
    /**
     * Reports whether the hint is currently visible.
     * @purpose Returns true when the element has not been hidden.
     * @inputs None.
     * @outputs boolean - True if the hint is shown, false otherwise.
     * @dataflow Reads element.hidden → returns its logical negation.
     * @controlflow Single read of element.hidden; no branching.
     */
    get isShown(): boolean {
      // The hint is shown exactly when it has not been hidden.
      return !element.hidden;
    },
    /**
     * Permanently removes the hint, unbinds listeners, and cancels timers.
     * @purpose Tears down all state so the handle cannot be used again.
     * @inputs None.
     * @outputs void.
     * @dataflow destroyed flag → clearTimer() → remove click listener → element.remove().
     * @controlflow If already destroyed, bail; else mark destroyed, cancel timer, unbind listener, and remove the node.
     */
    destroy(): void {
      // If already destroyed, ignore a second destroy() call.
      if (destroyed) {
        // Already torn down: nothing left to clean up.
      } else {
        // First teardown: mark done, cancel timer, unbind listener, remove node.
        destroyed = true;
        clearTimer();
        dismiss.removeEventListener('click', hide);
        element.remove();
      }
    },
  };
}