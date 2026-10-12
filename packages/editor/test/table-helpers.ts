/**
 * @file table-helpers.ts
 * @purpose Shared test fixtures and helpers for the GFM table test suites in this package; provides a canonical table
 *   fixture plus utilities to build an EditorState from Markdown, position the caret at text, run a command against a
 *   capturing dispatch, and serialise the resulting document back to Markdown. It exports no `describe`/`it` blocks and
 *   is imported directly by spec files rather than executed on its own.
 * @inputs Markdown source strings for fixture construction; EditorState instances and ProseMirror Command values supplied
 *   by individual tests.
 * @outputs A reusable TABLE string, constructed EditorState objects, the Transaction produced by a command, and
 *   serialised Markdown strings reflecting command effects.
 * @functions
 *   - TABLE: Canonical two-column GFM table fixture used across table specs.
 *   - stateFor: Builds an EditorState from a Markdown string via the k-doc parse/convert pipeline.
 *   - caretAt: Returns a new EditorState with the caret placed immediately before the first occurrence of `needle`.
 *   - runToMarkdown: Applies a command and returns the resulting document serialised to Markdown.
 *   - captureTr: Runs a command with a capturing dispatch and returns the Transaction it produced.
 * @dataflow Markdown string -> parseMarkdown -> mdastToProseMirror -> EditorState; EditorState + Command -> captureTr -> Transaction -> state.apply -> proseMirrorToMdast -> serializeDocument -> Markdown string.
 * @controlflow Module load builds TABLE once; each helper is invoked on demand by a test, building or transforming an EditorState and returning the derived value without side effects beyond command application.
 * @version 1
 * @date 2026-09-05
 */

import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema, mdastToProseMirror, proseMirrorToMdast } from '../src/index.js';

/**
 * Canonical two-column GFM table fixture shared by the table test suites.
 */
export const TABLE = [
  '| Head A | Head B |',
  '| ------ | ------ |',
  '| a1     | b1     |',
  '| a2     | b2     |',
  '',
].join('\n');

/**
 * @purpose Constructs an EditorState whose document is derived from the given Markdown source.
 * @inputs markdown: string - The Markdown text to parse into a ProseMirror document under the k-doc schema.
 * @outputs EditorState - A fresh editor state containing the parsed document, ready for caret placement or command execution.
 * @dataflow markdown -> parseMarkdown(root) -> mdastToProseMirror(parsed.root) -> EditorState.create with kdocSchema.
 * @controlflow Parse Markdown to an mdast root -> convert the root to a ProseMirror doc -> create and return the editor state.
 */
export function stateFor(markdown: string): EditorState {
  const parsed = parseMarkdown(markdown);
  // The intermediate mdast document produced by the core parser, holding the tree that will be converted.
  const doc = mdastToProseMirror(parsed.root);
  // The ProseMirror document mirroring the parsed Markdown structure under kdocSchema.
  return EditorState.create({ doc, schema: kdocSchema });
  // Return an editor state seeded with the converted document.
}

/**
 * @purpose Returns a new EditorState with the cursor placed immediately before the first occurrence of `needle` inside a text node.
 * @inputs state: EditorState - The editor state whose document should be searched for `needle`. needle: string - The literal
 *   substring to locate; the caret is positioned at its index within the containing text node.
 * @outputs EditorState - A new editor state with a TextSelection anchored just before `needle`, or an error when no match exists.
 * @dataflow state.doc -> descendants walk -> first text node containing needle -> absolute position -> setSelection -> applied state.
 * @controlflow Walk all nodes tracking the found holder -> stop at the first matching text node -> throw if none found -> else apply a selection and return the new state.
 */
export function caretAt(state: EditorState, needle: string): EditorState {
  // A holder object is used instead of `let pos: number | null = null` because control-flow analysis would narrow the
  // `let` binding to `null` after the descend callback (TypeScript cannot see the assignment made inside it), which
  // would then error on later reads of `found.pos`; a mutable object property keeps the type stable across the closure.
  const found: { pos: number | null } = { pos: null };
  // Mutable holder carrying the resolved absolute position, or null when no text node contains the needle.

  state.doc.descendants((node, pos) => {
    // Visit every node in document order with its absolute start position.
    if (found.pos !== null) {
      // A match has already been located: signal `descendants` to stop descending by returning false.
      return false;
    } else {
      // No match yet: evaluate this node as a potential match below.
    }

    if (node.isText) {
      // This is a text node that may contain the needle.
      const text = node.text;
      // The raw content of the text node, possibly undefined under ProseMirror's typing and strict indexing.

      if (text !== undefined && text.includes(needle)) {
        // The text contains the needle: record the absolute position just before it and stop descending.
        found.pos = pos + text.indexOf(needle);
        // Absolute caret position = node start plus the needle's offset within the node.
        return false;
      } else {
        // The text is present but does not contain the needle (or is undefined): keep searching other nodes.
        return true;
      }
    }

    return true;
    // Non-text node: cannot contain the needle, so continue descending.
  });

  if (found.pos === null) {
    // No text node contained the needle: fail loudly rather than silently testing position 0.
    throw new Error(`No text node containing ${needle}`);
    // A typo in a test's needle would otherwise place the caret at document start and pass unnoticed.
  } else {
    // The needle was located at an absolute position: build a selection there below.
  }

  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, found.pos)));
  // Apply the new selection to produce a fresh editor state with the caret positioned before the needle.
}

/**
 * @purpose Runs a ProseMirror Command against the given state using a capturing dispatch and returns the Transaction it produced.
 * @inputs state: EditorState - The editor state on which the command is invoked. command: Command - A ProseMirror command whose
 *   dispatch callback receives the transaction instead of applying it.
 * @outputs Transaction - The transaction created by the command, or an error when the command did not apply to the state.
 * @dataflow command(state, captureDispatch) -> captured.tr -> returned Transaction for downstream inspection or application.
 * @controlflow Invoke the command with a capturing dispatch -> if it returns falsy or produced no transaction, throw; else return the captured transaction.
 */
export function captureTr(state: EditorState, command: Command): Transaction {
  // A holder object is used instead of `let tr: Transaction | null = null` for the same control-flow narrowing reason as
  // caretAt: TypeScript would narrow the `let` binding to `null` after the dispatch callback, making later reads type-error.
  const captured: { tr: Transaction | null } = { tr: null };
  // Mutable holder carrying the transaction produced by the command's dispatch, or null when nothing was dispatched.

  const applied = command(state, (tr: Transaction): void => {
    // The capturing dispatch receives the transaction the command builds instead of applying it.
    captured.tr = tr;
    // Store the dispatched transaction on the holder for retrieval after the command returns.
  });

  if (!applied || captured.tr === null) {
    // The command reported it did not apply, or produced no transaction: surface this rather than returning a stale value.
    throw new Error('Command did not apply to the given editor state');
    // A silently inapplicable command would otherwise yield unchanged output that looks like a wrong result.
  } else {
    // The command applied and produced a transaction: return it for inspection or application below.
  }

  return captured.tr;
  // Return the captured transaction, which is guaranteed non-null here by the guard above.
}

/**
 * @purpose Applies a command to an EditorState and returns the resulting document serialised back to Markdown.
 * @inputs state: EditorState - The editor state on which the command runs. command: Command - The ProseMirror command whose
 *   effect should be applied before serialisation.
 * @outputs string - The Markdown representation of the document after the command has been applied via its captured transaction.
 * @dataflow captureTr(state, command) -> tr -> state.apply(tr) -> nextState.doc -> proseMirrorToMdast -> serializeDocument -> Markdown string.
 * @controlflow Capture the command's transaction -> apply it to build the next state -> convert the doc to mdast -> serialise to Markdown and return.
 */
export function runToMarkdown(state: EditorState, command: Command): string {
  const tr = captureTr(state, command);
  // The transaction produced by the command, validated to exist by captureTr.

  const nextState = state.apply(tr);
  // The editor state after applying the captured transaction.

  const root = proseMirrorToMdast(nextState.doc);
  // The mdast tree reconstructed from the post-command document.

  return serializeDocument({ text: '', root, frontMatter: null });
  // Serialise the mdast tree (with an empty preamble and no front matter) to Markdown and return it.
}
