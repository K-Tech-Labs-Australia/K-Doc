/**
 * @file vault-query.ts
 * @purpose Pure search and tag query operations over vault index entries, supporting tag aggregation, hierarchical tag filtering, and multi-signal relevance search (FR-8.12, FR-14.6).
 * @inputs Readonly arrays of NoteIndexEntry records, tag filter strings, search query strings, and optional result limits.
 * @outputs Readonly arrays of TagCount aggregations, filtered NoteIndexEntry items, and scored NoteMatch search results.
 * @functions
 *   - tagCounts: Aggregates the number of distinct notes carrying each tag across the vault index.
 *   - notesTagged: Filters notes matching a tag or its hierarchical sub-tags, sorted by relative path.
 *   - searchNotes: Performs weighted relevance search across title, tags, path, and headings with context extraction.
 * @dataflow NoteIndexEntry array → tag aggregation (Map) / hierarchical tag matching / multi-signal search scoring (title, tag, path, headings) → sorted & sliced query results.
 * @controlflow Parse query parameters → validate/normalize inputs (empty query, limit bounds, tag markers) → evaluate note attributes against query criteria → rank and break ties → return formatted result sets.
 * @version 1
 * @date 2026-09-12
 */

import type { NoteIndexEntry } from './note-index.js';

/** A tag and how many notes carry it. */
export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

/** One note matching a query, with the best line to show for it. */
export interface NoteMatch {
  readonly note: NoteIndexEntry;
  /** How well it matched; higher is better. Only meaningful against other matches of the same query. */
  readonly score: number;
  /** The most specific thing that matched: the title, else a heading, else the path. */
  readonly context: string;
}

/** A title that is exactly the query is what the user meant; nothing else comes close. */
const TITLE_EXACT: number = 100;
/** Typing the first few letters of a title is how a person reaches for a note they know. */
const TITLE_PREFIX: number = 50;
/** The query somewhere in the title still names the note, just less directly. */
const TITLE_CONTAINS: number = 25;
/** A tag is a deliberate label, so matching one says more than matching a path. */
const TAG_CONTAINS: number = 15;
/** The path matches when the note lives in a folder the user named, which is a weak signal on its own. */
const PATH_CONTAINS: number = 10;
/** A heading match is real but common, so each one counts for little. */
const HEADING_CONTAINS: number = 5;
/**
 * The most heading hits one note can score with. Without a cap a long document full of the word
 * would outrank the note actually called it, which is the opposite of what the user asked for.
 */
const MAX_HEADING_HITS: number = 5;
/**
 * How many results come back by default. A list longer than a screen is a list nobody reads, and the
 * ranking has already put the best first.
 */
const MAX_RESULTS: number = 50;

/**
 * Aggregates tag frequencies across all indexed notes in the vault.
 *
 * Counts how many notes carry each tag — not how many times a tag appears.
 * A note that says #todo five times is still one note to visit.
 *
 * @purpose Counts the number of distinct notes associated with each tag across the vault.
 * @inputs notes - Readonly array of NoteIndexEntry records from the vault index.
 * @outputs readonly TagCount[] - Array of TagCount records sorted by count descending, then tag ascending.
 * @dataflow NoteIndexEntry array → scan note tags → Map frequency accumulation → materialize TagCount array → sort with stable tiebreak → TagCount array.
 * @controlflow Initialize frequency Map → iterate through notes → iterate through distinct note tags → increment tag count in Map → materialize entries into array → sort by count descending, breaking ties by tag ascending → return array.
 */
export function tagCounts(notes: readonly NoteIndexEntry[]): readonly TagCount[] {
  // Counts how many notes carry each tag — not how many times a tag appears.
  // A note that says #todo five times is still one note to visit.
  const counts = new Map<string, number>();

  // Iterate through all indexed notes to accumulate tag occurrence counts per note.
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    // Check if the note entry is defined under strict index access.
    if (note !== undefined) {
      // A note's tags are already distinct, so counting each note's tags once is enough
      // rather than de-duplicating again.
      for (let j = 0; j < note.tags.length; j++) {
        const tag = note.tags[j];
        // Check if the tag string is defined under strict index access.
        if (tag !== undefined) {
          const currentCount = counts.get(tag) ?? 0;
          counts.set(tag, currentCount + 1);
        } else {
          // Undefined tag entry: skip.
        }
      }
    } else {
      // Undefined note entry: skip.
    }
  }

  // Materialise the Map entries into a TagCount array.
  const result: TagCount[] = [];
  // Iterate through accumulated tag-count pairs to build the materialized TagCount list.
  for (const [tag, count] of counts) {
    result.push({ tag, count });
  }

  // Sort by count descending, then tag ascending so ties are stable between runs.
  result.sort((a: TagCount, b: TagCount): number => {
    // Compare tag counts to prioritize tags appearing on more notes.
    if (b.count !== a.count) {
      // Counts differ: place higher frequency tag first.
      return b.count - a.count;
    } else {
      // Tiebreak: tag counts are equal, so sort alphabetically by tag string ascending for stability.
      return a.tag.localeCompare(b.tag);
    }
  });

  return result;
}

/**
 * Retrieves all notes associated with a given tag or its hierarchical sub-tags.
 *
 * @purpose Filters vault notes by tag or nested tag hierarchy, returning matching notes sorted by relative path.
 * @inputs notes - Readonly array of NoteIndexEntry records from the vault index.
 * @inputs tag - Target tag query string (with or without leading '#').
 * @outputs readonly NoteIndexEntry[] - Readonly array of matching NoteIndexEntry records sorted by relative path ascending.
 * @dataflow notes + tag string → normalise tag (trim, strip '#', lower-case) → evaluate tag matching across notes → sort matches by relative path → NoteIndexEntry array.
 * @controlflow Trim tag → strip leading '#' → convert to lower-case → check if empty (return empty array if so) → iterate through notes → check note tags for exact match or prefix hierarchy → collect matching notes → sort by relative path ascending → return array.
 */
export function notesTagged(notes: readonly NoteIndexEntry[], tag: string): readonly NoteIndexEntry[] {
  // Normalise the argument: trim, drop a leading '#', lower-case.
  // A caller passing #todo and one passing todo mean the same thing.
  let normalized = tag.trim();

  // Check if the trimmed tag starts with a leading '#' character.
  if (normalized.startsWith('#')) {
    // Drop the leading '#' to canonicalize the tag identifier.
    normalized = normalized.slice(1);
  } else {
    // Tag does not carry a leading '#'; retain string unchanged.
  }

  normalized = normalized.toLowerCase();

  // Check if the normalised tag is empty.
  if (normalized.length === 0) {
    // An empty normalised tag cannot match any note: return an empty array.
    return [];
  } else {
    // Normalised tag is non-empty: proceed to scan notes for matches.
  }

  const prefix = normalized + '/';
  const matched: NoteIndexEntry[] = [];

  // Iterate over all notes in the vault to identify matching tags.
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    // Check if the note entry is defined under strict index access.
    if (note !== undefined) {
      let hasMatchingTag = false;
      // Iterate through note tags to check for exact match or hierarchical descendant.
      for (let j = 0; j < note.tags.length; j++) {
        const t = note.tags[j];
        // Check if tag matches exactly or starts with the tag prefix.
        // Nested tags are a hierarchy, and clicking work that did not show work/urgent would hide notes the user was looking for.
        if (t !== undefined && (t === normalized || t.startsWith(prefix))) {
          // Tag matches query criteria or is nested within the hierarchy.
          hasMatchingTag = true;
          break;
        } else {
          // Tag does not match criteria: proceed to inspect next tag.
        }
      }

      // Check if the note had at least one matching tag.
      if (hasMatchingTag) {
        // Matching note found: collect for result set.
        matched.push(note);
      } else {
        // Note has no matching tags: skip.
      }
    } else {
      // Undefined note entry: skip.
    }
  }

  // Order matching notes by relative path ascending for deterministic stability.
  matched.sort((a: NoteIndexEntry, b: NoteIndexEntry): number => {
    // Compare relative paths in ascending lexicographical order.
    return a.relative.localeCompare(b.relative);
  });

  return matched;
}

/**
 * Searches and ranks vault notes against a query string using weighted multi-signal relevance scoring.
 *
 * @purpose Scores notes based on title matches, tag containment, path containment, and heading matches, returning ranked results with context.
 * @inputs notes - Readonly array of NoteIndexEntry records from the vault index.
 * @inputs query - Plain text search query string.
 * @inputs limit - Optional maximum number of matching results to return (defaults to MAX_RESULTS).
 * @outputs readonly NoteMatch[] - Scored and ranked NoteMatch records sorted by score descending, then relative path ascending.
 * @dataflow notes + query + limit → guard limit <= 0 → normalise query string → score title, tags, path, headings per note → resolve context → filter positive scores → sort matches → slice to limit → NoteMatch array.
 * @controlflow Guard limit <= 0 → trim and lower-case query (return empty if empty) → iterate notes → evaluate exclusive title scoring chain → scan tags for containment → check path containment → count heading hits up to MAX_HEADING_HITS → filter score === 0 → determine context priority (title > heading > relative) → sort matches by score descending and relative ascending → slice to effective limit → return array.
 */
export function searchNotes(
  notes: readonly NoteIndexEntry[],
  query: string,
  limit?: number,
): readonly NoteMatch[] {
  // Guard a limit of 0 or less by returning an empty array.
  // Asking for no results is a request the function should honour rather than silently ignore.
  if (limit !== undefined && limit <= 0) {
    // Non-positive limit requested: return empty array immediately.
    return [];
  } else {
    // Positive limit or undefined: proceed with query search.
  }

  const q = query.trim().toLowerCase();

  // Check if the normalized query is empty after trimming.
  // An empty query matches everything, and showing every note is not a search result.
  if (q.length === 0) {
    // Empty search query: return empty array.
    return [];
  } else {
    // Non-empty query: proceed to score notes against the search query.
  }

  const matches: NoteMatch[] = [];

  // Iterate over all notes in the vault to score each against the search query.
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    // Check if the note entry is defined under strict index access.
    if (note !== undefined) {
      let score = 0;
      let titleMatched = false;

      const lowerTitle = note.title.toLowerCase();

      // Lower-cased title match weights are exclusive: an exact match already implies the other two,
      // and adding all three would score it three times.
      if (lowerTitle === q) {
        // Lower-cased title matches query exactly: award TITLE_EXACT.
        score += TITLE_EXACT;
        titleMatched = true;
      } else if (lowerTitle.startsWith(q)) {
        // Lower-cased title starts with query prefix: award TITLE_PREFIX.
        score += TITLE_PREFIX;
        titleMatched = true;
      } else if (lowerTitle.includes(q)) {
        // Lower-cased title contains query substring: award TITLE_CONTAINS.
        score += TITLE_CONTAINS;
        titleMatched = true;
      } else {
        // Title does not match query: award no title score.
      }

      // Check if any tag contains query (awarded once, not per tag).
      let tagMatched = false;
      // Iterate through note tags to test for query containment.
      for (let j = 0; j < note.tags.length; j++) {
        const tag = note.tags[j];
        // Check if tag is defined and contains query string.
        if (tag !== undefined && tag.includes(q)) {
          // Matching tag found: set match flag and stop inspecting further tags.
          tagMatched = true;
          break;
        } else {
          // Current tag does not contain query: check next tag.
        }
      }

      // Check if any tag on the note contained the query substring.
      if (tagMatched) {
        // Award TAG_CONTAINS weight once for the note.
        score += TAG_CONTAINS;
      } else {
        // No tag contained query: award no tag score.
      }

      const lowerRelative = note.relative.toLowerCase();

      // Check if lower-cased relative path contains the query substring.
      if (lowerRelative.includes(q)) {
        // Path contains query: award PATH_CONTAINS score.
        score += PATH_CONTAINS;
      } else {
        // Path does not contain query: award no path score.
      }

      let headingHits = 0;
      let firstMatchingHeading: string | null = null;

      // Iterate over note headings to evaluate heading text matches.
      for (let j = 0; j < note.headings.length; j++) {
        const heading = note.headings[j];
        // Check if heading entry is defined under strict index access.
        if (heading !== undefined) {
          const lowerHeadingText = heading.text.toLowerCase();
          // Check if heading text contains the query substring.
          if (lowerHeadingText.includes(q)) {
            // Check if this is the first matching heading encountered on this note.
            if (firstMatchingHeading === null) {
              // Record original heading text for context display.
              firstMatchingHeading = heading.text;
            } else {
              // Subsequent heading match: first matching heading already captured.
            }

            // Check if heading hit count is below maximum allowed heading hits.
            if (headingHits < MAX_HEADING_HITS) {
              // Increment heading hit count and award HEADING_CONTAINS score.
              headingHits++;
              score += HEADING_CONTAINS;
            } else {
              // Maximum heading hits reached: cap heading score contribution to avoid long document bias.
            }
          } else {
            // Heading does not contain query substring: continue scanning.
          }
        } else {
          // Undefined heading entry: skip.
        }
      }

      // Check if the note accumulated any positive score.
      // A note scoring 0 is not a match — skip it.
      if (score === 0) {
        // Score is zero: skip this note.
        continue;
      } else {
        // Score is positive: determine context and record note match.
      }

      let context: string;

      // Select context: the most specific thing that matched is the most useful thing to show.
      // Title takes precedence, followed by the text of the first heading that matched, falling back to relative path.
      if (titleMatched) {
        // Title matched: most specific and identifiable representation of the note.
        context = note.title;
      } else if (firstMatchingHeading !== null) {
        // Title did not match, but a heading did: show the text of the first matching heading.
        context = firstMatchingHeading;
      } else {
        // Neither title nor heading matched (tag or path match): fall back to the note's relative path.
        context = note.relative;
      }

      matches.push({
        note,
        score,
        context,
      });
    } else {
      // Undefined note entry: skip.
    }
  }

  // Sort matches by score descending, then relative ascending for stability.
  matches.sort((a: NoteMatch, b: NoteMatch): number => {
    // Compare scores to rank higher-scoring notes first.
    if (b.score !== a.score) {
      // Scores differ: sort descending by score.
      return b.score - a.score;
    } else {
      // Tiebreak: scores are equal, sort alphabetically by relative path ascending for stability.
      return a.note.relative.localeCompare(b.note.relative);
    }
  });

  // Slice to limit ?? MAX_RESULTS.
  const effectiveLimit = limit ?? MAX_RESULTS;

  return matches.slice(0, effectiveLimit);
}
