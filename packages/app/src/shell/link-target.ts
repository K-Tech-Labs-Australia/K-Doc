/**
 * @file link-target.ts
 * @purpose Pure functions deciding what a link in a document points at (FR-8.13), supporting hover cards and follow navigation.
 *   Classifies links into heading, vault note, web, email, blocked, or unresolved targets without DOM or IPC dependencies.
 *   Resolves relative and absolute file paths against active document context and open vault note indexes.
 * @inputs Link target href strings, LinkContext containing active document path and vault note entries, OutlineEntry arrays, and slug strings.
 * @outputs Classified LinkTarget records, OutlineEntry heading matches, and GitHub-compatible heading slug strings.
 * @functions
 *   - headingSlug: Converts heading text into a GitHub-compatible anchor slug identifier for in-document fragment links.
 *   - findHeadingBySlug: Searches an outline entry collection in document order for the first heading matching a disambiguated slug.
 *   - classifyLink: Determines destination target type and metadata for an arbitrary link reference under document and vault context.
 * @dataflow href / context -> scheme / prefix / path parsing -> URL / mail / heading / vault note resolution -> LinkTarget classification.
 * @controlflow classifyLink inspects empty, anchor, protocol-relative, scheme, and path cases -> resolves notes via path matching and targetsNote -> returns typed LinkTarget.
 * @version 3
 * @date 2026-09-18
 */

import { headingAnchors, targetsNote, withoutExtension } from '@k-doc/core';
import type { NoteIndexEntry, OutlineEntry } from '@k-doc/core';

export type LinkTarget =
  | { readonly kind: 'heading'; readonly slug: string }
  | { readonly kind: 'note'; readonly path: string; readonly slug: string | null; readonly label: string }
  | { readonly kind: 'web'; readonly url: string; readonly domain: string }
  | { readonly kind: 'mail'; readonly url: string; readonly address: string }
  | { readonly kind: 'unresolved'; readonly target: string; readonly reason: string }
  | { readonly kind: 'blocked'; readonly target: string; readonly scheme: string };

export interface LinkContext {
  /** The open document's path on disk, or null when it has never been saved. */
  readonly documentPath: string | null;
  /** Every note in the open vault; empty when no vault is open. */
  readonly notes: readonly NoteIndexEntry[];
}

/**
 * Converts heading text into a GitHub-compatible anchor slug identifier for in-document fragment links.
 *
 * @purpose Sanitizes heading text into an anchor slug matching GitHub and CommonMark renderer conventions.
 * @inputs text - The raw heading text string to convert.
 * @outputs string - Sanitized anchor slug string with punctuation dropped, whitespace hyphenated, and trimmed outer hyphens.
 * @dataflow text -> toLowerCase() -> trim() -> drop punctuation -> hyphenate whitespace -> strip outer hyphens -> slug.
 * @controlflow Trim and lowercase input -> strip all non-letter/digit/space/hyphen/underscore characters -> replace whitespace runs with hyphen -> strip outer hyphens -> return slug.
 */
export { headingSlug } from '@k-doc/core';

/**
 * Searches an outline entry collection in document order for the first heading matching a disambiguated slug.
 *
 * @purpose Disambiguates duplicate heading slugs using GitHub-style counter suffixes and finds the matching entry.
 * @inputs entries - Readonly array of OutlineEntry objects representing document headings in preorder.
 * @inputs slug - The target heading anchor slug to search for.
 * @outputs OutlineEntry | null - The first matching OutlineEntry, or null if no heading matches.
 * @dataflow entries -> generate disambiguated anchor per entry -> case-insensitive equality check against slug -> matched OutlineEntry or null.
 * @controlflow Lowercase target slug -> iterate entries tracking slug occurrence counts -> compare generated anchor -> return matching entry immediately or null if exhausted.
 */
export function findHeadingBySlug(
  entries: readonly OutlineEntry[],
  slug: string,
): OutlineEntry | null {
  // GitHub gives the second heading with the same text -1, the third -2, so a document with two "Notes" headings has anchors
  // notes and notes-1. headingAnchors is shared with the table of contents (FR-8.30), so a generated link and a followed
  // link can never disagree about which heading an anchor names.
  const index = headingAnchors(entries.map((entry) => entry.text)).indexOf(slug.toLowerCase());
  // No heading with that anchor gives index -1, which reads as no entry.
  return entries[index] ?? null;
}

/**
 * Safely decodes a URI-encoded component string, returning the input unchanged on failure.
 *
 * @purpose Decodes percent-encoded character sequences while tolerating literal percent signs and malformed escapes.
 * @inputs value - The string to decode.
 * @outputs string - Decoded string if successful, or the original value string if decoding throws.
 * @dataflow value string -> decodeURIComponent() -> decoded string (or raw value on error).
 * @controlflow Execute decodeURIComponent in try block -> return decoded string -> catch error and return original value unchanged.
 */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A literal '%' in a file name is not an error; return the input unchanged when decoding throws.
    return value;
  }
}

/**
 * Normalises a file system path for case-insensitive cross-platform path comparisons.
 *
 * @purpose Converts backslashes to forward slashes, collapses redundant slashes, lowercases characters, and strips trailing slashes.
 * @inputs path - The file system path string to normalise.
 * @outputs string - Canonical normalised path string.
 * @dataflow path string -> replace backslashes -> collapse slashes -> toLowerCase() -> strip trailing slash -> normalised path.
 * @controlflow Convert '\' to '/' -> collapse multiple '/' into single '/' -> lowercase string -> if trailing '/' exists strip it -> return normalised string.
 */
function normalisePath(path: string): string {
  const forwardSlashes = path.replace(/\\/g, '/');
  const collapsed = forwardSlashes.replace(/\/+/g, '/');
  const lower = collapsed.toLowerCase();

  // Check whether the path ends with a trailing forward slash.
  if (lower.endsWith('/')) {
    // Strip trailing slash.
    return lower.slice(0, -1);
  } else {
    // No trailing slash: return lowercased path as-is.
    return lower;
  }
}

/**
 * Extracts the directory portion of a file path before the final separator.
 *
 * @purpose Computes the parent directory path by returning everything preceding the last forward slash or backslash.
 * @inputs path - File system path string.
 * @outputs string - Directory path preceding the last separator, or empty string if no separator is present.
 * @dataflow path string -> find last '/' or '\' -> slice substring preceding separator -> directory path.
 * @controlflow Find last occurrence of '/' and '\' -> take maximum index -> if separator exists return slice(0, index) -> else return empty string.
 */
export function dirname(path: string): string {
  const forwardIndex = path.lastIndexOf('/');
  const backIndex = path.lastIndexOf('\\');
  const lastSlashIndex = Math.max(forwardIndex, backIndex);

  // Check whether any directory separator exists in the path.
  if (lastSlashIndex !== -1) {
    // Separator found: return everything before the last slash.
    return path.slice(0, lastSlashIndex);
  } else {
    // No separator found: return empty string.
    return '';
  }
}

/**
 * Writes an absolute file path in its plain form: forward slashes, with any '.' and '..' segments resolved.
 *
 * @purpose Lets two spellings of the same file be compared, and gives a folder to measure relative links from (FR-13.6).
 * @inputs path - An absolute path, with a drive letter or a leading slash, in either kind of slash.
 * @outputs string - The same path with its segments resolved; case is kept.
 * @dataflow path -> drive or root + remaining segments -> joinPath.
 * @controlflow A leading drive letter is kept as the root; otherwise the path is resolved under '/'.
 */
export function canonicalFilePath(path: string): string {
  const parts = path.split(/[\\/]/);
  const first = parts[0] ?? '';
  // Check for a Windows drive, which is the root the rest resolves under.
  if (/^[a-z]:$/i.test(first)) {
    return joinPath(first, parts.slice(1).join('/'));
  } else {
    return joinPath('/', parts.join('/'));
  }
}

/**
 * Joins a base path and a relative path, resolving navigation segments while preserving root prefixes.
 *
 * @purpose Combines path segments, resolves '..' navigation without escaping root, preserves leading '/' or drive letter, and formats with '/'.
 * @inputs base - Base directory path string.
 * @inputs relative - Relative target path string.
 * @outputs string - Resolved joined path string with forward slash separators.
 * @dataflow base and relative strings -> split on separators -> filter relative segments -> pop on '..' -> stack.join('/') -> preserve root prefix.
 * @controlflow Inspect base for leading slash and drive prefix -> populate stack with base segments -> iterate relative segments dropping '.'/empty -> pop on '..' if above minStackLength -> push segment -> join with '/' -> attach leading slash if needed -> return joined path.
 */
export function joinPath(base: string, relative: string): string {
  const hasLeadingSlash = base.startsWith('/') || base.startsWith('\\');
  const driveMatch = /^[a-z]:/i.exec(base);
  const drivePrefix = driveMatch !== null && driveMatch[0] !== undefined ? driveMatch[0] : null;

  const rawBaseSegments = base.split(/[\\/]/);
  const stack: string[] = [];

  // Populate stack with non-empty base segments.
  for (let i = 0; i < rawBaseSegments.length; i++) {
    const seg = rawBaseSegments[i];
    // Check if segment is defined and non-empty under strict index access.
    if (seg !== undefined && seg.length > 0) {
      stack.push(seg);
    } else {
      // Empty segment: skip.
    }
  }

  // Preserve drive prefix or root boundary: stack cannot pop below minStackLength.
  let minStackLength: number;
  // Check whether a Windows drive prefix exists.
  if (drivePrefix !== null) {
    // Drive prefix (e.g. 'C:') occupies index 0 and must never be popped.
    minStackLength = 1;
  } else {
    // Relative or POSIX root: empty stack is the root boundary.
    minStackLength = 0;
  }

  const relativeSegments = relative.split(/[\\/]/);

  // Process relative segments in order.
  for (let i = 0; i < relativeSegments.length; i++) {
    const seg = relativeSegments[i];
    // Check if segment is defined under strict index access.
    if (seg === undefined) {
      continue;
    } else {
      // Valid relative segment.
    }

    // Check segment type: empty/current, parent directory, or normal segment.
    if (seg === '' || seg === '.') {
      // Drop empty and current directory '.' segments.
      continue;
    } else if (seg === '..') {
      // Apply '..' by popping, never above the root boundary.
      if (stack.length > minStackLength) {
        stack.pop();
      } else {
        // At or above root: popping an empty stack does nothing.
      }
    } else {
      // Normal path segment: push to stack.
      stack.push(seg);
    }
  }

  let joined = stack.join('/');

  // Check whether a leading slash must be preserved for POSIX absolute paths without a drive prefix.
  if (hasLeadingSlash && drivePrefix === null) {
    // Ensure the resulting path begins with a leading forward slash.
    if (!joined.startsWith('/')) {
      joined = '/' + joined;
    } else {
      // Already has leading slash.
    }
  } else {
    // Base did not have leading slash or path carries a drive prefix.
  }

  return joined;
}

/**
 * Extracts the trailing segment of a path following the last directory separator.
 *
 * @purpose Identifies the file name or final component of a path.
 * @inputs path - File system path string.
 * @outputs string - Substring after the last '/' or '\', or original string if no separator exists.
 * @dataflow path string -> locate last '/' or '\' -> slice trailing segment -> last segment string.
 * @controlflow Find last occurrence of '/' and '\' -> take maximum index -> if separator exists return slice(index + 1) -> else return path.
 */
function lastSegment(path: string): string {
  const forwardIndex = path.lastIndexOf('/');
  const backIndex = path.lastIndexOf('\\');
  const lastSlashIndex = Math.max(forwardIndex, backIndex);

  // Check whether a directory separator exists in the path.
  if (lastSlashIndex !== -1) {
    // Return the segment following the last separator.
    return path.slice(lastSlashIndex + 1);
  } else {
    // No separator present: return the entire path string.
    return path;
  }
}

/**
 * Classifies an arbitrary link reference within a document context to determine its target type and metadata.
 *
 * @purpose Determines whether a link represents an in-document heading, a vault note, an external web URL, a mail address, a blocked URI scheme, or an unresolved reference.
 * @inputs href - Raw link reference string from the document link attribute.
 * @inputs context - LinkContext containing the active document disk path and all indexed vault notes.
 * @outputs LinkTarget - Discriminated union detailing the target classification and associated metadata.
 * @dataflow href -> trim -> classify by empty / anchor / protocol-relative / URI scheme / file path -> resolve note matches -> LinkTarget.
 * @controlflow Trim input -> check empty -> check anchor '#' -> check protocol-relative '//' -> check URI scheme (http, mailto, blocked) skipping Windows drives -> split path fragment/query -> resolve note by exact path, .md extension, or targetsNote -> return classified LinkTarget.
 */
export function classifyLink(href: string, context: LinkContext): LinkTarget {
  const raw = href.trim();

  // 1. Check whether the trimmed link reference is empty.
  if (raw === '') {
    // Empty link target cannot be resolved.
    return {
      kind: 'unresolved',
      target: href,
      reason: 'This link has no target.',
    };
  } else {
    // Non-empty link: continue evaluation.
  }

  // 2. Check whether the link is an in-document heading anchor reference.
  if (raw.startsWith('#')) {
    const slug = safeDecode(raw.slice(1));
    // Check whether the decoded heading slug is empty.
    if (slug === '') {
      // Empty anchor '#': link has no target.
      return {
        kind: 'unresolved',
        target: href,
        reason: 'This link has no target.',
      };
    } else {
      // Valid heading anchor target.
      return {
        kind: 'heading',
        slug,
      };
    }
  } else {
    // Not an in-document heading anchor.
  }

  // 3. Check whether the link is protocol-relative (e.g. //example.com).
  if (raw.startsWith('//')) {
    // A protocol-relative link on a local note can only mean the web: classify with https: prefix.
    return classifyLink('https:' + raw, context);
  } else {
    // Not protocol-relative: proceed to URI scheme checks.
  }

  // 4. Scheme check with regex. Skip scheme handling when raw begins with a Windows drive (e.g. C:\ or C:/).
  const isWindowsDrive = /^[a-z]:[\\/]/i.test(raw);
  // Check whether the target starts with a Windows drive path.
  if (!isWindowsDrive) {
    const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
    // Check whether a URI scheme was matched.
    if (schemeMatch !== null && schemeMatch[1] !== undefined) {
      const scheme = schemeMatch[1].toLowerCase();

      // Check whether scheme is web HTTP/HTTPS.
      if (scheme === 'http' || scheme === 'https') {
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          // URL constructor threw: invalid web address.
          return {
            kind: 'unresolved',
            target: href,
            reason: 'Not a valid web address.',
          };
        }

        // Check whether the parsed URL has a non-empty hostname.
        if (parsed.hostname === '') {
          // Empty hostname: invalid web address.
          return {
            kind: 'unresolved',
            target: href,
            reason: 'Not a valid web address.',
          };
        } else {
          // Valid web address.
          return {
            kind: 'web',
            url: parsed.href,
            domain: parsed.hostname.toLowerCase(),
          };
        }
      } else if (scheme === 'mailto') {
        const addressPart = raw.slice('mailto:'.length).split('?')[0] ?? '';
        const address = safeDecode(addressPart);

        // Check whether the decoded mailto address is empty.
        if (address === '') {
          // Empty email address.
          return {
            kind: 'unresolved',
            target: href,
            reason: 'This link has no address.',
          };
        } else {
          // Valid email address.
          return {
            kind: 'mail',
            url: raw,
            address,
          };
        }
      } else {
        // javascript:, data:, file: and the rest are never opened from a document -- a link a user did not write can arrive in a file they were sent, and following it is how a document becomes an attack.
        return {
          kind: 'blocked',
          target: raw,
          scheme: scheme.toLowerCase(),
        };
      }
    } else {
      // No URI scheme present: proceed to path resolution.
    }
  } else {
    // Windows drive detected: proceed to path resolution.
  }

  // 5. Otherwise it is a path. Split off the fragment at the first '#', then drop any '?query'.
  const hashIndex = raw.indexOf('#');
  let slug: string | null = null;
  let beforeHash: string = raw;

  // Check whether a fragment separator '#' is present.
  if (hashIndex !== -1) {
    beforeHash = raw.slice(0, hashIndex);
    const after = raw.slice(hashIndex + 1);
    const decodedSlug = safeDecode(after);
    // Check whether the decoded slug is non-empty.
    if (decodedSlug.length > 0) {
      slug = decodedSlug;
    } else {
      // Empty fragment after '#': slug is null.
      slug = null;
    }
  } else {
    // No fragment present: slug is null.
    slug = null;
  }

  const queryIndex = beforeHash.indexOf('?');
  let beforeQuery: string = beforeHash;
  // Check whether a query separator '?' is present.
  if (queryIndex !== -1) {
    beforeQuery = beforeHash.slice(0, queryIndex);
  } else {
    // No query parameter present.
  }

  const pathPart = safeDecode(beforeQuery);

  // Check whether the decoded pathPart is empty.
  if (pathPart === '') {
    // Empty path: link has no target.
    return {
      kind: 'unresolved',
      target: href,
      reason: 'This link has no target.',
    };
  } else {
    // Non-empty path: proceed to resolve against vault or file system.
  }

  const isAbsolute =
    pathPart.startsWith('/') ||
    pathPart.startsWith('\\') ||
    /^[a-z]:[\\/]/i.test(pathPart);

  // 5a. If context.documentPath !== null or path is absolute, compute resolved path.
  if (context.documentPath !== null || isAbsolute) {
    let resolved: string;
    // Check whether pathPart is absolute.
    if (isAbsolute) {
      // Path is already absolute: use as-is.
      resolved = pathPart;
    } else if (context.documentPath !== null) {
      // Document is saved: join active document directory with relative pathPart.
      resolved = joinPath(dirname(context.documentPath), pathPart);
    } else {
      // Fallback for unreachable branch under type checking.
      resolved = pathPart;
    }

    const normalisedResolved = normalisePath(resolved);

    // Search for a vault note whose normalised path matches resolved path.
    for (let i = 0; i < context.notes.length; i++) {
      const note = context.notes[i];
      // Check if note is defined under strict index access.
      if (note === undefined) {
        continue;
      } else {
        // Valid note index entry.
      }

      // Check whether vault note path matches normalised resolved path.
      if (normalisePath(note.path) === normalisedResolved) {
        return {
          kind: 'note',
          path: note.path,
          slug,
          label: note.title,
        };
      } else {
        // Path does not match.
      }
    }

    const normalisedWithMd = normalisePath(resolved + '.md');

    // Search for a vault note whose normalised path matches resolved path + '.md'.
    for (let i = 0; i < context.notes.length; i++) {
      const note = context.notes[i];
      // Check if note is defined under strict index access.
      if (note === undefined) {
        continue;
      } else {
        // Valid note index entry.
      }

      // Check whether vault note path matches normalised resolved path with .md.
      if (normalisePath(note.path) === normalisedWithMd) {
        return {
          kind: 'note',
          path: note.path,
          slug,
          label: note.title,
        };
      } else {
        // Path does not match.
      }
    }

    const syntheticLink = {
      kind: 'inline' as const,
      target: pathPart,
      context: '',
      offset: 0,
    };

    // Name match: find the first note for which targetsNote is true.
    for (let i = 0; i < context.notes.length; i++) {
      const note = context.notes[i];
      // Check if note is defined under strict index access.
      if (note === undefined) {
        continue;
      } else {
        // Valid note index entry.
      }

      // Check whether this vault note matches the synthetic link target.
      if (targetsNote(syntheticLink, note)) {
        return {
          kind: 'note',
          path: note.path,
          slug,
          label: note.title,
        };
      } else {
        // Note does not match synthetic link target.
      }
    }

    // No vault note matched: file outside the vault may still exist.
    return {
      kind: 'note',
      path: resolved,
      slug,
      label: withoutExtension(lastSegment(resolved)),
    };
  } else {
    // 5b & 5c. documentPath === null and path is relative.
    const syntheticLink = {
      kind: 'inline' as const,
      target: pathPart,
      context: '',
      offset: 0,
    };

    // Search for a vault note by name match.
    for (let i = 0; i < context.notes.length; i++) {
      const note = context.notes[i];
      // Check if note is defined under strict index access.
      if (note === undefined) {
        continue;
      } else {
        // Valid note index entry.
      }

      // Check whether this vault note matches the synthetic link target.
      if (targetsNote(syntheticLink, note)) {
        return {
          kind: 'note',
          path: note.path,
          slug,
          label: note.title,
        };
      } else {
        // Note does not match synthetic link target.
      }
    }

    // 5c. Still nothing and documentPath === null and the path is relative.
    return {
      kind: 'unresolved',
      target: href,
      reason: 'Save the note to follow relative links.',
    };
  }
}
