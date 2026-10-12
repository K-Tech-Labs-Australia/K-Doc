/**
 * @file sanitize.ts
 * @purpose Allow-list that K-Doc applies to rendered HTML so a document's raw HTML can never run script. Provides the rehype-sanitize schema, an iframe/style hardening transformer, and CSS escaping for theme stylesheets.
 * @inputs Raw hast trees produced by rehype-raw; inline style strings; candidate iframe src values; theme CSS text.
 * @outputs KDOC_SANITIZE_SCHEMA (rehype-sanitize options), rehypeKdocHardening (unified attacher), and pure helper functions/constants.
 * @functions
 *   - EMBED_FRAME_PATTERNS: Frozen list of the only iframe player URL shapes permitted.
 *   - ALLOWED_STYLE_PROPERTIES: Set of CSS properties permitted in inline style attributes.
 *   - isEmbedFrameSource: Tests whether a value is an allowed iframe source URL.
 *   - filterStyle: Reduces an inline style string to allow-listed, safe declarations.
 *   - KDOC_SANITIZE_SCHEMA: The rehype-sanitize schema derived from defaultSchema.
 *   - rehypeKdocHardening: Unified attacher dropping disallowed iframes, sandboxing allowed ones, filtering styles.
 *   - escapeStyleContent: Prevents CSS text from closing the style element it is written into.
 * @dataflow hast tree (post rehype-raw) -> rehype-sanitize with KDOC_SANITIZE_SCHEMA -> rehypeKdocHardening -> stringify.
 * @controlflow Module load builds the schema once; at render time the hardening transformer walks the tree recursively, filtering children then recursing into elements.
 * @version 1
 * @date 2026-10-07
 */

import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import type { Element, ElementContent, Root, RootContent } from 'hast';

/**
 * Player URLs that may be framed. These are exactly the player URLs
 * media-embeds.ts builds (providerEmbedOf); nothing else may be framed.
 */
export const EMBED_FRAME_PATTERNS: readonly RegExp[] = Object.freeze([
  /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,20}$/,
  /^https:\/\/player\.vimeo\.com\/video\/[0-9]{1,12}$/,
]);

/** CSS properties permitted inside an inline style attribute. */
export const ALLOWED_STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  'text-align',
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration',
  'vertical-align',
  'white-space',
  'width',
  'height',
  'max-width',
  'min-width',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-collapse',
  'border-color',
  'border-style',
  'border-width',
  'float',
  'clear',
  'list-style-type',
  'line-height',
  'letter-spacing',
]);

/** Sandbox tokens applied to every allowed iframe. */
const IFRAME_SANDBOX: readonly string[] = ['allow-scripts', 'allow-same-origin', 'allow-presentation', 'allow-popups'];

/** Referrer policy applied to every allowed iframe. */
const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** Declared values matching this are rejected (url(), expression(), javascript:, backslash, angle brackets, @). */
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|[\\<>@]/i;

/** Element type of the attribute definitions record in the sanitize schema. */
type AttributeDefinitions = NonNullable<SanitizeSchema['attributes']>[string];

/**
 * @purpose Decide whether a value is an allowed iframe source URL.
 * @inputs src - Any candidate value (typically an element property).
 * @outputs boolean - true only for a string matching an EMBED_FRAME_PATTERNS entry.
 * @dataflow src -> typeof check -> pattern tests -> boolean.
 * @controlflow Returns false early for non-strings; otherwise true if any pattern matches.
 */
export function isEmbedFrameSource(src: unknown): boolean {
  // Check the value is a string: non-strings can never be an allowed source, so reject.
  if (typeof src !== 'string') {
    return false;
  }
  // Test each allowed pattern: any match means the source is allowed.
  return EMBED_FRAME_PATTERNS.some((pattern: RegExp): boolean => pattern.test(src));
}

/**
 * @purpose Reduce an inline style string to allow-listed, safe declarations.
 * @inputs value - Raw style attribute text.
 * @outputs string - Kept declarations joined by '; ', or '' when none survive.
 * @dataflow value -> split on ';' -> per-declaration property/value parse -> allow-list and unsafe-value checks -> joined kept list.
 * @controlflow Loops over parts; skips empty parts, malformed parts, disallowed properties, empty values and unsafe values.
 */
export function filterStyle(value: string): string {
  const kept: string[] = [];
  for (const rawPart of value.split(';')) {
    const part = rawPart.trim();
    // Check for an empty declaration: skip it.
    if (part === '') {
      continue;
    }
    const idx = part.indexOf(':');
    // Check there is a property name before a colon: if not (no colon or leading colon) skip it.
    if (idx <= 0) {
      continue;
    }
    const property = part.slice(0, idx).trim().toLowerCase();
    const declared = part.slice(idx + 1).trim();
    // Check the property is allow-listed and has a value: otherwise skip it.
    if (!ALLOWED_STYLE_PROPERTIES.has(property) || declared === '') {
      continue;
    }
    // Check the value for script/exfiltration vectors: if present skip it, else keep it.
    if (UNSAFE_STYLE_VALUE.test(declared)) {
      continue;
    }
    kept.push(`${property}: ${declared}`);
  }
  return kept.join('; ');
}

/**
 * @purpose Copy the default per-tag attribute rules with every className rule removed.
 * @inputs None (reads defaultSchema.attributes).
 * @outputs Record of tag name to attribute definitions without ['className', ...] entries.
 * @dataflow defaultSchema.attributes entries -> filter out className rules -> new record.
 * @controlflow Iterates every tag entry; keeps each definition unless it is an array whose first element is 'className'.
 */
function withoutClassNameRules(): Record<string, AttributeDefinitions> {
  const result: Record<string, AttributeDefinitions> = {};
  for (const [tag, defs] of Object.entries(defaultSchema.attributes ?? {})) {
    // '*' below allows any className; constrained per-tag rules would otherwise drop classes such as code.math-inline.
    result[tag] = defs.filter(
      (def): boolean => !(Array.isArray(def) && def[0] === 'className'),
    );
  }
  return result;
}

/**
 * @purpose Build the K-Doc sanitize schema from the rehype-sanitize default schema.
 * @inputs None (reads defaultSchema).
 * @outputs SanitizeSchema - The K-Doc allow-list.
 * @dataflow defaultSchema -> stripped attribute rules -> extended tags/attributes/protocols -> schema object.
 * @controlflow Straight-line construction; '??' fallbacks supply empty lists when defaults are absent.
 */
function buildSchema(): SanitizeSchema {
  const strippedDefaults = withoutClassNameRules();
  return {
    ...defaultSchema,
    tagNames: [
      ...(defaultSchema.tagNames ?? []),
      'mark',
      'u',
      'abbr',
      'small',
      'cite',
      'figure',
      'figcaption',
      'caption',
      'video',
      'audio',
      'iframe',
    ],
    attributes: {
      ...strippedDefaults,
      '*': [...(strippedDefaults['*'] ?? []), 'className', 'style'],
      a: [...(strippedDefaults['a'] ?? []), 'href'],
      img: [...(strippedDefaults['img'] ?? []), 'src', 'loading'],
      video: ['src', 'controls', 'poster', 'preload', 'loop', 'muted'],
      audio: ['src', 'controls', 'preload', 'loop', 'muted'],
      source: [...(strippedDefaults['source'] ?? []), 'src', 'type'],
      iframe: ['src', 'allowFullScreen', 'loading', 'title'],
    },
    // Single letters are Windows drive letters ("C:/notes/a.md" parses as protocol "c"), so local
    // absolute links survive while javascript:, vbscript: and data: links do not. There is
    // deliberately NO `src` entry: an img/video/audio src cannot run script, and exports embed
    // data: URIs and local drive-letter paths; iframe src is checked separately by rehypeKdocHardening.
    protocols: {
      // Both cases: the sanitizer compares protocols case-sensitively and drive letters are usually upper case.
      href: ['http', 'https', 'mailto', ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')],
      cite: ['http', 'https'],
      longDesc: ['http', 'https'],
    },
    // remark-rehype already prefixes footnote ids, and heading/TOC anchors must keep the ids the document links to.
    clobberPrefix: '',
    clobber: [],
    // Stripped with contents so CSS or script text never shows as words.
    strip: ['script', 'style', 'template', 'noscript', 'textarea', 'title'],
    required: defaultSchema.required,
    ancestors: defaultSchema.ancestors,
  };
}

/** The allow-list schema K-Doc passes to rehype-sanitize. */
export const KDOC_SANITIZE_SCHEMA: SanitizeSchema = buildSchema();

/**
 * @purpose Decide whether a child node survives hardening, mutating allowed iframes and element styles in place.
 * @inputs child - A hast child node.
 * @outputs boolean - false when the node must be dropped.
 * @dataflow child -> iframe source check -> sandbox/referrer assignment -> style filtering -> keep flag.
 * @controlflow Non-elements are kept; disallowed iframes are dropped; allowed iframes get sandbox attributes; string styles are filtered or removed.
 */
function keep(child: RootContent | ElementContent): boolean {
  // Check the node type: non-element nodes (text, comment, ...) are always kept.
  if (child.type !== 'element') {
    return true;
  }
  // Check for an iframe: its source decides whether it is dropped or hardened.
  if (child.tagName === 'iframe') {
    // Check the iframe src against the embed allow-list: if not allowed, drop the frame entirely.
    if (!isEmbedFrameSource(child.properties['src'])) {
      return false;
    }
    // Allowed frame: force sandbox and referrer policy.
    // hast holds sandbox as a token list; the stringifier joins it with spaces.
    child.properties['sandbox'] = [...IFRAME_SANDBOX];
    child.properties['referrerPolicy'] = IFRAME_REFERRER_POLICY;
  }
  const style = child.properties['style'];
  // Check for a string style: filter it; other values are left untouched.
  if (typeof style === 'string') {
    const filtered = filterStyle(style);
    // Check whether anything survived: if nothing, remove the attribute; otherwise store the filtered text.
    if (filtered === '') {
      delete child.properties['style'];
    } else {
      child.properties['style'] = filtered;
    }
  }
  return true;
}

/**
 * @purpose Recursively filter a parent's children with keep() and descend into the surviving elements.
 * @inputs parent - Root or Element whose subtree is hardened in place.
 * @outputs void (mutates the tree).
 * @dataflow parent.children -> filter(keep) -> recurse into element children.
 * @controlflow Filters first, then recurses into each child of type 'element'.
 */
function harden(parent: Root | Element): void {
  // Check the parent kind so the filtered array is assigned with its precise child type.
  if (parent.type === 'root') {
    // Root parent: filter root-level children.
    parent.children = parent.children.filter(keep);
  } else {
    // Element parent: filter element children.
    parent.children = parent.children.filter(keep);
  }
  for (const child of parent.children) {
    // Check the child kind: only elements can have children to harden.
    if (child.type === 'element') {
      harden(child);
    }
  }
}

/**
 * @purpose Unified attacher that hardens a sanitized hast tree (iframe allow-list, sandboxing, style filtering).
 * @inputs None (no options).
 * @outputs A transformer (tree: Root) => void.
 * @dataflow Attached to the unified pipeline; transformer receives the hast root and mutates it.
 * @controlflow Returns a transformer that delegates to harden(tree).
 */
export function rehypeKdocHardening(): (tree: Root) => void {
  return (tree: Root): void => {
    harden(tree);
  };
}

/**
 * @purpose Neutralise any closing style tag so theme CSS cannot escape the style element it is written into.
 * @inputs css - Stylesheet text.
 * @outputs string - CSS with each '</style' rewritten to '<\/style' (case preserved).
 * @dataflow css -> regex replace -> escaped css.
 * @controlflow Single global, case-insensitive replacement; no branching.
 */
export function escapeStyleContent(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}
