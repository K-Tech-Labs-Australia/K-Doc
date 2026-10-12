/**
 * @file writing-scroll.ts
 * @purpose Scrolling for Typewriter mode (FR-5.8), shared by both panes: finds the element that scrolls an editor and moves it so the caret sits at its vertical centre.
 * @inputs an editor element, caret coordinates
 * @outputs scrollTop changes
 * @functions
 *   - scrollContainerOf: Walks up from an element to find the nearest ancestor that can scroll vertically.
 *   - centreInContainer: Adjusts a container's scrollTop so a caret sits at its vertical centre.
 * @dataflow element -> nearest scrolling ancestor -> caret centre vs container centre -> scrollTop
 * @controlflow walk up to the first element that can scroll; skip sub-pixel moves
 * @version 1
 * @date 2026-09-16
 */

export function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  // Start at the element itself, since CodeMirror's own scroller scrolls on its own, then walk upward.
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const overflow = node.ownerDocument.defaultView?.getComputedStyle(node).overflowY ?? '';
    // An element scrolls when its vertical overflow is auto or scroll and its content is taller than it.
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    } else {
      // Not a scrolling container: continue walking up toward the document root.
    }
  }
  // Nothing along this chain scrolls, e.g. a short document that fits entirely on screen.
  return null;
}

export function centreInContainer(container: HTMLElement, caretTop: number, caretBottom: number): void {
  const box = container.getBoundingClientRect();
  // The offset is how far the caret's middle sits below the container's middle; scrolling by it centres the caret.
  const offset = (caretTop + caretBottom) / 2 - (box.top + box.height / 2);
  // A move of at least a full pixel is applied so sub-pixel shifts do not cause visible jitter.
  if (Math.abs(offset) >= 1) {
    container.scrollTop += offset;
  } else {
    // The caret is already centred within less than a pixel: leave scrollTop untouched.
  }
}
