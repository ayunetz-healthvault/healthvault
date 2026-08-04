import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import * as mupdf from 'mupdf';

import { ProcessingError } from '../../types/processing.js';

/**
 * Turns a PDF into pages the pipeline can read.
 *
 * ## Two kinds of PDF, two routes through
 *
 * A lab report emailed to a family is usually a **text PDF** — the characters
 * are really in the file. Rasterising that and running OCR over it would throw
 * away a perfect copy of the text and replace it with a guess. So where a page
 * has a usable text layer, the text is taken directly and OCR is skipped.
 *
 * A PDF produced by a scanner or a phone app is a **picture in a wrapper**. It
 * has no text layer, so the page is rendered to an image and goes through OCR
 * like any photograph.
 *
 * Both routes end up in the same place, and the rest of the pipeline cannot
 * tell which one a page came from.
 *
 * ## Why MuPDF
 *
 * PDF parsers are a classic source of memory-safety bugs, and this one runs on
 * files a user was sent by someone else. MuPDF here is compiled to WebAssembly,
 * so parsing happens inside the WASM sandbox rather than in a native library
 * with access to the process. It also needs no native build step, which keeps
 * `npm install` working the same everywhere.
 */

/**
 * Below this many non-space characters, a "text layer" is not worth trusting —
 * it is usually a stray watermark or a page number on an otherwise scanned
 * page, and the real content is in the image.
 */
const MIN_TEXT_LAYER_CHARACTERS = 40;

/** Rendering scale. 2× gives Tesseract roughly 150 dpi from a 72 dpi page. */
const RENDER_SCALE = 2;

export interface ExtractedPdfPage {
  /** 1-based page number *within this PDF*. */
  pageInDocument: number;
  /** Text lifted straight from the file, when the page has a usable layer. */
  text: string | null;
  /** A rendered PNG to OCR, when it does not. */
  imagePath: string | null;
}

export interface ExtractPdfOptions {
  /** Where rendered pages are written. Cleaned up by the caller. */
  workingDirectory: string;
  /**
   * Refuse a PDF with more pages than this *before* rendering any of them. A
   * 400-page document would otherwise spend minutes rasterising only to be
   * rejected at the end.
   */
  maxPages: number;
}

export class PdfPageExtractor {
  async extract(pdfPath: string, options: ExtractPdfOptions): Promise<ExtractedPdfPage[]> {
    let document: mupdf.Document;

    try {
      const bytes = await fs.readFile(pdfPath);
      document = mupdf.Document.openDocument(bytes, 'application/pdf');
    } catch (cause) {
      // The cause can quote a path; it is kept for the stack and never sent on.
      throw new ProcessingError('invalid_file', 'This PDF could not be opened.', { cause });
    }

    const pageCount = document.countPages();

    if (pageCount === 0) {
      throw new ProcessingError('invalid_file', 'This PDF has no pages.');
    }

    if (pageCount > options.maxPages) {
      throw new ProcessingError(
        'invalid_file',
        `This PDF has ${pageCount} pages. A document can have at most ${options.maxPages}.`,
        { details: { maxPages: options.maxPages } },
      );
    }

    const pages: ExtractedPdfPage[] = [];

    for (let index = 0; index < pageCount; index += 1) {
      pages.push(await this.extractPage(document, index, options.workingDirectory));
    }

    return pages;
  }

  private async extractPage(
    document: mupdf.Document,
    index: number,
    workingDirectory: string,
  ): Promise<ExtractedPdfPage> {
    const pageInDocument = index + 1;
    const page = document.loadPage(index);

    const text = this.readTextLayer(page);

    if (text !== null) {
      return { pageInDocument, text, imagePath: null };
    }

    return {
      pageInDocument,
      text: null,
      imagePath: await this.renderPage(page, pageInDocument, workingDirectory),
    };
  }

  /** The page's own text, or `null` when there is not enough to rely on. */
  private readTextLayer(page: mupdf.Page): string | null {
    try {
      const text = page.toStructuredText().asText();
      return text.replace(/\s/g, '').length >= MIN_TEXT_LAYER_CHARACTERS ? text : null;
    } catch {
      // A malformed text layer is not a reason to fail: fall back to rendering.
      return null;
    }
  }

  private async renderPage(
    page: mupdf.Page,
    pageInDocument: number,
    workingDirectory: string,
  ): Promise<string> {
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE),
        mupdf.ColorSpace.DeviceRGB,
        // No alpha channel, and no annotations: a sticky note added by whoever
        // forwarded the file is not part of the medical record.
        false,
        true,
      );

      // Random name, same rule as every other temporary file — never derived
      // from the upload.
      const filePath = path.join(workingDirectory, `${randomUUID()}.png`);
      await fs.writeFile(filePath, Buffer.from(pixmap.asPNG()), { mode: 0o600 });

      return filePath;
    } catch (cause) {
      throw new ProcessingError(
        'invalid_file',
        `Page ${pageInDocument} of this PDF could not be read.`,
        { details: { page: pageInDocument }, cause },
      );
    }
  }
}
