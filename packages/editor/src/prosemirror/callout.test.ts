// @vitest-environment jsdom
/**
 * @file callout.test.ts
 * @purpose Vitest test suite for callout commands, marker parser, and decoration plugin (FR-8.5).
 * @inputs ProseMirror EditorState instances, document fixtures with blockquotes, and callout kind parameters.
 * @outputs Vitest assertions verifying marker parsing, calloutAt queries, setCallout/clearCallout commands, and decoration plugin behavior.
 * @functions
 *   - para: Constructs a paragraph node with the given text, or an empty paragraph if text is empty.
 *   - docOf: Constructs a document node wrapping the provided block nodes.
 *   - quote: Constructs a blockquote node wrapping the provided block nodes.
 *   - stateAt: Constructs an EditorState with caret positioned inside the text node matching the target string and callout plugin installed.
 *   - runOn: Executes a command against an EditorState and applies every dispatched transaction sequentially.
 *   - decorationClasses: Extracts the CSS class names from all decorations present in the callout plugin state.
 * @dataflow Document fixtures -> EditorState with callout plugin -> commands / queries / transactions -> Vitest assertions.
 * @controlflow Test marker parsing and formatting -> test calloutAt detection -> test setCallout command -> test clearCallout command -> test decoration classes and lifecycle -> test CSS stylesheet rules.
 * @version 1
 * @date 2026-09-11
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { kdocSchema } from './schema.js';
import {
  CALLOUT_KINDS,
  calloutMarker,
  parseCalloutMarker,
  parseAlertMarker,
  alertMarkerAt,
  calloutAt,
  setCallout,
  setCalloutWord,
  clearCallout,
} from './callout.js';
import {
  createCalloutPlugin,
  calloutClassFor,
  CALLOUT_CLASS,
  CALLOUT_MARKER_CLASS,
  CALLOUT_CUSTOM_CLASS,
  CALLOUT_STYLES,
} from './callout-plugin.js';

/**
 * Constructs a paragraph node with the given text, or an empty paragraph if text is empty.
 *
 * @purpose Builds a paragraph ProseMirror node for test fixtures.
 * @inputs text: string - The text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The constructed paragraph node.
 * @dataflow text -> length check -> kdocSchema.text (if non-empty) -> kdocSchema.node('paragraph').
 * @controlflow If text is empty, construct paragraph with no children; else wrap text node in paragraph.
 */
function para(text: string): ProseMirrorNode {
  // Check if the text string is empty.
  if (text.length === 0) {
    // Empty text: construct paragraph with no child text nodes.
    return kdocSchema.node('paragraph', null, []);
  } else {
    // Non-empty text: construct paragraph containing a single text leaf node.
    return kdocSchema.node('paragraph', null, [kdocSchema.text(text)]);
  }
}

/**
 * Constructs a root document node containing the provided block nodes.
 *
 * @purpose Wraps block nodes in a ProseMirror doc node for test fixtures.
 * @inputs blocks: readonly ProseMirrorNode[] - The block nodes to populate inside the doc.
 * @outputs ProseMirrorNode - The constructed root doc node.
 * @dataflow blocks -> kdocSchema.node('doc').
 * @controlflow Wraps the provided blocks in a doc node and returns it.
 */
function docOf(...blocks: readonly ProseMirrorNode[]): ProseMirrorNode {
  return kdocSchema.node('doc', null, [...blocks]);
}

/**
 * Constructs a blockquote node containing the provided block nodes.
 *
 * @purpose Builds a blockquote ProseMirror node for test fixtures.
 * @inputs blocks: readonly ProseMirrorNode[] - The block nodes to place inside the blockquote.
 * @outputs ProseMirrorNode - The constructed blockquote node.
 * @dataflow blocks -> kdocSchema.node('blockquote').
 * @controlflow Wraps the provided blocks in a blockquote node and returns it.
 */
function quote(...blocks: readonly ProseMirrorNode[]): ProseMirrorNode {
  return kdocSchema.node('blockquote', null, [...blocks]);
}

/**
 * Creates an EditorState positioned inside the text node matching the target text, with the callout plugin installed.
 *
 * @purpose Resolves text position and builds an EditorState with selection inside the matched text node.
 * @inputs
 *   - doc: ProseMirrorNode - The root document node to search within.
 *   - textToFind: string - Target text content to locate.
 * @outputs EditorState - Configured EditorState with caret placed at pos + 1 and callout plugin installed.
 * @dataflow doc.descendants -> locate matching text pos -> TextSelection.create -> EditorState.create.
 * @controlflow Walk descendants -> match node.isText and node.text === textToFind -> record pos -> if found, return EditorState; else throw Error.
 */
function stateAt(doc: ProseMirrorNode, textToFind: string): EditorState {
  let foundPos: number | null = null;
  doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // Check if the current node is a text node matching the requested text string.
    if (node.isText && node.text === textToFind) {
      // Matching text node found: record its start position and stop descendant traversal.
      foundPos = pos;
      return false;
    } else {
      // Node is not the target text node: continue traversing descendants.
      return true;
    }
  });

  // Check if the target text was found within the document descendants.
  if (foundPos === null) {
    // Target text was not found in the document: fail fast with an error.
    throw new Error(`Text "${textToFind}" not found in document`);
  } else {
    // Target text located: pos is the text node's own position and + 1 puts the
    // caret one character in, inside the node rather than at its boundary.
    const selection = TextSelection.create(doc, foundPos + 1);
    // The plugin is present in every fixture so the decoration assertions and the command
    // assertions are looking at the same state rather than two states that happen to agree.
    return EditorState.create({
      doc,
      selection,
      plugins: [createCalloutPlugin()],
    });
  }
}

/**
 * Executes a ProseMirror command against an EditorState, accumulating all dispatched transactions.
 *
 * @purpose Runs a command and applies every dispatched transaction sequentially to produce the next state.
 * @inputs
 *   - state: EditorState - The initial EditorState before command execution.
 *   - command: (s: EditorState, d?: (tr: Transaction) => void) => boolean - The ProseMirror command to execute.
 * @outputs EditorState - The resulting EditorState after applying all dispatched transactions, or original state if command returned false.
 * @dataflow state -> command execution with dispatch callback -> current.apply(tr) on each transaction -> final EditorState.
 * @controlflow Initialize current to state -> execute command with dispatch callback -> check command return value -> return updated state if true, original state if false.
 */
function runOn(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
): EditorState {
  let current = state;
  const ok = command(current, (tr: Transaction): void => {
    current = current.apply(tr);
  });

  // Check whether the command returned true or false.
  if (ok) {
    // Command succeeded: return the state with all dispatched transactions applied.
    return current;
  } else {
    // Command returned false: return the original state without modifications.
    return state;
  }
}

/**
 * Reads the callout classes off the rendered document.
 *
 * @purpose Mounts the state in a real EditorView and collects the callout classes the decorations put
 *   on the DOM, in document order.
 * @inputs state: EditorState - The state to render.
 * @outputs string[] - The className of every element carrying a callout class.
 * @dataflow state -> EditorView on a detached container -> querySelectorAll -> className strings.
 * @controlflow Mount, read, tear down, return.
 *
 * The classes are read from the DOM rather than from the DecorationSet because a decoration's attrs are
 * not part of ProseMirror's public types, and reaching into them would need a cast that asserts a shape
 * nothing checks. The rendered element is also the thing that actually has to carry the class.
 */
function decorationClasses(state: EditorState): string[] {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new EditorView(root, { state });

  const classes: string[] = [];
  const marked = root.querySelectorAll<HTMLElement>(
    `.${CALLOUT_CLASS}, .${CALLOUT_MARKER_CLASS}`,
  );
  for (let i = 0; i < marked.length; i++) {
    const el = marked[i];
    // Check if the element is defined under strict indexing.
    if (el === undefined) {
      // Skip a gap the NodeList cannot actually have, but the types allow.
      continue;
    } else {
      // Element present: record the class attribute exactly as it was written.
      classes.push(el.className);
    }
  }

  view.destroy();
  root.remove();
  return classes;
}

/**
 * Reads back the document text the marker decoration actually covers.
 *
 * @purpose Renders the state and returns the text content of the marker element, so a test can assert
 *   what the decoration styled rather than merely that it exists.
 * @inputs state: EditorState - The state to render.
 * @outputs string - The marker element's text, or '' when there is no marker element.
 * @dataflow state -> EditorView -> querySelector('.kdoc-callout-marker') -> textContent.
 * @controlflow Mount, read, tear down, return.
 */
function markedText(state: EditorState): string {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new EditorView(root, { state });

  const el = root.querySelector<HTMLElement>(`.${CALLOUT_MARKER_CLASS}`);
  let text = '';
  // Check whether a marker element was rendered at all.
  if (el === null) {
    // No marker element: the empty string says so without throwing, which lets the caller assert it.
  } else {
    // Marker element present: report exactly the text it covers.
    text = el.textContent ?? '';
  }

  view.destroy();
  root.remove();
  return text;
}

describe('the marker', () => {
  it('round-trips every kind through its marker', () => {
    for (let i = 0; i < CALLOUT_KINDS.length; i++) {
      const kind = CALLOUT_KINDS[i];
      // Check if kind is defined under strict indexing.
      if (kind !== undefined) {
        expect(parseCalloutMarker(calloutMarker(kind))).toBe(kind);
      } else {
        // Undefined kind entry: skip.
      }
    }
  });

  it('formats the marker in upper case', () => {
    // This is the spelling GitHub and Obsidian both write, and a lower-case
    // one would render as ordinary text there.
    expect(calloutMarker('note')).toBe('[!NOTE]');
  });

  it('ignores surrounding whitespace', () => {
    expect(parseCalloutMarker('  [!TIP]  ')).toBe('tip');
  });

  it('accepts a lower-case marker', () => {
    expect(parseCalloutMarker('[!warning]')).toBe('warning');
  });

  it('does not treat an unknown alert word as a callout', () => {
    // An unknown alert word is somebody else's extension, and guessing at it
    // would be worse than leaving the quote alone.
    expect(parseCalloutMarker('[!QUESTION]')).toBeNull();
  });

  it('does not treat text that merely contains a marker as one', () => {
    expect(parseCalloutMarker('see [!NOTE] below')).toBeNull();
  });
});

describe('calloutAt', () => {
  it('returns null in a plain paragraph', () => {
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    expect(calloutAt(state)).toBeNull();
  });

  it('returns null in a plain quote', () => {
    const doc = docOf(quote(para('just quoted')));
    const state = stateAt(doc, 'just quoted');
    expect(calloutAt(state)).toBeNull();
  });

  it('returns the kind in a callout', () => {
    const doc = docOf(quote(para('[!TIP]'), para('body')));
    const state = stateAt(doc, 'body');
    expect(calloutAt(state)).toBe('tip');
  });

  it('reads the innermost quote', () => {
    // A callout nested in a callout is the caret's own one.
    const doc = docOf(
      quote(para('[!NOTE]'), quote(para('[!CAUTION]'), para('inner'))),
    );
    const state = stateAt(doc, 'inner');
    expect(calloutAt(state)).toBe('caution');
  });

  it('returns null when the first block of a quote is not a paragraph', () => {
    // A fence saying [!NOTE] is code that happens to read like a marker.
    const codeBlock = kdocSchema.node('codeBlock', null, [
      kdocSchema.text('[!NOTE]'),
    ]);
    const doc = docOf(quote(codeBlock, para('x')));
    const state = stateAt(doc, 'x');
    expect(calloutAt(state)).toBeNull();
  });
});

describe('setCallout', () => {
  it('wraps a bare paragraph and adds the marker', () => {
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    const next = runOn(state, setCallout('note'));

    expect(next.doc.child(0).type.name).toBe('blockquote');
    expect(next.doc.child(0).child(0).textContent).toBe('[!NOTE]');

    const nextState = stateAt(next.doc, 'plain');
    expect(calloutAt(nextState)).toBe('note');
  });

  it('adds a marker to an existing quote without wrapping again', () => {
    const doc = docOf(quote(para('quoted')));
    const state = stateAt(doc, 'quoted');
    const next = runOn(state, setCallout('tip'));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('blockquote');
    expect(next.doc.child(0).childCount).toBe(2);
  });

  it('replaces a marker rather than stacking them', () => {
    const doc = docOf(quote(para('[!NOTE]'), para('body')));
    const state = stateAt(doc, 'body');
    const next = runOn(state, setCallout('caution'));

    expect(next.doc.childCount).toBe(1);
    const bq = next.doc.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.childCount).toBe(2);
    expect(bq.child(0).textContent).toBe('[!CAUTION]');
  });

  it('answers dry runs without dispatching transactions', () => {
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    let dispatches = 0;

    const dryRunResult = setCallout('note')(state);
    expect(dryRunResult).toBe(true);
    expect(dispatches).toBe(0);

    const dispatchResult = setCallout('note')(state, (_tr: Transaction): void => {
      dispatches++;
    });
    expect(dispatchResult).toBe(true);
    expect(dispatches).toBeGreaterThan(0);
  });
});

describe('clearCallout', () => {
  it('removes the marker and leaves the quote', () => {
    const doc = docOf(quote(para('[!TIP]'), para('body')));
    const state = stateAt(doc, 'body');
    const next = runOn(state, clearCallout());

    expect(next.doc.childCount).toBe(1);
    const bq = next.doc.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.childCount).toBe(1);
    expect(bq.child(0).textContent).toBe('body');
  });

  it('leaves no empty paragraph behind', () => {
    const doc = docOf(quote(para('[!TIP]'), para('body')));
    const state = stateAt(doc, 'body');
    const next = runOn(state, clearCallout());

    const bq = next.doc.child(0);
    // A blockquote whose first child is an empty paragraph serialises as a stray blank quote line.
    for (let i = 0; i < bq.childCount; i++) {
      expect(bq.child(i).textContent).not.toBe('');
    }
  });

  it('leaves no empty paragraph even when nothing can absorb one', () => {
    // A code block cannot take a paragraph's content the way another paragraph can, so this is the
    // fixture where an emptied marker would have to survive as its own block if it survived at all.
    const fence = kdocSchema.node('codeBlock', null, [kdocSchema.text('x')]);
    const doc = docOf(quote(para('[!TIP]'), fence));
    const state = stateAt(doc, 'x');
    const next = runOn(state, clearCallout());

    const bq = next.doc.child(0);
    expect(bq.childCount).toBe(1);
    expect(bq.child(0).type.name).toBe('codeBlock');
  });

  it('clears the callout the caret is in, not the one around it', () => {
    // The blockquote's position is what the delete is measured from, so a walk that returned the
    // outermost quote's position would cut the wrong marker out of the wrong callout.
    const doc = docOf(quote(para('[!NOTE]'), quote(para('[!CAUTION]'), para('inner'))));
    const state = stateAt(doc, 'inner');
    const next = runOn(state, clearCallout());

    const outer = next.doc.child(0);
    expect(outer.child(0).textContent).toBe('[!NOTE]');
    const inner = outer.child(1);
    expect(inner.type.name).toBe('blockquote');
    expect(inner.childCount).toBe(1);
    expect(inner.child(0).textContent).toBe('inner');
  });

  it('sets the callout the caret is in, not the one around it', () => {
    const doc = docOf(quote(para('[!NOTE]'), quote(para('[!CAUTION]'), para('inner'))));
    const state = stateAt(doc, 'inner');
    const next = runOn(state, setCallout('tip'));

    const outer = next.doc.child(0);
    expect(outer.child(0).textContent).toBe('[!NOTE]');
    expect(outer.child(1).child(0).textContent).toBe('[!TIP]');
  });

  it('refuses where there is no callout', () => {
    // A command reporting success for doing nothing puts an empty entry in the undo history.
    const plainQuoteState = stateAt(docOf(quote(para('quoted'))), 'quoted');
    expect(clearCallout()(plainQuoteState)).toBe(false);

    const bareParaState = stateAt(docOf(para('plain')), 'plain');
    expect(clearCallout()(bareParaState)).toBe(false);
  });
});

describe('the decorations', () => {
  it('gives a callout both panel and marker classes', () => {
    const doc = docOf(quote(para('[!NOTE]'), para('body')));
    const state = stateAt(doc, 'body');
    const classes = decorationClasses(state);

    expect(classes).toContain(`${CALLOUT_CLASS} ${calloutClassFor('note')}`);
    expect(classes).toContain(CALLOUT_MARKER_CLASS);
  });

  it('assigns each kind its own class', () => {
    for (let i = 0; i < CALLOUT_KINDS.length; i++) {
      const kind = CALLOUT_KINDS[i];
      // Check if kind is defined under strict indexing.
      if (kind !== undefined) {
        const doc = docOf(quote(para(calloutMarker(kind)), para('content')));
        const state = stateAt(doc, 'content');
        const classes = decorationClasses(state);
        const panelClass = classes[0];

        // Check if panel class is defined.
        if (panelClass !== undefined) {
          expect(panelClass.endsWith(kind)).toBe(true);
        } else {
          // Panel decoration class missing: fail test.
          expect.fail('Expected panel decoration class to be present');
        }
      } else {
        // Undefined kind entry: skip.
      }
    }
  });

  it('produces no decorations for a plain quote', () => {
    const doc = docOf(quote(para('just quoted')));
    const state = stateAt(doc, 'just quoted');
    expect(decorationClasses(state)).toEqual([]);
  });

  it('decorates a nested callout too', () => {
    // The walk keeps descending for exactly this reason.
    const doc = docOf(
      quote(para('[!NOTE]'), quote(para('[!CAUTION]'), para('inner'))),
    );
    const state = stateAt(doc, 'inner');
    const classes = decorationClasses(state);

    expect(classes).toHaveLength(4);
    // 'kdoc-callout-marker' contains 'kdoc-callout', so the panels are told from the markers by the
    // space that follows the panel class rather than by a substring test that matches both.
    expect(classes.filter((c: string): boolean => c.startsWith(`${CALLOUT_CLASS} `))).toHaveLength(2);
    expect(classes.filter((c: string): boolean => c === CALLOUT_MARKER_CLASS)).toHaveLength(2);
  });

  it('removes decorations when editing the marker away', () => {
    // This is the whole reason the marker is decorated rather than hidden:
    // the user can see what makes it a callout and can take it away.
    const doc = docOf(quote(para('[!NOTE]'), para('body')));
    const state = stateAt(doc, 'body');
    expect(decorationClasses(state)).toHaveLength(2);

    let markerPos: number | null = null;
    state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
      // Check if node is the marker text node.
      if (node.isText && node.text === '[!NOTE]') {
        markerPos = pos;
        return false;
      } else {
        // Continue searching descendants.
        return true;
      }
    });

    // Check if marker position was located.
    if (markerPos !== null) {
      const tr = state.tr.replaceWith(
        markerPos,
        markerPos + '[!NOTE]'.length,
        kdocSchema.text('hello'),
      );
      const nextState = state.apply(tr);
      expect(decorationClasses(nextState)).toEqual([]);
    } else {
      // Marker text node missing: fail test.
      expect.fail('Expected marker text node to be found');
    }
  });
});

describe('the compact form', () => {
  it('a marker sharing its paragraph with the body is still a marker', () => {
    // `> [!NOTE]` followed by `> body` is a single paragraph, because a quote's continuation line joins
    // the one above it. This is the shape a GFM file usually arrives in, and requiring the marker to be
    // the paragraph's whole text recognised only the shape K-Doc's own editor produces.
    const marker = parseAlertMarker('[!NOTE]\nbody text');
    // Check whether a marker was found.
    if (marker === null) {
      expect.fail('Expected the compact form to be recognised');
    } else {
      expect(marker.kind).toBe('note');
      expect(marker.length).toBe('[!NOTE]'.length);
    }
  });

  it('calloutAt reads a compact callout', () => {
    const doc = docOf(quote(para('[!TIP]\nthe body')));
    const state = stateAt(doc, '[!TIP]\nthe body');
    expect(calloutAt(state)).toBe('tip');
  });

  it('the marker is decorated, the body is not', () => {
    // A node decoration over the paragraph would give the body the marker's styling too, which is the
    // whole reason the marker is decorated inline over its own characters.
    const doc = docOf(quote(para('[!NOTE]\nbody text')));
    const state = stateAt(doc, '[!NOTE]\nbody text');
    const classes = decorationClasses(state);
    expect(classes).toContain(CALLOUT_MARKER_CLASS);

    const marked = markedText(state);
    expect(marked).toBe('[!NOTE]');
  });

  it('setting a kind on a compact callout keeps the body', () => {
    const doc = docOf(quote(para('[!NOTE]\nthe body')));
    const state = stateAt(doc, '[!NOTE]\nthe body');
    const next = runOn(state, setCallout('caution'));
    expect(next.doc.child(0).child(0).textContent).toBe('[!CAUTION]\nthe body');
  });

  it('clearing a compact callout keeps the body and takes the newline', () => {
    // Deleting the paragraph node would take the body with it, and leaving the newline behind would
    // start the body with a blank line.
    const doc = docOf(quote(para('[!TIP]\nthe body')));
    const state = stateAt(doc, '[!TIP]\nthe body');
    const next = runOn(state, clearCallout());
    const bq = next.doc.child(0);
    expect(bq.childCount).toBe(1);
    expect(bq.child(0).textContent).toBe('the body');
  });

  it('a marker with more on its own line is still prose', () => {
    // The lookahead is what separates a marker opening a line from one embedded in it.
    expect(parseAlertMarker('[!NOTE] and more')).toBeNull();
  });
});

describe('a custom alert word', () => {
  it('is recognised, with no kind', () => {
    const marker = parseAlertMarker('[!QUESTION]');
    // Check whether the unknown word was recognised as a marker at all.
    if (marker === null) {
      expect.fail('Expected an unknown alert word to still be a marker');
    } else {
      // Refusing to colour it would make K-Doc the only reader that treats it as prose.
      expect(marker.word).toBe('question');
      expect(marker.kind).toBeNull();
    }
  });

  it('gets a panel in the neutral accent', () => {
    const doc = docOf(quote(para('[!QUESTION]'), para('body')));
    const state = stateAt(doc, 'body');
    const classes = decorationClasses(state);
    expect(classes.some((c: string): boolean => c.includes(CALLOUT_CUSTOM_CLASS))).toBe(true);
  });

  it('alertMarkerAt reports it where calloutAt cannot', () => {
    // The two answers are deliberately different: no marker at all, and a marker K-Doc does not colour.
    const doc = docOf(quote(para('[!QUESTION]'), para('body')));
    const state = stateAt(doc, 'body');
    expect(calloutAt(state)).toBeNull();
    const marker = alertMarkerAt(state);
    // Check whether the marker was reported by the wider query.
    if (marker === null) {
      expect.fail('Expected alertMarkerAt to report the unknown word');
    } else {
      expect(marker.word).toBe('question');
    }
  });

  it('setCalloutWord writes it upper-cased', () => {
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    const next = runOn(state, setCalloutWord('question'));
    expect(next.doc.child(0).child(0).textContent).toBe('[!QUESTION]');
  });

  it('setCalloutWord replaces a marker that is already there', () => {
    const doc = docOf(quote(para('[!NOTE]'), para('body')));
    const state = stateAt(doc, 'body');
    const next = runOn(state, setCalloutWord('todo'));
    const bq = next.doc.child(0);
    expect(bq.childCount).toBe(2);
    expect(bq.child(0).textContent).toBe('[!TODO]');
  });

  it('a word that is not letters is refused', () => {
    // GFM's alert syntax admits letters only, and a word with a space or a digit in it would serialise
    // as a line of prose that happens to start with a bracket.
    const doc = docOf(para('plain'));
    const state = stateAt(doc, 'plain');
    expect(setCalloutWord('two words')(state)).toBe(false);
    expect(setCalloutWord('v2')(state)).toBe(false);
    expect(setCalloutWord('')(state)).toBe(false);
  });

  it('the custom accent is declared rather than left to the fallback', () => {
    expect(CALLOUT_STYLES).toContain(`.${CALLOUT_CUSTOM_CLASS} {`);
  });
});

describe('the styles', () => {
  it('defines an accent for each kind', () => {
    for (let i = 0; i < CALLOUT_KINDS.length; i++) {
      const kind = CALLOUT_KINDS[i];
      // Check if kind is defined under strict indexing.
      if (kind !== undefined) {
        expect(CALLOUT_STYLES).toContain(`.${calloutClassFor(kind)} {`);
      } else {
        // Undefined kind entry: skip.
      }
    }
  });

  it('derives the tint from the accent using color-mix', () => {
    // Five hand-picked pale colours would drift out of step with the five accents.
    expect(CALLOUT_STYLES).toContain('color-mix');
  });
});
