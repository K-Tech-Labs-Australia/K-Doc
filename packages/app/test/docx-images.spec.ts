/**
 * @file docx-images.spec.ts
 * @purpose Covers reading a picture's format and size for Word (FR-13.4); Word needs both and a data URI carries neither directly.
 * @inputs hand-built image headers encoded as data URIs.
 * @outputs assertions over decodeDataUri, imageDimensions, decodeImage and fitWidth.
 * @functions
 *   - decodeDataUri: describe block covering base64 data URI decoding.
 *   - imageDimensions: describe block covering per-format dimension parsing.
 *   - decodeImage: describe block covering Word-embeddable picture decoding.
 *   - fitWidth: describe block covering proportional down-scaling to page width.
 * @dataflow bytes -> data URI -> decoded picture.
 * @controlflow one describe per export; each it guards a single behaviour.
 * @version 1
 * @date 2026-09-17
 */

import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_WIDTH_PX, decodeDataUri, decodeImage, fitWidth, imageDimensions } from '../src/files/docx-images.js';

function dataUri(mime: string, bytes: readonly number[]): string {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
}

function png(width: number, height: number): number[] {
  const bytes = new Array<number>(33).fill(0);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((value, index) => (bytes[index] = value));
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function gif(width: number, height: number): number[] {
  return [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0];
}

function bmp(width: number, height: number): number[] {
  const bytes = new Array<number>(30).fill(0);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  const view = new DataView(new ArrayBuffer(8));
  view.setInt32(0, width, true);
  view.setInt32(4, height, true);
  for (let index = 0; index < 8; index++) {
    bytes[18 + index] = view.getUint8(index);
  }
  return bytes;
}

function jpeg(width: number, height: number): number[] {
  return [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xff,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
}

describe('decodeDataUri', () => {
  // Guards that a valid base64 data URI decodes to its mime type and raw bytes.
  it('reads a base64 data URI', () => {
    expect(decodeDataUri('data:image/PNG;base64,AAEC')).toEqual({ mime: 'image/png', bytes: new Uint8Array([0, 1, 2]) });
  });

  // Guards that a data URI using a non-base64 encoding is rejected.
  it('refuses a data URI that is not base64', () => {
    expect(decodeDataUri('data:image/svg+xml,%3Csvg%3E')).toBe(null);
    // A payload that happens to look like base64 is still not base64 unless the URI says so.
    expect(decodeDataUri('data:image/png,AAEC')).toBe(null);
  });

  // Guards that external URLs and malformed base64 payloads are both rejected.
  it('refuses something that is not a data URI', () => {
    expect(decodeDataUri('https://example.com/a.png')).toBe(null);
    expect(decodeDataUri('data:image/png;base64,***not base64***')).toBe(null);
  });
});

describe('imageDimensions', () => {
  // Guards PNG dimension extraction from the IHDR chunk.
  it('reads a PNG', () => {
    expect(imageDimensions('png', new Uint8Array(png(1200, 800)))).toEqual({ width: 1200, height: 800 });
  });

  // Guards GIF dimension extraction from the logical screen descriptor.
  it('reads a GIF', () => {
    expect(imageDimensions('gif', new Uint8Array(gif(320, 240)))).toEqual({ width: 320, height: 240 });
  });

  // Guards BMP handles both top-down (positive) and bottom-up (negative) row counts.
  it('reads a BMP stored either way up', () => {
    expect(imageDimensions('bmp', new Uint8Array(bmp(64, 48)))).toEqual({ width: 64, height: 48 });
    expect(imageDimensions('bmp', new Uint8Array(bmp(64, -48)))).toEqual({ width: 64, height: 48 });
  });

  // Guards JPEG parses dimensions past the SOI and APP0 markers that precede SOSIZE.
  it('reads a JPEG past the markers in front of its size', () => {
    expect(imageDimensions('jpg', new Uint8Array(jpeg(1024, 768)))).toEqual({ width: 1024, height: 768 });
  });

  // Guards that a file signature inconsistent with the declared type is rejected.
  it('refuses a file with a plausible size but the wrong signature', () => {
    // The size fields alone are not enough: a file that is not what it claims to be is not trusted.
    const notPng = png(10, 10);
    notPng[0] = 0;
    expect(imageDimensions('png', new Uint8Array(notPng))).toBe(null);
    const notGif = gif(10, 10);
    notGif[2] = 0;
    expect(imageDimensions('gif', new Uint8Array(notGif))).toBe(null);
    const notBmp = bmp(10, 10);
    notBmp[1] = 0;
    expect(imageDimensions('bmp', new Uint8Array(notBmp))).toBe(null);
  });

  it('skips fill bytes between JPEG markers', () => {
    // The fixture already has one fill byte; two in a row must be stepped over one at a time.
    const padded = jpeg(30, 20);
    padded.splice(20, 0, 0xff);
    expect(imageDimensions('jpg', new Uint8Array(padded))).toEqual({ width: 30, height: 20 });
  });

  it('refuses a file whose signature does not match its type', () => {
    expect(imageDimensions('png', new Uint8Array(gif(10, 10).concat(new Array<number>(20).fill(0))))).toBe(null);
    expect(imageDimensions('gif', new Uint8Array(png(10, 10)))).toBe(null);
    expect(imageDimensions('bmp', new Uint8Array(png(10, 10)))).toBe(null);
    expect(imageDimensions('jpg', new Uint8Array(png(10, 10)))).toBe(null);
  });

  // Guards that a truncated file ending before its declared size is rejected.
  it('refuses a file that ends before its size', () => {
    expect(imageDimensions('png', new Uint8Array(png(10, 10).slice(0, 20)))).toBe(null);
    expect(imageDimensions('gif', new Uint8Array(gif(10, 10).slice(0, 8)))).toBe(null);
    expect(imageDimensions('bmp', new Uint8Array(bmp(10, 10).slice(0, 20)))).toBe(null);
    expect(imageDimensions('jpg', new Uint8Array(jpeg(10, 10).slice(0, 24)))).toBe(null);
  });

  // Guards that a JPEG with a corrupt SOSIZE marker is rejected.
  it('refuses a JPEG whose markers are corrupt', () => {
    const broken = jpeg(10, 10);
    broken[20] = 0x00;
    expect(imageDimensions('jpg', new Uint8Array(broken))).toBe(null);
  });

  // Guards that zero dimensions (no usable size) are rejected.
  it('refuses a picture with no size', () => {
    expect(imageDimensions('png', new Uint8Array(png(0, 10)))).toBe(null);
    expect(imageDimensions('gif', new Uint8Array(gif(10, 0)))).toBe(null);
  });
});

describe('decodeImage', () => {
  // Guards successful decode of an embeddable PNG into a typed picture.
  it('decodes a picture Word can embed', () => {
    const decoded = decodeImage(dataUri('image/png', png(40, 30)));
    expect(decoded?.type).toBe('png');
    expect(decoded?.width).toBe(40);
    expect(decoded?.height).toBe(30);
    expect(decoded?.bytes.length).toBe(33);
  });

  // Guards that both image/jpeg and image/jpg spellings map to the jpg type.
  it('maps both JPEG spellings', () => {
    expect(decodeImage(dataUri('image/jpeg', jpeg(5, 6)))?.type).toBe('jpg');
    expect(decodeImage(dataUri('image/jpg', jpeg(5, 6)))?.type).toBe('jpg');
  });

  // Guards that formats Word cannot embed (SVG, WebP) are rejected.
  it('refuses a format Word cannot embed', () => {
    expect(decodeImage(`data:image/svg+xml;base64,${btoa('<svg/>')}`)).toBe(null);
    expect(decodeImage(dataUri('image/webp', png(4, 4)))).toBe(null);
  });

  // Guards that a picture whose dimensions cannot be parsed is rejected.
  it('refuses a picture it cannot size', () => {
    expect(decodeImage(dataUri('image/png', [1, 2, 3]))).toBe(null);
  });

  // Guards that a non-data URI input is rejected.
  it('refuses something that is not a data URI', () => {
    expect(decodeImage('assets/cat.png')).toBe(null);
  });
});

describe('fitWidth', () => {
  // Guards that pictures at or below the page width are left unchanged.
  it('keeps a picture that already fits', () => {
    expect(fitWidth(400, 300, MAX_IMAGE_WIDTH_PX)).toEqual({ width: 400, height: 300 });
    expect(fitWidth(MAX_IMAGE_WIDTH_PX, 300, MAX_IMAGE_WIDTH_PX)).toEqual({ width: MAX_IMAGE_WIDTH_PX, height: 300 });
  });

  // Guards proportional down-scaling that preserves the aspect ratio.
  it('scales a wide picture to the page, keeping its shape', () => {
    expect(fitWidth(1200, 800, 600)).toEqual({ width: 600, height: 400 });
  });

  // Guards that an extreme aspect ratio never collapses the shorter side below one pixel.
  it('never collapses a very flat picture to nothing', () => {
    expect(fitWidth(100000, 10, 600)).toEqual({ width: 600, height: 1 });
  });
});
