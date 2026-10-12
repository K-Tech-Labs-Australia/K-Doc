// @vitest-environment jsdom
/**
 * @file link-definitions-panel.spec.ts
 * @purpose Verifies the link definitions panel renders rows, reveals on click, converts inline links, refreshes, and stops after destroy.
 * @inputs LinkDefinitionRow arrays; a mount harness that captures reveal offsets and conversion counts as side effects.
 * @outputs Test assertions against rendered DOM classes, text content, hidden state, and callback invocation counts.
 * @functions
 *   - mount: Installs the panel in jsdom wired to mutable test state and returns a Harness.
 *   - afterEach: Detaches and destroys every mounted panel after each test.
 * @dataflow ROWS / empty rows → mount() → installLinkDefinitionsPanel → rendered DOM → it() assertions.
 * @controlflow Describe → mount per case → click/refresh/destroy actions → expect assertions → cleanup via afterEach.
 * @version 1
 * @date 2026-09-16
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installLinkDefinitionsPanel } from '../src/shell/link-definitions-panel.js';
import type { LinkDefinitionRow, LinkDefinitionsPanel } from '../src/shell/link-definitions-panel.js';

const panels: LinkDefinitionsPanel[] = [];

afterEach(() => {
  for (const panel of panels.splice(0)) {
    panel.element.remove();
    panel.destroy();
  }
});

interface Harness {
  rows: LinkDefinitionRow[];
  revealed: number[];
  converted: number;
  panel: LinkDefinitionsPanel;
}

// mount installs a link definitions panel in jsdom and returns a harness.
// @purpose Creates an installLinkDefinitionsPanel instance wired to mutable test state.
// @inputs rows - LinkDefinitionRow[] used as the initial (and later mutated) definition set.
// @outputs Harness - Panel plus captured revealed offsets, conversion count, and row reference.
// @dataflow rows → definitions() closure; reveal/convert callbacks push into harness arrays/counters.
// @controlflow Build harness → install panel → append to body → register for cleanup → return harness.
function mount(rows: LinkDefinitionRow[]): Harness {
  const harness: Harness = { rows, revealed: [], converted: 0, panel: undefined as unknown as LinkDefinitionsPanel };
  harness.panel = installLinkDefinitionsPanel({
    doc: document,
    definitions: () => harness.rows,
    reveal: (offset) => { harness.revealed.push(offset); },
    convert: () => { harness.converted += 1; },
  });
  document.body.appendChild(harness.panel.element);
  panels.push(harness.panel);
  return harness;
}

const ROWS: LinkDefinitionRow[] = [
  { label: 'one', url: 'https://one', title: null, start: 10, uses: 2, duplicate: false },
  { label: 'two', url: 'https://two', title: 'T', start: 30, uses: 1, duplicate: false },
  { label: 'one', url: 'https://dup', title: null, start: 50, uses: 2, duplicate: true },
  { label: 'three', url: 'https://three', title: null, start: 70, uses: 0, duplicate: false },
];

describe('link definitions panel', () => {
  // Asserts rendered labels, usage badges, URL/title text, and the total count.
  it('lists each definition with its target and how it is used', () => {
    const { panel } = mount(ROWS);
    const buttons = [...panel.element.querySelectorAll('.kdoc-link-definition')];
    expect(buttons.map((button) => button.querySelector('.kdoc-link-definition-label')?.textContent)).toEqual(['[one]', '[two]', '[one]', '[three]']);
    expect(buttons.map((button) => button.querySelector('.kdoc-link-definition-badge')?.textContent)).toEqual(['used 2 times', 'used once', 'duplicate, never used', 'unused']);
    expect(buttons[1]?.querySelector('.kdoc-link-definition-url')?.textContent).toBe('https://two "T"');
    expect(panel.element.querySelector('.kdoc-link-definitions-count')?.textContent).toBe('4 definitions');
  });

  // Asserts each badge's data-kind attribute matches expected warning categories.
  it('marks unused and duplicate definitions for warning styles', () => {
    const { panel } = mount(ROWS);
    const kinds = [...panel.element.querySelectorAll<HTMLElement>('.kdoc-link-definition-badge')].map((badge) => badge.dataset['kind']);
    expect(kinds).toEqual(['used', 'used', 'duplicate', 'unused']);
  });

  // Clicks the third row and asserts the correct offset is revealed.
  it('reveals a definition when its row is clicked', () => {
    const harness = mount(ROWS);
    harness.panel.element.querySelectorAll<HTMLButtonElement>('.kdoc-link-definition')[2]?.click();
    expect(harness.revealed).toEqual([50]);
  });

  // Clicks the convert button on an empty panel and asserts one conversion.
  it('converts inline links from the header button', () => {
    const harness = mount([]);
    harness.panel.element.querySelector<HTMLButtonElement>('.kdoc-link-definitions-convert')?.click();
    expect(harness.converted).toBe(1);
  });

  // Asserts the empty state is shown with zero count text and no rows.
  it('says so when there are no definitions', () => {
    const { panel } = mount([]);
    expect(panel.element.querySelector<HTMLElement>('.kdoc-link-definitions-empty')?.hidden).toBe(false);
    expect(panel.element.querySelectorAll('.kdoc-link-definition').length).toBe(0);
    expect(panel.element.querySelector('.kdoc-link-definitions-count')?.textContent).toBe('0 definitions');
  });

  // Mutates rows, refreshes, and asserts the panel reflects the new single definition.
  it('redraws from the current definitions on refresh', () => {
    const harness = mount([]);
    harness.rows = [{ label: 'x', url: 'https://x', title: null, start: 3, uses: 1, duplicate: false }];
    harness.panel.refresh();
    expect(harness.panel.element.querySelector<HTMLElement>('.kdoc-link-definitions-empty')?.hidden).toBe(true);
    expect(harness.panel.element.querySelector('.kdoc-link-definitions-count')?.textContent).toBe('1 definition');
  });

  // Destroys the panel then verifies no callbacks fire and DOM is cleared.
  it('stops redrawing and responding once destroyed', () => {
    const harness = mount(ROWS);
    const button = harness.panel.element.querySelector<HTMLButtonElement>('.kdoc-link-definitions-convert');
    let reads = 0;
    harness.rows = new Proxy(harness.rows, { get: (target, key, receiver) => { reads += 1; return Reflect.get(target, key, receiver); } });
    harness.panel.destroy();
    button?.click();
    harness.panel.refresh();
    expect(reads).toBe(0);
    expect(harness.converted).toBe(0);
    expect(harness.panel.element.children.length).toBe(0);
  });
});
