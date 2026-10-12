/**
 * @file rendered-links.ts
 * @purpose Ensures rendered HTML shown inside the app (the track-changes Original view) never lets the webview follow a link itself; every link click is handed to the app's own link handling.
 * @inputs A host HTMLElement containing rendered HTML; a `follow` callback receiving the clicked link's href; click MouseEvents bubbling from within the element.
 * @outputs A StopRouting function that detaches the click listener; `follow(href)` invocations for clicked links with a usable href.
 * @functions
 *   - routeRenderedLinks: Attaches a delegated click handler to an element that intercepts link clicks and forwards their hrefs to `follow`.
 * @dataflow click event -> event.target.closest('a') -> preventDefault -> getAttribute('href') -> follow(href).
 * @controlflow Attach listener on call -> on each click: ignore non-link or foreign-link clicks; otherwise prevent default, skip missing/empty hrefs, else follow -> stop function removes the listener.
 * @version 1
 * @date 2026-10-07
 */

/** Stops listening; calling it twice is harmless. */
export type StopRouting = () => void;

/**
 * Routes every link click inside a rendered-HTML element to the app's own link handling.
 * @purpose Prevents the webview from navigating on link clicks and hands the href to `follow` instead.
 * @inputs element - HTMLElement hosting the rendered HTML; follow - callback invoked with the clicked link's href string.
 * @outputs StopRouting - function that removes the click listener; safe to call repeatedly.
 * @dataflow MouseEvent target -> nearest enclosing anchor -> href attribute -> follow(href).
 * @controlflow Registers a click listener; the handler returns early for non-link clicks, clicks on anchors outside `element`, and anchors lacking an href; otherwise it follows the href.
 */
export function routeRenderedLinks(element: HTMLElement, follow: (href: string) => void): StopRouting {
  const onClick = (event: MouseEvent): void => {
    // Resolve the nearest enclosing anchor when the target is an Element; otherwise there is no anchor.
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    // Only clicks on a link inside this element are handled; anything else is left alone.
    if (anchor === null || !element.contains(anchor)) {
      // Not a link within this element: do nothing and leave default behaviour untouched.
      return;
    }
    // Stop the webview from following the link itself.
    event.preventDefault();
    const href = anchor.getAttribute('href');
    // A link whose address the sanitiser removed has nowhere to go.
    if (href === null || href === '') {
      // No usable address: the click is swallowed and nothing is followed.
      return;
    }
    // Hand the address to the app's own link handling.
    follow(href);
  };

  element.addEventListener('click', onClick);

  return (): void => {
    // Detach the listener; removing an already-removed listener is a no-op, so repeat calls are harmless.
    element.removeEventListener('click', onClick);
  };
}
