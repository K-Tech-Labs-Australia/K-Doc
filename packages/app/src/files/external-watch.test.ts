/**
 * @file external-watch.test.ts
 * @purpose Pins isOwnWrite: a file change is K-Doc's own when the disk holds the session's text or its last save.
 * @inputs Plain snapshot objects.
 * @outputs Vitest assertions.
 * @functions (suite) isOwnWrite.
 * @dataflow disk text + snapshot -> isOwnWrite -> boolean.
 * @controlflow Independent cases.
 * @version 1
 * @date 2026-10-07
 */
import { describe, expect, it } from 'vitest';
import { isOwnWrite } from './external-watch.js';

describe('isOwnWrite', () => {
  it('recognises a save the user kept typing through', () => {
    expect(isOwnWrite('A2', { text: 'A23', savedText: 'A2' })).toBe(true);
  });

  it('recognises the disk matching the live text', () => {
    expect(isOwnWrite('A23', { text: 'A23', savedText: 'A2' })).toBe(true);
  });

  it("treats any other text as someone else's change", () => {
    expect(isOwnWrite('B', { text: 'A23', savedText: 'A2' })).toBe(false);
  });
});
