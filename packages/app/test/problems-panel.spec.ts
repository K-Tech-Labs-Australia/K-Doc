// @vitest-environment jsdom

/**
 * @file problems-panel.spec.ts
 * @purpose Vitest test suite for ProblemsPanel right-sidebar panel (FR-14.7).
 *   Validates empty states, fixed group ordering (Spelling then Links), absent group suppression,
 *   uninflected heading counts, label and detail rendering with blank label fallback,
 *   delegated click reveal navigation with document positions, single click dispatch,
 *   ignoring clicks outside problem buttons, caller-defined group ordering, element identity stability,
 *   empty refresh transitions, idempotent destroy teardown with silenced listeners, and stylesheet exports under jsdom.
 * @inputs Problem fixture collections, synthetic DOM click events, and mock reveal callbacks.
 * @outputs Vitest assertions verifying DOM hierarchy, text content, heading counts, reveal callback recordings, element stability, and stylesheet exports.
 * @functions
 *   - mount: Instantiates and mounts a ProblemsPanel controller on a mock Document context with mutable state.
 *   - requireElement: Queries an element matching a CSS selector within a root element, failing if absent.
 *   - texts: Extracts trimmed text content from all DOM descendants matching a CSS selector.
 *   - problem: Factory helper constructing a Problem fixture with explicit fields.
 * @dataflow Problem fixtures -> ProblemsPanel refresh / render -> DOM node inspection / synthetic clicks -> options.reveal recordings -> Vitest assertions.
 * @controlflow Mount problems panel harness -> execute test assertions across 14 test cases -> destroy active panels and remove host elements in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installProblemsPanel, PROBLEMS_PANEL_STYLES } from '../src/shell/problems-panel.js';
import type { ProblemsPanel, Problem, ProblemKind } from '../src/shell/problems-panel.js';

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

interface Revealed {
  readonly kind: ProblemKind;
  readonly from: number;
  readonly to: number;
}

interface Harness {
  readonly panel: ProblemsPanel;
  readonly revealed: Revealed[];
  problems: Problem[];
}

interface MutableHarness {
  panel?: ProblemsPanel;
  readonly revealed: Revealed[];
  problems: Problem[];
}

/**
 * Instantiates and mounts a ProblemsPanel controller with reactive accessors and invocation recorders.
 *
 * @purpose Allocates a test harness for ProblemsPanel, recording reveal callback invocations while exposing mutable problems state.
 * @inputs initial - Optional initial state override for problems array.
 * @outputs Harness - Test harness containing the mounted ProblemsPanel, recorded reveals, and mutable problems list.
 * @dataflow initial parameters -> mutable harness state -> installProblemsPanel -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize mutable state -> instantiate ProblemsPanel with closures over harness properties -> register panel in activePanels -> attach host to document -> return harness.
 */
function mount(initial?: { problems?: Problem[] }): Harness {
  let initialProblems: Problem[] = [];
  // Check if initial problems array was provided.
  if (initial?.problems !== undefined) {
    // Problems provided: clone the array.
    initialProblems = [...initial.problems];
  } else {
    // No problems provided: default to empty array.
    initialProblems = [];
  }

  // Build the mutable object first and assign panel onto it once instantiated, allowing the
  // installProblemsPanel accessor closure (problems) to close over harness properties directly.
  // This ensures subsequent test mutations to harness.problems are immediately visible
  // to the panel upon refresh.
  const harness: MutableHarness = {
    revealed: [],
    problems: initialProblems,
  };

  const panel = installProblemsPanel({
    doc: document,
    problems: (): readonly Problem[] => harness.problems,
    reveal: (kind: ProblemKind, from: number, to: number): void => {
      harness.revealed.push({ kind, from, to });
    },
  });

  harness.panel = panel;
  activePanels.push(panel);

  // Put it in the document. A panel the sidebar never mounted is not the panel under test.
  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);
  activeHosts.push(host);

  return harness as Harness;
}

/**
 * Queries an element matching a CSS selector within a root element, failing the test if missing.
 *
 * @purpose Retrieves a required DOM element or fails the test with a descriptive message naming the missing selector.
 * @inputs root - The parent HTMLElement to query within.
 * @inputs selector - CSS selector string matching the target element.
 * @outputs T - The located HTMLElement.
 * @dataflow root -> querySelector(selector) -> element or expect.fail.
 * @controlflow Execute querySelector -> if null call expect.fail; otherwise return element.
 */
function requireElement<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  // Check whether the requested element exists in the DOM hierarchy.
  if (el === null) {
    // Missing element: fail test immediately with descriptive message.
    expect.fail(`Expected element matching "${selector}" to exist`);
  } else {
    // Found element: return strongly typed element.
    return el;
  }
}

/**
 * Extracts trimmed text content from all DOM descendants matching a CSS selector.
 *
 * @purpose Queries all matching elements within a container and returns their trimmed textContent.
 * @inputs root - The root HTMLElement to query within.
 * @inputs selector - CSS selector string matching target elements.
 * @outputs readonly string[] - Array of trimmed text strings from matched elements.
 * @dataflow root -> querySelectorAll(selector) -> NodeList iteration -> trimmed text strings.
 * @controlflow Query all matching elements -> loop through nodes -> extract and trim textContent -> return array.
 */
function texts(root: HTMLElement, selector: string): readonly string[] {
  const elements = root.querySelectorAll(selector);
  const result: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    // Check if the element at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (element !== undefined) {
      const text = element.textContent;
      // Check if textContent is non-null.
      if (text !== null) {
        // Non-null text: append trimmed string.
        result.push(text.trim());
      } else {
        // Null textContent: append empty string.
        result.push('');
      }
    } else {
      // Undefined element: skip iteration.
    }
  }

  return result;
}

/**
 * Factory helper constructing a Problem fixture with explicit fields.
 *
 * @purpose Creates a Problem object avoiding repetitive object literals across test cases.
 * @inputs kind - ProblemKind ('spelling' | 'link').
 * @inputs label - The offending text or target label.
 * @inputs detail - Diagnostic explanation of the problem.
 * @inputs from - Start character offset in document coordinates.
 * @inputs to - End character offset in document coordinates.
 * @outputs Problem - Constructed problem fixture object.
 * @dataflow Input parameters -> Problem record constructed and returned.
 * @controlflow Assemble object properties -> return Problem instance.
 */
function problem(
  kind: ProblemKind,
  label: string,
  detail: string,
  from: number,
  to: number,
): Problem {
  return {
    kind,
    label,
    detail,
    from,
    to,
  };
}

describe('the Problems panel', (): void => {
  it('renders an empty state readout when there are no problems', (): void => {
    // A panel with no issues should reassure the user that the document is clean rather than showing blank space.
    const { panel } = mount();
    expect(texts(panel.element, '.kdoc-problems-empty')).toEqual(['No problems found.']);
    expect(panel.element.querySelectorAll('.kdoc-problems-heading')).toHaveLength(0);
    expect(panel.element.querySelectorAll('.kdoc-problem')).toHaveLength(0);
  });

  it('renders groups in a fixed order with spelling first regardless of input order', (): void => {
    // Section headings must appear in a predictable sequence so categories do not shift when unrelated items are resolved.
    const linkProb = problem('link', 'https://broken.invalid', 'Unreachable host', 100, 122);
    const spellProb = problem('spelling', 'mispelled', 'Possible spelling mistake', 10, 19);
    const { panel } = mount({ problems: [linkProb, spellProb] });

    expect(texts(panel.element, '.kdoc-problems-heading')).toEqual(['Spelling (1)', 'Links (1)']);
  });

  it('renders nothing at all for a problem group that has no issues', (): void => {
    // Empty categories should not clutter the sidebar with headers that contain zero items.
    const sp1 = problem('spelling', 'definately', 'Did you mean definitely?', 5, 15);
    const sp2 = problem('spelling', 'seperate', 'Did you mean separate?', 30, 38);
    const spellingHarness = mount({ problems: [sp1, sp2] });

    expect(texts(spellingHarness.panel.element, '.kdoc-problems-heading')).toEqual(['Spelling (2)']);
    expect(spellingHarness.panel.element.querySelectorAll('[data-kind="link"]')).toHaveLength(0);

    const lk1 = problem('link', 'note1.md', 'File missing', 50, 58);
    const lk2 = problem('link', 'note2.md', 'File missing', 70, 78);
    const lk3 = problem('link', 'note3.md', 'File missing', 90, 98);
    const linkHarness = mount({ problems: [lk1, lk2, lk3] });

    expect(texts(linkHarness.panel.element, '.kdoc-problems-heading')).toEqual(['Links (3)']);
    expect(linkHarness.panel.element.querySelectorAll('[data-kind="spelling"]')).toHaveLength(0);
  });

  it('maintains uninflected category names regardless of item count', (): void => {
    // English category nouns describe domain concepts rather than quantities, preventing awkward singularization like Link (1).
    const sp1 = problem('spelling', 'word1', 'Detail', 1, 6);
    const sp2 = problem('spelling', 'word2', 'Detail', 10, 15);
    const sp3 = problem('spelling', 'word3', 'Detail', 20, 25);

    const singleSpellingHarness = mount({ problems: [sp1] });
    expect(texts(singleSpellingHarness.panel.element, '.kdoc-problems-heading')).toEqual(['Spelling (1)']);

    const tripleSpellingHarness = mount({ problems: [sp1, sp2, sp3] });
    expect(texts(tripleSpellingHarness.panel.element, '.kdoc-problems-heading')).toEqual(['Spelling (3)']);

    const lk1 = problem('link', 'ref1', 'Detail', 50, 54);
    const singleLinkHarness = mount({ problems: [lk1] });
    expect(texts(singleLinkHarness.panel.element, '.kdoc-problems-heading')).toEqual(['Links (1)']);
  });

  it('displays the label and detail text for each problem item', (): void => {
    // Users need to see both the offending text and the diagnosis to decide whether and how to correct it.
    const sp1 = problem('spelling', 'recieve', 'Did you mean receive?', 5, 12);
    const sp2 = problem('spelling', 'occured', 'Did you mean occurred?', 20, 27);
    const lk1 = problem('link', 'missing.md', 'Target note does not exist', 40, 50);
    const { panel } = mount({ problems: [sp1, sp2, lk1] });

    expect(texts(panel.element, '.kdoc-problem-label')).toEqual(['recieve', 'occured', 'missing.md']);
    expect(texts(panel.element, '.kdoc-problem-detail')).toEqual([
      'Did you mean receive?',
      'Did you mean occurred?',
      'Target note does not exist',
    ]);
  });

  it('renders a fallback placeholder when a problem label is empty', (): void => {
    // An invisible hit target cannot be clicked, so an empty label must display replacement text while preserving detail and counts.
    const blankProblem = problem('spelling', '', 'Unexpected whitespace token', 12, 12);
    const { panel } = mount({ problems: [blankProblem] });

    expect(texts(panel.element, '.kdoc-problem-label')).toEqual(['(blank)']);
    expect(texts(panel.element, '.kdoc-problem-detail')).toEqual(['Unexpected whitespace token']);
    expect(texts(panel.element, '.kdoc-problems-heading')).toEqual(['Spelling (1)']);
  });

  it('reveals the target problem with its kind and character range upon click', (): void => {
    // The editor requires both coordinates and coordinate space to position the selection cursor without corrupting position offsets.
    const sp = problem('spelling', 'typo', 'Misspelled', 14, 18);
    const lk = problem('link', 'dead-link.md', 'Broken reference', 105, 117);
    const harness = mount({ problems: [sp, lk] });

    const spellingButton = requireElement<HTMLButtonElement>(
      harness.panel.element,
      'button[data-kind="spelling"]',
    );
    spellingButton.click();

    expect(harness.revealed).toEqual([{ kind: 'spelling', from: 14, to: 18 }]);

    const linkButton = requireElement<HTMLButtonElement>(
      harness.panel.element,
      'button[data-kind="link"]',
    );
    linkButton.click();

    expect(harness.revealed).toEqual([
      { kind: 'spelling', from: 14, to: 18 },
      { kind: 'link', from: 105, to: 117 },
    ]);
  });

  it('dispatches exactly one reveal invocation per user click', (): void => {
    // Duplicate reveal dispatches cause redundant editor scrolling and flickering selection changes.
    const sp = problem('spelling', 'grammer', 'Did you mean grammar?', 22, 29);
    const harness = mount({ problems: [sp] });

    const button = requireElement<HTMLButtonElement>(harness.panel.element, 'button.kdoc-problem');
    button.click();

    expect(harness.revealed).toHaveLength(1);
  });

  it('ignores clicks outside problem item buttons', (): void => {
    // Structural containers and category labels are informational landmarks rather than interactive controls.
    const sp = problem('spelling', 'word', 'Detail', 5, 9);
    const harness = mount({ problems: [sp] });

    const body = requireElement(harness.panel.element, '.kdoc-problems-body');
    body.click();
    expect(harness.revealed).toHaveLength(0);

    const heading = requireElement(harness.panel.element, '.kdoc-problems-heading');
    heading.click();
    expect(harness.revealed).toHaveLength(0);
  });

  it('preserves caller document order within each problem group', (): void => {
    // Problems should appear in document order so the user reads through issues sequentially rather than hopping alphabetically.
    const p1 = problem('spelling', 'zebra', 'Detail Z', 50, 55);
    const p2 = problem('spelling', 'apple', 'Detail A', 10, 15);
    const p3 = problem('spelling', 'mango', 'Detail M', 30, 35);
    const { panel } = mount({ problems: [p1, p2, p3] });

    expect(texts(panel.element, '.kdoc-problem-label')).toEqual(['zebra', 'apple', 'mango']);
  });

  it('preserves the root container element instance across refreshes', (): void => {
    // The sidebar shell mounts the panel root once and expects its DOM identity to remain stable across data updates.
    const p1 = problem('spelling', 'initial', 'Initial issue', 1, 8);
    const harness = mount({ problems: [p1] });
    const initialElement = harness.panel.element;

    expect(texts(initialElement, '.kdoc-problem-label')).toEqual(['initial']);

    const p2 = problem('spelling', 'updated', 'Updated issue', 10, 17);
    harness.problems = [p2];
    harness.panel.refresh();

    expect(harness.panel.element).toBe(initialElement);
    expect(texts(harness.panel.element, '.kdoc-problem-label')).toEqual(['updated']);
  });

  it('restores the empty state readout when all problems are resolved on refresh', (): void => {
    // Stale problem entries would mislead the user into thinking fixed errors still persist in the document.
    const p1 = problem('spelling', 'fault', 'Problem detail', 5, 10);
    const harness = mount({ problems: [p1] });
    expect(texts(harness.panel.element, '.kdoc-problem-label')).toEqual(['fault']);

    harness.problems = [];
    harness.panel.refresh();

    expect(texts(harness.panel.element, '.kdoc-problems-empty')).toEqual(['No problems found.']);
    expect(harness.panel.element.querySelectorAll('.kdoc-problem')).toHaveLength(0);
  });

  it('destroys idempotently and silences subsequent click events', (): void => {
    // Destroyed components must release event handlers so background clicks on unmounted DOM nodes do not cause side effects.
    const sp = problem('spelling', 'lingering', 'Issue detail', 20, 29);
    const harness = mount({ problems: [sp] });
    const body = requireElement(harness.panel.element, '.kdoc-problems-body');

    harness.panel.destroy();
    expect((): void => {
      harness.panel.destroy();
    }).not.toThrow();

    const dummyButton = document.createElement('button');
    dummyButton.className = 'kdoc-problem';
    dummyButton.setAttribute('data-from', '20');
    dummyButton.setAttribute('data-to', '29');
    dummyButton.setAttribute('data-kind', 'spelling');
    body.appendChild(dummyButton);
    dummyButton.click();

    expect(harness.revealed).toHaveLength(0);
  });

  it('exports stylesheet definitions for panel and item classes', (): void => {
    // The shell requires embedded CSS rules to style panel containers and buttons without external style dependencies.
    expect(typeof PROBLEMS_PANEL_STYLES).toBe('string');
    expect(PROBLEMS_PANEL_STYLES.length).toBeGreaterThan(0);
    expect(PROBLEMS_PANEL_STYLES).toContain('.kdoc-problems-panel');
    expect(PROBLEMS_PANEL_STYLES).toContain('.kdoc-problem');
  });
});
