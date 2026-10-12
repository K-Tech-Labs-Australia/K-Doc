/**
 * @file git-service.test.ts
 * @purpose Verifies that createGitService forwards requests to the host command, maps arguments correctly, and refuses writes when no desktop host is available.
 * @inputs GitInvoke implementations (real or fakeHost), document paths, hashes, limits, and commit messages.
 * @outputs Assertion results from vitest describe/it blocks; records host invocations for expectation checks.
 * @functions
 *   - fakeHost: Builds a mock invoke that records calls and returns canned responses per command.
 *   - (describe 'git service'): Groups the two behavioral test cases for the git service.
 * @dataflow Test inputs → createGitService → fakeHost.invoke → recorded calls → expect assertions.
 * @controlflow Mount describe block → run each it() sequentially → assert resolves/rejects and call records; no branching state.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { createGitService } from './git-service.js';
import type { GitInvoke } from './git-service.js';

// fakeHost constructs a GitInvoke mock that records every [command, args] pair and resolves with the canned response registered for that command.
// @purpose Provide a deterministic host implementation whose invocations can be asserted against.
// @inputs responses - Map of command name to the value its invoke should resolve with.
// @outputs Object containing the recorded calls array and an invoke function conforming to GitInvoke.
// @dataflow responses[command] → Promise.resolve → caller's awaited result; each call appended to calls.
// @controlflow On each invoke: push [command, args], then resolve with the matching canned response or undefined.
function fakeHost(responses: Record<string, unknown>): { calls: [string, Record<string, unknown>][]; invoke: GitInvoke } {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke = <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    calls.push([command, args]);
    return Promise.resolve(responses[command] as T);
  };
  return { calls, invoke };
}

describe('git service', () => {
  // Asserts that each public method forwards the correct command and mapped arguments to the host.
  it('passes each request to its host command', async () => {
    const info = { root: 'C:/repo', branch: 'main', tracked: true, staged: false, modified: true };
    const commit = { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Ada', at: 1, subject: 'Add' };
    const host = fakeHost({ git_file_info: info, git_file_log: [commit], git_file_at: 'old', git_stage_file: null, git_commit_file: 'bbbbbbb' });
    const git = createGitService({ available: true, invoke: host.invoke });
    await expect(git.info('C:/repo/n.md')).resolves.toBe(info);
    await expect(git.log('C:/repo/n.md', 20)).resolves.toEqual([commit]);
    await expect(git.fileAt('C:/repo/n.md', 'aaaaaaa')).resolves.toBe('old');
    await expect(git.stage('C:/repo/n.md')).resolves.toBeUndefined();
    await expect(git.commit('C:/repo/n.md', 'Change')).resolves.toBe('bbbbbbb');
    expect(host.calls).toEqual([
      ['git_file_info', { documentPath: 'C:/repo/n.md' }],
      ['git_file_log', { documentPath: 'C:/repo/n.md', limit: 20 }],
      ['git_file_at', { documentPath: 'C:/repo/n.md', hash: 'aaaaaaa' }],
      ['git_stage_file', { documentPath: 'C:/repo/n.md' }],
      ['git_commit_file', { documentPath: 'C:/repo/n.md', message: 'Change' }],
    ]);
  });

  // Asserts that with no desktop host all reads return empty/null and every write throws the availability error without invoking the host.
  it('reads nothing and refuses writes without a desktop host', async () => {
    const host = fakeHost({});
    const git = createGitService({ available: false, invoke: host.invoke });
    expect(git.available).toBe(false);
    await expect(git.info('n.md')).resolves.toBeNull();
    await expect(git.log('n.md', 5)).resolves.toEqual([]);
    await expect(git.fileAt('n.md', 'aaaaaaa')).rejects.toThrow('only available in the K-Doc desktop app');
    await expect(git.stage('n.md')).rejects.toThrow('only available in the K-Doc desktop app');
    await expect(git.commit('n.md', 'x')).rejects.toThrow('only available in the K-Doc desktop app');
    expect(host.calls).toEqual([]);
  });
});
