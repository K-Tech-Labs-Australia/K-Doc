/**
 * @file vault-save-sync.ts
 * @purpose Decides what a document save means for the vault index (requirement FR-6.12): whether the save is a no-op, requires re-indexing a held note, or triggers a full rescan.
 * @inputs The open vault root path; the path of the saved document; the list of paths currently held by the index.
 * @outputs A VaultSaveSync plan describing the indexing action to take ('none', 'update', or 'rescan').
 * @functions
 *   - planVaultSaveSync: Computes the VaultSaveSync plan for a single save event.
 * @dataflow (root, savedPath, notePaths) → null/guard checks → remapPath/samePath resolution → VaultSaveSync result.
 * @controlflow Evaluate guards in order (open/path presence → vault membership → held-note match → note extension); each guard assigns the plan and narrows subsequent branches; final result returned once.
 * @version 1
 * @date 2026-09-15
 */

import { remapPath } from '@k-doc/core';
import { samePath } from '../shell/navigation-controller.js';

/** The indexing action a save should trigger against the vault index (FR-6.12). */
export type VaultSaveSync =
  | { readonly kind: 'none' }
  | { readonly kind: 'update'; readonly path: string }
  | { readonly kind: 'rescan' };

/** Matches note file extensions; a save is only indexable as a new note when the extension matches. */
const NOTE_EXTENSION: RegExp = /\.(md|markdown|mdown)$/i;

/**
 * Plans the vault-index action for a single document save (FR-6.12).
 * @purpose Classifies a save as a no-op, a re-index of a held note, or a rescan trigger based on vault membership and index contents.
 * @inputs root - The open vault root path, or null when no vault is open. savedPath - The saved document's path, or null when the document has no path. notePaths - Paths currently held by the index.
 * @outputs VaultSaveSync - 'none' when the save needs no indexing action, 'update' carrying the index's canonical path for a held note, or 'rescan' to pick up a new note file.
 * @dataflow (root, savedPath, notePaths) → null/guard checks → remapPath/samePath resolution → assigned VaultSaveSync plan.
 * @controlflow Evaluate guards in order: open/path presence → vault membership → held-note match → note extension; each guard assigns the plan and narrows subsequent branches; returns the accumulated result.
 */
export function planVaultSaveSync(
  root: string | null,
  savedPath: string | null,
  notePaths: readonly string[],
): VaultSaveSync {
  // Begin assuming the save has no effect on the vault index.
  let result: VaultSaveSync = { kind: 'none' };

  // No vault open, or a document with no path: nothing to keep in step.
  if (root === null || savedPath === null) {
    // Neither an open vault nor a concrete save path exists; the plan stays 'none'.
    result = { kind: 'none' };
  } else {
    // Both root and savedPath are present; evaluate whether the save lands inside the vault.
    if (remapPath(savedPath, root, root) === null) {
      // Outside the vault: not indexed.
      result = { kind: 'none' };
    } else {
      // Inside the vault; decide between re-indexing a held note and rescanning for new notes.
      const held = notePaths.find((notePath) => samePath(notePath, savedPath));
      if (held !== undefined) {
        // A note the index holds: re-index it under the index's own spelling of its path.
        result = { kind: 'update', path: held };
      } else {
        // The index does not hold this file; whether it becomes a note depends on its extension.
        if (NOTE_EXTENSION.test(savedPath)) {
          // New, non-held note file: only a rescan can add it to the index.
          result = { kind: 'rescan' };
        } else {
          // Non-note file not held by the index: no indexing action required.
          result = { kind: 'none' };
        }
      }
    }
  }

  return result;
}
