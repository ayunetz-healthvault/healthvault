import { ProcessingError, type TemporaryPage } from '../../types/processing.js';
import { PdfPageExtractor } from '../pdf/PdfPageExtractor.js';

import type { OcrImageMimeType } from '../upload/FileValidator.js';

/**
 * Flattens what was uploaded into a single ordered list of readable pages.
 *
 * A user can send three photographs, or one four-page PDF, or two photographs
 * and a PDF between them. By the time the pipeline reads anything, all of that
 * has become one numbered sequence — page 1 to page N — and nothing downstream
 * knows or cares which file a page came from.
 *
 * Page numbers are assigned here, and they are what every source reference in
 * the finished summary points at. A page that arrives as the second page of a
 * PDF sent third is simply "page 4" to the family checking the original.
 */

export interface ReadablePage {
  /** 1-based across the whole document, after flattening. */
  page: number;
  /** Text taken straight from a PDF's text layer, when there was one. */
  text: string | null;
  /** An image to OCR, when there was not. */
  imagePath: string | null;
  mimeType: OcrImageMimeType | null;
}

export interface ExpandOptions {
  workingDirectory: string;
  maxPages: number;
}

export class PageExpander {
  private readonly pdfExtractor: PdfPageExtractor;

  constructor(pdfExtractor: PdfPageExtractor = new PdfPageExtractor()) {
    this.pdfExtractor = pdfExtractor;
  }

  async expand(pages: TemporaryPage[], options: ExpandOptions): Promise<ReadablePage[]> {
    const readable: ReadablePage[] = [];

    for (const uploaded of [...pages].sort((a, b) => a.page - b.page)) {
      if (uploaded.mimeType !== 'application/pdf') {
        readable.push({
          page: readable.length + 1,
          text: null,
          imagePath: uploaded.path,
          mimeType: uploaded.mimeType,
        });
        continue;
      }

      const extracted = await this.pdfExtractor.extract(uploaded.path, {
        workingDirectory: options.workingDirectory,
        // The PDF alone may not exceed the limit, and neither may the total.
        maxPages: options.maxPages - readable.length,
      });

      for (const pdfPage of extracted) {
        readable.push({
          page: readable.length + 1,
          text: pdfPage.text,
          imagePath: pdfPage.imagePath,
          mimeType: pdfPage.imagePath === null ? null : 'image/png',
        });
      }
    }

    // Checked again after flattening: a one-file upload can still be a
    // twelve-page document, and the limit is about pages, not files.
    if (readable.length > options.maxPages) {
      throw new ProcessingError(
        'invalid_file',
        `A document can have at most ${options.maxPages} pages.`,
        { details: { maxPages: options.maxPages } },
      );
    }

    if (readable.length === 0) {
      throw new ProcessingError('invalid_file', 'No pages were included in the request.');
    }

    return readable;
  }
}
