/**
 * @file insert-commands.ts
 * @purpose ProseMirror commands backing K-Doc's insert affordances in the WYSIWYG pane — inserting/editing images
 *   (FR-8.14) and setting a code block's language (FR-8.8). Like commands.ts, every command is a pure function over
 *   EditorState/Transaction that returns false instead of throwing when it cannot apply, so the editor never breaks on a
 *   keystroke handler; structural transactions are tagged with kdocStructural to opt out of undo coalescing exactly as
 *   commands.ts does. These functions require no DOM and stay headless-testable.
 * @inputs ProseMirror EditorState instances, image attribute bundles, and optional language strings or null.
 * @outputs ProseMirror Command functions (insertImage, setCodeBlockLanguage) plus read predicates that inspect the current
 *   selection for an editable image (imageAt, canInsertImage) or a code block's language (codeBlockLanguageAt).
 * @functions
 *   - nodeType: Resolves a NodeType by name from a schema, returning null when absent (mirrors commands.ts).
 *   - structural: Tags a Transaction with kdocStructural meta to opt it out of undo coalescing (mirrors commands.ts).
 *   - attrsFromImage: Projects a ProseMirror image node onto the public ImageAttrs view.
 *   - insertImage: Replaces the selected image or the current selection with an image node.
 *   - imageAt: Returns the attrs of the selected or caret-preceding image, else null.
 *   - canInsertImage: Reports whether an image node fits at the current selection (toolbar enable/disable).
 *   - setCodeBlockLanguage: Sets a code block's language attribute, preserving meta; trims empties to null.
 *   - codeBlockLanguageAt: Returns the enclosing code block's language, else null.
 * @dataflow EditorState -> predicate/command execution -> Transaction modification with kdocStructural meta -> dispatch callback.
 * @controlflow Resolve schema node types -> verify applicability (type present, src non-empty, enclosing node found) -> apply transform or answer query -> dispatch tagged transaction.
 * @version 3
 * @date 2026-09-18
 */

import { NodeSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Attrs, Node, NodeType, Schema } from 'prosemirror-model';

/**
 * The attributes of an image, in the shape the dialog and the serializer both use.
 *
 * `alt` and `title` are `string | null` rather than `string`, because mdast distinguishes an absent title
 * from an empty one and the serializer emits the two differently.
 */
export interface ImageAttrs {
  readonly src: string;
  readonly alt: string | null;
  readonly title: string | null;
}

/**
 * @purpose Resolves a NodeType by name from the given schema, returning null if the node is absent.
 *   This mirrors the private `nodeType` in commands.ts (which is not exported), so both files agree on how a missing
 *   schema type is reported — as null, letting callers return false rather than throw.
 * @inputs
 *   - schema: Schema - The ProseMirror schema to look up within.
 *   - name: string - The node type name to resolve.
 * @outputs NodeType | null - The resolved NodeType instance, or null if not found.
 * @dataflow schema.nodes[name] lookup -> NodeType | null.
 * @controlflow Inspects schema.nodes[name] -> returns NodeType if defined, null otherwise.
 */
function nodeType(schema: Schema, name: string): NodeType | null {
  // noUncheckedIndexedAccess makes this lookup `NodeType | undefined`, so the guard is required rather than stylistic.
  const type = schema.nodes[name];
  if (type !== undefined) {
    // Node type present in schema: return the resolved instance.
    return type;
  } else {
    // Node type missing from schema: return null to signal unavailability.
    return null;
  }
}

/**
 * @purpose Tags a ProseMirror Transaction with the kdocStructural metadata flag so the session opts it out of undo coalescing.
 *   This mirrors the private `structural` in commands.ts (not exported); structural edits are kept separate from ordinary
 *   typing so the undo stack does not collapse an image/code-block change into a keystroke batch.
 * @inputs tr: Transaction - The transaction to tag.
 * @outputs Transaction - The same transaction with kdocStructural set to true.
 * @dataflow tr.setMeta('kdocStructural', true) -> returns the tagged transaction.
 * @controlflow Sets metadata key 'kdocStructural' to true on the transaction and returns it unchanged in shape.
 */
function structural(tr: Transaction): Transaction {
  return tr.setMeta('kdocStructural', true);
}

/**
 * @purpose Projects a ProseMirror image node onto the public ImageAttrs view used by the dialog and predicates.
 * @inputs node: Node - A ProseMirror node of type `image`.
 * @outputs ImageAttrs - The node's src/alt/title with alt and title coerced to null when not strings.
 * @dataflow node.attrs -> string-or-null coercion per field -> ImageAttrs record.
 * @controlflow Reads each attr, coercing non-string values (the schema defaults them to null) to null so reads mirror writes.
 */
function attrsFromImage(node: Node): ImageAttrs {
  // src always has a string value in this schema, but coerce defensively so a null default never leaks through.
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  // alt defaults to null in the schema; keep it null when not a string so "no alt" and "" both read back as null.
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : null;
  // title follows the same rule as alt: non-string values (the schema default) are reported as null.
  const title = typeof node.attrs.title === 'string' ? node.attrs.title : null;
  return { src, alt, title };
}

/**
 * @purpose Creates a command that replaces the selected image or the current selection with an image node.
 * @inputs attrs: ImageAttrs - The source URL plus optional alt/title to store on the new (or replacement) image.
 * @outputs Command - A ProseMirror command returning false when the schema lacks `image` or src is empty, else replacing
 *   a selected image in place or the current selection with a fresh image node and tagging the transaction structural.
 * @dataflow Resolves image NodeType -> validates src non-empty -> normalizes alt/title (empty -> null) -> replaceWith on a
 *   selected image or replaceSelectionWith otherwise -> structural(tr) -> dispatch callback.
 * @controlflow Resolve image type (return false if null) -> reject empty src (return false) -> branch on selected image vs
 *   plain selection -> build transaction, tag structural, and dispatch; dry-run returns true when applicable.
 */
export function insertImage(attrs: ImageAttrs): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'image');
    // No image node in the schema: there is nothing to insert.
    if (type === null) {
      return false;
    } else {
      // Image node type resolved: continue to validation and application.
    }

    // An empty or whitespace-only src would render as a broken icon and is never what the user meant, so refuse to apply
    // rather than inserting a placeholder that can only confuse later edits.
    if (attrs.src.trim() === '') {
      return false;
    } else {
      // src present: continue building the node attributes.
    }

    // Normalize alt/title: mdast distinguishes "no title" from "empty title", and the serializer emits `[]()` differently
    // for each, so an empty string is stored as null to keep a single representation.
    const imageAttrs: ImageAttrs = {
      src: attrs.src,
      alt: attrs.alt === '' ? null : attrs.alt,
      title: attrs.title === '' ? null : attrs.title,
    };

    const { selection } = state;
    // Check whether the whole selection is already a NodeSelection wrapping an image node.
    if (selection instanceof NodeSelection && selection.node.type === type) {
      // An image is selected: replace it in place so the edit dialog can modify an existing image without moving it or
      // changing its position among siblings.
      if (dispatch !== undefined) {
        const tr = state.tr;
        // A wiki embed stays a wiki embed, so editing its address does not rewrite `![[img.png]]` into
        // Markdown behind the reader's back (FR-8.15). It stops being one only when they ask for
        // something the syntax cannot hold: `![[...]]` has nowhere to put alt text or a caption, so words
        // typed into either are kept and the picture becomes an ordinary Markdown image, which is better
        // than keeping the syntax and throwing the words away.
        const keepsEmbed = selection.node.attrs['embed'] === true && imageAttrs.alt === null && imageAttrs.title === null;
        // Editing an image's address, alt or caption keeps the size it was given.
        tr.replaceWith(selection.from, selection.to, type.create({ ...imageAttrs, width: selection.node.attrs['width'] ?? null, embed: keepsEmbed }));
        dispatch(structural(tr));
      } else {
        // Dry-run query: replacing an existing image is always applicable once validation passed.
      }
    } else {
      // No image selected: replace the current selection range with a fresh image node.
      if (dispatch !== undefined) {
        const tr = state.tr;
        tr.replaceSelectionWith(type.create(imageAttrs));
        dispatch(structural(tr));
      } else {
        // Dry-run query: inserting a new image is always applicable once validation passed.
      }
    }

    return true;
  };
}

/**
 * @purpose Returns the attrs of the selected image or the node immediately before the caret, else null.
 * @inputs state: EditorState - The current ProseMirror editor state to inspect.
 * @outputs ImageAttrs | null - The editable image's attributes, or null when no image is selected or adjacent to the caret.
 * @dataflow Resolves image NodeType -> inspects NodeSelection node -> else $from.parent child at index-1 -> attrsFromImage.
 * @controlflow Resolve image type (return null if absent) -> branch on selected image vs preceding sibling -> return its
 *   attrs; otherwise fall through to null.
 */
export function imageAt(state: EditorState): ImageAttrs | null {
  const type = nodeType(state.schema, 'image');
  // No image node in the schema: nothing can ever be an image to return.
  if (type === null) {
    return null;
  } else {
    // Image node type resolved: continue inspecting the selection.
  }

  const { selection } = state;
  // Check whether the whole selection is a NodeSelection wrapping an image node.
  if (selection instanceof NodeSelection && selection.node.type === type) {
    // The image itself is selected: return its attrs directly so the dialog can prefill existing values.
    return attrsFromImage(selection.node);
  } else {
    // Selection is not an image node selection: fall through to look for a preceding image sibling.
  }

  const { $from } = selection;
  // `nodeBefore` is the node immediately before the caret, or null at the start of a container. It is a
  // property rather than the `index()` method, which is what avoids an off-by-one at a container boundary.
  const nodeBefore = $from.nodeBefore;
  // Look for an image as the node immediately preceding the caret.
  if (nodeBefore !== null) {
    // Check whether that preceding node is an image node.
    if (nodeBefore.type === type) {
      // Preceding node is an image: return its attrs so "insert, then immediately edit" works without reselecting.
      // Checking the node before the caret is exactly what makes this work: after insertion the cursor sits right behind
      // the image, so this lookup finds it without the user having to reselect.
      return attrsFromImage(nodeBefore);
    } else {
      // Preceding node is not an image: there is no editable image at the caret.
      return null;
    }
  } else {
    // Caret sits at the start of its container, so there is no preceding node and nothing to edit.
    return null;
  }
}

/**
 * @purpose Reports whether an `image` node could be inserted at the current selection.
 * @inputs state: EditorState - The current ProseMirror editor state to test.
 * @outputs boolean - True when the parent's content model permits replacing the selected range with an image atom.
 * @dataflow Resolves image NodeType -> $from.parent.canReplaceWith(index, indexAfter, type) -> boolean.
 * @controlflow Resolve image type (return false if absent) -> ask canReplaceWith whether the bracketed selection fits an
 *   image; its result is returned directly to drive the toolbar button's disabled state.
 */
export function canInsertImage(state: EditorState): boolean {
  const type = nodeType(state.schema, 'image');
  // No image node in the schema: nothing can be inserted.
  if (type === null) {
    return false;
  } else {
    // Image node type resolved: continue testing applicability at the current selection.
  }

  const { $from } = state.selection;
  // canReplaceWith asks whether the parent's content model allows replacing the selected range [index, indexAfter) with a
  // single image atom. It returns false in contexts that forbid inline images (e.g. inside a code block), which is exactly
  // what drives the toolbar button's disabled state rather than letting a bad insert throw later.
  return $from.parent.canReplaceWith($from.index(), $from.indexAfter(), type);
}

/**
 * @purpose Creates a command that sets the language attribute of the enclosing code block, preserving its meta.
 * @inputs language: string | null - The desired info string; an empty/whitespace string (or null) clears the language.
 * @outputs Command - A ProseMirror command returning false when no code block encloses the caret, else setting `language`
 *   via setNodeMarkup and tagging the transaction structural.
 * @dataflow Resolves codeBlock NodeType -> walks $from ancestors to find it -> trims/normalizes language (empty -> null) ->
 *   spreads existing attrs overriding only `language` -> setNodeMarkup -> structural(tr) -> dispatch callback.
 * @controlflow Resolve codeBlock type (return false if absent) -> walk depths for enclosing block (return false if none) ->
 *   normalize language -> build new attrs preserving meta -> branch on dispatch to apply or dry-run; returns true when applicable.
 */
export function setCodeBlockLanguage(language: string | null): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type = nodeType(state.schema, 'codeBlock');
    // No codeBlock node in the schema: nothing to configure.
    if (type === null) {
      return false;
    } else {
      // Code block node type resolved: continue locating the enclosing instance.
    }

    const { $from } = state.selection;
    let codeBlockDepth: number | null = null;
    // Walk from the caret upward through its ancestors to find the nearest enclosing code block.
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === type) {
        // Enclosing code block found: record its depth and stop searching outward.
        codeBlockDepth = depth;
        break;
      } else {
        // Not a code block at this depth: keep walking toward the document root.
      }
    }

    // Check whether an enclosing code block was found.
    if (codeBlockDepth === null) {
      // Selection is not inside a code block: the language affordance has nothing to target.
      return false;
    } else {
      // Enclosing code block found: proceed to compute and apply the new language attribute.
    }

    const targetNode = $from.node(codeBlockDepth);
    // Normalize the incoming language exactly as the serializer expects it: trim surrounding whitespace and treat an empty
    // (or all-whitespace) info string as "no language". A fenced block with an empty info string and one with no info
    // string at all are the same mdast concept, so keeping a single null representation makes the serializer's output depend
    // on the document rather than on which code path set the attribute.
    const trimmed = typeof language === 'string' ? language.trim() : '';
    const nextLanguage: string | null = trimmed === '' ? null : trimmed;

    // Preserve every existing attribute (notably `meta`) and only override `language`, so setting a language never clobbers
    // metadata the importer or a future metadata panel placed on the block.
    const nextAttrs: Attrs = { ...targetNode.attrs, language: nextLanguage };

    if (dispatch !== undefined) {
      const pos = $from.before(codeBlockDepth);
      const tr = state.tr;
      tr.setNodeMarkup(pos, undefined, nextAttrs);
      dispatch(structural(tr));
    } else {
      // Dry-run query: the command applies whenever a code block encloses the caret.
    }

    return true;
  };
}

/**
 * @purpose Returns the language attribute of the code block enclosing the current selection, else null.
 * @inputs state: EditorState - The current ProseMirror editor state to inspect.
 * @outputs string | null - The enclosing code block's language, or null when none encloses the caret or schema lacks it.
 * @dataflow Resolves codeBlock NodeType -> walks $from ancestors to find it -> reads its `language` attr (non-string -> null).
 * @controlflow Resolve codeBlock type (return null if absent) -> walk depths for enclosing block (return null if none) ->
 *   coerce the language attribute to string-or-null and return it.
 */
export function codeBlockLanguageAt(state: EditorState): string | null {
  const type = nodeType(state.schema, 'codeBlock');
  // No codeBlock node in the schema: there is no language to report.
  if (type === null) {
    return null;
  } else {
    // Code block node type resolved: continue locating the enclosing instance.
  }

  const { $from } = state.selection;
  let codeBlockDepth: number | null = null;
  // Walk from the caret upward through its ancestors to find the nearest enclosing code block.
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === type) {
      // Enclosing code block found: record its depth and stop searching outward.
      codeBlockDepth = depth;
      break;
    } else {
      // Not a code block at this depth: keep walking toward the document root.
    }
  }

  // Check whether an enclosing code block was found.
  if (codeBlockDepth === null) {
    // Selection is not inside a code block: no language to report.
    return null;
  } else {
    // Enclosing code block found: read its current language attribute.
    const node = $from.node(codeBlockDepth);
    // The schema defaults `language` to null; coerce any non-string value back to null so the predicate's output matches
    // what setCodeBlockLanguage would have stored (a single null representation).
    const lang = typeof node.attrs.language === 'string' ? node.attrs.language : null;
    return lang;
  }
}
