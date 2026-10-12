/**
 * @file lint-controller.ts
 * @purpose Implements the controller behind document linting in the Problems panel (FR-12.7): it runs the core linter over a session snapshot, augments its findings with existence checks for local image links, and applies fix edits while tolerating a changed document.
 * @inputs A SessionSnapshot via problems(), a ProblemFix and buffer text via applyFix(), a mount/save signal via reset(), and LintControllerOptions providing the document path resolver, the host existence probe, redraw/error sinks, and the canProbe gate.
 * @outputs Problem descriptors of kind 'lint' via problems(); an edited string (or null) via applyFix(); resolved absolute image paths via resolveImagePath(); and a controller wired through createLintController().
 * @functions
 *   - resolveImagePath: Resolves a markdown image URL to an on-disk path relative to the document, or null when it cannot be.
 *   - findingToProblem: Maps a core LintFinding onto a 'lint' Problem, carrying its fix only when present.
 *   - createLintController: Builds the controller wiring the cache, probe gate, and linter into the four-method interface.
 *   - problems: Classifies local images against cached/in-flight answers, probes as needed, then maps lint findings to problems.
 *   - applyFix: Applies a fix's edits, treating an out-of-range failure as a stale fix reported via onError.
 *   - reset: Forgets cached image answers for a freshly mounted or saved document while keeping in-flight probes.
 *   - destroy: Marks the controller inert and clears all closure state; idempotent.
 *   - probe: (private) Asks the host which absolute paths exist and records each boolean answer, failing once per broken host.
 * @dataflow options.documentPath()/cache → resolveImagePath over localImages() → probe(host.exist) → cache → missingImageUrls into lintDocument alongside buildOutline anchor lookups → LintFinding[] → findingToProblem → Problem[].
 * @controlflow problems classifies each image (missing/probe/known) → batches a single probe when allowed → runs the linter with resolved anchors and missing images → maps to problems; applyFix edits or reports staleness; reset forgets answers; destroy tears down.
 * @version 1
 * @date 2026-09-14
 */

import { applyLintEdits, buildOutline, lintDocument, localImages, type LintFinding, type SessionSnapshot } from '@k-doc/core';
import { dirname, findHeadingBySlug, joinPath, safeDecode } from './link-target.js';
import type { Problem, ProblemFix } from './problems-panel.js';

export interface LintControllerOptions {
  /** The open document's path, or null when it has never been saved. */
  readonly documentPath: () => string | null;
  /** Asks the host which absolute paths are existing files; one boolean per path, in order. */
  readonly exist: (paths: readonly string[]) => Promise<readonly boolean[]>;
  /** Whether the host can be asked at all (false in a browser build). */
  readonly canProbe: () => boolean;
  /** Called when an answer about image files arrives, so the panel can redraw. */
  readonly onChange: () => void;
  /** Reports a failure the user should hear about. */
  readonly onError: (message: string) => void;
}

export interface LintController {
  /** The document's lint findings as problems, including image links resolved against cached existence answers. */
  problems(snapshot: SessionSnapshot): readonly Problem[];
  /** Applies a fix's edits to the current text, or returns null when it no longer applies. */
  applyFix(fix: ProblemFix, text: string): string | null;
  /** Forgets every answer about image files, for a newly mounted document or after a save. */
  reset(): void;
  /** Releases all closure state so the controller can be discarded; idempotent. */
  destroy(): void;
}

/**
 * @purpose Resolves a markdown image URL to an on-disk path relative to the document, or null when it cannot be resolved.
 * @inputs url — the raw href from an image reference, possibly with query/fragment and percent-encoding; documentPath — the owning document's path, or null for an untitled document.
 * @outputs string — the absolute on-disk path to resolve against, or null when the URL is empty, site-rooted, or unanchorable.
 * @dataflow url → strip query/fragment → safeDecode → classify (drive/UNC vs relative) → join with document folder.
 * @controlflow Empty decodes to null; drive/UNC returns verbatim; leading slash and null documentPath return null; else joinPath(dirname, decoded).
 */
export function resolveImagePath(url: string, documentPath: string | null): string | null {
  // Strip any query or fragment so only the bare path is resolved against disk.
  const bare = url.trim().split(/[?#]/)[0] ?? '';
  // Decode percent-escapes; safeDecode returns the input unchanged on failure rather than throwing.
  const decoded = safeDecode(bare);

  // An empty path resolves to nothing, so there is no file to probe for.
  if (decoded === '') {
    return null;
  } else {
    // A non-empty path continues to be classified below.
  }

  // A drive letter (C:\) or UNC (\\server\share) is already absolute, so use it verbatim without joining the folder.
  if (/^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith('\\\\')) {
    return decoded;
  } else {
    // Not a drive/UNC path: keep resolving against the document's folder below.
  }

  // A leading slash denotes site root, which has no on-disk meaning in this resolver.
  if (decoded.startsWith('/')) {
    return null;
  } else {
    // A relative or bare filename continues to resolve below.
  }

  // An untitled document has no folder to anchor a relative path against.
  if (documentPath === null) {
    return null;
  } else {
    // The document lives on disk: join its folder with the decoded relative path.
  }

  return joinPath(dirname(documentPath), decoded);
}

/**
 * @purpose Maps a core LintFinding onto a 'lint' Problem descriptor, carrying its fix only when the finding offers one.
 * @inputs finding — a LintFinding with rule/label/message and byte offsets, plus an optional fix.
 * @outputs Problem — a kind 'lint' problem indexed by the finding's from/to, with an attached fix when present.
 * @dataflow finding.label/message/from/to → base Problem; finding.fix → conditional spread of its label and edits.
 * @controlflow Build the read-only base object, then conditionally spread in the fix only when fixing is not null.
 */
export function findingToProblem(finding: LintFinding): Problem {
  // A lint finding carries its own label and message; map them onto the panel's generic descriptor first.
  const base: Problem = {
    kind: 'lint',
    label: finding.label,
    detail: finding.message,
    from: finding.from,
    to: finding.to,
  };

  // Spread the fix in only when present; an empty object literal leaves `fix` absent for read-only findings.
  return { ...base, ...(finding.fix !== null ? { fix: { label: finding.fix.label, edits: finding.fix.edits } } : {}) };
}

/**
 * @purpose Builds the document-linting controller that ties a session's linter findings to live image-existence checks and safe fix application.
 * @inputs options — LintControllerOptions providing the path resolver, host existence probe, redraw/error sinks, and canProbe gate.
 * @outputs LintController — problems/applyFix/reset/destroy wired to the closure state; probe() is a private helper not exposed on the interface.
 * @dataflow options.documentPath()/cache → resolveImagePath over localImages() → probe(host.exist) → cache → lintDocument(missingImageUrls, hasAnchor) → findingToProblem → Problem[].
 * @controlflow Declare closure state (cache/pending/probeFailed/destroyed) → define private probe → return the four-method controller.
 * @concurrency Runs on the webview's single thread; a probe answer can arrive after a document switch, so answers are keyed by absolute path in `cache`, never by document identity.
 */
export function createLintController(options: LintControllerOptions): LintController {
  // Answers about which image paths exist, keyed by absolute path so an answer survives a document switch rather than tracking a document identity.
  const cache = new Map<string, boolean>();
  // Absolute paths whose existence is currently being probed, to avoid duplicate in-flight questions for the same path.
  const pending = new Set<string>();
  // Flips once the host fails a probe, so a broken host is reported once rather than on every subsequent keystroke.
  let probeFailed = false;
  // Set when the controller is destroyed; later probe answers are discarded silently instead of touching a detached panel.
  let destroyed = false;

  /**
   * @purpose Asks the host which absolute paths exist and records each boolean answer in cache for later image checks.
   * @inputs paths — the absolute paths to probe, one existence question per entry.
   * @outputs void; side effects populate `pending`/`cache`, call options.onChange() on success or options.onError() on failure.
   * @dataflow paths → options.exist(paths) → results[i] boolean → cache.set(path, answer); onChange fires after recording.
   * @controlflow Add each path to pending → fire the promise (voided) → on success drop from pending and record booleans then redraw; on failure forget paths, arm probeFailed, and report once unless destroyed.
   */
  function probe(paths: readonly string[]): void {
    // Record every path as in-flight so a second problems() pass does not re-ask before answers arrive.
    for (const path of paths) {
      pending.add(path);
    }

    // Fire the existence query and route success/failure to their handlers; void the promise since it is fire-and-forget.
    void options.exist(paths).then(
      (results: readonly boolean[]): void => {
        // A controller destroyed while awaiting the host must not record answers or redraw a detached panel.
        if (destroyed) {
          return;
        } else {
          // Controller still live: record each answer and ask the panel to redraw below.
        }

        paths.forEach((path, i): void => {
          pending.delete(path);
          const answer = results[i];

          // Trust only a genuine boolean from the host; anything else leaves the path open for re-probing later.
          if (typeof answer === 'boolean') {
            cache.set(path, answer);
          } else {
            // Non-boolean result: do not cache it so the same path can be probed again on a later pass.
          }
        });

        options.onChange();
      },
      (caught: unknown): void => {
        // Forget these paths regardless of outcome; a failed probe must not keep them in flight forever.
        paths.forEach((path): void => {
          pending.delete(path);
        });

        // Arm the one-shot guard so a broken host is reported once rather than on every subsequent keystroke.
        probeFailed = true;

        // A destroyed controller swallows the error rather than reporting it to a detached panel.
        if (destroyed) {
          return;
        } else {
          // Still live: tell the user once why missing images cannot be checked.
          options.onError(caught instanceof Error ? caught.message : String(caught));
        }
      },
    );
  }

  /**
   * @purpose Returns the document's lint findings as problems, augmenting image-link findings with cached existence answers.
   * @inputs snapshot — a SessionSnapshot whose document is both linted and scanned for local images.
   * @outputs readonly Problem[] — every LintFinding mapped to a 'lint' problem via findingToProblem.
   * @dataflow options.documentPath() + cache → resolveImagePath over localImages() → missing set + batched probe → lintDocument(missingImageUrls, hasAnchor) → findings.map(findingToProblem).
   * @controlflow Classify each image (missing/probe/known) → fire one probe when allowed → build outline for anchor lookups → run the linter → map to problems.
   */
  function problems(snapshot: SessionSnapshot): readonly Problem[] {
    // Resolve against the current document's folder; null means an untitled document with no folder to anchor against.
    const documentPath = options.documentPath();

    // Image URLs confirmed absent, passed to the linter so it can flag them as broken links.
    const missing = new Set<string>();
    // Absolute paths we still need to ask the host about before running the lint.
    const toProbe = new Set<string>();

    // Walk every local image reference and classify it against what we already know or are currently probing.
    for (const image of localImages(snapshot.document)) {
      // Resolve the URL relative to the document; a null result means skip this image entirely.
      const resolved = resolveImagePath(image.url, documentPath);

      if (resolved === null) {
        // The path cannot be resolved (empty, site-rooted, or untitled): skip it without probing.
        continue;
      } else {
        // A resolvable path: consult the cache below to classify it.
      }

      const known = cache.get(resolved);

      if (known === false) {
        // The host already said this file is absent, so flag it as a missing image now without re-probing.
        missing.add(image.url);
      } else if (known === undefined && !pending.has(resolved)) {
        // Unknown and not in flight: schedule an existence probe for it in the batch below.
        toProbe.add(resolved);
      } else {
        // Either confirmed present or already being asked; nothing to do this pass.
      }
    }

    // Batch a single existence probe only when there is something to ask, the host can be probed, and no prior failure has silenced us.
    if (toProbe.size > 0 && !probeFailed && !destroyed && options.canProbe()) {
      probe([...toProbe]);
    } else {
      // Nothing new to probe: run the lint against current knowledge without a round trip to the host.
    }

    // The outline backs anchor lookups so link findings can distinguish real headings from dead ones.
    const outline = buildOutline(snapshot.document);
    const findings = lintDocument(snapshot.document, {
      missingImageUrls: missing,
      hasAnchor: (slug): boolean => findHeadingBySlug(outline, slug) !== null,
    });

    return findings.map(findingToProblem);
  }

  /**
   * @purpose Applies a fix's edits to the current text, returning null and reporting staleness when the document changed.
   * @inputs fix — the ProblemFix whose edits should be applied; text — the exact buffer the finding was computed against.
   * @outputs string — the edited text on success, or null when applyLintEdits rejects an out-of-range/overlapping edit.
   * @dataflow fix.edits → applyLintEdits(text, edits) → new string; RangeError → onError + null; other errors rethrown.
   * @controlflow Try applying the edits; on RangeError report and return null; otherwise let unexpected errors propagate.
   */
  function applyFix(fix: ProblemFix, text: string): string | null {
    // Apply the edits, treating an out-of-range or overlapping edit as a stale fix rather than crashing the panel.
    try {
      return applyLintEdits(text, fix.edits);
    } catch (caught) {
      // A RangeError means the document changed since the finding was computed: report it and refuse to apply.
      if (caught instanceof RangeError) {
        options.onError('That fix no longer applies: the document has changed.');
        return null;
      } else {
        // Not a range failure: surface the unexpected error so it is not silently swallowed by the caller.
        throw caught;
      }
    }
  }

  /**
   * @purpose Forgets every cached image-existence answer for a freshly mounted or saved document, keeping in-flight probes intact.
   * @inputs void.
   * @outputs void.
   * @dataflow cache cleared; probeFailed reset so probing resumes; pending left untouched so an in-flight answer is not asked twice.
   * @controlflow Clear the cache and flip probeFailed off; never touch pending, which still tracks outstanding questions.
   */
  function reset(): void {
    // Forget cached answers for the newly mounted document while leaving in-flight probes to complete once.
    cache.clear();
    probeFailed = false;
  }

  /**
   * @purpose Marks the controller inert and clears all closure state so it can be discarded; safe to call more than once.
   * @inputs void.
   * @outputs void.
   * @dataflow destroyed set true (drops late probe answers) → cache and pending cleared.
   * @controlflow Set destroyed first, then clear both the answer cache and the in-flight set.
   */
  function destroy(): void {
    // Mark destroyed first so any late probe answer is discarded before we clear the sets it writes to.
    destroyed = true;
    cache.clear();
    pending.clear();
  }

  return {
    problems,
    applyFix,
    reset,
    destroy,
  };
}
