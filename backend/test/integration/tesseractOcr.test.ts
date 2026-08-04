import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TesseractOcrProvider } from '../../src/services/ocr/TesseractOcrProvider.js';
import { whitePng } from '../fixtures/synthetic/images.js';
import { renderTextPng } from '../fixtures/synthetic/textImage.js';

import type { OcrInputPage } from '../../src/services/ocr/OcrProvider.js';

/**
 * Real OCR against generated images.
 *
 * ## Why the assertions look loose
 *
 * The fixtures are drawn with a 5×7 bitmap font (see `textImage.ts`), because
 * committing a photograph of a document is exactly what Phase 1 forbids. Those
 * glyphs are blocky, and Tesseract — trained on real typefaces — misreads some
 * of them consistently: B reads as E, P as F, and a zero as `@`. Digits and
 * common words come through reliably.
 *
 * So these tests assert on tokens Tesseract genuinely gets right, and on the
 * *contract* the pipeline depends on: page order, page numbering, unreadable
 * marking, confidence, and a typed failure when nothing can be read. Tightening
 * them to exact strings would mean tuning the fixture font until Tesseract
 * agreed with it, which measures the font, not the provider.
 *
 * Real-document accuracy is a known Phase 1 limitation — phase-1.md § 8.
 *
 * ## First run needs network
 *
 * tesseract.js downloads ~10 MB of language data the first time. Set
 * `SKIP_OCR_TESTS=1` to skip this file when running offline.
 */

const skip = process.env.SKIP_OCR_TESTS === '1';

describe.skipIf(skip)('TesseractOcrProvider', () => {
  let workDir: string;
  let provider: TesseractOcrProvider;

  const writePage = async (page: number, png: Buffer): Promise<OcrInputPage> => {
    const filePath = path.join(workDir, `page-${page}.png`);
    await fs.writeFile(filePath, png);
    return { page, path: filePath, mimeType: 'image/png' };
  };

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ayunetz-ocr-test-'));
    // One cache directory for the whole file, so the language model downloads
    // at most once per run.
    provider = new TesseractOcrProvider({ cachePath: workDir });
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('reads text off a synthetic page', async () => {
    const page = await writePage(1, renderTextPng(['GLUCOSE 142 MG/DL'], { scale: 10 }));

    const result = await provider.extractText([page]);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.unreadable).toBe(false);
    expect(result.pages[0]?.text).toContain('GLUCOSE');
    expect(result.pages[0]?.text).toContain('142');
    expect(result.pages[0]?.confidence).toBeGreaterThan(30);
    expect(result.overallConfidence).toBeGreaterThan(30);
  });

  it('keeps pages separate and in order', async () => {
    // Distinguished by digit runs this font renders in shapes Tesseract reads
    // reliably — 3, 5, 6 and 8 are the ones it stumbles on here.
    const pages = [
      await writePage(1, renderTextPng(['GLUCOSE 142'], { scale: 10 })),
      await writePage(2, renderTextPng(['GLUCOSE 917'], { scale: 10 })),
      await writePage(3, renderTextPng(['GLUCOSE 271'], { scale: 10 })),
    ];

    const result = await provider.extractText(pages);

    expect(result.pages.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(result.pages[0]?.text).toContain('142');
    expect(result.pages[1]?.text).toContain('917');
    expect(result.pages[2]?.text).toContain('271');
    // Each page's content stays on its own page.
    expect(result.pages[0]?.text).not.toContain('917');
    expect(result.pages[2]?.text).not.toContain('142');
  });

  it('sorts pages that arrive out of order', async () => {
    const pages = [
      await writePage(2, renderTextPng(['GLUCOSE 917'], { scale: 10 })),
      await writePage(1, renderTextPng(['GLUCOSE 142'], { scale: 10 })),
    ];

    const result = await provider.extractText(pages);

    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0]?.text).toContain('142');
  });

  it('marks a blank page unreadable without failing the document', async () => {
    const pages = [
      await writePage(1, renderTextPng(['GLUCOSE 142 MG/DL'], { scale: 10 })),
      await writePage(2, whitePng(600, 400)),
    ];

    const result = await provider.extractText(pages);

    expect(result.pages[0]?.unreadable).toBe(false);
    expect(result.pages[1]?.unreadable).toBe(true);
    // The blank page still occupies its slot, so page numbers stay meaningful.
    expect(result.pages[1]?.page).toBe(2);
    // Confidence reflects the page that was actually read.
    expect(result.overallConfidence).toBe(result.pages[0]?.confidence);
  });

  it('fails with a typed error when no page can be read', async () => {
    const pages = [await writePage(1, whitePng(400, 300)), await writePage(2, whitePng(400, 300))];

    await expect(provider.extractText(pages)).rejects.toMatchObject({
      name: 'ProcessingError',
      code: 'ocr_failed',
    });
  });

  it('records an unreadable page rather than throwing when a file is missing', async () => {
    const missing: OcrInputPage = {
      page: 2,
      path: path.join(workDir, 'does-not-exist.png'),
      mimeType: 'image/png',
    };
    const pages = [
      await writePage(1, renderTextPng(['GLUCOSE 142 MG/DL'], { scale: 10 })),
      missing,
    ];

    const result = await provider.extractText(pages);

    expect(result.pages[1]?.unreadable).toBe(true);
    expect(result.pages[1]?.text).toBe('');
  });

  it('rejects an empty page list', async () => {
    await expect(provider.extractText([])).rejects.toMatchObject({ code: 'ocr_failed' });
  });
});
