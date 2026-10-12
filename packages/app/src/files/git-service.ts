/**
 * @file git-service.ts
 * @purpose The webview side of git awareness (FR-11.11): asks the host whether a document is in a git working tree, lists the commits that touched it, reads it at one of them, and stages or commits it.
 * @inputs document paths, commit hashes, messages; host commands git_file_info/log/at/stage/commit.
 * @outputs GitFileInfo, GitCommit lists, text, short hashes.
 * @functions
 *   - createGitService: Builds a GitService bound to an injectable invoke and availability flag.
 *   - requireHost: Throws when no desktop host is present so writes fail fast.
 *   - info: Reports working-tree state for one document.
 *   - log: Lists commits that touched one document, newest first up to limit.
 *   - fileAt: Reads the document's text at a given commit hash.
 *   - stage: Stages a document's changes in the host repository.
 *   - commit: Creates a commit for a document and returns its short hash.
 * @dataflow path -> invoke -> host result.
 * @controlflow without a desktop host, reads come back empty and writes fail fast.
 * @version 1
 * @date 2026-09-16
 */

import { invoke } from '@tauri-apps/api/core';

/** GitFileInfo — root: top folder of the working tree; branch: checked-out branch, empty before the first commit; tracked: git knows the file; staged: the file has staged changes; modified: the working file differs from the index or is untracked. */
export interface GitFileInfo {
  readonly root: string;
  readonly branch: string;
  readonly tracked: boolean;
  readonly staged: boolean;
  readonly modified: boolean;
}

/** GitCommit — at is milliseconds since the epoch; shortHash is git's abbreviated hash. */
export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly at: number;
  readonly subject: string;
}

/** GitInvoke — injectable so tests need no Tauri. */
export type GitInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** GitServiceOptions — options.available is false in the browser build. */
export interface GitServiceOptions {
  readonly available: boolean;
  readonly invoke?: GitInvoke;
}

export interface GitService {
  readonly available: boolean;
  info(path: string): Promise<GitFileInfo | null>;
  log(path: string, limit: number): Promise<readonly GitCommit[]>;
  fileAt(path: string, hash: string): Promise<string>;
  stage(path: string): Promise<void>;
  commit(path: string, message: string): Promise<string>;
}

/** DESKTOP_ONLY — the message a write without a host fails with. */
const DESKTOP_ONLY = 'Git is only available in the K-Doc desktop app.';

/** createGitService — Builds a GitService bound to an injectable invoke and availability flag.
 * @purpose Constructs the webview git service, defaulting to Tauri's invoke when none is injected.
 * @inputs options - GitServiceOptions carrying the availability flag and optional invoke override.
 * @outputs GitService - A bound service exposing info/log/fileAt/stage/commit.
 * @dataflow options.invoke ?? invoke -> call closure -> per-method host command dispatch.
 * @controlflow Select invoke source, define requireHost guard, return object literal wiring each method to call or a no-op result.
 */
export function createGitService(options: GitServiceOptions): GitService {
  const call: GitInvoke = options.invoke ?? (<T>(command: string, args: Record<string, unknown>): Promise<T> => invoke<T>(command, args));

  /** requireHost — writes and reads of one version need the host, so fail fast rather than resolve with nothing.
   * @purpose Throws when no desktop host is present to prevent silent no-op writes.
   * @inputs none.
   * @outputs void; throws Error(DESKTOP_ONLY) when unavailable.
   * @dataflow options.available -> branch decision.
   * @controlflow If not available, throw; else return without action.
   */
  function requireHost(): void {
    // When no desktop host is present there is nothing to write to, so fail fast instead of resolving with nothing.
    if (!options.available) {
      throw new Error(DESKTOP_ONLY);
    } else {
      // Host is available: proceed without raising.
    }
  }

  return {
    available: options.available,
    /** info — Reports working-tree state for one document.
     * @purpose Returns the file's git status or null when no host exists.
     * @inputs path - Document path to inspect.
     * @outputs GitFileInfo | null - Status object, or null without a host.
     * @dataflow path -> invoke git_file_info -> GitFileInfo | null.
     * @controlflow Without a host there is no repository to report so return null; else dispatch the command.
     */
    async info(path: string): Promise<GitFileInfo | null> {
      // Without a host there is no repository to report, so resolve with null.
      if (!options.available) {
        return null;
      } else {
        return call<GitFileInfo | null>('git_file_info', { documentPath: path });
      }
    },
    /** log — Lists commits that touched one document, newest first up to limit.
     * @purpose Returns the commit history for a file or an empty list when no host exists.
     * @inputs path - Document path; limit - Maximum number of commits to return.
     * @outputs GitCommit[] - Ordered commit records, or an empty list without a host.
     * @dataflow path, limit -> invoke git_file_log -> GitCommit[].
     * @controlflow Without a host there is no history to report so return []; else dispatch the command.
     */
    async log(path: string, limit: number): Promise<readonly GitCommit[]> {
      // Without a host there is no repository to query, so resolve with an empty list.
      if (!options.available) {
        return [];
      } else {
        return call<GitCommit[]>('git_file_log', { documentPath: path, limit });
      }
    },
    /** fileAt — Reads the document's text at a given commit hash.
     * @purpose Returns the file contents as they existed at hash after requiring a host.
     * @inputs path - Document path; hash - Commit to read the file from.
     * @outputs string - File text at that commit.
     * @dataflow requireHost -> path, hash -> invoke git_file_at -> string.
     * @controlflow Fail fast without a host, then dispatch the command.
     */
    async fileAt(path: string, hash: string): Promise<string> {
      requireHost();
      return call<string>('git_file_at', { documentPath: path, hash });
    },
    /** stage — Stages a document's changes in the host repository.
     * @purpose Stages the file after requiring a host.
     * @inputs path - Document path to stage.
     * @outputs void.
     * @dataflow requireHost -> path -> invoke git_stage_file.
     * @controlflow Fail fast without a host, then dispatch and await completion.
     */
    async stage(path: string): Promise<void> {
      requireHost();
      await call<null>('git_stage_file', { documentPath: path });
    },
    /** commit — Creates a commit for a document and returns its short hash.
     * @purpose Commits the file after requiring a host and resolves with the new commit's short hash.
     * @inputs path - Document path; message - Commit message.
     * @outputs string - The new commit's abbreviated hash.
     * @dataflow requireHost -> path, message -> invoke git_commit_file -> short hash.
     * @controlflow Fail fast without a host, then dispatch and return the short hash.
     */
    async commit(path: string, message: string): Promise<string> {
      requireHost();
      return call<string>('git_commit_file', { documentPath: path, message });
    },
  };
}
