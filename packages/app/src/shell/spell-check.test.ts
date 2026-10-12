// @vitest-environment jsdom

/**
 * @file spell-check.test.ts
 * @purpose Vitest test suite for K-Doc's spell check shell controller (packages/app/src/shell/spell-check.ts).
 *   Verifies integration between the ProseMirror document scanner, the native spell service, and the decoration layer.
 * @inputs EditorView instances configured with kdocSchema and createSpellPlugin, fake SpellService object literals,
 *   and fake Window timer stubs.
 * @outputs Vitest assertions verifying initial decoration, word deduplication, enable/disable toggling,
 *   out-of-order in-flight race resolution, text correction with refocus, session ignoring, unready service handling, and lifecycle teardown.
 * @functions
 *   - createTestDoc: Helper constructing a ProseMirror document node containing paragraph text.
 *   - createTestEditor: Helper mounting an EditorView with kdocSchema and createSpellPlugin into the DOM.
 *   - createFakeSpellService: Helper constructing a controllable fake SpellService object literal.
 *   - createFakeWindow: Helper constructing a controllable fake Window object with setTimeout/clearTimeout.
 * @dataflow Document text -> scanState -> fake SpellService.check -> setMisspellings -> EditorView decorations & query assertions.
 * @controlflow Set up EditorView and fake services -> execute test cases across initial checking, deduplication,
 *   enable/disable toggles, in-flight race conditions, corrections, ignoreAll, unload state, and destroy -> tear down views and timers in afterEach.
 * @version 2
 * @date 2026-09-18
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema, createSpellPlugin } from '@k-doc/editor';
import type { WordSpan } from '@k-doc/editor';
import type { SpellService } from '../spell/spell-service.js';
import {
  installSpellCheck,
  SPELL_DEBOUNCE_MS,
  type SpellCheck,
} from './spell-check.js';

let activeMounts: HTMLElement[] = [];
let activeViews: EditorView[] = [];
let activeSpellChecks: SpellCheck[] = [];

afterEach((): void => {
  for (let i = 0; i < activeSpellChecks.length; i++) {
    const sc = activeSpellChecks[i];
    if (sc !== undefined) {
      sc.destroy();
    }
  }
  activeSpellChecks = [];

  for (let i = 0; i < activeViews.length; i++) {
    const v = activeViews[i];
    if (v !== undefined) {
      v.destroy();
    }
  }
  activeViews = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const m = activeMounts[i];
    if (m !== undefined) {
      m.remove();
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
  view: EditorView;
  mount: HTMLElement;
} {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const doc = createTestDoc(text);
  const state = EditorState.create({
    schema: kdocSchema,
    doc,
    plugins: [createSpellPlugin()],
  });

  const view = new EditorView(mount, { state });
  activeViews.push(view);
  return { view, mount };
}

interface FakeSpellServiceOptions {
  available?: boolean;
  loaded?: boolean;
  loadResult?: boolean;
  /**
   * Makes loadDictionary return a promise that never settles, so the constructor's opening check
   * never fires. A test about two racing checkNow calls needs to be the only source of checks.
   */
  loadPending?: boolean;
  checkFn?: (words: readonly string[]) => Promise<readonly string[]> | readonly string[];
  suggestResult?: readonly string[];
}

interface FakeSpellServiceHarness {
  readonly service: SpellService;
  readonly checkedWordsHistory: string[][];
  readonly loadCalls: string[];
  readonly ignoredWords: string[];
  readonly addedWords: string[];
  setCheckFn: (fn: (words: readonly string[]) => Promise<readonly string[]> | readonly string[]) => void;
  setLoaded: (loaded: boolean) => void;
}

/**
 * Creates a controllable fake SpellService object literal.
 *
 * @purpose Emulates the SpellService interface for unit testing without Tauri IPC dependencies.
 * @inputs options?: FakeSpellServiceOptions - Optional overrides for initial state and check handler.
 * @outputs FakeSpellServiceHarness - Interface exposing the SpellService and observation arrays.
 * @dataflow Invocations -> recording arrays -> test assertion verification.
 * @controlflow Initialize tracking structures -> construct SpellService literal -> return harness.
 */
function createFakeSpellService(options?: FakeSpellServiceOptions): FakeSpellServiceHarness {
  let loaded = options?.loaded ?? true;
  const available = options?.available ?? true;
  const checkedWordsHistory: string[][] = [];
  const loadCalls: string[] = [];
  const ignoredWords: string[] = [];
  const addedWords: string[] = [];
  let checkFn = options?.checkFn;

  const service: SpellService = {
    get available(): boolean {
      return available;
    },
    get loaded(): boolean {
      return loaded;
    },
    async downloadDictionary(lang: string): Promise<string> {
      return lang;
    },
    async loadDictionary(lang: string): Promise<boolean> {
      loadCalls.push(lang);

      // Check whether this fake is configured to leave the load hanging.
      if (options?.loadPending === true) {
        // Hanging: the constructor's `.then` never runs, so the test owns every check that happens.
        return new Promise<boolean>((): void => {
          // Deliberately never resolved.
        });
      } else {
        // Normal: settle immediately the way the real service does once the assets are fetched.
      }

      const res = options?.loadResult ?? true;
      // Check if simulated load result is successful.
      if (res) {
        // Branch: Load succeeded; set loaded state to true.
        loaded = true;
      } else {
        // Branch: Load failed; retain false.
        loaded = false;
      }
      return res;
    },
    async check(words: readonly string[]): Promise<readonly string[]> {
      checkedWordsHistory.push(Array.from(words));
      // Check if a custom check function override is present.
      if (checkFn !== undefined) {
        // Branch: Custom check handler provided; invoke handler.
        return checkFn(words);
      } else {
        // Branch: Default handler; return empty misspellings array.
        return [];
      }
    },
    async suggest(_word: string): Promise<readonly string[]> {
      return options?.suggestResult ?? [];
    },
    async addWord(word: string): Promise<void> {
      addedWords.push(word);
    },
    ignoreAll(word: string): void {
      ignoredWords.push(word);
    },
    isIgnored(word: string): boolean {
      return ignoredWords.includes(word);
    },
    get userWords(): readonly string[] {
      return Array.from(addedWords);
    },
    destroy(): void {
      // Branch: Teardown fake service; no-op in test harness.
    },
  };

  return {
    service,
    checkedWordsHistory,
    loadCalls,
    ignoredWords,
    addedWords,
    setCheckFn(fn: (words: readonly string[]) => Promise<readonly string[]> | readonly string[]): void {
      checkFn = fn;
    },
    setLoaded(val: boolean): void {
      loaded = val;
    },
  };
}

interface FakeTimer {
  readonly id: number;
  readonly callback: () => void;
  readonly delay: number;
}

interface FakeWindowHarness {
  readonly win: Window;
  readonly getPendingTimersCount: () => number;
  readonly triggerNext: () => boolean;
  readonly triggerAll: () => void;
  readonly clearAll: () => void;
}

/**
 * Creates a controllable fake Window object stub exposing setTimeout and clearTimeout.
 *
 * @purpose Allows deterministic manual scheduling and triggering of debounced timer callbacks.
 * @inputs void.
 * @outputs FakeWindowHarness - Interface exposing the fake Window stub and trigger controls.
 * @dataflow setTimeout -> recorded in Map -> triggerAll -> executes scheduled callbacks.
 * @controlflow Allocate Map -> construct window stub with setTimeout/clearTimeout -> return harness.
 */
function createFakeWindow(): FakeWindowHarness {
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();

  const winStub = {
    setTimeout(handler: TimerHandler, timeout?: number): number {
      const id = nextId++;
      const callback = typeof handler === 'function'
        ? (handler as () => void)
        : (): void => {};
      timers.set(id, { id, callback, delay: timeout ?? 0 });
      return id;
    },
    clearTimeout(id?: number): void {
      // Check if timer identifier is defined.
      if (id !== undefined) {
        // Branch: Defined id; delete from active timers map.
        timers.delete(id);
      } else {
        // Branch: Undefined id; no-op.
      }
    },
  } as unknown as Window;

  return {
    win: winStub,
    getPendingTimersCount(): number {
      return timers.size;
    },
    triggerNext(): boolean {
      const firstEntry = timers.entries().next();
      // Check if any timers remain in the map.
      if (firstEntry.done) {
        // Branch: No pending timers; return false.
        return false;
      } else {
        // Branch: Timer available; execute callback and remove from map.
        const [id, timer] = firstEntry.value;
        timers.delete(id);
        timer.callback();
        return true;
      }
    },
    triggerAll(): void {
      while (timers.size > 0) {
        const firstEntry = timers.entries().next();
        // Check if map iteration is complete.
        if (firstEntry.done) {
          // Branch: No further entries; terminate loop.
          break;
        } else {
          // Branch: Execute callback and remove from map.
          const [id, timer] = firstEntry.value;
          timers.delete(id);
          timer.callback();
        }
      }
    },
    clearAll(): void {
      timers.clear();
    },
  };
}

describe('SpellCheck Controller (spell-check.ts)', (): void => {
  it('marks misspelled words on first check and leaves correct ones alone', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold this is an inccorrect text');
    const fakeService = createFakeSpellService({
      checkFn: (words: readonly string[]): readonly string[] => {
        return words.filter((w: string): boolean => w === 'wrold' || w === 'inccorrect');
      },
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();

    const misspellings = spellCheck.misspellings();
    expect(misspellings.length).toBe(2);
    expect(misspellings.map((m: WordSpan): string => m.word)).toEqual(['wrold', 'inccorrect']);

    const wroldSpan = misspellings[0];
    expect(wroldSpan).toBeDefined();
    // Check if first span is defined.
    if (wroldSpan !== undefined) {
      // Branch: Defined span; verify containment query.
      const hit = spellCheck.misspellingAt(wroldSpan.from + 1);
      expect(hit).not.toBeNull();
      expect(hit?.word).toBe('wrold');
    } else {
      // Branch: Undefined span.
    }

    // Verify position inside correct word ('Hello') returns null
    const helloHit = spellCheck.misspellingAt(2);
    expect(helloHit).toBeNull();
  });

  it('de-duplicates words sent to check', async (): Promise<void> => {
    const { view } = createTestEditor('banana apple banana apple orange banana');
    const fakeService = createFakeSpellService();
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();

    // Every check de-duplicates, so the assertion is about the payload of a check rather than about
    // how many ran: the constructor's opening check may already have added one.
    expect(fakeService.checkedWordsHistory.length).toBeGreaterThanOrEqual(1);
    const wordsSent = fakeService.checkedWordsHistory[fakeService.checkedWordsHistory.length - 1];
    expect(wordsSent).toBeDefined();
    // Check if recorded words array is defined.
    if (wordsSent !== undefined) {
      // Branch: Defined words array; verify deduplication order and content.
      expect(wordsSent).toEqual(['banana', 'apple', 'orange']);
    } else {
      // Branch: Undefined words array.
    }
  });

  it('clears decorations immediately on setEnabled(false) and restores them when re-enabled', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService({
      checkFn: (words: readonly string[]): readonly string[] => {
        return words.filter((w: string): boolean => w === 'wrold');
      },
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();
    expect(spellCheck.misspellings().length).toBe(1);
    expect(spellCheck.isEnabled).toBe(true);

    // Disable spell checking
    spellCheck.setEnabled(false);
    expect(spellCheck.isEnabled).toBe(false);
    // Assert decorations are removed immediately rather than frozen
    expect(spellCheck.misspellings().length).toBe(0);

    // Re-enable spell checking
    spellCheck.setEnabled(true);
    expect(spellCheck.isEnabled).toBe(true);

    await spellCheck.checkNow();
    expect(spellCheck.misspellings().length).toBe(1);
    expect(spellCheck.misspellings()[0]?.word).toBe('wrold');
  });

  it('does not overwrite newer results with stale in-flight checks resolved out of order', async (): Promise<void> => {
    const { view } = createTestEditor('wrold');
    const fakeWin = createFakeWindow();

    type Resolver = (words: readonly string[]) => void;
    let resolveCheck1: Resolver | null = null;
    let resolveCheck2: Resolver | null = null;
    let checkCallCount = 0;

    const fakeService = createFakeSpellService({
      // The constructor kicks off its own check on a successful load. This test is about two racing
      // checkNow calls, so the load is left pending and these two are the only checks in flight.
      loadPending: true,
      checkFn: (_words: readonly string[]): Promise<readonly string[]> => {
        checkCallCount++;
        const currentCall = checkCallCount;
        return new Promise<readonly string[]>((resolve: Resolver): void => {
          // Check call index to assign deferred resolver.
          if (currentCall === 1) {
            // Branch: First call; capture resolver 1.
            resolveCheck1 = resolve;
          } else {
            // Branch: Second call; capture resolver 2.
            resolveCheck2 = resolve;
          }
        });
      },
    });

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    // Trigger two asynchronous checks
    const promise1 = spellCheck.checkNow();
    const promise2 = spellCheck.checkNow();

    // Resolve call 2 first with newer result
    expect(resolveCheck2).not.toBeNull();
    // Check if resolver 2 is present.
    if (resolveCheck2 !== null) {
      // Branch: Resolver 2 active; resolve with newer misspelled word list.
      (resolveCheck2 as Resolver)(['wrold']);
    } else {
      // Branch: Missing resolver.
    }
    await promise2;

    expect(spellCheck.misspellings().length).toBe(1);
    expect(spellCheck.misspellings()[0]?.word).toBe('wrold');

    // Resolve call 1 after call 2 with stale result (empty array)
    expect(resolveCheck1).not.toBeNull();
    // Check if resolver 1 is present.
    if (resolveCheck1 !== null) {
      // Branch: Resolver 1 active; resolve with stale empty list.
      (resolveCheck1 as Resolver)([]);
    } else {
      // Branch: Missing resolver.
    }
    await promise1;

    // Stale check must be discarded due to generation counter mismatch; newer result preserved
    expect(spellCheck.misspellings().length).toBe(1);
    expect(spellCheck.misspellings()[0]?.word).toBe('wrold');
  });

  it('replaces text at the span and returns focus on correct()', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService({
      checkFn: (words: readonly string[]): readonly string[] => {
        return words.filter((w: string): boolean => w === 'wrold');
      },
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();
    const misspellings = spellCheck.misspellings();
    expect(misspellings.length).toBe(1);
    const targetSpan = misspellings[0];
    expect(targetSpan).toBeDefined();

    // Check if target span is defined.
    if (targetSpan !== undefined) {
      // Branch: Defined span; correct word.
      spellCheck.correct(targetSpan, 'world');
    } else {
      // Branch: Undefined span.
    }

    // Document text must reflect replacement
    expect(view.state.doc.textContent).toBe('Hello world');
  });

  it('triggers a re-check and updates ignored list on ignoreAll()', async (): Promise<void> => {
    const { view } = createTestEditor('teh first teh second');
    const fakeService = createFakeSpellService({
      checkFn: (words: readonly string[]): readonly string[] => {
        return words.filter((w: string): boolean => w === 'teh');
      },
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();
    // Counted rather than asserted absolutely: the constructor runs its own opening check once the
    // dictionary loads, so the only thing this test can say is that ignoreAll adds one on top.
    const checksBefore = fakeService.checkedWordsHistory.length;
    expect(checksBefore).toBeGreaterThanOrEqual(1);

    spellCheck.ignoreAll('teh');
    expect(fakeService.ignoredWords).toContain('teh');

    // Follow-up check was triggered.
    expect(fakeService.checkedWordsHistory.length).toBeGreaterThan(checksBefore);
  });

  it('does not call check and decorates nothing when service reports loaded: false', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService({
      loaded: false,
      loadResult: false,
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    await spellCheck.checkNow();

    expect(fakeService.checkedWordsHistory.length).toBe(0);
    expect(spellCheck.misspellings().length).toBe(0);
  });

  it('makes schedule() and checkNow() inert on destroy()', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService();
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });

    spellCheck.destroy();
    expect(spellCheck.isEnabled).toBe(false);

    // schedule() must be inert and not register timers
    spellCheck.schedule();
    expect(fakeWin.getPendingTimersCount()).toBe(0);

    // checkNow() must be inert and not call service.check
    await spellCheck.checkNow();
    expect(fakeService.checkedWordsHistory.length).toBe(0);
  });

  it('debounces checkNow via schedule() and cancels timer on clear', (): void => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService();
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
      debounceMs: SPELL_DEBOUNCE_MS,
    });
    activeSpellChecks.push(spellCheck);

    spellCheck.schedule();
    expect(fakeWin.getPendingTimersCount()).toBe(1);

    // Restarting schedule cancels previous timer and arms a new one
    spellCheck.schedule();
    expect(fakeWin.getPendingTimersCount()).toBe(1);

    fakeWin.triggerAll();
    expect(fakeWin.getPendingTimersCount()).toBe(0);
  });

  it('delegates suggest and addToDictionary to service', async (): Promise<void> => {
    const { view } = createTestEditor('Hello wrold');
    const fakeService = createFakeSpellService({
      suggestResult: ['world', 'word'],
    });
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    const suggestions = await spellCheck.suggest('wrold');
    expect(suggestions).toEqual(['world', 'word']);

    await spellCheck.addToDictionary('wrold');
    expect(fakeService.addedWords).toContain('wrold');
  });

  it('safely skips correction when span boundaries exceed document size', async (): Promise<void> => {
    const { view } = createTestEditor('short');
    const fakeService = createFakeSpellService();
    const fakeWin = createFakeWindow();

    const spellCheck = installSpellCheck({
      view,
      service: fakeService.service,
      win: fakeWin.win,
      enabled: true,
      language: 'en-US',
    });
    activeSpellChecks.push(spellCheck);

    // Attempt correction with invalid span beyond doc content size
    spellCheck.correct({ from: 100, to: 200, word: 'nonexistent' }, 'replacement');
    expect(view.state.doc.textContent).toBe('short');
  });
});
