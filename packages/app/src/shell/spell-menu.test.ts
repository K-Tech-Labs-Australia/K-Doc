// @vitest-environment jsdom

/**
 * @file spell-menu.test.ts
 * @purpose Vitest test suite for K-Doc's context menu spelling entries builder (packages/app/src/shell/spell-menu.ts).
 *   Verifies caret-aware spelling suggestion items, enabled state guarding, suggestion capping, no-suggestions fallback,
 *   and callback delegation for correction, ignore-all, and add-to-dictionary.
 * @inputs EditorView instances configured with kdocSchema and createSpellPlugin, and fake SpellCheck object literals.
 * @outputs Vitest assertions verifying returned PopupMenuEntry arrays, IDs, labels, enabled states, and execution callbacks.
 * @functions
 *   - createTestDoc: Helper constructing a ProseMirror document node containing paragraph text.
 *   - createTestEditor: Helper mounting an EditorView with kdocSchema and createSpellPlugin into the DOM.
 *   - setCaret: Helper dispatching a TextSelection transaction to place the editor caret at a specific position.
 *   - createFakeSpellCheck: Helper constructing a controllable fake SpellCheck object literal implementing the full interface.
 * @dataflow EditorView caret position + fake SpellCheck -> buildSpellEntries -> PopupMenuEntry array -> assertions.
 * @controlflow Mount EditorView and fake SpellCheck -> execute test cases across empty/disabled states, suggestion capping, fallback items, and action callbacks -> tear down views in afterEach.
 * @version 2
 * @date 2026-09-18
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema, createSpellPlugin } from '@k-doc/editor';
import type { WordSpan } from '@k-doc/editor';
import type { PopupMenuEntry, PopupMenuItem } from './popup-menu.js';
import type { SpellCheck } from './spell-check.js';
import {
  buildSpellEntries,
  MAX_MENU_SUGGESTIONS,
} from './spell-menu.js';

let activeMounts: HTMLElement[] = [];
let activeViews: EditorView[] = [];

afterEach((): void => {
  for (let i = 0; i < activeViews.length; i++) {
    const v: EditorView | undefined = activeViews[i];
    // Check if editor view instance exists.
    if (v !== undefined) {
      // Branch: Defined view; destroy editor instance.
      v.destroy();
    } else {
      // Branch: Undefined array slot.
    }
  }
  activeViews = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const m: HTMLElement | undefined = activeMounts[i];
    // Check if mount element exists.
    if (m !== undefined) {
      // Branch: Defined element; remove from DOM.
      m.remove();
    } else {
      // Branch: Undefined array slot.
    }
  }
  activeMounts = [];
});

/**
 * Creates a standard ProseMirror test document node containing a single paragraph.
 *
 * @purpose Constructs a valid ProseMirror document tree for testing editor interactions.
 * @inputs text: string - Text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The root doc node.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Wrap text in paragraph if non-empty; otherwise create empty paragraph -> return doc.
 */
function createTestDoc(text: string): ProseMirrorNode {
  // Check if the provided text string is non-empty.
  if (text.length === 0) {
    // Branch: Empty text string; construct paragraph with no child nodes.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, []),
    ]);
  } else {
    // Branch: Non-empty text string; construct paragraph containing text leaf.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
    ]);
  }
}

/**
 * Instantiates and mounts a real ProseMirror EditorView into document.body.
 *
 * @purpose Sets up a functional EditorView with kdocSchema and createSpellPlugin attached.
 * @inputs text: string - Initial text content for the test document.
 * @outputs Object containing the mounted EditorView and mount container HTMLElement.
 * @dataflow text -> createTestDoc -> EditorState.create -> new EditorView -> active registry.
 * @controlflow Allocate div -> append to DOM -> create state with plugin -> instantiate view -> return record.
 */
function createTestEditor(text: string): {
  readonly view: EditorView;
  readonly mount: HTMLElement;
} {
  const mount: HTMLElement = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const doc: ProseMirrorNode = createTestDoc(text);
  const state: EditorState = EditorState.create({
    schema: kdocSchema,
    doc,
    plugins: [createSpellPlugin()],
  });

  const view: EditorView = new EditorView(mount, { state });
  activeViews.push(view);
  return { view, mount };
}

/**
 * Dispatches a ProseMirror transaction placing a collapsed caret at the given document position.
 *
 * @purpose Sets the active editor selection to a specific text position.
 * @inputs
 *   - view: EditorView - The target ProseMirror editor view.
 *   - pos: number - Target document position for the collapsed selection.
 * @outputs void.
 * @dataflow pos -> TextSelection.create -> view.state.tr.setSelection -> view.dispatch.
 * @controlflow Create collapsed TextSelection at pos -> set selection on transaction -> dispatch transaction.
 */
function setCaret(view: EditorView, pos: number): void {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, pos));
  view.dispatch(tr);
}

/**
 * Options for configuring the fake SpellCheck test harness.
 */
interface FakeSpellCheckOptions {
  readonly isEnabled?: boolean;
  readonly spans?: readonly WordSpan[];
  readonly suggestions?: readonly string[];
}

/**
 * Recording harness exposing a fake SpellCheck controller alongside recorded call parameters.
 */
interface FakeSpellCheckHarness {
  readonly spell: SpellCheck;
  readonly correctCalls: Array<{ readonly span: WordSpan; readonly replacement: string }>;
  readonly ignoreAllCalls: string[];
  readonly addToDictionaryCalls: string[];
  setEnabled(enabled: boolean): void;
  setSpans(spans: readonly WordSpan[]): void;
  setSuggestions(suggestions: readonly string[]): void;
}

/**
 * Creates a controllable fake SpellCheck object literal implementing the complete SpellCheck interface.
 *
 * @purpose Emulates the SpellCheck controller interface for deterministic testing of buildSpellEntries.
 * @inputs options?: FakeSpellCheckOptions - Optional initial configuration for enabled state, word spans, and suggestions.
 * @outputs FakeSpellCheckHarness - Controller instance and call recording structures.
 * @dataflow Method invocations -> recording arrays -> test assertion verification.
 * @controlflow Initialize tracking state -> construct SpellCheck literal with all required methods -> return harness.
 */
function createFakeSpellCheck(options?: FakeSpellCheckOptions): FakeSpellCheckHarness {
  let enabled: boolean = options?.isEnabled ?? true;
  let currentSpans: readonly WordSpan[] = options?.spans ?? [];
  let currentSuggestions: readonly string[] = options?.suggestions ?? [];

  const correctCalls: Array<{ readonly span: WordSpan; readonly replacement: string }> = [];
  const ignoreAllCalls: string[] = [];
  const addToDictionaryCalls: string[] = [];

  const spell: SpellCheck = {
    get isEnabled(): boolean {
      return enabled;
    },
    get language(): string {
      return 'en-GB';
    },
    setLanguage(): void {},
    reload(): void {},
    setEnabled(nextEnabled: boolean): void {
      enabled = nextEnabled;
    },
    schedule(): void {
      // Fake schedule; no timer scheduling required in synchronous test harness.
    },
    async checkNow(): Promise<void> {
      // Fake checkNow; resolves immediately.
    },
    misspellingAt(pos: number): WordSpan | null {
      // Walk recorded spans to find any span containing pos.
      for (let i = 0; i < currentSpans.length; i++) {
        const span: WordSpan | undefined = currentSpans[i];
        // Check if span is defined under strict index access.
        if (span === undefined) {
          // Branch: Undefined array element; skip.
          continue;
        } else {
          // Branch: Defined span; check if pos falls within [from, to] bounds.
          if (pos >= span.from && pos <= span.to) {
            // Branch: Position is within span bounds; return containing WordSpan.
            return span;
          } else {
            // Branch: Position outside this span; continue search.
          }
        }
      }
      return null;
    },
    misspellings(): readonly WordSpan[] {
      return currentSpans;
    },
    correct(span: WordSpan, replacement: string): void {
      correctCalls.push({ span, replacement });
    },
    async suggest(_word: string): Promise<readonly string[]> {
      return currentSuggestions;
    },
    ignoreAll(word: string): void {
      ignoreAllCalls.push(word);
    },
    async addToDictionary(word: string): Promise<void> {
      addToDictionaryCalls.push(word);
    },
    destroy(): void {
      // Fake destroy; no resources to release.
    },
  };

  return {
    spell,
    correctCalls,
    ignoreAllCalls,
    addToDictionaryCalls,
    setEnabled(val: boolean): void {
      enabled = val;
    },
    setSpans(spans: readonly WordSpan[]): void {
      currentSpans = spans;
    },
    setSuggestions(suggestions: readonly string[]): void {
      currentSuggestions = suggestions;
    },
  };
}

describe('spell-menu', (): void => {
  it('returns empty array when caret is outside any misspelling', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: ['world'],
    });

    // Caret at position 2 is inside 'Hello', outside the misspelled span.
    setCaret(view, 2);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });
    expect(entries).toEqual([]);
  });

  it('returns empty array when isEnabled is false even with caret inside a misspelling', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: false,
      spans: [span],
      suggestions: ['world'],
    });

    // Caret at position 8 is inside 'wrld'.
    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });
    expect(entries).toEqual([]);
  });

  it('produces three suggestion items, a separator, Ignore All, and Add to Dictionary with correct ids', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: ['world', 'word', 'wild'],
    });

    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });

    // Assert the exact id list (representing separators by 'separator').
    const idList: string[] = entries.map((entry: PopupMenuEntry): string => {
      // Check if entry is a separator or a menu item.
      if ('separator' in entry) {
        // Branch: Separator entry.
        return 'separator';
      } else {
        // Branch: Menu item entry.
        return entry.id;
      }
    });

    expect(idList).toEqual([
      'spell:suggest:0',
      'spell:suggest:1',
      'spell:suggest:2',
      'separator',
      'spell:ignore-all',
      'spell:add-to-dictionary',
    ]);

    // Verify individual item properties.
    expect(entries[0]).toMatchObject({
      id: 'spell:suggest:0',
      label: 'world',
      hint: '',
      enabled: true,
    });
    expect(entries[1]).toMatchObject({
      id: 'spell:suggest:1',
      label: 'word',
      hint: '',
      enabled: true,
    });
    expect(entries[2]).toMatchObject({
      id: 'spell:suggest:2',
      label: 'wild',
      hint: '',
      enabled: true,
    });
    expect(entries[3]).toEqual({ separator: true });
    expect(entries[4]).toMatchObject({
      id: 'spell:ignore-all',
      label: 'Ignore All',
      hint: '',
      enabled: true,
    });
    expect(entries[5]).toMatchObject({
      id: 'spell:add-to-dictionary',
      label: 'Add to Dictionary',
      hint: '',
      enabled: true,
    });
  });

  it('caps ten suggestions to MAX_MENU_SUGGESTIONS (5)', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const tenSuggestions: readonly string[] = [
      'sug0', 'sug1', 'sug2', 'sug3', 'sug4',
      'sug5', 'sug6', 'sug7', 'sug8', 'sug9',
    ];
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: tenSuggestions,
    });

    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });

    // Expect MAX_MENU_SUGGESTIONS (5) + 1 separator + 2 actions = 8 entries.
    expect(entries).toHaveLength(MAX_MENU_SUGGESTIONS + 3);

    const suggestionItems: PopupMenuItem[] = entries.filter((e): e is PopupMenuItem => !('separator' in e) && e.id.startsWith('spell:suggest:'));
    expect(suggestionItems).toHaveLength(MAX_MENU_SUGGESTIONS);
    expect(suggestionItems.map((s: PopupMenuItem): string => s.label)).toEqual(['sug0', 'sug1', 'sug2', 'sug3', 'sug4']);
  });

  it('gives one disabled spell:no-suggestions item when suggestions are empty while retaining enabled actions', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: [],
    });

    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });

    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      id: 'spell:no-suggestions',
      label: 'No suggestions',
      hint: '',
      enabled: false,
      run: expect.any(Function),
    });
    expect(entries[1]).toEqual({ separator: true });
    expect(entries[2]).toMatchObject({
      id: 'spell:ignore-all',
      label: 'Ignore All',
      hint: '',
      enabled: true,
    });
    expect(entries[3]).toMatchObject({
      id: 'spell:add-to-dictionary',
      label: 'Add to Dictionary',
      hint: '',
      enabled: true,
    });

    // Running the disabled placeholder item is a no-op and does not throw.
    const noSugItem: PopupMenuEntry | undefined = entries[0];
    // Check if the item has a run function.
    if (noSugItem !== undefined && 'run' in noSugItem) {
      // Branch: Item has run method; verify invocation completes safely.
      expect((): void => {
        noSugItem.run();
      }).not.toThrow();
    } else {
      // Branch: Missing or invalid item; fail assertion.
      expect.fail('Expected PopupMenuItem with run method at index 0');
    }
  });

  it('calls spell.correct with the right span and replacement when running a suggestion item', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: ['world'],
    });

    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });
    const suggestItem: PopupMenuEntry | undefined = entries[0];

    // Check if the entry is a valid menu item.
    if (suggestItem !== undefined && !('separator' in suggestItem)) {
      // Branch: Valid menu item; invoke run().
      suggestItem.run();
    } else {
      // Branch: Invalid or separator entry; fail test.
      expect.fail('Expected suggestion menu item at index 0');
    }

    expect(fake.correctCalls).toEqual([
      { span, replacement: 'world' },
    ]);
  });

  it('calls ignoreAll with the word and addToDictionary when running their respective items', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrld test');
    const span: WordSpan = { from: 7, to: 11, word: 'wrld' };
    const fake = createFakeSpellCheck({
      isEnabled: true,
      spans: [span],
      suggestions: ['world'],
    });

    setCaret(view, 8);

    const entries: readonly PopupMenuEntry[] = await buildSpellEntries({ spell: fake.spell, view });

    // Locate Ignore All and Add to Dictionary items.
    const ignoreItem: PopupMenuItem | undefined = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.id === 'spell:ignore-all');
    const addItem: PopupMenuItem | undefined = entries.find((e): e is PopupMenuItem => !('separator' in e) && e.id === 'spell:add-to-dictionary');

    // Check if ignore item exists.
    if (ignoreItem !== undefined) {
      // Branch: Found ignore item; execute run().
      ignoreItem.run();
    } else {
      // Branch: Ignore item missing; fail test.
      expect.fail('Expected spell:ignore-all menu item');
    }
    expect(fake.ignoreAllCalls).toEqual(['wrld']);

    // Check if add-to-dictionary item exists.
    if (addItem !== undefined) {
      // Branch: Found add-to-dictionary item; execute run().
      addItem.run();
    } else {
      // Branch: Add to dictionary item missing; fail test.
      expect.fail('Expected spell:add-to-dictionary menu item');
    }
    expect(fake.addToDictionaryCalls).toEqual(['wrld']);
  });
});
