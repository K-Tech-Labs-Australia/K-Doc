// @vitest-environment jsdom

/**
 * @file image-view.spec.ts
 * @purpose Vitest jsdom suite for the ProseMirror ImageView node view and its host-supplied source loader (FR-8.14), plus the ProseMirrorBinding loadImage option that wires images through that loader.
 * @inputs Image nodes built on kdocSchema, a stubbed EditorView, deferred loader promises, DocumentSession fixtures, and optional host loaders.
 * @outputs Vitest assertions covering direct-source handling, loading/missing states, generation-based race handling, update semantics, teardown cancellation, and binding-level loader wiring.
 * @functions
 *   - image: Builds an kdocSchema image node from src/alt/title.
 *   - fakeView: Returns a bare EditorView stub backed by a div (read only for its document).
 *   - flush: Resolves on the next macrotask so pending loader .then callbacks run before assertions.
 *   - deferred: Builds a manually-resolvable Promise<string | null> with captured resolve/reject.
 * @dataflow Test fixtures -> ImageView / ProseMirrorBinding -> loader promises -> DOM <img> state verified by assertions.
 * @controlflow Build node + stub view + loader -> construct view or binding -> assert sync state -> resolve deferred loaders -> flush -> assert async state; afterEach destroys bindings and detaches mounts.
 * @version 1
 * @date 2026-09-14
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding, kdocSchema } from '../src/index.js';
import { ImageView, IMAGE_LOADING_CLASS, IMAGE_MISSING_CLASS, createImageNodeView, isDirectImageSource } from '../src/prosemirror/image-view.js';

/** Bindings created during the run; destroyed in afterEach so pending loaders and mounted DOM nodes do not leak into later tests. */
const bindings: ProseMirrorBinding[] = [];
/** Mount elements appended to the body, removed in afterEach. */
const mounts: HTMLElement[] = [];

/**
 * @purpose Builds an kdocSchema image node from its src/alt/title attributes.
 * @inputs src - the written address stored on the node; alt - optional alternative text; title - optional tooltip.
 * @outputs PMNode - a fresh image node carrying those attrs.
 * @dataflow The three string arguments are passed straight into kdocSchema's image node factory.
 * @controlflow No branching; always constructs and returns the node.
 */
function image(src: string, alt = '', title = ''): PMNode {
  return kdocSchema.nodes.image.create({ src, alt, title });
}

/**
 * @purpose Returns a bare EditorView stub backed by a div element for ImageView construction.
 * @inputs void.
 * @outputs EditorView - a cast stub exposing only the dom property used by ImageView.
 * @dataflow A freshly created div is wrapped as an EditorView; nothing else on the view is touched.
 * @controlflow No branching; constructs and returns the stub.
 */
function fakeView(): EditorView {
  // The view is read only for its document, so a bare div-backed stub is sufficient.
  return ({ dom: document.createElement('div') } as unknown as EditorView);
}

/**
 * @purpose Resolves on the next macrotask so pending loader .then callbacks run before assertions.
 * @inputs void.
 * @outputs Promise<void> - settles after a zero-delay timeout.
 * @dataflow Nothing consumed; the setTimeout callback resolves the promise.
 * @controlflow No branching; returns the awaiting promise.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * @purpose Builds a manually-resolvable Promise<string | null> with captured resolve/reject handles.
 * @inputs void.
 * @outputs An object exposing the promise plus resolve and reject functions callable from the test.
 * @dataflow The executor captures its res/rej into outer lets initialised to no-ops, then hands them back.
 * @controlflow Initialise lets to no-ops -> capture real handlers in the executor -> return handles.
 */
function deferred(): { promise: Promise<string | null>; resolve: (value: string | null) => void; reject: (reason: Error) => void } {
  let resolve: (value: string | null) => void = (): void => undefined;
  let reject: (reason: Error) => void = (): void => undefined;
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  // Tear down every binding created during the run so pending loader promises and mounted DOM nodes do not leak into later tests.
  for (const binding of bindings.splice(0)) {
    binding.destroy();
  }
  // Detach every mount so a stale view cannot interfere with the next test.
  for (const mount of mounts.splice(0)) {
    mount.remove();
  }
});

describe('isDirectImageSource', () => {
  it('treats http/https/data/blob addresses as direct and local paths as needing a loader', async (): Promise<void> => {
    // Direct schemes are used as written; everything else must be resolved by the host loader.
    expect(isDirectImageSource('https://x/y.png')).toBe(true);
    expect(isDirectImageSource('HTTP://x')).toBe(true);
    expect(isDirectImageSource('data:image/png;base64,AA')).toBe(true);
    expect(isDirectImageSource('blob:abc')).toBe(true);
    expect(isDirectImageSource('  https://x ')).toBe(true);

    expect(isDirectImageSource('img/a.png')).toBe(false);
    expect(isDirectImageSource('C:/p/a.png')).toBe(false);
    expect(isDirectImageSource('/a.png')).toBe(false);
    expect(isDirectImageSource('')).toBe(false);
  });
});

describe('ImageView', () => {
  it('uses a web address as written without asking the loader', async (): Promise<void> => {
    // A direct source is set on the element immediately and never routed through the host.
    const asked: string[] = [];
    const view = new ImageView(image('https://x/y.png', 'Alt', 'Tip'), fakeView(), (src) => {
      asked.push(src);
      return Promise.resolve('blob:no');
    });

    expect(view.image.getAttribute('src')).toBe('https://x/y.png');
    expect(view.image.alt).toBe('Alt');
    expect(view.image.title).toBe('Tip');
    expect(asked).toEqual([]);
  });

  it('shows a loading state, then the URL the loader gives', async (): Promise<void> => {
    // A local address renders in the loading state until the loader resolves its source.
    const d = deferred();
    const view = new ImageView(image('img/a.png'), fakeView(), () => d.promise);

    expect(view.image.hasAttribute('src')).toBe(false);
    expect(view.image.classList.contains(IMAGE_LOADING_CLASS)).toBe(true);

    d.resolve('blob:loaded');
    await flush();

    expect(view.image.getAttribute('src')).toBe('blob:loaded');
    expect(view.image.classList.contains(IMAGE_LOADING_CLASS)).toBe(false);
  });

  it('uses the address as written when the loader returns null', async (): Promise<void> => {
    // A null result means "use as written" rather than applying a resolved URL.
    const view = new ImageView(image('img/a.png'), fakeView(), () => Promise.resolve(null));

    await flush();

    expect(view.image.getAttribute('src')).toBe('img/a.png');
  });

  it('marks an image the loader could not load', async (): Promise<void> => {
    // A rejected load leaves the missing state and records the failure reason rather than a source.
    const view = new ImageView(image('img/a.png'), fakeView(), () => Promise.reject(new Error('Cannot read img/a.png')));

    await flush();

    expect(view.image.classList.contains(IMAGE_MISSING_CLASS)).toBe(true);
    expect(view.image.classList.contains(IMAGE_LOADING_CLASS)).toBe(false);
    expect(view.image.getAttribute('data-kdoc-image-error')).toBe('Cannot read img/a.png');
    expect(view.image.hasAttribute('src')).toBe(false);
  });

  it('ignores an answer for a source it has since replaced', async (): Promise<void> => {
    // A newer generation supersedes the pending load, so only the latest answer is applied.
    const first = deferred();
    const second = deferred();
    let call = 0;
    const view = new ImageView(image('a.png'), fakeView(), () => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    });

    expect(view.update(image('b.png'))).toBe(true);
    second.resolve('blob:b');
    await flush();
    first.resolve('blob:a');
    await flush();

    expect(view.image.getAttribute('src')).toBe('blob:b');
  });

  it('ignores an answer that arrives after destroy', async (): Promise<void> => {
    // A destroyed view drops any late loader answer instead of mutating a detached element.
    const d = deferred();
    const view = new ImageView(image('img/a.png'), fakeView(), () => d.promise);

    view.destroy();
    d.resolve('blob:late');
    await flush();

    expect(view.image.hasAttribute('src')).toBe(false);
  });

  it('does not ask again when an update leaves the image unchanged', async (): Promise<void> => {
    // An unchanged node keeps its loaded picture rather than re-reading the file on every keystroke.
    let calls = 0;
    const view = new ImageView(image('a.png'), fakeView(), () => {
      calls += 1;
      return Promise.resolve('blob:x');
    });

    expect(view.update(image('a.png'))).toBe(true);
    expect(calls).toBe(1);
  });

  it('refuses to update to a different node type', async (): Promise<void> => {
    // A foreign node type cannot be shown in-place and must get its own view.
    const view = new ImageView(image('img/a.png'), fakeView(), () => Promise.resolve(null));

    expect(view.update(kdocSchema.text('x'))).toBe(false);
  });

  it('drops the title when the image loses it', async (): Promise<void> => {
    // A render with an empty title clears any stale title left by a previous render.
    const view = new ImageView(image('https://x/a.png', '', 'Tip'), fakeView(), () => Promise.resolve(null));

    view.update(image('https://x/a.png', '', ''));

    expect(view.image.hasAttribute('title')).toBe(false);
  });

  it('shows nothing for an empty address', async (): Promise<void> => {
    // With no written address the element stays blank and never enters a loading state.
    const view = new ImageView(image(''), fakeView(), () => Promise.resolve('blob:x'));

    expect(view.image.hasAttribute('src')).toBe(false);
    expect(view.image.classList.contains(IMAGE_LOADING_CLASS)).toBe(false);
  });

  it('reports its own mutations as not document changes', async (): Promise<void> => {
    // The view sets src and classes itself, so ProseMirror should not treat those as edits.
    expect(new ImageView(image(''), fakeView(), () => Promise.resolve(null)).ignoreMutation()).toBe(true);
  });

  it('createImageNodeView builds an ImageView', async (): Promise<void> => {
    // The factory returns a constructor that produces an ImageView for each node.
    const make = createImageNodeView(() => Promise.resolve(null));

    expect(make(image('https://x/a.png'), fakeView(), () => 0, [] as never, undefined as never)).toBeInstanceOf(ImageView);
  });
});

describe('ProseMirrorBinding loadImage option', () => {
  it('draws images through the loader when one is given', async (): Promise<void> => {
    // A supplied loader resolves local image addresses to a webview-loadable URL on the element.
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    mounts.push(mount);
    const asked: string[] = [];
    const binding = new ProseMirrorBinding({ session: new DocumentSession('![a](img/a.png)\n'), mount, loadImage: (src) => {
      asked.push(src);
      return Promise.resolve('blob:bound');
    } });
    bindings.push(binding);

    await flush();

    expect(asked).toEqual(['img/a.png']);
    expect(mount.querySelector('img')?.getAttribute('src')).toBe('blob:bound');
  });

  it('uses the address as written without a loader', async (): Promise<void> => {
    // Without a loader the image keeps its written address rather than entering a loading state.
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    mounts.push(mount);
    const binding = new ProseMirrorBinding({ session: new DocumentSession('![a](img/a.png)\n'), mount });
    bindings.push(binding);

    await flush();

    expect(mount.querySelector('img')?.getAttribute('src')).toBe('img/a.png');
  });
});
