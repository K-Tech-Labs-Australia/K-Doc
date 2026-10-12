// @vitest-environment jsdom
/**
 * @file menu-bar.spec.ts
 * @purpose Unit tests for the pure translation and builder functions of the native menu bar (FR-14.8): toAccelerator, buildMenuSpec, and the unavailable-path lifecycle of installMenuBar.
 * @inputs Hand-built KdocCommand stand-ins (see cmd()), a jsdom Window with no Tauri runtime, and Vitest assertions.
 * @outputs Boolean pass/fail for each pure-function contract; no side effects on any real registry or IPC channel.
 * @functions
 *   - cmd: Builds a minimal KdocCommand object so tests exercise translation rather than the ProseMirror-backed registry.
 *   - toAccelerator suite: Verifies modifier mapping, single-char uppercasing, named-key passthrough, and totality on unknown parts.
 *   - buildMenuSpec suite: Verifies category grouping/order, empty-category omission, Find→Search labeling, prefix separators, enabled flags, and empty input.
 *   - installMenuBar outside Tauri suite: Verifies availability is false, refresh() no-ops without calling commands(), and destroy() is idempotent.
 * @dataflow cmd() -> buildMenuSpec/toAccelerator -> MenuSubmenuSpec[]/string -> expect assertions; jsdom window -> installMenuBar -> MenuBar controller -> expect lifecycle behavior.
 * @controlflow Describe blocks group pure functions; each it() builds inputs, invokes one function, and asserts the output; installMenuBar is only driven through its unavailable branch.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { toAccelerator, buildMenuSpec, installMenuBar, type MenuSubmenuSpec } from '../src/shell/menu-bar.js';
import type { KdocCommand } from '../src/shell/command-registry.js';

// Hand-built commands are used rather than the real command registry because these tests are about the
// translation (toAccelerator) and grouping (buildMenuSpec). Constructing a real registry would drag in
// ProseMirror for no benefit, so each cmd() call returns a plain object implementing just the surface
// buildMenuSpec reads: id, label, category, shortcut, run(), and isEnabled().
function cmd(id: string, label: string, category: KdocCommand['category'], shortcut: string, enabled = true): KdocCommand {
  // @purpose Builds a minimal KdocCommand stand-in so tests exercise translation and grouping without a real registry.
  // @inputs id - Command identifier (the portion before ':' drives separator insertion).
  //   label - Display text shown in the menu item.
  //   category - The command's category, which selects its submenu.
  //   shortcut - Human-readable accelerator string passed through toAccelerator.
  //   enabled - Whether the resulting command reports itself as enabled (default true).
  // @outputs KdocCommand - A plain object implementing id, label, category, shortcut, run(), and isEnabled().
  // @dataflow Parameters -> plain object literal -> KdocCommand consumed by buildMenuSpec/toAccelerator.
  // @controlflow No branching; constructs and returns the command object directly.
  return {
    id,
    label,
    category,
    shortcut,
    run: () => true,
    isEnabled: () => enabled,
  };
}

// installMenuBar is only exercised for its unavailable path here. Outside Tauri it registers nothing and every
// lifecycle method no-ops; faking __TAURI_INTERNALS__ onto the window would flip available to true, which would
// then make invoke() fail for a different reason (a missing mock) and measure the mock rather than the real code
// path. The jsdom environment provides no such global, so isTauri(win) returns false.

describe('toAccelerator', () => {
  it("translates an empty shortcut to an empty string", () => {
    expect(toAccelerator('')).toBe('');
  });

  it('maps Ctrl to CmdOrCtrl for cross-platform correctness', () => {
    // CmdOrCtrl is what makes the same accelerator correct on macOS; K-Doc ships Windows-only today but
    // the translation costs nothing and removes a future trap.
    expect(toAccelerator('Ctrl+B')).toBe('CmdOrCtrl+B');
  });

  it('maps Ctrl together with Shift', () => {
    expect(toAccelerator('Ctrl+Shift+X')).toBe('CmdOrCtrl+Shift+X');
  });

  it('maps Ctrl together with Alt and a digit', () => {
    expect(toAccelerator('Ctrl+Alt+1')).toBe('CmdOrCtrl+Alt+1');
  });

  it('passes a named key through unchanged', () => {
    // 'Up' is a named key rather than a modifier or single character, so it passes through as-is.
    expect(toAccelerator('Alt+Up')).toBe('Alt+Up');
  });

  it('uppercases a lone lowercase primary key', () => {
    expect(toAccelerator('Ctrl+s')).toBe('CmdOrCtrl+S');
  });

  it('passes an unrecognised part through rather than throwing', () => {
    // The function is total on purpose: an accelerator Tauri cannot parse fails the menu build in Rust with
    // an error naming the item, which is a better failure than an exception here.
    expect(toAccelerator('Ctrl+F13')).toBe('CmdOrCtrl+F13');
  });
});

describe('buildMenuSpec', () => {
  it('groups commands by category in File, Edit, Format, Insert, Table, View, Search order', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([
      cmd('view:zoom', 'Zoom', 'View', 'Ctrl+Z'),
      cmd('file:new', 'New', 'File', 'Ctrl+N'),
      cmd('edit:copy', 'Copy', 'Edit', 'Ctrl+C'),
      cmd('insert:table', 'Insert Table', 'Insert', 'Ctrl+T'),
      cmd('format:bold', 'Bold', 'Format', 'Ctrl+B'),
      cmd('table:convert', 'Convert', 'Table', 'Ctrl+G'),
      cmd('find:search', 'Find', 'Find', 'Ctrl+F'),
    ]);

    const labels = spec.map((submenu): string => submenu.label);
    expect(labels).toEqual(['File', 'Edit', 'Format', 'Insert', 'Table', 'View', 'Search']);
  });

  it('produces no submenu for a category with no commands', () => {
    // This follows the same rule the ribbon and settings dialog already use.
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([
      cmd('file:new', 'New', 'File', 'Ctrl+N'),
      cmd('file:open', 'Open', 'File', 'Ctrl+O'),
    ]);

    expect(spec.length).toBe(1);
    expect(spec[0]?.label).toBe('File');
  });

  it('labels the Find category as Search', () => {
    // "Find" names one command and reads oddly as a menu title.
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([cmd('find:search', 'Search', 'Find', 'Ctrl+F')]);
    expect(spec[0]?.label).toBe('Search');
  });

  it('keeps registry order within a submenu', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([
      cmd('file:open', 'Open', 'File', 'Ctrl+O'),
      cmd('file:new', 'New', 'File', 'Ctrl+N'),
      cmd('file:save', 'Save', 'File', 'Ctrl+S'),
    ]);

    const items = spec[0]?.items ?? [];
    expect(items.map((item): string => item.label)).toEqual(['Open', 'New', 'Save']);
  });

  it('carries the translated accelerator on each item', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([cmd('format:bold', 'Bold', 'Format', 'Ctrl+B')]);
    expect(spec[0]?.items[0]?.accelerator).toBe('CmdOrCtrl+B');
  });

  it('reflects isEnabled() in the enabled flag', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([
      cmd('file:new', 'New', 'File', 'Ctrl+N', true),
      cmd('file:close', 'Close', 'File', 'Ctrl+W', false),
    ]);

    const items = spec[0]?.items ?? [];
    expect(items[0]?.enabled).toBe(true);
    expect(items[1]?.enabled).toBe(false);
  });

  it('inserts a separator when the id prefix changes within a submenu', () => {
    // Groups related entries without needing a second layout table to maintain.
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([
      cmd('view:a', 'A', 'View', ''),
      cmd('view:b', 'B', 'View', ''),
      cmd('find:c', 'C', 'View', ''),
    ]);

    const items = spec[0]?.items ?? [];
    expect(items.map((item): boolean => item.separator)).toEqual([false, false, true, false]);
  });

  it('does not insert a separator before the first item', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([cmd('view:a', 'A', 'View', '')]);
    expect(spec[0]?.items[0]?.separator).toBe(false);
  });

  it('produces an empty spec for an empty command list', () => {
    const spec: readonly MenuSubmenuSpec[] = buildMenuSpec([]);
    expect(spec.length).toBe(0);
    expect(spec).toEqual([]);
  });
});

describe('installMenuBar outside Tauri', () => {
  // The jsdom environment provides no __TAURI_INTERNALS__ global, so isTauri(win) returns false and
  // installMenuBar takes its unavailable branch.
  it('reports available as false in jsdom', () => {
    const menuBar = installMenuBar({
      win: window,
      commands: (): readonly KdocCommand[] => [],
      onError: (): void => {},
    });

    expect(menuBar.available).toBe(false);
  });

  it('refresh() does not throw and does not call commands()', () => {
    let commandCalls = 0;
    const menuBar = installMenuBar({
      win: window,
      commands: (): readonly KdocCommand[] => {
        commandCalls += 1;
        return [];
      },
      onError: (): void => {},
    });

    expect(menuBar.available).toBe(false);

    // A browser build has no native menu bar to install, which is absence rather than failure.
    expect(() => menuBar.refresh()).not.toThrow();
    expect(commandCalls).toBe(0);
  });

  it('destroy() twice does not throw', () => {
    const menuBar = installMenuBar({
      win: window,
      commands: (): readonly KdocCommand[] => [],
      onError: (): void => {},
    });

    expect(() => menuBar.destroy()).not.toThrow();
    expect(() => menuBar.destroy()).not.toThrow();
  });
});
