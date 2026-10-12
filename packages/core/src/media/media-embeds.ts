/**
 * @file media-embeds.ts
 * @purpose Media embed recognition for FR-8.17: recognise the video and audio a document refers to without inventing any Markdown syntax, since K-Doc recognises what is already written rather than adding new markup.
 * @inputs An mdast Root tree (or a single Paragraph) produced by parsing; links and images whose url names a media file or points at a provider site K-Doc knows how to play.
 * @outputs MediaEmbed descriptions of each recognised reference, plus node.data.hName/hProperties that turn a bare link/image into an exported player in HTML and printouts while the editor keeps its own node view.
 * @functions
 *   - VIDEO_EXTENSIONS: The file extensions K-Doc plays as video.
 *   - AUDIO_EXTENSIONS: The file extensions K-Doc plays as audio.
 *   - mediaKindOf: Classify a target by its extension into 'video' or 'audio', or null when it names no playable file.
 *   - providerEmbedOf: Recognise a youtube/vimeo URL and return the site plus player address, or null for anything else.
 *   - plainText: Join only the value of text phrasing children so inline formatting flattens to its visible words.
 *   - mediaOfParagraph: Turn a paragraph that is nothing but one reference into a MediaEmbed, or null when it is prose.
 *   - applyMediaEmbeds: Render each recognised media paragraph as an exported player in node data for files leaving K-Doc.
 * @dataflow Parsed markdown → link/image nodes carry targets → providerEmbedOf then mediaKindOf classify them → mediaOfParagraph builds a MediaEmbed → applyMediaEmbeds writes hName/hProperties so mdast-util-to-hast emits <video>/<audio>/<iframe>.
 * @controlflow Classification is pure and read-only; rendering mutates node.data in place by walking root.children once, leaving every non-media paragraph untouched.
 * @version 1
 * @date 2026-09-18
 */

import type { Paragraph, PhrasingContent, Root } from 'mdast';

/** The extensions K-Doc plays as video. */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov']);

/** The extensions K-Doc plays as audio. */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac']);

/** Whether a media reference is played back as video or audio, i.e. what the file extension names. */
export type MediaKind = 'video' | 'audio';

/** A site K-Doc knows how to play an embedded player from rather than serving a raw file. */
export type MediaProvider = 'youtube' | 'vimeo';

/**
 * The recognised description of one media reference, enough both to render it and to write the same syntax back out.
 */
export interface MediaEmbed {
  /** 'video' or 'audio' for a file; 'provider' for something played by a site K-Doc knows. */
  readonly kind: MediaKind | 'provider';
  /** The address exactly as the document wrote it. */
  readonly target: string;
  /** The link text or image alt, which the player shows as its label; may be empty. */
  readonly label: string;
  /** Which syntax the document used, so it can be written back the same way. */
  readonly syntax: 'link' | 'image';
  /** For a provider, the site and the address of the player; null for a file. */
  readonly provider: MediaProvider | null;
  readonly embedUrl: string | null;
}

/** Matches a standard `youtube.com/watch?v=<id>` URL, allowing an optional preceding query term joined by `&`. */
const YOUTUBE_WATCH = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,20})/;

/** Matches a short `youtu.be/<id>` URL. */
const YOUTUBE_SHORT = /^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{6,20})/;

/** Matches a `vimeo.com/<id>` video URL whose id is purely numeric. */
const VIMEO = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/;

/**
 * @purpose Classify a target by its file extension into the media kind K-Doc plays it as, or null when it names no playable file.
 * @inputs target - The address exactly as written in the document, which may carry a fragment and/or query before any extension.
 * @outputs MediaKind | null - 'video' or 'audio' for an extension present in VIDEO_EXTENSIONS then AUDIO_EXTENSIONS, else null.
 * @dataflow Target → strip #fragment and ?query → text after the last '.' lower-cased → membership test against each set → kind or null.
 * @controlflow Remove fragment then query so neither can masquerade as an extension; require a dot for any candidate to exist; classify video before audio with explicit empty elses on every branch.
 */
export function mediaKindOf(target: string): MediaKind | null {
  // A fragment (#...) must be removed first, or an anchor such as `#t=1` would masquerade as the extension.
  const withoutFragment = target.split('#')[0] ?? '';

  // Then drop any query (?...), so a parameter like `?v=abc` cannot become the "extension".
  const withoutQuery = withoutFragment.split('?')[0] ?? '';

  // There must be a dot for there to be any extension at all; none means this target names no media file.
  if (withoutQuery.indexOf('.') === -1) {
    return null;
  } else {
    // A dot is present: extract the text after it below before classifying against the known sets.
  }

  // Take everything after the last '.' as the candidate extension, lower-cased so lookup ignores case.
  const ext = withoutQuery.slice(withoutQuery.lastIndexOf('.') + 1).toLowerCase();

  // Classify by video first, then audio, so a name is recognised by whichever set contains it and nothing else overrides that.
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  } else if (AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  } else {
    // The extension matches neither list: this target names no playable media file, so report none.
    return null;
  }
}

/**
 * @purpose Recognise a youtube or vimeo URL and return the site plus the address of its embedded player, or null for anything else.
 * @inputs target - The link address to test against each known provider pattern in turn.
 * @outputs { readonly provider: MediaProvider; readonly embedUrl: string } | null - A recognised provider with its player url, or null when no pattern matched.
 * @dataflow Target → YOUTUBE_WATCH then YOUTUBE_SHORT then VIMEO exec → guarded capture group 1 → build the matching embed url → result or null.
 * @controlflow Try each regex in turn and return on the first match; guard every capture against undefined under noUncheckedIndexedAccess before using it, with explicit empty elses throughout.
 */
export function providerEmbedOf(target: string): { readonly provider: MediaProvider; readonly embedUrl: string } | null {
  // A standard watch URL is tried first so a full link wins over any shorter form of the same video.
  const watch = YOUTUBE_WATCH.exec(target);

  if (watch !== null) {
    // The pattern always captures one group, but noUncheckedIndexedAccess types it as string | undefined here.
    const id = watch[1];

    if (id === undefined) {
      return null;
    } else {
      // A video id is present: build the no-cookie embed below and stop scanning providers.
    }

    // The no-cookie host is the one that does not set a tracking cookie before the reader has pressed play.
    return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  } else {
    // No youtube watch URL here; fall through to try a short link or vimeo below.
  }

  // A short youtu.be link carries the id directly after the host, with no query string at all.
  const short = YOUTUBE_SHORT.exec(target);

  if (short !== null) {
    const id = short[1];

    if (id === undefined) {
      return null;
    } else {
      // A video id is present: build the no-cookie embed below and stop scanning providers.
    }

    // The no-cookie host is the one that does not set a tracking cookie before the reader has pressed play.
    return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  } else {
    // No youtu.be short URL here; fall through to try a vimeo link below.
  }

  // A vimeo video id is purely numeric and follows the host directly, so it embeds at its own player path.
  const vimeo = VIMEO.exec(target);

  if (vimeo !== null) {
    const id = vimeo[1];

    if (id === undefined) {
      return null;
    } else {
      // A numeric video id is present: build the player url below and stop scanning providers.
    }

    return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` };
  } else {
    // No vimeo URL here; none of the known provider patterns matched this target at all.
  }

  // Nothing recognised by any provider pattern, so this address is not a playable provider reference.
  return null;
}

/**
 * @purpose Join only the value of text phrasing children so inline formatting flattens to its visible words for use as an embed label.
 * @inputs children - The phrasing children of a link node whose direct text should be concatenated, ignoring emphasis/strong wrappers.
 * @outputs string - The concatenation of every text child's value in document order, or '' when there are none.
 * @dataflow Each child → keep only Text nodes' value → append to the running result → returned label.
 * @controlflow Iterate children once and branch on node type with an explicit empty else so non-text phrasing contributes nothing.
 */
function plainText(children: readonly PhrasingContent[]): string {
  // Accumulate text left to right; a link's visible words live only in its Text nodes, not the emphasis/strong wrappers.
  let result = '';

  for (const child of children) {
    if (child.type === 'text') {
      // A Text node carries the actual characters shown, so append them to the label being built.
      result += child.value;
    } else {
      // Non-text phrasing such as emphasis or strong has no direct value here and is skipped by design.
    }
  }

  return result;
}

/**
 * @purpose Turn a paragraph that is nothing but one reference into a MediaEmbed, treating any sentence containing a link as prose instead.
 * @inputs paragraph - A single mdast Paragraph whose only child may be a bare link or image naming media or a provider.
 * @outputs MediaEmbed | null - The embed when the paragraph holds exactly one recognised reference, else null for anything wider.
 * @dataflow Single child → read target from url and label from text/alt → providerEmbedOf first (wins), then mediaKindOf → build MediaEmbed with matching syntax/provider/embedUrl or return null.
 * @controlflow Require exactly one child; accept only a link or image; classify the target as a provider before any file extension so a provider URL is never mistaken for an ordinary file.
 */
export function mediaOfParagraph(paragraph: Paragraph): MediaEmbed | null {
  // A paragraph that is more than one child is a sentence containing prose, not a bare player reference on its own.
  if (paragraph.children.length !== 1) {
    return null;
  } else {
    // Exactly one child remains to inspect below as the sole content of this paragraph.
  }

  const only = paragraph.children[0];

  // length === 1 guarantees a node exists, but noUncheckedIndexedAccess still types this read as undefined here.
  if (only === undefined) {
    return null;
  } else {
    // The single child is present: decide whether it is a link or an image below before reading its fields.
  }

  const isLink = only.type === 'link';
  const isImage = only.type === 'image';

  if (isLink || isImage) {
    // A bare reference node carries both the address and, in different shapes, a label to show inside the player.
    const target: string = only.url;

    // The link text or image alt becomes the label the player shows; it may legitimately be empty for an image.
    const syntax = only.type === 'link' ? 'link' : 'image';

    let label: string;

    if (isLink) {
      // A link exposes its words through child nodes, so join their visible values as the label via plainText.
      label = plainText(only.children);
    } else {
      // An image carries no children and stores its caption in alt, which mdast leaves null when none was written.
      label = only.alt ?? '';
    }

    // A provider link wins even if the URL ends in something that looks like an extension, so test it first.
    const asProvider = providerEmbedOf(target);

    if (asProvider !== null) {
      return { kind: 'provider', target, label, syntax, provider: asProvider.provider, embedUrl: asProvider.embedUrl };
    } else {
      // Not a recognised provider; fall back to classifying the target by its file extension below.
    }

    const kind = mediaKindOf(target);

    if (kind !== null) {
      return { kind, target, label, syntax, provider: null, embedUrl: null };
    } else {
      // Neither a provider nor a media file: this bare reference is not an embed and should stay as prose.
      return null;
    }
  } else {
    // The single child is neither a link nor an image (e.g. plain text or inline code): it cannot be a player.
    return null;
  }
}

/**
 * @purpose Build the node.data record that renders one recognised media reference as an exported player in HTML and printouts.
 * @inputs kind - The embed's kind: 'video', 'audio', or 'provider'. embed - The MediaEmbed describing how to play it.
 * @outputs Record<string, unknown> - hName/hProperties for mdast-util-to-hast; a <video>/<audio> with src and controls, an <iframe> pointing at the player url.
 * @dataflow kind → select element name and properties from embed.target/embed.embedUrl/embed.provider/label → record handed back to applyMediaEmbeds.
 * @controlflow Branch on kind: files use media elements whose src is the target; providers use a lazy-loading fullscreen iframe whose title falls back to the provider when no label was written.
 */
function elementData(kind: MediaKind | 'provider', embed: MediaEmbed): Record<string, unknown> {
  if (kind === 'video') {
    // A video file plays in a native <video> element with its own controls and this target as the source.
    return { hName: 'video', hProperties: { controls: true, src: embed.target } };
  } else if (kind === 'audio') {
    // An audio file plays in a native <audio> element with its own controls and this target as the source.
    return { hName: 'audio', hProperties: { controls: true, src: embed.target } };
  } else {
    // A provider reference renders as an iframe at the player url below rather than serving the raw page.
    const title = embed.label === '' ? embed.provider : embed.label;

    return {
      hName: 'iframe',
      hProperties: { src: embed.embedUrl, allowfullscreen: true, loading: 'lazy', title },
    };
  }
}

/**
 * @purpose Render every recognised media paragraph as an exported player in node data for a file that leaves K-Doc.
 * @inputs root - The parsed mdast Root tree to annotate in place; the editor keeps its own node view and does not use this path.
 * @outputs void - Mutates each media paragraph's node.data with hName/hProperties/hChildren so hast emits a player instead of a link.
 * @dataflow Walk children → mediaOfParagraph classifies each paragraph → elementData builds the record → written into node.data, clearing any child text via hChildren = [].
 * @controlflow Iterate root.children once and leave every non-media paragraph untouched; for a recognised one write data through (node.data as Record<string, unknown>), creating {} when absent.
 */
export function applyMediaEmbeds(root: Root): void {
  // Walk every child; a paragraph is classified on its own, with its neighbours making no difference.
  for (const node of root.children) {
    // Check whether this child is a paragraph at all; nothing else can be a bare media reference.
    if (node.type !== 'paragraph') {
      continue;
    } else {
      // A paragraph: classify it below before deciding whether it is an embed worth rendering.
    }

    const embed = mediaOfParagraph(node);

    if (embed === null) {
      continue;
    } else {
      // A recognised embed: annotate its node data below.
    }

    // Create empty data when the node has none, so the record below has somewhere to go.
    if (node.data === undefined) {
      node.data = {} as Paragraph['data'];
    } else {
      // Data already exists: keep whatever else K-Doc stored on this node and add to it.
    }

    const data = node.data as Record<string, unknown>;

    // hName/hProperties tell mdast-util-to-hast which element to emit and with what attributes.
    Object.assign(data, elementData(embed.kind, embed));

    // A <video> with text inside it shows that text instead of the player when the file cannot be read, which is
    // not what the document said, so the element is emitted empty.
    data['hChildren'] = [];
  }
}
