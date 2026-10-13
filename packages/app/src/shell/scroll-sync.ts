/**
 * @file scroll-sync.ts
 * @purpose Implements synchronised scrolling between K-Doc and Source editor panes in K-Doc (FR-5.5),
 *   anchoring alignment on block boundaries rather than line ratios to prevent drift across differing block heights.
 * @inputs ScrollSyncOptions containing DocumentSession, Window context, first HTMLElement, second HTMLElement, and anchorsFor extractor.
 * @outputs ScrollSync controller interface exposing locked status, setLocked, refresh, and destroy lifecycle methods, alongside alignedScrollTop and installScrollSync functions.
 * @functions
 *   - alignedScrollTop: Computes target pane scrollTop from source anchors, target anchors, and source scrollTop via block-boundary interpolation.
 *   - isTextChangingReason: Determines whether a session change reason represents a document text modification requiring anchor refresh.
 *   - installScrollSync: Instantiates scroll synchronization listeners, binds echo-guarded scroll handlers with AbortController, and returns the ScrollSync controller.
 * @dataflow Pane scroll event -> alignedScrollTop -> echo guard -> target pane scrollTop assignment; session text change -> refresh cached block anchors.
 * @controlflow Mount scroll listeners with AbortController -> subscribe to session changes -> evaluate visibility and echo guards on scroll -> interpolate aligned offset -> update target scrollTop.
 * @version 1
 * @date 2026-09-05
 */

import type { DocumentSession } from '@k-doc/core';

export interface BlockAnchor {
  /** Index of the block in document order. */
  readonly index: number;
  /** Distance in pixels from the top of the scroller to the top of this block. */
  readonly top: number;
}

export interface ScrollSyncOptions {
  readonly session: DocumentSession;
  readonly win: Window;
  /** The two scrollable elements. */
  readonly first: HTMLElement;
  readonly second: HTMLElement;
  /** Returns the block anchors currently laid out in each scroller, in document order. */
  readonly anchorsFor: (element: HTMLElement) => readonly BlockAnchor[];
}

export interface ScrollSync {
  readonly locked: boolean;
  /** Turn syncing on or off. */
  setLocked(locked: boolean): void;
  /** Re-read anchors, e.g. after the document or layout changed. */
  refresh(): void;
  destroy(): void;
}

/**
 * Computes the synchronized scroll position for a target pane based on source pane block anchors.
 *
 * Line-ratio synchronization drifts badly whenever one pane renders a block taller than the other —
 * such as a code block, a table, an image, or wrapped paragraphs — which in a Markdown editor is most
 * documents. Anchoring on block index means the same block is aligned at the top of both panes
 * regardless of how tall each pane draws it.
 *
 * @purpose Given source anchors, target anchors, and source scrollTop, calculates where the target pane should scroll to.
 * @inputs sourceAnchors - Readonly array of BlockAnchor objects for the pane being scrolled.
 * @inputs targetAnchors - Readonly array of BlockAnchor objects for the pane receiving synchronization.
 * @inputs sourceScrollTop - Current vertical scroll offset of the source pane in pixels.
 * @outputs number | null - Target scroll offset in pixels floored at 0, or null if anchors cannot be computed.
 * @dataflow sourceScrollTop + sourceAnchors -> identify current & next source blocks -> compute progress through block -> look up targetCurrent & targetNext -> interpolate -> floored target scrollTop.
 * @controlflow Check for empty anchor lists (return null) -> find last source anchor with top <= sourceScrollTop (or first) -> calculate block progress clamped to [0, 1] -> lookup target anchors with fallback -> interpolate target top -> return Math.max(0, targetScrollTop).
 */
export function alignedScrollTop(
  sourceAnchors: readonly BlockAnchor[],
  targetAnchors: readonly BlockAnchor[],
  sourceScrollTop: number,
): number | null {
  // Check if either anchor list is empty.
  if (sourceAnchors.length === 0 || targetAnchors.length === 0) {
    // Cannot compute scroll alignment with empty anchor sets.
    return null;
  } else {
    // Both anchor lists contain at least one anchor: proceed with alignment.
  }

  // 1. Find the last source anchor whose top is <= sourceScrollTop.
  // This identifies the block that the viewport's top edge is currently inside.
  let matchIndex: number | null = null;
  for (let i = 0; i < sourceAnchors.length; i++) {
    const anchor = sourceAnchors[i];
    // Check if anchor is defined and its top offset is less than or equal to sourceScrollTop.
    if (anchor !== undefined && anchor.top <= sourceScrollTop) {
      // Anchor is at or above viewport top edge: record index as candidate current block.
      matchIndex = i;
    } else {
      // Anchor is undefined or beyond sourceScrollTop: skip.
    }
  }

  // If no anchor has top <= sourceScrollTop (e.g. scrolled above the first block), use the first anchor.
  let currentIndex: number;
  // Check if a qualifying anchor was located.
  if (matchIndex !== null) {
    // Matching anchor found: use the last anchor whose top <= sourceScrollTop.
    currentIndex = matchIndex;
  } else {
    // None qualifies: viewport top edge is above or at the very start of the document; use the first anchor.
    currentIndex = 0;
  }

  const current = sourceAnchors[currentIndex];
  // Check if current anchor is defined under strict noUncheckedIndexedAccess.
  if (current === undefined) {
    // Safety guard: current anchor undefined, abort alignment.
    return null;
  } else {
    // Current anchor is valid: this is the block the viewport's top edge is inside.
  }

  // 2. Find the next source anchor after it, if any.
  const next = sourceAnchors[currentIndex + 1];

  // 3. Compute how far through that block the viewport is.
  let span: number;
  // Check if a subsequent source anchor exists.
  if (next === undefined) {
    // Current anchor is the final block in the document: span is 0.
    span = 0;
  } else {
    // Subsequent anchor exists: measure pixel distance between block tops.
    span = next.top - current.top;
  }

  let rawProgress: number;
  // Check if span is greater than zero to prevent division by zero.
  if (span > 0) {
    // Positive block height: calculate fractional progress through the block.
    rawProgress = (sourceScrollTop - current.top) / span;
  } else {
    // Non-positive span: progress is 0.
    rawProgress = 0;
  }

  // Clamp progress into [0, 1] to prevent overshooting between block boundaries.
  let progress: number;
  // Check if raw progress is below lower boundary 0.
  if (rawProgress < 0) {
    // Clamp to minimum boundary 0.
    progress = 0;
  } else if (rawProgress > 1) {
    // Clamp to maximum boundary 1.
    progress = 1;
  } else {
    // Progress is within valid [0, 1] range.
    progress = rawProgress;
  }

  // 4. Look up target anchors at the same index, guarding both reads.
  // First attempt to match by anchor.index, falling back to array index lookup.
  let targetCurrent: BlockAnchor | undefined = undefined;
  for (let i = 0; i < targetAnchors.length; i++) {
    const anchor = targetAnchors[i];
    // Check if anchor is defined and its block index matches current.index.
    if (anchor !== undefined && anchor.index === current.index) {
      // Matching block anchor found in target.
      targetCurrent = anchor;
      break;
    } else {
      // Anchor is undefined or does not match current.index: continue searching.
    }
  }

  // Check if target anchor was not found by block index.
  if (targetCurrent === undefined) {
    // Check whether an anchor exists at array position current.index.
    const directAnchor = targetAnchors[current.index];
    if (directAnchor !== undefined) {
      // Direct array index hit: use matching anchor.
      targetCurrent = directAnchor;
    } else {
      // Fall back to the target's last anchor.
      // The fallback exists rather than returning null because the two panes can disagree
      // on block count for a moment after an edit, and refusing to scroll leaves the panes
      // visibly out of step, which is worse than being approximately right.
      targetCurrent = targetAnchors[targetAnchors.length - 1];
    }
  } else {
    // Target anchor matching current.index was successfully found.
  }

  // Guard targetCurrent read under strict noUncheckedIndexedAccess.
  if (targetCurrent === undefined) {
    // Safety guard: if targetAnchors array was unexpectedly empty, return null.
    return null;
  } else {
    // targetCurrent is defined: proceed to targetNext lookup.
  }

  // Look up targetNext at the same index as next, guarding the read.
  let targetNext: BlockAnchor | undefined = undefined;
  // Check if a next source anchor exists.
  if (next !== undefined) {
    for (let i = 0; i < targetAnchors.length; i++) {
      const anchor = targetAnchors[i];
      // Check if anchor is defined and its block index matches next.index.
      if (anchor !== undefined && anchor.index === next.index) {
        // Matching next block anchor found in target.
        targetNext = anchor;
        break;
      } else {
        // Anchor is undefined or does not match next.index: continue searching.
      }
    }

    // Check if targetNext was not found by block index.
    if (targetNext === undefined) {
      // Check whether an anchor exists at array position next.index.
      const directNext = targetAnchors[next.index];
      if (directNext !== undefined) {
        // Direct array index hit: use matching anchor.
        targetNext = directNext;
      } else {
        // Target has no anchor at next.index: leave targetNext undefined.
        targetNext = undefined;
      }
    } else {
      // Target anchor matching next.index was successfully found.
    }
  } else {
    // No next source anchor exists: targetNext is undefined.
    targetNext = undefined;
  }

  // 5. Interpolate: targetCurrent.top + progress * (targetNext.top - targetCurrent.top),
  // using targetCurrent.top alone when there is no targetNext.
  let interpolatedTop: number;
  // Check if targetNext is defined.
  if (targetNext !== undefined) {
    // Both targetCurrent and targetNext are defined: interpolate between them.
    interpolatedTop = targetCurrent.top + progress * (targetNext.top - targetCurrent.top);
  } else {
    // No targetNext available: use targetCurrent.top alone.
    interpolatedTop = targetCurrent.top;
  }

  // 6. Return the result, floored at 0.
  // Check if the calculated target scroll position is less than 0.
  if (interpolatedTop < 0) {
    // Negative scroll position: floor at 0.
    return 0;
  } else {
    // Zero or positive: return computed target scrollTop.
    return interpolatedTop;
  }
}

/**
 * Evaluates whether a session change reason represents a document text modification.
 *
 * @purpose Determines whether a session change should trigger a re-reading of layout block anchors.
 * @inputs reason - The session change reason string ('edit' | 'external' | 'undo' | 'redo' | 'focus' | 'reset').
 * @outputs boolean - True if the reason modifies document text; false otherwise.
 * @dataflow reason -> equality checks -> boolean result.
 * @controlflow Check if reason is text-modifying ('edit', 'external', 'undo', 'redo', 'reset') -> return true; else ('focus') -> return false.
 */
function isTextChangingReason(reason: string): boolean {
  // Check if reason is one of the text-modifying change reasons.
  // In K-Doc ('autosave.ts' and 'recovery.ts'), 'edit', 'external', 'undo', and 'redo' modify text,
  // while 'reset' reloads document content. 'focus' only switches active pane focus without modifying text.
  if (
    reason === 'edit' ||
    reason === 'external' ||
    reason === 'undo' ||
    reason === 'redo' ||
    reason === 'reset'
  ) {
    // Reason indicates document text was modified or reloaded: layout anchors must be refreshed.
    return true;
  } else {
    // Reason is 'focus': focus change does not modify text or block layout.
    return false;
  }
}

/**
 * Installs synchronised scrolling across dual editor panes.
 *
 * @purpose Coordinates bidirectional scroll synchronization between two panes anchored on block boundaries.
 * @inputs options - ScrollSyncOptions providing document session, window context, scrollable elements, and anchor extractor.
 * @outputs ScrollSync - Controller interface exposing locked status, setLocked, refresh, and destroy methods.
 * @dataflow Scroll events / session change -> handleScroll / refresh -> DOM scrollTop assignment or anchor cache update.
 * @controlflow Initialize anchor caches -> attach scroll listeners with AbortController -> subscribe to session changes -> return ScrollSync controller.
 */
export function installScrollSync(options: ScrollSyncOptions): ScrollSync {
  const abortController = new AbortController();
  const signal = abortController.signal;

  let locked: boolean = true;
  let destroyed: boolean = false;
  let syncing: boolean = false;
  let syncTimeoutId: number | null = null;
  let firstAnchors: readonly BlockAnchor[] = [];
  let secondAnchors: readonly BlockAnchor[] = [];
  let unsubscribeSession: (() => void) | null = null;

  /**
   * Re-reads and caches block anchors from both editor panes.
   *
   * @purpose Refreshes cached block anchor measurements from options.anchorsFor.
   * @inputs void.
   * @outputs void.
   * @dataflow options.anchorsFor -> firstAnchors and secondAnchors cache updates.
   * @controlflow Check destroyed guard -> query anchorsFor for both panes -> update cache arrays.
   */
  function refresh(): void {
    // Check if controller has already been destroyed.
    if (destroyed) {
      // Controller is destroyed: abort refresh.
      return;
    } else {
      // Controller is active: recompute cached block anchors for both panes.
    }

    firstAnchors = options.anchorsFor(options.first);
    secondAnchors = options.anchorsFor(options.second);
  }

  /**
   * Enables or disables scroll synchronization.
   *
   * @purpose Toggles the locked synchronization state between both panes.
   * @inputs nextLocked - Boolean flag indicating whether scroll synchronization should be active.
   * @outputs void.
   * @dataflow nextLocked -> updates locked state variable.
   * @controlflow Check destroyed guard -> assign locked = nextLocked.
   */
  function setLocked(nextLocked: boolean): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore lock state modifications.
      return;
    } else {
      // Controller is active: update locked state.
    }

    locked = nextLocked;
  }

  /**
   * Handles a scroll event from one pane, computing aligned scroll offset and updating the other pane.
   *
   * @purpose Synchronizes scroll offset between source and target elements with echo loop suppression.
   * @inputs sourcePane - Identifier ('first' | 'second') denoting which pane originated the scroll event.
   * @outputs void.
   * @dataflow source.scrollTop + cached anchors -> alignedScrollTop -> echo guard -> target.scrollTop.
   * @controlflow Guard against destroyed, unlocked, syncing, or hidden panes -> calculate alignedScrollTop -> if valid, set syncing flag, clear prior timer, update target.scrollTop, and schedule echo-guard release timer.
   */
  function handleScroll(sourcePane: 'first' | 'second'): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Component is destroyed: ignore scroll events.
      return;
    } else {
      // Component is active: proceed.
    }

    // Check if scroll synchronization is locked (active).
    if (!locked) {
      // Syncing is disabled: do not propagate scroll offsets.
      return;
    } else {
      // Syncing is enabled: proceed.
    }

    // Check if a scroll synchronization write is already in progress to guard against echo loops.
    if (syncing) {
      // Echo scroll event detected: ignore to prevent feedback loop.
      return;
    } else {
      // Not currently in an echo cycle: proceed with sync calculation.
    }

    // Check if either pane is hidden (offsetParent === null).
    // A hidden pane has no meaningful scroll position, so syncing to it would
    // scroll the visible pane to an arbitrary place.
    if (options.first.offsetParent === null || options.second.offsetParent === null) {
      // At least one pane is not visible: do not synchronize scroll.
      return;
    } else {
      // Both panes are visible: proceed with alignment.
    }

    let source: HTMLElement;
    let target: HTMLElement;
    let sourceAnchors: readonly BlockAnchor[];
    let targetAnchors: readonly BlockAnchor[];

    // Branch on which pane originated the scroll event.
    if (sourcePane === 'first') {
      source = options.first;
      target = options.second;
      sourceAnchors = firstAnchors;
      targetAnchors = secondAnchors;
    } else {
      source = options.second;
      target = options.first;
      sourceAnchors = secondAnchors;
      targetAnchors = firstAnchors;
    }

    // Anchors are measured from live layout, so a cache filled at install time is filled before the
    // panes have laid out and stays empty for any document nobody edits. Refreshing when either side
    // is empty is what makes the first scroll work at all; the cache still spares the common case.
    if (sourceAnchors.length === 0 || targetAnchors.length === 0) {
      // One side has no measurements yet: take them now rather than declining to scroll.
      refresh();

      // Re-read after the refresh, since the local copies above are stale.
      if (sourcePane === 'first') {
        sourceAnchors = firstAnchors;
        targetAnchors = secondAnchors;
      } else {
        sourceAnchors = secondAnchors;
        targetAnchors = firstAnchors;
      }
    } else {
      // Both sides already measured: use the cached anchors.
    }

    const targetScrollTop = alignedScrollTop(sourceAnchors, targetAnchors, source.scrollTop);

    // Check if aligned scroll top was successfully calculated.
    if (targetScrollTop === null) {
      // Aligned position could not be computed (e.g. empty anchors): do not update scroll.
      return;
    } else {
      // Valid target scroll offset computed: apply to target element.
    }

    // Guard against echo: setting scrollTop triggers a scroll event on the other element.
    syncing = true;

    // Clear any existing pending echo-guard timeout.
    if (syncTimeoutId !== null) {
      options.win.clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    } else {
      // No prior pending timeout to clear.
    }

    target.scrollTop = targetScrollTop;

    // Clearing the syncing flag synchronously does not work because the scroll event is
    // dispatched asynchronously, so the flag must survive until the task queue drains.
    syncTimeoutId = options.win.setTimeout((): void => {
      syncing = false;
      syncTimeoutId = null;
    }, 0);
  }

  /**
   * Idempotently cleans up all resources, aborting listener signals, unsubscribing from session, and clearing timers.
   *
   * @purpose Tears down scroll event listeners, cancels session subscription, and clears pending echo-guard timeouts.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> unsubscribeSession() -> win.clearTimeout() -> reset internal state.
   * @controlflow Check destroyed guard (return early if true) -> mark destroyed = true -> abort listener signals -> invoke session unsubscription -> clear pending timeout -> reset caches.
   */
  function destroy(): void {
    // Check if controller has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active controller: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();

    // Check if a session subscription is active.
    if (unsubscribeSession !== null) {
      // Invoke unsubscription disposer to stop receiving session notifications.
      unsubscribeSession();
      unsubscribeSession = null;
    } else {
      // No active session subscription to dispose.
    }

    // Check if an echo-guard timeout is pending.
    if (syncTimeoutId !== null) {
      // Clear pending timeout to prevent delayed callback execution after teardown.
      options.win.clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    } else {
      // No pending timeout to clear.
    }

    syncing = false;
    firstAnchors = [];
    secondAnchors = [];
  }

  // Attach scroll listeners to both elements with the AbortController signal.
  options.first.addEventListener(
    'scroll',
    (): void => {
      handleScroll('first');
    },
    { signal },
  );

  options.second.addEventListener(
    'scroll',
    (): void => {
      handleScroll('second');
    },
    { signal },
  );

  // Subscribe to session changes to recompute cached anchors when document text changes.
  unsubscribeSession = options.session.subscribe((change): void => {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore session changes.
      return;
    } else {
      // Controller is active: inspect change reason.
    }

    // Check if the change reason represents a document text modification.
    if (isTextChangingReason(change.reason)) {
      // Document text changed: recompute cached block anchors.
      refresh();
    } else {
      // Reason is 'focus' or non-text modification: block anchors remain unchanged.
    }
  });

  // Deferred a frame: at install time the panes exist but have not been laid out, so every
  // getBoundingClientRect would read zero and the cache would be uselessly full of zeroes rather
  // than empty. A frame later the browser has done layout and the measurements mean something.
  options.win.requestAnimationFrame((): void => {
    refresh();
  });

  return {
    /**
     * @purpose Returns boolean indicating whether scroll synchronization is currently active.
     * @inputs void.
     * @outputs boolean - True if synchronization is locked (active); false otherwise.
     * @dataflow locked state -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed, otherwise return locked state.
     */
    get locked(): boolean {
      return locked;
    },

    setLocked,
    refresh,
    destroy,
  };
}
