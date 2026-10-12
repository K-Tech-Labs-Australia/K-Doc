// @vitest-environment jsdom
/**
 * @file search-results-view.spec.ts
 * @purpose Exercises the confirm-before-replace selection store and DOM rendering for vault search results.
 * @inputs The shared RESULT fixture produced by searchFiles; the jsdom document environment.
 * @outputs Assertions over ResultSelection state, rendered checkbox groups, and listener wiring.
 * @functions
 *   - draw: Mounts renderResults into a fresh div on the body and returns host, selection, opened, changes, controller.
 *   - boxes: Collects all inputs matching a selector within a host element.
 * @dataflow RESULT fixture -> createResultSelection/renderResults -> DOM checkboxes -> selection store + callbacks.
 * @controlflow Fixture setup -> afterEach cleanup -> describe blocks for selection and rendering with per-case assertions.
 * @version 1
 * @date 2026-09-14
 */

import { afterEach, describe, expect, it } from 'vitest';

import { searchFiles, type FileMatch, type VaultSearchResult } from '@k-doc/core';

import { createResultSelection, renderResults } from '../src/shell/search-results-view.js';

const RESULT: VaultSearchResult = searchFiles(
  [
    { path: '/v/a.md', relative: 'a.md', text: 'foo\nbar foo' },
    { path: '/v/c.md', relative: 'c.md', text: '<b>foo</b>' },
  ],
  'foo',
  {},
);

afterEach((): void => {
  document.body.replaceChildren();
});

interface DrawState {
  host: HTMLElement;
  selection: ReturnType<typeof createResultSelection>;
  opened: { path: string; match: FileMatch }[];
  changes: { count: number };
  controller: AbortController;
}

/**
 * @purpose Mounts renderResults into a fresh div on the body and returns everything tests need.
 * @inputs void
 * @outputs DrawState - host element, selection store, opened-match log, change counter, and abort controller.
 * @dataflow createResultSelection + renderResults -> appended DOM -> returned state object.
 * @controlflow Build selection and controller -> mount groups into host on body -> return assembled state.
 */
function draw(): DrawState {
  const selection = createResultSelection();
  const controller = new AbortController();
  const opened: { path: string; match: FileMatch }[] = [];
  const changes = { count: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  host.append(
    ...renderResults(RESULT, {
      doc: document,
      selection,
      openMatch: (path, match) => { opened.push({ path, match }); },
      onSelectionChange: () => { changes.count++; },
      signal: controller.signal,
    }),
  );
  return { host, selection, opened, changes, controller };
}

/**
 * @purpose Collects every checkbox input matching a selector within a host element.
 * @inputs host - Element to search within.
 * @inputs selector - CSS selector for the inputs to collect.
 * @outputs HTMLInputElement[] - All matching inputs as an array.
 * @dataflow host.querySelectorAll -> spread into array.
 * @controlflow Query and return; no branching.
 */
function boxes(host: HTMLElement, selector: string): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>(selector)];
}

describe('createResultSelection', (): void => {
  it('chooses every match at first', (): void => {
    const s = createResultSelection();
    expect(s.count(RESULT)).toBe(3);
    expect([...s.chosen(RESULT)]).toEqual([
      ['/v/a.md', [{ start: 0, end: 3 }, { start: 8, end: 11 }]],
      ['/v/c.md', [{ start: 3, end: 6 }]],
    ]);
  });

  it('leaves out an unticked match, and a file with none left', (): void => {
    const s = createResultSelection();
    const c = RESULT.files[1]?.matches[0];
    if (c === undefined) throw new Error('fixture');
    s.setChosen('/v/c.md', c, false);
    expect(s.isChosen('/v/c.md', c)).toBe(false);
    expect(s.count(RESULT)).toBe(2);
    expect([...s.chosen(RESULT).keys()]).toEqual(['/v/a.md']);
  });

  it('tells apart the same range in two files', (): void => {
    const s = createResultSelection();
    const a0 = RESULT.files[0]?.matches[0];
    if (a0 === undefined) throw new Error('fixture');
    s.setChosen('/v/other.md', a0, false);
    expect(s.isChosen('/v/a.md', a0)).toBe(true);
  });

  it('ticks a match again, and reset forgets every untick', (): void => {
    const s = createResultSelection();
    const c = RESULT.files[1]?.matches[0];
    if (c === undefined) throw new Error('fixture');
    s.setChosen('/v/c.md', c, false);
    s.setChosen('/v/c.md', c, true);
    expect(s.isChosen('/v/c.md', c)).toBe(true);
    s.setChosen('/v/c.md', c, false);
    s.reset();
    expect(s.count(RESULT)).toBe(3);
  });
});

describe('renderResults', (): void => {
  it('draws one group per file with a count', (): void => {
    const d = draw();
    expect([...d.host.querySelectorAll('.kdoc-search-file-name')].map((e) => e.textContent)).toEqual(['a.md', 'c.md']);
    expect([...d.host.querySelectorAll('.kdoc-search-file-count')].map((e) => e.textContent)).toEqual(['2', '1']);
  });

  it('shows snippet text as text, not markup', (): void => {
    const d = draw();
    const row = d.host.querySelectorAll('.kdoc-search-match-open')[2];
    expect(row?.querySelector('b')).toBeNull();
    expect(row?.textContent).toBe('<b>foo</b>');
    expect(row?.getAttribute('title')).toBe('c.md:1:4');
  });

  it('unticking a row updates the choice, the file box and the listener', (): void => {
    const d = draw();
    const rows = boxes(d.host, '.kdoc-search-match-check');
    const second = rows[1];
    if (second === undefined) throw new Error('row');
    second.checked = false;
    second.dispatchEvent(new Event('change'));
    expect(d.selection.count(RESULT)).toBe(2);
    expect(d.changes.count).toBe(1);
    const fileBox = boxes(d.host, '.kdoc-search-file-check')[0];
    expect(fileBox?.checked).toBe(false);
    expect(fileBox?.indeterminate).toBe(true);
  });

  it('the file box ticks and unticks every row of its file', (): void => {
    const d = draw();
    const fileBox = boxes(d.host, '.kdoc-search-file-check')[0];
    if (fileBox === undefined) throw new Error('box');
    fileBox.checked = false;
    fileBox.dispatchEvent(new Event('change'));
    expect(boxes(d.host, '.kdoc-search-match-check').map((b) => b.checked)).toEqual([false, false, true]);
    expect(d.selection.count(RESULT)).toBe(1);
    expect(fileBox.indeterminate).toBe(false);
    expect(d.changes.count).toBe(1);
    fileBox.checked = true;
    fileBox.dispatchEvent(new Event('change'));
    expect(d.selection.count(RESULT)).toBe(3);
  });

  it('draws rows unticked when the selection says so', (): void => {
    const s = createResultSelection();
    const a1 = RESULT.files[0]?.matches[1];
    if (a1 === undefined) throw new Error('fixture');
    s.setChosen('/v/a.md', a1, false);
    const host = document.createElement('div');
    host.append(
      ...renderResults(RESULT, {
        doc: document,
        selection: s,
        openMatch: () => undefined,
        onSelectionChange: () => undefined,
        signal: new AbortController().signal,
      }),
    );
    expect(boxes(host, '.kdoc-search-match-check').map((b) => b.checked)).toEqual([true, false, true]);
    expect(boxes(host, '.kdoc-search-file-check')[0]?.indeterminate).toBe(true);
  });

  it('opens the clicked match', (): void => {
    const d = draw();
    (d.host.querySelectorAll<HTMLButtonElement>('.kdoc-search-match-open')[1])?.click();
    expect(d.opened.map((o) => [o.path, o.match.start])).toEqual([['/v/a.md', 8]]);
  });

  it('stops listening once its signal aborts', (): void => {
    const d = draw();
    d.controller.abort();
    d.host.querySelector<HTMLButtonElement>('.kdoc-search-match-open')?.click();
    expect(d.opened).toEqual([]);
  });

  it('shows a file box unticked, not a dash, once every row of its file is unticked', (): void => {
    const d = draw();
    // Untick both rows of the first file (a.md has two matches).
    const rows = boxes(d.host, '.kdoc-search-match-check').slice(0, 2);
    for (const row of rows) {
      row.checked = false;
      row.dispatchEvent(new Event('change'));
    }
    const fileBox = boxes(d.host, '.kdoc-search-file-check')[0];
    expect(fileBox?.checked).toBe(false);
    expect(fileBox?.indeterminate).toBe(false);
  });
});
