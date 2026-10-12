/**
 * @file presentation-mode.ts
 * @purpose Presentation mode (FR-5.9): shows a document's slides one at a time over the whole window, full screen, moving with the arrow and page keys and leaving on Escape.
 * @inputs rendered slide HTML, a full-screen callback, an image resolver, an error callback, key and click events.
 * @outputs a controller (Presentation) and PRESENTATION_STYLES.
 * @functions
 *   - installPresentation: builds and returns the presentation controller wired to the document.
 *   - render: swaps in the current slide HTML and resolves its images.
 *   - show: clamps to a target index and re-renders when it changes.
 *   - open: starts presenting a deck of slides.
 *   - close: stops presenting and restores focus.
 *   - onKeydown: handles navigation keys while active.
 *   - onClick: advances the slide on a click outside links.
 *   - destroy: tears down listeners and DOM.
 * @dataflow slides -> current index -> slide element HTML + counter; keys/clicks -> index.
 * @controlflow open refuses an empty deck; keys are handled only while presenting and never reach the editor underneath; close/destroy release full screen and focus.
 * @version 4
 * @date 2026-10-07
 */

/**
 * Configuration for installPresentation.
 * @purpose Supplies the host document, a full-screen toggle, an image resolver, an error sink, and a link opener to the presentation controller.
 * @inputs doc - the Document whose body receives the presentation root; setFullscreen - asks the host window to fill the screen or restore; resolveImage - turns an image's written address into a loadable URL, or null to keep it as written; onError - reports what went wrong; followLink - opens a link clicked on a slide through the app's link handling.
 * @outputs none (configuration object only).
 * @dataflow Host-provided callbacks and document flow into installPresentation and are captured by the returned controller.
 * @controlflow No branching; options are read once at construction and stored for later calls.
 */
export interface PresentationOptions {
  readonly doc: Document;
  readonly setFullscreen: (fullscreen: boolean) => Promise<void>;
  readonly resolveImage: (src: string) => Promise<string | null>;
  readonly onError: (message: string) => void;
  /** Opens a link clicked on a slide the way the editor would (notes in K-Doc, web addresses after the usual checks). */
  readonly followLink: (href: string) => void;
}

/**
 * Controller returned by installPresentation.
 * @purpose Exposes presentation state and navigation controls to callers.
 * @inputs none (stateful handle).
 * @outputs active - whether a deck is currently shown; index - zero-based position of the current slide; open/close/next/previous/destroy - control the lifecycle.
 * @dataflow Callers invoke methods; getters reflect internal state updated by navigation.
 * @controlflow Methods guard on `active`; navigation clamps via show().
 */
export interface Presentation {
  readonly active: boolean;
  readonly index: number;
  open(slides: readonly string[]): void;
  close(): void;
  next(): void;
  previous(): void;
  destroy(): void;
}

/**
 * CSS for the presentation overlay and its contents.
 * @purpose Styles the full-screen slide container, scales slide text with the window, keeps images and code inside the slide, places the counter bottom right, and uses theme tokens.
 * @inputs none (style sheet string).
 * @outputs a CSS string injected via <style> by the host.
 * @dataflow Static constant consumed at runtime; no transformation.
 * @controlflow No branching; applied as a stylesheet once.
 */
export const PRESENTATION_STYLES: string = `
.kdoc-presentation {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6vh 8vw;
  box-sizing: border-box;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  outline: none;
}

.kdoc-presentation[hidden] {
  display: none;
}

.kdoc-slide {
  width: min(1100px, 100%);
  max-height: 100%;
  overflow: auto;
  font-size: clamp(20px, 2.4vw, 34px);
  line-height: 1.45;
}

.kdoc-slide::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-slide::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-slide::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-slide h1 {
  font-size: 2em;
  margin-top: 0;
}

.kdoc-slide img {
  max-width: 100%;
  max-height: 60vh;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-slide pre {
  font-size: 0.7em;
  overflow: auto;
  background: var(--kdoc-chrome-raised);
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  box-shadow: none;
  padding: 12px;
}

.kdoc-slide pre::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-slide pre::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-slide pre::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-slide-counter {
  position: absolute;
  right: 3vw;
  bottom: 2vh;
  font-size: 14px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  background: var(--kdoc-chrome-raised);
  padding: 4px 10px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}
`;

// Keys a clicker or keyboard sends to move forward through the deck.
const NEXT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']);
// Keys a clicker or keyboard sends to move backward through the deck.
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']);

/**
 * Builds and returns the presentation controller wired to the document.
 * @purpose Installs the overlay DOM, wires capture-phase key handling and click handling, and returns a lifecycle controller.
 * @inputs options - PresentationOptions supplying doc, setFullscreen, resolveImage, onError, and followLink.
 * @outputs a Presentation controller exposing state and navigation methods.
 * @dataflow Options -> captured closures -> DOM + listeners; returned object proxies internal functions.
 * @controlflow Build root/slide/counter elements, append to body, attach listeners, then return the controller handle.
 */
export function installPresentation(options: PresentationOptions): Presentation {
  const { doc } = options;
  let slides: readonly string[] = [];
  let index = 0;
  let active = false;
  let renderToken = 0;
  // Where focus lived before presenting, restored on close.
  let returnFocus: HTMLElement | null = null;

  const root = doc.createElement('div');
  root.className = 'kdoc-presentation';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Presentation');
  root.tabIndex = -1;
  root.hidden = true;
  const slide = doc.createElement('div');
  slide.className = 'kdoc-slide';
  const counter = doc.createElement('div');
  counter.className = 'kdoc-slide-counter';
  counter.setAttribute('aria-live', 'polite');
  root.append(slide, counter);
  doc.body.append(root);

  /**
   * Toggles full screen through the host callback, reporting failures.
   * @purpose Delegates to setFullscreen and routes any rejection to onError.
   * @inputs fullscreen - true to enter, false to leave full screen.
   * @outputs none; surfaces errors via options.onError.
   * @dataflow Flag -> setFullscreen promise -> .catch -> onError message.
   * @controlflow No branching; the catch handler formats and reports the error.
   */
  function applyFullscreen(fullscreen: boolean): void {
    options.setFullscreen(fullscreen).catch((error: unknown) => {
      options.onError(`Could not ${fullscreen ? 'enter' : 'leave'} full screen: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Swaps in the current slide HTML and resolves its images.
   * @purpose Writes slides[index] into the slide element, updates the counter, and asks resolveImage for each image source.
   * @inputs none (reads internal `slides`, `index`, `renderToken`).
   * @outputs none; mutates the DOM in place.
   * @dataflow The slide HTML comes from K-Doc's own renderer, the same path Preview and export use; each render gets a token so an image resolved for a slide already left is not written into the next one; an image without a source is skipped; an image that cannot be resolved keeps its written address (the renderer's own src), so failures are deliberately silent.
   * @controlflow Bumps renderToken, sets innerHTML and counter text, then iterates images; each branch either continues or schedules a resolution.
   */
  function render(): void {
    const token = ++renderToken;
    slide.innerHTML = slides[index] ?? '';
    counter.textContent = `${index + 1} / ${slides.length}`;
    for (const image of Array.from(slide.querySelectorAll('img'))) {
      const src = image.getAttribute('src');
      // An image with no src attribute cannot be resolved; skip it.
      if (src === null) {
        continue;
      } else {
        // Has a source: resolve it below, keeping the written address on failure.
      }
      options.resolveImage(src).then((url) => {
        // Only write the URL when resolution succeeded and this render is still current.
        if (url !== null && token === renderToken) {
          image.src = url;
        } else {
          // Resolution failed or a newer render superseded this one: keep the written src, silently.
        }
      }).catch(() => {
        // Resolve rejection is deliberately silent so a broken image keeps its written address.
      });
    }
  }

  /**
   * Moves to a target slide index, clamped to the deck bounds.
   * @purpose Clamps to the first and last slide, so moving past either end stays put; re-renders only when the slide changes.
   * @inputs target - requested zero-based slide index.
   * @outputs none; updates internal `index` and re-renders on change.
   * @dataflow Target -> bounded clamp -> comparison with current index -> render or no-op.
   * @controlflow If the bounded slide differs from the current one, update and render; otherwise do nothing.
   */
  function show(target: number): void {
    // Clamp to deck bounds so moving past either end stays put.
    const bounded = Math.max(0, Math.min(target, slides.length - 1));
    // Only update and re-render when the slide actually changes.
    if (bounded !== index) {
      index = bounded;
      render();
    } else {
      // Same slide: no change, do nothing.
    }
  }

  /**
   * Starts presenting a deck of slides.
   * @purpose An empty deck is reported rather than showing a blank screen; opening while presenting does nothing; otherwise captures focus, renders the first slide, and enters full screen.
   * @inputs deck - the rendered slide HTML to present.
   * @outputs none; sets internal state active/index/slides and shows the root.
   * @dataflow Deck -> stored slides + reset index -> render first slide -> focus root -> enter full screen.
   * @controlflow Empty deck reports an error and returns; already-active is a no-op; otherwise proceeds to activate.
   */
  function open(deck: readonly string[]): void {
    // An empty deck is reported rather than showing a blank screen.
    if (deck.length === 0) {
      options.onError('There is nothing to present: the document has no content.');
      return;
    } else if (active) {
      // Already presenting: opening again does nothing.
      return;
    } else {
      // Ready to open: fall through and activate below.
    }
    slides = deck;
    index = 0;
    active = true;
    returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    render();
    root.hidden = false;
    root.focus();
    applyFullscreen(true);
  }

  /**
   * Stops presenting and restores the previous focus.
   * @purpose Does nothing when not presenting; overtakes pending image loads, hides the root, clears the slide, leaves full screen, and returns focus to where it was.
   * @inputs none.
   * @outputs none; resets internal state.
   * @dataflow active flag -> token bump (cancels pending resolutions) -> hide/clear DOM -> leave fullscreen -> restore focus.
   * @controlflow Not-presenting is a no-op; otherwise runs the teardown sequence unconditionally.
   */
  function close(): void {
    // Does nothing when not presenting.
    if (!active) {
      return;
    } else {
      // Presenting: run the teardown sequence below.
    }
    active = false;
    renderToken += 1;
    root.hidden = true;
    slide.replaceChildren();
    applyFullscreen(false);
    returnFocus?.focus();
    returnFocus = null;
  }

  /**
   * Handles navigation keys while presenting.
   * @purpose Capture phase on the document, so presentation keys never reach the editor underneath; modified keys (Ctrl, Cmd, Alt) are left alone for shortcuts; unhandled keys fall through untouched; handled keys are consumed.
   * @inputs event - the KeyboardEvent from the capture-phase listener.
   * @outputs none; may call close/show and consumes the event.
   * @dataflow Event key -> branch to Escape/next/previous/Home/End or fall through -> preventDefault + stopPropagation on handled keys.
   * @controlflow Inactive or modified keys return early; otherwise each key maps to a navigation action, with an else that returns without consuming.
   */
  function onKeydown(event: KeyboardEvent): void {
    // Ignore while inactive or when a modifier is held so shortcuts still work.
    if (!active || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    } else {
      // Active with no modifier: proceed to handle navigation keys.
    }
    // Escape leaves the presentation.
    if (event.key === 'Escape') {
      close();
    } else if (NEXT_KEYS.has(event.key)) {
      // Forward-navigation key: advance one slide.
      show(index + 1);
    } else if (PREVIOUS_KEYS.has(event.key)) {
      // Backward-navigation key: step to the previous slide.
      show(index - 1);
    } else if (event.key === 'Home') {
      // Jump to the first slide.
      show(0);
    } else if (event.key === 'End') {
      // Jump to the last slide.
      show(slides.length - 1);
    } else {
      // Unhandled key: fall through untouched, do not consume.
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Advances the slide on a click outside links.
   * @purpose Clicking the slide advances, except on a link, which is opened through options.followLink with the webview's own navigation prevented.
   * @inputs event - the MouseEvent from the root listener.
   * @outputs none; may call show(index + 1) or options.followLink(href).
   * @dataflow Click target -> closest('a') check -> follow the link through the app or advance.
   * @controlflow If the click lands on a link, prevent default navigation, hand a non-empty href to followLink, and return without advancing; otherwise advance one slide.
   */
  function onClick(event: MouseEvent): void {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    // A click on a link never lets the webview navigate: the app opens it through its own link handling, and the slide does not advance.
    if (anchor !== null) {
      event.preventDefault();
      const href = anchor.getAttribute('href');
      // A link with an address is handed to the app; one whose address the sanitiser removed does nothing.
      if (href !== null && href !== '') {
        options.followLink(href);
      }
      return;
    } else {
      // Click on the slide itself: advance one slide.
      show(index + 1);
    }
  }

  doc.addEventListener('keydown', onKeydown, true);
  root.addEventListener('click', onClick);

  return {
    get active(): boolean {
      return active;
    },
    get index(): number {
      return index;
    },
    open,
    close,
    next: (): void => {
      show(index + 1);
    },
    previous: (): void => {
      show(index - 1);
    },
    // Closes first so the window does not stay full screen.
    destroy(): void {
      close();
      doc.removeEventListener('keydown', onKeydown, true);
      root.remove();
    },
  };
}
