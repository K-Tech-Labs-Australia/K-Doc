// @vitest-environment jsdom
/**
 * @file spell-check-language.test.ts
 * @purpose Covers the spell check controller's language handling (FR-12.3): trying full locale tags then primary languages, stopping at the first loadable dictionary, reporting missing dictionaries, switching and reloading languages, deferring loads until enabled, discarding stale results, and surfacing load failures.
 * @inputs A ProseMirror editor backed by `kdocSchema` and a fake `SpellService` recording load/check calls, installed through `installSpellCheck`.
 * @outputs Assertions over the recorded dictionary loads, missing-dictionary callbacks, misspellings, and error reports across language transitions.
 * @functions editor - mounts an in-memory ProseMirror view seeded with French text.
 *   - fakeService - builds a SpellService that records loadDictionary/check calls and answers each load via `loadFor`.
 *   - install - installs the spell check controller against a fresh editor and a fake service.
 *   - settle - flushes pending microtasks and timers so async loads resolve before assertions.
 * @dataflow fakeService -> installSpellCheck -> controller language transitions -> recorded loads/assertions.
 * @controlflow One describe block; each it installs a controller, awaits settlement, then asserts on the recorded behaviour.
 * @version 1
 * @date 2026-09-18
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { createSpellPlugin, kdocSchema } from '@k-doc/editor';
import type { SpellService } from '../spell/spell-service.js';
import { installSpellCheck, type SpellCheck, type SpellCheckOptions } from './spell-check.js';

const views: EditorView[] = [];
const controllers: SpellCheck[] = [];

afterEach((): void => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  views.splice(0).forEach((view) => view.destroy());
});

function editor(): EditorView {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const doc = kdocSchema.node('doc', null, [kdocSchema.node('paragraph', null, [kdocSchema.text('bonjour tout le monde')])]);
  const view = new EditorView(mount, { state: EditorState.create({ schema: kdocSchema, doc, plugins: [createSpellPlugin()] }) });
  views.push(view);
  return view;
}

interface Fake {
  readonly service: SpellService;
  readonly loads: string[];
  readonly checks: string[][];
}

// loadFor answers each loadDictionary call; a language it has no answer for loads.
function fakeService(loadFor: (language: string) => Promise<boolean> | boolean = (): boolean => true): Fake {
  const loads: string[] = [];
  const checks: string[][] = [];
  let loaded = false;
  const service: SpellService = {
    available: true,
    get loaded(): boolean {
      return loaded;
    },
    async loadDictionary(language: string): Promise<boolean> {
      loads.push(language);
      loaded = await loadFor(language);
      return loaded;
    },
    async downloadDictionary(language: string): Promise<string> {
      return language;
    },
    async check(words: readonly string[]): Promise<readonly string[]> {
      checks.push([...words]);
      return [];
    },
    async suggest(): Promise<readonly string[]> {
      return [];
    },
    async addWord(): Promise<void> {},
    ignoreAll(): void {},
    isIgnored(): boolean {
      return false;
    },
    userWords: [],
    destroy(): void {},
  };
  return { service, loads, checks };
}

function install(fake: Fake, overrides: Partial<SpellCheckOptions> = {}): SpellCheck {
  const controller = installSpellCheck({ view: editor(), service: fake.service, win: window, enabled: true, language: 'en-GB', ...overrides });
  controllers.push(controller);
  return controller;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('spell check language', () => {
  // Guards a locale tag falls back to its primary language when the full tag is unavailable.
  it('tries the full tag, then its primary language', async () => {
    const fake = fakeService((language) => language === 'fr');
    const missing: string[] = [];
    install(fake, { language: 'fr-FR', onMissingDictionary: (language) => missing.push(language) });
    await settle();
    expect(fake.loads).toEqual(['fr-FR', 'fr']);
    expect(missing).toEqual([]);
    expect(fake.checks.length).toBeGreaterThan(0);
  });

  // Guards loading stops at the first dictionary name that succeeds.
  it('stops at the first name that loads', async () => {
    const fake = fakeService();
    install(fake, { language: 'en-GB' });
    await settle();
    expect(fake.loads).toEqual(['en-GB']);
  });

  // Guards reporting a missing dictionary and skipping checks when none load.
  it('says when there is no dictionary, and checks nothing', async () => {
    const fake = fakeService(() => false);
    const missing: string[] = [];
    const controller = install(fake, { language: 'de', onMissingDictionary: (language) => missing.push(language) });
    await settle();
    expect(missing).toEqual(['de']);
    expect(fake.checks).toEqual([]);
    expect(controller.misspellings()).toEqual([]);
  });

  // Guards switching reloads the new language while keeping prior loads recorded.
  it('switches to another language', async () => {
    const fake = fakeService();
    const controller = install(fake);
    await settle();
    controller.setLanguage('fr');
    await settle();
    expect(controller.language).toBe('fr');
    expect(fake.loads).toEqual(['en-GB', 'fr']);
  });

  // Guards that re-setting an already-loaded language triggers no extra load.
  it('does nothing when the language is unchanged', async () => {
    const fake = fakeService();
    const controller = install(fake);
    await settle();
    controller.setLanguage('en-GB');
    await settle();
    expect(fake.loads).toEqual(['en-GB']);
  });

  // Guards that loading a new language waits until spell checking is enabled.
  it('loads a new language only once checking is turned on', async () => {
    const fake = fakeService();
    const controller = install(fake, { enabled: false });
    controller.setLanguage('fr');
    await settle();
    expect(fake.loads).toEqual([]);
    controller.setEnabled(true);
    await settle();
    expect(fake.loads).toEqual(['fr']);
  });

  // Guards discarding a late dictionary result after the document has switched away.
  it('ignores the result for a language the document has moved on from', async () => {
    let finishGerman: (loaded: boolean) => void = (): void => {};
    const fake = fakeService((language) => (language === 'de' ? new Promise<boolean>((resolve) => { finishGerman = resolve; }) : true));
    const missing: string[] = [];
    const controller = install(fake, { language: 'de', onMissingDictionary: (language) => missing.push(language) });
    await settle();
    controller.setLanguage('fr');
    await settle();
    finishGerman(false);
    await settle();
    expect(missing).toEqual([]);
  });

  // Guards reload re-issues the current language load.
  it('loads the language again when asked to reload', async () => {
    const fake = fakeService();
    const controller = install(fake);
    await settle();
    controller.reload();
    await settle();
    expect(fake.loads).toEqual(['en-GB', 'en-GB']);
  });

  // Guards that reload is ignored while disabled and once the controller is destroyed.
  it('does not reload while off or after being destroyed', async () => {
    const fake = fakeService();
    const off = install(fake, { enabled: false });
    off.reload();
    const gone = install(fake);
    await settle();
    gone.destroy();
    gone.reload();
    gone.setLanguage('fr');
    await settle();
    expect(fake.loads).toEqual(['en-GB']);
  });

  // Guards surfacing a failed dictionary load through onError.
  it('reports a dictionary that fails to load', async () => {
    const fake = fakeService(() => Promise.reject(new Error('broken')));
    const errors: string[] = [];
    install(fake, { onError: (error) => errors.push(error.message) });
    await settle();
    expect(errors).toEqual(['broken']);
  });
});
