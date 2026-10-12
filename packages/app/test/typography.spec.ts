// @vitest-environment jsdom

/**
 * @file typography.spec.ts
 * @purpose Vitest test suite for zoom ladder operations, reading width conversions, typography styling application, and stylesheet fallbacks (FR-14.11, FR-14.12).
 * @inputs AppearanceSettings overrides, DOM HTMLElement container, zoom multipliers, and CSS custom property declarations.
 * @outputs Vitest assertions verifying zoom ladder discrete stepping, reading width mappings, CSS custom property bindings, and stylesheet fallback definitions.
 * @functions
 *   - appearanceWith: Returns AppearanceSettings with specified overrides merged over DEFAULT_SETTINGS.appearance.
 * @dataflow AppearanceSettings & zoom multipliers -> appearanceWith / typography utilities -> DOM element styles / assertions.
 * @controlflow Execute describe suites: zoom ladder invariants -> reading width rem mappings -> applyTypography DOM property updates -> stylesheet fallback integrity.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@k-doc/config';
import {
  blockSpacingEm,
  ZOOM_STEPS,
  DEFAULT_ZOOM,
  zoomIn,
  zoomOut,
  clampZoom,
  readingWidthRem,
  applyTypography,
  TYPOGRAPHY_STYLES,
} from '../src/shell/typography.js';

/**
 * Merges partial AppearanceSettings overrides over the default appearance configuration.
 *
 * @purpose Produces an AppearanceSettings object with specific overrides applied over default settings for testing.
 * @inputs overrides - Partial appearance settings to merge over DEFAULT_SETTINGS.appearance.
 * @outputs AppearanceSettings - Complete appearance settings configuration record.
 * @dataflow overrides -> object spread over DEFAULT_SETTINGS.appearance -> new AppearanceSettings record.
 * @controlflow Shallow merge overrides over DEFAULT_SETTINGS.appearance -> return resulting settings object.
 */
function appearanceWith(overrides: Partial<AppearanceSettings>): AppearanceSettings {
  return { ...DEFAULT_SETTINGS.appearance, ...overrides };
}

describe('the zoom ladder', () => {
  it('defines DEFAULT_ZOOM as 1 and contains it within ZOOM_STEPS', () => {
    expect(DEFAULT_ZOOM).toBe(1);
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM);
  });

  it('maintains ZOOM_STEPS in strictly ascending order', () => {
    // zoomIn/zoomOut walk it by index, so an unsorted ladder would make zooming in sometimes shrink the text.
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      const prev = ZOOM_STEPS[i - 1];
      const curr = ZOOM_STEPS[i];

      // Check whether both adjacent step entries are defined to guard indexed reads under noUncheckedIndexedAccess.
      if (prev !== undefined && curr !== undefined) {
        // zoomIn/zoomOut walk it by index, so an unsorted ladder would make zooming in sometimes shrink the text.
        expect(curr).toBeGreaterThan(prev);
      } else {
        // Guard failure: one or both adjacent zoom steps are unexpectedly undefined.
        throw new Error('ZOOM_STEPS entries must be defined numbers');
      }
    }
  });

  it('steps up and down from DEFAULT_ZOOM using adjacent values in ZOOM_STEPS', () => {
    const defaultIndex = ZOOM_STEPS.indexOf(DEFAULT_ZOOM);

    // Check if DEFAULT_ZOOM was found and is not at the boundary of ZOOM_STEPS.
    if (defaultIndex > 0 && defaultIndex < ZOOM_STEPS.length - 1) {
      const stepAbove = ZOOM_STEPS[defaultIndex + 1];
      const stepBelow = ZOOM_STEPS[defaultIndex - 1];

      // Check if adjacent steps are defined under strict indexed access.
      if (stepAbove !== undefined && stepBelow !== undefined) {
        expect(zoomIn(DEFAULT_ZOOM)).toBe(stepAbove);
        expect(zoomOut(DEFAULT_ZOOM)).toBe(stepBelow);
      } else {
        // Guard failure: adjacent step is undefined.
        throw new Error('Adjacent zoom steps must be defined');
      }
    } else {
      // Guard failure: DEFAULT_ZOOM is not within interior bounds of ZOOM_STEPS.
      throw new Error('DEFAULT_ZOOM must be located at an interior index of ZOOM_STEPS');
    }
  });

  it('caps zoomIn at the largest step and floors zoomOut at the smallest step', () => {
    const smallestStep = ZOOM_STEPS[0];
    const largestStep = ZOOM_STEPS[ZOOM_STEPS.length - 1];

    // Check if boundary zoom steps are defined under noUncheckedIndexedAccess.
    if (smallestStep !== undefined && largestStep !== undefined) {
      expect(zoomIn(largestStep)).toBe(largestStep);
      expect(zoomOut(smallestStep)).toBe(smallestStep);
    } else {
      // Guard failure: boundary zoom steps are undefined.
      throw new Error('Boundary zoom steps must be defined');
    }
  });

  it('snaps intermediate values to the nearer step and out-of-range values to the nearest end', () => {
    const smallestStep = ZOOM_STEPS[0];
    const largestStep = ZOOM_STEPS[ZOOM_STEPS.length - 1];

    // Check if boundary zoom steps are defined under noUncheckedIndexedAccess.
    if (smallestStep !== undefined && largestStep !== undefined) {
      // Snapping rather than rejecting means a value restored from settings written against an older ladder still lands somewhere sane.
      expect(clampZoom(1.04)).toBe(1);
      expect(clampZoom(1.08)).toBe(1.1);
      expect(clampZoom(-5)).toBe(smallestStep);
      expect(clampZoom(0.1)).toBe(smallestStep);
      expect(clampZoom(100)).toBe(largestStep);
    } else {
      // Guard failure: boundary zoom steps are undefined.
      throw new Error('Boundary zoom steps must be defined');
    }
  });

  it('returns exactly to the start after repeated zoomIn then zoomOut', () => {
    let zoom = 1;
    zoom = zoomIn(zoom);
    zoom = zoomIn(zoom);
    zoom = zoomIn(zoom);
    zoom = zoomOut(zoom);
    zoom = zoomOut(zoom);
    zoom = zoomOut(zoom);

    // This is the whole reason the ladder is discrete: repeated ±10% on a float drifts,
    // and the displayed percentage stops matching the size.
    expect(zoom).toBe(1);
  });
});

describe('blockSpacingEm', () => {
  // Every density has to give a different spacing, or the setting would do nothing for one of them.
  it('gives each density its own spacing', () => {
    const spacings = [blockSpacingEm('compact'), blockSpacingEm('comfortable'), blockSpacingEm('spacious')];
    expect(new Set(spacings).size).toBe(3);
  });

  // Comfortable is the spacing the editor had before density existed, so the default changes nothing.
  it('leaves the default spacing at the 1em the editor always used', () => {
    expect(blockSpacingEm(DEFAULT_SETTINGS.appearance.density)).toBe(1);
    expect(blockSpacingEm('comfortable')).toBe(1);
  });

  // Tighter has to mean less space and looser more, or the names are the wrong way round.
  it('orders the densities from tightest to loosest', () => {
    expect(blockSpacingEm('compact')).toBeLessThan(blockSpacingEm('comfortable'));
    expect(blockSpacingEm('comfortable')).toBeLessThan(blockSpacingEm('spacious'));
  });
});

describe('readingWidthRem', () => {
  it('orders narrow, medium, and wide in strictly increasing numeric order', () => {
    const narrow = readingWidthRem('narrow');
    const medium = readingWidthRem('medium');
    const wide = readingWidthRem('wide');

    expect(typeof narrow).toBe('number');
    expect(typeof medium).toBe('number');
    expect(typeof wide).toBe('number');

    // Check that reading widths are not null before comparing their numeric measures.
    if (narrow !== null && medium !== null && wide !== null) {
      expect(narrow).toBeLessThan(medium);
      expect(medium).toBeLessThan(wide);
    } else {
      // Guard failure: one or more non-full reading widths unexpectedly returned null.
      throw new Error('narrow, medium, and wide reading widths must return numeric rem measures');
    }
  });

  it("returns null for 'full' reading width", () => {
    const full = readingWidthRem('full');

    // full has no measure at all, and returning a number would mean inventing an absurd one
    // that reads like a measurement but is really a stand-in for "no limit".
    expect(full).toBeNull();
  });
});

describe('applyTypography', () => {
  it('sets all expected CSS custom properties on the target element', () => {
    const el = document.createElement('div');
    applyTypography(el, DEFAULT_SETTINGS.appearance, 1);

    expect(el.style.getPropertyValue('--kdoc-editor-font')).not.toBe('');
    expect(el.style.getPropertyValue('--kdoc-mono-font')).not.toBe('');
    expect(el.style.getPropertyValue('--kdoc-editor-font-size')).not.toBe('');
    expect(el.style.getPropertyValue('--kdoc-line-height')).not.toBe('');
    expect(el.style.getPropertyValue('--kdoc-reading-width')).not.toBe('');
  });

  it('sets the block spacing from the density', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ density: 'spacious' }), 1);
    expect(el.style.getPropertyValue('--kdoc-block-spacing')).toBe(`${blockSpacingEm('spacious')}em`);

    applyTypography(el, appearanceWith({ density: 'compact' }), 1);
    expect(el.style.getPropertyValue('--kdoc-block-spacing')).toBe(`${blockSpacingEm('compact')}em`);
  });

  it('multiplies base font size by zoom factor', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ editorFontSizePx: 16 }), 1.5);
    expect(el.style.getPropertyValue('--kdoc-editor-font-size')).toBe('24px');
  });

  it('quotes multi-word font family names in CSS declarations', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ editorFontFamily: 'Segoe UI' }), 1);

    // An unquoted multi-word family is invalid CSS and the whole declaration is dropped,
    // which looks exactly like the setting being ignored.
    expect(el.style.getPropertyValue('--kdoc-editor-font')).toContain("'Segoe UI'");
  });

  it('does not quote single-word font family names', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ editorFontFamily: 'Georgia' }), 1);
    const fontValue = el.style.getPropertyValue('--kdoc-editor-font');

    expect(fontValue.startsWith('Georgia,')).toBe(true);
    expect(fontValue.includes("'Georgia'")).toBe(false);
  });

  it('does not double-quote an already-quoted font family name', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ editorFontFamily: "'Fira Sans'" }), 1);
    const fontValue = el.style.getPropertyValue('--kdoc-editor-font');

    expect(fontValue).not.toContain("''");
    expect(fontValue).toContain("'Fira Sans'");
  });

  it('appends fallback font stacks to both editor and monospace font families', () => {
    const el = document.createElement('div');
    applyTypography(el, DEFAULT_SETTINGS.appearance, 1);

    // A font the user names may not be installed, and without a fallback the browser silently
    // uses its own default rather than anything chosen.
    expect(el.style.getPropertyValue('--kdoc-editor-font')).toContain('sans-serif');
    expect(el.style.getPropertyValue('--kdoc-mono-font')).toContain('monospace');
  });

  it("sets reading width to 'none' when readingWidth is 'full'", () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ readingWidth: 'full' }), 1);
    expect(el.style.getPropertyValue('--kdoc-reading-width')).toBe('none');
  });

  it('snaps off-ladder zoom values to a discrete ladder step before computing font size', () => {
    const el = document.createElement('div');
    applyTypography(el, appearanceWith({ editorFontSizePx: 16 }), 1.37);
    const snappedStep = clampZoom(1.37);
    const expectedPx = `${16 * snappedStep}px`;
    const offLadderPx = `${16 * 1.37}px`;

    expect(el.style.getPropertyValue('--kdoc-editor-font-size')).toBe(expectedPx);
    expect(el.style.getPropertyValue('--kdoc-editor-font-size')).not.toBe(offLadderPx);
  });
});

describe('TYPOGRAPHY_STYLES', () => {
  it('ensures every CSS custom property var() expression carries a fallback', () => {
    // The fallback is what keeps the editor readable in the window between first paint and applyTypography running.
    const unfallbackPattern = /var\(--kdoc-[a-z-]+\)/;
    expect(TYPOGRAPHY_STYLES).toContain('var(--kdoc-');
    expect(TYPOGRAPHY_STYLES).not.toMatch(unfallbackPattern);
  });
});
