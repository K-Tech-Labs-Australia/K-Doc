/**
 * @file keymap-scope.ts
 * @purpose Resolves whether a bound command may run from where a key was pressed, and classifies that focus context.
 * @inputs KeymapScope values imported from @k-doc/config; DOM event targets passed to focusContextOf.
 * @outputs Boolean allow decisions returned by scopeAllows; a FocusContext string returned by focusContextOf.
 * @functions
 *   - isNode: narrows an EventTarget to Node via the nodeType property.
 *   - isElement: narrows a Node to Element via the ELEMENT_NODE type code.
 *   - scopeAllows: decides whether a command of a given scope may run from a focus context.
 *   - focusContextOf: classifies an event target as kdoc, source, field, widget, or other.
 * @dataflow DOM event → focusContextOf → FocusContext; (scope, context, chord) → scopeAllows → boolean.
 * @controlflow focusContextOf narrows the target then walks containment checks; scopeAllows branches on scope then context/chord.
 * @version 1
 * @date 2026-09-15
 */

import type { KeymapScope } from '@k-doc/config';

export type FocusContext = 'kdoc' | 'source' | 'field' | 'widget' | 'other';

// ELEMENT_NODE is the numeric node type for element nodes; compared directly so no DOM constant import is required.
const ELEMENT_NODE = 1;

/**
 * @purpose Narrows an arbitrary event target to a Node by testing for the nodeType property.
 * @inputs value - The candidate EventTarget (possibly null or from another window).
 * @outputs boolean - True when value carries a nodeType and is therefore a Node.
 * @dataflow raw value → 'nodeType' membership test → boolean result.
 * @controlflow single guard clause returning the property-existence check.
 */
function isNode(value: EventTarget): value is Node {
  return 'nodeType' in value;
}

/**
 * @purpose Narrows a Node to an Element by testing for the element node type code.
 * @inputs node - A narrowed Node whose nodeType is compared against ELEMENT_NODE.
 * @outputs boolean - True when node.nodeType equals the element node type.
 * @dataflow node → nodeType comparison → boolean result.
 * @controlflow single guard clause returning the numeric equality check.
 */
function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

/**
 * @purpose Determines whether a command of the given scope may run from the current focus context.
 * @inputs scope - The command's scope (editor, document, or global).
 *         context - Where the key was pressed (kdoc, source, field, widget, other).
 *         chord - The full key combination as typed (e.g. 'Ctrl+B').
 * @outputs boolean - True when the command may run from this context.
 * @dataflow scope, context, chord → branch on scope then context/chord → allowed flag.
 * @controlflow editor checks kdoc; document rejects field; widget requires Ctrl/Alt; otherwise always allowed.
 */
export function scopeAllows(scope: KeymapScope, context: FocusContext, chord: string): boolean {
  // Editor commands act on the K-Doc pane's selection, so they only mean something while it has focus.
  if (scope === 'editor') {
    return context === 'kdoc';
  } else if (scope === 'document') {
    // Document commands (undo, redo) must not take a keystroke away from a text field's own undo.
    return context !== 'field';
  } else if (context === 'widget') {
    // A widget with keys of its own (the file tree, a list, a menu) keeps every key without Ctrl or Alt: F2 there renames the item, not the document.
    return chord.startsWith('Ctrl+') || chord.startsWith('Alt+');
  } else {
    // A global command runs from anywhere else, a text field included: Ctrl+S saves while typing in the find box.
    return true;
  }
}

/**
 * @purpose Classifies an event target as one of the five focus contexts used by scopeAllows.
 * @inputs target - The event's target (possibly null or from another window).
 *         kdoc - The K-Doc editor root element for containment checks.
 *         source - The source-editor root element for containment checks.
 * @outputs FocusContext - kdoc, source, field, widget, or other.
 * @dataflow target → node/element narrowing → containment walk → context string.
 * @controlflow reject non-nodes; fall back to parentElement; test editors then fields then widgets; default other.
 */
export function focusContextOf(target: EventTarget | null, kdoc: Element, source: Element): FocusContext {
  // Anything that is not a node (the document itself, or a text node's parent used by the browser) is outside every surface.
  if (target === null || !isNode(target) || target.ownerDocument === null) { return 'other'; } else { /* Target is a real node inside a document; proceed to classification. */ }

  // Resolve the concrete element; text nodes and documents fall back to their parent, which may still be inside an editor.
  const element = isElement(target) ? target : target.parentElement;

  // Only continue when an element was actually resolved in the tree rather than a detached or parentless node.
  if (element === null) { return 'other'; } else { /* Element present; fall through to surface checks below. */ }

  // Containment decides whether the element lives inside the K-Doc pane or the source pane.
  if (kdoc.contains(element)) { return 'kdoc'; } else if (source.contains(element)) { return 'source'; } else { /* Neither editor root contains it; keep searching for a field or widget. */ }

  // Form fields and editable elements outside both editors own their editing keys. Tag names rather than instanceof, so an element from another window (a jsdom test, an iframe) is recognised too.
  const tag = element.tagName.toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.getAttribute('contenteditable') === 'true' || element.closest('[contenteditable="true"]') !== null) { return 'field'; } else { /* Not an editable field; check whether it hosts a keyboard-driven widget. */ }

  if (element.closest('[role="tree"], [role="listbox"], [role="menu"], [role="grid"], [role="tablist"]') !== null) { return 'widget'; } else { /* No recognised surface matched; treat the element as outside all editors. */ }

  return 'other';
}
