#!/usr/bin/env node

/**
 * @file third-party-notices.mjs
 * @purpose Assembles every bundled third-party component (npm packages, Rust crates, Hunspell dictionaries) and writes their licence texts into packages/app/public/THIRD-PARTY-NOTICES.txt.
 * @inputs Repository root; stdout of `npm ls` and `cargo metadata`; licence files discovered on disk under each package/crate/dictionary directory.
 * @outputs A single THIRD-PARTY-NOTICES.txt document containing a component index followed by one printed copy of each distinct licence text with its consumers.
 * @functions
 *   - isLicenceFileName: Classifies whether a file name denotes a licence document rather than code or markup.
 *   - licenceOfPackageJson: Extracts a human-readable licence string from an untrusted package.json object.
 *   - normaliseText: Canonicalises raw licence text (newlines, trailing whitespace, surrounding blanks).
 *   - shippedCrateIds: BFS over cargo metadata to list runtime crate ids reachable from the workspace root.
 *   - applyOverrides: Fills in upstream licence texts for components that ship none and reports what is missing.
 *   - groupByText: Deduplicates licence texts and attaches resolved text ids to each component.
 *   - renderNotices: Serialises a grouped result into the final notice document string.
 *   - readLicenceTexts: Reads every recognised licence file in a directory, sorted by name.
 *   - run: Executes a shell command capturing stdout while tolerating non-zero exit codes that still print output.
 *   - npmComponents: Enumerates shipped npm workspace dependencies as components with their licence texts.
 *   - crateComponents: Enumerates shipped Rust crates from cargo metadata as components with their licence texts.
 *   - dictionaryComponents: Enumerates bundled Hunspell dictionaries as components with their licence texts.
 *   - loadOverrides: Reads the upstream licence texts listed in scripts/licence-overrides/sources.json.
 *   - main: Orchestrates collection, grouping, rendering, and writing of the notices document.
 * @dataflow npm ls + cargo metadata + on-disk files -> component list -> groupByText deduplication -> renderNotices serialisation -> writeFileSync to disk.
 * @controlflow Resolve repo root -> collect npm/crate/dictionary components -> group by text -> render -> mkdir target dir -> write file -> log summary; runs only when executed directly.
 * @version 2
 * @date 2026-10-07
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/**
 * @typedef {Object} Component
 * @property {string} name Human-readable component name.
 * @property {string} version Version string (may be empty for dictionaries).
 * @property {string} license Short human-readable licence identifier or pointer.
 * @property {'npm'|'crate'|'dictionary'} source Where the component was sourced from.
 * @property {string[]} texts Raw licence document text(s) shipped alongside the component.
 */

/**
 * @typedef {Object} LicenceText
 * @property {number} id Stable 1-based identifier within a grouped result.
 * @property {string} text Canonicalised licence body, printed once per distinct content.
 * @property {string[]} usedBy Names of components that reference this text.
 */

/**
 * @typedef {Object} Grouped
 * @property {Array<Component & {textIds: number[]}>} Components with resolved licence-text ids attached.
 * @property {LicenceText[]} texts Distinct canonicalised licence texts keyed by id.
 */

const LICENSE_TEXT_EXTENSION_REGEX = /\.(md|txt|markdown)$/i;
/** A licence keyword, then an optional suffix that may itself hold dots (LICENSE_APACHE-2.0). */
const LICENCE_STEM_REGEX = /^(licen[cs]e|copying|unlicense|notice)([-_.][a-z0-9.-]+)?$/i;
/** Excluded real extensions: code, type declarations, markup, and machine-readable metadata. */
const CODE_OR_MARKUP_EXTENSION_REGEX = /\.(js|cjs|mjs|ts|rs|json|html|d\.ts)$/i;

/**
 * Determines whether a file name denotes a licence document rather than source or markup.
 * @purpose Classifies licence files by matching a recognised keyword stem while excluding code/markup extensions.
 * @inputs fileName - The base file name to classify (e.g. "LICENSE", "license.js").
 * @outputs boolean - True when the name is a licence text, false otherwise.
 * @dataflow File name -> strip licence-document extension from stem -> keyword test AND exclusion test -> boolean result.
 * @controlflow Compute stripped base -> match keyword regex on base -> exclude code/markup extensions -> return conjunction of both tests.
 */
export function isLicenceFileName(fileName) {
  // Start from the full file name and strip a licence-document extension if present so the stem can be matched.
  let base = fileName;

  // If the file ends with a common licence text extension, remove it before matching the keyword stem.
  if (LICENSE_TEXT_EXTENSION_REGEX.test(fileName)) {
    // Strip the trailing .md/.txt/.markdown extension from the base used for keyword matching.
    base = fileName.replace(LICENSE_TEXT_EXTENSION_REGEX, '');
  } else {
    // No licence-document suffix was present: keep the file name unchanged as the base.
  }

  // The (possibly stripped) stem must be a recognised licence keyword with an optional versioned suffix such as -MIT.
  const matchesLicenceKeyword = LICENCE_STEM_REGEX.test(base);

  // Exclude files whose real extension is code, type declarations, markup, or machine-readable metadata even if the stem looks like a licence.
  const hasCodeOrMarkupExtension = CODE_OR_MARKUP_EXTENSION_REGEX.test(fileName);

  // A file counts as a licence text only when its stem matches a keyword and it does not carry an excluded code/markup extension.
  return matchesLicenceKeyword && !hasCodeOrMarkupExtension;
}

/**
 * Extracts a human-readable licence string from an untrusted package.json object.
 * @purpose Reads the modern `license` field first, then the deprecated plural `licenses` array, defaulting to UNKNOWN.
 * @inputs pkg - An unknown parsed package.json object (may be null or malformed).
 * @outputs string - The licence identifier/type, " OR "-joined for multiple entries, or 'UNKNOWN'.
 * @dataflow Unknown pkg -> read license field -> fall back to licenses array -> single licence string result.
 * @controlflow Prefer non-empty string license -> typed object license.type -> joined licenses array -> UNKNOWN fallback.
 */
export function licenceOfPackageJson(pkg) {
  // Guard every access: pkg is untrusted and may be null, undefined, or a non-object.
  const license = (pkg && typeof pkg === 'object') ? pkg.license : undefined;

  // If the modern single-license field holds a non-empty string, use it directly as the licence identifier.
  if (typeof license === 'string' && license !== '') {
    return license;
  } else {
    // The single-license field is missing or empty: fall through to other recognised shapes.
  }

  // If the modern single-license field is an object with a string type, use that type as the licence identifier.
  if (license && typeof license === 'object' && typeof license.type === 'string') {
    return license.type;
  } else {
    // The single-license field is not a typed object: fall back to the deprecated plural licenses array.
  }

  const legacyLicenses = (pkg && typeof pkg === 'object') ? pkg.licenses : undefined;

  // If the deprecated plural-licenses field is an array, normalise each entry into a licence string.
  if (Array.isArray(legacyLicenses)) {
    const parts = [];

    for (const entry of legacyLicenses) {
      // Each entry may be a plain string or an object with a type; keep only strings to preserve join semantics.
      if (typeof entry === 'string') {
        parts.push(entry);
      } else if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
        // The entry is a typed licence object: use its type string.
        parts.push(entry.type);
      } else {
        // The entry is neither a string nor a typed object: skip it silently.
      }
    }

    // If no usable licence string survived, report UNKNOWN rather than joining an empty list to nothing.
    if (parts.length === 0) {
      return 'UNKNOWN';
    } else {
      // Join the surviving licence strings with " OR " to represent a dual-licensing arrangement.
      return parts.join(' OR ');
    }
  } else {
    // The legacy licenses field is absent or not an array: no known licence could be derived.
  }

  // None of the recognised shapes produced a licence string for this package.json.
  return 'UNKNOWN';
}

/**
 * Canonicalises raw licence text so identical documents compare equal regardless of formatting noise.
 * @purpose Normalises line endings, strips trailing whitespace per line, and trims surrounding blank lines.
 * @inputs text - Arbitrary licence document body (string).
 * @outputs string - The canonicalised licence body ready for deduplication and rendering.
 * @dataflow Raw text -> CRLF/LF collapse -> trailing-whitespace strip -> trim leading/trailing blanks -> result.
 * @controlflow Replace carriage returns -> apply multiline trailing-space removal -> trim ends; no branching.
 */
export function normaliseText(text) {
  // Coerce to string so a non-string input never throws before the first transformation runs.
  const withUnixNewlines = String(text).replace(/\r\n?/g, '\n');

  // Remove trailing spaces and tabs from every line so indentation artifacts do not create spurious duplicates.
  const withoutTrailingWhitespace = withUnixNewlines.replace(/[ \t]+$/gm, '');

  // Drop leading and blank lines around the document body to stabilise comparison across sources.
  return withoutTrailingWhitespace.trim();
}

/**
 * Lists every runtime crate id reachable from a workspace root in cargo metadata output.
 * @purpose Performs a breadth-first traversal that follows only runtime dependency edges, excluding build/dev-only tooling.
 * @inputs metadata - A parsed `cargo metadata` document (see typedef shape); rootName - the workspace member package name to start from.
 * @outputs string[] - Sorted reachable crate ids excluding the root id itself.
 * @dataflow Cargo metadata -> locate root node -> BFS over runtime edges -> collect seen ids -> return sorted minus root.
 * @controlflow Find root -> throw if absent -> index nodes -> dequeue and expand only null-kind deps -> filter out root -> sort.
 */
export function shippedCrateIds(metadata, rootName) {
  // Read the package list defensively; a malformed document yields an empty array rather than throwing on access.
  const packages = (metadata && Array.isArray(metadata.packages)) ? metadata.packages : [];
  const resolveSection = (metadata && metadata.resolve) ? metadata.resolve : null;

  // Locate the root crate by exact package name match within the workspace member list.
  const root = packages.find(p => p.name === rootName);

  // If the workspace member is absent, surface a clear error instead of crashing later during traversal setup.
  if (!root) {
    throw new Error(`crate ${rootName} not found`);
  } else {
    // The root crate was located: proceed with BFS from its package id.
  }

  // Build an index mapping each dependency node's id to the node itself for O(1) lookup during traversal.
  const nodes = new Map(resolveSection.nodes.map(n => [n.id, n]));

  // Breadth-first search over transitive runtime dependencies starting at the root crate id.
  const queue = [root.id];
  const seen = new Set([root.id]);

  while (queue.length > 0) {
    // Pop the next package id off the front of the BFS queue to expand its outgoing edges.
    const currentId = queue.shift();
    const node = nodes.get(currentId);

    // If no dependency node exists for this id, skip it defensively rather than throwing on undefined access.
    if (!node) {
      continue;
    } else {
      // The node exists: examine each of its declared dependency edges below.
    }

    // Walk every dependency edge declared by the current crate to discover reachable packages.
    for (const dep of node.deps) {
      // A runtime edge is one whose kind list contains a null entry; build-only or dev-only edges are excluded from shipping.
      if (dep.dep_kinds.some(k => k.kind === null)) {
        const pkgId = dep.pkg;

        // Only enqueue crates we have not already visited so the traversal terminates on cyclic dependency graphs.
        if (!seen.has(pkgId)) {
          seen.add(pkgId);
          queue.push(pkgId);
        } else {
          // The crate was already visited: do not re-queue it to avoid revisiting shared transitive dependencies.
        }
      } else {
        // This edge is build-only or dev-only: skip it so tooling such as tauri-build stays excluded from the notices.
      }
    }
  }

  // Return every reachable id except the root itself, sorted for deterministic output across runs.
  return [...seen].filter(id => id !== root.id).sort();
}

/**
 * Deduplicates licence texts and attaches resolved text ids to each component.
 * @purpose Groups components by canonicalised licence content, assigning stable ids and tracking which components use each text.
 * @inputs components - An array of Component objects with raw licence texts.
 * @outputs Grouped - The sorted components (with attached textIds) plus the distinct LicenceText list keyed by id.
 * @dataflow Components -> canonicalise each text -> assign stable ids in first-seen order -> attach ids back to components -> return grouped result.
 * @controlflow Sort components -> iterate assigning deduplicated text ids -> accumulate usedBy lists -> assemble Grouped object.
 */
export function groupByText(components) {
  // Sort by source then name (locale-aware) then version so the output is deterministic regardless of collection order.
  const sorted = [...components].sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version));

  // Map canonicalised text to its stable id so identical licence bodies share one entry in the texts list.
  const textIndex = new Map();
  const texts = [];

  for (const component of sorted) {
    const textIds = [];

    for (const rawText of component.texts) {
      // Canonicalise each raw text before using it as a deduplication key so formatting noise does not split one licence.
      const canonical = normaliseText(rawText);

      // Skip empty bodies: a component with no usable licence content contributes no text id.
      if (canonical === '') {
        continue;
      } else {
        // The body is non-empty: use it as a deduplication key below.
      }

      // If this canonicalised text has not been seen, register a new LicenceText entry with the next stable id.
      if (!textIndex.has(canonical)) {
        texts.push({ id: texts.length + 1, text: canonical, usedBy: [] });
        textIndex.set(canonical, texts.length);
      }

      // Look up (or have just created) the stable id for this canonicalised text.
      const id = textIndex.get(canonical);

      // Record the id on the component only once per component to avoid duplicate entries in its textIds list.
      if (!textIds.includes(id)) {
        textIds.push(id);
        // Name this component under the text once, the first time the component uses it.
        texts[id - 1].usedBy.push(`${component.name} ${component.version}`.trim());
      } else {
        // The id is already recorded for this component: it is already listed under the text.
      }
    }

    // Attach the resolved licence-text ids onto each sorted component for downstream rendering.
    component.textIds = textIds;
  }

  return { components: sorted, texts };
}

/**
 * Fills in licence texts for components that ship none, from the upstream copies kept in scripts/licence-overrides.
 * @purpose Uses an override only when a component has no licence file of its own, and reports what is still missing.
 * @inputs components - Collected Component objects; overrideTexts - Map from package name to its upstream licence texts.
 * @outputs { components, used, missing } - Components with overrides applied (flagged fromOverride), the sorted
 *   override names that were applied, and `name version` of every component that still has no licence text.
 * @dataflow Components + override map -> per-component choice of shipped texts, override texts or nothing -> result.
 * @controlflow One pass: shipped texts win; otherwise an override by name; otherwise the component is reported missing.
 */
export function applyOverrides(components, overrideTexts) {
  const used = new Set();
  const missing = [];
  const result = components.map((component) => {
    // A component's own licence file always wins over an upstream copy.
    if (component.texts.length > 0) {
      return component;
    } else if (overrideTexts.has(component.name)) {
      // No licence file shipped, but an upstream copy is on record: use it and say so in the listing.
      used.add(component.name);
      return { ...component, texts: overrideTexts.get(component.name), fromOverride: true };
    } else {
      // Nothing shipped and nothing on record: report it so the run can fail loudly.
      missing.push(`${component.name} ${component.version}`.trim());
      return component;
    }
  });
  return { components: result, used: [...used].sort(), missing };
}

/**
 * Serialises a grouped result into the final THIRD-PARTY-NOTICES.txt document string.
 * @purpose Renders the human-readable notice with a header, per-component index lines, and one printed copy of each distinct licence text.
 * @inputs grouped - The Grouped object produced by groupByText.
 * @outputs string - The complete notices document ending in a single trailing newline.
 * @dataflow Grouped components + texts -> assemble section headers and detail lines -> join with newlines -> append final newline.
 * @controlflow Emit header block -> component index section -> one text section per LicenceText; no branching within line emission.
 */
export function renderNotices(grouped) {
  // Section divider used to visually separate every major part of the document.
  const RULE = '='.repeat(78);

  // Assemble the header block describing K-Doc's own licensing and how the file is organised.
  const lines = [
    'K-Doc third-party notices',
    '',
    'K-Doc is licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE).',
    'It bundles the third-party components listed below, each under its own licence.',
    'Each licence text is printed once, followed by the components that use it.',
    'Generated by scripts/third-party-notices.mjs; do not edit by hand.',
    '',
    RULE,
  ];

  // Emit the component index section header with the total number of shipped components.
  lines.push(`Components (${grouped.components.length})`, RULE);

  // One line per component summarising its identity and which licence text ids it references.
  for (const component of grouped.components) {
    const versionPart = component.version ? ' ' + component.version : '';
    const detailPart = component.textIds.length
      ? ` -- text ${component.textIds.join(', ')}`
      : ' -- no licence file shipped';

    // Build the summary line: name, optional version, source tag, short licence, and its text-id reference.
    // A licence copied from upstream is marked, so a reader knows it did not come with the package.
    const originPart = component.fromOverride ? ' (licence copied from upstream)' : '';
    lines.push(`${component.name}${versionPart} [${component.source}] ${component.license}${detailPart}${originPart}`);
  }

  // Emit a dedicated section for each distinct licence text with its consumers and the full canonical body.
  for (const entry of grouped.texts) {
    lines.push(RULE, `Licence text ${entry.id}`, `Used by: ${entry.usedBy.join(', ')}`, RULE, '', entry.text, '');
  }

  // Join all assembled lines with newlines and terminate the document with a single trailing newline.
  // The last text block ends with a blank line; drop it so the file ends with exactly one newline.
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

/**
 * Reads every recognised licence file in a directory, returning their bodies sorted by name.
 * @purpose Collects on-disk licence documents for a package or crate so they can be grouped and rendered.
 * @inputs dir - Directory path to scan for licence files (may not exist).
 * @outputs string[] - The UTF-8 contents of each recognised licence file, in sorted filename order.
 * @dataflow Directory -> list files -> filter by isLicenceFileName -> read each body -> return ordered text array.
 * @controlflow Return [] when dir missing -> else enumerate, sort names, and read each matching file; no branching during reads.
 */
function readLicenceTexts(dir) {
  // If the directory does not exist there are no licence files to collect: return an empty list early.
  if (!existsSync(dir)) {
    return [];
  } else {
    // The directory exists: enumerate its entries and select recognised licence files.
  }

  const names = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isLicenceFileName(entry.name))
    .map(entry => entry.name)
    .sort();

  // Read each recognised licence file body in sorted filename order so output stays deterministic.
  return names.map(name => readFileSync(join(dir, name), 'utf8'));
}

/**
 * Executes a shell command capturing stdout while tolerating non-zero exits that still print output.
 * @purpose Runs npm ls / cargo metadata and returns captured stdout even when the process exits non-zero for benign reasons.
 * @inputs command - The shell command string to execute; cwd - Working directory in which to run it (optional).
 * @outputs string - Captured standard output of the command as a UTF-8 string.
 * @dataflow Command + cwd -> execSync capture -> on failure prefer stdout if present -> return or rethrow.
 * @controlflow Run command -> on success return stdout -> on failure inspect stdout and either return it or rethrow.
 */
function run(command, cwd) {
  try {
    // Execute the command capturing stdout; stderr is piped but not returned so noise does not pollute output.
    return execSync(command, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // npm ls exits non-zero for extraneous packages yet still prints the dependency tree; prefer that stdout when available.
    if (typeof error.stdout === 'string' && error.stdout !== '') {
      return error.stdout;
    } else {
      // No usable stdout was captured: propagate the original failure so callers observe the real cause.
      throw error;
    }
  }
}

/**
 * Enumerates shipped npm workspace dependencies as components with their licence texts.
 * @purpose Parses `npm ls` output to enumerate installed runtime packages across K-Doc workspaces and reads each one's licence files.
 * @inputs repoRoot - Absolute path to the repository root containing the npm workspaces.
 * @outputs Component[] - One component per unique non-workspace dependency, with source 'npm'.
 * @dataflow npm ls parseable output -> unique directory lines -> read package.json + licence texts -> build components.
 * @controlflow Run npm ls -> split into dirs -> skip workspace/k-doc roots -> dedupe by name@version -> assemble each component.
 */
function npmComponents(repoRoot) {
  // Query the dependency tree for all three K-Doc workspaces, omitting dev dependencies and including transitive packages.
  const output = run(
    'npm ls --omit=dev --all --parseable --workspace @k-doc/app --workspace @k-doc/editor --workspace @k-doc/core --workspace @k-doc/config',
    repoRoot);

  // Split the parseable tree into unique, non-empty directory lines representing installed packages.
  const dirs = [...new Set(output.split('\n').map(line => line.trim()).filter(line => line !== ''))];
  const seenNames = new Set();
  const components = [];

  for (const dir of dirs) {
    // Skip directories without a package.json since they cannot describe a component.
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      continue;
    } else {
      // The directory contains a package.json: parse it to inspect the dependency identity.
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const name = String(pkg.name ?? '');

    // Skip empty names and K-Doc's own packages; only third-party dependencies belong in the notices file.
    if (name === '' || name === 'k-doc' || name.startsWith('@k-doc/')) {
      continue;
    } else {
      // The dependency is a genuine third-party package: proceed to include it below.
    }

    // Dedupe by fully-qualified "name@version" so the same package reachable via multiple paths appears once.
    const key = `${name}@${pkg.version}`;
    if (seenNames.has(key)) {
      continue;
    } else {
      seenNames.add(key);
    }

    // Assemble the component with its resolved licence string and any shipped licence texts from disk.
    components.push({
      name,
      version: String(pkg.version ?? ''),
      license: licenceOfPackageJson(pkg),
      source: 'npm',
      texts: readLicenceTexts(dir),
    });
  }

  return components;
}

/**
 * Enumerates shipped Rust crates from cargo metadata as components with their licence texts.
 * @purpose Parses `cargo metadata` output to list every runtime crate and reads each one's licence files alongside its manifest.
 * @inputs repoRoot - Absolute path to the repository root containing the src-tauri Cargo workspace.
 * @outputs Component[] - One component per shipped crate, with source 'crate'.
 * @dataflow cargo metadata JSON -> filter ids via BFS -> read package.json fields + licence texts -> build components.
 * @controlflow Run cargo metadata -> compute shipped ids -> map id to package -> assemble each component; no branching during assembly.
 */
function crateComponents(repoRoot) {
  // Request the full dependency graph for a concrete target platform so feature-gated crates resolve deterministically.
  const rawMetadata = run('cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml', repoRoot);

  // Parse the JSON document describing every package and its dependency edges in the workspace.
  const metadata = JSON.parse(rawMetadata);

  // Compute the set of runtime crate ids reachable from the k-doc workspace root, excluding build/dev-only tooling.
  const shippedIds = shippedCrateIds(metadata, 'k-doc');
  const byId = new Map(metadata.packages.map(p => [p.id, p]));

  // Build one component per shipped crate in id order, reading its licence text from the manifest directory.
  return shippedIds.map(id => {
    const pkg = byId.get(id);

    // Skip ids that resolved to no package defensively; they should not occur for a well-formed metadata document.
    if (!pkg) {
      return null;
    } else {
      // The package exists: derive its licence identifier and read any shipped licence texts from disk.
    }

    const license = pkg.license ?? (pkg.license_file ? 'see licence file' : 'UNKNOWN');

    return {
      name: pkg.name,
      version: pkg.version,
      license,
      source: 'crate',
      texts: readLicenceTexts(dirname(pkg.manifest_path)),
    };
  }).filter(entry => entry !== null);
}

/**
 * Enumerates bundled Hunspell dictionaries as components with their licence texts.
 * @purpose Lists each language dictionary subdirectory under packages/app/public/dictionaries and reads its licence files.
 * @inputs repoRoot - Absolute path to the repository root containing the app public dictionaries directory.
 * @outputs Component[] - One component per dictionary, with source 'dictionary'.
 * @dataflow Dictionaries base dir -> list sorted language dirs -> read each one's licence texts -> build components.
 * @controlflow Return [] when base missing -> else enumerate sorted subdirectories and assemble a component for each; no branching during assembly.
 */
function dictionaryComponents(repoRoot) {
  // Resolve the on-disk location of the bundled Hunspell dictionaries shipped with the app package.
  const base = join(repoRoot, 'packages', 'app', 'public', 'dictionaries');

  // If no dictionaries directory exists yet there is nothing to enumerate: return an empty list early.
  if (!existsSync(base)) {
    return [];
  } else {
    // The dictionaries directory exists: enumerate its language subdirectories in sorted order.
  }

  const languages = readdirSync(base).sort();

  // Build one component per dictionary, reading any licence texts shipped inside that language's directory.
  return languages.map(lang => ({
    name: `${lang} Hunspell dictionary`,
    version: '',
    license: 'see licence text',
    source: 'dictionary',
    texts: readLicenceTexts(join(base, lang)),
  }));
}

/**
 * Loads the upstream licence texts kept for packages that ship none.
 * @purpose Reads scripts/licence-overrides/sources.json and the licence files in each folder it names.
 * @inputs repoRoot - Absolute path to the repository root.
 * @outputs Map<string, string[]> - Package name to its licence texts.
 * @dataflow sources.json packages map -> folder -> readLicenceTexts -> Map entry.
 * @controlflow Return an empty map when there is no manifest; throw when a named folder holds no licence file.
 */
function loadOverrides(repoRoot) {
  const base = join(repoRoot, 'scripts', 'licence-overrides');
  const manifestPath = join(base, 'sources.json');
  // Without a manifest there are no overrides to apply.
  if (!existsSync(manifestPath)) {
    return new Map();
  } else {
    // A manifest exists: read every package it maps to a folder.
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const overrides = new Map();
  for (const [name, folder] of Object.entries(manifest.packages ?? {})) {
    const texts = readLicenceTexts(join(base, String(folder)));
    // An empty folder would silently hide a gap, so it is an error rather than a skip.
    if (texts.length === 0) {
      throw new Error(`licence override folder "${folder}" for ${name} holds no licence file`);
    } else {
      overrides.set(name, texts);
    }
  }
  return overrides;
}

/**
 * Orchestrates collection, grouping, rendering, and writing of the third-party notices document.
 * @purpose Collects all shipped components across npm/crate/dictionary sources, groups their licence texts, renders them, and writes the output file.
 * @inputs None (resolves the repository root from this script's own location).
 * @outputs void - Writes packages/app/public/THIRD-PARTY-NOTICES.txt and logs a summary plus any components lacking shipped licences.
 * @dataflow repoRoot -> npm/crate/dictionary components -> groupByText deduplication -> renderNotices serialisation -> write to disk.
 * @controlflow Resolve root -> collect three component sources -> merge -> group -> render -> mkdir target dir -> write file -> log summary and warnings.
 */
function main() {
  // Resolve the repository root relative to this script's own location rather than process.cwd().
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  // Collect components from every source; order is irrelevant because groupByText sorts deterministically.
  const components = [...npmComponents(repoRoot), ...crateComponents(repoRoot), ...dictionaryComponents(repoRoot)];

  // Group by canonicalised licence text and render the final document in one pass over the merged component list.
  // Fill in upstream licence texts for packages that ship none, then group and render.
  const overrides = loadOverrides(repoRoot);
  const applied = applyOverrides(components, overrides);
  const grouped = groupByText(applied.components);
  const text = renderNotices(grouped);

  // Resolve the output path inside the app package's public directory, mirroring where dictionaries are served from.
  const outPath = join(repoRoot, 'packages', 'app', 'public', 'THIRD-PARTY-NOTICES.txt');

  // Ensure the target directory exists before writing so a fresh clone without prior builds still succeeds.
  mkdirSync(dirname(outPath), { recursive: true });

  // Write the rendered document as UTF-8, overwriting any previous generation of the file.
  writeFileSync(outPath, text, 'utf8');

  // Log a concise summary line with component and distinct-text counts for CI visibility.
  console.log(`${outPath} (${components.length} components, ${grouped.texts.length} licence texts)`);

  // An override no shipped package needs any more is stale: say so, so it can be removed.
  for (const name of [...overrides.keys()].filter((key) => !applied.used.includes(key)).sort()) {
    console.warn(`unused licence override: ${name} (remove it from scripts/licence-overrides/sources.json)`);
  }

  // A shipped component with no licence text at all fails the run, and so the release build that runs it.
  if (applied.missing.length > 0) {
    console.error(`No licence text for ${applied.missing.length} shipped component(s):`);
    for (const entry of applied.missing) {
      console.error(`  ${entry}`);
    }
    console.error('Add the upstream licence to scripts/licence-overrides and list it in sources.json.');
    process.exitCode = 1;
  } else {
    // Every shipped component has its licence text.
  }
}

// Execute main only when this module is run directly; importing it from tests must remain side-effect free.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
