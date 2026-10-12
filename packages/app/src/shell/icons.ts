/**
 * @file icons.ts
 * @purpose Chrome line-icon set and SVG factory for the application interface (Material 3 Expressive restyle).
 * @inputs IconName identifiers, Document instances, and numeric dimensions.
 * @outputs IconName type, ICON_PATHS registry, createIcon factory, and isIconName type guard.
 * @functions
 *   - createIcon: Generates an SVGSVGElement configured with icon stroke geometry and dimensions.
 *   - isIconName: Type guard validating whether a string is a recognized IconName.
 * @dataflow IconName -> ICON_PATHS lookup -> SVG elements constructed via Document -> SVGSVGElement
 * @controlflow Module evaluated on import; functions invoked on demand by shell components.
 * @version 3
 * @date 2026-10-04
 */

export type IconName =
  | 'outline' | 'files' | 'search' | 'tags' | 'comments' | 'backlinks' | 'history' | 'metadata'
  | 'problems' | 'link-definitions' | 'plugins' | 'review' | 'tick' | 'chevron-down' | 'chevron-right'
  | 'close' | 'sun' | 'moon' | 'document' | 'bold' | 'italic' | 'strikethrough' | 'code'
  | 'clear-formatting' | 'align-left' | 'align-centre' | 'align-right' | 'blockquote'
  | 'bullet-list' | 'numbered-list' | 'outdent' | 'indent' | 'minimise' | 'maximise' | 'restore' | 'chevron-up';

/** Path data per icon, drawn on a 24-unit grid as 1.6-unit round strokes with no fill. */
export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = Object.freeze({
  outline: ['M4 6h16', 'M8 12h12', 'M8 18h12', 'M4 12h.01', 'M4 18h.01'],
  files: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  search: ['M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0', 'm20 20-4.2-4.2'],
  tags: ['M3 12V4h8l9 9-8 8z', 'M6.2 8.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0'],
  comments: ['M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  backlinks: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  history: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0', 'M12 7.5V12l3 2'],
  metadata: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0', 'M12 11v5', 'M12 8h.01'],
  problems: ['M12 4 2.8 19.5h18.4z', 'M12 10v4', 'M12 17h.01'],
  'link-definitions': ['M7 4h10v16l-5-3.5L7 20z'],
  plugins: ['M5.5 4h3.5a1.5 1.5 0 0 1 1.5 1.5V9a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 9V5.5A1.5 1.5 0 0 1 5.5 4z', 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9a1.5 1.5 0 0 1-1.5 1.5H15A1.5 1.5 0 0 1 13.5 9V5.5A1.5 1.5 0 0 1 15 4z', 'M5.5 13.5h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 9 20H5.5A1.5 1.5 0 0 1 4 18.5V15a1.5 1.5 0 0 1 1.5-1.5z', 'M15 13.5h3.5A1.5 1.5 0 0 1 20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5V15a1.5 1.5 0 0 1 1.5-1.5z'],
  review: ['M4 20h4L19 9l-4-4L4 16z', 'm13.5 6.5 4 4'],
  tick: ['m5 12.5 4.5 4.5L19 7.5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-up': ['m6 15 6-6 6 6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  sun: ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M12 2.5v2', 'M12 19.5v2', 'M4.6 4.6l1.4 1.4', 'M18 18l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.6 19.4 6 18', 'M18 6l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  document: ['M7 3h7l4 4v14H7z', 'M14 3v4h4'],
  bold: ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'],
  italic: ['M10 5h8', 'M6 19h8', 'M14 5l-4 14'],
  strikethrough: ['M4 12h16', 'M16 7.5A4 4 0 0 0 12 5c-2.5 0-4 1.4-4 3.2', 'M8 16.5A4 4 0 0 0 12 19c2.5 0 4-1.4 4-3.2'],
  code: ['m8 8-4 4 4 4', 'm16 8 4 4-4 4', 'M13.5 6l-3 12'],
  'clear-formatting': ['M6 5h12', 'M12 5 9 19', 'M4 4l16 16'],
  'align-left': ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h10'],
  'align-centre': ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
  'align-right': ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M10 18h10'],
  blockquote: ['M5 7h5v5H7.5L6 16', 'M14 7h5v5h-2.5L15 16'],
  'bullet-list': ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M4 18a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  'numbered-list': ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 4.5 5.5 4v4', 'M4 13.2a1.3 1.3 0 1 1 2.2 1L4 16.5h2.5'],
  outdent: ['M4 6h16', 'M11 10h9', 'M11 14h9', 'M4 18h16', 'M8 9l-3 3 3 3'],
  indent: ['M4 6h16', 'M11 10h9', 'M11 14h9', 'M4 18h16', 'M5 9l3 3-3 3'],
  minimise: ['M6 12h12'],
  maximise: ['M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
  restore: ['M8 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M10 6h7a2 2 0 0 1 2 2v7'],
});

// SVG namespace required by createElementNS.
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an SVGSVGElement for the specified icon and renders its stroke geometry.
 * @purpose Generates an SVG DOM element configured with the icon path elements and standard chrome styling.
 * @inputs doc - The Document context used to create elements.
 *         name - The icon identifier corresponding to an entry in ICON_PATHS.
 *         size - Optional icon width and height in pixels (defaults to 20).
 * @outputs SVGSVGElement - The configured SVG element.
 * @dataflow name -> ICON_PATHS path lookup -> createElementNS path elements -> appendChild to SVG -> SVGSVGElement
 * @controlflow Guard size -> create SVG -> set SVG attributes -> loop through path definitions -> append path -> return SVG.
 */
export function createIcon(doc: Document, name: IconName, size: number = 20): SVGSVGElement {
  // Guard check: verify that size is a positive finite number; throws RangeError if non-positive, NaN, or non-finite.
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`Icon size must be a positive number, got ${size}`);
  }

  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'kdoc-icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const paths = ICON_PATHS[name];
  // Iterate through each SVG path definition string and append a configured path element to the SVG container.
  for (const d of paths) {
    const p = doc.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }

  return svg;
}

/**
 * Type guard checking if an arbitrary string corresponds to a valid IconName.
 * @purpose Determines whether a given string key exists in ICON_PATHS.
 * @inputs value - String identifier to validate.
 * @outputs value is IconName - True if value is a valid IconName, narrowing the type.
 * @dataflow value -> Object.prototype.hasOwnProperty check on ICON_PATHS -> boolean
 * @controlflow Perform prototype property check and return boolean result.
 */
export function isIconName(value: string): value is IconName {
  // Test whether value is an own property of ICON_PATHS.
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, value);
}
