// @vitest-environment jsdom

/**
 * @file split-pane-sizing.spec.ts
 * @purpose Vitest test suite verifying view-mode transitions and split-pane sizing rules in EditorShell.
 *   Ensures inline flex styles are cleared on non-split modes (WYSIWYG, Source, Preview) so stylesheet rules take over,
 *   that split divider ratio memory is preserved across mode round-trips, and that secondary panes remain open and sized.
 * @inputs EditorShell instances mounted in jsdom with various initial ViewModes and interactive view-mode transitions.
 * @outputs Vitest assertions verifying inline style.flex / style.flexGrow values, element visibility, split ratio restoration, and secondary pane state.
 * @functions
 *   - mountShell: Constructs an EditorShell instance within a fresh container, tracks it for teardown, and returns element handles.
 * @dataflow ViewMode transition -> setViewMode -> update style.flex and hidden flags -> DOM assertions on editor panes and dividers.
 * @controlflow beforeEach resets tracking -> each test mounts shell -> executes mode transitions -> asserts flex styles -> afterEach tears down shells.
 * @version 1
 * @date 2026-09-20
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EditorShell, type ViewMode } from '../src/shell/editor-shell.js';
import type { SplitDivider } from '../src/shell/split-divider.js';

/** Container elements appended to document.body during tests, tracked for teardown. */
let mounts: HTMLElement[] = [];

/** Active EditorShell instances, tracked for destruction in afterEach. */
let shells: EditorShell[] = [];

beforeEach((): void => {
  mounts = [];
  shells = [];
});

afterEach((): void => {
  // Destroy each shell instance to cleanly tear down listeners, timers, and editor bindings.
  for (const shell of shells) {
    shell.destroy();
  }
  shells = [];

  // Remove test container elements from document body.
  for (const mount of mounts) {
    // Check if mount element remains attached to document body.
    if (mount.parentNode !== null) {
      // Attached: remove element from DOM.
      mount.parentNode.removeChild(mount);
    } else {
      // Detached: no action required.
    }
  }
  mounts = [];
});

/**
 * Interface exposing EditorShell DOM element handles and controller references for sizing assertions.
 */
interface ShellHarness {
  readonly shell: EditorShell;
  readonly mount: HTMLElement;
  readonly wysiwygPane: HTMLElement;
  readonly sourcePane: HTMLElement;
  readonly splitDividerElement: HTMLElement;
  readonly secondaryPane: HTMLElement;
  readonly secondaryDividerElement: HTMLElement;
  readonly splitDivider: SplitDivider;
  toggleSecondaryPane(): void;
}

/**
 * Instantiates an EditorShell in document.body with specified initial view mode and tracks it for afterEach teardown.
 *
 * @purpose Mounts an isolated EditorShell fixture in jsdom and provides typed handles to internal pane elements.
 * @inputs initialViewMode - Optional target ViewMode ('wysiwyg' | 'split' | 'source') defaulting to 'split'.
 * @outputs ShellHarness - Handle containing shell instance and DOM element references.
 * @dataflow createElement -> append to body -> instantiate EditorShell -> extract pane references -> return ShellHarness.
 * @controlflow Create mount div -> push to mounts -> instantiate EditorShell -> push to shells -> cast to access pane references -> return harness.
 */
function mountShell(initialViewMode: ViewMode = 'split'): ShellHarness {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  mounts.push(mount);

  const shell = new EditorShell({
    mount,
    initialText: '# Sizing Test\n\nTesting view-mode split sizing.',
    initialViewMode,
  });
  shells.push(shell);

  const shellInternal = shell as unknown as {
    wysiwygPane: HTMLElement;
    sourcePane: HTMLElement;
    splitDividerElement: HTMLElement;
    secondaryPane: HTMLElement;
    secondaryDividerElement: HTMLElement;
    splitDivider: SplitDivider;
    toggleSecondaryPane(): void;
  };

  return {
    shell,
    mount,
    wysiwygPane: shellInternal.wysiwygPane,
    sourcePane: shellInternal.sourcePane,
    splitDividerElement: shellInternal.splitDividerElement,
    secondaryPane: shellInternal.secondaryPane,
    secondaryDividerElement: shellInternal.secondaryDividerElement,
    splitDivider: shellInternal.splitDivider,
    toggleSecondaryPane: (): void => {
      shellInternal.toggleSecondaryPane();
    },
  };
}

describe('EditorShell view-mode split-pane sizing', (): void => {
  it('(1) entering split then switching to wysiwyg leaves NO inline flex on the wysiwyg pane', (): void => {
    const { shell, wysiwygPane, sourcePane, splitDividerElement } = mountShell('split');

    // Verify initial split state: both panes sized proportionally by the divider (0.5 flexGrow).
    expect(wysiwygPane.style.flexGrow).toBe('0.5');
    expect(sourcePane.style.flexGrow).toBe('0.5');
    expect(splitDividerElement.hidden).toBe(false);

    // Switch view mode to wysiwyg.
    shell.setViewMode('wysiwyg');

    // In WYSIWYG mode, the WYSIWYG pane must have NO inline flex so stylesheet flex: 1 takes over.
    expect(wysiwygPane.style.flex).toBe('');
    expect(wysiwygPane.style.flexGrow).toBe('');
    expect(sourcePane.style.flex).toBe('');
    expect(sourcePane.style.flexGrow).toBe('');
    expect(wysiwygPane.hidden).toBe(false);
    expect(sourcePane.hidden).toBe(true);
    expect(splitDividerElement.hidden).toBe(true);
  });

  it('(2) switching from split to source leaves NO inline flex on the source pane, and switching to preview leaves NO inline flex on the wysiwyg pane', (): void => {
    const { shell, wysiwygPane, sourcePane, splitDividerElement } = mountShell('split');

    // Verify initial split state.
    expect(wysiwygPane.style.flexGrow).toBe('0.5');
    expect(sourcePane.style.flexGrow).toBe('0.5');

    // Switch to source mode.
    shell.setViewMode('source');

    // In Source mode, both panes must have inline flex cleared so source pane takes full width via stylesheet.
    expect(sourcePane.style.flex).toBe('');
    expect(sourcePane.style.flexGrow).toBe('');
    expect(wysiwygPane.style.flex).toBe('');
    expect(wysiwygPane.style.flexGrow).toBe('');
    expect(sourcePane.hidden).toBe(false);
    expect(wysiwygPane.hidden).toBe(true);
    expect(splitDividerElement.hidden).toBe(true);

    // Re-enter split mode.
    shell.setViewMode('split');
    expect(wysiwygPane.style.flexGrow).toBe('0.5');
    expect(sourcePane.style.flexGrow).toBe('0.5');

    // Switch to WYSIWYG mode.
    shell.setViewMode('wysiwyg');

    // In WYSIWYG mode, both panes must have inline flex cleared so the WYSIWYG pane takes full width.
    expect(wysiwygPane.style.flex).toBe('');
    expect(wysiwygPane.style.flexGrow).toBe('');
    expect(sourcePane.style.flex).toBe('');
    expect(sourcePane.style.flexGrow).toBe('');
    expect(wysiwygPane.hidden).toBe(false);
    expect(sourcePane.hidden).toBe(true);
    expect(splitDividerElement.hidden).toBe(true);
  });

  it('(3) dragging the divider then leaving split then returning to split still honours the divider ratio logic', (): void => {
    const { shell, wysiwygPane, sourcePane, splitDivider } = mountShell('split');

    // Simulate user dragging the split divider to 0.7 (70% left, 30% right).
    splitDivider.setRatio(0.7);
    expect(splitDivider.ratio).toBe(0.7);
    expect(wysiwygPane.style.flexGrow).toBe('0.7');
    expect(sourcePane.style.flexGrow).toBe('0.3');

    // Leave split mode for wysiwyg mode.
    shell.setViewMode('wysiwyg');
    expect(wysiwygPane.style.flex).toBe('');
    expect(sourcePane.style.flex).toBe('');

    // Return to split mode.
    shell.setViewMode('split');

    // The divider's 0.7 ratio must be restored and applied to both panes.
    expect(splitDivider.ratio).toBe(0.7);
    expect(wysiwygPane.style.flexGrow).toBe('0.7');
    expect(sourcePane.style.flexGrow).toBe('0.3');
  });

  it('(4) a secondary pane that was open before a view-mode change is still open and still sized after it', (): void => {
    const harness = mountShell('split');
    const { shell, secondaryPane, secondaryDividerElement } = harness;

    // Initially secondary pane is hidden.
    expect(secondaryPane.hidden).toBe(true);

    // Open secondary pane.
    harness.toggleSecondaryPane();

    // Verify secondary pane is open and sized.
    expect(secondaryPane.hidden).toBe(false);
    expect(secondaryDividerElement.hidden).toBe(false);
    expect(secondaryPane.style.flexGrow).toBe('0.5');

    // Transition to wysiwyg mode.
    shell.setViewMode('wysiwyg');

    // Secondary pane must remain open and sized.
    expect(secondaryPane.hidden).toBe(false);
    expect(secondaryDividerElement.hidden).toBe(false);
    expect(secondaryPane.style.flexGrow).toBe('0.5');

    // Transition to source mode.
    shell.setViewMode('source');

    // Secondary pane must still remain open and sized.
    expect(secondaryPane.hidden).toBe(false);
    expect(secondaryDividerElement.hidden).toBe(false);
    expect(secondaryPane.style.flexGrow).toBe('0.5');

    // Transition to WYSIWYG mode.
    shell.setViewMode('wysiwyg');

    // Secondary pane must still remain open and sized.
    expect(secondaryPane.hidden).toBe(false);
    expect(secondaryDividerElement.hidden).toBe(false);
    expect(secondaryPane.style.flexGrow).toBe('0.5');

    // Return to split mode.
    shell.setViewMode('split');

    // Secondary pane must still remain open and sized.
    expect(secondaryPane.hidden).toBe(false);
    expect(secondaryDividerElement.hidden).toBe(false);
    expect(secondaryPane.style.flexGrow).toBe('0.5');
  });
});
