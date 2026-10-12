/**
 * @file file-tree.ts
 * @purpose Pure model for the vault file tree: building a sorted folder/file hierarchy from notes and folders, flattening it into visible rows, validating entry names, and resolving absolute paths.
 * @inputs TreeNote[] and string[] of folder relative paths; user-supplied names, roots, and remap targets.
 * @outputs Sorted TreeNode arrays, VisibleRow arrays, child name lists, validation messages (or null), resolved absolute paths.
 * @functions
 *   - compareNames: Case-insensitive, numeric-aware comparator for sorting names.
 *   - parentRelative: Returns the relative path of a folder's parent.
 *   - baseName: Returns the final path segment of a relative path.
 *   - childRelative: Joins a folder's relative path with a child name using '/'.
 *   - buildFileTree: Assembles notes and folders into a nested, sorted tree.
 *   - flattenVisible: Expands a tree into depth-annotated visible rows.
 *   - childNames: Resolves the names of a folder's direct children.
 *   - validateEntryName: Returns an error message for invalid names, or null when valid.
 *   - withNoteExtension: Ensures a name carries a markdown extension.
 *   - absolutePath: Combines a root and relative path using the platform separator.
 *   - isSameOrInside: Tests whether a path equals or lives inside a folder.
 *   - topLevelOnly: Filters out entries nested within other listed entries.
 *   - remapPath: Rewrites a path under a matched source root to a destination.
 *   - uniqueChildName: Produces a name not colliding (case-insensitively) with taken names.
 * @dataflow Notes + folders → draft tree → frozen sorted nodes → visible rows / child lists; raw strings → validation/normalisation → resolved strings.
 * @controlflow Pure, side-effect-free transforms: build the hierarchy, then read it via flatten/childNames or resolve paths; validation returns early on first failing rule.
 * @version 1
 * @date 2026-09-14
 */

export interface TreeNote { readonly path: string; readonly relative: string; readonly title: string; }
export interface TreeFolderNode { readonly kind: 'folder'; readonly name: string; readonly relative: string; readonly children: readonly TreeNode[]; }
export interface TreeFileNode { readonly kind: 'file'; readonly name: string; readonly relative: string; readonly path: string; readonly title: string; }
export type TreeNode = TreeFolderNode | TreeFileNode;
export interface VisibleRow { readonly node: TreeNode; readonly depth: number; }

/** Characters no file or folder name may contain on Windows, and the path separators everywhere. */
export const INVALID_NAME_CHARACTERS: RegExp = /[\\/:*?"<>|]/;
/** Device names Windows reserves, with or without an extension. */
const RESERVED_NAMES: RegExp = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Recognised markdown note extensions that should not be appended by withNoteExtension. */
const NOTE_EXTENSION: RegExp = /\.(md|markdown|mdown)$/i;

/**
 * Compare two names for sorting purposes.
 * @purpose Produces a case-insensitive, numeric-aware ordering suitable for file and folder names.
 * @inputs a - the first name to compare. b - the second name to compare.
 * @outputs number - negative if a precedes b, positive if a follows b, zero if equal.
 * @dataflow Two strings → localeCompare (case-folded, numeric) → tie-break byte comparison → signed integer.
 * @controlflow Return the locale result when names differ; otherwise fall back to strict ordering, then equality.
 */
export function compareNames(a: string, b: string): number {
  // Case-insensitive, numeric-aware comparison as the primary sort key.
  const folded = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  if (folded !== 0) {
    // Names differ under case-folding: use the locale result directly.
    return folded;
  } else {
    // Locale considered them equal: break ties with a byte-order comparison.
    if (a < b) {
      return -1;
    } else if (a > b) {
      return 1;
    } else {
      // Identical strings compare as zero.
      return 0;
    }
  }
}

/**
 * Return the parent folder of a relative path.
 * @purpose Extracts the relative path of the folder that directly contains the given entry.
 * @inputs relative - a '/'-separated relative path (empty string denotes the vault root).
 * @outputs string - the parent's relative path, or '' when there is no parent.
 * @dataflow Relative path → lastIndexOf('/') → sliced prefix → parent relative path.
 * @controlflow If no separator exists return the empty root; otherwise slice up to the final slash.
 */
export function parentRelative(relative: string): string {
  const at = relative.lastIndexOf('/');
  if (at < 0) {
    // No ancestor segment exists: this is already a top-level entry.
    return '';
  } else {
    // Strip the trailing segment to reach the parent folder.
    return relative.slice(0, at);
  }
}

/**
 * Return the final path segment of a relative path.
 * @purpose Extracts the name (file or folder) from a '/'-separated relative path.
 * @inputs relative - a '/'-separated relative path (empty string denotes the vault root).
 * @outputs string - the trailing segment, or the whole string when there is no separator.
 * @dataflow Relative path → lastIndexOf('/') + 1 → sliced suffix → base name.
 * @controlflow Slicing from one past the final slash yields the name; a missing slash (-1) yields index 0.
 */
export function baseName(relative: string): string {
  // lastIndexOf returns -1 for a top-level entry, so slicing from index 0 yields the whole string.
  return relative.slice(relative.lastIndexOf('/') + 1);
}

/**
 * Join a folder's relative path with a child name.
 * @purpose Builds the relative path of a child inside a given folder using '/' separators.
 * @inputs folderRelative - the parent folder's relative path ('' for the vault root). name - the child's name.
 * @outputs string - the child's relative path.
 * @dataflow Parent relative + child name → joined with '/' (or bare name at root) → child relative path.
 * @controlflow At the root return the bare name; otherwise append '/name' to the parent path.
 */
export function childRelative(folderRelative: string, name: string): string {
  if (folderRelative === '') {
    // The folder is the vault root: the child path is just its name.
    return name;
  } else {
    // Join the parent's relative path with the new segment using '/'.
    return `${folderRelative}/${name}`;
  }
}

/**
 * Build a nested, sorted tree from notes and folders.
 * @purpose Assembles note files and explicitly declared folders into an ordered folder/file hierarchy rooted at the vault root.
 * @inputs notes - the notes to place as leaf files. folders - explicit folder paths (including empty ones).
 * @outputs TreeNode[] - folders before files, each level sorted by compareNames; folders with no descendants still appear.
 * @dataflow Notes + folders → draft Map-based tree → frozen sorted immutable nodes.
 * @controlflow Register every folder, attach each note under its parent, then recursively freeze and sort.
 */
export function buildFileTree(notes: readonly TreeNote[], folders: readonly string[]): readonly TreeNode[] {
  interface Draft {
    readonly name: string;
    readonly relative: string;
    readonly folders: Map<string, Draft>;
    readonly files: TreeFileNode[];
  }

  const root: Draft = { name: '', relative: '', folders: new Map(), files: [] };

  // folderAt walks (creating as needed) the chain of subfolders for a given relative path.
  function folderAt(relative: string): Draft {
    let current = root;
    for (const segment of relative.split('/')) {
      if (segment === '') {
        // Empty segment from a leading/double slash carries no folder to descend into.
        continue;
      } else {
        let next = current.folders.get(segment);
        if (next === undefined) {
          // Subfolder does not exist yet: create it under the current parent.
          next = { name: segment, relative: childRelative(current.relative, segment), folders: new Map(), files: [] };
          current.folders.set(segment, next);
        } else {
          // Subfolder already exists from a prior note or folder entry.
        }
        current = next;
      }
    }
    return current;
  }

  for (const folder of folders) {
    // Register every explicitly declared folder so empty ones still appear in the tree.
    folderAt(folder);
  }

  for (const note of notes) {
    // Attach each note as a file under its parent folder, keyed by the parent's relative path.
    folderAt(parentRelative(note.relative)).files.push({ kind: 'file', name: baseName(note.relative), relative: note.relative, path: note.path, title: note.title });
  }

  // freeze converts a draft subtree into sorted, immutable tree nodes.
  function freeze(draft: Draft): TreeNode[] {
    const subfolders = [...draft.folders.values()].sort((a, b) => compareNames(a.name, b.name)).map((sub): TreeNode => ({ kind: 'folder', name: sub.name, relative: sub.relative, children: freeze(sub) }));
    const files = [...draft.files].sort((a, b) => compareNames(a.name, b.name));
    // Folders sort before files at every level.
    return [...subfolders, ...files];
  }

  return freeze(root);
}

/**
 * Flatten a tree into depth-annotated visible rows.
 * @purpose Expands folders that are present in the expanded set into a linear list of visible rows with their nesting depth.
 * @inputs nodes - the top-level tree nodes to render. expanded - relative paths of folders shown open.
 * @outputs VisibleRow[] - each node paired with its zero-based depth, in document order.
 * @dataflow Tree nodes → recursive visit pushing rows → descending into expanded folders → flat row list.
 * @controlflow Emit every node; recurse only when a folder is both a folder and marked expanded.
 */
export function flattenVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): readonly VisibleRow[] {
  const rows: VisibleRow[] = [];

  // visit recursively emits each node as a visible row, descending into expanded folders.
  function visit(list: readonly TreeNode[], depth: number): void {
    for (const node of list) {
      rows.push({ node, depth });
      if (node.kind === 'folder' && expanded.has(node.relative)) {
        // Expanded folder: emit its children at the next depth level.
        visit(node.children, depth + 1);
      } else {
        // A file, or a collapsed folder with no visible descendants.
      }
    }
  }

  visit(nodes, 0);
  return rows;
}

/**
 * Resolve the names of a folder's direct children.
 * @purpose Returns the child names of the folder identified by a relative path at the given top level.
 * @inputs nodes - the current level's tree nodes. folderRelative - the target folder's relative path ('' for root).
 * @outputs string[] - the matched folder's child names, or [] if any segment is missing.
 * @dataflow Level + segments → descend via find → final level mapped to names.
 * @controlflow Walk each segment returning early on a miss; use the top-level nodes when the path is empty.
 */
export function childNames(nodes: readonly TreeNode[], folderRelative: string): readonly string[] {
  let level = nodes;
  if (folderRelative !== '') {
    // Descend through each segment to reach the target folder.
    for (const segment of folderRelative.split('/')) {
      const folder = level.find((node): node is TreeFolderNode => node.kind === 'folder' && node.name === segment);
      if (folder === undefined) {
        // The requested subfolder does not exist in this branch: no children.
        return [];
      } else {
        // Move down into the matched folder for the next iteration.
        level = folder.children;
      }
    }
  } else {
    // Empty relative path refers to the root: use the top-level nodes directly.
  }
  return level.map((node) => node.name);
}

/**
 * Validate a proposed entry name.
 * @purpose Returns a human-readable error message when a name is invalid, or null when it may be used.
 * @inputs name - the raw candidate name as entered by the user.
 * @outputs string | null - an error message on failure, or null when the trimmed name is acceptable.
 * @dataflow Raw name → trimmed → rule checks (empty, reserved markers, illegal chars, trailing dot, device names) → verdict.
 * @controlflow Return the first failing rule's message; fall through to null when every check passes.
 */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    // An empty or whitespace-only name is rejected.
    return 'A name is needed.';
  } else if (trimmed === '.' || trimmed === '..') {
    // The current and parent directory markers are reserved.
    return 'That name is reserved.';
  } else if (INVALID_NAME_CHARACTERS.test(trimmed)) {
    // A path separator or Windows-forbidden character was supplied.
    return 'A name cannot contain \\ / : * ? " < > |';
  } else if (trimmed.endsWith('.')) {
    // Trailing dots are rejected to avoid ambiguity on legacy filesystems.
    return 'A name cannot end with a dot.';
  } else if (RESERVED_NAMES.test(trimmed)) {
    // The name matches a Windows-reserved device name.
    return 'That name is reserved by Windows.';
  } else {
    // None of the rejection rules matched: the name is valid.
    return null;
  }
}

/**
 * Ensure a name carries a markdown extension.
 * @purpose Appends '.md' only when the name lacks a recognised note extension.
 * @inputs name - the candidate file name.
 * @outputs string - the original name if it already ends in a supported extension, otherwise name + '.md'.
 * @dataflow Name → NOTE_EXTENSION test → kept or extended → result string.
 * @controlflow Return unchanged when an extension matches; append '.md' otherwise.
 */
export function withNoteExtension(name: string): string {
  // Append '.md' only when the name already lacks a recognized note extension.
  if (NOTE_EXTENSION.test(name)) {
    // A supported note extension is already present; leave the name unchanged.
    return name;
  } else {
    // No recognized extension: add the default markdown extension.
    return `${name}.md`;
  }
}

/**
 * Combine a root with a relative path using the platform separator.
 * @purpose Produces an absolute-style path by joining a filesystem root and a '/'-based relative path.
 * @inputs root - the base directory path (may use '\' or '/'). relative - a '/'-separated relative path ('' for the root itself).
 * @outputs string - the joined absolute path, translating '/' segments to the detected separator.
 * @dataflow Root + relative → detect separator, trim trailing slash → join with translated segments.
 * @controlflow Return the cleaned root when relative is empty; otherwise concatenate with the chosen separator.
 */
export function absolutePath(root: string, relative: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  // Choose a backslash separator when the root uses Windows-style paths, otherwise forward slashes.
  const base = root.endsWith('\\') || root.endsWith('/') ? root.slice(0, -1) : root;
  // Strip a single trailing separator from the root so we do not double it up.

  if (relative === '') {
    // No relative component: return the cleaned root as-is.
    return base;
  } else {
    // Join the root with the relative path, translating '/' segments to the chosen separator.
    return `${base}${separator}${relative.split('/').join(separator)}`;
  }
}

/**
 * Test whether a path equals or lives inside a folder.
 * @purpose Determines if a relative path is the same as, or nested beneath, a given folder.
 * @inputs relative - the candidate path. folderRelative - the folder to test against ('' matches everything).
 * @outputs boolean - true when the path equals the folder or starts with 'folder/'.
 * @dataflow Folder + path → root shortcut → equality/startsWith check → verdict.
 * @controlflow Root always contains; otherwise return true on exact match or descendant prefix, false otherwise.
 */
export function isSameOrInside(relative: string, folderRelative: string): boolean {
  if (folderRelative === '') {
    // The vault root contains everything.
    return true;
  } else {
    // True when the path equals the folder or lives beneath it as a descendant.
    if (relative === folderRelative) {
      // Exact match: the path is the folder itself.
      return true;
    } else if (relative.startsWith(`${folderRelative}/`)) {
      // The path begins with the folder followed by a separator: it is inside.
      return true;
    } else {
      // Neither equal nor nested under the folder.
      return false;
    }
  }
}

/**
 * Keep only entries not nested within another listed entry.
 * @purpose Filters a set of relative paths down to those at the top level, dropping any contained in another.
 * @inputs relatives - candidate relative paths (may include '' for the root).
 * @outputs string[] - the subset that is not strictly inside any other listed path.
 * @dataflow List → per-entry containment test via isSameOrInside → retained entries.
 * @controlflow Retain an entry when no other distinct, non-empty entry contains it.
 */
export function topLevelOnly(relatives: readonly string[]): readonly string[] {
  // Keep only entries that are not strictly contained within another listed entry.
  return relatives.filter((relative) => !relatives.some((other) => other !== relative && other !== '' && isSameOrInside(relative, other)));
}

/**
 * Rewrite a path under a matched source root to a destination.
 * @purpose Remaps a filesystem path when it matches (case-insensitively, either separator) the source root.
 * @inputs path - the path to remap. from - the current root. to - the replacement root.
 * @outputs string | null - the rewritten path on a match, or null when there is no overlap with the source.
 * @dataflow Paths → normalise (backslashes→'/', lowercase) → equality/descendant test → joined result.
 * @controlflow Return to on exact match; prefix 'to' with the trailing portion for descendants; return null otherwise.
 */
export function remapPath(path: string, from: string, to: string): string | null {
  // Rewrites a path when it matches (case-insensitively, either separator) the source root.
  const normalise = (value: string): string => value.replace(/\\/g, '/').toLowerCase();
  // Normalisation collapses Windows separators and case so comparisons ignore them.

  const target = normalise(path);
  const source = normalise(from);

  if (target === source) {
    // Exact match to the source root: replace it wholesale with the destination.
    return to;
  } else if (target.startsWith(`${source}/`)) {
    // The path is a descendant of the source: keep the trailing portion and prefix the destination.
    return `${to}${path.slice(from.length)}`;
  } else {
    // No overlap with the source root: nothing to remap.
    return null;
  }
}

/**
 * Produce a name that does not collide with taken names.
 * @purpose Generates a unique child name by appending an incrementing suffix when the stem collides (case-insensitively).
 * @inputs taken - existing sibling names. stem - the desired base name. extension - the file extension to append.
 * @outputs string - the first non-colliding candidate, e.g. 'Untitled', 'Untitled 2', 'Untitled 3'.
 * @dataflow Taken set (lowercased) → stem+extension → increment suffix on collision → unique candidate.
 * @controlflow Loop while a lowercased collision exists; return the first free candidate.
 */
export function uniqueChildName(taken: readonly string[], stem: string, extension: string): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  let candidate = `${stem}${extension}`;
  let counter = 2;

  while (lower.has(candidate.toLowerCase())) {
    // The candidate collides with an existing name: try the next numeric suffix.
    candidate = `${stem} ${counter}${extension}`;
    counter += 1;
  }

  return candidate;
}
