/**
 * @file document-language.spec.ts
 * @purpose Covers resolving a document's language from its front matter, reader choice or text (FR-12.3) and naming that language for display.
 * @inputs Language inputs built by the local `inputs()` helper — front matter, chosen language, detection flag, body text and default language.
 * @outputs Assertions over the resolved language tag and source, and over the human-readable name of a tag.
 * @functions resolveDocumentLanguage - resolves a document's language from its inputs.
 *   - languageName - renders a language tag as a displayable name.
 * @dataflow inputs() -> resolveDocumentLanguage / languageName -> assertions.
 * @controlflow Two describe blocks; each it supplies fixtures and asserts on the result or name.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { languageName, resolveDocumentLanguage, type LanguageInputs } from '../src/spell/document-language.js';

const FRENCH = "La ville de Paris est la capitale de la France. Elle est située sur la Seine, dans le nord du pays. C'est une ville qui attire des millions de visiteurs chaque année pour ses musées, ses monuments et sa cuisine. Les habitants sont fiers de leur histoire et de leur culture.";
const ENGLISH = 'The city of London is the capital of the United Kingdom. It stands on the River Thames and has been a major settlement for nearly two thousand years. It is known for its museums and theatres, and it was the largest city in the world for much of the nineteenth century.';

function inputs(overrides: Partial<LanguageInputs>): LanguageInputs {
  return { frontMatter: null, chosen: null, detect: true, text: '', defaultLanguage: 'en-GB', ...overrides };
}

describe('resolveDocumentLanguage', () => {
  // Guards front matter's language takes precedence over a reader choice and detected text.
  it('takes the language the front matter names first', () => {
    expect(resolveDocumentLanguage(inputs({ frontMatter: { lang: 'fr_fr' }, chosen: 'de', text: ENGLISH }))).toEqual({ language: 'fr-FR', source: 'front-matter' });
  });

  // Guards both the language: and lang: keys in front matter are honoured.
  it('reads language: as well as lang:', () => {
    expect(resolveDocumentLanguage(inputs({ frontMatter: { language: 'de' } }))).toEqual({ language: 'de', source: 'front-matter' });
  });

  // Guards unusable front matter is skipped, falling through to the reader choice.
  it('passes over front matter that does not name a usable language', () => {
    expect(resolveDocumentLanguage(inputs({ frontMatter: { lang: 42 }, chosen: 'de' }))).toEqual({ language: 'de', source: 'chosen' });
  });

  // Guards the reader's choice wins over guessing from the text.
  it('takes the reader choice before a guess', () => {
    expect(resolveDocumentLanguage(inputs({ chosen: 'es', text: FRENCH }))).toEqual({ language: 'es', source: 'chosen' });
  });

  // Guards the text is analysed for its language when nothing else names it.
  it('guesses from the text when nothing names the language', () => {
    expect(resolveDocumentLanguage(inputs({ text: FRENCH }))).toEqual({ language: 'fr', source: 'detected' });
  });

  // Guards a detected language keeps the default region when they agree.
  it('keeps the default region when the guess agrees with it', () => {
    expect(resolveDocumentLanguage(inputs({ text: ENGLISH }))).toEqual({ language: 'en-GB', source: 'detected' });
  });

  // Guards detection reads prose and ignores fenced code blocks.
  it('guesses from prose, not from code in the Markdown', () => {
    expect(resolveDocumentLanguage(inputs({ text: '```\n' + FRENCH + '\n```\n' }))).toEqual({ language: 'en-GB', source: 'default' });
  });

  // Guards detection is skipped when it is turned off.
  it('does not guess when guessing is off', () => {
    expect(resolveDocumentLanguage(inputs({ text: FRENCH, detect: false }))).toEqual({ language: 'en-GB', source: 'default' });
  });

  // Guards the default is used when the text gives no signal.
  it('uses the default when the text cannot be told', () => {
    expect(resolveDocumentLanguage(inputs({ text: 'Hello.' }))).toEqual({ language: 'en-GB', source: 'default' });
  });
});

describe('languageName', () => {
  // Guards a language tag is named, with region distinguishing variants.
  it('names a language and its region', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('en-GB')).toBe('British English');
  });

  // Guards an unreadable tag is returned unchanged.
  it('shows a tag the platform cannot read as written', () => {
    expect(languageName('not a tag!')).toBe('not a tag!');
  });
});
