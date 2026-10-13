/**
 * @file plugin-syntax.ts
 * @purpose Draws the syntax one or more plugins added (FR-14.18) onto a copy of the tree about to be rendered, so a reader's document is never rewritten and every recognised run serialises back to exactly what it was written as.
 * @inputs An mdast Root that is already a clone made by html.ts before rendering; the syntaxes a plugin registered through plugin-protocol.readRegistration for its 'syntax' point.
 * @outputs void, mutating the copy in place so matched text runs become emphasis nodes carrying hName and className that mdast-util-to-hast draws with no renderer change.
 * @functions
 *   - MAX_MATCHES: The most matches one text run may produce before a pattern that matches everywhere stops sweeping.
 *   - PluginSyntax: One syntax a plugin added, naming what to look for plus the tag and class it is drawn as.
 *   - applyPluginSyntax: Draw every plugin syntax found in a tree, mutating the copy in place (FR-14.18).
 *   - splitText: Split one run of text on every plugin syntax that matches it, with the first registered winning each character.
 *   - splitOne: Split one run of text on one syntax, returning the same node when nothing matched at all.
 *   - drawn: Build the emphasis node a match is drawn as, carrying its hName and className in data.
 *   - hasChildren: Type guard for any node that carries children to recurse into.
 * @dataflow Clone handed by html.ts -> walk(parent) visits each parent's children -> splitText splits every text child on all syntaxes -> the rebuilt array is written back over the copy, leaving non-text nodes untouched.
 * @controlflow Return at once when there are no syntaxes; otherwise recurse through parents, rebuilding a new children array per parent and never touching root itself or any node outside this clone.
 * @version 1
 * @date 2026-09-18
 */

import type { Nodes, Parents, PhrasingContent, Root, Text } from 'mdast';

/** How many matches one text run may produce; a pattern that matches everywhere stops here. */
const MAX_MATCHES = 200;

/** One syntax a plugin added: what to look for, and what to draw it as (FR-14.18). */
export interface PluginSyntax {
  /** The unique id the plugin registered this syntax under through plugin-protocol.readRegistration. */
  readonly id: string;
  /** The source text pattern a run must contain before this syntax claims any of its characters. */
  readonly pattern: string;
  /** The element name mdast-util-to-hast emits for a match, one of the safe tags from plugin-protocol.SAFE_TAGS. */
  readonly tag: string;
  /** The class written into hProperties so styling can target matches without any renderer change. */
  readonly className: string;
}

/**
 * @purpose Draws every plugin syntax found in a tree, mutating the copy in place (FR-14.18).
 * @inputs root - The parsed mdast Root to annotate; it must be a clone so this never rewrites what was recognised from.
 * @inputs syntaxes - Every 'syntax' registration the plugins added, tried in order with the first registered winning each character.
 * @outputs void - Mutates the copy by replacing matched text runs with emphasis nodes carrying hName and className in data.
 * @dataflow root -> walk(parent) visits children -> splitText splits every text child on all syntaxes -> rebuilt array written back over the copy, leaving non-text nodes untouched.
 * @controlflow Return at once when there are no syntaxes so an ordinary document pays nothing; otherwise recurse through parents rebuilding each children array and never touching root itself or any node outside this clone.
 */
export function applyPluginSyntax(root: Root, syntaxes: readonly PluginSyntax[]): void {
  // The tree handed in is expected to be a copy of the document's parse, never the live editor view. html.ts clones
  // before it calls this for exactly the same reason applyMediaEmbeds is given a clone: drawing here must not rewrite
  // what was recognised from, so every run serialises back to the text it started as and no plugin can touch a reader's file.
  // A mutant that removed this guard survived, because a walk with nothing to look for puts every run of
  // text back exactly as it found it. It stays because it is what keeps a document with no plugins behind
  // it from being walked at all, which is the usual document.
  if (syntaxes.length === 0) {
    return;
  } else {
    // At least one syntax is registered: walk the whole tree below before returning.
  }

  function walk(parent: Parents): void {
    // Walk backwards so replacing one child cannot shift the children still to be looked at.
    for (let index = parent.children.length - 1; index >= 0; index -= 1) {
      const child = parent.children[index];

      // Check whether this child is a run of text, which is the only place a plugin's syntax can be written.
      if (child !== undefined && child.type === 'text') {
        const parts = splitText(child, syntaxes);

        // A run of text only sits where phrasing is allowed, and what it splits into is phrasing, so the
        // parts belong exactly where the run they came from did. The types cannot see that, because a
        // parent's children are typed as one union per kind of parent rather than by what they hold.
        parent.children.splice(index, 1, ...(parts as typeof parent.children));
      } else if (child !== undefined && hasChildren(child)) {
        // Something with children of its own: its text runs are inside it.
        walk(child);
      } else {
        // A leaf that is not text: nothing to draw and nothing to walk into.
      }
    }
  }

  walk(root);
}

/**
 * @purpose Splits one run of text on every plugin syntax that matches it (FR-14.18).
 * @inputs node - The single Text run to break apart into recognised and unrecognised pieces.
 * @inputs syntaxes - Every registered syntax, tried in order so the first one to claim a character wins it from later ones.
 * @outputs PhrasingContent[] - A new array of text nodes plus drawn emphasis nodes covering this run left to right.
 * @dataflow node -> start with [node] as parts -> for each syntax split every text part on that syntax and keep non-text parts -> returned parts carry no character claimed by two plugins.
 * @controlflow Keep the original single-node array when nothing matches so an unmarked document is not rebuilt; once one syntax claims a run it is never offered to the next, with explicit empty elses throughout.
 */
function splitText(node: Text, syntaxes: readonly PluginSyntax[]): PhrasingContent[] {
  // Start from just this node and let each syntax in turn break any text parts further while leaving non-text alone.
  let parts: PhrasingContent[] = [node];

  for (const syntax of syntaxes) {
    const nextParts = parts.flatMap((part): PhrasingContent[] => {
      if (part.type === 'text') {
        // A text part can be broken further, so split it on this one syntax and keep any pieces that survive.
        return splitOne(part, syntax);
      } else {
        // This part was already claimed by an earlier syntax or is non-text, so hand it through unchanged to the next syntax.
        return [part];
      }
    });

    parts = nextParts;
  }

  return parts;
}

/**
 * @purpose Splits one run of text on one syntax (FR-14.18).
 * @inputs node - The single Text run to break apart against this one pattern.
 * @inputs syntax - One registered syntax whose compiled pattern is swept across the run's value.
 * @outputs PhrasingContent[] - [node] unchanged when nothing matched, otherwise text pieces interleaved with drawn matches.
 * @dataflow node.value -> compile the pattern once in a guarded try -> sweep matches up to MAX_MATCHES -> interleave surviving text with drawn nodes -> return parts or the original node.
 * @controlflow Return early on an un-compilable pattern so this never throws over a reader's document; break on an empty match that would otherwise loop forever; keep [node] when nothing matched so no rebuild happens, every branch carrying its own comment.
 */
function splitOne(node: Text, syntax: PluginSyntax): PhrasingContent[] {
  // The protocol already compiled this pattern once, but it runs over a reader's document here and must not
  // throw either: a plugin that registered before an upgrade changed the regular expression engine would.
  let pattern: RegExp;

  try {
    pattern = new RegExp(syntax.pattern, 'g');
  } catch {
    return [node];
  }

  const value = node.value;
  // Each match is recorded where it was found. Looking the text up again afterwards would find the first
  // run that reads the same, which need not be the run that matched.
  const found: { readonly start: number; readonly text: string }[] = [];

  // Sweep every match up to MAX_MATCHES, so a pattern that matches everywhere costs a bounded amount.
  while (found.length < MAX_MATCHES) {
    const match = pattern.exec(value);

    // Check whether the sweep found anything more.
    if (match === null) {
      break;
    } else {
      // A match: it still has to cover at least one character to be worth drawing.
    }

    const text = match[0];

    // Check whether the pattern matched nothing at all, which would sweep for ever.
    if (text === '') {
      break;
    } else {
      // A real match: record where it sits.
    }

    found.push({ start: match.index, text });
  }

  // Check whether this run holds any of this syntax at all.
  if (found.length === 0) {
    // None: hand back the very node that came in, so a document with no plugin syntax in it is not rebuilt.
    // A mutant that rebuilt it anyway survived, because what it builds reads the same. This stays for the
    // same reason as the guard above: it is about what is done, not about what comes out.
    return [node];
  } else {
    // At least one: build the run again out of what was drawn and what was left alone.
  }

  const parts: PhrasingContent[] = [];
  let cursor = 0;

  for (const match of found) {
    // Check whether any text sits between where the last match ended and where this one starts.
    if (match.start > cursor) {
      parts.push({ type: 'text', value: value.slice(cursor, match.start) });
    } else {
      // This match begins where the last one ended: there is nothing between them.
    }

    parts.push(drawn(match.text, syntax));
    cursor = match.start + match.text.length;
  }

  // Check whether anything is left after the last match.
  if (cursor < value.length) {
    parts.push({ type: 'text', value: value.slice(cursor) });
  } else {
    // The last match ran to the end of the text.
  }

  return parts;
}

/**
 * @purpose Builds the node a match is drawn as (FR-14.18).
 * @inputs matched - The exact substring this syntax claimed, which must serialise back to what was written.
 * @inputs syntax - The registration telling which element and class to draw it with.
 * @outputs PhrasingContent - An emphasis node whose single text child holds the match and whose data carries hName and className.
 * @dataflow matched -> wrap in a Text node inside an Emphasis -> attach {hName, hProperties:{className:[...]}} to its data -> returned for insertion into the rebuilt children array.
 * @controlflow No branching is needed: assemble the emphasis shape with its borrowed child and hand back the fully formed node so hast draws it via hName alone.
 */
function drawn(matched: string, syntax: PluginSyntax): PhrasingContent {
  // The text a match holds must be exactly what was written so write-back round-trips to the original source run.
  const textChild: Text = { type: 'text', value: matched };

  // emphasis is only the shape borrowed to hold the children; hName in data is what mdast-util-to-hast actually draws,
  // so exports, printouts and slides all render it with no renderer change, exactly as block alignment does.
  const nodeData = {
    hName: syntax.tag,
    hProperties: { className: [syntax.className] },
  };

  return {
    type: 'emphasis',
    children: [textChild],
    data: nodeData,
  };
}

/** Says whether a node carries children to recurse into (FR-14.18). */
function hasChildren(node: Nodes): node is Parents {
  // A parent exposes a children array; every other node is phrasing or leaf content with none, so this guards the walk.
  return 'children' in node;
}
