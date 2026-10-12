/**
 * @file document-language.test.ts
 * @purpose Vitest test suite for K-Doc's document language helpers (packages/core/src/proofing/document-language.ts).
 *   Verifies normaliseLanguageTag, dictionaryCandidates, primaryLanguage and detectLanguage: tag normalisation, candidate ordering, primary extraction and prose language detection.
 * @inputs Language tags in various cases and formats; prose samples in French, German, English and Spanish; degenerate inputs (empty strings, non-strings, repeated words).
 * @outputs Vitest assertions on normalised tags, candidate arrays, primary languages and detected language codes (or null).
 * @functions None.
 * @dataflow Tag/prose string -> normaliseLanguageTag / dictionaryCandidates / primaryLanguage / detectLanguage -> Vitest assertions.
 * @controlflow Run describe blocks for each helper; each it asserts exact output or null for degenerate input.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { detectLanguage, dictionaryCandidates, normaliseLanguageTag, primaryLanguage } from './document-language.js';

const FRENCH = "La ville de Paris est la capitale de la France. Elle est située sur la Seine, dans le nord du pays. C'est une ville qui attire des millions de visiteurs chaque année pour ses musées, ses monuments et sa cuisine. Les habitants sont fiers de leur histoire et de leur culture.";
const GERMAN = 'Berlin ist die Hauptstadt der Bundesrepublik Deutschland und mit rund 3,7 Millionen Einwohnern die bevölkerungsreichste Stadt des Landes. Die Stadt ist auch ein bedeutendes Zentrum der Politik, Kultur und Wissenschaft, und sie wird von vielen Menschen aus der ganzen Welt besucht.';
const ENGLISH = 'The city of London is the capital of the United Kingdom. It stands on the River Thames and has been a major settlement for nearly two thousand years. It is known for its museums and theatres, and it was the largest city in the world for much of the nineteenth century.';
const SPANISH = 'Madrid es la capital de España y la ciudad más poblada del país. Se encuentra en el centro de la península y es conocida por sus museos, como el Prado, y por su vida nocturna. La ciudad también tiene muchos parques y una gran oferta cultural para los visitantes.';

describe('normaliseLanguageTag', () => {
  // Guards a primary language on its own is accepted and lower-cased regardless of input case.
  it('accepts a primary language on its own, in any case', () => {
    expect(normaliseLanguageTag('fr')).toBe('fr');
    expect(normaliseLanguageTag('FR')).toBe('fr');
    expect(normaliseLanguageTag(' de ')).toBe('de');
  });

  // Guards a region is written in capitals and accepts both hyphen and underscore separators.
  it('writes a region in capitals and accepts an underscore', () => {
    expect(normaliseLanguageTag('en-gb')).toBe('en-GB');
    expect(normaliseLanguageTag('en_GB')).toBe('en-GB');
    expect(normaliseLanguageTag('pt-pt')).toBe('pt-PT');
  });

  // Guards a script subtag is written in title case regardless of input case.
  it('writes a script in title case', () => {
    expect(normaliseLanguageTag('sr-latn')).toBe('sr-Latn');
    expect(normaliseLanguageTag('SR-LATN')).toBe('sr-Latn');
  });

  // Guards a longer variant subtag is written entirely in lower case.
  it('writes a longer variant in lower case', () => {
    expect(normaliseLanguageTag('ca-VALENCIA')).toBe('ca-valencia');
  });

  // Guards non-string input returns null instead of throwing.
  it('refuses anything that is not a string', () => {
    expect(normaliseLanguageTag(undefined)).toBeNull();
    expect(normaliseLanguageTag(42)).toBeNull();
    expect(normaliseLanguageTag(['fr'])).toBeNull();
    expect(normaliseLanguageTag(null)).toBeNull();
  });

  // Guards tags that cannot be stored under a dictionary key are rejected with null.
  it('refuses tags a dictionary could not be stored under', () => {
    expect(normaliseLanguageTag('')).toBeNull();
    expect(normaliseLanguageTag('f')).toBeNull();
    expect(normaliseLanguageTag('french')).toBeNull();
    expect(normaliseLanguageTag('en-GB-oxendict')).toBeNull();
    expect(normaliseLanguageTag('en-')).toBeNull();
    expect(normaliseLanguageTag('../fr')).toBeNull();
    expect(normaliseLanguageTag('en-G')).toBeNull();
  });
});

describe('dictionaryCandidates', () => {
  // Guards the full tag is tried first, then the primary language.
  it('tries the full tag, then the primary language', () => {
    expect(dictionaryCandidates('fr-FR')).toEqual(['fr-FR', 'fr']);
  });

  // Guards a bare language yields itself once with no region fallback.
  it('tries a bare language once', () => {
    expect(dictionaryCandidates('fr')).toEqual(['fr']);
  });
});

describe('primaryLanguage', () => {
  // Guards the primary language is the substring before the first hyphen.
  it('is the part before the hyphen', () => {
    expect(primaryLanguage('en-GB')).toBe('en');
    expect(primaryLanguage('de')).toBe('de');
  });
});

describe('detectLanguage', () => {
  // Guards prose in each supported language is detected by its primary code.
  it('recognises prose in several languages', () => {
    expect(detectLanguage(FRENCH)).toBe('fr');
    expect(detectLanguage(GERMAN)).toBe('de');
    expect(detectLanguage(ENGLISH)).toBe('en');
    expect(detectLanguage(SPANISH)).toBe('es');
  });

  // Guards too little text yields no detection rather than a guess.
  it('says nothing about too little text', () => {
    expect(detectLanguage('Bonjour tout le monde, la ville est belle')).toBeNull();
  });

  // Guards repeated non-dictionary words yield no detection.
  it('says nothing about text with no common words', () => {
    expect(
      detectLanguage(Array.from({ length: 30 }, (_value, index) => `word${'x'.repeat(index % 5)}`).join(' '))
    ).toBeNull();
  });

  // Guards mixed prose from two languages is too close to call and yields null.
  it('says nothing when two languages are too close to call', () => {
    expect(detectLanguage(`${FRENCH} ${SPANISH}`)).toBeNull();
  });

  // Guards word counting is case-insensitive so upper-case prose still detects.
  it('counts words whatever their case', () => {
    expect(detectLanguage(FRENCH.toUpperCase())).toBe('fr');
  });
});
