/**
 * @file identity.test.ts
 * @purpose Unit test suite verifying ULID generation, validation, and front-matter identity management in @k-doc/core (FR-6.16, FR-6.17).
 * @inputs Source Markdown documents (no front matter, YAML front matter, TOML front matter, CRLF/LF line endings), valid and invalid ULID strings.
 * @outputs Vitest assertions covering generateUlid, isValidUlid, readKdocId, withKdocId, and withoutKdocId.
 * @functions None.
 * @dataflow Input Markdown text and ULIDs -> identity functions (generateUlid, isValidUlid, readKdocId, withKdocId, withoutKdocId) -> transformed text / ULID / boolean -> Vitest assertions.
 * @controlflow Execute test suites grouped by unit under test: generateUlid and isValidUlid -> readKdocId -> withKdocId -> withoutKdocId -> CRLF line endings.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import {
  generateUlid,
  isValidUlid,
  readKdocId,
  withKdocId,
  withoutKdocId,
  KDOC_ID_FIELD,
} from './identity.js';

// Build every backslash and newline from String.fromCharCode to prevent silent test invalidation:
// a fixture whose escape sequence is mangled by an editor or a script passes while proving nothing,
// and this suite is full of exact-text assertions where that would go unnoticed.
const NL: string = String.fromCharCode(10);
const CR: string = String.fromCharCode(13);
const CRLF: string = `${CR}${NL}`;

const ID: string = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ID2: string = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe('generateUlid and isValidUlid', () => {
  // Pins that a generated ULID has length 26, satisfies isValidUlid, and excludes ambiguous characters I, L, O, and U.
  it('generates a 26-character valid ULID excluding I, L, O, and U', () => {
    const ulid = generateUlid();
    expect(ulid).toHaveLength(26);
    expect(isValidUlid(ulid)).toBe(true);
    expect(ulid.includes('I')).toBe(false);
    expect(ulid.includes('L')).toBe(false);
    expect(ulid.includes('O')).toBe(false);
    expect(ulid.includes('U')).toBe(false);
  });

  // Pins that generateUlid is deterministic when now and randomBytes are injected.
  it('produces deterministic output when given fixed timestamp and random bytes', () => {
    // The now and randomBytes parameters exist for exactly this: deterministic test execution without wall-clock or CSPRNG variance.
    const fixedNow = 1_725_624_000_000;
    const fixedBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const first = generateUlid(fixedNow, fixedBytes);
    const second = generateUlid(fixedNow, fixedBytes);

    expect(first).toBe(second);
    expect(first).toHaveLength(26);
  });

  // Pins that ULIDs generated with increasing timestamps sort lexicographically by creation time.
  it('sorts lexicographically with < when generated with an increasing timestamp', () => {
    // Lexicographic sortability by creation time is why the timestamp leads, and the store's stable ordering depends on it.
    const fixedBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const earlier = generateUlid(1_000_000, fixedBytes);
    const later = generateUlid(2_000_000, fixedBytes);

    expect(earlier < later).toBe(true);
  });

  // Pins that isValidUlid rejects strings with invalid lengths, lowercase letters, or excluded characters.
  it('rejects candidate strings that have invalid length, lowercase casing, or excluded characters', () => {
    // 25 characters (too short).
    expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false);
    // 27 characters (too long).
    expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVA')).toBe(false);
    // Lowercase letters (must be uppercase Crockford Base32).
    expect(isValidUlid('01arz3ndektsv4rrffq69g5fav')).toBe(false);
    // Excluded character 'I'.
    expect(isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
  });
});

describe('readKdocId', () => {
  // Pins that readKdocId extracts the ULID from a front-matter block containing only the kdoc_id field.
  it('returns the id from a YAML block containing only kdoc_id', () => {
    const text = ['---', `${KDOC_ID_FIELD}: ${ID}`, '---', '', '# Document body'].join(NL);
    expect(readKdocId(text)).toBe(ID);
  });

  // Pins that readKdocId finds and extracts the ULID when surrounded by other front-matter fields.
  it('returns the id when other fields surround it', () => {
    const text = [
      '---',
      'title: Specification',
      'author: Alice',
      `${KDOC_ID_FIELD}: ${ID}`,
      'tags: [design, architecture]',
      '---',
      '',
      '# Content',
    ].join(NL);
    expect(readKdocId(text)).toBe(ID);
  });

  // Pins that readKdocId returns null when front matter is missing, lacks kdoc_id, uses TOML, or contains an invalid ULID.
  it('returns null for missing front matter, absent field, TOML blocks, or invalid ULID values', () => {
    // No front matter.
    const noFrontMatter = ['# Document Title', 'Paragraph without front matter.'].join(NL);
    expect(readKdocId(noFrontMatter)).toBeNull();

    // YAML block without kdoc_id.
    const yamlWithoutField = ['---', 'title: Only Title', 'status: draft', '---', '', '# Body'].join(NL);
    expect(readKdocId(yamlWithoutField)).toBeNull();

    // TOML (+++) block.
    const tomlBlock = ['+++', `kdoc_id = "${ID}"`, '+++', '', '# Body'].join(NL);
    expect(readKdocId(tomlBlock)).toBeNull();

    // Value present but not a valid ULID.
    const invalidUlidBlock = ['---', `${KDOC_ID_FIELD}: invalid-ulid-value`, '---', '', '# Body'].join(NL);
    expect(readKdocId(invalidUlidBlock)).toBeNull();
  });
});

describe('withKdocId', () => {
  // Pins that withKdocId prepends a new YAML block and blank line while leaving the original text unchanged when no front matter exists.
  it('prepends a minimal YAML front-matter block and blank line when no front matter exists', () => {
    const originalText = ['# Header', 'Content paragraph.'].join(NL);
    const expected = ['---', `${KDOC_ID_FIELD}: ${ID}`, '---', '', '# Header', 'Content paragraph.'].join(NL);
    expect(withKdocId(originalText, ID)).toBe(expected);
  });

  // Pins that withKdocId appends kdoc_id last in an existing YAML block, preserving comments and original lines verbatim.
  it('appends kdoc_id last in an existing YAML block preserving comments and field order verbatim', () => {
    const originalText = [
      '---',
      '# Leading comment',
      'title: Original Title',
      'author: Alice # Inline comment',
      '---',
      '',
      'Body text.',
    ].join(NL);
    const expected = [
      '---',
      '# Leading comment',
      'title: Original Title',
      'author: Alice # Inline comment',
      `${KDOC_ID_FIELD}: ${ID}`,
      '---',
      '',
      'Body text.',
    ].join(NL);
    expect(withKdocId(originalText, ID)).toBe(expected);
  });

  // Pins that withKdocId replaces an existing kdoc_id in place without altering surrounding fields or order.
  it('replaces the existing kdoc_id value in place without modifying surrounding lines', () => {
    const originalText = [
      '---',
      'title: Note',
      `${KDOC_ID_FIELD}: ${ID}`,
      'date: 2026-09-06',
      '---',
      '',
      'Body text.',
    ].join(NL);
    const expected = [
      '---',
      'title: Note',
      `${KDOC_ID_FIELD}: ${ID2}`,
      'date: 2026-09-06',
      '---',
      '',
      'Body text.',
    ].join(NL);
    expect(withKdocId(originalText, ID2)).toBe(expected);
  });

  // Pins that withKdocId returns the original text unchanged when supplied with an invalid ULID.
  it('returns the text completely unchanged when an invalid id is supplied', () => {
    // Writing a malformed identity would be worse than writing none, because the store would key on something it can never match again.
    const text = ['---', 'title: Note', '---', '', 'Body text.'].join(NL);
    expect(withKdocId(text, 'not-a-valid-ulid')).toBe(text);
  });

  // Pins that withKdocId leaves a document with TOML front matter unchanged.
  it('returns a document with TOML front matter unchanged', () => {
    const tomlText = ['+++', 'title = "TOML Document"', '+++', '', 'Body text.'].join(NL);
    expect(withKdocId(tomlText, ID)).toBe(tomlText);
  });
});

describe('withoutKdocId', () => {
  // Pins that withoutKdocId round-trips byte for byte with withKdocId for documents with no front matter and documents with existing fields.
  it('removes the entire block and trailing blank line when kdoc_id was the only field, round-tripping byte for byte', () => {
    // Round trip on a document with no front matter:
    const textNoFm = ['# Title', '', 'Body text without front matter.'].join(NL);
    const withIdNoFm = withKdocId(textNoFm, ID);
    expect(withoutKdocId(withIdNoFm)).toBe(textNoFm);

    // Round trip on a document that already had other fields:
    const textWithFields = [
      '---',
      'title: Surviving Title',
      'author: Alice',
      '---',
      '',
      'Body text.',
    ].join(NL);
    const withIdFields = withKdocId(textWithFields, ID);
    expect(withoutKdocId(withIdFields)).toBe(textWithFields);
  });

  // Pins that withoutKdocId removes only the kdoc_id line when other fields exist, preserving other fields and comments intact.
  it('leaves the block, other fields, and comments intact when removing kdoc_id from a multi-field block', () => {
    const text = [
      '---',
      '# Section comment',
      'title: Preserved',
      `${KDOC_ID_FIELD}: ${ID}`,
      'tags: [a, b]',
      '---',
      '',
      'Body text.',
    ].join(NL);
    const expected = [
      '---',
      '# Section comment',
      'title: Preserved',
      'tags: [a, b]',
      '---',
      '',
      'Body text.',
    ].join(NL);
    expect(withoutKdocId(text)).toBe(expected);
  });

  // Pins that withoutKdocId returns documents lacking the kdoc_id field unchanged.
  it('returns a document without the kdoc_id field unchanged', () => {
    const noFrontMatter = ['# Header', 'Content paragraph.'].join(NL);
    expect(withoutKdocId(noFrontMatter)).toBe(noFrontMatter);

    const yamlWithoutId = ['---', 'title: Unaffected', '---', '', 'Body.'].join(NL);
    expect(withoutKdocId(yamlWithoutId)).toBe(yamlWithoutId);
  });
});

describe('CRLF line endings', () => {
  // Pins that withKdocId and withoutKdocId preserve Windows CRLF line endings byte for byte across round trips.
  it('preserves CRLF line endings byte for byte across withKdocId and withoutKdocId round trips', () => {
    // The document's line ending is the user's and must survive.
    const crlfText = ['# Document Title', '', 'Line one with CRLF.', 'Line two with CRLF.'].join(CRLF);
    const updated = withKdocId(crlfText, ID);
    expect(updated.includes(CRLF)).toBe(true);
    const roundTripped = withoutKdocId(updated);
    expect(roundTripped).toBe(crlfText);

    // Round trip on a CRLF document that already had other front-matter fields.
    const crlfWithFields = [
      '---',
      'title: CRLF Document',
      'author: Bob',
      '---',
      '',
      'Body text.',
    ].join(CRLF);
    const updatedWithFields = withKdocId(crlfWithFields, ID);
    expect(updatedWithFields.includes(CRLF)).toBe(true);
    expect(withoutKdocId(updatedWithFields)).toBe(crlfWithFields);
  });
});
