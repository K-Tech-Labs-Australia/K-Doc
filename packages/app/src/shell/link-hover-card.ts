/**
 * @file link-hover-card.ts — renders a tooltip card when the pointer rests on a link in the WYSIWYG pane.
 * @purpose Shows where a hovered link goes, describing its destination and offering an Open action.
 * @inputs DOM doc/win/pane plus describe(href) and follow(href) callbacks supplied via options.
 * @outputs A LinkHoverCard handle exposing isOpen, hide, and destroy.
 * @functions installLinkHoverCard — wires hover/follow listeners and returns the card handle.
 * @dataflow mouseover target → anchorFrom → describe → card text and position on screen.
 * @controlflow Schedule show after delay → render and position → hide on leave/scroll/Escape.
 * @version 3
 * @date 2026-10-04
 */

export interface LinkCardContent {
  readonly title: string;
  readonly detail: string;
  readonly followable: boolean;
}
export interface LinkHoverCardOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly pane: HTMLElement;
  readonly describe: (href: string) => LinkCardContent;
  readonly follow: (href: string) => void;
}
export interface LinkHoverCard {
  readonly isOpen: boolean;
  hide(): void;
  destroy(): void;
}

export const HOVER_DELAY_MS: number = 350;
export const HIDE_GRACE_MS: number = 200;

export const LINK_HOVER_CARD_STYLES: string = `
.kdoc-link-card {
  position: absolute;
  z-index: 1000;
  max-width: 360px;
  min-width: 180px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  font-size: 13px;
}

.kdoc-link-card[hidden] {
  display: none;
}

.kdoc-link-card-title {
  font-weight: 600;
  color: var(--kdoc-chrome-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.kdoc-link-card-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.kdoc-link-card-actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.kdoc-link-card-actions[hidden] {
  display: none;
}

.kdoc-link-card-hint {
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kdoc-link-card-open {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  box-shadow: var(--kdoc-elevation-raised);
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-link-card-open:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-link-card-open:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-link-card-open:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-link-card,
  .kdoc-link-card * {
    transition: none !important;
    animation: none !important;
  }
}
`;

export function installLinkHoverCard(options: LinkHoverCardOptions): LinkHoverCard {
  const { doc, win, pane } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  let destroyed = false;
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let pending: Element | null = null;
  let current: Element | null = null;
  let currentHref: string | null = null;

  const root = doc.createElement('div');
  root.className = 'kdoc-link-card';
  root.setAttribute('role', 'tooltip');
  root.hidden = true;
  const title = doc.createElement('div');
  title.className = 'kdoc-link-card-title';
  const detail = doc.createElement('div');
  detail.className = 'kdoc-link-card-detail';
  const actions = doc.createElement('div');
  actions.className = 'kdoc-link-card-actions';
  const hint = doc.createElement('span');
  hint.className = 'kdoc-link-card-hint';
  hint.textContent = 'Ctrl+Click to follow';
  const openButton = doc.createElement('button');
  openButton.type = 'button';
  openButton.className = 'kdoc-link-card-open';
  openButton.textContent = 'Open';
  actions.appendChild(hint);
  actions.appendChild(openButton);
  root.appendChild(title);
  root.appendChild(detail);
  root.appendChild(actions);
  doc.body.appendChild(root);

  // Resolve the event target to an element, using parentElement for text nodes.
  function anchorFrom(target: EventTarget | null): Element | null {
    if (target instanceof Node) {
      // A Node that is not itself an element resolves via its parent element.
      const el = target instanceof Element ? target : target.parentElement;
      if (el === null) {
        // No enclosing element, so no anchor can be found.
        return null;
      } else {
        // Walk up to the nearest link and confirm it lives inside the pane.
        const anchor = el.closest('a[href]');
        if (anchor !== null && pane.contains(anchor)) {
          return anchor;
        } else {
          // Either not a link or outside the pane, so reject it.
          return null;
        }
      }
    } else {
      // Target is not a DOM node, so no anchor can be found.
      return null;
    }
  }

  // Cancel any pending hover-show timer to avoid showing a stale card.
  function clearShow(): void {
    if (showTimer !== null) {
      win.clearTimeout(showTimer);
      showTimer = null;
      pending = null;
    } else {
      // Nothing scheduled, so just clear the pending anchor reference.
      pending = null;
    }
  }

  // Cancel any pending hide timer so the card stays visible.
  function clearHide(): void {
    if (hideTimer !== null) {
      win.clearTimeout(hideTimer);
      hideTimer = null;
    } else {
      // No timer to cancel, leaving state untouched.
    }
  }

  // Cancel timers and reset state so the card disappears immediately.
  function hide(): void {
    clearShow();
    clearHide();
    root.hidden = true;
    current = null;
    currentHref = null;
  }

  // Defer hiding to give the pointer a brief grace period before disappearing.
  function scheduleHide(): void {
    clearHide();
    hideTimer = win.setTimeout(hide, HIDE_GRACE_MS);
  }

  // Build card content from the anchor href and render it at the anchor's location.
  function show(anchor: Element): void {
    const href = anchor.getAttribute('href') ?? '';
    const content = options.describe(href);
    title.textContent = content.title;
    detail.textContent = content.detail;
    actions.hidden = !content.followable;
    current = anchor;
    currentHref = href;
    pending = null;
    showTimer = null;
    root.hidden = false;
    // Position the card just below the anchor, flipping above if it would overflow.
    const r = anchor.getBoundingClientRect();
    const c = root.getBoundingClientRect();
    let top = r.bottom + win.scrollY + 6;
    if (r.bottom + 6 + c.height > win.innerHeight) {
      // Card would clip below the viewport, so place it above the anchor instead.
      top = r.top + win.scrollY - c.height - 6;
    } else {
      // Fits below the anchor, leaving the default computed position.
    }
    // Clamp horizontal position within the viewport, pinning to edges when tight.
    const maxLeft = win.innerWidth - c.width - 8;
    const left = maxLeft < 8 ? 8 : Math.min(Math.max(r.left + win.scrollX, 8), maxLeft);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  pane.addEventListener('mouseover', (event: Event): void => {
    // Resolve the hovered element to a link inside the pane, ignoring unrelated targets.
    const anchor = anchorFrom(event.target);
    if (anchor === null) {
      // Target is not a pane link, so ignore the hover.
      return;
    } else {
      // Cancel any pending hide before evaluating whether to re-show.
      clearHide();
      if (anchor === current && !root.hidden) {
        // Same anchor already shown, so nothing to do.
        return;
      } else {
        // Schedule the card after the hover delay, tracking the pending anchor.
        clearShow();
        pending = anchor;
        showTimer = win.setTimeout(() => show(anchor), HOVER_DELAY_MS);
      }
    }
  }, { signal });

  pane.addEventListener('mouseout', (event: Event): void => {
    // Track where the pointer leaves to avoid hiding when moving into the card.
    const to = (event as MouseEvent).relatedTarget;
    if (to instanceof Node && (root.contains(to) || (current !== null && current.contains(to)) || (pending !== null && pending.contains(to)))) {
      // Pointer moved onto the card or a still-pending anchor, so keep it visible.
      return;
    } else {
      // Cancel any pending show before deciding to hide.
      clearShow();
      if (!root.hidden) {
        // Card is visible, so schedule a graceful hide.
        scheduleHide();
      } else {
        // Card already hidden, leaving state untouched.
      }
    }
  }, { signal });

  root.addEventListener('mouseenter', (): void => {
    // Pointer entered the card, so cancel any pending hide.
    clearHide();
  }, { signal });

  root.addEventListener('mouseleave', (): void => {
    // Pointer left the card, so schedule a graceful hide.
    scheduleHide();
  }, { signal });

  openButton.addEventListener('mousedown', (event: Event): void => {
    // Prevent focus loss from the editor when activating the Open button.
    event.preventDefault();
  }, { signal });

  openButton.addEventListener('click', (): void => {
    // Follow the current link, hiding the card first and ignoring clicks with no href.
    const href = currentHref;
    hide();
    if (href !== null) {
      // A link is currently shown, so hand its href to the follow callback.
      options.follow(href);
    } else {
      // No active link, so nothing to follow after hiding.
    }
  }, { signal });

  doc.addEventListener('keydown', (event: Event): void => {
    // Allow Escape to dismiss the card without consuming the event for other handlers.
    if ((event as KeyboardEvent).key === 'Escape' && !root.hidden) {
      // Escape pressed while visible, so hide immediately.
      hide();
    } else {
      // Not a dismissible Escape, so leave handling to other listeners.
    }
  }, { signal });

  pane.addEventListener('scroll', (): void => {
    // Scrolling the pane invalidates the card's position, so hide it.
    hide();
  }, { signal, capture: true });

  return {
    get isOpen(): boolean {
      // The card is open whenever it is not hidden.
      return !root.hidden;
    },
    hide,
    destroy(): void {
      // Idempotent teardown that cancels timers, removes listeners, and detaches the DOM.
      if (destroyed) {
        // Already torn down, so do nothing on repeat calls.
        return;
      } else {
        destroyed = true;
        hide();
        controller.abort();
        root.remove();
      }
    },
  };
}
