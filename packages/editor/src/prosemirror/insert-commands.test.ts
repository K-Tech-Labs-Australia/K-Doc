/**
 * @file insert-commands.test.ts
 * @purpose Vitest test suite for the K-Doc view's insert commands and query predicates (insert-commands.ts, FR-8.14, FR-8.8).
 *   Verifies image insertion, replacement, query predicates, empty/whitespace validation, and code block language updates with meta preservation.
 * @inputs ProseMirror EditorState instances initialized with kdocSchema, ImageAttrs payloads, and language strings.
 * @outputs Vitest assertions verifying command applicability, transaction effects, AST modifications, and attribute queries.
 * @functions
 *   - createTestDoc: Helper creating a ProseMirror document containing a paragraph with optional text.
 *   - createTestState: Helper creating an EditorState with kdocSchema and the given document node.
 * @dataflow Document nodes / ImageAttrs / language strings -> insertImage / imageAt / canInsertImage / setCodeBlockLanguage / codeBlockLanguageAt -> EditorState transactions -> Vitest expect assertions.
 * @controlflow Test image source validation -> test image insertion and null attribute normalization -> test image replacement under NodeSelection -> test imageAt queries -> test canInsertImage capability -> test setCodeBlockLanguage guard -> test language updates and meta preservation -> test empty language normalization to null -> test codeBlockLanguageAt queries.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  insertImage,
  imageAt,
  canInsertImage,
  setCodeBlockLanguage,
  codeBlockLanguageAt,
} from './insert-commands.js';

let activeStates: EditorState[] = [];

afterEach((): void => {
  for (let i = 0; i < activeStates.length; i++) {
    const state = activeStates[i];
    // Check if editor state is defined under strict indexing.
    if (state !== undefined) {
      // Teardown active state reference.
    } else {
      // Undefined state reference.
    }
  }
  activeStates = [];
});

/**
 * Creates a standard ProseMirror test document node containing a single paragraph.
 *
 * @purpose Constructs a valid ProseMirror document tree for testing editor commands and queries.
 * @inputs text: string - Text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The root doc node.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Wrap text in paragraph if non-empty; otherwise create empty paragraph -> return doc.
 */
function createTestDoc(text: string): ProseMirrorNode {
  // Check if the provided text string is non-empty.
  if (text.length === 0) {
    // Empty text string: construct paragraph with no child nodes.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, []),
    ]);
  } else {
    // Non-empty text string: construct paragraph containing text leaf.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
    ]);
  }
}

/**
 * Creates an EditorState initialized with kdocSchema and the provided ProseMirror document node.
 *
 * @purpose Helper to build a real EditorState over kdocSchema for command and predicate testing.
 * @inputs doc: ProseMirrorNode - The root document node to populate the editor state.
 * @outputs EditorState - The configured ProseMirror EditorState instance.
 * @dataflow doc -> EditorState.create -> configured editor state.
 * @controlflow Pass doc and kdocSchema to EditorState.create -> record in activeStates -> return state.
 */
function createTestState(doc: ProseMirrorNode): EditorState {
  const state = EditorState.create({
    doc,
    schema: kdocSchema,
  });
  activeStates.push(state);
  return state;
}

describe('insert-commands', () => {
  it('returns false and dispatches nothing when src is empty or whitespace-only', () => {
    // Pins that insertImage returns false and dispatches nothing when src is empty or whitespace-only.
    // An image with no source renders as a broken icon and is never what the user meant.
    const doc = createTestDoc('sample text');
    const state = createTestState(doc);

    let dispatchedEmpty = false;
    const cmdEmpty = insertImage({ src: '', alt: 'alt', title: 'title' });
    const resultEmpty = cmdEmpty(state, (): void => {
      dispatchedEmpty = true;
    });
    expect(resultEmpty).toBe(false);
    expect(dispatchedEmpty).toBe(false);

    let dispatchedWhitespace = false;
    const cmdWhitespace = insertImage({
      src: '   \t\n  ',
      alt: 'alt',
      title: 'title',
    });
    const resultWhitespace = cmdWhitespace(state, (): void => {
      dispatchedWhitespace = true;
    });
    expect(resultWhitespace).toBe(false);
    expect(dispatchedWhitespace).toBe(false);
  });

  it('inserts an image node with the given src and stores empty alt and title as null', () => {
    // Pins that insertImage inserts an image node with given src and normalizes empty alt and title strings to null.
    // mdast distinguishes an absent title from an empty one.
    const doc = createTestDoc('hello');
    const state = createTestState(doc);
    let nextState = state;
    const cmd = insertImage({
      src: 'https://example.com/photo.png',
      alt: '',
      title: '',
    });
    const applied = cmd(state, (tr): void => {
      nextState = state.apply(tr);
    });
    expect(applied).toBe(true);

    let insertedImage: ProseMirrorNode | null = null;
    nextState.doc.descendants((node: ProseMirrorNode): boolean => {
      // Check if node is an image node.
      if (node.type.name === 'image') {
        insertedImage = node;
        return false;
      } else {
        // Continue traversing descendants.
        return true;
      }
    });

    // Check if inserted image node was found in the document.
    if (insertedImage !== null) {
      const imageNode = insertedImage as ProseMirrorNode;
      expect(imageNode.attrs.src).toBe('https://example.com/photo.png');
      expect(imageNode.attrs.alt).toBeNull();
      expect(imageNode.attrs.title).toBeNull();
    } else {
      expect.fail('Expected image node to be present in document');
    }
  });

  it('replaces an existing image rather than inserting beside it when NodeSelection is active', () => {
    // Pins that insertImage replaces an existing image node in place when an image NodeSelection is active.
    const initialImage = kdocSchema.node('image', {
      src: 'original.png',
      alt: 'initial alt',
      title: 'initial title',
    });
    const doc = kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [initialImage]),
    ]);
    let state = createTestState(doc);
    // Position 1 sits immediately before the image node inside the first paragraph.
    const nodeSel = NodeSelection.create(state.doc, 1);
    state = state.apply(state.tr.setSelection(nodeSel));

    let nextState = state;
    const cmd = insertImage({
      src: 'replacement.png',
      alt: 'new alt',
      title: 'new title',
    });
    const applied = cmd(state, (tr): void => {
      nextState = state.apply(tr);
    });
    expect(applied).toBe(true);

    let imageCount = 0;
    let finalSrc = '';
    let finalAlt: unknown = undefined;
    let finalTitle: unknown = undefined;

    nextState.doc.descendants((node: ProseMirrorNode): void => {
      // Check if node is an image node.
      if (node.type.name === 'image') {
        imageCount++;
        finalSrc = typeof node.attrs.src === 'string' ? node.attrs.src : '';
        finalAlt = node.attrs.alt;
        finalTitle = node.attrs.title;
      } else {
        // Non-image node encountered.
      }
    });

    expect(imageCount).toBe(1);
    expect(finalSrc).toBe('replacement.png');
    expect(finalAlt).toBe('new alt');
    expect(finalTitle).toBe('new title');
  });

  it('resolves image attrs at selection, node before caret, and returns null in empty paragraph', () => {
    // Pins that imageAt returns attrs for selected image or caret-preceding image, returning null in empty paragraph.
    // The node-before case is what makes "insert, then immediately edit" work without reselecting.
    const imageNode = kdocSchema.node('image', {
      src: 'banner.png',
      alt: 'banner text',
      title: 'banner title',
    });
    const doc = kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [imageNode]),
    ]);
    const state = createTestState(doc);

    // Case 1: NodeSelection on image.
    const stateSelected = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, 1)),
    );
    const attrsSelected = imageAt(stateSelected);
    expect(attrsSelected).toEqual({
      src: 'banner.png',
      alt: 'banner text',
      title: 'banner title',
    });

    // Case 2: Caret immediately following the image atom (position 2).
    // The node-before case is what makes "insert, then immediately edit" work without reselecting.
    const stateAfterImage = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    const attrsAfter = imageAt(stateAfterImage);
    expect(attrsAfter).toEqual({
      src: 'banner.png',
      alt: 'banner text',
      title: 'banner title',
    });

    // Case 3: Empty paragraph with caret inside.
    const emptyDoc = kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, []),
    ]);
    const emptyState = createTestState(emptyDoc);
    const attrsEmpty = imageAt(emptyState);
    expect(attrsEmpty).toBeNull();
  });

  it('reports canInsertImage true in paragraph and false inside codeBlock', () => {
    // Pins that canInsertImage returns true in a paragraph and false inside a code block.
    const paraDoc = kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text('body text')]),
    ]);
    const paraState = createTestState(paraDoc);
    expect(canInsertImage(paraState)).toBe(true);

    const codeDoc = kdocSchema.node('doc', null, [
      kdocSchema.node('codeBlock', { language: null, meta: null }, [
        kdocSchema.text('const a = 1;'),
      ]),
    ]);
    let codeState = createTestState(codeDoc);
    // Caret positioned at position 2 inside the code block text content.
    codeState = codeState.apply(
      codeState.tr.setSelection(TextSelection.create(codeState.doc, 2)),
    );
    expect(canInsertImage(codeState)).toBe(false);
  });

  it('returns false when setCodeBlockLanguage is called outside a code block', () => {
    // Pins that setCodeBlockLanguage returns false and dispatches nothing when caret is not in a code block.
    const doc = createTestDoc('plain text paragraph');
    const state = createTestState(doc);
    let dispatched = false;
    const cmd = setCodeBlockLanguage('rust');
    const result = cmd(state, (): void => {
      dispatched = true;
    });
    expect(result).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('sets language on enclosing code block and preserves existing meta attribute', () => {
    // Pins that setCodeBlockLanguage updates language on the enclosing code block while preserving existing meta attribute.
    const initialBlock = kdocSchema.node(
      'codeBlock',
      { language: 'python', meta: 'highlight={2,4}' },
      [kdocSchema.text('print("hello")')],
    );
    const doc = kdocSchema.node('doc', null, [initialBlock]);
    let state = createTestState(doc);
    // Position caret inside code block text content at position 2.
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );

    let nextState = state;
    const cmd = setCodeBlockLanguage('rust');
    const applied = cmd(state, (tr): void => {
      nextState = state.apply(tr);
    });
    expect(applied).toBe(true);

    const modifiedBlock = nextState.doc.child(0);
    expect(modifiedBlock.type.name).toBe('codeBlock');
    expect(modifiedBlock.attrs.language).toBe('rust');
    expect(modifiedBlock.attrs.meta).toBe('highlight={2,4}');
  });

  it('normalizes empty and whitespace language info strings to null', () => {
    // Pins that setCodeBlockLanguage stores null for empty and whitespace-only language strings.
    // A fence with an empty info string and one with none are the same thing, so keeping one representation stops the serializer's output depending on which path set it.
    const initialBlock = kdocSchema.node(
      'codeBlock',
      { language: 'python', meta: null },
      [kdocSchema.text('let z = 100;')],
    );
    const doc = kdocSchema.node('doc', null, [initialBlock]);
    let state = createTestState(doc);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );

    // Test empty string:
    // A fence with an empty info string and one with none are the same thing, so keeping one representation stops the serializer's output depending on which path set it.
    let stateEmpty = state;
    const cmdEmpty = setCodeBlockLanguage('');
    const appliedEmpty = cmdEmpty(state, (tr): void => {
      stateEmpty = state.apply(tr);
    });
    expect(appliedEmpty).toBe(true);
    expect(stateEmpty.doc.child(0).attrs.language).toBeNull();

    // Test whitespace string:
    let stateWhitespace = state;
    const cmdWhitespace = setCodeBlockLanguage('   \t  ');
    const appliedWhitespace = cmdWhitespace(state, (tr): void => {
      stateWhitespace = state.apply(tr);
    });
    expect(appliedWhitespace).toBe(true);
    expect(stateWhitespace.doc.child(0).attrs.language).toBeNull();
  });

  it('returns language inside code block and null outside one via codeBlockLanguageAt', () => {
    // Pins that codeBlockLanguageAt returns the language inside a code block and null outside one.
    const codeBlock = kdocSchema.node(
      'codeBlock',
      { language: 'go', meta: null },
      [kdocSchema.text('package main')],
    );
    const paragraph = kdocSchema.node('paragraph', null, [
      kdocSchema.text('explanatory notes'),
    ]);
    const doc = kdocSchema.node('doc', null, [codeBlock, paragraph]);
    let state = createTestState(doc);

    // Inside code block: caret at position 2.
    const stateInCode = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    expect(codeBlockLanguageAt(stateInCode)).toBe('go');

    // Outside code block: caret inside paragraph (code block size = 1 + 12 + 1 = 14, so position 16 is in paragraph).
    const stateInPara = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 16)),
    );
    expect(codeBlockLanguageAt(stateInPara)).toBeNull();
  });
});
