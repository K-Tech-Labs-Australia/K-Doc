/**
 * @file grammar.ts
 * @purpose Reads the answer a LanguageTool-compatible service gives back (FR-12.4). The request and the network live in the app; this is the part that turns a reply into something the editor can show, and it is here so it can be tested without one.
 * @inputs the parsed JSON body of a /v2/check response.
 * @outputs the issues it describes, in document order.
 * @functions
 *   - parseGrammarResponse: turn a raw service reply into validated GrammarIssue entries sorted by position.
 * @dataflow response JSON -> matches -> GrammarIssue[].
 * @controlflow the reply comes from a service the reader configured, which may be any version or none at all, so every field is checked and a match that does not make sense is dropped rather than trusted.
 * @version 1
 * @date 2026-09-16
 */

/**
 * @purpose A single problem found in the document: where it is, what it is, which rule found it, and what the service suggests instead.
 * @inputs offset and length locate the span of text; message names the problem; ruleId identifies the rule; replacements lists suggested fixes.
 * @outputs None directly; consumed by the editor to render a proofing panel in document order.
 * @dataflow Populated from one match entry inside a service reply, then returned as part of GrammarIssue[].
 * @controlflow Values are fixed once created (readonly) so callers can reorder without corrupting an issue.
 */
export interface GrammarIssue {
  readonly offset: number;
  readonly length: number;
  readonly message: string;
  readonly ruleId: string;
  readonly replacements: readonly string[];
}

/**
 * @purpose Caps how many replacement suggestions are kept for a single issue.
 * @inputs None; used as the stopping point while collecting replacements.
 * @outputs The maximum number of entries readReplacements will retain from one match.
 * @dataflow Referenced inside readReplacements to stop gathering once reached.
 * @controlflow A service can offer dozens of alternatives for one word; past a handful they stop being a choice and become a list to read, so iteration breaks early.
 */
export const MAX_REPLACEMENTS: number = 5;

function readString(value: unknown): string {
  // A missing or non-string field is read as empty rather than "undefined" shown to the reader.
  return typeof value === 'string' ? value : '';
}

function readReplacements(value: unknown): string[] {
  // Reject anything that is not an array; there are no suggestions to keep in that case.
  if (!Array.isArray(value)) {
    return [];
  } else {
    // Intentionally empty: the branch above already returned, kept so the pair stays explicit.
  }

  const out: string[] = [];
  for (const entry of value) {
    // Skip entries that are not objects; a suggestion must be an object carrying a "value".
    if (typeof entry !== 'object' || entry === null) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }
    const text = (entry as Record<string, unknown>)['value'];
    // Skip suggestions without a usable non-empty string value.
    if (typeof text !== 'string' || text.length === 0) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }
    out.push(text);
    // Stop once the cap is met so extra suggestions are not gathered.
    if (out.length >= MAX_REPLACEMENTS) {
      break;
    } else {
      // Intentionally empty: the branch above already broke, kept so the pair stays explicit.
    }
  }
  return out;
}

/**
 * @purpose Turn a raw /v2/check reply into validated grammar issues in document order.
 * @inputs body is the parsed JSON of the service response; textLength is the length of the document being proofed, used to reject out-of-range matches.
 * @outputs an array of GrammarIssue sorted by offset, empty when the reply has no usable matches.
 * @dataflow response JSON -> matches -> per-match validation -> GrammarIssue[].
 * @controlflow The reply comes from a service the reader configured, so nothing is trusted: each field is checked and any match that fails validation is dropped rather than shown.
 */
export function parseGrammarResponse(body: unknown, textLength: number): readonly GrammarIssue[] {
  // Reject a non-object body; there are no matches to read in that case.
  if (typeof body !== 'object' || body === null) {
    return [];
  } else {
    // Intentionally empty: the branch above already returned, kept so the pair stays explicit.
  }

  const matches = (body as Record<string, unknown>)['matches'];
  // Reject a reply whose matches are not an array; there is nothing to iterate.
  if (!Array.isArray(matches)) {
    return [];
  } else {
    // Intentionally empty: the branch above already returned, kept so the pair stays explicit.
  }

  const issues: GrammarIssue[] = [];
  for (const match of matches) {
    // Skip entries that are not objects; a match must carry offset, length, and message.
    if (typeof match !== 'object' || match === null) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }

    const record = match as Record<string, unknown>;
    const offset = record['offset'];
    const length = record['length'];
    // Reject a missing or non-integer negative offset; position must be a whole number at or after the start.
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }
    // Reject a missing or non-integer zero/negative length; an issue must span at least one character.
    if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }
    // Reject a match that runs past the end of the document; it would highlight text that does not exist.
    if (offset + length > textLength) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }

    const rule = record['rule'];
    const ruleId = typeof rule === 'object' && rule !== null ? readString((rule as Record<string, unknown>)['id']) : '';
    const message = readString(record['message']);
    // Reject a match with no description; without a message there is nothing to show the reader.
    if (message.length === 0) {
      continue;
    } else {
      // Intentionally empty: the branch above already continued, kept so the pair stays explicit.
    }

    issues.push({
      offset,
      length,
      message,
      ruleId,
      replacements: readReplacements(record['replacements']),
    });
  }

  // Order by position because a service is not obliged to return matches in document order and the panel lists them that way.
  issues.sort((left, right) => left.offset - right.offset);
  return issues;
}
