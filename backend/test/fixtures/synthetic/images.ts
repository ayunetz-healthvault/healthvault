import zlib from 'node:zlib';

/**
 * Synthetic image fixtures.
 *
 * Everything here is generated in-process. No image of a real document — or of
 * anything at all — is committed to this repository, and none should be. Phase
 * 1 is synthetic data only (docs/architecture/README.md, principle 17).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));

  return Buffer.concat([length, typeAndData, crc]);
};

export interface GreyscaleBitmap {
  width: number;
  height: number;
  /** One byte per pixel, row-major. 0 is black, 255 is white. */
  pixels: Uint8Array;
}

/** Encodes a real, decodable 8-bit greyscale PNG. */
export const encodePng = (bitmap: GreyscaleBitmap): Buffer => {
  const { width, height, pixels } = bitmap;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // colour type: greyscale
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[y * (width + 1) + 1 + x] = pixels[y * width + x] ?? 255;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/** A plain white PNG of the given size. */
export const whitePng = (width = 8, height = 8): Buffer =>
  encodePng({ width, height, pixels: new Uint8Array(width * height).fill(255) });

/**
 * A JPEG that is a genuine JPEG *as far as anything that inspects file type is
 * concerned*: correct SOI/APP0 header and EOI marker.
 *
 * It carries no scan data and no decoder will render it. That is sufficient
 * and appropriate here — the code under test in P1-04 decides on the signature
 * and the byte count, and deliberately does not decode. Tests that need a
 * readable image use {@link encodePng}.
 */
export const jpegHeaderOnly = (paddingBytes = 64): Buffer =>
  Buffer.concat([
    // SOI + APP0/JFIF
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.alloc(paddingBytes, 0x20),
    // EOI
    Buffer.from([0xff, 0xd9]),
  ]);

export const pdfBytes = (): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.alloc(32, 0x20)]);

export const gifBytes = (): Buffer =>
  Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(32, 0x20)]);
