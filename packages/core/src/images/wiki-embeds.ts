/**
 * @file wiki-embeds.ts
 * @purpose Reads Markdown wiki image embeds (`![[img.png|600]]`, FR-8.15) as plain text for the editor to draw and exports to expand into mdast images, always writing back exactly what was read.
 * @inputs raw Markdown strings, mdast Root trees, alt-slot widths (via image-hints.ts).
 * @outputs WikiEmbed targets/widths, split text-and-embed parts, cloned Roots with embeds expanded into image nodes.
 * @functions
 *   - isWikiImageTarget: Says whether an embed target names a picture K-Doc can draw.
 *   - parseWikiEmbed: Reads the text between `![[` and `]]` into a target and optional width hint.
 *   - wikiEmbedText: Serializes a WikiEmbed back to its exact source text.
 *   - splitWikiEmbeds: Cuts a string into plain-text stretches and embed parts in order.
 *   - expandWikiEmbeds: Clones a Root, replacing each wiki image embed with an ordinary image node.
 * @dataflow Markdown text -> EMBED regex -> parseWikiEmbed -> WikiEmbed; Root -> structuredClone -> expandIn -> cloned Root of images.
 * @controlflow pure functions; splitWikiEmbeds uses RegExp.exec in a while loop over lastIndex so the source is never rewritten.
 * @version 1
 * @date 2026-09-18
 */

import type { Image, Nodes, Paragraph, PhrasingContent, Root, Text } from 'mdast';

// The file extensions K-Doc recognises as pictures inside a wiki embed; kept lowercase so membership tests ignore case.
export const WIKI_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'];

// EMBED - `![[` then anything but `]` or a newline, then `]]`. The inside cannot hold `]`, so the first
// closing pair is always the right one and a malformed embed cannot swallow the rest of the line.
const EMBED = /!\[\[([^\]\n]+)\]\]/g;

// A width is 1 to 5 digits with no leading zero, the same rule image-hints.ts uses for the alt slot, so a
// hint written by one is read by the other.
const WIDTH = /^[1-9]\d{0,4}$/;

export interface WikiEmbed {
  readonly target: string;
  readonly width: number | null;
}

export type WikiEmbedPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'embed'; readonly embed: WikiEmbed };

/**
 * @purpose Says whether an embed's target names a picture, which is the only kind of embed K-Doc draws.
 * @inputs target - The filename held inside wiki-embed brackets, possibly with no extension or naming a note.
 * @returns true when the lowercased extension names one of WIKI_IMAGE_EXTENSIONS; false otherwise.
 * @dataflow target -> lastIndexOf('.') -> slice after the dot -> toLowerCase -> membership test against WIKI_IMAGE_EXTENSIONS.
 * @controlflow Rejects targets with no usable extension (dot at 0 or absent), then compares the extension to the allowed set. A target naming a note is left as the text it is: K-Doc does not transclude notes, and drawing a broken picture in place of the words the reader wrote would be worse than leaving them alone.
 */
export function isWikiImageTarget(target: string): boolean {
  const dot = target.lastIndexOf('.');
  // Check whether the target has an extension at all. A dot at the very start is part of the name.
  if (dot <= 0) {
    return false;
  } else {
    // It has one: fall through to compare it, without its case, against the extensions K-Doc can draw below.
  }
  return WIKI_IMAGE_EXTENSIONS.includes(target.slice(dot + 1).toLowerCase());
}

/**
 * @purpose Reads what is between `![[` and `]]` into a target and an optional width hint.
 * @inputs inside - The raw text held between the embed brackets, which may carry a trailing `|width`.
 * @returns A WikiEmbed with parsed target and width, or null when the text does not name a picture.
 * @dataflow inside -> lastIndexOf('|') -> split into head/tail -> validate as a picture plus optional width -> {target, width}.
 * @controlflow Considers only the LAST pipe, and only when what follows it is a width: `![[Some Note|a caption]]` keeps its pipe in the target rather than losing the caption to a width that was never there. A target naming something other than a picture returns null.
 */
export function parseWikiEmbed(inside: string): WikiEmbed | null {
  const bar = inside.lastIndexOf('|');
  // Check whether there is a pipe that could be carrying a width hint.
  if (bar < 0) {
    const whole = inside.trim();
    // Check whether the whole of it names a picture.
    if (!isWikiImageTarget(whole)) {
      return null;
    } else {
      // It does: an embed with no width hint, written back bare.
    }
    return { target: whole, width: null };
  } else {
    // There is a pipe: what follows it is a width only when it reads as one, decided below.
  }

  const tail = inside.slice(bar + 1).trim();
  const head = inside.slice(0, bar).trim();

  // Check whether what follows the last pipe is a width. Anything else is part of the target, pipe and all.
  if (!WIDTH.test(tail)) {
    const whole = inside.trim();
    // Check whether the whole of it, pipe included, names a picture.
    if (!isWikiImageTarget(whole)) {
      return null;
    } else {
      // It does: an embed whose target happens to hold a pipe, with no width hint.
    }
    return { target: whole, width: null };
  } else {
    // It is a width: the target is what came before the pipe, validated below.
  }

  // Check whether the target before the pipe names a picture.
  if (!isWikiImageTarget(head)) {
    return null;
  } else {
    // It does: an embed with a valid width hint to write back.
  }

  return { target: head, width: Number(tail) };
}

/**
 * @purpose Writes an embed back as the text a Markdown file holds.
 * @inputs embed - The parsed WikiEmbed whose target and optional width are serialized.
 * @returns `![[target]]` when width is null, otherwise `![[target|width]]`, exactly what parseWikiEmbed would read again.
 * @dataflow embed -> template literal with a pipe only when width is present -> string.
 * @controlflow Writes bare brackets without a width; inserts the pipe and width after it when one exists.
 */
export function wikiEmbedText(embed: WikiEmbed): string {
  // Check whether there is a width to write. Without one the embed is written as bare as it was read.
  if (embed.width === null) {
    return `![[${embed.target}]]`;
  } else {
    // There is: the width goes after a pipe, which is where parseWikiEmbed looks for it.
    return `![[${embed.target}|${embed.width}]]`;
  }
}

/**
 * @purpose Cuts a run of text into the plain stretches between wiki image embeds and the embeds themselves.
 * @inputs value - A raw Markdown string that may contain one or more `![[...]]` wiki embeds.
 * @returns An ordered list of text parts and embed parts; an empty array means no content at all.
 * @dataflow value -> EMBED regex matches in order -> parseWikiEmbed each inside -> {text, embed} parts pushed sequentially.
 * @controlflow A string holding no embed comes back as ONE text part holding the whole of it, so a caller can tell "nothing here" from "something here" by the length alone; an embed whose target is not a picture is left in the text part it came from.
 */
export function splitWikiEmbeds(value: string): readonly WikiEmbedPart[] {
  const parts: WikiEmbedPart[] = [];
  let plain = 0;
  // EMBED carries the /g flag, so it remembers where the last scan reached. The loop below always runs
  // until exec returns null, which resets that itself, so a mutant removing this line could not be
  // killed. It stays because the cost is one assignment and the bug it prevents - a shared regex reading
  // from the middle of the next string, should an early return ever be added below - is one of the
  // hardest there is to see.
  EMBED.lastIndex = 0;
  let match = EMBED.exec(value);

  while (match !== null) {
    const inside = match[1] ?? '';
    const embed = parseWikiEmbed(inside);

    // Check whether this is an embed K-Doc draws. One that is not stays in the text, untouched.
    if (embed !== null) {
      const before = value.slice(plain, match.index);
      // Check whether any plain text came before this embed.
      if (before !== '') {
        parts.push({ kind: 'text', value: before });
      } else {
        // The embed starts where the last one ended, or at the very beginning; no leading text part is emitted.
      }
      parts.push({ kind: 'embed', embed });
      plain = match.index + match[0].length;
    } else {
      // Not a picture: leave it where it is, to be carried out with the plain text around it later.
    }

    match = EMBED.exec(value);
  }

  const rest = value.slice(plain);
  // Check whether anything is left after the last embed. An empty tail would make an empty text node,
  // which mdast allows but nothing downstream wants.
  if (rest !== '') {
    parts.push({ kind: 'text', value: rest });
  } else {
    // Nothing left: the run ended with an embed, so no trailing text part is emitted.
  }

  return parts;
}

/**
 * @purpose Lists every picture a tree embeds with `![[...]]`, in document order and without repeats (FR-8.15).
 * @inputs root - The mdast Root to read; it is not modified.
 * @outputs readonly string[] - Each embed's target, once, in the order the document first names it.
 * @dataflow Root -> walk text nodes -> splitWikiEmbeds -> embed targets -> deduplicated list.
 * @controlflow An export collects the pictures it has to read by walking image nodes, which a wiki embed is not one of until it is expanded; this is how those addresses are found without expanding the tree first.
 */
export function wikiEmbedTargets(root: Root): readonly string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  const visit = (node: Nodes): void => {
    // Check whether this is a run of text that might name a picture.
    if (node.type === 'text') {
      for (const part of splitWikiEmbeds(node.value)) {
        // Check whether this part is an embed rather than a stretch of plain text.
        if (part.kind === 'embed' && !seen.has(part.embed.target)) {
          seen.add(part.embed.target);
          targets.push(part.embed.target);
        } else {
          // Plain text, or a picture already named earlier in the document.
        }
      }
      return;
    } else {
      // Not text: look inside it for one below.
    }

    // Check whether this node can hold children at all.
    if ('children' in node) {
      for (const child of node.children) {
        visit(child);
      }
    } else {
      // A leaf with no subtree: there is nothing further to look at.
    }
  };

  visit(root);
  return targets;
}

/**
 * @purpose Replaces each text child holding a wiki image embed with the nodes it stands for, and recurses.
 * @inputs node - The current mdast node on the cloned tree being rewritten in place.
 * @returns void; mutates node.children only when one of its text children held an expandable embed.
 * @dataflow child.text.value -> splitWikiEmbeds -> {text, image} nodes written back onto node.children.
 * @controlflow Skips leaves (no children); for each child either rewrites a text run into images or recurses deeper without changing the tree when nothing matched.
 */
function expandIn(node: Nodes): void {
  // Check whether this node can hold children at all. A leaf has no text child to rewrite.
  if (!('children' in node)) {
    return;
  } else {
    // It can: look at each child in turn and rebuild the array below.
  }

  const rebuilt: Nodes[] = [];
  let changed = false;

  for (const child of node.children) {
    // Check whether this child is a run of text that might hold an embed.
    if (child.type === 'text') {
      const parts = splitWikiEmbeds(child.value);
      // Check whether anything was found. One part means the whole run was plain text.
      if (parts.length === 1 && parts[0]?.kind === 'text') {
        rebuilt.push(child);
      } else {
        changed = true;
        for (const part of parts) {
          // Check which kind of part this is: a stretch of plain text, or an embed to draw.
          if (part.kind === 'text') {
            const text: Text = { type: 'text', value: part.value };
            rebuilt.push(text);
          } else {
            // An embed: an image whose alt slot carries the width hint, which is where the renderer reads it.
            // The ternary writes the hint only when there is one, so an embed that was never resized
            // expands to an image with an empty alt rather than a stray pipe.
            const alt = part.embed.width === null ? '' : `|${part.embed.width}`;
            const image: Image = { type: 'image', url: part.embed.target, alt, title: null };
            rebuilt.push(image);
          }
        }
      }
    } else {
      // Not a text child: recurse so embeds nested deeper are expanded too.
      expandIn(child);
      rebuilt.push(child);
    }
  }

  // Check whether any child was actually replaced. A tree with no embeds keeps the very children it had.
  if (changed) {
    const parent = node as Paragraph;
    parent.children = rebuilt as unknown as PhrasingContent[];
  } else {
    // Nothing changed: leave the children array alone so untouched subtrees are not reallocated.
  }
}

/**
 * @purpose Produces a copy of a tree in which every wiki image embed has become an ordinary image node, so
 *   what is exported or printed draws the picture rather than the brackets around its name.
 * @inputs root - The original mdast Root owned by the editor; it must not be mutated.
 * @returns A deep-cloned Root with each wiki image embed replaced by an image node carrying a width in its alt slot.
 * @dataflow Root -> structuredClone -> expandIn traversal -> cloned Root ready for export or printing.
 * @controlflow The tree is CLONED first, because the reader's own document must not gain nodes just because something was exported from it; the width hint is written into the alt slot in the shape image-hints.ts already reads, so nothing further is needed to make it a width attribute.
 */
export function expandWikiEmbeds(root: Root): Root {
  const copy = structuredClone(root);
  expandIn(copy);
  return copy;
}
