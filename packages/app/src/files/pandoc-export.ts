/**
 * @file pandoc-export.ts
 * @purpose Implements FR-13.7: exposes the webview's side of exporting documents through Pandoc by wrapping two Tauri host commands (pandoc_version and pandoc_export), reporting whether Pandoc is reachable, and computing a save-dialog file name for each export format.
 *   Why this exists:
 *   Exports are produced by an external program — Pandoc — that only runs inside the desktop app where it can be found on PATH. The webview must ask the host how old Pandoc is and hand it markdown to convert, without ever assuming the tool is present or throwing when it is not.
 * @inputs A Window object used to detect whether the Tauri desktop backend is present (as theme-files.ts does), plus a document path and format for name computation.
 * @outputs PandocExport: an availability flag, a version() call returning '' when absent, and a write() that converts markdown; pandocFileName(): a suggested save-dialog file name carrying the format's extension.
 * @functions
 *   - createPandocExport: Builds the PandocExport facade from a Window, detecting the desktop app once so only shipped tooling is reachable inside it.
 *   - version: Returns the first line of Pandoc's banner, or an empty string when Pandoc cannot be queried — never throwing for a missing optional tool.
 *   - write: Sends markdown to the host for conversion at path in the chosen format, refusing outside the desktop app.
 *   - pandocFileName: Derives a save-dialog file name from a document's own base name plus the format extension, or 'document' when none exists yet.
 * @dataflow Window -> availability flag -> invoke('pandoc_version') guarded by availability; write forwards { markdown, format, path } to invoke('pandoc_export'); documentPath + format -> split/strip/pad -> `${base}.${extension}`.
 * @controlflow Detect Tauri once -> return methods that guard on it (version swallows all errors into '', write throws when unavailable) and compute the file name from the last path segment with extension stripping.
 * @version 1
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';

/** Which output format an export is produced in, each mapping to a human name and file extension below. */
export type PandocFormat = 'latex' | 'epub';

/** What each format is called, and the extension its file carries. */
export const PANDOC_FORMAT_NAMES: Readonly<Record<PandocFormat, string>> = { latex: 'LaTeX', epub: 'EPUB' };
export const PANDOC_FORMAT_EXTENSIONS: Readonly<Record<PandocFormat, string>> = { latex: 'tex', epub: 'epub' };

/** The webview's handle on Pandoc export through the Tauri host (FR-13.7). */
export interface PandocExport {
  /** True in the desktop app, which is the only place a program on PATH can be run. */
  readonly available: boolean;
  /** The version Pandoc reports, or an empty string when it is not installed. */
  version(): Promise<string>;
  /** Writes the document to `path` in the chosen format. */
  write(markdown: string, format: PandocFormat, path: string): Promise<void>;
}

/**
 * Builds the PandocExport facade from a Window, detecting whether the Tauri desktop backend is present so that Pandoc — an external program only runnable inside it — is treated as absent outside.
 *
 * @purpose Implements FR-13.7: returns a handle whose version() never throws for a missing tool and whose write() refuses to run when there is no host to convert the document.
 * @inputs win - The window object; inspected for Tauri internals (exactly as theme-files.ts does) to decide whether Pandoc can be reached.
 * @outputs PandocExport - An availability flag, a version() resolving to '' on any failure, and a write() that forwards markdown/format/path to the host.
 * @dataflow win -> available flag -> invoke('pandoc_version') guarded by availability; write forwards { markdown, format, path } to invoke('pandoc_export').
 * @controlflow Compute availability once from __TAURI_INTERNALS__, then return methods that guard on it: version returns '' when unavailable or on any error, and write throws before invoking the host.
 */
export function createPandocExport(win: Window): PandocExport {
  // Outside the desktop app there is no PATH to run Pandoc from, so treat it as absent (mirrors theme-files.ts).
  const available = '__TAURI_INTERNALS__' in (win as unknown as Record<string, unknown>);

  return {
    /** True in the desktop app, which is the only place a program on PATH can be run. */
    available,
    /**
     * Returns the first line of Pandoc's banner, or an empty string when Pandoc is not installed.
     *
     * @purpose Implements version(): reports how old Pandoc is without ever throwing — a missing optional tool is not a caller-facing error (FR-13.7).
     * @inputs none - Relies on the `available` flag captured by createPandocExport.
     * @outputs Promise<string> - The banner's first line, or '' when unavailable or when the query fails for any reason.
     * @dataflow available -> invoke('pandoc_version') -> string; unavailability or error -> ''.
     * @controlflow Return '' immediately when there is no desktop app, else attempt the host call and collapse every failure into an empty string.
     */
    async version(): Promise<string> {
      // Check whether the desktop app is present to run Pandoc at all.
      if (!available) {
        // Branch: No Tauri environment; Pandoc cannot be queried, so report it as absent without erroring.
        return '';
      } else {
        // Branch: The desktop app is present; proceed to query the banner below.
      }

      try {
        // Ask the host for the first line of Pandoc's version banner.
        return await invoke<string>('pandoc_version');
      } catch {
        // A tool that cannot be queried is treated as absent, not as an error to surface to the reader.
        return '';
      }
    },
    /**
     * Sends markdown to the host for conversion into `path` in the chosen format.
     *
     * @purpose Implements write(): converts the document through Pandoc at a caller-chosen path, refusing when there is no desktop app to run it (FR-13.7).
     * @inputs markdown - The source Markdown text to convert. format - The target PandocFormat ('latex' or 'epub'). path - The destination file path on the host filesystem.
     * @outputs Promise<void> - Resolves once the host has written the converted document, or rejects with an Error when there is no desktop app.
     * @dataflow available -> guard; then { markdown, format, path } -> invoke('pandoc_export') -> void on success.
     * @controlflow Throw immediately when Pandoc cannot run outside the app, else await the host conversion and let its result propagate.
     */
    async write(markdown: string, format: PandocFormat, path: string): Promise<void> {
      // Check whether the desktop app is present to run Pandoc on this machine.
      if (!available) {
        // Branch: No Tauri environment; conversion requires it, so refuse with a clear error rather than attempting an unreachable host call.
        throw new Error('Exporting through Pandoc requires the desktop app.');
      } else {
        // Branch: The desktop app is present; proceed to forward the export request below.
      }

      await invoke<void>('pandoc_export', { markdown, format, path });
    },
  };
}

/**
 * Derives a save-dialog file name from a document's own base name plus the target format's extension.
 *
 * @purpose Implements pandocFileName(): suggests `${documentBase}.${extension}` so a freshly exported file keeps its source identity while gaining the right suffix (FR-13.7).
 * @inputs documentPath - The current saved path of the document, whose base name is reused; falls back to 'document' when nothing has been saved yet. format - The target PandocFormat, supplying the extension via PANDOC_FORMAT_EXTENSIONS.
 * @outputs string - A suggested file name such as 'notes.tex' or 'report.epub', always carrying a non-empty base and the format's extension.
 * @dataflow documentPath -> split on / and \ -> last segment -> strip trailing .ext (when past index 0) -> base; PANDOC_FORMAT_EXTENSIONS[format] -> `${base}.${extension}`.
 * @controlflow Take the final path segment, trim any existing extension only when it is not part of a hidden leading dot, default an empty result to 'document', then append the format extension.
 */
export function pandocFileName(documentPath: string, format: PandocFormat): string {
  // Split on both Unix and Windows separators so either path style yields its final segment.
  const segments = documentPath.split(/[/\\]/);

  // The last element is the file name portion of whatever has been saved (or an empty string when nothing).
  let base: string = segments[segments.length - 1] ?? '';

  if (base === '') {
    // Branch: No segment at all; treat as unsaved and fall back to the generic default below.
    base = 'document';
  } else {
    // Branch: A file name exists; strip any existing extension before appending the format's own.
    const dotIndex = base.lastIndexOf('.');

    if (dotIndex > 0) {
      // The last dot sits past the first character, so it separates a real stem from an extension to drop.
      base = base.slice(0, dotIndex);
    } else {
      // Branch: No usable trailing extension (none, or a leading-dot-only name like '.gitignore'); keep the segment as-is.
    }

    // Stripping cannot empty the name: the dot had to sit past the first character for the slice above to run,
    // so at least that character survives. The empty case is the one handled above.
  }

  return `${base}.${PANDOC_FORMAT_EXTENSIONS[format]}`;
}
