/**
 * @file wikilink-links.ts
 * @purpose Rewrites K-Doc wikilinks ([[target]] and [[target|alias]]) in an mdast tree into ordinary CommonMark links to relative paths, so any Markdown reader can follow them; records which notes were linked or left unresolved via a note callback. Mutates the tree it is given in place.
 * @inputs An mdast Root node tree, a resolve function mapping a wikilink target ("Note" or "Note#Heading") to a URL string or null, and a NoteChange callback invoked with WIKILINK_LABEL strings as links are rewritten.
 * @outputs void; the input root's text nodes are split in place so every wikilink becomes a link node, and note() is called once per linked or unresolved wikilink.
 * @functions
 *   - ResolveWikiLink: Callback type mapping a wikilink target to a URL string or null (module contract).
 *   - WIKILINK_LABEL: Map of outcome kinds to human-readable labels describing the rewrite applied (module constant).
 *   - linkWikiLinks: Recursively rewrites every wikilink under root into a relative Markdown link (public entry point).
 *   - relativeLinkPath: Builds a forward-slash, percent-encoded relative path from one folder to a file on the same drive (public helper).
 * @dataflow External root + resolve + note -> recursive traversal splitting text nodes -> per-wikilink URL resolution -> replaced children spliced back into root.
 * @controlflow linkWikiLinks() recurses post-order through parents, skipping code/link/html nodes and splitting only text nodes; splitText() walks each match of the wikilink regex and emits preceding text plus a link node, or leaves embeds and unresolved targets alone. relativeLinkPath() shares a drive-letter prefix then joins '..' segments with the remaining percent-encoded destination path.
 * @version 1
 * @date 2026-09-18
 */

import type { Link, Parents, Root, RootContent, Text } from 'mdast';
import type { NoteChange } from './flavour-downgrades.js';

/** Records the outcome of a wikilink rewrite so callers can report changes to the user. */
export const WIKILINK_LABEL = {
  linked: 'wikilinks turned into links',
  unresolved: 'wikilinks that match no note, left as written',
} as const;

/** Maps a wikilink target ("Note" or "Note#Heading") to the URL to write, or null when it names no note. */
export type ResolveWikiLink = (target: string) => string | null;

/** Matches a single [[target]] or [[target|alias]] wikilink; group 1 is the target, group 2 the optional alias. The trailing 'g' flag is required for matchAll(). */
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

/** Links, whose own text cannot hold another link. Code, HTML and maths need no entry: they hold a value, not text children, so the walk never looks inside them. */
const SKIPPED = new Set(['link', 'linkReference']);

/**
 * Rewrites every K-Doc wikilink in an mdast tree into an ordinary CommonMark link to a relative path.
 *
 * @purpose Walks the whole subtree, recursing into container nodes and splitting only text nodes so that each [[target]] or [[target|alias]] becomes a [shown](url) link whose url is produced by resolve(); leaves code/link/html nodes untouched, skips embeds (![[...]]) so they do not become images, and records unresolved targets without rewriting them.
 * @inputs root - The mdast Root whose text nodes are split in place; the entire tree is visited regardless of depth.
 * @inputs resolve - Callback mapping a wikilink target ("Note" or "Note#Heading") to a URL string, or null when it names no note.
 * @inputs note - Callback invoked with a WIKILINK_LABEL string each time a wikilink is linked or left unresolved, so callers can report the change.
 * @outputs void; the input tree's text nodes are replaced in place and nothing is returned.
 * @dataflow root + resolve + note -> recursive visit() splitting text via splitText() -> per-wikilink URL resolution -> replaced children spliced back into each parent.
 * @controlflow visit() recurses post-order through parents, pushing skipped/leaf nodes unchanged and replacing text nodes with splitText()'s pieces; splitText() iterates the regex matches, skipping embeds and unresolved targets via continue, then emits preceding text plus a link node per match.
 */
export function linkWikiLinks(root: Root, resolve: ResolveWikiLink, note: NoteChange): void {
  visit(root);

  /**
   * Recursively rebuilds each parent's children array in place, recursing into containers and splitting text nodes of wikilinks.
   *
   * @purpose Walks the subtree under a parent node (post-order), skipping code/link/html nodes and replacing only text nodes with their wikilink-split pieces, then splices the rebuilt list back into parent.children.
   * @inputs parent - The mdast Parents node whose children array is replaced in place.
   * @outputs void; parent.children is reassigned to the rewritten list and nothing is returned.
   * @dataflow parent.children -> per-child recursion + text splitting -> new children array assigned back to parent.
   * @controlflow Iterate children in order; recurse into parents first (post-order) so nested wikilinks rewrite before their container, then push either the original child or splitText()'s replacements and replace parent.children wholesale.
   */
  function visit(parent: Parents): void {
    const next: RootContent[] = [];

    for (const child of parent.children as RootContent[]) {
      if (SKIPPED.has(child.type)) {
        // Branch: Child is a node type whose text can never be a wikilink; keep it unchanged.
        next.push(child);
      } else if (child.type === 'text') {
        // Branch: Text node; split out any embedded wikilinks and replace the node with the pieces.
        next.push(...splitText(child));
      } else if ('children' in child) {
        // Branch: Child is a container node; recurse so nested wikilinks are rewritten before this node.
        visit(child as Parents);
        next.push(child);
      } else {
        // Branch: Leaf node that is neither skipped nor text; keep it unchanged.
        next.push(child);
      }
    }

    (parent as { children: RootContent[] }).children = next;
  }

  /**
   * Splits a text node into runs of plain text and link nodes, converting each [[target]] or [[target|alias]] wikilink into a relative Markdown link.
   *
   * @purpose Scans the text for the wikilink pattern; leaves embeds (![[...]]) and targets that resolve to no note untouched, and replaces every other match with a preceding text run plus a link node whose shown text is the alias when present or the raw target otherwise.
   * @inputs node - The mdast Text node whose value is scanned and possibly split into multiple nodes.
   * @outputs RootContent[] - An array of text and link nodes in order; returns [node] unchanged when no wikilink matched.
   * @dataflow node.value -> per-match URL resolution via resolve() -> preceding/trailing text runs plus one link node assembled in document order.
   * @controlflow Walk each regex match, skipping embeds (continue) and unresolved targets (continue); emit the text before each match, build a link node, advance past it, then return all pieces or the original node when none matched.
   */
  function splitText(node: Text): RootContent[] {
    const parts: RootContent[] = [];
    let last = 0;

    for (const match of node.value.matchAll(WIKILINK)) {
      const start = match.index ?? 0;

      // An embed, ![[...]], is left alone: turning it into [..](..) after the ! would make it an image.
      if (start > 0 && node.value[start - 1] === '!') {
        // Branch: The wikilink is immediately preceded by '!', marking it as an embed; leave it untouched.
        continue;
      } else {
        // Branch: Not an embed; fall through to resolve and rewrite the wikilink below.
      }

      const target = (match[1] ?? '').trim();
      const url = resolve(target);

      if (url === null) {
        // Branch: The target matches no note; record it as unresolved and leave it written verbatim.
        note(WIKILINK_LABEL.unresolved);
        continue;
      } else {
        // Branch: The target resolves to a note; rewrite it into a link below.
      }

      note(WIKILINK_LABEL.linked);

      if (start > last) {
        // Branch: There is text before this wikilink; keep that run as a plain text node.
        parts.push({ type: 'text', value: node.value.slice(last, start) });
      } else {
        // Branch: No preceding text remains to emit for this wikilink.
      }

      const alias = match[2]?.trim();
      // Prefer the explicit alias when present; otherwise fall back to the raw target as the shown text.
      const shown = alias !== undefined && alias !== '' ? alias : target;
      const link: Link = { type: 'link', url, title: null, children: [{ type: 'text', value: shown }] };
      parts.push(link);
      last = start + match[0].length;
    }

    if (last === 0) {
      // Branch: No wikilink matched this text node; return it unchanged.
      return [node];
    } else {
      // Branch: Wikilinks were rewritten; append any trailing text below.
    }

    if (last < node.value.length) {
      // Branch: There is text after the last wikilink; keep that run as a plain text node.
      parts.push({ type: 'text', value: node.value.slice(last) });
    } else {
      // Branch: No trailing text remains to emit after the last wikilink.
    }

    return parts;
  }
}

/**
 * Builds the path from a folder to a file, with forward slashes and percent-encoded segments, for a link written in a file saved in that folder.
 *
 * @purpose Both inputs are absolute paths using either slash kind; it shares a drive-letter prefix (case-insensitive, as Windows does) then joins '..' segments for the folders only the source descends out of with the remaining percent-encoded destination path. On different drives there is no relative path, so the file's own path is returned unmodified except that its non-drive segments are percent-encoded.
 * @inputs fromFolder - Absolute folder path (the file being written lives here) using '/' or '\\'.
 * @inputs toFile - Absolute target file path using '/' or '\\'.
 * @outputs string - A forward-slash relative path with each destination segment percent-encoded, or the destination's own encoded path when no relative path exists.
 * @dataflow fromFolder + toFile -> split into segments -> shared-prefix scan -> '..' ups joined with percent-encoded remaining destination segments.
 * @controlflow Split both paths and drop empty parts; if either is empty or the drive letters differ, return the destination's own path (leaving its first segment unencoded); otherwise advance a shared counter while folder names match and the final destination segment is not consumed, then join the ups with the encoded remainder.
 */
export function relativeLinkPath(fromFolder: string, toFile: string): string {
  const split = (path: string): string[] => path.replace(/\\/g, '/').split('/').filter((part) => part !== '');

  const from = split(fromFolder);
  const to = split(toFile);

  if (from.length === 0 || to.length === 0 || (from[0] ?? '').toLowerCase() !== (to[0] ?? '').toLowerCase()) {
    // Branch: No relative path exists — an empty input or a different drive letter means the destination's own percent-encoded path is returned; the first segment (drive letter) is left unencoded because encoding it would turn "C:" into "C%3A".
    return to.map((part, index) => (index === 0 ? part : encodeURIComponent(part))).join('/');
  } else {
    // Branch: Same drive; compute a relative path from the shared folder prefix below.
  }

  let shared = 0;

  while (shared < from.length && shared < to.length - 1 && (from[shared] ?? '').toLowerCase() === (to[shared] ?? '').toLowerCase()) {
    // Advance the shared-prefix counter while consecutive folder names match and we have not consumed the destination's final segment.
    shared += 1;
  }

  const ups = from.slice(shared).map(() => '..');
  return [...ups, ...to.slice(shared).map(encodeURIComponent)].join('/');
}
