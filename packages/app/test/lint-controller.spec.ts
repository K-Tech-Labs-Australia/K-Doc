/**
 * @file lint-controller.spec.ts
 * @purpose Exercises the controller behind document linting (packages/app/src/shell/lint-controller.ts): image-existence probing against a host, fix application with staleness detection, and mapping core findings to panel problems (FR-12.7).
 * @inputs Markdown source strings for snapshots; an optional answer resolver and option overrides for the harness; literal fixes and buffer text for applyFix cases.
 * @outputs void — assertions via expect(); no values are exported. Side effects are observed through the harness's calls/changes/errors trackers.
 * @functions
 *   - snapshot: Wraps markdown into a SessionSnapshot exposing only the members the controller reads.
 *   - flush: Resolves after a macrotask so awaited probe answers settle before assertions run.
 *   - harness: Builds a controller wired to recording option sinks plus an overridable answer resolver.
 * @dataflow test input → snapshot()/harness() → controller.problems()/applyFix() → assertions; host exist calls recorded in calls[], redraws in changes.count, errors in errors[].
 * @controlflow Define helpers → describe resolveImagePath (path resolution) → describe findingToProblem (finding mapping) → describe createLintController (probe/fix/reset lifecycle).
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, type SessionSnapshot } from '@k-doc/core';
import { createLintController, findingToProblem, resolveImagePath, type LintControllerOptions, type LintController } from '../src/shell/lint-controller.js';
import { joinPath } from '../src/shell/link-target.js';

/**
 * @purpose Wraps a markdown string into the minimal SessionSnapshot shape the controller reads.
 * @inputs text — the document source to lint and scan for images.
 * @outputs SessionSnapshot — an object with `text` and a parsed `document`.
 * @dataflow text → parseMarkdown(text) → { text, document } cast as SessionSnapshot.
 * @controlflow Parse once and return; no branching.
 */
function snapshot(text: string): SessionSnapshot {
  // The controller only ever reads the `text` and `document` members, so a structural cast is sufficient here.
  return { text, document: parseMarkdown(text) } as unknown as SessionSnapshot;
}

/**
 * @purpose Yields control back to the event loop once so in-flight probe promises settle before assertions run.
 * @inputs void.
 * @outputs Promise<void> — resolves after a single macrotask (setTimeout with 0ms).
 * @dataflow void → timer callback → resolve.
 * @controlflow Construct and await a promise that resolves on the next macrotask; no branching.
 */
async function flush(): Promise<void> {
  // A zero-millisecond timeout schedules resolution on the next macrotask, letting pending probe answers land first.
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * @purpose Builds a controller wired to recording option sinks and an overridable host answer resolver for tests.
 * @inputs overrides — optional LintControllerOptions fields plus an optional `answer` resolver mapping probed paths to existence booleans.
 * @outputs { controller, calls, changes, errors } — the built controller and trackers for probe batches, redraws, and error messages.
 * @dataflow overrides → default option sinks (calls/changes/errors) merged with caller overrides → createLintController(options).
 * @controlflow Declare trackers → build default options with a recording exist() → merge overrides over defaults → construct and return.
 */
function harness(overrides: Partial<LintControllerOptions> & { answer?: (paths: readonly string[]) => Promise<readonly boolean[]> } = {}): { controller: LintController; calls: Array<readonly string[]>; changes: { count: number }; errors: string[] } {
  // Every batch the host is asked about, captured in call order.
  const calls: Array<readonly string[]> = [];
  // Count of redraws requested through onChange().
  const changes: { count: number } = { count: 0 };
  // Error messages reported through onError(), in call order.
  const errors: string[] = [];

  // Default host wiring; each field can be replaced by a caller-supplied override below.
  const options: LintControllerOptions = {
    documentPath: () => 'C:/n/d.md',
    canProbe: () => true,
    exist: (paths): Promise<readonly boolean[]> => {
      // Record the batch so tests can assert exactly which absolute paths were probed.
      calls.push(paths);
      // Nullish branch: use the caller's resolver when supplied, otherwise assume every path exists.
      return (overrides.answer ?? ((p: readonly string[]): Promise<readonly boolean[]> => Promise.resolve(p.map(() => true))))(paths);
    },
    onChange: (): void => { changes.count += 1; },
    onError: (message): void => { errors.push(message); },
  };

  // Caller overrides win over the defaults for documentPath/canProbe/onChange/onError; exist stays the recording wrapper.
  return { controller: createLintController({ ...options, ...overrides }), calls, changes, errors };
}

describe('resolveImagePath', (): void => {
  it('resolves a relative image against the document folder', (): void => {
    expect(resolveImagePath('img/a.png', 'C:/notes/doc.md')).toBe(joinPath('C:/notes', 'img/a.png'));
    expect(resolveImagePath('img/a.png', 'C:/notes/doc.md')).toMatch(/notes[\\/]img[\\/]a\.png$/);
  });

  it('follows a parent folder', (): void => {
    expect(resolveImagePath('../up.png', 'C:/n/sub/d.md')).toMatch(/n[\\/]up\.png$/);
  });

  it('keeps drive and network paths as written', (): void => {
    expect(resolveImagePath('C:\\pics\\a.png', null)).toBe('C:\\pics\\a.png');
    expect(resolveImagePath('\\\\server\\share\\a.png', null)).toBe('\\\\server\\share\\a.png');
  });

  it('cannot resolve a site-root path, an untitled document or an empty address', (): void => {
    expect(resolveImagePath('/a.png', 'C:/n/d.md')).toBeNull();
    expect(resolveImagePath('a.png', null)).toBeNull();
    expect(resolveImagePath('  ', 'C:/n/d.md')).toBeNull();
  });

  it('drops the query and decodes the name', (): void => {
    expect(resolveImagePath('my%20pic.png?x=1', 'C:/n/d.md')).toBe(joinPath('C:/n', 'my pic.png'));
  });
});

describe('findingToProblem', (): void => {
  it('maps a finding with a fix onto a lint problem carrying that fix', (): void => {
    expect(findingToProblem({ rule: 'empty-link', label: 'x', message: 'Link has no address', from: 1, to: 5, fix: { label: 'Remove', edits: [{ from: 1, to: 5, insert: 'x' }] } })).toEqual({ kind: 'lint', label: 'x', detail: 'Link has no address', from: 1, to: 5, fix: { label: 'Remove', edits: [{ from: 1, to: 5, insert: 'x' }] } });
  });

  it('omits the fix property when a finding offers none', (): void => {
    expect(findingToProblem({ rule: 'duplicate-heading', label: 'A', message: 'Same heading as line 1', from: 0, to: 3, fix: null })).not.toHaveProperty('fix');
  });
});

describe('createLintController', (): void => {
  const IMAGES = '![a](gone.png) ![b](here.png)\n';

  it('asks about images once and reports the missing one when the answer arrives', async (): Promise<void> => {
    const { controller, calls, changes } = harness({ answer: (p) => Promise.resolve(p.map((path) => !path.endsWith('gone.png'))) });
    expect(controller.problems(snapshot(IMAGES))).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    await flush();
    expect(changes.count).toBe(1);
    const problems = controller.problems(snapshot(IMAGES));
    expect(problems.map((p) => [p.kind, p.label, p.detail])).toEqual([['lint', 'gone.png', 'Image file not found']]);
    expect(calls).toHaveLength(1);
  });

  it('does not ask again while an answer is pending', async (): Promise<void> => {
    let release: (value: readonly boolean[]) => void = () => undefined;
    const { controller, calls } = harness({ answer: () => new Promise<readonly boolean[]>((resolve) => { release = resolve; }) });
    controller.problems(snapshot(IMAGES));
    controller.problems(snapshot(IMAGES));
    expect(calls).toHaveLength(1);
    release([true, true]);
    await flush();
  });

  it('does not ask when the host cannot answer', async (): Promise<void> => {
    const { controller, calls } = harness({ canProbe: () => false });
    controller.problems(snapshot(IMAGES));
    expect(calls).toEqual([]);
  });

  it('does not ask about relative images in an untitled document', async (): Promise<void> => {
    const { controller, calls } = harness({ documentPath: () => null });
    controller.problems(snapshot(IMAGES));
    expect(calls).toEqual([]);
  });

  it('reports a failing host once and stops asking until reset', async (): Promise<void> => {
    const { controller, calls, errors } = harness({ answer: () => Promise.reject(new Error('host down')) });
    controller.problems(snapshot(IMAGES));
    await flush();
    controller.problems(snapshot(IMAGES));
    await flush();
    expect(errors).toEqual(['host down']);
    expect(calls).toHaveLength(1);
    controller.reset();
    controller.problems(snapshot(IMAGES));
    expect(calls).toHaveLength(2);
    await flush();
  });

  it('asks again after a reset', async (): Promise<void> => {
    const { controller, calls } = harness();
    controller.problems(snapshot(IMAGES));
    await flush();
    controller.problems(snapshot(IMAGES));
    expect(calls).toHaveLength(1);
    controller.reset();
    controller.problems(snapshot(IMAGES));
    expect(calls).toHaveLength(2);
    await flush();
  });

  it('ignores an answer that arrives after destroy', async (): Promise<void> => {
    let release: (value: readonly boolean[]) => void = () => undefined;
    const { controller, changes } = harness({ answer: () => new Promise<readonly boolean[]>((resolve) => { release = resolve; }) });
    controller.problems(snapshot(IMAGES));
    controller.destroy();
    release([false, false]);
    await flush();
    expect(changes.count).toBe(0);
  });

  it('reports an anchor that no heading has', async (): Promise<void> => {
    const { controller } = harness();
    expect(controller.problems(snapshot('# Intro\n\n[x](#intro) [y](#nope)\n')).map((p) => p.label)).toEqual(['#nope']);
  });

  it('applies a fix, or says it no longer applies', async (): Promise<void> => {
    const { controller, errors } = harness();
    expect(controller.applyFix({ label: 'f', edits: [{ from: 0, to: 1, insert: 'X' }] }, 'abc')).toBe('Xbc');
    expect(controller.applyFix({ label: 'f', edits: [{ from: 5, to: 9, insert: '' }] }, 'abc')).toBeNull();
    expect(errors).toEqual(['That fix no longer applies: the document has changed.']);
  });

  it('does not ask after destroy', async (): Promise<void> => {
    // Proves a controller destroyed before probing issues zero host calls.
    const { controller, calls } = harness();
    controller.destroy();
    controller.problems(snapshot(IMAGES));
    expect(calls).toEqual([]);
  });

  it('stays quiet about a failure that arrives after destroy', async (): Promise<void> => {
    // Proves an error rejected after destroy is neither reported nor surfaced to the panel.
    let fail: (reason: Error) => void = () => undefined;
    const { controller, errors } = harness({ answer: () => new Promise<readonly boolean[]>((_resolve, reject) => { fail = reject; }) });
    controller.problems(snapshot(IMAGES));
    controller.destroy();
    fail(new Error('host down'));
    await flush();
    expect(errors).toEqual([]);
  });

  it('does not count an image missing when the host left it out of the answer', async (): Promise<void> => {
    // Proves a path the host left out of its answer is not taken as missing, and is asked about again.
    const { controller, calls } = harness({ answer: () => Promise.resolve([true]) });
    controller.problems(snapshot(IMAGES));
    await flush();
    expect(controller.problems(snapshot(IMAGES))).toEqual([]);
    expect(calls).toHaveLength(2);
    await flush();
  });
});
