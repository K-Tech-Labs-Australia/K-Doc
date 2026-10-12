// @vitest-environment jsdom

/**
 * @file search-panel.spec.ts
 * @purpose Vitest behaviour tests for the vault Search panel (FR-9.5): debounced searching, result grouping with line numbers and snippets, status counts, zero-match/empty states, malformed-regex and generic failures, unreadable/truncated reporting, superseded-search cancellation, match navigation, immediate Enter search, focus/select, element identity across searches, and teardown.
 * @inputs Search fixture files, synthetic DOM input/keydown/click events, and mock host callbacks recording queries and opened matches.
 * @outputs Vitest assertions verifying recorded searches, rendered groups/marks, status text and state, opened matches, and lifecycle behaviour.
 * @functions
 *   - mount: Installs a SearchPanel with mock host callbacks that record searches and opened matches, returning the harness.
 *   - flush: Yields to the microtask queue so pending search promises settle before assertions.
 *   - el: Locates a descendant element by selector within the panel DOM, failing when absent.
 *   - box: Returns the debounced query input element.
 *   - status: Returns the .kdoc-search-count live-region element.
 *   - type: Sets the query value, dispatches an input event, and advances past the debounce window.
 * @dataflow Synthetic events -> SearchPanel debounced handlers -> mock searchFn -> DOM updates -> Vitest assertions.
 * @controlflow Mount panel per test -> drive input/events -> assert on recorded searches and rendered DOM -> destroy panels in afterEach.
 * @version 2
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { InvalidQueryError, searchFiles, type FileMatch, type SearchOptions, type SearchableFile } from '@k-doc/core';
import { installSearchPanel, SEARCH_DEBOUNCE_MS, type SearchPanel } from '../src/shell/search-panel.js';
import type { VaultSearchOutcome } from '../src/shell/vault-search-controller.js';

const FILES: readonly SearchableFile[] = [
  { path: '/v/a.md', relative: 'a.md', text: 'foo\nbar foo' },
  { path: '/v/b.md', relative: 'b.md', text: 'nothing' },
  { path: '/v/c.md', relative: 'c.md', text: 'foo' },
];

const panels: SearchPanel[] = [];

afterEach((): void => { for (const p of panels) { p.destroy(); } panels.length = 0; document.body.replaceChildren(); vi.useRealTimers(); });

type SearchFn = (query: string, options: SearchOptions) => Promise<VaultSearchOutcome>;

function realSearch(query: string, options: SearchOptions): Promise<VaultSearchOutcome> { return Promise.resolve({ ...searchFiles(FILES, query, options), unreadable: [] }); }

interface Harness {
  panel: SearchPanel;
  searches: { query: string; options: SearchOptions; signal: AbortSignal }[];
  opened: { path: string; match: FileMatch }[];
  searchFn: SearchFn;
}

/**
 * @purpose Installs a SearchPanel with mock host callbacks that record searches and opened matches.
 * @inputs vault - Whether the panel reports an open vault (default true).
 * @outputs Harness - The mounted panel plus recorded searches, opened matches, and a swappable search function.
 * @dataflow installSearchPanel -> panel closes over harness arrays -> mount registers panel for teardown.
 * @controlflow Build recorder arrays -> install panel with mock callbacks -> assign panel to harness -> append to DOM -> return harness.
 */
function mount(vault: boolean = true): Harness {
  const searches: Harness['searches'] = [];
  const opened: Harness['opened'] = [];
  const harness: Harness = {
    panel: undefined as unknown as SearchPanel,
    searches,
    opened,
    searchFn: realSearch,
  };
  const panel = installSearchPanel({
    doc: document,
    hasVault: () => vault,
    search: (query, options, signal) => {
      searches.push({ query, options, signal });
      return harness.searchFn(query, options);
    },
    replace: () => Promise.resolve({ replaced: 0, files: 0, stale: 0, failures: [] }),
    undoReplace: () => Promise.resolve(null),
    canUndo: () => false,
    openMatch: (path, match) => { opened.push({ path, match }); },
  });
  harness.panel = panel;
  document.body.append(panel.element);
  panels.push(panel);
  return harness;
}

/**
 * @purpose Yields repeatedly so pending search promises settle before assertions.
 * @inputs void.
 * @outputs void.
 * @dataflow Microtask queue -> resolved on each iteration.
 * @controlflow Await a microtask ten times to drain the queue.
 */
async function flush(): Promise<void> { for (let i = 0; i < 10; i++) { await Promise.resolve(); } }

/**
 * @purpose Locates a descendant element by selector within the panel DOM.
 * @inputs h - The mounted harness whose panel element is searched.
 * @inputs selector - CSS selector matched against descendants.
 * @outputs T - The matched element, or throws when none exists.
 * @dataflow panel.element -> querySelector<T>(selector) -> element returned.
 * @controlflow Query selector -> throw on null; otherwise return the found node.
 */
function el<T extends Element>(h: Harness, selector: string): T { const found = h.panel.element.querySelector<T>(selector); if (found === null) { throw new Error(`no ${selector}`); } else { return found; } }

/**
 * @purpose Returns the debounced search query input element.
 * @inputs h - The mounted harness.
 * @outputs HTMLInputElement - The input[type="search"] element.
 * @dataflow el(panel.element) -> typed as search input.
 * @controlflow Delegate to el with the search-input selector.
 */
function box(h: Harness): HTMLInputElement { return el<HTMLInputElement>(h, 'input[type="search"]'); }

/**
 * @purpose Returns the status live-region element that reports counts and errors.
 * @inputs h - The mounted harness.
 * @outputs HTMLElement - The .kdoc-search-count element.
 * @dataflow el(panel.element) -> typed as status region.
 * @controlflow Delegate to el with the count selector.
 */
function status(h: Harness): HTMLElement { return el<HTMLElement>(h, '.kdoc-search-count'); }

/**
 * @purpose Sets the query value, dispatches an input event, and advances past the debounce window.
 * @inputs h - The mounted harness.
 * @inputs value - Text to place in the search box.
 * @outputs void.
 * @dataflow value -> input.value + input event -> timer advance -> microtask flush.
 * @controlflow Set value, dispatch input, advance debounce timers, drain microtasks.
 */
async function type(h: Harness, value: string): Promise<void> { box(h).value = value; box(h).dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); await flush(); }

const OFF: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

describe('the Search panel', (): void => {
  it('says so and disables itself with no vault', (): void => {
    // A search box that searched nothing would be a control that looks like it works.
    const h = mount(false);
    expect(box(h).disabled).toBe(true);
    expect(el<HTMLInputElement>(h, 'input[aria-label="Replace with"]').disabled).toBe(true);
    expect(el<HTMLInputElement>(h, '.kdoc-search-empty').textContent).toBe('No folder open.');
    expect(h.searches).toEqual([]);
  });

  it('does not search an empty box', async (): Promise<void> => {
    // An empty query is no search at all.
    const h = mount();
    await flush();
    expect(h.searches).toEqual([]);
    expect(status(h).textContent).toBe('');
  });

  it('debounces typing', async (): Promise<void> => {
    // A vault search runs over every note, so running on every keystroke is work nobody asked for.
    vi.useFakeTimers();
    const h = mount();
    box(h).value = 'foo';
    box(h).dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(h.searches.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(h.searches.map((s) => [s.query, s.options])).toEqual([['foo', OFF]]);
  });

  it('groups matches by file with line numbers and snippets', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    const groups = [...h.panel.element.querySelectorAll('.kdoc-search-file')];
    expect(groups.map((g) => g.getAttribute('data-path'))).toEqual(['/v/a.md', '/v/c.md']);
    expect([...(groups[0]?.querySelectorAll('.kdoc-search-match-line') ?? [])].map((e) => e.textContent)).toEqual(['1', '2']);
    expect([...h.panel.element.querySelectorAll('mark')].map((e) => e.textContent)).toEqual(['foo', 'foo', 'foo']);
    expect(status(h).textContent).toBe('3 matches in 2 files');
  });

  it('says when nothing matches', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'zzz');
    expect(el<HTMLInputElement>(h, '.kdoc-search-empty').textContent).toBe('No matches.');
    expect(status(h).textContent).toBe('0 matches in 0 files');
  });

  it('searches again at once when an option is toggled', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    const caseButton = el<HTMLButtonElement>(h, 'button[aria-label="Match case"]');
    caseButton.click();
    await flush();
    expect(caseButton.getAttribute('aria-pressed')).toBe('true');
    expect(h.searches.at(-1)?.options).toEqual({ caseSensitive: true, wholeWord: false, regex: false });
  });

  it('reports a malformed regular expression', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    h.searchFn = (): Promise<VaultSearchOutcome> => Promise.reject(new InvalidQueryError('Invalid regular expression: /(/gi: Unterminated group'));
    await type(h, '(');
    expect(status(h).textContent).toBe('Invalid regular expression: /(/gi: Unterminated group');
    expect(status(h).getAttribute('data-state')).toBe('error');
    expect(h.panel.element.querySelectorAll('.kdoc-search-file').length).toBe(0);
  });

  it('reports any other failure as it was given', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    h.searchFn = (): Promise<VaultSearchOutcome> => Promise.reject(new Error('vault gone'));
    await type(h, 'foo');
    expect(status(h).textContent).toBe('vault gone');
  });

  it('ignores a search superseded by a newer one', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    let release: () => void = () => undefined;
    h.searchFn = (query: string, options: SearchOptions): Promise<VaultSearchOutcome> => {
      if (query === 'fo') {
        return new Promise<VaultSearchOutcome>((resolve) => {
          release = () => { resolve({ ...searchFiles(FILES, 'zzz', options), unreadable: [] }); };
        });
      } else {
        return realSearch(query, options);
      }
    };
    await type(h, 'fo');
    await type(h, 'foo');
    expect(h.searches[0]?.signal.aborted).toBe(true);
    release();
    await flush();
    expect(status(h).textContent).toBe('3 matches in 2 files');
  });

  it('opens the note at a clicked match', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    h.panel.element.querySelectorAll<HTMLButtonElement>('.kdoc-search-match-open')[1]?.click();
    expect(h.opened.map((o) => [o.path, o.match.start, o.match.line])).toEqual([['/v/a.md', 8, 2]]);
  });

  it('notes a truncated search and unreadable notes', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    h.searchFn = (query: string, options: SearchOptions): Promise<VaultSearchOutcome> => Promise.resolve({ ...searchFiles(FILES.slice(2), query, options), truncated: true, unreadable: [{ path: '/v/x.md', message: 'gone' }] });
    await type(h, 'foo');
    expect(status(h).textContent).toBe('1 match in 1 file (stopped at the limit; narrow the search); 1 note could not be read');
  });

  it('runs the search at once on Enter', async (): Promise<void> => {
    const h = mount();
    box(h).value = 'foo';
    box(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    expect(h.searches.length).toBe(1);
  });

  it('focuses and selects the box', (): void => {
    // A follow-up command should replace rather than append to what is there.
    const h = mount();
    box(h).value = 'foo';
    h.panel.focus();
    expect(document.activeElement).toBe(box(h));
    expect([box(h).selectionStart, box(h).selectionEnd]).toEqual([0, 3]);
  });

  it('keeps its element across searches', async (): Promise<void> => {
    vi.useFakeTimers();
    const h = mount();
    const element = h.panel.element;
    await type(h, 'foo');
    await type(h, 'zzz');
    expect(h.panel.element).toBe(element);
  });

  it('stops searching once destroyed', async (): Promise<void> => {
    const h = mount();
    const input = box(h);
    input.value = 'foo';
    h.panel.destroy();
    h.panel.refresh();
    await flush();
    expect(h.searches).toEqual([]);
    expect(h.panel.element.children.length).toBe(0);
  });

  it('turns an option off again on a second click', async (): Promise<void> => {
    // A toggle must be reversible and report the cleared state in both DOM and recorded options.
    vi.useFakeTimers();
    const h = mount();
    await type(h, 'foo');
    const caseButton = el<HTMLButtonElement>(h, 'button[aria-label="Match case"]');
    caseButton.click();
    await flush();
    caseButton.click();
    await flush();
    expect(caseButton.getAttribute('aria-pressed')).toBe('false');
    expect(h.searches.at(-1)?.options).toEqual({ caseSensitive: false, wholeWord: false, regex: false });
  });
});
