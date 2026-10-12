/**
 * @file licence-overrides.test.mjs
 * @purpose Verifies that third-party license overrides are applied correctly and that
 *   the licence-overrides folder is internally consistent (every used folder has a source
 *   record, a licence file, and nothing on disk goes unused).
 * @inputs Components with optional texts; an override Map of name -> upstream texts.
 * @outputs Test assertions against applyOverrides / groupByText / renderNotices helpers.
 * @functions
 *   - applyOverrides: Apply upstream license text to components lacking their own licence.
 *   - groupByText: Group overridden components by their (possibly copied) licence text.
 *   - isLicenceFileName: Predicate matching a folder's licence file name.
 *   - renderNotices: Render per-component notice lines, flagging copied licences.
 * @dataflow Component array + override Map -> applyOverrides result -> groupByText -> renderNotices -> strings.
 * @controlflow Import helpers and locate the base folder; run unit assertions on each helper; then validate the manifest-backed folder layout.
 * @version 1
 * @date 2026-10-07
 */

// @ts-check
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOverrides, groupByText, isLicenceFileName, renderNotices } from './third-party-notices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, 'licence-overrides');

describe('applyOverrides', () => {
  it('keeps a licence the package ships', () => {
    const own = { name: 'a', version: '1.0.0', license: 'MIT', source: 'npm', texts: ['own'] };
    const r = applyOverrides([own], new Map([['a', ['upstream']]]));
    expect(r.components[0]).toBe(own); // existing licence wins, object identity preserved
    expect(r.used).toEqual([]);        // no override consumed for this component
    expect(r.missing).toEqual([]);     // package supplied its own text so nothing is missing
  });

  it('fills in a missing licence from upstream', () => {
    const c = { name: 'webview2-com', version: '0.38.2', license: 'MIT', source: 'crate', texts: [] };
    const r = applyOverrides([c], new Map([['webview2-com', ['MIT text']]]));
    expect(r.components[0].texts).toEqual(['MIT text']); // upstream text injected into the component
    expect(r.components[0].fromOverride).toBe(true);     // flagged as copied from upstream source
    expect(c.texts).toEqual([]);                         // input object is not mutated in place
    expect(r.used).toEqual(['webview2-com']);            // this override name was consumed once
    expect(r.missing).toEqual([]);                       // nothing left unprovided after the fill
  });

  it('reports what is still missing', () => {
    const r = applyOverrides([
      { name: 'x', version: '2.0.0', license: 'MIT', source: 'npm', texts: [] },
      { name: 'dict', version: '', license: 'see licence text', source: 'dictionary', texts: [] }
    ], new Map());
    expect(r.missing).toEqual(['x 2.0.0', 'dict']); // missing entries use "name version" or bare name when empty
  });

  it('marks copied licences in the listing', () => {
    const out = renderNotices(groupByText(applyOverrides([
      { name: 'hash.js', version: '1.1.7', license: 'MIT', source: 'npm', texts: [] }
    ], new Map([['hash.js', ['MIT text']]])).components));
    expect(out).toContain('hash.js 1.1.7 [npm] MIT -- text 1 (licence copied from upstream)'); // override suffix appended to line
  });
});

describe('the licence-overrides folder', () => {
  const manifest = JSON.parse(readFileSync(join(base, 'sources.json'), 'utf8')); // declared sources per package folder
  const folders = new Set(Object.values(manifest.packages));                     // every folder the tool references

  it('records a source for every folder it uses', () => {
    for (const folder of folders) {
      expect(manifest.sources[folder], folder).toBeDefined();       // each used folder has a sources entry
      expect(manifest.sources[folder].length, folder).toBeGreaterThan(0); // and at least one source line
    }
  });

  it('holds a licence file in every folder it names', () => {
    for (const folder of folders) {
      expect(existsSync(join(base, folder)), folder).toBe(true);   // the named folder exists on disk
      const files = readdirSync(join(base, folder)).filter((n) => isLicenceFileName(n));
      expect(files.length, folder).toBeGreaterThan(0);             // and contains at least one licence file
    }
  });

  it('has no folder that nothing uses', () => {
    const onDisk = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(onDisk).toEqual([...folders].sort()); // every directory is referenced by the manifest packages
  });
});
