import { describe, expect, it } from 'vitest';

import {
  detectMimeType,
  validatePage,
  validatePageCount,
} from '../../src/services/upload/FileValidator.js';
import { ProcessingError } from '../../src/types/processing.js';
import { gifBytes, jpegHeaderOnly, pdfBytes, whitePng } from '../fixtures/synthetic/images.js';

const MB = 1024 * 1024;
const baseOptions = { page: 1, maxBytes: 10 * MB };

describe('detectMimeType', () => {
  it('recognises the formats we accept', () => {
    expect(detectMimeType(jpegHeaderOnly())).toBe('image/jpeg');
    expect(detectMimeType(whitePng())).toBe('image/png');
    expect(detectMimeType(pdfBytes())).toBe('application/pdf');
  });

  it('returns null for everything else', () => {
    expect(detectMimeType(gifBytes())).toBeNull();
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectMimeType(Buffer.from('just text'))).toBeNull();
  });

  it('is not fooled by a PNG signature that starts one byte in', () => {
    expect(detectMimeType(Buffer.concat([Buffer.from([0x00]), whitePng()]))).toBeNull();
  });
});

describe('validatePage', () => {
  it('accepts a JPG and a PNG that match their declared type', () => {
    expect(validatePage(jpegHeaderOnly(), { ...baseOptions, declaredMimeType: 'image/jpeg' })).toBe(
      'image/jpeg',
    );
    expect(validatePage(whitePng(), { ...baseOptions, declaredMimeType: 'image/png' })).toBe(
      'image/png',
    );
  });

  it('tolerates a charset parameter on the declared type', () => {
    expect(
      validatePage(whitePng(), { ...baseOptions, declaredMimeType: 'image/png; charset=binary' }),
    ).toBe('image/png');
  });

  it('rejects a PNG announced as a JPEG', () => {
    expect(() =>
      validatePage(whitePng(), { ...baseOptions, declaredMimeType: 'image/jpeg' }),
    ).toThrow(/does not match its declared file type/);
  });

  it('accepts a PDF, which is expanded into pages later', () => {
    expect(validatePage(pdfBytes(), { ...baseOptions, declaredMimeType: 'application/pdf' })).toBe(
      'application/pdf',
    );
  });

  it('rejects a PDF renamed as an image', () => {
    // The classic upload bypass: right extension and content type, wrong bytes.
    // A PDF is now a supported format, so this is refused for the mismatch
    // rather than for the format — the bytes and the claim still have to agree.
    try {
      validatePage(pdfBytes(), { ...baseOptions, declaredMimeType: 'image/jpeg' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe('invalid_file');
      expect((error as ProcessingError).message).toContain('does not match its declared file type');
    }
  });

  it('names other recognisable formats so the message is actionable', () => {
    expect(() =>
      validatePage(gifBytes(), { ...baseOptions, declaredMimeType: 'image/gif' }),
    ).toThrow(/GIF/);
  });

  it('rejects an empty file', () => {
    expect(() =>
      validatePage(Buffer.alloc(0), { ...baseOptions, declaredMimeType: 'image/png' }),
    ).toThrow(/empty/);
  });

  it('rejects a page over the size limit', () => {
    const big = Buffer.concat([whitePng(), Buffer.alloc(200)]);

    expect(() =>
      validatePage(big, { ...baseOptions, declaredMimeType: 'image/png', maxBytes: 100 }),
    ).toThrow(/larger than/);
  });

  it('rejects a truncated stream even when the buffer looks small enough', () => {
    expect(() =>
      validatePage(whitePng(), {
        ...baseOptions,
        declaredMimeType: 'image/png',
        truncated: true,
      }),
    ).toThrow(/larger than/);
  });

  it('never repeats the uploaded filename back to the caller', () => {
    // The validator is not given the filename at all — this asserts the
    // signature stays that way, because a scan's filename is often an
    // identifier ("lakshmi-iyer-uhid-4471.jpg").
    const options = { ...baseOptions, declaredMimeType: 'image/jpeg' };

    try {
      validatePage(pdfBytes(), options);
    } catch (error) {
      expect(JSON.stringify((error as ProcessingError).toBody())).not.toContain('.jpg');
    }
  });
});

describe('validatePageCount', () => {
  it('accepts one to ten pages', () => {
    expect(() => validatePageCount(1, { maxPages: 10 })).not.toThrow();
    expect(() => validatePageCount(10, { maxPages: 10 })).not.toThrow();
  });

  it('rejects zero pages', () => {
    expect(() => validatePageCount(0, { maxPages: 10 })).toThrow(/No pages/);
  });

  it('rejects more than the maximum', () => {
    expect(() => validatePageCount(11, { maxPages: 10 })).toThrow(/at most 10 pages/);
  });
});
