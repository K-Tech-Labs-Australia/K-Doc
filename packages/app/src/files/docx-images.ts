/**
 * @file docx-images.ts
 * @purpose Turns the data URIs the exporter already gathers for local pictures into what a Word document needs to embed one (FR-13.4): the raw bytes, the format, and the picture's size, which Word requires and the data URI does not carry.
 * @inputs a data URI
 * @outputs the decoded picture, or null when it is not one Word can take
 * @functions
 *   - decodeDataUri: Splits a data: URI into its MIME type and raw bytes, requiring base64 encoding.
 *   - imageDimensions: Reads pixel width and height from an image file's own header.
 *   - decodeImage: Combines the above to produce a DecodedImage for a supported format, or null.
 *   - fitWidth: Scales a picture down to fit the page width while preserving its aspect ratio.
 * @dataflow data URI -> base64 -> bytes -> header fields -> width and height -> scaled to the page
 * @controlflow anything this cannot read — an SVG, a format Word will not embed, a truncated file — returns null and the caller writes the picture's description instead
 * @version 1
 * @date 2026-09-17
 */

/**
 * DocxImageType enumerates the raster formats Word can embed directly in a document.
 * SVG is intentionally excluded: it needs a raster fallback Word insists on, which is not something to invent here.
 */
export type DocxImageType = 'png' | 'jpg' | 'gif' | 'bmp';

/**
 * DecodedImage carries everything Word needs to place a picture: its format, raw bytes, and pixel size.
 */
export interface DecodedImage {
  readonly type: DocxImageType;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * MAX_IMAGE_WIDTH_PX is about the width of a portrait A4 or Letter page's text column at 96 dpi;
 * a wider picture would run off the page.
 */
export const MAX_IMAGE_WIDTH_PX: number = 600;

const MIME_TYPES: ReadonlyMap<string, DocxImageType> = new Map<string, DocxImageType>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
]);

/**
 * decodeDataUri parses a data: URI into its declared MIME type and the raw bytes it encodes.
 * @purpose Extracts the base64-decoded payload of an exporter data URI so its image header can be read.
 * @inputs uri - The full `data:` string, e.g. `data:image/png;base64,...`.
 * @outputs An object with the lowercased MIME type and decoded bytes, or null when the string is not a base64 data URI.
 * @dataflow data URI -> regex capture groups -> base64 payload -> binary string -> Uint8Array.
 * @controlflow Reject any string that fails the data: regex or lacks the `;base64` flag; decode on success and return null from the catch.
 */
export function decodeDataUri(uri: string): { readonly mime: string; readonly bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(uri);
  // Confirm the string is shaped like a data: URI before trusting its capture groups.
  if (match === null) {
    return null;
  } else {
    // The regex matched; fall through to read mime, parameters, and payload from the groups.
  }
  const mime = (match[1] ?? '').toLowerCase();
  const parameters = match[2] ?? '';
  const payload = match[3] ?? '';
  // The exporter's data URIs are always base64; one that is not (percent-encoded, as an SVG often is) is not a picture this can embed.
  if (!parameters.includes(';base64')) {
    return null;
  } else {
    // The flag is present; proceed to decode the payload.
  }

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    // atob throws on malformed base64; treat it as an unreadable picture.
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  // Convert each decoded character code into one raw byte of the image payload.
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mime, bytes };
}

function readUint16BE(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function readUint16LE(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function readUint32BE(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) >>> 0) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
}

function readInt32LE(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24);
}

const JPEG_SIZE_MARKERS: ReadonlySet<number> = new Set<number>([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * imageDimensions reads the pixel size out of an image file's own header.
 * @purpose Supplies the width and height Word requires but a data URI does not carry.
 * @inputs type - The already-declared picture format; bytes - The raw encoded payload.
 * @outputs The pixel dimensions, or null when the signature is wrong or the header ends before the size.
 * @dataflow file bytes -> per-format header offsets -> width and height integers.
 * @controlflow PNG reads its IHDR chunk, GIF and BMP read fixed offsets, JPEG walks markers to the start-of-frame; any bad signature or short file returns null.
 */
export function imageDimensions(type: DocxImageType, bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  // No length checks before reading: a read past the end gives 0 through the ?? 0 in each reader, and the
  // size field is always the last one read, so a file that ends early arrives at the zero-size check below
  // and is refused there. One check in one place, rather than a length per format to keep in step.
  let width = 0;
  let height = 0;

  if (type === 'png') {
    // PNG begins with a fixed four-byte signature; reject anything that does not match.
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      return null;
    } else {
      // Signature is valid; read the IHDR width and height at offsets 16 and 20.
    }
    width = readUint32BE(bytes, 16);
    height = readUint32BE(bytes, 20);
  } else if (type === 'gif') {
    // GIF begins with an ASCII signature; reject a short file or one that does not start with "GIF".
    if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
      return null;
    } else {
      // Signature is valid; read the little-endian width and height at offsets 6 and 8.
    }
    width = readUint16LE(bytes, 6);
    height = readUint16LE(bytes, 8);
  } else if (type === 'bmp') {
    // BMP begins with "BM"; reject a short file or one that does not match.
    if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
      return null;
    } else {
      // Signature is valid; read the signed width and height at offsets 18 and 22.
    }
    width = readInt32LE(bytes, 18);
    height = Math.abs(readInt32LE(bytes, 22));
  } else {
    // The remaining supported format is JPEG; it has no single size field, so its markers must be walked.
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return null;
    } else {
      // SOI marker present; begin scanning for the start-of-frame marker that carries the size.
    }
    let at = 2;
    // A stream that ends before a start-of-frame marker leaves the size at zero, which the check below refuses.
    while (at + 9 < bytes.length) {
      // Every JPEG marker is preceded by a 0xFF byte; a missing fill byte means a corrupt stream.
      if (bytes[at] !== 0xff) {
        return null;
      } else {
        // The 0xFF prefix is present; inspect the following marker byte.
      }
      const marker = bytes[at + 1] ?? 0;
      if (marker === 0xff) {
        // A stray 0xFF fill byte: skip just this one and keep scanning.
        at += 1;
        continue;
      } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        // TEM and RSTn markers carry no length field: step over the two-byte marker only.
        at += 2;
        continue;
      } else if (JPEG_SIZE_MARKERS.has(marker)) {
        // Start-of-frame marker found: it directly encodes height and width, so record them and stop walking.
        height = readUint16BE(bytes, at + 5);
        width = readUint16BE(bytes, at + 7);
        break;
      } else {
        // A non-size marker: skip past it using its own length field and continue scanning.
        at += 2 + readUint16BE(bytes, at + 2);
      }
    }
  }

  // A decoded picture must have strictly positive dimensions; anything else is rejected.
  if (width <= 0 || height <= 0) {
    return null;
  } else {
    // Dimensions are valid; hand them back to the caller.
    return { width, height };
  }
}

/**
 * decodeImage turns a data URI into a DecodedImage for any format Word can embed.
 * @purpose Combines MIME resolution and header parsing into one picture the exporter can place.
 * @inputs uri - The full `data:` string produced by the exporter.
 * @outputs A DecodedImage for png/jpg/gif/bmp, or null when the URI is not base64, is an unsupported format, or has a bad header.
 * @dataflow data URI -> decodeDataUri -> MIME lookup -> imageDimensions -> DecodedImage.
 * @controlflow Each stage returns null on failure and short-circuits; only a fully valid picture reaches the return.
 */
export function decodeImage(uri: string): DecodedImage | null {
  const decoded = decodeDataUri(uri);
  if (decoded === null) {
    // The URI was not a base64 data URI; nothing further can be done.
    return null;
  } else {
    // Bytes are available; resolve the declared MIME type to a known format.
  }
  const type = MIME_TYPES.get(decoded.mime);
  if (type === undefined) {
    // The format is not one Word embeds directly (e.g. SVG); reject it here.
    return null;
  } else {
    // The format is supported; read its size from the header.
  }
  const size = imageDimensions(type, decoded.bytes);
  if (size === null) {
    // The signature or header was bad for this type; reject the picture.
    return null;
  } else {
    // All checks passed; assemble and return the decoded picture.
    return { type, bytes: decoded.bytes, width: size.width, height: size.height };
  }
}

/**
 * fitWidth scales a picture down so it fits within a page-width budget without distorting its aspect ratio.
 * @purpose Keeps narrow pictures at native size and shrinks wider ones to the text column.
 * @inputs width - The picture's pixel width; height - The picture's pixel height; maxWidth - The available page width in pixels.
 * @outputs A { width, height } pair that never exceeds maxWidth and never collapses to zero.
 * @dataflow native dimensions -> comparison against maxWidth -> scaled dimensions if needed.
 * @controlflow A picture already within the budget is returned unchanged; a wider one is proportionally scaled.
 */
export function fitWidth(width: number, height: number, maxWidth: number): { readonly width: number; readonly height: number } {
  if (width <= maxWidth) {
    // The picture already fits; keep its native size untouched.
    return { width, height };
  } else {
    // The picture is too wide: scale both dimensions by the same ratio so proportions hold and it never collapses to nothing.
    return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
  }
}
