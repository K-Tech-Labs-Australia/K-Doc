/**
 * @file vault-links.ts
 * @purpose Resolves note link targets and discovers incoming backlinks across vault notes for the backlinks panel (FR-6.13, FR-14.7).
 * @inputs NoteIndexEntry arrays, target NoteIndexEntry records, NoteLink references, and raw target strings.
 * @outputs Backlink records associating referring notes and links, target matching booleans, and normalised target strings.
 * @functions
 *   - withoutExtension: Strips trailing Markdown file extensions (.md, .markdown, .mdown) case-insensitively.
 *   - normaliseTarget: Normalises a link target by trimming, stripping anchors and './', converting backslashes, lower-casing, and dropping extensions.
 *   - targetsNote: Determines whether a link reference identifies a given note by relative path, file name, or title.
 *   - backlinksTo: Discovers and sorts all incoming backlinks pointing to a target note from an indexed note collection.
 *   - brokenLinks: Finds vault-internal links that resolve to no note in the vault (FR-14.7).
 * @dataflow NoteLink targets / NoteIndexEntry records → normaliseTarget & targetsNote → backlinksTo matching → sorted Backlink array.
 * @controlflow normaliseTarget strips anchor/prefix/extension → targetsNote matches against relative path, file name, or title → backlinksTo iterates notes and links skipping self-links → sorts by relative path then offset.
 * @version 2
 * @date 2026-09-12
 */

import type { NoteIndexEntry, NoteLink } from './note-index.js';

/** A note that referred to another, and the line it did it on. */
export interface Backlink {
  /** The note the reference came from. */
  readonly from: NoteIndexEntry;
  readonly link: NoteLink;
}

/**
 * Strips a trailing Markdown file extension (.md, .markdown, or .mdown) case-insensitively.
 *
 * @purpose Removes Markdown file extensions from a file name or path so links with and without extensions match.
 * @inputs name - File name or path string potentially ending with a Markdown file extension.
 * @outputs string - The string with any trailing Markdown extension stripped.
 * @dataflow name string → regex replace of trailing extension → extensionless string.
 * @controlflow Perform case-insensitive regex substitution on trailing extension → return result string.
 */
export function withoutExtension(name: string): string {
  // [[setup]] and [setup](setup.md) have to reach the same note.
  return name.replace(/\.(?:md|markdown|mdown)$/i, '');
}

/**
 * Reduces a link target string to a canonical form for matching against vault notes.
 *
 * @purpose Normalises a link target by stripping anchors, relative prefixes, slashes, case, and extensions.
 * @inputs target - Raw link target string from an inline Markdown link or wikilink.
 * @outputs string - Normalised target string suitable for note identification, or empty string if empty or anchor-only.
 * @dataflow target string → trim → strip anchor → strip './' → replace '\' with '/' → lower-case → withoutExtension → normalised string.
 * @controlflow Trim input → check and drop anchor fragment → check and strip './' prefix → convert backslashes → lower-case → strip extension → return empty string if result is empty or the normalised string.
 */
export function normaliseTarget(target: string): string {
  // 1. Trim leading and trailing whitespace from the target string.
  let result = target.trim();

  // 2. Drop everything from the first '#'.
  // An anchor names a heading inside a note, not a different note.
  const hashIndex = result.indexOf('#');
  // Check if target contains an anchor fragment '#'.
  if (hashIndex !== -1) {
    // Anchor found: drop everything from the first '#' to isolate the note specifier.
    result = result.slice(0, hashIndex);
  } else {
    // No anchor fragment present: retain the full target string.
  }

  // 3. Drop a leading './'.
  // Check if target begins with a current-directory relative prefix.
  if (result.startsWith('./')) {
    // Strip the leading './' prefix.
    result = result.slice(2);
  } else {
    // Target does not start with './': leave prefix unchanged.
  }

  // 4. Replace every '\' with '/'.
  result = result.replace(/\\/g, '/');

  // 5. Lower-case.
  // File names differ in case between platforms, and a link written Notes/Setup.md must still find notes/setup.md.
  result = result.toLowerCase();

  // 6. Strip Markdown extension.
  result = withoutExtension(result);

  // Return '' when the result is empty — an empty or anchor-only target.
  // Check if the normalised result is empty.
  if (result.length === 0) {
    // Empty or anchor-only target: return empty string.
    return '';
  } else {
    // Non-empty target: return normalised string.
    return result;
  }
}

/**
 * Tests whether a link reference identifies a specific vault note.
 *
 * @purpose Determines if a given NoteLink points to the specified NoteIndexEntry by path, file name, or title.
 * @inputs link - The NoteLink reference being tested.
 * @inputs note - The candidate NoteIndexEntry to test against.
 * @outputs boolean - True if the link targets the note; false otherwise.
 * @dataflow link.target → normaliseTarget → compare with note relative path, file name, and title → boolean match result.
 * @controlflow Normalise link target → return false if empty → compare against relative path without extension → compare against file name alone → compare against note title → return true on any match, else false.
 */
export function targetsNote(link: NoteLink, note: NoteIndexEntry): boolean {
  const target = normaliseTarget(link.target);

  // Return false immediately when the normalised target is empty.
  // An anchor-only link like [top](#intro) points inside its own note, and treating it as a link to every note would fill the backlinks panel with noise.
  if (target.length === 0) {
    // Normalised target is empty: link does not identify any external note.
    return false;
  } else {
    // Non-empty target: compare against candidate note identifiers.
  }

  // 1. The note's relative path put through withoutExtension — a link can name a note by its full path.
  let cleanRelative = note.relative.replace(/\\/g, '/');
  // Check if the relative path has a leading './' prefix.
  if (cleanRelative.startsWith('./')) {
    // Strip leading './' prefix.
    cleanRelative = cleanRelative.slice(2);
  } else {
    // No leading './' prefix present: keep path as-is.
  }
  const relativeNoExt = withoutExtension(cleanRelative).toLowerCase();

  // Check if target equals the note's relative path without extension.
  // A link can name a note by its full path.
  if (target === relativeNoExt) {
    // Target matches the full relative path without extension: link points to this note.
    return true;
  } else {
    // Target does not match full relative path: check file name alone.
  }

  // 2. The part of that after the last '/' — the file name alone, which is how a wikilink usually does it.
  const lastSlashIndex = relativeNoExt.lastIndexOf('/');
  let fileName = relativeNoExt;
  // Check if the relative path contains directory slash separators.
  if (lastSlashIndex !== -1) {
    // Directory separators present: extract the file name substring after the final slash.
    fileName = relativeNoExt.slice(lastSlashIndex + 1);
  } else {
    // No slash present: relative path without extension is already the file name alone.
  }

  // Check if target equals the file name alone after the last slash.
  // The file name alone, which is how a wikilink usually does it.
  if (target === fileName) {
    // Target matches the file name alone: link points to this note.
    return true;
  } else {
    // Target does not match file name: check note title.
  }

  // 3. The note's title — a link can name a note by what it is called.
  const title = note.title.toLowerCase();

  // Check if target equals the note's title.
  // A link can name a note by what it is called.
  if (target === title) {
    // Target matches the note's display title: link points to this note.
    return true;
  } else {
    // Target does not match the note's display title.
  }

  // Target does not identify the note by full path, file name, or title.
  return false;
}

/**
 * Discovers and sorts all incoming backlinks pointing to a target note from an indexed note collection.
 *
 * @purpose Walks indexed notes to find all references targeting a note, excluding self-links and sorting deterministically.
 * @inputs notes - Readonly array of all NoteIndexEntry records in the vault.
 * @inputs note - The destination NoteIndexEntry being linked to.
 * @outputs readonly Backlink[] - Readonly array of Backlink records sorted by source note relative path and link offset.
 * @dataflow notes collection → filter distinct source notes by path → inspect links via targetsNote → assemble Backlink records → sort by relative path then offset → readonly Backlink array.
 * @controlflow Iterate notes array → skip source note if path matches target note (self-link) → iterate source note links → test targetsNote → push Backlink if matched → sort results by source relative path ascending then link offset ascending → return results.
 */
export function backlinksTo(
  notes: readonly NoteIndexEntry[],
  note: NoteIndexEntry,
): readonly Backlink[] {
  const backlinks: Backlink[] = [];

  // Walk every note in the collection to inspect its links.
  for (let i = 0; i < notes.length; i++) {
    const sourceNote = notes[i];
    // Check if source note is defined under strict index access.
    if (sourceNote === undefined) {
      // Undefined entry: skip iteration.
      continue;
    } else {
      // Defined entry: proceed with identity check.
    }

    // Compare identity by path, not by object reference: two index entries for the same file should still count as the same note.
    // Skip self-links: a note that links to itself is not a backlink, and showing one would be a puzzle rather than information.
    if (sourceNote.path === note.path) {
      // Source note is the target note itself: skip self-links.
      continue;
    } else {
      // Source note is distinct from target note: inspect outgoing links.
    }

    // Walk all links recorded in the source note.
    for (let j = 0; j < sourceNote.links.length; j++) {
      const link = sourceNote.links[j];
      // Check if link is defined under strict index access.
      if (link === undefined) {
        // Undefined link entry: skip iteration.
        continue;
      } else {
        // Defined link entry: evaluate target match.
      }

      // Check if the current link targets the destination note.
      if (targetsNote(link, note)) {
        // Link targets the note: push a new Backlink record.
        backlinks.push({
          from: sourceNote,
          link,
        });
      } else {
        // Link does not target this note: skip.
      }
    }
  }

  // Sort the result by the source note's relative ascending, then link.offset ascending, so the panel reads the same way twice running.
  backlinks.sort((a: Backlink, b: Backlink): number => {
    // Check if the source notes have different relative paths.
    if (a.from.relative < b.from.relative) {
      // First source note relative path precedes second: sort earlier.
      return -1;
    } else if (a.from.relative > b.from.relative) {
      // First source note relative path follows second: sort later.
      return 1;
    } else {
      // Relative paths are identical: break tie by ascending link offset.
    }

    // Check link offset ordering within the same source note.
    if (a.link.offset < b.link.offset) {
      // First link appears earlier in source text: sort earlier.
      return -1;
    } else if (a.link.offset > b.link.offset) {
      // First link appears later in source text: sort later.
      return 1;
    } else {
      // Offsets are identical: maintain stable order.
      return 0;
    }
  });

  return backlinks;
}

/**
 * A link in a note that resolves to nothing in the vault.
 */
export interface BrokenLink {
  readonly link: NoteLink;
  /** Why it does not resolve, in a few words, ready to show to a reader. */
  readonly reason: string;
}

/**
 * Finds the links in one note that point at no note in the vault.
 *
 * @purpose Reports the vault-internal links that resolve to nothing, so a Problems surface can list them (FR-14.7).
 * @inputs links - The note's links, as the index extracted them. notes - Every note in the vault.
 * @outputs readonly BrokenLink[] - The links that resolve to nothing, in the order given.
 * @dataflow links -> drop external and empty targets -> match each against notes with targetsNote -> unmatched links.
 * @controlflow For each link: skip when external or empty, else search notes for a match, else record it as broken.
 */
export function brokenLinks(
  links: readonly NoteLink[],
  notes: readonly NoteIndexEntry[],
): readonly BrokenLink[] {
  const broken: BrokenLink[] = [];

  // An EMPTY notes array resolves nothing at all, so every internal link below is reported as broken.
  // That is correct rather than unfortunate: a vault with no notes genuinely has no targets, but it
  // means this must not be run before the scan finishes or the panel would accuse every link while the
  // vault is still being read.
  for (const link of links) {
    const target = link.target;

    // Rule 1: skip anything that names a place outside the vault: a URI with a scheme, or a protocol-relative URL.
    // This file has no way to check those and no business guessing about them; a 404 is a network problem, not a string one.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
      // External reference: skip, it is out of scope for vault-internal broken-link reporting.
      continue;
    } else {
      // Internal-looking target: keep evaluating.
    }

    // Rule 2: skip an empty or whitespace-only target - that is a malformed link, not an unresolved one.
    if (target.trim().length === 0) {
      // Empty or whitespace-only target: malformed rather than broken, so leave it to the malformed-link surface.
      continue;
    } else {
      // Non-empty target: keep evaluating.
    }

    // Rule 3: strip any '#fragment' and '?query' before matching - [[Setup#Install]] names the note Setup.
    // Take the substring up to whichever of '#' or '?' comes first.
    const hashIndex = target.indexOf('#');
    const queryIndex = target.indexOf('?');

    // Determine the earliest boundary, ignoring any that are absent (-1).
    let cutIndex = -1;
    if (hashIndex !== -1 && (queryIndex === -1 || hashIndex < queryIndex)) {
      // '#' appears before '?': cut at the fragment.
      cutIndex = hashIndex;
    } else if (queryIndex !== -1) {
      // '?' is present and not preceded by '#': cut at the query.
      cutIndex = queryIndex;
    } else {
      // Neither '#' nor '?' is present: keep the whole target.
    }
    const stripped = cutIndex === -1 ? target : target.slice(0, cutIndex);

    // Rule 4: an empty remainder names no note. This is also what handles a pure fragment such as
    // '#install', which names a heading in this same note: its cut index is zero, so it strips to
    // nothing and lands here. A separate guard for it was removed after a mutation showed that
    // deleting it changed no answer -- it could not be reached with the stripping already in place.
    if (stripped.length === 0) {
      // Nothing left to match: skip rather than report a note that was never named.
      continue;
    } else {
      // Non-empty stripped target: test it against the vault notes.
    }

    // Reuse targetsNote for matching without reimplementing it - build a synthetic link carrying only the stripped target, since targetsNote takes a NoteLink as its first argument.
    const syntheticLink: NoteLink = {
      kind: 'wiki',
      target: stripped,
      context: '',
      offset: link.offset,
    };

    // The link resolves when at least one note entry matches; .some() avoids index access under noUncheckedIndexedAccess.
    if (notes.some((entry) => targetsNote(syntheticLink, entry))) {
      // At least one note matched: the link resolves and is not reported as broken.
    } else {
      // No note matched: record it as broken with a reader-facing reason built from the stripped target.
      broken.push({
        link,
        reason: `No note matches ${stripped}`,
      });
    }
  }

  return broken;
}
