/**
 * @file file-tree-actions.spec.ts
 * @purpose Exercises the vault file tree command factory (createFileTreeActions) end to end against a mocked VaultFiles facade and shell callbacks, covering create, rename, trash, move, and reveal.
 * @inputs The buildFileTree fixture TREE, a State shape that drives fake prompts and failure injection, and the FileTreeActions contract from file-tree-actions.ts.
 * @outputs Vitest describe/it blocks asserting host calls, shell notifications, messages, and refresh counts for every command path.
 * @functions
 *   - node: Locates a drawn tree node by its relative path within the fixture TREE.
 *   - harness: Builds an isolated State plus FileTreeActions wired to fakes that record every interaction.
 * @dataflow Test → harness() → createFileTreeActions bound to recording fakes → action method → recorded calls/messages/notifications → expect assertions.
 * @controlflow For each test, reset the harness, invoke one action, then assert on the recorded State fields.
 * @version 1
 * @date 2026-09-14
 */

import { describe, it, expect } from 'vitest';
import { buildFileTree, flattenVisible, type TreeNode } from '@k-doc/core';
import { createFileTreeActions, type FileTreeActions } from '../src/shell/file-tree-actions.js';
import type { VaultFiles, VaultTemplate } from '../src/files/vault-files.js';

const TREE = buildFileTree([
  { path: '/v/a.md', relative: 'a.md', title: '' },
  { path: '/v/docs/Untitled.md', relative: 'docs/Untitled.md', title: '' },
  { path: '/v/docs/guide.md', relative: 'docs/guide.md', title: '' },
], ['docs', 'docs/sub']);

/**
 * Locates a drawn tree node by its relative path within the fixture TREE.
 *
 * @purpose Resolves a specific entry from the shared fixture so tests can pass real TreeNode values to actions.
 * @inputs relative - The relative path of the node to find (e.g. 'docs/guide.md').
 * @outputs TreeNode - The matching tree node.
 * @dataflow flattenVisible(TREE) → filter by row.node.relative === relative → returned node or thrown error.
 * @controlflow Flatten the visible tree, search for the relative path, throw when absent, return it when found.
 */
function node(relative: string): TreeNode {
  // Flatten the drawn tree to its visible rows and locate the one matching this relative path.
  const found = flattenVisible(TREE, new Set(['docs', 'docs/sub'])).find((row) => row.node.relative === relative);
  if (found === undefined) {
    // Branch: No node matches; fail loudly so a typo in a test selector surfaces immediately.
    throw new Error(`no ${relative}`);
  } else {
    // Branch: The node exists; return it for the action under test to operate on.
    return found.node;
  }
}

interface State {
  root: string | null;
  answers: (string | null)[];
  asked: { title: string; label: string; initial: string }[];
  confirmAnswer: boolean;
  confirmed: { heading: string; message: string; yes: string }[];
  templates: VaultTemplate[];
  template: VaultTemplate | null;
  templateText: string;
  read: string[];
  calls: string[];
  failCreate: string | null;
  failMove: Map<string, string>;
  messages: string[];
  moved: [string, string][];
  trashed: string[][];
  opened: string[];
  revealed: string[];
  refreshes: number;
}

/**
 * Builds an isolated State plus a FileTreeActions wired to recording fakes.
 *
 * @purpose Provides each test a fresh, fully-mocked environment that captures host calls and shell notifications for assertions.
 * @inputs None; the returned state is mutated by tests to drive prompts and failure injection.
 * @outputs { state: State; actions: FileTreeActions } - The mutable State and the action set under test.
 * @dataflow Fakes close over state → createFileTreeActions binds them → command methods read/write state.calls/messages/etc.
 * @controlflow Construct a fresh State, wire fakes that push into it, build actions, return both for the caller to drive.
 */
function harness(): { state: State; actions: FileTreeActions } {
  const state: State = {
    root: '/v',
    answers: [],
    asked: [],
    confirmAnswer: true,
    confirmed: [],
    templates: [],
    template: null,
    templateText: '',
    read: [],
    calls: [],
    failCreate: null,
    failMove: new Map(),
    messages: [],
    moved: [],
    trashed: [],
    opened: [],
    revealed: [],
    refreshes: 0,
  };
  const files: VaultFiles = {
    available: true,
    listFolders: async () => [],
    createNote: async (_root, path, contents) => {
      state.calls.push(`note ${path} ${JSON.stringify(contents)}`);
      if (state.failCreate !== null) {
        // Branch: The test injected a host failure; surface it so the action reports it.
        throw new Error(state.failCreate);
      } else {
        // Branch: No injection; return the created path as the host would.
        return path;
      }
    },
    createFolder: async (_root, path) => {
      state.calls.push(`folder ${path}`);
      return path;
    },
    move: async (_root, from, to) => {
      state.calls.push(`move ${from} -> ${to}`);
      const failure = state.failMove.get(from);
      if (failure !== undefined) {
        // Branch: The test injected a host failure for this source; surface it.
        throw new Error(failure);
      } else {
        // Branch: No injection; return the destination path as the host would.
        return to;
      }
    },
    trash: async (_root, paths) => {
      state.calls.push(`trash ${paths.join(',')}`);
    },
    listTemplates: async () => state.templates,
  };
  const actions = createFileTreeActions({
    files,
    root: () => state.root,
    tree: () => TREE,
    ask: async (title, label, initial) => {
      state.asked.push({ title, label, initial });
      return state.answers.shift() ?? null;
    },
    confirm: async (heading, message, yes) => {
      state.confirmed.push({ heading, message, yes });
      return state.confirmAnswer;
    },
    pickTemplate: async () => state.template,
    readText: async (path) => {
      state.read.push(path);
      return state.templateText;
    },
    refresh: async () => {
      state.refreshes += 1;
    },
    moved: (from, to) => {
      state.moved.push([from, to]);
    },
    trashed: (paths) => {
      state.trashed.push([...paths]);
    },
    open: (path) => {
      state.opened.push(path);
    },
    reveal: (path) => {
      state.revealed.push(path);
    },
    showMessage: (text) => {
      state.messages.push(text);
    },
  });
  return { state, actions };
}

describe('creating', (): void => {
  it('names a new note after what the folder lacks, then creates, rescans and opens it', async () => {
    const { state, actions } = harness();
    state.answers = ['Plan'];
    await actions.newNote('docs');
    expect(state.asked).toEqual([{ title: 'New note', label: 'Note name', initial: 'Untitled 2' }]);
    expect(state.calls).toEqual(['note /v/docs/Plan.md ""']);
    expect(state.refreshes).toBe(1);
    expect(state.opened).toEqual(['/v/docs/Plan.md']);
  });

  it('keeps an extension that was typed', async () => {
    const { state, actions } = harness();
    state.answers = ['Plan.markdown'];
    await actions.newNote('');
    expect(state.calls).toEqual(['note /v/Plan.markdown ""']);
  });

  it('does nothing when the name is cancelled', async () => {
    const { state, actions } = harness();
    state.answers = [null];
    await actions.newNote('');
    expect(state.calls).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it('refuses an invalid name without asking the host', async () => {
    const { state, actions } = harness();
    state.answers = ['a/b'];
    await actions.newNote('');
    expect(state.calls).toEqual([]);
    expect(state.messages).toEqual(['A name cannot contain \\ / : * ? " < > |']);
  });

  it('reports the host\'s refusal and opens nothing', async () => {
    const { state, actions } = harness();
    state.failCreate = 'already there';
    state.answers = ['a'];
    await actions.newNote('');
    expect(state.messages).toEqual(['already there']);
    expect(state.opened).toEqual([]);
    expect(state.refreshes).toBe(0);
  });

  it('asks for a vault first', async () => {
    const { state, actions } = harness();
    state.root = null;
    await actions.newNote('');
    expect(state.messages).toEqual(['Open a folder first.']);
    expect(state.asked).toEqual([]);
  });

  it('creates a folder', async () => {
    const { state, actions } = harness();
    state.answers = ['Archive'];
    await actions.newFolder('');
    expect(state.asked[0]?.initial).toBe('New folder');
    expect(state.calls).toEqual(['folder /v/Archive']);
    expect(state.refreshes).toBe(1);
    expect(state.opened).toEqual([]);
  });

  it('says how to add a template when there are none', async () => {
    const { state, actions } = harness();
    await actions.newFromTemplate('docs');
    expect(state.messages).toEqual(['No templates yet. Add Markdown files to .k-doc/templates in the vault.']);
    expect(state.asked).toEqual([]);
  });

  it('creates a note from the chosen template\'s text', async () => {
    const { state, actions } = harness();
    const meeting = { name: 'Meeting', path: '/v/.k-doc/templates/Meeting.md' };
    state.templates = [meeting];
    state.template = meeting;
    state.templateText = '# Meeting\n';
    state.answers = ['Standup'];
    await actions.newFromTemplate('docs');
    expect(state.asked[0]).toEqual({ title: 'New note from template', label: 'Note name', initial: 'Meeting' });
    expect(state.read).toEqual(['/v/.k-doc/templates/Meeting.md']);
    expect(state.calls).toEqual(['note /v/docs/Standup.md "# Meeting\\n"']);
    expect(state.opened).toEqual(['/v/docs/Standup.md']);
  });

  it('stops when the template picker is dismissed', async () => {
    const { state, actions } = harness();
    state.templates = [{ name: 'Meeting', path: '/t.md' }];
    state.template = null;
    await actions.newFromTemplate('');
    expect(state.asked).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});

describe('renaming', (): void => {
  it('offers a note\'s name without .md and keeps the extension', async () => {
    const { state, actions } = harness();
    state.answers = ['Guide'];
    await actions.rename(node('docs/guide.md'));
    expect(state.asked).toEqual([{ title: 'Rename', label: 'New name', initial: 'guide' }]);
    expect(state.calls).toEqual(['move /v/docs/guide.md -> /v/docs/Guide.md']);
    expect(state.moved).toEqual([['/v/docs/guide.md', '/v/docs/Guide.md']]);
    expect(state.refreshes).toBe(1);
  });

  it('does nothing when the name is unchanged', async () => {
    const { state, actions } = harness();
    state.answers = ['guide'];
    await actions.rename(node('docs/guide.md'));
    expect(state.calls).toEqual([]);
  });

  it('renames a folder by its full name', async () => {
    const { state, actions } = harness();
    state.answers = ['Subjects'];
    await actions.rename(node('docs/sub'));
    expect(state.asked[0]?.initial).toBe('sub');
    expect(state.calls).toEqual(['move /v/docs/sub -> /v/docs/Subjects']);
  });

  it('reports a failed rename and moves no tab', async () => {
    const { state, actions } = harness();
    state.failMove.set('/v/a.md', 'locked');
    state.answers = ['b'];
    await actions.rename(node('a.md'));
    expect(state.messages).toEqual(['locked']);
    expect(state.moved).toEqual([]);
  });
});

describe('deleting', (): void => {
  it('names a single item, then trashes only the outermost paths', async () => {
    const { state, actions } = harness();
    state.confirmAnswer = true;
    await actions.trash([node('docs'), node('docs/guide.md')]);
    expect(state.confirmed).toEqual([{ heading: 'Delete', message: 'Move "docs" to the Recycle Bin? If it is open, its tab closes.', yes: 'Move to Recycle Bin' }]);
    expect(state.calls).toEqual(['trash /v/docs']);
    expect(state.trashed).toEqual([['/v/docs']]);
    expect(state.refreshes).toBe(1);
  });

  it('counts several items', async () => {
    const { state, actions } = harness();
    await actions.trash([node('a.md'), node('docs/guide.md')]);
    expect(state.confirmed[0]?.message).toBe('Move 2 items to the Recycle Bin? Tabs open on them close.');
    expect(state.calls).toEqual(['trash /v/a.md,/v/docs/guide.md']);
  });

  it('trashes nothing when declined', async () => {
    const { state, actions } = harness();
    state.confirmAnswer = false;
    await actions.trash([node('a.md')]);
    expect(state.calls).toEqual([]);
    expect(state.trashed).toEqual([]);
  });

  it('asks nothing with nothing selected', async () => {
    const { state, actions } = harness();
    await actions.trash([]);
    expect(state.confirmed).toEqual([]);
  });
});

describe('moving', (): void => {
  it('moves each item into the folder', async () => {
    const { state, actions } = harness();
    await actions.move([node('a.md'), node('docs/guide.md')], 'docs/sub');
    expect(state.calls).toEqual(['move /v/a.md -> /v/docs/sub/a.md', 'move /v/docs/guide.md -> /v/docs/sub/guide.md']);
    expect(state.moved.length).toBe(2);
    expect(state.refreshes).toBe(1);
  });

  it('refuses a folder into itself and still moves the rest', async () => {
    const { state, actions } = harness();
    await actions.move([node('docs/guide.md'), node('docs'), node('a.md')], 'docs');
    expect(state.calls).toEqual(['move /v/a.md -> /v/docs/a.md']);
    expect(state.messages).toEqual(['Cannot move "docs" into itself.']);
    expect(state.refreshes).toBe(1);
  });

  it('rescans nothing when nothing changed folder', async () => {
    const { state, actions } = harness();
    await actions.move([node('docs/guide.md')], 'docs');
    expect(state.calls).toEqual([]);
    expect(state.refreshes).toBe(0);
    expect(state.messages).toEqual([]);
  });

  it('carries on past a failed move and reports it', async () => {
    const { state, actions } = harness();
    state.failMove.set('/v/a.md', 'locked');
    await actions.move([node('a.md'), node('docs/guide.md')], 'docs/sub');
    expect(state.calls.length).toBe(2);
    expect(state.moved).toEqual([['/v/docs/guide.md', '/v/docs/sub/guide.md']]);
    expect(state.messages).toEqual(['locked']);
    expect(state.refreshes).toBe(1);
  });

  it('reveals a folder by its absolute path', () => {
    const { state, actions } = harness();
    actions.reveal(node('docs'));
    expect(state.revealed).toEqual(['/v/docs']);
  });
});
