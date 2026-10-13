/**
 * @file reference-links.ts
 * @purpose Helpers that let the K-Doc pane show reference-style links as real links and link definitions as readable text, while the round trip writes both back as they were.
 * @inputs mdast trees and nodes, link mark attributes.
 * @outputs definition maps, reference attributes, linkReference nodes, display text.
 * @functions
 *   - collectDefinitions: Walk a Root and return definition nodes keyed by identifier.
 *   - plainText: Flatten phrasing content into a single display string.
 *   - isReferenceType: Narrow an unknown value to the ReferenceType union.
 *   - referenceAttrsOf: Build LinkReferenceAttrs from arbitrary attribute records.
 *   - referenceAttrs: Build LinkReferenceAttrs from a linkReference node.
 *   - linkReferenceNode: Rebuild a linkReference node, promoting to full when text diverges.
 *   - definitionText: Render a definition record back to its source line.
 *   - unknownNodeText: Return raw/definition/placeholder text for an unknown node.
 * @dataflow mdast Root -> collectDefinitions -> from-mdast resolves href; link mark reference attrs -> linkReferenceNode -> to-mdast; stored unknown node -> unknownNodeText -> toDOM text.
 * @controlflow pure functions with shape checks.
 * @version 1
 * @date 2026-09-16
 */

import type { Definition, LinkReference, Nodes, PhrasingContent, Root } from 'mdast';

export type ReferenceType = 'full' | 'collapsed' | 'shortcut';

export interface LinkReferenceAttrs {
  readonly identifier: string;
  readonly label: string | null;
  readonly referenceType: ReferenceType;
  readonly text: string;
}

/**
 * @purpose Collect definition nodes from a Root into a map keyed by identifier.
 * @inputs root - The mdast Root tree to traverse for definitions.
 * @outputs Map<string, Definition> of the first definition seen per label.
 * @dataflow Root node -> recursive visit -> definitions map keyed by identifier.
 * @controlflow Visit each node; record a definition only if its label is unseen, then recurse into children.
 */
export function collectDefinitions(root: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const visit = (node: Nodes): void => {
    // Record the first definition for each label; a later duplicate is ignored because the first wins.
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    } else {
      // Not a new definition: either this node is not a definition or its label was already recorded.
    }
    // Recurse into nodes that carry children; leaf nodes such as definitions hold their own data.
    if ('children' in node) {
      for (const child of node.children) {
        visit(child);
      }
    } else {
      // Leaf node with no children: there is nothing to recurse into.
    }
  };
  visit(root);
  return definitions;
}

/**
 * @purpose Flatten phrasing content into a single plain-text string for display and comparison.
 * @inputs nodes - The list of phrasing-content nodes to flatten.
 * @outputs The concatenated plain text, using alt text for images and spaces for breaks.
 * @dataflow Each node -> type-based extraction -> accumulated result string.
 * @controlflow Iterate nodes; branch on node kind, recursing into nested content and skipping non-text leaves.
 */
export function plainText(nodes: readonly PhrasingContent[]): string {
  let result = '';
  for (const node of nodes) {
    // Text and inline code contribute their literal value directly.
    if (node.type === 'text' || node.type === 'inlineCode') {
      result += node.value;
    } else if (node.type === 'image') {
      // Images render as their alt text rather than a broken image glyph.
      result += node.alt ?? '';
    } else if (node.type === 'break') {
      // A line break collapses to a single space in plain text.
      result += ' ';
    } else if ('children' in node) {
      // Nested phrasing content is flattened recursively before being appended.
      result += plainText(node.children);
    } else {
      // HTML, footnote references and other leaves carry no link text, so nothing is appended.
    }
  }
  return result;
}

/**
 * @purpose Narrow an unknown value to the ReferenceType union when it matches one of the allowed strings.
 * @inputs value - The arbitrary value to test against the reference-type literals.
 * @outputs true when value is 'full', 'collapsed', or 'shortcut'; otherwise false.
 * @dataflow Raw value -> equality checks against each literal -> boolean result.
 * @controlflow Single comparison expression returning whether the value matches any allowed type.
 */
function isReferenceType(value: unknown): value is ReferenceType {
  return value === 'full' || value === 'collapsed' || value === 'shortcut';
}

/**
 * @purpose Build LinkReferenceAttrs from an arbitrary attribute record, validating every field.
 * @inputs value - The link mark attributes to interpret as a reference node's data.
 * @outputs LinkReferenceAttrs when the shape is valid, otherwise null.
 * @dataflow Unknown value -> record extraction -> field validation -> attrs object or null.
 * @controlflow Reject non-objects early; then validate each field before constructing the result.
 */
export function referenceAttrsOf(value: unknown): LinkReferenceAttrs | null {
  // Reject anything that is not a plain object so the cast below stays sound.
  if (typeof value !== 'object' || value === null) {
    return null;
  } else {
    // Passed the guard: fall through and treat the value as an attribute record.
  }
  const record = value as Record<string, unknown>;
  const identifier = record['identifier'];
  const label = record['label'];
  const referenceType = record['referenceType'];
  const text = record['text'];
  // Only construct attrs when every field matches its expected type; otherwise the input is malformed.
  if (typeof identifier === 'string' && (typeof label === 'string' || label === null) && isReferenceType(referenceType) && typeof text === 'string') {
    return { identifier, label, referenceType, text };
  } else {
    // At least one field failed validation: report an invalid record.
    return null;
  }
}

/**
 * @purpose Build LinkReferenceAttrs directly from a linkReference node's own data.
 * @inputs node - The mdast linkReference node to read attributes from.
 * @outputs LinkReferenceAttrs mirroring the node, with children flattened to text.
 * @dataflow Node fields -> plainText(node.children) -> attrs object.
 * @controlflow Pure projection with no branching; label defaults to null when absent.
 */
export function referenceAttrs(node: LinkReference): LinkReferenceAttrs {
  return { identifier: node.identifier, label: node.label ?? null, referenceType: node.referenceType, text: plainText(node.children) };
}

/**
 * @purpose Rebuild a linkReference node from stored attributes, promoting to full when the text diverges.
 * @inputs reference - The resolved reference attributes; children - The current phrasing content.
 * @outputs A linkReference node whose type preserves the link across edits.
 * @dataflow Reference attrs + children -> referenceType decision -> reconstructed node.
 * @controlflow Compute a possibly-upgraded referenceType via ternary, then branch on label presence.
 */
export function linkReferenceNode(reference: LinkReferenceAttrs, children: PhrasingContent[]): LinkReference {
  // A collapsed `[label][]` or shortcut `[label]` reference spells its label with its text, so once the text is edited it is written as a full reference, which keeps the link.
  // A full reference stays full either way, so only the text needs checking.
  const referenceType: ReferenceType = plainText(children) !== reference.text ? 'full' : reference.referenceType;
  // Include an explicit label only when one was provided by the stored attributes.
  if (reference.label === null) {
    return { type: 'linkReference', identifier: reference.identifier, referenceType, children };
  } else {
    // A label exists: carry it through on the reconstructed node.
    return { type: 'linkReference', identifier: reference.identifier, label: reference.label, referenceType, children };
  }
}

/**
 * @purpose Render a definition record back to its CommonMark source line for display.
 * @inputs value - The arbitrary attribute record to interpret as a definition.
 * @outputs The `[label]: url "title"` source string, or null when the shape is invalid.
 * @dataflow Unknown value -> type/url validation -> label/title extraction -> formatted source line.
 * @controlflow Reject non-objects and malformed definitions early; then build the source line.
 */
export function definitionText(value: unknown): string | null {
  // Reject anything that is not a plain object so the cast below stays sound.
  if (typeof value !== 'object' || value === null) {
    return null;
  } else {
    // Passed the guard: fall through and treat the value as a definition record.
  }
  const record = value as Record<string, unknown>;
  const url = record['url'];
  // Require a definition type and string url; without them there is no renderable source line.
  if (record['type'] !== 'definition' || typeof url !== 'string') {
    return null;
  } else {
    // Validation passed: fall through to assemble the source line from the now-known fields.
  }
  const labelValue = record['label'];
  const identifierValue = record['identifier'];
  // Prefer an explicit label, falling back to the identifier, then an empty string.
  const label = typeof labelValue === 'string' ? labelValue : typeof identifierValue === 'string' ? identifierValue : '';
  const titleValue = record['title'];
  // Append the title only when it is a string, wrapped in quotes per CommonMark syntax.
  const title = typeof titleValue === 'string' ? ` "${titleValue}"` : '';
  return `[${label}]: ${url}${title}`;
}

/**
 * @purpose Return display text for an unknown node: raw source, a definition line, or a placeholder.
 * @inputs value - The arbitrary stored node to render; inline - Whether the node sits in phrasing context.
 * @outputs Raw string when available, a definition's source line, or a schema placeholder otherwise.
 * @dataflow Unknown value -> raw value check -> definitionText fallback -> placeholder text.
 * @controlflow Try raw extraction first, then definition rendering, finally branch on inline context for the placeholder.
 */
export function unknownNodeText(value: unknown, inline: boolean): string {
  // Attempt to surface raw source when the node carries a literal value.
  if (typeof value === 'object' && value !== null) {
    const raw = (value as Record<string, unknown>)['value'];
    // A usable raw string is returned verbatim so the pane shows exactly what was stored.
    if (typeof raw === 'string') {
      return raw;
    } else {
      // The value field exists but is not a string: fall through to definition handling.
    }
  } else {
    // Non-object input cannot hold a raw value: fall through to definition handling.
  }
  const definition = definitionText(value);
  // Fall back to a stored definition's source line when one can be rendered.
  if (definition !== null) {
    return definition;
  } else {
    // Nothing renderable remains: emit the schema placeholder appropriate to the context.
    return inline ? '[unrenderable inline]' : '[unrenderable block]';
  }
}
