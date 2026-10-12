/**
 * @file vault-save-sync.spec.ts
 * @purpose Verifies that planVaultSaveSync classifies a save event into none, update, or rescan actions for the vault index.
 * @inputs Saved file path, vault root, and current indexed note paths; assertions driven by Vitest.
 * @outputs Test results reporting pass/fail for each classification scenario.
 * @functions
 *   - describe: Groups all save-sync classification tests under a shared suite name.
 *   - it: Asserts an individual planVaultSaveSync behavior against its expected outcome.
 * @dataflow planVaultSaveSync(root, savedPath, notePaths) → returned plan object → expect().toEqual(expected).
 * @controlflow For each scenario, invoke the function with crafted inputs and compare the result kind and path to the expectation; Vitest fails the test on any mismatch.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { planVaultSaveSync } from '../src/files/vault-save-sync.js';

/**
 * @purpose Groups all tests for planVaultSaveSync vault-index classification behavior.
 * @inputs Saved path, vault root, and indexed note paths supplied per scenario.
 * @outputs Vitest pass/fail results for each classification assertion.
 * @functions describe: suite container; it: individual scenario assertions.
 * @dataflow Each scenario's inputs → planVaultSaveSync → expected plan via toEqual.
 * @controlflow Register six scenarios; Vitest executes them sequentially and reports outcomes.
 */
describe('what a save means for the vault index', (): void => {
  // Scenario 1: no vault configured, so any save is irrelevant to an index.
  /**
   * @purpose Asserts that a save is ignored when there is no vault root.
   * @inputs root = null; savedPath points at an existing note; notePaths matches it.
   * @outputs Expects { kind: 'none' } — no index action required.
   * @dataflow planVaultSaveSync(null, ...) → none plan → toEqual assertion.
   * @controlflow Invoke with a null root; the function short-circuits to none before path checks.
   */
  it('does nothing without a vault', (): void => {
    expect(planVaultSaveSync(null, 'C:\\v\\a.md', ['C:\\v\\a.md'])).toEqual({ kind: 'none' });
  });

  // Scenario 2: no document is being saved, so there is nothing to classify.
  /**
   * @purpose Asserts that a save is ignored when the document path is absent.
   * @inputs root set; savedPath = null; empty notePaths.
   * @outputs Expects { kind: 'none' } — no index action required.
   * @dataflow planVaultSaveSync(root, null, ...) → none plan → toEqual assertion.
   * @controlflow Invoke with a null savedPath; the function short-circuits to none before root checks.
   */
  it('does nothing for a document with no path', (): void => {
    expect(planVaultSaveSync('C:\\v', null, [])).toEqual({ kind: 'none' });
  });

  // Scenario 3: the saved file lives outside the vault root. The second case guards against naive string-prefix matching that would treat "C:\vault2" as inside "C:\v".
  /**
   * @purpose Asserts that a save is ignored when the file is not contained in the vault root.
   * @inputs root = 'C:\v'; savedPath outside the root, including one sharing only its string prefix.
   * @outputs Expects { kind: 'none' } for both out-of-vault paths — no index action required.
   * @dataflow planVaultSaveSync(root, offRootPath, ...) → none plan → toEqual assertions.
   * @controlflow Invoke with two boundary cases; each must resolve to none without false-positive prefix matches.
   */
  it('does nothing for a file outside the vault, even one sharing its prefix', (): void => {
    expect(planVaultSaveSync('C:\\v', 'C:\\other\\a.md', [])).toEqual({ kind: 'none' });
    expect(planVaultSaveSync('C:\\v', 'C:\\vault2\\a.md', [])).toEqual({ kind: 'none' });
  });

  // Scenario 4: a held note is re-indexed under the index's own spelling of its path, not the incoming casing/separators.
  /**
   * @purpose Asserts that saving an already-indexed note yields an update keyed by the index's stored spelling.
   * @inputs root = 'C:\v'; savedPath uses forward slashes and different casing; notePaths contains the canonical backslash form.
   * @outputs Expects { kind: 'update', path: 'C:\v\A.md' } — re-index using the existing index entry's spelling.
   * @dataflow planVaultSaveSync(root, normalizedPath, ...) → update plan carrying the stored path → toEqual assertion.
   * @controlflow Normalize the incoming path; match it against notePaths; return the matched index spelling as the update target.
   */
  it('re-indexes a held note under the index spelling of its path', (): void => {
    expect(planVaultSaveSync('C:\\v', 'c:/v/A.md', ['C:\\v\\b.md', 'C:\\v\\A.md'])).toEqual({ kind: 'update', path: 'C:\\v\\A.md' });
  });

  // Scenario 5: a brand-new note appears inside the vault, requiring a full rescan to pick it up.
  /**
   * @purpose Asserts that saving a new note not yet in the index triggers a rescan.
   * @inputs root = 'C:\v'; savedPath is a novel .markdown file; notePaths lacks it.
   * @outputs Expects { kind: 'rescan' } — the vault must be rescanned to register the new note.
   * @dataflow planVaultSaveSync(root, newNotePath, ...) → rescan plan → toEqual assertion.
   * @controlflow Normalize; confirm containment in root; find no matching index entry; verify a note extension; return rescan.
   */
  it('rescans for a new note in the vault', (): void => {
    expect(planVaultSaveSync('C:\\v', 'C:\\v\\sub\\new.markdown', ['C:\\v\\a.md'])).toEqual({ kind: 'rescan' });
  });

  // Scenario 6: a non-note file inside the vault is ignored, since only notes participate in the index.
  /**
   * @purpose Asserts that saving a non-note file inside the vault produces no index action.
   * @inputs root = 'C:\v'; savedPath is a .txt file; notePaths empty.
   * @outputs Expects { kind: 'none' } — non-notes are excluded from the vault index.
   * @dataflow planVaultSaveSync(root, nonNotePath, ...) → none plan → toEqual assertion.
   * @controlflow Normalize; confirm containment in root; detect a non-note extension; return none without rescanning.
   */
  it('ignores a new file that is not a note', (): void => {
    expect(planVaultSaveSync('C:\\v', 'C:\\v\\notes.txt', [])).toEqual({ kind: 'none' });
  });
});
