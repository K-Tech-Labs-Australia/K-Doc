/**
 * @file wild.spec.ts
 * @purpose Wild-corpus test suite verifying parser robustness, bounded serialization convergence, and source text preservation for @k-doc/core over real-world Markdown files.
 *
 *   Motivation: The golden corpus in test/corpus/ tests K-Doc's canonical formatting and asserts byte
 *   identity. For non-canonical real-world input, the suite previously asserted that serialization
 *   achieves a fixed point in a single pass: serialize(parse(serialize(parse(x)))) === serialize(parse(x)).
 *   However, real-world testing demonstrated that this single-pass assumption is too strict. Under
 *   CommonMark rules, up to three leading spaces on paragraph continuation lines are treated as
 *   insignificant, and remark normalizes up to three spaces per serialization pass. For example, in
 *   postcss/README.md, a multi-line <img> tag with continuation lines indented by five spaces requires
 *   multiple passes to settle: pass one reduces indentation to two spaces, pass two reduces it to zero,
 *   and pass three reaches stability. The serializer converges, but does so over multiple iterations.
 *
 *   Therefore, the meaningful correctness contract is bounded convergence: serializing repeatedly must
 *   reach a fixed point within a bounded number of passes. A serializer that never settles would corrupt
 *   a document incrementally on every save, which is a critical failure this suite is designed to prevent.
 *   Byte identity against original source is intentionally not asserted here; that is verified by the
 *   golden corpus, and for non-canonical input will be preserved once the incremental serializer lands in
 *   Phase 0b without re-emitting untouched regions. The suite now also asserts the FR-4.2 incremental
 *   contract — an unchanged save is byte-identical — across every document it finds.
 *
 * @inputs Real-world Markdown documents discovered in the repository's node_modules directory, and synthetic regression test strings.
 * @outputs Vitest test execution results asserting parser robustness (never throws), bounded serialization convergence, fixed-point stability, and source text preservation.
 * @functions
 *   - findWildDocuments: Resolves the repository node_modules directory and collects wild Markdown document fixtures up to a limit.
 *   - settle: Repeatedly parses and serializes Markdown text until output reaches a fixed point or a maximum pass limit is reached.
 * @dataflow Markdown source text / node_modules *.md files -> findWildDocuments -> parseMarkdown -> serializeIncremental / serializeDocument -> iterative settle loop -> convergence pass count and fixed-point verification.
 * @controlflow Discover node_modules directory -> scan *.md files up to WILD_LIMIT -> guard test for MIN_WILD_DOCUMENTS -> parameterized per-document tests: (e) FR-4.2 untouched incremental save is byte-identical, (a) parse does not throw, (b) serialization settles within MAX_SETTLE_PASSES, (c) settled output is a true fixed point, (d) source text preservation holds -> isolated convergence regression test for multi-line indented HTML.
 * @version 3
 * @date 2026-09-04
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument, serializeIncremental } from '../src/index.js';

/** Maximum number of wild Markdown documents to collect to bound test execution runtime. */
const WILD_LIMIT = 400;

/** Minimum number of wild Markdown documents required to guard against a misconfigured environment silently testing nothing. */
const MIN_WILD_DOCUMENTS = 20;

/** Maximum file size in bytes (512 KiB) for wild Markdown documents to bound test execution time. */
const MAX_FILE_SIZE_BYTES = 512 * 1024;

/**
 * Maximum number of parse-and-serialize passes permitted before declaring divergence.
 * The bound only needs to exceed the number of passes real documents require (the deepest observed case
 * settles in three passes); its purpose is to distinguish "converges slowly because insignificant whitespace
 * is being normalised" from "never converges", rather than being a tight limit.
 */
const MAX_SETTLE_PASSES = 8;

interface WildDocument {
  readonly name: string;
  readonly source: string;
}

/**
 * Traverses the repository's node_modules directory to discover real-world Markdown documents.
 *
 * @purpose Resolves the repository node_modules directory and collects wild Markdown document fixtures up to a limit.
 * @inputs limit - Maximum number of Markdown file paths to collect from the directory tree.
 * @outputs ReadonlyArray<WildDocument> - Array of wild document objects containing relative path names and file source text.
 * @dataflow import.meta.url -> walk up to node_modules -> recursive directory scan -> filter .md files and size -> sort -> readFileSync -> WildDocument array.
 * @controlflow Walk up filesystem tree to find node_modules -> recursively collect .md paths up to limit -> sort paths deterministically -> filter by size <= 512 KiB -> read UTF-8 contents with try/catch -> return collected documents.
 */
function findWildDocuments(limit: number): ReadonlyArray<WildDocument> {
  let currentDir = fileURLToPath(new URL('.', import.meta.url));
  let nodeModulesDir: string | null = null;

  // Walk up from current directory to locate repository root node_modules directory.
  while (true) {
    const candidate = join(currentDir, 'node_modules');

    // Check if node_modules exists in current directory.
    if (existsSync(candidate)) {
      // Record it and keep walking rather than stopping here. This is an npm workspace, so every package
      // has a node_modules of its own holding nothing but symlinks, while the real dependencies -- and the
      // Markdown documents this corpus is built from -- are hoisted to the one at the repository root.
      // Taking the first match found the package's own empty directory and the corpus came back empty.
      nodeModulesDir = candidate;
    } else {
      // node_modules not in current directory; check parent directory.
    }

    const parentDir = dirname(currentDir);

    // Check if filesystem root has been reached (parent is identical to current directory).
    if (parentDir === currentDir) {
      // Reached filesystem root without finding node_modules.
      break;
    } else {
      // Move up to parent directory for next iteration.
      currentDir = parentDir;
    }
  }

  // The loop above ran to the filesystem root, so this holds the outermost node_modules -- the hoisted one.
  // Check if a node_modules directory was successfully found.
  if (nodeModulesDir === null) {
    // No node_modules directory found; return empty array.
    return [];
  } else {
    // node_modules directory located; proceed to scan for Markdown documents.
  }

  const collectedPaths: string[] = [];

  // Recursive traversal function to scan directory tree for Markdown files.
  const walk = (dir: string): void => {
    // Check if the collected document limit has already been reached.
    if (collectedPaths.length >= limit) {
      // Limit reached; terminate traversal early.
      return;
    } else {
      // Limit not reached; continue scanning directory.
    }

    const entries = readdirSync(dir, { withFileTypes: true });

    // Sort directory entries deterministically for cross-platform consistency.
    entries.sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name));

    for (const entry of entries) {
      // Check if limit has been reached during iteration over entries.
      if (collectedPaths.length >= limit) {
        // Limit reached; break from loop.
        break;
      } else {
        // Continue processing directory entry.
      }

      // Check if entry is a subdirectory.
      if (entry.isDirectory()) {
        // Check if directory should be skipped (nested node_modules, .bin, or hidden dot-directories).
        if (
          entry.name === 'node_modules' ||
          entry.name === '.bin' ||
          entry.name.startsWith('.')
        ) {
          // Skip nested node_modules, .bin, and hidden directories.
          continue;
        } else {
          // Recurse into valid subdirectory.
          walk(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        // Check if file has a .md extension (case-insensitive).
        if (entry.name.toLowerCase().endsWith('.md')) {
          // Add matching Markdown file path to collected list.
          collectedPaths.push(join(dir, entry.name));
        } else {
          // Skip non-markdown file.
        }
      } else {
        // Skip other filesystem entity types (sockets, FIFOs, etc.).
      }
    }
  };

  walk(nodeModulesDir);

  // Sort collected paths lexicographically before reading for deterministic ordering.
  collectedPaths.sort((a: string, b: string): number => a.localeCompare(b));

  const documents: WildDocument[] = [];

  for (const filePath of collectedPaths) {
    const stats = statSync(filePath);

    // Check if file size exceeds the 512 KiB maximum threshold.
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      // File exceeds size limit; skip reading to prevent large changelogs from slowing execution.
      continue;
    } else {
      // File is within size threshold; proceed to read.
    }

    // Convert relative path with forward slashes for cross-platform test name stability.
    const relativeName = relative(nodeModulesDir, filePath).replaceAll('\\', '/');
    let source: string;

    try {
      // Tolerate permission and encoding failures on real-world third-party files we do not control.
      source = readFileSync(filePath, 'utf8');
    } catch {
      // Skip unreadable files (e.g. broken symlinks, permission denied, or encoding issues).
      continue;
    }

    documents.push({
      name: relativeName,
      source,
    });
  }

  return documents;
}

interface SettleResult {
  readonly text: string;
  readonly passes: number;
}

/**
 * Repeatedly parses and serializes Markdown text until output reaches a fixed point or max passes is reached.
 *
 * @purpose Iteratively applies serialization to a Markdown document until convergence or the iteration cap is reached.
 * @inputs
 *   - source - Initial Markdown source text string.
 *   - maxPasses - Maximum number of parse-and-serialize passes permitted.
 * @outputs SettleResult - Object containing the final serialized text and the total number of passes performed.
 * @dataflow source string -> parseMarkdown -> serializeDocument -> compare against previous text -> repeat until fixed point or maxPasses -> SettleResult.
 * @controlflow Initialize current text and pass counter -> loop while pass counter is less than maxPasses -> increment pass counter -> serialize parsed current text -> check if serialized output matches input -> return on convergence -> update current text -> return last produced text and pass count if cap is reached.
 */
function settle(source: string, maxPasses: number): SettleResult {
  let current = source;
  let passes = 0;

  // Iterate parse-and-serialize passes until the pass count reaches maxPasses or output stabilizes.
  while (passes < maxPasses) {
    passes += 1;
    const next = serializeDocument(parseMarkdown(current));

    // Check if the newly serialized output is identical to the current input (fixed point achieved).
    if (next === current) {
      // Convergence reached; return the stable text and total passes including the confirming pass.
      return {
        text: next,
        passes,
      };
    } else {
      // Document content changed; update current text for the next serialization iteration.
      current = next;
    }
  }

  // Maximum passes reached without achieving a fixed point; return the final produced text and iteration cap.
  return {
    text: current,
    passes,
  };
}

// Pins the exact convergence behavior discovered in the wild (such as postcss/README.md multi-line inline HTML)
// so that future regressions are caught deterministically without requiring third-party node_modules packages to be installed.
describe('convergence regression', () => {
  it('settles multi-line indented inline HTML within a bounded number of passes', () => {
    const source =
      '# PostCSS\n\n<img align="right" width="95" height="95"\n     alt="logo"\n     src="https://postcss.org/logo.svg">\n\nBody text.\n';

    const result = settle(source, MAX_SETTLE_PASSES);

    // Assert that the multi-line indented HTML converges within the permitted pass bound.
    expect(result.passes).toBeLessThan(MAX_SETTLE_PASSES);

    // Assert that insignificant leading whitespace on continuation lines has been fully normalized away upon settling.
    expect(result.text).toContain('\nalt="logo"');

    // Assert that re-serializing the settled text produces the identical fixed-point text.
    const again = serializeDocument(parseMarkdown(result.text));
    expect(again).toBe(result.text);
  });

  it('an unchanged incremental save is byte-identical on non-canonical input', () => {
    const source =
      'Title\n=====\n\n<img align="right"\n     alt="logo"\n     src="x.png">\n\n*   Item one\n*   Item two\n\nBody text.\n';

    const doc = parseMarkdown(source);
    const untouched = serializeIncremental(doc, doc.root);

    // Assert that an unchanged incremental save preserves non-canonical formatting byte-for-byte.
    expect(untouched.text).toBe(source);
    expect(untouched.reusedBytes).toBe(untouched.totalBytes);

    // Deliberately assert that the whole-document serializer does NOT produce byte-identical output on this input.
    // This pins the difference between the two serializers: if the whole-document path ever became byte-faithful,
    // this test would fail loudly to inform us that the incremental path may no longer be needed for this case,
    // rather than quietly passing.
    expect(serializeDocument(doc)).not.toBe(source);
  });
});

describe('wild corpus', () => {
  const documents = findWildDocuments(WILD_LIMIT);

  it('finds enough real-world documents', () => {
    // Assert that the collected wild document count meets or exceeds the minimum threshold.
    expect(documents.length >= MIN_WILD_DOCUMENTS).toBe(true);
  });

  // Real-world files include very large changelogs; on a slow CI runner one can take several seconds,
  // so each gets 30 s rather than Vitest's 5 s default.
  for (const document of documents) {
    it(document.name, { timeout: 30_000 }, () => {
      const { source } = document;

      // e. FR-4.2, the contract that matters most: opening a document and saving it WITHOUT editing
      // must return the file byte-for-byte. The whole-document serializer cannot promise this for
      // non-canonical input — it normalises insignificant whitespace, list markers and emphasis
      // characters — which is precisely why the incremental path exists. Here it is asserted against
      // real Markdown written by other people and other tools, not against fixtures written to suit us.
      const doc = parseMarkdown(source);
      const untouched = serializeIncremental(doc, doc.root);
      expect(untouched.text).toBe(source);
      expect(untouched.reusedBytes).toBe(untouched.totalBytes);

      // a. Parser robustness: parseMarkdown never throws regardless of input.
      expect(() => parseMarkdown(source)).not.toThrow();

      // b. Bounded convergence: repeatedly serializing settles at a fixed point within MAX_SETTLE_PASSES.
      // Reaching the cap indicates the document never stopped changing, which is the serializer divergence this suite exists to catch.
      const result = settle(source, MAX_SETTLE_PASSES);
      expect(result.passes).toBeLessThan(MAX_SETTLE_PASSES);

      // c. Fixed-point re-confirmation: serialize the settled text once more to confirm it is a true fixed point rather than an artifact of loop termination.
      const again = serializeDocument(parseMarkdown(result.text));
      expect(again).toBe(result.text);

      // d. Text preservation: parseMarkdown(source).text strictly equals source.
      expect(doc.text).toBe(source);
    });
  }
});
