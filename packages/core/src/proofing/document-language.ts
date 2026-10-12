/**
 * @file document-language.ts
 * @purpose Language handling for proofing dictionaries: validates and normalises language tags, derives the dictionary names to try for a tag, and detects which language a block of prose is written in from a small set of common words.
 * @inputs A language tag string (for normalisation and candidate derivation) and raw prose text (for detection).
 * @outputs Normalised language tags or null; an ordered list of dictionary candidates; the primary language code for a tag; the detected primary language code for prose, or null when it cannot be told.
 * @functions
 *   - LANGUAGE_TAG_PATTERN: Regex validating a normalised language tag (module constant).
 *   - MIN_DETECTION_WORDS: Minimum word count below which detection gives up (module constant).
 *   - MIN_DETECTION_SHARE: Minimum share of common words the winner must reach (module constant).
 *   - DETECTION_MARGIN: Minimum score ratio over the runner-up for a win (module constant).
 *   - normaliseLanguageTag: Validates and canonicalises an arbitrary tag value.
 *   - dictionaryCandidates: Returns the full tag then its primary language as dictionary names to try.
 *   - primaryLanguage: Extracts the primary (pre-hyphen) language code from a tag.
 *   - LANGUAGE_MARKERS: Per-language lists of common distinguishing words (module constant).
 *   - MARKER_SETS: Pre-built marker sets paired with their language codes (module-private).
 *   - detectLanguage: Scores prose against each language's markers and returns the winning primary code, or null.
 * @dataflow External tag/prose input -> normalise/detect logic -> validated tag or detected language code output.
 * @controlflow Validate inputs early with guard clauses; branch on tag structure to canonicalise; score words against marker sets and apply share/margin thresholds before returning a decision.
 * @version 1
 * @date 2026-09-18
 */

/** A tag a dictionary can be stored under: 2-3 lowercase letters, then optionally a hyphen and 2-8 letters or digits. Mirrors is_valid_language_tag in src-tauri/src/spell_cache.rs. */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Fewer words than this is too little text to tell languages apart. */
export const MIN_DETECTION_WORDS = 20;

/** The winning language's common words must make up at least this share of all words. */
export const MIN_DETECTION_SHARE = 0.15;

/** The winner must score at least this many times the runner-up. */
export const DETECTION_MARGIN = 1.5;

/**
 * Validates and canonicalises an arbitrary language tag value into a normalised tag, or null when it cannot be parsed.
 *
 * @purpose Normalises case, underscores, and hyphenated parts so that tags like "en_gb", "EN-gb", or "sr_LATN" collapse to their canonical form (e.g. "en-GB", "sr-Latn"); rejects anything outside LANGUAGE_TAG_PATTERN.
 * @inputs value - The raw tag to normalise; must be a string, otherwise null is returned.
 * @outputs string | null - The canonical language tag when valid, or null when the input is not a string or fails validation.
 * @dataflow Raw string -> trimmed and underscore-to-hyphen replaced -> split on hyphens -> primary and optional sub-part classified by length -> reassembled into a canonical tag -> validated against LANGUAGE_TAG_PATTERN.
 * @controlflow Return null for non-string input; return null when more than two parts are present; branch on the sub-part shape (region/script/variant) to build the canonical tag; return it only if it passes the pattern test, else null.
 */
export function normaliseLanguageTag(value: unknown): string | null {
  if (typeof value !== 'string') {
    // Branch: Input is not a string; there is nothing to normalise.
    return null;
  } else {
    // Branch: Input is a string; proceed to split and classify it below.
  }

  const parts = value.trim().replace(/_/g, '-').split('-');

  if (parts.length > 2) {
    // Branch: More than two hyphenated parts; this is not a valid tag structure.
    return null;
  } else {
    // Branch: At most two parts; continue to classify the primary and optional sub-part.
  }

  const primary = (parts[0] ?? '').toLowerCase();
  const sub = parts[1];

  let tag: string;

  if (sub === undefined) {
    // Branch: No sub-part present; the tag is just the lowercased primary language code.
    tag = primary;
  } else if (/^[A-Za-z]{2}$/.test(sub)) {
    // Branch: Sub-part is two letters; treat it as a region code and upper-case it (e.g. en-GB).
    tag = `${primary}-${sub.toUpperCase()}`;
  } else if (/^[A-Za-z]{4}$/.test(sub)) {
    // Branch: Sub-part is four letters; treat it as a script code, title-casing the first letter (e.g. sr-Latn).
    tag = `${primary}-${sub.charAt(0).toUpperCase()}${sub.slice(1).toLowerCase()}`;
  } else {
    // Branch: Any other sub-part is treated as a variant and lower-cased (e.g. ca-valencia).
    tag = `${primary}-${sub.toLowerCase()}`;
  }

  if (LANGUAGE_TAG_PATTERN.test(tag)) {
    // Branch: Reassembled tag matches the canonical pattern; accept it.
    return tag;
  } else {
    // Branch: Tag failed validation; reject with null.
    return null;
  }
}

/** Dictionaries are published under the full tag for some languages (en-GB) and the primary language for others (fr), so both are tried, full tag first. */
export function dictionaryCandidates(tag: string): string[] {
  const primary = tag.split('-')[0] ?? tag;

  if (primary === tag) {
    // Branch: No sub-part exists; only the full-tag dictionary name is available.
    return [tag];
  } else {
    // Branch: A sub-part exists; offer the full tag first, then the primary-language dictionary.
    return [tag, primary];
  }
}

/**
 * Extracts the primary (pre-hyphen) language code from a normalised tag.
 *
 * @purpose Returns just the base language portion of a tag so callers can look up primary-language dictionaries regardless of any region/script/variant sub-part.
 * @inputs tag - A normalised language tag.
 * @outputs string - The substring before the first hyphen, or the whole tag when it contains no hyphen.
 * @dataflow Tag -> split on hyphen -> take the first element (falling back to the full tag).
 * @controlflow Split once and return the leading segment; the ?? fallback covers a missing index though splitting always yields at least one element.
 */
export function primaryLanguage(tag: string): string {
  return tag.split('-')[0] ?? tag;
}

/** Common words that tell languages apart. Detection counts how many of a text's words each list contains. */
export const LANGUAGE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'it', 'was', 'for', 'with', 'as', 'on', 'are', 'this', 'be', 'by', 'not', 'have', 'from', 'which', 'you', 'they', 'his', 'at', 'or', 'but', 'an', 'were', 'had', 'will'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'une', 'du', 'dans', 'que', 'qui', 'pour', 'pas', 'sur', 'au', 'avec', 'il', 'elle', 'sont', 'ce', 'cette', 'mais', 'ou', 'nous', 'vous', 'aux', 'par', 'plus', 'été', 'être'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ein', 'eine', 'zu', 'den', 'mit', 'sich', 'des', 'auf', 'für', 'im', 'dem', 'auch', 'es', 'wird', 'sind', 'von', 'bei', 'aus', 'oder', 'wie', 'nach', 'werden', 'hat', 'einen'],
  es: ['el', 'los', 'las', 'y', 'del', 'se', 'por', 'con', 'una', 'para', 'lo', 'como', 'más', 'pero', 'sus', 'su', 'al', 'este', 'está', 'son', 'fue', 'muy', 'también', 'entre', 'ha', 'hay', 'sin', 'sobre', 'esta', 'porque'],
  it: ['di', 'che', 'il', 'non', 'sono', 'della', 'nel', 'gli', 'dei', 'anche', 'alla', 'questo', 'più', 'delle', 'degli', 'essere', 'ma', 'si', 'è', 'per', 'una', 'con', 'come', 'ha', 'lo', 'sul', 'nella', 'questa', 'molto', 'perché'],
  pt: ['os', 'do', 'da', 'dos', 'das', 'em', 'um', 'com', 'não', 'na', 'no', 'ao', 'foi', 'são', 'também', 'pelo', 'pela', 'seu', 'sua', 'mais', 'uma', 'para', 'que', 'se', 'por', 'é', 'mas', 'como', 'ser', 'ou'],
  nl: ['het', 'een', 'van', 'dat', 'op', 'te', 'zijn', 'voor', 'niet', 'aan', 'er', 'ook', 'maar', 'bij', 'door', 'om', 'nog', 'wordt', 'hij', 'deze', 'naar', 'dan', 'worden', 'wel', 'de', 'en', 'is', 'met', 'als', 'geen'],
  sv: ['och', 'att', 'det', 'som', 'är', 'på', 'av', 'för', 'med', 'den', 'till', 'inte', 'har', 'ett', 'om', 'var', 'jag', 'men', 'så', 'eller', 'från', 'vid', 'kan', 'sig', 'också', 'när', 'hade', 'efter', 'de', 'en'],
  da: ['og', 'at', 'det', 'er', 'til', 'af', 'som', 'på', 'med', 'han', 'for', 'ikke', 'der', 'var', 'jeg', 'har', 'sig', 'den', 'men', 'et', 'fra', 'kan', 'blev', 'også', 'efter', 'når', 'havde', 'hun', 'de', 'en'],
  nb: ['og', 'det', 'er', 'til', 'av', 'som', 'på', 'med', 'han', 'for', 'ikke', 'den', 'var', 'jeg', 'har', 'seg', 'men', 'et', 'fra', 'kan', 'ble', 'også', 'etter', 'når', 'hadde', 'å', 'hun', 'de', 'en', 'om'],
  pl: ['i', 'w', 'na', 'z', 'się', 'że', 'do', 'nie', 'to', 'jest', 'o', 'jak', 'ale', 'po', 'co', 'tak', 'za', 'od', 'są', 'przez', 'jego', 'ich', 'tym', 'być', 'oraz', 'który', 'która', 'było', 'dla', 'już'],
  fi: ['ja', 'on', 'ei', 'se', 'että', 'oli', 'hän', 'mutta', 'kun', 'niin', 'myös', 'tai', 'joka', 'ovat', 'sen', 'jos', 'voi', 'ole', 'vain', 'kuin', 'olla', 'mitä', 'siitä', 'tämä', 'nyt', 'jo', 'ne', 'sekä', 'eli', 'jossa'],
};

/** Pre-built marker sets paired with their language codes, so detection can score prose without rebuilding sets on every call. */
const MARKER_SETS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = Object.entries(LANGUAGE_MARKERS).map(([code, words]) => [code, new Set(words)] as const);

/**
 * Detects the primary language code (e.g. "fr") that a block of prose is most likely written in, or null when it cannot be told.
 *
 * @purpose Scores the prose's words against each supported language's list of common distinguishing words and returns the winner only when it reaches a minimum share of all words and beats the runner-up by a required margin; otherwise reports uncertainty with null.
 * @inputs prose - The text to classify. Callers must pass plain prose, not Markdown source, because code spans and link addresses are not words in any language.
 * @outputs string | null - The winning primary language code when detection is confident, or null when there is too little text or the winner is not clearly ahead.
 * @dataflow Prose -> lower-cased word extraction -> per-language marker counts -> best and second-best scores tracked -> share and margin thresholds applied -> winner returned or null.
 * @controlflow Extract words; return null when fewer than MIN_DETECTION_WORDS; iterate each language updating best/second-best scores; return null when the winner's score is below the required share or not ahead of the runner-up by DETECTION_MARGIN, else return the winning code.
 */
export function detectLanguage(prose: string): string | null {
  const words = prose.toLowerCase().match(/\p{L}+/gu) ?? [];

  if (words.length < MIN_DETECTION_WORDS) {
    // Branch: Too little text to reliably distinguish languages; give up.
    return null;
  } else {
    // Branch: Enough words present; score against each language below.
  }

  let best = '';
  let bestScore = 0;
  let secondScore = 0;

  for (const [code, markers] of MARKER_SETS) {
    let score = 0;

    for (const word of words) {
      if (markers.has(word)) {
        // Branch: Word is a marker for this language; count it.
        score += 1;
      } else {
        // Branch: Word is not in this language's marker set; leave the score unchanged.
      }
    }

    if (score > bestScore) {
      // Branch: This language overtakes the current leader; demote the old leader to second place.
      secondScore = bestScore;
      bestScore = score;
      best = code;
    } else if (score > secondScore) {
      // Branch: Not the new leader, but it beats the current runner-up; promote it to second place.
      secondScore = score;
    } else {
      // Branch: Score does not change the top two positions; leave best and second unchanged.
    }
  }

  if (bestScore < words.length * MIN_DETECTION_SHARE) {
    // Branch: The winner's markers are too sparse relative to total words (also covers a zero score); report uncertainty.
    return null;
  } else {
    // Branch: Winner reaches the minimum share of common words; apply the margin check below.
  }

  if (bestScore < secondScore * DETECTION_MARGIN) {
    // Branch: The winner is not sufficiently ahead of the runner-up; the languages are too close to call.
    return null;
  } else {
    // Branch: Winner beats the runner-up by the required margin; accept this detection.
    return best;
  }
}
