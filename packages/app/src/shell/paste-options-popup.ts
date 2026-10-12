/**
 * @file paste-options-popup.ts
 * @purpose Implements PasteOptionsPopup, an accessible floating toolbar appearing after paste operations offering quick mode switches (FR-7.4).
 * @inputs PasteOptionsPopupOptions containing Document, Window context, onChoose, and onMore callbacks.
 * @outputs PasteOptionsPopup controller instance exposing showAt, hide, isOpen, and destroy lifecycle methods, alongside PASTE_OPTIONS_STYLES CSS stylesheet definition.
 * @functions
 *   - installPasteOptionsPopup: Constructs, styles, and mounts the floating paste options toolbar on doc.body, wires mode buttons, mousedown focus protection, and outside dismissal.
 *   - getPopupModeMetadata: Resolves the button label glyph and full title string for each supported paste mode.
 * @dataflow showAt(x, y, available, current) -> render mode buttons & more button -> position and clamp -> onChoose(mode) / onMore() -> hide().
 * @controlflow Mount hidden toolbar to document body -> showAt populates available modes, clamps to viewport, schedules outside-click/keydown listeners -> interaction triggers callback and hides popup.
 * @version 3
 * @date 2026-10-04
 */

import type { PasteMode } from '@k-doc/editor';

export interface PasteOptionsPopupOptions {
  readonly doc: Document;
  readonly win: Window;
  /** The user picked a different reading of the same clipboard. */
  readonly onChoose: (mode: PasteMode) => void;
  /** The user asked for the full dialog instead. */
  readonly onMore: () => void;
}

export interface PasteOptionsPopup {
  /** Shows the control at the given viewport point, offering only `available`. */
  showAt(x: number, y: number, available: readonly PasteMode[], current: PasteMode): void;
  hide(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * Static stylesheet for the post-paste quick options popup toolbar using exclusively authoritative K-Doc design tokens.
 */
export const PASTE_OPTIONS_STYLES: string = `
.kdoc-paste-popup {
  position: absolute;
  z-index: 1000;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  box-sizing: border-box;
  user-select: none;
}

.kdoc-paste-popup[hidden] {
  display: none;
}

.kdoc-paste-popup-button,
.kdoc-paste-popup-more {
  width: 26px;
  height: 26px;
  min-width: 26px;
  min-height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  font-family: monospace, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: var(--kdoc-elevation-raised);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-paste-popup-button:hover,
.kdoc-paste-popup-more:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-paste-popup-button:active,
.kdoc-paste-popup-more:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-paste-popup-button:focus-visible,
.kdoc-paste-popup-more:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-paste-popup-button.kdoc-paste-popup-button-current {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  color: var(--kdoc-chrome-on-selected);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
}

.kdoc-paste-popup-button.kdoc-paste-popup-button-current:hover {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  box-shadow: none;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-paste-popup,
  .kdoc-paste-popup * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Ordered paste modes supported by the popup. */
const ORDERED_POPUP_MODES: readonly PasteMode[] = ['plain', 'markdown', 'html', 'table'];

/** Metadata descriptor for popup button representation. */
interface PopupModeMetadata {
  readonly label: string;
  readonly title: string;
}

/**
 * Resolves the visual single-character label and full display title for a paste mode button in the popup.
 *
 * @purpose Returns button label glyph and full title string for a given paste mode.
 * @inputs mode - PasteMode value.
 * @outputs PopupModeMetadata - Object containing label and title strings.
 * @dataflow mode -> branching inspection -> label and title.
 * @controlflow Inspect mode -> return label and title for plain, markdown, html, or table.
 */
function getPopupModeMetadata(mode: PasteMode): PopupModeMetadata {
  // Check if mode is plain text.
  if (mode === 'plain') {
    // Mode is plain: return label 'A' and title 'Unformatted Text'.
    return {
      label: 'A',
      title: 'Unformatted Text',
    };
  } else if (mode === 'markdown') {
    // Check if mode is markdown.
    // Mode is markdown: return label 'M' and title 'Markdown'.
    return {
      label: 'M',
      title: 'Markdown',
    };
  } else if (mode === 'html') {
    // Check if mode is html.
    // Mode is html: return label 'H' and title 'Formatted (HTML)'.
    return {
      label: 'H',
      title: 'Formatted (HTML)',
    };
  } else {
    // Mode is table: return label '⊞' and title 'Table'.
    return {
      label: '⊞',
      title: 'Table',
    };
  }
}

/**
 * Installs the floating paste options popup toolbar into the document body, wiring mode options and auto-dismiss listeners.
 *
 * @purpose Constructs, styles, and mounts an absolutely-positioned toolbar for switching paste readings without opening a modal dialog.
 * @inputs options - PasteOptionsPopupOptions containing Document, Window context, onChoose, and onMore callbacks.
 * @outputs PasteOptionsPopup - Controller exposing showAt, hide, isOpen, and destroy lifecycle methods.
 * @dataflow options -> popup DOM element -> showAt -> user selection or outside interaction -> onChoose/onMore/hide.
 * @controlflow Construct toolbar div -> bind mousedown preventDefault -> append to doc.body -> configure showAt, hide, and destroy methods -> return PasteOptionsPopup controller.
 */
export function installPasteOptionsPopup(options: PasteOptionsPopupOptions): PasteOptionsPopup {
  const doc = options.doc;
  const win = options.win;

  let destroyed: boolean = false;
  let open: boolean = false;
  let dismissTimeoutId: ReturnType<typeof win.setTimeout> | null = null;

  // Construct floating toolbar container on document body.
  const popupEl = doc.createElement('div');
  popupEl.className = 'kdoc-paste-popup';
  popupEl.setAttribute('role', 'toolbar');
  popupEl.setAttribute('aria-label', 'Paste options');
  popupEl.hidden = true;

  // mousedown calls preventDefault() so the editor keeps focus and the caret stays where the paste left it.
  popupEl.addEventListener('mousedown', (event: MouseEvent): void => {
    event.preventDefault();
  });

  doc.body.appendChild(popupEl);

  /**
   * Outside mousedown listener dismissing the popup when the user clicks elsewhere.
   *
   * @purpose Detects outside pointer clicks and hides the popup without disrupting host editor focus.
   * @inputs event - MouseEvent captured on document.
   * @outputs void.
   * @dataflow event.target -> contains check -> hide().
   * @controlflow Check active state -> inspect event.target -> if outside popupEl, invoke hide().
   */
  function onDocMouseDown(event: MouseEvent): void {
    // Check if component has been destroyed or popup is not currently open.
    if (destroyed || !open) {
      // Inactive: ignore event.
      return;
    } else {
      // Active and open.
    }

    // Check if the interaction target is outside the popup element.
    if (event.target instanceof Node && !popupEl.contains(event.target)) {
      // Click occurred outside popup: hide popup.
      // A paste-options control that lingers is a control that ends up over the next paragraph the user types.
      hide();
    } else {
      // Click occurred inside popup: handled by button click listeners.
    }
  }

  /**
   * Keydown listener dismissing the popup on any keyboard interaction.
   *
   * @purpose Dismisses popup on typing or Escape, ensuring caret typing continues unimpeded.
   * @inputs event - KeyboardEvent captured on document.
   * @outputs void.
   * @dataflow event.key -> hide().
   * @controlflow Check active state -> if Escape preventDefault and hide; otherwise hide without preventDefault.
   */
  function onDocKeyDown(event: KeyboardEvent): void {
    // Check if component has been destroyed or popup is not currently open.
    if (destroyed || !open) {
      // Inactive: ignore event.
      return;
    } else {
      // Active and open.
    }

    // Check if the pressed key is Escape.
    if (event.key === 'Escape') {
      // Escape hides it without choosing.
      event.preventDefault();
      hide();
    } else {
      // A keydown anywhere else hides the popup without preventing default typing behavior.
      // A paste-options control that lingers is a control that ends up over the next paragraph the user types.
      hide();
    }
  }

  /**
   * Hides the paste options popup toolbar and cleans up active dismiss listeners.
   *
   * @purpose Conceals the toolbar and detaches document pointer and keyboard event listeners in an idempotent manner.
   * @inputs void.
   * @outputs void.
   * @dataflow open = false -> popupEl.hidden = true -> remove doc listeners.
   * @controlflow Check destroyed guard -> clear pending timeout -> detach listeners -> hide element.
   */
  function hide(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort hide.
      return;
    } else {
      // Active component.
    }

    // Clear any pending dismiss listener timeout.
    if (dismissTimeoutId !== null) {
      win.clearTimeout(dismissTimeoutId);
      dismissTimeoutId = null;
    } else {
      // No pending timeout.
    }

    doc.removeEventListener('mousedown', onDocMouseDown);
    doc.removeEventListener('keydown', onDocKeyDown);

    // Check if popup is currently open.
    if (open) {
      open = false;
      popupEl.hidden = true;
    } else {
      // Already hidden.
    }
  }

  /**
   * Displays the paste options popup at the given viewport coordinates, offering available modes.
   *
   * @purpose Populates available mode buttons, clamps position to viewport boundaries, and schedules auto-dismissal.
   * @inputs
   *   - x: number - Viewport horizontal coordinate.
   *   - y: number - Viewport vertical coordinate.
   *   - available: readonly PasteMode[] - Paste modes satisfiable by the current clipboard.
   *   - current: PasteMode - The mode already applied to the document.
   * @outputs void.
   * @dataflow (x, y, available, current) -> build DOM buttons -> clamp coordinates -> attach outside listeners.
   * @controlflow Clear old buttons -> construct buttons for available modes -> construct more button -> unhide -> clamp coordinates -> schedule dismiss listeners.
   */
  function showAt(x: number, y: number, available: readonly PasteMode[], current: PasteMode): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort showAt.
      return;
    } else {
      // Active component: proceed with displaying popup.
    }

    // Clear any previous child buttons from the popup toolbar.
    while (popupEl.firstChild !== null) {
      popupEl.removeChild(popupEl.firstChild);
    }

    // Construct button for each available mode.
    for (let i = 0; i < ORDERED_POPUP_MODES.length; i++) {
      const mode = ORDERED_POPUP_MODES[i];
      // Check if mode is defined under strict index narrowing.
      if (mode === undefined) {
        // Skip undefined mode.
        continue;
      } else {
        // Valid mode.
      }

      // Check whether this mode is in the available modes list.
      if (available.includes(mode)) {
        const meta = getPopupModeMetadata(mode);
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'kdoc-paste-popup-button';
        button.setAttribute('data-paste-mode', mode);
        button.title = meta.title;
        button.setAttribute('aria-label', meta.title);
        // Comment that the labels are short because the control sits over the document and a wide one would hide the very text the user is deciding about.
        button.textContent = meta.label;

        // Check whether this mode is the one already applied to the document.
        if (mode === current) {
          button.classList.add('kdoc-paste-popup-button-current');
          button.setAttribute('aria-pressed', 'true');
        } else {
          button.setAttribute('aria-pressed', 'false');
        }

        button.addEventListener('click', (): void => {
          // Check if component has been destroyed or popup is not currently open.
          if (destroyed || !open) {
            // Inactive: ignore click.
            return;
          } else {
            // Active: notify choose and hide popup.
            options.onChoose(mode);
            hide();
          }
        });

        popupEl.appendChild(button);
      } else {
        // Mode is not available on clipboard: omit from popup.
      }
    }

    // Construct final button (...) to request the full Paste Special dialog instead.
    const moreButton = doc.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'kdoc-paste-popup-more';
    moreButton.title = 'Paste Special…';
    moreButton.setAttribute('aria-label', 'Paste Special…');
    moreButton.textContent = '…';
    moreButton.addEventListener('click', (): void => {
      // Check if component has been destroyed or popup is not currently open.
      if (destroyed || !open) {
        // Inactive: ignore click.
        return;
      } else {
        // Active: notify more callback and hide popup.
        options.onMore();
        hide();
      }
    });
    popupEl.appendChild(moreButton);

    // Unhide before measuring element dimensions.
    popupEl.hidden = false;
    open = true;

    const popupWidth = popupEl.offsetWidth;
    const popupHeight = popupEl.offsetHeight;
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;

    let clampedX = x;
    let clampedY = y;

    // Check if popup extends past the right viewport boundary.
    if (clampedX + popupWidth > viewportWidth) {
      // Shift left to fit inside viewport.
      clampedX = viewportWidth - popupWidth;
    } else {
      // Fits horizontally within viewport.
    }

    // Check if horizontal coordinate shifted below zero.
    if (clampedX < 0) {
      // Clamp to zero to keep popup on screen.
      clampedX = 0;
    } else {
      // Coordinate is within horizontal screen boundary.
    }

    // Check if popup extends past the bottom viewport boundary.
    if (clampedY + popupHeight > viewportHeight) {
      // Shift up to fit inside viewport.
      clampedY = viewportHeight - popupHeight;
    } else {
      // Fits vertically within viewport.
    }

    // Check if vertical coordinate shifted below zero.
    if (clampedY < 0) {
      // Clamp to zero to keep popup on screen.
      clampedY = 0;
    } else {
      // Coordinate is within vertical screen boundary.
    }

    popupEl.style.left = `${clampedX}px`;
    popupEl.style.top = `${clampedY}px`;

    // Clear any pending dismiss registration timeout.
    if (dismissTimeoutId !== null) {
      win.clearTimeout(dismissTimeoutId);
      dismissTimeoutId = null;
    } else {
      // No existing timeout.
    }

    doc.removeEventListener('mousedown', onDocMouseDown);
    doc.removeEventListener('keydown', onDocKeyDown);

    // It hides itself on the next interaction that is not it: a keydown anywhere, or a mousedown outside it.
    // Attach both inside a win.setTimeout(..., 0) when shown and remove them on hide, the way list-picker.ts manages its outside click.
    // A paste-options control that lingers is a control that ends up over the next paragraph the user types.
    dismissTimeoutId = win.setTimeout((): void => {
      dismissTimeoutId = null;
      // Check if component has been destroyed or popup was hidden before timeout executed.
      if (destroyed || !open) {
        // Destroyed or closed: do not attach dismiss listeners.
        return;
      } else {
        // Active and open: attach interaction listeners.
        doc.addEventListener('mousedown', onDocMouseDown);
        doc.addEventListener('keydown', onDocKeyDown);
      }
    }, 0);
  }

  /**
   * Tears down the paste options popup component, detaching listeners and removing DOM elements.
   *
   * @purpose Idempotently cleans up event listeners, hides the toolbar, and removes the DOM element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow hide() -> popupEl.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> hide popup -> remove element from document body.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: proceed with teardown.
      destroyed = true;
    }

    hide();
    popupEl.remove();
  }

  return {
    showAt,
    hide,
    /**
     * @purpose Returns boolean indicating whether the paste options popup is currently visible.
     * @inputs void.
     * @outputs boolean - True if the popup is open and component is not destroyed; false otherwise.
     * @dataflow open -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed; otherwise return open flag.
     */
    get isOpen(): boolean {
      // Check if component has been destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else {
        // Return live open status of the popup toolbar.
        return open;
      }
    },
    destroy,
  };
}
