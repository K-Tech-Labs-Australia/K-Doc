/**
 * @file jsonl.test.ts
 * @purpose Vitest test suite for line-oriented JSON (JSONL) storage format in @k-doc/core (FR-6.21, FR-6.23).
 *   Verifies round-trip fidelity, deterministic key sorting, record sorting by id, empty list handling,
 *   fault tolerance on corrupt or non-conformant lines, line ending tolerance (CRLF/LF), missing trailing newlines,
 *   duplicate id resolution (last-wins), and record merging.
 * @inputs Serialized JSONL text strings, mock JsonlRecord objects, and mixed valid/invalid line buffers.
 * @outputs Vitest assertions verifying encodeJsonl, decodeJsonl, and mergeRecords outputs and diagnostics.
 * @functions None.
 * @dataflow Mock record structures -> encodeJsonl / mergeRecords -> string / record arrays;
 *   JSONL text -> decodeJsonl -> JsonlReadResult (records and problems) -> Vitest assertions.
 * @controlflow Execute test suites covering round-trip serialization, key sorting, record sorting, empty inputs, corrupt line recovery, id validation, CRLF handling, duplicate id handling, and record merging.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import type { JsonlRecord } from './jsonl.js';
import { decodeJsonl, encodeJsonl, mergeRecords } from './jsonl.js';

interface SampleRecord extends JsonlRecord {
  readonly id: string;
  readonly author?: string;
  readonly text?: string;
  readonly version?: number;
  readonly val?: number;
}

describe('encodeJsonl and decodeJsonl round trip', () => {
  // Pins that encoding records and decoding the resulting JSONL reproduces the original records verbatim.
  it('successfully round-trips records through encodeJsonl and decodeJsonl', () => {
    const original: readonly SampleRecord[] = [
      { id: '01J6ABCDEF012345678901234A', author: 'Alice', text: 'First comment' },
      { id: '01J6ABCDEF012345678901234B', author: 'Bob', text: 'Second comment' },
    ];
    const encoded = encodeJsonl(original);
    const result = decodeJsonl<SampleRecord>(encoded);

    expect(result.problems).toEqual([]);
    expect(result.records).toEqual(original);
  });
});

describe('encodeJsonl key sorting', () => {
  // Pins that object keys are sorted alphabetically regardless of the order they were written in the object literal.
  it('produces identical output for identical records written with different key orders in object literals', () => {
    const recordA = { z: 1, id: 'rec-01', a: 'first', m: true };
    const recordB = { a: 'first', m: true, id: 'rec-01', z: 1 };
    const encodedA = encodeJsonl([recordA]);
    const encodedB = encodeJsonl([recordB]);

    expect(encodedA).toBe(encodedB);
    expect(encodedA).toBe('{"a":"first","id":"rec-01","m":true,"z":1}\n');
  });

  // Pins that key sorting applies recursively through nested objects and objects within arrays.
  it('recursively sorts keys inside nested objects and array elements', () => {
    const record = {
      id: 'rec-nested',
      meta: { z: 1, a: 2 },
      items: [{ d: 4, c: 3 }],
    };
    const encoded = encodeJsonl([record]);

    expect(encoded).toBe('{"id":"rec-nested","items":[{"c":3,"d":4}],"meta":{"a":2,"z":1}}\n');
  });
});

describe('encodeJsonl record sorting', () => {
  // Pins that encodeJsonl sorts records lexicographically by id before serializing to disk.
  it('sorts records lexicographically by id regardless of input array order', () => {
    const records: readonly SampleRecord[] = [
      { id: 'rec-03', text: 'third' },
      { id: 'rec-01', text: 'first' },
      { id: 'rec-02', text: 'second' },
    ];
    const encoded = encodeJsonl(records);
    const expected = '{"id":"rec-01","text":"first"}\n{"id":"rec-02","text":"second"}\n{"id":"rec-03","text":"third"}\n';

    expect(encoded).toBe(expected);
  });

  // Pins that encoding an empty array produces an empty string rather than a newline.
  it('encodes an empty record list to the empty string rather than a newline', () => {
    expect(encodeJsonl([])).toBe('');
  });
});

describe('decodeJsonl fault tolerance and edge cases', () => {
  // Pins that a corrupt JSON line is skipped with a problem reported while surrounding valid records survive intact.
  it('skips a corrupt JSON line, reports a problem with the line number and raw text, and returns surviving neighbours', () => {
    const text = '{"id":"rec-01","text":"one"}\n{corrupted json\n{"id":"rec-02","text":"two"}\n';
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.records).toEqual([
      { id: 'rec-01', text: 'one' },
      { id: 'rec-02', text: 'two' },
    ]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.line).toBe(2);
    expect(result.problems[0]?.raw).toBe('{corrupted json');
    expect(result.problems[0]?.message).toMatch(/json/i);
  });

  // Pins that valid JSON representing non-objects or objects without a string id are rejected and reported as problems.
  it('rejects lines that are valid JSON but lack a valid string id property', () => {
    const text = [
      '{"id":"rec-01","text":"valid"}',
      '{"text":"missing id"}',
      '{"id":12345,"text":"numeric id"}',
      '{"id":null,"text":"null id"}',
      '[1, 2, 3]',
      '"just a string"',
      '{"id":"rec-02","text":"also valid"}',
    ].join('\n');
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.records).toEqual([
      { id: 'rec-01', text: 'valid' },
      { id: 'rec-02', text: 'also valid' },
    ]);
    expect(result.problems).toHaveLength(5);
    expect(result.problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6]);
  });

  // Pins that Windows CRLF line endings are tolerated and stripped during decoding.
  it('decodes CRLF delimited input correctly without corrupting records or reporting problems', () => {
    const text = '{"id":"rec-01","val":1}\r\n{"id":"rec-02","val":2}\r\n';
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.problems).toEqual([]);
    expect(result.records).toEqual([
      { id: 'rec-01', val: 1 },
      { id: 'rec-02', val: 2 },
    ]);
  });

  // Pins that text lacking a trailing newline decodes without errors or missing the last record.
  it('decodes input without a trailing newline correctly', () => {
    const text = '{"id":"rec-01","val":1}\n{"id":"rec-02","val":2}';
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.problems).toEqual([]);
    expect(result.records).toEqual([
      { id: 'rec-01', val: 1 },
      { id: 'rec-02', val: 2 },
    ]);
  });

  // Pins that blank and whitespace-only lines are silently ignored without reporting problems.
  it('silently ignores blank lines between records and at file boundaries', () => {
    const text = '\n  \n{"id":"rec-01","text":"only"}\n\n\t\n';
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.problems).toEqual([]);
    expect(result.records).toEqual([{ id: 'rec-01', text: 'only' }]);
  });

  // Pins that duplicate record ids retain the last occurrence and report earlier occurrences as problems.
  it('keeps the last occurrence on duplicate ids and records a problem for earlier occurrences', () => {
    const text = [
      '{"id":"rec-01","version":1}',
      '{"id":"rec-02","version":1}',
      '{"id":"rec-01","version":2}',
    ].join('\n');
    const result = decodeJsonl<SampleRecord>(text);

    expect(result.records).toEqual([
      { id: 'rec-02', version: 1 },
      { id: 'rec-01', version: 2 },
    ]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.line).toBe(1);
    expect(result.problems[0]?.raw).toBe('{"id":"rec-01","version":1}');
    expect(result.problems[0]?.message).toMatch(/duplicate/i);
  });
});

describe('mergeRecords', () => {
  // Pins that mergeRecords combines record sets by id with incoming records superseding existing ones.
  it('merges records by id with incoming records taking precedence on collision and outputs sorted by id', () => {
    const existing: readonly SampleRecord[] = [
      { id: 'rec-01', text: 'original 1' },
      { id: 'rec-02', text: 'original 2' },
      { id: 'rec-04', text: 'original 4' },
    ];
    const incoming: readonly SampleRecord[] = [
      { id: 'rec-02', text: 'updated 2' },
      { id: 'rec-03', text: 'new 3' },
    ];
    const merged = mergeRecords(existing, incoming);

    expect(merged).toEqual([
      { id: 'rec-01', text: 'original 1' },
      { id: 'rec-02', text: 'updated 2' },
      { id: 'rec-03', text: 'new 3' },
      { id: 'rec-04', text: 'original 4' },
    ]);
  });
});
