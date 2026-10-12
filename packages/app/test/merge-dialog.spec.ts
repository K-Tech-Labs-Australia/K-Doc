// @vitest-environment jsdom

/**
 * @file merge-dialog.spec.ts
 * @purpose Vitest test suite for K-Doc's MergeDialog component (FR-6.4), verifying three-way merge presentation, conflict resolution choices, and modal lifecycle.
 * @inputs Synthetic DOM click events, MergeResult structures from three-way merges, and file names.
 * @outputs Vitest assertions verifying dialog open states, rendered text contents, selected hunk sides, and MergeOutcome Promise resolutions.
 * @functions
 *   - open: Installs a dialog, opens it on the given merge result, tracks it for lifecycle cleanup, and returns the controller and pending promise.
 *   - clickLabelled: Locates a button in document by its trimmed textContent and clicks it, failing the test if missing.
 * @dataflow Test fixtures -> mergeThreeWay -> open() -> MergeDialog rendering -> synthetic button clicks -> MergeOutcome Promise resolution -> Vitest assertions.
 * @controlflow Initialize activeDialogs tracking -> execute test cases exercising modal open/close, heading, conflict display, default choice, side picking, selection styling, non-conflict changes, ask replacement, and stylesheet exports -> destroy all dialogs in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installMergeDialog, MERGE_DIALOG_STYLES } from '../src/shell/merge-dialog.js';
import type { MergeDialog, MergeOutcome } from '../src/shell/merge-dialog.js';
import { mergeThreeWay } from '@k-doc/core';
import type { MergeResult } from '@k-doc/core';

let activeDialogs: MergeDialog[] = [];

afterEach((): void => {
  for (const dialog of activeDialogs) {
    dialog.destroy();
  }
  activeDialogs = [];
});

/**
 * Installs a dialog, opens it on the given merge, and hands back both the promise and the dialog.
 *
 * @purpose Installs a new MergeDialog, opens it with the provided merge result, tracks it for lifecycle cleanup, and returns the dialog controller and outcome promise.
 * @inputs
 *   - result: MergeResult - The three-way merge result to display.
 *   - fileName: string - Optional file name displayed in the dialog heading (defaults to 'test.md').
 * @outputs { readonly dialog: MergeDialog; readonly answer: Promise<MergeOutcome> } - Object containing the dialog controller and pending answer promise.
 * @dataflow result, fileName -> installMergeDialog -> dialog.ask -> activeDialogs tracking -> return { dialog, answer }.
 * @controlflow Install merge dialog with document -> track dialog in activeDialogs array -> invoke dialog.ask -> return dialog controller and answer promise.
 */
function open(
  result: MergeResult,
  fileName: string = 'test.md',
): { readonly dialog: MergeDialog; readonly answer: Promise<MergeOutcome> } {
  const dialog = installMergeDialog({ doc: document });
  activeDialogs.push(dialog);
  const answer = dialog.ask(fileName, result);
  return { dialog, answer };
}

/**
 * The dialog that is currently on screen.
 *
 * @purpose Returns the open dialog element, which is the only one a user could click.
 * @inputs None.
 * @outputs HTMLDialogElement - The open dialog.
 * @dataflow document -> querySelector('dialog[open]') -> element.
 * @controlflow Fails the test when nothing is open, rather than returning null for a caller to trip over.
 *
 * A closed dialog stays in the document until the component is destroyed, so a query across the whole
 * document finds buttons nobody can see and clicks them. Scoping to `[open]` is what a user is limited to.
 */
function openDialog(): HTMLDialogElement {
  const el = document.querySelector<HTMLDialogElement>('dialog[open]');
  // Check whether a dialog is open at all.
  if (el === null) {
    // Nothing open: the test is about to assert against a dialog that is not on screen.
    expect.fail('Expected a dialog to be open');
  } else {
    // One is open: it is the only thing a user could be clicking.
    return el;
  }
}

/**
 * Clicks the button in the open dialog whose visible label is exactly `label`.
 *
 * @purpose Drives the dialog the way a user does, by the words on the button.
 * @inputs label: string - The exact trimmed textContent to look for.
 * @outputs void.
 * @dataflow openDialog -> querySelectorAll('button') -> find by trimmed textContent -> click().
 * @controlflow Fails the test when the open dialog has no such button.
 */
function clickLabelled(label: string): void {
  const buttons = Array.from(openDialog().querySelectorAll<HTMLButtonElement>('button'));
  const target = buttons.find((btn: HTMLButtonElement): boolean => btn.textContent?.trim() === label);
  // Check if a button matching the label was found in the open dialog.
  if (target !== undefined) {
    // Matching button found: trigger click event.
    target.click();
  } else {
    // Matching button not found: fail test immediately with descriptive message.
    expect.fail(`Button labelled "${label}" was not found in the open dialog`);
  }
}

/**
 * Clicks a conflict column in the open dialog and hands the button back.
 *
 * @purpose Picks a side for a conflict the way a user does, and returns the control so its state can be read.
 * @inputs side: 'mine' | 'theirs' - Which column to click.
 * @outputs HTMLButtonElement - The column header that was clicked.
 * @dataflow openDialog -> querySelector by data-side -> click() -> the element.
 * @controlflow Fails the test when the open dialog has no such column.
 */
function pick(side: 'mine' | 'theirs'): HTMLButtonElement {
  const button = openDialog().querySelector<HTMLButtonElement>(`[data-side="${side}"]`);
  // Check whether the open dialog offers that column.
  if (button === null) {
    // Absent: there is no conflict on screen to pick a side for.
    expect.fail(`No [data-side="${side}"] column in the open dialog`);
  } else {
    // Present: click it and hand it back so its pressed state can be asserted.
    button.click();
    return button;
  }
}

/** A base, a buffer version and a disk version that conflict on exactly one line. */
const BASE: string = 'alpha\nbravo\ncharlie\n';
const MINE: string = 'alpha\nMINE\ncharlie\n';
const THEIRS: string = 'alpha\nTHEIRS\ncharlie\n';

describe('MergeDialog', (): void => {
  it('opens and closes', async (): Promise<void> => {
    const { dialog, answer } = open(mergeThreeWay(BASE, MINE, THEIRS));
    expect(dialog.isOpen).toBe(true);

    clickLabelled('Decide later');
    const outcome = await answer;

    expect(outcome.kind).toBe('cancelled');
    expect(dialog.isOpen).toBe(false);
  });

  it('shows the file name in its heading', async (): Promise<void> => {
    const { answer } = open(mergeThreeWay(BASE, MINE, THEIRS), 'notes.md');
    expect(openDialog().textContent).toContain('notes.md');

    // Settle dialog afterwards so nothing leaks.
    clickLabelled('Decide later');
    await answer;
  });

  it('shows both sides of a conflict at once', async (): Promise<void> => {
    const { answer } = open(mergeThreeWay(BASE, MINE, THEIRS));
    // Seeing both is the entire point of a merge view; a dialog that showed one at a time would just be
    // the old two-way prompt with extra steps.
    const text = openDialog().textContent ?? '';
    expect(text).toContain('MINE');
    expect(text).toContain('THEIRS');

    // Settle dialog afterwards so nothing leaks.
    clickLabelled('Decide later');
    await answer;
  });

  it('defaults a conflict to the buffer, not to disk', async (): Promise<void> => {
    const { answer } = open(mergeThreeWay(BASE, MINE, THEIRS));

    // An unanswered question must never cost the user their unsaved work.
    clickLabelled('Apply merge');
    const outcome = await answer;

    expect(outcome).toEqual({ kind: 'merged', text: MINE });
  });

  it('takes the side the user picks', async (): Promise<void> => {
    const first = open(mergeThreeWay(BASE, MINE, THEIRS));
    pick('theirs');

    clickLabelled('Apply merge');
    const firstOutcome = await first.answer;
    expect(firstOutcome).toEqual({ kind: 'merged', text: THEIRS });

    // A choice must be changeable: run a fresh dialog, click theirs and then mine.
    const second = open(mergeThreeWay(BASE, MINE, THEIRS));
    pick('theirs');
    pick('mine');

    clickLabelled('Apply merge');
    const secondOutcome = await second.answer;
    expect(secondOutcome).toEqual({ kind: 'merged', text: MINE });
  });

  it('marks the picked column and unmarks the other', async (): Promise<void> => {
    const { answer } = open(mergeThreeWay(BASE, MINE, THEIRS));
    const theirsBtn = pick('theirs');
    const mineBtn = openDialog().querySelector<HTMLButtonElement>('[data-side="mine"]');
    expect(theirsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(mineBtn?.getAttribute('aria-pressed')).toBe('false');

    // Settle dialog afterwards so nothing leaks.
    clickLabelled('Decide later');
    await answer;
  });

  it('reports keeping mine and using theirs without merging', async (): Promise<void> => {
    // Neither carries a text, because both name a version that already exists.
    const first = open(mergeThreeWay(BASE, MINE, THEIRS));
    clickLabelled('Keep mine');
    const firstOutcome = await first.answer;
    expect(firstOutcome).toEqual({ kind: 'keepMine' });

    // Neither carries a text, because both name a version that already exists.
    const second = open(mergeThreeWay(BASE, MINE, THEIRS));
    clickLabelled('Use theirs');
    const secondOutcome = await second.answer;
    expect(secondOutcome).toEqual({ kind: 'takeTheirs' });
  });

  it("takes changes that are not in each other's way without asking", async (): Promise<void> => {
    const result = mergeThreeWay('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n');
    expect(result.conflictCount).toBe(0);

    // The dialog still opens because the user has to be told the file changed, but there is nothing to ask.
    const { answer } = open(result);
    clickLabelled('Apply merge');
    const outcome = await answer;

    expect(outcome).toEqual({ kind: 'merged', text: 'A\nb\nC\n' });
  });

  it('settles an outstanding ask rather than leaving it hanging', async (): Promise<void> => {
    const { dialog, answer: firstAnswer } = open(mergeThreeWay(BASE, MINE, THEIRS));

    // Call ask a second time on the same dialog without settling the first.
    const secondAnswer = dialog.ask('second.md', mergeThreeWay(BASE, MINE, THEIRS));

    // A caller left awaiting a promise that never settles is a hang, not an error message.
    const firstOutcome = await firstAnswer;
    expect(firstOutcome).toEqual({ kind: 'cancelled' });

    // Settle the second ask afterwards so nothing leaks.
    clickLabelled('Decide later');
    const secondOutcome = await secondAnswer;
    expect(secondOutcome).toEqual({ kind: 'cancelled' });
  });

  it('exports styles that name its own classes', (): void => {
    expect(typeof MERGE_DIALOG_STYLES).toBe('string');
    expect(MERGE_DIALOG_STYLES.length).toBeGreaterThan(0);
    expect(MERGE_DIALOG_STYLES).toContain('kdoc-merge');
  });
});
