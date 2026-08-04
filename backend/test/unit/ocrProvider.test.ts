import { describe, expect, it } from 'vitest';

import { MockOcrProvider } from '../../src/services/ocr/MockOcrProvider.js';
import {
  isUnreadable,
  meanConfidence,
  tidyPageText,
  UNREADABLE_CONFIDENCE,
  type OcrInputPage,
} from '../../src/services/ocr/OcrProvider.js';
import { ProcessingError } from '../../src/types/processing.js';

const inputPages = (count: number): OcrInputPage[] =>
  Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    path: `/nowhere/page-${index + 1}.png`,
    mimeType: 'image/png' as const,
  }));

describe('tidyPageText', () => {
  it('strips control characters that OCR sometimes emits', () => {
    const withControls = 'HbA1c\u0000 8.1\u0007 %\u001f';

    expect(tidyPageText(withControls)).toBe('HbA1c 8.1 %');
  });
  it('keeps tabs and newlines, which carry table structure', () => {
    expect(tidyPageText('Glucose\t142\nCreatinine\t0.9')).toBe('Glucose\t142\nCreatinine\t0.9');
  });

  it('normalises line endings', () => {
    expect(tidyPageText('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  it('trims trailing spaces per line but keeps blank lines', () => {
    // The blank line between a result and its reference range is structure the
    // redactor's line-based rules rely on.
    expect(tidyPageText('Glucose 142   \n\n  Ref: 70-100  ')).toBe('Glucose 142\n\n  Ref: 70-100');
  });
});

describe('isUnreadable', () => {
  it('marks an empty or near-empty page unreadable', () => {
    expect(isUnreadable('', 95)).toBe(true);
    expect(isUnreadable('   \n  ', 95)).toBe(true);
    expect(isUnreadable('a', 95)).toBe(true);
  });

  it('marks a page the engine barely recognised unreadable', () => {
    expect(isUnreadable('some real text here', UNREADABLE_CONFIDENCE - 1)).toBe(true);
    expect(isUnreadable('some real text here', UNREADABLE_CONFIDENCE)).toBe(false);
  });

  it('accepts text when the engine reports no confidence at all', () => {
    // Textract-style providers may not give a page-level score; absence of a
    // score is not evidence of a bad read.
    expect(isUnreadable('some real text here', null)).toBe(false);
  });
});

describe('meanConfidence', () => {
  it('averages readable pages only', () => {
    const mean = meanConfidence([
      { page: 1, text: 'a', confidence: 90, unreadable: false },
      { page: 2, text: '', confidence: 5, unreadable: true },
      { page: 3, text: 'c', confidence: 80, unreadable: false },
    ]);

    expect(mean).toBe(85);
  });

  it('returns null when nothing readable reported a score', () => {
    expect(meanConfidence([{ page: 1, text: '', confidence: 5, unreadable: true }])).toBeNull();
    expect(meanConfidence([])).toBeNull();
  });
});

describe('MockOcrProvider', () => {
  it('returns configured text per page, in order', async () => {
    const provider = new MockOcrProvider({
      pages: {
        1: { text: 'Glucose 142 mg/dL' },
        2: { text: 'Creatinine 0.9 mg/dL' },
      },
    });

    const result = await provider.extractText(inputPages(2));

    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0]?.text).toBe('Glucose 142 mg/dL');
    expect(result.pages[1]?.text).toBe('Creatinine 0.9 mg/dL');
  });

  it('marks a page with no configured text unreadable but keeps its number', async () => {
    const provider = new MockOcrProvider({ pages: { 1: { text: 'Glucose 142 mg/dL' } } });

    const result = await provider.extractText(inputPages(2));

    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]?.unreadable).toBe(true);
    expect(result.pages[1]?.page).toBe(2);
  });

  it('fails when no page could be read at all', async () => {
    const provider = new MockOcrProvider({ defaultText: '' });

    await expect(provider.extractText(inputPages(3))).rejects.toMatchObject({
      name: 'ProcessingError',
      code: 'ocr_failed',
    });
  });

  it('honours a low configured confidence', async () => {
    const provider = new MockOcrProvider({
      pages: { 1: { text: 'barely legible text', confidence: 12 } },
      defaultText: 'readable text on the other page',
    });

    const result = await provider.extractText(inputPages(2));

    expect(result.pages[0]?.unreadable).toBe(true);
    expect(result.pages[1]?.unreadable).toBe(false);
  });

  it('can be told to fail, for orchestrator error-path tests', async () => {
    const provider = new MockOcrProvider({
      failWith: new ProcessingError('ocr_failed', 'engine unavailable', { retryable: true }),
    });

    await expect(provider.extractText(inputPages(1))).rejects.toThrow('engine unavailable');
  });
});
