import { ProcessingError } from '../../types/processing.js';

import {
  isUnreadable,
  meanConfidence,
  tidyPageText,
  type OcrDocumentResult,
  type OcrInputPage,
  type OcrPageResult,
  type OcrProvider,
} from './OcrProvider.js';

/**
 * Deterministic OCR for tests and for running the pipeline without Tesseract.
 *
 * The text it returns is supplied by the caller, which is the point: a
 * redaction test needs to control exactly what "came off the page", and doing
 * that through a real OCR engine would make the test about image rendering
 * rather than about redaction.
 */

export interface MockOcrPage {
  text: string;
  confidence?: number | null;
}

export interface MockOcrProviderOptions {
  /** Text per 1-based page number. Pages with no entry use `defaultText`. */
  pages?: Record<number, MockOcrPage>;
  defaultText?: string;
  defaultConfidence?: number | null;
  /** Fail the whole call, to exercise the orchestrator's error path. */
  failWith?: ProcessingError;
}

export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock';

  private readonly options: MockOcrProviderOptions;

  constructor(options: MockOcrProviderOptions = {}) {
    this.options = options;
  }

  extractText(pages: OcrInputPage[]): Promise<OcrDocumentResult> {
    if (this.options.failWith !== undefined) {
      return Promise.reject(this.options.failWith);
    }

    const results: OcrPageResult[] = pages.map((input) => {
      const configured = this.options.pages?.[input.page];
      const rawText = configured?.text ?? this.options.defaultText ?? '';
      const text = tidyPageText(rawText);
      const confidence =
        configured?.confidence === undefined
          ? (this.options.defaultConfidence ?? 92)
          : configured.confidence;

      return { page: input.page, text, confidence, unreadable: isUnreadable(text, confidence) };
    });

    if (results.length > 0 && results.every((page) => page.unreadable)) {
      return Promise.reject(
        new ProcessingError('ocr_failed', 'No text could be read from the document.', {
          details: { pages: results.length },
        }),
      );
    }

    return Promise.resolve({ pages: results, overallConfidence: meanConfidence(results) });
  }
}
