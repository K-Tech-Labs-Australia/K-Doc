// @vitest-environment jsdom

/**
 * @file spell-dialog.test.ts
 * @purpose Vitest test suite for K-Doc's F7 document spelling review dialog (packages/app/src/shell/spell-dialog.ts).
 *   Verifies modal lifecycle, clean-state messaging, count and context indicators, suggestions population,
 *   keyboard navigation, back-to-front Change All, Ignore vs Ignore All semantics, and index clamping upon mutable shrinking.
 * @inputs Synthetic DOM click and keydown events, fake SpellCheck controller object literals, and WordSpan document coordinates.
 * @outputs Vitest assertions verifying DOM presence, text content, button enabled/disabled states, correct call signatures, and order.
 * @functions
 *   - createFakeSpell: Factory constructing a controllable fake SpellCheck controller backed by a mutable WordSpan array.
 * @dataflow Synthetic user events -> SpellDialog -> fake SpellCheck -> DOM state assertions.
 * @controlflow Mount SpellDialog with fake controller -> execute test scenarios -> destroy controllers and remove DOM nodes in afterEach.
 * @version 2
 * @date 2026-09-18
 */

import { describe, expect, it, afterEach } from 'vitest';
import type { WordSpan } from '@k-doc/editor';
import type { SpellCheck } from './spell-check.js';
import { installSpellDialog, SPELL_DIALOG_STYLES, type SpellDialog } from './spell-dialog.js';

// Stub HTMLDialogElement.prototype.showModal and close for jsdom environment.
if (typeof HTMLDialogElement !== 'undefined') {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
      this.open = true;
    };
  } else {
    // showModal already present.
  }

  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
      this.open = false;
    };
  } else {
    // close already present.
  }
} else {
  // HTMLDialogElement not defined.
}

interface FakeSpellCheckHarness {
  readonly spell: SpellCheck;
  readonly checkNowCalls: number;
  readonly correctCalls: { readonly span: WordSpan; readonly replacement: string }[];
  readonly ignoreAllCalls: string[];
  readonly addToDictionaryCalls: string[];
  readonly spans: WordSpan[];
  setSuggestions: (word: string, suggestions: readonly string[]) => void;
}

/**
 * Creates a controllable fake SpellCheck object literal backed by a mutable array.
 *
 * @purpose Emulates the SpellCheck controller interface for unit testing without editor engine dependencies.
 * @inputs initialSpans - WordSpan[] - Initial array of misspellings.
 * @outputs FakeSpellCheckHarness - Object containing the SpellCheck controller and recorded operation logs.
 * @dataflow initialSpans -> mutable spans array -> SpellCheck methods -> observation arrays.
 * @controlflow Copy initial spans -> wire SpellCheck methods with tracking and array mutations -> return harness.
 */
function createFakeSpell(initialSpans: WordSpan[] = []): FakeSpellCheckHarness {
  const spans: WordSpan[] = [...initialSpans];
  const correctCalls: { readonly span: WordSpan; readonly replacement: string }[] = [];
  const ignoreAllCalls: string[] = [];
  const addToDictionaryCalls: string[] = [];
  let checkNowCount: number = 0;
  const suggestionsMap = new Map<string, readonly string[]>();

  const spell: SpellCheck = {
    get isEnabled(): boolean {
      return true;
    },
    get language(): string {
      return 'en-GB';
    },
    setLanguage(): void {},
    reload(): void {},
    // The dialog never calls these four, but SpellCheck is the real interface and a fake that only
    // implements the parts under test would stop compiling the moment the dialog started using one.
    setEnabled(_enabled: boolean): void {
      // Not exercised by the dialog.
    },
    schedule(): void {
      // Not exercised by the dialog.
    },
    misspellingAt(_pos: number): WordSpan | null {
      return null;
    },
    destroy(): void {
      // Not exercised by the dialog.
    },
    async checkNow(): Promise<void> {
      checkNowCount++;
    },
    misspellings(): readonly WordSpan[] {
      return spans;
    },
    correct(span: WordSpan, replacement: string): void {
      correctCalls.push({ span, replacement });
      // Model a correction removing the entry from the mutable array.
      const index = spans.findIndex(
        (s: WordSpan): boolean => s.from === span.from && s.to === span.to && s.word === span.word,
      );
      if (index !== -1) {
        // Branch: Matching span found; remove from mutable array.
        spans.splice(index, 1);
      } else {
        // Branch: Span not found in array.
      }
    },
    async suggest(word: string): Promise<readonly string[]> {
      const found = suggestionsMap.get(word);
      if (found !== undefined) {
        // Branch: Custom suggestions configured; return them.
        return found;
      } else {
        // Branch: Default fallback suggestions.
        return [`${word}-fixed`, `${word}-alt`];
      }
    },
    ignoreAll(word: string): void {
      ignoreAllCalls.push(word);
      // Remove matching entries from spans array.
      for (let i = spans.length - 1; i >= 0; i--) {
        const s = spans[i];
        if (s !== undefined && s.word === word) {
          // Branch: Matching word; remove entry.
          spans.splice(i, 1);
        } else {
          // Branch: Non-matching entry.
        }
      }
    },
    async addToDictionary(word: string): Promise<void> {
      addToDictionaryCalls.push(word);
      // Remove matching entries from spans array.
      for (let i = spans.length - 1; i >= 0; i--) {
        const s = spans[i];
        if (s !== undefined && s.word === word) {
          // Branch: Matching word; remove entry.
          spans.splice(i, 1);
        } else {
          // Branch: Non-matching entry.
        }
      }
    },
  };

  return {
    spell,
    get checkNowCalls(): number {
      return checkNowCount;
    },
    correctCalls,
    ignoreAllCalls,
    addToDictionaryCalls,
    spans,
    setSuggestions(word: string, suggestions: readonly string[]): void {
      suggestionsMap.set(word, suggestions);
    },
  };
}

let activeDialogs: SpellDialog[] = [];

afterEach((): void => {
  // Destroy all active dialog instances.
  for (let i = 0; i < activeDialogs.length; i++) {
    const d = activeDialogs[i];
    if (d !== undefined) {
      // Branch: Active dialog reference; destroy.
      d.destroy();
    } else {
      // Branch: Skip undefined reference.
    }
  }
  activeDialogs = [];

  // Remove any lingering dialog elements from document.body.
  const lingering = document.body.querySelectorAll<HTMLDialogElement>('dialog.kdoc-spell-dialog');
  for (let i = 0; i < lingering.length; i++) {
    const el = lingering[i];
    if (el !== undefined && el.parentNode !== null) {
      // Branch: Lingering element attached to parent; remove.
      el.parentNode.removeChild(el);
    } else {
      // Branch: Element already removed.
    }
  }
});

describe('SPELL_DIALOG_STYLES', (): void => {
  it('overrides the user-agent hidden rule for the dialog panels', (): void => {
    // Asserted against the stylesheet string rather than against a rendered layout, because jsdom does
    // not do cascade resolution and this bug is purely one of specificity: .kdoc-spell-review-body sets
    // display: flex, which beat the user-agent [hidden] rule and left the empty review panels on screen
    // underneath "No spelling errors found." A behavioural test would have kept passing throughout.
    expect(SPELL_DIALOG_STYLES).toContain('.kdoc-spell-dialog [hidden]');
  });
});

describe('SpellDialog (packages/app/src/shell/spell-dialog.ts)', (): void => {
  it('opening with no misspellings shows the clean-result message and no Change button enabled', async (): Promise<void> => {
    const fake = createFakeSpell([]);
    const revealed: WordSpan[] = [];
    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (span: WordSpan): void => {
        revealed.push(span);
      },
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    expect(dialogEl).not.toBeNull();
    expect(dialogEl?.open).toBe(true);

    // Verify clean-result message is displayed.
    expect(dialogEl?.textContent).toContain('No spelling errors found.');

    // Verify Change button is disabled.
    const changeBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-change');
    expect(changeBtn?.disabled).toBe(true);

    // Verify no spans were revealed.
    expect(revealed.length).toBe(0);
  });

  it('opening with three shows 1 of 3 and the first word', async (): Promise<void> => {
    const spans: WordSpan[] = [
      { from: 0, to: 3, word: 'teh' },
      { from: 10, to: 14, word: 'wrok' },
      { from: 20, to: 24, word: 'teh' },
    ];
    const fake = createFakeSpell(spans);
    const revealed: WordSpan[] = [];
    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (span: WordSpan): void => {
        revealed.push(span);
      },
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    expect(dialogEl).not.toBeNull();
    expect(dialogEl?.open).toBe(true);

    // Verify 1 of 3 count and misspelled word are displayed.
    expect(dialogEl?.textContent).toContain('1 of 3');
    const wordEl = dialogEl?.querySelector('.kdoc-spell-word');
    expect(wordEl?.textContent).toBe('teh');

    // Verify first span was revealed.
    expect(revealed.length).toBe(1);
    expect(revealed[0]).toEqual({ from: 0, to: 3, word: 'teh' });
  });

  it('suggestions populate and the first is selected; ↓ moves the selection', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'teh' }];
    const fake = createFakeSpell(spans);
    fake.setSuggestions('teh', ['the', 'ten', 'tea']);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const items = dialogEl?.querySelectorAll<HTMLLIElement>('.kdoc-spell-suggestion-item');
    expect(items?.length).toBe(3);
    expect(items?.[0]?.textContent).toBe('the');
    expect(items?.[0]?.getAttribute('aria-selected')).toBe('true');
    expect(items?.[1]?.getAttribute('aria-selected')).toBe('false');

    // Press ArrowDown to move selection to second item.
    dialogEl?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(items?.[0]?.getAttribute('aria-selected')).toBe('false');
    expect(items?.[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('Change calls correct with the current span and the selected suggestion', async (): Promise<void> => {
    const spans: WordSpan[] = [
      { from: 0, to: 3, word: 'teh' },
      { from: 10, to: 14, word: 'wrok' },
    ];
    const fake = createFakeSpell(spans);
    fake.setSuggestions('teh', ['the', 'ten']);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const changeBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-change');
    expect(changeBtn).not.toBeNull();

    changeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fake.correctCalls.length).toBe(1);
    expect(fake.correctCalls[0]).toEqual({
      span: { from: 0, to: 3, word: 'teh' },
      replacement: 'the',
    });
  });

  it('Change All calls correct once per matching span and does so in descending from order', async (): Promise<void> => {
    const spans: WordSpan[] = [
      { from: 0, to: 3, word: 'teh' },
      { from: 10, to: 14, word: 'wrok' },
      { from: 20, to: 23, word: 'teh' },
      { from: 40, to: 43, word: 'teh' },
    ];
    const fake = createFakeSpell(spans);
    fake.setSuggestions('teh', ['the']);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const changeAllBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-change-all');
    expect(changeAllBtn).not.toBeNull();

    changeAllBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Verify correct was called for each matching span (from: 40, 20, 0 in descending order).
    expect(fake.correctCalls.length).toBe(3);
    expect(fake.correctCalls[0]).toEqual({
      span: { from: 40, to: 43, word: 'teh' },
      replacement: 'the',
    });
    expect(fake.correctCalls[1]).toEqual({
      span: { from: 20, to: 23, word: 'teh' },
      replacement: 'the',
    });
    expect(fake.correctCalls[2]).toEqual({
      span: { from: 0, to: 3, word: 'teh' },
      replacement: 'the',
    });
  });

  it('Ignore advances without calling ignoreAll; Ignore All calls it', async (): Promise<void> => {
    const spans: WordSpan[] = [
      { from: 0, to: 3, word: 'teh' },
      { from: 10, to: 14, word: 'wrok' },
    ];
    const fake = createFakeSpell(spans);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const ignoreBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-ignore');
    const ignoreAllBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-ignore-all');

    // Click Ignore on first word.
    ignoreBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Ignore should advance to word 2 ("wrok", "2 of 2") without calling ignoreAll.
    expect(fake.ignoreAllCalls.length).toBe(0);
    expect(dialogEl?.textContent).toContain('2 of 2');
    const wordEl = dialogEl?.querySelector('.kdoc-spell-word');
    expect(wordEl?.textContent).toBe('wrok');

    // Click Ignore All on second word.
    ignoreAllBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Ignore All should have called spell.ignoreAll with "wrok".
    expect(fake.ignoreAllCalls).toEqual(['wrok']);
  });

  it('the list is re-read after an action: clamps index when list shrinks', async (): Promise<void> => {
    const spans: WordSpan[] = [
      { from: 0, to: 3, word: 'teh' },
      { from: 10, to: 14, word: 'wrok' },
      { from: 20, to: 24, word: 'mispell' },
    ];
    const fake = createFakeSpell(spans);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const ignoreBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-ignore');

    // Advance to item 2 (index 1: "2 of 3").
    ignoreBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialogEl?.textContent).toContain('2 of 3');

    // Advance to item 3 (index 2: "3 of 3").
    ignoreBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialogEl?.textContent).toContain('3 of 3');

    // Now make the fake shrink externally from 3 items to 2 items.
    fake.spans.pop();
    expect(fake.spans.length).toBe(2);

    // Trigger an action to re-read list (e.g. Ignore).
    ignoreBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Assert that the index clamped to length - 1 (index 1: "2 of 2") rather than running past the end.
    expect(dialogEl?.textContent).toContain('2 of 2');
    const wordEl = dialogEl?.querySelector('.kdoc-spell-word');
    expect(wordEl?.textContent).toBe('wrok');
  });

  it('Escape closes the dialog', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'teh' }];
    const fake = createFakeSpell(spans);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    expect(dialog.isOpen).toBe(true);
    expect(dialogEl?.open).toBe(true);

    dialogEl?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dialog.isOpen).toBe(false);
    expect(dialogEl?.open).toBe(false);
  });

  it('shows (no suggestions) and disables Change and Change All buttons when suggestions are empty', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'xyzzy' }];
    const fake = createFakeSpell(spans);
    fake.setSuggestions('xyzzy', []);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    expect(dialogEl?.textContent).toContain('(no suggestions)');

    const changeBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-change');
    const changeAllBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-change-all');
    expect(changeBtn?.disabled).toBe(true);
    expect(changeAllBtn?.disabled).toBe(true);
  });

  it('Add to Dictionary calls spell.addToDictionary with current word', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'kdoc' }];
    const fake = createFakeSpell(spans);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    const addBtn = dialogEl?.querySelector<HTMLButtonElement>('.kdoc-spell-btn-add');
    addBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fake.addToDictionaryCalls).toEqual(['kdoc']);
  });

  it('Enter key triggers Change when focused within dialog', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'teh' }];
    const fake = createFakeSpell(spans);
    fake.setSuggestions('teh', ['the']);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });
    activeDialogs.push(dialog);

    await dialog.open();

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    dialogEl?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(fake.correctCalls.length).toBe(1);
    expect(fake.correctCalls[0]?.replacement).toBe('the');
  });

  it('destroy removes dialog DOM element and cleans up listeners', async (): Promise<void> => {
    const spans: WordSpan[] = [{ from: 0, to: 3, word: 'teh' }];
    const fake = createFakeSpell(spans);

    const dialog = installSpellDialog({
      doc: document,
      spell: fake.spell,
      reveal: (): void => {},
    });

    await dialog.open();
    expect(dialog.isOpen).toBe(true);

    dialog.destroy();
    expect(dialog.isOpen).toBe(false);

    const dialogEl = document.body.querySelector<HTMLDialogElement>('dialog.kdoc-spell-dialog');
    expect(dialogEl).toBeNull();
  });
});
