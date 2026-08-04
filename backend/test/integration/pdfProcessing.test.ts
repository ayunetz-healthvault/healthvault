import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PageExpander } from '../../src/services/processing/pageExpander.js';
import { PdfPageExtractor } from '../../src/services/pdf/PdfPageExtractor.js';
import { buildTextPdf, canBuildPdf, SYNTHETIC_PDF_LINES } from '../fixtures/synthetic/pdf.js';
import { whitePng } from '../fixtures/synthetic/images.js';

import type { TemporaryPage } from '../../src/types/processing.js';

/**
 * PDF handling, against a real generated PDF.
 */
describe.skipIf(!canBuildPdf())('PDF pages', () => {
  let workDir: string;

  const writePdf = async (lines: string[]): Promise<string> => {
    const file = path.join(workDir, 'report.pdf');
    await fs.writeFile(file, buildTextPdf(lines));
    return file;
  };

  const pdfPage = (filePath: string, page = 1): TemporaryPage => ({
    page,
    path: filePath,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  });

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ayunetz-pdf-test-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  describe('PdfPageExtractor', () => {
    it('reads text straight out of a text PDF, with no OCR involved', async () => {
      const file = await writePdf(SYNTHETIC_PDF_LINES);

      const pages = await new PdfPageExtractor().extract(file, {
        workingDirectory: workDir,
        maxPages: 10,
      });

      expect(pages).toHaveLength(1);
      expect(pages[0]?.imagePath).toBeNull();
      // Exact, because it was never guessed at — this is the file's own text.
      expect(pages[0]?.text).toContain('HbA1c 8.1 %');
      expect(pages[0]?.text).toContain('142 mg/dL');
      expect(pages[0]?.text).toContain('Lakshmi Iyer');
    });

    it('refuses a PDF with more pages than the limit, before rendering any', async () => {
      const many = Array.from({ length: 40 }, (_, i) => `Page marker ${i}\n\f`);
      const file = await writePdf(many);

      await expect(
        new PdfPageExtractor().extract(file, { workingDirectory: workDir, maxPages: 3 }),
      ).rejects.toMatchObject({ code: 'invalid_file' });
    });

    it('refuses a file that is not really a PDF', async () => {
      const file = path.join(workDir, 'broken.pdf');
      await fs.writeFile(file, Buffer.from('%PDF-1.7 but not really'));

      await expect(
        new PdfPageExtractor().extract(file, { workingDirectory: workDir, maxPages: 10 }),
      ).rejects.toMatchObject({ code: 'invalid_file' });
    });
  });

  describe('PageExpander', () => {
    it('flattens images and PDF pages into one numbered sequence', async () => {
      const pdf = await writePdf(SYNTHETIC_PDF_LINES);
      const image = path.join(workDir, 'photo.png');
      await fs.writeFile(image, whitePng());

      const expanded = await new PageExpander().expand(
        [{ page: 1, path: image, mimeType: 'image/png', sizeBytes: 100 }, pdfPage(pdf, 2)],
        { workingDirectory: workDir, maxPages: 10 },
      );

      expect(expanded.map((page) => page.page)).toEqual([1, 2]);
      // The photograph needs OCR; the PDF page brought its own text.
      expect(expanded[0]?.imagePath).toBe(image);
      expect(expanded[0]?.text).toBeNull();
      expect(expanded[1]?.imagePath).toBeNull();
      expect(expanded[1]?.text).toContain('HbA1c');
    });

    it('counts PDF pages against the document limit, not the file count', async () => {
      const pdf = await writePdf(SYNTHETIC_PDF_LINES);

      await expect(
        new PageExpander().expand([pdfPage(pdf)], { workingDirectory: workDir, maxPages: 0 }),
      ).rejects.toMatchObject({ code: 'invalid_file' });
    });
  });
});
