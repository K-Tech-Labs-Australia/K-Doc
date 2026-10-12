// @vitest-environment jsdom

/**
 * @file metadata-panel.spec.ts
 * @purpose Vitest test suite for MetadataPanel right sidebar surface (FR-14.7). Validates front-matter value
 *   formatting, static three-section layout (File, Front matter, Statistics), file path resolution with POSIX and
 *   Windows separators, unsaved state fallbacks, front-matter key enumeration and value rendering, document statistics
 *   formatting with thousands separators, reading time boundary conditions, tooltip title attributes on paths,
 *   DOM element stability across refreshes, idempotent destruction, and stylesheet exports under jsdom.
 * @inputs Document path string/null, front-matter records, and MetadataStatistics fixtures.
 * @outputs Vitest assertions verifying DOM hierarchy, text content, data-key attributes, tooltips, and stylesheet exports.
 * @functions
 *   - mount: Instantiates and mounts a MetadataPanel controller with mutable harness accessors.
 *   - rowValue: Locates a metadata row by key and returns its trimmed value text, failing if absent.
 *   - texts: Extracts trimmed text content from all DOM descendants matching a CSS selector.
 * @dataflow Fixture mutations -> MetadataPanel refresh -> DOM node reconstruction -> rowValue / texts -> Vitest assertions.
 * @controlflow Mount metadata panel harness -> execute formatFieldValue unit assertions -> execute panel integration assertions -> destroy active panels and remove host elements in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach } from 'vitest';
import { installMetadataPanel, METADATA_PANEL_STYLES, formatFieldValue } from '../src/shell/metadata-panel.js';
import type { MetadataPanel, MetadataPanelOptions, MetadataStatistics } from '../src/shell/metadata-panel.js';

const activePanels: MetadataPanel[] = [];
const activeHosts: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < activeHosts.length; i++) {
    const host = activeHosts[i];
    // Check if the host element is defined under strict indexing.
    if (host !== undefined) {
      // Defined: remove host element from document body.
      host.remove();
    } else {
      // Undefined: skip iteration.
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

interface Harness {
  readonly panel: MetadataPanel;
  documentPath: string | null;
  frontMatter: Readonly<Record<string, unknown>> | null;
  statistics: MetadataStatistics;
}

interface MutableHarness {
  panel?: MetadataPanel;
  documentPath: string | null;
  frontMatter: Readonly<Record<string, unknown>> | null;
  statistics: MetadataStatistics;
}

const DEFAULT_STATISTICS: MetadataStatistics = {
  words: 0,
  charactersWithSpaces: 0,
  charactersWithoutSpaces: 0,
  paragraphs: 0,
  sentences: 0,
  readingMinutes: 0,
};

/**
 * Instantiates and mounts a MetadataPanel controller with configurable reactive accessors.
 *
 * @purpose Allocates a test harness for MetadataPanel, exposing mutable path, front-matter, and statistics properties closed over by panel accessors.
 * @inputs initial - Optional initial state overrides for documentPath, frontMatter, and statistics.
 * @outputs Harness - Test harness containing the mounted MetadataPanel and mutable accessor properties.
 * @dataflow initial parameters -> mutable harness state -> installMetadataPanel -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize mutable state -> instantiate MetadataPanel with closures over harness properties -> register panel in activePanels -> attach host to document body -> return harness.
 */
function mount(initial?: {
  documentPath?: string | null;
  frontMatter?: Readonly<Record<string, unknown>> | null;
  statistics?: MetadataStatistics;
}): Harness {
  let initialPath: string | null = 'C:/vault/notes/plan.md';
  // Check whether an initial documentPath override was provided.
  if (initial?.documentPath !== undefined) {
    // Override provided: use the specified path (or null for unsaved).
    initialPath = initial.documentPath;
  } else {
    // No override: retain default fixture path.
  }

  let initialFrontMatter: Readonly<Record<string, unknown>> | null = null;
  // Check whether an initial frontMatter override was provided.
  if (initial?.frontMatter !== undefined) {
    // Override provided: use the specified front-matter record (or null).
    initialFrontMatter = initial.frontMatter;
  } else {
    // No override: retain default null front matter.
  }

  let initialStatistics: MetadataStatistics = DEFAULT_STATISTICS;
  // Check whether an initial statistics override was provided.
  if (initial?.statistics !== undefined) {
    // Override provided: use the specified statistics counts.
    initialStatistics = initial.statistics;
  } else {
    // No override: retain default all-zero statistics fixture.
  }

  const harness: MutableHarness = {
    documentPath: initialPath,
    frontMatter: initialFrontMatter,
    statistics: initialStatistics,
  };

  const options: MetadataPanelOptions = {
    doc: document,
    documentPath: (): string | null => harness.documentPath,
    frontMatter: (): Readonly<Record<string, unknown>> | null => harness.frontMatter,
    statistics: (): MetadataStatistics => harness.statistics,
  };

  const panel = installMetadataPanel(options);
  harness.panel = panel;
  activePanels.push(panel);

  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);
  activeHosts.push(host);

  return harness as Harness;
}

/**
 * Locates a metadata row by key and returns its trimmed value text, failing if absent.
 *
 * @purpose Finds the .kdoc-metadata-value element for a given data-key and returns its trimmed textContent.
 * @inputs panel - The MetadataPanel instance containing the row.
 * @inputs key - The data-key attribute identifying the metadata row.
 * @outputs string - The trimmed text content of the row's value element.
 * @dataflow panel.element -> querySelector with data-key selector -> textContent -> trimmed string.
 * @controlflow Locate value element matching selector -> check null -> if null expect.fail(key); else return trimmed text.
 */
function rowValue(panel: MetadataPanel, key: string): string {
  const valueElement = panel.element.querySelector<HTMLElement>(
    `.kdoc-metadata-row[data-key="${key}"] .kdoc-metadata-value`,
  );
  // Check whether the value element for the specified key exists in the DOM.
  if (valueElement === null) {
    // Value element not found: fail the test naming the missing key.
    expect.fail(`Expected metadata row with data-key="${key}" to have a .kdoc-metadata-value element`);
  } else {
    // Value element found: extract text content.
    const text = valueElement.textContent;
    // Check whether textContent is non-null.
    if (text !== null) {
      // Non-null text: return trimmed string.
      return text.trim();
    } else {
      // Null text: return empty string.
      return '';
    }
  }
}

/**
 * Extracts trimmed text content from all DOM descendants matching a CSS selector.
 *
 * @purpose Queries all matching elements within a root container and returns their trimmed textContent.
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

describe('formatFieldValue', (): void => {
  it('formats null as "null"', (): void => {
    // Explicit null YAML field values must be visible to the user as literal null rather than appearing blank.
    expect(formatFieldValue(null)).toBe('null');
  });

  it('formats undefined as an empty string', (): void => {
    // Undefined front-matter fields have no value and should render blank without placeholder clutter.
    expect(formatFieldValue(undefined)).toBe('');
  });

  it('formats non-empty strings unquoted', (): void => {
    // String values represent human-readable textual metadata and should display without enclosing quotation marks.
    expect(formatFieldValue('draft')).toBe('draft');
  });

  it('formats empty strings as empty strings', (): void => {
    // An empty string denotes explicit empty text and should render as an empty string without placeholder substitution.
    expect(formatFieldValue('')).toBe('');
  });

  it('formats positive numbers as strings', (): void => {
    // Numeric front-matter properties like counts or priority levels must display as decimal strings.
    expect(formatFieldValue(42)).toBe('42');
  });

  it('formats zero without swallowing falsy numbers', (): void => {
    // A zero numeric value is a valid front-matter number and must not be treated as a missing or falsy value.
    expect(formatFieldValue(0)).toBe('0');
  });

  it('formats true as "true"', (): void => {
    // Boolean flags such as draft or published status must display their lowercase boolean keyword.
    expect(formatFieldValue(true)).toBe('true');
  });

  it('formats false without swallowing falsy booleans', (): void => {
    // A false boolean flag represents an explicit negative state and must not be swallowed as falsy.
    expect(formatFieldValue(false)).toBe('false');
  });

  it('formats string arrays as comma-separated values', (): void => {
    // tags: [a, b] is the commonest front-matter value there is, and printing [object Object] for it would make the field unreadable at exactly the moment it matters.
    expect(formatFieldValue(['a', 'b'])).toBe('a, b');
  });

  it('formats empty arrays as "(empty)"', (): void => {
    // An empty list signifies an existing but empty field and is rendered distinctly so users know it is not missing.
    expect(formatFieldValue([])).toBe('(empty)');
  });

  it('formats heterogeneous arrays through the same formatter', (): void => {
    // Array elements of mixed primitive types must adhere to the same formatting rules as top-level fields.
    expect(formatFieldValue([1, true, null])).toBe('1, true, null');
  });

  it('formats nested arrays into a flattened comma-separated list', (): void => {
    // Nested array structures should be recursively formatted and flattened so raw bracket notation is avoided.
    expect(formatFieldValue(['a', ['b', 'c']])).toBe('a, b, c');
  });

  it('formats plain objects as compact JSON', (): void => {
    // Structured object maps in front matter that cannot be rendered as simple strings are serialized to JSON for diagnostic visibility.
    expect(formatFieldValue({ a: 1 })).toBe('{"a":1}');
  });

  it('formats circular objects as "(unreadable)" without throwing', (): void => {
    // A front-matter field that cannot be printed must not take the whole panel down with it.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect((): void => {
      formatFieldValue(circular);
    }).not.toThrow();
    expect(formatFieldValue(circular)).toBe('(unreadable)');
  });
});

describe('the Metadata panel', (): void => {
  it('always renders the three sections in order even when empty', (): void => {
    // The sections are the panel's shape and do not come and go with their content.
    const { panel } = mount({
      documentPath: null,
      frontMatter: null,
      statistics: {
        words: 0,
        charactersWithSpaces: 0,
        charactersWithoutSpaces: 0,
        paragraphs: 0,
        sentences: 0,
        readingMinutes: 0,
      },
    });

    expect(texts(panel.element, '.kdoc-metadata-heading')).toEqual([
      'File',
      'Front matter',
      'Statistics',
    ]);
  });

  it('names the file and displays its full path in the File section', (): void => {
    // Users need confirmation of the file being edited and its absolute location on the filesystem.
    const { panel } = mount({ documentPath: 'C:/vault/notes/plan.md' });

    expect(rowValue(panel, 'Name')).toBe('plan.md');
    expect(rowValue(panel, 'Path')).toBe('C:/vault/notes/plan.md');
  });

  it('splits Windows backslash paths to extract the file name', (): void => {
    // Windows is the only platform this ships on, so a separator it cannot split is not a hypothetical.
    const { panel } = mount({ documentPath: 'C:\\vault\\notes\\plan.md' });

    expect(rowValue(panel, 'Name')).toBe('plan.md');
  });

  it('does not blank the file name when a path has a trailing separator', (): void => {
    // Trailing path separators from directory normalisation or edge cases must not cause an empty name display.
    const { panel } = mount({ documentPath: 'C:/vault/notes/plan.md/' });

    expect(rowValue(panel, 'Name')).toBe('plan.md');
  });

  it('renders a not saved readout when the document path is null and omits the Name row', (): void => {
    // An unsaved document has no filename or on-disk identity yet and communicates this directly.
    const { panel } = mount({ documentPath: null });

    const empty = panel.element.querySelector(
      '.kdoc-metadata-section:nth-of-type(1) .kdoc-metadata-empty',
    );
    // Check if the empty state element was located in the File section.
    if (empty === null) {
      // Empty element absent: fail test.
      expect.fail('Expected .kdoc-metadata-empty element to exist in File section');
    } else {
      // Empty element present: verify text content.
      expect(empty.textContent?.trim()).toBe('Not saved yet.');
    }

    expect(panel.element.querySelector('.kdoc-metadata-row[data-key="Name"]')).toBeNull();
  });

  it('displays "None." for null or empty front matter', (): void => {
    // A present but empty object says exactly as much as an absent one.
    const harness = mount({ frontMatter: null });

    const empty1 = harness.panel.element.querySelector(
      '.kdoc-metadata-section:nth-of-type(2) .kdoc-metadata-empty',
    );
    // Check if empty readout is present for null front matter.
    if (empty1 === null) {
      expect.fail('Expected .kdoc-metadata-empty in Front matter section for null frontMatter');
    } else {
      expect(empty1.textContent?.trim()).toBe('None.');
    }

    harness.frontMatter = {};
    harness.panel.refresh();

    const empty2 = harness.panel.element.querySelector(
      '.kdoc-metadata-section:nth-of-type(2) .kdoc-metadata-empty',
    );
    // Check if empty readout is present for empty object front matter.
    if (empty2 === null) {
      expect.fail('Expected .kdoc-metadata-empty in Front matter section for empty frontMatter');
    } else {
      expect(empty2.textContent?.trim()).toBe('None.');
    }
  });

  it('renders front-matter rows in the object key insertion order without sorting', (): void => {
    // Document authors order front matter deliberately and re-sorting alphabetically would destroy their structure.
    const { panel } = mount({
      frontMatter: { zebra: 1, apple: 2, mango: 3 },
    });

    expect(
      texts(panel.element, '.kdoc-metadata-section:nth-of-type(2) .kdoc-metadata-key'),
    ).toEqual(['zebra', 'apple', 'mango']);
  });

  it('formats front-matter values rather than displaying raw string representations', (): void => {
    // Front-matter values like tag arrays and booleans must be rendered in clean, human-readable form in the row values.
    const { panel } = mount({
      frontMatter: { tags: ['work', 'urgent'], draft: true },
    });

    expect(rowValue(panel, 'tags')).toBe('work, urgent');
    expect(rowValue(panel, 'draft')).toBe('true');
  });

  it('formats all six statistics metrics using thousands separators', (): void => {
    // Digit grouping separators make large metric counts quickly readable at a glance.
    const stats: MetadataStatistics = {
      words: 12431,
      charactersWithSpaces: 70000,
      charactersWithoutSpaces: 59000,
      paragraphs: 42,
      sentences: 611,
      readingMinutes: 62,
    };
    const { panel } = mount({ statistics: stats });

    expect(rowValue(panel, 'Words')).toBe('12,431');
    expect(rowValue(panel, 'Characters')).toBe('70,000');
    expect(rowValue(panel, 'Characters (no spaces)')).toBe('59,000');
    expect(rowValue(panel, 'Sentences')).toBe('611');
    expect(rowValue(panel, 'Paragraphs')).toBe('42');
    expect(rowValue(panel, 'Reading time')).toBe('62 min');
  });

  it('formats reading time across all three boundary representations', (): void => {
    // 0 min would claim the document takes no time to read, which is not what a nearly-empty document means.
    const harness = mount({
      statistics: {
        words: 0,
        charactersWithSpaces: 0,
        charactersWithoutSpaces: 0,
        paragraphs: 0,
        sentences: 0,
        readingMinutes: 0,
      },
    });
    expect(rowValue(harness.panel, 'Reading time')).toBe('Under a minute');

    harness.statistics = {
      words: 150,
      charactersWithSpaces: 800,
      charactersWithoutSpaces: 650,
      paragraphs: 2,
      sentences: 8,
      readingMinutes: 1,
    };
    harness.panel.refresh();
    expect(rowValue(harness.panel, 'Reading time')).toBe('1 min');

    harness.statistics = {
      words: 300,
      charactersWithSpaces: 1600,
      charactersWithoutSpaces: 1300,
      paragraphs: 4,
      sentences: 16,
      readingMinutes: 2,
    };
    harness.panel.refresh();
    expect(rowValue(harness.panel, 'Reading time')).toBe('2 min');
  });

  it('attaches a tooltip title attribute to the Path row value element', (): void => {
    // A long path is ellipsised and the tooltip is the only way to read the rest.
    const fullPath = 'C:/vault/notes/plan.md';
    const { panel } = mount({ documentPath: fullPath });

    const pathValueElement = panel.element.querySelector<HTMLElement>(
      '.kdoc-metadata-row[data-key="Path"] .kdoc-metadata-value',
    );
    // Check if the Path value element was found in the DOM.
    if (pathValueElement === null) {
      // Element missing: fail test.
      expect.fail('Expected .kdoc-metadata-value in Path row to exist');
    } else {
      // Element present: verify title attribute matches the full document path.
      expect(pathValueElement.title).toBe(fullPath);
    }
  });

  it('preserves element identity across a refresh while updating rendered content', (): void => {
    // Retaining element identity allows the hosting sidebar container to preserve DOM attachment and focus.
    const harness = mount({ documentPath: 'C:/vault/notes/first.md' });
    const initialElement = harness.panel.element;
    expect(rowValue(harness.panel, 'Name')).toBe('first.md');

    harness.documentPath = 'C:/vault/notes/second.md';
    harness.panel.refresh();

    expect(harness.panel.element).toBe(initialElement);
    expect(rowValue(harness.panel, 'Name')).toBe('second.md');
  });

  it('handles repeated destroy calls idempotently and clears body children on post-destroy refresh', (): void => {
    // Lifecycle cleanup must be safe against redundant calls and prevent zombie DOM updates after teardown.
    const { panel } = mount();

    expect((): void => {
      panel.destroy();
      panel.destroy();
    }).not.toThrow();

    expect((): void => {
      panel.refresh();
    }).not.toThrow();

    const body = panel.element.querySelector('.kdoc-metadata-body');
    // Check if body element exists in the DOM.
    if (body === null) {
      // Body absent: fail test.
      expect.fail('Expected .kdoc-metadata-body element to exist');
    } else {
      // Body present: verify all child nodes were removed upon destroy.
      expect(body.children.length).toBe(0);
    }
  });

  it('exports stylesheet containing panel and row CSS selectors', (): void => {
    // The application shell injects the panel's stylesheet into the head and requires these selector definitions.
    expect(typeof METADATA_PANEL_STYLES).toBe('string');
    expect(METADATA_PANEL_STYLES.length).toBeGreaterThan(0);
    expect(METADATA_PANEL_STYLES).toContain('.kdoc-metadata-panel');
    expect(METADATA_PANEL_STYLES).toContain('.kdoc-metadata-row');
  });
});
