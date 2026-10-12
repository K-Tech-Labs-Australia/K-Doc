/**
 * @file image-view.ts
 * @purpose ProseMirror NodeView that renders an image node through a host-supplied source loader (FR-8.15), wrapping it in a frame with a resize handle and a caption.
 * @inputs image nodes, the outer EditorView, an optional getPos accessor, and a loader resolving local addresses to webview-loadable URLs.
 * @outputs An HTMLSpanElement-backed ImageView containing an inner <img>, a resize handle, and a caption; its constructor factory; styling and selection constants.
 * @functions
 *   - ImageView: the node view that shows an image through the host loader, framed and resizable.
 *   - createImageNodeView: factory producing the node view constructor for a given loader.
 *   - selectNode / deselectNode: toggle the selection highlight on the framed image.
 * @exports IMAGE_SELECTED_CLASS, MIN_IMAGE_WIDTH, IMAGE_VIEW_STYLES (new in FR-8.15); IMAGE_LOADING_CLASS, IMAGE_MISSING_CLASS, ImageSourceLoader (unchanged).
 * @dataflow Node attrs -> loader -> resolved URL (or written address) set on <img>; width/caption attrs -> frame style and caption text; drag end -> node markup update.
 * @controlflow Construct -> render -> async resolve -> update keeps unchanged images; resize commits one undo step; destroy cancels pending loads.
 * @version 2
 * @date 2026-09-16
 */
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';

/** Resolves an image's written address to a URL the webview can load, or null to use the address as written. Rejects when the image cannot be loaded. */
export type ImageSourceLoader = (src: string) => Promise<string | null>;

/** Class set on an image while its source is being loaded. */
export const IMAGE_LOADING_CLASS = 'kdoc-image-loading';
/** Class set on an image whose source could not be loaded. */
export const IMAGE_MISSING_CLASS = 'kdoc-image-missing';
/** Class set on the outer span when the image node is selected, driving the outline and handle visibility in CSS. */
export const IMAGE_SELECTED_CLASS = 'kdoc-image-selected';
/** Minimum grabbable width in pixels; a drag cannot shrink an image below this so it stays catchable again. */
export const MIN_IMAGE_WIDTH = 16;

/** Styles for the framed, resizable image node view (FR-8.15). Injected by the host into the editor's document head. */
export const IMAGE_VIEW_STYLES: string = `
.kdoc-image { display: inline-block; max-width: 100%; vertical-align: bottom; }
.kdoc-image-frame { display: block; position: relative; max-width: 100%; }
.kdoc-image-frame > img { display: block; max-width: 100%; height: auto; }
.kdoc-image-caption { display: block; padding-top: 4px; font-size: 0.85em; text-align: center; color: var(--kdoc-color-text-muted); }
.kdoc-image-caption[hidden] { display: none; }
.kdoc-image-selected .kdoc-image-frame > img { outline: 2px solid var(--kdoc-color-accent); outline-offset: 2px; }
.kdoc-image-resize-handle { display: none; position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; box-sizing: border-box; border: 2px solid var(--kdoc-color-background); border-radius: 2px; background: var(--kdoc-color-accent); cursor: nwse-resize; touch-action: none; }
.kdoc-image-selected .kdoc-image-resize-handle { display: block; }
`;

/**
 * @purpose True when a written address already names something the webview can fetch directly.
 * @inputs src - the image's written address as stored in node attrs.
 * @outputs boolean.
 * @dataflow The trimmed address matched against the http/https/data/blob schemes -> boolean.
 * @controlflow Trim and test; a match means use it as written, otherwise resolve it through the loader.
 *
 * These schemes already name something the webview can fetch, so they are used as written rather than resolved by the
 * host. Anything else (a local path) is left for the loader to turn into a loadable URL.
 */
export function isDirectImageSource(src: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(src.trim());
}

export class ImageView implements NodeView {
  readonly dom: HTMLSpanElement; // span.kdoc-image, the node view root and selection target
  readonly image: HTMLImageElement; // the picture, inside frame
  private readonly frame: HTMLSpanElement; // span.kdoc-image-frame, wraps image and handle
  private readonly handle: HTMLSpanElement; // span.kdoc-image-resize-handle, non-editable grab target
  private readonly caption: HTMLSpanElement; // span.kdoc-image-caption, non-editable CommonMark title
  private node: PMNode;
  private readonly loader: ImageSourceLoader;
  private readonly view: EditorView;
  private readonly getPos: (() => number | undefined) | undefined;
  // Bumped on every new source so a slow answer for an earlier source is ignored in the handlers below.
  private generation = 0;
  // Set true on destroy so a late loader answer is dropped rather than applied to a detached view.
  private destroyed = false;
  // Active drag geometry, or null when no resize is in progress.
  private drag: { readonly startX: number; readonly startWidth: number; readonly maxWidth: number; width: number } | null = null;

  /**
   * @purpose Build the frame, handle, caption and image from the editor's document, wire the resize gestures, and render the initial node.
   * @inputs node - the image node to show; view - the outer EditorView (for its document and state); loader - resolves local addresses; getPos - optional position accessor for committing resizes.
   * @outputs void.
   * @dataflow The constructor arguments are stored on the instance, DOM subtrees are assembled, then node attrs drive the first render onto image and applyFrame onto the frame.
   * @controlflow Store fields -> create elements -> assemble subtree -> attach gesture listeners -> render once -> apply initial frame; no branching.
   */
  constructor(node: PMNode, view: EditorView, loader: ImageSourceLoader, getPos?: () => number | undefined) {
    this.node = node;
    this.loader = loader;
    this.view = view;
    this.getPos = getPos;
    const doc = view.dom.ownerDocument;
    // The outer span is the node view's dom and carries the selection class.
    this.dom = doc.createElement('span');
    this.dom.classList.add('kdoc-image');
    // The frame wraps the picture and handle, keeping them together and positioned for the handle.
    this.frame = doc.createElement('span');
    this.frame.classList.add('kdoc-image-frame');
    // The image is the actual picture, rendered through the loader as before.
    this.image = doc.createElement('img');
    // The resize handle is a non-editable grab target at the frame's bottom-right corner.
    this.handle = doc.createElement('span');
    this.handle.classList.add('kdoc-image-resize-handle');
    this.handle.setAttribute('contenteditable', 'false');
    // The caption shows the CommonMark title under the picture and is itself non-editable.
    this.caption = doc.createElement('span');
    this.caption.classList.add('kdoc-image-caption');
    this.caption.setAttribute('contenteditable', 'false');
    // The handle sits on top of the image inside the frame; the caption follows below it.
    this.frame.append(this.image, this.handle);
    this.dom.append(this.frame, this.caption);
    // Pointer gestures on the handle drive the resize drag sequence.
    this.handle.addEventListener('pointerdown', (event) => this.startResize(event));
    this.handle.addEventListener('pointermove', (event) => this.moveResize(event));
    this.handle.addEventListener('pointerup', () => this.endResize());
    this.handle.addEventListener('pointercancel', () => this.cancelResize());
    // Render immediately so a freshly inserted image shows content without waiting for update().
    this.render(node);
    // Apply the initial frame width and caption from the node's attributes.
    this.applyFrame(node);
  }

  /**
   * @purpose Read one of the image's text attributes, coercing missing or non-string values to empty.
   * @inputs node - the node whose attr is read; name - which attribute ('src', 'alt' or 'title').
   * @outputs The string value, or '' when absent or not a string.
   * @dataflow node.attrs[name] (unknown) -> narrowed by typeof -> string return.
   * @controlflow Read into unknown; if it is a string return it, else fall back to empty.
   */
  private attr(node: PMNode, name: 'src' | 'alt' | 'title'): string {
    const value: unknown = node.attrs[name];
    if (typeof value === 'string') {
      return value;
    } else {
      // The attribute is absent or not a string, so fall back to empty.
      return '';
    }
  }

  /**
   * @purpose Read the image's explicit pixel width from its node attributes, if present and numeric.
   * @inputs node - the node whose 'width' attr is read.
   * @outputs The numeric width in pixels, or null when absent or not a number.
   * @dataflow node.attrs['width'] (unknown) -> narrowed by typeof -> number | null.
   * @controlflow Read into unknown; if it is a number return it, else fall back to null.
   */
  private widthOf(node: PMNode): number | null {
    const value: unknown = node.attrs['width'];
    if (typeof value === 'number') {
      return value;
    } else {
      // The width attr is absent or not a number, so treat the image as un-sized.
      return null;
    }
  }

  /**
   * @purpose Apply the current node's attributes and source resolution onto the image element inside the frame.
   * @inputs node - the node whose attributes drive this render.
   * @outputs void; mutates image (alt/title/src/classes/data attribute) and kicks off an async loader call for local sources.
   * @dataflow Node attrs -> text attributes set directly; source address -> direct use or host loader -> resolved URL on image.
   * @controlflow Sync alt/title, clear prior states, bump generation, then branch: empty/direct/local source handling.
   *
   * The title is also kept on the <img> as a browser tooltip while render handles it here; applyFrame mirrors that same
   * title into the caption below the picture.
   */
  private render(node: PMNode): void {
    const src = this.attr(node, 'src');
    const alt = this.attr(node, 'alt');
    const title = this.attr(node, 'title');
    // Alt and title are plain text attributes; set them directly on the image element.
    this.image.alt = alt;
    if (title !== '') {
      // A title is present, so keep it as the image's tooltip.
      this.image.title = title;
    } else {
      // No title on this node, so clear any stale one left by a previous render.
      this.image.removeAttribute('title');
    }
    // Start each render clean: drop the loading and error states carried over from before.
    this.image.classList.remove(IMAGE_LOADING_CLASS, IMAGE_MISSING_CLASS);
    this.image.removeAttribute('data-kdoc-image-error');
    // Advance the generation so a late answer for an earlier source is ignored in the handlers below.
    this.generation += 1;
    const generation = this.generation;
    if (src === '') {
      // No address written, so show nothing rather than attempt to load an empty source.
      this.image.removeAttribute('src');
      return;
    } else if (isDirectImageSource(src)) {
      // The address already names something the webview can fetch, so use it as written.
      this.image.src = src;
      return;
    } else {
      // A local address: ask the host to resolve it while showing a loading state.
      this.image.removeAttribute('src');
      this.image.classList.add(IMAGE_LOADING_CLASS);
      void this.loader(src).then(
        (url) => {
          if (this.destroyed || generation !== this.generation) {
            // The view went away or a newer source superseded this one, so ignore the answer.
            return;
          } else {
            // This load is still current, so clear the loading state and apply the result.
            this.image.classList.remove(IMAGE_LOADING_CLASS);
            // A null result means "use as written"; any other value is the resolved URL.
            this.image.src = url === null ? src : url;
          }
        },
        (caught: unknown) => {
          if (this.destroyed || generation !== this.generation) {
            // The view went away or a newer source superseded this one, so ignore the failure.
            return;
          } else {
            // This load is still current but failed, so mark it missing with the reason.
            this.image.classList.remove(IMAGE_LOADING_CLASS);
            this.image.classList.add(IMAGE_MISSING_CLASS);
            // Use the error message when available, otherwise stringify any non-Error throw value.
            this.image.setAttribute('data-kdoc-image-error', caught instanceof Error ? caught.message : String(caught));
          }
        },
      );
    }
  }

  /**
   * @purpose Reflect the node's width and caption onto the frame without touching the picture source.
   * @inputs node - the node whose width and title drive the frame styling and caption text.
   * @outputs void; mutates the image style and caption element.
   * @dataflow Node width attr -> inline width on the image; title attr -> caption text and hidden state.
   * @controlflow Apply width when present else clear it, then set caption text and its hidden flag from the title.
   *
   * The caption is the CommonMark title shown under the picture; the same title also stays on the <img> as a tooltip (set in render).
   */
  private applyFrame(node: PMNode): void {
    const width = this.widthOf(node);
    if (width !== null) {
      // A width is specified, so pin the image to that many pixels.
      this.image.style.width = `${width}px`;
    } else {
      // No width specified, so let the image size itself naturally by clearing any inline width.
      this.image.style.removeProperty('width');
    }
    const title = this.attr(node, 'title');
    // The caption shows the CommonMark title under the picture; an empty title hides it.
    this.caption.textContent = title;
    this.caption.hidden = title === '';
  }

  /**
   * @purpose Update the view in place when the node is unchanged, or reload it when a visible attribute changed.
   * @inputs node - the new node ProseMirror offers for this view.
   * @outputs True to signal the update was handled; false only when the node type changed (needs its own view).
   * @dataflow New node attrs compared against held node's attrs -> unchanged keeps loaded picture, changed triggers render; width/caption always re-applied via applyFrame.
   * @controlflow Different type -> false; else store node and re-render only when src/alt/title differ, then applyFrame in both branches.
   *
   * An unchanged image keeps its loaded picture rather than reading the file again on every keystroke elsewhere.
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      // A different node type needs its own view rather than an in-place update.
      return false;
    } else {
      const src = this.attr(node, 'src');
      const alt = this.attr(node, 'alt');
      const title = this.attr(node, 'title');
      // Compare against the node already held so a re-render only happens on real change.
      const same = this.attr(this.node, 'src') === src && this.attr(this.node, 'alt') === alt && this.attr(this.node, 'title') === title;
      this.node = node;
      if (!same) {
        // Something changed, so reload the source through the loader.
        this.render(node);
      } else {
        // Nothing visible changed: keep the loaded picture instead of reading the file again on every keystroke elsewhere.
      }
      // A width or caption change shows without reloading the picture by re-applying the frame in both branches.
      this.applyFrame(node);
      return true;
    }
  }

  /**
   * @purpose Highlight the framed image to indicate it is the current selection.
   * @inputs none.
   * @outputs void; toggles the selected class on the outer span.
   * @dataflow nothing consumed; a single class addition drives the CSS outline and handle visibility.
   * @controlflow No branching; always adds the class.
   */
  selectNode(): void {
    this.dom.classList.add(IMAGE_SELECTED_CLASS);
  }

  /**
   * @purpose Remove the selection highlight when the image is no longer selected.
   * @inputs none.
   * @outputs void; toggles the selected class off the outer span.
   * @dataflow nothing consumed; a single class removal restores the default appearance.
   * @controlflow No branching; always removes the class.
   */
  deselectNode(): void {
    this.dom.classList.remove(IMAGE_SELECTED_CLASS);
  }

  /**
   * @purpose Begin dragging the resize handle, capturing pointer movement and clamping the target width.
   * @inputs event - the pointer-down event that started the drag.
   * @outputs void; records the initial geometry in this.drag for moveResize/endResize to consume.
   * @dataflow The image's current rendered width and the container's clientWidth become the clamp bounds for subsequent moves.
   * @controlflow Prevent default, read start geometry into a drag record, then acquire pointer capture when available.
   */
  private startResize(event: PointerEvent): void {
    // Take the pointer so moves are tracked even if they leave the handle, and stop them from triggering editor selection.
    event.preventDefault();
    event.stopPropagation();
    // Start from the image's current on-screen width, falling back to its intrinsic size then the grab threshold.
    const startWidth = this.image.getBoundingClientRect().width || this.image.naturalWidth || MIN_IMAGE_WIDTH;
    // The drag cannot exceed the block that holds the image; an absent or zero-width container means unbounded.
    const container = this.dom.parentElement;
    const maxWidth = container !== null && container.clientWidth > 0 ? container.clientWidth : Number.POSITIVE_INFINITY;
    // Record the drag start so moves compute a delta from a stable baseline.
    this.drag = { startX: event.clientX, startWidth, maxWidth, width: Math.round(startWidth) };
    if (typeof this.handle.setPointerCapture === 'function') {
      // Pointer capture is available, so route all pointer events to the handle for the duration of the drag.
      this.handle.setPointerCapture(event.pointerId);
    } else {
      // jsdom and other environments lack pointer capture; move/end/cancel still fire on the handle without it.
    }
  }

  /**
   * @purpose Update the image width as the pointer moves during an active drag.
   * @inputs event - the pointer-move event carrying the current x position.
   * @outputs void; mutates this.drag.width and applies it to the image style.
   * @dataflow The delta from the drag start x added to the start width, clamped to [MIN_IMAGE_WIDTH, maxWidth], becomes the new width.
   * @controlflow Return early when no drag is active, else compute the clamped width and apply it.
   */
  private moveResize(event: PointerEvent): void {
    const drag = this.drag;
    // No active drag (e.g. a stray pointer-move), so ignore the event.
    if (drag === null) {
      return;
    } else {
      // Compute the new width from the pointer delta, clamped between the grab threshold and the container width.
      const width = Math.round(Math.min(drag.maxWidth, Math.max(MIN_IMAGE_WIDTH, drag.startWidth + event.clientX - drag.startX)));
      // Record the rounded width and apply it live so the image follows the pointer before the drag commits.
      drag.width = width;
      this.image.style.width = `${width}px`;
    }
  }

  /**
   * @purpose Commit a completed drag as a single document edit, leaving the image selected.
   * @inputs none.
   * @outputs void; dispatches a transaction that sets the width attr when it actually changed.
   * @dataflow The final dragged width is compared to the node's stored width; only on change is a markup update dispatched.
   * @controlflow Bail without a drag, then bail if the position or node is invalid; commit only when the width differs.
   *
   * The width is written only when a drag ends, so an image the user never resized keeps its Markdown unchanged;
   * the resize is one undo step and the transaction re-selects the image via NodeSelection.
   */
  private endResize(): void {
    const drag = this.drag;
    // No active drag (e.g. a stray pointer-up), so nothing to commit.
    if (drag === null) {
      return;
    } else {
      // The drag is over, so stop tracking it before applying the frame for the final geometry.
      this.drag = null;
    }
    // Resolve the node position; without one we can only re-apply the held node's frame.
    const pos = this.getPos === undefined ? undefined : this.getPos();
    if (pos === undefined) {
      // No stable position available, so just reflect the current node in the frame.
      this.applyFrame(this.node);
      return;
    } else {
      // The position is known, so continue toward a possible document edit below.
    }
    const current = this.view.state.doc.nodeAt(pos);
    if (current === null || current.type !== this.node.type) {
      // The node at the position vanished or changed type, so fall back to the held node's frame.
      this.applyFrame(this.node);
      return;
    } else {
      // The expected node is still present, so compare widths and commit a change only if they differ.
    }
    if (this.widthOf(current) === drag.width) {
      // The width already matches the node's stored width, so there is nothing to write back.
      return;
    } else {
      // The width changed, so record it on the node as a single structural transaction that keeps the image selected.
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: drag.width });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      tr.setMeta('kdocStructural', true);
      this.view.dispatch(tr);
    }
  }

  /**
   * @purpose Abandon an in-progress drag without committing a width change.
   * @inputs none.
   * @outputs void; discards the drag record and restores the frame from the held node.
   * @dataflow nothing consumed; this.node drives a fresh applyFrame after the drag is cleared.
   * @controlflow Clear the drag, then re-apply the current node's frame so no partial width remains.
   */
  private cancelResize(): void {
    // Stop tracking the drag before restoring the frame so no partial width survives.
    this.drag = null;
    this.applyFrame(this.node);
  }

  /**
   * @purpose Let ProseMirror leave pointer and editing events that originate on the handle to the handle itself.
   * @inputs event - a DOM event ProseMirror is about to process through NodeView.stopEvent.
   * @outputs True when the event target is inside the resize handle, false otherwise.
   * @dataflow The event's target is tested against the handle subtree -> boolean gate.
   * @controlflow No branching; a single containment test yields the result.
   */
  stopEvent(event: Event): boolean {
    // Only events that actually start on the handle are left to it; everything else falls through to ProseMirror.
    return event.target instanceof Node && this.handle.contains(event.target);
  }

  /**
   * @purpose Flag the view destroyed so any pending loader answer is ignored by render's handlers.
   * @inputs none.
   * @outputs void.
   * @dataflow nothing consumed; sets the destroyed flag read in the async completion branches.
   * @controlflow Set flag; no branching.
   */
  destroy(): void {
    // Mark destroyed so a late loader answer is ignored in render's .then handlers.
    this.destroyed = true;
  }

  /**
   * @purpose Decline to intercept DOM mutations, since the view sets src and classes itself.
   * @inputs none.
   * @outputs True, telling ProseMirror these are the view's own changes, not document edits.
   * @dataflow nothing consumed; constant result.
   * @controlflow No branching; always true.
   */
  ignoreMutation(): boolean {
    // The view sets src and classes itself; those are not document changes to intercept.
    return true;
  }
}

/**
 * @purpose Factory producing a ProseMirror NodeView constructor that renders images through the given loader (FR-8.15).
 * @inputs loader - resolves an image's written address to a URL the webview can load, or null to use it as written.
 * @outputs A NodeViewConstructor bound to the supplied loader.
 * @dataflow The captured loader is closed over and handed to each ImageView constructed by the returned factory.
 * @controlflow Return a constructor; the loader is fixed when the factory is built, not per node.
 */
export function createImageNodeView(loader: ImageSourceLoader): NodeViewConstructor {
  return (node: PMNode, view: EditorView, getPos?: () => number | undefined): NodeView => new ImageView(node, view, loader, getPos);
}
