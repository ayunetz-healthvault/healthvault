import { createWorker, type Worker } from 'tesseract.js';

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
 * Tesseract OCR, running locally.
 *
 * Local on purpose for Phase 1: the whole point of the architecture is that
 * the original document never leaves the Ayunetz boundary, and OCR is the step
 * that would otherwise hand a full-page image to a third party. Phase 2 swaps
 * this for Textract, which is in-region and under the same contract as the
 * rest of the stack — a different implementation of this same interface.
 *
 * Quality is a known limitation. Tesseract on a crooked phone photograph of a
 * carbon-copy prescription is not good, and P1-04's `TODO(capture)` note about
 * edge detection is the other half of that problem. See phase-1.md § 8.
 */

export interface TesseractOcrProviderOptions {
  /** Tesseract language(s). Phase 1 is English only — see TODO(i18n). */
  language?: string;
  /**
   * Where the language model is cached. Tesseract downloads ~10 MB on first
   * use; point this somewhere persistent to avoid doing that per run.
   */
  cachePath?: string;
}

export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract';

  private readonly language: string;
  private readonly cachePath: string | undefined;

  constructor(options: TesseractOcrProviderOptions = {}) {
    this.language = options.language ?? 'eng';
    this.cachePath = options.cachePath;
  }

  async extractText(pages: OcrInputPage[]): Promise<OcrDocumentResult> {
    if (pages.length === 0) {
      throw new ProcessingError('ocr_failed', 'There were no pages to read.');
    }

    let worker: Worker;

    try {
      worker = await createWorker(this.language, undefined, {
        // No logger. Tesseract's progress callback is chatty and its payloads
        // include recognised text; nothing from it may reach a log.
        ...(this.cachePath === undefined ? {} : { cachePath: this.cachePath }),
      });
    } catch (cause) {
      throw new ProcessingError('ocr_failed', 'The text recognition engine could not start.', {
        retryable: true,
        cause,
      });
    }

    try {
      const results: OcrPageResult[] = [];

      // Sequential rather than parallel: pages are independent, but one worker
      // reading them in turn is predictable about memory, and a 10-page limit
      // means there is nothing to gain from racing them.
      for (const input of [...pages].sort((a, b) => a.page - b.page)) {
        results.push(await this.readPage(worker, input));
      }

      if (results.every((page) => page.unreadable)) {
        throw new ProcessingError('ocr_failed', 'No text could be read from the document.', {
          details: { pages: results.length },
        });
      }

      return { pages: results, overallConfidence: meanConfidence(results) };
    } finally {
      // Workers hold a WASM instance and a child process; leaking one per
      // request would take the service down within a day.
      await worker.terminate().catch(() => undefined);
    }
  }

  /**
   * Reads one page.
   *
   * A page that throws is recorded as unreadable rather than failing the whole
   * document — one unreadable page out of four should still produce a summary
   * that says so, not an error screen.
   */
  private async readPage(worker: Worker, input: OcrInputPage): Promise<OcrPageResult> {
    try {
      const { data } = await worker.recognize(input.path);
      const text = tidyPageText(data.text ?? '');
      const confidence = typeof data.confidence === 'number' ? data.confidence : null;

      return { page: input.page, text, confidence, unreadable: isUnreadable(text, confidence) };
    } catch {
      // The cause is swallowed deliberately: Tesseract's errors quote the file
      // path and sometimes a fragment of what it was reading.
      return { page: input.page, text: '', confidence: null, unreadable: true };
    }
  }
}
