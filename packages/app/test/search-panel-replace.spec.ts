// @vitest-environment jsdom
/**
 * @file search-panel-replace.spec.ts
 * @purpose Tests the vault Search panel's replace and undo actions (FR-9.5) plus its wording helpers and stylesheet.
 * @inputs Vitest globals, installSearchPanel, text/summary helpers, report types, and a fixed in-memory file set.
 * @outputs Test suites asserting button counts, replace request shape, status summaries, pluralisation, and theme-only styles.
 * @functions
 *   - mount: Installs the panel against a mocked vault and returns a Harness tracking replaces and undo calls.
 *   - flush: Drains microtasks so awaited callbacks settle.
 *   - el: Selects a descendant element by selector, throwing when it is absent.
 *   - replaceButton / undoButton / status: Typed accessors for key panel elements.
 *   - type: Sets the query box, fires input, and advances the debounce timer.
 *   - untick: Clears one match checkbox and fires its change event.
 * @dataflow mount() builds DOM → helpers drive events → assertions read button/status textContent.
 * @controlflow afterEach tears down panels → describe groups replace/undo tests then wording tests; each it drives the panel and asserts exact values.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { searchFiles, type SearchableFile } from '@k-doc/core';
import { installSearchPanel, SEARCH_DEBOUNCE_MS, SEARCH_PANEL_STYLES, type SearchPanel } from '../src/shell/search-panel.js';
import { matchSummary, plural, replaceSummary, undoSummary } from '../src/shell/search-panel-text.js';
import type { ReplaceReport, ReplaceRequest, UndoReport } from '../src/shell/vault-search-controller.js';

const FILES: readonly SearchableFile[] = [
  { path: '/v/a.md', relative: 'a.md', text: 'foo\nbar foo' },
  { path: '/v/c.md', relative: 'c.md', text: 'foo' },
];
const panels: SearchPanel[] = [];
afterEach((): void => { for (const p of panels) { p.destroy(); } panels.length = 0; document.body.replaceChildren(); vi.useRealTimers(); });

interface Harness { panel: SearchPanel; readonly replaces: ReplaceRequest[]; canUndo: boolean; undoCalls: number; replaceResult: ReplaceReport; undoResult: UndoReport | null; }

/** Installs the panel against a mocked vault and tracks replace/undo calls in a Harness. */
function mount(): Harness {
  const harness: Harness = { panel: undefined as unknown as SearchPanel, replaces: [], canUndo: false, undoCalls: 0, replaceResult: { replaced: 2, files: 2, stale: 0, failures: [] }, undoResult: { restored: 1, skipped: 0, failures: [] } };
  const panel = installSearchPanel({ doc: document, hasVault: () => true, search: (query, options) => Promise.resolve({ ...searchFiles(FILES, query, options), unreadable: [] }), replace: (request) => { harness.replaces.push(request); return Promise.resolve(harness.replaceResult); }, undoReplace: () => { harness.undoCalls++; return Promise.resolve(harness.undoResult); }, canUndo: () => harness.canUndo, openMatch: () => undefined });
  harness.panel = panel; document.body.append(panel.element); panels.push(panel); return harness;
}

/** Flushes microtasks so awaited callbacks settle. */
async function flush(): Promise<void> { for (let i = 0; i < 10; i++) { await Promise.resolve(); } }

/** Selects a single descendant element by selector, throwing when it is absent. */
function el<T extends Element>(h: Harness, selector: string): T { const found = h.panel.element.querySelector<T>(selector); if (found === null) { throw new Error(`no ${selector}`); } else { return found; } }

/** Returns the Replace button from the second search row. */
function replaceButton(h: Harness): HTMLButtonElement { return el<HTMLButtonElement>(h, '.kdoc-search-row + .kdoc-search-row .kdoc-search-action'); }

/** Returns the Undo button by its accessible name. */
function undoButton(h: Harness): HTMLButtonElement { return el<HTMLButtonElement>(h, 'button[aria-label="Undo the last replace"]'); }

/** Returns the status readout element. */
function status(h: Harness): HTMLElement { return el<HTMLElement>(h, '.kdoc-search-count'); }

/** Sets the query box value, fires input, and advances the debounce timer to run the search. */
async function type(h: Harness, value: string): Promise<void> { const box = el<HTMLInputElement>(h, 'input[type="search"]'); box.value = value; box.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); await flush(); }

/** Clears the match checkbox at index and fires its change event. */
function untick(h: Harness, index: number): void { const row = h.panel.element.querySelectorAll<HTMLInputElement>('.kdoc-search-match-check')[index]; if (row === undefined) { throw new Error('no row'); } else { row.checked = false; row.dispatchEvent(new Event('change')); } }

describe('replacing from the Search panel', (): void => {
  it('counts the chosen matches on the Replace button', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    expect(replaceButton(h).disabled).toBe(true);
    await type(h, 'foo');
    expect(replaceButton(h).textContent).toBe('Replace 3');
    expect(replaceButton(h).disabled).toBe(false);
    untick(h, 1);
    expect(replaceButton(h).textContent).toBe('Replace 2');
    expect(h.panel.element.querySelector<HTMLInputElement>('.kdoc-search-file-check')?.indeterminate).toBe(true);
  });

  it('replaces the chosen matches of the results on screen', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    untick(h, 1);
    el<HTMLInputElement>(h, 'input[type="search"]').value = 'other';
    el<HTMLInputElement>(h, 'input[aria-label="Replace with"]').value = 'bar';
    replaceButton(h).click();
    await flush();
    expect(h.replaces.length).toBe(1);
    const request = h.replaces[0];
    expect(request?.query).toBe('foo');
    expect(request?.replacement).toBe('bar');
    expect(request?.options).toEqual({ caseSensitive: false, wholeWord: false, regex: false });
    expect([...(request?.selections.entries() ?? [])]).toEqual([['/v/a.md', [{ start: 0, end: 3 }]], ['/v/c.md', [{ start: 0, end: 3 }]]]);
    expect(status(h).textContent).toBe('Replaced 2 in 2 files.');
    expect(status(h).getAttribute('data-state')).toBe('info');
  });

  it('marks a replace with failures as an error', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    h.replaceResult = { replaced: 1, files: 1, stale: 0, failures: [{ path: '/v/c.md', message: 'denied' }] };
    await type(h, 'foo');
    replaceButton(h).click();
    await flush();
    expect(status(h).textContent).toBe('Replaced 1 in 1 file; 1 file failed: /v/c.md: denied.');
    expect(status(h).getAttribute('data-state')).toBe('error');
  });

  it('keeps unticked matches when the same search runs again, and forgets them for a new one', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    untick(h, 1);
    h.panel.refresh();
    await flush();
    expect(replaceButton(h).textContent).toBe('Replace 2');
    await type(h, 'fo');
    expect(replaceButton(h).textContent).toBe('Replace 3');
  });

  it('undoes the last replace', async (): Promise<void> => {
    const h = mount();
    h.canUndo = true;
    h.panel.refresh();
    await flush();
    expect(undoButton(h).disabled).toBe(false);
    undoButton(h).click();
    await flush();
    expect(h.undoCalls).toBe(1);
    expect(status(h).textContent).toBe('Restored 1 file.');
  });

  it('says when there was nothing to undo', async (): Promise<void> => {
    const h = mount();
    h.canUndo = true;
    h.undoResult = null;
    h.panel.refresh();
    await flush();
    undoButton(h).click();
    await flush();
    expect(status(h).textContent).toBe('Nothing to undo.');
  });

  it('disables Undo when there is nothing to undo', async (): Promise<void> => {
    const h = mount();
    await flush();
    expect(undoButton(h).disabled).toBe(true);
  });

  it('forgets unticked matches when an option changes, even with the same matches', async (): Promise<void> => {
    // Toggling a search option must recompute selections from scratch, not carry over prior ticks.
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    untick(h, 1);
    expect(replaceButton(h).textContent).toBe('Replace 2');
    el<HTMLButtonElement>(h, 'button[aria-label="Match case"]').click();
    await flush();
    expect(replaceButton(h).textContent).toBe('Replace 3');
  });

  it('disables Replace once every match is unticked', async (): Promise<void> => {
    // With no matches selected the action must be inert rather than replacing nothing.
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    for (const fileBox of h.panel.element.querySelectorAll<HTMLInputElement>('.kdoc-search-file-check')) { fileBox.checked = false; fileBox.dispatchEvent(new Event('change')); }
    expect(replaceButton(h).textContent).toBe('Replace');
    expect(replaceButton(h).disabled).toBe(true);
  });
});

describe('Search panel wording', (): void => {
  it('pluralises', (): void => {
    expect([plural(0, 'file', 'files'), plural(1, 'file', 'files'), plural(2, 'file', 'files')]).toEqual(['0 files', '1 file', '2 files']);
  });

  it('summarises matches', (): void => {
    expect(matchSummary(1, 1)).toBe('1 match in 1 file');
    expect(matchSummary(5, 2)).toBe('5 matches in 2 files');
  });

  it('summarises a replace', (): void => {
    expect(replaceSummary({ replaced: 3, files: 2, stale: 0, failures: [] })).toBe('Replaced 3 in 2 files.');
    expect(replaceSummary({ replaced: 1, files: 1, stale: 2, failures: [{ path: '/v/a.md', message: 'denied' }] })).toBe('Replaced 1 in 1 file; 2 skipped because the note changed; 1 file failed: /v/a.md: denied.');
  });

  it('summarises an undo', (): void => {
    expect(undoSummary({ restored: 2, skipped: 0, failures: [] })).toBe('Restored 2 files.');
    expect(undoSummary({ restored: 0, skipped: 1, failures: [{ path: '/v/b.md', message: 'locked' }] })).toBe('Restored 0 files; 1 file left alone because it changed since; 1 file failed: /v/b.md: locked.');
  });

  it('styles with theme tokens only', (): void => {
    expect(SEARCH_PANEL_STYLES).toContain('.kdoc-search-match-text');
    expect(SEARCH_PANEL_STYLES).toContain('.kdoc-search-toggle[aria-pressed="true"]');
    expect(SEARCH_PANEL_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
