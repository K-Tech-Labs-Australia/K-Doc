/**
 * @file typography.ts
 * @purpose Applies appearance settings to the editor DOM and implements zoom ladder calculations (FR-14.11, FR-14.12).
 * @inputs AppearanceSettings configuration object, zoom numeric multiplier, reading width mode, and HTMLElement root.
 * @outputs CSS custom properties set on root element, calculated zoom step values, rem reading measures, and TYPOGRAPHY_STYLES stylesheet.
 * @functions
 *   - zoomIn: Advances to the next zoom step above the current value, capping at the maximum step.
 *   - zoomOut: Steps down to the next zoom step below the current value, flooring at the minimum step.
 *   - clampZoom: Snaps an arbitrary zoom value to the nearest discrete step in the zoom ladder.
 *   - readingWidthRem: Maps a reading width setting to its corresponding measure in rem units.
 *   - applyTypography: Binds appearance settings and zoom level to CSS custom properties on a root DOM element.
 * @dataflow AppearanceSettings & zoom level -> clampZoom / readingWidthRem / quoteFontFamily -> CSS custom properties -> root.style.
 * @controlflow Parse settings -> quote font families defensively -> calculate effective font size and reading width -> apply CSS custom properties to root element.
 * @version 2
 * @date 2026-09-16
 */

import type { AppearanceSettings } from '@k-doc/config';

/**
 * Zoom multipliers the steps walk through.
 *
 * Zoom is structured as a discrete ladder rather than a continuous multiplier: every step
 * has to land on a font size that still renders crisply and keeps the reading measure sensible,
 * and a free-form value reached by repeated 10% increments accumulates float error until the
 * displayed percentage stops matching the size.
 */
export const ZOOM_STEPS: readonly number[] = Object.freeze([
  0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
]);

/**
 * Default zoom factor (1.0 = 100%).
 */
export const DEFAULT_ZOOM: number = 1;

/**
 * Snaps an arbitrary zoom value to the nearest discrete step in the zoom ladder.
 *
 * Snapping rather than clamping-to-range means a value restored from settings that predates
 * a change to the ladder still lands somewhere sane.
 *
 * @purpose Snaps a numeric zoom factor to the nearest discrete step in ZOOM_STEPS.
 * @inputs value - The numeric zoom factor to snap.
 * @outputs number - The closest step from ZOOM_STEPS.
 * @dataflow value -> calculate absolute difference against each step -> return step with minimal difference.
 * @controlflow Guard initial step -> iterate steps comparing distance -> update nearest when smaller -> return nearest step.
 */
export function clampZoom(value: number): number {
  const firstStep = ZOOM_STEPS[0];
  // Check if ZOOM_STEPS has a first step defined to initialize distance tracking safely.
  if (firstStep !== undefined) {
    let nearest: number = firstStep;
    let minDiff: number = Math.abs(value - firstStep);

    // Iterate through all steps in the ladder to find the closest one.
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      const step = ZOOM_STEPS[i];
      // Check if step at index is defined to guard indexed access under strict compiler settings.
      if (step !== undefined) {
        const diff = Math.abs(value - step);
        // Check if the current step is strictly closer to the target value than the current nearest step.
        if (diff < minDiff) {
          minDiff = diff;
          nearest = step;
        } else {
          // Distance is greater or equal: retain current nearest step.
        }
      } else {
        // Step at index is undefined: skip index.
      }
    }
    return nearest;
  } else {
    // ZOOM_STEPS is unexpectedly empty: fallback to DEFAULT_ZOOM.
    return DEFAULT_ZOOM;
  }
}

/**
 * Returns the next zoom step above the nearest current step, or the largest when already there.
 *
 * Both zoomIn and zoomOut guard every indexed access.
 *
 * @purpose Advances the zoom factor to the next higher discrete step in ZOOM_STEPS.
 * @inputs current - The current zoom factor (snapped to nearest step before advancing).
 * @outputs number - The next step in ZOOM_STEPS or the maximum step.
 * @dataflow current -> snap to nearest step -> locate step index in ladder -> return next step or max step.
 * @controlflow Snap current zoom -> find matching index -> if not at max, return next step -> else return largest step.
 */
export function zoomIn(current: number): number {
  const nearest = clampZoom(current);
  let nearestIndex = -1;

  // Scan ZOOM_STEPS to find the index of the nearest snapped step.
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const step = ZOOM_STEPS[i];
    // Check if step at current index matches the nearest value.
    if (step === nearest) {
      nearestIndex = i;
      break;
    } else {
      // Step does not match: continue scanning ladder.
    }
  }

  // Check if a matching step index was found and whether a higher step exists in the ladder.
  if (nearestIndex !== -1 && nearestIndex < ZOOM_STEPS.length - 1) {
    const nextStep = ZOOM_STEPS[nearestIndex + 1];
    // Check if the next step is defined to guard indexed access.
    if (nextStep !== undefined) {
      return nextStep;
    } else {
      // Guarded indexed access was undefined: fallback to nearest step.
      return nearest;
    }
  } else {
    // Already at the largest step or index not found: return the largest step in the ladder.
    const lastStep = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    // Check if the last step is defined to guard indexed access.
    if (lastStep !== undefined) {
      return lastStep;
    } else {
      // Guarded indexed access was undefined: fallback to nearest step.
      return nearest;
    }
  }
}

/**
 * Returns the previous zoom step below the nearest current step, or the smallest when already there.
 *
 * Both zoomIn and zoomOut guard every indexed access.
 *
 * @purpose Decrements the zoom factor to the next lower discrete step in ZOOM_STEPS.
 * @inputs current - The current zoom factor (snapped to nearest step before decrementing).
 * @outputs number - The previous step in ZOOM_STEPS or the minimum step.
 * @dataflow current -> snap to nearest step -> locate step index in ladder -> return previous step or min step.
 * @controlflow Snap current zoom -> find matching index -> if not at min, return previous step -> else return smallest step.
 */
export function zoomOut(current: number): number {
  const nearest = clampZoom(current);
  let nearestIndex = -1;

  // Scan ZOOM_STEPS to find the index of the nearest snapped step.
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const step = ZOOM_STEPS[i];
    // Check if step at current index matches the nearest value.
    if (step === nearest) {
      nearestIndex = i;
      break;
    } else {
      // Step does not match: continue scanning ladder.
    }
  }

  // Check if a matching step index was found and whether a lower step exists in the ladder.
  if (nearestIndex > 0) {
    const prevStep = ZOOM_STEPS[nearestIndex - 1];
    // Check if the previous step is defined to guard indexed access.
    if (prevStep !== undefined) {
      return prevStep;
    } else {
      // Guarded indexed access was undefined: fallback to nearest step.
      return nearest;
    }
  } else {
    // Already at the smallest step or index not found: return the smallest step in the ladder.
    const firstStep = ZOOM_STEPS[0];
    // Check if the first step is defined to guard indexed access.
    if (firstStep !== undefined) {
      return firstStep;
    } else {
      // Guarded indexed access was undefined: fallback to nearest step.
      return nearest;
    }
  }
}

/**
 * Maps a reading width setting to its corresponding measure in rem units.
 *
 * @purpose Converts semantic reading width presets ('narrow', 'medium', 'wide', 'full') to numeric rem values.
 * @inputs width - ReadingWidth union member from AppearanceSettings.
 * @outputs number | null - Width measure in rem units, or null for 'full', which has no measure.
 * @dataflow width identifier -> exhaustive switch mapping -> numeric rem value.
 * @controlflow Switch over width variants without a default branch -> return rem measure for matched member.
 */
export function readingWidthRem(width: AppearanceSettings['readingWidth']): number | null {
  // Each union member is covered explicitly with no default branch so that adding a member
  // to the ReadingWidth union in the schema later becomes a compile-time type error rather
  // than a silent fallthrough.
  // The measures (roughly 34 / 42 / 60 rem for narrow / medium / wide) are chosen deliberately around
  // the typographic standard of a 60-75 character measure that reads comfortably without causing
  // visual tracking fatigue, rather than being picked arbitrarily.
  switch (width) {
    case 'narrow':
      // Narrow reading column measure (approx. 34 rem, ~50-60 CPL).
      return 34;
    case 'medium':
      // Medium reading column measure (approx. 42 rem, ~65-75 CPL), matching default document preview.
      return 42;
    case 'wide':
      // Wide reading column measure (approx. 60 rem, ~90-100 CPL).
      return 60;
    case 'full':
      // Full width has no measure at all. Returning a number here would mean inventing an absurd one
      // (10000rem and the like), which reads as a measurement but is really a stand-in for "no limit".
      // null says that plainly, and applyTypography turns it into `max-width: none`.
      return null;
  }
}

/**
 * Maps a display density to the space between blocks, in em (FR-14.13).
 *
 * The space is in em rather than px so it tracks the font size and the zoom, which px would not.
 * Comfortable is 1em, the spacing the editor has always used, so the default changes nothing.
 *
 * @purpose Converts a density preset ('compact', 'comfortable', 'spacious') to the block spacing in em.
 * @inputs density - Density union member from AppearanceSettings.
 * @outputs number - The space below each block, in em.
 * @dataflow density identifier -> exhaustive switch mapping -> em value.
 * @controlflow Switch over density variants without a default branch -> return the spacing for the matched member.
 */
export function blockSpacingEm(density: AppearanceSettings['density']): number {
  // Each union member is covered explicitly with no default branch, so adding a member to the Density
  // union in the schema later becomes a compile-time error rather than a silent fallthrough.
  switch (density) {
    case 'compact':
      // Packed: paragraphs sit close enough to fit more of the document on screen.
      return 0.5;
    case 'comfortable':
      // The spacing the editor used before density existed, so this default changes nothing.
      return 1;
    case 'spacious':
      // Opened up: more air between blocks for reading and for reviewing.
      return 1.6;
  }
}

/**
 * Quotes a font family name defensively if it contains whitespace and is not already enclosed in quotes.
 *
 * @purpose Ensures multi-word font family names produce valid CSS declarations.
 * @inputs family - The raw font family name string to check and quote if necessary.
 * @outputs string - The safely formatted font family name string.
 * @dataflow family string -> whitespace and quote inspection -> wrap in single quotes if unquoted multi-word -> formatted string.
 * @controlflow Trim input -> check if already enclosed in single or double quotes -> if unquoted and contains whitespace, wrap in single quotes -> else return trimmed.
 */
function quoteFontFamily(family: string): string {
  const trimmed = family.trim();
  // Check if the font family name is already enclosed in matching single quotes.
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    // Already enclosed in single quotes: return trimmed directly.
    return trimmed;
  } else {
    // Check if the font family name is already enclosed in matching double quotes.
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
      // Already enclosed in double quotes: return trimmed directly.
      return trimmed;
    } else {
      // Check if unquoted family name contains whitespace characters.
      // Quote the family names defensively: wrap each in quotes only when it contains a space
      // and is not already quoted. An unquoted multi-word family name is invalid CSS and the whole
      // declaration is dropped, which looks like the setting being ignored.
      if (/\s/.test(trimmed)) {
        // Multi-word unquoted family name: wrap in single quotes.
        return `'${trimmed}'`;
      } else {
        // Single-word font family name: no quotation required.
        return trimmed;
      }
    }
  }
}

/**
 * Applies typography and zoom appearance settings as CSS custom properties on the root element.
 *
 * @purpose Binds appearance settings and current zoom factor to CSS custom properties on the provided root DOM element.
 * @inputs root - The HTMLElement onto which CSS custom properties are set.
 * @inputs appearance - AppearanceSettings configuration containing font families, base size, line height, and reading width.
 * @inputs zoom - Zoom multiplier to snap and apply to the base editor font size.
 * @outputs void.
 * @dataflow appearance + zoom -> quote font families & clamp zoom & calculate rem width -> assign custom properties to root.style.
 * @controlflow Quote editor & monospace font families defensively -> append fallback stacks -> calculate effective font size -> set custom properties on root.style.
 */
export function applyTypography(
  root: HTMLElement,
  appearance: AppearanceSettings,
  zoom: number,
): void {
  // Quote the family names defensively: wrap each in quotes only when it contains a space and is not already quoted.
  // An unquoted multi-word family name is invalid CSS and the whole declaration is dropped,
  // which looks like the setting being ignored.
  const quotedEditor = quoteFontFamily(appearance.editorFontFamily);
  const quotedMono = quoteFontFamily(appearance.monospaceFontFamily);

  // A font the user names may not be installed and an unresolvable family silently falls back
  // to the browser default rather than to anything chosen. Append real fallback stacks.
  const editorFontStack = `${quotedEditor}, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const monoFontStack = `${quotedMono}, ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace`;

  // Zoom multiplies the font size rather than applying a CSS transform: scale, because a transform
  // scales the pixel grid and makes text blurry, while a font-size change re-lays-out and re-rasterises
  // at the new size.
  const effectiveFontSizePx = appearance.editorFontSizePx * clampZoom(zoom);

  root.style.setProperty('--kdoc-editor-font', editorFontStack);
  root.style.setProperty('--kdoc-mono-font', monoFontStack);
  root.style.setProperty('--kdoc-editor-font-size', `${effectiveFontSizePx}px`);
  root.style.setProperty('--kdoc-line-height', String(appearance.lineHeight));
  root.style.setProperty('--kdoc-block-spacing', `${blockSpacingEm(appearance.density)}em`);
  const measure = readingWidthRem(appearance.readingWidth);
  // Check whether this reading width has a measure at all.
  if (measure === null) {
    // 'full' means no limit, which in CSS is the keyword rather than a very large length.
    root.style.setProperty('--kdoc-reading-width', 'none');
  } else {
    // Every other width is a real measure in rem.
    root.style.setProperty('--kdoc-reading-width', `${measure}rem`);
  }
}

/**
 * Static stylesheet consuming typography CSS custom properties with fallbacks so the editor
 * remains readable before applyTypography has run.
 *
 * The Source pane deliberately shares the size and line height but not the reading width,
 * because a wrapped code line that stops mid-pane is harder to scan than one that uses the full width.
 */
export const TYPOGRAPHY_STYLES: string = `
/* The Source pane deliberately shares the size and line height but not the reading width,
   because a wrapped code line that stops mid-pane is harder to scan than one that uses the full width. */
.kdoc-pane .ProseMirror,
.kdoc-pane .cm-content {
  font-family: var(--kdoc-editor-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
  font-size: var(--kdoc-editor-font-size, 16px);
  line-height: var(--kdoc-line-height, 1.6);
}

.kdoc-pane .ProseMirror {
  max-width: var(--kdoc-reading-width, 42rem);
  margin: 0 auto;
}

/* Density (FR-14.13). These selectors are one class more specific than the shell's own
   .ProseMirror p rule, so they win wherever the two stylesheets end up ordered.
   Only the top-level blocks are spaced: a paragraph inside a list item keeps the list's own rhythm. */
.kdoc-pane .ProseMirror > p,
.kdoc-pane .ProseMirror > blockquote,
.kdoc-pane .ProseMirror > pre,
.kdoc-pane .ProseMirror > ul,
.kdoc-pane .ProseMirror > ol,
.kdoc-pane .ProseMirror > table,
.kdoc-pane .ProseMirror > .kdoc-callout {
  margin-top: 0;
  margin-bottom: var(--kdoc-block-spacing, 1em);
}

code,
pre,
.cm-content {
  font-family: var(--kdoc-mono-font, ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace);
}
`;
