/**
 * @file flavour-downgrades.ts
 * @purpose Rewrites a Markdown (mdast) tree so it only uses constructs a target flavour supports, converting K-Doc inline nodes, maths, GFM tables/footnotes/task lists, and front matter into HTML or CommonMark equivalents. Mutates the tree it is given in place.
 * @inputs An mdast Root node tree and a note callback invoked with a DOWNGRADE_LABEL string each time a construct is rewritten.
 * @outputs void; the input root's children are replaced in place with downgraded nodes, and note() is called once per rewrite performed.
 * @functions
 *   - NoteChange: Callback type recording which downgrade was applied (module contract).
 *   - DOWNGRADE_LABEL: Map of construct kinds to human-readable labels describing the HTML fallback used (module constant).
 *   - downgradeForGfm: Rewrites K-Doc inline nodes and maths for a GFM-supporting flavour.
 *   - downgradeForCommonMark: Rewrites K-Doc inline nodes, maths, and GFM constructs for plain CommonMark.
 *   - rewrite: Recursively rewrites each child of a parent node using a per-node rule (module-private).
 *   - html: Builds an mdast html node from raw markup (module-private).
 *   - kdocInline: Rewrites highlight/subscript/superscript inline nodes into HTML tags (module-private).
 *   - mathAsCode: Rewrites inlineMath/math nodes into code spans or fenced code blocks (module-private).
 *   - footnoteNumbers: Assigns sequential numbers to every footnote reference and definition in the tree (module-private).
 *   - gfmConstruct: Rewrites tables, strikethrough, footnotes, task lists, and front matter for CommonMark (module-private).
 * @dataflow External root + note callback -> rewrite traversal -> per-node downgrade rules -> mutated root children with note() side effects.
 * @controlflow Each public entry builds a rule chain and calls rewrite; rewrite recurses into parents then applies the rule to each child, splicing replacements back in place.
 * @version 1
 * @date 2026-09-18
 */

import type { Code, Html, InlineCode, ListItem, Nodes, Paragraph, Parents, Root, RootContent, Table } from 'mdast';
import { renderFragment } from '../render/html.js';

/** Records which downgrade was applied; the label is one of the DOWNGRADE_LABEL values describing the HTML fallback used. */
export type NoteChange = (label: string) => void;

/** Human-readable labels describing what each rewrite fell back to, keyed by construct kind so callers can report changes. */
export const DOWNGRADE_LABEL = {
  tables: 'tables written as HTML',
  footnotes: 'footnotes written as HTML',
  strikethrough: 'strikethrough written as HTML',
  tasks: 'task list checkboxes written as text',
  frontMatter: 'front matter written as an HTML comment',
  highlight: 'highlighting written as HTML',
  script: 'subscript and superscript written as HTML',
  math: 'maths written as code',
} as const;

/**
 * Rewrites a Markdown tree so it only uses constructs supported by a GFM flavour.
 *
 * @purpose Applies the K-Doc inline downgrade (highlight/subscript/superscript) and the maths-as-code downgrade to every node under root, mutating the tree in place; does not touch tables, footnotes, task lists, or front matter because GFM supports those natively.
 * @inputs root - The mdast Root whose children are rewritten in place.
 * @inputs note - Callback invoked with a DOWNGRADE_LABEL string each time a construct is downgraded, so callers can surface the change to the user.
 * @outputs void; the input tree is mutated and nothing is returned.
 * @dataflow root + note -> rewrite traversal applying kdocInline then mathAsCode per node -> replaced children spliced back into root.
 * @controlflow Build a two-rule chain (kdocInline, then mathAsCode) and hand it to rewrite; rewrite recurses through the tree replacing matched nodes.
 */
export function downgradeForGfm(root: Root, note: NoteChange): void {
  rewrite(root, (node) => kdocInline(node, note) ?? mathAsCode(node, note));
}

/**
 * Rewrites a Markdown tree so it only uses constructs supported by plain CommonMark.
 *
 * @purpose Applies the K-Doc inline downgrade, the maths-as-code downgrade, and the GFM construct downgrade (tables, strikethrough, footnotes, task lists, front matter) to every node under root, mutating the tree in place; CommonMark lacks all of these so each is rewritten to HTML or text.
 * @inputs root - The mdast Root whose children are rewritten in place.
 * @inputs note - Callback invoked with a DOWNGRADE_LABEL string each time a construct is downgraded, so callers can surface the change to the user.
 * @outputs void; the input tree is mutated and nothing is returned.
 * @dataflow root + note -> footnote numbering pass -> rewrite traversal applying kdocInline, mathAsCode, then gfmConstruct per node -> replaced children spliced back into root.
 * @controlflow Number footnotes once up front, build a three-rule chain (kdocInline, mathAsCode, gfmConstruct), and hand it to rewrite; recurse through the tree replacing matched nodes.
 */
export function downgradeForCommonMark(root: Root, note: NoteChange): void {
  const numbers = footnoteNumbers(root);
  rewrite(root, (node) => kdocInline(node, note) ?? mathAsCode(node, note) ?? gfmConstruct(node, numbers, note));
}

/** A per-node rewrite rule: return an array of replacement nodes to splice in, or null to leave the node untouched. */
type Rewrite = (node: RootContent) => RootContent[] | null;

/**
 * Recursively rewrites each child of a parent node using a per-node rule, replacing matched children in place.
 *
 * @purpose Walks the subtree rooted at parent, recursing into any child that itself has children and then applying rule to every child, splicing the returned replacements back into parent.children so the tree is mutated in place.
 * @inputs parent - The mdast Parents node whose children array is rebuilt in place.
 * @inputs rule - Per-node rewrite rule; returning null keeps a child unchanged, returning an array replaces it.
 * @outputs void; parent.children is reassigned to the rewritten list and nothing is returned.
 * @dataflow parent.children -> per-child recursion + rule application -> new children array assigned back to parent.
 * @controlflow Iterate children in order; recurse into parents first (post-order) so nested nodes downgrade before their container; push either the original child or the rule's replacements, then replace parent.children wholesale.
 */
function rewrite(parent: Parents, rule: Rewrite): void {
  const next: RootContent[] = [];

  for (const child of parent.children as RootContent[]) {
    if ('children' in child) {
      // Branch: Child is itself a container node; recurse so its descendants downgrade before this node.
      rewrite(child as Parents, rule);
    } else {
      // Branch: Child is a leaf; there are no nested nodes to downgrade.
    }

    const replaced = rule(child);

    if (replaced === null) {
      // Branch: Rule left the child unchanged; keep it as-is.
      next.push(child);
    } else {
      // Branch: Rule produced replacements; splice them in place of the original child.
      next.push(...replaced);
    }
  }

  (parent as { children: RootContent[] }).children = next;
}

/**
 * Builds an mdast html node from a raw markup string.
 *
 * @purpose Wraps arbitrary HTML fragments (open/close tags, footnote wrappers) as an mdast `html` node so they survive the tree and render verbatim.
 * @inputs value - The raw HTML fragment to embed.
 * @outputs Html - An mdast html node carrying the fragment in its value field.
 * @dataflow Raw string -> wrapped into a typed html node.
 * @controlflow Single object construction with no branching.
 */
function html(value: string): Html {
  return { type: 'html', value };
}

/**
 * Rewrites K-Doc highlight, subscript, and superscript inline nodes into HTML tags.
 *
 * @purpose Converts the three K-Doc inline node types to their closest CommonMark/HTML equivalents by wrapping their children in `<mark>`, `<sub>`, or `<sup>` tags; returns null for any other node type so later rules can handle it.
 * @inputs node - The mdast node under consideration.
 * @inputs note - Callback invoked with the relevant DOWNGRADE_LABEL when a downgrade happens, so callers can report it.
 * @outputs RootContent[] | null - An array of [open tag, original children, close tag] nodes for highlight/subscript/superscript, or null otherwise.
 * @dataflow Node -> matched to an HTML tag name and label -> children spliced between open/close html nodes -> replacement array returned.
 * @controlflow Branch on node.type; return null immediately when the type is not one of the three handled kinds (guard), else set the tag, record the downgrade via note(), and assemble the wrapper.
 */
function kdocInline(node: RootContent, note: NoteChange): RootContent[] | null {
  let tag: string;

  if (node.type === 'highlight') {
    // Branch: Highlight node; map it to an HTML <mark> tag and record the highlight downgrade.
    tag = 'mark';
    note(DOWNGRADE_LABEL.highlight);
  } else if (node.type === 'subscript') {
    // Branch: Subscript node; map it to an HTML <sub> tag and record the script downgrade.
    tag = 'sub';
    note(DOWNGRADE_LABEL.script);
  } else if (node.type === 'superscript') {
    // Branch: Superscript node; map it to an HTML <sup> tag and record the script downgrade.
    tag = 'sup';
    note(DOWNGRADE_LABEL.script);
  } else {
    // Branch: Node is not highlight/subscript/superscript; leave it for later rules.
    return null;
  }

  return [html(`<${tag}>`), ...(node.children as RootContent[]), html(`</${tag}>`)];
}

/**
 * Rewrites maths nodes into code so plain CommonMark renders them verbatim instead of failing.
 *
 * @purpose Converts inlineMath to an inlineCode span and math to a fenced code block tagged `math`, recording the downgrade each time; returns null for any non-maths node so later rules can handle it.
 * @inputs node - The mdast node under consideration.
 * @inputs note - Callback invoked with the math DOWNGRADE_LABEL when a downgrade happens, so callers can report it.
 * @outputs RootContent[] | null - A single-element array containing an inlineCode or code node for maths nodes, or null otherwise.
 * @dataflow Node -> matched to inline vs block form -> value copied into an inlineCode/code node -> replacement array returned.
 * @controlflow Branch on node.type; return null when it is not inlineMath or math (guard), else record the downgrade and build the appropriate code node.
 */
function mathAsCode(node: RootContent, note: NoteChange): RootContent[] | null {
  if (node.type === 'inlineMath') {
    // Branch: Inline maths; render it as an inline code span so the expression survives verbatim.
    note(DOWNGRADE_LABEL.math);
    const code: InlineCode = { type: 'inlineCode', value: node.value };
    return [code];
  } else if (node.type === 'math') {
    // Branch: Block maths; render it as a fenced code block tagged `math` to preserve the expression.
    note(DOWNGRADE_LABEL.math);
    const block: Code = { type: 'code', lang: 'math', meta: null, value: node.value };
    return [block];
  } else {
    // Branch: Node is not maths; leave it for later rules.
    return null;
  }
}

/**
 * Assigns a sequential number to every footnote reference and definition in the tree, preserving document order.
 *
 * @purpose Walks the whole tree twice (once for references, once for definitions) and assigns each unique identifier an incrementing index starting at 1, so footnotes can be rewritten with stable `<sup id="fnref-n">` / `id="fn-n"` anchors.
 * @inputs root - The mdast Root to scan; the entire tree is visited regardless of depth.
 * @outputs Map<string, number> - Maps each footnote identifier to its assigned 1-based number.
 * @dataflow root -> two DFS passes (references then definitions) -> unique identifiers numbered in first-seen order -> populated map returned.
 * @controlflow Define a recursive visitor that records an identifier the first time it sees it and recurses into any node with children; run it for footnoteReference then footnoteDefinition, so references are numbered before their matching definitions.
 */
function footnoteNumbers(root: Root): Map<string, number> {
  const numbers = new Map<string, number>();

  function visit(node: Nodes, type: 'footnoteReference' | 'footnoteDefinition'): void {
    // Both target node types expose an `identifier`; read it through a targeted assertion so the map key is typed without widening to any.
    const identifier = (node as Extract<Nodes, { identifier: string }>).identifier;

    if (node.type === type && !numbers.has(identifier)) {
      // Branch: Node is the target type and not yet numbered; assign it the next sequential number.
      numbers.set(identifier, numbers.size + 1);
    } else {
      // Branch: Node is either a different type or already numbered; leave the map unchanged for it.
    }

    if ('children' in node) {
      // Branch: Node has children; recurse so nested footnotes are also numbered.
      for (const child of node.children) {
        visit(child, type);
      }
    } else {
      // Branch: Node is a leaf; there are no descendants to visit.
    }
  }

  visit(root, 'footnoteReference');
  visit(root, 'footnoteDefinition');

  return numbers;
}

/**
 * Rewrites GFM-only constructs into HTML or text so plain CommonMark can render them.
 *
 * @purpose Converts tables to rendered HTML, strikethrough to `<del>`, footnotes to anchored divs with numbered markers, task-list checkboxes to literal `[x]`/`[ ]` prefixes, and YAML/TOML front matter to an HTML comment; returns null for any node type that needs no downgrade.
 * @inputs node - The mdast node under consideration.
 * @inputs numbers - Map of footnote identifiers to their assigned 1-based numbers (see footnoteNumbers).
 * @inputs note - Callback invoked with the relevant DOWNGRADE_LABEL when a downgrade happens, so callers can report it.
 * @outputs RootContent[] | null - Replacement node array for tables/strikethrough/footnotes/task-lists/front matter, or null otherwise.
 * @dataflow Node -> matched to its construct kind -> rewritten into html/text nodes using numbers for footnote anchors -> replacement array returned.
 * @controlflow Switch on node.type; each handled case records its downgrade label and builds the fallback, while the default leaves unmatched types untouched.
 */
function gfmConstruct(node: RootContent, numbers: ReadonlyMap<string, number>, note: NoteChange): RootContent[] | null {
  switch (node.type) {
    case 'table': {
      // Branch: GFM table; render it as HTML via the fragment renderer so column layout survives.
      note(DOWNGRADE_LABEL.tables);
      const tableRoot: Root = { type: 'root', children: [node as Table] };
      return [html(renderFragment(tableRoot).trim())];
    }
    case 'delete': {
      // Branch: GFM strikethrough; wrap its children in an HTML <del> tag.
      note(DOWNGRADE_LABEL.strikethrough);
      return [html('<del>'), ...(node.children as RootContent[]), html('</del>')];
    }
    case 'footnoteReference': {
      // Branch: Footnote reference; emit a numbered superscript anchor pointing at the footnote.
      const n = numbers.get(node.identifier) ?? 0;
      return [html(`<sup id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`)];
    }
    case 'footnoteDefinition': {
      // Branch: Footnote definition; prefix its body with a numbered marker and wrap it in an anchored div.
      note(DOWNGRADE_LABEL.footnotes);
      const n = numbers.get(node.identifier) ?? 0;
      const children = node.children as RootContent[];
      const marker = html(`<sup>${n}</sup> `);
      const first = children[0];

      if (first !== undefined && first.type === 'paragraph') {
        // Branch: First child is a paragraph; prepend the marker into its text so it reads inline.
        first.children.unshift(marker);
      } else {
        // Branch: No leading paragraph; introduce one carrying the marker before the existing children.
        const lead: Paragraph = { type: 'paragraph', children: [marker] };
        children.unshift(lead);
      }

      return [html(`<div class="footnote" id="fn-${n}">`), ...children, html('</div>')];
    }
    case 'listItem': {
      // Branch: Task-list item; only items with a checkbox state are rewritten (plain list items pass through).
      const item = node as ListItem;

      if (item.checked === null || item.checked === undefined) {
        // Branch: Item has no checkbox state; it is not a task, so leave it untouched.
        return null;
      } else {
        // Branch: Item is a task list entry; downgrade its checkbox to literal text below.
        note(DOWNGRADE_LABEL.tasks);
        const box = item.checked ? '[x] ' : '[ ] ';
        item.checked = null;
        const first = item.children[0];

        if (first !== undefined && first.type === 'paragraph') {
          // Branch: First child is a paragraph; prepend the checkbox text so it reads inline.
          first.children.unshift({ type: 'text', value: box });
        } else {
          // Branch: No leading paragraph; introduce one carrying the checkbox text before the existing children.
          item.children.unshift({ type: 'paragraph', children: [{ type: 'text', value: box }] });
        }

        return [item];
      }
    }
    case 'yaml':
    case 'toml': {
      // Branch: YAML or TOML front matter; wrap it in an HTML comment so the raw block survives verbatim.
      note(DOWNGRADE_LABEL.frontMatter);
      const fence = node.type === 'yaml' ? '---' : '+++';
      const body = `${fence}\n${node.value}\n${fence}`.replace(/-->/g, '-- >'); // "-->" would end the comment early
      return [html(`<!--\n${body}\n-->`)];
    }
    default: {
      // Branch: Node is none of the handled constructs; leave it untouched for later rules or output.
      return null;
    }
  }
}
