// @ts-check
/**
 * @file third-party-notices.test.mjs
 * @purpose Vitest spec covering the pure exports of scripts/third-party-notices.mjs.
 * @inputs The module-under-test (./third-party-notices.mjs) and hand-built fixture data.
 * @outputs Test cases asserting licence-name detection, package.json parsing, text normalisation,
 *          crate-graph traversal, component grouping, and rendered notice output.
 * @functions None exported; only Vitest describe/it blocks execute on import.
 * @dataflow Fixture metadata/components → shippedCrateIds / groupByText / renderNotices → expect assertions.
 * @controlflow Each `it` runs independently; no shared mutable state between tests.
 * @version 1
 * @date 2026-10-07
 */

import { describe, expect, it } from 'vitest';
import {
  groupByText,
  isLicenceFileName,
  licenceOfPackageJson,
  normaliseText,
  renderNotices,
  shippedCrateIds,
} from './third-party-notices.mjs';

describe('isLicenceFileName', () => {
  // Every recognised license/copying filename must be accepted.
  it.each([
    'LICENSE',
    'license',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENSE-MIT',
    'LICENSE-APACHE',
    'LICENCE',
    'COPYING',
    'UNLICENSE',
    'LICENSE_APACHE-2.0',
    'NOTICE',
  ])('accepts %s', (name) => {
    expect(isLicenceFileName(name)).toBe(true);
  });

  // Non-license filenames must be rejected.
  it.each(['license.js', 'README.md', 'licenses.json', 'package.json', 'src'])(
    'rejects %s',
    (name) => {
      expect(isLicenceFileName(name)).toBe(false);
    }
  );
});

describe('licenceOfPackageJson', () => {
  it('extracts the licence from several shapes', () => {
    expect(licenceOfPackageJson({ license: 'MIT' })).toBe('MIT');
    expect(licenceOfPackageJson({ license: { type: 'ISC' } })).toBe('ISC');
    expect(licenceOfPackageJson({ licenses: [{ type: 'MIT' }, 'Apache-2.0'] })).toBe(
      'MIT OR Apache-2.0'
    );
    expect(licenceOfPackageJson({})).toBe('UNKNOWN');
    expect(licenceOfPackageJson({ license: '' })).toBe('UNKNOWN');
    expect(licenceOfPackageJson({ licenses: [] })).toBe('UNKNOWN');
  });
});

describe('normaliseText', () => {
  it('collapses whitespace runs to single newlines and trims the ends', () => {
    expect(normaliseText('\r\nMIT  \r\nText\t\r\n\r\n')).toBe('MIT\nText');
  });
});

describe('shippedCrateIds', () => {
  it('follows only normal dependencies', () => {
    const metadata = {
      packages: [
        { id: 'root', name: 'k-doc' },
        { id: 'a', name: 'a' },
        { id: 'b', name: 'b' },
        { id: 'build', name: 'tauri-build' },
        { id: 'devdep', name: 'd' },
        { id: 'c', name: 'c' },
      ],
      resolve: {
        nodes: [
          {
            id: 'root',
            deps: [
              { pkg: 'a', dep_kinds: [{ kind: null }] },
              { pkg: 'build', dep_kinds: [{ kind: 'build' }] },
              { pkg: 'devdep', dep_kinds: [{ kind: 'dev' }] },
            ],
          },
          { id: 'a', deps: [{ pkg: 'b', dep_kinds: [{ kind: null }, { kind: 'build' }] }] },
          { id: 'b', deps: [{ pkg: 'a', dep_kinds: [{ kind: null }] }] },
          { id: 'build', deps: [{ pkg: 'c', dep_kinds: [{ kind: null }] }] },
        ],
      },
    };

    // BFS from k-doc (id 'root'): only the normal dep 'a' is followed;
    // build/dev kinds and their subtrees are excluded. The a<->b cycle terminates.
    expect(shippedCrateIds(metadata, 'k-doc')).toEqual(['a', 'b']);
  });

  it('names a missing root crate', () => {
    expect(() => shippedCrateIds({ packages: [], resolve: { nodes: [] } }, 'k-doc')).toThrow(
      'k-doc'
    );
  });
});

describe('groupByText', () => {
  it('groups identical normalised texts and sorts components by source then name', () => {
    const components = [
      { name: 'zeta', version: '1.0.0', license: 'MIT', source: 'npm', texts: ['MIT text\r\n'] },
      { name: 'alpha', version: '2.0.0', license: 'MIT', source: 'npm', texts: ['MIT text'] },
      {
        name: 'serde',
        version: '1.0.0',
        license: 'MIT OR Apache-2.0',
        source: 'crate',
        texts: ['Apache text', 'MIT text', '  '],
      },
      { name: 'lonely', version: '0.1.0', license: 'BSD', source: 'npm', texts: [] },
    ];

    const g = groupByText(components);

    // The empty normalised text is skipped; the two distinct texts each get one id.
    expect(g.texts.length).toBe(2);

    // Components sorted by source ('crate' < 'npm'), then name, then version.
    expect(g.components.map((c) => c.name)).toEqual(['serde', 'alpha', 'lonely', 'zeta']);

    // The shared MIT text is used by all three components that carry it.
    const mit = g.texts.find((t) => t.text === 'MIT text');
    expect(mit.usedBy).toHaveLength(3);
    expect(mit.usedBy).toContain('serde 1.0.0');
    expect(mit.usedBy).toContain('alpha 2.0.0');
    expect(mit.usedBy).toContain('zeta 1.0.0');

    // serde references two distinct texts (the empty one is dropped, MIT counted once).
    const serde = g.components.find((c) => c.name === 'serde');
    expect(serde.textIds.length).toBe(2);
  });
});

describe('renderNotices', () => {
  it('renders a readable notices file', () => {
    const components = [
      { name: 'zeta', version: '1.0.0', license: 'MIT', source: 'npm', texts: ['MIT text\r\n'] },
      { name: 'alpha', version: '2.0.0', license: 'MIT', source: 'npm', texts: ['MIT text'] },
      {
        name: 'serde',
        version: '1.0.0',
        license: 'MIT OR Apache-2.0',
        source: 'crate',
        texts: ['Apache text', 'MIT text', '  '],
      },
      { name: 'lonely', version: '0.1.0', license: 'BSD', source: 'npm', texts: [] },
    ];

    const out = renderNotices(groupByText(components));

    expect(out.startsWith('K-Doc third-party notices\n')).toBe(true);
    expect(out).toContain('Components (4)');
    // A component with no shipped licence text gets the dedicated marker.
    expect(out).toContain('lonely 0.1.0 [npm] BSD -- no licence file shipped');
    expect(out).toContain('Licence text 1');
    expect(out).toContain('Licence text 2');

    // The shared MIT text appears exactly once in the whole document (deduplicated by id).
    expect(out.split('MIT text').length - 1).toBe(1);

    // Exactly one trailing newline, never two.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});
