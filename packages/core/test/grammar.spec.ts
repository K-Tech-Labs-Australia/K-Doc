/**
 * @file grammar.spec.ts
 * @purpose Covers reading a grammar service's reply (FR-12.4). The reply comes from a service the reader configured, which may be any version or none at all, so the tests are mostly about what is refused.
 * @inputs hand-written /v2/check response bodies.
 * @outputs assertions over parseGrammarResponse.
 * @functions the describe block below.
 * @dataflow response body -> parseGrammarResponse -> issues.
 * @controlflow one it per thing that can be wrong with a reply.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { MAX_REPLACEMENTS, parseGrammarResponse } from '../src/proofing/grammar.js';

const TEXT_LENGTH = 100;

function reply(matches: unknown): unknown {
  return { software: { name: 'LanguageTool' }, matches };
}

describe('parseGrammarResponse', () => {
  // A complete, valid match must be normalized into the internal issue shape.
  it('reads a well-formed match', () => {
    const issues = parseGrammarResponse(
      reply([
        {
          offset: 10,
          length: 4,
          message: 'Possible spelling mistake found.',
          rule: { id: 'MORFOLOGIK_RULE_EN_GB' },
          replacements: [{ value: 'their' }, { value: 'there' }],
        },
      ]),
      TEXT_LENGTH,
    );
    expect(issues).toEqual([
      {
        offset: 10,
        length: 4,
        message: 'Possible spelling mistake found.',
        ruleId: 'MORFOLOGIK_RULE_EN_GB',
        replacements: ['their', 'there'],
      },
    ]);
  });

  // A top-level reply that is not a grammar reply must yield no issues.
  it('finds nothing in a reply that is not one', () => {
    expect(parseGrammarResponse(null, TEXT_LENGTH)).toEqual([]);
    expect(parseGrammarResponse('not a reply', TEXT_LENGTH)).toEqual([]);
    expect(parseGrammarResponse({}, TEXT_LENGTH)).toEqual([]);
    expect(parseGrammarResponse(reply('not a list'), TEXT_LENGTH)).toEqual([]);
  });

  // A reply is JSON from somewhere else, so null and a bare string can both appear where an object
  // should be. Reading a field off null throws, which would lose the whole reply over one bad entry.
  it('drops an entry that is not a match at all', () => {
    const issues = parseGrammarResponse(
      reply([null, 'a string', 42, { offset: 5, length: 2, message: 'Good.' }]),
      TEXT_LENGTH,
    );
    expect(issues.map((issue) => issue.message)).toEqual(['Good.']);
  });

  // The same for a suggestion: null where an object should be must not take the rest with it.
  it('drops a suggestion that is not one', () => {
    const issues = parseGrammarResponse(
      reply([{ offset: 1, length: 2, message: 'Something.', replacements: [null, { value: 'fine' }] }]),
      TEXT_LENGTH,
    );
    expect(issues[0]?.replacements).toEqual(['fine']);
  });

  // A match that does not pin down where it is must be dropped.
  it('drops a match that does not say where it is', () => {
    const issues = parseGrammarResponse(
      reply([
        { length: 4, message: 'No offset.' },
        { offset: 'ten', length: 4, message: 'Offset is not a number.' },
        { offset: 1.5, length: 4, message: 'Offset is not whole.' },
        { offset: -1, length: 4, message: 'Offset is before the start.' },
        { offset: 5, message: 'No length.' },
        { offset: 5, length: 0, message: 'Length is nothing.' },
      ]),
      TEXT_LENGTH,
    );
    expect(issues).toEqual([]);
  });

  // An issue past the end would be highlighted somewhere that does not exist.
  it('drops a match that points past the end of the document', () => {
    const issues = parseGrammarResponse(
      reply([
        { offset: 98, length: 5, message: 'Runs off the end.' },
        { offset: 96, length: 4, message: 'Ends exactly at the end.' },
      ]),
      TEXT_LENGTH,
    );
    expect(issues.map((issue) => issue.message)).toEqual(['Ends exactly at the end.']);
  });

  // A match with nothing to say must be dropped.
  it('drops a match with nothing to say', () => {
    const issues = parseGrammarResponse(reply([{ offset: 1, length: 2 }, { offset: 3, length: 2, message: '' }]), TEXT_LENGTH);
    expect(issues).toEqual([]);
  });

  // A missing rule must not crash; it defaults to an empty id and no suggestions.
  it('copes with a match that names no rule', () => {
    const issues = parseGrammarResponse(reply([{ offset: 1, length: 2, message: 'Something.' }]), TEXT_LENGTH);
    expect(issues[0]?.ruleId).toBe('');
    expect(issues[0]?.replacements).toEqual([]);
  });

  // Only genuine suggestion objects survive into the replacements list.
  it('keeps only suggestions that are suggestions', () => {
    const issues = parseGrammarResponse(
      reply([
        {
          offset: 1,
          length: 2,
          message: 'Something.',
          replacements: [{ value: 'good' }, 'bare string', { notValue: 'x' }, { value: '' }, { value: 'also good' }],
        },
      ]),
      TEXT_LENGTH,
    );
    expect(issues[0]?.replacements).toEqual(['good', 'also good']);
  });

  // The number of suggestions offered must never exceed what anyone would read.
  it('does not offer more suggestions than anyone would read', () => {
    const many = Array.from({ length: MAX_REPLACEMENTS + 4 }, (_unused, index) => ({ value: `option ${index}` }));
    const issues = parseGrammarResponse(reply([{ offset: 1, length: 2, message: 'Something.', replacements: many }]), TEXT_LENGTH);
    expect(issues[0]?.replacements).toHaveLength(MAX_REPLACEMENTS);
  });

  // A service is not obliged to answer in order, and the panel lists problems in it.
  it('puts the issues in document order', () => {
    const issues = parseGrammarResponse(
      reply([
        { offset: 40, length: 2, message: 'Third.' },
        { offset: 5, length: 2, message: 'First.' },
        { offset: 20, length: 2, message: 'Second.' },
      ]),
      TEXT_LENGTH,
    );
    expect(issues.map((issue) => issue.message)).toEqual(['First.', 'Second.', 'Third.']);
  });

  // Valid matches must survive a reply that also contains bad ones.
  it('keeps the good matches in a reply that also has bad ones', () => {
    const issues = parseGrammarResponse(
      reply([{ offset: -5, length: 2, message: 'Bad.' }, { offset: 5, length: 2, message: 'Good.' }]),
      TEXT_LENGTH,
    );
    expect(issues.map((issue) => issue.message)).toEqual(['Good.']);
  });
});
