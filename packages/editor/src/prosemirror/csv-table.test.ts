/**
 * @file csv-table.test.ts
 * @purpose Verifies CSV record splitting and grid detection (FR-8.24).
 * @inputs text fixtures.
 * @outputs vitest assertions.
 * @functions none.
 * @dataflow text -> parser -> grid.
 * @controlflow one describe per function.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { parseCsvRecords, parseCsvText } from './csv-table.js';

describe('parseCsvRecords', () => {
  it('splits fields and records', () => {
    expect(parseCsvRecords('a,b\n1,2\n', ',')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsvRecords('a,b\r\n1,2', ',')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsvRecords('a,b\r1,2', ',')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsvRecords('a,,c', ',')).toEqual([['a', '', 'c']]);
  });
  it('honours quotes: delimiters, doubled quotes and line breaks inside them', () => {
    expect(parseCsvRecords('"x, y","say ""hi"""\r\n', ',')).toEqual([['x, y', 'say "hi"']]);
    expect(parseCsvRecords('"two\nlines",b', ',')).toEqual([['two\nlines', 'b']]);
    expect(parseCsvRecords('  "padded",b', ',')).toEqual([['padded', 'b']]);
    expect(parseCsvRecords('say "hi",b', ',')).toEqual([['say "hi"', 'b']]);
  });
  it('refuses a quote left open', () => {
    expect(parseCsvRecords('"open', ',')).toBeNull();
  });
  it('splits on the delimiter it is given', () => {
    expect(parseCsvRecords('a;b,c', ';')).toEqual([['a', 'b,c']]);
  });
});

describe('parseCsvText', () => {
  it('reads a comma grid, trimming cells', () => {
    expect(parseCsvText('name, age\nAda , 36\n')).toEqual({ rows: [['name', 'age'], ['Ada', '36']], columns: 2 });
  });
  it('falls back to semicolons when commas do not make a grid', () => {
    expect(parseCsvText('a;b\n1,5;2\n')).toEqual({ rows: [['a', 'b'], ['1,5', '2']], columns: 2 });
  });
  it('turns a line break inside a cell into a space', () => {
    expect(parseCsvText('"two\nlines",b\nc,d')).toEqual({ rows: [['two lines', 'b'], ['c', 'd']], columns: 2 });
  });
  it('refuses prose, a single column, ragged rows, empty text and an open quote', () => {
    expect(parseCsvText('Hello, world.\nSecond line')).toBeNull();
    expect(parseCsvText('one\ntwo')).toBeNull();
    expect(parseCsvText('a,b\nc,d,e')).toBeNull();
    expect(parseCsvText('   ')).toBeNull();
    expect(parseCsvText('"a,b')).toBeNull();
  });
});