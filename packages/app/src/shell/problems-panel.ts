/**
 * @file problems-panel.ts
 * @purpose Implements ProblemsPanel for K-Doc's right sidebar (FR-14.7) displaying spelling and broken link issues.
 * @inputs ProblemsPanelOptions containing Document context, problems query function, and reveal range callback.
 * @outputs ProblemsPanel controller exposing element, refresh, and destroy, alongside PROBLEMS_PANEL_STYLES stylesheet.
 * @functions
 *   - installProblemsPanel: Instantiates DOM hierarchy, binds delegated click listener, and returns ProblemsPanel controller.
 *   - problemButton: Builds a problem button element displaying label, detail, and dataset range attributes.
 *   - renderGroup: Groups problems by kind and appends heading and item buttons into element buffer.
 *   - refresh: Rebuilds problems body DOM based on current problems or renders empty state.
 *   - destroy: Idempotently aborts event listener signals and clears body children.
 * @dataflow options.problems() -> renderGroup -> problemButton DOM nodes -> bodyElement.replaceChildren; a click reads the kind and range back off the button and calls options.reveal.
 * @controlflow Mount root and body -> attach delegated click listener with signal -> initial refresh -> return controller.
 * @version 6
 * @date 2026-10-04
 */

export type ProblemKind = 'spelling' | 'link' | 'fidelity' | 'lint' | 'grammar';

/** One replacement a quick fix makes, in source offsets of the text the problem was found in. */
export interface ProblemFixEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** A quick fix: the button's label and the edits it applies together. */
export interface ProblemFix {
  readonly label: string;
  readonly edits: readonly ProblemFixEdit[];
}

export interface Problem {
  readonly kind: ProblemKind;
  /** The offending text itself: the misspelled word, or the link target. */
  readonly label: string;
  /** What is wrong with it, in a few words. */
  readonly detail: string;
  /** Offset of the first character in the document text. */
  readonly from: number;
  /** Offset just past the last character. */
  readonly to: number;
  /** A quick fix, when one exists. The panel draws a button for it beside the problem. */
  readonly fix?: ProblemFix;
}

export interface ProblemsPanelOptions {
  readonly doc: Document;
  /** Everything currently wrong with the document, in document order. */
  readonly problems: () => readonly Problem[];
  /**
   * Selects and scrolls to one problem's range.
   *
   * The kind comes with it because the two kinds do not measure in the same units: a spelling span is
   * a pair of ProseMirror document positions, while a link's offsets index the source text. Handing
   * over two bare integers would let a caller resolve them in the wrong space and put the caret
   * somewhere the problem is not, which is worse than not moving it at all.
   */
  readonly reveal: (kind: ProblemKind, from: number, to: number) => void;
  /** Applies a problem's quick fix. Without it, no fix buttons are drawn. */
  readonly fix?: (fix: ProblemFix) => void;
}

export interface ProblemsPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export const PROBLEMS_PANEL_STYLES: string = `
.kdoc-problems-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-problems-panel[hidden] {
  display: none !important;
}

.kdoc-problems-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-problems-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-problems-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-problems-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-problems-empty {
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px 12px;
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-problems-heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--kdoc-chrome-text-muted);
  padding: 6px 12px 2px;
  margin: 0;
  font-weight: 600;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-problem {
  width: calc(100% - 8px);
  display: flex;
  gap: 8px;
  align-items: baseline;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  padding: 3px 12px;
  box-sizing: border-box;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-problem:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-problem:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-problem-label {
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  flex: 0 0 auto;
}

.kdoc-problem[data-kind="spelling"] .kdoc-problem-label {
  color: var(--kdoc-emissive-amber);
}

.kdoc-problem[data-kind="grammar"] .kdoc-problem-label {
  color: var(--kdoc-emissive-amber);
}

.kdoc-problem[data-kind="link"] .kdoc-problem-label {
  color: var(--kdoc-emissive-red);
}

.kdoc-problem[data-kind="fidelity"] .kdoc-problem-label {
  color: var(--kdoc-emissive-red);
}

.kdoc-problem[data-kind="lint"] .kdoc-problem-label {
  color: var(--kdoc-chrome-accent);
}

.kdoc-problem-detail {
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-problem-fix {
  display: inline-block;
  margin: 2px 12px 6px 28px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-problem-fix:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-problem-fix:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-problem-fix:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-problems-panel * {
    transition: none !important;
  }
}
`;

/**
 * Installs the problems panel into an owned DOM hierarchy, binding delegated click navigation and returning the controller.
 * @purpose Creates problems panel container, mounts stable body, binds click listener, and returns controller.
 * @inputs options - ProblemsPanelOptions providing Document context, problems accessor, and reveal callback.
 * @outputs ProblemsPanel - Controller interface exposing mounted element, refresh, and destroy methods.
 * @dataflow options.problems() -> grouped DOM buttons -> bodyElement.replaceChildren -> a click reads data-kind/data-from/data-to and invokes options.reveal.
 * @controlflow Create root and body -> attach delegated click listener with signal -> execute initial refresh -> return controller.
 */
export function installProblemsPanel(options: ProblemsPanelOptions): ProblemsPanel {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;
  let destroyed: boolean = false;

  const rootElement = doc.createElement('div');
  rootElement.className = 'kdoc-problems-panel';

  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-problems-body';
  rootElement.appendChild(bodyElement);

  // Holds the fixes drawn by the latest refresh, indexed by each fix button's data-fix-index.
  let fixes: ProblemFix[] = [];

  /**
   * Creates a button element representing a single problem.
   * @purpose Builds button element with label, detail text, and data-from/data-to attributes for navigation.
   * @inputs problem - Problem object containing kind, label, detail, from, and to offsets.
   * @outputs HTMLButtonElement - Configured button element for the problem item.
   * @dataflow Problem attributes -> button element with data attributes, label span, and detail span.
   * @controlflow Create button -> set type, class, dataset attributes -> append label and detail spans -> return button.
   */
  function problemButton(problem: Problem): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'kdoc-problem';
    button.setAttribute('data-from', String(problem.from));
    button.setAttribute('data-to', String(problem.to));
    button.setAttribute('data-kind', problem.kind);

    const labelSpan = doc.createElement('span');
    labelSpan.className = 'kdoc-problem-label';
    // Check whether the problem label is empty.
    if (problem.label === '') {
      // Empty label: render fallback text so the button remains interactive and visible.
      labelSpan.textContent = '(blank)';
    } else {
      // Non-empty label: render the problem label text.
      labelSpan.textContent = problem.label;
    }

    const detailSpan = doc.createElement('span');
    detailSpan.className = 'kdoc-problem-detail';
    detailSpan.textContent = problem.detail;

    button.appendChild(labelSpan);
    button.appendChild(detailSpan);

    return button;
  }

  /**
   * Renders a heading and item buttons for problems matching a given kind.
   * @purpose Filters problems by kind, constructs section heading with count, and appends buttons into target array.
   * @inputs kind - ProblemKind ('spelling' | 'link') to filter and render.
   * @inputs all - Complete list of problems in document order.
   * @inputs into - Output array accumulating rendered group elements.
   * @outputs void.
   * @dataflow all problems -> filter by kind -> build heading and problem buttons -> push to into array.
   * @controlflow Filter all by kind -> if empty return early; else create heading -> create buttons -> append to into.
   */
  function renderGroup(kind: ProblemKind, all: readonly Problem[], into: HTMLElement[]): void {
    const matching: Problem[] = [];
    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      // Guard against undefined under noUncheckedIndexedAccess.
      if (item === undefined) {
        // Undefined item: skip element.
        continue;
      } else {
        // Defined item: evaluate problem kind.
      }

      // Check whether problem kind matches target group kind.
      if (item.kind === kind) {
        // Matching kind: collect problem item.
        matching.push(item);
      } else {
        // Mismatched kind: ignore item.
      }
    }

    // Check whether any matching problems exist in this group.
    if (matching.length === 0) {
      // Empty group: return immediately without rendering heading or buttons.
      return;
    } else {
      // Non-empty group: construct heading and problem buttons.
    }

    const heading = doc.createElement('h3');
    heading.className = 'kdoc-problems-heading';
    heading.setAttribute('data-kind', kind);
    // Check whether the group kind is spelling.
    if (kind === 'spelling') {
      // Spelling group: render fixed heading with item count.
      heading.textContent = `Spelling (${matching.length})`;
    } else if (kind === 'fidelity') {
      // Fidelity group (FR-4.5): bytes that changed on save in a region nobody edited.
      heading.textContent = `Fidelity (${matching.length})`;
    } else if (kind === 'lint') {
      // Document group (FR-12.7): structure problems such as heading skips, empty links and malformed tables.
      heading.textContent = `Document (${matching.length})`;
    } else if (kind === 'grammar') {
      // Grammar group (FR-12.4): whatever the reader's grammar service reported the last time it was asked.
      heading.textContent = `Grammar (${matching.length})`;
    } else {
      // Link group: render fixed heading with item count.
      heading.textContent = `Links (${matching.length})`;
    }
    into.push(heading);

    for (let i = 0; i < matching.length; i++) {
      const problem = matching[i];
      // Guard against undefined under noUncheckedIndexedAccess.
      if (problem === undefined) {
        // Undefined problem item: skip element.
        continue;
      } else {
        // Defined problem item: construct button and append to group.
      }

      into.push(problemButton(problem));
      // Check whether a quick fix exists for this problem and the panel has a handler for it.
      if (problem.fix !== undefined && options.fix !== undefined) {
        // Fix available: build a quick-fix button wired to that fix.
        const fixButton = doc.createElement('button');
        fixButton.type = 'button';
        fixButton.className = 'kdoc-problem-fix';
        fixButton.textContent = problem.fix.label;
        fixButton.setAttribute('data-fix-index', String(fixes.length));
        fixes.push(problem.fix);
        into.push(fixButton);
      } else {
        // No fix or no handler: draw only the problem button.
      }
    }
  }

  /**
   * Refreshes the problems panel body DOM based on current problems in the document.
   * @purpose Reads current problems, renders empty state or grouped spelling and link sections, and updates body.
   * @inputs void.
   * @outputs void.
   * @dataflow options.problems() -> evaluate count -> render empty message or groups -> bodyElement.replaceChildren().
   * @controlflow Check destroyed guard -> read problems -> if empty render empty message; else render groups in fixed order.
   */
  function refresh(): void {
    // Check whether the panel has been destroyed.
    if (destroyed) {
      // Panel is destroyed: abort refresh.
      return;
    } else {
      // Panel is active: proceed with refreshing problems list.
    }

    const problemsList = options.problems();
    // Check whether the problem list is empty.
    if (problemsList.length === 0) {
      // No problems: render empty state readout.
      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-problems-empty';
      emptyLine.textContent = 'No problems found.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // Problems exist: render spelling, link and fidelity groups in fixed order.
    }

    // The previous refresh's buttons are about to be replaced.
    fixes = [];
    const children: HTMLElement[] = [];
    renderGroup('spelling', problemsList, children);
    renderGroup('grammar', problemsList, children);
    renderGroup('link', problemsList, children);
    renderGroup('lint', problemsList, children);
    renderGroup('fidelity', problemsList, children);
    bodyElement.replaceChildren(...children);
  }

  bodyElement.addEventListener(
    'click',
    (event: MouseEvent): void => {
      // Check whether event target is an HTMLElement.
      if (!(event.target instanceof HTMLElement)) {
        // Target is not an HTMLElement: ignore click.
        return;
      } else {
        // Target is an HTMLElement: search for nearest problem button.
      }

      const fixButton = event.target.closest<HTMLButtonElement>('button.kdoc-problem-fix');
      // Check whether the click landed on a quick-fix button rather than on a problem.
      if (fixButton !== null) {
        // A fix button: apply the fix it was drawn for, and do not also reveal the problem.
        const index = Number.parseInt(fixButton.getAttribute('data-fix-index') ?? '', 10);
        const fix = Number.isInteger(index) ? fixes[index] : undefined;
        // Check that the index names a fix from the latest refresh and that a handler exists.
        if (fix !== undefined && options.fix !== undefined) {
          // Both present: apply it.
          options.fix(fix);
        } else {
          // Stale or unknown index: ignore the click.
        }
        return;
      } else {
        // Not a fix button: fall through to problem navigation.
      }

      const button = event.target.closest<HTMLButtonElement>('button.kdoc-problem');
      // Check whether click occurred within a problem button.
      if (button === null) {
        // Click occurred outside problem button: ignore click.
        return;
      } else {
        // Click occurred within problem button: extract range attributes.
      }

      const rawFrom = button.getAttribute('data-from');
      const rawTo = button.getAttribute('data-to');
      const rawKind = button.getAttribute('data-kind');
      const from = Number.parseInt(rawFrom ?? '', 10);
      const to = Number.parseInt(rawTo ?? '', 10);
      // The kind is read back off the button rather than captured, because the delegated listener
      // outlives every button it handles and only the DOM knows which one was actually clicked.
      // Map the attribute back onto a known kind: link, fidelity and lint ranges are source offsets, and anything
      // else is read as a spelling span, the one kind measured in ProseMirror positions.
      const kind: ProblemKind =
        rawKind === 'link' || rawKind === 'fidelity' || rawKind === 'lint' || rawKind === 'grammar'
          ? rawKind
          : 'spelling';

      // Check whether both from and to offsets are finite numbers.
      if (Number.isFinite(from) && Number.isFinite(to)) {
        // Both offsets are finite: reveal target range in document.
        options.reveal(kind, from, to);
      } else {
        // Invalid or non-finite offsets: ignore click.
      }
    },
    { signal },
  );

  /**
   * Cleans up all problems panel resources and event listeners.
   * @purpose Idempotently aborts controller signal and clears body children.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> clear bodyElement children -> set destroyed flag.
   * @controlflow Check destroyed flag -> if destroyed return early; else mark destroyed -> abort signal -> clear body.
   */
  function destroy(): void {
    // Check whether the panel has already been destroyed.
    if (destroyed) {
      // Already destroyed: return early to ensure idempotency.
      return;
    } else {
      // Active panel: mark as destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    bodyElement.replaceChildren();
  }

  refresh();

  return {
    element: rootElement,
    refresh,
    destroy,
  };
}
