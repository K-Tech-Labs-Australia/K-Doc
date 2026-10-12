/**
 * @file match-scrollbar.ts
 * @purpose Draws the strip of find-match ticks beside the Source pane's scrollbar (FR-9.2), because twelve matches is a number the reader cannot act on until they can see where the other eleven sit without scrolling to find out; the gutter gives an overview of match distribution along the whole document even for parts not currently visible. The geometry is deliberately naive — a tick's position is its character offset as a fraction of the document length, which is approximate because lines differ in length, but being approximately right across the entire document beats being exactly right about only the part already on screen.
 * @inputs doc - Document in which to create the overlay div; matches - readonly SearchMatch[] describing each find hit's character range; activeIndex - index into matches of the currently highlighted hit; docLength - total character count of the document used to normalise offsets to [0, 1].
 * @outputs MatchScrollbar factory exposing render() and destroy(), a pure tickFraction for testable offset arithmetic, MATCH_SCROLLBAR_STYLES CSS string, and the MatchScrollbar interface.
 * @functions
 *   - tickFraction: Pure function returning an offset as a fraction in [0, 1] clamped against the document length.
 *   - createMatchScrollbar: Builds a detached div overlay exposing render() and destroy() over match ticks.
 * @dataflow doc -> createElement(div) with class + aria-hidden -> closed over in render()/destroy(); matches + activeIndex + docLength -> while-loop rebuild of children -> each tick positioned by tickFraction(start, docLength) as a percentage top.
 * @controlflow createMatchScrollbar constructs the div and returns an object whose render clears children then rebuilds them per match with an active-class branch on index === activeIndex; destroy detaches from parent when present; tickFraction guards docLength <= 0 before clamping offset/length into [0, 1].
 * @version 3
 * @date 2026-10-04
 */

import type { SearchMatch } from '@k-doc/core';

export interface MatchScrollbar {
  readonly element: HTMLElement;
  /** Redraws the ticks. Pass an empty list to clear. */
  render(matches: readonly SearchMatch[], activeIndex: number, docLength: number): void;
  destroy(): void;
}

/**
 * @purpose Returns a character offset's position as a fraction in [0, 1] along the document, so ticks can be placed by percentage top regardless of how many lines separate them.
 * @inputs offset - Character index of the match start within the document; docLength - Total number of characters in the document used as the denominator.
 * @outputs number - The normalised fraction offset / docLength clamped to [0, 1], or 0 when the document is empty.
 * @dataflow offset and docLength -> branch on docLength <= 0 -> division then clamp via Math.min/Math.max -> fraction value.
 * @controlflow If docLength <= 0 return 0 (empty document has a single position); otherwise divide offset by docLength and clamp the result into [0, 1] so an out-of-range tick is pinned to a boundary rather than drawn off-strip.
 */
export function tickFraction(offset: number, docLength: number): number {
  // An empty document has exactly one position and every match in it sits at that top; returning 0 keeps the value defined (not NaN) even though placement there is vacuous.
  if (docLength <= 0) {
    return 0;
  }

  // A stale match can point past the end of a document that has since shrunk, so clamp offset / docLength into [0, 1]: a tick outside the strip would be drawn nowhere rather than at the bottom boundary.
  const fraction = offset / docLength;
  return Math.min(1, Math.max(0, fraction));
}

/**
 * @purpose CSS string for the match-scrollbar overlay and its ticks, with rationale embedded as comments alongside each rule.
 * @inputs none - Pure constant consumed by whoever injects it into a <style> element or stylesheet.
 * @outputs string - Three rules: .kdoc-match-scrollbar positions an absolute, non-interactive gutter; .kdoc-match-tick styles the default match tick; .kdoc-match-tick-active overrides the active tick to be wider and solid.
 * @dataflow none -> literal template string -> exported constant for injection elsewhere.
 * @controlflow No branching — a static stylesheet fragment returned as-is.
 */
export const MATCH_SCROLLBAR_STYLES: string = `
/* Non-interactive overlay on the right edge of the Source pane. It reports where the matches are;
   the real scrollbar underneath it is what the reader drags, so pointer-events: none lets every
   intended interaction pass through to that scrollbar. z-index 6 sits above content but below panels. */

.kdoc-match-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 10px;
  pointer-events: none;
  z-index: 6;
}

/* A default match tick: a thin, semi-transparent bar whose colour derives from the emissive cyan token so it
   recedes until a match is actually there. Positioned at right: 1px with an 8px width to sit inside the
   10px gutter without touching its edges. */

.kdoc-match-tick {
  position: absolute;
  right: 1px;
  width: 8px;
  height: 2px;
  border-radius: var(--kdoc-radius-pill);
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 60%, transparent);
}

/* The active tick is wider and solid rather than a different colour, matching how the in-text highlight
   distinguishes the current match from the others. It drops to right: 0 and grows to fill the gutter so
   the reader can spot the one they are on without reading anything. */

.kdoc-match-tick-active {
  height: 3px;
  width: 10px;
  right: 0;
  border-radius: var(--kdoc-radius-pill);
  background: var(--kdoc-chrome-accent);
}
`;

/**
 * @purpose Builds a detached div overlay that renders find-match ticks beside the Source pane's scrollbar and exposes render()/destroy() over it.
 * @inputs doc - Document in which to create the overlay div so it belongs to the correct document context.
 * @outputs MatchScrollbar - Object whose element is the overlay div, whose render rebuilds ticks from a match list, and whose destroy detaches the div from its parent when present.
 * @dataflow doc -> createElement(div) with class + aria-hidden -> closed over in render() (rebuild children per match) and destroy() (detach from parent).
 * @controlflow Create the div, mark it hidden-from-assistive-tech, then return an object whose render clears existing children via a while loop, hides itself when there are no matches, otherwise rebuilds one tick per match with an active-class branch on index === activeIndex; destroy removes the div from its parent only when it has one.
 */
export function createMatchScrollbar(doc: Document): MatchScrollbar {
  // A plain div is all this overlay needs; createElementNS would be for SVG, and here HTML semantics are correct.
  const element = doc.createElement('div');
  element.className = 'kdoc-match-scrollbar';

  // The match count is already announced in the panel's status readout, so a screen reader gains nothing from a hundred unlabelled ticks; hiding the overlay keeps assistive tech focused on meaningful content.
  element.setAttribute('aria-hidden', 'true');

  return {
    element,
    render(matches: readonly SearchMatch[], activeIndex: number, docLength: number): void {
      // Rebuild from scratch rather than diffing: the list changes wholesale on every keystroke, so a simple clear-and-redraw is cheaper to get right than incremental reconciliation.
      while (element.firstChild !== null) {
        element.removeChild(element.firstChild);
      }

      if (matches.length === 0) {
        // No matches remain — hide the whole gutter so an empty strip does not linger on screen.
        element.hidden = true;
        return;
      } else {
        // Matches exist: make the gutter visible again before repopulating it.
        element.hidden = false;
      }

      for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        // Possibly undefined under noUncheckedIndexedAccess; a hole in the list has no offset to place.
        if (match === undefined) {
          continue;
        } else {
          // A real match: build and position its tick below.
        }

        // Create a fresh tick div for this match rather than reusing nodes, consistent with the rebuild-above approach.
        const tick = doc.createElement('div');

        if (index === activeIndex) {
          // This is the currently highlighted match: give it the active class so its wider, solid style applies.
          tick.className = 'kdoc-match-tick kdoc-match-tick-active';
        } else {
          // Not the active match: use the default thin, semi-transparent tick styling.
          tick.className = 'kdoc-match-tick';
        }

        // Position by the match start as a percentage of document length; toFixed(3) keeps sub-pixel jitter out of the style string while staying precise enough for an overview strip.
        tick.style.top = (tickFraction(match.start, docLength) * 100).toFixed(3) + '%';

        // Append the positioned tick so it renders within the gutter.
        element.appendChild(tick);
      }
    },
    destroy(): void {
      if (element.parentNode !== null) {
        // The overlay is attached to the DOM: detach it so nothing remains on screen.
        element.parentNode.removeChild(element);
      } else {
        // The overlay was never inserted into a parent, so there is nothing to remove.
      }
    },
  };
}
