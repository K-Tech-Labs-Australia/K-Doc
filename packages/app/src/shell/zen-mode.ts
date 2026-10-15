/**
 * @file zen-mode.ts
 * @purpose Zen mode (FR-5.8): hides the application chrome (including the in-app menu bar) so only the editor panes show, makes the window full screen, shows a brief hint, and leaves on Escape or on the command again.
 * @inputs The document, a full-screen callback, an error callback, key events.
 * @outputs A controller (ZenMode), the kdoc-zen body class, ZEN_MODE_STYLES.
 * @functions
 *   - installZenMode: Creates and installs the Zen mode controller bound to the document.
 * @dataflow toggle -> body class + hint + setFullscreen; Escape -> exit.
 * @controlflow enter and exit do nothing when already in that state; Escape is left to open dialogs and to handlers that already used it.
 * @version 3
 * @date 2026-10-04
 */

/**
 * Configuration contract for installZenMode.
 * @purpose Supplies the document, a full-screen callback that asks the host window to go full screen or back, an error callback that reports a failure, and an optional hint duration in milliseconds (injectable for tests).
 * @inputs options object passed to installZenMode.
 * @outputs N/A — pure configuration interface with no behaviour.
 * @dataflow Options → installZenMode → controller methods.
 * @controlflow No control flow; plain data contract.
 */
export interface ZenModeOptions {
  readonly doc: Document;
  readonly setFullscreen: (fullscreen: boolean) => Promise<void>;
  readonly onError: (message: string) => void;
  readonly hintMs?: number;
}

/**
 * Controller returned by installZenMode.
 * @purpose Exposes the active state and enter/exit/toggle/destroy lifecycle methods for Zen mode.
 * @inputs N/A — produced by installZenMode and consumed by the shell command layer.
 * @outputs Controller object driving Zen mode behaviour.
 * @dataflow installZenMode → ZenMode controller → user commands and key events.
 * @controlflow No control flow; exposes a state getter and lifecycle methods.
 */
export interface ZenMode {
  readonly active: boolean;
  enter(): void;
  exit(): void;
  toggle(): void;
  destroy(): void;
}

/** Body class applied while in Zen mode to hide the chrome via ZEN_MODE_STYLES. */
export const ZEN_CLASS: string = 'kdoc-zen';

/** The hint shows for 2.5 seconds, long enough to read. */
const HINT_MS = 2500;

/**
 * Styles that hide Zen-mode chrome and position the transient hint.
 * @purpose Hides the toolbar, tabs, ribbon, format and table toolbars, breadcrumbs, both sidebars, status bar and key hint, leaving the panes and the find bar; the hint floats at the top centre and never takes clicks; uses theme tokens.
 * @inputs N/A — static stylesheet string consumed by the host to inject a <style> element.
 * @outputs N/A — plain CSS text.
 * @dataflow ZEN_MODE_STYLES → host style injection → DOM styling.
 * @controlflow No control flow; constant value.
 */
export const ZEN_MODE_STYLES: string = `
.${ZEN_CLASS} .kdoc-menu-bar, .${ZEN_CLASS} .kdoc-toolbar, .${ZEN_CLASS} .kdoc-tab-bar, .${ZEN_CLASS} .kdoc-ribbon,
. .${ZEN_CLASS} .kdoc-breadcrumbs, .${ZEN_CLASS} .kdoc-sidebar, .${ZEN_CLASS} .kdoc-status,
.${ZEN_CLASS} .kdoc-key-hint { display: none !important; }
.kdoc-zen-hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 6px 14px;
  border-radius: var(--kdoc-radius-pill);
  background: var(--kdoc-chrome-glass-tint);
  border: 1px solid var(--kdoc-chrome-glass-edge);
  color: var(--kdoc-chrome-text-muted);
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  font-size: 13px;
  pointer-events: none;
}
`;

/**
 * Creates and installs the Zen mode controller.
 * @purpose Injects a transient hint element into the document, wires an Escape key handler that leaves Zen mode, and returns a controller to enter/exit/toggle/destroy it.
 * @inputs options — ZenModeOptions providing doc, setFullscreen, onError, and optional hintMs.
 * @outputs A ZenMode controller bound to the given document.
 * @dataflow Options → local state (active, hintTimer, hint) → returned controller; keydown events on doc → onKeydown → exit.
 * @controlflow Build hint element and append to body; register keydown listener; return controller object with getter and methods.
 */
export function installZenMode(options: ZenModeOptions): ZenMode {
  const { doc } = options;
  let active = false;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  const hint = doc.createElement('div');
  hint.className = 'kdoc-zen-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = 'Zen mode. Press Esc to leave.';
  hint.hidden = true;
  doc.body.append(hint);

  /**
   * Requests full screen (or exits it) via the callback, reporting any failure through onError while leaving chrome hidden.
   * @purpose Delegates the actual full-screen transition to setFullscreen and surfaces rejections without breaking Zen mode.
   * @inputs fullscreen — boolean, true to enter full screen, false to leave it.
   * @outputs N/A — returns void; errors surfaced via onError.
   * @dataflow fullscreen flag → setFullscreen promise → .catch → onError message.
   * @controlflow Call setFullscreen; on rejection build an error message and call onError.
   */
  function applyFullscreen(fullscreen: boolean): void {
    options.setFullscreen(fullscreen).catch((error: unknown) => {
      options.onError(`Could not ${fullscreen ? 'enter' : 'leave'} full screen: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Clears any pending hint timer so an old one cannot hide a newer hint, then hides the hint element.
   * @purpose Prevents a stale auto-hide from reappearing after a fresh hint was shown.
   * @inputs N/A — operates on closure state (hintTimer, hint).
   * @outputs N/A — returns void.
   * @dataflow Pending timer → cleared; hint.hidden set to true.
   * @controlflow If a timer is pending clear it and null the handle; always set hint hidden.
   */
  function hideHint(): void {
    // A timer is scheduled: cancel it so an old auto-hide cannot override the newer state.
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
      hintTimer = null;
    } else {
      // No pending timer: nothing to cancel, fall through to hiding the hint below.
    }
    hint.hidden = true;
  }

  /**
   * Enters Zen mode by adding the body class, showing the hint (because the status bar that normally carries messages is hidden), scheduling the auto-hide, and requesting full screen.
   * @purpose Activates Zen mode and surfaces a brief user cue since the status bar is hidden.
   * @inputs N/A — operates on closure state.
   * @outputs N/A — returns void.
   * @dataflow active flag → body class + hint + setFullscreen(true).
   * @controlflow Return early when already active; otherwise set active true, add class, show and schedule hint, request full screen.
   */
  function enter(): void {
    // Already in Zen mode: nothing to do.
    if (active) {
      return;
    } else {
      // Not yet active: proceed with the transition below.
    }
    active = true;
    doc.body.classList.add(ZEN_CLASS);
    hideHint();
    hint.hidden = false;
    hintTimer = setTimeout(hideHint, options.hintMs ?? HINT_MS);
    applyFullscreen(true);
  }

  /**
   * Leaves Zen mode by removing the body class, hiding the hint, and requesting exit from full screen.
   * @purpose Deactivates Zen mode and restores chrome visibility.
   * @inputs N/A — operates on closure state.
   * @outputs N/A — returns void.
   * @dataflow active flag → body class removal + setFullscreen(false).
   * @controlflow Return early when not active; otherwise set active false, remove class, hide hint, request exit.
   */
  function exit(): void {
    // Not in Zen mode: nothing to do.
    if (!active) {
      return;
    } else {
      // Currently active: proceed with the transition below.
    }
    active = false;
    doc.body.classList.remove(ZEN_CLASS);
    hideHint();
    applyFullscreen(false);
  }

  /**
   * Handles Escape to leave Zen mode, deferring to open dialogs and handlers that already consumed the key.
   * @purpose Exits Zen mode on Escape unless another handler or an open dialog owns it.
   * @inputs event — KeyboardEvent seen by the document in the capture phase, before the editors.
   * @outputs N/A — returns void; may call preventDefault/exit.
   * @dataflow Keydown event → condition check → exit() or nothing.
   * @controlflow If active and Escape and not defaultPrevented and no open dialog or find bar, prevent default and exit; otherwise do nothing.
   */
  function onKeydown(event: KeyboardEvent): void {
    // Exit only when Zen is active, the key is Escape, nothing consumed it, and no dialog or open find bar needs Escape to close.
    // Capture phase: the editors use Escape themselves (K-Doc selects the parent node) and would otherwise keep it from Zen.
    if (active && event.key === 'Escape' && !event.defaultPrevented && doc.querySelector('dialog[open], .kdoc-find-bar:not([hidden])') === null) {
      event.preventDefault();
      exit();
    } else {
      // Not an actionable Escape: leave dialogs and other handlers to handle it.
    }
  }

  doc.addEventListener('keydown', onKeydown, true);

  return {
    get active(): boolean {
      return active;
    },
    enter,
    exit,
    /**
     * The command enters or leaves Zen mode depending on the current state.
     * @purpose Toggles Zen mode as invoked by the shell command.
     * @inputs N/A — operates on closure state.
     * @outputs N/A — returns void.
     * @dataflow active flag → exit() or enter().
     * @controlflow If active, exit; otherwise enter.
     */
    toggle(): void {
      // Currently in Zen mode: leave it.
      if (active) {
        exit();
      } else {
        // Not in Zen mode: enter it.
        enter();
      }
    },
    /**
     * Leaves Zen so a torn-down shell does not stay full screen, then removes the listener and the hint.
     * @purpose Tears down all Zen-mode side effects on destruction.
     * @inputs N/A — operates on closure state.
     * @outputs N/A — returns void.
     * @dataflow exit() → removeEventListener → hint.remove().
     * @controlflow Call exit, remove keydown listener, remove hint element.
     */
    destroy(): void {
      exit();
      doc.removeEventListener('keydown', onKeydown, true);
      hint.remove();
    },
  };
}
