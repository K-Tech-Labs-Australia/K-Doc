/**
 * @file raw-source.ts
 * @purpose Pure helpers that decide whether an unknownBlock/unknownInline node's stored mdast node is editable as source text, and produce a copy with new source text.
 * @inputs An `unknown` value holding either a stored mdast node object (the ProseMirror `node` attr) or an unrelated primitive/array; the replacement source string for `withRawValue`.
 * @outputs A `RawSource` describing editable source text and its presentation, or `null` when not editable as source; a shallow copy of the stored node with its `value` replaced, or the original value unchanged.
 * @functions
 *   - rawSourceOf: Inspect a stored mdast node and return its presentable source, or null when it is not editable as source.
 *   - withRawValue: Return a shallow copy of a stored object node with `value` replaced by new text, leaving the original untouched.
 * @dataflow Stored mdast node attr → type/value inspection → RawSource descriptor (or null); stored node attr plus new text → shallow spread copy with an updated value.
 * @controlflow Guard non-object inputs early; require string type and value; dispatch on node.type through if/else-if/else to build or reject a RawSource.
 * @version 1
 * @date 2026-09-13
 */

/** The source text of a raw node, and how to present it. */
export interface RawSource {
  readonly text: string;
  /** Language used for highlighting, or null for plain text. */
  readonly language: 'html' | null;
  /** Short label shown on the widget. */
  readonly label: string;
}

/**
 * Inspect a stored mdast node and decide whether it can be edited as source text.
 * @purpose Return a RawSource descriptor for nodes whose entire meaning is their text value, or null otherwise.
 * @inputs stored - The ProseMirror `node` attr of an unknownBlock/unknownInline node: an mdast node object with positions stripped, or any other value.
 * @outputs A RawSource describing the editable source text and presentation, or null when the node is not editable as source.
 * @dataflow Stored node → type/value string checks → html/kdocRaw branch builds a RawSource; all other shapes yield null.
 * @controlflow Reject non-object inputs early; require string type and value; dispatch on node.type through if/else-if/else to build or reject a RawSource.
 */
export function rawSourceOf(stored: unknown): RawSource | null {
  // Reject anything that is not a non-null, non-array object since only mdast node objects carry editable source.
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return null;
  }

  const node = stored as Record<string, unknown>;

  // Require both type and value to be strings so the node represents a single source string rather than structured content.
  const type = node.type;
  const value = node.value;
  if (typeof type !== 'string' || typeof value !== 'string') {
    return null;
  }

  // Dispatch on the mdast node kind: an html node is always presented as HTML-highlighted source text.
  if (type === 'html') {
    return { text: value, language: 'html', label: 'HTML' };
  } else if (type === 'kdocRaw') {
    // A kdocRaw node keeps HTML highlighting only when it was originally unknown HTML; any other reason falls back to plain text.
    const reason = node.reason;
    // Highlight as HTML exactly for the original-unknown-html case, otherwise present the source as plain text.
    const language = reason === 'unknown-html' ? 'html' : null;
    return { text: value, language, label: 'Raw' };
  } else {
    // Definitions, footnotes and the like carry structure rather than a single source string, so editing them as text would have to re-serialise and re-parse them; only nodes whose whole meaning is their text are offered as source.
    return null;
  }
}

/**
 * Produce a copy of a stored mdast node with its source text replaced.
 * @purpose Return a shallow copy of an object node with `value` set to new text, or the original value unchanged when it is not an object.
 * @inputs stored - The ProseMirror `node` attr (an mdast node object) or any other value; text - The replacement source string.
 * @outputs A new object with `value` replaced by text for object inputs, otherwise the original stored value returned unchanged.
 * @dataflow Stored node plus new text → shallow spread copy `{ ...stored, value: text }`; non-objects pass through untouched.
 * @controlflow Branch on whether stored is a non-null, non-array object to build an immutable update or return the input unchanged.
 */
export function withRawValue(stored: unknown, text: string): unknown {
  // Replace only genuine mdast node objects; everything else passes through untouched so stored state is never corrupted.
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    // The value is a non-null, non-array object: build a shallow copy with the source text swapped in.
    const node = stored as Record<string, unknown>;
    return { ...node, value: text };
  } else {
    // Not an editable object (primitive, null, or array): return it unchanged so ProseMirror sees no spurious mutation.
    return stored;
  }
}
