/**
 * @file media-view.ts
 * @purpose ProseMirror NodeView that renders a video or audio node through a host-supplied source loader (FR-8.17), wrapping it in an inline player, a provider embed card, or a missing-file message.
 * @inputs media nodes, the outer EditorView, and a loader resolving local addresses to webview-loadable URLs.
 * @outputs An HTMLDivElement-backed MediaView containing either a <video>/<audio> player, a provider play-card with an iframe swap-in, or a failure message; its constructor factory; styling constants.
 * @exports MEDIA_VIEW_STYLES (new in FR-8.17); MEDIA_LOADING_CLASS, MEDIA_MISSING_CLASS, MediaSourceLoader (unchanged).
 * @functions
 *   - MediaView: the node view that shows media through the host loader as a player or provider card.
 *   - createMediaNodeView: factory producing the node view constructor for a given loader.
 * @dataflow Node attrs -> inline <video>/<audio> with src set from resolved URL (or written target); provider attr -> deferred play-card; iframe embedUrl -> lazy-loaded frame on press; load failure -> missing message span.
 * @controlflow Construct -> render -> async resolve -> update keeps unchanged players; stopEvent/ignoreMutation shield the player DOM; destroy drops pending loads.
 * @version 1
 * @date 2026-09-18
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';

/** Resolves a media reference's written address to a URL the webview can play, or null to use the address as written. */
export type MediaSourceLoader = (src: string) => Promise<string | null>;

/** Class set on a media node view while its file is still being read. */
export const MEDIA_LOADING_CLASS: string = 'kdoc-media-loading';
/** Class set on a media node view whose file could not be read. */
export const MEDIA_MISSING_CLASS: string = 'kdoc-media-missing';

/** Styles for the inline player, provider card and iframe frame of the media node view (FR-8.17). Injected by the host into the editor's document head. */
export const MEDIA_VIEW_STYLES: string = `
.kdoc-media { display: block; margin: 1em 0; }
.kdoc-media-player { max-width: 100%; }
.kdoc-media-frame { width: 100%; aspect-ratio: 16 / 9; border: 0; }
.kdoc-media-card { display: flex; align-items: center; gap: 0.75em; padding: 0.75em; border: 1px solid var(--kdoc-color-border); border-radius: 6px; }
.kdoc-media-title { font-weight: 600; } .kdoc-media-address { color: var(--kdoc-color-text-muted); font-size: 0.85em; overflow-wrap: anywhere; }
.kdoc-media-loading { opacity: 0.6; } .kdoc-media-missing .kdoc-media-message { color: var(--kdoc-color-danger); }
`;

/**
 * @purpose Build the node view root from the editor's document, mark it a non-editable atom, and render the initial node.
 * @inputs node - the media node to show; view - the outer EditorView (for its ownerDocument); loader - resolves local addresses to playable URLs.
 * @outputs void.
 * @dataflow The constructor arguments are stored on the instance, the root div is assembled as a non-editable atom, then node attrs drive the first render onto the player or card.
 * @controlflow Store fields -> create and configure root element -> initialize state flags -> render once; no branching.
 */
export class MediaView implements NodeView {
  readonly dom: HTMLElement; // div.kdoc-media, the non-editable node view root that holds the player, card or message
  private node: PMNode;
  private readonly loader: MediaSourceLoader;
  private readonly doc: Document;
  // Bumped on every render so a slow answer for an earlier source is dropped in the handlers below.
  private token: number;
  // Set true on destroy so a late loader answer is ignored rather than applied to a detached view.
  private destroyed: boolean;

  /**
   * @purpose Build the node view's root element and render the node it was given.
   * @inputs node - the media node to show. view - the editor view, for its document. loader - resolves a written address to a URL the webview can play.
   * @outputs A MediaView whose dom is ready to be placed in the document.
   * @dataflow view.dom.ownerDocument -> the root div -> render(node).
   * @controlflow Assemble the root once, mark it uneditable because the node is an atom, then render.
   */
  constructor(node: PMNode, view: EditorView, loader: MediaSourceLoader) {
    this.node = node;
    this.loader = loader;
    this.doc = view.dom.ownerDocument;
    this.token = 0;
    this.destroyed = false;
    this.dom = this.doc.createElement('div');
    this.dom.classList.add('kdoc-media');
    // The node is an atom: a caret inside the player would be a caret in something the reader cannot type into.
    this.dom.setAttribute('contenteditable', 'false');
    this.render(node);
  }

  /**
   * @purpose Read one of the media node's text attributes, coercing missing or non-string values to empty.
   * @inputs node - the node whose attr is read; name - which attribute ('kind', 'target', 'label', 'provider' or 'embedUrl').
   * @outputs The string value, or '' when absent or not a string.
   * @dataflow node.attrs[name] (unknown) -> narrowed by typeof -> string return.
   * @controlflow Read into unknown; if it is a string return it, else fall back to empty.
   */
  private attr(node: PMNode, name: 'kind' | 'target' | 'label' | 'provider' | 'embedUrl'): string {
    const value: unknown = node.attrs[name];
    if (typeof value === 'string') {
      return value;
    } else {
      // The attribute is absent or not a string, so fall back to empty.
      return '';
    }
  }

  /**
   * @purpose Render the current node's attributes and source resolution onto the root element as an inline player (or defer a provider embed).
   * @inputs node - the node whose attributes drive this render.
   * @outputs void; mutates dom, builds a <video>/<audio> player or a play-card, and kicks off an async loader call for local sources.
   * @dataflow Node attrs -> inline element with src set from resolved URL (or written target); provider attr -> deferred card; load failure -> missing message span.
   * @controlflow Bump token, clear the root, drop prior states, then branch: provider embed returns early else build and resolve a player.
   *
   * The token advances on every render so that a slow loader answer for an earlier source is ignored in the completion handlers below.
   */
  private render(node: PMNode): void {
    this.node = node;
    // Advance the token so a late answer for an earlier source is dropped by the completion handlers below.
    this.token += 1;
    const token = this.token;
    // Start from a clean element so no stale player or card survives into the new render.
    while (this.dom.firstChild !== null) {
      this.dom.removeChild(this.dom.firstChild);
    }
    // Drop any loading/error state carried over from a previous render of this node.
    this.dom.classList.remove(MEDIA_LOADING_CLASS, MEDIA_MISSING_CLASS);
    const kind = this.attr(node, 'kind');
    const provider = this.attr(node, 'provider');
    if (provider !== '') {
      // A named provider means an external embed; defer fetching until the reader asks by showing a play-card.
      this.renderProvider(node);
      return;
    } else {
      // No provider on this node, so fall through and build an inline player for the file below.
    }
    const target = this.attr(node, 'target');
    // Anything that is not audio is played in a video element, which also shows a poster frame.
    const player = this.doc.createElement(kind === 'audio' ? 'audio' : 'video');
    player.setAttribute('controls', '');
    player.classList.add('kdoc-media-player');
    const label = this.attr(node, 'label');
    // A label is what a reader sees while the file loads and what a screen reader announces.
    if (label !== '') {
      // A label is present, so announce it to assistive technology while the file loads.
      player.setAttribute('aria-label', label);
    } else {
      // No label on this node, so leave the element without an explicit accessible name.
    }
    this.dom.append(player);
    // Show a loading state until the source resolves or fails to load.
    this.dom.classList.add(MEDIA_LOADING_CLASS);
    void this.loader(target).then(
      (url) => {
        if (this.destroyed || token !== this.token) {
          // The view went away or a newer render superseded this one, so ignore the answer.
          return;
        } else {
          // This load is still current, so clear the loading state and apply the result below.
          this.dom.classList.remove(MEDIA_LOADING_CLASS);
          if (typeof url === 'string' && url !== '') {
            // The loader returned a resolved URL, so play it directly.
            player.src = url;
          } else {
            // The loader returned null or an empty string ("use as written"), so fall back to the written target.
            player.src = target;
          }
        }
      },
      () => {
        if (this.destroyed || token !== this.token) {
          // The view went away or a newer render superseded this one, so ignore the failure.
          return;
        } else {
          // This load is still current but failed, so mark it missing with a message below.
          this.dom.classList.remove(MEDIA_LOADING_CLASS);
          this.dom.classList.add(MEDIA_MISSING_CLASS);
          const message = this.doc.createElement('span');
          message.classList.add('kdoc-media-message');
          message.textContent = `Cannot play ${target}`;
          this.dom.append(message);
        }
      },
    );
  }

  /**
   * @purpose Show a deferred card for an external provider embed, swapping in the player only when the reader presses Play.
   * @inputs node - the provider node whose attributes drive the card title, address and play action.
   * @outputs void; mutates dom to hold a non-editable play-card with no fetched media yet.
   * @dataflow Node label/provider attrs -> card heading text; target attr -> card address string; press -> showProviderPlayer swaps in an iframe player.
   * @controlflow No branching; assemble title, address and button elements then append them to the root.
   *
   * Nothing is fetched from the provider until the reader asks: a card with a button, and only a press swaps in the player. An editor that quietly asked YouTube for a video every time a document opened would be telling the provider what its reader is reading.
   */
  private renderProvider(node: PMNode): void {
    const card = this.doc.createElement('div');
    card.classList.add('kdoc-media-card');
    const label = this.attr(node, 'label');
    const provider = this.attr(node, 'provider');
    const title = this.doc.createElement('span');
    title.classList.add('kdoc-media-title');
    // A missing label falls back to the provider name so the card always has a readable heading.
    title.textContent = label === '' ? provider : label;
    const address = this.doc.createElement('span');
    address.classList.add('kdoc-media-address');
    address.textContent = this.attr(node, 'target');
    const play = this.doc.createElement('button');
    play.type = 'button';
    play.classList.add('kdoc-media-play');
    play.textContent = 'Play';
    // Only when the reader presses Play do we ask the provider for a playable URL.
    play.addEventListener('click', (): void => {
      this.showProviderPlayer(node);
    });
    card.append(title, address, play);
    this.dom.append(card);
  }

  /**
   * @purpose Replace the deferred play-card with an inline iframe player loaded from the node's embed URL.
   * @inputs node - the provider node whose 'embedUrl' and label/provider attributes drive the frame.
   * @outputs void; mutates dom to hold a lazy-loaded, fullscreen-capable <iframe> playing the embedded media.
   * @dataflow Node embedUrl attr -> iframe src; label/provider attrs -> accessible title; empty url -> no swap performed.
   * @controlflow Bail when there is nowhere to play from, else clear the root and append the frame below.
   */
  private showProviderPlayer(node: PMNode): void {
    const embedUrl = this.attr(node, 'embedUrl');
    if (embedUrl === '') {
      // No embed URL is available for this node, so there is nothing to swap in.
      return;
    } else {
      // An embed URL exists, so replace the card with an inline player below.
    }
    const label = this.attr(node, 'label');
    const provider = this.attr(node, 'provider');
    // Start from a clean element so the card is replaced rather than stacked on top of it.
    while (this.dom.firstChild !== null) {
      this.dom.removeChild(this.dom.firstChild);
    }
    const frame = this.doc.createElement('iframe');
    frame.setAttribute('src', embedUrl);
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('loading', 'lazy');
    // A missing label falls back to the provider name so the iframe always has an accessible title.
    frame.setAttribute('title', label === '' ? provider : label);
    frame.classList.add('kdoc-media-frame');
    this.dom.append(frame);
  }

  /**
   * @purpose Update the view in place when the node is unchanged, or reload it when a visible attribute changed.
   * @inputs node - the new node ProseMirror offers for this view.
   * @outputs True to signal the update was handled; false only when the node type changed (needs its own view).
   * @dataflow New node attrs compared against held node's attrs -> unchanged keeps the loaded player, changed triggers render.
   * @controlflow Different type -> false; else store node and re-render only when kind/target/label/embedUrl differ, then return true in both branches.
   *
   * An unchanged media keeps its loaded player rather than reading the file again on every keystroke elsewhere.
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      // A different node type needs its own view rather than an in-place update.
      return false;
    } else {
      const kind = this.attr(node, 'kind');
      const target = this.attr(node, 'target');
      const label = this.attr(node, 'label');
      const embedUrl = this.attr(node, 'embedUrl');
      // Compare against the node already held so a re-render only happens on real change.
      const same = this.attr(this.node, 'kind') === kind && this.attr(this.node, 'target') === target && this.attr(this.node, 'label') === label && this.attr(this.node, 'embedUrl') === embedUrl;
      this.node = node;
      if (!same) {
        // Something changed, so reload the source through the loader.
        this.render(node);
      } else {
        // Nothing visible changed: keep the loaded player instead of reading the file again on every keystroke elsewhere.
      }
      return true;
    }
  }

  /**
   * @purpose Let ProseMirror leave every DOM event that originates inside the player to the player itself.
   * @inputs none.
   * @outputs True, telling ProseMirror all presses belong to the player rather than the editor.
   * @dataflow nothing consumed; constant result.
   * @controlflow No branching; always true.
   */
  stopEvent(): boolean {
    // Every press inside the player belongs to the player, not to the editor.
    return true;
  }

  /**
   * @purpose Flag the view destroyed so any pending loader answer is ignored by render's completion handlers.
   * @inputs none.
   * @outputs void.
   * @dataflow nothing consumed; sets the destroyed flag read in the async completion branches.
   * @controlflow Set flag; no branching.
   */
  ignoreMutation(): boolean {
    // The view builds its own DOM and changes it as the file loads; ProseMirror must not read that as an edit.
    return true;
  }

  /**
   * @purpose Flag the view destroyed so any pending loader answer is ignored by render's completion handlers.
   * @inputs none.
   * @outputs void.
   * @dataflow nothing consumed; sets the destroyed flag read in the async completion branches.
   * @controlflow Set flag; no branching.
   */
  destroy(): void {
    // Mark destroyed so a late loader answer is ignored in render's .then handlers.
    this.destroyed = true;
  }
}

/**
 * @purpose Factory producing a ProseMirror NodeView constructor that renders media through the given loader (FR-8.17).
 * @inputs loader - resolves a media reference's written address to a URL the webview can play, or null to use it as written.
 * @outputs A NodeViewConstructor bound to the supplied loader.
 * @dataflow The captured loader is closed over and handed to each MediaView constructed by the returned factory.
 * @controlflow Return a constructor; the loader is fixed when the factory is built, not per node.
 */
export function createMediaNodeView(loader: MediaSourceLoader): NodeViewConstructor {
  return (node: PMNode, view: EditorView): NodeView => new MediaView(node, view, loader);
}
