import { ProcessingError } from '../../types/processing.js';

/**
 * Page file validation.
 *
 * The declared content type is a claim by the caller, not evidence. Everything
 * here is decided on the bytes; the declared type is only used to reject a
 * mismatch, which is itself a signal worth refusing on.
 */

export type SupportedMimeType = 'image/jpeg' | 'image/png' | 'application/pdf';

/** The subset OCR can actually read. A PDF is expanded into these first. */
export type OcrImageMimeType = 'image/jpeg' | 'image/png';

/** Magic numbers. Short and boring on purpose — no parsing, just a prefix. */
const SIGNATURES: { mimeType: SupportedMimeType; bytes: number[] }[] = [
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // A PDF is accepted as a container: its pages are expanded into images or
  // text before anything reads them. See PdfPageExtractor.
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

/** Recognised well enough to give a better message than "unsupported". */
const NAMED_UNSUPPORTED: { label: string; bytes: number[] }[] = [
  { label: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },
  { label: 'TIFF', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { label: 'TIFF', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { label: 'ZIP or Office file', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'HEIC', bytes: [0x66, 0x74, 0x79, 0x70] }, // at offset 4, checked below
];

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, index) => buffer[offset + index] === byte);

/** The format the bytes actually are, or `null` if it is not one we accept. */
export const detectMimeType = (buffer: Buffer): SupportedMimeType | null =>
  SIGNATURES.find((signature) => startsWith(buffer, signature.bytes))?.mimeType ?? null;

const describeUnsupported = (buffer: Buffer): string => {
  const named = NAMED_UNSUPPORTED.find(
    (candidate) =>
      startsWith(buffer, candidate.bytes) ||
      (candidate.label === 'HEIC' && startsWith(buffer, candidate.bytes, 4)),
  );

  return named === undefined ? 'an unsupported format' : `a ${named.label} file`;
};

export interface ValidatePageOptions {
  /** 1-based page number, used only for the error message. */
  page: number;
  declaredMimeType: string;
  maxBytes: number;
  /** True when the stream hit the size limit and was cut short. */
  truncated?: boolean;
}

/**
 * Rejects anything that is not a genuine JPEG or PNG within the size limit.
 *
 * Note what is *not* in any message this throws: the filename the caller sent.
 * Filenames on a medical scan are routinely "amma-bloodtest-july.jpg" or worse,
 * a patient ID. They are never echoed back and never logged.
 */
export const validatePage = (buffer: Buffer, options: ValidatePageOptions): SupportedMimeType => {
  const { page, declaredMimeType, maxBytes, truncated = false } = options;

  if (truncated || buffer.length > maxBytes) {
    throw new ProcessingError(
      'invalid_file',
      `Page ${page} is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
      { details: { page, maxBytes } },
    );
  }

  if (buffer.length === 0) {
    throw new ProcessingError('invalid_file', `Page ${page} is empty.`, { details: { page } });
  }

  const actual = detectMimeType(buffer);

  if (actual === null) {
    throw new ProcessingError(
      'invalid_file',
      `Page ${page} is ${describeUnsupported(buffer)}. Only JPG, PNG and PDF files are accepted.`,
      { details: { page } },
    );
  }

  // A JPEG announced as a PNG is not a formatting quirk; refuse rather than
  // silently trusting the bytes over the claim.
  if (declaredMimeType.toLowerCase().split(';')[0]?.trim() !== actual) {
    throw new ProcessingError(
      'invalid_file',
      `Page ${page} does not match its declared file type.`,
      { details: { page } },
    );
  }

  return actual;
};

export interface ValidatePageCountOptions {
  maxPages: number;
}

export const validatePageCount = (count: number, options: ValidatePageCountOptions): void => {
  if (count === 0) {
    throw new ProcessingError('invalid_file', 'No pages were included in the request.');
  }

  if (count > options.maxPages) {
    throw new ProcessingError(
      'invalid_file',
      `A document can have at most ${options.maxPages} pages.`,
      { details: { maxPages: options.maxPages } },
    );
  }
};
