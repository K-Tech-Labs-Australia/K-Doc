// @vitest-environment jsdom

/**
 * @file problems-panel-fix.spec.ts
 * @purpose Vitest test suite for the Lint (Document) group of the ProblemsPanel right-sidebar panel (FR-12.7) and its quick-fix buttons.
 *   Validates that lint problems render as a third group headed 'Document (n)' after Spelling and Links, that the heading count reflects the number of lint issues,
 *   that a fix button is drawn only for a problem carrying a fix and only when a fix handler is registered, and that clicking a fix button applies exactly that fix without revealing.
 * @inputs Problem fixture collections with and without fixes, plus synthetic DOM click events against fix and problem buttons.
 * @outputs Vitest assertions verifying DOM hierarchy, heading data-kind ordering, counts, fix-button presence, and fix/reveal callback recordings.
 * @functions
 *   - mount: Instantiates and mounts a ProblemsPanel controller on the jsdom document with a fixed problem set and optional fix handler.
 *   - describe/it blocks: Seven test cases covering the Document group head, ordering, conditional fix buttons, fix application, click reveal, and button renumbering on refresh.
 * @dataflow Problem fixtures -> ProblemsPanel refresh / render -> DOM node inspection / synthetic clicks -> applied/revealed recordings -> Vitest assertions.
 * @controlflow Mount problems panel harness -> execute seven test cases -> destroy active panels and remove host elements in afterEach.
 * @version 1
 * @date 2026-09-14
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installProblemsPanel } from '../src/shell/problems-panel.js';
import type { Problem, ProblemFix, ProblemKind, ProblemsPanel } from '../src/shell/problems-panel.js';

const activePanels: ProblemsPanel[] = [];
const activeHosts: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < activeHosts.length; i++) {
    const host = activeHosts[i];
    // Check if the host element is defined under strict indexing.
    if (host !== undefined) {
      // Defined: remove host element from document body.
      host.remove();
    } else {
      // Undefined: skip iteration.
    }
  }
  activeHosts.length = 0;

  for (let i = 0; i < activePanels.length; i++) {
    const panel = activePanels[i];
    // Check if the panel instance is defined to satisfy strict noUncheckedIndexedAccess.
    if (panel !== undefined) {
      // Defined panel instance: execute lifecycle teardown.
      panel.destroy();
    } else {
      // Undefined panel instance at index: skip iteration.
    }
  }
  activePanels.length = 0;
});

const unwrap: ProblemFix = { label: 'Remove the link, keep the text', edits: [{ from: 4, to: 12, insert: 'docs' }] };
const level: ProblemFix = { label: 'Make it H2', edits: [{ from: 5, to: 8, insert: '##' }] };
const emptyLink: Problem = { kind: 'lint', label: 'docs', detail: 'Link has no address', from: 4, to: 12, fix: unwrap };
const skip: Problem = { kind: 'lint', label: 'C', detail: 'Heading level jumps from H1 to H3', from: 20, to: 25, fix: level };
const duplicate: Problem = { kind: 'lint', label: 'A', detail: 'Same heading as line 1', from: 30, to: 33 };
const spelling: Problem = { kind: 'spelling', label: 'teh', detail: 'Not in dictionary', from: 1, to: 4 };
const link: Problem = { kind: 'link', label: 'missing', detail: 'No such note', from: 10, to: 17 };
const fidelity: Problem = { kind: 'fidelity', label: 'list block', detail: 'Changed on save though not edited', from: 0, to: 7 };

/**
 * Instantiates and mounts a ProblemsPanel controller with a fixed problem set and optional fix handler.
 *
 * @purpose Allocates a test harness for ProblemsPanel, recording reveal and quick-fix callback invocations while mounting the panel into the jsdom document.
 * @inputs problems - Immutable list of Problem fixtures to render through the panel.
 * @inputs withFixHandler - When true, registers a fix handler so fix buttons are drawn; when false, asserts no fix buttons appear.
 * @outputs { panel: ProblemsPanel; revealed: Array<{ kind: ProblemKind; from: number; to: number }>; applied: ProblemFix[] } - Test harness containing the mounted panel, recorded reveals, and recorded fixes.
 * @dataflow problems -> installProblemsPanel accessor closure -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize reveal/fix recorders -> instantiate ProblemsPanel with closures over them -> register panel in activePanels -> attach host to document -> call refresh -> return harness.
 */
function mount(problems: readonly Problem[], withFixHandler: boolean): {
  panel: ProblemsPanel;
  revealed: Array<{ kind: ProblemKind; from: number; to: number }>;
  applied: ProblemFix[];
} {
  const revealed: Array<{ kind: ProblemKind; from: number; to: number }> = [];
  const applied: ProblemFix[] = [];

  const panel = installProblemsPanel({
    doc: document,
    problems: (): readonly Problem[] => problems,
    reveal: (kind: ProblemKind, from: number, to: number): void => {
      revealed.push({ kind, from, to });
    },
    // Only wire the fix handler when requested so tests can assert no fix buttons are drawn without one.
    ...(withFixHandler ? { fix: (fix: ProblemFix): void => { applied.push(fix); } } : {}),
  });

  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);

  activePanels.push(panel);
  activeHosts.push(host);

  panel.refresh();

  return { panel, revealed, applied };
}

describe('ProblemsPanel document group and quick fixes', (): void => {
  it('heads the group Document with its count', (): void => {
    // The Lint category must appear as a distinct section whose heading carries the live item count.
    const { panel } = mount([emptyLink, duplicate], true);

    expect(panel.element.querySelector('.kdoc-problems-heading[data-kind="lint"]')?.textContent).toBe('Document (2)');
  });

  it('orders groups spelling, links, document, fidelity', (): void => {
    // Document is the newest category alongside Fidelity, so it must render after Spelling and Links but before Fidelity.
    const { panel } = mount([fidelity, emptyLink, link, spelling], true);

    const kinds = Array.from(panel.element.querySelectorAll('.kdoc-problems-heading')).map((h) => h.getAttribute('data-kind'));
    expect(kinds).toEqual(['spelling', 'link', 'lint', 'fidelity']);
  });

  it('draws a fix button only for a problem that has a fix', (): void => {
    // Only the empty-link problem carries a fix, so exactly one quick-fix button should be drawn.
    const { panel } = mount([emptyLink, duplicate], true);

    const buttons = Array.from(panel.element.querySelectorAll('button.kdoc-problem-fix'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Remove the link, keep the text']);
  });

  it('draws no fix buttons without a fix handler', (): void => {
    // Without a registered fix handler the panel must not draw any quick-fix buttons even though a fix exists.
    const { panel } = mount([emptyLink], false);

    expect(panel.element.querySelectorAll('button.kdoc-problem-fix').length).toBe(0);
  });

  it('applies the fix a button was drawn for, without revealing', (): void => {
    // Clicking the second problem's fix button must apply that exact fix and never surface the problem range.
    const { panel, applied, revealed } = mount([emptyLink, skip], true);

    const buttons = panel.element.querySelectorAll<HTMLButtonElement>('button.kdoc-problem-fix');
    buttons[1]?.click();

    expect(applied).toEqual([level]);
    expect(revealed).toEqual([]);
  });

  it('reveals a document problem as a source range', (): void => {
    // Clicking the problem button surfaces its lint kind and source offsets so the editor can select the right span.
    const { panel, revealed } = mount([duplicate], true);

    const button = panel.element.querySelector('button.kdoc-problem');
    if (!(button instanceof HTMLElement)) {
      throw new Error('no problem button');
    }
    button.click();

    expect(revealed).toEqual([{ kind: 'lint', from: 30, to: 33 }]);
  });

  it('renumbers fix buttons on refresh', (): void => {
    // A panel installed directly (not via mount) lets the problem set change between refreshes; the fix index must be recomputed.
    let current: readonly Problem[] = [emptyLink, skip];
    const applied: ProblemFix[] = [];

    const panel = installProblemsPanel({
      doc: document,
      problems: (): readonly Problem[] => current,
      reveal: ((): void => {
        // Reveals are not asserted in this case.
      }),
      fix: (fix: ProblemFix): void => {
        applied.push(fix);
      },
    });

    const host = document.createElement('div');
    host.appendChild(panel.element);
    document.body.appendChild(host);

    activePanels.push(panel);
    activeHosts.push(host);

    panel.refresh();

    // Drop the empty-link problem so only skip's fix remains; its button must be renumbered to index 0.
    current = [skip];
    panel.refresh();

    const buttons = panel.element.querySelectorAll<HTMLButtonElement>('button.kdoc-problem-fix');
    // Numbering restarts at each refresh, so the list of drawn fixes does not grow with every redraw.
    expect(buttons[0]?.getAttribute('data-fix-index')).toBe('0');
    buttons[0]?.click();

    expect(applied).toEqual([level]);
  });
});
