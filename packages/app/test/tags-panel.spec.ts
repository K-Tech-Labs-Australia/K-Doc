// @vitest-environment jsdom

/**
 * @file tags-panel.spec.ts
 * @purpose Vitest test suite for the TagsPanel left sidebar list panel (FR-14.6). Validates empty states, tag expansion/collapse, note opening, selection survival across refresh, and lifecycle teardown under jsdom. (The Files panel tests moved to files-panel.spec.ts when it became a file tree.)
 * @inputs TagRow fixtures, user click events, and mock host callbacks.
 * @outputs Vitest assertions verifying DOM hierarchy, text content, ARIA attributes, button actions, and stylesheet exports.
 * @functions
 *   - mountTags: Instantiates and mounts a TagsPanel controller on a mock Document context with mutable state.
 *   - texts: Queries all matching elements within a container and returns their trimmed textContent.
 *   - tagButton: Re-queries a tag row button by its tag, because toggling redraws the list.
 * @dataflow Fixture data -> mountTags -> DOM node evaluation & click events -> assertion verifications.
 * @controlflow Mount panel harnesses -> execute the Tags panel assertions -> invoke destroy() on active panels in afterEach.
 * @version 2
 * @date 2026-09-14
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installTagsPanel, TAGS_PANEL_STYLES } from '../src/shell/tags-panel.js';
import type { TagsPanel, TagRow, TaggedNote } from '../src/shell/tags-panel.js';

const activePanels: TagsPanel[] = [];
const activeHosts: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < activeHosts.length; i++) {
    const host = activeHosts[i];
    // Check if the host element is defined under strict indexing.
    if (host !== undefined) {
      // Defined: take it back out of the document.
      host.remove();
    } else {
      // Undefined: skip.
    }
  }
  activeHosts.length = 0;

  for (let i = 0; i < activePanels.length; i++) {
    const panel = activePanels[i];
    // Check if the panel instance is defined to satisfy strict noUncheckedIndexedAccess.
    if (panel !== undefined) {
      // Defined panel instance: execute lifecycle teardown.
      panel.destroy();
    } else {
      // Undefined panel instance at index: skip iteration.
    }
  }
  activePanels.length = 0;
});


interface TagsHarness {
  readonly panel: TagsPanel;
  readonly opened: string[];
  tags: TagRow[];
  notesFor: Map<string, TaggedNote[]>;
  hasVault: boolean;
}

interface MutableTagsHarness {
  panel?: TagsPanel;
  readonly opened: string[];
  tags: TagRow[];
  notesFor: Map<string, TaggedNote[]>;
  hasVault: boolean;
}

/**
 * Instantiates and mounts a TagsPanel controller with configurable reactive accessors and invocation recorders.
 *
 * @purpose Allocates a test harness for TagsPanel, tracking opened notes and tag queries while exposing mutable state for refresh cycles.
 * @inputs initial - Optional initial state overrides for tags, notesFor map, and hasVault flag.
 * @outputs TagsHarness - Test harness containing the mounted TagsPanel, opened note paths, mutable tag collection, and notes map.
 * @dataflow initial parameters -> mutable harness state -> installTagsPanel -> registered in activePanels -> TagsHarness returned.
 * @controlflow Initialize mutable state -> instantiate TagsPanel with closures over state properties -> register panel in activePanels -> return harness.
 */
function mountTags(
  initial?: {
    tags?: TagRow[];
    notesFor?: Map<string, TaggedNote[]>;
    hasVault?: boolean;
  },
): TagsHarness {
  // Build a mutable harness object first so the installTagsPanel accessor closures
  // can close over its properties directly. We then assign panel onto the harness
  // once instantiated and return it, allowing test cases to mutate harness.tags or
  // harness.notesFor before invoking panel.refresh().
  const harness: MutableTagsHarness = {
    opened: [],
    tags: initial?.tags !== undefined ? [...initial.tags] : [],
    notesFor: initial?.notesFor !== undefined ? initial.notesFor : new Map<string, TaggedNote[]>(),
    hasVault: initial?.hasVault !== undefined ? initial.hasVault : true,
  };

  const panel = installTagsPanel({
    doc: document,
    tags: (): readonly TagRow[] => harness.tags,
    notesTagged: (tag: string): readonly TaggedNote[] => {
      const match = harness.notesFor.get(tag);
      // Check whether notes exist for this tag in the harness lookup map.
      if (match !== undefined) {
        // Match found: return the tagged notes list.
        return match;
      } else {
        // No match found: return empty array.
        return [];
      }
    },
    hasVault: (): boolean => harness.hasVault,
    openNote: (path: string): void => {
      harness.opened.push(path);
    },
  });

  harness.panel = panel;
  activePanels.push(panel);

  // Put it in the document. A detached element cannot take focus, and a panel the sidebar never
  // mounted is not the panel under test.
  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);
  activeHosts.push(host);

  return harness as TagsHarness;
}

/**
 * Queries all matching elements within a container element and returns their trimmed textContent.
 *
 * @purpose Extracts trimmed text content from all DOM descendants matching a CSS selector.
 * @inputs root - The root HTMLElement to query within.
 * @inputs selector - CSS selector string matching target elements.
 * @outputs readonly string[] - Array of trimmed text strings from matched elements.
 * @dataflow root -> querySelectorAll(selector) -> NodeList iteration -> trimmed text strings.
 * @controlflow Query all matching elements -> loop through nodes -> extract and trim textContent -> return array.
 */
function texts(root: HTMLElement, selector: string): readonly string[] {
  const elements = root.querySelectorAll(selector);
  const result: string[] = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    // Check if the element at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (element !== undefined) {
      const text = element.textContent;
      // Check if textContent is non-null.
      if (text !== null) {
        // Non-null text: append trimmed string.
        result.push(text.trim());
      } else {
        // Null textContent: append empty string.
        result.push('');
      }
    } else {
      // Undefined element: skip iteration.
    }
  }

  return result;
}

/**
 * Finds a tag row button by its tag, in the panel as it stands right now.
 *
 * @purpose Re-queries the tag button rather than reusing a held reference.
 * @inputs panel - The mounted TagsPanel. tag - The tag whose button is wanted.
 * @outputs HTMLButtonElement - The button currently representing that tag.
 * @dataflow panel.element -> querySelector by data-tag -> button.
 * @controlflow Fails the test when the tag has no button on screen.
 *
 * Toggling redraws the whole list, so a reference taken before a click points at a button that has
 * since been replaced. A user reads what is on screen now, and so does this.
 */
function tagButton(panel: TagsPanel, tag: string): HTMLButtonElement {
  const button = panel.element.querySelector<HTMLButtonElement>(
    'button.kdoc-tags-tag[data-tag="' + tag + '"]',
  );
  // Check whether that tag has a button on screen.
  if (button === null) {
    // Absent: say which tag was missing rather than failing on a null dereference later.
    expect.fail('No tag button for ' + tag);
  } else {
    // Present: hand it back.
    return button;
  }
}

describe('the Tags panel', (): void => {
  it('says so with no vault', (): void => {
    const harness = mountTags({ hasVault: false });
    const emptyMessages = texts(harness.panel.element, '.kdoc-tags-empty');
    expect(emptyMessages).toEqual(['No folder open.']);
  });

  it('says so with no tags', (): void => {
    // An empty list says nothing about whether the vault has no tags or the panel is broken.
    const harness = mountTags({ hasVault: true, tags: [] });
    const emptyMessages = texts(harness.panel.element, '.kdoc-tags-empty');
    expect(emptyMessages).toEqual(['No tags in this vault.']);
  });

  it('shows each tag with a hash and a count', (): void => {
    // The panel shows a tag the way the document writes it.
    const harness = mountTags({
      hasVault: true,
      tags: [
        { tag: 'work', count: 3 },
        { tag: 'idea', count: 1 },
      ],
    });
    expect(texts(harness.panel.element, '.kdoc-tags-name')).toEqual(['#work', '#idea']);
    expect(texts(harness.panel.element, '.kdoc-tags-count')).toEqual(['3', '1']);
  });

  it('expands a tag when it is clicked', (): void => {
    const notesFor = new Map<string, TaggedNote[]>([
      [
        'work',
        [
          { path: '/v/todo.md', relative: 'todo.md', title: 'Todo List' },
          { path: '/v/meeting.md', relative: 'meeting.md', title: 'Meeting Notes' },
        ],
      ],
    ]);
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'work', count: 2 }],
      notesFor,
    });

    tagButton(harness.panel, 'work').click();
    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('true');

    const noteTitles = texts(harness.panel.element, '.kdoc-tags-note');
    expect(noteTitles).toEqual(['Todo List', 'Meeting Notes']);
  });

  it('collapses it again on a second click', (): void => {
    const notesFor = new Map<string, TaggedNote[]>([
      ['work', [{ path: '/v/todo.md', relative: 'todo.md', title: 'Todo List' }]],
    ]);
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'work', count: 1 }],
      notesFor,
    });

    tagButton(harness.panel, 'work').click();
    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('true');
    expect(texts(harness.panel.element, '.kdoc-tags-note')).toEqual(['Todo List']);

    // A tag panel that could only ever open and never close would grow until it was unusable.
    tagButton(harness.panel, 'work').click();
    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('false');

    expect(texts(harness.panel.element, '.kdoc-tags-note')).toHaveLength(0);
  });

  it('opens a note from the expanded list', (): void => {
    const targetPath = '/v/todo.md';
    const notesFor = new Map<string, TaggedNote[]>([
      ['work', [{ path: targetPath, relative: 'todo.md', title: 'Todo List' }]],
    ]);
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'work', count: 1 }],
      notesFor,
    });

    tagButton(harness.panel, 'work').click();

    const noteButton = harness.panel.element.querySelector<HTMLButtonElement>(
      `button.kdoc-tags-note[data-path="${targetPath}"]`,
    );
    expect(noteButton).not.toBeNull();
    // Check if note button exists to satisfy strict null checks.
    if (noteButton !== null) {
      // Click note button to activate openNote callback.
      noteButton.click();
    } else {
      // Button not found: unreachable under passing assertion.
    }

    expect(harness.opened).toEqual([targetPath]);
  });

  it('says so when a selected tag has no notes', (): void => {
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'empty-tag', count: 0 }],
      notesFor: new Map<string, TaggedNote[]>([['empty-tag', []]]),
    });

    tagButton(harness.panel, 'empty-tag').click();

    const notesContainer = harness.panel.element.querySelector<HTMLElement>('.kdoc-tags-notes');
    expect(notesContainer).not.toBeNull();
    // Check if notes container exists to satisfy strict null checks.
    if (notesContainer !== null) {
      // Verify empty readout is located inside the notes container.
      expect(texts(notesContainer, '.kdoc-tags-empty')).toEqual(['No notes with this tag.']);
    } else {
      // Container not found: unreachable under passing assertion.
    }
  });

  it('drops a selection for a tag that no longer exists', (): void => {
    const notesFor = new Map<string, TaggedNote[]>([
      ['work', [{ path: '/v/work.md', relative: 'work.md', title: 'Work Note' }]],
      ['idea', [{ path: '/v/idea.md', relative: 'idea.md', title: 'Idea Note' }]],
    ]);
    const harness = mountTags({
      hasVault: true,
      tags: [
        { tag: 'work', count: 1 },
        { tag: 'idea', count: 1 },
      ],
      notesFor,
    });

    tagButton(harness.panel, 'work').click();
    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('true');

    // Silently showing its old note list would be showing something that is not there.
    harness.tags = [{ tag: 'idea', count: 1 }];
    harness.panel.refresh();

    const pressedElements = harness.panel.element.querySelectorAll('[aria-pressed="true"]');
    expect(pressedElements).toHaveLength(0);
    expect(texts(harness.panel.element, '.kdoc-tags-note')).toHaveLength(0);

    // A selection that was merely hidden rather than dropped looks identical here -- the tag has no
    // row to be pressed on either way. Bringing the tag back is what tells them apart: a dropped
    // selection stays dropped, while a kept one springs open again on a tag the user never re-picked.
    harness.tags = [
      { tag: 'work', count: 1 },
      { tag: 'idea', count: 1 },
    ];
    harness.panel.refresh();

    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('false');
    expect(texts(harness.panel.element, '.kdoc-tags-note')).toHaveLength(0);
  });

  it('keeps a selection that still exists', (): void => {
    const notesFor = new Map<string, TaggedNote[]>([
      ['work', [{ path: '/v/work.md', relative: 'work.md', title: 'Work Note' }]],
    ]);
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'work', count: 1 }],
      notesFor,
    });

    tagButton(harness.panel, 'work').click();
    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('true');

    harness.panel.refresh();

    expect(tagButton(harness.panel, 'work').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves focus on the tag that was toggled', (): void => {
    // Toggling redraws the whole list, so the button the user pressed stops existing. Without putting
    // focus on the one that replaced it, a keyboard user is dropped to the top of the document in the
    // middle of a gesture they are not finished with.
    const harness = mountTags({
      hasVault: true,
      tags: [{ tag: 'work', count: 1 }],
      notesFor: new Map<string, TaggedNote[]>([
        ['work', [{ path: '/v/a.md', relative: 'a.md', title: 'A' }]],
      ]),
    });

    tagButton(harness.panel, 'work').click();

    expect(document.activeElement).toBe(tagButton(harness.panel, 'work'));
  });

  it('exports styles naming its own classes', (): void => {
    expect(TAGS_PANEL_STYLES).toContain('kdoc-tags-tag');
  });
});
