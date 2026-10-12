/**
 * @file identity.ts
 * @purpose Manages document identity for the K-Doc annotation store via the kdoc_id YAML front-matter field (FR-6.16, FR-6.17).
 *   Why this exists:
 *   The annotation store is keyed by a document's own identity, never by its path, so renaming or moving a file —
 *   inside K-Doc or outside it — never orphans its annotations. That identity is one YAML front-matter field,
 *   kdoc_id, holding a ULID.
 *   Constraint FR-6.17:
 *   The field is lazily added and never volunteered. A document that is only read or edited never acquires one,
 *   and the field is removed when the last annotation is deleted. A Markdown editor that silently writes metadata
 *   into every file it touches is one nobody can trust with a repository.
 *   Known limitation:
 *   TOML front matter (+++ fence) is parsed and preserved but edited raw in v1, so writing into it is out of scope.
 *   Returning null for TOML front matter means "no identity" rather than "identity in a form we cannot touch".
 * @inputs Markdown source text string, ULID strings, timestamps, and Uint8Array random bytes.
 * @outputs Validated ULID strings, updated Markdown source text with kdoc_id inserted or removed, and null when no identity exists.
 * @functions
 *   - generateUlid: Generates a 26-character Crockford base32 ULID from a 48-bit millisecond timestamp and 80 bits of randomness.
 *   - isValidUlid: Validates that a string is exactly 26 characters using the Crockford base32 alphabet.
 *   - readKdocId: Reads the valid kdoc_id ULID from the opening YAML front-matter block, or returns null.
 *   - withKdocId: Inserts or replaces the kdoc_id field in the YAML front matter while preserving all other lines verbatim.
 *   - withoutKdocId: Removes the kdoc_id field, removing the entire front-matter block if it was the only field.
 * @dataflow Markdown text → detect line endings → identify front matter fence boundaries → parse YAML safely / edit lines → return modified Markdown text.
 * @controlflow Detect line ending (CRLF vs LF) → inspect opening fence (--- vs +++) → locate closing fence → parse/query YAML → apply line-wise edits or block additions → return new text.
 * @version 1
 * @date 2026-09-06
 */

import YAML from 'yaml';

/** The YAML front-matter field name used to identify documents in the annotation store. */
export const KDOC_ID_FIELD: string = 'kdoc_id';

/**
 * Crockford's Base32 alphabet: 32 uppercase characters omitting I, L, O, and U
 * to eliminate visual ambiguity with digits and prevent accidental offensive word generation.
 */
const CROCKFORD_ALPHABET: string = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Internal descriptor locating the boundaries and format of an opening front-matter block.
 */
interface FrontMatterBounds {
  readonly format: 'yaml' | 'toml';
  readonly openIndex: number;
  readonly closeIndex: number;
}

/**
 * Detects the dominant line ending sequence in a text string.
 *
 * @purpose Identifies whether CRLF (\r\n) or LF (\n) is in use in the source text to preserve line endings across edits.
 * @inputs text - Source Markdown text to inspect.
 * @outputs '\r\n' | '\n' - The detected newline delimiter.
 * @dataflow text -> inspect \r\n presence -> newline delimiter string.
 * @controlflow Check if text contains \r\n -> return \r\n if true, \n if false.
 */
function detectLineEnding(text: string): '\r\n' | '\n' {
  // Check if text contains CRLF sequence.
  if (text.includes('\r\n')) {
    // Branch: Document contains Windows CRLF line endings.
    return '\r\n';
  } else {
    // Branch: Document uses standard LF line endings (or is empty / single-line).
    return '\n';
  }
}

/**
 * Identifies front-matter fence boundaries at the start of a document.
 *
 * @purpose Finds the opening and closing fence indices and determines whether front matter is YAML or TOML.
 * @inputs lines - Readonly array of text lines representing the document.
 * @outputs FrontMatterBounds | null - Descriptor with fence indices and format, or null if no front matter exists.
 * @dataflow lines -> inspect line 0 for opening fence (--- or +++) -> locate closing fence -> return FrontMatterBounds or null.
 * @controlflow Verify line 0 exists -> inspect fence type -> scan subsequent lines for matching closing fence -> return bounds or null.
 */
function findFrontMatterBounds(lines: readonly string[]): FrontMatterBounds | null {
  const firstLine = lines[0];
  // Check if the document contains at least one line.
  if (firstLine === undefined) {
    // Branch: Document is empty; no front-matter block exists.
    return null;
  } else {
    // Branch: Document contains lines; inspect opening line.
  }

  let format: 'yaml' | 'toml';
  // Check opening fence identifier.
  if (firstLine.trimEnd() === '---') {
    // Branch: YAML opening fence (---).
    format = 'yaml';
  } else if (firstLine.trimEnd() === '+++') {
    // Branch: TOML opening fence (+++).
    format = 'toml';
  } else {
    // Branch: Document does not begin with a recognized front-matter fence.
    return null;
  }

  // Scan subsequent lines for the corresponding closing fence.
  const targetFence = format === 'yaml' ? '---' : '+++';
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Check if current line matches the closing fence pattern.
    if (line !== undefined && (line.trimEnd() === targetFence || (format === 'yaml' && line.trimEnd() === '...'))) {
      closeIndex = i;
      break;
    } else {
      // Branch: Content line inside front matter; continue scanning.
    }
  }

  // Check whether a matching closing fence was found.
  if (closeIndex === -1) {
    // Branch: Unclosed fence; document has no valid front-matter block.
    return null;
  } else {
    // Branch: Valid front-matter block found between openIndex (0) and closeIndex.
    return {
      format,
      openIndex: 0,
      closeIndex,
    };
  }
}

/**
 * Generates a Universally Unique Lexicographically Sortable Identifier (ULID).
 * A ULID consists of a 48-bit millisecond timestamp (10 characters) followed by
 * 80 bits of randomness (16 characters), encoded in Crockford base32 (alphabet
 * 0123456789ABCDEFGHJKMNPQRSTVWXYZ — no I, L, O or U), 26 characters, uppercase.
 *
 * Both parameters are injectable for tests only:
 * - now defaults to Date.now()
 * - randomBytes defaults to crypto.getRandomValues(new Uint8Array(10))
 *
 * ULIDs sort lexicographically by creation time, which is why the timestamp leads,
 * and that matters for the store's stable ordering later.
 *
 * @purpose Generates a 26-character sortable ULID string from timestamp and randomness.
 * @inputs now - Optional timestamp in milliseconds (injectable for tests only; defaults to Date.now()).
 * @inputs randomBytes - Optional Uint8Array of 10 random bytes (injectable for tests only; defaults to crypto.getRandomValues(new Uint8Array(10))).
 * @outputs string - 26-character uppercase Crockford base32 ULID.
 * @dataflow timestamp + random bytes -> BigInt bit shifts -> Crockford base32 character mapping -> concatenated 26-char ULID string.
 * @controlflow Resolve timestamp (Date.now fallback) -> encode 10-char timestamp -> resolve random bytes (crypto.getRandomValues fallback) -> encode 16-char randomness -> return concatenated ULID.
 */
export function generateUlid(now?: number, randomBytes?: Uint8Array): string {
  // Both parameters are injectable for tests only:
  // default now to Date.now() and the random bytes to crypto.getRandomValues(new Uint8Array(10)).
  let timestampMs: number;
  if (now !== undefined) {
    // Branch: Injected timestamp provided for deterministic test execution.
    timestampMs = now;
  } else {
    // Branch: Standard execution; read current wall-clock time in milliseconds.
    timestampMs = Date.now();
  }

  // Encode 48-bit millisecond timestamp into 10 Crockford Base32 characters (50 bits capacity, big-endian).
  // ULIDs sort lexicographically by creation time, which is why the timestamp leads,
  // and that matters for the store's stable ordering later.
  const timeBig = BigInt(Math.max(0, Math.floor(timestampMs)));
  let timeChars = '';
  for (let i = 9; i >= 0; i--) {
    const shift = BigInt(i * 5);
    const index = Number((timeBig >> shift) & 0x1fn);
    const char = CROCKFORD_ALPHABET.charAt(index);
    timeChars += char;
  }

  let bytes: Uint8Array;
  if (randomBytes !== undefined) {
    // Branch: Injected random bytes provided for deterministic test execution.
    bytes = randomBytes;
  } else {
    // Branch: Standard execution; generate 10 cryptographically secure random bytes (80 bits).
    bytes = crypto.getRandomValues(new Uint8Array(10));
  }

  // Pack 80 bits of randomness (10 bytes) into BigInt.
  let randBig = 0n;
  for (let i = 0; i < 10; i++) {
    const byteVal = bytes[i];
    if (byteVal !== undefined) {
      // Branch: Byte value present; shift 8 bits and bitwise OR.
      randBig = (randBig << 8n) | BigInt(byteVal);
    } else {
      // Branch: Byte index out of bounds; shift zero bits.
      randBig = randBig << 8n;
    }
  }

  // Encode 80 bits of randomness into 16 Crockford Base32 characters (16 * 5 = 80 bits).
  let randChars = '';
  for (let i = 15; i >= 0; i--) {
    const shift = BigInt(i * 5);
    const index = Number((randBig >> shift) & 0x1fn);
    const char = CROCKFORD_ALPHABET.charAt(index);
    randChars += char;
  }

  return `${timeChars}${randChars}`;
}

/**
 * Validates whether a given string is a valid 26-character ULID encoded in Crockford base32.
 *
 * @purpose Checks length 26 and verifies that all characters belong to the Crockford base32 alphabet.
 * @inputs value - String candidate to validate.
 * @outputs boolean - True if the string is a valid 26-character uppercase Crockford base32 ULID, false otherwise.
 * @dataflow Candidate string -> length check -> character validation against CROCKFORD_ALPHABET -> boolean result.
 * @controlflow Check length === 26 -> iterate each character -> verify membership in CROCKFORD_ALPHABET -> return true if all valid, false otherwise.
 */
export function isValidUlid(value: string): boolean {
  // Check whether candidate string length is exactly 26 characters.
  if (value.length !== 26) {
    // Branch: Length is not 26; immediately reject.
    return false;
  } else {
    // Branch: Length is 26; proceed to alphabet verification.
  }

  // Validate each character against the Crockford Base32 alphabet.
  for (let i = 0; i < 26; i++) {
    const ch = value.charAt(i);
    // Check if character is present in the Crockford Base32 alphabet.
    if (!CROCKFORD_ALPHABET.includes(ch)) {
      // Branch: Character is outside the Crockford Base32 alphabet (lowercase, symbol, or excluded letter I, L, O, U).
      return false;
    } else {
      // Branch: Character is valid Crockford Base32; continue scanning.
    }
  }

  // Branch: All 26 characters are valid Crockford Base32 symbols.
  return true;
}

/**
 * Reads the document identity ULID from the opening YAML front-matter block.
 *
 * These operate on Markdown source text, not on a parsed tree, and return new text.
 * Adding an id must not reformat the rest of the document, and round-tripping through
 * the parser and serializer would risk exactly that (FR-4.2). Parse only the front matter
 * block, edit it, and leave every other byte alone.
 *
 * @purpose Extracts the valid kdoc_id ULID from a document's opening YAML front matter.
 * @inputs text - The Markdown source text string to inspect.
 * @outputs string | null - The valid 26-character ULID string if present and valid; null otherwise.
 * @dataflow text -> split lines -> findFrontMatterBounds -> YAML.parse front matter content -> validate kdoc_id ULID -> return ULID or null.
 * @controlflow Inspect front matter bounds -> return null if no block or if block is TOML -> parse YAML content safely -> extract kdoc_id -> validate via isValidUlid -> return id or null.
 */
export function readKdocId(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const bounds = findFrontMatterBounds(lines);

  // Check if front matter block exists.
  if (bounds === null) {
    // Branch: Document does not open with a front-matter block.
    return null;
  } else {
    // Branch: Front-matter block detected.
  }

  // Check whether the front-matter format is TOML.
  // TOML front matter is parsed and preserved but edited raw in v1, so writing into it is
  // out of scope, and returning null means "no identity" rather than "identity in a form
  // we cannot touch"; note that as a known limitation.
  if (bounds.format === 'toml') {
    // Branch: TOML front matter detected; return null per v1 known limitation.
    return null;
  } else {
    // Branch: YAML front matter detected; parse metadata.
  }

  // Extract front matter lines between fences (excluding the fences themselves).
  const contentLines = lines.slice(bounds.openIndex + 1, bounds.closeIndex);
  const rawYaml = contentLines.join('\n');

  // Use the yaml package to safely read values without throwing on malformed input.
  try {
    const parsed: unknown = YAML.parse(rawYaml);
    // Verify that parsed YAML is a non-null object record.
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const candidate = record[KDOC_ID_FIELD];
      // Check if kdoc_id field is present and is a string.
      if (typeof candidate === 'string') {
        // Validate candidate string against ULID Crockford base32 rules.
        if (isValidUlid(candidate)) {
          // Branch: Valid ULID present in front matter.
          return candidate;
        } else {
          // Branch: kdoc_id value is not a valid ULID.
          return null;
        }
      } else {
        // Branch: kdoc_id field is missing or not a string.
        return null;
      }
    } else {
      // Branch: Parsed YAML is scalar or array rather than a key-value record.
      return null;
    }
  } catch {
    // Branch: YAML syntax error in front matter block; return null safely.
    return null;
  }
}

/**
 * Ensures that the document contains the specified kdoc_id in its YAML front matter.
 *
 * @purpose Inserts or replaces the kdoc_id field in the YAML front matter while preserving all other lines and formatting verbatim.
 * @inputs text - Original Markdown source text.
 * @inputs id - Valid 26-character ULID string to set as the document identity.
 * @outputs string - The updated Markdown source text with kdoc_id present.
 * @dataflow (text, id) -> validate id -> detect line endings -> find front matter -> insert new block / replace line / append line -> return updated text.
 * @controlflow Reject invalid id -> detect line ending -> check front matter:
 *   - No front matter: create new YAML block followed by blank line ahead of existing text.
 *   - TOML front matter: return text unchanged (writing to TOML is out of scope in v1).
 *   - YAML front matter with existing kdoc_id: replace its value line-wise.
 *   - YAML front matter without kdoc_id: append kdoc_id last in block before closing fence.
 */
export function withKdocId(text: string, id: string): string {
  // Reject an invalid id by returning the text unchanged:
  // writing a malformed identity would be worse than writing none, because the store
  // would then key on something it can never match again.
  if (!isValidUlid(id)) {
    // Branch: Supplied id is not a valid 26-character ULID; return text unchanged.
    return text;
  } else {
    // Branch: Supplied id is a valid ULID; proceed with insertion/update.
  }

  const eol = detectLineEnding(text);
  const lines = text.split(/\r?\n/);
  const bounds = findFrontMatterBounds(lines);

  // Check if document has an existing front-matter block.
  if (bounds === null) {
    // Branch: When there is no front matter at all, create a block containing only that field,
    // followed by a blank line, ahead of the existing content.
    const frontMatterBlock = `---${eol}${KDOC_ID_FIELD}: ${id}${eol}---${eol}${eol}`;
    return `${frontMatterBlock}${text}`;
  } else if (bounds.format === 'toml') {
    // Branch: A TOML block is parsed and preserved but edited raw in v1, so writing into it is out of scope.
    return text;
  } else {
    // Branch: A YAML front matter block exists; perform line-wise edits.
  }

  // Perform edits line-wise on the source, not by re-serialising the parsed YAML:
  // re-serialising would rewrite quoting, ordering and comments the user chose.
  let existingFieldIndex = -1;
  const kdocIdLineRegex = /^([ \t]*kdoc_id[ \t]*:)[ \t]*(?:['"]?[^#\r\n]*['"]?)?(.*)$/;

  for (let i = bounds.openIndex + 1; i < bounds.closeIndex; i++) {
    const line = lines[i];
    if (line !== undefined && kdocIdLineRegex.test(line)) {
      existingFieldIndex = i;
      break;
    } else {
      // Line is not a kdoc_id field declaration.
    }
  }

  // Check if kdoc_id field already exists in the YAML front matter block.
  if (existingFieldIndex !== -1) {
    // Branch: Field exists; replace its value while preserving leading indentation and any trailing comments.
    const currentLine = lines[existingFieldIndex];
    if (currentLine !== undefined) {
      const match = currentLine.match(kdocIdLineRegex);
      if (match !== null && match[1] !== undefined) {
        const prefix = match[1];
        const trailingComment = match[2] ?? '';
        lines[existingFieldIndex] = `${prefix} ${id}${trailingComment}`;
      } else {
        lines[existingFieldIndex] = `${KDOC_ID_FIELD}: ${id}`;
      }
    } else {
      lines[existingFieldIndex] = `${KDOC_ID_FIELD}: ${id}`;
    }
  } else {
    // Branch: When a YAML block exists without it, insert the field, preserving every other line
    // verbatim including comments and ordering. Insert it last in the block, because
    // appending rather than sorting keeps the user's own field order intact.
    lines.splice(bounds.closeIndex, 0, `${KDOC_ID_FIELD}: ${id}`);
  }

  return lines.join(eol);
}

/**
 * Removes the document identity kdoc_id field from the YAML front matter.
 *
 * When it was the block's only field, remove the whole block, including the trailing blank line,
 * so a document that never had front matter returns to exactly the text it started with.
 * This is what makes FR-6.17's "removed when the last annotation is deleted" leave no trace.
 *
 * @purpose Removes the kdoc_id field or entire YAML front matter block if kdoc_id was the only field.
 * @inputs text - Original Markdown source text.
 * @outputs string - The updated Markdown source text with kdoc_id removed.
 * @dataflow text -> detect line endings -> find front matter -> check other fields via yaml -> remove line or whole block -> return updated text.
 * @controlflow Inspect front matter bounds -> return text unchanged if no YAML block -> check for kdoc_id line ->
 *   if absent, return text unchanged -> parse front matter content with YAML to count fields:
 *   - If kdoc_id is only field: delete block (openIndex to closeIndex) plus trailing blank line if present.
 *   - If other fields exist: remove only the kdoc_id line.
 */
export function withoutKdocId(text: string): string {
  const eol = detectLineEnding(text);
  const lines = text.split(/\r?\n/);
  const bounds = findFrontMatterBounds(lines);

  // Check if YAML front matter block exists.
  if (bounds === null || bounds.format !== 'yaml') {
    // Branch: No front matter or TOML front matter; return text unchanged.
    return text;
  } else {
    // Branch: YAML front matter block present.
  }

  // Locate the kdoc_id line index in the front matter block.
  let kdocIdLineIndex = -1;
  const kdocIdLineRegex = /^([ \t]*kdoc_id[ \t]*:)/;
  for (let i = bounds.openIndex + 1; i < bounds.closeIndex; i++) {
    const line = lines[i];
    if (line !== undefined && kdocIdLineRegex.test(line)) {
      kdocIdLineIndex = i;
      break;
    } else {
      // Line is not a kdoc_id declaration.
    }
  }

  // Check whether kdoc_id is present in the block.
  if (kdocIdLineIndex === -1) {
    // Branch: kdoc_id is not present; return text unchanged.
    return text;
  } else {
    // Branch: kdoc_id field found at kdocIdLineIndex.
  }

  // Determine whether kdoc_id was the block's only field using the yaml package.
  const contentLines = lines.slice(bounds.openIndex + 1, bounds.closeIndex);
  const rawYaml = contentLines.join('\n');
  let isOnlyField = false;

  try {
    const parsed: unknown = YAML.parse(rawYaml);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      // Check if kdoc_id is the solitary field key in the YAML object.
      if (keys.length === 1 && keys[0] === KDOC_ID_FIELD) {
        // Branch: kdoc_id is the only field in the YAML mapping.
        isOnlyField = true;
      } else {
        // Branch: Other fields exist alongside kdoc_id in the YAML mapping.
        isOnlyField = false;
      }
    } else {
      // Branch: Parsed YAML is not a multi-key record.
      isOnlyField = false;
    }
  } catch {
    // Branch: Fallback check on raw content lines if YAML parsing errors.
    const meaningfulLines = contentLines.filter((line: string): boolean => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });
    isOnlyField = meaningfulLines.length === 1;
  }

  // Check whether kdoc_id was the block's only field.
  if (isOnlyField) {
    // Branch: When it was the block's only field, remove the whole block, including the trailing
    // blank line, so a document that never had front matter returns to exactly the text it started with.
    // This is what makes FR-6.17's "removed when the last annotation is deleted" leave no trace.
    let linesToDelete = bounds.closeIndex - bounds.openIndex + 1;
    const lineAfterClose = lines[bounds.closeIndex + 1];

    // Check if the line following the closing fence is a blank line.
    if (lineAfterClose !== undefined && lineAfterClose.trim() === '') {
      // Branch: Trailing blank line is present; remove it along with the block.
      linesToDelete += 1;
    } else {
      // Branch: No trailing blank line immediately follows.
    }

    lines.splice(bounds.openIndex, linesToDelete);
  } else {
    // Branch: Other fields exist; remove only the kdoc_id line, preserving all other lines,
    // comments, and the front-matter fences verbatim.
    lines.splice(kdocIdLineIndex, 1);
  }

  return lines.join(eol);
}
