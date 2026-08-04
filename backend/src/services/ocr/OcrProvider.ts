import type { OcrImageMimeType } from '../upload/FileValidator.js';

/**
 * OCR boundary.
 *
 * The orchestrator must not know whether text came from Tesseract running
 * locally, from Amazon Textract in Phase 2, or from a fixture in a test. Only
 * three things are promised: pages are read independently, order is preserved,
 * and a page that could not be read says so rather than returning empty text
 * that looks like a blank page.
 *
 * Nothing in this module — or any implementation of it — may log extracted
 * text. See docs/architecture/README.md principle 14.
 */

export interface OcrInputPage {
  /** 1-based, as sent by the client. */
  page: number;
  path: string;
  mimeType: OcrImageMimeType;
}

export interface OcrPageResult {
  page: number;
  text: string;
  /** 0–100 where the engine reports one, `null` where it does not. */
  confidence: number | null;
  /**
   * True when this page yielded nothing usable — a blank sheet, a photograph
   * of a thumb, a scan too dark to read. The page still appears in the result
   * so the numbering stays honest and the UI can say which page was lost.
   */
  unreadable: boolean;
}

export interface OcrDocumentResult {
  pages: OcrPageResult[];
  /** Mean confidence across readable pages, or `null` if none reported one. */
  overallConfidence: number | null;
}

export interface OcrProvider {
  readonly name: string;
  extractText(pages: OcrInputPage[]): Promise<OcrDocumentResult>;
}

/**
 * Below this, the engine is guessing at shapes rather than reading text.
 *
 * Deliberately low. A poor scan of a real report still carries values worth
 * showing with a warning; the pipeline hedges low confidence in the UI rather
 * than discarding it here. This threshold only decides "was anything read at
 * all", not "is this good enough to summarise".
 */
export const UNREADABLE_CONFIDENCE = 30;

/** Shortest run of non-space characters that counts as having read something. */
const MIN_READABLE_CHARACTERS = 3;

/** Control characters, keeping tab (U+0009) and newline (U+000A). */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Light clean-up applied by every provider.
 *
 * Removes control characters and normalises line endings and trailing spaces.
 * It does *not* collapse blank lines or reflow text: the blank line between a
 * result and its reference range is structure, and the redactor's labelled-
 * region rules (ADR-002 § "Layer 3") work line by line.
 */
export const tidyPageText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();

/** Whether a page result should be marked unreadable. */
export const isUnreadable = (text: string, confidence: number | null): boolean => {
  if (text.replace(/\s/g, '').length < MIN_READABLE_CHARACTERS) {
    return true;
  }

  return confidence !== null && confidence < UNREADABLE_CONFIDENCE;
};

/** Mean confidence over readable pages only, rounded to one decimal. */
export const meanConfidence = (pages: OcrPageResult[]): number | null => {
  const scores = pages
    .filter((page) => !page.unreadable)
    .map((page) => page.confidence)
    .filter((confidence): confidence is number => confidence !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 10) / 10;
};
