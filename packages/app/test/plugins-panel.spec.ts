// @vitest-environment jsdom
/**
 * @file plugins-panel.spec.ts
 * @purpose Exercises installPluginsPanel (FR-14.18) under jsdom, covering rendering of loaded plugins and load problems plus reload/open-folder/panel-show actions and the refresh/destroy lifecycle.
 * @inputs COUNTER fixture plugin; mutable module state for plugins, problems, shown calls, answer promise, reloaded/opened counters, and the active panel handle.
 * @outputs Assertions over rendered textContent, button clicks, callback invocation counts, and DOM structure produced by installPluginsPanel.
 * @functions
 *   - mount: Seeds COUNTER into module state, installs the panel, appends it to document.body, records the handle in `active`, returns it.
 *   - text: Returns the active panel's combined textContent, or '' when no panel is mounted.
 *   - buttonNamed: Finds the first button whose trimmed text equals a name, or undefined.
 *   - output: Returns the first panel-output element's textContent, or '' when absent.
 * @dataflow module state -> installPluginsPanel render -> DOM in document.body -> assertions read back via helpers.
 * @controlflow beforeEach seeds COUNTER; each test mounts and asserts; afterEach destroys any active panel to isolate tests.
 * @version 1
 * @date 2026-09-18
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installPluginsPanel, type PluginsPanel } from '../src/shell/plugins-panel.js';
import type { LoadedPlugin } from '../src/plugins/plugin-host.js';

const COUNTER: LoadedPlugin = {
  manifest: { id: 'counter', name: 'Counter', version: '1.0.0', description: 'Counts things.' },
  registrations: [
    { point: 'command', id: 'count', label: 'Count Words' },
    { point: 'panel', id: 'summary', title: 'Summary' },
    { point: 'export', id: 'csv', name: 'CSV', extension: 'csv' },
    { point: 'syntax', id: 'mark', pattern: '@@[a-z]+', tag: 'mark', className: 'plugin-mark' },
  ],
};

let plugins: readonly LoadedPlugin[] = [];
let problems: readonly string[] = [];
let shown: string[] = [];
let answer: Promise<string> = Promise.resolve('');
let reloaded = 0;
let opened = 0;
let active: PluginsPanel | null = null;

function mount(): PluginsPanel {
  // Seed the module state with a single loaded plugin and reset all counters before installing.
  plugins = [COUNTER];
  problems = [];
  shown = [];
  answer = Promise.resolve('twelve words');
  reloaded = 0;
  opened = 0;

  const panel = installPluginsPanel({
    doc: document,
    plugins: () => plugins,
    problems: () => problems,
    showPanel: (pluginId, id) => { shown.push(`${pluginId}:${id}`); return answer; },
    reload: () => { reloaded += 1; },
    openFolder: () => { opened += 1; },
  });

  // Attach the freshly built panel to the document so its DOM can be queried.
  document.body.append(panel.element);
  active = panel;
  return panel;
}

afterEach(() => {
  if (active !== null) {
    // Tear down any mounted panel, detach it from the document when present, then clear the handle.
    active.destroy();
    const parent = active.element.parentElement;
    if (parent !== null) {
      parent.removeChild(active.element);
    }
    active = null;
  } else {
    // No panel was mounted: nothing to tear down in this test.
  }
});

function text(): string {
  return active === null ? '' : (active.element.textContent ?? '');
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const button of buttons) {
    // Return the first button whose trimmed text matches the requested name.
    if (button.textContent?.trim() === name) {
      return button;
    } else {
      // Not a match: keep scanning further down the list.
    }
  }
  return undefined;
}

function output(): string {
  const el = document.querySelector<HTMLPreElement>('.kdoc-plugins-panel-output');
  if (el === null) {
    // No panel output element exists yet, so there is nothing to read back.
    return '';
  } else {
    // Return the current text of the first matching output element, defaulting empty when unset.
    return el.textContent ?? '';
  }
}

describe('installPluginsPanel', () => {
  it('names every plugin', () => {
    mount();
    const content = text();
    expect(content).toContain('Counter');
    expect(content).toContain('counter 1.0.0');
    expect(content).toContain('Counts things.');
  });

  it('says what each plugin added', () => {
    mount();
    const content = text();
    expect(content).toContain('command: Count Words');
    expect(content).toContain('panel: Summary');
    expect(content).toContain('export: CSV');
    expect(content).toContain('syntax: @@[a-z]+');
  });

  it('an empty folder says what to do', () => {
    const panel = mount();
    plugins = [];
    panel.refresh();
    const content = text();
    expect(content).toContain('No plugins are loaded');
  });

  it('a plugin that would not load says so', () => {
    const panel = mount();
    problems = ['Plugin "x": broke.'];
    panel.refresh();
    const content = text();
    expect(content).toContain('Plugin "x": broke.');
  });

  it('problems are said even when nothing loaded', () => {
    const panel = mount();
    plugins = [];
    problems = ['Plugin "x": broke.'];
    panel.refresh();
    const content = text();
    expect(content).toContain('broke');
    expect(content).toContain('No plugins are loaded');
  });

  it('drawing again replaces the problems rather than repeating them', () => {
    const panel = mount();
    problems = ['Plugin "x": broke.'];
    panel.refresh();
    panel.refresh();
    expect(text().split('broke').length - 1).toBe(1);
  });

  it('Reload asks for a reload', () => {
    mount();
    const button = buttonNamed('Reload');
    if (button !== undefined) {
      button.click();
    } else {
      // No Reload button was found; the reloaded count below will fail the assertion.
    }
    expect(reloaded).toBe(1);
  });

  it('Open Folder asks for the folder', () => {
    mount();
    const button = buttonNamed('Open Folder');
    if (button !== undefined) {
      button.click();
    } else {
      // No Open Folder button was found; the opened count below will fail the assertion.
    }
    expect(opened).toBe(1);
  });

  it('a panel can be shown', async () => {
    mount();
    const button = buttonNamed('Show Summary');
    if (button !== undefined) {
      button.click();
    } else {
      // No Show Summary button was found; the recorded call below will fail the assertion.
    }
    expect(shown).toEqual(['counter:summary']);
    await Promise.resolve();
    await Promise.resolve();
    const rendered = output();
    expect(rendered).toBe('twelve words');
  });

  it('a panel that fails says why where its answer would have been', async () => {
    mount();
    // The rejection is created after mount so the .catch handler attaches before any tick, leaving nothing unhandled.
    answer = Promise.reject(new Error('it broke'));
    const button = buttonNamed('Show Summary');
    if (button !== undefined) {
      button.click();
    } else {
      // No Show Summary button was found; the output below will fail the assertion.
    }
    await Promise.resolve();
    await Promise.resolve();
    const rendered = output();
    expect(rendered).toBe('it broke');
  });

  it('only a panel gets a button', () => {
    mount();
    expect(buttonNamed('Show Count Words')).toBeUndefined();
    expect(buttonNamed('Show CSV')).toBeUndefined();
  });

  it('refresh draws again rather than adding', () => {
    const panel = mount();
    panel.refresh();
    panel.refresh();
    const blocks = document.querySelectorAll('.kdoc-plugins-panel-plugin');
    expect(blocks.length).toBe(1);
  });

  it('destroy empties it', () => {
    const panel = mount();
    panel.destroy();

    // Cleared so afterEach does not destroy the same panel twice; the element is detached here instead.
    active = null;
    const parent = panel.element.parentElement;
    if (parent !== null) {
      parent.removeChild(panel.element);
    } else {
      // Never attached, so there is nothing to detach.
    }

    expect(panel.element.childNodes.length).toBe(0);
  });
});
