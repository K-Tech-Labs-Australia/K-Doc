// @vitest-environment jsdom
/**
 * @file image-editing.spec.ts
 * @purpose Tests the ProseMirror image editing features: width hint parsing/serialization, resize commands, and the rendered image frame.
 * @inputs Markdown strings converted into ProseMirror documents; DOM pointer events dispatched on mounted editor views.
 * @outputs Assertions over serialized markdown, node attributes, and rendered DOM state.
 * @functions
 *   - docOf: Parses markdown into a ProseMirror document using the KDOC schema.
 *   - markdownOf: Serializes a ProseMirror document back to markdown text.
 *   - imagePos: Locates the position of the first image node in a document.
 *   - selectedState: Builds an EditorState with NodeSelection on the first image.
 *   - run: Applies a command to a state and returns the resulting state.
 *   - mountedView: Creates a live EditorView attached to the DOM for UI tests.
 * @dataflow Markdown → parseMarkdown → mdastToProseMirror → ProseMirror document → commands/DOM events → assertions.
 * @controlflow Import setup → guarded PointerEvent polyfill → afterEach cleanup → helper definitions → describe/it cases.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from '../src/prosemirror/schema.js';
import { mdastToProseMirror } from '../src/prosemirror/from-mdast.js';
import { proseMirrorToMdast } from '../src/prosemirror/to-mdast.js';
import { insertImage } from '../src/prosemirror/insert-commands.js';
import { ImageView, IMAGE_SELECTED_CLASS, MIN_IMAGE_WIDTH, createImageNodeView } from '../src/prosemirror/image-view.js';
import { resetImageSize, selectedImage, selectImageAt, setImageWidth, stepImageWidth } from '../src/prosemirror/image-commands.js';


// jsdom may not define PointerEvent; provide a minimal guarded polyfill so pointer-drag tests run under Node.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
} else {
  /* The environment has pointer events. */
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/**
 * docOf converts markdown text into a ProseMirror document.
 * @purpose Parse the markdown and build a ProseMirror document with the KDOC schema.
 * @inputs markdown - Source markdown string to parse.
 * @outputs PMNode - The resulting ProseMirror document node.
 */
function docOf(markdown: string): PMNode {
  return mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
}

/**
 * markdownOf serializes a ProseMirror document back to markdown text.
 * @purpose Convert the document to an mdast tree and serialize it to markdown.
 * @inputs doc - The ProseMirror document node to serialize.
 * @outputs string - The serialized markdown representation.
 */
function markdownOf(doc: PMNode): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(doc), frontMatter: null });
}

/**
 * imagePos locates the position of the first image node in a document.
 * @purpose Walk the tree and record the position of the first image encountered.
 * @inputs doc - The ProseMirror document to search.
 * @outputs number - The position of the first image node.
 */
function imagePos(doc: PMNode): number {
  const holder: { pos: number | null } = { pos: null };
  doc.descendants((node, pos) => {
    if (holder.pos === null && node.type.name === 'image') {
      holder.pos = pos;
    } else {
      // No image found yet at this position; continue searching descendants.
    }
    return holder.pos === null;
  });
  if (holder.pos === null) {
    throw new Error('no image');
  } else {
    return holder.pos;
  }
}

/**
 * selectedState builds an EditorState with NodeSelection on the first image.
 * @purpose Create a state whose selection is a node selection over the first image.
 * @inputs markdown - Source markdown describing the document under test.
 * @outputs EditorState - A state positioned on the first image node.
 */
function selectedState(markdown: string): EditorState {
  const doc = docOf(markdown);
  return EditorState.create({ doc, selection: NodeSelection.create(doc, imagePos(doc)) });
}

/**
 * run applies a command to a state and returns the resulting state.
 * @purpose Execute a command against the state, capturing each applied transaction.
 * @inputs state - The starting EditorState; command - The command function to invoke.
 * @outputs EditorState - The state after applying any produced transaction.
 */
function run(state: EditorState, command: (state: EditorState, dispatch: (tr: import('prosemirror-state').Transaction) => void) => boolean): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

/**
 * mountedView creates a live EditorView attached to the DOM.
 * @purpose Instantiate an EditorView with image node views for UI-level tests.
 * @inputs markdown - Source markdown describing the document under test.
 * @outputs EditorView - A mounted editor view registered for cleanup.
 */
function mountedView(markdown: string): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = docOf(markdown);
  const view = new EditorView(parent, {
    state: EditorState.create({ doc }),
    nodeViews: { image: createImageNodeView(() => Promise.resolve(null)) },
  });
  views.push(view);
  return view;
}

describe('image width hint in the conversion', () => {
  // Verifies a width hint embedded in the alt text is parsed into attrs and preserved on serialization.
  it('reads the width out of the alt and writes it back', () => {
    const doc = docOf('A ![Logo|120](logo.png "Our logo") here.\n');
    const image = doc.nodeAt(imagePos(doc));
    expect(image?.attrs['alt']).toBe('Logo');
    expect(image?.attrs['width']).toBe(120);
    expect(image?.attrs['title']).toBe('Our logo');
    expect(markdownOf(doc)).toBe(serializeDocument(parseMarkdown('A ![Logo|120](logo.png "Our logo") here.\n')));
  });

  // Confirms that images without a width hint are left untouched through a round-trip.
  it('leaves an image that was never resized untouched', () => {
    const markdown = 'A ![Logo](logo.png) and ![](x.png) and ![Chart|0600](c.png).\n';
    expect(markdownOf(docOf(markdown))).toBe(serializeDocument(parseMarkdown(markdown)));
    const doc = docOf(markdown);
    expect(doc.nodeAt(imagePos(doc))?.attrs['width']).toBeNull();
  });

  // Checks that the rendered picture reflects the width hint from the markdown.
  it('sizes the rendered picture', () => {
    const view = mountedView('![Logo|120](https://x.example/logo.png)\n');
    expect(view.dom.querySelector('img')?.style.width).toBe('120px');
  });
});

describe('image commands', () => {
  // Exercises setImageWidth and resetImageSize and asserts the resulting serialization.
  it('sets, changes and resets the width of the selected image', () => {
    let state = selectedState('![Logo](logo.png)\n');
    state = run(state, setImageWidth(300));
    expect(markdownOf(state.doc)).toBe('![Logo|300](logo.png)\n');
    expect(selectedImage(state)?.node.attrs['width']).toBe(300);
    state = run(state, resetImageSize());
    expect(markdownOf(state.doc)).toBe('![Logo](logo.png)\n');
  });

  // Asserts that invalid or redundant width changes are refused.
  it('refuses without a selected image, an invalid width, or no change', () => {
    const doc = docOf('![Logo|300](logo.png)\n');
    expect(setImageWidth(200)(EditorState.create({ doc }))).toBe(false);
    const state = selectedState('![Logo|300](logo.png)\n');
    expect(setImageWidth(0)(state)).toBe(false);
    expect(setImageWidth(1.5)(state)).toBe(false);
    expect(setImageWidth(10001)(state)).toBe(false);
    expect(setImageWidth(300)(state)).toBe(false);
    expect(setImageWidth(10000)(state)).toBe(true);
    expect(setImageWidth(1)(state)).toBe(true);
    expect(resetImageSize()(selectedState('![Logo](logo.png)\n'))).toBe(false);
  });

  // Ensures the width hint survives an image dialog edit.
  it('keeps the size when the image dialog edits the image', () => {
    let state = selectedState('![Logo|300](logo.png)\n');
    state = run(state, insertImage({ src: 'new.png', alt: 'New', title: 'Caption' }));
    expect(markdownOf(state.doc)).toBe('![New|300](new.png "Caption")\n');
  });

  // Verifies that a right-clicked picture selects the image beneath it.
  it('selects the image under a right-clicked picture', () => {
    const view = mountedView('Before ![Logo](https://x.example/logo.png) after.\n');
    const picture = view.dom.querySelector('img');
    expect(selectImageAt(view, picture)).toBe(true);
    expect(selectedImage(view.state)?.node.attrs['alt']).toBe('Logo');
    expect(selectImageAt(view, view.dom.querySelector('p'))).toBe(false);
    expect(selectImageAt(view, null)).toBe(false);
    expect(selectImageAt(view, document.createTextNode('x'))).toBe(false);
    const stray = document.body.appendChild(document.createElement('span'));
    stray.className = 'kdoc-image';
    expect(selectImageAt(view, stray)).toBe(false);
    stray.remove();
  });

  // Image commands ignore a selected node that is not an image.
  it('does not treat another selected node as an image', () => {
    const doc = docOf('Above\n\n---\n\nBelow\n');
    const holder: { pos: number | null } = { pos: null };
    doc.descendants((node, pos) => {
      if (holder.pos === null && node.type.name === 'thematicBreak') {
        holder.pos = pos;
      } else {
        // Not the rule; keep looking.
      }
      return holder.pos === null;
    });
    if (holder.pos === null) {
      throw new Error('no rule');
    } else {
      const state = EditorState.create({ doc, selection: NodeSelection.create(doc, holder.pos) });
      expect(selectedImage(state)).toBeNull();
    }
  });
});

describe('editing a picture through the dialog', () => {
  it('keeps a wiki embed a wiki embed when its address is edited', () => {
    let state = selectedState('![[shape.png|120]]\n');
    state = run(state, insertImage({ src: 'other.png', alt: '', title: '' }));
    expect(markdownOf(state.doc)).toBe('![[other.png|120]]\n');
  });

  it('gives up the embed syntax rather than the words typed into it', () => {
    // `![[...]]` has nowhere to put alt text, so a caption asked for here means the picture becomes an
    // ordinary Markdown image. Keeping the syntax would mean silently discarding what was typed.
    let state = selectedState('![[shape.png]]\n');
    state = run(state, insertImage({ src: 'shape.png', alt: 'A shape', title: '' }));
    expect(markdownOf(state.doc)).toBe('![A shape](shape.png)\n');
  });
});

describe('resizing a picture from the keyboard', () => {
  // A picture that already carries a hint is stepped from that hint, which is exact.
  it('steps a width hint up and down by a tenth', () => {
    let state = selectedState('![Logo|200](logo.png)\n');
    state = run(state, stepImageWidth(true));
    expect(selectedImage(state)?.node.attrs['width']).toBe(220);
    state = run(state, stepImageWidth(false));
    expect(selectedImage(state)?.node.attrs['width']).toBe(200);
  });

  // Rounding would leave a small picture where it started, so a step is always at least one pixel.
  it('always moves by at least one pixel', () => {
    let state = selectedState('![Logo|20](logo.png)\n');
    state = run(state, stepImageWidth(true));
    expect(selectedImage(state)?.node.attrs['width']).toBe(22);
    state = selectedState('![Logo|17](logo.png)\n');
    state = run(state, stepImageWidth(false));
    expect(selectedImage(state)?.node.attrs['width']).toBe(16);
  });

  // The floor is the one the drag handle uses, so the two ways of resizing agree. A picture already at the
  // floor cannot narrow: setImageWidth refuses a value it already holds rather than making an empty undo step.
  it('stops at the same floor the handle does', () => {
    let state = selectedState(`![Logo|${MIN_IMAGE_WIDTH}](logo.png)\n`);
    expect(stepImageWidth(false)(state)).toBe(false);
    state = run(state, stepImageWidth(true));
    // A tenth of 16 rounds to 18, which is the step, not the one-pixel minimum.
    expect(selectedImage(state)?.node.attrs['width']).toBe(18);
  });

  // Without a picture selected the keys have nothing to act on and must let the event pass.
  it('does nothing without a selected picture', () => {
    const state = EditorState.create({ doc: docOf('Just words.\n') });
    expect(stepImageWidth(true)(state)).toBe(false);
    expect(stepImageWidth(false)(state)).toBe(false);
  });

  // A picture that has never been resized has no width in the document, so the step is measured from what
  // is on screen. Without a view there is nothing to measure and the command must say so rather than guess.
  it('refuses to guess a starting width when it cannot measure one', () => {
    const state = selectedState('![Logo](logo.png)\n');
    expect(stepImageWidth(true)(state)).toBe(false);
  });

  it('will not step a picture that has not loaded', () => {
    // A picture the browser has not drawn yet measures zero. Stepping from zero would set every such
    // picture to the floor, which is a resize the reader never asked for.
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const pos = imagePos(view.state.doc);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    const picture = view.dom.querySelector('img');
    if (picture !== null) {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    } else {
      throw new Error('no picture');
    }
    expect(stepImageWidth(true)(view.state, view.dispatch, view)).toBe(false);
  });

  it('does nothing with a caret in the words rather than on a picture', () => {
    // The view is there to measure through, and the paragraph holds a picture that measures, so this is
    // the case that proves the command refuses on the selection rather than for want of a measurement.
    const view = mountedView('Words ![Logo](https://x.example/logo.png) more.\n');
    const picture = view.dom.querySelector('img');
    if (picture !== null) {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    } else {
      throw new Error('no picture');
    }
    expect(stepImageWidth(true)(view.state, view.dispatch, view)).toBe(false);
    expect(stepImageWidth(false)(view.state, view.dispatch, view)).toBe(false);
  });

  // With a view it measures the picture as drawn, which is what makes the first press work.
  it('measures the picture on screen when there is no hint yet', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const pos = imagePos(view.state.doc);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    const picture = view.dom.querySelector('img');
    // jsdom lays nothing out, so the width is stated for the measurement to find.
    if (picture !== null) {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    } else {
      throw new Error('no picture');
    }
    expect(stepImageWidth(true)(view.state, view.dispatch, view)).toBe(true);
    expect(selectedImage(view.state)?.node.attrs['width']).toBe(110);
  });
});

describe('image frame', () => {
  // Checks that captions render and empty ones are hidden.
  it('shows the caption under the picture and hides an empty one', () => {
    const view = mountedView('![Logo](https://x.example/logo.png "Our logo") and ![Plain](https://x.example/p.png)\n');
    const captions = [...view.dom.querySelectorAll<HTMLElement>('.kdoc-image-caption')];
    expect(captions.map((caption) => [caption.textContent, caption.hidden])).toEqual([['Our logo', false], ['', true]]);
  });

  // Confirms that a selected image carries the selection class.
  it('marks a selected image', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos(view.state.doc))));
    expect(view.dom.querySelector('.kdoc-image')?.classList.contains(IMAGE_SELECTED_CLASS)).toBe(true);
    view.dispatch(view.state.tr.setSelection(NodeSelection.near(view.state.doc.resolve(0))));
  });

  // Simulates a resize drag and asserts it is applied as one change while keeping the image selected.
  it('writes the dragged width as one change and keeps the image selected', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector<HTMLElement>('.kdoc-image-resize-handle');
    const picture = view.dom.querySelector('img');
    if (handle === null || picture === null) {
      throw new Error('no frame');
    } else {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 200, height: 100, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, toJSON: () => ({}) });
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, bubbles: true }));
      expect(picture.style.width).toBe('250px');
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, bubbles: true }));
      expect(markdownOf(view.state.doc)).toBe('![Logo|250](https://x.example/logo.png)\n');
      expect(selectedImage(view.state)).not.toBeNull();
    }
  });

  // Ensures a drag cannot shrink the image below the configured minimum width.
  it('never makes an image narrower than the minimum', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector<HTMLElement>('.kdoc-image-resize-handle');
    const picture = view.dom.querySelector('img');
    if (handle === null || picture === null) {
      throw new Error('no frame');
    } else {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 40, height: 20, x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 20, toJSON: () => ({}) });
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, bubbles: true }));
      expect(markdownOf(view.state.doc)).toBe(`![Logo|${MIN_IMAGE_WIDTH}](https://x.example/logo.png)\n`);
    }
  });

  // Verifies that a cancelled drag restores the previous width.
  it('puts the width back when a drag is cancelled', () => {
    const view = mountedView('![Logo|120](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector<HTMLElement>('.kdoc-image-resize-handle');
    const picture = view.dom.querySelector('img');
    if (handle === null || picture === null) {
      throw new Error('no frame');
    } else {
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      expect(picture.style.width).toBe('120px');
      expect(markdownOf(view.state.doc)).toBe('![Logo|120](https://x.example/logo.png)\n');
    }
  });

  // A width change arriving through update shows without a new view.
  it('applies a new width on update', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const node = view.state.doc.nodeAt(imagePos(view.state.doc)) as PMNode;
    const image = new ImageView(node, view, () => Promise.resolve(null));
    expect(image.update(node.type.create({ ...node.attrs, width: 50 }))).toBe(true);
    expect(image.image.style.width).toBe('50px');
  });

  // A drag cannot make the image wider than the block holding it.
  it('never makes an image wider than its block', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector<HTMLElement>('.kdoc-image-resize-handle');
    const picture = view.dom.querySelector('img');
    const block = view.dom.querySelector('p');
    if (handle === null || picture === null || block === null) {
      throw new Error('no frame');
    } else {
      Object.defineProperty(block, 'clientWidth', { value: 300 });
      picture.getBoundingClientRect = (): DOMRect => ({ width: 200, height: 100, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, toJSON: () => ({}) });
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 900, bubbles: true }));
      expect(markdownOf(view.state.doc)).toBe('![Logo|300](https://x.example/logo.png)\n');
    }
  });

  // Letting go without changing the width is not an edit.
  it('makes no change when a drag ends at the same width', () => {
    const view = mountedView('![Logo|200](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector<HTMLElement>('.kdoc-image-resize-handle');
    const picture = view.dom.querySelector('img');
    if (handle === null || picture === null) {
      throw new Error('no frame');
    } else {
      picture.getBoundingClientRect = (): DOMRect => ({ width: 200, height: 100, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, toJSON: () => ({}) });
      const before = view.state;
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, bubbles: true }));
      expect(view.state).toBe(before);
    }
  });

  // Confirms that pointer events on the resize handle are stopped but others are not.
  it('leaves events on the handle to the handle', () => {
    const view = mountedView('![Logo](https://x.example/logo.png)\n');
    const handle = view.dom.querySelector('.kdoc-image-resize-handle');
    const image = new ImageView(view.state.doc.nodeAt(imagePos(view.state.doc)) as PMNode, view, () => Promise.resolve(null));
    expect(image.stopEvent({ target: image.dom.querySelector('.kdoc-image-resize-handle') } as unknown as Event)).toBe(true);
    expect(image.stopEvent({ target: image.image } as unknown as Event)).toBe(false);
    expect(handle).not.toBeNull();
  });
});
