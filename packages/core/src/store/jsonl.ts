/**
 * @file jsonl.ts
 * @purpose Implements line-oriented JSON serialization and deserialization for K-Doc annotation store shared files (FR-6.21, FR-6.23).
 *   Why this format exists:
 *   FR-6.21: shared files are line-oriented JSON, one record per line, stably ordered, so that two people annotating
 *   the same document in a git repository merge without conflict in the common case. A single pretty-printed JSON array
 *   would conflict on every concurrent addition, because both sides would touch the same closing bracket and the same
 *   indentation; one record per line means two people adding different comments touch different lines and git merges them cleanly.
 *   FR-6.23: a missing or unreadable store must degrade to a plain, correct document. So decoding never throws:
 *   a corrupt line is reported and skipped, and the surviving records are returned. Annotations are an overlay,
 *   and losing one of them must never stop a document from opening.
 * @inputs Records extending JsonlRecord, or raw line-delimited JSON text strings.
 * @outputs Stably ordered JSONL strings with trailing newlines, JsonlReadResult objects with surviving records and diagnostics, or merged record arrays.
 * @functions
 *   - encodeJsonl: Serializes records with sorted keys into stably ordered, newline-delimited JSON text.
 *   - decodeJsonl: Safely deserializes JSONL text into surviving records and reported problems; never throws.
 *   - mergeRecords: Merges two record arrays by id with incoming records taking precedence, sorted by id.
 * @dataflow Records -> sort by id -> sort keys recursively -> JSON.stringify + \n -> JSONL string;
 *   JSONL text -> split on \n -> strip \r -> validate JSON & id -> handle duplicate id / corrupt line -> surviving records + problems.
 * @controlflow encodeJsonl: check empty -> sort records by id -> serialize each record with sorted keys -> join with \n;
 *   decodeJsonl: split lines -> iterate lines -> skip blank -> try JSON.parse -> validate object & string id -> check duplicate id (last wins) -> return records & problems;
 *   mergeRecords: populate map from existing -> overwrite with incoming -> extract values -> sort by id -> return merged list.
 * @version 1
 * @date 2026-09-06
 */

export interface JsonlRecord {
  /** Stable identity of this record within its file. */
  readonly id: string;
}

export interface JsonlProblem {
  /** 1-based line number in the source file. */
  readonly line: number;
  readonly message: string;
  /** The raw line, so a caller can show or preserve what it could not read. */
  readonly raw: string;
}

export interface JsonlReadResult<T extends JsonlRecord> {
  readonly records: readonly T[];
  readonly problems: readonly JsonlProblem[];
}

/**
 * Recursively creates a structural clone of a value with object keys sorted in lexicographical order.
 *
 * Why this exists:
 * Sorting keys within each object matters for the same reason as sorting records: stable key ordering
 * ensures that two records with identical content produce identical serialized JSON lines regardless
 * of the order the object literal was written in or the insertion order in memory, keeping git diffs
 * minimal and preventing artificial merge conflicts. Relying on JSON.stringify directly would preserve
 * property insertion order, leading to spurious diffs across different runtimes or refactors.
 *
 * @purpose Rebuilds an object tree with sorted keys for deterministic serialization.
 * @inputs value - Any JavaScript value or data structure to sort.
 * @outputs unknown - Value with object keys sorted recursively.
 * @dataflow value -> inspect type -> recurse on array elements or sort object keys -> return sorted structure.
 * @controlflow Check primitive / null -> return as-is; check array -> map elements recursively; check object -> sort keys lexicographically and populate new record.
 */
function sortKeys(value: unknown): unknown {
  // Check if value is null or not an object.
  if (value === null || typeof value !== 'object') {
    // Branch: Primitive value (string, number, boolean, null, undefined); return as-is.
    return value;
  } else if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    // Branch: Object provides a custom toJSON method; invoke it and sort the resulting representation.
    return sortKeys((value as { toJSON: () => unknown }).toJSON());
  } else if (Array.isArray(value)) {
    // Branch: Array value; recursively sort elements within the array.
    return value.map((element: unknown): unknown => sortKeys(element));
  } else {
    // Branch: Plain object; collect keys and sort lexicographically.
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const propVal = record[key];
      // Check if property value is defined.
      if (propVal !== undefined) {
        // Branch: Defined property; recursively sort keys of child value.
        sortedObj[key] = sortKeys(propVal);
      } else {
        // Branch: Undefined property; omit from serialized output matching JSON.stringify behavior.
      }
    }
    return sortedObj;
  }
}

/**
 * Serializes an array of records into a stably ordered, newline-delimited JSON (JSONL) string.
 *
 * @purpose Encodes records to line-oriented JSON with sorted records and keys, ending with a single trailing newline.
 * @inputs records - Readonly array of records conforming to JsonlRecord.
 * @outputs string - Encoded JSONL text, or empty string if records array is empty.
 * @dataflow records -> check empty -> sort by id -> map records through sortKeys and JSON.stringify -> join with \n + \n.
 * @controlflow Check records.length === 0 -> return '' if empty; sort shallow copy of records by id; iterate records and serialize each with sorted keys; append trailing '\n'.
 */
export function encodeJsonl<T extends JsonlRecord>(records: readonly T[]): string {
  // Check if records array is empty.
  if (records.length === 0) {
    // Branch: An empty record list encodes to the empty string, not to '\n'.
    return '';
  } else {
    // Branch: Non-empty records; proceed with sorting and encoding.
  }

  // Sort records by id before writing.
  // Stable ordering is what makes a diff show only what changed: without it,
  // a rewrite could reorder untouched records and turn a one-comment change
  // into a whole-file conflict.
  const sortedRecords = [...records].sort((a, b) => {
    // Check lexicographical ordering between record identifiers.
    if (a.id < b.id) {
      // Branch: First id precedes second id lexicographically.
      return -1;
    } else if (a.id > b.id) {
      // Branch: First id follows second id lexicographically.
      return 1;
    } else {
      // Branch: Identifiers are equal.
      return 0;
    }
  });

  // Always '\n', never CRLF:
  // The store's own files are K-Doc's format rather than the user's document,
  // so there is nothing to preserve and a fixed ending keeps a git diff stable across platforms.
  const lines: string[] = [];
  for (const record of sortedRecords) {
    // We write a small recursive key-sorting serializer rather than relying on JSON.stringify's insertion order:
    // JSON.stringify preserves object property insertion order, so sorting keys ensures identical JSON lines.
    const sortedObj = sortKeys(record);
    lines.push(JSON.stringify(sortedObj));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Deserializes line-oriented JSON text into an array of surviving records and diagnostics.
 *
 * @purpose Parses JSONL text into records while tolerating corrupt lines, duplicate ids, CRLF, and missing newlines; never throws.
 * @inputs text - Raw JSONL text to decode.
 * @outputs JsonlReadResult<T> - Container holding surviving records and reported problems.
 * @dataflow text -> split on \n -> strip \r -> skip blank lines -> JSON.parse -> validate object and string id -> handle duplicate ids -> return records and problems.
 * @controlflow Split text into lines -> loop lines -> skip blank lines -> try JSON.parse -> validate record shape:
 *   - JSON syntax error or non-object: record problem and skip.
 *   - Missing or non-string id: record problem and skip.
 *   - Valid record: check for existing id collision (last wins, record problem for earlier occurrence) -> add to map -> sort problems -> return result.
 */
export function decodeJsonl<T extends JsonlRecord>(text: string): JsonlReadResult<T> {
  const problems: JsonlProblem[] = [];
  const recordsById = new Map<string, { record: T; line: number; raw: string }>();

  // Splits on \n, tolerating \r\n and a missing trailing newline.
  const rawLines = text.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    // Check if line is present in the split array.
    if (rawLine === undefined) {
      // Branch: Line index out of bounds; continue loop.
      continue;
    } else {
      // Branch: Line string available; compute 1-based line number.
    }

    const lineNumber = i + 1;
    // Strip carriage return if document used CRLF line endings.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Skips blank lines silently — a blank line carries no record and is not a problem worth reporting.
    if (line.trim() === '') {
      // Branch: Blank or whitespace-only line; skip silently.
      continue;
    } else {
      // Branch: Non-blank line; parse and validate record.
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      // Branch: A line that is not valid JSON becomes a JsonlProblem and is skipped.
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      problems.push({
        line: lineNumber,
        message: `Invalid JSON syntax: ${message}`,
        raw: line,
      });
      continue;
    }

    // Check if parsed value is an object (non-null, non-array).
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // Branch: Value parsed to primitive or array rather than an object; record problem and skip.
      problems.push({
        line: lineNumber,
        message: 'Record must be a JSON object',
        raw: line,
      });
      continue;
    } else {
      // Branch: Parsed value is an object; verify string id.
    }

    const recordObj = parsed as Record<string, unknown>;
    const idVal = recordObj['id'];

    // Check if id is present and is a string.
    if (typeof idVal !== 'string') {
      // Branch: Line parses to an object without a string id; record problem and skip.
      problems.push({
        line: lineNumber,
        message: 'Record missing required string "id" field',
        raw: line,
      });
      continue;
    } else {
      // Branch: Valid string id present on record object.
    }

    // Duplicate ids: keep the last occurrence and record a problem for the earlier one.
    // Last-wins matches how a git merge conflict resolved by concatenation would look,
    // and reporting it lets a caller offer to rewrite the file cleanly.
    const existing = recordsById.get(idVal);
    if (existing !== undefined) {
      // Branch: Duplicate id detected; record problem for the earlier occurrence.
      problems.push({
        line: existing.line,
        message: `Duplicate record id "${idVal}" (overridden by line ${lineNumber})`,
        raw: existing.raw,
      });
      // Delete earlier entry so insertion order reflects the last occurrence.
      recordsById.delete(idVal);
    } else {
      // Branch: First occurrence of this id in the document.
    }

    recordsById.set(idVal, {
      record: recordObj as unknown as T,
      line: lineNumber,
      raw: line,
    });
  }

  // Sort reported problems by line number for clean chronological ordering.
  problems.sort((a, b) => a.line - b.line);

  const survivingRecords: T[] = Array.from(recordsById.values()).map(
    (entry: { record: T; line: number; raw: string }): T => entry.record,
  );

  return {
    records: survivingRecords,
    problems,
  };
}

/**
 * Combines two sets of records by id, with incoming winning on a collision, and returns them sorted by id.
 *
 * Why this exists:
 * This is what a store write does: read, merge, encode — never append blindly,
 * because an append cannot express a deletion or an edit.
 *
 * @purpose Merges existing and incoming record sets by id, returning them sorted by id.
 * @inputs existing - Readonly array of existing records.
 * @inputs incoming - Readonly array of incoming records that supersede existing ones on id collision.
 * @outputs readonly T[] - Merged records sorted lexicographically by id.
 * @dataflow (existing, incoming) -> populate Map with existing -> overwrite with incoming -> sort by id -> return merged array.
 * @controlflow Iterate existing records into Map -> iterate incoming records into Map -> extract values -> sort by id -> return.
 */
export function mergeRecords<T extends JsonlRecord>(
  existing: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  const mergedMap = new Map<string, T>();

  // Populate map with existing records.
  for (const record of existing) {
    mergedMap.set(record.id, record);
  }

  // Overwrite with incoming records on collision (incoming wins).
  for (const record of incoming) {
    mergedMap.set(record.id, record);
  }

  const result: T[] = Array.from(mergedMap.values());

  // Sort merged records lexicographically by id before returning.
  result.sort((a, b) => {
    // Check lexicographical ordering between record identifiers.
    if (a.id < b.id) {
      // Branch: First id precedes second id lexicographically.
      return -1;
    } else if (a.id > b.id) {
      // Branch: First id follows second id lexicographically.
      return 1;
    } else {
      // Branch: Identifiers are equal.
      return 0;
    }
  });

  return result;
}
