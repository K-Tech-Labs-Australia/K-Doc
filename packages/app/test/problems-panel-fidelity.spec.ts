// @vitest-environment jsdom

/**
 * @file problems-panel-fidelity.spec.ts
 * @purpose Vitest test suite for the Fidelity group of the ProblemsPanel right-sidebar panel (FR-4.5).
 *   Validates that fidelity problems render as a third group headed 'Fidelity (n)' after Spelling and Links,
 *   that the heading count reflects the number of fidelity issues, that label and detail text render correctly,
 *   and that clicking a fidelity problem reveals with the fidelity kind and its character range.
 * @inputs Problem fixture collections for spelling, link, and fidelity kinds, plus synthetic DOM click events.
 * @outputs Vitest assertions verifying DOM hierarchy, heading data-kind ordering, counts, text content, and reveal callback recordings.
 * @functions
 *   - mount: Instantiates and mounts a ProblemsPanel controller on the jsdom document with a fixed problem set.
 *   - describe/it blocks: Four test cases covering fidelity group head, ordering, label/detail rendering, and click reveal.
 * @dataflow Problem fixtures -> ProblemsPanel refresh / render -> DOM node inspection / synthetic clicks -> revealed recordings -> Vitest assertions.
 * @controlflow Mount problems panel harness -> execute four test cases -> destroy active panels and remove host elements in afterEach.
 * @version 1
 * @date 2026-09-14
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installProblemsPanel } from '../src/shell/problems-panel.js';
import type { Problem, ProblemKind, ProblemsPanel } from '../src/shell/problems-panel.js';

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

const spelling: Problem = { kind: 'spelling', label: 'teh', detail: 'Not in dictionary', from: 1, to: 4 };
const link: Problem = { kind: 'link', label: 'missing', detail: 'No such note', from: 10, to: 17 };
const fidelity: Problem = { kind: 'fidelity', label: 'list block', detail: 'Changed on save though not edited', from: 0, to: 7 };

/**
 * Instantiates and mounts a ProblemsPanel controller with a fixed problem set and invocation recorder.
 *
 * @purpose Allocates a test harness for ProblemsPanel, recording reveal callback invocations while mounting the panel into the jsdom document.
 * @inputs problems - Immutable list of Problem fixtures to render through the panel.
 * @outputs { panel: ProblemsPanel; revealed: Array<{ kind: ProblemKind; from: number; to: number }> } - Test harness containing the mounted panel and recorded reveals.
 * @dataflow problems -> installProblemsPanel accessor closure -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize reveal recorder -> instantiate ProblemsPanel with closures over revealed -> register panel in activePanels -> attach host to document -> call refresh -> return harness.
 */
function mount(problems: readonly Problem[]): {
  panel: ProblemsPanel;
  revealed: Array<{ kind: ProblemKind; from: number; to: number }>;
} {
  const revealed: Array<{ kind: ProblemKind; from: number; to: number }> = [];

  const panel = installProblemsPanel({
    doc: document,
    problems: (): readonly Problem[] => problems,
    reveal: (kind: ProblemKind, from: number, to: number): void => {
      revealed.push({ kind, from, to });
    },
  });

  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);

  activePanels.push(panel);
  activeHosts.push(host);

  panel.refresh();

  return { panel, revealed };
}

describe('ProblemsPanel fidelity group', (): void => {
  it('heads the group with its count', (): void => {
    // The Fidelity category must appear as a distinct section whose heading carries the live item count.
    const { panel } = mount([fidelity]);

    const heading = panel.element.querySelector('.kdoc-problems-heading[data-kind="fidelity"]');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Fidelity (1)');
  });

  it('orders it after spelling and links', (): void => {
    // Fidelity is the newest category, so it must render last to keep Spelling and Links in their established positions.
    const { panel } = mount([fidelity, link, spelling]);

    const kinds = Array.from(panel.element.querySelectorAll('.kdoc-problems-heading')).map((h) => h.getAttribute('data-kind'));
    expect(kinds).toEqual(['spelling', 'link', 'fidelity']);
  });

  it('shows the label and detail as text', (): void => {
    // Users must read both the offending span and its diagnosis to decide how to reconcile the change.
    const { panel } = mount([fidelity]);

    const label = panel.element.querySelector('.kdoc-problem-label')?.textContent;
    expect(label).toBe('list block');

    const detail = panel.element.querySelector('.kdoc-problem-detail')?.textContent;
    expect(detail).toBe('Changed on save though not edited');
  });

  it('reveals with the fidelity kind on click', (): void => {
    // A click must surface the exact fidelity range so the editor can reconcile the right document span.
    const { panel, revealed } = mount([fidelity]);

    const button = panel.element.querySelector('button.kdoc-problem');
    if (!(button instanceof HTMLElement)) {
      throw new Error('no problem button');
    }
    button.click();

    expect(revealed).toEqual([{ kind: 'fidelity', from: 0, to: 7 }]);
  });
});
